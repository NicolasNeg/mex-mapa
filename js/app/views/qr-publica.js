// ============================================================================
//  /js/app/views/qr-publica.js — Ficha pública de unidad vía QR (/app/qr/:token)
//  Se monta con o sin sesión (spec: nunca hay redirect a login). Fase 1:
//  solo lectura de datos públicos, sin acciones autenticadas (Fase 2).
// ============================================================================

import { functions } from '/js/core/database.js';

const ROUTE_PREFIX = '/app/qr/';

let _ctr = null;

export async function mount({ container }) {
  unmount();
  _ctr = container;
  _ensureCss();

  const token = _tokenFromPath();
  if (!token) {
    _renderNotFound();
    return;
  }

  _renderLoading();
  try {
    const call = functions.httpsCallable('getUnidadPublica');
    const { data } = await call({ token });
    _renderUnidad(data || {});
  } catch (err) {
    console.warn('[qr-publica]', err);
    _renderNotFound();
  }
}

export function unmount() {
  _ctr = null;
}

function _ensureCss() {
  const href = '/css/app-qr-publica.css';
  const attr = 'data-app-qr-publica-css';
  let link = document.querySelector(`link[${attr}="1"]`);
  if (link) return;
  link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute(attr, '1');
  document.head.appendChild(link);
}

function _tokenFromPath() {
  const path = String(window.location.pathname || '').replace(/\/+$/, '');
  if (!path.startsWith(ROUTE_PREFIX)) return '';
  return decodeURIComponent(path.slice(ROUTE_PREFIX.length) || '').trim();
}

function _esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _shell(bodyHtml) {
  if (!_ctr) return;
  _ctr.innerHTML = `
    <div class="qrp-page">
      <div class="qrp-card">
        <div class="qrp-brand">MapGestion</div>
        ${bodyHtml}
      </div>
    </div>
  `;
}

function _renderLoading() {
  _shell('<div class="qrp-loading"><span class="material-symbols-outlined spin">sync</span> Cargando unidad…</div>');
}

function _renderNotFound() {
  _shell(`
    <div class="qrp-notfound">
      <span class="material-symbols-outlined">search_off</span>
      <h1>No disponible</h1>
      <p>Este código QR no corresponde a ninguna unidad activa.</p>
    </div>
  `);
}

function _renderUnidad(u = {}) {
  const rows = [
    ['Marca', u.marca],
    ['Modelo', u.modelo],
    ['Color', u.color],
    ['Año', u.anio],
    ['Placas', u.placas],
  ].filter(([, v]) => String(v || '').trim());

  _shell(`
    ${u.fotoUrl ? `<img class="qrp-foto" src="${_esc(u.fotoUrl)}" alt="Foto de ${_esc(u.mva || '')}">` : ''}
    <h1 class="qrp-mva">${_esc(u.mva || 'Unidad')}</h1>
    <dl class="qrp-fields">
      ${rows.map(([label, value]) => `
        <div class="qrp-field">
          <dt>${_esc(label)}</dt>
          <dd>${_esc(value)}</dd>
        </div>
      `).join('')}
    </dl>
  `);
}
