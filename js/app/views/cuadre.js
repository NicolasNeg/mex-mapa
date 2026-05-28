// ═══════════════════════════════════════════════════════════
//  App Shell — Cuadre SaaS
//  Vista independiente del mapa: inventario, búsqueda por unidad
//  y bitácora operativa desde /app/cuadre?query=MVA.
// ═══════════════════════════════════════════════════════════

import { getState, onPlazaChange } from '/js/app/app-state.js';
import {
  getCuadreSnapshot,
  getUnidadBitacora,
  subscribeCuadre
} from '/js/app/features/cuadre/cuadre-data.js';

let _ctx = null;
let _container = null;
let _unsubscribeCuadre = null;
let _unsubscribePlaza = null;
let _resizeHandler = null;
let _state = null;

const FILTERS = [
  { id: 'todos', label: 'Todo' },
  { id: 'listo', label: 'Listos' },
  { id: 'sucio', label: 'Sucios' },
  { id: 'mantenimiento', label: 'Manto' },
  { id: 'taller', label: 'Taller' },
  { id: 'externo', label: 'Externos' },
  { id: 'alertas', label: 'Alertas' },
];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function up(value) {
  return String(value || '').trim().toUpperCase();
}

function ensureCss() {
  if (document.querySelector('link[data-app-cuadre-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-cuadre.css';
  link.setAttribute('data-app-cuadre-css', '1');
  document.head.appendChild(link);
}

function parseUrlState() {
  const url = new URL(window.location.href);
  const query = up(url.searchParams.get('query') || url.searchParams.get('mva') || '');
  const filter = String(url.searchParams.get('filter') || 'todos').toLowerCase();
  return {
    query,
    filter: FILTERS.some(item => item.id === filter) ? filter : 'todos'
  };
}

function formatDate(value) {
  if (!value) return 'Sin fecha';
  let date = null;
  if (typeof value?.toDate === 'function') date = value.toDate();
  else if (typeof value?.seconds === 'number') date = new Date(value.seconds * 1000);
  else if (typeof value === 'number') date = new Date(value);
  else date = new Date(value);
  if (!date || Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function dateMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number(value) || 0;
}

function matchesFilter(unit, filter) {
  const estado = up(unit.estado);
  const ubi = up(unit.ubicacion);
  const tipo = up(unit.tipo);
  const notas = up(unit.notas);
  if (filter === 'listo') return estado === 'LISTO';
  if (filter === 'sucio') return estado === 'SUCIO';
  if (filter === 'mantenimiento') return estado.includes('MANTEN') || estado === 'MANTO';
  if (filter === 'taller') return ubi === 'TALLER';
  if (filter === 'externo') return tipo === 'EXTERNO' || ubi === 'EXTERNO';
  if (filter === 'alertas') return notas.includes('URGENTE') || notas.includes('APARTAD') || notas.includes('DOBLE CERO');
  return true;
}

function unitSearchText(unit) {
  return [
    unit.mva,
    unit.modelo,
    unit.placas,
    unit.categoria,
    unit.estado,
    unit.ubicacion,
    unit.pos,
    unit.notas
  ].map(up).join(' ');
}

function getVisibleUnits() {
  const query = up(_state?.query);
  return (_state?.units || [])
    .filter(unit => matchesFilter(unit, _state.filter))
    .filter(unit => !query || unitSearchText(unit).includes(query))
    .sort((a, b) => up(a.mva).localeCompare(up(b.mva), 'es'));
}

function getSelectedUnit() {
  const selected = up(_state?.selectedMva);
  if (!selected) return null;
  return (_state?.units || []).find(unit => up(unit.mva) === selected) || null;
}

function buildStats(units) {
  const stats = {
    total: units.length,
    listo: 0,
    sucio: 0,
    mantenimiento: 0,
    taller: 0,
    externos: 0,
    alertas: 0
  };
  units.forEach(unit => {
    if (matchesFilter(unit, 'listo')) stats.listo += 1;
    if (matchesFilter(unit, 'sucio')) stats.sucio += 1;
    if (matchesFilter(unit, 'mantenimiento')) stats.mantenimiento += 1;
    if (matchesFilter(unit, 'taller')) stats.taller += 1;
    if (matchesFilter(unit, 'externo')) stats.externos += 1;
    if (matchesFilter(unit, 'alertas')) stats.alertas += 1;
  });
  return stats;
}

function statusClass(value) {
  const estado = up(value);
  if (estado === 'LISTO') return 'is-ready';
  if (estado === 'SUCIO') return 'is-dirty';
  if (estado.includes('MANTEN') || estado === 'MANTO') return 'is-maint';
  if (estado === 'EXTERNO') return 'is-external';
  return 'is-neutral';
}

function renderShell() {
  const stats = buildStats(_state.units);
  const visible = getVisibleUnits();
  const selected = getSelectedUnit();
  const selectedMva = up(_state.selectedMva || _state.query);
  const busyClass = _state.loading ? 'is-loading' : '';

  _container.innerHTML = `
    <section class="cqv ${busyClass}" aria-label="Cuadre SaaS">
      <header class="cqv-hero">
        <div class="cqv-hero__copy">
          <span class="cqv-kicker">Cuadre SaaS</span>
          <h1>Inventario operativo</h1>
          <p>${esc(_state.plaza || 'Sin plaza')} · ${stats.total} unidades · bitácora por MVA</p>
        </div>
        <div class="cqv-search" role="search">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input id="cqvQuery" type="search" value="${esc(_state.query)}" placeholder="Buscar unidad, placas, modelo o posición" autocomplete="off">
          <button class="cqv-icon-btn" type="button" data-action="clear-query" title="Limpiar búsqueda">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </header>

      <div class="cqv-metrics" aria-label="Resumen de cuadre">
        ${renderMetric('Total', stats.total, 'directions_car')}
        ${renderMetric('Listos', stats.listo, 'check_circle')}
        ${renderMetric('Sucios', stats.sucio, 'cleaning_services')}
        ${renderMetric('Alertas', stats.alertas, 'priority_high')}
      </div>

      <div class="cqv-workspace">
        <aside class="cqv-sidebar" aria-label="Filtros de inventario">
          <div class="cqv-filter-list">
            ${FILTERS.map(item => `
              <button type="button" class="cqv-filter ${_state.filter === item.id ? 'is-active' : ''}" data-filter="${esc(item.id)}">
                <span>${esc(item.label)}</span>
                <strong>${countForFilter(stats, item.id)}</strong>
              </button>
            `).join('')}
          </div>
          <button type="button" class="cqv-action" data-action="refresh">
            <span class="material-symbols-outlined">sync</span>
            Actualizar
          </button>
          <button type="button" class="cqv-action" data-action="open-incidencia" ${selectedMva ? '' : 'disabled'}>
            <span class="material-symbols-outlined">add_notes</span>
            Incidencia
          </button>
        </aside>

        <main class="cqv-table-panel">
          <div class="cqv-table-head">
            <div>
              <strong>${visible.length}</strong>
              <span>resultado${visible.length === 1 ? '' : 's'}</span>
            </div>
            ${_state.error ? `<p class="cqv-error">${esc(_state.error)}</p>` : ''}
          </div>
          <div class="cqv-table-wrap">
            <table class="cqv-table">
              <thead>
                <tr>
                  <th>MVA</th>
                  <th>Estado</th>
                  <th>Ubicación</th>
                  <th>Pos</th>
                  <th>Modelo</th>
                  <th>Placas</th>
                  <th>Gas</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                ${visible.length ? visible.map(renderUnitRow).join('') : renderEmptyRows()}
              </tbody>
            </table>
          </div>
        </main>

        <aside class="cqv-detail" aria-label="Detalle y bitácora">
          ${selected ? renderDetail(selected) : renderNoSelection(selectedMva)}
          ${renderBitacora()}
        </aside>
      </div>
    </section>
  `;
  bindEvents();
}

function renderMetric(label, value, icon) {
  return `
    <div class="cqv-metric">
      <span class="material-symbols-outlined">${esc(icon)}</span>
      <div>
        <strong>${Number(value || 0)}</strong>
        <small>${esc(label)}</small>
      </div>
    </div>
  `;
}

function countForFilter(stats, id) {
  if (id === 'todos') return stats.total;
  if (id === 'externo') return stats.externos;
  return stats[id] ?? 0;
}

function renderUnitRow(unit) {
  const selected = up(unit.mva) === up(_state.selectedMva);
  return `
    <tr class="cqv-row ${selected ? 'is-selected' : ''}" data-mva="${esc(unit.mva)}">
      <td><button type="button" class="cqv-mva" data-mva="${esc(unit.mva)}">${esc(unit.mva || 'S/MVA')}</button></td>
      <td><span class="cqv-badge ${statusClass(unit.estado)}">${esc(unit.estado || 'SIN ESTADO')}</span></td>
      <td>${esc(unit.ubicacion || '-')}</td>
      <td class="cqv-mono">${esc(unit.pos || '-')}</td>
      <td>${esc(unit.modelo || '-')}</td>
      <td class="cqv-mono">${esc(unit.placas || '-')}</td>
      <td>${esc(unit.gasolina || '-')}</td>
      <td class="cqv-notes-cell">${esc(unit.notas || '-')}</td>
    </tr>
  `;
}

function renderEmptyRows() {
  return `
    <tr>
      <td colspan="8">
        <div class="cqv-empty">
          <span class="material-symbols-outlined">manage_search</span>
          <strong>Sin unidades en esta búsqueda</strong>
          <small>Ajusta el query o cambia de filtro.</small>
        </div>
      </td>
    </tr>
  `;
}

function renderDetail(unit) {
  return `
    <section class="cqv-detail-card">
      <div class="cqv-detail-title">
        <div>
          <span>Unidad</span>
          <h2>${esc(unit.mva)}</h2>
        </div>
        <span class="cqv-badge ${statusClass(unit.estado)}">${esc(unit.estado || 'SIN ESTADO')}</span>
      </div>
      <dl class="cqv-defs">
        ${defItem('Modelo', unit.modelo)}
        ${defItem('Placas', unit.placas)}
        ${defItem('Categoría', unit.categoria)}
        ${defItem('Ubicación', unit.ubicacion)}
        ${defItem('Posición', unit.pos)}
        ${defItem('Gasolina', unit.gasolina)}
      </dl>
      ${unit.notas ? `<div class="cqv-notes"><strong>Notas</strong><p>${esc(unit.notas)}</p></div>` : ''}
    </section>
  `;
}

function defItem(label, value) {
  return `<div><dt>${esc(label)}</dt><dd>${esc(value || '-')}</dd></div>`;
}

function renderNoSelection(mva) {
  return `
    <section class="cqv-detail-card cqv-detail-card--empty">
      <span class="material-symbols-outlined">route</span>
      <h2>${mva ? esc(mva) : 'Elige una unidad'}</h2>
      <p>${mva ? 'No encontramos esa unidad en el cuadre activo.' : 'Selecciona un MVA para ver su detalle y bitácora.'}</p>
    </section>
  `;
}

function renderBitacora() {
  const selectedMva = up(_state.selectedMva || _state.query);
  if (!selectedMva) {
    return `
      <section class="cqv-log">
        <div class="cqv-log-head"><h3>Bitácora</h3></div>
        <div class="cqv-log-empty">Selecciona una unidad para consultar sus movimientos.</div>
      </section>
    `;
  }
  const items = [...(_state.bitacora || [])].sort((a, b) => dateMs(b.timestamp || b.fecha || b.creadoEn) - dateMs(a.timestamp || a.fecha || a.creadoEn));
  return `
    <section class="cqv-log">
      <div class="cqv-log-head">
        <h3>Bitácora</h3>
        <span>${esc(selectedMva)}</span>
      </div>
      ${_state.bitacoraLoading ? '<div class="cqv-log-empty">Cargando movimientos...</div>' : ''}
      ${!_state.bitacoraLoading && !items.length ? '<div class="cqv-log-empty">Sin movimientos recientes para esta unidad.</div>' : ''}
      ${items.length ? `<ol class="cqv-timeline">${items.map(renderLogItem).join('')}</ol>` : ''}
    </section>
  `;
}

function renderLogItem(item) {
  const type = up(item.tipo || item.source || 'LOG');
  return `
    <li class="cqv-timeline-item">
      <div class="cqv-timeline-dot"></div>
      <div class="cqv-timeline-body">
        <div class="cqv-timeline-top">
          <strong>${esc(type)}</strong>
          <time>${esc(formatDate(item.timestamp || item.fecha || item.creadoEn))}</time>
        </div>
        <p>${esc(item.accion || item.titulo || item.detalles || item.descripcion || 'Movimiento registrado')}</p>
        <small>${esc(item.autor || item.usuario || item.creadoPor || 'Sistema')}</small>
      </div>
    </li>
  `;
}

function bindEvents() {
  const input = _container.querySelector('#cqvQuery');
  input?.addEventListener('input', event => {
    const next = up(event.target.value);
    _state.query = next;
    const exact = _state.units.find(unit => up(unit.mva) === next);
    if (exact) selectMva(exact.mva, { push: false });
    else {
      _state.selectedMva = next.length >= 3 ? next : '';
      syncUrl({ replace: true });
      loadBitacora();
      renderShell();
    }
  });

  _container.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.filter = btn.dataset.filter || 'todos';
      syncUrl({ replace: false });
      renderShell();
    });
  });

  _container.querySelectorAll('[data-mva]').forEach(el => {
    el.addEventListener('click', event => {
      event.stopPropagation();
      selectMva(el.dataset.mva, { push: true });
    });
  });

  _container.querySelector('[data-action="clear-query"]')?.addEventListener('click', () => {
    _state.query = '';
    _state.selectedMva = '';
    _state.bitacora = [];
    syncUrl({ replace: false });
    renderShell();
  });

  _container.querySelector('[data-action="refresh"]')?.addEventListener('click', () => refreshSnapshot());
  _container.querySelector('[data-action="open-incidencia"]')?.addEventListener('click', () => {
    const mva = up(_state.selectedMva || _state.query);
    if (mva) _ctx?.navigate?.(`/app/incidencias?mva=${encodeURIComponent(mva)}`);
  });
}

function selectMva(mva, { push = false } = {}) {
  const next = up(mva);
  if (!next) return;
  _state.selectedMva = next;
  _state.query = next;
  syncUrl({ replace: !push });
  renderShell();
  loadBitacora();
}

function syncUrl({ replace = true } = {}) {
  const params = new URLSearchParams();
  if (_state.query) params.set('query', _state.query);
  if (_state.filter && _state.filter !== 'todos') params.set('filter', _state.filter);
  const next = `/app/cuadre${params.toString() ? `?${params}` : ''}`;
  if (replace) history.replaceState({}, '', next);
  else history.pushState({}, '', next);
}

async function loadBitacora() {
  const mva = up(_state.selectedMva || _state.query);
  if (!mva) return;
  _state.bitacoraLoading = true;
  renderShell();
  try {
    const items = await getUnidadBitacora({ plaza: _state.plaza, mva, limit: 80 });
    if (up(_state.selectedMva || _state.query) !== mva) return;
    _state.bitacora = items;
    _state.bitacoraLoading = false;
    renderShell();
  } catch (error) {
    _state.bitacoraLoading = false;
    _state.error = error?.message || 'No se pudo cargar la bitácora.';
    renderShell();
  }
}

async function refreshSnapshot() {
  _state.loading = true;
  renderShell();
  try {
    const rows = await getCuadreSnapshot(_state.plaza);
    _state.units = rows;
    _state.loading = false;
    _state.error = '';
    resolveSelection();
    renderShell();
    loadBitacora();
  } catch (error) {
    _state.loading = false;
    _state.error = error?.message || 'No se pudo actualizar el cuadre.';
    renderShell();
  }
}

function resolveSelection() {
  const query = up(_state.query);
  if (!query) return;
  const exact = _state.units.find(unit => up(unit.mva) === query);
  _state.selectedMva = exact ? exact.mva : query;
}

function startSubscription() {
  try { _unsubscribeCuadre?.(); } catch (_) {}
  _unsubscribeCuadre = subscribeCuadre({
    plaza: _state.plaza,
    onData(rows) {
      _state.units = Array.isArray(rows) ? rows : [];
      _state.loading = false;
      _state.error = '';
      resolveSelection();
      renderShell();
      if (up(_state.selectedMva || _state.query)) loadBitacora();
    },
    onError(error) {
      _state.loading = false;
      _state.error = error?.message || 'No se pudo leer el cuadre.';
      renderShell();
    }
  });
}

export async function mount(ctx) {
  _ctx = ctx || {};
  _container = _ctx.container;
  if (!_container) return;
  ensureCss();

  const appState = getState();
  const urlState = parseUrlState();
  _state = {
    plaza: up(appState.currentPlaza || window.getMexCurrentPlaza?.() || ''),
    query: urlState.query,
    selectedMva: urlState.query,
    filter: urlState.filter,
    units: [],
    bitacora: [],
    loading: true,
    bitacoraLoading: false,
    error: ''
  };

  renderShell();
  startSubscription();
  if (_state.selectedMva) loadBitacora();

  _unsubscribePlaza = onPlazaChange(plaza => {
    _state.plaza = up(plaza);
    _state.units = [];
    _state.loading = true;
    _state.bitacora = [];
    renderShell();
    startSubscription();
    if (_state.selectedMva) loadBitacora();
  });

  _resizeHandler = () => {
    if (_container) _container.style.setProperty('--cqv-vh', `${window.innerHeight}px`);
  };
  _resizeHandler();
  window.addEventListener('resize', _resizeHandler);
}

export function unmount() {
  try { _unsubscribeCuadre?.(); } catch (_) {}
  try { _unsubscribePlaza?.(); } catch (_) {}
  if (_resizeHandler) window.removeEventListener('resize', _resizeHandler);
  _unsubscribeCuadre = null;
  _unsubscribePlaza = null;
  _resizeHandler = null;
  _ctx = null;
  _container = null;
  _state = null;
}
