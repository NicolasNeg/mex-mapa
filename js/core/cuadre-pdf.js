// ============================================================================
// /js/core/cuadre-pdf.js
// Generacion del PDF "Reporte de Auditoria Cruzada" (cierre de cuadre) +
// mecanismo de impresion. Compartido entre el legacy (js/views/mapa.js) y
// las vistas SPA (js/app/views/cuadre-flota.js) para no duplicar el template.
// ============================================================================

import { escapeHtml, formatearFechaDocumento } from '/mapa/features/core/utils.js';
import { normalizarEstadoPatio } from '/domain/estado.model.js';
import { exportFooterHtml, buildExportFilename, getExportIdentity } from '/js/core/export-signing.js';
import { generarYAbrirPdf } from '/js/core/pdf-export.js';

// Estados/ubicaciones que cuentan como "fuera, pero justificada" (no es que
// se haya perdido la unidad — el sistema ya sabe que está en taller,
// resguardo, venta o traslado). Todo lo demás en FALTANTE es "ubicación
// desconocida" de verdad.
const UBICACION_JUSTIFICADA = new Set(['TALLER', 'RESGUARDO', 'VENTA', 'TRASLADO']);

function _esUbicacionJustificada(u = {}) {
  const ubicacion = String(u.ubicacion || u.pos || '').toUpperCase();
  const estado = String(u.estado || '').toUpperCase();
  return UBICACION_JUSTIFICADA.has(ubicacion) || UBICACION_JUSTIFICADA.has(estado);
}

function _cuadreResumenAuditoria(list = []) {
  const arr = Array.isArray(list) ? list : [];
  const faltantesList = arr.filter(u => u.status === 'FALTANTE');
  const fueraJustificado = faltantesList.filter(_esUbicacionJustificada).length;
  return {
    total: arr.length,
    pendientes: arr.filter(u => u.status === 'PENDIENTE').length,
    revisadas: arr.filter(u => u.status !== 'PENDIENTE').length,
    ok: arr.filter(u => u.status === 'OK').length,
    faltantes: faltantesList.length,
    ubicacionDesconocida: faltantesList.length - fueraJustificado,
    fueraJustificado,
    extras: arr.filter(u => u.status === 'EXTRA').length
  };
}

function _cuadreEmpresaPdfData(fallbackPlaza = '') {
  const empresa = window.MEX_CONFIG?.empresa || {};
  const plaza = String(fallbackPlaza || '').toUpperCase().trim();
  const plazasDetalle = Array.isArray(empresa.plazasDetalle) ? empresa.plazasDetalle : [];
  const plazaDetalle = plazasDetalle.find(p => String(p.id || p.nombre || '').trim().toUpperCase() === plaza) || {};
  const nombre = String(empresa.nombre || empresa.razonSocial || empresa.empresa || 'EMPRESA').trim();
  const logo = String(empresa.logoURL || empresa.logoUrl || empresa.logo || empresa.logoEmpresa || '').trim();
  const rfc = String(empresa.rfc || empresa.RFC || empresa.rfcEmpresa || '').trim();
  const direccion = String(
    plazaDetalle.direccion
    || plazaDetalle.direccionFiscal
    || empresa.direccionFiscal
    || empresa.direccion
    || empresa.domicilio
    || ''
  ).trim();
  const correo = String(plazaDetalle.correo || empresa.correoEmpresa || empresa.correoFacturacion || empresa.email || '').trim();
  const telefono = String(plazaDetalle.telefono || empresa.telefono || empresa.telefonoEmpresa || '').trim();
  return { nombre, logo, rfc, direccion, correo, telefono, plaza };
}

function _cuadrePdfCell(value) {
  const text = value == null || value === '' ? 'N/D' : String(value);
  return escapeHtml(text);
}

// Colores por estado de patio (mismos tokens que .fl-dot-* en css/mapa.css).
const CUADRE_PDF_ESTADO_COLOR = {
  LISTO: '#16a34a',
  SUCIO: '#b45309',
  MANTENIMIENTO: '#dc2626',
  TRASLADO: '#7c3aed',
  RESGUARDO: '#475569',
  VENTA: '#475569',
  RETENIDA: '#475569',
  'NO ARRENDABLE': '#475569',
  FALTANTE: '#dc2626',
  SOBRANTE: '#b45309'
};

function _cuadrePdfEstadoColor(estado) {
  return CUADRE_PDF_ESTADO_COLOR[String(estado || '').toUpperCase()] || '#334155';
}

// Formato "simple": texto en negritas de color para el estado, pill con
// solo borde (sin relleno) para la ubicación. Nada de badges sólidos.
function _cuadrePdfEstadoTexto(label, colorHex) {
  const text = String(label || '').trim();
  if (!text) return '';
  return `<span class="cuadre-pdf-estado" style="color:${colorHex}">${escapeHtml(text)}</span>`;
}

function _cuadrePdfUbicacionPill(label, colorHex) {
  const text = String(label || '').trim();
  if (!text) return '';
  return `<span class="cuadre-pdf-ubi" style="border-color:${colorHex}80;color:${colorHex}">${escapeHtml(text)}</span>`;
}

function _cuadrePdfFirmaHtml(title, name, dataUrl) {
  const safeTitle = escapeHtml(title);
  const safeName = escapeHtml(name || 'Pendiente');
  const img = dataUrl
    ? `<img src="${escapeHtml(dataUrl)}" alt="${safeTitle}" class="cuadre-pdf-sign-img">`
    : '<span class="cuadre-pdf-sign-missing">Sin firma capturada</span>';
  return `
    <div class="cuadre-pdf-sign-box">
      <div class="cuadre-pdf-sign-area">${img}</div>
      <div class="cuadre-pdf-sign-line"></div>
      <strong>${safeName}</strong>
      <span>${safeTitle}</span>
    </div>
  `;
}

/**
 * @param {Array} auditList unidades del cuadre
 * @param {Object|null} statsInput stats ya calculados (opcional, se completan con _cuadreResumenAuditoria)
 * @param {Object} metaInput meta del cierre (plaza, auxiliar, firmas, etc.)
 * @param {Object} fallback { plaza, actorName } — solo se usan si meta no trae esos datos.
 */
export function generarHtmlAuditoriaCuadrePdf(auditList = [], statsInput = null, metaInput = {}, fallback = {}) {
  const units = Array.isArray(auditList) ? auditList : [];
  const stats = {
    ..._cuadreResumenAuditoria(units),
    ...(statsInput || {})
  };
  // Si el caller ya trae stats propios (legacy), recalculamos igual el split
  // justificado/desconocida a partir de la lista real — no hay forma de
  // inferirlo de un conteo plano de "faltantes".
  if (statsInput && (statsInput.ubicacionDesconocida == null || statsInput.fueraJustificado == null)) {
    const derivado = _cuadreResumenAuditoria(units);
    stats.ubicacionDesconocida = derivado.ubicacionDesconocida;
    stats.fueraJustificado = derivado.fueraJustificado;
  }
  stats.sobrantes = stats.sobrantes ?? stats.extras ?? 0;
  const meta = metaInput || {};
  const fallbackPlaza = String(fallback.plaza || '').toUpperCase().trim();
  const empresa = _cuadreEmpresaPdfData(meta.plaza || fallbackPlaza);
  const fecha = meta.cerradoEn || meta.enviadoEn || formatearFechaDocumento(new Date());
  const auxiliar = meta.auxiliarNombre || meta.destinatarioNombre || stats.auxiliar || '';
  const ventas = meta.firmaVentas || meta.firmaNombre || meta.cerradoPor || fallback.actorName || '';
  const plaza = meta.plaza || empresa.plaza || fallbackPlaza || '';
  const exportador = getExportIdentity();

  const rows = units.map(u => {
    const status = String(u.status || '').toUpperCase();
    const gas = u.gasolinaCorregida || u.gasolina || u.gas || 'N/A';
    const km = u.km != null && u.km !== '' ? String(u.km) : '—';
    const notas = String(u.notas || '').trim();

    let estadoHtml;
    let ubicacionHtml;
    let rowClass = status || 'PENDIENTE';
    if (status === 'FALTANTE') {
      const justificado = _esUbicacionJustificada(u);
      if (justificado) {
        // La unidad no está "perdida": el sistema ya sabe que está fuera
        // (taller, resguardo, venta, traslado) — se muestra su ubicación
        // real, no un "no localizada" que no es cierto.
        const estadoReal = normalizarEstadoPatio(u.estado) || String(u.estado || '').toUpperCase() || 'FUERA';
        const ubicacionReal = String(u.ubicacion || u.pos || estadoReal).toUpperCase();
        estadoHtml = _cuadrePdfEstadoTexto(estadoReal, _cuadrePdfEstadoColor(estadoReal));
        ubicacionHtml = _cuadrePdfUbicacionPill(ubicacionReal, '#2563eb');
        rowClass = 'JUSTIFICADO';
      } else {
        estadoHtml = _cuadrePdfEstadoTexto('FALTANTE', _cuadrePdfEstadoColor('FALTANTE'));
        ubicacionHtml = _cuadrePdfUbicacionPill('DESCONOCIDA', _cuadrePdfEstadoColor('FALTANTE'));
      }
    } else if (status === 'EXTRA') {
      estadoHtml = _cuadrePdfEstadoTexto('SOBRANTE', _cuadrePdfEstadoColor('SOBRANTE'));
      ubicacionHtml = _cuadrePdfUbicacionPill(u.ubicacion || u.pos || 'SOBRANTE', _cuadrePdfEstadoColor('SOBRANTE'));
    } else {
      const estadoPatio = normalizarEstadoPatio(u.estado) || String(u.estado || '').toUpperCase() || 'DESCONOCIDO';
      estadoHtml = _cuadrePdfEstadoTexto(estadoPatio, _cuadrePdfEstadoColor(estadoPatio));
      ubicacionHtml = _cuadrePdfUbicacionPill(u.ubicacion || u.pos || 'PATIO', '#475569');
    }

    return `
      <tr class="status-${escapeHtml(rowClass)}">
        <td>${_cuadrePdfCell(u.mva)}</td>
        <td>${_cuadrePdfCell(u.modelo)}</td>
        <td>${_cuadrePdfCell(u.placas)}</td>
        <td>${_cuadrePdfCell(gas)}</td>
        <td>${_cuadrePdfCell(km)}</td>
        <td>${estadoHtml}</td>
        <td>${ubicacionHtml}</td>
        <td class="cuadre-pdf-note-cell">${notas ? `<em>${escapeHtml(notas)}</em>` : '<span class="cuadre-pdf-note-empty">Sin observaciones</span>'}</td>
      </tr>
    `;
  }).join('');

  return `
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      #reporte-pdf-container {
        background: #ffffff !important;
      }
      .cuadre-pdf {
        min-height: 100vh;
        background: #ffffff;
        color: #111827;
        font-family: Inter, Arial, sans-serif;
        padding: 0;
      }
      .cuadre-pdf-page {
        page-break-after: always;
      }
      .cuadre-pdf-page:last-child {
        page-break-after: auto;
      }
      .cuadre-pdf-page:first-child {
        border-top: 4px solid #3b82f6;
        padding-top: 10px;
      }
      .cuadre-pdf-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 18px;
        border-bottom: 2px solid #111827;
        padding-bottom: 10px;
        margin-bottom: 12px;
      }
      .cuadre-pdf-brand {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .cuadre-pdf-brand-eyebrow {
        font-size: 7.5px;
        font-weight: 800;
        letter-spacing: .1em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .cuadre-pdf-brand-mark {
        font-size: 17px;
        font-weight: 900;
        letter-spacing: -0.01em;
        color: #111827;
      }
      .cuadre-pdf-brand-mark span {
        color: #3b82f6;
      }
      .cuadre-pdf-company h1 {
        margin: 0 0 4px;
        font-size: 15px;
        line-height: 1.1;
        font-weight: 800;
      }
      .cuadre-pdf-company p,
      .cuadre-pdf-meta p {
        margin: 1px 0;
        color: #4b5563;
        font-size: 9px;
        line-height: 1.35;
      }
      .cuadre-pdf-meta {
        min-width: 230px;
        text-align: right;
      }
      .cuadre-pdf-title {
        margin: 12px 0 10px;
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 12px;
      }
      .cuadre-pdf-title h2 {
        margin: 0;
        font-size: 22px;
        font-weight: 900;
        letter-spacing: 0;
      }
      .cuadre-pdf-title span {
        color: #4b5563;
        font-size: 10px;
        font-weight: 800;
      }
      .cuadre-pdf-kpis {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 8px;
        margin: 10px 0 12px;
      }
      .cuadre-pdf-kpi {
        border: 1px solid #d1d5db;
        border-radius: 4px;
        padding: 9px 10px;
        background: #ffffff;
      }
      .cuadre-pdf-kpi small {
        display: block;
        color: #64748b;
        font-size: 7.5px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .04em;
        margin-bottom: 4px;
      }
      .cuadre-pdf-kpi strong {
        display: block;
        color: #111827;
        font-size: 19px;
        line-height: 1;
        font-weight: 800;
      }
      .cuadre-pdf-kpi.is-alert strong {
        color: #dc2626;
      }
      .cuadre-pdf-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 8.5px;
      }
      .cuadre-pdf-table th,
      .cuadre-pdf-table td {
        border: 1px solid #e2e8f0;
        padding: 5px 6px;
        text-align: left;
        vertical-align: top;
      }
      .cuadre-pdf-table th {
        background: #111827;
        color: #ffffff;
        font-size: 8px;
        text-transform: uppercase;
        border-color: #111827;
      }
      .cuadre-pdf-table tr.status-FALTANTE td {
        background: #fef2f2;
      }
      .cuadre-pdf-table tr.status-EXTRA td {
        background: #fffbeb;
      }
      .cuadre-pdf-table tr.status-JUSTIFICADO td {
        background: #eff6ff;
      }
      .cuadre-pdf-estado {
        font-weight: 800;
        font-size: 8.5px;
        text-transform: uppercase;
        letter-spacing: .02em;
        white-space: nowrap;
      }
      .cuadre-pdf-ubi {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 9999px;
        border: 1px solid;
        background: #fff;
        font-size: 7.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .02em;
        white-space: nowrap;
      }
      .cuadre-pdf-note-cell em {
        font-style: italic;
        color: #374151;
      }
      .cuadre-pdf-note-empty {
        color: #9ca3af;
      }
      .cuadre-pdf-sign-page {
        min-height: 510px;
        display: flex;
        flex-direction: column;
      }
      .cuadre-pdf-sign-title {
        margin: 0 0 4px;
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: .06em;
        color: #111827;
        border-bottom: 2px solid #111827;
        padding-bottom: 8px;
      }
      .cuadre-pdf-sign-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 28px;
        margin-top: 34px;
      }
      .cuadre-pdf-sign-box {
        min-height: 150px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: center;
        text-align: center;
      }
      .cuadre-pdf-sign-area {
        width: 100%;
        height: 76px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .cuadre-pdf-sign-img {
        max-width: 260px;
        max-height: 74px;
        object-fit: contain;
      }
      .cuadre-pdf-sign-missing {
        font-size: 9px;
        color: #9ca3af;
        font-style: italic;
      }
      .cuadre-pdf-sign-line {
        width: 78%;
        border-top: 1.5px solid #111827;
        margin: 8px auto 8px;
      }
      .cuadre-pdf-sign-box strong {
        color: #111827;
        font-size: 12px;
        font-weight: 900;
      }
      .cuadre-pdf-sign-box span {
        color: #6b7280;
        font-size: 9px;
        font-weight: 800;
        text-transform: uppercase;
        margin-top: 3px;
      }
      .cuadre-pdf-client-bar {
        margin-top: auto;
        padding-top: 28px;
      }
      .cuadre-pdf-client-inner {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        background: #111827;
        color: #ffffff;
        border-radius: 6px;
        padding: 12px 16px;
      }
      .cuadre-pdf-client-inner .label {
        font-size: 7.5px;
        font-weight: 800;
        letter-spacing: .1em;
        text-transform: uppercase;
        color: #94a3b8;
        margin: 0 0 3px;
      }
      .cuadre-pdf-client-inner h3 {
        margin: 0;
        font-size: 13px;
        font-weight: 800;
      }
      .cuadre-pdf-client-inner .meta {
        text-align: right;
        font-size: 8.5px;
        color: #cbd5e1;
        line-height: 1.5;
      }
      .cuadre-pdf-exported {
        margin-top: 10px;
        text-align: right;
        font-size: 8px;
        color: #94a3b8;
      }
      @media print {
        #reporte-pdf-container { display: block !important; }
      }
    </style>
    <div class="cuadre-pdf">
      <section class="cuadre-pdf-page">
        <header class="cuadre-pdf-header">
          <div class="cuadre-pdf-brand">
            <span class="cuadre-pdf-brand-eyebrow">Generado por</span>
            <span class="cuadre-pdf-brand-mark">Map<span>Gestion</span></span>
          </div>
          <div class="cuadre-pdf-meta">
            <p><strong>Fecha de corte:</strong> ${escapeHtml(fecha)}</p>
            <p><strong>Plaza:</strong> ${escapeHtml(plaza || 'N/D')}</p>
            <p><strong>Auxiliar en patio:</strong> ${escapeHtml(auxiliar || 'N/D')}</p>
            <p><strong>Autorizado por:</strong> ${escapeHtml(ventas || 'N/D')}</p>
            ${meta.missionId ? `<p><strong>Misión:</strong> ${escapeHtml(meta.missionId)}</p>` : ''}
          </div>
        </header>

        <div class="cuadre-pdf-title">
          <h2>Reporte de Auditoría Cruzada</h2>
          <span>Cuadre de flota operativo</span>
        </div>

        <div class="cuadre-pdf-kpis">
          <div class="cuadre-pdf-kpi"><small>Total revisadas</small><strong>${escapeHtml(String(stats.total || units.length || 0))}</strong></div>
          <div class="cuadre-pdf-kpi"><small>Cuadre perfecto</small><strong>${escapeHtml(String(stats.ok || 0))}</strong></div>
          <div class="cuadre-pdf-kpi${stats.ubicacionDesconocida > 0 ? ' is-alert' : ''}"><small>Ubicación desconocida</small><strong>${escapeHtml(String(stats.ubicacionDesconocida || 0))}</strong></div>
          <div class="cuadre-pdf-kpi${stats.sobrantes > 0 ? ' is-alert' : ''}"><small>Sobrantes físicos</small><strong>${escapeHtml(String(stats.sobrantes || 0))}</strong></div>
          <div class="cuadre-pdf-kpi"><small>Fuera (justif.)</small><strong>${escapeHtml(String(stats.fueraJustificado || 0))}</strong></div>
        </div>

        <table class="cuadre-pdf-table">
          <thead>
            <tr>
              <th>MVA</th>
              <th>Modelo</th>
              <th>Placas</th>
              <th>Gas</th>
              <th>KM</th>
              <th>Estado</th>
              <th>Ubicación</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8">Sin unidades revisadas.</td></tr>'}</tbody>
        </table>
      </section>

      <section class="cuadre-pdf-page cuadre-pdf-sign-page">
        <h2 class="cuadre-pdf-sign-title">Firmas de conformidad</h2>
        <div class="cuadre-pdf-sign-grid">
          ${_cuadrePdfFirmaHtml('Auxiliar en patio', meta.firmaAuxiliar || meta.firmaAuxiliarNombre || auxiliar, meta.firmaAuxiliarUrl || meta.auxiliarFirmaUrl || '')}
          ${_cuadrePdfFirmaHtml('Agente de ventas', ventas, meta.firmaDataUrl || meta.ventasFirmaUrl || '')}
        </div>
        <div class="cuadre-pdf-client-bar">
          <div class="cuadre-pdf-client-inner">
            <div>
              <p class="label">Cliente / Operador</p>
              <h3>${escapeHtml(empresa.nombre || 'Empresa')}</h3>
            </div>
            <div class="meta">
              ${empresa.rfc ? `<div>RFC: ${escapeHtml(empresa.rfc)}</div>` : ''}
              ${empresa.correo ? `<div>${escapeHtml(empresa.correo)}</div>` : ''}
              ${empresa.direccion ? `<div>${escapeHtml(empresa.direccion)}</div>` : ''}
            </div>
          </div>
          <div class="cuadre-pdf-exported">${exportFooterHtml({ escapeHtml, date: new Date() })}</div>
        </div>
      </section>
    </div>
  `;
}

/**
 * Genera el PDF server-side (Cloud Function generarYSubirPdf) y lo abre
 * en pestaña nueva. Ya no depende de window.print() ni de que el usuario
 * complete el diálogo de impresión nativo — dejaba la pantalla en blanco
 * cuando el popup se bloqueaba o el render llegaba tarde.
 * @param {string} htmlContenido fragmento HTML del reporte (sin doctype/head/body)
 * @param {{ kind?: 'cuadre'|'papeleta', docId?: string, onError?: (e: Error) => void, onStatus?: (s: string) => void }} opts
 */
export async function abrirReporteImpresion(htmlContenido, { kind = '', docId = '', onError, onStatus } = {}) {
  const signedTitle = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  const docHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${String(signedTitle).replace(/</g, '')}</title>
  <style>
    html, body { margin: 0; padding: 0; background: #fff; color: #111; }
    body { font-family: Inter, Arial, sans-serif; }
  </style>
</head>
<body>
  <div id="reporte-pdf-container">${htmlContenido}</div>
</body>
</html>`;

  try {
    // generarYAbrirPdf ya dispara la descarga del archivo — no se abre pestaña.
    return await generarYAbrirPdf(docHtml, { kind, docId, onStatus });
  } catch (error) {
    console.error('No se pudo generar el PDF:', error);
    if (typeof onError === 'function') onError(error);
    return null;
  }
}
