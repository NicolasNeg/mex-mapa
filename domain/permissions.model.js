// ═══════════════════════════════════════════════════════════
//  /domain/permissions.model.js  —  Roles y permisos
//  NO depende de Firebase. Lógica de negocio pura.
// ═══════════════════════════════════════════════════════════

export const ROLES = Object.freeze({
  AUXILIAR:         { isAdmin: false, isGlobal: false, fullAccess: false },
  VENTAS:           { isAdmin: true,  isGlobal: false, fullAccess: false },
  SUPERVISOR:       { isAdmin: true,  isGlobal: false, fullAccess: false },
  JEFE_PATIO:       { isAdmin: true,  isGlobal: false, fullAccess: false },
  GERENTE_PLAZA:    { isAdmin: true,  isGlobal: false, fullAccess: false },
  JEFE_REGIONAL:    { isAdmin: true,  isGlobal: false, fullAccess: false },
  CORPORATIVO_USER: { isAdmin: true,  isGlobal: true,  fullAccess: true  },
  PROGRAMADOR:      { isAdmin: true,  isGlobal: true,  fullAccess: true  },
  JEFE_OPERACION:   { isAdmin: true,  isGlobal: true,  fullAccess: true  },
});

/** Retorna los metadatos del rol, o los de AUXILIAR si no existe. */
export function getRoleMeta(role) {
  const key = String(role || '').trim().toUpperCase();
  return ROLES[key] || ROLES.AUXILIAR;
}

/** Retorna true si el rol tiene acceso total (programador/corporativo/jefe_op). */
export function tieneAccesoTotal(role) {
  return getRoleMeta(role).fullAccess === true;
}

/** Retorna true si el rol es administrador de plaza (mínimo VENTAS). */
export function esAdmin(role) {
  return getRoleMeta(role).isAdmin === true;
}

/** Retorna true si el rol tiene alcance global (puede ver todas las plazas). */
export function esGlobal(role) {
  return getRoleMeta(role).isGlobal === true;
}

/** Retorna true si el usuario puede ver la plaza dada. */
export function puedeVerPlaza(usuario, plazaId) {
  if (esGlobal(usuario?.rol)) return true;
  if (!plazaId) return true;
  const plazaUp = String(plazaId).toUpperCase();
  // JEFE_REGIONAL puede tener plazasPermitidas[]
  if (Array.isArray(usuario?.plazasPermitidas)) {
    return usuario.plazasPermitidas.map(p => String(p).toUpperCase()).includes(plazaUp);
  }
  return String(usuario?.plazaAsignada || '').toUpperCase() === plazaUp;
}

// ── Per-empresa per-role permissions ────────────────────────────────────────

/** Canonical list of all controllable permission keys. */
export const PERMISSION_KEYS = Object.freeze([
  // Navigation
  'view_dashboard', 'view_mapa', 'view_cuadre', 'view_incidencias',
  'view_cola_preparacion', 'view_mensajes', 'view_alertas', 'view_admin', 'view_reportes',
  // Mapa operations
  'edit_mapa_layout', 'move_units', 'change_unit_state', 'manage_unit_info',
  // Cuadre
  'view_cuadre_admin', 'edit_cuadre_admin', 'export_data',
  // Incidencias
  'create_incidencia', 'edit_incidencia', 'delete_incidencia',
  // Admin
  'manage_users', 'manage_solicitudes', 'manage_fleet', 'manage_global_fleet',
  // Alertas
  'emit_alerts', 'delete_alerts',
  // Sistema
  'manage_settings', 'km_corregir', 'traslados_gestionar',
  // Turnos
  'view_turnos', 'manage_turnos',
  // Papeletas
  'view_papeletas', 'manage_papeletas_ventas',
]);

/**
 * Baseline role permissions that apply when a role has NOT been customized.
 * Overrides are stored in `configuracion/empresa.rolePermissions`.
 * PROGRAMADOR / JEFE_OPERACION / CORPORATIVO_USER always have full access
 * and are NOT included here — use tieneAccesoTotal() to check those.
 */
export const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  AUXILIAR: {
    view_dashboard: true,  view_mapa: true,   view_cuadre: true,  view_incidencias: true,
    view_cola_preparacion: true, view_mensajes: true, view_alertas: true,
    view_admin: false,     view_reportes: false,
    edit_mapa_layout: false, move_units: true, change_unit_state: true, manage_unit_info: false,
    view_cuadre_admin: false, edit_cuadre_admin: false, export_data: false,
    create_incidencia: true, edit_incidencia: false, delete_incidencia: false,
    manage_users: false, manage_solicitudes: false, manage_fleet: false, manage_global_fleet: false,
    emit_alerts: false, delete_alerts: false, manage_settings: false,
    km_corregir: false,
    traslados_gestionar: false,
    view_turnos: true, manage_turnos: false,
    view_papeletas: true, manage_papeletas_ventas: false,
  },
  VENTAS: {
    view_dashboard: true,  view_mapa: true,   view_cuadre: true,  view_incidencias: true,
    view_cola_preparacion: true, view_mensajes: true, view_alertas: true,
    view_admin: true,      view_reportes: true,
    edit_mapa_layout: false, move_units: true, change_unit_state: true, manage_unit_info: true,
    view_cuadre_admin: true, edit_cuadre_admin: false, export_data: true,
    create_incidencia: true, edit_incidencia: true, delete_incidencia: false,
    manage_users: false, manage_solicitudes: false, manage_fleet: false, manage_global_fleet: false,
    emit_alerts: false, delete_alerts: false, manage_settings: false,
    km_corregir: false,
    traslados_gestionar: true,
    view_turnos: true, manage_turnos: false,
    view_papeletas: true, manage_papeletas_ventas: true,
  },
  SUPERVISOR: {
    view_dashboard: true,  view_mapa: true,   view_cuadre: true,  view_incidencias: true,
    view_cola_preparacion: true, view_mensajes: true, view_alertas: true,
    view_admin: true,      view_reportes: true,
    edit_mapa_layout: false, move_units: true, change_unit_state: true, manage_unit_info: true,
    view_cuadre_admin: true, edit_cuadre_admin: true, export_data: true,
    create_incidencia: true, edit_incidencia: true, delete_incidencia: true,
    manage_users: false, manage_solicitudes: false, manage_fleet: false, manage_global_fleet: false,
    emit_alerts: true, delete_alerts: false, manage_settings: false,
    km_corregir: false,
    traslados_gestionar: true,
    view_turnos: true, manage_turnos: true,
    view_papeletas: true, manage_papeletas_ventas: true,
  },
  JEFE_PATIO: {
    view_dashboard: true,  view_mapa: true,   view_cuadre: true,  view_incidencias: true,
    view_cola_preparacion: true, view_mensajes: true, view_alertas: true,
    view_admin: true,      view_reportes: true,
    edit_mapa_layout: true, move_units: true, change_unit_state: true, manage_unit_info: true,
    view_cuadre_admin: true, edit_cuadre_admin: true, export_data: true,
    create_incidencia: true, edit_incidencia: true, delete_incidencia: true,
    manage_users: false, manage_solicitudes: true, manage_fleet: true, manage_global_fleet: false,
    emit_alerts: true, delete_alerts: true, manage_settings: false,
    km_corregir: false,
    traslados_gestionar: true,
    view_turnos: true, manage_turnos: true,
    view_papeletas: true, manage_papeletas_ventas: true,
  },
  GERENTE_PLAZA: {
    view_dashboard: true,  view_mapa: true,   view_cuadre: true,  view_incidencias: true,
    view_cola_preparacion: true, view_mensajes: true, view_alertas: true,
    view_admin: true,      view_reportes: true,
    edit_mapa_layout: true, move_units: true, change_unit_state: true, manage_unit_info: true,
    view_cuadre_admin: true, edit_cuadre_admin: true, export_data: true,
    create_incidencia: true, edit_incidencia: true, delete_incidencia: true,
    manage_users: true, manage_solicitudes: true, manage_fleet: true, manage_global_fleet: true,
    emit_alerts: true, delete_alerts: true, manage_settings: true,
    km_corregir: true,
    traslados_gestionar: true,
    view_turnos: true, manage_turnos: true,
    view_papeletas: true, manage_papeletas_ventas: true,
  },
  JEFE_REGIONAL: {
    view_dashboard: true,  view_mapa: true,   view_cuadre: true,  view_incidencias: true,
    view_cola_preparacion: true, view_mensajes: true, view_alertas: true,
    view_admin: true,      view_reportes: true,
    edit_mapa_layout: true, move_units: true, change_unit_state: true, manage_unit_info: true,
    view_cuadre_admin: true, edit_cuadre_admin: true, export_data: true,
    create_incidencia: true, edit_incidencia: true, delete_incidencia: true,
    manage_users: true, manage_solicitudes: true, manage_fleet: true, manage_global_fleet: true,
    emit_alerts: true, delete_alerts: true, manage_settings: true,
    km_corregir: true,
    traslados_gestionar: true,
    view_turnos: true, manage_turnos: true,
    view_papeletas: true, manage_papeletas_ventas: true,
  },
});

/**
 * Returns the effective permission map for a role in an empresa context.
 * fullAccess roles always get all permissions.
 * For other roles: DEFAULT_ROLE_PERMISSIONS[rol] merged with empresa.rolePermissions[rol].
 */
export function resolveRolePermissions(empresa, rol) {
  const meta = getRoleMeta(rol);
  if (meta.fullAccess) {
    return Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]));
  }
  const defaults = DEFAULT_ROLE_PERMISSIONS[rol] || DEFAULT_ROLE_PERMISSIONS.AUXILIAR;
  const override = empresa?.rolePermissions?.[rol];
  if (!override || typeof override !== 'object') return { ...defaults };
  const result = { ...defaults };
  for (const key of PERMISSION_KEYS) {
    if (typeof override[key] === 'boolean') result[key] = override[key];
  }
  return result;
}
