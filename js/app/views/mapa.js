// ═══════════════════════════════════════════════════════════
//  App Shell — Mapa nativo
//  Sin iframe, sin cargar mapa.html, sin importar js/views/mapa.js.
// ═══════════════════════════════════════════════════════════

import { getState, onPlazaChange } from '/js/app/app-state.js';
import { createMapaLifecycleController } from '/js/app/features/mapa/mapa-lifecycle.js';
import { createMapaIncidenciasSummaryController } from '/js/app/features/mapa/mapa-incidencias-summary.js';
import { createMapaDndController } from '/js/app/features/mapa/mapa-dnd.js';
import { persistUnitMove, persistUnitSwap, validatePersistMove } from '/js/app/features/mapa/mapa-mutations.js';
import { getResolvedMapaSelection, renderErrorState, renderMapaReadOnly } from '/js/app/features/mapa/mapa-renderer.js';

const LEGACY_STAGE_ID = 'mex-legacy-mapa-stage';
const FILTERS = [
  ['all', 'Todo'],
  ['disponibles', 'Listos'],
  ['mantenimiento', 'Manto'],
  ['taller', 'Taller'],
  ['limbo', 'Limbo'],
  ['externos', 'Externos'],
  ['con-incidencias', 'Incidencias'],
  ['criticas', 'Críticas'],
];

let _ctx = null;
let _container = null;
let _shell = null;
let _lifecycle = null;
let _incidencias = null;
let _dnd = null;
let _offPlaza = null;
let _offSearch = null;
let _state = null;
let _renderQueued = false;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function up(value) {
  return String(value || '').trim().toUpperCase();
}

function ensureCss() {
  if (document.querySelector('link[data-app-mapa-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-mapa.css';
  link.setAttribute('data-app-mapa-css', '1');
  document.head.appendChild(link);
}

function removeLegacyStage() {
  const stage = document.getElementById(LEGACY_STAGE_ID);
  if (stage) stage.remove();
  window.dispatchEvent(new CustomEvent('mex:mapa-stage-hidden'));
}

function parseUrlState() {
  const url = new URL(window.location.href);
  return {
    query: String(url.searchParams.get('query') || url.searchParams.get('q') || '').trim(),
    filter: String(url.searchParams.get('filter') || 'all').trim().toLowerCase() || 'all',
    viewMode: String(url.searchParams.get('view') || 'map').trim().toLowerCase() === 'list' ? 'list' : 'map',
    selectedId: String(url.searchParams.get('mva') || '').trim().toUpperCase(),
  };
}

function syncUrl({ replace = true } = {}) {
  if (!_state) return;
  const params = new URLSearchParams();
  if (_state.query) params.set('query', _state.query);
  if (_state.quickFilter && _state.quickFilter !== 'all') params.set('filter', _state.quickFilter);
  if (_state.viewMode === 'list') params.set('view', 'list');
  if (_state.selectedId) params.set('mva', _state.selectedId);
  const next = `/app/mapa${params.toString() ? `?${params}` : ''}`;
  if (replace) history.replaceState({}, '', next);
  else history.pushState({}, '', next);
}

function canMove() {
  const role = up(getState().role);
  return ['PROGRAMADOR', 'JEFE_PATIO', 'GERENTE_PLAZA', 'JEFE_REGIONAL', 'SUPERVISOR'].includes(role);
}

function actorName() {
  const state = getState();
  const profile = state.profile || {};
  return profile.nombre || profile.nombreCompleto || profile.email || state.user?.email || 'Sistema';
}

function toast(message, type = 'info') {
  const text = String(message || '').trim();
  if (!text) return;
  if (typeof window.mexToast === 'function') {
    window.mexToast(text, type);
    return;
  }
  console[type === 'error' ? 'error' : 'log'](`[mapa] ${text}`);
}

function setQuery(query, { replace = true } = {}) {
  _state.query = String(query || '').trim();
  _ctx?.shell?.setSearchValue?.(_state.query);
  syncUrl({ replace });
  queueRender();
}

function setSelected(id, { replace = false } = {}) {
  _state.selectedId = up(id);
  syncUrl({ replace });
  queueRender();
}

function setFilter(filter) {
  _state.quickFilter = FILTERS.some(([id]) => id === filter) ? filter : 'all';
  syncUrl({ replace: false });
  queueRender();
}

function setViewMode(viewMode) {
  _state.viewMode = viewMode === 'list' ? 'list' : 'map';
  syncUrl({ replace: false });
  queueRender();
}

function toggleHeatmap() {
  _state.heatmap = !_state.heatmap;
  document.body.classList.toggle('heatmap-active', _state.heatmap);
  syncHeaderActions();
}

function toggleDnd() {
  _state.dndActive = !_state.dndActive;
  if (_state.dndActive) _dnd?.enable?.();
  else _dnd?.disable?.();
  syncHeaderActions();
  queueRender();
}

function toggleDrawer(force = null) {
  _state.drawerOpen = typeof force === 'boolean' ? force : !_state.drawerOpen;
  syncHeaderActions();
  queueRender();
}

function buildHeaderActions() {
  const wrap = document.createElement('div');
  wrap.className = 'mex-hdr-mapa-actions';
  wrap.innerHTML = `
    <button class="mex-header-icon-btn mex-hdr-mapa-btn" data-mapa-hdr="units" title="Unidades sin cajón" aria-label="Unidades sin cajón">
      <span class="mex-hdr-icon">directions_car</span>
    </button>
    <button class="mex-header-icon-btn mex-hdr-mapa-btn" data-mapa-hdr="view" title="Cambiar vista" aria-label="Cambiar vista">
      <span class="mex-hdr-icon">view_list</span>
    </button>
    <button class="mex-header-icon-btn mex-hdr-mapa-btn" data-mapa-hdr="dnd" title="Mover unidades" aria-label="Mover unidades">
      <span class="mex-hdr-icon">open_with</span>
    </button>
    <button class="mex-header-icon-btn mex-hdr-mapa-btn mex-hdr-mapa-btn--heat" data-mapa-hdr="heat" title="Mapa de calor" aria-label="Mapa de calor">
      <span class="mex-hdr-icon">thermostat</span>
    </button>
  `;
  wrap.addEventListener('click', event => {
    const btn = event.target?.closest?.('[data-mapa-hdr]');
    if (!btn) return;
    const act = btn.dataset.mapaHdr;
    if (act === 'units') toggleDrawer();
    if (act === 'view') setViewMode(_state.viewMode === 'list' ? 'map' : 'list');
    if (act === 'dnd') toggleDnd();
    if (act === 'heat') toggleHeatmap();
  });
  return wrap;
}

function syncHeaderActions() {
  const root = document.querySelector('.mex-hdr-mapa-actions');
  if (!root || !_state) return;
  const viewIcon = root.querySelector('[data-mapa-hdr="view"] .mex-hdr-icon');
  if (viewIcon) viewIcon.textContent = _state.viewMode === 'list' ? 'map' : 'view_list';
  root.querySelector('[data-mapa-hdr="dnd"]')?.classList.toggle('is-active', _state.dndActive);
  root.querySelector('[data-mapa-hdr="heat"]')?.classList.toggle('is-active', _state.heatmap);
}

function queueRender() {
  if (!_container || !_state || _renderQueued) return;
  _renderQueued = true;
  queueMicrotask(() => {
    _renderQueued = false;
    render();
  });
}

function renderToolbar() {
  const filterButtons = FILTERS.map(([id, label]) => `
    <button type="button" class="app-mapa-shell-chip ${_state.quickFilter === id ? 'is-active' : ''}" data-mapa-filter="${esc(id)}">
      ${esc(label)}
    </button>
  `).join('');
  return `
    <div class="app-mapa-shell-toolbar">
      <div class="app-mapa-shell-chips">${filterButtons}</div>
      <div class="app-mapa-shell-view-toggle">
        <button type="button" class="app-mapa-shell-chip ${_state.viewMode === 'map' ? 'is-active' : ''}" data-mapa-view="map">Mapa</button>
        <button type="button" class="app-mapa-shell-chip ${_state.viewMode === 'list' ? 'is-active' : ''}" data-mapa-view="list">Lista</button>
      </div>
    </div>
  `;
}

function renderShell() {
  const snap = _state.snapshot || {};
  const loading = snap.loading && !(snap.units || []).length && !(snap.structure || []).length;
  return `
    <section id="app-mapa-content" class="app-mapa-view app-mapa-operativo">
      ${renderToolbar()}
      <div class="app-mapa-content" id="appMapaNativeStage">
        ${loading ? `
          <div class="app-mapa-status is-loading">
            <div class="app-mapa-loading-shell">
              <span class="app-mapa-loading-spinner"></span>
              <strong>Cargando mapa operativo</strong>
              <small>${esc(_state.plaza || 'Sin plaza')}</small>
            </div>
          </div>` : ''}
      </div>
      <div class="app-mapa-dnd-hint" ${_state.dndActive ? '' : 'hidden'}>
        Movimiento activo. Arrastra una unidad a un cajón para guardar la posición.
      </div>
    </section>
  `;
}

function render() {
  if (!_container || !_state) return;
  removeLegacyStage();
  _container.classList.add('mapa-view-active');
  _container.innerHTML = renderShell();

  const stage = _container.querySelector('#appMapaNativeStage');
  const snap = _state.snapshot || {};
  const error = snap.error || _state.inc.error || '';
  if (error && !(snap.units || []).length && !(snap.structure || []).length) {
    stage.innerHTML = renderErrorState(error, { legacyCta: false });
  } else if (!snap.loading || (snap.units || []).length || (snap.structure || []).length) {
    const selected = getResolvedMapaSelection(snap, {
      selectedId: _state.selectedId,
      query: _state.query,
      quickFilter: _state.quickFilter,
      incidentsByMva: _state.inc.byMva,
      incidentsReady: !_state.inc.loading,
      incidentsFailed: Boolean(_state.inc.error)
    });
    if (_state.selectedId && !selected) _state.selectedId = '';
    const result = renderMapaReadOnly(stage, snap, {
      selectedId: _state.selectedId,
      query: _state.query,
      quickFilter: _state.quickFilter,
      viewMode: _state.viewMode,
      dndActive: _state.dndActive,
      incidentsByMva: _state.inc.byMva,
      incidentsReady: !_state.inc.loading,
      incidentsFailed: Boolean(_state.inc.error),
      unitActions: { secureActions: [] }
    });
    if (result?.unidadesData?.html) {
      stage.insertAdjacentHTML('beforeend', result.unidadesData.html);
      const drawer = stage.querySelector('#app-mapa-units-drawer');
      if (drawer) drawer.hidden = !_state.drawerOpen;
    }
  }

  applyZoom();
  bindDomEvents();
  _dnd?.mount?.(_container);
  if (_state.dndActive) _dnd?.enable?.();
  else _dnd?.disable?.();
  syncHeaderActions();
}

function applyZoom() {
  const grid = _container?.querySelector('#app-mapa-legacy-grid');
  if (!grid) return;
  const zoom = Math.max(0.5, Math.min(1.8, Number(_state.zoom) || 1));
  grid.style.transformOrigin = 'top left';
  grid.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
}

function bindDomEvents() {
  _container.querySelectorAll('[data-mapa-filter]').forEach(btn => {
    btn.addEventListener('click', () => setFilter(btn.dataset.mapaFilter || 'all'));
  });
  _container.querySelectorAll('[data-mapa-view]').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.mapaView || 'map'));
  });
  _container.querySelectorAll('[data-unit-id], [data-mva]').forEach(el => {
    el.addEventListener('click', event => {
      if (_dnd?.shouldSuppressClick?.()) return;
      const mva = up(el.getAttribute('data-mva') || '');
      const id = up(mva || el.getAttribute('data-unit-id') || '');
      if (!id) return;
      event.preventDefault();
      setSelected(id, { replace: false });
    });
  });
  _container.querySelectorAll('[data-app-mapa-action="clear-search"]').forEach(btn => {
    btn.addEventListener('click', () => setQuery('', { replace: false }));
  });
  _container.querySelectorAll('[data-app-mapa-zoom]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.appMapaZoom === 'in' ? 0.1 : -0.1;
      _state.zoom = Math.max(0.5, Math.min(1.8, Number(_state.zoom || 1) + dir));
      applyZoom();
    });
  });
  _container.querySelectorAll('[data-mapa-drawer-close]').forEach(el => {
    el.addEventListener('click', () => toggleDrawer(false));
  });
  _container.querySelectorAll('[data-copy-mva]').forEach(btn => {
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const mva = String(btn.dataset.copyMva || '').trim();
      navigator.clipboard?.writeText(mva).then(() => toast(`MVA copiado: ${mva}`)).catch(() => {});
    });
  });
  _container.querySelectorAll('[data-app-mapa-detail="create-incident"], a[href^="/app/incidencias"]').forEach(el => {
    el.addEventListener('click', event => {
      const mva = _state.selectedId || up(el.closest('[data-mva]')?.getAttribute('data-mva'));
      if (!mva) return;
      event.preventDefault();
      event.stopPropagation();
      _ctx?.navigate?.(`/app/incidencias?mva=${encodeURIComponent(mva)}`);
    });
  });
  _container.querySelectorAll('[data-app-mapa-detail="close-panel"]').forEach(btn => {
    btn.addEventListener('click', () => setSelected('', { replace: false }));
  });
}

async function persistDrop({ fromCtx, toCtx, originKey, destKey, snapshot }) {
  const plaza = _state.plaza;
  const validation = validatePersistMove({
    snapshot,
    mva: fromCtx?.mva,
    originKey,
    destKey,
    plaza
  }, {
    roleAllowed: canMove(),
    persistFlagsOk: true,
    allowOccupied: true
  });
  if (!validation.ok) return { outcome: 'error', message: validation.message };

  const occupant = up(toCtx?.occupantMva || '');
  const actor = actorName();
  let result = null;
  if (occupant && occupant !== up(fromCtx?.mva)) {
    result = await persistUnitSwap({
      plaza,
      usuario: actor,
      movingMva: fromCtx.mva,
      movingPos: destKey,
      occupantMva: occupant,
      occupantPos: originKey,
      extra: { source: 'app_mapa_native_dnd' }
    });
  } else {
    result = await persistUnitMove({
      plaza,
      usuario: actor,
      mva: fromCtx.mva,
      posNueva: destKey,
      extra: { source: 'app_mapa_native_dnd' }
    });
  }
  if (!result?.success) return { outcome: 'error', message: result?.error || 'No se pudo guardar movimiento.' };
  _lifecycle?.resyncData?.();
  return { outcome: 'persist', message: `${up(fromCtx.mva)} guardado en ${up(destKey)}.` };
}

function startControllers() {
  _lifecycle = createMapaLifecycleController({
    plaza: _state.plaza,
    api: window.api,
    onData(snapshot) {
      _state.snapshot = snapshot || {};
      queueRender();
    },
    onError(error) {
      _state.snapshot = { ...(_state.snapshot || {}), loading: false, error: error?.message || 'Error al cargar mapa.' };
      queueRender();
    }
  });
  _lifecycle.mount();

  _incidencias = createMapaIncidenciasSummaryController({
    plaza: _state.plaza,
    api: window.api,
    onSummary(snapshot) {
      _state.inc = snapshot || _state.inc;
      queueRender();
    },
    onError(error) {
      _state.inc = { ..._state.inc, loading: false, error: error?.message || 'Error al cargar incidencias.' };
      queueRender();
    }
  });
  _incidencias.subscribe();

  _dnd = createMapaDndController({
    getSnapshot: () => _state.snapshot,
    canMove,
    getPersistAllowed: () => _state.dndActive && canMove(),
    onPersistDrop: persistDrop,
    onMovePreview(payload) {
      if (payload?.message) toast(payload.message, payload.outcome === 'error' ? 'error' : 'info');
    }
  });
}

function setPlaza(plaza) {
  const next = up(plaza);
  if (!next || next === _state.plaza) return;
  _state.plaza = next;
  _state.selectedId = '';
  _state.snapshot = { plaza: next, loading: true, units: [], structure: [], error: '' };
  _state.inc = { plaza: next, loading: true, byMva: {}, error: '' };
  _lifecycle?.setPlaza?.(next);
  _incidencias?.setPlaza?.(next);
  queueRender();
}

export async function mount(ctx = {}) {
  unmount();
  ensureCss();
  removeLegacyStage();
  _ctx = ctx;
  _container = ctx.container;
  _shell = ctx.shell || null;
  if (!_container) return;

  const appState = getState();
  const routeState = parseUrlState();
  _state = {
    plaza: up(appState.currentPlaza || window.getMexCurrentPlaza?.() || ''),
    snapshot: { plaza: up(appState.currentPlaza || ''), loading: true, units: [], structure: [], error: '' },
    inc: { plaza: up(appState.currentPlaza || ''), loading: true, byMva: {}, error: '' },
    query: routeState.query,
    quickFilter: FILTERS.some(([id]) => id === routeState.filter) ? routeState.filter : 'all',
    viewMode: routeState.viewMode,
    selectedId: routeState.selectedId,
    dndActive: false,
    drawerOpen: false,
    heatmap: document.body.classList.contains('heatmap-active'),
    zoom: 1
  };

  _container.classList.add('mapa-view-active');
  _shell?.setCustomActions?.(buildHeaderActions());
  _ctx?.shell?.setSearchValue?.(_state.query);
  render();
  startControllers();

  _offPlaza = onPlazaChange(setPlaza);
  const searchHandler = event => {
    const route = String(event?.detail?.route || '');
    if (route && route !== '/app/mapa' && route !== '/mapa') return;
    setQuery(event?.detail?.query || '', { replace: true });
  };
  window.addEventListener('mex:global-search', searchHandler);
  _offSearch = () => window.removeEventListener('mex:global-search', searchHandler);
}

export function unmount() {
  try { _dnd?.unmount?.(); } catch (_) {}
  try { _lifecycle?.unmount?.(); } catch (_) {}
  try { _incidencias?.cleanup?.(); } catch (_) {}
  try { _offPlaza?.(); } catch (_) {}
  try { _offSearch?.(); } catch (_) {}
  if (_container) {
    _container.classList.remove('mapa-view-active');
    _container.innerHTML = '';
  }
  _shell?.setCustomActions?.('');
  removeLegacyStage();
  _dnd = null;
  _lifecycle = null;
  _incidencias = null;
  _offPlaza = null;
  _offSearch = null;
  _ctx = null;
  _container = null;
  _shell = null;
  _state = null;
  _renderQueued = false;
}
