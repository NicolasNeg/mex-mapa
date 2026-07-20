// ═══════════════════════════════════════════════════════════
//  export-menu.js — Chooser único: PDF · XLS · CSV
//  Regla de producto: todo botón "Exportar" ofrece estas 3 opciones.
// ═══════════════════════════════════════════════════════════

import {
  buildExportFilename,
  exportFooterHtml,
  exportExcelMetaHtml,
  exportExcelMetaRows,
  getExportIdentity,
} from '/js/core/export-signing.js';

const CSS_ATTR = 'data-mex-export-menu-css';

function _ensureCss() {
  if (document.querySelector(`style[${CSS_ATTR}]`)) return;
  const style = document.createElement('style');
  style.setAttribute(CSS_ATTR, '1');
  style.textContent = `
.mex-export-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:120;display:flex;align-items:flex-end;justify-content:center;padding:16px;box-sizing:border-box}
@media(min-width:640px){.mex-export-backdrop{align-items:center}}
.mex-export-sheet{width:min(420px,100%);background:var(--surface,#fff);color:var(--text,#0f172a);border-radius:16px 16px 12px 12px;padding:16px;box-shadow:0 20px 48px rgba(15,23,42,.28);font-family:Inter,system-ui,sans-serif}
body.dark-theme .mex-export-sheet{background:#111827;color:#e2e8f0;border:1px solid #1e293b}
.mex-export-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px}
.mex-export-head h2{margin:0;font-size:16px;font-weight:650}
.mex-export-sub{margin:0 0 14px;font-size:12px;color:var(--text-muted,#64748b);line-height:1.4}
.mex-export-close{border:none;background:transparent;width:36px;height:36px;border-radius:8px;cursor:pointer;color:inherit;display:inline-flex;align-items:center;justify-content:center}
.mex-export-close:hover{background:rgba(148,163,184,.16)}
.mex-export-opts{display:flex;flex-direction:column;gap:8px}
.mex-export-opt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:12px 14px;background:transparent;color:inherit;cursor:pointer;font:inherit;min-height:56px}
body.dark-theme .mex-export-opt{border-color:#334155}
.mex-export-opt:hover,.mex-export-opt:focus{border-color:#3b82f6;background:rgba(59,130,246,.06);outline:none}
.mex-export-opt .material-symbols-outlined,.mex-export-opt .material-icons{font-size:22px;color:#3b82f6}
.mex-export-opt strong{display:block;font-size:14px;font-weight:650}
.mex-export-opt small{display:block;font-size:11px;color:var(--text-muted,#64748b);margin-top:2px}
.mex-export-cancel{margin-top:12px;width:100%;min-height:44px;border:1px solid var(--border,#e2e8f0);border-radius:10px;background:transparent;color:inherit;font:600 13px Inter,sans-serif;cursor:pointer}
body.dark-theme .mex-export-cancel{border-color:#334155}
`;
  document.head.appendChild(style);
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Abre el chooser fijo: 1 PDF · 2 XLS · 3 CSV.
 * @param {{ title?: string, subtitle?: string, onPdf: Function, onXls: Function, onCsv: Function }} opts
 * @returns {Promise<'pdf'|'xls'|'csv'|null>}
 */
export function openExportChooser(opts = {}) {
  _ensureCss();
  const title = opts.title || 'Exportar';
  const subtitle = opts.subtitle || 'Elige el formato de descarga';
  return new Promise((resolve) => {
    const prev = document.querySelector('.mex-export-backdrop');
    if (prev) prev.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'mex-export-backdrop';
    backdrop.innerHTML = `
      <div class="mex-export-sheet" role="dialog" aria-modal="true" aria-label="${_esc(title)}">
        <div class="mex-export-head">
          <h2>${_esc(title)}</h2>
          <button type="button" class="mex-export-close" data-x="close" aria-label="Cerrar">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <p class="mex-export-sub">${_esc(subtitle)}</p>
        <div class="mex-export-opts">
          <button type="button" class="mex-export-opt" data-fmt="pdf">
            <span class="material-symbols-outlined">picture_as_pdf</span>
            <span><strong>1 · PDF</strong><small>Documento para imprimir o compartir</small></span>
          </button>
          <button type="button" class="mex-export-opt" data-fmt="xls">
            <span class="material-symbols-outlined">table_view</span>
            <span><strong>2 · XLS</strong><small>Excel / hoja de cálculo</small></span>
          </button>
          <button type="button" class="mex-export-opt" data-fmt="csv">
            <span class="material-symbols-outlined">csv</span>
            <span><strong>3 · CSV</strong><small>Datos simples para Excel u otros sistemas</small></span>
          </button>
        </div>
        <button type="button" class="mex-export-cancel" data-x="close">Cancelar</button>
      </div>`;

    const finish = (fmt) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(fmt);
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };

    backdrop.addEventListener('click', async (e) => {
      if (e.target === backdrop || e.target.closest('[data-x="close"]')) {
        finish(null);
        return;
      }
      const btn = e.target.closest('[data-fmt]');
      if (!btn) return;
      const fmt = btn.getAttribute('data-fmt');
      finish(fmt);
      try {
        if (fmt === 'pdf' && typeof opts.onPdf === 'function') await opts.onPdf();
        if (fmt === 'xls' && typeof opts.onXls === 'function') await opts.onXls();
        if (fmt === 'csv' && typeof opts.onCsv === 'function') await opts.onCsv();
      } catch (err) {
        console.error('[export-menu]', err);
        if (typeof window.mexAlert === 'function') {
          window.mexAlert('Exportar', err?.message || String(err));
        } else {
          alert(err?.message || String(err));
        }
      }
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
  });
}

export function downloadTextFile(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function _csvCell(v) {
  const text = String(v ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Exporta matriz (header + rows) a CSV firmado por nombre. */
export function exportMatrixCsv(headers, rows, { filename } = {}) {
  const lines = [
    headers.map(_csvCell).join(','),
    ...rows.map((r) => r.map(_csvCell).join(',')),
  ];
  const csv = '\ufeff' + lines.join('\n');
  downloadTextFile(filename || buildExportFilename('csv'), csv, 'text/csv;charset=utf-8');
}

/** Exporta matriz a .xls (HTML Excel) con meta de firma. */
export function exportMatrixXls(headers, rows, { title = 'Exportación', filename } = {}) {
  const esc = _esc;
  const body = rows.map((r) =>
    `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`
  ).join('');
  const html = `\ufeff<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8">
<style>table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px}th{background:#0f172a;color:#fff}</style>
</head><body>
<h2>${esc(title)}</h2>
${exportExcelMetaHtml(_esc)}
<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${body}</tbody></table>
</body></html>`;
  downloadTextFile(filename || buildExportFilename('xls'), html, 'application/vnd.ms-excel;charset=utf-8');
}

/** Abre PDF imprimible de una tabla (firma dentro del doc). */
export function exportMatrixPdf(headers, rows, { title = 'Exportación', subtitle = '' } = {}) {
  const id = getExportIdentity();
  const esc = _esc;
  const firma = exportFooterHtml({ escapeHtml: _esc });
  const fileTitle = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  const thead = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const tbody = rows.map((r) =>
    `<tr>${r.map((c) => `<td>${esc(c ?? '—')}</td>`).join('')}</tr>`
  ).join('');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>${esc(fileTitle)}</title>
<style>
body{font:12px/1.35 Inter,system-ui,sans-serif;color:#0f172a;margin:24px;background:#fff}
h1{font-size:18px;margin:0 0 4px}p{margin:0 0 14px;color:#64748b}
table{width:100%;border-collapse:collapse;font-size:10px}
th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:left;vertical-align:top}
th{background:#0f172a;color:#fff;font-weight:700}
tr:nth-child(even) td{background:#f8fafc}
@page{size:landscape;margin:12mm}
@media print{body{margin:12mm}}
</style></head><body>
<h1>${esc(title)}</h1>
<p>${esc(id.companyName)}${subtitle ? ` · ${esc(subtitle)}` : ''} · ${rows.length} registros · ${esc(id.dateYmd)}</p>
<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
${firma}
<script>window.onload=function(){setTimeout(function(){window.print()},200)}<\/script>
</body></html>`;
  const win = window.open('', '_blank');
  if (!win) throw new Error('Permite ventanas emergentes para exportar PDF');
  win.document.write(html);
  win.document.close();
}

export { buildExportFilename, exportExcelMetaRows, getExportIdentity };

/** Global para legacy (mapa.js / HTML onclick). */
export function installExportMenuGlobals(target = typeof window !== 'undefined' ? window : null) {
  if (!target) return;
  target.openExportChooser = openExportChooser;
  target.exportMatrixCsv = exportMatrixCsv;
  target.exportMatrixXls = exportMatrixXls;
  target.exportMatrixPdf = exportMatrixPdf;
}

if (typeof window !== 'undefined') {
  installExportMenuGlobals(window);
}
