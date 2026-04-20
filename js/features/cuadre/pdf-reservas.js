/**
 * js/features/cuadre/pdf-reservas.js
 * Motor de parseo y generación del Reporte de Actividad Diaria (PDF de Reservas/Regresos).
 *
 * EXTRACCIÓN SIN CAMBIOS de js/views/mapa.js.
 * Las funciones se re-exportan en mapa.js para que los onclick del HTML
 * sigan funcionando sin ninguna modificación.
 *
 * Dependencias externas (resueltas en runtime):
 *   window.api.generarPDFActividadDiaria — API layer
 *   window.USER_NAME                     — nombre del usuario logueado
 *   window.showToast                     — feedback al usuario
 *   #reporte-pdf-container               — div en mapa.html para el print
 *   #modal-lector-reservas               — modal que contiene los textareas
 */

'use strict';

// ── Helpers de formato ────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatearFechaDocumento(fechaTexto) {
  const fecha = new Date(fechaTexto);
  if (Number.isNaN(fecha.getTime())) return String(fechaTexto || '');
  return fecha.toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ── Parseo ────────────────────────────────────────────────────

export function parsearTablaSucia(rawText, esReserva) {
  let data = [];
  if (!rawText) return data;

  let textoLimpio = rawText
    .replace(/EN DOS DÍAS, REGISTROS:\s*\d+/ig, '')
    .replace(/HOY, REGISTROS:\s*\d+/ig, '')
    .replace(/MAÑANA, REGISTROS:\s*\d+/ig, '')
    .replace(/PENDIENTES, REGISTROS:\s*\d+/ig, '')
    .replace(/CONTRATOS VENCIDOS.*?REGISTROS:\s*\d+/ig, '')
    .replace(/NÚMERO\s*RECOGIDA\s*CLASE\s*CLIENTE/ig, '')
    .replace(/NÚMERO\s*REGRESO\s*CLASE\s*CLIENTE/ig, '')
    .replace(/RECOGIDA\s*CLASE\s*CLIENTE/ig, '')
    .trim();

  const regexAncla = /(20\d{2}-\d{2}-\d{2}\s\d{1,2}:\d{2}:\d{2})\s*([A-Z]{4})/gi;
  let matches = [];
  let match;
  while ((match = regexAncla.exec(textoLimpio)) !== null) {
    matches.push({
      fecha: match[1].trim(),
      clase: match[2].toUpperCase().trim(),
      start: match.index,
      end:   match.index + match[0].length
    });
  }
  if (matches.length === 0) return data;

  let primerHueco    = textoLimpio.substring(0, matches[0].start).trim();
  let contratoActual = primerHueco || 'S/C';

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next    = matches[i + 1];
    const hueco   = next
      ? textoLimpio.substring(current.end, next.start)
      : textoLimpio.substring(current.end);

    let contratoProximo     = 'S/C';
    let textoClienteYTags   = hueco.trim();

    if (next) {
      const regexContrato = /(\d{4,12}[A-Za-z]?|[A-Za-z]{2,4}\d{4,10})$/i;
      const matchContrato = textoClienteYTags.match(regexContrato);
      if (matchContrato) {
        contratoProximo   = matchContrato[1].trim();
        textoClienteYTags = textoClienteYTags.slice(0, -contratoProximo.length).trim();
      }
    }

    let pago = false, frecuente = false;
    if (/con pago/i.test(textoClienteYTags)) {
      pago = true;
      textoClienteYTags = textoClienteYTags.replace(/con pago/ig, '').trim();
    }
    if (/cliente frecuente/i.test(textoClienteYTags)) {
      frecuente = true;
      textoClienteYTags = textoClienteYTags.replace(/cliente frecuente/ig, '').trim();
    }

    data.push({
      numero:   contratoActual,
      fecha:    current.fecha,
      clase:    current.clase,
      cliente:  textoClienteYTags || 'SIN NOMBRE',
      pago,
      frecuente,
      tipo: esReserva ? 'RESERVA' : 'REGRESO'
    });
    contratoActual = contratoProximo;
  }
  return data;
}

// ── Generadores de HTML para el PDF ──────────────────────────

function _inicioDiaSeguro(fechaTexto) {
  const fecha = new Date(fechaTexto);
  if (Number.isNaN(fecha.getTime())) return null;
  fecha.setHours(0, 0, 0, 0);
  return fecha;
}

function _badgeTiempoActividad(fechaTexto, fechaBase, forzarUrgente = false) {
  const fechaItem = _inicioDiaSeguro(fechaTexto);
  const fechaRef  = _inicioDiaSeguro(fechaBase);
  if (!fechaItem || !fechaRef)
    return `<span class="status-badge bg-gray">SIN FECHA</span>`;

  const dias = Math.round((fechaItem.getTime() - fechaRef.getTime()) / 86400000);
  if (forzarUrgente || dias < 0)
    return `<span class="status-badge bg-red">URGENTE</span>`;
  if (dias === 0) return `<span class="status-badge bg-yellow">HOY</span>`;
  if (dias === 1) return `<span class="status-badge bg-green">MAÑANA</span>`;
  return `<span class="status-badge bg-gray">${dias} DÍAS</span>`;
}

function _tablaActividadHtml(items, fechaBase, opciones = {}) {
  const {
    vacio            = 'Sin registros.',
    colorEncabezado  = '#0d2a54',
    mostrarEtiquetas = false,
    forzarUrgente    = false
  } = opciones;

  if (!items.length) {
    return `<div style="padding:14px 16px; border:1px dashed #cbd5e1; border-radius:12px; color:#64748b; font-weight:700; background:#f8fafc;">${escapeHtml(vacio)}</div>`;
  }

  const filas = items.map(item => {
    const etiquetas = [];
    if (item.pago)     etiquetas.push('CON PAGO');
    if (item.frecuente) etiquetas.push('CLIENTE FRECUENTE');
    const etiquetaHtml = mostrarEtiquetas
      ? (etiquetas.length
        ? etiquetas.map(t => `<span class="status-badge bg-gray" style="margin-right:4px;">${escapeHtml(t)}</span>`).join('')
        : `<span style="color:#94a3b8; font-weight:700;">--</span>`)
      : '';

    return `
      <tr>
        <td>${escapeHtml(item.numero   || 'S/C')}</td>
        <td>${escapeHtml(formatearFechaDocumento(item.fecha))}</td>
        <td>${escapeHtml(item.clase    || 'S/C')}</td>
        <td>${escapeHtml(item.cliente  || 'SIN NOMBRE')}</td>
        <td>${_badgeTiempoActividad(item.fecha, fechaBase, forzarUrgente)}</td>
        ${mostrarEtiquetas ? `<td>${etiquetaHtml}</td>` : ''}
      </tr>`;
  }).join('');

  return `
    <table class="pdf-table">
      <thead>
        <tr>
          <th style="background:${colorEncabezado};">Contrato</th>
          <th style="background:${colorEncabezado};">Fecha</th>
          <th style="background:${colorEncabezado};">Clase</th>
          <th style="background:${colorEncabezado};">Cliente</th>
          <th style="background:${colorEncabezado};">Ventana</th>
          ${mostrarEtiquetas ? `<th style="background:${colorEncabezado};">Etiquetas</th>` : ''}
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>`;
}

function _resumenActividadCard(titulo, valor, colorFondo, colorTexto) {
  return `
    <div style="padding:14px 16px; border-radius:14px; background:${colorFondo}; color:${colorTexto};">
      <div style="font-size:11px; font-weight:900; letter-spacing:0.8px;">${escapeHtml(titulo)}</div>
      <div style="font-size:26px; font-weight:900; margin-top:4px;">${escapeHtml(String(valor))}</div>
    </div>`;
}

export function generarHtmlActividadDiaria(reservas, regresos, vencidos, autor, fechaFront) {
  return `
    <div>
      <div class="pdf-header">
        <div>
          <h1 class="pdf-title">Reporte de Actividad Diaria</h1>
          <div style="font-size:12px; color:#475569; font-weight:700; margin-top:6px;">Reservas, contratos por cerrar y vencidos del día</div>
        </div>
        <div class="pdf-meta">
          <div><b>Generado por:</b> ${escapeHtml(autor || 'Sistema')}</div>
          <div><b>Emitido:</b> ${escapeHtml(formatearFechaDocumento(new Date().toISOString()))}</div>
          <div><b>Base:</b> ${escapeHtml(formatearFechaDocumento(fechaFront))}</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:18px;">
        ${_resumenActividadCard('RESERVAS',  reservas.length, '#fffbeb', '#b45309')}
        ${_resumenActividadCard('REGRESOS',  regresos.length, '#eff6ff', '#1d4ed8')}
        ${_resumenActividadCard('VENCIDOS',  vencidos.length, '#fef2f2', '#b91c1c')}
      </div>

      <div class="pdf-section-title">1. Reservas priorizadas (${reservas.length})</div>
      ${_tablaActividadHtml(reservas, fechaFront, { vacio: 'No se detectaron reservas en la captura.', colorEncabezado: '#d97706', mostrarEtiquetas: true })}

      <div class="pdf-section-title">2. Contratos por cerrar (${regresos.length})</div>
      ${_tablaActividadHtml(regresos, fechaFront, { vacio: 'No se detectaron regresos en la captura.', colorEncabezado: '#0284c7', mostrarEtiquetas: true })}

      <div class="pdf-section-title">3. Vencidos / posibles llegadas (${vencidos.length})</div>
      ${_tablaActividadHtml(vencidos, fechaFront, { vacio: 'No hay vencidos incluidos en este reporte.', colorEncabezado: '#dc2626', forzarUrgente: true })}
    </div>`;
}

// ── UI — controladores del modal ──────────────────────────────

export function validarTextareasActividad() {
  const txtRes = document.getElementById('textoBrutoReservas').value.trim();
  const txtReg = document.getElementById('textoBrutoRegresos').value.trim();
  const btn    = document.getElementById('btnGenerarPdfActividad');
  if (!btn) return;

  if (txtRes !== '' && txtReg !== '') {
    btn.disabled          = false;
    btn.style.background  = 'var(--mex-blue)';
    btn.style.color       = 'white';
    btn.style.cursor      = 'pointer';
    btn.style.boxShadow   = '0 10px 25px rgba(13,42,84,0.2)';
    btn.innerHTML         = `<span class="material-icons">picture_as_pdf</span> GENERAR REPORTE COMPLETO`;
  } else {
    btn.disabled          = true;
    btn.style.background  = '#e2e8f0';
    btn.style.color       = '#94a3b8';
    btn.style.cursor      = 'not-allowed';
    btn.style.boxShadow   = 'none';
    btn.innerHTML         = `<span class="material-icons">lock</span> ESPERANDO DATOS...`;
  }
}

export async function procesarActividadDiaria() {
  const txtRes = document.getElementById('textoBrutoReservas').value;
  const txtReg = document.getElementById('textoBrutoRegresos').value;
  const txtVen = document.getElementById('textoBrutoVencidos').value;
  const btn    = document.getElementById('btnGenerarPdfActividad');

  btn.disabled  = true;
  btn.innerHTML = `<span class="material-icons spinner">sync</span> ARMANDO REPORTE...`;

  try {
    const reservas = parsearTablaSucia(txtRes, true).sort((a, b) => {
      const scoreA = (a.pago ? 2 : 0) + (a.frecuente ? 1 : 0);
      const scoreB = (b.pago ? 2 : 0) + (b.frecuente ? 1 : 0);
      if (scoreA !== scoreB) return scoreB - scoreA;
      return new Date(a.fecha) - new Date(b.fecha);
    });

    const regresos = parsearTablaSucia(txtReg, false).sort((a, b) => {
      if (a.frecuente && !b.frecuente) return -1;
      if (!a.frecuente && b.frecuente) return 1;
      return new Date(a.fecha) - new Date(b.fecha);
    });

    const vencidos    = parsearTablaSucia(txtVen, false)
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    const fechaFront  = new Date().toISOString();
    const autor       = window.USER_NAME || '';
    const api         = window.api;

    await api.generarPDFActividadDiaria(reservas, regresos, vencidos, autor, fechaFront)
      .catch(e => console.warn('[pdf-reservas] No se pudo registrar el reporte:', e));

    // abrirReporteImpresion sigue en mapa.js (depende del DOM global de impresión)
    if (typeof window.abrirReporteImpresion === 'function') {
      window.abrirReporteImpresion(generarHtmlActividadDiaria(reservas, regresos, vencidos, autor, fechaFront));
    }

    document.getElementById('textoBrutoReservas').value = '';
    document.getElementById('textoBrutoRegresos').value = '';
    document.getElementById('textoBrutoVencidos').value = '';
    document.getElementById('modal-lector-reservas').classList.remove('active');
    validarTextareasActividad();
    window.showToast?.('Se abrió el generador de PDF del reporte diario.', 'success');

  } catch (error) {
    console.error('[pdf-reservas] procesarActividadDiaria:', error);
    window.showToast?.('No se pudo generar el reporte diario.', 'error');
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<span class="material-icons">picture_as_pdf</span> GENERAR REPORTE COMPLETO`;
  }
}
