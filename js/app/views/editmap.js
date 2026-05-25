// ═══════════════════════════════════════════════════════════
//  /js/app/views/editmap.js
//  Vista nativa /app/editmap — Configuración de patio.
//  Carga /editmap/PLAZA en iframe; sincroniza plaza via App Shell.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';

let _container = null;
let _iframe = null;
let _offPlaza = null;

function _editUrl(plaza) {
  const p = String(plaza || '').trim();
  const base = p ? `/editmap/${encodeURIComponent(p)}` : '/editmap';
  return `${base}?shell=1&appStage=1`;
}

export function mount({ container }) {
  unmount();
  _container = container;
  const plaza = getCurrentPlaza() || getState()?.profile?.plazaAsignada || '';
  _render(plaza);
  _offPlaza = onPlazaChange(nextPlaza => {
    if (!_iframe) return;
    const url = _editUrl(nextPlaza);
    if (_iframe.src !== new URL(url, window.location.origin).href) {
      _iframe.src = url;
    }
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
