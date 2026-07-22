// ============================================================================
// /js/core/cuadre-pdf.js
// Generacion del PDF "Reporte de Auditoria Cruzada" (cierre de cuadre) +
// mecanismo de impresion. Compartido entre el legacy (js/views/mapa.js) y
// las vistas SPA (js/app/views/cuadre-flota.js) para no duplicar el template.
// ============================================================================

import { escapeHtml, formatearFechaDocumento } from '/mapa/features/core/utils.js';
import { normalizarEstadoPatio } from '/domain/estado.model.js';
import { exportFooterHtml, buildExportFilename } from '/js/core/export-signing.js';

function _cuadreResumenAuditoria(list = []) {
  const arr = Array.isArray(list) ? list : [];
  return {
    total: arr.length,
    pendientes: arr.filter(u => u.status === 'PENDIENTE').length,
    revisadas: arr.filter(u => u.status !== 'PENDIENTE').length,
    ok: arr.filter(u => u.status === 'OK').length,
    faltantes: arr.filter(u => u.status === 'FALTANTE').length,
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
  LISTO: '#22c55e',
  SUCIO: '#f59e0b',
  MANTENIMIENTO: '#ef4444',
  TRASLADO: '#8b5cf6',
  RESGUARDO: '#94a3b8',
  VENTA: '#94a3b8',
  RETENIDA: '#94a3b8',
  'NO ARRENDABLE': '#94a3b8'
};

function _cuadrePdfEstadoColor(estado) {
  return CUADRE_PDF_ESTADO_COLOR[String(estado || '').toUpperCase()] || '#ef4444';
}

function _cuadrePdfPill(label, colorHex) {
  const text = String(label || '').trim();
  if (!text) return '';
  return `<span class="cuadre-pdf-pill" style="background:${colorHex}1a;color:${colorHex}">${escapeHtml(text)}</span>`;
}

function _cuadrePdfFirmaHtml(title, name, dataUrl) {
  const safeTitle = escapeHtml(title);
  const safeName = escapeHtml(name || 'Pendiente');
  const img = dataUrl
    ? `<img src="${escapeHtml(dataUrl)}" alt="${safeTitle}" class="cuadre-pdf-sign-img">`
    : '';
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
  stats.sobrantes = stats.sobrantes ?? stats.extras ?? 0;
  const meta = metaInput || {};
  const fallbackPlaza = String(fallback.plaza || '').toUpperCase().trim();
  const empresa = _cuadreEmpresaPdfData(meta.plaza || fallbackPlaza);
  const fecha = meta.cerradoEn || meta.enviadoEn || formatearFechaDocumento(new Date());
  const auxiliar = meta.auxiliarNombre || meta.destinatarioNombre || stats.auxiliar || '';
  const ventas = meta.firmaVentas || meta.firmaNombre || meta.cerradoPor || fallback.actorName || '';
  const plaza = meta.plaza || empresa.plaza || fallbackPlaza || '';
  const rows = units.map(u => {
    const status = String(u.status || '').toUpperCase();
    const gas = u.gasolinaCorregida || u.gasolina || u.gas || 'N/A';
    const km = u.km != null && u.km !== '' ? String(u.km) : '—';
    const notas = String(u.notas || '').trim();

    let estadoHtml;
    let ubicacionHtml;
    if (status === 'FALTANTE') {
      estadoHtml = _cuadrePdfPill('FALTANTE', '#ef4444');
      ubicacionHtml = _cuadrePdfPill('NO LOCALIZADA', '#94a3b8');
    } else if (status === 'EXTRA') {
      estadoHtml = _cuadrePdfPill('SOBRANTE', '#f59e0b');
      ubicacionHtml = _cuadrePdfPill(u.ubicacion || u.pos || 'SOBRANTE', '#94a3b8');
    } else {
      const estadoPatio = normalizarEstadoPatio(u.estado) || String(u.estado || '').toUpperCase() || 'DESCONOCIDO';
      estadoHtml = _cuadrePdfPill(estadoPatio, _cuadrePdfEstadoColor(estadoPatio));
      ubicacionHtml = _cuadrePdfPill(u.ubicacion || u.pos || 'PATIO', '#94a3b8');
    }

    return `
      <tr class="status-${escapeHtml(status || 'PENDIENTE')}">
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
        gap: 12px;
        align-items: center;
      }
      .cuadre-pdf-logo {
        width: 54px;
        height: 54px;
        object-fit: contain;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        padding: 5px;
      }
      .cuadre-pdf-company h1 {
        margin: 0 0 4px;
        font-size: 18px;
        line-height: 1.1;
        font-weight: 900;
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
        font-size: 24px;
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
        padding: 8px 10px;
        background: #f9fafb;
      }
      .cuadre-pdf-kpi small {
        display: block;
        color: #6b7280;
        font-size: 8px;
        font-weight: 900;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .cuadre-pdf-kpi strong {
        display: block;
        color: #111827;
        font-size: 21px;
        line-height: 1;
        font-weight: 900;
      }
      .cuadre-pdf-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 8.5px;
      }
      .cuadre-pdf-table th,
      .cuadre-pdf-table td {
        border: 1px solid #d1d5db;
        padding: 5px 6px;
        text-align: left;
        vertical-align: top;
      }
      .cuadre-pdf-table th {
        background: #111827;
        color: #ffffff;
        font-size: 8px;
        text-transform: uppercase;
      }
      .cuadre-pdf-table tr.status-FALTANTE td {
        background: #fff1f2;
      }
      .cuadre-pdf-table tr.status-EXTRA td {
        background: #fffbeb;
      }
      .cuadre-pdf-pill {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 9999px;
        font-size: 7.5px;
        font-weight: 900;
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
      .cuadre-pdf-final-mark {
        margin-top: auto;
        padding-top: 28px;
        text-align: right;
        color: #111827;
        font-size: 10px;
        font-weight: 900;
        letter-spacing: .08em;
      }
      .cuadre-pdf-final-mark::before {
        content: "";
        display: inline-block;
        width: 190px;
        border-top: 1px solid #111827;
        margin: 0 0 8px auto;
      }
      @media print {
        #reporte-pdf-container { display: block !important; }
      }
    </style>
    <div class="cuadre-pdf">
      <section class="cuadre-pdf-page">
        <header class="cuadre-pdf-header">
          <div class="cuadre-pdf-brand">
            ${empresa.logo ? `<img class="cuadre-pdf-logo" src="${escapeHtml(empresa.logo)}" alt="Logo">` : ''}
            <div class="cuadre-pdf-company">
              <h1>${escapeHtml(empresa.nombre || 'Empresa')}</h1>
              ${empresa.rfc ? `<p>RFC: ${escapeHtml(empresa.rfc)}</p>` : ''}
              ${empresa.direccion ? `<p>${escapeHtml(empresa.direccion)}</p>` : ''}
              ${empresa.correo ? `<p>${escapeHtml(empresa.correo)}</p>` : ''}
              ${empresa.telefono ? `<p>${escapeHtml(empresa.telefono)}</p>` : ''}
            </div>
          </div>
          <div class="cuadre-pdf-meta">
            <p><strong>Fecha de corte:</strong> ${escapeHtml(fecha)}</p>
            <p><strong>Plaza:</strong> ${escapeHtml(plaza || 'N/D')}</p>
            <p><strong>Auxiliar en patio:</strong> ${escapeHtml(auxiliar || 'N/D')}</p>
            <p><strong>Autorizado por:</strong> ${escapeHtml(ventas || 'N/D')}</p>
            ${meta.missionId ? `<p><strong>Mision:</strong> ${escapeHtml(meta.missionId)}</p>` : ''}
          </div>
        </header>

        <div class="cuadre-pdf-title">
          <h2>Reporte de Auditoria Cruzada</h2>
          <span>Cuadre de flota operativo</span>
        </div>

        <div class="cuadre-pdf-kpis">
          <div class="cuadre-pdf-kpi"><small>Total revisadas</small><strong style="color:#3b82f6">${escapeHtml(String(stats.total || units.length || 0))}</strong></div>
          <div class="cuadre-pdf-kpi"><small>Cuadre perfecto</small><strong style="color:#16a34a">${escapeHtml(String(stats.ok || 0))}</strong></div>
          <div class="cuadre-pdf-kpi"><small>Faltantes fisicos</small><strong style="color:#ef4444">${escapeHtml(String(stats.faltantes || 0))}</strong></div>
          <div class="cuadre-pdf-kpi"><small>Sobrantes fisicos</small><strong style="color:#f59e0b">${escapeHtml(String(stats.sobrantes || 0))}</strong></div>
          <div class="cuadre-pdf-kpi"><small>Pendientes</small><strong style="color:#64748b">${escapeHtml(String(stats.pendientes || 0))}</strong></div>
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
              <th>Ubicacion</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8">Sin unidades revisadas.</td></tr>'}</tbody>
        </table>
      </section>

      <section class="cuadre-pdf-page cuadre-pdf-sign-page">
        <div class="cuadre-pdf-title">
          <h2>Firmas de Conformidad</h2>
          <span>Responsables del cuadre</span>
        </div>
        <div class="cuadre-pdf-sign-grid">
          ${_cuadrePdfFirmaHtml('Auxiliar en patio', meta.firmaAuxiliar || meta.firmaAuxiliarNombre || auxiliar, meta.firmaAuxiliarUrl || meta.auxiliarFirmaUrl || '')}
          ${_cuadrePdfFirmaHtml('Agente de ventas', ventas, meta.firmaDataUrl || meta.ventasFirmaUrl || '')}
        </div>
        <div class="cuadre-pdf-final-mark">GENERADO POR MAP GESTION</div>
        ${exportFooterHtml({ escapeHtml })}
      </section>
    </div>
  `;
}

/**
 * Abre un documento autocontenido e imprime. Evita el bug de
 * `body * { visibility:hidden }` sobre el shell SPA (PDF en blanco).
 */
export function abrirReporteImpresion(htmlContenido, { onError } = {}) {
  const signedTitle = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  let printWindow = null;
  try {
    printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800');
  } catch (_) {
    printWindow = null;
  }
  if (!printWindow) {
    console.error('No se pudo abrir la ventana de impresión (popup bloqueado).');
    if (typeof onError === 'function') onError(new Error('popup-blocked'));
    return;
  }

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
  <script>
    (function () {
      function cleanup() {
        try { window.close(); } catch (e) {}
      }
      window.addEventListener('afterprint', cleanup);
      setTimeout(function () {
        try { window.focus(); window.print(); } catch (e) { cleanup(); }
      }, 120);
      setTimeout(cleanup, 60000);
    })();
  <\/script>
</body>
</html>`;

  try {
    printWindow.document.open();
    printWindow.document.write(docHtml);
    printWindow.document.close();
  } catch (error) {
    console.error('No se pudo abrir la impresión:', error);
    try { printWindow.close(); } catch (_) {}
    if (typeof onError === 'function') onError(error);
  }
}
