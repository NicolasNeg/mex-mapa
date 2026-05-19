// ═══════════════════════════════════════════════════════════
//  /js/programador/views/overview.js
//  Dashboard principal del panel programador.
//  Muestra salud del sistema, stats SaaS y actividad reciente.
// ═══════════════════════════════════════════════════════════

let _container = null;

export async function mount({ container, navigate }) {
  _container = container;
  container.innerHTML = _skeleton();

  // Cargar datos en paralelo
  const [health, saasStats, recentActivity] = await Promise.all([
    _collectHealth(),
    _collectSaasStats(),
    _collectRecentActivity(),
  ]);

  if (_container) {
    _container.innerHTML = _html(health, saasStats, recentActivity, navigate);
    _bind(navigate);
  }
}

export function unmount() {
  _container = null;
}

// ── Datos ─────────────────────────────────────────────────

async function _collectHealth() {
  const hasDb      = Boolean(window._db);
  const hasAuth    = Boolean(window._auth);
  const hasStorage = Boolean(window._storage);
  const apiCount   = Object.keys(window.api || {}).length;

  const host = window.location.host;
  const env  = host.includes('localhost') ? 'local'
             : host.includes('web.app') || host.includes('firebaseapp.com') ? 'production'
             : 'custom';

  const swVersion = await _swVersion();
  const swControlled = Boolean(navigator.serviceWorker?.controller);

  const persistenceEnabled = window._firestorePersistenceEnabled === true;

  return { hasDb, hasAuth, hasStorage, apiCount, env, host, swVersion, swControlled, persistenceEnabled };
}

async function _collectSaasStats() {
  if (!window._db) return { totalEmpresas: 0, totalPlazas: 0, empresas: [] };
  try {
    const snap = await window._db.collection('empresas').get();
    const empresas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const totalPlazas = empresas.reduce((acc, e) => {
      const p = Array.isArray(e.plazas) ? e.plazas.length : Object.keys(e.plazasDetalle || {}).length;
      return acc + p;
    }, 0);
    const byPlan = {};
    empresas.forEach(e => { const p = e.plan || 'free'; byPlan[p] = (byPlan[p] || 0) + 1; });
    return { totalEmpresas: empresas.length, totalPlazas, byPlan, empresas };
  } catch (_) {
    return { totalEmpresas: '—', totalPlazas: '—', byPlan: {}, empresas: [] };
  }
}

async function _collectRecentActivity() {
  if (!window._db) return [];
  try {
    const snap = await window._db.collection('bitacora_gestion')
      .orderBy('timestamp', 'desc').limit(15).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) { return []; }
}

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

// ── Bind ──────────────────────────────────────────────────

function _bind(navigate) {
  _container?.addEventListener('click', e => {
    const card = e.target.closest('[data-nav-to]');
    if (card && navigate) {
      navigate(card.dataset.navTo);
    }
  });
}

// ── HTML ──────────────────────────────────────────────────

function _html(health, saas, activity, navigate) {
  const firebaseOk = health.hasDb && health.hasAuth;
  return `
<div style="padding:24px 28px;max-width:1400px;margin:0 auto;">

  <!-- Título -->
  <div style="margin-bottom:22px;">
    <h2 style="margin:0 0 4px;font-size:21px;font-weight:800;color:#fff;">System Overview</h2>
    <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.3);">${health.host} · ${health.env}</p>
  </div>

  <!-- Fila 1: Salud del sistema -->
  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:12px;">
    ${_healthCard('Firebase', firebaseOk ? 'Operacional' : 'Error', firebaseOk ? '#10b981' : '#ef4444', 'database',
      `db:${health.hasDb?'✓':'✗'} auth:${health.hasAuth?'✓':'✗'} storage:${health.hasStorage?'✓':'✗'}`)}
    ${_healthCard('Service Worker', health.swVersion, health.swControlled ? '#10b981' : '#f59e0b', 'settings_suggest',
      health.swControlled ? 'Controlando página' : 'Sin control activo')}
    ${_healthCard('window.api', `${health.apiCount} funciones`, '#6366f1', 'api',
      `Firestore persistence: ${health.persistenceEnabled ? 'on' : 'off'}`)}
    ${_healthCard('Ambiente', health.env.toUpperCase(), health.env === 'production' ? '#f59e0b' : '#10b981', 'cloud',
      health.host)}
  </div>

  <!-- Fila 2: Stats SaaS -->
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:12px;">
    ${_statCard('Empresas registradas', saas.totalEmpresas, 'domain', '#6366f1', '/programador/saas')}
    ${_statCard('Plazas totales', saas.totalPlazas, 'location_on', '#0ea5e9', null)}
    ${_statCard('Actividad reciente', `${activity.length} eventos`, 'history', '#8b5cf6', '/programador/logs')}
  </div>

  <!-- Fila 3: Plan breakdown + Actividad reciente -->
  <div style="display:grid;grid-template-columns:280px 1fr;gap:12px;margin-bottom:12px;">

    <!-- Plan breakdown -->
    <div style="${_card()}">
      <div style="${_cardTitle()}">Tenants por plan</div>
      ${Object.keys(saas.byPlan || {}).length
        ? Object.entries(saas.byPlan).map(([plan, count]) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;">
            <span style="color:rgba(255,255,255,0.55);text-transform:capitalize;">${_esc(plan)}</span>
            <span style="font-weight:800;color:#fff;font-size:15px;">${count}</span>
          </div>`).join('')
        : `<div style="font-size:12px;color:rgba(255,255,255,0.25);padding:12px 0;">Sin datos</div>`}
      ${saas.totalEmpresas > 0 ? `
      <div style="margin-top:12px;">
        <a data-prog-route="/programador/saas" href="/programador/saas" style="font-size:12px;color:#818cf8;text-decoration:none;display:flex;align-items:center;gap:5px;">
          Ver todas las empresas
          <span class="material-symbols-outlined" style="font-size:13px;">arrow_forward</span>
        </a>
      </div>` : ''}
    </div>

    <!-- Actividad reciente -->
    <div style="${_card()}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="${_cardTitle()}margin-bottom:0;">Actividad reciente</div>
        <a data-prog-route="/programador/logs" href="/programador/logs" style="font-size:11px;color:#818cf8;text-decoration:none;">Ver todos →</a>
      </div>
      ${activity.length ? `
      <div style="overflow:auto;max-height:280px;">
        <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
          <thead>
            <tr style="color:rgba(255,255,255,0.3);">
              <th style="text-align:left;padding:0 0 8px;font-weight:600;font-size:10px;text-transform:uppercase;">Fecha</th>
              <th style="text-align:left;padding:0 0 8px;font-weight:600;font-size:10px;text-transform:uppercase;">Actor</th>
              <th style="text-align:left;padding:0 0 8px;font-weight:600;font-size:10px;text-transform:uppercase;">Acción</th>
              <th style="text-align:left;padding:0 0 8px;font-weight:600;font-size:10px;text-transform:uppercase;">Detalle</th>
            </tr>
          </thead>
          <tbody>
            ${activity.map(ev => `
            <tr style="border-top:1px solid rgba(255,255,255,0.04);">
              <td style="padding:6px 8px 6px 0;color:rgba(255,255,255,0.3);white-space:nowrap;font-family:monospace;font-size:10px;">${_relTime(ev.timestamp || ev.fecha)}</td>
              <td style="padding:6px 8px;color:rgba(255,255,255,0.55);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(ev.actor || ev.usuario || '—')}</td>
              <td style="padding:6px 8px;color:#a5b4fc;white-space:nowrap;">${_esc(ev.accion || ev.tipo || '—')}</td>
              <td style="padding:6px 0;color:rgba(255,255,255,0.4);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(ev.descripcion || ev.detalles || ev.referencia || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<div style="font-size:12px;color:rgba(255,255,255,0.25);padding:20px 0;text-align:center;">Sin actividad registrada</div>`}
    </div>
  </div>

  <!-- Quick nav -->
  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;">
    ${_quickCard('Empresas · SaaS', 'Gestionar tenants, planes y features', 'domain', '#6366f1', '/programador/saas')}
    ${_quickCard('Diagnóstico', 'Firebase, API, flags del sistema', 'terminal', '#0ea5e9', '/programador/tecnico')}
    ${_quickCard('Deploy', 'Smoke check, cache, release', 'rocket_launch', '#10b981', '/programador/deploy')}
    ${_quickCard('Logs', 'Bitácora de gestión y auditoría', 'list_alt', '#f59e0b', '/programador/logs')}
  </div>
</div>`;
}

function _healthCard(title, value, color, icon, sub) {
  return `
<div style="${_card()}display:flex;flex-direction:column;gap:6px;">
  <div style="display:flex;align-items:center;gap:8px;">
    <span class="material-symbols-outlined" style="font-size:20px;color:${_esc(color)};">${_esc(icon)}</span>
    <span style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:600;">${_esc(title)}</span>
  </div>
  <div style="font-size:15px;font-weight:800;color:#fff;">${_esc(value)}</div>
  <div style="font-size:10px;color:rgba(255,255,255,0.25);font-family:monospace;">${_esc(sub)}</div>
</div>`;
}

function _statCard(label, value, icon, color, route) {
  const clickable = route ? `data-nav-to="${_esc(route)}" style="${_card()}cursor:pointer;"` : `style="${_card()}"`;
  return `
<div ${clickable}>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
    <span style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:600;">${_esc(label)}</span>
    <span class="material-symbols-outlined" style="font-size:18px;color:${_esc(color)};">${_esc(icon)}</span>
  </div>
  <div style="font-size:26px;font-weight:900;color:#fff;">${_esc(String(value))}</div>
  ${route ? `<div style="font-size:10px;color:${_esc(color)};margin-top:6px;display:flex;align-items:center;gap:4px;"><span class="material-symbols-outlined" style="font-size:12px;">arrow_forward</span>Ver detalle</div>` : ''}
</div>`;
}

function _quickCard(title, desc, icon, color, route) {
  return `
<a data-prog-route="${_esc(route)}" href="${_esc(route)}" style="
  ${_card()}display:flex;flex-direction:column;gap:8px;
  text-decoration:none;cursor:pointer;
  transition:background .14s,border-color .14s;
">
  <span class="material-symbols-outlined" style="font-size:22px;color:${_esc(color)};">${_esc(icon)}</span>
  <div style="font-size:13px;font-weight:700;color:#fff;">${_esc(title)}</div>
  <div style="font-size:11px;color:rgba(255,255,255,0.35);line-height:1.4;">${_esc(desc)}</div>
</a>`;
}

// ── Shared styles ─────────────────────────────────────────
function _card() {
  return 'background:#0f1b2d;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:16px;';
}
function _cardTitle() {
  return 'font-size:12px;font-weight:700;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px;';
}

function _skeleton() {
  return `<div style="padding:24px 28px;display:flex;flex-direction:column;gap:12px;">
    ${[...Array(3)].map(() => `<div style="height:90px;background:rgba(255,255,255,0.04);border-radius:12px;animation:skelPulse 1.4s ease-in-out infinite;"></div>`).join('')}
    <style>@keyframes skelPulse{0%,100%{opacity:.4}50%{opacity:.9}}</style>
  </div>`;
}

function _relTime(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d.getTime();
  if (diff < 60000)  return 'hace ' + Math.floor(diff / 1000) + 's';
  if (diff < 3600000) return 'hace ' + Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return 'hace ' + Math.floor(diff / 3600000) + 'h';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
