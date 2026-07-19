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


  let qPrimary = db.collection(PRIMARY).where('estado', '==', normalizedStatus);
  const unsubPrimary = qPrimary.onSnapshot(
    snap => {
      primary = snap.docs.map(d => normalizeRequestRecord(d.id, d.data(), PRIMARY));
      readyPrimary = true;
      emit();
    },
    err => {
      readyPrimary = true;
      primary = [];
      if ((err?.code || '') !== 'permission-denied') fail(err);
      emit();
    }
  );

  let qLegacy = db.collection(LEGACY).where('estado', '==', normalizedStatus);
  const unsubLegacy = qLegacy.onSnapshot(
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
    updatedAt: fv ? fv.serverTimestamp() : new Date().toISOString(),
  };
  await target.ref.set(payload, { merge: true });
  return { collectionName: target.collectionName, email: _normEmail(email) };
}

async function _procesarSolicitudCallable(payload = {}) {
  if (typeof window.api?.procesarSolicitudAcceso === 'function') {
    return window.api.procesarSolicitudAcceso(payload);
  }
  const functions = window._functions
    || (typeof window.firebase?.functions === 'function' ? window.firebase.app().functions('us-central1') : null);
  if (!functions || typeof functions.httpsCallable !== 'function') {
    throw new Error('Firebase Functions no está disponible para procesar solicitudes.');
  }
  const response = await functions.httpsCallable('procesarSolicitudAcceso')(payload);
  return response?.data || response;
}

/** Aprobar vía Cloud Function (crea usuario / aplica rol). */
export async function approveAccessRequest({
  email = '',
  collectionHint = '',
  nombre = '',
  puesto = '',
  telefono = '',
  role = '',
  plaza = ''
} = {}) {
  const deep = await fetchAccessRequestDocDeep(email, collectionHint);
  if (!deep) throw new Error('La solicitud ya no existe.');
  const data = deep.data || {};
  return _procesarSolicitudCallable({
    action: 'approve',
    docId: deep.id,
    collectionName: deep.collectionName,
    email: _normEmail(email || data.email || deep.id),
    nombre: _norm(nombre || data.nombre),
    puesto: _norm(puesto || data.puesto),
    telefono: _norm(telefono || data.telefono),
    role: _normUp(role || data.rolSolicitado || data.requestedRole || 'AUXILIAR'),
    plaza: _normUp(plaza || data.plazaSolicitada || data.requestedPlaza || ''),
    password: data.password || ''
  });
}

/** Rechazar vía Cloud Function (notifica / marca estado). */
export async function rejectAccessRequest({
  email = '',
  collectionHint = '',
  motivo = ''
} = {}) {
  const deep = await fetchAccessRequestDocDeep(email, collectionHint);
  if (!deep) throw new Error('La solicitud ya no existe.');
  const data = deep.data || {};
  try {
    return await _procesarSolicitudCallable({
      action: 'reject',
      docId: deep.id,
      collectionName: deep.collectionName,
      email: _normEmail(email || data.email || deep.id),
      nombre: _norm(data.nombre),
      puesto: _norm(data.puesto),
      telefono: _norm(data.telefono),
      motivo: _norm(motivo) || 'No cumples con los criterios de acceso requeridos en este momento.'
    });
  } catch (err) {
    // Fallback local si el callable no está disponible
    return rejectAccessRequestSafely({
      email: email || deep.id,
      comment: motivo,
      collectionHint: deep.collectionName
    });
  }
}
