/**
 * Cola de preparación — escrituras Firestore + logs operativos (tipo COLA).
 */

import { db, COL } from '/js/core/database.js';
import { queueItemsRef } from '/js/app/features/cola-preparacion/cola-data.js';
import {
  CHECKLIST_KEYS,
  deriveEstadoCola,
  departureLabel,
  isItemReady
} from '/js/app/features/cola-preparacion/cola-view-model.js';

function fv() {
  return window.firebase?.firestore?.FieldValue;
}

function ts() {
  return window.firebase?.firestore?.Timestamp;
}

function normalizePlaza(plaza) {
  return String(plaza || '').toUpperCase().trim();
}

function normalizeMva(mva) {
  return String(mva || '').toUpperCase().trim();
}

async function registrarLogCola(accion, autor, plaza, extra = {}) {
  try {
    if (typeof window.api?.registrarLogCola === 'function') {
      await window.api.registrarLogCola(accion, autor, plaza, extra);
      return;
    }
    if (typeof window._mex?._registrarLog === 'function') {
      await window._mex._registrarLog('COLA', accion, autor, plaza, extra);
    }
  } catch (e) {
    console.warn('[cola-mutations] log failed', e);
  }
}

async function fetchCuadreSnapshot(plaza, mva) {
  const p = normalizePlaza(plaza);
  const m = normalizeMva(mva);
  if (!p || !m) return null;
  try {
    const [cuadreSnap, externosSnap] = await Promise.all([
      db.collection(COL.CUADRE).where('plaza', '==', p).where('mva', '==', m).limit(1).get(),
      db.collection(COL.EXTERNOS).where('plaza', '==', p).where('mva', '==', m).limit(1).get()
    ]);
    const doc = cuadreSnap.docs[0] || externosSnap.docs[0];
    if (!doc) return null;
    const data = doc.data() || {};
    return {
      estado: String(data.estado || '').trim(),
      ubicacion: String(data.ubicacion || '').trim(),
      gasolina: String(data.gasolina ?? '').trim()
    };
  } catch (_) {
    return null;
  }
}

function touchMeta(payload, actor) {
  const fieldValue = fv();
  if (!fieldValue) return payload;
  return {
    ...payload,
    actualizadoAt: fieldValue.serverTimestamp(),
    actualizadoPor: actor || ''
  };
}

function checklistAllTrue() {
  return CHECKLIST_KEYS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {});
}

/**
 * @param {{ mva: string, plaza: string, fechaSalida?: Date, asignado?: string, notas?: string, origen?: string, actor?: string, orden?: number }} opts
 */
export async function enqueueUnit({
  mva,
  plaza,
  fechaSalida,
  asignado = '',
  notas = '',
  origen = 'MANUAL',
  actor = '',
  orden = null
} = {}) {
  const p = normalizePlaza(plaza);
  const m = normalizeMva(mva);
  if (!p) throw new Error('Plaza requerida.');
  if (!m) throw new Error('MVA requerido.');

  const departure = fechaSalida instanceof Date && !Number.isNaN(fechaSalida.getTime())
    ? fechaSalida
    : new Date(Date.now() + 24 * 3600000);

  const ref = queueItemsRef(p).doc(m);
  const existing = await ref.get();
  if (existing.exists) {
    return { ok: true, itemId: m, alreadyExists: true };
  }

  const snapshot = await fetchCuadreSnapshot(p, m);
  const Timestamp = ts();
  const fieldValue = fv();
  const checklist = CHECKLIST_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {});

  let nextOrden = orden;
  if (!Number.isFinite(nextOrden)) {
    const allSnap = await queueItemsRef(p).get();
    nextOrden = allSnap.docs.reduce((acc, doc) => {
      const n = Number(doc.data()?.orden);
      return Number.isFinite(n) ? Math.max(acc, n) : acc;
    }, 0) + 1;
  }

  const payload = {
    mva: m,
    plaza: p,
    fechaSalida: Timestamp ? Timestamp.fromDate(departure) : departure,
    checklist,
    estadoCola: 'PENDIENTE',
    asignado: String(asignado || '').trim(),
    notas: String(notas || '').trim(),
    orden: nextOrden,
    origen: String(origen || 'MANUAL').toUpperCase()
  };
  if (snapshot) payload.cuadreSnapshot = snapshot;
  if (fieldValue) {
    payload.creadoAt = fieldValue.serverTimestamp();
    payload.creadoPor = actor || '';
    payload.actualizadoAt = fieldValue.serverTimestamp();
    payload.actualizadoPor = actor || '';
  }

  await ref.set(payload, { merge: true });

  const fechaLabel = departureLabel(departure);
  await registrarLogCola(
    `📋 EN COLA: ${m} · salida ${fechaLabel} · origen ${payload.origen}`,
    actor || 'Sistema',
    p,
    { mva: m }
  );

  return { ok: true, itemId: m, alreadyExists: false };
}

/**
 * @param {{ plaza: string, itemId: string, patch: object, actor?: string, touchMeta?: boolean, logType?: string|null }} opts
 */
export async function patchItem({
  plaza,
  itemId,
  patch,
  actor = '',
  touchMeta: shouldTouch = true,
  logType = null
} = {}) {
  const p = normalizePlaza(plaza);
  const id = String(itemId || '').trim();
  if (!p || !id) throw new Error('Plaza e ítem requeridos.');

  let mergePayload = { ...patch };
  if (shouldTouch) mergePayload = touchMeta(mergePayload, actor);

  if (patch.checklist && typeof patch.checklist === 'object') {
    mergePayload.estadoCola = deriveEstadoCola({ checklist: patch.checklist, entregadoAt: patch.entregadoAt });
  }

  await queueItemsRef(p).doc(id).set(mergePayload, { merge: true });

  if (logType === 'checklist' && patch.checklist) {
    const mva = normalizeMva(patch.mva || id);
    const parts = CHECKLIST_KEYS.filter(k => patch.checklist[k] === true).map(k => `${k} ✓`);
    const removed = CHECKLIST_KEYS.filter(k => patch.checklist[k] === false).map(k => `${k} ✗`);
    const detail = [...parts, ...removed].join(', ') || 'actualizado';
    await registrarLogCola(`✅ CHECKLIST: ${mva} · ${detail}`, actor, p, { mva });
  } else if (logType === 'checklist_key') {
    const mva = normalizeMva(patch.mva || id);
    const key = patch._logKey || '';
    const checked = patch._logChecked === true;
    await registrarLogCola(
      `✅ CHECKLIST: ${mva} · ${key} ${checked ? '✓' : '✗'}`,
      actor,
      p,
      { mva }
    );
  } else if (logType === 'assign') {
    const mva = normalizeMva(patch.mva || id);
    await registrarLogCola(`👤 ASIGNADO: ${mva} → ${String(patch.asignado || '').trim()}`, actor, p, { mva });
  } else if (logType === 'departure') {
    const mva = normalizeMva(patch.mva || id);
    const fecha = patch.fechaSalida instanceof Date ? departureLabel(patch.fechaSalida) : '—';
    await registrarLogCola(`📅 SALIDA: ${mva} · ${fecha}`, actor, p, { mva });
  } else if (logType === 'notes') {
    const mva = normalizeMva(patch.mva || id);
    await registrarLogCola(`📝 NOTAS COLA: ${mva}`, actor, p, { mva });
  } else if (logType === 'complete') {
    const mva = normalizeMva(patch.mva || id);
    await registrarLogCola(`🚀 LISTO PREP: ${mva} · checklist completo`, actor, p, { mva });
  }

  return { ok: true };
}

export async function removeItem({ plaza, itemId, actor = '', mva = '' } = {}) {
  const p = normalizePlaza(plaza);
  const id = String(itemId || '').trim();
  if (!p || !id) throw new Error('Plaza e ítem requeridos.');

  await queueItemsRef(p).doc(id).delete();

  const m = normalizeMva(mva || id);
  await registrarLogCola(`🗑️ BAJA COLA: ${m}`, actor, p, { mva: m });
  return { ok: true };
}

export async function reorderItems({ plaza, orderedIds, actor = '' } = {}) {
  const p = normalizePlaza(plaza);
  const ids = Array.isArray(orderedIds) ? orderedIds.filter(Boolean) : [];
  if (!p || !ids.length) throw new Error('Orden inválido.');

  const fieldValue = fv();
  const batch = typeof db.batch === 'function' ? db.batch() : null;

  const writes = ids.map((id, index) => {
    const payload = touchMeta({ orden: (index + 1) * 10 }, actor);
    const ref = queueItemsRef(p).doc(String(id));
    if (batch) {
      batch.set(ref, payload, { merge: true });
      return null;
    }
    return ref.set(payload, { merge: true });
  }).filter(Boolean);

  if (batch) {
    await batch.commit();
  } else {
    await Promise.all(writes);
  }

  await registrarLogCola(`↕️ REORDEN COLA: ${ids.length} ítems`, actor, p);
  return { ok: true };
}

export async function bulkCompleteChecklist({ plaza, itemIds, actor = '' } = {}) {
  const p = normalizePlaza(plaza);
  const ids = Array.isArray(itemIds) ? itemIds.filter(Boolean) : [];
  if (!p || !ids.length) throw new Error('Sin ítems para completar.');

  const checklist = checklistAllTrue();
  const fieldValue = fv();
  const batch = typeof db.batch === 'function' ? db.batch() : null;

  const writes = ids.map(id => {
    const payload = touchMeta({
      checklist,
      estadoCola: 'LISTO'
    }, actor);
    const ref = queueItemsRef(p).doc(String(id));
    if (batch) {
      batch.set(ref, payload, { merge: true });
      return null;
    }
    return ref.set(payload, { merge: true });
  }).filter(Boolean);

  if (batch) {
    await batch.commit();
  } else {
    await Promise.all(writes);
  }

  await registrarLogCola(`🚀 LISTO PREP: bulk · ${ids.length} unidad(es)`, actor, p);
  return { ok: true, count: ids.length };
}

/** Expuesto para mapa — confirma si un ítem ya está en cola. */
export async function isUnitInQueue(plaza, mva) {
  const p = normalizePlaza(plaza);
  const m = normalizeMva(mva);
  if (!p || !m) return false;
  const snap = await queueItemsRef(p).doc(m).get();
  return snap.exists;
}

export { isItemReady };
