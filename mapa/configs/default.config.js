// ═══════════════════════════════════════════════════════════
//  Config: default (sin tipoNegocio definido)
//  Activa todos los features genéricos, ninguno específico.
// ═══════════════════════════════════════════════════════════
export default {
  tipoNegocio: 'default',
  label: 'Genérico',

  // Módulos de feature a cargar (paths absolutos)
  features: [],

  // Templates HTML a inyectar en el stage (paths absolutos)
  templates: ['/mapa/templates/mapa-core.html'],

  // Features gate requeridos para este tipo (todos deben estar activos)
  requiredGates: [],

  // Preload: módulos a pre-importar en idle (no bloquean mount)
  preload: [],
};
