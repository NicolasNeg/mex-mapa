/**
 * Centro Admin — contenido SPA (CONTROLES viven en el sidebar global).
 * Usuarios: nativo LISTAS. Resto: iframe legacy hasta migrar.
 */
import {
  ADMIN_NATIVE_SECTIONS,
  parseAdminRoute,
  adminSectionPath
} from '/js/app/features/admin/admin-nav.js';
import {
  mountUsuariosPanel,
  unmountUsuariosPanel,
  syncUsuariosSelection
} from '/js/app/features/admin/admin-usuarios-panel.js';

const FRAME_ID = 'mex-admin-legacy-frame';
const FRAME_VER = '20260719h';

let _root = null;
let _navigate = null;
let _section = 'usuarios';
let _entityId = '';
let _nativeMounted = false;

function _ensureCss() {
  const href = '/css/app-admin.css?v=20260719h';
  let link = document.querySelector('link[data-app-admin-spa-css="1"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-app-admin-spa-css', '1');
    document.head.appendChild(link);
  } else if (link.getAttribute('href') !== href) {
    link.href = href;
  }
}

function _legacySrc(section, entityId) {
  const params = new URLSearchParams();
  params.set('admin', '1');
  params.set('shell', '1');
  params.set('v', FRAME_VER);
  if (section) params.set('tab', section);
  if (entityId) params.set('entityId', entityId);
  return `/gestion.html?${params.toString()}`;
}

function _injectLegacyCss(frame) {
  try {
    const doc = frame?.contentDocument;
    if (!doc || doc.getElementById('admSpaLegacyHide')) return;
    const style = doc.createElement('style');
    style.id = 'admSpaLegacyHide';
    style.textContent = `
      #cfg-admin-sidebar, .cfg-v2-sidebar { display:none!important; }
      .cfg-v2-body { grid-template-columns:minmax(0,1fr)!important; }
      .cfg-v2-workspace-header, .cfg-v2-tools, #cfg-v2-tools, .admin-metric-ribbon { display:none!important; }
    `;
    doc.head?.appendChild(style);
  } catch (_) { /* cross-origin / not ready */ }
}

function _showLegacy(section, entityId) {
  const native = _root?.querySelector('#adm-native');
  const wrap = _root?.querySelector('#adm-legacy-wrap');
  if (native) native.hidden = true;
  if (wrap) wrap.hidden = false;
  unmountUsuariosPanel();
  _nativeMounted = false;

  let frame = document.getElementById(FRAME_ID);
  if (!frame && wrap) {
    frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.title = 'Admin legacy';
    frame.setAttribute('data-admin-legacy', '1');
    wrap.appendChild(frame);
    frame.addEventListener('load', () => _injectLegacyCss(frame));
  }
  if (!frame) return;
  const want = _legacySrc(section, entityId);
  const cur = String(frame.getAttribute('src') || '');
  if (!cur.includes(`tab=${section}`) || (entityId && !cur.includes(entityId))) {
    frame.src = want;
  } else {
    _injectLegacyCss(frame);
    try {
      frame.contentWindow?.abrirTabConfig?.(section);
    } catch (_) { /* ignore */ }
  }
}

function _showNativeUsuarios(entityId) {
  const native = _root?.querySelector('#adm-native');
  const wrap = _root?.querySelector('#adm-legacy-wrap');
  if (wrap) wrap.hidden = true;
  if (native) native.hidden = false;

  if (!_nativeMounted) {
    mountUsuariosPanel(native, { navigate: _navigate, entityId });
    _nativeMounted = true;
  } else {
    syncUsuariosSelection(entityId);
  }
}

function _applySection(section, entityId) {
  _section = section || 'usuarios';
  _entityId = entityId || '';

  if (ADMIN_NATIVE_SECTIONS.has(_section)) {
    if (_section === 'usuarios') _showNativeUsuarios(_entityId);
  } else {
    _showLegacy(_section, _entityId);
  }
}

function _renderShell() {
  _root.innerHTML = `
    <div class="adm-shell">
      <div class="adm-main">
        <div id="adm-native" class="adm-native" hidden></div>
        <div id="adm-legacy-wrap" class="adm-legacy-wrap" hidden></div>
      </div>
    </div>
  `;
}

/**
 * Soft navigate between admin sections without remounting shell.
 * @returns {boolean}
 */
export function softSync(ctx = {}) {
  if (!_root || !document.body.contains(_root)) return false;
  const path = ctx.state?.currentRoute || window.location.pathname || '';
  const { section, entityId } = parseAdminRoute(path);
  if (_navigate == null && typeof ctx.navigate === 'function') _navigate = ctx.navigate;
  _applySection(section || 'usuarios', entityId);
  return true;
}

export function mount(ctx = {}) {
  _ensureCss();
  _navigate = ctx.navigate || null;
  const container = ctx.container || document.getElementById('mexShellMain');
  if (!container) return;

  // Clear previous absolute frames from old admin.js
  const old = document.getElementById('mex-admin-frame');
  if (old) {
    try { old.remove(); } catch (_) { old.style.display = 'none'; }
  }

  container.innerHTML = '';
  container.style.position = container.style.position || 'relative';
  _root = document.createElement('div');
  _root.id = 'admShellRoot';
  _root.className = 'adm-shell-root';
  container.appendChild(_root);

  const path = ctx.state?.currentRoute || window.location.pathname || '/app/admin/usuarios';
  const parsed = parseAdminRoute(path);
  _section = parsed.section || 'usuarios';
  _entityId = parsed.entityId || '';

  // /app/admin → /app/admin/usuarios
  if (path.replace(/\/$/, '') === '/app/admin') {
    _section = 'usuarios';
    _navigate?.(adminSectionPath('usuarios'), { replace: true });
  }

  _renderShell();
  _applySection(_section, _entityId);
}

export function unmount() {
  unmountUsuariosPanel();
  _nativeMounted = false;
  const frame = document.getElementById(FRAME_ID);
  if (frame) frame.remove();
  if (_root) {
    _root.remove();
    _root = null;
  }
  _navigate = null;
}
