import { getState } from '/js/app/app-state.js';
import { esGlobal } from '/domain/permissions.model.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';

let _container = null;
let _copyHandler = null;
let _offGlobalSearch = null;
let _globalQuery = '';
let _navigate = null;
let _cleanupFlags = null;
let _cleanupBeta = null;

/** Smoke mismo-origen (HEAD/GET): App Shell, perfil y rutas legacy pedidas en handoff beta. */
const _BETA_ROUTES = [
  '/app/dashboard',
  '/app/mapa',
  '/app/mensajes',
  '/app/cola-preparacion',
  '/app/incidencias',
  '/app/cuadre',
  '/app/admin',
  '/app/programador',
  '/app/profile',
  '/home',
  '/mapa',
  '/gestion',
  '/mensajes',
  '/cuadre',
  '/cola-preparacion'
];

const _BETA_ASSETS = [
  '/js/app/main.js',
  '/css/shell.css',
  '/app.html',
  '/sw.js',
  '/js/core/firebase-config.js'
];

/** Misma política que `/app/mapa`: solo PROGRAMADOR o admin global real; excluye roles operativos denegados. */
const _EXPERIMENTAL_DENIED = new Set([
  'CORPORATIVO_USER',
  'JEFE_OPERACION',
  'AUXILIAR',
  'OPERACION'
]);

export async function mount({ container, navigate }) {
  _container = container;
  _navigate = typeof navigate === 'function' ? navigate : null;
  const info = await _collectDiagnostics();
  const flags = _readShellFlags(getState());
  container.innerHTML = _html(info, flags);
  _bindGlobalSearch();
  const btn = container.querySelector('#progCopySummary');
  _copyHandler = async () => {
    const fresh = await _collectDiagnostics();
    await _copySummary(fresh);
  };
  btn?.addEventListener('click', _copyHandler);
  _cleanupFlags = _bindExperimentalSection(flags.canEditControls);
  _cleanupBeta = _bindBetaReadiness();
}

export function unmount() {
  if (_cleanupBeta) {
    try { _cleanupBeta(); } catch (_) {}
    _cleanupBeta = null;
  }
  if (_cleanupFlags) {
    try { _cleanupFlags(); } catch (_) {}
    _cleanupFlags = null;
  }
  if (_container && _copyHandler) {
    _container.querySelector('#progCopySummary')?.removeEventListener('click', _copyHandler);
  }
  if (typeof _offGlobalSearch === 'function') {
    try { _offGlobalSearch(); } catch (_) {}
  }
  _copyHandler = null;
  _offGlobalSearch = null;
  _globalQuery = '';
  _navigate = null;
  _container = null;
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_container) return;
    const route = String(event?.detail?.route || '');
    if (!(route.startsWith('/app/programador') || route === '/programador')) return;
    _globalQuery = String(event?.detail?.query || '').toLowerCase().trim();
    _applySearchFilter();
  };
  window.addEventListener('mex:global-search', handler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', handler);
}

function _applySearchFilter() {
  const cards = Array.from(_container?.querySelectorAll('[data-prog-search-text]') || []);
  cards.forEach(card => {
    const text = String(card.getAttribute('data-prog-search-text') || '');
    const visible = !_globalQuery || text.includes(_globalQuery);
    card.hidden = !visible;
  });
}

/** Script legado `/config.js` no debe estar en el documento; config en `firebase-config.js`. */
function _legacyConfigJsInDocument() {
  try {
    return Array.from(document.scripts || []).some(s =>
      /\/config\.js(\?|$)/.test(String(s.src || ''))
    );
  } catch (_) {
    return false;
  }
}

function _firebaseConfigReady() {
  try {
    return Boolean(window.FIREBASE_CONFIG && String(window.FIREBASE_CONFIG.projectId || '').trim());
  } catch (_) {
    return false;
  }
}

function _canExperimentalControls(state) {
  const r = String(state?.role || '').toUpperCase();
  if (_EXPERIMENTAL_DENIED.has(r)) return false;
  if (r === 'PROGRAMADOR') return true;
  const p = state?.profile || {};
  return Boolean(p.isAdmin === true && esGlobal(r));
}

function _readLsBool(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch (_) {
    return false;
  }
}

function _readShellFlags(state) {
  const profile = state.profile || {};
  const role = String(state.role || '').toUpperCase();
  const canRole = _canExperimentalControls(state);
  const isAdm = profile.isAdmin === true;
  const eg = Boolean(esGlobal(role));

  const dndLs = _readLsBool('mex.appMapa.dnd');
  const dndPersistLs = _readLsBool('mex.appMapa.dndPersist');
  const debugLs = _readLsBool('mex.debug.mode');

  const canUseDndPreview = canRole;
  const canUseDndPersist = canRole;

  return {
    dndLs,
    dndPersistLs,
    debugLs,
    roleRaw: role,
    isAdmin: isAdm,
    esGlobal: eg,
    canUseDndPreview,
    canUseDndPersist,
    plaza: state.currentPlaza || profile.plazaAsignada || profile.plaza || '—',
    route: state.currentRoute || window.location.pathname,
    canEditControls: canRole
  };
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
  const apiKeys = Object.keys(window.api || {}).sort((a, b) => a.localeCompare(b));
  const appShell = {
    route: st.currentRoute || window.location.pathname,
    currentPlaza: st.currentPlaza || '',
    availablePlazas: Array.isArray(st.availablePlazas) ? st.availablePlazas : [],
    canSwitchPlaza: Boolean(st.canSwitchPlaza)
  };
  const host = window.location.host;
  const env = host.includes('localhost')
    ? 'local'
    : host.includes('web.app') || host.includes('firebaseapp.com')
      ? 'production'
      : 'custom';
  const programmerErrorsAvailable = Boolean(window._db);
  const legacyConfigJs = _legacyConfigJsInDocument();
  const firebaseConfigOk = _firebaseConfigReady();
  return {
    user: profile.nombreCompleto || profile.nombre || profile.usuario || profile.email || 'Usuario',
    roleLabel,
    plaza: st.currentPlaza || profile.plazaAsignada || profile.plaza || '—',
    host,
    env,
    sw: { swControlled, swScope, swState, swVersion },
    firebase: { hasDb, hasAuth, hasStorage },
    api: { available: Boolean(window.api), count: apiKeys.length, keys: apiKeys },
    appShell,
    errors: { source: programmerErrorsAvailable ? 'programmer_errors (disponible)' : 'no disponible en runtime' },
    config: {
      legacyConfigJs,
      firebaseConfigOk,
      firebaseProjectId: firebaseConfigOk ? String(window.FIREBASE_CONFIG.projectId || '').trim() : ''
    }
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
  const cfg = info.config || {};
  const flags = _readShellFlags(getState());
  return [
    `Usuario: ${info.user}`,
    `Rol: ${info.roleLabel}`,
    `Plaza activa: ${info.plaza}`,
    `Ruta actual: ${flags.route}`,
    `Flags: dnd=${flags.dndLs ? '1' : '0'} persist=${flags.dndPersistLs ? '1' : '0'} debug=${flags.debugLs ? '1' : '0'}`,
    `Script /config.js (legacy) en documento: ${cfg.legacyConfigJs ? 'SÍ (no esperado)' : 'no'}`,
    `Config cliente (archivo esperado): /js/core/firebase-config.js`,
    `FIREBASE_CONFIG: ${cfg.firebaseConfigOk ? `ok · ${cfg.firebaseProjectId || '—'}` : 'NO'}`,
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

function _bindExperimentalSection(canEdit) {
  const root = _container?.querySelector('[data-prog-flags-root]');
  if (!root) return () => {};

  const refreshLabels = () => {
    const f = _readShellFlags(getState());
    const d = _container.querySelector('#progValDnd');
    const p = _container.querySelector('#progValPersist');
    const b = _container.querySelector('#progValDebug');
    const txt = on => (on ? '1' : '0 / vacío');
    if (d) d.textContent = txt(f.dndLs);
    if (p) p.textContent = txt(f.dndPersistLs);
    if (b) b.textContent = txt(f.debugLs);
  };

  const onChange = e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.dataset.lsKey) return;
    const key = t.dataset.lsKey;
    try {
      if (t.checked) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch (_) {}
    refreshLabels();
  };

  if (canEdit) {
    root.addEventListener('change', onChange);
  }

  const onClick = e => {
    const act = e.target?.closest?.('[data-prog-action]');
    if (!act || !root.contains(act)) return;
    const a = act.getAttribute('data-prog-action');
    if (a === 'reload') {
      window.location.reload();
      return;
    }
    if (a === 'open-app-mapa') {
      if (_navigate) _navigate('/app/mapa');
      else window.location.href = '/app/mapa';
      return;
    }
    if (a === 'open-legacy-mapa') {
      window.location.href = '/mapa';
      return;
    }
    if (a === 'clear-local-flags') {
      if (!canEdit) return;
      try {
        localStorage.removeItem('mex.appMapa.dnd');
        localStorage.removeItem('mex.appMapa.dndPersist');
        localStorage.removeItem('mex.debug.mode');
      } catch (_) {}
      root.querySelectorAll('input[data-ls-key]').forEach(el => { el.checked = false; });
      refreshLabels();
    }
  };
  root.addEventListener('click', onClick);

  return () => {
    root.removeEventListener('click', onClick);
    if (canEdit) root.removeEventListener('change', onChange);
  };
}

async function _probeUrl(path) {
  try {
    let r = await fetch(path, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok && r.status !== 304 && r.status !== 0) {
      r = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    }
    return r.ok || r.status === 304;
  } catch (_) {
    return false;
  }
}

function _bindBetaReadiness() {
  const root = _container?.querySelector('[data-beta-root]');
  if (!root) return () => {};

  const setStatus = (id, ok) => {
    const el = root.querySelector(`#${id}`);
    if (!el) return;
    el.textContent = ok ? '✓' : '✗';
    el.style.color = ok ? '#047857' : '#b91c1c';
    el.style.fontWeight = '800';
  };

  const onClick = async e => {
    const btn = e.target?.closest?.('[data-beta-act]');
    if (!btn || !root.contains(btn)) return;
    const act = btn.getAttribute('data-beta-act');
    const pre = root.querySelector('#progBetaSmokeResults');

    if (act === 'smoke') {
      if (pre) pre.textContent = 'Ejecutando comprobaciones (solo GET/HEAD mismo origen)…';
      const lines = [];
      for (const path of _BETA_ROUTES) {
        const ok = await _probeUrl(path);
        lines.push(`${ok ? 'OK ' : 'FAIL'} ${path}`);
      }
      lines.push('');
      lines.push('Assets:');
      for (const path of _BETA_ASSETS) {
        const ok = await _probeUrl(path);
        lines.push(`${ok ? 'OK ' : 'FAIL'} ${path}`);
      }
      const text = lines.join('\n');
      if (pre) pre.textContent = text;
      _BETA_ROUTES.forEach((path, i) => {
        const ok = lines[i].startsWith('OK');
        setStatus(`beta-chk-${i}`, ok);
      });
      return;
    }

    if (act === 'copy-beta') {
      const info = await _collectDiagnostics();
      const st = getState();
      const flags = _readShellFlags(st);
      const smoke = root.querySelector('#progBetaSmokeResults')?.textContent || '(ejecuta smoke antes)';
      const cfg = info.config || {};
      const report = [
        `Host: ${info.host}`,
        `Usuario: ${info.user}`,
        `Rol: ${info.roleLabel}`,
        `Ruta: ${flags.route}`,
        `Plaza: ${flags.plaza}`,
        `SW: ${info.sw.swVersion}`,
        `Script /config.js legacy en documento: ${cfg.legacyConfigJs ? 'SÍ (no esperado)' : 'no'}`,
        `Config cliente: /js/core/firebase-config.js`,
        `FIREBASE_CONFIG: ${cfg.firebaseConfigOk ? `ok · ${cfg.firebaseProjectId || ''}` : 'NO'}`,
        `window.api: ${info.api.count} funciones`,
        `Flags dnd/dndPersist/debug: ${flags.dndLs}/${flags.dndPersistLs}/${flags.debugLs}`,
        '',
        'Smoke / rutas:',
        smoke
      ].join('\n');
      try {
        await navigator.clipboard.writeText(report);
        if (pre) pre.textContent = `${pre.textContent}\n\n(reporte copiado al portapapeles)`;
      } catch (_) {}
      return;
    }

    if (act === 'open-dashboard' && _navigate) _navigate('/app/dashboard');
    else if (act === 'open-dashboard') window.location.href = '/app/dashboard';

    if (act === 'open-app-mapa' && _navigate) _navigate('/app/mapa');
    else if (act === 'open-app-mapa') window.location.href = '/app/mapa';

    if (act === 'open-legacy') window.location.href = '/mapa';
    if (act === 'reload-app') window.location.reload();
  };

  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

function _betaReadinessHtml(info, flags) {
  const routeLabels = _BETA_ROUTES.map((p, i) => {
    const short = p.replace('/app/', '');
    return `<div data-prog-search-text="${esc(`beta ruta ${p}`.toLowerCase())}" style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid #f1f5f9;">
      <span style="color:#64748b;">${esc(p)}</span>
      <span id="beta-chk-${i}" style="color:#94a3b8;">—</span>
    </div>`;
  }).join('');

  return `
  <div data-beta-root data-prog-search-text="beta readiness smoke" style="border:1px solid #dbeafe;border-radius:12px;background:#f8fafc;padding:14px;margin-bottom:12px;">
    <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a;">Beta Readiness</h3>
    <p style="margin:0 0 10px;font-size:12px;color:#475569;line-height:1.45;">
      Validación rápida para despliegue Firebase. El smoke check solo hace peticiones <code>HEAD/GET</code> al mismo origen; no escribe Firestore ni borra cache.
    </p>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:10px;">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px;font-size:12px;">
        <div style="font-weight:800;color:#64748b;margin-bottom:6px;">Estado</div>
        ${_row('Versión SW / cache', info.sw.swVersion)}
        ${_row('Host', info.host)}
        ${_row('Usuario', info.user)}
        ${_row('Rol', info.roleLabel)}
        ${_row('Plaza activa', flags.plaza)}
        ${_row('Flags mapa', `dnd=${flags.dndLs ? '1' : '0'} · persist=${flags.dndPersistLs ? '1' : '0'} · debug=${flags.debugLs ? '1' : '0'}`)}
        ${_row('window.api', `${info.api.count} funciones`)}
        ${_row('Firebase Auth', info.firebase.hasAuth ? 'ok' : 'no')}
        ${_row('Firestore', info.firebase.hasDb ? 'ok' : 'no')}
        ${_row('Storage', info.firebase.hasStorage ? 'ok' : 'no')}
        ${_row('SW registrado', info.sw.swState)}
        ${_row('SW controla página', info.sw.swControlled ? 'sí' : 'no')}
        ${_row('Script /config.js (legacy)', info.config?.legacyConfigJs ? '⚠ cargado' : 'no (ok)')}
        ${_row('Origen FIREBASE_CONFIG', '/js/core/firebase-config.js')}
        ${_row('FIREBASE_CONFIG', info.config?.firebaseConfigOk ? `ok · ${esc(info.config.firebaseProjectId || '')}` : 'NO')}
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px;font-size:12px;">
        <div style="font-weight:800;color:#64748b;margin-bottom:6px;">Rutas App Shell / legacy</div>
        ${routeLabels}
      </div>
    </div>
    <pre id="progBetaSmokeResults" style="margin:0 0 10px;padding:10px;background:#0f172a;color:#e2e8f0;border-radius:8px;font-size:11px;overflow:auto;max-height:260px;">Pulsa «Ejecutar smoke check local» para resultados.</pre>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      <button type="button" data-beta-act="smoke" style="border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;">Ejecutar smoke check local</button>
      <button type="button" data-beta-act="copy-beta" style="border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;">Copiar reporte beta</button>
      <button type="button" data-beta-act="open-dashboard" style="border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;">Abrir /app/dashboard</button>
      <button type="button" data-beta-act="open-app-mapa" style="border:1px solid #0f766e;background:#ecfdf5;color:#065f46;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;">Abrir /app/mapa</button>
      <button type="button" data-beta-act="open-legacy" style="border:1px solid #0f172a;background:#0f172a;color:#fff;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;">Abrir /mapa legacy</button>
      <button type="button" data-beta-act="reload-app" style="border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;">Recargar app</button>
    </div>
  </div>`;
}

function _html(info, flags) {
  const f = flags;
  const edit = f.canEditControls;

  const diagRow = (k, v, searchExtra = '') => {
    const searchText = `${k} ${v} ${searchExtra}`.toLowerCase();
    return `<div data-prog-search-text="${esc(searchText)}" style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
    <strong style="color:#64748b;">${esc(k)}</strong><span style="color:#0f172a;text-align:right;">${esc(v)}</span>
  </div>`;
  };

  const toggleRow = (label, lsKey, checked) => {
    const meta = `${label} ${lsKey}`;
    return `<div data-prog-search-text="${esc(`${meta} toggle`.toLowerCase())}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#0f172a;font-weight:600;">
        <input type="checkbox" data-ls-key="${esc(lsKey)}" ${checked ? 'checked' : ''} />
        <span>${esc(label)}</span>
      </label>
      <code style="font-size:11px;color:#64748b;">${esc(lsKey)}</code>
    </div>`;
  };

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

  <div data-prog-flags-root style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:14px;margin-bottom:12px;">
    <h3 style="margin:0 0 10px;font-size:15px;color:#0f172a;">Flags experimentales App Shell</h3>
    <p style="margin:0 0 12px;font-size:12px;color:#64748b;line-height:1.45;">
      Solo modifica <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">localStorage</code> en este navegador.
      ${edit ? '' : 'Tu rol no permite cambiar flags; solo lectura.'}
    </p>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
      <div style="border:1px solid #f1f5f9;border-radius:10px;padding:10px;">
        <div style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;margin-bottom:8px;">Estado actual</div>
        <div data-prog-search-text="${esc(`valor mex.appmapa.dnd ${f.dndLs ? '1' : '0'}`.toLowerCase())}" style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
          <strong style="color:#64748b;">Valor mex.appMapa.dnd</strong>
          <span id="progValDnd" style="color:#0f172a;text-align:right;">${f.dndLs ? '1' : '0 / vacío'}</span>
        </div>
        <div data-prog-search-text="${esc(`valor mex.appmapa.dndpersist ${f.dndPersistLs ? '1' : '0'}`.toLowerCase())}" style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
          <strong style="color:#64748b;">Valor mex.appMapa.dndPersist</strong>
          <span id="progValPersist" style="color:#0f172a;text-align:right;">${f.dndPersistLs ? '1' : '0 / vacío'}</span>
        </div>
        <div data-prog-search-text="${esc(`valor mex.debug.mode ${f.debugLs ? '1' : '0'}`.toLowerCase())}" style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
          <strong style="color:#64748b;">Valor mex.debug.mode</strong>
          <span id="progValDebug" style="color:#0f172a;text-align:right;">${f.debugLs ? '1' : '0 / vacío'}</span>
        </div>
        ${diagRow('Rol actual', f.roleRaw)}
        ${diagRow('isAdmin', String(f.isAdmin))}
        ${diagRow('esGlobal(role)', String(f.esGlobal))}
        ${diagRow('canUseDndPreview', String(f.canUseDndPreview))}
        ${diagRow('canUseDndPersist', String(f.canUseDndPersist))}
        ${diagRow('Plaza activa', f.plaza)}
        ${diagRow('Ruta actual', f.route)}
      </div>
      <div style="border:1px solid #f1f5f9;border-radius:10px;padding:10px;">
        <div style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;margin-bottom:8px;">${edit ? 'Controles locales' : 'Acciones de navegación'}</div>
        ${edit ? `
        ${toggleRow('DnD preview App Mapa', 'mex.appMapa.dnd', f.dndLs)}
        ${toggleRow('DnD persistencia (experimental)', 'mex.appMapa.dndPersist', f.dndPersistLs)}
        ${toggleRow('Debug mex', 'mex.debug.mode', f.debugLs)}
        ` : `<p style="margin:0 0 12px;font-size:12px;color:#64748b;line-height:1.45;">Los valores están en la columna izquierda; tu rol no permite cambiar flags.</p>`}
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">
          <button type="button" data-prog-action="reload" style="border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;">Recargar vista actual</button>
          <button type="button" data-prog-action="open-app-mapa" style="border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;">Abrir /app/mapa</button>
          <button type="button" data-prog-action="open-legacy-mapa" style="border:1px solid #0f172a;background:#0f172a;color:#fff;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;">Abrir /mapa legacy</button>
          ${edit ? '<button type="button" data-prog-action="clear-local-flags" style="border:1px solid #f59e0b;background:#fff7ed;color:#9a3412;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;">Limpiar flags locales</button>' : ''}
        </div>
      </div>
    </div>
  </div>

  ${_betaReadinessHtml(info, flags)}

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
  <div data-prog-search-text="window api funciones lista buscable" style="margin-top:10px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:12px;">
    <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a;">Funciones disponibles en window.api</h3>
    <p style="margin:0 0 8px;font-size:12px;color:#64748b;">Usa búsqueda global para filtrar este bloque por nombre de función.</p>
    <div style="max-height:220px;overflow:auto;border:1px solid #eef2f7;border-radius:8px;padding:8px;background:#f8fafc;">
      ${(info.api.keys || []).length
        ? (info.api.keys || []).map(name => `<div data-prog-search-text="${esc(`window.api ${name}`.toLowerCase())}" style="font:12px ui-monospace, SFMono-Regular, Menlo, monospace;color:#0f172a;padding:4px 0;border-bottom:1px solid #e2e8f0;">${esc(name)}</div>`).join('')
        : '<div style="font-size:12px;color:#94a3b8;">window.api no está disponible en este runtime.</div>'}
    </div>
  </div>
</div>`;
}

function _card(label, value) {
  const searchText = `${label} ${value}`.toLowerCase();
  return `<div data-prog-search-text="${esc(searchText)}" style="border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:10px;">
    <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;font-weight:800;">${esc(label)}</div>
    <div style="font-size:13px;color:#0f172a;font-weight:700;word-break:break-word;">${esc(value)}</div>
  </div>`;
}

function _row(k, v) {
  const searchText = `${k} ${v}`.toLowerCase();
  return `<div data-prog-search-text="${esc(searchText)}" style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
    <strong style="color:#64748b;">${esc(k)}</strong><span style="color:#0f172a;text-align:right;">${esc(v)}</span>
  </div>`;
}

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
