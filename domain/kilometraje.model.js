// domain/kilometraje.model.js — lógica pura de kilometraje (sin Firebase).
// OJO: api/cuadre.js lleva una copia privada de clasificarCaptura (_clasificarKm)
// porque los scripts clásicos no importan ES modules. Mantener en sincronía.

export const SALIDAS_LEGITIMAS = Object.freeze(['RETIRO_RENTA', 'TRASLADO_SALIDA']);

export function parseKm(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[,\s]/g, '').trim();
  if (!s || !/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 0 ? n : null;
}

export function clasificarCaptura({ kmNuevo, kmAnterior, umbral = 5, fuenteUltima = '', esCorreccion = false }) {
  if (typeof kmNuevo !== 'number' || !Number.isFinite(kmNuevo) || kmNuevo < 0) return { tipo: 'INVALIDO', delta: 0 };
  if (kmAnterior == null) return { tipo: 'NORMAL', delta: 0 };
  const delta = kmNuevo - kmAnterior;
  if (esCorreccion) return { tipo: 'CORRECCION', delta };
  if (delta < 0) return { tipo: 'RECHAZADO_MENOR', delta };
  if (delta <= umbral) return { tipo: 'NORMAL', delta };
  return SALIDAS_LEGITIMAS.includes(String(fuenteUltima).toUpperCase().trim())
    ? { tipo: 'NORMAL', delta }
    : { tipo: 'DISCREPANCIA', delta };
}
