import { getState } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';

let _container = null;
let _copyHandler = null;

export async function mount({ container }) {
  _container = container;
  const info = await _collectDiagnostics();
  container.innerHTML = _html(info);
  const btn = container.querySelector('#progCopySummary');
  _copyHandler = () => _copySummary(info);
  btn?.addEventListener('click', _copyHandler);
}

export function unmount() {
  if (_container && _copyHandler) {
    _container.querySelector('#progCopySummary')?.removeEventListener('click', _copyHandler);
  }
  _copyHandler = null;
  _container = null;
}

async function _collectDiagnostics() {
  const st = getState();
  const profile = st.profile || {};
  const roleLabel = ROLE_LABELS[st.role] || st.role || 'AUXILIAR';
  const swReg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  const swControlled = Boolean(navigator.serviceWorker?.controller);
  const swScope = swReg?.scope || '—';
  const swState = swReg?.active?.state || swReg?.installing?.state || 'sin registro';
  const swVersion = await _resolveSwVersion();
  const hasDb = Boolean(window._db);
  const hasAuth = Boolean(window._auth);
  const hasStorage = Boolean(window._storage);
  const apiKeys = Object.keys(window.api || {});
  const appShell = {
    route: st.currentRoute || window.location.pathname,
    currentPlaza: st.currentPlaza || '',
    availablePlazas: Array.isArray(st.availablePlazas) ? st.availablePlazas : [],
    canSwitchPlaza: Boolean(st.canSwitchPlaza)
  };
  const host = window.location.host;
  const env = host.includes('localhost') ? 'local' : (host.includes('web.app') || host.includes('firebaseapp.com') ? 'production' : 'custom');
  const programmerErrorsAvailable = Boolean(window._db);
  return {
    user: profile.nombreCompleto || profile.nombre || profile.usuario || profile.email || 'Usuario',
    roleLabel,
    plaza: st.currentPlaza || profile.plazaAsignada || profile.plaza || '—',
    host,
    env,
    sw: { swControlled, swScope, swState, swVersion },
    firebase: { hasDb, hasAuth, hasStorage },
    api: { available: Boolean(window.api), count: apiKeys.length },
    appShell,
    errors: { source: programmerErrorsAvailable ? 'programmer_errors (disponible)' : 'no disponible en runtime' }
  };
}

async function _resolveSwVersion() {
  if (!navigator.serviceWorker?.controller) return 'sin control';
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve('desconocida'), 1200);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      resolve(event?.data?.version || 'desconocida');
    };
    try {
      navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    } catch (_) {
      clearTimeout(timer);
      resolve('desconocida');
    }
  });
}

function _summaryText(info) {
  return [
    `Usuario: ${info.user}`,
    `Rol: ${info.roleLabel}`,
    `Plaza activa: ${info.plaza}`,
    `Host: ${info.host} (${info.env})`,
    `SW: ${info.sw.swVersion} | estado: ${info.sw.swState} | control: ${info.sw.swControlled ? 'si' : 'no'}`,
    `Firebase: auth=${info.firebase.hasAuth} firestore=${info.firebase.hasDb} storage=${info.firebase.hasStorage}`,
    `window.api: ${info.api.available ? 'si' : 'no'} (${info.api.count} funciones)`,
    `AppShell ruta: ${info.appShell.route}`,
    `AppShell plazas: ${info.appShell.availablePlazas.join(', ') || '—'}`
  ].join('\n');
}

async function _copySummary(info) {
  const text = _summaryText(info);
  const status = _container?.querySelector('#progCopyStatus');
  try {
    await navigator.clipboard.writeText(text);
    if (status) status.textContent = 'Resumen copiado al portapapeles.';
  } catch (_) {
    if (status) status.textContent = 'No se pudo copiar automáticamente.';
  }
}

function _html(info) {
  return `
<div style="padding:22px;max-width:1060px;margin:0 auto;font-family:Inter,sans-serif;">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
    <h1 style="margin:0;font-size:26px;color:#0f172a;">Consola técnica (read-only)</h1>
    <a href="/programador" style="font-size:12px;color:#0f172a;">Abrir consola completa</a>
  </div>
  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px;">
    ${_card('Usuario', info.user)}
    ${_card('Rol', info.roleLabel)}
    ${_card('Plaza activa', info.plaza)}
    ${_card('Host/Ambiente', `${info.host} · ${info.env}`)}
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:12px;">
    ${_card('Service Worker', `${info.sw.swVersion} · ${info.sw.swState}`)}
    ${_card('Firebase', `auth:${info.firebase.hasAuth ? 'ok' : 'no'} · db:${info.firebase.hasDb ? 'ok' : 'no'} · storage:${info.firebase.hasStorage ? 'ok' : 'no'}`)}
    ${_card('window.api', `${info.api.available ? 'disponible' : 'no disponible'} · ${info.api.count} funciones`)}
  </div>
  <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;">
    <div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:12px;">
      <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a;">Estado App Shell</h3>
      ${_row('Ruta actual', info.appShell.route)}
      ${_row('currentPlaza', info.appShell.currentPlaza || '—')}
      ${_row('availablePlazas', info.appShell.availablePlazas.join(', ') || '—')}
      ${_row('canSwitchPlaza', info.appShell.canSwitchPlaza ? 'true' : 'false')}
      ${_row('SW controlado', info.sw.swControlled ? 'sí' : 'no')}
      ${_row('SW scope', info.sw.swScope)}
    </div>
    <div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:12px;">
      <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a;">Observabilidad</h3>
      ${_row('Errores', info.errors.source)}
      <div style="margin-top:10px;padding:10px;border-radius:8px;background:#f8fafc;color:#475569;font-size:12px;">
        Acciones peligrosas bloqueadas en esta fase: limpiar cache, resetear SW, modificar Firestore/usuarios/roles/settings y ejecutar jobs.
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <button id="progCopySummary" type="button" style="border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;">Copiar resumen técnico</button>
        <a href="/programador" style="border:1px solid #0f172a;background:#0f172a;color:#fff;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;text-decoration:none;">Abrir legacy</a>
      </div>
      <div id="progCopyStatus" style="margin-top:8px;font-size:11px;color:#64748b;"></div>
    </div>
  </div>
</div>`;
}

function _card(label, value) {
  return `<div style="border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:10px;">
    <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;font-weight:800;">${esc(label)}</div>
    <div style="font-size:13px;color:#0f172a;font-weight:700;word-break:break-word;">${esc(value)}</div>
  </div>`;
}

function _row(k, v) {
  return `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
    <strong style="color:#64748b;">${esc(k)}</strong><span style="color:#0f172a;text-align:right;">${esc(v)}</span>
  </div>`;
}

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
