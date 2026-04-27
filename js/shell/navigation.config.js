// ═══════════════════════════════════════════════════════════
//  /js/shell/navigation.config.js
//  Estructura de navegación global con filtrado por rol.
//  Usado por sidebar.js para construir el menú dinámicamente.
// ═══════════════════════════════════════════════════════════

// Jerarquía numérica para comparación de nivel mínimo
const ROLE_LEVEL = {
  AUXILIAR:       1,
  VENTAS:         2,
  SUPERVISOR:     3,
  JEFE_PATIO:     4,
  GERENTE_PLAZA:  5,
  JEFE_REGIONAL:  6,
  CORPORATIVO_USER: 7,
  JEFE_OPERACION: 8,
  PROGRAMADOR:    9
};

export const ROLE_LABELS = {
  AUXILIAR:       'Auxiliar',
  VENTAS:         'Ventas',
  SUPERVISOR:     'Supervisor',
  JEFE_PATIO:     'Jefe de Patio',
  GERENTE_PLAZA:  'Gerente de Plaza',
  JEFE_REGIONAL:  'Jefe Regional',
  CORPORATIVO_USER: 'Corporativo',
  JEFE_OPERACION: 'Jefe de Operación',
  PROGRAMADOR:    'Programador'
};

/**
 * Verifica si un rol tiene acceso a un item de navegación.
 * @param {string} userRole - Rol del usuario (ej. 'SUPERVISOR')
 * @param {string|string[]} required - '*' para todos, o array de roles permitidos
 */
export function hasNavAccess(userRole, required) {
  if (!required || required === '*') return true;
  const allowed = Array.isArray(required) ? required : [required];
  if (allowed.includes('*')) return true;
  if (allowed.includes(userRole)) return true;
  // Acceso por nivel mínimo (si se usa 'minLevel:SUPERVISOR' en el futuro)
  return false;
}

/**
 * Estructura completa de navegación.
 * Cada item puede tener:
 *  - id, label, icon, route   → campos básicos
 *  - roles: '*' | string[]    → control de visibilidad
 *  - badge: string            → etiqueta opcional
 *  - children: Item[]         → submenú
 */
export const NAV_GROUPS = [
  {
    id: 'principal',
    label: 'Principal',
    items: [
      {
        id: 'home',
        label: 'Dashboard',
        icon: 'home',
        route: '/home',
        roles: '*'
      },
      {
        id: 'mapa',
        label: 'Mapa operativo',
        icon: 'map',
        route: '/mapa',
        roles: '*'
      },
      {
        id: 'mensajes',
        label: 'Mensajes',
        icon: 'chat',
        route: '/mensajes',
        roles: '*'
      },
      {
        id: 'cola',
        label: 'Cola de preparación',
        icon: 'format_list_bulleted',
        route: '/cola-preparacion',
        roles: '*'
      }
    ]
  },
  {
    id: 'operacion',
    label: 'Operación',
    items: [
      {
        id: 'cuadre',
        label: 'Cuadre',
        icon: 'calculate',
        route: '/cuadre',
        roles: ['VENTAS', 'SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA', 'JEFE_REGIONAL', 'CORPORATIVO_USER', 'JEFE_OPERACION', 'PROGRAMADOR']
      },
      {
        id: 'incidencias',
        label: 'Incidencias',
        icon: 'warning',
        route: '/incidencias',
        roles: '*'
      },
      {
        id: 'gestion',
        label: 'Gestión',
        icon: 'manage_accounts',
        route: '/gestion',
        roles: ['SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA', 'JEFE_REGIONAL', 'CORPORATIVO_USER', 'JEFE_OPERACION', 'PROGRAMADOR']
      }
    ]
  },
  {
    id: 'admin',
    label: 'Administración',
    items: [
      {
        id: 'panel-admin',
        label: 'Panel admin',
        icon: 'admin_panel_settings',
        route: '/gestion',
        roles: ['SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA', 'JEFE_REGIONAL', 'CORPORATIVO_USER', 'JEFE_OPERACION', 'PROGRAMADOR'],
        children: [
          { id: 'usuarios',   label: 'Usuarios',   route: '/gestion?tab=usuarios',   icon: 'group' },
          { id: 'roles',      label: 'Roles',      route: '/gestion?tab=roles',      icon: 'shield' },
          { id: 'plazas',     label: 'Plazas',     route: '/gestion?tab=plazas',     icon: 'location_city' },
          { id: 'catalogos',  label: 'Catálogos',  route: '/gestion?tab=catalogos',  icon: 'list_alt' },
          { id: 'solicitudes',label: 'Solicitudes',route: '/gestion?tab=solicitudes',icon: 'assignment' }
        ]
      }
    ]
  },
  {
    id: 'sistema',
    label: 'Sistema',
    items: [
      {
        id: 'consola',
        label: 'Consola técnica',
        icon: 'terminal',
        route: '/programador',
        roles: ['PROGRAMADOR', 'JEFE_OPERACION']
      }
    ]
  }
];

/**
 * Filtra los grupos de navegación según el rol del usuario.
 * Elimina grupos que queden vacíos después del filtro.
 */
export function filterNavForRole(userRole) {
  return NAV_GROUPS
    .map(group => ({
      ...group,
      items: group.items
        .filter(item => hasNavAccess(userRole, item.roles))
        .map(item => ({ ...item }))
    }))
    .filter(group => group.items.length > 0);
}

/**
 * Títulos de página por ruta, usados por el header.
 */
export const ROUTE_TITLES = {
  '/home':              'Dashboard',
  '/mapa':              'Mapa operativo',
  '/mensajes':          'Mensajes',
  '/cola-preparacion':  'Cola de preparación',
  '/cuadre':            'Cuadre',
  '/incidencias':       'Incidencias',
  '/gestion':           'Panel administrativo',
  '/profile':           'Mi perfil',
  '/programador':       'Consola técnica',
  '/editmap':           'Editor de mapa',
  '/solicitud':         'Solicitud de acceso',
  // App Shell — rutas /app/*
  '/app/dashboard':        'Dashboard',
  '/app/profile':          'Mi perfil',
  '/app/mensajes':         'Mensajes',
  '/app/cola-preparacion': 'Cola de preparación',
  '/app/incidencias':      'Incidencias',
  '/app/cuadre':           'Cuadre',
  '/app/admin':            'Panel admin',
  '/app/programador':      'Consola técnica',
};

export function routeTitle(route = '') {
  const [path] = String(route).split('?');
  const normalized = path.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  return ROUTE_TITLES[normalized] || 'MAPA';
}
