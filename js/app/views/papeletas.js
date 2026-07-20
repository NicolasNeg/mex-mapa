// ═══════════════════════════════════════════════════════════
//  /js/app/views/papeletas.js — SPA Papeletas digitales (beta)
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza } from '/js/app/app-state.js';
import {
  ZONAS_V1,
  CHECKLIST_KEYS,
  CHECKLIST_LABELS,
  puedeEditar,
  puedeEntregar,
  allZonasHaveFoto,
  checklistCompleto,
  truncNota,
  rolPuedeGestionarVentas,
  rolPuedeCerrarCaso,
} from '/domain/papeleta.model.js';
import { STATUS_LABELS } from '/js/app/features/papeletas/papeletas-constants.js';
import {
  subscribePapeletasPlaza,
  subscribePapeleta,
  crearPapeleta,
  actualizarPapeleta,
  entregarPapeleta,
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
import { openPapeletaPdf } from '/js/app/features/papeletas/papeletas-pdf.js';
import {
  subscribeReportesAbiertos,
  crearReporte,
  newReporteId,
  promoverReporte,
  cerrarCaso,
  countReportesAbiertosUnidad,
} from '/js/app/features/papeletas/papeletas-reportes-data.js';
import { buscarUnidad } from '/js/app/features/unidades/unidades-data.js';

let _container = null;
let _navigate = null;
let _unsubs = [];
let _items = [];
let _reportes = [];
let _detail = null;
let _detailUnsub = null;
let _mode = 'list'; // list | detail | ventas
let _filter = 'activas';
let _query = '';
let _wizardStep = 'datos'; // datos | zonas | checklist | resumen | firma | entrada | reporte
let _zonaIdx = 0;
let _showNueva = false;
let _unitHits = [];
let _unitQ = '';
let _casoWarning = '';
let _busy = false;
let _sigDrawing = false;
let _fotoCache = new Map();

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

function _pathId() {
  const path = String(location.pathname || '');
  const m = path.match(/\/app\/papeletas\/([^/]+)/);
  if (!m) return '';
  if (m[1] === 'ventas') return '';
  return decodeURIComponent(m[1]);
}

function _isVentasPath() {
  return String(location.pathname || '').includes('/app/papeletas/ventas');
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

  if (_isVentasPath()) _mode = 'ventas';
  else if (_pathId()) _mode = 'detail';
  else _mode = 'list';

  _render();

  const plaza = String(getCurrentPlaza() || ctx?.state?.currentPlaza || '').toUpperCase();
  _unsubs.push(subscribePapeletasPlaza({
    plazaId: plaza,
    onData: (rows) => {
      _items = rows || [];
      if (_mode === 'list') _render();
    },
  }));

  if (_canVentas()) {
    _unsubs.push(subscribeReportesAbiertos({
      onData: (rows) => {
        _reportes = rows || [];
        if (_mode === 'ventas' || _mode === 'list') _render();
      },
    }));
  }

  const id = _pathId();
  if (id) _watchDetail(id);
}

export function unmount() {
  _cleanup();
  _container = null;
  _navigate = null;
  _fotoCache.clear();
}

function _watchDetail(id) {
  if (_detailUnsub) { try { _detailUnsub(); } catch (_) { /* ignore */ } }
  _detailUnsub = subscribePapeleta(id, {
    onData: (doc) => {
      _detail = doc;
      _mode = 'detail';
      _render();
    },
  });
}

function _gotoList() {
  _mode = 'list';
  _detail = null;
  if (_detailUnsub) { try { _detailUnsub(); } catch (_) { /* ignore */ } }
  _detailUnsub = null;
  _navigate?.('/app/papeletas', { replace: false });
  _render();
}

function _gotoVentas() {
  _mode = 'ventas';
  _navigate?.('/app/papeletas/ventas');
  _render();
}

function _openDetail(id) {
  _mode = 'detail';
  _wizardStep = 'datos';
  _navigate?.(`/app/papeletas/${id}`);
  _watchDetail(id);
}

function _render() {
  if (!_container) return;
  const canV = _canVentas();
  _container.innerHTML = `
    <div class="pap-module">
      <div class="pap-header">
        <h1><span class="material-symbols-outlined">description</span> Papeletas</h1>
        <div class="pap-tabs">
          <button type="button" class="pap-tab ${_mode !== 'ventas' ? 'is-active' : ''}" data-act="tab-list">Listado</button>
          ${canV ? `<button type="button" class="pap-tab ${_mode === 'ventas' ? 'is-active' : ''}" data-act="tab-ventas">Ventas</button>` : ''}
        </div>
      </div>
      ${_casoWarning ? `<div class="pap-banner"><span class="material-symbols-outlined">warning</span><div>${_esc(_casoWarning)}</div></div>` : ''}
      ${_mode === 'ventas' ? _renderVentas() : _mode === 'detail' ? _renderDetail() : _renderList()}
      ${_showNueva ? _renderNuevaModal() : ''}
    </div>
  `;
  _bind();
  if (_wizardStep === 'firma') _bindSignature();
  _hydrateFotos();
}

function _renderList() {
  const rows = _filteredItems();
  return `
    <div class="pap-toolbar">
      <input class="pap-search" id="papSearch" placeholder="Buscar MVA, placas, modelo, VIN, cliente…" value="${_esc(_query)}"/>
      <button type="button" class="pap-btn pap-btn--primary" data-act="nueva">
        <span class="material-symbols-outlined">add</span> Nueva
      </button>
    </div>
    <div class="pap-chips">
      ${['activas', 'entregadas', 'historial', 'ventas'].map((f) => `
        <button type="button" class="pap-chip ${_filter === f ? 'is-on' : ''}" data-act="filter" data-f="${f}">${f}</button>
      `).join('')}
    </div>
    ${rows.length ? `<div class="pap-grid">${rows.map(_cardHtml).join('')}</div>` : `<div class="pap-empty">No hay papeletas en este filtro.</div>`}
  `;
}

function _cardHtml(it) {
  return `
    <button type="button" class="pap-card" data-act="open" data-id="${_esc(it.id)}">
      <div class="pap-card__top">
        <span class="pap-card__mva">${_esc(it.mva || '—')}</span>
        <span class="pap-status pap-status--${_esc(it.status)}">${_esc(STATUS_LABELS[it.status] || it.status)}</span>
      </div>
      <div class="pap-card__meta">${_esc(it.modelo || '')} · ${_esc(it.placas || '')}</div>
      <div class="pap-card__meta">${_esc(it.clienteNombre || 'Sin cliente')} · ${_esc(it.plazaId || '')}</div>
      <div class="pap-card__meta">${_fotosCount(it)}/12 fotos</div>
    </button>
  `;
}

function _renderDetail() {
  if (!_detail) return `<div class="pap-empty">Cargando…</div>`;
  const p = _detail;
  const editable = puedeEditar(p.status);
  const steps = [
    ['datos', 'Datos'],
    ['zonas', 'Zonas'],
    ['checklist', 'Checklist'],
    ['resumen', 'Resumen'],
  ];
  if (p.status === 'entregada' || p.status === 'en_retorno') {
    steps.push(['entrada', 'Entrada']);
    steps.push(['reporte', 'Reporte']);
  }

  return `
    <div class="pap-detail">
      <div class="pap-toolbar">
        <button type="button" class="pap-btn pap-btn--ghost" data-act="back">
          <span class="material-symbols-outlined">arrow_back</span> Volver
        </button>
        <span class="pap-status pap-status--${_esc(p.status)}">${_esc(STATUS_LABELS[p.status] || p.status)}</span>
        ${!editable ? '<span class="pap-card__meta">Edición bloqueada</span>' : ''}
      </div>
      <div class="pap-steps">
        ${steps.map(([id, label]) => `
          <button type="button" class="pap-step ${_wizardStep === id ? 'is-active' : ''}" data-act="step" data-step="${id}">${label}</button>
        `).join('')}
      </div>
      ${_wizardStep === 'datos' ? _panelDatos(p, editable) : ''}
      ${_wizardStep === 'zonas' ? _panelZonas(p, editable) : ''}
      ${_wizardStep === 'checklist' ? _panelChecklist(p, editable) : ''}
      ${_wizardStep === 'resumen' ? _panelResumen(p, editable) : ''}
      ${_wizardStep === 'firma' ? _panelFirma(p) : ''}
      ${_wizardStep === 'entrada' ? _panelEntrada(p) : ''}
      ${_wizardStep === 'reporte' ? _panelReporte(p) : ''}
    </div>
  `;
}

function _panelDatos(p, editable) {
  return `
    <div class="pap-panel">
      <h2>Datos de unidad</h2>
      ${['mva', 'modelo', 'placas', 'color', 'vin'].map((k) => `
        <div class="pap-field">
          <label>${k.toUpperCase()}</label>
          <input data-field="${k}" value="${_esc(p[k] || '')}" ${editable ? '' : 'disabled'}/>
        </div>
      `).join('')}
      ${_canVentas() ? `
        <div class="pap-field">
          <label>Cliente (Ventas)</label>
          <input data-field="clienteNombre" value="${_esc(p.clienteNombre || '')}"/>
        </div>
      ` : `
        <div class="pap-field">
          <label>Cliente</label>
          <input value="${_esc(p.clienteNombre || '—')}" disabled/>
        </div>
      `}
      ${editable || _canVentas() ? `
        <div class="pap-actions">
          <button type="button" class="pap-btn pap-btn--primary" data-act="save-datos" ${_busy ? 'disabled' : ''}>Guardar</button>
        </div>
      ` : ''}
    </div>
  `;
}

function _panelZonas(p, editable) {
  const z = ZONAS_V1[_zonaIdx] || ZONAS_V1[0];
  const data = p.zonas?.[z.id] || { estado: 'ok', nota: '', fotoPath: '' };
  const n = _fotosCount(p);
  return `
    <div class="pap-panel">
      <div class="pap-zona-nav">
        <button type="button" class="pap-btn pap-btn--ghost" data-act="zona-prev" ${_zonaIdx <= 0 ? 'disabled' : ''}>Anterior</button>
        <div class="pap-progress">${_zonaIdx + 1}/12 · ${_esc(z.label)} · ${n}/12 fotos</div>
        <button type="button" class="pap-btn pap-btn--ghost" data-act="zona-next" ${_zonaIdx >= 11 ? 'disabled' : ''}>Siguiente</button>
      </div>
      <div class="pap-field">
        <label>Estado</label>
        <select data-zona-estado ${editable ? '' : 'disabled'}>
          <option value="ok" ${data.estado === 'ok' ? 'selected' : ''}>OK</option>
          <option value="dano" ${data.estado === 'dano' ? 'selected' : ''}>Daño</option>
        </select>
      </div>
      <div class="pap-field">
        <label>Nota (máx. 40)</label>
        <input data-zona-nota maxlength="40" value="${_esc(data.nota || '')}" ${editable ? '' : 'disabled'}/>
      </div>
      <div class="pap-field">
        <label>Foto obligatoria</label>
        <input type="file" accept="image/*" capture="environment" data-zona-foto ${editable ? '' : 'disabled'}/>
        <div class="pap-card__meta" data-foto-status>${data.fotoPath ? 'Foto cargada' : 'Sin foto'}</div>
        <img data-zona-preview alt="" style="display:none;max-width:100%;margin-top:8px;border-radius:8px"/>
      </div>
      ${data.estado === 'dano' ? `
        <div class="pap-field">
          <label>Foto detalle (opcional)</label>
          <input type="file" accept="image/*" capture="environment" data-zona-detalle ${editable ? '' : 'disabled'}/>
        </div>
      ` : ''}
      ${editable ? `
        <div class="pap-actions">
          <button type="button" class="pap-btn pap-btn--primary" data-act="save-zona" ${_busy ? 'disabled' : ''}>Guardar zona</button>
        </div>
      ` : ''}
    </div>
  `;
}

function _panelChecklist(p, editable) {
  return `
    <div class="pap-panel">
      <h2>Checklist de accesorios</h2>
      <div class="pap-check-grid">
        ${CHECKLIST_KEYS.map((k) => `
          <div class="pap-check-item">
            <div>${_esc(CHECKLIST_LABELS[k] || k)}</div>
            <select data-check="${k}" ${editable ? '' : 'disabled'}>
              <option value="">—</option>
              <option value="ok" ${p.checklist?.[k] === 'ok' ? 'selected' : ''}>Presente</option>
              <option value="faltante" ${p.checklist?.[k] === 'faltante' ? 'selected' : ''}>Faltante</option>
              <option value="na" ${p.checklist?.[k] === 'na' ? 'selected' : ''}>N/A</option>
            </select>
          </div>
        `).join('')}
      </div>
      ${editable ? `
        <div class="pap-actions">
          <button type="button" class="pap-btn pap-btn--primary" data-act="save-check" ${_busy ? 'disabled' : ''}>Guardar checklist</button>
        </div>
      ` : ''}
    </div>
  `;
}

function _panelResumen(p) {
  const ready = puedeEntregar(p.status, p.zonas, p.checklist);
  const fotosOk = allZonasHaveFoto(p.zonas);
  const checkOk = checklistCompleto(p.checklist);
  return `
    <div class="pap-panel">
      <h2>Resumen</h2>
      <p class="pap-card__meta">Fotos: ${fotosOk ? '12/12 ✓' : `${_fotosCount(p)}/12`} · Checklist: ${checkOk ? 'completo ✓' : 'incompleto'} · Estado: ${_esc(STATUS_LABELS[p.status] || p.status)}</p>
      <p><b>ENTREGAR A ${_esc(p.clienteNombre || '(sin cliente)')}</b></p>
      <div class="pap-field">
        <label>KM salida</label>
        <input id="papKmSalida" type="number" value="${_esc(p.salida?.km ?? '')}" ${p.status === 'lista' ? '' : 'disabled'}/>
      </div>
      <div class="pap-field">
        <label>Gas salida</label>
        <input id="papGasSalida" value="${_esc(p.salida?.gas ?? '')}" ${p.status === 'lista' ? '' : 'disabled'}/>
      </div>
      <div class="pap-actions">
        ${p.status === 'lista' ? `
          <button type="button" class="pap-btn pap-btn--primary" data-act="start-entregar" ${ready && !_busy ? '' : 'disabled'}>
            Entregar unidad
          </button>
        ` : ''}
        ${p.status === 'entregada' || p.status === 'en_retorno' ? `
          <button type="button" class="pap-btn pap-btn--ghost" data-act="pdf">Descargar / imprimir PDF</button>
        ` : ''}
        ${p.status === 'entregada' ? `
          <button type="button" class="pap-btn pap-btn--primary" data-act="goto-entrada">Registrar entrada</button>
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

function _panelEntrada(p) {
  const locked = p.status === 'en_retorno' || p.status === 'cerrada_historial';
  return `
    <div class="pap-panel">
      <h2>Registrar entrada</h2>
      <div class="pap-photos" id="papCompare"></div>
      <div class="pap-field"><label>Quién recibe</label><input id="papQuienRecibe" value="${_esc(p.entrada?.quienRecibe || _user().nombre)}" ${locked ? 'disabled' : ''}/></div>
      <div class="pap-field"><label>KM entrada</label><input id="papKmIn" type="number" value="${_esc(p.entrada?.km ?? '')}" ${locked ? 'disabled' : ''}/></div>
      <div class="pap-field"><label>Gas entrada</label><input id="papGasIn" value="${_esc(p.entrada?.gas ?? '')}" ${locked ? 'disabled' : ''}/></div>
      <div class="pap-field"><label>Notas</label><textarea id="papNotasIn" rows="3" ${locked ? 'disabled' : ''}>${_esc(p.entrada?.notas || '')}</textarea></div>
      ${!locked ? `
        <div class="pap-actions">
          <button type="button" class="pap-btn pap-btn--primary" data-act="save-entrada" ${_busy ? 'disabled' : ''}>Registrar entrada</button>
        </div>
      ` : `<p class="pap-card__meta">Entrada registrada · unidad liberada para nueva papeleta</p>`}
    </div>
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

function _renderNuevaModal() {
  return `
    <div class="pap-modal-backdrop" data-act="close-modal">
      <div class="pap-modal" data-stop>
        <h2>Nueva papeleta</h2>
        <div class="pap-field">
          <label>Buscar unidad</label>
          <input id="papUnitQ" class="pap-search" placeholder="MVA / placas / VIN" value="${_esc(_unitQ)}"/>
        </div>
        <div id="papUnitHits">
          ${_unitHits.map((u) => `
            <button type="button" class="pap-unit-hit" data-act="pick-unit" data-id="${_esc(u.id)}">
              <b>${_esc(u.mva || '—')}</b> · ${_esc(u.modelo || '')} · ${_esc(u.placas || '')}
            </button>
          `).join('') || '<div class="pap-card__meta">Escribe para buscar…</div>'}
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
    _showNueva = true;
    _unitHits = [];
    _unitQ = '';
    _render();
  });
  root.querySelector('#papSearch')?.addEventListener('input', (e) => {
    _query = e.target.value;
    _render();
    const el = _container.querySelector('#papSearch');
    if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
  });
  root.querySelectorAll('[data-act="filter"]').forEach((btn) => {
    btn.addEventListener('click', () => { _filter = btn.dataset.f; _render(); });
  });
  root.querySelectorAll('[data-act="open"]').forEach((btn) => {
    btn.addEventListener('click', () => _openDetail(btn.dataset.id));
  });
  root.querySelector('[data-act="back"]')?.addEventListener('click', () => _gotoList());
  root.querySelectorAll('[data-act="step"]').forEach((btn) => {
    btn.addEventListener('click', () => { _wizardStep = btn.dataset.step; _render(); });
  });
  root.querySelector('[data-act="zona-prev"]')?.addEventListener('click', () => {
    _zonaIdx = Math.max(0, _zonaIdx - 1); _render();
  });
  root.querySelector('[data-act="zona-next"]')?.addEventListener('click', () => {
    _zonaIdx = Math.min(11, _zonaIdx + 1); _render();
  });
  root.querySelector('[data-act="save-datos"]')?.addEventListener('click', () => _saveDatos());
  root.querySelector('[data-act="save-zona"]')?.addEventListener('click', () => _saveZona());
  root.querySelector('[data-act="save-check"]')?.addEventListener('click', () => _saveCheck());
  root.querySelector('[data-act="start-entregar"]')?.addEventListener('click', () => _startEntregar());
  root.querySelector('[data-act="sig-clear"]')?.addEventListener('click', () => _clearSig());
  root.querySelector('[data-act="sig-confirm"]')?.addEventListener('click', () => _confirmFirma());
  root.querySelector('[data-act="pdf"]')?.addEventListener('click', () => _doPdf());
  root.querySelector('[data-act="goto-entrada"]')?.addEventListener('click', () => {
    _wizardStep = 'entrada'; _render();
  });
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
  root.querySelector('#papUnitQ')?.addEventListener('input', async (e) => {
    _unitQ = e.target.value;
    try { _unitHits = await buscarUnidad(_unitQ); } catch (_) { _unitHits = []; }
    _render();
    const el = _container.querySelector('#papUnitQ');
    if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
  });
  root.querySelectorAll('[data-act="pick-unit"]').forEach((btn) => {
    btn.addEventListener('click', () => _crearDesdeUnidad(btn.dataset.id));
  });
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
  if (compare && (_wizardStep === 'entrada')) {
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
}

async function _saveDatos() {
  if (!_detail) return;
  const patch = {};
  _container.querySelectorAll('[data-field]').forEach((el) => {
    patch[el.dataset.field] = el.value.trim();
  });
  _busy = true; _render();
  try {
    if (patch.clienteNombre != null && _canVentas()) {
      await asignarCliente(_detail.id, patch.clienteNombre, { user: _user() });
      delete patch.clienteNombre;
    }
    if (puedeEditar(_detail.status) && Object.keys(patch).length) {
      await actualizarPapeleta(_detail.id, patch, { user: _user() });
    }
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
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
    if (!cur.fotoPath) throw new Error('La foto de la zona es obligatoria');
    zonas[z.id] = cur;
    await actualizarPapeleta(_detail.id, { zonas }, { user: _user() });
    if (_zonaIdx < 11) _zonaIdx += 1;
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
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _startEntregar() {
  if (!_detail) return;
  if (!_detail.clienteNombre) {
    const ok = await _mexConfirm('Sin cliente asignado', 'Sin cliente asignado — ¿continuar?', 'warning');
    if (!ok) return;
  }
  _wizardStep = 'firma';
  _render();
}

function _bindSignature() {
  const canvas = _container?.querySelector('#papSig');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

async function _confirmFirma() {
  if (!_detail) return;
  const canvas = _container?.querySelector('#papSig');
  if (!canvas) return;
  _busy = true; _render();
  try {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Firma vacía');
    const firmaPath = await uploadFirma(_detail.id, blob);
    const km = _container.querySelector('#papKmSalida')?.value;
    const gas = _container.querySelector('#papGasSalida')?.value;
    await entregarPapeleta(_detail.id, {
      quienEntrega: _user().nombre,
      km: km === '' ? null : Number(km),
      gas: gas || null,
      firmaPath,
      user: _user(),
    });
    const firmaUrl = await getDownloadUrl(firmaPath);
    const updated = { ..._detail, status: 'entregada', salida: { ...(_detail.salida || {}), firmaPath, km, gas } };
    openPapeletaPdf(updated, { firmaUrl });
    _wizardStep = 'resumen';
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _doPdf() {
  if (!_detail) return;
  const firmaUrl = await getDownloadUrl(_detail.salida?.firmaPath);
  openPapeletaPdf(_detail, { firmaUrl });
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
