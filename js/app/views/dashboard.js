// ═══════════════════════════════════════════════════════════
//  /js/app/views/dashboard.js
//  Vista /app/dashboard — Panel principal post-login (Fase 6).
//
//  Links con data-app-route → cargan dentro del shell sin recargar.
//  Links con href normal   → navegación real (legacy).
//  /mapa siempre con href normal — NO migrado.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';
import { db, COL, obtenerDatosParaMapa, obtenerEstructuraMapa, obtenerDatosFlotaConsola, obtenerMensajesPrivados } from '/js/core/database.js';
import { buildMapaReadOnlyViewModel, buildMapaPreviewSummary } from '/js/app/features/mapa/mapa-view-model.js';

let _cleanup = null;
let _container = null;
let _state = null;
let _offSearch = null;
let _offPlaza = null;
let _cssRef = null;
let _mapPreviewRequestId = 0;

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
    pending: { colaNotReady: null, colaTotal: null, msgUnread: null },
    modules: _orderedModules(role),
    mapPreview: {
      loading: true,
      error: '',
      unitCount: 0,
      previewSummary: null,
      mvKeys: [],
      stateItems: []
    }
  };

  _container.innerHTML = _layout(_state);
  _bindGlobalSearch();
  _offPlaza = onPlazaChange(async nextPlaza => {
    if (!_state || !_container) return;
    _state.plaza = String(nextPlaza || '').toUpperCase().trim();
    _setText('#appDashPlaza', _state.plaza || '—');
    await Promise.all([_loadMetrics(), _loadMapPreview(), _loadPending()]);
    _render();
  });
  await Promise.all([_loadMetrics(), _loadMapPreview(), _loadPending()]);
  _render();
  _cleanup = () => {
    if (typeof _offSearch === 'function') _offSearch();
    if (typeof _offPlaza === 'function') _offPlaza();
    _offSearch = null;
    _offPlaza = null;
    // Mantener CSS en cache DOM evita flicker al navegar entre vistas.
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
  if (existing) { _cssRef = existing; return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-dashboard.css';
  link.dataset.appDashboardCss = '1';
  document.head.appendChild(link);
  _cssRef = link;
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

function _layout(state) {
  const name = state.profile?.nombreCompleto || state.profile?.nombre || state.profile?.email || 'Usuario';
  const roleLabel = ROLE_LABELS[state.role] || state.role;
  const showDebug = _debugMode();
  const showAdminPending = _isAdminRole(state.role);
  const plazaMissing = !state.plaza;
  const roleTone = _roleIntro(state.role);
  return `
<section class="appdash">
  <div class="appdash__hero">
    <div class="appdash__card">
      <p class="appdash__hello">${esc(_greeting())}</p>
      <h1 class="appdash__h1">Hola, ${esc(name.split(' ')[0])}</h1>
      <p class="appdash__meta">${esc(roleLabel)} · <span id="appDashPlaza">${esc(state.plaza || '—')}</span> · ${esc(state.company)}</p>
      <p class="appdash__lede">${esc(roleTone)}</p>
      <div class="appdash__quick-actions">
        <a data-app-route="/app/mapa" href="/app/mapa" class="appdash__pill appdash__pill--primary">Mapa</a>
        <a data-app-route="/app/cola-preparacion" href="/app/cola-preparacion" class="appdash__pill">Cola</a>
        <a data-app-route="/app/profile" href="/app/profile" class="appdash__pill">Perfil</a>
      </div>
    </div>
    <div class="appdash__card appdash__card--muted">
      <div class="appdash__eyebrow">Plaza activa</div>
      <p class="appdash__lede">Los indicadores y el preview se actualizan con la plaza global del header.</p>
      ${plazaMissing ? '<p class="appdash__warning">Tu perfil no tiene plaza válida asignada. Solicita ajuste en Admin para operar.</p>' : ''}
      <a href="/home" class="appdash__subtle-link">Abrir fallback legacy</a>
    </div>
  </div>

  <div class="appdash__pend-wrap">
    <h2 class="appdash__section-title">Pendientes y seguimiento</h2>
    <div class="appdash__pend-grid">
      <a data-app-route="/app/cola-preparacion" href="/app/cola-preparacion" class="appdash__pend-card" data-pending-text="cola preparacion checklist salidas pendientes">
        <span id="appDashPendCola" class="appdash__pend-n">—</span>
        <span class="appdash__pend-l">Salidas sin checklist completo</span>
        <span class="appdash__pend-hint">Cola de preparación</span>
      </a>
      <a data-app-route="/app/incidencias" href="/app/incidencias" class="appdash__pend-card" data-pending-text="incidencias abiertas alertas pendientes">
        <span id="appDashPendInc" class="appdash__pend-n">—</span>
        <span class="appdash__pend-l">Incidencias abiertas</span>
        <span class="appdash__pend-hint">notas_admin · plaza</span>
      </a>
      <a data-app-route="/app/mensajes" href="/app/mensajes" class="appdash__pend-card" data-pending-text="mensajes no leidos chat bandeja">
        <span id="appDashPendMsg" class="appdash__pend-n">—</span>
        <span class="appdash__pend-l">Mensajes sin leer</span>
        <span class="appdash__pend-hint">Bandeja</span>
      </a>
      <a data-app-route="/app/admin" href="/app/admin?tab=solicitudes" class="appdash__pend-card" data-pending-text="solicitudes pendientes admin" ${showAdminPending ? '' : 'hidden'} id="appDashPendSolCard">
        <span id="appDashPendSol" class="appdash__pend-n">—</span>
        <span class="appdash__pend-l">Solicitudes pendientes</span>
        <span class="appdash__pend-hint">Admin</span>
      </a>
    </div>
  </div>

  <div class="appdash__kpis">
    ${_kpi('appDashKpiUnidades', 'Unidades activas')}
    ${_kpi('appDashKpiExternos', 'Externos')}
    ${_kpi('appDashKpiInc', 'Incidencias abiertas')}
    ${_kpi('appDashKpiSol', 'Solicitudes pendientes')}
  </div>

  <div class="appdash__card appdash__map-preview">
    <div class="appdash__map-header">
      <div>
        <div class="appdash__eyebrow">Mapa · vista rápida</div>
        <strong class="appdash__map-title">Plaza <span id="appDashMapPlaza">${esc(state.plaza || '—')}</span></strong>
      </div>
      <div class="appdash__map-actions">
        <a data-app-route="/app/mapa" href="/app/mapa" class="appdash__chip-link">Abrir en App</a>
        <a href="/mapa" class="appdash__chip-link appdash__chip-link--alt">Mapa classic</a>
      </div>
    </div>
    <div id="appDashMapPreviewBody" class="appdash__map-body">
      <div class="appdash__map-loading">Cargando vista rápida...</div>
    </div>
  </div>

  <h2 class="appdash__section-title">Accesos</h2>
  <div class="appdash__modules" id="appDashModules">
    ${state.modules.map(mod => `
      <a class="appdash__module" data-app-route="${esc(mod.appRoute)}" href="${esc(mod.appRoute)}" data-module-text="${esc((mod.label + ' ' + mod.keywords).toLowerCase())}">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="material-symbols-outlined" style="font-size:18px;color:#2b6954;">${esc(mod.icon)}</span>
          <strong style="font-size:13px;color:#0f172a;">${esc(mod.label)}</strong>
        </div>
      </a>
    `).join('')}
  </div>

  ${showDebug ? `
    <div class="appdash__card appdash__dev-only">
      <div class="appdash__eyebrow">Solo diagnóstico (mex.debug.mode)</div>
      <p class="appdash__dev-text">Herramientas internas; no uses en operación.</p>
    </div>
  ` : ''}

</section>
  `;
}

async function _loadMetrics() {
  const plaza = String(_state?.plaza || '').toUpperCase().trim();
  const isAdmin = _isAdminRole(_state.role);
  const [cuadre, externos, solicitudes, notasSnap] = await Promise.all([
    plaza ? _safeCount(db.collection(COL.CUADRE).where('plaza', '==', plaza).limit(180).get()) : 0,
    plaza ? _safeCount(db.collection(COL.EXTERNOS).where('plaza', '==', plaza).limit(180).get()) : 0,
    isAdmin ? _safeCount(db.collection('solicitudes').where('estado', '==', 'PENDIENTE').limit(80).get()) : 0,
    plaza ? db.collection(COL.NOTAS).where('plaza', '==', plaza).limit(120).get() : null
  ]);
  const notas = notasSnap?.docs
    ? notasSnap.docs.filter(doc => {
      const estado = String(doc.data()?.estado || '').toUpperCase();
      return estado !== 'RESUELTA' && estado !== 'CERRADA';
    }).length
    : 0;
  _state.metrics = { unidades: cuadre, externos, incidencias: notas, solicitudes };
}

async function _loadPending() {
  if (!_state) return;
  const plaza = String(_state.plaza || '').toUpperCase().trim();
  const pending = { colaNotReady: null, colaTotal: null, msgUnread: null };
  if (plaza) {
    try {
      const snap = await db.collection('cola_preparacion').doc(plaza).collection('items').limit(150).get();
      let notReady = 0;
      snap.forEach(doc => {
        const x = doc.data() || {};
        const c = typeof x.checklist === 'object' ? x.checklist : x;
        const ok = ['lavado', 'gasolina', 'docs', 'revision'].every(k => c[k] === true);
        if (!ok) notReady += 1;
      });
      pending.colaNotReady = notReady;
      pending.colaTotal = snap.size;
    } catch (_) {
      pending.colaNotReady = null;
    }
  }
  try {
    const p = _state.profile || {};
    const handle = String(p.email || p.nombre || p.nombreCompleto || '').trim();
    if (handle) {
      const rows = await obtenerMensajesPrivados(handle.toUpperCase()).catch(() => []);
      const unread = (Array.isArray(rows) ? rows : []).filter(m => !m.leido && !m.esMio).length;
      pending.msgUnread = unread;
    }
  } catch (_) {
    pending.msgUnread = null;
  }
  _state.pending = pending;
}

async function _loadMapPreview() {
  const plaza = String(_state?.plaza || '').toUpperCase().trim();
  const requestId = ++_mapPreviewRequestId;
  _state.mapPreview = {
    loading: true,
    error: '',
    unitCount: 0,
    previewSummary: null,
    mvKeys: [],
    stateItems: []
  };
  _renderMapPreview();
  if (!plaza) {
    _state.mapPreview.loading = false;
    _state.mapPreview.error = 'Selecciona una plaza para cargar el preview del mapa.';
    _renderMapPreview();
    return;
  }
  try {
    const [estructura, datosMapa, flota] = await Promise.all([
      obtenerEstructuraMapa(plaza),
      obtenerDatosParaMapa(plaza),
      obtenerDatosFlotaConsola(plaza).catch(() => [])
    ]);
    if (!_state || requestId !== _mapPreviewRequestId) return;
    const units = Array.isArray(datosMapa?.unidades) ? datosMapa.unidades : [];
    const vm = buildMapaReadOnlyViewModel({
      estructura,
      unidades: units,
      plaza,
      query: ''
    });
    const previewSummary = buildMapaPreviewSummary(vm);
    const states = _buildStatePreviewItems(flota, units);
    _state.mapPreview = {
      loading: false,
      error: '',
      unitCount: units.length,
      previewSummary,
      mvKeys: units
        .slice(0, 160)
        .map(u => String(u.mva || '').trim().toUpperCase())
        .filter(Boolean),
      stateItems: states
    };
  } catch (error) {
    if (!_state || requestId !== _mapPreviewRequestId) return;
    _state.mapPreview = {
      loading: false,
      error: error?.message || 'No se pudo cargar la vista rápida del mapa.',
      unitCount: 0,
      previewSummary: null,
      mvKeys: [],
      stateItems: []
    };
  }
  _renderMapPreview();
}

function _render() {
  _setText('#appDashKpiUnidades', _state.metrics.unidades);
  _setText('#appDashKpiExternos', _state.metrics.externos);
  _setText('#appDashKpiInc', _state.metrics.incidencias);
  _setText('#appDashKpiSol', _state.metrics.solicitudes);
  _setText('#appDashMapPlaza', _state.plaza || '—');
  const pen = _state.pending || {};
  _setText('#appDashPendCola', pen.colaNotReady != null ? String(pen.colaNotReady) : '—');
  _setText('#appDashPendInc', String(_state.metrics.incidencias ?? '—'));
  _setText('#appDashPendMsg', pen.msgUnread != null ? String(pen.msgUnread) : '—');
  _setText('#appDashPendSol', String(_state.metrics.solicitudes ?? '—'));
  const solCard = _container?.querySelector('#appDashPendSolCard');
  if (solCard) solCard.hidden = !_isAdminRole(_state.role);
  _renderMapPreview();
  _applyQuery();
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
  const cards = Array.from(_container?.querySelectorAll('[data-module-text]') || []);
  cards.forEach(card => {
    const txt = String(card.getAttribute('data-module-text') || '');
    const visible = !_state.query || txt.includes(_state.query);
    card.hidden = !visible;
  });
  const pendingCards = Array.from(_container?.querySelectorAll('[data-pending-text]') || []);
  pendingCards.forEach(card => {
    const txt = String(card.getAttribute('data-pending-text') || '');
    const visible = !_state.query || txt.includes(_state.query);
    card.hidden = !visible || (card.id === 'appDashPendSolCard' && !_isAdminRole(_state.role));
  });
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
      q.length >= 2 &&
      keys.some(m => m.includes(q) || q.includes(m));
    hitEl.hidden = !hit;
    hitEl.textContent = hit
      ? `Coincidencia posible en plaza (${q}) — abre el mapa para ubicarla.`
      : '';
  }
}

function _kpi(id, label) {
  return `<div class="appdash__card"><div id="${id}" class="appdash__kpi-v">0</div><div class="appdash__kpi-l">${esc(label)}</div></div>`;
}

function _isAdminRole(role) {
  return ['SUPERVISOR','JEFE_PATIO','GERENTE_PLAZA','JEFE_REGIONAL','CORPORATIVO_USER','JEFE_OPERACION','PROGRAMADOR','VENTAS'].includes(String(role || ''));
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
  try { return localStorage.getItem('mex.debug.mode') === '1'; } catch { return false; }
}

function _setText(selector, value) {
  const el = _container?.querySelector(selector);
  if (el) el.textContent = String(value ?? '');
}

// ── Utilidades ───────────────────────────────────────────────
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function _roleIntro(role) {
  const r = String(role || '').toUpperCase();
  if (r === 'PROGRAMADOR' || r === 'JEFE_OPERACION') return 'Consola completa para monitoreo, diagnóstico y operación segura.';
  if (_isAdminRole(r)) return 'Resumen ejecutivo por plaza: métricas, pendientes y accesos de administración.';
  return 'Vista operativa diaria para mapa, cola, incidencias y mensajes.';
}

function _renderMapPreview() {
  const body = _container?.querySelector('#appDashMapPreviewBody');
  if (!body) return;
  const preview = _state?.mapPreview || {};
  if (preview.loading) {
    body.innerHTML = `<div class="appdash__map-loading">Cargando vista rápida...</div>`;
    return;
  }
  if (preview.error) {
    body.innerHTML = `
      <div class="appdash__map-fallback">
        <p>No se pudo cargar la vista rápida del mapa.</p>
        <small>${esc(preview.error)}</small>
        <a href="/mapa" class="appdash__fallback-link">Abrir mapa completo</a>
      </div>
    `;
    return;
  }
  const s = preview.previewSummary || {};
  const sampleCells = s.sampleCells || [];
  const zoneTotals = s.zoneTotals || [];
  const stList = Array.isArray(preview.stateItems) ? preview.stateItems : [];
  const statesTotal = stList.reduce((acc, item) => acc + item.count, 0);

  body.innerHTML = `
    <div class="appdash__map-kpis">
      <div><strong>${esc(preview.unitCount)}</strong><span>Unidades</span></div>
      <div><strong>${esc(s.slotsTotal ?? 0)}</strong><span>Celdas mapa</span></div>
      <div><strong>${esc(s.occupiedSlots ?? 0)}</strong><span>Ocupadas</span></div>
      <div><strong>${esc(Math.max(0, (s.slotsTotal ?? 0) - (s.occupiedSlots ?? 0)))}</strong><span>Libres</span></div>
    </div>
    <p id="appDashMapSearchHit" class="appdash__map-hit" hidden></p>
    <div class="appdash__map-mini-wrap">
      <div class="appdash__map-mini-label">Celdas con unidad (muestra)</div>
      <div class="appdash__map-mini-grid" role="list">
        ${
          sampleCells.length
            ? sampleCells
                .map(
                  c => `
          <div class="appdash__map-mini-cell" role="listitem">
            <span class="appdash__map-mini-code">${esc(c.label)}</span>
            <span class="appdash__map-mini-zone">${esc(c.zone || '—')}</span>
            <strong>${esc(c.count)}</strong>
          </div>`
                )
                .join('')
            : `<p class="appdash__map-empty">Sin ocupación en celdas o sin estructura cargada.</p>`
        }
      </div>
    </div>
    <div class="appdash__map-grid appdash__map-grid--balanced">
      <div>
        <h3>Unidades por zona (mapa)</h3>
        ${
          zoneTotals.length
            ? `<ul class="appdash__map-zone-list">${zoneTotals
                .map(z => `<li><span>${esc(z.label)}</span><b>${esc(z.count)}</b></li>`)
                .join('')}</ul>`
            : `<p class="appdash__map-empty">Sin datos de zona.</p>`
        }
        <div class="appdash__map-bucket-hint">
          Limbo: <strong>${esc(s.limboCount ?? 0)}</strong> · Taller: <strong>${esc(s.tallerCount ?? 0)}</strong> · Sin celda: <strong>${esc(s.orphanCount ?? 0)}</strong>
        </div>
      </div>
      <div>
        <h3>Estados operativos</h3>
        ${
          stList.length
            ? `<ul>${stList.map(item => `<li><span>${esc(item.label)}</span><b>${esc(item.count)}</b></li>`).join('')}</ul>`
            : `<p class="appdash__map-empty">Sin estados disponibles.</p>`
        }
        <div class="appdash__map-bucket-hint">Total clasificados: <strong>${esc(statesTotal)}</strong></div>
      </div>
    </div>
    <a id="appDashSearchMapAction" hidden href="/app/mapa" data-app-route="/app/mapa" class="appdash__map-search-action appdash__pill-link">Buscar en mapa</a>
  `;
  _applyQuery();
}

function _buildStatePreviewItems(flota, units) {
  const src = Array.isArray(flota) && flota.length ? flota : (Array.isArray(units) ? units : []);
  const counts = new Map();
  src.forEach(unit => {
    const raw = String(unit?.estado || '').trim().toUpperCase();
    const state = raw || 'SIN ESTADO';
    counts.set(state, (counts.get(state) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, count]) => ({ label, count }));
}
