// ═══════════════════════════════════════════════════════════
//  /js/shell/sidebar.js
//  Componente sidebar global — expandible, submenús, mobile drawer.
//  Fase 1: componente standalone, sin cambiar la navegación actual.
// ═══════════════════════════════════════════════════════════

import { filterNavForRole, ROLE_LABELS, hasNavAccess } from './navigation.config.js';
import { getAdminShellNavGroups, isAdminAppRoute } from '/js/app/features/admin/admin-nav.js';

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

function normalizeRouteFull(route = '') {
  const raw = String(route || '');
  const [path, query = ''] = raw.split('?');
  const normalizedPath = path.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  return query ? `${normalizedPath}?${query}` : normalizedPath;
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
    this._adminMode    = isAdminAppRoute(this._currentRoute);

    this._el      = null;
    this._overlay = null;

    // Auto-open submenu whose child is active on load
    this._syncOpenSubmenus();
  }

  _navGroups() {
    if (this._adminMode) {
      return getAdminShellNavGroups()
        .map(group => ({
          ...group,
          items: group.items.filter(item => hasNavAccess(this._role, item.roles))
        }))
        .filter(group => group.items.length > 0);
    }
    return filterNavForRole(this._role);
  }

  // ── Private helpers ─────────────────────────────────────

  _readCollapsed() {
    try {
      const v = localStorage.getItem(COLLAPSED_KEY);
      if (v !== null) return v === '1';
    } catch (_) {}
    // ≤1024px el sidebar es drawer (abre completo con labels) → no compact.
    // >1024px expandido por defecto.
    return false;
  }

  _writeCollapsed(val) {
    this._collapsed = val;
    try { localStorage.setItem(COLLAPSED_KEY, val ? '1' : '0'); } catch (_) {}
  }

  _syncOpenSubmenus() {
    const navGroups = this._navGroups();
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
    const targetFull = normalizeRouteFull(route);
    const currentFull = normalizeRouteFull(this._currentRoute);
    if (targetFull.includes('?')) return targetFull === currentFull;
    const targetPath = normalizeRoutePath(route);
    const currentPath = normalizeRoutePath(this._currentRoute);
    if (targetPath === currentPath) return true;
    // En modo admin: /app/admin/usuarios activo también con /app/admin/usuarios/:id
    if (this._adminMode && targetPath.startsWith('/app/admin/')) {
      const section = targetPath.slice('/app/admin/'.length).split('/')[0];
      if (section && (currentPath === targetPath || currentPath.startsWith(`${targetPath}/`))) {
        return true;
      }
    }
    // Fuera de admin: item "Panel admin" activo en cualquier /app/admin/*
    if (
      !this._adminMode
      && (targetPath === '/app/admin' || targetPath === '/app/admin/usuarios')
      && (currentPath === '/app/admin' || currentPath.startsWith('/app/admin/') || currentPath === '/gestion')
    ) {
      return true;
    }
    return false;
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
      ? `data-submenu-toggle="${esc(item.id)}"${item.route ? ` data-route="${esc(item.route)}"` : ''}`
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
    const groups    = this._navGroups();
    const userName  = this._userName();
    const roleLabel = this._roleLabel();
    const avatarUrl = this._profile.avatarUrl || this._profile.photoURL || this._profile.fotoURL || '';
    const modeLabel = this._adminMode ? 'Panel admin' : roleLabel;

    return `
      <div class="mex-sidebar-logo">
        <div class="mex-sidebar-logo-mark">M</div>
        <div class="mex-sidebar-logo-text">
          <h2>${esc(this._company)}</h2>
          <p>${esc(modeLabel)}</p>
        </div>
        <button class="mex-sidebar-close" data-action="close-drawer" type="button" aria-label="Cerrar menú">
          <span class="material-icons">close</span>
        </button>
      </div>

      <nav class="mex-sidebar-nav" role="menu" aria-label="${this._adminMode ? 'Controles admin' : 'Navegación principal'}">
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

    if (route && submenuId) {
      event.preventDefault();
      this._toggleSubmenu(submenuId);
      if (!this._isDesktop()) this.closeMobileDrawer();
      this._navigate(route);
      return;
    }

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

    if (action === 'close-drawer') {
      event.preventDefault();
      this.closeMobileDrawer();
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
    // Solo desktop real (>1024px) mantiene el sidebar fijo; ≤1024px es drawer
    // (mobile + tablet) → al navegar se cierra.
    return typeof window !== 'undefined' && window.innerWidth > 1024;
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
    this._el.className = 'mex-sidebar'
      + (this._collapsed ? ' compact' : '')
      + (this._adminMode ? ' mex-sidebar--admin' : '');
    this._el.setAttribute('aria-label', this._adminMode ? 'Controles admin' : 'Navegación principal');

    this._el.innerHTML = this._buildHTML();
    container.appendChild(this._el);
    this._bind();

    // Resize handler
    this._resizeHandler = () => {
      if (this._isDesktop()) {
        this.closeMobileDrawer();
        if (this._collapsed) this._el?.classList.add('compact');
      } else {
        // Mobile/tablet drawer: never keep compact (labels must stay visible).
        this._el?.classList.remove('compact');
      }
    };
    window.addEventListener('resize', this._resizeHandler, { passive: true });

    // If mounted on mobile with compact preference, strip it from the DOM.
    if (!this._isDesktop()) this._el.classList.remove('compact');

    return this;
  }

  /** Actualiza la ruta activa; reconstruye nav al entrar/salir de panel admin. */
  setRoute(route) {
    const nextAdmin = isAdminAppRoute(route);
    const modeChanged = nextAdmin !== this._adminMode;
    this._currentRoute = route;
    this._adminMode = nextAdmin;
    this._syncOpenSubmenus();
    if (!this._el) return;

    if (modeChanged) {
      this._el.innerHTML = this._buildHTML();
      this._el.classList.toggle('mex-sidebar--admin', this._adminMode);
      this._el.setAttribute('aria-label', this._adminMode ? 'Controles admin' : 'Navegación principal');
      return;
    }

    this._el.querySelectorAll('[data-route]').forEach(el => {
      const itemRoute = el.dataset.route || '';
      const isActive = this._isItemActive(itemRoute);
      el.classList.toggle('active', isActive);
    });
    this._el.querySelectorAll('[data-nav-id]').forEach(el => {
      const id = el.dataset.navId;
      const navGroups = this._navGroups();
      let hasActiveChild = false;
      navGroups.forEach(g => g.items.forEach(item => {
        if (item.id === id && this._isAnyChildActive(item)) hasActiveChild = true;
      }));
      if (hasActiveChild) el.classList.add('active');
      else if (!this._isItemActive(el.dataset.route || '')) el.classList.remove('active');
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

  /**
   * Muestra u oculta una pastilla numérica en el ítem del nav indicado.
   * @param {string} navId  - id del ítem (ej. 'mensajes', 'incidencias')
   * @param {number} count  - cantidad; 0 o negativo elimina el badge
   */
  setBadge(navId, count) {
    if (!this._el) return;
    const item = this._el.querySelector(`[data-nav-id="${navId}"]`);
    if (!item) return;
    let badge = item.querySelector('.mex-nav-item-badge');
    if (!count || count <= 0) {
      badge?.remove();
      return;
    }
    const label = count > 99 ? '99+' : String(count);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'mex-nav-item-badge';
      const arrow = item.querySelector('.mex-nav-item-arrow');
      if (arrow) item.insertBefore(badge, arrow);
      else item.appendChild(badge);
    }
    badge.textContent = label;
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
    // Compact is a desktop rail preference; drawer must show labels + logout.
    this._el?.classList.remove('compact');
    this._el?.classList.add('drawer-open');
    this._overlay?.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  closeMobileDrawer() {
    this._mobileOpen = false;
    this._el?.classList.remove('drawer-open');
    this._overlay?.classList.remove('visible');
    document.body.style.overflow = '';
    // Restore desktop compact rail only when back on desktop width.
    if (this._collapsed && this._isDesktop()) {
      this._el?.classList.add('compact');
    }
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
