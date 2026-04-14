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

function routeIsWarm() {
  try {
    return sessionStorage.getItem('mex.bootstrap.warm.v1') === '1';
  } catch (_) {
    return false;
  }
}

function markFrameReady() {
  const loader = document.getElementById('gestionRouteLoader');
  if (loader) loader.classList.add('ready');
}

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.replace('/login');
    return;
  }

  if (typeof window.__mexRequireLocationAccess === 'function') {
    await window.__mexRequireLocationAccess({
      title: 'Ubicacion obligatoria para administracion',
      copy: 'Activa tu ubicación exacta antes de abrir el panel administrativo para auditar cambios globales y permisos.',
      allowLogout: true,
      force: false
    });
  }

  const frame = document.getElementById('gestionRouteFrame');
  if (!frame) return;
  if (routeIsWarm()) markFrameReady();
  frame.addEventListener('load', markFrameReady, { once: true });
  frame.src = buildGestionFrameUrl();
});
