/**
 * js/features/cuadre/prediccion.js
 * Motor del Cuadre de Predicción de Disponibilidad.
 *
 * EXTRACCIÓN SIN CAMBIOS de js/views/mapa.js.
 * Las funciones se re-exportan en mapa.js para que los onclick del HTML
 * sigan funcionando sin ninguna modificación.
 *
 * Dependencias externas (resueltas en runtime):
 *   window.api.obtenerDatosFlotaConsola  — inventario actual de Firebase
 *   window.api.generarExcelPrediccion    — registro de descarga en Firestore
 *   window.USER_NAME                     — nombre del usuario logueado
 *   window.showToast                     — feedback al usuario
 *   window.abrirReporteImpresion         — abre el panel de impresión del DOM
 *   window.descargarArchivoLocal         — descarga blob al disco
 *   window.generarSlugArchivo            — formatea el nombre del archivo
 */

'use strict';

// ── Helpers locales ───────────────────────────────────────────

function _escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Estado del módulo (ciclo de vida del modal) ───────────────

let _htmlTablaPrediccion     = '';
let _datosCalculadosParaExcel = [];
let _resumenPrediccionActual = null;
let _fechaSeleccionadaStr    = '';
let _fechaSeleccionadaIso    = '';

// ── Parser ────────────────────────────────────────────────────

export function extraerConteoClases(textoRaw) {
  let conteo = {};
  if (!textoRaw) return conteo;

  let textoLimpio = textoRaw.toUpperCase()
    .replace(/CON PAGO/g, '')
    .replace(/HOY, REGISTROS/g, '')
    .replace(/MAÑANA, REGISTROS/g, '')
    .replace(/PENDIENTES, REGISTROS/g, '');

  let lineas = textoLimpio.split('\n');

  const codigosValidos = [
    'XXAR',
    'ECAR',
    'CCAR',
    'ICAR', 'SCAR',
    'FCAR',
    'CFAR',
    'IFAR', 'SFAR',
    'FWAR',
    'FFBH', 'PFAR',
    'MVAR', 'MVAH', 'IVAH',
    'PVAR', 'CKMR', 'MPMN', 'GVMD', 'FKAR'
  ];

  for (let linea of lineas) {
    if (!linea.trim()) continue;
    for (let codigo of codigosValidos) {
      let regex = new RegExp(`\\b${codigo}\\b`, 'i');
      if (regex.test(linea)) {
        conteo[codigo] = (conteo[codigo] || 0) + 1;
        break;
      }
    }
  }
  return conteo;
}

// ── Generador HTML del PDF ────────────────────────────────────

function _generarHtmlPrediccionPdf() {
  if (!_htmlTablaPrediccion) return '';
  const total      = _resumenPrediccionActual ? _resumenPrediccionActual.totPred : 0;
  const colorTotal = total < 0 ? '#dc2626' : '#16a34a';
  return `
    <div>
      <div class="pdf-header">
        <div>
          <h1 class="pdf-title">Cuadre de Predicción</h1>
          <div style="font-size:12px; color:#475569; font-weight:700; margin-top:6px;">Comparativo reservas vs regresos vs inventario disponible</div>
        </div>
        <div class="pdf-meta">
          <div><b>Fecha objetivo:</b> ${_escapeHtml(_fechaSeleccionadaStr || _fechaSeleccionadaIso || '--')}</div>
          <div><b>Generado por:</b> ${_escapeHtml(window.USER_NAME || 'Sistema')}</div>
          <div><b>Total predicción:</b> <span style="color:${colorTotal}; font-weight:900;">${_escapeHtml(total)}</span></div>
        </div>
      </div>
      <div style="margin-top:8px;">${_htmlTablaPrediccion}</div>
    </div>
  `;
}

// ── Controladores exportados ──────────────────────────────────

export function reiniciarPrediccion() {
  document.getElementById('prediccion-paso-2').style.display = 'none';
  document.getElementById('prediccion-paso-1').style.display = 'block';
  _htmlTablaPrediccion      = '';
  _datosCalculadosParaExcel = [];
  _resumenPrediccionActual  = null;
  _fechaSeleccionadaStr     = '';
  _fechaSeleccionadaIso     = '';

  document.getElementById('txt-pred-reservas').value = '';
  document.getElementById('txt-pred-regresos').value = '';
  const tabla = document.getElementById('tabla-prediccion-container');
  if (tabla) tabla.innerHTML = '';

  const btnExcel = document.getElementById('btnDescargarPrediccionExcel');
  if (btnExcel) {
    btnExcel.disabled  = false;
    btnExcel.innerHTML = `<span class="material-icons">table_view</span> CREAR HOJA DE EXCEL EDITABLE`;
  }
  const btnPdf = document.getElementById('btnDescargarPrediccionPdf');
  if (btnPdf) {
    btnPdf.disabled  = false;
    btnPdf.innerHTML = `<span class="material-icons">picture_as_pdf</span> GUARDAR PDF OFICIAL`;
  }
}

export async function ejecutarPrediccion() {
  const txtRes    = document.getElementById('txt-pred-reservas').value;
  const txtReg    = document.getElementById('txt-pred-regresos').value;
  const inputFecha = document.getElementById('fecha-prediccion').value;

  if (!inputFecha) return window.showToast('Por favor selecciona una fecha.', 'warning');
  if (!txtRes && !txtReg) return window.showToast('Pega datos en alguna de las cajas.', 'warning');

  const f     = new Date(inputFecha + 'T12:00:00');
  const meses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  _fechaSeleccionadaStr = `${('0' + f.getDate()).slice(-2)}/ ${meses[f.getMonth()]}/ ${f.getFullYear()}`;
  _fechaSeleccionadaIso = inputFecha;

  const btn = document.getElementById('btnProcesarPrediccion');
  btn.disabled  = true;
  btn.innerHTML = `<span class="material-icons spinner">sync</span> CALCULANDO...`;

  try {
    const conteoReservas = extraerConteoClases(txtRes);
    const conteoRegresos = extraerConteoClases(txtReg);
    const inventarioActual   = await window.api.obtenerDatosFlotaConsola();
    const estadosDisponibles = new Set(['LISTO', 'SUCIO', 'RESGUARDO', 'TRASLADO']);

    let conteoDisponibles = {};
    (inventarioActual || []).forEach(car => {
      let est = (car.estado    || '').toUpperCase();
      let cat = (car.categoria || car.categ || '').toUpperCase().trim();
      if (estadosDisponibles.has(est) && cat) {
        conteoDisponibles[cat] = (conteoDisponibles[cat] || 0) + 1;
      }
    });

    const mapeoFamilias = [
      { nombre: 'COMPACTOS (AVEO/RIO/VERSA/MIRAGE)',          codigos: ['XXAR','ECAR','CCAR','CCMR'] },
      { nombre: 'INTERMEDIOS (CAVALIER/K3/VIRTUS)',            codigos: ['ICAR'] },
      { nombre: 'FULLSIZE (OMODA)(JETTA)',                     codigos: ['FCAR','SCAR'] },
      { nombre: 'SUV 1 (KICKS/TRACKER/TAOS)',                  codigos: ['CFAR'] },
      { nombre: 'SUV 2 (XTRAIL/TERRITORY/JOURNEY/SPORTAGE)',   codigos: ['SFAR','IFAR'] },
      { nombre: 'SUV 3 (XPANDER/AVANZA)',                      codigos: ['FWAR'] },
      { nombre: 'SUV 4 (CHEROKEE/ TANK)',                      codigos: ['FFBH'] },
      { nombre: 'MINIVAN (SIENNA/GN8)',                        codigos: ['MVAR','MVAH','IVAH','IVAR'] },
      { nombre: 'HIACE O TORNADO',                             codigos: ['CKMR','FKAR'] },
      { nombre: 'SUBURBAN',                                    codigos: ['PFAR'] }
    ];

    let trs = '';
    let totRes = 0, totDev = 0, totDis = 0, totPred = 0;
    _datosCalculadosParaExcel = [];

    mapeoFamilias.forEach(fam => {
      let res = 0, dev = 0, dis = 0;
      fam.codigos.forEach(codigo => {
        res += conteoReservas[codigo]  || 0;
        dev += conteoRegresos[codigo]  || 0;
        dis += conteoDisponibles[codigo] || 0;
      });

      let pred = dis + dev - res;
      totRes += res; totDev += dev; totDis += dis; totPred += pred;
      _datosCalculadosParaExcel.push({ nombre: fam.nombre, res, dev, dis, pred });

      const colorPred = pred < 0
        ? 'background:#ffcdd2; color:#b71c1c;'
        : (pred === 0 ? 'background:#fff9c4; color:#f57f17;' : 'background:#b9f6ca; color:#1b5e20;');

      trs += `
        <tr>
          <td style="padding:8px; border:1px solid #cbd5e1; background:#f8fafc; font-weight:800; font-size:11px;">${fam.nombre}</td>
          <td style="padding:8px; border:1px solid #cbd5e1; background:#ffca28; text-align:center; font-weight:bold; font-size:13px;">${res}</td>
          <td style="padding:8px; border:1px solid #cbd5e1; background:#dce775; text-align:center; font-weight:bold; font-size:13px;">${dev}</td>
          <td style="padding:8px; border:1px solid #cbd5e1; background:#aed581; text-align:center; font-weight:bold; font-size:13px;">${dis}</td>
          <td style="padding:8px; border:1px solid #cbd5e1; text-align:center; font-weight:900; font-size:15px; ${colorPred}">${pred}</td>
        </tr>`;
    });

    trs += `
      <tr style="background:#f1f5f9;">
        <td style="padding:10px; border:1px solid #cbd5e1; font-weight:900; font-size:13px;">TOTAL</td>
        <td style="padding:10px; border:1px solid #cbd5e1; background:#ffb300; text-align:center; font-weight:900; font-size:14px;">${totRes}</td>
        <td style="padding:10px; border:1px solid #cbd5e1; background:#c0ca33; text-align:center; font-weight:900; font-size:14px;">${totDev}</td>
        <td style="padding:10px; border:1px solid #cbd5e1; background:#8bc34a; text-align:center; font-weight:900; font-size:14px;">${totDis}</td>
        <td style="padding:10px; border:1px solid #cbd5e1; text-align:center; font-weight:900; font-size:16px; ${totPred < 0 ? 'background:#e53935; color:white;' : 'background:#4caf50; color:white;'}">${totPred}</td>
      </tr>`;

    _htmlTablaPrediccion = `
      <table style="width:100%; border-collapse:collapse; font-family:inherit;">
        <thead>
          <tr>
            <th style="background:#e2e8f0; color:#1e293b; padding:10px; border:1px solid #cbd5e1; font-size:10px;">CATEGORIA</th>
            <th style="background:#e2e8f0; color:#1e293b; padding:10px; border:1px solid #cbd5e1; font-size:10px;">RESERVAS</th>
            <th style="background:#e2e8f0; color:#1e293b; padding:10px; border:1px solid #cbd5e1; font-size:10px;">DEVOLUCIONES</th>
            <th style="background:#e2e8f0; color:#1e293b; padding:10px; border:1px solid #cbd5e1; font-size:10px;">DISPONIBLES</th>
            <th style="background:#e2e8f0; color:#1e293b; padding:10px; border:1px solid #cbd5e1; font-size:10px;">PREDICCIÓN</th>
          </tr>
        </thead>
        <tbody>${trs}</tbody>
      </table>`;

    _resumenPrediccionActual = { totRes, totDev, totDis, totPred };
    document.getElementById('tabla-prediccion-container').innerHTML = _htmlTablaPrediccion;
    document.getElementById('prediccion-paso-1').style.display = 'none';
    document.getElementById('prediccion-paso-2').style.display = 'block';
    window.showToast('Predicción calculada con datos actuales de Firebase.', 'success');

  } catch (error) {
    console.error('[prediccion] ejecutarPrediccion:', error);
    window.showToast('No se pudo calcular la predicción.', 'error');
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<span class="material-icons">auto_awesome</span> CALCULAR DISPONIBILIDAD`;
  }
}

export async function descargarPDFPrediccion() {
  if (!_htmlTablaPrediccion) return window.showToast('Primero calcula la predicción.', 'warning');
  const btn = document.getElementById('btnDescargarPrediccionPdf');
  btn.disabled  = true;
  btn.innerHTML = `<span class="material-icons spinner">sync</span> PREPARANDO PDF...`;

  try {
    if (typeof window.abrirReporteImpresion === 'function') {
      window.abrirReporteImpresion(_generarHtmlPrediccionPdf());
    }
    window.showToast('Se abrió el generador de PDF de la predicción.', 'success');
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<span class="material-icons">picture_as_pdf</span> GUARDAR PDF OFICIAL`;
  }
}

export async function crearExcelPrediccion() {
  if (!_datosCalculadosParaExcel.length) return window.showToast('Primero calcula la predicción.', 'warning');
  const btn = document.getElementById('btnDescargarPrediccionExcel');
  btn.disabled  = true;
  btn.innerHTML = `<span class="material-icons spinner">sync</span> ARMANDO EXCEL...`;

  try {
    const filas = _datosCalculadosParaExcel.map(item => `
      <tr>
        <td>${_escapeHtml(item.nombre)}</td>
        <td>${_escapeHtml(item.res)}</td>
        <td>${_escapeHtml(item.dev)}</td>
        <td>${_escapeHtml(item.dis)}</td>
        <td>${_escapeHtml(item.pred)}</td>
      </tr>`).join('');

    const totalRow = _resumenPrediccionActual ? `
      <tr style="font-weight:900; background:#e2e8f0;">
        <td>TOTAL</td>
        <td>${_escapeHtml(_resumenPrediccionActual.totRes)}</td>
        <td>${_escapeHtml(_resumenPrediccionActual.totDev)}</td>
        <td>${_escapeHtml(_resumenPrediccionActual.totDis)}</td>
        <td>${_escapeHtml(_resumenPrediccionActual.totPred)}</td>
      </tr>` : '';

    const contenido = `\ufeff
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
        <head>
          <meta charset="utf-8">
          <style>
            table { border-collapse:collapse; font-family:Arial,sans-serif; width:100%; }
            th, td { border:1px solid #cbd5e1; padding:8px; }
            th { background:#0d2a54; color:white; }
          </style>
        </head>
        <body>
          <h2>Cuadre de Predicción</h2>
          <p><b>Fecha objetivo:</b> ${_escapeHtml(_fechaSeleccionadaStr || _fechaSeleccionadaIso || '--')}</p>
          <p><b>Generado por:</b> ${_escapeHtml(window.USER_NAME || 'Sistema')}</p>
          <table>
            <thead>
              <tr>
                <th>CATEGORIA</th><th>RESERVAS</th><th>DEVOLUCIONES</th><th>DISPONIBLES</th><th>PREDICCIÓN</th>
              </tr>
            </thead>
            <tbody>
              ${filas}
              ${totalRow}
            </tbody>
          </table>
        </body>
      </html>`;

    const fechaArchivo = (_fechaSeleccionadaIso || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, '');
    window.descargarArchivoLocal(
      `prediccion-cuadre-${window.generarSlugArchivo(fechaArchivo)}.xls`,
      contenido,
      'application/vnd.ms-excel;charset=utf-8;'
    );
    await window.api.generarExcelPrediccion(_datosCalculadosParaExcel, _fechaSeleccionadaStr, window.USER_NAME)
      .catch(e => console.warn('[prediccion] No se pudo registrar el Excel de predicción:', e));
    window.showToast('Hoja compatible con Excel descargada.', 'success');

  } catch (error) {
    console.error('[prediccion] crearExcelPrediccion:', error);
    window.showToast('No se pudo generar la hoja de predicción.', 'error');
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<span class="material-icons">table_view</span> CREAR HOJA DE EXCEL EDITABLE`;
  }
}
