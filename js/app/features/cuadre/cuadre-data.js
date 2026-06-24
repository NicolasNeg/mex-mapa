// ═══════════════════════════════════════════════════════════
//  /js/app/features/cuadre/cuadre-data.js
//  Data layer para /app/cuadre — Fase 8C.
//  Lee colecciones cuadre y externos filtradas por plaza
//  usando onSnapshot directo (real-time).
// ═══════════════════════════════════════════════════════════

import { db, COL } from '/js/core/database.js';

function _eid() {
  return window.MEX_CONFIG?.empresa?.id || '';
}

const CUADRE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function cacheKey(plaza) {
  return `mex.app.cuadre.snapshot.${String(plaza || '').toUpperCase().trim()}`;
}

export function readCuadreCache(plaza) {
  try {
    const raw = sessionStorage.getItem(cacheKey(plaza)) || localStorage.getItem(cacheKey(plaza));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - Number(parsed.savedAt || 0) > CUADRE_CACHE_TTL_MS) return [];
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    return rows.map((row, idx) => normalizeCuadreRecord(row?.id || `${plaza}_${idx}`, row));
  } catch (_) {
    return [];
  }
}

export function writeCuadreCache(plaza, rows = []) {
  try {
    const payload = JSON.stringify({
      savedAt: Date.now(),
      plaza: String(plaza || '').toUpperCase().trim(),
      rows: (Array.isArray(rows) ? rows : []).slice(0, 900)
    });
    sessionStorage.setItem(cacheKey(plaza), payload);
    localStorage.setItem(cacheKey(plaza), payload);
  } catch (_) {}
}

export function normalizeCuadreRecord(id, data = {}) {
  return {
    id:          String(id || ''),
    mva:         String(data.mva || '').toUpperCase().trim(),
    modelo:      String(data.modelo || '').trim(),
    categoria:   String(data.categoria || '').trim(),
    placas:      String(data.placas || '').trim(),
    gasolina:    String(data.gasolina || 'N/A').trim(),
    estado:      String(data.estado || '').toUpperCase().trim(),
    ubicacion:   String(data.ubicacion || '').trim(),
    notas:       String(data.notas || '').trim(),
    pos:         String(data.pos || 'LIMBO').trim(),
    plaza:       String(data.plaza || '').toUpperCase().trim(),
    tipo:        String(data.tipo || 'renta').trim(),
    fechaIngreso: data.fechaIngreso || null,
    updatedAt:   data._updatedAt || data.lastTouchedAt || null,
    updatedBy:   data._updatedBy || data.lastTouchedBy || null,
    version:     Number(data.version || data._version || 0),
  };
}

export async function getCuadreSnapshot(plaza) {
  const plazaId = String(plaza || '').toUpperCase().trim();
  if (!plazaId) return [];

  if (window.api?.obtenerDatosFlotaConsola && typeof window.api.obtenerDatosFlotaConsola === 'function') {
    const rows = await window.api.obtenerDatosFlotaConsola(plazaId);
    const normalized = (Array.isArray(rows) ? rows : []).map((row, idx) =>
      normalizeCuadreRecord(row?.id || row?.fila || `${plazaId}_${row?.mva || idx}`, row)
    );
    writeCuadreCache(plazaId, normalized);
    return normalized;
  }

  const eid = _eid();
  let qCuadre = db.collection(COL.CUADRE).where('plaza', '==', plazaId);
  if (eid) qCuadre = qCuadre.where('empresaId', '==', eid);
  let qExternos = db.collection(COL.EXTERNOS).where('plaza', '==', plazaId);
  if (eid) qExternos = qExternos.where('empresaId', '==', eid);
  const [cuadre, externos] = await Promise.all([
    qCuadre.get(),
    qExternos.get()
  ]);

  const normalized = [
    ...cuadre.docs.map(d => normalizeCuadreRecord(d.id, d.data())),
    ...externos.docs.map(d => normalizeCuadreRecord(d.id, { ...d.data(), tipo: 'externo', ubicacion: d.data().ubicacion || 'EXTERNO' }))
  ];
  writeCuadreCache(plazaId, normalized);
  return normalized;
}

// Abre dos onSnapshot (cuadre + externos) filtrados por plaza.
// Devuelve función de cleanup.
export function subscribeCuadre({ plaza, onData, onError }) {
  const plazaId     = String(plaza || '').toUpperCase().trim();
  const handleData  = typeof onData  === 'function' ? onData  : () => {};
  const handleError = typeof onError === 'function' ? onError : () => {};

  if (!plazaId) {
    handleData([]);
    return () => {};
  }

  let cuadreDocs    = [];
  let externosDocs  = [];
  let cuadreReady   = false;
  let externosReady = false;
  let pendingTimer  = null;
  let unmounted     = false;

  function emit() {
    if (!cuadreReady || !externosReady || unmounted) return;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      if (unmounted) return;
      handleData([...cuadreDocs, ...externosDocs]);
    }, 80);
  }

  let unsubCuadre   = () => {};
  let unsubExternos = () => {};

  const cached = readCuadreCache(plazaId);
  if (cached.length) {
    queueMicrotask(() => handleData(cached));
  }

  // Snapshot inicial vía API legacy cuando está disponible.
  // Mantiene compatibilidad con la misma normalización que usa /cuadre legacy.
  getCuadreSnapshot(plazaId)
    .then(rows => {
      if (unmounted || !Array.isArray(rows)) return;
      const baseCuadre = rows.filter(r => (r.tipo || 'renta') !== 'externo');
      const baseExternos = rows.filter(r => (r.tipo || 'renta') === 'externo');
      if (baseCuadre.length || baseExternos.length) {
        cuadreDocs = baseCuadre;
        externosDocs = baseExternos;
        cuadreReady = true;
        externosReady = true;
        writeCuadreCache(plazaId, rows);
        emit();
      }
    })
    .catch(handleError);

  const eid = _eid();

  try {
    let qSnapCuadre = db.collection(COL.CUADRE).where('plaza', '==', plazaId);
    if (eid) qSnapCuadre = qSnapCuadre.where('empresaId', '==', eid);
    unsubCuadre = qSnapCuadre
      .onSnapshot(
        snap => {
          cuadreDocs  = snap.docs.map(d => normalizeCuadreRecord(d.id, d.data()));
          cuadreReady = true;
          if (externosReady) writeCuadreCache(plazaId, [...cuadreDocs, ...externosDocs]);
          emit();
        },
        err => handleError(err)
      );
  } catch (err) {
    cuadreReady = true;
    handleError(err);
    emit();
  }

  try {
    let qSnapExternos = db.collection(COL.EXTERNOS).where('plaza', '==', plazaId);
    if (eid) qSnapExternos = qSnapExternos.where('empresaId', '==', eid);
    unsubExternos = qSnapExternos
      .onSnapshot(
        snap => {
          externosDocs  = snap.docs.map(d =>
            normalizeCuadreRecord(d.id, {
              ...d.data(),
              tipo:      'externo',
              ubicacion: d.data().ubicacion || 'EXTERNO',
            })
          );
          externosReady = true;
          if (cuadreReady) writeCuadreCache(plazaId, [...cuadreDocs, ...externosDocs]);
          emit();
        },
        err => handleError(err)
      );
  } catch (err) {
    externosReady = true;
    handleError(err);
    emit();
  }

  return () => {
    unmounted = true;
    if (pendingTimer) clearTimeout(pendingTimer);
    try { unsubCuadre();   } catch (_) {}
    try { unsubExternos(); } catch (_) {}
  };
}

// Queries historial_operativo + ops_events for a single unit (by MVA).
// Returns an array of normalized log items sorted newest-first.
export async function getUnidadBitacora({ plaza, mva, limit = 80 } = {}) {
  const plazaId = String(plaza || '').toUpperCase().trim();
  const mvaId   = String(mva   || '').toUpperCase().trim();
  if (!mvaId) return [];

  const eid = _eid();
  const results = [];

  // historial_operativo
  try {
    let q = db.collection('historial_operativo')
      .where('mva', '==', mvaId)
      .orderBy('creadoEn', 'desc')
      .limit(limit);
    if (plazaId) q = q.where('plaza', '==', plazaId);
    if (eid) q = q.where('empresaId', '==', eid);
    const snap = await q.get();
    snap.docs.forEach(d => results.push({ id: d.id, source: 'historial', ...d.data() }));
  } catch (_) {}

  // ops_events (audit log)
  if (results.length < limit) {
    try {
      let q = db.collection('ops_events')
        .where('mva', '==', mvaId)
        .orderBy('timestamp', 'desc')
        .limit(limit - results.length);
      if (plazaId) q = q.where('plaza', '==', plazaId);
      if (eid) q = q.where('empresaId', '==', eid);
      const snap = await q.get();
      snap.docs.forEach(d => results.push({ id: d.id, source: 'ops', ...d.data() }));
    } catch (_) {}
  }

  return results;
}
