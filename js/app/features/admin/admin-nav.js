/** Secciones del Centro Admin (sidebar CONTROLES). */

export const ADMIN_NAV_GROUPS = [
  {
    id: 'accesos',
    label: 'Accesos y permisos',
    items: [
      { id: 'usuarios', label: 'Usuarios', icon: 'manage_accounts', kind: 'listas' },
      { id: 'choferes', label: 'Choferes', icon: 'badge', kind: 'listas' },
      { id: 'roles', label: 'Roles', icon: 'verified_user', kind: 'listas' },
      { id: 'solicitudes', label: 'Solicitudes', icon: 'how_to_reg', kind: 'listas' }
    ]
  },
  {
    id: 'operacion',
    label: 'Operación',
    items: [
      { id: 'estados', label: 'Estados', icon: 'tune', kind: 'opciones' },
      { id: 'categorias', label: 'Categorías', icon: 'directions_car', kind: 'opciones' },
      { id: 'modelos', label: 'Modelos', icon: 'no_crash', kind: 'opciones' },
      { id: 'gasolinas', label: 'Gasolinas', icon: 'local_gas_station', kind: 'opciones' },
      { id: 'motivos_traslado', label: 'Motivos traslado', icon: 'route', kind: 'opciones' }
    ]
  },
  {
    id: 'estructura',
    label: 'Estructura',
    items: [
      { id: 'plazas', label: 'Plazas', icon: 'location_city', kind: 'opciones' },
      { id: 'ubicaciones', label: 'Ubicaciones', icon: 'place', kind: 'opciones' }
    ]
  },
  {
    id: 'organizacion',
    label: 'Organización',
    items: [
      { id: 'empresa', label: 'Empresa', icon: 'business', kind: 'aparte' }
    ]
  }
];

/** Secciones ya migradas a SPA nativa (sin iframe). */
export const ADMIN_NATIVE_SECTIONS = new Set([
  'usuarios',
  'choferes',
  'roles',
  'solicitudes',
  'estados',
  'categorias',
  'modelos',
  'gasolinas',
  'motivos_traslado'
]);

function _decodeSeg(raw = '') {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    return decodeURIComponent(s);
  } catch (_) {
    return s;
  }
}

export function parseAdminRoute(path = '') {
  const clean = String(path || '').split('?')[0].replace(/\/$/, '') || '';
  const parts = clean.split('/').filter(Boolean);
  if (parts[0] !== 'app' || parts[1] !== 'admin') {
    return { section: 'usuarios', entityId: '' };
  }
  let section = _decodeSeg(parts[2] || 'usuarios').toLowerCase() || 'usuarios';
  if (section === 'users') section = 'usuarios';
  // Emails llegan como angel%40… — hay que decodificar o no matchea el docId
  const entityId = _decodeSeg(parts[3] || '');
  return { section, entityId };
}

export function adminSectionPath(section = 'usuarios', entityId = '') {
  const sec = String(section || 'usuarios').trim().toLowerCase() || 'usuarios';
  const id = String(entityId || '').trim();
  if (!id) return `/app/admin/${sec}`;
  return `/app/admin/${sec}/${encodeURIComponent(id)}`;
}

/** Nav groups for global shell while in /app/admin/* */
export function getAdminShellNavGroups() {
  const groups = ADMIN_NAV_GROUPS.map(g => ({
    id: `adm-${g.id}`,
    label: g.label,
    items: g.items.map(item => ({
      id: `adm-${item.id}`,
      label: item.label,
      icon: item.icon,
      route: adminSectionPath(item.id),
      roles: '*'
    }))
  }));
  groups.push({
    id: 'adm-exit',
    label: 'Salir',
    items: [
      {
        id: 'adm-exit-panel',
        label: 'Salir del panel admin',
        icon: 'arrow_back',
        route: '/app/dashboard',
        roles: '*'
      }
    ]
  });
  return groups;
}

export function isAdminAppRoute(route = '') {
  const path = String(route || '').split('?')[0].replace(/\/$/, '') || '';
  return path === '/app/admin' || path.startsWith('/app/admin/') || path === '/gestion';
}

/** Label de sección admin (Usuarios, Choferes, …) o '' si no existe. */
export function adminSectionLabel(sectionId = '') {
  const id = String(sectionId || '').trim().toLowerCase();
  if (!id) return '';
  for (const group of ADMIN_NAV_GROUPS) {
    const item = group.items.find(i => i.id === id);
    if (item) return item.label;
  }
  return '';
}

/**
 * Título del header para rutas /app/admin/:section(/:id)?.
 * Bare /app/admin (o /gestion) → "Panel admin"; con sección → label del nav.
 */
export function adminRouteTitle(route = '') {
  const path = String(route || '').split('?')[0].replace(/\/+$/, '') || '';
  if (path === '/app/admin' || path === '/gestion') return 'Panel admin';
  if (!path.startsWith('/app/admin/')) return '';
  const { section } = parseAdminRoute(path);
  return adminSectionLabel(section) || 'Panel admin';
}
