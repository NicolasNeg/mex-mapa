// ═══════════════════════════════════════════════════════════
//  /js/app/features/cuadre/cuadre-data.js
//  Data layer para /app/cuadre — Fase 8C.
//  Lee colecciones cuadre y externos filtradas por plaza
//  usando onSnapshot directo (real-time).
// ═══════════════════════════════════════════════════════════

import { db, COL } from '/js/core/database.js';

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
    return (Array.isArray(rows) ? rows : []).map((row, idx) =>
      normalizeCuadreRecord(row?.id || row?.fila || `${plazaId}_${row?.mva || idx}`, row)
    );
  }

  const [cuadre, externos] = await Promise.all([
    db.collection(COL.CUADRE).where('plaza', '==', plazaId).get(),
    db.collection(COL.EXTERNOS).where('plaza', '==', plazaId).get()
  ]);

  return [
    ...cuadre.docs.map(d => normalizeCuadreRecord(d.id, d.data())),
    ...externos.docs.map(d => normalizeCuadreRecord(d.id, { ...d.data(), tipo: 'externo', ubicacion: d.data().ubicacion || 'EXTERNO' }))
  ];
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
        emit();
      }
    })
    .catch(handleError);

  try {
    unsubCuadre = db
      .collection(COL.CUADRE)
      .where('plaza', '==', plazaId)
      .onSnapshot(
        snap => {
          cuadreDocs  = snap.docs.map(d => normalizeCuadreRecord(d.id, d.data()));
          cuadreReady = true;
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
    unsubExternos = db
      .collection(COL.EXTERNOS)
      .where('plaza', '==', plazaId)
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
