import { auth } from '/js/core/database.js';

function buildMensajesFrameUrl() {
  return '/mapa?messages=1';
}

function routeIsWarm() {
  try {
    return sessionStorage.getItem('mex.bootstrap.warm.v1') === '1';
  } catch (_) {
    return false;
  }
}

function markFrameReady() {
  const loader = document.getElementById('mensajesRouteLoader');
  if (loader) loader.classList.add('ready');
}

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.replace('/login');
    return;
  }

  const frame = document.getElementById('mensajesRouteFrame');
  if (!frame) return;
  if (routeIsWarm()) markFrameReady();
  frame.addEventListener('load', markFrameReady, { once: true });
  frame.src = buildMensajesFrameUrl();
});
