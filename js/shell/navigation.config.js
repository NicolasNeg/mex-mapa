// ═══════════════════════════════════════════════════════════
//  /js/shell/navigation.config.js
//  Estructura de navegación global con filtrado por rol.
//  Usado por sidebar.js para construir el menú dinámicamente.
// ═══════════════════════════════════════════════════════════

import { adminRouteTitle } from '../app/features/admin/admin-nav.js';

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
        roles: '*',
        feature: 'dashboard'
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
        roles: '*',
        feature: 'mensajeria'
      },
      {
        id: 'cola',
        label: 'Cola de preparación',
        icon: 'format_list_bulleted',
        route: '/cola-preparacion',
        roles: '*',
        feature: 'cola_preparacion'
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
        roles: ['VENTAS', 'SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA', 'JEFE_REGIONAL', 'CORPORATIVO_USER', 'JEFE_OPERACION', 'PROGRAMADOR'],
        feature: 'cuadre'
      },
      {
        id: "traslados",
        label: "Traslados",
        icon: "local_shipping",
        route: "/app/traslados",
        roles: ["VENTAS", "SUPERVISOR", "JEFE_PATIO", "GERENTE_PLAZA", "JEFE_REGIONAL", "CORPORATIVO_USER", "JEFE_OPERACION", "PROGRAMADOR"]
      },
      {
        id: 'unidades',
        label: 'Unidades',
        icon: 'directions_car',
        route: '/app/unidades',
        roles: ['VENTAS', 'SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA', 'JEFE_REGIONAL', 'CORPORATIVO_USER', 'JEFE_OPERACION', 'PROGRAMADOR']
      },
      {
        id: 'incidencias',
        label: 'Notas e incidencias',
        icon: 'warning',
        route: '/incidencias',
        roles: '*',
        feature: 'incidencias'
      },
      {
        id: 'turnos',
        label: 'Turnos y horarios',
        icon: 'schedule',
        route: '/app/turnos',
        roles: '*',
        permission: 'view_turnos',
      },
      {
        id: 'historial-operativo',
        label: 'Historial de cambios',
        icon: 'history',
        route: '/app/historial-operativo',
        roles: ['SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA', 'JEFE_REGIONAL', 'CORPORATIVO_USER', 'JEFE_OPERACION', 'PROGRAMADOR'],
        feature: 'historial_logs',
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
        route: '/app/admin/usuarios',
        roles: ['SUPERVISOR', 'JEFE_PATIO', 'GERENTE_PLAZA', 'JEFE_REGIONAL', 'CORPORATIVO_USER', 'JEFE_OPERACION', 'PROGRAMADOR']
      }
    ]
  },
  {
    id: 'sistema',
    label: 'Sistema',
    items: [
      {
        id: 'configuracion',
        label: 'Configuración de mapa',
        icon: 'map',
        route: '/editmap',
        roles: ['CORPORATIVO_USER', 'JEFE_OPERACION', 'PROGRAMADOR']
      }
    ]
  }
];

/**
 * Filtra los grupos de navegación según el rol del usuario.
 * Elimina grupos que queden vacíos después del filtro.
 */
function _featureEnabled(feature) {
  return !feature || !window.mexFeatures || window.mexFeatures.puedeUsar(feature);
}

function _permissionEnabled(permission) {
  if (!permission) return true;
  if (!window.mexPerms?.canDo) return true;
  return window.mexPerms.canDo(permission) === true;
}

export function filterNavForRole(userRole) {
  return NAV_GROUPS
    .map(group => ({
      ...group,
      items: group.items
        .filter(item => hasNavAccess(userRole, item.roles))
        .filter(item => _featureEnabled(item.feature))
        .filter(item => _permissionEnabled(item.permission))
        .map(item => ({
          ...item,
          children: Array.isArray(item.children)
            ? item.children.filter(child => _featureEnabled(child.feature) && _permissionEnabled(child.permission))
            : item.children
        }))
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
  '/incidencias':       'Notas e incidencias',
  '/gestion':           'Panel administrativo',
  '/profile':           'Mi perfil',
  '/editmap':           'Editor de mapa',
  // App Shell — rutas /app/*
  '/app/dashboard':        'Dashboard',
  '/app/profile':          'Mi perfil',
  '/app/mensajes':         'Mensajes',
  '/app/cola-preparacion': 'Cola de preparación',
  '/app/incidencias':      'Notas e incidencias',
  '/app/unidades':         'Unidades',
  '/app/cuadre':           'Cuadre',
  '/app/cuadrarflota':     'Cuadrar flota',
  '/app/traslados':        'Traslados',
  '/app/admin':            'Panel admin',
  '/app/gestion':          'Invitaciones',
  '/app/admin/invitaciones': 'Invitaciones',
  '/app/alertas':          'Emitir alertas',
  '/app/alertas/historial':'Historial de alertas',
  '/app/mapa':             'Mapa operativo',
  '/app/editmap':          'Configuración de mapa',
  '/app/onboarding':       'Configuración inicial',
  '/app/turnos':                   'Turnos y horarios',
  '/app/historial-operativo':      'Historial de cambios',
  '/programador':                  'Programador',
  '/app/programador':              'Programador',
};

export function routeTitle(route = '') {
  const [path] = String(route).split('?');
  const normalized = path.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  if (ROUTE_TITLES[normalized]) return ROUTE_TITLES[normalized];
  // /app/admin/:section(/:id)? → label de ADMIN_NAV_GROUPS (Usuarios, Choferes, …)
  const adminTitle = adminRouteTitle(normalized);
  if (adminTitle) return adminTitle;
  return 'MAPA';
}
