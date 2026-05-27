// ═══════════════════════════════════════════════════════════
//  Config: Arrendadora / Renta de Vehículos
//  Features: drag-drop, panel flota, estados, ocupación.
// ═══════════════════════════════════════════════════════════
export default {
  tipoNegocio: 'arrendadora',
  label: 'Arrendadora',

  features: [
    '/mapa/features/arrendadora/drag-drop.js',
    '/mapa/features/arrendadora/unit-panel.js',
    '/mapa/features/arrendadora/estados.js',
    '/mapa/features/arrendadora/ocupacion.js',
  ],

  templates: [
    '/mapa/templates/mapa-core.html',
    '/mapa/templates/mapa-arrendadora.html',
  ],

  requiredGates: [],

  preload: [
    '/mapa/features/extras/pdf-reports.js',
  ],
};
