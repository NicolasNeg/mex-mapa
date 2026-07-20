// Re-exports + UI labels for papeletas feature
export {
  STATUS,
  ZONAS_V1,
  CHECKLIST_KEYS,
  CHECKLIST_LABELS,
} from '/domain/papeleta.model.js';

export const STATUS_LABELS = Object.freeze({
  borrador: 'En preparación',
  lista: 'Lista para entregar',
  entregada: 'Entregada',
  en_retorno: 'Ya regresó',
  cerrada_historial: 'Cerrada',
});

/** Etiquetas cortas para chips / mobile */
export const STATUS_LABELS_SHORT = Object.freeze({
  borrador: 'Preparando',
  lista: 'Lista',
  entregada: 'Entregada',
  en_retorno: 'Regresó',
  cerrada_historial: 'Cerrada',
});

export const REPORTE_STATUS = Object.freeze({
  ABIERTO: 'abierto',
  DESCARTADO: 'descartado',
  PROMOVIDO: 'promovido',
  CERRADO: 'cerrado',
  EXPIRADO: 'expirado',
});
