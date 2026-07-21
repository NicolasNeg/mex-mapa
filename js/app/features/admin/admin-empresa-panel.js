/**
 * Panel SPA — Empresa (identidad, colores, correos).
 */
import { getState } from '/js/app/app-state.js';
import {
  canEditEmpresa,
  getEmpresaSnapshot,
  saveEmpresaFields,
  uploadEmpresaLogo,
  deleteEmpresaLogo,
  empresaColorKeys
} from '/js/app/features/admin/admin-empresa-data.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(msg, type = 'info') {
  if (typeof window.showToast === 'function') window.showToast(msg, type);
  else console.log(msg);
}

function _confirm(title, text, tipo = 'danger') {
  if (typeof window.mexConfirm === 'function') return window.mexConfirm(title, text, tipo);
  return Promise.resolve(window.confirm(`${title}\n\n${text}`));
}

let _host = null;
let _editing = false;
let _draft = null;
let _logoPreview = '';

function _actor() {
  const st = getState() || {};
  const profile = st.profile || window.__mexCurrentUserRecord || {};
  const role = String(st.role || profile.rol || profile.role || '').toUpperCase();
  return { profile, role };
}

function _canEdit() {
  const { profile, role } = _actor();
  return canEditEmpresa(profile, role);
}

function _loadDraft() {
  _draft = getEmpresaSnapshot();
  _logoPreview = '';
}

function _paint() {
  if (!_host) return;
  if (!_draft) _loadDraft();
  const canEdit = _canEdit();
  const editing = canEdit && _editing;
  const d = _draft;
  const logo = _logoPreview || d.logoURL;
  const colors = empresaColorKeys();

  _host.innerHTML = `
    <div class="adm-empresa">
      <header class="adm-empresa-head">
        <div>
          <span class="adm-kicker">Organización</span>
          <h2>Empresa</h2>
          <p class="adm-empresa-sub">Identidad visual y correos corporativos.</p>
        </div>
        <div class="adm-empresa-head-actions">
          ${canEdit && !editing ? `
            <button type="button" class="adm-btn primary" data-action="edit">Editar</button>
          ` : ''}
          ${canEdit && editing ? `
            <button type="button" class="adm-btn ghost" data-action="cancel">Cancelar</button>
            <button type="button" class="adm-btn primary" data-action="save">Guardar</button>
          ` : ''}
        </div>
      </header>

      <form class="adm-empresa-form${!editing ? ' is-readonly' : ''}" onsubmit="return false;">
        <section class="adm-empresa-card">
          <h3 class="adm-empresa-card-title">
            <span class="material-symbols-outlined">palette</span>
            Identidad visual
          </h3>

          <div class="adm-empresa-logo-block">
            <span class="adm-label-block">Logo</span>
            <div class="adm-empresa-logo-zone${logo ? '' : ' is-empty'}">
              ${logo
                ? `<img src="${esc(logo)}" alt="Logo" class="adm-empresa-logo-img">`
                : `<span class="material-symbols-outlined">add_photo_alternate</span>
                   <small>PNG, JPG — máx 2MB</small>`}
            </div>
            ${editing ? `
              <div class="adm-empresa-logo-actions">
                <label class="adm-btn ghost adm-file-btn">
                  <span class="material-symbols-outlined">upload</span>
                  ${logo ? 'Cambiar' : 'Subir logo'}
                  <input type="file" accept="image/*" data-action="logo-file" hidden>
                </label>
                ${d.logoURL || _logoPreview ? `
                  <button type="button" class="adm-btn ghost adm-btn-danger" data-action="logo-delete">Eliminar</button>
                ` : ''}
              </div>` : ''}
          </div>

          <label>
            <span>Nombre de la empresa</span>
            ${editing
              ? `<input name="nombre" type="text" value="${esc(d.nombre)}" placeholder="Nombre comercial">`
              : `<div class="adm-field-value">${esc(d.nombre || '—')}</div>`}
          </label>

          <div class="adm-empresa-palette">
            <span class="adm-label-block">Paleta</span>
            <div class="adm-empresa-palette-grid">
              ${colors.map(c => {
                const val = d[c.key] || c.default;
                return `
                  <div class="adm-empresa-swatch-item">
                    ${editing
                      ? `<input type="color" name="${esc(c.key)}" value="${esc(val)}" title="${esc(c.label)}">`
                      : `<span class="adm-empresa-swatch" style="background:${esc(val)}"></span>`}
                    <div>
                      <strong>${esc(c.label)}</strong>
                      <small>${esc(c.hint)}</small>
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>
        </section>

        <section class="adm-empresa-card">
          <h3 class="adm-empresa-card-title">
            <span class="material-symbols-outlined">alternate_email</span>
            Correos corporativos
          </h3>
          <label>
            <span>Correo de la empresa</span>
            ${editing
              ? `<input name="correoEmpresa" type="email" value="${esc(d.correoEmpresa)}" placeholder="contacto@empresa.com">`
              : `<div class="adm-field-value">${esc(d.correoEmpresa || '—')}</div>`}
          </label>
          <label>
            <span>Correo de facturación</span>
            ${editing
              ? `<input name="correoFacturacion" type="email" value="${esc(d.correoFacturacion)}" placeholder="facturacion@empresa.com">`
              : `<div class="adm-field-value">${esc(d.correoFacturacion || '—')}</div>`}
          </label>
        </section>

        <section class="adm-empresa-card">
          <h3 class="adm-empresa-card-title">
            <span class="material-symbols-outlined">notifications_active</span>
            Correos internos · MAPA
          </h3>
          <p class="adm-empresa-hint">Reciben alertas y eventos operativos.</p>
          <div class="adm-empresa-tags" data-internos>
            ${(d.correosInternos || []).map((c, i) => `
              <span class="adm-empresa-tag">
                ${esc(c)}
                ${editing ? `<button type="button" data-action="remove-interno" data-idx="${i}" aria-label="Quitar"><span class="material-symbols-outlined" aria-hidden="true" style="font-size:14px;">delete_outline</span></button>` : ''}
              </span>`).join('') || '<span class="adm-muted">Sin correos internos</span>'}
          </div>
          ${editing ? `
            <div class="adm-empresa-add-row">
              <input type="email" data-interno-input placeholder="nuevo@empresa.com">
              <button type="button" class="adm-btn primary" data-action="add-interno">Agregar</button>
            </div>` : ''}
        </section>
      </form>
    </div>
  `;
  _bind();
}

function _bind() {
  _host.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
    if (!_canEdit()) return;
    _editing = true;
    _paint();
  });
  _host.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    _editing = false;
    if (_logoPreview && _logoPreview.startsWith('blob:')) {
      try { URL.revokeObjectURL(_logoPreview); } catch (_) { /* ignore */ }
    }
    _loadDraft();
    _paint();
  });
  _host.querySelector('[data-action="save"]')?.addEventListener('click', () => _save());

  _host.querySelector('[data-action="logo-file"]')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadEmpresaLogo(file);
      _draft.logoURL = url;
      _logoPreview = '';
      toast('Logo actualizado.', 'success');
      _paint();
    } catch (err) {
      console.error('[admin-empresa] logo:', err);
      toast(err?.message || 'No se pudo subir el logo.', 'error');
    }
  });

  _host.querySelector('[data-action="logo-delete"]')?.addEventListener('click', async () => {
    const ok = await _confirm('Eliminar logo', '¿Quitar el logo de la empresa?', 'danger');
    if (!ok) return;
    try {
      await deleteEmpresaLogo();
      _draft.logoURL = '';
      _logoPreview = '';
      toast('Logo eliminado.', 'success');
      _paint();
    } catch (err) {
      toast(err?.message || 'No se pudo eliminar.', 'error');
    }
  });

  _host.querySelector('[data-action="add-interno"]')?.addEventListener('click', () => {
    const input = _host.querySelector('[data-interno-input]');
    const val = String(input?.value || '').trim().toLowerCase();
    if (!val || !val.includes('@')) {
      toast('Escribe un correo válido.', 'warn');
      return;
    }
    if (!_draft.correosInternos.includes(val)) {
      _draft.correosInternos = [..._draft.correosInternos, val];
    }
    if (input) input.value = '';
    _paint();
  });

  _host.querySelectorAll('[data-action="remove-interno"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-idx'));
      if (!Number.isFinite(idx)) return;
      _draft.correosInternos = _draft.correosInternos.filter((_, i) => i !== idx);
      _paint();
    });
  });
}

async function _save() {
  if (!_canEdit() || !_draft) return;
  const form = _host.querySelector('.adm-empresa-form');
  const fd = form ? new FormData(form) : null;
  const fields = {
    nombre: String(fd?.get('nombre') ?? _draft.nombre),
    correoEmpresa: String(fd?.get('correoEmpresa') ?? _draft.correoEmpresa),
    correoFacturacion: String(fd?.get('correoFacturacion') ?? _draft.correoFacturacion),
    correosInternos: _draft.correosInternos.slice()
  };
  for (const { key } of empresaColorKeys()) {
    fields[key] = String(fd?.get(key) ?? _draft[key]);
  }
  try {
    _draft = await saveEmpresaFields(fields);
    _editing = false;
    toast('Empresa actualizada.', 'success');
    _paint();
  } catch (err) {
    console.error('[admin-empresa] save:', err);
    toast(err?.message || 'No se pudo guardar.', 'error');
  }
}

export function mountEmpresaPanel(host) {
  unmountEmpresaPanel();
  _host = host;
  _editing = false;
  _loadDraft();
  _paint();
}

export function syncEmpresaSelection() {
  if (!_host) return;
  if (!_editing) {
    _loadDraft();
    _paint();
  }
}

export function unmountEmpresaPanel() {
  if (_logoPreview && _logoPreview.startsWith('blob:')) {
    try { URL.revokeObjectURL(_logoPreview); } catch (_) { /* ignore */ }
  }
  _host = null;
  _editing = false;
  _draft = null;
  _logoPreview = '';
}
