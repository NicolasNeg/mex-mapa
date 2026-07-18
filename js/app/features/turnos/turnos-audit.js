// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/turnos-audit.js
//  Bitácora de personal (quién marca asistencias / cambia horarios).
//  Escribe a COL.LOGS con tipo:'TURNO' + subtipo, para alimentar la
//  vista "Historial de cambios" (pantalla 4, solo admins).
// ═══════════════════════════════════════════════════════════

import { db, COL } from '/js/core/database.js';

function _fv() { return window.firebase?.firestore?.FieldValue; }
function _authUid() { return window._auth?.currentUser?.uid || ''; }

function _responsable() {
  const rec = window.__mexCurrentUserRecord || {};
  const au = window._auth?.currentUser || {};
  return String(
    rec.nombreCompleto || rec.nombre || au.displayName || au.email || 'Sistema'
  ).trim();
}

function _empresaId() {
  return String(
    window._empresaActual?.id || window.MEX_CONFIG?.empresa?.id || window.__mexEmpresaId || ''
  ).trim();
}

/** Etiquetas legibles por subtipo de hecho (para badges de la pantalla 4). */
export const HECHO_LABEL = Object.freeze({
  FALTA:            'Falta',
  PRESENTE:         'Asistencia',
  TARDE:            'Retardo',
  AUSENTE:          'Falta',
  JUSTIFICADO:      'Permiso',
  DESCANSO:         'Descanso asignado',
  PERMISO:          'Permiso',
  VACACIONES:       'Vacaciones',
  FESTIVO:          'Festivo',
  CAMBIO_HORARIO:   'Cambio de horario',
  NOTA:             'Nota',
  NOTA_EDITADA:     'Nota editada',
  NOTA_ELIMINADA:   'Nota eliminada',
  TURNO_INICIO:     'Inicio de turno',
  TURNO_FIN:        'Fin de turno',
});

/**
 * Registra un hecho de personal en la bitácora.
 * Escribe DIRECTO a COL.LOGS con campos estructurados (el `_registrarLog`
 * legacy descarta los campos que necesita la pantalla de auditoría).
 * @param {object} p
 * @param {string} p.hecho     - clave de HECHO_LABEL (FALTA, DESCANSO, CAMBIO_HORARIO…)
 * @param {string} p.plaza
 * @param {string} p.empleado  - nombre del colaborador afectado
 * @param {string} [p.empleadoUid]
 * @param {string} [p.fecha]   - 'YYYY-MM-DD' del hecho
 * @param {string} [p.nota]
 * @param {object} [p.detalle] - datos extra (estado, horario, etc.)
 */
export async function registrarHechoTurno(p = {}) {
  const hecho = String(p.hecho || 'NOTA').toUpperCase().trim();
  const responsable = _responsable();
  const plaza = String(p.plaza || '').toUpperCase().trim();
  const empleado = String(p.empleado || '').trim();
  const empleadoUid = String(p.empleadoUid || '').trim();
  const fechaHecho = String(p.fecha || '').slice(0, 10);
  const nota = String(p.nota || '').trim();
  const accion = `${HECHO_LABEL[hecho] || hecho}: ${empleado}${fechaHecho ? ` · ${fechaHecho}` : ''}`;

  try {
    const fv = _fv();
    const payload = {
      tipo: 'TURNO',
      subtipo: hecho,
      hechoLabel: HECHO_LABEL[hecho] || hecho,
      accion,
      autor: responsable,
      responsable,
      responsableUid: _authUid(),
      empleado,
      empleadoUid,
      id_empleado: empleadoUid,
      created_by: _authUid(),
      fechaHecho,
      nota,
      plaza,
      empresaId: _empresaId(),
      fecha: new Date().toLocaleString('es-MX'),
      timestamp: Date.now(),
      serverTs: fv ? fv.serverTimestamp() : Date.now(),
      detalle: p.detalle || {},
    };
    await db.collection(COL.LOGS).add(payload);
  } catch (e) {
    console.warn('[turnos-audit] no se pudo registrar hecho', e?.message);
  }
}

function _toMs(ts) {
  if (ts == null) return 0;
  if (typeof ts === 'object' && 'seconds' in ts) return ts.seconds * 1000;
  if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts;
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Lee la bitácora de personal (hechos tipo TURNO) para la pantalla de
 * auditoría (pantalla 4). Filtra por plaza/empresa en cliente para no
 * depender de índices compuestos.
 * @param {{ plaza?: string, empresaId?: string, limit?: number }} [opts]
 */
export async function getHistorialHechos(opts = {}) {
  const limit = opts.limit || 500;
  const plaza = String(opts.plaza || '').toUpperCase().trim();
  const empresaId = String(opts.empresaId || _empresaId() || '').trim();

  let snap;
  try {
    snap = await db.collection(COL.LOGS)
      .where('tipo', '==', 'TURNO')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
  } catch (err) {
    // Índice compuesto pendiente → fallback sin orderBy (se ordena en cliente).
    console.warn('[turnos-audit] getHistorialHechos fallback', err?.message);
    snap = await db.collection(COL.LOGS)
      .where('tipo', '==', 'TURNO')
      .limit(limit)
      .get();
  }

  let rows = snap.docs.map(d => {
    const x = d.data() || {};
    const ex = x.extra || {};
    return {
      id: d.id,
      timestampMs: _toMs(x.timestamp || x.serverTs),
      hecho: String(x.subtipo || ex.subtipo || '').toUpperCase(),
      hechoLabel: x.hechoLabel || ex.hechoLabel || '',
      empleado: x.empleado || ex.empleado || '',
      empleadoUid: x.empleadoUid || ex.empleadoUid || x.id_empleado || '',
      responsable: x.responsable || x.autor || ex.responsable || 'Sistema',
      nota: x.nota || ex.nota || '',
      fechaHecho: x.fechaHecho || ex.fechaHecho || '',
      created_by: x.created_by || ex.created_by || x.responsableUid || '',
      id_empleado: x.id_empleado || ex.id_empleado || x.empleadoUid || '',
      accion: x.accion || '',
      plaza: String(x.plaza || '').toUpperCase(),
      empresaId: String(x.empresaId || ''),
    };
  });

  if (plaza && plaza !== 'TODAS') rows = rows.filter(r => !r.plaza || r.plaza === plaza);
  if (empresaId) rows = rows.filter(r => !r.empresaId || r.empresaId === empresaId);
  rows.sort((a, b) => b.timestampMs - a.timestampMs);
  return rows;
}
