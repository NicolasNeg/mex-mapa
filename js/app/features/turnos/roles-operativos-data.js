// ═══════════════════════════════════════════════════════════
//  roles-operativos-data.js
//  Filas/secciones custom por plaza (≠ roles RBAC del sistema).
//  Doc: turnos_roles_operativos/{plazaSlug}
//    { plaza, filas: [{ id, nombre, orden, usuarioIds[] }], ... }
// ═══════════════════════════════════════════════════════════

import { db, COL } from '/js/core/database.js';

function _fv() { return window.firebase?.firestore?.FieldValue; }
function _authUid() { return window._auth?.currentUser?.uid || ''; }

function _slugPlaza(plaza) {
  return String(plaza || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function _newFilaId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function _normalizeFilas(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((f, i) => ({
      id: String(f?.id || _newFilaId()),
      nombre: String(f?.nombre || '').trim() || `Rol ${i + 1}`,
      orden: Number.isFinite(f?.orden) ? Number(f.orden) : i,
      usuarioIds: Array.isArray(f?.usuarioIds)
        ? f.usuarioIds.map(u => String(u || '').trim()).filter(Boolean)
        : [],
    }))
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
}

export function rolesDocId(plaza) {
  return _slugPlaza(plaza);
}

/** Escucha filas operativas de la plaza. callback(filas[], err?). */
export function onRolesOperativos(plaza, callback) {
  const p = String(plaza || '').trim();
  if (!p) {
    callback([], null);
    return () => {};
  }
  const ref = db.collection(COL.TURNOS_ROLES_OP).doc(rolesDocId(p));
  return ref.onSnapshot(
    snap => {
      const data = snap.exists ? snap.data() : null;
      callback(_normalizeFilas(data?.filas), null);
    },
    err => {
      console.warn('[roles_operativos]', err?.message);
      callback([], err);
    }
  );
}

/** Persiste el arreglo completo de filas (reorden / rename / assign). */
export async function guardarRolesOperativos(plaza, filas) {
  const p = String(plaza || '').trim();
  if (!p) throw new Error('Plaza requerida.');
  const fv = _fv();
  const normalized = _normalizeFilas(filas).map((f, i) => ({ ...f, orden: i }));
  const ref = db.collection(COL.TURNOS_ROLES_OP).doc(rolesDocId(p));
  await ref.set({
    plaza: p.toUpperCase(),
    filas: normalized,
    actualizadoPor: _authUid(),
    actualizadoEn: fv ? fv.serverTimestamp() : Date.now(),
  }, { merge: true });
  return normalized;
}

export async function crearRolOperativo(plaza, nombre) {
  const n = String(nombre || '').trim();
  if (!n) throw new Error('Nombre de rol requerido.');
  const p = String(plaza || '').trim();
  const ref = db.collection(COL.TURNOS_ROLES_OP).doc(rolesDocId(p));
  const snap = await ref.get();
  const filas = _normalizeFilas(snap.exists ? snap.data()?.filas : []);
  const fila = {
    id: _newFilaId(),
    nombre: n.toUpperCase(),
    orden: filas.length,
    usuarioIds: [],
  };
  filas.push(fila);
  await guardarRolesOperativos(p, filas);
  return fila;
}

export async function renombrarRolOperativo(plaza, filaId, nombre) {
  const n = String(nombre || '').trim();
  if (!n) throw new Error('Nombre requerido.');
  const p = String(plaza || '').trim();
  const ref = db.collection(COL.TURNOS_ROLES_OP).doc(rolesDocId(p));
  const snap = await ref.get();
  const filas = _normalizeFilas(snap.exists ? snap.data()?.filas : []);
  const idx = filas.findIndex(f => f.id === filaId);
  if (idx < 0) throw new Error('Rol no encontrado.');
  filas[idx] = { ...filas[idx], nombre: n.toUpperCase() };
  await guardarRolesOperativos(p, filas);
  return filas[idx];
}

export async function eliminarRolOperativo(plaza, filaId) {
  const p = String(plaza || '').trim();
  const ref = db.collection(COL.TURNOS_ROLES_OP).doc(rolesDocId(p));
  const snap = await ref.get();
  const filas = _normalizeFilas(snap.exists ? snap.data()?.filas : [])
    .filter(f => f.id !== filaId);
  await guardarRolesOperativos(p, filas);
  return filas;
}

export async function reordenarRolOperativo(plaza, filaId, dir) {
  const p = String(plaza || '').trim();
  const ref = db.collection(COL.TURNOS_ROLES_OP).doc(rolesDocId(p));
  const snap = await ref.get();
  const filas = _normalizeFilas(snap.exists ? snap.data()?.filas : []);
  const idx = filas.findIndex(f => f.id === filaId);
  if (idx < 0) return filas;
  const target = dir < 0 ? idx - 1 : idx + 1;
  if (target < 0 || target >= filas.length) return filas;
  const tmp = filas[idx];
  filas[idx] = filas[target];
  filas[target] = tmp;
  return guardarRolesOperativos(p, filas);
}

/**
 * Mueve un usuario a una fila (o a null = sin asignar).
 * Quita el uid de cualquier otra fila.
 */
export async function asignarUsuarioARol(plaza, usuarioId, filaId) {
  const uid = String(usuarioId || '').trim();
  if (!uid) throw new Error('Usuario requerido.');
  const p = String(plaza || '').trim();
  const ref = db.collection(COL.TURNOS_ROLES_OP).doc(rolesDocId(p));
  const snap = await ref.get();
  const filas = _normalizeFilas(snap.exists ? snap.data()?.filas : []).map(f => ({
    ...f,
    usuarioIds: f.usuarioIds.filter(id => id !== uid),
  }));
  if (filaId) {
    const idx = filas.findIndex(f => f.id === filaId);
    if (idx < 0) throw new Error('Rol no encontrado.');
    filas[idx] = {
      ...filas[idx],
      usuarioIds: [...filas[idx].usuarioIds, uid],
    };
  }
  return guardarRolesOperativos(p, filas);
}
