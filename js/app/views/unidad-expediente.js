// ============================================================================
//  /js/app/views/unidad-expediente.js — Expediente de unidad (/app/cuadre/u/:mva)
// ============================================================================

import { getState } from '/js/app/app-state.js';
import {
  db,
  COL,
  obtenerDetalleCompleto,
  obtenerUnidadesPlazas,
  actualizarUnidadPlaza
} from '/js/core/database.js';
import { getUnidadBitacora } from '/js/app/features/cuadre/cuadre-data.js';
import { getColaItemForMva } from '/js/app/features/cola-preparacion/cola-data.js';
import { cpProgress, deriveEstadoCola } from '/js/app/features/cola-preparacion/cola-view-model.js';
import { resolverEstadoFlota, leerEstadoPatioDoc, precheckContratoUnidad } from '/js/app/features/estados/estado-view-model.js';
import { normalizeIncidencia } from '/js/app/features/incidencias/incidencias-data.js';
import {
  FIELD_ORDER,
  normalizeUnit,
  buildUnitPayload,
  renderDetailCardHtml,
  unitField,
  esc,
  norm
} from '/js/app/features/unidades/unidades-unit-form.js';

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

let _ctr = null;
let _navigate = null;
let _offs = [];
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

  const params = new URLSearchParams(window.location.search);
  _s = {
    mva,
    loading: true,
    error: '',
    editing: params.get('edit') === '1' && _canManage(),
    busy: false,
    data: null
  };
  _renderShell();
  _bind();
  await _load();
}

export function unmount() {
  _offs.forEach(fn => { try { fn(); } catch (_) {} });
  _offs = [];
  _ctr = null;
  _navigate = null;
  _s = null;
}

function _ensureCss() {
  [
    { href: '/css/app-unidades.css?v=20260715f', attr: 'data-app-unidades-css' },
    { href: '/css/app-unidad-expediente.css?v=20260715c', attr: 'data-app-unidad-exp-css' }
  ].forEach(({ href, attr }) => {
    let link = document.querySelector(`link[${attr}="1"]`);
    if (link) {
      if (link.getAttribute('href') !== href) link.setAttribute('href', href);
      return;
    }
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute(attr, '1');
    document.head.appendChild(link);
  });
}

function _bind() {
  const click = e => _onClick(e);
  const submit = e => _onSubmit(e);
  _ctr?.addEventListener('click', click);
  _ctr?.addEventListener('submit', submit);
  _offs.push(() => _ctr?.removeEventListener('click', click));
  _offs.push(() => _ctr?.removeEventListener('submit', submit));
}

function _mvaFromPath() {
  const path = String(window.location.pathname || '').replace(/\/+$/, '');
  if (!path.startsWith(ROUTE_PREFIX)) return '';
  return norm(decodeURIComponent(path.slice(ROUTE_PREFIX.length) || ''));
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
    const indexRow = (Array.isArray(rows) ? rows : []).find(r => norm(r.mva) === _s.mva);
    if (!indexRow) {
      _s.loading = false;
      _s.error = 'not_found';
      _paintBody();
      return;
    }

    const plaza = norm(indexRow.plazaActual || indexRow.sucursal || indexRow.plaza || '');
    const [detail, extras, bitacora, notas, colaItem] = await Promise.all([
      obtenerDetalleCompleto(plaza || indexRow.sucursal, _s.mva).catch(() => null),
      _loadExtras(_s.mva, plaza),
      getUnidadBitacora({ plaza, mva: _s.mva, limit: 50 }),
      _loadNotas(_s.mva),
      plaza ? getColaItemForMva(plaza, _s.mva) : Promise.resolve(null)
    ]);

    const merged = {
      ...indexRow,
      ...(detail || {}),
      // Patio vive en cuadre (`estado`); flota en índice (`estadoFlota`).
      estadoPatio: (detail && (detail.estadoPatio || detail.estado))
        || indexRow.estadoPatio
        || '',
      estadoFlota: indexRow.estadoFlota || (detail && detail.estadoFlota) || indexRow.estatus || ''
    };

    _s.data = {
      index: normalizeUnit(indexRow),
      detail: normalizeUnit(merged),
      extras: extras || {},
      bitacora: Array.isArray(bitacora) ? bitacora : [],
      notas: Array.isArray(notas) ? notas : [],
      cola: colaItem || null
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
  const token = norm(mva);
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

function _formCtx() {
  return { plaza: _s?.data?.detail?.sucursal || _s?.data?.detail?.plazaActual || '', allUnits: [] };
}

function _renderShell() {
  if (!_ctr || !_s) return;
  _ctr.innerHTML = `
    <section class="uexp uni uni-expediente" aria-busy="${_s.loading ? 'true' : 'false'}">
      <header class="uexp-head">
        <div class="uexp-head-main">
          <button type="button" class="uexp-back" data-action="back-unidades">
            <span class="material-icons">arrow_back</span>
            <span>Unidades</span>
          </button>
        </div>
        <div class="uexp-head-actions" id="uexp-actions"></div>
      </header>
      <div id="uexp-body" class="uexp-body"></div>
    </section>
  `;
  _paintBody();
}

function _paintBody() {
  const body = _ctr?.querySelector('#uexp-body');
  const actions = _ctr?.querySelector('#uexp-actions');
  if (!body || !_s) return;

  if (_s.loading) {
    body.innerHTML = '<div class="uexp-loading"><span class="material-icons spin">sync</span> Cargando información…</div>';
    if (actions) actions.innerHTML = '';
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
  const canMap = d.plazaActual && typeof window.__mexCanViewPlaza === 'function' && window.__mexCanViewPlaza(d.plazaActual);

  if (actions) {
    actions.innerHTML = canMap
      ? '<button type="button" class="uexp-btn ghost" data-action="map"><span class="material-icons">map</span>Mapa</button>'
      : '';
  }

  body.innerHTML = `
    ${_colaBanner(_s.data?.cola, d.plazaActual || d.sucursal)}
    ${_estadosBanner(d)}

    <div id="uexp-detail">${renderDetailCardHtml(d, {
      editing: _s.editing && _canManage(),
      canManage: _canManage(),
      busy: _s.busy,
      formCtx: _formCtx()
    })}</div>

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
  `;

  _syncEditingUi();
}

function _syncEditingUi() {
  const editing = Boolean(_s?.editing && _canManage());
  const card = _ctr?.querySelector('#uexp-detail .uni-detail-card');
  const form = _ctr?.querySelector('#uexp-detail form[data-unit-form]');
  if (!card || !form) return;

  card.classList.toggle('is-editing', editing);

  form.querySelectorAll('input, textarea, select').forEach(el => {
    const locked = el.name === 'id';
    if (editing && !locked) {
      el.removeAttribute('readonly');
      el.readOnly = false;
      el.disabled = false;
    } else if (el.tagName === 'SELECT') {
      el.disabled = true;
    } else {
      el.readOnly = true;
      el.setAttribute('readonly', 'readonly');
    }
  });

  const footer = form.querySelector('.uni-form-actions--footer');
  if (footer) footer.hidden = !editing;

  const saveBtn = form.querySelector('[data-action="save-detail"]');
  if (saveBtn) saveBtn.disabled = Boolean(_s?.busy);
}

function _resetForm() {
  const row = _s?.data?.detail;
  const form = _ctr?.querySelector('#uexp-detail form[data-unit-form]');
  if (!row || !form) return;
  FIELD_ORDER.forEach(key => {
    const el = form.elements[key];
    if (!el) return;
    el.value = unitField(row, key) || '';
  });
}

function _setEditing(next) {
  if (!_s) return;
  _s.editing = Boolean(next && _canManage());
  const path = `${ROUTE_PREFIX}${encodeURIComponent(_s.mva)}`;
  const qs = _s.editing ? '?edit=1' : '';
  const nextUrl = `${path}${qs}`;
  if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
    window.history.replaceState(null, '', nextUrl);
  }
  _paintBody();
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

function _estadosBanner(d = {}) {
  const flota = resolverEstadoFlota(d) || d.estadoFlota || d.estado || '';
  const patio = leerEstadoPatioDoc(d) || d.estadoPatio || '';
  if (!flota && !patio) return '';
  const pre = precheckContratoUnidad(d);
  const preHtml = pre.nivel === 'ok'
    ? ''
    : `<span class="uexp-estado-hint uexp-estado-hint--${esc(pre.nivel)}">${esc(pre.motivo)}</span>`;
  return `
    <div class="uexp-estados-banner" role="status">
      <div class="uexp-estados-chips">
        ${flota ? `<span class="uexp-chip uexp-chip--flota" title="Disponibilidad de negocio">${esc(flota)}</span>` : ''}
        ${patio ? `<span class="uexp-chip uexp-chip--patio" title="Estado en patio">${esc(patio)}</span>` : ''}
      </div>
      ${preHtml}
    </div>`;
}

function _colaBanner(cola, plaza) {
  if (!cola) return '';
  const prog = cpProgress(cola);
  const estado = deriveEstadoCola(cola);
  const qs = new URLSearchParams({ mva: _s?.mva || cola.mva || '' });
  if (plaza) qs.set('plaza', plaza);
  return `
    <div class="uexp-cola-banner" role="status">
      <span class="material-icons">format_list_bulleted</span>
      <div class="uexp-cola-banner-text">
        <strong>En cola de preparación</strong>
        <span>${esc(estado)} · checklist ${prog.done}/${prog.total}</span>
      </div>
      <button type="button" class="uexp-link" data-action="cola">Ver cola</button>
    </div>`;
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

  if (action === 'back-unidades' || action === 'back') {
    _go('/app/unidades');
    return;
  }
  if (action === 'edit' && _canManage()) {
    _setEditing(true);
    return;
  }
  if (action === 'cancel-edit') {
    _resetForm();
    _setEditing(false);
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
    return;
  }
  if (action === 'cola') {
    const plaza = _s.data?.detail?.plazaActual || _s.data?.detail?.sucursal || '';
    const qs = new URLSearchParams({ mva: _s.mva });
    if (plaza) qs.set('plaza', plaza);
    _go(`/app/cola-preparacion?${qs.toString()}`);
  }
}

async function _onSubmit(event) {
  const form = event.target.closest('form[data-unit-form="edit"]');
  if (!form || !_ctr?.contains(form)) return;
  event.preventDefault();
  if (_s?.busy || !_canManage()) return;

  const original = _s?.data?.detail;
  if (!original) return;

  const row = Object.fromEntries(new FormData(form).entries());
  const payload = buildUnitPayload(row, original, { plaza: original.sucursal || original.plazaActual, actor: _actor() });
  if (!payload.mva) return _toast('Captura el número económico.', 'error');

  _s.busy = true;
  _syncEditingUi();
  try {
    const res = await actualizarUnidadPlaza({
      ...payload,
      id: original.id || original.fila || original.mva
    });
    if (!_ok(res)) throw new Error(String(res || 'No se pudo guardar.'));
    _toast('Unidad guardada.', 'success');
    _s.editing = false;
    _setUrlEdit(false);
    await _load();
  } catch (err) {
    _toast(err?.message || 'No se pudo guardar la unidad.', 'error');
  } finally {
    if (_s) {
      _s.busy = false;
      _syncEditingUi();
    }
  }
}

function _setUrlEdit(on) {
  const path = `${ROUTE_PREFIX}${encodeURIComponent(_s.mva)}`;
  const qs = on ? '?edit=1' : '';
  window.history.replaceState(null, '', `${path}${qs}`);
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
        <button type="button" class="uexp-btn ghost" data-action="back-unidades">Volver</button>
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
        <button type="button" class="uexp-btn ghost" data-action="back-unidades">Ir a unidades</button>
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

function _actor() {
  const gs = getState();
  return String(gs.profile?.nombre || gs.profile?.usuario || gs.profile?.email || window._auth?.currentUser?.email || 'Sistema').trim();
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

function _ok(res) {
  if (res === true || res === 'OK' || res === 'EXITO') return true;
  if (typeof res === 'string') return !/^ERROR\b/i.test(res);
  return Boolean(res?.ok || res?.success);
}

function _toast(message, type = 'info') {
  if (typeof window.showToast === 'function') window.showToast(message, type);
  else console[type === 'error' ? 'error' : 'log'](message);
}
