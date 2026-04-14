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
