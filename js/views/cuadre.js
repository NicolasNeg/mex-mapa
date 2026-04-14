import { auth } from '/js/core/database.js';

function currentTab() {
  const params = new URLSearchParams(window.location.search);
  const raw = String(params.get('tab') || 'normal').trim().toLowerCase();
  return raw === 'admins' ? 'admins' : 'normal';
}

function buildFleetFrameUrl() {
  const params = new URLSearchParams();
  params.set('fleet', '1');
  params.set('tab', currentTab());
  return `/mapa?${params.toString()}`;
}

function markFrameReady() {
  const loader = document.getElementById('cuadreRouteLoader');
  if (loader) loader.classList.add('ready');
}

auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.replace('/login');
    return;
  }

  const frame = document.getElementById('cuadreRouteFrame');
  if (!frame) return;
  frame.addEventListener('load', markFrameReady, { once: true });
  frame.src = buildFleetFrameUrl();
});
