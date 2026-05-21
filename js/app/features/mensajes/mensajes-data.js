// ═══════════════════════════════════════════════════════════
//  js/app/features/mensajes/mensajes-data.js
//  Data layer for App Shell Mensajes — real-time Firestore
//  listeners, canonical identity, conversation grouping.
// ═══════════════════════════════════════════════════════════

import { db, COL,
  obtenerMensajesPrivados,
  enviarMensajePrivado,
  marcarMensajesLeidosArray,
  actualizarReaccionesChatDb,
  editarMensajeChatDb,
  eliminarMensajeChatDb
} from '/js/core/database.js';

function _eid() {
  const ctx = window._empresaActual;
  if (!ctx || ctx.isSuperAdminContext) return '';
  return ctx.id || '';
}

// ── Canonical identity helpers ────────────────────────────

export function normalizeEmail(v) {
  const x = String(v || '').trim().toLowerCase();
  return x && x.includes('@') ? x : '';
}

function _up(v) { return String(v || '').trim().toUpperCase(); }

export function getCanonicalMessageIdentity(raw, explicitEmail = '') {
  const email = normalizeEmail(explicitEmail) || normalizeEmail(raw);
  if (email) return { key: `EMAIL:${email}`, email, label: email.toUpperCase(), raw: _up(raw) };
  const norm = _up(raw);
  return { key: `LEGACY:${norm}`, email: '', label: norm || 'USUARIO', raw: norm };
}

export function getDisplayIdentity(side) {
  if (!side) return '—';
  if (side.email) return side.email.toUpperCase();
  return side.label || side.raw || '—';
}

export function buildMyIdentity(profile) {
  const aliases = new Set(
    [profile?.nombre, profile?.usuario, profile?.nombreCompleto, profile?.email]
      .map(_up)
      .filter(Boolean)
  );
  const email = normalizeEmail(profile?.email);
  const emailUpper = email ? email.toUpperCase() : '';
  if (emailUpper) aliases.add(emailUpper);
  const display = _up(profile?.nombre || profile?.nombreCompleto || profile?.usuario || emailUpper || 'USUARIO');
  return { email, display, aliases, queryIdentities: [...aliases] };
}

export function getMessageSideIdentity(msg) {
  const remitente = getCanonicalMessageIdentity(msg?.remitente, msg?.remitenteEmail || msg?.remitente_email);
  const destinatario = getCanonicalMessageIdentity(msg?.destinatario, msg?.destinatarioEmail || msg?.destinatario_email);
  return { remitente, destinatario };
}

export function isMessageMine(msg, me) {
  if (!me) return false;
  const { remitente, destinatario } = getMessageSideIdentity(msg);
  const remitIsMine = _isMineSide(remitente, me);
  const destIsMine = _isMineSide(destinatario, me);
  let mine = remitIsMine && !destIsMine;
  if (!remitIsMine && !destIsMine) mine = msg?.esMio === true;
  if (remitIsMine && destIsMine) mine = msg?.esMio === true;
  return mine;
}

function _isMineSide(side, me) {
  if (side.email && me.email && side.email === me.email) return true;
  return me.aliases.has(side.raw);
}

export function getPeerKey(msg, me) {
  const { remitente, destinatario } = getMessageSideIdentity(msg);
  const mine = isMessageMine(msg, me);
  return (mine ? destinatario : remitente).key;
}

export function getPeerSide(msg, me) {
  const { remitente, destinatario } = getMessageSideIdentity(msg);
  const mine = isMessageMine(msg, me);
  return mine ? destinatario : remitente;
}

// ── Timestamp helpers ─────────────────────────────────────

export function msgTs(msg) {
  if (!msg) return 0;
  if (typeof msg.timestamp === 'number') return msg.timestamp;
  if (msg.timestamp?.seconds) return msg.timestamp.seconds * 1000;
  if (typeof msg.timestamp?.toMillis === 'function') return msg.timestamp.toMillis();
  const raw = new Date(msg.fecha || 0).getTime();
  return Number.isFinite(raw) ? raw : 0;
}

export function formatMsgTime(msg) {
  const ts = msgTs(msg);
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });
}

export function formatMsgTimeShort(msg) {
  const ts = msgTs(msg);
  if (!ts) return '';
  const parts = String(msg?.fecha || '').split(' ');
  return parts.length > 1 ? parts[1] : new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// ── Message snippet ───────────────────────────────────────

export function messageSnippet(msg) {
  if (!msg) return '';
  if (msg.archivoUrl) {
    const fileName = String(msg.archivoNombre || '').trim();
    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(fileName)) return 'Foto adjunta';
    if (/\.(ogg|mp3|wav|m4a|webm)$/i.test(fileName)) return 'Audio adjunto';
    return fileName ? `Archivo: ${fileName}` : 'Archivo adjunto';
  }
  const text = String(msg.mensaje || '').trim();
  return text || 'Toca para chatear';
}

// ── Realtime listener ─────────────────────────────────────

export function startRealtimeListener(me, callback) {
  const identities = me.queryIdentities;
  const unsubs = [];
  const buckets = { sent: [], recv: [] };

  function _merge() {
    const seen = new Set();
    const all = [...buckets.sent, ...buckets.recv]
      .filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
      .sort((a, b) => msgTs(b) - msgTs(a))
      .map(m => ({
        ...m,
        esMio: isMessageMine(m, me),
        leido: m.leido === true || m.leido === 'SI'
      }));
    callback(all);
  }

  const eid = _eid();

  // Listen for all identities the user may have
  for (const identity of identities) {
    const safeId = _up(identity);
    if (!safeId) continue;

    let q1 = db.collection('mensajes').where('remitente', '==', safeId);
    if (eid) q1 = q1.where('empresaId', '==', eid);
    unsubs.push(
      q1.orderBy('timestamp', 'desc').limit(300)
        .onSnapshot(snap => {
          const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          // Merge into sent bucket, keeping unique by id
          const existing = new Set(rows.map(r => r.id));
          buckets.sent = [
            ...buckets.sent.filter(r => !existing.has(r.id)),
            ...rows
          ];
          _merge();
        }, err => console.error('[mensajes-data] sent listener', safeId, err))
    );

    let q2 = db.collection('mensajes').where('destinatario', '==', safeId);
    if (eid) q2 = q2.where('empresaId', '==', eid);
    unsubs.push(
      q2.orderBy('timestamp', 'desc').limit(300)
        .onSnapshot(snap => {
          const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          const existing = new Set(rows.map(r => r.id));
          buckets.recv = [
            ...buckets.recv.filter(r => !existing.has(r.id)),
            ...rows
          ];
          _merge();
        }, err => console.error('[mensajes-data] recv listener', safeId, err))
    );
  }

  return () => { unsubs.forEach(u => u && u()); };
}

// ── Conversation builder ──────────────────────────────────

export function buildConversations(allMessages, me) {
  const byPeer = new Map();
  allMessages.forEach(msg => {
    const peer = getPeerSide(msg, me);
    const key = peer.key;
    if (!key) return;
    const mine = isMessageMine(msg, me);
    const displayLabel = _up(
      (peer.raw && !peer.raw.includes('@')) ? peer.raw : (peer.email || peer.raw)
    ) || peer.label;
    const preferredHandle = peer.raw || (peer.email ? peer.email.toUpperCase() : '');
    const prev = byPeer.get(key);
    if (!prev) {
      byPeer.set(key, {
        peerKey: key,
        peerEmail: peer.email || '',
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
    if (msgTs(msg) >= msgTs(prev.last)) {
      prev.last = { ...msg, esMio: mine };
      prev.displayLabel = displayLabel || prev.displayLabel;
      prev.preferredHandle = preferredHandle || prev.preferredHandle;
      prev.peerEmail = peer.email || prev.peerEmail;
    }
  });
  return Array.from(byPeer.values()).sort((a, b) => msgTs(b.last) - msgTs(a.last));
}

// ── Peer metadata hydration ───────────────────────────────

export async function hydratePeerMeta(conversations) {
  const emails = [...new Set(conversations.map(c => String(c.peerEmail || '').trim().toLowerCase()).filter(Boolean))];
  const meta = new Map();
  for (const email of emails) {
    try {
      const snap = await db.collection(COL.USERS).doc(email).get();
      if (!snap.exists) continue;
      const d = snap.data() || {};
      meta.set(email, {
        plaza: String(d.plazaAsignada || d.plaza || '').toUpperCase(),
        rol: String(d.rol || '').toUpperCase(),
        status: String(d.status || '').toUpperCase(),
        nombre: String(d.nombre || d.nombreCompleto || ''),
        telefono: String(d.telefono || ''),
        avatarUrl: String(d.avatarUrl || d.photoURL || d.fotoURL || d.profilePhotoUrl || ''),
        email: email
      });
    } catch (err) {
      console.warn('[mensajes-data] metadata', email, err);
    }
  }
  return meta;
}

// ── Archive helpers (localStorage) ────────────────────────

const ARCHIVE_PREFIX = 'mex:chat:archived';

function _archiveKey(meEmail) {
  return `${ARCHIVE_PREFIX}:${_up(meEmail || 'anon')}`;
}

export function loadArchived(meEmail) {
  try {
    const raw = localStorage.getItem(_archiveKey(meEmail));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveArchived(meEmail, archived) {
  try {
    const entries = Object.entries(archived).filter(([k, v]) => k && v);
    if (!entries.length) { localStorage.removeItem(_archiveKey(meEmail)); return; }
    localStorage.setItem(_archiveKey(meEmail), JSON.stringify(Object.fromEntries(entries)));
  } catch { /* noop */ }
}

export function isConversationArchived(archived, peerKey, lastTs) {
  const archivedAt = archived[peerKey];
  return Boolean(archivedAt && lastTs && lastTs <= archivedAt);
}

// ── API wrappers (re-export) ──────────────────────────────

export {
  obtenerMensajesPrivados,
  enviarMensajePrivado,
  marcarMensajesLeidosArray,
  actualizarReaccionesChatDb,
  editarMensajeChatDb,
  eliminarMensajeChatDb
};

// ── File upload to Storage ────────────────────────────────

export async function uploadChatFile(file) {
  const ts = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ref = firebase.storage().ref(`mensajes_chat/${ts}-${safeName}`);
  const snap = await ref.put(file);
  const url = await snap.ref.getDownloadURL();
  return { url, name: file.name };
}

export async function uploadChatAudio(blob, mimeType, extension) {
  const ts = Date.now();
  const fname = `audio_${ts}.${extension}`;
  const ref = firebase.storage().ref(`mensajes_chat/${ts}-${fname}`);
  const snap = await ref.put(blob, { contentType: mimeType });
  const url = await snap.ref.getDownloadURL();
  return { url, name: fname };
}

// ── Get all users for new-conversation picker ─────────────

export async function getAllUsers() {
  try {
    const eid = _eid();
    let q = db.collection(COL.USERS);
    if (eid) q = q.where('empresaId', '==', eid);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('[mensajes-data] getAllUsers', err);
    return [];
  }
}
