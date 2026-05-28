// ═══════════════════════════════════════════════════════════
//  /app/cuadre — Gestor de Flota SPA
//  Estilo: ejemplo_css.html (light, white card, #232a85 blue)
// ═══════════════════════════════════════════════════════════

import { getState, onPlazaChange } from '/js/app/app-state.js';
import { subscribeCuadre } from '/js/app/features/cuadre/cuadre-data.js';

let _container = null;
let _ctx        = null;
let _s          = null;   // state
let _unsub      = null;
let _unsubPlaza = null;

// ── State ────────────────────────────────────────────────────
function _fresh(plaza) {
  return {
    plaza,
    units:    [],
    loading:  true,
    error:    '',
    tab:      'normal',   // normal | admin
    search:   '',
    pill:     'todos',
    colCat:   '',
    colMod:   '',
    colEst:   '',
    colUbi:   '',
    sortDir:  'asc',
    edit:     null,       // unit being edited
    form:     { estado: '', gasolina: '', ubicacion: '', notas: '', borrarNotas: false },
    saving:   false,
    saveMsg:  null,       // { text, ok }
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

// ── Filtering & sorting ──────────────────────────────────────
const PILL_LABELS = {
  todos: 'Todos',
  sucio: '🧹 SUCIO',
  listo: '✅ LISTO',
  mant:  '🔧 MANT.',
  traslado: '🚛 TRASLADO',
  'doble-cero': '🍃 DOBLE CERO',
  apartados: '🔒 APARTADOS',
  urgente: '⚡ URGENTE',
  resguardo: '👀 RESGUARDO',
  taller: '🏭 TALLER',
};

function _matchPill(u, pill) {
  const e = up(u.estado), ubi = up(u.ubicacion), n = up(u.notas);
  if (pill === 'todos') return true;
  if (pill === 'sucio') return e === 'SUCIO';
  if (pill === 'listo') return e === 'LISTO';
  if (pill === 'mant')  return e.includes('MANTEN') || e === 'MANTO';
  if (pill === 'traslado') return e === 'TRASLADO';
  if (pill === 'doble-cero') return n.includes('DOBLE CERO');
  if (pill === 'apartados')  return n.includes('APARTAD') || n.includes('RESERVAD');
  if (pill === 'urgente')    return n.includes('URGENTE');
  if (pill === 'resguardo')  return e === 'RESGUARDO';
  if (pill === 'taller')     return ubi === 'TALLER';
  return true;
}

function _visible() {
  const { units, search, pill, colCat, colMod, colEst, colUbi, sortDir } = _s;
  const q = up(search);
  let rows = units
    .filter(u => _matchPill(u, pill))
    .filter(u => !colCat || up(u.categoria) === up(colCat))
    .filter(u => !colMod || up(u.modelo).includes(up(colMod)))
    .filter(u => !colEst || up(u.estado) === up(colEst))
    .filter(u => !colUbi || up(u.ubicacion) === up(colUbi))
    .filter(u => !q || [u.mva, u.modelo, u.placas, u.categoria, u.estado, u.ubicacion, u.notas].map(up).join(' ').includes(q));
  rows.sort((a, b) => {
    const cmp = up(a.mva).localeCompare(up(b.mva), 'es');
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
  if (e === 'LISTO')  return `<span class="cqv-badge cqv-badge--green">${esc(v)}</span>`;
  if (e === 'SUCIO')  return `<span class="cqv-badge cqv-badge--yellow">${esc(v)}</span>`;
  if (e.includes('MANTEN') || e === 'MANTO') return `<span class="cqv-badge cqv-badge--red">${esc(v)}</span>`;
  if (e === 'TRASLADO') return `<span class="cqv-badge cqv-badge--purple">${esc(v)}</span>`;
  if (e === 'RESGUARDO') return `<span class="cqv-badge cqv-badge--brown">${esc(v)}</span>`;
  if (!v) return `<span class="cqv-badge cqv-badge--gray">S/E</span>`;
  return `<span class="cqv-text-status">${esc(v)}</span>`;
}

function _badgeUbi(v) {
  const u = up(v);
  if (!v) return `<span class="cqv-badge cqv-badge--gray">-</span>`;
  if (u === 'TALLER') return `<span class="cqv-badge cqv-badge--red">${esc(v)}</span>`;
  if (u === 'EXTERNO') return `<span class="cqv-badge cqv-badge--orange">${esc(v)}</span>`;
  return `<span class="cqv-badge cqv-badge--blue">${esc(v)}</span>`;
}

// ── Render ───────────────────────────────────────────────────
function _render() {
  if (!_container) return;
  const rows = _visible();
  const { units, loading, error, tab, search, pill, colCat, colMod, colEst, colUbi, sortDir, edit, saving, saveMsg } = _s;

  // Dynamic unique options
  const cats = _uniq('categoria');
  const mods = _uniq('modelo');
  const ests = _uniq('estado');
  const ubis = _uniq('ubicacion');
  const total = units.length;
  const listos = units.filter(u => up(u.estado) === 'LISTO').length;

  _container.innerHTML = `
    <div class="cqv-root">
      <div class="cqv-card">

        <!-- Tabs -->
        <div class="cqv-tabs">
          <button class="cqv-tab${tab === 'normal' ? ' cqv-tab--active' : ''}" data-tab="normal">
            🚗 FLOTA REGULAR
          </button>
          <button class="cqv-tab${tab === 'admin' ? ' cqv-tab--active' : ''}" data-tab="admin">
            👑 CUADRE ADMINS
          </button>
        </div>

        <!-- Search row -->
        <div class="cqv-search-row">
          <div class="cqv-searchbar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="cqvSearch" type="text" value="${esc(search)}" placeholder="Buscar MVA, Notas, Placas o Modelo...">
          </div>
          <button class="cqv-clear-btn" id="cqvClear" title="Limpiar filtros">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>
          </button>
        </div>

        <!-- Pills -->
        <div class="cqv-pills">
          ${Object.entries(PILL_LABELS).map(([id, label]) => `
            <button class="cqv-pill${pill === id ? ' cqv-pill--active' : ''}" data-pill="${esc(id)}">${label}</button>
          `).join('')}
          <button class="cqv-pill cqv-pill--purple" data-action="reservas">📋 RESERVAS</button>
        </div>

        <!-- Loading / error -->
        ${loading ? `<div class="cqv-loading"><span class="cqv-spinner"></span> Cargando flota...</div>` : ''}
        ${error ? `<div class="cqv-error-msg">${esc(error)}</div>` : ''}

        <!-- Table -->
        ${!loading ? `
        <div class="cqv-table-wrap">
          <table class="cqv-table">
            <thead>
              <tr>
                <th class="cqv-th-sort" data-sort="mva">MVA ${sortDir === 'asc' ? '↑' : '↓'}</th>
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
                <th>PLACAS</th>
                <th>GAS</th>
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
              ${rows.length ? rows.map(u => `
                <tr class="cqv-row${edit && up(edit.mva) === up(u.mva) ? ' cqv-row--selected' : ''}" data-mva="${esc(u.mva)}">
                  <td class="cqv-td-mva">${esc(u.mva || 'S/MVA')}</td>
                  <td>${_badgeCat(u.categoria)}</td>
                  <td>${esc(u.modelo || '-')}</td>
                  <td class="cqv-td-placas">${esc(u.placas || '-')}</td>
                  <td>${_badgeGas(u.gasolina)}</td>
                  <td>${_badgeEstado(u.estado)}</td>
                  <td>${_badgeUbi(u.ubicacion)}</td>
                </tr>
              `).join('') : `
                <tr><td colspan="7" class="cqv-empty">
                  Sin unidades que coincidan con los filtros aplicados.
                </td></tr>
              `}
            </tbody>
          </table>
        </div>
        ` : ''}

        <!-- FAB -->
        <button class="cqv-fab" data-action="add" title="Agregar unidad">+</button>
      </div>

      <!-- Edit overlay -->
      ${edit ? `<div class="cqv-overlay" id="cqvOverlay"></div>` : ''}

      <!-- Edit panel -->
      ${edit ? `
      <div class="cqv-panel${edit ? ' cqv-panel--open' : ''}" id="cqvPanel">
        <div class="cqv-panel-head">
          <div>
            <h3>GESTOR DE UNIDAD</h3>
            <p>${esc(edit.mva)}</p>
          </div>
          <button class="cqv-panel-close" data-action="close-panel">✕</button>
        </div>

        <!-- Stats -->
        <div class="cqv-panel-stats">
          <div class="cqv-stat-box">
            <div class="cqv-stat-num">${total}</div>
            <div class="cqv-stat-lbl">Total Flota</div>
          </div>
          <div class="cqv-stat-box cqv-stat-box--green">
            <div class="cqv-stat-num cqv-stat-num--green">${listos}</div>
            <div class="cqv-stat-lbl">Listos Renta</div>
          </div>
        </div>

        <!-- Unit info -->
        <div class="cqv-panel-unit">
          <div class="cqv-panel-unit-row"><span>MVA</span><strong>${esc(edit.mva)}</strong></div>
          <div class="cqv-panel-unit-row"><span>Modelo</span><strong>${esc(edit.modelo || '-')}</strong></div>
          <div class="cqv-panel-unit-row"><span>Placas</span><strong>${esc(edit.placas || '-')}</strong></div>
          <div class="cqv-panel-unit-row"><span>Categoría</span><strong>${esc(edit.categoria || '-')}</strong></div>
        </div>

        <!-- Save message -->
        ${saveMsg ? `<div class="cqv-save-msg${saveMsg.ok ? ' cqv-save-msg--ok' : ' cqv-save-msg--err'}">${esc(saveMsg.text)}</div>` : ''}

        <!-- Form -->
        <div class="cqv-panel-form">
          <label class="cqv-field">
            <span>ESTADO</span>
            <select id="cqvFEst">
              <option value="">Seleccionar...</option>
              ${['LISTO','SUCIO','MANTENIMIENTO','RESGUARDO','TRASLADO','VENTA','RETENIDA','NO ARRENDABLE','HYP','EN RENTA'].map(v =>
                `<option value="${v}"${_s.form.estado === v ? ' selected' : ''}>${v}</option>`
              ).join('')}
            </select>
          </label>

          <label class="cqv-field">
            <span>GASOLINA</span>
            <select id="cqvFGas">
              <option value="N/A">Seleccionar...</option>
              ${['F','15/16','7/8','3/4','H','1/4','1/8','E','N/A'].map(v =>
                `<option value="${v}"${_s.form.gasolina === v ? ' selected' : ''}>${v}</option>`
              ).join('')}
            </select>
          </label>

          <label class="cqv-field">
            <span>UBICACIÓN</span>
            <select id="cqvFUbi">
              <option value="">Seleccionar...</option>
              <optgroup label="PLAZAS FIJAS">
                ${['PATIO','TALLER','AGENCIA','TALLER EXTERNO','HYP COBIAN'].map(v =>
                  `<option value="${v}"${_s.form.ubicacion === v ? ' selected' : ''}>🏠 ${v}</option>`
                ).join('')}
              </optgroup>
              <optgroup label="PERSONA RESPONSABLE">
                ${['JORGE','GERARDO','OSVALDO','BALANDRAN','ULISES','JOSUE','ISRAEL','ISAAC','ANGEL','LEO','BRAULIO','MARTHA','FERNANDA','ZALLO','UBALDO','JOSE LUIS','PASCUAL','LALO','EDGAR'].map(v =>
                  `<option value="${v}"${_s.form.ubicacion === v ? ' selected' : ''}>👤 ${v}</option>`
                ).join('')}
              </optgroup>
            </select>
          </label>

          <label class="cqv-field">
            <span>NOTAS / OBSERVACIONES</span>
            <textarea id="cqvFNotas" rows="3" placeholder="Escribe aquí...">${esc(_s.form.notas)}</textarea>
          </label>

          <label class="cqv-field cqv-field--check">
            <input type="checkbox" id="cqvFBorrar" ${_s.form.borrarNotas ? 'checked' : ''}>
            <span>Borrar historial de notas actual</span>
          </label>
        </div>

        <div class="cqv-panel-actions">
          <button class="cqv-btn-del" data-action="delete-unit" title="Eliminar unidad">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
          <button class="cqv-btn-save${saving ? ' cqv-btn-save--loading' : ''}" data-action="save-unit" ${saving ? 'disabled' : ''}>
            ${saving ? 'Guardando...' : '💾 GUARDAR CAMBIOS'}
          </button>
        </div>
      </div>
      ` : ''}
    </div>
  `;

  _bind();
}

// ── Events ───────────────────────────────────────────────────
function _bind() {
  const el = _container;
  if (!el) return;

  el.querySelector('#cqvSearch')?.addEventListener('input', e => {
    _s.search = e.target.value;
    _rerender();
  });

  el.querySelector('#cqvClear')?.addEventListener('click', () => {
    _s.search = ''; _s.pill = 'todos';
    _s.colCat = ''; _s.colMod = ''; _s.colEst = ''; _s.colUbi = '';
    _rerender();
  });

  el.querySelectorAll('[data-tab]').forEach(btn =>
    btn.addEventListener('click', () => { _s.tab = btn.dataset.tab; _rerender(); })
  );

  el.querySelectorAll('[data-pill]').forEach(btn =>
    btn.addEventListener('click', () => { _s.pill = btn.dataset.pill; _rerender(); })
  );

  el.querySelector('[data-sort="mva"]')?.addEventListener('click', () => {
    _s.sortDir = _s.sortDir === 'asc' ? 'desc' : 'asc';
    _rerender();
  });

  el.querySelector('#cqvColCat')?.addEventListener('change', e => { _s.colCat = e.target.value; _rerender(); });
  el.querySelector('#cqvColMod')?.addEventListener('change', e => { _s.colMod = e.target.value; _rerender(); });
  el.querySelector('#cqvColEst')?.addEventListener('change', e => { _s.colEst = e.target.value; _rerender(); });
  el.querySelector('#cqvColUbi')?.addEventListener('change', e => { _s.colUbi = e.target.value; _rerender(); });

  el.querySelectorAll('.cqv-row[data-mva]').forEach(row =>
    row.addEventListener('click', () => _openEdit(row.dataset.mva))
  );

  el.querySelector('[data-action="close-panel"]')?.addEventListener('click', _closeEdit);
  el.querySelector('#cqvOverlay')?.addEventListener('click', _closeEdit);

  el.querySelector('[data-action="save-unit"]')?.addEventListener('click', _saveUnit);
  el.querySelector('[data-action="delete-unit"]')?.addEventListener('click', _deleteUnit);

  el.querySelector('#cqvFEst')?.addEventListener('change',   e => { _s.form.estado    = e.target.value; });
  el.querySelector('#cqvFGas')?.addEventListener('change',   e => { _s.form.gasolina  = e.target.value; });
  el.querySelector('#cqvFUbi')?.addEventListener('change',   e => { _s.form.ubicacion = e.target.value; });
  el.querySelector('#cqvFNotas')?.addEventListener('input',  e => { _s.form.notas     = e.target.value; });
  el.querySelector('#cqvFBorrar')?.addEventListener('change',e => { _s.form.borrarNotas = e.target.checked; });
}

function _rerender() {
  _render();
}

function _openEdit(mva) {
  const unit = (_s.units || []).find(u => up(u.mva) === up(mva));
  if (!unit) return;
  _s.edit = unit;
  _s.form = {
    estado:      unit.estado || '',
    gasolina:    unit.gasolina || 'N/A',
    ubicacion:   unit.ubicacion || '',
    notas:       unit.notas || '',
    borrarNotas: false,
  };
  _s.saveMsg = null;
  _render();
}

function _closeEdit() {
  _s.edit    = null;
  _s.saveMsg = null;
  _render();
}

async function _saveUnit() {
  if (!_s.edit || _s.saving) return;
  const { estado, gasolina, ubicacion, notas, borrarNotas } = _s.form;
  if (!estado || !ubicacion) {
    _s.saveMsg = { text: 'Selecciona Estado y Ubicación antes de guardar.', ok: false };
    _render();
    return;
  }
  _s.saving  = true;
  _s.saveMsg = null;
  _render();

  try {
    const state   = getState();
    const profile = state.profile || {};
    const autor   = profile.nombreCompleto || profile.nombre || profile.email || 'Sistema';
    const plaza   = _s.plaza;
    const mva     = _s.edit.mva;

    const result = await window.api.aplicarEstado(
      mva, estado, ubicacion, gasolina, notas, borrarNotas, autor, autor, plaza
    );

    const ok = result === 'EXITO' || result?.ok === true;
    _s.saveMsg = { text: ok ? `✅ ${mva} guardado correctamente.` : `Error: ${String(result)}`, ok };
    if (ok) {
      _s.form.borrarNotas = false;
      setTimeout(() => {
        if (_s.saveMsg?.ok) { _s.saveMsg = null; _render(); }
      }, 2500);
    }
  } catch (err) {
    _s.saveMsg = { text: `Error: ${err?.message || String(err)}`, ok: false };
  }

  _s.saving = false;
  _render();
}

function _deleteUnit() {
  if (!_s.edit) return;
  const mva = _s.edit.mva;
  if (!confirm(`¿Eliminar la unidad ${mva} del cuadre? Esta acción no se puede deshacer.`)) return;
  const state   = getState();
  const profile = state.profile || {};
  const autor   = profile.nombreCompleto || profile.nombre || profile.email || 'Sistema';
  window.api.ejecutarEliminacion([mva], autor, _s.plaza)
    .then(() => { _s.edit = null; _render(); })
    .catch(err => {
      _s.saveMsg = { text: `Error al eliminar: ${err?.message || String(err)}`, ok: false };
      _render();
    });
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
      if (_s.edit) {
        const refreshed = _s.units.find(u => up(u.mva) === up(_s.edit.mva));
        if (refreshed) _s.edit = refreshed;
      }
      _render();
    },
    onError(err) {
      _s.loading = false;
      _s.error   = err?.message || 'No se pudo leer el cuadre.';
      _render();
    }
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

  _unsubPlaza = onPlazaChange(plaza => {
    _s.plaza   = up(plaza);
    _s.units   = [];
    _s.loading = true;
    _s.edit    = null;
    _render();
    _start();
  });
}

export function unmount() {
  try { _unsub?.();      } catch (_) {}
  try { _unsubPlaza?.(); } catch (_) {}
  _unsub = null; _unsubPlaza = null;
  _ctx = null; _container = null; _s = null;
}
