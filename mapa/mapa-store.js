// ═══════════════════════════════════════════════════════════
//  mapa-store.js — Estado compartido del módulo mapa
//  Fuente de verdad única para todos los feature modules.
//  Sustituye a las variables globales del monolito mapa.js.
// ═══════════════════════════════════════════════════════════

// Estado del mapa (equivale a las vars globales de mapa.js)
export const mapaStore = {
  // Plaza activa
  plazaActiva: '',

  // Datos en memoria (last snapshot de Firestore)
  ultimaFlotaMapa: [],
  ultimaEstructuraMapa: [],

  // Estado UI
  bannerState: { bloqueado: false, pctOcup: 0, alertasCriticas: 0 },
  supervisionData: {},

  // Unidad seleccionada
  unidadSeleccionada: null,

  // Config empresa activa
  config: null,
};

// Suscriptores (patrón observer mínimo)
const _listeners = new Map();

export function onStoreChange(key, fn) {
  if (!_listeners.has(key)) _listeners.set(key, []);
  _listeners.get(key).push(fn);
  return () => {
    const arr = _listeners.get(key);
    if (arr) _listeners.set(key, arr.filter(f => f !== fn));
  };
}

export function setStore(patch = {}) {
  Object.assign(mapaStore, patch);
  for (const key of Object.keys(patch)) {
    (_listeners.get(key) || []).forEach(fn => { try { fn(mapaStore[key]); } catch (_) {} });
  }
}
