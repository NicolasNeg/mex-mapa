// ═══════════════════════════════════════════════════════════
//  /js/app/views/dashboard.js
//  Vista /app/dashboard — UI portada desde legacy /home (FASE 13B).
//  Misma estructura visual que js/views/home.js renderHome (solo contenido).
//  Rutas App Shell: data-app-route / href /app/* donde corresponda.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';
import { db, COL, obtenerDatosParaMapa, obtenerEstructuraMapa } from '/js/core/database.js';
import { buildMapaViewModel } from '/mapa/mapa-view-model.js';
import { normalizarUnidad } from '/domain/unidad.model.js';
import { normalizarElemento } from '/domain/mapa.model.js';
import { iniciarTurno, cerrarTurno } from '/js/app/features/turnos/turnos-data.js';

let _cleanup = null;
let _container = null;
let _state = null;
let _offSearch = null;
let _offPlaza = null;
let _cssRef = null;
let _mapPreviewRequestId = 0;
let _unsubCuadre = null;
let _unsubCola = null;
let _unsubTurno = null;

export async function mount({ container }) {
  unmount();
  _container = container;
  _ensureCss();
  const gs = getState();
  const role = String(gs.role || 'AUXILIAR').toUpperCase();
  const plaza = String(getCurrentPlaza() || gs.profile?.plazaAsignada || '').toUpperCase().trim();
  _state = {
    role,
    profile: gs.profile || {},
    company: gs.company || 'MAPA',
    plaza,
    query: '',
    metrics: { unidades: 0, externos: 0, incidencias: 0, solicitudes: 0 },
    modules: _orderedModules(role),
    mapPreview: { mvKeys: [], loading: true, error: '' },
    cuadreStats: { listo: 0, sucio: 0, manto: 0, otros: 0 },
    colaPreview: [],
    turnoActivo: null,
  };

  _container.innerHTML = _layout(_state);
  _bindGlobalSearch();
  _bindReload();
  _offPlaza = onPlazaChange(async nextPlaza => {
    if (!_state || !_container) return;
    _state.plaza = String(nextPlaza || '').toUpperCase().trim();
    _syncPlazaLabels();
    _render();
    void _refreshDashboardData({ includeMap: true });
    _startRealtimeWidgets(_state.plaza);
  });
  _render();
  void _refreshDashboardData({ includeMap: false });
  _startRealtimeWidgets(plaza);
  _deferWork(() => {
    void _loadMapPreview().then(() => _applyQuery());
  });
  _cleanup = () => {
    if (typeof _offSearch === 'function') _offSearch();
    if (typeof _offPlaza === 'function') _offPlaza();
    _stopRealtimeWidgets();
    _offSearch = null;
    _offPlaza = null;
    _cssRef = document.querySelector('link[data-app-dashboard-css="1"]');
    _container = null;
    _state = null;
  };
}

export function unmount() {
  if (typeof _cleanup === 'function') _cleanup();
  _cleanup = null;
}

function _ensureCss() {
  const existing = document.querySelector('link[data-app-dashboard-css="1"]');
  if (existing) {
    _cssRef = existing;
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-dashboard.css';
  link.dataset.appDashboardCss = '1';
  document.head.appendChild(link);
  _cssRef = link;
}

function _unique(values = []) {
  const seen = new Set();
  const out = [];
  values.forEach(value => {
    const normalized = String(value || '').toUpperCase().trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function _plazaCandidates(plaza) {
  const p = String(plaza || '').toUpperCase().trim();
  const aliases = [p];
  if (['GDL', 'GUADALAJARA', 'GUADALAJARA JALISCO', 'GUADALAJARA-JALISCO'].includes(p)) {
    aliases.push('GDL', 'GUADALAJARA', 'GUADALAJARA JALISCO');
  }
  return _unique(aliases);
}

function _dashMapCacheKey(plaza) {
  return `mex.app.dashboard.visible-map.${String(plaza || '').toUpperCase().trim()}`;
}

function _readDashMapCache(plaza) {
  try {
    const raw = localStorage.getItem(_dashMapCacheKey(plaza)) || sessionStorage.getItem(_dashMapCacheKey(plaza));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.estructura) || !Array.isArray(parsed.unidades)) return null;
    const age = Date.now() - Number(parsed.savedAt || 0);
    if (age > 1000 * 60 * 60 * 12) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function _writeDashMapCache(plaza, payload = {}) {
  try {
    const key = _dashMapCacheKey(plaza);
    const value = JSON.stringify({
      savedAt: Date.now(),
      plaza: String(plaza || '').toUpperCase().trim(),
      resolvedPlaza: String(payload.resolvedPlaza || plaza || '').toUpperCase().trim(),
      estructura: (Array.isArray(payload.estructura) ? payload.estructura : []).slice(0, 800),
      unidades: (Array.isArray(payload.unidades) ? payload.unidades : []).slice(0, 650)
    });
    localStorage.setItem(key, value);
    sessionStorage.setItem(key, value);
  } catch (_) {}
}

function _matchesCandidate(data = {}, plaza) {
  const candidates = new Set(_plazaCandidates(plaza));
  const inferred = String(
    data.plaza ||
    data.plazaID ||
    data.plazaId ||
    data.plazaAsignada ||
    data.sucursal ||
    data.ubicacionSucursal ||
    ''
  ).toUpperCase().trim();
  return !candidates.size || candidates.has(inferred);
}

async function _countCollectionForPlaza(collectionName, plaza) {
  const candidates = _plazaCandidates(plaza);
  const seen = new Set();
  let count = 0;
  await Promise.all(candidates.map(async p => {
    try {
      const snap = await db.collection(collectionName).where('plaza', '==', p).limit(300).get();
      snap.docs.forEach(doc => {
        const key = `${collectionName}:${doc.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        count += 1;
      });
    } catch (_) {}
  }));
  if (count > 0) return count;
  try {
    const snap = await db.collection(collectionName).limit(600).get();
    snap.docs.forEach(doc => {
      const data = doc.data() || {};
      const key = `${collectionName}:${doc.id}`;
      if (seen.has(key) || !_matchesCandidate(data, plaza)) return;
      seen.add(key);
      count += 1;
    });
  } catch (_) {}
  return count;
}

async function _notasCountForPlaza(plaza) {
  const candidates = _plazaCandidates(plaza);
  const seen = new Set();
  let total = 0;
  await Promise.all(candidates.map(async p => {
    try {
      const snap = await db.collection(COL.NOTAS).where('plaza', '==', p).limit(160).get();
      snap.docs.forEach(doc => {
        const estado = String(doc.data()?.estado || '').toUpperCase();
        if (estado === 'RESUELTA' || estado === 'CERRADA') return;
        if (seen.has(doc.id)) return;
        seen.add(doc.id);
        total += 1;
      });
    } catch (_) {}
  }));
  return total;
}

function _modulesForRole(role) {
  const r = String(role || '').toUpperCase();
  const common = [
    { appRoute: '/app/mapa', label: 'Mapa operativo', icon: 'map', keywords: 'mapa unidades mva ubicacion patio celdas' },
    { appRoute: '/app/incidencias', label: 'Incidencias', icon: 'warning', keywords: 'incidencias notas admin pendientes alertas' },
    { appRoute: '/app/mensajes', label: 'Mensajes', icon: 'chat', keywords: 'mensajes chat conversaciones no leidos' },
    { appRoute: '/app/profile', label: 'Perfil', icon: 'person', keywords: 'perfil usuario cuenta ajustes' },
  ];
  if (r === 'PROGRAMADOR' || r === 'JEFE_OPERACION') {
    return [
      { appRoute: '/app/programador', label: 'Programador', icon: 'terminal', keywords: 'diagnostico qa flags smoke consola' },
      { appRoute: '/app/admin', label: 'Admin', icon: 'admin_panel_settings', keywords: 'admin usuarios roles plazas solicitudes' },
      { appRoute: '/app/mapa', label: 'Mapa operativo', icon: 'map', keywords: 'mapa unidades mva ubicacion patio celdas' },
      { appRoute: '/app/incidencias', label: 'Incidencias', icon: 'warning', keywords: 'incidencias notas admin pendientes alertas' },
      { appRoute: '/app/cola-preparacion', label: 'Cola preparación', icon: 'format_list_bulleted', keywords: 'cola preparacion salida checklist pendientes' },
      { appRoute: '/app/mensajes', label: 'Mensajes', icon: 'chat', keywords: 'mensajes chat conversaciones no leidos' },
      { appRoute: '/app/cuadre', label: 'Cuadre', icon: 'calculate', keywords: 'cuadre inventario flotilla resumen patio' },
      { appRoute: '/app/profile', label: 'Perfil', icon: 'person', keywords: 'perfil usuario cuenta ajustes' },
    ];
  }
  if (_isAdminRole(r)) {
    return [
      { appRoute: '/app/cuadre', label: 'Cuadre', icon: 'calculate', keywords: 'cuadre inventario flotilla resumen patio' },
      { appRoute: '/app/admin', label: 'Admin', icon: 'admin_panel_settings', keywords: 'admin usuarios roles plazas solicitudes' },
      { appRoute: '/app/cola-preparacion', label: 'Cola preparación', icon: 'format_list_bulleted', keywords: 'cola preparacion salida checklist pendientes' },
      ...common
    ];
  }
  return [
    { appRoute: '/app/mapa', label: 'Mapa operativo', icon: 'map', keywords: 'mapa unidades mva ubicacion patio celdas' },
    { appRoute: '/app/cola-preparacion', label: 'Cola preparación', icon: 'format_list_bulleted', keywords: 'cola preparacion salida checklist pendientes' },
    ...common
  ];
}

function _modulePriorityOrder(role) {
  const r = String(role || '').toUpperCase();
  if (r === 'PROGRAMADOR') {
    return ['/app/programador', '/app/mapa', '/app/admin', '/app/incidencias', '/app/cola-preparacion', '/app/cuadre', '/app/mensajes', '/app/profile'];
  }
  const adminish = new Set(['SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA', 'JEFE_REGIONAL', 'CORPORATIVO_USER', 'JEFE_OPERACION', 'VENTAS']);
  if (adminish.has(r)) {
    return ['/app/cuadre', '/app/incidencias', '/app/cola-preparacion', '/app/mapa', '/app/mensajes', '/app/admin', '/app/profile'];
  }
  return ['/app/mapa', '/app/cola-preparacion', '/app/incidencias', '/app/mensajes', '/app/profile'];
}

function _orderedModules(role) {
  const list = _modulesForRole(role);
  const pri = _modulePriorityOrder(role);
  return [...list].sort((a, b) => {
    const ia = pri.indexOf(a.appRoute);
    const ib = pri.indexOf(b.appRoute);
    const va = ia === -1 ? 800 : ia;
    const vb = ib === -1 ? 800 : ib;
    if (va !== vb) return va - vb;
    return String(a.label).localeCompare(String(b.label));
  });
}

function _displayUserFirstName(profile) {
  const name =
    profile?.nombreCompleto ||
    profile?.nombre ||
    profile?.email ||
    'Usuario';
  const s = String(name).trim();
  return s.split(/\s+/)[0] || s;
}

function _layout(state) {
  const name = _displayUserFirstName(state.profile);
  const roleLabel = ROLE_LABELS[state.role] || state.role;
  const showDebug = _debugMode();
  const now = new Date();
  const dateString = now.toLocaleDateString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const plazaLabel = state.plaza || 'GLOBAL';
  const un = state.metrics?.unidades ?? 0;
  const ex = state.metrics?.externos ?? 0;
  const inc = state.metrics?.incidencias ?? 0;
  const sol = state.metrics?.solicitudes ?? 0;
  const incClass = inc > 0 ? 'appdash__hero-stat-n--alert' : '';

  return `
<section class="appdash" data-app-home-port="1">
  <div class="appdash__search-hooks" aria-hidden="true">
    ${state.modules
      .map(
        m => `<span data-module-text="${esc((m.label + ' ' + m.keywords).toLowerCase())}"></span>`,
      )
      .join('')}
  </div>

  <div class="appdash__inner">
    <div class="appdash__welcome">
      <div>
        <h2 class="appdash__h2">Bienvenido de nuevo, ${esc(name)}</h2>
        <p class="appdash__date">
          <span class="material-symbols-outlined appdash__date-ico" data-icon="calendar_today">calendar_today</span>
          ${esc(dateString)}
        </p>
        <div id="appDashSearchHintWrap" class="appdash__search-hint-wrap" hidden>
          <p id="appDashMapSearchHit" class="appdash__map-hit" hidden></p>
          <a id="appDashSearchMapAction" hidden href="/app/mapa" data-app-route="/app/mapa" class="appdash__map-search-action">Buscar en mapa</a>
        </div>
      </div>
      <div class="appdash__welcome-actions">
        <button type="button" class="appdash__btn-refresh" id="appDashReloadBtn" title="Actualizar">
          <span class="material-symbols-outlined appdash__btn-ico" data-icon="refresh">refresh</span>
          Actualizar
        </button>
      </div>
    </div>

    <div class="appdash__grid12">
      <div class="appdash__hero-map appdash__shell-card appdash__stagger-1">
        <div class="appdash__hero-map-canvas" id="appDashMapPreview">
          <div class="appdash__hero-map-loading"><div class="appdash__spinner"></div></div>
        </div>
        <div class="appdash__hero-overlay">
          <div class="appdash__hero-overlay-top">
            <div class="appdash__live-badge">
              <span class="appdash__pulse-wrap">
                <span class="appdash__pulse"></span>
                <span class="appdash__pulse-dot"></span>
              </span>
              <span class="appdash__live-text">Monitoreo en Vivo: <span id="appDashMonitoreoPlaza">${esc(plazaLabel)}</span></span>
              <a class="appdash__veh-btn" data-app-route="/app/mapa" href="/app/mapa" title="Vehículos en el mapa">
                <span class="material-symbols-outlined appdash__btn-ico" data-icon="directions_car">directions_car</span>
                <span class="appdash__veh-btn-txt">Vehículos</span>
              </a>
            </div>
          </div>
          <div class="appdash__hero-overlay-bottom">
            <div class="appdash__hero-stats">
              <div class="appdash__hero-stat">
                <p class="appdash__hero-stat-l">Activas</p>
                <p id="appDashHeroActivas" class="appdash__hero-stat-n">${esc(String(un))}</p>
              </div>
              <div class="appdash__hero-stat-div appdash__hero-stat-div--show-md"></div>
              <div class="appdash__hero-stat">
                <p class="appdash__hero-stat-l">Externos</p>
                <p id="appDashHeroExt" class="appdash__hero-stat-n">${esc(String(ex))}</p>
              </div>
              <div class="appdash__hero-stat-div appdash__hero-stat-div--show-md"></div>
              <div class="appdash__hero-stat">
                <p class="appdash__hero-stat-l">Alertas</p>
                <p id="appDashHeroAlert" class="appdash__hero-stat-n ${incClass}">${esc(String(inc))}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="appdash__kpi-col appdash__stagger-2">
        <div class="appdash__kpi-card appdash__shell-card">
          <div class="appdash__kpi-inner">
            <div class="appdash__kpi-ico appdash__kpi-ico--nav">
              <span class="material-symbols-outlined" data-icon="navigation">navigation</span>
            </div>
            <h3 class="appdash__kpi-title">Vehículos Activos</h3>
            <p id="appDashKpiUni" class="appdash__kpi-val">${esc(String(un))}</p>
          </div>
          <span class="appdash__kpi-watermark material-symbols-outlined" data-icon="directions_car">directions_car</span>
        </div>

        <div class="appdash__kpi-card appdash__shell-card appdash__stagger-3">
          <div class="appdash__kpi-inner">
            <div class="appdash__kpi-top">
              <div class="appdash__kpi-ico appdash__kpi-ico--warn">
                <span class="material-symbols-outlined" data-icon="warning">warning</span>
              </div>
              <span id="appDashIncAction" class="appdash__action-tag" ${inc > 0 ? '' : 'hidden'}><span class="material-symbols-outlined appdash__action-tag-ico" data-icon="report">report</span>Acción</span>
            </div>
            <h3 class="appdash__kpi-title">Incidencias de Hoy</h3>
            <p id="appDashKpiInc" class="appdash__kpi-val">${esc(String(inc))}</p>
          </div>
          <span class="appdash__kpi-watermark material-symbols-outlined" data-icon="notifications_active">notifications_active</span>
        </div>

        <div class="appdash__kpi-card appdash__shell-card appdash__stagger-4">
          <div class="appdash__kpi-inner">
            <div class="appdash__kpi-ico appdash__kpi-ico--inv">
              <span class="material-symbols-outlined" data-icon="inventory_2">inventory_2</span>
            </div>
            <h3 class="appdash__kpi-title">Solicitudes (Admin)</h3>
            <p id="appDashKpiSol" class="appdash__kpi-val">${esc(String(sol))}</p>
          </div>
          <span class="appdash__kpi-watermark material-symbols-outlined" data-icon="local_shipping">local_shipping</span>
        </div>
      </div>

      <div class="appdash__secondary">
        <div class="appdash__glass appdash__shell-card appdash__resumen">
          <div class="appdash__resumen-inner">
            <h3 class="appdash__resumen-h">Resumen de Operaciones Globales</h3>
            <p class="appdash__resumen-p">Bienvenido a tu nueva Área Operativa. Todo el sistema logístico se centraliza aquí para agilizar las operaciones logísticas y evitar cuellos de botella mediante acceso directo.</p>
            <div class="appdash__chips">
              <span class="appdash__chip">📍 <span id="appDashChipPlaza">${esc(plazaLabel === 'GLOBAL' ? 'Global' : plazaLabel)}</span></span>
              <span class="appdash__chip">👤 ${esc(roleLabel)}</span>
            </div>
          </div>
          <div class="appdash__resumen-gradient"></div>
        </div>

        <div class="appdash__actividad appdash__shell-card">
          <div class="appdash__actividad-head">
            <h3 class="appdash__actividad-title">Actividad Reciente</h3>
            <span class="material-symbols-outlined appdash__actividad-more" data-icon="more_horiz">more_horiz</span>
          </div>
          <div class="appdash__actividad-body">
            ${_actividadBlocks(inc, un, plazaLabel)}
          </div>
        </div>
      </div>
    </div>

    <div class="appdash__modules-wrap">
      <div class="appdash__modules-head">
        <h3 class="appdash__modules-title">Acceso Rápido</h3>
      </div>
      <div class="appdash__modules" id="appDashModules">
        ${_renderModuleCards(state.modules)}
      </div>
    </div>

    <div class="appdash__live-row">
      <div class="appdash__widget appdash__shell-card">
        <div class="appdash__widget-head">
          <span class="material-symbols-outlined">directions_car</span>
          <h3>Estado del Patio</h3>
          <a class="appdash__widget-link" data-app-route="/app/mapa" href="/app/mapa">Ver mapa</a>
        </div>
        <div class="appdash__widget-body" id="appDashCuadreBody">
          <p class="appdash__widget-empty">Cargando…</p>
        </div>
      </div>
      <div class="appdash__widget appdash__shell-card">
        <div class="appdash__widget-head">
          <span class="material-symbols-outlined">format_list_bulleted</span>
          <h3>Cola de Preparación</h3>
          <a class="appdash__widget-link" data-app-route="/app/cola-preparacion" href="/app/cola-preparacion">Ver todo</a>
        </div>
        <div class="appdash__widget-body" id="appDashColaBody">
          <p class="appdash__widget-empty">Cargando…</p>
        </div>
      </div>
      <div class="appdash__widget appdash__shell-card">
        <div class="appdash__widget-head">
          <span class="material-symbols-outlined">badge</span>
          <h3>Mi Turno</h3>
        </div>
        <div class="appdash__widget-body" id="appDashTurnoBody">
          <p class="appdash__widget-empty">Cargando…</p>
        </div>
      </div>
    </div>
  </div>

  ${showDebug ? `
    <div class="appdash__dev-only">
      <div class="appdash__dev-eyebrow">Solo diagnóstico (mex.debug.mode)</div>
      <p class="appdash__dev-text">Herramientas internas; no uses en operación.</p>
    </div>
  ` : ''}
</section>`;
}

function _renderModuleCards(modules = []) {
  return modules.map(m => `
    <a class="appdash__module-card appdash__shell-card" href="${esc(m.appRoute)}" data-app-route="${esc(m.appRoute)}">
      <div class="appdash__module-ico">
        <span class="material-symbols-outlined appdash__module-ico-s">${esc(m.icon)}</span>
      </div>
      <span class="appdash__module-label">${esc(m.label)}</span>
      <span class="material-symbols-outlined appdash__module-arrow">arrow_forward</span>
    </a>
  `).join('');
}

function _actividadBlocks(inc, un, plazaLabel) {
  const incBlock =
    inc > 0
      ? `<div class="appdash__act-row">
          <div class="appdash__act-ico appdash__act-ico--err"><span class="material-symbols-outlined appdash__act-ico-s" data-icon="warning">warning</span></div>
          <div class="appdash__act-txt">
            <p class="appdash__act-bold">Hay ${esc(String(inc))} alerta(s) abierta(s)</p>
            <p class="appdash__act-sub">Requiere supervisión en ${esc(plazaLabel)}</p>
          </div>
        </div>`
      : `<div class="appdash__act-row">
          <div class="appdash__act-ico appdash__act-ico--ok"><span class="material-symbols-outlined appdash__act-ico-s" data-icon="check_circle">check_circle</span></div>
          <div class="appdash__act-txt">
            <p class="appdash__act-bold">Operación limpia</p>
            <p class="appdash__act-sub">No hay incidencias críticas registradas hoy.</p>
          </div>
        </div>`;

  const unBlock =
    un > 0
      ? `<div class="appdash__act-row">
          <div class="appdash__act-ico appdash__act-ico--amber"><span class="material-symbols-outlined appdash__act-ico-s" data-icon="local_shipping">local_shipping</span></div>
          <div class="appdash__act-txt">
            <p class="appdash__act-bold">Unidades movilizadas</p>
            <p class="appdash__act-sub">Sistema reporta ${esc(String(un))} vehículos en línea y asignados</p>
          </div>
        </div>`
      : '';

  return incBlock + unBlock;
}

// ── Realtime widget helpers ──────────────────────────────────

function _cpDone(checklist) {
  if (!checklist) return 0;
  return ['lavado', 'gasolina', 'docs', 'revision'].filter(k => checklist[k] === true).length;
}

function _timeElapsed(since) {
  const ms = Date.now() - since.getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m en turno`;
  return `${m}m en turno`;
}

function _stopRealtimeWidgets() {
  if (typeof _unsubCuadre === 'function') { try { _unsubCuadre(); } catch (_) {} _unsubCuadre = null; }
  if (typeof _unsubCola === 'function') { try { _unsubCola(); } catch (_) {} _unsubCola = null; }
  if (typeof _unsubTurno === 'function') { try { _unsubTurno(); } catch (_) {} _unsubTurno = null; }
}

function _startRealtimeWidgets(plaza) {
  _stopRealtimeWidgets();
  if (!_state || !plaza) {
    _updateCuadreWidget();
    _updateColaWidget();
    _updateTurnoWidget();
    return;
  }

  const gs = getState();
  const uid = gs.profile?.uid || gs.profile?.id || '';

  // D: Estado del patio (cuadre onSnapshot)
  try {
    _unsubCuadre = db.collection(COL.CUADRE)
      .where('plaza', '==', plaza)
      .onSnapshot(snap => {
        if (!_state) return;
        const stats = { listo: 0, sucio: 0, manto: 0, otros: 0 };
        snap.forEach(doc => {
          const estado = String(doc.data()?.estado || '').toUpperCase().trim();
          if (estado === 'LISTO') stats.listo++;
          else if (['SUCIO', 'EN_PREP', 'EN PREPARACIÓN', 'PREPARACION', 'LAVADO', 'LIMPIEZA'].includes(estado)) stats.sucio++;
          else if (['MANTENIMIENTO', 'MANTO', 'HYP', 'RETENIDA'].includes(estado)) stats.manto++;
          else if (estado) stats.otros++;
        });
        _state.cuadreStats = stats;
        _updateCuadreWidget();
      }, err => {
        console.warn('[dashboard] cuadre snap:', err?.code);
      });
  } catch (_) {}

  // F: Cola top 5
  try {
    _unsubCola = db.collection('cola_preparacion').doc(plaza).collection('items')
      .limit(10)
      .onSnapshot(snap => {
        if (!_state) return;
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        items.sort((a, b) => {
          const ao = Number(a.orden); const bo = Number(b.orden);
          if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
          const at = a.fechaSalida?.toDate?.()?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
          const bt = b.fechaSalida?.toDate?.()?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
          return at - bt;
        });
        _state.colaPreview = items.slice(0, 5);
        _updateColaWidget();
      }, () => {
        if (!_state) return;
        _state.colaPreview = [];
        _updateColaWidget();
      });
  } catch (_) {}

  // G: Mi turno (listener en tiempo real)
  if (uid) {
    try {
      _unsubTurno = db.collection('turnos')
        .where('usuarioId', '==', uid)
        .where('estado', '==', 'ACTIVO')
        .limit(1)
        .onSnapshot(snap => {
          if (!_state) return;
          _state.turnoActivo = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
          _updateTurnoWidget();
        }, () => {
          if (!_state) return;
          _state.turnoActivo = null;
          _updateTurnoWidget();
        });
    } catch (_) {}
  } else {
    _updateTurnoWidget();
  }
}

function _updateCuadreWidget() {
  const el = _container?.querySelector('#appDashCuadreBody');
  if (!el) return;
  const s = _state?.cuadreStats || { listo: 0, sucio: 0, manto: 0, otros: 0 };
  const total = s.listo + s.sucio + s.manto + s.otros;
  const avail = total > 0 ? Math.round((s.listo / total) * 100) : 0;
  if (!_state?.plaza) {
    el.innerHTML = '<p class="appdash__widget-empty">Selecciona una plaza</p>';
    return;
  }
  el.innerHTML = `
    <div class="appdash__cs-stats">
      <div class="appdash__cs-stat">
        <span class="appdash__cs-dot" style="background:#10b981"></span>
        <span class="appdash__cs-label">Listo</span>
        <span class="appdash__cs-val">${s.listo}</span>
      </div>
      <div class="appdash__cs-stat">
        <span class="appdash__cs-dot" style="background:#f59e0b"></span>
        <span class="appdash__cs-label">Sucio / En prep</span>
        <span class="appdash__cs-val">${s.sucio}</span>
      </div>
      <div class="appdash__cs-stat">
        <span class="appdash__cs-dot" style="background:#ef4444"></span>
        <span class="appdash__cs-label">Manto / Retenida</span>
        <span class="appdash__cs-val">${s.manto}</span>
      </div>
    </div>
    <div class="appdash__cs-bar">
      <div style="width:${s.listo / Math.max(total, 1) * 100}%;background:#10b981"></div>
      <div style="width:${s.sucio / Math.max(total, 1) * 100}%;background:#f59e0b"></div>
      <div style="width:${s.manto / Math.max(total, 1) * 100}%;background:#ef4444"></div>
    </div>
    <div class="appdash__cs-avail">Disponibilidad: <strong>${avail}%</strong></div>`;
}

function _updateColaWidget() {
  const el = _container?.querySelector('#appDashColaBody');
  if (!el) return;
  const items = _state?.colaPreview || [];
  if (!_state?.plaza) {
    el.innerHTML = '<p class="appdash__widget-empty">Selecciona una plaza</p>';
    return;
  }
  if (!items.length) {
    el.innerHTML = '<p class="appdash__widget-empty">Cola vacía</p>';
    return;
  }
  el.innerHTML = items.map(it => {
    const mva = esc(String(it.mva || it.id || '—'));
    const asignado = esc(String(it.asignado || 'Sin asignar'));
    const done = _cpDone(it.checklist);
    return `<div class="appdash__cola-row">
      <span class="appdash__cola-mva">${mva}</span>
      <span class="appdash__cola-info">${asignado}</span>
      <span class="appdash__cola-prog">${done}/4</span>
    </div>`;
  }).join('');
}

function _updateTurnoWidget() {
  const el = _container?.querySelector('#appDashTurnoBody');
  if (!el) return;
  const turno = _state?.turnoActivo;
  const gs = getState();
  const profile = gs.profile || {};
  const uid = profile?.uid || profile?.id || '';
  const plaza = _state?.plaza || '';

  if (!turno) {
    el.innerHTML = `
      <p class="appdash__widget-empty" style="margin-bottom:10px;">Sin turno activo</p>
      <button type="button" class="appdash__turno-btn appdash__turno-btn--start" id="appDashIniciarTurno"
              ${(!uid || !plaza) ? 'disabled' : ''}>
        <span class="material-symbols-outlined">play_circle</span> Iniciar turno
      </button>`;
    el.querySelector('#appDashIniciarTurno')?.addEventListener('click', async () => {
      const btn = el.querySelector('#appDashIniciarTurno');
      if (btn) btn.disabled = true;
      try {
        await iniciarTurno({ uid, ...profile }, plaza);
      } catch (e) {
        console.warn('[dashboard] iniciarTurno:', e);
        if (_state && btn) btn.disabled = false;
      }
    });
    return;
  }

  const inicio = turno.inicio?.toDate?.() || new Date(turno.inicio || Date.now());
  const elapsed = _timeElapsed(inicio);
  const since = inicio.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `
    <div class="appdash__turno-active">
      <span class="material-symbols-outlined appdash__turno-ico">schedule</span>
      <div>
        <div class="appdash__turno-elapsed">${esc(elapsed)}</div>
        <div class="appdash__turno-since">Desde las ${esc(since)}</div>
      </div>
    </div>
    <button type="button" class="appdash__turno-btn appdash__turno-btn--end" id="appDashCerrarTurno">
      <span class="material-symbols-outlined">stop_circle</span> Cerrar turno
    </button>`;
  el.querySelector('#appDashCerrarTurno')?.addEventListener('click', async () => {
    const btn = el.querySelector('#appDashCerrarTurno');
    if (btn) btn.disabled = true;
    try {
      await cerrarTurno(turno.id);
    } catch (e) {
      console.warn('[dashboard] cerrarTurno:', e);
      if (_state && btn) btn.disabled = false;
    }
  });
}

function _bindReload() {
  const btn = _container?.querySelector('#appDashReloadBtn');
  if (btn && btn.dataset.bound !== '1') {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      void _refreshDashboardData({ includeMap: true }).finally(() => {
        if (btn) btn.disabled = false;
      });
    });
  }
}

async function _refreshDashboardData({ includeMap = true } = {}) {
  await _loadMetrics();
  if (!_state || !_container) return;
  _render();
  if (includeMap) await _loadMapPreview();
  if (!_state || !_container) return;
  _applyQuery();
}

async function _loadMetrics() {
  const plaza = String(_state?.plaza || '').toUpperCase().trim();
  const role = String(_state?.role || '');
  const isAdmin = _isAdminRole(role);
  const [cuadre, externos, solicitudes, notas] = await Promise.all([
    plaza ? _countCollectionForPlaza(COL.CUADRE, plaza) : 0,
    plaza ? _countCollectionForPlaza(COL.EXTERNOS, plaza) : 0,
    isAdmin ? _safeCount(db.collection('solicitudes').where('estado', '==', 'PENDIENTE').limit(80).get()) : 0,
    plaza ? _notasCountForPlaza(plaza) : 0,
  ]);
  if (!_state || String(_state.plaza || '').toUpperCase().trim() !== plaza) return;
  _state.metrics = { unidades: cuadre, externos, incidencias: notas, solicitudes };
}

async function _loadMapPreviewDataset(plaza) {
  const candidates = _plazaCandidates(plaza);
  const results = await Promise.all(candidates.map(async candidate => {
    try {
      const [estructura, datosMapa] = await Promise.all([
        obtenerEstructuraMapa(candidate),
        obtenerDatosParaMapa(candidate),
      ]);
      return {
        candidate,
        estructura: Array.isArray(estructura) ? estructura : [],
        unidades: Array.isArray(datosMapa?.unidades) ? datosMapa.unidades : []
      };
    } catch (error) {
      return { candidate, estructura: [], unidades: [], error };
    }
  }));
  const withUnits = results.find(item => item.unidades.length > 0) || results[0] || { candidate: plaza, unidades: [] };
  const withStructure = results.find(item => item.candidate === withUnits.candidate && item.estructura.length > 0)
    || results.find(item => item.estructura.length > 0)
    || withUnits
    || { estructura: [] };
  return {
    resolvedPlaza: withUnits.candidate || plaza,
    estructura: withStructure.estructura || [],
    unidades: withUnits.unidades || []
  };
}

async function _loadMapPreview() {
  const plaza = String(_state?.plaza || '').toUpperCase().trim();
  const requestId = ++_mapPreviewRequestId;
  const el = _container?.querySelector('#appDashMapPreview');
  if (el) {
    el.innerHTML = '<div class="appdash__hero-map-loading"><div class="appdash__spinner"></div></div>';
  }
  _state.mapPreview = { mvKeys: [], loading: true, error: '' };

  if (!plaza) {
    if (!_state || requestId !== _mapPreviewRequestId) return;
    _state.mapPreview = { mvKeys: [], loading: false, error: 'Sin plaza' };
    if (el) {
      el.innerHTML = `<div class="appdash__map-fallback-inner"><span class="material-symbols-outlined appdash__map-fallback-ico" data-icon="map_off">map_off</span><span>Selecciona una plaza en el header para el mapa en vivo.</span></div>`;
    }
    return;
  }

  const cached = _readDashMapCache(plaza);
  if (cached && el) {
    const cachedUnits = Array.isArray(cached.unidades) ? cached.unidades : [];
    _state.mapPreview.mvKeys = cachedUnits
      .slice(0, 160)
      .map(u => String(u.mva || '').trim().toUpperCase())
      .filter(Boolean);
    _state.mapPreview.loading = true;
    _paintMiniMap(el, cached.resolvedPlaza || plaza, cached.estructura || [], cachedUnits);
    _applyQuery();
  }

  try {
    const { estructura, unidades, resolvedPlaza } = await _loadMapPreviewDataset(plaza);
    if (!_state || requestId !== _mapPreviewRequestId) return;
    _state.mapPreview.mvKeys = unidades
      .slice(0, 160)
      .map(u => String(u.mva || '').trim().toUpperCase())
      .filter(Boolean);
    _state.mapPreview.loading = false;
    _writeDashMapCache(plaza, { resolvedPlaza, estructura, unidades });
    _paintMiniMap(el, resolvedPlaza || plaza, estructura, unidades);
    _applyQuery();
  } catch (error) {
    if (!_state || requestId !== _mapPreviewRequestId) return;
    _state.mapPreview = { mvKeys: [], loading: false, error: error?.message || 'mapa' };
    if (el) {
      el.innerHTML = `<div class="appdash__map-fallback-inner"><span class="material-symbols-outlined appdash__map-fallback-ico" data-icon="map_off">map_off</span><span>Vista en vivo no disponible (${esc(plaza)})</span></div>`;
    }
  }
}

function _deferWork(fn, timeout = 900) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(fn, { timeout });
  } else {
    window.setTimeout(fn, Math.min(timeout, 500));
  }
}

function _paintMiniMap(container, plaza, estructuraRaw, unidadesRaw) {
  if (!container) return;
  try {
    const estructura = (Array.isArray(estructuraRaw) ? estructuraRaw : []).map((item, i) => normalizarElemento(item, i));
    const normUnidades = unidadesRaw.map(u => normalizarUnidad(u)).filter(u => u.mva);
    const vm = buildMapaViewModel(estructura, normUnidades, {}, {});

    let minX = 0;
    let minY = 0;
    let maxX = 800;
    let maxY = 600;
    const cajonesPreview = Array.isArray(vm.cajones) ? vm.cajones.slice(0, 320) : [];
    if (cajonesPreview.length > 0) {
      minX = Math.min(...cajonesPreview.map(c => c.x));
      minY = Math.min(...cajonesPreview.map(c => c.y));
      maxX = Math.max(...cajonesPreview.map(c => c.x + c.width));
      maxY = Math.max(...cajonesPreview.map(c => c.y + c.height));
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
      LISTO: '#10b981',
      SUCIO: '#f59e0b',
      MANTENIMIENTO: '#ef4444',
      RESGUARDO: '#92400e',
      TRASLADO: '#7c3aed',
      'EN RENTA': '#38bdf8',
      RETENIDA: '#1d4ed8',
      VENTA: '#f59e0b',
      HYP: '#ef4444',
    };

    let html = `<div class="appdash__mini-map-scale" style="transform: translate(-50%, -50%) scale(${scale}); width:${mapW}px; height:${mapH}px;">`;

    const cajonByPos = new Map();
    for (const c of cajonesPreview) {
      cajonByPos.set(c.pos, c);
      if (c.tipo === 'pilar') continue;
      const spotStyle = c.esLabel
        ? `background:transparent; border:none; color:rgba(255,255,255,0.4); font-size:32px; font-weight:bold;`
        : `background:rgba(255,255,255,0.02); border-left:2px solid rgba(255,255,255,0.1); border-right:2px solid rgba(255,255,255,0.1); border-top:2px solid rgba(255,255,255,0.1); border-bottom:none; border-radius:6px 6px 0 0;`;
      const text = c.esLabel ? c.pos : '';
      html += `<div style="position:absolute; left:${c.x - minX + 50}px; top:${c.y - minY + 50}px; width:${c.width}px; height:${c.height}px; transform:rotate(${c.rotation}deg); ${spotStyle} display:flex; align-items:center; justify-content:center; box-sizing:border-box;">${text}</div>`;
    }

    const unitEntries = Array.from(vm.unitMap.entries()).slice(0, 220);
    for (const [mva, u] of unitEntries) {
      if (u.pos === 'LIMBO') continue;
      const c = cajonByPos.get(u.pos);
      if (!c) continue;
      const bg = colors[u.estado] || '#64748b';
      const carStyle = `border-radius:16px 16px 10px 10px; background:linear-gradient(160deg, ${bg} 0%, #000 120%); box-shadow:0 8px 15px -4px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.25); border:1px solid rgba(0,0,0,0.15); color:white; font-size:16px; font-weight:900; text-shadow:0 1px 3px rgba(0,0,0,0.4);`;
      html += `<div style="position:absolute; left:${c.x - minX + 50}px; top:${c.y - minY + 50}px; width:${c.width}px; height:${c.height}px; transform:rotate(${c.rotation}deg); ${carStyle} display:flex; align-items:center; justify-content:center; box-sizing:border-box;">${mva}</div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
  } catch (e) {
    console.error('[dashboard mini map]', e);
    container.innerHTML = `<div class="appdash__map-fallback-inner"><span class="material-symbols-outlined appdash__map-fallback-ico" data-icon="map_off">map_off</span><span>Vista en vivo no disponible (${esc(plaza)})</span></div>`;
  }
}

function _render() {
  const m = _state.metrics;
  const plaza = _state.plaza || 'GLOBAL';
  _setText('#appDashKpiUni', m.unidades);
  _setText('#appDashKpiInc', m.incidencias);
  _setText('#appDashKpiSol', m.solicitudes);
  _setText('#appDashHeroActivas', m.unidades);
  _setText('#appDashHeroExt', m.externos);
  _setText('#appDashHeroAlert', m.incidencias);
  _syncPlazaLabels();

  const alertEl = _container?.querySelector('#appDashHeroAlert');
  if (alertEl) {
    alertEl.classList.toggle('appdash__hero-stat-n--alert', m.incidencias > 0);
  }

  const sec = _container?.querySelector('.appdash__actividad-body');
  if (sec) {
    sec.innerHTML = _actividadBlocks(m.incidencias, m.unidades, plaza);
  }

  const incTag = _container?.querySelector('#appDashIncAction');
  if (incTag) incTag.hidden = m.incidencias <= 0;

  _applyQuery();
}

function _syncPlazaLabels() {
  const p = _state.plaza || 'GLOBAL';
  _setText('#appDashMonitoreoPlaza', p);
  const chip = _container?.querySelector('#appDashChipPlaza');
  if (chip) chip.textContent = p === 'GLOBAL' ? 'Global' : p;
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_state || !_container) return;
    const route = String(event?.detail?.route || '');
    if (!(route.startsWith('/app/dashboard') || route === '/home')) return;
    _state.query = String(event?.detail?.query || '').toLowerCase().trim();
    _applyQuery();
  };
  window.addEventListener('mex:global-search', handler);
  _offSearch = () => window.removeEventListener('mex:global-search', handler);
}

function _applyQuery() {
  const hooks = Array.from(_container?.querySelectorAll('.appdash__search-hooks [data-module-text]') || []);
  hooks.forEach(el => {
    const txt = String(el.getAttribute('data-module-text') || '');
    const visible = !_state.query || txt.includes(_state.query);
    el.style.display = visible ? '' : 'none';
  });

  const wrap = _container?.querySelector('#appDashSearchHintWrap');
  const action = _container?.querySelector('#appDashSearchMapAction');
  if (action) {
    const hasQuery = Boolean(_state.query);
    const looksLikeUnit = /^[a-z0-9-]{2,}$/i.test(_state.query || '');
    action.hidden = !(hasQuery && looksLikeUnit);
    if (!action.hidden) {
      const qe = encodeURIComponent(_state.query);
      const full = `/app/mapa?q=${qe}`;
      action.setAttribute('href', full);
      action.setAttribute('data-app-route', full);
    }
  }

  const hitEl = _container?.querySelector('#appDashMapSearchHit');
  if (hitEl) {
    const q = String(_state.query || '').trim().toUpperCase();
    const keys = _state.mapPreview?.mvKeys || [];
    const hit =
      q.length >= 2 && keys.some(k => k.includes(q) || q.includes(k));
    hitEl.hidden = !hit;
    hitEl.textContent = hit
      ? `Coincidencia posible en plaza (${q}) — abre el mapa para ubicarla.`
      : '';
  }

  if (wrap) {
    const hitVisible = hitEl && hitEl.hidden === false;
    const actionVisible = action && action.hidden === false;
    wrap.hidden = !hitVisible && !actionVisible;
  }
}

function _isAdminRole(role) {
  return [
    'SUPERVISOR',
    'JEFE_PATIO',
    'GERENTE_PLAZA',
    'JEFE_REGIONAL',
    'CORPORATIVO_USER',
    'JEFE_OPERACION',
    'PROGRAMADOR',
    'VENTAS',
  ].includes(String(role || ''));
}

async function _safeCount(promise) {
  try {
    const snap = await promise;
    return snap?.size || 0;
  } catch (_) {
    return 0;
  }
}

function _debugMode() {
  try {
    return localStorage.getItem('mex.debug.mode') === '1';
  } catch {
    return false;
  }
}

function _setText(selector, value) {
  const el = _container?.querySelector(selector);
  if (el) el.textContent = String(value ?? '');
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
