import { auth, db, COL } from '/js/core/database.js';
import { esAdmin, esGlobal } from '/domain/permissions.model.js';
import { buildMapaViewModel } from '/mapa/mapa-view-model.js';
import { normalizarUnidad } from '/domain/unidad.model.js';
import { normalizarElemento } from '/domain/mapa.model.js';

const ROLE_LABELS = {
  AUXILIAR: 'AUXILIAR',
  VENTAS: 'VENTAS',
  SUPERVISOR: 'SUPERVISOR',
  JEFE_PATIO: 'JEFE DE PATIO',
  GERENTE_PLAZA: 'GERENTE DE PLAZA',
  JEFE_REGIONAL: 'JEFE REGIONAL',
  CORPORATIVO_USER: 'CORPORATIVO',
  PROGRAMADOR: 'PROGRAMADOR',
  JEFE_OPERACION: 'JEFE DE OPERACIÓN'
};

const HOME_SIDEBAR_COLLAPSED_KEY = 'mex.home.sidebar.collapsed.v1';
const HOME_METRICS_SESSION_PREFIX = 'mex.home.metrics.v1.';
const HOME_METRICS_LOCAL_PREFIX = 'mex.home.metrics.local.v1.';
const HOME_METRICS_CACHE_TTL_MS = 120000;

const HOME_VARIANTS = {
  operacion: {
    kicker: 'Operación diaria',
    title: 'Tu centro rápido de patio y movimiento',
    description: 'Entra al módulo correcto sin pasar siempre por el mismo flujo. El mapa sigue siendo clave, pero ahora el sistema arranca con contexto.',
    ctaTitle: 'Ir al mapa operativo',
    modules: [
      {
        id: 'mapa',
        title: 'Mapa operativo',
        description: 'Ubicar, mover y validar unidades desde la plaza activa.',
        route: '/mapa',
        icon: 'map',
        badge: 'Principal',
        tone: 'linear-gradient(135deg, #07111f 0%, #0f766e 100%)'
      },
      {
        id: 'mensajes',
        title: 'Mensajes',
        description: 'Coordinación interna, evidencias y seguimiento del equipo.',
        route: '/mensajes',
        icon: 'mail',
        tone: 'linear-gradient(135deg, #07111f 0%, #0f766e 100%)'
      },
      {
        id: 'cuadre',
        title: 'Cuadre',
        description: 'Ir al cierre, control y predicción diaria de la plaza foco.',
        route: '/cuadre',
        icon: 'fact_check',
        tone: 'linear-gradient(135deg, #064e3b 0%, #16a34a 100%)'
      },
      {
        id: 'cola',
        title: 'Cola de preparación',
        description: 'Checklist, prioridad de salida y avance de unidades listas.',
        route: '/cola-preparacion',
        icon: 'format_list_bulleted',
        tone: 'linear-gradient(135deg, #7c2d12 0%, #b49a5e 100%)'
      }
    ]
  },
  admin: {
    kicker: 'Centro administrativo',
    title: 'Configuración, supervisión y acceso al flujo real',
    description: 'Arranque por rol con accesos agrupados y una shell consistente para entrar al módulo correcto sin perder la plaza activa.',
    ctaTitle: 'Abrir panel admin',
    modules: [
      {
        id: 'admin',
        title: 'Panel admin',
        description: 'Usuarios, roles, plazas, ubicaciones y catálogos del negocio.',
        route: '/gestion?tab=usuarios',
        icon: 'admin_panel_settings',
        badge: 'Principal',
        requires: 'admin',
        tone: 'linear-gradient(135deg, #07111f 0%, #064e3b 100%)'
      },
      {
        id: 'mapa',
        title: 'Mapa operativo',
        description: 'Revisar acomodo real y bajar al patio solo cuando lo necesites.',
        route: '/mapa',
        icon: 'map',
        tone: 'linear-gradient(135deg, #07111f 0%, #0f766e 100%)'
      },
      {
        id: 'cuadre',
        title: 'Cuadres y reportes',
        description: 'Seguimiento diario de cierres, predicción y validación operativa.',
        route: '/cuadre',
        icon: 'analytics',
        tone: 'linear-gradient(135deg, #064e3b 0%, #b49a5e 100%)'
      },
      {
        id: 'mensajes',
        title: 'Mensajes',
        description: 'Atender coordinación interna, solicitudes y seguimiento.',
        route: '/mensajes',
        icon: 'chat',
        tone: 'linear-gradient(135deg, #1e293b 0%, #475569 100%)'
      }
    ]
  },
  corporativo: {
    kicker: 'Visión global',
    title: 'Dashboard de acceso ejecutivo por plaza y área',
    description: 'Un arranque más limpio para dirección y corporativo, con foco en decisiones, contexto y entrada selectiva al detalle operativo.',
    ctaTitle: 'Abrir cuadres y reportes',
    modules: [
      {
        id: 'cuadre',
        title: 'Cuadres y reportes',
        description: 'Consultar cierres, presión operativa y seguimiento por plaza.',
        route: '/cuadre',
        icon: 'analytics',
        badge: 'Principal',
        tone: 'linear-gradient(135deg, #07111f 0%, #0f766e 100%)'
      },
      {
        id: 'admin',
        title: 'Panel admin',
        description: 'Entrar a configuración, plazas y estructura del sistema.',
        route: '/gestion?tab=usuarios',
        icon: 'admin_panel_settings',
        requires: 'admin',
        tone: 'linear-gradient(135deg, #064e3b 0%, #0f766e 100%)'
      },
      {
        id: 'mapa',
        title: 'Mapa de referencia',
        description: 'Ir al detalle operativo solo cuando necesites contexto real del patio.',
        route: '/mapa',
        icon: 'map',
        tone: 'linear-gradient(135deg, #07111f 0%, #0f766e 100%)'
      },
      {
        id: 'mensajes',
        title: 'Mensajes',
        description: 'Abrir comunicaciones y avisos internos recientes.',
        route: '/mensajes',
        icon: 'mail',
        tone: 'linear-gradient(135deg, #1e293b 0%, #64748b 100%)'
      }
    ]
  },
  programador: {
    kicker: 'Plataforma y observabilidad',
    title: 'Shell técnica con acceso directo a producto real',
    description: 'Consola, panel admin, mapa y mensajería agrupados en una misma entrada para dejar atrás el mapa como home universal.',
    ctaTitle: 'Abrir consola tecnica',
    modules: [
      {
        id: 'programador',
        title: 'Consola técnica',
        description: 'Salud del sistema, clientes, cache, errores y herramientas seguras.',
        route: '/programador',
        icon: 'terminal',
        badge: 'Principal',
        requires: 'programmer',
        tone: 'linear-gradient(135deg, #07111f 0%, #0f766e 100%)'
      },
      {
        id: 'admin',
        title: 'Panel admin',
        description: 'Configuración administrativa y control de catálogos del sistema.',
        route: '/gestion?tab=usuarios',
        icon: 'admin_panel_settings',
        requires: 'admin',
        tone: 'linear-gradient(135deg, #07111f 0%, #0f766e 100%)'
      },
      {
        id: 'mapa',
        title: 'Mapa operativo',
        description: 'Entrar al flujo real del patio con plaza foco compartida.',
        route: '/mapa',
        icon: 'map',
        tone: 'linear-gradient(135deg, #064e3b 0%, #16a34a 100%)'
      },
      {
        id: 'mensajes',
        title: 'Mensajes',
        description: 'Depurar experiencia del chat y revisar actividad del cliente.',
        route: '/mensajes',
        icon: 'mail',
        tone: 'linear-gradient(135deg, #1e293b 0%, #475569 100%)'
      }
    ]
  }
};

const _homeState = {
  query: '',
  collapsed: (() => {
    try {
      return localStorage.getItem(HOME_SIDEBAR_COLLAPSED_KEY) === '1';
    } catch (_) {
      return false;
    }
  })(),
  profile: null,
  config: null,
  metrics: null
};

function safe(value) {
  return String(value ?? '').trim();
}

function upper(value) {
  return safe(value).toUpperCase();
}

function lower(value) {
  return safe(value).toLowerCase();
}

function escapeHtml(value) {
  return safe(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readJsonStorage(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : '';
  } catch (_) {
    return '';
  }
}

function writeJsonStorage(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

function roleKey(profile = {}) {
  return upper(profile.rol || 'AUXILIAR');
}

function roleLabel(profile = {}) {
  return ROLE_LABELS[roleKey(profile)] || roleKey(profile) || 'USUARIO';
}

function permissionOverrides(profile = {}) {
  return profile?.permissionOverrides && typeof profile.permissionOverrides === 'object'
    ? profile.permissionOverrides
    : {};
}

function canAccessAdminPanel(profile = {}) {
  const overrides = permissionOverrides(profile);
  if (overrides.view_admin_panel === false) return false;
  if (overrides.view_admin_panel === true) return true;
  const role = roleKey(profile);
  return role === 'PROGRAMADOR' || role === 'JEFE_OPERACION' || esAdmin(role) || esGlobal(role);
}

function canAccessProgrammer(profile = {}) {
  const overrides = permissionOverrides(profile);
  if (overrides.view_admin_programmer === false) return false;
  if (overrides.view_admin_programmer === true) return true;
  const role = roleKey(profile);
  return role === 'PROGRAMADOR' || role === 'JEFE_OPERACION';
}

function activePlaza() {
  return upper(
    window.getMexCurrentPlaza?.()
    || readJsonStorage(sessionStorage, 'mex.activePlaza.v1')
    || readJsonStorage(localStorage, 'mex.activePlaza.local.v1')
  );
}

function setActivePlaza(plaza = '') {
  const normalized = upper(plaza);
  if (typeof window.setMexCurrentPlaza === 'function') {
    window.setMexCurrentPlaza(normalized, { persistLocal: true, source: 'home' });
  }
  return normalized;
}

function homeVariant(profile = {}) {
  const role = roleKey(profile);
  if (role === 'PROGRAMADOR' || role === 'JEFE_OPERACION') return 'programador';
  if (esGlobal(role)) return 'corporativo';
  if (canAccessAdminPanel(profile)) return 'admin';
  return 'operacion';
}

function availablePlazas(profile = {}, config = {}) {
  const empresa = config?.empresa || {};
  const fromConfig = Array.isArray(empresa.plazas) ? empresa.plazas.map(upper).filter(Boolean) : [];
  const fromDetail = Array.isArray(empresa.plazasDetalle) ? empresa.plazasDetalle.map(item => upper(item?.id)).filter(Boolean) : [];
  const fromProfile = [
    upper(profile.plazaAsignada),
    ...(Array.isArray(profile.plazasPermitidas) ? profile.plazasPermitidas.map(upper) : [])
  ].filter(Boolean);
  const plazas = [...new Set([...fromConfig, ...fromDetail, ...fromProfile])];
  if (esGlobal(roleKey(profile))) return plazas;
  return plazas.filter(plaza => !fromProfile.length || fromProfile.includes(plaza));
}

async function resolveProfile(user) {
  const email = lower(user?.email || '');
  if (!email) return null;

  if (typeof window.__mexLoadCurrentUserRecord === 'function') {
    const cached = await window.__mexLoadCurrentUserRecord(user).catch(() => null);
    if (cached) {
      return {
        ...cached,
        email,
        nombre: safe(cached.nombre || cached.usuario || email),
        rol: upper(cached.rol || 'AUXILIAR'),
        plazaAsignada: upper(cached.plazaAsignada || cached.plaza || ''),
        plazasPermitidas: Array.isArray(cached.plazasPermitidas) ? cached.plazasPermitidas.map(upper).filter(Boolean) : [],
        permissionOverrides: permissionOverrides(cached)
      };
    }
  }

  const [direct, byEmail] = await Promise.all([
    db.collection(COL.USERS).doc(email).get(),
    db.collection(COL.USERS).where('email', '==', email).limit(1).get()
  ]);

  const doc = direct.exists ? direct : (!byEmail.empty ? byEmail.docs[0] : null);
  if (!doc) return null;

  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    email,
    nombre: safe(data.nombre || data.usuario || email),
    rol: upper(data.rol || 'AUXILIAR'),
    plazaAsignada: upper(data.plazaAsignada || data.plaza || ''),
    plazasPermitidas: Array.isArray(data.plazasPermitidas) ? data.plazasPermitidas.map(upper).filter(Boolean) : [],
    permissionOverrides: permissionOverrides(data)
  };
}

async function loadConfig(plaza = '') {
  try {
    if (typeof window.__mexEnsureConfigLoaded === 'function') {
      return await window.__mexEnsureConfigLoaded(plaza || '');
    }
    if (window.api?.obtenerConfiguracion) {
      return await window.api.obtenerConfiguracion(plaza || '');
    }
  } catch (error) {
    console.warn('[home] No se pudo cargar MEX_CONFIG:', error);
  }
  return window.MEX_CONFIG || { empresa: {}, listas: {} };
}

function homeMetricsCacheKey(profile = {}, plaza = '') {
  const email = lower(profile?.email || auth.currentUser?.email || 'anon');
  const focus = upper(plaza || profile?.plazaAsignada || 'GLOBAL') || 'GLOBAL';
  return `${email}::${focus}`;
}

function readCachedMetrics(profile = {}, plaza = '') {
  const key = homeMetricsCacheKey(profile, plaza);
  const payload = readJsonStorage(sessionStorage, `${HOME_METRICS_SESSION_PREFIX}${key}`)
    || readJsonStorage(localStorage, `${HOME_METRICS_LOCAL_PREFIX}${key}`);
  if (!payload || typeof payload !== 'object') return null;
  const ts = Number(payload.ts || 0);
  if (!Number.isFinite(ts) || (Date.now() - ts) > HOME_METRICS_CACHE_TTL_MS) return null;
  return payload.data && typeof payload.data === 'object' ? payload.data : null;
}

function persistCachedMetrics(profile = {}, plaza = '', metrics = {}) {
  const key = homeMetricsCacheKey(profile, plaza);
  const payload = {
    ts: Date.now(),
    data: metrics
  };
  writeJsonStorage(sessionStorage, `${HOME_METRICS_SESSION_PREFIX}${key}`, payload);
  writeJsonStorage(localStorage, `${HOME_METRICS_LOCAL_PREFIX}${key}`, payload);
  return metrics;
}

async function safeCount(queryPromise) {
  try {
    const snapshot = await queryPromise;
    return snapshot?.size || 0;
  } catch (_) {
    return 0;
  }
}

async function loadMetrics(profile = {}, plaza = '') {
  const role = roleKey(profile);
  const focus = upper(plaza || profile.plazaAsignada || '');
  const [
    cuadreCount,
    externosCount,
    incidenciasAbiertas,
    solicitudesPendientes
  ] = await Promise.all([
    focus ? safeCount(db.collection(COL.CUADRE).where('plaza', '==', focus).limit(180).get()) : Promise.resolve(0),
    focus ? safeCount(db.collection(COL.EXTERNOS).where('plaza', '==', focus).limit(180).get()) : Promise.resolve(0),
    focus ? safeCount(db.collection('plazas').doc(focus).collection('incidencias').where('estado', '==', 'ABIERTA').limit(80).get()) : Promise.resolve(0),
    (canAccessAdminPanel(profile) || esGlobal(role))
      ? safeCount(db.collection('solicitudes').where('estado', '==', 'PENDIENTE').limit(80).get())
      : Promise.resolve(0)
  ]);

  return persistCachedMetrics(profile, focus, {
    focus,
    unidadesActivas: cuadreCount,
    externosActivos: externosCount,
    incidenciasAbiertas,
    solicitudesPendientes
  });
}

function isModuleAvailable(module = {}, profile = {}) {
  if (module.requires === 'admin') return canAccessAdminPanel(profile);
  if (module.requires === 'programmer') return canAccessProgrammer(profile);
  return true;
}

function availableModules(profile = {}) {
  const variant = HOME_VARIANTS[homeVariant(profile)];
  return (variant?.modules || []).filter(module => isModuleAvailable(module, profile));
}

function moduleMeta(module = {}, metrics = {}) {
  if (module.route === '/mapa') return `${metrics.focus || 'Sin plaza'} · ${metrics.unidadesActivas || 0} unidades`;
  if (module.route === '/mensajes') return 'Comunicacion interna';
  if (module.route === '/cuadre') return `${metrics.externosActivos || 0} externos en foco`;
  if (module.route.startsWith('/gestion')) return `${metrics.solicitudesPendientes || 0} solicitudes pendientes`;
  if (module.route === '/programador') return `${metrics.incidenciasAbiertas || 0} incidencias abiertas`;
  return 'Acceso rápido';
}

function pendingItems(variantKey, metrics = {}) {
  const items = [];
  if (metrics.focus) items.push({ icon: 'place', text: `Plaza foco actual: ${metrics.focus}` });
  if (metrics.unidadesActivas > 0) items.push({ icon: 'directions_car', text: `${metrics.unidadesActivas} unidades visibles en operacion` });
  if (metrics.externosActivos > 0) items.push({ icon: 'swap_horiz', text: `${metrics.externosActivos} unidades externas registradas` });
  if (metrics.incidenciasAbiertas > 0) items.push({ icon: 'priority_high', text: `${metrics.incidenciasAbiertas} incidencias abiertas en la plaza foco` });
  if (metrics.solicitudesPendientes > 0 && variantKey !== 'operacion') {
    items.push({ icon: 'mail_lock', text: `${metrics.solicitudesPendientes} solicitudes pendientes de revision` });
  }
  return items;
}

function companyName(config = {}) {
  return safe(config?.empresa?.nombre || 'MAPA');
}

function visiblePlazaLabel(profile = {}, plazas = [], currentPlaza = '') {
  if (plazas.length > 1) return `${plazas.length} plazas visibles`;
  if (currentPlaza) return currentPlaza;
  return upper(profile.plazaAsignada || '') || 'Sin plaza';
}

function filterModules(modules = [], query = '') {
  const q = lower(query);
  if (!q) return modules;
  return modules.filter(module => {
    const haystack = lower([module.title, module.description, module.route, module.id].join(' '));
    return haystack.includes(q);
  });
}

export function sidebarGroups(profile = {}, metrics = {}, currentPlaza = '') {
  const groups = [
    {
      label: 'Principal',
      items: [
        {
          label: 'Inicio',
          description: 'Tablero por rol',
          route: '/home',
          icon: 'home',
          active: true
        }
      ]
    },
    {
      label: 'Operación',
      items: [
        {
          label: 'Mapa',
          description: `${currentPlaza || 'Sin plaza'} · ${metrics.unidadesActivas || 0} unidades`,
          route: '/mapa',
          icon: 'map'
        },
        {
          label: 'Mensajes',
          description: 'Coordinación y chat',
          route: '/mensajes',
          icon: 'chat'
        },
        {
          label: 'Cuadre',
          description: `${metrics.externosActivos || 0} externos en foco`,
          route: '/cuadre',
          icon: 'fact_check'
        },
        {
          label: 'Cola prep.',
          description: 'Salidas y checklist',
          route: '/cola-preparacion',
          icon: 'format_list_bulleted'
        }
      ]
    }
  ];

  const managementItems = [];
  if (canAccessAdminPanel(profile)) {
    managementItems.push({
      label: 'Panel admin',
      description: `${metrics.solicitudesPendientes || 0} solicitudes pendientes`,
      route: '/gestion?tab=usuarios',
      icon: 'admin_panel_settings'
    });
  }
  if (canAccessProgrammer(profile)) {
    managementItems.push({
      label: 'Consola',
      description: `${metrics.incidenciasAbiertas || 0} incidencias abiertas`,
      route: '/programador',
      icon: 'terminal'
    });
  }
  if (managementItems.length) {
    groups.push({
      label: 'Gestion',
      items: managementItems
    });
  }

  groups.push({
      label: 'Cuenta',
    items: [
      {
        label: 'Mi perfil',
        description: roleLabel(profile),
        route: '/profile',
        icon: 'person'
      },
      {
        label: 'Cerrar sesion',
          description: 'Salir de esta cuenta',
        action: 'logout',
        icon: 'logout'
      }
    ]
  });

  return groups;
}

function renderNoAccess(profile = null) {
  const root = document.getElementById('homeApp');
  if (!root) return;
  root.innerHTML = `
    <div class="home-loading-card">
      <div class="home-auth-gap">
        <div class="home-kicker">Acceso pendiente</div>
        <strong>${escapeHtml(profile?.email || 'No encontramos tu perfil')}</strong>
        <span>La cuenta inició sesión, pero todavía no existe un perfil operativo dentro del sistema.</span>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button type="button" class="home-btn primary" data-route="/solicitud">
            <span class="material-icons">how_to_reg</span>
            Solicitar acceso
          </button>
          <button type="button" class="home-btn" id="homeLogoutBtn">
            <span class="material-icons">logout</span>
            Cerrar sesion
          </button>
        </div>
      </div>
    </div>
  `;
  root.querySelector('[data-route="/solicitud"]')?.addEventListener('click', () => {
    window.location.href = '/solicitud';
  });
  document.getElementById('homeLogoutBtn')?.addEventListener('click', async () => {
    await auth.signOut().catch(() => { });
    window.location.replace('/login');
  });
}

function navigateTo(route = '/mapa') {
  const target = safe(route) || '/mapa';
  window.location.href = target;
}

async function logoutHome() {
  await auth.signOut().catch(() => { });
  window.location.replace('/login');
}

function saveSidebarState(collapsed) {
  _homeState.collapsed = Boolean(collapsed);
  try {
    localStorage.setItem(HOME_SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch (_) { }
}

export function renderSidebarHTML(profile, metrics, currentPlaza, company, userName, currentRoute = '/home') {
  const variantKey = homeVariant(profile);
  const isMapRoute = String(currentRoute || '').toLowerCase() === '/mapa';
  const sidebarLayoutClass = isMapRoute
    ? 'shell-sidebar-surface fixed inset-y-0 left-0 z-50 flex flex-col justify-between py-8 w-[280px] h-screen overflow-y-auto transform -translate-x-full lg:translate-x-0 lg:relative lg:inset-auto lg:w-full lg:h-full lg:self-stretch'
    : 'shell-sidebar-surface fixed h-full w-[280px] left-0 top-0 z-50 flex flex-col justify-between py-8 overflow-y-auto transform -translate-x-full lg:translate-x-0 transition-transform duration-300 ease-in-out';
  const navGroups = sidebarGroups(profile, metrics, currentPlaza);
  let navHtml = '';
  navGroups.forEach(group => {
    if(group.label === 'Cuenta') return;
    navHtml += `<div class="px-6 mb-2 mt-4"><p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2">${escapeHtml(group.label)}</p></div>`;
    group.items.forEach(item => {
      const isActive = item.route === currentRoute;
      const activeClass = isActive
        ? "bg-amber-500/10 text-amber-500 border-l-4 border-amber-500"
        : "text-slate-400 hover:text-slate-100 hover:bg-secondary/5 border-l-4 border-transparent";

      const fillStyle = isActive ? `style="font-variation-settings: 'FILL' 1;"` : '';

      navHtml += `
        <a class="shell-nav-link flex items-center gap-3 px-6 py-4 transition-all duration-300 active:scale-[0.98] cursor-pointer ${isActive ? 'is-active' : ''} ${activeClass}"
           ${item.route ? `data-route="${escapeHtml(item.route)}"` : ''}>
          <span class="material-symbols-outlined" data-icon="${escapeHtml(item.icon)}" ${fillStyle}>${escapeHtml(item.icon)}</span>
          <span class="font-sans text-sm font-medium tracking-wide">${escapeHtml(item.label)}</span>
        </a>
      `;
    });
  });

  return `
    <!-- Mobile Overlay -->
    <div id="mobileOverlay" class="shell-mobile-overlay fixed inset-0 bg-slate-900/50 z-40 hidden opacity-0 transition-opacity duration-300 lg:hidden" style="position:fixed; z-index:900000;"></div>

    <!-- Persistent SideNavBar -->
    <aside id="homeSidebar" class="${sidebarLayoutClass} bg-[#07111f]" style="z-index:900001; border-right:1px solid #1a2538;">
      <div>
        <!-- Brand Header -->
        <div class="shell-sidebar-brand px-8 mb-10">
          <div class="flex items-center gap-3 mb-2">
            <div class="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center">
              <span class="material-symbols-outlined text-white" data-icon="rocket_launch">rocket_launch</span>
            </div>
            <div>
              <h1 class="text-white font-black tracking-tighter text-xl uppercase">${escapeHtml(company)}</h1>
              <p class="text-on-primary-container text-[10px] uppercase tracking-widest font-bold">Operational HQ</p>
            </div>
          </div>
        </div>

        <!-- User Info Section -->
        <div class="shell-sidebar-user px-6 mb-8">
          <div class="rounded-xl p-4 flex items-center gap-3" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);">
            <div class="w-10 h-10 rounded-full border-2 border-secondary bg-slate-700 flex items-center justify-center text-white font-bold uppercase overflow-hidden shrink-0">
              ${escapeHtml((userName[0] || 'U').toUpperCase())}
            </div>
            <div class="overflow-hidden">
              <p class="text-white font-semibold text-sm truncate">${escapeHtml(userName)}</p>
              <p class="text-slate-400 text-xs truncate">${escapeHtml(roleLabel(profile))}</p>
            </div>
          </div>
        </div>

        <!-- Navigation Links -->
        <nav class="space-y-1">
          ${navHtml}
        </nav>
      </div>

      <!-- Footer Actions -->
      <div class="shell-sidebar-footer px-6 mt-8">
        <button class="w-full bg-secondary text-white py-3 px-4 rounded-xl font-bold text-sm mb-4 flex items-center justify-center gap-2 hover:opacity-90 transition-all active:scale-95 shadow-lg shadow-secondary/20" data-route="/cola-preparacion">
          <span class="material-symbols-outlined text-sm" data-icon="add">add</span>
          Nuevo Despacho
        </button>
        <a class="flex items-center gap-3 px-6 py-4 text-slate-400 hover:text-error transition-all duration-300 border-t border-slate-800/50 pt-6 cursor-pointer" data-action="logout">
          <span class="material-symbols-outlined" data-icon="logout">logout</span>
          <span class="font-sans text-sm font-medium tracking-wide">Cerrar Sesión</span>
        </a>
      </div>
    </aside>
  `;
}

function renderHome(profile, config, metrics) {
  const root = document.getElementById('homeApp');
  if (!root) return;

  _homeState.profile = profile;
  _homeState.config = config;
  _homeState.metrics = metrics;

  const variantKey = homeVariant(profile);
  const variant = HOME_VARIANTS[variantKey];
  const plazas = availablePlazas(profile, config);
  const currentPlaza = upper(metrics.focus || activePlaza() || plazas[0] || profile.plazaAsignada || '');
  const userName = safe(profile.nombre || profile.email || 'Usuario');
  const company = companyName(config);

  const now = new Date();
  const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  const dateString = now.toLocaleDateString('es-MX', dateOptions);

  root.innerHTML = renderSidebarHTML(profile, metrics, currentPlaza, company, userName, '/home') + `
    <!-- TopAppBar -->
    <header class="shell-topbar-surface fixed top-0 right-0 w-full lg:w-[calc(100%-280px)] h-16 z-30 flex justify-between items-center px-4 lg:px-8 shadow-sm">
      <div class="flex items-center gap-2 lg:gap-4">
        <button id="mobileMenuBtn" class="lg:hidden p-2 text-slate-500 hover:text-secondary hover:bg-slate-100 rounded-lg transition-all border border-transparent">
          <span class="material-symbols-outlined" data-icon="menu">menu</span>
        </button>
        <div class="relative hidden md:block">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" data-icon="search">search</span>
          <input class="bg-slate-100 border border-slate-200 rounded-full py-2 pl-10 pr-4 text-sm text-slate-700 w-80 focus:ring-1 focus:ring-secondary/50 placeholder:text-slate-400 outline-none" placeholder="Buscar vehículo, ruta..." type="text"/>
        </div>
      </div>

      <div class="flex items-center gap-6">
        <select id="homePlazaSelect" class="bg-slate-100 border border-slate-200 rounded-full py-2 px-4 text-sm text-slate-700 font-semibold focus:ring-1 focus:ring-secondary/50 outline-none cursor-pointer" ${plazas.length <= 1 ? 'disabled' : ''}>
          ${(plazas.length ? plazas : [currentPlaza || '']).filter(Boolean).map(plaza => `
            <option value="${escapeHtml(plaza)}" ${plaza === currentPlaza ? 'selected' : ''}>📍 ${escapeHtml(plaza)}</option>
          `).join('')}
        </select>

        <div class="flex items-center gap-2">
          <button class="relative hover:text-secondary hover:bg-slate-100 rounded-full p-2 text-slate-400 transition-all border border-transparent">
            <span class="material-symbols-outlined" data-icon="notifications">notifications</span>
            ${metrics.incidenciasAbiertas > 0 ? '<span class="absolute top-2 right-2 w-2 h-2 bg-error rounded-full."></span>' : ''}
          </button>
        </div>
        <div class="h-8 w-[1px] bg-slate-200"></div>
        <div class="flex items-center gap-3">
          <div class="text-right hidden lg:block">
            <p class="text-xs font-bold text-slate-700 leading-none">${escapeHtml(variantKey.toUpperCase())}</p>
            <p class="text-[10px] text-secondary font-semibold">En línea</p>
          </div>
          <div class="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center border border-secondary/20">
            <span class="material-symbols-outlined text-secondary text-sm" data-icon="shield_person">shield_person</span>
          </div>
        </div>
      </div>
    </header>

    <!-- Main Content Stage -->
    <main class="shell-main-stage w-full lg:ml-[280px] pt-16 h-screen overflow-y-auto pb-12 relative">
      <div class="p-4 md:p-8">
        <!-- Welcome Header -->
        <div class="flex flex-col md:flex-row justify-between md:items-end mb-8 gap-4">
          <div>
            <h2 class="font-h1 text-h1 text-on-primary-fixed mb-1 text-2xl md:text-3xl">Bienvenido de nuevo, ${escapeHtml(userName.split(' ')[0] || userName)}</h2>
            <p class="font-body-base text-on-surface-variant flex items-center gap-2 capitalize text-sm md:text-base">
              <span class="material-symbols-outlined text-sm" data-icon="calendar_today">calendar_today</span>
              ${escapeHtml(dateString)}
            </p>
          </div>
          <div class="flex gap-3">
            <button class="px-4 py-2 bg-white border border-outline-variant rounded-xl text-sm font-semibold text-on-surface flex items-center gap-2 hover:bg-surface-container transition-all" data-route="/profile">
              <span class="material-symbols-outlined text-sm" data-icon="person">person</span>
              Mi Perfil
            </button>
            <button class="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold flex items-center gap-2 hover:bg-slate-800 transition-all shadow-md" onclick="window.location.reload()">
              <span class="material-symbols-outlined text-sm" data-icon="refresh">refresh</span>
              Actualizar
            </button>
          </div>
        </div>

        <!-- Bento Layout Content -->
        <div class="grid grid-cols-12 gap-4 md:gap-6">

          <!-- Hero Section: Immersive Map -->
          <div class="shell-section-card shell-stagger-1 col-span-12 lg:col-span-9 h-[400px] md:h-[540px] relative rounded-3xl overflow-hidden shadow-2xl border border-outline-variant/30 group">
            <div class="absolute inset-0 z-0 bg-slate-900 border border-slate-200" id="homeMapPreview">
              <div class="flex items-center justify-center w-full h-full"><div class="animate-spin w-8 h-8 rounded-full border-t-2 border-l-2 border-emerald-500"></div></div>
            </div>

            <div class="absolute inset-0 z-10 p-6 flex flex-col justify-between pointer-events-none">
              <div class="flex justify-between items-start">
                <div class="bg-[#07111f]/80 backdrop-blur-md border border-white/10 px-4 py-2 rounded-full flex items-center gap-3 pointer-events-auto shadow-lg shadow-black/20">
                  <span class="relative flex h-2 w-2">
                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span class="text-white text-xs font-bold uppercase tracking-widest">Monitoreo en Vivo: ${escapeHtml(currentPlaza || "GLOBAL")}</span>
                </div>
                <!-- Tools -->
                <div class="flex flex-col gap-2 pointer-events-auto">
                  <button class="w-10 h-10 bg-white/10 backdrop-blur-md border border-white/20 rounded-lg flex items-center justify-center text-white hover:bg-white/20 transition-all" data-route="/mapa">
                    <span class="material-symbols-outlined" data-icon="map">map</span>
                  </button>
                </div>
              </div>

              <!-- Simulated Vehicle Markers Overlay panel -->
              <div class="flex justify-center pointer-events-none px-4 md:px-0">
                <div class="bg-white/10 backdrop-blur-xl border border-white/20 px-6 py-3 md:px-8 md:py-4 rounded-t-3xl flex gap-4 md:gap-8 flex-wrap justify-center items-center pointer-events-auto translate-y-4 md:translate-y-6 group-hover:translate-y-0 transition-transform duration-500 shadow-2xl w-full">
                  <div class="text-center">
                    <p class="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Activas</p>
                    <p class="text-2xl font-black text-white">${escapeHtml(String(metrics.unidadesActivas || 0))}</p>
                  </div>
                  <div class="w-[1px] h-8 bg-white/20 hidden md:block"></div>
                  <div class="text-center">
                    <p class="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Externos</p>
                    <p class="text-2xl font-black text-white">${escapeHtml(String(metrics.externosActivos || 0))}</p>
                  </div>
                  <div class="w-[1px] h-8 bg-white/20 hidden md:block"></div>
                  <div class="text-center">
                    <p class="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Alertas</p>
                    <p class="text-2xl font-black ${metrics.incidenciasAbiertas > 0 ? "text-red-400" : "text-white"}">${escapeHtml(String(metrics.incidenciasAbiertas || 0))}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Operational Metrics Sidebar -->
          <div class="shell-stagger-2 col-span-12 lg:col-span-3 flex flex-col gap-6">

            <div class="shell-section-card bg-white p-6 rounded-3xl border border-outline-variant shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div class="relative z-10">
                <div class="flex justify-between items-start mb-4">
                  <div class="w-12 h-12 bg-secondary/10 rounded-xl flex items-center justify-center text-secondary">
                    <span class="material-symbols-outlined" data-icon="navigation">navigation</span>
                  </div>
                </div>
                <h3 class="text-label-caps text-on-surface-variant mb-1">Vehículos Activos</h3>
                <p class="text-h2 text-on-primary-fixed">${escapeHtml(String(metrics.unidadesActivas || 0))}</p>
              </div>
              <div class="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:scale-110 transition-transform duration-500">
                <span class="material-symbols-outlined text-[100px]" data-icon="directions_car">directions_car</span>
              </div>
            </div>

            <div class="shell-section-card shell-stagger-3 bg-white p-6 rounded-3xl border border-outline-variant shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div class="relative z-10">
                <div class="flex justify-between items-start mb-4">
                  <div class="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600">
                    <span class="material-symbols-outlined" data-icon="warning">warning</span>
                  </div>
                  ${metrics.incidenciasAbiertas > 0 ?
                    `<span class="text-error bg-error-container px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1">
                      <span class="material-symbols-outlined text-[12px]" data-icon="report">report</span>
                      Acción
                    </span>` : ''}
                </div>
                <h3 class="text-label-caps text-on-surface-variant mb-1">Incidencias de Hoy</h3>
                <p class="text-h2 text-on-primary-fixed">${escapeHtml(String(metrics.incidenciasAbiertas || 0))}</p>
              </div>
              <div class="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:scale-110 transition-transform duration-500">
                <span class="material-symbols-outlined text-[100px]" data-icon="notifications_active">notifications_active</span>
              </div>
            </div>

            <div class="shell-section-card shell-stagger-4 bg-white p-6 rounded-3xl border border-outline-variant shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div class="relative z-10">
                <div class="flex justify-between items-start mb-4">
                  <div class="w-12 h-12 bg-primary-container rounded-xl flex items-center justify-center text-primary-fixed">
                    <span class="material-symbols-outlined" data-icon="inventory_2">inventory_2</span>
                  </div>
                </div>
                <h3 class="text-label-caps text-on-surface-variant mb-1">Solicitudes (Admin)</h3>
                <p class="text-h2 text-on-primary-fixed">${escapeHtml(String(metrics.solicitudesPendientes || 0))}</p>
              </div>
              <div class="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:scale-110 transition-transform duration-500">
                <span class="material-symbols-outlined text-[100px]" data-icon="local_shipping">local_shipping</span>
              </div>
            </div>

          </div>

          <!-- Secondary Row -->
          <div class="col-span-12 grid grid-cols-1 md:grid-cols-3 gap-6">

            <div class="md:col-span-2 glass-panel rounded-3xl p-8 border border-white flex items-center justify-between shadow-sm overflow-hidden relative">
              <div class="relative z-10 w-full max-w-lg">
                <h3 class="text-h3 text-on-primary-fixed mb-2">Resumen de Operaciones Globales</h3>
                <p class="text-body-base text-on-surface-variant mb-4">Bienvenido a tu nueva Área Operativa. Todo el sistema logístico se centraliza aquí para agilizar las operaciones logísticas y evitar cuellos de botella mediante acceso directo.</p>
                <div class="flex gap-4">
                  <span class="text-xs font-bold text-slate-500 bg-white/50 px-3 py-1 rounded-full border border-slate-200 shadow-sm">📍 ${escapeHtml(currentPlaza || 'Global')}</span>
                  <span class="text-xs font-bold text-slate-500 bg-white/50 px-3 py-1 rounded-full border border-slate-200 shadow-sm">👤 ${escapeHtml(roleLabel(profile))}</span>
                </div>
              </div>
              <div class="hidden md:block relative z-10 shrink-0">
                <button class="bg-[#07111f] text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg" data-route="/cuadre">
                  Ver Cuadre
                  <span class="material-symbols-outlined" data-icon="chevron_right">chevron_right</span>
                </button>
              </div>
              <div class="absolute right-0 top-0 w-64 h-full bg-gradient-to-l from-secondary/10 to-transparent"></div>
            </div>

            <div class="bg-white rounded-3xl p-6 border border-outline-variant shadow-sm h-full flex flex-col">
              <div class="flex justify-between items-center mb-4">
                <h3 class="text-label-caps text-on-surface-variant">Actividad Reciente</h3>
                <span class="material-symbols-outlined text-slate-400 cursor-pointer" data-icon="more_horiz">more_horiz</span>
              </div>

              <div class="space-y-4 flex-1">
                ${metrics.incidenciasAbiertas > 0 ? `
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded bg-error-container flex items-center justify-center shrink-0">
                      <span class="material-symbols-outlined text-xs text-error" data-icon="warning">warning</span>
                    </div>
                    <div class="min-w-0">
                      <p class="text-sm font-bold text-slate-800 truncate">Hay ${metrics.incidenciasAbiertas} alerta(s) abierta(s)</p>
                      <p class="text-[10px] text-slate-500 truncate">Requiere supervisión en ${escapeHtml(currentPlaza)}</p>
                    </div>
                  </div>
                ` : `
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded bg-emerald-100 flex items-center justify-center shrink-0">
                      <span class="material-symbols-outlined text-xs text-emerald-600" data-icon="check_circle">check_circle</span>
                    </div>
                    <div class="min-w-0">
                      <p class="text-sm font-bold text-slate-800 truncate">Operación limpia</p>
                      <p class="text-[10px] text-slate-500 truncate">No hay incidencias críticas registradas hoy.</p>
                    </div>
                  </div>
                `}

                ${metrics.unidadesActivas > 0 ? `
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded bg-amber-100 flex items-center justify-center shrink-0">
                      <span class="material-symbols-outlined text-xs text-amber-600" data-icon="local_shipping">local_shipping</span>
                    </div>
                    <div class="min-w-0">
                      <p class="text-sm font-bold text-slate-800 truncate">Unidades movilizadas</p>
                      <p class="text-[10px] text-slate-500 truncate">Sistema reporta ${metrics.unidadesActivas} vehículos en línea y asignados</p>
                    </div>
                  </div>
                ` : ''}

              </div>
            </div>

          </div>
        </div>
      </div>
    </main>
  `;

  // Launch live mini map
  _renderMiniMapPreview(currentPlaza);

  root.querySelectorAll('[data-route]').forEach(button => {
    button.addEventListener('click', () => {
      setActivePlaza(currentPlaza);
      navigateTo(button.getAttribute('data-route') || '/mapa');
    });
  });

  root.querySelectorAll('[data-action="logout"]').forEach(button => {
    button.addEventListener('click', () => {
      logoutHome();
    });
  });

  document.getElementById('homeSearchInput')?.addEventListener('input', event => {
    // Basic frontend search could be implemented, but leaving existing bindings.
  });

  document.getElementById('homePlazaSelect')?.addEventListener('change', event => {
    const plaza = upper(event.target.value || '');
    setActivePlaza(plaza);
    renderBoot();
  });

  const sidebar = document.getElementById('homeSidebar');
  const mobileOverlay = document.getElementById('mobileOverlay');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');

  function toggleMobileMenu() {
    if (!sidebar || !mobileOverlay) return;
    const isOpen = !sidebar.classList.contains('-translate-x-full');
    if (!isOpen) { // Open
      sidebar.classList.remove('-translate-x-full');
      mobileOverlay.classList.remove('hidden');
      setTimeout(() => mobileOverlay.classList.remove('opacity-0'), 10);
    } else { // Close
      sidebar.classList.add('-translate-x-full');
      mobileOverlay.classList.add('opacity-0');
      setTimeout(() => mobileOverlay.classList.add('hidden'), 300);
    }
  }

  mobileMenuBtn?.addEventListener('click', toggleMobileMenu);
  mobileOverlay?.addEventListener('click', toggleMobileMenu);
}

function renderError(message) {
  const root = document.getElementById('homeApp');
  if (!root) return;
  root.innerHTML = `
    <div class="home-loading-card">
      <div class="home-auth-gap">
        <div class="home-kicker">Home no disponible</div>
        <strong>${escapeHtml(message)}</strong>
        <span>Puedes entrar directo al mapa mientras terminamos de estabilizar este nuevo entry point.</span>
        <button type="button" class="home-btn primary" data-route="/mapa">
          <span class="material-icons">map</span>
          Ir al mapa
        </button>
      </div>
    </div>
  `;
  root.querySelector('[data-route="/mapa"]')?.addEventListener('click', () => {
    navigateTo('/mapa');
  });
}

async function renderBoot() {
  const root = document.getElementById('homeApp');
  if (!root) return;

  root.innerHTML = `
    <div class="home-loading-card">
      <div class="home-loading-orb"></div>
      <strong>Preparando tu panel principal...</strong>
      <span>Sincronizando perfil, plaza y modulos visibles</span>
    </div>
  `;

  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    window.location.replace('/login');
    return;
  }

  try {
    const profile = await resolveProfile(firebaseUser);
    if (!profile) {
      renderNoAccess({ email: firebaseUser.email || '' });
      return;
    }

    const plaza = activePlaza() || upper(profile.plazaAsignada || '');
    if (plaza) setActivePlaza(plaza);
    const configPromise = loadConfig(plaza);
    const cachedMetrics = readCachedMetrics(profile, plaza);
    const config = await configPromise;

    if (cachedMetrics) {
      renderHome(profile, config, cachedMetrics);
      loadMetrics(profile, plaza)
        .then(freshMetrics => {
          if (JSON.stringify(freshMetrics) !== JSON.stringify(cachedMetrics)) {
            renderHome(profile, config, freshMetrics);
          }
        })
        .catch(error => {
          console.warn('[home] metrics refresh:', error);
        });
      return;
    }

    const metrics = await loadMetrics(profile, plaza);
    renderHome(profile, config, metrics);
  } catch (error) {
    console.error('[home] Error cargando el home:', error);
    renderError(error?.message || 'No se pudo cargar el home.');
  }
}

auth.onAuthStateChanged(user => {
  if (!user) {
    window.location.replace('/login');
    return;
  }
  renderBoot();
});

// ============================================
// Mini-Map Preview Renderer (Hero Section)
// ============================================
async function _renderMiniMapPreview(plaza) {
  const container = document.getElementById('homeMapPreview');
  if (!container) return;
  try {
    const estructura = await window._mexParts?.mapa?.obtenerEstructuraMapa(plaza) || [];
    const { unidades } = await window._mexParts?.mapa?.obtenerDatosParaMapa(plaza) || { unidades: [] };

    const normEstructura = estructura.map((item, i) => normalizarElemento(item, i));
    const normUnidades = unidades.map(u => normalizarUnidad(u)).filter(u => u.mva);
    const vm = buildMapaViewModel(normEstructura, normUnidades, {}, {});

    let minX = 0, minY = 0, maxX = 800, maxY = 600;
    if (vm.cajones && vm.cajones.length > 0) {
       minX = Math.min(...vm.cajones.map(c => c.x));
       minY = Math.min(...vm.cajones.map(c => c.y));
       maxX = Math.max(...vm.cajones.map(c => c.x + c.width));
       maxY = Math.max(...vm.cajones.map(c => c.y + c.height));
    }
    const rect = container.getBoundingClientRect();
    const targetW = rect.width || 800;
    const targetH = rect.height || 400;
    const mapW = maxX - minX + 100;
    const mapH = maxY - minY + 100;
    const scaleX = targetW / mapW;
    const scaleY = targetH / mapH;
    let scale = Math.min(scaleX, scaleY) * 0.85;
    if (scale > 1.2) scale = 1.2;
    if (scale < 0.1) scale = 0.1;

    const colors = {
      'LISTO': '#10b981', 'SUCIO': '#f59e0b', 'MANTENIMIENTO': '#ef4444',
      'RESGUARDO': '#92400e', 'TRASLADO': '#7c3aed', 'EN RENTA': '#38bdf8',
      'RETENIDA': '#1d4ed8', 'VENTA': '#f59e0b', 'HYP': '#ef4444'
    };

    let html = `<div style="position:absolute; left:50%; top:50%; transform: translate(-50%, -50%) scale(${scale}); width:${mapW}px; height:${mapH}px; pointer-events:none; transition: transform 0.4s cubic-bezier(0.16,1,0.3,1); opacity:0.9;">`;

    for (const c of vm.cajones) {
      if(c.tipo === 'pilar') continue;
      const spotStyle = c.esLabel
        ? `background:transparent; border:none; color:rgba(255,255,255,0.4); font-size:32px; font-weight:bold;`
        : `background:rgba(255,255,255,0.02); border-left:2px solid rgba(255,255,255,0.1); border-right:2px solid rgba(255,255,255,0.1); border-top:2px solid rgba(255,255,255,0.1); border-bottom:none; border-radius:6px 6px 0 0;`;
      const text = c.esLabel ? c.pos : '';
      html += `<div style="position:absolute; left:${c.x - minX + 50}px; top:${c.y - minY + 50}px; width:${c.width}px; height:${c.height}px; transform:rotate(${c.rotation}deg); ${spotStyle} display:flex; align-items:center; justify-content:center; box-sizing:border-box;">${text}</div>`;
    }

    for (const [mva, u] of vm.unitMap.entries()) {
      if (u.pos === 'LIMBO') continue;
      const c = vm.cajones.find(c => c.pos === u.pos);
      if (!c) continue;
      const bg = colors[u.estado] || '#64748b';
      const carStyle = `border-radius:16px 16px 10px 10px; background:linear-gradient(160deg, ${bg} 0%, #000 120%); box-shadow:0 8px 15px -4px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.25); border:1px solid rgba(0,0,0,0.15); color:white; font-size:16px; font-weight:900; text-shadow:0 1px 3px rgba(0,0,0,0.4);`;
      html += `<div style="position:absolute; left:${c.x - minX + 50}px; top:${c.y - minY + 50}px; width:${c.width}px; height:${c.height}px; transform:rotate(${c.rotation}deg); ${carStyle} display:flex; align-items:center; justify-content:center; box-sizing:border-box;">${mva}</div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
  } catch (e) {
    console.error("[Live Preview error]", e);
    container.innerHTML = `<div class="flex flex-col items-center justify-center w-full h-full text-slate-500 font-bold gap-3"><span class="material-symbols-outlined text-4xl">map_off</span><span>Vista en vivo no disponible (${plaza})</span></div>`;
  }
}
