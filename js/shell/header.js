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
    this._onSearchSubmit = options.onSearchSubmit || null;

    // Modo del buscador: 'inpage' (filtra la vista) | 'global' (abre panel).
    let storedMode = null;
    try { storedMode = localStorage.getItem('mex.search.mode'); } catch (_) {}
    this._searchMode = storedMode === 'global' ? 'global' : 'inpage';

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
        <div id="mexHdrCustomActions" class="mex-header-custom-actions"></div>
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
    if (route === '/app/dashboard' || route === '/home') return 'Buscar módulo, unidad o acción...';
    if (route === '/app/cuadre' || route === '/cuadre') return 'Buscar MVA, modelo, placas o ubicación...';
    if (route === '/app/incidencias' || route === '/incidencias') return 'Buscar incidencia, MVA, autor...';
    if (route === '/app/cola-preparacion' || route === '/cola-preparacion') return 'Buscar unidad en cola...';
    if (route === '/app/admin' || route.startsWith('/app/admin/') || route === '/gestion') return 'Buscar usuarios, roles, plazas...';
    if (route === '/app/programador' || route === '/programador') return 'Buscar diagnóstico, API, cache...';
    if (route === '/app/profile' || route === '/profile') return 'Buscar configuración de perfil...';
    if (route === '/app/mensajes' || route === '/mensajes') return 'Buscar conversaciones o mensajes...';
    if (route === '/app/mapa' || route === '/mapa') return 'Buscar unidad o acción del mapa...';
    return 'Buscar en la vista actual...';
  }

  _searchControlHTML() {
    const mode = this._searchMode;
    const placeholder = mode === 'global'
      ? 'Buscar unidad o usuario · Enter'
      : this._searchPlaceholder();
    return `
      <div class="mex-header-search ${this._mobileSearchOpen ? 'is-mobile-open' : ''}" data-search-mode="${mode}">
        <div class="mex-hdr-searchmode" id="mexHdrSearchMode" role="group" aria-label="Modo de búsqueda">
          <button type="button" data-mode="inpage" class="${mode === 'inpage' ? 'is-active' : ''}" title="Filtrar la vista actual">Página</button>
          <button type="button" data-mode="global" class="${mode === 'global' ? 'is-active' : ''}" title="Búsqueda global (Enter)">Global</button>
        </div>
        <input id="mexHdrSearchInput"
               class="mex-header-search-input"
               type="search"
               value="${esc(this._searchValue)}"
               placeholder="${esc(placeholder)}"
               aria-label="Buscador">
        <button type="button" class="mex-header-search-icon" id="mexHdrSearchGo" title="Buscar" aria-label="Buscar">search</button>
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
      return `<div class="mex-plaza-chip">${esc(selected)}</div>`;
    }

    return `
      <div class="mex-plaza-picker" id="mexPlazaPicker">
        <button class="mex-plaza-picker-btn" id="mexPlazaPickerBtn" type="button"
                aria-haspopup="listbox" aria-expanded="false" aria-label="Cambiar plaza">
          <span class="mex-plaza-picker-label" id="mexPlazaPickerLabel">${esc(selected)}</span>
          <span class="mex-plaza-picker-caret">expand_more</span>
        </button>
        <div class="mex-plaza-picker-menu" id="mexPlazaPickerMenu" role="listbox" aria-label="Seleccionar plaza">
          ${plazas.map(plaza => `
            <button type="button"
                    class="mex-plaza-picker-item${plaza === selected ? ' active' : ''}"
                    data-plaza-pick="${esc(plaza)}"
                    role="option"
                    aria-selected="${plaza === selected ? 'true' : 'false'}">
              <span class="mex-plaza-pick-check" style="${plaza === selected ? '' : 'visibility:hidden'}">check</span>
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

    // ── Plaza picker ──────────────────────────────────────
    const pickerBtn  = this._el.querySelector('#mexPlazaPickerBtn');
    const pickerMenu = this._el.querySelector('#mexPlazaPickerMenu');
    const pickerLabel = this._el.querySelector('#mexPlazaPickerLabel');
    let _pickerOpen = false;

    const _closePicker = () => {
      _pickerOpen = false;
      pickerMenu?.classList.remove('open');
      pickerBtn?.setAttribute('aria-expanded', 'false');
    };

    pickerBtn?.addEventListener('click', event => {
      event.stopPropagation();
      _pickerOpen = !_pickerOpen;
      pickerMenu?.classList.toggle('open', _pickerOpen);
      pickerBtn.setAttribute('aria-expanded', _pickerOpen ? 'true' : 'false');
    });

    this._el.querySelectorAll('[data-plaza-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const plaza = String(btn.getAttribute('data-plaza-pick') || '').toUpperCase().trim();
        if (!plaza) return;
        this._currentPlaza = plaza;
        if (pickerLabel) pickerLabel.textContent = plaza;
        // Update active state
        this._el.querySelectorAll('[data-plaza-pick]').forEach(b => {
          const isActive = b.getAttribute('data-plaza-pick') === plaza;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-selected', isActive ? 'true' : 'false');
          const check = b.querySelector('.mex-plaza-pick-check');
          if (check) check.style.visibility = isActive ? '' : 'hidden';
        });
        _closePicker();
        if (typeof this._onPlazaChange === 'function') this._onPlazaChange(plaza);
      });
    });

    this._onDocPointerDown = event => {
      if (!this._el) return;
      if (_pickerOpen) {
        const picker = this._el.querySelector('#mexPlazaPicker');
        if (picker && !picker.contains(event.target)) _closePicker();
      }
      if (this._mobileSearchOpen) {
        const searchWrap = this._el.querySelector('.mex-header-search');
        const searchBtn = this._el.querySelector('#mexHdrSearchToggle');
        if (
          searchWrap && !searchWrap.contains(event.target) &&
          searchBtn && !searchBtn.contains(event.target)
        ) {
          this._mobileSearchOpen = false;
          this._el.querySelector('.mex-header-search')?.classList.remove('is-mobile-open');
          this._el.querySelector('#mexHdrSearchToggle')?.setAttribute('aria-expanded', 'false');
        }
      }
    };
    this._onDocKeyDown = event => {
      if (event.key !== 'Escape') return;
      if (_pickerOpen) _closePicker();
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
        // Solo el modo "En página" reacciona al tecleo (filtro en vivo). En
        // modo "Global" el tecleo no dispara nada; se abre por Enter/lupa.
        if (typeof this._onSearchInput === 'function') {
          this._onSearchInput({
            query: this._searchValue,
            mode: this._searchMode,
            route: this._currentRoute,
            source: 'shell-header'
          });
        }
        if (!this._searchValue && this._mobileSearchOpen) {
          this._mobileSearchOpen = false;
          this._el.querySelector('.mex-header-search')?.classList.remove('is-mobile-open');
          this._el.querySelector('#mexHdrSearchToggle')?.setAttribute('aria-expanded', 'false');
        }
      }, this._searchDebounceMs);
    });
    // Enter = submit (abre el panel en modo Global).
    searchInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); this._submitSearch(); }
    });
    // Lupa clickeable = submit.
    this._el.querySelector('#mexHdrSearchGo')?.addEventListener('click', event => {
      event.preventDefault();
      this._submitSearch();
    });
    // Toggle de modo (Página / Global).
    this._el.querySelector('#mexHdrSearchMode')?.addEventListener('click', event => {
      const btn = event.target.closest('[data-mode]');
      if (btn) this._setSearchMode(btn.dataset.mode);
    });

    searchToggle?.addEventListener('click', event => {
      event.stopPropagation();
      this._mobileSearchOpen = !this._mobileSearchOpen;
      this._el.querySelector('.mex-header-search')?.classList.toggle('is-mobile-open', this._mobileSearchOpen);
      searchToggle.setAttribute('aria-expanded', this._mobileSearchOpen ? 'true' : 'false');
      if (this._mobileSearchOpen) searchInput?.focus();
    });
  }

  _submitSearch() {
    if (this._searchTimer) { clearTimeout(this._searchTimer); this._searchTimer = null; }
    if (typeof this._onSearchSubmit === 'function') {
      this._onSearchSubmit({
        query: this._searchValue,
        mode: this._searchMode,
        route: this._currentRoute,
        source: 'shell-header'
      });
    }
  }

  _setSearchMode(mode) {
    const next = mode === 'global' ? 'global' : 'inpage';
    if (next === this._searchMode) return;
    this._searchMode = next;
    try { localStorage.setItem('mex.search.mode', next); } catch (_) {}
    const wrap = this._el?.querySelector('.mex-header-search');
    if (wrap) wrap.setAttribute('data-search-mode', next);
    this._el?.querySelectorAll('#mexHdrSearchMode [data-mode]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.mode === next);
    });
    const input = this._el?.querySelector('#mexHdrSearchInput');
    if (input) input.placeholder = next === 'global' ? 'Buscar unidad o usuario · Enter' : this._searchPlaceholder();
    // Al cambiar a "En página" reaplica el filtro con el texto actual; al pasar
    // a "Global" limpia el filtro del contenedor (queda a cargo del panel).
    if (typeof this._onSearchInput === 'function') {
      this._onSearchInput({
        query: next === 'inpage' ? this._searchValue : '',
        mode: 'inpage',
        route: this._currentRoute,
        source: 'shell-header'
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
    this.setSearchValue('');
    this._mobileSearchOpen = false;
    this._el?.querySelector('.mex-header-search')?.classList.remove('is-mobile-open');
    this._el?.querySelector('#mexHdrSearchToggle')?.setAttribute('aria-expanded', 'false');
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

  setCustomActions(htmlOrElement) {
    const container = this._el?.querySelector('#mexHdrCustomActions');
    if (!container) return;
    if (typeof htmlOrElement === 'string') {
      container.innerHTML = htmlOrElement;
    } else if (htmlOrElement instanceof HTMLElement) {
      container.innerHTML = '';
      container.appendChild(htmlOrElement);
    } else {
      container.innerHTML = '';
    }
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
