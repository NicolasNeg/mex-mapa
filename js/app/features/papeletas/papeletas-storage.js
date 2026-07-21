import { storage } from '/js/core/database.js';
import {
  uploadMedia,
  resolveMediaUrl,
  destroyMedia,
  normalizeMediaRef,
} from '/js/core/media-upload.js';

const MAX_BYTES = 800_000;

function _storageRef(path) {
  return storage.ref(path);
}

/** Compress image File/Blob to JPEG ≤ maxBytes (best effort). */
export async function compressImageFile(file, maxBytes = MAX_BYTES) {
  if (!file) throw new Error('Archivo requerido');
  if (typeof createImageBitmap !== 'function' && typeof Image === 'undefined') {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const maxEdge = 1600;
  let w = bitmap.width;
  let h = bitmap.height;
  if (Math.max(w, h) > maxEdge) {
    const scale = maxEdge / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  try { bitmap.close?.(); } catch (_) { /* ignore */ }

  let quality = 0.82;
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  while (blob && blob.size > maxBytes && quality > 0.45) {
    quality -= 0.08;
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }
  return blob || file;
}

/** @returns {Promise<{ url: string, publicId: string, provider: string }>} */
async function _uploadToCloudinary(folder, blob, publicId, resourceType = 'image') {
  return uploadMedia({ folder, file: blob, publicId, resourceType });
}

/** Legacy Firebase path upload — only used for true Firebase fallbacks. */
export async function uploadBytesAtPath(path, blob, contentType = 'image/jpeg') {
  const ref = _storageRef(path);
  await ref.put(blob, { contentType });
  return path;
}

/**
 * Upload helpers return HTTPS Cloudinary URL (string) so existing
 * fotoPath / fotos.* fields keep working. Metadata also available via
 * the last upload when callers need { url, publicId, provider }.
 */
export async function uploadZonaFoto(papeletaId, zonaId, file) {
  const blob = await compressImageFile(file);
  const result = await _uploadToCloudinary(
    `papeletas/${papeletaId}/zonas`,
    blob,
    `${zonaId}`,
    'image'
  );
  return result.url;
}

export async function uploadZonaDetalle(papeletaId, zonaId, file) {
  const blob = await compressImageFile(file);
  const result = await _uploadToCloudinary(
    `papeletas/${papeletaId}/zonas`,
    blob,
    `${zonaId}_detalle`,
    'image'
  );
  return result.url;
}

export async function uploadDamageFoto(papeletaId, damageId, file) {
  const blob = await compressImageFile(file);
  const safe = String(damageId || 'd').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const result = await _uploadToCloudinary(
    `papeletas/${papeletaId}/danos`,
    blob,
    `${safe}_${Date.now()}`,
    'image'
  );
  return result.url;
}

export async function uploadFirma(papeletaId, blob) {
  const result = await _uploadToCloudinary(
    `papeletas/${papeletaId}/firma`,
    blob,
    'firma',
    'image'
  );
  return result.url;
}

export async function uploadReporteFoto(reporteId, name, file) {
  const blob = await compressImageFile(file);
  const safe = String(name || 'foto').replace(/[^a-zA-Z0-9_-]/g, '_');
  const result = await _uploadToCloudinary(
    `papeletas_reportes/${reporteId}`,
    blob,
    safe,
    'image'
  );
  return result.url;
}

/**
 * Copy / re-home a media ref.
 * Cloudinary sources are re-uploaded into the destination folder (not Firebase copy).
 * Legacy Firebase paths are fetched then uploaded to Cloudinary.
 * @returns {Promise<string>} HTTPS URL
 */
export async function copyStoragePath(fromPath, toPath) {
  const url = await resolveMediaUrl(fromPath);
  if (!url) throw new Error('No se pudo resolver el origen de la copia de media.');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar media origen (${res.status}).`);
  const blob = await res.blob();

  const dest = String(toPath || '').replace(/^\/+|\/+$/g, '');
  const slash = dest.lastIndexOf('/');
  const folder = slash >= 0 ? dest.slice(0, slash) : 'papeletas_ventas';
  const leaf = (slash >= 0 ? dest.slice(slash + 1) : dest).replace(/\.[a-z0-9]+$/i, '') || `copy_${Date.now()}`;

  const result = await _uploadToCloudinary(folder, blob, leaf, 'image');
  return result.url;
}

export async function deleteStoragePath(path) {
  const n = normalizeMediaRef(path);
  if (!n) return;

  if (n.provider === 'cloudinary' || n.publicId || (n.url && /cloudinary/i.test(n.url))) {
    await destroyMedia(n);
    return;
  }

  const firebasePath = n.path || (typeof path === 'string' && !/^https?:\/\//i.test(path) ? path : '');
  if (!firebasePath) return;
  try {
    await _storageRef(firebasePath).delete();
  } catch (e) {
    if (e?.code !== 'storage/object-not-found') throw e;
  }
}

export async function getDownloadUrl(path) {
  return resolveMediaUrl(path);
}
