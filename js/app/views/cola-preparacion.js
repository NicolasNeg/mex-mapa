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
import { COL } from '/js/core/database.js';
import {
  subscribeColaQueue,
  hydrateQueueUnits,
  loadPlazaUsers,
  loadPlazaUnits
} from '/js/app/features/cola-preparacion/cola-data.js';
import {
  enqueueUnit,
  patchItem,
  removeItem,
  reorderItems,
  bulkCompleteChecklist
} from '/js/app/features/cola-preparacion/cola-mutations.js';
import {
  CHECKLIST_KEYS,
  CHECKLIST_META,
  cpProgress,
  isItemReady,
  urgencyType,
  countdownLabel,
  departureLabel,
  fromDatetimeLocal,
  toDatetimeLocal,
  comparePrepItems,
  filterAndSortItems,
  computeStats,
  canPrepManage,
  canPrepDelete,
  findItemByMva,
  deriveEstadoCola
} from '/js/app/features/cola-preparacion/cola-view-model.js';

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
/** @type {{ value: string, label: string }[]} */
let _plazaUsers = [];
/** @type {Map<string, object>} */
let _plazaUnits = new Map();
let _dragPrepId = '';
let _deleteArmedPrepId = '';

function _trackListener(action, name, extra = {}) {
  if (typeof window.__mexTrackListener !== 'function') return;
  window.__mexTrackListener(window.location.pathname, `app/cola:${name}`, action, extra);
}

// ── Helpers privados ─────────────────────────────────────────
const q   = id  => _container?.querySelector('#' + id) ?? null;
const qs  = sel => _container?.querySelector(sel) ?? null;
const qsa = sel => Array.from(_container?.querySelectorAll(sel) ?? []);
const _mexConfirm = (titulo, texto, tipo = 'warning') =>
  typeof window.mexConfirm === 'function' ? window.mexConfirm(titulo, texto, tipo) : Promise.resolve(false);

function esc(v) {
  return String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(v) { return esc(v).replace(/'/g, '&#39;'); }

function _fv() {
  return window.firebase?.firestore?.FieldValue;
}

function _lower(v) {
  return String(v ?? '').trim().toLowerCase();
}

function _canPrepManage() {
  const st = getState() || {};
  return canPrepManage(st.profile || {}, st.role);
}

function _canPrepDelete() {
  return _canPrepManage();
}

async function _loadPlazaUsers() {
  const plaza = String(_state?.plaza || '').toUpperCase().trim();
  if (!plaza || !_container) {
    _plazaUsers = [];
    _renderDatalists();
    return;
  }
  _plazaUsers = await loadPlazaUsers(plaza);
  _renderDatalists();
}

async function _loadPlazaUnits() {
  const plaza = String(_state?.plaza || '').toUpperCase().trim();
  if (!plaza || !_container) {
    _plazaUnits = new Map();
    _renderDatalists();
    return;
  }
  _plazaUnits = await loadPlazaUnits(plaza);
  _renderDatalists();
}

function _renderDatalists() {
  const udl = _container?.querySelector('#prepUsersDatalist');
  if (udl) {
    udl.innerHTML = _plazaUsers.map(u => `<option value="${escAttr(u.value)}">${esc(u.label)}</option>`).join('');
  }
  const mdl = _container?.querySelector('#prepMvaDatalist');
  if (mdl) {
    mdl.innerHTML = Array.from(_plazaUnits.values())
      .map(unit => `<option value="${escAttr(unit.mva)}">${esc([unit.modelo, unit.categoria, unit.estado].filter(Boolean).join(' · '))}</option>`)
      .join('');
  }
}

function _showCreateUnitPreview(mvaRaw) {
  const preview = _container?.querySelector('#prepCreateUnitPreview');
  if (!preview) return;
  const mva = String(mvaRaw || '').trim().toUpperCase();
  const unit = _plazaUnits.get(mva);
  if (!unit || !mva) {
    preview.style.display = 'none';
    preview.innerHTML = '';
    return;
  }
  const chips = [
    unit.modelo ? `<span class="prep-preview-chip">${esc(unit.modelo)}</span>` : '',
    unit.categoria ? `<span class="prep-preview-chip">${esc(unit.categoria)}</span>` : '',
    unit.estado ? `<span class="prep-preview-chip prep-preview-chip--state">${esc(unit.estado)}</span>` : '',
    unit.ubicacion ? `<span class="prep-preview-chip prep-preview-chip--loc"><span class="material-symbols-outlined" style="font-size:13px;">place</span>${esc(unit.ubicacion)}</span>` : ''
  ].filter(Boolean).join('');
  preview.innerHTML = `<div class="prep-preview-found"><span class="material-symbols-outlined" style="font-size:15px;color:#047857;">check_circle</span> Unidad encontrada en expediente</div>${chips}`;
  preview.style.display = 'flex';
}

function _openPrepCreateModal() {
  if (!_state?.plaza) {
    _toast('Selecciona una plaza antes de crear una salida.', 'warning');
    return;
  }
  const modal = _container?.querySelector('#prepModal');
  if (!modal) return;
  const form = _container?.querySelector('#prepCreateForm');
  form?.reset();
  const dep = new Date(Date.now() + 24 * 3600000);
  const depIn = _container?.querySelector('#prepCreateDeparture');
  if (depIn) depIn.value = toDatetimeLocal(dep);
  const plIn = _container?.querySelector('#prepCreatePlaza');
  if (plIn) plIn.value = _state.plaza || '';
  const pv = _container?.querySelector('#prepCreateUnitPreview');
  if (pv) { pv.style.display = 'none'; pv.innerHTML = ''; }
  modal.style.display = 'flex';
}

function _closePrepCreateModal() {
  const modal = _container?.querySelector('#prepModal');
  if (modal) modal.style.display = 'none';
}

async function _persistReorderPrep(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  if (!_canPrepManage()) {
    _toast('No tienes permiso para reordenar la cola.', 'error');
    return;
  }
  const plaza = String(_state?.plaza || '').toUpperCase().trim();
  if (!plaza) {
    _toast('Selecciona una plaza para reordenar.', 'warning');
    return;
  }
  const base = [...(_state?.items || [])].sort(comparePrepItems);
  const from = base.findIndex(item => item.id === sourceId);
  const to = base.findIndex(item => item.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = base.splice(from, 1);
  const insertAt = from < to ? Math.max(0, to - 1) : to;
  base.splice(insertAt, 0, moved);
  const actor = _state.profileEmail || '';
  try {
    await reorderItems({
      plaza,
      orderedIds: base.map(item => item.id),
      actor
    });
    _toast('Orden actualizado.', 'success');
  } catch (err) {
    console.error('[prep-app] reorder', err);
    _toast(err?.message || 'No se pudo reordenar.', 'error');
  }
}

async function _runBulkComplete() {
  if (!_canPrepManage()) {
    _toast('No tienes permiso para acciones masivas.', 'error');
    return;
  }
  const items = (_state?.filteredItems || []).filter(item => !isItemReady(item));
  if (!items.length) {
    _toast('No hay unidades pendientes visibles.', 'info');
    return;
  }
  if (!await _mexConfirm('Checklist masivo', `¿Marcar checklist completo en ${items.length} unidad(es) visibles?`, 'warning')) return;
  const plaza = String(_state?.plaza || '').toUpperCase().trim();
  const actor = _state.profileEmail || '';
  try {
    await bulkCompleteChecklist({
      plaza,
      itemIds: items.map(item => item.id),
      actor
    });
    _toast('Checklist completado para las unidades visibles.', 'success');
  } catch (err) {
    console.error('[prep-app] bulk complete', err);
    _toast(err?.message || 'No se pudo completar la acción masiva.', 'error');
  }
}

async function _deletePrepItem(id) {
  if (!id) return;
  if (!_canPrepDelete()) {
    _toast('No tienes permiso para eliminar entradas de cola.', 'error');
    return;
  }
  const plaza = String(_state?.plaza || '').toUpperCase().trim();
  if (!plaza) {
    _toast('Selecciona una plaza.', 'warning');
    return;
  }
  try {
    await removeItem({
      plaza,
      itemId: id,
      actor: _state?.profileEmail || '',
      mva: _state.items.find(i => i.id === id)?.mva || id
    });
    if (_state) {
      _state.selectedId = null;
      _deleteArmedPrepId = '';
    }
    const panel = q('prepDetailPanel');
    if (panel) panel.style.display = 'none';
    _toast('Entrada eliminada de la cola.', 'success');
  } catch (err) {
    console.error('[prep-app] delete', err);
    _toast(err?.message || 'No se pudo eliminar.', 'error');
  }
}

function _syncBulkButtonVisibility() {
  const btn = _container?.querySelector('#prepBulkCompleteBtn');
  if (!btn) return;
  btn.style.display = _canPrepDelete() ? 'inline-flex' : 'none';
}

function _attachDragPrepCards() {
  const root = q('prepList');
  if (!root) return;
  root.querySelectorAll('[data-item-id]').forEach(card => {
    card.draggable = _canPrepManage();
    card.addEventListener('dragstart', e => {
      _dragPrepId = card.dataset.itemId || '';
      card.classList.add('is-dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
      } catch (_) {}
    });
    card.addEventListener('dragend', () => {
      _dragPrepId = '';
      card.classList.remove('is-dragging');
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = 'move';
      } catch (_) {}
    });
    card.addEventListener('drop', async e => {
      e.preventDefault();
      const targetId = card.dataset.itemId || '';
      if (!_dragPrepId || !targetId || _dragPrepId === targetId) return;
      await _persistReorderPrep(_dragPrepId, targetId);
    });
  });
}

function _bindPrepExtendedUi() {
  const c = _container;
  if (!c) return;
  c.querySelector('#prepAddBtn')?.addEventListener('click', () => _openPrepCreateModal());
  c.querySelector('#prepBulkCompleteBtn')?.addEventListener('click', () => void _runBulkComplete());
  c.querySelector('#prepCreateForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const plaza = String(_state?.plaza || '').toUpperCase().trim();
    const mva = String(c.querySelector('#prepCreateMva')?.value || '').trim().toUpperCase();
    const departure = fromDatetimeLocal(String(c.querySelector('#prepCreateDeparture')?.value || ''));
    const assigned = String(c.querySelector('#prepCreateAssigned')?.value || '').trim();
    const notes = String(c.querySelector('#prepCreateNotes')?.value || '').trim();
    if (!plaza) {
      _toast('Selecciona una plaza.', 'warning');
      return;
    }
    if (!mva) {
      _toast('Captura un MVA válido.', 'warning');
      return;
    }
    if (!departure) {
      _toast('Selecciona la salida programada.', 'warning');
      return;
    }
    const existing = _state.items.find(item => item.id === mva || item.mva === mva);
    if (existing) {
      _closePrepCreateModal();
      _state.selectedId = existing.id;
      _toast('Ese MVA ya está en la cola; abriendo detalle.', 'warning');
      _showDetail(_state.items.find(i => i.id === existing.id));
      _renderListByState();
      return;
    }
    const actor = _state.profileEmail || '';
    try {
      const result = await enqueueUnit({
        mva,
        plaza,
        fechaSalida: departure,
        asignado: assigned,
        notas: notes,
        origen: 'MANUAL',
        actor
      });
      _closePrepCreateModal();
      _state.selectedId = mva;
      if (result.alreadyExists) {
        _toast('Ese MVA ya está en la cola; abriendo detalle.', 'warning');
        _tryOpenMvaFromQuery(mva);
      } else {
        _toast('Unidad agregada a la cola.', 'success');
      }
    } catch (err) {
      console.error(err);
      _toast(err?.message || 'No se pudo crear.', 'error');
    }
  });
  c.querySelector('#prepCreateMva')?.addEventListener('input', ev => _showCreateUnitPreview(ev.target?.value));
  c.querySelector('#prepModal')?.addEventListener('click', ev => {
    if (ev.target?.id === 'prepModal') _closePrepCreateModal();
  });
  c.querySelector('#prepModalCloseBtn')?.addEventListener('click', () => _closePrepCreateModal());
  c.querySelector('#prepModalCancelBtn')?.addEventListener('click', e => {
    e.preventDefault();
    _closePrepCreateModal();
  });
}

function _fromDatetimeLocal(value) {
  return fromDatetimeLocal(value);
}

function _toDatetimeLocal(date) {
  return toDatetimeLocal(date);
}

async function _hydrateUnitMeta(plaza) {
  const seq = _hydrateSeq;
  const items = _state?.items || [];
  if (!plaza || !items.length) {
    _unitsByMva = new Map();
    return;
  }
  const next = await hydrateQueueUnits(plaza, items, {
    signal: { get aborted() { return seq !== _hydrateSeq; } }
  });
  if (seq !== _hydrateSeq || String(_state?.plaza || '').toUpperCase().trim() !== plaza) return;
  _unitsByMva = next;
  if (seq !== _hydrateSeq || !_state || !_container) return;
  _applyFilters();
  _renderListByState();
  _renderStats();
  _tryOpenMvaFromQuery();
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
  const item = _state?.items?.find(i => i.id === itemId);
  const mva = item?.mva || itemId;
  try {
    await patchItem({
      plaza,
      itemId,
      patch: { ...patch, mva },
      actor: _state.profileEmail || '',
      touchMeta: opts.touchMeta !== false,
      logType: opts.logType || null
    });
    if (opts.notify !== false) _toast(opts.successMsg || 'Cambios guardados.', 'success');
    return true;
  } catch (e) {
    console.error('[prep-app] patch', e);
    _toast(e?.message || 'No se pudo guardar.', 'error');
    return false;
  }
}

function _makeState(plaza, profile = {}) {
  const url = new URL(window.location.href);
  const mvaFromQuery = String(url.searchParams.get('mva') || '').trim().toUpperCase();
  const email = String(profile?.email || '').trim().toLowerCase();
  const name = String(profile?.nombreCompleto || profile?.nombre || '').trim();
  return {
    plaza,
    profileEmail: email,
    profileName: name,
    mvaFromQuery,
    mvaDeepLinkHandled: false,
    items:       [],
    filteredItems: [],
    searchQuery: mvaFromQuery.toLowerCase(),
    /** @type {'all'|'urgent'|'pending'|'ready'|'mine'} */
    filterStatus: 'all',
    sortField:   '__operational',
    sortDir:     'asc',
    selectedId:  null,
    loading: false,
    permissionDenied: false,
    errorMessage: '',
    hasSnapshot: false
  };
}

function _tryOpenMvaFromQuery(forcedMva) {
  if (!_state || !_container) return;
  const mva = String(forcedMva || _state.mvaFromQuery || '').trim().toUpperCase();
  if (!mva) return;
  const item = findItemByMva(_state.items, mva);
  if (!item) return;
  _state.selectedId = item.id;
  _state.mvaDeepLinkHandled = true;
  _showDetail(item);
  _renderListByState();
  const card = _container.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`);
  card?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
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
  _trackListener('create', 'view', { plaza });
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

  void _loadPlazaUsers();
  void _loadPlazaUnits();
  _bindPrepExtendedUi();
  _syncBulkButtonVisibility();

  _unsubPlaza = onPlazaChange((nextPlaza) => {
    _reloadForPlaza(nextPlaza);
  });
  _trackListener('create', 'plaza-sub');
}

export function unmount() {
  _doCleanup();
}

// ── Cleanup ──────────────────────────────────────────────────

function _doCleanup() {
  if (typeof _unsub === 'function') { try { _unsub(); } catch (_) {} _trackListener('cleanup', 'data-sub'); }
  if (typeof _unsubPlaza === 'function') { try { _unsubPlaza(); } catch (_) {} _trackListener('cleanup', 'plaza-sub'); }
  if (typeof _offGlobalSearch === 'function') { try { _offGlobalSearch(); } catch (_) {} }
  _unsub     = null;
  _unsubPlaza = null;
  _offGlobalSearch = null;
  _container = null;
  _state     = null;
  _unitsByMva = new Map();
  _hydrateSeq += 1;
  _dragPrepId = '';
  _deleteArmedPrepId = '';
  _trackListener('cleanup', 'view');
}

function _closeQueueListener() {
  if (typeof _unsub === 'function') { try { _unsub(); } catch (_) {} _trackListener('cleanup', 'data-sub'); }
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
  void _loadPlazaUsers();
  void _loadPlazaUnits();
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
    _trackListener('create', 'data-sub', { plaza: expectedPlaza });
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
  if (f === 'with-date') return Boolean(it?.fechaSalida);
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
  if (field === '__operational') {
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
  // Delegación en la barra superior.
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
    if (raw === '__operational') {
      _state.sortField = '__operational';
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
      _deleteArmedPrepId = '';
      _showDetail(_state.items.find(i => i.id === _state.selectedId));
    });
    card.querySelector('.prep-drag-handle')?.addEventListener('click', e => e.stopPropagation());
  });
  _attachDragPrepCards();
  _syncBulkButtonVisibility();
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
<article class="prep-list-card ${selected ? 'is-selected' : ''}" data-item-id="${esc(it.id)}" draggable="true">
  <div class="prep-list-card-head">
    <div class="prep-list-card-meta">
      <div class="prep-drag-handle"><span class="material-symbols-outlined">drag_indicator</span></div>
      <div>
        <div class="prep-mva">${esc(mva)}</div>
        <div class="prep-list-card-submeta">${esc(modelo)}</div>
      </div>
    </div>
    <div class="prep-status-chip ${urgentChip ? 'urgent' : urgency}">${esc(chipLabel)}</div>
  </div>
  <div class="prep-list-card-meta">
    <span class="prep-inline-badge">${esc(unit.estado || 'Sin estado')}</span>
    <span class="prep-inline-badge">${esc(unit.ubicacion || 'Sin ubicacion')}</span>
    <span class="prep-inline-badge">${progress.done}/${progress.total} checks</span>
  </div>
  <div class="prep-mini-progress"><span style="width:${progress.percent}%;"></span></div>
  <div class="prep-list-card-footer">
    <span class="prep-list-card-submeta">${esc(it.asignado || 'Sin responsable')}</span>
    <span class="prep-list-card-submeta">${esc(_departureLabel(it.fechaSalida))}</span>
  </div>
</article>`;
}

// ── Panel de detalle ─────────────────────────────────────────

function _showDetail(it) {
  const panel = q('prepDetailPanel');
  if (!panel || !it) return;

  const unit = _unitsByMva.get(String(it.mva || '').toUpperCase()) || {};
  const prog = _cpProgress(it);

  const deleteArmed = _deleteArmedPrepId === it.id;
  const showDel = _canPrepDelete();

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
    <div style="display:flex;align-items:center;gap:6px;">
      ${showDel ? `<button type="button" id="prepDetailDeleteBtn"
        style="border:1px solid ${deleteArmed ? '#dc2626' : '#fecaca'};border-radius:8px;background:${deleteArmed ? '#fef2f2' : '#fff'};
        color:#b91c1c;padding:6px 10px;font-size:11px;font-weight:800;cursor:pointer;">
        ${deleteArmed ? 'Confirmar borrado' : 'Eliminar'}
      </button>` : ''}
      ${showDel && deleteArmed ? `<button type="button" id="prepDetailCancelDelBtn"
        style="border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#64748b;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;">
        Cancelar
      </button>` : ''}
      <button type="button" id="prepCloseDetail"
              style="border:none;background:none;cursor:pointer;color:#94a3b8;padding:4px;">
        <span class="material-symbols-outlined" style="font-size:20px;">close</span>
      </button>
    </div>
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
           placeholder="Correo o nombre" list="prepUsersDatalist"
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

</div>`;

  panel.style.display = 'block';

  const TS = window.firebase?.firestore?.Timestamp;

  panel.querySelector('#prepCloseDetail')?.addEventListener('click', () => {
    panel.style.display = 'none';
    if (_state) _state.selectedId = null;
    _deleteArmedPrepId = '';
    _renderListByState();
  });

  panel.querySelector('#prepDetailDeleteBtn')?.addEventListener('click', async () => {
    if (!it?.id) return;
    if (_deleteArmedPrepId !== it.id) {
      _deleteArmedPrepId = it.id;
      _showDetail(_state.items.find(x => x.id === it.id) || it);
      return;
    }
    if (!await _mexConfirm('Eliminar de cola', '¿Eliminar esta entrada de la cola? No borra la unidad del cuadre ni externos.', 'danger')) return;
    await _deletePrepItem(it.id);
  });
  panel.querySelector('#prepDetailCancelDelBtn')?.addEventListener('click', () => {
    _deleteArmedPrepId = '';
    _showDetail(_state.items.find(x => x.id === it.id) || it);
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
    if (!await _mexConfirm('Completar checklist', '¿Marcar todos los ítems del checklist como completados? Esto indica que la unidad está lista para salida.', 'warning')) return;
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
  </div>
  <div data-prep-toast-host style="position:fixed;bottom:20px;right:20px;z-index:50;pointer-events:none;max-width:min(320px,92vw);"></div>
  <datalist id="prepUsersDatalist"></datalist>
  <datalist id="prepMvaDatalist"></datalist>

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
    <!-- Filtros operativos: urgencia / pendiente / listo / míos -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:180px;">
      ${_filterBtn('all',      'Todos',       true)}
      ${_filterBtn('urgent',   'Urgentes',    false)}
      ${_filterBtn('pending',  'Pendientes',  false)}
      ${_filterBtn('ready',    'Listos',      false)}
      ${_filterBtn('mine',     'Míos',        false)}
      ${_filterBtn('with-date','Con salida',  false)}
    </div>

    <!-- Sort -->
    <select id="prepSortSelect"
            style="border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;
                   font-size:12px;font-family:inherit;color:#334155;background:#fff;outline:none;">
      <option value="__operational">Orden operativo (prioridad + salida)</option>
      <option value="fechaSalida:asc">Salida más próxima</option>
      <option value="orden:asc">Campo orden</option>
      <option value="mva:asc">MVA A→Z</option>
      <option value="creadoEn:desc">Alta reciente</option>
      <option value="creadoEn:asc">Alta antigua</option>
    </select>
  </div>

  <div style="padding:8px 16px 12px;border-bottom:1px solid #f1f5f9;background:#fafafa;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
    <button type="button" id="prepAddBtn" class="prep-primary-btn">
      <span class="material-symbols-outlined" style="font-size:18px;">playlist_add</span>
      Nueva salida
    </button>
    <button type="button" id="prepBulkCompleteBtn" style="display:none;" class="prep-link-btn" title="Marcar checklist completo en todas las unidades visibles">
      <span class="material-symbols-outlined" style="font-size:18px;">done_all</span>
      <span class="prep-btn-label">Todas listas</span>
    </button>
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

<div id="prepModal" class="prep-modal-overlay" style="display:none;">
  <div class="prep-modal-card" onclick="event.stopPropagation();">
    <div class="prep-modal-head">
      <div>
        <div class="prep-panel-kicker">Nueva salida</div>
        <h3>Agregar unidad a la cola</h3>
        <p style="margin:6px 0 0;font-size:12px;color:#64748b;">Registra manualmente la preparación si aún no existe en la cola.</p>
      </div>
      <button type="button" class="prep-icon-btn" id="prepModalCloseBtn" aria-label="Cerrar">
        <span class="material-symbols-outlined" style="font-size:18px;">close</span>
      </button>
    </div>

    <form id="prepCreateForm" class="prep-modal-form">
      <div class="prep-form-grid">
        <label class="prep-field">
          <span>MVA</span>
          <input id="prepCreateMva" type="text" maxlength="12" placeholder="Ej: A5256" list="prepMvaDatalist" autocomplete="off" required />
        </label>
        <label class="prep-field">
          <span>Fecha y hora de salida</span>
          <input id="prepCreateDeparture" type="datetime-local" required />
        </label>
      </div>

      <div id="prepCreateUnitPreview" class="prep-unit-preview" style="display:none;"></div>

      <div class="prep-form-grid">
        <label class="prep-field">
          <span>Asignado a</span>
          <input id="prepCreateAssigned" type="text" list="prepUsersDatalist" placeholder="Correo o nombre del operativo" />
        </label>
        <label class="prep-field">
          <span>Plaza</span>
          <input id="prepCreatePlaza" type="text" readonly />
        </label>
      </div>

      <label class="prep-field">
        <span>Notas iniciales</span>
        <textarea id="prepCreateNotes" rows="4" placeholder="Prioridad o comentario de patio"></textarea>
      </label>

      <div class="prep-modal-actions">
        <button type="button" class="prep-link-btn" id="prepModalCancelBtn">Cancelar</button>
        <button type="submit" class="prep-primary-btn">
          <span class="material-symbols-outlined" style="font-size:18px;">add_task</span>
          Guardar en cola
        </button>
      </div>
    </form>
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
