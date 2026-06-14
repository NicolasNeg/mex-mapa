// js/mapa-fluid.js — Micro-enhancements de fluidez para mapa.html
// No toca mapa.js. Usa MutationObserver sobre el DOM ya construido.

(function () {
  'use strict';

  // ── Espera a que el DOM esté listo ────────────────────────────
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  // ── KPI flash — pulso visual cuando un número cambia ─────────
  function initKpiFlash() {
    const KPI_IDS = [
      'kpi-total', 'kpi-listos', 'kpi-sucios',
      'kpi-manto', 'kpi-patio', 'kpi-taller-loc'
    ];
    let booting = true;
    // Ignorar el primer render (carga inicial)
    requestAnimationFrame(() => requestAnimationFrame(() => { booting = false; }));

    KPI_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const obs = new MutationObserver(() => {
        if (booting) return;
        el.classList.remove('kpi-flash');
        requestAnimationFrame(() => {
          el.classList.add('kpi-flash');
          el.addEventListener('animationend', () => el.classList.remove('kpi-flash'), { once: true });
        });
      });
      obs.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  // ── Car state flash — pulso cuando cambia el estado de la unidad
  function initCarStateFlash() {
    const grid = document.getElementById('grid-map');
    if (!grid) return;

    const obs = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') continue;
        const car = mutation.target;
        if (!car.classList.contains('car')) continue;
        if (car.classList.contains('car-state-changed')) continue;
        // No flashear en la animación inicial (popInCar)
        if (car.getAnimations?.().some(a => a.animationName === 'popInCar')) continue;

        car.classList.add('car-state-changed');
        car.addEventListener('animationend', () => car.classList.remove('car-state-changed'), { once: true });
      }
    });

    obs.observe(grid, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  // ── Map grid entrance — fade+scale cuando se redibuja ────────
  function initGridEntrance() {
    const grid = document.getElementById('grid-map');
    if (!grid) return;

    let prevChildCount = 0;
    const obs = new MutationObserver(() => {
      const current = grid.children.length;
      // Solo animar cuando se repobla el grid (diferencia significativa)
      if (Math.abs(current - prevChildCount) >= 4) {
        grid.classList.remove('grid-entering');
        requestAnimationFrame(() => {
          grid.classList.add('grid-entering');
          grid.addEventListener('animationend', () => grid.classList.remove('grid-entering'), { once: true });
        });
      }
      prevChildCount = current;
    });

    obs.observe(grid, { childList: true });
  }

  // ── Chip tabs — deseleccionar con spring ────────────────────
  function initChipPress() {
    document.addEventListener('pointerdown', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      chip.style.transition = 'transform 0.06s ease';
      chip.style.transform = 'scale(0.93)';
      const reset = () => {
        chip.style.transform = '';
        chip.removeEventListener('pointerup', reset);
        chip.removeEventListener('pointercancel', reset);
      };
      chip.addEventListener('pointerup', reset, { once: true });
      chip.addEventListener('pointercancel', reset, { once: true });
    });
  }

  // ── Toast stacking — evita acumulación ──────────────────────
  function initToastLimit() {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const obs = new MutationObserver(() => {
      const toasts = container.querySelectorAll('.toast');
      if (toasts.length > 3) {
        // Remover el más viejo
        toasts[0].remove();
      }
    });
    obs.observe(container, { childList: true });
  }

  // ── Zoom suavizado — interceptar wheel para inertia ──────────
  function initSmoothZoom() {
    const content = document.querySelector('.content');
    if (!content) return;
    // El zoom es manejado por mapa.js via wheel → _handleWheel
    // Solo mejoramos el scroll del contenedor con inertia CSS
    content.style.scrollBehavior = 'smooth';
    content.style.webkitOverflowScrolling = 'touch';
    content.style.overscrollBehavior = 'contain';
  }

  // ── Init ──────────────────────────────────────────────────────
  ready(() => {
    // Dar tiempo a que mapa.js inicialice el DOM
    requestAnimationFrame(() => {
      initKpiFlash();
      initCarStateFlash();
      initGridEntrance();
      initChipPress();
      initToastLimit();
      initSmoothZoom();
    });
  });

})();
