// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/horarios-data.js
//  Gestión de horarios semanales y registro de asistencia.
//
//  Schema horarios/{id}:
//    { empresaId, usuarioId, usuarioNombre, usuarioRol,
//      plaza, semanaInicio (YYYY-MM-DD lunes),
//      dias: { lun|mar|mie|jue|vie|sab|dom:
//               { tipo:'NORMAL'|'DESCANSO'|'VACACIONES'|'FESTIVO',
//                 inicio:'08:00', fin:'16:00' } },
//      actualizadoPor, actualizadoEn, creadoEn }
//
//  Schema asistencia/{id}:
//    { empresaId, usuarioId, usuarioNombre, plaza, fecha (YYYY-MM-DD),
//      estado:'PRESENTE'|'AUSENTE'|'TARDE'|'JUSTIFICADO'|'DESCANSO',
//      nota, turnoId, registradoPor, registradoEn }
// ═══════════════════════════════════════════════════════════

import { db } from '/js/core/database.js';

const COL_HORARIOS    = 'horarios';
const COL_ASISTENCIA  = 'asistencia';

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
function _eid() {
  const ctx = window._empresaActual;
  if (!ctx || ctx.isSuperAdminContext) return '';
  return ctx.id || '';
}
function _authUid() { return window._auth?.currentUser?.uid || ''; }

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

// ── Horarios ──────────────────────────────────────────────────
/** Escucha en tiempo real los horarios de una semana para una plaza. */
export function onHorariosSemanales(plaza, semana, callback) {
  const eid = _eid();
  let q = db.collection(COL_HORARIOS)
    .where('plaza', '==', plaza)
    .where('semanaInicio', '==', semana);
  if (eid) q = q.where('empresaId', '==', eid);
  return q.onSnapshot(
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err  => { console.warn('[horarios]', err?.message); callback([]); }
  );
}

/** Guarda o actualiza el horario de un usuario para una semana. */
export async function guardarHorario(usuarioId, plaza, semana, dias, meta = {}) {
  const eid = _eid();
  const fv  = _fv();
  let q = db.collection(COL_HORARIOS)
    .where('usuarioId', '==', usuarioId)
    .where('plaza', '==', plaza)
    .where('semanaInicio', '==', semana);
  if (eid) q = q.where('empresaId', '==', eid);
  const snap = await q.limit(1).get();

  const base = {
    usuarioId,
    usuarioNombre:  String(meta.nombre || '').trim(),
    usuarioRol:     String(meta.rol    || '').toUpperCase(),
    plaza,
    semanaInicio:   semana,
    dias,
    ...(eid ? { empresaId: eid } : {}),
    actualizadoPor: _authUid(),
    actualizadoEn:  fv ? fv.serverTimestamp() : Date.now(),
  };

  if (snap.empty) {
    base.creadoEn = fv ? fv.serverTimestamp() : Date.now();
    const ref = await db.collection(COL_HORARIOS).add(base);
    return ref.id;
  }
  await snap.docs[0].ref.update(base);
  return snap.docs[0].id;
}

/** Horario de un usuario para una semana (one-shot). */
export async function getMiHorario(usuarioId, plaza, semana) {
  const eid = _eid();
  let q = db.collection(COL_HORARIOS)
    .where('usuarioId', '==', usuarioId)
    .where('plaza', '==', plaza)
    .where('semanaInicio', '==', semana);
  if (eid) q = q.where('empresaId', '==', eid);
  const snap = await q.limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ── Asistencia ────────────────────────────────────────────────
/** Escucha asistencia de una plaza en un rango de fechas. */
export function onAsistencia(plaza, fechaInicio, fechaFin, callback) {
  const eid = _eid();
  let q = db.collection(COL_ASISTENCIA)
    .where('plaza', '==', plaza)
    .where('fecha', '>=', fechaInicio)
    .where('fecha', '<=', fechaFin);
  if (eid) q = q.where('empresaId', '==', eid);
  return q.onSnapshot(
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err  => { console.warn('[asistencia]', err?.message); callback([]); }
  );
}

/** Registra o actualiza la asistencia de un usuario en una fecha. */
export async function registrarAsistencia(usuarioId, plaza, fecha, estado, opts = {}) {
  const eid = _eid();
  const fv  = _fv();
  let q = db.collection(COL_ASISTENCIA)
    .where('usuarioId', '==', usuarioId)
    .where('plaza', '==', plaza)
    .where('fecha', '==', fecha);
  if (eid) q = q.where('empresaId', '==', eid);
  const snap = await q.limit(1).get();

  const base = {
    usuarioId,
    usuarioNombre:  String(opts.nombre || '').trim(),
    plaza,
    fecha,
    estado,
    nota:          String(opts.nota    || '').trim(),
    turnoId:       opts.turnoId || null,
    ...(eid ? { empresaId: eid } : {}),
    registradoPor: _authUid(),
    registradoEn:  fv ? fv.serverTimestamp() : Date.now(),
  };

  if (snap.empty) {
    const ref = await db.collection(COL_ASISTENCIA).add(base);
    return ref.id;
  }
  await snap.docs[0].ref.update(base);
  return snap.docs[0].id;
}

// ── Historial de turnos ───────────────────────────────────────
/** Trae los últimos 'limit' turnos CERRADOS de la plaza (o del usuario). */
export async function getHistorialTurnos(plaza, opts = {}) {
  const eid = _eid();
  const lim = opts.limit || 40;
  let q = db.collection('turnos').where('estado', '==', 'CERRADO');
  if (plaza) q = q.where('plazaId', '==', plaza);
  if (eid)   q = q.where('empresaId', '==', eid);
  if (opts.usuarioId) q = q.where('usuarioId', '==', opts.usuarioId);
  q = q.orderBy('inicio', 'desc').limit(lim);
  const snap = await q.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Plantillas predefinidas ───────────────────────────────────
const COL_PLANTILLAS = 'horarios_plantillas';

export function onPlantillas(callback) {
  const eid = _eid();
  let q = db.collection(COL_PLANTILLAS);
  if (eid) q = q.where('empresaId', '==', eid);
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
  const eid = _eid();
  const fv  = _fv();
  const base = {
    nombre: String(nombre).trim(),
    inicio: String(inicio).trim(),
    fin:    String(fin).trim(),
    ...(eid ? { empresaId: eid } : {}),
    actualizadoPor: _authUid(),
    actualizadoEn:  fv ? fv.serverTimestamp() : Date.now(),
  };
  if (id) {
    await db.collection(COL_PLANTILLAS).doc(id).update(base);
    return id;
  }
  base.creadoEn = fv ? fv.serverTimestamp() : Date.now();
  const ref = await db.collection(COL_PLANTILLAS).add(base);
  return ref.id;
}

export async function eliminarPlantilla(id) {
  if (!id) return;
  await db.collection(COL_PLANTILLAS).doc(id).delete();
}

// ── Notas generales de semana ─────────────────────────────────
const COL_NOTAS_SEM = 'notas_semana';

function _notasSemId(plaza, semana) {
  return `${String(plaza).toLowerCase().replace(/[^a-z0-9]/g, '_')}_${semana}`;
}

export function onNotasSemana(plaza, semana, callback) {
  const docId = _notasSemId(plaza, semana);
  return db.collection(COL_NOTAS_SEM).doc(docId).onSnapshot(
    snap => callback(snap.exists ? (snap.data()?.notas || {}) : {}),
    err  => { console.warn('[notas_semana]', err?.message); callback({}); }
  );
}

export async function guardarNotaSemana(plaza, semana, diaKey, nota) {
  const eid   = _eid();
  const fv    = _fv();
  const docId = _notasSemId(plaza, semana);
  const ref   = db.collection(COL_NOTAS_SEM).doc(docId);
  const snap  = await ref.get();
  if (!snap.exists) {
    await ref.set({
      plaza,
      semana,
      ...(eid ? { empresaId: eid } : {}),
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
  const eid = _eid();
  if (!plaza) return [];
  let q = db.collection('usuarios');
  if (eid) {
    q = q.where('empresaId', '==', eid);
  }
  const snap = await q.limit(150).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(u => {
      const p = String(u.plazaAsignada || u.plaza || u.plazaId || '').toUpperCase();
      return p === String(plaza).toUpperCase();
    })
    .sort((a, b) => String(a.nombreCompleto || a.nombre || a.id).localeCompare(String(b.nombreCompleto || b.nombre || b.id)));
}
