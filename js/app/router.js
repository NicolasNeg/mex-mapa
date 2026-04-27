// ═══════════════════════════════════════════════════════════
//  /js/app/router.js
//  Router cliente para /app/* usando History API.
//
//  Rutas internas (renderizan una vista sin recargar):
//    /app           → redirect a /app/dashboard
//    /app/dashboard → views/dashboard.js
//
//  Todas las demás /app/* → placeholder con enlace legacy.
//  Rutas fuera de /app/* → window.location.href (navegación real).
//
//  Patrón de vista: cada módulo exporta mount() y unmount().
//  El router llama unmount() en la vista anterior antes de montar.
// ═══════════════════════════════════════════════════════════

import { setState, getState } from '/js/app/app-state.js';

// ── Tabla de rutas ───────────────────────────────────────────
// loader:    () => Promise<{ mount, unmount }>
// redirect:  string  — alias, redirige sin render
// navRoute:  string  — ruta que se activa en el sidebar (cuando difiere del path)
const ROUTE_TABLE = {
  '/app':            { redirect: '/app/dashboard' },
  '/app/dashboard':  { loader: () => import('/js/app/views/dashboard.js') },
  '/app/profile':    {
    loader:   () => import('/js/app/views/profile.js'),
    navRoute: '/profile'     // el sidebar resalta "Mi perfil"
  },
  '/app/mensajes':          {
    loader:   () => import('/js/app/views/mensajes.js'),
    navRoute: '/mensajes'
  },
  '/app/cola-preparacion':  {
    loader:   () => import('/js/app/views/cola-preparacion.js'),
    navRoute: '/cola-preparacion'
  },
  '/app/incidencias':       {
    loader:   () => import('/js/app/views/incidencias.js'),
    navRoute: '/incidencias'
  },
  '/app/cuadre':            {
    loader:   () => import('/js/app/views/cuadre.js'),
    navRoute: '/cuadre'
  },
  '/app/admin':             {
    loader:   () => import('/js/app/views/admin.js'),
    navRoute: '/gestion'    // el sidebar resalta "Gestión" / "Panel admin"
  },
  '/app/programador':       {
    loader:   () => import('/js/app/views/programador.js'),
    navRoute: '/programador'
  },
  // /app/mapa — vista bridge (Fase 7). El mapa completo sigue en /mapa legacy.
  '/app/mapa': {
    loader:   () => import('/js/app/views/mapa.js'),
    navRoute: '/mapa',
  },
};

// ── Factory ──────────────────────────────────────────────────
/**
 * @param {{ shell: import('/js/shell/shell-layout.js').ShellLayout }} options
 * @returns {{ navigate: (path: string, opts?: {replace?: boolean}) => void,
 *             isInternalAppRoute: (path: string) => boolean }}
 */
export function createRouter({ shell }) {
  let _currentUnmount = null; // función unmount de la vista activa

  // ── Predicado ─────────────────────────────────────────────
  function isInternalAppRoute(path) {
    return typeof path === 'string' && path.startsWith('/app');
  }

  // ── Navegar ───────────────────────────────────────────────
  function navigate(path, { replace = false } = {}) {
    if (!isInternalAppRoute(path)) {
      window.location.href = path;
      return;
    }
    if (replace) {
      history.replaceState({}, '', path);
    } else {
      history.pushState({}, '', path);
    }
    _renderRoute(path);
  }

  // ── Renderizar ruta ───────────────────────────────────────
  async function _renderRoute(rawPath) {
    const path = rawPath.replace(/\/$/, '') || '/app/dashboard';
    const route = ROUTE_TABLE[path];

    // Redirect alias (ej. /app → /app/dashboard)
    if (route?.redirect) {
      navigate(route.redirect, { replace: true });
      return;
    }

    // Actualizar estado global
    setState({ currentRoute: path });

    // Sincronizar header y sidebar.
    // navRoute permite resaltar un item legacy cuando la URL vive en /app/*
    // (ej. /app/profile → resalta nav item "/profile")
    shell.setRoute(route?.navRoute || path);

    // Cerrar drawer mobile si está abierto
    shell.sidebar?.closeMobileDrawer?.();

    // Unmount vista anterior
    if (typeof _currentUnmount === 'function') {
      try { _currentUnmount(); } catch (_) {}
      _currentUnmount = null;
    }

    const contentEl = shell.contentEl;
    if (!contentEl) return;

    // Vista registrada
    if (route?.loader) {
      contentEl.innerHTML = '<div style="padding:32px;text-align:center;color:#64748b;font-size:13px;">Cargando…</div>';
      try {
        const mod = await route.loader();
        if (typeof mod.mount === 'function') {
          mod.mount({ container: contentEl, navigate, shell, state: getState() });
          _currentUnmount = mod.unmount ?? null;
        }
      } catch (err) {
        console.error('[router] Error cargando vista:', path, err);
        _renderError(contentEl, path, err);
      }
      return;
    }

    // Ruta /app/* sin vista registrada → placeholder
    _renderPlaceholder(contentEl, path);
  }

  // ── Placeholder para rutas /app/* no implementadas ────────
  function _renderPlaceholder(contentEl, path) {
    const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    contentEl.innerHTML = `
      <div style="padding:48px 24px;max-width:520px;margin:0 auto;font-family:'Inter',sans-serif;text-align:center;">
        <div style="width:64px;height:64px;border-radius:20px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
          <span class="material-symbols-outlined" style="font-size:32px;color:#94a3b8;">construction</span>
        </div>
        <h2 style="font-size:20px;font-weight:800;color:#0f172a;margin:0 0 8px;">Vista en construcción</h2>
        <p style="font-size:14px;color:#64748b;margin:0 0 6px;line-height:1.6;">
          La ruta <code style="background:#f1f5f9;padding:2px 6px;border-radius:5px;font-size:12.5px;">${esc(path)}</code>
          aún no está migrada al router interno.
        </p>
        <p style="font-size:13px;color:#94a3b8;margin:0 0 28px;">
          Usa el menú lateral para acceder a las rutas productivas.
        </p>
        <a data-app-route="/app/dashboard" href="/app/dashboard"
           style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#0f172a;color:#fff;text-decoration:none;font-size:13px;font-weight:600;">
          <span class="material-symbols-outlined" style="font-size:16px;">home</span>
          Ir al Dashboard
        </a>
      </div>
    `;
  }

  // ── Error al cargar vista ─────────────────────────────────
  function _renderError(contentEl, path, err) {
    const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    contentEl.innerHTML = `
      <div style="padding:48px 24px;max-width:520px;margin:0 auto;font-family:'Inter',sans-serif;text-align:center;">
        <div style="width:64px;height:64px;border-radius:20px;background:#fef2f2;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
          <span class="material-symbols-outlined" style="font-size:32px;color:#ef4444;">error</span>
        </div>
        <h2 style="font-size:20px;font-weight:800;color:#0f172a;margin:0 0 8px;">Error al cargar vista</h2>
        <p style="font-size:13px;color:#94a3b8;margin:0 0 28px;font-family:monospace;">${esc(String(err?.message || err))}</p>
        <button onclick="window.location.reload()"
                style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:#0f172a;color:#fff;border:none;font-size:13px;font-weight:600;cursor:pointer;">
          <span class="material-symbols-outlined" style="font-size:16px;">refresh</span>
          Recargar
        </button>
      </div>
    `;
  }

  // ── Interceptor global de clicks en [data-app-route] ──────
  document.addEventListener('click', event => {
    const anchor = event.target.closest('[data-app-route]');
    if (!anchor) return;
    const route = anchor.dataset.appRoute;
    if (!route) return;
    event.preventDefault();
    navigate(route);
  }, { capture: false });

  // ── Popstate (back/forward del navegador) ─────────────────
  window.addEventListener('popstate', () => {
    const path = window.location.pathname;
    if (isInternalAppRoute(path)) {
      _renderRoute(path);
    }
  });

  // ── Renderizar la ruta inicial ────────────────────────────
  _renderRoute(window.location.pathname);

  return { navigate, isInternalAppRoute };
}
