// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/horarios-data.js
//  Gestión de horarios semanales y registro de asistencia.
//
//  Schema horarios/{id}  — id determinístico: {plaza}_{semana}_{uid}
//  Schema asistencia/{id}
// ═══════════════════════════════════════════════════════════

import { db, COL } from '/js/core/database.js';
import { isFirestoreIndexError, listenerErrorFrom, normalizePlazaUsuario } from '/js/app/features/turnos/turnos-view-model.js';

export { isFirestoreIndexError, listenerErrorFrom };

export const TIPOS_DIA = Object.freeze({
  NORMAL:      { label: 'Normal',       color: '#6366f1' },
  DESCANSO:    { label: 'Descanso',     color: '#94a3b8' },
  VACACIONES:  { label: 'Vacaciones',   color: '#10b981' },
  FESTIVO:     { label: 'Festivo',      color: '#f59e0b' },
});

export const ESTADOS_ASISTENCIA = Object.freeze({
  PRESENTE:    { label: 'Presente',    color: '#10b981' },
  AUSENTE:     { label: 'Ausente',     color: '#ef4444' },
  TARDE:       { label: 'Tarde',       color: '#f59e0b' },
  JUSTIFICADO: { label: 'Justificado', color: '#3b82f6' },
  DESCANSO:    { label: 'Descanso',    color: '#94a3b8' },
});

export const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];

export const DIA_NOMBRE = {
  lun: 'Lunes', mar: 'Martes', mie: 'Miércoles',
  jue: 'Jueves', vie: 'Viernes', sab: 'Sábado', dom: 'Domingo',
};

// ── Helpers ───────────────────────────────────────────────────
function _fv()  { return window.firebase?.firestore?.FieldValue; }
function _authUid() { return window._auth?.currentUser?.uid || ''; }

function _slugPlaza(plaza) {
  return String(plaza).toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function _slugUid(uid) {
  return String(uid).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Doc ID determinístico: {plaza}_{semana}_{uid} */
export function horarioDocId(plaza, semana, usuarioId) {
  return `${_slugPlaza(plaza)}_${semana}_${_slugUid(usuarioId)}`;
}

/** Lunes de la semana que contiene 'date' (default hoy). */
export function semanaInicio(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/** Suma 'n' semanas a una fecha ISO YYYY-MM-DD. */
export function moverSemana(semana, n) {
  const d = new Date(semana + 'T00:00:00');
  d.setDate(d.getDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

/** Fecha ISO de un día específico dado el lunes de la semana. */
export function fechaDia(semana, diaKey) {
  const idx = DIAS.indexOf(diaKey);
  if (idx === -1) return semana;
  const d = new Date(semana + 'T00:00:00');
  d.setDate(d.getDate() + idx);
  return d.toISOString().slice(0, 10);
}

/** Hoy como YYYY-MM-DD */
export function hoy() {
  return new Date().toISOString().slice(0, 10);
}

/** Rango de fechas (lunes a domingo) para una semana. */
export function rangoSemana(semana) {
  const fin = new Date(semana + 'T00:00:00');
  fin.setDate(fin.getDate() + 6);
  return { inicio: semana, fin: fin.toISOString().slice(0, 10) };
}

function _mapUsuarioDoc(d) {
  const data = d.data();
  return { id: d.id, uid: data.uid || d.id, ...data };
}

function _sortUsuarios(a, b) {
  return String(a.nombreCompleto || a.nombre || a.id)
    .localeCompare(String(b.nombreCompleto || b.nombre || b.id));
}

// ── Horarios ──────────────────────────────────────────────────
/** Escucha en tiempo real los horarios de una semana para una plaza. */
export function onHorariosSemanales(plaza, semana, callback) {
  const q = db.collection(COL.HORARIOS)
    .where('plaza', '==', plaza)
    .where('semanaInicio', '==', semana);
  return q.onSnapshot(
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })), null),
    err => {
      console.warn('[horarios]', err?.message);
      callback([], listenerErrorFrom(err, 'horarios'));
    }
  );
}

/** Guarda o actualiza el horario de un usuario para una semana. */
export async function guardarHorario(usuarioId, plaza, semana, dias, meta = {}) {
  const fv = _fv();
  const docId = horarioDocId(plaza, semana, usuarioId);
  const ref = db.collection(COL.HORARIOS).doc(docId);
  const snap = await ref.get();

  const base = {
    usuarioId,
    usuarioNombre:  String(meta.nombre || '').trim(),
    usuarioRol:     String(meta.rol    || '').toUpperCase(),
    plaza,
    semanaInicio:   semana,
    dias,
    actualizadoPor: _authUid(),
    actualizadoEn:  fv ? fv.serverTimestamp() : Date.now(),
  };

  if (!snap.exists) {
    base.creadoEn = fv ? fv.serverTimestamp() : Date.now();
    await ref.set(base);
  } else {
    await ref.update(base);
  }
  return docId;
}

/** Horario de un usuario para una semana (one-shot). */
export async function getMiHorario(usuarioId, plaza, semana) {
  const docId = horarioDocId(plaza, semana, usuarioId);
  const snap = await db.collection(COL.HORARIOS).doc(docId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

// ── Asistencia ────────────────────────────────────────────────
/** Escucha asistencia de una plaza en un rango de fechas. */
export function onAsistencia(plaza, fechaInicio, fechaFin, callback) {
  const q = db.collection(COL.ASISTENCIA)
    .where('plaza', '==', plaza)
    .where('fecha', '>=', fechaInicio)
    .where('fecha', '<=', fechaFin);
  return q.onSnapshot(
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })), null),
    err => {
      console.warn('[asistencia]', err?.message);
      callback([], listenerErrorFrom(err, 'asistencia'));
    }
  );
}

/** Registra o actualiza la asistencia de un usuario en una fecha. */
export async function registrarAsistencia(usuarioId, plaza, fecha, estado, opts = {}) {
  const fv = _fv();
  let q = db.collection(COL.ASISTENCIA)
    .where('usuarioId', '==', usuarioId)
    .where('plaza', '==', plaza)
    .where('fecha', '==', fecha);
  const snap = await q.limit(1).get();

  const base = {
    usuarioId,
    usuarioNombre:  String(opts.nombre || '').trim(),
    plaza,
    fecha,
    estado,
    nota:          String(opts.nota    || '').trim(),
    turnoId:       opts.turnoId || null,
    registradoPor: _authUid(),
    registradoEn:  fv ? fv.serverTimestamp() : Date.now(),
  };

  if (snap.empty) {
    const ref = await db.collection(COL.ASISTENCIA).add(base);
    return ref.id;
  }
  await snap.docs[0].ref.update(base);
  return snap.docs[0].id;
}

// ── Historial de turnos ───────────────────────────────────────
/** Trae los últimos 'limit' turnos CERRADOS de la plaza (o del usuario). */
export async function getHistorialTurnos(plaza, opts = {}) {
  const lim = opts.limit || 40;
  let q = db.collection(COL.TURNOS).where('estado', '==', 'CERRADO');
  if (plaza) q = q.where('plazaId', '==', plaza);
  if (opts.usuarioId) q = q.where('usuarioId', '==', opts.usuarioId);
  q = q.orderBy('inicio', 'desc').limit(lim);
  try {
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    if (isFirestoreIndexError(err)) {
      const e = new Error('INDEX_MISSING');
      e.code = 'INDEX_MISSING';
      e.cause = err;
      throw e;
    }
    throw err;
  }
}

// ── Plantillas predefinidas ───────────────────────────────────
export function onPlantillas(callback) {
  const q = db.collection(COL.HORARIOS_PLANTILLAS);
  return q.onSnapshot(
    snap => callback(
      snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
    ),
    err => { console.warn('[plantillas]', err?.message); callback([]); }
  );
}

export async function guardarPlantilla(nombre, inicio, fin, id = null) {
  const fv = _fv();
  const base = {
    nombre: String(nombre).trim(),
    inicio: String(inicio).trim(),
    fin:    String(fin).trim(),
    actualizadoPor: _authUid(),
    actualizadoEn:  fv ? fv.serverTimestamp() : Date.now(),
  };
  if (id) {
    await db.collection(COL.HORARIOS_PLANTILLAS).doc(id).update(base);
    return id;
  }
  base.creadoEn = fv ? fv.serverTimestamp() : Date.now();
  const ref = await db.collection(COL.HORARIOS_PLANTILLAS).add(base);
  return ref.id;
}

export async function eliminarPlantilla(id) {
  if (!id) return;
  await db.collection(COL.HORARIOS_PLANTILLAS).doc(id).delete();
}

// ── Notas generales de semana ─────────────────────────────────
function _notasSemId(plaza, semana) {
  return `${_slugPlaza(plaza)}_${semana}`;
}

export function onNotasSemana(plaza, semana, callback) {
  const docId = _notasSemId(plaza, semana);
  return db.collection(COL.NOTAS_SEMANA).doc(docId).onSnapshot(
    snap => callback(snap.exists ? (snap.data()?.notas || {}) : {}),
    err  => { console.warn('[notas_semana]', err?.message); callback({}); }
  );
}

export async function guardarNotaSemana(plaza, semana, diaKey, nota) {
  const fv    = _fv();
  const docId = _notasSemId(plaza, semana);
  const ref   = db.collection(COL.NOTAS_SEMANA).doc(docId);
  const snap  = await ref.get();
  if (!snap.exists) {
    await ref.set({
      plaza,
      semana,
      notas: { [diaKey]: String(nota).trim() },
      actualizadoEn:  fv ? fv.serverTimestamp() : Date.now(),
      actualizadoPor: _authUid(),
    });
  } else {
    await ref.update({
      [`notas.${diaKey}`]: String(nota).trim(),
      actualizadoEn:  fv ? fv.serverTimestamp() : Date.now(),
      actualizadoPor: _authUid(),
    });
  }
}

// ── Usuarios de plaza ─────────────────────────────────────────
/** Lista básica de usuarios de una plaza para el grid de horarios. */
export async function getUsuariosPlaza(plaza) {
  if (!plaza) return [];
  const plazaUp = String(plaza).toUpperCase().trim();

  const filterByPlaza = docs =>
    docs
      .map(_mapUsuarioDoc)
      .filter(u => normalizePlazaUsuario(u) === plazaUp)
      .sort(_sortUsuarios);

  try {
    let snap = await db.collection(COL.USERS).where('plazaAsignada', '==', plazaUp).limit(150).get();
    if (!snap.empty) return filterByPlaza(snap.docs);

    snap = await db.collection(COL.USERS).where('plaza', '==', plazaUp).limit(150).get();
    if (!snap.empty) return filterByPlaza(snap.docs);

    snap = await db.collection(COL.USERS).limit(150).get();
    return filterByPlaza(snap.docs);
  } catch (err) {
    if (isFirestoreIndexError(err)) {
      const e = new Error('INDEX_MISSING');
      e.code = 'INDEX_MISSING';
      e.cause = err;
      throw e;
    }
    throw err;
  }
}
