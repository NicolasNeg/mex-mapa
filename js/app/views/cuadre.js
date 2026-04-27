// ═══════════════════════════════════════════════════════════
//  /js/app/views/cuadre.js — Vista real parcial Fase 8C.
//  Muestra unidades de cuadre+externos por plaza activa.
//  Acciones destructivas NO implementadas en esta fase.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { subscribeCuadre } from '/js/app/features/cuadre/cuadre-data.js';

let _container  = null;
let _state      = null;
let _unsubData  = null;
let _unsubPlaza = null;

const q   = id       => _container?.querySelector(`#${id}`) ?? null;
const qs  = selector => _container?.querySelector(selector) ?? null;
const qsa = selector => Array.from(_container?.querySelectorAll(selector) ?? []);

// ── Estado de la vista ────────────────────────────────────

const ESTADO_ORDER = {
  'LISTO': 1, 'SUCIO': 2, 'MANTENIMIENTO': 3, 'RESGUARDO': 4,
  'TRASLADO': 5, 'NO ARRENDABLE': 6, 'RETENIDA': 7, 'VENTA': 8,
  'HYP': 9, 'EN RENTA': 10, 'EXTERNO': 11,
};

const ESTADO_COLOR = {
  'LISTO':         '#16a34a',
  'SUCIO':         '#d97706',
  'MANTENIMIENTO': '#dc2626',
  'TRASLADO':      '#7c3aed',
  'RESGUARDO':     '#64748b',
  'NO ARRENDABLE': '#94a3b8',
  'RETENIDA':      '#92400e',
  'VENTA':         '#0f172a',
  'HYP':           '#0369a1',
  'EN RENTA':      '#059669',
  'EXTERNO':       '#6d28d9',
};

const ESTADO_EMOJI = {
  'LISTO': '✅', 'SUCIO': '🧹', 'MANTENIMIENTO': '🔧',
  'TRASLADO': '🚛', 'RESGUARDO': '👀', 'NO ARRENDABLE': '▫️',
  'RETENIDA': '🟤', 'VENTA': '⚫', 'HYP': '🚚',
  'EN RENTA': '✈️', 'EXTERNO': '🚗',
};

const FILTERS = [
  { id: 'all',           label: 'Todos' },
  { id: 'listo',         label: 'LISTO' },
  { id: 'sucio',         label: 'SUCIO' },
  { id: 'mantenimiento', label: 'MANT.' },
  { id: 'traslado',      label: 'TRASLADO' },
  { id: 'resguardo',     label: 'RESGUARDO' },
  { id: 'externo',       label: 'EXTERNO' },
];

function _makeState(plaza) {
  return {
    plaza,
    allItems:  [],
    items:     [],
    filter:    'all',
    query:     '',
    sortField: 'estado',
    sortDir:   'asc',
    selectedId: null,
    navigate:  null,
  };
}

// ── Ciclo de vida ────────────────────────────────────────

export async function mount(ctx) {
  _cleanup();
  _container = ctx.container;
  _state     = _makeState(String(getCurrentPlaza() || ctx?.state?.currentPlaza || '').toUpperCase().trim());
  _state.navigate = ctx.navigate;

  const baseState = getState();
  _container.innerHTML = _skeleton({
    plaza: _state.plaza,
    role:  baseState.role,
    user:  baseState.profile?.nombreCompleto || baseState.profile?.nombre || baseState.profile?.email || 'Usuario',
  });

  _bindTopActions();
  _bindSearch();
  _bindSort();
  _bindFilters();

  _unsubPlaza = onPlazaChange(nextPlaza => _reloadForPlaza(nextPlaza));

  if (!_state.plaza) {
    _renderNoPlaza();
    return;
  }
  _startListener(_state.plaza);
}

export function unmount() {
  _cleanup();
}

function _cleanup() {
  if (typeof _unsubData  === 'function') { try { _unsubData();  } catch (_) {} }
  if (typeof _unsubPlaza === 'function') { try { _unsubPlaza(); } catch (_) {} }
  _unsubData  = null;
  _unsubPlaza = null;
  _container  = null;
  _state      = null;
}

function _stopListener() {
  if (typeof _unsubData === 'function') { try { _unsubData(); } catch (_) {} }
  _unsubData = null;
}

function _reloadForPlaza(nextPlaza) {
  if (!_state || !_container) return;
  const normalized = String(nextPlaza || '').toUpperCase().trim();
  if (normalized === _state.plaza) return;
  _state.plaza     = normalized;
  _state.allItems  = [];
  _state.items     = [];
  _state.selectedId = null;
  _setPlazaBadge(normalized);
  _renderSummary();
  _renderListSkeleton();
  _renderDetail(null);
  if (!normalized) {
    _stopListener();
    _renderNoPlaza();
    return;
  }
  _startListener(normalized);
}

function _startListener(plaza) {
  _stopListener();
  _renderListSkeleton();
  try {
    _unsubData = subscribeCuadre({
      plaza,
      onData: rows => {
        if (!_state || !_container) return;
        _state.allItems = Array.isArray(rows) ? rows : [];
        _applyFiltersAndSort();
        _renderSummary();
        _renderList();
        _syncDetail();
      },
      onError: err => {
        if (!_container) return;
        if (String(err?.code || '').toLowerCase().includes('permission')) {
          _renderListError('Sin permisos para ver cuadre de esta plaza.');
          return;
        }
        _renderListError(err?.message || 'Error al cargar cuadre desde Firestore.');
      },
    });
  } catch (err) {
    _renderListError(err?.message || 'Error al iniciar cuadre.');
  }
}

// ── Filtrado y ordenamiento ───────────────────────────────

function _matchFilter(item) {
  const f = _state.filter;
  if (f === 'all') return true;
  const est = item.estado.toUpperCase();
  if (f === 'listo')         return est === 'LISTO';
  if (f === 'sucio')         return est === 'SUCIO';
  if (f === 'mantenimiento') return est === 'MANTENIMIENTO';
  if (f === 'traslado')      return est === 'TRASLADO';
  if (f === 'resguardo')     return est === 'RESGUARDO';
  if (f === 'externo')       return item.tipo === 'externo';
  return true;
}

function _applyFiltersAndSort() {
  if (!_state) return;
  const query = _state.query.toLowerCase().trim();
  let items = _state.allItems.filter(_matchFilter);

  if (query) {
    items = items.filter(it =>
      it.mva.toLowerCase().includes(query) ||
      it.modelo.toLowerCase().includes(query) ||
      it.estado.toLowerCase().includes(query) ||
      it.ubicacion.toLowerCase().includes(query) ||
      it.notas.toLowerCase().includes(query) ||
      it.placas.toLowerCase().includes(query)
    );
  }

  items.sort((a, b) => {
    const dir = _state.sortDir === 'asc' ? 1 : -1;
    if (_state.sortField === 'mva') {
      return dir * a.mva.localeCompare(b.mva);
    }
    if (_state.sortField === 'estado') {
      const ao = ESTADO_ORDER[a.estado] ?? 99;
      const bo = ESTADO_ORDER[b.estado] ?? 99;
      if (ao !== bo) return dir * (ao - bo);
      return a.mva.localeCompare(b.mva);
    }
    // fecha: _updatedAt o fechaIngreso
    const ad = _parseDate(a.updatedAt || a.fechaIngreso);
    const bd = _parseDate(b.updatedAt || b.fechaIngreso);
    if (ad !== bd) return dir * (ad - bd);
    return a.mva.localeCompare(b.mva);
  });

  _state.items = items;
}

// ── Event binding ────────────────────────────────────────

function _bindTopActions() {
  qs('[data-cq-top]')?.addEventListener('click', e => {
    const link = e.target.closest('[data-app-route]');
    if (link && _state?.navigate) {
      e.preventDefault();
      _state.navigate(link.dataset.appRoute);
    }
  });
}

function _bindSearch() {
  q('cqAppSearch')?.addEventListener('input', e => {
    if (!_state) return;
    _state.query = e.target.value || '';
    _applyFiltersAndSort();
    _renderSummary();
    _renderList();
    _syncDetail();
  });
}

function _bindSort() {
  q('cqAppSort')?.addEventListener('change', e => {
    if (!_state) return;
    const [field, dir] = String(e.target.value || 'estado:asc').split(':');
    _state.sortField = field || 'estado';
    _state.sortDir   = dir   || 'asc';
    _applyFiltersAndSort();
    _renderList();
    _syncDetail();
  });
}

function _bindFilters() {
  qsa('[data-cq-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_state) return;
      _state.filter = btn.dataset.cqFilter || 'all';
      qsa('[data-cq-filter]').forEach(c => c.classList.toggle('cqApp-chip--active', c === btn));
      _applyFiltersAndSort();
      _renderSummary();
      _renderList();
      _syncDetail();
    });
  });
}

// ── Render helpers ───────────────────────────────────────

function _setPlazaBadge(plaza) {
  const el = q('cqAppPlaza');
  if (el) el.textContent = plaza || '—';
}

function _setText(id, value) {
  const el = q(id);
  if (el) el.textContent = String(value ?? '');
}

function _renderNoPlaza() {
  _renderSummary();
  _renderDetail(null);
  const list = q('cqAppList');
  if (list) list.innerHTML = `<div style="padding:42px;text-align:center;color:#94a3b8;font-size:13px;">Selecciona una plaza para ver el cuadre.</div>`;
}

function _renderListSkeleton() {
  const list = q('cqAppList');
  if (!list) return;
  list.innerHTML = `
    <div style="padding:36px;text-align:center;color:#94a3b8;">
      <span class="material-symbols-outlined" style="font-size:30px;animation:cqAppSpin 1s linear infinite;">sync</span>
      <div style="margin-top:10px;font-size:13px;">Cargando unidades…</div>
    </div>`;
}

function _renderListError(msg) {
  const list = q('cqAppList');
  if (!list) return;
  list.innerHTML = `
    <div style="padding:30px;text-align:center;color:#ef4444;">
      <span class="material-symbols-outlined" style="font-size:30px;">error_outline</span>
      <div style="margin-top:8px;font-size:13px;">${esc(msg)}</div>
      <a href="/cuadre" style="display:inline-flex;margin-top:14px;color:#991b1b;font-size:12px;text-decoration:underline;">Abrir módulo completo en su lugar</a>
    </div>`;
}

function _renderSummary() {
  const src    = _state?.allItems || [];
  const total  = src.length;
  const listo  = src.filter(u => u.estado === 'LISTO').length;
  const sucio  = src.filter(u => u.estado === 'SUCIO').length;
  const mant   = src.filter(u => u.estado === 'MANTENIMIENTO').length;
  _setText('cqAppSummaryTotal', total);
  _setText('cqAppSummaryListo', listo);
  _setText('cqAppSummarySucio', sucio);
  _setText('cqAppSummaryMant',  mant);
}

function _renderList() {
  const list = q('cqAppList');
  if (!list || !_state) return;

  if (!_state.items.length) {
    list.innerHTML = `<div style="padding:42px;text-align:center;color:#94a3b8;font-size:13px;">Sin unidades para los filtros aplicados.</div>`;
    return;
  }

  list.innerHTML = _state.items.map(unit => {
    const color = ESTADO_COLOR[unit.estado] || '#94a3b8';
    const emoji = ESTADO_EMOJI[unit.estado] || '🚗';
    const isSelected = unit.id === _state?.selectedId;
    return `
      <button data-cq-row="${esc(unit.id)}"
        style="width:100%;text-align:left;border:1px solid ${isSelected ? color : '#e2e8f0'};background:${isSelected ? '#f8fafc' : '#fff'};border-radius:12px;padding:11px 13px;cursor:pointer;transition:border-color .15s;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="width:8px;height:8px;border-radius:999px;background:${color};flex-shrink:0;"></span>
          <span style="font-size:12px;font-weight:800;color:#0f172a;">${esc(unit.mva || '—')}</span>
          <span style="font-size:11px;color:#64748b;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(unit.modelo || '')}</span>
          <span style="font-size:10px;font-weight:700;color:${color};white-space:nowrap;">${emoji} ${esc(unit.estado || 'SIN ESTADO')}</span>
        </div>
        <div style="margin-top:5px;display:flex;gap:10px;font-size:11px;color:#64748b;flex-wrap:wrap;">
          <span>⛽ ${esc(unit.gasolina || 'N/A')}</span>
          <span>📍 ${esc(unit.ubicacion || '—')}</span>
          ${unit.notas ? `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">💬 ${esc(unit.notas.slice(0, 60))}${unit.notas.length > 60 ? '…' : ''}</span>` : ''}
        </div>
      </button>`;
  }).join('');

  list.querySelectorAll('[data-cq-row]').forEach(el => {
    el.addEventListener('click', () => {
      if (!_state) return;
      _state.selectedId = el.dataset.cqRow;
      _syncDetail();
      _highlightSelected();
    });
  });
}

function _highlightSelected() {
  qsa('[data-cq-row]').forEach(el => {
    const unit = _state?.items.find(u => u.id === el.dataset.cqRow);
    const color = ESTADO_COLOR[unit?.estado || ''] || '#e2e8f0';
    const isSelected = el.dataset.cqRow === _state?.selectedId;
    el.style.borderColor = isSelected ? color : '#e2e8f0';
    el.style.background  = isSelected ? '#f8fafc' : '#fff';
  });
}

function _syncDetail() {
  if (!_state) return;
  if (!_state.selectedId) { _renderDetail(null); return; }
  const item = _state.allItems.find(u => u.id === _state.selectedId);
  if (!item) { _state.selectedId = null; _renderDetail(null); return; }
  _renderDetail(item);
}

function _renderDetail(unit) {
  const panel = q('cqAppDetail');
  if (!panel) return;
  if (!unit) {
    panel.innerHTML = `<div style="padding:20px;color:#94a3b8;font-size:12px;">Selecciona una unidad para ver detalle.</div>`;
    return;
  }
  const color = ESTADO_COLOR[unit.estado] || '#94a3b8';
  const emoji = ESTADO_EMOJI[unit.estado] || '🚗';
  panel.innerHTML = `
    <div style="padding:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-size:18px;font-weight:900;color:#0f172a;">${esc(unit.mva || '—')}</span>
        <span style="font-size:11px;font-weight:700;color:${color};background:${color}18;padding:2px 8px;border-radius:100px;">${emoji} ${esc(unit.estado || 'SIN ESTADO')}</span>
      </div>
      <div style="font-size:12px;color:#64748b;margin-bottom:12px;">${esc(unit.modelo || '')}${unit.categoria ? ' · ' + esc(unit.categoria) : ''}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:12px;">
        ${_df('Placas',      unit.placas     || '—')}
        ${_df('Gasolina',    unit.gasolina   || '—')}
        ${_df('Ubicación',   unit.ubicacion  || '—')}
        ${_df('Tipo',        unit.tipo === 'externo' ? 'Externo' : 'Regular')}
        ${_df('Plaza',       unit.plaza      || _state?.plaza || '—')}
        ${_df('Posición',    unit.pos        || 'LIMBO')}
        ${unit.updatedBy ? _df('Responsable', unit.updatedBy) : ''}
        ${unit.updatedAt  ? _df('Actualizado', esc(unit.updatedAt)) : ''}
      </div>
      ${unit.notas ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-bottom:4px;">Notas</div>
          <div style="font-size:12px;color:#334155;background:#f8fafc;border-radius:8px;padding:8px 10px;line-height:1.55;word-break:break-word;">${esc(unit.notas)}</div>
        </div>` : ''}
      ${unit.fechaIngreso ? `
        <div style="font-size:10px;color:#94a3b8;margin-bottom:10px;">Ingreso: ${esc(unit.fechaIngreso?.slice(0,10) || '—')}</div>` : ''}
      <a href="/cuadre" style="display:inline-flex;align-items:center;gap:5px;margin-top:4px;color:#991b1b;font-size:12px;text-decoration:underline;">
        <span class="material-symbols-outlined" style="font-size:14px;">open_in_new</span>Abrir módulo completo
      </a>
    </div>`;
}

function _df(label, value) {
  return `
    <div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:7px 9px;">
      <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;">${label}</div>
      <div style="font-size:12px;color:#1e293b;font-weight:600;">${value}</div>
    </div>`;
}

// ── HTML skeleton ────────────────────────────────────────

function _skeleton({ plaza, role, user }) {
  return `
    <style>
      @keyframes cqAppSpin { to { transform: rotate(360deg); } }
      .cqApp-chip--active { background:#7f1d1d !important;color:#fff !important;border-color:#7f1d1d !important; }
    </style>
    <div style="padding:20px 20px 48px;max-width:1060px;margin:0 auto;font-family:'Inter',sans-serif;">

      <div data-cq-top style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
        <a data-app-route="/app/dashboard" href="/app/dashboard"
          style="font-size:12px;color:#64748b;text-decoration:none;display:inline-flex;align-items:center;gap:5px;">
          <span class="material-symbols-outlined" style="font-size:16px;">arrow_back</span>Volver al dashboard
        </a>
        <span style="color:#cbd5e1;">·</span>
        <span style="font-size:12px;color:#0f172a;font-weight:700;">Cuadre</span>
        <span id="cqAppPlaza" style="margin-left:auto;font-size:11px;font-weight:700;color:#991b1b;background:#fee2e2;padding:3px 10px;border-radius:100px;">${esc(plaza || '—')}</span>
        <a href="/cuadre" style="font-size:11px;color:#64748b;text-decoration:none;border:1px solid #e2e8f0;border-radius:8px;padding:5px 10px;">Abrir módulo completo</a>
      </div>

      <div style="margin-bottom:14px;">
        <h1 style="margin:0;font-size:24px;font-weight:900;color:#0f172a;">Cuadre</h1>
        <p style="margin:4px 0 0;font-size:13px;color:#64748b;">${esc(user)} · ${esc(role || 'AUXILIAR')}</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:14px;">
        ${_summaryCard('cqAppSummaryTotal', 'Total flota', '#0f172a')}
        ${_summaryCard('cqAppSummaryListo', 'Listos',      '#16a34a')}
        ${_summaryCard('cqAppSummarySucio', 'Sucios',      '#d97706')}
        ${_summaryCard('cqAppSummaryMant',  'Mantenimiento','#dc2626')}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
        <input id="cqAppSearch" type="search"
          placeholder="Buscar MVA, modelo, estado, responsable, notas…"
          style="flex:1;min-width:240px;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:12px;">
        <select id="cqAppSort" style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:12px;">
          <option value="estado:asc">Estado (orden operativo)</option>
          <option value="mva:asc">MVA (A → Z)</option>
          <option value="mva:desc">MVA (Z → A)</option>
          <option value="fecha:desc">Actualización (más reciente)</option>
          <option value="fecha:asc">Actualización (más antigua)</option>
        </select>
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
        ${FILTERS.map((f, idx) => `
          <button data-cq-filter="${f.id}" class="${idx === 0 ? 'cqApp-chip--active' : ''}"
            style="border:1px solid #e2e8f0;border-radius:100px;padding:4px 13px;background:#fff;font-size:11px;font-weight:700;color:#64748b;cursor:pointer;">
            ${esc(f.label)}
          </button>`).join('')}
      </div>

      <div style="display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:12px;align-items:start;">
        <div id="cqAppList" style="display:flex;flex-direction:column;gap:7px;"></div>
        <aside id="cqAppDetail" style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;min-height:140px;position:sticky;top:16px;"></aside>
      </div>

    </div>`;
}

function _summaryCard(id, label, color) {
  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;">
      <div id="${id}" style="font-size:22px;font-weight:900;color:${color};">0</div>
      <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">${label}</div>
    </div>`;
}

// ── Utilidades ───────────────────────────────────────────

function _parseDate(value) {
  if (!value) return 0;
  // ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  // DD/MM/YYYY HH:MM (formato de _now() en mex-api)
  const m = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime();
  return 0;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
