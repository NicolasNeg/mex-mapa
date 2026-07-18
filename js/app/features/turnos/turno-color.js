// ═══════════════════════════════════════════════════════════
//  turno-color.js — port de ChecadorGLOBAL/turno-color.mjs
//  Color de turno: el elegido o uno estable de la paleta por id.
//  contraste() elige texto blanco/negro por luminancia WCAG.
// ═══════════════════════════════════════════════════════════

export const PALETA = Object.freeze([
  '#3B82F6', '#10B981', '#14B8A6', '#F59E0B', '#8B5CF6',
]);

/** Color de plantilla/turno: campo `color` o paleta estable por id. */
export function colorDeTurno(turno) {
  if (turno?.color) return String(turno.color);
  const id = turno?.id ?? 0;
  if (typeof id === 'number') {
    return PALETA[((id % PALETA.length) + PALETA.length) % PALETA.length];
  }
  // Hash simple de string id → índice estable
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return PALETA[((Math.abs(h) % PALETA.length) + PALETA.length) % PALETA.length];
}

/** Texto legible sobre `hex`. Umbral 0.5 sobre luminancia relativa sRGB. */
export function contraste(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#111111';
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return L > 0.5 ? '#111111' : '#ffffff';
}
