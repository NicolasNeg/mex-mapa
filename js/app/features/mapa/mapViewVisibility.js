// ═══════════════════════════════════════════════════════════
//  Visibilidad por vista del editor / mapa operativo (sin JSON al usuario).
// ═══════════════════════════════════════════════════════════

/** @typedef {'global'|'mesas'|'estacionamiento'|'albercas'} MapEditorViewId */

const VIEW_KEYS = ['global', 'mesas', 'estacionamiento', 'albercas'];

function _tipo(el) {
  return String(el?.tipo || 'cajon').toLowerCase();
}

function _vb(el) {
  const m = el?.metadata;
  if (!m || typeof m !== 'object') return null;
  const v = m.visibilityByView;
  return v && typeof v === 'object' ? v : null;
}

/**
 * Defaults cuando no hay metadata.visibilityByView.
 * @param {object} el — elemento ya normalizado o crudo
 * @returns {Record<MapEditorViewId, boolean>}
 */
export function inferVisibilityByView(el) {
  const t = _tipo(el);
  const isLabel = el?.esLabel === true || t === 'label';
  if (isLabel || t === 'label') {
    return { global: true, mesas: true, estacionamiento: true, albercas: true };
  }
  if (t === 'cajon') {
    return { global: true, mesas: false, estacionamiento: true, albercas: false };
  }
  if (t === 'mesa' || t === 'zona_reservable') {
    return { global: true, mesas: true, estacionamiento: false, albercas: false };
  }
  if (t === 'pool' || t === 'chapoteadero' || t === 'water_area' || t === 'zona_acuatica') {
    return { global: true, mesas: false, estacionamiento: false, albercas: true };
  }
  if (t === 'area' || t === 'servicio' || t === 'entrada' || t === 'palapa' || t === 'camino' || t === 'marker') {
    return { global: true, mesas: true, estacionamiento: true, albercas: true };
  }
  if (t === 'forma_rect' || t === 'forma_line') {
    return { global: true, mesas: true, estacionamiento: true, albercas: true };
  }
  return { global: true, mesas: false, estacionamiento: false, albercas: false };
}

/** @param {object} el */
export function getVisibilityByView(el) {
  const raw = _vb(el);
  const def = inferVisibilityByView(el);
  if (!raw) return { ...def };
  const out = { ...def };
  for (const k of VIEW_KEYS) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k];
  }
  return out;
}

/**
 * @param {object} el
 * @param {MapEditorViewId} viewId
 */
export function isElementVisibleInView(el, viewId) {
  const v = getVisibilityByView(el);
  return v[viewId] !== false;
}

/** Opacidad de capa contextual (modo foco). */
export function focusOpacityForType(tipo, activeView) {
  const t = String(tipo || '').toLowerCase();
  const parkingish = t === 'cajon' || t === 'camino' || t === 'entrada' || t === 'buffer';
  const mesaish = t === 'mesa' || t === 'zona_reservable';
  const poolish = t === 'pool' || t === 'chapoteadero' || t === 'water_area' || t === 'zona_acuatica';
  const globalish = t === 'area' || t === 'servicio' || t === 'palapa' || t === 'marker' || t === 'label';

  if (activeView === 'global') return 1;
  if (activeView === 'mesas') {
    if (mesaish) return 1;
    if (globalish) return 0.7;
    if (poolish) return 0.6;
    if (parkingish) return 0.32;
    return 0.5;
  }
  if (activeView === 'estacionamiento') {
    if (parkingish) return 1;
    if (t === 'camino' || t === 'entrada') return 0.72;
    if (mesaish) return 0.32;
    if (poolish) return 0.42;
    if (globalish) return 0.55;
    return 0.45;
  }
  if (activeView === 'albercas') {
    if (poolish) return 1;
    if (globalish || t === 'camino') return 0.7;
    if (mesaish) return 0.55;
    if (parkingish) return 0.3;
    return 0.45;
  }
  return 1;
}
