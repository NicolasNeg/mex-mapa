// ═══════════════════════════════════════════════════════════
//  /domain/mapa.model.js  —  Modelo de estructura del mapa
//  NO depende de Firebase. Lógica de negocio pura.
// ═══════════════════════════════════════════════════════════

/** Tipos de elemento válidos en la estructura del mapa. */
export const TIPOS_ELEMENTO = Object.freeze([
  'cajon', // cajón / spot operativo
  'label', // etiqueta de sección
  'camino',
  'traslado',
  'resguardo_temporal',
  'buffer',
  // Editor extendido (parque / mesas / albercas) — no ocupan celdas de flota salvo `cajon`
  'area',
  'mesa',
  'pool',
  'chapoteadero',
  'water_area',
  'zona_acuatica',
  'zona_reservable',
  'servicio',
  'entrada',
  'palapa',
  'marker',
  'forma_rect',
  'forma_line'
]);

/**
 * Normaliza un elemento crudo de la estructura del mapa.
 * Garantiza campos mínimos requeridos para el render.
 */
function _meta(raw) {
  if (!raw || typeof raw.metadata !== 'object' || raw.metadata === null) return null;
  try {
    return JSON.parse(JSON.stringify(raw.metadata));
  } catch (_) {
    return null;
  }
}

export function normalizarElemento(raw = {}, index = 0) {
  const tipoRaw = String(raw.tipo || '').trim();
  const tipo = TIPOS_ELEMENTO.includes(tipoRaw) ? tipoRaw : 'cajon';
  return {
    id: String(raw.id || '').trim() || null,
    valor: String(raw.valor ?? ''),
    tipo,
    esLabel: raw.esLabel === true,
    orden: Number.isFinite(Number(raw.orden)) ? Number(raw.orden) : index,
    x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : 0,
    y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : 0,
    width: Number.isFinite(Number(raw.width)) ? Number(raw.width) : 120,
    height: Number.isFinite(Number(raw.height)) ? Number(raw.height) : 80,
    rotation: Number.isFinite(Number(raw.rotation)) ? Number(raw.rotation) : 0,
    zone: raw.zone || null,
    subzone: raw.subzone || null,
    isReserved: raw.isReserved === true,
    isBlocked: raw.isBlocked === true,
    isTemporaryHolding: raw.isTemporaryHolding === true,
    allowedCategories: Array.isArray(raw.allowedCategories) ? raw.allowedCategories : [],
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
    googleMapsUrl: raw.googleMapsUrl || null,
    pathType: raw.pathType || null,
    metadata: _meta(raw),
    nombrePublico: String(raw.nombrePublico ?? '').trim() || null,
    descripcionPublica: String(raw.descripcionPublica ?? '').trim() || null,
    capacidad: Number.isFinite(Number(raw.capacidad)) ? Number(raw.capacidad) : null,
    precioBase: Number.isFinite(Number(raw.precioBase)) ? Number(raw.precioBase) : null,
    vip: raw.vip === true,
    reservable: raw.reservable !== false,
    poolTipo: String(raw.poolTipo ?? '').trim() || null,
    spotEstado: String(raw.spotEstado ?? '').trim() || null,
    fill: String(raw.fill ?? '').trim() || null,
    stroke: String(raw.stroke ?? '').trim() || null,
    hidden: raw.hidden === true,
    locked: raw.locked === true
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
