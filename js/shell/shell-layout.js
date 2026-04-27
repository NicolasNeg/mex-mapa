// ═══════════════════════════════════════════════════════════
//  /js/shell/shell-layout.js
//  Ensamblador del App Shell: sidebar + header + main outlet.
//  Fase 1: componente standalone. No cambia la navegación actual.
//
//  Uso mínimo:
//    import { ShellLayout } from '/js/shell/shell-layout.js';
//    const shell = new ShellLayout();
//    await shell.mount({ container: document.body, profile, role, currentRoute });
//    // El contenido dinámico va en shell.contentEl
// ═══════════════════════════════════════════════════════════

import { ShellSidebar } from './sidebar.js';
import { ShellHeader }  from './header.js';

export class ShellLayout {
  constructor() {
    this._sidebar = null;
    this._header  = null;
    this._mainEl  = null;
    this._contentEl = null;
    this._containerEl = null;
  }

  /**
   * Monta sidebar + header + área de contenido.
   *
   * @param {object} options
   * @param {HTMLElement} options.container      - Elemento padre donde montar (default: document.body)
   * @param {object}  options.profile            - Perfil del usuario
   * @param {string}  options.role               - Rol del usuario
   * @param {string}  options.currentRoute       - Ruta activa
   * @param {string}  options.company            - Nombre de empresa (logo)
   * @param {function} options.onNavigate        - Callback(route) de navegación
   * @param {function} options.onLogout          - Callback de logout
   * @param {function} options.onBellClick       - Callback de campana
   * @param {string}  options.mainClass          - Clase CSS adicional para el main
   */
  mount({
    container    = document.body,
    profile      = {},
    role         = 'AUXILIAR',
    currentRoute = '/home',
    company      = 'MAPA',
    currentPlaza = '',
    availablePlazas = [],
    canSwitchPlaza = false,
    onNavigate   = null,
    onLogout     = null,
    onBellClick  = null,
    onPlazaChange = null,
    onSearchInput = null,
    mainClass    = ''
  } = {}) {
    this._containerEl = container;
    container.classList.add('mex-shell');

    // ── Sidebar ────────────────────────────────────────────
    const sidebarWrap = document.createElement('div');
    sidebarWrap.id = 'mexSidebarWrap';
    container.appendChild(sidebarWrap);

    this._sidebar = new ShellSidebar({
      role,
      profile,
      currentRoute,
      company,
      onNavigate: route => {
        if (typeof onNavigate === 'function') onNavigate(route);
        else window.location.href = route;
      },
      onLogout: () => {
        if (typeof onLogout === 'function') onLogout();
      }
    });
    this._sidebar.mount(sidebarWrap);

    // ── Header ─────────────────────────────────────────────
    const headerWrap = document.createElement('div');
    headerWrap.id = 'mexHeaderWrap';
    container.appendChild(headerWrap);

    this._header = new ShellHeader({
      profile,
      role,
      currentRoute,
      currentPlaza,
      availablePlazas,
      canSwitchPlaza,
      onMenuToggle: () => {
        if (window.innerWidth < 768) {
          this._sidebar.isMobileOpen
            ? this._sidebar.closeMobileDrawer()
            : this._sidebar.openMobileDrawer();
        } else {
          this._sidebar.toggleCollapse();
        }
      },
      onBellClick,
      onPlazaChange: plaza => {
        if (typeof onPlazaChange === 'function') onPlazaChange(plaza);
      },
      onSearchInput: payload => {
        if (typeof onSearchInput === 'function') onSearchInput(payload);
      }
    });
    this._header.mount(headerWrap);

    // ── Main outlet ────────────────────────────────────────
    this._mainEl = document.createElement('main');
    this._mainEl.id = 'mexShellMain';
    this._mainEl.className = ['mex-main', mainClass].filter(Boolean).join(' ');
    container.appendChild(this._mainEl);

    this._contentEl = document.createElement('div');
    this._contentEl.id = 'mexShellContent';
    this._mainEl.appendChild(this._contentEl);

    // ── Sync compact class on container ────────────────────
    const syncCompact = ({ detail }) => {
      container.classList.toggle('sidebar-compact', !!detail?.collapsed);
    };
    window.addEventListener('mex:sidebar:toggle', syncCompact);
    // Apply initial state
    if (this._sidebar.isCollapsed) container.classList.add('sidebar-compact');

    return this;
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Actualiza la ruta activa en sidebar + header.
   * Llamar esto cada vez que el router interno cambie de página.
   */
  setRoute(route) {
    this._sidebar?.setRoute(route);
    this._header?.setRoute(route);
    this._header?.setSearchPlaceholder();
  }

  /**
   * Actualiza perfil y rol en sidebar + header.
   * Útil cuando el usuario cambia de cuenta o sus datos se actualizan.
   */
  setProfile(profile, role) {
    this._sidebar?.setProfile(profile, role);
    this._header?.setProfile(profile, role);
  }

  /** Muestra/oculta el badge de notificaciones. */
  setBellBadge(visible) {
    this._header?.setBellBadge(visible);
  }

  setPlaza(currentPlaza = '', availablePlazas = [], canSwitchPlaza = false) {
    this._header?.setPlaza(currentPlaza, availablePlazas, canSwitchPlaza);
  }

  setSearchValue(value = '') {
    this._header?.setSearchValue(value);
  }

  /** Destruye el shell y libera listeners. */
  destroy() {
    this._sidebar?.destroy();
    this._header?.destroy();
    this._mainEl?.remove();
    this._containerEl?.classList.remove('mex-shell', 'sidebar-compact');
  }

  // ── Accessors ───────────────────────────────────────────
  get mainEl()    { return this._mainEl; }
  get contentEl() { return this._contentEl; }
  get sidebar()   { return this._sidebar; }
  get header()    { return this._header; }
}
