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
import {
  normalizeEmail,
  getCanonicalMessageIdentity,
  getDisplayIdentity,
  buildMyIdentity,
  getMessageSideIdentity,
  isMessageMine,
  getPeerKey,
  getPeerSide,
  buildIdentityDirectory,
  canonicalizePeerKey,
  canonicalizeArchivedConversations
} from '/domain/mensajes-identity.model.js';

function _up(v) { return String(v || '').trim().toUpperCase(); }

export {
  normalizeEmail,
  getCanonicalMessageIdentity,
  getDisplayIdentity,
  buildMyIdentity,
  getMessageSideIdentity,
  isMessageMine,
  getPeerKey,
  getPeerSide,
  buildIdentityDirectory,
  canonicalizePeerKey,
  canonicalizeArchivedConversations
};

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
  return text || 'Abrir conversación';
}

// ── Realtime listener ─────────────────────────────────────

export function startRealtimeListener(me, callback) {
  const identities = me.queryIdentities;
  const unsubs = [];
  const buckets = { sent: new Map(), recv: new Map() };

  function _merge() {
    const seen = new Set();
    const all = [...buckets.sent.values(), ...buckets.recv.values()].flat()
      .filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
      .sort((a, b) => msgTs(b) - msgTs(a))
      .map(m => ({
        ...m,
        esMio: isMessageMine(m, me),
        leido: m.leido === true || m.leido === 'SI'
      }));
    callback(all);
  }


  // Listen for all identities the user may have
  for (const identity of identities) {
    const safeId = me.uid && identity === me.uid ? identity : _up(identity);
    if (!safeId) continue;

    let q1 = db.collection('mensajes').where('remitente', '==', safeId);
    unsubs.push(
      q1.orderBy('timestamp', 'desc').limit(300)
        .onSnapshot(snap => {
          const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          buckets.sent.set(safeId, rows);
          _merge();
        }, err => console.error('[mensajes-data] sent listener', safeId, err))
    );

    let q2 = db.collection('mensajes').where('destinatario', '==', safeId);
    unsubs.push(
      q2.orderBy('timestamp', 'desc').limit(300)
        .onSnapshot(snap => {
          const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          buckets.recv.set(safeId, rows);
          _merge();
        }, err => console.error('[mensajes-data] recv listener', safeId, err))
    );
  }

  return () => { unsubs.forEach(u => u && u()); };
}

// ── Conversation builder ──────────────────────────────────

export function buildConversations(allMessages, me, directory = null) {
  const byPeer = new Map();
  allMessages.forEach(msg => {
    const peer = getPeerSide(msg, me, directory);
    const key = peer.key;
    if (!key) return;
    const mine = isMessageMine(msg, me, directory);
    const displayLabel = _up(peer.label || peer.raw || peer.email || peer.uid) || 'USUARIO';
    const preferredHandle = peer.email ? peer.email.toUpperCase() : (peer.raw || peer.uid || '');
    const prev = byPeer.get(key);
    if (!prev) {
      byPeer.set(key, {
        peerKey: key,
        peerUid: peer.uid || '',
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
      prev.peerUid = peer.uid || prev.peerUid;
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

// ── File upload to Cloudinary ─────────────────────────────

export async function uploadChatFile(file) {
  const ts = Date.now();
  const safeName = String(file.name || 'archivo').replace(/[^a-zA-Z0-9._-]/g, '_');
  const { uploadMedia } = await import('/js/core/media-upload.js');
  const type = String(file.type || '');
  const resourceType = type.startsWith('image/')
    ? 'image'
    : (type.startsWith('video/') || type.startsWith('audio/') ? 'video' : 'raw');
  const result = await uploadMedia({
    folder: 'mensajes_chat',
    file,
    publicId: `${ts}-${safeName.replace(/\.[^.]+$/, '')}`,
    resourceType,
  });
  return {
    url: result.url,
    name: file.name,
    publicId: result.publicId,
    provider: result.provider || 'cloudinary',
  };
}

export async function uploadChatAudio(blob, mimeType, extension) {
  const ts = Date.now();
  const fname = `audio_${ts}.${extension || 'webm'}`;
  const { uploadMedia } = await import('/js/core/media-upload.js');
  const result = await uploadMedia({
    folder: 'mensajes_chat',
    file: blob,
    publicId: `${ts}-${fname.replace(/\.[^.]+$/, '')}`,
    resourceType: 'video',
  });
  return {
    url: result.url,
    name: fname,
    publicId: result.publicId,
    provider: result.provider || 'cloudinary',
  };
}

// ── Get all users for new-conversation picker ─────────────

export async function getAllUsers() {
  try {
    let q = db.collection(COL.USERS);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('[mensajes-data] getAllUsers', err);
    throw err;
  }
}
