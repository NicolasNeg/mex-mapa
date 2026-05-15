// Feature gates — SaaS multi-tenant feature control.
// Reads window._empresaActual.features; defaults to true when no empresa
// is loaded so existing behavior is fully backward-compatible.
(function () {
  'use strict';

  // Canonical list of all controllable features.
  // Add new features here; they default to enabled (true) unless the
  // empresa document explicitly sets them to false.
  const FEATURES_DEFAULTS = Object.freeze({
    mensajeria:          true,
    alertas:             true,
    cuadre:              true,
    incidencias:         true,
    cola_preparacion:    true,
    reportes:            true,
    auditoria:           true,
    ia_placas:           true,
    historial_logs:      true,
    gestion_usuarios:    true,
    solicitudes_acceso:  true,
    edicion_mapa:        true,
    exportar_excel:      true,
    notificaciones_push: true,
  });

  function getEmpresaFeatures() {
    const empresa = window._empresaActual;
    if (!empresa || typeof empresa.features !== 'object' || empresa.features === null) {
      return FEATURES_DEFAULTS;
    }
    // Superadmin context always has all features enabled.
    if (empresa.isSuperAdminContext === true) return FEATURES_DEFAULTS;
    return empresa.features;
  }

  // Returns true if the feature is enabled for the current empresa.
  // Undefined features default to true (forward-compatible for new features).
  function puedeUsar(feature) {
    return getEmpresaFeatures()[String(feature)] !== false;
  }

  // Returns the merged feature map: defaults overridden by empresa values.
  function obtenerTodas() {
    return Object.assign({}, FEATURES_DEFAULTS, getEmpresaFeatures());
  }

  window.mexFeatures = Object.freeze({
    puedeUsar,
    obtenerTodas,
    DEFAULTS: FEATURES_DEFAULTS,
  });
})();
