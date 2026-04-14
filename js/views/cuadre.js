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

function routeIsWarm() {
  try {
    return sessionStorage.getItem('mex.bootstrap.warm.v1') === '1';
  } catch (_) {
    return false;
  }
}

function markFrameReady() {
  const loader = document.getElementById('cuadreRouteLoader');
  if (loader) loader.classList.add('ready');
}

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.replace('/login');
    return;
  }

  if (typeof window.__mexRequireLocationAccess === 'function') {
    await window.__mexRequireLocationAccess({
      title: 'Ubicacion obligatoria para gestion de flota',
      copy: 'Activa tu ubicación exacta para entrar al panel de gestión de flota y dejar trazabilidad operativa.',
      allowLogout: true,
      force: false
    });
  }

  const frame = document.getElementById('cuadreRouteFrame');
  if (!frame) return;
  if (routeIsWarm()) markFrameReady();
  frame.addEventListener('load', markFrameReady, { once: true });
  frame.src = buildFleetFrameUrl();
});
