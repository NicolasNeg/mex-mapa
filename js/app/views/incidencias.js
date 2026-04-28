// ═══════════════════════════════════════════════════════════
//  /js/app/views/incidencias.js
//  Fase 8B — vista real /app/incidencias con plaza global.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { subscribeIncidencias, createIncidencia, resolveIncidencia } from '/js/app/features/incidencias/incidencias-data.js';

let _container = null;
let _state = null;
let _unsubIncidencias = null;
let _unsubPlaza = null;
let _offGlobalSearch = null;
let _incCssInjected = false;

function _trackListener(action, name, extra = {}) {
  if (typeof window.__mexTrackListener !== 'function') return;
  window.__mexTrackListener(window.location.pathname, `app/incidencias:${name}`, action, extra);
}

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
  const url = new URL(window.location.href);
  const mvaFromQuery = String(url.searchParams.get('mva') || '').trim().toUpperCase();
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
    mvaFromQuery,
  };
}

export async function mount(ctx) {
  _cleanup();
  _container = ctx.container;
  _ensureIncidenciasCss();
  _state = _makeState(String(getCurrentPlaza() || ctx?.state?.currentPlaza || '').toUpperCase().trim());
  _trackListener('create', 'view', { plaza: _state.plaza });
  _state.navigate = ctx.navigate;

  const baseState = getState();
  _container.innerHTML = _skeleton({
    plaza: _state.plaza,
    role: baseState.role,
    user: baseState.profile?.nombreCompleto || baseState.profile?.nombre || baseState.profile?.email || 'Usuario',
  });

  _bindTopActions();
  _bindSort();
  _bindFilters();
  _bindGlobalSearch();
  _bindIncComposer();
  _prefillMvaFromQuery();

  _unsubPlaza = onPlazaChange(nextPlaza => {
    _reloadForPlaza(nextPlaza);
  });
  _trackListener('create', 'plaza-sub');

  if (!_state.plaza) {
    _renderNoPlaza();
    return;
  }
  _startIncidenciasListener(_state.plaza);
}

export function unmount() {
  _cleanup();
}

function _ensureIncidenciasCss() {
  if (_incCssInjected) return;
  if (document.querySelector('link[data-inc-app-css]')) { _incCssInjected = true; return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/incidencias.css';
  link.setAttribute('data-inc-app-css', '1');
  document.head.appendChild(link);
  _incCssInjected = true;
}

function _cleanup() {
  if (typeof _unsubIncidencias === 'function') {
    try { _unsubIncidencias(); } catch (_) {}
    _trackListener('cleanup', 'incidencias-sub');
  }
  if (typeof _unsubPlaza === 'function') {
    try { _unsubPlaza(); } catch (_) {}
    _trackListener('cleanup', 'plaza-sub');
  }
  if (typeof _offGlobalSearch === 'function') {
    try { _offGlobalSearch(); } catch (_) {}
  }
  _unsubIncidencias = null;
  _unsubPlaza = null;
  _offGlobalSearch = null;
  _container = null;
  _state = null;
  _trackListener('cleanup', 'view');
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_state || !_container) return;
    const detailRoute = String(event?.detail?.route || '');
    if (!(detailRoute.startsWith('/app/incidencias') || detailRoute === '/incidencias')) return;
    const query = String(event?.detail?.query || '');
    _state.query = query;
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
    _trackListener('cleanup', 'incidencias-sub');
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
  _prefillMvaFromQuery();
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

function _prefillMvaFromQuery() {
  const input = q('incNewMva');
  if (!input) return;
  if (_state?.mvaFromQuery) input.value = _state.mvaFromQuery;
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
    _trackListener('create', 'incidencias-sub', { plaza });
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

function _bindIncComposer() {
  const btn = q('incAppCreateBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!_state?.plaza) {
      alert('Selecciona una plaza antes de crear una incidencia.');
      return;
    }
    const titulo = String(q('incNewTitle')?.value || '').trim();
    const descripcion = String(q('incNewDesc')?.value || '').trim();
    const prioridad = String(q('incNewPri')?.value || 'media').toLowerCase();
    const mva = String(q('incNewMva')?.value || '').trim().toUpperCase();
    if (!titulo || !descripcion) {
      _showNotice('Completa título y descripción.', 'error');
      return;
    }
    const gs = getState();
    const autor = gs.profile?.email || gs.profile?.nombre || 'Usuario';
    btn.disabled = true;
    try {
      await createIncidencia({
        titulo,
        descripcion,
        nota: descripcion,
        prioridad,
        plazaID: _state.plaza,
        plaza: _state.plaza,
        mva: mva || undefined,
        autor,
        creadoPor: autor,
        source: 'app_shell'
      });
      _showNotice('Incidencia registrada.', 'ok');
      q('incNewTitle').value = '';
      q('incNewDesc').value = '';
      q('incNewMva').value = _state?.mvaFromQuery || '';
    } catch (e) {
      _showNotice(e?.message || 'No se pudo crear la incidencia.', 'error');
    } finally {
      btn.disabled = false;
    }
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
  const evidenceRows = evidencias.map(_evidenceRow).filter(Boolean);
  const open = _isOpen(item);

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
      ${item.solucion ? _detailBlock('Solución registrada', item.solucion) : ''}
      ${(item.resueltoPor || item.quienResolvio) ? _detailField('Resuelto por', item.resueltoPor || item.quienResolvio || '—') : ''}
      <div style="margin-top:14px;">
        <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;">Evidencias</div>
        ${evidenceRows.length ? `
          <div style="margin-top:6px;display:flex;flex-direction:column;gap:5px;">
            ${evidenceRows.map(ev => ev.href
              ? `<a href="${esc(ev.href)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#2b6954;word-break:break-all;">${esc(ev.label)}</a>`
              : `<div style="font-size:12px;color:#64748b;">${esc(ev.label)} <span style="color:#94a3b8;">(abrir en legacy)</span></div>`
            ).join('')}
          </div>
        ` : `<div style="margin-top:6px;font-size:12px;color:#64748b;">Sin evidencias adjuntas.</div>`}
      </div>
      ${open ? `
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid #f1f5f9;">
        <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-bottom:6px;">Resolver (notas_admin)</div>
        <textarea id="incResolveSol" rows="3" placeholder="Describe la solución aplicada..."
          style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:12px;font-family:inherit;resize:vertical;box-sizing:border-box;"></textarea>
        <button type="button" id="incAppResolveBtn"
          style="margin-top:8px;width:100%;border:none;border-radius:8px;background:#0f172a;color:#fff;padding:10px 12px;font-size:12px;font-weight:800;cursor:pointer;">
          Marcar como resuelta
        </button>
      </div>` : ''}
      <div style="margin-top:10px;font-size:11px;color:#64748b;">Carga y eliminación de adjuntos se mantiene en la vista legacy para conservar el flujo completo de Storage.</div>
      <a href="/incidencias" style="display:inline-flex;margin-top:16px;color:#64748b;font-size:11px;text-decoration:underline;">Historial / vista legacy</a>
    </div>
  `;

  const rb = detail.querySelector('#incAppResolveBtn');
  rb?.addEventListener('click', async () => {
    const sol = String(detail.querySelector('#incResolveSol')?.value || '').trim();
    if (!sol) {
      _showNotice('Escribe una breve solución antes de resolver.', 'error');
      return;
    }
    if (!confirm('¿Marcar esta incidencia como resuelta en notas_admin? Esta acción queda registrada.')) return;
    const gs = getState();
    const autor = gs.profile?.email || gs.profile?.nombre || 'Usuario';
    rb.disabled = true;
    try {
      await resolveIncidencia(item.legacyNotaId || item.id, sol, autor);
      _showNotice('Incidencia resuelta.', 'ok');
    } catch (e) {
      _showNotice(e?.message || 'No se pudo resolver la incidencia.', 'error');
    } finally {
      rb.disabled = false;
    }
  });
}

function _detailBlock(label, body) {
  return `
    <div style="margin-top:12px;background:#f8fafc;border-radius:8px;padding:10px;">
      <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;">${esc(label)}</div>
      <div style="margin-top:6px;font-size:12px;color:#334155;line-height:1.55;">${esc(body)}</div>
    </div>`;
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

      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:14px;background:#fafafa;">
        <div style="font-size:11px;font-weight:800;color:#475569;margin-bottom:10px;">Registrar incidencia · misma base que el mapa y la vista legacy</div>
        <div style="display:grid;gap:8px;">
          <input id="incNewTitle" type="text" placeholder="Título"
            style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:12px;" />
          <textarea id="incNewDesc" rows="2" placeholder="Describe el incidente..."
            style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:12px;font-family:inherit;resize:vertical;"></textarea>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <select id="incNewPri" style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:12px;">
              <option value="alta">Prioridad alta</option>
              <option value="media" selected>Prioridad media</option>
              <option value="baja">Prioridad baja</option>
            </select>
            <input id="incNewMva" type="text" placeholder="MVA (opcional)"
              style="flex:1;min-width:140px;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:12px;" />
          </div>
          <button type="button" id="incAppCreateBtn"
            style="justify-self:start;border:none;border-radius:8px;background:#2b6954;color:#fff;padding:8px 14px;font-size:12px;font-weight:800;cursor:pointer;">
            Guardar incidencia
          </button>
          <div style="font-size:11px;color:#64748b;">La incidencia queda ligada a la plaza global actual. Para adjuntos usa el módulo legacy.</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:14px;">
        ${_summaryCard('incAppSummaryTotal', 'Total')}
        ${_summaryCard('incAppSummaryOpen', 'Abiertas')}
        ${_summaryCard('incAppSummaryCritical', 'Críticas')}
        ${_summaryCard('incAppSummaryResolved', 'Resueltas')}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:center;margin-bottom:10px;">
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

function _evidenceHref(ev) {
  if (!ev) return '';
  if (typeof ev === 'string') return ev.trim();
  return String(ev.url || ev.href || ev.path || '').trim();
}

function _evidenceRow(ev) {
  if (!ev) return null;
  if (typeof ev === 'string') {
    const href = ev.trim();
    return href ? { href, label: href } : null;
  }
  const href = String(ev.url || ev.href || '').trim();
  const path = String(ev.path || '').trim();
  const label = String(ev.nombre || ev.name || ev.fileName || href || path || 'Evidencia');
  return { href: href || '', label: label || 'Evidencia' };
}

function _showNotice(message, type = 'ok') {
  let el = document.getElementById('app-inc-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-inc-notice';
    el.style.cssText = 'position:fixed;right:16px;bottom:18px;z-index:100001;padding:10px 12px;border-radius:10px;color:#fff;font:700 12px Inter,sans-serif;box-shadow:0 10px 26px rgba(15,23,42,.24);max-width:92vw;';
    document.body.appendChild(el);
  }
  el.style.background = type === 'error' ? '#b91c1c' : '#166534';
  el.textContent = String(message || '');
  el.style.opacity = '1';
  clearTimeout(_showNotice._t);
  _showNotice._t = setTimeout(() => { el.style.opacity = '0'; }, 3400);
}
