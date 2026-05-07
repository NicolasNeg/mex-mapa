import { getState, onPlazaChange, subscribe } from '/js/app/app-state.js';
import { esGlobal } from '/domain/permissions.model.js';
import { createMapaLifecycleController } from '/js/app/features/mapa/mapa-lifecycle.js';
import { createMapaDndController } from '/js/app/features/mapa/mapa-dnd.js';
import {
  persistDebug,
  persistUnitMove,
  validatePersistMove
} from '/js/app/features/mapa/mapa-mutations.js';
import { sanitizeSpotToken } from '/js/app/features/mapa/mapa-view-model.js';
import { renderMapaReadOnly, renderErrorState, getResolvedMapaSelection } from '/js/app/features/mapa/mapa-renderer.js';
import { createQuickIncident, hasQuickIncidentApi } from '/js/app/features/mapa/mapa-unit-quick-incident.js';

let _container = null;
let _contentEl = null;
let _lifecycle = null;
let _dndController = null;
let _offPlaza = null;
let _offGlobalSearch = null;
let _offState = null;
let _onClick = null;
let _toolbarHandler = null;
let _searchInputHandler = null;
let _cssRef = null;
let _dndHintEl = null;
let _lastDndEligibility = null;
/** @type {{ mva: string, originKey: string, destKey: string, at: number, user: string } | null} */
let _lastPersistSummary = null;
/** @type {{ cleanup?: Function, setPlaza?: Function } | null} */
let _incCtrl = null;
let _incSummaryState = {
  byMva: {},
  plaza: '',
  ready: false,
  failed: false
};
let _incSyncGen = 0;
let _unitActionsCtrl = null;
let _unitActionDefs = [];
let _unitActionStatus = 'idle';
let _unitActionMsg = '';
let _unitActionLastError = '';

let _viewState = {
  query: '',
  selectedId: '',
  snapshot: null,
  quickFilter: 'all',
  viewMode: 'grid'
};

function _trackListener(action, name, extra = {}) {
  if (typeof window.__mexTrackListener !== 'function') return;
  window.__mexTrackListener(window.location.pathname, `app/mapa:${name}`, action, extra);
}

function _debugInc(label, extra) {
  try {
    if (localStorage.getItem('mex.debug.mode') !== '1') return;
    console.warn(`[app/mapa/inc] ${label}`, extra || '');
  } catch (_) {}
}

function _debugUnitActions(label, extra) {
  try {
    if (localStorage.getItem('mex.debug.mode') !== '1') return;
    console.warn(`[app/mapa/unit-actions] ${label}`, extra || '');
  } catch (_) {}
}

function _defaultUnitActionDefs() {
  return [
    { id: 'update_status', label: 'Cambiar estado', available: false, blocked: true, reason: 'Disponible en mapa clásico' },
    { id: 'update_notes', label: 'Actualizar notas', available: false, blocked: true, reason: 'Disponible en mapa clásico' },
    { id: 'update_gas', label: 'Actualizar gasolina', available: false, blocked: true, reason: 'Disponible en mapa clásico' },
    { id: 'mark_ready', label: 'Marcar lista / no lista', available: false, blocked: true, reason: 'Disponible en mapa clásico' },
    { id: 'send_to_preparacion', label: 'Enviar a cola preparación', available: false, blocked: true, reason: 'Disponible en mapa clásico' },
    { id: 'delete_unit', label: 'Eliminar unidad', available: false, blocked: true, reason: 'Función avanzada en mapa clásico' },
    { id: 'create_unit', label: 'Alta de unidad', available: false, blocked: true, reason: 'Función avanzada en mapa clásico' },
    { id: 'bulk_actions', label: 'Acciones masivas', available: false, blocked: true, reason: 'Función avanzada en mapa clásico' },
    { id: 'close_formal', label: 'Cierre formal', available: false, blocked: true, reason: 'Función avanzada en mapa clásico' },
    { id: 'pdf_reports', label: 'Reportes / PDF', available: false, blocked: true, reason: 'Función avanzada en mapa clásico' },
    { id: 'edit_map_structure', label: 'Editar estructura de mapa', available: false, blocked: true, reason: 'Función avanzada en mapa clásico' }
  ];
}

function _unitActionContext() {
  const st = getState();
  const profile = st?.profile || {};
  return {
    state: st,
    profile,
    role: String(st?.role || '').toUpperCase(),
    plaza: String(st?.currentPlaza || profile?.plazaAsignada || '').toUpperCase(),
    user: {
      uid: String(profile.uid || profile.id || st?.user?.uid || ''),
      email: String(profile.email || st?.user?.email || ''),
      nombre: _actorName()
    },
    debug: (() => {
      try {
        return localStorage.getItem('mex.debug.mode') === '1';
      } catch (_) {
        return false;
      }
    })()
  };
}

async function _loadUnitActionsController() {
  _unitActionStatus = 'loading';
  _unitActionMsg = 'Preparando acciones operativas seguras…';
  _unitActionLastError = '';
  try {
    const mod = await import('/js/app/features/mapa/mapa-unit-actions.js');
    const factory =
      mod?.createMapaUnitActionsController ||
      mod?.createUnitActionsController ||
      mod?.createController ||
      null;
    if (typeof factory !== 'function') {
      throw new Error('factory_missing');
    }
    const dbRef = window._db || window.firebase?.firestore?.() || null;
    _unitActionsCtrl = factory({
      api: window.api,
      db: dbRef,
      getState,
      getCurrentPlaza: () => String(getState()?.currentPlaza || '').toUpperCase(),
      getCurrentUser: () => getState()?.profile || {},
      profile: () => getState()?.profile || {},
      debug: _unitActionContext().debug
    });
    _unitActionStatus = 'ready';
    _unitActionMsg = '';
    _unitActionDefs = _defaultUnitActionDefs();
  } catch (err) {
    _unitActionsCtrl = null;
    _unitActionStatus = 'missing';
    _unitActionDefs = _defaultUnitActionDefs();
    _unitActionLastError = String(err?.message || err || 'module_load_error');
    _unitActionMsg = 'Acciones mutantes no disponibles para esta unidad. Puedes usar acciones rápidas o abrir el mapa clásico.';
    _debugUnitActions('module load failed', err);
  } finally {
    _render();
  }
}

function _selectedUnit() {
  const snap = _viewState.snapshot;
  const selectedId = String(_viewState.selectedId || '');
  if (!snap || !selectedId) return null;
  const opts = {
    query: _viewState.query,
    selectedId,
    dndActive: _dndFullyEnabled(getState(), snap),
    plaza: snap.plaza || String(getState().currentPlaza || '').toUpperCase(),
    quickFilter: _viewState.quickFilter,
    viewMode: _viewState.viewMode,
    incidentsByMva: _incSummaryState.byMva,
    incidentsReady: _incSummaryState.ready,
    incidentsFailed: _incSummaryState.failed
  };
  return getResolvedMapaSelection(snap, opts);
}

async function _readAvailableUnitActions(selected) {
  if (!selected) return _defaultUnitActionDefs();
  if (!_unitActionsCtrl || _unitActionStatus !== 'ready') return _defaultUnitActionDefs();
  try {
    const ctx = _unitActionContext();
    const fn = _unitActionsCtrl.getAvailableActions || _unitActionsCtrl.resolveAvailableActions;
    if (typeof fn !== 'function') return _defaultUnitActionDefs();
    const out = await fn.call(_unitActionsCtrl, selected, ctx);
    if (!Array.isArray(out) || !out.length) return _defaultUnitActionDefs();
    return out.map(item => ({
      id: String(item?.id || item?.action || ''),
      label: String(item?.label || item?.action || 'Acción'),
      available: item?.available === true,
      blocked: item?.blocked === true,
      reason: String(item?.reason || ''),
      mutates: item?.mutates === true,
      requiresConfirm: item?.requiresConfirm === true || item?.requiresConfirmation === true
    })).map(item => {
      if (!item.id) return item;
      if (['open_legacy', 'create_incident_link_only', 'copy_json', 'refresh_unit'].includes(item.id)) {
        return { ...item, available: false, blocked: true, reason: 'Acción rápida disponible arriba' };
      }
      return item;
    });
  } catch (err) {
    _debugUnitActions('getAvailableActions failed', err);
    return _defaultUnitActionDefs();
  }
}

async function _refreshSelectedUnitActions() {
  const selected = _selectedUnit();
  _unitActionDefs = await _readAvailableUnitActions(selected);
  _render();
}

async function _syncIncSummaryPlaza(plazaRaw) {
  const gen = ++_incSyncGen;
  const p = String(plazaRaw || '')
    .toUpperCase()
    .trim();
  _incSummaryState = { byMva: {}, plaza: p, ready: false, failed: false };
  try {
    const mod = await import('/js/app/features/mapa/mapa-incidencias-summary.js');
    if (gen !== _incSyncGen || !_container) return;
    if (typeof mod.createMapaIncidenciasSummaryController !== 'function') {
      throw new Error('createMapaIncidenciasSummaryController missing');
    }
    if (!_incCtrl) {
      _incCtrl = mod.createMapaIncidenciasSummaryController({
        plaza: p,
        onSummary: snap => {
          if (!_container) return;
          const expect = String(getState().currentPlaza || '')
            .toUpperCase()
            .trim();
          const sp = String(snap?.plaza || '')
            .toUpperCase()
            .trim();
          if (expect && sp && sp !== expect) return;
          const loading = Boolean(snap?.loading);
          _incSummaryState = {
            byMva: snap?.byMva || {},
            plaza: sp,
            ready: !loading,
            failed: Boolean(!loading && snap?.error)
          };
          _render();
        },
        onError: err => {
          _debugInc('notas summary', err);
          if (!_container) return;
          const pNow = String(getState().currentPlaza || '')
            .toUpperCase()
            .trim();
          _incSummaryState = {
            byMva: {},
            plaza: pNow,
            ready: true,
            failed: true
          };
          _render();
        }
      });
      _incCtrl.subscribe?.();
    } else {
      _incCtrl.setPlaza?.(p);
    }
  } catch (e) {
    _debugInc('module load', e);
    if (gen !== _incSyncGen || !_container) return;
    _incSummaryState = {
      byMva: {},
      plaza: p,
      ready: true,
      failed: true
    };
    _render();
  }
}

function _readUrlQuery() {
  try {
    return String(new URLSearchParams(window.location.search).get('q') || '').trim();
  } catch (_) {
    return '';
  }
}

let _offPopstate = null;

function _readAppMapaDndFlag() {
  try {
    return localStorage.getItem('mex.appMapa.dnd') === '1';
  } catch (_) {
    return false;
  }
}

function _readAppMapaDndPersistFlag() {
  try {
    return localStorage.getItem('mex.appMapa.dndPersist') === '1';
  } catch (_) {
    return false;
  }
}

/** Roles que no deben tener movimiento ni guardado DnD App Shell (incl. operación y auxiliares). */
const _DND_PREVIEW_DENIED = new Set([
  'CORPORATIVO_USER',
  'JEFE_OPERACION',
  'AUXILIAR',
  'OPERACION'
]);

/**
 * Quién puede usar movimiento DnD: PROGRAMADOR, o cuenta admin global (Firestore isAdmin + esGlobal),
 * excluyendo CORPORATIVO_USER y JEFE_OPERACION explícitamente.
 */
function _canRolePreviewDnd(state) {
  const r = String(state?.role || '').toUpperCase();
  if (_DND_PREVIEW_DENIED.has(r)) return false;
  if (r === 'PROGRAMADOR') return true;
  const p = state?.profile || {};
  return Boolean(p.isAdmin === true && esGlobal(r));
}

/** Requiere al menos un cajón en la estructura cargada (mapa_config). */
function _hasCajonStructure(snapshot) {
  const rows = snapshot?.structure;
  if (!Array.isArray(rows) || !rows.length) return false;
  return rows.some(raw => {
    const t = String(raw?.tipo || '').toLowerCase();
    return t === 'cajon' && raw?.esLabel !== true;
  });
}

/**
 * Flag localStorage + rol + estructura real; decide badge, data-dnd y montaje del controller.
 * Sin estructura de cajones → sin DnD aunque el flag esté en "1".
 */
function _dndFullyEnabled(state, snapshot) {
  return _readAppMapaDndFlag() && _canRolePreviewDnd(state) && _hasCajonStructure(snapshot);
}

/** Guardado: además del movimiento, flag localStorage + mismo gate de rol + estructura. */
function _dndPersistFullyEnabled(state, snapshot) {
  return (
    _dndFullyEnabled(state, snapshot) &&
    _readAppMapaDndPersistFlag() &&
    _canRolePreviewDnd(state)
  );
}

function _actorName() {
  const p = getState().profile || {};
  return String(p.nombreCompleto || p.nombre || p.email || p.usuario || 'AppShell').trim() || 'AppShell';
}

function _spotTok(v) {
  return sanitizeSpotToken(String(v || ''));
}

function _removeMapaModals() {
  _container?.querySelectorAll?.('.app-mapa-modal-overlay')?.forEach(el => el.remove());
}

function _currentAuditUser() {
  const st = getState();
  const p = st?.profile || {};
  return {
    uid: String(p.uid || p.id || st?.user?.uid || ''),
    email: String(p.email || st?.user?.email || ''),
    nombre: _actorName(),
    nombreCompleto: String(p.nombreCompleto || p.nombre || '')
  };
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function _waitSnapshotReflectsMove(mva, destKey, timeoutMs = 4800) {
  const want = _spotTok(destKey);
  const mv = String(mva || '').toUpperCase();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const data = _lifecycle?.getSnapshot?.()?.data;
    const u = data?.units?.find(x => String(x?.mva || '').toUpperCase() === mv);
    if (u && _spotTok(u.pos || 'LIMBO') === want) return true;
    await _sleep(260);
  }
  return false;
}

function _snapshotShowsMove(mva, destKey) {
  const data = _lifecycle?.getSnapshot?.()?.data;
  const mv = String(mva || '').toUpperCase();
  const u = data?.units?.find(x => String(x?.mva || '').toUpperCase() === mv);
  return Boolean(u && _spotTok(u.pos || 'LIMBO') === _spotTok(destKey));
}

function _mapModeLabel(state, snapshot) {
  const ro = !_dndFullyEnabled(state, snapshot);
  if (ro) return 'Consulta';
  if (!_readAppMapaDndPersistFlag()) return 'Movimiento sin guardado';
  if (_dndPersistFullyEnabled(state, snapshot)) return 'Movimiento con guardado';
  return 'Movimiento sin guardado';
}

function _fmtShort(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' });
  } catch (_) {
    return '—';
  }
}

function _updateMetaLines() {
  const syncEl = _container?.querySelector('#app-mapa-sync-line');
  const moveEl = _container?.querySelector('#app-mapa-last-move');
  const snap = _viewState.snapshot;
  const lu = snap?.lastUpdated;
  if (syncEl) {
    syncEl.textContent = lu
      ? `Última sincronización de datos: ${_fmtShort(lu)}`
      : 'Última sincronización de datos: —';
  }
  if (moveEl) {
    if (_lastPersistSummary) {
      const s = _lastPersistSummary;
      moveEl.textContent = `Último guardado: ${s.mva} · ${s.originKey}→${s.destKey} · ${_fmtShort(s.at)} · ${s.user}`;
      moveEl.hidden = false;
    } else {
      moveEl.textContent = '';
      moveEl.hidden = true;
    }
  }
}

function _updateMapModeBanner() {
  const el = _container?.querySelector('#app-mapa-mode-state');
  if (!el) return;
  const snap = _viewState.snapshot;
  el.textContent = _mapModeLabel(getState(), snap);
}

function _syncLocalSearchInput() {
  const input = _container?.querySelector('#app-mapa-search');
  const clearBtn = _container?.querySelector('[data-app-mapa-action="clear-search"]');
  if (!input) return;
  const q = String(_viewState.query || '');
  if (input.value !== q) input.value = q;
  if (clearBtn) clearBtn.hidden = q.length === 0;
}

function _updatePlazaHeader(plazaValue = '') {
  const el = _container?.querySelector('#app-mapa-plaza-active');
  if (!el) return;
  const safe = String(plazaValue || '').trim().toUpperCase();
  el.textContent = safe || '—';
}

function _showPersistConfirm({ mva, fromKey, toKey }) {
  return new Promise(resolve => {
    if (!_container) {
      resolve(false);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'app-mapa-modal-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.innerHTML = `
      <div class="app-mapa-modal">
        <p class="app-mapa-modal-title">Confirmar movimiento</p>
        <p class="app-mapa-modal-body">¿Mover unidad <strong>${esc(mva)}</strong> de <strong>${esc(fromKey)}</strong> a <strong>${esc(toKey)}</strong>?</p>
        <div class="app-mapa-modal-actions">
          <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--ghost" data-act="cancel">Cancelar</button>
          <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--primary" data-act="ok">Confirmar movimiento</button>
        </div>
      </div>`;
    const done = ok => {
      wrap.remove();
      resolve(ok);
    };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) done(false);
    });
    wrap.querySelector('[data-act="cancel"]')?.addEventListener('click', () => done(false));
    wrap.querySelector('[data-act="ok"]')?.addEventListener('click', () => done(true));
    _container.appendChild(wrap);
  });
}

function _payloadTemplateForAction(actionId) {
  const id = String(actionId || '').toLowerCase();
  if (id === 'update_status' || id.includes('estado')) {
    return {
      estado: '',
      options: ['LISTO', 'SUCIO', 'MANTENIMIENTO', 'TRASLADO', 'RESGUARDO', 'NO ARRENDABLE']
    };
  }
  if (id === 'update_notes' || id.includes('nota')) {
    return { notas: '' };
  }
  if (id === 'update_gas' || id.includes('gas')) {
    return { gasolina: '' };
  }
  if (id === 'mark_ready' || id.includes('lista') || id.includes('ready')) {
    return { listo: true };
  }
  if (id === 'send_to_preparacion' || id.includes('cola') || id.includes('prep')) {
    return { destino: 'cola-preparacion' };
  }
  return {};
}

async function _showUnitActionModal({ action, selected, context }) {
  return new Promise(resolve => {
    if (!_container) return resolve({ cancelled: true });
    const aid = String(action?.id || '').trim();
    const payload = _payloadTemplateForAction(aid);
    const hasEstado = Object.prototype.hasOwnProperty.call(payload, 'estado');
    const hasNotas = Object.prototype.hasOwnProperty.call(payload, 'notas');
    const hasGas = Object.prototype.hasOwnProperty.call(payload, 'gasolina');
    const hasListo = Object.prototype.hasOwnProperty.call(payload, 'listo');
    const hasDestino = Object.prototype.hasOwnProperty.call(payload, 'destino');
    const wrap = document.createElement('div');
    wrap.className = 'app-mapa-modal-overlay';
    wrap.setAttribute('role', 'dialog');
    const estadoOptions = (payload.options || [])
      .map(v => `<option value="${esc(v)}">${esc(v)}</option>`)
      .join('');
    wrap.innerHTML = `
      <div class="app-mapa-modal app-mapa-modal--unit-action">
        <p class="app-mapa-modal-title">${esc(action?.label || 'Acción operativa')}</p>
        <p class="app-mapa-modal-body">Esta acción modificará la unidad <strong>${esc(selected?.mva || '—')}</strong> en plaza <strong>${esc(context?.plaza || '—')}</strong>.</p>
        <div class="app-mapa-form-grid">
          ${hasEstado ? `<label class="app-mapa-form-field"><span>Estado</span><select data-fld="estado"><option value="">Seleccionar...</option>${estadoOptions}</select></label>` : ''}
          ${hasGas ? `<label class="app-mapa-form-field"><span>Gasolina</span><input data-fld="gasolina" type="text" value="${esc(String(payload.gasolina || ''))}" placeholder="Ej. 3/4, F, H"/></label>` : ''}
          ${hasNotas ? `<label class="app-mapa-form-field"><span>Notas</span><textarea data-fld="notas" rows="3" placeholder="Detalle operativo"></textarea></label>` : ''}
          ${hasListo ? `<label class="app-mapa-form-field app-mapa-form-field--check"><input data-fld="listo" type="checkbox" ${payload.listo ? 'checked' : ''}/> <span>Marcar como lista</span></label>` : ''}
          ${hasDestino ? `<label class="app-mapa-form-field"><span>Destino</span><input data-fld="destino" type="text" value="${esc(String(payload.destino || 'cola-preparacion'))}" /></label>` : ''}
        </div>
        <p class="app-mapa-form-msg" data-msg></p>
        <div class="app-mapa-modal-actions">
          <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--ghost" data-act="cancel">Cancelar</button>
          <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--primary" data-act="ok">Confirmar</button>
        </div>
      </div>`;
    const msgEl = wrap.querySelector('[data-msg]');
    const done = result => {
      wrap.remove();
      resolve(result);
    };
    const collectPayload = () => {
      const next = {};
      wrap.querySelectorAll('[data-fld]').forEach(el => {
        const k = String(el.getAttribute('data-fld') || '');
        if (!k) return;
        if (el.type === 'checkbox') next[k] = Boolean(el.checked);
        else next[k] = String(el.value || '').trim();
      });
      return next;
    };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) done({ cancelled: true });
    });
    wrap.querySelector('[data-act="cancel"]')?.addEventListener('click', () => done({ cancelled: true }));
    wrap.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const out = collectPayload();
      if (msgEl) msgEl.textContent = '';
      done({ cancelled: false, payload: out });
    });
    _container.appendChild(wrap);
  });
}

async function _showQuickIncidentModal(selected) {
  return new Promise(resolve => {
    if (!_container) return resolve({ cancelled: true });
    const plaza = String(getState()?.currentPlaza || selected?.plaza || '').toUpperCase();
    const wrap = document.createElement('div');
    wrap.className = 'app-mapa-modal-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.innerHTML = `
      <div class="app-mapa-modal app-mapa-modal--unit-action">
        <p class="app-mapa-modal-title">Crear incidencia</p>
        <p class="app-mapa-modal-body">Se registrará una incidencia para <strong>${esc(selected?.mva || '—')}</strong> en plaza <strong>${esc(plaza || '—')}</strong>.</p>
        <div class="app-mapa-form-grid">
          <label class="app-mapa-form-field"><span>Título</span><input data-fld="titulo" type="text" maxlength="90" placeholder="Ej. Daño detectado"/></label>
          <label class="app-mapa-form-field"><span>Prioridad</span><select data-fld="prioridad">
            <option value="MEDIA">Media</option>
            <option value="ALTA">Alta</option>
            <option value="CRITICA">Crítica</option>
            <option value="BAJA">Baja</option>
          </select></label>
          <label class="app-mapa-form-field"><span>Descripción</span><textarea data-fld="descripcion" rows="4" maxlength="800" placeholder="Describe lo que debe revisar operación"></textarea></label>
        </div>
        <p class="app-mapa-form-msg" data-msg></p>
        <div class="app-mapa-modal-actions">
          <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--ghost" data-act="cancel">Cancelar</button>
          <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--primary" data-act="ok">Crear incidencia</button>
        </div>
      </div>`;
    const msgEl = wrap.querySelector('[data-msg]');
    const done = result => {
      wrap.remove();
      resolve(result);
    };
    const collectPayload = () => {
      const out = {};
      wrap.querySelectorAll('[data-fld]').forEach(el => {
        const k = String(el.getAttribute('data-fld') || '');
        if (k) out[k] = String(el.value || '').trim();
      });
      return out;
    };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) done({ cancelled: true });
    });
    wrap.querySelector('[data-act="cancel"]')?.addEventListener('click', () => done({ cancelled: true }));
    wrap.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const payload = collectPayload();
      if (!payload.titulo || !payload.descripcion) {
        if (msgEl) msgEl.textContent = 'Título y descripción son obligatorios.';
        return;
      }
      done({ cancelled: false, payload });
    });
    _container.appendChild(wrap);
    wrap.querySelector('[data-fld="titulo"]')?.focus?.();
  });
}

async function _createQuickIncidentForSelected() {
  const selected = _selectedUnit();
  if (!selected) {
    if (_dndHintEl) {
      _dndHintEl.textContent = 'Selecciona una unidad para crear incidencia.';
      _dndHintEl.hidden = false;
    }
    return;
  }
  const mva = String(selected.mva || '').trim();
  if (!hasQuickIncidentApi(window.api)) {
    window.location.assign(`/app/incidencias?mva=${encodeURIComponent(mva)}`);
    return;
  }
  const prepared = await _showQuickIncidentModal(selected);
  if (prepared.cancelled) {
    if (_dndHintEl) {
      _dndHintEl.textContent = 'Incidencia cancelada. No se realizaron cambios.';
      _dndHintEl.hidden = false;
    }
    return;
  }
  const plaza = String(getState()?.currentPlaza || selected?.plaza || '').toUpperCase();
  const res = await createQuickIncident({
    api: window.api,
    unit: selected,
    plaza,
    user: _currentAuditUser(),
    payload: prepared.payload
  });
  if (_dndHintEl) {
    _dndHintEl.textContent = res.ok
      ? (res.message || 'Incidencia creada. Actualizando bitácora…')
      : (res.message || 'No se pudo crear la incidencia. Usa bitácora completa.');
    _dndHintEl.hidden = false;
  }
  if (!res.ok) return;
  void _syncIncSummaryPlaza(plaza);
  await _lifecycle?.resyncData?.();
  _render();
}

async function _runUnitAction(actionId) {
  const selected = _selectedUnit();
  if (!selected) {
    if (_dndHintEl) {
      _dndHintEl.textContent = 'Selecciona una unidad para ejecutar acciones operativas.';
      _dndHintEl.hidden = false;
    }
    return;
  }
  const defs = await _readAvailableUnitActions(selected);
  const action = defs.find(a => String(a.id || '') === String(actionId || ''));
  if (!action || action.available !== true || action.blocked === true) {
    if (_dndHintEl) {
      _dndHintEl.textContent = `${action?.label || actionId}: disponible en mapa clásico o sin permisos.`;
      _dndHintEl.hidden = false;
    }
    return;
  }
  if (!_unitActionsCtrl) return;
  const ctx = _unitActionContext();
  const prepared = await _showUnitActionModal({ action, selected, context: ctx });
  if (prepared.cancelled) {
    if (_dndHintEl) {
      _dndHintEl.textContent = 'Acción cancelada. No se realizaron cambios.';
      _dndHintEl.hidden = false;
    }
    return;
  }
  const payload = prepared.payload || {};
  payload.confirmed = true;
  try {
    const validateFn = _unitActionsCtrl.validateUnitAction;
    if (typeof validateFn === 'function') {
      const v = await validateFn.call(_unitActionsCtrl, action.id, selected, payload, ctx);
      if (v && v.ok === false) {
        if (_dndHintEl) {
          _dndHintEl.textContent = v.message || 'La validación de la acción falló.';
          _dndHintEl.hidden = false;
        }
        return;
      }
    }
    const execFn = _unitActionsCtrl.executeUnitAction;
    if (typeof execFn !== 'function') {
      throw new Error('executeUnitAction no disponible');
    }
    const res = await execFn.call(_unitActionsCtrl, action.id, selected, payload, ctx);
    const ok = Boolean(res?.ok ?? res?.success ?? false);
    if (!ok) {
      if (_dndHintEl) {
        _dndHintEl.textContent = `No se pudo ejecutar la acción: ${res?.message || res?.error || 'error'}`;
        _dndHintEl.hidden = false;
      }
      return;
    }
    if (_dndHintEl) {
      _dndHintEl.textContent = res?.message || 'Acción operativa completada.';
      _dndHintEl.hidden = false;
    }
    let didResync = false;
    if (res?.requiresResync || res?.resync || res?.refresh) {
      await _lifecycle?.resyncData?.();
      didResync = true;
    }
    if (['update_status', 'update_notes', 'update_gas', 'mark_ready'].includes(String(action.id || ''))) {
      if (!didResync) await _lifecycle?.resyncData?.();
      if (_dndHintEl) {
        _dndHintEl.textContent = `${res?.message || 'Cambio aplicado.'} Mapa sincronizado.`;
        _dndHintEl.hidden = false;
      }
    }
    _render();
  } catch (err) {
    _debugUnitActions('run action failed', err);
    if (_dndHintEl) {
      _dndHintEl.textContent = `Error ejecutando acción: ${String(err?.message || err || 'desconocido')}`;
      _dndHintEl.hidden = false;
    }
  }
}

export function mount({ container }) {
  _container = container;
  _trackListener('create', 'view', { plaza: getState().currentPlaza || '' });
  _ensureCss();
  const state = getState();
  const plaza = String(state.currentPlaza || state.profile?.plazaAsignada || '').toUpperCase();
  _viewState = {
    query: _readUrlQuery(),
    selectedId: '',
    snapshot: null,
    quickFilter: 'all',
    viewMode: 'grid'
  };

  _container.innerHTML = `
    <section class="app-mapa-view">
      <header class="app-mapa-head">
        <div>
          <span class="app-mapa-badge app-mapa-badge--official">OFICIAL · OPERATIVO</span>
          <span id="app-mapa-dnd-badge" class="app-mapa-badge app-mapa-badge-dnd" style="display:${_dndFullyEnabled(state, null) ? 'inline-flex' : 'none'}">Movimiento habilitado</span>
          <span id="app-mapa-persist-badge" class="app-mapa-badge app-mapa-badge-persist" style="display:${_dndPersistFullyEnabled(state, null) ? 'inline-flex' : 'none'}">Movimiento con guardado</span>
          <h1>Mapa operativo</h1>
          <p>Plaza: <strong id="app-mapa-plaza-active">${esc(plaza || '—')}</strong> · <strong id="app-mapa-mode-state">${esc(_mapModeLabel(state, null))}</strong></p>
        </div>
        <a class="app-mapa-cta" href="/mapa?legacy=1">Abrir mapa clásico</a>
      </header>
      <div class="app-mapa-meta-lines" aria-live="polite">
        <div id="app-mapa-sync-line" class="app-mapa-meta-line"></div>
        <div id="app-mapa-last-move" class="app-mapa-meta-line app-mapa-meta-line--persist" hidden></div>
      </div>
      <div class="app-mapa-toolbar" role="toolbar" aria-label="Acciones mapa operativo">
        <button type="button" class="app-mapa-tool-btn" data-app-mapa-action="refresh">Refrescar mapa</button>
        <button type="button" class="app-mapa-tool-btn app-mapa-tool-btn--legacy" data-app-mapa-action="open-legacy" title="Editor, PDF, radar y herramientas completas">Abrir mapa clásico</button>
        <button type="button" class="app-mapa-tool-btn" data-app-mapa-action="scroll-unplaced">Ver sin ubicación / huérfanos</button>
        <button type="button" class="app-mapa-tool-btn" data-app-mapa-action="scroll-occupancy">Ver ocupación</button>
      </div>
      <div class="app-mapa-controls">
        <label class="app-mapa-search-wrap" aria-label="Buscar unidad en mapa">
          <span class="app-mapa-search-ic">search</span>
          <input id="app-mapa-search" class="app-mapa-search-input" type="search" placeholder="Buscar MVA, placas, modelo, notas o incidencias" value="${esc(_viewState.query)}" autocomplete="off" />
          <button type="button" class="app-mapa-search-clear" data-app-mapa-action="clear-search" ${_viewState.query ? '' : 'hidden'}>×</button>
        </label>
        <div class="app-mapa-quick" role="toolbar" aria-label="Filtros rápidos">
          <span class="app-mapa-quick-label">Filtrar unidades</span>
          <button type="button" class="app-mapa-qf is-active" data-mapa-qf="all">Todos</button>
          <button type="button" class="app-mapa-qf" data-mapa-qf="disponibles">Listos</button>
          <button type="button" class="app-mapa-qf" data-mapa-qf="no-arrendable">No arrendable</button>
          <button type="button" class="app-mapa-qf" data-mapa-qf="mantenimiento">Mtto / sucio</button>
          <button type="button" class="app-mapa-qf" data-mapa-qf="sin-ubicacion">Sin ubicación</button>
          <button type="button" class="app-mapa-qf" data-mapa-qf="limbo">Limbo</button>
          <button type="button" class="app-mapa-qf" data-mapa-qf="taller">Taller</button>
          <button type="button" class="app-mapa-qf" data-mapa-qf="con-ubicacion">En cajón</button>
          <button type="button" class="app-mapa-qf" data-mapa-qf="con-incidencias">Con incidencias</button>
          <button type="button" class="app-mapa-qf" data-mapa-qf="criticas">Críticas</button>
          <button type="button" class="app-mapa-qf" data-mapa-qf="externos">Externos</button>
        </div>
        <div class="app-mapa-view-toggle" role="toolbar" aria-label="Modo de vista">
          <button type="button" class="app-mapa-view is-active" data-mapa-view="grid">Por celdas</button>
          <button type="button" class="app-mapa-view" data-mapa-view="list">Lista</button>
        </div>
      </div>
      <div id="app-mapa-dnd-hint" class="app-mapa-dnd-hint" hidden></div>
      <div id="app-mapa-content" class="app-mapa-status is-loading">Cargando mapa…</div>
    </section>
  `;
  _contentEl = _container.querySelector('#app-mapa-content');
  _dndHintEl = _container.querySelector('#app-mapa-dnd-hint');
  const _searchEl = _container.querySelector('#app-mapa-search');
  if (_searchEl) {
    _searchInputHandler = event => {
      _viewState.query = String(event?.target?.value || '').trim();
      _render();
    };
    _searchEl.addEventListener('input', _searchInputHandler);
  }

  _lifecycle = createMapaLifecycleController({
    plaza,
    onData: snapshot => {
      const expect = String(getState().currentPlaza || '')
        .toUpperCase()
        .trim();
      const snapPlaza = String(snapshot?.plaza || '')
        .toUpperCase()
        .trim();
      if (expect && snapPlaza && snapPlaza !== expect) return;
      _viewState.snapshot = snapshot;
      _render();
    },
    onError: err => {
      _trackListener('error', 'data', { code: String(err?.code || '') });
    }
  });
  _lifecycle.mount();
  _trackListener('create', 'lifecycle');
  void _syncIncSummaryPlaza(plaza);
  void _loadUnitActionsController();

  _dndController = createMapaDndController({
    getSnapshot: () => _lifecycle?.getSnapshot?.()?.data || null,
    canMove: () => _dndFullyEnabled(getState(), _viewState.snapshot),
    getPersistAllowed: () => _dndPersistFullyEnabled(getState(), _viewState.snapshot),
    onPersistDrop: async ({ fromCtx, originKey, destKey, snapshot }) => {
      const st = getState();
      const plaza = String(
        snapshot?.plaza || st.currentPlaza || st.profile?.plazaAsignada || ''
      ).toUpperCase();
      let snap = snapshot || _viewState.snapshot;
      const baseOpts = {
        roleAllowed: _canRolePreviewDnd(st),
        persistFlagsOk: _readAppMapaDndFlag() && _readAppMapaDndPersistFlag()
      };

      if (_dndHintEl) {
        _dndHintEl.textContent = 'Validando movimiento…';
        _dndHintEl.hidden = false;
      }

      persistDebug('validate:start', {
        plaza,
        mva: fromCtx?.mva,
        originKey,
        destKey,
        units: snap?.units?.length,
        structure: snap?.structure?.length
      });

      let v = validatePersistMove(
        {
          snapshot: snap,
          mva: fromCtx?.mva,
          originKey,
          destKey,
          plaza
        },
        baseOpts
      );
      if (!v.ok) {
        persistDebug('validate:fail', v);
        _render();
        return {
          message: v.message,
          outcome: v.code === 'OCCUPIED' ? 'occupied' : 'invalid'
        };
      }

      const canFresh = typeof window.api?.obtenerDatosFlotaConsola === 'function';
      if (canFresh) {
        const freshUnits = await _lifecycle?.fetchFreshUnitsForValidation?.();
        if (freshUnits == null) {
          persistDebug('fresh:null');
          _render();
          return {
            message:
              'No se pudo verificar el estado actual en el servidor. Reintenta o usa Refrescar mapa.',
            outcome: 'stale'
          };
        }
        snap = { ...snap, units: freshUnits, plaza: snap?.plaza || plaza };
        v = validatePersistMove(
          {
            snapshot: snap,
            mva: fromCtx?.mva,
            originKey,
            destKey,
            plaza
          },
          baseOpts
        );
        persistDebug('validate:after-server', { ok: v.ok, code: v.code });
        if (!v.ok) {
          _render();
          return {
            message: v.message,
            outcome: v.code === 'OCCUPIED' ? 'occupied' : 'invalid'
          };
        }
      }

      const okModal = await _showPersistConfirm({
        mva: fromCtx.mva,
        fromKey: originKey,
        toKey: destKey
      });
      if (!okModal) {
        _render();
        return { message: 'Movimiento cancelado. No se guardó nada.', outcome: 'cancelled' };
      }
      if (_dndHintEl) {
        _dndHintEl.textContent = 'Guardando…';
        _dndHintEl.hidden = false;
      }
      const res = await persistUnitMove({
        api: window.api,
        plaza,
        usuario: _actorName(),
        mva: fromCtx.mva,
        posNueva: destKey
      });
      persistDebug('persist:api', {
        ok: res.success,
        error: res.error || null,
        mva: fromCtx.mva,
        dest: destKey,
        plaza,
        actor: _actorName()
      });
      if (!res.success) {
        _render();
        return {
          message: `No se pudo guardar: ${res.error || 'error'}`,
          outcome: 'error'
        };
      }

      _lastPersistSummary = {
        mva: String(fromCtx?.mva || ''),
        originKey: String(originKey || ''),
        destKey: String(destKey || ''),
        at: Date.now(),
        user: _actorName()
      };
      _updateMetaLines();

      if (_dndHintEl) {
        _dndHintEl.textContent =
          `Guardado: ${_lastPersistSummary.mva} ${_lastPersistSummary.originKey}→${_lastPersistSummary.destKey} · ${_fmtShort(_lastPersistSummary.at)} · ${_lastPersistSummary.user}. Esperando actualización…`;
        _dndHintEl.hidden = false;
      }

      const reflected = await _waitSnapshotReflectsMove(fromCtx.mva, destKey, 4800);
      if (reflected) {
        _render();
        return {
          message: 'Movimiento guardado y visible en el mapa.',
          outcome: 'saved'
        };
      }

      persistDebug('reflect:timeout-resync');
      await _lifecycle?.resyncData?.();
      await _sleep(850);
      if (_snapshotShowsMove(fromCtx.mva, destKey)) {
        _render();
        return {
          message: 'Movimiento guardado (sincronizado tras refresco de datos).',
          outcome: 'saved'
        };
      }

      _render();
      return {
        message:
          'Guardado en servidor. Si no ves el cambio, pulsa «Refrescar mapa» o abre el mapa clásico.',
        outcome: 'saved'
      };
    },
    pointerOnlyPreview: true,
    onMovePreview: payload => {
      if (_dndHintEl) {
        _dndHintEl.textContent = payload?.message || '';
        _dndHintEl.hidden = false;
      }
      const oc = payload?.outcome;
      if (oc === 'error' || oc === 'invalid' || oc === 'stale' || oc === 'cancelled') {
        _render();
      }
    },
    debug: (() => {
      try {
        return localStorage.getItem('mex.debug.mode') === '1';
      } catch (_) {
        return false;
      }
    })()
  });

  _offPlaza = onPlazaChange(nextPlaza => {
    _dndController?.disable?.();
    _dndController?.unmount?.();
    _removeMapaModals();
    _updatePlazaHeader(nextPlaza);
    _viewState.selectedId = '';
    _viewState.snapshot = null;
    _unitActionDefs = _defaultUnitActionDefs();
    if (_contentEl) _contentEl.innerHTML = '<div class="app-mapa-status is-loading">Actualizando plaza…</div>';
    void _syncIncSummaryPlaza(nextPlaza);
    _lifecycle?.setPlaza(nextPlaza);
  });
  _trackListener('create', 'plaza-sub');

  _offGlobalSearch = _bindGlobalSearch();
  _trackListener('create', 'global-search');
  _offPopstate = () => {
    _viewState.query = _readUrlQuery();
    _render();
  };
  window.addEventListener('popstate', _offPopstate);

  _onClick = event => {
    if (_dndController?.shouldSuppressClick?.()) return;
    const jsonBtn = event.target?.closest?.('[data-app-mapa-detail="copy-json"]');
    if (jsonBtn && _container?.contains(jsonBtn)) {
      const sid = String(_viewState.selectedId || '').trim();
      const units = Array.isArray(_viewState.snapshot?.units) ? _viewState.snapshot.units : [];
      const u =
        units.find(x => String(x?.id || '') === sid) ||
        units.find(x => String(x?.mva || '').toUpperCase() === sid.toUpperCase());
      if (u) {
        try {
          const payload = JSON.stringify(u, null, 2);
          navigator.clipboard?.writeText?.(payload).catch(() => {});
        } catch (_) {}
      }
      return;
    }
    const copyBtn = event.target?.closest?.('[data-copy-mva]');
    if (copyBtn) {
      const v = copyBtn.getAttribute('data-copy-mva') || '';
      navigator.clipboard?.writeText?.(v).catch(() => {});
      return;
    }
    const refreshBtn = event.target?.closest?.('[data-app-mapa-detail="refresh"]');
    if (refreshBtn) {
      _lifecycle?.resyncData?.();
      if (_dndHintEl) {
        _dndHintEl.textContent = 'Actualizando datos del mapa…';
        _dndHintEl.hidden = false;
      }
      return;
    }
    const incidentBtn = event.target?.closest?.('[data-app-mapa-detail="create-incident"]');
    if (incidentBtn) {
      void _createQuickIncidentForSelected();
      return;
    }
    const unitActionBtn = event.target?.closest?.('[data-app-mapa-unit-action]');
    if (unitActionBtn) {
      const actionId = String(unitActionBtn.getAttribute('data-app-mapa-unit-action') || '');
      if (actionId) void _runUnitAction(actionId);
      return;
    }
    const btn = event.target?.closest?.('[data-unit-id]');
    if (!btn) return;
    _viewState.selectedId = String(btn.getAttribute('data-unit-id') || '');
    _render();
    void _refreshSelectedUnitActions();
  };
  _container.addEventListener('click', _onClick);

  _toolbarHandler = ev => {
    const qfBtn = ev.target?.closest?.('[data-mapa-qf]');
    if (qfBtn && _container.contains(qfBtn)) {
      _viewState.quickFilter = qfBtn.getAttribute('data-mapa-qf') || 'all';
      _syncFilterChips();
      _render();
      return;
    }
    const vwBtn = ev.target?.closest?.('[data-mapa-view]');
    if (vwBtn && _container.contains(vwBtn)) {
      _viewState.viewMode = vwBtn.getAttribute('data-mapa-view') || 'grid';
      _syncFilterChips();
      _render();
      return;
    }
    const btn = ev.target?.closest?.('[data-app-mapa-action]');
    if (!btn || !_container.contains(btn)) return;
    const act = btn.getAttribute('data-app-mapa-action');
    if (act === 'refresh') {
      _lifecycle?.resyncData?.();
      if (_dndHintEl) {
        _dndHintEl.textContent = 'Actualizando datos del mapa…';
        _dndHintEl.hidden = false;
      }
      return;
    }
    if (act === 'open-legacy') {
      try {
        localStorage.setItem('mex.legacy.force', '1');
        window.location.assign('/mapa?legacy=1');
      } catch (err) {
        console.warn('[app/mapa] open classic map', err);
      }
      return;
    }
    if (act === 'scroll-unplaced') {
      document.getElementById('app-mapa-buckets')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (act === 'scroll-occupancy') {
      document.querySelector('.app-mapa-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (act === 'clear-search') {
      _viewState.query = '';
      _render();
      return;
    }
  };
  _container.addEventListener('click', _toolbarHandler);

  _lastDndEligibility = _dndFullyEnabled(getState(), null);
  _syncDndController();
  _updateMapModeBanner();
  _updateMetaLines();
  _syncLocalSearchInput();
  _syncFilterChips();

  _offState = subscribe(() => {
    _syncDndController();
    const cur = _dndFullyEnabled(getState(), _viewState.snapshot);
    if (cur === _lastDndEligibility) return;
    _lastDndEligibility = cur;
    _render();
  });
  _trackListener('create', 'state-sub');
}

export function unmount() {
  _removeMapaModals();
  try {
    _unitActionsCtrl?.cleanup?.();
  } catch (err) {
    _debugUnitActions('cleanup', err);
  }
  _unitActionsCtrl = null;
  _unitActionDefs = [];
  _unitActionStatus = 'idle';
  _unitActionMsg = '';
  _unitActionLastError = '';
  _incSyncGen++;
  try {
    _incCtrl?.cleanup?.();
  } catch (_) {}
  _incCtrl = null;
  _incSummaryState = { byMva: {}, plaza: '', ready: false, failed: false };
  if (_offPopstate) window.removeEventListener('popstate', _offPopstate);
  _offPopstate = null;
  const _searchEl = _container?.querySelector('#app-mapa-search');
  if (_searchEl && _searchInputHandler) _searchEl.removeEventListener('input', _searchInputHandler);
  _searchInputHandler = null;
  if (_container && _toolbarHandler) _container.removeEventListener('click', _toolbarHandler);
  _toolbarHandler = null;
  if (_container && _onClick) _container.removeEventListener('click', _onClick);
  if (typeof _offGlobalSearch === 'function') { _offGlobalSearch(); _trackListener('cleanup', 'global-search'); }
  if (typeof _offPlaza === 'function') { _offPlaza(); _trackListener('cleanup', 'plaza-sub'); }
  if (typeof _offState === 'function') { _offState(); _trackListener('cleanup', 'state-sub'); }
  _dndController?.unmount?.();
  _dndController = null;
  _lifecycle?.unmount?.();
  _trackListener('cleanup', 'lifecycle');
  _container = null;
  _contentEl = null;
  _lifecycle = null;
  _offPlaza = null;
  _offGlobalSearch = null;
  _offState = null;
  _onClick = null;
  _dndHintEl = null;
  _lastDndEligibility = null;
  _lastPersistSummary = null;
  _trackListener('cleanup', 'view');
}

function _syncDndController() {
  if (!_dndController || !_container) return;
  const badge = _container.querySelector('#app-mapa-dnd-badge');
  const pb = _container.querySelector('#app-mapa-persist-badge');
  const on = _dndFullyEnabled(getState(), _viewState.snapshot);
  const persistOn = _dndPersistFullyEnabled(getState(), _viewState.snapshot);
  if (badge) {
    badge.style.display = on ? 'inline-flex' : 'none';
  }
  if (pb) {
    pb.style.display = persistOn ? 'inline-flex' : 'none';
  }
  if (on) {
    _dndController.enable();
    _dndController.mount(_container);
  } else {
    _dndController.disable();
    _dndController.unmount();
    if (_dndHintEl) {
      _dndHintEl.textContent = '';
      _dndHintEl.hidden = true;
    }
  }
  _updateMapModeBanner();
  _syncLocalSearchInput();
}

function _syncFilterChips() {
  if (!_container) return;
  const qf = _viewState.quickFilter || 'all';
  _container.querySelectorAll('[data-mapa-qf]').forEach(b => {
    b.classList.toggle('is-active', (b.getAttribute('data-mapa-qf') || '') === qf);
  });
  const vm = _viewState.viewMode || 'grid';
  _container.querySelectorAll('[data-mapa-view]').forEach(b => {
    b.classList.toggle('is-active', (b.getAttribute('data-mapa-view') || '') === vm);
  });
}

function _syncMapaUrlQuery() {
  try {
    if (window.location.pathname !== '/app/mapa') return;
    const url = new URL(window.location.href);
    const q = String(_viewState.query || '').trim();
    if (q) url.searchParams.set('q', q);
    else url.searchParams.delete('q');
    const next = url.pathname + url.search + url.hash;
    const cur = window.location.pathname + window.location.search + window.location.hash;
    if (next !== cur) history.replaceState(null, '', next);
  } catch (_) {}
}

function _scrollToSearchMatch() {
  const q = String(_viewState.query || '').trim().toUpperCase();
  if (!q || !_contentEl) return;
  let el = null;
  try {
    const escFn =
      window.CSS && typeof window.CSS.escape === 'function'
        ? window.CSS.escape
        : s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    el = _contentEl.querySelector(`[data-mva="${escFn(q)}"]`);
  } catch (_) {}
  if (!el) el = _contentEl.querySelector('.app-mapa-unit.is-query-match');
  if (!el) el = _contentEl.querySelector('tr.app-mapa-list-row.is-query-match');
  try {
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (_) {}
}

function _render() {
  if (!_contentEl) return;
  const snapshot = _viewState.snapshot;
  if (!snapshot || snapshot.loading) {
    _contentEl.innerHTML = '<div class="app-mapa-status is-loading">Cargando mapa…</div>';
    _updateMetaLines();
    return;
  }
  if (snapshot.permissionDenied) {
    _contentEl.innerHTML = renderErrorState('No tienes permisos para ver mapa en esta plaza.');
    _syncMapaUrlQuery();
    return;
  }
  if (snapshot.missingIndex) {
    _contentEl.innerHTML = renderErrorState(
      'Falta un índice de Firestore para esta consulta. Un administrador debe crearlo, o usa el mapa clásico mientras tanto.'
    );
    _syncMapaUrlQuery();
    return;
  }
  if (snapshot.error) {
    _contentEl.innerHTML = renderErrorState(snapshot.error);
    _syncMapaUrlQuery();
    return;
  }
  const eligible = _dndFullyEnabled(getState(), snapshot);
  if (eligible !== _lastDndEligibility) {
    _lastDndEligibility = eligible;
    _syncDndController();
  }
  const readOpts = {
    query: _viewState.query,
    selectedId: _viewState.selectedId,
    dndActive: eligible,
    plaza: snapshot.plaza || String(getState().currentPlaza || '').toUpperCase(),
    quickFilter: _viewState.quickFilter,
    viewMode: _viewState.viewMode,
    incidentsByMva: _incSummaryState.byMva,
    incidentsReady: _incSummaryState.ready,
    incidentsFailed: _incSummaryState.failed
  };
  if (_viewState.selectedId && !getResolvedMapaSelection(snapshot, readOpts)) {
    _viewState.selectedId = '';
    readOpts.selectedId = '';
    _unitActionDefs = _defaultUnitActionDefs();
  }
  readOpts.unitActions = {
    secureActions: _unitActionDefs,
    message:
      _unitActionStatus === 'ready'
        ? ''
        : (_unitActionMsg || (_unitActionLastError ? `Acciones mutantes no disponibles (${_unitActionLastError}).` : 'Acciones mutantes no disponibles.'))
  };
  renderMapaReadOnly(_contentEl, snapshot, readOpts);
  _updatePlazaHeader(snapshot.plaza || getState().currentPlaza || '');
  _updateMapModeBanner();
  _updateMetaLines();
  _syncLocalSearchInput();
  _syncFilterChips();
  _syncMapaUrlQuery();
  requestAnimationFrame(() => {
    _scrollToSearchMatch();
  });
}

function _bindGlobalSearch() {
  const handler = event => {
    const route = String(event?.detail?.route || '');
    if (route && !route.startsWith('/app/mapa') && route !== '/mapa') return;
    _viewState.query = String(event?.detail?.query || '').trim();
    _syncLocalSearchInput();
    _render();
  };
  window.addEventListener('mex:global-search', handler);
  return () => window.removeEventListener('mex:global-search', handler);
}

function _ensureCss() {
  if (_cssRef && document.contains(_cssRef)) return;
  _cssRef = document.querySelector('link[data-app-mapa-css="1"]');
  if (_cssRef) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-mapa.css';
  link.setAttribute('data-app-mapa-css', '1');
  document.head.appendChild(link);
  _cssRef = link;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
