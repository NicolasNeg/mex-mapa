// ═══════════════════════════════════════════════════════════
//  /js/app/views/dashboard.js  — Dashboard adaptativo SaaS
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';
import { db, COL } from '/js/core/database.js';
import { iniciarTurno, cerrarTurno } from '/js/app/features/turnos/turnos-data.js';
import { semanaInicio, DIAS } from '/js/app/features/turnos/horarios-data.js';

// ── State ────────────────────────────────────────────────────
let _ctr = null;
let _s = null;
let _offs = [];
let _unsubCuadre = null;
let _unsubCola   = null;
let _unsubTurno  = null;
let _unsubPlazaTurnos = null;
let _turnoTimer  = null;

// ── Lifecycle ─────────────────────────────────────────────────
export async function mount({ container, navigate }) {
  unmount();
  _ctr = container;
  _ensureCss();

  const gs      = getState();
  const role    = String(gs.role || 'AUXILIAR').toUpperCase();
  const plaza   = String(getCurrentPlaza() || gs.profile?.plazaAsignada || '').toUpperCase().trim();
  const empresa = window.MEX_CONFIG?.empresa || {};
  const feats   = _feats();

  _s = {
    role,
    profile:    gs.profile || {},
    company:    String(gs.company || empresa.nombre || empresa.id || 'MAPA').trim(),
    logoUrl:    String(empresa.logoUrl || empresa.branding?.logoUrl || '').trim(),
    brandColor: String(empresa.branding?.colorPrincipal || '#6366f1').trim(),
    plaza,
    feats,
    metrics:    { unidades: 0, externos: 0, incidencias: 0, solicitudes: 0 },
    cuadreStats:{ listo: 0, sucio: 0, manto: 0, otros: 0 },
    colaPreview:  [],
    turnoActivo:  null,
    turnosPlaza:  [],
    horarioHoy:   null,
    prefView:     _readPrefView(),
  };

  _ctr.innerHTML = _renderHtml();
  _bindAll();
  _startWidgets();
  void _loadMetrics();
  void _loadHorarioUsuario();

  _offs.push(onPlazaChange(next => {
    if (!_s || !_ctr) return;
    _s.plaza = String(next || '').toUpperCase().trim();
    _syncPlaza();
    _stopWidgets();
    _startWidgets();
    void _loadMetrics();
  }));

  const searchHandler = event => {
    const route = String(event?.detail?.route || '');
    if (!(route.startsWith('/app/dashboard') || route === '/home')) return;
    const q = String(event?.detail?.query || '').trim();
    if (!q) return;
    if (typeof navigate === 'function') navigate(`/app/cuadre?query=${encodeURIComponent(q)}`);
  };
  window.addEventListener('mex:global-search', searchHandler);
  _offs.push(() => window.removeEventListener('mex:global-search', searchHandler));
}

export function unmount() {
  _offs.forEach(fn => { try { fn(); } catch (_) {} });
  _offs = [];
  _stopWidgets();
  _ctr = null;
  _s = null;
}

// ── Feature detection ─────────────────────────────────────────
function _feats() {
  const can = f => window.mexFeatures ? window.mexFeatures.puedeUsar(f) : true;
  return {
    cuadre:          can('cuadre'),
    incidencias:     can('incidencias'),
    cola:            can('cola_preparacion'),
    mensajeria:      can('mensajeria'),
    alertas:         can('alertas'),
    reportes:        can('reportes'),
    edicion_mapa:    can('edicion_mapa'),
    solicitudes:     can('solicitudes_acceso'),
    gestion_usuarios:can('gestion_usuarios'),
  };
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
  const { role, profile, company, plaza, feats, metrics, prefView, logoUrl, brandColor } = _s;
  const name      = _firstName(profile);
  const roleLabel = ROLE_LABELS?.[role] || role;
  const now       = new Date();
  const dateStr   = now.toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

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
    <div class="dash-body">

      <!-- Brand card (left) -->
      <div class="dash-brand-card" style="--brand:${esc(brandColor)}">
        <div class="dash-brand-body">
          <div class="dash-brand-logo-wrap">
            ${logoUrl
              ? `<img src="${esc(logoUrl)}" class="dash-brand-logo" alt="${esc(company)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
              : ''}
            <div class="dash-brand-monogram" style="${logoUrl ? 'display:none' : ''}">${esc((company && company !== 'MAPA' ? company : '?').charAt(0).toUpperCase())}</div>
          </div>
          ${company && company !== 'MAPA' ? `<h2 class="dash-brand-title">${esc(company)}</h2>` : ''}
          <div class="dash-brand-pills">
            <span class="dash-brand-pill">
              <span class="material-symbols-outlined">location_on</span>
              ${esc(plaza || 'Global')}
            </span>
            <span class="dash-brand-pill dash-brand-pill--accent">
              <span class="material-symbols-outlined">person</span>
              ${esc(roleLabel)}
            </span>
          </div>
          <p class="dash-brand-date">${esc(dateStr.charAt(0).toUpperCase() + dateStr.slice(1))}</p>
        </div>
      </div>

      <!-- Right sidebar: widgets -->
      <div class="dash-sidebar">

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

        <!-- Mi turno (expandido) -->
        <div class="dash-widget dash-turno-widget">
          <div class="dash-widget-head">
            <span class="material-symbols-outlined">badge</span>
            <h3>Mi turno</h3>
          </div>
          <div class="dash-widget-body" id="dashTurnoBody">
            <p class="dash-widget-empty">Cargando…</p>
          </div>
        </div>

        <!-- Equipo en turno -->
        <div class="dash-widget" id="dashEquipoWidget" style="display:none;">
          <div class="dash-widget-head">
            <span class="material-symbols-outlined">group</span>
            <h3>Equipo en turno</h3>
            <span class="dash-equipo-badge" id="dashEquipoBadge">0</span>
          </div>
          <div class="dash-widget-body" id="dashEquipoBody">
            <p class="dash-widget-empty">Sin compañeros activos</p>
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
  kpis.push({ icon: 'directions_car', id: 'dashKpiUni', val: metrics.unidades, label: 'Unidades activas', alert: false });
  kpis.push({ icon: 'local_shipping',  id: 'dashKpiExt', val: metrics.externos, label: 'Externos', alert: false });
  if (feats.incidencias) kpis.push({ icon: 'warning', id: 'dashKpiInc', val: metrics.incidencias, label: 'Incidencias', alert: metrics.incidencias > 0 });
  if (feats.solicitudes && _isAdmin(role)) kpis.push({ icon: 'assignment_ind', id: 'dashKpiSol', val: metrics.solicitudes, label: 'Solicitudes', alert: metrics.solicitudes > 0 });
  return kpis.map(k => `
    <div class="dash-kpi${k.alert ? ' dash-kpi--alert' : ''}">
      <span class="material-symbols-outlined" style="font-size:18px;color:${k.alert ? '#dc2626' : '#6366f1'};">${k.icon}</span>
      <div class="dash-kpi-val" id="${k.id}">${k.val}</div>
      <div class="dash-kpi-label">${k.label}</div>
    </div>`).join('');
}

function _renderPrefBar(feats, prefView) {
  const opts = [
    { key: 'dashboard',        label: 'Dashboard', feat: true },
    { key: 'mapa',             label: 'Mapa',      feat: true },
    { key: 'cola-preparacion', label: 'Cola',      feat: feats.cola },
    { key: 'incidencias',      label: 'Alertas',   feat: feats.incidencias },
    { key: 'mensajes',         label: 'Mensajes',  feat: feats.mensajeria },
  ].filter(o => o.feat);
  const current = prefView || 'dashboard';
  return `
  <div class="dash-pref-bar">
    <span class="dash-pref-label">Al iniciar, ir a:</span>
    <div class="dash-pref-btns" id="dashPrefBtns">
      ${opts.map(o => `
        <button class="dash-pref-btn${current === o.key ? ' dash-pref-btn--active' : ''}" type="button" data-pref="${esc(o.key)}">
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
    await Promise.all([_loadMetrics(), _loadHorarioUsuario()]);
    if (btn) btn.disabled = false;
  });

  _ctr?.querySelector('#dashPrefBtns')?.addEventListener('click', e => {
    const btn = e.target.closest('.dash-pref-btn');
    if (!btn) return;
    const key = btn.dataset.pref;
    _savePrefView(key);
    _ctr.querySelectorAll('.dash-pref-btn').forEach(b => b.classList.toggle('dash-pref-btn--active', b.dataset.pref === key));
    if (_s) _s.prefView = key;
    const saved = _ctr.querySelector('#dashPrefSaved');
    if (saved) { saved.style.display = ''; setTimeout(() => { if (saved) saved.style.display = 'none'; }, 2000); }
  });
}

// ── Metrics ───────────────────────────────────────────────────
async function _loadMetrics() {
  if (!_s || !_ctr) return;
  const { plaza, feats, role } = _s;
  const isAdmin = _isAdmin(role);
  const [unidades, externos, incidencias, solicitudes] = await Promise.all([
    plaza ? _countPlaza(COL.CUADRE,   plaza) : Promise.resolve(0),
    plaza ? _countPlaza(COL.EXTERNOS, plaza) : Promise.resolve(0),
    feats.incidencias && plaza ? _countNotas(plaza) : Promise.resolve(0),
    feats.solicitudes && isAdmin
      ? _safeCount(db.collection('solicitudes').where('estado','==','PENDIENTE').limit(80).get())
      : Promise.resolve(0),
  ]);
  if (!_s || !_ctr) return;
  _s.metrics = { unidades, externos, incidencias, solicitudes };
  _updateKpis();
}

function _updateKpis() {
  const m = _s?.metrics;
  if (!m || !_ctr) return;
  _setText('#dashKpiUni', m.unidades);
  _setText('#dashKpiExt', m.externos);
  _setText('#dashKpiInc', m.incidencias);
  _setText('#dashKpiSol', m.solicitudes);
  const kpiInc = _ctr.querySelector('#dashKpiInc')?.closest('.dash-kpi');
  if (kpiInc) kpiInc.classList.toggle('dash-kpi--alert', m.incidencias > 0);
}

function _syncPlaza() {
  if (!_ctr || !_s) return;
  _setText('#dashChipPlaza', _s.plaza || 'Global', true);
}

// ── Horario del usuario ───────────────────────────────────────
async function _loadHorarioUsuario() {
  if (!_s) return;
  const uid   = _s.profile?.uid || _s.profile?.id || '';
  const plaza = _s.plaza;
  if (!uid || !plaza) { _updateTurnoWidget(); return; }
  try {
    const semana = semanaInicio();
    const eid    = window.MEX_CONFIG?.empresa?.id || '';
    let q = db.collection('horarios')
      .where('usuarioId', '==', uid)
      .where('plaza', '==', plaza)
      .where('semanaInicio', '==', semana);
    if (eid) q = q.where('empresaId', '==', eid);
    const snap = await q.limit(1).get();
    if (!_s) return;
    if (!snap.empty) {
      const data = snap.docs[0].data();
      const diaKey = _diaKeyHoy();
      _s.horarioHoy = data.dias?.[diaKey] || null;
    } else {
      _s.horarioHoy = null;
    }
  } catch (_) {
    _s.horarioHoy = null;
  }
  _updateTurnoWidget();
}

// ── Widgets ───────────────────────────────────────────────────
function _stopWidgets() {
  [_unsubCuadre, _unsubCola, _unsubTurno, _unsubPlazaTurnos].forEach(fn => {
    if (typeof fn === 'function') try { fn(); } catch (_) {}
  });
  _unsubCuadre = _unsubCola = _unsubTurno = _unsubPlazaTurnos = null;
  if (_turnoTimer) { clearInterval(_turnoTimer); _turnoTimer = null; }
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

  // Cola
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
          // Cronómetro vivo cuando hay turno activo
          if (_turnoTimer) clearInterval(_turnoTimer);
          if (_s.turnoActivo) {
            _turnoTimer = setInterval(() => { if (_s?.turnoActivo) _updateTurnoElapsed(); }, 30000);
          }
        }, () => { if (_s) { _s.turnoActivo = null; _updateTurnoWidget(); } });
    } catch (_) {}
  } else {
    _updateTurnoWidget();
  }

  // Equipo en turno (todos en la misma plaza)
  if (plaza) {
    try {
      _unsubPlazaTurnos = db.collection('turnos')
        .where('plazaId', '==', plaza).where('estado', '==', 'ACTIVO').limit(30)
        .onSnapshot(snap => {
          if (!_s) return;
          const myUid = profile?.uid || profile?.id || '';
          _s.turnosPlaza = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(t => t.usuarioId !== myUid);
          _updateEquipoWidget();
        }, () => { if (_s) { _s.turnosPlaza = []; _updateEquipoWidget(); } });
    } catch (_) {}
  } else {
    _updateEquipoWidget();
  }
}

// ── Turno widget ──────────────────────────────────────────────
function _updateTurnoWidget() {
  const el = _ctr?.querySelector('#dashTurnoBody');
  if (!el) return;
  const turno    = _s?.turnoActivo;
  const profile  = _s?.profile || {};
  const uid      = profile?.uid || profile?.id || '';
  const plaza    = _s?.plaza || '';
  const horario  = _s?.horarioHoy;

  if (turno) {
    _renderTurnoActivo(el, turno, horario, uid, plaza);
    return;
  }

  // Sin turno: mostrar smart hint basado en horario
  const hint = _buildTurnoHint(horario);
  el.innerHTML = `
    ${hint ? `<div class="dash-turno-hint">${hint.icon} <span>${esc(hint.text)}</span></div>` : ''}
    ${horario && horario.tipo !== 'DESCANSO' ? `
    <div class="dash-turno-schedule">
      <div class="dash-turno-sch-row">
        <span class="material-symbols-outlined" style="font-size:15px;color:#6366f1;">schedule</span>
        <span>Entrada: <strong>${esc(horario.inicio || '—')}</strong></span>
      </div>
      <div class="dash-turno-sch-row">
        <span class="material-symbols-outlined" style="font-size:15px;color:#94a3b8;">logout</span>
        <span>Salida: <strong>${esc(horario.fin || '—')}</strong></span>
      </div>
    </div>` : ''}
    <button type="button" class="dash-turno-btn dash-turno-btn--start" id="dashIniciarTurno" ${(!uid || !plaza) ? 'disabled' : ''}>
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
}

function _renderTurnoActivo(el, turno, horario, uid, plaza) {
  const inicio  = turno.inicio?.toDate?.() || new Date(turno.inicio || Date.now());
  const ms      = Date.now() - inicio.getTime();
  const h       = Math.floor(ms / 3600000);
  const m       = Math.floor((ms % 3600000) / 60000);
  const elapsed = h > 0 ? `${h}h ${m}m en turno` : `${m}m en turno`;
  const since   = inicio.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const fin     = horario?.fin;
  const finStr  = fin ? ` · Sale a las ${fin}` : '';

  // Calcular minutos restantes si hay hora de fin en horario
  let restanteHtml = '';
  if (fin) {
    const [fh, fm] = fin.split(':').map(Number);
    const finMs = new Date().setHours(fh, fm, 0, 0);
    const restMs = finMs - Date.now();
    if (restMs > 0) {
      const rh = Math.floor(restMs / 3600000);
      const rm = Math.floor((restMs % 3600000) / 60000);
      const restStr = rh > 0 ? `${rh}h ${rm}m restantes` : `${rm} min restantes`;
      restanteHtml = `<div class="dash-turno-rest"><span class="material-symbols-outlined" style="font-size:13px;">hourglass_bottom</span>${esc(restStr)}</div>`;
    }
  }

  el.innerHTML = `
    <div class="dash-turno-active">
      <div class="dash-turno-pulse"></div>
      <div class="dash-turno-active-info">
        <div class="dash-turno-elapsed" id="dashTurnoElapsed">${esc(elapsed)}</div>
        <div class="dash-turno-since">Desde las ${esc(since)}${finStr}</div>
        ${restanteHtml}
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

function _updateTurnoElapsed() {
  const el    = _ctr?.querySelector('#dashTurnoElapsed');
  const turno = _s?.turnoActivo;
  if (!el || !turno) return;
  const inicio = turno.inicio?.toDate?.() || new Date(turno.inicio || Date.now());
  const ms = Date.now() - inicio.getTime();
  const h  = Math.floor(ms / 3600000);
  const m  = Math.floor((ms % 3600000) / 60000);
  el.textContent = h > 0 ? `${h}h ${m}m en turno` : `${m}m en turno`;
}

function _buildTurnoHint(horario) {
  if (!horario) return null;
  if (horario.tipo === 'DESCANSO')    return { icon: '😴', text: 'Hoy es tu día de descanso' };
  if (horario.tipo === 'VACACIONES')  return { icon: '🏖️', text: 'Estás de vacaciones' };
  if (horario.tipo === 'FESTIVO')     return { icon: '🎉', text: 'Día festivo' };
  if (!horario.inicio) return null;

  const [sh, sm] = horario.inicio.split(':').map(Number);
  const now = new Date();
  const start = new Date();
  start.setHours(sh, sm, 0, 0);
  const diffMin = Math.round((start - now) / 60000);

  if (diffMin > 0 && diffMin <= 15)  return { icon: '⚡', text: `Tu turno inicia en ${diffMin} minutos — ¡prepárate!` };
  if (diffMin > 15 && diffMin <= 60) return { icon: '🕐', text: `Tu turno inicia en ${diffMin} minutos (a las ${horario.inicio})` };
  if (diffMin > 60 && diffMin <= 240)return { icon: '📅', text: `Tu turno empieza hoy a las ${horario.inicio}` };
  if (diffMin < 0 && diffMin > -30)  return { icon: '⚠️', text: `Tu turno empezó hace ${Math.abs(diffMin)} min — ¿olvidaste marcarlo?` };
  return null;
}

// ── Equipo en turno ───────────────────────────────────────────
function _updateEquipoWidget() {
  const widget = _ctr?.querySelector('#dashEquipoWidget');
  const el     = _ctr?.querySelector('#dashEquipoBody');
  const badge  = _ctr?.querySelector('#dashEquipoBadge');
  if (!widget || !el) return;
  const turnos = _s?.turnosPlaza || [];
  if (!badge) {} else badge.textContent = String(turnos.length);
  widget.style.display = turnos.length > 0 ? '' : 'none';
  if (!turnos.length) return;
  el.innerHTML = turnos.map(t => {
    const nombre = esc(String(t.usuarioNombre || t.nombre || 'Usuario').split(/\s+/)[0]);
    const ini = t.inicio?.toDate?.() || new Date(t.inicio || Date.now());
    const ms  = Date.now() - ini.getTime();
    const h   = Math.floor(ms / 3600000);
    const m   = Math.floor((ms % 3600000) / 60000);
    const dur = h > 0 ? `${h}h ${m}m` : `${m}m`;
    const initial = (t.usuarioNombre || t.nombre || '?').charAt(0).toUpperCase();
    return `<div class="dash-equipo-row">
      <div class="dash-equipo-avatar">${esc(initial)}</div>
      <div class="dash-equipo-info">
        <div class="dash-equipo-name">${nombre}</div>
        <div class="dash-equipo-dur">${esc(dur)} en turno</div>
      </div>
      <div class="dash-equipo-dot"></div>
    </div>`;
  }).join('');
}

// ── Cuadre / Cola widgets ─────────────────────────────────────
function _updateCuadreWidget() {
  const el = _ctr?.querySelector('#dashCuadreBody');
  if (!el) return;
  if (!_s?.plaza) { el.innerHTML = '<p class="dash-widget-empty">Selecciona una plaza</p>'; return; }
  const s = _s.cuadreStats;
  const total = s.listo + s.sucio + s.manto + s.otros;
  const avail = total > 0 ? Math.round((s.listo / total) * 100) : 0;
  el.innerHTML = `
    <div class="dash-cs-stats">
      <div class="dash-cs-stat"><span class="dash-cs-dot" style="background:#10b981"></span><span class="dash-cs-label">Listo</span><span class="dash-cs-val">${s.listo}</span></div>
      <div class="dash-cs-stat"><span class="dash-cs-dot" style="background:#f59e0b"></span><span class="dash-cs-label">Sucio / En prep</span><span class="dash-cs-val">${s.sucio}</span></div>
      <div class="dash-cs-stat"><span class="dash-cs-dot" style="background:#ef4444"></span><span class="dash-cs-label">Manto / Retenida</span><span class="dash-cs-val">${s.manto}</span></div>
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

// ── Preferred view ────────────────────────────────────────────
function _readPrefView() {
  try { return localStorage.getItem('mex.app.preferredView') || 'dashboard'; } catch (_) { return 'dashboard'; }
}

function _savePrefView(key) {
  try { localStorage.setItem('mex.app.preferredView', key); } catch (_) {}
  const gs = getState();
  const uid = gs.profile?.uid || gs.profile?.id;
  if (!uid || !window._db) return;
  window._db.collection('usuarios').doc(uid).update({ 'profilePreferences.vistaPreferida': key }).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────
function _diaKeyHoy() {
  return DIAS[((new Date().getDay() + 6) % 7)]; // lun=0..dom=6
}

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
