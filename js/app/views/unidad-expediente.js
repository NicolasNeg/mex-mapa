// ============================================================================
//  /js/app/views/unidad-expediente.js — Expediente de unidad (/app/cuadre/u/:mva)
// ============================================================================

import { getState } from '/js/app/app-state.js';
import {
  db,
  COL,
  obtenerDetalleCompleto,
  obtenerUnidadesPlazas
} from '/js/core/database.js';
import { getUnidadBitacora } from '/js/app/features/cuadre/cuadre-data.js';
import { normalizeIncidencia } from '/js/app/features/incidencias/incidencias-data.js';

const ROUTE_PREFIX = '/app/cuadre/u/';

const ROLE_LEVEL = {
  AUXILIAR: 1,
  VENTAS: 2,
  SUPERVISOR: 3,
  JEFE_PATIO: 4,
  GERENTE_PLAZA: 5,
  JEFE_REGIONAL: 6,
  CORPORATIVO_USER: 7,
  JEFE_OPERACION: 8,
  PROGRAMADOR: 9
};

const FIELD_LABEL = {
  mva: 'Número económico',
  clase: 'Clase',
  categoria: 'Categoría',
  vin: 'VIN',
  anio: 'Año',
  marca: 'Marca',
  modelo: 'Modelo',
  placas: 'Placas',
  sucursal: 'Locación propietaria',
  plazaActual: 'Locación actual',
  estado: 'Estado operativo',
  gasolina: 'Gasolina',
  km: 'Kilometraje',
  ubicacion: 'Ubicación',
  pos: 'Posición',
  color: 'Color',
  activo: 'Activo',
  descripcion: 'Descripción',
  notas: 'Notas de cuadre'
};

let _ctr = null;
let _navigate = null;
let _s = null;

export async function mount({ container, navigate }) {
  unmount();
  _ctr = container;
  _navigate = navigate;
  _ensureCss();

  const mva = _mvaFromPath();
  if (!_canView()) {
    _renderDenied();
    return;
  }
  if (!mva) {
    _renderNotFound('');
    return;
  }

  _s = { mva, loading: true, error: '', editing: false, busy: false, data: null };
  _renderShell();
  await _load();
}

export function unmount() {
  _ctr = null;
  _navigate = null;
  _s = null;
}

function _ensureCss() {
  const href = '/css/app-unidad-expediente.css?v=20260715a';
  let link = document.querySelector('link[data-app-unidad-exp-css="1"]');
  if (link) {
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    return;
  }
  link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.appUnidadExpCss = '1';
  document.head.appendChild(link);
}

function _mvaFromPath() {
  const path = String(window.location.pathname || '').replace(/\/+$/, '');
  if (!path.startsWith(ROUTE_PREFIX)) return '';
  return _norm(decodeURIComponent(path.slice(ROUTE_PREFIX.length) || ''));
}

async function _load() {
  if (!_s) return;
  _s.loading = true;
  _s.error = '';
  _paintBody();
  try {
    await window.__mexConfigReadyPromise;
  } catch (_) {}

  try {
    const rows = await obtenerUnidadesPlazas();
    const indexRow = (Array.isArray(rows) ? rows : []).find(r => _norm(r.mva) === _s.mva);
    if (!indexRow) {
      _s.loading = false;
      _s.error = 'not_found';
      _paintBody();
      return;
    }

    const plaza = _norm(indexRow.plazaActual || indexRow.sucursal || indexRow.plaza || '');
    const [detail, extras, bitacora, notas] = await Promise.all([
      obtenerDetalleCompleto(plaza || indexRow.sucursal, _s.mva).catch(() => null),
      _loadExtras(_s.mva, plaza),
      getUnidadBitacora({ plaza, mva: _s.mva, limit: 50 }),
      _loadNotas(_s.mva)
    ]);

    _s.data = {
      index: indexRow,
      detail: { ...indexRow, ...(detail || {}) },
      extras: extras || {},
      bitacora: Array.isArray(bitacora) ? bitacora : [],
      notas: Array.isArray(notas) ? notas : []
    };
    _s.loading = false;
    _paintBody();
  } catch (err) {
    console.error('[unidad-expediente]', err);
    _s.loading = false;
    _s.error = err?.message || 'No se pudo cargar la unidad.';
    _paintBody();
  }
}

async function _loadExtras(mva, plaza) {
  try {
    if (typeof window.api?.obtenerExtrasUnidad === 'function') {
      return await window.api.obtenerExtrasUnidad(mva, plaza);
    }
  } catch (_) {}
  return {};
}

async function _loadNotas(mva) {
  const token = _norm(mva);
  if (!token || !db) return [];
  try {
    const snap = await db.collection(COL.NOTAS).where('mva', '==', token).get();
    return snap.docs
      .map(doc => normalizeIncidencia(doc.id, doc.data()))
      .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
  } catch (err) {
    console.warn('[unidad-expediente] notas:', err);
    return [];
  }
}

function _renderShell() {
  if (!_ctr || !_s) return;
  _ctr.innerHTML = `
    <section class="uexp" aria-busy="${_s.loading ? 'true' : 'false'}">
      <header class="uexp-head">
        <div class="uexp-head-main">
          <button type="button" class="uexp-back" data-action="back">
            <span class="material-icons">arrow_back</span>
            <span>Unidades</span>
          </button>
          <div class="uexp-title-wrap">
            <h1 id="uexp-mva">${esc(_s.mva)}</h1>
            <p id="uexp-sub">Cargando expediente…</p>
          </div>
        </div>
        <div class="uexp-head-actions" id="uexp-actions"></div>
      </header>
      <div id="uexp-body" class="uexp-body"></div>
    </section>
  `;
  _ctr.addEventListener('click', _onClick);
  _paintBody();
}

function _paintBody() {
  const body = _ctr?.querySelector('#uexp-body');
  const sub = _ctr?.querySelector('#uexp-sub');
  const actions = _ctr?.querySelector('#uexp-actions');
  if (!body || !_s) return;

  if (_s.loading) {
    body.innerHTML = '<div class="uexp-loading"><span class="material-icons spin">sync</span> Cargando información…</div>';
    return;
  }

  if (_s.error === 'not_found') {
    _renderNotFound(_s.mva);
    return;
  }

  if (_s.error) {
    body.innerHTML = `<div class="uexp-banner danger"><span class="material-icons">error</span>${esc(_s.error)}</div>`;
    return;
  }

  const d = _s.data?.detail || {};
  const extras = _s.data?.extras || {};
  const subLine = [d.modelo, d.placas, d.plazaActual || d.sucursal].filter(Boolean).join(' · ') || 'Sin datos adicionales';
  if (sub) sub.textContent = subLine;

  if (actions) {
    const canMap = d.plazaActual && typeof window.__mexCanViewPlaza === 'function' && window.__mexCanViewPlaza(d.plazaActual);
    actions.innerHTML = `
      ${canMap ? '<button type="button" class="uexp-btn ghost" data-action="map"><span class="material-icons">map</span>Mapa</button>' : ''}
      ${_canManage() ? '<button type="button" class="uexp-btn primary" data-action="edit"><span class="material-icons">edit</span>Editar</button>' : ''}
    `;
  }

  body.innerHTML = `
    <div class="uexp-grid">
      <section class="uexp-panel">
        <h2>Datos generales</h2>
        <dl class="uexp-kv">
          ${_kvRows(d, ['mva', 'modelo', 'marca', 'anio', 'clase', 'categoria', 'vin', 'placas', 'color', 'sucursal', 'plazaActual', 'activo', 'descripcion'])}
        </dl>
      </section>

      <section class="uexp-panel">
        <h2>Operación en cuadre</h2>
        <dl class="uexp-kv">
          ${_kvRows(d, ['estado', 'gasolina', 'km', 'ubicacion', 'pos', 'notas'])}
        </dl>
      </section>

      ${_extrasPanel(extras)}

      <section class="uexp-panel uexp-panel--wide">
        <div class="uexp-panel-head">
          <h2>Notas e incidencias</h2>
          <button type="button" class="uexp-link" data-action="incidencias">Ver todas</button>
        </div>
        ${_notasHtml(_s.data?.notas || [])}
      </section>

      <section class="uexp-panel uexp-panel--wide">
        <h2>Bitácora reciente</h2>
        ${_bitacoraHtml(_s.data?.bitacora || [])}
      </section>
    </div>
  `;
}

function _extrasPanel(extras) {
  const tags = Array.isArray(extras.tags) ? extras.tags : [];
  const rec = String(extras.recordatorio || '').trim();
  if (!tags.length && !rec) return '';
  return `
    <section class="uexp-panel">
      <h2>Etiquetas y recordatorios</h2>
      ${tags.length ? `<div class="uexp-tags">${tags.map(t => `<span class="uexp-tag" style="background:${esc(t.color || '#e5e7eb')}">${esc(t.label || t.nombre || t)}</span>`).join('')}</div>` : ''}
      ${rec ? `<p class="uexp-rec">${esc(rec)}</p>` : ''}
    </section>
  `;
}

function _kvRows(data, keys) {
  return keys.map(key => {
    const val = _fieldValue(data, key);
    if (val === '' || val == null) return '';
    return `<div class="uexp-kv-row"><dt>${esc(FIELD_LABEL[key] || key)}</dt><dd>${esc(val)}</dd></div>`;
  }).join('');
}

function _fieldValue(data, key) {
  if (key === 'activo') {
    const raw = String(data?.activo ?? data?.active ?? '').toUpperCase();
    if (!raw) return 'Activo';
    return ['NO', 'FALSE', 'INACTIVO', '0', 'BAJA'].includes(raw) ? 'Inactivo' : 'Activo';
  }
  if (key === 'anio') return data?.anio || data?.año || '';
  if (key === 'clase') return data?.clase || data?.categoria || '';
  if (key === 'categoria') return data?.categoria || data?.clase || '';
  return data?.[key] ?? '';
}

function _notasHtml(notas) {
  if (!notas.length) return '<p class="uexp-empty">Sin notas registradas para esta unidad.</p>';
  return `<div class="uexp-notes">${notas.map(n => {
    const adj = [...(n.adjuntos || []), ...(n.evidencias || [])];
    return `
      <article class="uexp-note">
        <header>
          <strong>${esc(n.titulo || 'Nota')}</strong>
          <span class="uexp-pill ${esc(String(n.estado || 'PENDIENTE').toLowerCase())}">${esc(n.estado || 'PENDIENTE')}</span>
        </header>
        <p>${esc(n.descripcion || n.nota || '')}</p>
        <footer>
          <span>${esc(n.autor || n.creadoPor || '—')}</span>
          <span>${esc(n.fecha || _fmtTs(n.timestamp))}</span>
        </footer>
        ${_attachmentsHtml(adj)}
      </article>
    `;
  }).join('')}</div>`;
}

function _attachmentsHtml(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return '';
  return `<div class="uexp-attachments">${list.map(item => {
    const url = String(item.url || item.downloadURL || item.href || (typeof item === 'string' ? item : '')).trim();
    if (!url) return '';
    const name = String(item.fileName || item.nombre || item.name || 'Archivo').trim();
    const isImg = /^data:image\//i.test(url) || /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(url);
    if (isImg) {
      return `<a class="uexp-att-img" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy"></a>`;
    }
    return `<a class="uexp-att-file" href="${esc(url)}" target="_blank" rel="noopener"><span class="material-icons">attach_file</span>${esc(name)}</a>`;
  }).join('')}</div>`;
}

function _bitacoraHtml(rows) {
  if (!rows.length) return '<p class="uexp-empty">Sin movimientos recientes.</p>';
  return `<ul class="uexp-log">${rows.slice(0, 30).map(r => `
    <li>
      <span class="uexp-log-dot"></span>
      <div>
        <div class="uexp-log-text">${esc(r.detalles || r.accion || r.evento || r.tipo || 'Movimiento')}</div>
        <div class="uexp-log-meta">${esc(_fmtTs(r.timestamp || r.creadoEn || r.fecha))}${r.autor ? ' · ' + esc(r.autor) : ''}</div>
      </div>
    </li>
  `).join('')}</ul>`;
}

function _onClick(event) {
  const el = event.target.closest('[data-action]');
  if (!el || !_ctr?.contains(el)) return;
  const action = el.dataset.action;
  if (action === 'back') {
    _go('/app/unidades');
    return;
  }
  if (action === 'edit' && _canManage()) {
    _go(`/app/unidades?mva=${encodeURIComponent(_s.mva)}&edit=1`);
    return;
  }
  if (action === 'map') {
    const plaza = _s.data?.detail?.plazaActual || _s.data?.detail?.sucursal;
    if (typeof window.__mexGoToMapUnit === 'function') {
      window.__mexGoToMapUnit(_s.mva, plaza);
    } else {
      _go('/app/mapa');
    }
    return;
  }
  if (action === 'incidencias') {
    _go(`/app/incidencias?mva=${encodeURIComponent(_s.mva)}`);
  }
}

function _go(path) {
  if (typeof _navigate === 'function') _navigate(path);
  else window.location.assign(path);
}

function _renderDenied() {
  if (!_ctr) return;
  _ctr.innerHTML = `
    <section class="uexp">
      <div class="uexp-denied">
        <span class="material-icons">lock</span>
        <h2>Sin acceso</h2>
        <p>El expediente de unidad está disponible desde el rol Ventas en adelante.</p>
        <button type="button" class="uexp-btn ghost" data-action="back">Volver</button>
      </div>
    </section>
  `;
  _ctr.addEventListener('click', _onClick);
}

function _renderNotFound(mva) {
  if (!_ctr) return;
  _ctr.innerHTML = `
    <section class="uexp">
      <div class="uexp-denied">
        <span class="material-icons">search_off</span>
        <h2>Unidad no encontrada</h2>
        <p>${mva ? `No hay registro para ${esc(mva)} en el inventario global.` : 'MVA no válido.'}</p>
        <button type="button" class="uexp-btn ghost" data-action="back">Ir a unidades</button>
      </div>
    </section>
  `;
  _ctr.addEventListener('click', _onClick);
}

function _canView() {
  return (ROLE_LEVEL[_role()] || 0) >= ROLE_LEVEL.VENTAS;
}

function _canManage() {
  if (window.mexPerms?.canDo?.('manage_global_fleet')) return true;
  if (window.mexPerms?.canDo?.('manage_fleet')) return true;
  return ['GERENTE_PLAZA', 'JEFE_REGIONAL', 'CORPORATIVO_USER', 'JEFE_OPERACION', 'PROGRAMADOR'].includes(_role());
}

function _role() {
  const gs = getState();
  return String(gs.role || gs.profile?.rol || gs.profile?.role || '').toUpperCase().trim();
}

function _norm(value) {
  return String(value || '').trim().toUpperCase();
}

function _fmtTs(value) {
  if (!value) return '';
  if (typeof value?.toDate === 'function') {
    try { return value.toDate().toLocaleString('es-MX'); } catch (_) {}
  }
  if (typeof value === 'number' && value > 1e11) {
    return new Date(value).toLocaleString('es-MX');
  }
  return String(value);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
