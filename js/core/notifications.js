import { db, auth, functions } from '/js/core/database.js';

const APP_BUILD = 'mapa-v86';
const DEVICE_STORAGE_KEY = 'mex_device_id_v1';
const MESSAGING_SW_URL = '/firebase-messaging-sw.js';
const MESSAGING_SW_SCOPE = '/firebase-cloud-messaging-push-scope';

const _state = {
  profileGetter: () => null,
  getCurrentUserName: () => '',
  getCurrentUserDocId: () => '',
  getCurrentPlaza: () => '',
  toast: (msg) => console.log(msg),
  routeHandlers: {},
  inbox: [],
  unread: 0,
  opened: false,
  lastSnapshotIds: new Set(),
  unsubInbox: null,
  unsubDevice: null,
  deviceId: '',
  callableCache: new Map(),
  permissionPromptShown: false,
  currentDevice: null,
  lastDeviceSyncAt: 0,
  lastDeviceSyncSignature: '',
  foregroundListenerBound: false,
  foregroundListenerPending: false
};

function _safeText(value) {
  return String(value || '').trim();
}

function _normalizeUpper(value) {
  return _safeText(value).toUpperCase();
}

function _deviceId() {
  if (_state.deviceId) return _state.deviceId;
  const existing = localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing) {
    _state.deviceId = existing;
    return existing;
  }
  const fresh = `dev_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  localStorage.setItem(DEVICE_STORAGE_KEY, fresh);
  _state.deviceId = fresh;
  return fresh;
}

function _fxCallable(name) {
  if (!functions) return null;
  if (!_state.callableCache.has(name)) {
    _state.callableCache.set(name, functions.httpsCallable(name));
  }
  return _state.callableCache.get(name);
}

function _notificationIcon() {
  return '/img/logo.png';
}

function _appDisplayName() {
  return _safeText(window.MEX_CONFIG?.empresa?.nombre) || 'Nueva notificacion';
}

function _supportsPush() {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && typeof firebase !== 'undefined'
    && typeof firebase.messaging === 'function';
}

function _registerMainServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (window.__mexSwRegistration) return Promise.resolve(window.__mexSwRegistration);
  if (window.__mexSwRegistrationPromise) return window.__mexSwRegistrationPromise;
  window.__mexSwRegistrationPromise = navigator.serviceWorker.register('/sw.js', {
    updateViaCache: 'none'
  })
    .then(reg => {
      window.__mexSwRegistration = reg;
      return reg;
    })
    .catch(error => {
      console.warn('No se pudo registrar /sw.js:', error);
      return null;
    });
  return window.__mexSwRegistrationPromise;
}

function _registerMessagingServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (window.__mexMessagingSwRegistration) return Promise.resolve(window.__mexMessagingSwRegistration);
  if (window.__mexMessagingSwRegistrationPromise) return window.__mexMessagingSwRegistrationPromise;
  window.__mexMessagingSwRegistrationPromise = navigator.serviceWorker.register(MESSAGING_SW_URL, {
    scope: MESSAGING_SW_SCOPE,
    updateViaCache: 'none'
  }).then(reg => {
    window.__mexMessagingSwRegistration = reg;
    return reg;
  }).catch(error => {
    console.warn('No se pudo registrar firebase-messaging-sw.js:', error);
    return null;
  });
  return window.__mexMessagingSwRegistrationPromise;
}

function _getServiceWorkerRegistration() {
  if (window.__mexSwRegistration) return Promise.resolve(window.__mexSwRegistration);
  if (window.__mexSwRegistrationPromise) {
    return window.__mexSwRegistrationPromise.then(reg => reg || navigator.serviceWorker.ready.catch(() => null));
  }
  return navigator.serviceWorker.getRegistration()
    .then(reg => reg || navigator.serviceWorker.ready.catch(() => null))
    .then(reg => reg || _registerMainServiceWorker())
    .catch(() => _registerMainServiceWorker());
}

function _getMessagingServiceWorkerRegistration() {
  if (window.__mexMessagingSwRegistration) return Promise.resolve(window.__mexMessagingSwRegistration);
  if (window.__mexMessagingSwRegistrationPromise) return window.__mexMessagingSwRegistrationPromise;
  return navigator.serviceWorker.getRegistration(MESSAGING_SW_SCOPE)
    .then(reg => {
      if (reg) {
        window.__mexMessagingSwRegistration = reg;
        return reg;
      }
      return _registerMessagingServiceWorker();
    })
    .catch(() => _registerMessagingServiceWorker())
    .then(reg => reg || _getServiceWorkerRegistration());
}

async function _resetMessagingServiceWorkerRegistration() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations
      .filter(reg => String(reg?.scope || '').includes(MESSAGING_SW_SCOPE))
      .map(reg => reg.unregister().catch(() => false)));
  } catch (_) {}
  window.__mexMessagingSwRegistration = null;
  window.__mexMessagingSwRegistrationPromise = null;
}

function _platformMeta() {
  const ua = navigator.userAgent || '';
  let platform = 'web';
  if (/android/i.test(ua)) platform = 'android';
  else if (/iphone|ipad|ipod/i.test(ua)) platform = 'ios';
  else if (/mac/i.test(ua)) platform = 'mac';
  else if (/win/i.test(ua)) platform = 'windows';

  let browser = 'browser';
  if (/edg\//i.test(ua)) browser = 'edge';
  else if (/chrome\//i.test(ua)) browser = 'chrome';
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = 'safari';
  else if (/firefox\//i.test(ua)) browser = 'firefox';

  return { platform, browser };
}

function _friendlyPlatformLabel(value = '') {
  const platform = _safeText(value).toLowerCase();
  if (platform === 'ios') return 'iPhone';
  if (platform === 'android') return 'Celular';
  if (platform === 'mac' || platform === 'windows') return 'Computadora';
  return 'Navegador';
}

function _friendlyBrowserLabel(value = '') {
  const browser = _safeText(value).toLowerCase();
  if (browser === 'safari') return 'Safari';
  if (browser === 'chrome') return 'Chrome';
  if (browser === 'firefox') return 'Firefox';
  if (browser === 'edge') return 'Edge';
  return 'Navegador';
}

function _friendlyDeviceLabel(device = {}) {
  const platform = _friendlyPlatformLabel(device?.platform || _platformMeta().platform);
  const browser = _friendlyBrowserLabel(device?.browser || _platformMeta().browser);
  if (platform === 'Navegador') return browser;
  if (platform === 'Computadora') return `${platform} · ${browser}`;
  return platform;
}

function _friendlyNotificationKind(item = {}) {
  const type = _safeText(item?.kindLabel || item?.type).toLowerCase();
  if (type.includes('message') || type.includes('mensaje')) return 'Mensaje directo';
  if (type.includes('cuadre.assigned')) return 'Mision de cuadre';
  if (type.includes('cuadre.updated')) return 'Actualizacion de cuadre';
  if (type.includes('cuadre.review_ready')) return 'Revision de cuadre';
  if (type.includes('alert')) return 'Alerta critica';
  if (type.includes('test')) return 'Prueba de notificacion';
  return _safeText(item?.kindLabel) || 'Notificacion';
}

function _notificationSender(item = {}) {
  return _safeText(
    item?.senderLabel
    || item?.actorName
    || item?.payload?.remitente
    || item?.payload?.actorName
    || ''
  );
}

function _notificationContextCopy(item = {}) {
  const parts = [];
  const kind = _friendlyNotificationKind(item);
  if (kind) parts.push(kind);
  const sender = _notificationSender(item);
  if (sender) parts.push(`De ${sender}`);
  if (_safeText(item?.plaza) && !_safeText(item?.type).toLowerCase().includes('test')) {
    parts.push(_safeText(item.plaza));
  }
  return parts.join(' · ');
}

function _currentRoute() {
  return `${window.location.pathname}${window.location.search || ''}`;
}

function _deviceSyncPayload() {
  const meta = _platformMeta();
  return {
    lastSeenAt: Date.now(),
    activeRoute: _currentRoute(),
    isFocused: document.visibilityState === 'visible' && document.hasFocus(),
    permission: _supportsPush() ? Notification.permission : 'unsupported',
    browser: meta.browser,
    platform: meta.platform,
    swVersion: APP_BUILD,
    appVersion: APP_BUILD,
    suppressWhileFocused: false
  };
}

function _deviceSyncSignature(payload = {}) {
  return JSON.stringify({
    activeRoute: payload.activeRoute || '',
    isFocused: payload.isFocused === true,
    permission: payload.permission || 'default',
    browser: payload.browser || '',
    platform: payload.platform || '',
    swVersion: payload.swVersion || '',
    suppressWhileFocused: payload.suppressWhileFocused === true
  });
}

async function _showSystemNotification({ title, body, data = {}, tag = 'mex-notif', renotify = false } = {}) {
  if (!_supportsPush() || Notification.permission !== 'granted') return;
  const options = {
    body: _safeText(body),
    icon: _notificationIcon(),
    badge: _notificationIcon(),
    tag,
    renotify,
    data,
    vibrate: [180, 80, 180]
  };
  try {
    const registration = await _getServiceWorkerRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(_safeText(title) || _appDisplayName(), options);
      return;
    }
  } catch (_) {}
  try {
    new Notification(_safeText(title) || _appDisplayName(), options);
  } catch (_) {}
}

function _bindForegroundMessaging() {
  if (_state.foregroundListenerBound || _state.foregroundListenerPending || !_supportsPush() || Notification.permission !== 'granted') return;
  _state.foregroundListenerPending = true;
  _getMessagingServiceWorkerRegistration()
    .then(registration => {
      if (!registration) return;
      const messaging = firebase.messaging();
      messaging.onMessage(payload => {
        const notificationId = _safeText(payload?.data?.notificationId || payload?.messageId || `${Date.now()}`);
        _showSystemNotification({
          title: payload?.notification?.title || payload?.data?.title || _appDisplayName(),
          body: payload?.notification?.body || payload?.data?.body || '',
          tag: `foreground:${notificationId}`,
          renotify: true,
          data: {
            url: payload?.data?.url || '/mapa?notif=inbox',
            notificationId,
            type: payload?.data?.type || 'system'
          }
        }).catch(() => {});
      });
      _state.foregroundListenerBound = true;
    })
    .catch(error => {
      console.warn('No se pudo enlazar firebase.messaging.onMessage:', error);
    })
    .finally(() => {
      _state.foregroundListenerPending = false;
    });
}

function _ensureNotificationCenterDom() {
  if (document.getElementById('notifications-center-modal')) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div id="notifications-center-modal" class="notif-center-modal">
      <div class="notif-center-shell">

        <!-- Header -->
        <div class="notif-center-header">
          <h2 class="notif-center-title">Notificaciones</h2>
          <button id="notif-center-close" class="notif-center-close" type="button" aria-label="Cerrar">
            <span class="material-icons" style="font-size:18px;">close</span>
          </button>
        </div>

        <!-- Chips de filtro -->
        <div class="notif-filter-bar">
          <button class="notif-filter-chip active" data-filter="all">Todos</button>
          <button class="notif-filter-chip" data-filter="message">💬 Mensajes</button>
          <button class="notif-filter-chip" data-filter="cuadre">📋 Inventario</button>
          <button class="notif-filter-chip" data-filter="alert">🚨 Alertas</button>
          <button class="notif-filter-chip" data-filter="solicitud">📝 Solicitudes</button>
        </div>

        <div class="notif-center-divider"></div>

        <!-- Toolbar: estado dispositivo + acciones -->
        <div class="notif-center-toolbar">
          <span id="notif-center-device-status" class="notif-center-device-pill">
            <span class="material-icons" style="font-size:14px;">devices</span>
            Dispositivo pendiente
          </span>
          <button id="notif-center-permission-btn" type="button" class="notif-center-btn primary">
            <span class="material-icons" style="font-size:14px;">notifications_active</span>
            Activar
          </button>
          <button id="notif-center-refresh-btn" type="button" class="notif-center-btn">
            <span class="material-icons" style="font-size:14px;">refresh</span>
          </button>
        </div>

        <!-- Lista de notificaciones -->
        <div id="notif-center-list" class="notif-center-list"></div>

        <!-- Configuración colapsable -->
        <div class="notif-settings-section">
          <button class="notif-settings-toggle" id="notif-settings-toggle" type="button">
            <span style="display:flex;align-items:center;gap:8px;">
              <span class="material-icons" style="font-size:16px;">tune</span>
              Configuración de notificaciones
            </span>
            <span class="material-icons">expand_more</span>
          </button>
          <div class="notif-settings-body" id="notif-settings-body">
            <div class="notif-pref-list">
              <label class="notif-pref-row">
                <div>
                  <strong>Mensajes directos</strong>
                  <small>Avisa cuando alguien te escribe.</small>
                </div>
                <input id="notif-pref-messages" type="checkbox">
              </label>
              <label class="notif-pref-row">
                <div>
                  <strong>Misiones de inventario</strong>
                  <small>Notifica asignaciones y actualizaciones de cuadre.</small>
                </div>
                <input id="notif-pref-cuadre" type="checkbox">
              </label>
              <label class="notif-pref-row">
                <div>
                  <strong>Alertas críticas</strong>
                  <small>Solo avisos operativos de alta prioridad.</small>
                </div>
                <input id="notif-pref-critical" type="checkbox">
              </label>
              <label class="notif-pref-row">
                <div>
                  <strong>Silenciar este dispositivo</strong>
                  <small>Pausa el sonido pero el inbox sigue activo.</small>
                </div>
                <input id="notif-pref-mute" type="checkbox">
              </label>
            </div>
            <div id="notif-center-meta" class="notif-center-meta"></div>
          </div>
        </div>

      </div>
    </div>
  `;
  document.body.appendChild(wrapper.firstElementChild);

  document.getElementById('notif-center-close')?.addEventListener('click', closeNotificationCenter);
  document.getElementById('notifications-center-modal')?.addEventListener('click', event => {
    if (event.target.id === 'notifications-center-modal') closeNotificationCenter();
  });
  document.getElementById('notif-center-permission-btn')?.addEventListener('click', () => {
    requestDeviceNotifications(true);
  });
  document.getElementById('notif-center-refresh-btn')?.addEventListener('click', () => {
    resubscribeInbox();
  });

  // Accordion de configuración
  document.getElementById('notif-settings-toggle')?.addEventListener('click', () => {
    const toggle = document.getElementById('notif-settings-toggle');
    const body   = document.getElementById('notif-settings-body');
    toggle?.classList.toggle('open');
    body?.classList.toggle('open');
  });

  // Chips de filtro
  document.querySelectorAll('#notifications-center-modal .notif-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#notifications-center-modal .notif-filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      _renderNotifList();
    });
  });

  [
    ['notif-pref-messages', 'directMessages'],
    ['notif-pref-cuadre', 'cuadreMissions'],
    ['notif-pref-critical', 'criticalAlerts'],
    ['notif-pref-mute', 'muteAll']
  ].forEach(([id, field]) => {
    document.getElementById(id)?.addEventListener('change', event => {
      persistCurrentDevicePrefs({ [field]: event.target.checked });
    });
  });
}

function _ensureSidebarButton() {
  if (document.getElementById('btnNotificationCenter')) return;
  const anchor = document.getElementById('btnBuzon') || document.getElementById('btnAlerts');
  if (!anchor || !anchor.parentElement) return;

  const btn = document.createElement('button');
  btn.id = 'btnNotificationCenter';
  btn.className = 'sb-btn sb-btn-dark';
  btn.type = 'button';
  btn.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <span class="material-icons" style="font-size:20px;">notifications_active</span>
      <p style="margin:0;">NOTIFICACIONES</p>
    </div>
    <span id="badgeNotificationCenter" class="badge-pulse" style="display:none; position:relative; top:0; right:0; background:#9333ea; box-shadow:0 0 0 0 rgba(147,51,234,0.7); animation:pulseBlue 2s infinite;">0</span>
  `;
  btn.addEventListener('click', openNotificationCenter);
  anchor.parentElement.insertBefore(btn, anchor);
}

function _currentUserDocRef() {
  const docId = _safeText(_state.getCurrentUserDocId?.());
  if (!docId) return null;
  return db.collection('usuarios').doc(docId);
}

function _currentDevicePrefs() {
  const prefs = {
    directMessages: true,
    cuadreMissions: true,
    criticalAlerts: true,
    muteAll: false,
    ...(_state.currentDevice?.notificationPrefs || {})
  };
  return prefs;
}

// Obtiene el color del avatar según tipo de notificación
function _notifAvatarColor(type = '') {
  const t = type.toLowerCase();
  if (t.includes('message')) return { bg: '#3b82f6', icon: 'forum' };
  if (t.includes('cuadre.assigned')) return { bg: '#f59e0b', icon: 'assignment' };
  if (t.includes('cuadre.review_ready')) return { bg: '#10b981', icon: 'fact_check' };
  if (t.includes('cuadre')) return { bg: '#f97316', icon: 'inventory_2' };
  if (t.includes('alert')) return { bg: '#ef4444', icon: 'warning' };
  if (t.includes('solicitud') || t.includes('request')) return { bg: '#8b5cf6', icon: 'how_to_reg' };
  if (t.includes('test')) return { bg: '#64748b', icon: 'notifications' };
  return { bg: '#94a3b8', icon: 'notifications' };
}

// Texto amigable para el usuario según tipo de notificación
function _notifFriendlyText(item = {}) {
  const type  = _safeText(item?.type || item?.kindLabel).toLowerCase();
  const sender = _notificationSender(item);
  const body   = _safeText(item?.body || item?.payload?.mensaje || '');

  if (type.includes('message')) {
    const who = sender || 'Alguien';
    const preview = body ? `: "${body.slice(0, 60)}${body.length > 60 ? '…' : ''}"` : ' te envió un mensaje.';
    return `<strong>${who}</strong>${preview}`;
  }
  if (type.includes('cuadre.assigned')) {
    return `Tienes una nueva misión de inventario asignada.`;
  }
  if (type.includes('cuadre.review_ready')) {
    return `El inventario ya está listo — revísalo y finaliza el cuadre.`;
  }
  if (type.includes('cuadre.updated')) {
    return `Se actualizó el inventario${sender ? ` por <strong>${sender}</strong>` : ''}.`;
  }
  if (type.includes('cuadre')) {
    return `Actividad de inventario${sender ? ` de <strong>${sender}</strong>` : ''}.`;
  }
  if (type.includes('alert.critical')) {
    const titulo = _safeText(item?.title || '');
    return `🚨 Alerta operativa${titulo ? `: <strong>${titulo}</strong>` : ' crítica recibida.'}`;
  }
  if (type.includes('alert')) {
    return _safeText(item?.title || 'Nueva alerta del sistema.');
  }
  if (type.includes('solicitud') || type.includes('request.user')) {
    return `Nueva solicitud de registro${sender ? ` de <strong>${sender}</strong>` : ''}.`;
  }
  if (type.includes('test')) {
    return '🔔 Prueba de notificaciones enviada correctamente.';
  }
  // Fallback legible
  const titulo = _safeText(item?.title || '');
  if (titulo) return titulo;
  if (body) return body;
  return 'Nueva notificación del sistema.';
}

// Tiempo relativo legible
function _notifRelativeTime(ts = 0) {
  if (!ts) return 'Reciente';
  const now  = Date.now();
  const diff = Math.floor((now - ts) / 1000); // segundos
  if (diff < 60)   return 'Ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400)return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'Ayer';
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)} días`;
  return new Date(ts).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

// Método para obtener el label de fecha del grupo
function _notifGroupLabel(ts = 0) {
  if (!ts) return 'Antes';
  const now = Date.now();
  const diff = now - ts;
  if (diff < 86400000)  return 'Hoy';
  if (diff < 172800000) return 'Ayer';
  if (diff < 604800000) return 'Esta semana';
  return 'Antes';
}

// Filtro activo
function _notifActiveFilter() {
  const chip = document.querySelector('#notifications-center-modal .notif-filter-chip.active');
  return chip ? (chip.dataset.filter || 'all') : 'all';
}

// Filtra los items según el chip activo
function _notifFilteredInbox() {
  const filter = _notifActiveFilter();
  if (filter === 'all') return _state.inbox;
  return _state.inbox.filter(item => {
    const t = _safeText(item?.type).toLowerCase();
    if (filter === 'message')  return t.includes('message');
    if (filter === 'cuadre')   return t.includes('cuadre');
    if (filter === 'alert')    return t.includes('alert');
    if (filter === 'solicitud')return t.includes('solicitud') || t.includes('request');
    return true;
  });
}

// Renderiza solo la lista (llamada desde los chips y desde _renderNotificationCenter)
function _renderNotifList() {
  const listEl = document.getElementById('notif-center-list');
  if (!listEl) return;

  const items = _notifFilteredInbox();

  if (!items.length) {
    const filter = _notifActiveFilter();
    const msg = filter === 'all' ? 'aún no tienes notificaciones.' : 'no hay notificaciones de este tipo.';
    listEl.innerHTML = `<div class="notif-center-empty">
      <span class="material-icons">notifications_none</span>
      <strong>Todo tranquilo</strong>
      <p>Por ahora ${msg}</p>
    </div>`;
    return;
  }

  // Agrupar por fecha
  const groups = {};
  const ORDER  = ['Hoy', 'Ayer', 'Esta semana', 'Antes'];
  items.forEach(item => {
    const ts    = Number(item.timestamp || item.createdAt || 0);
    const label = _notifGroupLabel(ts);
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  });

  let html = '';
  ORDER.forEach(label => {
    if (!groups[label]?.length) return;
    html += `<div class="notif-date-group"><span class="notif-date-label">${label}</span></div>`;
    groups[label].forEach(item => {
      const id       = item.notificationId || item.id;
      const ts       = Number(item.timestamp || item.createdAt || 0);
      const timeStr  = _notifRelativeTime(ts);
      const isUnread = !item.read && item.status !== 'READ';
      const type     = _safeText(item?.type);
      const meta     = _notifAvatarColor(type);
      const sender   = _notificationSender(item);
      const initials = sender ? sender.slice(0, 2).toUpperCase() : meta.icon.slice(0, 2).toUpperCase();
      const text     = _notifFriendlyText(item);

      html += `
        <button class="notif-item${isUnread ? ' unread' : ''}" type="button" data-id="${id}">
          <div class="notif-item-avatar" style="background:${meta.bg}">
            ${initials}
            <div class="notif-avatar-badge" style="background:${meta.bg}">
              <span class="material-icons" style="color:white;font-size:13px;">${meta.icon}</span>
            </div>
          </div>
          <div class="notif-item-copy">
            <p class="notif-item-text">${text}</p>
            <span class="notif-item-time">${timeStr}</span>
          </div>
          ${isUnread ? '<div class="notif-unread-dot"></div>' : ''}
        </button>
      `;
    });
  });

  listEl.innerHTML = html;

  listEl.querySelectorAll('.notif-item').forEach(button => {
    button.addEventListener('click', () => {
      const id   = button.dataset.id;
      const item = _state.inbox.find(entry => (entry.notificationId || entry.id) === id);
      if (item) handleInboxItemAction(item);
    });
  });
}

function _renderNotificationCenter() {
  _ensureNotificationCenterDom();

  const metaEl      = document.getElementById('notif-center-meta');
  const deviceEl    = document.getElementById('notif-center-device-status');
  const permissionBtn = document.getElementById('notif-center-permission-btn');
  const badge       = document.getElementById('badgeNotificationCenter');

  if (badge) {
    badge.textContent = String(_state.unread);
    badge.style.display = _state.unread > 0 ? 'flex' : 'none';
  }

  const permission = _supportsPush() ? Notification.permission : 'unsupported';
  if (deviceEl) {
    const label = permission === 'granted'
      ? 'Push activo en este dispositivo'
      : (permission === 'denied' ? 'Notificaciones bloqueadas' : (permission === 'unsupported' ? 'Push no disponible' : 'Activa las notificaciones'));
    deviceEl.textContent = label;
    deviceEl.className = 'notif-center-device-pill' + (permission === 'granted' ? ' active' : (permission === 'denied' ? ' blocked' : ''));
  }
  if (permissionBtn) {
    permissionBtn.disabled = permission === 'granted' || permission === 'denied' || !_supportsPush();
    permissionBtn.style.display = (permission === 'granted' || !_supportsPush()) ? 'none' : 'flex';
  }

  const prefs = _currentDevicePrefs();
  const fieldMap = {
    'notif-pref-messages': prefs.directMessages,
    'notif-pref-cuadre':   prefs.cuadreMissions,
    'notif-pref-critical': prefs.criticalAlerts,
    'notif-pref-mute':     prefs.muteAll
  };
  Object.entries(fieldMap).forEach(([id, checked]) => {
    const input = document.getElementById(id);
    if (input) input.checked = checked;
  });

  if (metaEl) {
    const device    = _state.currentDevice || _platformMeta();
    const lastSeen  = _state.currentDevice?.lastSeenAt
      ? new Date(Number(_state.currentDevice.lastSeenAt)).toLocaleString('es-MX')
      : 'Pendiente';
    metaEl.innerHTML = `
      <div>${_friendlyDeviceLabel(device)} · ${lastSeen}</div>
    `;
  }

  _renderNotifList();
}

async function _upsertDeviceDirect(payload = {}) {
  const ref = _currentUserDocRef();
  if (!ref) return;
  _state.currentDevice = {
    ...(_state.currentDevice || {}),
    ...payload
  };
  await ref.collection('devices').doc(_deviceId()).set({
    updatedAt: Date.now(),
    ...payload
  }, { merge: true });
}

async function _registerCurrentDevice(token = '') {
  const profile = _state.profileGetter?.() || {};
  const callable = _fxCallable('registerDevice');
  const focusPayload = _deviceSyncPayload();
  const payload = {
    deviceId: _deviceId(),
    token,
    permission: _supportsPush() ? Notification.permission : 'unsupported',
    pushEnabled: Boolean(token) && Notification.permission === 'granted',
    platform: _platformMeta().platform,
    browser: _platformMeta().browser,
    userAgent: navigator.userAgent || '',
    plaza: _state.getCurrentPlaza?.() || profile?.plazaAsignada || '',
    activeRoute: focusPayload.activeRoute,
    isFocused: focusPayload.isFocused,
    swVersion: APP_BUILD,
    appVersion: APP_BUILD,
    suppressWhileFocused: false,
    notificationPrefs: _currentDevicePrefs()
  };
  _state.currentDevice = {
    ...(_state.currentDevice || {}),
    ...payload
  };

  if (callable) {
    await callable(payload);
  } else {
    await _upsertDeviceDirect(payload);
  }
}

/**
 * Fuerza la regeneración del token FCM eliminando el token en caché primero.
 * Necesario cuando el backend marca invalidToken: true (el cliente tiene token viejo).
 */
async function _forceTokenRefresh() {
  if (!_supportsPush() || Notification.permission !== 'granted') return;
  try {
    const messaging = firebase.messaging();
    await messaging.deleteToken().catch(() => {});
  } catch (_) {}
  try {
    const token = await _obtainMessagingToken(false);
    if (token) {
      await _registerCurrentDevice(token);
      console.log('[push] Token FCM regenerado correctamente.');
    }
  } catch (e) {
    console.warn('[push] No se pudo regenerar el token FCM:', e);
  }
}

async function _obtainMessagingToken(forcePrompt = false) {
  if (!_supportsPush()) return '';
  if (forcePrompt && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission !== 'granted') return '';

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      let registration = await _getMessagingServiceWorkerRegistration();
      if (!registration) registration = await _getServiceWorkerRegistration();
      if (!registration) return '';

      const messaging = firebase.messaging();
      const options = { serviceWorkerRegistration: registration };
      const vapidKey = _state.profileGetter?.()?.notifications?.vapidKey
        || window.MEX_CONFIG?.empresa?.notifications?.vapidKey
        || window.FIREBASE_CONFIG?.vapidKey
        || '';
      if (vapidKey) options.vapidKey = vapidKey;

      return await messaging.getToken(options);
    } catch (error) {
      lastError = error;
      const code = _safeText(error?.code).toLowerCase();
      const msg = _safeText(error?.message).toLowerCase();
      const swEvalFailed = code.includes('failed-service-worker-registration')
        || msg.includes('failed-service-worker-registration')
        || msg.includes('serviceworker script evaluation failed');
      if (attempt === 0 && swEvalFailed) {
        await _resetMessagingServiceWorkerRegistration();
        continue;
      }
      break;
    }
  }

  console.warn('No se pudo obtener el token push:', lastError);
  _state.toast?.('Push web listo en inbox, pero sin token de dispositivo todavía.', 'warning');
  return '';
}

async function persistCurrentDevicePrefs(changes = {}) {
  const ref = _currentUserDocRef();
  if (!ref) return;
  const currentPrefs = _currentDevicePrefs();
  const nextPrefs = { ...currentPrefs, ...changes };
  _state.currentDevice = {
    ...(_state.currentDevice || {}),
    notificationPrefs: nextPrefs
  };
  await _upsertDeviceDirect({
    notificationPrefs: nextPrefs,
    pushEnabled: _state.currentDevice?.invalidToken !== true && Notification.permission === 'granted'
  });
  _renderNotificationCenter();
}

export async function updateCurrentDevicePreferences(changes = {}) {
  await persistCurrentDevicePrefs(changes);
}

async function syncDeviceFocusState(options = {}) {
  if (!_currentUserDocRef() || navigator.onLine === false) return;
  const profile = _state.profileGetter?.() || {};
  const meta = _platformMeta();
  const payload = {
    deviceId: _deviceId(),
    ..._deviceSyncPayload(),
    plaza: _state.getCurrentPlaza?.() || profile?.plazaAsignada || '',
    browser: meta.browser,
    platform: meta.platform,
    userAgent: navigator.userAgent || '',
    appVersion: APP_BUILD,
    swVersion: APP_BUILD,
    notificationPrefs: _currentDevicePrefs(),
    ...(options.extraPayload && typeof options.extraPayload === 'object' ? options.extraPayload : {})
  };
  const signature = _deviceSyncSignature(payload);
  const now = Date.now();
  const intervalMs = payload.isFocused ? 45000 : 120000;

  if (!options.force && signature === _state.lastDeviceSyncSignature && (now - _state.lastDeviceSyncAt) < intervalMs) {
    return;
  }

  _state.lastDeviceSyncAt = now;
  _state.lastDeviceSyncSignature = signature;
  const callable = _fxCallable('syncDeviceContext');
  if (callable) {
    try {
      const res = await callable(payload);
      _state.currentDevice = {
        ...(_state.currentDevice || {}),
        ...payload,
        ...(res?.data || {})
      };
      return;
    } catch (error) {
      console.warn('syncDeviceContext fallback directo:', error);
    }
  }
  await _upsertDeviceDirect(payload);
}

export async function syncCurrentDeviceContext(extraPayload = {}, options = {}) {
  await syncDeviceFocusState({
    ...options,
    force: options.force !== false,
    extraPayload
  });
}

function _updateUnreadFromInbox() {
  _state.unread = _state.inbox.filter(item => item.read !== true && item.status !== 'READ').length;
}

export function configureNotifications(options = {}) {
  Object.assign(_state, options);
  _ensureNotificationCenterDom();
  _ensureSidebarButton();
  _renderNotificationCenter();
}

export async function requestDeviceNotifications(forcePrompt = false) {
  _ensureNotificationCenterDom();
  const token = await _obtainMessagingToken(forcePrompt);
  if (Notification.permission === 'granted') {
    _bindForegroundMessaging();
  }
  try {
    await _registerCurrentDevice(token);
  } catch (error) {
    console.warn('No se pudo registrar el dispositivo para push (fallback a contexto básico):', error);
    await _upsertDeviceDirect({
      deviceId: _deviceId(),
      token: token || '',
      permission: _supportsPush() ? Notification.permission : 'unsupported',
      pushEnabled: Boolean(token) && Notification.permission === 'granted',
      platform: _platformMeta().platform,
      browser: _platformMeta().browser,
      userAgent: navigator.userAgent || '',
      plaza: _state.getCurrentPlaza?.() || '',
      activeRoute: _currentRoute(),
      isFocused: document.visibilityState === 'visible' && document.hasFocus(),
      swVersion: APP_BUILD,
      appVersion: APP_BUILD
    });
  }
  await syncDeviceFocusState({ force: true });
  _state.toast?.(
    Notification.permission === 'granted'
      ? 'Este dispositivo ya puede recibir notificaciones reales.'
      : 'El inbox ya está activo. Permite notificaciones para llevarlo al sistema operativo.',
    Notification.permission === 'granted' ? 'success' : 'warning'
  );
  _renderNotificationCenter();
}

export function openNotificationCenter() {
  _ensureNotificationCenterDom();
  document.getElementById('notifications-center-modal')?.classList.add('active');
  _state.opened = true;
  _renderNotificationCenter();
}

export function closeNotificationCenter() {
  document.getElementById('notifications-center-modal')?.classList.remove('active');
  _state.opened = false;
}

export async function acknowledgeNotification(notificationId) {
  const id = _safeText(notificationId);
  if (!id) return;
  const callable = _fxCallable('ackNotification');
  if (callable) {
    try {
      await callable({ notificationId: id });
    } catch (_) {
      const ref = _currentUserDocRef();
      if (ref) {
        await ref.collection('inbox').doc(id).set({
          read: true,
          readAt: Date.now(),
          status: 'READ'
        }, { merge: true });
      }
    }
  } else {
    const ref = _currentUserDocRef();
    if (ref) {
      await ref.collection('inbox').doc(id).set({
        read: true,
        readAt: Date.now(),
        status: 'READ'
      }, { merge: true });
    }
  }
}

export async function handleInboxItemAction(item = {}) {
  const notificationId = item.notificationId || item.id;
  await acknowledgeNotification(notificationId);
  _state.inbox = _state.inbox.map(entry =>
    ((entry.notificationId || entry.id) === notificationId)
      ? { ...entry, read: true, status: 'READ', readAt: Date.now() }
      : entry
  );
  _updateUnreadFromInbox();
  _renderNotificationCenter();
  routeDeepLink(item.deepLink || '');
}

export function routeDeepLink(url = '') {
  if (!url) return;
  const target = new URL(url, window.location.origin);
  const notif  = target.searchParams.get('notif') || '';

  if (notif === 'chat') {
    // ── FIX: cerrar notif center, abrir buzón PRIMERO y luego el chat ──
    closeNotificationCenter();
    const chatUser = decodeURIComponent(target.searchParams.get('chatUser') || '');
    if (chatUser) {
      if (typeof _state.routeHandlers?.openBuzon === 'function') {
        _state.routeHandlers.openBuzon();
        setTimeout(() => _state.routeHandlers?.openChat?.(chatUser), 220);
      } else {
        _state.routeHandlers?.openChat?.(chatUser);
      }
    } else {
      _state.routeHandlers?.openBuzon?.();
    }
    return;
  }
  if (notif === 'cuadre') {
    closeNotificationCenter();
    _state.routeHandlers?.openCuadre?.();
    return;
  }
  if (notif === 'alerts') {
    closeNotificationCenter();
    _state.routeHandlers?.openAlerts?.();
    return;
  }
  if (notif === 'inbox') {
    openNotificationCenter();
  }
}

export function consumeNotificationDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const notif = params.get('notif');
  if (!notif) return;
  routeDeepLink(`${window.location.pathname}?${params.toString()}`);
  params.delete('notif');
  params.delete('chatUser');
  params.delete('openCuadre');
  params.delete('plaza');
  const cleaned = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
  history.replaceState({}, '', cleaned);
}

export async function resubscribeInbox() {
  if (_state.unsubInbox) {
    _state.unsubInbox();
    _state.unsubInbox = null;
  }

  const ref = _currentUserDocRef();
  if (!ref) return;
  _ensureNotificationCenterDom();
  _ensureSidebarButton();

  if (_state.unsubDevice) {
    _state.unsubDevice();
    _state.unsubDevice = null;
  }
  _state.unsubDevice = ref.collection('devices').doc(_deviceId()).onSnapshot(snap => {
    const prev = _state.currentDevice;
    _state.currentDevice = snap.exists ? ({ id: snap.id, ...snap.data() }) : null;
    _renderNotificationCenter();
    // Auto-refresh cuando el backend marca el token como inválido
    if (_state.currentDevice?.invalidToken === true && prev?.invalidToken !== true) {
      console.log('[push] invalidToken detectado → forzando refresh de token FCM');
      _forceTokenRefresh();
    }
  }, () => {});

  _state.unsubInbox = ref.collection('inbox')
    .orderBy('timestamp', 'desc')
    .limit(80)
    .onSnapshot(async snap => {
      const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const prevIds = new Set(_state.inbox.map(item => item.notificationId || item.id));
      _state.inbox = items;
      _updateUnreadFromInbox();
      _renderNotificationCenter();

      const isVisible = document.visibilityState === 'visible' && document.hasFocus();
      for (const item of items) {
        const itemId = item.notificationId || item.id;
        if (prevIds.has(itemId)) continue;
        if (item.read === true || item.status === 'READ') continue;
        if (isVisible && Notification.permission !== 'granted') {
          _state.toast?.(`${_safeText(item.title || 'Notificación')}: ${_safeText(item.body || '')}`, 'info');
        }
      }
    }, err => {
      console.error('notifications:inbox', err);
    });
}

function _bindNotificationLifecycle() {
  if (window.__mexNotificationLifecycleBound) return;
  window.__mexNotificationLifecycleBound = true;
  document.addEventListener('visibilitychange', () => {
    syncDeviceFocusState().catch(() => {});
  });
  window.addEventListener('focus', () => {
    syncDeviceFocusState().catch(() => {});
  });
  window.addEventListener('blur', () => {
    syncDeviceFocusState().catch(() => {});
  });
  window.addEventListener('online', () => {
    syncDeviceFocusState({ force: true }).catch(() => {});
  });
}

export async function initNotificationCenter() {
  _ensureNotificationCenterDom();
  _ensureSidebarButton();
  _bindNotificationLifecycle();
  if (_supportsPush() && Notification.permission === 'granted') {
    _bindForegroundMessaging();
    try {
      // Si el token ya estaba marcado como inválido, forzar regeneración desde el inicio
      const alreadyInvalid = _state.currentDevice?.invalidToken === true;
      if (alreadyInvalid) {
        await _forceTokenRefresh();
      } else {
        const token = await _obtainMessagingToken(false);
        await _registerCurrentDevice(token);
      }
    } catch (error) {
      console.warn('No se pudo refrescar el registro push en initNotificationCenter:', error);
    }
  }
  await resubscribeInbox();
  await syncDeviceFocusState({ force: true });
  if (_supportsPush() && Notification.permission === 'default' && !_state.permissionPromptShown) {
    _state.permissionPromptShown = true;
    setTimeout(() => {
      // Usar modal obligatorio en lugar de simple toast
      if (typeof window._mexShowPushPrompt === 'function') {
        window._mexShowPushPrompt();
      } else {
        _state.toast?.('Activa notificaciones para recibir mensajes, cuadre y alertas críticas.', 'warning');
      }
    }, 2500);
  }
  _renderNotificationCenter();
}

export function teardownNotificationCenter() {
  if (_state.unsubInbox) {
    _state.unsubInbox();
    _state.unsubInbox = null;
  }
  if (_state.unsubDevice) {
    _state.unsubDevice();
    _state.unsubDevice = null;
  }
}

export function getCurrentDeviceSnapshot() {
  return {
    unread: _state.unread,
    inbox: [..._state.inbox],
    currentDevice: _state.currentDevice,
    build: APP_BUILD
  };
}
