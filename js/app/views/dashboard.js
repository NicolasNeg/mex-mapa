// ═══════════════════════════════════════════════════════════
//  /js/app/views/dashboard.js
//  Vista /app/dashboard — Panel principal post-login (Fase 6).
//
//  Links con data-app-route → cargan dentro del shell sin recargar.
//  Links con href normal   → navegación real (legacy).
//  /mapa siempre con href normal — NO migrado.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';
import { db, COL } from '/js/core/database.js';

let _cleanup = null;
let _container = null;
let _state = null;
let _offSearch = null;
let _offPlaza = null;
let _cssRef = null;

export async function mount({ container }) {
  unmount();
  _container = container;
  _ensureCss();
  const gs = getState();
  const role = String(gs.role || 'AUXILIAR').toUpperCase();
  const plaza = String(getCurrentPlaza() || gs.profile?.plazaAsignada || '').toUpperCase().trim();
  _state = {
    role,
    profile: gs.profile || {},
    company: gs.company || 'MAPA',
    plaza,
    query: '',
    metrics: { unidades: 0, externos: 0, incidencias: 0, solicitudes: 0 },
    modules: _modulesForRole(role)
  };

  _container.innerHTML = _layout(_state);
  _bindGlobalSearch();
  _offPlaza = onPlazaChange(async nextPlaza => {
    if (!_state || !_container) return;
    _state.plaza = String(nextPlaza || '').toUpperCase().trim();
    _setText('#appDashPlaza', _state.plaza || '—');
    await _loadMetrics();
    _render();
  });
  await _loadMetrics();
  _render();
  _cleanup = () => {
    if (typeof _offSearch === 'function') _offSearch();
    if (typeof _offPlaza === 'function') _offPlaza();
    _offSearch = null;
    _offPlaza = null;
    if (_cssRef?.parentNode) _cssRef.parentNode.removeChild(_cssRef);
    _cssRef = null;
    _container = null;
    _state = null;
  };
}

export function unmount() {
  if (typeof _cleanup === 'function') _cleanup();
  _cleanup = null;
}

function _ensureCss() {
  const existing = document.querySelector('link[data-app-dashboard-css="1"]');
  if (existing) { _cssRef = existing; return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-dashboard.css';
  link.dataset.appDashboardCss = '1';
  document.head.appendChild(link);
  _cssRef = link;
}

function _modulesForRole(role) {
  const base = [
    { appRoute: '/app/mapa', label: 'Mapa operativo', icon: 'map', keywords: 'mapa unidades mva ubicacion' },
    { appRoute: '/app/cuadre', label: 'Cuadre', icon: 'calculate', keywords: 'cuadre inventario flotilla' },
    { appRoute: '/app/incidencias', label: 'Incidencias', icon: 'warning', keywords: 'incidencias notas admin' },
    { appRoute: '/app/cola-preparacion', label: 'Cola preparación', icon: 'format_list_bulleted', keywords: 'cola preparacion salida checklist' },
    { appRoute: '/app/mensajes', label: 'Mensajes', icon: 'chat', keywords: 'mensajes chat conversaciones' },
    { appRoute: '/app/profile', label: 'Perfil', icon: 'person', keywords: 'perfil usuario cuenta' },
  ];
  const adminRoles = new Set(['SUPERVISOR','JEFE_PATIO','GERENTE_PLAZA','JEFE_REGIONAL','CORPORATIVO_USER','JEFE_OPERACION','PROGRAMADOR']);
  if (adminRoles.has(role)) base.push({ appRoute: '/app/admin', label: 'Admin', icon: 'admin_panel_settings', keywords: 'admin usuarios roles plazas' });
  if (role === 'PROGRAMADOR' || role === 'JEFE_OPERACION') base.push({ appRoute: '/app/programador', label: 'Programador', icon: 'terminal', keywords: 'debug consola tecnica observabilidad' });
  return base;
}

function _layout(state) {
  const name = state.profile?.nombreCompleto || state.profile?.nombre || state.profile?.email || 'Usuario';
  const roleLabel = ROLE_LABELS[state.role] || state.role;
  const showDebug = state.role === 'PROGRAMADOR' || _debugMode();
  return `
<section class="appdash">
  <div class="appdash__hero">
    <div class="appdash__card">
      <p style="font-size:12px;color:#64748b;margin:0 0 4px;">${esc(_greeting())}</p>
      <h1 style="font-size:26px;margin:0;color:#0f172a;">Hola, ${esc(name.split(' ')[0])}</h1>
      <p class="appdash__meta" style="margin-top:6px;">${esc(roleLabel)} · <span id="appDashPlaza">${esc(state.plaza || '—')}</span> · ${esc(state.company)}</p>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <a data-app-route="/app/mapa" href="/app/mapa" style="font-size:12px;padding:6px 10px;border-radius:999px;background:#dcfce7;color:#166534;text-decoration:none;">Ir a mapa</a>
        <a data-app-route="/app/profile" href="/app/profile" style="font-size:12px;padding:6px 10px;border-radius:999px;background:#e2e8f0;color:#334155;text-decoration:none;">Ver perfil</a>
      </div>
    </div>
    <div class="appdash__card">
      <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Foco de plaza</div>
      <div style="margin-top:8px;font-size:13px;color:#334155;">Cambia la plaza desde el header para refrescar resumen operativo sin recargar página.</div>
      <a href="/home" style="display:inline-block;margin-top:12px;font-size:12px;color:#0f172a;">Abrir home legacy (fallback)</a>
    </div>
  </div>

  <div class="appdash__kpis">
    ${_kpi('appDashKpiUnidades', 'Unidades activas')}
    ${_kpi('appDashKpiExternos', 'Externos')}
    ${_kpi('appDashKpiInc', 'Incidencias abiertas')}
    ${_kpi('appDashKpiSol', 'Solicitudes pendientes')}
  </div>

  <h2 style="font-size:12px;font-weight:800;color:#64748b;margin:0 0 8px;">Módulos disponibles</h2>
  <div class="appdash__modules" id="appDashModules">
    ${state.modules.map(mod => `
      <a class="appdash__module" data-app-route="${esc(mod.appRoute)}" href="${esc(mod.appRoute)}" data-module-text="${esc((mod.label + ' ' + mod.keywords).toLowerCase())}">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="material-symbols-outlined" style="font-size:18px;color:#2b6954;">${esc(mod.icon)}</span>
          <strong style="font-size:13px;color:#0f172a;">${esc(mod.label)}</strong>
        </div>
      </a>
    `).join('')}
  </div>

  ${showDebug ? `
    <div class="appdash__card" style="margin-top:14px;background:#0b1220;border-color:#1e293b;">
      <div style="font-size:11px;color:#94a3b8;font-weight:800;text-transform:uppercase;">Debug / roadmap</div>
      <div style="margin-top:8px;font-size:12px;color:#cbd5e1;">Visible solo para PROGRAMADOR o mex.debug.mode=1.</div>
    </div>
  ` : ''}

</section>
  `;
}

async function _loadMetrics() {
  const plaza = String(_state?.plaza || '').toUpperCase().trim();
  const isAdmin = _isAdminRole(_state.role);
  const [cuadre, externos, solicitudes, notasSnap] = await Promise.all([
    plaza ? _safeCount(db.collection(COL.CUADRE).where('plaza', '==', plaza).limit(180).get()) : 0,
    plaza ? _safeCount(db.collection(COL.EXTERNOS).where('plaza', '==', plaza).limit(180).get()) : 0,
    isAdmin ? _safeCount(db.collection('solicitudes').where('estado', '==', 'PENDIENTE').limit(80).get()) : 0,
    plaza ? db.collection(COL.NOTAS).where('plaza', '==', plaza).limit(120).get() : null
  ]);
  const notas = notasSnap?.docs
    ? notasSnap.docs.filter(doc => {
      const estado = String(doc.data()?.estado || '').toUpperCase();
      return estado !== 'RESUELTA' && estado !== 'CERRADA';
    }).length
    : 0;
  _state.metrics = { unidades: cuadre, externos, incidencias: notas, solicitudes };
}

function _render() {
  _setText('#appDashKpiUnidades', _state.metrics.unidades);
  _setText('#appDashKpiExternos', _state.metrics.externos);
  _setText('#appDashKpiInc', _state.metrics.incidencias);
  _setText('#appDashKpiSol', _state.metrics.solicitudes);
  _applyQuery();
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_state || !_container) return;
    const route = String(event?.detail?.route || '');
    if (!(route.startsWith('/app/dashboard') || route === '/home')) return;
    _state.query = String(event?.detail?.query || '').toLowerCase().trim();
    _applyQuery();
  };
  window.addEventListener('mex:global-search', handler);
  _offSearch = () => window.removeEventListener('mex:global-search', handler);
}

function _applyQuery() {
  const cards = Array.from(_container?.querySelectorAll('[data-module-text]') || []);
  cards.forEach(card => {
    const txt = String(card.getAttribute('data-module-text') || '');
    const visible = !_state.query || txt.includes(_state.query);
    card.hidden = !visible;
  });
}

function _kpi(id, label) {
  return `<div class="appdash__card"><div id="${id}" class="appdash__kpi-v">0</div><div class="appdash__kpi-l">${esc(label)}</div></div>`;
}

function _isAdminRole(role) {
  return ['SUPERVISOR','JEFE_PATIO','GERENTE_PLAZA','JEFE_REGIONAL','CORPORATIVO_USER','JEFE_OPERACION','PROGRAMADOR'].includes(String(role || ''));
}

async function _safeCount(promise) {
  try {
    const snap = await promise;
    return snap?.size || 0;
  } catch (_) {
    return 0;
  }
}

function _debugMode() {
  try { return localStorage.getItem('mex.debug.mode') === '1'; } catch { return false; }
}

function _setText(selector, value) {
  const el = _container?.querySelector(selector);
  if (el) el.textContent = String(value ?? '');
}

// ── Utilidades ───────────────────────────────────────────────
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}
