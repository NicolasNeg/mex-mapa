// ═══════════════════════════════════════════════════════════
//  /js/shell/bottom-nav.js
//  Barra inferior móvil (<768px). Una sola barra:
//   - Fijos anclados a la izquierda: Inicio · Mapa · Cuadre · Más
//   - Al entrar a una sección con sub-páginas (items con `children` en
//     navigation.config.js), se anexan a la derecha y la barra hace
//     auto-scroll a la derecha. Salir de la sección → se quitan.
//  Sin listeners de datos: se arma de la config en memoria. CSS en shell.css.
// ═══════════════════════════════════════════════════════════

import { filterNavForRole } from './navigation.config.js';

// Pestañas fijas. Labels cortos para móvil; el id/route sale de la config
// (así heredan el filtrado por rol/feature: si el rol no tiene Cuadre, cae solo).
const FIXED = [
  { id: 'home',   label: 'Inicio', icon: 'home' },
  { id: 'mapa',   label: 'Mapa',   icon: 'map' },
  { id: 'cuadre', label: 'Cuadre', icon: 'calculate' },
];

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function normPath(route = '') {
  const [path] = String(route).split('?');
  return path.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
}
function normFull(route = '') {
  const [path, query = ''] = String(route || '').split('?');
  const p = path.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  return query ? `${p}?${query}` : p;
}

export class ShellBottomNav {
  constructor({ role = 'AUXILIAR', currentRoute = '/home', onNavigate = null, onMore = null, onConfig = null } = {}) {
    this._role = role;
    this._currentRoute = currentRoute;
    this._onNavigate = onNavigate;
    this._onMore = onMore;
    this._onConfig = onConfig;  // en /mapa el 4º slot abre el engranaje del mapa
    this._el = null;
  }

  _isMapa() {
    return normPath(this._currentRoute) === '/mapa';
  }

  _isActive(route) {
    const tf = normFull(route);
    if (tf.includes('?')) return tf === normFull(this._currentRoute);
    return normPath(route) === normPath(this._currentRoute);
  }

  _fixedTabs() {
    const byId = {};
    filterNavForRole(this._role).forEach(g => g.items.forEach(it => { byId[it.id] = it; }));
    return FIXED
      .filter(f => byId[f.id])
      .map(f => ({ route: byId[f.id].route, icon: f.icon, label: f.label }));
  }

  // Sub-páginas de la sección a la que pertenece la ruta actual (o [] si ninguna).
  _sectionExtras() {
    const full = normFull(this._currentRoute);
    const path = normPath(this._currentRoute);
    for (const g of filterNavForRole(this._role)) {
      for (const it of g.items) {
        if (!Array.isArray(it.children) || !it.children.length) continue;
        const selfMatch = normPath(it.route) === path;
        const childMatch = it.children.some(c => {
          const cf = normFull(c.route);
          return cf.includes('?') ? cf === full : normPath(c.route) === path;
        });
        if (selfMatch || childMatch) {
          return it.children.map(c => ({ route: c.route, icon: c.icon || 'chevron_right', label: c.label }));
        }
      }
    }
    return [];
  }

  _itemHTML(t, extra) {
    const active = t.route && this._isActive(t.route);
    const attr = t.action ? `data-action="${esc(t.action)}"` : `data-route="${esc(t.route)}"`;
    return `<button class="mex-bottomnav-item${extra ? ' mex-bottomnav-item--extra' : ''}${active ? ' active' : ''}"
            ${attr} ${active ? 'aria-current="page"' : ''}>
      <span class="mex-bottomnav-icon">${esc(t.icon)}</span>
      <span class="mex-bottomnav-label">${esc(t.label)}</span>
    </button>`;
  }

  _buildHTML() {
    const fixed = this._fixedTabs().map(t => this._itemHTML(t, false)).join('');
    const isCuadre = normPath(this._currentRoute) === '/cuadre' || normPath(this._currentRoute) === '/app/cuadre';
    
    let more = '';
    if (this._isMapa()) {
      more = `<button class="mex-bottomnav-item" data-action="config" aria-label="Configuración del mapa">
          <span class="mex-bottomnav-icon">settings</span>
          <span class="mex-bottomnav-label">Config</span>
        </button>`;
    } else if (isCuadre) {
      more = `<button class="mex-bottomnav-item" data-action="cuadre_more" aria-label="Más opciones">
          <span class="mex-bottomnav-icon" style="color:var(--mex-blue, #1d4ed8);">more_horiz</span>
          <span class="mex-bottomnav-label">Controles</span>
        </button>`;
    } else {
      more = `<button class="mex-bottomnav-item" data-action="more" aria-label="Más opciones">
          <span class="mex-bottomnav-icon">more_horiz</span>
          <span class="mex-bottomnav-label">Más</span>
        </button>`;
    }

    const extras = this._sectionExtras();

    const extrasHTML = extras.length
      ? `<span class="mex-bottomnav-sep" aria-hidden="true"></span>` + extras.map(e => this._itemHTML(e, true)).join('')
      : '';
    return `<div class="mex-bottomnav-scroll">${fixed}${more}${extrasHTML}</div>`;
  }

  _render() {
    if (this._el) this._el.innerHTML = this._buildHTML();
  }

  _autoScroll() {
    const scroller = this._el?.querySelector('.mex-bottomnav-scroll');
    if (!scroller) return;
    const hasExtras = !!scroller.querySelector('.mex-bottomnav-item--extra');
    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    requestAnimationFrame(() => {
      scroller.scrollTo({ left: hasExtras ? scroller.scrollWidth : 0, behavior });
    });
  }

  mount(container) {
    this._el = document.createElement('nav');
    this._el.id = 'mexBottomNav';
    this._el.className = 'mex-bottomnav' + (this._isMapa() ? ' is-mapa' : '');
    this._el.setAttribute('aria-label', 'Navegación principal');
    this._el.innerHTML = this._buildHTML();
    container.appendChild(this._el);

    this._el.addEventListener('click', e => {
      const btn = e.target.closest('[data-route],[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'more')   { this._onMore?.();   return; }
      if (btn.dataset.action === 'config') { this._onConfig?.(); return; }
      if (btn.dataset.action === 'cuadre_more') { window.dispatchEvent(new CustomEvent('mex:cuadre:more')); return; }
      if (btn.dataset.route) this._onNavigate?.(btn.dataset.route);
    });

    this._autoScroll();
    return this;
  }

  setRoute(route) {
    this._currentRoute = route;
    this._render();
    this._el?.classList.toggle('is-mapa', this._isMapa());
    this._autoScroll();
  }

  setProfile(_profile, role) {
    if (role && role !== this._role) { this._role = role; this._render(); }
  }

  destroy() {
    this._el?.remove();
    this._el = null;
  }

  get element() { return this._el; }
}
