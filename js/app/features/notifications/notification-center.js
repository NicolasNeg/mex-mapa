/**
 * Centro de Notificaciones (Centro vivo) en App Shell — FASE 15G
 * Reutiliza DOM y lógica de /js/core/notifications.js; configura rutas /app/* y estado vivo.
 */
import {
  configureNotifications,
  initNotificationCenter,
  openNotificationCenter,
  teardownNotificationCenter,
  getCurrentDeviceSnapshot
} from '/js/core/notifications.js';
import { getState } from '/js/app/app-state.js';

let _appShellNotifSetup = false;

function _navigate(router, path) {
  const raw = String(path || '');
  if (router?.navigate) router.navigate(raw);
  else window.location.href = raw;
}

function _chatRoute(chatUser = '') {
  const u = String(chatUser || '').trim();
  return u ? '/app/mensajes/c/' + encodeURIComponent(u) : '/app/mensajes';
}

function _routeHandlers(router) {
  return {
    openBuzon: () => _navigate(router, '/app/mensajes'),
    openChat: (chatUser = '') => _navigate(router, _chatRoute(chatUser)),
    openCuadre: () => _navigate(router, '/app/cuadrarflota?source=notif'),
    openAlerts: () => _navigate(router, '/app/mapa?notif=alerts')
  };
}

/**
 * Primera vez: configure + init Firestore inbox. Siguientes: no-op salvo que haya hecho teardown.
 */
export async function setupAppNotificationCenter({ router, toast } = {}) {
  const safeToast = typeof toast === 'function'
    ? toast
    : (msg, type) => {
        const text = String(msg || '').trim();
        if (!text) return;
        if (type === 'error') console.error('[notificaciones]', text);
        else console.log('[notificaciones]', text);
      };

  if (!_appShellNotifSetup) {
    configureNotifications({
      profileGetter: () => {
        try {
          return getState().profile || window.CURRENT_USER_PROFILE || null;
        } catch (_) {
          return window.CURRENT_USER_PROFILE || null;
        }
      },
      getCurrentUserName: () => {
        try {
          const p = getState().profile || {};
          return String(p.nombre || p.usuario || '').trim()
            || String(getState().user?.displayName || getState().user?.email || '').trim();
        } catch (_) {
          return '';
        }
      },
      getCurrentUserDocId: () => {
        try {
          const p = getState().profile || {};
          const id = String(p.id || '').trim();
          if (id) return id;
          return String(getState().user?.email || getState().user?.uid || '').trim().toLowerCase();
        } catch (_) {
          return '';
        }
      },
      getCurrentPlaza: () => {
        try {
          return String(getState().currentPlaza || '').trim().toUpperCase();
        } catch (_) {
          return '';
        }
      },
      toast: safeToast,
      routeHandlers: _routeHandlers(router)
    });

    await initNotificationCenter();
    _appShellNotifSetup = true;
    return;
  }

  await initNotificationCenter();
}

export function openAppNotificationCenter() {
  openNotificationCenter();
}

export function teardownAppNotificationShell() {
  _appShellNotifSetup = false;
  teardownNotificationCenter();
}

export { getCurrentDeviceSnapshot };
