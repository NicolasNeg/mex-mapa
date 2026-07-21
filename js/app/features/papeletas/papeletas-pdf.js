import {
  buildExportFilename,
  exportFooterHtml,
  getExportIdentity,
} from '/js/core/export-signing.js';
import { exportMatrixCsv, exportMatrixXls } from '/js/core/export-menu.js';
import {
  ZONAS_V1,
  CHECKLIST_KEYS,
  CHECKLIST_LABELS,
  LLANTA_KEYS,
  LLANTA_LABELS,
  normalizeMarcasLlantas,
  normalizeTapetes,
} from '/domain/papeleta.model.js';
import { getDownloadUrl } from '/js/app/features/papeletas/papeletas-storage.js';
import { strokesToDataUrlAsync, DIAGRAM_IMAGE_URL } from '/js/app/features/papeletas/papeletas-diagram.js';

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _checkLabel(v) {
  if (v === 'ok') return '✓';
  if (v === 'faltante') return 'X';
  if (v === 'na') return 'N/A';
  return '—';
}

/** Matriz plana de una papeleta para XLS/CSV. */
export function papeletaExportMatrix(papeleta) {
  const marcas = normalizeMarcasLlantas(papeleta);
  const tapetes = normalizeTapetes(papeleta);
  const headers = ['Campo', 'Valor'];
  const rows = [
    ['MVA', papeleta.mva || ''],
    ['Estado', papeleta.status || ''],
    ['Modelo', papeleta.modelo || ''],
    ['Placas', papeleta.placas || ''],
    ['Color', papeleta.color || ''],
    ['VIN', papeleta.vin || ''],
    ['Contrato', papeleta.contrato || ''],
    ['Cliente', papeleta.clienteNombre || ''],
    ['Plaza', papeleta.plazaId || ''],
    ['KM salida', papeleta.salida?.km ?? ''],
    ['Gas salida', papeleta.salida?.gas ?? ''],
    ['Quién entrega', papeleta.salida?.quienEntrega || ''],
    ['KM entrada', papeleta.entrada?.km ?? ''],
    ['Gas entrada', papeleta.entrada?.gas ?? ''],
    ['Quién recibe', papeleta.entrada?.quienRecibe || ''],
    ['Notas / interiores', papeleta.notasInteriores || papeleta.entrada?.notas || ''],
    ['Tapetes uso rudo', tapetes.usoRudo ?? ''],
    ['Tapetes alfombra', tapetes.alfombra ?? ''],
    ['Marcas llantas · marcar todas', marcas.marcarTodas ? 'sí' : 'no'],
  ];
  for (const k of LLANTA_KEYS) {
    rows.push([`Llanta · ${LLANTA_LABELS[k]}`, marcas[k] || '']);
  }
  for (const k of CHECKLIST_KEYS) {
    rows.push([`Checklist · ${CHECKLIST_LABELS[k] || k}`, papeleta.checklist?.[k] || '']);
  }
  for (const z of ZONAS_V1) {
    const n = papeleta.zonas?.[z.id];
    const estado = n?.estado || 'ok';
    const nota = n?.nota ? ` — ${n.nota}` : '';
    rows.push([`Zona · ${z.label}`, `${estado}${nota}`]);
  }
  return { headers, body: rows, title: `Papeleta ${papeleta.mva || ''}`.trim() };
}

export function exportPapeletaXls(papeleta) {
  const data = papeletaExportMatrix(papeleta);
  exportMatrixXls(data.headers, data.body, { title: data.title, filename: buildExportFilename('xls') });
}

export function exportPapeletaCsv(papeleta) {
  const data = papeletaExportMatrix(papeleta);
  exportMatrixCsv(data.headers, data.body, { filename: buildExportFilename('csv') });
}

async function _loadFotoMap(papeleta) {
  const map = {};
  for (const z of ZONAS_V1) {
    const path = papeleta.zonas?.[z.id]?.fotoPath;
    if (!path) continue;
    try {
      map[z.id] = await getDownloadUrl(path);
    } catch (_) { /* ignore */ }
  }
  return map;
}

/**
 * Abre ventana imprimible / PDF cliente (hoja de inspección compacta).
 * @param {object} papeleta
 * @param {{ firmaUrl?: string, fotoUrls?: Record<string,string> }} opts
 */
export async function openPapeletaPdf(papeleta, { firmaUrl = '', fotoUrls = null } = {}) {
  const fileTitle = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  const id = getExportIdentity();
  const fotos = fotoUrls || await _loadFotoMap(papeleta);
  const marcas = normalizeMarcasLlantas(papeleta);
  const tapetes = normalizeTapetes(papeleta);
  const zonasDano = ZONAS_V1.filter((z) => papeleta.zonas?.[z.id]?.estado === 'dano');
  const notasTxt = String(papeleta.notasInteriores || papeleta.entrada?.notas || '').trim();
  const hasLlantas = LLANTA_KEYS.some((k) => String(marcas[k] || '').trim()) || marcas.marcarTodas;
  const fotoEntries = ZONAS_V1.filter((z) => fotos[z.id]);
  const hasFotos = fotoEntries.length > 0;

  // Compact checklist: 2 columns of item/state pairs
  const mid = Math.ceil(CHECKLIST_KEYS.length / 2);
  const chkLeft = CHECKLIST_KEYS.slice(0, mid);
  const chkRight = CHECKLIST_KEYS.slice(mid);
  const chkCell = (k) => {
    const v = papeleta.checklist?.[k] || '';
    return `<td class="chk-item">${_esc(CHECKLIST_LABELS[k] || k)}</td><td class="center">${_esc(_checkLabel(v))}</td>`;
  };
  const checklistRows = Array.from({ length: mid }, (_, i) => {
    const a = chkLeft[i];
    const b = chkRight[i];
    return `<tr>${chkCell(a)}${b ? chkCell(b) : '<td></td><td></td>'}</tr>`;
  }).join('');

  const llantasHtml = hasLlantas
    ? `<h2>Llantas${marcas.marcarTodas ? ' · todas iguales' : ''}</h2>
       <div class="grid-4">${LLANTA_KEYS.map((k) =>
         `<div class="cell"><span class="label">${_esc(LLANTA_LABELS[k])}</span><span class="val">${_esc(marcas[k] || '—')}</span></div>`
       ).join('')}</div>`
    : '';

  const photosHtml = hasFotos
    ? fotoEntries.map((z) => {
      const url = fotos[z.id];
      const dano = papeleta.zonas?.[z.id]?.estado === 'dano';
      const nota = papeleta.zonas?.[z.id]?.nota || '';
      return `<figure class="ph${dano ? ' dano' : ''}">
        <img src="${_esc(url)}" alt=""/>
        <figcaption>${_esc(z.label)}${dano ? ' · daño' : ''}${nota ? ` — ${_esc(nota)}` : ''}</figcaption>
      </figure>`;
    }).join('')
    : '';

  const strokes = Array.isArray(papeleta.diagramaStrokes) ? papeleta.diagramaStrokes : [];
  const danosMarcados = Array.isArray(papeleta.danosMarcados)
    ? papeleta.danosMarcados
    : (Array.isArray(papeleta.salida?.danosMarcados) ? papeleta.salida.danosMarcados : []);
  const absDiagram = (() => {
    try {
      return new URL(DIAGRAM_IMAGE_URL, window.location.origin).href;
    } catch (_) {
      return DIAGRAM_IMAGE_URL;
    }
  })();
  let diagramUrl = absDiagram;
  try {
    diagramUrl = await strokesToDataUrlAsync(strokes, { danosMarcados });
  } catch (_) {
    diagramUrl = absDiagram;
  }
  const hasMarks = strokes.length > 0 || danosMarcados.length > 0;
  const diagramHtml = `<h2>Diagrama</h2>
    <div class="diagram-wrap">
      <img class="diagram" src="${_esc(diagramUrl)}" alt="Diagrama de inspección"/>
    </div>
    ${hasMarks ? '' : '<p class="muted">Sin marcas.</p>'}
    ${danosMarcados.length ? `<ol class="dmg">${danosMarcados.map((d) =>
      `<li>#${_esc(d.displayNumber)} · ${_esc(d.damageType)} · ${_esc(d.severity)}${d.note ? ` — ${_esc(d.note)}` : ''}</li>`
    ).join('')}</ol>` : ''}`;

  const danosHtml = zonasDano.length
    ? `<h2>Daños (${zonasDano.length})</h2>
       <ul class="dmg-list">${zonasDano.map((z) => {
         const n = papeleta.zonas[z.id];
         return `<li><b>${_esc(z.label)}</b>${n?.nota ? ` — ${_esc(n.nota)}` : ''}</li>`;
       }).join('')}</ul>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"/>
<title>${_esc(fileTitle)}</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:Inter,Arial,sans-serif;margin:8mm 8mm 6mm;color:#121212;font-size:9.5px;line-height:1.25;background:#fff}
  h1{font-size:14px;margin:0 0 1px;font-weight:700;text-transform:uppercase;letter-spacing:.02em}
  h2{font-size:9px;margin:8px 0 4px;padding-bottom:2px;border-bottom:1.5px solid #121212;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  .meta{color:#6b6a64;margin-bottom:6px;font-size:8.5px;font-family:ui-monospace,monospace}
  .head{display:grid;grid-template-columns:1.4fr .6fr;gap:6px;margin-bottom:4px;align-items:start}
  .box{border:1px solid #121212;padding:5px 7px;background:#fff}
  .grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 8px}
  .grid-4 .cell .label,.box .label{font-size:7.5px;color:#6b6a64;text-transform:uppercase;letter-spacing:.04em;display:block}
  .grid-4 .cell .val,.box .val{font-weight:600;font-size:10px;margin-top:0}
  .unit{display:grid;grid-template-columns:repeat(4,1fr);gap:3px 8px;margin-bottom:4px}
  .io{width:100%;border-collapse:collapse;margin:2px 0 0}
  .io th,.io td{border:1px solid #121212;padding:3px 5px;text-align:left;background:#fff;font-size:9px}
  .io th{background:#ebe6db;font-size:8px;text-transform:uppercase}
  table.chk{width:100%;border-collapse:collapse;margin:2px 0}
  table.chk th,table.chk td{border:1px solid #121212;padding:2px 4px;background:#fff;font-size:8.5px}
  table.chk th{background:#ebe6db;font-size:7.5px;text-transform:uppercase}
  .chk-item{width:38%}
  .center{text-align:center;font-weight:700}
  .photos{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-top:4px}
  .ph{margin:0;border:1px solid #121212;overflow:hidden;background:#111;break-inside:avoid}
  .ph.dano{border-color:#c41212;border-width:2px}
  .ph img{width:100%;height:48px;object-fit:cover;display:block}
  .ph figcaption{font-size:7px;padding:1px 3px;background:#fff;color:#3a3a38;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .diagram-wrap{display:flex;justify-content:center;margin:2px 0 4px}
  .diagram{display:block;width:auto;max-width:280px;max-height:160px;border:1px solid #121212;background:#fff}
  .dmg{margin:2px 0 0;padding-left:14px;font-size:8.5px}
  .dmg-list{margin:2px 0 0;padding-left:14px;font-size:8.5px;columns:2;column-gap:12px}
  .firma{margin-top:6px;max-width:160px}
  .firma img{max-width:100%;max-height:56px;border:1px solid #121212;background:#fff}
  .footer{margin-top:8px;padding-top:4px;border-top:1.5px solid #121212;font-size:8px;color:#6b6a64}
  .muted{color:#6b6a64;font-size:8px;margin:0}
  .notes{margin:2px 0 0;font-size:9px}
  .no-print{margin-top:10px}
  .btn-print{padding:6px 14px;background:#121212;color:#f7f4ee;border:none;cursor:pointer;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  .two-col{display:grid;grid-template-columns:1.1fr .9fr;gap:8px;align-items:start}
  @media print{
    body{margin:6mm 7mm}
    .no-print{display:none}
    .photos{grid-template-columns:repeat(6,1fr)}
    h2{break-after:avoid}
    .ph,.box,.diagram-wrap{break-inside:avoid}
  }
  @page{margin:6mm}
</style></head><body>
<div class="head">
  <div>
    <h1>Hoja de inspección — ${_esc(papeleta.mva || '')}</h1>
    <div class="meta">${_esc(id.companyName)} · ${_esc(papeleta.status)} · ${_esc(id.dateLabel)} · Contrato ${_esc(papeleta.contrato || '—')}</div>
  </div>
  <div class="box">
    <span class="label">Cliente</span>
    <div class="val">${_esc(papeleta.clienteNombre || '—')}</div>
  </div>
</div>

<div class="box unit">
  <div><span class="label">MVA</span><div class="val">${_esc(papeleta.mva || '—')}</div></div>
  <div><span class="label">Modelo</span><div class="val">${_esc(papeleta.modelo || '—')}</div></div>
  <div><span class="label">Placas</span><div class="val">${_esc(papeleta.placas || '—')}</div></div>
  <div><span class="label">Color</span><div class="val">${_esc(papeleta.color || '—')}</div></div>
  <div><span class="label">VIN</span><div class="val">${_esc(papeleta.vin || '—')}</div></div>
  <div><span class="label">Plaza</span><div class="val">${_esc(papeleta.plazaId || '—')}</div></div>
  <div><span class="label">Tapetes rudo</span><div class="val">${_esc(tapetes.usoRudo ?? '—')}</div></div>
  <div><span class="label">Tapetes alfombra</span><div class="val">${_esc(tapetes.alfombra ?? '—')}</div></div>
</div>

<h2>KM / Gasolina</h2>
<table class="io">
  <thead><tr><th></th><th>Nombre</th><th>KM</th><th>Gas</th></tr></thead>
  <tbody>
    <tr>
      <th>Out</th>
      <td>${_esc(papeleta.salida?.quienEntrega || '—')}</td>
      <td>${_esc(papeleta.salida?.km ?? '—')}</td>
      <td>${_esc(papeleta.salida?.gas || '—')}</td>
    </tr>
    <tr>
      <th>In</th>
      <td>${_esc(papeleta.entrada?.quienRecibe || '—')}</td>
      <td>${_esc(papeleta.entrada?.km ?? '—')}</td>
      <td>${_esc(papeleta.entrada?.gas || '—')}</td>
    </tr>
  </tbody>
</table>

<div class="two-col">
  <div>
    <h2>Checklist</h2>
    <table class="chk">
      <thead><tr><th>Ítem</th><th></th><th>Ítem</th><th></th></tr></thead>
      <tbody>${checklistRows}</tbody>
    </table>
    ${llantasHtml}
    ${notasTxt ? `<h2>Notas</h2><p class="notes">${_esc(notasTxt)}</p>` : ''}
    ${danosHtml}
  </div>
  <div>
    ${diagramHtml}
    ${firmaUrl ? `<div class="firma"><span class="label">Firma cliente</span><img src="${_esc(firmaUrl)}" alt="Firma"/></div>` : ''}
  </div>
</div>

${hasFotos ? `<h2>Fotos (${fotoEntries.length})</h2><div class="photos">${photosHtml}</div>` : ''}

<div class="footer">${exportFooterHtml({ escapeHtml: _esc })}</div>
<div class="no-print"><button class="btn-print" type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) throw new Error('Permite ventanas emergentes para generar el PDF');
  w.document.open();
  w.document.write(html);
  w.document.close();
  return buildExportFilename('pdf');
}
