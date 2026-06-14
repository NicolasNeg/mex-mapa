// ═══════════════════════════════════════════════════════════
//  Config: Estacionamiento / Parking
//  Features: grid de cajones, entrada/salida, reservas.
// ═══════════════════════════════════════════════════════════
export default {
  tipoNegocio: 'estacionamiento',
  label: 'Estacionamiento',
  descripcion: 'Operacion centrada en cajones: entradas, salidas, reservas y movimientos desde el mapa.',

  dataScope: {
    tenant: 'empresaId',
    plaza: 'plaza',
    estructura: 'mapa_config/{empresaId}__{PLAZA}/estructura',
    unidades: ['cuadre', 'externos']
  },

  mapa: {
    mode: 'parking',
    route: '/app/mapa',
    primaryEntity: 'cajon',
    unitQueryParam: 'query',
    movementSource: 'parking_map',
    defaultLayoutProvider: 'buildEstacionamientoDefaultStructure',
    kpis: ['cajones', 'ocupados', 'libres', 'reservados', 'bloqueados', 'sin_cajon'],
    supports: {
      dragDrop: true,
      swap: true,
      filters: true,
      multiPlaza: true,
      plazaScopedLayout: true
    }
  },

  features: [
    '/mapa/features/estacionamiento/grid.js',
    '/mapa/features/estacionamiento/entrada-salida.js',
    '/mapa/features/estacionamiento/reservas.js',
  ],

  templates: [
    '/mapa/templates/mapa-core.html',
    '/mapa/templates/mapa-estacionamiento.html',
  ],

  requiredGates: [],

  preload: [],
};
