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
import { initState, getState, setCurrentPlaza, subscribe, resolveAvailablePlazas } from '/js/app/app-state.js';
import { createRouter }             from '/js/app/router.js';
import { toAppRoute, isMigratedRoute } from '/js/app/route-resolver.js';
import { getNotificationsSummary } from '/js/app/features/notifications/notifications-summary.js';

// ── Boot ────────────────────────────────────────────────────
async function boot() {
  // 1. Esperar estado de auth
  const user = await waitForAuth();

  if (!user) {
    window.location.replace('/login');
    return;
  }

  // 2. Cargar perfil
  let profile = null;
  try {
    profile = await window.__mexLoadCurrentUserRecord?.(user) ?? null;
  } catch (err) {
    console.warn('[app/main] Error cargando perfil:', err);
  }

  if (!profile) {
    window.location.replace('/login');
    return;
  }

  // 3. Esperar config global si no está resuelta
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

  // 4. Inicializar estado global
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
  let notifMenuEl = null;
  let notifMenuOutsideHandler = null;
  let router = null;
  const closeNotifMenu = () => {
    if (notifMenuEl?.parentNode) notifMenuEl.parentNode.removeChild(notifMenuEl);
    notifMenuEl = null;
    if (notifMenuOutsideHandler) {
      document.removeEventListener('pointerdown', notifMenuOutsideHandler);
      notifMenuOutsideHandler = null;
    }
  };
  const openNotifMenu = () => {
    closeNotifMenu();
    const bellBtn = shell?.header?.element?.querySelector('#mexHdrBell');
    if (!bellBtn) {
      shell?.sidebar?.closeMobileDrawer?.();
      return;
    }
    const menu = document.createElement('div');
    menu.id = 'mexHdrNotifMenu';
    menu.style.position = 'fixed';
    menu.style.zIndex = '240';
    menu.style.width = 'min(290px, calc(100vw - 16px))';
    menu.style.background = '#fff';
    menu.style.border = '1px solid #e2e8f0';
    menu.style.borderRadius = '10px';
    menu.style.boxShadow = '0 14px 30px rgba(2,6,23,.18)';
    menu.style.padding = '8px';
    const rect = bellBtn.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - 300, rect.right - 280));
    menu.style.left = `${left}px`;
    menu.style.top = `${rect.bottom + 8}px`;
    const includeAdmin = Number(notifSummary.solicitudes || 0) > 0;
    menu.innerHTML = `
      <div style="padding:6px 8px 8px;border-bottom:1px solid #f1f5f9;">
        <div style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;">Pendientes</div>
        <div style="font-size:12px;color:#0f172a;font-weight:700;">${notifSummary.total || 0} totales</div>
      </div>
      ${_notifMenuRow('/app/mensajes', 'Mensajes', notifSummary.mensajes)}
      ${_notifMenuRow('/app/incidencias', 'Incidencias', notifSummary.incidencias)}
      ${_notifMenuRow('/app/admin?tab=solicitudes', 'Solicitudes', notifSummary.solicitudes, !includeAdmin)}
    `;
    document.body.appendChild(menu);
    menu.querySelectorAll('[data-app-route]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeNotifMenu();
        if (router?.navigate) router.navigate(btn.dataset.appRoute);
        else window.location.href = btn.dataset.appRoute;
      });
    });
    notifMenuOutsideHandler = event => {
      if (!menu.contains(event.target) && !bellBtn.contains(event.target)) closeNotifMenu();
    };
    document.addEventListener('pointerdown', notifMenuOutsideHandler);
    notifMenuEl = menu;
  };
  const refreshNotifSummary = async () => {
    const state = getState();
    notifSummary = await getNotificationsSummary({
      profile: state.profile || {},
      role: state.role || '',
      plaza: state.currentPlaza || ''
    }).catch(() => ({ total: 0, mensajes: 0, incidencias: 0, alertas: 0, solicitudes: 0 }));
    shell.setBellBadge(Number(notifSummary.total || 0) > 0);
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
    onBellClick:  ()      => openNotifMenu(),
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

  // 6. Crear router — renderiza la vista inicial automáticamente
  router = createRouter({ shell });
  await refreshNotifSummary();
  notifTimer = window.setInterval(() => {
    refreshNotifSummary();
  }, 60000);

  subscribe(state => {
    shell.setPlaza(state.currentPlaza, state.availablePlazas, state.canSwitchPlaza);
    refreshNotifSummary();
  });

  window.addEventListener('mex:plaza-change', event => {
    const nextPlaza = String(event?.detail?.plaza || '').toUpperCase().trim();
    if (!nextPlaza || nextPlaza === getState().currentPlaza) return;
    setCurrentPlaza(nextPlaza, { source: event?.detail?.source || 'legacy-sync' });
  });
  window.addEventListener('beforeunload', () => {
    if (notifTimer) clearInterval(notifTimer);
    closeNotifMenu();
  }, { once: true });
}

// ── Handlers ────────────────────────────────────────────────
async function handleLogout() {
  try {
    await auth.signOut();
  } catch (err) {
    console.error('[app/main] Error en logout:', err);
  }
  window.location.replace('/login');
}

// ── Helpers ─────────────────────────────────────────────────
function _notifMenuRow(route, label, count, hidden = false) {
  if (hidden) return '';
  const safeCount = Number(count || 0);
  return `
    <button data-app-route="${route}" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;border:none;background:#fff;color:#1e293b;padding:9px 8px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;">
      <span>${label}</span>
      <span style="font-size:11px;color:${safeCount ? '#b91c1c' : '#64748b'};font-weight:800;">${safeCount || 0}</span>
    </button>
  `;
}

function waitForAuth() {
  return new Promise(resolve => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      unsubscribe();
      resolve(user || null);
    });
  });
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
