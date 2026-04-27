// ═══════════════════════════════════════════════════════════
//  /js/app/app-state.js
//  Estado global mínimo de la App Shell.
//  Patrón pub/sub simple — sin framework, sin proxies.
//
//  Solo guarda lo que el shell necesita saber entre vistas:
//  sesión, perfil, rol, plaza activa y ruta actual.
//  La lógica de negocio (Firestore, API) sigue en mex-api.js.
// ═══════════════════════════════════════════════════════════

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
  /** Nombre de empresa para el shell */
  company: 'MAPA',
  /** Estado visual del sidebar (persiste en localStorage via ShellSidebar) */
  sidebarCollapsed: false,
};

let _state = { ..._defaultState };
const _listeners = new Set();

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
export function initState({ user, profile, role, currentRoute, currentPlaza, company }) {
  _state = {
    ..._defaultState,
    user:         user         ?? _defaultState.user,
    profile:      profile      ?? _defaultState.profile,
    role:         role         ?? _defaultState.role,
    currentRoute: currentRoute ?? _defaultState.currentRoute,
    currentPlaza: currentPlaza ?? _defaultState.currentPlaza,
    company:      company      ?? _defaultState.company,
  };
  // No notificar en init — la vista ya se renderizará con estos datos
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
