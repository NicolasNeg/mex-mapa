import { getState } from '/js/app/app-state.js';
import { obtenerMensajesPrivados, enviarMensajePrivado, marcarMensajesLeidosArray } from '/js/core/database.js';

let _container = null;
let _state = null;
let _offGlobalSearch = null;

function q(sel) { return _container?.querySelector(sel) || null; }

export async function mount({ container }) {
  _cleanup();
  _container = container;
  const gs = getState();
  const profile = gs.profile || {};
  const me = _resolveIdentity(profile);
  _state = {
    me,
    allMessages: [],
    conversations: [],
    filtered: [],
    query: '',
    selectedPeer: '',
    loading: false,
    sending: false
  };

  _container.innerHTML = _layout(me);
  _bindGlobalSearch();
  _bindActions();
  _loadMessages();
}

export function unmount() {
  _cleanup();
}

function _cleanup() {
  if (typeof _offGlobalSearch === 'function') {
    try { _offGlobalSearch(); } catch (_) {}
  }
  _offGlobalSearch = null;
  _state = null;
  _container = null;
}

function _resolveIdentity(profile) {
  const raw = profile?.nombre || profile?.usuario || profile?.nombreCompleto || profile?.email || 'USUARIO';
  return String(raw).trim().toUpperCase();
}

function _bindActions() {
  q('#appMsgRefresh')?.addEventListener('click', () => {
    _loadMessages();
  });
  q('#appMsgSendBtn')?.addEventListener('click', () => {
    _sendMessage();
  });
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
    const query = String(event?.detail?.query || '');
    _state.query = query;
    _applyFilters();
    _renderConversations();
    _renderDetail();
  };
  window.addEventListener('mex:global-search', handler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', handler);
}

async function _loadMessages() {
  if (!_state || !_container) return;
  _state.loading = true;
  _disableComposer(true);
  _setBodyLoading('Cargando conversaciones...');
  try {
    const rows = await obtenerMensajesPrivados(_state.me);
    if (!_state || !_container) return;
    _state.allMessages = Array.isArray(rows) ? rows : [];
    _rebuildConversations();
    _applyFilters();
    _renderConversations();
    _renderDetail();
    _setText('#appMsgSendError', '');
  } catch (err) {
    _setBodyError(err?.message || 'No se pudieron cargar los mensajes.');
  } finally {
    _state.loading = false;
    _disableComposer(false);
  }
}

async function _sendMessage() {
  if (!_state || _state.sending) return;
  const peer = String(_state.selectedPeer || '').trim().toUpperCase();
  const input = q('#appMsgInput');
  const text = String(input?.value || '').trim();
  if (!peer || !text) return;
  _state.sending = true;
  _disableComposer(true);
  _setText('#appMsgSendError', '');
  try {
    await enviarMensajePrivado(_state.me, peer, text);
    if (input) input.value = '';
    await _loadMessages();
    _state.selectedPeer = peer;
    _renderConversations();
    _renderDetail();
  } catch (error) {
    _setText('#appMsgSendError', error?.message || 'No se pudo enviar el mensaje.');
  } finally {
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

async function _markSelectedConversationRead() {
  const peer = String(_state?.selectedPeer || '').trim().toUpperCase();
  if (!peer) return;
  const unreadIncomingIds = _state.allMessages
    .filter(msg => {
      const remitente = String(msg.remitente || '').trim().toUpperCase();
      const destinatario = String(msg.destinatario || '').trim().toUpperCase();
      const isPeerThread = remitente === peer || destinatario === peer;
      return isPeerThread && !msg.esMio && !msg.leido && msg.id;
    })
    .map(msg => msg.id);
  if (!unreadIncomingIds.length) return;
  await marcarMensajesLeidosArray(unreadIncomingIds).catch(() => {});
  _state.allMessages = _state.allMessages.map(msg => (
    unreadIncomingIds.includes(msg.id) ? { ...msg, leido: true } : msg
  ));
}

function _rebuildConversations() {
  const byPeer = new Map();
  _state.allMessages.forEach(msg => {
    const remitente = String(msg.remitente || '').toUpperCase().trim();
    const destinatario = String(msg.destinatario || '').toUpperCase().trim();
    const peer = msg.esMio ? destinatario : remitente;
    if (!peer) return;
    const prev = byPeer.get(peer);
    if (!prev) {
      byPeer.set(peer, { peer, last: msg, total: 1, unread: msg.esMio || msg.leido ? 0 : 1 });
      return;
    }
    prev.total += 1;
    if (!msg.esMio && !msg.leido) prev.unread += 1;
    if (_msgTs(msg) > _msgTs(prev.last)) prev.last = msg;
  });
  _state.conversations = Array.from(byPeer.values()).sort((a, b) => _msgTs(b.last) - _msgTs(a.last));
  if (!_state.selectedPeer && _state.conversations.length) _state.selectedPeer = _state.conversations[0].peer;
  if (_state.selectedPeer && !_state.conversations.some(c => c.peer === _state.selectedPeer)) {
    _state.selectedPeer = _state.conversations[0]?.peer || '';
  }
}

function _applyFilters() {
  const qx = _state.query.toLowerCase().trim();
  if (!qx) {
    _state.filtered = [..._state.conversations];
    return;
  }
  _state.filtered = _state.conversations.filter(c => {
    const hay = `${c.peer} ${c.last?.mensaje || ''} ${c.last?.remitente || ''} ${c.last?.destinatario || ''} ${_when(c.last)}`.toLowerCase();
    return hay.includes(qx);
  });
}

function _renderConversations() {
  const el = q('#appMsgList');
  if (!el) return;
  const unreadTotal = _state.conversations.reduce((acc, c) => acc + Number(c.unread || 0), 0);
  _setText('#appMsgUnread', unreadTotal ? `${unreadTotal} no leídos` : 'Sin no leídos');
  if (!_state.filtered.length) {
    el.innerHTML = `<div style="padding:20px;color:#94a3b8;font-size:12px;">Sin conversaciones para ese filtro.</div>`;
    return;
  }
  el.innerHTML = _state.filtered.map(c => `
    <button data-msg-peer="${esc(c.peer)}" style="width:100%;text-align:left;border:1px solid ${c.peer === _state.selectedPeer ? '#cbd5e1' : '#e2e8f0'};background:${c.peer === _state.selectedPeer ? '#f8fafc' : '#fff'};border-radius:10px;padding:10px;cursor:pointer;">
      <div style="display:flex;align-items:center;gap:8px;">
        <strong style="font-size:12px;color:#0f172a;">${esc(c.peer)}</strong>
        <span style="margin-left:auto;font-size:10px;color:#94a3b8;">${esc(_when(c.last))}</span>
      </div>
      <div style="margin-top:4px;font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.last?.mensaje || '[Sin texto]')}</div>
      <div style="margin-top:4px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <span style="font-size:10px;color:#94a3b8;">${esc(c.total)} mensaje(s)</span>
        ${c.unread ? `<span style="font-size:10px;background:#fee2e2;color:#b91c1c;padding:2px 7px;border-radius:999px;font-weight:800;">${c.unread}</span>` : ''}
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
  const peer = _state.selectedPeer;
  const input = q('#appMsgInput');
  if (input) input.placeholder = peer ? `Responder a ${peer}...` : 'Selecciona una conversación para responder...';
  if (!peer) {
    box.innerHTML = `<div style="padding:14px;color:#94a3b8;font-size:12px;">Selecciona una conversación.</div>`;
    _disableComposer(false);
    return;
  }
  const msgs = _state.allMessages
    .filter(m => {
      const r = String(m.remitente || '').toUpperCase().trim();
      const d = String(m.destinatario || '').toUpperCase().trim();
      return (r === peer || d === peer);
    })
    .sort((a, b) => _msgTs(a) - _msgTs(b))
    .slice(-60);

  box.innerHTML = `
    <div style="padding:12px;border-bottom:1px solid #eef2f7;">
      <strong style="font-size:13px;color:#0f172a;">${esc(peer)}</strong>
      <div style="font-size:11px;color:#64748b;margin-top:2px;">Conversación real · envío simple</div>
    </div>
    <div style="max-height:54vh;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;">
      ${msgs.length ? msgs.map(m => {
        const mine = !!m.esMio;
        return `<div style="align-self:${mine ? 'flex-end' : 'flex-start'};max-width:85%;background:${mine ? '#dcfce7' : '#f1f5f9'};border:1px solid ${mine ? '#bbf7d0' : '#e2e8f0'};border-radius:10px;padding:8px 10px;">
          <div style="font-size:12px;color:#1e293b;line-height:1.45;">${esc(m.mensaje || '[Adjunto]')}</div>
          <div style="margin-top:4px;font-size:10px;color:#64748b;">${esc(_when(m))}</div>
        </div>`;
      }).join('') : `<div style="font-size:12px;color:#94a3b8;">Sin mensajes en esta conversación.</div>`}
    </div>
    <div style="padding:12px;border-top:1px solid #eef2f7;">
      <a href="/mensajes" style="font-size:12px;color:#0f172a;text-decoration:underline;">Abrir mensajes completos</a>
    </div>
  `;
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
  if (el) el.innerHTML = `<div style="padding:20px;color:#64748b;font-size:12px;">${esc(text)}</div>`;
}

function _setBodyError(text) {
  const el = q('#appMsgList');
  if (el) el.innerHTML = `<div style="padding:20px;color:#b91c1c;font-size:12px;">${esc(text)}</div>`;
}

function _setText(sel, text) {
  const el = q(sel);
  if (el) el.textContent = String(text || '');
}

function _layout(me) {
  return `
    <div style="padding:20px;max-width:1080px;margin:0 auto;font-family:Inter,sans-serif;">
      <style>
        @media (max-width: 767px) {
          #appMsgGrid { grid-template-columns: minmax(0, 1fr); }
        }
      </style>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
        <h1 style="margin:0;font-size:24px;color:#0f172a;">Mensajes</h1>
        <span style="font-size:11px;color:#64748b;background:#e2e8f0;border-radius:999px;padding:3px 9px;">${esc(me)}</span>
        <span id="appMsgUnread" style="font-size:11px;color:#334155;background:#e2e8f0;border-radius:999px;padding:3px 9px;">Sin no leídos</span>
        <button id="appMsgRefresh" type="button" style="border:1px solid #dbe3ef;border-radius:8px;background:#fff;color:#334155;padding:6px 10px;font-size:12px;cursor:pointer;">Refrescar</button>
        <a href="/mensajes" style="margin-left:auto;font-size:12px;color:#0f172a;">Abrir mensajes completos</a>
      </div>
      <div id="appMsgGrid" style="display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:12px;">
        <aside id="appMsgList" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;max-height:70vh;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px;"></aside>
        <section id="appMsgDetail" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;min-height:200px;"></section>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:flex-start;">
        <textarea id="appMsgInput" rows="2" placeholder="Selecciona una conversación para responder..." style="flex:1;border:1px solid #dbe3ef;border-radius:10px;padding:8px 10px;resize:vertical;min-height:42px;font-family:Inter,sans-serif;font-size:12px;"></textarea>
        <button id="appMsgSendBtn" type="button" style="border:none;border-radius:10px;background:#0f172a;color:#fff;padding:10px 12px;font-size:12px;font-weight:700;cursor:pointer;">Enviar</button>
      </div>
      <div id="appMsgSendError" style="margin-top:6px;font-size:11px;color:#b91c1c;"></div>
    </div>
  `;
}

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
