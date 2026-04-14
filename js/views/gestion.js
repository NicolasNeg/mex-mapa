import { auth } from '/js/core/database.js';

function currentTab() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get('tab') || 'usuarios').trim().toLowerCase() || 'usuarios';
}

function buildGestionFrameUrl() {
  const params = new URLSearchParams();
  params.set('admin', '1');
  params.set('tab', currentTab());
  return `/mapa?${params.toString()}`;
}

function markFrameReady() {
  const loader = document.getElementById('gestionRouteLoader');
  if (loader) loader.classList.add('ready');
}

auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.replace('/login');
    return;
  }

  const frame = document.getElementById('gestionRouteFrame');
  if (!frame) return;
  frame.addEventListener('load', markFrameReady, { once: true });
  frame.src = buildGestionFrameUrl();
});
