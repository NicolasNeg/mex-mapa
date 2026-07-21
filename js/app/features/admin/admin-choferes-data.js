import { db, COL, storage } from '/js/core/database.js';

function _fv() {
  return window.firebase?.firestore?.FieldValue || null;
}

function _safeSegment(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_.@-]/g, '_') || 'usuario';
}

export function isChoferRegistrado(user = {}) {
  return user.isChofer === true
    && Boolean(String(user.licenciaVencimiento || '').trim())
    && Boolean(String(user.licenciaArchivoUrl || user.licenciaArchivoPath || '').trim());
}

export function validateLicenciaFile(file) {
  if (!file) return 'Sube una foto o PDF de la licencia.';
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  const ok = type.startsWith('image/') || type === 'application/pdf' || name.endsWith('.pdf');
  if (!ok) return 'La licencia debe ser imagen o PDF.';
  if (file.size > 12 * 1024 * 1024) return 'La licencia no puede pesar más de 12 MB.';
  return '';
}

async function _uploadLicencia(user, file) {
  const { uploadMedia, destroyMedia } = await import('/js/core/media-upload.js');
  const safeUser = _safeSegment(user.id || user.email || user.nombre);
  const safeName = _safeSegment(file.name || 'licencia').replace(/\.[^.]+$/, '');
  const contentType = file.type
    || (String(file.name || '').toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  const resourceType = contentType.startsWith('image/') ? 'image' : 'raw';
  const result = await uploadMedia({
    folder: `licencias_choferes/${safeUser}`,
    file,
    publicId: `licencia_${Date.now()}_${safeName}`,
    resourceType,
  });
  // Best-effort cleanup of previous Cloudinary licencia
  if (user.licenciaArchivoPublicId || (user.licenciaArchivoUrl && /cloudinary/i.test(String(user.licenciaArchivoUrl)))) {
    destroyMedia({
      publicId: user.licenciaArchivoPublicId,
      url: user.licenciaArchivoUrl,
      provider: 'cloudinary',
      resourceType: user.licenciaArchivoTipo?.includes('pdf') ? 'raw' : 'image',
    }).catch(() => {});
  }
  return {
    path: result.publicId || '',
    publicId: result.publicId || '',
    provider: result.provider || 'cloudinary',
    url: result.url,
    contentType,
  };
}

export async function saveChoferRegistro(user, { licenciaVencimiento, file, actorEmail = '' }) {
  const venc = String(licenciaVencimiento || '').trim().slice(0, 10);
  if (!venc) throw new Error('Captura el vencimiento de licencia.');
  const hasExisting = Boolean(user.licenciaArchivoUrl || user.licenciaArchivoPath);
  if (!file && !hasExisting) throw new Error('Sube la foto o PDF de la licencia vigente.');
  if (file) {
    const err = validateLicenciaFile(file);
    if (err) throw new Error(err);
  }

  const fv = _fv();
  const updateData = {
    isChofer: true,
    licenciaVencimiento: venc,
    licenciaSubidaPor: String(actorEmail || '').trim().toLowerCase() || 'Sistema',
    licenciaActualizadaAt: fv ? fv.serverTimestamp() : new Date().toISOString(),
    actualizadoAt: fv ? fv.serverTimestamp() : new Date().toISOString(),
    actualizadoPor: String(actorEmail || '').trim().toLowerCase(),
    updatedFrom: 'app_admin_choferes'
  };

  if (file) {
    const uploaded = await _uploadLicencia(user, file);
    updateData.licenciaArchivoUrl = uploaded.url;
    updateData.licenciaArchivoPath = uploaded.path;
    updateData.licenciaArchivoPublicId = uploaded.publicId || '';
    updateData.licenciaArchivoProvider = uploaded.provider || 'cloudinary';
    updateData.licenciaArchivoNombre = file.name || 'licencia';
    updateData.licenciaArchivoTipo = uploaded.contentType || file.type || '';
    updateData.licenciaSubidaAt = fv ? fv.serverTimestamp() : new Date().toISOString();
    const prevIsCloudinary = user.licenciaArchivoProvider === 'cloudinary'
      || Boolean(user.licenciaArchivoPublicId)
      || /cloudinary/i.test(String(user.licenciaArchivoUrl || ''));
    if (!prevIsCloudinary && user.licenciaArchivoPath) {
      const root = storage || window._storage;
      try { root?.ref(user.licenciaArchivoPath)?.delete()?.catch(() => {}); } catch (_) { /* ignore */ }
    }
  }

  await db.collection(COL.USERS).doc(user.id).set(updateData, { merge: true });
}

export async function disableChoferRegistro(user, actorEmail = '') {
  const fv = _fv();
  const del = fv?.delete ? fv.delete() : null;
  const clear = {
    isChofer: false,
    licenciaVencimiento: del || '',
    licenciaArchivoUrl: del || '',
    licenciaArchivoPath: del || '',
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
  if (user.licenciaArchivoPath) {
    const root = storage || window._storage;
    try { root?.ref(user.licenciaArchivoPath)?.delete()?.catch(() => {}); } catch (_) { /* ignore */ }
  }
}
