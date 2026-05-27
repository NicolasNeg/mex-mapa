// ═══════════════════════════════════════════════════════════
//  Config: Estacionamiento / Parking
//  Features: grid de cajones, entrada/salida, reservas.
// ═══════════════════════════════════════════════════════════
export default {
  tipoNegocio: 'estacionamiento',
  label: 'Estacionamiento',

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
