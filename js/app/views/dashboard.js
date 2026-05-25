// ═══════════════════════════════════════════════════════════
//  /js/app/views/dashboard.js  — Dashboard adaptativo SaaS
//  Solo muestra lo que la empresa tiene habilitado y el rol
//  del usuario requiere. Respeta la vista preferida.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';
import { db, COL, obtenerDatosParaMapa, obtenerEstructuraMapa } from '/js/core/database.js';
import { buildMapaViewModel } from '/mapa/mapa-view-model.js';
import { normalizarUnidad } from '/domain/unidad.model.js';
import { normalizarElemento } from '/domain/mapa.model.js';
import { iniciarTurno, cerrarTurno } from '/js/app/features/turnos/turnos-data.js';

// ── State ────────────────────────────────────────────────────
let _ctr = null;
let _s = null;
let _offs = [];
let _mapReqId = 0;
let _unsubCuadre = null;
let _unsubCola = null;
let _unsubTurno = null;

// ── Lifecycle ─────────────────────────────────────────────────
export async function mount({ container }) {
  unmount();
  _ctr = container;
  _ensureCss();

  const gs = getState();
  const role = String(gs.role || 'AUXILIAR').toUpperCase();
  const plaza = String(getCurrentPlaza() || gs.profile?.plazaAsignada || '').toUpperCase().trim();
  const empresa = window._empresaActual || {};
  const feats = _feats();

  _s = {
    role,
    profile: gs.profile || {},
    company: String(gs.company || empresa.nombre || empresa.id || 'MAPA').trim(),
    plaza,
    feats,
    modules: _activeModules(role, feats),
    metrics: { unidades: 0, externos: 0, incidencias: 0, solicitudes: 0 },
    cuadreStats: { listo: 0, sucio: 0, manto: 0, otros: 0 },
    colaPreview: [],
    turnoActivo: null,
    mapLoading: !!plaza,
    prefView: _readPrefView(),
  };

  _ctr.innerHTML = _renderHtml();
  _bindAll();
  _startWidgets();
  void _loadMetrics();
  if (plaza) void _loadMapPreview();

  _offs.push(onPlazaChange(next => {
    if (!_s || !_ctr) return;
    _s.plaza = String(next || '').toUpperCase().trim();
    _s.mapLoading = !!_s.plaza;
    _syncPlaza();
    _stopWidgets();
    _startWidgets();
    void _loadMetrics();
    void _loadMapPreview();
  }));
}

export function unmount() {
  _offs.forEach(fn => { try { fn(); } catch (_) {} });
  _offs = [];
  _stopWidgets();
  _ctr = null;
  _s = null;
  _mapReqId = 0;
}

// ── Feature detection ─────────────────────────────────────────
function _feats() {
  const can = f => window.mexFeatures ? window.mexFeatures.puedeUsar(f) : true;
  return {
    cuadre:      can('cuadre'),
    incidencias: can('incidencias'),
    cola:        can('cola_preparacion'),
    mensajeria:  can('mensajeria'),
    alertas:     can('alertas'),
    reportes:    can('reportes'),
    edicion_mapa: can('edicion_mapa'),
    solicitudes: can('solicitudes_acceso'),
    gestion_usuarios: can('gestion_usuarios'),
  };
}

function _activeModules(role, feats) {
  const r = role.toUpperCase();
  const isAdmin = _isAdmin(r);
  const isSuperAdmin = r === 'PROGRAMADOR' || r === 'JEFE_OPERACION';

  const list = [
    { route: '/app/mapa',             label: 'Mapa',          icon: 'map',                  show: true },
    { route: '/app/cola-preparacion', label: 'Cola prep.',    icon: 'format_list_bulleted', show: feats.cola },
    { route: '/app/incidencias',      label: 'Incidencias',   icon: 'warning',              show: feats.incidencias },
    { route: '/app/mensajes',         label: 'Mensajes',      icon: 'chat',                 show: feats.mensajeria },
    { route: '/app/cuadre',           label: 'Cuadre',        icon: 'calculate',            show: feats.cuadre && isAdmin },
    { route: '/app/alertas',          label: 'Alertas',       icon: 'notifications_active', show: feats.alertas },
    { route: '/app/admin',            label: 'Administración', icon: 'admin_panel_settings', show: isAdmin && feats.gestion_usuarios },
    { route: '/app/profile',          label: 'Mi perfil',     icon: 'person',               show: true },
    { route: '/app/programador',      label: 'Panel técnico', icon: 'terminal',             show: isSuperAdmin },
  ];

  return list.filter(m => m.show);
}

// ── CSS ───────────────────────────────────────────────────────
function _ensureCss() {
  if (document.querySelector('link[data-app-dashboard-css="1"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/css/app-dashboard.css';
  l.dataset.appDashboardCss = '1';
  document.head.appendChild(l);
}

// ── Main render ───────────────────────────────────────────────
function _renderHtml() {
  const { role, profile, company, plaza, feats, modules, metrics, prefView } = _s;
  const name = _firstName(profile);
  const roleLabel = ROLE_LABELS?.[role] || role;
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const hasMap = !!plaza;
  const bodyClass = hasMap ? '' : 'dash-body--full';

  return `
<div class="dash">
  <div class="dash-inner">

    <!-- Header -->
    <div class="dash-top">
      <div class="dash-greeting">
        <h1 class="dash-h1">Hola, ${esc(name)} 👋</h1>
        <p class="dash-meta">
          <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">calendar_today</span>
          ${esc(dateStr.charAt(0).toUpperCase() + dateStr.slice(1))}
        </p>
        <div class="dash-chips">
          <span class="dash-chip" id="dashChipPlaza">
            <span class="material-symbols-outlined" style="font-size:12px;">location_on</span>
            ${esc(plaza || 'Global')}
          </span>
          <span class="dash-chip dash-chip--accent">
            <span class="material-symbols-outlined" style="font-size:12px;">person</span>
            ${esc(roleLabel)}
          </span>
          ${company && company !== 'MAPA' ? `
          <span class="dash-chip">
            <span class="material-symbols-outlined" style="font-size:12px;">business</span>
            ${esc(company)}
          </span>` : ''}
        </div>
      </div>
      <button class="dash-btn-refresh" id="dashRefreshBtn" type="button">
        <span class="material-symbols-outlined" style="font-size:15px;">refresh</span>
        Actualizar
      </button>
    </div>

    <!-- KPIs -->
    <div class="dash-kpis" id="dashKpis">
      ${_renderKpis(metrics, feats, role)}
    </div>

    <!-- Main body -->
    <div class="dash-body ${bodyClass}">
      ${hasMap ? `
      <!-- Map section -->
      <div class="dash-map-card">
        <div class="dash-map-canvas" id="dashMapCanvas">
          <div class="dash-map-loading">
            <div class="dash-spinner"></div>
          </div>
        </div>
        <div class="dash-map-overlay">
          <div class="dash-map-top">
            <div class="dash-live-badge">
              <div class="dash-live-dot"></div>
              <span id="dashLivePlaza">${esc(plaza)}</span>
            </div>
            <a class="dash-map-link" href="/app/mapa" data-app-route="/app/mapa">
              <span class="material-symbols-outlined" style="font-size:13px;">open_in_new</span>
              Ver mapa
            </a>
          </div>
          <div class="dash-map-stats" id="dashMapStats">
            <div class="dash-map-stat">
              <div class="dash-map-stat-val" id="dashStatUni">—</div>
              <div class="dash-map-stat-label">Activas</div>
            </div>
            <div class="dash-map-stat">
              <div class="dash-map-stat-val" id="dashStatExt">—</div>
              <div class="dash-map-stat-label">Externos</div>
            </div>
            ${feats.incidencias ? `
            <div class="dash-map-stat">
              <div class="dash-map-stat-val" id="dashStatInc" style="color:#fbbf24;">—</div>
              <div class="dash-map-stat-label">Alertas</div>
            </div>` : ''}
          </div>
        </div>
      </div>` : ''}

      <!-- Right sidebar: modules + widgets -->
      <div class="dash-sidebar">

        <!-- Acceso rápido -->
        <div class="dash-modules-card">
          <div class="dash-section-title">Acceso rápido</div>
          <div class="dash-module-grid">
            ${modules.map(m => `
              <a class="dash-module" href="${esc(m.route)}" data-app-route="${esc(m.route)}">
                <div class="dash-module-icon">
                  <span class="material-symbols-outlined">${esc(m.icon)}</span>
                </div>
                <span>${esc(m.label)}</span>
              </a>`).join('')}
          </div>
          ${modules.length === 0 ? `
          <p style="font-size:12px;color:#94a3b8;text-align:center;padding:12px 0;margin:0;">
            No hay módulos disponibles para tu cuenta.
          </p>` : ''}
        </div>

        <!-- Widgets (feature-gated) -->
        ${feats.cuadre && _isAdmin(role) ? `
        <div class="dash-widget">
          <div class="dash-widget-head">
            <span class="material-symbols-outlined">directions_car</span>
            <h3>Estado del patio</h3>
            <a class="dash-widget-link" href="/app/mapa" data-app-route="/app/mapa">Ver mapa</a>
          </div>
          <div class="dash-widget-body" id="dashCuadreBody">
            <p class="dash-widget-empty">Cargando…</p>
          </div>
        </div>` : ''}

        ${feats.cola ? `
        <div class="dash-widget">
          <div class="dash-widget-head">
            <span class="material-symbols-outlined">format_list_bulleted</span>
            <h3>Cola de preparación</h3>
            <a class="dash-widget-link" href="/app/cola-preparacion" data-app-route="/app/cola-preparacion">Ver todo</a>
          </div>
          <div class="dash-widget-body" id="dashColaBody">
            <p class="dash-widget-empty">Cargando…</p>
          </div>
        </div>` : ''}

        <div class="dash-widget">
          <div class="dash-widget-head">
            <span class="material-symbols-outlined">badge</span>
            <h3>Mi turno</h3>
          </div>
          <div class="dash-widget-body" id="dashTurnoBody">
            <p class="dash-widget-empty">Cargando…</p>
          </div>
        </div>

      </div><!-- /dash-sidebar -->
    </div><!-- /dash-body -->

    <!-- Preferred view bar -->
    ${_renderPrefBar(feats, prefView)}

  </div><!-- /dash-inner -->
</div><!-- /dash -->`;
}

function _renderKpis(metrics, feats, role) {
  const kpis = [];

  // Unidades — siempre si hay plaza
  kpis.push({
    icon: 'directions_car', id: 'dashKpiUni',
    val: metrics.unidades, label: 'Unidades activas',
    alert: false,
  });

  // Externos — siempre (complementa unidades)
  kpis.push({
    icon: 'local_shipping', id: 'dashKpiExt',
    val: metrics.externos, label: 'Externos',
    alert: false,
  });

  // Alertas/Incidencias
  if (feats.incidencias) {
    kpis.push({
      icon: 'warning', id: 'dashKpiInc',
      val: metrics.incidencias, label: 'Incidencias',
      alert: metrics.incidencias > 0,
    });
  }

  // Solicitudes pendientes (solo admins)
  if (feats.solicitudes && _isAdmin(role)) {
    kpis.push({
      icon: 'assignment_ind', id: 'dashKpiSol',
      val: metrics.solicitudes, label: 'Solicitudes',
      alert: metrics.solicitudes > 0,
    });
  }

  return kpis.map(k => `
    <div class="dash-kpi${k.alert ? ' dash-kpi--alert' : ''}">
      <span class="material-symbols-outlined" style="font-size:18px;color:${k.alert ? '#dc2626' : '#6366f1'};">${k.icon}</span>
      <div class="dash-kpi-val" id="${k.id}">${k.val}</div>
      <div class="dash-kpi-label">${k.label}</div>
    </div>`).join('');
}

function _renderPrefBar(feats, prefView) {
  const opts = [
    { key: 'dashboard',          label: 'Dashboard', route: '/app/dashboard' },
    { key: 'mapa',               label: 'Mapa',      route: '/app/mapa' },
    { key: 'cola-preparacion',   label: 'Cola',      route: '/app/cola-preparacion', feat: feats.cola },
    { key: 'incidencias',        label: 'Alertas',   route: '/app/incidencias',      feat: feats.incidencias },
    { key: 'mensajes',           label: 'Mensajes',  route: '/app/mensajes',         feat: feats.mensajeria },
  ].filter(o => o.feat !== false);

  const current = prefView || 'dashboard';

  return `
  <div class="dash-pref-bar">
    <span class="dash-pref-label">Al iniciar, ir a:</span>
    <div class="dash-pref-btns" id="dashPrefBtns">
      ${opts.map(o => `
        <button class="dash-pref-btn${current === o.key || current === o.route ? ' dash-pref-btn--active' : ''}"
                type="button" data-pref="${esc(o.key)}">
          ${esc(o.label)}
        </button>`).join('')}
    </div>
    <span id="dashPrefSaved" style="font-size:11px;color:#10b981;display:none;margin-left:4px;">✓ Guardado</span>
  </div>`;
}

// ── Bind ─────────────────────────────────────────────────────
function _bindAll() {
  _ctr?.querySelector('#dashRefreshBtn')?.addEventListener('click', async () => {
    const btn = _ctr.querySelector('#dashRefreshBtn');
    if (btn) btn.disabled = true;
    await Promise.all([_loadMetrics(), _loadMapPreview()]);
    if (btn) btn.disabled = false;
  });

  _ctr?.querySelector('#dashPrefBtns')?.addEventListener('click', e => {
    const btn = e.target.closest('.dash-pref-btn');
    if (!btn) return;
    const key = btn.dataset.pref;
    _savePrefView(key);
    _ctr.querySelectorAll('.dash-pref-btn').forEach(b => {
      b.classList.toggle('dash-pref-btn--active', b.dataset.pref === key);
    });
    if (_s) _s.prefView = key;
    const saved = _ctr.querySelector('#dashPrefSaved');
    if (saved) {
      saved.style.display = '';
      setTimeout(() => { if (saved) saved.style.display = 'none'; }, 2000);
    }
  });
}

// ── Metrics ───────────────────────────────────────────────────
async function _loadMetrics() {
  if (!_s || !_ctr) return;
  const plaza = _s.plaza;
  const feats = _s.feats;
  const role = _s.role;
  const isAdmin = _isAdmin(role);

  const [unidades, externos, incidencias, solicitudes] = await Promise.all([
    plaza ? _countPlaza(COL.CUADRE, plaza) : Promise.resolve(0),
    plaza ? _countPlaza(COL.EXTERNOS, plaza) : Promise.resolve(0),
    feats.incidencias && plaza ? _countNotas(plaza) : Promise.resolve(0),
    feats.solicitudes && isAdmin
      ? _safeCount(db.collection('solicitudes').where('estado', '==', 'PENDIENTE').limit(80).get())
      : Promise.resolve(0),
  ]);

  if (!_s || !_ctr) return;
  _s.metrics = { unidades, externos, incidencias, solicitudes };
  _updateKpis();
  _updateMapStats();
}

function _updateKpis() {
  const m = _s?.metrics;
  if (!m || !_ctr) return;
  _setText('#dashKpiUni', m.unidades);
  _setText('#dashKpiExt', m.externos);
  _setText('#dashKpiInc', m.incidencias);
  _setText('#dashKpiSol', m.solicitudes);

  // Update alert state on incidencias KPI
  const kpiInc = _ctr.querySelector('#dashKpiInc')?.closest('.dash-kpi');
  if (kpiInc) kpiInc.classList.toggle('dash-kpi--alert', m.incidencias > 0);
}

function _updateMapStats() {
  const m = _s?.metrics;
  if (!m || !_ctr) return;
  _setText('#dashStatUni', m.unidades);
  _setText('#dashStatExt', m.externos);
  _setText('#dashStatInc', m.incidencias);
}

function _syncPlaza() {
  if (!_ctr || !_s) return;
  const p = _s.plaza || 'Global';
  _setText('#dashChipPlaza', p, true);
  _setText('#dashLivePlaza', p);
}

// ── Map preview ───────────────────────────────────────────────
const _MAP_CACHE_KEY = p => `mex.dash.map.${p}`;

function _readMapCache(plaza) {
  try {
    const raw = localStorage.getItem(_MAP_CACHE_KEY(plaza));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.estructura) || !Array.isArray(d.unidades)) return null;
    if (Date.now() - Number(d.savedAt || 0) > 43200000) return null;
    return d;
  } catch (_) { return null; }
}

function _writeMapCache(plaza, data) {
  try {
    localStorage.setItem(_MAP_CACHE_KEY(plaza), JSON.stringify({
      savedAt: Date.now(),
      estructura: data.estructura.slice(0, 800),
      unidades: data.unidades.slice(0, 650),
    }));
  } catch (_) {}
}

async function _loadMapPreview() {
  if (!_s || !_ctr) return;
  const plaza = _s.plaza;
  const el = _ctr.querySelector('#dashMapCanvas');
  if (!el) return;

  if (!plaza) {
    el.innerHTML = `<div class="dash-map-nodata">
      <span class="material-symbols-outlined">map_off</span>
      <span>Selecciona una plaza para ver el mapa</span>
    </div>`;
    return;
  }

  const reqId = ++_mapReqId;

  // Show from cache first
  const cached = _readMapCache(plaza);
  if (cached) _paintMap(el, plaza, cached.estructura, cached.unidades);
  else el.innerHTML = '<div class="dash-map-loading"><div class="dash-spinner"></div></div>';

  try {
    const [estructura, mapaData] = await Promise.all([
      obtenerEstructuraMapa(plaza),
      obtenerDatosParaMapa(plaza),
    ]);
    if (!_s || reqId !== _mapReqId || !_ctr) return;
    const unidades = Array.isArray(mapaData?.unidades) ? mapaData.unidades : [];
    _writeMapCache(plaza, { estructura: estructura || [], unidades });
    _paintMap(el, plaza, estructura || [], unidades);
  } catch (err) {
    if (!_s || reqId !== _mapReqId || !_ctr) return;
    if (!cached) {
      el.innerHTML = `<div class="dash-map-nodata">
        <span class="material-symbols-outlined">map_off</span>
        <span>Vista en vivo no disponible</span>
      </div>`;
    }
  }
}

function _paintMap(container, plaza, estructuraRaw, unidadesRaw) {
  if (!container) return;
  try {
    const estructura = (Array.isArray(estructuraRaw) ? estructuraRaw : []).map((item, i) => normalizarElemento(item, i));
    const normUnidades = (Array.isArray(unidadesRaw) ? unidadesRaw : []).map(u => normalizarUnidad(u)).filter(u => u.mva);
    const vm = buildMapaViewModel(estructura, normUnidades, {}, {});

    const cajones = Array.isArray(vm.cajones) ? vm.cajones.slice(0, 320) : [];
    if (!cajones.length && !normUnidades.length) {
      container.innerHTML = `<div class="dash-map-nodata">
        <span class="material-symbols-outlined">map_off</span>
        <span>Sin datos de mapa para ${esc(plaza)}</span>
      </div>`;
      return;
    }

    // Bounding box
    let minX = 0, minY = 0, maxX = 800, maxY = 600;
    if (cajones.length) {
      minX = Math.min(...cajones.map(c => c.x));
      minY = Math.min(...cajones.map(c => c.y));
      maxX = Math.max(...cajones.map(c => c.x + c.width));
      maxY = Math.max(...cajones.map(c => c.y + c.height));
    }
    const rect = container.getBoundingClientRect();
    const mapW = maxX - minX + 80, mapH = maxY - minY + 80;
    const scale = Math.min(
      Math.min(((rect.width || 600) / mapW) * 0.88, ((rect.height || 300) / mapH) * 0.88),
      1.3
    );

    const colors = {
      LISTO: '#10b981', SUCIO: '#f59e0b', MANTENIMIENTO: '#ef4444',
      RESGUARDO: '#92400e', TRASLADO: '#7c3aed', 'EN RENTA': '#38bdf8',
      RETENIDA: '#1d4ed8', VENTA: '#f59e0b', HYP: '#ef4444',
    };

    const cajonByPos = new Map();
    let html = `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(${scale});transform-origin:center;width:${mapW}px;height:${mapH}px;">`;

    for (const c of cajones) {
      cajonByPos.set(c.pos, c);
      if (c.tipo === 'pilar') continue;
      const style = c.esLabel
        ? 'background:transparent;border:none;color:rgba(255,255,255,.3);font-size:28px;font-weight:bold;'
        : 'background:rgba(255,255,255,.02);border:1.5px solid rgba(255,255,255,.08);border-radius:5px 5px 0 0;';
      html += `<div style="position:absolute;left:${c.x - minX + 40}px;top:${c.y - minY + 40}px;width:${c.width}px;height:${c.height}px;transform:rotate(${c.rotation}deg);${style}display:flex;align-items:center;justify-content:center;box-sizing:border-box;">${c.esLabel ? c.pos : ''}</div>`;
    }

    let placed = 0;
    for (const [mva, u] of Array.from(vm.unitMap.entries()).slice(0, 220)) {
      if (u.pos === 'LIMBO') continue;
      const c = cajonByPos.get(u.pos);
      if (!c) continue;
      placed++;
      const bg = colors[u.estado] || '#64748b';
      html += `<div style="position:absolute;left:${c.x - minX + 40}px;top:${c.y - minY + 40}px;width:${c.width}px;height:${c.height}px;transform:rotate(${c.rotation}deg);border-radius:14px 14px 8px 8px;background:linear-gradient(155deg,${bg},#000 130%);box-shadow:0 6px 14px -3px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.2);color:#fff;font-size:14px;font-weight:900;text-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;box-sizing:border-box;">${esc(mva)}</div>`;
    }
    html += '</div>';

    // Fallback: status summary if nothing was placed
    if (placed === 0 && normUnidades.length > 0) {
      const byStatus = {};
      normUnidades.forEach(u => { byStatus[u.estado] = (byStatus[u.estado] || 0) + 1; });
      const chips = Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([est, n]) => {
        const bg = colors[est] || '#64748b';
        return `<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:99px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);">
          <span style="width:8px;height:8px;border-radius:50%;background:${bg};flex-shrink:0;"></span>
          <span style="font-size:11px;color:#cbd5e1;font-weight:700;">${esc(est)}</span>
          <strong style="font-size:12px;color:#fff;">${n}</strong>
        </div>`;
      }).join('');
      container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;padding:20px;">
        <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,.35);letter-spacing:.04em;text-transform:uppercase;">Unidades · ${esc(plaza)}</span>
        <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;">${chips}</div>
      </div>`;
      return;
    }

    container.innerHTML = html;
  } catch (e) {
    console.warn('[dashboard] paintMap:', e?.message);
    if (container) container.innerHTML = `<div class="dash-map-nodata">
      <span class="material-symbols-outlined">map_off</span>
      <span>Error al renderizar el mapa</span>
    </div>`;
  }
}

// ── Realtime widgets ──────────────────────────────────────────
function _stopWidgets() {
  [_unsubCuadre, _unsubCola, _unsubTurno].forEach(fn => {
    if (typeof fn === 'function') try { fn(); } catch (_) {}
  });
  _unsubCuadre = _unsubCola = _unsubTurno = null;
}

function _startWidgets() {
  if (!_s) return;
  const { plaza, feats, role, profile } = _s;
  const isAdmin = _isAdmin(role);
  const uid = profile?.uid || profile?.id || '';

  // Estado del patio
  if (feats.cuadre && isAdmin && plaza) {
    try {
      _unsubCuadre = db.collection(COL.CUADRE).where('plaza', '==', plaza)
        .onSnapshot(snap => {
          if (!_s) return;
          const stats = { listo: 0, sucio: 0, manto: 0, otros: 0 };
          snap.forEach(doc => {
            const estado = String(doc.data()?.estado || '').toUpperCase().trim();
            if (estado === 'LISTO') stats.listo++;
            else if (['SUCIO','EN_PREP','EN PREPARACIÓN','PREPARACION','LAVADO','LIMPIEZA'].includes(estado)) stats.sucio++;
            else if (['MANTENIMIENTO','MANTO','HYP','RETENIDA'].includes(estado)) stats.manto++;
            else if (estado) stats.otros++;
          });
          _s.cuadreStats = stats;
          _updateCuadreWidget();
        }, () => {});
    } catch (_) {}
  } else {
    _updateCuadreWidget();
  }

  // Cola preparación
  if (feats.cola && plaza) {
    try {
      _unsubCola = db.collection('cola_preparacion').doc(plaza).collection('items')
        .limit(8).onSnapshot(snap => {
          if (!_s) return;
          const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          items.sort((a, b) => {
            const ao = Number(a.orden), bo = Number(b.orden);
            if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
            return (a.fechaSalida?.toDate?.()?.getTime?.() ?? 0) - (b.fechaSalida?.toDate?.()?.getTime?.() ?? 0);
          });
          _s.colaPreview = items.slice(0, 5);
          _updateColaWidget();
        }, () => { if (_s) { _s.colaPreview = []; _updateColaWidget(); } });
    } catch (_) {}
  } else {
    _updateColaWidget();
  }

  // Mi turno
  if (uid) {
    try {
      _unsubTurno = db.collection('turnos')
        .where('usuarioId', '==', uid).where('estado', '==', 'ACTIVO').limit(1)
        .onSnapshot(snap => {
          if (!_s) return;
          _s.turnoActivo = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
          _updateTurnoWidget();
        }, () => { if (_s) { _s.turnoActivo = null; _updateTurnoWidget(); } });
    } catch (_) {}
  } else {
    _updateTurnoWidget();
  }
}

function _updateCuadreWidget() {
  const el = _ctr?.querySelector('#dashCuadreBody');
  if (!el) return;
  if (!_s?.plaza) { el.innerHTML = '<p class="dash-widget-empty">Selecciona una plaza</p>'; return; }
  const s = _s.cuadreStats;
  const total = s.listo + s.sucio + s.manto + s.otros;
  const avail = total > 0 ? Math.round((s.listo / total) * 100) : 0;
  el.innerHTML = `
    <div class="dash-cs-stats">
      <div class="dash-cs-stat">
        <span class="dash-cs-dot" style="background:#10b981"></span>
        <span class="dash-cs-label">Listo</span>
        <span class="dash-cs-val">${s.listo}</span>
      </div>
      <div class="dash-cs-stat">
        <span class="dash-cs-dot" style="background:#f59e0b"></span>
        <span class="dash-cs-label">Sucio / En prep</span>
        <span class="dash-cs-val">${s.sucio}</span>
      </div>
      <div class="dash-cs-stat">
        <span class="dash-cs-dot" style="background:#ef4444"></span>
        <span class="dash-cs-label">Manto / Retenida</span>
        <span class="dash-cs-val">${s.manto}</span>
      </div>
    </div>
    <div class="dash-cs-bar">
      <div style="width:${s.listo / Math.max(total, 1) * 100}%;background:#10b981"></div>
      <div style="width:${s.sucio / Math.max(total, 1) * 100}%;background:#f59e0b"></div>
      <div style="width:${s.manto / Math.max(total, 1) * 100}%;background:#ef4444"></div>
    </div>
    <div class="dash-cs-avail">Disponibilidad: <strong>${avail}%</strong></div>`;
}

function _updateColaWidget() {
  const el = _ctr?.querySelector('#dashColaBody');
  if (!el) return;
  const items = _s?.colaPreview || [];
  if (!_s?.plaza) { el.innerHTML = '<p class="dash-widget-empty">Selecciona una plaza</p>'; return; }
  if (!items.length) { el.innerHTML = '<p class="dash-widget-empty">Cola vacía</p>'; return; }
  el.innerHTML = items.map(it => `
    <div class="dash-cola-row">
      <span class="dash-cola-mva">${esc(String(it.mva || it.id || '—'))}</span>
      <span class="dash-cola-info">${esc(String(it.asignado || 'Sin asignar'))}</span>
      <span class="dash-cola-prog">${_cpDone(it.checklist)}/4</span>
    </div>`).join('');
}

function _updateTurnoWidget() {
  const el = _ctr?.querySelector('#dashTurnoBody');
  if (!el) return;
  const turno = _s?.turnoActivo;
  const profile = _s?.profile || {};
  const uid = profile?.uid || profile?.id || '';
  const plaza = _s?.plaza || '';

  if (!turno) {
    el.innerHTML = `
      <p class="dash-widget-empty" style="margin-bottom:10px;">Sin turno activo</p>
      <button type="button" class="dash-turno-btn dash-turno-btn--start" id="dashIniciarTurno"
              ${(!uid || !plaza) ? 'disabled' : ''}>
        <span class="material-symbols-outlined" style="font-size:16px;">play_circle</span> Iniciar turno
      </button>`;
    el.querySelector('#dashIniciarTurno')?.addEventListener('click', async () => {
      const btn = el.querySelector('#dashIniciarTurno');
      if (btn) btn.disabled = true;
      try {
        await iniciarTurno({ uid: window._auth?.currentUser?.uid || uid, ...profile }, plaza);
      } catch (e) {
        console.warn('[dashboard] iniciarTurno:', e);
        if (_s && btn) btn.disabled = false;
      }
    });
    return;
  }

  const inicio = turno.inicio?.toDate?.() || new Date(turno.inicio || Date.now());
  const ms = Date.now() - inicio.getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const elapsed = h > 0 ? `${h}h ${m}m en turno` : `${m}m en turno`;
  const since = inicio.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  el.innerHTML = `
    <div class="dash-turno-active">
      <span class="material-symbols-outlined dash-turno-ico">schedule</span>
      <div>
        <div class="dash-turno-elapsed">${esc(elapsed)}</div>
        <div class="dash-turno-since">Desde las ${esc(since)}</div>
      </div>
    </div>
    <button type="button" class="dash-turno-btn dash-turno-btn--end" id="dashCerrarTurno">
      <span class="material-symbols-outlined" style="font-size:16px;">stop_circle</span> Cerrar turno
    </button>`;

  el.querySelector('#dashCerrarTurno')?.addEventListener('click', async () => {
    const btn = el.querySelector('#dashCerrarTurno');
    if (btn) btn.disabled = true;
    try {
      await cerrarTurno(turno.id);
    } catch (e) {
      console.warn('[dashboard] cerrarTurno:', e);
      if (_s && btn) btn.disabled = false;
    }
  });
}

// ── Preferred view ────────────────────────────────────────────
function _readPrefView() {
  try { return localStorage.getItem('mex.app.preferredView') || 'dashboard'; } catch (_) { return 'dashboard'; }
}

function _savePrefView(key) {
  try { localStorage.setItem('mex.app.preferredView', key); } catch (_) {}
  // Best-effort save to profile in Firestore
  const gs = getState();
  const uid = gs.profile?.uid || gs.profile?.id;
  if (!uid || !window._db) return;
  window._db.collection('usuarios').doc(uid).update({
    'profilePreferences.vistaPreferida': key,
  }).catch(() => {});
}

// ── Data helpers ──────────────────────────────────────────────
async function _countPlaza(collection, plaza) {
  let count = 0;
  const seen = new Set();
  try {
    const snap = await db.collection(collection).where('plaza', '==', plaza).limit(400).get();
    snap.docs.forEach(d => { if (!seen.has(d.id)) { seen.add(d.id); count++; } });
  } catch (_) {}
  if (count === 0) {
    try {
      const snap = await db.collection(collection).limit(600).get();
      snap.docs.forEach(d => {
        if (seen.has(d.id)) return;
        const data = d.data() || {};
        const p = String(data.plaza || data.plazaId || data.plazaAsignada || data.sucursal || '').toUpperCase().trim();
        if (!plaza || p === plaza) { seen.add(d.id); count++; }
      });
    } catch (_) {}
  }
  return count;
}

async function _countNotas(plaza) {
  let total = 0;
  try {
    const snap = await db.collection(COL.NOTAS).where('plaza', '==', plaza).limit(160).get();
    snap.docs.forEach(d => {
      const estado = String(d.data()?.estado || '').toUpperCase();
      if (estado !== 'RESUELTA' && estado !== 'CERRADA') total++;
    });
  } catch (_) {}
  return total;
}

async function _safeCount(promise) {
  try { return (await promise)?.size || 0; } catch (_) { return 0; }
}

function _cpDone(checklist) {
  if (!checklist) return 0;
  return ['lavado', 'gasolina', 'docs', 'revision'].filter(k => checklist[k] === true).length;
}

// ── DOM helpers ───────────────────────────────────────────────
function _isAdmin(role) {
  return ['SUPERVISOR','JEFE_PATIO','GERENTE_PLAZA','JEFE_REGIONAL','CORPORATIVO_USER','JEFE_OPERACION','PROGRAMADOR','VENTAS'].includes(String(role || '').toUpperCase());
}

function _firstName(profile) {
  const name = String(profile?.nombreCompleto || profile?.nombre || profile?.email || 'Usuario').trim();
  return name.split(/\s+/)[0] || name;
}

function _setText(sel, val, includeIcon = false) {
  const el = _ctr?.querySelector(sel);
  if (!el) return;
  if (includeIcon) {
    const icon = el.querySelector('.material-symbols-outlined');
    el.textContent = String(val ?? '');
    if (icon) el.insertBefore(icon, el.firstChild);
  } else {
    el.textContent = String(val ?? '');
  }
}

function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
