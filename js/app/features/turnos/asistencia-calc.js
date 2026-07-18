// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/asistencia-calc.js
//  Núcleo puro de derivación de estado diario de asistencia.
//  Port del modelo de ChecadorGLOBAL (historial-calc / estadoCelda)
//  adaptado al modelo de MapGestion (turnos jornada + asistencia +
//  horarios semanales + notas_asistencia).
//
//  Sin dependencia de Firestore: 100% testeable en aislamiento.
// ═══════════════════════════════════════════════════════════

import { DIAS } from '/js/app/features/turnos/horarios-data.js';
import {
  normalizeUsuarioUid,
  nombreUsuario,
  turnoInicioDate,
  turnoFinDate,
} from '/js/app/features/turnos/turnos-view-model.js';

// ── Categorías canónicas (paridad leyenda del tablero) ────────
export const CAT = Object.freeze({
  ASISTENCIA: 'asistencia',   // presente / check-in a tiempo
  RETARDO:    'retardo',      // check-in tarde
  FALTA:      'falta',        // programado y no se presentó (día pasado)
  PERMISO:    'permiso',      // justificado / permiso / vacaciones
  DESCANSO:   'descanso',     // día de descanso / festivo
  SINASIGNAR: 'sinasignar',   // sin turno programado
  FUTURO:     'futuro',       // fecha futura (aún no ocurre)
});

export const CAT_META = Object.freeze({
  asistencia: { label: 'Asistencia', color: '#10b981' },
  retardo:    { label: 'Retardo',    color: '#f59e0b' },
  falta:      { label: 'Falta',      color: '#ef4444' },
  permiso:    { label: 'Permiso',    color: '#3b82f6' },
  descanso:   { label: 'Descanso',   color: '#94a3b8' },
  sinasignar: { label: 'Sin asignar', color: '#cbd5e1' },
  futuro:     { label: 'Futuro',     color: '#e2e8f0' },
});

/** Orden y categorías visibles como tiles/leyenda del tablero. */
export const CAT_ORDEN = Object.freeze([
  'asistencia', 'retardo', 'falta', 'permiso', 'descanso', 'sinasignar',
]);

/** Minutos de tolerancia por defecto antes de marcar retardo. */
export const TOLERANCIA_RETARDO_MIN = 10;

// ── Helpers de fecha (locales, sin UTC drift) ─────────────────
/** 'YYYY-MM-DD' local de un Date. */
export function ymd(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** diaKey ('lun'..'dom') de una fecha ISO 'YYYY-MM-DD'. */
export function diaKeyDeFecha(fechaIso) {
  const d = new Date(`${fechaIso}T12:00:00`);
  const js = d.getDay(); // 0=dom … 6=sab
  return js === 0 ? 'dom' : DIAS[js - 1];
}

/** Lunes ISO de la semana que contiene fechaIso. */
export function semanaDeFecha(fechaIso) {
  const d = new Date(`${fechaIso}T00:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return ymd(d);
}

/** Lista de fechas ISO entre desde..hasta (inclusive). */
export function fechasEnRango(desde, hasta) {
  const out = [];
  const start = new Date(`${desde}T00:00:00`);
  const end = new Date(`${hasta}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(ymd(d));
  }
  return out;
}

function _hhmmAMin(s) {
  const [h, m] = String(s || '').split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  return h * 60 + (Number(m) || 0);
}

// ── Mapeos de estado explícito ────────────────────────────────
/** asistencia.estado (registro admin) → categoría. */
function _catDeEstadoAsistencia(estado) {
  switch (String(estado || '').toUpperCase().trim()) {
    case 'PRESENTE':    return CAT.ASISTENCIA;
    case 'TARDE':       return CAT.RETARDO;
    case 'AUSENTE':     return CAT.FALTA;
    case 'JUSTIFICADO': return CAT.PERMISO;
    case 'DESCANSO':    return CAT.DESCANSO;
    case 'PENDIENTE':   return CAT.ASISTENCIA; // marcó entrada, falta confirmar
    default:            return null;
  }
}

/** notas_asistencia.tipo (incidencia) → categoría. */
function _catDeTipoNota(tipo) {
  switch (String(tipo || '').toLowerCase().trim()) {
    case 'falta':          return CAT.FALTA;
    case 'permiso':        return CAT.PERMISO;
    case 'justificacion':
    case 'justificación':  return CAT.PERMISO;
    case 'vacaciones':     return CAT.PERMISO;
    case 'festivo':        return CAT.DESCANSO;
    case 'descanso':       return CAT.DESCANSO;
    case 'presente':       return CAT.ASISTENCIA;
    case 'retardo':        return CAT.RETARDO;
    default:               return null;
  }
}

/** Celda de horario programado (tipo NORMAL/DESCANSO/…) → categoría "programada". */
function _catDeHorarioCelda(cell) {
  if (!cell) return null;
  const tipo = String(cell.tipo || '').toUpperCase().trim();
  if (tipo === 'DESCANSO') return CAT.DESCANSO;
  if (tipo === 'VACACIONES') return CAT.PERMISO;
  if (tipo === 'FESTIVO') return CAT.DESCANSO;
  if (tipo === 'NORMAL') return null; // programado a trabajar → depende de asistencia real
  return null;
}

/**
 * Deriva la categoría de un día para un colaborador.
 *
 * @param {object} args
 * @param {string} args.fecha          - 'YYYY-MM-DD'
 * @param {string} [args.hoyIso]       - hoy (default: hoy local)
 * @param {object} [args.turno]        - turno jornada del día (turnos/{id})
 * @param {object} [args.asistencia]   - override admin (asistencia/{id})
 * @param {object} [args.nota]         - incidencia (notas_asistencia/{id})
 * @param {object} [args.horarioCelda] - celda programada horarios.dias[dow]
 * @param {number} [args.toleranciaMin]
 * @returns {{ cat:string, label:string, color:string, fuente:string, detalle:object }}
 */
export function estadoDia({
  fecha,
  hoyIso = ymd(new Date()),
  turno = null,
  asistencia = null,
  nota = null,
  horarioCelda = null,
  toleranciaMin = TOLERANCIA_RETARDO_MIN,
} = {}) {
  const wrap = (cat, fuente, detalle = {}) => ({
    cat,
    label: CAT_META[cat]?.label || cat,
    color: CAT_META[cat]?.color || '#cbd5e1',
    fuente,
    detalle,
  });

  // 1) Override admin explícito (asistencia) — máxima prioridad.
  if (asistencia) {
    const c = _catDeEstadoAsistencia(asistencia.estado);
    if (c) return wrap(c, 'asistencia', { nota: asistencia.nota, estado: asistencia.estado });
  }

  // 2) Incidencia/nota explícita (falta, permiso, descanso…).
  if (nota) {
    const c = _catDeTipoNota(nota.tipo);
    if (c) return wrap(c, 'nota', { nota: nota.nota, tipo: nota.tipo });
  }

  // 3) Turno real (marcó entrada) → presente o retardo.
  if (turno) {
    const inicio = turnoInicioDate(turno);
    const progMin = _hhmmAMin(horarioCelda?.tipo === 'NORMAL' ? horarioCelda.inicio : null);
    if (progMin != null) {
      const realMin = inicio.getHours() * 60 + inicio.getMinutes();
      if (realMin > progMin + Math.max(0, toleranciaMin)) {
        return wrap(CAT.RETARDO, 'turno', { inicio, prog: horarioCelda?.inicio });
      }
    }
    return wrap(CAT.ASISTENCIA, 'turno', { inicio });
  }

  // 4) Horario programado no laborable (descanso/vacaciones/festivo).
  const catProg = _catDeHorarioCelda(horarioCelda);
  if (catProg) return wrap(catProg, 'horario', { tipo: horarioCelda?.tipo });

  // 5) Fecha futura → aún no ocurre.
  if (fecha > hoyIso) return wrap(CAT.FUTURO, 'futuro');

  // 6) Programado a trabajar (NORMAL) sin turno ni override:
  //    día pasado → falta; hoy → sin asignar (aún puede checar).
  if (horarioCelda?.tipo === 'NORMAL') {
    if (fecha < hoyIso) return wrap(CAT.FALTA, 'derivado', { prog: horarioCelda });
    return wrap(CAT.SINASIGNAR, 'programado-hoy', { prog: horarioCelda });
  }

  // 7) Sin turno programado.
  return wrap(CAT.SINASIGNAR, 'sin-programa');
}

// ── Indexadores (de arrays de Firestore a mapas por uid/fecha) ─
/** Índice de turnos por `${uid}|${ymd(inicio)}` (el más temprano gana). */
export function indexarTurnos(turnos = []) {
  const map = new Map();
  for (const t of turnos) {
    const uid = String(t.usuarioId || '').trim();
    if (!uid) continue;
    const f = ymd(turnoInicioDate(t));
    const key = `${uid}|${f}`;
    const prev = map.get(key);
    if (!prev || turnoInicioDate(t) < turnoInicioDate(prev)) map.set(key, t);
  }
  return map;
}

/** Índice de asistencia por `${uid}|${fecha}`. */
export function indexarAsistencia(asistencia = []) {
  const map = new Map();
  for (const a of asistencia) {
    const uid = String(a.usuarioId || '').trim();
    const f = String(a.fecha || '').slice(0, 10);
    if (uid && f) map.set(`${uid}|${f}`, a);
  }
  return map;
}

/** Índice de notas por `${uid}|${fecha}` (última gana). */
export function indexarNotas(notas = []) {
  const map = new Map();
  for (const n of notas) {
    const uid = String(n.usuarioId || '').trim();
    const f = String(n.fecha || '').slice(0, 10);
    if (uid && f) map.set(`${uid}|${f}`, n);
  }
  return map;
}

/**
 * Índice de celda programada por `${uid}|${fecha}` a partir de docs de horarios
 * (cada doc trae dias.{lun..dom} para una semana).
 */
export function indexarHorarios(horarios = []) {
  const map = new Map();
  for (const h of horarios) {
    const uid = String(h.usuarioId || '').trim();
    const semana = String(h.semanaInicio || '').slice(0, 10);
    if (!uid || !semana) continue;
    for (const diaKey of DIAS) {
      const cell = h.dias?.[diaKey];
      if (!cell) continue;
      const d = new Date(`${semana}T00:00:00`);
      d.setDate(d.getDate() + DIAS.indexOf(diaKey));
      map.set(`${uid}|${ymd(d)}`, cell);
    }
  }
  return map;
}

// ── Resumen vacío (6 categorías) ──────────────────────────────
export function resumenVacio() {
  return {
    asistencia: 0, retardo: 0, falta: 0,
    permiso: 0, descanso: 0, sinasignar: 0,
  };
}

/**
 * Construye el tablero mensual (heatmap) — pantalla 1.
 *
 * @param {object} args
 * @param {object[]} args.usuarios
 * @param {object[]} args.turnos
 * @param {object[]} args.asistencia
 * @param {object[]} args.notas
 * @param {object[]} args.horarios
 * @param {string} args.desde 'YYYY-MM-DD'
 * @param {string} args.hasta 'YYYY-MM-DD'
 * @param {string} [args.hoyIso]
 * @param {number} [args.toleranciaMin]
 * @returns {{ dias:{fecha,dia,diaSemana,esHoy,esFinde}[], filas:{usuario,celdas,resumen}[] }}
 */
export function tableroMes({
  usuarios = [],
  turnos = [],
  asistencia = [],
  notas = [],
  horarios = [],
  desde,
  hasta,
  hoyIso = ymd(new Date()),
  toleranciaMin = TOLERANCIA_RETARDO_MIN,
} = {}) {
  const fechas = fechasEnRango(desde, hasta);
  const idxTurno = indexarTurnos(turnos);
  const idxAsis = indexarAsistencia(asistencia);
  const idxNota = indexarNotas(notas);
  const idxHor = indexarHorarios(horarios);

  const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const dias = fechas.map((fecha) => {
    const d = new Date(`${fecha}T12:00:00`);
    const js = d.getDay();
    return {
      fecha,
      dia: d.getDate(),
      diaSemana: DOW[js],
      esHoy: fecha === hoyIso,
      esFinde: js === 0 || js === 6,
    };
  });

  const filas = usuarios.map((usuario) => {
    const uid = normalizeUsuarioUid(usuario);
    const resumen = resumenVacio();
    const celdas = fechas.map((fecha) => {
      const key = `${uid}|${fecha}`;
      const est = estadoDia({
        fecha,
        hoyIso,
        turno: idxTurno.get(key) || null,
        asistencia: idxAsis.get(key) || null,
        nota: idxNota.get(key) || null,
        horarioCelda: idxHor.get(key) || null,
        toleranciaMin,
      });
      if (Object.prototype.hasOwnProperty.call(resumen, est.cat)) {
        resumen[est.cat] += 1;
      }
      return { fecha, ...est };
    });
    return { usuario, uid, nombre: nombreUsuario(usuario), celdas, resumen };
  });

  return { dias, filas };
}

/**
 * Serie de días para el calendario de un colaborador — pantalla 2.
 * Devuelve un mapa fecha → estado, para pintar el mes completo.
 */
export function calendarioEmpleado({
  usuarioId,
  turnos = [],
  asistencia = [],
  notas = [],
  horarios = [],
  desde,
  hasta,
  hoyIso = ymd(new Date()),
  toleranciaMin = TOLERANCIA_RETARDO_MIN,
} = {}) {
  const uid = String(usuarioId || '').trim();
  const idxTurno = indexarTurnos(turnos);
  const idxAsis = indexarAsistencia(asistencia);
  const idxNota = indexarNotas(notas);
  const idxHor = indexarHorarios(horarios);

  const porFecha = {};
  const resumen = resumenVacio();
  for (const fecha of fechasEnRango(desde, hasta)) {
    const key = `${uid}|${fecha}`;
    const est = estadoDia({
      fecha,
      hoyIso,
      turno: idxTurno.get(key) || null,
      asistencia: idxAsis.get(key) || null,
      nota: idxNota.get(key) || null,
      horarioCelda: idxHor.get(key) || null,
      toleranciaMin,
    });
    porFecha[fecha] = est;
    if (Object.prototype.hasOwnProperty.call(resumen, est.cat)) resumen[est.cat] += 1;
  }
  return { porFecha, resumen };
}

/**
 * Semanas (matriz DOM..SÁB) que cubren el mes de `ancla` — pantalla 2.
 * Devuelve filas de 7 celdas; los días fuera del mes vienen con `fuera:true`.
 */
export function matrizCalendarioMes(anclaIso) {
  const ancla = new Date(`${anclaIso}T00:00:00`);
  const year = ancla.getFullYear();
  const month = ancla.getMonth();
  const primero = new Date(year, month, 1);
  const ultimo = new Date(year, month + 1, 0);

  // Empezar en domingo previo (o el mismo) al día 1.
  const start = new Date(primero);
  start.setDate(1 - primero.getDay());

  const semanas = [];
  const cursor = new Date(start);
  while (cursor <= ultimo || cursor.getDay() !== 0) {
    const semana = [];
    for (let i = 0; i < 7; i++) {
      semana.push({
        fecha: ymd(cursor),
        dia: cursor.getDate(),
        fuera: cursor.getMonth() !== month,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    semanas.push(semana);
    if (cursor > ultimo && cursor.getDay() === 0) break;
  }
  return { year, month, semanas };
}
