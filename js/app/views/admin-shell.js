/**
 * Centro Admin — contenido SPA (CONTROLES viven en el sidebar global).
 * LISTAS + OPCIONES operación nativas. Plazas/Ubicaciones/Empresa: iframe.
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
import {
  mountChoferesPanel,
  unmountChoferesPanel,
  syncChoferesSelection
} from '/js/app/features/admin/admin-choferes-panel.js';
import {
  mountRolesPanel,
  unmountRolesPanel,
  syncRolesSelection
} from '/js/app/features/admin/admin-roles-panel.js';
import {
  mountSolicitudesPanel,
  unmountSolicitudesPanel,
  syncSolicitudesSelection
} from '/js/app/features/admin/admin-solicitudes-panel.js';
import {
  mountOpcionesPanel,
  unmountOpcionesPanel,
  syncOpcionesSelection
} from '/js/app/features/admin/admin-opciones-panel.js';
import { OPCIONES_SECTIONS } from '/js/app/features/admin/admin-opciones-data.js';

const FRAME_ID = 'mex-admin-legacy-frame';
const FRAME_VER = '20260719k';

let _root = null;
let _navigate = null;
let _section = 'usuarios';
let _entityId = '';
let _nativeSection = '';

function _ensureCss() {
  const href = '/css/app-admin.css?v=20260719k';
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

/** CSS inyectado: debe ganar a app-admin-chrome (misma especificidad ID+clase). */
const LEGACY_SHELL_CSS = `
  #modal-config-global.admin-registry #cfg-admin-sidebar,
  #modal-config-global.admin-registry .cfg-v2-sidebar,
  #modal-config-global.admin-registry .cfg-v2-sidebar.shell-sidebar-surface {
    display: none !important;
  }
  #modal-config-global.admin-registry .cfg-v2-body,
  #modal-config-global.admin-registry .cfg-v2-body:has(#cfg-admin-sidebar.is-pinned),
  #modal-config-global.admin-registry .cfg-v2-body:has(.cfg-v2-sidebar.is-pinned) {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) !important;
  }
  #modal-config-global.admin-registry .cfg-v2-main,
  #modal-config-global.admin-registry .cfg-v2-main.shell-main-stage {
    grid-column: 1 / -1 !important;
    width: 100% !important;
    max-width: none !important;
    min-width: 0 !important;
  }
  #modal-config-global.admin-registry .cfg-v2-workspace-header,
  #modal-config-global.admin-registry .cfg-v2-tools,
  #modal-config-global.admin-registry #cfg-v2-tools,
  #modal-config-global.admin-registry .admin-metric-ribbon {
    display: none !important;
  }
  #modal-config-global.admin-registry .admin-tray-shell,
  #modal-config-global.admin-registry #cfg-lista-items,
  #modal-config-global.admin-registry .cfg-v2-list,
  #modal-config-global.admin-registry .um-workspace,
  #modal-config-global.admin-registry .um-workspace-lite,
  #modal-config-global.admin-registry .um-workspace-shell,
  #modal-config-global.admin-registry .um-workspace-shell-lite {
    width: 100% !important;
    max-width: none !important;
  }
  #modal-config-global.admin-registry,
  #modal-config-global.admin-registry * {
    user-select: text !important;
    -webkit-user-select: text !important;
  }
  #modal-config-global.admin-registry button,
  #modal-config-global.admin-registry .cfg-tab,
  #modal-config-global.admin-registry .um-card,
  #modal-config-global.admin-registry .cfg-item {
    user-select: none !important;
    -webkit-user-select: none !important;
  }
`;

function _injectLegacyCss(frame) {
  try {
    const doc = frame?.contentDocument;
    if (!doc) return;
    let style = doc.getElementById('admSpaLegacyHide');
    if (!style) {
      style = doc.createElement('style');
      style.id = 'admSpaLegacyHide';
      doc.head?.appendChild(style);
    }
    style.textContent = LEGACY_SHELL_CSS;
  } catch (_) { /* cross-origin / not ready */ }
}

function _unmountNative() {
  unmountUsuariosPanel();
  unmountChoferesPanel();
  unmountRolesPanel();
  unmountSolicitudesPanel();
  unmountOpcionesPanel();
  _nativeSection = '';
}

function _showLegacy(section, entityId) {
  const native = _root?.querySelector('#adm-native');
  const wrap = _root?.querySelector('#adm-legacy-wrap');
  if (native) native.hidden = true;
  if (wrap) wrap.hidden = false;
  _unmountNative();

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

function _showNative(section, entityId) {
  const native = _root?.querySelector('#adm-native');
  const wrap = _root?.querySelector('#adm-legacy-wrap');
  if (wrap) wrap.hidden = true;
  if (native) native.hidden = false;

  if (_nativeSection && _nativeSection !== section) {
    _unmountNative();
  }

  // OPCIONES: un solo panel reutilizable por sección de catálogo
  if (OPCIONES_SECTIONS.has(section)) {
    if (_nativeSection !== section) {
      mountOpcionesPanel(native, { navigate: _navigate, entityId, section });
      _nativeSection = section;
    } else {
      syncOpcionesSelection(entityId, section);
    }
    return;
  }

  const mountMap = {
    usuarios: { mount: mountUsuariosPanel, sync: syncUsuariosSelection },
    choferes: { mount: mountChoferesPanel, sync: syncChoferesSelection },
    roles: { mount: mountRolesPanel, sync: syncRolesSelection },
    solicitudes: { mount: mountSolicitudesPanel, sync: syncSolicitudesSelection }
  };
  const entry = mountMap[section];
  if (!entry) return;

  if (_nativeSection !== section) {
    entry.mount(native, { navigate: _navigate, entityId });
    _nativeSection = section;
  } else {
    entry.sync(entityId);
  }
}

function _applySection(section, entityId) {
  _section = section || 'usuarios';
  _entityId = entityId || '';

  if (ADMIN_NATIVE_SECTIONS.has(_section)) {
    _showNative(_section, _entityId);
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

  if (path.replace(/\/$/, '') === '/app/admin') {
    _section = 'usuarios';
    _navigate?.(adminSectionPath('usuarios'), { replace: true });
  }

  _renderShell();
  _applySection(_section, _entityId);
}

export function unmount() {
  _unmountNative();
  const frame = document.getElementById(FRAME_ID);
  if (frame) frame.remove();
  if (_root) {
    _root.remove();
    _root = null;
  }
  _navigate = null;
}
