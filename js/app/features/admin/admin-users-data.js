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
    status: String(data.status || 'ACTIVO').toUpperCase().trim(),
    isAdmin: data.isAdmin === true,
    isGlobal: data.isGlobal === true
  };
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
