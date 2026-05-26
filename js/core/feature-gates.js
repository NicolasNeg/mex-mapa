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
    dashboard:           true,   // Si false → mapa es la pantalla de inicio
    estados_mapa:        true,   // Si false → modo simple sin estados operativos
    multi_plaza:         true,   // Dashboard global cross-plaza + RBAC regional
    api_access:          false,  // API REST de integración (Corporativo+)
    white_label:         false,  // White-label parcial (Corporativo+)
  });

  // Catálogo oficial de planes. Fuente única de verdad para features y límites.
  // Exportado como window.mexFeatures.PLANES para uso en UI y creación de empresas.
  const PLAN_CATALOG = Object.freeze({
    lite: Object.freeze({
      label:      'Mapa Lite',
      precio_mxn: 990,
      color:      '#475569',
      features: Object.freeze({
        mensajeria: false, alertas: false, cuadre: false,
        incidencias: false, cola_preparacion: false, reportes: false,
        auditoria: false, ia_placas: false, historial_logs: false,
        gestion_usuarios: false, solicitudes_acceso: false, edicion_mapa: false,
        exportar_excel: false, notificaciones_push: false, dashboard: false,
        estados_mapa: false, multi_plaza: false, api_access: false, white_label: false,
      }),
      limites: Object.freeze({ maxPlazas: 1, maxUsuarios: 3,  maxUnidades: -1, gps_refresh_sec: 300, historial_dias: 30  }),
    }),
    local: Object.freeze({
      label:      'Local',
      precio_mxn: 1990,
      color:      '#3b82f6',
      features: Object.freeze({
        mensajeria: true, alertas: true, cuadre: true,
        incidencias: true, cola_preparacion: true, reportes: true,
        auditoria: true, ia_placas: true, historial_logs: true,
        gestion_usuarios: true, solicitudes_acceso: true, edicion_mapa: true,
        exportar_excel: true, notificaciones_push: true, dashboard: true,
        estados_mapa: true, multi_plaza: false, api_access: false, white_label: false,
      }),
      limites: Object.freeze({ maxPlazas: 1, maxUsuarios: 25, maxUnidades: -1, gps_refresh_sec: 30,  historial_dias: 90  }),
    }),
    regional: Object.freeze({
      label:      'Regional',
      precio_mxn: 4490,
      color:      '#8b5cf6',
      features: Object.freeze({
        mensajeria: true, alertas: true, cuadre: true,
        incidencias: true, cola_preparacion: true, reportes: true,
        auditoria: true, ia_placas: true, historial_logs: true,
        gestion_usuarios: true, solicitudes_acceso: true, edicion_mapa: true,
        exportar_excel: true, notificaciones_push: true, dashboard: true,
        estados_mapa: true, multi_plaza: true, api_access: false, white_label: false,
      }),
      limites: Object.freeze({ maxPlazas: 3, maxUsuarios: 75, maxUnidades: -1, gps_refresh_sec: 30,  historial_dias: 90  }),
    }),
    corporativo: Object.freeze({
      label:      'Corporativo',
      precio_mxn: 9990,
      color:      '#10b981',
      features: Object.freeze({
        mensajeria: true, alertas: true, cuadre: true,
        incidencias: true, cola_preparacion: true, reportes: true,
        auditoria: true, ia_placas: true, historial_logs: true,
        gestion_usuarios: true, solicitudes_acceso: true, edicion_mapa: true,
        exportar_excel: true, notificaciones_push: true, dashboard: true,
        estados_mapa: true, multi_plaza: true, api_access: true, white_label: true,
      }),
      limites: Object.freeze({ maxPlazas: -1, maxUsuarios: -1, maxUnidades: -1, gps_refresh_sec: 10,  historial_dias: 365 }),
    }),
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
    PLANES:   PLAN_CATALOG,
  });

  // ── Per-empresa per-role permissions ────────────────────────────────────────
  // Mirrors domain/permissions.model.js DEFAULT_ROLE_PERMISSIONS.
  // fullAccess roles (PROGRAMADOR, JEFE_OPERACION, CORPORATIVO_USER) always return true.
  const _PERM_DEFAULTS = Object.freeze({
    AUXILIAR:     { view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:false, view_reportes:false, edit_mapa_layout:false, move_units:true, change_unit_state:true, manage_unit_info:false, view_cuadre_admin:false, edit_cuadre_admin:false, export_data:false, create_incidencia:true,  edit_incidencia:false, delete_incidencia:false, manage_users:false, manage_solicitudes:false, manage_fleet:false, emit_alerts:false, delete_alerts:false, manage_settings:false },
    VENTAS:       { view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:false, move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:false, export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:false, manage_users:false, manage_solicitudes:false, manage_fleet:false, emit_alerts:false, delete_alerts:false, manage_settings:false },
    SUPERVISOR:   { view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:false, move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:true,  export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:true,  manage_users:false, manage_solicitudes:false, manage_fleet:false, emit_alerts:true,  delete_alerts:false, manage_settings:false },
    JEFE_PATIO:   { view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:true,  move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:true,  export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:true,  manage_users:false, manage_solicitudes:true,  manage_fleet:true,  emit_alerts:true,  delete_alerts:true,  manage_settings:false },
    GERENTE_PLAZA:{ view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:true,  move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:true,  export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:true,  manage_users:true,  manage_solicitudes:true,  manage_fleet:true,  emit_alerts:true,  delete_alerts:true,  manage_settings:true  },
    JEFE_REGIONAL:{ view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:true,  move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:true,  export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:true,  manage_users:true,  manage_solicitudes:true,  manage_fleet:true,  emit_alerts:true,  delete_alerts:true,  manage_settings:true  },
  });

  const _FULL_ACCESS_ROLES = ['PROGRAMADOR', 'JEFE_OPERACION', 'CORPORATIVO_USER'];

  let _permRole = null;

  function _resolvedRole() {
    return _permRole
        || window.MEX_CONFIG?.profile?.rol
        || window._userProfile?.rol
        || 'AUXILIAR';
  }

  // Call this after login when the user's role is known.
  function permInit(rol) {
    _permRole = String(rol || '').trim().toUpperCase() || 'AUXILIAR';
  }

  function canDo(permission) {
    const empresa = window._empresaActual;
    if (!empresa) return true;
    if (empresa.isSuperAdminContext === true) return true;
    const rol = _resolvedRole();
    if (_FULL_ACCESS_ROLES.includes(rol)) return true;
    const defaults = _PERM_DEFAULTS[rol] || _PERM_DEFAULTS.AUXILIAR;
    const override = empresa.rolePermissions?.[rol];
    const key = String(permission);
    if (override && typeof override === 'object' && typeof override[key] === 'boolean') return override[key];
    return defaults[key] === true;
  }

  function getAllPerms() {
    const empresa = window._empresaActual;
    const rol = _resolvedRole();
    if (!empresa || empresa.isSuperAdminContext || _FULL_ACCESS_ROLES.includes(rol)) {
      return Object.fromEntries(Object.keys(_PERM_DEFAULTS.AUXILIAR).map(k => [k, true]));
    }
    const defaults = _PERM_DEFAULTS[rol] || _PERM_DEFAULTS.AUXILIAR;
    const override = empresa.rolePermissions?.[rol];
    if (!override || typeof override !== 'object') return { ...defaults };
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (typeof override[key] === 'boolean') result[key] = override[key];
    }
    return result;
  }

  window.mexPerms = Object.freeze({
    init: permInit,
    canDo,
    getAll: getAllPerms,
  });
})();
