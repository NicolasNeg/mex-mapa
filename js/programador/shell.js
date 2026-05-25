// ═══════════════════════════════════════════════════════════
//  /js/programador/shell.js  —  Shell + Router del Panel Programador
// ═══════════════════════════════════════════════════════════

let _profile = null;
let _navigate = null;
let _currentUnmount = null;
let _currentNav = '';

// ── Tabla de rutas ────────────────────────────────────────
const ROUTES = [
  { pattern: '/programador',                        redirect: () => '/programador/overview' },
  { pattern: '/programador/overview',               title: 'Overview',             nav: '/programador/overview',  loader: () => import('./views/overview.js') },
  { pattern: '/programador/saas',                   title: 'Empresas · SaaS',      nav: '/programador/saas',      loader: () => import('./views/saas.js') },
  { pattern: '/programador/contratos',               title: 'Contratos SaaS',       nav: '/programador/contratos', loader: () => import('./views/contratos.js') },
  { pattern: '/programador/metricas',               title: 'Métricas SaaS',        nav: '/programador/metricas',  loader: () => import('./views/metricas.js') },
  { pattern: '/programador/facturacion',            title: 'Facturación Global',   nav: '/programador/facturacion', loader: () => import('./views/facturacion-global.js') },
  { pattern: '/programador/empresa/:id',            redirect: p => `/programador/empresa/${p.id}/datos` },
  { pattern: '/programador/empresa/:id/datos',      title: 'Datos Empresa',        nav: '/programador/saas',      loader: () => import('./views/empresa-detail.js') },
  { pattern: '/programador/empresa/:id/facturacion', title: 'Facturación Empresa', nav: '/programador/saas',      loader: () => import('./views/empresa-detail.js') },
  { pattern: '/programador/empresa/:id/contratos',  title: 'Contratos Empresa',    nav: '/programador/saas',      loader: () => import('./views/empresa-detail.js') },
  { pattern: '/programador/empresa/:id/config',     title: 'Config Empresa',       nav: '/programador/saas',      loader: () => import('./views/empresa-detail.js') },
  { pattern: '/programador/empresa/:id/features',   title: 'Features Empresa',     nav: '/programador/saas',      loader: () => import('./views/empresa-detail.js') },
  { pattern: '/programador/empresa/:id/plazas',     title: 'Plazas Empresa',       nav: '/programador/saas',      loader: () => import('./views/empresa-detail.js') },
  { pattern: '/programador/empresa/:id/usuarios',   title: 'Usuarios Empresa',     nav: '/programador/saas',      loader: () => import('./views/empresa-detail.js') },
  { pattern: '/programador/empresa/:id/listas',     title: 'Listas Empresa',       nav: '/programador/saas',      loader: () => import('./views/empresa-detail.js') },
  { pattern: '/programador/empresa/:id/permisos',   title: 'Permisos Empresa',     nav: '/programador/saas',      loader: () => import('./views/empresa-detail.js') },
  { pattern: '/programador/empresa/:id/actividad',  title: 'Actividad Empresa',    nav: '/programador/saas',      loader: () => import('./views/empresa-detail.js') },
  { pattern: '/programador/empresa/:id/soporte',    title: 'Soporte Empresa',      nav: '/programador/saas',      loader: () => import('./views/empresa-detail.js') },
  { pattern: '/programador/empresa/:id/login',      title: 'Login Empresa',        nav: '/programador/saas',      loader: () => import('./views/empresa-detail.js') },
  { pattern: '/programador/tecnico',                title: 'Diagnóstico Técnico',  nav: '/programador/tecnico',   loader: () => import('/js/app/views/programador.js') },
  { pattern: '/programador/logs',                   title: 'Logs del Sistema',     nav: '/programador/logs',      loader: () => import('./views/logs.js') },
  { pattern: '/programador/errores',                title: 'Errores',              nav: '/programador/errores',   loader: () => import('./views/errores.js') },
  { pattern: '/programador/deploy',                 title: 'Deploy & Release',     nav: '/programador/deploy',    loader: () => import('./views/deploy.js') },
];

// ── Inicialización ────────────────────────────────────────
export function mountProgramadorShell({ profile, user, root }) {
  _profile = profile;

  _navigate = function navigate(path, { replace = false } = {}) {
    if (replace) history.replaceState({}, '', path);
    else         history.pushState({}, '', path);
    _renderRoute(window.location.pathname);
  };

  root.innerHTML = _shellHtml(profile);
  _bindShellEvents();

  // Popstate (back/forward)
  window.addEventListener('popstate', () => _renderRoute(window.location.pathname));

  // Interceptor global de clicks en [data-prog-route]
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-prog-route]');
    if (!el) return;
    const path = el.dataset.progRoute;
    if (!path) return;
    e.preventDefault();
    _navigate(path);
  });

  _renderRoute(window.location.pathname);
}

// ── Matching ──────────────────────────────────────────────
function _matchRoute(pathname) {
  for (const route of ROUTES) {
    const parts  = route.pattern.split('/');
    const actual = pathname.replace(/\/$/, '').split('/');
    if (parts.length !== actual.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) {
        params[parts[i].slice(1)] = decodeURIComponent(actual[i] || '');
      } else if (parts[i] !== actual[i]) {
        ok = false; break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

// ── Render ruta ───────────────────────────────────────────
async function _renderRoute(pathname) {
  const match = _matchRoute(pathname);
  if (!match) {
    _renderContent(`<div style="padding:40px;color:rgba(255,255,255,0.3);text-align:center;font-size:13px;">Ruta no encontrada: ${_esc(pathname)}</div>`);
    return;
  }
  const { route, params } = match;

  if (route.redirect) {
    _navigate(typeof route.redirect === 'function' ? route.redirect(params) : route.redirect, { replace: true });
    return;
  }

  // Update sidebar + header
  _currentNav = route.nav || '';
  _syncSidebar(pathname, params);
  _setHeaderTitle(route.title || '', pathname, params);

  // Unmount vista anterior
  if (typeof _currentUnmount === 'function') {
    try { _currentUnmount(); } catch (_) {}
    _currentUnmount = null;
  }

  const contentEl = document.getElementById('progContent');
  if (!contentEl) return;
  contentEl.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.2);font-size:13px;">Cargando…</div>';

  try {
    const mod = await route.loader();
    if (typeof mod.mount === 'function') {
      await mod.mount({ container: contentEl, params, pathname, navigate: _navigate, profile: _profile });
      _currentUnmount = mod.unmount ?? null;
    }
  } catch (err) {
    console.error('[prog/shell] Error en ruta', pathname, err);
    contentEl.innerHTML = `
      <div style="padding:40px;text-align:center;">
        <div style="color:#f87171;font-size:13px;margin-bottom:8px;">Error al cargar vista</div>
        <code style="color:rgba(255,255,255,0.3);font-size:11px;">${_esc(String(err?.message || err))}</code>
      </div>`;
  }
}

// ── Sidebar sync ──────────────────────────────────────────
function _syncSidebar(pathname, params) {
  // Actualizar nav items principales
  document.querySelectorAll('[data-prog-nav]').forEach(btn => {
    btn.classList.toggle('prog-nav-active', btn.dataset.progNav === _currentNav);
  });

  // Sub-nav empresa (solo si estamos en /programador/empresa/:id/*)
  const empresaSubnav = document.getElementById('progEmpresaSubnav');
  if (!empresaSubnav) return;

  const isEmpresaRoute = pathname.startsWith('/programador/empresa/');
  empresaSubnav.style.display = isEmpresaRoute ? 'block' : 'none';

  if (isEmpresaRoute && params.id) {
    const id = params.id;
    empresaSubnav.querySelectorAll('[data-prog-subnav]').forEach(btn => {
      const target = `/programador/empresa/${id}/${btn.dataset.progSubnav}`;
      btn.dataset.progRoute = target;
      btn.classList.toggle('prog-subnav-active', pathname === target || pathname.startsWith(target));
    });

    // Mostrar empresa ID en el subnav header
    const nameEl = empresaSubnav.querySelector('#progEmpresaSubnavId');
    if (nameEl) nameEl.textContent = id;

    // Intentar cargar nombre real si está disponible
    if (window._db) {
      window._db.collection('empresas').doc(id).get().then(snap => {
        if (snap.exists) {
          const nombre = snap.data().nombre || id;
          const nameEl2 = empresaSubnav.querySelector('#progEmpresaSubnavId');
          if (nameEl2) nameEl2.textContent = nombre;
          const titleEl = document.getElementById('progHeaderTitle');
          if (titleEl && titleEl.dataset.empresaCtx === id) {
            titleEl.textContent = `${snap.data().nombre || id}`;
          }
        }
      }).catch(() => {});
    }
  }
}

function _setHeaderTitle(title, pathname, params) {
  const titleEl = document.getElementById('progHeaderTitle');
  if (!titleEl) return;

  if (pathname.startsWith('/programador/empresa/') && params.id) {
    titleEl.textContent = params.id;
    titleEl.dataset.empresaCtx = params.id;
  } else {
    titleEl.textContent = title;
    titleEl.dataset.empresaCtx = '';
  }
}

// ── Helpers de render ─────────────────────────────────────
function _renderContent(html) {
  const el = document.getElementById('progContent');
  if (el) el.innerHTML = html;
}

// ── Eventos del shell ─────────────────────────────────────
const _THEME_KEY = 'mex.prog.theme';

function _applyTheme(theme) {
  const isLight = theme === 'light';
  if (isLight) {
    document.documentElement.setAttribute('data-prog-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-prog-theme');
  }
  const labelEl = document.getElementById('progThemeLabel');
  const iconEl  = document.getElementById('progThemeToggle')?.querySelector('.material-symbols-outlined');
  if (labelEl) labelEl.textContent = isLight ? 'Oscuro' : 'Claro';
  if (iconEl)  iconEl.textContent  = isLight ? 'dark_mode' : 'light_mode';
}

function _openMobileSidebar() {
  document.getElementById('progSidebar')?.classList.add('prog-sidebar-open');
  document.getElementById('progMobileBackdrop')?.classList.add('visible');
}

function _closeMobileSidebar() {
  document.getElementById('progSidebar')?.classList.remove('prog-sidebar-open');
  document.getElementById('progMobileBackdrop')?.classList.remove('visible');
}

function _bindShellEvents() {
  document.getElementById('progLogoutBtn')?.addEventListener('click', async () => {
    try { await window._auth?.signOut(); } catch (_) {}
    window.location.replace('/login');
  });

  // Mobile sidebar
  document.getElementById('progMobileToggle')?.addEventListener('click', _openMobileSidebar);
  document.getElementById('progMobileBackdrop')?.addEventListener('click', _closeMobileSidebar);

  // Close sidebar on any nav click (mobile UX)
  document.addEventListener('click', e => {
    if (e.target.closest('.prog-nav-btn') || e.target.closest('.prog-subnav-btn')) {
      if (window.innerWidth <= 768) _closeMobileSidebar();
    }
  });

  // Theme toggle
  const saved = localStorage.getItem(_THEME_KEY) || 'dark';
  _applyTheme(saved);

  document.getElementById('progThemeToggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-prog-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    localStorage.setItem(_THEME_KEY, next);
    _applyTheme(next);
  });
}

// ── HTML del shell ────────────────────────────────────────
function _shellHtml(profile) {
  const initials  = _initials(profile);
  const shortName = String(profile.nombreCompleto || profile.nombre || profile.email || 'Programador').trim().split(' ')[0];

  return `
<div id="progShell" style="display:flex;height:100dvh;min-height:0;background:#070d16;font-family:Inter,sans-serif;color:#fff;overflow:hidden;">

  <!-- Mobile backdrop -->
  <div id="progMobileBackdrop"></div>

  <!-- Sidebar -->
  <aside id="progSidebar" style="width:228px;flex-shrink:0;background:#0a1220;border-right:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;overflow:hidden;">

    <!-- Branding -->
    <div style="padding:16px 14px 14px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#4f46e5,#7c3aed);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span style="font-size:14px;font-weight:900;color:#fff;">MG</span>
        </div>
        <div>
          <div style="font-size:11px;font-weight:800;color:#818cf8;text-transform:uppercase;letter-spacing:.06em;line-height:1.3;">MapGestion</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.28);line-height:1.4;">Admin Panel · SaaS</div>
        </div>
      </div>
    </div>

    <!-- Nav principal -->
    <nav id="progNav" style="padding:10px 8px 6px;flex-shrink:0;overflow-y:auto;flex:1;">

      <button data-prog-nav="/programador/overview" data-prog-route="/programador/overview" class="prog-nav-btn" type="button">
        <span class="material-symbols-outlined prog-nav-icon">dashboard</span>
        <span>Overview</span>
      </button>

      <div class="prog-nav-section">SaaS</div>

      <button data-prog-nav="/programador/saas" data-prog-route="/programador/saas" class="prog-nav-btn" type="button">
        <span class="material-symbols-outlined prog-nav-icon">domain</span>
        <span>Empresas</span>
      </button>
      <button data-prog-nav="/programador/contratos" data-prog-route="/programador/contratos" class="prog-nav-btn" type="button">
        <span class="material-symbols-outlined prog-nav-icon">description</span>
        <span>Contratos</span>
      </button>
      <button data-prog-nav="/programador/metricas" data-prog-route="/programador/metricas" class="prog-nav-btn" type="button">
        <span class="material-symbols-outlined prog-nav-icon">bar_chart</span>
        <span>Métricas</span>
      </button>
      <button data-prog-nav="/programador/facturacion" data-prog-route="/programador/facturacion" class="prog-nav-btn" type="button">
        <span class="material-symbols-outlined prog-nav-icon">account_balance_wallet</span>
        <span>Facturación</span>
      </button>

      <div class="prog-nav-section">Sistema</div>

      <button data-prog-nav="/programador/tecnico" data-prog-route="/programador/tecnico" class="prog-nav-btn" type="button">
        <span class="material-symbols-outlined prog-nav-icon">terminal</span>
        <span>Diagnóstico</span>
      </button>
      <button data-prog-nav="/programador/deploy" data-prog-route="/programador/deploy" class="prog-nav-btn" type="button">
        <span class="material-symbols-outlined prog-nav-icon">rocket_launch</span>
        <span>Deploy</span>
      </button>
      <button data-prog-nav="/programador/logs" data-prog-route="/programador/logs" class="prog-nav-btn" type="button">
        <span class="material-symbols-outlined prog-nav-icon">list_alt</span>
        <span>Logs</span>
      </button>
      <button data-prog-nav="/programador/errores" data-prog-route="/programador/errores" class="prog-nav-btn" type="button">
        <span class="material-symbols-outlined prog-nav-icon">warning</span>
        <span>Errores</span>
      </button>

      <!-- Sub-nav empresa (oculto por defecto) -->
      <div id="progEmpresaSubnav" style="display:none;margin-top:8px;border-top:1px solid rgba(255,255,255,0.06);padding-top:8px;flex-shrink:0;">
        <button data-prog-route="/programador/saas" class="prog-nav-btn" type="button" style="margin-bottom:4px;">
          <span class="material-symbols-outlined prog-nav-icon">arrow_back</span>
          <span>Empresas</span>
        </button>
        <div style="padding:6px 10px 6px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" id="progEmpresaSubnavId">—</div>
        <button data-prog-subnav="datos"       class="prog-subnav-btn" type="button">
          <span class="material-symbols-outlined" style="font-size:15px;">business</span>Datos
        </button>
        <button data-prog-subnav="facturacion" class="prog-subnav-btn" type="button">
          <span class="material-symbols-outlined" style="font-size:15px;">payments</span>Facturación
        </button>
        <button data-prog-subnav="contratos"   class="prog-subnav-btn" type="button">
          <span class="material-symbols-outlined" style="font-size:15px;">description</span>Contratos
        </button>
        <button data-prog-subnav="config"    class="prog-subnav-btn" type="button">
          <span class="material-symbols-outlined" style="font-size:15px;">settings</span>Configuración
        </button>
        <button data-prog-subnav="features"  class="prog-subnav-btn" type="button">
          <span class="material-symbols-outlined" style="font-size:15px;">toggle_on</span>Features
        </button>
        <button data-prog-subnav="permisos"  class="prog-subnav-btn" type="button">
          <span class="material-symbols-outlined" style="font-size:15px;">security</span>Permisos
        </button>
        <button data-prog-subnav="plazas"    class="prog-subnav-btn" type="button">
          <span class="material-symbols-outlined" style="font-size:15px;">location_on</span>Plazas
        </button>
        <button data-prog-subnav="listas"    class="prog-subnav-btn" type="button">
          <span class="material-symbols-outlined" style="font-size:15px;">list</span>Listas
        </button>
        <button data-prog-subnav="usuarios"  class="prog-subnav-btn" type="button">
          <span class="material-symbols-outlined" style="font-size:15px;">group</span>Usuarios
        </button>
        <button data-prog-subnav="actividad" class="prog-subnav-btn" type="button">
          <span class="material-symbols-outlined" style="font-size:15px;">monitoring</span>Actividad
        </button>
        <button data-prog-subnav="soporte"   class="prog-subnav-btn" type="button">
          <span class="material-symbols-outlined" style="font-size:15px;">support_agent</span>Soporte
        </button>
        <button data-prog-subnav="login"     class="prog-subnav-btn" type="button">
          <span class="material-symbols-outlined" style="font-size:15px;">language</span>Login
        </button>
      </div>
    </nav>

    <!-- User footer -->
    <div style="padding:8px 8px 12px;border-top:1px solid rgba(255,255,255,0.06);flex-shrink:0;">
      <div style="padding:8px 8px;display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <div style="width:28px;height:28px;border-radius:50%;background:#1e2d42;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px;font-weight:800;color:#818cf8;">${_esc(initials)}</div>
        <div style="min-width:0;flex:1;">
          <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(shortName)}</div>
          <div style="font-size:10px;color:#6366f1;font-weight:600;">PROGRAMADOR</div>
        </div>
      </div>
      <button id="progLogoutBtn" type="button" style="width:100%;display:flex;align-items:center;gap:7px;padding:7px 10px;border-radius:7px;border:none;background:transparent;color:rgba(255,255,255,0.3);font-size:12px;font-family:Inter,sans-serif;font-weight:600;cursor:pointer;">
        <span class="material-symbols-outlined" style="font-size:15px;">logout</span>Cerrar sesión
      </button>
    </div>
  </aside>

  <!-- Main -->
  <main style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;">
    <!-- Header -->
    <header style="height:50px;flex-shrink:0;background:#070d16;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;padding:0 16px;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;min-width:0;">
        <button id="progMobileToggle" type="button" style="display:none;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:rgba(255,255,255,0.6);cursor:pointer;flex-shrink:0;">
          <span class="material-symbols-outlined" style="font-size:20px;">menu</span>
        </button>
        <h1 id="progHeaderTitle" style="margin:0;font-size:14px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;"></h1>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        <span style="font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;background:rgba(99,102,241,0.12);color:#818cf8;border:1px solid rgba(99,102,241,0.22);border-radius:5px;padding:2px 8px;white-space:nowrap;">SUPERADMIN</span>
        <button id="progThemeToggle" type="button" class="prog-header-action-btn">
          <span class="material-symbols-outlined" style="font-size:14px;">light_mode</span>
          <span id="progThemeLabel" class="prog-header-label">Claro</span>
        </button>
        <a href="/app/dashboard" class="prog-header-action-btn" style="text-decoration:none;">
          <span class="material-symbols-outlined" style="font-size:13px;">open_in_new</span>
          <span class="prog-header-label">Ver App</span>
        </a>
      </div>
    </header>

    <!-- Content -->
    <div id="progContent" style="flex:1;overflow:auto;background:#070d16;"></div>
  </main>
</div>

<style>
* { box-sizing: border-box; }

.prog-nav-section {
  font-size:9px;font-weight:800;text-transform:uppercase;
  color:rgba(255,255,255,0.2);letter-spacing:.08em;
  padding:10px 10px 4px;
}

.prog-nav-btn {
  display:flex;align-items:center;gap:9px;width:100%;
  padding:8px 10px;border-radius:7px;border:none;
  background:transparent;color:rgba(255,255,255,0.4);
  font-size:12px;font-family:Inter,sans-serif;font-weight:600;
  cursor:pointer;text-align:left;transition:background .12s,color .12s;
  margin-bottom:1px;
}
.prog-nav-btn:hover { background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.75); }
.prog-nav-btn.prog-nav-active { background:rgba(99,102,241,0.14);color:#a5b4fc; }
.prog-nav-icon { font-size:17px; }
.prog-nav-btn.prog-nav-active .prog-nav-icon { color:#6366f1; }

.prog-subnav-btn {
  display:flex;align-items:center;gap:8px;width:100%;
  padding:7px 10px 7px 14px;border-radius:6px;border:none;
  background:transparent;color:rgba(255,255,255,0.35);
  font-size:11px;font-family:Inter,sans-serif;font-weight:600;
  cursor:pointer;text-align:left;transition:background .12s,color .12s;
  margin-bottom:1px;
}
.prog-subnav-btn:hover { background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.65); }
.prog-subnav-btn.prog-subnav-active { background:rgba(99,102,241,0.1);color:#a5b4fc; }

.prog-header-action-btn {
  display:flex;align-items:center;gap:5px;
  padding:5px 10px;border-radius:7px;
  background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
  color:rgba(255,255,255,0.5);font-size:12px;font-weight:600;
  font-family:Inter,sans-serif;cursor:pointer;white-space:nowrap;
}

#progLogoutBtn:hover { background:rgba(239,68,68,0.08);color:#f87171; }

/* ── Mobile responsive ────────────────────────────────── */
#progMobileBackdrop {
  display:none;
  position:fixed;inset:0;
  background:rgba(0,0,0,0.55);
  backdrop-filter:blur(2px);
  -webkit-backdrop-filter:blur(2px);
  z-index:199;
}
#progMobileBackdrop.visible { display:block; }

@media (max-width: 768px) {
  #progMobileToggle { display:flex !important; }
  .prog-header-label { display:none; }

  #progSidebar {
    position:fixed;
    left:-240px;
    top:0;
    height:100dvh;
    z-index:200;
    transition:left .25s cubic-bezier(.4,0,.2,1);
    box-shadow:none;
  }
  #progSidebar.prog-sidebar-open {
    left:0;
    box-shadow:4px 0 32px rgba(0,0,0,.6);
  }

  #progContent { padding-bottom:env(safe-area-inset-bottom); }
}

@media (max-width: 480px) {
  .prog-header-action-btn span.material-symbols-outlined + span { display:none; }
}
</style>`;
}

// ── Utils ─────────────────────────────────────────────────
function _initials(profile) {
  const name = String(profile.nombreCompleto || profile.nombre || profile.email || '').trim();
  const parts = name.replace(/[._@]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || 'P').slice(0, 2).toUpperCase();
}

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
