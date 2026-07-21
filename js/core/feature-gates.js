// Feature gates + permisos — producto single-tenant arrendadora.
// Sin planes: todas las features están habilitadas (window.mexFeatures).
// El sistema de permisos por rol (window.mexPerms) se conserva; los overrides
// se leen de MEX_CONFIG.empresa.rolePermissions (configuracion/empresa, que
// sigue siendo la config viva del tenant).
(function () {
  'use strict';

  // ── Features: sin planes, todo habilitado ───────────────────────────────────
  window.mexFeatures = {
    puedeUsar() { return true; },
    limite() { return -1; }, // sin límites
  };

  // ── Permisos por rol ─────────────────────────────────────────────────────────
  // Espeja domain/permissions.model.js DEFAULT_ROLE_PERMISSIONS.
  // Roles fullAccess (PROGRAMADOR, JEFE_OPERACION, CORPORATIVO_USER) → siempre true.
  const _PERM_DEFAULTS = Object.freeze({
    AUXILIAR:     { view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:false, view_reportes:false, edit_mapa_layout:false, move_units:true, change_unit_state:true, manage_unit_info:false, view_cuadre_admin:false, edit_cuadre_admin:false, export_data:false, create_incidencia:true,  edit_incidencia:false, delete_incidencia:false, manage_users:false, manage_solicitudes:false, manage_fleet:false, emit_alerts:false, delete_alerts:false, manage_settings:false, km_corregir:false, traslados_gestionar:false, view_turnos:true, manage_turnos:false, view_papeletas:true, manage_papeletas_ventas:false, create_reporte_dano:false },
    VENTAS:       { view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:false, move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:false, export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:false, manage_users:false, manage_solicitudes:false, manage_fleet:false, emit_alerts:false, delete_alerts:false, manage_settings:false, km_corregir:false, traslados_gestionar:true, view_turnos:true, manage_turnos:false, view_papeletas:true, manage_papeletas_ventas:true, create_reporte_dano:true },
    SUPERVISOR:   { view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:false, move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:true,  export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:true,  manage_users:false, manage_solicitudes:false, manage_fleet:false, emit_alerts:true,  delete_alerts:false, manage_settings:false, km_corregir:false, traslados_gestionar:true, view_turnos:true, manage_turnos:true, view_papeletas:true, manage_papeletas_ventas:true, create_reporte_dano:true },
    JEFE_PATIO:   { view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:true,  move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:true,  export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:true,  manage_users:false, manage_solicitudes:true,  manage_fleet:true,  emit_alerts:true,  delete_alerts:true,  manage_settings:false, km_corregir:false, traslados_gestionar:true, view_turnos:true, manage_turnos:true, view_papeletas:true, manage_papeletas_ventas:true, create_reporte_dano:true },
    GERENTE_PLAZA:{ view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:true,  move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:true,  export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:true,  manage_users:true,  manage_solicitudes:true,  manage_fleet:true,  emit_alerts:true,  delete_alerts:true,  manage_settings:true, km_corregir:true, traslados_gestionar:true, view_turnos:true, manage_turnos:true, view_papeletas:true, manage_papeletas_ventas:true, create_reporte_dano:true },
    JEFE_REGIONAL:{ view_dashboard:true,  view_mapa:true,  view_cuadre:true,  view_incidencias:true, view_cola_preparacion:true, view_mensajes:true, view_alertas:true, view_admin:true,  view_reportes:true,  edit_mapa_layout:true,  move_units:true, change_unit_state:true, manage_unit_info:true,  view_cuadre_admin:true,  edit_cuadre_admin:true,  export_data:true,  create_incidencia:true,  edit_incidencia:true,  delete_incidencia:true,  manage_users:true,  manage_solicitudes:true,  manage_fleet:true,  emit_alerts:true,  delete_alerts:true,  manage_settings:true, km_corregir:true, traslados_gestionar:true, view_turnos:true, manage_turnos:true, view_papeletas:true, manage_papeletas_ventas:true, create_reporte_dano:true },
  });

  const _FULL_ACCESS_ROLES = ['PROGRAMADOR', 'JEFE_OPERACION', 'CORPORATIVO_USER'];

  let _permRole = null;

  function _resolvedRole() {
    return _permRole
        || window.MEX_CONFIG?.profile?.rol
        || window._userProfile?.rol
        || 'AUXILIAR';
  }

  // Overrides de permisos por rol desde la config en la nube (configuracion/empresa).
  function _rolePermissions() {
    return window.MEX_CONFIG?.empresa?.rolePermissions || null;
  }

  // Llamar tras login cuando se conoce el rol del usuario.
  function permInit(rol) {
    _permRole = String(rol || '').trim().toUpperCase() || 'AUXILIAR';
  }

  function canDo(permission) {
    const rol = _resolvedRole();
    if (_FULL_ACCESS_ROLES.includes(rol)) return true;
    const defaults = _PERM_DEFAULTS[rol] || _PERM_DEFAULTS.AUXILIAR;
    const override = _rolePermissions()?.[rol];
    const key = String(permission);
    if (override && typeof override === 'object' && typeof override[key] === 'boolean') return override[key];
    return defaults[key] === true;
  }

  function getAllPerms() {
    const rol = _resolvedRole();
    if (_FULL_ACCESS_ROLES.includes(rol)) {
      return Object.fromEntries(Object.keys(_PERM_DEFAULTS.AUXILIAR).map(k => [k, true]));
    }
    const defaults = _PERM_DEFAULTS[rol] || _PERM_DEFAULTS.AUXILIAR;
    const override = _rolePermissions()?.[rol];
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
