// ═══════════════════════════════════════════════════════════
//  /js/app/features/estados/estado-view-model.js
//  Re-exporta dominio de estados + helpers de UI para SPA.
// ═══════════════════════════════════════════════════════════

export {
  ESTADOS_FLOTA,
  ESTADOS_FLOTA_CERRADOS,
  ESTADOS_PATIO,
  ESTADOS_PATIO_ARRENDABLES,
  ESTADO_EXTERNO,
  ORDEN_ESTADOS,
  normalizarEstado,
  normalizarEstadoPatio,
  normalizarEstadoFlota,
  leerEstadoFlota,
  esFlotaCerrada,
  derivarFlotaDesdePatio,
  evaluarListoParaContrato,
  estaEnPatio,
  estaEnExterno
} from '/domain/estado.model.js';

import {
  ESTADOS_FLOTA,
  leerEstadoFlota,
  normalizarEstadoPatio,
  normalizarEstadoFlota,
  esFlotaCerrada,
  derivarFlotaDesdePatio,
  evaluarListoParaContrato
} from '/domain/estado.model.js';

/** Catálogo canónico para formularios de Unidades / expediente. */
export function estadosFlotaCatalog(currentVal = '') {
  const cur = normalizarEstadoFlota(currentVal) || String(currentVal || '').trim().toUpperCase();
  const set = new Set(ESTADOS_FLOTA);
  if (cur) set.add(cur);
  return [...set];
}

export function resolverEstadoFlota(doc = {}) {
  const flota = leerEstadoFlota(doc);
  const patio = normalizarEstadoPatio(doc.estadoPatio || doc.estadoCuadre || '');
  if (esFlotaCerrada(flota)) return flota;
  if (patio) return derivarFlotaDesdePatio(patio, flota) || flota;
  // Si `estado` del index ya es flota, usarlo; si parece patio, derivar.
  const raw = normalizarEstadoFlota(doc.estado) || null;
  if (raw) return raw;
  const asPatio = normalizarEstadoPatio(doc.estado);
  if (asPatio) return derivarFlotaDesdePatio(asPatio, null);
  return flota;
}

export function leerEstadoPatioDoc(doc = {}) {
  return normalizarEstadoPatio(doc.estadoPatio || doc.estadoCuadre || '')
    || (normalizarEstadoFlota(doc.estado) ? null : normalizarEstadoPatio(doc.estado));
}

/** Pre-chequeo contratos (API estable para features futuras). */
export function precheckContratoUnidad(unidad = {}) {
  return evaluarListoParaContrato({
    estadoFlota: resolverEstadoFlota(unidad),
    estadoPatio: leerEstadoPatioDoc(unidad),
    plazaActual: unidad.plazaActual || unidad.plaza || ''
  });
}
