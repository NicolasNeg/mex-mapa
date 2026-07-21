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
  foregroundListenerPending: false,
  recentNotificationIds: new Map(),
  initialized: false,
  autoConfigured: false,
  /** App Shell bloquea toast/rutas para que el preload del mapa no las pise. */
  lockToastAndRoutes: false,
  /** Primera carga del inbox: no spamear toasts históricos. */
  inboxBootstrapped: false,
  /** Evita bucle change → persist → render → change al sincronizar checkboxes del centro */
  prefChangeGuard: false,
  /** Listeners del conteo unread del inbox (campana shell = mismo criterio que el panel). */
  unreadListeners: []
};

/** Evita inits concurrentes o recursivos (p. ej. profile + mapa en el mismo tick). */
let _initNotificationCenterPromise = null;

/** Misma regla que la lista del centro: leído solo si read=true o status READ. */
function _isInboxItemUnread(item = {}) {
  if (!item || typeof item !== 'object') return false;
  if (item.read === true) return false;
  const status = _safeText(item.status).toUpperCase();
  if (status === 'READ') return false;
  return true;
}

function _emitInboxUnread() {
  const unread = Number(_state.unread || 0);
  const inboxCount = Array.isArray(_state.inbox) ? _state.inbox.length : 0;
  const payload = { unread, inboxCount, hasUnread: unread > 0 };
  (_state.unreadListeners || []).forEach(fn => {
    try { fn(payload); } catch (_) {}
  });
  try {
    window.dispatchEvent(new CustomEvent('mex:inbox-unread', { detail: payload }));
  } catch (_) {}
}

function _safeText(value) {
  return String(value || '').trim();
}

function _ensureNotificationAssets() {
  if (typeof document === 'undefined') return;
  const head = document.head || document.querySelector('head');
  if (!head) return;

  const ensureStylesheet = (id, href) => {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    head.appendChild(link);
  };

  ensureStylesheet('mex-notif-icons-material', 'https://fonts.googleapis.com/icon?family=Material+Icons');
  ensureStylesheet('mex-notif-icons-symbols', 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined');
  ensureStylesheet('mex-notif-center-css', '/css/notificaciones.css');
  ensureStylesheet('mex-notif-center-app-css', '/css/app-notifications.css');
}

function _fallbackCurrentUserDocId() {
  const fromState = _safeText(_state.getCurrentUserDocId?.());
  if (fromState) return fromState;
  const fromProfile = _safeText(window.CURRENT_USER_PROFILE?.id || window.CURRENT_USER_PROFILE?.email);
  if (fromProfile) return fromProfile;
  const fromAuthEmail = _safeText(auth?.currentUser?.email || '').toLowerCase();
  if (fromAuthEmail) return fromAuthEmail;
  return _safeText(auth?.currentUser?.uid || '');
}

function _fallbackCurrentUserName() {
  const fromState = _safeText(_state.getCurrentUserName?.());
  if (fromState) return fromState;
  return _safeText(
    window.CURRENT_USER_PROFILE?.nombre
    || window.CURRENT_USER_PROFILE?.usuario
    || auth?.currentUser?.displayName
    || auth?.currentUser?.email
    || 'Usuario'
  );
}

function _fallbackCurrentPlaza() {
  const fromState = _safeText(_state.getCurrentPlaza?.());
  if (fromState) return fromState;
  return _safeText(
    window.getMexCurrentPlaza?.()
    || window.CURRENT_USER_PROFILE?.plazaAsignada
    || window.CURRENT_USER_PROFILE?.plaza
    || ''
  );
}

function _chatDeepLink(chatUser = '') {
  const safeUser = _safeText(chatUser);
  return safeUser ? '/app/mensajes/c/' + encodeURIComponent(safeUser) : '/app/mensajes';
}

function _chatUserFromPath(pathname = '') {
  const re = new RegExp('^/app/mensajes/c/([^/?#]+)', 'i');
  const match = String(pathname || '').match(re);
  return match ? decodeURIComponent(match[1] || '') : '';
}

function _missionIdFromNotification(item = {}) {
  return _safeText(
    item.missionId
    || item.cuadreMissionId
    || item.payload?.missionId
    || item.payload?.cuadreMissionId
    || item.notificationId
    || item.id
  ).toUpperCase();
}

function _plazaFromNotification(item = {}) {
  return _safeText(item.plaza || item.payload?.plaza || item.plazaId || item.payload?.plazaId).toUpperCase();
}

function _cuadreMissionDeepLink(item = {}) {
  const params = new URLSearchParams();
  const missionId = _missionIdFromNotification(item);
  const plaza = _plazaFromNotification(item);
  if (missionId) params.set('missionId', missionId);
  if (plaza) params.set('plaza', plaza);
  params.set('source', 'notif');
  return `/app/cuadrarflota?${params.toString()}`;
}

function _cuadreReviewDeepLink(item = {}) {
  const params = new URLSearchParams();
  const missionId = _missionIdFromNotification(item);
  const plaza = _plazaFromNotification(item);
  if (missionId) params.set('missionId', missionId);
  if (plaza) params.set('plaza', plaza);
  return `/app/cuadrarflota/ventas?${params.toString()}`;
}

function _isLegacyCuadreTarget(target) {
  const pathname = String(target?.pathname || '').replace(/\/+$/, '') || '/';
  const params = target?.searchParams || new URLSearchParams();
  const tab = _safeText(params.get('tab')).toLowerCase();
  const notif = _safeText(params.get('notif')).toLowerCase();
  return (
    (pathname === '/mapa' || pathname === '/app/mapa') &&
    (
      tab === 'cuadre' ||
      !!params.get('openCuadre') ||
      !!params.get('openCuadreV3') ||
      !!params.get('cuadre') ||
      notif === 'cuadre'
    )
  );
}

function _cuadreMissionDeepLinkFromTarget(target) {
  const params = new URLSearchParams();
  const missionId = _safeText(target?.searchParams?.get('missionId') || target?.searchParams?.get('cuadreMissionId')).toUpperCase();
  const plaza = _safeText(target?.searchParams?.get('plaza') || target?.searchParams?.get('plazaId')).toUpperCase();
  if (missionId) params.set('missionId', missionId);
  if (plaza) params.set('plaza', plaza);
  params.set('source', 'legacy-cuadre-link');
  return `/app/cuadrarflota?${params.toString()}`;
}

function _ensureAutoConfiguration() {
  if (_state.autoConfigured) return;
  configureNotifications({
    profileGetter: () => window.CURRENT_USER_PROFILE || null,
    getCurrentUserName: () => _fallbackCurrentUserName(),
    getCurrentUserDocId: () => _fallbackCurrentUserDocId(),
    getCurrentPlaza: () => _fallbackCurrentPlaza(),
    toast: (msg) => {
      const text = _safeText(msg);
      if (!text) return;
      if (typeof window.showToast === 'function') {
        window.showToast(text);
        return;
      }
      console.log(text);
    },
    routeHandlers: {
      openBuzon: () => { window.location.href = '/app/mensajes'; },
      openChat: (chatUser = '') => { window.location.href = _chatDeepLink(chatUser); },
      openCuadre: () => { window.location.href = '/app/cuadrarflota?source=notif'; },
      openAlerts: () => { window.location.href = '/app/mapa?notif=alerts'; }
    }
  });
}

function _normalizeUpper(value) {
  return _safeText(value).toUpperCase();
}

function _pruneRecentNotificationIds(now = Date.now()) {
  for (const [id, ts] of _state.recentNotificationIds.entries()) {
    if ((now - ts) > 45000) _state.recentNotificationIds.delete(id);
  }
}

function _wasNotificationSeenRecently(id, maxAgeMs = 12000) {
  const safeId = _safeText(id);
  if (!safeId) return false;
  const now = Date.now();
  _pruneRecentNotificationIds(now);
  const ts = _state.recentNotificationIds.get(safeId) || 0;
  return ts > 0 && (now - ts) <= maxAgeMs;
}

function _rememberNotificationSeen(id) {
  const safeId = _safeText(id);
  if (!safeId) return;
  _pruneRecentNotificationIds();
  _state.recentNotificationIds.set(safeId, Date.now());
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

function _notificationChatTarget(item = {}) {
  return _safeText(
    item?.payload?.remitenteEmail
    || item?.payload?.remitente_email
    || item?.senderEmail
    || item?.actorEmail
    || item?.payload?.remitente
    || _notificationSender(item)
    || ""
  );
}

function _notificationContextCopy(item = {}) {
  const kind = _friendlyNotificationKind(item);
  const type = _safeText(item?.type).toLowerCase();
  // Mensajes ya muestran el remitente en el cuerpo; no repetir "De …" en el meta.
  if (type.includes('message') || type.includes('mensaje')) {
    return kind || 'Mensaje directo';
  }
  const parts = [];
  if (kind) parts.push(kind);
  const sender = _notificationSender(item);
  if (sender) parts.push(sender);
  return parts.join(' · ') || 'Sistema';
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

async function _showSystemNotification({ title, body, data = {}, tag = 'mex-notif', renotify = false, notificationId = '' } = {}) {
  if (!_supportsPush() || Notification.permission !== 'granted') return;
  const safeNotificationId = _safeText(notificationId || data?.notificationId || '');
  if (safeNotificationId && _wasNotificationSeenRecently(safeNotificationId)) return;
  if (safeNotificationId) _rememberNotificationSeen(safeNotificationId);
  const options = {
    body: _safeText(body),
    icon: _notificationIcon(),
    badge: _notificationIcon(),
    tag: safeNotificationId ? `notif:${safeNotificationId}` : tag,
    renotify: safeNotificationId ? false : renotify,
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
        const title = payload?.notification?.title || payload?.data?.title || _appDisplayName();
        const body = payload?.notification?.body || payload?.data?.body || '';
        const isVisible = document.visibilityState === 'visible' && document.hasFocus();

        if (isVisible) {
          if (!_wasNotificationSeenRecently(notificationId)) {
            _rememberNotificationSeen(notificationId);
            // Una sola toast en primer plano; el inbox ya lista el resto.
            _state.toast?.(body ? `${_safeText(title)}: ${_safeText(body)}` : _safeText(title), 'info');
          }
          return;
        }

        _showSystemNotification({
          title,
          body,
          tag: `notif:${notificationId}`,
          renotify: false,
          notificationId,
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
  _ensureNotificationAssets();
  if (document.getElementById('notifications-center-modal')) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div id="notifications-center-modal" class="notif-center-modal">
      <div class="notif-center-shell">

        <!-- Header -->
        <div class="notif-center-header">
          <div class="notif-center-heading">
            <div class="notif-center-kicker">Centro operativo</div>
            <div class="notif-center-title-row">
              <h2 class="notif-center-title">Notificaciones</h2>
              <span id="notif-center-unread-badge" class="notif-center-unread-badge">Todo al día</span>
            </div>
            <p id="notif-center-summary" class="notif-center-summary">Seguimiento de mensajes, inventario, alertas y solicitudes del sistema.</p>
          </div>
          <button id="notif-center-close" class="notif-center-close" type="button" aria-label="Cerrar">
            <span class="material-icons" style="font-size:18px;">close</span>
          </button>
        </div>

        <!-- Chips de filtro -->
        <div class="notif-filter-bar">
          <button class="notif-filter-chip active" data-filter="all">Todos <span id="notif-chip-badge-all" class="notif-chip-badge">0</span></button>
          <button class="notif-filter-chip" data-filter="message">Mensajes <span id="notif-chip-badge-message" class="notif-chip-badge">0</span></button>
          <button class="notif-filter-chip" data-filter="cuadre">Inventario <span id="notif-chip-badge-cuadre" class="notif-chip-badge">0</span></button>
          <button class="notif-filter-chip" data-filter="alert">Alertas <span id="notif-chip-badge-alert" class="notif-chip-badge">0</span></button>
          <button class="notif-filter-chip" data-filter="solicitud">Solicitudes <span id="notif-chip-badge-solicitud" class="notif-chip-badge">0</span></button>
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
  document.getElementById('notif-center-refresh-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('notif-center-refresh-btn');
    if (!btn || btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.setAttribute('aria-busy', 'true');
    try {
      await resubscribeInbox();
      await syncDeviceFocusState({ force: true }).catch(() => {});
      _renderNotificationCenter();
    } catch (err) {
      console.warn('[notificaciones] Error al refrescar inbox:', err);
      _state.toast?.('No se pudo refrescar el centro. Intenta de nuevo.', 'error');
    } finally {
      btn.dataset.busy = '0';
      btn.removeAttribute('aria-busy');
    }
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
      if (_state.prefChangeGuard) return;
      persistCurrentDevicePrefs({ [field]: event.target.checked });
    });
  });

  if (!window.__mexNotifCenterEscapeBound) {
    window.__mexNotifCenterEscapeBound = true;
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const modal = document.getElementById('notifications-center-modal');
      if (modal?.classList.contains('active')) closeNotificationCenter();
    });
  }
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

// Humaniza nombres de archivo en el cuerpo de notificaciones
function _humanizeBody(body) {
  const b = String(body || '').trim();
  if (!b) return '';
  if (/\.(webm|ogg|mp3|m4a|aac|wav|opus|oga)$/i.test(b) || /^(audio|voz|voice)[-_\d]/i.test(b)) return 'Mensaje de voz';
  if (/\.(mp4|mov|avi|mkv|3gp|flv)$/i.test(b) || /^video[-_\d]/i.test(b)) return 'Envió un video';
  if (/\.(jpg|jpeg|png|gif|webp|heic|bmp|tiff)$/i.test(b) || /^(image|img|photo|foto)[-_\d]/i.test(b)) return 'Envió una foto';
  if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z)$/i.test(b)) return 'Envió un archivo';
  return b;
}

// Obtiene el color e ícono del avatar según tipo + contenido del mensaje
function _notifAvatarColor(type = '', body = '') {
  const t = type.toLowerCase();
  const b = String(body || '').toLowerCase();
  if (t.includes('message') || t.includes('mensaje')) {
    if (/\.(webm|ogg|mp3|m4a|aac|wav|opus|oga)$/i.test(b) || /^(audio|voz|voice)[-_\d]/i.test(b)) return { bg: '#7c3aed', icon: 'mic' };
    if (/\.(mp4|mov|avi|mkv|3gp)$/i.test(b) || /^video[-_\d]/i.test(b)) return { bg: '#0284c7', icon: 'videocam' };
    if (/\.(jpg|jpeg|png|gif|webp|heic|bmp)$/i.test(b) || /^(image|img|photo|foto)[-_\d]/i.test(b)) return { bg: '#059669', icon: 'image' };
    if (/\.(pdf|doc|docx|xls|xlsx|zip|rar)$/i.test(b)) return { bg: '#b45309', icon: 'attach_file' };
    return { bg: '#3b82f6', icon: 'forum' };
  }
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

  if (type.includes('message') || type.includes('mensaje')) {
    const who = sender || 'Alguien';
    const friendly = _humanizeBody(body);
    const isFile = friendly !== body && body.length > 0;
    if (isFile) return `<strong>${who}</strong> · ${friendly}`;
    if (!friendly) return `<strong>${who}</strong> te envió un mensaje.`;
    const preview = friendly.slice(0, 72) + (friendly.length > 72 ? '…' : '');
    return `<strong>${who}</strong> · ${preview}`;
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
    return `Alerta operativa${titulo ? `: <strong>${titulo}</strong>` : ' crítica recibida.'}`;
  }
  if (type.includes('alert')) {
    return _safeText(item?.title || 'Nueva alerta del sistema.');
  }
  if (type.includes('solicitud') || type.includes('request.user')) {
    return `Nueva solicitud de registro${sender ? ` de <strong>${sender}</strong>` : ''}.`;
  }
  if (type.includes('test')) {
    return 'Prueba de notificaciones enviada correctamente.';
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
    const isAll = filter === 'all';
    listEl.innerHTML = `<div class="notif-center-empty" role="status">
      <span class="material-icons" aria-hidden="true">${isAll ? 'mark_email_read' : 'notifications_none'}</span>
      <span class="notif-center-empty-pill">${isAll ? 'Todo al día' : 'Sin resultados'}</span>
      <strong>${isAll ? 'Inbox limpio' : 'Nada en este filtro'}</strong>
      <p>${isAll
        ? 'Cuando llegue algo importante, aparecerá aquí.'
        : 'Prueba otro filtro o vuelve a Todos.'}</p>
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
      const isUnread = _isInboxItemUnread(item);
      const type     = _safeText(item?.type);
      const rawBody  = _safeText(item?.body || item?.payload?.mensaje || '');
      const meta     = _notifAvatarColor(type, rawBody);
      const sender   = _notificationSender(item);
      const context  = _notificationContextCopy(item);
      const text     = _notifFriendlyText(item);

      html += `
        <article class="notif-item${isUnread ? ' unread' : ''}" data-id="${id}">
          <button class="notif-item-main" type="button" data-notif-open="${id}">
            <div class="notif-item-avatar" style="background:${meta.bg}">
              <span class="material-icons" style="color:rgba(255,255,255,0.95);font-size:22px;line-height:1;">${meta.icon}</span>
            </div>
            <div class="notif-item-copy">
              <div class="notif-item-head">
                <span class="notif-item-context">${_safeText(context || _friendlyNotificationKind(item) || 'Sistema')}</span>
                <time class="notif-item-time" datetime="${ts ? new Date(ts).toISOString() : ''}">${timeStr}</time>
              </div>
              <p class="notif-item-text">${text}</p>
              ${_safeText(item?.plaza) ? `<div class="notif-item-meta"><span class="notif-item-tag">${_safeText(item.plaza)}</span></div>` : ''}
            </div>
            ${isUnread ? '<div class="notif-unread-dot" aria-hidden="true"></div>' : ''}
          </button>
          <div class="notif-item-actions">
            ${isUnread ? `
              <button type="button" class="notif-item-action" data-notif-read="${id}" title="Marcar como leída" aria-label="Marcar como leída">
                <span class="material-icons">done</span>
              </button>` : ''}
            <button type="button" class="notif-item-action danger" data-notif-delete="${id}" title="Eliminar" aria-label="Eliminar notificación">
              <span class="material-icons">delete</span>
            </button>
          </div>
        </article>
      `;
    });
  });

  listEl.innerHTML = html;

  listEl.querySelectorAll('[data-notif-open]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-notif-open');
      const item = _state.inbox.find(entry => (entry.notificationId || entry.id) === id);
      if (item) handleInboxItemAction(item);
    });
  });
  listEl.querySelectorAll('[data-notif-read]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      markNotificationRead(button.getAttribute('data-notif-read')).catch(() => {});
    });
  });
  listEl.querySelectorAll('[data-notif-delete]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      deleteInboxNotification(button.getAttribute('data-notif-delete')).catch(() => {});
    });
  });
}

function _renderNotificationCenter() {
  _ensureNotificationCenterDom();

  const metaEl      = document.getElementById('notif-center-meta');
  const deviceEl    = document.getElementById('notif-center-device-status');
  const permissionBtn = document.getElementById('notif-center-permission-btn');
  const badge       = document.getElementById('badgeNotificationCenter');
  const unreadBadge = document.getElementById('notif-center-unread-badge');
  const summaryEl   = document.getElementById('notif-center-summary');

  if (badge) {
    badge.textContent = String(_state.unread);
    badge.style.display = _state.unread > 0 ? 'flex' : 'none';
  }

  const inbox = Array.isArray(_state.inbox) ? _state.inbox : [];
  const filterCounts = {
    all: inbox.length,
    message: inbox.filter(item => _safeText(item?.type).toLowerCase().includes('message')).length,
    cuadre: inbox.filter(item => _safeText(item?.type).toLowerCase().includes('cuadre')).length,
    alert: inbox.filter(item => _safeText(item?.type).toLowerCase().includes('alert')).length,
    solicitud: inbox.filter(item => {
      const type = _safeText(item?.type).toLowerCase();
      return type.includes('solicitud') || type.includes('request');
    }).length
  };

  Object.entries(filterCounts).forEach(([key, count]) => {
    const chipBadge = document.getElementById(`notif-chip-badge-${key}`);
    if (!chipBadge) return;
    chipBadge.textContent = String(count);
    chipBadge.style.display = count > 0 ? 'inline-flex' : 'none';
  });

  const inboxCount = inbox.length;
  const modalEl = document.getElementById('notifications-center-modal');
  if (modalEl) {
    modalEl.classList.toggle('is-empty', inboxCount === 0);
    modalEl.classList.toggle('has-items', inboxCount > 0);
  }

  // Empty-state copy solo cuando no hay ítems (evita "Todo al día" junto a tarjetas leídas).
  if (unreadBadge) {
    if (_state.unread > 0) {
      unreadBadge.hidden = false;
      unreadBadge.textContent = `${_state.unread} nueva${_state.unread === 1 ? '' : 's'}`;
      unreadBadge.classList.add('has-unread');
    } else if (inboxCount === 0) {
      unreadBadge.hidden = false;
      unreadBadge.textContent = 'Todo al día';
      unreadBadge.classList.remove('has-unread');
    } else {
      unreadBadge.hidden = true;
      unreadBadge.textContent = '';
      unreadBadge.classList.remove('has-unread');
    }
  }

  if (summaryEl) {
    if (inboxCount === 0) {
      summaryEl.hidden = false;
      summaryEl.textContent = 'Tu inbox está limpio por ahora. Cuando llegue algo importante, aparecerá aquí.';
      summaryEl.classList.add('is-empty-copy');
    } else if (_state.unread > 0) {
      summaryEl.hidden = false;
      summaryEl.textContent = `${_state.unread} pendiente${_state.unread === 1 ? '' : 's'} por revisar.`;
      summaryEl.classList.remove('is-empty-copy');
    } else {
      summaryEl.hidden = true;
      summaryEl.textContent = '';
      summaryEl.classList.remove('is-empty-copy');
    }
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
  _state.prefChangeGuard = true;
  try {
    Object.entries(fieldMap).forEach(([id, checked]) => {
      const input = document.getElementById(id);
      if (input) input.checked = checked;
    });
  } finally {
    _state.prefChangeGuard = false;
  }

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

      // PushManager.subscribe requiere un SW ACTIVO. Si aún no lo está, esperamos
      // a que lo esté (navigator.serviceWorker.ready solo resuelve con SW activo);
      // si no hay, retornamos sin token en vez de lanzar AbortError.
      if (!registration.active) {
        try { registration = await navigator.serviceWorker.ready; } catch (_) {}
      }
      if (!registration || !registration.active) return '';

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
  // La callable syncDeviceContext puede no estar desplegada (Functions requieren
  // plan Blaze) → pegaría a un endpoint inexistente y spamearía errores CORS en
  // cada sync. Si falló recientemente, la saltamos y usamos el upsert directo.
  // Se reintenta pasadas 24h por si se despliega la función.
  const CALLABLE_TTL = 24 * 60 * 60 * 1000;
  let callableDisabled = false;
  try {
    const t = Number(localStorage.getItem('mex.syncDeviceCallable.failedAt') || 0);
    callableDisabled = t && (Date.now() - t) < CALLABLE_TTL;
  } catch (_) {}

  const callable = _fxCallable('syncDeviceContext');
  if (callable && !callableDisabled) {
    try {
      const res = await callable(payload);
      _state.currentDevice = {
        ...(_state.currentDevice || {}),
        ...payload,
        ...(res?.data || {})
      };
      return;
    } catch (error) {
      // Función no alcanzable → no reintentar esta callable por 24h (usa directo).
      try { localStorage.setItem('mex.syncDeviceCallable.failedAt', String(Date.now())); } catch (_) {}
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
  _state.unread = (_state.inbox || []).filter(_isInboxItemUnread).length;
  _emitInboxUnread();
}

export function configureNotifications(options = {}) {
  const nextLock = options.lockToastAndRoutes === true || _state.lockToastAndRoutes === true;
  if (_state.lockToastAndRoutes) {
    const { toast, routeHandlers, lockToastAndRoutes, ...rest } = options;
    Object.assign(_state, rest);
  } else {
    Object.assign(_state, options);
  }
  if (nextLock) _state.lockToastAndRoutes = true;
  // Marca configuración explícita o por defecto: evita que initNotificationCenter()
  // vuelva a llamar configureNotifications y pise routeHandlers/toast del host (p. ej. mapa.js).
  _state.autoConfigured = true;
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

function _markLocalRead(notificationId) {
  const id = _safeText(notificationId);
  if (!id) return;
  _state.inbox = _state.inbox.map(entry =>
    ((entry.notificationId || entry.id) === id)
      ? { ...entry, read: true, status: 'READ', readAt: Date.now() }
      : entry
  );
  _updateUnreadFromInbox();
  _renderNotificationCenter();
}

export async function markNotificationRead(notificationId) {
  const id = _safeText(notificationId);
  if (!id) return;
  _markLocalRead(id);
  await acknowledgeNotification(id);
}

export async function deleteInboxNotification(notificationId) {
  const id = _safeText(notificationId);
  if (!id) return;
  _state.inbox = _state.inbox.filter(entry => (entry.notificationId || entry.id) !== id);
  _updateUnreadFromInbox();
  _renderNotificationCenter();
  const ref = _currentUserDocRef();
  if (!ref) return;
  try {
    await ref.collection('inbox').doc(id).delete();
  } catch (err) {
    console.warn('[notificaciones] No se pudo eliminar:', err);
    _state.toast?.('No se pudo eliminar la notificación.', 'error');
    await resubscribeInbox().catch(() => {});
  }
}

function _inferDeepLink(item = {}) {
  const type = _safeText(item.type || '').toLowerCase();
  const existing = _safeText(item.deepLink || '');
  let existingTarget = null;
  try { if (existing) existingTarget = new URL(existing, window.location.origin); } catch (_) {}
  const textHint = _safeText(`${type} ${item.title || ''} ${item.body || ''} ${item.kindLabel || ''}`).toLowerCase();
  const isCuadre = textHint.includes('cuadre') || _isLegacyCuadreTarget(existingTarget);
  const isReview = type.includes('review') || type.includes('revision') || type.includes('revisión');
  const isAssignedMission = isCuadre && !isReview && (
    type.includes('assigned')
    || type.includes('updated')
    || type.includes('mision')
    || type.includes('mission')
    || textHint.includes('mision')
    || textHint.includes('misión')
    || textHint.includes('patio')
    || !!_missionIdFromNotification(item)
    || _isLegacyCuadreTarget(existingTarget)
  );
  if (isAssignedMission) {
    if (
      _isLegacyCuadreTarget(existingTarget) ||
      (existingTarget?.pathname === '/app/cuadre' && !!existingTarget.searchParams.get('missionId'))
    ) return _cuadreMissionDeepLinkFromTarget(existingTarget);
    return _cuadreMissionDeepLink(item);
  }
  if (isCuadre && isReview) return _cuadreReviewDeepLink(item);

  if (existing) {
    try {
      const target = existingTarget || new URL(existing, window.location.origin);
      const legacyCuadreLink = _isLegacyCuadreTarget(target)
        || (target.pathname === '/app/cuadre' && target.searchParams.get('notif') === 'cuadre' && !!target.searchParams.get('missionId'));
      if (legacyCuadreLink && isCuadre) return isReview ? _cuadreReviewDeepLink(item) : _cuadreMissionDeepLink(item);
    } catch (_) {}
    return existing;
  }
  if (type.includes('message') || type.includes('mensaje')) {
    const sender = _notificationChatTarget(item);
    return _chatDeepLink(sender);
  }
  if (type.includes('cuadre')) return _cuadreMissionDeepLink(item);
  if (type.includes('alert')) return '/app/mapa?notif=alerts';
  if (type.includes('solicitud') || type.includes('request')) return '/app/admin?notif=solicitudes';
  return '';
}

function _isPersistentCuadreMission(item = {}) {
  const type = _safeText(item.type || '').toLowerCase();
  const status = _safeText(item.status || '').toUpperCase();
  const missionStatus = _safeText(item.missionStatus || item.payload?.missionStatus || '').toUpperCase();
  const hasMissionId = !!_safeText(item.missionId || item.payload?.missionId || item.notificationId || item.id);
  const isReview = type.includes('review') || type.includes('revision') || type.includes('revisión');
  const isCuadreMission = !isReview && (
    type.includes('cuadre.assigned')
    || type.includes('cuadre.updated')
    || (type.includes('cuadre') && hasMissionId)
  );
  if (!isCuadreMission) return false;
  if (item.read === true || status === 'READ' || missionStatus === 'COMPLETED' || missionStatus === 'CERRADA') return false;
  return true;
}

export async function handleInboxItemAction(item = {}) {
  const notificationId = item.notificationId || item.id;
  // Al abrir el destino marcamos leída (incluye misiones de cuadre).
  // El usuario también puede marcar/eliminar sin navegar desde los botones del item.
  _markLocalRead(notificationId);
  closeNotificationCenter();
  const link = _inferDeepLink(item);
  if (link) routeDeepLink(link);
  Promise.resolve(acknowledgeNotification(notificationId)).catch(() => {});
}

export function routeDeepLink(url = '') {
  if (!url) return;
  const target = new URL(url, window.location.origin);
  const notif  = target.searchParams.get('notif') || '';
  const chatFromPath = _chatUserFromPath(target.pathname);
  const missionTarget = _isLegacyCuadreTarget(target)
    || (target.pathname === '/app/cuadre' && !!target.searchParams.get('missionId'));

  if (missionTarget) {
    closeNotificationCenter();
    const next = _cuadreMissionDeepLinkFromTarget(target);
    if (typeof window.__mexShellNavigate === 'function') window.__mexShellNavigate(next);
    else window.location.href = next;
    return;
  }

  if (chatFromPath) {
    // Preferir navegación SPA a /app/mensajes (evita buzón legacy del mapa).
    closeNotificationCenter();
    const next = _chatDeepLink(chatFromPath);
    if (typeof window.__mexShellNavigate === 'function') window.__mexShellNavigate(next);
    else if (typeof _state.routeHandlers?.openChat === 'function') _state.routeHandlers.openChat(chatFromPath);
    else window.location.href = next;
    return;
  }

  if (target.pathname.startsWith('/app/')) {
    closeNotificationCenter();
    const next = `${target.pathname}${target.search || ''}${target.hash || ''}`;
    if (typeof window.__mexShellNavigate === 'function') window.__mexShellNavigate(next);
    else window.location.href = next;
    return;
  }

  if (notif === "chat") {
    closeNotificationCenter();
    const chatUser = target.searchParams.get("chatUser") || "";
    const next = _chatDeepLink(chatUser);
    if (typeof window.__mexShellNavigate === 'function') {
      window.__mexShellNavigate(next);
    } else if (chatUser && typeof _state.routeHandlers?.openChat === "function") {
      _state.routeHandlers.openChat(chatUser);
    } else if (typeof _state.routeHandlers?.openBuzon === "function") {
      _state.routeHandlers.openBuzon();
    } else {
      window.location.href = next;
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
      const isBootstrap = !_state.inboxBootstrapped;
      _state.inbox = items;
      _state.inboxBootstrapped = true;
      _updateUnreadFromInbox();
      _renderNotificationCenter();

      // Primera hidratación: solo indexar IDs. No spamear toasts de histórico.
      if (isBootstrap) {
        items.forEach(item => _rememberNotificationSeen(item.notificationId || item.id));
        return;
      }

      const isVisible = document.visibilityState === 'visible' && document.hasFocus();
      let toasted = 0;
      for (const item of items) {
        const itemId = item.notificationId || item.id;
        if (prevIds.has(itemId)) continue;
        if (item.read === true || item.status === 'READ') continue;
        if (_wasNotificationSeenRecently(itemId)) continue;
        _rememberNotificationSeen(itemId);
        if (!isVisible) continue;
        // Con push activo, el sistema/foreground ya avisa; evita doble toast.
        if (Notification.permission === 'granted') continue;
        if (toasted >= 1) continue;
        toasted += 1;
        _state.toast?.(`${_safeText(item.title || 'Notificación')}: ${_safeText(item.body || '')}`, 'info');
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
  if (_state.initialized) return;
  if (_initNotificationCenterPromise) {
    await _initNotificationCenterPromise;
    return;
  }

  _initNotificationCenterPromise = (async () => {
    _ensureAutoConfiguration();
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
    _state.initialized = true;
  })();

  try {
    await _initNotificationCenterPromise;
  } catch (err) {
    throw err;
  } finally {
    _initNotificationCenterPromise = null;
  }
}

export async function ensureNotificationCenterReady() {
  _ensureAutoConfiguration();
  if (!_state.initialized) {
    await initNotificationCenter();
    return;
  }
  _ensureNotificationCenterDom();
  _ensureSidebarButton();
  await syncDeviceFocusState({ force: true }).catch(() => {});
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
  _state.initialized = false;
  _state.autoConfigured = false;
  _state.inbox = [];
  _state.unread = 0;
  _state.inboxBootstrapped = false;
  _state.lockToastAndRoutes = false;
  _state.currentDevice = null;
  _emitInboxUnread();
}

/**
 * Suscribe al conteo unread del inbox (misma fuente que el Centro vivo).
 * @param {(payload: { unread: number, inboxCount: number, hasUnread: boolean }) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeInboxUnread(listener) {
  if (typeof listener !== 'function') return () => {};
  _state.unreadListeners = Array.isArray(_state.unreadListeners) ? _state.unreadListeners : [];
  _state.unreadListeners.push(listener);
  try {
    listener({
      unread: Number(_state.unread || 0),
      inboxCount: Array.isArray(_state.inbox) ? _state.inbox.length : 0,
      hasUnread: Number(_state.unread || 0) > 0
    });
  } catch (_) {}
  return () => {
    _state.unreadListeners = (_state.unreadListeners || []).filter(fn => fn !== listener);
  };
}

export function getCurrentDeviceSnapshot() {
  return {
    unread: _state.unread,
    inbox: [..._state.inbox],
    currentDevice: _state.currentDevice,
    build: APP_BUILD
  };
}
