// ═══════════════════════════════════════════════════════════
//  /js/app/main.js
//  Entry point para /app.html — Fase 3 de la migración SPA.
//
//  Responsabilidades:
//  1. Esperar estado de auth (Firebase).
//  2. Si no hay sesión → redirigir a /login.
//  3. Cargar perfil con window.__mexLoadCurrentUserRecord.
//  4. Inicializar app-state con datos de sesión.
//  5. Montar ShellLayout (sidebar + header persistentes).
//  6. Crear router → el router renderiza la vista inicial.
//
//  REGLAS:
//  - NO tocar /mapa, /home ni ninguna ruta existente.
//  - El router maneja toda la navegación dentro de /app/*.
//  - Rutas fuera de /app/* → window.location.href.
// ═══════════════════════════════════════════════════════════

import { auth }                     from '/js/core/database.js';
import { ShellLayout }              from '/js/shell/shell-layout.js';
import '/js/app/features/unidades/unidades-lookup.js';
import { initState, getState, setCurrentPlaza, subscribe, resolveAvailablePlazas } from '/js/app/app-state.js';
import { createRouter }             from '/js/app/router.js';
import { toAppRoute, isMigratedRoute } from '/js/app/route-resolver.js';
import { getNotificationsSummary } from '/js/app/features/notifications/notifications-summary.js';
import { warmAppAssets, warmAppData, getAppCacheStatus } from '/js/app/app-cache.js';

let _notifCenterModule = null;
let _notifCenterPromise = null;
let _lastWarmKey = '';

function _loadNotificationCenter() {
  if (_notifCenterModule) return Promise.resolve(_notifCenterModule);
  if (!_notifCenterPromise) {
    _notifCenterPromise = import('/js/app/features/notifications/notification-center.js')
      .then(mod => {
        _notifCenterModule = mod;
        return mod;
      })
      .catch(err => {
        _notifCenterPromise = null;
        throw err;
      });
  }
  return _notifCenterPromise;
}

function _runWhenIdle(fn, timeout = 2200) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(fn, { timeout });
  } else {
    window.setTimeout(fn, Math.min(timeout, 1200));
  }
}

function _scheduleAppWarmup(reason = 'boot', { force = false } = {}) {
  const state = getState();
  const key = [
    state.currentPlaza || '',
    state.role || '',
    state.profile?.email || state.profile?.uid || ''
  ].join('|');
  if (!force && key === _lastWarmKey) return;
  _lastWarmKey = key;
  _runWhenIdle(() => {
    warmAppData(getState(), { reason, force })
      .catch(err => console.warn('[app/main] precache datos:', err));
  }, reason === 'boot' ? 900 : 650);
}

function _isLocalQaAuthBypassEnabled() {
  try {
    const host = window.location.hostname;
    const localHost = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
    if (!localHost) return false;
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('qaAuth') === '1') {
      localStorage.setItem('mex.qa.authBypass', '1');
      return true;
    }
    return localStorage.getItem('mex.qa.authBypass') === '1';
  } catch (_) {
    return false;
  }
}

function _qaBypassUser() {
  return {
    uid: 'qa-local-auth-bypass',
    email: 'qa-local@app.local',
    displayName: 'QA LOCAL'
  };
}

function _qaBypassProfile() {
  return {
    id: 'qa-local@app.local',
    uid: 'qa-local-auth-bypass',
    email: 'qa-local@app.local',
    nombre: 'QA LOCAL',
    nombreCompleto: 'QA LOCAL',
    displayName: 'QA LOCAL',
    usuario: 'QA LOCAL',
    rol: 'PROGRAMADOR',
    isAdmin: true,
    isGlobal: true,
    status: 'ACTIVO',
    activo: true,
    autorizado: true,
    accesoSistema: true,
    plazaAsignada: 'DEFAULT',
    plazasPermitidas: ['DEFAULT']
  };
}

function _setBootStatus(title, subtitle = '') {
  const t = document.getElementById('mexAppBootstrapTitle');
  const s = document.getElementById('mexAppBootstrapSubtitle');
  if (t) t.textContent = title;
  if (s) s.textContent = subtitle;
}

// ── Boot ────────────────────────────────────────────────────
async function boot() {
  const qaAuthBypass = _isLocalQaAuthBypassEnabled();
  window.__MEX_QA_AUTH_BYPASS = qaAuthBypass;
  // 1. Esperar estado de auth
  _setBootStatus('Verificando sesión…');
  const user = qaAuthBypass ? _qaBypassUser() : await waitForAuth();

  if (!user) {
    window.location.replace('/login');
    return;
  }

  // 2. Cargar perfil
  _setBootStatus('Cargando perfil…');
  let profile = null;
  try {
    profile = qaAuthBypass
      ? _qaBypassProfile()
      : await window.__mexLoadCurrentUserRecord?.(user) ?? null;
  } catch (err) {
    console.warn('[app/main] Error cargando perfil:', err);
  }

  if (!profile) {
    try { await auth.signOut(); } catch (_) {}
    window.location.replace('/login');
    return;
  }

  const profileStatus = String(profile.status || '').toUpperCase();
  const profileActive = profile.activo !== false && profile.autorizado !== false && profile.accesoSistema !== false
    && profileStatus !== 'INACTIVO' && profileStatus !== 'RECHAZADO' && profileStatus !== 'BLOQUEADO';
  if (!profileActive) {
    try { await auth.signOut(); } catch (_) {}
    window.location.replace('/login');
    return;
  }

  // PROGRAMADOR entra a la app de la empresa como cualquier usuario.
  // Accede al panel de programador desde el item "Programador" del sidebar
  // (visible solo para ese rol — ver navigation.config.js).

  // 4. Esperar config global si no está resuelta
  if (window.__mexConfigReadyPromise) {
    try { await window.__mexConfigReadyPromise; } catch (_) {}
  }

  const role    = String(profile.rol || 'AUXILIAR').toUpperCase();
  const company = String(window.__mexCompanyName || window.MEX_CONFIG?.empresa?.nombre || 'MAPA').trim();
  const availablePlazas = resolveAvailablePlazas(profile, role);
  const plaza = String(
    window.getMexCurrentPlaza?.()
    || profile.plazaAsignada
    || profile.plaza
    || availablePlazas[0]
    || ''
  ).toUpperCase().trim();

  if (!availablePlazas.length && profile.isGlobal !== true && role !== 'PROGRAMADOR' && role !== 'JEFE_OPERACION' && role !== 'CORPORATIVO_USER') {
    try { await auth.signOut(); } catch (_) {}
    window.location.replace('/login');
    return;
  }

  // 5. Inicializar estado global
  initState({
    user,
    profile,
    role,
    currentRoute: window.location.pathname,
    currentPlaza: plaza,
    availablePlazas,
    canSwitchPlaza: availablePlazas.length > 1,
    company,
  });

  // 5. Revelar root y montar shell
  _setBootStatus('Preparando panel…');
  const appRoot     = document.getElementById('appRoot');
  const loadSpinner = document.getElementById('appLoadingSpinner');
  if (!appRoot) return;

  appRoot.style.display = '';

  const shell = new ShellLayout();
  let notifSummary = { total: 0, mensajes: 0, incidencias: 0, alertas: 0, solicitudes: 0 };
  let notifTimer = null;
  let notifInFlight = null;
  let notifLastKey = '';
  let notifLastAt = 0;
  let router = null;

  const shellToast = (message, type = 'info') => {
    const text = String(message || '').trim();
    if (!text) return;
    if (
      window.location.pathname === '/app/mapa' &&
      text === 'Activa notificaciones para recibir mensajes, cuadre y alertas críticas.'
    ) {
      return;
    }
    const root = document.getElementById('appRoot');
    if (!root) return;
    let host = document.getElementById('mexAppToastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'mexAppToastHost';
      host.style.cssText = 'position:fixed;bottom:20px;right:16px;z-index:260;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
      root.appendChild(host);
    }
    const el = document.createElement('div');
    const tone = type === 'error'
      ? 'background:#fee2e2;border:1px solid #fecaca;'
      : type === 'warning'
        ? 'background:#fef9c3;border:1px solid #fde047;'
        : 'background:#ecfccb;border:1px solid #bef264;';
    el.style.cssText = `pointer-events:auto;padding:11px 14px;border-radius:10px;font-size:13px;font-weight:600;max-width:min(360px,calc(100vw - 32px));box-shadow:0 10px 30px rgba(2,6,23,.18);color:#0f172a;${tone}`;
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => { try { el.remove(); } catch (_) {} }, 4200);
  };

  const refreshNotifSummary = async ({ force = false } = {}) => {
    const state = getState();
    const profile = state.profile || {};
    const key = [
      state.currentPlaza || '',
      state.role || '',
      profile.email || profile.nombreCompleto || profile.nombre || ''
    ].join('|');
    const now = Date.now();
    if (!force && notifInFlight) return notifInFlight;
    if (!force && key === notifLastKey && now - notifLastAt < 45000) return;
    notifInFlight = (async () => {
      notifSummary = await getNotificationsSummary({
        profile,
        role: state.role || '',
        plaza: state.currentPlaza || ''
      }).catch(() => ({ total: 0, mensajes: 0, incidencias: 0, alertas: 0, solicitudes: 0 }));
      let inboxUnread = 0;
      try {
        inboxUnread = Number(_notifCenterModule?.getCurrentDeviceSnapshot?.()?.unread || 0);
      } catch (_) {
        inboxUnread = 0;
      }
      notifLastKey = key;
      notifLastAt = Date.now();
      shell.setBellBadge(Number(notifSummary.total || 0) > 0 || inboxUnread > 0);
    })().finally(() => {
      notifInFlight = null;
    });
    return notifInFlight;
  };
  shell.mount({
    container:    appRoot,
    profile,
    role,
    currentRoute: window.location.pathname,
    company,
    currentPlaza: getState().currentPlaza,
    availablePlazas: getState().availablePlazas,
    canSwitchPlaza: getState().canSwitchPlaza,
    onNavigate:   (route) => router.navigate(isMigratedRoute(route) ? toAppRoute(route) : route),
    onLogout:     ()      => handleLogout(),
    onBellClick:  ()      => {
      _loadNotificationCenter()
        .then(mod => Promise.resolve(mod.setupAppNotificationCenter?.({ router, toast: shellToast })).then(() => mod))
        .then(mod => mod.openAppNotificationCenter?.())
        .then(() => refreshNotifSummary({ force: true }))
        .catch(err => {
          console.warn('[app/main] Centro de notificaciones:', err);
          shellToast('No se pudo abrir el centro de notificaciones.', 'error');
        });
    },
    onPlazaChange: (nextPlaza) => {
      setCurrentPlaza(nextPlaza, { source: 'app-shell-header' });
    },
    // El buscador del header abre el panel global BUSCAR UNIDAD (búsqueda rápida
    // de unidades/usuarios). El buscador del contenedor (mapa/cuadre) queda
    // independiente — ya no se alimenta desde el header.
    onSearchInput: payload => {
      const q = String(payload?.query || '');
      if (typeof window.__mexBuscadorOpen === 'function') window.__mexBuscadorOpen(q);
    }
  });

  loadSpinner?.remove();

  // (Banner de programador eliminado — single-tenant, sin contexto multi-empresa)

  // 6. Crear router — renderiza la vista inicial automáticamente
  router = createRouter({ shell });
  _runWhenIdle(() => {
    warmAppAssets().catch(err => console.warn('[app/main] precache assets:', err));
  }, 700);
  _scheduleAppWarmup('boot');
  window.__mexWarmAppData = (options = {}) => warmAppData(getState(), { reason: 'manual', force: true, ...options });
  window.__mexAppCacheStatus = () => getAppCacheStatus(getState());
  void refreshNotifSummary({ force: true });
  _runWhenIdle(() => {
    _loadNotificationCenter()
      .then(mod => mod.setupAppNotificationCenter?.({ router, toast: shellToast }))
      .then(() => refreshNotifSummary({ force: true }))
      .catch(err => console.warn('[app/main] Notificaciones diferidas:', err));
  });
  notifTimer = window.setInterval(() => {
    refreshNotifSummary({ force: true });
  }, 90000);

  subscribe(state => {
    shell.setPlaza(state.currentPlaza, state.availablePlazas, state.canSwitchPlaza);
    refreshNotifSummary();
    _scheduleAppWarmup('state');
  });

  window.addEventListener('mex:plaza-change', event => {
    const nextPlaza = String(event?.detail?.plaza || '').toUpperCase().trim();
    if (!nextPlaza || nextPlaza === getState().currentPlaza) return;
    setCurrentPlaza(nextPlaza, { source: event?.detail?.source || 'legacy-sync' });
  });
  window.addEventListener('beforeunload', () => {
    if (notifTimer) clearInterval(notifTimer);
    try { _notifCenterModule?.teardownAppNotificationShell?.(); } catch (_) {}
  }, { once: true });
}

// ── Handlers ────────────────────────────────────────────────
async function handleLogout() {
  try { _notifCenterModule?.teardownAppNotificationShell?.(); } catch (_) {}
  try {
    await auth.signOut();
  } catch (err) {
    console.error('[app/main] Error en logout:', err);
  }
  window.location.replace('/login');
}

// ── Helpers ─────────────────────────────────────────────────
function waitForAuth() {
  return new Promise(resolve => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      unsubscribe();
      resolve(user || null);
    });
  });
}

// ── Banner flotante programador viendo empresa ─────────────
// Pill discreto en la esquina inferior-derecha.
// Se puede colapsar a solo el ícono. No bloquea el layout.
// _mountProgramadorBanner removed — single-tenant, no empresa context switching

// ── Start ───────────────────────────────────────────────────
boot().catch(err => {
  console.error('[app/main] Error crítico de arranque:', err);
  const spinner = document.getElementById('appLoadingSpinner');
  if (spinner) {
    spinner.innerHTML = `
      <div style="text-align:center;padding:32px;color:rgba(255,255,255,0.7);font-family:sans-serif;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <div style="font-size:14px;margin-bottom:16px;">Error al cargar la app</div>
        <a href="/app/dashboard" style="color:#2ecc71;text-decoration:none;font-size:13px;">Volver al inicio</a>
      </div>
    `;
  }
});
