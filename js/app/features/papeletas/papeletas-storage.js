import { storage } from '/js/core/database.js';

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

export async function uploadBytesAtPath(path, blob, contentType = 'image/jpeg') {
  const ref = _storageRef(path);
  await ref.put(blob, { contentType });
  return path;
}

export async function uploadZonaFoto(papeletaId, zonaId, file) {
  const blob = await compressImageFile(file);
  const path = `papeletas/${papeletaId}/zonas/${zonaId}.jpg`;
  await uploadBytesAtPath(path, blob, 'image/jpeg');
  return path;
}

export async function uploadZonaDetalle(papeletaId, zonaId, file) {
  const blob = await compressImageFile(file);
  const path = `papeletas/${papeletaId}/zonas/${zonaId}_detalle.jpg`;
  await uploadBytesAtPath(path, blob, 'image/jpeg');
  return path;
}

export async function uploadFirma(papeletaId, blob) {
  const path = `papeletas/${papeletaId}/firma.png`;
  await uploadBytesAtPath(path, blob, 'image/png');
  return path;
}

export async function uploadReporteFoto(reporteId, name, file) {
  const blob = await compressImageFile(file);
  const safe = String(name || 'foto').replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `papeletas_reportes/${reporteId}/${safe}.jpg`;
  await uploadBytesAtPath(path, blob, 'image/jpeg');
  return path;
}

export async function copyStoragePath(fromPath, toPath) {
  const fromRef = _storageRef(fromPath);
  const url = await fromRef.getDownloadURL();
  const res = await fetch(url);
  const blob = await res.blob();
  await uploadBytesAtPath(toPath, blob, blob.type || 'image/jpeg');
  return toPath;
}

export async function deleteStoragePath(path) {
  try {
    await _storageRef(path).delete();
  } catch (e) {
    if (e?.code !== 'storage/object-not-found') throw e;
  }
}

export async function getDownloadUrl(path) {
  if (!path) return '';
  try {
    return await _storageRef(path).getDownloadURL();
  } catch (_) {
    return '';
  }
}
