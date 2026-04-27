import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { subscribeCuadre } from '/js/app/features/cuadre/cuadre-data.js';

let _container = null;
let _state = null;
let _unsubData = null;
let _unsubPlaza = null;
let _offGlobalSearch = null;
let _cssLink = null;

const q = selector => _container?.querySelector(selector) ?? null;
const qsa = selector => Array.from(_container?.querySelectorAll(selector) ?? []);

const ESTADO_ORDER = { LISTO: 1, SUCIO: 2, MANTENIMIENTO: 3, RESGUARDO: 4, TRASLADO: 5, 'NO ARRENDABLE': 6, RETENIDA: 7, VENTA: 8, HYP: 9, 'EN RENTA': 10, EXTERNO: 11 };
const ESTADO_COLOR = { LISTO: '#16a34a', SUCIO: '#d97706', MANTENIMIENTO: '#dc2626', TRASLADO: '#7c3aed', RESGUARDO: '#475569', EXTERNO: '#6d28d9' };
const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'doble-cero', label: 'Doble cero' },
  { id: 'apartado', label: 'Apartados' },
  { id: 'urgente', label: 'Urgente' },
  { id: 'resguardo', label: 'Resguardo' }
];

function _makeState(plaza) {
  return { plaza, allItems: [], items: [], filter: 'all', query: '', sortField: 'estado', sortDir: 'asc', selectedId: null, navigate: null, tab: 'regular' };
}

export async function mount(ctx) {
  _cleanup();
  _container = ctx.container;
  _state = _makeState(String(getCurrentPlaza() || ctx?.state?.currentPlaza || '').toUpperCase().trim());
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
  _unsubPlaza = onPlazaChange(next => _reloadForPlaza(next));
  if (!_state.plaza) return _renderNoPlaza();
  _startListener(_state.plaza);
}

export function unmount() { _cleanup(); }

function _cleanup() {
  if (typeof _unsubData === 'function') { try { _unsubData(); } catch (_) {} }
  if (typeof _unsubPlaza === 'function') { try { _unsubPlaza(); } catch (_) {} }
  if (typeof _offGlobalSearch === 'function') { try { _offGlobalSearch(); } catch (_) {} }
  _unsubData = null;
  _unsubPlaza = null;
  _offGlobalSearch = null;
  if (_cssLink?.parentNode) _cssLink.parentNode.removeChild(_cssLink);
  _cssLink = null;
  _container = null;
  _state = null;
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_state || !_container) return;
    const detailRoute = String(event?.detail?.route || '');
    if (!(detailRoute.startsWith('/app/cuadre') || detailRoute === '/cuadre')) return;
    const query = String(event?.detail?.query || '');
    _state.query = query;
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

function _reloadForPlaza(nextPlaza) {
  if (!_state || !_container) return;
  const normalized = String(nextPlaza || '').toUpperCase().trim();
  if (normalized === _state.plaza) return;
  _state.plaza = normalized;
  _state.allItems = [];
  _state.items = [];
  _state.selectedId = null;
  _setText('#cqvPlaza', normalized || '—');
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
  if (typeof _unsubData === 'function') { try { _unsubData(); } catch (_) {} }
  _unsubData = null;
}

function _startListener(plaza) {
  _stopListener();
  _renderTableSkeleton();
  _unsubData = subscribeCuadre({
    plaza,
    onData: rows => {
      if (!_state || !_container) return;
      _state.allItems = Array.isArray(rows) ? rows : [];
      _applyFiltersAndSort();
      _renderSummary();
      _renderTable();
      _syncDetail();
    },
    onError: err => _renderTableError(String(err?.code || '').includes('permission') ? 'Sin permisos para ver cuadre de esta plaza.' : (err?.message || 'Error al cargar cuadre.'))
  });
}

function _bindEvents() {
  q('[data-cqv-top]')?.addEventListener('click', e => {
    const route = e.target.closest('[data-app-route]');
    if (route && _state?.navigate) {
      e.preventDefault();
      _state.navigate(route.dataset.appRoute);
    }
  });
  q('#cqvSort')?.addEventListener('change', e => {
    const [field, dir] = String(e.target.value || 'estado:asc').split(':');
    _state.sortField = field || 'estado';
    _state.sortDir = dir || 'asc';
    _applyFiltersAndSort();
    _renderTable();
    _syncDetail();
  });
  qsa('[data-cqv-tab]').forEach(btn => btn.addEventListener('click', () => {
    _state.tab = btn.dataset.cqvTab || 'regular';
    qsa('[data-cqv-tab]').forEach(x => x.classList.toggle('is-active', x === btn));
  }));
  qsa('[data-cqv-filter]').forEach(btn => btn.addEventListener('click', () => {
    _state.filter = btn.dataset.cqvFilter || 'all';
    qsa('[data-cqv-filter]').forEach(x => x.classList.toggle('is-active', x === btn));
    _applyFiltersAndSort();
    _renderSummary();
    _renderTable();
    _syncDetail();
  }));
}

function _matchFilter(item) {
  const f = _state.filter;
  if (f === 'all') return true;
  if (f === 'resguardo') return item.estado === 'RESGUARDO';
  if (f === 'doble-cero') return /doble\s*cero|00/i.test(item.notas || '');
  if (f === 'apartado') return /apartad/i.test(item.notas || '');
  if (f === 'urgente') return /urgent|⚠|prior/i.test(item.notas || '');
  return true;
}

function _applyFiltersAndSort() {
  const query = _state.query.toLowerCase().trim();
  let items = _state.allItems.filter(_matchFilter);
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
}

function _renderNoPlaza() {
  _renderSummary();
  _renderDetail(null);
  _setHTML('#cqvTableBody', `<tr><td colspan="7"><div class="cqv__empty">Selecciona una plaza para ver el cuadre.</div></td></tr>`);
}

function _renderTableSkeleton() {
  _setHTML('#cqvTableBody', `<tr><td colspan="7"><div class="cqv__empty">Cargando unidades...</div></td></tr>`);
}

function _renderTableError(msg) {
  _setHTML('#cqvTableBody', `<tr><td colspan="7"><div class="cqv__empty">${esc(msg)}<br><a class="cqv__btn" href="/cuadre" style="margin-top:10px;">Abrir módulo completo</a></div></td></tr>`);
}

function _renderSummary() {
  const src = _state?.allItems || [];
  _setText('#cqvSummaryTotal', src.length);
  _setText('#cqvSummaryListo', src.filter(x => x.estado === 'LISTO').length);
  _setText('#cqvSummaryResguardo', src.filter(x => x.estado === 'RESGUARDO').length);
}

function _renderTable() {
  const tbody = q('#cqvTableBody');
  if (!tbody) return;
  if (!_state.items.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="cqv__empty">Sin unidades para los filtros aplicados.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = _state.items.map(item => {
    const selected = item.id === _state.selectedId ? 'is-selected' : '';
    return `<tr class="cqv__row ${selected}" data-cqv-row="${esc(item.id)}">
      <td><strong>${esc(item.mva || '—')}</strong></td>
      <td>${_badge(item.categoria || 'S/C', '#0ea5e9', '#e0f2fe')}</td>
      <td>${esc(item.modelo || '—')}</td>
      <td>${esc(item.placas || '—')}</td>
      <td>${_badge(item.gasolina || 'N/A', '#334155', '#e2e8f0')}</td>
      <td>${_estadoBadge(item.estado || 'SIN ESTADO')}</td>
      <td>${_badge(item.ubicacion || '—', '#4338ca', '#e0e7ff')}</td>
    </tr>`;
  }).join('');
  qsa('[data-cqv-row]').forEach(row => row.addEventListener('click', () => {
    _state.selectedId = row.dataset.cqvRow;
    _renderTable();
    _syncDetail();
  }));
}

function _syncDetail() {
  if (!_state.selectedId) return _renderDetail(null);
  const item = _state.allItems.find(x => x.id === _state.selectedId);
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
    panel.innerHTML = `<div class="cqv__empty">Selecciona una unidad para ver detalle.</div>`;
    return;
  }
  panel.innerHTML = `
    <div class="cqv__detail">
      <h3 style="margin:0 0 8px;font-size:18px;">${esc(item.mva || '—')}</h3>
      <div style="margin-bottom:8px;">${_estadoBadge(item.estado || 'SIN ESTADO')}</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:8px;">${esc(item.modelo || '')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${_detailCell('Categoría', item.categoria || '—')}
        ${_detailCell('Placas', item.placas || '—')}
        ${_detailCell('Gasolina', item.gasolina || '—')}
        ${_detailCell('Ubicación', item.ubicacion || '—')}
        ${_detailCell('Plaza', item.plaza || _state.plaza || '—')}
        ${_detailCell('Responsable', item.updatedBy || '—')}
      </div>
      ${item.notas ? `<div style="margin-top:10px;font-size:12px;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;padding:8px;border-radius:8px;">${esc(item.notas)}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
        <a class="cqv__btn" href="/cuadre">Abrir módulo completo</a>
        <a class="cqv__btn" href="/mapa">Ver mapa</a>
      </div>
    </div>`;
}

function _layout({ plaza, role, user }) {
  return `
    <section class="cqv">
      <div class="cqv__top" data-cqv-top>
        <div class="cqv__title-wrap">
          <h1 class="cqv__title">CONSOLA DE PATIO</h1>
          <span class="cqv__beta">BETA</span>
        </div>
        <div class="cqv__actions">
          <button class="cqv__btn" type="button">MÁS CONTROLES</button>
          <a class="cqv__btn cqv__btn--primary" href="/mapa">VER MAPA</a>
          <a class="cqv__btn" href="/cuadre">Abrir módulo completo</a>
          <a class="cqv__btn" data-app-route="/app/dashboard" href="/app/dashboard">Volver al dashboard</a>
        </div>
      </div>
      <div class="cqv__meta">
        <span id="cqvPlaza" class="cqv__plaza">${esc(plaza || '—')}</span>
        <span>${esc(user)}</span>
        <span>·</span>
        <span>${esc(role || 'AUXILIAR')}</span>
      </div>
      <div class="cqv__grid">
        <div class="cqv__panel cqv__panel--left">
          <div class="cqv__tabs">
            <button class="cqv__tab is-active" data-cqv-tab="regular" type="button">FLOTA REGULAR</button>
            <button class="cqv__tab" data-cqv-tab="admins" type="button">CUADRE ADMINS</button>
          </div>
          <div class="cqv__search-row">
            <select id="cqvSort" class="cqv__search" style="max-width:220px;">
              <option value="estado:asc">Estado</option>
              <option value="mva:asc">MVA (A-Z)</option>
              <option value="mva:desc">MVA (Z-A)</option>
              <option value="fecha:desc">Fecha reciente</option>
            </select>
          </div>
          <div class="cqv__chips">${FILTERS.map((f, i) => `<button class="cqv__chip ${i === 0 ? 'is-active' : ''}" data-cqv-filter="${f.id}" type="button">${esc(f.label)}</button>`).join('')}</div>
          <div class="cqv__table-wrap">
            <table class="cqv__table">
              <thead><tr><th>MVA</th><th>Categoría</th><th>Modelo</th><th>Placas</th><th>Gas</th><th>Estado</th><th>Ubicación</th></tr></thead>
              <tbody id="cqvTableBody"></tbody>
            </table>
          </div>
        </div>
        <aside class="cqv__side">
          <div class="cqv__panel cqv__kpi"><div class="cqv__kpi-title">Total flota</div><div id="cqvSummaryTotal" class="cqv__kpi-value">0</div></div>
          <div class="cqv__panel cqv__kpi"><div class="cqv__kpi-title">Listos renta</div><div id="cqvSummaryListo" class="cqv__kpi-value" style="color:#16a34a;">0</div></div>
          <div class="cqv__panel cqv__kpi"><div class="cqv__kpi-title">Resguardo</div><div id="cqvSummaryResguardo" class="cqv__kpi-value" style="color:#475569;">0</div></div>
          <div class="cqv__panel cqv__detail">
            <a class="cqv__btn" href="/cuadre" style="width:100%;justify-content:center;">Registrar nueva unidad</a>
            <div style="margin-top:8px;font-size:12px;color:#64748b;">Nuevo registro</div>
            <input class="cqv__search" placeholder="Buscar en base maestra" disabled>
          </div>
          <div id="cqvDetail" class="cqv__panel"></div>
        </aside>
      </div>
    </section>`;
}

function _detailCell(label, value) {
  return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fff;"><div style="font-size:10px;text-transform:uppercase;color:#94a3b8;">${esc(label)}</div><div style="font-size:12px;color:#1e293b;font-weight:700;">${esc(value)}</div></div>`;
}

function _badge(text, color, bg) { return `<span class="cqv__badge" style="color:${color};background:${bg};">${esc(text)}</span>`; }
function _estadoBadge(estado) { return _badge(estado, ESTADO_COLOR[estado] || '#475569', (ESTADO_COLOR[estado] || '#475569') + '22'); }
function _setText(selector, value) { const el = q(selector); if (el) el.textContent = String(value ?? ''); }
function _setHTML(selector, html) { const el = q(selector); if (el) el.innerHTML = html; }

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
