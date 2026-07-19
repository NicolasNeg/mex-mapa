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

import { auth, db, COL }            from '/js/core/database.js';
import { ShellLayout }              from '/js/shell/shell-layout.js';
import '/js/app/features/unidades/unidades-lookup.js';
import { initState, getState, setCurrentPlaza, subscribe, resolveAvailablePlazas, setState } from '/js/app/app-state.js';
import { createRouter }             from '/js/app/router.js';
import { toAppRoute, isMigratedRoute } from '/js/app/route-resolver.js';
import { getNotificationsSummary } from '/js/app/features/notifications/notifications-summary.js';
import { warmAppAssets, warmAppData, getAppCacheStatus } from '/js/app/app-cache.js';

let _unsubSessionProfile = null;

function _profileDocId(email) {
  return String(email || '').trim().toLowerCase();
}

function _reloadFlagStorageKey(email) {
  return `mex.reload.handled.${_profileDocId(email)}`;
}

function _reloadFlagMarker(profile) {
  const plazas = Array.isArray(profile?.plazasPermitidas)
    ? [...profile.plazasPermitidas].filter(Boolean).map(p => String(p).toUpperCase()).sort()
    : [];
  return JSON.stringify({
    rol: String(profile?.rol || '').toUpperCase().trim(),
    plaza: String(profile?.plazaAsignada || profile?.plaza || '').toUpperCase().trim(),
    plazasPermitidas: plazas,
    status: String(profile?.status || '').trim().toUpperCase(),
    activo: profile?.activo !== false,
    version: String(profile?._version || profile?.version || ''),
    updatedAt: String(profile?._updatedAt || profile?.updatedAt || profile?.lastTouchedAt || 0),
  });
}

function _clearReloadTracking(email) {
  try {
    sessionStorage.removeItem('_reloadGuard');
    localStorage.removeItem(_reloadFlagStorageKey(email));
  } catch (_) {}
}

function _isProfileActive(data) {
  if (!data) return false;
  const status = String(data.status || '').toUpperCase();
  return data.activo !== false
    && data.autorizado !== false
    && data.accesoSistema !== false
    && status !== 'INACTIVO'
    && status !== 'RECHAZADO'
    && status !== 'BLOQUEADO';
}

/** Watcher SPA: kick si inactivo/eliminado; reload anti-loop si `_reloadRequired`. */
function _bindSessionProfileWatcher(email, shellToast) {
  const docId = _profileDocId(email);
  if (!docId || !db?.collection) return;
  if (_unsubSessionProfile) {
    try { _unsubSessionProfile(); } catch (_) {}
    _unsubSessionProfile = null;
  }

  _unsubSessionProfile = db.collection(COL.USERS).doc(docId).onSnapshot(snap => {
    if (!snap.exists) {
      shellToast?.('Tu usuario ya no existe. Cerrando sesión…', 'error');
      handleLogout();
      return;
    }
    const data = snap.data() || {};
    if (!_isProfileActive(data)) {
      shellToast?.('Tu acceso fue desactivado. Cerrando sesión…', 'error');
      handleLogout();
      return;
    }

    // Mantener app-state alineado con Firestore (plaza/rol en vivo).
    try {
      const nextRole = String(data.rol || getState().role || 'AUXILIAR').toUpperCase();
      const nextProfile = { ...(getState().profile || {}), ...data, id: docId, email: docId };
      const nextPlazas = resolveAvailablePlazas(nextProfile, nextRole);
      setState({
        profile: nextProfile,
        role: nextRole,
        availablePlazas: nextPlazas,
        canSwitchPlaza: nextPlazas.length > 1,
      });
      window.mexPerms?.init?.(nextRole);
    } catch (_) {}

    const reloadMarker = _reloadFlagMarker(data);
    let handledMarker = '';
    try { handledMarker = localStorage.getItem(_reloadFlagStorageKey(docId)) || ''; } catch (_) {}

    if (data._reloadRequired && !sessionStorage.getItem('_reloadGuard') && handledMarker !== reloadMarker) {
      try {
        sessionStorage.setItem('_reloadGuard', '1');
        localStorage.setItem(_reloadFlagStorageKey(docId), reloadMarker);
      } catch (_) {}

      db.collection(COL.USERS).doc(docId)
        .update({ _reloadRequired: false })
        .catch(err => console.warn('[_reloadRequired SPA] No se pudo limpiar flag:', err?.code || err));

      shellToast?.('Tus permisos fueron actualizados. Recargando…', 'warning');
      setTimeout(() => { window.location.reload(); }, 1200);
      return;
    }

    if (!data._reloadRequired) {
      _clearReloadTracking(docId);
    }
  }, err => console.warn('[app/main] session profile watcher:', err));
}

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
  // Panel programador: sin link de nav; abrir /app/programador por URL.

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

  // window.mexPerms resuelve rol via MEX_CONFIG.profile/_userProfile, que la SPA
  // nunca puebla — sin este init(), mexPerms.canDo() trata a todos como AUXILIAR.
  window.mexPerms?.init?.(role);

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

  // 5b. Gate de ubicación (sesión SPA) — bloqueante hasta permitir.
  _setBootStatus('Verificando ubicación…');
  if (typeof window.__mexRequireLocationAccess === 'function' && !qaAuthBypass) {
    try {
      await window.__mexRequireLocationAccess({ allowLogout: true });
    } catch (err) {
      console.warn('[app/main] location gate:', err);
    }
  }

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
      host.style.cssText = 'position:fixed;bottom:20px;right:16px;z-index:13000;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
      root.appendChild(host);
    }
    while (host.children.length >= 2) {
      try { host.firstElementChild?.remove(); } catch (_) {}
    }
    const el = document.createElement('div');
    const tone = type === 'error'
      ? 'background:#fee2e2;border:1px solid #fecaca;'
      : type === 'warning'
        ? 'background:#fef9c3;border:1px solid #fde047;'
        : 'background:#ecfccb;border:1px solid #bef264;';
    el.style.cssText = `pointer-events:auto;display:flex;align-items:flex-start;gap:10px;padding:11px 12px;border-radius:10px;font-size:13px;font-weight:600;max-width:min(360px,calc(100vw - 32px));box-shadow:0 10px 30px rgba(2,6,23,.18);color:#0f172a;${tone}`;
    const msg = document.createElement('span');
    msg.style.cssText = 'flex:1;min-width:0;line-height:1.35;';
    msg.textContent = text;
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar');
    close.textContent = '×';
    close.style.cssText = 'border:0;background:transparent;color:#64748b;font-size:18px;line-height:1;cursor:pointer;padding:0 2px;';
    close.addEventListener('click', () => { try { el.remove(); } catch (_) {} });
    el.appendChild(msg);
    el.appendChild(close);
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
    // Modo "En página": teclear filtra la vista actual en vivo (comportamiento
    // previo). Modo "Global": teclear no hace nada; el panel se abre por submit.
    onSearchInput: payload => {
      if (payload?.mode !== 'inpage') return;
      window.dispatchEvent(new CustomEvent('mex:global-search', {
        detail: {
          query: String(payload?.query || ''),
          route: String(payload?.route || getState().currentRoute || ''),
          source: 'shell-header'
        }
      }));
    },
    // Submit (Enter o lupa): en modo Global abre el panel BUSCAR UNIDAD.
    onSearchSubmit: payload => {
      if (payload?.mode !== 'global') return;
      if (typeof window.__mexBuscadorOpen === 'function') {
        window.__mexBuscadorOpen(String(payload?.query || ''));
      }
    }
  });

  loadSpinner?.remove();

  // Watcher de sesión: kick / reload anti-loop (paridad con mapa.js).
  if (!qaAuthBypass) {
    _bindSessionProfileWatcher(user.email || profile.email || profile.id, shellToast);
  }

  // (Banner de programador eliminado — single-tenant, sin contexto multi-empresa)

  // 6. Crear router — renderiza la vista inicial automáticamente
  router = createRouter({ shell });
  // Navegación SPA global (la usa el buscador global para "Ir al mapa").
  window.__mexShellNavigate = (path, opts) => router.navigate(path, opts || {});
  // Acceso directo: navega al mapa y deja pendiente el MVA a resaltar
  // (legacy-stage / vista SPA lo reenvían cuando el mapa está listo). Si la unidad
  // está en otra plaza permitida, cambia la plaza activa primero.
  window.__mexGoToMapUnit = (mva, plaza) => {
    const token = String(mva || '').trim().toUpperCase();
    if (!token) return;
    const p = String(plaza || '').trim().toUpperCase();
    // Payload rico: no limpiar hasta focus OK o timeout (evita race plaza/render).
    window.__mexPendingMapFocus = { mva: token, plaza: p || '', at: Date.now() };
    if (p && p !== String(getState().currentPlaza || '').toUpperCase() && window.__mexCanViewPlaza(p)) {
      setCurrentPlaza(p, { source: 'buscador-ir-al-mapa' });
    }
    const onMapa = String(getState().currentRoute || window.location.pathname || '')
      .replace(/\/$/, '')
      .startsWith('/app/mapa');
    if (onMapa) {
      window.__mexApplyPendingMapFocus?.();
      return;
    }
    router.navigate('/app/mapa');
  };
  // Reintento compartido (SPA mapa nativo o ya montado).
  window.__mexApplyPendingMapFocus = (opts = {}) => {
    const pend = window.__mexPendingMapFocus;
    if (!pend) return;
    const token = typeof pend === 'string'
      ? String(pend).trim().toUpperCase()
      : String(pend.mva || '').trim().toUpperCase();
    if (!token) { window.__mexPendingMapFocus = null; return; }
    let tries = 0;
    const maxTries = Number(opts.maxTries) > 0 ? Number(opts.maxTries) : 90;
    const tick = () => {
      tries++;
      let ok = false;
      try {
        if (typeof window.__mexEnsureMapaRendered === 'function') window.__mexEnsureMapaRendered();
      } catch (_) {}
      try { ok = window.__mexFocusUnidad?.(token) === true; } catch (_) {}
      if (ok) {
        window.__mexPendingMapFocus = null;
        return;
      }
      if (tries > maxTries) {
        window.__mexPendingMapFocus = null;
        try {
          if (typeof window.showToast === 'function') {
            window.showToast(`No se encontró ${token} en el mapa (¿otra plaza o aún cargando?)`, 'warning');
          }
        } catch (_) {}
        return;
      }
      setTimeout(tick, 200);
    };
    setTimeout(tick, opts.delayMs != null ? opts.delayMs : 80);
  };
  window.__mexGoToUnidad = (mva, opts = {}) => {
    const token = String(mva || '').trim().toUpperCase();
    if (!token) return;
    let path = `/app/cuadre/u/${encodeURIComponent(token)}`;
    if (opts?.edit) path += '?edit=1';
    router.navigate(path);
  };
  window.__mexCanViewUnidadExpediente = () => {
    const role = String(getState().role || getState().profile?.rol || getState().profile?.role || '').toUpperCase().trim();
    const LEVEL = { AUXILIAR: 1, VENTAS: 2, SUPERVISOR: 3, JEFE_PATIO: 4, GERENTE_PLAZA: 5, JEFE_REGIONAL: 6, CORPORATIVO_USER: 7, JEFE_OPERACION: 8, PROGRAMADOR: 9 };
    return (LEVEL[role] || 0) >= LEVEL.VENTAS;
  };
  // ¿El usuario puede ver esta plaza? (para mostrar/ocultar "Ver en mapa").
  window.__mexCanViewPlaza = (plaza) => {
    const p = String(plaza || '').trim().toUpperCase();
    if (!p) return false;
    const list = (getState().availablePlazas || []).map(x => String(x || '').toUpperCase());
    return list.length === 0 || list.includes(p);
  };
  _runWhenIdle(() => {
    warmAppAssets().catch(err => console.warn('[app/main] precache assets:', err));
  }, 700);
  // Calentar el cache del buscador global (índice + usuarios) en idle → primera
  // búsqueda instantánea. Usa localStorage si está fresco (0 lecturas).
  _runWhenIdle(() => { try { window.__mexBuscadorPrefetch?.(); } catch (_) {} }, 1500);
  // Precalentar el mapa en segundo plano (import del monolito + inyección del
  // stage) para que el PRIMER clic a /app/mapa sea instantáneo. El stage nace
  // oculto; render inicial desde cache local. Idempotente (guard mexInit).
  if (window.location.pathname !== '/app/mapa') {
    _runWhenIdle(() => {
      import('/js/app/views/mapa.js')
        .then(m => m.ensureStageReady?.())
        .catch(err => console.warn('[app/main] preload mapa:', err));
    }, 2500);
  }
  _scheduleAppWarmup('boot');
  window.__mexWarmAppData = (options = {}) => warmAppData(getState(), { reason: 'manual', force: true, ...options });
  window.__mexAppCacheStatus = () => getAppCacheStatus(getState());
  void refreshNotifSummary({ force: true });
  // Antes del preload del mapa (~2.5s) para bloquear toast/rutas del shell.
  _runWhenIdle(() => {
    _loadNotificationCenter()
      .then(mod => mod.setupAppNotificationCenter?.({ router, toast: shellToast }))
      .then(() => refreshNotifSummary({ force: true }))
      .catch(err => console.warn('[app/main] Notificaciones diferidas:', err));
  }, 400);
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
    if (_unsubSessionProfile) {
      try { _unsubSessionProfile(); } catch (_) {}
      _unsubSessionProfile = null;
    }
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
