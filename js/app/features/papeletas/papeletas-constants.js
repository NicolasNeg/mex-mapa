// Re-exports + UI labels for papeletas feature
export {
  STATUS,
  ZONAS_V1,
  CHECKLIST_KEYS,
  CHECKLIST_LABELS,
} from '/domain/papeleta.model.js';

export const STATUS_LABELS = Object.freeze({
  borrador: 'Borrador',
  lista: 'Lista',
  entregada: 'Entregada',
  en_retorno: 'En retorno',
  cerrada_historial: 'Historial',
});

export const REPORTE_STATUS = Object.freeze({
  ABIERTO: 'abierto',
  DESCARTADO: 'descartado',
  PROMOVIDO: 'promovido',
  CERRADO: 'cerrado',
  EXPIRADO: 'expirado',
});
