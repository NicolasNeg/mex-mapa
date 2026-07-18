// ═══════════════════════════════════════════════════════════
//  export-signing.js — Regla de oro de exportación (agente.md)
//
//  Nombre: NOMBRE_USUARIO_FECHA_NOMBREEMPRESA.ext
//  PDF/Excel: firma empresa + exportador dentro del archivo
//  CSV: firma solo en el nombre de archivo
// ═══════════════════════════════════════════════════════════

function _upperToken(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function _todayParts(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return {
    ymd: `${y}-${m}-${d}`,
    ymdFile: `${y}_${m}_${d}`,
    label: date.toLocaleDateString('es-MX', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }),
  };
}

/** Identidad del exportador + empresa (globals de sesión). */
export function getExportIdentity(date = new Date()) {
  const profile = window.__mexCurrentUserRecord
    || window.__mexCurrentUser
    || window.CURRENT_USER_PROFILE
    || {};
  const authName = window._auth?.currentUser?.displayName || '';
  const userRaw = profile.nombreCompleto
    || profile.nombre
    || profile.displayName
    || window.USER_NAME
    || authName
    || window._auth?.currentUser?.email
    || 'USUARIO';

  const emp = window._empresaActual || window.MEX_CONFIG?.empresa || {};
  const companyRaw = emp.nombre
    || emp.nombreComercial
    || emp.razonSocial
    || emp.nombreEmpresa
    || 'EMPRESA';

  const dates = _todayParts(date);
  return {
    userName: String(userRaw).trim() || 'USUARIO',
    userToken: _upperToken(userRaw) || 'USUARIO',
    companyName: String(companyRaw).trim() || 'EMPRESA',
    companyToken: _upperToken(companyRaw) || 'EMPRESA',
    dateYmd: dates.ymd,
    dateFile: dates.ymdFile,
    dateLabel: dates.label,
  };
}

/**
 * Nombre de descarga firmado.
 * @param {string} ext  sin punto o con punto (.pdf / pdf)
 */
export function buildExportFilename(ext, date = new Date()) {
  const id = getExportIdentity(date);
  const e = String(ext || 'bin').replace(/^\./, '').toLowerCase() || 'bin';
  return `${id.userToken}_${id.dateFile}_${id.companyToken}.${e}`;
}

/** Pie HTML para PDF / impresión: “Exportado por …”. */
export function exportFooterHtml(opts = {}) {
  const id = getExportIdentity(opts.date);
  const esc = opts.escapeHtml || ((s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  return `<footer class="rpt-firma" style="margin-top:18px;padding-top:10px;border-top:1px solid #cbd5e1;font-size:10px;color:#64748b;line-height:1.4">
    <div><strong>${esc(id.companyName)}</strong></div>
    <div>Exportado por ${esc(id.userName)} · ${esc(id.dateLabel)}</div>
  </footer>`;
}

/** CSS mínimo del pie (opcional, si el documento no lo trae). */
export const EXPORT_FOOTER_CSS = `.rpt-firma{margin-top:18px;padding-top:10px;border-top:1px solid #cbd5e1;font-size:10px;color:#64748b;line-height:1.4}`;

/**
 * Filas meta para Excel (AOA): empresa + exportador.
 * Insertar al inicio de la hoja (o como filas 0–1).
 */
export function exportExcelMetaRows() {
  const id = getExportIdentity();
  return [
    ['Empresa', id.companyName],
    ['Exportado por', id.userName],
    ['Fecha', id.dateLabel],
    [],
  ];
}

/**
 * Bloque HTML meta para hojas .xls generadas como HTML.
 */
export function exportExcelMetaHtml(escapeHtml) {
  const id = getExportIdentity();
  const esc = escapeHtml || ((s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  return `<p><b>Empresa:</b> ${esc(id.companyName)}</p>
<p><b>Exportado por:</b> ${esc(id.userName)} · ${esc(id.dateLabel)}</p>`;
}

/** Expone helpers en window para páginas legacy sin bundler (script type=module). */
export function installExportSigningGlobals(target = typeof window !== 'undefined' ? window : null) {
  if (!target) return;
  target.__mexExportSigning = {
    getExportIdentity,
    buildExportFilename,
    exportFooterHtml,
    exportExcelMetaRows,
    exportExcelMetaHtml,
    EXPORT_FOOTER_CSS,
  };
  target.buildExportFilename = buildExportFilename;
}

if (typeof window !== 'undefined') {
  installExportSigningGlobals(window);
}
