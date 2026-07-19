import { db } from '/js/core/database.js';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS, ROLES } from '/domain/permissions.model.js';

function _normUp(v) {
  return String(v || '').trim().toUpperCase();
}

function _label(roleKey = '') {
  return _normUp(roleKey).replace(/_/g, ' ');
}

const PERM_LABELS = {
  view_dashboard: 'Ver dashboard',
  view_mapa: 'Ver mapa',
  view_cuadre: 'Ver cuadre',
  view_incidencias: 'Ver incidencias',
  view_cola_preparacion: 'Ver cola',
  view_mensajes: 'Ver mensajes',
  view_alertas: 'Ver alertas',
  view_admin: 'Ver panel admin',
  view_reportes: 'Ver reportes',
  edit_mapa_layout: 'Editar layout mapa',
  move_units: 'Mover unidades',
  change_unit_state: 'Cambiar estado',
  manage_unit_info: 'Gestionar info unidad',
  view_cuadre_admin: 'Ver cuadre admin',
  edit_cuadre_admin: 'Editar cuadre admin',
  export_data: 'Exportar datos',
  create_incidencia: 'Crear incidencia',
  edit_incidencia: 'Editar incidencia',
  delete_incidencia: 'Eliminar incidencia',
  manage_users: 'Gestionar usuarios',
  manage_solicitudes: 'Gestionar solicitudes',
  manage_fleet: 'Gestionar flota',
  manage_global_fleet: 'Flota global',
  emit_alerts: 'Emitir alertas',
  delete_alerts: 'Eliminar alertas',
  manage_settings: 'Configuración',
  km_corregir: 'Corregir KM',
  traslados_gestionar: 'Gestionar traslados',
  view_turnos: 'Ver turnos',
  manage_turnos: 'Gestionar turnos',
  process_access_requests: 'Procesar solicitudes',
  assign_roles: 'Asignar roles',
  manage_roles_permissions: 'Editar roles/permisos',
  view_admin_roles: 'Ver roles'
};

export function listAdminRoles() {
  const security = window.MEX_CONFIG?.empresa?.security || {};
  const configured = security.roles && typeof security.roles === 'object' ? security.roles : {};
  const keys = new Set([
    ...Object.keys(ROLES),
    ...Object.keys(configured),
    ...Object.keys(DEFAULT_ROLE_PERMISSIONS)
  ]);

  return [...keys].map(raw => {
    const key = _normUp(raw);
    const info = configured[key] || configured[raw] || {};
    const base = ROLES[key] || {};
    const defaults = DEFAULT_ROLE_PERMISSIONS[key] || {};
    const permsObj = (info.permissions && typeof info.permissions === 'object')
      ? { ...defaults, ...info.permissions }
      : { ...defaults };
    const enabled = Object.entries(permsObj).filter(([, v]) => v === true).map(([k]) => k);
    return {
      key,
      name: String(info.label || info.nombre || _label(key)).trim() || _label(key),
      level: Number(info.level ?? info.nivel ?? 10) || 10,
      description: String(info.description || info.descripcion || '').trim(),
      fullAccess: info.fullAccess === true || base.fullAccess === true,
      isAdmin: info.isAdmin === true || base.isAdmin === true,
      needsPlaza: info.needsPlaza !== false && base.isGlobal !== true,
      multiPlaza: info.multiPlaza === true || base.isGlobal === true,
      permissions: permsObj,
      enabledPermissions: enabled
    };
  }).sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name, 'es'));
}

export function permissionCatalog() {
  const keys = new Set([...PERMISSION_KEYS, ...Object.keys(PERM_LABELS)]);
  return [...keys].map(key => ({
    key,
    label: PERM_LABELS[key] || key.replace(/_/g, ' ')
  })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export function canEditRoles(profile, role) {
  const r = String(role || '').toUpperCase();
  if (r === 'PROGRAMADOR' || r === 'JEFE_OPERACION' || r === 'CORPORATIVO_USER') return true;
  const ov = profile?.permissionOverrides;
  if (ov && typeof ov.manage_roles_permissions === 'boolean') return ov.manage_roles_permissions;
  const security = window.MEX_CONFIG?.empresa?.security || {};
  const configured = security?.roles?.[r];
  if (configured?.fullAccess === true) return true;
  if (typeof configured?.permissions?.manage_roles_permissions === 'boolean') {
    return configured.permissions.manage_roles_permissions;
  }
  return false;
}

/**
 * Persiste patch de un rol en configuracion/empresa (merge security.roles).
 */
export async function saveAdminRolePatch(roleKey, patch = {}, actorEmail = '') {
  const key = _normUp(roleKey);
  if (!key) throw new Error('Rol inválido.');
  if (!window.MEX_CONFIG) window.MEX_CONFIG = {};
  if (!window.MEX_CONFIG.empresa) window.MEX_CONFIG.empresa = {};
  if (!window.MEX_CONFIG.empresa.security) window.MEX_CONFIG.empresa.security = {};
  if (!window.MEX_CONFIG.empresa.security.roles) window.MEX_CONFIG.empresa.security.roles = {};

  const prev = window.MEX_CONFIG.empresa.security.roles[key] || {};
  const next = {
    ...prev,
    label: patch.name != null ? String(patch.name).trim() : (prev.label || _label(key)),
    level: patch.level != null ? Math.max(1, Math.min(99, Number(patch.level) || 10)) : (prev.level ?? 10),
    description: patch.description != null ? String(patch.description).trim() : (prev.description || ''),
    fullAccess: patch.fullAccess != null ? patch.fullAccess === true : (prev.fullAccess === true),
    isAdmin: patch.isAdmin != null ? patch.isAdmin === true : (prev.isAdmin === true),
    needsPlaza: patch.needsPlaza != null ? patch.needsPlaza === true : (prev.needsPlaza !== false),
    multiPlaza: patch.multiPlaza != null ? patch.multiPlaza === true : (prev.multiPlaza === true),
    permissions: patch.permissions && typeof patch.permissions === 'object'
      ? { ...(prev.permissions || {}), ...patch.permissions }
      : (prev.permissions || {})
  };
  window.MEX_CONFIG.empresa.security.roles[key] = next;

  // Dot-path update: evita pisar el resto de `security` con un merge superficial
  const payload = {
    [`security.roles.${key}`]: next,
    actualizadoPor: String(actorEmail || '').toLowerCase(),
    actualizadoAt: window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date().toISOString(),
    updatedFrom: 'app_admin_roles'
  };
  try {
    await db.collection('configuracion').doc('empresa').update(payload);
  } catch (_) {
    await db.collection('configuracion').doc('empresa').set(payload, { merge: true });
  }

  return next;
}
