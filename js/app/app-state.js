// ═══════════════════════════════════════════════════════════
//  /js/app/app-state.js
//  Estado global mínimo de la App Shell.
//  Patrón pub/sub simple — sin framework, sin proxies.
//
//  Solo guarda lo que el shell necesita saber entre vistas:
//  sesión, perfil, rol, plaza activa y ruta actual.
//  La lógica de negocio (Firestore, API) sigue en mex-api.js.
// ═══════════════════════════════════════════════════════════

import { esGlobal } from '/domain/permissions.model.js';

const _defaultState = {
  /** Firebase User object */
  user: null,
  /** Perfil normalizado del documento /usuarios/{id} */
  profile: null,
  /** Rol en mayúsculas: 'AUXILIAR', 'SUPERVISOR', etc. */
  role: 'AUXILIAR',
  /** Ruta actual dentro de /app (ej. '/app/dashboard') */
  currentRoute: '/app/dashboard',
  /** Plaza activa en mayúsculas (ej. 'NORTE') */
  currentPlaza: '',
  /** Plazas disponibles para el usuario actual */
  availablePlazas: [],
  /** Puede cambiar plaza desde App Shell */
  canSwitchPlaza: false,
  /** Nombre de empresa para el shell */
  company: 'MAPA',
  /** Estado visual del sidebar (persiste en localStorage via ShellSidebar) */
  sidebarCollapsed: false,
};

let _state = { ..._defaultState };
const _listeners = new Set();

function _normalizePlaza(plaza) {
  return String(plaza || '').toUpperCase().trim();
}

function _uniquePlazas(plazas = []) {
  const seen = new Set();
  const out = [];
  (Array.isArray(plazas) ? plazas : []).forEach(item => {
    const normalized = _normalizePlaza(item);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function _storedCurrentPlaza() {
  return _normalizePlaza(
    window.getMexCurrentPlaza?.()
    || window.__mexCurrentPlazaId
    || window.__mexActivePlazaId
  );
}

function _getRole(profile = null, role = '') {
  return String(role || profile?.rol || 'AUXILIAR').toUpperCase().trim() || 'AUXILIAR';
}

function _resolveAvailablePlazas({ profile = null, role = '' } = {}) {
  const empresa = window.MEX_CONFIG?.empresa || {};
  const fromConfig = Array.isArray(empresa.plazas) ? empresa.plazas : [];
  const fromDetail = Array.isArray(empresa.plazasDetalle) ? empresa.plazasDetalle.map(item => item?.id) : [];
  const fromProfile = [
    profile?.plazaAsignada,
    profile?.plaza,
    ...(Array.isArray(profile?.plazasPermitidas) ? profile.plazasPermitidas : [])
  ];
  const all = _uniquePlazas([...fromConfig, ...fromDetail, ...fromProfile]);
  if (esGlobal(_getRole(profile, role))) return all;
  const allowedProfile = _uniquePlazas(fromProfile);
  if (!allowedProfile.length) return [];
  return all.filter(plaza => allowedProfile.includes(plaza));
}

export function resolveAvailablePlazas(profile = null, role = '') {
  return _resolveAvailablePlazas({ profile, role });
}

function _resolveInitialPlaza({ currentPlaza = '', profile = null, availablePlazas = [] } = {}) {
  const valid = _uniquePlazas(availablePlazas);
  const stored = _normalizePlaza(currentPlaza || _storedCurrentPlaza());
  if (stored && valid.includes(stored)) return stored;
  const profilePlaza = _normalizePlaza(profile?.plazaAsignada || profile?.plaza);
  if (profilePlaza && valid.includes(profilePlaza)) return profilePlaza;
  if (valid.length) return valid[0];
  return '';
}

// ── API pública ──────────────────────────────────────────────

/**
 * Devuelve una copia inmutable del estado actual.
 * @returns {typeof _defaultState}
 */
export function getState() {
  return { ..._state };
}

/**
 * Actualiza el estado de forma parcial y notifica a todos los suscriptores.
 * @param {Partial<typeof _defaultState>} partial
 */
export function setState(partial) {
  _state = { ..._state, ...partial };
  _notify();
}

/**
 * Suscribe una función al estado. Se llama cada vez que el estado cambia.
 * Retorna una función de cancelación.
 * @param {(state: typeof _defaultState) => void} fn
 * @returns {() => void} unsub
 */
export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * Inicializa el estado con datos de sesión.
 * Llamar una sola vez después de cargar el perfil.
 */
export function initState({ user, profile, role, currentRoute, currentPlaza, availablePlazas, canSwitchPlaza, company }) {
  const resolvedPlazas = _uniquePlazas(
    Array.isArray(availablePlazas) && availablePlazas.length
      ? availablePlazas
      : _resolveAvailablePlazas({ profile, role })
  );
  const initialPlaza = _resolveInitialPlaza({ currentPlaza, profile, availablePlazas: resolvedPlazas });
  _state = {
    ..._defaultState,
    user:         user         ?? _defaultState.user,
    profile:      profile      ?? _defaultState.profile,
    role:         role         ?? _defaultState.role,
    currentRoute: currentRoute ?? _defaultState.currentRoute,
    currentPlaza: initialPlaza,
    availablePlazas: resolvedPlazas,
    canSwitchPlaza: typeof canSwitchPlaza === 'boolean' ? canSwitchPlaza : resolvedPlazas.length > 1,
    company:      company      ?? _defaultState.company,
  };
  if (initialPlaza && typeof window.setMexCurrentPlaza === 'function') {
    window.setMexCurrentPlaza(initialPlaza, { persistLocal: true, source: 'app-state:init' });
  }
  // No notificar en init — la vista ya se renderizará con estos datos
}

export function setCurrentPlaza(plaza, options = {}) {
  const normalized = _normalizePlaza(plaza);
  const { availablePlazas } = _state;
  const next = normalized && (availablePlazas.length === 0 || availablePlazas.includes(normalized))
    ? normalized
    : _state.currentPlaza;
  if (next === _state.currentPlaza) return next;

  _state = { ..._state, currentPlaza: next };

  if (typeof window.setMexCurrentPlaza === 'function') {
    window.setMexCurrentPlaza(next, { persistLocal: true, source: options.source || 'app-state' });
  }

  window.dispatchEvent(new CustomEvent('mex:plaza-change', {
    detail: { plaza: next, source: options.source || 'app-state' }
  }));

  _notify();
  return next;
}

export function getCurrentPlaza() {
  return _state.currentPlaza;
}

export function requireCurrentPlaza() {
  const plaza = _state.currentPlaza;
  if (!plaza) throw new Error('No hay plaza activa');
  return plaza;
}

export function onPlazaChange(callback) {
  if (typeof callback !== 'function') return () => {};
  let last = _state.currentPlaza;
  return subscribe(nextState => {
    if (nextState.currentPlaza === last) return;
    last = nextState.currentPlaza;
    callback(nextState.currentPlaza, nextState);
  });
}

// ── Interno ──────────────────────────────────────────────────
function _notify() {
  const snapshot = getState();
  _listeners.forEach(fn => {
    try { fn(snapshot); } catch (err) {
      console.error('[app-state] Error en suscriptor:', err);
    }
  });
}
