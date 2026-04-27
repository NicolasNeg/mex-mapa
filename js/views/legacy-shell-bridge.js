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
    '/programador': '/app/programador'
  };

  var appRoute = routeMap[path];
  if (!appRoute) return;

  if (path === '/gestion') {
    var tab = new URLSearchParams(window.location.search).get('tab');
    if (tab) appRoute = '/app/admin?tab=' + encodeURIComponent(tab);
  }

  document.body.classList.add('legacy-fallback-view', 'app-shell-ready', 'legacy-chrome-disabled');

  // Neutralización no destructiva de chrome legacy frecuente.
  ['#admin-sidebar', '#topbar', '#legacySidebar', '#legacyHeader'].forEach(function (sel) {
    var el = document.querySelector(sel);
    if (el) el.style.display = 'none';
  });

  var style = document.createElement('style');
  style.textContent = [
    'body.legacy-fallback-view{padding-left:0 !important;}',
    'body.legacy-fallback-view #routeMainStage{padding-left:0 !important;margin-left:0 !important;}',
    '#legacyAppShellBanner{position:fixed;right:12px;bottom:12px;z-index:9999;display:inline-flex;align-items:center;gap:8px;background:#0f172a;color:#fff;border:1px solid rgba(255,255,255,.18);padding:9px 12px;border-radius:10px;font:700 12px Inter,sans-serif;text-decoration:none;box-shadow:0 8px 24px rgba(2,6,23,.32);max-width:calc(100vw - 24px);}',
    '#legacyAppShellBanner .mat{font-family:"Material Symbols Outlined";font-size:16px;line-height:1;}',
    '@media (max-width:480px){#legacyAppShellBanner{left:10px;right:10px;justify-content:center;}}'
  ].join('');
  document.head.appendChild(style);

  var banner = document.createElement('a');
  banner.id = 'legacyAppShellBanner';
  banner.href = appRoute;
  banner.innerHTML = '<span class="mat">open_in_new</span><span>Abrir en App Shell</span>';
  document.body.appendChild(banner);
})();
