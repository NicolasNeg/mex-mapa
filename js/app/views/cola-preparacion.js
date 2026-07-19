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
import {
  subscribeColaQueue,
  hydrateQueueUnits,
  loadPlazaUsers,
  loadPlazaUnits
} from '/js/app/features/cola-preparacion/cola-data.js';
import { onTurnosActivos } from '/js/app/features/turnos/turnos-data.js';
import {
  enqueueUnit,
  patchItem,
  removeItem,
  reorderItems,
  bulkCompleteChecklist,
  syncItemListoToCuadre
} from '/js/app/features/cola-preparacion/cola-mutations.js';
import {
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
  matchesPrepSearch,
  matchesPrepFilter,
  canPrepManage,
  findItemByMva,
  deriveEstadoCola
} from '/js/app/features/cola-preparacion/cola-view-model.js';

// ── Módulo-level refs (una instancia a la vez) ───────────────
let _unsub     = null;   // listener Firestore activo
let _container = null;   // nodo DOM activo
let _state     = null;   // estado local de esta vista
let _unsubPlaza = null;  // listener de plaza global
let _unsubTurnos = null; // listener de turnos activos (badge/orden "en turno")
let _turnoActivoKeys = new Set(); // claves normalizadas (email/nombre) de quienes tienen turno ACTIVO
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

function _normNombre(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** ¿El texto de "asignado" corresponde a alguien con turno ACTIVO ahora? Best-effort por nombre. */
function _estaEnTurno(asignadoStr) {
  const norm = _normNombre(asignadoStr);
  if (!norm) return false;
  for (const key of _turnoActivoKeys) {
    if (norm === key || norm.includes(key) || key.includes(norm)) return true;
  }
  return false;
}

function _subscribeTurnosActivos(plaza) {
  if (typeof _unsubTurnos === 'function') { try { _unsubTurnos(); } catch (_) {} }
  _unsubTurnos = null;
  _turnoActivoKeys = new Set();
  if (!plaza) return;
  _unsubTurnos = onTurnosActivos(plaza, (turnos) => {
    _turnoActivoKeys = new Set(
      (turnos || []).map(t => _normNombre(t.usuarioNombre)).filter(Boolean)
    );
    _renderDatalists();
    _renderListByState();
  });
}

function _renderDatalists() {
  const udl = _container?.querySelector('#prepUsersDatalist');
  if (udl) {
    const ordered = [..._plazaUsers].sort((a, b) => {
      const aOn = _estaEnTurno(a.label) ? 0 : 1;
      const bOn = _estaEnTurno(b.label) ? 0 : 1;
      return aOn - bOn;
    });
    udl.innerHTML = ordered
      .map(u => `<option value="${escAttr(u.value)}">${esc(_estaEnTurno(u.label) ? `${u.label} — En turno` : u.label)}</option>`)
      .join('');
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
    const syncCandidates = items.filter(it => it.syncCuadre !== false);
    if (syncCandidates.length && await _mexConfirm(
      'Sincronizar con cuadre',
      `¿Marcar ${syncCandidates.length} unidad(es) como LISTO en el cuadre?`,
      'warning'
    )) {
      let synced = 0;
      for (const it of syncCandidates) {
        try {
          const snap = it.cuadreSnapshot || {};
          await syncItemListoToCuadre({
            plaza,
            mva: it.mva || it.id,
            actor,
            nombreAutor: _state?.profileName || actor,
            ubicacion: snap.ubicacion || 'PATIO',
            gasolina: snap.gasolina || 'N/A'
          });
          synced += 1;
        } catch (err) {
          console.warn('[prep-app] bulk sync', it.mva, err);
        }
      }
      if (synced) _toast(`${synced} unidad(es) sincronizadas con cuadre.`, 'success');
    }
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

async function _offerSyncListoToCuadre(item) {
  if (!item || item.syncCuadre === false) return;
  const mva = String(item.mva || item.id || '').toUpperCase().trim();
  if (!mva) return;
  const plaza = String(_state?.plaza || '').toUpperCase().trim();
  if (!plaza) return;

  const ok = await _mexConfirm(
    'Sincronizar con cuadre',
    `El checklist de ${mva} está completo. ¿Marcar la unidad como LISTO en el cuadre?`,
    'warning'
  );
  if (!ok) return;

  const actor = _state?.profileEmail || _state?.profileName || '';
  const snapshot = item.cuadreSnapshot || {};
  try {
    await syncItemListoToCuadre({
      plaza,
      mva,
      actor,
      nombreAutor: _state?.profileName || actor,
      ubicacion: snapshot.ubicacion || 'PATIO',
      gasolina: snapshot.gasolina || 'N/A'
    });
    _toast(`${mva} marcada como LISTO en cuadre.`, 'success');
  } catch (err) {
    console.error('[prep-app] sync cuadre', err);
    _toast(err?.message || 'No se pudo sincronizar con cuadre.', 'error');
  }
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
    const result = await patchItem({
      plaza,
      itemId,
      patch,
      actor: _state.profileEmail || '',
      touchMeta: opts.touchMeta !== false,
      logType: opts.logType || null,
      logMeta: { mva, ...(opts.logMeta || {}) }
    });
    if (opts.notify !== false) _toast(opts.successMsg || 'Cambios guardados.', 'success');
    const merged = result?.item || { ...item, ...patch, mva, syncCuadre: item?.syncCuadre };
    if (result?.becameReady && merged.syncCuadre !== false) {
      await _offerSyncListoToCuadre(merged);
    }
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
  _subscribeTurnosActivos(plaza);
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
  if (typeof _unsubTurnos === 'function') { try { _unsubTurnos(); } catch (_) {} }
  if (typeof _offGlobalSearch === 'function') { try { _offGlobalSearch(); } catch (_) {} }
  _unsub     = null;
  _unsubPlaza = null;
  _unsubTurnos = null;
  _turnoActivoKeys = new Set();
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
  _state.mvaDeepLinkHandled = false;
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
  _subscribeTurnosActivos(normalized);
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

  _unsub = subscribeColaQueue({
    plaza: expectedPlaza,
    onData: items => {
      if (!_container || !_state) return;
      if (subscriptionId !== _queueSubSeq) return;
      if (String(_state.plaza || '').toUpperCase().trim() !== expectedPlaza) return;
      _state.items = items;
      _state.loading = false;
      _state.hasSnapshot = true;
      _state.permissionDenied = false;
      _state.errorMessage = '';
      void _hydrateUnitMeta(expectedPlaza);
      _applyFilters();
      _renderListByState();
      _renderStats();
      if (!_state.mvaDeepLinkHandled) _tryOpenMvaFromQuery();
    },
    onError: err => {
      if (!_container || !_state) return;
      if (subscriptionId !== _queueSubSeq) return;
      if (String(_state.plaza || '').toUpperCase().trim() !== expectedPlaza) return;
      const code = String(err?.code || '').toLowerCase();
      if (code === 'permission-denied' && _state.hasSnapshot) {
        _debugLog('Ignoring late permission-denied after snapshot', { plaza: expectedPlaza });
        return;
      }
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
  });
  _trackListener('create', 'data-sub', { plaza: expectedPlaza });
}

// ── Filtrado / ordenamiento ──────────────────────────────────

function _applyFilters() {
  if (!_state) return;
  _state.filteredItems = filterAndSortItems(_state.items, {
    filterStatus: _state.filterStatus,
    searchQuery: _state.searchQuery,
    sortField: _state.sortField,
    sortDir: _state.sortDir,
    profileEmail: _state.profileEmail,
    profileName: _state.profileName
  }, _unitsByMva);
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
    <div class="cola-state">
      <span class="material-symbols-outlined cola-spin">sync</span>
      <div class="cola-state-msg">Cargando unidades…</div>
    </div>`;
}

function _renderError(msg) {
  const listEl = q('prepList');
  if (!listEl) return;
  listEl.innerHTML = `
    <div class="cola-state cola-state--error">
      <span class="material-symbols-outlined">error_outline</span>
      <div class="cola-state-msg">${esc(msg)}</div>
      <a href="/cola-preparacion" class="cola-state-link">Abrir módulo completo</a>
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
    <div class="cola-state">
      <span class="material-symbols-outlined">fact_check</span>
      <div class="cola-state-msg">${esc(msg)}</div>
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
  // Los conteos de los filtros se calculan sobre el conjunto completo
  // (respetando la búsqueda), no sobre el filtro de estado activo, para que
  // cada pestaña muestre cuántas unidades hay realmente en esa categoría.
  const base = (_state.items || []).filter(it => matchesPrepSearch(it, _state.searchQuery, _unitsByMva));
  const profileCtx = { profileEmail: _state.profileEmail, profileName: _state.profileName };
  const total = base.length;
  const urgentes = base.filter(it => urgencyType(it) === 'urgent').length;
  const listos = base.filter(it => isItemReady(it)).length;
  const pendientes = total - listos;
  const mios = base.filter(it => matchesPrepFilter(it, 'mine', profileCtx)).length;
  const progreso = total > 0
    ? Math.round(base.reduce((acc, it) => acc + cpProgress(it).percent, 0) / total)
    : 0;

  _setText('prepStatTotal',    String(total));
  _setText('prepStatUrgent',   String(urgentes));
  _setText('prepStatPending',  String(pendientes));
  _setText('prepStatReady',    String(listos));
  _setText('prepStatMine',     String(mios));
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
    card.querySelector('.cola-card-drag')?.addEventListener('click', e => e.stopPropagation());
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
  const progress = cpProgress(it);
  const urgency = urgencyType(it);
  const chipIcon = urgency === 'urgent' ? 'schedule' : (urgency === 'ready' ? 'check_circle' : 'pending');
  const chipLabel = countdownLabel(it.fechaSalida);
  const selected = _state.selectedId === it.id;

  return `
<article class="cola-card ${selected ? 'is-selected' : ''}" data-item-id="${esc(it.id)}" draggable="true">
  <button type="button" class="cola-card-drag" aria-label="Reordenar" tabindex="-1">
    <span class="material-symbols-outlined">drag_indicator</span>
  </button>
  <div class="cola-card-main">
    <div class="cola-card-top">
      <div>
        <div class="cola-card-mva">${esc(mva)}</div>
        <div class="cola-card-model">${esc(modelo)}</div>
      </div>
      <span class="cola-chip cola-chip--${urgency}">
        <span class="material-symbols-outlined">${chipIcon}</span>${esc(chipLabel)}
      </span>
    </div>
    <div class="cola-card-badges">
      <span class="cola-badge">${esc(unit.estado || 'Sin estado')}</span>
      <span class="cola-badge cola-badge--muted">
        <span class="material-symbols-outlined">place</span>${esc(unit.ubicacion || 'Sin ubicación')}
      </span>
    </div>
    <div class="cola-card-progress">
      <div class="cola-progress-track"><div class="cola-progress-fill" style="width:${progress.percent}%;"></div></div>
      <span class="cola-card-checks">${progress.done}/${progress.total}</span>
    </div>
    <div class="cola-card-foot">
      <span><span class="material-symbols-outlined">person</span>${esc(it.asignado || 'Sin responsable')}${_estaEnTurno(it.asignado) ? ' <span class="cola-badge-turno">En turno</span>' : ''}</span>
      <span><span class="material-symbols-outlined">event</span>${esc(departureLabel(it.fechaSalida))}</span>
    </div>
  </div>
</article>`;
}

// ── Panel de detalle ─────────────────────────────────────────

function _showDetail(it) {
  const panel = q('prepDetailPanel');
  if (!panel || !it) return;

  const unit = _unitsByMva.get(String(it.mva || '').toUpperCase()) || {};
  const estadoCola = deriveEstadoCola(it);
  const mvaRoute = escAttr(String(it.mva || '').toUpperCase());
  const plazaQ = escAttr(String(_state?.plaza || ''));

  const deleteArmed = _deleteArmedPrepId === it.id;
  const showDel = _canPrepDelete();
  const urgency = urgencyType(it);
  const chipIcon = urgency === 'urgent' ? 'schedule' : (urgency === 'ready' ? 'check_circle' : 'pending');

  panel.innerHTML = `
<div class="cola-detail-inner">
  <div class="cola-detail-head">
    <div>
      <h3 class="cola-detail-mva">${esc(it.mva || '—')}</h3>
      <div class="cola-detail-sub">${esc(unit.categoria || unit.modelo || 'Sin expediente local')}</div>
      <div class="cola-detail-head-chip">
        <span class="cola-chip cola-chip--${urgency}">
          <span class="material-symbols-outlined">${chipIcon}</span>${esc(countdownLabel(it.fechaSalida))}
        </span>
      </div>
    </div>
    <div class="cola-detail-head-actions">
      ${showDel ? `<button type="button" id="prepDetailDeleteBtn" class="prep-danger-btn${deleteArmed ? ' is-armed' : ''}">
        <span class="material-symbols-outlined">delete</span>${deleteArmed ? 'Confirmar' : ''}
      </button>` : ''}
      ${showDel && deleteArmed ? `<button type="button" id="prepDetailCancelDelBtn" class="prep-link-btn">Cancelar</button>` : ''}
      <button type="button" id="prepCloseDetail" class="prep-icon-btn" aria-label="Cerrar">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  </div>

  <div class="cola-meta-grid">
    ${_detailRow('Estado', unit.estado || 'Sin estado')}
    ${_detailRow('Ubicación', unit.ubicacion || 'Sin ubicación')}
    ${_detailRow('Estado cola', estadoCola)}
    ${_detailRow('Plaza', _state?.plaza || '—')}
  </div>

  ${_checklistSection(it)}

  <div class="cola-field">
    <label class="cola-field-label" for="prepDetailDeparture">Salida programada</label>
    <input id="prepDetailDeparture" class="cola-input" type="datetime-local" value="${esc(_toDatetimeLocal(it.fechaSalida))}" />
  </div>
  <div class="cola-field">
    <label class="cola-field-label" for="prepDetailAssigned">Responsable asignado ${_estaEnTurno(it.asignado) ? '<span class="cola-badge-turno">En turno</span>' : ''}</label>
    <div class="cola-field-row">
      <input id="prepDetailAssigned" class="cola-input" type="text" value="${esc(it.asignado || '')}"
             placeholder="Correo o nombre" list="prepUsersDatalist" />
      <button type="button" id="prepAssignMeBtn" class="prep-link-btn">Asignarme</button>
    </div>
  </div>
  <div class="cola-field">
    <label class="cola-field-label" for="prepDetailNotes">Notas (no destructivas)</label>
    <textarea id="prepDetailNotes" class="cola-textarea" rows="3">${esc(it.notas || '')}</textarea>
  </div>

  <div class="cola-detail-links">
    <a data-app-route="/app/cuadre/u/${mvaRoute}" href="/app/cuadre/u/${mvaRoute}" class="prep-link-btn">
      <span class="material-symbols-outlined">folder_open</span>Expediente
    </a>
    <a data-app-route="/app/mapa?mva=${mvaRoute}${plazaQ ? `&plaza=${plazaQ}` : ''}"
       href="/app/mapa?mva=${mvaRoute}${plazaQ ? `&plaza=${plazaQ}` : ''}" class="prep-link-btn">
      <span class="material-symbols-outlined">map</span>Ver en mapa
    </a>
  </div>
</div>

<div class="cola-detail-foot">
  <button type="button" id="prepCompleteChecklistBtn" class="prep-soft-btn">
    <span class="material-symbols-outlined">task_alt</span>Marcar listo
  </button>
  <button type="button" id="prepDetailSaveBtn" class="prep-primary-btn">
    <span class="material-symbols-outlined">save</span>Guardar cambios
  </button>
</div>`;

  panel.style.display = 'flex';

  panel.querySelectorAll('[data-app-route]').forEach(link => {
    link.addEventListener('click', e => {
      if (!_state?._navigate) return;
      e.preventDefault();
      _state._navigate(link.dataset.appRoute);
    });
  });

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
    }, { successMsg: 'Salida y notas actualizadas.', logType: 'save', logMeta: { fechaSalida: departure } });
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
    const ok = await _patchQueueItem(it.id, { asignado: assignee }, { successMsg: 'Asignación actualizada.', logType: 'assign' });
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
    const ok = await _patchQueueItem(it.id, { checklist }, { successMsg: 'Checklist completado.', logType: 'complete' });
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
      const nextChecklist = { ...(it.checklist || {}), [key]: checked };
      const ok = await _patchQueueItem(it.id, { checklist: nextChecklist }, {
        notify: false,
        logType: 'checklist_key',
        logMeta: { key, checked }
      });
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
<div class="cola-meta-cell">
  <div class="cola-meta-label">${esc(label)}</div>
  <div class="cola-meta-value">${esc(String(value ?? '—'))}</div>
</div>`;
}

function _checklistSection(it) {
  const prog = cpProgress(it);
  const pct = prog.percent;

  return `
<div class="cola-checklist">
  <div class="cola-checklist-head">
    <span class="cola-section-title">Checklist de preparación</span>
    <span class="cola-checklist-count">${prog.done}/${prog.total}</span>
  </div>
  <div class="cola-progress-track" style="margin-bottom:12px;">
    <div class="cola-progress-fill" style="width:${pct}%;"></div>
  </div>
  ${CHECKLIST_META.map(meta => {
    const done = it.checklist?.[meta.key] === true;
    return `
    <label class="cola-check">
      <input type="checkbox" data-prep-check="${meta.key}" ${done ? 'checked' : ''} />
      <div>
        <div class="cola-check-label">${esc(meta.label)}</div>
        <div class="cola-check-hint">${esc(meta.hint)}</div>
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
<div class="cola-view">

  <!-- Barra superior de contexto -->
  <div data-prep-topbar class="cola-topbar">
    <a data-app-route="/app/dashboard" href="/app/dashboard" class="cola-back">
      <span class="material-symbols-outlined">arrow_back</span>
      Dashboard
    </a>
    <span class="cola-topbar-sep">·</span>
    <span class="cola-topbar-title">Cola de preparación</span>
    <span id="prepTopbarPlaza" class="cola-plaza-badge" style="display:${plaza ? 'inline-flex' : 'none'};">${esc(plaza)}</span>
  </div>
  <div data-prep-toast-host style="position:fixed;bottom:20px;right:20px;z-index:50;pointer-events:none;max-width:min(320px,92vw);"></div>
  <datalist id="prepUsersDatalist"></datalist>
  <datalist id="prepMvaDatalist"></datalist>

  <!-- Resumen + filtros (control unificado con conteos) -->
  <div class="cola-filters">
    <div class="cola-filter-scroll">
      ${_filterBtn('all',     'Todos',      'list_alt',     'prepStatTotal',   true)}
      ${_filterBtn('urgent',  'Urgentes',   'warning',      'prepStatUrgent',  false)}
      ${_filterBtn('pending', 'Pendientes', 'schedule',     'prepStatPending', false)}
      ${_filterBtn('ready',   'Listos',     'check_circle', 'prepStatReady',   false)}
      ${_filterBtn('mine',    'Míos',       'person',       'prepStatMine',    false)}
    </div>
  </div>
  <div class="cola-progress">
    <div class="cola-progress-track"><div id="prepProgressBar" class="cola-progress-fill"></div></div>
    <span id="prepStatProgress" class="cola-progress-label">0%</span>
  </div>

  <!-- Barra de acciones -->
  <div class="cola-toolbar">
    <button type="button" id="prepAddBtn" class="prep-primary-btn">
      <span class="material-symbols-outlined">add</span>
      Nueva salida
    </button>
    <button type="button" id="prepBulkCompleteBtn" style="display:none;" class="prep-link-btn" title="Marcar checklist completo en todas las unidades visibles">
      <span class="material-symbols-outlined">done_all</span>
      Todas listas
    </button>
    <div class="cola-toolbar-spacer"></div>
    <label class="cola-sort">
      <span class="material-symbols-outlined">swap_vert</span>
      <select id="prepSortSelect">
        <option value="__operational">Orden operativo</option>
        <option value="fechaSalida:asc">Salida más próxima</option>
        <option value="mva:asc">MVA A→Z</option>
        <option value="creadoEn:desc">Alta reciente</option>
      </select>
    </label>
  </div>

  <!-- Layout: lista + detalle -->
  <div class="cola-body">
    <div class="cola-list-wrap">
      <div id="prepList" class="cola-list"></div>
    </div>
    <aside id="prepDetailPanel" class="cola-detail" style="display:none;"></aside>
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
`;
}

function _filterBtn(value, label, icon, countId, active) {
  const count = countId
    ? `<span class="cola-filter-count" id="${countId}">0</span>`
    : '';
  return `
<button type="button" data-prep-filter="${value}" class="cola-filter${active ? ' active' : ''}">
  <span class="material-symbols-outlined">${icon}</span>
  ${esc(label)}
  ${count}
</button>`;
}
