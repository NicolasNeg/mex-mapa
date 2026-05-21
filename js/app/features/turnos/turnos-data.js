// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/turnos-data.js
//  Gestión de turnos operativos (checkin / checkout).
//
//  Schema turnos/{turnoId}:
//    { usuarioId, usuarioNombre, usuarioRol, plazaId, inicio, fin, estado }
//  estado: 'ACTIVO' | 'CERRADO'
// ═══════════════════════════════════════════════════════════

import { db, auth } from '/js/core/database.js';

const COL_TURNOS = 'turnos';

function _fv() { return window.firebase?.firestore?.FieldValue; }

function _eid() {
  const ctx = window._empresaActual;
  if (!ctx || ctx.isSuperAdminContext) return '';
  return ctx.id || '';
}

/**
 * Abre un turno para el usuario en la plaza dada.
 * Cierra automáticamente cualquier turno previo activo.
 */
export async function iniciarTurno(user, plazaId) {
  // Siempre usar el UID real de Firebase Auth — los perfiles legacy pueden tener
  // uid = email en su documento de Firestore, lo que rompe la regla de seguridad
  // que verifica request.resource.data.usuarioId == request.auth.uid.
  const firebaseUid = auth.currentUser?.uid || user.uid;
  if (!firebaseUid || !plazaId) throw new Error('Usuario y plaza requeridos');
  const plaza = String(plazaId).toUpperCase().trim();
  if (!plaza) throw new Error('Plaza inválida');

  const previo = await getMiTurnoActivo(firebaseUid);
  if (previo) await cerrarTurno(previo.id);

  const fv = _fv();
  const empresaId = _eid();
  const doc = {
    usuarioId: firebaseUid,
    usuarioNombre: String(user.nombreCompleto || user.nombre || user.displayName || user.email || '').trim(),
    usuarioRol: String(user.rol || user.role || '').toUpperCase(),
    plazaId: plaza,
    inicio: fv ? fv.serverTimestamp() : Date.now(),
    fin: null,
    estado: 'ACTIVO',
    ...(empresaId ? { empresaId } : {}),
  };
  const ref = await db.collection(COL_TURNOS).add(doc);
  return ref.id;
}

/** Marca el turno dado como CERRADO. */
export async function cerrarTurno(turnoId) {
  if (!turnoId) return;
  const fv = _fv();
  await db.collection(COL_TURNOS).doc(turnoId).update({
    fin: fv ? fv.serverTimestamp() : Date.now(),
    estado: 'CERRADO',
  });
}

/** Devuelve el turno ACTIVO del usuario, o null. */
export async function getMiTurnoActivo(userId) {
  if (!userId) return null;
  const eid = _eid();
  let q = db.collection(COL_TURNOS)
    .where('usuarioId', '==', userId)
    .where('estado', '==', 'ACTIVO');
  if (eid) q = q.where('empresaId', '==', eid);
  const snap = await q.limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
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
  const eid = _eid();
  let query = db.collection(COL_TURNOS)
    .where('plazaId', '==', plaza)
    .where('estado', '==', 'ACTIVO');
  if (eid) {
    query = query.where('empresaId', '==', eid);
  }
  return query.onSnapshot(
      snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => {
        console.warn('[turnos] onSnapshot:', err?.message);
        callback([]);
      }
    );
}
