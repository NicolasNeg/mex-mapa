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
const PROFILE_PREFS_STORAGE_KEY = 'mex_profile_preferences_v2';
const PROFILE_DEFAULT_PREFERENCES = Object.freeze({
  theme: 'light',
  language: 'es',
  homeView: 'dashboard',
  visualDensity: 'compacta',
  reduceAnimations: false,
  alertSound: true,
  defaultPlaza: '',
  mapView: 'mapa',
  rememberZoom: true,
  rememberPosition: true,
  showLabels: true,
  defaultHeatmap: false,
  showBlockedAreas: true,
  notificationChannel: 'sistema',
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00'
});

let _profile = null;
let _profilePreferences = { ...PROFILE_DEFAULT_PREFERENCES };
let _profileDirty = false;
let _notificationsReady = false;
let _notificationBindingsReady = false;
let _cropState = null;
let _cropDragging = false;
let _cropLast = null;
let _profileChromeReady = false;
let _profileTabsReady = false;
let _profileSectionObserver = null;

function _safeText(value) {
  return String(value || '').trim();
}

function _escapeHtml(value) {
  return _safeText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function _safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function _safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function _normalizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function _normalizePlaza(value) {
  return _upperText(value || '').replace(/\s+/g, ' ').trim();
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

function _formatDateTime(timestamp) {
  const ts = _coerceTimestamp(timestamp);
  if (!ts) return 'Sin registro';

  try {
    const value = new Date(ts);
    const today = new Date();
    const sameDay = value.toDateString() === today.toDateString();
    const time = new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(value);
    if (sameDay) return `Hoy, ${time}`;
    return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
  } catch (_) {
    return 'Sin registro';
  }
}

function _isElevatedRole(role = '') {
  return [
    'PROGRAMADOR',
    'CORPORATIVO',
    'CORPORATIVO_USER',
    'JEFE DE OPERACION',
    'JEFE_OPERACION',
    'JEFE REGIONAL',
    'JEFE_REGIONAL',
    'ADMIN',
    'ADMINISTRADOR'
  ].includes(_upperText(role));
}

function _canAccessAdmin(profile = _profile) {
  const overrides = _safeObject(profile?.permissionOverrides);
  if (overrides.view_admin_panel === false) return false;
  if (overrides.view_admin_panel === true) return true;
  return Boolean(profile?.isAdmin || profile?.isGlobal || _isElevatedRole(profile?.rol));
}

function _canAccessProgrammer(profile = _profile) {
  const overrides = _safeObject(profile?.permissionOverrides);
  if (overrides.view_admin_programmer === true) return true;
  if (overrides.view_admin_programmer === false) return false;
  return _upperText(profile?.rol) === 'PROGRAMADOR';
}

function _roleLevelLabel(profile = _profile) {
  const role = _upperText(profile?.rol);
  if (role === 'PROGRAMADOR') return 'Admin técnico';
  if (_canAccessAdmin(profile) && profile?.isGlobal) return 'Cobertura global';
  if (_canAccessAdmin(profile)) return 'Operación administrativa';
  return 'Operación estándar';
}

function _roleScopeLabel(profile = _profile) {
  if (_canAccessProgrammer(profile)) return 'Lectura + edición + configuración';
  if (_canAccessAdmin(profile)) return 'Lectura + edición operativa';
  return 'Lectura + operación';
}

function _availableModules(profile = _profile) {
  const modules = ['Dashboard', 'Mapa', 'Mensajes', 'Cuadres', 'Perfil'];
  if (_canAccessAdmin(profile)) modules.push('Panel Admin');
  if (_canAccessProgrammer(profile)) modules.push('Consola');
  if (_normalizeBoolean(profile?.isGlobal, false)) modules.push('Global');
  return [...new Set(modules)];
}

function _availablePlazas(profile = _profile) {
  const plazas = new Set();
  const current = _normalizePlaza(window.getMexCurrentPlaza?.());
  const main = _normalizePlaza(profile?.plazaAsignada || profile?.plaza);
  if (main) plazas.add(main);
  _safeArray(profile?.plazasPermitidas).forEach(item => {
    const plaza = _normalizePlaza(item);
    if (plaza) plazas.add(plaza);
  });
  if (current) plazas.add(current);
  if (!plazas.size) plazas.add('GLOBAL');
  return [...plazas];
}

function _readStoredPreferences() {
  try {
    return _safeObject(JSON.parse(localStorage.getItem(PROFILE_PREFS_STORAGE_KEY) || '{}'));
  } catch (_) {
    return {};
  }
}

function _normalizedProfilePreferences(raw = {}, profile = _profile) {
  const themeFromStorage = _safeText(localStorage.getItem('mex_mapa_theme')) || PROFILE_DEFAULT_PREFERENCES.theme;
  const merged = {
    ...PROFILE_DEFAULT_PREFERENCES,
    ..._safeObject(raw)
  };
  merged.theme = _safeText(merged.theme || themeFromStorage || 'light').toLowerCase() === 'dark' ? 'dark' : 'light';
  merged.language = _safeText(merged.language || 'es') || 'es';
  merged.homeView = _safeText(merged.homeView || (_canAccessAdmin(profile) ? 'dashboard' : 'mapa')) || 'dashboard';
  merged.visualDensity = _safeText(merged.visualDensity || 'compacta') || 'compacta';
  merged.defaultPlaza = _normalizePlaza(merged.defaultPlaza || profile?.plazaAsignada || window.getMexCurrentPlaza?.() || '');
  merged.mapView = _safeText(merged.mapView || 'mapa') || 'mapa';
  merged.reduceAnimations = _normalizeBoolean(merged.reduceAnimations, false);
  merged.alertSound = _normalizeBoolean(merged.alertSound, true);
  merged.rememberZoom = _normalizeBoolean(merged.rememberZoom, true);
  merged.rememberPosition = _normalizeBoolean(merged.rememberPosition, true);
  merged.showLabels = _normalizeBoolean(merged.showLabels, true);
  merged.defaultHeatmap = _normalizeBoolean(merged.defaultHeatmap, false);
  merged.showBlockedAreas = _normalizeBoolean(merged.showBlockedAreas, true);
  merged.notificationChannel = _safeText(merged.notificationChannel || 'sistema') || 'sistema';
  merged.quietHoursStart = _safeText(merged.quietHoursStart || '22:00') || '22:00';
  merged.quietHoursEnd = _safeText(merged.quietHoursEnd || '07:00') || '07:00';
  return merged;
}

function _loadProfilePreferences(profile = _profile) {
  const fromDoc = _safeObject(profile?.profilePreferences || profile?.uiPreferences);
  const fromStorage = _readStoredPreferences();
  return _normalizedProfilePreferences({ ...fromDoc, ...fromStorage }, profile);
}

function _persistPreferencesToStorage(preferences = _profilePreferences) {
  try {
    localStorage.setItem(PROFILE_PREFS_STORAGE_KEY, JSON.stringify(preferences));
    localStorage.setItem('mex_mapa_theme', preferences.theme === 'dark' ? 'dark' : 'light');
  } catch (error) {
    console.warn('[profile] local prefs:', error);
  }
}

function _applyTheme(theme = 'light') {
  const isDark = theme === 'dark';
  const root = document.documentElement;
  root.dataset.theme = isDark ? 'dark' : 'light';
  root.classList.toggle('dark-theme', isDark);
  document.body.classList.toggle('dark-theme', isDark);

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', isDark ? '#0b2548' : '#ffffff');
}

function _setDirtyState(isDirty) {
  _profileDirty = Boolean(isDirty);
  const saveBtn = document.getElementById('profile-save-btn');
  if (!saveBtn) return;
  saveBtn.classList.toggle('is-dirty', _profileDirty);
  saveBtn.innerHTML = _profileDirty
    ? '<span class="material-icons">save</span> Guardar cambios'
    : '<span class="material-icons">save</span> Guardar cambios';
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
    plazaAsignada: _normalizePlaza(raw.plazaAsignada || raw.plaza || ''),
    plazasPermitidas: _safeArray(raw.plazasPermitidas).map(_normalizePlaza).filter(Boolean),
    telefono: _safeText(raw.telefono),
    status: _upperText(raw.status || 'ACTIVO') || 'ACTIVO',
    isOnline: raw.isOnline === true,
    isAdmin: raw.isAdmin === true,
    isGlobal: raw.isGlobal === true,
    lastSeenAt: _coerceTimestamp(raw.lastSeenAt || raw.lastActiveAt),
    avatarUrl: _getProfileAvatarUrl(raw),
    avatarPath: _safeText(raw.avatarPath),
    permissionOverrides: _safeObject(raw.permissionOverrides || raw.permisosUsuario),
    profilePreferences: _safeObject(raw.profilePreferences || raw.uiPreferences)
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
    const cachedProfile = typeof window.__mexLoadCurrentUserRecord === 'function'
      ? await window.__mexLoadCurrentUserRecord(user).catch(() => null)
      : null;

    if (cachedProfile) {
      _profile = _normalizeProfile(cachedProfile, user);
    } else if (_isBootstrapProgrammerEmail(email)) {
      _profile = await _ensureBootstrapProgrammerProfile(user);
    } else {
      _profile = _normalizeProfile({}, user);
    }
  } catch (error) {
    console.error('[profile] load:', error);
    _profile = _normalizeProfile({}, user);
  }

  _profilePreferences = _loadProfilePreferences(_profile);
  _persistPreferencesToStorage(_profilePreferences);
  _applyTheme(_profilePreferences.theme);
  window.CURRENT_USER_PROFILE = _profile;
  window.__mexSeedCurrentUserRecordCache?.(_profile, user);
  _bindProfileChrome();
  _initProfileTabs();
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
  const plaza = _normalizePlaza(_profile.plazaAsignada || _profile.plaza || '');
  const avatarUrl = _getProfileAvatarUrl(_profile);
  const plazasExtra = _safeArray(_profile.plazasPermitidas).filter(Boolean);
  const heroMeta = [
    `Rol: ${roleLabel}`,
    `Plaza principal: ${plaza || 'Sin plaza'}`,
    `Estado: ${_profile.status || 'ACTIVO'}`,
    `Ultimo acceso: ${_formatDateTime(_profile.lastSeenAt || _profile.lastActiveAt || Date.now())}`
  ];

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
  const emailEl = document.getElementById('profile-hero-email');
  const metaEl = document.getElementById('profile-hero-meta');
  const badgesEl = document.getElementById('profile-hero-badges');

  if (nameEl) nameEl.textContent = nombre;
  if (emailEl) emailEl.textContent = email || 'Sin correo';
  if (metaEl) metaEl.textContent = heroMeta.join(' · ');
  if (badgesEl) {
    const badges = [
      roleLabel,
      _canAccessAdmin(_profile) ? 'ADMIN' : '',
      plaza || 'SIN PLAZA',
      _profile.status || 'ACTIVO'
    ];
    badgesEl.innerHTML = badges
      .filter(Boolean)
      .map(label => `<span class="profile-badge">${_escapeHtml(label)}</span>`)
      .join('');
  }

  const removeBtn = document.querySelector('.profile-avatar-actions .profile-action-btn.danger');
  if (removeBtn) removeBtn.disabled = !avatarUrl;

  _renderHeroStats();
  _renderGeneralInfo({
    nombre,
    email,
    roleLabel,
    plaza,
    plazasExtra
  });
  _renderPreferenceControls();
  _renderAccessSummary();
  _renderNotificationState();
  _setDirtyState(false);
}

function _setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = _safeText(value);
}

function _setSelectValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const resolved = _safeText(value);
  if (resolved && [...el.options].some(option => option.value === resolved)) {
    el.value = resolved;
  }
}

function _renderGeneralInfo({ nombre, email, roleLabel, plaza, plazasExtra }) {
  _setInputValue('profile-name-input', nombre);
  _setInputValue('profile-email-input', email);
  _setInputValue('profile-phone-input', _profile?.telefono || '');
  _setInputValue('profile-role-input', roleLabel);
  _setInputValue('profile-main-plaza-input', plaza || 'Sin plaza');
  _setInputValue('profile-secondary-plazas-input', plazasExtra.length ? plazasExtra.join(', ') : 'Sin plazas secundarias');
  _setInputValue('profile-status-input', _profile?.status || 'ACTIVO');

  const lastAccess = document.getElementById('profile-last-access-label');
  if (lastAccess) lastAccess.textContent = _formatDateTime(_profile?.lastSeenAt || _profile?.lastActiveAt || Date.now());
}

function _renderHeroStats() {
  const modules = _availableModules(_profile);
  const device = getCurrentDeviceSnapshot()?.currentDevice || {};
  const prefs = _currentNotificationPrefs(device);
  const activeAlerts = [
    prefs.directMessages,
    prefs.cuadreMissions,
    prefs.criticalAlerts
  ].filter(Boolean).length;

  const modulesEl = document.getElementById('profile-stat-modules');
  const notificationsEl = document.getElementById('profile-stat-notifications');
  const deviceEl = document.getElementById('profile-stat-device');
  const homeEl = document.getElementById('profile-stat-home');

  if (modulesEl) modulesEl.textContent = String(modules.length);
  if (notificationsEl) notificationsEl.textContent = String(activeAlerts);
  if (deviceEl) deviceEl.textContent = _friendlyDeviceLabel(device);
  if (homeEl) homeEl.textContent = (_profilePreferences.homeView || 'dashboard').replace(/^./, c => c.toUpperCase());
}

function _populateDefaultPlazaOptions() {
  const select = document.getElementById('profile-default-plaza-select');
  if (!select) return;

  const plazas = _availablePlazas(_profile);
  select.innerHTML = plazas
    .map(plaza => `<option value="${_escapeHtml(plaza)}">${_escapeHtml(plaza)}</option>`)
    .join('');
}

function _renderPreferenceControls() {
  _populateDefaultPlazaOptions();
  _setSelectValue('profile-theme-select', _profilePreferences.theme);
  _setSelectValue('profile-language-select', _profilePreferences.language);
  _setSelectValue('profile-home-view-select', _profilePreferences.homeView);
  _setSelectValue('profile-density-select', _profilePreferences.visualDensity);
  _setSelectValue('profile-default-plaza-select', _profilePreferences.defaultPlaza || _availablePlazas(_profile)[0] || 'GLOBAL');
  _setSelectValue('profile-map-view-select', _profilePreferences.mapView);
  _setSelectValue('profile-notif-channel-select', _profilePreferences.notificationChannel);

  _setInputValue('profile-quiet-start', _profilePreferences.quietHoursStart);
  _setInputValue('profile-quiet-end', _profilePreferences.quietHoursEnd);

  _toggleSettingButton('profile-reduce-motion-toggle', _profilePreferences.reduceAnimations);
  _toggleSettingButton('profile-alert-sound-toggle', _profilePreferences.alertSound);
  _toggleSettingButton('profile-remember-zoom-toggle', _profilePreferences.rememberZoom);
  _toggleSettingButton('profile-remember-position-toggle', _profilePreferences.rememberPosition);
  _toggleSettingButton('profile-show-labels-toggle', _profilePreferences.showLabels);
  _toggleSettingButton('profile-heatmap-toggle', _profilePreferences.defaultHeatmap);
  _toggleSettingButton('profile-show-blocked-toggle', _profilePreferences.showBlockedAreas);
}

function _renderAccessSummary() {
  const modules = _availableModules(_profile);
  const plazas = _availablePlazas(_profile);
  const roleLabel = _profile?.roleLabel || _friendlyRoleLabel(_profile?.rol);

  const accessRole = document.getElementById('profile-access-role');
  const accessLevel = document.getElementById('profile-access-level');
  const accessModules = document.getElementById('profile-access-modules');
  const accessPlazas = document.getElementById('profile-access-plazas');
  const accessScope = document.getElementById('profile-access-scope');
  const adminChip = document.getElementById('profile-admin-chip');

  if (accessRole) accessRole.textContent = roleLabel;
  if (accessLevel) accessLevel.textContent = _roleLevelLabel(_profile);
  if (accessModules) accessModules.textContent = modules.join(', ');
  if (accessPlazas) accessPlazas.textContent = plazas.join(', ');
  if (accessScope) accessScope.textContent = _roleScopeLabel(_profile);
  if (adminChip) {
    adminChip.style.display = _canAccessAdmin(_profile) ? 'inline-flex' : 'none';
  }
}

function _collectProfileFormData() {
  const phone = _safeText(document.getElementById('profile-phone-input')?.value || '');
  const theme = _safeText(document.getElementById('profile-theme-select')?.value || _profilePreferences.theme) || 'light';
  const language = _safeText(document.getElementById('profile-language-select')?.value || _profilePreferences.language) || 'es';
  const homeView = _safeText(document.getElementById('profile-home-view-select')?.value || _profilePreferences.homeView) || 'dashboard';
  const visualDensity = _safeText(document.getElementById('profile-density-select')?.value || _profilePreferences.visualDensity) || 'compacta';
  const defaultPlaza = _normalizePlaza(document.getElementById('profile-default-plaza-select')?.value || _profilePreferences.defaultPlaza || '');
  const mapView = _safeText(document.getElementById('profile-map-view-select')?.value || _profilePreferences.mapView) || 'mapa';
  const notificationChannel = _safeText(document.getElementById('profile-notif-channel-select')?.value || _profilePreferences.notificationChannel) || 'sistema';
  const quietHoursStart = _safeText(document.getElementById('profile-quiet-start')?.value || _profilePreferences.quietHoursStart) || '22:00';
  const quietHoursEnd = _safeText(document.getElementById('profile-quiet-end')?.value || _profilePreferences.quietHoursEnd) || '07:00';

  return {
    phone,
    preferences: _normalizedProfilePreferences({
      ..._profilePreferences,
      theme,
      language,
      homeView,
      visualDensity,
      defaultPlaza,
      mapView,
      notificationChannel,
      quietHoursStart,
      quietHoursEnd
    }, _profile)
  };
}

async function _saveProfileSettings() {
  if (!_profile) return;

  const saveBtn = document.getElementById('profile-save-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="material-icons">hourglass_top</span> Guardando...';
  }

  try {
    const { phone, preferences } = _collectProfileFormData();
    const docId = _currentUserDocId();
    if (!docId) throw new Error('No se pudo resolver el documento del usuario');

    await db.collection('usuarios').doc(docId).set({
      telefono: phone,
      profilePreferences: preferences
    }, { merge: true });

    _profile = {
      ..._profile,
      telefono: phone,
      profilePreferences: preferences
    };
    _profilePreferences = preferences;
    _persistPreferencesToStorage(preferences);
    _applyTheme(preferences.theme);
    window.CURRENT_USER_PROFILE = _profile;
    _renderProfile();
    _showToast('Perfil actualizado correctamente.', 'success');
  } catch (error) {
    console.error('[profile] save:', error);
    _showToast('No se pudieron guardar los cambios del perfil.', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      _setDirtyState(false);
    }
  }
}

function _togglePreference(field) {
  _profilePreferences = {
    ..._profilePreferences,
    [field]: !_profilePreferences[field]
  };

  if (field === 'theme') {
    _applyTheme(_profilePreferences.theme);
  }

  _renderPreferenceControls();
  _setDirtyState(true);
}

function _markProfileDirty() {
  const collected = _collectProfileFormData();
  _profilePreferences = collected.preferences;
  if (collected.preferences.theme) _applyTheme(collected.preferences.theme);
  _renderHeroStats();
  _setDirtyState(true);
}

function _bindProfileChrome() {
  if (_profileChromeReady) return;
  _profileChromeReady = true;

  const saveBtn = document.getElementById('profile-save-btn');
  saveBtn?.addEventListener('click', () => _saveProfileSettings());

  [
    'profile-phone-input',
    'profile-theme-select',
    'profile-language-select',
    'profile-home-view-select',
    'profile-density-select',
    'profile-default-plaza-select',
    'profile-map-view-select',
    'profile-notif-channel-select',
    'profile-quiet-start',
    'profile-quiet-end'
  ].forEach(id => {
    const element = document.getElementById(id);
    element?.addEventListener('input', _markProfileDirty);
    element?.addEventListener('change', _markProfileDirty);
  });

  const preferenceToggleMap = {
    'profile-reduce-motion-toggle': 'reduceAnimations',
    'profile-alert-sound-toggle': 'alertSound',
    'profile-remember-zoom-toggle': 'rememberZoom',
    'profile-remember-position-toggle': 'rememberPosition',
    'profile-show-labels-toggle': 'showLabels',
    'profile-heatmap-toggle': 'defaultHeatmap',
    'profile-show-blocked-toggle': 'showBlockedAreas'
  };

  Object.entries(preferenceToggleMap).forEach(([id, field]) => {
    document.getElementById(id)?.addEventListener('click', () => {
      _profilePreferences = {
        ..._profilePreferences,
        [field]: !_profilePreferences[field]
      };
      _renderPreferenceControls();
      _renderHeroStats();
      _setDirtyState(true);
    });
  });

  document.getElementById('profile-reset-password-btn')?.addEventListener('click', async () => {
    const email = _safeText(_profile?.email || auth.currentUser?.email);
    if (!email) return _showToast('No hay correo disponible para enviar el reset.', 'warning');
    try {
      await auth.sendPasswordResetEmail(email);
      _showToast('Te enviamos un correo para cambiar tu contraseña.', 'success');
    } catch (error) {
      console.error('[profile] reset password:', error);
      _showToast('No se pudo enviar el correo de recuperación.', 'error');
    }
  });

  document.getElementById('profile-close-sessions-btn')?.addEventListener('click', () => {
    openNotificationCenter();
    _showToast('Abrimos el centro del sistema para revisar actividad y dispositivos.', 'warning');
  });
}

function _setActiveProfileTab(sectionId) {
  document.querySelectorAll('.profile-tab').forEach(tab => {
    tab.classList.toggle('is-active', tab.dataset.target === sectionId);
  });
}

function _initProfileTabs() {
  if (_profileTabsReady) return;
  _profileTabsReady = true;

  const tabs = [...document.querySelectorAll('.profile-tab[data-target]')];
  const sections = tabs
    .map(tab => document.getElementById(tab.dataset.target))
    .filter(Boolean);

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = document.getElementById(tab.dataset.target);
      if (!target) return;
      const topOffset = window.innerWidth <= 980 ? 212 : 168;
      const targetTop = target.getBoundingClientRect().top + window.scrollY - topOffset;
      window.scrollTo({ top: Math.max(targetTop, 0), behavior: 'smooth' });
      _setActiveProfileTab(tab.dataset.target);
    });
  });

  if ('IntersectionObserver' in window && sections.length > 0) {
    _profileSectionObserver = new IntersectionObserver(entries => {
      const current = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (current?.target?.id) _setActiveProfileTab(current.target.id);
    }, {
      rootMargin: '-28% 0px -54% 0px',
      threshold: [0.15, 0.35, 0.6]
    });

    sections.forEach(section => _profileSectionObserver.observe(section));
  }
}

function _toggleSettingButton(id, enabled) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.toggle('is-on', Boolean(enabled));
  btn.classList.toggle('is-off', !enabled);
  btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
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
    permissionBtn.innerHTML = permission === 'granted'
      ? '<span class="material-icons">notifications_active</span> Push activo en este dispositivo'
      : '<span class="material-icons">notifications</span> Activar notificaciones del dispositivo';
    permissionBtn.title = permission === 'granted'
      ? 'Push activo — abre el centro de notificaciones'
      : blocked
        ? 'El permiso está bloqueado o no está soportado en este navegador'
        : 'Toca para activar notificaciones push';
  }

  _renderHeroStats();
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
  const zoom = document.getElementById('profile-crop-zoom-input');
  const stage = document.getElementById('profile-crop-stage');
  if (!overlay || !img || !src) return;

  overlay.style.display = 'flex';
  img.src = src;
  img.onload = () => {
    const stageWidth = stage?.clientWidth || 320;
    const stageHeight = stage?.clientHeight || 320;
    const safeNaturalWidth = img.naturalWidth || stageWidth;
    const safeNaturalHeight = img.naturalHeight || stageHeight;
    const fitScale = Math.max(
      1,
      Math.max(
        stageWidth / safeNaturalWidth,
        stageHeight / safeNaturalHeight
      )
    );

    _cropState = { img, scale: fitScale, offsetX: 0, offsetY: 0 };
    if (zoom) {
      const normalized = Math.max(1, Math.min(3, Number(fitScale.toFixed(2))));
      zoom.value = String(normalized);
      _cropState.scale = normalized;
    }
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
