// ═══════════════════════════════════════════════════════════
// /js/core/pdf-export.js
// Genera un PDF server-side (Cloud Function generarYSubirPdf) a partir
// de un documento HTML completo y lo sube a Cloudinary. Reemplaza el
// patrón window.open + window.print() (nunca producía un archivo real).
// ═══════════════════════════════════════════════════════════
import { functions } from '/js/core/database.js';
import { buildExportFilename } from '/js/core/export-signing.js';

/**
 * @param {string} html documento HTML completo (doctype + head + body)
 * @param {{ kind?: 'cuadre'|'papeleta', docId?: string, onStatus?: (s: 'generando'|'listo'|'error') => void }} opts
 * @returns {Promise<string>} URL pública del PDF en Cloudinary
 */
export async function generarYAbrirPdf(html, { kind = '', docId = '', onStatus } = {}) {
  onStatus?.('generando');
  const filename = buildExportFilename('pdf').replace(/\.pdf$/i, '');
  try {
    const call = functions.httpsCallable('generarYSubirPdf');
    const { data } = await call({ kind, docId, html, filename });
    if (!data?.url) throw new Error('La Function no devolvió una URL.');
    onStatus?.('listo');
    return data.url;
  } catch (error) {
    onStatus?.('error');
    throw error;
  }
}
