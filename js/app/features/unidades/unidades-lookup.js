// Global unit catalog lookup — self-initializes when config is ready.
// Exposes window.mexUnidades for use from any form or native view.
import { onUnidades } from './unidades-data.js';

let _cache = [];
let _unsub = null;
let _ready = false;

function _start() {
  if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
  _cache = [];
  _ready = false;

  _unsub = onUnidades(units => {
    _cache = Array.isArray(units) ? units : [];
    _ready = true;
    _dispatch();
  });
}

function _dispatch() {
  window.dispatchEvent(new CustomEvent('mex:unidades-ready', { detail: { count: _cache.length } }));
}

function _norm(v) { return String(v || '').toUpperCase().trim(); }

export function buscar(query, limit = 8) {
  const q = _norm(query);
  if (!q || !_cache.length) return [];
  const scored = [];
  for (const u of _cache) {
    const mva = _norm(u.mva);
    const placas = _norm(u.placas);
    const vin = _norm(u.vin);
    const modelo = _norm(u.modelo);
    const color = _norm(u.color);
    let score = 0;
    if (mva === q || placas === q) score = 100;
    else if (mva.startsWith(q) || placas.startsWith(q)) score = 90;
    else if (mva.includes(q) || placas.includes(q)) score = 70;
    else if (modelo.includes(q)) score = 55;
    else if (vin.includes(q)) score = 40;
    else if (color.includes(q)) score = 20;
    if (score) scored.push({ u, score });
  }
  scored.sort((a, b) => b.score - a.score || _norm(a.u.mva).localeCompare(_norm(b.u.mva)));
  return scored.slice(0, limit).map((x) => x.u);
}

export function getByMva(mva) {
  const k = _norm(mva);
  return _cache.find(u => _norm(u.mva) === k) || null;
}

export function getByPlacas(placas) {
  const k = _norm(placas);
  return _cache.find(u => _norm(u.placas) === k) || null;
}

export function isReady() { return _ready; }
export function todas() { return _cache.slice(); }

// Single-tenant: un solo catálogo. Arrancar cuando MEX_CONFIG esté listo.
function _boot() { _start(); }
if (window.__mexConfigReadyPromise) window.__mexConfigReadyPromise.then(_boot).catch(_boot);
else _boot();

// Public API
window.mexUnidades = Object.freeze({ buscar, getByMva, getByPlacas, isReady, todas });
