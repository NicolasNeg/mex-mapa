/**
 * Persistencia controlada de posiciones para /app/mapa.
 * Usa window.api.guardarNuevasPosiciones (misma ruta que legacy → historial_patio, merge pos).
 */

import { sanitizeSpotToken } from '/js/app/features/mapa/mapa-view-model.js';

function _tok(v) {
  return sanitizeSpotToken(String(v || ''));
}

/**
 * Reporte mínimo esperado por guardarNuevasPosiciones: [{ mva, pos }].
 * La API actualiza solo `pos` en CUADRE/EXTERNOS y escribe historial_patio si hubo cambio.
 */
export function buildMoveReportItem(mva, posNueva) {
  return {
    mva: String(mva || '')
      .trim()
      .toUpperCase(),
    pos: String(posNueva || '')
      .trim()
      .toUpperCase()
  };
}

/**
 * Destino ocupado por otra unidad distinta de `mva`.
 */
export function isDestinationOccupied(units = [], destKey, mva) {
  const d = _tok(destKey);
  const mv = String(mva || '')
    .trim()
    .toUpperCase();
  if (!d || !mv) return false;
  return units.some(u => {
    const um = String(u?.mva || '')
      .trim()
      .toUpperCase();
    if (!um || um === mv) return false;
    return _tok(u?.pos || 'LIMBO') === d;
  });
}

export function validatePersistMove({
  snapshot = {},
  mva,
  originKey,
  destKey,
  plaza
}) {
  const plazaUp = String(plaza || '').trim().toUpperCase();
  if (!plazaUp) return { ok: false, code: 'NO_PLAZA', message: 'No hay plaza activa.' };

  const units = Array.isArray(snapshot.units) ? snapshot.units : [];
  const structure = Array.isArray(snapshot.structure) ? snapshot.structure : [];
  if (!structure.some(r => String(r?.tipo || '').toLowerCase() === 'cajon' && r?.esLabel !== true)) {
    return { ok: false, code: 'NO_STRUCTURE', message: 'Sin estructura de cajones cargada.' };
  }

  const mv = String(mva || '')
    .trim()
    .toUpperCase();
  if (!mv) return { ok: false, code: 'NO_MVA', message: 'MVA inválido.' };

  const fromT = _tok(originKey);
  const toT = _tok(destKey);
  if (!toT) return { ok: false, code: 'NO_DEST', message: 'Destino inválido.' };
  if (fromT === toT) return { ok: false, code: 'SAME', message: 'Origen y destino son iguales.' };

  const unit = units.find(u => String(u?.mva || '').toUpperCase() === mv);
  if (!unit) return { ok: false, code: 'UNIT_NOT_FOUND', message: 'Unidad no encontrada en snapshot.' };

  if (isDestinationOccupied(units, destKey, mv)) {
    return {
      ok: false,
      code: 'OCCUPIED',
      message: 'El cajón ya está ocupado. Swap pendiente para fase posterior.'
    };
  }

  return { ok: true, code: 'OK', message: '', unit };
}

export async function persistUnitMove({
  api = window.api || null,
  plaza = '',
  usuario = 'Sistema',
  mva = '',
  posNueva = '',
  extra = {}
} = {}) {
  if (!api || typeof api.guardarNuevasPosiciones !== 'function') {
    return { success: false, error: 'API guardarNuevasPosiciones no disponible.' };
  }
  const plazaUp = String(plaza || '').trim().toUpperCase();
  const reporte = [buildMoveReportItem(mva, posNueva)];
  try {
    const audit =
      typeof window.__mexGetLastLocationAuditPayload === 'function'
        ? window.__mexGetLastLocationAuditPayload()
        : {};
    const merged = { ...audit, ...(extra || {}) };
    const res = await api.guardarNuevasPosiciones(reporte, usuario, plazaUp, merged);
    const ok = res === true || res?.ok === true;
    return ok ? { success: true } : { success: false, error: String(res?.message || 'Respuesta no exitosa.') };
  } catch (err) {
    return { success: false, error: String(err?.message || err || 'Error de red.') };
  }
}
