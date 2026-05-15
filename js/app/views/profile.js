import { db, COL, storage } from '/js/core/database.js';
import { getState, setState, setCurrentPlaza } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';

const APP_PROFILE_CSS_SELECTOR = 'link[data-app-profile-css="1"]';

let _ctx = null;
let _mounted = false;
let _formState = null;
let _offGlobalSearch = null;
let _avatarCrop = null;

const AVATAR_STAGE_SIZE = 360;
const AVATAR_OUTPUT_SIZE = 720;

export function mount(ctx) {
  _ctx = ctx;
  _mounted = true;
  document.body.classList.add('app-profile-active');
  _ensureCss();
  const { profile, role } = getState();
  if (!profile) {
    ctx.container.innerHTML = `<div style="padding:30px;color:#ef4444;">No se pudo cargar el perfil.</div>`;
    return;
  }
  _formState = _makeFormState(profile);
  ctx.container.innerHTML = _html(profile, role, _formState);
  _bindGlobalSearch();
  _bind();
  _renderAvatarPreview();
  _setDirty(false);
}

export function unmount() {
  _closeAvatarCropper({ silent: true });
  if (typeof _offGlobalSearch === 'function') {
    try { _offGlobalSearch(); } catch (_) {}
  }
  _offGlobalSearch = null;
  _mounted = false;
  document.body.classList.remove('app-profile-active');
  _ctx = null;
  _formState = null;
}

function _ensureCss() {
  const existing = document.querySelector(APP_PROFILE_CSS_SELECTOR);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-profile.css';
  link.dataset.appProfileCss = '1';
  document.head.appendChild(link);
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_mounted || !_ctx?.container) return;
    const route = String(event?.detail?.route || '');
    if (!(route.startsWith('/app/profile') || route === '/profile')) return;
    const query = String(event?.detail?.query || '').toLowerCase().trim();
    const blocks = Array.from(_ctx.container.querySelectorAll('[data-profile-search-text]'));
    blocks.forEach(block => {
      const text = String(block.getAttribute('data-profile-search-text') || '');
      block.hidden = !!query && !text.includes(query);
    });
  };
  window.addEventListener('mex:global-search', handler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', handler);
}

function _bind() {
  const c = _ctx?.container;
  if (!c) return;
  const save = c.querySelector('#appProfileSave');
  const cancel = c.querySelector('#appProfileCancel');
  const avatar = c.querySelector('#appProfileAvatarUrl');
  const avatarFile = c.querySelector('#appProfileAvatarFile');
  const chooseAvatar = c.querySelector('#appProfileChooseAvatar');
  const removeAvatar = c.querySelector('#appProfileRemoveAvatar');

  [
    '#appProfileName',
    '#appProfilePhone',
    '#appProfileAvatarUrl',
    '#appProfileTheme',
    '#appProfileDensity',
    '#appProfileLanguage',
    '#appProfileHomeView',
    '#appProfileDefaultPlaza',
    '#appProfileAvatarFit',
    '#appProfileNotifyActive',
    '#appProfilePassiveAlerts',
    '#appProfileQuickHistory',
    '#appProfileVisibleCache',
  ].forEach(selector => {
    const el = c.querySelector(selector);
    el?.addEventListener('input', _onFormChange);
    el?.addEventListener('change', _onFormChange);
  });

  c.querySelectorAll('.app-profile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.target || '';
      const target = c.querySelector(`#${targetId}`);
      if (!target) return;
      const top = target.getBoundingClientRect().top + window.scrollY - 120;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
  });

  avatar?.addEventListener('input', _renderAvatarPreview);
  c.querySelector('#appProfileAvatarFit')?.addEventListener('change', _renderAvatarPreview);
  chooseAvatar?.addEventListener('click', () => avatarFile?.click());
  removeAvatar?.addEventListener('click', _removeAvatar);
  avatarFile?.addEventListener('change', _openAvatarCropper);
  _bindAvatarCropper();
  save?.addEventListener('click', _saveProfile);
  cancel?.addEventListener('click', _resetForm);
  c.querySelector('#appProfileClearCache')?.addEventListener('click', _clearViewCache);
  c.querySelector('#appProfileApplyPlaza')?.addEventListener('click', _applyDefaultPlazaNow);
}

function _onFormChange() {
  _syncFormFromDom();
  _setDirty(true);
}

function _syncFormFromDom() {
  const c = _ctx?.container;
  if (!c || !_formState) return;
  _formState.nombreCompleto = String(c.querySelector('#appProfileName')?.value || '').trim();
  _formState.telefono = String(c.querySelector('#appProfilePhone')?.value || '').trim();
  _formState.avatarUrl = String(c.querySelector('#appProfileAvatarUrl')?.value || '').trim();
  _formState.theme = String(c.querySelector('#appProfileTheme')?.value || 'light').trim();
  _formState.visualDensity = String(c.querySelector('#appProfileDensity')?.value || 'compacta').trim();
  _formState.language = String(c.querySelector('#appProfileLanguage')?.value || 'es').trim();
  _formState.homeView = String(c.querySelector('#appProfileHomeView')?.value || 'dashboard').trim();
  _formState.defaultPlaza = String(c.querySelector('#appProfileDefaultPlaza')?.value || '').trim().toUpperCase();
  _formState.avatarFit = String(c.querySelector('#appProfileAvatarFit')?.value || 'cover').trim();
  _formState.notifyActive = Boolean(c.querySelector('#appProfileNotifyActive')?.checked);
  _formState.passiveAlerts = Boolean(c.querySelector('#appProfilePassiveAlerts')?.checked);
  _formState.quickHistory = Boolean(c.querySelector('#appProfileQuickHistory')?.checked);
  _formState.visibleCache = Boolean(c.querySelector('#appProfileVisibleCache')?.checked);
}

function _resetForm() {
  if (!_mounted) return;
  const { profile } = getState();
  _formState = _makeFormState(profile || {});
  const c = _ctx?.container;
  if (!c) return;
  c.querySelector('#appProfileName').value = _formState.nombreCompleto;
  c.querySelector('#appProfilePhone').value = _formState.telefono;
  c.querySelector('#appProfileAvatarUrl').value = _formState.avatarUrl;
  c.querySelector('#appProfileTheme').value = _formState.theme;
  c.querySelector('#appProfileDensity').value = _formState.visualDensity;
  c.querySelector('#appProfileLanguage').value = _formState.language;
  c.querySelector('#appProfileHomeView').value = _formState.homeView;
  c.querySelector('#appProfileDefaultPlaza').value = _formState.defaultPlaza;
  c.querySelector('#appProfileAvatarFit').value = _formState.avatarFit;
  c.querySelector('#appProfileNotifyActive').checked = _formState.notifyActive;
  c.querySelector('#appProfilePassiveAlerts').checked = _formState.passiveAlerts;
  c.querySelector('#appProfileQuickHistory').checked = _formState.quickHistory;
  c.querySelector('#appProfileVisibleCache').checked = _formState.visibleCache;
  _renderAvatarPreview();
  _setDirty(false);
  _setStatus('Cambios restaurados.', 'info');
}

async function _saveProfile() {
  if (!_mounted || !_formState) return;
  _setStatus('Guardando cambios...', 'info');
  const current = getState().profile || {};
  const docId = String(current.id || current.email || '').toLowerCase().trim();
  if (!docId) return _setStatus('No se pudo resolver el usuario actual.', 'error');
  if (_formState.avatarUrl && !/^https?:\/\//i.test(_formState.avatarUrl)) {
    _setStatus('Avatar URL debe iniciar con http:// o https://', 'error');
    return;
  }

  const payload = {
    nombreCompleto: _formState.nombreCompleto || current.nombreCompleto || current.nombre || '',
    nombre: _formState.nombreCompleto || current.nombre || '',
    usuario: _formState.nombreCompleto || current.usuario || '',
    telefono: _formState.telefono || '',
    avatarUrl: _formState.avatarUrl || '',
    photoURL: _formState.avatarUrl || '',
    fotoURL: _formState.avatarUrl || '',
    profilePhotoUrl: _formState.avatarUrl || '',
    profilePreferences: {
      ...(current.profilePreferences || {}),
      theme: _formState.theme,
      visualDensity: _formState.visualDensity,
      language: _formState.language,
      homeView: _formState.homeView,
      defaultPlaza: _formState.defaultPlaza || String(current.plazaAsignada || current.plaza || '').toUpperCase(),
      avatarFit: _formState.avatarFit,
      notifications: {
        ...(current.profilePreferences?.notifications || {}),
        active: _formState.notifyActive,
        passiveAlerts: _formState.passiveAlerts
      },
      quickHistory: _formState.quickHistory,
      visibleCache: _formState.visibleCache
    },
    updatedAt: Date.now(),
    actualizadoAt: Date.now(),
    updatedFrom: 'app_profile',
  };

  try {
    await db.collection(COL.USERS).doc(docId).set(_cleanUndefined(payload), { merge: true });
    if (!_mounted) return;
    const nextProfile = { ...current, ...payload };
    setState({ profile: nextProfile });
    try {
      localStorage.setItem('mex.profile.preferences', JSON.stringify(payload.profilePreferences));
      localStorage.setItem('mex.profile.visibleCache', _formState.visibleCache ? '1' : '0');
    } catch (_) {}
    _ctx?.shell?.setProfile?.(nextProfile, getState().role);
    _setDirty(false);
    _setStatus('Perfil actualizado correctamente.', 'ok');
  } catch (err) {
    _setStatus(err?.message || 'No se pudieron guardar los cambios.', 'error');
  }
}

function _removeAvatar() {
  const input = _ctx?.container?.querySelector('#appProfileAvatarUrl');
  if (input) input.value = '';
  _syncFormFromDom();
  _renderAvatarPreview();
  _setDirty(true);
  _setStatus('Avatar eliminado de la vista previa. Guarda cambios para fijarlo.', 'info');
}

function _bindAvatarCropper() {
  const c = _ctx?.container;
  if (!c) return;
  const modal = c.querySelector('#appProfileCropModal');
  const canvas = c.querySelector('#appProfileCropCanvas');
  const zoom = c.querySelector('#appProfileCropZoom');
  if (!modal || !canvas) return;

  c.querySelector('#appProfileCropClose')?.addEventListener('click', _closeAvatarCropper);
  c.querySelector('#appProfileCropCancel')?.addEventListener('click', _closeAvatarCropper);
  c.querySelector('#appProfileCropApply')?.addEventListener('click', _confirmAvatarCrop);
  c.querySelector('#appProfileCropReset')?.addEventListener('click', _resetAvatarCrop);
  c.querySelector('#appProfileCropRotateLeft')?.addEventListener('click', () => _rotateAvatarCrop(-90));
  c.querySelector('#appProfileCropRotateRight')?.addEventListener('click', () => _rotateAvatarCrop(90));
  zoom?.addEventListener('input', event => {
    if (!_avatarCrop) return;
    _avatarCrop.zoom = Number(event.target.value || 1);
    _drawAvatarCropper();
  });

  canvas.addEventListener('pointerdown', event => {
    if (!_avatarCrop) return;
    _avatarCrop.dragging = true;
    _avatarCrop.lastX = event.clientX;
    _avatarCrop.lastY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!_avatarCrop?.dragging) return;
    const dx = event.clientX - _avatarCrop.lastX;
    const dy = event.clientY - _avatarCrop.lastY;
    _avatarCrop.lastX = event.clientX;
    _avatarCrop.lastY = event.clientY;
    _avatarCrop.offsetX += dx;
    _avatarCrop.offsetY += dy;
    _drawAvatarCropper();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
    canvas.addEventListener(type, event => {
      if (!_avatarCrop) return;
      _avatarCrop.dragging = false;
      try { canvas.releasePointerCapture?.(event.pointerId); } catch (_) {}
    });
  });
  canvas.addEventListener('wheel', event => {
    if (!_avatarCrop) return;
    event.preventDefault();
    const next = Math.max(1, Math.min(4, _avatarCrop.zoom + (event.deltaY > 0 ? -0.08 : 0.08)));
    _avatarCrop.zoom = next;
    if (zoom) zoom.value = String(next);
    _drawAvatarCropper();
  }, { passive: false });
}

async function _openAvatarCropper(event) {
  const file = event?.target?.files?.[0] || null;
  if (!file) return;
  if (!/^image\//i.test(file.type || '')) {
    _setStatus('Selecciona una imagen válida para el avatar.', 'error');
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    _setStatus('La imagen debe pesar menos de 12 MB.', 'error');
    return;
  }
  _closeAvatarCropper({ keepInput: true, silent: true });
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (!_mounted) {
      URL.revokeObjectURL(url);
      return;
    }
    const baseScale = Math.max(AVATAR_STAGE_SIZE / img.width, AVATAR_STAGE_SIZE / img.height);
    _avatarCrop = {
      file,
      url,
      img,
      baseScale,
      zoom: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      dragging: false,
      lastX: 0,
      lastY: 0
    };
    const modal = _ctx?.container?.querySelector('#appProfileCropModal');
    const zoom = _ctx?.container?.querySelector('#appProfileCropZoom');
    if (zoom) zoom.value = '1';
    modal?.classList.add('is-open');
    modal?.setAttribute('aria-hidden', 'false');
    _drawAvatarCropper();
    _setStatus('Ajusta el recorte y confirma para subir la foto.', 'info');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    _setStatus('No se pudo leer la imagen seleccionada.', 'error');
  };
  img.src = url;
}

async function _confirmAvatarCrop() {
  if (!_avatarCrop) return;
  const current = getState().profile || {};
  const docId = String(current.id || current.email || '').toLowerCase().trim();
  const storageClient = storage || window._storage || (window.firebase?.storage ? window.firebase.storage() : null);
  if (!docId || !storageClient?.ref) {
    _setStatus('Firebase Storage no está disponible para subir avatar.', 'error');
    return;
  }
  const btn = _ctx?.container?.querySelector('#appProfileCropApply');
  const oldText = btn?.textContent || '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Subiendo...';
  }
  _setStatus('Recortando y subiendo avatar...', 'info');
  try {
    const blob = await _avatarCropToBlob();
    const originalName = String(_avatarCrop.file?.name || 'avatar.jpg')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9_.-]+/gi, '-')
      .slice(0, 64) || 'avatar';
    const ref = storageClient.ref(`profile_avatars/${docId}/${Date.now()}-${originalName}-crop.jpg`);
    await ref.put(blob, { contentType: 'image/jpeg' });
    const url = await ref.getDownloadURL();
    const input = _ctx?.container?.querySelector('#appProfileAvatarUrl');
    const fit = _ctx?.container?.querySelector('#appProfileAvatarFit');
    if (input) input.value = url;
    if (fit) fit.value = 'cover';
    _syncFormFromDom();
    _renderAvatarPreview();
    _setDirty(true);
    _closeAvatarCropper({ silent: true });
    _setStatus('Avatar recortado y subido. Guarda cambios para fijarlo en tu perfil.', 'ok');
  } catch (err) {
    _setStatus(err?.message || 'No se pudo subir el avatar recortado.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = oldText || 'Usar esta foto';
    }
  }
}

function _closeAvatarCropper(options = {}) {
  const { keepInput = false, silent = false } = options || {};
  const modal = _ctx?.container?.querySelector('#appProfileCropModal');
  modal?.classList.remove('is-open');
  modal?.setAttribute('aria-hidden', 'true');
  if (_avatarCrop?.url) URL.revokeObjectURL(_avatarCrop.url);
  _avatarCrop = null;
  if (!keepInput) {
    const input = _ctx?.container?.querySelector('#appProfileAvatarFile');
    if (input) input.value = '';
  }
  if (!silent) _setStatus('Recorte cancelado.', 'info');
}

function _resetAvatarCrop() {
  if (!_avatarCrop) return;
  _avatarCrop.zoom = 1;
  _avatarCrop.rotation = 0;
  _avatarCrop.offsetX = 0;
  _avatarCrop.offsetY = 0;
  const zoom = _ctx?.container?.querySelector('#appProfileCropZoom');
  if (zoom) zoom.value = '1';
  _drawAvatarCropper();
}

function _rotateAvatarCrop(deg) {
  if (!_avatarCrop) return;
  _avatarCrop.rotation = (_avatarCrop.rotation + deg) % 360;
  _drawAvatarCropper();
}

function _drawAvatarCropper() {
  const canvas = _ctx?.container?.querySelector('#appProfileCropCanvas');
  const preview = _ctx?.container?.querySelector('#appProfileCropPreview');
  if (!canvas || !_avatarCrop) return;
  canvas.width = AVATAR_STAGE_SIZE;
  canvas.height = AVATAR_STAGE_SIZE;
  _drawAvatarCrop(canvas, { overlay: true, circleMask: false });
  if (preview) {
    preview.width = 128;
    preview.height = 128;
    _drawAvatarCrop(preview, { overlay: false, circleMask: true });
  }
}

function _drawAvatarCrop(canvas, options = {}) {
  if (!_avatarCrop) return;
  const { overlay = false, circleMask = false } = options;
  const size = canvas.width || AVATAR_STAGE_SIZE;
  const ratio = size / AVATAR_STAGE_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  if (circleMask) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2 + _avatarCrop.offsetX * ratio, size / 2 + _avatarCrop.offsetY * ratio);
  ctx.rotate((_avatarCrop.rotation * Math.PI) / 180);
  const scale = _avatarCrop.baseScale * _avatarCrop.zoom * ratio;
  ctx.scale(scale, scale);
  ctx.drawImage(_avatarCrop.img, -_avatarCrop.img.width / 2, -_avatarCrop.img.height / 2);
  ctx.restore();

  if (overlay) {
    const r = size * 0.42;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.46)';
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size / 2 - r, size / 2);
    ctx.lineTo(size / 2 + r, size / 2);
    ctx.moveTo(size / 2, size / 2 - r);
    ctx.lineTo(size / 2, size / 2 + r);
    ctx.stroke();
    ctx.restore();
  }
}

function _avatarCropToBlob() {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  _drawAvatarCrop(canvas, { overlay: false, circleMask: false });
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('No se pudo generar el recorte.'));
    }, 'image/jpeg', 0.9);
  });
}

function _clearViewCache() {
  let removed = 0;
  try {
    [localStorage, sessionStorage].forEach(store => {
      Object.keys(store).forEach(key => {
        if (!/^mex\.app\.(dashboard|mapa|notas-incidencias|incidencias)/.test(key)) return;
        store.removeItem(key);
        removed += 1;
      });
    });
  } catch (_) {}
  _setStatus(`Cache visible limpiado (${removed} entradas).`, 'ok');
}

function _applyDefaultPlazaNow() {
  _syncFormFromDom();
  const next = String(_formState?.defaultPlaza || '').toUpperCase().trim();
  if (!next) return _setStatus('Selecciona una plaza por defecto.', 'error');
  const applied = setCurrentPlaza(next, { source: 'app-profile' });
  _setStatus(`Plaza activa: ${applied || next}.`, 'ok');
}

function _setStatus(msg, type) {
  const el = _ctx?.container?.querySelector('#appProfileStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = `app-profile-status is-${type}`;
}

function _setDirty(isDirty) {
  const c = _ctx?.container;
  if (!c) return;
  c.querySelector('#appProfileSave')?.classList.toggle('is-dirty', Boolean(isDirty));
}

function _renderAvatarPreview() {
  const c = _ctx?.container;
  if (!c) return;
  const url = String(c.querySelector('#appProfileAvatarUrl')?.value || '').trim();
  const holder = c.querySelector('#appProfileAvatarPreview');
  const initials = c.querySelector('#appProfileAvatarInitials');
  if (!holder || !initials) return;
  const fallbackName = String(c.querySelector('#appProfileName')?.value || '').trim() || 'USUARIO';
  const ini = fallbackName.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'U';
  initials.textContent = ini;
  if (url) {
    const safeUrl = url.replace(/"/g, '%22');
    holder.style.backgroundImage = `url("${safeUrl}")`;
    holder.style.backgroundSize = _formState?.avatarFit === 'contain' ? 'contain' : 'cover';
    holder.style.backgroundPosition = 'center';
    holder.style.backgroundRepeat = 'no-repeat';
  } else {
    holder.style.backgroundImage = 'none';
    holder.style.background = '#0f172a';
  }
}

function _makeFormState(profile = {}) {
  return {
    nombreCompleto: String(profile.nombreCompleto || profile.nombre || profile.usuario || '').trim(),
    telefono: String(profile.telefono || '').trim(),
    avatarUrl: String(profile.avatarUrl || profile.photoURL || profile.fotoURL || profile.profilePhotoUrl || '').trim(),
    theme: String(profile?.profilePreferences?.theme || 'light').trim(),
    visualDensity: String(profile?.profilePreferences?.visualDensity || 'compacta').trim(),
    language: String(profile?.profilePreferences?.language || 'es').trim(),
    homeView: String(profile?.profilePreferences?.homeView || 'dashboard').trim(),
    defaultPlaza: String(profile?.profilePreferences?.defaultPlaza || profile.plazaAsignada || profile.plaza || '').trim().toUpperCase(),
    avatarFit: String(profile?.profilePreferences?.avatarFit || 'cover').trim(),
    notifyActive: profile?.profilePreferences?.notifications?.active !== false,
    passiveAlerts: profile?.profilePreferences?.notifications?.passiveAlerts !== false,
    quickHistory: profile?.profilePreferences?.quickHistory !== false,
    visibleCache: profile?.profilePreferences?.visibleCache !== false
  };
}

function _availablePlazas(profile = {}) {
  const fromState = Array.isArray(getState().availablePlazas) ? getState().availablePlazas : [];
  const out = new Set(fromState.map(v => String(v || '').trim().toUpperCase()).filter(Boolean));
  [profile.plazaAsignada, profile.plaza].forEach(v => {
    const val = String(v || '').trim().toUpperCase();
    if (val) out.add(val);
  });
  (Array.isArray(profile.plazasPermitidas) ? profile.plazasPermitidas : []).forEach(v => {
    const val = String(v || '').trim().toUpperCase();
    if (val) out.add(val);
  });
  return [...out];
}

function _html(profile, role, form) {
  const name = form.nombreCompleto || profile.email || 'Usuario';
  const email = profile.email || profile.id || '';
  const roleLabel = ROLE_LABELS[role] || profile.roleLabel || role || 'AUXILIAR';
  const plaza = String(profile.plazaAsignada || profile.plaza || '').toUpperCase().trim() || '—';
  const secondaryPlazas = (Array.isArray(profile.plazasPermitidas) ? profile.plazasPermitidas : [])
    .map(v => String(v || '').toUpperCase().trim())
    .filter(Boolean)
    .join(', ') || 'Sin plazas secundarias';
  const isAdmin = Boolean(profile.isAdmin || profile.isGlobal);
  const plazas = _availablePlazas(profile);
  const plazaOptions = plazas.length
    ? plazas.map(item => `<option value="${escAttr(item)}" ${item === form.defaultPlaza ? 'selected' : ''}>${esc(item)}</option>`).join('')
    : `<option value="${escAttr(form.defaultPlaza)}">${esc(form.defaultPlaza || 'GLOBAL')}</option>`;

  return `
<div class="app-profile">
  <section class="app-profile-hero">
    <div id="appProfileAvatarPreview" class="app-profile-avatar">
      <span id="appProfileAvatarInitials">${esc((name || 'U').slice(0, 1).toUpperCase())}</span>
    </div>
    <div class="app-profile-hero-main">
      <h1>${esc(name)}</h1>
      <p>${esc(email || 'Sin correo')}</p>
      <div class="app-profile-badges">
        <span>${esc(roleLabel)}</span>
        <span>${esc(plaza)}</span>
        <span>${esc(String(profile.status || 'ACTIVO').toUpperCase())}</span>
      </div>
    </div>
    <div class="app-profile-stats">
      <div><strong>${isAdmin ? 'Admin' : 'Operativo'}</strong><small>Nivel</small></div>
      <div><strong>${esc(String(plazas.length || 1))}</strong><small>Plazas</small></div>
      <div><strong>${esc(form.homeView || 'dashboard')}</strong><small>Vista</small></div>
    </div>
  </section>

  <div class="app-profile-body">
    <aside class="app-profile-nav">
      <button class="app-profile-tab" data-target="appProfileGeneral">General</button>
      <button class="app-profile-tab" data-target="appProfilePrefs">Preferencias</button>
      <button class="app-profile-tab" data-target="appProfileAccess">Accesos</button>
      <button class="app-profile-tab" data-target="appProfileLocal">Datos locales</button>
    </aside>
    <div class="app-profile-main">
      <section class="app-profile-card" id="appProfileGeneral" data-profile-search-text="general nombre telefono avatar email rol plaza perfil">
        <h2>General</h2>
        <div class="app-profile-grid">
          <label>Nombre completo
            <input id="appProfileName" value="${escAttr(form.nombreCompleto)}" />
          </label>
          <label>Correo
            <input value="${escAttr(email)}" readonly />
          </label>
          <label>Telefono
            <input id="appProfilePhone" value="${escAttr(form.telefono)}" />
          </label>
          <label>Rol actual
            <input value="${escAttr(roleLabel)}" readonly />
          </label>
          <label>Plaza principal
            <input value="${escAttr(plaza)}" readonly />
          </label>
          <label>Plazas secundarias
            <input value="${escAttr(secondaryPlazas)}" readonly />
          </label>
          <div class="app-profile-avatar-editor app-profile-wide">
            <div>
              <strong>Foto de perfil</strong>
              <span>Elige una imagen, ajusta el recorte y revisa la vista previa antes de subirla.</span>
            </div>
            <div class="app-profile-avatar-editor-actions">
              <button id="appProfileChooseAvatar" type="button">Elegir imagen y recortar</button>
              <button id="appProfileRemoveAvatar" type="button">Quitar foto</button>
              <input id="appProfileAvatarFile" type="file" accept="image/*" />
            </div>
          </div>
          <label class="app-profile-wide">Avatar URL
            <input id="appProfileAvatarUrl" value="${escAttr(form.avatarUrl)}" placeholder="https://..." />
          </label>
          <label>Ajuste de avatar
            <select id="appProfileAvatarFit">
              <option value="cover" ${form.avatarFit === 'cover' ? 'selected' : ''}>Cubrir cuadro</option>
              <option value="contain" ${form.avatarFit === 'contain' ? 'selected' : ''}>Mostrar completo</option>
            </select>
          </label>
        </div>
      </section>

      <section class="app-profile-card" id="appProfilePrefs" data-profile-search-text="preferencias tema densidad idioma vista plaza defecto interfaz">
        <h2>Preferencias de Interfaz</h2>
        <div class="app-profile-grid">
          <label>Tema
            <select id="appProfileTheme">
              <option value="light" ${form.theme === 'light' ? 'selected' : ''}>Claro</option>
              <option value="dark" ${form.theme === 'dark' ? 'selected' : ''}>Oscuro</option>
            </select>
          </label>
          <label>Idioma
            <select id="appProfileLanguage">
              <option value="es" ${form.language === 'es' ? 'selected' : ''}>Espanol</option>
              <option value="en" ${form.language === 'en' ? 'selected' : ''}>English</option>
            </select>
          </label>
          <label>Vista inicial
            <select id="appProfileHomeView">
              <option value="dashboard" ${form.homeView === 'dashboard' ? 'selected' : ''}>Dashboard</option>
              <option value="mapa" ${form.homeView === 'mapa' ? 'selected' : ''}>Mapa</option>
              <option value="mensajes" ${form.homeView === 'mensajes' ? 'selected' : ''}>Mensajes</option>
              <option value="cuadre" ${form.homeView === 'cuadre' ? 'selected' : ''}>Cuadre</option>
            </select>
          </label>
          <label>Densidad visual
            <select id="appProfileDensity">
              <option value="compacta" ${form.visualDensity === 'compacta' ? 'selected' : ''}>Compacta</option>
              <option value="media" ${form.visualDensity === 'media' ? 'selected' : ''}>Media</option>
              <option value="amplia" ${form.visualDensity === 'amplia' ? 'selected' : ''}>Amplia</option>
            </select>
          </label>
          <label>Plaza por defecto
            <select id="appProfileDefaultPlaza">${plazaOptions}</select>
          </label>
          <label class="app-profile-check">
            <input id="appProfileNotifyActive" type="checkbox" ${form.notifyActive ? 'checked' : ''} />
            <span>Notificaciones activas</span>
          </label>
          <label class="app-profile-check">
            <input id="appProfilePassiveAlerts" type="checkbox" ${form.passiveAlerts ? 'checked' : ''} />
            <span>Alertas pasivas</span>
          </label>
          <label class="app-profile-check">
            <input id="appProfileQuickHistory" type="checkbox" ${form.quickHistory ? 'checked' : ''} />
            <span>Historial rápido persistente</span>
          </label>
          <label class="app-profile-check">
            <input id="appProfileVisibleCache" type="checkbox" ${form.visibleCache ? 'checked' : ''} />
            <span>Cache visible de vistas</span>
          </label>
        </div>
      </section>

      <section class="app-profile-card" id="appProfileAccess" data-profile-search-text="accesos seguridad permisos bloqueados lectura">
        <h2>Resumen de Accesos</h2>
        <div class="app-profile-readonly-grid">
          <p><strong>Rol operativo:</strong> ${esc(roleLabel)}</p>
          <p><strong>Nivel:</strong> ${isAdmin ? 'Administrativo' : 'Operativo'}</p>
          <p><strong>Email:</strong> ${esc(email || '-')}</p>
          <p><strong>Plaza:</strong> ${esc(plaza)}</p>
          <p><strong>Campos bloqueados:</strong> email, uid, rol, permisos, isAdmin/isGlobal, plazasPermitidas, plazaAsignada, password, status.</p>
        </div>
      </section>

      <section class="app-profile-card" id="appProfileLocal" data-profile-search-text="cache local datos plaza limpiar rendimiento visibles">
        <h2>Datos Locales</h2>
        <div class="app-profile-readonly-grid">
          <p><strong>Cache visible:</strong> conserva el último mapa/dashboard/incidencias para pintar datos antes de la lectura en vivo.</p>
          <p><strong>Plaza por defecto:</strong> puedes aplicarla ahora sin esperar a recargar sesión.</p>
        </div>
        <div class="app-profile-actions app-profile-actions--inside">
          <button id="appProfileApplyPlaza" type="button">Aplicar plaza por defecto</button>
          <button id="appProfileClearCache" type="button">Limpiar cache de vistas</button>
        </div>
      </section>

      <div class="app-profile-actions">
        <button id="appProfileSave" type="button">Guardar cambios</button>
        <button id="appProfileCancel" type="button">Cancelar</button>
      </div>
      <div id="appProfileStatus" class="app-profile-status"></div>
    </div>
  </div>
  <div id="appProfileCropModal" class="app-profile-crop-modal" aria-hidden="true">
    <div class="app-profile-crop-dialog" role="dialog" aria-modal="true" aria-label="Recortar foto de perfil">
      <header class="app-profile-crop-head">
        <div>
          <strong>Recortar foto de perfil</strong>
          <span>Mueve la imagen y ajusta el zoom antes de subirla.</span>
        </div>
        <button id="appProfileCropClose" type="button" aria-label="Cerrar">×</button>
      </header>
      <div class="app-profile-crop-body">
        <div class="app-profile-crop-stage">
          <canvas id="appProfileCropCanvas" width="${AVATAR_STAGE_SIZE}" height="${AVATAR_STAGE_SIZE}"></canvas>
          <span>Arrastra la imagen para centrarla</span>
        </div>
        <aside class="app-profile-crop-preview">
          <canvas id="appProfileCropPreview" width="128" height="128"></canvas>
          <strong>Así se verá</strong>
          <span>Esta previsualización se actualiza antes de subir.</span>
        </aside>
      </div>
      <div class="app-profile-crop-controls">
        <label>Zoom
          <input id="appProfileCropZoom" type="range" min="1" max="4" step="0.01" value="1" />
        </label>
        <div>
          <button id="appProfileCropRotateLeft" type="button">Girar izq.</button>
          <button id="appProfileCropRotateRight" type="button">Girar der.</button>
          <button id="appProfileCropReset" type="button">Reiniciar</button>
        </div>
      </div>
      <footer class="app-profile-crop-actions">
        <button id="appProfileCropCancel" type="button">Cancelar</button>
        <button id="appProfileCropApply" type="button">Usar esta foto</button>
      </footer>
    </div>
  </div>
</div>`;
}

function _cleanUndefined(value) {
  if (Array.isArray(value)) return value.map(_cleanUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce((acc, [key, val]) => {
    if (val === undefined) return acc;
    acc[key] = _cleanUndefined(val);
    return acc;
  }, {});
}

function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(v) { return esc(v).replace(/'/g, '&#39;'); }
