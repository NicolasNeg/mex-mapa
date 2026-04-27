import { getState, onPlazaChange, subscribe } from '/js/app/app-state.js';
import { esGlobal } from '/domain/permissions.model.js';
import { createMapaLifecycleController } from '/js/app/features/mapa/mapa-lifecycle.js';
import { createMapaDndController } from '/js/app/features/mapa/mapa-dnd.js';
import { renderMapaReadOnly, renderErrorState } from '/js/app/features/mapa/mapa-renderer.js';

let _container = null;
let _contentEl = null;
let _lifecycle = null;
let _dndController = null;
let _offPlaza = null;
let _offGlobalSearch = null;
let _offState = null;
let _onClick = null;
let _cssRef = null;
let _dndHintEl = null;
let _lastDndEligibility = null;
let _viewState = {
  query: '',
  selectedId: '',
  snapshot: null
};

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

/** Roles globales que no deben tener preview DnD (operativos / corporativo). */
const _DND_PREVIEW_DENIED = new Set(['CORPORATIVO_USER', 'JEFE_OPERACION']);

/**
 * Quién puede usar DnD preview: PROGRAMADOR, o cuenta admin global (Firestore isAdmin + esGlobal),
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

export function mount({ container }) {
  _container = container;
  _ensureCss();
  const state = getState();
  const plaza = String(state.currentPlaza || state.profile?.plazaAsignada || '').toUpperCase();
  _viewState = { query: _readUrlQuery(), selectedId: '', snapshot: null };

  _container.innerHTML = `
    <section class="app-mapa-view">
      <header class="app-mapa-head">
        <div>
          <span class="app-mapa-badge">Vista App Shell experimental</span>
          <span id="app-mapa-dnd-badge" class="app-mapa-badge app-mapa-badge-dnd" style="display:${_dndFullyEnabled(state, null) ? 'inline-flex' : 'none'}">DnD experimental (preview)</span>
          <h1>Mapa operativo</h1>
          <p>Plaza activa: <strong>${esc(plaza || '—')}</strong></p>
        </div>
        <a class="app-mapa-cta" href="/mapa">Abrir mapa completo</a>
      </header>
      <div class="app-mapa-note">
        Vista read-only experimental. Para operación completa usa mapa completo legacy.
      </div>
      <div id="app-mapa-dnd-hint" class="app-mapa-dnd-hint" hidden></div>
      <div id="app-mapa-content" class="app-mapa-status is-loading">Cargando mapa read-only...</div>
    </section>
  `;
  _contentEl = _container.querySelector('#app-mapa-content');
  _dndHintEl = _container.querySelector('#app-mapa-dnd-hint');

  _lifecycle = createMapaLifecycleController({
    plaza,
    onData: snapshot => {
      _viewState.snapshot = snapshot;
      _render();
    },
    onError: () => {
      _viewState.snapshot = _lifecycle?.getSnapshot?.()?.data || null;
      _render();
    }
  });
  _lifecycle.mount();

  _dndController = createMapaDndController({
    getSnapshot: () => _lifecycle?.getSnapshot?.()?.data || null,
    canMove: () => _dndFullyEnabled(getState(), _viewState.snapshot),
    pointerOnlyPreview: true,
    onMovePreview: payload => {
      if (_dndHintEl) {
        _dndHintEl.textContent = payload?.message || '';
        _dndHintEl.hidden = false;
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
    _viewState.selectedId = '';
    _viewState.snapshot = null;
    if (_contentEl) _contentEl.innerHTML = '<div class="app-mapa-status is-loading">Actualizando plaza...</div>';
    _lifecycle?.setPlaza(nextPlaza);
  });

  _offGlobalSearch = _bindGlobalSearch();
  _offPopstate = () => {
    _viewState.query = _readUrlQuery();
    _render();
  };
  window.addEventListener('popstate', _offPopstate);

  _onClick = event => {
    if (_dndController?.shouldSuppressClick?.()) return;
    const btn = event.target?.closest?.('[data-unit-id]');
    if (!btn) return;
    _viewState.selectedId = String(btn.getAttribute('data-unit-id') || '');
    _render();
  };
  _container.addEventListener('click', _onClick);

  _lastDndEligibility = _dndFullyEnabled(getState(), null);
  _syncDndController();

  _offState = subscribe(() => {
    const cur = _dndFullyEnabled(getState(), _viewState.snapshot);
    if (cur === _lastDndEligibility) return;
    _lastDndEligibility = cur;
    _syncDndController();
    _render();
  });
}

export function unmount() {
  if (_offPopstate) window.removeEventListener('popstate', _offPopstate);
  _offPopstate = null;
  if (_container && _onClick) _container.removeEventListener('click', _onClick);
  if (typeof _offGlobalSearch === 'function') _offGlobalSearch();
  if (typeof _offPlaza === 'function') _offPlaza();
  if (typeof _offState === 'function') _offState();
  _dndController?.unmount?.();
  _dndController = null;
  _lifecycle?.unmount?.();
  _container = null;
  _contentEl = null;
  _lifecycle = null;
  _offPlaza = null;
  _offGlobalSearch = null;
  _offState = null;
  _onClick = null;
  _dndHintEl = null;
  _lastDndEligibility = null;
}

function _syncDndController() {
  if (!_dndController || !_container) return;
  const badge = _container.querySelector('#app-mapa-dnd-badge');
  const on = _dndFullyEnabled(getState(), _viewState.snapshot);
  if (badge) {
    badge.style.display = on ? 'inline-flex' : 'none';
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
}

function _render() {
  if (!_contentEl) return;
  const snapshot = _viewState.snapshot;
  if (!snapshot || snapshot.loading) {
    _contentEl.innerHTML = '<div class="app-mapa-status is-loading">Cargando mapa read-only...</div>';
    return;
  }
  if (snapshot.permissionDenied) {
    _contentEl.innerHTML = renderErrorState('No tienes permisos para ver mapa en esta plaza.');
    return;
  }
  if (snapshot.error) {
    _contentEl.innerHTML = renderErrorState(snapshot.error);
    return;
  }
  const eligible = _dndFullyEnabled(getState(), snapshot);
  if (eligible !== _lastDndEligibility) {
    _lastDndEligibility = eligible;
    _syncDndController();
  }
  renderMapaReadOnly(_contentEl, snapshot, {
    query: _viewState.query,
    selectedId: _viewState.selectedId,
    dndActive: eligible,
    plaza: snapshot.plaza || String(getState().currentPlaza || '').toUpperCase()
  });
}

function _bindGlobalSearch() {
  const handler = event => {
    _viewState.query = String(event?.detail?.query || '').trim();
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
