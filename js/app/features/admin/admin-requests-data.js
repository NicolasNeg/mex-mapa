import { db } from '/js/core/database.js';

const PRIMARY = 'solicitudes';
const LEGACY = 'solicitudes_acceso';

function _collectionsOrder(preferred = '') {
  return Array.from(new Set(
    [preferred, PRIMARY, LEGACY].map(v => String(v || '').trim()).filter(Boolean)
  ));
}

/** Lectura puntual para aprobar (password en doc, colección correcta). */
export async function fetchAccessRequestDocDeep(docId, collectionHint = '') {
  const normalizedId = String(docId || '').trim().toLowerCase();
  if (!normalizedId) return null;
  for (const col of _collectionsOrder(collectionHint)) {
    try {
      const snap = await db.collection(col).doc(normalizedId).get();
      if (snap.exists) {
        return {
          collectionName: col,
          id: normalizedId,
          data: snap.data() || {}
        };
      }
    } catch (_) { /* permisos */ }
  }
  return null;
}

function _norm(v) {
  return String(v || '').trim();
}

function _normUp(v) {
  return _norm(v).toUpperCase();
}

function _normEmail(v) {
  return _norm(v).toLowerCase();
}

function _normalizeStatus(v) {
  const raw = _normUp(v);
  if (raw === 'APROBADO') return 'APROBADA';
  if (raw === 'RECHAZADO') return 'RECHAZADA';
  if (raw === 'APROBADA' || raw === 'RECHAZADA' || raw === 'PENDIENTE') return raw;
  return raw || 'PENDIENTE';
}

export function normalizeRequestRecord(id, data = {}, collectionName = PRIMARY) {
  const dateMs = (() => {
    if (data?._ts?.toMillis) return data._ts.toMillis();
    const parsed = Date.parse(data?.fecha || '');
    return Number.isFinite(parsed) ? parsed : 0;
  })();
  return {
    id: _normEmail(data.email || id),
    nombre: _norm(data.nombre).toUpperCase(),
    email: _normEmail(data.email || id),
    puesto: _norm(data.puesto).toUpperCase(),
    plazaSolicitada: _normUp(data.plazaSolicitada || data.requestedPlaza || ''),
    telefono: _norm(data.telefono || ''),
    rolSolicitado: _normUp(data.rolSolicitado || data.requestedRole || ''),
    estado: _normalizeStatus(data.estado),
    fecha: _norm(data.fecha || ''),
    fechaMs: dateMs,
    collectionName
  };
}

function _mergeRecords(primaryRows = [], legacyRows = []) {
  const map = new Map();
  [...legacyRows, ...primaryRows].forEach(item => {
    const key = _normEmail(item.email || item.id);
    if (!key) return;
    const prev = map.get(key);
    if (!prev || item.collectionName === PRIMARY) map.set(key, item);
  });
  return [...map.values()].sort((a, b) => (b.fechaMs || 0) - (a.fechaMs || 0));
}

export function subscribeAdminRequests({ status = 'PENDIENTE', onData, onError }) {
  const normalizedStatus = _normalizeStatus(status);
  const ok = typeof onData === 'function' ? onData : () => {};
  const fail = typeof onError === 'function' ? onError : () => {};
  let primary = [];
  let legacy = [];
  let readyPrimary = false;
  let readyLegacy = false;

  const emit = () => {
    if (!readyPrimary || !readyLegacy) return;
    ok(_mergeRecords(primary, legacy));
  };

  const unsubPrimary = db.collection(PRIMARY).where('estado', '==', normalizedStatus).onSnapshot(
    snap => {
      primary = snap.docs.map(d => normalizeRequestRecord(d.id, d.data(), PRIMARY));
      readyPrimary = true;
      emit();
    },
    err => fail(err)
  );

  const unsubLegacy = db.collection(LEGACY).where('estado', '==', normalizedStatus).onSnapshot(
    snap => {
      legacy = snap.docs.map(d => normalizeRequestRecord(d.id, d.data(), LEGACY));
      readyLegacy = true;
      emit();
    },
    err => {
      // permisos/index legacy no deben bloquear vista principal
      readyLegacy = true;
      legacy = [];
      if ((err?.code || '') !== 'permission-denied') fail(err);
      emit();
    }
  );

  return () => {
    try { unsubPrimary(); } catch (_) {}
    try { unsubLegacy(); } catch (_) {}
  };
}

function _fieldValue() {
  return window.firebase?.firestore?.FieldValue || null;
}

async function _findRequestRef(email = '', preferredCollection = '') {
  const normalized = _normEmail(email);
  if (!normalized) return null;
  for (const col of _collectionsOrder(preferredCollection)) {
    try {
      const ref = db.collection(col).doc(normalized);
      const snap = await ref.get();
      if (snap.exists) return { ref, collectionName: col };
    } catch (_) { /* ignore */ }
  }
  const fallbackCollection = _collectionsOrder(preferredCollection)[0] || PRIMARY;
  return { ref: db.collection(fallbackCollection).doc(normalized), collectionName: fallbackCollection };
}

/**
 * Rechazo seguro: actualiza estado y auditoría sin crear usuarios ni jobs.
 */
export async function rejectAccessRequestSafely({
  email = '',
  actorEmail = '',
  comment = '',
  collectionHint = ''
} = {}) {
  const target = await _findRequestRef(email, collectionHint);
  if (!target?.ref) throw new Error('No se encontró la solicitud.');
  const fv = _fieldValue();
  const reviewedBy = _normEmail(actorEmail);
  const payload = {
    estado: 'RECHAZADA',
    comentarioRevision: _norm(comment),
    motivo_rechazo: _norm(comment),
    revisadoPor: reviewedBy,
    rechazadoPor: reviewedBy,
    updatedFrom: 'app_admin',
    updatedBy: reviewedBy,
    revisadoEn: fv ? fv.serverTimestamp() : new Date().toISOString(),
    rechazadoEn: fv ? fv.serverTimestamp() : new Date().toISOString(),
    updatedAt: fv ? fv.serverTimestamp() : new Date().toISOString()
  };
  await target.ref.set(payload, { merge: true });
  return { collectionName: target.collectionName, email: _normEmail(email) };
}
