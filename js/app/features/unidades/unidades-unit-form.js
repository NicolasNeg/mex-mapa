// ============================================================================
//  Formulario compartido — detalle / expediente de unidad global
// ============================================================================

import { getState } from '/js/app/app-state.js';

export const FIELD_ORDER = [
  'id', 'clase', 'vin', 'anio', 'marca', 'modelo', 'mva', 'placas',
  'sucursal', 'plazaActual', 'estado', 'activo', 'color', 'capacidadTanque',
  'km', 'descripcion'
];

export const FIELD_LABEL = {
  id: 'Id',
  clase: 'Clase',
  vin: 'VIN',
  anio: 'Año',
  marca: 'Marca',
  modelo: 'Modelo',
  mva: 'Número económico',
  placas: 'Placas',
  sucursal: 'Locación propietaria',
  plazaActual: 'Locación actual',
  estado: 'Estatus',
  activo: 'Activo',
  color: 'Color',
  capacidadTanque: 'Capacidad tanque (L)',
  km: 'Kilometraje',
  descripcion: 'Descripción'
};

export function norm(value) {
  return String(value || '').trim().toUpperCase();
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function optionHtml(value, label, selected) {
  const v = String(value ?? '');
  return `<option value="${esc(v)}" ${String(selected ?? '') === v ? 'selected' : ''}>${esc(label)}</option>`;
}

export function normalizeUnit(row = {}) {
  return {
    ...row,
    id: row.id || row.fila || row.mva || '',
    mva: norm(row.mva || row.numeroEconomico || row.economico),
    clase: norm(row.clase || row.categoria || row.tipo),
    anio: row.anio || row.año || row.year || '',
    sucursal: norm(row.sucursal || row.plaza || row.locacionPropietaria),
    plazaActual: norm(row.plazaActual || row.locacionActual || row.ubicacionActual || row.plaza || ''),
    estado: norm(row.estado || row.estatus || ''),
    activo: normalizeActivo(row.activo ?? row.active ?? true)
  };
}

export function isActive(row) {
  const raw = String(row?.activo ?? row?.active ?? '').toUpperCase().trim();
  if (!raw) return true;
  return !['NO', 'FALSE', 'INACTIVO', '0', 'BAJA'].includes(raw);
}

export function normalizeActivo(value) {
  return isActive({ activo: value }) ? 'Activo' : 'Inactivo';
}

function looksLikeFuelLevel(value) {
  const s = String(value || '').trim().toUpperCase();
  if (!s) return false;
  if (/^\d+$/.test(s)) return false;
  if (/^\d+(\.\d+)?\s*(L|LT|LTS|LITROS?)?$/i.test(s)) return false;
  return /^(F|E|N\/A|\d+\/\d+|\d+\s*\/\s*\d+|H)$/.test(s) || s.includes('/');
}

export function capacidadTanqueDisplay(row = {}) {
  const direct = row.capacidadTanque ?? row.tanqueLitros ?? '';
  if (direct !== '' && direct != null) {
    const n = Number(direct);
    return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : String(direct).trim();
  }
  const legacy = row.gasolina;
  if (legacy != null && legacy !== '' && !looksLikeFuelLevel(legacy)) {
    const n = Number(String(legacy).replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 0) return String(Math.round(n));
  }
  return '';
}

export function normalizeCapacidadTanque(row = {}) {
  const raw = row?.capacidadTanque ?? row?.tanqueLitros ?? '';
  const n = Number(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : '';
}

export function unitField(row, key) {
  if (key === 'anio') return row.anio || row.año || '';
  if (key === 'activo') return isActive(row) ? 'Activo' : 'Inactivo';
  if (key === 'descripcion') return row.descripcion || row.notas || '';
  if (key === 'capacidadTanque') return capacidadTanqueDisplay(row);
  return row[key] ?? '';
}

function listas() {
  return window.MEX_CONFIG?.listas || {};
}

export function catalogNames(listKey) {
  const raw = listas()[listKey];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(item => {
    if (typeof item === 'string') return norm(item);
    return norm(item?.nombre || item?.codigo || item?.etiqueta || item?.valor || '');
  }).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

export function plazasCatalog(plazaFallback = '') {
  const empresa = window.MEX_CONFIG?.empresa || {};
  const direct = Array.isArray(empresa.plazas) ? empresa.plazas : [];
  const fromDetail = Array.isArray(empresa.plazasDetalle)
    ? empresa.plazasDetalle.map(p => p?.id)
    : [];
  const gs = getState();
  const profilePlaza = gs?.profile?.plazaAsignada || '';
  return [...new Set([...direct, ...fromDetail, plazaFallback, profilePlaza].map(p => norm(p)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
}

function catalogWithValue(catalog, currentVal) {
  const cur = norm(currentVal);
  const base = Array.isArray(catalog) ? catalog : [];
  if (!cur) return base;
  return [...new Set([...base, cur].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

export function estadosCatalog(currentVal = '', allUnits = []) {
  const base = catalogNames('estados');
  const fromUnits = [...new Set((allUnits || []).map(u => norm(u.estado || u.estatus)).filter(Boolean))];
  const fallback = ['ARRENDABLE', 'DISPONIBLE', 'RENTADO', 'MANTENIMIENTO', 'TRASLADO', 'SUCIO', 'LIMPIO'];
  return catalogWithValue([...base, ...fromUnits, ...fallback], currentVal);
}

export function fieldCatalog(key, row = null, ctx = {}) {
  const val = unitField(row || {}, key);
  if (key === 'clase') return catalogWithValue(catalogNames('categorias'), val);
  if (key === 'sucursal' || key === 'plazaActual') {
    return catalogWithValue(plazasCatalog(ctx.plaza || ''), val);
  }
  if (key === 'estado') return estadosCatalog(val, ctx.allUnits || []);
  if (key === 'modelo') return catalogWithValue(catalogNames('modelos'), val);
  return null;
}

export function renderFieldControl(key, row, { editing = false, required = false, ctx = {} } = {}) {
  const val = unitField(row, key);
  const req = required ? ' required' : '';
  const label = `${esc(FIELD_LABEL[key])}${required ? ' *' : ''}`;
  const locked = key === 'id';
  const catalog = fieldCatalog(key, row, ctx);

  if (key === 'descripcion') {
    if (editing) {
      return `<label class="span-all"><span>${label}</span><textarea name="descripcion" placeholder="Notas u observaciones">${esc(row?.descripcion || row?.notas || '')}</textarea></label>`;
    }
    return `<label class="span-all"><span>${label}</span><textarea readonly tabindex="-1">${esc(val || 'Sin notas registradas.')}</textarea></label>`;
  }

  if (key === 'activo') {
    if (editing) {
      const active = isActive(row || {});
      return `<label><span>${label}</span><select name="activo"${req}>
        ${optionHtml('Activo', 'Activo', active ? 'Activo' : 'Inactivo')}
        ${optionHtml('Inactivo', 'Inactivo', active ? 'Activo' : 'Inactivo')}
      </select></label>`;
    }
    return `<label><span>${label}</span><input value="${esc(val || '—')}" readonly tabindex="-1"></label>`;
  }

  if (key === 'capacidadTanque') {
    const cap = capacidadTanqueDisplay(row);
    if (editing) {
      return `<label><span>${label}</span><input name="capacidadTanque" type="number" min="0" step="1" inputmode="numeric" placeholder="Ej. 54" value="${esc(cap)}"${req}></label>`;
    }
    return `<label><span>${label}</span><input value="${esc(cap ? `${cap} L` : '—')}" readonly tabindex="-1"></label>`;
  }

  if (editing && catalog?.length) {
    const options = catalogWithValue(catalog, val);
    return `<label><span>${label}</span><select name="${esc(key)}"${req}>
      ${required ? '' : optionHtml('', 'Seleccionar', val)}
      ${options.map(item => optionHtml(item, item, val)).join('')}
    </select></label>`;
  }

  if (editing && !locked) {
    return `<label><span>${label}</span><input name="${esc(key)}" value="${esc(val)}"${req}></label>`;
  }

  return `<label><span>${label}</span><input value="${esc(val || '—')}" readonly tabindex="-1"></label>`;
}

export function numberOrText(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : raw;
}

export function buildUnitPayload(row, original = null, { plaza = '', actor = 'Sistema' } = {}) {
  const owner = norm(row.sucursal || row.plaza || original?.sucursal || plaza);
  const actual = norm(row.plazaActual || row.ubicacionActual || original?.plazaActual || owner);
  const payload = {
    ...(original || {}),
    mva: norm(row.mva),
    vin: norm(row.vin),
    clase: norm(row.clase || row.categoria),
    categoria: norm(row.clase || row.categoria),
    anio: String(row.anio || row.año || '').trim(),
    marca: norm(row.marca),
    modelo: norm(row.modelo),
    placas: norm(row.placas),
    color: norm(row.color),
    sucursal: owner,
    plaza: owner,
    plazaActual: actual,
    estado: norm(row.estado || row.estatus),
    activo: normalizeActivo(row.activo),
    capacidadTanque: normalizeCapacidadTanque({ ...(original || {}), ...row }),
    km: numberOrText(row.km),
    descripcion: String(row.descripcion || row.notas || '').trim(),
    _updatedAt: Date.now(),
    _updatedBy: actor
  };
  delete payload.gasolina;
  return payload;
}

export function renderDetailFormHtml(row, { editing = false, unitId = '', formCtx = {}, busy = false } = {}) {
  const id = esc(unitId || row?.id || row?.mva || '');
  const ctx = formCtx;
  return `
    <form class="uni-form uni-form--wide" data-unit-form="edit" data-id="${id}" data-context="detail">
      <section class="uni-form-panel">
        <div class="uni-form-grid uni-form-grid--meta">
          ${FIELD_ORDER.filter(k => k !== 'descripcion').map(k => renderFieldControl(k, row, { editing, required: k === 'mva', ctx })).join('')}
        </div>
      </section>
      <section class="uni-form-panel">
        ${renderFieldControl('descripcion', row, { editing, ctx })}
      </section>
      <div class="uni-form-actions uni-form-actions--footer"${editing ? '' : ' hidden'}>
        <button type="button" class="uni-btn ghost" data-action="cancel-edit">Cancelar</button>
        <button type="submit" class="uni-btn primary" data-action="save-detail"${busy ? ' disabled' : ''}>Guardar cambios</button>
      </div>
    </form>
  `;
}

export function renderDetailCardHtml(row, {
  editing = false,
  canManage = false,
  busy = false,
  formCtx = {}
} = {}) {
  const unitId = esc(row?.id || row?.mva || '');
  const mva = esc(row?.mva || row?.id || 'Unidad');
  const subtitle = esc([row?.placas, row?.vin].filter(Boolean).join(' · ') || 'Sin datos adicionales');
  const headActions = editing ? '' : `
    <button type="button" class="uni-btn ghost" data-action="back">Cerrar</button>
    <button type="button" class="uni-btn primary" data-action="edit"${canManage ? '' : ' disabled'}>Editar</button>
  `;
  return `
    <section class="uni-detail-card uni-detail-card--wide${editing ? ' is-editing' : ''}">
      <div class="uni-detail-head">
        <div>
          <p>Detalle de unidad</p>
          <h2>${mva}</h2>
          <span>${subtitle}</span>
        </div>
        <div class="uni-actions">${headActions}</div>
      </div>
      ${renderDetailFormHtml(row, { editing, unitId, formCtx, busy })}
    </section>
  `;
}