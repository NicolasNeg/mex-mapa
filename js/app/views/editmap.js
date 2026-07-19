// ═══════════════════════════════════════════════════════════
//  /js/app/views/editmap.js
//  Vista nativa /app/editmap/:plaza — Configuración de patio.
//  Carga /editmap/PLAZA en iframe; la plaza vive en la URL visible
//  (/app/editmap/{plaza}) y se sincroniza con el selector del App Shell.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';

const ROUTE_PREFIX = '/app/editmap/';

let _container = null;
let _iframe = null;
let _offPlaza = null;

function _editUrl(plaza) {
  const p = String(plaza || '').trim();
  const base = p ? `/editmap/${encodeURIComponent(p)}` : '/editmap';
  return `${base}?shell=1&appStage=1`;
}

function _plazaFromPath() {
  const path = String(window.location.pathname || '').replace(/\/+$/, '');
  if (!path.startsWith(ROUTE_PREFIX)) return '';
  return decodeURIComponent(path.slice(ROUTE_PREFIX.length) || '').trim();
}

/** Mantiene la URL visible en /app/editmap/{plaza} sin forzar un remount. */
function _syncCanonicalUrl(plaza) {
  const p = String(plaza || '').trim();
  if (!p) return;
  const nextPath = `${ROUTE_PREFIX}${encodeURIComponent(p)}`;
  if (window.location.pathname.replace(/\/+$/, '') !== nextPath) {
    window.history.replaceState(null, '', nextPath + window.location.search);
  }
}

export function mount({ container }) {
  unmount();
  _container = container;
  const plaza = _plazaFromPath() || getCurrentPlaza() || getState()?.profile?.plazaAsignada || '';
  _syncCanonicalUrl(plaza);
  _render(plaza);
  _offPlaza = onPlazaChange(async nextPlaza => {
    if (!_iframe) return;
    const url = _editUrl(nextPlaza);
    const nextHref = new URL(url, window.location.origin).href;
    if (_iframe.src === nextHref) return;
    try {
      const dirty = _iframe.contentWindow?.__edIsDirty?.();
      if (dirty) {
        const ok = await (window.mexConfirm || (() => Promise.resolve(true)))(
          'Cambios sin guardar',
          'Hay cambios sin guardar en el editor. ¿Cambiar de plaza de todos modos?',
          'warning'
        );
        if (!ok) return;
      }
    } catch (_) { /* cross-origin / unloaded iframe */ }
    _iframe.src = url;
    _syncCanonicalUrl(nextPlaza);
  });
}

function _render(plaza) {
  if (!_container) return;
  _container.style.cssText = 'height:100%;display:flex;flex-direction:column;';
  _container.innerHTML = '';
  _iframe = document.createElement('iframe');
  _iframe.src = _editUrl(plaza);
  _iframe.title = 'Configuración de patio';
  _iframe.style.cssText = 'flex:1;width:100%;border:none;display:block;min-height:0;';
  _iframe.loading = 'eager';
  _iframe.allow = 'clipboard-read; clipboard-write; microphone; camera; fullscreen';
  _container.appendChild(_iframe);
}

export function unmount() {
  if (typeof _offPlaza === 'function') { try { _offPlaza(); } catch (_) {} }
  _offPlaza = null;
  _iframe = null;
  if (_container) {
    _container.innerHTML = '';
    _container.style.cssText = '';
  }
  _container = null;
}
