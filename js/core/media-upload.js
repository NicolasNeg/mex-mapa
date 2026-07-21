// ═══════════════════════════════════════════════════════════
//  js/core/media-upload.js
//  Primary media storage via Cloudinary (signed uploads).
//  Firebase Storage remains only for empresa branding assets.
// ═══════════════════════════════════════════════════════════

import { storage, functions } from '/js/core/database.js';

const DEFAULT_BASE_FOLDER = 'mex/prod';
const DEFAULT_CLOUD_NAME = 'dcoma38r'; // public delivery cloud name only — never API secret
const PROVIDER = 'cloudinary';

function _safeText(value) {
  return String(value || '').trim();
}

function _mexAlertConfigMissing() {
  const msg = 'Configura Cloudinary (secrets de Functions + media.cloudName en configuración).';
  if (typeof window.mexAlert === 'function') {
    return window.mexAlert('Cloudinary', msg, 'warning');
  }
  console.warn('[media-upload]', msg);
  return Promise.resolve();
}

/** Client-safe media config from MEX_CONFIG / empresa.media */
export function getMediaConfig() {
  const root = typeof window !== 'undefined' ? window : {};
  const fromTop = root.MEX_CONFIG?.media || {};
  const fromEmpresa = root.MEX_CONFIG?.empresa?.media || {};
  const merged = { ...fromEmpresa, ...fromTop };
  return {
    provider: _safeText(merged.provider) || PROVIDER,
    cloudName: _safeText(merged.cloudName || merged.cloud_name) || DEFAULT_CLOUD_NAME,
    baseFolder: _safeText(merged.baseFolder || merged.base_folder) || DEFAULT_BASE_FOLDER,
  };
}

function _sanitizeSegment(value, fallback = 'file') {
  const s = _safeText(value).replace(/[^a-zA-Z0-9/_-]/g, '_').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  return s || fallback;
}

function _joinFolder(...parts) {
  return parts
    .map((p) => _safeText(p).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function _guessResourceType(file, explicit) {
  if (explicit) return explicit;
  const type = _safeText(file?.type).toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'video'; // Cloudinary stores audio under video
  if (type === 'application/pdf' || type.includes('pdf')) return 'raw';
  if (type && !type.startsWith('image/')) return 'raw';
  return 'image';
}

function _isHttpUrl(value) {
  return /^https?:\/\//i.test(_safeText(value));
}

function _isCloudinaryUrl(value) {
  return /res\.cloudinary\.com\//i.test(_safeText(value));
}

/** Extract public_id from a Cloudinary delivery URL (best effort). */
export function publicIdFromCloudinaryUrl(url) {
  const raw = _safeText(url);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean);
    // /<cloud>/image/upload/v123/folder/name.jpg  or with transforms
    const uploadIdx = parts.findIndex((p) => p === 'upload' || p === 'authenticated' || p === 'private');
    if (uploadIdx < 0) return '';
    let rest = parts.slice(uploadIdx + 1);
    if (rest[0] && /^v\d+$/i.test(rest[0])) rest = rest.slice(1);
    // skip transformation segments (contain , or _)
    while (rest.length && /[,]|^(c_|w_|h_|q_|f_|e_|b_|r_|g_|l_|t_|dpr_|ar_)/.test(rest[0])) {
      rest = rest.slice(1);
    }
    if (!rest.length) return '';
    const joined = rest.join('/');
    return joined.replace(/\.[a-z0-9]+$/i, '');
  } catch (_) {
    return '';
  }
}

export function normalizeMediaRef(ref) {
  if (!ref) return null;
  if (typeof ref === 'string') {
    const s = _safeText(ref);
    if (!s) return null;
    if (_isHttpUrl(s)) {
      const publicId = _isCloudinaryUrl(s) ? publicIdFromCloudinaryUrl(s) : '';
      return {
        url: s,
        publicId,
        provider: (publicId || _isCloudinaryUrl(s)) ? PROVIDER : 'url',
        path: '',
      };
    }
    // Firebase storage path (legacy) or bare publicId
    if (s.includes('/') && !s.startsWith('http') && !s.includes('.')) {
      // ambiguous: treat as firebase path if looks like known prefixes, else publicId
      const firebasePrefixes = [
        'papeletas', 'papeletas_reportes', 'papeletas_ventas', 'profile_avatars',
        'catalogo_modelos', 'mensajes_chat', 'turnos_', 'maps/', 'licencias_',
        'notas_admin', 'evidencias_', 'empresa_config',
      ];
      if (firebasePrefixes.some((p) => s.startsWith(p))) {
        return { url: '', publicId: '', provider: 'firebase', path: s };
      }
      return { url: '', publicId: s, provider: PROVIDER, path: '' };
    }
    if (s.includes('/') || s.includes('.')) {
      return { url: '', publicId: '', provider: 'firebase', path: s };
    }
    return { url: '', publicId: s, provider: PROVIDER, path: '' };
  }
  if (typeof ref === 'object') {
    const url = _safeText(ref.url || ref.secure_url || ref.downloadURL);
    const publicId = _safeText(ref.publicId || ref.public_id);
    const path = _safeText(ref.path || ref.storagePath || ref.fotoPath);
    let provider = _safeText(ref.provider).toLowerCase();
    if (!provider) {
      if (publicId || _isCloudinaryUrl(url)) provider = PROVIDER;
      else if (path) provider = 'firebase';
      else if (url) provider = 'url';
    }
    return { url, publicId, provider, path };
  }
  return null;
}

/**
 * Resolve any stored media ref to a displayable HTTPS URL.
 * - https → passthrough
 * - firebase path → getDownloadURL
 * - cloudinary publicId → build delivery URL from cloudName
 */
export async function resolveMediaUrl(ref) {
  const n = normalizeMediaRef(ref);
  if (!n) return '';
  if (n.url && _isHttpUrl(n.url)) return n.url;

  if (n.provider === PROVIDER && n.publicId) {
    const { cloudName } = getMediaConfig();
    if (!cloudName) return '';
    return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload/${n.publicId}`;
  }

  if (n.path) {
    try {
      const root = storage || window._storage || (window.firebase?.storage ? window.firebase.storage() : null);
      if (!root?.ref) return '';
      return await root.ref(n.path).getDownloadURL();
    } catch (_) {
      return '';
    }
  }

  return '';
}

function _getFunctions() {
  return functions
    || window._functions
    || (window.firebase?.functions ? window.firebase.functions() : null);
}

async function _requestUploadSignature({ folder, publicId, resourceType }) {
  const fns = _getFunctions();
  if (!fns?.httpsCallable) {
    await _mexAlertConfigMissing();
    throw new Error('Cloud Functions no disponible para firmar uploads.');
  }
  try {
    const callable = fns.httpsCallable('getCloudinaryUploadSignature');
    const res = await callable({ folder, publicId, resourceType });
    return res?.data || res;
  } catch (err) {
    const code = err?.code || err?.details || '';
    const msg = _safeText(err?.message || err);
    if (/unauthenticated|not-found|failed-precondition|Configura Cloudinary|CLOUDINARY/i.test(`${code} ${msg}`)) {
      await _mexAlertConfigMissing();
    }
    throw err;
  }
}

/**
 * Signed upload to Cloudinary.
 * @returns {{ url: string, publicId: string, provider: 'cloudinary', resourceType: string, bytes?: number }}
 */
export async function uploadMedia({ folder, file, blob, publicId, resourceType } = {}) {
  const mediaFile = file || blob;
  if (!mediaFile) throw new Error('Archivo requerido para uploadMedia.');

  const cfg = getMediaConfig();
  const base = cfg.baseFolder || DEFAULT_BASE_FOLDER;
  const relFolder = _sanitizeSegment(folder || 'misc', 'misc');
  const fullFolder = relFolder.startsWith(base) ? relFolder : _joinFolder(base, relFolder);
  const type = _guessResourceType(mediaFile, resourceType);
  const safePublicId = publicId
    ? _sanitizeSegment(publicId, `f_${Date.now()}`)
    : undefined;

  const sig = await _requestUploadSignature({
    folder: fullFolder,
    publicId: safePublicId,
    resourceType: type,
  });

  const cloudName = _safeText(sig.cloudName || cfg.cloudName);
  const apiKey = _safeText(sig.apiKey);
  if (!cloudName || !apiKey || !sig.signature || !sig.timestamp) {
    await _mexAlertConfigMissing();
    throw new Error('Configura Cloudinary');
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${encodeURIComponent(type)}/upload`;
  const form = new FormData();
  form.append('file', mediaFile);
  form.append('api_key', apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('signature', sig.signature);
  form.append('folder', sig.folder || fullFolder);
  if (sig.publicId) form.append('public_id', sig.publicId);

  const res = await fetch(endpoint, { method: 'POST', body: form });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = payload?.error?.message || `Cloudinary upload failed (${res.status})`;
    throw new Error(errMsg);
  }

  const result = {
    url: _safeText(payload.secure_url || payload.url),
    publicId: _safeText(payload.public_id),
    provider: PROVIDER,
    resourceType: _safeText(payload.resource_type || type) || type,
    bytes: Number(payload.bytes) || 0,
    format: _safeText(payload.format),
  };

  // Keep cloudName in memory config if missing
  if (cloudName && typeof window !== 'undefined') {
    window.MEX_CONFIG = window.MEX_CONFIG || {};
    window.MEX_CONFIG.media = {
      ...(window.MEX_CONFIG.media || {}),
      provider: PROVIDER,
      cloudName,
      baseFolder: cfg.baseFolder || DEFAULT_BASE_FOLDER,
    };
  }

  return result;
}

/** Destroy a Cloudinary asset (auth required). Best-effort; ignores missing. */
export async function destroyMedia(ref) {
  const n = normalizeMediaRef(ref);
  if (!n?.publicId && !_isCloudinaryUrl(n?.url)) return { ok: false, skipped: true };
  const publicId = n.publicId || publicIdFromCloudinaryUrl(n.url);
  if (!publicId) return { ok: false, skipped: true };

  const fns = _getFunctions();
  if (!fns?.httpsCallable) return { ok: false, skipped: true };
  try {
    const callable = fns.httpsCallable('destroyCloudinaryMedia');
    const res = await callable({
      publicId,
      resourceType: n.resourceType || 'image',
    });
    return res?.data || { ok: true };
  } catch (err) {
    console.warn('[media-upload] destroyMedia', err?.message || err);
    return { ok: false, error: String(err?.message || err) };
  }
}

/** Convenience: upload and return only the HTTPS URL (legacy-friendly). */
export async function uploadMediaUrl(opts) {
  const r = await uploadMedia(opts);
  return r.url;
}

// Expose for classic scripts (mex-api.js, api/*.js)
if (typeof window !== 'undefined') {
  window.mexMedia = {
    uploadMedia,
    uploadMediaUrl,
    resolveMediaUrl,
    destroyMedia,
    normalizeMediaRef,
    getMediaConfig,
    publicIdFromCloudinaryUrl,
  };
}
