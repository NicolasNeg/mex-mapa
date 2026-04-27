// ═══════════════════════════════════════════════════════════
//  /js/shell/sidebar.js
//  Componente sidebar global — expandible, submenús, mobile drawer.
//  Fase 1: componente standalone, sin cambiar la navegación actual.
// ═══════════════════════════════════════════════════════════

import { filterNavForRole, ROLE_LABELS } from './navigation.config.js';

const COLLAPSED_KEY = 'mex.shell.sidebar.collapsed.v2';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeRoutePath(route = '') {
  const [path] = String(route).split('?');
  return path.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
}

export class ShellSidebar {
  /**
   * @param {object} options
   * @param {string}  options.role         - Rol del usuario ('AUXILIAR', 'SUPERVISOR', etc.)
   * @param {object}  options.profile      - Objeto de perfil del usuario
   * @param {string}  options.currentRoute - Ruta activa al montar
   * @param {string}  options.company      - Nombre de la empresa para el logo
   * @param {function} options.onNavigate  - Callback(route) al hacer click en un item
   * @param {function} options.onLogout    - Callback al hacer click en "Cerrar sesión"
   */
  constructor(options = {}) {
    this._role         = options.role        || 'AUXILIAR';
    this._profile      = options.profile     || {};
    this._currentRoute = options.currentRoute || '/home';
    this._company      = options.company     || 'MAPA';
    this._onNavigate   = options.onNavigate  || null;
    this._onLogout     = options.onLogout    || null;

    this._collapsed    = this._readCollapsed();
    this._mobileOpen   = false;
    this._openSubmenus = new Set();

    this._el      = null;
    this._overlay = null;

    // Auto-open submenu whose child is active on load
    this._syncOpenSubmenus();
  }

  // ── Private helpers ─────────────────────────────────────

  _readCollapsed() {
    try {
      const v = localStorage.getItem(COLLAPSED_KEY);
      if (v !== null) return v === '1';
    } catch (_) {}
    // Default: compact on tablet, expanded on desktop/TV
    const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
    return w >= 768 && w < 1024;
  }

  _writeCollapsed(val) {
    this._collapsed = val;
    try { localStorage.setItem(COLLAPSED_KEY, val ? '1' : '0'); } catch (_) {}
  }

  _syncOpenSubmenus() {
    const navGroups = filterNavForRole(this._role);
    const currentPath = normalizeRoutePath(this._currentRoute);
    navGroups.forEach(group => {
      group.items.forEach(item => {
        if (Array.isArray(item.children)) {
          const childActive = item.children.some(
            child => normalizeRoutePath(child.route) === currentPath
          );
          if (childActive) this._openSubmenus.add(item.id);
        }
      });
    });
  }

  _isItemActive(route) {
    return normalizeRoutePath(route) === normalizeRoutePath(this._currentRoute);
  }

  _isAnyChildActive(item) {
    return Array.isArray(item.children) && item.children.some(c => this._isItemActive(c.route));
  }

  _roleLabel() {
    return ROLE_LABELS[this._role] || this._role;
  }

  _userName() {
    const p = this._profile;
    return p.nombreCompleto || p.displayName || p.nombre || p.email || 'Usuario';
  }

  // ── HTML builders ───────────────────────────────────────

  _buildNavItemHTML(item) {
    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
    const isActive    = this._isItemActive(item.route) || this._isAnyChildActive(item);
    const isOpen      = this._openSubmenus.has(item.id);
    const cls = ['mex-nav-item', isActive ? 'active' : '', hasChildren && isOpen ? 'submenu-open' : ''].filter(Boolean).join(' ');

    const attrs = hasChildren
      ? `data-submenu-toggle="${esc(item.id)}"`
      : `data-route="${esc(item.route)}"`;

    return `
      <div class="${cls}"
           ${attrs}
           data-nav-id="${esc(item.id)}"
           data-tooltip="${esc(item.label)}"
           role="menuitem" tabindex="0">
        <span class="mex-nav-item-icon">${esc(item.icon)}</span>
        <span class="mex-nav-item-label">${esc(item.label)}</span>
        ${item.badge ? `<span class="mex-nav-item-badge">${esc(item.badge)}</span>` : ''}
        ${hasChildren ? `<span class="mex-nav-item-arrow">chevron_right</span>` : ''}
      </div>
      ${hasChildren ? `
        <div class="mex-submenu${isOpen ? ' open' : ''}" id="mex-submenu-${esc(item.id)}">
          ${item.children.map(child => `
            <div class="mex-submenu-item${this._isItemActive(child.route) ? ' active' : ''}"
                 data-route="${esc(child.route)}"
                 role="menuitem" tabindex="0">
              ${esc(child.label)}
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
  }

  _buildHTML() {
    const groups    = filterNavForRole(this._role);
    const userName  = this._userName();
    const roleLabel = this._roleLabel();
    const avatarUrl = this._profile.avatarUrl || this._profile.photoURL || this._profile.fotoURL || '';

    return `
      <div class="mex-sidebar-logo">
        <div class="mex-sidebar-logo-mark">M</div>
        <div class="mex-sidebar-logo-text">
          <h2>${esc(this._company)}</h2>
          <p>${esc(roleLabel)}</p>
        </div>
      </div>

      <nav class="mex-sidebar-nav" role="menu" aria-label="Navegación principal">
        ${groups.map(group => `
          <div class="mex-nav-group" role="group" aria-label="${esc(group.label)}">
            <div class="mex-nav-group-label">${esc(group.label)}</div>
            ${group.items.map(item => this._buildNavItemHTML(item)).join('')}
          </div>
        `).join('')}
      </nav>

      <div class="mex-sidebar-footer">
        <div class="mex-profile-item" data-action="profile" role="button" tabindex="0" title="Mi perfil">
          <div class="mex-profile-avatar">
            ${avatarUrl
              ? `<img src="${esc(avatarUrl)}" alt="${esc(userName)}" loading="lazy">`
              : `<span class="mex-profile-avatar-icon">shield_person</span>`}
          </div>
          <div class="mex-profile-info">
            <div class="mex-profile-info-name">${esc(userName)}</div>
            <div class="mex-profile-info-role">${esc(roleLabel)}</div>
          </div>
        </div>
        <div class="mex-logout-item" data-action="logout" role="button" tabindex="0">
          <span class="mex-logout-icon">logout</span>
          <span class="mex-logout-label">Cerrar sesión</span>
        </div>
      </div>

      <div class="mex-sidebar-collapse-row">
        <button class="mex-collapse-btn"
                data-action="collapse"
                title="${this._collapsed ? 'Expandir menú' : 'Colapsar menú'}"
                aria-label="${this._collapsed ? 'Expandir menú' : 'Colapsar menú'}">
          chevron_left
        </button>
      </div>
    `;
  }

  // ── Event binding ───────────────────────────────────────

  _bind() {
    if (!this._el) return;
    this._el.addEventListener('click', this._handleClick.bind(this));
    this._el.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        const t = event.target.closest('[data-route],[data-submenu-toggle],[data-action]');
        if (t) { event.preventDefault(); t.click(); }
      }
    });
  }

  _handleClick(event) {
    const target = event.target.closest('[data-route],[data-submenu-toggle],[data-action]');
    if (!target) return;

    const route       = target.dataset.route;
    const submenuId   = target.dataset.submenuToggle;
    const action      = target.dataset.action;

    if (route) {
      event.preventDefault();
      if (!this._isDesktop()) this.closeMobileDrawer();
      this._navigate(route);
      return;
    }

    if (submenuId) {
      event.preventDefault();
      this._toggleSubmenu(submenuId);
      return;
    }

    if (action === 'collapse') {
      event.preventDefault();
      this.toggleCollapse();
      return;
    }

    if (action === 'profile') {
      event.preventDefault();
      if (!this._isDesktop()) this.closeMobileDrawer();
      this._navigate('/profile');
      return;
    }

    if (action === 'logout') {
      event.preventDefault();
      if (!this._isDesktop()) this.closeMobileDrawer();
      if (typeof this._onLogout === 'function') this._onLogout();
      return;
    }
  }

  _navigate(route) {
    if (typeof this._onNavigate === 'function') {
      this._onNavigate(route);
    } else {
      window.location.href = route;
    }
  }

  _toggleSubmenu(id) {
    const wasOpen = this._openSubmenus.has(id);
    if (wasOpen) { this._openSubmenus.delete(id); } else { this._openSubmenus.add(id); }
    const submenuEl = this._el?.querySelector(`#mex-submenu-${id}`);
    const itemEl    = this._el?.querySelector(`[data-nav-id="${id}"]`);
    if (submenuEl) submenuEl.classList.toggle('open', !wasOpen);
    if (itemEl)    itemEl.classList.toggle('submenu-open', !wasOpen);
  }

  _isDesktop() {
    return typeof window !== 'undefined' && window.innerWidth >= 768;
  }

  _dispatchToggle() {
    window.dispatchEvent(new CustomEvent('mex:sidebar:toggle', {
      detail: { collapsed: this._collapsed }
    }));
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Monta el sidebar dentro de `container`.
   * Crea el overlay para mobile y registra el resize handler.
   */
  mount(container) {
    // Overlay para mobile drawer
    this._overlay = document.createElement('div');
    this._overlay.className = 'mex-drawer-overlay';
    this._overlay.addEventListener('click', () => this.closeMobileDrawer());
    document.body.appendChild(this._overlay);

    // Elemento principal
    this._el = document.createElement('nav');
    this._el.id = 'mexShellSidebar';
    this._el.className = 'mex-sidebar' + (this._collapsed ? ' compact' : '');
    this._el.setAttribute('aria-label', 'Navegación principal');

    this._el.innerHTML = this._buildHTML();
    container.appendChild(this._el);
    this._bind();

    // Resize handler
    this._resizeHandler = () => {
      if (this._isDesktop()) {
        this.closeMobileDrawer();
      }
    };
    window.addEventListener('resize', this._resizeHandler, { passive: true });

    return this;
  }

  /** Actualiza la ruta activa y re-renderiza el estado activo de los items. */
  setRoute(route) {
    this._currentRoute = route;
    this._syncOpenSubmenus();
    if (!this._el) return;
    // Actualiza solo los estados activos sin reconstruir todo el DOM
    this._el.querySelectorAll('[data-route]').forEach(el => {
      const itemRoute = el.dataset.route || '';
      const isActive = this._isItemActive(itemRoute);
      el.classList.toggle('active', isActive);
    });
    this._el.querySelectorAll('[data-nav-id]').forEach(el => {
      const id = el.dataset.navId;
      const navGroups = filterNavForRole(this._role);
      let hasActiveChild = false;
      navGroups.forEach(g => g.items.forEach(item => {
        if (item.id === id && this._isAnyChildActive(item)) hasActiveChild = true;
      }));
      if (hasActiveChild) el.classList.add('active');
    });
    this._el.querySelectorAll('.mex-submenu-item').forEach(el => {
      el.classList.toggle('active', this._isItemActive(el.dataset.route || ''));
    });
  }

  /** Actualiza el perfil y re-renderiza el footer. */
  setProfile(profile, role) {
    this._profile = profile || {};
    if (role) this._role = role;
    if (!this._el) return;
    // Actualiza solo el footer para evitar re-renderizar el nav completo
    const footer = this._el.querySelector('.mex-sidebar-footer');
    if (footer) {
      const userName  = this._userName();
      const roleLabel = this._roleLabel();
      const avatarUrl = this._profile.avatarUrl || this._profile.photoURL || this._profile.fotoURL || '';
      const avatarHTML = avatarUrl
        ? `<img src="${esc(avatarUrl)}" alt="${esc(userName)}" loading="lazy">`
        : `<span class="mex-profile-avatar-icon">shield_person</span>`;
      const nameEl = footer.querySelector('.mex-profile-info-name');
      const roleEl = footer.querySelector('.mex-profile-info-role');
      const avatarEl = footer.querySelector('.mex-profile-avatar');
      if (nameEl) nameEl.textContent = userName;
      if (roleEl) roleEl.textContent = roleLabel;
      if (avatarEl) avatarEl.innerHTML = avatarHTML;
    }
    // Actualizar también el subtítulo del logo
    const logoSub = this._el.querySelector('.mex-sidebar-logo-text p');
    if (logoSub) logoSub.textContent = this._roleLabel();
  }

  collapse() {
    this._writeCollapsed(true);
    this._el?.classList.add('compact');
    this._dispatchToggle();
  }

  expand() {
    this._writeCollapsed(false);
    this._el?.classList.remove('compact');
    this._dispatchToggle();
  }

  toggleCollapse() {
    if (this._collapsed) this.expand(); else this.collapse();
  }

  openMobileDrawer() {
    this._mobileOpen = true;
    this._el?.classList.add('drawer-open');
    this._overlay?.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  closeMobileDrawer() {
    this._mobileOpen = false;
    this._el?.classList.remove('drawer-open');
    this._overlay?.classList.remove('visible');
    document.body.style.overflow = '';
  }

  destroy() {
    this._el?.remove();
    this._overlay?.remove();
    if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
  }

  get element()      { return this._el; }
  get isCollapsed()  { return this._collapsed; }
  get isMobileOpen() { return this._mobileOpen; }
}
