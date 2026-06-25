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
  return _cache.filter(u =>
    _norm(u.mva).startsWith(q) || _norm(u.mva).includes(q) ||
    _norm(u.placas).startsWith(q) || _norm(u.placas).includes(q) ||
    _norm(u.vin).startsWith(q) || _norm(u.vin).includes(q)
  ).slice(0, limit);
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
