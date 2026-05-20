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

// ── Boot ────────────────────────────────────────────────────
async function boot() {
  const qaAuthBypass = _isLocalQaAuthBypassEnabled();
  window.__MEX_QA_AUTH_BYPASS = qaAuthBypass;
  // 1. Esperar estado de auth
  const user = qaAuthBypass ? _qaBypassUser() : await waitForAuth();

  if (!user) {
    window.location.replace('/login');
    return;
  }

  // 2. Cargar perfil
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

  // 3. Cargar contexto de empresa (tenant) para este usuario
  if (!qaAuthBypass && typeof window.mexEmpresaContext?.cargarParaUsuario === 'function') {
    await window.mexEmpresaContext.cargarParaUsuario(profile).catch(err =>
      console.warn('[app/main] empresa context:', err)
    );
    // After loading empresa, invalidate bootstrap config cache so the correct
    // tenant name and plazas are used when the shell reads window.__mexCompanyName.
    if (window._empresaActual && !window._empresaActual.isSuperAdminContext) {
      window.__mexInvalidateConfigCache?.();
    }
  }

  // 3b. PROGRAMADOR sin empresa seleccionada → redirigir al panel programador
  if (!qaAuthBypass && String(profile.rol || '').toUpperCase() === 'PROGRAMADOR') {
    const empresaActual = window._empresaActual;
    if (!empresaActual || empresaActual.isSuperAdminContext === true) {
      window.location.replace('/programador');
      return;
    }
  }

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
    onSearchInput: payload => {
      window.dispatchEvent(new CustomEvent('mex:global-search', {
        detail: {
          query: String(payload?.query || ''),
          route: String(payload?.route || getState().currentRoute || ''),
          source: 'shell-header'
        }
      }));
    }
  });

  loadSpinner?.remove();

  // Banner para PROGRAMADOR que está viendo una empresa específica
  if (role === 'PROGRAMADOR' && window._empresaActual && !window._empresaActual.isSuperAdminContext) {
    _mountProgramadorBanner(window._empresaActual, appRoot);
  }

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
function _mountProgramadorBanner(empresa) {
  const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Default: collapsed. Only expand if user explicitly clicked expand ('0' stored).
  const stored = (() => { try { return localStorage.getItem('mex.prog.bannerCollapsed') !== '0'; } catch (_) { return true; } })();

  const pill = document.createElement('div');
  pill.id = 'progEmpresaBanner';
  pill.setAttribute('data-collapsed', stored ? '1' : '0');
  pill.style.cssText = `
    position:fixed;bottom:18px;right:16px;z-index:2000;
    font-family:Inter,sans-serif;
    transition:all .22s ease;
  `;

  function _render(collapsed) {
    if (collapsed) {
      pill.innerHTML = `
        <button id="progBannerExpandBtn" title="Panel programador activo — click para ver opciones" type="button" style="
          display:flex;align-items:center;justify-content:center;
          width:36px;height:36px;border-radius:50%;
          background:rgba(79,70,229,0.92);backdrop-filter:blur(8px);
          border:2px solid rgba(255,255,255,0.2);
          box-shadow:0 4px 16px rgba(79,70,229,0.4);
          cursor:pointer;transition:transform .15s;
        ">
          <span class="material-symbols-outlined" style="font-size:17px;color:#fff;">visibility</span>
        </button>`;
      pill.querySelector('#progBannerExpandBtn')?.addEventListener('click', () => {
        try { localStorage.setItem('mex.prog.bannerCollapsed', '0'); } catch (_) {}
        pill.setAttribute('data-collapsed', '0');
        _render(false);
      });
    } else {
      pill.innerHTML = `
        <div style="
          display:flex;align-items:center;gap:10px;
          background:rgba(23,18,62,0.94);backdrop-filter:blur(10px);
          border:1px solid rgba(99,102,241,0.35);border-radius:12px;
          padding:8px 12px;
          box-shadow:0 4px 20px rgba(0,0,0,0.35);
          max-width:320px;
        ">
          <span class="material-symbols-outlined" style="font-size:15px;color:#818cf8;flex-shrink:0;">visibility</span>
          <div style="min-width:0;flex:1;">
            <div style="font-size:10px;color:rgba(255,255,255,0.45);font-weight:600;line-height:1.3;">PROGRAMADOR</div>
            <div style="font-size:12px;font-weight:800;color:#e0e7ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(empresa.nombre || empresa.id)}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button id="progBannerCollapseBtn" title="Minimizar" type="button" style="
              width:26px;height:26px;border-radius:6px;border:none;
              background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.5);
              cursor:pointer;display:flex;align-items:center;justify-content:center;
            ">
              <span class="material-symbols-outlined" style="font-size:14px;">minimize</span>
            </button>
            <button id="progBannerExitBtn" title="Salir de empresa" type="button" style="
              display:flex;align-items:center;gap:4px;
              padding:4px 8px;border-radius:6px;border:none;
              background:rgba(99,102,241,0.25);color:#a5b4fc;
              font-size:11px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;
            ">
              <span class="material-symbols-outlined" style="font-size:12px;">logout</span>
              Salir
            </button>
          </div>
        </div>`;
      pill.querySelector('#progBannerCollapseBtn')?.addEventListener('click', () => {
        try { localStorage.setItem('mex.prog.bannerCollapsed', '1'); } catch (_) {}
        pill.setAttribute('data-collapsed', '1');
        _render(true);
      });
      pill.querySelector('#progBannerExitBtn')?.addEventListener('click', () => {
        try {
          sessionStorage.setItem('mex.empresaCtx.v1', JSON.stringify('__superadmin__'));
          localStorage.setItem('mex.empresaCtx.local.v1', JSON.stringify('__superadmin__'));
          localStorage.removeItem('mex.prog.bannerCollapsed');
        } catch (_) {}
        window._empresaActual = null;
        window.location.replace('/programador');
      });
    }
  }

  _render(stored);
  document.body.appendChild(pill);
}

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
