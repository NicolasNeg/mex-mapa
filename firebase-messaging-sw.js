importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
importScripts('/config.js');

(function () {
  const root = self;
  const cfg = Object.assign({}, root.FIREBASE_CONFIG || {});
  const projectId = String(cfg.projectId || '').trim();
  const rawBucket = String(cfg.storageBucket || '').trim().replace(/^gs:\/\//i, '');
  const modernBucket = projectId ? `${projectId}.firebasestorage.app` : '';

  if (modernBucket && (!rawBucket || rawBucket.endsWith('.appspot.com'))) {
    cfg.storageBucket = modernBucket;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(cfg);
  }

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(payload => {
    const title = payload?.notification?.title || payload?.data?.title || 'Nueva notificacion';
    const body = payload?.notification?.body || payload?.data?.body || '';
    const notificationId = String(
      payload?.data?.notificationId
      || payload?.messageId
      || Date.now()
    );

    return root.registration.showNotification(title, {
      body,
      icon: payload?.notification?.icon || payload?.data?.icon || '/img/logo.png',
      badge: '/img/logo.png',
      tag: payload?.data?.tag || `fcm:${notificationId}`,
      renotify: true,
      data: {
        url: payload?.data?.url || '/mapa?notif=inbox',
        notificationId,
        type: payload?.data?.type || 'system'
      },
      vibrate: [180, 80, 180]
    });
  });

  root.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = (() => {
      try {
        return new URL(event.notification?.data?.url || '/mapa?notif=inbox', root.location.origin).toString();
      } catch (_) {
        return new URL('/mapa?notif=inbox', root.location.origin).toString();
      }
    })();

    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        const first = list[0];
        if (first) {
          if (typeof first.navigate === 'function') {
            return first.navigate(targetUrl).then(() => first.focus()).catch(() => first.focus());
          }
          return first.focus();
        }
        return clients.openWindow(targetUrl);
      })
    );
  });
})();
