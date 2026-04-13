import { auth, db, COL, functions } from '/js/core/database.js';
import { configureNotifications, initNotificationCenter } from '/js/core/notifications.js';
import { installProgrammerErrorReporter, reportProgrammerError } from '/js/core/observability.js';

const PROGRAMMER_ROLES = new Set(['PROGRAMADOR', 'JEFE_OPERACION', 'CORPORATIVO_USER']);
const state = {
  profile: null,
  tab: 'resumen',
  plaza: '',
  overview: null,
  queryRows: [],
  queryName: 'ops_events',
  querySearch: '',
  queryLimit: 50,
  jobResult: null,
  jobsRows: [],
  errorsRows: [],
  devicesRows: [],
  notificationsRows: [],
  opsRows: [],
  settingsGlobal: {},
  settingsPlaza: {},
  configMode: 'plaza'
};

function safe(value) {
  return String(value ?? '').trim();
}

function upper(value) {
  return safe(value).toUpperCase();
}

function lower(value) {
  return safe(value).toLowerCase();
}

function escapeHtml(value) {
  return safe(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inferRole(data = {}) {
  const role = upper(data.rol);
  if (PROGRAMMER_ROLES.has(role) || role === 'VENTAS' || role === 'GERENTE_PLAZA' || role === 'JEFE_REGIONAL' || role === 'AUXILIAR') return role;
  if (data.isGlobal === true) return 'CORPORATIVO_USER';
  if (data.isAdmin === true) return 'VENTAS';
  return 'AUXILIAR';
}

function currentUserLabel() {
  return safe(state.profile?.nombre || state.profile?.email || '');
}

function availablePlazas() {
  const plazasDetalle = Array.isArray(window.MEX_CONFIG?.empresa?.plazasDetalle) ? window.MEX_CONFIG.empresa.plazasDetalle : [];
  const direct = Array.isArray(window.MEX_CONFIG?.empresa?.plazas) ? window.MEX_CONFIG.empresa.plazas : [];
  return [...new Set([...direct, ...plazasDetalle.map(item => item?.id)].map(upper).filter(Boolean))];
}

function callable(name) {
  if (!functions) return null;
  return functions.httpsCallable(name);
}

async function loadProgrammerConfig() {
  try {
    if (window.api?.obtenerConfiguracion) {
      const config = await window.api.obtenerConfiguracion(state.profile?.plazaAsignada || '');
      if (config) window.MEX_CONFIG = config;
    }
  } catch (error) {
    console.warn('No se pudo cargar MEX_CONFIG en /programador:', error);
  }
}

async function resolveProfile(user) {
  const email = lower(user?.email || '');
  if (!email) return null;
  const [direct, byEmail] = await Promise.all([
    db.collection(COL.USERS).doc(email).get(),
    db.collection(COL.USERS).where('email', '==', email).limit(1).get()
  ]);
  const doc = direct.exists ? direct : (!byEmail.empty ? byEmail.docs[0] : null);
  if (!doc) return null;
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    email,
    nombre: upper(data.nombre || data.usuario || email),
    rol: inferRole(data),
    plazaAsignada: upper(data.plazaAsignada || data.plaza || '')
  };
}

function setLoading(message = 'Cargando...') {
  const root = document.getElementById('programmerApp');
  if (!root) return;
  root.innerHTML = `
    <div class="programmer-page-loading">
      <span class="material-icons spinner">sync</span>
      <strong>${escapeHtml(message)}</strong>
    </div>
  `;
}

function showToast(message, type = 'success') {
  if (window.showToast) {
    window.showToast(message, type);
    return;
  }
  const existing = document.getElementById('programmer-toast');
  existing?.remove();
  const toast = document.createElement('div');
  toast.id = 'programmer-toast';
  toast.className = `programmer-inline-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function isAllowed() {
  return PROGRAMMER_ROLES.has(upper(state.profile?.rol));
}

function renderShell() {
  const root = document.getElementById('programmerApp');
  if (!root) return;
  const plazas = availablePlazas();
  const tabButtons = [
    ['resumen', 'Resumen'],
    ['notificaciones', 'Notificaciones'],
    ['consultas', 'Consultas'],
    ['jobs', 'Jobs'],
    ['config', 'Config'],
    ['errores', 'Errores'],
    ['dispositivos', 'Dispositivos']
  ];
  root.innerHTML = `
    <div class="programmer-page-topbar">
      <div>
        <div class="programmer-console-kicker">Ruta dedicada</div>
        <h1>Consola de programador</h1>
        <p>Operación global, notificaciones reales, queries seguras, auditoría y mantenimiento de la plataforma.</p>
      </div>
      <div class="programmer-page-top-actions">
        <button type="button" class="programmer-page-btn" onclick="window.location.href='/mapa'">
          <span class="material-icons">arrow_back</span>
          Volver al mapa
        </button>
        <button type="button" class="programmer-page-btn primary" id="programmerRefreshAllBtn">
          <span class="material-icons">refresh</span>
          Refrescar
        </button>
      </div>
    </div>

    <div class="programmer-page-statusbar">
      <span class="programmer-status-pill">${escapeHtml(currentUserLabel())}</span>
      <span class="programmer-status-pill">${escapeHtml(state.profile?.rol || '')}</span>
      <span class="programmer-status-pill">${escapeHtml(state.profile?.plazaAsignada || 'GLOBAL')}</span>
      <span class="programmer-status-pill">${escapeHtml(window.FIREBASE_CONFIG?.projectId || '')}</span>
    </div>

    <div class="programmer-page-nav">
      ${tabButtons.map(([key, label]) => `
        <button type="button" class="programmer-nav-btn ${state.tab === key ? 'active' : ''}" data-tab="${key}">${label}</button>
      `).join('')}
    </div>

    <div id="programmerTabContent" class="programmer-tab-content"></div>

    <div class="programmer-bottom-bar">
      <label class="programmer-inline-control">
        <span>Plaza foco</span>
        <select id="programmerGlobalPlazaSelect">
          <option value="">GLOBAL</option>
          ${plazas.map(plaza => `<option value="${escapeHtml(plaza)}" ${plaza === state.plaza ? 'selected' : ''}>${escapeHtml(plaza)}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="programmer-page-btn" id="programmerOpenNotifBtn">
        <span class="material-icons">notifications_active</span>
        Centro de notificaciones
      </button>
    </div>
  `;

  root.querySelectorAll('.programmer-nav-btn').forEach(button => {
    button.addEventListener('click', () => {
      state.tab = button.dataset.tab;
      renderShell();
      renderCurrentTab();
    });
  });
  document.getElementById('programmerRefreshAllBtn')?.addEventListener('click', () => refreshAll());
  document.getElementById('programmerGlobalPlazaSelect')?.addEventListener('change', event => {
    state.plaza = upper(event.target.value || '');
    if (state.tab === 'config') loadSettingsPreview();
    else refreshAll();
  });
  document.getElementById('programmerOpenNotifBtn')?.addEventListener('click', () => {
    window.openNotificationCenter?.();
  });

  renderCurrentTab();
}

function summaryCardsHtml() {
  const overview = state.overview || {};
  const cards = [
    ['Usuarios', overview.usersCount || 0, 'badge'],
    ['Devices', overview.devicesCount || 0, 'devices'],
    ['Inbox sin leer', overview.unreadInboxCount || 0, 'mark_chat_unread'],
    ['Ops events', overview.opsEventsCount || 0, 'timeline'],
    ['Jobs', overview.jobsCount || 0, 'inventory_2'],
    ['Errores', overview.errorsCount || 0, 'bug_report']
  ];
  return cards.map(([label, value, icon]) => `
    <div class="programmer-metric-card">
      <div class="programmer-metric-icon"><span class="material-icons">${icon}</span></div>
      <div>
        <span>${label}</span>
        <strong>${escapeHtml(String(value))}</strong>
      </div>
    </div>
  `).join('');
}

function rowsToTable(rows = []) {
  if (!rows.length) {
    return `<div class="programmer-empty-state">
      <span class="material-icons">inbox</span>
      <strong>Sin resultados</strong>
      <p>No hay datos para mostrar con los filtros actuales.</p>
    </div>`;
  }
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))].slice(0, 8);
  return `
    <div class="programmer-table-wrap">
      <table class="programmer-table">
        <thead>
          <tr>${keys.map(key => `<th>${escapeHtml(key)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              ${keys.map(key => `<td>${escapeHtml(typeof row[key] === 'object' ? JSON.stringify(row[key]) : String(row[key] ?? ''))}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderResumenTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Salud general</h3>
        <span>Resumen de plataforma e indicadores beta</span>
      </div>
      <div class="programmer-metrics-grid">${summaryCardsHtml()}</div>
    </section>
    <section class="programmer-two-col">
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Últimos ops events</h4>
          <span>Stream unificado</span>
        </div>
        ${rowsToTable(state.opsRows.slice(0, 12))}
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Últimos jobs</h4>
          <span>Dry-run y producción</span>
        </div>
        ${rowsToTable(state.jobsRows.slice(0, 10))}
      </div>
    </section>
  `;
}

function renderNotificacionesTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Notificaciones reales</h3>
        <span>Inbox, delivery y prueba manual</span>
      </div>
      <div class="programmer-notification-actions">
        <input id="programmerTestTarget" class="programmer-input" type="text" placeholder="Correo o nombre del usuario">
        <input id="programmerTestTitle" class="programmer-input" type="text" placeholder="Título de prueba">
        <input id="programmerTestBody" class="programmer-input" type="text" placeholder="Mensaje de prueba">
        <button type="button" class="programmer-page-btn primary" id="programmerSendTestNotifBtn">
          <span class="material-icons">send</span>
          Enviar prueba
        </button>
      </div>
    </section>
    <section class="programmer-two-col">
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Inbox reciente</h4>
          <span>collectionGroup(inbox)</span>
        </div>
        ${rowsToTable(state.notificationsRows.slice(0, 16))}
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Dispositivos recientes</h4>
          <span>Tokens, permisos y foco</span>
        </div>
        ${rowsToTable(state.devicesRows.slice(0, 16))}
      </div>
    </section>
  `;
  document.getElementById('programmerSendTestNotifBtn')?.addEventListener('click', async () => {
    const targetUser = safe(document.getElementById('programmerTestTarget')?.value);
    const title = safe(document.getElementById('programmerTestTitle')?.value) || 'Prueba MEX Mapa';
    const body = safe(document.getElementById('programmerTestBody')?.value) || 'Notificación de prueba desde consola.';
    if (!targetUser) {
      showToast('Indica el usuario o correo destino.', 'error');
      return;
    }
    await runJob('send-test-notification', { targetUser, title, body, dryRun: false });
    await refreshAll();
  });
}

function renderConsultasTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Consultas seguras</h3>
        <span>Consulta predefinida con filtro cliente</span>
      </div>
      <div class="programmer-query-bar">
        <select id="programmerQueryName" class="programmer-input">
          <option value="ops_events">Ops events</option>
          <option value="notifications">Inbox</option>
          <option value="devices">Devices</option>
          <option value="errors">Errores</option>
          <option value="jobs">Jobs</option>
          <option value="users">Usuarios</option>
          <option value="settings">Settings</option>
        </select>
        <input id="programmerQuerySearch" class="programmer-input" type="text" placeholder="Filtro local por texto">
        <input id="programmerQueryLimit" class="programmer-input small" type="number" min="10" max="150" value="${state.queryLimit}">
        <button id="programmerRunQueryBtn" type="button" class="programmer-page-btn primary">
          <span class="material-icons">manage_search</span>
          Ejecutar
        </button>
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Resultado</h4>
          <span>${escapeHtml(state.queryName)}</span>
        </div>
        ${rowsToTable(filteredQueryRows())}
      </div>
    </section>
  `;
  document.getElementById('programmerQueryName')?.addEventListener('change', event => {
    state.queryName = event.target.value;
  });
  document.getElementById('programmerQuerySearch')?.addEventListener('input', event => {
    state.querySearch = event.target.value;
    renderCurrentTab();
  });
  document.getElementById('programmerQueryLimit')?.addEventListener('change', event => {
    state.queryLimit = Math.min(150, Math.max(10, Number(event.target.value) || 50));
  });
  document.getElementById('programmerRunQueryBtn')?.addEventListener('click', () => runQuery(state.queryName));
}

function renderJobsTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  const resultHtml = state.jobResult
    ? `<pre class="programmer-code-block">${escapeHtml(JSON.stringify(state.jobResult, null, 2))}</pre>`
    : `<div class="programmer-empty-state"><span class="material-icons">build_circle</span><strong>Sin ejecución reciente</strong><p>Corre un job para ver el resultado aquí.</p></div>`;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Jobs operativos</h3>
        <span>Migraciones, validación y mantenimiento</span>
      </div>
      <div class="programmer-job-grid">
        <label class="programmer-job-card">
          <input type="checkbox" id="programmerDryRun" checked>
          <div>
            <strong>Dry-run por default</strong>
            <small>No muta datos hasta desmarcarlo.</small>
          </div>
        </label>
        <button type="button" class="programmer-page-btn" data-job="validate-plazas">Validar plazas</button>
        <button type="button" class="programmer-page-btn" data-job="backfill-ops-events">Backfill ops_events</button>
        <button type="button" class="programmer-page-btn" data-job="export-config">Exportar config</button>
        <button type="button" class="programmer-page-btn" data-job="cleanup-device-tokens">Limpiar tokens inválidos</button>
      </div>
    </section>
    <section class="programmer-two-col">
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Resultado del último job</h4>
          <span>JSON completo</span>
        </div>
        ${resultHtml}
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>Historial de jobs</h4>
          <span>programmer_jobs</span>
        </div>
        ${rowsToTable(state.jobsRows.slice(0, 18))}
      </div>
    </section>
  `;
  container.querySelectorAll('[data-job]').forEach(button => {
    button.addEventListener('click', () => {
      const dryRun = document.getElementById('programmerDryRun')?.checked !== false;
      runJob(button.dataset.job, { dryRun });
    });
  });
}

function renderConfigTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  const plazas = availablePlazas();
  const effective = {
    ...(state.settingsGlobal || {}),
    ...(state.settingsPlaza || {})
  };
  const editorSource = state.configMode === 'global' ? state.settingsGlobal : state.settingsPlaza;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Config diff</h3>
        <span>GLOBAL + plaza con preview efectivo y editor JSON</span>
      </div>
      <div class="programmer-query-bar">
        <select id="programmerConfigPlaza" class="programmer-input">
          <option value="">GLOBAL</option>
          ${plazas.map(plaza => `<option value="${escapeHtml(plaza)}" ${plaza === state.plaza ? 'selected' : ''}>${escapeHtml(plaza)}</option>`).join('')}
        </select>
        <select id="programmerConfigMode" class="programmer-input">
          <option value="plaza" ${state.configMode === 'plaza' ? 'selected' : ''}>Editar plaza</option>
          <option value="global" ${state.configMode === 'global' ? 'selected' : ''}>Editar GLOBAL</option>
        </select>
        <button id="programmerReloadConfigBtn" type="button" class="programmer-page-btn">
          <span class="material-icons">sync</span>
          Recargar
        </button>
        <button id="programmerSaveConfigBtn" type="button" class="programmer-page-btn primary">
          <span class="material-icons">save</span>
          Guardar JSON
        </button>
      </div>
    </section>
    <section class="programmer-three-col">
      <div class="programmer-panel">
        <div class="programmer-panel-head"><h4>GLOBAL</h4><span>settings/GLOBAL</span></div>
        <pre class="programmer-code-block">${escapeHtml(JSON.stringify(state.settingsGlobal || {}, null, 2))}</pre>
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head"><h4>Plaza</h4><span>settings/${escapeHtml(state.plaza || 'GLOBAL')}</span></div>
        <pre class="programmer-code-block">${escapeHtml(JSON.stringify(state.settingsPlaza || {}, null, 2))}</pre>
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head"><h4>Efectivo</h4><span>Overlay actual</span></div>
        <pre class="programmer-code-block">${escapeHtml(JSON.stringify(effective, null, 2))}</pre>
      </div>
    </section>
    <section class="programmer-panel">
      <div class="programmer-panel-head"><h4>Editor JSON</h4><span>${state.configMode === 'global' ? 'settings/GLOBAL' : `settings/${state.plaza || 'GLOBAL'}`}</span></div>
      <textarea id="programmerConfigEditor" class="programmer-json-editor">${escapeHtml(JSON.stringify(editorSource || {}, null, 2))}</textarea>
    </section>
  `;
  document.getElementById('programmerConfigPlaza')?.addEventListener('change', event => {
    state.plaza = upper(event.target.value || '');
    loadSettingsPreview();
  });
  document.getElementById('programmerConfigMode')?.addEventListener('change', event => {
    state.configMode = event.target.value;
    renderCurrentTab();
  });
  document.getElementById('programmerReloadConfigBtn')?.addEventListener('click', () => loadSettingsPreview());
  document.getElementById('programmerSaveConfigBtn')?.addEventListener('click', () => saveSettingsEditor());
}

function renderErroresTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Errores y observabilidad</h3>
        <span>Frontend y backend reunidos en la misma consola</span>
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>programmer_errors</h4>
          <span>${escapeHtml(String(state.errorsRows.length))} registros</span>
        </div>
        ${rowsToTable(state.errorsRows)}
      </div>
    </section>
  `;
}

function renderDispositivosTab() {
  const container = document.getElementById('programmerTabContent');
  if (!container) return;
  container.innerHTML = `
    <section class="programmer-section">
      <div class="programmer-section-head">
        <h3>Dispositivos y permisos</h3>
        <span>Diagnóstico rápido de tokens, foco y mute</span>
      </div>
      <div class="programmer-panel">
        <div class="programmer-panel-head">
          <h4>collectionGroup(devices)</h4>
          <span>Últimos dispositivos registrados</span>
        </div>
        ${rowsToTable(state.devicesRows)}
      </div>
    </section>
  `;
}

function renderCurrentTab() {
  if (state.tab === 'resumen') return renderResumenTab();
  if (state.tab === 'notificaciones') return renderNotificacionesTab();
  if (state.tab === 'consultas') return renderConsultasTab();
  if (state.tab === 'jobs') return renderJobsTab();
  if (state.tab === 'config') return renderConfigTab();
  if (state.tab === 'errores') return renderErroresTab();
  if (state.tab === 'dispositivos') return renderDispositivosTab();
}

function filteredQueryRows() {
  if (!state.querySearch) return state.queryRows;
  const term = lower(state.querySearch);
  return state.queryRows.filter(row => JSON.stringify(row).toLowerCase().includes(term));
}

async function runQuery(queryName) {
  try {
    const call = callable('queryProgrammerConsole');
    if (!call) throw new Error('Functions no disponibles');
    const res = await call({
      query: queryName,
      plaza: state.plaza,
      limit: state.queryLimit
    });
    state.queryRows = Array.isArray(res.data?.rows) ? res.data.rows : [];
    state.queryName = queryName;
    renderCurrentTab();
  } catch (error) {
    console.error('queryProgrammerConsole', error);
    showToast('No se pudo ejecutar la consulta.', 'error');
    reportProgrammerError({ kind: 'programmer.query', scope: 'programador', message: error.message, stack: error.stack });
  }
}

async function runJob(job, extra = {}) {
  try {
    const call = callable('runProgrammerJob');
    if (!call) throw new Error('Functions no disponibles');
    const res = await call({
      job,
      plaza: state.plaza,
      ...extra
    });
    state.jobResult = res.data?.result || null;
    showToast(`Job ${job} ejecutado correctamente.`, 'success');
    renderCurrentTab();
  } catch (error) {
    console.error('runProgrammerJob', error);
    showToast(error?.message || `No se pudo ejecutar ${job}.`, 'error');
    reportProgrammerError({ kind: 'programmer.job', scope: 'programador', message: error.message, stack: error.stack });
  }
}

async function loadSettingsPreview() {
  try {
    const [globalSnap, plazaSnap] = await Promise.all([
      db.collection('settings').doc('GLOBAL').get(),
      state.plaza ? db.collection('settings').doc(state.plaza).get() : Promise.resolve(null)
    ]);
    state.settingsGlobal = globalSnap.exists ? (globalSnap.data() || {}) : {};
    state.settingsPlaza = plazaSnap?.exists ? (plazaSnap.data() || {}) : {};
    if (state.tab === 'config') renderCurrentTab();
  } catch (error) {
    console.error('loadSettingsPreview', error);
    reportProgrammerError({ kind: 'programmer.config', scope: 'programador', message: error.message, stack: error.stack });
  }
}

async function saveSettingsEditor() {
  try {
    const editor = document.getElementById('programmerConfigEditor');
    if (!editor) return;
    const payload = JSON.parse(editor.value);
    const target = state.configMode === 'global' ? 'GLOBAL' : (state.plaza || 'GLOBAL');
    await db.collection('settings').doc(target).set(payload, { merge: true });
    showToast(`settings/${target} actualizado.`, 'success');
    await loadSettingsPreview();
  } catch (error) {
    console.error('saveSettingsEditor', error);
    showToast(`JSON inválido: ${error.message}`, 'error');
  }
}

async function refreshAll() {
  try {
    const call = callable('queryProgrammerConsole');
    if (!call) throw new Error('Functions no disponibles');
    const [overviewRes, notifRes, devicesRes, errorsRes, jobsRes, opsRes] = await Promise.all([
      call({ query: 'overview' }),
      call({ query: 'notifications', limit: 30 }),
      call({ query: 'devices', limit: 30 }),
      call({ query: 'errors', limit: 30 }),
      call({ query: 'jobs', limit: 30 }),
      call({ query: 'ops_events', plaza: state.plaza, limit: 30 })
    ]);
    state.overview = overviewRes.data?.rows?.[0] || null;
    state.notificationsRows = notifRes.data?.rows || [];
    state.devicesRows = devicesRes.data?.rows || [];
    state.errorsRows = errorsRes.data?.rows || [];
    state.jobsRows = jobsRes.data?.rows || [];
    state.opsRows = opsRes.data?.rows || [];
    await loadSettingsPreview();
    if (state.tab === 'consultas' && state.queryRows.length === 0) {
      state.queryRows = state.opsRows;
      state.queryName = 'ops_events';
    }
    renderShell();
  } catch (error) {
    console.error('refreshAll', error);
    setLoading('No se pudo cargar la consola.');
    reportProgrammerError({ kind: 'programmer.refresh', scope: 'programador', message: error.message, stack: error.stack });
  }
}

installProgrammerErrorReporter({
  screen: 'programador',
  getProfile: () => state.profile,
  getBuild: () => 'mapa-v63',
  enabled: () => Boolean(auth.currentUser)
});

auth.onAuthStateChanged(async user => {
  if (!user) {
    window.location.replace('/login');
    return;
  }
  setLoading('Validando permisos...');
  try {
    await user.getIdToken(true);
    state.profile = await resolveProfile(user);
    if (!state.profile || !isAllowed()) {
      window.location.replace('/mapa');
      return;
    }

    await loadProgrammerConfig();
    state.plaza = state.profile.plazaAsignada || '';
    configureNotifications({
      profileGetter: () => state.profile,
      getCurrentUserName: () => state.profile?.nombre || '',
      getCurrentUserDocId: () => state.profile?.id || state.profile?.email || '',
      getCurrentPlaza: () => state.profile?.plazaAsignada || '',
      toast: showToast,
      routeHandlers: {}
    });
    window.openNotificationCenter = () => import('/js/core/notifications.js').then(mod => mod.openNotificationCenter());
    await initNotificationCenter();
    await refreshAll();
  } catch (error) {
    console.error('programador:init', error);
    reportProgrammerError({ kind: 'programmer.init', scope: 'programador', message: error.message, stack: error.stack });
    setLoading('No se pudo abrir la consola de programador.');
  }
});
