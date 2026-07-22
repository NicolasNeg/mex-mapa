import { db, COL, storage } from '/js/core/database.js';

export const LICENCIA_MAX_FILES = 2;
export const LICENCIA_SIDES = ['frente', 'reverso'];
export const LICENCIA_ACCEPT =
  'image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf';

const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf']);
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf'
]);

function _fv() {
  return window.firebase?.firestore?.FieldValue || null;
}

function _safeSegment(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_.@-]/g, '_') || 'usuario';
}

function _extOf(file) {
  const name = String(file?.name || '').toLowerCase();
  const m = name.match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function _normalizeSide(value, index = 0) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'frente' || raw === 'front' || raw === 'anverso') return 'frente';
  if (raw === 'reverso' || raw === 'back') return 'reverso';
  if (raw === 'file_1' || raw === 'archivo_1' || raw === '1') return 'frente';
  if (raw === 'file_2' || raw === 'archivo_2' || raw === '2') return 'reverso';
  return LICENCIA_SIDES[index] || `archivo_${index + 1}`;
}

function _entryFromLegacy(user = {}) {
  const url = String(user.licenciaArchivoUrl || user.licenciaUrl || '').trim();
  const path = String(user.licenciaArchivoPath || '').trim();
  const publicId = String(user.licenciaArchivoPublicId || '').trim();
  if (!url && !path && !publicId) return null;
  return {
    url,
    publicId,
    path,
    tipo: String(user.licenciaArchivoTipo || '').trim(),
    name: String(user.licenciaArchivoNombre || 'licencia').trim() || 'licencia',
    provider: String(user.licenciaArchivoProvider || (publicId || /cloudinary/i.test(url) ? 'cloudinary' : '')).trim(),
    side: 'frente'
  };
}

/** Dual-read: `licencias[]` / `licenciaUrls[]` or legacy single fields. */
export function normalizeLicencias(user = {}) {
  const out = [];
  const seen = new Set();
  const push = (raw, index = 0) => {
    if (!raw || typeof raw !== 'object') return;
    const url = String(raw.url || raw.licenciaUrl || '').trim();
    const publicId = String(raw.publicId || raw.public_id || '').trim();
    const path = String(raw.path || raw.storagePath || '').trim();
    if (!url && !publicId && !path) return;
    const key = `${publicId}|${url}|${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      url,
      publicId,
      path,
      tipo: String(raw.tipo || raw.contentType || raw.type || '').trim(),
      name: String(raw.name || raw.nombre || raw.fileName || `licencia_${index + 1}`).trim(),
      provider: String(raw.provider || '').trim(),
      side: _normalizeSide(raw.side || raw.tipoLado || raw.label, index)
    });
  };

  if (Array.isArray(user.licencias) && user.licencias.length) {
    user.licencias.slice(0, LICENCIA_MAX_FILES).forEach((item, i) => push(item, i));
  } else if (Array.isArray(user.licenciaUrls) && user.licenciaUrls.length) {
    user.licenciaUrls.slice(0, LICENCIA_MAX_FILES).forEach((item, i) => {
      if (typeof item === 'string') {
        push({ url: item, side: LICENCIA_SIDES[i] }, i);
      } else {
        push(item, i);
      }
    });
  } else {
    const legacy = _entryFromLegacy(user);
    if (legacy) out.push(legacy);
  }

  return out.slice(0, LICENCIA_MAX_FILES);
}

export function hasLicenciaArchivo(user = {}) {
  return normalizeLicencias(user).length > 0;
}

export function isChoferRegistrado(user = {}) {
  return user.isChofer === true
    && Boolean(String(user.licenciaVencimiento || '').trim())
    && hasLicenciaArchivo(user);
}

export function validateLicenciaFile(file) {
  if (!file) return 'Sube una foto o PDF de la licencia (frente y/o reverso).';
  const type = String(file.type || '').toLowerCase();
  const ext = _extOf(file);
  const okMime = ALLOWED_MIME.has(type);
  const okExt = ALLOWED_EXT.has(ext);
  const okImagePrefix = type.startsWith('image/') && ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
  if (!(okMime || okExt || okImagePrefix)) {
    return 'Solo se permiten JPG, JPEG, PNG, WEBP o PDF.';
  }
  if (file.size > 12 * 1024 * 1024) return 'Cada archivo de licencia no puede pesar más de 12 MB.';
  return '';
}

/** @param {File[]} files */
export function validateLicenciaFiles(files = []) {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  if (list.length > LICENCIA_MAX_FILES) {
    return `Máximo ${LICENCIA_MAX_FILES} archivos (frente y reverso).`;
  }
  for (const file of list) {
    const err = validateLicenciaFile(file);
    if (err) return err;
  }
  return '';
}

function _legacyMirrorFromLicencias(licencias = []) {
  const first = licencias[0] || null;
  if (!first) {
    return {
      licenciaArchivoUrl: '',
      licenciaArchivoPath: '',
      licenciaArchivoPublicId: '',
      licenciaArchivoProvider: '',
      licenciaArchivoNombre: '',
      licenciaArchivoTipo: '',
      licenciaUrls: []
    };
  }
  return {
    licenciaArchivoUrl: first.url || '',
    licenciaArchivoPath: first.path || first.publicId || '',
    licenciaArchivoPublicId: first.publicId || '',
    licenciaArchivoProvider: first.provider || 'cloudinary',
    licenciaArchivoNombre: first.name || 'licencia',
    licenciaArchivoTipo: first.tipo || '',
    licenciaUrls: licencias.map(l => l.url).filter(Boolean)
  };
}

async function _destroyLicenciaEntry(entry) {
  if (!entry) return;
  const isCloudinary = entry.provider === 'cloudinary'
    || Boolean(entry.publicId)
    || /cloudinary/i.test(String(entry.url || ''));
  if (isCloudinary) {
    const { destroyMedia } = await import('/js/core/media-upload.js');
    destroyMedia({
      publicId: entry.publicId,
      url: entry.url,
      provider: 'cloudinary',
      resourceType: String(entry.tipo || '').includes('pdf') ? 'raw' : 'image'
    }).catch(() => {});
    return;
  }
  if (entry.path) {
    const root = storage || window._storage;
    try { root?.ref(entry.path)?.delete()?.catch(() => {}); } catch (_) { /* ignore */ }
  }
}

async function _uploadLicenciaSide(user, file, side) {
  const { uploadMedia } = await import('/js/core/media-upload.js');
  const safeUser = _safeSegment(user.id || user.email || user.nombre);
  const safeName = _safeSegment(file.name || side).replace(/\.[^.]+$/, '');
  const contentType = file.type
    || (String(file.name || '').toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  const resourceType = contentType.startsWith('image/') ? 'image' : 'raw';
  const result = await uploadMedia({
    folder: `licencias_choferes/${safeUser}`,
    file,
    publicId: `${side}_${Date.now()}_${safeName}`,
    resourceType
  });
  return {
    url: result.url,
    publicId: result.publicId || '',
    path: result.publicId || '',
    tipo: contentType || file.type || '',
    name: file.name || side,
    provider: result.provider || 'cloudinary',
    side
  };
}

/**
 * @param {object} user
 * @param {{
 *   licenciaVencimiento: string,
 *   files?: File[],
 *   fileFrente?: File|null,
 *   fileReverso?: File|null,
 *   file?: File|null,
 *   actorEmail?: string
 * }} opts
 */
export async function saveChoferRegistro(user, opts = {}) {
  const {
    licenciaVencimiento,
    files,
    fileFrente = null,
    fileReverso = null,
    file = null,
    actorEmail = ''
  } = opts;

  const venc = String(licenciaVencimiento || '').trim().slice(0, 10);
  if (!venc) throw new Error('Captura el vencimiento de licencia.');

  const existing = normalizeLicencias(user);
  const bySide = {
    frente: fileFrente || null,
    reverso: fileReverso || null
  };

  /** @type {{ side: string, file: File }[]} */
  const pending = [];
  if (Array.isArray(files) && files.length) {
    if (files.length > LICENCIA_MAX_FILES) {
      throw new Error(`Máximo ${LICENCIA_MAX_FILES} archivos (frente y reverso).`);
    }
    files.filter(Boolean).forEach((f, i) => {
      pending.push({ side: LICENCIA_SIDES[i] || `archivo_${i + 1}`, file: f });
    });
  } else {
    if (bySide.frente) pending.push({ side: 'frente', file: bySide.frente });
    if (bySide.reverso) pending.push({ side: 'reverso', file: bySide.reverso });
    if (!pending.length && file) pending.push({ side: 'frente', file });
  }

  const err = validateLicenciaFiles(pending.map(p => p.file));
  if (err) throw new Error(err);

  if (!pending.length && !existing.length) {
    throw new Error('Sube al menos un archivo de licencia (frente o reverso). JPG, PNG, WEBP o PDF.');
  }

  const next = existing.map(e => ({ ...e }));
  const replaced = [];

  for (const { side, file: f } of pending) {
    const uploaded = await _uploadLicenciaSide(user, f, side);
    const idx = next.findIndex(e => e.side === side);
    if (idx >= 0) {
      replaced.push(next[idx]);
      next[idx] = uploaded;
    } else if (next.length < LICENCIA_MAX_FILES) {
      next.push(uploaded);
    } else {
      // Prefer replacing frente slot if sides unknown
      replaced.push(next[0]);
      next[0] = uploaded;
    }
  }

  // Cap + stable order frente then reverso
  next.sort((a, b) => {
    const ai = LICENCIA_SIDES.indexOf(a.side);
    const bi = LICENCIA_SIDES.indexOf(b.side);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const licencias = next.slice(0, LICENCIA_MAX_FILES);
  const mirror = _legacyMirrorFromLicencias(licencias);

  const fv = _fv();
  const updateData = {
    isChofer: true,
    licenciaVencimiento: venc,
    licencias,
    licenciaUrls: mirror.licenciaUrls,
    licenciaArchivoUrl: mirror.licenciaArchivoUrl,
    licenciaArchivoPath: mirror.licenciaArchivoPath,
    licenciaArchivoPublicId: mirror.licenciaArchivoPublicId,
    licenciaArchivoProvider: mirror.licenciaArchivoProvider,
    licenciaArchivoNombre: mirror.licenciaArchivoNombre,
    licenciaArchivoTipo: mirror.licenciaArchivoTipo,
    licenciaSubidaPor: String(actorEmail || '').trim().toLowerCase() || 'Sistema',
    licenciaActualizadaAt: fv ? fv.serverTimestamp() : new Date().toISOString(),
    actualizadoAt: fv ? fv.serverTimestamp() : new Date().toISOString(),
    actualizadoPor: String(actorEmail || '').trim().toLowerCase(),
    updatedFrom: 'app_admin_choferes'
  };
  if (pending.length) {
    updateData.licenciaSubidaAt = fv ? fv.serverTimestamp() : new Date().toISOString();
  }

  await db.collection(COL.USERS).doc(user.id).set(updateData, { merge: true });

  for (const old of replaced) {
    _destroyLicenciaEntry(old).catch(() => {});
  }
}

export async function disableChoferRegistro(user, actorEmail = '') {
  const fv = _fv();
  const del = fv?.delete ? fv.delete() : null;
  const previous = normalizeLicencias(user);
  const clear = {
    isChofer: false,
    licenciaVencimiento: del || '',
    licencias: del || [],
    licenciaUrls: del || [],
    licenciaArchivoUrl: del || '',
    licenciaArchivoPath: del || '',
    licenciaArchivoPublicId: del || '',
    licenciaArchivoProvider: del || '',
    licenciaArchivoNombre: del || '',
    licenciaArchivoTipo: del || '',
    licenciaSubidaAt: del || '',
    licenciaActualizadaAt: del || '',
    licenciaSubidaPor: del || '',
    actualizadoAt: fv ? fv.serverTimestamp() : new Date().toISOString(),
    actualizadoPor: String(actorEmail || '').trim().toLowerCase(),
    updatedFrom: 'app_admin_choferes'
  };
  await db.collection(COL.USERS).doc(user.id).set(clear, { merge: true });
  for (const entry of previous) {
    _destroyLicenciaEntry(entry).catch(() => {});
  }
}
