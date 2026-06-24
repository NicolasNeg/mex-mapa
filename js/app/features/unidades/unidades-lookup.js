// Global unit catalog lookup — self-initializes when empresa context loads.
// Exposes window.mexUnidades for use from any form or native view.
import { onUnidades } from './unidades-data.js';

let _cache = [];
let _unsub = null;
let _ready = false;
let _empresaId = '';

function _start(empresaId) {
  if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
  _cache = [];
  _ready = false;
  _empresaId = String(empresaId || '').trim();

  if (!_empresaId || _empresaId === '__superadmin__') {
    _ready = true;
    _dispatch();
    return;
  }

  _unsub = onUnidades(_empresaId, units => {
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

// Start immediately — single-tenant, no empresa context switching needed
const initialId = String(window.MEX_CONFIG?.empresa?.id || '').trim();
if (initialId) _start(initialId);

// Public API
window.mexUnidades = Object.freeze({ buscar, getByMva, getByPlacas, isReady, todas });
