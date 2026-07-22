// ═══════════════════════════════════════════════════════════
//  /js/app/views/papeletas.js — SPA Papeletas digitales (beta)
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza } from '/js/app/app-state.js';
import {
  ZONAS_V1,
  ZONAS_CORE,
  ZONA_CORE_LABELS,
  CHECKLIST_KEYS,
  CHECKLIST_LABELS,
  LLANTA_KEYS,
  LLANTA_LABELS,
  DAMAGE_TYPES,
  DAMAGE_TYPE_LABELS,
  DAMAGE_SEVERITIES,
  DAMAGE_SEVERITY_LABELS,
  DAMAGE_PHOTO_POLICY,
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
  kmTableroRetakeNeeded,
  createDamageMark,
  nextDisplayNumber,
  buildEntradaDamageComparison,
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
  cancelarPapeleta,
} from '/js/app/features/papeletas/papeletas-data.js';
import {
  uploadZonaFoto,
  uploadZonaDetalle,
  uploadFirma,
  uploadReporteFoto,
  uploadDamageFoto,
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
import { mountDiagram } from '/js/app/features/papeletas/papeletas-diagram.js';
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
let _wizardStep = 'datos'; // datos | km_gas | checklist | danos | fotos_firma | firma | entrada | salida | reporte
let _step6Phase = 'fotos'; // fotos | resumen | firma | exito (inside fotos_firma)
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
let _sigStrokePoints = 0;
let _pendingSalida = { km: null, gas: null };
let _fotoCache = new Map();
let _diagramApi = null;
/** Readonly preview mounts (salida / regreso) — separate from editable daños step. */
let _readonlyDiagramApis = [];
let _localStrokes = null;
let _captureScrollTop = 0;
let _activeCaptureSec = 'datos';
let _cameraApi = null;
let _saveState = 'idle'; // idle | saving | saved | conflict
/** Local draft for regreso comparison — never mutates salida.danosMarcados */
let _entradaCompareDraft = [];
/** v3 híbrido: pantalla activa en móvil (datos|diagrama|fotos|resumen|firma) */
let _mobileScreen = 'datos';
/** Unidad elegida en buscador — hero confirma antes de crear */
let _pendingUnit = null;
let _heroEditing = false;
let _mqMobile = null;

const LIST_ROUTE = '/app/papeletas';
const VENTAS_ROUTE = '/app/reportes-danos';
const DETAIL_PREFIX = '/app/papeletas/p/';
const MOBILE_BP = 900;

/** Stack móvil v3: ids de pantalla → secciones desktop equivalentes */
const MOBILE_SCREENS = Object.freeze([
  { id: 'datos', label: 'Datos', secs: ['datos', 'km_gas', 'checklist'] },
  { id: 'diagrama', label: 'Diagrama', secs: ['danos'] },
  { id: 'fotos', label: 'Fotos', secs: ['fotos'] },
  { id: 'resumen', label: 'Resumen', secs: ['entregar'] },
  { id: 'firma', label: 'Firma', secs: ['firma'] },
]);

function _isMobileCapture() {
  try {
    return window.matchMedia(`(max-width: ${MOBILE_BP - 1}px)`).matches;
  } catch {
    return false;
  }
}

/** Imagen del modelo desde catálogo Admin → Modelos (mismo patrón que cuadre ventas). */
function _modelImageUrl(modelo) {
  const name = String(modelo || '').trim().toUpperCase();
  if (!name || name === 'S/M') return '';
  const catalog = window.MEX_CONFIG?.listas?.modelos || [];
  let best = null;
  for (const item of catalog) {
    if (!item || typeof item !== 'object') continue;
    const itemName = String(item.nombre || '').trim().toUpperCase();
    if (!itemName) continue;
    if (itemName === name) { best = item; break; }
    if (!best && (name.includes(itemName) || itemName.includes(name.split(' ')[0]))) best = item;
  }
  if (!best) return '';
  return String(best.imagenURL || best.imagen || best.image || best.foto || '').trim();
}

function _screenForSec(secId) {
  const hit = MOBILE_SCREENS.find((s) => s.secs.includes(secId));
  return hit?.id || 'datos';
}

function _gotoMobileScreen(id) {
  const next = MOBILE_SCREENS.some((s) => s.id === id) ? id : 'datos';
  _mobileScreen = next;
  const firstSec = MOBILE_SCREENS.find((s) => s.id === next)?.secs?.[0] || 'datos';
  _activeCaptureSec = firstSec;
  if (_isMobileCapture()) _render();
  else _jumpToSec(firstSec);
}

const FILTER_LABELS = Object.freeze({
  activas: 'En curso',
  entregadas: 'Entregadas',
  historial: 'Historial',
  ventas: 'Con reporte',
  canceladas: 'Canceladas',
});

const FIELD_LABELS = Object.freeze({
  mva: 'Económico (MVA)',
  modelo: 'Modelo',
  placas: 'Placas',
  color: 'Color',
  vin: 'VIN / Serie',
});

/** 6-step salida flow (step 1 = /nueva). */
const SALIDA_STEPS = Object.freeze([
  { id: 'unidad', label: 'Unidad', n: 1 },
  { id: 'datos', label: 'Datos', n: 2 },
  { id: 'km_gas', label: 'KM y gas', n: 3 },
  { id: 'checklist', label: 'Checklist', n: 4 },
  { id: 'danos', label: 'Daños', n: 5 },
  { id: 'fotos_firma', label: 'Fotos y firma', n: 6 },
]);

const SALIDA_STEP_IDS = Object.freeze(
  SALIDA_STEPS.filter((s) => s.id !== 'unidad').map((s) => s.id)
);

const STEP_LABELS = Object.freeze({
  datos: 'Datos',
  km_gas: 'KM y gas',
  checklist: 'Checklist',
  danos: 'Daños',
  fotos_firma: 'Fotos y firma',
  zonas: 'Fotos',
  resumen: 'Entregar',
  firma: 'Firma',
  salida: 'Salida',
  entrada: 'Regreso',
  reporte: 'Reportes',
});

const NEW_ROUTE = '/app/papeletas/nueva';

const POST_ENTREGA = new Set(['entregada', 'en_retorno', 'cerrada_historial']);

function _isPostEntrega(status) {
  return POST_ENTREGA.has(String(status || ''));
}

function _salidaStepMeta(stepId) {
  return SALIDA_STEPS.find((s) => s.id === stepId) || SALIDA_STEPS[1];
}

function _defaultStepFor(p) {
  if (!p) return 'datos';
  if (p.status === 'entregada' || p.status === 'en_retorno') return 'entrada';
  if (p.status === 'cerrada_historial') return 'salida';
  _step6Phase = 'fotos';
  return 'datos';
}

function _normalizeWizardStep(step) {
  if (step === 'zonas') return 'fotos_firma';
  if (step === 'resumen') {
    _step6Phase = 'resumen';
    return 'fotos_firma';
  }
  if (step === 'firma') {
    _step6Phase = 'firma';
    return 'fotos_firma';
  }
  return step;
}

/** Exact order from Panel Admin → Gasolinas (MEX_CONFIG.listas.gasolinas). Do not re-sort. */
const _GAS_FALLBACK = [
  'F', '15/16', '7/8', '13/16', '3/4', '11/16', '5/8', '9/16',
  'H', '7/16', '3/8', '5/16', '1/4', '3/16', '1/8', '1/16', 'E', 'N/A',
];

function _gasCatalog() {
  const configured = Array.isArray(window.MEX_CONFIG?.listas?.gasolinas)
    ? window.MEX_CONFIG.listas.gasolinas
    : [];
  const values = configured
    .map((item) => String((item && typeof item === 'object' ? (item.nombre ?? item.valor ?? item.id ?? '') : item) || '').trim().toUpperCase())
    .filter(Boolean);
  const base = values.length ? values : _GAS_FALLBACK.slice();
  const out = [];
  const seen = new Set();
  for (const v of base) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  if (!seen.has('N/A')) out.push('N/A');
  return out;
}

function _gasOptionsHtml(selected) {
  const safe = String(selected || '').trim().toUpperCase();
  const opts = _gasCatalog();
  if (safe && !opts.includes(safe)) opts.unshift(safe);
  return opts.map((v) => `<option value="${_esc(v)}" ${safe === v ? 'selected' : ''}>${_esc(v)}</option>`).join('');
}

function _gasChipsHtml(selected, inputId, disabled) {
  const safe = String(selected || '').trim().toUpperCase();
  // Same global order as selects / mapa — never reorder preferred vs rest.
  const opts = _gasCatalog().slice();
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

function _saveChipLabel() {
  if (_saveState === 'saving') return 'Guardando…';
  if (_saveState === 'saved') return 'Guardado';
  if (_saveState === 'conflict') return 'Conflicto';
  return '';
}

function _flowHeaderHtml(stepId) {
  const step = _salidaStepMeta(stepId);
  const chip = _saveChipLabel();
  return `
    <header class="pap-flow-header">
      <button type="button" class="pap-icon-btn" data-act="flow-back" aria-label="Atrás">
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <div class="pap-flow-header__mid">
        <strong>${_esc(step.label)}</strong>
        <span>${step.n} de 6</span>
      </div>
      <span class="pap-save-chip ${_saveState !== 'idle' ? 'is-on' : ''}" data-save-chip>${_esc(chip)}</span>
    </header>`;
}

function _flowFooterHtml({ canContinue = true, continueLabel = 'Continuar' } = {}) {
  return `
    <footer class="pap-flow-footer">
      <button type="button" class="pap-btn pap-btn--ghost" data-act="flow-back">Atrás</button>
      <button type="button" class="pap-btn pap-btn--primary" data-act="flow-next" ${canContinue && !_busy ? '' : 'disabled'}>${_esc(continueLabel)}</button>
    </footer>`;
}

const CAPTURE_SECS = Object.freeze([
  { id: 'datos', label: 'Datos' },
  { id: 'km_gas', label: 'KM' },
  { id: 'checklist', label: 'Check' },
  { id: 'danos', label: 'Daños' },
  { id: 'fotos', label: 'Fotos' },
  { id: 'entregar', label: 'Entregar' },
  { id: 'firma', label: 'Firma' },
]);

function _captureHeaderHtml(p) {
  const chip = _saveChipLabel();
  const plaza = p.ultimaPlazaId || p.plazaId || '';
  return `
    <header class="pap-capture-header">
      <button type="button" class="pap-icon-btn" data-act="flow-back" aria-label="Salir">
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <div class="pap-capture-header__mid">
        <strong>${_esc(p.mva || 'Papeleta')}</strong>
        <span>${_esc(p.modelo || '')}${plaza ? ` · ${_esc(plaza)}` : ''}</span>
      </div>
      <span class="pap-save-chip ${_saveState !== 'idle' ? 'is-on' : ''}" data-save-chip>${_esc(chip)}</span>
      <button type="button" class="pap-icon-btn" data-act="pdf" aria-label="PDF" title="PDF">
        <span class="material-symbols-outlined">picture_as_pdf</span>
      </button>
    </header>`;
}

function _captureChipsHtml(p) {
  const gate = _deliveryGate(p, { firma: p.salida?.firma || null });
  const softSet = new Set(gate.soft || []);
  const hardSet = new Set(gate.hard || []);
  const mobile = _isMobileCapture();
  const warnForSec = (id) => {
    if (id === 'km_gas' && (hardSet.has('km') || hardSet.has('gas') || hardSet.has('km_justification') || hardSet.has('tablero_photo'))) return true;
    if (id === 'checklist' && hardSet.has('checklist')) return true;
    if (id === 'fotos' && hardSet.has('core_photos')) return true;
    if (id === 'firma' && hardSet.has('firma')) return true;
    if (id === 'entregar' && softSet.has('cliente')) return true;
    return false;
  };
  const warnForScreen = (screen) => (screen.secs || []).some((sec) => warnForSec(sec));
  if (mobile) {
    return `
      <nav class="pap-sec-chips pap-sec-chips--mobile" role="tablist" aria-label="Pantallas">
        ${MOBILE_SCREENS.map((s) => `
          <button type="button" class="pap-sec-chip ${_mobileScreen === s.id ? 'is-active' : ''} ${warnForScreen(s) ? 'is-warn' : ''}"
            data-act="jump-screen" data-screen="${s.id}" role="tab">${_esc(s.label)}</button>
        `).join('')}
      </nav>`;
  }
  return `
    <nav class="pap-sec-chips" role="tablist" aria-label="Secciones">
      ${CAPTURE_SECS.map((s) => `
        <button type="button" class="pap-sec-chip ${_activeCaptureSec === s.id ? 'is-active' : ''} ${warnForSec(s.id) ? 'is-warn' : ''}"
          data-act="jump-sec" data-sec="${s.id}" role="tab">${_esc(s.label)}</button>
      `).join('')}
    </nav>`;
}

function _captureFooterHtml(p) {
  const gate = _deliveryGate(p, { firma: p.salida?.firma || null });
  const hardSansFirma = (gate.hard || []).filter((h) => h !== 'firma');
  const canEntregar = puedeEditar(p.status) && hardSansFirma.length === 0;
  return `
    <footer class="pap-capture-footer">
      <button type="button" class="pap-btn pap-btn--ghost" data-act="next-gap" ${_busy ? 'disabled' : ''}>
        Siguiente hueco
      </button>
      <button type="button" class="pap-btn pap-btn--primary" data-act="capture-entregar" ${canEntregar && !_busy ? '' : 'disabled'}
        title="${hardSansFirma.length ? `Falta: ${hardSansFirma.join(', ')}` : 'Revisar y firmar'}">
        Entregar
      </button>
    </footer>`;
}

function _firstHardSec(p) {
  const gate = _deliveryGate(p, { firma: p.salida?.firma || null });
  const hard = gate.hard || [];
  if (hard.includes('km') || hard.includes('gas') || hard.includes('km_justification')) return 'km_gas';
  if (hard.includes('checklist')) return 'checklist';
  if (hard.includes('core_photos')) return 'fotos';
  if (hard.includes('firma')) return 'firma';
  if ((gate.soft || []).includes('cliente')) return 'datos';
  return 'entregar';
}

function _jumpToSec(secId) {
  const id = String(secId || 'datos');
  _activeCaptureSec = id;
  _mobileScreen = _screenForSec(id);
  if (_isMobileCapture()) {
    _render();
    return;
  }
  const el = _container?.querySelector(`#pap-sec-${id}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  _container?.querySelectorAll('.pap-sec-chip').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.sec === id);
  });
}

function _bindCaptureScrollSpy() {
  if (_isMobileCapture()) return;
  const scroller = _container?.querySelector('#papCaptureScroll');
  if (!scroller || scroller.dataset.spyBound === '1') return;
  scroller.dataset.spyBound = '1';
  let ticking = false;
  scroller.addEventListener('scroll', () => {
    _captureScrollTop = scroller.scrollTop;
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const secs = CAPTURE_SECS.map((s) => _container?.querySelector(`#pap-sec-${s.id}`)).filter(Boolean);
      let active = CAPTURE_SECS[0]?.id || 'datos';
      const top = scroller.scrollTop + 130;
      for (const el of secs) {
        if (el.offsetTop <= top) active = el.id.replace('pap-sec-', '');
      }
      if (active !== _activeCaptureSec) {
        _activeCaptureSec = active;
        _container?.querySelectorAll('.pap-sec-chip').forEach((btn) => {
          btn.classList.toggle('is-active', btn.dataset.sec === active);
        });
      }
    });
  }, { passive: true });
}

async function _captureEntregar() {
  if (!_detail || !puedeEditar(_detail.status)) return;
  try {
    await _saveStepDatos();
    const kmOk = await _saveStepKmGas();
    if (!kmOk) {
      _jumpToSec('km_gas');
      return;
    }
    const checkOk = await _saveCheckCapture();
    if (!checkOk) {
      _jumpToSec('checklist');
      return;
    }
    await _saveDanosQuiet();
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
    return;
  }
  const gate = _deliveryGate(_detail, { firma: _detail.salida?.firma || null });
  const hardSansFirma = (gate.hard || []).filter((h) => h !== 'firma');
  if (hardSansFirma.length) {
    _jumpToSec(_firstHardSec(_detail));
    await _mexAlert('Falta completar', `Completa: ${hardSansFirma.join(', ')}`);
    return;
  }
  if ((gate.soft || []).length) {
    const ok = await _mexConfirm(
      'Avisos',
      `Hay avisos: ${(gate.soft || []).join(', ')}. ¿Continuar a firma?`,
      'warning'
    );
    if (!ok) return;
  }
  _jumpToSec('firma');
  _step6Phase = 'firma';
  _bindSignature();
}

async function _saveCheckCapture() {
  if (!_detail || !puedeEditar(_detail.status)) return false;
  const checklist = { ...(_detail.checklist || {}) };
  CHECKLIST_KEYS.forEach((k) => {
    if (checklist[k] == null) checklist[k] = _detail.checklist?.[k] || '';
  });
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
  const tapetesUsoRudo = tapetesUsoRudoRaw === '' ? null : Number(String(tapetesUsoRudoRaw).replace(/\D+/g, '').slice(0, 1));
  const tapetesAlfombra = tapetesAlfombraRaw === '' ? null : Number(String(tapetesAlfombraRaw).replace(/\D+/g, '').slice(0, 1));
  const notasInteriores = _container.querySelector('[data-field="notasInteriores"]')?.value?.trim() || '';

  if (!isChecklistComplete({
    checklist,
    marcasLlantas,
    tapetesUsoRudo,
    tapetesAlfombra,
  })) {
    await _mexAlert('Checklist incompleto', 'Marca todos los accesorios, las 4 llantas y tapetes (0–9; 0 = no tiene).');
    return false;
  }

  _saveState = 'saving';
  try {
    await actualizarPapeleta(_detail.id, {
      checklist,
      marcasLlantas,
      tapetesUsoRudo: Number.isFinite(tapetesUsoRudo) ? tapetesUsoRudo : null,
      tapetesAlfombra: Number.isFinite(tapetesAlfombra) ? tapetesAlfombra : null,
      notasInteriores,
    }, { user: _user(), knownRevision: _detail.revision, plazaId: String(getCurrentPlaza() || '') });
    _saveState = 'saved';
    return true;
  } catch (e) {
    _saveState = e?.code === 'REVISION_CONFLICT' ? 'conflict' : 'idle';
    throw e;
  }
}

async function _saveDanosQuiet() {
  if (!_detail || !puedeEditar(_detail.status)) return;
  if (!_diagramApi && !_localStrokes && !(_detail.danosMarcados || []).length) return;
  const strokes = _diagramApi ? _diagramApi.getStrokes() : (_localStrokes || _detail.diagramaStrokes || []);
  const danos = _diagramApi?.getDamages
    ? _diagramApi.getDamages()
    : (Array.isArray(_detail.danosMarcados) ? _detail.danosMarcados : []);
  _localStrokes = strokes;
  try {
    await actualizarPapeleta(_detail.id, {
      diagramaStrokes: strokes,
      danosMarcados: danos,
      danosLastDisplayNumber: Number(_detail.danosLastDisplayNumber) || nextDisplayNumber(danos, 0) - 1,
    }, { user: _user(), knownRevision: _detail.revision, plazaId: String(getCurrentPlaza() || '') });
    _saveState = 'saved';
  } catch (e) {
    _saveState = e?.code === 'REVISION_CONFLICT' ? 'conflict' : 'idle';
    throw e;
  }
}

function _destroyDiagram() {
  if (_diagramApi) {
    try { _diagramApi.destroy(); } catch (_) { /* ignore */ }
  }
  _diagramApi = null;
}

function _destroyReadonlyDiagrams() {
  for (const api of _readonlyDiagramApis) {
    try { api?.destroy?.(); } catch (_) { /* ignore */ }
  }
  _readonlyDiagramApis = [];
}

/** Persist mount: reuse live diagram host across capture re-renders. */
function _mountDiagramIfNeeded(p, editable) {
  const host = _container?.querySelector('[data-diagram-host]');
  if (!host) {
    _destroyDiagram();
    return;
  }
  const strokes = Array.isArray(_localStrokes)
    ? _localStrokes
    : (Array.isArray(p?.diagramaStrokes) ? p.diagramaStrokes : []);
  const danos = Array.isArray(p?.danosMarcados) ? p.danosMarcados : [];

  if (_diagramApi && host.dataset.diagramAlive === '1') {
    try {
      if (_diagramApi.setStrokes) _diagramApi.setStrokes(strokes);
      if (_diagramApi.setDamages) _diagramApi.setDamages(danos);
      _diagramApi.resize?.();
      return;
    } catch (_) {
      _destroyDiagram();
    }
  }

  _destroyDiagram();
  _diagramApi = mountDiagram(host, {
    strokes,
    danosMarcados: danos,
    editable: !!editable,
    view: 'top',
    fullscreen: _isMobileCapture(),
    onChange: (next) => {
      _localStrokes = next;
      if (_detail) _detail.diagramaStrokes = next;
    },
    onTap: editable ? (payload) => { void _addDamageFromTap(payload); } : undefined,
    zonePreview: (zonaId) => {
      const label = ZONA_CORE_LABELS[zonaId] || zonaId;
      const path = String(_detail?.zonas?.[zonaId]?.fotoPath || '').trim();
      const url = path && !path.startsWith('pending:') ? (_fotoCache.get(path) || '') : '';
      if (path && !url) {
        getDownloadUrl(path).then((u) => { _fotoCache.set(path, u); }).catch(() => {});
      }
      return { label, url };
    },
    onZoneHover: () => { /* preview DOM handled inside diagram */ },
  });
  host.dataset.diagramAlive = '1';
}

/**
 * Mount the same car-drawable diagram used in daños step, read-only,
 * so salida/regreso previews show silhouette + marks aligned (not floating on white).
 */
function _mountReadonlyDiagrams(p) {
  _destroyReadonlyDiagrams();
  const hosts = _container?.querySelectorAll('[data-diagram-ro-host]') || [];
  const strokes = Array.isArray(p?.diagramaStrokes) ? p.diagramaStrokes : [];
  const danos = Array.isArray(p?.danosMarcados) ? p.danosMarcados : [];
  hosts.forEach((host) => {
    const compact = host.hasAttribute('data-diagram-compact');
    const api = mountDiagram(host, {
      strokes,
      danosMarcados: danos,
      editable: false,
      view: 'top',
      title: 'Diagrama · salida',
      showLegend: !compact,
      showMarksList: !compact,
    });
    if (api) _readonlyDiagramApis.push(api);
  });
}

async function _addDamageFromTap({ x, y, view }) {
  if (!_detail || !puedeEditar(_detail.status)) return;
  const result = await _openDamageSheet({ x, y, view: view || 'top' });
  if (!result) return;

  const existing = Array.isArray(_detail.danosMarcados) ? _detail.danosMarcados.slice() : [];
  const lastAssigned = Number(_detail.danosLastDisplayNumber) || 0;
  const num = nextDisplayNumber(existing, lastAssigned);
  const mark = createDamageMark({
    view: result.view || 'top',
    x: result.x,
    y: result.y,
    damageType: result.damageType,
    severity: result.severity,
    note: result.note || '',
    nextDisplayNumber: num,
    source: 'salida',
  });

  _saveState = 'saving';
  try {
    if (result.photoFile) {
      const photoPath = await uploadDamageFoto(_detail.id, mark.id, result.photoFile);
      mark.photoIds = [photoPath];
    } else if (result.photoSkipMotivo) {
      mark.photoSkipMotivo = String(result.photoSkipMotivo).slice(0, 300);
      mark.photoSkippedAt = new Date().toISOString();
    }
    existing.push(mark);
    _detail.danosMarcados = existing;
    _detail.danosLastDisplayNumber = num;
    if (_diagramApi?.setDamages) _diagramApi.setDamages(existing);
    await actualizarPapeleta(_detail.id, {
      danosMarcados: existing,
      danosLastDisplayNumber: num,
    }, { user: _user(), knownRevision: _detail.revision });
    _saveState = 'saved';
    _trackPapeleta('papeleta_damage_added', {
      papeletaId: _detail.id,
      damageId: mark.id,
      damageType: mark.damageType,
      hasPhoto: !!(mark.photoIds && mark.photoIds.length),
    });
  } catch (e) {
    _saveState = e?.code === 'REVISION_CONFLICT' ? 'conflict' : 'idle';
    await _mexAlert('Error', e.message || String(e));
  }
}

/**
 * Bottom sheet: tipo → severidad → foto (opc) → nota → guardar.
 * Soft policy: strongly_recommended sin foto → confirm + motivo.
 * @returns {Promise<null|{ damageType, severity, note, x, y, view, photoFile?: File, photoSkipMotivo?: string }>}
 */
function _openDamageSheet({ x, y, view }) {
  return new Promise((resolve) => {
    const existing = document.querySelector('.pap-dmg-sheet');
    if (existing) existing.remove();

    let damageType = 'scratch';
    let severity = 'medium';
    let photoFile = null;

    const policyHint = (type) => {
      const p = DAMAGE_PHOTO_POLICY[type] || 'recommended';
      if (p === 'strongly_recommended') return 'Foto: muy recomendada (se pedirá motivo si omites).';
      return 'Foto: recomendada (opcional).';
    };

    const root = document.createElement('div');
    root.className = 'pap-dmg-sheet';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
      <div class="pap-dmg-sheet__backdrop" data-dmg="cancel"></div>
      <div class="pap-dmg-sheet__panel">
        <header class="pap-dmg-sheet__head">
          <strong>Marcar daño</strong>
          <button type="button" class="pap-icon-btn" data-dmg="cancel" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </header>
        <p class="pap-hint">Tipo</p>
        <div class="pap-dmg-sheet__grid" data-dmg-types>
          ${DAMAGE_TYPES.map((t) => `
            <button type="button" class="pap-dmg-chip ${t === 'scratch' ? 'is-on' : ''}" data-dmg-type="${t}">
              ${_esc(DAMAGE_TYPE_LABELS[t] || t)}
            </button>
          `).join('')}
        </div>
        <p class="pap-hint">Severidad</p>
        <div class="pap-dmg-sheet__row" data-dmg-sevs>
          ${DAMAGE_SEVERITIES.map((s) => `
            <button type="button" class="pap-dmg-chip ${s === 'medium' ? 'is-on' : ''}" data-dmg-sev="${s}">
              ${_esc(DAMAGE_SEVERITY_LABELS[s] || s)}
            </button>
          `).join('')}
        </div>
        <p class="pap-hint" data-dmg-policy>${_esc(policyHint('scratch'))}</p>
        <div class="pap-dmg-sheet__photo">
          <label class="pap-btn pap-btn--ghost pap-btn--block">
            <input type="file" accept="image/*" capture="environment" data-dmg-photo hidden/>
            <span class="material-symbols-outlined">photo_camera</span>
            <span data-dmg-photo-label>Tomar / subir foto</span>
          </label>
          <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-dmg="clear-photo" hidden>Quitar foto</button>
        </div>
        <label class="pap-field pap-field--full">
          <span>Nota (opcional)</span>
          <textarea data-dmg-note rows="2" placeholder="Detalle breve…" maxlength="500"></textarea>
        </label>
        <div class="pap-dmg-sheet__actions">
          <button type="button" class="pap-btn pap-btn--ghost" data-dmg="cancel">Cancelar</button>
          <button type="button" class="pap-btn pap-btn--primary" data-dmg="save">Guardar marca</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const policyEl = root.querySelector('[data-dmg-policy]');
    const photoLabel = root.querySelector('[data-dmg-photo-label]');
    const clearBtn = root.querySelector('[data-dmg="clear-photo"]');
    const photoInput = root.querySelector('[data-dmg-photo]');

    const close = (value) => {
      try { root.remove(); } catch (_) { /* ignore */ }
      resolve(value);
    };

    const refreshPolicy = () => {
      if (policyEl) policyEl.textContent = policyHint(damageType);
    };

    photoInput?.addEventListener('change', () => {
      photoFile = photoInput.files?.[0] || null;
      if (photoLabel) photoLabel.textContent = photoFile ? (photoFile.name || 'Foto lista') : 'Tomar / subir foto';
      if (clearBtn) clearBtn.hidden = !photoFile;
    });

    root.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-dmg-type]');
      if (t) {
        damageType = t.getAttribute('data-dmg-type');
        root.querySelectorAll('[data-dmg-type]').forEach((b) => b.classList.toggle('is-on', b === t));
        refreshPolicy();
        return;
      }
      const s = e.target.closest('[data-dmg-sev]');
      if (s) {
        severity = s.getAttribute('data-dmg-sev');
        root.querySelectorAll('[data-dmg-sev]').forEach((b) => b.classList.toggle('is-on', b === s));
        return;
      }
      const act = e.target.closest('[data-dmg]');
      if (!act) return;
      const kind = act.getAttribute('data-dmg');
      if (kind === 'cancel') {
        close(null);
        return;
      }
      if (kind === 'clear-photo') {
        photoFile = null;
        if (photoInput) photoInput.value = '';
        if (photoLabel) photoLabel.textContent = 'Tomar / subir foto';
        if (clearBtn) clearBtn.hidden = true;
        return;
      }
      if (kind === 'save') {
        const note = String(root.querySelector('[data-dmg-note]')?.value || '').trim();
        let photoSkipMotivo = '';
        const policy = DAMAGE_PHOTO_POLICY[damageType] || 'recommended';
        if (!photoFile && policy === 'strongly_recommended') {
          const ok = await _mexConfirm(
            'Sin foto de daño',
            'Este tipo de daño recomienda foto. ¿Continuar sin foto?',
            'warning'
          );
          if (!ok) return;
          let motivo = '';
          try {
            if (typeof window.mexPrompt === 'function') {
              motivo = await window.mexPrompt('Motivo', '¿Por qué omites la foto?', 'Sin acceso / ya documentado');
            }
          } catch (_) {
            return;
          }
          if (motivo == null) return;
          photoSkipMotivo = String(motivo || 'omitido').trim() || 'omitido';
        }
        close({
          damageType,
          severity,
          note,
          x,
          y,
          view,
          photoFile,
          photoSkipMotivo: photoSkipMotivo || undefined,
        });
      }
    });
  });
}

/**
 * Host for live readonly mountDiagram (car-drawable + canvas marks).
 * Avoids the old dual-<img> path where strokesToDataUrl painted an opaque white
 * overlay that hid the silhouette.
 */
function _diagramReadonlyHtml(_p, { compact = false } = {}) {
  return `<div data-diagram-ro-host ${compact ? 'data-diagram-compact' : ''} aria-label="Diagrama de salida"></div>`;
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
      <h3 class="pap-subhead">Tapetes <span class="pap-hint">(0 = no tiene · máx 1 dígito)</span></h3>
      <div class="pap-fields-2">
        <div class="pap-field">
          <label>Tapetes uso rudo</label>
          <input id="papTapetesRudo" type="text" inputmode="numeric" pattern="[0-9]" maxlength="1"
            value="${_esc(t.usoRudo ?? '')}" ${editable ? '' : 'disabled'} autocomplete="off" placeholder="0"/>
        </div>
        <div class="pap-field">
          <label>Tapetes alfombra</label>
          <input id="papTapetesAlfombra" type="text" inputmode="numeric" pattern="[0-9]" maxlength="1"
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
  const authUser = window._auth?.currentUser || getState()?.user || null;
  const nombre = String(
    p.nombreCompleto
    || p.nombre
    || p.displayName
    || authUser?.displayName
    || p.email
    || authUser?.email
    || ''
  ).trim();
  return {
    uid: authUser?.uid || p.uid || '',
    nombre,
  };
}

/** Display name for auto-fill (Quién recibe / entrega). */
function _displayName() {
  return _user().nombre || '';
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
  const q = _query.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const ACTIVE_STATUSES = new Set(['borrador', 'lista', 'entregada']);
  return _items.filter((it) => {
    const status = String(it.status || '');
    const isActive = it.activoPorUnidad === true || ACTIVE_STATUSES.has(status);

    // Sin query: filtros de bandeja
    if (!q) {
      if (_filter === 'activas' && !isActive) return false;
      if (_filter === 'entregadas' && status !== 'entregada') return false;
      if (_filter === 'historial' && status !== 'cerrada_historial' && status !== 'en_retorno') return false;
      if (_filter === 'canceladas' && status !== 'cancelada') return false;
      if (_filter === 'ventas' && !it.casoVentasId && !_reportes.some((r) => r.papeletaId === it.id && r.status === 'abierto')) return false;
      return true;
    }

    // Con query: buscar en todo lo cargado (excepto si el chip pide un status concreto)
    if (_filter === 'entregadas' && status !== 'entregada') return false;
    if (_filter === 'historial' && status !== 'cerrada_historial' && status !== 'en_retorno') return false;
    if (_filter === 'canceladas' && status !== 'cancelada') return false;
    if (_filter === 'ventas' && !it.casoVentasId && !_reportes.some((r) => r.papeletaId === it.id && r.status === 'abierto')) return false;

    const hay = [it.mva, it.placas, it.modelo, it.vin, it.clienteNombre, it.contrato, it.plazaId, it.ultimaPlazaId, it.plazaOrigenId]
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return hay.includes(q);
  });
}

function _fotosCount(p) {
  return ZONAS_V1.filter((z) => String(p?.zonas?.[z.id]?.fotoPath || '').trim()).length;
}

function _coreFotosCount(p) {
  return ZONAS_CORE.filter((id) => String(p?.zonas?.[id]?.fotoPath || '').trim()).length;
}

function _deliveryGate(p, opts = {}) {
  return puedeEntregar(p, opts);
}

function _onMobileBpChange() {
  if (_mode === 'detail' && _detail && puedeEditar(_detail.status)) _render();
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
  _pendingUnit = null;
  _heroEditing = false;
  _mobileScreen = 'datos';

  try {
    if (_mqMobile) _mqMobile.removeEventListener?.('change', _onMobileBpChange);
  } catch (_) { /* ignore */ }
  try {
    _mqMobile = window.matchMedia(`(max-width: ${MOBILE_BP - 1}px)`);
    _mqMobile.addEventListener?.('change', _onMobileBpChange);
  } catch (_) { _mqMobile = null; }

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
  // Inbox empresa-global: preferPlazaId solo reordena, no filtra (BJX→GDL).
  _unsubs.push(subscribePapeletasPlaza({
    preferPlazaId: plaza,
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
  document.body.classList.remove('pap-sig-lock');
  _closeGuidedCamera();
  _cleanup();
  _destroyDiagram();
  _destroyReadonlyDiagrams();
  _localStrokes = null;
  _container = null;
  _navigate = null;
  _fotoCache.clear();
  _saveState = 'idle';
  _step6Phase = 'fotos';
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
        const validSalida = [...SALIDA_STEP_IDS, 'firma'];
        if (firstLoad || (post && !validPost.includes(_wizardStep)) || (!post && !validSalida.includes(_wizardStep))) {
          _wizardStep = _defaultStepFor(doc);
        }
        _wizardStep = _normalizeWizardStep(_wizardStep);
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
  _navigate?.(VENTAS_ROUTE);
}

function _openDetail(id) {
  const token = String(id || '').trim();
  if (!token) return;
  _mode = 'detail';
  _detail = null;
  _localStrokes = null;
  _entradaCompareDraft = [];
  _destroyDiagram();
  _wizardStep = 'datos';
  _step6Phase = 'fotos';
  _navigate?.(_detailRoute(token));
  _watchDetail(token);
}

function _render() {
  if (!_container) return;
  const scrollerPrev = _container.querySelector('#papCaptureScroll');
  if (scrollerPrev) _captureScrollTop = scrollerPrev.scrollTop;

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
  if (_step6Phase === 'firma' || _wizardStep === 'firma') _bindSignature();
  _hydrateFotos();

  const post = _detail ? _isPostEntrega(_detail.status) : false;
  const onResumen = _step6Phase === 'resumen' || _mobileScreen === 'resumen';
  if (_mode === 'detail' && _detail && onResumen) {
    _destroyDiagram();
    _mountReadonlyDiagrams(_detail);
  } else if (_mode === 'detail' && _detail && !post && _step6Phase !== 'exito') {
    _destroyReadonlyDiagrams();
    _mountDiagramIfNeeded(_detail, puedeEditar(_detail.status));
  } else if (_mode === 'detail' && _detail && post && (_wizardStep === 'salida' || _wizardStep === 'entrada')) {
    _destroyDiagram();
    _mountReadonlyDiagrams(_detail);
  } else if (_mode !== 'detail') {
    _destroyDiagram();
    _destroyReadonlyDiagrams();
  }

  const scroller = _container.querySelector('#papCaptureScroll');
  if (scroller) {
    scroller.scrollTop = _captureScrollTop;
    _bindCaptureScrollSpy();
  }
  void canV;
}

function _renderList() {
  const rows = _filteredItems();
  const canV = _canVentas();
  return `
    <main class="pap-main pap-main--full">
      <header class="pap-page-header">
        <div class="pap-page-title">
          <h1>Papeletas</h1>
          <p>Inspecciones de salida y regreso</p>
        </div>
        <div class="pap-actions-bar">
          ${canV ? `<button type="button" class="pap-btn pap-btn--ghost" data-act="tab-ventas">Reportes de daños</button>` : ''}
          <button type="button" class="pap-btn pap-btn--primary" data-act="nueva">
            <span class="material-symbols-outlined">add</span> Nueva
          </button>
        </div>
      </header>

      <div class="pap-controls">
        <div class="pap-controls-row">
          <label class="pap-search">
            <span class="material-symbols-outlined">search</span>
            <input id="papSearch" value="${_esc(_query)}" placeholder="MVA, placas, modelo o cliente" autocomplete="off" enterkeyhint="search"/>
          </label>
          <div class="pap-quick-status" role="tablist" aria-label="Filtro">
            ${['activas', 'entregadas', 'historial', 'canceladas', 'ventas'].map((f) => `
              <button type="button" class="${_filter === f ? 'active' : ''}" data-act="filter" data-f="${f}">
                ${FILTER_LABELS[f] || f}
              </button>
            `).join('')}
          </div>
        </div>
      </div>

      <p id="pap-count" class="pap-meta">${rows.length ? `${rows.length} registro${rows.length === 1 ? '' : 's'}` : '0 registros'}</p>
      <div id="pap-table-host" class="pap-table-host">${_tableHtml(rows)}</div>
    </main>
  `;
}

function _tableHtml(rows) {
  if (!rows.length) {
    return `
      <div class="pap-empty">
        <strong>Sin papeletas</strong>
        <small>No hay registros con este filtro. Usa <b>Nueva</b> para empezar.</small>
      </div>`;
  }
  return `
    <div class="pap-cards" aria-label="Listado mobile">
      ${rows.map(_cardHtml).join('')}
    </div>
    <div class="pap-table-wrap pap-table-wrap--desktop">
      <table class="pap-table">
        <thead>
          <tr>
            <th>Económico</th>
            <th>Unidad</th>
            <th>Plaza</th>
            <th>Cliente</th>
            <th>Core</th>
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

function _cardHtml(it) {
  const core = _coreFotosCount(it);
  const short = STATUS_LABELS_SHORT[it.status] || STATUS_LABELS[it.status] || it.status;
  const updated = _fmtDate(it.actualizadoAt || it.creadoAt);
  const reporte = _hasReporte(it);
  const plaza = it.ultimaPlazaId || it.plazaId || '';
  return `
    <button type="button" class="pap-card" data-act="open" data-id="${_esc(it.id)}">
      <div class="pap-card__top">
        <strong class="pap-td-mono">${_esc(it.mva || '—')}</strong>
        <span class="pap-chip pap-chip--${_esc(it.status)}">${_esc(short)}</span>
      </div>
      <div class="pap-card__mid">${_esc(it.modelo || '—')} · ${_esc(it.placas || 'Sin placas')}${plaza ? ` · ${_esc(plaza)}` : ''}</div>
      <div class="pap-card__bot">
        <span>${_esc(it.clienteNombre || it.contrato || 'Sin cliente')}</span>
        <span>Core ${core}/7${reporte ? ' · reporte' : ''}</span>
        <span>${updated || '—'}</span>
      </div>
    </button>
  `;
}

function _rowHtml(it) {
  const core = _coreFotosCount(it);
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
      <td class="pap-td-mono">${core}/7</td>
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
  root.querySelectorAll('tr[data-act="open"], button.pap-card[data-act="open"]').forEach((row) => {
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
  const statusLabel = STATUS_LABELS_SHORT[p.status] || STATUS_LABELS[p.status] || p.status;

  if (post) {
    const steps = [
      ['entrada', STEP_LABELS.entrada],
      ['salida', STEP_LABELS.salida],
      ['reporte', STEP_LABELS.reporte],
    ];
    return `
      <main class="pap-editor-shell">
        <header class="pap-editor-top">
          <div>
            <nav class="pap-breadcrumb" aria-label="Ruta">
              <button type="button" data-act="back">Papeletas</button>
              <span>/</span>
              <strong>Regreso</strong>
            </nav>
            <h1>${_esc(p.mva || 'Papeleta')} <span class="pap-chip pap-chip--${_esc(p.status)}">${_esc(statusLabel)}</span></h1>
            <p class="pap-editor-sub">${_esc(p.modelo || 'Sin modelo')} · ${_esc(p.placas || 'Sin placas')}${p.plazaId ? ` · ${_esc(p.plazaId)}` : ''} · Solo lectura salida</p>
          </div>
          <div class="pap-actions-bar">
            <button type="button" class="pap-btn pap-btn--ghost" data-act="back">Volver</button>
            <button type="button" class="pap-btn pap-btn--ghost" data-act="pdf">Exportar</button>
          </div>
        </header>
        <div class="pap-detail">
          <div class="pap-steps" role="tablist">
            ${steps.map(([id, label]) => `
              <button type="button" class="pap-step ${_wizardStep === id ? 'is-active' : ''}" data-act="step" data-step="${id}">${label}</button>
            `).join('')}
          </div>
          ${_wizardStep === 'salida' ? _panelSalidaView(p) : ''}
          ${_wizardStep === 'entrada' ? _panelEntrada(p) : ''}
          ${_wizardStep === 'reporte' ? _panelReporte(p) : ''}
        </div>
      </main>
    `;
  }

  // Salida: captura continua (hoja + lápiz) — un solo scroll
  if (_step6Phase === 'exito') {
    return `
      <main class="pap-editor-shell pap-editor-shell--sheet">
        ${_captureHeaderHtml(p)}
        <div class="pap-capture-scroll">
          ${_panelExito(p)}
        </div>
      </main>`;
  }

  const mobile = _isMobileCapture();
  return `
    <main class="pap-editor-shell pap-editor-shell--sheet ${mobile ? 'pap-editor-shell--mobile' : 'pap-editor-shell--desktop'}">
      ${_captureHeaderHtml(p)}
      ${_captureChipsHtml(p)}
      <div class="pap-capture-scroll ${mobile ? 'pap-capture-scroll--stack' : ''}" id="papCaptureScroll">
        <section class="pap-capture-sec ${mobile && _mobileScreen !== 'datos' ? 'is-hidden-screen' : ''}" id="pap-sec-datos" data-sec="datos" data-screen="datos">
          ${_panelConfirmarDatos(p, editable)}
        </section>
        <section class="pap-capture-sec ${mobile && _mobileScreen !== 'datos' ? 'is-hidden-screen' : ''}" id="pap-sec-km_gas" data-sec="km_gas" data-screen="datos">
          ${_panelKmGas(p, editable)}
        </section>
        <section class="pap-capture-sec ${mobile && _mobileScreen !== 'datos' ? 'is-hidden-screen' : ''}" id="pap-sec-checklist" data-sec="checklist" data-screen="datos">
          ${_panelChecklistStep(p, editable)}
        </section>
        <section class="pap-capture-sec ${mobile && _mobileScreen !== 'diagrama' ? 'is-hidden-screen' : ''}" id="pap-sec-danos" data-sec="danos" data-screen="diagrama">
          ${_panelDanos(p, editable)}
        </section>
        <section class="pap-capture-sec ${mobile && _mobileScreen !== 'fotos' ? 'is-hidden-screen' : ''}" id="pap-sec-fotos" data-sec="fotos" data-screen="fotos">
          ${_panelZonas(p, editable)}
        </section>
        <section class="pap-capture-sec ${mobile && _mobileScreen !== 'resumen' ? 'is-hidden-screen' : ''}" id="pap-sec-entregar" data-sec="entregar" data-screen="resumen">
          ${_panelResumen(p)}
        </section>
        <section class="pap-capture-sec ${mobile && _mobileScreen !== 'firma' ? 'is-hidden-screen' : ''}" id="pap-sec-firma" data-sec="firma" data-screen="firma">
          ${_panelFirma(p)}
        </section>
      </div>
      ${_captureFooterHtml(p)}
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

function _panelConfirmarDatos(p, editable) {
  const kmPrev = p.salida?.km ?? p.kmAnterior ?? '—';
  const gasPrev = p.salida?.gas ?? '—';
  return `
    <div class="pap-panel pap-panel--app">
      <h2>Confirmar datos</h2>
      <p class="pap-hint">Una sola hoja: completa abajo sin cambiar de pantalla. Cliente/contrato son opcionales (se pueden asignar después).</p>
      ${_unitIdentityHtml(p)}
      <div class="pap-fields-2">
        <div class="pap-field">
          <label>Cliente / entrega a</label>
          ${_canVentas() || editable
            ? `<input data-field="clienteNombre" value="${_esc(p.clienteNombre || '')}" placeholder="Opcional — se puede asignar después" autocomplete="off"/>`
            : `<input value="${_esc(p.clienteNombre || '—')}" disabled/>`}
        </div>
        <div class="pap-field">
          <label>Contrato</label>
          <input data-field="contrato" value="${_esc(p.contrato || '')}" ${editable ? '' : 'disabled'} placeholder="Opcional"/>
        </div>
        <div class="pap-field"><label>Último KM</label><input value="${_esc(kmPrev)}" disabled/></div>
        <div class="pap-field"><label>Último gas</label><input value="${_esc(gasPrev)}" disabled/></div>
      </div>
      ${editable ? `
        <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="corregir-datos">Corregir campos</button>
      ` : ''}
    </div>
  `;
}

function _panelKmGas(p, editable) {
  const km = p.salida?.km ?? _pendingSalida.km ?? '';
  const gas = p.salida?.gas ?? _pendingSalida.gas ?? '';
  const tableroPath = String(p.zonas?.tablero_kilometraje?.fotoPath || p.fotoTableroPath || '').trim();
  return `
    <div class="pap-panel pap-panel--app">
      <h2>KM y gasolina</h2>
      <div class="pap-field pap-field--km">
        <label>Kilometraje</label>
        <input id="papKmSalida" class="pap-km-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${_esc(km ?? '')}" ${editable ? '' : 'disabled'} autocomplete="off" placeholder="0"/>
      </div>
      <div class="pap-field">
        <label>Gasolina</label>
        ${_gasChipsHtml(gas || '', 'papGasSalida', !editable)}
      </div>
      <div class="pap-tablero-card">
        <div>
          <strong>Foto de tablero</strong>
          <p class="pap-hint">Obligatoria (respalda el KM).</p>
        </div>
        <button type="button" class="pap-btn pap-btn--${tableroPath ? 'ghost' : 'primary'}" data-act="foto-tablero" ${editable ? '' : 'disabled'}>
          ${tableroPath ? 'Retomar foto' : 'Tomar foto'}
        </button>
      </div>
      ${tableroPath ? '<p class="pap-ready">Tablero capturado</p>' : '<p class="pap-hint">Sin foto de tablero aún.</p>'}
    </div>
  `;
}

function _panelChecklistStep(p, editable) {
  return `
    <div class="pap-panel pap-panel--app">
      <h2>Checklist</h2>
      <p class="pap-hint">Por excepción: marca todo presente, luego ajusta faltantes.</p>
      ${editable ? `
        <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="check-all-ok">Confirmar todo presente</button>
      ` : ''}
      <div class="pap-check-list">
        ${CHECKLIST_KEYS.map((k) => `
          <div class="pap-check-readonly__row">
            <span class="pap-check-readonly__name">${_esc(CHECKLIST_LABELS[k] || k)}</span>
            ${_ternaryEditable(k, p.checklist?.[k], editable)}
          </div>
        `).join('')}
      </div>
      ${_tapetesHtml(p, editable)}
      ${_llantasGridHtml(p, editable)}
      <div class="pap-field pap-field--full">
        <label>Notas / interiores</label>
        <textarea data-field="notasInteriores" rows="2" ${editable ? '' : 'disabled'} placeholder="Notas del patio…">${_esc(p.notasInteriores || p.notas || '')}</textarea>
      </div>
    </div>
  `;
}

function _panelDanos(p, editable) {
  return `
    <div class="pap-panel pap-panel--app pap-panel--diagram">
      <h2>Diagrama</h2>
      <p class="pap-hint">Pantalla completa · pan/zoom · lápiz solo al activarlo. En desktop, hover muestra foto de zona.</p>
      <div class="pap-hoja__diagram pap-hoja__diagram--app pap-hoja__diagram--fs" data-diagram-host></div>
      ${editable ? `
        <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="save-danos" ${_busy ? 'disabled' : ''}>Guardar diagrama</button>
      ` : ''}
    </div>
  `;
}

function _panelExito(p) {
  return `
    <div class="pap-panel pap-panel--app pap-panel--success">
      <span class="material-symbols-outlined pap-success-icon">check_circle</span>
      <h2>Papeleta entregada</h2>
      <p class="pap-hint">${_esc(p.mva || '')} · ${_esc(p.modelo || '')}</p>
      <div class="pap-actions">
        <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="pdf">Ver PDF</button>
        <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="back">Ir al listado</button>
      </div>
    </div>
  `;
}

/** @deprecated paper composite — kept for readonly salida snapshot helpers */
function _panelDatos(p, editable) {
  return _panelConfirmarDatos(p, editable);
}

function _salidaSummaryHtml(p, { compact = false } = {}) {
  const out = p.salida || {};
  const firma = String(out.firmaPath || out.firma?.imagePath || '').trim();
  const marks = Array.isArray(p.danosMarcados) ? p.danosMarcados : [];
  return `
    <section class="pap-salida-block pap-panel--app">
      <header class="pap-salida-head">
        <div>
          <p class="pap-hint">Salida registrada</p>
          <h3>Entrega</h3>
        </div>
        <div class="pap-contrato pap-contrato--ro">
          <span>Contrato</span>
          <strong>${_esc(p.contrato || '—')}</strong>
        </div>
      </header>
      ${_unitIdentityHtml(p)}
      <div class="pap-fields-2">
        <div class="pap-field"><label>Quién entregó</label><input value="${_esc(out.quienEntrega || p.clienteNombre || '—')}" disabled/></div>
        <div class="pap-field"><label>KM / Gas</label><input value="${_esc(out.km ?? '—')} · ${_esc(out.gas || '—')}" disabled/></div>
      </div>
      ${!compact ? `
        <div class="pap-salida-body">
          <div>${_checklistReadonlyHtml(p)}</div>
          <div class="pap-hoja__diagram pap-hoja__diagram--app">${_diagramReadonlyHtml(p)}</div>
        </div>
        <h3 class="pap-subhead">Daños tipados</h3>
        ${marks.length ? `
          <ul class="pap-dano-list">
            ${marks.map((d) => `
              <li><strong>#${_esc(d.displayNumber)}</strong>
                ${_esc(DAMAGE_TYPE_LABELS[d.damageType] || d.damageType)}
                · ${_esc(DAMAGE_SEVERITY_LABELS[d.severity] || d.severity)}
                ${d.note ? ` · ${_esc(truncNota(d.note))}` : ''}
                ${(d.photoIds && d.photoIds.length) ? ' · foto' : ''}
              </li>
            `).join('')}
          </ul>
        ` : _danosSalidaHtml(p)}
        ${firma ? '<p class="pap-hint">Firma de entrega capturada.</p><div class="pap-firma-host" data-firma-preview></div>' : '<p class="pap-hint">Sin firma en archivo.</p>'}
      ` : `
        <div class="pap-hoja__diagram pap-hoja__diagram--app pap-hoja__diagram--mini">${_diagramReadonlyHtml(p, { compact: true })}</div>
        <p class="pap-hint">Detalle completo en la pestaña Salida.</p>
      `}
    </section>
  `;
}

function _panelSalidaView(p) {
  return `
    <div class="pap-panel pap-panel--app pap-panel--salida">
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
  const salidaMarks = Array.isArray(p.danosMarcados) ? p.danosMarcados : [];
  if (!locked) _ensureEntradaCompareDraft(p);
  const compared = buildEntradaDamageComparison(
    salidaMarks,
    locked ? (Array.isArray(e.danosMarcados) ? e.danosMarcados : []) : _entradaCompareDraft
  );
  const COMPARE_LABELS = {
    preexisting: 'Sigue',
    new: 'Nuevo',
    repaired: 'Reparado',
    unchanged: 'Sin cambio',
  };
  return `
    <div class="pap-panel pap-panel--app pap-panel--regreso">
      <h2>${locked ? 'Regreso registrado' : 'Registrar regreso'}</h2>
      <p class="pap-hint">La salida firmada no se modifica. Compara daños abajo.</p>
      ${_salidaSummaryHtml(p, { compact: true })}

      <section class="pap-entrada-block">
        <div class="pap-fields-2">
          <div class="pap-field">
            <label for="papQuienRecibe">Quién recibe</label>
            <input id="papQuienRecibe" type="text" name="quienRecibe"
              value="${_esc(locked ? (e.quienRecibe || '') : (e.quienRecibe || _displayName()))}"
              placeholder="Tu nombre"
              autocomplete="name"
              ${locked ? 'disabled' : ''}/>
          </div>
          <div class="pap-field">
            <label>KM entrada</label>
            <input id="papKmIn" type="text" inputmode="numeric" pattern="[0-9]*" value="${_esc(e.km ?? '')}" ${locked ? 'disabled' : ''} autocomplete="off" placeholder="0"/>
          </div>
        </div>
        <div class="pap-field">
          <label>Gas entrada</label>
          ${_gasChipsHtml(e.gas || '', 'papGasIn', locked)}
        </div>
        <div class="pap-field">
          <label>Notas</label>
          <textarea id="papNotasIn" rows="2" ${locked ? 'disabled' : ''}>${_esc(e.notas || '')}</textarea>
        </div>

        <h3 class="pap-subhead">Comparación de daños</h3>
        ${salidaMarks.length ? `
          <ul class="pap-compare-list">
            ${salidaMarks.map((d) => {
              const match = compared.find((c) => c.sourceDamageId === d.id);
              const st = match?.comparisonStatus || 'preexisting';
              return `
                <li class="pap-compare-item" data-salida-damage="${_esc(d.id)}">
                  <div>
                    <b>#${_esc(d.displayNumber)}</b>
                    ${_esc(DAMAGE_TYPE_LABELS[d.damageType] || d.damageType)}
                    · ${_esc(DAMAGE_SEVERITY_LABELS[d.severity] || d.severity)}
                    <span class="pap-chip pap-chip--soft">${_esc(COMPARE_LABELS[st] || st)}</span>
                  </div>
                  ${!locked ? `
                    <div class="pap-compare-actions">
                      <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-act="compare-set" data-id="${_esc(d.id)}" data-status="unchanged">Sin cambios</button>
                      <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-act="compare-set" data-id="${_esc(d.id)}" data-status="repaired">Reparado</button>
                      <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-act="compare-set" data-id="${_esc(d.id)}" data-status="preexisting">Sigue</button>
                    </div>
                  ` : ''}
                </li>`;
            }).join('')}
          </ul>
        ` : '<p class="pap-hint">Sin daños tipados en salida.</p>'}
        ${!locked ? `
          <div class="pap-compare-new">
            <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="compare-new-damage">Daño nuevo en regreso</button>
            <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="compare-new-faltante">Faltante nuevo</button>
          </div>
        ` : ''}

        <h3 class="pap-subhead">Fotos salida (referencia)</h3>
        <div class="pap-photos" id="papCompare"></div>
      </section>
      ${!locked ? `
        <div class="pap-actions pap-actions--sticky">
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="save-entrada" ${_busy ? 'disabled' : ''}>Registrar entrada</button>
        </div>
      ` : `<p class="pap-card__meta">Entrada registrada · unidad liberada</p>`}
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
  const coreCount = _coreFotosCount(p);
  const z = ZONAS_V1[_zonaIdx] || ZONAS_V1[0];
  const data = p.zonas?.[z.id] || { estado: 'ok', nota: '', fotoPath: '' };
  const n = _fotosCount(p);
  return `
    <div class="pap-panel pap-panel--app pap-panel--zona">
      <h2>Fotos core</h2>
      <p class="pap-hint">Obligatorias: 7 zonas core (${coreCount}/7). Tablero aparte (KM). El resto es opcional (${n}/12 inspección).</p>
      ${editable ? `
        <div class="pap-cam-cta">
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block pap-btn--cam" data-act="open-camera" ${_busy ? 'disabled' : ''}>
            <span class="material-symbols-outlined">photo_camera</span>
            Cámara guiada · core ${coreCount}/7
          </button>
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
            <span>${_zonaIdx + 1}/12 · core ${coreCount}/7</span>
          </div>
          <button type="button" class="pap-icon-btn" data-act="zona-next" ${_zonaIdx >= 11 ? 'disabled' : ''} aria-label="Siguiente">
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
        <div class="pap-cam">
          ${data.fotoPath
            ? `<img class="pap-cam__preview" data-zona-preview alt="Foto zona" style="display:block"/>`
            : `<div class="pap-cam__empty">Sin foto</div>`}
          <input type="hidden" data-zona-estado value="${_esc(data.estado || 'ok')}"/>
          ${editable ? `
            <label class="pap-cam__btn pap-cam__btn--ghost">
              <input type="file" accept="image/*" data-zona-foto data-autosave="1" hidden/>
              <span class="material-symbols-outlined">upload</span>
              Subir
            </label>
          ` : ''}
        </div>
      </div>
      ${editable ? `
        <div class="pap-actions">
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="open-camera" ${_busy ? 'disabled' : ''}>
            Continuar con cámara guiada
          </button>
          <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="goto-resumen">Ir a resumen</button>
        </div>
      ` : ''}
    </div>
  `;
}

function _panelResumen(p) {
  const gate = _deliveryGate(p, { firma: p.salida?.firma || null });
  const coreOk = coreZonasHaveFoto(p.zonas, { papeleta: p });
  const checkOk = isChecklistComplete(p);
  const tapetes = normalizeTapetes(p);
  const hardWithoutFirma = (gate.hard || []).filter((h) => h !== 'firma');
  const canAskFirma = puedeEditar(p.status) && hardWithoutFirma.length === 0;
  const HARD_LABELS = {
    km: 'Kilometraje',
    gas: 'Gasolina',
    checklist: 'Checklist / llantas / tapetes',
    core_photos: 'Fotos core (7)',
    tablero_photo: 'Foto de tablero',
    firma: 'Firma',
    pending_writes: 'Guardado pendiente',
    km_justification: 'Justificación de KM',
    status: 'Estado no elegible',
  };
  const mid = Math.ceil(CHECKLIST_KEYS.length / 2);
  const leftKeys = CHECKLIST_KEYS.slice(0, mid);
  const rightKeys = CHECKLIST_KEYS.slice(mid);
  const chkCell = (k) => {
    if (!k) return '<div class="pap-resumen-chk__cell"></div>';
    const v = p.checklist?.[k] || '';
    const mark = v === 'ok' ? '✓' : v === 'faltante' ? 'X' : v === 'na' ? 'N/A' : '—';
    return `<div class="pap-resumen-chk__cell"><span>${_esc(CHECKLIST_LABELS[k] || k)}</span><b>${mark}</b></div>`;
  };
  const coreThumbs = ZONAS_CORE.map((id) => {
    const path = String(p.zonas?.[id]?.fotoPath || '').trim();
    const url = path && !path.startsWith('pending:') ? (_fotoCache.get(path) || '') : '';
    if (path && !url) getDownloadUrl(path).then((u) => { _fotoCache.set(path, u); }).catch(() => {});
    return `<div class="pap-resumen-ph ${path ? 'is-ok' : ''}" title="${_esc(ZONA_CORE_LABELS[id] || id)}">
      ${url ? `<img src="${_esc(url)}" alt=""/>` : `<span>${_esc((ZONA_CORE_LABELS[id] || id).slice(0, 3))}</span>`}
    </div>`;
  }).join('');
  return `
    <div class="pap-panel pap-panel--resumen">
      <h2>Resumen · espejo PDF</h2>
      <div class="pap-resumen-top">
        <div class="pap-resumen-unit">
          <div><span>MVA</span><strong>${_esc(p.mva || '—')}</strong></div>
          <div><span>Modelo</span><strong>${_esc(p.modelo || '—')}</strong></div>
          <div><span>Placas</span><strong>${_esc(p.placas || '—')}</strong></div>
          <div><span>Cliente</span><strong>${_esc(p.clienteNombre || 'Sin cliente')}</strong></div>
          <div><span>Contrato</span><strong>${_esc(p.contrato || '—')}</strong></div>
          <div><span>Plaza</span><strong>${_esc(p.plazaId || '—')}</strong></div>
        </div>
        <div class="pap-fields-2">
          <div class="pap-field"><label>KM salida</label><input value="${_esc(p.salida?.km ?? _pendingSalida.km ?? '—')}" disabled/></div>
          <div class="pap-field"><label>Gas salida</label><input value="${_esc(p.salida?.gas ?? _pendingSalida.gas ?? '—')}" disabled/></div>
        </div>
      </div>
      <div class="pap-resumen-diagram">${_diagramReadonlyHtml(p, { compact: true })}</div>
      <h3>Checklist + tapetes</h3>
      <div class="pap-resumen-chk">
        ${leftKeys.map((k, i) => `${chkCell(k)}${chkCell(rightKeys[i])}`).join('')}
        <div class="pap-resumen-chk__cell"><span>Tapetes uso rudo</span><b>${_esc(tapetes.usoRudo ?? '—')}</b></div>
        <div class="pap-resumen-chk__cell"><span>Tapetes alfombra</span><b>${_esc(tapetes.alfombra ?? '—')}</b></div>
      </div>
      <h3>Fotos core ${coreOk ? '7/7' : `${_coreFotosCount(p)}/7`}</h3>
      <div class="pap-resumen-photos">${coreThumbs}</div>
      <ul class="pap-checklist-status">
        <li class="${coreOk ? 'is-ok' : ''}">Fotos core</li>
        <li class="${checkOk ? 'is-ok' : ''}">Checklist / llantas / tapetes</li>
        <li>Estado: ${_esc(STATUS_LABELS[p.status] || p.status)}</li>
      </ul>
      ${hardWithoutFirma.length ? `
        <p class="pap-hint">Falta: ${hardWithoutFirma.map((h) => HARD_LABELS[h] || h).join(', ')}</p>
      ` : '<p class="pap-ready">Listo para pedir firma</p>'}
      ${(gate.soft || []).includes('faltantes') ? '<p class="pap-hint">Hay ítems marcados como faltante (se pedirá confirmación).</p>' : ''}
      <div class="pap-actions pap-actions--sticky">
        ${canAskFirma ? `
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="start-entregar" ${_busy ? 'disabled' : ''}>
            Entregar · firmar
          </button>
        ` : ''}
        ${p.status === 'entregada' || p.status === 'en_retorno' || p.status === 'cerrada_historial' ? `
          <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-act="pdf" title="Exportar PDF / XLS / CSV">Exportar PDF</button>
        ` : ''}
        ${p.status === 'entregada' ? `
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-act="goto-entrada">Registrar regreso</button>
        ` : ''}
      </div>
    </div>
  `;
}

function _panelFirma(p) {
  const firma = p.salida?.firma || {};
  return `
    <div class="pap-panel pap-panel--app pap-panel--firma-fs">
      <h2>Firma de entrega</h2>
      <div class="pap-firma-rules" role="list">
        <div class="pap-firma-rules__chip" role="listitem">Suciedad excesiva = cobro</div>
        <div class="pap-firma-rules__chip" role="listitem">Olor a cigarro = cobro</div>
        <div class="pap-firma-rules__chip" role="listitem">Daños no marcados = responsabilidad</div>
        <div class="pap-firma-rules__chip" role="listitem">Combustible según nivel registrado</div>
      </div>
      <label class="pap-consent">
        <input type="checkbox" id="papConsent" />
        <span>Recibo la unidad con las características especificadas en este documento y acepto.</span>
      </label>
      <div class="pap-fields-2">
        <div class="pap-field">
          <label>Nombre quien firma</label>
          <input id="papSignerName" value="${_esc(firma.signerName || p.clienteNombre || '')}" placeholder="Nombre completo" autocomplete="name"/>
        </div>
        <div class="pap-field">
          <label>Relación</label>
          <select id="papSignerRole">
            ${['Cliente', 'Conductor', 'Representante', 'Otro'].map((r) => `
              <option value="${r}" ${(firma.signerRole || (p.clienteNombre ? 'Cliente' : 'Otro')) === r ? 'selected' : ''}>${r}</option>
            `).join('')}
          </select>
        </div>
      </div>
      <canvas class="pap-sig" id="papSig" width="480" height="220"></canvas>
      <div class="pap-actions">
        <button type="button" class="pap-btn pap-btn--ghost" data-act="sig-clear">Limpiar</button>
        <button type="button" class="pap-btn pap-btn--primary" data-act="sig-confirm" ${_busy ? 'disabled' : ''}>Confirmar entrega</button>
      </div>
    </div>
  `;
}

function _unitIdentityHtml(p) {
  const img = _modelImageUrl(p.modelo);
  return `
    <div class="pap-unit-hero ${img ? 'has-img' : ''}">
      <div class="pap-unit-hero__bg" ${img ? `style="background-image:url('${_esc(img)}')"` : ''} aria-hidden="true"></div>
      <div class="pap-unit-hero__overlay">
        <div class="pap-unit-hero__eco">${_esc(p.mva || '—')}</div>
        <div class="pap-unit-hero__meta">
          <span>${_esc(p.modelo || '—')}</span>
          <span>${_esc(p.placas || 'Sin placas')}</span>
          ${p.color ? `<span>${_esc(p.color)}</span>` : ''}
          ${p.vin ? `<span class="pap-td-mono">${_esc(p.vin)}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="pap-identity">
      <div class="pap-identity__cell"><span>Económico</span><strong>${_esc(p.mva || '—')}</strong></div>
      <div class="pap-identity__cell"><span>Modelo</span><strong>${_esc(p.modelo || '—')}</strong></div>
      <div class="pap-identity__cell"><span>Placas</span><strong>${_esc(p.placas || '—')}</strong></div>
      <div class="pap-identity__cell"><span>Color</span><strong>${_esc(p.color || '—')}</strong></div>
    </div>
  `;
}

function _heroPendingHtml(u) {
  if (!u) return '';
  const img = _modelImageUrl(u.modelo);
  const edit = _heroEditing;
  return `
    <div class="pap-hero-screen">
      <div class="pap-unit-hero pap-unit-hero--full ${img ? 'has-img' : ''}">
        <div class="pap-unit-hero__bg" ${img ? `style="background-image:url('${_esc(img)}')"` : ''} aria-hidden="true"></div>
        <div class="pap-unit-hero__overlay">
          <div class="pap-unit-hero__eco">${_esc(u.mva || '—')}</div>
          <div class="pap-unit-hero__meta">
            <span>${_esc(u.modelo || '—')}</span>
            <span>${_esc(u.placas || 'Sin placas')}</span>
            ${u.color ? `<span>${_esc(u.color)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="pap-panel pap-panel--app pap-hero-fields">
        <div class="pap-hero-fields__head">
          <h2>Confirmar unidad</h2>
          <button type="button" class="pap-btn pap-btn--ghost pap-btn--tiny" data-act="hero-toggle-edit">
            ${edit ? 'Listo' : 'Editar'}
          </button>
        </div>
        <p class="pap-hint">Correcciones solo en esta papeleta (no tocan el master Unidades).</p>
        <div class="pap-fields-2">
          <div class="pap-field"><label>Económico</label><input data-hero-field="mva" value="${_esc(u.mva || '')}" ${edit ? '' : 'readonly'}/></div>
          <div class="pap-field"><label>Modelo</label><input data-hero-field="modelo" value="${_esc(u.modelo || '')}" ${edit ? '' : 'readonly'}/></div>
          <div class="pap-field"><label>Placas</label><input data-hero-field="placas" value="${_esc(u.placas || '')}" ${edit ? '' : 'readonly'}/></div>
          <div class="pap-field"><label>Color</label><input data-hero-field="color" value="${_esc(u.color || '')}" ${edit ? '' : 'readonly'}/></div>
          <div class="pap-field pap-field--full"><label>VIN</label><input data-hero-field="vin" value="${_esc(u.vin || '')}" ${edit ? '' : 'readonly'}/></div>
        </div>
        <div class="pap-actions">
          <button type="button" class="pap-btn pap-btn--ghost" data-act="hero-cancel">Otra unidad</button>
          <button type="button" class="pap-btn pap-btn--primary" data-act="hero-confirm" ${_busy ? 'disabled' : ''}>
            Abrir papeleta
          </button>
        </div>
      </div>
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
  const open = (_reportes || []).filter((r) => r.papeletaId === p?.id && r.status === 'abierto');
  return `
    <div class="pap-panel">
      <h2>Reportes de daños</h2>
      <p class="pap-hint">La creación de reportes se hace en el módulo <strong>Reportes de daños</strong>. Aquí solo se muestran casos abiertos vinculados a esta papeleta.</p>
      ${open.length ? `
        <ul class="pap-dano-list">
          ${open.map((r) => `
            <li>
              <strong>${_esc(r.tipo)}</strong> · ${_esc(r.status)}
              <button type="button" class="pap-btn pap-btn--ghost" data-act="goto-reporte" data-id="${_esc(r.id)}">Ver</button>
            </li>
          `).join('')}
        </ul>
      ` : `<p class="pap-hint">Sin reportes abiertos vinculados.</p>`}
      <div class="pap-actions">
        <button type="button" class="pap-btn pap-btn--primary" data-act="goto-reportes-spa">
          <span class="material-symbols-outlined">open_in_new</span> Ir a Reportes de daños
        </button>
      </div>
    </div>
  `;
}

function _renderVentas() {
  if (!_canVentas()) return `<div class="pap-empty">Sin permiso de Ventas.</div>`;
  if (!_reportes.length) return `<div class="pap-empty">No hay reportes abiertos.</div>`;
  return `
    <div class="pap-ventas-list">
      ${_reportes.map((r) => `
        <article class="pap-card pap-card--ventas">
          <div class="pap-card__top">
            <strong class="pap-td-mono">${_esc(r.mva || r.unidadId)}</strong>
            <span class="pap-chip pap-chip--soft">${_esc(r.tipo)} · ${_esc(r.status)}</span>
          </div>
          <div class="pap-card__mid">Papeleta ${_esc(r.papeletaId)}</div>
          <div class="pap-card__bot pap-card__bot--actions">
            <button type="button" class="pap-btn pap-btn--ghost" data-act="open" data-id="${_esc(r.papeletaId)}">Ver</button>
            <button type="button" class="pap-btn pap-btn--primary" data-act="promover" data-id="${_esc(r.id)}">Promover</button>
            ${rolPuedeCerrarCaso(_role()) ? `<button type="button" class="pap-btn pap-btn--ghost" data-act="cerrar-caso" data-id="${_esc(r.id)}">Cerrar</button>` : ''}
          </div>
        </article>
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
    btn.addEventListener('click', () => {
      const unit = _unitHits.find((u) => u.id === btn.dataset.id);
      if (!unit) return;
      _pendingUnit = { ...unit };
      _heroEditing = false;
      _render();
    });
  });
}

async function _runUnitAutocomplete(raw) {
  const seq = ++_unitSearchSeq;
  _unitQ = raw;
  _unitSearchBusy = true;
  _paintUnitHits();
  try {
    const plaza = String(getCurrentPlaza() || '').toUpperCase();
    const q = String(raw || '').trim();
    let hits = [];
    const mex = window.mexUnidades;

    // Prefer API index (incluye modelo); mezclar con mexUnidades si está caliente
    hits = await buscarUnidad(q, { limit: 12, plazaId: plaza });
    if (mex?.isReady?.() && q) {
      const local = mex.buscar(q, 12) || [];
      const seen = new Set(hits.map((u) => String(u.id || u.unidadId || u.mva || '')));
      for (const u of local) {
        const key = String(u.id || u.unidadId || u.mva || '');
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        hits.push(u);
      }
      if (plaza) {
        hits = hits.slice().sort((a, b) => {
          const ap = String(a.plazaId || a.plaza || '').toUpperCase() === plaza ? 0 : 1;
          const bp = String(b.plazaId || b.plaza || '').toUpperCase() === plaza ? 0 : 1;
          return ap - bp;
        });
      }
      hits = hits.slice(0, 12);
    }
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
  if (_pendingUnit) {
    return `
      <main class="pap-editor-shell pap-editor-shell--hero">
        <header class="pap-editor-top pap-sheet-head">
          <div>
            <nav class="pap-breadcrumb" aria-label="Ruta">
              <button type="button" data-act="back">Papeletas</button>
              <span>/</span>
              <strong>Nueva</strong>
            </nav>
            <h1>Unidad</h1>
          </div>
          <div class="pap-actions-bar">
            <button type="button" class="pap-btn pap-btn--ghost" data-act="hero-cancel">Volver a buscar</button>
          </div>
        </header>
        ${_heroPendingHtml(_pendingUnit)}
      </main>`;
  }
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
          <h1>Buscar unidad</h1>
          <p class="pap-editor-sub">Económico, placas o modelo — catálogo empresa-global.</p>
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
  root.querySelector('[data-act="goto-reportes-spa"]')?.addEventListener('click', () => _gotoVentas());
  root.querySelectorAll('[data-act="goto-reporte"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (id) _navigate?.(`/app/reportes-danos/${id}`);
    });
  });
  root.querySelector('[data-act="nueva"]')?.addEventListener('click', () => {
    _navigate?.(NEW_ROUTE);
  });
  root.querySelector('#papSearch')?.addEventListener('input', (e) => {
    _query = e.target.value || '';
    _paintList();
  });
  root.querySelector('#papSearch')?.addEventListener('search', (e) => {
    _query = e.target.value || '';
    _paintList();
  });
  // Delegación: sobrevive si el input se recrea o el teclado móvil envía eventos raros
  if (!root.dataset.papSearchDelegated) {
    root.dataset.papSearchDelegated = '1';
    root.addEventListener('input', (e) => {
      const t = e.target;
      if (!t || t.id !== 'papSearch') return;
      _query = t.value || '';
      _paintList();
    });
  }
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
  root.querySelectorAll('[data-act="jump-sec"]').forEach((btn) => {
    btn.addEventListener('click', () => _jumpToSec(btn.dataset.sec));
  });
  root.querySelectorAll('[data-act="jump-screen"]').forEach((btn) => {
    btn.addEventListener('click', () => _gotoMobileScreen(btn.dataset.screen));
  });
  root.querySelector('[data-act="hero-toggle-edit"]')?.addEventListener('click', () => {
    _heroEditing = !_heroEditing;
    _render();
  });
  root.querySelector('[data-act="hero-cancel"]')?.addEventListener('click', () => {
    _pendingUnit = null;
    _heroEditing = false;
    _render();
    queueMicrotask(() => _container?.querySelector('#papUnitQ')?.focus());
  });
  root.querySelector('[data-act="hero-confirm"]')?.addEventListener('click', () => {
    void _confirmHeroUnit();
  });
  root.querySelector('[data-act="next-gap"]')?.addEventListener('click', () => {
    if (!_detail) return;
    const sec = _firstHardSec(_detail);
    if (_isMobileCapture()) _gotoMobileScreen(_screenForSec(sec));
    else _jumpToSec(sec);
  });
  root.querySelector('[data-act="capture-entregar"]')?.addEventListener('click', () => {
    void _captureEntregar();
  });
  root.querySelectorAll('[data-act="flow-back"]').forEach((btn) => {
    btn.addEventListener('click', () => { void _flowBack(); });
  });
  root.querySelectorAll('[data-act="flow-next"]').forEach((btn) => {
    btn.addEventListener('click', () => { void _flowNext(); });
  });
  root.querySelector('[data-act="check-all-ok"]')?.addEventListener('click', () => {
    if (!_detail) return;
    if (!_detail.checklist) _detail.checklist = {};
    for (const k of CHECKLIST_KEYS) {
      if (!String(_detail.checklist[k] || '').trim()) _detail.checklist[k] = 'ok';
    }
    _render();
  });
  root.querySelector('[data-act="foto-tablero"]')?.addEventListener('click', () => {
    void _captureTableroFoto();
  });
  root.querySelector('[data-act="save-danos"]')?.addEventListener('click', () => { void _saveDanos(); });
  root.querySelector('[data-act="corregir-datos"]')?.addEventListener('click', () => {
    void _mexAlert('Corregir', 'Edita cliente/contrato arriba y pulsa Continuar. El cambio queda solo en esta papeleta.');
  });
  root.querySelectorAll('[data-act="check-set"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!_detail || !puedeEditar(_detail.status)) return;
      if (!_detail.checklist) _detail.checklist = {};
      _detail.checklist[btn.dataset.key] = btn.dataset.val;
      if (_diagramApi) _localStrokes = _diagramApi.getStrokes();
      // Update ternary UI in place — avoid full re-render (keeps scroll + diagram)
      const group = btn.closest('.pap-ternary');
      group?.querySelectorAll('.pap-ternary__btn').forEach((b) => {
        b.classList.remove('is-on', 'is-ok', 'is-bad', 'is-na');
        if (b === btn) {
          b.classList.add('is-on');
          if (btn.dataset.val === 'ok') b.classList.add('is-ok');
          if (btn.dataset.val === 'faltante') b.classList.add('is-bad');
          if (btn.dataset.val === 'na') b.classList.add('is-na');
        }
      });
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
    _jumpToSec('entregar');
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
      const digit = String(el.value || '').replace(/\D+/g, '').slice(0, 1);
      if (el.value !== digit) el.value = digit;
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
  root.querySelector('[data-act="start-entregar"]')?.addEventListener('click', () => { void _captureEntregar(); });
  root.querySelector('[data-act="sig-clear"]')?.addEventListener('click', () => _clearSig());
  root.querySelector('[data-act="sig-confirm"]')?.addEventListener('click', () => _confirmFirma());
  root.querySelectorAll('[data-act="pdf"]').forEach((btn) => {
    btn.addEventListener('click', () => _doPdf());
  });
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
  root.querySelectorAll('[data-act="compare-set"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!_detail) return;
      _ensureEntradaCompareDraft(_detail);
      const id = btn.dataset.id;
      const status = btn.dataset.status || 'unchanged';
      const row = _entradaCompareDraft.find((d) => d.sourceDamageId === id);
      if (row) row.comparisonStatus = status;
      else {
        _entradaCompareDraft.push({
          id: `e_${id}`,
          source: 'entrada',
          sourceDamageId: id,
          comparisonStatus: status,
        });
      }
      _render();
    });
  });
  root.querySelector('[data-act="compare-new-damage"]')?.addEventListener('click', async () => {
    if (!_detail) return;
    _ensureEntradaCompareDraft(_detail);
    const sheet = await _openDamageSheet({ x: 0.5, y: 0.5, view: 'top' });
    if (!sheet) return;
    _entradaCompareDraft.push({
      id: `e_new_${Date.now().toString(36)}`,
      source: 'entrada',
      comparisonStatus: 'new',
      sourceDamageId: null,
      damageType: sheet.damageType,
      severity: sheet.severity,
      note: sheet.note || '',
    });
    _render();
  });
  root.querySelector('[data-act="compare-new-faltante"]')?.addEventListener('click', async () => {
    if (!_detail) return;
    _ensureEntradaCompareDraft(_detail);
    _entradaCompareDraft.push({
      id: `e_falt_${Date.now().toString(36)}`,
      source: 'entrada',
      comparisonStatus: 'new',
      sourceDamageId: null,
      damageType: 'missing',
      severity: 'medium',
      note: 'Faltante nuevo en regreso',
    });
    _render();
  });
  root.querySelector('[data-act="send-reporte"]')?.addEventListener('click', () => {
    _gotoVentas();
  });
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

async function _flowBack() {
  if (!_detail) {
    _gotoList();
    return;
  }
  if (_isPostEntrega(_detail.status)) {
    _gotoList();
    return;
  }
  if (_step6Phase === 'exito') {
    _gotoList();
    return;
  }
  // Captura continua: atrás = salir del borrador (no hop entre pantallas)
  await _openAbandonSheet();
}

/**
 * Spec §12 abandon sheet from paso 2 atrás.
 * Continuar después | Cancelar papeleta | Seguir editando
 */
function _openAbandonSheet() {
  return new Promise((resolve) => {
    const prev = document.querySelector('.pap-abandon-sheet');
    if (prev) prev.remove();
    const root = document.createElement('div');
    root.className = 'pap-dmg-sheet pap-abandon-sheet';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
      <div class="pap-dmg-sheet__backdrop" data-abandon="seguir"></div>
      <div class="pap-dmg-sheet__panel">
        <header class="pap-dmg-sheet__head">
          <strong>¿Salir del borrador?</strong>
          <button type="button" class="pap-icon-btn" data-abandon="seguir" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </header>
        <p class="pap-hint">La unidad permanece bloqueada mientras el borrador esté activo.</p>
        <div class="pap-abandon-actions">
          <button type="button" class="pap-btn pap-btn--primary pap-btn--block" data-abandon="despues">Continuar después</button>
          <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-abandon="cancelar">Cancelar papeleta</button>
          <button type="button" class="pap-btn pap-btn--ghost pap-btn--block" data-abandon="seguir">Seguir editando</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    const done = (v) => {
      try { root.remove(); } catch (_) { /* ignore */ }
      resolve(v);
    };
    root.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-abandon]');
      if (!act) return;
      const kind = act.getAttribute('data-abandon');
      if (kind === 'seguir') {
        done('seguir');
        return;
      }
      if (kind === 'despues') {
        _trackPapeleta('papeleta_draft_leave', { papeletaId: _detail?.id });
        done('despues');
        _gotoList();
        return;
      }
      if (kind === 'cancelar') {
        const ok = await _mexConfirm(
          'Cancelar papeleta',
          'Se liberará la unidad. Esta acción no se puede deshacer.',
          'warning'
        );
        if (!ok) return;
        let motivo = '';
        try {
          if (typeof window.mexPrompt === 'function') {
            motivo = await window.mexPrompt('Motivo', 'Motivo de cancelación (auditoría)', 'Abandono en patio');
          }
        } catch (_) {
          return;
        }
        if (motivo == null) return;
        try {
          await cancelarPapeleta(_detail.id, {
            user: _user(),
            motivo: String(motivo || 'cancelada desde flujo').trim(),
          });
          _trackPapeleta('papeleta_cancel', { papeletaId: _detail.id, motivo: String(motivo || '').slice(0, 120) });
          done('cancelar');
          await _mexAlert('Cancelada', 'Papeleta cancelada y unidad liberada.');
          _gotoList();
        } catch (err) {
          await _mexAlert('Error', err.message || String(err));
        }
      }
    });
  });
}

/** Best-effort metrics via bitacora_gestion + CustomEvent (ops_events is client-write locked). */
function _trackPapeleta(event, details = {}) {
  try {
    window.dispatchEvent(new CustomEvent('mex:papeleta-metric', { detail: { event, ...details } }));
  } catch (_) { /* ignore */ }
  try {
    const db = window._db;
    if (!db) return;
    const now = Date.now();
    const autor = _user()?.nombre || _user()?.uid || 'sistema';
    db.collection('bitacora_gestion').add({
      fecha: new Date(now).toISOString(),
      timestamp: now,
      tipo: 'papeletas',
      accion: String(event || 'event'),
      autor: String(autor),
      entidad: 'papeleta',
      referencia: String(details.papeletaId || _detail?.id || ''),
      detalles: {
        ...details,
        plazaId: String(getCurrentPlaza() || ''),
      },
      plaza: String(getCurrentPlaza() || ''),
      userDocId: String(_user()?.uid || window._auth?.currentUser?.uid || ''),
      userEmail: String(window._auth?.currentUser?.email || ''),
      role: String(_role() || ''),
    }).catch(() => { /* patio roles may lack bitacora write — OK */ });
  } catch (_) { /* ignore */ }
}

async function _flowNext() {
  if (!_detail) return;
  if (_wizardStep === 'fotos_firma' && _step6Phase === 'exito') {
    _gotoList();
    return;
  }
  if (_wizardStep === 'fotos_firma' && _step6Phase === 'firma') {
    await _confirmFirma();
    return;
  }
  if (_wizardStep === 'fotos_firma' && _step6Phase === 'resumen') {
    await _startEntregar();
    return;
  }
  if (_wizardStep === 'fotos_firma' && _step6Phase === 'fotos') {
    _step6Phase = 'resumen';
    _trackPapeleta('papeleta_step_completed', { step: 'fotos', papeletaId: _detail.id });
    _render();
    return;
  }

  try {
    if (_wizardStep === 'datos') {
      await _saveStepDatos();
      _wizardStep = 'km_gas';
      _trackPapeleta('papeleta_step_completed', { step: 'datos', papeletaId: _detail.id });
    } else if (_wizardStep === 'km_gas') {
      const ok = await _saveStepKmGas();
      if (!ok) return;
      _wizardStep = 'checklist';
      _trackPapeleta('papeleta_step_completed', { step: 'km_gas', papeletaId: _detail.id });
    } else if (_wizardStep === 'checklist') {
      await _saveCheck();
      _trackPapeleta('papeleta_step_completed', { step: 'checklist', papeletaId: _detail.id });
      return; // _saveCheck advances
    } else if (_wizardStep === 'danos') {
      await _saveDanos();
      _wizardStep = 'fotos_firma';
      _step6Phase = 'fotos';
      _trackPapeleta('papeleta_step_completed', { step: 'danos', papeletaId: _detail.id });
    }
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
    return;
  }
  _render();
}

async function _saveStepDatos() {
  if (!_detail) return;
  const patch = {};
  _container.querySelectorAll('[data-field]').forEach((el) => {
    patch[el.dataset.field] = el.value.trim();
  });
  _saveState = 'saving';
  try {
    if (patch.clienteNombre != null) {
      await asignarCliente(_detail.id, patch.clienteNombre, {
        user: _user(),
        plazaId: String(getCurrentPlaza() || ''),
      });
      delete patch.clienteNombre;
    }
    const clean = {};
    if (patch.contrato != null) clean.contrato = patch.contrato;
    if (Object.keys(clean).length) {
      await actualizarPapeleta(_detail.id, clean, {
        user: _user(),
        knownRevision: _detail.revision,
        plazaId: String(getCurrentPlaza() || ''),
      });
    }
    _saveState = 'saved';
  } catch (e) {
    _saveState = e?.code === 'REVISION_CONFLICT' ? 'conflict' : 'idle';
    throw e;
  }
}

async function _saveStepKmGas() {
  if (!_detail) return false;
  const kmRaw = _container.querySelector('#papKmSalida')?.value ?? '';
  const gasRaw = _container.querySelector('#papGasSalida')?.value ?? '';
  const kmDigits = String(kmRaw).replace(/\D+/g, '');
  const km = kmDigits === '' ? null : Number(kmDigits);
  if (km == null || !Number.isFinite(km)) {
    await _mexAlert('KM requerido', 'Captura el kilometraje para continuar.');
    return false;
  }
  if (gasRaw == null || String(gasRaw).trim() === '') {
    await _mexAlert('Gas requerido', 'Selecciona el nivel de gasolina.');
    return false;
  }
  if (kmTableroRetakeNeeded(_detail, km)) {
    const ok = await _mexConfirm(
      'KM cambió',
      'El KM cambió después de la foto de tablero. Se recomienda retomar la foto. ¿Continuar de todos modos?',
      'warning'
    );
    if (!ok) return false;
  }
  const tableroOk = String(_detail.zonas?.tablero_kilometraje?.fotoPath || _detail.fotoTableroPath || '').trim();
  if (!tableroOk) {
    await _mexAlert('Foto de tablero', 'Toma la foto del tablero antes de continuar.');
    return false;
  }
  _pendingSalida = { km, gas: gasRaw };
  _saveState = 'saving';
  try {
    await actualizarPapeleta(_detail.id, {
      salida: { km, gas: gasRaw },
    }, { user: _user(), knownRevision: _detail.revision });
    _saveState = 'saved';
    return true;
  } catch (e) {
    _saveState = e?.code === 'REVISION_CONFLICT' ? 'conflict' : 'idle';
    throw e;
  }
}

async function _captureTableroFoto() {
  if (!_detail || !puedeEditar(_detail.status)) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    _busy = true; _saveState = 'saving'; _render();
    try {
      const path = await uploadZonaFoto(_detail.id, 'tablero_kilometraje', file);
      const zonas = { ...(_detail.zonas || {}) };
      zonas.tablero_kilometraje = {
        ...(zonas.tablero_kilometraje || { estado: 'ok', nota: '' }),
        fotoPath: path,
        capturedAt: Date.now(),
      };
      await actualizarPapeleta(_detail.id, { zonas }, { user: _user(), knownRevision: _detail.revision });
      _saveState = 'saved';
    } catch (e) {
      _saveState = 'idle';
      await _mexAlert('Error', e.message || String(e));
    } finally {
      _busy = false; _render();
    }
  };
  input.click();
}

async function _saveDanos() {
  if (!_detail || !puedeEditar(_detail.status)) return;
  const strokes = _diagramApi ? _diagramApi.getStrokes() : (_localStrokes || _detail.diagramaStrokes || []);
  const danos = _diagramApi?.getDamages
    ? _diagramApi.getDamages()
    : (Array.isArray(_detail.danosMarcados) ? _detail.danosMarcados : []);
  _localStrokes = strokes;
  _saveState = 'saving';
  _busy = true; _render();
  try {
    await actualizarPapeleta(_detail.id, {
      diagramaStrokes: strokes,
      danosMarcados: danos,
      danosLastDisplayNumber: Number(_detail.danosLastDisplayNumber) || nextDisplayNumber(danos, 0) - 1,
    }, { user: _user(), knownRevision: _detail.revision });
    _saveState = 'saved';
  } catch (e) {
    _saveState = e?.code === 'REVISION_CONFLICT' ? 'conflict' : 'idle';
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _saveDatos() {
  await _saveStepDatos();
  _wizardStep = 'km_gas';
  _render();
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
    else {
      _wizardStep = 'fotos_firma';
      _step6Phase = 'resumen';
    }
  }
  return cur;
}

function _openGuidedCamera() {
  if (!_detail || !puedeEditar(_detail.status)) return;
  _closeGuidedCamera();
  const coreZones = ZONAS_CORE.map((id) => ({
    id,
    label: ZONA_CORE_LABELS[id] || id,
  }));
  // Slot opcional post-herramienta
  coreZones.push({ id: 'refaccion', label: 'Refacción (opc.)', optional: true });
  const pending = coreZones.findIndex((z) =>
    z.id !== 'refaccion' && !String(_detail.zonas?.[z.id]?.fotoPath || '').trim()
  );
  const startIndex = pending >= 0 ? pending : 0;
  _cameraApi = openGuidedCamera({
    zones: coreZones,
    hardZoneIds: [...ZONAS_CORE],
    startIndex,
    hasFoto: (zonaId) => !!String(_detail?.zonas?.[zonaId]?.fotoPath || '').trim(),
    onCapture: async (zona, index, file) => {
      const zonas = { ...(_detail.zonas || {}) };
      const cur = { ...(zonas[zona.id] || { estado: 'ok', nota: '', fotoPath: '' }) };
      // Optimistic local path marker so hasFoto advances before upload finishes
      cur.fotoPath = cur.fotoPath || `pending:${zona.id}`;
      cur.capturedAt = Date.now();
      zonas[zona.id] = cur;
      if (_detail) _detail.zonas = zonas;
      cur.fotoPath = await uploadZonaFoto(_detail.id, zona.id, file);
      zonas[zona.id] = cur;
      await actualizarPapeleta(_detail.id, { zonas }, { user: _user(), knownRevision: _detail.revision });
      if (_detail) _detail.zonas = zonas;
    },
    onSkip: (_zona, index) => { _zonaIdx = index; },
    onMarkDamage: async (zona) => {
      _gotoMobileScreen('diagrama');
      await _mexAlert('Daño', `Marca el daño en el diagrama. Zona: ${zona.label}`);
    },
    onDamageExtra: () => {
      _gotoMobileScreen('diagrama');
    },
    onComplete: () => {
      _gotoMobileScreen('resumen');
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
    else {
      _wizardStep = 'fotos_firma';
      _step6Phase = 'resumen';
    }
  } catch (e) {
    await _mexAlert('Error', e.message || String(e));
  } finally {
    _busy = false; _render();
  }
}

async function _saveCheck() {
  if (!_detail) return;
  const checklist = { ...(_detail.checklist || {}) };
  // Prefer in-memory ternary toggles already on _detail.checklist
  CHECKLIST_KEYS.forEach((k) => {
    if (checklist[k] == null) checklist[k] = _detail.checklist?.[k] || '';
  });
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
  const tapetesUsoRudo = tapetesUsoRudoRaw === '' ? null : Number(String(tapetesUsoRudoRaw).replace(/\D+/g, '').slice(0, 1));
  const tapetesAlfombra = tapetesAlfombraRaw === '' ? null : Number(String(tapetesAlfombraRaw).replace(/\D+/g, '').slice(0, 1));
  const notasInteriores = _container.querySelector('[data-field="notasInteriores"]')?.value?.trim() || '';

  if (!isChecklistComplete({
    checklist,
    marcasLlantas,
    tapetesUsoRudo,
    tapetesAlfombra,
  })) {
    await _mexAlert('Checklist incompleto', 'Marca todos los accesorios, las 4 llantas y tapetes (0–9; 0 = no tiene).');
    return;
  }

  _busy = true; _saveState = 'saving'; _render();
  try {
    await actualizarPapeleta(_detail.id, {
      checklist,
      marcasLlantas,
      tapetesUsoRudo: Number.isFinite(tapetesUsoRudo) ? tapetesUsoRudo : null,
      tapetesAlfombra: Number.isFinite(tapetesAlfombra) ? tapetesAlfombra : null,
      notasInteriores,
    }, { user: _user(), knownRevision: _detail.revision });
    _saveState = 'saved';
    _wizardStep = 'danos';
  } catch (e) {
    _saveState = e?.code === 'REVISION_CONFLICT' ? 'conflict' : 'idle';
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
    await _mexAlert('Falta completar', 'Completa KM, gas, checklist, foto de tablero y las 7 fotos core antes de entregar.');
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
  _sigStrokePoints = 0;
  _wizardStep = 'fotos_firma';
  _step6Phase = 'firma';
  _render();
}

function _bindSignature() {
  const canvas = _container?.querySelector('#papSig');
  if (!canvas || canvas.dataset.bound === '1') return;
  canvas.dataset.bound = '1';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  _sigStrokePoints = 0;

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * (canvas.width / r.width), y: (src.clientY - r.top) * (canvas.height / r.height) };
  };

  const lockScroll = () => { document.body.classList.add('pap-sig-lock'); };
  const unlockScroll = () => { document.body.classList.remove('pap-sig-lock'); };

  const start = (e) => {
    e.preventDefault();
    lockScroll();
    _sigDrawing = true;
    _sigStrokePoints = 0;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!_sigDrawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    _sigStrokePoints += 1;
    if (_sigStrokePoints > 2) _sigHasInk = true;
  };
  const end = () => {
    _sigDrawing = false;
    unlockScroll();
    if (_sigStrokePoints <= 2) {
      _sigHasInk = false;
    }
  };

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
  const consent = _container?.querySelector('#papConsent');
  if (consent && !consent.checked) {
    await _mexAlert('Consentimiento', 'Debes aceptar el recibo de la unidad antes de confirmar.');
    return;
  }
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
    const signerName = String(_container.querySelector('#papSignerName')?.value || _detail.clienteNombre || _user().nombre || '').trim();
    const signerRole = String(_container.querySelector('#papSignerRole')?.value || 'Cliente').trim();
    const firma = {
      imagePath: firmaPath,
      signerName,
      signerRole,
      signedAt: new Date().toISOString(),
      capturedBy: _user().uid || '',
      consentTextVersion: 'v3-recibo-caracteristicas',
      consentAccepted: true,
    };
    const result = await finalizeDelivery(papeletaId, {
      quienEntrega: _user().nombre,
      km: kmRaw === '' || kmRaw == null ? null : Number(kmRaw),
      gas: gasRaw || null,
      firma,
      confirmedWarnings,
      user: _user(),
      plazaId: String(getCurrentPlaza() || '').toUpperCase(),
    });
    if (result.alreadyFinalized) {
      await _mexAlert('Ya entregada', 'Esta papeleta ya estaba finalizada.');
      _trackPapeleta('papeleta_finalize_already', { papeletaId });
    } else {
      const firmaUrl = await getDownloadUrl(firmaPath);
      await openPapeletaPdf(result.papeleta || {
        ..._detail,
        status: 'entregada',
        salida: { ...(_detail.salida || {}), firma, firmaPath, km: kmRaw, gas: gasRaw },
      }, { firmaUrl });
      _trackPapeleta('papeleta_finalize_success', { papeletaId });
    }
    _pendingSalida = { km: null, gas: null };
    _wizardStep = 'fotos_firma';
    _step6Phase = 'exito';
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

function _ensureEntradaCompareDraft(p) {
  if (!_entradaCompareDraft.length && p) {
    const salidaMarks = Array.isArray(p.danosMarcados) ? p.danosMarcados : [];
    const existing = Array.isArray(p.entrada?.danosMarcados) ? p.entrada.danosMarcados : [];
    if (existing.length) {
      _entradaCompareDraft = existing.map((d) => ({ ...d }));
    } else {
      _entradaCompareDraft = salidaMarks.map((d) => ({
        id: `e_${d.id}`,
        source: 'entrada',
        comparisonStatus: 'preexisting',
        sourceDamageId: d.id,
        damageType: d.damageType,
        severity: d.severity,
        displayNumber: d.displayNumber,
        note: '',
      }));
    }
  }
  return _entradaCompareDraft;
}

async function _saveEntrada() {
  if (!_detail) return;
  _ensureEntradaCompareDraft(_detail);
  // Capture form BEFORE busy re-render (otherwise inputs are wiped).
  const quienRecibe = String(
    _container.querySelector('#papQuienRecibe')?.value || _displayName() || ''
  ).trim();
  const km = Number(_container.querySelector('#papKmIn')?.value || 0) || null;
  const gas = _container.querySelector('#papGasIn')?.value || null;
  const notas = _container.querySelector('#papNotasIn')?.value || '';
  const danosMarcados = buildEntradaDamageComparison(
    _detail.danosMarcados || [],
    _entradaCompareDraft
  );
  _busy = true; _render();
  try {
    // Never touch salida.danosMarcados — comparison lives under entrada only
    await registrarEntrada(_detail.id, {
      quienRecibe,
      km,
      gas,
      notas,
      user: _user(),
      entradaExtra: { danosMarcados },
    });
    _entradaCompareDraft = [];
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

async function _confirmHeroUnit() {
  if (!_pendingUnit) return;
  const patched = { ..._pendingUnit };
  _container?.querySelectorAll('[data-hero-field]').forEach((inp) => {
    const key = inp.getAttribute('data-hero-field');
    if (!key) return;
    patched[key] = String(inp.value || '').trim();
  });
  const hadLocalEdits = ['mva', 'modelo', 'placas', 'color', 'vin'].some(
    (k) => String(patched[k] || '') !== String(_pendingUnit[k] || '')
  );
  _busy = true;
  _render();
  try {
    const openCount = await countReportesAbiertosUnidad(patched.id);
    if (openCount > 0) {
      _casoWarning = 'Hay caso Ventas abierto para esta unidad. Puedes crear la papeleta; el aviso permanece visible.';
    } else {
      _casoWarning = '';
    }
    const plaza = String(getCurrentPlaza() || '').toUpperCase();
    const { id } = await crearPapeleta({ unidad: patched, plazaId: plaza, user: _user() });
    if (hadLocalEdits) {
      try {
        await actualizarPapeleta(id, {
          mva: String(patched.mva || '').toUpperCase(),
          modelo: String(patched.modelo || ''),
          placas: String(patched.placas || '').toUpperCase(),
          color: String(patched.color || ''),
          vin: String(patched.vin || '').toUpperCase(),
          correccionesSoloPapeleta: true,
        }, { user: _user() });
      } catch (_) { /* create already has snapshot; patch best-effort */ }
    }
    _trackPapeleta('papeleta_unit_selected', { papeletaId: id, unidadId: patched.id, mva: patched.mva });
    _pendingUnit = null;
    _heroEditing = false;
    _showNueva = false;
    _mobileScreen = 'datos';
    _openDetail(id);
  } catch (e) {
    if (e.code === 'ACTIVE_EXISTS' && e.existing?.id) {
      await _mexAlert('Papeleta activa', 'Ya existe una papeleta activa. Se abrirá la existente.');
      _pendingUnit = null;
      _showNueva = false;
      _openDetail(e.existing.id);
    } else {
      await _mexAlert('Error', e.message || String(e));
    }
  } finally {
    _busy = false;
    if (_mode === 'nueva') _render();
  }
}

async function _crearDesdeUnidad(unitId) {
  const unit = _unitHits.find((u) => u.id === unitId);
  if (!unit) return;
  _pendingUnit = { ...unit };
  _heroEditing = false;
  _render();
}
