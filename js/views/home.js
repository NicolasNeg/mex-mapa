import { auth, db, COL } from '/js/core/database.js';
import { esAdmin, esGlobal } from '/domain/permissions.model.js';

const ROLE_LABELS = {
  AUXILIAR: 'AUXILIAR',
  VENTAS: 'VENTAS',
  SUPERVISOR: 'SUPERVISOR',
  JEFE_PATIO: 'JEFE DE PATIO',
  GERENTE_PLAZA: 'GERENTE DE PLAZA',
  JEFE_REGIONAL: 'JEFE REGIONAL',
  CORPORATIVO_USER: 'CORPORATIVO',
  PROGRAMADOR: 'PROGRAMADOR',
  JEFE_OPERACION: 'JEFE DE OPERACION'
};

const HOME_SIDEBAR_COLLAPSED_KEY = 'mex.home.sidebar.collapsed.v1';

const HOME_VARIANTS = {
  operacion: {
    kicker: 'Operacion diaria',
    title: 'Tu centro rapido de patio y movimiento',
    description: 'Entra al modulo correcto sin pasar siempre por el mismo flujo. El mapa sigue siendo clave, pero ahora el sistema arranca con contexto.',
    ctaTitle: 'Ir al mapa operativo',
    modules: [
      {
        id: 'mapa',
        title: 'Mapa operativo',
        description: 'Ubicar, mover y validar unidades desde la plaza activa.',
        route: '/mapa',
        icon: 'map',
        badge: 'Principal',
        tone: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)'
      },
      {
        id: 'mensajes',
        title: 'Mensajes',
        description: 'Coordinacion interna, evidencias y seguimiento del equipo.',
        route: '/mensajes',
        icon: 'mail',
        tone: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)'
      },
      {
        id: 'cuadre',
        title: 'Cuadre',
        description: 'Ir al cierre, control y prediccion diaria de la plaza foco.',
        route: '/cuadre',
        icon: 'fact_check',
        tone: 'linear-gradient(135deg, #059669 0%, #16a34a 100%)'
      },
      {
        id: 'cola',
        title: 'Cola de preparacion',
        description: 'Checklist, prioridad de salida y avance de unidades listas.',
        route: '/cola-preparacion',
        icon: 'format_list_bulleted',
        tone: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%)'
      }
    ]
  },
  admin: {
    kicker: 'Centro administrativo',
    title: 'Configuracion, supervision y acceso al flujo real',
    description: 'Arranque por rol con accesos agrupados y una shell consistente para entrar al modulo correcto sin perder la plaza activa.',
    ctaTitle: 'Abrir panel admin',
    modules: [
      {
        id: 'admin',
        title: 'Panel admin',
        description: 'Usuarios, roles, plazas, ubicaciones y catalogos del negocio.',
        route: '/gestion?tab=usuarios',
        icon: 'admin_panel_settings',
        badge: 'Principal',
        requires: 'admin',
        tone: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)'
      },
      {
        id: 'mapa',
        title: 'Mapa operativo',
        description: 'Revisar acomodo real y bajar al patio solo cuando lo necesites.',
        route: '/mapa',
        icon: 'map',
        tone: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)'
      },
      {
        id: 'cuadre',
        title: 'Cuadres y reportes',
        description: 'Seguimiento diario de cierres, prediccion y validacion operativa.',
        route: '/cuadre',
        icon: 'analytics',
        tone: 'linear-gradient(135deg, #059669 0%, #16a34a 100%)'
      },
      {
        id: 'mensajes',
        title: 'Mensajes',
        description: 'Atender coordinacion interna, solicitudes y seguimiento.',
        route: '/mensajes',
        icon: 'chat',
        tone: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%)'
      }
    ]
  },
  corporativo: {
    kicker: 'Vision global',
    title: 'Dashboard de acceso ejecutivo por plaza y area',
    description: 'Un arranque mas limpio para direccion y corporativo, con foco en decisiones, contexto y entrada selectiva al detalle operativo.',
    ctaTitle: 'Abrir cuadres y reportes',
    modules: [
      {
        id: 'cuadre',
        title: 'Cuadres y reportes',
        description: 'Consultar cierres, presion operativa y seguimiento por plaza.',
        route: '/cuadre',
        icon: 'analytics',
        badge: 'Principal',
        tone: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)'
      },
      {
        id: 'admin',
        title: 'Panel admin',
        description: 'Entrar a configuracion, plazas y estructura del sistema.',
        route: '/gestion?tab=usuarios',
        icon: 'admin_panel_settings',
        requires: 'admin',
        tone: 'linear-gradient(135deg, #059669 0%, #16a34a 100%)'
      },
      {
        id: 'mapa',
        title: 'Mapa de referencia',
        description: 'Ir al detalle operativo solo cuando necesites contexto real del patio.',
        route: '/mapa',
        icon: 'map',
        tone: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)'
      },
      {
        id: 'mensajes',
        title: 'Mensajes',
        description: 'Abrir comunicaciones y avisos internos recientes.',
        route: '/mensajes',
        icon: 'mail',
        tone: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%)'
      }
    ]
  },
  programador: {
    kicker: 'Plataforma y observabilidad',
    title: 'Shell tecnica con acceso directo a producto real',
    description: 'Consola, panel admin, mapa y mensajeria agrupados en una misma entrada para dejar atras el mapa como home universal.',
    ctaTitle: 'Abrir consola tecnica',
    modules: [
      {
        id: 'programador',
        title: 'Consola tecnica',
        description: 'Salud del sistema, clientes, cache, errores y herramientas seguras.',
        route: '/programador',
        icon: 'terminal',
        badge: 'Principal',
        requires: 'programmer',
        tone: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)'
      },
      {
        id: 'admin',
        title: 'Panel admin',
        description: 'Configuracion administrativa y control de catalogos del sistema.',
        route: '/gestion?tab=usuarios',
        icon: 'admin_panel_settings',
        requires: 'admin',
        tone: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)'
      },
      {
        id: 'mapa',
        title: 'Mapa operativo',
        description: 'Entrar al flujo real del patio con plaza foco compartida.',
        route: '/mapa',
        icon: 'map',
        tone: 'linear-gradient(135deg, #059669 0%, #16a34a 100%)'
      },
      {
        id: 'mensajes',
        title: 'Mensajes',
        description: 'Depurar experiencia del chat y revisar actividad del cliente.',
        route: '/mensajes',
        icon: 'mail',
        tone: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%)'
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

  return {
    focus,
    unidadesActivas: cuadreCount,
    externosActivos: externosCount,
    incidenciasAbiertas,
    solicitudesPendientes
  };
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
  return 'Acceso rapido';
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

function sidebarGroups(profile = {}, metrics = {}, currentPlaza = '') {
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
      label: 'Operacion',
      items: [
        {
          label: 'Mapa',
          description: `${currentPlaza || 'Sin plaza'} · ${metrics.unidadesActivas || 0} unidades`,
          route: '/mapa',
          icon: 'map'
        },
        {
          label: 'Mensajes',
          description: 'Coordinacion y chat',
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
  const modules = filterModules(availableModules(profile), _homeState.query);
  const navGroups = sidebarGroups(profile, metrics, currentPlaza);
  const pending = pendingItems(variantKey, { ...metrics, focus: currentPlaza });
  const userName = safe(profile.nombre || profile.email || 'Usuario');
  const company = companyName(config);
  const primaryModule = modules[0] || availableModules(profile)[0] || { route: '/mapa', icon: 'map', title: 'Mapa operativo' };
  const visiblePlazas = plazas.length || (currentPlaza ? 1 : 0);

  root.innerHTML = `
    <div class="home-workspace ${_homeState.collapsed ? 'is-collapsed' : ''}">
      <aside class="home-sidebar">
        <div class="home-sidebar-head">
          <div class="home-brand-lockup">
            <div class="home-brand-icon">M</div>
            <div class="home-brand-copy">
              <strong>${escapeHtml(company)}</strong>
              <span>Centro de trabajo</span>
            </div>
          </div>
          <button type="button" id="homeSidebarToggle" class="home-sidebar-toggle" title="${_homeState.collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}">
            <span class="material-icons">${_homeState.collapsed ? 'menu' : 'menu_open'}</span>
          </button>
        </div>

        <div class="home-sidebar-profile">
          <div class="home-sidebar-avatar">${escapeHtml((userName[0] || 'U').toUpperCase())}</div>
          <div class="home-sidebar-profile-copy">
            <strong>${escapeHtml(userName)}</strong>
            <span>${escapeHtml(roleLabel(profile))}</span>
            <small>${escapeHtml(visiblePlazaLabel(profile, plazas, currentPlaza))}</small>
          </div>
        </div>

        <div class="home-sidebar-groups">
          ${navGroups.map(group => `
            <section class="home-nav-group">
              <p class="home-nav-group-label">${escapeHtml(group.label)}</p>
              <div class="home-nav-list">
                ${group.items.map(item => `
                  <button
                    type="button"
                    class="home-nav-item ${item.active ? 'is-active' : ''}"
                    ${item.route ? `data-route="${escapeHtml(item.route)}"` : ''}
                    ${item.action ? `data-action="${escapeHtml(item.action)}"` : ''}
                    title="${escapeHtml(item.label)}">
                    <span class="material-icons">${escapeHtml(item.icon)}</span>
                    <span class="home-nav-copy">
                      <strong>${escapeHtml(item.label)}</strong>
                      <small>${escapeHtml(item.description || '')}</small>
                    </span>
                  </button>
                `).join('')}
              </div>
            </section>
          `).join('')}
        </div>
      </aside>

      <section class="home-stage">
        <header class="home-stage-topbar">
          <div class="home-stage-copy">
            <div class="home-stage-kicker">Inicio / ${escapeHtml(variant.kicker)}</div>
            <h1>${escapeHtml(variant.title)}</h1>
            <p>${escapeHtml(variant.description)}</p>
          </div>

          <div class="home-stage-actions">
            <label class="home-search">
              <span class="material-icons">search</span>
              <input id="homeSearchInput" type="text" value="${escapeHtml(_homeState.query)}" placeholder="Buscar módulo, ruta o acción...">
            </label>

            <select id="homePlazaSelect" class="home-plaza-select" ${plazas.length <= 1 ? 'disabled' : ''}>
              ${(plazas.length ? plazas : [currentPlaza || '']).filter(Boolean).map(plaza => `
                <option value="${escapeHtml(plaza)}" ${plaza === currentPlaza ? 'selected' : ''}>${escapeHtml(plaza)}</option>
              `).join('')}
            </select>

            <button type="button" class="home-btn primary" data-route="${escapeHtml(primaryModule.route)}">
              <span class="material-icons">${escapeHtml(primaryModule.icon)}</span>
              ${escapeHtml(variant.ctaTitle)}
            </button>
          </div>
        </header>

        <div class="home-stage-scroll">
          <section class="home-hero-panel">
            <div class="home-hero-copy">
              <span class="home-kicker">${escapeHtml(variant.kicker)}</span>
              <h2>${escapeHtml(userName)}</h2>
              <p>${escapeHtml(roleLabel(profile))} · ${escapeHtml(company)} · ${escapeHtml(currentPlaza || 'SIN PLAZA')}</p>
              <div class="home-hero-pills">
                <span class="home-pill"><span class="material-icons">verified_user</span>${escapeHtml(roleLabel(profile))}</span>
                <span class="home-pill"><span class="material-icons">location_city</span>${escapeHtml(currentPlaza || 'SIN PLAZA')}</span>
                <span class="home-pill"><span class="material-icons">layers</span>${escapeHtml(String(visiblePlazas || 1))} plazas visibles</span>
              </div>
            </div>

            <div class="home-hero-metrics">
              <article class="home-metric-card">
                <span>Unidades activas</span>
                <strong>${escapeHtml(String(metrics.unidadesActivas || 0))}</strong>
                <small>Lectura ligera para la plaza foco actual.</small>
              </article>
              <article class="home-metric-card">
                <span>Externos activos</span>
                <strong>${escapeHtml(String(metrics.externosActivos || 0))}</strong>
                <small>Seguimiento visible para la operacion del dia.</small>
              </article>
              <article class="home-metric-card">
                <span>Incidencias abiertas</span>
                <strong>${escapeHtml(String(metrics.incidenciasAbiertas || 0))}</strong>
                <small>${metrics.incidenciasAbiertas > 0 ? 'Conviene revisar alertas antes de bajar al patio.' : 'Sin alertas abiertas en la plaza foco.'}</small>
              </article>
              <article class="home-metric-card">
                <span>Solicitudes</span>
                <strong>${escapeHtml(String(metrics.solicitudesPendientes || 0))}</strong>
                <small>${canAccessAdminPanel(profile) ? 'Solicitudes pendientes por revisar.' : 'Visible solo para roles administrativos.'}</small>
              </article>
            </div>
          </section>

          <div class="home-body-grid">
            <section class="home-surface">
              <div class="home-surface-head">
                <div>
                  <h3>Espacios de trabajo</h3>
                  <p>La nueva entrada organiza módulos por intención, no por costumbre. Aquí decides a qué capa entrar primero.</p>
                </div>
                <span class="home-surface-badge">${escapeHtml(variantKey)}</span>
              </div>

              ${modules.length ? `
                <div class="home-module-grid">
                  ${modules.map(module => `
                    <article class="home-module-card">
                      <div class="home-module-head">
                        <div class="home-module-icon" style="background:${module.tone};">
                          <span class="material-icons">${escapeHtml(module.icon)}</span>
                        </div>
                        ${module.badge ? `<span class="home-module-badge">${escapeHtml(module.badge)}</span>` : ''}
                      </div>
                      <div class="home-module-copy">
                        <strong>${escapeHtml(module.title)}</strong>
                        <p>${escapeHtml(module.description)}</p>
                      </div>
                      <div class="home-module-footer">
                        <span class="home-module-meta">${escapeHtml(moduleMeta(module, { ...metrics, focus: currentPlaza }))}</span>
                        <button type="button" class="home-btn ${module.badge ? 'primary' : ''}" data-route="${escapeHtml(module.route)}">
                          <span class="material-icons">${escapeHtml(module.icon)}</span>
                          Abrir
                        </button>
                      </div>
                    </article>
                  `).join('')}
                </div>
              ` : `
                <div class="home-empty-state">
                  No encontramos módulos que coincidan con "${escapeHtml(_homeState.query)}". Ajusta el buscador o limpia el filtro.
                </div>
              `}
            </section>

            <aside class="home-surface">
              <div class="home-surface-head">
                <div>
                  <h3>Contexto compartido</h3>
                  <p>Plaza activa, foco del turno y accesos rápidos de cuenta.</p>
                </div>
                <span class="home-surface-badge">Sesion</span>
              </div>

              <div class="home-context-grid">
                <div class="home-context-item">
                  <span>Usuario</span>
                  <strong>${escapeHtml(userName)}</strong>
                </div>
                <div class="home-context-item">
                  <span>Rol</span>
                  <strong>${escapeHtml(roleLabel(profile))}</strong>
                </div>
                <div class="home-context-item">
                  <span>Plaza base</span>
                  <strong>${escapeHtml(upper(profile.plazaAsignada) || 'SIN PLAZA')}</strong>
                </div>
                <div class="home-context-item">
                  <span>Plazas visibles</span>
                  <strong>${escapeHtml(String(visiblePlazas || 1))}</strong>
                </div>
              </div>

              <div class="home-inline-actions">
                <button type="button" class="home-btn" data-route="/profile">
                  <span class="material-icons">person</span>
                  Mi perfil
                </button>
                <button type="button" class="home-btn" data-action="logout">
                  <span class="material-icons">logout</span>
                  Cerrar sesion
                </button>
              </div>

              <div class="home-focus-block">
                <h4>Foco actual</h4>
                ${pending.length ? `
                  <div class="home-mini-list">
                    ${pending.map(item => `
                      <div class="home-mini-item">
                        <span class="material-icons">${escapeHtml(item.icon)}</span>
                        <span>${escapeHtml(item.text)}</span>
                      </div>
                    `).join('')}
                  </div>
                ` : `
                  <div class="home-empty-state">
                    No detectamos pendientes criticos por ahora. Puedes abrir tu módulo principal y seguir desde ahí.
                  </div>
                `}
              </div>
            </aside>
          </div>
        </div>
      </section>
    </div>
  `;

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

  document.getElementById('homeSidebarToggle')?.addEventListener('click', () => {
    saveSidebarState(!_homeState.collapsed);
    renderHome(_homeState.profile, _homeState.config, _homeState.metrics);
  });

  document.getElementById('homeSearchInput')?.addEventListener('input', event => {
    const nextQuery = safe(event.target.value);
    _homeState.query = nextQuery;
    renderHome(_homeState.profile, _homeState.config, _homeState.metrics);
    const nextInput = document.getElementById('homeSearchInput');
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(nextQuery.length, nextQuery.length);
    }
  });

  document.getElementById('homePlazaSelect')?.addEventListener('change', event => {
    const plaza = upper(event.target.value || '');
    setActivePlaza(plaza);
    renderBoot();
  });
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
    const config = await loadConfig(plaza);
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
