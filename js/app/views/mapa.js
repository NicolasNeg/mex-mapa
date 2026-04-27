import { getState, onPlazaChange } from '/js/app/app-state.js';
import { createMapaLifecycleController } from '/js/app/features/mapa/mapa-lifecycle.js';
import { renderMapaReadOnly, renderErrorState } from '/js/app/features/mapa/mapa-renderer.js';

let _container = null;
let _contentEl = null;
let _lifecycle = null;
let _offPlaza = null;
let _offGlobalSearch = null;
let _onClick = null;
let _cssRef = null;
let _viewState = {
  query: '',
  selectedId: '',
  snapshot: null
};

export function mount({ container }) {
  _container = container;
  _ensureCss();
  const state = getState();
  const plaza = String(state.currentPlaza || state.profile?.plazaAsignada || '').toUpperCase();
  _viewState = { query: '', selectedId: '', snapshot: null };

  _container.innerHTML = `
    <section class="app-mapa-view">
      <header class="app-mapa-head">
        <div>
          <span class="app-mapa-badge">Vista App Shell experimental</span>
          <h1>Mapa operativo</h1>
          <p>Plaza activa: <strong>${esc(plaza || '—')}</strong></p>
        </div>
        <a class="app-mapa-cta" href="/mapa">Abrir mapa completo</a>
      </header>
      <div class="app-mapa-note">
        Vista read-only experimental. Para operación completa usa mapa completo legacy.
      </div>
      <div id="app-mapa-content" class="app-mapa-status is-loading">Cargando mapa read-only...</div>
    </section>
  `;
  _contentEl = _container.querySelector('#app-mapa-content');

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

  _offPlaza = onPlazaChange(nextPlaza => {
    _viewState.selectedId = '';
    _viewState.snapshot = null;
    if (_contentEl) _contentEl.innerHTML = '<div class="app-mapa-status is-loading">Actualizando plaza...</div>';
    _lifecycle?.setPlaza(nextPlaza);
  });

  _offGlobalSearch = _bindGlobalSearch();
  _onClick = event => {
    const btn = event.target?.closest?.('[data-unit-id]');
    if (!btn) return;
    _viewState.selectedId = String(btn.getAttribute('data-unit-id') || '');
    _render();
  };
  _container.addEventListener('click', _onClick);
}

export function unmount() {
  if (_container && _onClick) _container.removeEventListener('click', _onClick);
  if (typeof _offGlobalSearch === 'function') _offGlobalSearch();
  if (typeof _offPlaza === 'function') _offPlaza();
  _lifecycle?.unmount?.();
  _container = null;
  _contentEl = null;
  _lifecycle = null;
  _offPlaza = null;
  _offGlobalSearch = null;
  _onClick = null;
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
  renderMapaReadOnly(_contentEl, snapshot, {
    query: _viewState.query,
    selectedId: _viewState.selectedId
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
