import { getState } from '/js/app/app-state.js';

function _norm(v) {
  return String(v || '').trim();
}

function _normUp(v) {
  return _norm(v).toUpperCase();
}

function _array(v) {
  return Array.isArray(v) ? v : [];
}

function _roleLabel(roleKey = '') {
  return _normUp(roleKey).replace(/_/g, ' ');
}

export async function getAdminMetaSnapshot() {
  const gs = getState();
  const plaza = _normUp(gs.currentPlaza || gs.profile?.plazaAsignada || gs.profile?.plaza);
  const cfgEmpresa = window.MEX_CONFIG?.empresa || {};
  const cfgListas = window.MEX_CONFIG?.listas || {};

  let runtimeListas = {};
  try {
    if (window.api?.obtenerConfiguracion && plaza) {
      const cfg = await window.api.obtenerConfiguracion(plaza);
      runtimeListas = cfg?.listas || {};
    }
  } catch (_) {}

  const listas = {
    estados: _array(runtimeListas.estados).length ? _array(runtimeListas.estados) : _array(cfgListas.estados),
    ubicaciones: _array(runtimeListas.ubicaciones).length ? _array(runtimeListas.ubicaciones) : _array(cfgListas.ubicaciones),
    categorias: _array(runtimeListas.categorias).length ? _array(runtimeListas.categorias) : _array(cfgListas.categorias),
    modelos: _array(runtimeListas.modelos).length ? _array(runtimeListas.modelos) : _array(cfgListas.modelos),
    gasolinas: _array(runtimeListas.gasolinas).length ? _array(runtimeListas.gasolinas) : _array(cfgListas.gasolinas)
  };

  const securityRoles = cfgEmpresa?.security?.roles || {};
  const roles = Object.keys(securityRoles).map(roleKey => {
    const info = securityRoles[roleKey] || {};
    const perms = Object.entries(info.permissions || {}).filter(([, v]) => v === true).map(([k]) => k);
    return {
      key: _normUp(roleKey),
      name: _roleLabel(roleKey),
      level: Number(info.level || info.nivel || 0) || 0,
      description: _norm(info.description || info.descripcion || ''),
      permissions: perms
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const plazasDetalle = _array(cfgEmpresa.plazasDetalle);
  const directPlazas = _array(cfgEmpresa.plazas).map(_normUp).filter(Boolean);
  const fromDetail = plazasDetalle.map(p => _normUp(p?.id)).filter(Boolean);
  const plazaIds = [...new Set([...directPlazas, ...fromDetail])];

  const plazas = plazaIds.map(id => {
    const detail = plazasDetalle.find(p => _normUp(p?.id) === id) || {};
    return {
      id,
      name: _norm(detail?.nombre || id),
      description: _norm(detail?.descripcion || ''),
      active: detail?.activa !== false
    };
  });

  const catalogs = [
    { id: 'estados', label: 'Estados', items: listas.estados.map(x => ({ name: _norm(x?.nombre || x), extra: _norm(x?.color || '') })) },
    { id: 'ubicaciones', label: 'Ubicaciones', items: listas.ubicaciones.map(x => ({ name: _norm(x?.nombre || x), extra: _norm(x?.plaza || '') })) },
    { id: 'categorias', label: 'Categorías', items: listas.categorias.map(x => ({ name: _norm(x?.nombre || x), extra: _norm(x?.descripcion || '') })) },
    { id: 'modelos', label: 'Modelos', items: listas.modelos.map(x => ({ name: _norm(x?.nombre || x), extra: _norm(x?.categoria || '') })) },
    { id: 'gasolinas', label: 'Gasolinas', items: listas.gasolinas.map(x => ({ name: _norm(x?.nombre || x), extra: _norm(x?.valor || '') })) }
  ];

  return { roles, plazas, catalogs };
}
