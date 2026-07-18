// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/horarios-data.js
//  Gestión de horarios semanales y registro de asistencia.
//
//  Schema horarios/{id}  — id determinístico: {plaza}_{semana}_{uid}
//  Schema asistencia/{id}
// ═══════════════════════════════════════════════════════════

import { db, COL } from '/js/core/database.js';
import { isFirestoreIndexError, listenerErrorFrom, normalizePlazaUsuario } from '/js/app/features/turnos/turnos-view-model.js';
import { PALETA } from '/js/app/features/turnos/turno-color.js';

export { isFirestoreIndexError, listenerErrorFrom };

export const TIPOS_DIA = Object.freeze({
  NORMAL:      { label: 'Normal',       color: '#6366f1' },
  DESCANSO:    { label: 'Descanso',     color: '#94a3b8' },
  VACACIONES:  { label: 'Vacaciones',   color: '#10b981' },
  FESTIVO:     { label: 'Festivo',      color: '#f59e0b' },
});

export const ESTADOS_ASISTENCIA = Object.freeze({
  PENDIENTE:   { label: 'Por confirmar', color: '#f59e0b' },
  PRESENTE:    { label: 'Presente',      color: '#10b981' },
  AUSENTE:     { label: 'Ausente',       color: '#ef4444' },
  TARDE:       { label: 'Tarde',         color: '#f59e0b' },
  JUSTIFICADO: { label: 'Justificado',   color: '#3b82f6' },
  DESCANSO:    { label: 'Descanso',      color: '#94a3b8' },
});

/** Estados ya confirmados por admin — el check-in no los pisa. */
export const ESTADOS_ASISTENCIA_CONFIRMADOS = Object.freeze([
  'PRESENTE', 'AUSENTE', 'TARDE', 'JUSTIFICADO', 'DESCANSO'
]);

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

/** Hoy como YYYY-MM-DD en zona local (no UTC). */
export function hoy() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

/** Valida y normaliza una celda de día. Devuelve null si se debe borrar. */
export function validarCelda(raw) {
  if (raw == null || raw === '' || raw === false) return null;
  const tipo = String(raw.tipo || '').toUpperCase().trim();
  if (!tipo || tipo === 'VACIO' || tipo === 'NONE') return null;

  if (tipo === 'NORMAL') {
    const inicio = String(raw.inicio || '').trim();
    const fin = String(raw.fin || '').trim();
    if (!/^\d{1,2}:\d{2}$/.test(inicio) || !/^\d{1,2}:\d{2}$/.test(fin)) {
      throw new Error('Horario NORMAL requiere inicio y fin (HH:MM).');
    }
    const cell = { tipo: 'NORMAL', inicio, fin };
    if (raw.plantillaId) cell.plantillaId = String(raw.plantillaId);
    if (raw.nota) cell.nota = String(raw.nota).trim();
    if (Number.isFinite(raw.pausaMin)) cell.pausaMin = Math.max(0, Number(raw.pausaMin));
    return cell;
  }

  if (!TIPOS_DIA[tipo]) {
    throw new Error(`Tipo de día inválido: ${tipo}`);
  }
  const cell = { tipo };
  if (raw.nota) cell.nota = String(raw.nota).trim();
  return cell;
}

/** Minutos netos de una celda NORMAL (resta pausa). */
export function minutosCelda(cell) {
  if (!cell || cell.tipo !== 'NORMAL') return 0;
  const parse = (s) => {
    const [h, m] = String(s || '0:0').split(':').map(Number);
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  };
  const a = parse(cell.inicio);
  const b = parse(cell.fin);
  if (b <= a) return 0;
  const pausa = Math.max(0, Number(cell.pausaMin) || 0);
  return Math.max(0, b - a - pausa);
}

/** Guarda o actualiza el horario de un usuario para una semana. */
export async function guardarHorario(usuarioId, plaza, semana, dias, meta = {}) {
  const fv = _fv();
  const docId = horarioDocId(plaza, semana, usuarioId);
  const ref = db.collection(COL.HORARIOS).doc(docId);
  const snap = await ref.get();

  // Validar cada celda para no persistir basura
  const diasClean = {};
  for (const [k, v] of Object.entries(dias || {})) {
    if (!DIAS.includes(k)) continue;
    const cell = validarCelda(v);
    if (cell) diasClean[k] = cell;
  }

  const base = {
    usuarioId,
    usuarioNombre:  String(meta.nombre || '').trim(),
    usuarioRol:     String(meta.rol    || '').toUpperCase(),
    plaza,
    semanaInicio:   semana,
    dias: diasClean,
    actualizadoPor: _authUid(),
    actualizadoEn:  fv ? fv.serverTimestamp() : Date.now(),
  };

  if (!snap.exists) {
    base.creadoEn = fv ? fv.serverTimestamp() : Date.now();
    base.version = 1;
    await ref.set(base);
  } else {
    base.version = (Number(snap.data()?.version) || 0) + 1;
    await ref.update(base);
  }
  return docId;
}

/**
 * Patch atómico de una sola celda (evita pisar ediciones concurrentes).
 * cellData = null | false → borra la celda.
 */
export async function guardarHorarioCelda(usuarioId, plaza, semana, diaKey, cellData, meta = {}) {
  if (!DIAS.includes(diaKey)) throw new Error(`Día inválido: ${diaKey}`);
  const fv = _fv();
  const docId = horarioDocId(plaza, semana, usuarioId);
  const ref = db.collection(COL.HORARIOS).doc(docId);
  const snap = await ref.get();
  const cell = validarCelda(cellData);

  if (!snap.exists) {
    const dias = {};
    if (cell) dias[diaKey] = cell;
    await ref.set({
      usuarioId,
      usuarioNombre: String(meta.nombre || '').trim(),
      usuarioRol: String(meta.rol || '').toUpperCase(),
      plaza,
      semanaInicio: semana,
      dias,
      version: 1,
      creadoEn: fv ? fv.serverTimestamp() : Date.now(),
      actualizadoPor: _authUid(),
      actualizadoEn: fv ? fv.serverTimestamp() : Date.now(),
    });
    return docId;
  }

  const prev = snap.data() || {};
  const patch = {
    actualizadoPor: _authUid(),
    actualizadoEn: fv ? fv.serverTimestamp() : Date.now(),
    version: (Number(prev.version) || 0) + 1,
  };
  if (meta.nombre) patch.usuarioNombre = String(meta.nombre).trim();
  if (meta.rol) patch.usuarioRol = String(meta.rol).toUpperCase();

  if (cell) {
    patch[`dias.${diaKey}`] = cell;
  } else if (fv?.delete) {
    patch[`dias.${diaKey}`] = fv.delete();
  } else {
    // Fallback sin FieldValue.delete: reescribe dias sin la clave
    const dias = { ...(prev.dias || {}) };
    delete dias[diaKey];
    patch.dias = dias;
  }

  await ref.update(patch);
  return docId;
}

/** Copia todos los horarios de la semana anterior a semanaDestino. */
export async function copiarSemanaAnterior(plaza, semanaDestino) {
  const p = String(plaza || '').trim();
  const destino = String(semanaDestino || '').slice(0, 10);
  if (!p || !destino) throw new Error('Plaza y semana requeridas.');

  const origen = moverSemana(destino, -1);
  const snap = await db.collection(COL.HORARIOS)
    .where('plaza', '==', p)
    .where('semanaInicio', '==', origen)
    .get();

  if (snap.empty) {
    return { count: 0, semanaOrigen: origen };
  }

  const fv = _fv();
  const batch = db.batch();
  let count = 0;

  snap.docs.forEach(doc => {
    const data = doc.data() || {};
    const usuarioId = data.usuarioId;
    if (!usuarioId) return;
    const ref = db.collection(COL.HORARIOS).doc(horarioDocId(p, destino, usuarioId));
    batch.set(ref, {
      usuarioId,
      usuarioNombre: String(data.usuarioNombre || '').trim(),
      usuarioRol: String(data.usuarioRol || '').toUpperCase(),
      plaza: p,
      semanaInicio: destino,
      dias: data.dias || {},
      actualizadoPor: _authUid(),
      actualizadoEn: fv ? fv.serverTimestamp() : Date.now(),
      creadoEn: fv ? fv.serverTimestamp() : Date.now()
    }, { merge: true });
    count += 1;
  });

  if (count) await batch.commit();
  return { count, semanaOrigen: origen };
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
  const uid = String(usuarioId || '').trim();
  const p = String(plaza || '').trim();
  const f = String(fecha || '').slice(0, 10);
  const est = String(estado || '').toUpperCase().trim();
  if (!uid || !p || !f || !est) throw new Error('Asistencia incompleta.');

  let q = db.collection(COL.ASISTENCIA)
    .where('usuarioId', '==', uid)
    .where('plaza', '==', p)
    .where('fecha', '==', f);
  const snap = await q.limit(1).get();

  const base = {
    usuarioId: uid,
    usuarioNombre: String(opts.nombre || '').trim(),
    plaza: p,
    fecha: f,
    estado: est,
    nota: String(opts.nota || '').trim(),
    turnoId: opts.turnoId || null,
    origen: String(opts.origen || 'MANUAL').toUpperCase(),
    registradoPor: _authUid(),
    registradoEn: fv ? fv.serverTimestamp() : Date.now(),
  };

  if (opts.confirmadoPor) {
    base.confirmadoPor = opts.confirmadoPor;
    base.confirmadoEn = fv ? fv.serverTimestamp() : Date.now();
  }

  if (snap.empty) {
    const ref = await db.collection(COL.ASISTENCIA).add(base);
    return ref.id;
  }
  await snap.docs[0].ref.update(base);
  return snap.docs[0].id;
}

/**
 * Check-in: crea asistencia PENDIENTE (por confirmar admin).
 * No pisa registros ya confirmados (PRESENTE/AUSENTE/…).
 */
export async function registrarAsistenciaDesdeCheckin(usuarioId, plaza, fecha, opts = {}) {
  const uid = String(usuarioId || '').trim();
  const p = String(plaza || '').trim();
  const f = String(fecha || hoy()).slice(0, 10);
  if (!uid || !p) throw new Error('Asistencia incompleta.');

  const snap = await db.collection(COL.ASISTENCIA)
    .where('usuarioId', '==', uid)
    .where('plaza', '==', p)
    .where('fecha', '==', f)
    .limit(1)
    .get();

  if (!snap.empty) {
    const data = snap.docs[0].data() || {};
    const actual = String(data.estado || '').toUpperCase();
    if (ESTADOS_ASISTENCIA_CONFIRMADOS.includes(actual)) {
      return { id: snap.docs[0].id, skipped: true, reason: 'CONFIRMADO', estado: actual };
    }
    // Ya pendiente: solo refresca turnoId / timestamp
    const fv = _fv();
    await snap.docs[0].ref.update({
      estado: 'PENDIENTE',
      turnoId: opts.turnoId || data.turnoId || null,
      origen: 'CHECKIN',
      registradoPor: _authUid(),
      registradoEn: fv ? fv.serverTimestamp() : Date.now(),
      usuarioNombre: String(opts.nombre || data.usuarioNombre || '').trim()
    });
    return { id: snap.docs[0].id, skipped: false, estado: 'PENDIENTE' };
  }

  const id = await registrarAsistencia(uid, p, f, 'PENDIENTE', {
    ...opts,
    origen: 'CHECKIN'
  });
  return { id, skipped: false, estado: 'PENDIENTE' };
}

/** Admin confirma o ajusta un registro pendiente. */
export async function confirmarAsistencia(usuarioId, plaza, fecha, estadoFinal, opts = {}) {
  const est = String(estadoFinal || 'PRESENTE').toUpperCase().trim();
  if (!ESTADOS_ASISTENCIA_CONFIRMADOS.includes(est)) {
    throw new Error('Estado de confirmación inválido.');
  }
  return registrarAsistencia(usuarioId, plaza, fecha, est, {
    ...opts,
    origen: opts.origen || 'CONFIRMACION',
    confirmadoPor: _authUid()
  });
}

// ── Historial de turnos ───────────────────────────────────────
/** Trae turnos CERRADOS de un usuario en rango de fechas (historial por colaborador). */
export async function getHistorialTurnos(plaza, opts = {}) {
  const lim = opts.limit || 80;
  const usuarioId = String(opts.usuarioId || '').trim();
  if (!usuarioId) return [];

  const desde = String(opts.desde || '').slice(0, 10);
  const hasta = String(opts.hasta || '').slice(0, 10);
  const Timestamp = window.firebase?.firestore?.Timestamp;

  let q = db.collection(COL.TURNOS)
    .where('estado', '==', 'CERRADO')
    .where('usuarioId', '==', usuarioId);

  if (desde) {
    const start = Timestamp?.fromDate?.(new Date(`${desde}T00:00:00`))
      || new Date(`${desde}T00:00:00`);
    q = q.where('inicio', '>=', start);
  }
  if (hasta) {
    const end = Timestamp?.fromDate?.(new Date(`${hasta}T23:59:59.999`))
      || new Date(`${hasta}T23:59:59.999`);
    q = q.where('inicio', '<=', end);
  }

  q = q.orderBy('inicio', 'desc').limit(lim);

  try {
    const snap = await q.get();
    let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const p = String(plaza || '').trim();
    if (p) {
      rows = rows.filter(r => String(r.plazaId || r.plaza || '').toUpperCase() === p.toUpperCase());
    }
    return rows;
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

/**
 * Catálogo de turnos (plantillas) — paridad ChecadorGLOBAL.
 * @param {string} nombre
 * @param {string} inicio HH:MM
 * @param {string} fin HH:MM
 * @param {string|null} id
 * @param {{ color?: string, pausaMin?: number }} [extra]
 */
export async function guardarPlantilla(nombre, inicio, fin, id = null, extra = {}) {
  const fv = _fv();
  const base = {
    nombre: String(nombre).trim(),
    inicio: String(inicio).trim(),
    fin:    String(fin).trim(),
    actualizadoPor: _authUid(),
    actualizadoEn:  fv ? fv.serverTimestamp() : Date.now(),
  };
  if (extra.color) base.color = String(extra.color).trim();
  if (Number.isFinite(extra.pausaMin)) {
    base.pausaMin = Math.max(0, Number(extra.pausaMin));
  }
  if (id) {
    await db.collection(COL.HORARIOS_PLANTILLAS).doc(id).update(base);
    return id;
  }
  // Color por defecto de paleta si no se indica
  if (!base.color) {
    const n = (await db.collection(COL.HORARIOS_PLANTILLAS).get()).size;
    base.color = PALETA[n % PALETA.length];
  }
  base.pausaMin = base.pausaMin ?? 0;
  base.activo = true;
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
