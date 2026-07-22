/**
 * Datos / mutaciones de la sección Plazas (panel admin SPA).
 * Misma fuente de verdad que la config legacy: configuracion/empresa,
 * campos `plazas` (string[]) y `plazasDetalle` (array de objetos).
 */
import { db, registrarEventoGestion } from '/js/core/database.js';
import { getState } from '/js/app/app-state.js';
import { hasAppPermission } from '/js/app/features/admin/admin-permissions.js';
import {
  normalizarPlazaKey,
  validarPlazaKey,
  validarPlazaDetalle,
  normalizarPlazaDetalle
} from '/domain/plaza.model.js';

export function canEditPlazas(profile, role) {
  const r = String(role || '').trim().toUpperCase();
  if (r === 'PROGRAMADOR' || r === 'JEFE_OPERACION' || r === 'CORPORATIVO_USER') return true;
  return hasAppPermission(profile, role, 'manage_system_settings')
    || hasAppPermission(profile, role, 'manage_settings');
}

function _ensureEmpresa() {
  if (!window.MEX_CONFIG) window.MEX_CONFIG = {};
  if (!window.MEX_CONFIG.empresa || typeof window.MEX_CONFIG.empresa !== 'object') {
    window.MEX_CONFIG.empresa = {};
  }
  return window.MEX_CONFIG.empresa;
}

function _safeLower(v) { return String(v || '').trim().toLowerCase(); }
function _safeUpper(v) { return String(v || '').trim().toUpperCase(); }

function _actorDisplayName() {
  const profile = getState()?.profile || {};
  return String(profile.nombreCompleto || profile.nombre || profile.email || 'Sistema').trim() || 'Sistema';
}

/**
 * `correosInternos` en este doc tiene una forma dual heredada del legacy:
 * puede traer strings sueltos o { titulo, correo, plazaId }. Aquí SOLO lo
 * leemos/normalizamos para el selector de correos de Plazas — no se
 * reconcilia con la forma más simple que usa el panel Empresa (ver Global
 * Constraints del plan).
 */
function _correosInternosCatalog() {
  const emp = _ensureEmpresa();
  const normalized = [];
  const seen = new Map();
  const plazasDetalle = Array.isArray(emp.plazasDetalle) ? emp.plazasDetalle : [];
  const rawList = Array.isArray(emp.correosInternos) ? emp.correosInternos : [];

  function upsert(rawItem, fallback = {}) {
    const isObject = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem);
    const correo = _safeLower(isObject ? (rawItem.correo || rawItem.email || rawItem.mail) : rawItem);
    if (!correo) return;
    const next = {
      titulo: String(isObject ? (rawItem.titulo || rawItem.nombre || fallback.titulo || '') : (fallback.titulo || '')).trim(),
      correo,
      plazaId: _safeUpper(isObject ? rawItem.plazaId : fallback.plazaId)
    };
    if (seen.has(correo)) {
      const current = seen.get(correo);
      if (!current.titulo && next.titulo) current.titulo = next.titulo;
      if (!current.plazaId && next.plazaId) current.plazaId = next.plazaId;
      return;
    }
    seen.set(correo, next);
    normalized.push(next);
  }

  rawList.forEach(item => upsert(item));
  plazasDetalle.forEach(plaza => {
    const plazaId = _safeUpper(plaza?.id);
    if (plaza?.correo) upsert({ correo: plaza.correo, plazaId }, { titulo: `${plazaId} INSTITUCIONAL`, plazaId });
    if (plaza?.correoGerente) upsert({ correo: plaza.correoGerente, plazaId }, { titulo: `${plazaId} GERENCIA`, plazaId });
  });
  return normalized;
}

function _reassignCorreoCatalogForPlaza(plazaId, correo = '', correoGerente = '') {
  const currentPlaza = _safeUpper(plazaId);
  const selected = new Set([_safeLower(correo), _safeLower(correoGerente)].filter(Boolean));
  const catalog = _correosInternosCatalog();
  catalog.forEach(item => {
    if (_safeUpper(item.plazaId) === currentPlaza && !selected.has(item.correo)) item.plazaId = '';
    if (selected.has(item.correo)) item.plazaId = currentPlaza;
  });
  selected.forEach(correoSel => {
    if (catalog.some(item => item.correo === correoSel)) return;
    catalog.push({
      titulo: correoSel === _safeLower(correoGerente) ? `${currentPlaza} GERENCIA` : `${currentPlaza} INSTITUCIONAL`,
      correo: correoSel,
      plazaId: currentPlaza
    });
  });
  _ensureEmpresa().correosInternos = catalog;
}

function _releaseCorreoCatalogForPlaza(plazaId) {
  const currentPlaza = _safeUpper(plazaId);
  const catalog = _correosInternosCatalog();
  catalog.forEach(item => { if (_safeUpper(item.plazaId) === currentPlaza) item.plazaId = ''; });
  _ensureEmpresa().correosInternos = catalog;
}

/** Opciones para un <select> de correo institucional/gerente, ya resueltas (sin HTML). */
export function getCorreoOptions(selectedVal = '', currentPlazaId = '', fieldName = 'correo', plazaData = {}) {
  const currentPlaza = _safeUpper(currentPlazaId);
  const currentValue = _safeLower(selectedVal);
  const counterpartValue = _safeLower(fieldName === 'correo' ? plazaData?.correoGerente : plazaData?.correo);
  const catalog = _correosInternosCatalog();

  const disponibles = catalog.filter(item => {
    if (!item.correo) return false;
    if (currentValue && item.correo === currentValue) return true;
    if (counterpartValue && item.correo === counterpartValue) return false;
    return !item.plazaId || item.plazaId === currentPlaza;
  }).sort((a, b) => a.correo.localeCompare(b.correo, 'es'));

  const items = [...disponibles];
  if (currentValue && !items.some(item => item.correo === currentValue)) {
    items.unshift({
      titulo: fieldName === 'correoGerente' ? `${currentPlaza} GERENCIA` : `${currentPlaza} INSTITUCIONAL`,
      correo: currentValue,
      plazaId: currentPlaza
    });
  }
  return items.map(item => {
    const assigned = _safeUpper(item.plazaId);
    const suffix = assigned && assigned !== currentPlaza ? ` · ${assigned}` : '';
    const label = item.titulo ? `${item.titulo} · ${item.correo}${suffix}` : `${item.correo}${suffix}`;
    return { value: item.correo, label, selected: item.correo === currentValue };
  });
}

export function getPlazasSnapshot() {
  const emp = window.MEX_CONFIG?.empresa || {};
  const ids = Array.isArray(emp.plazas) ? emp.plazas.map(normalizarPlazaKey) : [];
  const detalles = Array.isArray(emp.plazasDetalle) ? emp.plazasDetalle : [];
  return ids
    .map(id => {
      const d = detalles.find(x => normalizarPlazaKey(x?.id) === id) || {};
      return { ...d, id };
    })
    .sort((a, b) => a.id.localeCompare(b.id, 'es'));
}

export function getPlazaDetalle(id) {
  const key = normalizarPlazaKey(id);
  return getPlazasSnapshot().find(p => p.id === key) || null;
}

async function _persist(actionType, message, successMessage, extra = {}) {
  const emp = _ensureEmpresa();
  await db.collection('configuracion').doc('empresa').set(emp, { merge: true });
  try {
    if (window.api?.garantizarPlazasOperativas) {
      await window.api.garantizarPlazasOperativas(emp.plazas || []);
    }
  } catch (err) {
    console.warn('[admin-plazas] garantizarPlazasOperativas:', err?.message || err);
  }
  try {
    await registrarEventoGestion(actionType, message, _actorDisplayName(), extra);
  } catch (err) {
    console.warn('[admin-plazas] audit log:', err?.message || err);
  }
  try {
    if (typeof window.__mexInvalidateConfigCache === 'function') window.__mexInvalidateConfigCache();
  } catch (_) { /* ignore */ }
  return successMessage;
}

export async function crearPlaza({ key, nombre = '', descripcion = '' } = {}) {
  const emp = _ensureEmpresa();
  const error = validarPlazaKey(key, emp.plazas || []);
  if (error) throw new Error(error);
  const id = normalizarPlazaKey(key);
  emp.plazas = [...(emp.plazas || []), id];
  emp.plazasDetalle = [...(emp.plazasDetalle || []), { id, nombre: String(nombre || '').trim(), descripcion: String(descripcion || '').trim() }];
  await _persist('PLAZA_CREADA', `Creó la plaza ${id}`, `Plaza "${id}" creada.`, { entidad: 'PLAZAS', referencia: id });
  return id;
}

export async function guardarPlaza(id, datosForm = {}) {
  const plazaId = normalizarPlazaKey(id);
  const error = validarPlazaDetalle(datosForm);
  if (error) throw new Error(error);
  const emp = _ensureEmpresa();
  const datos = normalizarPlazaDetalle(plazaId, datosForm);
  emp.plazasDetalle = Array.isArray(emp.plazasDetalle) ? emp.plazasDetalle : [];
  const idx = emp.plazasDetalle.findIndex(d => normalizarPlazaKey(d?.id) === plazaId);
  if (idx > -1) emp.plazasDetalle[idx] = datos;
  else emp.plazasDetalle.push(datos);
  _reassignCorreoCatalogForPlaza(plazaId, datos.correo, datos.correoGerente);
  await _persist('PLAZA_GUARDADA', `Actualizó la plaza ${plazaId}`, `Plaza ${plazaId} guardada.`, {
    entidad: 'PLAZAS', referencia: plazaId, correo: datos.correo || '', correoGerente: datos.correoGerente || ''
  });
  return datos;
}

export async function eliminarPlaza(id) {
  const plazaId = normalizarPlazaKey(id);
  const emp = _ensureEmpresa();
  emp.plazas = (emp.plazas || []).filter(p => normalizarPlazaKey(p) !== plazaId);
  emp.plazasDetalle = (emp.plazasDetalle || []).filter(d => normalizarPlazaKey(d?.id) !== plazaId);
  _releaseCorreoCatalogForPlaza(plazaId);
  await _persist('PLAZA_ELIMINADA', `Eliminó la plaza ${plazaId}`, `Plaza "${plazaId}" eliminada.`, { entidad: 'PLAZAS', referencia: plazaId });
}
