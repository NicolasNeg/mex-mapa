/**
 * Persistencia controlada de posiciones para /app/mapa.
 * Usa window.api.guardarNuevasPosiciones (misma ruta que legacy → historial_patio, merge pos).
 */

import { sanitizeSpotToken } from '/js/app/features/mapa/mapa-view-model.js';
import { normalizarElemento, esCajonOcupable } from '/domain/mapa.model.js';

function _tok(v) {
  return sanitizeSpotToken(String(v || ''));
}

/** Solo si mex.debug.mode === '1'. */
export function persistDebug(label, payload = {}) {
  try {
    if (localStorage.getItem('mex.debug.mode') !== '1') return;
    console.log('[app-mapa-persist]', label, payload);
  } catch (_) {}
}

function _structureArray(snapshot) {
  return Array.isArray(snapshot?.structure) ? snapshot.structure : [];
}

/**
 * Encuentra el elemento de estructura normalizado para un spot de cajón.
 */
export function findCajonElementForSpot(structure = [], destKey) {
  const want = _tok(destKey);
  if (!want) return { el: null, raw: null, code: 'EMPTY' };
  const arr = Array.isArray(structure) ? structure : [];
  for (let i = 0; i < arr.length; i++) {
    const raw = arr[i];
    const el = normalizarElemento(raw, i);
    if (el.esLabel || String(el.tipo || '').toLowerCase() !== 'cajon') continue;
    const key = sanitizeSpotToken(el.valor);
    if (key === want) return { el, raw, code: 'OK' };
  }
  return { el: null, raw: null, code: 'NOT_FOUND' };
}

/**
 * Reporte mínimo esperado por guardarNuevasPosiciones: [{ mva, pos }].
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

function _plazaMatchesCell(raw, plazaUp) {
  const p = String(raw?.plaza || '')
    .trim()
    .toUpperCase();
  if (!p) return true;
  return p === plazaUp;
}

function _originMatchesUnitPos(unit, originKey) {
  const up = _tok(unit?.pos || 'LIMBO');
  const ok = _tok(originKey);
  return up === ok;
}

export function validatePersistMove(
  {
    snapshot = {},
    mva,
    originKey,
    destKey,
    plaza
  } = {},
  opts = {}
) {
  const { roleAllowed = true, persistFlagsOk = true } = opts;

  if (!roleAllowed) {
    return {
      ok: false,
      code: 'AUTH',
      message: 'Tu rol no permite persistir movimientos en el mapa beta.'
    };
  }
  if (!persistFlagsOk) {
    return { ok: false, code: 'FLAGS', message: 'Flags de persistencia no activos.' };
  }

  const plazaUp = String(plaza || '').trim().toUpperCase();
  if (!plazaUp) return { ok: false, code: 'NO_PLAZA', message: 'No hay plaza activa.' };

  const snapPlaza = String(snapshot?.plaza || '')
    .trim()
    .toUpperCase();
  if (snapPlaza && snapPlaza !== plazaUp) {
    return {
      ok: false,
      code: 'SNAPSHOT_PLAZA',
      message: 'Los datos del mapa no coinciden con la plaza seleccionada. Cambia de plaza o recarga.'
    };
  }

  const structure = _structureArray(snapshot);
  if (!structure.some(r => String(r?.tipo || '').toLowerCase() === 'cajon' && r?.esLabel !== true)) {
    return { ok: false, code: 'NO_STRUCTURE', message: 'Sin estructura de cajones cargada.' };
  }

  const mv = String(mva || '')
    .trim()
    .toUpperCase();
  if (!mv || mv.length < 2) return { ok: false, code: 'NO_MVA', message: 'MVA inválido.' };

  const fromT = _tok(originKey);
  const toT = _tok(destKey);
  if (!toT) return { ok: false, code: 'NO_DEST', message: 'Destino inválido.' };
  if (fromT === toT) return { ok: false, code: 'SAME', message: 'Origen y destino son iguales.' };

  const units = Array.isArray(snapshot.units) ? snapshot.units : [];
  const unit = units.find(u => String(u?.mva || '').toUpperCase() === mv);
  if (!unit) {
    return {
      ok: false,
      code: 'UNIT_NOT_FOUND',
      message: 'Unidad no encontrada en el snapshot actual.'
    };
  }

  if (!_originMatchesUnitPos(unit, originKey)) {
    return {
      ok: false,
      code: 'ORIGIN_MISMATCH',
      message: 'La unidad cambió de posición respecto al gesto. Vuelve a arrastrar desde la posición actual.'
    };
  }

  const { el: destEl, raw: destRaw, code: destCode } = findCajonElementForSpot(structure, destKey);
  if (!destEl || destCode !== 'OK') {
    return {
      ok: false,
      code: 'INVALID_CELL',
      message: 'El destino no es un cajón válido en la estructura actual.'
    };
  }

  if (!_plazaMatchesCell(destRaw, plazaUp)) {
    return {
      ok: false,
      code: 'CELL_PLAZA',
      message: 'La celda no corresponde a la plaza activa.'
    };
  }

  if (!esCajonOcupable(destEl)) {
    return {
      ok: false,
      code: 'BLOCKED',
      message: 'Cajón bloqueado o no ocupable en la estructura.'
    };
  }

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
