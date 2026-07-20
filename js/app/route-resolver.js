// ═══════════════════════════════════════════════════════════
//  /js/app/route-resolver.js
//  Fuente única de verdad para el mapeo legacy ↔ App Shell.
//
//  Campos de estado por módulo:
//    shellIntegrated    — true si tiene vista propia en /app/*
//                         (sidebar navega dentro del shell, sin recarga)
//    fullModuleMigrated — true si la lógica operativa del módulo vive en App Shell.
//
//  Regla release: las rutas del menú deben operar en /app/*.
//
//  Reglas:
//    shellIntegrated:true  → isMigratedRoute devuelve true
//                          → toAppRoute devuelve appRoute
//    shellIntegrated:false → isMigratedRoute devuelve false
//                          → toAppRoute devuelve fallbackRoute (legacy)
//  Los query params se preservan en todas las funciones.
//  normalizePath: quita .html, quita trailing slash, conserva query.
// ═══════════════════════════════════════════════════════════

/** Tabla maestra: una entrada por módulo. */
export const ROUTE_MAP = {
  dashboard: {
    id: 'dashboard', label: 'Dashboard',
    legacyRoute:  '/home',
    appRoute:     '/app/dashboard',
    navRoute:     '/home',
    fallbackRoute:'/home',
    shellIntegrated:    true,
    fullModuleMigrated: true,
  },
  profile: {
    id: 'profile', label: 'Mi perfil',
    legacyRoute:  '/profile',
    appRoute:     '/app/profile',
    navRoute:     '/profile',
    fallbackRoute:'/profile',
    shellIntegrated:    true,
    fullModuleMigrated: true,
  },
  mensajes: {
    id: 'mensajes', label: 'Mensajes',
    legacyRoute:  '/mensajes',
    appRoute:     '/app/mensajes',
    navRoute:     '/mensajes',
    fallbackRoute:'/mensajes',
    shellIntegrated:    true,
    fullModuleMigrated: true,
    feature: 'mensajeria',
  },
  cola: {
    id: 'cola', label: 'Cola de preparación',
    legacyRoute:  '/cola-preparacion',
    appRoute:     '/app/cola-preparacion',
    navRoute:     '/cola-preparacion',
    fallbackRoute:'/cola-preparacion',
    shellIntegrated:    true,
    fullModuleMigrated: true,
    feature: 'cola_preparacion',
  },
  incidencias: {
    id: 'incidencias', label: 'Incidencias',
    legacyRoute:  '/incidencias',
    appRoute:     '/app/incidencias',
    navRoute:     '/incidencias',
    fallbackRoute:'/incidencias',
    shellIntegrated:    true,
    fullModuleMigrated: true,
    feature: 'incidencias',
  },
  cuadre: {
    id: 'cuadre', label: 'Cuadre',
    legacyRoute:  '/cuadre',
    appRoute:     '/app/cuadre',
    navRoute:     '/cuadre',
    fallbackRoute:'/cuadre',
    shellIntegrated:    true,
    fullModuleMigrated: true,
    feature: 'cuadre',
  },
  cuadrarFlota: {
    id: 'cuadrarFlota', label: 'Cuadrar flota',
    legacyRoute:  '/cuadrarflota',
    appRoute:     '/app/cuadrarflota',
    navRoute:     '/app/cuadrarflota',
    fallbackRoute:'/app/cuadrarflota',
    shellIntegrated:    true,
    fullModuleMigrated: true,
    feature: 'cuadre',
  },
  cuadrarFlotaVentas: {
    id: 'cuadrarFlotaVentas', label: 'Revisión de Ventas',
    legacyRoute:  '/app/cuadrarflota/ventas',
    appRoute:     '/app/cuadrarflota/ventas',
    navRoute:     '/app/cuadrarflota',
    fallbackRoute:'/app/cuadrarflota/ventas',
    shellIntegrated:    true,
    fullModuleMigrated: true,
    feature: 'cuadre',
  },
  traslados: {
    id: "traslados", label: "Traslados",
    legacyRoute:  "/traslados",
    appRoute:     "/app/traslados",
    navRoute:     "/app/traslados",
    fallbackRoute:"/app/traslados",
    shellIntegrated:    true,
    fullModuleMigrated: true,
  },
  unidades: {
    id: 'unidades', label: 'Unidades',
    legacyRoute:  '/unidades',
    appRoute:     '/app/unidades',
    navRoute:     '/app/unidades',
    fallbackRoute:'/app/unidades',
    shellIntegrated:    true,
    fullModuleMigrated: true,
  },
  unidadExpediente: {
    id: 'unidadExpediente', label: 'Expediente de unidad',
    legacyRoute:  '/cuadre',
    appRoute:     '/app/cuadre/u',
    navRoute:     '/app/unidades',
    fallbackRoute:'/app/unidades',
    shellIntegrated:    true,
    fullModuleMigrated: true,
  },
  admin: {
    id: 'admin', label: 'Panel admin',
    legacyRoute:  '/gestion',
    appRoute:     '/app/admin',
    navRoute:     '/app/admin',
    fallbackRoute:'/gestion',
    shellIntegrated:    true,
    fullModuleMigrated: true,
  },
  alertas: {
    id: 'alertas', label: 'Emitir alertas',
    legacyRoute:  '/alertas',
    appRoute:     '/app/alertas',
    navRoute:     '/app/alertas',
    fallbackRoute:'/app/alertas',
    shellIntegrated:    true,
    fullModuleMigrated: true,
    feature: 'alertas',
  },
  alertasHist: {
    id: 'alertasHist', label: 'Historial de alertas',
    legacyRoute:  '/historial-alertas',
    appRoute:     '/app/alertas/historial',
    navRoute:     '/app/alertas/historial',
    fallbackRoute:'/app/alertas/historial',
    shellIntegrated:    true,
    fullModuleMigrated: true,
    feature: 'alertas',
  },
  programador: {
    id: 'programador', label: 'Consola técnica',
    legacyRoute:  '/programador',
    appRoute:     '/app/programador',
    navRoute:     '/programador',
    fallbackRoute:'/programador',
    shellIntegrated:    true,
    fullModuleMigrated: true,
  },
  mapa: {
    id: 'mapa', label: 'Mapa operativo',
    legacyRoute:  '/mapa',
    appRoute:     '/app/mapa',
    navRoute:     '/mapa',
    fallbackRoute:'/mapa',
    shellIntegrated:    true,
    fullModuleMigrated: true,
  },
  editmap: {
    id: 'editmap', label: 'Configuración de mapa',
    legacyRoute:  '/editmap',
    appRoute:     '/app/editmap',
    navRoute:     '/editmap',
    fallbackRoute:'/editmap',
    shellIntegrated:    true,
    fullModuleMigrated: true,
  },
  historialOperativo: {
    id: 'historialOperativo', label: 'Historial de cambios',
    legacyRoute:   '/historial-operativo',
    appRoute:      '/app/historial-operativo',
    navRoute:      '/app/historial-operativo',
    fallbackRoute: '/app/historial-operativo',
    shellIntegrated:    true,
    fullModuleMigrated: true,
    feature: 'historial_logs',
  },
  turnos: {
    id: 'turnos', label: 'Turnos y horarios',
    legacyRoute:  '/app/turnos',
    appRoute:     '/app/turnos',
    navRoute:     '/app/turnos',
    fallbackRoute:'/app/turnos',
    shellIntegrated:    true,
    fullModuleMigrated: true,
  },
  papeletas: {
    id: 'papeletas', label: 'Papeletas',
    legacyRoute:  '/papeletas',
    appRoute:     '/app/papeletas',
    navRoute:     '/app/papeletas',
    fallbackRoute:'/app/papeletas',
    shellIntegrated:    true,
    fullModuleMigrated: true,
    feature: 'papeletas',
  },
};

function _dynamicAppRoute(pathname, tail = '') {
  const path = String(pathname || '');
  if (path.startsWith('/app/mensajes/')) return path + tail;
  if (path.startsWith('/mensajes/')) return '/app' + path + tail;
  if (path.startsWith('/app/editmap/')) return path + tail;
  if (path.startsWith('/editmap/')) return '/app' + path + tail;
  if (path.startsWith('/app/papeletas/')) return path + tail;
  if (path.startsWith('/papeletas/')) return '/app' + path + tail;
  return '';
}

function _dynamicRouteEntry(pathname) {
  let path = String(pathname || '');
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (!path) path = '/';
  if (path.startsWith('/app/mensajes/')) return ROUTE_MAP.mensajes;
  if (path.startsWith('/mensajes/')) return ROUTE_MAP.mensajes;
  if (path.startsWith('/app/editmap/')) return ROUTE_MAP.editmap;
  if (path.startsWith('/editmap/')) return ROUTE_MAP.editmap;
  if (path.startsWith('/app/papeletas/') || path === '/app/papeletas') return ROUTE_MAP.papeletas;
  if (path.startsWith('/papeletas/') || path === '/papeletas') return ROUTE_MAP.papeletas;
  return null;
}

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
  const dynamic = _dynamicRouteEntry(pathname);
  if (dynamic) return dynamic;
  return Object.values(ROUTE_MAP).find(r =>
    r.legacyRoute === pathname || r.appRoute === pathname
  ) ?? null;
}

/**
 * Convierte cualquier ruta (legacy o /app/*) a su equivalente /app/*.
 * Si shellIntegrated:false devuelve el fallbackRoute (legacy, con recarga).
 * Preserva query string.
 */
export function toAppRoute(path) {
  const normalized = normalizePath(path);
  const tail       = _tail(normalized);
  const pathname   = _pathname(normalized);
  const dynamicApp = _dynamicAppRoute(pathname, tail);
  if (dynamicApp) return dynamicApp;
  const entry      = resolveRoute(path);
  if (!entry) return normalized;
  return (entry.shellIntegrated ? entry.appRoute : entry.fallbackRoute) + tail;
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

/**
 * ¿Tiene esta ruta vista propia dentro del App Shell?
 * (Equivale a shellIntegrated:true — no implica que el módulo completo esté migrado.)
 */
export function isMigratedRoute(path) {
  return resolveRoute(path)?.shellIntegrated === true;
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
