// js/app/views/mensajes.js — Full App Shell mensajes view
import { getState } from '/js/app/app-state.js';
import * as D from '/js/app/features/mensajes/mensajes-data.js';
import * as A from '/js/app/features/mensajes/mensajes-attachments.js';
import * as R from '/js/app/features/mensajes/mensajes-renderer.js';

let _unsub = null, _me = null, _all = [], _convs = [], _meta = new Map();
let _activePeer = null, _archivedMode = false, _archived = {};
let _pendingFile = null, _pendingAudio = null, _replyTo = null;
let _recorder = null, _audioCtx = null, _analyser = null, _specRaf = null, _recTimer = null;
let _emojiPickerImport = null;

const EMOJI_PICKER_SRC = 'https://cdn.jsdelivr.net/npm/emoji-picker-element@1/index.js';

const _mexAlert = (titulo, texto, tipo = 'info') =>
  typeof window.mexAlert === 'function' ? window.mexAlert(titulo, texto, tipo) : Promise.resolve(true);
const _mexConfirm = (titulo, texto, tipo = 'warning') =>
  typeof window.mexConfirm === 'function' ? window.mexConfirm(titulo, texto, tipo) : Promise.resolve(false);
const _mexPrompt = (titulo, texto, placeholder = '', inputTipo = 'text', valor = '') =>
  typeof window.mexPrompt === 'function' ? window.mexPrompt(titulo, texto, placeholder, inputTipo, valor) : Promise.resolve(null);

export async function mount(ctx) {
  const container = ctx.container || document.querySelector('#routeMainStage') || document.body;
  const { profile } = getState();
  _me = D.buildMyIdentity(profile);
  _archived = D.loadArchived(_me.email);
  container.innerHTML = R.shellLayout(_me.display);
  _bindEvents(container);
  _unsub = D.startRealtimeListener(_me, msgs => { _all = msgs; _refresh(); });
}

export function unmount() {
  _unsub?.(); _unsub = null; _stopRecording(true);
  if (_pendingFile?.previewUrl) URL.revokeObjectURL(_pendingFile.previewUrl);
  if (_pendingAudio?.localUrl) URL.revokeObjectURL(_pendingAudio.localUrl);
  _all = []; _convs = []; _meta = new Map();
  _activePeer = null; _pendingFile = null; _pendingAudio = null; _replyTo = null;
}

function _bindEvents(rootNode) {
  const root = typeof rootNode === 'string' ? document.querySelector(rootNode) : (rootNode || document);
  const $ = id => root.querySelector('#' + id);
  $('amSearch')?.addEventListener('input', () => _renderContacts());
  $('amArchiveToggle')?.addEventListener('click', () => { _archivedMode = !_archivedMode; _renderContacts(); });
  $('amFilterPlaza')?.addEventListener('change', () => _renderContacts());
  $('amFilterRol')?.addEventListener('change', () => _renderContacts());
  $('amFilterStatus')?.addEventListener('change', () => _renderContacts());
  $('amFilterClear')?.addEventListener('click', () => { [$('amSearch'),$('amFilterPlaza'),$('amFilterRol'),$('amFilterStatus')].forEach(e=>{if(e)e.value='';}); _renderContacts(); });
  $('amNewChat')?.addEventListener('click', _openNewChat);
  $('amEmptyBtn')?.addEventListener('click', _openNewChat);
  $('amRefresh')?.addEventListener('click', () => { if(_unsub){_unsub();_unsub=D.startRealtimeListener(_me,msgs=>{_all=msgs;_refresh();})} });
  $('amBackBtn')?.addEventListener('click', _closeChat);
  $('amArchiveBtn')?.addEventListener('click', _toggleArchive);
  $('amInfoBtn')?.addEventListener('click', _showPeerInfo);
  $('amSendBtn')?.addEventListener('click', _send);
  $('amAttachBtn')?.addEventListener('click', () => $('amFileInput')?.click());
  $('amFileInput')?.addEventListener('change', e => _stageFile(e.target));
  $('amMicBtn')?.addEventListener('click', _toggleRecording);
  $('amInput')?.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();_send();} });
  $('amInput')?.addEventListener('input', e => { e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,120)+'px'; });
  $('amLightboxClose')?.addEventListener('click', () => { const lb=$('amLightbox'); if(lb)lb.style.display='none'; });
  $('amInfoClose')?.addEventListener('click', _hideInfo);
  $('amContactsList')?.addEventListener('click', e => { const c = e.target.closest('.am-contact'); if(c) _openChat(c.dataset.peer); });
  $('amMessages')?.addEventListener('click', _handleMsgClick);
  $('amStaging')?.addEventListener('click', e => { const b=e.target.closest('[data-cancel]'); if(b){const t=b.dataset.cancel; if(t==='file')_cancelFile(); if(t==='reply'){_replyTo=null;_renderStaging();} if(t==='audio')_cancelAudio(); if(t==='recording')_stopRecording();} });
  $('amUserInfoModal')?.addEventListener('click', e => { if(e.target.id==='amUserInfoModal')_hideInfo(); const ab=e.target.closest('[data-chat-name]'); if(ab){_hideInfo();} const cb=e.target.closest('#amInfoCloseBtn'); if(cb)_hideInfo(); });
}

async function _refresh() {
  _convs = D.buildConversations(_all, _me);
  const newMeta = await D.hydratePeerMeta(_convs);
  newMeta.forEach((v,k) => _meta.set(k,v));
  _populateFilters();
  _renderContacts();
  if (_activePeer) _renderMessages();
}

function _populateFilters() {
  const plazas = new Set(), roles = new Set();
  _meta.forEach(m => { if(m.plaza) plazas.add(m.plaza); if(m.rol) roles.add(m.rol); });
  const pSel = document.getElementById('amFilterPlaza');
  const rSel = document.getElementById('amFilterRol');
  if (pSel) { const v=pSel.value; pSel.innerHTML='<option value="">Todas plazas</option>'+[...plazas].sort().map(p=>`<option value="${R.esc(p)}">${R.esc(p)}</option>`).join(''); pSel.value=v; }
  if (rSel) { const v=rSel.value; rSel.innerHTML='<option value="">Todos roles</option>'+[...roles].sort().map(r=>`<option value="${R.esc(r)}">${R.esc(r)}</option>`).join(''); rSel.value=v; }
}

function _renderContacts() {
  const list = document.getElementById('amContactsList');
  const hint = document.getElementById('amContactsHint');
  const toggle = document.getElementById('amArchiveToggle');
  if (!list) return;
  const term = (document.getElementById('amSearch')?.value || '').trim().toLowerCase();
  const plaza = (document.getElementById('amFilterPlaza')?.value || '').toUpperCase();
  const rol = (document.getElementById('amFilterRol')?.value || '').toUpperCase();
  const statusF = (document.getElementById('amFilterStatus')?.value || '');
  const hasFilters = !!(term || plaza || rol || statusF);
  if (toggle) toggle.textContent = _archivedMode ? '← Buzón' : 'Archivados';
  let filtered = _convs.filter(c => {
    const m = _meta.get(c.peerEmail) || {};
    const isArch = D.isConversationArchived(_archived, c.peerKey, D.msgTs(c.last));
    if (_archivedMode) return isArch;
    if (isArch) return false;
    if (plaza && (m.plaza||'') !== plaza) return false;
    if (rol && (m.rol||'') !== rol) return false;
    if (statusF === 'UNREAD' && !c.unread) return false;
    if (term) {
      const searchable = [c.displayLabel, c.peerEmail, m.plaza, m.rol, m.nombre].join(' ').toLowerCase();
      if (!searchable.includes(term)) return false;
    }
    return true;
  });
  const archCount = _convs.filter(c => D.isConversationArchived(_archived, c.peerKey, D.msgTs(c.last))).length;
  if (hint) {
    if (_archivedMode) hint.textContent = `${filtered.length} archivado${filtered.length===1?'':'s'}`;
    else hint.textContent = `${filtered.length} conversación${filtered.length===1?'':'es'}${archCount?' · '+archCount+' archivado'+(archCount===1?'':'s'):''}`;
  }
  if (!filtered.length) { list.innerHTML = R.renderEmptyContacts(_archivedMode, hasFilters); return; }
  list.innerHTML = filtered.map(c => {
    const m = _meta.get(c.peerEmail);
    const isArch = D.isConversationArchived(_archived, c.peerKey, D.msgTs(c.last));
    return R.renderContactItem(c, m, c.peerKey === _activePeer, isArch);
  }).join('');
}

function _openChat(peerKey) {
  _activePeer = peerKey;
  _replyTo = null; _cancelFile(); _cancelAudio();
  const conv = _convs.find(c => c.peerKey === peerKey);
  const header = document.getElementById('amChatHeader');
  const msgs = document.getElementById('amMessages');
  const input = document.getElementById('amInputBar');
  const empty = document.getElementById('amEmptyState');
  const archBtn = document.getElementById('amArchiveBtn');
  if (empty) empty.style.display = 'none';
  if (header) header.style.display = 'flex';
  if (msgs) msgs.style.display = 'flex';
  if (input) input.style.display = 'flex';
  if (archBtn) archBtn.style.display = 'flex';
  // Mobile: slide in
  const chat = document.getElementById('amChat');
  if (window.innerWidth <= 768 && chat) chat.classList.add('open');
  // Update header
  const name = conv?.displayLabel || peerKey.replace(/^(EMAIL|LEGACY):/,'');
  document.getElementById('amChatName').textContent = name;
  document.getElementById('amChatAvatar').textContent = R.initials(name);
  const m = _meta.get(conv?.peerEmail);
  document.getElementById('amChatStatus').textContent = m ? `${m.rol||''} · ${m.plaza||''}` : 'Conversación segura';
  // Mark read
  const idsToMark = [];
  _all.forEach(msg => {
    if (!msg.esMio && !msg.leido) {
      const pk = D.getPeerKey(msg, _me);
      if (pk === peerKey) { msg.leido = true; idsToMark.push(msg.id); }
    }
  });
  if (idsToMark.length) D.marcarMensajesLeidosArray(idsToMark).catch(e => console.error(e));
  _renderMessages();
  _renderContacts();
  const inp = document.getElementById('amInput');
  if (inp) { inp.value = ''; inp.style.height = 'auto'; inp.focus(); }
}

function _closeChat() {
  _activePeer = null;
  const header = document.getElementById('amChatHeader');
  const msgs = document.getElementById('amMessages');
  const input = document.getElementById('amInputBar');
  const empty = document.getElementById('amEmptyState');
  const archBtn = document.getElementById('amArchiveBtn');
  if (empty) empty.style.display = 'flex';
  if (header) header.style.display = 'none';
  if (msgs) msgs.style.display = 'none';
  if (input) input.style.display = 'none';
  if (archBtn) archBtn.style.display = 'none';
  const chat = document.getElementById('amChat');
  if (chat) chat.classList.remove('open');
  _renderContacts();
}

function _renderMessages() {
  const container = document.getElementById('amMessages');
  if (!container || !_activePeer) return;
  const history = _all.filter(m => D.getPeerKey(m, _me) === _activePeer).reverse();
  if (!history.length) {
    const name = _activePeer.replace(/^(EMAIL|LEGACY):/,'');
    container.innerHTML = `<div class="am-chat-start"><span class="material-icons">chat_bubble_outline</span>Inicio de la conversación con ${R.esc(name)}<br><br>Escribe un mensaje.</div>`;
    return;
  }
  container.innerHTML = history.map(m => R.renderMessage(m, _me.display)).join('');
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 40);
}

function _handleMsgClick(e) {
  // Lightbox
  const img = e.target.closest('[data-lightbox]');
  if (img) { const lb=document.getElementById('amLightbox'); const lbi=document.getElementById('amLightboxImg'); const dl=document.getElementById('amLightboxDl'); if(lb&&lbi){lbi.src=img.dataset.lightbox; if(dl)dl.href=img.dataset.lightbox; lb.style.display='flex';} return; }
  // Reply
  const reply = e.target.closest('.am-reply-btn');
  if (reply) { _startReply(reply.dataset.mid); return; }
  // Reaction add
  const addR = e.target.closest('.am-add-react');
  if (addR) { _showEmojiPicker(addR); return; }
  // Reaction toggle
  const reactBtn = e.target.closest('.am-react-btn');
  if (reactBtn) { _toggleReaction(reactBtn.dataset.mid, reactBtn.dataset.emoji); return; }
  // Edit/Delete
  const opt = e.target.closest('.am-opt-btn');
  if (opt) { if(opt.dataset.action==='edit') _editMsg(opt.dataset.mid); else if(opt.dataset.action==='delete') _deleteMsg(opt.dataset.mid); }
}

function _startReply(mIdSafe) {
  const msg = _all.find(m => String(m.id).replace(/[^a-zA-Z0-9_-]/g,'_') === mIdSafe);
  if (!msg) return;
  _replyTo = { id: msg.id, remitente: msg.remitente, mensaje: msg.mensaje };
  _renderStaging();
  document.getElementById('amInput')?.focus();
}

async function _editMsg(mIdSafe) {
  const msg = _all.find(m => String(m.id).replace(/[^a-zA-Z0-9_-]/g,'_') === mIdSafe);
  if (!msg) return;
  const newText = await _mexPrompt('Editar mensaje', 'Edita tu mensaje:', 'Mensaje', 'text', msg.mensaje || '');
  if (newText && newText !== msg.mensaje) {
    msg.mensaje = newText; _renderMessages();
    try { await D.editarMensajeChatDb(String(msg.id), newText); } catch(e) { console.error(e); }
  }
}

async function _deleteMsg(mIdSafe) {
  const msg = _all.find(m => String(m.id).replace(/[^a-zA-Z0-9_-]/g,'_') === mIdSafe);
  if (!msg) return;
  if (!await _mexConfirm('Borrar mensaje', '¿Borrar este mensaje para todos?', 'danger')) return;
  _all = _all.filter(m => m.id !== msg.id); _renderMessages();
  try { await D.eliminarMensajeChatDb(String(msg.id)); } catch(e) { console.error(e); }
}

function _ensureEmojiPickerElement() {
  if (window.customElements?.get('emoji-picker')) return Promise.resolve();
  if (!_emojiPickerImport) {
    _emojiPickerImport = import(EMOJI_PICKER_SRC).catch(error => {
      _emojiPickerImport = null;
      throw error;
    });
  }
  return _emojiPickerImport;
}

async function _showEmojiPicker(btn) {
  const mId = btn.dataset.mid;
  let panel = document.getElementById('amEmojiPanel');
  if (panel) { panel.remove(); }
  panel = document.createElement('div');
  panel.id = 'amEmojiPanel';
  panel.className = 'am-emoji-panel';
  panel.innerHTML = '<div class="am-emoji-loading">Cargando emojis...</div>';
  btn.closest('.am-bubble')?.appendChild(panel);
  setTimeout(() => { document.addEventListener('click', function _dismiss(ev) { if(!panel.contains(ev.target)){panel.remove();document.removeEventListener('click',_dismiss);} }, {once:false}); },10);
  try {
    await _ensureEmojiPickerElement();
    if (!panel.isConnected) return;
    const picker = document.createElement('emoji-picker');
    picker.className = 'am-emoji-picker';
    picker.setAttribute('locale', 'es');
    picker.setAttribute('skin-tone-emoji', '👍');
    picker.addEventListener('emoji-click', event => {
      const emoji = event?.detail?.unicode || event?.detail?.emoji?.unicode || event?.detail?.emoji || '';
      if (!emoji) return;
      _toggleReaction(mId, emoji);
      panel.remove();
    });
    panel.replaceChildren(picker);
  } catch (error) {
    console.warn('[mensajes] emoji picker', error);
    if (panel.isConnected) {
      panel.innerHTML = '<div class="am-emoji-loading am-emoji-loading--error">No se pudo cargar el selector de emojis.</div>';
    }
  }
}

async function _toggleReaction(mIdSafe, emoji) {
  const msg = _all.find(m => String(m.id).replace(/[^a-zA-Z0-9_-]/g,'_') === mIdSafe);
  if (!msg) return;
  if (!msg.reacciones) msg.reacciones = {};
  if (!msg.reacciones[emoji]) msg.reacciones[emoji] = [];
  const idx = msg.reacciones[emoji].indexOf(_me.display);
  if (idx === -1) msg.reacciones[emoji].push(_me.display);
  else { msg.reacciones[emoji].splice(idx, 1); if(!msg.reacciones[emoji].length) delete msg.reacciones[emoji]; }
  _renderMessages();
  try { await D.actualizarReaccionesChatDb(String(msg.id), msg.reacciones); } catch(e) { console.warn(e); }
}

function _toggleArchive() {
  if (!_activePeer) return;
  const conv = _convs.find(c => c.peerKey === _activePeer);
  if (!conv) return;
  const ts = D.msgTs(conv.last);
  if (D.isConversationArchived(_archived, _activePeer, ts)) {
    delete _archived[_activePeer];
  } else {
    _archived[_activePeer] = ts;
  }
  D.saveArchived(_me.email, _archived);
  _closeChat();
}

function _showPeerInfo() {
  const conv = _convs.find(c => c.peerKey === _activePeer);
  const m = _meta.get(conv?.peerEmail) || { nombre: conv?.displayLabel, email: conv?.peerEmail };
  const modal = document.getElementById('amUserInfoModal');
  const content = document.getElementById('amInfoContent');
  if (content) content.innerHTML = R.renderContactInfo(m);
  if (modal) modal.classList.add('active');
}

function _hideInfo() { document.getElementById('amUserInfoModal')?.classList.remove('active'); }

async function _openNewChat() {
  const name = await _mexPrompt('Nuevo chat', 'Escribe el nombre o correo del usuario:', 'Nombre o correo', 'text', '');
  if (!name?.trim()) return;
  const identity = D.getCanonicalMessageIdentity(name.trim());
  _activePeer = identity.key;
  const fakeConv = { peerKey: identity.key, peerEmail: identity.email, displayLabel: identity.label, preferredHandle: identity.raw, last: null, total: 0, unread: 0 };
  if (!_convs.find(c => c.peerKey === identity.key)) _convs.unshift(fakeConv);
  _openChat(identity.key);
}

// ── Send ──────────────────────────────────────────────────
async function _send() {
  const input = document.getElementById('amInput');
  const txt = (input?.value || '').trim();
  if (!txt && !_pendingFile && !_pendingAudio) return;
  if (!_activePeer) return;
  // Resolve peer handle
  const conv = _convs.find(c => c.peerKey === _activePeer);
  const dest = conv?.preferredHandle || _activePeer.replace(/^(EMAIL|LEGACY):/,'');
  if (input) { input.value = ''; input.style.height = 'auto'; }
  const capturedReply = _replyTo ? { ..._replyTo } : null;
  // Unarchive if needed
  if (_archived[_activePeer]) { delete _archived[_activePeer]; D.saveArchived(_me.email, _archived); }
  // Upload file/audio
  let archivoUrl = null, archivoNombre = null;
  try {
    if (_pendingFile) {
      const r = await D.uploadChatFile(_pendingFile.file);
      archivoUrl = r.url; archivoNombre = r.name;
    } else if (_pendingAudio) {
      const r = await D.uploadChatAudio(_pendingAudio.blob, _pendingAudio.mimeType, _pendingAudio.extension);
      archivoUrl = r.url; archivoNombre = r.name;
    }
  } catch(e) { console.error('Upload error:', e); return; }
  _clearStaging();
  // Optimistic local message
  const now = new Date();
  const tempDate = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const local = { id: Date.now(), fecha: tempDate, timestamp: Date.now(), remitente: _me.display, destinatario: dest, mensaje: txt, leido: false, esMio: true, replyTo: capturedReply || undefined };
  if (archivoUrl) { local.archivoUrl = archivoUrl; local.archivoNombre = archivoNombre; }
  _all.unshift(local);
  _refresh();
  D.enviarMensajePrivado(_me.display, dest, txt, archivoUrl, archivoNombre, capturedReply).catch(e => console.error(e));
}

// ── File staging ──────────────────────────────────────────
async function _stageFile(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  const err = A.validateFile(file);
  if (err) { await _mexAlert('Archivo no válido', err, 'warning'); inputEl.value = ''; return; }
  const isImg = A.isImageFile(file.name);
  _pendingFile = { file, isImg, previewUrl: isImg ? URL.createObjectURL(file) : null };
  _renderStaging();
  inputEl.value = '';
}

function _cancelFile() {
  if (_pendingFile?.previewUrl) URL.revokeObjectURL(_pendingFile.previewUrl);
  _pendingFile = null; _renderStaging();
}

function _cancelAudio() {
  if (_pendingAudio?.localUrl) URL.revokeObjectURL(_pendingAudio.localUrl);
  _pendingAudio = null; _renderStaging();
}

function _clearStaging() {
  _cancelFile(); _cancelAudio(); _replyTo = null; _renderStaging();
}

function _renderStaging() {
  const area = document.getElementById('amStaging');
  if (!area) return;
  const chips = [];
  const isRec = _recorder?.state === 'recording';
  if (isRec) chips.push(R.renderStagingChip('recording'));
  if (_replyTo) chips.push(R.renderStagingChip('reply', _replyTo));
  if (_pendingFile) chips.push(R.renderStagingChip('file', _pendingFile));
  if (_pendingAudio) chips.push(R.renderStagingChip('audio', _pendingAudio));
  area.innerHTML = chips.join('');
  area.classList.toggle('active', chips.length > 0);
  if (isRec) { _drawSpectrum(); _startRecTimer(); }
}

// ── Audio recording ───────────────────────────────────────
async function _toggleRecording() {
  if (_recorder?.state === 'recording') { _stopRecording(); return; }
  if (typeof window.MediaRecorder === 'undefined') { await _mexAlert('Audio no compatible', 'Tu navegador no soporta grabación de audio.', 'warning'); return; }
  try {
    const stream = await A.getUserMediaAudio();
    const mimeType = A.audioMimeType();
    const chunks = [];
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { _audioCtx = new AC(); _analyser = _audioCtx.createAnalyser(); _analyser.fftSize = 64; _audioCtx.createMediaStreamSource(stream).connect(_analyser); }
    } catch(_) { _audioCtx = null; _analyser = null; }
    _recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    _recorder.ondataavailable = ev => { if (ev.data.size > 0) chunks.push(ev.data); };
    _recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (_audioCtx) { _audioCtx.close(); _audioCtx = null; }
      if (_specRaf) { cancelAnimationFrame(_specRaf); _specRaf = null; }
      if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
      const micBtn = document.getElementById('amMicBtn');
      if (micBtn) micBtn.classList.remove('recording');
      if (!chunks.length) return;
      const fallback = /iphone|ipad|safari/i.test(navigator.userAgent) ? 'audio/mp4' : 'audio/webm';
      const finalMime = _recorder?.mimeType || chunks[0]?.type || mimeType || fallback;
      const blob = new Blob(chunks, { type: finalMime });
      if (!blob.size || blob.size > 10*1024*1024) return;
      if (_pendingAudio?.localUrl) URL.revokeObjectURL(_pendingAudio.localUrl);
      _pendingAudio = { blob, localUrl: URL.createObjectURL(blob), mimeType: finalMime, extension: A.audioExtFromMime(finalMime) };
      _renderStaging();
    };
    _recorder.start(300);
    document.getElementById('amMicBtn')?.classList.add('recording');
    _renderStaging();
  } catch(err) { console.error(err); await _mexAlert('Micrófono no disponible', 'No se pudo acceder al micrófono.', 'error'); }
}

function _stopRecording(silent) {
  if (_recorder?.state === 'recording') {
    try { _recorder.requestData?.(); } catch(_) {}
    _recorder.stop();
  }
  if (_specRaf) { cancelAnimationFrame(_specRaf); _specRaf = null; }
  if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
}

function _drawSpectrum() {
  const canvas = document.getElementById('amSpectrum');
  if (!canvas || !_analyser) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const buf = new Uint8Array(_analyser.frequencyBinCount);
  function draw() {
    _specRaf = requestAnimationFrame(draw);
    _analyser.getByteFrequencyData(buf);
    ctx.clearRect(0, 0, W, H);
    const bw = Math.floor(W / buf.length);
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i] / 255; const h = v * H;
      ctx.fillStyle = `rgb(${Math.round(239-v*80)},${Math.round(68+v*50)},68)`;
      ctx.fillRect(i * bw, H - h, bw - 1, h);
    }
  }
  draw();
}

function _startRecTimer() {
  if (_recTimer) clearInterval(_recTimer);
  const start = Date.now();
  _recTimer = setInterval(() => {
    const el = document.getElementById('amRecTimer');
    if (!el) { clearInterval(_recTimer); return; }
    const s = Math.floor((Date.now() - start) / 1000);
    el.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  }, 500);
}
