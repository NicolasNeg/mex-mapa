import { db, COL } from '/js/core/database.js';

export function normalizeUserRecord(id, data = {}) {
  const email = String(data.email || id || '').toLowerCase().trim();
  return {
    id: String(id || email),
    email,
    nombre: String(data.nombreCompleto || data.nombre || data.usuario || email || '').trim(),
    rol: String(data.rol || data.role || 'AUXILIAR').toUpperCase().trim(),
    plaza: String(data.plazaAsignada || data.plaza || '').toUpperCase().trim(),
    plazasPermitidas: Array.isArray(data.plazasPermitidas) ? data.plazasPermitidas.map(p => String(p || '').toUpperCase().trim()).filter(Boolean) : [],
    telefono: String(data.telefono || '').trim(),
    avatarUrl: String(data.avatarUrl || data.photoURL || data.fotoURL || data.profilePhotoUrl || '').trim(),
    status: String(data.status || 'ACTIVO').toUpperCase().trim(),
    isAdmin: data.isAdmin === true,
    isGlobal: data.isGlobal === true,
    notasInternas: String(data.notasInternas || data.notasAdmin || '').trim()
  };
}

function _fieldValue() {
  return window.firebase?.firestore?.FieldValue || null;
}

/**
 * Merge acotado para beta App Shell (sin email/rol/permisos/password).
 */
export async function mergeAdminUserBasics(userDocId, patch = {}, actorEmail = '', options = {}) {
  const { allowPlaza = false } = options;
  const merge = {};
  if (patch.nombre != null) {
    const n = String(patch.nombre).trim().toUpperCase();
    merge.nombre = n;
    merge.nombreCompleto = n;
  }
  if (patch.telefono != null) merge.telefono = String(patch.telefono).trim();
  if (patch.avatarUrl != null) {
    const avatar = String(patch.avatarUrl).trim();
    merge.avatarUrl = avatar;
    merge.photoURL = avatar;
    merge.fotoURL = avatar;
    merge.profilePhotoUrl = avatar;
  }
  if (patch.status != null) merge.status = String(patch.status).trim().toUpperCase();
  if (patch.notasInternas != null) merge.notasInternas = String(patch.notasInternas).trim();
  if (allowPlaza && patch.plazaAsignada !== undefined) {
    const p = String(patch.plazaAsignada).trim().toUpperCase();
    merge.plazaAsignada = p;
    merge.plaza = p;
  }
  const fv = _fieldValue();
  merge.actualizadoAt = fv ? fv.serverTimestamp() : new Date().toISOString();
  merge.actualizadoPor = String(actorEmail || '').trim().toLowerCase();
  merge.updatedFrom = 'app_admin';
  await db.collection(COL.USERS).doc(userDocId).set(merge, { merge: true });
}

export function subscribeAdminUsers({ onData, onError }) {
  const ok = typeof onData === 'function' ? onData : () => {};
  const fail = typeof onError === 'function' ? onError : () => {};
  const unsub = db.collection(COL.USERS).onSnapshot(
    snap => ok(snap.docs.map(d => normalizeUserRecord(d.id, d.data()))),
    err => fail(err)
  );
  return () => { try { unsub(); } catch (_) {} };
}
