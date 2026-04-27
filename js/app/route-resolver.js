// ═══════════════════════════════════════════════════════════
//  /js/app/route-resolver.js
//  Fuente única de verdad para el mapeo legacy ↔ App Shell.
//
//  Reglas:
//  - migrated: true  → navegar a appRoute dentro del shell
//  - migrated: false → navegar a fallbackRoute (legacy, recarga)
//  - Los query params se preservan en todas las funciones
//  - normalizePath: quita .html, quita trailing slash, deja query
// ═══════════════════════════════════════════════════════════

/** Tabla maestra: una entrada por módulo. */
export const ROUTE_MAP = {
  dashboard: {
    id: 'dashboard', label: 'Dashboard',
    legacyRoute:  '/home',
    appRoute:     '/app/dashboard',
    navRoute:     '/home',
    fallbackRoute:'/home',
    migrated: true,
  },
  profile: {
    id: 'profile', label: 'Mi perfil',
    legacyRoute:  '/profile',
    appRoute:     '/app/profile',
    navRoute:     '/profile',
    fallbackRoute:'/profile',
    migrated: true,
  },
  mensajes: {
    id: 'mensajes', label: 'Mensajes',
    legacyRoute:  '/mensajes',
    appRoute:     '/app/mensajes',
    navRoute:     '/mensajes',
    fallbackRoute:'/mensajes',
    migrated: true,
  },
  cola: {
    id: 'cola', label: 'Cola de preparación',
    legacyRoute:  '/cola-preparacion',
    appRoute:     '/app/cola-preparacion',
    navRoute:     '/cola-preparacion',
    fallbackRoute:'/cola-preparacion',
    migrated: true,
  },
  incidencias: {
    id: 'incidencias', label: 'Incidencias',
    legacyRoute:  '/incidencias',
    appRoute:     '/app/incidencias',
    navRoute:     '/incidencias',
    fallbackRoute:'/incidencias',
    migrated: true,
  },
  cuadre: {
    id: 'cuadre', label: 'Cuadre',
    legacyRoute:  '/cuadre',
    appRoute:     '/app/cuadre',
    navRoute:     '/cuadre',
    fallbackRoute:'/cuadre',
    migrated: true,
  },
  admin: {
    id: 'admin', label: 'Panel admin',
    legacyRoute:  '/gestion',
    appRoute:     '/app/admin',
    navRoute:     '/gestion',
    fallbackRoute:'/gestion',
    migrated: true,
  },
  programador: {
    id: 'programador', label: 'Consola técnica',
    legacyRoute:  '/programador',
    appRoute:     '/app/programador',
    navRoute:     '/programador',
    fallbackRoute:'/programador',
    migrated: true,
  },
  mapa: {
    id: 'mapa', label: 'Mapa operativo',
    legacyRoute:  '/mapa',
    appRoute:     '/app/mapa',
    navRoute:     '/mapa',
    fallbackRoute:'/mapa',
    migrated: false, // Módulo crítico — permanece en legacy
  },
};

// ── API pública ──────────────────────────────────────────────

/**
 * Normaliza un path: quita extensión .html, quita trailing slash.
 * Preserva query string y hash.
 *
 * @example
 *   normalizePath('/mensajes.html?tab=1') → '/mensajes?tab=1'
 *   normalizePath('/profile/')            → '/profile'
 */
export function normalizePath(path) {
  if (!path || typeof path !== 'string') return '/';
  const sepIdx = _tailIdx(path);
  const tail     = sepIdx !== -1 ? path.slice(sepIdx) : '';
  let   pathname = sepIdx !== -1 ? path.slice(0, sepIdx) : path;
  pathname = pathname.replace(/\.html$/i, '');
  if (pathname.length > 1) pathname = pathname.replace(/\/$/, '');
  return (pathname || '/') + tail;
}

/**
 * Devuelve la entrada ROUTE_MAP que corresponde al path dado,
 * buscando por legacyRoute o appRoute.
 * Retorna null si no hay entrada.
 */
export function resolveRoute(path) {
  const pathname = _pathname(normalizePath(path));
  return Object.values(ROUTE_MAP).find(r =>
    r.legacyRoute === pathname || r.appRoute === pathname
  ) ?? null;
}

/**
 * Convierte cualquier ruta (legacy o /app/*) a su equivalente /app/*.
 * Si migrated:false devuelve el fallbackRoute (legacy).
 * Preserva query string.
 */
export function toAppRoute(path) {
  const normalized = normalizePath(path);
  const tail       = _tail(normalized);
  const entry      = resolveRoute(path);
  if (!entry) return normalized;
  return (entry.migrated ? entry.appRoute : entry.fallbackRoute) + tail;
}

/**
 * Convierte cualquier ruta a su equivalente legacy.
 * Preserva query string.
 */
export function toLegacyRoute(path) {
  const normalized = normalizePath(path);
  const tail       = _tail(normalized);
  const entry      = resolveRoute(path);
  return entry ? entry.legacyRoute + tail : normalized;
}

/** ¿Es esta ruta conocida y migrada al App Shell? */
export function isMigratedRoute(path) {
  return resolveRoute(path)?.migrated === true;
}

/** ¿Es esta ruta una ruta /app/*? */
export function isAppRoute(path) {
  return typeof path === 'string' && normalizePath(path).startsWith('/app');
}

/**
 * Devuelve el navRoute para resaltar el ítem correcto del sidebar.
 * Fallback: el pathname normalizado.
 */
export function getNavRoute(path) {
  return resolveRoute(path)?.navRoute ?? _pathname(normalizePath(path));
}

/**
 * Devuelve el fallbackRoute seguro (destino legacy si la vista app falla).
 * Fallback: versión legacy del path.
 */
export function getFallbackRoute(path) {
  const entry = resolveRoute(path);
  if (entry) return entry.fallbackRoute;
  return toLegacyRoute(path);
}

// ── Helpers privados ─────────────────────────────────────────

function _tailIdx(path) {
  const q = path.indexOf('?');
  const h = path.indexOf('#');
  if (q === -1 && h === -1) return -1;
  if (q === -1) return h;
  if (h === -1) return q;
  return Math.min(q, h);
}

function _tail(normalized) {
  const idx = _tailIdx(normalized);
  return idx !== -1 ? normalized.slice(idx) : '';
}

function _pathname(normalized) {
  const idx = _tailIdx(normalized);
  return idx !== -1 ? normalized.slice(0, idx) : normalized;
}
