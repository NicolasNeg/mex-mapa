import {
  buildExportFilename,
  exportFooterHtml,
  getExportIdentity,
} from '/js/core/export-signing.js';
import { exportMatrixCsv, exportMatrixXls } from '/js/core/export-menu.js';
import { ZONAS_V1, CHECKLIST_KEYS, CHECKLIST_LABELS } from '/domain/papeleta.model.js';

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Matriz plana de una papeleta para XLS/CSV. */
export function papeletaExportMatrix(papeleta) {
  const headers = ['Campo', 'Valor'];
  const rows = [
    ['MVA', papeleta.mva || ''],
    ['Estado', papeleta.status || ''],
    ['Modelo', papeleta.modelo || ''],
    ['Placas', papeleta.placas || ''],
    ['Color', papeleta.color || ''],
    ['VIN', papeleta.vin || ''],
    ['Cliente', papeleta.clienteNombre || ''],
    ['Plaza', papeleta.plazaId || ''],
    ['KM salida', papeleta.salida?.km ?? ''],
    ['Gas salida', papeleta.salida?.gas ?? ''],
    ['Quién entrega', papeleta.salida?.quienEntrega || ''],
    ['KM entrada', papeleta.entrada?.km ?? ''],
    ['Gas entrada', papeleta.entrada?.gas ?? ''],
    ['Quién recibe', papeleta.entrada?.quienRecibe || ''],
    ['Notas entrada', papeleta.entrada?.notas || ''],
  ];
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

/**
 * Abre ventana imprimible / PDF cliente (patrón turnos).
 * @param {object} papeleta
 * @param {{ firmaUrl?: string }} opts
 */
export function openPapeletaPdf(papeleta, { firmaUrl = '' } = {}) {
  const fileTitle = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  const id = getExportIdentity();
  const zonasDano = ZONAS_V1.filter((z) => papeleta.zonas?.[z.id]?.estado === 'dano');
  const checklistRows = CHECKLIST_KEYS.map((k) => {
    const v = papeleta.checklist?.[k] || '—';
    return `<tr><td>${_esc(CHECKLIST_LABELS[k] || k)}</td><td>${_esc(v)}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"/>
<title>${_esc(fileTitle)}</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:Inter,Arial,sans-serif;margin:24px;color:#0f172a;font-size:13px}
  h1{font-size:18px;margin:0 0 4px;font-weight:600}
  .meta{color:#64748b;margin-bottom:16px;font-size:12px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:16px}
  .label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
  .val{font-weight:500}
  table{width:100%;border-collapse:collapse;margin:12px 0}
  th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left}
  th{background:#f8fafc;font-size:11px}
  .firma{margin-top:20px;max-width:280px}
  .firma img{max-width:100%;border:1px solid #e2e8f0;border-radius:8px}
  .footer{margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b}
  .no-print{margin-top:16px}
  .btn-print{padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600}
  @media print{body{margin:12mm}.no-print{display:none}}
</style></head><body>
<h1>Papeleta digital — ${_esc(papeleta.mva || '')}</h1>
<div class="meta">${_esc(id.companyName)} · ${_esc(papeleta.status)} · ${_esc(id.dateLabel)}</div>
<div class="grid">
  <div><div class="label">Modelo</div><div class="val">${_esc(papeleta.modelo)}</div></div>
  <div><div class="label">Placas</div><div class="val">${_esc(papeleta.placas)}</div></div>
  <div><div class="label">Color</div><div class="val">${_esc(papeleta.color)}</div></div>
  <div><div class="label">VIN</div><div class="val">${_esc(papeleta.vin)}</div></div>
  <div><div class="label">Cliente</div><div class="val">${_esc(papeleta.clienteNombre || '—')}</div></div>
  <div><div class="label">Plaza</div><div class="val">${_esc(papeleta.plazaId)}</div></div>
  <div><div class="label">KM salida</div><div class="val">${_esc(papeleta.salida?.km ?? '—')}</div></div>
  <div><div class="label">Gas salida</div><div class="val">${_esc(papeleta.salida?.gas ?? '—')}</div></div>
  <div><div class="label">Quién entrega</div><div class="val">${_esc(papeleta.salida?.quienEntrega || '—')}</div></div>
</div>
<h2 style="font-size:14px;margin:16px 0 8px">Checklist</h2>
<table><thead><tr><th>Ítem</th><th>Estado</th></tr></thead><tbody>${checklistRows}</tbody></table>
<h2 style="font-size:14px;margin:16px 0 8px">Daños marcados (${zonasDano.length})</h2>
${zonasDano.length
    ? `<ul>${zonasDano.map((z) => {
      const n = papeleta.zonas[z.id];
      return `<li><b>${_esc(z.label)}</b>${n?.nota ? ` — ${_esc(n.nota)}` : ''}</li>`;
    }).join('')}</ul>`
    : '<p>Sin daños documentados.</p>'}
${firmaUrl ? `<div class="firma"><div class="label">Firma cliente</div><img src="${_esc(firmaUrl)}" alt="Firma"/></div>` : ''}
<div class="footer">${exportFooterHtml({ escapeHtml: _esc })}</div>
<div class="no-print"><button class="btn-print" type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) throw new Error('Permite ventanas emergentes para generar el PDF');
  w.document.open();
  w.document.write(html);
  w.document.close();
  return buildExportFilename('pdf');
}
