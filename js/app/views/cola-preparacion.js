// ═══════════════════════════════════════════════════════════
//  /js/app/views/cola-preparacion.js — Vista real App Shell
//  Fase 8A: Cola de preparación funcional dentro del shell.
//
//  Datos: cola_preparacion/{plaza}/items (Firestore onSnapshot)
//  Lifecycle: mount({ container, navigate, shell }) / unmount()
//  Sin auth listeners — perfil viene de App Shell state.
//  DOM scoped via q(id) → container.querySelector('#'+id)
// ═══════════════════════════════════════════════════════════

import { getState, onPlazaChange } from '/js/app/app-state.js';
import { db, COL } from '/js/core/database.js';
import { normalizarUnidad } from '/domain/unidad.model.js';

// ── Módulo-level refs (una instancia a la vez) ───────────────
let _unsub     = null;   // listener Firestore activo
let _container = null;   // nodo DOM activo
let _state     = null;   // estado local de esta vista
let _unsubPlaza = null;  // listener de plaza global
let _offGlobalSearch = null;
let _cssInjected = false;
let _queueSubSeq = 0;
/** @type {Map<string, object>} */
let _unitsByMva = new Map();
let _hydrateSeq = 0;

const CHECKLIST_KEYS = ['lavado', 'gasolina', 'docs', 'revision'];

const CHECKLIST_META = [
  { key: 'lavado', label: 'Lavado', hint: 'Interior y exterior listos para entrega', icon: 'cleaning_services' },
  { key: 'gasolina', label: 'Gasolina', hint: 'Nivel operativo validado antes de salida', icon: 'local_gas_station' },
  { key: 'docs', label: 'Documentación', hint: 'Papeles y expediente disponibles', icon: 'description' },
  { key: 'revision', label: 'Revisión mecánica', hint: 'Check visual o mecánico completado', icon: 'build_circle' }
];

// ── Helpers privados ─────────────────────────────────────────
const q   = id  => _container?.querySelector('#' + id) ?? null;
const qs  = sel => _container?.querySelector(sel) ?? null;
const qsa = sel => Array.from(_container?.querySelectorAll(sel) ?? []);

function esc(v) {
  return String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') {
    const d = v.toDate();
    return d && !isNaN(d.getTime()) ? d : null;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function _clFromDoc(d) {
  const c = d && typeof d.checklist === 'object' ? d.checklist : d;
  return {
    lavado: c.lavado === true,
    gasolina: c.gasolina === true,
    docs: c.docs === true,
    revision: c.revision === true
  };
}

function _normalizeQueueItem(id, d) {
  const raw = d || {};
  const orden = Number(raw.orden);
  return {
    id: String(id),
    mva: String(raw.mva || id || '').toUpperCase().trim(),
    checklist: _clFromDoc(raw),
    fechaSalida: _toDate(raw.fechaSalida),
    asignado: String(raw.asignado || '').trim(),
    notas: String(raw.notas || '').trim(),
    orden: Number.isFinite(orden) ? orden : null,
    creadoEn: _toDate(raw.creadoEn || raw.creadoAt || raw.createdAt),
    creadoAt: raw.creadoAt,
    actualizadoAt: raw.actualizadoAt
  };
}

function _cpProgress(item) {
  const done = CHECKLIST_KEYS.reduce((a, k) => a + (item?.checklist?.[k] ? 1 : 0), 0);
  return { done, total: 4, percent: Math.round((done / 4) * 100) };
}

function _isItemReady(item) {
  return _cpProgress(item).done === 4;
}

function _urgencyType(item) {
  const date = item?.fechaSalida;
  if (!date) return 'pending';
  const delta = date.getTime() - Date.now();
  if (delta <= 24 * 3600000) return 'urgent';
  if (_isItemReady(item)) return 'ready';
  return 'pending';
}

function _countdownLabel(date) {
  if (!date) return 'Sin fecha';
  const deltaMs = date.getTime() - Date.now();
  const deltaHours = Math.round(deltaMs / 3600000);
  if (deltaMs < 0) return 'Salida vencida';
  if (deltaHours <= 1) return 'Sale en <1h';
  if (deltaHours < 24) return `Sale en ${deltaHours}h`;
  const days = Math.floor(deltaHours / 24);
  const hours = deltaHours % 24;
  if (!days) return `Sale en ${deltaHours}h`;
  return hours ? `Sale en ${days}d ${hours}h` : `Sale en ${days}d`;
}

function _departureLabel(date) {
  if (!date) return 'Fecha sin programar';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function _fv() {
  return window.firebase?.firestore?.FieldValue;
}

function _lower(v) {
  return String(v ?? '').trim().toLowerCase();
}

function _queueColl(plaza) {
  const p = String(plaza || _state?.plaza || '').toUpperCase().trim();
  return db.collection('cola_preparacion').doc(p).collection('items');
}

function _fromDatetimeLocal(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function _toDatetimeLocal(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function _comparePrepItems(a, b) {
  if (Number.isFinite(a.orden) && Number.isFinite(b.orden) && a.orden !== b.orden) {
    return a.orden - b.orden;
  }
  if (Number.isFinite(a.orden) && !Number.isFinite(b.orden)) return -1;
  if (!Number.isFinite(a.orden) && Number.isFinite(b.orden)) return 1;
  const aTime = a.fechaSalida?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
  const bTime = b.fechaSalida?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  return String(a.mva || '').localeCompare(String(b.mva || ''), 'es', { sensitivity: 'base' });
}

async function _hydrateUnitMeta(plaza) {
  const seq = _hydrateSeq;
  const items = _state?.items || [];
  const mvas = [...new Set(items.map(it => String(it.mva || '').toUpperCase().trim()).filter(Boolean))];
  if (!plaza || !mvas.length) {
    _unitsByMva = new Map();
    return;
  }
  const next = new Map();
  for (let i = 0; i < mvas.length; i += 10) {
    const chunk = mvas.slice(i, i + 10);
    try {
      const [cuadreSnap, externosSnap] = await Promise.all([
        db.collection(COL.CUADRE).where('plaza', '==', plaza).where('mva', 'in', chunk).get(),
        db.collection(COL.EXTERNOS).where('plaza', '==', plaza).where('mva', 'in', chunk).get()
      ]);
      cuadreSnap.forEach(doc => {
        const data = doc.data() || {};
        const unit = normalizarUnidad({ id: doc.id, ...data });
        const key = String(unit.mva || '').toUpperCase();
        if (key) next.set(key, { ...unit, origen: 'PATIO' });
      });
      externosSnap.forEach(doc => {
        const data = doc.data() || {};
        const unit = normalizarUnidad({ id: doc.id, ...data });
        const key = String(unit.mva || '').toUpperCase();
        if (key && !next.has(key)) next.set(key, { ...unit, origen: 'EXTERNO' });
      });
    } catch (e) {
      console.warn('[prep-app] hydrate chunk', e);
    }
    if (seq !== _hydrateSeq || String(_state?.plaza || '').toUpperCase().trim() !== plaza) return;
  }
  _unitsByMva = next;
  if (seq !== _hydrateSeq || !_state || !_container) return;
  _applyFilters();
  _renderListByState();
  _renderStats();
}

function _toast(message, type = 'info') {
  const host = qs('[data-prep-toast-host]');
  if (!host) return;
  const colors = {
    info: '#334155',
    success: '#15803d',
    warning: '#c2410c',
    error: '#b91c1c'
  };
  const el = document.createElement('div');
  el.style.cssText = `pointer-events:auto;margin-top:8px;padding:10px 12px;border-radius:10px;background:#fff;border:1px solid #e2e8f0;font-size:12px;color:${colors[type] || colors.info};box-shadow:0 4px 12px rgba(0,0,0,.06);`;
  el.textContent = message;
  host.appendChild(el);
  window.setTimeout(() => { try { el.remove(); } catch (_) {} }, 3200);
}

async function _patchQueueItem(itemId, patch, opts = {}) {
  const plaza = String(_state?.plaza || '').toUpperCase().trim();
  if (!plaza) {
    _toast('Selecciona una plaza para guardar cambios.', 'warning');
    return false;
  }
  const fv = _fv();
  const touch = opts.touchMeta !== false;
  const mergePayload = { ...patch };
  if (touch && fv) {
    mergePayload.actualizadoAt = fv.serverTimestamp();
    mergePayload.actualizadoPor = _state.profileEmail || '';
  }
  try {
    await _queueColl(plaza).doc(itemId).set(mergePayload, { merge: true });
    if (opts.notify !== false) _toast(opts.successMsg || 'Cambios guardados.', 'success');
    return true;
  } catch (e) {
    console.error('[prep-app] patch', e);
    _toast(e?.message || 'No se pudo guardar.', 'error');
    return false;
  }
}

function _makeState(plaza, profile = {}) {
  const email = String(profile?.email || '').trim().toLowerCase();
  const name = String(profile?.nombreCompleto || profile?.nombre || '').trim();
  return {
    plaza,
    profileEmail: email,
    profileName: name,
    items:       [],     // todos los docs de Firestore
    filteredItems: [],
    searchQuery: '',
    /** @type {'all'|'urgent'|'pending'|'ready'|'mine'} */
    filterStatus: 'all',
    sortField:   '__legacy',
    sortDir:     'asc',
    selectedId:  null,
    loading: false,
    permissionDenied: false,
    errorMessage: '',
    hasSnapshot: false
  };
}

function _debugLog(...args) {
  try {
    if (localStorage.getItem('mex.debug.mode') !== '1') return;
    console.log('[prep-app]', ...args);
  } catch (_) {}
}

// ── Ciclo de vida ────────────────────────────────────────────

export async function mount({ container, navigate, shell }) {
  _doCleanup();
  _container = container;

  _ensureCss();

  const { profile, role, company, currentPlaza } = getState();
  const plaza = String(currentPlaza || '').toUpperCase().trim();

  _state = _makeState(plaza, profile);
  _state._navigate = navigate;

  container.innerHTML = _skeleton({ profile, role, company, plaza });

  _bindTopBar();
  _bindFilters();
  _bindSort();
  _bindGlobalSearch();

  if (!plaza) {
    _renderEmpty('Selecciona una plaza para ver la cola de preparación.');
  } else {
    _subscribeQueue(plaza);
  }

  _unsubPlaza = onPlazaChange((nextPlaza) => {
    _reloadForPlaza(nextPlaza);
  });
}

export function unmount() {
  _doCleanup();
}

// ── Cleanup ──────────────────────────────────────────────────

function _doCleanup() {
  if (typeof _unsub === 'function') { try { _unsub(); } catch (_) {} }
  if (typeof _unsubPlaza === 'function') { try { _unsubPlaza(); } catch (_) {} }
  if (typeof _offGlobalSearch === 'function') { try { _offGlobalSearch(); } catch (_) {} }
  _unsub     = null;
  _unsubPlaza = null;
  _offGlobalSearch = null;
  _container = null;
  _state     = null;
  _unitsByMva = new Map();
  _hydrateSeq += 1;
}

function _closeQueueListener() {
  if (typeof _unsub === 'function') { try { _unsub(); } catch (_) {} }
  _unsub = null;
}

function _reloadForPlaza(nextPlaza) {
  if (!_container || !_state) return;
  const normalized = String(nextPlaza || '').toUpperCase().trim();
  if (normalized === _state.plaza) return;

  _closeQueueListener();
  _hydrateSeq += 1;
  _unitsByMva = new Map();
  _state.plaza = normalized;
  _state.items = [];
  _state.filteredItems = [];
  _state.selectedId = null;
  _state.loading = false;
  _state.permissionDenied = false;
  _state.errorMessage = '';
  _state.hasSnapshot = false;
  _setTopbarPlaza(normalized);
  _setViewLoading();
  _renderStats();

  if (!normalized) {
    _renderEmpty('Selecciona una plaza para ver la cola de preparación.');
    return;
  }
  _subscribeQueue(normalized);
}

// ── CSS injection ────────────────────────────────────────────

function _ensureCss() {
  if (_cssInjected) return;
  if (document.querySelector('link[data-cola-css]')) { _cssInjected = true; return; }
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = '/css/cola-preparacion.css';
  link.setAttribute('data-cola-css', '1');
  document.head.appendChild(link);
  _cssInjected = true;
}

// ── Firestore subscription ───────────────────────────────────

function _subscribeQueue(plaza) {
  _setViewLoading();
  _closeQueueListener();
  const subscriptionId = ++_queueSubSeq;
  const expectedPlaza = String(plaza || '').toUpperCase().trim();

  try {
    _unsub = db.collection('cola_preparacion').doc(expectedPlaza).collection('items')
      .onSnapshot(
        snap => {
          if (!_container || !_state) return;          // desmontado mientras cargaba
          if (subscriptionId !== _queueSubSeq) return; // listener viejo (race condition)
          if (String(_state.plaza || '').toUpperCase().trim() !== expectedPlaza) return;
          _state.items = snap.docs.map(doc =>
            _normalizeQueueItem(doc.id, doc.data() || {})
          );
          _state.loading = false;
          _state.hasSnapshot = true;
          _state.permissionDenied = false;
          _state.errorMessage = '';
          void _hydrateUnitMeta(expectedPlaza);
          _applyFilters();
          _renderListByState();
          _renderStats();
        },
        err => {
          if (!_container || !_state) return;
          if (subscriptionId !== _queueSubSeq) return; // listener viejo (race condition)
          if (String(_state.plaza || '').toUpperCase().trim() !== expectedPlaza) return;
          const code = String(err?.code || '').toLowerCase();
          // En cambios de plaza rápidos pueden llegar errores tardíos de listeners cerrados.
          if (code === 'permission-denied' && _state.hasSnapshot) {
            _debugLog('Ignoring late permission-denied after snapshot', { plaza: expectedPlaza });
            return;
          }
          // Si ya tenemos datos válidos, ignoramos errores tardíos/stale.
          if ((_state.items || []).length > 0 || _state.hasSnapshot) {
            _debugLog('Ignoring stale error after data', { code: err?.code, message: err?.message, plaza: expectedPlaza });
            return;
          }
          if (code === 'permission-denied') {
            _debugLog('Permission denied in active listener', { plaza: expectedPlaza, message: err?.message });
          } else {
            console.error('[cola-prep] Firestore error:', err);
          }
          _state.loading = false;
          _state.hasSnapshot = false;
          if (code === 'permission-denied') {
            _state.permissionDenied = true;
            _state.errorMessage = 'No tienes permisos para ver la cola de esta plaza.';
            _renderListByState();
            return;
          }
          _state.permissionDenied = false;
          _state.errorMessage = err.message || 'No se pudo cargar la cola de preparación.';
          _renderListByState();
        }
      );
  } catch (err) {
    console.error('[cola-prep] No se pudo suscribir:', err);
    _state.loading = false;
    _state.permissionDenied = false;
    _state.errorMessage = err.message || 'No se pudo cargar la cola de preparación.';
    _renderListByState();
  }
}

// ── Filtrado / ordenamiento ──────────────────────────────────

function _matchesPrepFilter(it) {
  const f = _state.filterStatus || 'all';
  if (f === 'all') return true;
  if (f === 'urgent') return _urgencyType(it) === 'urgent';
  if (f === 'pending') return !_isItemReady(it);
  if (f === 'ready') return _isItemReady(it);
  if (f === 'mine') {
    const mine = _state.profileEmail;
    const nick = _lower(_state.profileName);
    const assigned = _lower(it.asignado);
    return Boolean(
      assigned &&
      ((mine && assigned.includes(mine)) || (nick && assigned.includes(nick)))
    );
  }
  return true;
}

function _matchesPrepSearch(it) {
  const term = _lower(_state.searchQuery);
  if (!term) return true;
  const unit = _unitsByMva.get(String(it.mva || '').toUpperCase()) || {};
  const hay = [
    it.mva,
    it.asignado,
    it.notas,
    unit.estado,
    unit.ubicacion,
    unit.categoria,
    unit.modelo,
    unit.color
  ].map(_lower).join(' ');
  return hay.includes(term);
}

function _applyFilters() {
  if (!_state) return;
  let items = [..._state.items].filter(it => _matchesPrepFilter(it) && _matchesPrepSearch(it));

  const field = _state.sortField;
  const dir = _state.sortDir === 'asc' ? 1 : -1;
  if (field === '__legacy') {
    items.sort((a, b) => _comparePrepItems(a, b));
  } else {
    items.sort((a, b) => {
      const av = _sortVal(a, field);
      const bv = _sortVal(b, field);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  _state.filteredItems = items;
}

function _sortVal(item, field) {
  if (field === 'orden') {
    return Number.isFinite(item.orden) ? item.orden : 999999;
  }
  if (field === 'fechaSalida') {
    const t = item.fechaSalida?.getTime?.();
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  }
  if (field === 'mva') {
    return String(item.mva || '').toLowerCase();
  }
  if (field === 'creadoEn') {
    const v = item.creadoEn;
    if (v instanceof Date) return v.getTime();
    if (v && typeof v.toDate === 'function') return v.toDate().getTime();
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return '';
}

// ── Bind eventos ─────────────────────────────────────────────

function _bindTopBar() {
  // Delegación en la barra superior (data-app-route y data-legacy-route)
  const bar = qs('[data-prep-topbar]');
  if (!bar) return;
  bar.addEventListener('click', e => {
    const ar = e.target.closest('[data-app-route]');
    if (ar && _state?._navigate) {
      e.preventDefault();
      _state._navigate(ar.dataset.appRoute);
    }
  });
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_state || !_container) return;
    const detailRoute = String(event?.detail?.route || '');
    if (!(detailRoute.startsWith('/app/cola-preparacion') || detailRoute === '/cola-preparacion')) return;
    const query = String(event?.detail?.query || '');
    _state.searchQuery = query;
    _applyFilters();
    _renderListByState();
    _renderStats();
  };
  window.addEventListener('mex:global-search', handler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', handler);
}

function _bindFilters() {
  qsa('[data-prep-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_state) return;
      _state.filterStatus = btn.dataset.prepFilter;
      qsa('[data-prep-filter]').forEach(b => b.classList.toggle('active', b === btn));
      _applyFilters();
      _renderListByState();
      _renderStats();
    });
  });
}

function _bindSort() {
  const sel = q('prepSortSelect');
  if (!sel) return;
  sel.addEventListener('change', () => {
    if (!_state) return;
    const raw = String(sel.value || '');
    if (raw === '__legacy') {
      _state.sortField = '__legacy';
      _state.sortDir = 'asc';
    } else {
      const [field, dir] = raw.split(':');
      _state.sortField = field || 'fechaSalida';
      _state.sortDir = dir || 'asc';
    }
    _applyFilters();
    _renderListByState();
    _renderStats();
  });
}

// ── Renders parciales ────────────────────────────────────────

function _renderLoading() {
  const listEl = q('prepList');
  if (!listEl) return;
  listEl.innerHTML = `
    <div style="padding:40px;text-align:center;color:#94a3b8;">
      <span class="material-symbols-outlined" style="font-size:32px;animation:spin 1s linear infinite;">sync</span>
      <div style="margin-top:10px;font-size:13px;">Cargando unidades…</div>
    </div>`;
}

function _renderError(msg) {
  const listEl = q('prepList');
  if (!listEl) return;
  listEl.innerHTML = `
    <div style="padding:32px;text-align:center;color:#ef4444;">
      <span class="material-symbols-outlined" style="font-size:28px;">error_outline</span>
      <div style="margin-top:8px;font-size:13px;">${esc(msg)}</div>
      <a href="/cola-preparacion" style="display:inline-block;margin-top:16px;font-size:12px;
         color:#2b6954;text-decoration:underline;">Abrir módulo completo</a>
    </div>`;
}

function _setViewLoading() {
  if (!_state) return;
  _state.loading = true;
  _state.permissionDenied = false;
  _state.errorMessage = '';
  _state.hasSnapshot = false;
  _renderLoading();
}

function _renderEmpty(msg = 'Sin unidades para mostrar.') {
  const listEl = q('prepList');
  if (!listEl) return;
  listEl.innerHTML = `
    <div style="padding:40px;text-align:center;color:#94a3b8;">
      <span class="material-symbols-outlined" style="font-size:36px;">fact_check</span>
      <div style="margin-top:10px;font-size:13px;">${esc(msg)}</div>
    </div>`;
}

function _setTopbarPlaza(plaza = '') {
  const badge = q('prepTopbarPlaza');
  if (!badge) return;
  if (!plaza) {
    badge.textContent = '';
    badge.style.display = 'none';
    return;
  }
  badge.textContent = plaza;
  badge.style.display = 'inline-flex';
}

function _renderStats() {
  if (!_state) return;
  const items = _state.filteredItems || [];
  const total = items.length;
  const urgentes = items.filter(it => _urgencyType(it) === 'urgent').length;
  const listos = items.filter(it => _isItemReady(it)).length;
  const progreso = total > 0
    ? Math.round(items.reduce((acc, it) => acc + _cpProgress(it).percent, 0) / total)
    : 0;

  _setText('prepStatTotal',    String(total));
  _setText('prepStatUrgent',   String(urgentes));
  _setText('prepStatReady',    String(listos));
  _setText('prepStatProgress', `${progreso}%`);

  const bar = q('prepProgressBar');
  if (bar) bar.style.width = `${progreso}%`;
}

function _renderList() {
  if (!_container || !_state) return;
  const listEl = q('prepList');
  if (!listEl) return;

  const items = _state.filteredItems;
  if (!items.length) return;

  listEl.innerHTML = items.map(it => _itemCard(it)).join('');

  listEl.querySelectorAll('[data-item-id]').forEach(card => {
    card.addEventListener('click', () => {
      _state.selectedId = card.dataset.itemId;
      _showDetail(_state.items.find(i => i.id === _state.selectedId));
    });
  });
}

function _renderListByState() {
  if (!_state || !_container) return;
  if (_state.loading) {
    _renderLoading();
    return;
  }
  if (_state.permissionDenied) {
    _renderError(_state.errorMessage || 'No tienes permisos para ver la cola de esta plaza.');
    return;
  }
  if (_state.errorMessage) {
    _renderError(_state.errorMessage);
    return;
  }
  const totalItems = Array.isArray(_state.items) ? _state.items.length : 0;
  const visibleItems = Array.isArray(_state.filteredItems) ? _state.filteredItems.length : 0;
  if (totalItems === 0) {
    _renderEmpty('Sin unidades para mostrar.');
    return;
  }
  if (visibleItems === 0) {
    _renderEmpty('Sin resultados para los filtros aplicados.');
    return;
  }
  _renderList();
}

// ── Tarjeta de item ──────────────────────────────────────────

function _itemCard(it) {
  const mva = it.mva || '—';
  const unit = _unitsByMva.get(String(mva || '').toUpperCase()) || {};
  const modelo = unit.modelo || unit.categoria || 'Sin expediente local';
  const progress = _cpProgress(it);
  const urgency = _urgencyType(it);
  const urgentChip = urgency === 'urgent';
  const chipLabel = _countdownLabel(it.fechaSalida);
  const selected = _state.selectedId === it.id;

  return `
<div data-item-id="${esc(it.id)}"
     class="prep-card${urgentChip ? ' prep-card--urgent' : ''}${selected ? ' prep-card--selected' : ''}"
     style="background:#fff;border:1px solid ${selected ? '#94a3b8' : urgentChip ? '#fed7aa' : '#f1f5f9'};
            border-radius:12px;padding:14px 16px;cursor:pointer;
            transition:box-shadow .1s,border-color .1s;margin-bottom:8px;"
     onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.06)';this.style.borderColor='#e2e8f0';"
     onmouseout="this.style.boxShadow='none';this.style.borderColor='${selected ? '#94a3b8' : urgentChip ? '#fed7aa' : '#f1f5f9'}';">
  <div style="display:flex;align-items:center;gap:12px;">
    <div style="width:36px;height:36px;border-radius:10px;background:${urgentChip ? '#fff7ed' : '#f0fdf4'};
                display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <span class="material-symbols-outlined" style="font-size:18px;color:${urgentChip ? '#f97316' : '#2b6954'};">
        ${urgentChip ? 'priority_high' : 'directions_bus'}
      </span>
    </div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
        <span style="font-size:13px;font-weight:700;color:#0f172a;">${esc(mva)}</span>
        <span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:100px;background:${urgentChip ? '#fff7ed' : '#f8fafc'};
                     color:${urgentChip ? '#ea580c' : '#64748b'};font-size:10px;font-weight:700;">${esc(chipLabel)}</span>
      </div>
      <div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${esc(modelo)}
      </div>
      <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        <span style="font-size:10px;padding:2px 7px;border-radius:6px;background:#f1f5f9;color:#475569;">${esc(unit.estado || 'Sin estado')}</span>
        <span style="font-size:10px;padding:2px 7px;border-radius:6px;background:#f1f5f9;color:#475569;">${esc(unit.ubicacion || 'Sin ubicación')}</span>
        <span style="font-size:10px;padding:2px 7px;border-radius:6px;background:#ecfdf5;color:#047857;font-weight:700;">${progress.done}/${progress.total} checks</span>
      </div>
      <div style="height:3px;background:#e2e8f0;border-radius:2px;margin-top:8px;overflow:hidden;">
        <div style="height:100%;width:${progress.percent}%;background:#22c55e;transition:width .2s;"></div>
      </div>
      <div style="margin-top:8px;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between;gap:8px;">
        <span>${esc(it.asignado || 'Sin responsable')}</span>
        <span>${esc(_departureLabel(it.fechaSalida))}</span>
      </div>
    </div>
    <span class="material-symbols-outlined" style="font-size:16px;color:#cbd5e1;flex-shrink:0;">chevron_right</span>
  </div>
</div>`;
}

// ── Panel de detalle ─────────────────────────────────────────

function _showDetail(it) {
  const panel = q('prepDetailPanel');
  if (!panel || !it) return;

  const unit = _unitsByMva.get(String(it.mva || '').toUpperCase()) || {};
  const prog = _cpProgress(it);

  panel.innerHTML = `
<div style="padding:18px;">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;gap:10px;">
    <div>
      <h3 style="font-size:16px;font-weight:800;color:#0f172a;margin:0;">${esc(it.mva || '—')}</h3>
      <div style="font-size:11px;color:#64748b;margin-top:4px;line-height:1.4;">
        ${esc([
          unit.estado || 'Sin estado',
          unit.ubicacion || 'Sin ubicación',
          unit.categoria || unit.modelo || 'Sin categoría'
        ].join(' · '))}
      </div>
    </div>
    <button type="button" id="prepCloseDetail"
            style="border:none;background:none;cursor:pointer;color:#94a3b8;padding:4px;">
      <span class="material-symbols-outlined" style="font-size:20px;">close</span>
    </button>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
    ${_detailRow('Plaza operativa', _state?.plaza || '—')}
    ${_detailRow('Cuenta regresiva', _countdownLabel(it.fechaSalida))}
    ${_detailRow('Origen expediente', unit.origen || (unit.mva ? 'PATIO' : '—'))}
    ${_detailRow('Progreso checklist', `${prog.done}/${prog.total} (${prog.percent}%)`)}
  </div>

  <div style="margin-bottom:12px;">
    <label style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">Salida estimada</label>
    <input id="prepDetailDeparture" type="datetime-local" value="${esc(_toDatetimeLocal(it.fechaSalida))}"
           style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:12px;box-sizing:border-box;" />
  </div>
  <div style="margin-bottom:12px;">
    <label style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">Asignado a</label>
    <input id="prepDetailAssigned" type="text" value="${esc(it.asignado || '')}"
           placeholder="Correo o nombre"
           style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:12px;box-sizing:border-box;" />
  </div>
  <div style="margin-bottom:12px;">
    <label style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">Notas (no destructivas)</label>
    <textarea id="prepDetailNotes" rows="3" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:12px;font-family:inherit;resize:vertical;box-sizing:border-box;">${esc(it.notas || '')}</textarea>
  </div>

  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
    <button type="button" id="prepAssignMeBtn" style="flex:1;min-width:120px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;padding:8px 10px;font-size:11px;font-weight:700;cursor:pointer;color:#0f172a;">
      Asignarme
    </button>
    <button type="button" id="prepCompleteChecklistBtn" style="flex:1;min-width:140px;border:1px solid #bbf7d0;border-radius:8px;background:#ecfdf5;padding:8px 10px;font-size:11px;font-weight:700;cursor:pointer;color:#047857;">
      Marcar checklist listo
    </button>
  </div>

  <button type="button" id="prepDetailSaveBtn"
          style="width:100%;border:none;border-radius:10px;background:#0f172a;color:#fff;padding:10px 12px;font-size:12px;font-weight:800;cursor:pointer;margin-bottom:14px;">
    Guardar cambios operativos
  </button>

  ${_checklistSection(it)}

  <div style="margin-top:14px;padding-top:12px;border-top:1px solid #f1f5f9;">
    <a href="/cola-preparacion?plaza=${esc(_state?.plaza || '')}&mva=${esc(it.mva || it.id)}"
       style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#64748b;text-decoration:underline;font-weight:600;">
      <span class="material-symbols-outlined" style="font-size:15px;">open_in_new</span>
      Abrir en módulo legacy (funciones avanzadas)
    </a>
  </div>
</div>`;

  panel.style.display = 'block';

  const TS = window.firebase?.firestore?.Timestamp;

  panel.querySelector('#prepCloseDetail')?.addEventListener('click', () => {
    panel.style.display = 'none';
    if (_state) _state.selectedId = null;
    _renderListByState();
  });

  panel.querySelector('#prepDetailSaveBtn')?.addEventListener('click', async () => {
    const depEl = panel.querySelector('#prepDetailDeparture');
    const asEl = panel.querySelector('#prepDetailAssigned');
    const noEl = panel.querySelector('#prepDetailNotes');
    const departure = _fromDatetimeLocal(depEl?.value || '');
    const ok = await _patchQueueItem(it.id, {
      fechaSalida: departure && TS ? TS.fromDate(departure) : null,
      asignado: String(asEl?.value || '').trim(),
      notas: String(noEl?.value || '').trim()
    }, { successMsg: 'Salida y notas actualizadas.' });
    if (!ok) return;
    Object.assign(it, {
      fechaSalida: departure,
      asignado: String(asEl?.value || '').trim(),
      notas: String(noEl?.value || '').trim()
    });
    _applyFilters();
    _renderListByState();
    _renderStats();
  });

  panel.querySelector('#prepAssignMeBtn')?.addEventListener('click', async () => {
    const mine = _state.profileEmail || _lower(_state.profileName);
    if (!mine) {
      _toast('No encontramos tu correo en el perfil para asignarte.', 'warning');
      return;
    }
    const assignee = _state.profileEmail || mine;
    const ok = await _patchQueueItem(it.id, { asignado: assignee }, { successMsg: 'Asignación actualizada.' });
    if (!ok) return;
    const inp = panel.querySelector('#prepDetailAssigned');
    if (inp) inp.value = assignee;
    it.asignado = assignee;
    _applyFilters();
    _renderListByState();
    _renderStats();
  });

  panel.querySelector('#prepCompleteChecklistBtn')?.addEventListener('click', async () => {
    if (!confirm('¿Marcar todos los ítems del checklist como completados? Esto indica que la unidad está lista para salida.')) return;
    const checklist = CHECKLIST_META.reduce((acc, meta) => {
      acc[meta.key] = true;
      return acc;
    }, {});
    const ok = await _patchQueueItem(it.id, { checklist }, { successMsg: 'Checklist completado.' });
    if (!ok) return;
    it.checklist = checklist;
    _applyFilters();
    _renderListByState();
    _renderStats();
    _showDetail(_state.items.find(i => i.id === it.id) || it);
  });

  panel.querySelectorAll('[data-prep-check]').forEach(box => {
    box.addEventListener('change', async () => {
      const key = box.dataset.prepCheck;
      if (!key) return;
      const checked = box.checked === true;
      const prev = Boolean(it.checklist?.[key]);
      const patch = { [`checklist.${key}`]: checked };
      const ok = await _patchQueueItem(it.id, patch, { notify: false });
      if (!ok) {
        box.checked = prev;
        return;
      }
      if (!it.checklist) it.checklist = {};
      it.checklist[key] = checked;
      _applyFilters();
      _renderListByState();
      _renderStats();
      _toast('Checklist actualizado.', 'success');
    });
  });
}

function _detailRow(label, value) {
  return `
<div style="background:#f8fafc;border-radius:8px;padding:10px 12px;">
  <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;
              letter-spacing:0.05em;margin-bottom:3px;">${esc(label)}</div>
  <div style="font-size:12px;font-weight:600;color:#1e293b;">${esc(String(value ?? '—'))}</div>
</div>`;
}

function _checklistSection(it) {
  const prog = _cpProgress(it);
  const pct = prog.percent;

  return `
<div style="background:#f8fafc;border-radius:10px;padding:12px;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;
                letter-spacing:0.06em;">Checklist operativo</div>
    <span style="font-size:11px;font-weight:700;color:#2b6954;">${prog.done}/${prog.total} (${pct}%)</span>
  </div>
  <div style="height:4px;background:#e2e8f0;border-radius:2px;margin-bottom:10px;overflow:hidden;">
    <div style="height:100%;width:${pct}%;background:#22c55e;border-radius:2px;transition:width .3s;"></div>
  </div>
  ${CHECKLIST_META.map(meta => {
    const done = it.checklist?.[meta.key] === true;
    return `
    <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;cursor:pointer;">
      <input type="checkbox" data-prep-check="${meta.key}" ${done ? 'checked' : ''}
             style="margin-top:2px;width:16px;height:16px;accent-color:#15803d;" />
      <div>
        <div style="font-size:12px;font-weight:700;color:#0f172a;">${esc(meta.label)}</div>
        <div style="font-size:11px;color:#64748b;line-height:1.35;">${esc(meta.hint)}</div>
      </div>
    </label>`;
  }).join('')}
</div>`;
}

// ── Utilidades ───────────────────────────────────────────────

function _setText(id, value) {
  const el = q(id);
  if (el) el.textContent = value;
}

// ── Skeleton HTML ────────────────────────────────────────────

function _skeleton({ profile, role, company, plaza }) {
  const name = profile?.nombreCompleto || profile?.nombre || profile?.email || '';

  return `
<div style="display:flex;flex-direction:column;height:100%;font-family:'Inter',sans-serif;">

  <!-- Barra superior de contexto -->
  <div data-prep-topbar style="display:flex;align-items:center;gap:10px;padding:12px 20px;
       border-bottom:1px solid #f1f5f9;background:#fff;flex-shrink:0;">
    <a data-app-route="/app/dashboard" href="/app/dashboard"
       style="display:flex;align-items:center;gap:4px;font-size:12px;color:#64748b;
              text-decoration:none;font-weight:500;cursor:pointer;">
      <span class="material-symbols-outlined" style="font-size:14px;">arrow_back</span>
      Dashboard
    </a>
    <span style="color:#cbd5e1;font-size:12px;">·</span>
    <span style="font-size:12px;font-weight:700;color:#0f172a;">Cola de preparación</span>
    <span id="prepTopbarPlaza" style="margin-left:auto;font-size:11px;font-weight:700;color:#2b6954;
                            padding:3px 10px;background:#dcfce7;border-radius:100px;display:${plaza ? 'inline-flex' : 'none'};">${esc(plaza)}</span>
    <a href="/cola-preparacion"
       style="display:flex;align-items:center;gap:4px;font-size:11px;color:#64748b;
              text-decoration:none;padding:4px 10px;border:1px solid #e2e8f0;border-radius:8px;
              ${plaza ? '' : 'margin-left:auto;'}">
      <span class="material-symbols-outlined" style="font-size:13px;">open_in_new</span>
      Vista legacy
    </a>
  </div>
  <div data-prep-toast-host style="position:fixed;bottom:20px;right:20px;z-index:50;pointer-events:none;max-width:min(320px,92vw);"></div>

  <!-- Stats -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#f1f5f9;
              flex-shrink:0;">
    ${_statCell('prepStatTotal',    '—', 'Total',    'list_alt',    '#2563eb','#eff6ff')}
    ${_statCell('prepStatUrgent',   '—', 'Urgentes', 'priority_high','#f97316','#fff7ed')}
    ${_statCell('prepStatReady',    '—', 'Listos',   'check_circle', '#16a34a','#f0fdf4')}
    ${_statCell('prepStatProgress', '—', 'Progreso', 'speed',        '#8b5cf6','#ede9fe')}
  </div>
  <!-- Barra de progreso delgada -->
  <div style="height:3px;background:#f1f5f9;flex-shrink:0;overflow:hidden;">
    <div id="prepProgressBar" style="height:100%;width:0%;background:#22c55e;transition:width .5s;"></div>
  </div>

  <!-- Controles: filtros + sort -->
  <div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;background:#fafafa;
              flex-shrink:0;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
    <!-- Filtros (alineados al modelo legacy: urgencia / pendiente / listo / míos) -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:180px;">
      ${_filterBtn('all',      'Todos',       true)}
      ${_filterBtn('urgent',   'Urgentes',    false)}
      ${_filterBtn('pending',  'Pendientes',  false)}
      ${_filterBtn('ready',    'Listos',      false)}
      ${_filterBtn('mine',     'Míos',        false)}
    </div>

    <!-- Sort -->
    <select id="prepSortSelect"
            style="border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;
                   font-size:12px;font-family:inherit;color:#334155;background:#fff;outline:none;">
      <option value="__legacy">Orden legacy (prioridad + salida)</option>
      <option value="fechaSalida:asc">Salida más próxima</option>
      <option value="orden:asc">Campo orden</option>
      <option value="mva:asc">MVA A→Z</option>
      <option value="creadoEn:desc">Alta reciente</option>
      <option value="creadoEn:asc">Alta antigua</option>
    </select>
  </div>

  <!-- Layout: lista + detalle -->
  <div style="display:flex;flex:1;overflow:hidden;">

    <!-- Lista -->
    <div style="flex:1;overflow-y:auto;padding:12px 16px;">
      <div id="prepList"></div>
    </div>

    <!-- Panel de detalle (oculto por defecto) -->
    <div id="prepDetailPanel"
         style="display:none;width:320px;border-left:1px solid #f1f5f9;
                overflow-y:auto;background:#fff;flex-shrink:0;">
    </div>
  </div>

</div>

<style>
@keyframes spin { to { transform: rotate(360deg); } }
[data-prep-filter].active {
  background: #2b6954 !important;
  color: #fff !important;
  border-color: #2b6954 !important;
}
.prep-card--selected { box-shadow: 0 0 0 1px #64748b !important; }
[data-prep-toast-host] > * { pointer-events: auto; }
</style>
`;
}

function _statCell(id, value, label, icon, color, bg) {
  return `
<div style="background:#fff;padding:14px 16px;display:flex;align-items:center;gap:12px;">
  <div style="width:36px;height:36px;border-radius:10px;background:${bg};flex-shrink:0;
              display:flex;align-items:center;justify-content:center;">
    <span class="material-symbols-outlined" style="font-size:18px;color:${color};">${icon}</span>
  </div>
  <div>
    <div id="${id}" style="font-size:20px;font-weight:900;color:#0f172a;line-height:1;">${value}</div>
    <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;
                letter-spacing:0.06em;margin-top:2px;">${esc(label)}</div>
  </div>
</div>`;
}

function _filterBtn(value, label, active) {
  return `
<button data-prep-filter="${value}"
        class="${active ? 'active' : ''}"
        style="padding:5px 12px;border-radius:8px;border:1px solid #e2e8f0;
               background:${active ? '#2b6954' : '#fff'};
               color:${active ? '#fff' : '#64748b'};
               font-size:11px;font-weight:700;cursor:pointer;
               font-family:inherit;transition:all .1s;">
  ${esc(label)}
</button>`;
}
