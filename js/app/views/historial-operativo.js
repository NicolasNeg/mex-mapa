// ═══════════════════════════════════════════════════════════
//  /js/app/views/historial-operativo.js
//  Historial de cambios — vista SPA (/app/historial-operativo).
//
//  Panel principal: logs COL.LOGS (IN / BAJA / EDIT)
//  Pestaña Gestión: bitacora_gestion (platform_full_access + ver ubi)
//  Movimientos de patio viven en Cuadre / historial de actividad (no duplicados aquí).
// ═══════════════════════════════════════════════════════════

import { normalizeHistorialLog, stripEmoji } from '/domain/historial-log.model.js';
import { hasAppPermission } from '/js/app/features/admin/admin-permissions.js';
import { buildExportFilename } from '/js/core/export-signing.js';
import {
  openExportChooser,
  exportMatrixCsv,
  exportMatrixXls,
  exportMatrixPdf,
} from '/js/core/export-menu.js';

let _container  = null;
let _state      = null;
let _cssInjected = false;
let _abortCtrl  = null;

const PAGE_SIZES = [25, 50, 100];

// ── Estado interno ───────────────────────────────────────────
function _makeState(access = {}) {
  return {
    tab:          'cambios',   // 'cambios' | 'gestion'
    estado:       [],
    gestion:      [],
    loadingEst:   false,
    loadingGes:   false,
    errorGes:     '',
    canGestion:   access.canGestion === true,
    canVerUbi:    access.canVerUbi === true,
    qEst:         '',
    tipoEst:      'TODOS',
    pageEst:      1,
    pageSizeEst:  50,
    qGes:         '',
    tipoGes:      'TODOS',
    pageGes:      1,
    pageSizeGes:  50,
  };
}

// ── CSS ──────────────────────────────────────────────────────
function _ensureCss() {
  if (_cssInjected) return;
  _cssInjected = true;
  if (document.querySelector('link[data-app-historial-operativo-css], link[data-hist-op-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-historial-operativo.css?v=20260721a';
  link.setAttribute('data-hist-op-css', '1');
  document.head.appendChild(link);
}

// ── Helpers ──────────────────────────────────────────────────
const q   = id  => _container?.querySelector(`#hist-op-${id}`);
const esc = str => String(str ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function _resolveAccess(ctx = {}) {
  const shellState = ctx.state || {};
  const profile = shellState.profile
    || window.MEX_CONFIG?.profile
    || window._userProfile
    || {};
  const role = String(shellState.role || profile.rol || profile.role || 'AUXILIAR').toUpperCase().trim();
  const canGestion = hasAppPermission(profile, role, 'platform_full_access');
  const canVerUbi = canGestion && hasAppPermission(profile, role, 'view_exact_location_logs');
  return { canGestion, canVerUbi };
}

function _csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function _exportDate() {
  return new Date().toISOString().slice(0, 10);
}

function _toast(message, type = 'info') {
  if (typeof window.showToast === 'function') window.showToast(message, type);
  else console[type === 'error' ? 'error' : 'log'](message);
}

function _pagerHtml(prefix, page, pageSize, total) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total ? (safePage - 1) * pageSize + 1 : 0;
  const end = Math.min(safePage * pageSize, total);
  const sizeOpts = PAGE_SIZES.map(n =>
    `<option value="${n}"${n === pageSize ? ' selected' : ''}>${n}</option>`
  ).join('');
  return `
    <div class="hist-op-pager">
      <label class="hist-op-page-size"><span>Mostrar</span>
        <select id="hist-op-pageSize${prefix}">${sizeOpts}</select>
      </label>
      <span class="hist-op-pager-label">${total ? `${start}–${end} de ${total}` : 'Sin registros'}</span>
      <div class="hist-op-pager-btns">
        <button type="button" class="hist-op-btn-page" data-page-action="prev-${prefix}" ${safePage <= 1 ? 'disabled' : ''}>Anterior</button>
        <button type="button" class="hist-op-btn-page" data-page-action="next-${prefix}" ${safePage >= totalPages ? 'disabled' : ''}>Siguiente</button>
      </div>
    </div>`;
}

function _normalizeEstadoRow(log) {
  const n = normalizeHistorialLog(log);
  return {
    ...log,
    tipo: _normalizeTipo(log.tipo || n.tipo),
    mva: n.mva === '—' ? '' : n.mva,
    unidad: n.mva,
    cambio: n.cambio,
    estadoAnterior: n.estadoAnterior,
    estadoNuevo: n.estadoNuevo,
    estadoLabel: n.estadoLabel,
    ubicacionAnterior: n.ubicacionAnterior,
    ubicacionNueva: n.ubicacionNueva,
    notaAnterior: n.notaAnterior,
    notaNueva: n.notaNueva,
    km: n.km,
    motivoSalida: n.motivoSalida,
    cambios: n.cambios,
    accion: n.cambio,
    detalles: n.cambio,
    autor: n.autor,
    usuario: n.autor,
    fecha: n.fecha || log.fecha || '',
    timestamp: log.timestamp || n.timestamp || 0
  };
}

function _filteredEstado() {
  const qv = _state.qEst.toLowerCase();
  let rows = _state.estado.filter(_estadoPermitido);
  if (qv) {
    rows = rows.filter(r =>
      [
        r.unidad, r.mva, r.autor, r.cambio, r.tipo, r.estadoLabel,
        r.estadoAnterior, r.estadoNuevo, r.ubicacionAnterior, r.ubicacionNueva,
        r.notaAnterior, r.notaNueva, r.motivoSalida, r.km
      ]
        .some(v => String(v ?? '').toLowerCase().includes(qv))
    );
  }
  if (_state.tipoEst && _state.tipoEst !== 'TODOS') {
    rows = rows.filter(r => _normalizeTipo(r.tipo) === _state.tipoEst);
  }
  return rows;
}

function _normalizeGestionRow(log = {}) {
  const exactLocation = log.exactLocation && typeof log.exactLocation === 'object'
    ? log.exactLocation
    : {};
  return {
    ...log,
    tipo: _normalizeTipo(log.tipo || 'GESTION'),
    accion: _cleanAuditText(log.accion || 'Evento de gestion'),
    autor: _cleanAuditText(log.autor || log.usuario || 'Sistema'),
    fecha: String(log.fecha || ''),
    timestamp: log.timestamp || exactLocation.capturedAt || 0,
    exactLocation
  };
}

function _filteredGestion() {
  if (!_state.canGestion) return [];
  const qv = _state.qGes.toLowerCase().trim();
  let rows = _state.gestion;
  if (qv) {
    rows = rows.filter(row => [
      row.tipo, row.accion, row.autor, row.usuario, row.fecha,
      row.entidad, row.referencia, row.detalles, row.objetivo,
      row.rolObjetivo, row.plazaObjetivo, row.resultado, row.plaza,
      row.userEmail, row.role, row.exactLocation?.addressLabel,
      row.exactLocation?.city, row.exactLocation?.state
    ].some(value => String(value || '').toLowerCase().includes(qv)));
  }
  if (_state.tipoGes && _state.tipoGes !== 'TODOS') {
    rows = rows.filter(row => _normalizeTipo(row.tipo) === _state.tipoGes);
  }
  return rows;
}

function _gestionTypes() {
  return [...new Set(_state.gestion.map(row => _normalizeTipo(row.tipo)).filter(Boolean))].sort();
}

function _syncGestionTypeOptions() {
  const select = q('tipoGes');
  if (!select) return;
  const current = _state.tipoGes;
  select.innerHTML = `<option value="TODOS">Todos los tipos</option>`
    + _gestionTypes().map(tipo => `<option value="${esc(tipo)}">${esc(_gestionTypeLabel(tipo))}</option>`).join('');
  select.value = _gestionTypes().includes(current) ? current : 'TODOS';
  _state.tipoGes = select.value;
}

function _gestionContext(row = {}) {
  const main = row.referencia || row.objetivo || row.entidad || row.plaza || 'Sin referencia';
  const meta = [
    row.entidad && row.entidad !== main ? row.entidad : '',
    row.rolObjetivo ? `Rol: ${row.rolObjetivo}` : '',
    row.plazaObjetivo ? `Plaza: ${row.plazaObjetivo}` : '',
    row.resultado ? `Resultado: ${row.resultado}` : '',
    row.detalles || ''
  ].filter(Boolean);
  return { main: _cleanAuditText(main), meta: meta.map(_cleanAuditText) };
}

function _safeMapsUrl(row = {}) {
  if (!_state.canVerUbi) return '';
  const exact = row.exactLocation || {};
  const latitude = Number(exact.latitude ?? row.latitude ?? row.geoLatitude);
  const longitude = Number(exact.longitude ?? row.longitude ?? row.geoLongitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)
      && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    return `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`;
  }
  const raw = String(exact.googleMapsUrl || row.googleMapsUrl || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch (_) {
    return '';
  }
}

function _gestionLocationLabel(row = {}) {
  if (!_state.canVerUbi) return 'Sin permiso';
  const exact = row.exactLocation || {};
  const label = exact.addressLabel
    || [exact.city, exact.state].filter(Boolean).join(', ');
  if (label) return _cleanAuditText(label);
  const status = String(row.locationStatus || exact.status || '').toLowerCase();
  if (status === 'denied') return 'Permiso denegado';
  if (status === 'unsupported') return 'Sin soporte';
  if (status === 'error') return 'Error de ubicacion';
  return 'Sin ubicacion';
}

// Normaliza cualquier timestamp (segundos | ms | Firestore {seconds}) a día local
// 'YYYY-MM-DD'. El filtro fallaba cuando timestamp llegaba como objeto (*1000=NaN).
function _tsADia(ts) {
  if (ts == null) return '';
  let ms;
  if (typeof ts === 'object' && 'seconds' in ts) ms = ts.seconds * 1000;
  else if (typeof ts === 'number') ms = ts < 1e12 ? ts * 1000 : ts; // <1e12 => segundos
  else ms = new Date(ts).getTime();
  if (!isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _normalizeTipo(tipo) {
  const t = String(tipo || "").toUpperCase().trim();
  if (t === "MODIF" || t === "MODIFICACION" || t === "MODIFICACIÓN") return "EDIT";
  if (t === "DELETE") return "DEL";
  return t || "OTRO";
}

function _tipoBadgeClass(tipo) {
  const t = _normalizeTipo(tipo);
  const map = { MOVE:"badge-move", SWAP:"badge-swap", ADD:"badge-add", EDIT:"badge-edit", DEL:"badge-del", IN:"badge-add", BAJA:"badge-del", GESTION:"badge-gestion" };
  return map[t] || "badge-otro";
}

function _tipoLabel(tipo) {
  const t = _normalizeTipo(tipo);
  return t === "OTRO" ? "INFO" : t;
}

function _tipoIcon(tipo) {
  const map = {
    MOVE: "arrow_forward",
    SWAP: "swap_horiz",
    ADD: "add_circle",
    DEL: "remove_circle",
    IN: "login",
    BAJA: "logout",
    EDIT: "edit_note",
    GESTION: "settings_suggest"
  };
  return map[_normalizeTipo(tipo)] || "info";
}

function _gestionBadgeClass(tipo) {
  const value = _normalizeTipo(tipo);
  if (/RECHAZ|ELIMIN|BLOQUE|ERROR|FALLO/.test(value)) return 'badge-del';
  if (/APROBAD|CREAD|EMITID|LIBERAD|COMPLET/.test(value)) return 'badge-add';
  return 'badge-gestion';
}

function _gestionTypeLabel(tipo) {
  return _tipoLabel(tipo).replace(/_/g, ' ');
}

function _cleanAuditText(value) {
  return stripEmoji(value)
    .replace(/\s*\|\s*Notas eliminadas/gi, "")
    .replace(/Notas reemplazadas/gi, "Notas actualizadas")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function _estadoPermitido(row) {
  return ["IN", "BAJA", "EDIT"].includes(_normalizeTipo(row?.tipo));
}

function _toMs(ts) {
  if (ts == null) return 0;
  if (typeof ts === "object" && "seconds" in ts) return ts.seconds * 1000;
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function _estadoCellHtml(row) {
  if (row.estadoAnterior || row.estadoNuevo) {
    return `<span class="hist-op-estado-flow">
      <span class="hist-op-estado-prev">${esc(row.estadoAnterior || '—')}</span>
      <span class="hist-op-estado-arrow" aria-hidden="true">→</span>
      <span class="hist-op-estado-next">${esc(row.estadoNuevo || '—')}</span>
    </span>`;
  }
  return `<span class="hist-op-estado-empty">—</span>`;
}

function _formatKm(value) {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(value);
}

function _detailAlreadyVisible(cambio, label, value) {
  const compact = input => String(input || '').toLowerCase().replace(/[\s,]+/g, '');
  const text = compact(cambio);
  const cleanValue = compact(value);
  return text.includes(compact(label))
    && (!cleanValue || text.includes(cleanValue));
}

function _estadoDetails(row) {
  const tipo = _normalizeTipo(row.tipo);
  const details = [];
  const push = (label, value, options = {}) => {
    if (!value && value !== 0) return;
    const aliases = [label, ...(options.aliases || [])];
    if (!options.always && aliases.some(alias => _detailAlreadyVisible(row.cambio, alias, value))) return;
    details.push({ label, value: String(value), tone: options.tone || '' });
  };

  if (tipo === 'IN') {
    const km = _formatKm(row.km);
    push('Km de entrada', km || 'No registrado', { always: !km, tone: km ? '' : 'muted', aliases: ['km'] });
  }

  if (tipo === 'BAJA') {
    const motivo = row.motivoSalida === 'RENTA'
      ? 'Renta'
      : row.motivoSalida === 'OTRO' ? 'Otro' : 'Sin motivo registrado';
    push('Motivo de salida', motivo, {
      always: !row.motivoSalida,
      tone: row.motivoSalida ? 'danger' : 'muted',
      aliases: ['motivo']
    });
    if (Number.isFinite(row.km)) push('Km de salida', _formatKm(row.km));
  }

  if (tipo === 'EDIT') {
    if (row.ubicacionAnterior || row.ubicacionNueva) {
      const value = `${row.ubicacionAnterior || 'Sin ubicación'} → ${row.ubicacionNueva || 'Sin ubicación'}`;
      push('Ubicación', value);
    }
    if (row.notaNueva) {
      push('Notas nuevas', row.notaNueva, { always: true });
    } else if (row.notaAnterior && /nota/i.test(row.cambio || '')) {
      push('Notas', 'Eliminadas', { tone: 'muted' });
    }
  }

  return details;
}

function _cambioCellHtml(row) {
  const details = _estadoDetails(row);
  return `
    <div class="hist-op-change-main">${esc(row.cambio || 'Cambio registrado')}</div>
    ${details.length ? `<div class="hist-op-change-details">
      ${details.map(detail => `<div class="hist-op-change-detail ${detail.tone ? `is-${detail.tone}` : ''}">
        <span>${esc(detail.label)}</span><strong>${esc(detail.value)}</strong>
      </div>`).join('')}
    </div>` : ''}`;
}

function _gestionLocationHtml(row) {
  const label = _gestionLocationLabel(row);
  const href = _safeMapsUrl(row);
  return `<div class="hist-op-location-cell">
    <span class="hist-op-location-label"><span class="material-icons" aria-hidden="true">location_on</span>${esc(label)}</span>
    ${href ? `<a class="hist-op-ubi-btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">
      <span class="material-icons" aria-hidden="true">map</span>Ver ubi
    </a>` : ''}
  </div>`;
}

function _renderShell() {
  const tabsHtml = _state.canGestion ? `
      <div class="hist-op-tabs">
        <button id="hist-op-tab-cambios" class="hist-op-tab ${_state.tab === 'cambios' ? 'active' : ''}"
          data-tab="cambios">
          <span class="material-icons">history</span> Cambios
        </button>
        <button id="hist-op-tab-ges" class="hist-op-tab ${_state.tab === 'gestion' ? 'active' : ''}"
          data-tab="gestion">
          <span class="material-icons">admin_panel_settings</span> Gestión
        </button>
      </div>` : '';

  _container.innerHTML = `
    <div class="hist-op-root">
      ${tabsHtml}

      <div id="hist-op-panel-cambios" class="hist-op-panel ${_state.canGestion && _state.tab !== 'cambios' ? 'hidden' : ''}">
        <div class="hist-op-filters">
          <input id="hist-op-qEst" type="text" placeholder="Buscar unidad, autor o cambio" value="${esc(_state.qEst)}">
          <select id="hist-op-tipoEst">
            ${['TODOS','IN','BAJA','EDIT'].map(t =>
              `<option value="${t}" ${_state.tipoEst===t?'selected':''}>${_tipoLabel(t)}</option>`).join('')}
          </select>
          <button id="hist-op-exportEst" class="hist-op-btn-export" type="button" title="Exportar PDF / XLS / CSV">
            <span class="material-icons">download</span> Exportar
          </button>
          <button id="hist-op-recargarEst" class="hist-op-btn-refresh" type="button">
            <span class="material-icons">sync</span>
          </button>
          <span id="hist-op-contadorEst" class="hist-op-counter"></span>
        </div>
        <div id="hist-op-tablaEst" class="hist-op-table-wrap"></div>
      </div>

      ${_state.canGestion ? `<div id="hist-op-panel-gestion" class="hist-op-panel ${_state.tab === 'gestion' ? '' : 'hidden'}">
        <div class="hist-op-filters">
          <input id="hist-op-qGes" type="text" placeholder="Buscar usuario, acción o referencia" value="${esc(_state.qGes)}">
          <select id="hist-op-tipoGes">
            <option value="TODOS">Todos los tipos</option>
          </select>
          <button id="hist-op-limpiarGes" class="hist-op-btn-clear" type="button">Limpiar</button>
          <button id="hist-op-exportGes" class="hist-op-btn-export" type="button" title="Exportar PDF / XLS / CSV">
            <span class="material-icons">download</span> Exportar
          </button>
          <button id="hist-op-recargarGes" class="hist-op-btn-refresh" type="button" title="Actualizar gestión">
            <span class="material-icons">sync</span>
          </button>
          <span id="hist-op-contadorGes" class="hist-op-counter"></span>
        </div>
        <div id="hist-op-tablaGes" class="hist-op-table-wrap"></div>
      </div>` : ''}
    </div>
  `;
}

function _renderEstado() {
  const wrap = q("tablaEst");
  if (!wrap) return;

  if (_state.loadingEst) {
    wrap.innerHTML = `<div class="hist-op-loading"><span class="material-icons spin">sync</span> Cargando historial de cambios...</div>`;
    return;
  }

  const rows = _filteredEstado();
  const ctr = q("contadorEst");
  if (ctr) ctr.textContent = `${rows.length} de ${_state.estado.length} registros`;

  const totalPages = Math.max(1, Math.ceil(rows.length / _state.pageSizeEst) || 1);
  if (_state.pageEst > totalPages) _state.pageEst = totalPages;
  if (_state.pageEst < 1) _state.pageEst = 1;
  const start = (_state.pageEst - 1) * _state.pageSizeEst;
  const pageRows = rows.slice(start, start + _state.pageSizeEst);

  if (!rows.length) {
    wrap.innerHTML = `${_pagerHtml('Est', _state.pageEst, _state.pageSizeEst, 0)}
      <div class="hist-op-empty"><span class="material-icons">rule</span><div>No hay cambios de estado con esos filtros.</div></div>`;
    return;
  }

  wrap.innerHTML = `
    ${_pagerHtml('Est', _state.pageEst, _state.pageSizeEst, rows.length)}
    <div class="hist-op-table-scroll">
      <table class="hist-op-table hist-op-table--dense hist-op-table--estado">
        <thead><tr>
          <th>FECHA</th><th>TIPO</th><th>UNIDAD</th><th>CAMBIO</th><th>ESTADO</th><th>AUTOR</th>
        </tr></thead>
        <tbody>
          ${pageRows.map(r => {
            const tipo = _normalizeTipo(r.tipo);
            const unidad = r.unidad || r.mva || '—';
            return `
              <tr>
                <td class="hist-op-cell-date">${esc(r.fecha || "")}</td>
                <td><span class="hist-op-badge ${_tipoBadgeClass(tipo)}"><span class="material-icons">${_tipoIcon(tipo)}</span>${esc(_tipoLabel(tipo))}</span></td>
                <td class="hist-op-cell-mva">${esc(unidad)}</td>
                <td class="hist-op-cell-cambio">${_cambioCellHtml(r)}</td>
                <td class="hist-op-cell-estado">${_estadoCellHtml(r)}</td>
                <td>${esc(r.autor || "Sistema")}</td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function _renderGestion() {
  if (!_state.canGestion) return;
  const wrap = q('tablaGes');
  if (!wrap) return;

  if (_state.loadingGes) {
    wrap.innerHTML = `<div class="hist-op-loading"><span class="material-icons spin">sync</span> Cargando gestión...</div>`;
    return;
  }

  if (_state.errorGes) {
    wrap.innerHTML = `<div class="hist-op-empty"><span class="material-icons">error_outline</span><div>${esc(_state.errorGes)}</div></div>`;
    return;
  }

  const rows = _filteredGestion();
  const counter = q('contadorGes');
  if (counter) counter.textContent = `${rows.length} de ${_state.gestion.length} registros`;

  const totalPages = Math.max(1, Math.ceil(rows.length / _state.pageSizeGes) || 1);
  if (_state.pageGes > totalPages) _state.pageGes = totalPages;
  if (_state.pageGes < 1) _state.pageGes = 1;
  const start = (_state.pageGes - 1) * _state.pageSizeGes;
  const pageRows = rows.slice(start, start + _state.pageSizeGes);

  if (!rows.length) {
    wrap.innerHTML = `${_pagerHtml('Ges', _state.pageGes, _state.pageSizeGes, 0)}
      <div class="hist-op-empty"><span class="material-icons">admin_panel_settings</span><div>No hay eventos de gestión con esos filtros.</div></div>`;
    return;
  }

  wrap.innerHTML = `
    ${_pagerHtml('Ges', _state.pageGes, _state.pageSizeGes, rows.length)}
    <div class="hist-op-table-scroll">
      <table class="hist-op-table hist-op-table--dense hist-op-table--gestion">
        <thead><tr>
          <th>FECHA</th><th>TIPO</th><th>ACCIÓN</th><th>CONTEXTO</th><th>AUTOR</th><th>UBICACIÓN</th>
        </tr></thead>
        <tbody>
          ${pageRows.map(row => {
            const context = _gestionContext(row);
            const email = row.userEmail && row.userEmail !== row.autor ? row.userEmail : '';
            return `<tr>
              <td class="hist-op-cell-date">${esc(row.fecha || '')}</td>
              <td><span class="hist-op-badge ${_gestionBadgeClass(row.tipo)}"><span class="material-icons">admin_panel_settings</span>${esc(_gestionTypeLabel(row.tipo))}</span></td>
              <td class="hist-op-cell-action">${esc(row.accion || 'Evento de gestión')}</td>
              <td class="hist-op-cell-context">
                <strong>${esc(context.main)}</strong>
                ${context.meta.length ? `<span>${context.meta.map(esc).join(' · ')}</span>` : ''}
              </td>
              <td class="hist-op-cell-author"><strong>${esc(row.autor || 'Sistema')}</strong>${email ? `<span>${esc(email)}</span>` : ''}</td>
              <td>${_gestionLocationHtml(row)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function _exportMatrix(kind) {
  const isGes = kind === 'ges';
  const rows = isGes ? _filteredGestion() : _filteredEstado();
  if (!rows.length) return null;
  const headers = isGes
    ? ['Fecha', 'Tipo', 'Acción', 'Referencia', 'Detalles', 'Autor', 'Ubicación', 'Mapa']
    : [
      'Fecha', 'Tipo', 'Unidad', 'Cambio', 'Estado anterior', 'Estado nuevo',
      'Ubicación anterior', 'Ubicación nueva', 'Km', 'Motivo de salida', 'Notas nuevas', 'Autor'
    ];
  const body = rows.map((r) => {
    if (isGes) {
      const context = _gestionContext(r);
      return [
        r.fecha || '',
        _gestionTypeLabel(r.tipo),
        r.accion || '',
        context.main,
        context.meta.join(' · '),
        r.autor || 'Sistema',
        _gestionLocationLabel(r),
        _safeMapsUrl(r)
      ];
    }
    return [
      r.fecha || '',
      _tipoLabel(r.tipo),
      r.unidad || r.mva || '',
      r.cambio || '',
      r.estadoAnterior || '',
      r.estadoNuevo || '',
      r.ubicacionAnterior || '',
      r.ubicacionNueva || '',
      Number.isFinite(r.km) ? r.km : '',
      r.motivoSalida || '',
      r.notaNueva || '',
      r.autor || 'Sistema',
    ];
  });
  return {
    headers,
    body,
    title: isGes ? 'Historial de gestión' : 'Historial de cambios',
    count: rows.length,
  };
}

async function _exportKind(kind) {
  const data = _exportMatrix(kind);
  if (!data) {
    _toast('No hay registros para exportar.', 'error');
    return;
  }
  await openExportChooser({
    title: 'Exportar',
    subtitle: `${data.count} registros · ${data.title}`,
    onPdf: () => {
      exportMatrixPdf(data.headers, data.body, { title: data.title, subtitle: `${data.count} registros` });
      _toast(`Exportados ${data.count} registros (PDF).`, 'success');
    },
    onXls: () => {
      exportMatrixXls(data.headers, data.body, { title: data.title, filename: buildExportFilename('xls') });
      _toast(`Exportados ${data.count} registros (XLS).`, 'success');
    },
    onCsv: () => {
      exportMatrixCsv(data.headers, data.body, { filename: buildExportFilename('csv') });
      _toast(`Exportados ${data.count} registros (CSV).`, 'success');
    },
  });
}

// ── Carga de datos ───────────────────────────────────────────
async function _loadEstado() {
  if (_state.loadingEst) return;
  _state.loadingEst = true;
  _renderEstado();
  try {
    const serverLogs = await (window.api.obtenerLogsServer?.() || Promise.resolve([]));
    _state.estado = (Array.isArray(serverLogs) ? serverLogs : [])
      .map(_normalizeEstadoRow)
      .filter(_estadoPermitido)
      .sort((a, b) => _toMs(b.timestamp) - _toMs(a.timestamp));
  } catch (e) {
    console.error("[historial-op] estado", e);
    _state.estado = [];
  } finally {
    _state.loadingEst = false;
    _renderEstado();
  }
}

async function _loadGestion() {
  if (!_state?.canGestion || _state.loadingGes) return;
  _state.loadingGes = true;
  _state.errorGes = '';
  _renderGestion();
  try {
    if (typeof window.api?.obtenerEventosGestion !== 'function') {
      throw new Error('API de gestion no disponible');
    }
    const logs = await window.api.obtenerEventosGestion();
    _state.gestion = (Array.isArray(logs) ? logs : [])
      .map(_normalizeGestionRow)
      .sort((a, b) => _toMs(b.timestamp) - _toMs(a.timestamp));
  } catch (error) {
    console.error('[historial-op] gestion', error);
    _state.gestion = [];
    _state.errorGes = 'No se pudo cargar el historial de gestión.';
  } finally {
    _state.loadingGes = false;
    _syncGestionTypeOptions();
    _renderGestion();
  }
}

// ── Eventos ──────────────────────────────────────────────────
function _bindEvents() {
  _abortCtrl?.abort();
  _abortCtrl = new AbortController();
  const sig = { signal: _abortCtrl.signal };
  _container.addEventListener('click', e => {
    if (!_state) return;
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      if (tabBtn.dataset.tab === 'gestion' && !_state.canGestion) return;
      _state.tab = tabBtn.dataset.tab;
      _container.querySelectorAll('.hist-op-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _state.tab));
      q('panel-cambios')?.classList.toggle('hidden', _state.tab !== 'cambios');
      q('panel-gestion')?.classList.toggle('hidden', _state.tab !== 'gestion');
      if (_state.tab === 'cambios' && !_state.estado.length && !_state.loadingEst) _loadEstado();
      if (_state.tab === 'gestion' && !_state.gestion.length && !_state.loadingGes) _loadGestion();
      return;
    }

    if (e.target.closest('#hist-op-limpiarGes')) {
      _state.qGes = ''; _state.tipoGes = 'TODOS'; _state.pageGes = 1;
      const qi = q('qGes'); if (qi) qi.value = '';
      const ti = q('tipoGes'); if (ti) ti.value = 'TODOS';
      _renderGestion();
      return;
    }
    if (e.target.closest('#hist-op-exportEst')) { void _exportKind('est'); return; }
    if (e.target.closest('#hist-op-exportGes')) { void _exportKind('ges'); return; }
    if (e.target.closest('#hist-op-recargarEst')) { _state.estado = []; _state.pageEst = 1; _loadEstado(); return; }
    if (e.target.closest('#hist-op-recargarGes')) { _state.gestion = []; _state.pageGes = 1; _loadGestion(); return; }

    const pageBtn = e.target.closest('[data-page-action]');
    if (pageBtn) {
      const act = pageBtn.dataset.pageAction;
      if (act === 'prev-Est') { _state.pageEst = Math.max(1, _state.pageEst - 1); _renderEstado(); return; }
      if (act === 'next-Est') { _state.pageEst += 1; _renderEstado(); return; }
      if (act === 'prev-Ges') { _state.pageGes = Math.max(1, _state.pageGes - 1); _renderGestion(); return; }
      if (act === 'next-Ges') { _state.pageGes += 1; _renderGestion(); return; }
    }
  }, sig);

  _container.addEventListener('input', e => {
    if (!_state) return;
    if (e.target.id === 'hist-op-qEst') { _state.qEst = e.target.value; _state.pageEst = 1; _renderEstado(); return; }
    if (e.target.id === 'hist-op-qGes') { _state.qGes = e.target.value; _state.pageGes = 1; _renderGestion(); return; }
  }, sig);

  _container.addEventListener('change', e => {
    if (!_state) return;
    if (e.target.id === 'hist-op-tipoEst') { _state.tipoEst = e.target.value; _state.pageEst = 1; _renderEstado(); return; }
    if (e.target.id === 'hist-op-tipoGes') { _state.tipoGes = e.target.value; _state.pageGes = 1; _renderGestion(); return; }
    if (e.target.id === 'hist-op-pageSizeEst') {
      _state.pageSizeEst = Number(e.target.value) || 50;
      _state.pageEst = 1;
      _renderEstado();
      return;
    }
    if (e.target.id === 'hist-op-pageSizeGes') {
      _state.pageSizeGes = Number(e.target.value) || 50;
      _state.pageGes = 1;
      _renderGestion();
      return;
    }
  }, sig);
}

// ── API pública del módulo ───────────────────────────────────
export function mount(ctx) {
  _ensureCss();
  _container = ctx?.container || document.getElementById('mexShellMain');
  if (!_container) return;
  _state = _makeState(_resolveAccess(ctx));
  _renderShell();
  _bindEvents();
  _loadEstado();
  if (_state.canGestion) _loadGestion();
}

export function unmount() {
  _abortCtrl?.abort();
  _abortCtrl = null;
  if (_container) _container.innerHTML = '';
  _container = null;
  _state     = null;
}
