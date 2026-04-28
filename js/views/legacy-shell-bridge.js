(function () {
  function norm(path) {
    return String(path || '').replace(/\/+$/, '') || '/';
  }

  var path = norm(window.location.pathname);
  var routeMap = {
    '/home': '/app/dashboard',
    '/profile': '/app/profile',
    '/mensajes': '/app/mensajes',
    '/cola-preparacion': '/app/cola-preparacion',
    '/incidencias': '/app/incidencias',
    '/cuadre': '/app/cuadre',
    '/gestion': '/app/admin',
    '/programador': '/app/programador',
    '/mapa': '/app/mapa',
    '/editmap': '/app/mapa'
  };

  var appRoute = routeMap[path] || '';
  var query = window.location.search || '';
  var hash = window.location.hash || '';

  if (path === '/gestion') {
    var tab = new URLSearchParams(window.location.search).get('tab');
    if (tab) appRoute = '/app/admin?tab=' + encodeURIComponent(tab);
  }

  function shouldForceLegacy() {
    try {
      return localStorage.getItem('mex.legacy.force') === '1';
    } catch (_) {
      return false;
    }
  }

  function shouldAutoRedirect() {
    if (shouldForceLegacy()) return false;
    if (path === '/home') return true;
    if (path === '/profile') return true;
    if (path === '/mensajes') return true;
    if (path === '/cola-preparacion') return true;
    if (path === '/incidencias') return true;
    return false;
  }

  document.body.classList.add('legacy-fallback-view', 'app-shell-ready', 'legacy-content-only', 'legacy-fallback-view');

  var routeProfile = {
    '/home': { hideChrome: true, hideSelectors: [] },
    '/profile': { hideChrome: true, hideSelectors: [] },
    '/mensajes': { hideChrome: true, hideSelectors: ['#chat-contacts-view .chatv2-panel-header button[title="Volver al mapa"]'] },
    '/cola-preparacion': { hideChrome: true, hideSelectors: ['.prep-nav-link[href="/mapa"]', '.prep-nav-link[href="/gestion"]'] },
    '/incidencias': { hideChrome: true, hideSelectors: [] },
    '/cuadre': { hideChrome: true, hideSelectors: [] },
    '/gestion': { hideChrome: false, hideSelectors: [] }, // requiere sidebar interna para navegación funcional
    '/programador': { hideChrome: true, hideSelectors: [] },
    '/mapa': { hideChrome: false, hideSelectors: [] }, // no tocar chrome operativo del mapa legacy
    '/editmap': { hideChrome: false, hideSelectors: [] },
    '/solicitud': { hideChrome: true, hideSelectors: [] }
  };
  var current = routeProfile[path] || { hideChrome: true, hideSelectors: [] };

  if (current.hideChrome) {
    document.body.classList.add('legacy-chrome-disabled');
    ['#admin-sidebar', '#topbar', '#legacySidebar', '#legacyHeader', '.legacy-topbar', '.legacy-sidebar'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    });
  }

  (current.hideSelectors || []).forEach(function (sel) {
    var node = document.querySelector(sel);
    if (node) node.style.display = 'none';
  });

  var style = document.createElement('style');
  style.textContent = [
    'body.legacy-content-only{padding-left:0 !important;margin-left:0 !important;}',
    'body.legacy-content-only #routeMainStage, body.legacy-content-only #homeApp, body.legacy-content-only #programmerApp, body.legacy-content-only #incidenciasApp{padding-left:0 !important;margin-left:0 !important;max-width:none !important;}',
    'body.legacy-content-only .shell-main-stage, body.legacy-content-only .cfg-v2-main, body.legacy-content-only .editmap-route-shell{margin-left:0 !important;padding-left:0 !important;}',
    'body.legacy-content-only.legacy-chrome-disabled .cfg-v2-sidebar, body.legacy-content-only.legacy-chrome-disabled .shell-sidebar-surface{display:none !important;}',
    'body.legacy-content-only.legacy-chrome-disabled .cfg-v2-body{grid-template-columns:minmax(0,1fr) !important;}',
    'body.legacy-content-only.legacy-chrome-disabled .cfg-v2-hero{padding-right:12px !important;}',
    '#legacyAppShellBanner{position:fixed;right:12px;bottom:12px;z-index:9999;display:inline-flex;align-items:center;gap:8px;background:#0f172a;color:#fff;border:1px solid rgba(255,255,255,.18);padding:9px 12px;border-radius:10px;font:700 12px Inter,sans-serif;text-decoration:none;box-shadow:0 8px 24px rgba(2,6,23,.32);max-width:calc(100vw - 24px);}',
    '#legacyAppShellBanner .mat{font-family:"Material Symbols Outlined";font-size:16px;line-height:1;}',
    '@media (max-width:480px){#legacyAppShellBanner{left:10px;right:10px;justify-content:center;}}'
  ].join('');
  document.head.appendChild(style);

  if (!appRoute) return;
  if (shouldAutoRedirect()) {
    window.location.replace(appRoute + query + hash);
    return;
  }
  var banner = document.createElement('a');
  banner.id = 'legacyAppShellBanner';
  var isForcedOperationalLegacy = shouldForceLegacy() && (path === '/mensajes' || path === '/cola-preparacion' || path === '/incidencias');
  banner.href = isForcedOperationalLegacy ? (appRoute + query + hash) : appRoute;
  if (isForcedOperationalLegacy) {
    banner.innerHTML = '<span class="mat">info</span><span>Estás en legacy · Abrir App Shell</span>';
  } else {
    banner.innerHTML = '<span class="mat">open_in_new</span><span>Abrir en App Shell</span>';
  }
  document.body.appendChild(banner);
})();
