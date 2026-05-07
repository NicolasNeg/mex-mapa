import { getState } from '/js/app/app-state.js';
import { obtenerMensajesPrivados, enviarMensajePrivado, marcarMensajesLeidosArray } from '/js/core/database.js';
import { db, COL } from '/js/core/database.js';

let _container = null;
let _state = null;
let _offGlobalSearch = null;
let _refreshTimer = null;
const _REFRESH_MS = 45000;
let _msgCssInjected = false;
let _mounted = false;
let _loadSeq = 0;

function _ensureMensajesCss() {
  if (_msgCssInjected) return;
  if (document.querySelector('link[data-msg-app-css]')) { _msgCssInjected = true; return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-mensajes.css';
  link.setAttribute('data-msg-app-css', '1');
  document.head.appendChild(link);
  _msgCssInjected = true;
}

function _debugMsg(...args) {
  try {
    if (localStorage.getItem('mex.debug.mode') !== '1') return;
    console.log('[app/mensajes]', ...args);
  } catch (err) {
    console.warn('[app/mensajes] debug unavailable', err);
  }
}

function _isAlive(seq) {
  return _mounted && !!_state && !!_container && seq === _loadSeq;
}

function q(sel) { return _container?.querySelector(sel) || null; }
function _up(v) { return String(v || '').trim().toUpperCase(); }
function _norm(v) { return String(v || '').trim(); }
function _normEmail(v) {
  const x = String(v || '').trim().toLowerCase();
  return x && x.includes('@') ? x : '';
}

function _canonicalFrom(raw, explicitEmail = '') {
  const email = _normEmail(explicitEmail) || _normEmail(raw);
  if (email) return { key: `EMAIL:${email}`, email, label: email.toUpperCase(), raw: _up(raw) };
  const norm = _up(raw);
  return { key: `LEGACY:${norm}`, email: '', label: norm || 'USUARIO', raw: norm };
}

/** Identidad canónica para agrupar mensajes y conversaciones (prioriza email en metadatos). */
function getCanonicalMessageIdentity(raw, explicitEmail = '') {
  return _canonicalFrom(raw, explicitEmail);
}

/** Etiqueta para UI a partir de un lado canónico (`_canonicalFrom`). */
function getDisplayIdentity(side) {
  if (!side) return '—';
  if (side.email) return side.email.toUpperCase();
  return side.label || side.raw || '—';
}

function _buildMyIdentity(profile) {
  const aliases = new Set(
    [profile?.nombre, profile?.usuario, profile?.nombreCompleto, profile?.email]
      .map(_up)
      .filter(Boolean)
  );
  const email = _normEmail(profile?.email);
  const emailUpper = email ? email.toUpperCase() : '';
  if (emailUpper) aliases.add(emailUpper);
  const display = _up(profile?.nombre || profile?.nombreCompleto || profile?.usuario || emailUpper || 'USUARIO');
  return {
    email,
    display,
    aliases,
    queryIdentities: [...aliases]
  };
}

function _isMineSide(side) {
  if (!_state?.me) return false;
  if (side.email && _state.me.email && side.email === _state.me.email) return true;
  return _state.me.aliases.has(side.raw);
}

function _messageSides(msg) {
  const remitente = _canonicalFrom(msg?.remitente, msg?.remitenteEmail || msg?.remitente_email);
  const destinatario = _canonicalFrom(msg?.destinatario, msg?.destinatarioEmail || msg?.destinatario_email);
  return { remitente, destinatario };
}

function _messageMineAndPeer(msg) {
  const { remitente, destinatario } = _messageSides(msg);
  const remitIsMine = _isMineSide(remitente);
  const destIsMine = _isMineSide(destinatario);
  let mine = remitIsMine && !destIsMine;
  if (!remitIsMine && !destIsMine) mine = msg?.esMio === true;
  if (remitIsMine && destIsMine) mine = msg?.esMio === true;
  const peerSide = mine ? destinatario : remitente;
  return { mine, peerSide, remitente, destinatario };
}

export async function mount({ container }) {
  _cleanup();
  _mounted = true;
  _loadSeq += 1;
  _container = container;
  _ensureMensajesCss();
  const gs = getState();
  const profile = gs.profile || {};
  const me = _buildMyIdentity(profile);
  _state = {
    me,
    allMessages: [],
    conversations: [],
    filtered: [],
    peerMeta: new Map(),
    query: '',
    plazaFilter: '',
    roleFilter: '',
    statusFilter: '',
    selectedPeer: '',
    lastUpdated: 0,
    statusMessage: '',
    loading: false,
    sending: false
  };

  _container.innerHTML = _layout(me.display);
  _bindGlobalSearch();
  _bindActions();
  _loadMessages();
  if (_refreshTimer) {
    try { clearInterval(_refreshTimer); } catch (err) { console.warn('[app/mensajes] refresh cleanup', err); }
    _refreshTimer = null;
  }
  _refreshTimer = setInterval(() => {
    if (document.hidden || !_mounted || !_state || !_container) return;
    _loadMessages();
  }, _REFRESH_MS);
  _debugMsg('mount', { loadSeq: _loadSeq });
}

export function unmount() { _cleanup(); }

function _cleanup() {
  const wasMounted = _mounted;
  _mounted = false;
  _loadSeq += 1;
  if (typeof _offGlobalSearch === 'function') {
    try { _offGlobalSearch(); } catch (err) { console.warn('[app/mensajes] search cleanup', err); }
  }
  _offGlobalSearch = null;
  if (_refreshTimer) {
    try { clearInterval(_refreshTimer); } catch (err) { console.warn('[app/mensajes] refresh cleanup', err); }
    _refreshTimer = null;
  }
  _state = null;
  _container = null;
  if (wasMounted) _debugMsg('unmount', { loadSeq: _loadSeq });
}

function _bindActions() {
  q('#appMsgRefresh')?.addEventListener('click', () => _loadMessages());
  q('#appMsgPlazaFilter')?.addEventListener('change', e => {
    _state.plazaFilter = String(e.target.value || '').trim().toUpperCase();
    _applyFilters();
    _renderConversations();
  });
  q('#appMsgRoleFilter')?.addEventListener('change', e => {
    _state.roleFilter = String(e.target.value || '').trim().toUpperCase();
    _applyFilters();
    _renderConversations();
  });
  q('#appMsgStatusFilter')?.addEventListener('change', e => {
    _state.statusFilter = String(e.target.value || '').trim().toUpperCase();
    _applyFilters();
    _renderConversations();
  });
  q('#appMsgSendBtn')?.addEventListener('click', () => _sendMessage());
  q('#appMsgInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      _sendMessage();
    }
  });
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_state || !_container) return;
    const route = String(event?.detail?.route || '');
    if (!(route.startsWith('/app/mensajes') || route === '/mensajes')) return;
    _state.query = String(event?.detail?.query || '');
    _applyFilters();
    _renderConversations();
    _renderDetail();
  };
  window.addEventListener('mex:global-search', handler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', handler);
}

async function _loadMessages() {
  const seq = ++_loadSeq;
  if (!_isAlive(seq)) return;
  _debugMsg('load:start', { seq });
  _state.loading = true;
  _disableComposer(true);
  _setBodyLoading('Cargando conversaciones...');
  try {
    const rows = await _fetchMessagesForAllKnownIdentities(_state.me.queryIdentities);
    if (!_isAlive(seq)) return;
    _state.allMessages = Array.isArray(rows) ? rows : [];
    _state.lastUpdated = Date.now();
    _rebuildConversations();
    await _hydratePeerMeta(seq);
    if (!_isAlive(seq)) return;
    _applyFilters();
    _renderFilterOptions();
    _renderConversations();
    _renderDetail();
    _renderLastSync();
    _setText('#appMsgSendError', '');
    _setStatus('', '');
  } catch (err) {
    if (!_isAlive(seq)) return;
    _setBodyError(err?.message || 'No se pudieron cargar los mensajes.');
  } finally {
    if (!_isAlive(seq)) return;
    _state.loading = false;
    _disableComposer(false);
    _debugMsg('load:done', { seq });
  }
}

async function _fetchMessagesForAllKnownIdentities(identities = []) {
  const ids = Array.isArray(identities) && identities.length ? identities : [_state?.me?.display || ''];
  const uniqueRows = new Map();
  await Promise.all(ids.map(async identity => {
    const safeIdentity = _up(identity);
    if (!safeIdentity) return;
    try {
      const rows = await obtenerMensajesPrivados(safeIdentity);
      (Array.isArray(rows) ? rows : []).forEach(row => {
        const rowId = String(row?.id || '');
        if (!rowId) return;
        const current = uniqueRows.get(rowId);
        if (!current || _msgTs(row) > _msgTs(current)) uniqueRows.set(rowId, { ...row });
      });
    } catch (err) {
      console.warn('[app/mensajes] no se pudo cargar identidad', safeIdentity, err);
    }
  }));
  return Array.from(uniqueRows.values()).sort((a, b) => _msgTs(b) - _msgTs(a));
}

function _conversationByKey(key) {
  return (_state?.conversations || []).find(c => c.peerKey === key) || null;
}

async function _sendMessage() {
  if (!_state || _state.sending) return;
  const peerKey = String(_state.selectedPeer || '').trim();
  const convo = _conversationByKey(peerKey);
  const input = q('#appMsgInput');
  const text = _norm(input?.value || '');
  if (!_state.me?.display && !_state.me?.email) {
    _setText('#appMsgSendError', 'No se pudo identificar tu usuario para enviar.');
    return;
  }
  if (!peerKey || !convo) {
    _setText('#appMsgSendError', 'Selecciona una conversación válida.');
    return;
  }
  if (!text) {
    _setText('#appMsgSendError', 'Escribe un mensaje antes de enviar.');
    return;
  }

  const remitenteId = _state.me.email ? _state.me.email.toUpperCase() : _state.me.display;
  const destinatarioId = convo.preferredHandle || convo.peerEmail?.toUpperCase() || convo.displayLabel;
  if (!destinatarioId) {
    _setText('#appMsgSendError', 'Destinatario inválido. Abre mensajes clásico para corregir el contacto.');
    return;
  }

  _state.sending = true;
  _disableComposer(true);
  _setText('#appMsgSendError', '');
  try {
    await enviarMensajePrivado(remitenteId, destinatarioId, text, null, null, null, {
      remitenteEmail: _state.me.email || '',
      destinatarioEmail: convo.peerEmail || '',
      remitenteNombre: _state.me.display,
      destinatarioNombre: convo.displayLabel
    });
    if (input) input.value = '';
    await _loadMessages();
    if (!_mounted || !_state || !_container) return;
    _state.selectedPeer = peerKey;
    _renderConversations();
    _renderDetail();
    _setStatus('Mensaje enviado.', 'success');
  } catch (error) {
    _setText('#appMsgSendError', error?.message || 'No se pudo enviar el mensaje.');
  } finally {
    if (!_mounted || !_state || !_container) return;
    _state.sending = false;
    _disableComposer(false);
  }
}

function _disableComposer(disabled) {
  const canWrite = !disabled && !!_state?.selectedPeer;
  const input = q('#appMsgInput');
  const btn = q('#appMsgSendBtn');
  if (input) input.disabled = !canWrite;
  if (btn) btn.disabled = !canWrite;
}

function _messagePeerKey(msg) {
  return _messageMineAndPeer(msg).peerSide.key;
}

async function _markSelectedConversationRead() {
  const peerKey = String(_state?.selectedPeer || '').trim();
  if (!peerKey) return;
  const unreadIncomingIds = _state.allMessages
    .filter(msg => _messagePeerKey(msg) === peerKey)
    .filter(msg => {
      const s = _messageMineAndPeer(msg);
      return !s.mine && !msg.leido && msg.id;
    })
    .map(msg => msg.id);
  if (!unreadIncomingIds.length) return;
  try {
    await marcarMensajesLeidosArray(unreadIncomingIds);
  } catch (err) {
    _setStatus(err?.message || 'No se pudo marcar como leído.', 'error');
    return;
  }
  _state.allMessages = _state.allMessages.map(msg => (
    unreadIncomingIds.includes(msg.id) ? { ...msg, leido: true } : msg
  ));
}

function _rebuildConversations() {
  const byPeer = new Map();
  _state.allMessages.forEach(msg => {
    const { mine, peerSide } = _messageMineAndPeer(msg);
    const key = peerSide.key;
    if (!key) return;
    const displayLabel = _up(
      (peerSide.raw && !peerSide.raw.includes('@')) ? peerSide.raw : (peerSide.email || peerSide.raw)
    ) || peerSide.label;
    const preferredHandle = peerSide.raw || (peerSide.email ? peerSide.email.toUpperCase() : '');
    const prev = byPeer.get(key);
    if (!prev) {
      byPeer.set(key, {
        peerKey: key,
        peerEmail: peerSide.email || '',
        displayLabel,
        preferredHandle,
        last: { ...msg, esMio: mine },
        total: 1,
        unread: mine || msg.leido ? 0 : 1
      });
      return;
    }
    prev.total += 1;
    if (!mine && !msg.leido) prev.unread += 1;
    if (_msgTs(msg) >= _msgTs(prev.last)) {
      prev.last = { ...msg, esMio: mine };
      prev.displayLabel = displayLabel || prev.displayLabel;
      prev.preferredHandle = preferredHandle || prev.preferredHandle;
      prev.peerEmail = peerSide.email || prev.peerEmail;
    }
  });
  _state.conversations = Array.from(byPeer.values()).sort((a, b) => _msgTs(b.last) - _msgTs(a.last));
  if (!_state.selectedPeer && _state.conversations.length) _state.selectedPeer = _state.conversations[0].peerKey;
  if (_state.selectedPeer && !_state.conversations.some(c => c.peerKey === _state.selectedPeer)) {
    _state.selectedPeer = _state.conversations[0]?.peerKey || '';
  }
}

function _applyFilters() {
  const qx = _state.query.toLowerCase().trim();
  _state.filtered = _state.conversations.filter(c => {
    const meta = _state.peerMeta.get(c.peerEmail || '') || {};
    if (_state.plazaFilter && String(meta.plaza || '').toUpperCase() !== _state.plazaFilter) return false;
    if (_state.roleFilter && String(meta.rol || '').toUpperCase() !== _state.roleFilter) return false;
    if (_state.statusFilter) {
      if (_state.statusFilter === 'UNREAD' && !c.unread) return false;
      if (_state.statusFilter === 'ACTIVE' && String(meta.status || '').toUpperCase() && String(meta.status || '').toUpperCase() !== 'ACTIVO') return false;
      if (_state.statusFilter === 'INACTIVE' && String(meta.status || '').toUpperCase() !== 'INACTIVO') return false;
    }
    if (!qx) return true;
    const hay = `${c.peerKey} ${c.displayLabel} ${c.peerEmail} ${c.last?.mensaje || ''} ${c.last?.remitente || ''} ${c.last?.destinatario || ''} ${meta.plaza || ''} ${meta.rol || ''} ${meta.status || ''} ${_when(c.last)}`.toLowerCase();
    return hay.includes(qx);
  });
}

async function _hydratePeerMeta(seq = _loadSeq) {
  const emails = [...new Set((_state.conversations || []).map(c => String(c.peerEmail || '').trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) {
    if (!_isAlive(seq)) return;
    _state.peerMeta = new Map();
    return;
  }
  const next = new Map();
  for (const email of emails) {
    if (!_isAlive(seq)) return;
    try {
      const snap = await db.collection(COL.USERS).doc(email).get();
      if (!snap.exists) continue;
      const d = snap.data() || {};
      next.set(email, {
        plaza: String(d.plazaAsignada || d.plaza || '').toUpperCase(),
        rol: String(d.rol || '').toUpperCase(),
        status: String(d.status || '').toUpperCase(),
        nombre: String(d.nombre || d.nombreCompleto || '')
      });
    } catch (err) {
      console.warn('[app/mensajes] metadata usuario', email, err);
    }
  }
  if (!_isAlive(seq)) return;
  _state.peerMeta = next;
}

function _renderFilterOptions() {
  const plazaSel = q('#appMsgPlazaFilter');
  const roleSel = q('#appMsgRoleFilter');
  if (!plazaSel || !roleSel) return;
  const metas = [..._state.peerMeta.values()];
  const plazas = [...new Set(metas.map(m => m.plaza).filter(Boolean))].sort();
  const roles = [...new Set(metas.map(m => m.rol).filter(Boolean))].sort();
  plazaSel.innerHTML = `<option value="">Todas las plazas</option>${plazas.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}`;
  roleSel.innerHTML = `<option value="">Todos los roles</option>${roles.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}`;
  if (_state.plazaFilter) plazaSel.value = _state.plazaFilter;
  if (_state.roleFilter) roleSel.value = _state.roleFilter;
}

function _renderConversations() {
  const el = q('#appMsgList');
  if (!el) return;
  const unreadTotal = _state.conversations.reduce((acc, c) => acc + Number(c.unread || 0), 0);
  _setText('#appMsgUnread', unreadTotal ? `${unreadTotal} no leídos` : 'Sin no leídos');
  if (!_state.filtered.length) {
    el.innerHTML = `<div class="msgop__empty">Sin conversaciones para ese filtro.</div>`;
    return;
  }
  el.innerHTML = _state.filtered.map(c => `
    <button class="msgop__conversation ${c.peerKey === _state.selectedPeer ? 'is-active' : ''}" data-msg-peer="${esc(c.peerKey)}">
      <span class="msgop__avatar">${esc(_initials(c.displayLabel || c.peerEmail))}</span>
      <div class="msgop__conversation-main">
        <div class="msgop__conversation-top">
          <strong>${esc(c.displayLabel)}</strong>
          <span>${esc(_when(c.last))}</span>
        </div>
        ${c.peerEmail ? `<div class="msgop__email">${esc(c.peerEmail.toUpperCase())}</div>` : ''}
        <div class="msgop__meta">
          ${(() => {
            const m = _state.peerMeta.get(c.peerEmail || '') || {};
            const badge = [m.plaza, m.rol, m.status].filter(Boolean).join(' · ');
            return esc(badge || 'Sin metadata de perfil');
          })()}
        </div>
        <div class="msgop__last">${esc(c.last?.mensaje || '[Sin texto]')}</div>
        <div class="msgop__conversation-bottom">
          <span>${esc(c.total)} mensaje(s)</span>
          ${c.unread ? `<b class="msgop__unread">${c.unread}</b>` : '<span>Leído</span>'}
        </div>
      </div>
    </button>
  `).join('');

  el.querySelectorAll('[data-msg-peer]').forEach(btn => {
    btn.addEventListener('click', async () => {
      _state.selectedPeer = String(btn.dataset.msgPeer || '');
      await _markSelectedConversationRead();
      _rebuildConversations();
      _applyFilters();
      _renderConversations();
      _renderDetail();
    });
  });
}

function _renderDetail() {
  const box = q('#appMsgDetail');
  if (!box) return;
  const peerKey = _state.selectedPeer;
  const convo = _conversationByKey(peerKey);
  const display = convo?.displayLabel || '';
  const input = q('#appMsgInput');
  if (input) input.placeholder = display ? `Responder a ${display}...` : 'Selecciona una conversación para responder...';
  if (!peerKey || !convo) {
    box.innerHTML = `<div class="msgop__chat-empty"><strong>Selecciona una conversación</strong><span>La bandeja mantiene identidad canónica por email para no duplicar hilos cuando cambia el nombre visible.</span></div>`;
    _disableComposer(false);
    return;
  }
  const msgs = _state.allMessages
    .filter(m => _messagePeerKey(m) === peerKey)
    .map(m => ({ ...m, esMio: _messageMineAndPeer(m).mine }))
    .sort((a, b) => _msgTs(a) - _msgTs(b))
    .slice(-60);

  box.innerHTML = `
    <div class="msgop__chat-head">
      <span class="msgop__avatar msgop__avatar--large">${esc(_initials(display || convo.peerEmail))}</span>
      <div>
        <strong>${esc(display)}</strong>
        ${convo.peerEmail ? `<div>${esc(convo.peerEmail.toUpperCase())}</div>` : ''}
        <div>${(() => {
          const m = _state.peerMeta.get(convo.peerEmail || '') || {};
          const parts = [m.plaza, m.rol, m.status].filter(Boolean);
          return esc(parts.join(' · ') || 'Sin metadata de perfil');
        })()}</div>
      </div>
    </div>
    <div id="appMsgThread" class="msgop__thread">
      ${msgs.length ? msgs.map(m => {
        const mine = !!m.esMio;
        return `<div class="msgop__bubble ${mine ? 'is-mine' : 'is-other'}">
          <div>${esc(m.mensaje || '[Adjunto]')}</div>
          <span>${esc(_when(m))}${mine ? ` · ${m.leido ? 'Leído' : 'Enviado'}` : ''}</span>
        </div>`;
      }).join('') : `<div class="msgop__empty">Sin mensajes en esta conversación.</div>`}
    </div>
    <div class="msgop__blocked">
      <button type="button" disabled>Adjuntos disponibles en mensajes clásico</button>
      <a href="/mensajes?legacy=1">Abrir mensajes clásico</a>
    </div>
  `;
  const thread = q('#appMsgThread');
  if (thread) thread.scrollTop = thread.scrollHeight;
  _disableComposer(false);
}

function _msgTs(msg) {
  if (!msg) return 0;
  if (typeof msg.timestamp === 'number') return msg.timestamp;
  if (msg.timestamp?.seconds) return msg.timestamp.seconds * 1000;
  if (typeof msg.timestamp?.toMillis === 'function') return msg.timestamp.toMillis();
  const raw = new Date(msg.fecha || 0).getTime();
  return Number.isFinite(raw) ? raw : 0;
}

function _when(msg) {
  const ts = _msgTs(msg);
  if (!ts) return '—';
  return new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function _setBodyLoading(text) {
  const el = q('#appMsgList');
  if (el) el.innerHTML = `<div class="msgop__empty">${esc(text)}</div>`;
}

function _setBodyError(text) {
  const el = q('#appMsgList');
  if (el) el.innerHTML = `<div class="msgop__error">${esc(text)}</div>`;
}

function _setText(sel, text) {
  const el = q(sel);
  if (el) el.textContent = String(text || '');
}

function _layout(me) {
  return `
    <section class="msgop">
      <header class="msgop__top">
        <div>
          <span class="msgop__eyebrow">BANDEJA</span>
          <h1>Mensajes operativo</h1>
        </div>
        <div class="msgop__actions">
          <span class="msgop__pill">${esc(me)}</span>
          <span id="appMsgUnread" class="msgop__pill">Sin no leídos</span>
          <span id="appMsgLastSync" class="msgop__pill">Sin sincronizar</span>
          <button id="appMsgRefresh" type="button" class="msgop__btn">Refrescar</button>
          <a href="/mensajes?legacy=1" class="msgop__btn msgop__btn--primary">Mensajes clásico</a>
        </div>
      </header>
      <div id="appMsgStatus" class="msgop__status" hidden></div>
      <div class="msgop__filters">
        <select id="appMsgPlazaFilter" class="msgop__select">
          <option value="">Todas las plazas</option>
        </select>
        <select id="appMsgRoleFilter" class="msgop__select">
          <option value="">Todos los roles</option>
        </select>
        <select id="appMsgStatusFilter" class="msgop__select">
          <option value="">Todos</option>
          <option value="UNREAD">No leídos</option>
          <option value="ACTIVE">Activos</option>
          <option value="INACTIVE">Inactivos</option>
        </select>
      </div>
      <div id="appMsgGrid" class="msgop__grid">
        <aside id="appMsgList" class="msgop__list"></aside>
        <section id="appMsgDetail" class="msgop__chat"></section>
      </div>
      <div class="msgop__composer">
        <textarea id="appMsgInput" rows="2" placeholder="Selecciona una conversación para responder..."></textarea>
        <button id="appMsgSendBtn" type="button">Enviar</button>
      </div>
      <div id="appMsgSendError" class="msgop__send-error"></div>
    </section>
  `;
}

function _renderLastSync() {
  const text = _state?.lastUpdated
    ? `Última actualización ${new Date(_state.lastUpdated).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
    : 'Sin sincronizar';
  _setText('#appMsgLastSync', text);
}

function _setStatus(message, type = 'info') {
  const el = q('#appMsgStatus');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'msgop__status';
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.className = `msgop__status msgop__status--${type}`;
}

function _initials(value) {
  const parts = String(value || 'U').replace(/@.*/, '').split(/\s+|[._-]+/).filter(Boolean);
  return (parts[0]?.[0] || 'U').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
