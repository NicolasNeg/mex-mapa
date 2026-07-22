// ═══════════════════════════════════════════════════════════
//  /js/app/views/dashboard.js  — Dashboard adaptativo SaaS
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';
import { db, COL } from '/js/core/database.js';
import { iniciarTurno, cerrarTurno } from '/js/app/features/turnos/turnos-mutations.js';
import { semanaInicio, DIAS } from '/js/app/features/turnos/horarios-data.js';

// ── State ────────────────────────────────────────────────────
let _ctr = null;
let _s = null;
let _offs = [];
let _unsubCuadre = null;
let _unsubTurno  = null;
let _unsubPlazaTurnos = null;
let _turnoTimer  = null;
let _navigate    = null;

// ── Lifecycle ─────────────────────────────────────────────────
export async function mount({ container, navigate }) {
  unmount();
  _ctr = container;
  _navigate = typeof navigate === 'function' ? navigate : null;
  _ensureCss();

  const gs      = getState();
  const role    = String(gs.role || 'AUXILIAR').toUpperCase();
  const plaza   = String(getCurrentPlaza() || gs.profile?.plazaAsignada || '').toUpperCase().trim();
  const profile = gs.profile || {};
  const uid     = String(
    window._auth?.currentUser?.uid
      || gs.user?.uid
      || profile.authUid
      || profile.uid
      || profile.id
      || ''
  ).trim();
  const empresa = window.MEX_CONFIG?.empresa || {};
  const feats   = _feats();

  _s = {
    role,
    uid,
    profile,
    company:    String(gs.company || empresa.nombre || empresa.id || 'MAPA').trim(),
    plaza,
    feats,
    metrics:    { unidades: 0, externos: 0, incidencias: 0, solicitudes: 0 },
    cuadreStats:{ listo: 0, sucio: 0, manto: 0, otros: 0 },
    turnoActivo:  null,
    turnoStatus:  'loading',
    turnoError:   '',
    turnosPlaza:  [],
    equipoStatus: 'loading',
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
    _s.horarioHoy = null;
    _s.turnoStatus = 'loading';
    _s.turnoError = '';
    _s.equipoStatus = 'loading';
    _syncPlaza();
    _stopWidgets();
    _updateTurnoWidget();
    _updateEquipoWidget();
    _startWidgets();
    void _loadMetrics();
    void _loadHorarioUsuario();
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
  _navigate = null;
}

// ── Feature detection ─────────────────────────────────────────
function _feats() {
  const can = f => window.mexFeatures ? window.mexFeatures.puedeUsar(f) : true;
  return {
    cuadre:          can('cuadre'),
    incidencias:     can('incidencias'),
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
  const { role, profile, company, plaza, feats, metrics, prefView } = _s;
  const name      = _firstName(profile);
  const roleLabel = ROLE_LABELS?.[role] || role;
  const canViewTurnos = window.mexPerms?.canDo?.('view_turnos') !== false;
  const showPatio = feats.cuadre && _isAdmin(role);
  const now       = new Date();
  const dateStr   = now.toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return `
<div class="dash">
  <div class="dash-inner">

    <header class="dash-top">
      <div class="dash-greeting">
        <span class="dash-eyebrow">${esc(company)}</span>
        <h1 class="dash-h1">Hola, ${esc(name)}</h1>
        <p class="dash-meta">
          <span class="material-symbols-outlined" aria-hidden="true">calendar_today</span>
          ${esc(dateStr.charAt(0).toUpperCase() + dateStr.slice(1))}
        </p>
      </div>
      <div class="dash-top-actions">
        <div class="dash-chips" aria-label="Contexto de operación">
          <span class="dash-chip" id="dashChipPlaza">
            <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
            ${esc(plaza || 'Global')}
          </span>
          <span class="dash-chip dash-chip--accent">
            <span class="material-symbols-outlined" aria-hidden="true">person</span>
            ${esc(roleLabel)}
          </span>
        </div>
        <button class="dash-btn-refresh" id="dashRefreshBtn" type="button" aria-label="Actualizar dashboard" title="Actualizar dashboard">
          <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
        </button>
      </div>
    </header>

    ${canViewTurnos ? `
    <section class="dash-shift-grid" aria-label="Turnos activos">
      <article class="dash-widget dash-turno-widget" aria-labelledby="dashTurnoTitle">
        <header class="dash-widget-head">
          <span class="dash-widget-icon material-symbols-outlined" aria-hidden="true">badge</span>
          <h2 id="dashTurnoTitle">Mi turno</h2>
          <span class="dash-status" id="dashTurnoStatus" aria-live="polite">Consultando</span>
        </header>
        <div class="dash-widget-body dash-turno-body" id="dashTurnoBody" aria-live="polite" aria-busy="true">
          ${_renderTurnoLoading()}
        </div>
      </article>

      <article class="dash-widget dash-equipo-widget" id="dashEquipoWidget" aria-labelledby="dashEquipoTitle">
        <header class="dash-widget-head">
          <span class="dash-widget-icon material-symbols-outlined" aria-hidden="true">group</span>
          <h2 id="dashEquipoTitle">Equipo en turno</h2>
          <a class="dash-widget-link" href="/app/turnos" data-app-route="/app/turnos">Ver turnos</a>
          <span class="dash-equipo-badge" id="dashEquipoBadge" aria-label="0 compañeros activos">0</span>
        </header>
        <div class="dash-widget-body" id="dashEquipoBody" aria-live="polite" aria-busy="true">
          ${_renderEquipoLoading()}
        </div>
      </article>
    </section>` : ''}

    <section class="dash-kpis" id="dashKpis" aria-label="Resumen operativo">
      ${_renderKpis(metrics, feats, role)}
    </section>

    ${showPatio ? `
    <section class="dash-ops-grid" aria-label="Operación de la plaza">
        <article class="dash-widget dash-patio-widget" aria-labelledby="dashPatioTitle">
          <header class="dash-widget-head">
            <span class="dash-widget-icon material-symbols-outlined" aria-hidden="true">directions_car</span>
            <h2 id="dashPatioTitle">Estado del patio</h2>
            <a class="dash-widget-link" href="/app/mapa" data-app-route="/app/mapa">Ver mapa</a>
          </header>
          <div class="dash-widget-body" id="dashCuadreBody">
            <div class="dash-skeleton dash-skeleton--rows" aria-hidden="true"><i></i><i></i><i></i></div>
          </div>
        </article>
    </section>` : ''}

    ${_renderPrefBar(feats, prefView)}

  </div>
</div>`;
}

function _renderTurnoLoading() {
  return `<div class="dash-turno-loading" aria-hidden="true">
    <div class="dash-skeleton dash-skeleton--shift"><i></i><i></i></div>
    <span class="dash-skeleton-action"></span>
  </div>`;
}

function _renderEquipoLoading() {
  return `<div class="dash-skeleton dash-skeleton--team" aria-hidden="true">
    <i></i><i></i><i></i>
  </div>`;
}

function _renderKpis(metrics, feats, role) {
  const kpis = [];
  kpis.push({ icon: 'directions_car', id: 'dashKpiUni', val: metrics.unidades, label: 'Unidades activas', alert: false });
  kpis.push({ icon: 'local_shipping',  id: 'dashKpiExt', val: metrics.externos, label: 'Externos', alert: false });
  if (feats.incidencias) kpis.push({ icon: 'warning', id: 'dashKpiInc', val: metrics.incidencias, label: 'Incidencias', alert: metrics.incidencias > 0 });
  if (feats.solicitudes && _isAdmin(role)) kpis.push({ icon: 'assignment_ind', id: 'dashKpiSol', val: metrics.solicitudes, label: 'Solicitudes', alert: metrics.solicitudes > 0 });
  return kpis.map(k => `
    <article class="dash-kpi${k.alert ? ' dash-kpi--alert' : ''}" aria-label="${esc(k.label)}: ${k.val}">
      <span class="dash-kpi-icon material-symbols-outlined" aria-hidden="true">${k.icon}</span>
      <div class="dash-kpi-copy">
        <strong class="dash-kpi-val" id="${k.id}">${k.val}</strong>
        <span class="dash-kpi-label">${k.label}</span>
      </div>
    </article>`).join('');
}

function _renderPrefBar(feats, prefView) {
  const opts = [
    { key: 'dashboard',        label: 'Dashboard', feat: true },
    { key: 'mapa',             label: 'Mapa',      feat: true },
    { key: 'incidencias',      label: 'Alertas',   feat: feats.incidencias },
  ].filter(o => o.feat);
  const current = prefView || 'dashboard';
  return `
  <section class="dash-pref-bar" aria-labelledby="dashPrefLabel">
    <span class="dash-pref-label" id="dashPrefLabel">Vista inicial</span>
    <div class="dash-pref-btns" id="dashPrefBtns" role="group" aria-label="Seleccionar vista inicial">
      ${opts.map(o => `
        <button class="dash-pref-btn${current === o.key ? ' dash-pref-btn--active' : ''}" type="button" data-pref="${esc(o.key)}" aria-pressed="${current === o.key ? 'true' : 'false'}">
          ${esc(o.label)}
        </button>`).join('')}
    </div>
    <span class="dash-pref-saved" id="dashPrefSaved" role="status" hidden>
      <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>
      Guardado
    </span>
  </section>`;
}

// ── Bind ─────────────────────────────────────────────────────
function _bindAll() {
  _ctr?.querySelector('#dashRefreshBtn')?.addEventListener('click', async () => {
    const btn = _ctr.querySelector('#dashRefreshBtn');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-loading');
    }
    _restartWidgets();
    await Promise.all([_loadMetrics(), _loadHorarioUsuario()]);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('is-loading');
    }
  });

  _ctr?.querySelector('#dashPrefBtns')?.addEventListener('click', e => {
    const btn = e.target.closest('.dash-pref-btn');
    if (!btn) return;
    const key = btn.dataset.pref;
    _savePrefView(key);
    _ctr.querySelectorAll('.dash-pref-btn').forEach(b => {
      const active = b.dataset.pref === key;
      b.classList.toggle('dash-pref-btn--active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    if (_s) _s.prefView = key;
    const saved = _ctr.querySelector('#dashPrefSaved');
    if (saved) {
      saved.hidden = false;
      setTimeout(() => { if (saved) saved.hidden = true; }, 2000);
    }
  });

  _ctr?.addEventListener('click', e => {
    const link = e.target.closest('[data-app-route]');
    if (!link || !_navigate) return;
    e.preventDefault();
    _navigate(link.dataset.appRoute);
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
  _ctr.querySelectorAll('.dash-kpi').forEach(card => {
    const value = card.querySelector('.dash-kpi-val')?.textContent?.trim() || '0';
    const label = card.querySelector('.dash-kpi-label')?.textContent?.trim() || '';
    card.setAttribute('aria-label', `${label}: ${value}`);
  });
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
  const uid   = _s.uid || '';
  const plaza = _s.plaza;
  if (!uid || !plaza) { _updateTurnoWidget(); return; }
  try {
    const semana = semanaInicio();
    let q = db.collection('horarios')
      .where('usuarioId', '==', uid)
      .where('plaza', '==', plaza)
      .where('semanaInicio', '==', semana);
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
  [_unsubCuadre, _unsubTurno, _unsubPlazaTurnos].forEach(fn => {
    if (typeof fn === 'function') try { fn(); } catch (_) {}
  });
  _unsubCuadre = _unsubTurno = _unsubPlazaTurnos = null;
  if (_turnoTimer) { clearInterval(_turnoTimer); _turnoTimer = null; }
}

function _restartWidgets() {
  if (!_s) return;
  _stopWidgets();
  _s.turnoActivo = null;
  _s.turnoStatus = 'loading';
  _s.turnoError = '';
  _s.turnosPlaza = [];
  _s.equipoStatus = 'loading';
  _updateTurnoWidget();
  _updateEquipoWidget();
  _startWidgets();
}

function _startWidgets() {
  if (!_s) return;
  const { plaza, feats, role, uid } = _s;
  const isAdmin = _isAdmin(role);

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

  // Mi turno
  if (uid) {
    try {
      _unsubTurno = db.collection(COL.TURNOS)
        .where('usuarioId', '==', uid).where('estado', '==', 'ACTIVO').limit(1)
        .onSnapshot(snap => {
          if (!_s) return;
          _s.turnoActivo = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
          _s.turnoStatus = _s.turnoActivo ? 'active' : 'inactive';
          _s.turnoError = '';
          _updateTurnoWidget();
          // Cronómetro vivo cuando hay turno activo
          if (_turnoTimer) clearInterval(_turnoTimer);
          if (_s.turnoActivo) {
            _turnoTimer = setInterval(() => { if (_s?.turnoActivo) _updateTurnoElapsed(); }, 30000);
          }
        }, err => {
          if (!_s) return;
          if (_s.turnoActivo) {
            _s.turnoStatus = 'active';
          } else {
            _s.turnoStatus = 'error';
            _s.turnoError = String(err?.message || 'No se pudo consultar el turno.');
          }
          _updateTurnoWidget();
        });
    } catch (err) {
      _s.turnoStatus = 'error';
      _s.turnoError = String(err?.message || 'No se pudo consultar el turno.');
      _updateTurnoWidget();
    }
  } else {
    _s.turnoStatus = 'error';
    _s.turnoError = 'No se pudo identificar la sesión actual.';
    _updateTurnoWidget();
  }

  // Equipo en turno (todos en la misma plaza)
  if (plaza) {
    try {
      _unsubPlazaTurnos = db.collection(COL.TURNOS)
        .where('plazaId', '==', plaza).where('estado', '==', 'ACTIVO').limit(30)
        .onSnapshot(snap => {
          if (!_s) return;
          _s.turnosPlaza = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(t => String(t.usuarioId || '') !== uid);
          _s.equipoStatus = 'ready';
          _updateEquipoWidget();
        }, () => {
          if (!_s) return;
          _s.turnosPlaza = [];
          _s.equipoStatus = 'error';
          _updateEquipoWidget();
        });
    } catch (_) {
      _s.turnosPlaza = [];
      _s.equipoStatus = 'error';
      _updateEquipoWidget();
    }
  } else {
    _s.turnosPlaza = [];
    _s.equipoStatus = 'ready';
    _updateEquipoWidget();
  }
}

// ── Turno widget ──────────────────────────────────────────────
function _updateTurnoWidget() {
  const el = _ctr?.querySelector('#dashTurnoBody');
  if (!el) return;
  const turno    = _s?.turnoActivo;
  const profile  = _s?.profile || {};
  const uid      = _s?.uid || '';
  const plaza    = _s?.plaza || '';
  const horario  = _s?.horarioHoy;
  const status   = _s?.turnoStatus || 'loading';

  el.setAttribute('aria-busy', String(status === 'loading'));

  if (status === 'loading') {
    _setTurnoStatus('Consultando', 'loading');
    el.innerHTML = _renderTurnoLoading();
    return;
  }

  if (status === 'error') {
    _setTurnoStatus('No disponible', 'error');
    el.innerHTML = `
      <div class="dash-turno-message dash-turno-message--error" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">sync_problem</span>
        <div>
          <strong>No pudimos confirmar tu turno</strong>
          <span>Revisa la conexión e inténtalo nuevamente.</span>
        </div>
      </div>
      <button type="button" class="dash-turno-btn dash-turno-btn--secondary" id="dashReintentarTurno">
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
        Reintentar
      </button>`;
    el.querySelector('#dashReintentarTurno')?.addEventListener('click', () => {
      _restartWidgets();
      void _loadHorarioUsuario();
    });
    return;
  }

  if (turno) {
    _setTurnoStatus('En curso', 'active');
    _renderTurnoActivo(el, turno, horario, plaza);
    return;
  }

  _setTurnoStatus('Sin iniciar', 'idle');
  const hint = _buildTurnoHint(horario);
  el.innerHTML = `
    ${hint ? `<div class="dash-turno-hint"><span class="material-symbols-outlined" aria-hidden="true">${hint.icon}</span><span>${esc(hint.text)}</span></div>` : ''}
    <div class="dash-turno-message">
      <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
      <div>
        <strong>Sin turno activo</strong>
        <span>Tu jornada todavía no ha comenzado.</span>
      </div>
    </div>
    ${horario && horario.tipo !== 'DESCANSO' ? `
    <div class="dash-turno-schedule">
      <div class="dash-turno-sch-row">
        <span>Entrada</span>
        <strong>${esc(horario.inicio || '—')}</strong>
      </div>
      <div class="dash-turno-sch-row">
        <span>Salida</span>
        <strong>${esc(horario.fin || '—')}</strong>
      </div>
    </div>` : ''}
    <button type="button" class="dash-turno-btn dash-turno-btn--start" id="dashIniciarTurno" ${(!uid || !plaza) ? 'disabled' : ''}>
      <span class="material-symbols-outlined" aria-hidden="true">play_circle</span>
      Iniciar turno
    </button>`;

  el.querySelector('#dashIniciarTurno')?.addEventListener('click', async () => {
    const btn = el.querySelector('#dashIniciarTurno');
    if (btn) btn.disabled = true;
    try {
      await iniciarTurno({ ...profile, uid }, plaza);
    } catch (e) {
      if (e?.code === 'GATE_CANCELLED') {
        if (_s && btn) btn.disabled = false;
        return;
      }
      console.warn('[dashboard] iniciarTurno:', e);
      if (typeof window.mexAlert === 'function') {
        void window.mexAlert(e?.message || 'No se pudo iniciar el turno.', 'Error');
      }
      if (_s && btn) btn.disabled = false;
    }
  });
}

function _setTurnoStatus(text, tone) {
  const badge = _ctr?.querySelector('#dashTurnoStatus');
  if (!badge) return;
  badge.textContent = text;
  badge.className = `dash-status dash-status--${tone}`;
}

function _renderTurnoActivo(el, turno, horario, plaza) {
  const inicio  = turno.inicio?.toDate?.() || new Date(turno.inicio || Date.now());
  const ms      = Date.now() - inicio.getTime();
  const h       = Math.floor(ms / 3600000);
  const m       = Math.floor((ms % 3600000) / 60000);
  const elapsed = h > 0 ? `${h} h ${m} min` : `${m} min`;
  const since   = inicio.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const fin     = horario?.fin;

  let restanteHtml = '';
  if (fin) {
    const [fh, fm] = fin.split(':').map(Number);
    const finMs = new Date().setHours(fh, fm, 0, 0);
    const restMs = finMs - Date.now();
    if (restMs > 0) {
      const rh = Math.floor(restMs / 3600000);
      const rm = Math.floor((restMs % 3600000) / 60000);
      const restStr = rh > 0 ? `${rh}h ${rm}m restantes` : `${rm} min restantes`;
      restanteHtml = `<span class="dash-turno-rest"><span class="material-symbols-outlined" aria-hidden="true">hourglass_bottom</span>${esc(restStr)}</span>`;
    }
  }

  el.innerHTML = `
    <div class="dash-turno-active">
      <div class="dash-turno-active-info">
        <span class="dash-turno-caption">Tiempo en turno</span>
        <strong class="dash-turno-elapsed" id="dashTurnoElapsed">${esc(elapsed)}</strong>
        <div class="dash-turno-meta">
          <span><span class="material-symbols-outlined" aria-hidden="true">login</span>Inicio ${esc(since)}</span>
          ${fin ? `<span><span class="material-symbols-outlined" aria-hidden="true">logout</span>Salida ${esc(fin)}</span>` : ''}
        </div>
      </div>
      ${restanteHtml}
    </div>
    <button type="button" class="dash-turno-btn dash-turno-btn--end" id="dashCerrarTurno">
      <span class="material-symbols-outlined" aria-hidden="true">stop_circle</span>
      Terminar turno
    </button>`;

  el.querySelector('#dashCerrarTurno')?.addEventListener('click', async () => {
    const btn = el.querySelector('#dashCerrarTurno');
    if (btn) btn.disabled = true;
    try {
      await cerrarTurno(turno.id, { user: _s?.profile, plaza });
    } catch (e) {
      if (e?.code === 'GATE_CANCELLED') {
        if (_s && btn) btn.disabled = false;
        return;
      }
      console.warn('[dashboard] cerrarTurno:', e);
      if (typeof window.mexAlert === 'function') {
        void window.mexAlert(e?.message || 'No se pudo cerrar el turno.', 'Error');
      }
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
  el.textContent = h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function _buildTurnoHint(horario) {
  if (!horario) return null;
  if (horario.tipo === 'DESCANSO')    return { icon: 'bedtime', text: 'Hoy es tu día de descanso' };
  if (horario.tipo === 'VACACIONES')  return { icon: 'beach_access', text: 'Estás de vacaciones' };
  if (horario.tipo === 'FESTIVO')     return { icon: 'celebration', text: 'Día festivo' };
  if (!horario.inicio) return null;

  const [sh, sm] = horario.inicio.split(':').map(Number);
  const now = new Date();
  const start = new Date();
  start.setHours(sh, sm, 0, 0);
  const diffMin = Math.round((start - now) / 60000);

  if (diffMin > 0 && diffMin <= 15)  return { icon: 'bolt', text: `Tu turno inicia en ${diffMin} minutos — ¡prepárate!` };
  if (diffMin > 15 && diffMin <= 60) return { icon: 'schedule', text: `Tu turno inicia en ${diffMin} minutos (a las ${horario.inicio})` };
  if (diffMin > 60 && diffMin <= 240)return { icon: 'calendar_today', text: `Tu turno empieza hoy a las ${horario.inicio}` };
  if (diffMin < 0 && diffMin > -30)  return { icon: 'warning', text: `Tu turno empezó hace ${Math.abs(diffMin)} min — ¿olvidaste marcarlo?` };
  return null;
}

// ── Equipo en turno ───────────────────────────────────────────
function _updateEquipoWidget() {
  const widget = _ctr?.querySelector('#dashEquipoWidget');
  const el     = _ctr?.querySelector('#dashEquipoBody');
  const badge  = _ctr?.querySelector('#dashEquipoBadge');
  if (!widget || !el) return;
  const turnos = _s?.turnosPlaza || [];
  const status = _s?.equipoStatus || 'loading';

  if (badge) {
    badge.textContent = String(turnos.length);
    badge.setAttribute('aria-label', turnos.length === 1 ? '1 compañero activo' : `${turnos.length} compañeros activos`);
  }
  el.setAttribute('aria-busy', String(status === 'loading'));

  if (status === 'loading') {
    el.innerHTML = _renderEquipoLoading();
    return;
  }

  if (status === 'error') {
    el.innerHTML = `<div class="dash-widget-state dash-widget-state--error" role="status">
      <span class="material-symbols-outlined" aria-hidden="true">cloud_off</span>
      <span>No se pudo cargar el equipo.</span>
    </div>`;
    return;
  }

  if (!turnos.length) {
    el.innerHTML = `<div class="dash-widget-state">
      <span class="material-symbols-outlined" aria-hidden="true">person_off</span>
      <span>No hay compañeros activos en esta plaza.</span>
    </div>`;
    return;
  }

  el.innerHTML = `<ul class="dash-equipo-list">${turnos.map(t => {
    const rawName = String(t.usuarioNombre || t.nombre || 'Usuario').trim();
    const nombre = esc(rawName.split(/\s+/).slice(0, 2).join(' '));
    const ini = t.inicio?.toDate?.() || new Date(t.inicio || Date.now());
    const ms  = Date.now() - ini.getTime();
    const h   = Math.floor(ms / 3600000);
    const m   = Math.floor((ms % 3600000) / 60000);
    const dur = h > 0 ? `${h} h ${m} min` : `${m} min`;
    const initial = rawName.charAt(0).toUpperCase() || '?';
    return `<li class="dash-equipo-row">
      <div class="dash-equipo-avatar">${esc(initial)}</div>
      <div class="dash-equipo-info">
        <div class="dash-equipo-name">${nombre}</div>
        <div class="dash-equipo-dur">${esc(dur)} en turno</div>
      </div>
      <span class="dash-equipo-dot" title="En turno" aria-label="En turno"></span>
    </li>`;
  }).join('')}</ul>`;
}

// ── Cuadre widget ──────────────────────────────────────────────
function _updateCuadreWidget() {
  const el = _ctr?.querySelector('#dashCuadreBody');
  if (!el) return;
  if (!_s?.plaza) { el.innerHTML = '<div class="dash-widget-state"><span class="material-symbols-outlined" aria-hidden="true">location_off</span><span>Selecciona una plaza.</span></div>'; return; }
  const s = _s.cuadreStats;
  const total = s.listo + s.sucio + s.manto + s.otros;
  const avail = total > 0 ? Math.round((s.listo / total) * 100) : 0;
  el.innerHTML = `
    <div class="dash-cs-stats">
      <div class="dash-cs-stat"><span class="dash-cs-dot dash-cs-dot--ready"></span><span class="dash-cs-label">Listo</span><strong class="dash-cs-val">${s.listo}</strong></div>
      <div class="dash-cs-stat"><span class="dash-cs-dot dash-cs-dot--prep"></span><span class="dash-cs-label">Sucio / En prep</span><strong class="dash-cs-val">${s.sucio}</strong></div>
      <div class="dash-cs-stat"><span class="dash-cs-dot dash-cs-dot--manto"></span><span class="dash-cs-label">Manto / Retenida</span><strong class="dash-cs-val">${s.manto}</strong></div>
    </div>
    <div class="dash-cs-bar" aria-label="Distribución del estado del patio">
      <i class="dash-cs-segment dash-cs-segment--ready" style="width:${s.listo / Math.max(total, 1) * 100}%"></i>
      <i class="dash-cs-segment dash-cs-segment--prep" style="width:${s.sucio / Math.max(total, 1) * 100}%"></i>
      <i class="dash-cs-segment dash-cs-segment--manto" style="width:${s.manto / Math.max(total, 1) * 100}%"></i>
    </div>
    <div class="dash-cs-avail">Disponibilidad: <strong>${avail}%</strong></div>`;
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
