// ═══════════════════════════════════════════════════════════
// /js/core/pdf-export.js
// Genera un PDF server-side (Cloud Function generarYSubirPdf) a partir
// de un documento HTML completo y lo sube a Cloudinary. Reemplaza el
// patrón window.open + window.print() (nunca producía un archivo real).
// ═══════════════════════════════════════════════════════════
import { functions } from '/js/core/database.js';
import { buildExportFilename } from '/js/core/export-signing.js';

/**
 * Descarga el archivo en background y lo guarda vía un <a download> — no
 * abre pestaña ni depende de que el navegador respete Content-Disposition
 * al navegar directo a la URL (algunos bloquean esa navegación).
 */
export async function descargarPdf(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar el PDF (${response.status}).`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}

/**
 * @param {string} html documento HTML completo (doctype + head + body)
 * @param {{ kind?: 'cuadre'|'papeleta', docId?: string, onStatus?: (s: 'generando'|'listo'|'error') => void }} opts
 * @returns {Promise<string>} URL pública del PDF en Cloudinary (queda guardada para reabrir después)
 */
export async function generarYAbrirPdf(html, { kind = '', docId = '', onStatus } = {}) {
  onStatus?.('generando');
  const filename = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  try {
    const call = functions.httpsCallable('generarYSubirPdf');
    const { data } = await call({ kind, docId, html, filename });
    if (!data?.url) throw new Error('La Function no devolvió una URL.');
    await descargarPdf(data.url, `${filename}.pdf`);
    onStatus?.('listo');
    return data.url;
  } catch (error) {
    onStatus?.('error');
    throw error;
  }
}
