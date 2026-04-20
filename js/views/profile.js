// ═══════════════════════════════════════════════════════════
//  /js/views/profile.js — Lógica de la ruta /profile
//
//  Depende de:
//   - Firebase SDK (compat) cargado antes
//   - /js/core/firebase-init.js
//   - /api/users.js  (window.api.obtenerPerfilUsuario, etc.)
//   - /api/auth.js   (window.api.cerrarSesion)
//   - /js/core/notifications.js (módulo ES)
// ═══════════════════════════════════════════════════════════
'use strict';

import { db, auth, storage } from '/js/core/database.js';
import {
  configureNotifications,
  getCurrentDeviceSnapshot,
  updateCurrentDevicePreferences,
  requestDeviceNotifications,
} from '/js/core/notifications.js';

// ── Estado local ─────────────────────────────────────────────
let _profile      = null;  // perfil de Firestore
let _cropState    = null;  // { img, scale, offsetX, offsetY }
let _cropDragging = false;
let _cropLast     = null;

// ── Auth guard ───────────────────────────────────────────────
auth.onAuthStateChanged(user => {
  if (!user) { window.location.replace('/login'); return; }
  _loadProfile(user.email);
});

// ── Cargar perfil desde Firestore ────────────────────────────
async function _loadProfile(email) {
  try {
    const snap = await db.collection('usuarios').doc(email).get();
    if (!snap.exists) { _renderEmpty(); return; }
    _profile = { id: snap.id, ...snap.data() };
    _renderProfile();
    _bindNotificationToggles();
  } catch (err) {
    console.error('[profile] load error:', err);
    _renderEmpty();
  }
}

function _renderEmpty() {
  document.getElementById('profile-hero-name').textContent = 'Sin datos';
  document.getElementById('profile-hero-meta').textContent = '';
}

function _renderProfile() {
  const p = _profile;
  const nombre = p.nombre || p.usuario || p.email || '?';
  const email  = p.email  || p.id || '';
  const role   = (p.rol   || p.role || '').toUpperCase();
  const plaza  = (p.plazaAsignada || p.plaza || '').toUpperCase();

  // Avatar
  const av = document.getElementById('profile-avatar');
  if (p.avatarURL) {
    av.innerHTML = `<img src="${p.avatarURL}" alt="Avatar" onerror="this.parentElement.textContent='${nombre[0].toUpperCase()}'">`;
  } else {
    av.textContent = nombre[0].toUpperCase();
    av.style.background = _avatarColor(nombre);
  }

  document.getElementById('profile-hero-name').textContent = nombre;
  document.getElementById('profile-hero-meta').textContent = [email, plaza].filter(Boolean).join(' · ');

  // Badges
  const badges = document.getElementById('profile-hero-badges');
  badges.innerHTML = [role, plaza].filter(Boolean)
    .map(b => `<span class="profile-badge">${b}</span>`).join('');
}

function _avatarColor(str) {
  const colors = ['#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce','#805ad5'];
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

// ── Notificaciones ───────────────────────────────────────────
async function _bindNotificationToggles() {
  try {
    await configureNotifications(_profile);
    const snap = await getCurrentDeviceSnapshot();
    if (!snap) return;

    const map = {
      master:   'profileNotifMasterToggle',
      messages: 'profileNotifMessagesToggle',
      cuadre:   'profileNotifCuadreToggle',
      critical: 'profileNotifCriticalToggle',
      mute:     'profileNotifMuteToggle',
    };

    Object.entries(map).forEach(([key, id]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const on = key === 'mute' ? snap.muted : snap.prefs?.[key] !== false;
      btn.classList.toggle('is-on',  on);
      btn.classList.toggle('is-off', !on);
      btn.onclick = () => _toggleNotifPref(key, btn, snap);
    });

    const meta = document.getElementById('profile-notif-meta');
    if (meta) meta.textContent = snap.deviceLabel || 'Este dispositivo';
  } catch (e) {
    console.warn('[profile] notif bind:', e);
  }
}

async function _toggleNotifPref(key, btn, snap) {
  const wasOn = btn.classList.contains('is-on');
  btn.classList.toggle('is-on',  !wasOn);
  btn.classList.toggle('is-off', wasOn);
  try {
    if (key === 'mute') {
      await updateCurrentDevicePreferences({ muted: !wasOn });
    } else {
      await updateCurrentDevicePreferences({ prefs: { ...snap.prefs, [key]: !wasOn } });
    }
  } catch (e) {
    // revert
    btn.classList.toggle('is-on',  wasOn);
    btn.classList.toggle('is-off', !wasOn);
  }
}

// ── Avatar upload ────────────────────────────────────────────
window.profile_subirAvatar = function(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { alert('Imagen demasiado grande (máx 8 MB).'); return; }

  const reader = new FileReader();
  reader.onload = e => _abrirCrop(e.target.result);
  reader.readAsDataURL(file);
};

function _abrirCrop(src) {
  const overlay = document.getElementById('profile-crop-overlay');
  if (overlay) overlay.style.display = 'flex';

  const img = document.getElementById('profile-crop-img');
  img.src = src;
  img.onload = () => {
    _cropState = { img, scale: 1, offsetX: 0, offsetY: 0 };
    _posicionarCrop();
    _renderPreview();
  };
}

function _posicionarCrop() {
  if (!_cropState) return;
  const { img, scale, offsetX, offsetY } = _cropState;
  img.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

window.profile_ajustarZoom = function(val) {
  if (!_cropState) return;
  _cropState.scale = parseFloat(val);
  _posicionarCrop();
  _renderPreview();
};

window.profile_cancelarCrop = function() {
  const overlay = document.getElementById('profile-crop-overlay');
  if (overlay) overlay.style.display = 'none';
  _cropState = null;
  document.getElementById('profile-avatar-input').value = '';
};

window.profile_guardarAvatar = async function() {
  if (!_profile) return;
  const btn = document.getElementById('profile-crop-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(128, 128, 128, 0, Math.PI * 2);
    ctx.clip();

    const stage = document.getElementById('profile-crop-stage');
    const stageRect = stage.getBoundingClientRect();
    const img  = _cropState.img;
    const scale = _cropState.scale;
    const ox    = _cropState.offsetX;
    const oy    = _cropState.offsetY;
    const nw = img.naturalWidth * scale;
    const nh = img.naturalHeight * scale;
    const cx = (stageRect.width  - nw) / 2 + ox;
    const cy = (stageRect.height - nh) / 2 + oy;
    const circleDiam = Math.min(stageRect.width, stageRect.height) * 0.8;
    const circleX = (stageRect.width  - circleDiam) / 2;
    const circleY = (stageRect.height - circleDiam) / 2;
    const sx = (circleX - cx) / scale;
    const sy = (circleY - cy) / scale;
    const sw = circleDiam / scale;

    ctx.drawImage(img.tagName === 'IMG' ? img : img, sx, sy, sw, sw, 0, 0, 256, 256);

    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88));
    const path = `avatars/${_profile.email || _profile.id}/avatar.jpg`;
    const ref  = storage.ref(path);
    await ref.put(blob);
    const url  = await ref.getDownloadURL();

    await db.collection('usuarios').doc(_profile.email || _profile.id).update({ avatarURL: url });
    _profile.avatarURL = url;

    const av = document.getElementById('profile-avatar');
    if (av) av.innerHTML = `<img src="${url}" alt="Avatar">`;

    profile_cancelarCrop();
  } catch (err) {
    console.error('[profile] avatar save:', err);
    alert('Error al guardar la foto. Intenta de nuevo.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar Foto'; }
  }
};

window.profile_eliminarAvatar = async function() {
  if (!_profile) return;
  if (!confirm('¿Quitar tu foto de perfil actual?')) return;
  try {
    await db.collection('usuarios').doc(_profile.email || _profile.id).update({ avatarURL: firebase.firestore.FieldValue.delete() });
    _profile.avatarURL = null;
    const av = document.getElementById('profile-avatar');
    const nombre = _profile.nombre || _profile.email || '?';
    if (av) { av.innerHTML = ''; av.textContent = nombre[0].toUpperCase(); av.style.background = _avatarColor(nombre); }
  } catch (err) {
    alert('Error al quitar la foto.');
  }
};

// ── Crop touch/mouse drag ─────────────────────────────────────
function _renderPreview() {
  ['profile-preview-circle', 'profile-preview-card'].forEach((id, i) => {
    const canvas = document.getElementById(id);
    if (!canvas || !_cropState) return;
    const size = i === 0 ? 96 : 112;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    const img   = _cropState.img;
    const scale = _cropState.scale;
    const stage = document.getElementById('profile-crop-stage');
    if (!stage) return;
    const sr = stage.getBoundingClientRect();
    const nw = img.naturalWidth * scale;
    const nh = img.naturalHeight * scale;
    const cx = (sr.width  - nw) / 2 + _cropState.offsetX;
    const cy = (sr.height - nh) / 2 + _cropState.offsetY;
    const cd = Math.min(sr.width, sr.height) * 0.8;
    const sx = ((sr.width  - cd) / 2 - cx) / scale;
    const sy = ((sr.height - cd) / 2 - cy) / scale;
    const sw = cd / scale;
    ctx.drawImage(img, sx, sy, sw, sw, 0, 0, size, size);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const stage = document.getElementById('profile-crop-stage');
  if (!stage) return;

  function getPoint(e) {
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  }

  stage.addEventListener('mousedown', e => {
    if (!_cropState) return;
    _cropDragging = true; _cropLast = getPoint(e);
  });
  stage.addEventListener('touchstart', e => {
    if (!_cropState) return;
    _cropDragging = true; _cropLast = getPoint(e);
  }, { passive: true });

  document.addEventListener('mousemove', e => {
    if (!_cropDragging || !_cropState || !_cropLast) return;
    const pt = getPoint(e);
    _cropState.offsetX += pt.x - _cropLast.x;
    _cropState.offsetY += pt.y - _cropLast.y;
    _cropLast = pt;
    _posicionarCrop();
    _renderPreview();
  });
  document.addEventListener('touchmove', e => {
    if (!_cropDragging || !_cropState || !_cropLast) return;
    const pt = getPoint(e);
    _cropState.offsetX += pt.x - _cropLast.x;
    _cropState.offsetY += pt.y - _cropLast.y;
    _cropLast = pt;
    _posicionarCrop();
    _renderPreview();
  }, { passive: true });

  document.addEventListener('mouseup',    () => { _cropDragging = false; });
  document.addEventListener('touchend',   () => { _cropDragging = false; });

  // Activar notificaciones push
  const permBtn = document.getElementById('profile-permission-toggle');
  if (permBtn) {
    permBtn.addEventListener('click', async () => {
      await requestDeviceNotifications();
      _bindNotificationToggles();
    });
  }

  // Centro de notificaciones
  const notifCenterBtn = document.getElementById('profile-notif-center-btn');
  if (notifCenterBtn) {
    notifCenterBtn.addEventListener('click', () => {
      window.location.href = '/mapa'; // ir al mapa para ver el centro
    });
  }
});
