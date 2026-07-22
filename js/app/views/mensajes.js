// js/app/views/mensajes.js — Full App Shell mensajes view
import { getState } from '/js/app/app-state.js';
import * as D from '/js/app/features/mensajes/mensajes-data.js';
import * as A from '/js/app/features/mensajes/mensajes-attachments.js';
import * as R from '/js/app/features/mensajes/mensajes-renderer.js';

let _unsub = null, _me = null, _all = [], _convs = [], _meta = new Map();
let _allUsers = [];
let _identityDirectory = D.buildIdentityDirectory([]);
let _directoryReady = false;
let _activePeer = null, _archivedMode = false, _archived = {};
let _pendingFile = null, _pendingAudio = null, _replyTo = null;
let _recorder = null, _audioCtx = null, _analyser = null, _specRaf = null, _recTimer = null;
let _emojiPickerImport = null;
let _cssLink = null;
let _offGlobalSearch = null;
let _pendingDeepLinkPeer = "";
let _mountGeneration = 0;

const EMOJI_PICKER_SRC = 'https://cdn.jsdelivr.net/npm/emoji-picker-element@1/index.js';
const PEER_PREFIX_RE = /^(UID|EMAIL|LEGACY):/;

function _peerValue(peerKey) {
  return String(peerKey || '').replace(PEER_PREFIX_RE, '');
}

function _lookupAlias(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function _enrichMyIdentityFromDirectory(users) {
  const before = JSON.stringify(_me?.queryIdentities || []);
  const mine = D.getCanonicalMessageIdentity(_me?.display, _me?.email, _identityDirectory, _me?.uid);
  const queryIdentities = new Set(_me?.queryIdentities || []);
  const aliases = new Set(_me?.aliases || []);

  users.forEach(user => {
    if (_identityForUser(user).key !== mine.key) return;
    [user.authUid, user.uid, user.email, user.id, user.nombre, user.nombreCompleto, user.usuario]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .forEach(value => {
        queryIdentities.add(value === _me.uid ? value : value.toUpperCase());
        aliases.add(_lookupAlias(value));
      });
  });

  _me = {
    ..._me,
    key: mine.key,
    uid: mine.uid || _me.uid,
    aliases,
    queryIdentities: [...queryIdentities]
  };
  return before !== JSON.stringify(_me.queryIdentities);
}

function _identityForUser(user) {
  const email = D.normalizeEmail(user?.email || user?.id);
  const uid = String(user?.authUid || user?.uid || '').trim();
  const raw = String(user?.nombre || user?.nombreCompleto || user?.usuario || email || user?.id || uid).trim();
  return D.getCanonicalMessageIdentity(raw, email, _identityDirectory, uid);
}

function _identityFromPeerKey(peerKey) {
  const key = String(peerKey || '').trim();
  const value = _peerValue(key);
  if (key.startsWith('UID:')) return D.getCanonicalMessageIdentity(value, '', _identityDirectory, value);
  if (key.startsWith('EMAIL:')) return D.getCanonicalMessageIdentity(value, value, _identityDirectory);
  return D.getCanonicalMessageIdentity(value, '', _identityDirectory);
}

const _mexAlert = (titulo, texto, tipo = 'info') =>
  typeof window.mexAlert === 'function' ? window.mexAlert(titulo, texto, tipo) : Promise.resolve(true);
const _mexConfirm = (titulo, texto, tipo = 'warning') =>
  typeof window.mexConfirm === 'function' ? window.mexConfirm(titulo, texto, tipo) : Promise.resolve(false);
const _mexPrompt = (titulo, texto, placeholder = '', inputTipo = 'text', valor = '') =>
  typeof window.mexPrompt === 'function' ? window.mexPrompt(titulo, texto, placeholder, inputTipo, valor) : Promise.resolve(null);

function _toast(msg, type = 'error') {
  const root = document.getElementById('appRoot') || document.body;
  let host = document.getElementById('mexAppToastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'mexAppToastHost';
    host.style.cssText = 'position:fixed;bottom:20px;right:16px;z-index:260;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    root.appendChild(host);
  }
  const el = document.createElement('div');
  const tone = type === 'error' ? 'background:#fee2e2;border:1px solid #fecaca;' : 'background:#fef9c3;border:1px solid #fde047;';
  el.style.cssText = `pointer-events:auto;padding:11px 14px;border-radius:10px;font-size:13px;font-weight:600;max-width:min(360px,calc(100vw - 32px));box-shadow:0 10px 30px rgba(2,6,23,.18);color:#0f172a;${tone}`;
  el.textContent = String(msg || 'Error desconocido');
  host.appendChild(el);
  setTimeout(() => { try { el.remove(); } catch (_) {} }, 4200);
}

function _ensureCss() {
  if (_cssLink && document.contains(_cssLink)) return;
  _cssLink = document.querySelector('link[data-app-mensajes-css="1"]');
  if (_cssLink) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-mensajes.css';
  link.setAttribute('data-app-mensajes-css', '1');
  document.head.appendChild(link);
  _cssLink = link;
}

export async function mount(ctx) {
  const mountGeneration = ++_mountGeneration;
  const container = ctx.container || document.querySelector('#routeMainStage') || document.body;
  _ensureCss();
  const { profile } = getState();
  _me = D.buildMyIdentity(profile);
  _directoryReady = false;
  _archived = D.loadArchived(_me.email);
  container.innerHTML = R.shellLayout(_me.display);
  _bindEvents(container);
  _captureNotificationDeepLink();
  _unsub = D.startRealtimeListener(_me, msgs => {
    if (mountGeneration !== _mountGeneration) return;
    _all = msgs;
    _refresh();
  });
  // Load full user directory in background for cross-plaza search
  D.getAllUsers().then(async users => {
    if (mountGeneration !== _mountGeneration) return;
    _allUsers = users;
    _identityDirectory = D.buildIdentityDirectory([
      ...users,
      { ...profile, authUid: _me.uid || profile?.authUid || profile?.uid || '' }
    ]);
    _directoryReady = true;
    const listenerAliasesChanged = _enrichMyIdentityFromDirectory(users);
    const previousArchived = _archived;
    _archived = D.canonicalizeArchivedConversations(_archived, _identityDirectory);
    if (JSON.stringify(previousArchived) !== JSON.stringify(_archived)) {
      D.saveArchived(_me.email, _archived);
    }
    if (_activePeer) _activePeer = D.canonicalizePeerKey(_activePeer, _identityDirectory);
    if (listenerAliasesChanged) {
      _unsub?.();
      _unsub = D.startRealtimeListener(_me, msgs => {
        if (mountGeneration !== _mountGeneration) return;
        _all = msgs;
        _refresh();
      });
    }
    if (mountGeneration !== _mountGeneration) return;
    await _refresh();
  }).catch(err => {
    if (mountGeneration !== _mountGeneration) return;
    console.error('[mensajes] No se pudo cargar el directorio', err);
    _toast('No se pudo verificar el directorio de contactos.');
  });
  const searchHandler = event => {
    const route = String(event?.detail?.route || '');
    if (!(route.startsWith('/app/mensajes') || route === '/mensajes')) return;
    const q = String(event?.detail?.query || '').trim();
    const input = document.getElementById('amSearch');
    if (input) { input.value = q; _renderContacts(); }
  };
  window.addEventListener('mex:global-search', searchHandler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', searchHandler);
}

export function unmount() {
  _mountGeneration += 1;
  _unsub?.(); _unsub = null; _stopRecording(true);
  try { _offGlobalSearch?.(); } catch (_) {}
  _offGlobalSearch = null;
  if (_pendingFile?.previewUrl) URL.revokeObjectURL(_pendingFile.previewUrl);
  if (_pendingAudio?.localUrl) URL.revokeObjectURL(_pendingAudio.localUrl);
  _all = []; _convs = []; _meta = new Map(); _allUsers = [];
  _identityDirectory = D.buildIdentityDirectory([]);
  _directoryReady = false;
  _activePeer = null; _pendingFile = null; _pendingAudio = null; _replyTo = null;
  _pendingDeepLinkPeer = "";
}

function _captureNotificationDeepLink() {
  try {
    const re = new RegExp('^/app/mensajes/c/([^/?#]+)', 'i');
    const match = String(window.location.pathname || '').match(re);
    if (match) {
      _pendingDeepLinkPeer = decodeURIComponent(match[1] || '').trim();
      return;
    }
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('notif') !== 'chat') return;
    const chatUser = params.get('chatUser') || params.get('user') || '';
    _pendingDeepLinkPeer = String(chatUser || '').trim();
  } catch (_) {
    _pendingDeepLinkPeer = '';
  }
}

function _clearNotificationDeepLinkQuery() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    if (params.get("notif") !== "chat") return;
    params.delete("notif");
    params.delete("chatUser");
    params.delete("user");
    const query = params.toString();
    history.replaceState({}, "", window.location.pathname + (query ? "?" + query : "") + (window.location.hash || ""));
  } catch (_) {}
}

function _conversationRouteParam(peerKey) {
  const conv = _convs.find(c => c.peerKey === peerKey);
  return String(conv?.peerEmail || conv?.preferredHandle || _peerValue(peerKey) || '').trim();
}

function _syncConversationRoute(peerKey) {
  try {
    const raw = _conversationRouteParam(peerKey);
    if (!raw) return;
    const next = '/app/mensajes/c/' + encodeURIComponent(raw);
    if (window.location.pathname === next && !window.location.search) return;
    history.replaceState({}, '', next + (window.location.hash || ''));
  } catch (_) {}
}

function _resolveDeepLinkPeerKey(rawPeer) {
  const raw = String(rawPeer || "").trim();
  if (!raw) return "";
  const identity = D.getCanonicalMessageIdentity(raw, '', _identityDirectory);
  const rawUp = raw.toUpperCase();
  const rawEmail = D.normalizeEmail(raw);

  const conv = _convs.find(c => {
    const values = [
      c.peerKey,
      c.peerUid,
      c.peerEmail,
      c.displayLabel,
      c.preferredHandle,
      c.last?.remitente,
      c.last?.destinatario,
      c.last?.remitenteUid,
      c.last?.destinatarioUid,
      c.last?.remitenteEmail,
      c.last?.destinatarioEmail
    ].map(v => String(v || "").trim());
    if (values.includes(identity.key)) return true;
    if (rawEmail && values.some(v => v.toLowerCase() === rawEmail)) return true;
    return values.some(v => v.toUpperCase() === rawUp);
  });
  if (conv?.peerKey) return conv.peerKey;

  if (_allUsers.length) {
    const rawLower = raw.toLowerCase();
    const user = _allUsers.find(u => {
      const values = [u.id, u.email, u.authUid, u.uid, u.nombre, u.nombreCompleto, u.usuario]
        .map(v => String(v || '').trim())
        .filter(Boolean);
      return values.some(v => v.toLowerCase() === rawLower || v.toUpperCase() === rawUp);
    });
    if (user) {
      const email = D.normalizeEmail(user.email || user.id);
      const name = String(user.nombre || user.nombreCompleto || user.usuario || raw).trim();
      const uid = String(user.authUid || user.uid || '').trim();
      return D.getCanonicalMessageIdentity(name, email, _identityDirectory, uid).key;
    }
  }

  return identity.key;
}

function _consumeNotificationDeepLink() {
  if (!_pendingDeepLinkPeer) return;
  const peerKey = _resolveDeepLinkPeerKey(_pendingDeepLinkPeer);
  if (!peerKey) return;
  _pendingDeepLinkPeer = "";
  _openChat(peerKey);
  _clearNotificationDeepLinkQuery();
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
  const activeDraft = _activePeer
    ? _convs.find(conversation => conversation.peerKey === _activePeer && !conversation.last)
    : null;
  if (_activePeer) _activePeer = D.canonicalizePeerKey(_activePeer, _identityDirectory);
  _convs = D.buildConversations(_all, _me, _identityDirectory);
  if (activeDraft && !_convs.some(conversation => conversation.peerKey === _activePeer)) {
    _convs.unshift({ ...activeDraft, peerKey: _activePeer });
  }
  const newMeta = await D.hydratePeerMeta(_convs);
  newMeta.forEach((v,k) => _meta.set(k,v));
  _populateFilters();
  if (_activePeer) _syncActiveChatIdentity();
  _renderContacts();
  if (_activePeer) _renderMessages();
  _consumeNotificationDeepLink();
}

function _populateFilters() {
  const plazas = new Set(), roles = new Set();
  // Prefer full user directory for filter options; fallback to conversation meta
  const source = _allUsers.length ? _allUsers : null;
  if (source) {
    source.forEach(u => {
      const p = String(u.plazaAsignada || u.plaza || '').toUpperCase();
      const r = String(u.rol || '').toUpperCase();
      if (p) plazas.add(p);
      if (r) roles.add(r);
    });
  } else {
    _meta.forEach(m => { if(m.plaza) plazas.add(m.plaza); if(m.rol) roles.add(m.rol); });
  }
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
  // Directory contacts: users from _allUsers not already in conversations, matching active filter
  let directoryItems = [];
  if (hasFilters && !_archivedMode && _allUsers.length) {
    const existingKeys = new Set(_convs.map(c => c.peerKey).filter(Boolean));
    const directorySeen = new Set();
    const myEmail = (_me?.email || '').toLowerCase();
    directoryItems = _allUsers.map(user => ({ user, identity: _identityForUser(user) })).filter(({ user: u, identity }) => {
      const email = String(identity.email || '').toLowerCase();
      if ((!email && !identity.uid) || email === myEmail || identity.key === _me?.key) return false;
      if (existingKeys.has(identity.key)) return false;
      if (directorySeen.has(identity.key)) return false;
      const uPlaza = String(u.plazaAsignada || u.plaza || '').toUpperCase();
      const uRol   = String(u.rol || '').toUpperCase();
      const uNombre = String(identity.label || '').toLowerCase();
      if (plaza && uPlaza !== plaza) return false;
      if (rol && uRol !== rol) return false;
      if (term) {
        const searchable = [uNombre, email, uPlaza, uRol].join(' ');
        if (!searchable.includes(term)) return false;
      }
      directorySeen.add(identity.key);
      return true;
    });
  }

  if (!filtered.length && !directoryItems.length) { list.innerHTML = R.renderEmptyContacts(_archivedMode, hasFilters); return; }

  const convHtml = filtered.map(c => {
    const m = _meta.get(c.peerEmail);
    const isArch = D.isConversationArchived(_archived, c.peerKey, D.msgTs(c.last));
    return R.renderContactItem(c, m, c.peerKey === _activePeer, isArch);
  });
  const dirHtml = directoryItems.map(({ user, identity }) => R.renderDirectoryContact(user, identity.key === _activePeer, identity));
  list.innerHTML = [...convHtml, ...dirHtml].join('');
}

function _openChat(peerKey) {
  peerKey = D.canonicalizePeerKey(peerKey, _identityDirectory);
  _activePeer = peerKey;
  _replyTo = null; _cancelFile(); _cancelAudio();
  let conv = _convs.find(c => c.peerKey === peerKey);
  // Directory contact (no previous conversation) — create a fakeConv so the sidebar stays consistent
  if (!conv) {
    const dirUser = _allUsers.find(user => _identityForUser(user).key === peerKey);
    const identity = dirUser ? _identityForUser(dirUser) : _identityFromPeerKey(peerKey);
    const label = identity.label || identity.email?.toUpperCase() || identity.raw || 'USUARIO';
    const preferredHandle = identity.email ? identity.email.toUpperCase() : (identity.raw || identity.uid);
    conv = { peerKey: identity.key, peerUid: identity.uid, peerEmail: identity.email, displayLabel: label, preferredHandle, last: null, total: 0, unread: 0 };
    _activePeer = identity.key;
    _convs.unshift(conv);
  }
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
  _syncActiveChatIdentity();
  _renderMessages();
  _renderContacts();
  const inp = document.getElementById('amInput');
  if (inp) { inp.value = ''; inp.style.height = 'auto'; inp.focus(); }
  _syncConversationRoute(_activePeer);
}

function _syncActiveChatIdentity() {
  if (!_activePeer) return;
  const conv = _convs.find(c => c.peerKey === _activePeer);
  const name = conv?.displayLabel || _peerValue(_activePeer);
  const nameEl = document.getElementById('amChatName');
  const avatarEl = document.getElementById('amChatAvatar');
  const statusEl = document.getElementById('amChatStatus');
  if (nameEl) nameEl.textContent = name;
  if (avatarEl) avatarEl.textContent = R.initials(name);
  const meta = _meta.get(conv?.peerEmail);
  if (statusEl) statusEl.textContent = meta ? `${meta.rol||''} · ${meta.plaza||''}` : 'Canal interno';

  const idsToMark = [];
  _all.forEach(msg => {
    const mine = D.isMessageMine(msg, _me, _identityDirectory);
    msg.esMio = mine;
    if (!mine && !msg.leido) {
      const pk = D.getPeerKey(msg, _me, _identityDirectory);
      if (pk === _activePeer) { msg.leido = true; idsToMark.push(msg.id); }
    }
  });
  if (idsToMark.length) {
    if (conv) conv.unread = 0;
    D.marcarMensajesLeidosArray(idsToMark).catch(e => console.error(e));
  }
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
  const history = _all
    .filter(m => D.getPeerKey(m, _me, _identityDirectory) === _activePeer)
    .map(m => ({ ...m, esMio: D.isMessageMine(m, _me, _identityDirectory) }))
    .reverse();
  if (!history.length) {
    const name = _convs.find(c => c.peerKey === _activePeer)?.displayLabel || _peerValue(_activePeer);
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
    try { await D.editarMensajeChatDb(String(msg.id), newText); } catch(e) { _toast('No se pudo editar el mensaje.'); }
  }
}

async function _deleteMsg(mIdSafe) {
  const msg = _all.find(m => String(m.id).replace(/[^a-zA-Z0-9_-]/g,'_') === mIdSafe);
  if (!msg) return;
  if (!await _mexConfirm('Borrar mensaje', '¿Borrar este mensaje para todos?', 'danger')) return;
  _all = _all.filter(m => m.id !== msg.id); _renderMessages();
  try { await D.eliminarMensajeChatDb(String(msg.id)); } catch(e) { _toast('No se pudo eliminar el mensaje.'); }
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

  // Anclar al body para que no se corte por overflow de contenedores padres
  document.body.appendChild(panel);

  // Posicionar debajo del botón; si no cabe abajo, abrir arriba
  const r   = btn.getBoundingClientRect();
  const pw  = Math.min(360, window.innerWidth - 32);
  const ph  = Math.min(420, window.innerHeight * 0.7);
  const gap = 6;
  let top  = r.bottom + gap;
  let left = r.right - pw;
  if (left < 8) left = 8;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  // Si no cabe abajo → abrir arriba
  if (top + ph > window.innerHeight - 8) top = r.top - ph - gap;
  if (top < 8) top = 8;
  Object.assign(panel.style, { top: `${top}px`, left: `${left}px` });

  setTimeout(() => { document.addEventListener('click', function _dismiss(ev) { if(!panel.contains(ev.target) && ev.target !== btn){panel.remove();document.removeEventListener('click',_dismiss);} }, {once:false}); },10);
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
  if (!_directoryReady && !D.normalizeEmail(name)) {
    await _mexAlert('Directorio no disponible', 'No se pudo verificar ese nombre. Busca el contacto por correo.', 'warning');
    return;
  }
  const identity = D.getCanonicalMessageIdentity(name.trim(), '', _identityDirectory);
  const requestedAlias = _lookupAlias(name);
  const matchingKeys = new Set(_allUsers.filter(user => [
    user.id,
    user.email,
    user.nombre,
    user.nombreCompleto,
    user.usuario
  ].some(value => _lookupAlias(value) === requestedAlias)).map(user => _identityForUser(user).key));
  if (matchingKeys.size > 1) {
    await _mexAlert('Contacto ambiguo', 'Hay más de un usuario con ese nombre. Busca el contacto por correo.', 'warning');
    return;
  }
  if (identity.key.startsWith('LEGACY:')) {
    await _mexAlert('Contacto no verificado', 'Selecciona un contacto del directorio o escribe su correo.', 'warning');
    return;
  }
  _activePeer = identity.key;
  const preferredHandle = identity.email ? identity.email.toUpperCase() : (identity.raw || identity.uid);
  const fakeConv = { peerKey: identity.key, peerUid: identity.uid, peerEmail: identity.email, displayLabel: identity.label, preferredHandle, last: null, total: 0, unread: 0 };
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
  const peerIdentity = conv
    ? { uid: conv.peerUid || '', email: conv.peerEmail || '', label: conv.displayLabel || '', raw: conv.preferredHandle || '' }
    : _identityFromPeerKey(_activePeer);
  const dest = peerIdentity.email
    ? peerIdentity.email.toUpperCase()
    : (conv?.preferredHandle || peerIdentity.raw || _peerValue(_activePeer));
  const senderHandle = _me.email ? _me.email.toUpperCase() : _me.display;
  const messageIdentity = {
    remitenteUid: _me.uid || '',
    remitenteEmail: _me.email || '',
    remitenteNombre: _me.display,
    destinatarioUid: peerIdentity.uid || '',
    destinatarioEmail: peerIdentity.email || '',
    destinatarioNombre: peerIdentity.label || conv?.displayLabel || dest
  };
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
  } catch(e) { _toast('No se pudo subir el archivo.'); return; }
  _clearStaging();
  // Optimistic local message
  const now = new Date();
  const localId = `tmp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const tempDate = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const local = {
    id: localId,
    fecha: tempDate,
    timestamp: Date.now(),
    remitente: senderHandle,
    destinatario: dest,
    mensaje: txt,
    leido: false,
    esMio: true,
    replyTo: capturedReply || undefined,
    ...messageIdentity
  };
  if (archivoUrl) { local.archivoUrl = archivoUrl; local.archivoNombre = archivoNombre; }
  _all.unshift(local);
  _refresh();
  try {
    await D.enviarMensajePrivado(senderHandle, dest, txt, archivoUrl, archivoNombre, capturedReply, messageIdentity);
  } catch (e) {
    console.error(e);
    _all = _all.filter(message => message.id !== localId);
    _refresh();
    _toast('No se pudo enviar el mensaje.');
  }
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
