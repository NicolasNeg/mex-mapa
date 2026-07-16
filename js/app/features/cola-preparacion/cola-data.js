/**
 * Cola de preparación — suscripción realtime e hidratación desde cuadre/externos.
 */

import { db, COL } from '/js/core/database.js';
import { normalizarUnidad } from '/domain/unidad.model.js';
import { normalizeQueueItem } from '/js/app/features/cola-preparacion/cola-view-model.js';

function normalizePlaza(plaza) {
  return String(plaza || '').toUpperCase().trim();
}

export function queueItemsRef(plaza) {
  const p = normalizePlaza(plaza);
  return db.collection(COL.COLA_PREPARACION).doc(p).collection('items');
}

/** Ítem activo en cola para un MVA (one-shot). */
export async function getColaItemForMva(plaza, mva) {
  const p = normalizePlaza(plaza);
  const m = String(mva || '').toUpperCase().trim();
  if (!p || !m) return null;
  try {
    const snap = await queueItemsRef(p).doc(m).get();
    if (!snap.exists) return null;
    return normalizeQueueItem(m, snap.data() || {});
  } catch (_) {
    return null;
  }
}

/**
 * @param {{ plaza: string, onData: (items: object[]) => void, onError?: (err: Error) => void }} opts
 * @returns {() => void} unsubscribe
 */
export function subscribeColaQueue({ plaza, onData, onError }) {
  const expectedPlaza = normalizePlaza(plaza);
  const handleData = typeof onData === 'function' ? onData : () => {};
  const handleError = typeof onError === 'function' ? onError : () => {};

  if (!expectedPlaza) {
    queueMicrotask(() => handleData([]));
    return () => {};
  }

  try {
    return queueItemsRef(expectedPlaza).onSnapshot(
      snap => {
        const items = snap.docs.map(doc => normalizeQueueItem(doc.id, doc.data() || {}));
        handleData(items);
      },
      err => handleError(err)
    );
  } catch (err) {
    queueMicrotask(() => handleError(err));
    return () => {};
  }
}

/**
 * Hidrata metadata de unidad desde cuadre + externos por chunks de MVA.
 * @returns {Promise<Map<string, object>>}
 */
export async function hydrateQueueUnits(plaza, items, { signal } = {}) {
  const p = normalizePlaza(plaza);
  const mvas = [...new Set(
    (items || []).map(it => String(it.mva || '').toUpperCase().trim()).filter(Boolean)
  )];
  if (!p || !mvas.length) return new Map();

  const next = new Map();
  for (let i = 0; i < mvas.length; i += 10) {
    if (signal?.aborted) return next;
    const chunk = mvas.slice(i, i + 10);
    try {
      const [cuadreSnap, externosSnap] = await Promise.all([
        db.collection(COL.CUADRE).where('plaza', '==', p).where('mva', 'in', chunk).get(),
        db.collection(COL.EXTERNOS).where('plaza', '==', p).where('mva', 'in', chunk).get()
      ]);
      cuadreSnap.forEach(doc => {
        const data = doc.data() || {};
        const unit = normalizarUnidad({ id: doc.id, ...data });
        const key = String(unit.mva || '').toUpperCase();
        if (key) next.set(key, { ...unit, origen: 'PATIO' });
      });
      externosSnap.forEach(doc => {
        const data = doc.data() || {};
        const unit = normalizarUnidad({ id: doc.id, ...data });
        const key = String(unit.mva || '').toUpperCase();
        if (key && !next.has(key)) next.set(key, { ...unit, origen: 'EXTERNO' });
      });
    } catch (e) {
      console.warn('[cola-data] hydrate chunk', e);
    }
    if (signal?.aborted) return next;
  }
  return next;
}

export async function loadPlazaUsers(plaza) {
  const p = normalizePlaza(plaza);
  if (!p) return [];
  try {
    const [byPlaza, byExtraPlaza] = await Promise.all([
      db.collection(COL.USERS).where('plazaAsignada', '==', p).limit(120).get(),
      db.collection(COL.USERS).where('plazasPermitidas', 'array-contains', p).limit(120).get().catch(() => ({ docs: [] }))
    ]);
    const merged = new Map();
    [...byPlaza.docs, ...(byExtraPlaza.docs || [])].forEach(doc => {
      const data = doc.data() || {};
      const email = String(data.email || doc.id).trim().toLowerCase();
      const name = String(data.nombre || data.usuario || '').trim();
      const key = email || name || doc.id;
      if (!key) return;
      merged.set(key, {
        value: email || name,
        label: [name, email].filter(Boolean).join(' · ')
      });
    });
    return Array.from(merged.values()).filter(item => String(item.value || '').trim());
  } catch (e) {
    console.warn('[cola-data] plaza users', e);
    return [];
  }
}

export async function loadPlazaUnits(plaza) {
  const p = normalizePlaza(plaza);
  if (!p) return new Map();
  try {
    const [cuadreSnap, externosSnap] = await Promise.all([
      db.collection(COL.CUADRE).where('plaza', '==', p).limit(500).get(),
      db.collection(COL.EXTERNOS).where('plaza', '==', p).limit(200).get().catch(() => ({ docs: [] }))
    ]);
    const next = new Map();
    [...cuadreSnap.docs, ...(externosSnap.docs || [])].forEach(doc => {
      const data = doc.data() || {};
      const unit = normalizarUnidad({ id: doc.id, ...data });
      if (unit.mva) next.set(String(unit.mva).toUpperCase(), unit);
    });
    return next;
  } catch (e) {
    console.warn('[cola-data] plaza units', e);
    return new Map();
  }
}
