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
  // Opt-in semantics when empresa.features object exists:
  //   - boolean value → use it
  //   - key missing + empresa has features field → false (opt-in, must be explicitly enabled)
  //   - no features field at all → use FEATURES_DEFAULTS (backward compat for legacy empresas)
  function puedeUsar(feature) {
    const empresa = window._empresaActual;
    if (!empresa) return FEATURES_DEFAULTS[String(feature)] !== false;
    if (empresa.isSuperAdminContext === true) return true;
    const features = empresa.features;
    // No features field → legacy empresa, use system defaults
    if (features === undefined || features === null) {
      return FEATURES_DEFAULTS[String(feature)] !== false;
    }
    const val = features[String(feature)];
    if (typeof val === 'boolean') return val;
    // Key missing from features object → disabled (opt-in model)
    return false;
  }

  // Returns the merged feature map.
  function obtenerTodas() {
    const empresa = window._empresaActual;
    if (!empresa || empresa.isSuperAdminContext) return { ...FEATURES_DEFAULTS };
    const features = empresa.features;
    if (features === undefined || features === null) return { ...FEATURES_DEFAULTS };
    // Opt-in: start all false, apply empresa explicit values
    const result = {};
    for (const key of Object.keys(FEATURES_DEFAULTS)) {
      const val = features[key];
      result[key] = typeof val === 'boolean' ? val : false;
    }
    return result;
  }

  window.mexFeatures = Object.freeze({
    puedeUsar,
    obtenerTodas,
    DEFAULTS: FEATURES_DEFAULTS,
  });
})();
