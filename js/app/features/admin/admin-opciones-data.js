/**
 * Catálogos OPCIONES (estados, categorías, modelos, gasolinas, motivos, ubicaciones).
 * Persistencia vía window.api.guardarConfiguracionListas + MEX_CONFIG.listas.
 */
import { hasAppPermission } from '/js/app/features/admin/admin-permissions.js';
export const OPCIONES_SECTIONS = new Set([
  'estados',
  'categorias',
  'modelos',
  'gasolinas',
  'motivos_traslado',
  'ubicaciones'
]);

export function canEditOpciones(profile, role) {
  const r = String(role || '').trim().toUpperCase();
  if (r === 'PROGRAMADOR' || r === 'JEFE_OPERACION' || r === 'CORPORATIVO_USER') return true;
  return hasAppPermission(profile, role, 'manage_system_settings')
    || hasAppPermission(profile, role, 'manage_settings');
}

export function catalogDisplayName(section, item) {
  if (item == null) return '';
  const tab = String(section || '').toLowerCase();
  if (typeof item !== 'object') return String(item || '').trim();
  if (tab === 'estados') return String(item.id || item.nombre || '').trim();
  if (tab === 'gasolinas') return String(item.nombre || item.id || item.valor || '').trim();
  if (tab === 'motivos_traslado') {
    return String(item.nombre || item.etiqueta || item.codigo || item.id || '').trim();
  }
  if (tab === 'modelos') return String(item.nombre || item.id || '').trim();
  if (tab === 'categorias') return String(item.nombre || item.id || '').trim();
  if (tab === 'ubicaciones') return String(item.nombre || item.id || item).trim();
  return String(item.nombre || item.id || '').trim();
}

export function catalogEntityKey(section, item) {
  return catalogDisplayName(section, item).toUpperCase();
}

function _orderValue(item, index = 0) {
  const raw = typeof item === 'object' ? Number(item.orden) : 0;
  return Number.isFinite(raw) && raw > 0 ? raw : (Number(index) + 1);
}

function _applyOrder(list = []) {
  list.forEach((item, index) => {
    if (item && typeof item === 'object') item.orden = index + 1;
  });
  return list;
}

function _moveToOrder(list, fromIndex, desiredOrder) {
  if (!Array.isArray(list) || fromIndex < 0 || fromIndex >= list.length) return list;
  const total = list.length;
  const target = Math.min(Math.max(Math.round(Number(desiredOrder) || (fromIndex + 1)), 1), total) - 1;
  if (target === fromIndex) {
    _applyOrder(list);
    return list;
  }
  const [item] = list.splice(fromIndex, 1);
  list.splice(target, 0, item);
  _applyOrder(list);
  return list;
}

export function getCatalogList(section) {
  const key = String(section || '').toLowerCase();
  if (!OPCIONES_SECTIONS.has(key)) return [];
  const raw = window.MEX_CONFIG?.listas?.[key];
  const list = Array.isArray(raw) ? raw.slice() : [];
  return list
    .map((item, index) => {
      const name = catalogDisplayName(key, item);
      const entityKey = catalogEntityKey(key, item);
      // Ítems vacíos / corruptos: key estable para no romper el acordeón ni colisionar.
      const safeKey = entityKey || `__ITEM_${index + 1}`;
      const safeName = name || `(Sin nombre ${index + 1})`;
      return {
        index,
        key: safeKey,
        name: safeName,
        orden: _orderValue(item, index),
        raw: item,
        broken: !entityKey
      };
    })
    .sort((a, b) => (a.orden - b.orden) || a.name.localeCompare(b.name, 'es'));
}

export function findCatalogItem(section, entityId = '') {
  const want = String(entityId || '').trim().toUpperCase();
  if (!want || want === 'NUEVO') return null;
  return getCatalogList(section).find(row => String(row.key || '').toUpperCase() === want) || null;
}

export function categoryOptions() {
  return getCatalogList('categorias').map(r => r.name).filter(Boolean);
}

export function plazaOptionsForUbicaciones() {
  const plazas = (window.MEX_CONFIG?.empresa?.plazas || [])
    .map(p => String(p || '').trim().toUpperCase())
    .filter(Boolean);
  return ['ALL', ...plazas];
}

/** Sube imagen de modelo a Cloudinary (solo archivo local). */
export async function uploadModelImage(file) {
  if (!file) throw new Error('Selecciona una imagen.');
  const type = String(file.type || '');
  if (!type.startsWith('image/')) throw new Error('Solo se permiten imágenes desde tu equipo.');
  const { uploadMedia } = await import('/js/core/media-upload.js');
  const result = await uploadMedia({
    folder: 'catalogo_modelos',
    file,
    publicId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    resourceType: 'image',
  });
  return result.url;
}

function _buildItem(section, fields = {}, fallbackOrder = 1) {
  const name = String(fields.nombre || fields.id || '').trim().toUpperCase();
  if (!name) throw new Error('Escribe un nombre.');
  const orden = Math.max(1, Math.round(Number(fields.orden) || fallbackOrder) || fallbackOrder);
  const tab = String(section || '').toLowerCase();

  if (tab === 'estados') {
    return {
      item: {
        id: name,
        color: String(fields.color || '#64748b').trim() || '#64748b',
        orden
      },
      key: name,
      orden
    };
  }
  if (tab === 'categorias') {
    return {
      item: {
        nombre: name,
        descripcion: String(fields.descripcion || '').trim(),
        orden
      },
      key: name,
      orden
    };
  }
  if (tab === 'modelos') {
    const out = {
      nombre: name,
      categoria: String(fields.categoria || '').trim().toUpperCase(),
      orden
    };
    const img = String(fields.imagenURL || '').trim();
    if (img) out.imagenURL = img;
    return { item: out, key: name, orden };
  }
  if (tab === 'gasolinas') {
    // Compat: algunos tenants guardan string simple
    if (fields.asString === true) {
      return { item: name, key: name, orden };
    }
    return {
      item: { nombre: name, valor: name, orden },
      key: name,
      orden
    };
  }
  if (tab === 'motivos_traslado') {
    const rawCode = String(fields.codigo || name);
    const code = rawCode
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 18) || name.slice(0, 18);
    return {
      item: {
        codigo: code,
        nombre: name,
        etiqueta: String(fields.etiqueta || fields.nombre || name).trim(),
        descripcion: String(fields.descripcion || '').trim(),
        orden,
        activo: fields.activo !== false
      },
      key: name,
      orden
    };
  }
  if (tab === 'ubicaciones') {
    return {
      item: {
        nombre: name,
        isPlazaFija: fields.isPlazaFija === true,
        plazaId: String(fields.plazaId || 'ALL').trim().toUpperCase() || 'ALL',
        orden
      },
      key: name,
      orden
    };
  }
  throw new Error('Catálogo no soportado.');
}

async function _persistListas(actorName = 'Admin') {
  const api = window.api;
  if (!api?.guardarConfiguracionListas) {
    throw new Error('API de configuración no disponible.');
  }
  const plaza = String(
    window.__mexCurrentPlazaId
    || window.MEX_CONFIG?.empresa?.plazas?.[0]
    || ''
  ).toUpperCase();
  await api.guardarConfiguracionListas(window.MEX_CONFIG.listas, actorName, plaza);
  try {
    if (typeof window.__mexInvalidateConfigCache === 'function') {
      window.__mexInvalidateConfigCache();
    }
  } catch (_) { /* ignore */ }
}

function _ensureList(section) {
  if (!window.MEX_CONFIG) window.MEX_CONFIG = {};
  if (!window.MEX_CONFIG.listas) window.MEX_CONFIG.listas = {};
  const key = String(section || '').toLowerCase();
  if (!Array.isArray(window.MEX_CONFIG.listas[key])) {
    window.MEX_CONFIG.listas[key] = [];
  }
  return window.MEX_CONFIG.listas[key];
}

export async function saveCatalogItem(section, entityId, fields, actorEmail = '') {
  const list = _ensureList(section);
  const isNew = !entityId || String(entityId).toUpperCase() === 'NUEVO';
  const existing = isNew ? null : findCatalogItem(section, entityId);
  const fallbackOrder = existing ? existing.orden : (list.length + 1);
  const built = _buildItem(section, fields, fallbackOrder);

  const dup = list.some((entry, idx) => {
    if (existing && idx === existing.index) return false;
    return catalogEntityKey(section, entry) === built.key;
  });
  if (dup) throw new Error(`"${built.key}" ya existe.`);

  // gasolinas: preservar formato string si la lista era de strings
  if (section === 'gasolinas' && list.length && typeof list[0] !== 'object') {
    const asString = _buildItem(section, { ...fields, asString: true }, fallbackOrder);
    if (existing) {
      list[existing.index] = asString.item;
      _moveToOrder(list, existing.index, asString.orden);
    } else {
      list.push(asString.item);
      _moveToOrder(list, list.length - 1, asString.orden);
    }
  } else if (existing) {
    list[existing.index] = built.item;
    _moveToOrder(list, existing.index, built.orden);
  } else {
    list.push(built.item);
    _moveToOrder(list, list.length - 1, built.orden);
  }

  try {
    await _persistListas(actorEmail || 'Admin');
  } catch (err) {
    const code = String(err?.code || '');
    if (code.includes('permission') || /insufficient|permission/i.test(String(err?.message || ''))) {
      throw new Error('Sin permiso para guardar catálogos (se requiere manage_system_settings).');
    }
    throw err;
  }
  return built.key;
}

export async function deleteCatalogItem(section, entityId, actorEmail = '') {
  const list = _ensureList(section);
  const row = findCatalogItem(section, entityId);
  if (!row) throw new Error('Elemento no encontrado.');
  list.splice(row.index, 1);
  _applyOrder(list);
  await _persistListas(actorEmail || 'Admin');
  return true;
}

/** Mueve un elemento ±1 en el catálogo (orden visual) y renumerá `orden` (1..n). */
export async function reorderCatalogItem(section, entityId, delta, actorEmail = '') {
  const sorted = getCatalogList(section);
  const want = String(entityId || '').trim().toUpperCase();
  const viewIdx = sorted.findIndex(r => r.key === want);
  if (viewIdx < 0) throw new Error('Elemento no encontrado.');
  const targetView = viewIdx + (Number(delta) || 0);
  if (targetView < 0 || targetView >= sorted.length) return want;

  const keys = sorted.map(r => r.key);
  const [moved] = keys.splice(viewIdx, 1);
  keys.splice(targetView, 0, moved);

  const list = _ensureList(section);
  const byKey = new Map();
  list.forEach((item, index) => {
    const k = catalogEntityKey(section, item) || `__ITEM_${index + 1}`;
    byKey.set(k, item);
  });
  const next = [];
  keys.forEach((k) => {
    const item = byKey.get(k);
    if (item != null) {
      next.push(item);
      byKey.delete(k);
    }
  });
  byKey.forEach((item) => next.push(item));
  list.length = 0;
  list.push(...next);
  _applyOrder(list);
  try {
    await _persistListas(actorEmail || 'Admin');
  } catch (err) {
    const code = String(err?.code || '');
    if (code.includes('permission') || /insufficient|permission/i.test(String(err?.message || ''))) {
      throw new Error('Sin permiso para reordenar catálogos (se requiere manage_system_settings).');
    }
    throw err;
  }
  return moved;
}

export function editorFieldsFromItem(section, item) {
  const tab = String(section || '').toLowerCase();
  const name = catalogDisplayName(tab, item);
  const obj = item && typeof item === 'object' ? item : {};
  const base = {
    nombre: name,
    orden: _orderValue(obj, 0)
  };
  if (tab === 'estados') {
    return { ...base, color: String(obj.color || '#64748b') };
  }
  if (tab === 'categorias') {
    return { ...base, descripcion: String(obj.descripcion || obj.description || '') };
  }
  if (tab === 'modelos') {
    return {
      ...base,
      categoria: String(obj.categoria || ''),
      imagenURL: String(obj.imagenURL || obj.imagen || obj.img || '')
    };
  }
  if (tab === 'gasolinas') {
    return base;
  }
  if (tab === 'motivos_traslado') {
    return {
      ...base,
      codigo: String(obj.codigo || obj.id || ''),
      etiqueta: String(obj.etiqueta || obj.nombre || name),
      descripcion: String(obj.descripcion || ''),
      activo: obj.activo !== false
    };
  }
  if (tab === 'ubicaciones') {
    return {
      ...base,
      isPlazaFija: obj.isPlazaFija === true,
      plazaId: String(obj.plazaId || 'ALL').trim().toUpperCase() || 'ALL'
    };
  }
  return base;
}
