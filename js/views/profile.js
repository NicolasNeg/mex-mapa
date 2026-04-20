// ═══════════════════════════════════════════════════════════
//  /js/views/profile.js — Lógica de la ruta /profile
//
//  Depende de:
//   - Firebase SDK (compat) cargado antes
//   - /js/core/firebase-init.js (expone firebase global)
// ═══════════════════════════════════════════════════════════
'use strict';

import { db, auth, storage } from '/js/core/database.js';

// ── Estado local ─────────────────────────────────────────────
let _profile      = null;
let _cropState    = null;
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
    _profile = snap.exists ? { id: snap.id, ...snap.data() } : { id: email, email };
    _renderProfile();
  } catch (err) {
    console.error('[profile] load:', err);
    // Mostrar algo mínimo aunque falle Firestore
    const nameEl = document.getElementById('profile-hero-name');
    if (nameEl) nameEl.textContent = email;
  }
}

// ── Render ────────────────────────────────────────────────────
function _renderProfile() {
  const p = _profile;
  if (!p) return;

  const nombre = p.nombre || p.usuario || p.email || '?';
  const email  = p.email  || p.id || '';
  const role   = (p.rol   || p.role || '').toUpperCase();
  const plaza  = (p.plazaAsignada || p.plaza || '').toUpperCase();

  // Avatar
  const av = document.getElementById('profile-avatar');
  if (av) {
    if (p.avatarURL) {
      av.innerHTML = `<img src="${p.avatarURL}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;"
        onerror="this.parentElement.innerHTML='${nombre[0].toUpperCase()}'">`;
    } else {
      av.textContent = nombre[0].toUpperCase();
      av.style.background = _avatarColor(nombre);
    }
  }

  const nameEl = document.getElementById('profile-hero-name');
  const metaEl = document.getElementById('profile-hero-meta');
  const badgesEl = document.getElementById('profile-hero-badges');

  if (nameEl) nameEl.textContent = nombre;
  if (metaEl) metaEl.textContent = [email, plaza].filter(Boolean).join(' · ');
  if (badgesEl) {
    badgesEl.innerHTML = [role, plaza].filter(Boolean)
      .map(b => `<span class="profile-badge">${b}</span>`).join('');
  }
}

function _avatarColor(str) {
  const colors = ['#e53e3e','#dd6b20','#d69e2e','#38a169','#3182ce','#805ad5','#d53f8c','#00b5d8'];
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0;
  return colors[Math.abs(h) % colors.length];
}

// ── Avatar upload ─────────────────────────────────────────────
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
  if (!img) return;
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
  img.style.transformOrigin = 'center center';
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
  const input = document.getElementById('profile-avatar-input');
  if (input) input.value = '';
};

window.profile_guardarAvatar = async function() {
  if (!_profile) return;
  const btn = document.getElementById('profile-crop-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  try {
    const stage = document.getElementById('profile-crop-stage');
    if (!stage || !_cropState) throw new Error('Sin imagen para recortar');

    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(128, 128, 128, 0, Math.PI * 2);
    ctx.clip();

    const sr    = stage.getBoundingClientRect();
    const img   = _cropState.img;
    const scale = _cropState.scale;
    const nw = img.naturalWidth  * scale;
    const nh = img.naturalHeight * scale;
    const cx = (sr.width  - nw) / 2 + _cropState.offsetX;
    const cy = (sr.height - nh) / 2 + _cropState.offsetY;
    const cd = Math.min(sr.width, sr.height) * 0.8;
    const sx = ((sr.width  - cd) / 2 - cx) / scale;
    const sy = ((sr.height - cd) / 2 - cy) / scale;
    const sw = cd / scale;

    ctx.drawImage(img, sx, sy, sw, sw, 0, 0, 256, 256);

    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88));
    const docId = _profile.email || _profile.id;
    const ref   = storage.ref(`avatars/${docId}/avatar.jpg`);
    await ref.put(blob);
    const url   = await ref.getDownloadURL();

    await db.collection('usuarios').doc(docId).update({ avatarURL: url });
    _profile.avatarURL = url;

    const av = document.getElementById('profile-avatar');
    if (av) av.innerHTML = `<img src="${url}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;">`;

    window.profile_cancelarCrop();
    _showToast('Foto actualizada ✓', true);
  } catch (err) {
    console.error('[profile] avatar save:', err);
    _showToast('Error al guardar la foto.', false);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar Foto'; }
  }
};

window.profile_eliminarAvatar = async function() {
  if (!_profile) return;
  if (!confirm('¿Quitar tu foto de perfil?')) return;
  try {
    const docId = _profile.email || _profile.id;
    await db.collection('usuarios').doc(docId).update({ avatarURL: firebase.firestore.FieldValue.delete() });
    _profile.avatarURL = null;
    const av     = document.getElementById('profile-avatar');
    const nombre = _profile.nombre || _profile.email || '?';
    if (av) {
      av.innerHTML = '';
      av.textContent = nombre[0].toUpperCase();
      av.style.background = _avatarColor(nombre);
    }
    _showToast('Foto eliminada', true);
  } catch (err) {
    _showToast('Error al quitar la foto.', false);
  }
};

// ── Toast interno ─────────────────────────────────────────────
function _showToast(msg, ok) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:${ok ? '#22c55e' : '#ef4444'};color:#fff;padding:10px 22px;
    border-radius:12px;font-weight:800;font-size:13px;z-index:9999;
    box-shadow:0 4px 16px rgba(0,0,0,0.3);white-space:nowrap;`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// ── Crop drag (mouse + touch) ─────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const stage = document.getElementById('profile-crop-stage');
  if (!stage) return;

  const getPoint = e => {
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  };

  stage.addEventListener('mousedown', e => {
    if (!_cropState) return;
    _cropDragging = true;
    _cropLast = getPoint(e);
    e.preventDefault();
  });
  stage.addEventListener('touchstart', e => {
    if (!_cropState) return;
    _cropDragging = true;
    _cropLast = getPoint(e);
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

  document.addEventListener('mouseup',  () => { _cropDragging = false; });
  document.addEventListener('touchend', () => { _cropDragging = false; });
});

function _renderPreview() {
  if (!_cropState) return;
  [
    { id: 'profile-preview-circle', size: 96 },
    { id: 'profile-preview-card',   size: 112 },
  ].forEach(({ id, size }) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
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
    const nw = img.naturalWidth  * scale;
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
