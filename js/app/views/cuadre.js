// ═══════════════════════════════════════════════════════════
//  /app/cuadre — Gestor de Flota SPA (versión completa)
//  Tabs: normal | externos | admin | historial | clásico
// ═══════════════════════════════════════════════════════════

import { getState, onPlazaChange } from '/js/app/app-state.js';
import { subscribeCuadre, getUnidadBitacora } from '/js/app/features/cuadre/cuadre-data.js';
import { obtenerCuadreAdminsData, obtenerHistorialCuadres } from '/js/core/database.js';

let _container            = null;
let _ctx                  = null;
let _s                    = null;
let _unsub                = null;
let _unsubPlaza           = null;
let _searchDebounce       = null;
let _autofillDebounce     = null;
let _headerSearchListener = null;

// ── State ────────────────────────────────────────────────────
function _fresh(plaza) {
  return {
    plaza,
    units:           [],
    adminUnits:      [],
    historyItems:    [],
    historyDate:     '',
    historyLoading:  false,
    loading:         true,
    adminLoading:    false,
    error:           '',
    tab:             'normal',   // 'normal' | 'externos' | 'admin' | 'historial'
    search:          '',
    pill:            'todos',
    colCat:          '',
    colMod:          '',
    colEst:          '',
    colUbi:          '',
    colPla:          '',
    colGas:          '',
    colOrigen:       '',
    sortCol:         'mva',
    sortDir:         'asc',
    selected:        new Set(),
    batchEstado:     '',
    batchSaving:     false,
    batchMsg:        null,
    edit:            null,
    editMode:        'modify',
    form:            { estado: '', gasolina: 'N/A', ubicacion: '', notas: '', borrarNotas: false },
    formOrig:        null,
    autofillQ:       '',
    autofillRes:     [],
    autofillLoading: false,
    saving:          false,
    saveMsg:         null,
    dropdown:        false,
    modal:           null,
    modalData:       null,
    extForm:         { mva: '', modelo: '', placas: '' },
    extSaving:       false,
    extMsg:          null,
    toasts:          [],
    _toastSeq:       0,
  };
}

// ── CSS ──────────────────────────────────────────────────────
function _ensureCss() {
  if (document.querySelector('link[data-app-cuadre-css]')) return;
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = '/css/app-cuadre.css';
  link.setAttribute('data-app-cuadre-css', '1');
  document.head.appendChild(link);
}

// ── Helpers ──────────────────────────────────────────────────
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function up(v) { return String(v || '').trim().toUpperCase(); }

function _isAdmin() {
  const role = up(getState().role || '');
  return ['PROGRAMADOR', 'JEFE_OPERACION', 'CORPORATIVO_USER'].includes(role)
    || window.mexPerms?.canDo?.('fleet_global_write') === true;
}

// ── Toast (in-place, no scroll reset) ────────────────────────
function _updateToastsInPlace() {
  if (!_container) return;
  const root = _container.querySelector('.cqv-root');
  if (!root) return;
  const existing = root.querySelector('.cqv-toasts');
  const html = _renderToasts();
  if (html) {
    if (existing) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      existing.replaceWith(tmp.firstElementChild);
    } else {
      root.insertAdjacentHTML('beforeend', html);
    }
  } else if (existing) {
    existing.remove();
  }
}

function _toast(text, ok = true, duration = 3500) {
  if (!_s) return;
  const id = ++_s._toastSeq;
  _s.toasts.push({ id, text, ok });
  _updateToastsInPlace();
  setTimeout(() => {
    if (!_s) return;
    _s.toasts = _s.toasts.filter(t => t.id !== id);
    _updateToastsInPlace();
  }, duration);
}

function _renderToasts() {
  if (!_s?.toasts?.length) return '';
  return `<div class="cqv-toasts">
    ${_s.toasts.map(t => `
      <div class="cqv-toast${t.ok ? '' : ' cqv-toast--error'}">${esc(t.text)}</div>
    `).join('')}
  </div>`;
}

// ── Panel-only re-render (no scroll reset) ───────────────────
function _renderPanelInPlace() {
  if (!_container) return;
  const existing = _container.querySelector('.cqv-panel-wrap');
  const overlay  = _container.querySelector('.cqv-overlay');
  const showPanel = _s.edit || _s.editMode === 'insert';
  if (showPanel) {
    const html = _renderPanel();
    if (existing) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      existing.replaceWith(tmp.firstElementChild);
    } else {
      _container.querySelector('.cqv-root')?.insertAdjacentHTML('beforeend',
        `<div class="cqv-overlay" id="cqvOverlay"></div>${html}`);
    }
    if (!overlay && showPanel) {
      _container.querySelector('#cqvOverlay')?.addEventListener('click', _closeEdit);
    }
    _bindPanel(_container);
  } else {
    existing?.remove();
    overlay?.remove();
  }
  _updateToastsInPlace();
}

// ── Filtering & sorting ──────────────────────────────────────
const PILL_LABELS = {
  todos:           'Todos',
  sucio:           '🧹 SUCIO',
  listo:           '✅ LISTO',
  mant:            '🔧 MANT.',
  traslado:        '🚛 TRASLADO',
  'doble-cero':    '🍃 DOBLE CERO',
  apartados:       '🔒 APARTADOS',
  urgente:         '⚡ URGENTE',
  resguardo:       '👀 RESGUARDO',
  taller:          '🏭 TALLER',
  'sin-ubicacion': '📍 SIN UBIC.',
};

function _matchPill(u, pill) {
  const e = up(u.estado), ubi = up(u.ubicacion), n = up(u.notas);
  if (pill === 'todos')          return true;
  if (pill === 'sucio')          return e === 'SUCIO';
  if (pill === 'listo')          return e === 'LISTO';
  if (pill === 'mant')           return e.includes('MANTEN') || e === 'MANTO' || e === 'MANTENIMIENTO';
  if (pill === 'traslado')       return e === 'TRASLADO';
  if (pill === 'doble-cero')     return n.includes('DOBLE CERO');
  if (pill === 'apartados')      return n.includes('APARTAD') || n.includes('RESERVAD');
  if (pill === 'urgente')        return n.includes('URGENTE');
  if (pill === 'resguardo')      return e === 'RESGUARDO';
  if (pill === 'taller')         return ubi.includes('TALLER') || e === 'MANTENIMIENTO' || e === 'RETENIDA';
  if (pill === 'sin-ubicacion')  return !ubi.trim();
  return true;
}

function _isExterno(u) {
  return up(u.tipo) === 'EXTERNO'
    || up(u.ubicacion).includes('EXTERNO')
    || up(u.origen) === 'EXTERNO';
}

const GAS_ORDER = ['F','15/16','7/8','3/4','H','1/2','1/4','1/8','E','N/A',''];
function _gasRank(v) {
  const i = GAS_ORDER.indexOf(String(v || '').trim().toUpperCase());
  return i === -1 ? GAS_ORDER.length : i;
}

function _visible() {
  const { units, search, pill, colCat, colMod, colEst, colUbi, colPla, colGas, colOrigen, sortCol, sortDir, tab } = _s;
  const q = up(search);

  let base = units;
  if (tab === 'externos') base = units.filter(_isExterno);

  let rows = base
    .filter(u => _matchPill(u, pill))
    .filter(u => !colCat    || up(u.categoria) === up(colCat))
    .filter(u => !colMod    || up(u.modelo).includes(up(colMod)))
    .filter(u => !colEst    || up(u.estado) === up(colEst))
    .filter(u => !colUbi    || up(u.ubicacion) === up(colUbi))
    .filter(u => !colPla    || up(u.placas).includes(up(colPla)))
    .filter(u => !colGas    || up(u.gasolina) === up(colGas))
    .filter(u => !colOrigen || (_isExterno(u) ? 'EXTERNO' : 'PATIO') === up(colOrigen))
    .filter(u => !q || [u.mva,u.modelo,u.placas,u.estado,u.ubicacion,u.notas]
      .some(v => up(v).includes(q)));

  rows.sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortCol === 'mva')      return dir * String(a.mva||'').localeCompare(String(b.mva||''));
    if (sortCol === 'placas')   return dir * String(a.placas||'').localeCompare(String(b.placas||''));
    if (sortCol === 'gasolina') return dir * (_gasRank(a.gasolina) - _gasRank(b.gasolina));
    return dir * String(a.mva||'').localeCompare(String(b.mva||''));
  });
  return rows;
}

function _uniq(field) {
  const tab = _s.tab;
  let base = _s.units;
  if (tab === 'externos') base = _s.units.filter(_isExterno);
  return [...new Set(base.map(u => up(u[field])).filter(Boolean))].sort();
}

// ── KPI helpers ───────────────────────────────────────────────
function _kpis() {
  const all = _s.units;
  return {
    total:     all.length,
    listos:    all.filter(u => up(u.estado) === 'LISTO').length,
    externos:  all.filter(_isExterno).length,
    resguardo: all.filter(u => up(u.estado) === 'RESGUARDO').length,
  };
}

// ── Empresa listas helpers ───────────────────────────────────
const ESTADOS_FALLBACK   = ['LISTO','SUCIO','MANTENIMIENTO','RESGUARDO','TRASLADO','VENTA','RETENIDA','NO ARRENDABLE','HYP','EN RENTA'];
const GASOLINAS_FALLBACK = ['F','15/16','7/8','3/4','H','1/4','1/8','E','N/A'];

function _getEstados() {
  const raw = window.MEX_CONFIG?.listas?.estados;
  if (!Array.isArray(raw) || !raw.length) return ESTADOS_FALLBACK;
  return raw
    .map(e => (typeof e === 'object' ? { id: e.id || e.nombre || String(e), orden: e.orden ?? 99 } : { id: String(e), orden: 99 }))
    .sort((a, b) => a.orden - b.orden)
    .map(e => e.id)
    .filter(Boolean);
}

function _getGasolinas() {
  const raw = window.MEX_CONFIG?.listas?.gasolinas;
  if (!Array.isArray(raw) || !raw.length) return GASOLINAS_FALLBACK;
  const vals = raw.map(v => String(typeof v === 'object' ? (v.nombre || v.id || v) : v).trim().toUpperCase()).filter(Boolean);
  return vals.length ? vals : GASOLINAS_FALLBACK;
}

function _getUbicaciones(plaza) {
  const raw = window.MEX_CONFIG?.listas?.ubicaciones;
  if (!Array.isArray(raw) || !raw.length) {
    return { fijas: ['PATIO','TALLER','AGENCIA','TALLER EXTERNO'], personas: [] };
  }
  const plazaUp = String(plaza || '').toUpperCase();
  const filtered = raw.filter(u => {
    const pid = String((typeof u === 'object' ? u.plazaId : null) || '').toUpperCase();
    return !pid || pid === 'ALL' || pid === plazaUp;
  });
  const parsed = filtered.map(u => typeof u === 'object' ? u : {
    nombre: u,
    isPlazaFija: ['PATIO','TALLER','AGENCIA','TALLER EXTERNO','HYP COBIAN'].includes(u),
  });
  return {
    fijas:    parsed.filter(u => u.isPlazaFija !== false).map(u => u.nombre || u.id).filter(Boolean),
    personas: parsed.filter(u => u.isPlazaFija === false).map(u => u.nombre || u.id).filter(Boolean),
  };
}

function _gasLabel(v) {
  const g = String(v || '').trim().toUpperCase();
  if (g === 'F') return 'F (Lleno)';
  if (g === 'H') return 'H (Medio)';
  if (g === 'E') return 'E (Vacío)';
  if (g === 'N/A') return 'N/A';
  return g;
}

function _renderEstadoOpts(selected) {
  return _getEstados().map(v =>
    `<option value="${esc(v)}"${selected === v ? ' selected' : ''}>${esc(v)}</option>`
  ).join('');
}

function _renderGasOpts(selected) {
  const vals = _getGasolinas();
  const grupos = { COMPLETO: [], MEDIO: [], BAJO: [], OTROS: [] };
  vals.forEach(v => {
    const g = v.toUpperCase();
    if (g === 'F') grupos.COMPLETO.push(v);
    else if (g === 'H' || g === '3/4' || g === '7/8' || g === '15/16') grupos.MEDIO.push(v);
    else if (g === 'E' || g === '1/4' || g === '1/8' || g === '1/2') grupos.BAJO.push(v);
    else if (g !== 'N/A') grupos.OTROS.push(v);
  });
  let html = `<option value="N/A"${selected === 'N/A' || !selected ? ' selected' : ''}>Seleccionar...</option>`;
  const addGroup = (label, arr) => {
    if (!arr.length) return;
    html += `<optgroup label="${label}">`;
    arr.forEach(v => { html += `<option value="${esc(v)}"${selected === v ? ' selected' : ''}>${_gasLabel(v)}</option>`; });
    html += `</optgroup>`;
  };
  if (grupos.COMPLETO.length || grupos.MEDIO.length || grupos.BAJO.length || grupos.OTROS.length) {
    addGroup('LLENO', grupos.COMPLETO);
    addGroup('MEDIO', grupos.MEDIO);
    addGroup('BAJO', grupos.BAJO);
    addGroup('OTROS', grupos.OTROS);
  } else {
    vals.filter(v => v !== 'N/A').forEach(v => {
      html += `<option value="${esc(v)}"${selected === v ? ' selected' : ''}>${_gasLabel(v)}</option>`;
    });
  }
  if (vals.includes('N/A')) {
    html += `<option value="N/A"${selected === 'N/A' ? ' selected' : ''}>N/A</option>`;
  }
  return html;
}

function _renderUbicacionOpts(selected, plaza) {
  const { fijas, personas } = _getUbicaciones(plaza);
  let html = `<option value="">Seleccionar...</option>`;
  if (fijas.length) {
    html += `<optgroup label="PLAZAS FIJAS">`;
    fijas.forEach(v => { html += `<option value="${esc(v)}"${selected === v ? ' selected' : ''}>${esc(v)}</option>`; });
    html += `</optgroup>`;
  }
  if (personas.length) {
    html += `<optgroup label="PERSONA RESPONSABLE">`;
    personas.forEach(v => { html += `<option value="${esc(v)}"${selected === v ? ' selected' : ''}>👤 ${esc(v)}</option>`; });
    html += `</optgroup>`;
  }
  return html;
}

function _canSave() {
  const { editMode, edit, form, formOrig } = _s;
  const { estado, ubicacion, gasolina, notas, borrarNotas } = form;
  if (editMode === 'insert') return !!(edit && estado && ubicacion);
  if (!estado || !ubicacion) return false;
  if (!formOrig) return !!(estado && ubicacion);
  return (
    estado      !== formOrig.estado      ||
    gasolina    !== formOrig.gasolina    ||
    ubicacion   !== formOrig.ubicacion   ||
    notas       !== formOrig.notas       ||
    borrarNotas !== formOrig.borrarNotas
  );
}

// ── Badge helpers ────────────────────────────────────────────
function _badgeCat(v) {
  const u = up(v);
  if (!u || u === 'S/C') return `<span class="cqv-badge cqv-badge--gray">S/C</span>`;
  return `<span class="cqv-badge cqv-badge--blue">${esc(v)}</span>`;
}
function _badgeGas(v) {
  const u = up(v);
  if (!u || u === 'N/A' || u === 'E') return `<span class="cqv-badge cqv-badge--red">${esc(v||'N/A')}</span>`;
  if (u === 'F')  return `<span class="cqv-badge cqv-badge--green">${esc(v)}</span>`;
  if (u === 'H' || u === '3/4') return `<span class="cqv-badge cqv-badge--yellow">${esc(v)}</span>`;
  return `<span class="cqv-badge cqv-badge--gray">${esc(v)}</span>`;
}
function _badgeEstado(v) {
  const u = up(v);
  if (u === 'LISTO')         return `<span class="cqv-badge cqv-badge--green">${esc(v)}</span>`;
  if (u === 'SUCIO')         return `<span class="cqv-badge cqv-badge--yellow">${esc(v)}</span>`;
  if (u === 'MANTENIMIENTO' || u === 'MANTO') return `<span class="cqv-badge cqv-badge--orange">${esc(v)}</span>`;
  if (u === 'RESGUARDO')     return `<span class="cqv-badge cqv-badge--gray">${esc(v)}</span>`;
  if (u === 'TRASLADO')      return `<span class="cqv-badge cqv-badge--purple">${esc(v)}</span>`;
  if (u === 'EXTERNO')       return `<span class="cqv-badge cqv-badge--orange">${esc(v)}</span>`;
  return `<span class="cqv-badge cqv-badge--blue">${esc(v)}</span>`;
}
function _badgeUbi(v) {
  if (!v) return `<span class="cqv-badge cqv-badge--gray">—</span>`;
  return `<span class="cqv-badge cqv-badge--blue">${esc(v)}</span>`;
}

// ── Sub-renderers ────────────────────────────────────────────
function _renderKpis() {
  if (_s.loading) return '';
  const k = _kpis();
  return `
    <div class="cqv-kpi-row">
      <div class="cqv-kpi-card">
        <div class="cqv-kpi-num">${k.total}</div>
        <div class="cqv-kpi-lbl">Total</div>
      </div>
      <div class="cqv-kpi-card cqv-kpi-card--green">
        <div class="cqv-kpi-num">${k.listos}</div>
        <div class="cqv-kpi-lbl">Listos</div>
      </div>
      <div class="cqv-kpi-card cqv-kpi-card--purple">
        <div class="cqv-kpi-num">${k.externos}</div>
        <div class="cqv-kpi-lbl">Externos</div>
      </div>
      <div class="cqv-kpi-card cqv-kpi-card--gray">
        <div class="cqv-kpi-num">${k.resguardo}</div>
        <div class="cqv-kpi-lbl">Resguardo</div>
      </div>
    </div>`;
}

function _renderDropdown() {
  if (!_s.dropdown) return '';
  const isAdm = _isAdmin();
  return `
    <div class="cqv-dropdown" id="cqvDd">
      <div class="cqv-dd-section">CUADRE</div>
      <button class="cqv-dd-item" data-action="dd-movimientos">📋 Registros / Movimientos</button>
      <button class="cqv-dd-item" data-action="dd-validar">✅ Validar Cuadre Actual</button>
      <button class="cqv-dd-item" data-action="dd-resumen">📊 Resumen Flota</button>
      <button class="cqv-dd-item" data-action="dd-export-csv">⬇️ Exportar CSV</button>
      <button class="cqv-dd-item" data-action="dd-copy-resumen">📎 Copiar Resumen</button>
      <div class="cqv-dd-sep"></div>
      <div class="cqv-dd-section">UNIDADES</div>
      <button class="cqv-dd-item" data-action="dd-externa">➕ Insertar Unidad Externa</button>
      ${isAdm ? `
        <button class="cqv-dd-item" data-action="dd-insert-global">🌐 Insertar Unidad Global</button>
        <button class="cqv-dd-item cqv-dd-item--danger" data-action="dd-delete-global">🗑️ Eliminar Globales</button>
      ` : ''}
      <div class="cqv-dd-sep"></div>
      <button class="cqv-dd-item" data-action="dd-clasico">🔗 Abrir Cuadre Clásico</button>
    </div>`;
}

function _renderBatchBar() {
  const { selected, batchEstado, batchSaving, batchMsg } = _s;
  if (!selected.size) return '';
  return `
    <div class="cqv-batch-bar">
      <span class="cqv-batch-count">${selected.size} seleccionada${selected.size !== 1 ? 's' : ''}</span>
      <select id="cqvBatchEst" class="cqv-batch-select">
        <option value="">Estado...</option>
        ${_getEstados().map(v => `<option value="${esc(v)}"${batchEstado === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}
      </select>
      <button class="cqv-batch-btn" data-action="batch-apply" ${batchSaving ? 'disabled' : ''}>
        ${batchSaving ? '⏳' : '✓'} Aplicar
      </button>
      <button class="cqv-batch-btn cqv-batch-btn--clear" data-action="batch-clear">✕ Limpiar</button>
      ${batchMsg ? `<span class="cqv-batch-msg${batchMsg.ok ? '' : ' cqv-batch-msg--err'}">${esc(batchMsg.text)}</span>` : ''}
    </div>`;
}

function _renderPanel() {
  const { edit, editMode, form, saving, saveMsg, autofillQ, autofillRes, autofillLoading, tab } = _s;
  const units  = _s.units;
  const total  = units.length;
  const listos = units.filter(u => up(u.estado) === 'LISTO').length;
  const isInsert = editMode === 'insert';
  const mvaLabel = edit ? up(edit.mva) : '';

  return `
    <div class="cqv-panel-wrap">
      <div class="cqv-panel">
        <div class="cqv-panel-header">
          <h3 class="cqv-panel-title">
            ${isInsert ? 'NUEVO REGISTRO' : `MODIFICANDO: <span style="color:var(--cq-primary)">${esc(mvaLabel)}</span>`}
          </h3>
          <button class="cqv-panel-close" data-action="close-panel" title="Cerrar panel">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="cqv-stats-grid" style="margin-bottom:12px">
          <div class="cqv-stat-box">
            <div class="cqv-stat-num">${total}</div>
            <div class="cqv-stat-lbl">Total Flota</div>
          </div>
          <div class="cqv-stat-box cqv-stat-box--green">
            <div class="cqv-stat-num cqv-stat-num--green">${listos}</div>
            <div class="cqv-stat-lbl">Listos Renta</div>
          </div>
        </div>

        <div class="cqv-form-panel">
          <div class="cqv-form-header">
            ${isInsert ? `
              <div style="margin-bottom:10px">
                <label class="cqv-form-label">Buscar en base maestra</label>
                <div style="position:relative">
                  <input id="cqvAutofillInput" class="cqv-form-input" placeholder="MVA, placas, modelo..." value="${esc(autofillQ)}">
                  ${edit ? `<button data-action="reset-autofill" class="cqv-form-reset-btn" title="Limpiar selección">✕</button>` : ''}
                </div>
                ${autofillLoading ? `<div class="cqv-autofill-loading">Buscando...</div>` : ''}
                ${autofillRes.length && !edit ? `
                  <div class="cqv-autofill-results">
                    ${autofillRes.map(r => `
                      <button class="cqv-autofill-item" data-autofill-mva="${esc(r.mva)}">
                        <strong>${esc(r.mva)}</strong>
                        <span>${esc(r.modelo||'')} ${r.placas ? '· '+r.placas : ''}</span>
                      </button>
                    `).join('')}
                  </div>
                ` : ''}
              </div>
            ` : ''}

            <div class="cqv-form-title">
              ${isInsert ? (edit ? `Registrando: ${esc(mvaLabel)}` : 'Busca la unidad arriba') : `Unidad seleccionada`}
            </div>
          </div>

          <div class="cqv-form-grid-2">
            <div>
              <label class="cqv-form-label">MVA</label>
              <input class="cqv-form-input cqv-form-input--locked" value="${esc(edit?.mva||'')}" disabled>
            </div>
            <div>
              <label class="cqv-form-label">Categoría</label>
              <input class="cqv-form-input cqv-form-input--locked" value="${esc(edit?.categoria||'')}" disabled>
            </div>
            <div>
              <label class="cqv-form-label">Modelo</label>
              <input class="cqv-form-input cqv-form-input--locked" value="${esc(edit?.modelo||'')}" disabled>
            </div>
            <div>
              <label class="cqv-form-label">Placas</label>
              <input class="cqv-form-input cqv-form-input--locked" value="${esc(edit?.placas||'')}" disabled>
            </div>
          </div>

          <div class="cqv-form-grid-2" style="margin-top:12px">
            <div>
              <label class="cqv-form-label">Estado</label>
              <select id="cqvFEst" class="cqv-form-select">
                <option value="">Seleccionar...</option>
                ${_renderEstadoOpts(form.estado)}
              </select>
            </div>
            <div>
              <label class="cqv-form-label">Gasolina</label>
              <select id="cqvFGas" class="cqv-form-select">
                ${_renderGasOpts(form.gasolina)}
              </select>
            </div>
          </div>

          <div style="margin-top:12px">
            <label class="cqv-form-label">Ubicación</label>
            <select id="cqvFUbi" class="cqv-form-select">
              ${_renderUbicacionOpts(form.ubicacion, _s.plaza)}
            </select>
          </div>

          <div style="margin-top:12px">
            <label class="cqv-form-label">Notas</label>
            <textarea id="cqvFNotas" class="cqv-form-textarea" rows="3" placeholder="Sin notas...">${esc(form.notas)}</textarea>
          </div>

          ${!isInsert ? `
            <div class="cqv-form-borrar-wrap" style="margin-top:10px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
                <input type="checkbox" id="cqvFBorrar" ${form.borrarNotas ? 'checked' : ''}>
                <label for="cqvFBorrar">Borrar historial de notas actual</label>
              </label>
            </div>
          ` : ''}

          ${saveMsg ? `
            <div class="cqv-save-msg${saveMsg.ok ? ' cqv-save-msg--ok' : ' cqv-save-msg--err'}">
              ${esc(saveMsg.text)}
            </div>
          ` : ''}
        </div>

        <div class="cqv-panel-footer">
          ${!isInsert ? `
            <button class="cqv-panel-btn cqv-panel-btn--danger cqv-panel-btn--sm" data-action="delete-unit">
              Eliminar
            </button>
          ` : ''}
          <button class="cqv-panel-btn cqv-panel-btn--primary" data-action="save-unit"
            ${(!_canSave() || saving) ? 'disabled' : ''} style="flex:1">
            ${saving ? '⏳ Guardando...' : (isInsert ? '✓ Registrar Unidad' : '✓ Guardar Cambios')}
          </button>
        </div>

        ${tab === 'admin' ? `
          <div style="margin-top:12px;padding:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e">
            ⚠️ En Cuadre Admins las acciones aplican sobre la flota administrativa.
          </div>
        ` : ''}
      </div>
    </div>`;
}

function _renderAdminTable() {
  const { adminLoading, adminUnits } = _s;
  if (adminLoading) return `<div class="cqv-loading"><span class="cqv-spinner"></span> Cargando admins...</div>`;
  if (!adminUnits.length) return `
    <div class="cqv-table-wrap">
      <table class="cqv-table">
        <tbody><tr><td class="cqv-empty" colspan="6">Sin datos de admins para esta plaza.</td></tr></tbody>
      </table>
    </div>`;

  const byAdmin = {};
  adminUnits.forEach(u => {
    const a = u.admin || 'General';
    if (!byAdmin[a]) byAdmin[a] = [];
    byAdmin[a].push(u);
  });

  return `
    <div class="cqv-table-wrap">
      <table class="cqv-table">
        <thead>
          <tr>
            <th>Admin</th><th>MVA</th><th>Modelo</th><th>Estado</th><th>Ubic.</th><th>Notas</th>
          </tr>
        </thead>
        <tbody>
          ${adminUnits.map((u, i) => `
            <tr class="cqv-row" data-mva="${esc(u.mva)}" style="--i:${i}">
              <td style="font-size:11px;color:#6b7280">${esc(u.admin||'—')}</td>
              <td class="cqv-td-mva">${esc(u.mva||'—')}</td>
              <td>${esc(u.modelo||'—')}</td>
              <td>${_badgeEstado(u.estado)}</td>
              <td>${_badgeUbi(u.ubicacion)}</td>
              <td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(u.notas||'—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      ${Object.keys(byAdmin).length ? `
        <div style="margin-top:16px">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:8px">Resumen por admin</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#f9fafb">
                <th style="padding:6px 10px;text-align:left;border:1px solid #e5e7eb">Admin</th>
                <th style="padding:6px 10px;text-align:center;border:1px solid #e5e7eb">Unidades</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(byAdmin).map(([admin, us]) => `
                <tr>
                  <td style="padding:6px 10px;border:1px solid #e5e7eb">${esc(admin)}</td>
                  <td style="padding:6px 10px;text-align:center;border:1px solid #e5e7eb">${us.length}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>`;
}

function _renderHistorialTable() {
  const { historyLoading, historyItems, historyDate } = _s;
  if (historyLoading) return `<div class="cqv-loading"><span class="cqv-spinner"></span> Cargando historial...</div>`;
  if (!historyItems.length) return `
    <div class="cqv-table-wrap">
      <table class="cqv-table">
        <tbody><tr><td class="cqv-empty" colspan="7">Sin historial de cuadre para esta plaza.</td></tr></tbody>
      </table>
    </div>`;

  const filtered = historyDate
    ? historyItems.filter(r => {
        const d = r.fecha || r._createdAt || '';
        return String(d).startsWith(historyDate);
      })
    : historyItems;

  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#6b7280">
        Filtrar por fecha:
        <input type="date" id="cqvHistoryDate" class="cqv-batch-select" value="${esc(historyDate)}"
          style="font-size:12px;padding:5px 8px">
      </label>
      ${historyDate ? `<button id="cqvHistoryClear" class="cqv-pill cqv-pill--clear" style="font-size:11px">✕ Limpiar fecha</button>` : ''}
      <span style="font-size:11px;color:#9ca3af">${filtered.length} registros</span>
    </div>
    <div class="cqv-table-wrap">
      <table class="cqv-table">
        <thead>
          <tr>
            <th>MVA</th><th>Estado</th><th>Ubicación</th><th>Gas</th><th>Autor</th><th>Notas</th><th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length ? filtered.map((r, i) => `
            <tr class="cqv-row" style="--i:${i}">
              <td class="cqv-td-mva">${esc(r.mva||'—')}</td>
              <td>${_badgeEstado(r.estado)}</td>
              <td>${_badgeUbi(r.ubicacion)}</td>
              <td>${_badgeGas(r.gasolina)}</td>
              <td style="font-size:11px;color:#6b7280">${esc(r.autor||r.updatedBy||'—')}</td>
              <td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(r.notas||'—')}</td>
              <td style="font-size:11px;color:#6b7280">${esc(_fmtDate(r.fecha||r._createdAt||r.updatedAt||''))}</td>
            </tr>
          `).join('') : `<tr><td colspan="7" class="cqv-empty">Sin registros para la fecha seleccionada.</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

function _fmtDate(v) {
  if (!v) return '—';
  try {
    if (typeof v.toDate === 'function') {
      return v.toDate().toLocaleString('es-MX', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
    }
    const d = new Date(v);
    if (!isNaN(d)) return d.toLocaleString('es-MX', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
  } catch (_) {}
  return String(v).slice(0, 16);
}

function _renderInfoModal() {
  const { modalData } = _s;
  if (!modalData) return '';
  return `
    <div class="cqv-modal-overlay" id="cqvModalOverlay">
      <div class="cqv-modal">
        <div class="cqv-modal-header">
          <h3 class="cqv-modal-title">${esc(modalData.title||'')}</h3>
          <button class="cqv-modal-close" data-action="close-modal">✕</button>
        </div>
        <div class="cqv-modal-body">
          ${modalData.bodyHtml || ''}
        </div>
      </div>
    </div>`;
}

function _renderExtModal() {
  const { extForm, extSaving, extMsg } = _s;
  return `
    <div class="cqv-modal-overlay" id="cqvModalOverlay">
      <div class="cqv-modal">
        <div class="cqv-modal-header">
          <h3 class="cqv-modal-title">Insertar Unidad Externa</h3>
          <button class="cqv-modal-close" data-action="close-modal">✕</button>
        </div>
        <div class="cqv-modal-body">
          <div style="display:flex;flex-direction:column;gap:12px">
            <div>
              <label class="cqv-form-label">MVA *</label>
              <input id="cqvExtMva" class="cqv-form-input" placeholder="MVA de la unidad externa" value="${esc(extForm.mva)}">
            </div>
            <div>
              <label class="cqv-form-label">Modelo</label>
              <input id="cqvExtModelo" class="cqv-form-input" placeholder="Ej: SEAT IBIZA" value="${esc(extForm.modelo)}">
            </div>
            <div>
              <label class="cqv-form-label">Placas</label>
              <input id="cqvExtPlacas" class="cqv-form-input" placeholder="Ej: ABC-123" value="${esc(extForm.placas)}">
            </div>
            ${extMsg ? `<div class="cqv-save-msg${extMsg.ok ? ' cqv-save-msg--ok' : ' cqv-save-msg--err'}">${esc(extMsg.text)}</div>` : ''}
            <button class="cqv-panel-btn cqv-panel-btn--primary" data-action="save-external" ${extSaving ? 'disabled' : ''}>
              ${extSaving ? '⏳ Insertando...' : '✓ Insertar externa'}
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

// ── Main render ──────────────────────────────────────────────
function _render() {
  if (!_container) return;

  const tableWrap = _container.querySelector('.cqv-table-wrap');
  const savedScroll = tableWrap?.scrollTop || 0;

  const rows = _visible();
  const { units, loading, error, tab, pill, colCat, colMod, colEst, colUbi, colPla, colGas, colOrigen,
          sortCol, sortDir, edit, selected, dropdown, modal } = _s;
  const cats  = _uniq('categoria');
  const mods  = _uniq('modelo');
  const ests  = _uniq('estado');
  const ubis  = _uniq('ubicacion');
  const origs = ['PATIO', 'EXTERNO'];

  const tabNeedsTable = tab === 'normal' || tab === 'externos';

  _container.innerHTML = `
    <div class="cqv-root">
      <div class="cqv-card">

        <div class="cqv-title-row">
          <h2 class="cqv-title">GESTIÓN DE FLOTA</h2>
          <div class="cqv-title-actions">
            <div class="cqv-dropdown-wrap" id="cqvDdWrap">
              <button class="cqv-more-btn" data-action="toggle-dropdown">
                Más Controles
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              ${_renderDropdown()}
            </div>
          </div>
        </div>

        ${_renderKpis()}

        <div class="cqv-tabs">
          <button class="cqv-tab${tab === 'normal'    ? ' cqv-tab--active' : ''}" data-tab="normal">🚗 FLOTA REGULAR</button>
          <button class="cqv-tab${tab === 'externos'  ? ' cqv-tab--active' : ''}" data-tab="externos">🌐 EXTERNOS</button>
          <button class="cqv-tab${tab === 'admin'     ? ' cqv-tab--active' : ''}" data-tab="admin">👑 ADMINS</button>
          <button class="cqv-tab${tab === 'historial' ? ' cqv-tab--active' : ''}" data-tab="historial">📋 HISTORIAL</button>
          <button class="cqv-tab cqv-tab--classic" data-tab="clasico">🔗 CLÁSICO</button>
        </div>

        ${tabNeedsTable ? `
          <div class="cqv-pills">
            ${Object.entries(PILL_LABELS).map(([id, label]) => `
              <button class="cqv-pill${pill === id ? ' cqv-pill--active' : ''}" data-pill="${esc(id)}">${label}</button>
            `).join('')}
            <button class="cqv-pill cqv-pill--clear" id="cqvClear" title="Limpiar todos los filtros">✕ Limpiar</button>
          </div>

          ${_renderBatchBar()}

          ${loading ? `<div class="cqv-loading"><span class="cqv-spinner"></span> Cargando flota...</div>` : ''}
          ${error   ? `<div class="cqv-error-msg">${esc(error)}</div>` : ''}

          ${!loading ? `
          <div class="cqv-table-wrap">
            <table class="cqv-table">
              <thead>
                <tr>
                  <th class="cqv-th-check"><input type="checkbox" id="cqvSelectAll" title="Seleccionar todos"></th>
                  <th class="cqv-th-sort${sortCol === 'mva' ? ' cqv-th-sort--active' : ''}" data-sort="mva">MVA ${sortCol === 'mva' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                  <th>
                    <select class="cqv-th-select" id="cqvColCat">
                      <option value="">CATEGORIA (ALL)</option>
                      ${cats.map(v => `<option value="${esc(v)}"${colCat === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}
                    </select>
                  </th>
                  <th>
                    <select class="cqv-th-select" id="cqvColMod">
                      <option value="">MODELO (ALL)</option>
                      ${mods.map(v => `<option value="${esc(v)}"${colMod === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}
                    </select>
                  </th>
                  <th>
                    <div class="cqv-th-sort-wrap">
                      <select class="cqv-th-select" id="cqvColPla">
                        <option value="">PLACAS (ALL)</option>
                        ${_uniq('placas').map(v => `<option value="${esc(v)}"${colPla === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}
                      </select>
                      <button class="cqv-th-sortbtn${sortCol === 'placas' ? ' cqv-th-sortbtn--active' : ''}" data-sort="placas" title="Ordenar por Placas">${sortCol === 'placas' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</button>
                    </div>
                  </th>
                  <th>
                    <div class="cqv-th-sort-wrap">
                      <select class="cqv-th-select" id="cqvColGas">
                        <option value="">GAS (ALL)</option>
                        ${GAS_ORDER.filter(v => v && _uniq('gasolina').map(up).includes(up(v))).map(v => `<option value="${esc(v)}"${colGas === up(v) ? ' selected' : ''}>${esc(v)}</option>`).join('')}
                      </select>
                      <button class="cqv-th-sortbtn${sortCol === 'gasolina' ? ' cqv-th-sortbtn--active' : ''}" data-sort="gasolina" title="Ordenar por Gas">${sortCol === 'gasolina' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</button>
                    </div>
                  </th>
                  <th>
                    <select class="cqv-th-select" id="cqvColEst">
                      <option value="">ESTADO (ALL)</option>
                      ${ests.map(v => `<option value="${esc(v)}"${colEst === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}
                    </select>
                  </th>
                  <th>
                    <select class="cqv-th-select" id="cqvColUbi">
                      <option value="">UBICACION (ALL)</option>
                      ${ubis.map(v => `<option value="${esc(v)}"${colUbi === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}
                    </select>
                  </th>
                  <th>
                    <select class="cqv-th-select" id="cqvColOrigen">
                      <option value="">ORIGEN (ALL)</option>
                      ${origs.map(v => `<option value="${esc(v)}"${colOrigen === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}
                    </select>
                  </th>
                </tr>
              </thead>
              <tbody>
                ${rows.length ? rows.map((u, i) => `
                  <tr class="cqv-row${edit && up(edit.mva) === up(u.mva) ? ' cqv-row--selected' : ''}${_isExterno(u) ? ' cqv-row--ext' : ''}" data-mva="${esc(u.mva)}" style="--i:${i}">
                    <td class="cqv-td-check" data-stop>
                      <input type="checkbox" class="cqv-row-check" data-check-mva="${esc(u.mva)}" ${selected.has(up(u.mva)) ? 'checked' : ''}>
                    </td>
                    <td class="cqv-td-mva">${esc(u.mva || 'S/MVA')}</td>
                    <td>${_badgeCat(u.categoria)}</td>
                    <td>${esc(u.modelo || '-')}</td>
                    <td class="cqv-td-placas">${esc(u.placas || '-')}</td>
                    <td>${_badgeGas(u.gasolina)}</td>
                    <td>${_badgeEstado(u.estado)}</td>
                    <td>${_badgeUbi(u.ubicacion)}</td>
                    <td><span class="cqv-badge${_isExterno(u) ? ' cqv-badge--orange' : ' cqv-badge--gray'}" style="font-size:10px">${_isExterno(u) ? 'EXT' : 'PATIO'}</span></td>
                  </tr>
                `).join('') : `
                  <tr><td colspan="9" class="cqv-empty">
                    ${tab === 'externos' ? 'Sin unidades externas en esta plaza.' : 'Sin unidades que coincidan con los filtros aplicados.'}
                  </td></tr>
                `}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${!loading ? `<button class="cqv-fab" data-action="add" title="Agregar unidad">+</button>` : ''}
        ` : tab === 'admin'     ? _renderAdminTable()
          : tab === 'historial' ? _renderHistorialTable()
          : ''}

      </div>

      ${edit || _s.editMode === 'insert' ? `<div class="cqv-overlay" id="cqvOverlay"></div>` : ''}
      ${(edit || _s.editMode === 'insert') ? _renderPanel() : ''}

      ${modal === 'insert-external' ? _renderExtModal() : modal === 'info' ? _renderInfoModal() : ''}

      ${_renderToasts()}
    </div>
  `;

  if (savedScroll) {
    const newWrap = _container.querySelector('.cqv-table-wrap');
    if (newWrap) newWrap.scrollTop = savedScroll;
  }

  _bind();
}

// ── Modal builders ───────────────────────────────────────────
function _buildValidarData() {
  const all = _s.units;
  const k = _kpis();
  const byEst = {};
  all.forEach(u => { const e = up(u.estado)||'SIN ESTADO'; byEst[e]=(byEst[e]||0)+1; });
  const topEst = Object.entries(byEst).sort((a,b)=>b[1]-a[1]).slice(0,8);
  return {
    title: `Validación Cuadre — ${_s.plaza||'—'}`,
    bodyHtml: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px">
          <div style="font-size:22px;font-weight:900;color:#16a34a">${k.listos}</div>
          <div style="font-size:11px;color:#166534;text-transform:uppercase;font-weight:700">Listos</div>
        </div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px">
          <div style="font-size:22px;font-weight:900;color:#1e293b">${k.total}</div>
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:700">Total</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f9fafb"><th style="padding:6px 10px;text-align:left;border:1px solid #e5e7eb">Estado</th><th style="padding:6px 10px;text-align:center;border:1px solid #e5e7eb">Unidades</th></tr></thead>
        <tbody>
          ${topEst.map(([k,v]) => `<tr><td style="padding:6px 10px;border:1px solid #e5e7eb">${esc(k)}</td><td style="padding:6px 10px;text-align:center;border:1px solid #e5e7eb;font-weight:700">${v}</td></tr>`).join('')}
        </tbody>
      </table>`,
  };
}

function _buildResumenData() {
  const all = _s.units;
  const byUbi = {};
  all.forEach(u => { const ub = u.ubicacion||'Sin ubicación'; byUbi[ub]=(byUbi[ub]||0)+1; });
  const topUbi = Object.entries(byUbi).sort((a,b)=>b[1]-a[1]).slice(0,10);
  return {
    title: `Resumen Flota — ${_s.plaza||'—'}`,
    bodyHtml: `
      <div style="font-size:13px;font-weight:600;margin-bottom:10px">Unidades por ubicación:</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f9fafb"><th style="padding:6px 10px;text-align:left;border:1px solid #e5e7eb">Ubicación</th><th style="padding:6px 10px;text-align:center;border:1px solid #e5e7eb">Cant.</th></tr></thead>
        <tbody>
          ${topUbi.map(([k,v]) => `<tr><td style="padding:6px 10px;border:1px solid #e5e7eb">${esc(k)}</td><td style="padding:6px 10px;text-align:center;border:1px solid #e5e7eb;font-weight:700">${v}</td></tr>`).join('')}
        </tbody>
      </table>`,
  };
}

function _buildBitacoraData(mva, rows) {
  if (!rows?.length) return {
    title: `Bitácora: ${mva}`,
    bodyHtml: `<p style="color:#6b7280;font-size:13px">Sin registros de movimiento para esta unidad.</p>`,
  };
  return {
    title: `Bitácora: ${mva}`,
    bodyHtml: `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:6px 8px;text-align:left;border:1px solid #e5e7eb">Fecha</th>
            <th style="padding:6px 8px;border:1px solid #e5e7eb">Estado</th>
            <th style="padding:6px 8px;border:1px solid #e5e7eb">Ubic.</th>
            <th style="padding:6px 8px;border:1px solid #e5e7eb">Autor</th>
            <th style="padding:6px 8px;border:1px solid #e5e7eb;max-width:160px">Notas</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td style="padding:6px 8px;border:1px solid #e5e7eb;white-space:nowrap">${esc(_fmtDate(r.fecha||r._createdAt||r.timestamp||''))}</td>
              <td style="padding:6px 8px;border:1px solid #e5e7eb">${_badgeEstado(r.estado||r.nuevoEstado||'—')}</td>
              <td style="padding:6px 8px;border:1px solid #e5e7eb">${esc(r.ubicacion||r.nuevaUbicacion||'—')}</td>
              <td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;color:#6b7280">${esc(r.autor||r.autorNombre||'—')}</td>
              <td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis">${esc(r.notas||r.detalle||'—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`,
  };
}

async function _openBitacoraModal(mva) {
  _s.modal    = 'info';
  _s.modalData = { title: `Cargando bitácora: ${mva}...`, bodyHtml: '<div style="padding:20px;text-align:center">⏳</div>' };
  _render();
  try {
    const rows = await getUnidadBitacora({ plaza: _s.plaza, mva, limit: 30 });
    if (!_s || _s.modal !== 'info') return;
    _s.modalData = _buildBitacoraData(mva, rows);
    _render();
  } catch (err) {
    if (!_s || _s.modal !== 'info') return;
    _s.modalData.bodyHtml = `<p style="color:#dc2626;font-size:13px;padding:16px">Error: ${esc(err?.message || String(err))}</p>`;
    _render();
  }
}

// ── Export CSV ───────────────────────────────────────────────
function _exportCsv() {
  const rows = _visible();
  if (!rows.length) { _toast('Sin filas para exportar.', false); return; }
  const headers = ['MVA','Categoria','Modelo','Placas','Gasolina','Estado','Ubicacion','Origen','Notas'];
  const csvRows = rows.map(u => [
    u.mva, u.categoria, u.modelo, u.placas, u.gasolina, u.estado, u.ubicacion,
    _isExterno(u) ? 'EXTERNO' : 'PATIO', u.notas,
  ]);
  const esc2 = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...csvRows].map(r => r.map(esc2).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `cuadre-${String(_s.plaza||'plaza').toLowerCase()}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  _toast(`✅ CSV exportado (${rows.length} filas)`, true);
}

// ── Copy resumen ─────────────────────────────────────────────
async function _copyResumen() {
  const rows = _visible();
  const byEst = {};
  rows.forEach(u => { const e = up(u.estado)||'SIN ESTADO'; byEst[e]=(byEst[e]||0)+1; });
  const top = Object.entries(byEst).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${k}:${v}`).join(' | ');
  const text = `Cuadre ${_s.plaza||'—'} · tab=${_s.tab} · total=${rows.length}${top ? ' · '+top : ''}`;
  try {
    await navigator.clipboard?.writeText?.(text);
    _toast('✅ Resumen copiado al portapapeles', true);
  } catch (_) {
    _toast('No se pudo copiar. Verifica permisos.', false);
  }
}

// ── Panel-only event bindings ────────────────────────────────
function _bindPanel(root) {
  const el = root || _container;

  el.querySelector('[data-action="close-panel"]')?.addEventListener('click', _closeEdit);
  el.querySelector('#cqvOverlay')?.addEventListener('click', _closeEdit);
  el.querySelector('[data-action="save-unit"]')?.addEventListener('click', _saveUnit);
  el.querySelector('[data-action="delete-unit"]')?.addEventListener('click', _deleteUnit);

  el.querySelector('#cqvFEst')?.addEventListener('change',    e => { _s.form.estado      = e.target.value; _renderPanelInPlace(); });
  el.querySelector('#cqvFGas')?.addEventListener('change',    e => { _s.form.gasolina    = e.target.value; _renderPanelInPlace(); });
  el.querySelector('#cqvFUbi')?.addEventListener('change',    e => { _s.form.ubicacion   = e.target.value; _renderPanelInPlace(); });
  el.querySelector('#cqvFNotas')?.addEventListener('input',   e => { _s.form.notas       = e.target.value; });
  el.querySelector('#cqvFNotas')?.addEventListener('change',  e => { _s.form.notas       = e.target.value; _renderPanelInPlace(); });
  el.querySelector('#cqvFBorrar')?.addEventListener('change', e => { _s.form.borrarNotas = e.target.checked; _renderPanelInPlace(); });

  el.querySelector('[data-action="reset-autofill"]')?.addEventListener('click', () => {
    _s.edit = null; _s.autofillQ = ''; _s.autofillRes = [];
    _s.form = { estado: '', gasolina: 'N/A', ubicacion: '', notas: '', borrarNotas: false };
    _s.saveMsg = null;
    _renderPanelInPlace();
  });

  el.querySelector('#cqvAutofillInput')?.addEventListener('input', e => {
    const val = e.target.value;
    _s.autofillQ = val;
    clearTimeout(_autofillDebounce);
    if (!val.trim()) { _s.autofillRes = []; _renderPanelInPlace(); return; }
    _autofillDebounce = setTimeout(() => _doAutofill(val), 300);
  });

  el.querySelectorAll('[data-autofill-mva]').forEach(btn =>
    btn.addEventListener('click', () => _selectAutofill(btn.dataset.autofillMva))
  );
}

// ── Full event bindings ──────────────────────────────────────
function _bind() {
  const el = _container;
  if (!el) return;

  el.querySelector('#cqvClear')?.addEventListener('click', () => {
    _s.search = ''; _s.pill = 'todos';
    _s.colCat = ''; _s.colMod = ''; _s.colEst = ''; _s.colUbi = '';
    _s.colPla = ''; _s.colGas = ''; _s.colOrigen = '';
    _s.sortCol = 'mva'; _s.sortDir = 'asc';
    _s.selected = new Set();
    _render();
  });

  el.querySelectorAll('[data-tab]').forEach(btn =>
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === 'clasico') { window.location.href = '/cuadre'; return; }
      _s.tab = tab;
      _s.selected = new Set();
      _s.edit = null;
      _s.editMode = 'modify';
      if (tab === 'admin' && !_s.adminUnits.length) _loadAdmin();
      else if (tab === 'historial' && !_s.historyItems.length) _loadHistorial();
      else _render();
    })
  );

  el.querySelectorAll('[data-pill]').forEach(btn =>
    btn.addEventListener('click', () => {
      _s.pill = btn.dataset.pill;
      _s.selected = new Set();
      _render();
    })
  );

  el.querySelectorAll('[data-sort]').forEach(btn =>
    btn.addEventListener('click', () => {
      const col = btn.dataset.sort;
      if (_s.sortCol === col) _s.sortDir = _s.sortDir === 'asc' ? 'desc' : 'asc';
      else { _s.sortCol = col; _s.sortDir = 'asc'; }
      _render();
    })
  );

  el.querySelector('#cqvColCat')?.addEventListener('change', e => { _s.colCat    = e.target.value; _render(); });
  el.querySelector('#cqvColMod')?.addEventListener('change', e => { _s.colMod    = e.target.value; _render(); });
  el.querySelector('#cqvColEst')?.addEventListener('change', e => { _s.colEst    = e.target.value; _render(); });
  el.querySelector('#cqvColUbi')?.addEventListener('change', e => { _s.colUbi    = e.target.value; _render(); });
  el.querySelector('#cqvColPla')?.addEventListener('change', e => { _s.colPla    = e.target.value; _render(); });
  el.querySelector('#cqvColGas')?.addEventListener('change', e => { _s.colGas    = e.target.value; _render(); });
  el.querySelector('#cqvColOrigen')?.addEventListener('change', e => { _s.colOrigen = e.target.value; _render(); });

  el.querySelectorAll('.cqv-row[data-mva]').forEach(row =>
    row.addEventListener('click', e => {
      if (e.target.closest('[data-stop]')) return;
      _openEdit(row.dataset.mva);
    })
  );

  el.querySelector('#cqvSelectAll')?.addEventListener('change', e => {
    const rows = _visible();
    if (e.target.checked) rows.forEach(u => _s.selected.add(up(u.mva)));
    else _s.selected = new Set();
    _render();
  });

  el.querySelectorAll('.cqv-row-check').forEach(cb =>
    cb.addEventListener('change', e => {
      e.stopPropagation();
      const mva = up(e.target.dataset.checkMva);
      if (e.target.checked) _s.selected.add(mva);
      else _s.selected.delete(mva);
      _render();
    })
  );

  el.querySelector('[data-action="add"]')?.addEventListener('click', () => {
    _s.editMode  = 'insert';
    _s.edit      = null;
    _s.formOrig  = null;
    _s.form      = { estado: '', gasolina: 'N/A', ubicacion: '', notas: '', borrarNotas: false };
    _s.autofillQ = ''; _s.autofillRes = [];
    _s.saveMsg   = null;
    _renderPanelInPlace();
  });

  // Dropdown
  el.querySelector('[data-action="toggle-dropdown"]')?.addEventListener('click', e => {
    e.stopPropagation();
    _s.dropdown = !_s.dropdown;
    _render();
  });

  el.querySelector('[data-action="dd-movimientos"]')?.addEventListener('click', () => {
    _s.dropdown = false;
    if (_s.edit) _openBitacoraModal(_s.edit.mva);
    else { _render(); _toast('Selecciona una unidad para ver sus movimientos.', false); }
  });
  el.querySelector('[data-action="dd-validar"]')?.addEventListener('click', () => {
    _s.dropdown = false;
    _s.modal    = 'info';
    _s.modalData = _buildValidarData();
    _render();
  });
  el.querySelector('[data-action="dd-resumen"]')?.addEventListener('click', () => {
    _s.dropdown = false;
    _s.modal    = 'info';
    _s.modalData = _buildResumenData();
    _render();
  });
  el.querySelector('[data-action="dd-export-csv"]')?.addEventListener('click', () => {
    _s.dropdown = false;
    _exportCsv();
    _render();
  });
  el.querySelector('[data-action="dd-copy-resumen"]')?.addEventListener('click', () => {
    _s.dropdown = false;
    _copyResumen();
    _render();
  });
  el.querySelector('[data-action="dd-externa"]')?.addEventListener('click', () => {
    _s.dropdown = false;
    _s.modal    = 'insert-external';
    _s.extForm  = { mva: '', modelo: '', placas: '' };
    _s.extMsg   = null;
    _render();
  });
  el.querySelector('[data-action="dd-insert-global"]')?.addEventListener('click', () => {
    _s.dropdown = false;
    if (typeof window.abrirModalInsertarGlobal === 'function') {
      window.abrirModalInsertarGlobal(); _render();
    } else {
      _s.editMode  = 'insert';
      _s.edit      = null; _s.formOrig = null;
      _s.form      = { estado: '', gasolina: 'N/A', ubicacion: '', notas: '', borrarNotas: false };
      _s.autofillQ = ''; _s.autofillRes = [];
      _s.saveMsg   = null;
      _render();
    }
  });
  el.querySelector('[data-action="dd-delete-global"]')?.addEventListener('click', () => {
    _s.dropdown = false;
    if (typeof window.abrirModalEliminarGlobal === 'function') {
      window.abrirModalEliminarGlobal(); _render();
    } else if (_s.selected.size > 0) {
      const mvas = [..._s.selected];
      if (!confirm(`¿Eliminar globalmente ${mvas.length} unidad(es)?\nEsta acción NO se puede deshacer.`)) { _render(); return; }
      window.api.ejecutarEliminacion(mvas, _autor(), _s.plaza)
        .then(() => { _s.selected = new Set(); _toast(`✅ ${mvas.length} unidades eliminadas.`, true); })
        .catch(err => _toast(`Error: ${err?.message || String(err)}`, false));
      _render();
    } else {
      _render();
      _toast('Selecciona unidades con el checkbox antes de eliminar.', false);
    }
  });
  el.querySelector('[data-action="dd-clasico"]')?.addEventListener('click', () => {
    window.location.href = '/cuadre';
  });

  // Batch
  el.querySelector('#cqvBatchEst')?.addEventListener('change', e => { _s.batchEstado = e.target.value; });
  el.querySelector('[data-action="batch-apply"]')?.addEventListener('click', _applyBatch);
  el.querySelector('[data-action="batch-clear"]')?.addEventListener('click', () => {
    _s.selected = new Set(); _s.batchEstado = ''; _s.batchMsg = null; _render();
  });

  // Historial date filter
  el.querySelector('#cqvHistoryDate')?.addEventListener('change', e => {
    _s.historyDate = e.target.value; _render();
  });
  el.querySelector('#cqvHistoryClear')?.addEventListener('click', () => {
    _s.historyDate = ''; _render();
  });

  // Modal
  el.querySelector('[data-action="close-modal"]')?.addEventListener('click', () => {
    _s.modal = null; _s.modalData = null; _render();
  });
  el.querySelector('#cqvModalOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'cqvModalOverlay') { _s.modal = null; _s.modalData = null; _render(); }
  });
  el.querySelector('#cqvExtMva')?.addEventListener('input',    e => { _s.extForm.mva    = e.target.value; });
  el.querySelector('#cqvExtModelo')?.addEventListener('input', e => { _s.extForm.modelo = e.target.value; });
  el.querySelector('#cqvExtPlacas')?.addEventListener('input', e => { _s.extForm.placas = e.target.value; });
  el.querySelector('[data-action="save-external"]')?.addEventListener('click', _saveExternal);

  if (_s.dropdown) {
    const closeDropdown = () => {
      document.removeEventListener('click', closeDropdown);
      if (!_s) return;
      _s.dropdown = false;
      _render();
    };
    document.addEventListener('click', closeDropdown);
  }

  _bindPanel(el);
}

// ── Actions ──────────────────────────────────────────────────
function _openEdit(mva) {
  const unit = (_s.units || []).find(u => up(u.mva) === up(mva));
  if (!unit) return;
  _s.edit     = unit;
  _s.editMode = 'modify';
  const form = {
    estado:      unit.estado || '',
    gasolina:    unit.gasolina || 'N/A',
    ubicacion:   unit.ubicacion || '',
    notas:       unit.notas || '',
    borrarNotas: false,
  };
  _s.form     = form;
  _s.formOrig = { ...form };
  _s.saveMsg  = null;
  _renderPanelInPlace();
}

function _closeEdit() {
  _s.edit      = null;
  _s.editMode  = 'modify';
  _s.saveMsg   = null;
  _s.formOrig  = null;
  _s.autofillQ = ''; _s.autofillRes = [];
  _renderPanelInPlace();
}

function _autor() {
  const profile = getState().profile || {};
  return profile.nombreCompleto || profile.nombre || profile.email || 'Sistema';
}

async function _saveUnit() {
  if (_s.saving) return;
  const { estado, gasolina, ubicacion, notas, borrarNotas } = _s.form;

  if (_s.editMode === 'insert') {
    if (!_s.edit) {
      _s.saveMsg = { text: 'Selecciona una unidad con la búsqueda primero.', ok: false };
      _renderPanelInPlace(); return;
    }
    if (!estado || !ubicacion) {
      _s.saveMsg = { text: 'Selecciona Estado y Ubicación.', ok: false };
      _renderPanelInPlace(); return;
    }
    _s.saving = true; _s.saveMsg = null; _renderPanelInPlace();
    try {
      const mva = _s.edit.mva;
      const result = await window.api.insertarUnidadDesdeHTML({
        mva, categ: _s.edit.categoria || '', modelo: _s.edit.modelo || '',
        placas: _s.edit.placas || '', gasolina, estado, ubicacion, notas,
        borrarNotas, autor: _autor(), responsableSesion: _autor(), plaza: _s.plaza,
      });
      const ok = typeof result === 'string' ? result.startsWith('EXITO') : result?.ok === true;
      _s.saveMsg = { text: ok ? `✅ ${mva} insertado.` : `Error: ${String(result)}`, ok };
      _s.saving  = false; _renderPanelInPlace();
      if (ok) setTimeout(() => { if (_s?.saveMsg?.ok) _closeEdit(); }, 1500);
    } catch (err) {
      _s.saveMsg = { text: `Error: ${err?.message || String(err)}`, ok: false };
      _s.saving  = false; _renderPanelInPlace();
    }
    return;
  }

  if (!_s.edit) return;
  if (!estado || !ubicacion) {
    _s.saveMsg = { text: 'Selecciona Estado y Ubicación antes de guardar.', ok: false };
    _renderPanelInPlace(); return;
  }
  _s.saving = true; _s.saveMsg = null; _renderPanelInPlace();
  try {
    const mva = _s.edit.mva;
    const result = await window.api.aplicarEstado(
      mva, estado, ubicacion, gasolina, notas, borrarNotas, _autor(), _autor(), _s.plaza
    );
    const ok = result === 'EXITO' || result?.ok === true;
    _s.saveMsg = { text: ok ? `✅ ${mva} guardado.` : `Error: ${String(result)}`, ok };
    _s.saving  = false;
    if (ok) {
      _s.form.borrarNotas = false;
      _renderPanelInPlace();
      setTimeout(() => { if (_s?.saveMsg?.ok) { _s.saveMsg = null; _renderPanelInPlace(); } }, 2500);
    } else {
      _renderPanelInPlace();
    }
  } catch (err) {
    _s.saveMsg = { text: `Error: ${err?.message || String(err)}`, ok: false };
    _s.saving  = false; _renderPanelInPlace();
  }
}

function _deleteUnit() {
  if (!_s.edit) return;
  const mva = _s.edit.mva;
  if (!confirm(`¿Eliminar la unidad ${mva} del cuadre? Esta acción no se puede deshacer.`)) return;
  window.api.ejecutarEliminacion([mva], _autor(), _s.plaza)
    .then(() => { _closeEdit(); })
    .catch(err => {
      _s.saveMsg = { text: `Error al eliminar: ${err?.message || String(err)}`, ok: false };
      _renderPanelInPlace();
    });
}

async function _applyBatch() {
  const { selected, batchEstado, plaza } = _s;
  if (!batchEstado) { _s.batchMsg = { text: 'Selecciona un estado.', ok: false }; _render(); return; }
  if (!selected.size) return;
  _s.batchSaving = true; _s.batchMsg = null; _render();
  const autor = _autor();
  const mvas  = [...selected];
  let errors  = 0;
  for (const mva of mvas) {
    try {
      const unit = (_s.units || []).find(u => up(u.mva) === mva);
      await window.api.aplicarEstado(
        mva, batchEstado, unit?.ubicacion || '', unit?.gasolina || 'N/A',
        unit?.notas || '', false, autor, autor, plaza
      );
    } catch (_) { errors++; }
  }
  _s.batchSaving = false;
  _s.batchMsg = errors
    ? { text: `${mvas.length - errors}/${mvas.length} aplicados (${errors} error${errors > 1 ? 'es' : ''}).`, ok: false }
    : { text: `✅ ${mvas.length} unidades actualizadas.`, ok: true };
  if (!errors) { _s.selected = new Set(); _s.batchEstado = ''; }
  _render();
  if (!errors) setTimeout(() => { if (_s) { _s.batchMsg = null; _render(); } }, 3000);
}

async function _saveExternal() {
  const { extForm, plaza } = _s;
  if (!extForm.mva.trim()) { _s.extMsg = { text: 'El MVA es obligatorio.', ok: false }; _render(); return; }
  _s.extSaving = true; _s.extMsg = null; _render();
  try {
    const result = await window.api.insertarUnidadExterna?.({
      mva: up(extForm.mva), modelo: extForm.modelo.trim(),
      placas: extForm.placas.trim(), plaza, autor: _autor(),
    });
    const ok = result === 'EXITO' || result?.ok === true || !result;
    _s.extMsg = { text: ok ? '✅ Unidad externa insertada.' : `Error: ${String(result)}`, ok };
    if (ok) setTimeout(() => { if (_s) { _s.modal = null; _s.modalData = null; _render(); } }, 1500);
  } catch (err) {
    _s.extMsg = { text: `Error: ${err?.message || String(err)}`, ok: false };
  }
  _s.extSaving = false; _render();
}

async function _loadAdmin() {
  if (!_s) return;
  _s.adminLoading = true; _render();
  try {
    const rows = await obtenerCuadreAdminsData(_s.plaza);
    if (!_s) return;
    _s.adminUnits = (Array.isArray(rows) ? rows : []).map((x, idx) => ({
      id:        String(x.id || x.mva || `adm_${idx}`),
      mva:       String(x.mva || '').toUpperCase().trim(),
      modelo:    String(x.modelo || x.unidad || '').trim(),
      categoria: String(x.categoria || '').trim(),
      placas:    String(x.placas || '').trim(),
      gasolina:  String(x.gasolina || '').trim(),
      estado:    String(x.estado || '').toUpperCase().trim(),
      ubicacion: String(x.ubicacion || '').trim(),
      notas:     String(x.notas || x.descripcion || '').trim(),
      admin:     String(x.admin || x.responsable || '').trim(),
      tipo:      'admin',
    }));
    _s.adminLoading = false;
    _render();
  } catch (err) {
    if (!_s) return;
    _s.adminLoading = false;
    _toast(`Error cargando admins: ${err?.message || String(err)}`, false);
    _render();
  }
}

async function _loadHistorial() {
  if (!_s) return;
  _s.historyLoading = true; _render();
  try {
    const rows = await obtenerHistorialCuadres(_s.plaza);
    if (!_s) return;
    _s.historyItems = (Array.isArray(rows) ? rows : []).map((x, idx) => ({
      id:        String(x.id || x.mva || `hist_${idx}`),
      mva:       String(x.mva || '').toUpperCase().trim(),
      modelo:    String(x.modelo || '').trim(),
      categoria: String(x.categoria || '').trim(),
      placas:    String(x.placas || '').trim(),
      gasolina:  String(x.gasolina || '').trim(),
      estado:    String(x.estado || x.nuevoEstado || '').toUpperCase().trim(),
      ubicacion: String(x.ubicacion || x.nuevaUbicacion || '').trim(),
      notas:     String(x.notas || x.detalle || x.accion || '').trim(),
      autor:     String(x.autor || x.autorNombre || x.updatedBy || '').trim(),
      fecha:     x.fecha || x._createdAt || x.updatedAt || x.timestamp || '',
    }));
    _s.historyLoading = false;
    _render();
  } catch (err) {
    if (!_s) return;
    _s.historyLoading = false;
    _toast(`Error cargando historial: ${err?.message || String(err)}`, false);
    _render();
  }
}

async function _doAutofill(q) {
  if (!_s) return;
  _s.autofillLoading = true; _renderPanelInPlace();
  try {
    const snap = await window._db.collection('index_unidades')
      .where('mva', '>=', up(q))
      .where('mva', '<=', up(q) + '')
      .limit(10).get();
    if (!_s) return;
    _s.autofillRes = snap.docs.map(d => ({ mva: d.data().mva || d.id, ...d.data() }));
  } catch (_) {
    if (!_s) return;
    _s.autofillRes = [];
  }
  _s.autofillLoading = false; _renderPanelInPlace();
}

function _selectAutofill(mva) {
  const found = _s.autofillRes.find(r => up(r.mva) === up(mva));
  if (!found) return;
  _s.edit = {
    mva:       up(found.mva),
    modelo:    found.modelo || '',
    placas:    found.placas || '',
    categoria: found.categoria || found.categ || '',
    estado:    '',
    gasolina:  'N/A',
    ubicacion: '',
    notas:     '',
  };
  _s.form = {
    estado:      '',
    gasolina:    'N/A',
    ubicacion:   '',
    notas:       '',
    borrarNotas: false,
  };
  _s.formOrig  = null;
  _s.autofillRes = [];
  _renderPanelInPlace();
}

// ── Mount / Unmount ──────────────────────────────────────────
export async function mount(ctx) {
  _ctx       = ctx;
  _container = ctx.container;
  _ensureCss();

  const state  = typeof ctx.state === 'function' ? ctx.state() : (ctx.state || {});
  const plaza  = String(state.currentPlaza || '').toUpperCase().trim();
  _s = _fresh(plaza);

  _render();

  // Live listener
  _unsub = subscribeCuadre({
    plaza,
    onData: rows => {
      if (!_s) return;
      _s.units   = Array.isArray(rows) ? rows : [];
      _s.loading = false;
      _s.error   = '';
      _render();
    },
    onError: err => {
      if (!_s) return;
      _s.loading = false;
      _s.error   = String(err?.message || err || 'Error al cargar datos');
      _render();
    },
  });

  // Plaza change listener
  _unsubPlaza = onPlazaChange(nextPlaza => {
    if (!_s) return;
    const np = String(nextPlaza || '').toUpperCase().trim();
    if (np === _s.plaza) return;
    // Reset state for new plaza
    const tab = _s.tab;
    _s = _fresh(np);
    _s.tab = tab;
    _render();
    if (_unsub) { try { _unsub(); } catch(_) {} _unsub = null; }
    _unsub = subscribeCuadre({
      plaza: np,
      onData: rows => {
        if (!_s) return;
        _s.units   = Array.isArray(rows) ? rows : [];
        _s.loading = false;
        _s.error   = '';
        _render();
      },
      onError: err => {
        if (!_s) return;
        _s.loading = false;
        _s.error   = String(err?.message || err || 'Error al cargar datos');
        _render();
      },
    });
  });

  // Header search integration
  _headerSearchListener = e => {
    if (!_s || !_container) return;
    const route = String(e?.detail?.route || '');
    if (!route.startsWith('/app/cuadre') && route !== '/cuadre') return;
    _s.search = String(e?.detail?.query || '');
    _render();
  };
  window.addEventListener('mex:global-search', _headerSearchListener);
}

export function unmount() {
  if (_unsub)      { try { _unsub(); }      catch(_) {} }
  if (_unsubPlaza) { try { _unsubPlaza(); } catch(_) {} }
  if (_headerSearchListener) window.removeEventListener('mex:global-search', _headerSearchListener);
  if (_searchDebounce)  clearTimeout(_searchDebounce);
  if (_autofillDebounce) clearTimeout(_autofillDebounce);
  _container            = null;
  _ctx                  = null;
  _s                    = null;
  _unsub                = null;
  _unsubPlaza           = null;
  _headerSearchListener = null;
}
