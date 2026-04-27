import { esGlobal } from '/domain/permissions.model.js';

const PROGRAMMER_ROLES = new Set(['PROGRAMADOR', 'JEFE_OPERACION', 'CORPORATIVO_USER']);

export function permissionOverride(profile, key) {
  const o = profile?.permissionOverrides;
  if (o && typeof o === 'object' && typeof o[key] === 'boolean') return o[key];
  return undefined;
}

/**
 * Alineado a `rolePermissionValue` en Cloud Functions (procesarSolicitudAcceso).
 */
export function rolePermissionFromConfig(role, permissionKey, security = {}) {
  const r = String(role || '').trim().toUpperCase();
  const configured = security?.roles?.[r];
  const configuredPermissions = configured?.permissions || {};
  if (configured?.fullAccess === true) return true;
  if (typeof configuredPermissions[permissionKey] === 'boolean') return configuredPermissions[permissionKey];
  if (PROGRAMMER_ROLES.has(r)) return true;
  if (permissionKey === 'process_access_requests' || permissionKey === 'manage_users' || permissionKey === 'assign_roles') {
    return r === 'CORPORATIVO_USER';
  }
  return false;
}

export function hasAppPermission(profile, role, permissionKey) {
  const ov = permissionOverride(profile, permissionKey);
  if (typeof ov === 'boolean') return ov;
  const security = window.MEX_CONFIG?.empresa?.security || {};
  return rolePermissionFromConfig(role, permissionKey, security);
}

/** Rechazar solo requiere `process_access_requests` (servidor igual). */
export function canRejectAccessRequest(profile, role) {
  return hasAppPermission(profile, role, 'process_access_requests');
}

/** Aprobar requiere también gestión de usuarios y asignación de roles en el servidor. */
export function canApproveAccessRequest(profile, role) {
  return hasAppPermission(profile, role, 'process_access_requests')
    && hasAppPermission(profile, role, 'manage_users')
    && hasAppPermission(profile, role, 'assign_roles');
}

export function canEditUsersBasics(profile, role) {
  return hasAppPermission(profile, role, 'manage_users');
}

export function canAssignPlazaAsGlobal(profile, role) {
  if (profile?.isGlobal === true) return true;
  return esGlobal(String(role || '').trim().toUpperCase());
}

const NO_PLAZA_ROLES = new Set(['CORPORATIVO_USER', 'PROGRAMADOR', 'JEFE_OPERACION']);

export function roleNeedsAssignedPlaza(roleKey) {
  const r = String(roleKey || '').trim().toUpperCase();
  return !NO_PLAZA_ROLES.has(r);
}

/**
 * Quién puede asignar ese rol al aprobar (aprox. canActorManageTargetRole en Functions).
 */
export function canAssignTargetRole(actorRole, targetRole) {
  const a = String(actorRole || '').trim().toUpperCase();
  const t = String(targetRole || '').trim().toUpperCase();
  if (!t) return false;
  if (a === 'PROGRAMADOR' || a === 'JEFE_OPERACION') return true;
  if (a !== 'CORPORATIVO_USER') return false;
  if (t === 'CORPORATIVO_USER' || t === 'PROGRAMADOR' || t === 'JEFE_OPERACION') return false;
  return true;
}
