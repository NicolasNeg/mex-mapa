'use strict';

import { db, auth, storage } from '/js/core/database.js';
import {
  configureNotifications,
  initNotificationCenter,
  getCurrentDeviceSnapshot,
  openNotificationCenter,
  requestDeviceNotifications,
  updateCurrentDevicePreferences,
  syncCurrentDeviceContext
} from '/js/core/notifications.js';

const PROFILE_BOOTSTRAP_PROGRAMMER_EMAILS = Object.freeze([
  'angelarmentta@icloud.com'
]);
const PROFILE_PRESENCE_STALE_MS = 120000;

let _profile = null;
let _notificationsReady = false;
let _notificationBindingsReady = false;
let _cropState = null;
let _cropDragging = false;
let _cropLast = null;

function _safeText(value) {
  return String(value || '').trim();
}

function _upperText(value) {
  return _safeText(value).toUpperCase();
}

function _lowerText(value) {
  return _safeText(value).toLowerCase();
}

function _profileDocId(email) {
  return _lowerText(email);
}

function _isBootstrapProgrammerEmail(email) {
  return PROFILE_BOOTSTRAP_PROGRAMMER_EMAILS.includes(_profileDocId(email));
}

function _coerceTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function _friendlyRoleLabel(role = '') {
  const normalized = _upperText(role);
  if (!normalized) return 'SIN ROL';
  return normalized.replace(/_/g, ' ');
}

function _getProfileAvatarUrl(profile = {}) {
  return _safeText(
    profile.avatarUrl
    || profile.avatarURL
    || profile.photoURL
    || profile.fotoURL
    || profile.profilePhotoUrl
  );
}

function _currentUserDocId() {
  return _safeText(_profile?.id || _profile?.email || auth.currentUser?.uid || auth.currentUser?.email);
}

function _isProfileOnline(profile = _profile) {
  const lastSeenAt = _coerceTimestamp(profile?.lastSeenAt || profile?.lastActiveAt);
  return profile?.isOnline === true && lastSeenAt > 0 && (Date.now() - lastSeenAt) < PROFILE_PRESENCE_STALE_MS;
}

function _avatarColor(str = '') {
  const colors = ['#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#3182ce', '#805ad5', '#d53f8c', '#00b5d8'];
  let hash = 0;
  for (const char of String(str || '')) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function _normalizeProfile(raw = {}, fallbackUser = null) {
  const email = _profileDocId(raw.email || raw.id || fallbackUser?.email || '');
  const displayName = _upperText(raw.nombre || raw.usuario || fallbackUser?.displayName || email || 'USUARIO');
  const inferredRole = _isBootstrapProgrammerEmail(email)
    ? 'PROGRAMADOR'
    : _upperText(raw.rol || raw.role || (raw.isGlobal ? 'CORPORATIVO_USER' : (raw.isAdmin ? 'VENTAS' : '')));

  return {
    ...raw,
    id: _safeText(raw.id || email || fallbackUser?.uid),
    email,
    nombre: displayName,
    usuario: displayName,
    rol: inferredRole,
    roleLabel: _friendlyRoleLabel(raw.roleLabel || inferredRole),
    plazaAsignada: _upperText(raw.plazaAsignada || raw.plaza || ''),
    telefono: _safeText(raw.telefono),
    status: _upperText(raw.status || 'ACTIVO') || 'ACTIVO',
    isOnline: raw.isOnline === true,
    lastSeenAt: _coerceTimestamp(raw.lastSeenAt || raw.lastActiveAt),
    avatarUrl: _getProfileAvatarUrl(raw),
    avatarPath: _safeText(raw.avatarPath)
  };
}

async function _ensureBootstrapProgrammerProfile(user) {
  const email = _profileDocId(user?.email || '');
  if (!email || !_isBootstrapProgrammerEmail(email)) return null;

  const nombre = _upperText(user?.displayName || 'PROGRAMADOR') || 'PROGRAMADOR';
  const payload = {
    email,
    nombre,
    usuario: nombre,
    rol: 'PROGRAMADOR',
    isAdmin: true,
    isGlobal: true,
    plazaAsignada: '',
    telefono: '',
    status: 'ACTIVO',
    authUid: _safeText(user?.uid),
    bootstrapProgrammer: true,
    lastBootstrapLoginAt: Date.now()
  };

  await db.collection('usuarios').doc(email).set(payload, { merge: true });
  return _normalizeProfile({ id: email, ...payload }, user);
}

async function _loadProfile(user) {
  const email = _profileDocId(user?.email || '');

  try {
    const candidates = [];

    if (email) {
      const docByEmail = await db.collection('usuarios').doc(email).get();
      if (docByEmail.exists) {
        candidates.push(_normalizeProfile({ id: docByEmail.id, ...docByEmail.data(), email }, user));
      }

      const queryByEmail = await db.collection('usuarios').where('email', '==', email).limit(3).get();
      queryByEmail.forEach(doc => {
        candidates.push(_normalizeProfile({ id: doc.id, ...doc.data(), email }, user));
      });
    }

    if ((!candidates.length) && _safeText(user?.uid)) {
      const docByUid = await db.collection('usuarios').doc(user.uid).get();
      if (docByUid.exists) {
        candidates.push(_normalizeProfile({ id: docByUid.id, ...docByUid.data(), email }, user));
      }
    }

    const profileFound = candidates.find(item => item.id === email)
      || candidates.find(item => item.id === _safeText(user?.uid))
      || candidates[0];

    if (profileFound) {
      _profile = profileFound;
    } else if (_isBootstrapProgrammerEmail(email)) {
      _profile = await _ensureBootstrapProgrammerProfile(user);
    } else {
      _profile = _normalizeProfile({}, user);
    }
  } catch (error) {
    console.error('[profile] load:', error);
    _profile = _normalizeProfile({}, user);
  }

  window.CURRENT_USER_PROFILE = _profile;
  _renderProfile();
  try {
    await _bootNotifications();
  } catch (error) {
    console.warn('[profile] notifications bootstrap:', error);
    _showToast('El centro de notificaciones no pudo inicializarse en este momento.', 'warning');
  }
}

function _renderProfile() {
  if (!_profile) return;

  const nombre = _profile.nombre || _profile.usuario || _profile.email || '?';
  const email = _profile.email || _profile.id || '';
  const roleLabel = _profile.roleLabel || _friendlyRoleLabel(_profile.rol);
  const plaza = _upperText(_profile.plazaAsignada || _profile.plaza || '');
  const avatarUrl = _getProfileAvatarUrl(_profile);

  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) {
    if (avatarUrl) {
      avatarEl.innerHTML = `<img src="${avatarUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;">`;
      avatarEl.style.background = '#0f172a';
    } else {
      avatarEl.textContent = nombre.slice(0, 1).toUpperCase() || 'U';
      avatarEl.style.background = _avatarColor(nombre);
    }
  }

  const nameEl = document.getElementById('profile-hero-name');
  const metaEl = document.getElementById('profile-hero-meta');
  const badgesEl = document.getElementById('profile-hero-badges');

  if (nameEl) nameEl.textContent = nombre;
  if (metaEl) metaEl.textContent = [email, plaza || 'SIN PLAZA'].filter(Boolean).join(' · ');
  if (badgesEl) {
    const badges = [roleLabel, plaza || 'SIN PLAZA', _profile.status || 'ACTIVO'];
    badgesEl.innerHTML = badges
      .filter(Boolean)
      .map(label => `<span class="profile-badge">${label}</span>`)
      .join('');
  }

  const removeBtn = document.querySelector('.profile-action-btn.danger');
  if (removeBtn) removeBtn.disabled = !avatarUrl;

  _renderNotificationState();
}

function _toggleSettingButton(id, enabled) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.toggle('is-on', Boolean(enabled));
  btn.classList.toggle('is-off', !enabled);
}

function _friendlyDeviceLabel(device = {}) {
  const platform = _lowerText(device?.platform);
  const browser = _lowerText(device?.browser);
  const platformLabel = platform === 'ios'
    ? 'iPhone'
    : platform === 'android'
      ? 'Celular'
      : (platform === 'mac' || platform === 'windows')
        ? 'Computadora'
        : 'Navegador';
  const browserLabel = browser === 'chrome'
    ? 'Chrome'
    : browser === 'safari'
      ? 'Safari'
      : browser === 'firefox'
        ? 'Firefox'
        : browser === 'edge'
          ? 'Edge'
          : 'Navegador';

  if (platformLabel === 'Navegador') return browserLabel;
  if (platformLabel === 'Computadora') return `${platformLabel} · ${browserLabel}`;
  return platformLabel;
}

function _currentNotificationPrefs(device = {}) {
  return {
    directMessages: device?.notificationPrefs?.directMessages !== false,
    cuadreMissions: device?.notificationPrefs?.cuadreMissions !== false,
    criticalAlerts: device?.notificationPrefs?.criticalAlerts !== false,
    muteAll: device?.notificationPrefs?.muteAll === true
  };
}

function _renderNotificationState() {
  const snapshot = getCurrentDeviceSnapshot();
  const device = snapshot?.currentDevice || {};
  const prefs = _currentNotificationPrefs(device);
  const permission = ('Notification' in window) ? Notification.permission : 'unsupported';
  const masterEnabled = permission === 'granted' && device?.pushEnabled !== false && !prefs.muteAll;

  _toggleSettingButton('profileNotifMasterToggle', masterEnabled);
  _toggleSettingButton('profileNotifMessagesToggle', prefs.directMessages);
  _toggleSettingButton('profileNotifCuadreToggle', prefs.cuadreMissions);
  _toggleSettingButton('profileNotifCriticalToggle', prefs.criticalAlerts);
  _toggleSettingButton('profileNotifMuteToggle', prefs.muteAll);
  _toggleSettingButton('profile-permission-toggle', permission === 'granted');

  const metaEl = document.getElementById('profile-notif-meta');
  const sessionBadge = document.getElementById('profileSessionBadge');
  const permissionSummary = document.getElementById('profilePermissionSummary');
  const currentDeviceSummary = document.getElementById('profileCurrentDeviceSummary');
  const centerBtn = document.getElementById('profile-notif-center-btn');
  const permissionBtn = document.getElementById('profile-permission-toggle');

  if (metaEl) {
    const unread = Number(snapshot?.unread || 0);
    const deviceLabel = _friendlyDeviceLabel(device);
    const modeLabel = masterEnabled ? 'Push activo' : (prefs.muteAll ? 'Equipo silenciado' : 'Push en pausa');
    metaEl.textContent = `${modeLabel} · ${deviceLabel}${unread > 0 ? ` · ${unread} nuevas` : ''}`;
  }

  if (sessionBadge) {
    sessionBadge.textContent = _isProfileOnline(_profile) ? 'En línea' : 'Sesión activa';
  }

  if (permissionSummary) {
    permissionSummary.textContent = permission === 'granted'
      ? 'Este equipo ya puede recibir notificaciones reales del sistema.'
      : permission === 'denied'
        ? 'El permiso está bloqueado en el navegador. Puedes activarlo desde la configuración del sitio.'
        : 'Activa el permiso para recibir mensajes, inventario y alertas críticas.';
  }

  if (currentDeviceSummary) {
    currentDeviceSummary.textContent = `${_friendlyDeviceLabel(device)} · ${_safeText(device?.activeRoute || '/profile')} · ${prefs.muteAll ? 'Silenciado' : 'Disponible'}`;
  }

  if (centerBtn) {
    centerBtn.disabled = false;
  }

  if (permissionBtn) {
    const blocked = permission === 'denied' || permission === 'unsupported';
    permissionBtn.disabled = blocked;
    permissionBtn.title = permission === 'granted'
      ? 'Push activo — abre el centro de notificaciones'
      : blocked
        ? 'El permiso está bloqueado o no está soportado en este navegador'
        : 'Toca para activar notificaciones push';
  }
}

async function _toggleNotificationPref(field) {
  const snapshot = getCurrentDeviceSnapshot();
  const prefs = _currentNotificationPrefs(snapshot?.currentDevice || {});
  const nextValue = !prefs[field];
  await updateCurrentDevicePreferences({ [field]: nextValue });
  await syncCurrentDeviceContext({}, { force: true });
  _renderNotificationState();
}

async function _toggleMasterNotifications() {
  const snapshot = getCurrentDeviceSnapshot();
  const prefs = _currentNotificationPrefs(snapshot?.currentDevice || {});
  const permission = ('Notification' in window) ? Notification.permission : 'unsupported';

  if (permission !== 'granted') {
    await requestDeviceNotifications(true);
    await syncCurrentDeviceContext({}, { force: true });
    _renderNotificationState();
    return;
  }

  await updateCurrentDevicePreferences({ muteAll: !prefs.muteAll });
  await syncCurrentDeviceContext({}, { force: true });
  _renderNotificationState();
}

function _bindNotificationButtons() {
  if (_notificationBindingsReady) return;
  _notificationBindingsReady = true;

  document.getElementById('profileNotifMasterToggle')?.addEventListener('click', () => _toggleMasterNotifications());
  document.getElementById('profileNotifMessagesToggle')?.addEventListener('click', () => _toggleNotificationPref('directMessages'));
  document.getElementById('profileNotifCuadreToggle')?.addEventListener('click', () => _toggleNotificationPref('cuadreMissions'));
  document.getElementById('profileNotifCriticalToggle')?.addEventListener('click', () => _toggleNotificationPref('criticalAlerts'));
  document.getElementById('profileNotifMuteToggle')?.addEventListener('click', () => _toggleNotificationPref('muteAll'));
  document.getElementById('profile-notif-center-btn')?.addEventListener('click', () => openNotificationCenter());
  document.getElementById('profile-permission-toggle')?.addEventListener('click', async () => {
    const permission = ('Notification' in window) ? Notification.permission : 'unsupported';
    if (permission === 'granted') {
      openNotificationCenter();
      return;
    }
    await requestDeviceNotifications(true);
    await syncCurrentDeviceContext({}, { force: true });
    _renderNotificationState();
  });
}

async function _bootNotifications() {
  if (!_profile) return;

  configureNotifications({
    profileGetter: () => _profile,
    getCurrentUserName: () => _upperText(_profile?.nombre || _profile?.usuario || ''),
    getCurrentUserDocId: () => _currentUserDocId(),
    getCurrentPlaza: () => _upperText(
      window.getMexCurrentPlaza?.()
      || _profile?.plazaAsignada
      || _profile?.plaza
      || ''
    ),
    toast: (msg, type = 'info') => _showToast(msg, type),
    routeHandlers: {
      openBuzon: () => { window.location.href = '/mensajes'; },
      openChat: (chatUser = '') => {
        const safeUser = _safeText(chatUser);
        window.location.href = safeUser
          ? `/mensajes?notif=chat&chatUser=${encodeURIComponent(safeUser)}`
          : '/mensajes';
      },
      openCuadre: () => { window.location.href = '/cuadre'; },
      openAlerts: () => { window.location.href = '/mapa?notif=alerts'; }
    }
  });

  _bindNotificationButtons();

  if (!_notificationsReady) {
    await initNotificationCenter();
    _notificationsReady = true;
  } else {
    await syncCurrentDeviceContext({}, { force: true });
  }

  _renderNotificationState();
}

function _showToast(msg, type = 'success') {
  const isError = type === 'error';
  const isWarning = type === 'warning';
  const bg = isError ? '#ef4444' : (isWarning ? '#f59e0b' : '#22c55e');
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:${bg};color:#fff;padding:10px 22px;border-radius:12px;font-weight:800;
    font-size:13px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.3);white-space:nowrap;`;
  el.textContent = _safeText(msg);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

window.profile_subirAvatar = function (inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) {
    _showToast('Imagen demasiado grande. Máximo 12 MB.', 'error');
    inputEl.value = '';
    return;
  }

  const fileName = _lowerText(file.name);
  const fileType = _lowerText(file.type);
  const looksLikeImage = /\.(jpe?g|png|webp|gif|bmp|svg|heic|heif|avif)$/i.test(fileName);
  if (!fileType.startsWith('image/') && !looksLikeImage) {
    _showToast('Selecciona una imagen válida para tu perfil.', 'error');
    inputEl.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = event => _openCrop(_safeText(event?.target?.result));
  reader.readAsDataURL(file);
};

function _openCrop(src) {
  const overlay = document.getElementById('profile-crop-overlay');
  const img = document.getElementById('profile-crop-img');
  if (!overlay || !img || !src) return;

  overlay.style.display = 'flex';
  img.src = src;
  img.onload = () => {
    _cropState = { img, scale: 1, offsetX: 0, offsetY: 0 };
    _positionCrop();
    _renderPreview();
  };
}

function _positionCrop() {
  if (!_cropState) return;
  const { img, scale, offsetX, offsetY } = _cropState;
  img.style.transformOrigin = 'center center';
  img.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

window.profile_ajustarZoom = function (value) {
  if (!_cropState) return;
  _cropState.scale = Math.max(1, Math.min(3, parseFloat(value) || 1));
  _positionCrop();
  _renderPreview();
};

window.profile_cancelarCrop = function () {
  const overlay = document.getElementById('profile-crop-overlay');
  if (overlay) overlay.style.display = 'none';
  _cropState = null;
  const input = document.getElementById('profile-avatar-input');
  if (input) input.value = '';
};

window.profile_guardarAvatar = async function () {
  if (!_profile || !_cropState) return;
  const btn = document.getElementById('profile-crop-save-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Guardando...';
  }

  try {
    const stage = document.getElementById('profile-crop-stage');
    if (!stage || !_cropState) throw new Error('Sin imagen para recortar');

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo preparar el recorte');

    ctx.beginPath();
    ctx.arc(256, 256, 256, 0, Math.PI * 2);
    ctx.clip();

    const stageRect = stage.getBoundingClientRect();
    const img = _cropState.img;
    const scale = _cropState.scale;
    const scaledW = img.naturalWidth * scale;
    const scaledH = img.naturalHeight * scale;
    const drawLeft = (stageRect.width - scaledW) / 2 + _cropState.offsetX;
    const drawTop = (stageRect.height - scaledH) / 2 + _cropState.offsetY;
    const cropDiameter = Math.min(stageRect.width, stageRect.height) * 0.8;
    const sx = ((stageRect.width - cropDiameter) / 2 - drawLeft) / scale;
    const sy = ((stageRect.height - cropDiameter) / 2 - drawTop) / scale;
    const sw = cropDiameter / scale;

    ctx.drawImage(img, sx, sy, sw, sw, 0, 0, 512, 512);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('No se pudo generar la imagen final');

    const docId = _currentUserDocId();
    if (!docId) throw new Error('No se pudo resolver el documento del usuario');

    const previousPath = _safeText(_profile?.avatarPath);
    const previousUrl = _getProfileAvatarUrl(_profile);
    const avatarPath = `profile_avatars/${docId}/avatar_${Date.now()}.jpg`;
    const ref = storage.ref(avatarPath);

    await ref.put(blob, { contentType: 'image/jpeg' });
    const avatarUrl = await ref.getDownloadURL();

    const payload = {
      avatarUrl,
      avatarPath,
      photoURL: avatarUrl,
      fotoURL: avatarUrl,
      profilePhotoUrl: avatarUrl
    };

    await db.collection('usuarios').doc(docId).set(payload, { merge: true });

    if (previousPath && previousPath !== avatarPath) {
      storage.ref(previousPath).delete().catch(() => { });
    } else if (!previousPath && previousUrl && previousUrl !== avatarUrl) {
      storage.refFromURL(previousUrl).delete().catch(() => { });
    }

    if (auth.currentUser?.updateProfile) {
      auth.currentUser.updateProfile({ photoURL: avatarUrl }).catch(() => { });
    }

    _profile = { ..._profile, ...payload };
    window.CURRENT_USER_PROFILE = _profile;
    _renderProfile();
    window.profile_cancelarCrop();
    _showToast('Foto actualizada ✓', 'success');
  } catch (error) {
    console.error('[profile] avatar save:', error);
    _showToast('No se pudo guardar la foto.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons" style="font-size:18px;">check</span> Guardar Foto';
    }
  }
};

window.profile_eliminarAvatar = async function () {
  if (!_profile) return;
  const avatarUrl = _getProfileAvatarUrl(_profile);
  const avatarPath = _safeText(_profile?.avatarPath);
  if (!avatarUrl && !avatarPath) {
    _showToast('No tienes foto de perfil configurada.', 'warning');
    return;
  }

  if (!window.confirm('¿Quitar tu foto de perfil?')) return;

  try {
    if (avatarPath) {
      await storage.ref(avatarPath).delete().catch(() => { });
    } else if (avatarUrl) {
      await storage.refFromURL(avatarUrl).delete().catch(() => { });
    }

    const payload = {
      avatarUrl: '',
      avatarPath: '',
      photoURL: '',
      fotoURL: '',
      profilePhotoUrl: ''
    };

    await db.collection('usuarios').doc(_currentUserDocId()).set(payload, { merge: true });
    if (auth.currentUser?.updateProfile) {
      auth.currentUser.updateProfile({ photoURL: '' }).catch(() => { });
    }

    _profile = { ..._profile, ...payload };
    window.CURRENT_USER_PROFILE = _profile;
    _renderProfile();
    _showToast('Foto eliminada', 'success');
  } catch (error) {
    console.error('[profile] avatar remove:', error);
    _showToast('No se pudo quitar la foto.', 'error');
  }
};

function _renderPreview() {
  if (!_cropState) return;
  const stage = document.getElementById('profile-crop-stage');
  if (!stage) return;

  [
    { id: 'profile-preview-circle', size: 96 },
    { id: 'profile-preview-card', size: 112 }
  ].forEach(({ id, size }) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;

    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();

    const stageRect = stage.getBoundingClientRect();
    const img = _cropState.img;
    const scale = _cropState.scale;
    const scaledW = img.naturalWidth * scale;
    const scaledH = img.naturalHeight * scale;
    const drawLeft = (stageRect.width - scaledW) / 2 + _cropState.offsetX;
    const drawTop = (stageRect.height - scaledH) / 2 + _cropState.offsetY;
    const cropDiameter = Math.min(stageRect.width, stageRect.height) * 0.8;
    const sx = ((stageRect.width - cropDiameter) / 2 - drawLeft) / scale;
    const sy = ((stageRect.height - cropDiameter) / 2 - drawTop) / scale;
    const sw = cropDiameter / scale;

    ctx.drawImage(img, sx, sy, sw, sw, 0, 0, size, size);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const stage = document.getElementById('profile-crop-stage');
  if (stage) {
    const getPoint = event => {
      const touch = event.touches ? event.touches[0] : event;
      return { x: touch.clientX, y: touch.clientY };
    };

    stage.addEventListener('mousedown', event => {
      if (!_cropState) return;
      _cropDragging = true;
      _cropLast = getPoint(event);
      event.preventDefault();
    });
    stage.addEventListener('touchstart', event => {
      if (!_cropState) return;
      _cropDragging = true;
      _cropLast = getPoint(event);
    }, { passive: true });

    document.addEventListener('mousemove', event => {
      if (!_cropDragging || !_cropState || !_cropLast) return;
      const point = getPoint(event);
      _cropState.offsetX += point.x - _cropLast.x;
      _cropState.offsetY += point.y - _cropLast.y;
      _cropLast = point;
      _positionCrop();
      _renderPreview();
    });
    document.addEventListener('touchmove', event => {
      if (!_cropDragging || !_cropState || !_cropLast) return;
      const point = getPoint(event);
      _cropState.offsetX += point.x - _cropLast.x;
      _cropState.offsetY += point.y - _cropLast.y;
      _cropLast = point;
      _positionCrop();
      _renderPreview();
    }, { passive: true });

    document.addEventListener('mouseup', () => { _cropDragging = false; });
    document.addEventListener('touchend', () => { _cropDragging = false; });
  }
});

auth.onAuthStateChanged(async user => {
  if (!user) {
    window.location.replace('/login');
    return;
  }
  await _loadProfile(user);
});
