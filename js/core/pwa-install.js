/**
 * js/core/pwa-install.js
 * Banner de instalación PWA — Fase 3
 *
 * Captura el evento `beforeinstallprompt` y muestra un banner
 * discreto en la parte inferior de la pantalla para invitar
 * al usuario a instalar la app.
 *
 * No modifica ninguna lógica existente de mapa.js.
 * Se inicializa con: initPwaInstall()
 * El banner busca el elemento #pwa-install-banner en el DOM.
 */

'use strict';

let _deferredPrompt = null;
let _bannerShown    = false;

const PWA_DISMISSED_KEY = 'mex_pwa_dismissed_v1';

export function initPwaInstall() {
  // No mostrar si ya fue instalada (standalone mode)
  if (window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true) {
    return;
  }

  // No mostrar si el usuario ya la descartó en los últimos 7 días
  const dismissed = Number(localStorage.getItem(PWA_DISMISSED_KEY) || 0);
  if (dismissed && Date.now() - dismissed < 7 * 24 * 60 * 60 * 1000) return;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredPrompt = e;
    _mostrarBanner();
  });

  // iOS Safari no dispara beforeinstallprompt — mostrar instrucciones manuales
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandalone = window.navigator.standalone;
  if (isIos && !isInStandalone) {
    // Esperar 3 segundos para no interrumpir el login
    setTimeout(_mostrarBannerIos, 3000);
  }
}

function _mostrarBanner() {
  if (_bannerShown) return;
  const banner = document.getElementById('pwa-install-banner');
  if (!banner) return;
  _bannerShown = true;

  banner.querySelector('#pwa-install-btn')?.addEventListener('click', _instalar);
  banner.querySelector('#pwa-dismiss-btn')?.addEventListener('click', _descartar);

  // Animar entrada con pequeño delay
  setTimeout(() => banner.classList.add('visible'), 800);
}

function _mostrarBannerIos() {
  if (_bannerShown) return;
  const banner = document.getElementById('pwa-install-banner-ios');
  if (!banner) return;
  _bannerShown = true;
  banner.querySelector('#pwa-dismiss-ios-btn')?.addEventListener('click', () => {
    banner.classList.remove('visible');
    localStorage.setItem(PWA_DISMISSED_KEY, String(Date.now()));
  });
  setTimeout(() => banner.classList.add('visible'), 500);
}

async function _instalar() {
  if (!_deferredPrompt) return;
  const banner = document.getElementById('pwa-install-banner');
  banner?.classList.remove('visible');

  _deferredPrompt.prompt();
  const { outcome } = await _deferredPrompt.userChoice;
  _deferredPrompt = null;

  if (outcome === 'dismissed') {
    localStorage.setItem(PWA_DISMISSED_KEY, String(Date.now()));
  }
}

function _descartar() {
  const banner = document.getElementById('pwa-install-banner');
  banner?.classList.remove('visible');
  localStorage.setItem(PWA_DISMISSED_KEY, String(Date.now()));
}
