// ═══════════════════════════════════════════════════════════
//  /js/app/views/incidencias.js
//  Fase 8B — vista real /app/incidencias con plaza global.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { subscribeIncidencias } from '/js/app/features/incidencias/incidencias-data.js';

let _container = null;
let _state = null;
let _unsubIncidencias = null;
let _unsubPlaza = null;
let _offGlobalSearch = null;

const q = id => _container?.querySelector(`#${id}`) ?? null;
const qs = selector => _container?.querySelector(selector) ?? null;
const qsa = selector => Array.from(_container?.querySelectorAll(selector) ?? []);

const FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'abiertas', label: 'Abiertas' },
  { id: 'criticas', label: 'Críticas' },
  { id: 'resueltas', label: 'Resueltas' },
];

const STATE_ORDER = { abierta: 0, en_proceso: 1, resuelta: 2, cerrada: 3 };
const PRIORITY_ORDER = { alta: 0, media: 1, baja: 2 };
const PRIORITY_COLOR = { alta: '#dc2626', media: '#d97706', baja: '#16a34a' };

function _normalizeState(value) {
  return String(value || '').toLowerCase().trim();
}

function _isOpen(item) {
  const s = _normalizeState(item.estado);
  return s === 'abierta' || s === 'en_proceso';
}

function _isResolved(item) {
  const s = _normalizeState(item.estado);
  return s === 'resuelta' || s === 'cerrada';
}

function _isCritical(item) {
  const priority = String(item.prioridad || '').toLowerCase();
  const state = _normalizeState(item.estado);
  return priority === 'alta' && state !== 'resuelta' && state !== 'cerrada';
}

function _dateMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function _safeText(v) {
  return String(v || '').trim();
}

function _makeState(plaza) {
  return {
    plaza,
    allItems: [],
    items: [],
    filter: 'all',
    query: '',
    sortField: 'fecha',
    sortDir: 'desc',
    selectedId: null,
    navigate: null,
  };
}

export async function mount(ctx) {
  _cleanup();
  _container = ctx.container;
  _state = _makeState(String(getCurrentPlaza() || ctx?.state?.currentPlaza || '').toUpperCase().trim());
  _state.navigate = ctx.navigate;

  const baseState = getState();
  _container.innerHTML = _skeleton({
    plaza: _state.plaza,
    role: baseState.role,
    user: baseState.profile?.nombreCompleto || baseState.profile?.nombre || baseState.profile?.email || 'Usuario',
  });

  _bindTopActions();
  _bindSearch();
  _bindSort();
  _bindFilters();
  _bindGlobalSearch();

  _unsubPlaza = onPlazaChange(nextPlaza => {
    _reloadForPlaza(nextPlaza);
  });

  if (!_state.plaza) {
    _renderNoPlaza();
    return;
  }
  _startIncidenciasListener(_state.plaza);
}

export function unmount() {
  _cleanup();
}

function _cleanup() {
  if (typeof _unsubIncidencias === 'function') {
    try { _unsubIncidencias(); } catch (_) {}
  }
  if (typeof _unsubPlaza === 'function') {
    try { _unsubPlaza(); } catch (_) {}
  }
  if (typeof _offGlobalSearch === 'function') {
    try { _offGlobalSearch(); } catch (_) {}
  }
  _unsubIncidencias = null;
  _unsubPlaza = null;
  _offGlobalSearch = null;
  _container = null;
  _state = null;
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_state || !_container) return;
    const detailRoute = String(event?.detail?.route || '');
    if (!(detailRoute.startsWith('/app/incidencias') || detailRoute === '/incidencias')) return;
    const query = String(event?.detail?.query || '');
    _state.query = query;
    const input = q('incAppSearch');
    if (input && input.value !== query) input.value = query;
    _applyFiltersAndSort();
    _renderSummary();
    _renderList();
    _syncDetailSelection();
  };
  window.addEventListener('mex:global-search', handler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', handler);
}

function _stopIncidenciasListener() {
  if (typeof _unsubIncidencias === 'function') {
    try { _unsubIncidencias(); } catch (_) {}
  }
  _unsubIncidencias = null;
}

function _reloadForPlaza(nextPlaza) {
  if (!_state || !_container) return;
  const normalized = String(nextPlaza || '').toUpperCase().trim();
  if (normalized === _state.plaza) return;
  _state.plaza = normalized;
  _state.allItems = [];
  _state.items = [];
  _state.selectedId = null;
  _setPlazaBadge(normalized);
  _renderSummary();
  _renderListSkeleton();
  _renderDetail(null);
  if (!normalized) {
    _stopIncidenciasListener();
    _renderNoPlaza();
    return;
  }
  _startIncidenciasListener(normalized);
}

function _startIncidenciasListener(plaza) {
  _stopIncidenciasListener();
  _renderListSkeleton();

  try {
    _unsubIncidencias = subscribeIncidencias({
      plaza,
      onData: rows => {
        if (!_state || !_container) return;
        _state.allItems = Array.isArray(rows) ? rows : [];
        _applyFiltersAndSort();
        _renderSummary();
        _renderList();
        _syncDetailSelection();
      },
      onError: error => {
        if (!_container) return;
        if (String(error?.code || '').toLowerCase() === 'permission-denied') {
          _renderListError('No tienes permisos para ver incidencias de esta plaza.');
          return;
        }
        _renderListError(error?.message || 'Error al cargar incidencias desde notas_admin.');
      }
    });
  } catch (error) {
    _renderListError(error?.message || 'Error al iniciar lectura de incidencias.');
  }
}

function _applyFiltersAndSort() {
  if (!_state) return;
  const query = _state.query.toLowerCase().trim();
  let items = [..._state.allItems];

  if (_state.filter === 'abiertas') items = items.filter(_isOpen);
  if (_state.filter === 'criticas') items = items.filter(_isCritical);
  if (_state.filter === 'resueltas') items = items.filter(_isResolved);

  if (query) {
    items = items.filter(it =>
      _safeText(it.mva).toLowerCase().includes(query) ||
      _safeText(it.titulo).toLowerCase().includes(query) ||
      _safeText(it.descripcion).toLowerCase().includes(query) ||
      _safeText(it.creadoPor || it.autor || it.responsable).toLowerCase().includes(query)
    );
  }

  items.sort((a, b) => {
    const dir = _state.sortDir === 'asc' ? 1 : -1;
    let av = 0;
    let bv = 0;
    if (_state.sortField === 'fecha') {
      av = _dateMs(a.creadoEn || a.actualizadoEn || a.fecha);
      bv = _dateMs(b.creadoEn || b.actualizadoEn || b.fecha);
    } else if (_state.sortField === 'prioridad') {
      av = PRIORITY_ORDER[String(a.prioridad || '').toLowerCase()] ?? 99;
      bv = PRIORITY_ORDER[String(b.prioridad || '').toLowerCase()] ?? 99;
    } else {
      av = STATE_ORDER[_normalizeState(a.estado)] ?? 99;
      bv = STATE_ORDER[_normalizeState(b.estado)] ?? 99;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  _state.items = items;
}

function _bindTopActions() {
  qs('[data-inc-top]')?.addEventListener('click', event => {
    const appRoute = event.target.closest('[data-app-route]');
    if (appRoute && _state?.navigate) {
      event.preventDefault();
      _state.navigate(appRoute.dataset.appRoute);
    }
  });
}

function _bindSearch() {
  q('incAppSearch')?.addEventListener('input', event => {
    if (!_state) return;
    _state.query = event.target.value || '';
    _applyFiltersAndSort();
    _renderSummary();
    _renderList();
    _syncDetailSelection();
  });
}

function _bindSort() {
  q('incAppSort')?.addEventListener('change', event => {
    if (!_state) return;
    const [field, dir] = String(event.target.value || 'fecha:desc').split(':');
    _state.sortField = field || 'fecha';
    _state.sortDir = dir || 'desc';
    _applyFiltersAndSort();
    _renderList();
    _syncDetailSelection();
  });
}

function _bindFilters() {
  qsa('[data-inc-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_state) return;
      _state.filter = btn.dataset.incFilter || 'all';
      qsa('[data-inc-filter]').forEach(chip => chip.classList.toggle('inc-app-chip--active', chip === btn));
      _applyFiltersAndSort();
      _renderSummary();
      _renderList();
      _syncDetailSelection();
    });
  });
}

function _renderNoPlaza() {
  _renderSummary();
  _renderDetail(null);
  const list = q('incAppList');
  if (!list) return;
  list.innerHTML = `<div style="padding:38px;text-align:center;color:#94a3b8;font-size:13px;">Selecciona una plaza para ver las incidencias.</div>`;
}

function _renderListSkeleton() {
  const list = q('incAppList');
  if (!list) return;
  list.innerHTML = `
    <div style="padding:32px;text-align:center;color:#94a3b8;">
      <span class="material-symbols-outlined" style="font-size:30px;animation:incAppSpin 1s linear infinite;">sync</span>
      <div style="margin-top:10px;font-size:13px;">Cargando incidencias…</div>
    </div>`;
}

function _renderListError(msg) {
  const list = q('incAppList');
  if (!list) return;
  list.innerHTML = `
    <div style="padding:30px;text-align:center;color:#ef4444;">
      <span class="material-symbols-outlined" style="font-size:30px;">error_outline</span>
      <div style="margin-top:8px;font-size:13px;">${esc(msg)}</div>
      <a href="/incidencias" style="display:inline-flex;margin-top:14px;color:#2b6954;font-size:12px;text-decoration:underline;">Abrir módulo completo</a>
    </div>`;
}

function _renderSummary() {
  const source = _state?.allItems || [];
  const total = source.length;
  const abiertas = source.filter(_isOpen).length;
  const criticas = source.filter(_isCritical).length;
  const resueltas = source.filter(_isResolved).length;
  _setText('incAppSummaryTotal', total);
  _setText('incAppSummaryOpen', abiertas);
  _setText('incAppSummaryCritical', criticas);
  _setText('incAppSummaryResolved', resueltas);
}

function _renderList() {
  const list = q('incAppList');
  if (!list || !_state) return;
  if (!_state.items.length) {
    list.innerHTML = `<div style="padding:38px;text-align:center;color:#94a3b8;font-size:13px;">Sin incidencias para los filtros aplicados.</div>`;
    return;
  }

  list.innerHTML = _state.items.map(item => {
    const state = _normalizeState(item.estado);
    const priority = String(item.prioridad || '').toLowerCase();
    return `
      <button data-inc-row="${esc(item.id)}" style="width:100%;text-align:left;border:1px solid #e2e8f0;background:#fff;border-radius:12px;padding:12px 14px;cursor:pointer;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:8px;height:8px;border-radius:999px;background:${PRIORITY_COLOR[priority] || '#94a3b8'};"></span>
          <span style="font-size:12px;font-weight:800;color:#0f172a;">${esc(item.mva || 'SIN UNIDAD')}</span>
          <span style="margin-left:auto;font-size:10px;font-weight:700;color:#64748b;">${esc(_labelState(state))}</span>
        </div>
        <div style="margin-top:6px;font-size:13px;font-weight:700;color:#1e293b;">${esc(item.titulo || 'Sin título')}</div>
        <div style="margin-top:3px;font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${esc(item.descripcion || 'Sin descripción')}
        </div>
        <div style="margin-top:6px;font-size:10px;color:#94a3b8;">
          ${esc(String(priority || 'baja').toUpperCase())} · ${esc(_shortDate(item.creadoEn || item.fecha))} · ${esc(item.creadoPor || item.autor || item.responsable || '—')}
        </div>
      </button>
    `;
  }).join('');

  list.querySelectorAll('[data-inc-row]').forEach(el => {
    el.addEventListener('click', () => {
      _state.selectedId = el.dataset.incRow;
      _syncDetailSelection();
    });
  });
}

function _syncDetailSelection() {
  if (!_state) return;
  if (!_state.selectedId) {
    _renderDetail(null);
    return;
  }
  const item = _state.allItems.find(it => it.id === _state.selectedId);
  if (!item) {
    _state.selectedId = null;
    _renderDetail(null);
    return;
  }
  _renderDetail(item);
}

function _renderDetail(item) {
  const detail = q('incAppDetail');
  if (!detail) return;
  if (!item) {
    detail.innerHTML = `<div style="padding:20px;color:#94a3b8;font-size:12px;">Selecciona una incidencia para ver detalle.</div>`;
    return;
  }
  const state = _normalizeState(item.estado);
  const priority = String(item.prioridad || '').toLowerCase();
  const evidencias = Array.isArray(item.evidencias)
    ? item.evidencias
    : (Array.isArray(item.evidenciaUrls) ? item.evidenciaUrls : []);

  detail.innerHTML = `
    <div style="padding:16px;">
      <div style="font-size:16px;font-weight:800;color:#0f172a;">${esc(item.titulo || 'Sin título')}</div>
      <div style="margin-top:6px;font-size:11px;color:#64748b;">${esc(_labelState(state))} · PRIORIDAD ${esc(String(priority || 'baja').toUpperCase())}</div>
      <div style="margin-top:14px;font-size:12px;color:#334155;line-height:1.6;">${esc(item.descripcion || 'Sin descripción')}</div>
      <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${_detailField('Autor', item.creadoPor || item.autor || item.responsable || '—')}
        ${_detailField('Fecha', _longDate(item.creadoEn || item.fecha))}
        ${_detailField('MVA', item.mva || item.unidad || '—')}
        ${_detailField('Plaza', item.plaza || _state.plaza || '—')}
      </div>
      <div style="margin-top:14px;">
        <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;">Evidencias</div>
        ${evidencias.length ? `
          <div style="margin-top:6px;display:flex;flex-direction:column;gap:5px;">
            ${evidencias.map(url => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#2b6954;word-break:break-all;">${esc(url)}</a>`).join('')}
          </div>
        ` : `<div style="margin-top:6px;font-size:12px;color:#64748b;">Sin evidencias adjuntas.</div>`}
      </div>
      <a href="/incidencias" style="display:inline-flex;margin-top:16px;color:#2b6954;font-size:12px;text-decoration:underline;">Abrir módulo completo</a>
    </div>
  `;
}

function _detailField(label, value) {
  return `
    <div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:8px 10px;">
      <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;">${esc(label)}</div>
      <div style="font-size:12px;color:#1e293b;font-weight:600;">${esc(value)}</div>
    </div>`;
}

function _setPlazaBadge(plaza) {
  const badge = q('incAppPlaza');
  if (badge) badge.textContent = plaza || '—';
}

function _setText(id, value) {
  const el = q(id);
  if (el) el.textContent = String(value);
}

function _labelState(state) {
  if (state === 'abierta') return 'ABIERTA';
  if (state === 'en_proceso') return 'EN PROCESO';
  if (state === 'resuelta') return 'RESUELTA';
  if (state === 'cerrada') return 'CERRADA';
  return 'SIN ESTADO';
}

function _shortDate(value) {
  const ms = _dateMs(value);
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function _longDate(value) {
  const ms = _dateMs(value);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function _skeleton({ plaza, role, user }) {
  return `
    <style>
      @keyframes incAppSpin { to { transform: rotate(360deg); } }
      .inc-app-chip--active { background:#2b6954 !important;color:#fff !important;border-color:#2b6954 !important; }
    </style>
    <div style="padding:20px 20px 48px;max-width:980px;margin:0 auto;font-family:'Inter',sans-serif;">
      <div data-inc-top style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
        <a data-app-route="/app/dashboard" href="/app/dashboard" style="font-size:12px;color:#64748b;text-decoration:none;display:inline-flex;align-items:center;gap:5px;">
          <span class="material-symbols-outlined" style="font-size:16px;">arrow_back</span> Volver al dashboard
        </a>
        <span style="color:#cbd5e1;">·</span>
        <span style="font-size:12px;color:#0f172a;font-weight:700;">Incidencias</span>
        <span id="incAppPlaza" style="margin-left:auto;font-size:11px;font-weight:700;color:#2b6954;background:#dcfce7;padding:3px 10px;border-radius:100px;">${esc(plaza || '—')}</span>
        <a href="/incidencias" style="font-size:11px;color:#64748b;text-decoration:none;border:1px solid #e2e8f0;border-radius:8px;padding:5px 10px;">Abrir módulo completo</a>
      </div>

      <div style="margin-bottom:14px;">
        <h1 style="margin:0;font-size:24px;font-weight:900;color:#0f172a;">Incidencias</h1>
        <p style="margin:4px 0 0;font-size:13px;color:#64748b;">${esc(user)} · ${esc(role || 'AUXILIAR')}</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:14px;">
        ${_summaryCard('incAppSummaryTotal', 'Total')}
        ${_summaryCard('incAppSummaryOpen', 'Abiertas')}
        ${_summaryCard('incAppSummaryCritical', 'Críticas')}
        ${_summaryCard('incAppSummaryResolved', 'Resueltas')}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
        <input id="incAppSearch" type="search" placeholder="Buscar por MVA, título, descripción o autor..." style="flex:1;min-width:260px;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:12px;">
        <select id="incAppSort" style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:12px;">
          <option value="fecha:desc">Fecha (más recientes)</option>
          <option value="fecha:asc">Fecha (más antiguas)</option>
          <option value="prioridad:asc">Prioridad</option>
          <option value="estado:asc">Estado</option>
        </select>
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
        ${FILTERS.map((filter, idx) => `
          <button data-inc-filter="${filter.id}" class="${idx === 0 ? 'inc-app-chip--active' : ''}" style="border:1px solid #e2e8f0;border-radius:100px;padding:4px 12px;background:#fff;font-size:11px;font-weight:700;color:#64748b;cursor:pointer;">
            ${esc(filter.label)}
          </button>`).join('')}
      </div>

      <div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:12px;align-items:start;">
        <div id="incAppList" style="display:flex;flex-direction:column;gap:8px;"></div>
        <aside id="incAppDetail" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;min-height:140px;"></aside>
      </div>
    </div>
  `;
}

function _summaryCard(id, label) {
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;">
      <div id="${id}" style="font-size:22px;font-weight:900;color:#0f172a;">0</div>
      <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">${label}</div>
    </div>`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
