// ═══════════════════════════════════════════════════════════
//  /domain/mapa.model.js  —  Modelo de estructura del mapa
//  NO depende de Firebase. Lógica de negocio pura.
// ═══════════════════════════════════════════════════════════

/** Tipos de elemento válidos en la estructura del mapa. */
export const TIPOS_ELEMENTO = Object.freeze([
  'cajon',           // cajón normal
  'label',           // etiqueta de sección
  'camino',          // pasillo / camino
  'traslado',        // zona de unidades en tránsito
  'resguardo_temporal', // zona temporal
  'buffer',          // espacio libre reservado
]);

/**
 * Normaliza un elemento crudo de la estructura del mapa.
 * Garantiza campos mínimos requeridos para el render.
 */
export function normalizarElemento(raw = {}, index = 0) {
  return {
    valor:    String(raw.valor    ?? ''),
    tipo:     TIPOS_ELEMENTO.includes(raw.tipo) ? raw.tipo : 'cajon',
    esLabel:  raw.esLabel  === true,
    orden:    Number.isFinite(Number(raw.orden))  ? Number(raw.orden)  : index,
    x:        Number.isFinite(Number(raw.x))      ? Number(raw.x)      : 0,
    y:        Number.isFinite(Number(raw.y))      ? Number(raw.y)      : 0,
    width:    Number.isFinite(Number(raw.width))  ? Number(raw.width)  : 120,
    height:   Number.isFinite(Number(raw.height)) ? Number(raw.height) : 80,
    rotation: Number.isFinite(Number(raw.rotation))? Number(raw.rotation): 0,
    // Campos Fase 1.5 (extensión de estructura — vacíos por defecto)
    zone:              raw.zone              || null,
    subzone:           raw.subzone           || null,
    isReserved:        raw.isReserved        === true,
    isBlocked:         raw.isBlocked         === true,
    isTemporaryHolding:raw.isTemporaryHolding=== true,
    allowedCategories: Array.isArray(raw.allowedCategories) ? raw.allowedCategories : [],
    priority:          Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
    googleMapsUrl:     raw.googleMapsUrl     || null,
    pathType:          raw.pathType          || null,
  };
}

/** Retorna true si el elemento es un cajón ocupable (no label, no camino). */
export function esCajonOcupable(elemento) {
  return elemento.tipo === 'cajon' && !elemento.esLabel && !elemento.isBlocked;
}

/** Retorna true si la categoría está permitida en el cajón. */
export function categoriaPermitida(elemento, categoria) {
  if (!Array.isArray(elemento.allowedCategories) || elemento.allowedCategories.length === 0) return true;
  return elemento.allowedCategories
    .map(c => String(c).toUpperCase())
    .includes(String(categoria || '').toUpperCase());
}
