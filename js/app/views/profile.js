'use strict';
// js/app/views/profile.js
// Full-parity profile view for App Shell.
// Matches /profile legacy page in features and UX.

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
import { getState } from '/js/app/app-state.js';

// ── Constants ─────────────────────────────────────────────
const PREFS_KEY = 'mex_profile_preferences_v2';
const PRESENCE_STALE_MS = 120000;
const DEFAULT_PREFS = Object.freeze({
  theme: 'light', language: 'es', homeView: 'dashboard',
  visualDensity: 'compacta', reduceAnimations: false, alertSound: true,
  defaultPlaza: '', mapView: 'mapa', rememberZoom: true,
  rememberPosition: true, showLabels: true, defaultHeatmap: false,
  showBlockedAreas: true, notificationChannel: 'sistema',
  quietHoursStart: '22:00', quietHoursEnd: '07:00'
});

// ── Module state ──────────────────────────────────────────
let _profile = null;
let _prefs = null;
let _dirty = false;
let _notifReady = false;
let _notifBindsReady = false;
let _chromeReady = false;
let _tabsReady = false;
let _observer = null;
let _mounted = false;
let _container = null;
let _cropState = null;
let _cropDragging = false;
let _cropLast = null;
let _docMouseMove = null;
let _docMouseUp = null;
let _docTouchMove = null;
let _docTouchEnd = null;

// ── Mount / Unmount ───────────────────────────────────────
export function mount(ctx) {
  _resetState();
  _container = ctx.container;
  _mounted = true;
  _ensureCss();

  const raw = getState().profile;
  if (!raw) {
    ctx.container.innerHTML = '<div style="padding:40px;color:#ef4444;font-family:Inter,sans-serif;">No se pudo cargar el perfil. Recarga la página.</div>';
    return;
  }

  _profile = _normalizeProfile(raw, _authInstance()?.currentUser);
  _prefs = _loadPrefs(_profile);
  _persistPrefs(_prefs);
  _applyTheme(_prefs.theme);
  window.CURRENT_USER_PROFILE = _profile;

  ctx.container.innerHTML = _html();
  _setupCropDocListeners();
  _bindChrome();
  _initTabs();
  _renderProfile();
  _bootNotifications().catch(err => {
    console.warn('[app/profile] notif boot:', err);
    _toast('El centro de notificaciones no pudo inicializarse.', 'warning');
  });
}

export function unmount() {
  _mounted = false;
  _observer?.disconnect();
  if (_docMouseMove) document.removeEventListener('mousemove', _docMouseMove);
  if (_docMouseUp) document.removeEventListener('mouseup', _docMouseUp);
  if (_docTouchMove) document.removeEventListener('touchmove', _docTouchMove);
  if (_docTouchEnd) document.removeEventListener('touchend', _docTouchEnd);
  _resetState();
}

function _resetState() {
  _profile = null; _prefs = null; _dirty = false;
  _notifReady = false; _notifBindsReady = false;
  _chromeReady = false; _tabsReady = false;
  _observer = null; _container = null;
  _cropState = null; _cropDragging = false; _cropLast = null;
  _docMouseMove = null; _docMouseUp = null;
  _docTouchMove = null; _docTouchEnd = null;
}

function _ensureCss() {
  ['/css/app-profile.css', '/css/profile.css'].forEach(href => {
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      document.head.appendChild(link);
    }
  });
}

// ── Utility ───────────────────────────────────────────────
function _safeText(v) { return String(v ?? '').trim(); }
function _esc(v) {
  return _safeText(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _escAttr(v) { return _esc(v).replace(/'/g, '&#39;'); }
function _upper(v) { return _safeText(v).toUpperCase(); }
function _lower(v) { return _safeText(v).toLowerCase(); }
function _safeArr(v) { return Array.isArray(v) ? v : []; }
function _safeObj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function _normBool(v, fb = false) { return typeof v === 'boolean' ? v : fb; }
function _normPlaza(v) { return _upper(v || '').replace(/\s+/g, ' ').trim(); }
function _coerceTs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  const n = Number(v); return Number.isFinite(n) ? n : 0;
}
function _friendlyRole(role) {
  const n = _upper(role || '');
  return n ? n.replace(/_/g, ' ') : 'SIN ROL';
}
function _fmtDate(ts) {
  const ms = _coerceTs(ts);
  if (!ms) return 'Sin registro';
  try {
    const d = new Date(ms);
    const time = new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(d);
    if (d.toDateString() === new Date().toDateString()) return `Hoy, ${time}`;
    return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch { return 'Sin registro'; }
}
function _avatarColor(str) {
  const cols = ['#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#3182ce', '#805ad5', '#d53f8c', '#00b5d8'];
  let h = 0;
  for (const c of String(str || '')) h = (h * 31 + c.charCodeAt(0)) | 0;
  return cols[Math.abs(h) % cols.length];
}
function _authInstance() {
  if (auth && typeof auth.onAuthStateChanged === 'function') return auth;
  if (window._auth && typeof window._auth.onAuthStateChanged === 'function') return window._auth;
  try { const f = window.firebase?.auth?.(); if (f) return f; } catch {}
  return null;
}
function _isElevated(role) {
  return ['PROGRAMADOR', 'CORPORATIVO', 'CORPORATIVO_USER', 'JEFE DE OPERACION',
    'JEFE_OPERACION', 'JEFE REGIONAL', 'JEFE_REGIONAL', 'ADMIN', 'ADMINISTRADOR'
  ].includes(_upper(role || ''));
}
function _canAdmin(p = _profile) {
  const ov = _safeObj(p?.permissionOverrides);
  if (ov.view_admin_panel === false) return false;
  if (ov.view_admin_panel === true) return true;
  return Boolean(p?.isAdmin || p?.isGlobal || _isElevated(p?.rol));
}
function _canProg(p = _profile) {
  const ov = _safeObj(p?.permissionOverrides);
  if (ov.view_admin_programmer === true) return true;
  if (ov.view_admin_programmer === false) return false;
  return _upper(p?.rol) === 'PROGRAMADOR';
}
function _roleLevelLabel(p = _profile) {
  if (_upper(p?.rol) === 'PROGRAMADOR') return 'Admin técnico';
  if (_canAdmin(p) && p?.isGlobal) return 'Cobertura global';
  if (_canAdmin(p)) return 'Operación administrativa';
  return 'Operación estándar';
}
function _roleScopeLabel(p = _profile) {
  if (_canProg(p)) return 'Lectura + edición + configuración';
  if (_canAdmin(p)) return 'Lectura + edición operativa';
  return 'Lectura + operación';
}
function _availableModules(p = _profile) {
  const mods = ['Dashboard', 'Mapa', 'Mensajes', 'Cuadres', 'Perfil'];
  if (_canAdmin(p)) mods.push('Panel Admin');
  if (_canProg(p)) mods.push('Consola');
  if (_normBool(p?.isGlobal, false)) mods.push('Global');
  return [...new Set(mods)];
}
function _plazas(p = _profile) {
  const set = new Set();
  const main = _normPlaza(p?.plazaAsignada || p?.plaza);
  if (main) set.add(main);
  _safeArr(p?.plazasPermitidas).forEach(item => { const pl = _normPlaza(item); if (pl) set.add(pl); });
  const cur = _normPlaza(window.getMexCurrentPlaza?.());
  if (cur) set.add(cur);
  if (!set.size) set.add('GLOBAL');
  return [...set];
}
function _getAvatarUrl(p = _profile) {
  return _safeText(
    p?.avatarUrl || p?.avatarURL || p?.avatar || p?.foto || p?.fotoPerfil ||
    p?.photoURL || p?.photoUrl || p?.fotoURL || p?.profilePhotoUrl ||
    p?.profilePhotoURL || p?.profileImageUrl || p?.profileImageURL ||
    _authInstance()?.currentUser?.photoURL
  );
}
function _docId() {
  const a = _authInstance();
  return _safeText(_profile?.id || _profile?.email || a?.currentUser?.uid || a?.currentUser?.email);
}
function _isOnline(p = _profile) {
  const ts = _coerceTs(p?.lastSeenAt || p?.lastActiveAt);
  return p?.isOnline === true && ts > 0 && (Date.now() - ts) < PRESENCE_STALE_MS;
}
function _friendlyDevice(dev = {}) {
  const pl = _lower(dev?.platform);
  const br = _lower(dev?.browser);
  const pL = pl === 'ios' ? 'iPhone' : pl === 'android' ? 'Celular' : (pl === 'mac' || pl === 'windows') ? 'Computadora' : 'Navegador';
  const bL = br === 'chrome' ? 'Chrome' : br === 'safari' ? 'Safari' : br === 'firefox' ? 'Firefox' : br === 'edge' ? 'Edge' : 'Navegador';
  if (pL === 'Navegador') return bL;
  if (pL === 'Computadora') return `${pL} · ${bL}`;
  return pL;
}
function _currentNotifPrefs(dev = {}) {
  return {
    directMessages: dev?.notificationPrefs?.directMessages !== false,
    cuadreMissions: dev?.notificationPrefs?.cuadreMissions !== false,
    criticalAlerts: dev?.notificationPrefs?.criticalAlerts !== false,
    muteAll: dev?.notificationPrefs?.muteAll === true
  };
}

// ── Profile normalization ─────────────────────────────────
function _normalizeProfile(raw = {}, fallbackUser = null) {
  const email = _lower(raw.email || raw.id || fallbackUser?.email || '');
  const displayName = _upper(raw.nombre || raw.usuario || fallbackUser?.displayName || email || 'USUARIO');
  const inferredRole = _upper(raw.rol || raw.role || (raw.isGlobal ? 'CORPORATIVO_USER' : (raw.isAdmin ? 'VENTAS' : '')));
  return {
    ...raw,
    id: _safeText(raw.id || email || fallbackUser?.uid),
    email,
    nombre: displayName,
    usuario: displayName,
    rol: inferredRole,
    roleLabel: _friendlyRole(raw.roleLabel || inferredRole),
    plazaAsignada: _normPlaza(raw.plazaAsignada || raw.plaza || ''),
    plazasPermitidas: _safeArr(raw.plazasPermitidas).map(_normPlaza).filter(Boolean),
    telefono: _safeText(raw.telefono),
    status: _upper(raw.status || 'ACTIVO') || 'ACTIVO',
    isOnline: raw.isOnline === true,
    isAdmin: raw.isAdmin === true,
    isGlobal: raw.isGlobal === true,
    lastSeenAt: _coerceTs(raw.lastSeenAt || raw.lastActiveAt),
    avatarUrl: _getAvatarUrl(raw),
    avatarPath: _safeText(raw.avatarPath),
    permissionOverrides: _safeObj(raw.permissionOverrides || raw.permisosUsuario),
    profilePreferences: _safeObj(raw.profilePreferences || raw.uiPreferences)
  };
}

// ── Preferences ───────────────────────────────────────────
function _loadPrefs(p = _profile) {
  const fromDoc = _safeObj(p?.profilePreferences || p?.uiPreferences);
  let fromStorage = {};
  try { fromStorage = _safeObj(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch {}
  const merged = { ...DEFAULT_PREFS, ...fromDoc, ...fromStorage };
  const themeFromStorage = _safeText(localStorage.getItem('mex_mapa_theme')) || DEFAULT_PREFS.theme;
  merged.theme = (_safeText(merged.theme || themeFromStorage)).toLowerCase() === 'dark' ? 'dark' : 'light';
  merged.language = _safeText(merged.language || 'es') || 'es';
  merged.homeView = _safeText(merged.homeView || (_canAdmin(p) ? 'dashboard' : 'mapa')) || 'dashboard';
  merged.visualDensity = _safeText(merged.visualDensity || 'compacta') || 'compacta';
  merged.defaultPlaza = _normPlaza(merged.defaultPlaza || p?.plazaAsignada || window.getMexCurrentPlaza?.() || '');
  merged.mapView = _safeText(merged.mapView || 'mapa') || 'mapa';
  merged.reduceAnimations = _normBool(merged.reduceAnimations, false);
  merged.alertSound = _normBool(merged.alertSound, true);
  merged.rememberZoom = _normBool(merged.rememberZoom, true);
  merged.rememberPosition = _normBool(merged.rememberPosition, true);
  merged.showLabels = _normBool(merged.showLabels, true);
  merged.defaultHeatmap = _normBool(merged.defaultHeatmap, false);
  merged.showBlockedAreas = _normBool(merged.showBlockedAreas, true);
  merged.notificationChannel = _safeText(merged.notificationChannel || 'sistema') || 'sistema';
  merged.quietHoursStart = _safeText(merged.quietHoursStart || '22:00') || '22:00';
  merged.quietHoursEnd = _safeText(merged.quietHoursEnd || '07:00') || '07:00';
  return merged;
}

function _persistPrefs(p = _prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    localStorage.setItem('mex_mapa_theme', p.theme === 'dark' ? 'dark' : 'light');
  } catch {}
}

function _applyTheme(theme = 'light') {
  const isDark = theme === 'dark';
  const root = document.documentElement;
  root.dataset.theme = isDark ? 'dark' : 'light';
  root.classList.toggle('dark-theme', isDark);
  document.body.classList.toggle('dark-theme', isDark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark ? '#0b2548' : '#ffffff');
}

// ── HTML generation ───────────────────────────────────────
function _field(label, id, type = 'text', readonly = false) {
  const roStyle = readonly ? 'background:#f8fafc;color:#64748b;' : 'background:#fff;color:#0f172a;';
  return `<div>
    <label style="display:block;font-size:12px;font-weight:700;color:#64748b;margin-bottom:6px;">${label}</label>
    <input id="${id}" type="${type}" value="" ${readonly ? 'readonly' : ''} style="border:1px solid #dbe3ef;border-radius:10px;width:100%;min-height:40px;padding:8px 12px;font-size:14px;box-sizing:border-box;${roStyle}">
  </div>`;
}

function _selectField(label, id, options) {
  const opts = options.map(([val, text]) => `<option value="${_escAttr(val)}">${_esc(text)}</option>`).join('');
  return `<div>
    <label style="display:block;font-size:12px;font-weight:700;color:#64748b;margin-bottom:6px;">${label}</label>
    <select id="${id}" style="width:100%;border:1px solid #dbe3ef;border-radius:10px;min-height:40px;padding:8px 12px;font-size:14px;background:#fff;color:#0f172a;box-sizing:border-box;">${opts}</select>
  </div>`;
}

function _toggleRow(label, desc, id) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;">
    <div>
      <p style="margin:0;font-size:13px;font-weight:600;color:#0f172a;">${label}</p>
      ${desc ? `<p style="margin:2px 0 0;font-size:11px;color:#64748b;">${desc}</p>` : ''}
    </div>
    <button id="${id}" class="profile-tail-switch is-off" aria-pressed="false"></button>
  </div>`;
}

function _notifRow(label, id) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;">
    <span style="font-size:13px;color:#334155;">${label}</span>
    <button id="${id}" class="profile-tail-switch is-on" aria-pressed="true"></button>
  </div>`;
}

function _html() {
  const plazaOpts = _plazas().map(p =>
    `<option value="${_escAttr(p)}">${_esc(p)}</option>`
  ).join('') || '<option value="">GLOBAL</option>';

  const statItems = [
    { id: 'profile-stat-modules', label: 'Módulos', sub: 'Acceso operativo' },
    { id: 'profile-stat-notifications', label: 'Alertas', sub: 'Alertas en equipo' },
    { id: 'profile-stat-device', label: 'Dispositivo', sub: 'Plataforma actual' },
    { id: 'profile-stat-home', label: 'Vista', sub: 'Pantalla inicial' }
  ];

  const navItems = [
    ['profile-section-general', 'account_circle', 'General'],
    ['profile-section-preferencias', 'tune', 'Preferencias'],
    ['profile-section-mapa', 'map', 'Mapa'],
    ['profile-section-notificaciones', 'notifications', 'Notificaciones'],
    ['profile-section-seguridad', 'verified_user', 'Seguridad'],
    ['profile-section-accesos', 'lock_open', 'Accesos'],
    ['profile-section-atajos', 'keyboard', 'Atajos'],
  ];

  return `
<div id="profileApp" style="padding:0 0 80px;width:100%;">

  <!-- ── Hero ── -->
  <div style="background:#fff;border-radius:20px;padding:28px;box-shadow:0 10px 24px rgba(15,23,42,0.06);border:1px solid #e2e8f0;margin-bottom:24px;">
    <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;">

      <!-- Avatar -->
      <div style="position:relative;flex-shrink:0;">
        <div id="profile-avatar" style="width:112px;height:112px;border-radius:20px;overflow:hidden;background:#0f172a;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:800;color:#fff;cursor:pointer;"
             onclick="document.getElementById('profile-avatar-input').click()">U</div>
        <button onclick="document.getElementById('profile-avatar-input').click()"
          style="position:absolute;bottom:-8px;right:-8px;width:32px;height:32px;border-radius:10px;background:#0f172a;color:#fff;border:2px solid #fff;cursor:pointer;display:flex;align-items:center;justify-content:center;"
          title="Cambiar foto">
          <span class="material-symbols-outlined" style="font-size:16px;">edit</span>
        </button>
        <button id="profile-btn-quitar-foto"
          style="display:none;position:absolute;top:-8px;right:-8px;width:26px;height:26px;border-radius:999px;background:#ef4444;color:#fff;border:none;cursor:pointer;align-items:center;justify-content:center;font-size:16px;line-height:1;"
          title="Quitar foto">×</button>
      </div>

      <!-- Name / Email / Badges -->
      <div style="flex:1;min-width:200px;">
        <h1 id="profile-hero-name" style="margin:0 0 4px;font-size:26px;font-weight:800;color:#0f172a;">Cargando...</h1>
        <p id="profile-hero-email" style="margin:0 0 10px;color:#64748b;font-size:14px;">Cargando...</p>
        <div id="profile-hero-badges" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
        <p id="profile-hero-meta" style="margin:8px 0 0;font-size:12px;color:#94a3b8;"></p>
      </div>

      <!-- Stats -->
      <div style="display:grid;grid-template-columns:repeat(4,minmax(90px,1fr));gap:10px;min-width:320px;">
        ${statItems.map(s => `
          <div style="background:#f1f5f9;border-radius:12px;padding:12px;">
            <p style="font-size:11px;color:#64748b;margin:0 0 4px;">${s.label}</p>
            <p id="${s.id}" style="font-size:22px;font-weight:800;color:#0f172a;margin:0;">—</p>
            <p style="font-size:10px;color:#94a3b8;margin:4px 0 0;">${s.sub}</p>
          </div>`).join('')}
      </div>
    </div>
  </div>

  <!-- ── Body layout ── -->
  <div style="display:flex;gap:20px;align-items:flex-start;">

    <!-- Sidebar nav -->
    <aside style="width:210px;flex-shrink:0;position:sticky;top:80px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:12px;">
      <div style="padding:6px 8px 10px;border-bottom:1px solid #e2e8f0;margin-bottom:8px;">
        <p style="margin:0;font-size:13px;font-weight:700;color:#0f172a;">Ajustes de cuenta</p>
        <p style="margin:3px 0 0;font-size:11px;color:#64748b;">Administra tu perfil</p>
      </div>
      ${navItems.map(([target, icon, label]) => `
        <button class="profile-tab" data-target="${target}"
          style="width:100%;display:flex;align-items:center;gap:10px;padding:9px 10px;border:none;background:transparent;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;color:#64748b;text-align:left;margin-bottom:3px;transition:background 0.15s,color 0.15s;">
          <span class="material-symbols-outlined" style="font-size:18px;">${icon}</span>${label}
        </button>`).join('')}
    </aside>

    <!-- Sections -->
    <div style="flex:1;min-width:0;display:grid;gap:20px;">

      <!-- ── General ── -->
      <section id="profile-section-general" style="background:#fff;border-radius:18px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(15,23,42,0.04);overflow:hidden;">
        <div style="padding:16px 22px;border-bottom:1px solid #e2e8f0;">
          <h2 style="margin:0;font-size:18px;font-weight:800;color:#0f172a;">General</h2>
        </div>
        <div style="padding:22px;display:grid;grid-template-columns:repeat(2,1fr);gap:14px;">
          ${_field('Nombre completo', 'profile-name-input', 'text', true)}
          ${_field('Correo', 'profile-email-input', 'email', true)}
          ${_field('Teléfono', 'profile-phone-input', 'tel', false)}
          ${_field('Rol actual', 'profile-role-input', 'text', true)}
          ${_field('Plaza principal', 'profile-main-plaza-input', 'text', true)}
          ${_field('Plazas secundarias', 'profile-secondary-plazas-input', 'text', true)}
          <div style="grid-column:1/-1;">
            <label style="font-size:12px;font-weight:700;color:#64748b;">Estado de cuenta</label>
            <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
              <div style="width:10px;height:10px;border-radius:999px;background:#22c55e;flex-shrink:0;"></div>
              <span id="profile-status-input" style="font-size:14px;font-weight:600;color:#0f172a;">Activo</span>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Preferencias ── -->
      <section id="profile-section-preferencias" style="background:#fff;border-radius:18px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(15,23,42,0.04);overflow:hidden;">
        <div style="padding:16px 22px;border-bottom:1px solid #e2e8f0;">
          <h2 style="margin:0;font-size:18px;font-weight:800;color:#0f172a;">Preferencias de Interfaz</h2>
        </div>
        <div style="padding:22px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
            <div style="display:grid;gap:14px;">
              ${_selectField('Tema', 'profile-theme-select', [['light', 'Claro'], ['dark', 'Oscuro']])}
              ${_selectField('Idioma', 'profile-language-select', [['es', 'Español'], ['en', 'English']])}
              ${_selectField('Vista inicial', 'profile-home-view-select', [['dashboard', 'Dashboard'], ['mapa', 'Mapa'], ['mensajes', 'Mensajes'], ['cuadre', 'Cuadres']])}
              ${_selectField('Densidad visual', 'profile-density-select', [['compacta', 'Compacta'], ['media', 'Media'], ['amplia', 'Amplia']])}
            </div>
            <div style="display:grid;gap:4px;align-content:start;padding-top:4px;">
              <div style="height:1px;background:#e2e8f0;margin-bottom:8px;"></div>
              ${_toggleRow('Reducir animaciones', 'Navegación más rápida', 'profile-reduce-motion-toggle')}
              <div style="height:1px;background:#e2e8f0;"></div>
              ${_toggleRow('Sonido de alertas', 'Click y campanas de error', 'profile-alert-sound-toggle')}
            </div>
          </div>
        </div>
      </section>

      <!-- ── Mapa ── -->
      <section id="profile-section-mapa" style="background:#fff;border-radius:18px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(15,23,42,0.04);overflow:hidden;">
        <div style="padding:16px 22px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">
          <h2 style="margin:0;font-size:18px;font-weight:800;color:#0f172a;">Preferencias Operativas</h2>
          <span style="font-size:11px;font-weight:700;color:#64748b;background:#f1f5f9;padding:3px 10px;border-radius:8px;">Mapa Global</span>
        </div>
        <div style="padding:22px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
            <div style="display:grid;gap:14px;">
              <div>
                <label style="display:block;font-size:12px;font-weight:700;color:#64748b;margin-bottom:6px;">Plaza por defecto</label>
                <select id="profile-default-plaza-select" style="width:100%;border:1px solid #dbe3ef;border-radius:10px;min-height:40px;padding:8px 12px;font-size:14px;background:#fff;color:#0f172a;box-sizing:border-box;">${plazaOpts}</select>
              </div>
              ${_selectField('Vista inicial del mapa', 'profile-map-view-select', [['mapa', 'Mapa interactivo'], ['dashboard', 'Dashboard analítico'], ['resumen', 'Resumen operativo']])}
            </div>
            <div style="display:grid;gap:2px;align-content:start;padding-top:4px;">
              ${_toggleRow('Recordar zoom', '', 'profile-remember-zoom-toggle')}
              <div style="height:1px;background:#e2e8f0;"></div>
              ${_toggleRow('Recordar posición', '', 'profile-remember-position-toggle')}
              <div style="height:1px;background:#e2e8f0;"></div>
              ${_toggleRow('Mostrar etiquetas (Labels)', '', 'profile-show-labels-toggle')}
              <div style="height:1px;background:#e2e8f0;"></div>
              ${_toggleRow('Heatmap encendido al iniciar', '', 'profile-heatmap-toggle')}
              <div style="height:1px;background:#e2e8f0;"></div>
              ${_toggleRow('Mostrar zonas bloqueadas', '', 'profile-show-blocked-toggle')}
            </div>
          </div>
        </div>
      </section>

      <!-- ── Seguridad ── -->
      <section id="profile-section-seguridad" style="background:#fff;border-radius:18px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(15,23,42,0.04);overflow:hidden;">
        <div style="padding:16px 22px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">
          <h2 style="margin:0;font-size:18px;font-weight:800;color:#0f172a;">Seguridad &amp; Acceso</h2>
          <span id="profileSessionBadge" style="font-size:11px;font-weight:700;color:#15803d;background:#dcfce7;padding:3px 10px;border-radius:8px;">Sesión activa</span>
        </div>
        <div style="padding:22px;display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:18px;display:flex;gap:14px;">
            <div style="background:#dcfce7;width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <span class="material-symbols-outlined" style="color:#16a34a;">devices</span>
            </div>
            <div style="flex:1;min-width:0;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:800;color:#0f172a;">Estado de Dispositivo</p>
              <p id="profileCurrentDeviceSummary" style="margin:0 0 4px;font-size:12px;color:#64748b;">Cargando...</p>
              <p id="profilePermissionSummary" style="margin:0 0 8px;font-size:11px;color:#94a3b8;">Revisando notificaciones...</p>
              <button id="profile-permission-toggle" style="color:#0f172a;font-size:12px;font-weight:700;background:none;border:none;cursor:pointer;padding:0;text-decoration:underline;">Evaluar notificaciones de este equipo</button>
            </div>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:18px;display:flex;gap:14px;">
            <div style="background:#e0e7ff;width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <span class="material-symbols-outlined" style="color:#4338ca;">shield_locked</span>
            </div>
            <div style="flex:1;min-width:0;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:800;color:#0f172a;">Autenticación / Credenciales</p>
              <p style="margin:0 0 10px;font-size:12px;color:#64748b;">Administra el acceso a tu cuenta operativa</p>
              <div style="display:flex;gap:14px;flex-wrap:wrap;">
                <button id="profile-reset-password-btn" style="color:#0f172a;font-size:12px;font-weight:700;background:none;border:none;cursor:pointer;padding:0;text-decoration:underline;">Renovar Contraseña</button>
                <button id="profile-close-sessions-btn" style="color:#dc2626;font-size:12px;font-weight:700;background:none;border:none;cursor:pointer;padding:0;text-decoration:underline;">Cerrar Sesiones Anómalas</button>
              </div>
            </div>
          </div>
          <div style="grid-column:1/-1;border-top:1px solid #e2e8f0;padding-top:16px;">
            <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 10px;">Historial de Conexión</p>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span class="material-symbols-outlined" style="color:#94a3b8;">login</span>
                <div>
                  <p style="margin:0;font-size:13px;font-weight:600;color:#0f172a;">Último acceso a la consola</p>
                  <p id="profile-last-access-label" style="margin:2px 0 0;font-size:11px;color:#64748b;">Hoy</p>
                </div>
              </div>
              <span style="font-size:12px;font-weight:700;color:#16a34a;">Sesión autorizada</span>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Notificaciones ── -->
      <section id="profile-section-notificaciones" style="background:#fff;border-radius:18px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(15,23,42,0.04);overflow:hidden;">
        <div style="padding:16px 22px;border-bottom:1px solid #e2e8f0;">
          <h2 style="margin:0;font-size:18px;font-weight:800;color:#0f172a;">Notificaciones de este Equipo</h2>
        </div>
        <div style="padding:22px;display:grid;gap:18px;">
          <div style="display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <span class="material-symbols-outlined" style="color:#0f172a;">notifications_active</span>
              <div>
                <p style="margin:0;font-size:13px;font-weight:700;color:#0f172a;">Master Toggle</p>
                <p style="margin:2px 0 0;font-size:11px;color:#64748b;">Encender/apagar alertas (No afecta inbox)</p>
              </div>
            </div>
            <button id="profileNotifMasterToggle" class="profile-tail-switch is-on" aria-pressed="true"></button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
            <div>
              <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">Tipos de Alerta</p>
              ${_notifRow('Nuevos Mensajes / Inbox', 'profileNotifMessagesToggle')}
              ${_notifRow('Modificaciones a mi Cuadre', 'profileNotifCuadreToggle')}
              ${_notifRow('Notificaciones Críticas del Sistema', 'profileNotifCriticalToggle')}
              ${_notifRow('Modo No Molestar en este navegador', 'profileNotifMuteToggle')}
            </div>
            <div style="display:grid;gap:14px;">
              <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">Enrutamiento</p>
              ${_selectField('Canal preferido', 'profile-notif-channel-select', [['sistema', 'Notificación Push Web'], ['email', 'Sólo Correo HTML'], ['ambos', 'Ambos']])}
              <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">Horario Silencioso</p>
              <div style="display:flex;gap:10px;">
                <div style="flex:1;">
                  <label style="font-size:11px;color:#64748b;margin-bottom:4px;display:block;">Inicia</label>
                  <input id="profile-quiet-start" type="time" value="22:00" style="width:100%;border:1px solid #dbe3ef;border-radius:8px;padding:8px;font-size:13px;background:#fff;box-sizing:border-box;">
                </div>
                <div style="flex:1;">
                  <label style="font-size:11px;color:#64748b;margin-bottom:4px;display:block;">Termina</label>
                  <input id="profile-quiet-end" type="time" value="07:00" style="width:100%;border:1px solid #dbe3ef;border-radius:8px;padding:8px;font-size:13px;background:#fff;box-sizing:border-box;">
                </div>
              </div>
              <p id="profile-notif-meta" style="margin:0;font-size:11px;color:#94a3b8;">Push activo · Sin eventos recientes</p>
              <button id="profile-notif-center-btn" style="display:inline-flex;align-items:center;gap:6px;color:#0f172a;font-size:12px;font-weight:700;background:none;border:none;cursor:pointer;padding:0;text-decoration:underline;" type="button">
                <span class="material-symbols-outlined" style="font-size:16px;">notifications</span>
                Abrir centro de notificaciones
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Accesos ── -->
      <section id="profile-section-accesos" style="background:#fff;border-radius:18px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(15,23,42,0.04);overflow:hidden;">
        <div style="padding:16px 22px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">
          <h2 style="margin:0;font-size:18px;font-weight:800;color:#0f172a;">Resumen de Accesos</h2>
          <span id="profile-admin-chip" style="display:none;font-size:11px;font-weight:700;color:#4338ca;background:#e0e7ff;padding:3px 10px;border-radius:8px;">Admin</span>
        </div>
        <div style="padding:22px;display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div><p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">Rol operativo</p><p id="profile-access-role" style="margin:4px 0 0;font-size:14px;font-weight:700;color:#0f172a;">-</p></div>
          <div><p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">Nivel</p><p id="profile-access-level" style="margin:4px 0 0;font-size:14px;font-weight:700;color:#0f172a;">-</p></div>
          <div style="grid-column:1/-1;"><p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">Módulos habilitados</p><p id="profile-access-modules" style="margin:4px 0 0;font-size:13px;color:#334155;">-</p></div>
          <div style="grid-column:1/-1;"><p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">Cobertura de plazas</p><p id="profile-access-plazas" style="margin:4px 0 0;font-size:13px;color:#334155;">-</p></div>
          <div style="grid-column:1/-1;"><p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">Alcance</p><p id="profile-access-scope" style="margin:4px 0 0;font-size:13px;color:#334155;">-</p></div>
        </div>
      </section>

      <!-- ── Atajos ── -->
      <section id="profile-section-atajos" style="background:#fff;border-radius:18px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(15,23,42,0.04);overflow:hidden;">
        <div style="padding:16px 22px;border-bottom:1px solid #e2e8f0;">
          <h2 style="margin:0;font-size:18px;font-weight:800;color:#0f172a;">Atajos de Navegación</h2>
        </div>
        <div style="padding:22px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">
          ${[
            ['/app/dashboard', 'Inicio', 'Dashboard'],
            ['/app/mapa', 'Operación', 'Mapa'],
            ['/app/mensajes', 'Comunicación', 'Mensajes'],
            ['/app/cuadre', 'Inventario', 'Cuadres']
          ].map(([href, cat, name]) =>
            `<a href="${href}" data-app-route="${href}"
              style="display:block;border:1px solid #e2e8f0;border-radius:14px;padding:14px;text-decoration:none;color:inherit;transition:background 0.15s;"
              onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
              <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;">${cat}</p>
              <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#0f172a;">${name}</p>
            </a>`).join('')}
        </div>
      </section>

    </div><!-- /sections -->
  </div><!-- /body layout -->
</div><!-- /profileApp -->

<!-- Floating save button -->
<div style="position:fixed;bottom:20px;right:20px;z-index:40;">
  <button id="profile-save-btn" type="button"
    style="display:inline-flex;align-items:center;gap:8px;background:#0f172a;color:#fff;font-weight:800;padding:12px 22px;border-radius:14px;border:none;cursor:pointer;font-size:14px;box-shadow:0 8px 24px rgba(15,23,42,0.2);font-family:inherit;">
    <span class="material-symbols-outlined" style="font-size:18px;">save</span>
    Guardar cambios
  </button>
</div>

<!-- Avatar file input -->
<input id="profile-avatar-input" type="file" accept="image/*" style="display:none;">

<!-- Crop overlay -->
<div id="profile-crop-overlay" class="profile-crop-overlay" style="display:none;">
  <div class="profile-crop-card">
    <div class="profile-crop-head">
      <div>
        <h3 class="profile-crop-title">Ajustar foto de perfil</h3>
        <p class="profile-crop-sub">Arrastra la imagen y usa el zoom para centrar tu avatar.</p>
      </div>
      <button type="button" class="profile-crop-close" id="profile-crop-close-btn" aria-label="Cerrar">×</button>
    </div>
    <div class="profile-crop-stage-wrap">
      <div id="profile-crop-stage" class="profile-crop-stage">
        <img id="profile-crop-img" class="profile-crop-image" alt="Recorte de avatar">
        <div class="profile-crop-mask"></div>
      </div>
    </div>
    <div class="profile-crop-zoom">
      <label for="profile-crop-zoom-input">Zoom</label>
      <input id="profile-crop-zoom-input" type="range" min="1" max="4" step="0.01" value="1">
      <p>1x – 4x</p>
    </div>
    <div class="profile-crop-previews">
      <div class="profile-crop-preview-item">
        <canvas id="profile-preview-circle" width="96" height="96"></canvas>
        <span>Avatar</span>
      </div>
      <div class="profile-crop-preview-item">
        <canvas id="profile-preview-card" width="112" height="112"></canvas>
        <span>Vista previa</span>
      </div>
    </div>
    <div class="profile-crop-actions">
      <button type="button" class="profile-crop-btn cancel" id="profile-crop-cancel-btn">Cancelar</button>
      <button id="profile-crop-save-btn" type="button" class="profile-crop-btn confirm">
        <span class="material-symbols-outlined" style="font-size:16px;">check</span>
        Guardar Foto
      </button>
    </div>
  </div>
</div>`;
}

// ── Render ────────────────────────────────────────────────
function _renderProfile() {
  if (!_profile || !_mounted) return;
  const nombre = _profile.nombre || _profile.usuario || _profile.email || '?';
  const email = _profile.email || _profile.id || '';
  const roleLabel = _profile.roleLabel || _friendlyRole(_profile.rol);
  const plaza = _normPlaza(_profile.plazaAsignada || _profile.plaza || '');
  const extraPlazas = _safeArr(_profile.plazasPermitidas).filter(Boolean);
  const avatarUrl = _getAvatarUrl(_profile);

  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) {
    const ini = (nombre.slice(0, 1).toUpperCase() || 'U');
    if (avatarUrl) {
      avatarEl.dataset.initial = ini;
      avatarEl.innerHTML = `<img src="${_esc(avatarUrl)}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;" referrerpolicy="no-referrer" onerror="this.parentElement.textContent=this.parentElement.dataset.initial||'U';">`;
      avatarEl.style.background = '#0f172a';
    } else {
      avatarEl.textContent = ini;
      avatarEl.style.background = _avatarColor(nombre);
    }
  }

  const nameEl = document.getElementById('profile-hero-name');
  const emailEl = document.getElementById('profile-hero-email');
  const metaEl = document.getElementById('profile-hero-meta');
  const badgesEl = document.getElementById('profile-hero-badges');
  if (nameEl) nameEl.textContent = nombre;
  if (emailEl) emailEl.textContent = email || 'Sin correo';
  if (metaEl) metaEl.textContent = [
    `Rol: ${roleLabel}`,
    `Plaza: ${plaza || 'Sin plaza'}`,
    `Estado: ${_profile.status || 'ACTIVO'}`,
    `Último acceso: ${_fmtDate(_profile.lastSeenAt || Date.now())}`
  ].join(' · ');
  if (badgesEl) {
    badgesEl.innerHTML = [roleLabel, _canAdmin() ? 'ADMIN' : '', plaza || 'SIN PLAZA', _profile.status || 'ACTIVO']
      .filter(Boolean)
      .map(b => `<span class="profile-badge">${_esc(b)}</span>`)
      .join('');
  }
  const removeBtn = document.getElementById('profile-btn-quitar-foto');
  if (removeBtn) removeBtn.style.display = avatarUrl ? 'flex' : 'none';

  _renderHeroStats();
  _renderGeneralInfo({ nombre, email, roleLabel, plaza, extraPlazas });
  _renderPrefsControls();
  _renderAccessSummary();
  _renderNotifState();
  _setDirty(false);
}

function _setInput(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = _safeText(value);
}
function _setSelect(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = _safeText(value);
  if (v && [...el.options].some(o => o.value === v)) el.value = v;
}
function _toggleBtn(id, enabled) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.toggle('is-on', Boolean(enabled));
  btn.classList.toggle('is-off', !Boolean(enabled));
  btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
}

function _renderGeneralInfo({ nombre, email, roleLabel, plaza, extraPlazas }) {
  _setInput('profile-name-input', nombre);
  _setInput('profile-email-input', email);
  _setInput('profile-phone-input', _profile?.telefono || '');
  _setInput('profile-role-input', roleLabel);
  _setInput('profile-main-plaza-input', plaza || 'Sin plaza');
  _setInput('profile-secondary-plazas-input', extraPlazas.length ? extraPlazas.join(', ') : 'Sin plazas secundarias');
  _setInput('profile-status-input', _profile?.status || 'ACTIVO');
  const lastEl = document.getElementById('profile-last-access-label');
  if (lastEl) lastEl.textContent = _fmtDate(_profile?.lastSeenAt || _profile?.lastActiveAt || Date.now());
}

function _renderHeroStats() {
  const mods = _availableModules(_profile);
  const dev = getCurrentDeviceSnapshot()?.currentDevice || {};
  const np = _currentNotifPrefs(dev);
  const activeAlerts = [np.directMessages, np.cuadreMissions, np.criticalAlerts].filter(Boolean).length;
  const statsEl = document.getElementById('profile-stat-modules');
  const notEl = document.getElementById('profile-stat-notifications');
  const devEl = document.getElementById('profile-stat-device');
  const homeEl = document.getElementById('profile-stat-home');
  if (statsEl) statsEl.textContent = String(mods.length);
  if (notEl) notEl.textContent = String(activeAlerts);
  if (devEl) devEl.textContent = _friendlyDevice(dev);
  if (homeEl) homeEl.textContent = (_prefs?.homeView || 'dashboard').replace(/^./, c => c.toUpperCase());
}

function _populatePlazaOptions() {
  const sel = document.getElementById('profile-default-plaza-select');
  if (!sel) return;
  const pls = _plazas(_profile);
  sel.innerHTML = pls.map(p =>
    `<option value="${_escAttr(p)}"${p === (_prefs?.defaultPlaza || '') ? ' selected' : ''}>${_esc(p)}</option>`
  ).join('');
}

function _renderPrefsControls() {
  _populatePlazaOptions();
  _setSelect('profile-theme-select', _prefs?.theme);
  _setSelect('profile-language-select', _prefs?.language);
  _setSelect('profile-home-view-select', _prefs?.homeView);
  _setSelect('profile-density-select', _prefs?.visualDensity);
  _setSelect('profile-default-plaza-select', _prefs?.defaultPlaza || _plazas(_profile)[0] || 'GLOBAL');
  _setSelect('profile-map-view-select', _prefs?.mapView);
  _setSelect('profile-notif-channel-select', _prefs?.notificationChannel);
  _setInput('profile-quiet-start', _prefs?.quietHoursStart);
  _setInput('profile-quiet-end', _prefs?.quietHoursEnd);
  _toggleBtn('profile-reduce-motion-toggle', _prefs?.reduceAnimations);
  _toggleBtn('profile-alert-sound-toggle', _prefs?.alertSound);
  _toggleBtn('profile-remember-zoom-toggle', _prefs?.rememberZoom);
  _toggleBtn('profile-remember-position-toggle', _prefs?.rememberPosition);
  _toggleBtn('profile-show-labels-toggle', _prefs?.showLabels);
  _toggleBtn('profile-heatmap-toggle', _prefs?.defaultHeatmap);
  _toggleBtn('profile-show-blocked-toggle', _prefs?.showBlockedAreas);
}

function _renderAccessSummary() {
  const mods = _availableModules(_profile);
  const pls = _plazas(_profile);
  const roleLabel = _profile?.roleLabel || _friendlyRole(_profile?.rol);
  const chip = document.getElementById('profile-admin-chip');
  const role = document.getElementById('profile-access-role');
  const level = document.getElementById('profile-access-level');
  const mEl = document.getElementById('profile-access-modules');
  const pEl = document.getElementById('profile-access-plazas');
  const scope = document.getElementById('profile-access-scope');
  if (chip) chip.style.display = _canAdmin() ? 'inline-flex' : 'none';
  if (role) role.textContent = roleLabel;
  if (level) level.textContent = _roleLevelLabel(_profile);
  if (mEl) mEl.textContent = mods.join(', ');
  if (pEl) pEl.textContent = pls.join(', ');
  if (scope) scope.textContent = _roleScopeLabel(_profile);
}

function _renderNotifState() {
  const snapshot = getCurrentDeviceSnapshot();
  const dev = snapshot?.currentDevice || {};
  const prefs = _currentNotifPrefs(dev);
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  const masterOn = perm === 'granted' && dev?.pushEnabled !== false && !prefs.muteAll;
  _toggleBtn('profileNotifMasterToggle', masterOn);
  _toggleBtn('profileNotifMessagesToggle', prefs.directMessages);
  _toggleBtn('profileNotifCuadreToggle', prefs.cuadreMissions);
  _toggleBtn('profileNotifCriticalToggle', prefs.criticalAlerts);
  _toggleBtn('profileNotifMuteToggle', prefs.muteAll);
  const metaEl = document.getElementById('profile-notif-meta');
  const sessionBadge = document.getElementById('profileSessionBadge');
  const permSummary = document.getElementById('profilePermissionSummary');
  const devSummary = document.getElementById('profileCurrentDeviceSummary');
  const permBtn = document.getElementById('profile-permission-toggle');
  if (metaEl) {
    const unread = Number(snapshot?.unread || 0);
    const devLabel = _friendlyDevice(dev);
    const modeLabel = masterOn ? 'Push activo' : (prefs.muteAll ? 'Equipo silenciado' : 'Push en pausa');
    metaEl.textContent = `${modeLabel} · ${devLabel}${unread > 0 ? ` · ${unread} nuevas` : ''}`;
  }
  if (sessionBadge) sessionBadge.textContent = _isOnline(_profile) ? 'En línea' : 'Sesión activa';
  if (permSummary) {
    permSummary.textContent = perm === 'granted'
      ? 'Este equipo ya puede recibir notificaciones reales del sistema.'
      : perm === 'denied'
        ? 'El permiso está bloqueado. Actívalo desde la configuración del sitio.'
        : 'Activa el permiso para recibir mensajes, inventario y alertas críticas.';
  }
  if (devSummary) {
    devSummary.textContent = `${_friendlyDevice(dev)} · ${_safeText(dev?.activeRoute || '/profile')} · ${prefs.muteAll ? 'Silenciado' : 'Disponible'}`;
  }
  if (permBtn) {
    const blocked = perm === 'denied' || perm === 'unsupported';
    permBtn.disabled = blocked;
    permBtn.textContent = perm === 'granted'
      ? 'Push activo en este dispositivo'
      : 'Activar notificaciones del dispositivo';
  }
  _renderHeroStats();
}

// ── Collect / Save ────────────────────────────────────────
function _collectForm() {
  const v = id => _safeText(document.getElementById(id)?.value || '');
  return {
    phone: v('profile-phone-input'),
    prefs: {
      ..._prefs,
      theme: v('profile-theme-select') || _prefs?.theme,
      language: v('profile-language-select') || _prefs?.language,
      homeView: v('profile-home-view-select') || _prefs?.homeView,
      visualDensity: v('profile-density-select') || _prefs?.visualDensity,
      defaultPlaza: _normPlaza(v('profile-default-plaza-select') || _prefs?.defaultPlaza || ''),
      mapView: v('profile-map-view-select') || _prefs?.mapView,
      notificationChannel: v('profile-notif-channel-select') || _prefs?.notificationChannel,
      quietHoursStart: v('profile-quiet-start') || _prefs?.quietHoursStart,
      quietHoursEnd: v('profile-quiet-end') || _prefs?.quietHoursEnd,
    }
  };
}

async function _save() {
  if (!_profile || !_mounted) return;
  const saveBtn = document.getElementById('profile-save-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">hourglass_top</span> Guardando...';
  }
  try {
    const { phone, prefs } = _collectForm();
    const docId = _docId();
    if (!docId) throw new Error('No se pudo resolver el documento del usuario');
    await db.collection('usuarios').doc(docId).set({ telefono: phone, profilePreferences: prefs }, { merge: true });
    _profile = { ..._profile, telefono: phone, profilePreferences: prefs };
    _prefs = prefs;
    _persistPrefs(prefs);
    _applyTheme(prefs.theme);
    window.CURRENT_USER_PROFILE = _profile;
    if (!_mounted) return;
    _renderProfile();
    _toast('Perfil actualizado correctamente.', 'success');
  } catch (err) {
    console.error('[app/profile] save:', err);
    _toast('No se pudieron guardar los cambios del perfil.', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">save</span> Guardar cambios';
      _setDirty(false);
    }
  }
}

function _setDirty(isDirty) {
  _dirty = Boolean(isDirty);
  const btn = document.getElementById('profile-save-btn');
  if (!btn) return;
  btn.style.boxShadow = isDirty
    ? '0 0 0 4px rgba(15,23,42,0.18), 0 8px 24px rgba(15,23,42,0.2)'
    : '0 8px 24px rgba(15,23,42,0.2)';
}

function _markDirty() {
  const { prefs } = _collectForm();
  _prefs = prefs;
  if (prefs.theme) _applyTheme(prefs.theme);
  _renderHeroStats();
  _setDirty(true);
}

// ── Chrome bindings ───────────────────────────────────────
function _bindChrome() {
  if (_chromeReady) return;
  _chromeReady = true;

  document.getElementById('profile-save-btn')?.addEventListener('click', _save);

  [
    'profile-phone-input', 'profile-theme-select', 'profile-language-select',
    'profile-home-view-select', 'profile-density-select', 'profile-default-plaza-select',
    'profile-map-view-select', 'profile-notif-channel-select',
    'profile-quiet-start', 'profile-quiet-end'
  ].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('input', _markDirty);
    el?.addEventListener('change', _markDirty);
  });

  const toggleMap = {
    'profile-reduce-motion-toggle': 'reduceAnimations',
    'profile-alert-sound-toggle': 'alertSound',
    'profile-remember-zoom-toggle': 'rememberZoom',
    'profile-remember-position-toggle': 'rememberPosition',
    'profile-show-labels-toggle': 'showLabels',
    'profile-heatmap-toggle': 'defaultHeatmap',
    'profile-show-blocked-toggle': 'showBlockedAreas',
  };
  Object.entries(toggleMap).forEach(([id, field]) => {
    document.getElementById(id)?.addEventListener('click', () => {
      _prefs = { ..._prefs, [field]: !_prefs[field] };
      _renderPrefsControls();
      _renderHeroStats();
      _setDirty(true);
    });
  });

  document.getElementById('profile-reset-password-btn')?.addEventListener('click', async () => {
    const a = _authInstance();
    const email = _safeText(_profile?.email || a?.currentUser?.email);
    if (!email) return _toast('No hay correo disponible para enviar el reset.', 'warning');
    try {
      await a?.sendPasswordResetEmail?.(email);
      _toast('Te enviamos un correo para cambiar tu contraseña.', 'success');
    } catch (err) {
      console.error('[app/profile] reset pwd:', err);
      _toast('No se pudo enviar el correo de recuperación.', 'error');
    }
  });

  document.getElementById('profile-close-sessions-btn')?.addEventListener('click', () => {
    openNotificationCenter();
    _toast('Abrimos el centro del sistema para revisar actividad y dispositivos.', 'warning');
  });

  document.getElementById('profile-avatar-input')?.addEventListener('change', function () {
    const file = this.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      _toast('Imagen demasiado grande. Máximo 12 MB.', 'error');
      this.value = '';
      return;
    }
    const ft = _lower(file.type);
    const fn = _lower(file.name);
    if (!ft.startsWith('image/') && !/\.(jpe?g|png|webp|gif|bmp|svg|heic|heif|avif)$/i.test(fn)) {
      _toast('Selecciona una imagen válida para tu perfil.', 'error');
      this.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => _openCrop(_safeText(ev?.target?.result));
    reader.readAsDataURL(file);
  });

  document.getElementById('profile-btn-quitar-foto')?.addEventListener('click', _removeAvatar);
  document.getElementById('profile-crop-close-btn')?.addEventListener('click', _cancelCrop);
  document.getElementById('profile-crop-cancel-btn')?.addEventListener('click', _cancelCrop);
  document.getElementById('profile-crop-save-btn')?.addEventListener('click', _saveAvatar);
  document.getElementById('profile-crop-zoom-input')?.addEventListener('input', function () {
    _adjustZoom(parseFloat(this.value) || 1);
  });
}

// ── Tab navigation ────────────────────────────────────────
function _initTabs() {
  if (_tabsReady) return;
  _tabsReady = true;
  const tabs = [...document.querySelectorAll('.profile-tab[data-target]')];
  const sections = tabs.map(t => document.getElementById(t.dataset.target)).filter(Boolean);

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = document.getElementById(tab.dataset.target);
      if (!target) return;
      const offset = window.innerWidth <= 980 ? 200 : 120;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
      _setActiveTab(tab.dataset.target);
    });
  });

  if ('IntersectionObserver' in window && sections.length) {
    _observer = new IntersectionObserver(entries => {
      const cur = entries.filter(e => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (cur?.target?.id) _setActiveTab(cur.target.id);
    }, { rootMargin: '-28% 0px -54% 0px', threshold: [0.15, 0.35, 0.6] });
    sections.forEach(s => _observer.observe(s));
  }
}

function _setActiveTab(sectionId) {
  document.querySelectorAll('.profile-tab').forEach(t => {
    const active = t.dataset.target === sectionId;
    t.style.background = active ? '#0f172a' : 'transparent';
    t.style.color = active ? '#fff' : '#64748b';
  });
}

// ── Notifications ─────────────────────────────────────────
function _bindNotifButtons() {
  if (_notifBindsReady) return;
  _notifBindsReady = true;
  document.getElementById('profileNotifMasterToggle')?.addEventListener('click', _toggleMasterNotif);
  document.getElementById('profileNotifMessagesToggle')?.addEventListener('click', () => _toggleNotifPref('directMessages'));
  document.getElementById('profileNotifCuadreToggle')?.addEventListener('click', () => _toggleNotifPref('cuadreMissions'));
  document.getElementById('profileNotifCriticalToggle')?.addEventListener('click', () => _toggleNotifPref('criticalAlerts'));
  document.getElementById('profileNotifMuteToggle')?.addEventListener('click', () => _toggleNotifPref('muteAll'));
  document.getElementById('profile-notif-center-btn')?.addEventListener('click', () => openNotificationCenter());
  document.getElementById('profile-permission-toggle')?.addEventListener('click', async () => {
    const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    if (perm === 'granted') { openNotificationCenter(); return; }
    await requestDeviceNotifications(true);
    await syncCurrentDeviceContext({}, { force: true });
    if (_mounted) _renderNotifState();
  });
}

async function _toggleNotifPref(field) {
  const snap = getCurrentDeviceSnapshot();
  const prefs = _currentNotifPrefs(snap?.currentDevice || {});
  await updateCurrentDevicePreferences({ [field]: !prefs[field] });
  await syncCurrentDeviceContext({}, { force: true });
  if (_mounted) _renderNotifState();
}

async function _toggleMasterNotif() {
  const snap = getCurrentDeviceSnapshot();
  const prefs = _currentNotifPrefs(snap?.currentDevice || {});
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  if (perm !== 'granted') {
    await requestDeviceNotifications(true);
    await syncCurrentDeviceContext({}, { force: true });
    if (_mounted) _renderNotifState();
    return;
  }
  await updateCurrentDevicePreferences({ muteAll: !prefs.muteAll });
  await syncCurrentDeviceContext({}, { force: true });
  if (_mounted) _renderNotifState();
}

async function _bootNotifications() {
  if (!_profile) return;
  configureNotifications({
    profileGetter: () => _profile,
    getCurrentUserName: () => _upper(_profile?.nombre || _profile?.usuario || ''),
    getCurrentUserDocId: () => _docId(),
    getCurrentPlaza: () => _upper(window.getMexCurrentPlaza?.() || _profile?.plazaAsignada || _profile?.plaza || ''),
    toast: (msg, type = 'info') => _toast(msg, type),
    routeHandlers: {
      openBuzon: () => { window.location.href = '/mensajes'; },
      openChat: (chatUser = '') => {
        const u = _safeText(chatUser);
        window.location.href = u ? `/mensajes?notif=chat&chatUser=${encodeURIComponent(u)}` : '/mensajes';
      },
      openAlerts: () => { window.location.href = '/mapa?notif=alerts'; }
    }
  });
  _bindNotifButtons();
  if (!_notifReady) {
    await initNotificationCenter();
    _notifReady = true;
  } else {
    await syncCurrentDeviceContext({}, { force: true });
  }
  if (_mounted) _renderNotifState();
}

// ── Avatar remove ─────────────────────────────────────────
async function _removeAvatar() {
  if (!_profile) return;
  const avatarUrl = _getAvatarUrl(_profile);
  const avatarPath = _safeText(_profile?.avatarPath);
  if (!avatarUrl && !avatarPath) {
    _toast('No tienes foto de perfil configurada.', 'warning');
    return;
  }
  const confirm = typeof window.mexConfirm === 'function' ? window.mexConfirm : () => Promise.resolve(false);
  if (!await confirm('Quitar foto de perfil', '¿Quitar tu foto de perfil?', 'warning')) return;
  try {
    const sc = storage || window._storage || (window.firebase?.storage ? window.firebase.storage() : null);
    if (sc) {
      if (avatarPath) sc.ref(avatarPath).delete().catch(() => {});
      else if (avatarUrl) sc.refFromURL(avatarUrl).delete().catch(() => {});
    }
    const payload = { avatarUrl: '', avatarPath: '', photoURL: '', fotoURL: '', profilePhotoUrl: '' };
    await db.collection('usuarios').doc(_docId()).set(payload, { merge: true });
    const a = _authInstance();
    if (a?.currentUser?.updateProfile) a.currentUser.updateProfile({ photoURL: '' }).catch(() => {});
    _profile = { ..._profile, ...payload };
    window.CURRENT_USER_PROFILE = _profile;
    if (_mounted) _renderProfile();
    _toast('Foto eliminada', 'success');
  } catch (err) {
    console.error('[app/profile] remove avatar:', err);
    _toast('No se pudo quitar la foto.', 'error');
  }
}

// ── Crop ──────────────────────────────────────────────────
function _openCrop(src) {
  const overlay = document.getElementById('profile-crop-overlay');
  const img = document.getElementById('profile-crop-img');
  const zoom = document.getElementById('profile-crop-zoom-input');
  const stage = document.getElementById('profile-crop-stage');
  if (!overlay || !img || !src) return;
  overlay.style.display = 'flex';
  img.src = src;
  img.onload = () => {
    const sw = stage?.clientWidth || 320;
    const sh = stage?.clientHeight || 320;
    const nw = img.naturalWidth || sw;
    const nh = img.naturalHeight || sh;
    const cropD = Math.min(sw, sh) * 0.8;
    const fitScale = Math.max(cropD / nw, cropD / nh);
    img.style.width = `${nw}px`;
    img.style.height = `${nh}px`;
    _cropState = {
      img, baseScale: Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1,
      zoom: 1, scale: Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1,
      offsetX: 0, offsetY: 0
    };
    if (zoom) { zoom.min = '1'; zoom.max = '4'; zoom.value = '1'; }
    _positionCrop();
    _renderCropPreview();
  };
}

function _cropScale() {
  if (!_cropState) return 1;
  return Math.max(0.01, (_cropState.baseScale || 1) * (_cropState.zoom || 1));
}

function _clampCrop() {
  if (!_cropState) return;
  const stage = document.getElementById('profile-crop-stage');
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  const img = _cropState.img;
  const scale = _cropScale();
  const cropD = Math.min(rect.width, rect.height) * 0.8;
  const maxX = Math.max(0, ((img.naturalWidth || rect.width) * scale - cropD) / 2);
  const maxY = Math.max(0, ((img.naturalHeight || rect.height) * scale - cropD) / 2);
  _cropState.offsetX = Math.max(-maxX, Math.min(maxX, Number(_cropState.offsetX || 0)));
  _cropState.offsetY = Math.max(-maxY, Math.min(maxY, Number(_cropState.offsetY || 0)));
}

function _positionCrop() {
  if (!_cropState) return;
  _cropState.scale = _cropScale();
  _clampCrop();
  const { img, scale, offsetX, offsetY } = _cropState;
  img.style.left = '50%';
  img.style.top = '50%';
  img.style.transformOrigin = 'center center';
  img.style.transform = `translate(-50%,-50%) translate(${offsetX}px,${offsetY}px) scale(${scale})`;
}

function _adjustZoom(value) {
  if (!_cropState) return;
  _cropState.zoom = Math.max(1, Math.min(4, parseFloat(value) || 1));
  _positionCrop();
  _renderCropPreview();
}

function _cancelCrop() {
  const overlay = document.getElementById('profile-crop-overlay');
  if (overlay) overlay.style.display = 'none';
  _cropState = null;
  const input = document.getElementById('profile-avatar-input');
  if (input) input.value = '';
}

function _cropSourceRect(stage) {
  if (!_cropState || !stage) return null;
  _clampCrop();
  const sr = stage.getBoundingClientRect();
  const img = _cropState.img;
  const scale = _cropScale();
  const sw = (img.naturalWidth || sr.width) * scale;
  const sh = (img.naturalHeight || sr.height) * scale;
  const dl = sr.width / 2 - sw / 2 + _cropState.offsetX;
  const dt = sr.height / 2 - sh / 2 + _cropState.offsetY;
  const cropD = Math.min(sr.width, sr.height) * 0.8;
  return { img, sx: ((sr.width - cropD) / 2 - dl) / scale, sy: ((sr.height - cropD) / 2 - dt) / scale, sw: cropD / scale };
}

function _renderCropPreview() {
  if (!_cropState) return;
  const stage = document.getElementById('profile-crop-stage');
  if (!stage) return;
  [{ id: 'profile-preview-circle', size: 96 }, { id: 'profile-preview-card', size: 112 }].forEach(({ id, size }) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
    const src = _cropSourceRect(stage);
    if (src) ctx.drawImage(src.img, src.sx, src.sy, src.sw, src.sw, 0, 0, size, size);
  });
}

async function _saveAvatar() {
  if (!_profile || !_cropState) return;
  const btn = document.getElementById('profile-crop-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  try {
    const stage = document.getElementById('profile-crop-stage');
    if (!stage || !_cropState) throw new Error('Sin imagen para recortar');
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo preparar el recorte');
    ctx.beginPath(); ctx.arc(256, 256, 256, 0, Math.PI * 2); ctx.clip();
    const src = _cropSourceRect(stage);
    if (!src) throw new Error('No se pudo calcular el recorte');
    ctx.drawImage(src.img, src.sx, src.sy, src.sw, src.sw, 0, 0, 512, 512);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) throw new Error('No se pudo generar la imagen final');
    const docId = _docId();
    if (!docId) throw new Error('No se pudo resolver el documento del usuario');
    const prevPath = _safeText(_profile?.avatarPath);
    const prevUrl = _getAvatarUrl(_profile);
    const avatarPath = `profile_avatars/${docId}/avatar_${Date.now()}.jpg`;
    const sc = storage || window._storage || (window.firebase?.storage ? window.firebase.storage() : null);
    if (!sc?.ref) throw new Error('Storage no disponible');
    const ref = sc.ref(avatarPath);
    await ref.put(blob, { contentType: 'image/jpeg' });
    const avatarUrl = await ref.getDownloadURL();
    const payload = { avatarUrl, avatarPath, photoURL: avatarUrl, fotoURL: avatarUrl, profilePhotoUrl: avatarUrl };
    await db.collection('usuarios').doc(docId).set(payload, { merge: true });
    if (prevPath && prevPath !== avatarPath) sc.ref(prevPath).delete().catch(() => {});
    else if (!prevPath && prevUrl && prevUrl !== avatarUrl) sc.refFromURL(prevUrl).delete().catch(() => {});
    const a = _authInstance();
    if (a?.currentUser?.updateProfile) a.currentUser.updateProfile({ photoURL: avatarUrl }).catch(() => {});
    _profile = { ..._profile, ...payload };
    window.CURRENT_USER_PROFILE = _profile;
    if (_mounted) _renderProfile();
    _cancelCrop();
    _toast('Foto actualizada ✓', 'success');
  } catch (err) {
    console.error('[app/profile] save avatar:', err);
    _toast('No se pudo guardar la foto.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">check</span> Guardar Foto';
    }
  }
}

function _setupCropDocListeners() {
  const stage = document.getElementById('profile-crop-stage');
  if (!stage) return;
  const getPoint = ev => {
    const t = ev.touches ? ev.touches[0] : ev;
    return { x: t.clientX, y: t.clientY };
  };
  stage.addEventListener('mousedown', ev => {
    if (!_cropState) return;
    _cropDragging = true; _cropLast = getPoint(ev); ev.preventDefault();
  });
  stage.addEventListener('touchstart', ev => {
    if (!_cropState) return;
    _cropDragging = true; _cropLast = getPoint(ev);
  }, { passive: true });

  _docMouseMove = ev => {
    if (!_cropDragging || !_cropState || !_cropLast) return;
    const pt = getPoint(ev);
    _cropState.offsetX += pt.x - _cropLast.x;
    _cropState.offsetY += pt.y - _cropLast.y;
    _cropLast = pt; _positionCrop(); _renderCropPreview();
  };
  _docMouseUp = () => { _cropDragging = false; };
  _docTouchMove = ev => {
    if (!_cropDragging || !_cropState || !_cropLast) return;
    const pt = getPoint(ev);
    _cropState.offsetX += pt.x - _cropLast.x;
    _cropState.offsetY += pt.y - _cropLast.y;
    _cropLast = pt; _positionCrop(); _renderCropPreview();
  };
  _docTouchEnd = () => { _cropDragging = false; };

  document.addEventListener('mousemove', _docMouseMove);
  document.addEventListener('mouseup', _docMouseUp);
  document.addEventListener('touchmove', _docTouchMove, { passive: true });
  document.addEventListener('touchend', _docTouchEnd);
}

// ── Toast ─────────────────────────────────────────────────
function _toast(msg, type = 'success') {
  const bg = type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#22c55e';
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:${bg};color:#fff;padding:10px 22px;border-radius:12px;font-weight:800;font-size:13px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.3);white-space:nowrap;font-family:Inter,sans-serif;`;
  el.textContent = _safeText(msg);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
