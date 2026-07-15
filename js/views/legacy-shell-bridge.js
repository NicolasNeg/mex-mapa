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
  var params = new URLSearchParams(query || '');
  var redirectQuery = query;
  var legacyParam = params.get('legacy') === '1';
  var embeddedParam = params.get('shell') === '1' || params.get('appStage') === '1';
  var adminEmbeddedRoute = path === '/gestion' || params.get('admin') === '1';
  if (legacyParam && (path === '/mapa' || path === '/cuadre' || path === '/mensajes')) {
    try {
      localStorage.setItem('mex.legacy.force', '1');
    } catch (err) {
      console.warn('[legacy-shell-bridge] no se pudo activar escape clásico', err);
    }
  }
  params.delete('legacy');
  params.delete('shell');
  params.delete('appStage');
  var cleanQuery = params.toString() ? '?' + params.toString() : '';

  if (path === '/gestion') {
    var tab = new URLSearchParams(window.location.search).get('tab');
    if (tab) appRoute = '/app/admin?tab=' + encodeURIComponent(tab);
  }

  if (path === '/mapa' && (params.get('tab') === 'cuadre' || params.get('openCuadre') || params.get('openCuadreV3'))) {
    appRoute = '/app/cuadrarflota';
    params.delete('tab');
    params.delete('openCuadre');
    params.delete('openCuadreV3');
    params.delete('notif');
    if (!params.get('source')) params.set('source', 'mapa-cuadre-legacy');
    redirectQuery = params.toString() ? '?' + params.toString() : '';
  }

  function shouldForceLegacy() {
    try {
      return localStorage.getItem('mex.legacy.force') === '1';
    } catch (err) {
      console.warn('[legacy-shell-bridge] no se pudo leer escape clásico', err);
      return false;
    }
  }

  function shouldAutoRedirect() {
    if (embeddedParam) return false;
    if (legacyParam && (path === '/mapa' || path === '/cuadre' || path === '/mensajes')) return false;
    if (shouldForceLegacy()) return false;
    if (path === '/home') return true;
    if (path === '/profile') return true;
    if (path === '/mensajes') return true;
    if (path === '/cola-preparacion') return true;
    if (path === '/incidencias') return true;
    if (path === '/cuadre') return true;
    if (path === '/mapa') return true;
    return false;
  }

  document.body.classList.add('legacy-fallback-view', 'app-shell-ready', 'legacy-content-only', 'legacy-fallback-view');
  if (embeddedParam) document.body.classList.add('legacy-embedded-stage');
  if (adminEmbeddedRoute) document.body.classList.add('legacy-embedded-admin');

  var routeProfile = {
    '/home': { hideChrome: true, hideSelectors: [] },
    '/profile': { hideChrome: true, hideSelectors: [] },
    '/mensajes': { hideChrome: true, hideSelectors: ['#chat-contacts-view .chatv2-panel-header button[title="Volver al mapa"]'] },
    '/cola-preparacion': { hideChrome: true, hideSelectors: ['.prep-nav-link[href="/mapa"]', '.prep-nav-link[href="/gestion"]'] },
    '/incidencias': { hideChrome: true, hideSelectors: [] },
    '/cuadre': { hideChrome: true, hideSelectors: [] },
    '/gestion': { hideChrome: true, hideSelectors: [] },
    '/programador': { hideChrome: true, hideSelectors: [] },
    '/mapa': { hideChrome: true, hideSelectors: [] },
    '/editmap': { hideChrome: true, hideSelectors: [] }
  };
  var current = routeProfile[path] || { hideChrome: true, hideSelectors: [] };
  var mapaCuadreTab = path === '/mapa' && params.get('tab') === 'cuadre';
  if (mapaCuadreTab) {
    document.body.classList.add('legacy-mapa-cuadre-tab', 'legacy-map-content-only', 'legacy-cuadre-content-only');
  }

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
    'body.legacy-content-only.legacy-chrome-disabled:not(.legacy-embedded-admin) .cfg-v2-sidebar, body.legacy-content-only.legacy-chrome-disabled:not(.legacy-embedded-admin) .shell-sidebar-surface{display:none !important;}',
    'body.legacy-content-only.legacy-chrome-disabled:not(.legacy-embedded-admin) .cfg-v2-body{grid-template-columns:minmax(0,1fr) !important;}',
    'body.legacy-content-only.legacy-chrome-disabled .cfg-v2-hero{padding-right:12px !important;}',
    'body.legacy-embedded-stage{overflow:hidden !important;}',
    'body.legacy-embedded-stage #legacyAppShellBanner{display:none !important;}',
    'body.legacy-embedded-stage #routeSidebarHost, body.legacy-embedded-stage #routeTopbarHost, body.legacy-embedded-stage #homeSidebar, body.legacy-embedded-stage .shell-topbar-surface{display:none !important;}',
    'body.legacy-embedded-stage #routeShellLayout{min-height:100vh !important;}',
    'body.legacy-embedded-stage #routeMainStage, body.legacy-embedded-stage .shell-main-stage, body.legacy-embedded-stage .shell-main-offset{margin-left:0 !important;width:100% !important;max-width:none !important;padding-top:0 !important;min-height:100vh !important;}',
    'body.legacy-embedded-stage #homeApp, body.legacy-embedded-stage #cuadreApp, body.legacy-embedded-stage #colaApp, body.legacy-embedded-stage #programmerApp, body.legacy-embedded-stage #incidenciasApp{min-height:100vh !important;}',
    'body.legacy-embedded-stage .gestion-back-btn, body.legacy-embedded-stage #cfg-sidebar-pin{display:none !important;}',
    'body.legacy-embedded-stage:not(.legacy-embedded-admin) .cfg-v2-sidebar{display:none !important;}',
    'body.legacy-embedded-stage:not(.legacy-embedded-admin) .cfg-v2-body{grid-template-columns:minmax(0,1fr) !important;}',
    'body.legacy-embedded-stage:not(.legacy-embedded-admin) .cfg-v2-hero{display:none !important;}',
    'body.legacy-embedded-stage .chatv2-header{display:none !important;}',
    'body.legacy-embedded-stage #buzon-modal{height:100vh !important;min-height:100vh !important;}',
    'body.legacy-embedded-stage .chatv2-close, body.legacy-embedded-stage button[title="Volver al mapa"]{display:none !important;}',
    'body.legacy-embedded-stage .badge-pro{display:none !important;}',
    'body.legacy-embedded-stage .fleet-header-top button[onclick*="/mapa"]{display:none !important;}',
    'body.legacy-mapa-cuadre-tab #admin-sidebar, body.legacy-mapa-cuadre-tab #topbar, body.legacy-mapa-cuadre-tab #legacySidebar, body.legacy-mapa-cuadre-tab #legacyHeader, body.legacy-mapa-cuadre-tab .legacy-sidebar, body.legacy-mapa-cuadre-tab .legacy-topbar{display:none !important;}',
    'body.legacy-map-content-only #admin-sidebar, body.legacy-map-content-only #topbar, body.legacy-map-content-only #legacySidebar, body.legacy-map-content-only #legacyHeader, body.legacy-map-content-only .legacy-sidebar, body.legacy-map-content-only .legacy-topbar{display:none !important;}',
    'body.legacy-map-content-only, body.legacy-map-content-only #routeMainStage, body.legacy-map-content-only .shell-main-stage{margin-left:0 !important;padding-left:0 !important;max-width:none !important;}',
    'body.legacy-mapa-cuadre-tab, body.legacy-mapa-cuadre-tab #routeMainStage, body.legacy-mapa-cuadre-tab .shell-main-stage{margin-left:0 !important;padding-left:0 !important;max-width:none !important;}',
    'body.legacy-mapa-cuadre-tab .main-content, body.legacy-mapa-cuadre-tab main{margin-left:0 !important;padding-left:0 !important;}',
    '#legacyAppShellBanner{position:fixed;right:12px;bottom:12px;z-index:9999;display:inline-flex;align-items:center;gap:8px;background:#0f172a;color:#fff;border:1px solid rgba(255,255,255,.18);padding:9px 12px;border-radius:10px;font:700 12px Inter,sans-serif;text-decoration:none;box-shadow:0 8px 24px rgba(2,6,23,.32);max-width:calc(100vw - 24px);}',
    '#legacyAppShellBanner .mat{font-family:"Material Symbols Outlined";font-size:16px;line-height:1;}',
    '@media (max-width:480px){#legacyAppShellBanner{left:10px;right:10px;justify-content:center;}}'
  ].join('');
  document.head.appendChild(style);

  if (!appRoute) return;
  if (shouldAutoRedirect()) {
    window.location.replace(appRoute + redirectQuery + hash);
    return;
  }
  if (embeddedParam) return;
  var banner = document.createElement('a');
  banner.id = 'legacyAppShellBanner';
  var isForcedOperationalLegacy = shouldForceLegacy() && (path === '/home' || path === '/profile' || path === '/mensajes' || path === '/cola-preparacion' || path === '/incidencias' || path === '/cuadre' || path === '/mapa');
  banner.href = isForcedOperationalLegacy ? (appRoute + cleanQuery + hash) : appRoute;
  if (isForcedOperationalLegacy && path === '/mapa') {
    banner.innerHTML = '<span class="mat">info</span><span>Estás en mapa clásico · Abrir mapa operativo</span>';
  } else if (isForcedOperationalLegacy && path === '/cuadre') {
    banner.innerHTML = '<span class="mat">info</span><span>Estás en cuadre clásico · Abrir cuadre operativo</span>';
  } else if (isForcedOperationalLegacy && path === '/mensajes') {
    banner.innerHTML = '<span class="mat">info</span><span>Estás en mensajes clásico · Abrir mensajes operativo</span>';
  } else if (isForcedOperationalLegacy) {
    banner.innerHTML = '<span class="mat">info</span><span>Estás en vista clásica · Abrir App Shell</span>';
  } else {
    banner.innerHTML = '<span class="mat">open_in_new</span><span>Abrir en App Shell</span>';
  }
  document.body.appendChild(banner);
})();
