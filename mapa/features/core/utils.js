// ═══════════════════════════════════════════════════════════
//  mapa/features/core/utils.js
//  Funciones utilitarias puras — sin dependencias de estado.
//  Extraídas de js/views/mapa.js Fase 4.
// ═══════════════════════════════════════════════════════════

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function _safeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

export function _safeLower(value) {
  return String(value || '').trim().toLowerCase();
}

export function _cloneJson(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
}

export function generarSlugArchivo(texto) {
  return String(texto || 'reporte')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'reporte';
}

export function descargarArchivoLocal(nombreArchivo, contenido, mimeType) {
  const blob = new Blob([contenido], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function _gasToPercent(val) {
  const n = parseFloat(String(val ?? '').replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n < 0) return null;
  if (n <= 1) return Math.round(n * 100);
  if (n <= 100) return Math.round(n);
  return null;
}

export function formatearFechaDocumento(fechaTexto) {
  if (!fechaTexto) return '';
  try {
    const d = new Date(fechaTexto + 'T12:00:00');
    if (isNaN(d.getTime())) return String(fechaTexto);
    return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (_) { return String(fechaTexto); }
}

export function _darken(hex, pct) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 0xff) - Math.round(255 * pct / 100)));
  const g = Math.max(0, Math.min(255, ((n >> 8)  & 0xff) - Math.round(255 * pct / 100)));
  const b = Math.max(0, Math.min(255, ((n)       & 0xff) - Math.round(255 * pct / 100)));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
