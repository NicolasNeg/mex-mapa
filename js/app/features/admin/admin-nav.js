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
export const ADMIN_NATIVE_SECTIONS = new Set(['usuarios']);

export function parseAdminRoute(path = '') {
  const clean = String(path || '').split('?')[0].replace(/\/$/, '') || '';
  const parts = clean.split('/').filter(Boolean);
  if (parts[0] !== 'app' || parts[1] !== 'admin') {
    return { section: 'usuarios', entityId: '' };
  }
  let section = String(parts[2] || 'usuarios').trim().toLowerCase() || 'usuarios';
  if (section === 'users') section = 'usuarios';
  const entityId = String(parts[3] || '').trim();
  return { section, entityId };
}

export function adminSectionPath(section = 'usuarios', entityId = '') {
  const sec = String(section || 'usuarios').trim().toLowerCase() || 'usuarios';
  const id = String(entityId || '').trim();
  if (!id) return `/app/admin/${sec}`;
  return `/app/admin/${sec}/${encodeURIComponent(id)}`;
}
