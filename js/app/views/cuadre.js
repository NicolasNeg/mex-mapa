// ═══════════════════════════════════════════════════════════
//  /app/cuadre — Gestor de Flota SPA
//  Estilo: ejemplo_css.html (light, white card, #232a85 blue)
// ═══════════════════════════════════════════════════════════

import { getState, onPlazaChange } from '/js/app/app-state.js';
import { subscribeCuadre, getUnidadBitacora } from '/js/app/features/cuadre/cuadre-data.js';

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
    units:        [],
    adminUnits:   [],
    loading:      true,
    adminLoading: false,
    error:        '',
    tab:          'normal',
    search:       '',
    pill:         'todos',
    colCat:       '',
    colMod:       '',
    colEst:       '',
    colUbi:       '',
    colPla:       '',
    colGas:       '',
    sortCol:      'mva',
    sortDir:      'asc',
    selected:     new Set(),
    batchEstado:  '',
    batchSaving:  false,
    batchMsg:     null,
    edit:         null,
    editMode:     'modify',   // 'modify' | 'insert'
    form:         { estado: '', gasolina: 'N/A', ubicacion: '', notas: '', borrarNotas: false },
    formOrig:     null,
    autofillQ:    '',
    autofillRes:  [],
    autofillLoading: false,
    saving:       false,
    saveMsg:      null,
    dropdown:     false,
    modal:        null,   // 'insert-external' | 'info'
    modalData:    null,   // { title, bodyHtml }
    extForm:      { mva: '', modelo: '', placas: '' },
    extSaving:    false,
    extMsg:       null,
    toasts:       [],
    _toastSeq:    0,
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

function _toast(text, ok = true) {
  if (!_s) return;
  const id = ++_s._toastSeq;
  _s.toasts = [..._s.toasts, { id, text, ok }];
  _updateToastsInPlace();
  setTimeout(() => {
    if (!_s) return;
    _s.toasts = _s.toasts.filter(t => t.id !== id);
    _updateToastsInPlace();
  }, 3200);
}

// ── Partial render: panel only (no table scroll reset) ───────
function _renderPanelInPlace() {
  const root = _container?.querySelector('.cqv-root');
  if (!root) { _render(); return; }

  const showPanel = !!(_s.edit || _s.editMode === 'insert');

  // Overlay
  let overlay = root.querySelector('#cqvOverlay');
  if (showPanel && !overlay) {
    overlay = document.createElement('div');
    overlay.className = 'cqv-overlay';
    overlay.id = 'cqvOverlay';
    overlay.addEventListener('click', _closeEdit);
    const anchor = root.querySelector('.cqv-modal-overlay') || root.querySelector('.cqv-toasts') || null;
    root.insertBefore(overlay, anchor);
  } else if (!showPanel && overlay) {
    overlay.remove();
  }

  // Panel
  const oldPanel = root.querySelector('#cqvPanel');
  if (showPanel) {
    const tmp = document.createElement('div');
    tmp.innerHTML = _renderPanel();
    const newPanel = tmp.firstElementChild;
    if (oldPanel) {
      oldPanel.replaceWith(newPanel);
    } else {
      const anchor = root.querySelector('.cqv-modal-overlay') || root.querySelector('.cqv-toasts') || null;
      root.insertBefore(newPanel, anchor);
    }
    _bindPanel(root);
  } else if (oldPanel) {
    oldPanel.remove();
  }

  // Row highlight
  root.querySelectorAll('.cqv-row[data-mva]').forEach(row => {
    row.classList.toggle('cqv-row--selected', !!(
      _s.edit && up(row.dataset.mva) === up(_s.edit.mva)
    ));
  });

  _updateToastsInPlace();
}

// ── Filtering & sorting ──────────────────────────────────────
const PILL_LABELS = {
  todos:        'Todos',
  sucio:        '🧹 SUCIO',
  listo:        '✅ LISTO',
  mant:         '🔧 MANT.',
  traslado:     '🚛 TRASLADO',
  'doble-cero': '🍃 DOBLE CERO',
  apartados:    '🔒 APARTADOS',
  urgente:      '⚡ URGENTE',
  resguardo:    '👀 RESGUARDO',
  taller:       '🏭 TALLER',
};

function _matchPill(u, pill) {
  const e = up(u.estado), ubi = up(u.ubicacion), n = up(u.notas);
  if (pill === 'todos')       return true;
  if (pill === 'sucio')       return e === 'SUCIO';
  if (pill === 'listo')       return e === 'LISTO';
  if (pill === 'mant')        return e.includes('MANTEN') || e === 'MANTO' || e === 'MANTENIMIENTO';
  if (pill === 'traslado')    return e === 'TRASLADO';
  if (pill === 'doble-cero')  return n.includes('DOBLE CERO');
  if (pill === 'apartados')   return n.includes('APARTAD') || n.includes('RESERVAD');
  if (pill === 'urgente')     return n.includes('URGENTE');
  if (pill === 'resguardo')   return e === 'RESGUARDO';
  if (pill === 'taller')      return ubi.includes('TALLER') || e === 'MANTENIMIENTO' || e === 'RETENIDA';
  return true;
}

const GAS_ORDER = ['F','15/16','7/8','3/4','H','1/2','1/4','1/8','E','N/A',''];
function _gasRank(v) {
  const i = GAS_ORDER.indexOf(String(v || '').trim().toUpperCase());
  return i === -1 ? GAS_ORDER.length : i;
}

function _visible() {
  const { units, search, pill, colCat, colMod, colEst, colUbi, colPla, colGas, sortCol, sortDir } = _s;
  const q = up(search);
  let rows = units
    .filter(u => _matchPill(u, pill))
    .filter(u => !colCat || up(u.categoria) === up(colCat))
    .filter(u => !colMod || up(u.modelo).includes(up(colMod)))
    .filter(u => !colEst || up(u.estado) === up(colEst))
    .filter(u => !colUbi || up(u.ubicacion) === up(colUbi))
    .filter(u => !colPla || up(u.placas).includes(up(colPla)))
    .filter(u => !colGas || up(u.gasolina) === up(colGas))
    .filter(u => !q || [u.mva, u.modelo, u.placas, u.categoria, u.estado, u.ubicacion, u.notas].map(up).join(' ').includes(q));

  rows.sort((a, b) => {
    let cmp = 0;
    if (sortCol === 'placas') {
      cmp = up(a.placas).localeCompare(up(b.placas), 'es');
    } else if (sortCol === 'gasolina') {
      cmp = _gasRank(a.gasolina) - _gasRank(b.gasolina);
    } else {
      cmp = up(a.mva).localeCompare(up(b.mva), 'es');
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });
  return rows;
}

function _uniq(key) {
  const s = new Set();
  (_s?.units || []).forEach(u => { const v = String(u[key] || '').trim(); if (v) s.add(v); });
  return [...s].sort((a, b) => a.localeCompare(b, 'es'));
}

// ── Badge renderers ──────────────────────────────────────────
function _badgeCat(v) {
  return `<span class="cqv-badge cqv-badge--gray">${esc(v || 'S/C')}</span>`;
}

function _badgeGas(v) {
  const g = up(v);
  if (g === 'F') return `<span class="cqv-badge cqv-badge--blue-light">F</span>`;
  if (g === 'E') return `<span class="cqv-badge cqv-badge--orange">E</span>`;
  return `<span class="cqv-badge cqv-badge--gray">${esc(v || 'N/A')}</span>`;
}

function _badgeEstado(v) {
  const e = up(v);
  if (e === 'LISTO')    return `<span class="cqv-badge cqv-badge--green">${esc(v)}</span>`;
  if (e === 'SUCIO')    return `<span class="cqv-badge cqv-badge--yellow">${esc(v)}</span>`;
  if (e.includes('MANTEN') || e === 'MANTO' || e === 'MANTENIMIENTO')
    return `<span class="cqv-badge cqv-badge--red">${esc(v)}</span>`;
  if (e === 'TRASLADO')  return `<span class="cqv-badge cqv-badge--purple">${esc(v)}</span>`;
  if (e === 'RESGUARDO') return `<span class="cqv-badge cqv-badge--brown">${esc(v)}</span>`;
  if (!v) return `<span class="cqv-badge cqv-badge--gray">S/E</span>`;
  return `<span class="cqv-text-status">${esc(v)}</span>`;
}

function _badgeUbi(v) {
  const u = up(v);
  if (!v) return `<span class="cqv-badge cqv-badge--gray">-</span>`;
  if (u.includes('TALLER')) return `<span class="cqv-badge cqv-badge--red">${esc(v)}</span>`;
  if (u === 'EXTERNO')      return `<span class="cqv-badge cqv-badge--orange">${esc(v)}</span>`;
  return `<span class="cqv-badge cqv-badge--blue">${esc(v)}</span>`;
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

// ── Sub-renderers ────────────────────────────────────────────
function _renderPanel() {
  const { edit, editMode, form, saving, saveMsg, autofillQ, autofillRes, autofillLoading, tab } = _s;
  const units  = _s.units;
  const total  = units.length;
  const listos = units.filter(u => up(u.estado) === 'LISTO').length;
  const canSave = _canSave();

  const formTitle = editMode === 'insert'
    ? 'NUEVO REGISTRO'
    : (edit ? `MODIFICANDO: ${esc(edit.mva)}` : 'SELECCIONA UNA UNIDAD');

  const showFields = (editMode === 'modify' && edit) || (editMode === 'insert' && edit);

  return `
    <div class="cqv-panel cqv-panel--open" id="cqvPanel">

      <div class="cqv-panel-head">
        <h3 class="cqv-panel-title">GESTOR DE UNIDAD</h3>
        <button class="cqv-panel-close" data-action="close-panel">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="cqv-stats-grid">
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
          <span class="cqv-form-title">${formTitle}</span>
        </div>

        ${tab === 'admin' ? `
        <div class="cqv-admin-hint">
          <span class="material-symbols-outlined">inventory_2</span>
          <div>
            <strong>Modo Cuadre Admins</strong>
            <p>El registro se hace desde el modal administrativo. Esta vista es de sólo lectura.</p>
          </div>
        </div>
        ` : ''}

        ${editMode === 'insert' ? `
        <div class="cqv-autofill-section">
          <label class="cqv-autofill-label">BUSCAR EN BASE MAESTRA 🔍</label>
          <div class="cqv-autofill-wrap">
            <input id="cqvAutofillInput" type="text" class="cqv-autofill-input"
              value="${esc(autofillQ)}" placeholder="Escribe MVA, Placas o Modelo...">
            ${autofillLoading ? '<span class="cqv-spinner-sm"></span>' : ''}
            ${edit ? `
            <button class="cqv-autofill-reset" data-action="reset-autofill" title="Cambiar unidad">
              <span class="material-symbols-outlined">close</span>
            </button>` : ''}
          </div>
          ${autofillRes.length ? `
          <div class="cqv-autofill-results" id="cqvAutofillResults">
            ${autofillRes.map(r => `
              <button class="cqv-autofill-item" data-autofill-mva="${esc(r.mva)}">
                <span class="cqv-autofill-mva">${esc(r.mva)}</span>
                <span class="cqv-autofill-detail">${esc(r.modelo || '')}${r.placas ? ' — ' + esc(r.placas) : ''}</span>
              </button>
            `).join('')}
          </div>
          ` : ''}
        </div>
        ` : ''}

        ${showFields ? `
        <div class="cqv-form-fields">

          <div class="cqv-grid-2">
            <div class="cqv-field">
              <label>MVA</label>
              <input type="text" class="cqv-locked-input" value="${esc(edit?.mva || '')}" readonly>
            </div>
            <div class="cqv-field">
              <label>Categoría</label>
              <input type="text" class="cqv-locked-input" value="${esc(edit?.categoria || '')}" readonly placeholder="S/C">
            </div>
          </div>

          <div class="cqv-grid-2">
            <div class="cqv-field">
              <label>Modelo</label>
              <input type="text" class="cqv-locked-input" value="${esc(edit?.modelo || '')}" readonly>
            </div>
            <div class="cqv-field">
              <label>Placas</label>
              <input type="text" class="cqv-locked-input" value="${esc(edit?.placas || '')}" readonly>
            </div>
          </div>

          <div class="cqv-grid-2">
            <div class="cqv-field">
              <label>ESTADO 🛠️</label>
              <select id="cqvFEst">
                <option value="">Seleccionar...</option>
                ${_renderEstadoOpts(form.estado)}
              </select>
            </div>
            <div class="cqv-field">
              <label>GASOLINA ⛽</label>
              <select id="cqvFGas">
                ${_renderGasOpts(form.gasolina)}
              </select>
            </div>
          </div>

          <div class="cqv-field">
            <label>UBICACIÓN ACTUAL 📍</label>
            <select id="cqvFUbi">
              ${_renderUbicacionOpts(form.ubicacion, _s.plaza)}
            </select>
          </div>

          <div class="cqv-field">
            <label>Notas / Observaciones</label>
            <textarea id="cqvFNotas" rows="3" placeholder="Escribe aquí...">${esc(form.notas)}</textarea>
          </div>

          ${editMode === 'modify' ? `
          <div class="cqv-del-note-wrap">
            <input type="checkbox" id="cqvFBorrar" ${form.borrarNotas ? 'checked' : ''}>
            <label for="cqvFBorrar">Borrar historial de notas actual</label>
          </div>
          ` : ''}

        </div>
        ` : `<p class="cqv-panel-hint">Haz clic en una fila para editar la unidad.</p>`}

        ${saveMsg ? `<div class="cqv-save-msg${saveMsg.ok ? ' cqv-save-msg--ok' : ' cqv-save-msg--err'}">${esc(saveMsg.text)}</div>` : ''}

        ${showFields ? `
        <div class="cqv-btn-group">
          ${editMode === 'modify' ? `
          <button class="cqv-btn-del" data-action="delete-unit" title="Eliminar unidad">
            <span class="material-symbols-outlined">delete</span>
          </button>
          ` : ''}
          <button class="cqv-btn-save${saving ? ' cqv-btn-save--loading' : ''}"
            data-action="save-unit"
            ${saving || !canSave ? 'disabled' : ''}>
            ${saving
              ? '<span class="cqv-btn-spinner"></span> Guardando...'
              : `<span class="material-symbols-outlined">${editMode === 'insert' ? 'add_circle' : 'save'}</span> ${editMode === 'insert' ? 'INSERTAR UNIDAD' : 'GUARDAR CAMBIOS'}`}
          </button>
        </div>
        ` : ''}

      </div>
    </div>
  `;
}

function _renderBatchBar() {
  const { selected, batchEstado, batchSaving, batchMsg } = _s;
  const count = selected.size;
  if (count < 2) return '';
  return `
    <div class="cqv-batch-bar">
      <span class="cqv-batch-count">${count} unidades seleccionadas</span>
      <select class="cqv-batch-select" id="cqvBatchEst">
        <option value="">-- Estado --</option>
        ${_renderEstadoOpts(batchEstado)}
      </select>
      <button class="cqv-batch-apply${batchSaving ? ' cqv-batch-apply--loading' : ''}" data-action="batch-apply" ${batchSaving ? 'disabled' : ''}>
        ${batchSaving ? 'Aplicando...' : 'Aplicar'}
      </button>
      ${batchMsg ? `<span class="cqv-batch-msg${batchMsg.ok ? '' : ' cqv-batch-msg--err'}">${esc(batchMsg.text)}</span>` : ''}
      <button class="cqv-batch-clear" data-action="batch-clear" title="Cancelar selección">✕</button>
    </div>
  `;
}

function _renderDropdown() {
  if (!_s.dropdown) return '';
  const admin = _isAdmin();
  return `
    <div class="cqv-dropdown" id="cqvDropdown">
      <button class="cqv-dropdown-item" data-action="dd-movimientos">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Registros / Movimientos
      </button>
      <button class="cqv-dropdown-item" data-action="dd-validar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        Validar Cuadre Actual
      </button>
      <button class="cqv-dropdown-item" data-action="dd-resumen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Resumen Flota
      </button>
      <div class="cqv-dropdown-sep"></div>
      <button class="cqv-dropdown-item" data-action="dd-externa">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        Insertar Unidad Externa
      </button>
      ${admin ? `
      <div class="cqv-dropdown-sep"></div>
      <button class="cqv-dropdown-item cqv-dropdown-item--admin" data-action="dd-insert-global">
        <span class="material-symbols-outlined" style="font-size:16px;flex-shrink:0">add_circle</span>
        Insertar Unidad Global
      </button>
      <button class="cqv-dropdown-item cqv-dropdown-item--admin cqv-dropdown-item--danger" data-action="dd-delete-global">
        <span class="material-symbols-outlined" style="font-size:16px;flex-shrink:0">delete_forever</span>
        Eliminar Unidades Globales
      </button>
      ` : ''}
    </div>
  `;
}

function _renderExtModal() {
  const { extForm, extSaving, extMsg } = _s;
  return `
    <div class="cqv-modal-overlay" id="cqvModalOverlay">
      <div class="cqv-modal">
        <div class="cqv-modal-head">
          <h3>Insertar Unidad Externa</h3>
          <button class="cqv-modal-close" data-action="close-modal">✕</button>
        </div>
        <div class="cqv-modal-body">
          ${extMsg ? `<div class="cqv-save-msg${extMsg.ok ? ' cqv-save-msg--ok' : ' cqv-save-msg--err'}">${esc(extMsg.text)}</div>` : ''}
          <label class="cqv-field"><span>MVA</span>
            <input type="text" id="cqvExtMva" class="cqv-input" value="${esc(extForm.mva)}" placeholder="Ej: EXT001">
          </label>
          <label class="cqv-field"><span>MODELO</span>
            <input type="text" id="cqvExtModelo" class="cqv-input" value="${esc(extForm.modelo)}" placeholder="Ej: FORD EDGE">
          </label>
          <label class="cqv-field"><span>PLACAS</span>
            <input type="text" id="cqvExtPlacas" class="cqv-input" value="${esc(extForm.placas)}" placeholder="Ej: TTO488A">
          </label>
        </div>
        <div class="cqv-modal-foot">
          <button class="cqv-modal-cancel" data-action="close-modal">Cancelar</button>
          <button class="cqv-btn-save${extSaving ? ' cqv-btn-save--loading' : ''}" data-action="save-external" ${extSaving ? 'disabled' : ''}>
            ${extSaving ? 'Guardando...' : 'Insertar'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function _renderInfoModal() {
  const { modalData } = _s;
  if (!modalData) return '';
  return `
    <div class="cqv-modal-overlay" id="cqvModalOverlay">
      <div class="cqv-modal cqv-modal--wide">
        <div class="cqv-modal-head">
          <h3>${esc(modalData.title)}</h3>
          <button class="cqv-modal-close" data-action="close-modal">✕</button>
        </div>
        <div class="cqv-modal-body">
          ${modalData.bodyHtml}
        </div>
        <div class="cqv-modal-foot">
          <button class="cqv-modal-cancel" data-action="close-modal">Cerrar</button>
        </div>
      </div>
    </div>
  `;
}

function _renderToasts() {
  if (!_s.toasts.length) return '';
  return `
    <div class="cqv-toasts">
      ${_s.toasts.map(t => `
        <div class="cqv-toast${t.ok ? ' cqv-toast--ok' : ' cqv-toast--err'}">${esc(t.text)}</div>
      `).join('')}
    </div>
  `;
}

function _renderAdminTable() {
  const { adminUnits, adminLoading } = _s;
  if (adminLoading) {
    return `<div class="cqv-loading"><span class="cqv-spinner"></span> Cargando datos admin...</div>`;
  }
  if (!adminUnits.length) {
    return `<div class="cqv-table-wrap"><table class="cqv-table"><tbody><tr><td class="cqv-empty" colspan="6">Sin datos de admins para esta plaza.</td></tr></tbody></table></div>`;
  }
  return `
    <div class="cqv-table-wrap">
      <table class="cqv-table">
        <thead>
          <tr>
            <th>ADMIN</th>
            <th>FLOTA ASIGNADA</th>
            <th>PATIO</th>
            <th>RENTA</th>
            <th>MANT.</th>
            <th>ESTADO</th>
          </tr>
        </thead>
        <tbody>
          ${adminUnits.map((a, i) => `
            <tr class="cqv-row" style="--i:${i}">
              <td class="cqv-td-mva">${esc(a.admin || a.nombre || a.id || '-')}</td>
              <td>${esc(String(a.total ?? '-'))}</td>
              <td>${esc(String(a.patio ?? '-'))}</td>
              <td>${esc(String(a.renta ?? '-'))}</td>
              <td>${esc(String(a.mant  ?? '-'))}</td>
              <td>${_badgeEstado(a.estado)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ── Resumen / Validar builders ───────────────────────────────
function _buildResumenData() {
  const units = _s.units;
  const byEstado = {}, byUbi = {};
  units.forEach(u => {
    const e = u.estado || 'S/E', ub = u.ubicacion || 'S/U';
    byEstado[e] = (byEstado[e] || 0) + 1;
    byUbi[ub]   = (byUbi[ub]   || 0) + 1;
  });
  const rows = obj => Object.entries(obj).sort((a,b) => b[1]-a[1])
    .map(([k,v]) => `<tr><td style="padding:5px 8px">${esc(k)}</td><td style="padding:5px 8px;text-align:right"><strong>${v}</strong></td></tr>`).join('');
  const th = `style="text-align:left;padding:6px 8px;background:#f1f5f9;font-size:11px;font-weight:700;text-transform:uppercase"`;
  const bodyHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;font-size:13px">
      <div>
        <p style="margin:0 0 8px;font-size:11px;font-weight:800;text-transform:uppercase;color:#475569">Por Estado</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
          <thead><tr><th ${th}>Estado</th><th ${th} style="text-align:right">Total</th></tr></thead>
          <tbody style="font-size:12px">${rows(byEstado)}</tbody>
        </table>
      </div>
      <div>
        <p style="margin:0 0 8px;font-size:11px;font-weight:800;text-transform:uppercase;color:#475569">Por Ubicación</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
          <thead><tr><th ${th}>Ubicación</th><th ${th} style="text-align:right">Total</th></tr></thead>
          <tbody style="font-size:12px">${rows(byUbi)}</tbody>
        </table>
      </div>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Total flota: <strong>${units.length}</strong> | Plaza: <strong>${esc(_s.plaza)}</strong> | Listos: <strong style="color:#16a34a">${units.filter(u=>up(u.estado)==='LISTO').length}</strong></p>
  `;
  return { title: `Resumen Flota — ${_s.plaza}`, bodyHtml };
}

function _buildValidarData() {
  const units = _s.units;
  const sinEstado    = units.filter(u => !u.estado).length;
  const sinUbi       = units.filter(u => !u.ubicacion).length;
  const sinPlacas    = units.filter(u => !u.placas).length;
  const listos       = units.filter(u => up(u.estado) === 'LISTO').length;
  const sc = n => n > 0 ? 'color:#dc2626;font-weight:700' : 'color:#16a34a;font-weight:700';
  const td = 'style="padding:8px 12px;border-bottom:1px solid #f1f5f9"';
  const bodyHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr>
        <th style="text-align:left;padding:8px 12px;background:#f1f5f9;font-size:11px;font-weight:700;text-transform:uppercase">Verificación</th>
        <th style="text-align:right;padding:8px 12px;background:#f1f5f9;font-size:11px;font-weight:700;text-transform:uppercase">Resultado</th>
      </tr></thead>
      <tbody>
        <tr><td ${td}>Total de unidades</td><td ${td} style="text-align:right"><strong>${units.length}</strong></td></tr>
        <tr><td ${td}>Sin estado registrado</td><td ${td} style="text-align:right;${sc(sinEstado)}">${sinEstado}</td></tr>
        <tr><td ${td}>Sin ubicación registrada</td><td ${td} style="text-align:right;${sc(sinUbi)}">${sinUbi}</td></tr>
        <tr><td ${td}>Sin placas registradas</td><td ${td} style="text-align:right;${sc(sinPlacas)}">${sinPlacas}</td></tr>
        <tr><td ${td} style="border:none">Listos para renta</td><td ${td} style="text-align:right;border:none;color:#16a34a;font-weight:700">${listos}</td></tr>
      </tbody>
    </table>
    <p style="margin:14px 0 0;font-size:11px;color:#94a3b8">Calculado de la vista actual — Plaza <strong>${esc(_s.plaza)}</strong>.</p>
  `;
  return { title: `Validar Cuadre — ${_s.plaza}`, bodyHtml };
}

async function _openBitacoraModal(mva) {
  _s.modal = 'info';
  _s.modalData = { title: `Movimientos — ${mva}`, bodyHtml: '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px">Cargando...</div>' };
  _render();
  try {
    const logs = await getUnidadBitacora({ plaza: _s.plaza, mva, limit: 50 });
    if (!_s || _s.modal !== 'info') return;
    if (!logs.length) {
      _s.modalData.bodyHtml = '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">Sin registros encontrados.</p>';
    } else {
      const rows = logs.map(l => {
        const ts = l.creadoEn?.toDate?.() || l.timestamp?.toDate?.() || null;
        const fecha = ts ? ts.toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '-';
        const evento = l.evento || l.accion || l.tipo || l.source || '-';
        const resp   = l.responsable || l.autor || l.creadoPor || '-';
        return `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:5px 8px;white-space:nowrap;font-size:11px;color:#64748b">${esc(fecha)}</td>
          <td style="padding:5px 8px;font-weight:600">${esc(evento)}</td>
          <td style="padding:5px 8px;color:#64748b">${esc(resp)}</td>
        </tr>`;
      }).join('');
      _s.modalData.bodyHtml = `<div style="max-height:360px;overflow-y:auto;font-size:12px">
        <table style="width:100%;border-collapse:collapse">
          <thead style="position:sticky;top:0;background:#fff">
            <tr>
              <th style="text-align:left;padding:6px 8px;background:#f1f5f9;font-size:10px;font-weight:700;text-transform:uppercase">Fecha</th>
              <th style="text-align:left;padding:6px 8px;background:#f1f5f9;font-size:10px;font-weight:700;text-transform:uppercase">Evento</th>
              <th style="text-align:left;padding:6px 8px;background:#f1f5f9;font-size:10px;font-weight:700;text-transform:uppercase">Responsable</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }
    _render();
  } catch (err) {
    if (!_s || _s.modal !== 'info') return;
    _s.modalData.bodyHtml = `<p style="color:#dc2626;font-size:13px;padding:16px">Error: ${esc(err?.message || String(err))}</p>`;
    _render();
  }
}

// ── Main render ──────────────────────────────────────────────
function _render() {
  if (!_container) return;

  // Preserve table scroll position across full re-renders
  const tableWrap = _container.querySelector('.cqv-table-wrap');
  const savedScroll = tableWrap?.scrollTop || 0;

  const rows = _visible();
  const { units, loading, error, tab, pill, colCat, colMod, colEst, colUbi, colPla, colGas, sortCol, sortDir, edit, selected, dropdown, modal } = _s;
  const cats = _uniq('categoria');
  const mods = _uniq('modelo');
  const ests = _uniq('estado');
  const ubis = _uniq('ubicacion');

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

        <div class="cqv-tabs">
          <button class="cqv-tab${tab === 'normal' ? ' cqv-tab--active' : ''}" data-tab="normal">
            🚗 FLOTA REGULAR
          </button>
          <button class="cqv-tab${tab === 'admin' ? ' cqv-tab--active' : ''}" data-tab="admin">
            👑 CUADRE ADMINS
          </button>
        </div>

        ${tab === 'normal' ? `
        <div class="cqv-pills">
          ${Object.entries(PILL_LABELS).map(([id, label]) => `
            <button class="cqv-pill${pill === id ? ' cqv-pill--active' : ''}" data-pill="${esc(id)}">${label}</button>
          `).join('')}
          <button class="cqv-pill cqv-pill--purple" data-action="reservas">📋 RESERVAS</button>
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
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map((u, i) => `
                <tr class="cqv-row${edit && up(edit.mva) === up(u.mva) ? ' cqv-row--selected' : ''}" data-mva="${esc(u.mva)}" style="--i:${i}">
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
                </tr>
              `).join('') : `
                <tr><td colspan="8" class="cqv-empty">
                  Sin unidades que coincidan con los filtros aplicados.
                </td></tr>
              `}
            </tbody>
          </table>
        </div>
        ` : ''}
        ` : _renderAdminTable()}

        ${tab === 'normal' ? `<button class="cqv-fab" data-action="add" title="Agregar unidad">+</button>` : ''}
      </div>

      ${edit || _s.editMode === 'insert' ? `<div class="cqv-overlay" id="cqvOverlay"></div>` : ''}
      ${(edit || _s.editMode === 'insert') ? _renderPanel() : ''}

      ${modal === 'insert-external' ? _renderExtModal() : modal === 'info' ? _renderInfoModal() : ''}

      ${_renderToasts()}
    </div>
  `;

  // Restore scroll
  if (savedScroll) {
    const newWrap = _container.querySelector('.cqv-table-wrap');
    if (newWrap) newWrap.scrollTop = savedScroll;
  }

  _bind();
}

// ── Panel-only event bindings ────────────────────────────────
function _bindPanel(root) {
  const el = root || _container;

  el.querySelector('[data-action="close-panel"]')?.addEventListener('click', _closeEdit);
  el.querySelector('#cqvOverlay')?.addEventListener('click', _closeEdit);
  el.querySelector('[data-action="save-unit"]')?.addEventListener('click', _saveUnit);
  el.querySelector('[data-action="delete-unit"]')?.addEventListener('click', _deleteUnit);

  el.querySelector('#cqvFEst')?.addEventListener('change',    e => { _s.form.estado      = e.target.value;   _renderPanelInPlace(); });
  el.querySelector('#cqvFGas')?.addEventListener('change',    e => { _s.form.gasolina    = e.target.value;   _renderPanelInPlace(); });
  el.querySelector('#cqvFUbi')?.addEventListener('change',    e => { _s.form.ubicacion   = e.target.value;   _renderPanelInPlace(); });
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
    _s.colPla = ''; _s.colGas = '';
    _s.sortCol = 'mva'; _s.sortDir = 'asc';
    _s.selected = new Set();
    _render();
  });

  el.querySelectorAll('[data-tab]').forEach(btn =>
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      _s.tab = tab;
      if (tab === 'admin' && !_s.adminUnits.length) _loadAdmin();
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

  el.querySelector('#cqvColCat')?.addEventListener('change', e => { _s.colCat = e.target.value; _render(); });
  el.querySelector('#cqvColMod')?.addEventListener('change', e => { _s.colMod = e.target.value; _render(); });
  el.querySelector('#cqvColEst')?.addEventListener('change', e => { _s.colEst = e.target.value; _render(); });
  el.querySelector('#cqvColUbi')?.addEventListener('change', e => { _s.colUbi = e.target.value; _render(); });
  el.querySelector('#cqvColPla')?.addEventListener('change', e => { _s.colPla = e.target.value; _render(); });
  el.querySelector('#cqvColGas')?.addEventListener('change', e => { _s.colGas = e.target.value; _render(); });

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

  // FAB — show insert panel without resetting table scroll
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
    if (_s.edit) {
      _openBitacoraModal(_s.edit.mva);
    } else {
      _render();
      _toast('Selecciona una unidad para ver sus movimientos.', false);
    }
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
      window.abrirModalInsertarGlobal();
      _render();
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
      window.abrirModalEliminarGlobal();
      _render();
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

  el.querySelector('[data-action="reservas"]')?.addEventListener('click', () => {
    _toast('Función próximamente disponible', true);
  });

  // Batch
  el.querySelector('#cqvBatchEst')?.addEventListener('change', e => { _s.batchEstado = e.target.value; });
  el.querySelector('[data-action="batch-apply"]')?.addEventListener('click', _applyBatch);
  el.querySelector('[data-action="batch-clear"]')?.addEventListener('click', () => {
    _s.selected = new Set(); _s.batchEstado = ''; _s.batchMsg = null; _render();
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
      if (ok) setTimeout(() => { if (_s?.saveMsg?.ok) { _closeEdit(); } }, 1500);
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
  };
  _s.form.gasolina = found.gasolina || 'N/A';
  _s.autofillQ     = up(found.mva);
  _s.autofillRes   = [];
  _renderPanelInPlace();
}

async function _loadAdmin() {
  _s.adminLoading = true; _render();
  try {
    const data = await window.api.obtenerCuadreAdminsData(_s.plaza);
    _s.adminUnits = Array.isArray(data) ? data : [];
  } catch (_) {
    _s.adminUnits = [];
  }
  _s.adminLoading = false; _render();
}

// ── Subscription ─────────────────────────────────────────────
function _start() {
  try { _unsub?.(); } catch (_) {}
  _unsub = subscribeCuadre({
    plaza: _s.plaza,
    onData(rows) {
      _s.units   = Array.isArray(rows) ? rows : [];
      _s.loading = false;
      _s.error   = '';
      if (_s.edit && _s.editMode === 'modify') {
        const refreshed = _s.units.find(u => up(u.mva) === up(_s.edit.mva));
        if (refreshed) _s.edit = refreshed;
      }
      _render();
    },
    onError(err) {
      _s.loading = false;
      _s.error   = err?.message || 'No se pudo leer el cuadre.';
      _render();
    },
  });
}

// ── Lifecycle ────────────────────────────────────────────────
export async function mount(ctx) {
  _ctx       = ctx || {};
  _container = _ctx.container;
  if (!_container) return;
  _ensureCss();

  const appState = getState();
  _s = _fresh(up(appState.currentPlaza || window.getMexCurrentPlaza?.() || ''));
  _render();
  _start();

  // Wire shell header search input
  const hdrInput = document.getElementById('mexHdrSearchInput');
  if (hdrInput) {
    _headerSearchListener = () => {
      clearTimeout(_searchDebounce);
      _searchDebounce = setTimeout(() => {
        if (!_s) return;
        _s.search = up(hdrInput.value);
        _render();
      }, 180);
    };
    hdrInput.addEventListener('input', _headerSearchListener);
    if (hdrInput.value) _s.search = up(hdrInput.value);
  }

  _unsubPlaza = onPlazaChange(plaza => {
    _s.plaza      = up(plaza);
    _s.units      = [];
    _s.adminUnits = [];
    _s.loading    = true;
    _s.edit       = null;
    _s.selected   = new Set();
    _render();
    _start();
  });
}

export function unmount() {
  clearTimeout(_searchDebounce);
  clearTimeout(_autofillDebounce);
  if (_headerSearchListener) {
    document.getElementById('mexHdrSearchInput')?.removeEventListener('input', _headerSearchListener);
    _headerSearchListener = null;
  }
  try { _unsub?.();      } catch (_) {}
  try { _unsubPlaza?.(); } catch (_) {}
  _unsub = null; _unsubPlaza = null;
  _ctx = null; _container = null; _s = null;
}
