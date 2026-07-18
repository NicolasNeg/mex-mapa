// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/turnos-data.js
//  Gestión de turnos operativos (checkin / checkout).
//
//  Schema turnos/{turnoId}:
//    { usuarioId, usuarioNombre, usuarioRol, plazaId, inicio, fin, estado,
//      lat?, lon?, direccion?, faceVerified?, faceSimilarity?, viveza?,
//      antiSpoof?, fotoUrl?, geoWarn?, distanciaPlazaM?,
//      cierreLat?, cierreLon?, ... }
//  estado: 'ACTIVO' | 'CERRADO'
// ═══════════════════════════════════════════════════════════

import { db, auth, COL } from '/js/core/database.js';
import { isFirestoreIndexError } from '/js/app/features/turnos/turnos-view-model.js';

const COL_TURNOS = COL.TURNOS;

function _fv() { return window.firebase?.firestore?.FieldValue; }

function _pickCheckinMeta(meta = {}) {
  const out = {};
  if (Number.isFinite(meta.lat)) out.lat = meta.lat;
  if (Number.isFinite(meta.lon)) out.lon = meta.lon;
  if (meta.direccion) out.direccion = String(meta.direccion);
  if (typeof meta.faceVerified === 'boolean') out.faceVerified = meta.faceVerified;
  if (Number.isFinite(meta.faceSimilarity)) out.faceSimilarity = meta.faceSimilarity;
  if (Number.isFinite(meta.viveza)) out.viveza = meta.viveza;
  if (Number.isFinite(meta.antiSpoof)) out.antiSpoof = meta.antiSpoof;
  if (meta.fotoUrl) out.fotoUrl = String(meta.fotoUrl);
  if (meta.firmaUrl) out.firmaUrl = String(meta.firmaUrl);
  if (typeof meta.geoWarn === 'boolean') out.geoWarn = meta.geoWarn;
  if (Number.isFinite(meta.distanciaPlazaM)) out.distanciaPlazaM = meta.distanciaPlazaM;
  return out;
}

function _pickCheckoutMeta(meta = {}) {
  const out = {};
  if (Number.isFinite(meta.lat)) out.cierreLat = meta.lat;
  if (Number.isFinite(meta.lon)) out.cierreLon = meta.lon;
  if (meta.direccion) out.cierreDireccion = String(meta.direccion);
  if (typeof meta.faceVerified === 'boolean') out.cierreFaceVerified = meta.faceVerified;
  if (Number.isFinite(meta.faceSimilarity)) out.cierreFaceSimilarity = meta.faceSimilarity;
  if (Number.isFinite(meta.viveza)) out.cierreViveza = meta.viveza;
  if (Number.isFinite(meta.antiSpoof)) out.cierreAntiSpoof = meta.antiSpoof;
  if (meta.fotoUrl) out.cierreFotoUrl = String(meta.fotoUrl);
  if (typeof meta.geoWarn === 'boolean') out.cierreGeoWarn = meta.geoWarn;
  if (Number.isFinite(meta.distanciaPlazaM)) out.cierreDistanciaPlazaM = meta.distanciaPlazaM;
  return out;
}

/**
 * Abre un turno para el usuario en la plaza dada.
 * Cierra automáticamente cualquier turno previo activo.
 * @param {object} user
 * @param {string} plazaId
 * @param {object} [meta] — geo/face/foto del gate
 */
export async function iniciarTurno(user, plazaId, meta = {}) {
  // Siempre usar el UID real de Firebase Auth — los perfiles legacy pueden tener
  // uid = email en su documento de Firestore, lo que rompe la regla de seguridad
  // que verifica request.resource.data.usuarioId == request.auth.uid.
  const firebaseUid = window._auth?.currentUser?.uid || auth?.currentUser?.uid || user.uid;
  if (!firebaseUid || !plazaId) throw new Error('Usuario y plaza requeridos');
  const plaza = String(plazaId).toUpperCase().trim();
  if (!plaza) throw new Error('Plaza inválida');

  const previo = await getMiTurnoActivo(firebaseUid);
  if (previo) await cerrarTurno(previo.id);

  const fv = _fv();
  const doc = {
    usuarioId: firebaseUid,
    usuarioNombre: String(user.nombreCompleto || user.nombre || user.displayName || user.email || '').trim(),
    usuarioRol: String(user.rol || user.role || '').toUpperCase(),
    plazaId: plaza,
    inicio: fv ? fv.serverTimestamp() : Date.now(),
    fin: null,
    estado: 'ACTIVO',
    ..._pickCheckinMeta(meta),
  };
  const ref = await db.collection(COL_TURNOS).add(doc);
  return ref.id;
}

/** Marca el turno dado como CERRADO (opcionalmente con meta de checkout). */
export async function cerrarTurno(turnoId, meta = {}) {
  if (!turnoId) return;
  const fv = _fv();
  const patch = {
    fin: fv ? fv.serverTimestamp() : Date.now(),
    estado: 'CERRADO',
    ..._pickCheckoutMeta(meta),
  };
  await db.collection(COL_TURNOS).doc(turnoId).update(patch);
}

/** Devuelve el turno ACTIVO del usuario, o null. */
export async function getMiTurnoActivo(userId) {
  if (!userId) return null;
  let q = db.collection(COL_TURNOS)
    .where('usuarioId', '==', userId)
    .where('estado', '==', 'ACTIVO');
  const snap = await q.limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

/**
 * Trae todos los turnos (de todos los colaboradores) de una plaza en un rango
 * de fechas. Alimenta el tablero mensual y el calendario por empleado.
 * Si plazaId es vacío ('' o 'TODAS'), trae de todas las plazas (multi-plaza).
 * @param {string} plazaId
 * @param {string} desde 'YYYY-MM-DD'
 * @param {string} hasta 'YYYY-MM-DD'
 * @param {{ usuarioId?: string, limit?: number }} [opts]
 */
export async function getTurnosRango(plazaId, desde, hasta, opts = {}) {
  const plaza = String(plazaId || '').toUpperCase().trim();
  const Timestamp = window.firebase?.firestore?.Timestamp;
  const start = Timestamp?.fromDate?.(new Date(`${desde}T00:00:00`)) || new Date(`${desde}T00:00:00`);
  const end = Timestamp?.fromDate?.(new Date(`${hasta}T23:59:59.999`)) || new Date(`${hasta}T23:59:59.999`);

  let q = db.collection(COL_TURNOS);
  if (opts.usuarioId) q = q.where('usuarioId', '==', String(opts.usuarioId).trim());
  else if (plaza && plaza !== 'TODAS') q = q.where('plazaId', '==', plaza);
  q = q.where('inicio', '>=', start).where('inicio', '<=', end).orderBy('inicio', 'asc');
  if (opts.limit) q = q.limit(opts.limit);

  try {
    const snap = await q.get();
    let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (opts.usuarioId && plaza && plaza !== 'TODAS') {
      rows = rows.filter(r => String(r.plazaId || r.plaza || '').toUpperCase() === plaza);
    }
    return rows;
  } catch (err) {
    if (isFirestoreIndexError(err)) {
      const e = new Error('INDEX_MISSING'); e.code = 'INDEX_MISSING'; e.cause = err;
      throw e;
    }
    throw err;
  }
}

/**
 * Escucha los turnos activos de una plaza en tiempo real.
 * Devuelve la función de cancelación (unsub).
 */
export function onTurnosActivos(plazaId, callback) {
  const plaza = String(plazaId || '').toUpperCase().trim();
  if (!plaza) {
    callback([]);
    return () => {};
  }
  let query = db.collection(COL_TURNOS)
    .where('plazaId', '==', plaza)
    .where('estado', '==', 'ACTIVO');
  return query.onSnapshot(
      snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => {
        console.warn('[turnos] onSnapshot:', err?.message);
        callback([]);
      }
    );
}
