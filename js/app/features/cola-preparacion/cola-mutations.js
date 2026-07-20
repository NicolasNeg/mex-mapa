/**
 * Cola de preparación — escrituras Firestore + logs operativos (tipo COLA).
 */

import { db, COL, aplicarEstado } from '/js/core/database.js';
import { queueItemsRef } from '/js/app/features/cola-preparacion/cola-data.js';
import {
  CHECKLIST_KEYS,
  deriveEstadoCola,
  departureLabel,
  isItemReady,
  normalizeQueueItem
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

async function appendColaEvento(plaza, itemId, tipo, payload = {}, actor = '') {
  const p = normalizePlaza(plaza);
  const id = String(itemId || '').trim();
  if (!p || !id) return;
  const fieldValue = fv();
  const Timestamp = ts();
  try {
    await queueItemsRef(p).doc(id).collection('eventos').add({
      tipo: String(tipo || 'EVENTO').toUpperCase(),
      payload,
      actor: actor || '',
      timestamp: fieldValue?.serverTimestamp?.() || Timestamp?.now?.() || Date.now()
    });
  } catch (e) {
    console.warn('[cola-mutations] evento failed', e);
  }
}

/**
 * Marca la unidad como LISTO en cuadre/externos cuando el checklist de cola está completo.
 */
export async function syncItemListoToCuadre({
  plaza,
  mva,
  actor = '',
  nombreAutor = '',
  ubicacion = '',
  gasolina = 'N/A',
  nota = ''
} = {}) {
  const p = normalizePlaza(plaza);
  const m = normalizeMva(mva);
  if (!p || !m) throw new Error('Plaza y MVA requeridos.');

  const snapshot = await fetchCuadreSnapshot(p, m);
  const ubi = String(ubicacion || snapshot?.ubicacion || 'PATIO').trim();
  const gas = String(gasolina || snapshot?.gasolina || 'N/A').trim();
  const autor = String(nombreAutor || actor || 'Sistema').trim();
  const notaFinal = String(nota || 'Lista en cola de preparación').trim();

  const res = await aplicarEstado(
    m,
    'LISTO',
    ubi,
    gas,
    notaFinal,
    false,
    autor,
    autor,
    p
  );

  if (typeof res === 'object' && res?.code === 'CONFLICT') {
    throw new Error(`Conflicto de versión en ${m}. Recarga el cuadre e intenta de nuevo.`);
  }
  if (typeof res === 'string' && /^ERROR/i.test(res)) {
    throw new Error(res);
  }

  await appendColaEvento(p, m, 'SYNC_CUADRE', { estado: 'LISTO', ubicacion: ubi, gasolina: gas }, actor);
  await registrarLogCola(`SYNC CUADRE: ${m} → LISTO`, actor, p, { mva: m });
  return { ok: true };
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
    origen: String(origen || 'MANUAL').toUpperCase(),
    syncCuadre: true
  };
  if (snapshot) payload.cuadreSnapshot = snapshot;
  if (fieldValue) {
    payload.creadoAt = fieldValue.serverTimestamp();
    payload.creadoPor = actor || '';
    payload.actualizadoAt = fieldValue.serverTimestamp();
    payload.actualizadoPor = actor || '';
  }

  await ref.set(payload, { merge: true });

  await appendColaEvento(p, m, 'ALTA', { origen: payload.origen, fechaSalida: departure.toISOString() }, actor);

  const fechaLabel = departureLabel(departure);
  await registrarLogCola(
    `EN COLA: ${m} · salida ${fechaLabel} · origen ${payload.origen}`,
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
  logType = null,
  logMeta = {}
} = {}) {
  const p = normalizePlaza(plaza);
  const id = String(itemId || '').trim();
  if (!p || !id) throw new Error('Plaza e ítem requeridos.');

  const ref = queueItemsRef(p).doc(id);
  const beforeSnap = await ref.get();
  const beforeItem = beforeSnap.exists
    ? normalizeQueueItem(id, beforeSnap.data() || {})
    : normalizeQueueItem(id, {});

  const mva = normalizeMva(logMeta.mva || patch.mva || id);
  const cleanPatch = { ...patch };
  delete cleanPatch.mva;
  delete cleanPatch._logKey;
  delete cleanPatch._logChecked;

  let mergePayload = { ...cleanPatch };
  if (shouldTouch) mergePayload = touchMeta(mergePayload, actor);

  if (cleanPatch.checklist && typeof cleanPatch.checklist === 'object') {
    mergePayload.estadoCola = deriveEstadoCola({
      checklist: cleanPatch.checklist,
      entregadoAt: cleanPatch.entregadoAt
    });
  }

  await ref.set(mergePayload, { merge: true });

  const afterItem = normalizeQueueItem(id, {
    ...(beforeSnap.data() || {}),
    ...mergePayload,
    checklist: mergePayload.checklist || beforeItem.checklist,
    mva: beforeItem.mva || mva
  });
  const becameReady = !isItemReady(beforeItem) && isItemReady(afterItem);

  if (logType === 'checklist' && cleanPatch.checklist) {
    const parts = CHECKLIST_KEYS.filter(k => cleanPatch.checklist[k] === true).map(k => `${k} ✓`);
    const removed = CHECKLIST_KEYS.filter(k => cleanPatch.checklist[k] === false).map(k => `${k} ✗`);
    const detail = [...parts, ...removed].join(', ') || 'actualizado';
    await registrarLogCola(`CHECKLIST: ${mva} · ${detail}`, actor, p, { mva });
  } else if (logType === 'checklist_key') {
    const key = logMeta.key || '';
    const checked = logMeta.checked === true;
    await registrarLogCola(
      `CHECKLIST: ${mva} · ${key} ${checked ? '✓' : '✗'}`,
      actor,
      p,
      { mva }
    );
  } else if (logType === 'assign') {
    await registrarLogCola(`ASIGNADO: ${mva} → ${String(cleanPatch.asignado || '').trim()}`, actor, p, { mva });
  } else if (logType === 'departure') {
    const fecha = logMeta.fechaSalida instanceof Date ? departureLabel(logMeta.fechaSalida) : '—';
    await registrarLogCola(`SALIDA: ${mva} · ${fecha}`, actor, p, { mva });
  } else if (logType === 'notes') {
    await registrarLogCola(`NOTAS COLA: ${mva}`, actor, p, { mva });
  } else if (logType === 'complete') {
    await registrarLogCola(`LISTO PREP: ${mva} · checklist completo`, actor, p, { mva });
    await appendColaEvento(p, id, 'CHECKLIST', { complete: true }, actor);
  } else if (logType === 'save') {
    await registrarLogCola(`COLA: ${mva} · datos operativos actualizados`, actor, p, { mva });
  }

  if (becameReady && logType !== 'complete') {
    await appendColaEvento(p, id, 'CHECKLIST', { complete: true }, actor);
  }

  return { ok: true, becameReady, item: afterItem };
}

export async function removeItem({ plaza, itemId, actor = '', mva = '' } = {}) {
  const p = normalizePlaza(plaza);
  const id = String(itemId || '').trim();
  if (!p || !id) throw new Error('Plaza e ítem requeridos.');

  await queueItemsRef(p).doc(id).delete();

  const m = normalizeMva(mva || id);
  await registrarLogCola(`BAJA COLA: ${m}`, actor, p, { mva: m });
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

  await registrarLogCola(`LISTO PREP: bulk · ${ids.length} unidad(es)`, actor, p);
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
