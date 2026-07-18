import { esGlobal } from '/domain/permissions.model.js';
import {
  buildExportFilename,
  exportFooterHtml,
  getExportIdentity,
} from '/js/core/export-signing.js';

const GAS_OPTIONS = ['N/A', 'F', '15/16', '7/8', '13/16', '3/4', '11/16', '5/8', '9/16', '1/2', 'H', '7/16', '3/8', '5/16', '1/4', '3/16', '1/8', '1/16', 'E'];
const STATE_OPTIONS = ['LISTO', 'SUCIO', 'MANTENIMIENTO', 'TRASLADO', 'RESGUARDO', 'NO ARRENDABLE', 'RETENIDA', 'VENTA'];

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function text(value) {
  return String(value ?? '').trim();
}

function up(value) {
  return text(value).toUpperCase();
}

function isOk(result) {
  if (result === true || result === 'OK' || result === 'EXITO') return true;
  if (typeof result === 'string') return !/^ERROR\b/i.test(result);
  return Boolean(result?.ok || result?.success);
}

function actorFrom(ctx = {}) {
  const p = ctx.profile || {};
  const u = ctx.user || {};
  return text(ctx.userName || p.nombreCompleto || p.nombre || p.usuario || p.email || u.email || 'AppShell') || 'AppShell';
}

export function canUseMapaOfficialTools(ctx = {}) {
  const role = up(ctx.role || ctx.profile?.rol || ctx.state?.role);
  if (role === 'PROGRAMADOR') return true;
  const p = ctx.profile || ctx.state?.profile || {};
  return Boolean(p.isAdmin === true && esGlobal(role));
}

function modal(container, title, bodyHtml, actionsHtml = '') {
  return new Promise(resolve => {
    if (!container) return resolve({ cancelled: true });
    const wrap = document.createElement('div');
    wrap.className = 'app-mapa-modal-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.innerHTML = `
      <div class="app-mapa-modal app-mapa-modal--official">
        <p class="app-mapa-modal-title">${esc(title)}</p>
        ${bodyHtml}
        <p class="app-mapa-form-msg" data-msg></p>
        <div class="app-mapa-modal-actions">
          ${actionsHtml || `
            <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--ghost" data-act="cancel">Cancelar</button>
            <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--primary" data-act="ok">Confirmar</button>
          `}
        </div>
      </div>`;
    const done = result => {
      wrap.remove();
      resolve(result);
    };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) done({ cancelled: true });
    });
    wrap.querySelector('[data-act="cancel"]')?.addEventListener('click', () => done({ cancelled: true }));
    wrap.querySelector('[data-act="close"]')?.addEventListener('click', () => done({ cancelled: true }));
    wrap.querySelector('[data-act="ok"]')?.addEventListener('click', () => done({ cancelled: false, root: wrap }));
    container.appendChild(wrap);
    return wrap;
  });
}

function readFields(root) {
  const out = {};
  root.querySelectorAll('[data-fld]').forEach(el => {
    const k = el.getAttribute('data-fld');
    if (!k) return;
    if (el.type === 'checkbox') out[k] = Boolean(el.checked);
    else out[k] = text(el.value);
  });
  return out;
}

function optionsHtml(options, selected = '') {
  const sel = up(selected);
  return options.map(v => `<option value="${esc(v)}"${up(v) === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

function unitForm(unit = {}, ctx = {}, mode = 'edit') {
  const plaza = up(ctx.plaza || unit.plaza || '');
  return `
    <div class="app-mapa-form-grid">
      <label class="app-mapa-form-field"><span>MVA</span><input data-fld="mva" value="${esc(unit.mva || '')}" ${mode === 'edit' ? 'readonly' : ''} /></label>
      <label class="app-mapa-form-field"><span>Plaza</span><input data-fld="plaza" value="${esc(plaza)}" /></label>
      <label class="app-mapa-form-field"><span>Modelo</span><input data-fld="modelo" value="${esc(unit.modelo || '')}" /></label>
      <label class="app-mapa-form-field"><span>Placas</span><input data-fld="placas" value="${esc(unit.placas || '')}" /></label>
      <label class="app-mapa-form-field"><span>Categoría</span><input data-fld="categoria" value="${esc(unit.categoria || unit.tipo || '')}" /></label>
      <label class="app-mapa-form-field"><span>Ubicación</span><select data-fld="ubicacion">
        ${optionsHtml(['PATIO', 'TALLER', 'EXTERNO'], unit.ubicacion || 'PATIO')}
      </select></label>
      <label class="app-mapa-form-field"><span>Estado</span><select data-fld="estado">${optionsHtml(STATE_OPTIONS, unit.estado || 'SUCIO')}</select></label>
      <label class="app-mapa-form-field"><span>Gasolina</span><select data-fld="gasolina">${optionsHtml(GAS_OPTIONS, unit.gasolina || 'N/A')}</select></label>
      <label class="app-mapa-form-field"><span>Posición</span><input data-fld="pos" value="${esc(unit.pos || 'LIMBO')}" /></label>
      <label class="app-mapa-form-field app-mapa-form-field--wide"><span>Notas</span><textarea data-fld="notas" rows="3">${esc(unit.notas || '')}</textarea></label>
    </div>`;
}

function validateUnitPayload(payload, ctx) {
  const mva = up(payload.mva);
  const plaza = up(payload.plaza || ctx.plaza);
  if (!mva) return 'MVA requerido.';
  if (!plaza) return 'Plaza requerida.';
  if (!/^[A-Z0-9_-]{3,24}$/.test(mva)) return 'MVA inválido.';
  return '';
}

export async function openUnitCrud({ container, api, unit = null, ctx = {}, mode = 'create', resync = null }) {
  if (!canUseMapaOfficialTools(ctx)) return { ok: false, message: 'Rol no autorizado para modificar unidades.' };
  const title = mode === 'delete' ? 'Eliminar unidad' : mode === 'edit' ? 'Editar unidad' : 'Alta de unidad';
  const confirmLabel = mode === 'delete' ? 'Eliminar definitivamente' : mode === 'edit' ? 'Guardar cambios' : 'Crear unidad';
  const body = mode === 'delete'
    ? `<p class="app-mapa-modal-body">Escribe <strong>${esc(unit?.mva || '')}</strong> para confirmar eliminación en plaza <strong>${esc(ctx.plaza || unit?.plaza || '')}</strong>.</p>
       <label class="app-mapa-form-field"><span>Confirmación</span><input data-fld="confirm" /></label>`
    : unitForm(unit || {}, ctx, mode);
  const prepared = await modal(container, title, body, `
    <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--ghost" data-act="cancel">Cancelar</button>
    <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--primary" data-act="ok">${esc(confirmLabel)}</button>
  `);
  if (prepared.cancelled) return { ok: false, cancelled: true };
  const payload = readFields(prepared.root);
  const actor = actorFrom(ctx);
  try {
    let result;
    if (mode === 'delete') {
      if (up(payload.confirm) !== up(unit?.mva)) return { ok: false, message: 'Confirmación inválida.' };
      result = await api.eliminarUnidadPlaza(up(ctx.plaza || unit?.plaza), unit?.id || unit?.fila || unit?.mva);
    } else {
      const validation = validateUnitPayload(payload, ctx);
      if (validation) return { ok: false, message: validation };
      const normalized = {
        ...payload,
        mva: up(payload.mva),
        plaza: up(payload.plaza || ctx.plaza),
        sucursal: up(payload.plaza || ctx.plaza),
        modelo: up(payload.modelo || 'S/M'),
        placas: up(payload.placas || 'S/P'),
        categoria: up(payload.categoria || ''),
        estado: up(payload.estado || 'SUCIO'),
        ubicacion: up(payload.ubicacion || 'PATIO'),
        gasolina: text(payload.gasolina || 'N/A'),
        pos: up(payload.pos || 'LIMBO'),
        responsableSesion: actor,
        autor: actor
      };
      if (mode === 'create') {
        result = normalized.ubicacion === 'EXTERNO'
          ? await api.insertarUnidadExterna(normalized)
          : await api.insertarUnidadDesdeHTML(normalized);
      } else {
        result = await api.actualizarUnidadPlaza({ ...(unit?._raw || unit || {}), ...normalized, id: unit?.id || unit?.fila || unit?.mva });
      }
    }
    if (!isOk(result)) return { ok: false, message: String(result?.message || result || 'Acción no exitosa.') };
    await resync?.();
    return { ok: true, message: mode === 'delete' ? 'Unidad eliminada.' : 'Unidad guardada.' };
  } catch (error) {
    return { ok: false, message: String(error?.message || error || 'Error ejecutando acción.') };
  }
}

export async function openBulkUnits({ container, api, ctx = {}, resync = null }) {
  if (!canUseMapaOfficialTools(ctx)) return { ok: false, message: 'Rol no autorizado para altas masivas.' };
  const prepared = await modal(container, 'Alta masiva', `
    <p class="app-mapa-modal-body">Pega una unidad por línea: MVA, modelo, placas, categoría, ubicación, estado, gasolina, posición.</p>
    <label class="app-mapa-form-field app-mapa-form-field--wide"><span>Unidades</span><textarea data-fld="rows" rows="10" placeholder="ABC123, Versa, XYZ123, COMPACTO, PATIO, SUCIO, N/A, LIMBO"></textarea></label>
    <label class="app-mapa-form-field app-mapa-form-field--check"><input data-fld="externos" type="checkbox" /> <span>Registrar como externos</span></label>
  `, `
    <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--ghost" data-act="cancel">Cancelar</button>
    <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--primary" data-act="ok">Previsualizar y aplicar</button>
  `);
  if (prepared.cancelled) return { ok: false, cancelled: true };
  const fields = readFields(prepared.root);
  const rows = text(fields.rows).split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [mva, modelo, placas, categoria, ubicacion, estado, gasolina, pos] = line.split(',').map(text);
    return { mva: up(mva), modelo, placas, categoria, ubicacion: fields.externos ? 'EXTERNO' : up(ubicacion || 'PATIO'), estado: fields.externos ? 'EXTERNO' : up(estado || 'SUCIO'), gasolina: gasolina || 'N/A', pos: up(pos || 'LIMBO'), plaza: up(ctx.plaza) };
  });
  if (!rows.length) return { ok: false, message: 'No hay filas para aplicar.' };
  const invalid = rows.find(r => validateUnitPayload(r, ctx));
  if (invalid) return { ok: false, message: `Fila inválida: ${invalid.mva || '(sin MVA)'}` };
  const confirm = await modal(container, 'Confirmar alta masiva', `
    <p class="app-mapa-modal-body">Se crearán <strong>${rows.length}</strong> unidades en <strong>${esc(ctx.plaza)}</strong>. Esta acción no se ejecuta en silencio.</p>
    <div class="app-mapa-bulk-preview">${rows.slice(0, 20).map(r => `<span>${esc(r.mva)} · ${esc(r.modelo || 'S/M')} · ${esc(r.ubicacion)}</span>`).join('')}</div>
  `);
  if (confirm.cancelled) return { ok: false, cancelled: true };
  const actor = actorFrom(ctx);
  let ok = 0;
  const errors = [];
  for (const row of rows) {
    try {
      const payload = { ...row, responsableSesion: actor, autor: actor };
      const res = row.ubicacion === 'EXTERNO'
        ? await api.insertarUnidadExterna(payload)
        : await api.insertarUnidadDesdeHTML(payload);
      if (isOk(res)) ok += 1;
      else errors.push(`${row.mva}: ${res}`);
    } catch (error) {
      errors.push(`${row.mva}: ${error?.message || error}`);
    }
  }
  await resync?.();
  return { ok: errors.length === 0, message: `Altas aplicadas: ${ok}/${rows.length}${errors.length ? `. Errores: ${errors.slice(0, 3).join(' | ')}` : ''}` };
}

export async function openRadar({ container, snapshot = {}, incSummary = {}, ctx = {} }) {
  const units = Array.isArray(snapshot.units) ? snapshot.units : [];
  const total = units.length;
  const count = pred => units.filter(pred).length;
  const inc = incSummary?.byMva || {};
  const abiertas = Object.values(inc).reduce((sum, item) => sum + Number(item?.abiertas || 0), 0);
  const criticas = Object.values(inc).reduce((sum, item) => sum + Number(item?.criticas || 0), 0);
  await modal(container, 'Radar operativo', `
    <div class="app-mapa-radar-grid">
      <div><span>Total flota</span><strong>${total}</strong></div>
      <div><span>Listos</span><strong>${count(u => up(u.estado) === 'LISTO')}</strong></div>
      <div><span>Mantenimiento / sucio</span><strong>${count(u => ['MANTENIMIENTO', 'SUCIO'].includes(up(u.estado)))}</strong></div>
      <div><span>Taller</span><strong>${count(u => up(u.ubicacion) === 'TALLER')}</strong></div>
      <div><span>Externos</span><strong>${count(u => up(u.ubicacion) === 'EXTERNO' || up(u.tipo) === 'EXTERNO')}</strong></div>
      <div><span>Sin ubicación</span><strong>${count(u => !up(u.pos) || up(u.pos) === 'LIMBO')}</strong></div>
      <div><span>Incidencias abiertas</span><strong>${abiertas}</strong></div>
      <div><span>Críticas / alta</span><strong>${criticas}</strong></div>
    </div>
    <p class="app-mapa-modal-body">Plaza ${esc(ctx.plaza || snapshot.plaza || '—')} · datos reutilizados del mapa cargado, sin listeners duplicados.</p>
  `, `<button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--primary" data-act="close">Cerrar</button>`);
  return { ok: true };
}

export async function openReports({ container, snapshot = {}, ctx = {} }) {
  const units = Array.isArray(snapshot.units) ? snapshot.units : [];
  const prepared = await modal(container, 'Reportes / PDF', `
    <div class="app-mapa-form-grid">
      <label class="app-mapa-form-field"><span>Tipo</span><select data-fld="tipo">
        <option value="resumen">Resumen operativo</option>
        <option value="lista">Lista de unidades</option>
      </select></label>
    </div>
    <p class="app-mapa-modal-body">Genera un documento imprimible con los datos actuales de /app/mapa.</p>
  `, `
    <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--ghost" data-act="cancel">Cancelar</button>
    <button type="button" class="app-mapa-modal-btn app-mapa-modal-btn--primary" data-act="ok">Generar PDF</button>
  `);
  if (prepared.cancelled) return { ok: false, cancelled: true };
  const { tipo } = readFields(prepared.root);
  const rows = units.slice(0, tipo === 'lista' ? 800 : 80).map(u => `
    <tr><td>${esc(u.mva)}</td><td>${esc(u.modelo || '')}</td><td>${esc(u.placas || '')}</td><td>${esc(u.estado || '')}</td><td>${esc(u.ubicacion || '')}</td><td>${esc(u.pos || '')}</td></tr>
  `).join('');
  const win = window.open('', '_blank');
  if (!win) return { ok: false, message: 'Activa ventanas emergentes para generar el PDF.' };
  const id = getExportIdentity();
  const title = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  const firma = exportFooterHtml({ escapeHtml: esc });
  win.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111827}h1{font-size:20px}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #d1d5db;padding:6px;text-align:left}th{background:#f3f4f6}.meta{margin:0 0 12px;font-size:11px;color:#64748b}</style></head><body><h1>Reporte mapa ${esc(ctx.plaza || snapshot.plaza || '')}</h1><p class="meta"><strong>${esc(id.companyName)}</strong> · ${esc(id.dateLabel)} · ${units.length} unidades</p><p class="meta">Exportado por ${esc(id.userName)}</p><table><thead><tr><th>MVA</th><th>Modelo</th><th>Placas</th><th>Estado</th><th>Ubicación</th><th>Pos</th></tr></thead><tbody>${rows}</tbody></table>${firma}<script>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  win.document.close();
  return { ok: true, message: 'PDF listo.' };
}

export async function openEditor({ container, api, snapshot = {}, ctx = {}, resync = null }) {
  if (!canUseMapaOfficialTools(ctx)) return { ok: false, message: 'Rol no autorizado para editar layout.' };
  try {
    const mod = await import('/js/app/features/mapa/mapa-visual-editor.js');
    if (typeof mod.openVisualMapEditor !== 'function') {
      throw new Error('openVisualMapEditor no disponible');
    }
    await mod.openVisualMapEditor({ container, api, snapshot, ctx, resync });
    return { ok: true, message: 'Editor cerrado.' };
  } catch (e) {
    return { ok: false, message: String(e?.message || e || 'Error abriendo editor visual.') };
  }
}
