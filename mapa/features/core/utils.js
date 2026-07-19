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
  if (val == null) return 0;
  const s = String(val).trim().toUpperCase();
  if (!s || s === 'N/A' || s === 'NA' || s === '-') return 0;
  if (/^(F|FULL|LLENO|LLENA)$/.test(s)) return 100;
  if (/^(H|HALF|MEDIO|MEDIA|1\/2)$/.test(s)) return 50;
  if (/^(E|EMPTY|VAC[IÍ]O|VAC[IÍ]A)$/.test(s)) return 0;
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const den = parseFloat(frac[2]);
    if (den > 0) {
      return Math.max(0, Math.min(100, Math.round((parseFloat(frac[1]) / den) * 100)));
    }
  }
  const n = parseFloat(s.replace('%', '').replace(',', '.'));
  if (!Number.isNaN(n)) {
    if (n > 0 && n <= 1 && !s.includes('/')) return Math.round(n * 100);
    return Math.max(0, Math.min(100, Math.round(n)));
  }
  return 0;
}

/** Color de relleno para barra de gasolina en admin/cuadre (verde → ámbar → rojo). */
export function _gasBarFillColor(pct) {
  const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  if (p > 60) return '#10b981';
  if (p > 30) return '#f59e0b';
  return '#ef4444';
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
