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
 * Abre ventana imprimible / PDF cliente (hoja de inspección organizada).
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
  const checklistRows = CHECKLIST_KEYS.map((k) => {
    const v = papeleta.checklist?.[k] || '';
    return `<tr><td>${_esc(CHECKLIST_LABELS[k] || k)}</td><td class="center">${_esc(_checkLabel(v))}</td></tr>`;
  }).join('');
  const llantasRows = LLANTA_KEYS.map((k) => (
    `<tr><td>${_esc(LLANTA_LABELS[k])}</td><td>${_esc(marcas[k] || '—')}</td></tr>`
  )).join('');

  const photosHtml = ZONAS_V1.map((z) => {
    const url = fotos[z.id];
    const dano = papeleta.zonas?.[z.id]?.estado === 'dano';
    const nota = papeleta.zonas?.[z.id]?.nota || '';
    return `<figure class="ph${dano ? ' dano' : ''}">
      ${url ? `<img src="${_esc(url)}" alt=""/>` : '<div class="ph-empty">Sin foto</div>'}
      <figcaption>${_esc(z.label)}${dano ? ' · daño' : ''}${nota ? ` — ${_esc(nota)}` : ''}</figcaption>
    </figure>`;
  }).join('');

  const strokes = Array.isArray(papeleta.diagramaStrokes) ? papeleta.diagramaStrokes : [];
  const absDiagram = (() => {
    try {
      return new URL(DIAGRAM_IMAGE_URL, window.location.origin).href;
    } catch (_) {
      return DIAGRAM_IMAGE_URL;
    }
  })();
  let diagramUrl = absDiagram;
  try {
    diagramUrl = await strokesToDataUrlAsync(strokes);
  } catch (_) {
    diagramUrl = absDiagram;
  }
  const diagramHtml = `<h2>Diagrama del vehículo</h2>
    <img class="diagram" src="${_esc(diagramUrl)}" alt="Diagrama de inspección"/>
    ${strokes.length ? '' : '<p class="muted">Sin marcas registradas.</p>'}`;

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"/>
<title>${_esc(fileTitle)}</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:Inter,Arial,sans-serif;margin:18px;color:#121212;font-size:12px;background:#f7f4ee}
  h1{font-size:20px;margin:0 0 2px;font-weight:700;text-transform:uppercase;letter-spacing:.02em}
  h2{font-size:11px;margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid #121212;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#121212}
  .meta{color:#6b6a64;margin-bottom:12px;font-size:11px;font-family:ui-monospace,monospace}
  .head{display:grid;grid-template-columns:1.2fr .8fr;gap:12px;margin-bottom:8px}
  .box{border:1px solid #121212;border-radius:0;padding:10px 12px;background:#fff}
  .box .row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .label{font-size:10px;color:#6b6a64;text-transform:uppercase;letter-spacing:.06em}
  .val{font-weight:600;font-size:13px;margin-top:2px}
  .io{width:100%;border-collapse:collapse;margin:8px 0 4px}
  .io th,.io td{border:1px solid #121212;padding:6px 8px;text-align:left;background:#fff}
  .io th{background:#ebe6db;font-size:10px;text-transform:uppercase}
  table.chk{width:100%;border-collapse:collapse;margin:4px 0}
  table.chk th,table.chk td{border:1px solid #121212;padding:5px 8px;background:#fff}
  table.chk th{background:#ebe6db;font-size:10px;text-transform:uppercase}
  .center{text-align:center;font-weight:700}
  .photos{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px}
  .ph{margin:0;border:1px solid #121212;border-radius:0;overflow:hidden;background:#111}
  .ph.dano{border-color:#c41212;border-width:2px}
  .ph img{width:100%;height:72px;object-fit:cover;display:block}
  .ph-empty{height:72px;display:grid;place-items:center;color:#94a3b8;font-size:10px;background:#1e293b}
  .ph figcaption{font-size:9px;padding:3px 5px;background:#fff;color:#3a3a38}
  .diagram{display:block;width:100%;max-width:460px;border:1px solid #121212;border-radius:0;margin:8px 0 12px;background:#fff}
  .firma{margin-top:12px;max-width:240px}
  .firma img{max-width:100%;border:1px solid #121212;border-radius:0;background:#fff}
  .footer{margin-top:20px;padding-top:10px;border-top:2px solid #121212;font-size:10px;color:#6b6a64}
  .muted{color:#6b6a64;font-size:11px}
  .no-print{margin-top:14px}
  .btn-print{padding:8px 18px;background:#121212;color:#f7f4ee;border:none;border-radius:0;cursor:pointer;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  @media print{body{margin:10mm}.no-print{display:none}.photos{grid-template-columns:repeat(4,1fr)}}
</style></head><body>
<div class="head">
  <div>
    <h1>Hoja de inspección — ${_esc(papeleta.mva || '')}</h1>
    <div class="meta">${_esc(id.companyName)} · ${_esc(papeleta.status)} · ${_esc(id.dateLabel)}</div>
  </div>
  <div class="box">
    <div class="label">Contrato</div>
    <div class="val">${_esc(papeleta.contrato || '—')}</div>
  </div>
</div>

<div class="box" style="margin-bottom:12px">
  <div class="row">
    <div><div class="label">Económico (MVA)</div><div class="val">${_esc(papeleta.mva || '—')}</div></div>
    <div><div class="label">Modelo</div><div class="val">${_esc(papeleta.modelo || '—')}</div></div>
    <div><div class="label">Placas</div><div class="val">${_esc(papeleta.placas || '—')}</div></div>
    <div><div class="label">Color</div><div class="val">${_esc(papeleta.color || '—')}</div></div>
    <div><div class="label">VIN</div><div class="val">${_esc(papeleta.vin || '—')}</div></div>
    <div><div class="label">Cliente</div><div class="val">${_esc(papeleta.clienteNombre || '—')}</div></div>
    <div><div class="label">Plaza</div><div class="val">${_esc(papeleta.plazaId || '—')}</div></div>
    <div><div class="label">Tapetes uso rudo</div><div class="val">${_esc(tapetes.usoRudo ?? '—')}</div></div>
    <div><div class="label">Tapetes alfombra</div><div class="val">${_esc(tapetes.alfombra ?? '—')}</div></div>
  </div>
</div>

<h2>Entrega / Out · Recibe / In</h2>
<table class="io">
  <thead><tr><th></th><th>Nombre</th><th>KM</th><th>Gas</th></tr></thead>
  <tbody>
    <tr>
      <th>Entrega / Out</th>
      <td>${_esc(papeleta.salida?.quienEntrega || '—')}</td>
      <td>${_esc(papeleta.salida?.km ?? '—')}</td>
      <td>${_esc(papeleta.salida?.gas || '—')}</td>
    </tr>
    <tr>
      <th>Recibe / In</th>
      <td>${_esc(papeleta.entrada?.quienRecibe || '—')}</td>
      <td>${_esc(papeleta.entrada?.km ?? '—')}</td>
      <td>${_esc(papeleta.entrada?.gas || '—')}</td>
    </tr>
  </tbody>
</table>

<h2>Checklist</h2>
<table class="chk"><thead><tr><th>Ítem</th><th>Estado</th></tr></thead><tbody>${checklistRows}</tbody></table>

<h2>Marca de llantas${marcas.marcarTodas ? ' (todas iguales)' : ''}</h2>
<table class="chk"><thead><tr><th>Posición</th><th>Marca</th></tr></thead><tbody>${llantasRows}</tbody></table>

<h2>Notas / interiores</h2>
<p>${_esc(papeleta.notasInteriores || papeleta.entrada?.notas || '—')}</p>

${diagramHtml}

<h2>Daños marcados (${zonasDano.length})</h2>
${zonasDano.length
    ? `<ul>${zonasDano.map((z) => {
      const n = papeleta.zonas[z.id];
      return `<li><b>${_esc(z.label)}</b>${n?.nota ? ` — ${_esc(n.nota)}` : ''}</li>`;
    }).join('')}</ul>`
    : '<p>Sin daños documentados.</p>'}

<h2>Fotos de salida</h2>
<div class="photos">${photosHtml}</div>

${firmaUrl ? `<div class="firma"><div class="label">Firma cliente</div><img src="${_esc(firmaUrl)}" alt="Firma"/></div>` : ''}
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
