/**
 * Reportes de daños SPA — inbox + create + detail.
 * Collection: papeletas_reportes (papeletaId optional).
 */
import { getState, getCurrentPlaza } from '/js/app/app-state.js';
import { buscarUnidad } from '/js/app/features/unidades/unidades-data.js';
import { mountDiagram } from '/js/app/features/papeletas/papeletas-diagram.js';
import { CHECKLIST_KEYS, CHECKLIST_LABELS, REPORTE_STATUS } from '/js/app/features/papeletas/papeletas-constants.js';
import { uploadReporteFoto, getDownloadUrl } from '/js/app/features/papeletas/papeletas-storage.js';
import {
  subscribeReportes,
  getReporte,
  crearReporte,
  newReporteId,
  promoverReporte,
  cerrarCaso,
} from '/js/app/features/papeletas/papeletas-reportes-data.js';
import { rolPuedeCerrarCaso, rolPuedeGestionarVentas } from '/domain/papeleta.model.js';

let _container = null;
let _navigate = null;
let _unsub = null;
let _diagramApi = null;
let _mode = 'list'; // list | create | detail
let _rows = [];
let _detail = null;
let _busy = false;
let _filterStatus = 'abierto';
let _filterTipo = '';
let _query = '';
let _urlCache = new Map();

/** Create draft */
let _unitHits = [];
let _unitQ = '';
let _unitSearchBusy = false;
let _pickedUnit = null;
let _danosMarcados = [];
let _createTipo = 'dano';

const LIST = '/app/reportes-danos';
const NUEVO = '/app/reportes-danos/nuevo';

const STATUS_LABEL = {
  abierto: 'Abierto',
  promovido: 'Promovido',
  cerrado: 'Cerrado',
  descartado: 'Descartado',
  expirado: 'Expirado',
};

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _role() {
  return String(getState()?.role || getState()?.profile?.rol || '').toUpperCase();
}

function _user() {
  const p = getState()?.profile || {};
  return {
    uid: p.uid || p.id || window._auth?.currentUser?.uid || '',
    email: p.email || window._auth?.currentUser?.email || '',
    nombre: p.nombreCompleto || p.nombre || p.displayName || '',
  };
}

function _canView() {
  return window.mexPerms?.canDo?.('view_papeletas') !== false;
}

function _canCreate() {
  return window.mexPerms?.canDo?.('create_reporte_dano') === true;
}

function _canVentas() {
  return window.mexPerms?.canDo?.('manage_papeletas_ventas') === true || rolPuedeGestionarVentas(_role());
}

function _canClose() {
  return rolPuedeCerrarCaso(_role());
}

function _plaza() {
  return String(getCurrentPlaza() || getState()?.currentPlaza || '').toUpperCase().trim();
}

function _parsePath() {
  const raw = String(window.location.pathname || '');
  const parts = raw.replace(/\/+$/, '').split('/').filter(Boolean);
  // app / reportes-danos / ...
  const idx = parts.indexOf('reportes-danos');
  const seg = idx >= 0 ? parts[idx + 1] || '' : '';
  const qs = new URLSearchParams(window.location.search || '');
  const idQ = String(qs.get('id') || '').trim();
  if (seg === 'nuevo') return { mode: 'create', id: '' };
  if (seg && seg !== 'nuevo') return { mode: 'detail', id: seg };
  if (idQ) return { mode: 'detail', id: idQ };
  return { mode: 'list', id: '' };
}

function _destroyDiagram() {
  try { _diagramApi?.destroy?.(); } catch (_) {}
  _diagramApi = null;
}

async function _url(path) {
  if (!path) return '';
  if (_urlCache.has(path)) return _urlCache.get(path);
  const u = await getDownloadUrl(path);
  if (u) _urlCache.set(path, u);
  return u;
}

function _filtered() {
  let rows = _rows.slice();
  if (_filterStatus) rows = rows.filter((r) => r.status === _filterStatus);
  if (_filterTipo) rows = rows.filter((r) => r.tipo === _filterTipo);
  const q = _query.trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      [r.mva, r.unidadId, r.tipo, r.status, r.descripcion, r.papeletaId]
        .map((x) => String(x || '').toLowerCase())
        .some((x) => x.includes(q))
    );
  }
  return rows;
}

function _mexAlert(titulo, texto) {
  return typeof window.mexAlert === 'function'
    ? window.mexAlert(titulo, texto)
    : Promise.resolve(window.alert(`${titulo}\n${texto}`));
}

function _mexConfirm(titulo, texto) {
  return typeof window.mexConfirm === 'function'
    ? window.mexConfirm(titulo, texto, 'warning')
    : Promise.resolve(window.confirm(`${titulo}\n${texto}`));
}

export async function mount({ container, navigate }) {
  _cleanup();
  _container = container;
  _navigate = navigate;
  if (!_canView()) {
    _container.innerHTML = `<div class="rd-empty">No tienes permiso para ver reportes de daños.</div>`;
    return;
  }

  const parsed = _parsePath();
  _mode = parsed.mode;
  _danosMarcados = [];
  _pickedUnit = null;
  _createTipo = 'dano';

  // Lista global: cambiar plaza activa no debe re-filtrar ni recargar el inbox.

  if (_mode === 'create' && !_canCreate()) {
    await _mexAlert('Permiso', 'No tienes permiso para crear reportes de daños.');
    _navigate?.(LIST, { replace: true });
    _mode = 'list';
    _startList();
    return;
  }

  if (_mode === 'detail' && parsed.id) {
    await _loadDetail(parsed.id);
  } else if (_mode === 'create') {
    _render();
  } else {
    _startList();
  }
}

export function unmount() {
  _cleanup();
}

function _cleanup() {
  if (typeof _unsub === 'function') try { _unsub(); } catch (_) {}
  _unsub = null;
  _destroyDiagram();
  _container = null;
  _navigate = null;
  _rows = [];
  _detail = null;
  _busy = false;
}

function _startList() {
  if (typeof _unsub === 'function') try { _unsub(); } catch (_) {}
  // Sin plazaId: inbox global (todas las plazas). Permisos de vista se mantienen aparte.
  _unsub = subscribeReportes({
    status: null,
    plazaId: '',
    onData: (rows) => {
      _rows = Array.isArray(rows) ? rows : [];
      if (_mode === 'list') _render();
    },
    onError: () => {
      _rows = [];
      if (_mode === 'list') _render();
    },
  });
  _render();
}

async function _loadDetail(id) {
  _busy = true;
  _render();
  try {
    _detail = await getReporte(id);
    if (!_detail) {
      await _mexAlert('Reporte', 'No se encontró el reporte.');
      _navigate?.(LIST, { replace: true });
      return;
    }
    _mode = 'detail';
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
    _navigate?.(LIST, { replace: true });
    return;
  } finally {
    _busy = false;
    _render();
  }
}

function _render() {
  if (!_container) return;
  if (_mode === 'create') {
    _container.innerHTML = _renderCreate();
    _bindCreate();
    _mountCreateDiagram();
    return;
  }
  if (_mode === 'detail') {
    _container.innerHTML = _renderDetail();
    _bindDetail();
    _mountDetailDiagram();
    _hydrateDetailFotos();
    return;
  }
  _container.innerHTML = _renderList();
  _bindList();
}

function _renderList() {
  const rows = _filtered();
  return `
    <section class="rd">
      <header class="rd-head">
        <div>
          <h1 class="rd-title">Reportes de daños</h1>
          <p class="rd-sub">Casos de daño y faltantes · todas las plazas</p>
        </div>
        ${_canCreate() ? `
          <button type="button" class="rd-btn rd-btn--primary" data-act="nuevo">
            <span class="material-symbols-outlined">add</span> Nuevo reporte
          </button>
        ` : ''}
      </header>

      <div class="rd-controls">
        <label class="rd-search">
          <span class="material-symbols-outlined">search</span>
          <input id="rdQuery" value="${_esc(_query)}" placeholder="MVA, tipo, descripción" autocomplete="off"/>
        </label>
        <select id="rdStatus">
          <option value="" ${_filterStatus === '' ? 'selected' : ''}>Todos los estados</option>
          ${['abierto', 'promovido', 'cerrado', 'descartado'].map((s) => `
            <option value="${s}" ${_filterStatus === s ? 'selected' : ''}>${STATUS_LABEL[s] || s}</option>
          `).join('')}
        </select>
        <select id="rdTipo">
          <option value="" ${_filterTipo === '' ? 'selected' : ''}>Todos los tipos</option>
          <option value="dano" ${_filterTipo === 'dano' ? 'selected' : ''}>Daño</option>
          <option value="faltante" ${_filterTipo === 'faltante' ? 'selected' : ''}>Faltante</option>
        </select>
      </div>

      ${!rows.length ? `<div class="rd-empty">No hay reportes con estos filtros.</div>` : `
        <div class="rd-list">
          ${rows.map((r) => `
            <article class="rd-card" data-act="open" data-id="${_esc(r.id)}">
              <div class="rd-card__top">
                <strong class="rd-mono">${_esc(r.mva || r.unidadId || '—')}</strong>
                <span class="rd-chip rd-chip--${_esc(r.status)}">${_esc(STATUS_LABEL[r.status] || r.status)}</span>
              </div>
              <div class="rd-card__mid">
                <span class="rd-chip rd-chip--soft">${_esc(r.tipo === 'faltante' ? 'Faltante' : 'Daño')}</span>
                ${r.plazaId || r.plaza ? `<span class="rd-muted">${_esc(r.plazaId || r.plaza)}</span>` : ''}
                ${r.papeletaId ? `<span class="rd-muted">Papeleta ${_esc(r.papeletaId)}</span>` : `<span class="rd-muted">Sin papeleta</span>`}
              </div>
              ${r.descripcion ? `<p class="rd-card__desc">${_esc(r.descripcion)}</p>` : ''}
              <div class="rd-card__bot">
                <button type="button" class="rd-btn rd-btn--ghost" data-act="open" data-id="${_esc(r.id)}">Ver</button>
                ${r.status === 'abierto' && _canVentas() ? `
                  <button type="button" class="rd-btn rd-btn--primary" data-act="promover" data-id="${_esc(r.id)}">Promover</button>
                ` : ''}
                ${r.status !== 'cerrado' && _canClose() ? `
                  <button type="button" class="rd-btn rd-btn--ghost" data-act="cerrar" data-id="${_esc(r.id)}">Cerrar</button>
                ` : ''}
              </div>
            </article>
          `).join('')}
        </div>
      `}
    </section>
  `;
}

function _bindList() {
  const root = _container;
  root.querySelector('[data-act="nuevo"]')?.addEventListener('click', () => {
    if (!_canCreate()) {
      _mexAlert('Permiso', 'No tienes permiso para crear reportes de daños.');
      return;
    }
    _navigate?.(NUEVO);
    _mode = 'create';
    _pickedUnit = null;
    _danosMarcados = [];
    _render();
  });
  root.querySelector('#rdQuery')?.addEventListener('input', (e) => {
    _query = String(e.target.value || '');
    _render();
  });
  root.querySelector('#rdStatus')?.addEventListener('change', (e) => {
    _filterStatus = String(e.target.value || '');
    _render();
  });
  root.querySelector('#rdTipo')?.addEventListener('change', (e) => {
    _filterTipo = String(e.target.value || '');
    _render();
  });
  root.querySelectorAll('[data-act="open"]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id;
      _navigate?.(`${LIST}/${id}`);
      _loadDetail(id);
    });
  });
  root.querySelectorAll('[data-act="promover"]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      _promover(btn.dataset.id);
    });
  });
  root.querySelectorAll('[data-act="cerrar"]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      _cerrar(btn.dataset.id);
    });
  });
}

function _renderCreate() {
  const u = _pickedUnit;
  return `
    <section class="rd">
      <header class="rd-head">
        <div>
          <button type="button" class="rd-link" data-act="back"><span class="material-symbols-outlined">arrow_back</span> Volver</button>
          <h1 class="rd-title">Nuevo reporte</h1>
          <p class="rd-sub">Sin papeleta obligatoria · evidencia + diagrama</p>
        </div>
      </header>

      <form class="rd-form" id="rdCreateForm">
        <fieldset class="rd-fieldset">
          <legend>Unidad</legend>
          ${u ? `
            <div class="rd-picked">
              <strong class="rd-mono">${_esc(u.mva || '—')}</strong>
              <span>${_esc(u.placas || '')} · ${_esc(u.modelo || '')}</span>
              <button type="button" class="rd-btn rd-btn--ghost" data-act="clear-unit">Cambiar</button>
            </div>
          ` : `
            <label class="rd-search">
              <span class="material-symbols-outlined">search</span>
              <input id="rdUnitQ" value="${_esc(_unitQ)}" placeholder="Buscar MVA, placas o modelo" autocomplete="off"/>
            </label>
            <div id="rdUnitHits" class="rd-hits">${_unitHitsHtml()}</div>
          `}
        </fieldset>

        <fieldset class="rd-fieldset">
          <legend>Tipo</legend>
          <div class="rd-seg">
            <button type="button" class="rd-seg__btn ${_createTipo === 'dano' ? 'is-on' : ''}" data-tipo="dano">Daño</button>
            <button type="button" class="rd-seg__btn ${_createTipo === 'faltante' ? 'is-on' : ''}" data-tipo="faltante">Faltante</button>
          </div>
        </fieldset>

        <fieldset class="rd-fieldset">
          <legend>Descripción</legend>
          <textarea id="rdDesc" class="rd-textarea" rows="3" placeholder="Describe el daño o faltante"></textarea>
        </fieldset>

        ${_createTipo === 'faltante' ? `
          <fieldset class="rd-fieldset">
            <legend>Ítems faltantes</legend>
            <select id="rdItems" multiple size="6" class="rd-select-multi">
              ${CHECKLIST_KEYS.map((k) => `<option value="${_esc(k)}">${_esc(CHECKLIST_LABELS[k] || k)}</option>`).join('')}
            </select>
          </fieldset>
        ` : ''}

        <fieldset class="rd-fieldset">
          <legend>Evidencia fotográfica</legend>
          <label class="rd-field"><span>Placas *</span><input type="file" accept="image/*" id="rdPlacas"/></label>
          <label class="rd-field"><span>VIN *</span><input type="file" accept="image/*" id="rdVin"/></label>
          ${_createTipo === 'dano' ? `
            <label class="rd-field"><span>Fotos del daño *</span><input type="file" accept="image/*" id="rdDanos" multiple/></label>
          ` : `
            <label class="rd-field"><span>Fotos (opcional)</span><input type="file" accept="image/*" id="rdDanos" multiple/></label>
          `}
        </fieldset>

        <fieldset class="rd-fieldset">
          <legend>Marcas en diagrama</legend>
          <div id="rdDiagramHost" class="rd-diagram"></div>
          <p class="rd-hint">Toca el diagrama para marcar daños. No es un mapa de zonas vectorizado.</p>
        </fieldset>

        <fieldset class="rd-fieldset">
          <legend>Papeleta (opcional)</legend>
          <input type="text" id="rdPapeletaId" class="rd-input" placeholder="ID de papeleta si aplica"/>
        </fieldset>

        <div class="rd-form-actions">
          <button type="button" class="rd-btn rd-btn--ghost" data-act="back">Cancelar</button>
          <button type="submit" class="rd-btn rd-btn--primary" ${_busy ? 'disabled' : ''}>
            ${_busy ? 'Guardando…' : 'Guardar reporte'}
          </button>
        </div>
      </form>
    </section>
  `;
}

function _unitHitsHtml() {
  if (_unitSearchBusy) return `<div class="rd-empty-sm">Buscando…</div>`;
  if (!_unitHits.length) {
    return `<div class="rd-empty-sm">${_unitQ.trim() ? 'Sin coincidencias' : 'Escribe para buscar unidad'}</div>`;
  }
  return _unitHits.map((u) => `
    <button type="button" class="rd-hit" data-act="pick-unit" data-id="${_esc(u.id)}">
      <strong class="rd-mono">${_esc(u.mva || '—')}</strong>
      <span>${_esc(u.placas || '')} · ${_esc(u.modelo || '')}</span>
    </button>
  `).join('');
}

function _bindCreate() {
  const root = _container;
  root.querySelectorAll('[data-act="back"]').forEach((b) => {
    b.addEventListener('click', () => {
      _navigate?.(LIST);
      _mode = 'list';
      _startList();
    });
  });
  root.querySelectorAll('[data-tipo]').forEach((b) => {
    b.addEventListener('click', () => {
      _createTipo = b.dataset.tipo === 'faltante' ? 'faltante' : 'dano';
      _render();
    });
  });
  root.querySelector('[data-act="clear-unit"]')?.addEventListener('click', () => {
    _pickedUnit = null;
    _render();
  });
  const qInput = root.querySelector('#rdUnitQ');
  let timer = null;
  qInput?.addEventListener('input', (e) => {
    _unitQ = String(e.target.value || '');
    clearTimeout(timer);
    timer = setTimeout(() => _runUnitSearch(_unitQ), 220);
  });
  root.querySelectorAll('[data-act="pick-unit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hit = _unitHits.find((u) => u.id === btn.dataset.id);
      if (hit) {
        _pickedUnit = hit;
        _render();
      }
    });
  });
  root.querySelector('#rdCreateForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    _submitCreate();
  });
}

async function _runUnitSearch(raw) {
  _unitSearchBusy = true;
  const host = _container?.querySelector('#rdUnitHits');
  if (host) host.innerHTML = _unitHitsHtml();
  try {
    // Búsqueda global de unidades (cualquier plaza) para reportes.
    _unitHits = await buscarUnidad(raw, { limit: 12 });
  } catch (_) {
    _unitHits = [];
  } finally {
    _unitSearchBusy = false;
    const host2 = _container?.querySelector('#rdUnitHits');
    if (host2) {
      host2.innerHTML = _unitHitsHtml();
      host2.querySelectorAll('[data-act="pick-unit"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const hit = _unitHits.find((u) => u.id === btn.dataset.id);
          if (hit) {
            _pickedUnit = hit;
            _render();
          }
        });
      });
    }
  }
}

function _mountCreateDiagram() {
  _destroyDiagram();
  const host = _container?.querySelector('#rdDiagramHost');
  if (!host) return;
  _diagramApi = mountDiagram(host, {
    editable: true,
    danosMarcados: _danosMarcados,
    onDamagesChange: (danos) => {
      _danosMarcados = Array.isArray(danos) ? danos : [];
    },
  });
}

async function _submitCreate() {
  if (_busy) return;
  if (!_canCreate()) {
    return _mexAlert('Permiso', 'No tienes permiso para crear reportes de daños.');
  }
  if (!_pickedUnit) return _mexAlert('Unidad', 'Selecciona una unidad.');
  const root = _container;
  const desc = String(root.querySelector('#rdDesc')?.value || '').trim();
  const papId = String(root.querySelector('#rdPapeletaId')?.value || '').trim();
  const items = [...(root.querySelector('#rdItems')?.selectedOptions || [])].map((o) => o.value);
  const fPlacas = root.querySelector('#rdPlacas')?.files?.[0];
  const fVin = root.querySelector('#rdVin')?.files?.[0];
  const fDanos = [...(root.querySelector('#rdDanos')?.files || [])];

  if (!fPlacas || !fVin) return _mexAlert('Fotos', 'Foto de placas y VIN son obligatorias.');
  if (_createTipo === 'dano' && !fDanos.length) return _mexAlert('Fotos', 'Agrega al menos una foto del daño.');
  if (_createTipo === 'faltante' && !items.length) return _mexAlert('Faltantes', 'Indica los ítems faltantes.');

  _busy = true;
  _render();
  try {
    const reporteId = newReporteId();
    const fotos = {
      placas: await uploadReporteFoto(reporteId, 'placas', fPlacas),
      vin: await uploadReporteFoto(reporteId, 'vin', fVin),
      danos: [],
    };
    for (let i = 0; i < fDanos.length; i++) {
      fotos.danos.push(await uploadReporteFoto(reporteId, `dano_${i + 1}`, fDanos[i]));
    }
    const res = await crearReporte({
      id: reporteId,
      unidad: {
        id: _pickedUnit.id,
        unidadId: _pickedUnit.id,
        mva: _pickedUnit.mva,
        plazaId: _pickedUnit.plazaId || _pickedUnit.plaza || _plaza(),
      },
      papeletaId: papId,
      tipo: _createTipo,
      itemsFaltantes: items,
      fotos,
      danosMarcados: _danosMarcados,
      descripcion: desc,
      user: _user(),
    });
    if (res.discarded) {
      await _mexAlert('Reporte', 'Descartado: ya documentado en salida.');
      _navigate?.(LIST);
      _mode = 'list';
      _startList();
    } else {
      await _mexAlert('Reporte', 'Reporte creado. Ventas puede promoverlo.');
      _navigate?.(`${LIST}/${res.id}`);
      await _loadDetail(res.id);
    }
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false;
    if (_mode === 'create') _render();
  }
}

function _renderDetail() {
  const r = _detail;
  if (!r) {
    return `<div class="rd-empty">${_busy ? 'Cargando…' : 'Sin reporte.'}</div>`;
  }
  return `
    <section class="rd">
      <header class="rd-head">
        <div>
          <button type="button" class="rd-link" data-act="back"><span class="material-symbols-outlined">arrow_back</span> Volver</button>
          <h1 class="rd-title rd-mono">${_esc(r.mva || r.unidadId || 'Reporte')}</h1>
          <p class="rd-sub">
            <span class="rd-chip rd-chip--${_esc(r.status)}">${_esc(STATUS_LABEL[r.status] || r.status)}</span>
            · ${_esc(r.tipo === 'faltante' ? 'Faltante' : 'Daño')}
            ${r.papeletaId ? ` · Papeleta ${_esc(r.papeletaId)}` : ' · Sin papeleta'}
          </p>
        </div>
        <div class="rd-actions-bar">
          ${r.status === REPORTE_STATUS.ABIERTO && _canVentas() ? `
            <button type="button" class="rd-btn rd-btn--primary" data-act="promover" data-id="${_esc(r.id)}">Promover</button>
          ` : ''}
          ${r.status !== REPORTE_STATUS.CERRADO && _canClose() ? `
            <button type="button" class="rd-btn rd-btn--ghost" data-act="cerrar" data-id="${_esc(r.id)}">Cerrar</button>
          ` : ''}
        </div>
      </header>

      ${r.descripcion ? `<p class="rd-detail-desc">${_esc(r.descripcion)}</p>` : ''}

      ${(r.itemsFaltantes || []).length ? `
        <div class="rd-block">
          <h2 class="rd-block-title">Ítems faltantes</h2>
          <ul class="rd-ul">${(r.itemsFaltantes || []).map((i) => `<li>${_esc(CHECKLIST_LABELS[i] || i)}</li>`).join('')}</ul>
        </div>
      ` : ''}

      <div class="rd-block">
        <h2 class="rd-block-title">Fotos</h2>
        <div class="rd-fotos" id="rdFotos"></div>
      </div>

      <div class="rd-block">
        <h2 class="rd-block-title">Diagrama</h2>
        <div id="rdDiagramHost" class="rd-diagram"></div>
      </div>
    </section>
  `;
}

function _bindDetail() {
  const root = _container;
  root.querySelector('[data-act="back"]')?.addEventListener('click', () => {
    _navigate?.(LIST);
    _mode = 'list';
    _detail = null;
    _startList();
  });
  root.querySelector('[data-act="promover"]')?.addEventListener('click', () => _promover(_detail?.id));
  root.querySelector('[data-act="cerrar"]')?.addEventListener('click', () => _cerrar(_detail?.id));
}

function _mountDetailDiagram() {
  _destroyDiagram();
  const host = _container?.querySelector('#rdDiagramHost');
  if (!host || !_detail) return;
  _diagramApi = mountDiagram(host, {
    editable: false,
    danosMarcados: Array.isArray(_detail.danosMarcados) ? _detail.danosMarcados : [],
  });
}

async function _hydrateDetailFotos() {
  const host = _container?.querySelector('#rdFotos');
  if (!host || !_detail) return;
  const fotos = _detail.fotos || {};
  const entries = [
    ['Placas', fotos.placas],
    ['VIN', fotos.vin],
    ...(Array.isArray(fotos.danos) ? fotos.danos.map((p, i) => [`Daño ${i + 1}`, p]) : []),
  ].filter(([, p]) => p);
  if (!entries.length) {
    host.innerHTML = `<div class="rd-empty-sm">Sin fotos</div>`;
    return;
  }
  const parts = await Promise.all(entries.map(async ([label, path]) => {
    const url = await _url(path);
    return url
      ? `<a class="rd-foto" href="${_esc(url)}" target="_blank" rel="noopener"><img src="${_esc(url)}" alt="${_esc(label)}"/><span>${_esc(label)}</span></a>`
      : `<div class="rd-foto rd-foto--missing"><span>${_esc(label)}</span></div>`;
  }));
  host.innerHTML = parts.join('');
}

async function _promover(id) {
  if (!id || !_canVentas()) return;
  _busy = true;
  try {
    await promoverReporte(id);
    await _mexAlert('Ventas', 'Evidencias promovidas.');
    if (_mode === 'detail') await _loadDetail(id);
    else _startList();
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false;
  }
}

async function _cerrar(id) {
  if (!id || !_canClose()) return;
  const ok = await _mexConfirm('Cerrar caso', '¿Cerrar este reporte de daños?');
  if (!ok) return;
  try {
    await cerrarCaso(id, { rol: _role(), user: _user() });
    await _mexAlert('Ventas', 'Caso cerrado.');
    if (_mode === 'detail') await _loadDetail(id);
    else _startList();
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  }
}
