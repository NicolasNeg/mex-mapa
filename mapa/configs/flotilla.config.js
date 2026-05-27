// ═══════════════════════════════════════════════════════════
//  Config: Flotilla / Transporte
//  Features: tracker de ruta GPS, asignación, checklist.
// ═══════════════════════════════════════════════════════════
export default {
  tipoNegocio: 'flotilla',
  label: 'Flotilla',

  features: [
    '/mapa/features/flotilla/ruta-tracker.js',
    '/mapa/features/flotilla/asignacion.js',
    '/mapa/features/flotilla/checklist.js',
  ],

  templates: [
    '/mapa/templates/mapa-core.html',
    '/mapa/templates/mapa-flotilla.html',
  ],

  requiredGates: [],

  preload: [],
};
