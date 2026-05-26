import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { subscribeCuadre } from '/js/app/features/cuadre/cuadre-data.js';
import { obtenerCuadreAdminsData, obtenerHistorialCuadres, obtenerUnidadesVeloz } from '/js/core/database.js';

let _container = null;
let _state = null;
let _unsubData = null;
let _unsubPlaza = null;
let _offGlobalSearch = null;
let _cssLink = null;
let _unitActionsController = null;
let _unitActionsLoadPromise = null;

function _trackListener(action, name, extra = {}) {
  if (typeof window.__mexTrackListener !== 'function') return;
  window.__mexTrackListener(window.location.pathname, `app/cuadre:${name}`, action, extra);
}

const q = selector => _container?.querySelector(selector) ?? null;
const qsa = selector => Array.from(_container?.querySelectorAll(selector) ?? []);

const ESTADO_ORDER = { LISTO: 1, SUCIO: 2, MANTENIMIENTO: 3, RESGUARDO: 4, TRASLADO: 5, 'NO ARRENDABLE': 6, RETENIDA: 7, VENTA: 8, HYP: 9, 'EN RENTA': 10, EXTERNO: 11 };
const ESTADO_COLOR = { LISTO: '#16a34a', SUCIO: '#d97706', MANTENIMIENTO: '#dc2626', TRASLADO: '#7c3aed', RESGUARDO: '#475569', EXTERNO: '#6d28d9' };
const SAFE_ESTADOS = ['LISTO', 'SUCIO', 'MANTENIMIENTO', 'RESGUARDO', 'TRASLADO', 'NO ARRENDABLE', 'RETENIDA', 'VENTA', 'HYP', 'EN RENTA'];
const GAS_OPTIONS = ['N/A','F','15/16','7/8','13/16','3/4','11/16','5/8','9/16','H','7/16','3/8','5/16','1/4','3/16','1/8','1/16','E'];
const TABLE_COLSPAN = 7;
const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'sucio', label: '🧹 SUCIO' },
  { id: 'listo', label: '✅ LISTO' },
  { id: 'mantenimiento', label: '🔧 MANT.' },
  { id: 'traslado', label: '🚛 TRASLADO' },
  { id: 'doble-cero', label: '🌿 DOBLE CERO' },
  { id: 'apartado', label: '🔒 APARTADOS' },
  { id: 'urgente', label: '⚡ URGENTE' },
  { id: 'resguardo', label: '👀 RESGUARDO' },
  { id: 'taller', label: '🏭 TALLER' },
  { id: 'externos', label: 'Externos' },
  { id: 'sin-ubicacion', label: 'Sin ubicación' }
];

function _makeState(plaza) {
  return {
    plaza,
    allItems: [],
    adminsItems: [],
    historyItems: [],
    items: [],
    filter: 'all',
    query: '',
    sortField: 'estado',
    sortDir: 'asc',
    selectedId: null,
    navigate: null,
    tab: 'regular',
    historyDate: '',
    categoryFilter: '',
    modeloFilter: '',
    locationFilter: '',
    statusFilter: '',
    originFilter: '',
    masterSearchQuery: '',
    masterSearchResults: [],
    lastUpdated: 0,
    actionStatus: null,
    pendingAction: null,
    staleVersion: 0
  };
}

export async function mount(ctx) {
  _cleanup();
  _container = ctx.container;
  _state = _makeState(String(getCurrentPlaza() || ctx?.state?.currentPlaza || '').toUpperCase().trim());
  _trackListener('create', 'view', { plaza: _state.plaza });
  _state.navigate = ctx.navigate;
  _ensureCss();
  const gs = getState();
  _container.innerHTML = _layout({
    plaza: _state.plaza,
    role: gs.role || 'AUXILIAR',
    user: gs.profile?.nombreCompleto || gs.profile?.nombre || gs.profile?.email || 'Usuario'
  });
  _bindEvents();
  _bindGlobalSearch();
  void _loadUnitActionsController();
  _toggleHistoryDateFilter();
  _renderMasterSearchResults();
  _unsubPlaza = onPlazaChange(next => _reloadForPlaza(next));
  _trackListener('create', 'plaza-sub');
  if (!_state.plaza) return _renderNoPlaza();
  _startListener(_state.plaza);
}

export function unmount() { _cleanup(); }

function _cleanup() {
  if (typeof _unsubData === 'function') { try { _unsubData(); } catch (err) { console.warn('[app/cuadre] cleanup data', err); } _trackListener('cleanup', 'data-sub'); }
  if (typeof _unsubPlaza === 'function') { try { _unsubPlaza(); } catch (err) { console.warn('[app/cuadre] cleanup plaza', err); } _trackListener('cleanup', 'plaza-sub'); }
  if (typeof _offGlobalSearch === 'function') { try { _offGlobalSearch(); } catch (err) { console.warn('[app/cuadre] cleanup search', err); } }
  _removeCuadreModals();
  try { _unitActionsController?.cleanup?.(); } catch (err) { console.warn('[app/cuadre] cleanup actions', err); }
  _unsubData = null;
  _unsubPlaza = null;
  _offGlobalSearch = null;
  _unitActionsController = null;
  _unitActionsLoadPromise = null;
  // Mantener CSS ya inyectado evita FOUC al volver a /app/cuadre.
  _cssLink = document.querySelector('link[data-cqv-css="1"]');
  _container = null;
  _state = null;
  _trackListener('cleanup', 'view');
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_state || !_container) return;
    const detailRoute = String(event?.detail?.route || '');
    if (!(detailRoute.startsWith('/app/cuadre') || detailRoute === '/cuadre')) return;
    const query = String(event?.detail?.query || '');
    _state.query = query;
    const searchEl = q('#cqvSearch');
    if (searchEl) searchEl.value = query;
    _applyFiltersAndSort();
    _renderSummary();
    _renderTable();
    _syncDetail();
  };
  window.addEventListener('mex:global-search', handler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', handler);
}

function _ensureCss() {
  if (_cssLink) return;
  const existing = document.querySelector('link[data-cqv-css="1"]');
  if (existing) { _cssLink = existing; return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-cuadre.css';
  link.dataset.cqvCss = '1';
  document.head.appendChild(link);
  _cssLink = link;
}

async function _loadUnitActionsController() {
  if (_unitActionsController) return _unitActionsController;
  if (_unitActionsLoadPromise) return _unitActionsLoadPromise;
  _unitActionsLoadPromise = import('/js/app/features/mapa/mapa-unit-actions.js')
    .then(mod => {
      const factory = mod.createMapaUnitActionsController || mod.createUnitActionsController || mod.createController;
      if (typeof factory !== 'function') throw new Error('Controller de acciones no disponible.');
      _unitActionsController = factory({
        api: window.api || {},
        getState,
        getCurrentPlaza: () => _state?.plaza || getCurrentPlaza(),
        getCurrentUser: () => getState()?.profile || getState()?.user || null,
        profile: () => getState()?.profile || {}
      });
      return _unitActionsController;
    })
    .catch(err => {
      _unitActionsController = null;
      _showActionMessage(err?.message || 'No se pudo cargar el controlador de acciones.', 'error');
      return null;
    });
  return _unitActionsLoadPromise;
}

function _reloadForPlaza(nextPlaza) {
  if (!_state || !_container) return;
  const normalized = String(nextPlaza || '').toUpperCase().trim();
  if (normalized === _state.plaza) return;
  _removeCuadreModals();
  _state.plaza = normalized;
  _state.allItems = [];
  _state.adminsItems = [];
  _state.historyItems = [];
  _state.items = [];
  _state.selectedId = null;
  _state.pendingAction = null;
  _state.actionStatus = null;
  _state.lastUpdated = 0;
  _setText('#cqvPlaza', normalized || '—');
  _renderLastSync();
  _showActionMessage('', '');
  _renderSummary();
  _renderTableSkeleton();
  _renderDetail(null);
  if (!normalized) {
    _stopListener();
    _renderNoPlaza();
    return;
  }
  _startListener(normalized);
}

function _stopListener() {
  if (typeof _unsubData === 'function') { try { _unsubData(); } catch (err) { console.warn('[app/cuadre] cleanup data', err); } _trackListener('cleanup', 'data-sub'); }
  _unsubData = null;
}

function _startListener(plaza) {
  _stopListener();
  const version = (_state.staleVersion || 0) + 1;
  _state.staleVersion = version;
  _renderTableSkeleton();
  _unsubData = subscribeCuadre({
    plaza,
    onData: rows => {
      if (!_state || !_container || _state.staleVersion !== version) return;
      _state.allItems = Array.isArray(rows) ? rows : [];
      _state.lastUpdated = Date.now();
      _applyFiltersAndSort();
      _renderSummary();
      _renderLastSync();
      _renderTable();
      _syncDetail();
    },
    onError: err => {
      if (!_state || !_container || _state.staleVersion !== version) return;
      _renderTableError(String(err?.code || '').includes('permission') ? 'Sin permisos para ver cuadre de esta plaza.' : (err?.message || 'Error al cargar cuadre.'));
    }
  });
  _trackListener('create', 'data-sub', { plaza });
}

function _bindEvents() {
  // Inline search
  q('#cqvSearch')?.addEventListener('input', e => {
    _state.query = String(e.target?.value || '').trim();
    _applyFiltersAndSort();
    _renderSummary();
    _renderTable();
    _syncDetail();
  });
  // Clear all filters
  q('#cqvClearFilters')?.addEventListener('click', () => {
    _state.query = '';
    _state.filter = 'all';
    _state.categoryFilter = '';
    _state.modeloFilter = '';
    _state.locationFilter = '';
    _state.statusFilter = '';
    const searchEl = q('#cqvSearch');
    if (searchEl) searchEl.value = '';
    qsa('[data-cqv-filter]').forEach(x => x.classList.toggle('is-active', x.dataset.cqvFilter === 'all'));
    ['#filter-cat', '#filter-modelo', '#filter-est', '#filter-ubi'].forEach(sel => {
      const el = q(sel);
      if (el) el.value = '';
    });
    _applyFiltersAndSort();
    _renderSummary();
    _renderTable();
    _syncDetail();
  });
  // Tabs
  qsa('[data-cqv-tab]').forEach(btn => btn.addEventListener('click', () => {
    _state.tab = btn.dataset.cqvTab || 'regular';
    qsa('[data-cqv-tab]').forEach(x => x.classList.toggle('is-active', x === btn));
    void _loadSecondaryTabData();
    _applyFiltersAndSort();
    _renderSummary();
    _renderTable();
    _syncDetail();
  }));
  // Filter chips
  qsa('[data-cqv-filter]').forEach(chip => chip.addEventListener('click', () => {
    _state.filter = chip.dataset.cqvFilter || 'all';
    qsa('[data-cqv-filter]').forEach(x => x.classList.toggle('is-active', x === chip));
    _applyFiltersAndSort();
    _renderSummary();
    _renderTable();
    _syncDetail();
  }));
  // Sortable column headers (event delegation on table)
  q('.cqv__table')?.addEventListener('click', e => {
    const th = e.target.closest('[data-cqv-sort]');
    if (!th) return;
    const field = th.dataset.cqvSort || 'mva';
    if (_state.sortField === field) {
      _state.sortDir = _state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      _state.sortField = field;
      _state.sortDir = 'asc';
    }
    _applyFiltersAndSort();
    _renderTable();
    _syncDetail();
  });
  // Excel-style column filter selects
  q('.cqv__table')?.addEventListener('change', e => {
    const sel = e.target.closest('[data-cqv-col-filter]');
    if (!sel) return;
    const field = sel.dataset.cqvColFilter;
    const val = String(sel.value || '').trim();
    if (field === 'categoria') _state.categoryFilter = val;
    else if (field === 'modelo') _state.modeloFilter = val;
    else if (field === 'estado') _state.statusFilter = val.toUpperCase();
    else if (field === 'ubicacion') _state.locationFilter = val;
    _applyFiltersAndSort();
    _renderTable();
    _syncDetail();
  });
  // MÁS CONTROLES toggle
  q('#cqvToggleMasControles')?.addEventListener('click', e => {
    e.stopPropagation();
    const menu = q('#cqvMasControlesMenu');
    if (menu) menu.hidden = !menu.hidden;
    const adminMenu = q('#cqvAdminMenu');
    if (adminMenu) adminMenu.hidden = true;
  });
  // GESTIÓN ADMIN toggle
  q('#cqvToggleAdmin')?.addEventListener('click', e => {
    e.stopPropagation();
    const menu = q('#cqvAdminMenu');
    if (menu) menu.hidden = !menu.hidden;
    const masMenu = q('#cqvMasControlesMenu');
    if (masMenu) masMenu.hidden = true;
  });
  // Dropdown item actions
  _container.addEventListener('click', e => {
    const item = e.target.closest('[data-cqv-ctrl]');
    if (!item) return;
    const ctrl = item.dataset.cqvCtrl;
    qsa('.cqv__dropdown').forEach(d => { d.hidden = true; });
    if (ctrl === 'export-csv') _exportFilteredCsv();
    else if (ctrl === 'copy-summary') void _copyFilteredSummary();
    else if (ctrl === 'refresh' && _state?.plaza) _startListener(_state.plaza);
    else if (ctrl === 'insert-unit') _showInsertUnitModal();
    else if (ctrl === 'insert-externo') _showInsertExternoModal();
  });
  // Batch apply
  q('#cqvBatchApply')?.addEventListener('click', () => void _executeBatchAction());
  // Floating add button
  q('#cqvFab')?.addEventListener('click', () => _showInsertUnitModal());
  // Detail panel action buttons (delegated)
  q('#cqvDetail')?.addEventListener('click', e => {
    const actionBtn = e.target.closest('[data-cqv-action]');
    if (!actionBtn) return;
    const unit = _selectedUnit();
    if (!unit) return;
    e.preventDefault();
    void _openActionModal(String(actionBtn.dataset.cqvAction || ''), unit);
  });
}

function _matchFilter(item) {
  if (_state.tab === 'admins' || _state.tab === 'historial') return true;
  const f = _state.filter;
  const est = String(item.estado || '').toUpperCase();
  if (f === 'all') return true;
  if (f === 'resguardo') return est === 'RESGUARDO';
  if (f === 'doble-cero') return /doble\s*cero|00/i.test(item.notas || '');
  if (f === 'apartado') return /apartad/i.test(item.notas || '');
  if (f === 'urgente') return /urgent|⚠|prior/i.test(item.notas || '');
  if (f === 'listo') return est === 'LISTO';
  if (f === 'no-arrendable') return est.includes('NO ARREND');
  if (f === 'mantenimiento') return est === 'MANTENIMIENTO';
  if (f === 'sucio') return est === 'SUCIO';
  if (f === 'traslado') return est === 'TRASLADO';
  if (f === 'taller') return String(item.ubicacion || '').toUpperCase().includes('TALLER');
  if (f === 'externos') return String(item.tipo || '').toLowerCase() === 'externo' || String(item.ubicacion || '').toUpperCase().includes('EXTERNO');
  if (f === 'sin-ubicacion') return !String(item.ubicacion || '').trim();
  if (_state.tab === 'externos') return String(item.tipo || '').toLowerCase() === 'externo' || String(item.ubicacion || '').toUpperCase().includes('EXTERNO');
  return true;
}

function _applyFiltersAndSort() {
  const query = _state.query.toLowerCase().trim();
  let base = _state.allItems;
  if (_state.tab === 'externos') {
    base = _state.allItems.filter(item => String(item.tipo || '').toLowerCase() === 'externo' || String(item.ubicacion || '').toUpperCase().includes('EXTERNO'));
  } else if (_state.tab === 'admins') {
    base = _state.adminsItems;
  } else if (_state.tab === 'historial') {
    base = _state.historyItems;
    const date = String(_state.historyDate || '');
    if (date) {
      base = base.filter(item => {
        const parsed = _parseDate(item.updatedAt || item.fechaIngreso || item.fecha);
        if (!parsed) return false;
        const iso = new Date(parsed).toISOString().slice(0, 10);
        return iso === date;
      });
    }
  }
  let items = base.filter(_matchFilter);
  if (_state.statusFilter) {
    items = items.filter(it => String(it.estado || '').toUpperCase() === _state.statusFilter);
  }
  if (_state.originFilter) {
    items = items.filter(it => {
      const origin = String(it.tipo || '').toUpperCase();
      const ubic = String(it.ubicacion || '').toUpperCase();
      const normalized = (origin === 'EXTERNO' || ubic.includes('EXTERNO')) ? 'EXTERNO' : 'PATIO';
      return normalized === _state.originFilter;
    });
  }
  if (_state.categoryFilter) {
    items = items.filter(it => String(it.categoria || '').toUpperCase() === _state.categoryFilter.toUpperCase());
  }
  if (_state.locationFilter) {
    items = items.filter(it => String(it.ubicacion || '').toUpperCase() === _state.locationFilter.toUpperCase());
  }
  if (_state.modeloFilter) {
    items = items.filter(it => String(it.modelo || '').toLowerCase().includes(_state.modeloFilter.toLowerCase()));
  }
  if (query) {
    items = items.filter(it =>
      String(it.mva || '').toLowerCase().includes(query) ||
      String(it.modelo || '').toLowerCase().includes(query) ||
      String(it.estado || '').toLowerCase().includes(query) ||
      String(it.ubicacion || '').toLowerCase().includes(query) ||
      String(it.notas || '').toLowerCase().includes(query) ||
      String(it.placas || '').toLowerCase().includes(query)
    );
  }
  items.sort((a, b) => {
    const dir = _state.sortDir === 'asc' ? 1 : -1;
    if (_state.sortField === 'mva') return dir * String(a.mva || '').localeCompare(String(b.mva || ''));
    if (_state.sortField === 'estado') {
      const ao = ESTADO_ORDER[a.estado] ?? 99;
      const bo = ESTADO_ORDER[b.estado] ?? 99;
      if (ao !== bo) return dir * (ao - bo);
      return String(a.mva || '').localeCompare(String(b.mva || ''));
    }
    const ad = _parseDate(a.updatedAt || a.fechaIngreso);
    const bd = _parseDate(b.updatedAt || b.fechaIngreso);
    if (ad !== bd) return dir * (ad - bd);
    return String(a.mva || '').localeCompare(String(b.mva || ''));
  });
  _state.items = items;
  _renderDynamicFilters(base);
  _updateBatchBar();
}

async function _loadSecondaryTabData() {
  if (!_state?.plaza) return;
  if (_state.tab === 'admins' && !_state.adminsItems.length) {
    try {
      const rows = await obtenerCuadreAdminsData(_state.plaza);
      if (!_state) return;
      _state.adminsItems = (Array.isArray(rows) ? rows : []).map((x, idx) => ({
        id: String(x.id || x.fila || x.mva || `adm_${idx}`),
        mva: String(x.mva || '').toUpperCase().trim(),
        modelo: String(x.modelo || x.unidad || '').trim(),
        categoria: String(x.categoria || '').trim(),
        placas: String(x.placas || '').trim(),
        gasolina: String(x.gasolina || '').trim(),
        estado: String(x.estado || '').toUpperCase().trim(),
        ubicacion: String(x.ubicacion || '').trim(),
        notas: String(x.notas || x.descripcion || '').trim(),
        plaza: String(x.plaza || _state.plaza || '').toUpperCase().trim(),
        tipo: 'admin',
        pos: String(x.pos || '').trim(),
        updatedAt: x._updatedAt || x._createdAt || x.fecha || ''
      }));
    } catch (err) {
      _showActionMessage(err?.message || 'No se pudo cargar cuadre admins.', 'error');
    }
  }
  if (_state.tab === 'historial' && !_state.historyItems.length) {
    try {
      const rows = await obtenerHistorialCuadres(_state.plaza);
      if (!_state) return;
      _state.historyItems = (Array.isArray(rows) ? rows : []).map((x, idx) => ({
        id: String(x.id || x.fila || x.mva || `hist_${idx}`),
        mva: String(x.mva || '').toUpperCase().trim(),
        modelo: String(x.modelo || '').trim(),
        categoria: String(x.categoria || '').trim(),
        placas: String(x.placas || '').trim(),
        gasolina: String(x.gasolina || '').trim(),
        estado: String(x.estado || '').toUpperCase().trim(),
        ubicacion: String(x.ubicacion || '').trim(),
        notas: String(x.notas || x.descripcion || x.accion || '').trim(),
        plaza: String(x.plaza || _state.plaza || '').toUpperCase().trim(),
        tipo: 'historial',
        pos: String(x.pos || '').trim(),
        updatedAt: x._updatedAt || x._createdAt || x.fecha || ''
      }));
    } catch (err) {
      _showActionMessage(err?.message || 'No se pudo cargar historial de cuadre.', 'error');
    }
  }
}

function _renderNoPlaza() {
  _renderSummary();
  _renderDetail(null);
  _setHTML('#cqvTableBody', `<tr><td colspan="${TABLE_COLSPAN}"><div class="cqv__empty">Selecciona una plaza para ver el cuadre.</div></td></tr>`);
}

function _renderTableSkeleton() {
  _setHTML('#cqvTableBody', `<tr><td colspan="${TABLE_COLSPAN}"><div class="cqv__empty">Cargando unidades...</div></td></tr>`);
}

function _renderTableError(msg) {
  _setHTML('#cqvTableBody', `<tr><td colspan="${TABLE_COLSPAN}"><div class="cqv__empty">${esc(msg)}</div></td></tr>`);
}

function _renderSummary() {
  const src = _state?.allItems || [];
  _setText('#cqvSummaryTotal', src.length);
  _setText('#cqvSummaryListo', src.filter(x => x.estado === 'LISTO').length);
  _setText('#cqvSummarySucios', src.filter(x => x.estado === 'SUCIO' || x.estado === 'MANTENIMIENTO').length);
  _setText('#cqvSummaryExternos', src.filter(x => String(x.tipo || '').toLowerCase() === 'externo').length);
  _setText('#cqvSummaryResguardo', src.filter(x => x.estado === 'RESGUARDO').length);
  _setText('#cqvSummarySinUbicacion', src.filter(x => !String(x.ubicacion || '').trim()).length);
  const byEst = {};
  src.forEach(x => {
    const e = String(x.estado || 'SIN ESTADO').trim() || 'SIN ESTADO';
    byEst[e] = (byEst[e] || 0) + 1;
  });
  const topEst = Object.entries(byEst).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const el = q('#cqvSummaryEstados');
  if (el) {
    el.innerHTML = topEst.length
      ? topEst.map(([k, v]) => `<span class="cqv__stat-pill">${esc(k)} <b>${v}</b></span>`).join('')
      : '<span class="cqv__stat-muted">—</span>';
  }
  const ub = {};
  src.forEach(x => {
    const u = String(x.ubicacion || '—').trim() || '—';
    ub[u] = (ub[u] || 0) + 1;
  });
  const topUb = Object.entries(ub).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const ubEl = q('#cqvSummaryUbic');
  if (ubEl) {
    ubEl.innerHTML = topUb.length
      ? topUb.map(([k, v]) => `<span class="cqv__stat-pill">${esc(k)} <b>${v}</b></span>`).join('')
      : '<span class="cqv__stat-muted">—</span>';
  }
  const cat = {};
  src.forEach(x => {
    const c = String(x.categoria || '—').trim() || '—';
    cat[c] = (cat[c] || 0) + 1;
  });
  const topCat = Object.entries(cat).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const catEl = q('#cqvSummaryCat');
  if (catEl) {
    catEl.innerHTML = topCat.length
      ? topCat.map(([k, v]) => `<span class="cqv__stat-pill">${esc(k)} <b>${v}</b></span>`).join('')
      : '<span class="cqv__stat-muted">—</span>';
  }
}

function _ubiClass(ubicacion) {
  const u = String(ubicacion || '').toUpperCase();
  if (!u) return 'cqv-ubi-DEFAULT';
  if (u.includes('PATIO')) return 'cqv-ubi-PATIO';
  if (u.includes('TALLER')) return 'cqv-ubi-TALLER';
  if (u.includes('AGENCIA')) return 'cqv-ubi-AGENCIA';
  if (u.includes('EXTERNO') || u.includes('HYP')) return 'cqv-ubi-EXTERNO';
  const PLAZAS_FIJAS = ['PATIO','TALLER','AGENCIA','TALLER EXTERNO','HYP COBIAN'];
  if (!PLAZAS_FIJAS.includes(u)) return 'cqv-ubi-PERSONA';
  return 'cqv-ubi-DEFAULT';
}

function _estClass(estado) {
  const e = String(estado || '').toUpperCase().replace(/[\s-]+/g, '');
  const MAP = {
    LISTO: 'cqv-st-LISTO',
    SUCIO: 'cqv-st-SUCIO',
    MANTENIMIENTO: 'cqv-st-MANTENIMIENTO',
    TRASLADO: 'cqv-st-TRASLADO',
    VENTA: 'cqv-st-VENTA',
    RESGUARDO: 'cqv-st-RESGUARDO',
    RETENIDA: 'cqv-st-RETENIDA',
    NOARRENDABLE: 'cqv-st-MUTED',
    ENRENTA: 'cqv-st-ENRENTA',
    HYP: 'cqv-st-MUTED',
  };
  return MAP[e] || 'cqv-st-MUTED';
}

function _renderTable() {
  const tbody = q('#cqvTableBody');
  if (!tbody) return;
  if (!_state.items.length) {
    const message = _state.allItems.length
      ? 'Sin resultados para los filtros aplicados.'
      : 'No hay unidades para esta plaza.';
    tbody.innerHTML = `<tr><td colspan="${TABLE_COLSPAN}"><div class="cqv__empty">${message}</div></td></tr>`;
    return;
  }
  tbody.innerHTML = _state.items.map(item => {
    const selected = item.id === _state.selectedId ? 'is-selected' : '';
    const gasClass = String(item.gasolina || '').toUpperCase() === 'F' ? 'cqv-gas-f' : 'cqv-gas';
    const ubiCls = _ubiClass(item.ubicacion);
    const estCls = _estClass(item.estado);
    return `<tr class="cqv__row ${selected}" data-cqv-row="${esc(item.id)}">
      <td class="cqv-td-mva">${esc(item.mva || '—')}</td>
      <td><span class="cqv-td-cat">${esc(item.categoria || 'N/A')}</span></td>
      <td>${esc(item.modelo || '—')}</td>
      <td class="cqv-td-placas">${esc(item.placas || '—')}</td>
      <td><span class="${gasClass}">${esc(item.gasolina || '—')}</span></td>
      <td><span class="cqv-badge ${estCls}">${esc(item.estado || '—')}</span></td>
      <td><span class="cqv-ubi-badge ${ubiCls}">${esc(item.ubicacion || '—')}</span></td>
    </tr>`;
  }).join('');
  qsa('[data-cqv-row]').forEach(row => row.addEventListener('click', () => {
    _state.selectedId = row.dataset.cqvRow;
    qsa('[data-cqv-row]').forEach(r => r.classList.toggle('is-selected', r === row));
    _syncDetail();
  }));
}

async function _runMasterSearch() {
  const query = _state?.masterSearchQuery || '';
  if (!query || query.length < 2) {
    _state.masterSearchResults = [];
    _renderMasterSearchResults();
    return;
  }
  try {
    const rows = await obtenerUnidadesVeloz(_state.plaza);
    const term = query.toLowerCase();
    _state.masterSearchResults = (Array.isArray(rows) ? rows : [])
      .filter(row => {
        const hay = [
          row?.mva,
          row?.placas,
          row?.modelo,
          row?.categoria
        ].map(x => String(x || '').toLowerCase()).join(' ');
        return hay.includes(term);
      })
      .slice(0, 8);
  } catch (err) {
    _state.masterSearchResults = [];
    _showActionMessage(err?.message || 'No se pudo consultar la base maestra.', 'error');
  }
  _renderMasterSearchResults();
}

function _renderMasterSearchResults() {
  const host = q('#cqvMasterSearchResults');
  if (!host) return;
  const rows = Array.isArray(_state.masterSearchResults) ? _state.masterSearchResults : [];
  if (!rows.length) {
    host.innerHTML = `<div class="cqv__stat-muted">Sin resultados para búsqueda base maestra.</div>`;
    return;
  }
  host.innerHTML = rows.map(row => `
    <button type="button" class="cqv__btn" data-cqv-master-mva="${esc(row?.mva || '')}" style="width:100%;justify-content:space-between;">
      <span>${esc(row?.mva || '—')}</span>
      <span style="font-size:10px;color:#64748b;">${esc([row?.modelo, row?.placas].filter(Boolean).join(' · ') || 'sin meta')}</span>
    </button>
  `).join('');
  host.querySelectorAll('[data-cqv-master-mva]').forEach(btn => btn.addEventListener('click', () => {
    const mva = String(btn.dataset.cqvMasterMva || '').toUpperCase();
    const found = _state.allItems.find(item => String(item.mva || '').toUpperCase() === mva);
    if (!found) return;
    _state.selectedId = found.id;
    _renderTable();
    _syncDetail();
  }));
}

function _toggleHistoryDateFilter() {
  const wrap = q('#cqvHistoryDateWrap');
  if (!wrap) return;
  wrap.style.display = _state?.tab === 'historial' ? 'inline-flex' : 'none';
}

function _syncDetail() {
  if (!_state.selectedId) return _renderDetail(null);
  const item = _state.items.find(x => x.id === _state.selectedId)
    || _state.allItems.find(x => x.id === _state.selectedId)
    || _state.adminsItems.find(x => x.id === _state.selectedId)
    || _state.historyItems.find(x => x.id === _state.selectedId);
  if (!item) {
    _state.selectedId = null;
    return _renderDetail(null);
  }
  _renderDetail(item);
}

function _renderDetail(item) {
  const panel = q('#cqvDetail');
  if (!panel) return;
  if (!item) {
    panel.innerHTML = `<div class="cqv__empty">Selecciona una unidad de la tabla.</div>`;
    return;
  }
  const canMutate = _canOfferMutations(item);
  panel.innerHTML = `
    <div class="cqv__unit-card">
      <div class="cqv__unit-mva">${esc(item.mva || '—')}</div>
      <div style="margin-bottom:10px;">${_estadoBadge(item.estado || 'SIN ESTADO')}</div>
      <p style="font-size:13px;color:#475569;margin:0 0 12px;font-weight:600;">${esc(item.modelo || '')}${item.placas ? ` · ${esc(item.placas)}` : ''}</p>
      <div class="cqv__unit-grid">
        <div class="cqv__unit-cell"><span class="cqv__unit-lbl">Categoría</span><span>${esc(item.categoria || '—')}</span></div>
        <div class="cqv__unit-cell"><span class="cqv__unit-lbl">Gasolina</span><span>${esc(item.gasolina || '—')}</span></div>
        <div class="cqv__unit-cell"><span class="cqv__unit-lbl">Ubicación</span><span>${esc(item.ubicacion || '—')}</span></div>
        <div class="cqv__unit-cell"><span class="cqv__unit-lbl">Actualizado</span><span>${esc(_fmtUpdatedCompact(item.updatedAt || item.fechaIngreso))}</span></div>
      </div>
      ${item.notas ? `<div class="cqv__unit-notes"><strong>Notas:</strong> ${esc(item.notas)}</div>` : ''}
      ${canMutate ? `
      <div class="cqv__unit-actions">
        <button type="button" class="cqv__btn cqv__btn--primary" data-cqv-action="update_status" style="width:100%;justify-content:center;">Cambiar estado</button>
        <button type="button" class="cqv__btn" data-cqv-action="update_gas" style="width:100%;justify-content:center;">Actualizar gasolina</button>
        <button type="button" class="cqv__btn" data-cqv-action="update_location" style="width:100%;justify-content:center;">Cambiar ubicación</button>
        <button type="button" class="cqv__btn" data-cqv-action="update_notes" style="width:100%;justify-content:center;">Actualizar notas</button>
        <button type="button" class="cqv__btn" data-cqv-action="mark_ready" style="width:100%;justify-content:center;">Marcar listo ✅</button>
        <button type="button" class="cqv__btn cqv__btn--danger" data-cqv-action="delete_unit" style="width:100%;justify-content:center;">Eliminar unidad</button>
      </div>` : `<div style="font-size:12px;color:#94a3b8;text-align:center;padding:8px 0;">Solo lectura en esta vista.</div>`}
    </div>`;
}

function _renderOperationalActions(item) {
  if (!item || item.tipo === 'admin' || item.tipo === 'historial') {
    return `<div class="cqv__blocked-actions"><strong>Acciones oficiales</strong><span>Solo lectura en esta pestaña.</span></div>`;
  }
  if (!_canOfferMutations(item)) {
    return `<div class="cqv__blocked-actions"><strong>Acciones oficiales</strong><span>No disponibles para esta sesión, rol o plaza.</span></div>`;
  }
  return `
    <div class="cqv__ops">
      <div class="cqv__ops-title">Acciones operativas</div>
      <div class="cqv__detail-actions">
        <button type="button" class="cqv__btn cqv__btn--primary" data-cqv-action="update_status">Cambiar estado</button>
        <button type="button" class="cqv__btn" data-cqv-action="update_notes">Actualizar notas</button>
        <button type="button" class="cqv__btn" data-cqv-action="update_gas">Actualizar gasolina</button>
        <button type="button" class="cqv__btn" data-cqv-action="mark_ready">Marcar listo</button>
        <button type="button" class="cqv__btn" data-cqv-action="update_location">Cambiar ubicación</button>
        <button type="button" class="cqv__btn cqv__btn--danger" data-cqv-action="delete_unit">Eliminar unidad</button>
      </div>
    </div>`;
}

function _layout({ plaza, role, user }) {
  const isAdmin = ['PROGRAMADOR','ADMINISTRADOR','ADMIN','SUPERVISOR','COORDINADOR'].includes(String(role || '').toUpperCase());
  return `
    <section class="cqv">
      <div class="cqv__top">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <h2 style="margin:0;color:var(--cq-primary);font-size:20px;font-weight:900;">GESTIÓN DE FLOTA</h2>
          <span class="cqv__beta-badge">BETA</span>
          <div class="cqv__dropdown-wrap" id="cqvMasControlesWrap">
            <button class="cqv__btn" type="button" id="cqvToggleMasControles">
              <span class="material-icons" style="font-size:16px;vertical-align:middle;">tune</span> MÁS CONTROLES
            </button>
            <div class="cqv__dropdown" id="cqvMasControlesMenu" hidden>
              <div class="cqv__dropdown-item" data-cqv-ctrl="export-csv">
                <span class="material-icons">table_view</span> Exportar CSV
              </div>
              <div class="cqv__dropdown-item" data-cqv-ctrl="copy-summary">
                <span class="material-icons">content_copy</span> Resumen Flota
              </div>
              <div class="cqv__dropdown-item" data-cqv-ctrl="refresh">
                <span class="material-icons">sync</span> Re-sincronizar
              </div>
            </div>
          </div>
          ${isAdmin ? `
          <div class="cqv__dropdown-wrap" id="cqvAdminWrap">
            <button class="cqv__btn cqv__btn--admin" type="button" id="cqvToggleAdmin">
              <span class="material-icons" style="font-size:16px;vertical-align:middle;">admin_panel_settings</span> GESTIÓN ADMIN
            </button>
            <div class="cqv__dropdown" id="cqvAdminMenu" hidden>
              <div class="cqv__dropdown-header">ADMINISTRACIÓN GLOBAL</div>
              <div class="cqv__dropdown-item" data-cqv-ctrl="insert-unit">
                <span class="material-icons">add_box</span> Insertar Unidad
              </div>
              <div class="cqv__dropdown-item" data-cqv-ctrl="insert-externo">
                <span class="material-icons">directions_car</span> Insertar Externo
              </div>
            </div>
          </div>` : ''}
        </div>
        <div class="cqv__meta">
          <span id="cqvPlaza" class="cqv__plaza">${esc(plaza || '—')}</span>
          <span>·</span>
          <span id="cqvLastSync">Sin sincronizar</span>
        </div>
      </div>
      <div id="cqvActionMsg" class="cqv__action-msg" hidden></div>
      <div class="cqv__grid">
        <div class="cqv__panel cqv__panel--left" style="position:relative;">
          <div class="cqv__tabs">
            <button class="cqv__tab is-active" data-cqv-tab="regular" type="button">🚗 FLOTA REGULAR</button>
            <button class="cqv__tab" data-cqv-tab="admins" type="button">👑 CUADRE ADMINS</button>
          </div>
          <div class="cqv__search-row">
            <div class="cqv__search-wrap">
              <span class="material-icons" style="font-size:18px;color:#94a3b8;flex-shrink:0;">search</span>
              <input id="cqvSearch" class="cqv__search-input" type="search"
                placeholder="Buscar MVA, Notas, Placas o Modelo..." autocomplete="off" />
            </div>
            <button type="button" class="cqv__btn-clear" id="cqvClearFilters" title="Limpiar Filtros">
              <span class="material-icons" style="font-size:18px;">filter_alt_off</span>
            </button>
          </div>
          <div class="cqv__chips cqv__chips--scroll">
            <div class="cqv__chip is-active" data-cqv-filter="all">Todos</div>
            <div class="cqv__chip" data-cqv-filter="sucio">🧹 SUCIO</div>
            <div class="cqv__chip" data-cqv-filter="listo">✅ LISTO</div>
            <div class="cqv__chip" data-cqv-filter="mantenimiento">🔧 MANT.</div>
            <div class="cqv__chip" data-cqv-filter="traslado">🚛 TRASLADO</div>
            <div class="cqv__chip" data-cqv-filter="doble-cero">🍃 DOBLE CERO</div>
            <div class="cqv__chip" data-cqv-filter="apartado">🔒 APARTADOS</div>
            <div class="cqv__chip" data-cqv-filter="urgente">⚡ URGENTE</div>
            <div class="cqv__chip" data-cqv-filter="resguardo">👀 RESGUARDO</div>
            <div class="cqv__chip" data-cqv-filter="taller">🏭 TALLER</div>
          </div>
          <div id="cqvBatchBar" class="cqv__batch-bar" hidden>
            <span id="cqvBatchLabel" class="cqv__batch-label"></span>
            <span style="font-size:12px;color:#78350f;">Aplicar a todas:</span>
            <select id="cqvBatchEstado" class="cqv__batch-select">
              <option value="">— Estado —</option>
              <option value="SUCIO">SUCIO</option>
              <option value="LISTO">LISTO</option>
              <option value="MANTENIMIENTO">MANTENIMIENTO</option>
              <option value="TRASLADO">TRASLADO</option>
              <option value="RESGUARDO">RESGUARDO</option>
              <option value="NO ARRENDABLE">NO ARRENDABLE</option>
            </select>
            <button type="button" class="cqv__batch-apply" id="cqvBatchApply">Aplicar</button>
            <span id="cqvBatchProgress" style="font-size:11px;color:#78350f;"></span>
          </div>
          <div class="cqv__table-wrap">
            <table class="cqv__table">
              <thead>
                <tr>
                  <th class="cqv__th-sort" data-cqv-sort="mva">MVA ↕</th>
                  <th><select id="filter-cat" class="excel-filter" data-cqv-col-filter="categoria"><option value="">CATEGORIA (ALL)</option></select></th>
                  <th><select id="filter-modelo" class="excel-filter" data-cqv-col-filter="modelo"><option value="">MODELO (ALL)</option></select></th>
                  <th class="cqv__th-sort" data-cqv-sort="placas">Placas ↕</th>
                  <th class="cqv__th-sort" data-cqv-sort="gasolina">Gas ↕</th>
                  <th><select id="filter-est" class="excel-filter" data-cqv-col-filter="estado"><option value="">ESTADO (ALL)</option></select></th>
                  <th><select id="filter-ubi" class="excel-filter" data-cqv-col-filter="ubicacion"><option value="">UBICACION (ALL)</option></select></th>
                </tr>
              </thead>
              <tbody id="cqvTableBody"></tbody>
            </table>
          </div>
          <button class="cqv__fab" type="button" id="cqvFab" title="Agregar Unidad">
            <span class="material-icons">add</span>
          </button>
        </div>
        <aside class="cqv__side">
          <div class="cqv__stats-grid">
            <div class="cqv__stat-box">
              <div class="cqv__stat-num" id="cqvSummaryTotal">--</div>
              <div class="cqv__stat-lbl">Total Flota</div>
            </div>
            <div class="cqv__stat-box cqv__stat-box--green">
              <div class="cqv__stat-num cqv__stat-num--green" id="cqvSummaryListo">--</div>
              <div class="cqv__stat-lbl">Listos Renta</div>
            </div>
          </div>
          <div class="cqv__panel cqv__gestor">
            <div class="cqv__gestor-header">
              <h3 class="cqv__gestor-title">GESTOR DE UNIDAD</h3>
            </div>
            <div id="cqvDetail">
              <div class="cqv__empty">Selecciona una unidad de la tabla.</div>
            </div>
          </div>
        </aside>
      </div>
    </section>`;
}

function _updateBatchBar() {
  const bar = q('#cqvBatchBar');
  if (!bar) return;
  const isFiltered = _state.filter !== 'all';
  bar.hidden = !isFiltered;
  if (isFiltered) {
    _setText('#cqvBatchLabel', `${_state.items.length} unidades filtradas.`);
  }
}

async function _executeBatchAction() {
  const estado = String(q('#cqvBatchEstado')?.value || '').trim().toUpperCase();
  if (!estado) { _showActionMessage('Selecciona un estado para aplicar.', 'error'); return; }
  const items = _state?.items || [];
  if (!items.length) { _showActionMessage('No hay unidades en el filtro actual.', 'info'); return; }
  if (!_canOfferMutations({ tipo: 'renta' })) {
    _showActionMessage('Sin permisos para aplicar cambios en batch.', 'error');
    return;
  }
  const controller = await _loadUnitActionsController();
  if (!controller) { _showActionMessage('No se pudo inicializar el controlador.', 'error'); return; }
  const progress = q('#cqvBatchProgress');
  const applyBtn = q('#cqvBatchApply');
  if (applyBtn) applyBtn.disabled = true;
  let done = 0;
  let errors = 0;
  for (const item of items) {
    if (progress) progress.textContent = `${done + errors + 1}/${items.length}...`;
    try {
      const ctx = { ..._unitActionContext(), confirmed: true };
      const result = await controller.executeUnitAction('update_status', item, { estado, confirmed: true }, ctx);
      if (result?.ok) done++;
      else errors++;
    } catch (_err) {
      errors++;
    }
  }
  if (applyBtn) applyBtn.disabled = false;
  if (progress) progress.textContent = '';
  _showActionMessage(`Batch: ${done} actualizadas${errors ? `, ${errors} errores` : ''}.`, errors > 0 ? 'error' : 'success');
  if (_state?.plaza) _startListener(_state.plaza);
}

function _selectedUnit() {
  return _findUnitById(_state?.selectedId);
}

function _findUnitById(id) {
  if (!id || !_state) return null;
  return [...(_state.items || []), ...(_state.allItems || []), ...(_state.adminsItems || []), ...(_state.historyItems || [])]
    .find(item => String(item.id || '') === String(id)) || null;
}

function _canOfferMutations(item) {
  if (!item || item.tipo === 'admin' || item.tipo === 'historial') return false;
  const gs = getState() || {};
  const role = String(gs.role || gs.profile?.rol || gs.profile?.role || '').toUpperCase();
  // Allow mutations for operational roles (matching legacy permissions)
  return ['PROGRAMADOR','SUPERVISOR','COORDINADOR','ADMINISTRADOR','ADMIN'].includes(role) || gs.profile?.isAdmin === true;
}

function _unitActionContext() {
  const gs = getState() || {};
  return {
    state: {
      ...gs,
      plaza: _state?.plaza || getCurrentPlaza()
    },
    plaza: _state?.plaza || getCurrentPlaza(),
    profile: gs.profile || {},
    user: gs.profile || gs.user || null,
    role: gs.role || gs.profile?.rol || gs.profile?.role || ''
  };
}

async function _openActionModal(action, item) {
  if (!_state || !item) return;
  if (action === 'refresh_unit') {
    _showActionMessage('Re-sincronizando unidad...', 'info');
    if (_state.plaza) _startListener(_state.plaza);
    return;
  }
  if (!_canOfferMutations(item)) {
    _showActionMessage('Esta acción no tiene API segura disponible. Intenta de nuevo.', 'error');
    return;
  }
  const controller = await _loadUnitActionsController();
  if (!controller) {
    _showActionMessage('No se pudo preparar la acción. Intenta de nuevo.', 'error');
    return;
  }
  const available = controller.getAvailableActions?.(item, _unitActionContext()) || [];
  const definition = available.find(x => x.action === action);
  if (!definition?.available) {
    _showActionMessage(definition?.reason || 'Acción no disponible para tu rol o plaza.', 'error');
    return;
  }
  _showCuadreActionModal(action, item);
}

function _showCuadreActionModal(action, item) {
  _removeCuadreModals();
  _state.pendingAction = { action, unitId: item.id };
  const title = {
    update_status: 'Cambiar estado',
    update_notes: 'Actualizar notas',
    update_gas: 'Actualizar gasolina',
    mark_ready: 'Marcar listo',
    update_location: 'Cambiar ubicación',
    delete_unit: 'Eliminar unidad'
  }[action] || 'Confirmar acción';
  const form = _actionForm(action, item);
  const overlay = document.createElement('div');
  overlay.className = 'cqv__modal-overlay';
  overlay.dataset.cqvModal = '1';
  overlay.innerHTML = `
    <div class="cqv__modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="cqv__modal-head">
        <div>
          <strong>${esc(title)}</strong>
          <span>${esc(item.mva || '—')} · ${esc(_state.plaza || '—')}</span>
        </div>
        <button type="button" class="cqv__icon-btn" data-cqv-modal-close aria-label="Cerrar">×</button>
      </div>
      <div class="cqv__modal-body">${form}</div>
      <div class="cqv__modal-actions">
        <button type="button" class="cqv__btn" data-cqv-modal-close>Cancelar</button>
        <button type="button" class="cqv__btn cqv__btn--primary" data-cqv-modal-confirm>Confirmar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-cqv-modal-close]').forEach(btn => btn.addEventListener('click', () => {
    _removeCuadreModals();
    _showActionMessage('Acción cancelada. No se aplicaron cambios.', 'info');
  }));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      _removeCuadreModals();
      _showActionMessage('Acción cancelada. No se aplicaron cambios.', 'info');
    }
  });
  overlay.querySelector('[data-cqv-modal-confirm]')?.addEventListener('click', () => {
    void _confirmUnitAction(action, item, overlay);
  });
  overlay.querySelector('select, textarea, input')?.focus?.();
}

function _actionForm(action, item) {
  if (action === 'update_status') {
    return `<label class="cqv__form-label">Estado<select class="cqv__form-control" data-cqv-field="estado">${SAFE_ESTADOS.map(v => `<option value="${esc(v)}" ${v === String(item.estado || '').toUpperCase() ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
  }
  if (action === 'update_notes') {
    return `<label class="cqv__form-label">Notas<textarea class="cqv__form-control" data-cqv-field="notas" rows="5">${esc(item.notas || '')}</textarea></label>`;
  }
  if (action === 'update_gas') {
    const current = String(item.gasolina || item.gas || 'N/A').toUpperCase();
    return `<label class="cqv__form-label">Gasolina<select class="cqv__form-control" data-cqv-field="gasolina">${GAS_OPTIONS.map(v => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
  }
  if (action === 'mark_ready') {
    return `<p class="cqv__confirm-copy">La unidad quedará marcada como LISTO. Se conserva ubicación, gasolina y notas actuales.</p>`;
  }
  if (action === 'update_location') {
    const UBI_OPTIONS = ['PATIO','TALLER','AGENCIA','TALLER EXTERNO','HYP COBIAN','JORGE','GERARDO','OSVALDO','BALANDRAN','ULISES','JOSUE','ISRAEL','ISAAC','ANGEL','LEO','BRAULIO','MARTHA','FERNANDA','ZALLO','UBALDO','JOSE LUIS','PASCUAL','LALO','EDGAR'];
    const current = String(item.ubicacion || '').toUpperCase();
    return `<label class="cqv__form-label">Ubicación<select class="cqv__form-control" data-cqv-field="ubicacion">${UBI_OPTIONS.map(v => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
  }
  if (action === 'delete_unit') {
    return `<p class="cqv__confirm-copy" style="color:#ef4444;font-weight:700;">Se eliminará permanentemente la unidad ${esc(item.mva || '')} del cuadre de ${esc(_state?.plaza || '')}. Esta acción no se puede deshacer.</p>`;
  }
  return `<p class="cqv__confirm-copy">Confirma la acción operativa.</p>`;
}

async function _confirmUnitAction(action, item, overlay) {
  const controller = await _loadUnitActionsController();
  if (!controller) {
    _showActionMessage('No se pudo preparar la acción. Intenta de nuevo.', 'error');
    return;
  }
  const payload = _payloadFromModal(action, overlay);
  payload.confirmed = true;
  const ctx = { ..._unitActionContext(), confirmed: true };
  const validation = controller.validateUnitAction?.(action, item, payload, ctx);
  if (!validation?.ok) {
    _showActionMessage(validation?.message || 'No se pudo validar la acción.', 'error');
    return;
  }
  const confirmBtn = overlay.querySelector('[data-cqv-modal-confirm]');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Aplicando...';
  }
  try {
    const result = await controller.executeUnitAction(action, item, payload, ctx);
    if (!result?.ok) {
      _showActionMessage(result?.message || 'No se pudo aplicar el cambio. Intenta de nuevo.', 'error');
      return;
    }
    _removeCuadreModals();
    _showActionMessage(result.message || 'Cambio aplicado. Re-sincronizando datos...', 'success');
    if (_state?.plaza) _startListener(_state.plaza);
  } catch (err) {
    _showActionMessage(err?.message || 'No se pudo aplicar el cambio. Intenta de nuevo.', 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirmar';
    }
  }
}

function _payloadFromModal(action, overlay) {
  const valueOf = name => String(overlay.querySelector(`[data-cqv-field="${name}"]`)?.value || '').trim();
  if (action === 'update_status') return { estado: valueOf('estado') };
  if (action === 'update_notes') return { notas: valueOf('notas') };
  if (action === 'update_gas') return { gasolina: valueOf('gasolina') };
  if (action === 'mark_ready') return { estado: 'LISTO' };
  if (action === 'update_location') return { ubicacion: valueOf('ubicacion') };
  if (action === 'delete_unit') return { _delete: true };
  return {};
}


function _showInsertUnitModal() {
  if (!_canOfferMutations({ tipo: 'renta' })) {
    _showActionMessage('No tienes permisos para dar de alta unidades.', 'error');
    return;
  }
  _removeCuadreModals();
  const overlay = document.createElement('div');
  overlay.className = 'cqv__modal-overlay';
  overlay.dataset.cqvModal = '1';
  overlay.innerHTML = `
    <div class="cqv__modal" role="dialog" aria-modal="true" aria-label="Alta de unidad">
      <div class="cqv__modal-head"><div><strong>Alta de unidad</strong><span>${esc(_state?.plaza || '')}</span></div><button type="button" class="cqv__icon-btn" data-cqv-modal-close aria-label="Cerrar">×</button></div>
      <div class="cqv__modal-body">
        <label class="cqv__form-label">MVA<input class="cqv__form-control" data-cqv-field="mva" placeholder="Ej: ABC123"></label>
        <label class="cqv__form-label">Categoría<input class="cqv__form-control" data-cqv-field="categoria" placeholder="Ej: ECAR"></label>
        <label class="cqv__form-label">Modelo<input class="cqv__form-control" data-cqv-field="modelo" placeholder="Ej: AVEO 2024"></label>
        <label class="cqv__form-label">Placas<input class="cqv__form-control" data-cqv-field="placas" placeholder="Ej: ABC-123"></label>
        <label class="cqv__form-label">Estado<select class="cqv__form-control" data-cqv-field="estado">${SAFE_ESTADOS.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></label>
        <label class="cqv__form-label">Gasolina<select class="cqv__form-control" data-cqv-field="gasolina">${GAS_OPTIONS.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></label>
        <label class="cqv__form-label">Ubicación<input class="cqv__form-control" data-cqv-field="ubicacion" placeholder="Ej: PATIO"></label>
        <label class="cqv__form-label">Notas<textarea class="cqv__form-control" data-cqv-field="notas" rows="2"></textarea></label>
      </div>
      <div class="cqv__modal-actions"><button type="button" class="cqv__btn" data-cqv-modal-close>Cancelar</button><button type="button" class="cqv__btn cqv__btn--primary" data-cqv-modal-confirm>Guardar</button></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-cqv-modal-close]').forEach(b => b.addEventListener('click', () => _removeCuadreModals()));
  overlay.addEventListener('click', e => { if (e.target === overlay) _removeCuadreModals(); });
  overlay.querySelector('[data-cqv-modal-confirm]')?.addEventListener('click', async () => {
    const val = name => String(overlay.querySelector(`[data-cqv-field="${name}"]`)?.value || '').trim();
    const mva = val('mva').toUpperCase();
    if (!mva) { _showActionMessage('MVA es obligatorio.', 'error'); return; }
    const payload = { mva, categoria: val('categoria'), modelo: val('modelo'), placas: val('placas'), estado: val('estado') || 'SUCIO', gasolina: val('gasolina') || 'N/A', ubicacion: val('ubicacion') || 'PATIO', notas: val('notas'), plaza: _state?.plaza || '', tipo: 'renta' };
    const btn = overlay.querySelector('[data-cqv-modal-confirm]');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
    try {
      if (window.api?.insertarUnidadFlota) { await window.api.insertarUnidadFlota(payload); }
      else { const { db: _db, COL: _C } = await import('/js/core/database.js'); await _db.collection(_C.CUADRE).add({ ...payload, _updatedAt: new Date(), _updatedBy: getState()?.profile?.nombre || 'APP' }); }
      _removeCuadreModals();
      _showActionMessage(`Unidad ${mva} dada de alta.`, 'success');
      if (_state?.plaza) _startListener(_state.plaza);
    } catch (err) { _showActionMessage(err?.message || 'Error al dar de alta.', 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; } }
  });
}

function _showInsertExternoModal() {
  if (!_canOfferMutations({ tipo: 'renta' })) {
    _showActionMessage('No tienes permisos para insertar externos.', 'error');
    return;
  }
  _removeCuadreModals();
  const overlay = document.createElement('div');
  overlay.className = 'cqv__modal-overlay';
  overlay.dataset.cqvModal = '1';
  overlay.innerHTML = `
    <div class="cqv__modal" role="dialog" aria-modal="true" aria-label="Insertar externo">
      <div class="cqv__modal-head"><div><strong>Insertar unidad externa</strong><span>${esc(_state?.plaza || '')}</span></div><button type="button" class="cqv__icon-btn" data-cqv-modal-close aria-label="Cerrar">×</button></div>
      <div class="cqv__modal-body">
        <label class="cqv__form-label">MVA<input class="cqv__form-control" data-cqv-field="mva" placeholder="Ej: EXT001"></label>
        <label class="cqv__form-label">Modelo<input class="cqv__form-control" data-cqv-field="modelo"></label>
        <label class="cqv__form-label">Placas<input class="cqv__form-control" data-cqv-field="placas"></label>
        <label class="cqv__form-label">Estado<select class="cqv__form-control" data-cqv-field="estado">${SAFE_ESTADOS.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></label>
        <label class="cqv__form-label">Notas<textarea class="cqv__form-control" data-cqv-field="notas" rows="2"></textarea></label>
      </div>
      <div class="cqv__modal-actions"><button type="button" class="cqv__btn" data-cqv-modal-close>Cancelar</button><button type="button" class="cqv__btn cqv__btn--primary" data-cqv-modal-confirm>Insertar</button></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-cqv-modal-close]').forEach(b => b.addEventListener('click', () => _removeCuadreModals()));
  overlay.addEventListener('click', e => { if (e.target === overlay) _removeCuadreModals(); });
  overlay.querySelector('[data-cqv-modal-confirm]')?.addEventListener('click', async () => {
    const val = name => String(overlay.querySelector(`[data-cqv-field="${name}"]`)?.value || '').trim();
    const mva = val('mva').toUpperCase();
    if (!mva) { _showActionMessage('MVA es obligatorio.', 'error'); return; }
    const payload = { mva, modelo: val('modelo'), placas: val('placas'), estado: val('estado') || 'SUCIO', notas: val('notas'), plaza: _state?.plaza || '', tipo: 'externo', ubicacion: 'EXTERNO' };
    const btn = overlay.querySelector('[data-cqv-modal-confirm]');
    if (btn) { btn.disabled = true; btn.textContent = 'Insertando...'; }
    try {
      if (window.api?.insertarUnidadExterna) { await window.api.insertarUnidadExterna(payload); }
      else { const { db: _db, COL: _C } = await import('/js/core/database.js'); await _db.collection(_C.EXTERNOS).add({ ...payload, _updatedAt: new Date(), _updatedBy: getState()?.profile?.nombre || 'APP' }); }
      _removeCuadreModals();
      _showActionMessage(`Externo ${mva} insertado.`, 'success');
      if (_state?.plaza) _startListener(_state.plaza);
    } catch (err) { _showActionMessage(err?.message || 'Error al insertar externo.', 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Insertar'; } }
  });
}

function _removeCuadreModals() {
  document.querySelectorAll('[data-cqv-modal="1"]').forEach(node => node.remove());
  if (_state) _state.pendingAction = null;
}

function _renderLastSync() {
  const text = _state?.lastUpdated
    ? `Última actualización ${new Date(_state.lastUpdated).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
    : 'Sin sincronizar';
  _setText('#cqvLastSync', text);
}

function _showActionMessage(message, type = 'info') {
  const el = q('#cqvActionMsg');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'cqv__action-msg';
    return;
  }
  el.hidden = false;
  el.textContent = String(message);
  el.className = `cqv__action-msg cqv__action-msg--${type || 'info'}`;
}

async function _writeClipboard(text, okMessage, errorMessage) {
  try {
    await navigator.clipboard?.writeText?.(String(text ?? ''));
    _showActionMessage(okMessage, 'success');
  } catch (err) {
    _showActionMessage(errorMessage || err?.message || 'No se pudo copiar.', 'error');
  }
}

function _detailCell(label, value) {
  return `<div style="border:1px solid rgba(148,163,184,0.2);border-radius:8px;padding:8px;background:#0f172a;"><div style="font-size:10px;text-transform:uppercase;color:#8ea1ba;">${esc(label)}</div><div style="font-size:12px;color:#e5eefb;font-weight:700;">${esc(value)}</div></div>`;
}

function _badge(text, color, bg) { return `<span class="cqv__badge" style="color:${color};background:${bg};">${esc(text)}</span>`; }
function _estadoBadge(estado) { return _badge(estado, ESTADO_COLOR[estado] || '#475569', (ESTADO_COLOR[estado] || '#475569') + '22'); }
function _setText(selector, value) { const el = q(selector); if (el) el.textContent = String(value ?? ''); }
function _setHTML(selector, html) { const el = q(selector); if (el) el.innerHTML = html; }

function _fmtUpdated(v) {
  if (!v) return '—';
  try {
    if (typeof v.toDate === 'function') {
      return v.toDate().toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    }
  } catch (err) {
    return String(v || err?.message || '—');
  }
  return esc(String(v));
}

function _fmtUpdatedCompact(v) {
  if (!v) return '—';
  try {
    if (typeof v.toDate === 'function') {
      return v.toDate().toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
  } catch (err) {
    return String(v || err?.message || '—').slice(0, 16) || '—';
  }
  const parsed = _parseDate(v);
  if (!parsed) return String(v).slice(0, 16) || '—';
  return new Date(parsed).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function _renderDynamicFilters(baseRows) {
  const rows = Array.isArray(baseRows) ? baseRows : [];
  _fillSelect('#filter-cat', rows.map(x => x.categoria), _state.categoryFilter);
  _fillSelect('#filter-modelo', rows.map(x => x.modelo), _state.modeloFilter);
  _fillSelect('#filter-est', rows.map(x => String(x.estado || '').toUpperCase()), _state.statusFilter);
  _fillSelect('#filter-ubi', rows.map(x => x.ubicacion), _state.locationFilter);
}

function _fillSelect(selector, values, selected) {
  const el = q(selector);
  if (!el) return;
  const defaultOption = el.options[0] ? `<option value="">${esc(el.options[0].textContent || '')}</option>` : '<option value="">Todos</option>';
  const unique = Array.from(new Set((values || []).map(v => String(v || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  el.innerHTML = defaultOption + unique.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  el.value = unique.includes(selected) ? selected : '';
}

function _exportFilteredCsv() {
  if (!_state?.items?.length) {
    _showActionMessage('No hay filas filtradas para exportar.', 'info');
    return;
  }
  const headers = ['MVA', 'Modelo', 'Placas', 'Categoria', 'Gasolina', 'Estado', 'Ubicacion', 'Posicion', 'Tipo', 'Notas', 'UltimaActualizacion'];
  const rows = _state.items.map(item => [
    item.mva, item.modelo, item.placas, item.categoria, item.gasolina, item.estado, item.ubicacion, item.pos, item.tipo, item.notas,
    _fmtUpdatedCompact(item.updatedAt || item.fechaIngreso)
  ]);
  const escapeCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(line => line.map(escapeCsv).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `cuadre-${String(_state.plaza || 'plaza').toLowerCase()}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  _showActionMessage('CSV exportado.', 'success');
}

async function _copyFilteredSummary() {
  const rows = _state?.items || [];
  const byEstado = {};
  rows.forEach(item => {
    const e = String(item.estado || 'SIN ESTADO');
    byEstado[e] = (byEstado[e] || 0) + 1;
  });
  const top = Object.entries(byEstado).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(' | ');
  const text = `Resumen cuadre ${_state?.plaza || '—'} · tab=${_state?.tab || 'regular'} · total filtrado=${rows.length}${top ? ` · ${top}` : ''}`;
  try {
    await navigator.clipboard?.writeText?.(text);
    _showActionMessage('Resumen copiado.', 'success');
  } catch (err) {
    _showActionMessage(err?.message || 'No se pudo copiar el resumen.', 'error');
  }
}

function _parseDate(value) {
  if (!value) return 0;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return new Date(value).getTime() || 0;
  const m = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime();
}

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
