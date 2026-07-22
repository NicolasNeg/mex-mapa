// ═══════════════════════════════════════════════════════════
//  /js/programador/views/deploy.js
//  Smoke check, cache, release readiness — herramientas de deploy.
// ═══════════════════════════════════════════════════════════

let _container = null;

const APP_ROUTES = [
  '/app/dashboard', '/app/mapa',
  '/app/incidencias', '/app/cuadre', '/app/admin', '/app/programador', '/app/profile',
  '/programador', '/programador/overview',
];

const APP_ASSETS = [
  '/js/app/main.js', '/js/programador/main.js', '/css/shell.css',
  '/app.html', '/programador.html', '/sw.js', '/js/core/firebase-config.js',
  '/mex-api.js',
];

export async function mount({ container }) {
  _container = container;
  container.innerHTML = await _html();
  _bind();
}

export function unmount() {
  _container = null;
}

// ── HTML ──────────────────────────────────────────────────

async function _html() {
  const swVersion    = await _swVersion();
  const swControlled = Boolean(navigator.serviceWorker?.controller);
  const swState      = (await navigator.serviceWorker?.getRegistration?.().catch(() => null))?.active?.state || '—';
  const host         = window.location.host;
  const env          = host.includes('localhost') ? 'LOCAL' : host.includes('web.app') || host.includes('firebaseapp.com') ? 'PRODUCTION' : 'CUSTOM';
  const apiCount     = Object.keys(window.api || {}).length;

  return `
<div style="padding:24px 28px;max-width:1100px;margin:0 auto;">

  <div style="margin-bottom:22px;">
    <h2 style="margin:0 0 4px;font-size:21px;font-weight:800;color:#fff;">Deploy & Release</h2>
    <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.3);">Smoke check, estado del Service Worker y herramientas de release</p>
  </div>

  <!-- Estado general -->
  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:18px;">
    ${_infoCard('SW Version', swVersion, 'settings_suggest', swControlled?'#10b981':'#f59e0b')}
    ${_infoCard('SW Estado', swState, 'hub', swState==='activated'?'#10b981':'#f59e0b')}
    ${_infoCard('Ambiente', env, 'cloud', env==='PRODUCTION'?'#f59e0b':'#10b981')}
    ${_infoCard('window.api', `${apiCount} fns`, 'api', apiCount>0?'#6366f1':'#ef4444')}
  </div>

  <!-- Smoke check -->
  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:18px;margin-bottom:14px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10px;">
      <div>
        <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:3px;">Smoke Check</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.3);">Peticiones HEAD/GET al mismo origen — sin escrituras Firestore</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="depSmokeBtn" type="button" style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">
          <span class="material-symbols-outlined" style="font-size:15px;">play_arrow</span>Ejecutar smoke check
        </button>
        <button id="depCopyReleaseBtn" type="button" style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:12px;font-family:Inter,sans-serif;font-weight:700;cursor:pointer;">
          <span class="material-symbols-outlined" style="font-size:15px;">content_copy</span>Copiar reporte
        </button>
      </div>
    </div>

    <!-- Resultados rutas -->
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px;">
      <div style="background:#070d16;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:8px;">Rutas App</div>
        ${APP_ROUTES.map((r, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px;">
          <span style="color:rgba(255,255,255,0.5);font-family:monospace;">${_esc(r)}</span>
          <span id="smoke-route-${i}" style="color:rgba(255,255,255,0.2);font-weight:800;">—</span>
        </div>`).join('')}
      </div>
      <div style="background:#070d16;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:8px;">Assets críticos</div>
        ${APP_ASSETS.map((r, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px;">
          <span style="color:rgba(255,255,255,0.5);font-family:monospace;">${_esc(r)}</span>
          <span id="smoke-asset-${i}" style="color:rgba(255,255,255,0.2);font-weight:800;">—</span>
        </div>`).join('')}
      </div>
    </div>

    <!-- Output -->
    <pre id="depSmokeOutput" style="margin:0;padding:12px;background:#070d16;color:#a5b4fc;border-radius:8px;font-size:11px;overflow:auto;max-height:200px;border:1px solid rgba(255,255,255,0.06);">Pulsa "Ejecutar smoke check" para comenzar.</pre>
  </div>

  <!-- Cache info -->
  <div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:18px;">
    <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:12px;">Service Worker & Cache</div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:14px;">
      ${_row('Versión cache', swVersion)}
      ${_row('Estado SW', swState)}
      ${_row('Control página', swControlled ? 'Sí' : 'No')}
      ${_row('Host', host)}
      ${_row('Ambiente', env)}
      ${_row('window.api', `${apiCount} funciones`)}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button id="depReloadBtn" type="button" style="display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:7px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:12px;font-family:Inter,sans-serif;font-weight:600;cursor:pointer;">
        <span class="material-symbols-outlined" style="font-size:15px;">refresh</span>Recargar página
      </button>
      <button id="depClearCacheBtn" type="button" style="display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:7px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);color:#f87171;font-size:12px;font-family:Inter,sans-serif;font-weight:600;cursor:pointer;">
        <span class="material-symbols-outlined" style="font-size:15px;">delete_sweep</span>Limpiar cache SW
      </button>
    </div>
    <div id="depCacheStatus" style="margin-top:10px;font-size:11px;color:rgba(255,255,255,0.35);"></div>
  </div>
</div>`;
}

// ── Bind ──────────────────────────────────────────────────

function _bind() {
  _container?.querySelector('#depSmokeBtn')?.addEventListener('click', _runSmoke);
  _container?.querySelector('#depCopyReleaseBtn')?.addEventListener('click', _copyRelease);
  _container?.querySelector('#depReloadBtn')?.addEventListener('click', () => window.location.reload());
  _container?.querySelector('#depClearCacheBtn')?.addEventListener('click', _clearCache);
}

async function _runSmoke() {
  const btn = _container?.querySelector('#depSmokeBtn');
  const output = _container?.querySelector('#depSmokeOutput');
  if (btn) { btn.disabled = true; btn.querySelector('span:last-child') && (btn.lastChild.textContent = 'Ejecutando…'); }
  if (output) output.textContent = 'Iniciando smoke check…\n';

  const lines = [];
  let routeOk = 0, assetOk = 0;

  for (let i = 0; i < APP_ROUTES.length; i++) {
    const path = APP_ROUTES[i];
    const ok = await _probe(path);
    const el = _container?.querySelector(`#smoke-route-${i}`);
    if (el) { el.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true" style="font-size:16px;">${ok ? 'check_circle' : 'cancel'}</span>`; el.style.color = ok ? '#10b981' : '#ef4444'; }
    lines.push(`${ok?'OK  ':'FAIL'} ${path}`);
    if (ok) routeOk++;
  }

  lines.push('');
  lines.push('Assets:');

  for (let i = 0; i < APP_ASSETS.length; i++) {
    const path = APP_ASSETS[i];
    const ok = await _probe(path);
    const el = _container?.querySelector(`#smoke-asset-${i}`);
    if (el) { el.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true" style="font-size:16px;">${ok ? 'check_circle' : 'cancel'}</span>`; el.style.color = ok ? '#10b981' : '#ef4444'; }
    lines.push(`${ok?'OK  ':'FAIL'} ${path}`);
    if (ok) assetOk++;
  }

  lines.push('');
  lines.push(`Resultado: ${routeOk}/${APP_ROUTES.length} rutas · ${assetOk}/${APP_ASSETS.length} assets`);
  if (output) output.textContent = lines.join('\n');
  if (btn) { btn.disabled = false; if (btn.lastChild) btn.lastChild.textContent = 'Ejecutar smoke check'; }
}

async function _probe(path) {
  try {
    let r = await fetch(path, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok && r.status !== 304) r = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    return r.ok || r.status === 304;
  } catch (_) { return false; }
}

async function _copyRelease() {
  const swV = await _swVersion();
  const output = _container?.querySelector('#depSmokeOutput')?.textContent || '(ejecuta smoke antes)';
  const report = [
    `Host: ${window.location.host}`,
    `Ambiente: ${window.location.host.includes('localhost')?'LOCAL':'PRODUCTION'}`,
    `SW: ${swV}`,
    `window.api: ${Object.keys(window.api||{}).length} funciones`,
    `Fecha: ${new Date().toISOString()}`,
    '', 'Smoke:', output,
  ].join('\n');
  try {
    await navigator.clipboard.writeText(report);
    const statusEl = _container?.querySelector('#depCacheStatus');
    if (statusEl) { statusEl.textContent = 'Reporte copiado al portapapeles.'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000); }
  } catch (_) {}
}

async function _clearCache() {
  const statusEl = _container?.querySelector('#depCacheStatus');
  if (!confirm('¿Limpiar todos los caches del Service Worker?')) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    if (statusEl) statusEl.textContent = `${keys.length} cache${keys.length!==1?'s':''} eliminado${keys.length!==1?'s':''}. Recarga para re-cachear.`;
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Error: ' + err.message;
  }
}

// ── Utils ─────────────────────────────────────────────────

async function _swVersion() {
  if (!navigator.serviceWorker?.controller) return 'sin control';
  return new Promise(resolve => {
    const ch = new MessageChannel();
    const t  = setTimeout(() => resolve('—'), 1200);
    ch.port1.onmessage = ev => { clearTimeout(t); resolve(ev?.data?.version || '—'); };
    try { navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]); }
    catch (_) { clearTimeout(t); resolve('—'); }
  });
}

function _infoCard(label, value, icon, color) {
  return `<div style="background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px 16px;">
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;">
      <span class="material-symbols-outlined" style="font-size:18px;color:${_esc(color)};">${_esc(icon)}</span>
      <span style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:600;">${_esc(label)}</span>
    </div>
    <div style="font-size:14px;font-weight:800;color:#fff;font-family:monospace;">${_esc(value)}</div>
  </div>`;
}

function _row(label, value) {
  return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;">
    <span style="color:rgba(255,255,255,0.4);">${_esc(label)}</span>
    <span style="color:rgba(255,255,255,0.75);font-weight:700;font-family:monospace;">${_esc(value)}</span>
  </div>`;
}

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
