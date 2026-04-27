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
   */
  constructor(options = {}) {
    this._profile      = options.profile      || {};
    this._role         = options.role         || 'AUXILIAR';
    this._currentRoute = options.currentRoute || '/home';
    this._title        = options.title        || routeTitle(this._currentRoute);
    this._currentPlaza = String(options.currentPlaza || '').toUpperCase().trim();
    this._availablePlazas = Array.isArray(options.availablePlazas) ? options.availablePlazas : [];
    this._canSwitchPlaza = options.canSwitchPlaza === true;

    this._onMenuToggle   = options.onMenuToggle   || null;
    this._onBellClick    = options.onBellClick    || null;
    this._onPlazaChange  = options.onPlazaChange  || null;
    this._onSearchInput  = options.onSearchInput  || null;

    this._bellHasBadge = false;
    this._el = null;
    this._mobilePlazaOpen = false;
    this._mobileSearchOpen = false;
    this._searchValue = '';
    this._searchDebounceMs = 250;
    this._searchTimer = null;
    this._onDocPointerDown = null;
    this._onDocKeyDown = null;
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
    const plazaHtml = this._plazaControlHTML();
    const searchHtml = this._searchControlHTML();

    return `
      <div class="mex-header-left">
        <button class="mex-header-menu-btn" id="mexHdrMenuBtn" aria-label="Abrir menú de navegación">
          <span class="mex-header-menu-btn-icon">menu</span>
        </button>
        <h1 class="mex-header-title" id="mexHdrTitle">${esc(this._title)}</h1>
        ${searchHtml}
      </div>

      <div class="mex-header-right">
        ${plazaHtml}
        <button class="mex-header-icon-btn mex-header-search-toggle" id="mexHdrSearchToggle"
                title="Buscar"
                aria-label="Abrir búsqueda"
                aria-expanded="${this._mobileSearchOpen ? 'true' : 'false'}">
          <span class="mex-hdr-icon">search</span>
        </button>
        <button class="mex-header-icon-btn" id="mexHdrBell"
                title="Alertas y notificaciones"
                aria-label="Alertas y notificaciones">
          <span class="mex-hdr-icon">notifications</span>
          <span class="mex-header-bell-badge" id="mexHdrBellBadge"
                style="display:${this._bellHasBadge ? 'block' : 'none'}"></span>
        </button>
      </div>
    `;
  }

  _searchPlaceholder() {
    const route = String(this._currentRoute || '');
    if (route === '/app/dashboard' || route === '/home') return 'Buscar modulo, unidad o accion...';
    if (route === '/app/cuadre' || route === '/cuadre') return 'Buscar MVA, modelo, placas o ubicacion...';
    if (route === '/app/incidencias' || route === '/incidencias') return 'Buscar incidencia, MVA, autor...';
    if (route === '/app/cola-preparacion' || route === '/cola-preparacion') return 'Buscar unidad en cola...';
    if (route === '/app/admin' || route.startsWith('/app/admin/') || route === '/gestion') return 'Buscar usuarios, roles, plazas...';
    if (route === '/app/programador' || route === '/programador') return 'Buscar diagnostico, API, cache...';
    if (route === '/app/profile' || route === '/profile') return 'Buscar configuracion de perfil...';
    if (route === '/app/mensajes' || route === '/mensajes') return 'Buscar conversacion o remitente...';
    return 'Buscar en la vista actual...';
  }

  _searchControlHTML() {
    const placeholder = this._searchPlaceholder();
    return `
      <div class="mex-header-search ${this._mobileSearchOpen ? 'is-mobile-open' : ''}">
        <span class="mex-header-search-icon">search</span>
        <input id="mexHdrSearchInput"
               class="mex-header-search-input"
               type="search"
               value="${esc(this._searchValue)}"
               placeholder="${esc(placeholder)}"
               aria-label="Busqueda global contextual">
      </div>
    `;
  }

  _plazaControlHTML() {
    const plazas = (Array.isArray(this._availablePlazas) ? this._availablePlazas : [])
      .map(p => String(p || '').toUpperCase().trim())
      .filter(Boolean);
    const current = String(this._currentPlaza || '').toUpperCase().trim();
    const selected = plazas.includes(current) ? current : (plazas[0] || '');
    if (!selected) return '';

    if (!this._canSwitchPlaza || plazas.length <= 1) {
      return `
        <span class="mex-header-plaza-badge mex-header-plaza-desktop" title="Plaza activa">${esc(selected)}</span>
        <span class="mex-header-plaza-badge mex-header-plaza-mobile-badge" title="Plaza activa">${esc(selected)}</span>
      `;
    }

    return `
      <label class="mex-header-plaza-select-wrap mex-header-plaza-desktop" for="mexHdrPlazaSelect" title="Cambiar plaza">
        <span class="mex-header-plaza-select-icon">location_on</span>
        <select id="mexHdrPlazaSelect" class="mex-header-plaza-select" aria-label="Seleccionar plaza activa">
          ${plazas.map(plaza => `<option value="${esc(plaza)}" ${plaza === selected ? 'selected' : ''}>${esc(plaza)}</option>`).join('')}
        </select>
      </label>
      <div class="mex-header-plaza-mobile">
        <button id="mexHdrPlazaMobileBtn"
                class="mex-header-plaza-mobile-btn"
                type="button"
                aria-haspopup="menu"
                aria-expanded="${this._mobilePlazaOpen ? 'true' : 'false'}"
                aria-label="Cambiar plaza activa">
          <span class="mex-header-plaza-mobile-icon">location_on</span>
          <span class="mex-header-plaza-mobile-text">${esc(selected)}</span>
          <span class="mex-header-plaza-mobile-caret">expand_more</span>
        </button>
        <div id="mexHdrPlazaMobileMenu"
             class="mex-header-plaza-mobile-menu ${this._mobilePlazaOpen ? 'open' : ''}"
             role="menu"
             aria-label="Opciones de plaza">
          ${plazas.map(plaza => `
            <button type="button"
                    class="mex-header-plaza-mobile-item ${plaza === selected ? 'active' : ''}"
                    data-plaza-mobile="${esc(plaza)}"
                    role="menuitem">
              ${esc(plaza)}
            </button>
          `).join('')}
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

    this._el.querySelector('#mexHdrPlazaSelect')?.addEventListener('change', event => {
      const plaza = String(event.target?.value || '').toUpperCase().trim();
      if (!plaza) return;
      this._currentPlaza = plaza;
      if (typeof this._onPlazaChange === 'function') this._onPlazaChange(plaza);
    });

    const mobileBtn = this._el.querySelector('#mexHdrPlazaMobileBtn');
    const mobileMenu = this._el.querySelector('#mexHdrPlazaMobileMenu');
    mobileBtn?.addEventListener('click', event => {
      event.stopPropagation();
      this._mobilePlazaOpen = !this._mobilePlazaOpen;
      mobileMenu?.classList.toggle('open', this._mobilePlazaOpen);
      mobileBtn.setAttribute('aria-expanded', this._mobilePlazaOpen ? 'true' : 'false');
    });
    this._el.querySelectorAll('[data-plaza-mobile]').forEach(btn => {
      btn.addEventListener('click', () => {
        const plaza = String(btn.getAttribute('data-plaza-mobile') || '').toUpperCase().trim();
        if (!plaza) return;
        this._currentPlaza = plaza;
        this._mobilePlazaOpen = false;
        mobileMenu?.classList.remove('open');
        mobileBtn?.setAttribute('aria-expanded', 'false');
        if (typeof this._onPlazaChange === 'function') this._onPlazaChange(plaza);
      });
    });

    this._onDocPointerDown = event => {
      if (!this._mobilePlazaOpen || !this._el) return;
      const zone = this._el.querySelector('.mex-header-plaza-mobile');
      if (zone && !zone.contains(event.target)) {
        this._mobilePlazaOpen = false;
        mobileMenu?.classList.remove('open');
        mobileBtn?.setAttribute('aria-expanded', 'false');
      }
    };
    this._onDocKeyDown = event => {
      if (event.key !== 'Escape') return;
      if (this._mobilePlazaOpen) {
        this._mobilePlazaOpen = false;
        mobileMenu?.classList.remove('open');
        mobileBtn?.setAttribute('aria-expanded', 'false');
      }
      if (this._mobileSearchOpen) {
        this._mobileSearchOpen = false;
        this._el.querySelector('.mex-header-search')?.classList.remove('is-mobile-open');
        this._el.querySelector('#mexHdrSearchToggle')?.setAttribute('aria-expanded', 'false');
      }
    };
    document.addEventListener('pointerdown', this._onDocPointerDown);
    document.addEventListener('keydown', this._onDocKeyDown);

    const searchInput = this._el.querySelector('#mexHdrSearchInput');
    const searchToggle = this._el.querySelector('#mexHdrSearchToggle');
    searchInput?.addEventListener('input', event => {
      this._searchValue = String(event.target?.value || '');
      if (this._searchTimer) clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        if (typeof this._onSearchInput === 'function') {
          this._onSearchInput({
            query: this._searchValue,
            route: this._currentRoute,
            source: 'shell-header'
          });
        }
      }, this._searchDebounceMs);
    });
    searchToggle?.addEventListener('click', event => {
      event.stopPropagation();
      this._mobileSearchOpen = !this._mobileSearchOpen;
      this._el.querySelector('.mex-header-search')?.classList.toggle('is-mobile-open', this._mobileSearchOpen);
      searchToggle.setAttribute('aria-expanded', this._mobileSearchOpen ? 'true' : 'false');
      if (this._mobileSearchOpen) searchInput?.focus();
    });
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
    this.setSearchValue('');
    this._emitSearchNow();
  }

  /** Actualiza el avatar en el header. Nombre/rol viven en el sidebar footer. */
  setProfile(profile, role) {
    this._profile = profile || {};
    if (role) this._role = role;
  }

  /** Muestra u oculta el badge rojo de la campana. */
  setBellBadge(visible) {
    this._bellHasBadge = visible;
    const badge = this._el?.querySelector('#mexHdrBellBadge');
    if (badge) badge.style.display = visible ? 'block' : 'none';
  }

  setPlaza(currentPlaza = '', availablePlazas = [], canSwitchPlaza = false) {
    this._currentPlaza = String(currentPlaza || '').toUpperCase().trim();
    this._availablePlazas = Array.isArray(availablePlazas)
      ? [...new Set(availablePlazas.map(p => String(p || '').toUpperCase().trim()).filter(Boolean))]
      : [];
    this._canSwitchPlaza = canSwitchPlaza === true;
    if (!this._el) return;
    this._mobilePlazaOpen = false;
    this._el.innerHTML = this._buildHTML();
    this._bind();
  }

  setSearchPlaceholder() {
    const input = this._el?.querySelector('#mexHdrSearchInput');
    if (input) input.setAttribute('placeholder', this._searchPlaceholder());
  }

  setSearchValue(value = '') {
    this._searchValue = String(value || '');
    const input = this._el?.querySelector('#mexHdrSearchInput');
    if (input) input.value = this._searchValue;
  }

  _emitSearchNow() {
    if (typeof this._onSearchInput !== 'function') return;
    this._onSearchInput({
      query: this._searchValue,
      route: this._currentRoute,
      source: 'shell-header'
    });
  }

  destroy() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    if (this._onDocPointerDown) document.removeEventListener('pointerdown', this._onDocPointerDown);
    if (this._onDocKeyDown) document.removeEventListener('keydown', this._onDocKeyDown);
    this._onDocPointerDown = null;
    this._onDocKeyDown = null;
    this._el?.remove();
  }

  get element()  { return this._el; }
  get title()    { return this._title; }
}
