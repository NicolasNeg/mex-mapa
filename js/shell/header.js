// ═══════════════════════════════════════════════════════════
//  /js/shell/header.js
//  Componente header global — título contextual, bell, perfil.
//  Fase 1: componente standalone.
// ═══════════════════════════════════════════════════════════

import { routeTitle, ROLE_LABELS } from './navigation.config.js';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class ShellHeader {
  /**
   * @param {object}   options
   * @param {object}   options.profile         - Perfil del usuario
   * @param {string}   options.role            - Rol del usuario
   * @param {string}   options.currentRoute    - Ruta activa al montar
   * @param {function} options.onMenuToggle    - Callback al tocar el botón de menú (mobile)
   * @param {function} options.onBellClick     - Callback al tocar la campana
   * @param {function} options.onProfileClick  - Callback al tocar el área de perfil
   */
  constructor(options = {}) {
    this._profile      = options.profile      || {};
    this._role         = options.role         || 'AUXILIAR';
    this._currentRoute = options.currentRoute || '/home';
    this._title        = options.title        || routeTitle(this._currentRoute);

    this._onMenuToggle   = options.onMenuToggle   || null;
    this._onBellClick    = options.onBellClick    || null;
    this._onProfileClick = options.onProfileClick || null;

    this._bellHasBadge = false;
    this._el = null;
  }

  // ── Private helpers ─────────────────────────────────────

  _roleLabel() {
    return ROLE_LABELS[this._role] || this._role;
  }

  _userName() {
    const p = this._profile;
    return p.nombreCompleto || p.displayName || p.nombre || p.email || 'Usuario';
  }

  _buildHTML() {
    const userName  = this._userName();
    const roleLabel = this._roleLabel();
    const avatarUrl = this._profile.avatarUrl || this._profile.photoURL || this._profile.fotoURL || '';

    return `
      <div class="mex-header-left">
        <button class="mex-header-menu-btn" id="mexHdrMenuBtn" aria-label="Abrir menú de navegación">
          <span class="mex-header-menu-btn-icon">menu</span>
        </button>
        <h1 class="mex-header-title" id="mexHdrTitle">${esc(this._title)}</h1>
      </div>

      <div class="mex-header-right">
        <button class="mex-header-icon-btn" id="mexHdrBell"
                title="Alertas y notificaciones"
                aria-label="Alertas y notificaciones">
          <span class="mex-hdr-icon">notifications</span>
          <span class="mex-header-bell-badge" id="mexHdrBellBadge"
                style="display:${this._bellHasBadge ? 'block' : 'none'}"></span>
        </button>
        <div class="mex-header-divider"></div>
        <div class="mex-header-user" id="mexHdrUser"
             role="button" tabindex="0"
             title="Mi perfil" aria-label="Mi perfil">
          <div class="mex-header-user-text">
            <div class="mex-header-user-name" id="mexHdrUserName">${esc(userName)}</div>
            <div class="mex-header-user-role" id="mexHdrUserRole">${esc(roleLabel)}</div>
          </div>
          <div class="mex-header-avatar" id="mexHdrAvatar">
            ${avatarUrl
              ? `<img src="${esc(avatarUrl)}" alt="${esc(userName)}" loading="lazy">`
              : `<span class="mex-header-avatar-icon">shield_person</span>`}
          </div>
        </div>
      </div>
    `;
  }

  _bind() {
    if (!this._el) return;

    this._el.querySelector('#mexHdrMenuBtn')?.addEventListener('click', () => {
      if (typeof this._onMenuToggle === 'function') this._onMenuToggle();
    });

    this._el.querySelector('#mexHdrBell')?.addEventListener('click', () => {
      if (typeof this._onBellClick === 'function') this._onBellClick();
    });

    const userEl = this._el.querySelector('#mexHdrUser');
    if (userEl) {
      userEl.addEventListener('click', () => {
        if (typeof this._onProfileClick === 'function') this._onProfileClick();
        else window.location.href = '/profile';
      });
      userEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); userEl.click(); }
      });
    }
  }

  // ── Public API ──────────────────────────────────────────

  mount(container) {
    this._el = document.createElement('header');
    this._el.id = 'mexShellHeader';
    this._el.className = 'mex-header';
    this._el.setAttribute('role', 'banner');
    this._el.innerHTML = this._buildHTML();
    container.appendChild(this._el);
    this._bind();

    // Sync left offset when sidebar toggles
    window.addEventListener('mex:sidebar:toggle', ({ detail }) => {
      if (!this._el) return;
      this._el.style.left = detail?.collapsed
        ? 'var(--sh-sidebar-compact-w)'
        : 'var(--sh-sidebar-w)';
    });

    return this;
  }

  /** Actualiza el título sin re-renderizar el header completo. */
  setTitle(title) {
    this._title = title;
    const el = this._el?.querySelector('#mexHdrTitle');
    if (el) el.textContent = title;
  }

  /** Cambia la ruta activa → actualiza el título automáticamente. */
  setRoute(route) {
    this._currentRoute = route;
    this.setTitle(routeTitle(route));
  }

  /** Actualiza los datos de perfil y rol en el header. */
  setProfile(profile, role) {
    this._profile = profile || {};
    if (role) this._role = role;

    const userName  = this._userName();
    const roleLabel = this._roleLabel();
    const avatarUrl = this._profile.avatarUrl || this._profile.photoURL || this._profile.fotoURL || '';

    const nameEl   = this._el?.querySelector('#mexHdrUserName');
    const roleEl   = this._el?.querySelector('#mexHdrUserRole');
    const avatarEl = this._el?.querySelector('#mexHdrAvatar');

    if (nameEl) nameEl.textContent = userName;
    if (roleEl) roleEl.textContent = roleLabel;
    if (avatarEl) {
      avatarEl.innerHTML = avatarUrl
        ? `<img src="${esc(avatarUrl)}" alt="${esc(userName)}" loading="lazy">`
        : `<span class="mex-header-avatar-icon">shield_person</span>`;
    }
  }

  /** Muestra u oculta el badge rojo de la campana. */
  setBellBadge(visible) {
    this._bellHasBadge = visible;
    const badge = this._el?.querySelector('#mexHdrBellBadge');
    if (badge) badge.style.display = visible ? 'block' : 'none';
  }

  destroy() {
    this._el?.remove();
  }

  get element()  { return this._el; }
  get title()    { return this._title; }
}
