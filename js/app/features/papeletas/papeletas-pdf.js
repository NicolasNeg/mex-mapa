import {
  buildExportFilename,
  exportFooterHtml,
  getExportIdentity,
} from '/js/core/export-signing.js';
import { exportMatrixCsv, exportMatrixXls } from '/js/core/export-menu.js';
import {
  ZONAS_V1,
  ZONAS_ALL,
  ZONAS_CORE,
  ZONA_CORE_LABELS,
  ZONA_TABLERO_ID,
  CHECKLIST_KEYS,
  CHECKLIST_LABELS,
  LLANTA_KEYS,
  LLANTA_LABELS,
  normalizeMarcasLlantas,
  normalizeTapetes,
  resolveZonaFotoPath,
} from '/domain/papeleta.model.js';
import { getDownloadUrl } from '/js/app/features/papeletas/papeletas-storage.js';
import { generarYAbrirPdf } from '/js/core/pdf-export.js';
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

function _zonaLabel(id) {
  return ZONA_CORE_LABELS[id]
    || ZONAS_ALL.find((z) => z.id === id)?.label
    || id;
}

/** Preferred photo order: core 7 → tablero → remaining with photo. */
function _photoZoneOrder(papeleta, fotos) {
  const seen = new Set();
  const out = [];
  const push = (id) => {
    if (!id || seen.has(id) || !fotos[id]) return;
    seen.add(id);
    out.push({ id, label: _zonaLabel(id) });
  };
  for (const id of ZONAS_CORE) push(id);
  push(ZONA_TABLERO_ID);
  for (const z of ZONAS_ALL) push(z.id);
  // Damage extras keyed only in fotos map
  for (const id of Object.keys(fotos || {})) push(id);
  void papeleta;
  return out;
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
  for (const z of ZONAS_ALL) {
    const path = resolveZonaFotoPath(papeleta.zonas || {}, z.id, papeleta);
    if (!path) continue;
    try {
      map[z.id] = await getDownloadUrl(path);
    } catch (_) { /* ignore */ }
  }
  return map;
}

/**
 * PDF v3 layout:
 * 1) Top info  2) Diagram large  3) Checklist 2-col + tapetes
 * 4) Full-page photos  5) Big firma + fecha
 * @param {object} papeleta
 * @param {{ firmaUrl?: string, fotoUrls?: Record<string,string> }} opts
 */
export async function openPapeletaPdf(papeleta, { firmaUrl = '', fotoUrls = null, docId = '' } = {}) {
  const fileTitle = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  const id = getExportIdentity();
  const fotos = fotoUrls || await _loadFotoMap(papeleta);
  const marcas = normalizeMarcasLlantas(papeleta);
  const tapetes = normalizeTapetes(papeleta);
  const notasTxt = String(papeleta.notasInteriores || papeleta.entrada?.notas || '').trim();
  const photoOrder = _photoZoneOrder(papeleta, fotos);
  const hasFotos = photoOrder.length > 0;
  const firmaMeta = papeleta.salida?.firma || {};
  const signedAt = firmaMeta.signedAt
    ? new Date(firmaMeta.signedAt).toLocaleString('es-MX')
    : id.dateLabel;

  const mid = Math.ceil(CHECKLIST_KEYS.length / 2);
  const chkLeft = CHECKLIST_KEYS.slice(0, mid);
  const chkRight = CHECKLIST_KEYS.slice(mid);
  const chkCell = (k) => {
    if (!k) return '<td></td><td></td>';
    const v = papeleta.checklist?.[k] || '';
    return `<td class="chk-item">${_esc(CHECKLIST_LABELS[k] || k)}</td><td class="center">${_esc(_checkLabel(v))}</td>`;
  };
  const checklistRows = Array.from({ length: mid }, (_, i) => {
    return `<tr>${chkCell(chkLeft[i])}${chkCell(chkRight[i])}</tr>`;
  }).join('');

  const tapetesRows = `
    <tr>
      <td class="chk-item">Tapetes uso rudo</td><td class="center">${_esc(tapetes.usoRudo ?? '—')}</td>
      <td class="chk-item">Tapetes alfombra</td><td class="center">${_esc(tapetes.alfombra ?? '—')}</td>
    </tr>`;

  const llantasHtml = `
    <div class="grid-4 llantas">
      ${LLANTA_KEYS.map((k) =>
        `<div class="cell"><span class="label">${_esc(LLANTA_LABELS[k])}</span><span class="val">${_esc(marcas[k] || '—')}</span></div>`
      ).join('')}
    </div>
    ${marcas.marcarTodas ? '<p class="muted">Marcas de llanta · todas iguales</p>' : ''}`;

  const photosHtml = hasFotos
    ? photoOrder.map((z) => {
      const url = fotos[z.id];
      const zona = papeleta.zonas?.[z.id];
      const dano = zona?.estado === 'dano';
      const nota = zona?.nota || '';
      return `<section class="ph-page">
        <figure class="ph-full${dano ? ' dano' : ''}">
          <img src="${_esc(url)}" alt="${_esc(z.label)}"/>
          <figcaption>
            <strong>${_esc(z.label)}</strong>
            ${dano ? '<span class="badge">Daño</span>' : ''}
            ${nota ? `<span class="nota">${_esc(nota)}</span>` : ''}
          </figcaption>
        </figure>
      </section>`;
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

  const danosList = danosMarcados.length
    ? `<ol class="dmg">${danosMarcados.map((d) =>
      `<li>#${_esc(d.displayNumber)} · ${_esc(d.damageType)} · ${_esc(d.severity)}${d.note ? ` — ${_esc(d.note)}` : ''}</li>`
    ).join('')}</ol>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"/>
<title>${_esc(fileTitle)}</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:Inter,Arial,sans-serif;margin:0;color:#0f172a;font-size:11px;line-height:1.35;background:#fff}
  .page{padding:10mm 10mm 8mm;max-width:210mm;margin:0 auto}
  h1{font-size:18px;margin:0 0 4px;font-weight:700;letter-spacing:.01em}
  h2{font-size:11px;margin:14px 0 8px;padding-bottom:4px;border-bottom:2px solid #0f172a;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  .meta{color:#64748b;margin-bottom:10px;font-size:10px;font-family:ui-monospace,monospace}
  .top{display:grid;grid-template-columns:1.2fr .8fr;gap:10px;margin-bottom:8px}
  .box{border:1.5px solid #0f172a;padding:8px 10px;background:#fff}
  .unit{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 12px}
  .label{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;display:block}
  .val{font-weight:700;font-size:13px;margin-top:1px}
  .io{width:100%;border-collapse:collapse;margin-top:8px}
  .io th,.io td{border:1px solid #0f172a;padding:5px 7px;text-align:left;font-size:11px}
  .io th{background:#f1f5f9;font-size:9px;text-transform:uppercase}
  .diagram-wrap{display:flex;justify-content:center;margin:6px 0 4px}
  .diagram{display:block;width:100%;max-width:420px;max-height:520px;object-fit:contain;border:1.5px solid #0f172a;background:#fff}
  table.chk{width:100%;border-collapse:collapse;margin:4px 0}
  table.chk th,table.chk td{border:1px solid #0f172a;padding:4px 6px;background:#fff;font-size:10.5px}
  table.chk th{background:#f1f5f9;font-size:9px;text-transform:uppercase}
  .chk-item{width:36%}
  .center{text-align:center;font-weight:700}
  .grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 10px;margin-top:8px}
  .llantas .val{font-size:12px}
  .dmg{margin:6px 0 0;padding-left:18px;font-size:10.5px}
  .notes{margin:4px 0 0;font-size:11px}
  .muted{color:#64748b;font-size:10px;margin:4px 0 0}
  .ph-page{page-break-before:always;padding:10mm;break-before:page}
  .ph-full{margin:0;border:1.5px solid #0f172a;background:#0f172a;min-height:70vh;display:flex;flex-direction:column}
  .ph-full.dano{border-color:#c41212;border-width:3px}
  .ph-full img{width:100%;flex:1 1 auto;max-height:78vh;object-fit:contain;display:block;background:#0f172a}
  .ph-full figcaption{background:#fff;padding:8px 10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px}
  .ph-full .badge{background:#fee2e2;color:#b91c1c;font-weight:700;padding:2px 8px;font-size:10px;text-transform:uppercase}
  .ph-full .nota{color:#475569}
  .firma-page{page-break-before:always;padding:14mm 12mm;break-before:page;min-height:70vh;display:flex;flex-direction:column;justify-content:center}
  .firma-block{border:2px solid #0f172a;padding:16px;max-width:520px;margin:0 auto;width:100%}
  .firma-block .label{font-size:11px;margin-bottom:8px}
  .firma-block img{display:block;width:100%;max-height:180px;object-fit:contain;border:1px solid #cbd5e1;background:#fff}
  .firma-meta{margin-top:14px;font-size:14px;font-weight:600}
  .firma-meta .big-date{font-size:18px;font-weight:700;margin-top:4px}
  .footer{margin-top:16px;padding-top:8px;border-top:1.5px solid #0f172a;font-size:9px;color:#64748b}
  .no-print{margin:12px 10mm}
  .btn-print{padding:8px 16px;background:#0f172a;color:#f8fafc;border:none;cursor:pointer;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  @media print{
    .no-print{display:none}
    .page{padding:8mm}
    .ph-page,.firma-page{padding:8mm}
    h2,.box,.diagram-wrap{break-inside:avoid}
  }
  @page{margin:6mm}
</style></head><body>
<div class="page">
  <div class="top">
    <div>
      <h1>Hoja de inspección — ${_esc(papeleta.mva || '')}</h1>
      <div class="meta">${_esc(id.companyName)} · ${_esc(papeleta.status)} · ${_esc(id.dateLabel)}</div>
      <div class="box unit">
        <div><span class="label">MVA</span><div class="val">${_esc(papeleta.mva || '—')}</div></div>
        <div><span class="label">Modelo</span><div class="val">${_esc(papeleta.modelo || '—')}</div></div>
        <div><span class="label">Placas</span><div class="val">${_esc(papeleta.placas || '—')}</div></div>
        <div><span class="label">Color</span><div class="val">${_esc(papeleta.color || '—')}</div></div>
        <div><span class="label">VIN</span><div class="val">${_esc(papeleta.vin || '—')}</div></div>
        <div><span class="label">Plaza</span><div class="val">${_esc(papeleta.plazaId || '—')}</div></div>
      </div>
    </div>
    <div class="box">
      <span class="label">Cliente</span>
      <div class="val">${_esc(papeleta.clienteNombre || '—')}</div>
      <span class="label" style="margin-top:8px">Contrato</span>
      <div class="val">${_esc(papeleta.contrato || '—')}</div>
      <table class="io">
        <thead><tr><th></th><th>Quién</th><th>KM</th><th>Gas</th></tr></thead>
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
    </div>
  </div>

  <h2>Diagrama de inspección</h2>
  <div class="diagram-wrap">
    <img class="diagram" src="${_esc(diagramUrl)}" alt="Diagrama de inspección"/>
  </div>
  ${danosList || '<p class="muted">Sin marcas tipadas en diagrama.</p>'}

  <h2>Checklist y tapetes</h2>
  <table class="chk">
    <thead><tr><th>Ítem</th><th></th><th>Ítem</th><th></th></tr></thead>
    <tbody>
      ${checklistRows}
      ${tapetesRows}
    </tbody>
  </table>
  <h2>Llantas</h2>
  ${llantasHtml}
  ${notasTxt ? `<h2>Notas</h2><p class="notes">${_esc(notasTxt)}</p>` : ''}

  <div class="footer">${exportFooterHtml({ escapeHtml: _esc })}</div>
</div>

${photosHtml}

<section class="firma-page">
  <div class="firma-block">
    <span class="label">Firma del cliente / receptor</span>
    ${firmaUrl
      ? `<img src="${_esc(firmaUrl)}" alt="Firma"/>`
      : '<p class="muted">Sin firma capturada.</p>'}
    <div class="firma-meta">
      <div>${_esc(firmaMeta.signerName || papeleta.clienteNombre || '—')}
        ${firmaMeta.signerRole ? ` · ${_esc(firmaMeta.signerRole)}` : ''}</div>
      <div class="big-date">${_esc(signedAt)}</div>
    </div>
  </div>
  <div class="page" style="padding-top:12px">
    <div class="footer">${exportFooterHtml({ escapeHtml: _esc })}</div>
  </div>
</section>

<div class="no-print"><button class="btn-print" type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<script>window.onload=function(){setTimeout(function(){window.print()},450)}</script>
</body></html>`;

  // generarYAbrirPdf ya dispara la descarga del archivo — no se abre pestaña.
  return await generarYAbrirPdf(html, { kind: 'papeleta', docId: docId || papeleta.id || '' });
}
