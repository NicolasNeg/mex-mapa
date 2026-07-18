// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/notas-asistencia-data.js
//  Incidencias / notas por día+colaborador (Falta, Permiso,
//  Descanso, Vacaciones, Festivo, Nota) — alimenta el calendario
//  del historial y la auditoría de personal.
//
//  Schema notas_asistencia/{plaza_fecha_uid}
//    { usuarioId, usuarioNombre, plaza, fecha, tipo, nota, imagenUrl?,
//      autor, autorUid, editor?, editorUid?, creadoEn, actualizadoEn }
// ═══════════════════════════════════════════════════════════

import { db, COL } from '/js/core/database.js';
import { isFirestoreIndexError, listenerErrorFrom } from '/js/app/features/turnos/turnos-view-model.js';
import { registrarHechoTurno } from '/js/app/features/turnos/turnos-audit.js';

function _fv() { return window.firebase?.firestore?.FieldValue; }
function _authUid() { return window._auth?.currentUser?.uid || ''; }
function _autorNombre() {
  const rec = window.__mexCurrentUserRecord || {};
  const au = window._auth?.currentUser || {};
  return String(rec.nombreCompleto || rec.nombre || au.displayName || au.email || 'Sistema').trim();
}

function _slug(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }

/** Tipos válidos de incidencia (paridad ChecadorGLOBAL). */
export const TIPOS_NOTA = Object.freeze({
  presente:    { label: 'Asistencia',  hecho: 'PRESENTE' },
  retardo:     { label: 'Retardo',     hecho: 'TARDE' },
  falta:       { label: 'Falta',       hecho: 'FALTA' },
  permiso:     { label: 'Permiso',     hecho: 'PERMISO' },
  justificacion: { label: 'Justificación', hecho: 'JUSTIFICADO' },
  vacaciones:  { label: 'Vacaciones',  hecho: 'VACACIONES' },
  festivo:     { label: 'Festivo',     hecho: 'FESTIVO' },
  descanso:    { label: 'Descanso',    hecho: 'DESCANSO' },
  nota:        { label: 'Nota',        hecho: 'NOTA' },
});

export function notaDocId(plaza, fecha, usuarioId) {
  return `${_slug(String(plaza).toLowerCase())}_${String(fecha).slice(0, 10)}_${_slug(usuarioId)}`;
}

/** Escucha notas de una plaza en un rango de fechas. */
export function onNotasAsistencia(plaza, desde, hasta, callback) {
  const q = db.collection(COL.NOTAS_ASISTENCIA)
    .where('plaza', '==', String(plaza).toUpperCase().trim())
    .where('fecha', '>=', desde)
    .where('fecha', '<=', hasta);
  return q.onSnapshot(
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })), null),
    err => {
      console.warn('[notas_asistencia]', err?.message);
      callback([], listenerErrorFrom(err, 'notas_asistencia'));
    }
  );
}

/** Trae notas de una plaza en un rango (one-shot). Plaza 'TODAS' → todas. */
export async function getNotasRango(plaza, desde, hasta) {
  const p = String(plaza || '').toUpperCase().trim();
  if (!p) return [];
  try {
    let q = db.collection(COL.NOTAS_ASISTENCIA);
    if (p !== 'TODAS') q = q.where('plaza', '==', p);
    q = q.where('fecha', '>=', String(desde).slice(0, 10))
         .where('fecha', '<=', String(hasta).slice(0, 10));
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    if (isFirestoreIndexError(err)) {
      const e = new Error('INDEX_MISSING'); e.code = 'INDEX_MISSING'; e.cause = err;
      throw e;
    }
    throw err;
  }
}

/** Trae notas de un colaborador en un rango (one-shot). */
export async function getNotasColaborador(plaza, usuarioId, desde, hasta) {
  const uid = String(usuarioId || '').trim();
  if (!uid) return [];
  try {
    const snap = await db.collection(COL.NOTAS_ASISTENCIA)
      .where('plaza', '==', String(plaza).toUpperCase().trim())
      .where('usuarioId', '==', uid)
      .where('fecha', '>=', desde)
      .where('fecha', '<=', hasta)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    if (isFirestoreIndexError(err)) {
      const e = new Error('INDEX_MISSING'); e.code = 'INDEX_MISSING'; e.cause = err;
      throw e;
    }
    throw err;
  }
}

/**
 * Crea o actualiza una nota/incidencia por día. Registra auditoría.
 * @param {object} p { plaza, usuarioId, usuarioNombre, fecha, tipo, nota, imagenUrl? }
 */
export async function guardarNotaAsistencia(p = {}) {
  const plaza = String(p.plaza || '').toUpperCase().trim();
  const usuarioId = String(p.usuarioId || '').trim();
  const fecha = String(p.fecha || '').slice(0, 10);
  const tipo = String(p.tipo || 'nota').toLowerCase().trim();
  if (!plaza || !usuarioId || !fecha) throw new Error('Nota de asistencia incompleta.');
  if (!TIPOS_NOTA[tipo]) throw new Error(`Tipo de nota inválido: ${tipo}`);

  const fv = _fv();
  const docId = notaDocId(plaza, fecha, usuarioId);
  const ref = db.collection(COL.NOTAS_ASISTENCIA).doc(docId);
  const snap = await ref.get();
  const autor = _autorNombre();

  const base = {
    usuarioId,
    usuarioNombre: String(p.usuarioNombre || '').trim(),
    plaza,
    fecha,
    tipo,
    nota: String(p.nota || '').trim(),
    imagenUrl: p.imagenUrl ? String(p.imagenUrl) : null,
    actualizadoEn: fv ? fv.serverTimestamp() : Date.now(),
    editor: autor,
    editorUid: _authUid(),
  };

  const esNuevo = !snap.exists;
  if (esNuevo) {
    base.creadoEn = fv ? fv.serverTimestamp() : Date.now();
    base.autor = autor;
    base.autorUid = _authUid();
    await ref.set(base);
  } else {
    await ref.update(base);
  }

  await registrarHechoTurno({
    hecho: esNuevo ? TIPOS_NOTA[tipo].hecho : 'NOTA_EDITADA',
    plaza,
    empleado: base.usuarioNombre || usuarioId,
    empleadoUid: usuarioId,
    fecha,
    nota: base.nota,
    detalle: { tipo, estado: TIPOS_NOTA[tipo].label },
  });

  return docId;
}

/** Elimina una nota/incidencia. Registra auditoría. */
export async function eliminarNotaAsistencia(plaza, fecha, usuarioId, meta = {}) {
  const p = String(plaza || '').toUpperCase().trim();
  const f = String(fecha || '').slice(0, 10);
  const uid = String(usuarioId || '').trim();
  if (!p || !f || !uid) return;
  await db.collection(COL.NOTAS_ASISTENCIA).doc(notaDocId(p, f, uid)).delete();
  await registrarHechoTurno({
    hecho: 'NOTA_ELIMINADA',
    plaza: p,
    empleado: String(meta.usuarioNombre || uid).trim(),
    empleadoUid: uid,
    fecha: f,
  });
}
