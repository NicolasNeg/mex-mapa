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
    onBellClick:  ()      => handleBellClick(),
    onPlazaChange: (nextPlaza) => {
      setCurrentPlaza(nextPlaza, { source: 'app-shell-header' });
    }
  });

  loadSpinner?.remove();

  // 6. Crear router — renderiza la vista inicial automáticamente
  const router = createRouter({ shell });

  subscribe(state => {
    shell.setPlaza(state.currentPlaza, state.availablePlazas, state.canSwitchPlaza);
  });

  window.addEventListener('mex:plaza-change', event => {
    const nextPlaza = String(event?.detail?.plaza || '').toUpperCase().trim();
    if (!nextPlaza || nextPlaza === getState().currentPlaza) return;
    setCurrentPlaza(nextPlaza, { source: event?.detail?.source || 'legacy-sync' });
  });
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

function handleBellClick() {
  if (typeof window._openAlertsOrNotifications === 'function') {
    window._openAlertsOrNotifications();
    return;
  }
  if (typeof window.openNotificationCenter === 'function') {
    window.openNotificationCenter();
    return;
  }
  import('/js/core/notifications.js')
    .then(mod => {
      if (typeof mod?.openNotificationCenter === 'function') {
        window.openNotificationCenter = mod.openNotificationCenter;
        mod.openNotificationCenter();
      }
    })
    .catch(() => {});
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
