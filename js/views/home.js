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

const HOME_VARIANTS = {
  operacion: {
    kicker: 'Operacion diaria',
    title: 'Tu mapa sigue siendo el centro de trabajo',
    description: 'Entradas rapidas para ubicar unidades, moverlas, revisar mensajes y cerrar la operacion sin rodeos.',
    modules: [
      {
        title: 'Mapa operativo',
        description: 'Ubicar, mover y validar unidades desde la plaza activa.',
        route: '/mapa',
        icon: 'map',
        tone: 'linear-gradient(135deg, #0f172a, #1d4ed8)',
        primary: true
      },
      {
        title: 'Mensajes',
        description: 'Abrir conversaciones, revisar evidencias y mantener coordinacion interna.',
        route: '/mensajes',
        icon: 'mail',
        tone: 'linear-gradient(135deg, #0ea5e9, #2563eb)'
      },
      {
        title: 'Cuadre',
        description: 'Ir al cierre, prediccion y control del turno desde la misma plaza.',
        route: '/cuadre',
        icon: 'fact_check',
        tone: 'linear-gradient(135deg, #16a34a, #059669)'
      },
      {
        title: 'Cola de preparacion',
        description: 'Priorizar salidas, checklist y seguimiento rapido de unidades listas.',
        route: '/cola-preparacion',
        icon: 'format_list_bulleted',
        tone: 'linear-gradient(135deg, #7c3aed, #4f46e5)'
      }
    ]
  },
  admin: {
    kicker: 'Administracion y control',
    title: 'Centro de configuracion y supervision',
    description: 'Empieza por los modulos administrativos sin perder el acceso operativo cuando necesites bajar al patio.',
    modules: [
      {
        title: 'Panel admin',
        description: 'Usuarios, roles, plazas, ubicaciones y catalogos del negocio.',
        route: '/gestion?tab=usuarios',
        icon: 'admin_panel_settings',
        tone: 'linear-gradient(135deg, #0f172a, #1d4ed8)',
        primary: true
      },
      {
        title: 'Mapa operativo',
        description: 'Entrar al patio con la misma plaza foco y revisar acomodo real.',
        route: '/mapa',
        icon: 'map',
        tone: 'linear-gradient(135deg, #0ea5e9, #2563eb)'
      },
      {
        title: 'Cuadre',
        description: 'Revisar cierre, predicciones y flujo de operacion.',
        route: '/cuadre',
        icon: 'fact_check',
        tone: 'linear-gradient(135deg, #16a34a, #059669)'
      },
      {
        title: 'Mensajes',
        description: 'Atender coordinacion interna y seguimiento de equipos.',
        route: '/mensajes',
        icon: 'mail',
        tone: 'linear-gradient(135deg, #7c3aed, #4f46e5)'
      }
    ]
  },
  corporativo: {
    kicker: 'Vision global',
    title: 'Resumen ejecutivo por plaza y modulo',
    description: 'Un home ligero para decidir rapido a que parte del sistema entrar, con contexto global y accesos directos.',
    modules: [
      {
        title: 'Cuadre y reportes',
        description: 'Consultar cierres, prediccion diaria y seguimiento por plaza.',
        route: '/cuadre',
        icon: 'analytics',
        tone: 'linear-gradient(135deg, #0f172a, #1d4ed8)',
        primary: true
      },
      {
        title: 'Mapa de referencia',
        description: 'Abrir el mapa solo cuando necesites detalle operativo puntual.',
        route: '/mapa',
        icon: 'map',
        tone: 'linear-gradient(135deg, #0ea5e9, #2563eb)'
      },
      {
        title: 'Panel admin',
        description: 'Entrar a configuracion, plazas y estructura del sistema.',
        route: '/gestion?tab=usuarios',
        icon: 'admin_panel_settings',
        tone: 'linear-gradient(135deg, #16a34a, #059669)'
      },
      {
        title: 'Mensajes',
        description: 'Abrir comunicaciones y avisos internos recientes.',
        route: '/mensajes',
        icon: 'mail',
        tone: 'linear-gradient(135deg, #7c3aed, #4f46e5)'
      }
    ]
  },
  programador: {
    kicker: 'Plataforma y observabilidad',
    title: 'Arranque tecnico con acceso al producto real',
    description: 'Consola, admin y mapa listos desde un home por rol para entrar a la capa correcta sin pasar primero por el patio.',
    modules: [
      {
        title: 'Consola tecnica',
        description: 'Salud del sistema, errores, clientes, cache y herramientas seguras.',
        route: '/programador',
        icon: 'terminal',
        tone: 'linear-gradient(135deg, #0f172a, #1d4ed8)',
        primary: true
      },
      {
        title: 'Panel admin',
        description: 'Gestionar catalogos, usuarios y configuracion administrativa.',
        route: '/gestion?tab=usuarios',
        icon: 'admin_panel_settings',
        tone: 'linear-gradient(135deg, #0ea5e9, #2563eb)'
      },
      {
        title: 'Mapa operativo',
        description: 'Entrar al flujo real de patio con la plaza foco activa.',
        route: '/mapa',
        icon: 'map',
        tone: 'linear-gradient(135deg, #16a34a, #059669)'
      },
      {
        title: 'Mensajes',
        description: 'Depurar UX del chat y revisar actividad del cliente.',
        route: '/mensajes',
        icon: 'mail',
        tone: 'linear-gradient(135deg, #7c3aed, #4f46e5)'
      }
    ]
  }
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
  if (esAdmin(role)) return 'admin';
  return 'operacion';
}

function availablePlazas(profile = {}, config = {}) {
  const company = config?.empresa || {};
  const fromConfig = Array.isArray(company.plazas) ? company.plazas.map(upper).filter(Boolean) : [];
  const fromDetail = Array.isArray(company.plazasDetalle) ? company.plazasDetalle.map(item => upper(item?.id)).filter(Boolean) : [];
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
    plazasPermitidas: Array.isArray(data.plazasPermitidas) ? data.plazasPermitidas.map(upper).filter(Boolean) : []
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
    (esAdmin(role) || esGlobal(role))
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

function moduleMeta(module = {}, metrics = {}) {
  if (module.route === '/mapa') {
    return `${metrics.focus || 'Sin plaza'} · ${metrics.unidadesActivas || 0} unidades`;
  }
  if (module.route === '/mensajes') {
    return 'Comunicacion interna';
  }
  if (module.route.startsWith('/gestion')) {
    return `${metrics.solicitudesPendientes || 0} solicitudes pendientes`;
  }
  if (module.route === '/programador') {
    return `${metrics.incidenciasAbiertas || 0} incidencias abiertas`;
  }
  if (module.route === '/cuadre') {
    return `${metrics.externosActivos || 0} externos en foco`;
  }
  return 'Acceso rapido';
}

function pendingItems(variantKey, metrics = {}) {
  const items = [];
  if (metrics.focus) {
    items.push({
      icon: 'place',
      text: `Plaza foco actual: ${metrics.focus}`
    });
  }
  if (metrics.unidadesActivas > 0) {
    items.push({
      icon: 'directions_car',
      text: `${metrics.unidadesActivas} unidades visibles en operacion`
    });
  }
  if (metrics.externosActivos > 0) {
    items.push({
      icon: 'swap_horiz',
      text: `${metrics.externosActivos} unidades externas registradas`
    });
  }
  if (metrics.incidenciasAbiertas > 0) {
    items.push({
      icon: 'priority_high',
      text: `${metrics.incidenciasAbiertas} incidencias abiertas en la plaza foco`
    });
  }
  if (metrics.solicitudesPendientes > 0 && variantKey !== 'operacion') {
    items.push({
      icon: 'mail_lock',
      text: `${metrics.solicitudesPendientes} solicitudes pendientes de revision`
    });
  }
  return items;
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
    await auth.signOut().catch(() => {});
    window.location.replace('/login');
  });
}

function renderHome(profile, config, metrics) {
  const root = document.getElementById('homeApp');
  if (!root) return;
  const variantKey = homeVariant(profile);
  const variant = HOME_VARIANTS[variantKey];
  const plazas = availablePlazas(profile, config);
  const currentPlaza = upper(metrics.focus || activePlaza() || plazas[0] || profile.plazaAsignada || '');
  const pending = pendingItems(variantKey, { ...metrics, focus: currentPlaza });
  const companyName = safe(config?.empresa?.nombre || document.documentElement?.dataset?.companyName || 'MAPA');
  const operatorName = safe(profile.nombre || profile.email || 'Usuario');
  const totalVisiblePlazas = plazas.length || (currentPlaza ? 1 : 0);

  root.innerHTML = `
    <div class="home-page-grid">
      <section class="home-hero">
        <div class="home-hero-copy">
          <span class="home-kicker">${escapeHtml(variant.kicker)}</span>
          <h1>${escapeHtml(operatorName)}</h1>
          <p>${escapeHtml(variant.title)} ${escapeHtml(variant.description)}</p>
          <div class="home-hero-pills">
            <span class="home-pill"><span class="material-icons" style="font-size:14px;">verified_user</span>${escapeHtml(roleLabel(profile))}</span>
            <span class="home-pill"><span class="material-icons" style="font-size:14px;">corporate_fare</span>${escapeHtml(companyName)}</span>
            <span class="home-pill"><span class="material-icons" style="font-size:14px;">location_city</span>${escapeHtml(currentPlaza || 'SIN PLAZA')}</span>
          </div>
        </div>
        <div class="home-hero-side">
          <div class="home-stat-card">
            <span>Unidades activas</span>
            <strong>${escapeHtml(String(metrics.unidadesActivas || 0))}</strong>
            <small>Lectura ligera para la plaza foco actual.</small>
          </div>
          <div class="home-stat-card">
            <span>Incidencias abiertas</span>
            <strong>${escapeHtml(String(metrics.incidenciasAbiertas || 0))}</strong>
            <small>${metrics.incidenciasAbiertas > 0 ? 'Conviene revisar alertas antes de entrar al flujo.' : 'Sin alertas abiertas en la plaza foco.'}</small>
          </div>
        </div>
      </section>

      <div class="home-main-grid">
        <section class="home-panel">
          <div class="home-panel-head">
            <div>
              <h2>Modulos principales</h2>
              <p>Accesos pensados por rol para entrar a la capa correcta del producto sin pasar siempre por el mapa.</p>
            </div>
            <span class="home-panel-badge">${escapeHtml(variantKey)}</span>
          </div>
          <div class="home-module-grid">
            ${variant.modules.map(module => `
              <article class="home-module-card">
                <div class="home-module-head">
                  <div class="home-module-icon" style="background:${module.tone};">
                    <span class="material-icons">${module.icon}</span>
                  </div>
                  ${module.primary ? '<span class="home-panel-badge">Principal</span>' : ''}
                </div>
                <div class="home-module-copy">
                  <strong>${escapeHtml(module.title)}</strong>
                  <p>${escapeHtml(module.description)}</p>
                </div>
                <div class="home-module-footer">
                  <span class="home-module-meta">${escapeHtml(moduleMeta(module, { ...metrics, focus: currentPlaza }))}</span>
                  <button type="button" class="home-btn ${module.primary ? 'primary' : ''}" data-route="${escapeHtml(module.route)}">
                    <span class="material-icons">${module.icon}</span>
                    Abrir
                  </button>
                </div>
              </article>
            `).join('')}
          </div>
        </section>

        <aside class="home-panel">
          <div class="home-panel-head">
            <div>
              <h3>Contexto actual</h3>
              <p>Plaza foco, alcance visible y pendientes ligeros del turno.</p>
            </div>
            <span class="home-panel-badge">Sesion</span>
          </div>
          <div class="home-side-stack">
            <div class="home-context-grid">
              <div class="home-context-item">
                <span>Usuario</span>
                <strong>${escapeHtml(operatorName)}</strong>
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
                <strong>${escapeHtml(String(totalVisiblePlazas || 1))}</strong>
              </div>
            </div>

            <div>
              <div class="home-panel-head" style="padding:0 0 8px;">
                <div>
                  <h3 style="font-size:16px;">Plaza foco</h3>
                  <p>Se comparte con mapa, admin y rutas internas.</p>
                </div>
              </div>
              <select id="homePlazaSelect" class="home-plaza-select" ${plazas.length <= 1 ? 'disabled' : ''}>
                ${(plazas.length ? plazas : [currentPlaza || '']).filter(Boolean).map(plaza => `
                  <option value="${escapeHtml(plaza)}" ${plaza === currentPlaza ? 'selected' : ''}>${escapeHtml(plaza)}</option>
                `).join('')}
              </select>
            </div>

            <div>
              <div class="home-panel-head" style="padding:0 0 8px;">
                <div>
                  <h3 style="font-size:16px;">Pendientes y foco</h3>
                  <p>Resumen corto para decidir el siguiente clic.</p>
                </div>
              </div>
              ${pending.length ? `
                <div class="home-mini-list">
                  ${pending.map(item => `
                    <div class="home-mini-item">
                      <span class="material-icons">${item.icon}</span>
                      <span>${escapeHtml(item.text)}</span>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div class="home-empty">
                  La plaza foco está sin pendientes críticos por ahora. Puedes entrar directo al módulo principal de tu rol.
                </div>
              `}
            </div>

            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button type="button" class="home-btn primary" data-route="${escapeHtml(variant.modules[0].route)}">
                <span class="material-icons">${variant.modules[0].icon}</span>
                Abrir modulo principal
              </button>
              <button type="button" class="home-btn" id="homeProfileBtn">
                <span class="material-icons">person</span>
                Mi perfil
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;

  root.querySelectorAll('[data-route]').forEach(button => {
    button.addEventListener('click', () => {
      const route = button.getAttribute('data-route') || '/mapa';
      window.location.href = route;
    });
  });

  document.getElementById('homeProfileBtn')?.addEventListener('click', () => {
    window.location.href = '/profile';
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
    window.location.href = '/mapa';
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
