import { auth, db, COL, functions } from '/js/core/database.js';
import { configureNotifications, initNotificationCenter } from '/js/core/notifications.js';
import { installProgrammerErrorReporter, reportProgrammerError } from '/js/core/observability.js';

const PROGRAMMER_ROLES = new Set(['PROGRAMADOR', 'JEFE_OPERACION', 'CORPORATIVO_USER']);
const state = {
  profile: null,
  tab: 'resumen',
  plaza: '',
  overview: null,
  queryRows: [],
  queryName: 'ops_events',
  querySearch: '',
  queryLimit: 50,
  jobResult: null,
  jobsRows: [],
  auditRows: [],
  errorsRows: [],
  devicesRows: [],
  notificationsRows: [],
  opsRows: [],
  settingsGlobal: {},
  settingsPlaza: {},
  configMode: 'plaza',
  dbParentPath: '',
  dbCollectionPath: '',
  dbDocPath: '',
  dbCollections: [],
  dbDocs: [],
  dbDocument: null,
  dbSubcollections: [],
  dbCollectionSearch: '',
  dbDocSearch: '',
  dbLimit: 80,
  dbLoaded: false,
  sendingTestNotification: false,
  testTarget: '',
  testTitle: '',
  testBody: '',
  toolsLog: []
};

const BUILD_TAG = 'mapa-v90';
const CC_NAME = 'Centro de Control';

function safe(value) {
  return String(value ?? '').trim();
}

function upper(value) {
  return safe(value).toUpperCase();
}

function lower(value) {
  return safe(value).toLowerCase();
}

function escapeHtml(value) {
  return safe(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inferRole(data = {}) {
  const role = upper(data.rol);
  if (role) return role;
  if (data.isGlobal === true) return 'CORPORATIVO_USER';
  if (data.isAdmin === true) return 'VENTAS';
  return 'AUXILIAR';
}

function roleConfig(role) {
  return window.MEX_CONFIG?.empresa?.security?.roles?.[upper(role)] || null;
}

function permissionOverride(profile = {}, key = '') {
  const overrides = profile?.permissionOverrides;
  if (!overrides || typeof overrides !== 'object') return undefined;
  return typeof overrides[key] === 'boolean' ? overrides[key] : undefined;
}

function roleCanUseProgrammerConsole(role, profile = {}) {
  const override = permissionOverride(profile, 'use_programmer_console');
  if (typeof override === 'boolean') return override;
  if (PROGRAMMER_ROLES.has(upper(role))) return true;
  const config = roleConfig(role);
  if (!config || typeof config !== 'object') return false;
  if (config.fullAccess === true) return true;
  return config.permissions?.use_programmer_console === true;
}

function currentUserLabel() {
  return safe(state.profile?.nombre || state.profile?.email || '');
}

function friendlyRoleLabel(role = '') {
  const normalized = upper(role);
  if (normalized === 'PROGRAMADOR') return 'PROGRAMADOR';
  if (normalized === 'JEFE_OPERACION') return 'JEFE DE OPERACION';
  if (normalized === 'CORPORATIVO_USER') return 'OPERACION GLOBAL';
  if (normalized === 'JEFE_REGIONAL') return 'JEFE REGIONAL';
  if (normalized === 'GERENTE_PLAZA') return 'GERENTE DE PLAZA';
  if (normalized === 'JEFE_PATIO') return 'JEFE DE PATIO';
  if (normalized === 'SUPERVISOR') return 'SUPERVISOR';
  if (normalized === 'VENTAS') return 'VENTAS';
  if (normalized === 'AUXILIAR') return 'AUXILIAR';
  return normalized || 'USUARIO';
}

function programmerModeLabel(profile = {}) {
  if (roleCanUseProgrammerConsole(profile?.rol, profile)) return 'PROGRAMADOR';
  return friendlyRoleLabel(profile?.rol);
}

function friendlyScopeLabel(plaza = '') {
  return upper(plaza) || 'GLOBAL';
}

function describeError(error) {
  return safe(
    error?.details?.message
    || error?.details
    || error?.message
    || error
  ) || 'Error inesperado';
}

function friendlyDeviceType(row = {}) {
  const platform = lower(row.platform);
  const browser = lower(row.browser);
  if (platform === 'ios') return 'IPHONE';
  if (platform === 'android') return 'CELULAR';
  if (platform === 'mac' || platform === 'windows') return 'COMPUTADORA';
  if (browser) return 'NAVEGADOR';
  return 'EQUIPO';
}

function friendlyDeviceBrowser(row = {}) {
  const browser = lower(row.browser);
  if (browser === 'chrome') return 'Chrome';
  if (browser === 'safari') return 'Safari';
  if (browser === 'firefox') return 'Firefox';
  if (browser === 'edge') return 'Edge';
  return 'Navegador';
}

function friendlyDevicePermission(row = {}) {
  const permission = lower(row.permission);
  if (permission === 'granted') return row.pushEnabled === false ? 'Silenciado' : 'Activo';
  if (permission === 'denied') return 'Bloqueado';
  if (permission === 'unsupported') return 'Sin soporte';
  return 'Pendiente';
}

function friendlyDeviceIp(row = {}) {
  return safe(row.ipAddress || row.clientIp || row.forwardedFor || '') || 'Pendiente';
}

function friendlyDeviceGeo(row = {}) {
  const exactLocation = row.exactLocation || {};
  const city = safe(exactLocation.city || row.city || '');
  const state = safe(exactLocation.state || row.state || '');
  const addressLabel = safe(exactLocation.addressLabel || row.addressLabel || [city, state].filter(Boolean).join(', '));
  const latitude = Number(
    exactLocation.latitude
    ?? exactLocation.lat
    ?? row.geoLatitude
    ?? row.geoLat
    ?? row.approxLocation?.latitude
    ?? row.geo?.latitude
  );
  const longitude = Number(
    exactLocation.longitude
    ?? exactLocation.lng
    ?? row.geoLongitude
    ?? row.geoLng
    ?? row.approxLocation?.longitude
    ?? row.geo?.longitude
  );
  const accuracy = Number(
    exactLocation.accuracy
    ?? row.geoAccuracy
    ?? row.approxLocation?.accuracy
  );
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return addressLabel || 'Ubicación disponible';
  }
  const status = lower(row.locationStatus);
  if (status === 'denied') return 'Permiso denegado';
  if (status === 'unsupported') return 'Sin soporte';
  if (status === 'pending') return 'Pendiente';
  if (status === 'error') return 'Error al leer ubicacion';
  return addressLabel || safe(row.locationLabel || row.allowedPlaceLabel || row.locationName || '') || 'Pendiente';
}

function notificationKindLabel(row = {}) {
  const type = lower(row.kindLabel || row.type);
  if (type.includes('message') || type.includes('mensaje')) return 'Mensaje directo';
  if (type.includes('alert')) return 'Alerta critica';
  if (type.includes('cuadre.assigned')) return 'Mision de cuadre';
  if (type.includes('cuadre.updated')) return 'Cuadre actualizado';
  if (type.includes('cuadre.review_ready')) return 'Revision de cuadre';
  if (type.includes('test')) return 'Prueba de notificacion';
  return safe(row.kindLabel || row.type || 'Notificacion');
}

function notificationSender(row = {}) {
  return safe(row.senderLabel || row.actorName || row.payload?.remitente || row.payload?.actorName || 'Sistema');
}

function notificationContext(row = {}) {
  const parts = [notificationKindLabel(row)];
  const sender = notificationSender(row);
  if (sender) parts.push(`De ${sender}`);
  if (safe(row.plaza) && !lower(row.type).includes('test')) parts.push(safe(row.plaza));
  return parts.filter(Boolean).join(' · ');
}

function notificationDeliveryLabel(row = {}) {
  const delivery = row.delivery || {};
  if (delivery.mode === 'PUSH') return `Push ${delivery.successCount || 0}/${delivery.tokenCount || 0}`;
  if (delivery.mode === 'INBOX_ONLY') return 'Solo inbox';
  if (delivery.mode === 'FAILED') return 'Entrega fallida';
  return 'Pendiente';
}

function availablePlazas() {
  const plazasDetalle = Array.isArray(window.MEX_CONFIG?.empresa?.plazasDetalle) ? window.MEX_CONFIG.empresa.plazasDetalle : [];
  const direct = Array.isArray(window.MEX_CONFIG?.empresa?.plazas) ? window.MEX_CONFIG.empresa.plazas : [];
  return [...new Set([...direct, ...plazasDetalle.map(item => item?.id)].map(upper).filter(Boolean))];
}

function callable(name) {
  if (!functions) return null;
  return functions.httpsCallable(name);
}

function enableProgrammerPageScroll() {
  document.documentElement.classList.add('programmer-route');
  document.body?.classList.add('programmer-page');
}

enableProgrammerPageScroll();

async function loadProgrammerConfig() {
  try {
    const plaza = state.profile?.plazaAsignada || '';
    const config = typeof window.__mexEnsureConfigLoaded === 'function'
      ? await window.__mexEnsureConfigLoaded(plaza)
      : (window.api?.obtenerConfiguracion ? await window.api.obtenerConfiguracion(plaza) : null);
    if (config) window.MEX_CONFIG = config;
    window.MEX_CONFIG = window.MEX_CONFIG || { empresa: {}, listas: {} };
    window.MEX_CONFIG.empresa = window.MEX_CONFIG.empresa || {};
    if (!window.MEX_CONFIG.empresa.security || typeof window.MEX_CONFIG.empresa.security !== 'object') {
      window.MEX_CONFIG.empresa.security = {
        roles: {
          AUXILIAR: { label: 'AUXILIAR', level: 10, permissions: {} },
          VENTAS: { label: 'VENTAS', level: 20, permissions: { view_admin_cuadre: true } },
          SUPERVISOR: { label: 'SUPERVISOR', level: 25, permissions: { view_admin_cuadre: true, edit_admin_cuadre: true } },
          JEFE_PATIO: { label: 'JEFE DE PATIO', level: 25, permissions: { view_admin_cuadre: true, edit_admin_cuadre: true } },
          GERENTE_PLAZA: { label: 'GERENTE DE PLAZA', level: 25, permissions: { view_admin_cuadre: true, edit_admin_cuadre: true } },
          JEFE_REGIONAL: { label: 'JEFE REGIONAL', level: 30, permissions: { view_admin_cuadre: true, edit_admin_cuadre: true } },
          CORPORATIVO_USER: { label: 'CORPORATIVO USER', level: 40, fullAccess: true, permissions: { use_programmer_console: true, view_exact_location_logs: true } },
          PROGRAMADOR: { label: 'PROGRAMADOR', level: 50, fullAccess: true, permissions: { use_programmer_console: true, view_exact_location_logs: true } },
          JEFE_OPERACION: { label: 'JEFE DE OPERACION', level: 60, fullAccess: true, permissions: { use_programmer_console: true, view_exact_location_logs: true } }
        },
        permissionsCatalog: {}
      };
    }
    if (!window.MEX_CONFIG.empresa.security.permissionsCatalog || typeof window.MEX_CONFIG.empresa.security.permissionsCatalog !== 'object') {
      window.MEX_CONFIG.empresa.security.permissionsCatalog = {};
    }
    if (!window.MEX_CONFIG.empresa.security.roles || typeof window.MEX_CONFIG.empresa.security.roles !== 'object') {
      window.MEX_CONFIG.empresa.security.roles = {};
    }
  } catch (error) {
    console.warn('No se pudo cargar MEX_CONFIG en /programador:', error);
  }
}

async function callConsoleQuery(query, extra = {}) {
  const call = callable('queryProgrammerConsole');
  if (!call) throw new Error('Functions no disponibles');
  return call({ query, plaza: state.plaza, ...extra });
}

async function resolveProfile(user) {
  const email = lower(user?.email || '');
  if (!email) return null;
  const [direct, byEmail] = await Promise.all([
    db.collection(COL.USERS).doc(email).get(),
    db.collection(COL.USERS).where('email', '==', email).limit(1).get()
  ]);
  const doc = direct.exists ? direct : (!byEmail.empty ? byEmail.docs[0] : null);
  if (!doc) return null;
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    email,
    nombre: upper(data.nombre || data.usuario || email),
    rol: inferRole(data),
    plazaAsignada: upper(data.plazaAsignada || data.plaza || '')
  };
}

function setLoading(message = 'Cargando...', sub = '') {
  const root = document.getElementById('programmerApp');
  if (!root) return;
  root.innerHTML = `
    <div class="programmer-page-loading">
      <div class="cc-boot-anim">
        <div class="cc-boot-ring"></div>
        <span class="material-icons cc-boot-icon">terminal</span>
      </div>
      <strong>${escapeHtml(message)}</strong>
      ${sub ? `<span class="cc-boot-sub">${escapeHtml(sub)}</span>` : ''}
    </div>
  `;
}

// ── Skeleton loading para paneles ──────────────────────────
function skeletonRows(count = 5, cols = 4) {
  const cells = Array(cols).fill('<td><div class="cc-skel cc-skel-cell"></div></td>').join('');
  const rows = Array(count).fill(`<tr>${cells}</tr>`).join('');
  const headers = Array(cols).fill('<th><div class="cc-skel cc-skel-th"></div></th>').join('');
  return `<div class="programmer-table-wrap"><table class="programmer-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function skeletonCards(count = 6) {
  return `<div class="programmer-metrics-grid">${Array(count).fill('<div class="programmer-metric-card cc-skel-card"><div class="programmer-metric-icon"><div class="cc-skel" style="width:28px;height:28px;border-radius:50%;"></div></div><div><div class="cc-skel" style="width:70px;height:10px;margin-bottom:6px;border-radius:4px;"></div><div class="cc-skel" style="width:40px;height:22px;border-radius:6px;"></div></div></div>').join('')}</div>`;
}

// ── Animación de éxito sobre botón ──────────────────────────
function showSaveFeedback(btnId, successMsg = 'Guardado') {
  const btn = typeof btnId === 'string' ? document.getElementById(btnId) : btnId;
  if (!btn) return;
  const original = btn.innerHTML;
  const originalBg = btn.style.background;
  btn.innerHTML = `<span class="material-icons cc-check-anim">check_circle</span> ${escapeHtml(successMsg)}`;
  btn.style.background = 'linear-gradient(135deg,#059669,#10b981)';
  btn.disabled = true;
  setTimeout(() => {
    btn.innerHTML = original;
    btn.style.background = originalBg;
    btn.disabled = false;
  }, 1800);
}

function showLoadingBtn(btn, msg = 'Procesando...') {
  if (!btn) return;
  btn._ccOriginal = btn.innerHTML;
  btn.innerHTML = `<span class="material-icons" style="animation:ccSpin .7s linear infinite;font-size:15px;">sync</span> ${escapeHtml(msg)}`;
  btn.disabled = true;
}

function restoreBtn(btn) {
  if (!btn || !btn._ccOriginal) return;
  btn.innerHTML = btn._ccOriginal;
  btn.disabled = false;
  btn._ccOriginal = null;
}

function showToast(message, type = 'success') {
  if (window.showToast) {
    window.showToast(message, type);
    return;
  }
  const existing = document.getElementById('programmer-toast');
  existing?.remove();
  const toast = document.createElement('div');
  toast.id = 'programmer-toast';
  toast.className = `programmer-inline-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function isAllowed() {
  return roleCanUseProgrammerConsole(state.profile?.rol, state.profile || {});
}

function renderShell() {
  const root = document.getElementById('programmerApp');
  if (!root) return;
  const plazas = availablePlazas();
  const tabButtons = [
    ['resumen',        'dashboard',          'Resumen'],
    ['herramientas',   'build',              'Herramientas'],
    ['database',       'storage',            'Base de datos'],
    ['notificaciones', 'notifications_active','Notificaciones'],
    ['consultas',      'manage_search',      'Consultas'],
    ['jobs',           'inventory_2',        'Jobs'],
    ['config',         'settings',           'Config'],
    ['seguridad',      'security',           'Seguridad'],
    ['errores',        'bug_report',         'Errores'],
    ['dispositivos',   'devices',            'Dispositivos'],
  ];

  const errCount = state.errorsRows?.length || 0;
  const devsCount = state.devicesRows?.length || 0;
  const users = state.overview?.usersCount || 0;
  const plazaLabel = upper(state.plaza) || 'GLOBAL';
  const now = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  root.innerHTML = `
    <div class="cc-topbar">
      <div class="cc-topbar-left">
        <div class="cc-topbar-icon"><span class="material-icons">terminal</span></div>
        <div>
          <div class="cc-topbar-kicker">Sistema técnico · ${escapeHtml(window.FIREBASE_CONFIG?.projectId || 'firebase')}</div>
          <h1 class="cc-topbar-title">Centro de Control</h1>
          <p class="cc-topbar-sub">Operación global · Firestore · Seguridad · Notificaciones · Herramientas</p>
        </div>
      </div>
      <div class="cc-hero-stats">
        <div class="cc-stat-chip">
          <span class="material-icons">badge</span>
          <div><small>Usuarios</small><strong>${escapeHtml(String(users || '--'))}</strong></div>
        </div>
        <div class="cc-stat-chip">
          <span class="material-icons">devices</span>
          <div><small>Devices</small><strong>${escapeHtml(String(devsCount || '--'))}</strong></div>
        </div>
        <div class="cc-stat-chip ${errCount > 0 ? 'cc-stat-danger' : ''}">
          <span class="material-icons">bug_report</span>
          <div><small>Errores</small><strong>${escapeHtml(String(errCount))}</strong></div>
        </div>
        <div class="cc-stat-chip cc-stat-accent">
          <span class="material-icons">location_city</span>
          <div><small>Plaza foco</small><strong>${escapeHtml(plazaLabel)}</strong></div>
        </div>
      </div>
      <div class="programmer-page-top-actions">
        <button type="button" class="programmer-page-btn" onclick="window.location.href='/mapa'">
          <span class="material-icons">arrow_back</span>
          Al mapa
        </button>
        <button type="button" class="programmer-page-btn primary" id="programmerRefreshAllBtn">
          <span class="material-icons">refresh</span>
          Actualizar
        </button>
      </div>
    </div>

    <div class="cc-statusbar">
      <span class="cc-pill cc-pill-user">
        <span class="material-icons" style="font-size:13px;">person</span>
        ${escapeHtml(currentUserLabel())}
      </span>
      <span class="cc-pill cc-pill-role">
        <span class="material-icons" style="font-size:13px;">verified_user</span>
        ${escapeHtml(programmerModeLabel(state.profile || {}))}
      </span>
      <span class="cc-pill">
        <span class="material-icons" style="font-size:13px;">corporate_fare</span>
        ${escapeHtml(friendlyScopeLabel(state.profile?.plazaAsignada))}
      </span>
      <span class="cc-pill cc-pill-build">
        <span class="material-icons" style="font-size:13px;">tag</span>
        ${escapeHtml(BUILD_TAG)}
      </span>
      <span class="cc-pill cc-pill-time" id="ccLiveClock">
        <span class="material-icons" style="font-size:13px;">schedule</span>
        ${now}
      </span>
    </div>

    <div class="programmer-page-nav cc-nav">
      ${tabButtons.map(([key, icon, label]) => `
        <button type="button" class="programmer-nav-btn ${state.tab === key ? 'active' : ''}" data-tab="${key}">
          <span class="material-icons cc-tab-icon">${icon}</span>
          <span class="cc-tab-label">${label}</span>
          ${key === 'errores' && errCount > 0 ? `<span class="cc-tab-badge">${errCount}</span>` : ''}
        </button>
      `).join('')}
    </div>

    <div id="programmerTabContent" class="programmer-tab-content"></div>

    <div class="programmer-bottom-bar cc-bottom-bar">
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="material-icons" style="font-size:16px;color:#64748b;">location_city</span>
        <label class="programmer-inline-control">
          <span>Plaza foco</span>
          <select id="programmerGlobalPlazaSelect">
            <option value="">GLOBAL</option>
            ${plazas.map(plaza => `<option value="${escapeHtml(plaza)}" ${plaza === state.plaza ? 'selected' : ''}>${escapeHtml(plaza)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div style="display:flex;gap:8px;">
        <button type="button" class="programmer-page-btn" id="programmerOpenNotifBtn">
          <span class="material-icons">notifications_active</span>
          Notificaciones
        </button>
        <button type="button" class="programmer-page-btn" onclick="navigator.clipboard?.writeText(window.location.href).then(()=>showToast('URL copiada','success'))">
          <span class="material-icons">link</span>
        </button>
      </div>
    </div>
  `;

  root.querySelectorAll('.programmer-nav-btn').forEach(button => {
    button.addEventListener('click', () => {
      state.tab = button.dataset.tab;
      renderShell();
      renderCurrentTab();
    });
  });
  document.getElementById('programmerRefreshAllBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('programmerRefreshAllBtn');
    showLoadingBtn(btn, 'Actualizando...');
    await refreshCurrentTabData();
    restoreBtn(btn);
  });
  document.getElementById('programmerGlobalPlazaSelect')?.addEventListener('change', event => {
    state.plaza = upper(event.target.value || '');
    if (state.tab === 'config') loadSettingsPreview();
    else refreshAll();
  });
  document.getElementById('programmerOpenNotifBtn')?.addEventListener('click', () => {
    window.openNotificationCenter?.();
  });

  // Live clock
  const clockEl = document.getElementById('ccLiveClock');
  if (clockEl) {
    setInterval(() => {
      const t = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      clockEl.innerHTML = `<span class="material-icons" style="font-size:13px;">schedule</span> ${t}`;
    }, 20000);
  }

  renderCurrentTab();
}

function summaryCardsHtml() {
  const overview = state.overview || {};
  const cards = [
    { label: 'Usuarios',      value: overview.usersCount || 0,       icon: 'badge',           color: '#3b82f6', bg: '#eff6ff' },
    { label: 'Devices',       value: overview.devicesCount || 0,      icon: 'devices',         color: '#8b5cf6', bg: '#f5f3ff' },
    { label: 'Inbox sin leer',value: overview.unreadInboxCount || 0,  icon: 'mark_chat_unread',color: '#0ea5e9', bg: '#f0f9ff', warn: overview.unreadInboxCount > 10 },
    { label: 'Ops events',    value: overview.opsEventsCount || 0,    icon: 'timeline',        color: '#10b981', bg: '#f0fdf4' },
    { label: 'Jobs',          value: overview.jobsCount || 0,         icon: 'inventory_2',     color: '#f59e0b', bg: '#fffbeb' },
    { label: 'Errores',       value: overview.errorsCount || 0,       icon: 'bug_report',      color: '#ef4444', bg: '#fef2f2', warn: overview.errorsCount > 0 },
  ];
  return cards.map(c => `
    <div class="programmer-metric-card cc-metric-card" style="border-left:3px solid ${c.warn ? '#ef4444' : c.color};">
      <div class="programmer-metric-icon" style="background:${c.bg};color:${c.color};">
        <span class="material-icons">${c.icon}</span>
      </div>
      <div>
        <span>${c.label}</span>
        <strong style="color:${c.warn ? '#ef4444' : '#0f172a'};">${escapeHtml(String(c.value))}</strong>
      </div>
      ${c.warn ? `<span class="cc-warn-dot"></span>` : ''}
    </div>
  `).join('');
}

function rowsToTable(rows = [], options = {}) {
  if (!rows.length) {
    return `<div class="programmer-empty-state">
      <span class="material-icons">inbox</span>
      <strong>Sin resultados</strong>
      <p>No hay datos para mostrar con los filtros actuales.</p>
    </div>`;
  }
  const maxColumns = Number.isFinite(Number(options.maxColumns)) ? Number(options.maxColumns) : 8;
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))].slice(0, maxColumns);
  return `
    <div class="${escapeHtml(options.className || 'programmer-table-wrap')}">
      <table class="programmer-table">
        <thead>
          <tr>${keys.map(key => `<th>${escapeHtml(key)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              ${keys.map(key => {
                const value = row[key];
                if (value && typeof value === 'object' && typeof value.__html === 'string') {
                  return `<td>${value.__html}</td>`;
                }
                return `<td>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''))}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function htmlCell(html = '') {
  return { __html: html };
}

function renderQueryResultsHtml() {
  return rowsToTable(filteredQueryRows(), { className: 'programmer-table-wrap programmer-table-wrap-tall' });
}

function renderNotificationsFeed(rows = []) {
  if (!rows.length) return `<div class="programmer-empty-state">
    <span class="material-icons">notifications_none</span>
    <strong>Sin notificaciones registradas</strong>
    <p>Cuando existan eventos reales aparecerán aquí con remitente, contexto y entrega.</p>
  </div>`;

  return `
    <div class="programmer-feed-list">
      ${rows.map(row => `
        <article class="programmer-feed-card">
          <div class="programmer-feed-top">
            <div>
              <strong>${escapeHtml(row.title || 'Notificacion')}</strong>
              <span>${escapeHtml(notificationContext(row))}</span>
            </div>
            <em>${escapeHtml(dbDocDateLabel(row.createdAt || row.timestamp))}</em>
          </div>
          <p>${escapeHtml(row.body || '')}</p>
          <div class="programmer-feed-meta">
            <span>${escapeHtml(notificationDeliveryLabel(row))}</span>
            <span>${row.read === true || row.status === 'READ' ? 'Leida' : 'Pendiente'}</span>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function devicePermissionHtml(row = {}) {
  const label = friendlyDevicePermission(row);
  const permission = lower(row.permission);
  const css = permission === 'granted'
    ? 'programmer-soft-pill ok'
    : (permission === 'denied'
      ? 'programmer-soft-pill danger'
      : (permission === 'unsupported' ? 'programmer-soft-pill muted' : 'programmer-soft-pill warn'));
  return htmlCell(`<span class="${css}">${escapeHtml(label)}</span>`);
}

function deviceUserHtml(row = {}) {
  return htmlCell(`
    <div class="programmer-cell-user">
      <strong>${escapeHtml(safe(row.userName) || 'Sin usuario')}</strong>
      <span>${escapeHtml(safe(row.userEmail || row.userDocId) || 'Sin correo')}</span>
    </div>
  `);
}

function deviceGeoHtml(row = {}) {
  const exactLocation = row.exactLocation || {};
  const city = safe(exactLocation.city || row.city || '');
  const state = safe(exactLocation.state || row.state || '');
  const addressLabel = safe(exactLocation.addressLabel || row.addressLabel || [city, state].filter(Boolean).join(', ')) || 'Ubicación disponible';
  const latitude = Number(
    exactLocation.latitude
    ?? exactLocation.lat
    ?? row.geoLatitude
    ?? row.geoLat
    ?? row.approxLocation?.latitude
    ?? row.geo?.latitude
  );
  const longitude = Number(
    exactLocation.longitude
    ?? exactLocation.lng
    ?? row.geoLongitude
    ?? row.geoLng
    ?? row.approxLocation?.longitude
    ?? row.geo?.longitude
  );
  const accuracy = Number(
    exactLocation.accuracy
    ?? row.geoAccuracy
    ?? row.approxLocation?.accuracy
  );
  const mapsUrl = safe(exactLocation.googleMapsUrl || row.googleMapsUrl || '');
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const href = mapsUrl || `https://maps.google.com/?q=${latitude},${longitude}`;
    return htmlCell(`
      <div class="programmer-cell-geo">
        <span class="programmer-geo-label">${escapeHtml(addressLabel)}</span>
        <a class="programmer-geo-link programmer-geo-link-btn" href="${escapeHtml(href)}" target="_blank" rel="noopener">
          <span class="material-icons">map</span>
          <span>Ver ubi</span>
        </a>
      </div>
    `);
  }
  return htmlCell(`<span class="programmer-soft-pill muted">${escapeHtml(friendlyDeviceGeo(row))}</span>`);
}

function renderDevicesTableHtml(rows = []) {
  const mappedRows = rows.map(row => ({
    usuario: deviceUserHtml(row),
    rol: safe(row.userRole) || 'Sin rol',
    equipo: friendlyDeviceType(row),
    navegador: friendlyDeviceBrowser(row),
    permiso: devicePermissionHtml(row),
    push: row.pushEnabled === false ? 'Pausado' : 'Listo',
    plaza: safe(row.plaza) || 'GLOBAL',
    ip: friendlyDeviceIp(row),
    ubicacion: deviceGeoHtml(row),
    ruta: safe(row.activeRoute) || '/mapa',
    ultimaActividad: dbDocDateLabel(row.updatedAt || row.lastSeenAt)
  }));
  return rowsToTable(mappedRows, {
    className: 'programmer-table-wrap programmer-table-wrap-tall',
    maxColumns: 12
  });
}

function renderResumenTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;

  const errCount = state.errorsRows?.length || 0;
  const devsOk = state.devicesRows?.filter(r => lower(r.permission) === 'granted').length || 0;
  const devsTotal = state.devicesRows?.length || 0;
  const devsBlocked = state.devicesRows?.filter(r => lower(r.permission) === 'denied').length || 0;
  const healthStatus = errCount > 5 ? 'danger' : errCount > 0 ? 'warn' : 'ok';
  const healthLabel = healthStatus === 'ok' ? 'Todo normal' : healthStatus === 'warn' ? 'Con alertas' : 'Atención requerida';
  const healthColor = healthStatus === 'ok' ? '#10b981' : healthStatus === 'warn' ? '#f59e0b' : '#ef4444';

  container.innerHTML = `
    <section class="programmer-section cc-section-fade">
      <div class="programmer-section-head">
        <h3>Salud del sistema</h3>
        <span style="display:flex;align-items:center;gap:6px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${healthColor};display:inline-block;box-shadow:0 0 6px ${healthColor};"></span>
          ${escapeHtml(healthLabel)}
        </span>
      </div>
      <div class="programmer-metrics-grid">${summaryCardsHtml()}</div>
    </section>

    <section class="programmer-section cc-section-fade cc-health-bar-section">
      <div class="cc-health-row">
        <div class="cc-health-item">
          <div class="cc-health-label">Devices activos</div>
          <div class="cc-progress-track">
            <div class="cc-progress-fill" style="width:${devsTotal > 0 ? Math.round((devsOk/devsTotal)*100) : 0}%;background:#10b981;"></div>
          </div>
          <div class="cc-health-sub">${devsOk}/${devsTotal} con permisos</div>
        </div>
        <div class="cc-health-item">
          <div class="cc-health-label">Devices bloqueados</div>
          <div class="cc-progress-track">
            <div class="cc-progress-fill" style="width:${devsTotal > 0 ? Math.round((devsBlocked/devsTotal)*100) : 0}%;background:#ef4444;"></div>
          </div>
          <div class="cc-health-sub">${devsBlocked}/${devsTotal} bloqueados</div>
        </div>
        <div class="cc-health-item">
          <div class="cc-health-label">Tasa de errores</div>
          <div class="cc-progress-track">
            <div class="cc-progress-fill" style="width:${Math.min(100,errCount*5)}%;background:${healthColor};"></div>
          </div>
          <div class="cc-health-sub">${errCount} registros recientes</div>
        </div>
      </div>
    </section>

    <section class="programmer-two-col cc-section-fade">
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Últimos ops events</h4>
          <span>Stream unificado</span>
        </div>
        ${state.opsRows.length ? rowsToTable(state.opsRows.slice(0, 12)) : skeletonRows(5)}
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Últimos jobs</h4>
          <span>Dry-run y producción</span>
        </div>
        ${state.jobsRows.length ? rowsToTable(state.jobsRows.slice(0, 10)) : skeletonRows(5)}
      </div>
    </section>
  `;
}

function renderNotificacionesTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Notificaciones reales</h3>
        <span>Inbox, delivery y prueba manual</span>
      </div>
      <div class="programmer-notification-actions programmer-notification-actions-rich">
        <input id="programmerTestTarget" class="programmer-input" type="text" placeholder="Correo o nombre del usuario" value="${escapeHtml(state.testTarget)}">
        <input id="programmerTestTitle" class="programmer-input" type="text" placeholder="Título visible en el celular" value="${escapeHtml(state.testTitle)}">
        <input id="programmerTestBody" class="programmer-input" type="text" placeholder="Mensaje que recibirá el usuario" value="${escapeHtml(state.testBody)}">
        <button type="button" class="programmer-page-btn primary ${state.sendingTestNotification ? 'is-loading' : ''}" id="programmerSendTestNotifBtn" ${state.sendingTestNotification ? 'disabled' : ''}>
          <span class="material-icons">${state.sendingTestNotification ? 'hourglass_top' : 'send'}</span>
          ${state.sendingTestNotification ? 'Enviando...' : 'Enviar prueba'}
        </button>
      </div>
      <div id="programmerTestStatus" class="programmer-test-status">La prueba dispara inbox y push del dispositivo para el usuario destino.</div>
    </section>
    <section class="programmer-two-col">
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Inbox reciente</h4>
          <span>collectionGroup(inbox)</span>
        </div>
        ${renderNotificationsFeed(state.notificationsRows.slice(0, 16))}
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Dispositivos recientes</h4>
          <span>Tokens, permisos y foco</span>
        </div>
        ${renderDevicesTableHtml(state.devicesRows.slice(0, 16))}
      </div>
    </section>
  `;
  document.getElementById('programmerSendTestNotifBtn')?.addEventListener('click', async () => {
    const targetUser = safe(document.getElementById('programmerTestTarget')?.value);
    const title = safe(document.getElementById('programmerTestTitle')?.value) || 'Prueba de notificacion';
    const body = safe(document.getElementById('programmerTestBody')?.value) || 'Notificación de prueba desde consola.';
    const setStatus = message => {
      const statusEl = document.getElementById('programmerTestStatus');
      if (statusEl) statusEl.textContent = message;
    };
    state.testTarget = targetUser;
    state.testTitle = title;
    state.testBody = body;
    if (!targetUser) {
      showToast('Indica el usuario o correo destino.', 'error');
      return;
    }
    state.sendingTestNotification = true;
    renderCurrentTab();
    setStatus('Enviando prueba al dispositivo...');
    try {
      const result = await runJob('send-test-notification', { targetUser, title, body, dryRun: false });
      if (result?.ok) {
        setStatus('Prueba enviada. Ya deberia verse en el dispositivo y en el inbox.');
        state.testBody = '';
        await refreshAll();
      }
    } finally {
      state.sendingTestNotification = false;
      if (state.tab === 'notificaciones') renderCurrentTab();
    }
  });
  document.getElementById('programmerTestTarget')?.addEventListener('input', event => {
    state.testTarget = event.target.value;
  });
  document.getElementById('programmerTestTitle')?.addEventListener('input', event => {
    state.testTitle = event.target.value;
  });
  document.getElementById('programmerTestBody')?.addEventListener('input', event => {
    state.testBody = event.target.value;
  });
}

function renderConsultasTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Consultas seguras</h3>
        <span>Consulta predefinida con filtro cliente</span>
      </div>
      <div class="programmer-query-bar">
        <select id="programmerQueryName" class="programmer-input">
          <option value="ops_events">Ops events</option>
          <option value="notifications">Inbox</option>
          <option value="devices">Devices</option>
          <option value="errors">Errores</option>
          <option value="jobs">Jobs</option>
          <option value="audit">Audit</option>
          <option value="users">Usuarios</option>
          <option value="settings">Settings</option>
        </select>
        <input id="programmerQuerySearch" class="programmer-input" type="text" placeholder="Filtro local por texto">
        <input id="programmerQueryLimit" class="programmer-input small" type="number" min="10" max="150" value="${state.queryLimit}">
        <button id="programmerRunQueryBtn" type="button" class="programmer-page-btn primary">
          <span class="material-icons">manage_search</span>
          Ejecutar
        </button>
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Resultado</h4>
          <span>${escapeHtml(state.queryName)}</span>
        </div>
        <div id="programmerQueryResults">${renderQueryResultsHtml()}</div>
      </div>
    </section>
  `;
  document.getElementById('programmerQueryName')?.addEventListener('change', event => {
    state.queryName = event.target.value;
  });
  document.getElementById('programmerQuerySearch')?.addEventListener('input', event => {
    state.querySearch = event.target.value;
    const target = document.getElementById('programmerQueryResults');
    if (target) target.innerHTML = renderQueryResultsHtml();
  });
  document.getElementById('programmerQueryLimit')?.addEventListener('change', event => {
    state.queryLimit = Math.min(150, Math.max(10, Number(event.target.value) || 50));
  });
  document.getElementById('programmerRunQueryBtn')?.addEventListener('click', () => runQuery(state.queryName));
}

function renderJobsTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  const resultHtml = state.jobResult
    ? `<pre class="programmer-code-block">${escapeHtml(JSON.stringify(state.jobResult, null, 2))}</pre>`
    : `<div class="programmer-empty-state"><span class="material-icons">build_circle</span><strong>Sin ejecución reciente</strong><p>Corre un job para ver el resultado aquí.</p></div>`;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Jobs operativos</h3>
        <span>Migraciones, validación y mantenimiento</span>
      </div>
      <div class="programmer-job-grid">
        <label class="programmer-job-card">
          <input type="checkbox" id="programmerDryRun" checked>
          <div>
            <strong>Dry-run por default</strong>
            <small>No muta datos hasta desmarcarlo.</small>
          </div>
        </label>
        <button type="button" class="programmer-page-btn" data-job="validate-plazas">Validar plazas</button>
        <button type="button" class="programmer-page-btn" data-job="backfill-ops-events">Backfill ops_events</button>
        <button type="button" class="programmer-page-btn" data-job="export-config">Exportar config</button>
        <button type="button" class="programmer-page-btn" data-job="cleanup-device-tokens">Limpiar tokens inválidos</button>
      </div>
    </section>
    <section class="programmer-two-col">
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Resultado del último job</h4>
          <span>JSON completo</span>
        </div>
        ${resultHtml}
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Historial de jobs</h4>
          <span>programmer_jobs</span>
        </div>
        ${rowsToTable(state.jobsRows.slice(0, 18))}
      </div>
    </section>
  `;
  container.querySelectorAll('[data-job]').forEach(button => {
    button.addEventListener('click', async () => {
      const dryRun = document.getElementById('programmerDryRun')?.checked !== false;
      showLoadingBtn(button, 'Ejecutando...');
      const res = await runJob(button.dataset.job, { dryRun });
      if (res?.ok) showSaveFeedback(button, 'Listo');
      else restoreBtn(button);
    });
  });
}

function renderConfigTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  const plazas = availablePlazas();
  const effective = {
    ...(state.settingsGlobal || {}),
    ...(state.settingsPlaza || {})
  };
  const editorSource = state.configMode === 'global' ? state.settingsGlobal : state.settingsPlaza;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Config diff</h3>
        <span>GLOBAL + plaza con preview efectivo y editor JSON</span>
      </div>
      <div class="programmer-query-bar">
        <select id="programmerConfigPlaza" class="programmer-input">
          <option value="">GLOBAL</option>
          ${plazas.map(plaza => `<option value="${escapeHtml(plaza)}" ${plaza === state.plaza ? 'selected' : ''}>${escapeHtml(plaza)}</option>`).join('')}
        </select>
        <select id="programmerConfigMode" class="programmer-input">
          <option value="plaza" ${state.configMode === 'plaza' ? 'selected' : ''}>Editar plaza</option>
          <option value="global" ${state.configMode === 'global' ? 'selected' : ''}>Editar GLOBAL</option>
        </select>
        <button id="programmerReloadConfigBtn" type="button" class="programmer-page-btn">
          <span class="material-icons">sync</span>
          Recargar
        </button>
        <button id="programmerSaveConfigBtn" type="button" class="programmer-page-btn primary">
          <span class="material-icons">save</span>
          Guardar JSON
        </button>
      </div>
    </section>
    <section class="programmer-config-stack">
      <details class="programmer-collapse" open>
        <summary>GLOBAL <span>settings/GLOBAL</span></summary>
        <pre class="programmer-code-block">${escapeHtml(JSON.stringify(state.settingsGlobal || {}, null, 2))}</pre>
      </details>
      <details class="programmer-collapse" open>
        <summary>Plaza <span>settings/${escapeHtml(state.plaza || 'GLOBAL')}</span></summary>
        <pre class="programmer-code-block">${escapeHtml(JSON.stringify(state.settingsPlaza || {}, null, 2))}</pre>
      </details>
      <details class="programmer-collapse" open>
        <summary>Configuracion efectiva <span>Overlay actual</span></summary>
        <pre class="programmer-code-block">${escapeHtml(JSON.stringify(effective, null, 2))}</pre>
      </details>
      <details class="programmer-collapse" open>
        <summary>Editor JSON <span>${state.configMode === 'global' ? 'settings/GLOBAL' : `settings/${state.plaza || 'GLOBAL'}`}</span></summary>
        <textarea id="programmerConfigEditor" class="programmer-json-editor">${escapeHtml(JSON.stringify(editorSource || {}, null, 2))}</textarea>
      </details>
    </section>
  `;
  document.getElementById('programmerConfigPlaza')?.addEventListener('change', event => {
    state.plaza = upper(event.target.value || '');
    loadSettingsPreview();
  });
  document.getElementById('programmerConfigMode')?.addEventListener('change', event => {
    state.configMode = event.target.value;
    renderCurrentTab();
  });
  document.getElementById('programmerReloadConfigBtn')?.addEventListener('click', () => loadSettingsPreview());
  document.getElementById('programmerSaveConfigBtn')?.addEventListener('click', () => saveSettingsEditor());
}

function renderSeguridadTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  const security = window.MEX_CONFIG?.empresa?.security || {};
  const roles = Object.entries(security.roles || {}).map(([key, value]) => ({
    id: key,
    label: value?.label || key,
    level: value?.level ?? 0,
    fullAccess: value?.fullAccess === true,
    needsPlaza: value?.needsPlaza !== false,
    multiPlaza: value?.multiPlaza === true,
    permissions: Object.entries(value?.permissions || {}).filter(([, enabled]) => enabled === true).map(([perm]) => perm)
  })).sort((a, b) => (a.level - b.level) || a.id.localeCompare(b.id));
  const catalog = Object.entries(security.permissionsCatalog || {}).map(([key, value]) => ({
    id: key,
    label: value?.label || key,
    description: value?.description || '',
    group: value?.group || 'General'
  }));

  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Seguridad y permisos</h3>
        <span>Resumen rápido del catálogo activo, roles configurados y auditoría reciente</span>
      </div>
    </section>
    <section class="programmer-two-col">
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Roles activos</h4>
          <span>${escapeHtml(String(roles.length))} perfiles</span>
        </div>
        ${rowsToTable(roles.map(role => ({
          role: role.id,
          label: role.label,
          level: role.level,
          fullAccess: role.fullAccess,
          needsPlaza: role.needsPlaza,
          multiPlaza: role.multiPlaza,
          permissions: role.permissions.join(', ')
        })))}
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Catálogo de permisos</h4>
          <span>${escapeHtml(String(catalog.length))} claves</span>
        </div>
        ${rowsToTable(catalog)}
      </div>
    </section>
    <section class="programmer-panel">
      <div class="programmer-panel-head">
        <h4>Auditoría reciente</h4>
        <span>programmer_audit</span>
      </div>
      ${rowsToTable(state.auditRows.slice(0, 20))}
    </section>
  `;
}

function renderErroresTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Errores y observabilidad</h3>
        <span>Frontend y backend reunidos en la misma consola</span>
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>programmer_errors</h4>
          <span>${escapeHtml(String(state.errorsRows.length))} registros</span>
        </div>
        ${rowsToTable(state.errorsRows)}
      </div>
    </section>
  `;
}

function renderDispositivosTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  const activeDevices = state.devicesRows.filter(row => lower(row.permission) === 'granted').length;
  const locatedDevices = state.devicesRows.filter(row => row.exactLocation?.latitude && row.exactLocation?.longitude).length;
  const blockedDevices = state.devicesRows.filter(row => lower(row.permission) === 'denied').length;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Dispositivos y permisos</h3>
        <span>Diagnóstico rápido de tokens, foco y mute</span>
      </div>
      <div class="programmer-three-col">
        <article class="programmer-metric-card programmer-metric-card-inline">
          <div class="programmer-metric-icon"><span class="material-icons">devices</span></div>
          <div><span>Registrados</span><strong>${escapeHtml(String(state.devicesRows.length || 0))}</strong></div>
        </article>
        <article class="programmer-metric-card programmer-metric-card-inline">
          <div class="programmer-metric-icon"><span class="material-icons">my_location</span></div>
          <div><span>Con ubicación</span><strong>${escapeHtml(String(locatedDevices))}</strong></div>
        </article>
        <article class="programmer-metric-card programmer-metric-card-inline">
          <div class="programmer-metric-icon"><span class="material-icons">shield</span></div>
          <div><span>Bloqueados / activos</span><strong>${escapeHtml(`${blockedDevices} / ${activeDevices}`)}</strong></div>
        </article>
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>collectionGroup(devices)</h4>
          <span>Últimos dispositivos registrados</span>
        </div>
        ${renderDevicesTableHtml(state.devicesRows)}
      </div>
    </section>
  `;
}

function renderHerramientasTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;

  const tools = [
    {
      id: 'tool-backfill',
      icon: 'sync_alt',
      color: '#10b981',
      title: 'Backfill de Plaza',
      desc: 'Inyecta el campo <code>plaza</code> en documentos de cuadre y externos sin plaza asignada. Operación segura, no borra datos.',
      action: 'ejecutarBackfillPlaza',
      label: 'Ejecutar backfill',
      danger: false,
    },
    {
      id: 'tool-migration',
      icon: 'move_up',
      color: '#8b5cf6',
      title: 'Migrar datos legacy',
      desc: 'Mueve documentos planos de cuadre, externos, admins e historial a la nueva arquitectura de subcollections por plaza.',
      action: 'ejecutarMigracionCC',
      label: 'Ejecutar migración',
      danger: false,
    },
    {
      id: 'tool-tokens',
      icon: 'phonelink_erase',
      color: '#f59e0b',
      title: 'Limpiar tokens FCM inválidos',
      desc: 'Elimina tokens de dispositivos marcados como inválidos por Firebase. Mejora la entrega de push notifications.',
      action: 'ejecutarLimpiezaTokens',
      label: 'Limpiar tokens',
      danger: false,
    },
    {
      id: 'tool-export',
      icon: 'download',
      color: '#0ea5e9',
      title: 'Exportar configuración',
      desc: 'Descarga un JSON completo con empresa, listas, plazas y security del sistema. Útil como backup antes de cambios grandes.',
      action: 'ejecutarExportConfig',
      label: 'Exportar JSON',
      danger: false,
    },
    {
      id: 'tool-validate',
      icon: 'fact_check',
      color: '#6366f1',
      title: 'Validar plazas',
      desc: 'Revisa cada plaza: settings, estructura del mapa, correos y estado de bloqueo. Muestra inconsistencias encontradas.',
      action: 'ejecutarValidarPlazas',
      label: 'Validar ahora',
      danger: false,
    },
    {
      id: 'tool-delete-doc',
      icon: 'delete_forever',
      color: '#ef4444',
      title: 'Eliminar documento Firestore',
      desc: 'Elimina un documento por ruta exacta. Requiere confirmación. Las subcolecciones no se borran automáticamente.',
      action: 'ejecutarEliminarDocCC',
      label: 'Eliminar documento',
      danger: true,
    },
  ];

  container.innerHTML = `
    <section class="programmer-section cc-section-fade">
      <div class="programmer-section-head">
        <h3>Herramientas del sistema</h3>
        <span>Operaciones seguras con progreso y confirmación</span>
      </div>
      <div class="cc-tools-grid">
        ${tools.map(t => `
          <div class="cc-tool-card ${t.danger ? 'cc-tool-danger' : ''}">
            <div class="cc-tool-icon" style="background:${t.color}1a;color:${t.color};">
              <span class="material-icons">${t.icon}</span>
            </div>
            <div class="cc-tool-body">
              <div class="cc-tool-title">${escapeHtml(t.title)}</div>
              <div class="cc-tool-desc">${t.desc}</div>
              <div class="cc-tool-progress-wrap" id="${t.id}-wrap" style="display:none;">
                <div class="cc-progress-track">
                  <div class="cc-progress-fill cc-progress-anim" id="${t.id}-bar" style="width:0%;background:${t.color};"></div>
                </div>
                <div class="cc-tool-progress-label" id="${t.id}-label">Iniciando...</div>
              </div>
            </div>
            <button type="button" class="cc-tool-btn ${t.danger ? 'cc-tool-btn-danger' : ''}" id="${t.id}-btn"
              data-action="${t.action}" style="--tool-color:${t.color};">
              <span class="material-icons">${t.danger ? 'warning' : 'play_arrow'}</span>
              ${escapeHtml(t.label)}
            </button>
          </div>
        `).join('')}
      </div>
    </section>

    <section class="programmer-section cc-section-fade" id="cc-tools-log-section" style="${state.toolsLog?.length ? '' : 'display:none;'}">
      <div class="programmer-panel-head">
        <h4>Log de herramientas</h4>
        <button type="button" class="programmer-page-btn" style="font-size:11px;min-height:30px;" onclick="state.toolsLog=[];renderHerramientasTab()">Limpiar</button>
      </div>
      <div class="cc-tools-log" id="cc-tools-log">
        ${(state.toolsLog || []).map(l => `
          <div class="cc-log-line cc-log-${l.kind}">
            <span class="cc-log-time">${l.time}</span>
            <span class="material-icons cc-log-icon">${l.kind === 'error' ? 'error' : l.kind === 'warn' ? 'warning' : 'check_circle'}</span>
            <span class="cc-log-msg">${escapeHtml(l.msg)}</span>
          </div>
        `).join('')}
      </div>
    </section>

    <div id="cc-delete-doc-modal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.8);z-index:80000;justify-content:center;align-items:center;backdrop-filter:blur(4px);">
      <div style="background:#fff;border-radius:18px;padding:24px;max-width:460px;width:90%;box-shadow:0 24px 56px rgba(0,0,0,.3);">
        <div style="font-size:15px;font-weight:900;color:#0f172a;margin-bottom:8px;">Eliminar documento Firestore</div>
        <div style="font-size:12px;color:#64748b;margin-bottom:14px;font-weight:600;">Escribe la ruta completa del documento. Esta operación no puede deshacerse.</div>
        <input type="text" id="cc-delete-doc-path" placeholder="ej: cuadre/BJX/unidades/A1234" class="programmer-input" style="width:100%;margin-bottom:12px;box-sizing:border-box;">
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button onclick="document.getElementById('cc-delete-doc-modal').style.display='none'" class="programmer-page-btn">Cancelar</button>
          <button id="cc-delete-doc-confirm" class="programmer-page-btn" style="background:#ef4444;border-color:#ef4444;color:white;">
            <span class="material-icons">delete_forever</span> Eliminar
          </button>
        </div>
      </div>
    </div>
  `;

  if (!state.toolsLog) state.toolsLog = [];

  function toolLog(msg, kind = 'info') {
    const time = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    state.toolsLog = [{ msg, kind, time }, ...(state.toolsLog || [])].slice(0, 100);
    const sec = document.getElementById('cc-tools-log-section');
    if (sec) sec.style.display = '';
    const log = document.getElementById('cc-tools-log');
    if (log) {
      log.innerHTML = state.toolsLog.map(l => `
        <div class="cc-log-line cc-log-${l.kind}">
          <span class="cc-log-time">${l.time}</span>
          <span class="material-icons cc-log-icon">${l.kind === 'error' ? 'error' : l.kind === 'warn' ? 'warning' : 'check_circle'}</span>
          <span class="cc-log-msg">${escapeHtml(l.msg)}</span>
        </div>
      `).join('');
    }
  }

  function setToolProgress(id, pct, label) {
    const wrap = document.getElementById(`${id}-wrap`);
    const bar = document.getElementById(`${id}-bar`);
    const lbl = document.getElementById(`${id}-label`);
    if (wrap) wrap.style.display = '';
    if (bar) bar.style.width = `${Math.min(100, pct)}%`;
    if (lbl) lbl.textContent = label;
  }

  function resetToolProgress(id) {
    const wrap = document.getElementById(`${id}-wrap`);
    if (wrap) wrap.style.display = 'none';
  }

  // Bind all tool buttons
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const toolId = btn.id.replace('-btn', '');
      showLoadingBtn(btn, 'Procesando...');
      setToolProgress(toolId, 10, 'Iniciando...');
      toolLog(`Iniciando: ${action}`, 'info');

      try {
        if (action === 'ejecutarBackfillPlaza') {
          setToolProgress(toolId, 30, 'Leyendo documentos...');
          await new Promise(r => setTimeout(r, 300));
          if (typeof window.ejecutarBackfillPlaza === 'function') {
            window.ejecutarBackfillPlaza();
            setToolProgress(toolId, 100, 'Backfill iniciado en panel admin');
            toolLog('Backfill iniciado — ver progreso en panel de configuración', 'info');
          } else {
            const res = await runJob('backfill-ops-events', { dryRun: false });
            if (res?.ok) toolLog('Backfill completado', 'info');
          }
        } else if (action === 'ejecutarMigracionCC') {
          setToolProgress(toolId, 20, 'Preparando migración...');
          const res = await runJob('migrate-legacy', { dryRun: false });
          setToolProgress(toolId, 100, res?.ok ? 'Migración completada' : 'Error en migración');
          toolLog(res?.ok ? 'Migración completada sin errores' : `Error: ${describeError(res?.error)}`, res?.ok ? 'info' : 'error');
        } else if (action === 'ejecutarLimpiezaTokens') {
          setToolProgress(toolId, 40, 'Buscando tokens inválidos...');
          const res = await runJob('cleanup-device-tokens', { dryRun: false });
          setToolProgress(toolId, 100, res?.ok ? 'Tokens limpiados' : 'Error');
          toolLog(res?.ok ? `Tokens FCM inválidos eliminados` : `Error: ${describeError(res?.error)}`, res?.ok ? 'info' : 'error');
        } else if (action === 'ejecutarExportConfig') {
          setToolProgress(toolId, 50, 'Recopilando configuración...');
          const payload = { empresa: window.MEX_CONFIG?.empresa || {}, listas: window.MEX_CONFIG?.listas || {}, ts: new Date().toISOString() };
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `config_${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          setToolProgress(toolId, 100, 'Archivo descargado');
          toolLog('Configuración exportada como JSON', 'info');
        } else if (action === 'ejecutarValidarPlazas') {
          setToolProgress(toolId, 20, 'Consultando plazas...');
          const res = await runJob('validate-plazas', { dryRun: true });
          setToolProgress(toolId, 100, res?.ok ? 'Validación completada' : 'Error');
          toolLog(res?.ok ? 'Validación completada — ver resultado en Jobs' : `Error: ${describeError(res?.error)}`, res?.ok ? 'info' : 'error');
        } else if (action === 'ejecutarEliminarDocCC') {
          restoreBtn(btn);
          resetToolProgress(toolId);
          const modal = document.getElementById('cc-delete-doc-modal');
          if (modal) modal.style.display = 'flex';
          return;
        }
        showSaveFeedback(btn, 'Completado');
      } catch (e) {
        toolLog(`Error inesperado: ${describeError(e)}`, 'error');
        restoreBtn(btn);
      }
      setTimeout(() => resetToolProgress(toolId), 3000);
    });
  });

  // Delete doc modal confirm
  document.getElementById('cc-delete-doc-confirm')?.addEventListener('click', async () => {
    const path = safe(document.getElementById('cc-delete-doc-path')?.value);
    if (!path) { showToast('Escribe la ruta del documento', 'error'); return; }
    document.getElementById('cc-delete-doc-modal').style.display = 'none';
    const res = await runJob('delete-document', { dryRun: false, docPath: path });
    toolLog(res?.ok ? `Documento eliminado: ${path}` : `Error eliminando ${path}: ${describeError(res?.error)}`, res?.ok ? 'info' : 'error');
    if (res?.ok) showToast(`Documento ${path} eliminado.`, 'success');
  });
}

function renderCurrentTab() {
  if (state.tab === 'resumen') return renderResumenTab();
  if (state.tab === 'herramientas') return renderHerramientasTab();
  if (state.tab === 'database') {
    renderDatabaseTab();
    ensureDatabaseTabReady().catch(error => {
      console.error('ensureDatabaseTabReady', error);
    });
    return;
  }
  if (state.tab === 'notificaciones') return renderNotificacionesTab();
  if (state.tab === 'consultas') return renderConsultasTab();
  if (state.tab === 'jobs') return renderJobsTab();
  if (state.tab === 'config') return renderConfigTab();
  if (state.tab === 'seguridad') return renderSeguridadTab();
  if (state.tab === 'errores') return renderErroresTab();
  if (state.tab === 'dispositivos') return renderDispositivosTab();
}

function filteredQueryRows() {
  if (!state.querySearch) return state.queryRows;
  const term = lower(state.querySearch);
  return state.queryRows.filter(row => JSON.stringify(row).toLowerCase().includes(term));
}

function dbDocDateLabel(value) {
  const text = safe(value);
  if (!text) return 'Sin fecha';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString('es-MX');
}

function filteredDbCollections() {
  if (!state.dbCollectionSearch) return state.dbCollections;
  const term = lower(state.dbCollectionSearch);
  return state.dbCollections.filter(item => JSON.stringify(item).toLowerCase().includes(term));
}

function filteredDbDocs() {
  if (!state.dbDocSearch) return state.dbDocs;
  const term = lower(state.dbDocSearch);
  return state.dbDocs.filter(item => JSON.stringify(item).toLowerCase().includes(term));
}

function renderDbCollectionsHtml() {
  const collections = filteredDbCollections();
  if (!collections.length) {
    return `<div class="programmer-empty-state">
      <span class="material-icons">folder_off</span>
      <strong>Sin colecciones visibles</strong>
      <p>Escribe una ruta padre válida o vuelve a la raíz para inspeccionar otra rama.</p>
    </div>`;
  }

  return collections.map(item => `
    <button type="button" class="programmer-db-item ${state.dbCollectionPath === item.path ? 'active' : ''}" data-db-collection="${escapeHtml(item.path)}">
      <div class="programmer-db-item-copy">
        <strong>${escapeHtml(item.id)}</strong>
        <span>${escapeHtml(item.path)}</span>
      </div>
      <span class="material-icons">folder</span>
    </button>
  `).join('');
}

function renderDbDocsHtml() {
  const docs = filteredDbDocs();
  if (!docs.length) {
    return `<div class="programmer-empty-state">
      <span class="material-icons">description</span>
      <strong>Sin documentos cargados</strong>
      <p>Abre una colección para ver y editar sus documentos tal como viven en Firestore.</p>
    </div>`;
  }

  return docs.map(item => `
    <button type="button" class="programmer-db-item ${state.dbDocPath === item.path ? 'active' : ''}" data-db-doc="${escapeHtml(item.path)}">
      <div class="programmer-db-item-copy">
        <strong>${escapeHtml(item.id)}</strong>
        <span>${escapeHtml(item.path)}</span>
        <p>${escapeHtml(item.preview || `${item.fieldCount || 0} campos`)}</p>
      </div>
      <div class="programmer-db-item-meta">
        <span>${escapeHtml(String(item.fieldCount || 0))} campos</span>
        <span>${escapeHtml(dbDocDateLabel(item.updateTime))}</span>
      </div>
    </button>
  `).join('');
}

function currentDbEditorValue() {
  return document.getElementById('programmerDbEditor')?.value || '{}';
}

async function loadDbCollections(parentPath = state.dbParentPath || '') {
  try {
    const normalizedParent = safe(parentPath).replace(/^\/+|\/+$/g, '');
    const res = await callConsoleQuery('db_collections', { parentPath: normalizedParent });
    state.dbParentPath = safe(res.data?.parentPath || normalizedParent);
    state.dbCollections = Array.isArray(res.data?.rows) ? res.data.rows : [];
    state.dbLoaded = true;
    if (state.tab === 'database') renderCurrentTab();
  } catch (error) {
    console.error('loadDbCollections', error);
    showToast(`No se pudieron cargar las colecciones: ${describeError(error)}`, 'error');
    reportProgrammerError({ kind: 'programmer.db.collections', scope: 'programador', message: describeError(error), stack: error.stack });
  }
}

async function loadDbDocs(collectionPath = state.dbCollectionPath || '') {
  const normalized = safe(collectionPath).replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    state.dbCollectionPath = '';
    state.dbDocs = [];
    if (state.tab === 'database') renderCurrentTab();
    return;
  }
  try {
    const res = await callConsoleQuery('db_docs', {
      collectionPath: normalized,
      limit: state.dbLimit
    });
    state.dbCollectionPath = safe(res.data?.collectionPath || normalized);
    state.dbDocs = Array.isArray(res.data?.rows) ? res.data.rows : [];
    if (!state.dbDocPath && state.dbDocs[0]?.path) {
      state.dbDocPath = state.dbDocs[0].path;
    }
    if (state.tab === 'database') renderCurrentTab();
  } catch (error) {
    console.error('loadDbDocs', error);
    showToast(`No se pudo abrir la colección: ${describeError(error)}`, 'error');
    reportProgrammerError({ kind: 'programmer.db.docs', scope: 'programador', message: describeError(error), stack: error.stack });
  }
}

async function loadDbDocument(docPath = state.dbDocPath || '') {
  const normalized = safe(docPath).replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    state.dbDocPath = '';
    state.dbDocument = null;
    state.dbSubcollections = [];
    if (state.tab === 'database') renderCurrentTab();
    return;
  }
  try {
    const res = await callConsoleQuery('db_document', { docPath: normalized });
    state.dbDocPath = safe(res.data?.docPath || normalized);
    state.dbDocument = res.data?.document || null;
    state.dbSubcollections = Array.isArray(res.data?.subcollections) ? res.data.subcollections : [];
    if (state.tab === 'database') renderCurrentTab();
  } catch (error) {
    console.error('loadDbDocument', error);
    showToast(`No se pudo abrir el documento: ${describeError(error)}`, 'error');
    reportProgrammerError({ kind: 'programmer.db.document', scope: 'programador', message: describeError(error), stack: error.stack });
  }
}

async function openDbCollection(path = '') {
  const normalized = safe(path).replace(/^\/+|\/+$/g, '');
  if (!normalized) return;
  state.dbCollectionPath = normalized;
  state.dbDocPath = '';
  state.dbDocument = null;
  state.dbSubcollections = [];
  await loadDbDocs(normalized);
}

async function openDbDocument(path = '') {
  const normalized = safe(path).replace(/^\/+|\/+$/g, '');
  if (!normalized) return;
  state.dbDocPath = normalized;
  await loadDbDocument(normalized);
}

async function saveDbDocument(merge = true) {
  const docPathInput = safe(document.getElementById('programmerDbDocPathInput')?.value || state.dbDocPath);
  if (!docPathInput) {
    showToast('Indica la ruta del documento.', 'error');
    return;
  }
  try {
    const parsed = JSON.parse(currentDbEditorValue() || '{}');
    const result = await runJob('upsert-document', {
      dryRun: false,
      docPath: docPathInput,
      merge,
      data: parsed
    });
    if (!result?.ok) return;
    state.dbDocPath = docPathInput;
    const collectionPath = docPathInput.split('/').slice(0, -1).join('/');
    await Promise.all([
      loadDbDocument(docPathInput),
      loadDbDocs(collectionPath)
    ]);
  } catch (error) {
    console.error('saveDbDocument', error);
    showToast(`No se pudo guardar el documento: ${describeError(error)}`, 'error');
  }
}

async function deleteDbDocument() {
  const docPathInput = safe(document.getElementById('programmerDbDocPathInput')?.value || state.dbDocPath);
  if (!docPathInput) {
    showToast('Selecciona un documento para eliminar.', 'error');
    return;
  }
  const ok = window.confirm(`Se eliminará ${docPathInput}. Las subcolecciones no se borran automáticamente. ¿Continuar?`);
  if (!ok) return;
  try {
    const result = await runJob('delete-document', {
      dryRun: false,
      docPath: docPathInput
    });
    if (!result?.ok) return;
    const collectionPath = docPathInput.split('/').slice(0, -1).join('/');
    state.dbDocPath = '';
    state.dbDocument = null;
    state.dbSubcollections = [];
    await loadDbDocs(collectionPath);
  } catch (error) {
    console.error('deleteDbDocument', error);
    showToast(`No se pudo eliminar el documento: ${describeError(error)}`, 'error');
  }
}

function renderDatabaseTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  const documentPayload = state.dbDocument?.data || {};
  const documentText = JSON.stringify(documentPayload, null, 2);

  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Base de datos</h3>
        <span>Firestore completo por ruta, con edición directa y subcolecciones</span>
      </div>
      <div class="programmer-db-toolbar">
        <label class="programmer-inline-control programmer-inline-control-grow">
          <span>Ruta padre</span>
          <input id="programmerDbParentPath" class="programmer-input" type="text" placeholder="Vacío = colecciones raíz | usuarios/correo@dominio" value="${escapeHtml(state.dbParentPath)}">
        </label>
        <label class="programmer-inline-control">
          <span>Límite</span>
          <input id="programmerDbLimit" class="programmer-input small" type="number" min="20" max="300" value="${state.dbLimit}">
        </label>
        <button id="programmerDbRootBtn" type="button" class="programmer-page-btn">
          <span class="material-icons">home_storage</span>
          Raíz
        </button>
        <button id="programmerDbBrowseBtn" type="button" class="programmer-page-btn primary">
          <span class="material-icons">folder_open</span>
          Ver colecciones
        </button>
      </div>
    </section>

    <section class="programmer-db-grid">
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Colecciones</h4>
          <span>${escapeHtml(state.dbParentPath || 'raíz')}</span>
        </div>
        <div class="programmer-db-panel-tools">
          <input id="programmerDbCollectionSearch" class="programmer-input" type="text" placeholder="Buscar colección..." value="${escapeHtml(state.dbCollectionSearch)}">
        </div>
        <div id="programmerDbCollectionsList" class="programmer-db-list">
          ${renderDbCollectionsHtml()}
        </div>
      </div>

      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Documentos</h4>
          <span>${escapeHtml(state.dbCollectionPath || 'elige una colección')}</span>
        </div>
        <div class="programmer-db-panel-tools">
          <input id="programmerDbCollectionPathInput" class="programmer-input" type="text" placeholder="Ruta colección, ej. usuarios o usuarios/correo/inbox" value="${escapeHtml(state.dbCollectionPath)}">
          <button id="programmerDbOpenCollectionBtn" type="button" class="programmer-page-btn">
            <span class="material-icons">pageview</span>
            Abrir
          </button>
          <input id="programmerDbDocSearch" class="programmer-input" type="text" placeholder="Filtrar documentos..." value="${escapeHtml(state.dbDocSearch)}">
        </div>
        <div id="programmerDbDocsList" class="programmer-db-list">
          ${renderDbDocsHtml()}
        </div>
      </div>

      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Editor de documento</h4>
          <span>${escapeHtml(state.dbDocPath || 'selecciona un documento')}</span>
        </div>
        <div class="programmer-db-editor-meta">
          <label class="programmer-inline-control">
            <span>Ruta documento</span>
            <input id="programmerDbDocPathInput" class="programmer-input" type="text" placeholder="usuarios/correo@dominio" value="${escapeHtml(state.dbDocPath)}">
          </label>
          <div class="programmer-db-actions">
            <button id="programmerDbReloadDocBtn" type="button" class="programmer-page-btn">
              <span class="material-icons">sync</span>
              Recargar
            </button>
            <button id="programmerDbSaveMergeBtn" type="button" class="programmer-page-btn primary">
              <span class="material-icons">save</span>
              Guardar merge
            </button>
            <button id="programmerDbReplaceBtn" type="button" class="programmer-page-btn">
              <span class="material-icons">upload_file</span>
              Reemplazar
            </button>
            <button id="programmerDbDeleteBtn" type="button" class="programmer-page-btn danger">
              <span class="material-icons">delete</span>
              Eliminar
            </button>
          </div>
        </div>
        <div class="programmer-db-subcollections">
          ${(state.dbSubcollections || []).length ? state.dbSubcollections.map(item => `
            <button type="button" class="programmer-db-chip" data-db-subcollection="${escapeHtml(item.path)}">${escapeHtml(item.id)}</button>
          `).join('') : '<span class="programmer-db-chip muted">Sin subcolecciones detectadas</span>'}
        </div>
        <textarea id="programmerDbEditor" class="programmer-json-editor">${escapeHtml(documentText)}</textarea>
      </div>
    </section>
  `;

  document.getElementById('programmerDbParentPath')?.addEventListener('input', event => {
    state.dbParentPath = event.target.value;
  });
  document.getElementById('programmerDbLimit')?.addEventListener('input', event => {
    state.dbLimit = Math.min(300, Math.max(20, Number(event.target.value) || 80));
  });
  document.getElementById('programmerDbRootBtn')?.addEventListener('click', async () => {
    state.dbParentPath = '';
    state.dbCollectionPath = '';
    state.dbDocPath = '';
    state.dbDocument = null;
    state.dbSubcollections = [];
    await loadDbCollections('');
  });
  document.getElementById('programmerDbBrowseBtn')?.addEventListener('click', () => {
    state.dbLimit = Math.min(300, Math.max(20, Number(document.getElementById('programmerDbLimit')?.value) || state.dbLimit || 80));
    loadDbCollections(document.getElementById('programmerDbParentPath')?.value || state.dbParentPath);
  });
  document.getElementById('programmerDbCollectionSearch')?.addEventListener('input', event => {
    state.dbCollectionSearch = event.target.value;
    const list = document.getElementById('programmerDbCollectionsList');
    if (list) list.innerHTML = renderDbCollectionsHtml();
    document.getElementById('programmerDbCollectionsList')?.querySelectorAll('[data-db-collection]').forEach(button => {
      button.addEventListener('click', () => openDbCollection(button.dataset.dbCollection));
    });
  });
  document.getElementById('programmerDbDocSearch')?.addEventListener('input', event => {
    state.dbDocSearch = event.target.value;
    const list = document.getElementById('programmerDbDocsList');
    if (list) list.innerHTML = renderDbDocsHtml();
    document.getElementById('programmerDbDocsList')?.querySelectorAll('[data-db-doc]').forEach(button => {
      button.addEventListener('click', () => openDbDocument(button.dataset.dbDoc));
    });
  });
  document.getElementById('programmerDbOpenCollectionBtn')?.addEventListener('click', () => {
    state.dbLimit = Math.min(300, Math.max(20, Number(document.getElementById('programmerDbLimit')?.value) || state.dbLimit || 80));
    openDbCollection(document.getElementById('programmerDbCollectionPathInput')?.value || state.dbCollectionPath);
  });
  document.getElementById('programmerDbReloadDocBtn')?.addEventListener('click', () => {
    loadDbDocument(document.getElementById('programmerDbDocPathInput')?.value || state.dbDocPath);
  });
  document.getElementById('programmerDbSaveMergeBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('programmerDbSaveMergeBtn');
    showLoadingBtn(btn, 'Guardando...');
    await saveDbDocument(true);
    showSaveFeedback(btn, 'Guardado');
  });
  document.getElementById('programmerDbReplaceBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('programmerDbReplaceBtn');
    showLoadingBtn(btn, 'Reemplazando...');
    await saveDbDocument(false);
    showSaveFeedback(btn, 'Reemplazado');
  });
  document.getElementById('programmerDbDeleteBtn')?.addEventListener('click', () => deleteDbDocument());

  container.querySelectorAll('[data-db-collection]').forEach(button => {
    button.addEventListener('click', () => openDbCollection(button.dataset.dbCollection));
  });
  container.querySelectorAll('[data-db-doc]').forEach(button => {
    button.addEventListener('click', () => openDbDocument(button.dataset.dbDoc));
  });
  container.querySelectorAll('[data-db-subcollection]').forEach(button => {
    button.addEventListener('click', () => openDbCollection(button.dataset.dbSubcollection));
  });
}

async function ensureDatabaseTabReady() {
  if (!state.dbLoaded) {
    await loadDbCollections(state.dbParentPath || '');
  }
  if (state.dbCollectionPath && state.dbDocs.length === 0) {
    await loadDbDocs(state.dbCollectionPath);
  }
  if (state.dbDocPath && !state.dbDocument) {
    await loadDbDocument(state.dbDocPath);
  }
}

async function refreshCurrentTabData() {
  if (state.tab === 'database') {
    state.dbLimit = Math.min(300, Math.max(20, Number(document.getElementById('programmerDbLimit')?.value) || state.dbLimit || 80));
    const parentPath = document.getElementById('programmerDbParentPath')?.value || state.dbParentPath || '';
    const collectionPath = document.getElementById('programmerDbCollectionPathInput')?.value || state.dbCollectionPath || '';
    const docPath = document.getElementById('programmerDbDocPathInput')?.value || state.dbDocPath || '';
    state.dbLoaded = false;
    await loadDbCollections(parentPath);
    if (collectionPath) await loadDbDocs(collectionPath);
    if (docPath) await loadDbDocument(docPath);
    return;
  }

  if (state.tab === 'consultas') {
    await runQuery(state.queryName || 'ops_events');
    return;
  }

  if (state.tab === 'config') {
    await loadSettingsPreview();
    renderCurrentTab();
    return;
  }

  await refreshAll();
}

async function runQuery(queryName) {
  try {
    const res = await callConsoleQuery(queryName, { limit: state.queryLimit });
    state.queryRows = Array.isArray(res.data?.rows) ? res.data.rows : [];
    state.queryName = queryName;
    renderCurrentTab();
  } catch (error) {
    console.error('queryProgrammerConsole', error);
    showToast(`No se pudo ejecutar la consulta: ${describeError(error)}`, 'error');
    reportProgrammerError({ kind: 'programmer.query', scope: 'programador', message: describeError(error), stack: error.stack });
  }
}

async function runJob(job, extra = {}) {
  try {
    const call = callable('runProgrammerJob');
    if (!call) throw new Error('Functions no disponibles');
    const res = await call({
      job,
      plaza: state.plaza,
      ...extra
    });
    state.jobResult = res.data?.result || null;
    showToast(`Job ${job} ejecutado correctamente.`, 'success');
    renderCurrentTab();
    return { ok: true, result: state.jobResult };
  } catch (error) {
    console.error('runProgrammerJob', error);
    showToast(describeError(error) || `No se pudo ejecutar ${job}.`, 'error');
    reportProgrammerError({ kind: 'programmer.job', scope: 'programador', message: describeError(error), stack: error.stack });
    return { ok: false, error };
  }
}

async function loadSettingsPreview() {
  try {
    const [globalSnap, plazaSnap] = await Promise.all([
      db.collection('settings').doc('GLOBAL').get(),
      state.plaza ? db.collection('settings').doc(state.plaza).get() : Promise.resolve(null)
    ]);
    state.settingsGlobal = globalSnap.exists ? (globalSnap.data() || {}) : {};
    state.settingsPlaza = plazaSnap?.exists ? (plazaSnap.data() || {}) : {};
    if (state.tab === 'config') renderCurrentTab();
  } catch (error) {
    console.error('loadSettingsPreview', error);
    reportProgrammerError({ kind: 'programmer.config', scope: 'programador', message: error.message, stack: error.stack });
  }
}

async function saveSettingsEditor() {
  const saveBtn = document.getElementById('programmerSaveConfigBtn');
  try {
    const editor = document.getElementById('programmerConfigEditor');
    if (!editor) return;
    if (saveBtn) showLoadingBtn(saveBtn, 'Guardando...');
    const payload = JSON.parse(editor.value);
    const target = state.configMode === 'global' ? 'GLOBAL' : (state.plaza || 'GLOBAL');
    await db.collection('settings').doc(target).set(payload, { merge: true });
    showToast(`settings/${target} actualizado.`, 'success');
    if (saveBtn) showSaveFeedback(saveBtn, 'Guardado');
    await loadSettingsPreview();
  } catch (error) {
    console.error('saveSettingsEditor', error);
    showToast(`JSON inválido: ${error.message}`, 'error');
    if (saveBtn) restoreBtn(saveBtn);
  }
}

async function refreshAll() {
  try {
    const queries = [
      ['overview', {}],
      ['notifications', { limit: 30 }],
      ['devices', { limit: 30 }],
      ['errors', { limit: 30 }],
      ['jobs', { limit: 30 }],
      ['ops_events', { limit: 30 }],
      ['audit', { limit: 30 }]
    ];
    const settled = await Promise.allSettled(
      queries.map(([name, extra]) => callConsoleQuery(name, extra))
    );
    const failures = [];
    const rowsFor = name => {
      const index = queries.findIndex(([queryName]) => queryName === name);
      const result = settled[index];
      if (result?.status === 'fulfilled') return Array.isArray(result.value?.data?.rows) ? result.value.data.rows : [];
      failures.push(name);
      console.error(`refreshAll:${name}`, result?.reason);
      return [];
    };

    state.overview = rowsFor('overview')[0] || null;
    state.notificationsRows = rowsFor('notifications');
    state.devicesRows = rowsFor('devices');
    state.errorsRows = rowsFor('errors');
    state.jobsRows = rowsFor('jobs');
    state.opsRows = rowsFor('ops_events');
    state.auditRows = rowsFor('audit');
    await loadSettingsPreview();
    if (state.tab === 'consultas' && state.queryRows.length === 0) {
      state.queryRows = state.opsRows;
      state.queryName = 'ops_events';
    }
    if (failures.length) {
      showToast(`La consola cargó con pendientes en: ${failures.join(', ')}`, 'warning');
    }
    renderShell();
  } catch (error) {
    console.error('refreshAll', error);
    setLoading('No se pudo cargar la consola.');
    reportProgrammerError({ kind: 'programmer.refresh', scope: 'programador', message: describeError(error), stack: error.stack });
  }
}

installProgrammerErrorReporter({
  screen: 'programador',
  getProfile: () => state.profile,
  getBuild: () => BUILD_TAG,
  enabled: () => Boolean(auth.currentUser)
});

auth.onAuthStateChanged(async user => {
  enableProgrammerPageScroll();
  if (!user) {
    window.location.replace('/login');
    return;
  }
  setLoading('Validando permisos...', 'Verificando rol y accesos');
  try {
    await user.getIdToken(true);
    state.profile = await resolveProfile(user);
    await loadProgrammerConfig();
    if (!state.profile || !isAllowed()) {
      window.location.replace('/mapa');
      return;
    }
    if (typeof window.__mexRequireLocationAccess === 'function') {
      await window.__mexRequireLocationAccess({
        title: 'Ubicacion obligatoria para la consola',
        copy: 'La consola avanzada solo se abre con ubicación exacta activa para reforzar auditoría, seguridad y rastreo operativo.',
        allowLogout: true,
        force: false
      });
    }
    state.plaza = state.profile.plazaAsignada || '';
    configureNotifications({
      profileGetter: () => state.profile,
      getCurrentUserName: () => state.profile?.nombre || '',
      getCurrentUserDocId: () => state.profile?.id || state.profile?.email || '',
      getCurrentPlaza: () => state.profile?.plazaAsignada || '',
      toast: showToast,
      routeHandlers: {}
    });
    window.openNotificationCenter = () => import('/js/core/notifications.js').then(mod => mod.openNotificationCenter());
    await initNotificationCenter();
    await refreshAll();
  } catch (error) {
    console.error('programador:init', error);
    reportProgrammerError({ kind: 'programmer.init', scope: 'programador', message: describeError(error), stack: error.stack });
    setLoading('No se pudo abrir el Centro de Control.', 'Verifica tu conexión o consulta con el administrador.');
  }
});
