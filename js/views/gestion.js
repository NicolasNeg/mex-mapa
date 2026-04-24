import { auth } from '/js/core/database.js';
import { ensureRouteShellLayout, queueShellSearch } from '/js/views/home.js';

let _gestionShellReady = false;
let _gestionShellMounted = false;
let _gestionProfileCache = null;

function _safeText(value) {
  return String(value || '').trim();
}

function _upperText(value) {
  return _safeText(value).toUpperCase();
}

async function _resolveGestionProfile(user = auth.currentUser) {
  if (_gestionProfileCache) return _gestionProfileCache;
  if (window.CURRENT_USER_PROFILE && typeof window.CURRENT_USER_PROFILE === 'object') {
    _gestionProfileCache = window.CURRENT_USER_PROFILE;
    return _gestionProfileCache;
  }

  const cached = typeof window.__mexLoadCurrentUserRecord === 'function'
    ? await window.__mexLoadCurrentUserRecord(user).catch(() => null)
    : null;

  if (cached && typeof cached === 'object') {
    _gestionProfileCache = cached;
    window.CURRENT_USER_PROFILE = cached;
    return _gestionProfileCache;
  }

  const fallback = {
    email: _safeText(user?.email),
    displayName: _safeText(user?.displayName || user?.email || 'Usuario'),
    nombre: _safeText(user?.displayName || user?.email || 'Usuario'),
    rol: 'AUXILIAR',
    plazaAsignada: _upperText(window.getMexCurrentPlaza?.())
  };
  _gestionProfileCache = fallback;
  window.CURRENT_USER_PROFILE = fallback;
  return _gestionProfileCache;
}

function _gestionCurrentRoute() {
  const pathname = _safeText(window.location.pathname || '/gestion') || '/gestion';
  const search = _safeText(window.location.search || '');
  return `${pathname}${search}`;
}

function _gestionCurrentPlaza(profile = {}) {
  return _upperText(
    window.getMexCurrentPlaza?.()
    || profile.plazaAsignada
    || profile.plaza
    || ''
  );
}

async function _mountGestionShell() {
  if (!_gestionShellReady || _gestionShellMounted) return null;
  const panel = document.getElementById('modal-config-global');
  if (!panel) return null;

  const profile = await _resolveGestionProfile(auth.currentUser);
  const currentPlaza = _gestionCurrentPlaza(profile);
  const currentRoute = _gestionCurrentRoute();

  document.documentElement.classList.add('gestion-shell-route');
  document.body?.classList.add('gestion-shell-route');

  const shell = ensureRouteShellLayout({
    appRoot: panel,
    layoutId: 'gestionShellLayout',
    sidebarHostId: 'gestionSidebarHost',
    topbarHostId: 'gestionTopbarHost',
    mainId: 'gestionMainStage',
    currentRoute,
    profile,
    config: window.MEX_CONFIG || {},
    currentPlaza,
    metrics: {
      focus: currentPlaza
    },
    mainClass: 'gestion-shell-main overflow-hidden pb-0 bg-transparent',
    searchId: 'gestionRouteSearchInput',
    plazaSelectId: 'gestionRoutePlazaSelect',
    searchPlaceholder: 'Buscar unidad, ruta o panel...',
    onSearch: (query) => {
      if (currentPlaza && typeof window.setMexCurrentPlaza === 'function') {
        window.setMexCurrentPlaza(currentPlaza, { persistLocal: true, source: 'gestion-shell-search' });
      }
      queueShellSearch(query, currentPlaza);
      window.location.href = '/mapa';
    },
    onPlazaChange: (nextPlaza) => {
      const normalized = _upperText(nextPlaza);
      if (normalized && typeof window.setMexCurrentPlaza === 'function') {
        window.setMexCurrentPlaza(normalized, { persistLocal: true, source: 'gestion-shell-plaza' });
      }
      window.location.href = currentRoute;
    }
  });

  if (shell) _gestionShellMounted = true;
  return shell;
}

function _todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function _toggleModalActive(id, active) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.toggle('active', Boolean(active));
}

function _resetActividadModal() {
  const reservas = document.getElementById('textoBrutoReservas');
  const regresos = document.getElementById('textoBrutoRegresos');
  const vencidos = document.getElementById('textoBrutoVencidos');
  if (reservas) reservas.value = '';
  if (regresos) regresos.value = '';
  if (vencidos) vencidos.value = '';
  if (typeof window.validarTextareasActividad === 'function') {
    window.validarTextareasActividad();
  }
}

function _syncPredictionDate() {
  const input = document.getElementById('fecha-prediccion');
  if (input && !input.value) input.value = _todayIso();
}

function _resetPrediccionModal() {
  _syncPredictionDate();
  const reservas = document.getElementById('txt-pred-reservas');
  const regresos = document.getElementById('txt-pred-regresos');
  if (reservas) reservas.value = '';
  if (regresos) regresos.value = '';
  if (typeof window.reiniciarPrediccion === 'function') {
    window.reiniciarPrediccion();
    _syncPredictionDate();
  } else {
    const step1 = document.getElementById('prediccion-paso-1');
    const step2 = document.getElementById('prediccion-paso-2');
    const tabla = document.getElementById('tabla-prediccion-container');
    if (step1) step1.style.display = 'block';
    if (step2) step2.style.display = 'none';
    if (tabla) tabla.innerHTML = '';
  }
}

window.abrirReporteActividadGestion = function () {
  _resetActividadModal();
  _toggleModalActive('modal-lector-reservas', true);
};

window.abrirPrediccionGestion = function () {
  _resetPrediccionModal();
  _toggleModalActive('modal-prediccion', true);
};

window.abrirAnalisisReservasGestion = function () {
  if (typeof window.abrirModalPDFReservas === 'function') {
    window.abrirModalPDFReservas();
    return;
  }
  const modal = document.getElementById('modal-pdf-reservas');
  if (modal) modal.style.display = 'flex';
};

window.addEventListener('mex-app-ready', () => {
  _gestionShellReady = true;
  _mountGestionShell().catch(error => {
    console.warn('[gestion] shell:', error);
  });
  _syncPredictionDate();
  if (typeof window.validarTextareasActividad === 'function') {
    window.validarTextareasActividad();
  }
});

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.replace('/login');
    return;
  }
  try {
    await _resolveGestionProfile(user);
    if (_gestionShellReady) {
      await _mountGestionShell();
    }
  } catch (error) {
    console.warn('[gestion] profile bootstrap:', error);
  }
});
