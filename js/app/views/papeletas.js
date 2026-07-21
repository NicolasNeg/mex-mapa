// ═══════════════════════════════════════════════════════════
//  /js/app/views/papeletas.js — SPA Papeletas digitales (beta)
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza } from '/js/app/app-state.js';
import {
  ZONAS_V1,
  ZONAS_CORE,
  CHECKLIST_KEYS,
  CHECKLIST_LABELS,
  LLANTA_KEYS,
  LLANTA_LABELS,
  puedeEditar,
  puedeEntregar,
  allZonasHaveFoto,
  coreZonasHaveFoto,
  checklistCompleto,
  isChecklistComplete,
  truncNota,
  rolPuedeGestionarVentas,
  rolPuedeCerrarCaso,
  normalizeMarcasLlantas,
  normalizeTapetes,
} from '/domain/papeleta.model.js';
import { STATUS_LABELS, STATUS_LABELS_SHORT } from '/js/app/features/papeletas/papeletas-constants.js';
import {
  subscribePapeletasPlaza,
  subscribePapeleta,
  crearPapeleta,
  actualizarPapeleta,
  finalizeDelivery,
  registrarEntrada,
  asignarCliente,
} from '/js/app/features/papeletas/papeletas-data.js';
import {
  uploadZonaFoto,
  uploadZonaDetalle,
  uploadFirma,
  uploadReporteFoto,
  getDownloadUrl,
} from '/js/app/features/papeletas/papeletas-storage.js';
import {
  openPapeletaPdf,
  exportPapeletaXls,
  exportPapeletaCsv,
} from '/js/app/features/papeletas/papeletas-pdf.js';
import { openExportChooser } from '/js/core/export-menu.js';
import {
  subscribeReportesAbiertos,
  crearReporte,
  newReporteId,
  promoverReporte,
  cerrarCaso,
  countReportesAbiertosUnidad,
} from '/js/app/features/papeletas/papeletas-reportes-data.js';
import { buscarUnidad } from '/js/app/features/unidades/unidades-data.js';
import { mountDiagram, strokesToDataUrl } from '/js/app/features/papeletas/papeletas-diagram.js';
import { openGuidedCamera } from '/js/app/features/papeletas/papeletas-camera.js';

let _container = null;
let _navigate = null;
let _unsubs = [];
let _items = [];
let _reportes = [];
let _detail = null;
let _detailUnsub = null;
let _mode = 'list'; // list | detail | ventas | nueva
let _filter = 'activas';
let _query = '';
let _wizardStep = 'datos'; // datos | zonas | checklist | resumen | firma | entrada | reporte
let _zonaIdx = 0;
let _showNueva = false;
let _unitHits = [];
let _unitQ = '';
let _unitSearchBusy = false;
let _unitSearchTimer = null;
let _unitSearchSeq = 0;
let _casoWarning = '';
let _busy = false;
let _sigDrawing = false;
let _sigHasInk = false;
let _pendingSalida = { km: null, gas: null };
let _fotoCache = new Map();
let _diagramApi = null;
let _localStrokes = null;
let _cameraApi = null;

const LIST_ROUTE = '/app/papeletas';
const VENTAS_ROUTE = '/app/papeletas/ventas';
const DETAIL_PREFIX = '/app/papeletas/p/';

const FILTER_LABELS = Object.freeze({
  activas: 'En curso',
  entregadas: 'Entregadas',
  historial: 'Historial',
  ventas: 'Con reporte',
});

const FIELD_LABELS = Object.freeze({
  mva: 'Económico (MVA)',
  modelo: 'Modelo',
  placas: 'Placas',
  color: 'Color',
  vin: 'VIN / Serie',
});

const STEP_LABELS = Object.freeze({
  datos: '1 · Datos',
  zonas: '2 · Fotos y daños',
  resumen: '3 · Entregar',
  firma: 'Firma',
  salida: 'Salida',
  entrada: 'Regreso',
  reporte: 'Reportar',
});

const NEW_ROUTE = '/app/papeletas/nueva';

const POST_ENTREGA = new Set(['entregada', 'en_retorno', 'cerrada_historial']);

function _isPostEntrega(status) {
  return POST_ENTREGA.has(String(status || ''));
}

function _defaultStepFor(p) {
  if (!p) return 'datos';
  if (p.status === 'entregada' || p.status === 'en_retorno') return 'entrada';
  if (p.status === 'cerrada_historial') return 'salida';
  if (p.status === 'lista') return 'resumen';
  return 'datos';
}

function _gasCatalog() {
  const configured = Array.isArray(window.MEX_CONFIG?.listas?.gasolinas)
    ? window.MEX_CONFIG.listas.gasolinas
    : [];
  const values = configured
    .map((item) => String((item && typeof item === 'object' ? (item.nombre ?? item.valor ?? '') : item) || '').trim().toUpperCase())
    .filter(Boolean);
  const base = values.length ? values : ['E', '1/8', '1/4', '3/8', 'H', '5/8', '3/4', '7/8', 'F', 'N/A'];
  if (!base.includes('N/A')) base.push('N/A');
  return Array.from(new Set(base));
}

function _gasOptionsHtml(selected) {
  const safe = String(selected || '').trim().toUpperCase();
  const opts = _gasCatalog();
  if (safe && !opts.includes(safe)) opts.unshift(safe);
  return opts.map((v) => `<option value="${_esc(v)}" ${safe === v ? 'selected' : ''}>${_esc(v)}</option>`).join('');
}

function _paperGasScale() {
  const preferred = ['E', '1/8', '1/4', '3/8', 'H', '5/8', '3/4', '7/8', 'F'];
  const catalog = _gasCatalog().filter((v) => v !== 'N/A');
  const ordered = preferred.filter((v) => catalog.includes(v));
  const rest = catalog.filter((v) => !preferred.includes(v));
  return ordered.length ? [...ordered, ...rest] : preferred;
}

function _gasChipsHtml(selected, inputId, disabled) {
  const safe = String(selected || '').trim().toUpperCase();
  const opts = _paperGasScale();
  if (safe && !opts.includes(safe)) opts.unshift(safe);
  return `
    <input type="hidden" id="${_esc(inputId)}" value="${_esc(safe)}"/>
    <div class="pap-gas-chips" role="group" aria-label="Nivel de gasolina">
      ${opts.map((v) => `
        <button type="button" class="pap-gas-chip ${safe === v ? 'is-on' : ''}" data-act="gas-set" data-gas-for="${_esc(inputId)}" data-val="${_esc(v)}" ${disabled ? 'disabled' : ''}>${_esc(v)}</button>
      `).join('')}
    </div>
  `;
}

function _destroyDiagram() {
  if (_diagramApi) {
    try { _diagramApi.destroy(); } catch (_) { /* ignore */ }
  }
  _diagramApi = null;
}

function _mountDiagramIfNeeded(p, editable) {
  _destroyDiagram();
  const host = _container?.querySelector('[data-diagram-host]');
  if (!host) return;
  const strokes = Array.isArray(_localStrokes)
    ? _localStrokes
    : (Array.isArray(p?.diagramaStrokes) ? p.diagramaStrokes : []);
  _diagramApi = mountDiagram(host, {
    strokes,
    editable: !!editable,
    onChange: (next) => {
      _localStrokes = next;
      if (_detail) _detail.diagramaStrokes = next;
    },
  });
}

function _diagramReadonlyHtml(p) {
  const strokes = Array.isArray(p?.diagramaStrokes) ? p.diagramaStrokes : [];
  const url = strokes.length ? strokesToDataUrl(strokes, { withBg: false }) : '';
  return `
    <div class="pap-diagram pap-diagram--ro">
      <div class="pap-diagram__toolbar">
        <span class="pap-diagram__title">Diagrama · salida</span>
        ${strokes.length ? '' : '<span class="pap-muted">Sin marcas</span>'}
      </div>
      <div class="pap-diagram__stage">
        <img class="pap-diagram__bg" src="/assets/papeletas/hoja-inspeccion-auto.png" alt="Diagrama del vehículo" draggable="false"/>
        ${url ? `<img class="pap-diagram__marks" src="${_esc(url)}" alt="Marcas"/>` : ''}
      </div>
      <div class="pap-diagram__legend pap-diagram__legend--ro">
        ${['0 Abolladura', '* Rotura', 'F Faltante', '— Rayón', '= Profundo'].map((t) => `<span>${t}</span>`).join('')}
      </div>
    </div>
  `;
}

function _checkGlyph(val) {
  if (val === 'ok') return 'check';
  if (val === 'faltante') return 'close';
  if (val === 'na') return 'block';
  return '';
}

function _marcaLlantas(p) {
  return normalizeMarcasLlantas(p);
}

function _tapetes(p) {
  return normalizeTapetes(p);
}

function _llantasGridHtml(p, editable) {
  const m = _marcaLlantas(p);
  const cell = (key, side) => `
    <label class="pap-llanta-cell pap-llanta-cell--${side}">
      <span>${_esc(LLANTA_LABELS[key] || key)}</span>
      <input type="text" data-llanta="${_esc(key)}" value="${_esc(m[key] || '')}"
        placeholder="Marca" ${editable ? '' : 'disabled'} autocomplete="off"/>
    </label>`;
  return `
    <section class="pap-llantas" aria-label="Marca de llantas">
      <div class="pap-llantas__head">
        <h3 class="pap-subhead">Marca de llantas</h3>
        <label class="pap-llantas__todas">
          <input type="checkbox" id="papMarcarTodas" ${m.marcarTodas ? 'checked' : ''} ${editable ? '' : 'disabled'}/>
          <span>Marcar todas</span>
        </label>
      </div>
      <div class="pap-llantas__grid">
        ${cell('delanteraIzq', 'izq')}
        ${cell('delanteraDer', 'der')}
        ${cell('traseraIzq', 'izq')}
        ${cell('traseraDer', 'der')}
      </div>
    </section>
  `;
}

function _tapetesHtml(p, editable) {
  const t = _tapetes(p);
  return `
    <section class="pap-tapetes" aria-label="Tapetes">
      <h3 class="pap-subhead">Tapetes</h3>
      <div class="pap-fields-2">
        <div class="pap-field">
          <label>Tapetes uso rudo</label>
          <input id="papTapetesRudo" type="text" inputmode="numeric" pattern="[0-9]*"
            value="${_esc(t.usoRudo ?? '')}" ${editable ? '' : 'disabled'} autocomplete="off" placeholder="0"/>
        </div>
        <div class="pap-field">
          <label>Tapetes alfombra</label>
          <input id="papTapetesAlfombra" type="text" inputmode="numeric" pattern="[0-9]*"
            value="${_esc(t.alfombra ?? '')}" ${editable ? '' : 'disabled'} autocomplete="off" placeholder="0"/>
        </div>
      </div>
    </section>
  `;
}

function _llantasReadonlyHtml(p) {
  const m = _marcaLlantas(p);
  return `
    <div class="pap-llantas pap-llantas--ro">
      <div class="pap-llantas__head">
        <h3 class="pap-subhead">Marca de llantas</h3>
        ${m.marcarTodas ? '<span class="pap-muted">Todas iguales</span>' : ''}
      </div>
      <div class="pap-llantas__grid">
        ${LLANTA_KEYS.map((k) => `
          <div class="pap-llanta-cell">
            <span>${_esc(LLANTA_LABELS[k])}</span>
            <strong>${_esc(m[k] || '—')}</strong>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function _tapetesReadonlyHtml(p) {
  const t = _tapetes(p);
  return `
    <div class="pap-fields-2 pap-tapetes-ro">
      <div class="pap-field"><label>Tapetes uso rudo</label><input value="${_esc(t.usoRudo ?? '—')}" disabled/></div>
      <div class="pap-field"><label>Tapetes alfombra</label><input value="${_esc(t.alfombra ?? '—')}" disabled/></div>
    </div>
  `;
}

const _mexConfirm = (t, x, tipo = 'warning') =>
  (typeof window.mexConfirm === 'function' ? window.mexConfirm(t, x, tipo) : Promise.resolve(confirm(x)));
const _mexAlert = (t, x) =>
  (typeof window.mexAlert === 'function' ? window.mexAlert(t, x) : Promise.resolve(alert(x)));

function _role() {
  return String(getState()?.role || getState()?.profile?.rol || 'AUXILIAR').toUpperCase();
}

function _canVentas() {
  return window.mexPerms?.canDo?.('manage_papeletas_ventas') === true || rolPuedeGestionarVentas(_role());
}

function _user() {
  const p = getState()?.profile || {};
  return {
    uid: window._auth?.currentUser?.uid || p.uid || '',
    nombre: p.nombreCompleto || p.nombre || p.displayName || '',
  };
}

function _normPath() {
  return String(location.pathname || '').replace(/\/+$/, '') || '/';
}

function _pathId() {
  const path = _normPath();
  const modern = path.match(/\/app\/papeletas\/p\/([^/]+)$/);
  if (modern) return decodeURIComponent(modern[1] || '');
  // Legacy deep-link: /app/papeletas/:uid (not ventas / p)
  const legacy = path.match(/\/app\/papeletas\/([^/]+)$/);
  if (!legacy) return '';
  const seg = legacy[1];
  if (seg === 'ventas' || seg === 'p') return '';
  return decodeURIComponent(seg);
}

function _isVentasPath() {
  return _normPath() === VENTAS_ROUTE;
}

function _isNuevaPath() {
  return _normPath() === NEW_ROUTE;
}

function _isLegacyDetailPath() {
  const path = _normPath();
  if (path.startsWith(DETAIL_PREFIX)) return false;
  if (path === VENTAS_ROUTE || path === LIST_ROUTE || path === NEW_ROUTE) return false;
  return /^\/app\/papeletas\/[^/]+$/.test(path);
}

function _detailRoute(id) {
  return `${DETAIL_PREFIX}${encodeURIComponent(String(id || ''))}`;
}

function _toMs(value) {
  if (value == null || value === '') return 0;
  if (typeof value?.toDate === 'function') {
    try { return value.toDate().getTime() || 0; } catch (_) { return 0; }
  }
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function _fmtDate(value) {
  const ms = _toMs(value);
  if (!ms) return '';
  return new Date(ms).toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function _hasReporte(it) {
  if (!it) return false;
  if (String(it.casoVentasId || '').trim()) return true;
  return _reportes.some((r) => r.papeletaId === it.id && r.status === 'abierto');
}

function _cleanup() {
  _unsubs.forEach((u) => { try { u(); } catch (_) { /* ignore */ } });
  _unsubs = [];
  if (_detailUnsub) { try { _detailUnsub(); } catch (_) { /* ignore */ } }
  _detailUnsub = null;
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function _fotoUrl(path) {
  if (!path) return '';
  if (_fotoCache.has(path)) return _fotoCache.get(path);
  const url = await getDownloadUrl(path);
  _fotoCache.set(path, url);
  return url;
}

function _filteredItems() {
  const q = _query.trim().toLowerCase();
  return _items.filter((it) => {
    if (_filter === 'activas' && !it.activoPorUnidad) return false;
    if (_filter === 'entregadas' && it.status !== 'entregada') return false;
    if (_filter === 'historial' && it.status !== 'cerrada_historial' && it.status !== 'en_retorno') return false;
    if (_filter === 'ventas' && !it.casoVentasId && !_reportes.some((r) => r.papeletaId === it.id && r.status === 'abierto')) return false;
    if (!q) return true;
    const hay = [it.mva, it.placas, it.modelo, it.vin, it.clienteNombre].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function _fotosCount(p) {
  return ZONAS_V1.filter((z) => String(p?.zonas?.[z.id]?.fotoPath || '').trim()).length;
}

function _coreFotosCount(p) {
  return ZONAS_CORE.filter((id) => String(p?.zonas?.[id]?.fotoPath || '').trim()
    || (id === 'tablero_kilometraje' && String(p?.fotoTableroPath || p?.salida?.fotoTableroPath || '').trim())).length;
}

function _deliveryGate(p, opts = {}) {
  return puedeEntregar(p, opts);
}

export async function mount(ctx) {
  _cleanup();
  _container = ctx.container;
  _navigate = ctx.navigate;
  _items = [];
  _reportes = [];
  _detail = null;
  _query = '';
  _filter = 'activas';
  _wizardStep = 'datos';
  _zonaIdx = 0;
  _showNueva = false;
  _casoWarning = '';

  // Canonical detail: /app/papeletas/p/:uid — rewrite legacy /app/papeletas/:uid
  const legacyId = _isLegacyDetailPath() ? _pathId() : '';
  if (legacyId) {
    _navigate?.(_detailRoute(legacyId), { replace: true });
  }

  if (_isVentasPath()) _mode = 'ventas';
  else if (_isNuevaPath()) { _mode = 'nueva'; _showNueva = true; }
  else if (_pathId()) _mode = 'detail';
  else _mode = 'list';

  _render();
  if (_mode === 'nueva') {
    _runUnitAutocomplete('');
    queueMicrotask(() => _container?.querySelector('#papUnitQ')?.focus());
  }

  const plaza = String(getCurrentPlaza() || ctx?.state?.currentPlaza || '').toUpperCase();
  _unsubs.push(subscribePapeletasPlaza({
    plazaId: plaza,
    onData: (rows) => {
      _items = rows || [];
      if (_mode === 'list') _paintList();
      else if (_mode === 'ventas') _render();
    },
  }));

  if (_canVentas()) {
    _unsubs.push(subscribeReportesAbiertos({
      onData: (rows) => {
        _reportes = rows || [];
        if (_mode === 'list') _paintList();
        else if (_mode === 'ventas') _render();
      },
    }));
  }

  const id = _pathId();
  if (id) _watchDetail(id);
}

export function unmount() {
  _closeGuidedCamera();
  _cleanup();
  _destroyDiagram();
  _localStrokes = null;
  _container = null;
  _navigate = null;
  _fotoCache.clear();
}

function _watchDetail(id) {
  if (_detailUnsub) { try { _detailUnsub(); } catch (_) { /* ignore */ } }
  _detailUnsub = subscribePapeleta(id, {
    onData: (doc) => {
      const firstLoad = !_detail;
      _detail = doc;
      _mode = 'detail';
      if (firstLoad) _localStrokes = Array.isArray(doc?.diagramaStrokes) ? doc.diagramaStrokes : [];
      if (doc) {
        const post = _isPostEntrega(doc.status);
        const validPost = ['salida', 'entrada', 'reporte'];
        if (firstLoad || (post && !validPost.includes(_wizardStep)) || (!post && _wizardStep === 'salida')) {
          _wizardStep = _defaultStepFor(doc);
        }
      }
      // Don't tear down fullscreen camera on live snapshot updates
      if (_cameraApi) return;
      _render();
    },
  });
}

function _gotoList() {
  _mode = 'list';
  _detail = null;
  if (_detailUnsub) { try { _detailUnsub(); } catch (_) { /* ignore */ } }
  _detailUnsub = null;
  _navigate?.(LIST_ROUTE, { replace: false });
  _render();
}

function _gotoVentas() {
  _mode = 'ventas';
  _navigate?.(VENTAS_ROUTE);
  _render();
}

function _openDetail(id) {
  const token = String(id || '').trim();
  if (!token) return;
  _mode = 'detail';
  _detail = null;
  _localStrokes = null;
  _destroyDiagram();
  _wizardStep = 'datos';
  _navigate?.(_detailRoute(token));
  _watchDetail(token);
}

function _render() {
  if (!_container) return;
  const canV = _canVentas();
  const editor = _mode === 'detail';
  _container.innerHTML = `
    <section class="pap${editor ? ' pap--editor' : ''}" aria-busy="false">
      ${_casoWarning ? `<div class="pap-banner"><span class="material-symbols-outlined">warning</span><div>${_esc(_casoWarning)}</div></div>` : ''}
      ${_mode === 'ventas' ? `
        <main class="pap-main pap-main--full">
          <header class="pap-page-header">
            <div class="pap-page-title">
              <h1>Papeletas · Ventas</h1>
              <p>Bandeja de reportes abiertos</p>
            </div>
            <div class="pap-actions-bar">
              <button type="button" class="pap-btn pap-btn--ghost" data-act="tab-list">Volver al listado</button>
            </div>
          </header>
          <div class="pap-ventas-host">${_renderVentas()}</div>
        </main>
      ` : _mode === 'nueva' ? _renderNuevaScreen() : editor ? _renderDetail() : _renderList()}
      ${_showNueva && _mode !== 'nueva' ? _renderNuevaModal() : ''}
    </section>
  `;
  _bind();
  if (_wizardStep === 'firma') _bindSignature();
  _hydrateFotos();
  if (_mode === 'detail' && _detail && (_wizardStep === 'datos' || _wizardStep === 'salida' || _wizardStep === 'entrada')) {
    const editableDiag = _wizardStep === 'datos' && puedeEditar(_detail.status);
    if (_wizardStep === 'datos') _mountDiagramIfNeeded(_detail, editableDiag);
  } else {
    _destroyDiagram();
  }
  void canV;
}

function _renderList() {
  const rows = _filteredItems();
  const canV = _canVentas();
  return `
    <main class="pap-main pap-main--full">
      <header class="pap-page-header pap-sheet-head">
        <div class="pap-page-title">
          <p class="pap-kicker">MapGestion · Patio</p>
          <h1>Papeletas</h1>
          <p>HOJA DE INSPECCIÓN digital · activas, entregadas e historial</p>
        </div>
        <div class="pap-actions-bar">
          ${canV ? `<button type="button" class="pap-btn pap-btn--ghost" data-act="tab-ventas">Ventas</button>` : ''}
          <button type="button" class="pap-btn pap-btn--primary" data-act="nueva">
            <span class="material-symbols-outlined">add</span> Nueva
          </button>
        </div>
      </header>

      <div class="pap-controls pap-controls--sheet">
        <div class="pap-controls-row">
          <label class="pap-search">
            <span class="material-symbols-outlined">search</span>
            <input id="papSearch" value="${_esc(_query)}" placeholder="Buscar MVA, placas, modelo o cliente" autocomplete="off" enterkeyhint="search"/>
          </label>
          <div class="pap-quick-status" role="tablist" aria-label="Filtro">
            ${['activas', 'entregadas', 'historial', 'ventas'].map((f) => `
              <button type="button" class="${_filter === f ? 'active' : ''}" data-act="filter" data-f="${f}">
                ${FILTER_LABELS[f] || f}
              </button>
            `).join('')}
          </div>
        </div>
      </div>

      <p id="pap-count" class="pap-meta pap-meta--sheet">${rows.length ? `${rows.length} REGISTRO${rows.length === 1 ? '' : 'S'}` : '0 REGISTROS'}</p>
      <div id="pap-table-host" class="pap-table-host">${_tableHtml(rows)}</div>
    </main>
  `;
}

function _tableHtml(rows) {
  if (!rows.length) {
    return `
      <div class="pap-empty">
        <strong>Sin papeletas</strong>
        <small>No hay registros con este filtro. Usa <b>Nueva</b> y busca la unidad por económico o placas.</small>
      </div>`;
  }
  return `
    <div class="pap-table-wrap">
      <table class="pap-table">
        <thead>
          <tr>
            <th>Económico</th>
            <th>Unidad</th>
            <th>Plaza</th>
            <th>Cliente</th>
            <th>Fotos</th>
            <th>Actualizado</th>
            <th>Reporte</th>
            <th>Estatus</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(_rowHtml).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function _rowHtml(it) {
  const fotos = _fotosCount(it);
  const short = STATUS_LABELS_SHORT[it.status] || STATUS_LABELS[it.status] || it.status;
  const updated = _fmtDate(it.actualizadoAt || it.creadoAt);
  const reporte = _hasReporte(it);
  return `
    <tr class="pap-row-clickable" data-act="open" data-id="${_esc(it.id)}" role="button" tabindex="0" title="Abrir papeleta">
      <td><span class="pap-td-main pap-td-mono">${_esc(it.mva || '—')}</span></td>
      <td>
        <span class="pap-td-main">${_esc(it.modelo || '—')}</span>
        <span class="pap-td-sub">${_esc(it.placas || 'Sin placas')}${it.color ? ` · ${_esc(it.color)}` : ''}</span>
      </td>
      <td>${_esc(it.plazaId || '—')}</td>
      <td>${_esc(it.clienteNombre || '—')}</td>
      <td class="pap-td-mono">${fotos}/12</td>
      <td class="pap-td-date">${updated ? _esc(updated) : '<span class="pap-muted">—</span>'}</td>
      <td>${reporte ? '<span class="pap-flag pap-flag--warn">Sí</span>' : '<span class="pap-muted">—</span>'}</td>
      <td><span class="pap-chip pap-chip--${_esc(it.status)}">${_esc(short)}</span></td>
    </tr>
  `;
}

function _paintList() {
  if (!_container || _mode !== 'list') return;
  const rows = _filteredItems();
  const count = _container.querySelector('#pap-count');
  const host = _container.querySelector('#pap-table-host');
  if (count) count.textContent = rows.length ? `${rows.length} registro${rows.length === 1 ? '' : 's'}` : '0 registros';
  if (host) {
    host.innerHTML = _tableHtml(rows);
    _bindTableRows(host);
  }
  // Keep filter chip active state in sync without full re-render
  _container.querySelectorAll('[data-act="filter"]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.f === _filter);
  });
}

function _bindTableRows(host) {
  const root = host || _container;
  if (!root) return;
  root.querySelectorAll('tr[data-act="open"]').forEach((row) => {
    row.addEventListener('click', () => _openDetail(row.dataset.id));
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      _openDetail(row.dataset.id);
    });
  });
}

function _renderDetail() {
  if (!_detail) {
    return `
      <main class="pap-editor-shell">
        <header class="pap-editor-top">
          <div>
            <nav class="pap-breadcrumb" aria-label="Ruta">
              <button type="button" data-act="back">Papeletas</button>
              <span>/</span>
              <strong>Detalle</strong>
            </nav>
            <h1>Cargando papeleta…</h1>
          </div>
          <div class="pap-actions-bar">
            <button type="button" class="pap-btn pap-btn--ghost" data-act="back">Volver</button>
          </div>
        </header>
        <div class="pap-empty">Cargando…</div>
      </main>`;
  }
  const p = _detail;
  const editable = puedeEditar(p.status);
  const post = _isPostEntrega(p.status);
  const steps = post
    ? [
      ['entrada', STEP_LABELS.entrada],
      ['salida', STEP_LABELS.salida],
      ['reporte', STEP_LABELS.reporte],
    ]
    : [
      ['datos', STEP_LABELS.datos],
      ['zonas', STEP_LABELS.zonas],
      ['resumen', STEP_LABELS.resumen],
    ];
  const statusLabel = STATUS_LABELS_SHORT[p.status] || STATUS_LABELS[p.status] || p.status;

  return `
    <main class="pap-editor-shell">
      <header class="pap-editor-top">
        <div>
          <nav class="pap-breadcrumb" aria-label="Ruta">
            <button type="button" data-act="back">Papeletas</button>
            <span>/</span>
            <strong>${post ? 'Regreso' : 'Detalle'}</strong>
          </nav>
          <h1>${_esc(p.mva || 'Papeleta')} <span class="pap-chip pap-chip--${_esc(p.status)}">${_esc(statusLabel)}</span></h1>
          <p class="pap-editor-sub">${_esc(p.modelo || 'Sin modelo')} · ${_esc(p.placas || 'Sin placas')}${p.plazaId ? ` · ${_esc(p.plazaId)}` : ''}${!editable ? ' · Solo lectura' : ''}</p>
        </div>
        <div class="pap-actions-bar">
          <button type="button" class="pap-btn pap-btn--ghost" data-act="back">Volver</button>
          ${post ? `<button type="button" class="pap-btn pap-btn--ghost" data-act="pdf">Exportar</button>` : ''}
        </div>
      </header>
      <div class="pap-detail">
        <div class="pap-steps" role="tablist">
          ${steps.map(([id, label]) => `
            <button type="button" class="pap-step ${_wizardStep === id ? 'is-active' : ''}" data-act="step" data-step="${id}">${label}</button>
          `).join('')}
        </div>
        ${_wizardStep === 'datos' ? _panelDatos(p, editable) : ''}
        ${_wizardStep === 'zonas' ? _panelZonas(p, editable) : ''}
        ${_wizardStep === 'resumen' ? _panelResumen(p, editable) : ''}
        ${_wizardStep === 'firma' ? _panelFirma(p) : ''}
        ${_wizardStep === 'salida' ? _panelSalidaView(p) : ''}
        ${_wizardStep === 'entrada' ? _panelEntrada(p) : ''}
        ${_wizardStep === 'reporte' ? _panelReporte(p) : ''}
      </div>
    </main>
  `;
}

function _ternaryEditable(k, val, editable) {
  const v = String(val || '');
  return `
    <span class="pap-ternary" role="group" aria-label="${_esc(CHECKLIST_LABELS[k] || k)}">
      <button type="button" class="pap-ternary__btn ${v === 'ok' ? 'is-on is-ok' : ''}" data-act="check-set" data-key="${_esc(k)}" data-val="ok" ${editable ? '' : 'disabled'} title="Está" aria-label="Está">
        <span class="material-symbols-outlined">check</span>
      </button>
      <button type="button" class="pap-ternary__btn ${v === 'faltante' ? 'is-on is-bad' : ''}" data-act="check-set" data-key="${_esc(k)}" data-val="faltante" ${editable ? '' : 'disabled'} title="No está" aria-label="No está">
        <span class="material-symbols-outlined">close</span>
      </button>
      <button type="button" class="pap-ternary__btn ${v === 'na' ? 'is-on is-na' : ''}" data-act="check-set" data-key="${_esc(k)}" data-val="na" ${editable ? '' : 'disabled'} title="N/A" aria-label="N/A">
        <span class="material-symbols-outlined">block</span>
      </button>
    </span>
  `;
}

function _panelDatos(p, editable) {
  const km = p.salida?.km ?? _pendingSalida.km ?? '';
  const gas = p.salida?.gas ?? _pendingSalida.gas ?? '';
  const notas = String(p.notasInteriores || p.notas || '');
  const contrato = String(p.contrato || '');
  const mid = Math.ceil(CHECKLIST_KEYS.length / 2);
  const leftKeys = CHECKLIST_KEYS.slice(0, mid);
  const rightKeys = CHECKLIST_KEYS.slice(mid);
  return `
    <div class="pap-panel pap-panel--wide pap-hoja">
      <header class="pap-hoja__head">
        <div>
          <p class="pap-hoja__eyebrow">MapGestion · Patio</p>
          <h2>HOJA DE INSPECCIÓN</h2>
          <p class="pap-hoja__sub">Datos de salida · diagrama · accesorios</p>
        </div>
        <label class="pap-contrato">
          <span>Contrato</span>
          <input data-field="contrato" value="${_esc(contrato)}" ${editable ? '' : 'disabled'} autocomplete="off" placeholder="—"/>
        </label>
      </header>

      ${_unitIdentityHtml(p)}

      <section class="pap-io-table" aria-label="Entrega">
        <div class="pap-io-table__row pap-io-table__row--head">
          <span></span><span>Nombre</span><span>KM</span><span>Gas</span>
        </div>
        <div class="pap-io-table__row">
          <strong>Entrega / Out</strong>
          <div class="pap-field pap-field--bare">
            ${_canVentas()
              ? `<input data-field="clienteNombre" value="${_esc(p.clienteNombre || '')}" placeholder="Cliente / entrega a" autocomplete="off"/>`
              : `<input value="${_esc(p.clienteNombre || _user().nombre || '—')}" disabled/>`}
          </div>
          <div class="pap-field pap-field--bare">
            <input id="papKmSalida" type="text" inputmode="numeric" pattern="[0-9]*" value="${_esc(km ?? '')}" ${editable ? '' : 'disabled'} autocomplete="off" placeholder="0"/>
          </div>
          <div class="pap-field pap-field--bare pap-field--gas">
            ${_gasChipsHtml(gas || '', 'papGasSalida', !editable)}
          </div>
        </div>
      </section>
      <p class="pap-fee-note">Cargo por limpieza excesiva / olor a cigarro: $600 MXN</p>

      <div class="pap-hoja__body">
        <div class="pap-check-col">
          ${leftKeys.map((k) => `
            <div class="pap-check-readonly__row">
              <span class="pap-check-readonly__name">${_esc(CHECKLIST_LABELS[k] || k)}</span>
              ${_ternaryEditable(k, p.checklist?.[k], editable)}
            </div>
          `).join('')}
        </div>

        <div class="pap-hoja__diagram" data-diagram-host></div>

        <div class="pap-check-col">
          ${rightKeys.map((k) => `
            <div class="pap-check-readonly__row">
              <span class="pap-check-readonly__name">${_esc(CHECKLIST_LABELS[k] || k)}</span>
              ${_ternaryEditable(k, p.checklist?.[k], editable)}
            </div>
          `).join('')}
        </div>
      </div>

      ${_tapetesHtml(p, editable)}
      ${_llantasGridHtml(p, editable)}

      <div class="pap-fields-2 pap-hoja__notes">
        <div class="pap-field pap-field--full">
          <label>Notas / Interiores</label>
          <textarea data-field="notasInteriores" rows="2" ${editable ? '' : 'disabled'} placeholder="Notas del patio…">${_esc(notas)}</textarea>
        </div>
      </div>

      ${editable || _canVentas() ? `
        <div class="pap-actions pap-actions--sticky">
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="save-datos" ${_busy ? 'disabled' : ''}>Guardar y ir a fotos</button>
        </div>
      ` : ''}
    </div>
  `;
}

function _salidaSummaryHtml(p, { compact = false } = {}) {
  const out = p.salida || {};
  const firma = String(out.firmaPath || '').trim();
  return `
    <section class="pap-salida-block pap-hoja pap-hoja--snapshot">
      <header class="pap-hoja__head">
        <div>
          <p class="pap-hoja__eyebrow">Salida registrada</p>
          <h3>Entrega / Out</h3>
        </div>
        <div class="pap-contrato pap-contrato--ro">
          <span>Contrato</span>
          <strong>${_esc(p.contrato || '—')}</strong>
        </div>
      </header>
      ${_unitIdentityHtml(p)}
      <section class="pap-io-table" aria-label="Salida">
        <div class="pap-io-table__row pap-io-table__row--head">
          <span></span><span>Nombre</span><span>KM</span><span>Gas</span>
        </div>
        <div class="pap-io-table__row">
          <strong>Entrega / Out</strong>
          <div>${_esc(out.quienEntrega || p.clienteNombre || '—')}</div>
          <div class="pap-td-mono">${_esc(out.km ?? '—')}</div>
          <div class="pap-td-mono">${_esc(out.gas || '—')}</div>
        </div>
      </section>
      ${!compact ? `
        <div class="pap-hoja__body pap-hoja__body--ro">
          <div class="pap-check-col">${_checklistReadonlyHtml(p)}</div>
          <div class="pap-hoja__diagram">${_diagramReadonlyHtml(p)}</div>
        </div>
        <h3 class="pap-subhead">Daños / zonas</h3>
        ${_danosSalidaHtml(p)}
        ${firma ? '<p class="pap-hint">Firma de entrega capturada.</p><div class="pap-firma-host" data-firma-preview></div>' : '<p class="pap-hint">Sin firma en archivo.</p>'}
      ` : `
        <div class="pap-hoja__diagram pap-hoja__diagram--mini">${_diagramReadonlyHtml(p)}</div>
        <p class="pap-hint">Checklist y fotos completas en la pestaña <b>Salida</b>.</p>
      `}
    </section>
  `;
}

function _panelSalidaView(p) {
  return `
    <div class="pap-panel pap-panel--wide pap-panel--regreso">
      ${_salidaSummaryHtml(p, { compact: false })}
      <h3 class="pap-subhead">Fotos de salida</h3>
      <div class="pap-photos" id="papCompare"></div>
      <div class="pap-actions pap-actions--sticky">
        <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="goto-entrada">Ir a regreso</button>
        <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="pdf">Exportar</button>
      </div>
    </div>
  `;
}

function _panelEntrada(p) {
  const locked = p.status === 'en_retorno' || p.status === 'cerrada_historial';
  const e = p.entrada || {};
  return `
    <div class="pap-panel pap-panel--wide pap-panel--regreso pap-hoja">
      <h2>${locked ? 'Regreso registrado' : 'Registrar regreso'}</h2>
      ${_salidaSummaryHtml(p, { compact: true })}

      <section class="pap-entrada-block">
        <section class="pap-io-table" aria-label="Entrada">
          <div class="pap-io-table__row pap-io-table__row--head">
            <span></span><span>Nombre</span><span>KM</span><span>Gas</span>
          </div>
          <div class="pap-io-table__row">
            <strong>Recibe / In</strong>
            <div class="pap-field pap-field--bare">
              <input id="papQuienRecibe" value="${_esc(e.quienRecibe || _user().nombre)}" ${locked ? 'disabled' : ''} autocomplete="name"/>
            </div>
            <div class="pap-field pap-field--bare">
              <input id="papKmIn" type="text" inputmode="numeric" pattern="[0-9]*" value="${_esc(e.km ?? '')}" ${locked ? 'disabled' : ''} autocomplete="off" placeholder="0"/>
            </div>
            <div class="pap-field pap-field--bare pap-field--gas">
              ${_gasChipsHtml(e.gas || '', 'papGasIn', locked)}
            </div>
          </div>
        </section>
        <div class="pap-field">
          <label>Notas / interiores</label>
          <textarea id="papNotasIn" rows="2" ${locked ? 'disabled' : ''}>${_esc(e.notas || '')}</textarea>
        </div>
        <h3 class="pap-subhead">Fotos salida (referencia)</h3>
        <div class="pap-photos" id="papCompare"></div>
      </section>
      ${!locked ? `
        <div class="pap-actions pap-actions--sticky">
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="save-entrada" ${_busy ? 'disabled' : ''}>Registrar entrada</button>
        </div>
      ` : `<p class="pap-card__meta">Entrada registrada · unidad liberada para nueva papeleta</p>`}
    </div>
  `;
}


function _zonaChipClass(p, z, idx) {
  const data = p.zonas?.[z.id] || {};
  const hasFoto = String(data.fotoPath || '').trim();
  const dano = data.estado === 'dano';
  const active = idx === _zonaIdx;
  return [
    'pap-zona-chip',
    active ? 'is-active' : '',
    hasFoto ? 'has-foto' : '',
    dano ? 'has-dano' : '',
  ].filter(Boolean).join(' ');
}

function _panelZonas(p, editable) {
  const z = ZONAS_V1[_zonaIdx] || ZONAS_V1[0];
  const data = p.zonas?.[z.id] || { estado: 'ok', nota: '', fotoPath: '' };
  const n = _fotosCount(p);
  const nextPending = ZONAS_V1.findIndex((zona) => !String(p.zonas?.[zona.id]?.fotoPath || '').trim());
  const startHint = nextPending >= 0 ? nextPending + 1 : Math.min(_zonaIdx + 1, 12);
  return `
    <div class="pap-panel pap-panel--wide pap-panel--zona">
      <h2>Fotos y daños</h2>
      <p class="pap-hint">Recorre las 12 partes en orden. ${n}/12 fotos listas.</p>
      ${editable ? `
        <div class="pap-cam-cta">
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block pap-btn--cam" data-act="open-camera" ${_busy ? 'disabled' : ''}>
            <span class="material-symbols-outlined">photo_camera</span>
            Abrir cámara guiada · desde ${startHint}/12
          </button>
          <p class="pap-cam-cta__hint">Pantalla completa: captura y avanza sin salir. También puedes subir desde galería dentro de la cámara.</p>
        </div>
      ` : ''}
      <div class="pap-zona-chips" role="tablist" aria-label="Zonas del vehículo">
        ${ZONAS_V1.map((zona, idx) => `
          <button type="button" class="${_zonaChipClass(p, zona, idx)}" data-act="zona-jump" data-idx="${idx}" title="${_esc(zona.label)}">
            <span class="pap-zona-chip__n">${idx + 1}</span>
            <span class="pap-zona-chip__l">${_esc(zona.label)}</span>
          </button>
        `).join('')}
      </div>
      <div class="pap-zona-active">
        <div class="pap-zona-nav">
          <button type="button" class="pap-icon-btn" data-act="zona-prev" ${_zonaIdx <= 0 ? 'disabled' : ''} aria-label="Anterior">
            <span class="material-symbols-outlined">chevron_left</span>
          </button>
          <div class="pap-progress">
            <strong>${_esc(z.label)}</strong>
            <span>${_zonaIdx + 1}/12 · ${n}/12 fotos</span>
          </div>
          <button type="button" class="pap-icon-btn" data-act="zona-next" ${_zonaIdx >= 11 ? 'disabled' : ''} aria-label="Siguiente">
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
        <div class="pap-seg">
          <button type="button" class="pap-seg__btn ${data.estado !== 'dano' ? 'is-on' : ''}" data-act="zona-ok" ${editable ? '' : 'disabled'}>Sin daño</button>
          <button type="button" class="pap-seg__btn ${data.estado === 'dano' ? 'is-on is-bad' : ''}" data-act="zona-dano" ${editable ? '' : 'disabled'}>Hay daño</button>
        </div>
        <input type="hidden" data-zona-estado value="${data.estado === 'dano' ? 'dano' : 'ok'}"/>
        ${data.estado === 'dano' ? `
          <div class="pap-field">
            <label>Nota corta (opcional)</label>
            <input data-zona-nota maxlength="40" value="${_esc(data.nota || '')}" placeholder="Ej: rayón puerta" ${editable ? '' : 'disabled'}/>
          </div>
        ` : `<input type="hidden" data-zona-nota value="${_esc(data.nota || '')}"/>`}
        <div class="pap-cam">
          <img data-zona-preview alt="" class="pap-cam__preview"${data.fotoPath ? '' : ' hidden'}/>
          <div class="pap-cam__status" data-foto-status>${data.fotoPath ? 'Foto lista ✓' : 'Falta foto de esta parte'}</div>
          ${editable ? `
            <label class="pap-cam__btn pap-cam__btn--ghost">
              <input type="file" accept="image/*" data-zona-foto data-autosave="1" hidden/>
              <span class="material-symbols-outlined">upload</span>
              Subir desde dispositivo
            </label>
            ${data.estado === 'dano' ? `
              <label class="pap-cam__btn pap-cam__btn--ghost">
                <input type="file" accept="image/*" capture="environment" data-zona-detalle hidden/>
                <span class="material-symbols-outlined">add_a_photo</span>
                Foto detalle
              </label>
            ` : ''}
          ` : ''}
        </div>
      </div>
      ${editable ? `
        <div class="pap-actions pap-actions--sticky">
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="open-camera" ${_busy ? 'disabled' : ''}>
            Continuar con cámara guiada
          </button>
          <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="save-zona" ${_busy ? 'disabled' : ''}>
            ${data.fotoPath ? (_zonaIdx < 11 ? 'Guardar nota y siguiente' : 'Guardar y continuar') : 'Guardar zona (requiere foto)'}
          </button>
          <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="goto-resumen">Ir a entregar</button>
        </div>
      ` : ''}
    </div>
  `;
}


function _panelResumen(p) {
  const gate = _deliveryGate(p, { firma: p.salida?.firma || null });
  const coreOk = coreZonasHaveFoto(p.zonas, { papeleta: p });
  const checkOk = isChecklistComplete(p);
  const hardWithoutFirma = (gate.hard || []).filter((h) => h !== 'firma');
  const canAskFirma = puedeEditar(p.status) && hardWithoutFirma.length === 0;
  const HARD_LABELS = {
    km: 'Kilometraje',
    gas: 'Gasolina',
    checklist: 'Checklist / llantas / tapetes',
    core_photos: 'Fotos core (6)',
    firma: 'Firma',
    pending_writes: 'Guardado pendiente',
    km_justification: 'Justificación de KM',
    status: 'Estado no elegible',
  };
  return `
    <div class="pap-panel">
      <h2>Listo para entregar</h2>
      <ul class="pap-checklist-status">
        <li class="${coreOk ? 'is-ok' : ''}">Fotos core: ${coreOk ? '6/6' : `${_coreFotosCount(p)}/6`}</li>
        <li class="${checkOk ? 'is-ok' : ''}">Accesorios: ${checkOk ? 'completos' : 'faltan por marcar'}</li>
        <li>Estado: ${_esc(STATUS_LABELS[p.status] || p.status)}</li>
      </ul>
      ${hardWithoutFirma.length ? `
        <p class="pap-hint">Falta: ${hardWithoutFirma.map((h) => HARD_LABELS[h] || h).join(', ')}</p>
      ` : '<p class="pap-ready">Listo para pedir firma</p>'}
      ${(gate.soft || []).includes('faltantes') ? '<p class="pap-hint">Hay ítems marcados como faltante (se pedirá confirmación).</p>' : ''}
      <p class="pap-entregar-a">Entregar a: <b>${_esc(p.clienteNombre || 'Sin cliente')}</b></p>
      <div class="pap-fields-2">
        <div class="pap-field"><label>KM salida</label><input value="${_esc(p.salida?.km ?? _pendingSalida.km ?? '—')}" disabled/></div>
        <div class="pap-field"><label>Gas salida</label><input value="${_esc(p.salida?.gas ?? _pendingSalida.gas ?? '—')}" disabled/></div>
      </div>
      <div class="pap-actions pap-actions--sticky">
        ${canAskFirma ? `
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="start-entregar" ${_busy ? 'disabled' : ''}>
            Pedir firma y entregar
          </button>
        ` : ''}
        ${p.status === 'entregada' || p.status === 'en_retorno' || p.status === 'cerrada_historial' ? `
          <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="pdf" title="Exportar PDF / XLS / CSV">Exportar</button>
        ` : ''}
        ${p.status === 'entregada' ? `
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="goto-entrada">Registrar regreso</button>
        ` : ''}
      </div>
    </div>
  `;
}

function _panelFirma(p) {
  return `
    <div class="pap-panel">
      <h2>${_esc(p.clienteNombre || 'Cliente')} — Firma</h2>
      <canvas class="pap-sig" id="papSig" width="480" height="180"></canvas>
      <div class="pap-actions">
        <button type="button" class="pap-btn pap-btn--ghost" data-act="sig-clear">Limpiar</button>
        <button type="button" class="pap-btn pap-btn--primary" data-act="sig-confirm" ${_busy ? 'disabled' : ''}>Confirmar entrega</button>
      </div>
    </div>
  `;
}

function _unitIdentityHtml(p) {
  return `
    <div class="pap-identity">
      <div class="pap-identity__cell"><span>Económico</span><strong>${_esc(p.mva || '—')}</strong></div>
      <div class="pap-identity__cell"><span>Modelo</span><strong>${_esc(p.modelo || '—')}</strong></div>
      <div class="pap-identity__cell"><span>Placas</span><strong>${_esc(p.placas || '—')}</strong></div>
      <div class="pap-identity__cell"><span>Color</span><strong>${_esc(p.color || '—')}</strong></div>
    </div>
  `;
}

function _checklistReadonlyHtml(p) {
  return `
    <div class="pap-check-readonly">
      ${CHECKLIST_KEYS.map((k) => {
        const val = String(p.checklist?.[k] || '');
        return `
          <div class="pap-check-readonly__row">
            <span class="pap-check-readonly__name">${_esc(CHECKLIST_LABELS[k] || k)}</span>
            <span class="pap-ternary" aria-label="${_esc(val || 'sin marcar')}">
              <span class="pap-ternary__btn ${val === 'ok' ? 'is-on is-ok' : ''}" title="Está"><span class="material-symbols-outlined">check</span></span>
              <span class="pap-ternary__btn ${val === 'faltante' ? 'is-on is-bad' : ''}" title="No está"><span class="material-symbols-outlined">close</span></span>
              <span class="pap-ternary__btn ${val === 'na' ? 'is-on is-na' : ''}" title="N/A"><span class="material-symbols-outlined">block</span></span>
            </span>
          </div>`;
      }).join('')}
      ${_tapetesReadonlyHtml(p)}
      ${_llantasReadonlyHtml(p)}
    </div>
  `;
}

function _danosSalidaHtml(p) {
  const danos = ZONAS_V1.filter((z) => String(p.zonas?.[z.id]?.estado || '') === 'dano');
  if (!danos.length) return '<p class="pap-hint">Sin daños marcados en salida.</p>';
  return `
    <ul class="pap-dano-list">
      ${danos.map((z) => {
        const nota = truncNota(p.zonas?.[z.id]?.nota || '');
        return `<li><strong>${_esc(z.label)}</strong>${nota ? ` · ${_esc(nota)}` : ''}</li>`;
      }).join('')}
    </ul>
  `;
}

function _panelReporte(p) {
  return `
    <div class="pap-panel">
      <h2>Reportar daño / faltante</h2>
      <div class="pap-field">
        <label>Tipo</label>
        <select id="papRepTipo"><option value="dano">Daño</option><option value="faltante">Faltante</option></select>
      </div>
      <div class="pap-field">
        <label>Zonas (daño)</label>
        <select id="papRepZonas" multiple size="6">
          ${ZONAS_V1.map((z) => `<option value="${z.id}">${_esc(z.label)}</option>`).join('')}
        </select>
      </div>
      <div class="pap-field">
        <label>Ítems faltantes</label>
        <select id="papRepItems" multiple size="6">
          ${CHECKLIST_KEYS.map((k) => `<option value="${k}">${_esc(CHECKLIST_LABELS[k])}</option>`).join('')}
        </select>
      </div>
      <div class="pap-field"><label>Foto placas *</label><input type="file" accept="image/*" id="papRepPlacas"/></div>
      <div class="pap-field"><label>Foto VIN *</label><input type="file" accept="image/*" id="papRepVin"/></div>
      <div class="pap-field"><label>Fotos daño</label><input type="file" accept="image/*" id="papRepDanos" multiple/></div>
      <div class="pap-actions">
        <button type="button" class="pap-btn pap-btn--danger" data-act="send-reporte" ${_busy ? 'disabled' : ''}>Enviar a Ventas</button>
      </div>
    </div>
  `;
}

function _renderVentas() {
  if (!_canVentas()) return `<div class="pap-empty">Sin permiso de Ventas.</div>`;
  if (!_reportes.length) return `<div class="pap-empty">No hay reportes abiertos.</div>`;
  return `
    <div class="pap-grid">
      ${_reportes.map((r) => `
        <div class="pap-card" style="cursor:default">
          <div class="pap-card__top">
            <span class="pap-card__mva">${_esc(r.mva || r.unidadId)}</span>
            <span class="pap-status">${_esc(r.tipo)} · ${_esc(r.status)}</span>
          </div>
          <div class="pap-card__meta">Papeleta ${_esc(r.papeletaId)}</div>
          <div class="pap-actions">
            <button type="button" class="pap-btn pap-btn--ghost" data-act="open" data-id="${_esc(r.papeletaId)}">Ver</button>
            <button type="button" class="pap-btn pap-btn--primary" data-act="promover" data-id="${_esc(r.id)}">Promover</button>
            ${rolPuedeCerrarCaso(_role()) ? `<button type="button" class="pap-btn pap-btn--ghost" data-act="cerrar-caso" data-id="${_esc(r.id)}">Cerrar caso</button>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function _unitHitHtml(u) {
  return `
    <button type="button" class="pap-ac-item" data-act="pick-unit" data-id="${_esc(u.id)}">
      <span class="pap-ac-item__mva">${_esc(u.mva || '—')}</span>
      <span class="pap-ac-item__meta">
        <span>${_esc(u.placas || 'Sin placas')}</span>
        <span>${_esc(u.modelo || 'Sin modelo')}${u.color ? ` · ${_esc(u.color)}` : ''}</span>
      </span>
      <span class="material-symbols-outlined">chevron_right</span>
    </button>`;
}

function _renderUnitHitsHtml() {
  if (_unitSearchBusy) {
    return `<div class="pap-ac-empty">Buscando…</div>`;
  }
  if (!_unitHits.length) {
    return `<div class="pap-ac-empty">${_unitQ.trim() ? 'Sin coincidencias. Prueba económico o placas.' : 'Escribe económico, placas o modelo.'}</div>`;
  }
  return _unitHits.map(_unitHitHtml).join('');
}

function _paintUnitHits() {
  const host = _container?.querySelector('#papUnitHits');
  if (!host) return;
  host.innerHTML = _renderUnitHitsHtml();
  host.querySelectorAll('[data-act="pick-unit"]').forEach((btn) => {
    btn.addEventListener('click', () => _crearDesdeUnidad(btn.dataset.id));
  });
}

async function _runUnitAutocomplete(raw) {
  const seq = ++_unitSearchSeq;
  _unitQ = raw;
  _unitSearchBusy = true;
  _paintUnitHits();
  try {
    const plaza = String(getCurrentPlaza() || '').toUpperCase();
    const hits = await buscarUnidad(_unitQ, { limit: 12, plazaId: plaza });
    if (seq !== _unitSearchSeq) return;
    _unitHits = hits;
  } catch (_) {
    if (seq !== _unitSearchSeq) return;
    _unitHits = [];
  } finally {
    if (seq === _unitSearchSeq) {
      _unitSearchBusy = false;
      _paintUnitHits();
    }
  }
}

function _scheduleUnitAutocomplete(raw) {
  if (_unitSearchTimer) clearTimeout(_unitSearchTimer);
  _unitSearchTimer = setTimeout(() => _runUnitAutocomplete(raw), 160);
}

function _renderNuevaScreen() {
  return `
    <main class="pap-editor-shell">
      <header class="pap-editor-top pap-sheet-head">
        <div>
          <nav class="pap-breadcrumb" aria-label="Ruta">
            <button type="button" data-act="back">Papeletas</button>
            <span>/</span>
            <strong>Nueva</strong>
          </nav>
          <p class="pap-kicker">HOJA DE INSPECCIÓN</p>
          <h1>Nueva papeleta</h1>
          <p class="pap-editor-sub">Busca la unidad — MVA, placas o modelo. Los datos se rellenan solos.</p>
        </div>
        <div class="pap-actions-bar">
          <button type="button" class="pap-btn pap-btn--ghost" data-act="back">Volver</button>
        </div>
      </header>
      <div class="pap-panel pap-panel--wide pap-nueva-panel pap-sheet">
        <label class="pap-ac pap-ac--hero">
          <span class="material-symbols-outlined">directions_car</span>
          <input id="papUnitQ" type="search" inputmode="search" enterkeyhint="search"
            placeholder="Económico, placas o modelo…"
            value="${_esc(_unitQ)}" autocomplete="off" autocorrect="off" spellcheck="false"/>
        </label>
        <div class="pap-ac-list" id="papUnitHits" role="listbox">
          ${_renderUnitHitsHtml()}
        </div>
      </div>
    </main>
  `;
}

function _renderNuevaModal() {
  return `
    <div class="pap-modal-backdrop" data-act="close-modal">
      <div class="pap-modal pap-modal--ac" data-stop role="dialog" aria-label="Nueva papeleta">
        <div class="pap-modal__head">
          <h2>Nueva papeleta</h2>
          <button type="button" class="pap-icon-btn" data-act="close-nueva" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <p class="pap-hint">Busca la unidad y tócala para abrir la papeleta.</p>
        <label class="pap-ac">
          <span class="material-symbols-outlined">directions_car</span>
          <input id="papUnitQ" type="search" inputmode="search" enterkeyhint="search"
            placeholder="Económico, placas o modelo…"
            value="${_esc(_unitQ)}" autocomplete="off" autocorrect="off" spellcheck="false"/>
        </label>
        <div class="pap-ac-list" id="papUnitHits" role="listbox">
          ${_renderUnitHitsHtml()}
        </div>
      </div>
    </div>
  `;
}

function _bind() {
  const root = _container;
  if (!root) return;

  root.querySelector('[data-act="tab-list"]')?.addEventListener('click', () => _gotoList());
  root.querySelector('[data-act="tab-ventas"]')?.addEventListener('click', () => _gotoVentas());
  root.querySelector('[data-act="nueva"]')?.addEventListener('click', () => {
    _navigate?.(NEW_ROUTE);
  });
  root.querySelector('#papSearch')?.addEventListener('input', (e) => {
    _query = e.target.value;
    _paintList();
  });
  root.querySelectorAll('[data-act="filter"]').forEach((btn) => {
    btn.addEventListener('click', () => { _filter = btn.dataset.f; _paintList(); });
  });
  // Buttons (Ventas bandeja); table rows use _bindTableRows (keyboard + click)
  root.querySelectorAll('button[data-act="open"]').forEach((el) => {
    el.addEventListener('click', () => _openDetail(el.dataset.id));
  });
  root.querySelectorAll('[data-act="back"]').forEach((btn) => {
    btn.addEventListener('click', () => _gotoList());
  });
  root.querySelectorAll('[data-act="step"]').forEach((btn) => {
    btn.addEventListener('click', () => { _wizardStep = btn.dataset.step; _render(); });
  });
  root.querySelectorAll('[data-act="check-set"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!_detail || !puedeEditar(_detail.status)) return;
      if (!_detail.checklist) _detail.checklist = {};
      _detail.checklist[btn.dataset.key] = btn.dataset.val;
      // keep strokes across checklist re-render
      if (_diagramApi) _localStrokes = _diagramApi.getStrokes();
      _render();
    });
  });
  root.querySelectorAll('[data-act="gas-set"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.gasFor;
      const hidden = id ? root.querySelector('#' + id) : null;
      if (hidden) hidden.value = btn.dataset.val || '';
      root.querySelectorAll(`[data-act="gas-set"][data-gas-for="${id}"]`).forEach((b) => {
        b.classList.toggle('is-on', b === btn);
      });
    });
  });
  root.querySelectorAll('[data-act="zona-jump"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _zonaIdx = Math.max(0, Math.min(11, Number(btn.dataset.idx) || 0));
      _render();
    });
  });
  root.querySelectorAll('[data-act="open-camera"]').forEach((btn) => {
    btn.addEventListener('click', () => _openGuidedCamera());
  });
  root.querySelector('[data-act="goto-resumen"]')?.addEventListener('click', () => {
    _wizardStep = 'resumen';
    _render();
  });
  const kmOut = root.querySelector('#papKmSalida');
  if (kmOut && !kmOut.disabled) {
    kmOut.addEventListener('input', () => {
      const digits = String(kmOut.value || '').replace(/\D+/g, '');
      if (kmOut.value !== digits) kmOut.value = digits;
    });
  }
  ['#papTapetesRudo', '#papTapetesAlfombra'].forEach((sel) => {
    const el = root.querySelector(sel);
    if (!el || el.disabled) return;
    el.addEventListener('input', () => {
      const digits = String(el.value || '').replace(/\D+/g, '');
      if (el.value !== digits) el.value = digits;
    });
  });
  const syncLlantas = (source) => {
    const box = root.querySelector('#papMarcarTodas');
    if (!box?.checked) return;
    const val = String(source?.value || '').trim();
    root.querySelectorAll('[data-llanta]').forEach((inp) => { inp.value = val; });
  };
  root.querySelectorAll('[data-llanta]').forEach((inp) => {
    inp.addEventListener('input', () => syncLlantas(inp));
  });
  root.querySelector('#papMarcarTodas')?.addEventListener('change', (e) => {
    if (!e.target.checked) return;
    const first = root.querySelector('[data-llanta]');
    if (first) syncLlantas(first);
  });
  root.querySelector('[data-act="zona-prev"]')?.addEventListener('click', () => {
    _zonaIdx = Math.max(0, _zonaIdx - 1); _render();
  });
  root.querySelector('[data-act="zona-next"]')?.addEventListener('click', () => {
    _zonaIdx = Math.min(11, _zonaIdx + 1); _render();
  });
  root.querySelector('[data-act="zona-ok"]')?.addEventListener('click', () => {
    const hid = _container.querySelector('[data-zona-estado]');
    if (hid) hid.value = 'ok';
    _renderZonaEstadoUi('ok');
  });
  root.querySelector('[data-act="zona-dano"]')?.addEventListener('click', () => {
    const hid = _container.querySelector('[data-zona-estado]');
    if (hid) hid.value = 'dano';
    // Re-render panel to show nota + detalle (estado local until save)
    if (_detail) {
      const z = ZONAS_V1[_zonaIdx];
      if (!_detail.zonas) _detail.zonas = {};
      _detail.zonas[z.id] = { ...(_detail.zonas[z.id] || {}), estado: 'dano' };
      _render();
    }
  });
  root.querySelector('[data-act="save-datos"]')?.addEventListener('click', () => _saveDatos());
  root.querySelector('[data-act="save-zona"]')?.addEventListener('click', () => _saveZona());
  root.querySelector('[data-act="save-check"]')?.addEventListener('click', () => _saveCheck());
  root.querySelector('[data-act="start-entregar"]')?.addEventListener('click', () => _startEntregar());
  root.querySelector('[data-act="sig-clear"]')?.addEventListener('click', () => _clearSig());
  root.querySelector('[data-act="sig-confirm"]')?.addEventListener('click', () => _confirmFirma());
  root.querySelector('[data-act="pdf"]')?.addEventListener('click', () => _doPdf());
  root.querySelectorAll('[data-act="goto-entrada"]').forEach((btn) => {
    btn.addEventListener('click', () => { _wizardStep = 'entrada'; _render(); });
  });
  const kmIn = root.querySelector('#papKmIn');
  if (kmIn && !kmIn.disabled) {
    kmIn.addEventListener('input', () => {
      const digits = String(kmIn.value || '').replace(/\D+/g, '');
      if (kmIn.value !== digits) kmIn.value = digits;
    });
  }
  root.querySelector('[data-act="save-entrada"]')?.addEventListener('click', () => _saveEntrada());
  root.querySelector('[data-act="send-reporte"]')?.addEventListener('click', () => _sendReporte());
  root.querySelectorAll('[data-act="promover"]').forEach((btn) => {
    btn.addEventListener('click', () => _promover(btn.dataset.id));
  });
  root.querySelectorAll('[data-act="cerrar-caso"]').forEach((btn) => {
    btn.addEventListener('click', () => _cerrar(btn.dataset.id));
  });
  root.querySelector('[data-act="close-modal"]')?.addEventListener('click', (e) => {
    if (e.target.dataset.act === 'close-modal') { _showNueva = false; _render(); }
  });
  root.querySelector('[data-act="close-nueva"]')?.addEventListener('click', () => {
    _showNueva = false; _render();
  });
  root.querySelector('#papUnitQ')?.addEventListener('input', (e) => {
    _scheduleUnitAutocomplete(e.target.value || '');
  });
  root.querySelectorAll('[data-act="pick-unit"]').forEach((btn) => {
    btn.addEventListener('click', () => _crearDesdeUnidad(btn.dataset.id));
  });
  // Auto-guardar al elegir foto (flujo rápido en patio)
  root.querySelector('[data-zona-foto][data-autosave]')?.addEventListener('change', () => {
    if (_container.querySelector('[data-zona-foto]')?.files?.[0]) _saveZona();
  });
  if (_mode === 'list') _bindTableRows(_container.querySelector('#pap-table-host'));
}

function _renderZonaEstadoUi(estado) {
  if (_detail) {
    const z = ZONAS_V1[_zonaIdx];
    if (!_detail.zonas) _detail.zonas = {};
    _detail.zonas[z.id] = { ...(_detail.zonas[z.id] || {}), estado };
  }
  _render();
}

async function _hydrateFotos() {
  if (!_detail || !_container) return;
  const z = ZONAS_V1[_zonaIdx];
  const path = _detail.zonas?.[z?.id]?.fotoPath;
  const img = _container.querySelector('[data-zona-preview]');
  if (img && path) {
    const url = await _fotoUrl(path);
    if (url) { img.src = url; img.style.display = 'block'; }
  }
  const compare = _container.querySelector('#papCompare');
  if (compare && (_wizardStep === 'entrada' || _wizardStep === 'salida')) {
    compare.innerHTML = '<div class="pap-card__meta">Cargando fotos de salida…</div>';
    const parts = [];
    for (const zona of ZONAS_V1) {
      const zp = _detail.zonas?.[zona.id];
      if (!zp?.fotoPath) continue;
      const url = await _fotoUrl(zp.fotoPath);
      if (!url) continue;
      parts.push(`<figure><img src="${_esc(url)}" alt=""/><figcaption>${_esc(zona.label)}${zp.estado === 'dano' ? ' · daño' : ''}</figcaption></figure>`);
    }
    compare.innerHTML = parts.join('') || '<div class="pap-card__meta">Sin fotos de salida</div>';
  }
  const firmaHost = _container.querySelector('[data-firma-preview]');
  const firmaPath = _detail.salida?.firmaPath;
  if (firmaHost && firmaPath) {
    const url = await _fotoUrl(firmaPath);
    firmaHost.innerHTML = url
      ? `<img class="pap-firma-img" src="${_esc(url)}" alt="Firma de entrega"/>`
      : '<span class="pap-muted">No se pudo cargar la firma</span>';
  }
}

async function _saveDatos() {
  if (!_detail) return;
  const patch = {};
  _container.querySelectorAll('[data-field]').forEach((el) => {
    patch[el.dataset.field] = el.value.trim();
  });
  const kmRaw = _container.querySelector('#papKmSalida')?.value ?? '';
  const gasRaw = _container.querySelector('#papGasSalida')?.value ?? '';
  const kmDigits = String(kmRaw).replace(/\D+/g, '');
  const km = kmDigits === '' ? null : Number(kmDigits);
  const checklist = { ...(_detail.checklist || {}) };
  CHECKLIST_KEYS.forEach((k) => { if (checklist[k] == null) checklist[k] = ''; });
  _pendingSalida = { km, gas: gasRaw || null };
  _busy = true; _render();
  try {
    if (patch.clienteNombre != null && _canVentas()) {
      await asignarCliente(_detail.id, patch.clienteNombre, { user: _user() });
      delete patch.clienteNombre;
    }
    if (puedeEditar(_detail.status)) {
      const strokes = _diagramApi ? _diagramApi.getStrokes() : (_localStrokes || _detail.diagramaStrokes || []);
      _localStrokes = strokes;
      const marcasLlantas = {
        delanteraIzq: '',
        delanteraDer: '',
        traseraIzq: '',
        traseraDer: '',
        marcarTodas: !!_container.querySelector('#papMarcarTodas')?.checked,
      };
      _container.querySelectorAll('[data-llanta]').forEach((inp) => {
        marcasLlantas[inp.dataset.llanta] = String(inp.value || '').trim();
      });
      if (marcasLlantas.marcarTodas) {
        const master = marcasLlantas.delanteraIzq
          || marcasLlantas.delanteraDer
          || marcasLlantas.traseraIzq
          || marcasLlantas.traseraDer
          || '';
        LLANTA_KEYS.forEach((k) => { marcasLlantas[k] = master; });
      }
      const tapetesUsoRudoRaw = _container.querySelector('#papTapetesRudo')?.value ?? '';
      const tapetesAlfombraRaw = _container.querySelector('#papTapetesAlfombra')?.value ?? '';
      const tapetesUsoRudo = tapetesUsoRudoRaw === '' ? null : Number(String(tapetesUsoRudoRaw).replace(/\D+/g, ''));
      const tapetesAlfombra = tapetesAlfombraRaw === '' ? null : Number(String(tapetesAlfombraRaw).replace(/\D+/g, ''));
      const marcaLlantasLegacy = LLANTA_KEYS.map((k) => marcasLlantas[k]).filter(Boolean).join(' / ');
      delete patch.marcaLlantas;
      await actualizarPapeleta(_detail.id, {
        ...patch,
        checklist,
        marcasLlantas,
        marcaLlantas: marcaLlantasLegacy,
        tapetesUsoRudo: Number.isFinite(tapetesUsoRudo) ? tapetesUsoRudo : null,
        tapetesAlfombra: Number.isFinite(tapetesAlfombra) ? tapetesAlfombra : null,
        notasInteriores: patch.notasInteriores || '',
        contrato: patch.contrato || '',
        diagramaStrokes: strokes,
        salida: {
          ...(_detail.salida || {}),
          km: Number.isFinite(km) ? km : (_detail.salida?.km ?? null),
          gas: gasRaw || _detail.salida?.gas || null,
          marcasLlantas,
          marcaLlantas: marcaLlantasLegacy,
          tapetesUsoRudo: Number.isFinite(tapetesUsoRudo) ? tapetesUsoRudo : null,
          tapetesAlfombra: Number.isFinite(tapetesAlfombra) ? tapetesAlfombra : null,
        },
      }, { user: _user() });
      _wizardStep = 'zonas';
    }
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

function _closeGuidedCamera() {
  if (_cameraApi) {
    try { _cameraApi.close(); } catch (_) { /* ignore */ }
  }
  _cameraApi = null;
}

/**
 * Persist a zone photo without tearing down the guided camera overlay.
 * @param {number} zonaIdx
 * @param {File|Blob|null} file
 * @param {{ estado?: string, nota?: string, advanceUi?: boolean }} opts
 */
async function _persistZonaFoto(zonaIdx, file, opts = {}) {
  if (!_detail) throw new Error('Sin papeleta');
  const z = ZONAS_V1[zonaIdx];
  if (!z) throw new Error('Zona inválida');
  const zonas = { ...(_detail.zonas || {}) };
  const cur = { ...(zonas[z.id] || { estado: 'ok', nota: '', fotoPath: '' }) };
  if (opts.estado) cur.estado = opts.estado;
  if (opts.nota != null) cur.nota = truncNota(opts.nota);
  if (file) {
    cur.fotoPath = await uploadZonaFoto(_detail.id, z.id, file);
    _fotoCache.delete(cur.fotoPath);
  }
  if (!cur.fotoPath) throw new Error('La foto de la zona es obligatoria');
  zonas[z.id] = cur;
  await actualizarPapeleta(_detail.id, { zonas }, { user: _user() });
  // Optimistic local update so camera hasFoto() stays in sync
  if (_detail) _detail.zonas = zonas;
  _zonaIdx = zonaIdx;
  if (opts.advanceUi) {
    if (zonaIdx < 11) _zonaIdx = zonaIdx + 1;
    else _wizardStep = 'resumen';
  }
  return cur;
}

function _openGuidedCamera() {
  if (!_detail || !puedeEditar(_detail.status)) return;
  _closeGuidedCamera();
  const pending = ZONAS_V1.findIndex((z) => !String(_detail.zonas?.[z.id]?.fotoPath || '').trim());
  const startIndex = pending >= 0 ? pending : _zonaIdx;
  _cameraApi = openGuidedCamera({
    zones: ZONAS_V1.map((z) => ({ id: z.id, label: z.label })),
    startIndex,
    hasFoto: (zonaId) => !!String(_detail?.zonas?.[zonaId]?.fotoPath || '').trim(),
    onCapture: async (zona, index, file) => {
      await _persistZonaFoto(index, file, {
        estado: _detail?.zonas?.[zona.id]?.estado || 'ok',
        nota: _detail?.zonas?.[zona.id]?.nota || '',
      });
    },
    onSkip: (_zona, index) => { _zonaIdx = index; },
    onMarkDamage: async (zona, index) => {
      _zonaIdx = index;
      if (!_detail.zonas) _detail.zonas = {};
      const cur = { ...(_detail.zonas[zona.id] || {}), estado: 'dano' };
      _detail.zonas[zona.id] = cur;
      let nota = cur.nota || '';
      try {
        if (typeof window.mexPrompt === 'function') {
          nota = await window.mexPrompt('Daño en zona', `Nota corta para ${zona.label} (opcional)`, cur.nota || '');
        } else {
          nota = prompt(`Nota daño · ${zona.label}`, cur.nota || '') || '';
        }
      } catch (_) { /* cancelled */ }
      cur.nota = truncNota(nota || '');
      await actualizarPapeleta(_detail.id, { zonas: { ..._detail.zonas, [zona.id]: cur } }, { user: _user() });
    },
    onClose: () => {
      _cameraApi = null;
      if (_container) _render();
    },
  });
}

async function _saveZona() {
  if (!_detail) return;
  const z = ZONAS_V1[_zonaIdx];
  const estado = _container.querySelector('[data-zona-estado]')?.value || 'ok';
  const nota = truncNota(_container.querySelector('[data-zona-nota]')?.value || '');
  const file = _container.querySelector('[data-zona-foto]')?.files?.[0];
  const det = _container.querySelector('[data-zona-detalle]')?.files?.[0];
  _busy = true; _render();
  try {
    const zonas = { ...(_detail.zonas || {}) };
    const cur = { ...(zonas[z.id] || { estado: 'ok', nota: '', fotoPath: '' }) };
    cur.estado = estado;
    cur.nota = nota;
    if (file) cur.fotoPath = await uploadZonaFoto(_detail.id, z.id, file);
    if (det) cur.fotoDetallePath = await uploadZonaDetalle(_detail.id, z.id, det);
    if (!cur.fotoPath) throw new Error('La foto de la zona es obligatoria — usa la cámara guiada o sube una imagen');
    zonas[z.id] = cur;
    await actualizarPapeleta(_detail.id, { zonas }, { user: _user() });
    if (_zonaIdx < 11) _zonaIdx += 1;
    else _wizardStep = 'resumen';
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _saveCheck() {
  if (!_detail) return;
  const checklist = { ...(_detail.checklist || {}) };
  _container.querySelectorAll('[data-check]').forEach((el) => {
    checklist[el.dataset.check] = el.value;
  });
  _busy = true; _render();
  try {
    await actualizarPapeleta(_detail.id, { checklist }, { user: _user() });
    _wizardStep = 'resumen';
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _ensureListaAntesDeEntregar() {
  if (!_detail) return false;
  if (_detail.status === 'lista') return true;
  const gate = _deliveryGate(_detail, { firma: { imagePath: 'pending' } });
  const hard = (gate.hard || []).filter((h) => h !== 'firma');
  if (hard.length) {
    await _mexAlert('Falta completar', 'Completa KM, gas, checklist y las 6 fotos core antes de entregar.');
    return false;
  }
  await actualizarPapeleta(_detail.id, {}, { user: _user(), knownRevision: _detail.revision });
  return true;
}

async function _startEntregar() {
  if (!_detail) return;
  const kmEl = _container.querySelector('#papKmSalida');
  const gasEl = _container.querySelector('#papGasSalida');
  _pendingSalida = {
    km: kmEl ? kmEl.value : (_detail.salida?.km ?? _pendingSalida.km ?? ''),
    gas: gasEl ? gasEl.value : (_detail.salida?.gas ?? _pendingSalida.gas ?? ''),
  };
  if (!_detail.clienteNombre) {
    const ok = await _mexConfirm('Sin cliente asignado', 'Sin cliente asignado — ¿continuar?', 'warning');
    if (!ok) return;
  }
  try {
    const okLista = await _ensureListaAntesDeEntregar();
    if (!okLista) return;
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
    return;
  }
  _sigHasInk = false;
  _wizardStep = 'firma';
  _render();
}

function _bindSignature() {
  const canvas = _container?.querySelector('#papSig');
  if (!canvas || canvas.dataset.bound === '1') return;
  canvas.dataset.bound = '1';
  const ctx = canvas.getContext('2d');
  // Pad tipo papel: tinta oscura sobre blanco (PDF legible en claro/oscuro)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * (canvas.width / r.width), y: (src.clientY - r.top) * (canvas.height / r.height) };
  };

  const start = (e) => { e.preventDefault(); _sigDrawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => {
    if (!_sigDrawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    _sigHasInk = true;
  };
  const end = () => { _sigDrawing = false; };

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
}

function _clearSig() {
  const canvas = _container?.querySelector('#papSig');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  _sigHasInk = false;
}

async function _confirmFirma() {
  if (!_detail) return;
  const canvas = _container?.querySelector('#papSig');
  if (!canvas) return;
  if (!_sigHasInk) {
    await _mexAlert('Firma', 'Firma el pad antes de confirmar la entrega.');
    return;
  }
  // Capturar ANTES de _render (el re-render destruye el canvas)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    await _mexAlert('Firma', 'No se pudo capturar la firma.');
    return;
  }
  const kmRaw = _pendingSalida.km;
  const gasRaw = _pendingSalida.gas;
  const papeletaId = _detail.id;
  const softGate = _deliveryGate(
    {
      ..._detail,
      salida: {
        ...(_detail.salida || {}),
        km: kmRaw === '' || kmRaw == null ? _detail.salida?.km : Number(kmRaw),
        gas: gasRaw || _detail.salida?.gas,
      },
    },
    { firma: { imagePath: 'pending' } }
  );
  const confirmedWarnings = [];
  if ((softGate.soft || []).includes('faltantes')) {
    const ok = await _mexConfirm('Faltantes', 'Hay accesorios marcados como faltante. ¿Continuar con la entrega?', 'warning');
    if (!ok) return;
    confirmedWarnings.push('faltantes');
  }
  if ((softGate.soft || []).includes('cliente') || !_detail.clienteNombre) {
    const ok = await _mexConfirm('Sin cliente', 'Sin cliente asignado — ¿continuar?', 'warning');
    if (!ok) return;
    confirmedWarnings.push('cliente');
  }

  _busy = true; _render();
  try {
    const firmaPath = await uploadFirma(papeletaId, blob);
    const firma = {
      imagePath: firmaPath,
      signerName: String(_detail.clienteNombre || _user().nombre || ''),
      signerRole: _detail.clienteNombre ? 'Cliente' : 'Otro',
      signedAt: new Date().toISOString(),
      capturedBy: _user().uid || '',
      consentTextVersion: 'v1',
    };
    const result = await finalizeDelivery(papeletaId, {
      quienEntrega: _user().nombre,
      km: kmRaw === '' || kmRaw == null ? null : Number(kmRaw),
      gas: gasRaw || null,
      firma,
      confirmedWarnings,
      user: _user(),
    });
    if (result.alreadyFinalized) {
      await _mexAlert('Ya entregada', 'Esta papeleta ya estaba finalizada.');
    } else {
      const firmaUrl = await getDownloadUrl(firmaPath);
      await openPapeletaPdf(result.papeleta || {
        ..._detail,
        status: 'entregada',
        salida: { ...(_detail.salida || {}), firma, firmaPath, km: kmRaw, gas: gasRaw },
      }, { firmaUrl });
    }
    _pendingSalida = { km: null, gas: null };
    _wizardStep = 'resumen';
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _doPdf() {
  if (!_detail) return;
  const p = _detail;
  await openExportChooser({
    title: 'Exportar papeleta',
    subtitle: `${p.mva || 'Papeleta'} · PDF / XLS / CSV`,
    onPdf: async () => {
      const firmaUrl = await getDownloadUrl(p.salida?.firmaPath);
      await openPapeletaPdf(p, { firmaUrl });
    },
    onXls: () => exportPapeletaXls(p),
    onCsv: () => exportPapeletaCsv(p),
  });
}

async function _saveEntrada() {
  if (!_detail) return;
  _busy = true; _render();
  try {
    await registrarEntrada(_detail.id, {
      quienRecibe: _container.querySelector('#papQuienRecibe')?.value || _user().nombre,
      km: Number(_container.querySelector('#papKmIn')?.value || 0) || null,
      gas: _container.querySelector('#papGasIn')?.value || null,
      notas: _container.querySelector('#papNotasIn')?.value || '',
      user: _user(),
    });
    await _mexAlert('Entrada', 'Entrada registrada. La unidad queda libre para una nueva papeleta.');
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _sendReporte() {
  if (!_detail) return;
  const tipo = _container.querySelector('#papRepTipo')?.value || 'dano';
  const zonasSel = [...(_container.querySelector('#papRepZonas')?.selectedOptions || [])].map((o) => o.value);
  const itemsSel = [...(_container.querySelector('#papRepItems')?.selectedOptions || [])].map((o) => o.value);
  const fPlacas = _container.querySelector('#papRepPlacas')?.files?.[0];
  const fVin = _container.querySelector('#papRepVin')?.files?.[0];
  const fDanos = [...(_container.querySelector('#papRepDanos')?.files || [])];
  _busy = true; _render();
  try {
    const reporteId = newReporteId();
    const fotos = {};
    if (fPlacas) fotos.placas = await uploadReporteFoto(reporteId, 'placas', fPlacas);
    if (fVin) fotos.vin = await uploadReporteFoto(reporteId, 'vin', fVin);
    fotos.danos = [];
    for (let i = 0; i < fDanos.length; i++) {
      fotos.danos.push(await uploadReporteFoto(reporteId, `dano_${i + 1}`, fDanos[i]));
    }
    const res = await crearReporte({
      id: reporteId,
      papeleta: _detail,
      tipo,
      zonasNuevas: zonasSel,
      itemsFaltantes: itemsSel,
      fotos,
      user: _user(),
    });
    if (res.discarded) {
      await _mexAlert('Reporte', 'Ya documentado en salida');
    } else {
      await _mexAlert('Reporte', 'Enviado a bandeja de Ventas');
    }
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _promover(id) {
  _busy = true; _render();
  try {
    await promoverReporte(id);
    await _mexAlert('Ventas', 'Evidencias promovidas');
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _cerrar(id) {
  const ok = await _mexConfirm('Cerrar caso', '¿Cerrar caso global de Ventas?', 'warning');
  if (!ok) return;
  try {
    await cerrarCaso(id, { rol: _role(), user: _user() });
    await _mexAlert('Ventas', 'Caso cerrado');
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  }
}

async function _crearDesdeUnidad(unitId) {
  const unit = _unitHits.find((u) => u.id === unitId);
  if (!unit) return;
  _busy = true;
  try {
    const openCount = await countReportesAbiertosUnidad(unit.id);
    if (openCount > 0) {
      _casoWarning = 'Hay caso Ventas abierto para esta unidad. Puedes crear la papeleta; el aviso permanece visible.';
    } else {
      _casoWarning = '';
    }
    const plaza = String(getCurrentPlaza() || '').toUpperCase();
    const { id } = await crearPapeleta({ unidad: unit, plazaId: plaza, user: _user() });
    _showNueva = false;
    _openDetail(id);
  } catch (e) {
    if (e.code === 'ACTIVE_EXISTS' && e.existing?.id) {
      await _mexAlert('Papeleta activa', 'Ya existe una papeleta activa. Se abrirá la existente.');
      _showNueva = false;
      _openDetail(e.existing.id);
    } else {
      await _mexAlert('Error', e.message || String(e));
    }
  } finally {
    _busy = false;
  }
}
