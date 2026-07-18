// ═══════════════════════════════════════════════════════════
//  /js/app/views/turnos.js — Turnos & Horarios
//  Roles bajos (AUXILIAR, VENTAS): ver activos + su propio horario.
//  Roles admin (SUPERVISOR+): gestionar horarios, asistencia e historial.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { onTurnosActivos } from '/js/app/features/turnos/turnos-data.js';
import { iniciarTurno, cerrarTurno } from '/js/app/features/turnos/turnos-mutations.js';
import {
  DIAS, DIA_NOMBRE, TIPOS_DIA, ESTADOS_ASISTENCIA,
  semanaInicio, moverSemana, fechaDia, hoy,
  onHorariosSemanales, guardarHorarioCelda, copiarSemanaAnterior,
  onAsistencia, registrarAsistencia, confirmarAsistencia,
  getHistorialTurnos, getUsuariosPlaza,
  onPlantillas, guardarPlantilla, eliminarPlantilla,
  onNotasSemana, guardarNotaSemana,
} from '/js/app/features/turnos/horarios-data.js';
import {
  isTurnosAdmin,
  LISTENER_ERROR,
  nombreUsuario,
  initialUsuario,
  escHtml as esc,
  formatElapsed,
  formatDuration,
  turnoInicioDate,
  turnoFinDate,
  resolveUsuariosLista,
  normalizeUsuarioUid,
  indexErrorBannerHtml,
  usuariosPlazaEmptyMessage,
  esSemanaPasada,
  matchPlantilla,
  totalMinutosSemana,
  minutosEntre,
} from '/js/app/features/turnos/turnos-view-model.js';
import { colorDeTurno, contraste } from '/js/app/features/turnos/turno-color.js';

function _toast(msg, title = 'Turnos') {
  if (typeof window.mexAlert === 'function') {
    void window.mexAlert(msg, title);
  } else {
    console.warn(`[turnos] ${title}: ${msg}`);
  }
}

function _toastTurnoError(e, action) {
  if (e?.code === 'INDEX_MISSING') {
    _toast('Índice de Firestore pendiente. Contacta al administrador o despliega firestore:indexes.', 'Índice requerido');
    return;
  }
  _toast(e?.message || `No se pudo ${action}.`, 'Error');
}

function _isoHaceDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(0, Number(n) || 0));
  return d.toISOString().slice(0, 10);
}

function _fmtHistRange(desde, hasta) {
  const fmt = (s) => {
    const d = new Date(`${s}T12:00:00`);
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  };
  return `${fmt(desde)} – ${fmt(hasta)}`;
}

function _historialResumen(turnos) {
  let totalMs = 0;
  for (const t of turnos || []) {
    const inicio = turnoInicioDate(t);
    const fin = turnoFinDate(t);
    const ms = fin.getTime() - inicio.getTime();
    if (ms > 0) totalMs += ms;
  }
  return {
    count: (turnos || []).length,
    horas: totalMs > 0 ? formatDuration(totalMs) : '0m'
  };
}

function _usuarioHistorial(uid) {
  const id = String(uid || '').trim();
  if (!id) return null;
  const lista = resolveUsuariosLista(_s?.usuarios || [], {
    isAdmin: Boolean(_s?.isAdmin),
    uid: _s?.uid,
    profile: _s?.profile
  });
  return lista.find(u => normalizeUsuarioUid(u) === id) || null;
}

function _renderHistorialTurnoRow(t) {
  const inicio = turnoInicioDate(t);
  const fin = turnoFinDate(t);
  const ms = fin.getTime() - inicio.getTime();
  const dur = ms > 0 ? formatDuration(ms) : '—';
  const fechaStr = inicio.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  const inicioStr = inicio.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const finStr = fin.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  return `<tr class="tu-hist-row">
    <td class="tu-td-main">${fechaStr}</td>
    <td>${inicioStr}</td>
    <td>${finStr}</td>
    <td><strong>${dur}</strong></td>
    <td class="tu-hist-plaza">${esc(t.plazaId || '—')}</td>
  </tr>`;
}

function _renderHistorialTabla(turnos) {
  const filas = (turnos || []).map(_renderHistorialTurnoRow).join('');
  return `
  <div class="tu-table-wrap">
    <table class="tu-table">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Entrada</th>
          <th>Salida</th>
          <th>Duración</th>
          <th>Plaza</th>
        </tr>
      </thead>
      <tbody>${filas || '<tr><td colspan="5" class="tu-grid-empty">Sin turnos en este rango.</td></tr>'}</tbody>
    </table>
  </div>`;
}

function _renderHistorialFiltros() {
  const { isAdmin, usuarios, usuariosLoading, historialDesde, historialHasta, historialUsuarioId } = _s;
  const lista = resolveUsuariosLista(usuarios || [], {
    isAdmin: Boolean(isAdmin),
    uid: _s.uid,
    profile: _s.profile
  });
  const opts = lista.map(u => {
    const uid = normalizeUsuarioUid(u);
    return `<option value="${esc(uid)}"${uid === historialUsuarioId ? ' selected' : ''}>${esc(nombreUsuario(u))}</option>`;
  }).join('');

  return `
  <details class="tu-hist-filters" id="tuHistFilters" open>
    <summary class="tu-hist-filters__summary">
      <span class="material-symbols-outlined">filter_list</span>
      Filtros
    </summary>
    <div class="tu-hist-filters__grid">
      ${isAdmin ? `
      <div class="tu-field-group tu-field-group--full">
        <label class="tu-label" for="tuHistUsuario">Colaborador <span class="tu-req">*</span></label>
        <select class="tu-input" id="tuHistUsuario"${usuariosLoading ? ' disabled' : ''}>
          <option value="">Selecciona colaborador…</option>
          ${opts}
        </select>
      </div>` : ''}
      <div class="tu-field-group">
        <label class="tu-label" for="tuHistDesde">Fecha inicio</label>
        <input class="tu-input" type="date" id="tuHistDesde" value="${esc(historialDesde)}" max="${esc(historialHasta || hoy())}">
      </div>
      <div class="tu-field-group">
        <label class="tu-label" for="tuHistHasta">Fecha final</label>
        <input class="tu-input" type="date" id="tuHistHasta" value="${esc(historialHasta)}" max="${esc(hoy())}">
      </div>
    </div>
    <div class="tu-hist-filters__actions">
      <button class="tu-btn tu-btn--ghost" id="tuHistSemana" type="button">Semana</button>
      <button class="tu-btn tu-btn--primary" id="tuHistVer" type="button">Ver historial</button>
    </div>
  </details>`;
}

function _renderHistorialSubject(usuario, resumen) {
  const nombre = usuario ? nombreUsuario(usuario) : String(_s?.profile?.nombreCompleto || _s?.profile?.nombre || 'Colaborador');
  const rol = usuario?.rol || usuario?.role || _s?.profile?.rol || '';
  const plaza = _s?.plaza || '';
  return `
  <div class="tu-hist-subj">
    <span class="tu-hist-subj__avatar">${esc(initialUsuario(usuario || _s?.profile || {}))}</span>
    <div class="tu-hist-subj__info">
      <h3 class="tu-hist-subj__name">${esc(nombre)}</h3>
      <span class="tu-hist-subj__meta">${esc([rol, plaza].filter(Boolean).join(' · '))}</span>
    </div>
    <span class="tu-hist-subj__range">${esc(_fmtHistRange(_s.historialDesde, _s.historialHasta))}</span>
    <div class="tu-hist-stats">
      <div class="tu-hist-stat">
        <span class="tu-hist-stat__val">${resumen.count}</span>
        <span class="tu-hist-stat__lbl">Turnos</span>
      </div>
      <div class="tu-hist-stat">
        <span class="tu-hist-stat__val">${esc(resumen.horas)}</span>
        <span class="tu-hist-stat__lbl">Horas</span>
      </div>
    </div>
  </div>`;
}

// ── Estado del módulo ─────────────────────────────────────────
let _ctr     = null;
let _s       = null;
let _offs    = [];
let _unsubTA = null;
let _unsubH  = null;
let _unsubAs = null;
let _unsubP  = null;
let _unsubNS = null;
let _ticker  = null;

// ── Lifecycle ─────────────────────────────────────────────────
export async function mount({ container }) {
  unmount();
  _ctr = container;
  _ensureCss();

  const gs      = getState();
  const role    = String(gs.role || 'AUXILIAR').toUpperCase();
  const plaza   = String(getCurrentPlaza() || gs.profile?.plazaAsignada || '').toUpperCase().trim();
  const profile = gs.profile || {};
  const uid     = window._auth?.currentUser?.uid || profile.uid || profile.id || '';

  _s = {
    role, plaza, profile, uid,
    isAdmin: isTurnosAdmin(role),
    tab: 'activos',
    turnosActivos: [],
    miTurno: null,
    horarios: [],
    semana: semanaInicio(),
    usuarios: [],
    usuariosLoadError: null,
    listenerErrors: {},
    asistencia: [],
    asistenciaFecha: hoy(),
    historial: [],
    historialCargado: false,
    historialLoading: false,
    historialMostrado: false,
    historialUsuarioId: '',
    historialDesde: _isoHaceDias(30),
    historialHasta: hoy(),
    usuariosLoading: false,
    editDia: null,
    plantillas: [],
    notasSemana: {},
    showGestionPlantillas: false,
  };

  _render();
  _startListeners();
  void _loadUsuarios();

  _offs.push(onPlazaChange(next => {
    if (!_s) return;
    _s.plaza = String(next || '').toUpperCase().trim();
    _stopListeners();
    _render();
    _startListeners();
    void _loadUsuarios();
  }));
}

export function unmount() {
  _offs.forEach(fn => { try { fn(); } catch (_) {} });
  _offs = [];
  _stopListeners();
  if (_ticker) { clearInterval(_ticker); _ticker = null; }
  _ctr = null;
  _s   = null;
}

// ── CSS ───────────────────────────────────────────────────────
function _ensureCss() {
  if (document.querySelector('link[data-turnos-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = '/css/app-turnos.css';
  l.dataset.turnosCss = '1';
  document.head.appendChild(l);
}

// ── Listeners ─────────────────────────────────────────────────
function _stopListeners() {
  [_unsubTA, _unsubH, _unsubAs, _unsubP, _unsubNS].forEach(fn => { if (fn) try { fn(); } catch (_) {} });
  _unsubTA = _unsubH = _unsubAs = _unsubP = _unsubNS = null;
  if (_ticker) { clearInterval(_ticker); _ticker = null; }
}

function _startListeners() {
  if (!_s?.plaza) return;
  const { plaza, semana, asistenciaFecha } = _s;

  // Turnos activos (todas las tabs los necesitan)
  _unsubTA = onTurnosActivos(plaza, list => {
    if (!_s) return;
    _s.turnosActivos = list;
    _s.miTurno = list.find(t => t.usuarioId === _s.uid) || null;
    _repaintTab();
  });

  // Horarios de la semana seleccionada
  _unsubH = onHorariosSemanales(plaza, semana, (list, err) => {
    if (!_s) return;
    _s.horarios = list;
    if (err) _s.listenerErrors.horarios = err;
    else delete _s.listenerErrors.horarios;
    _repaintTab();
  });

  // Asistencia del día seleccionado
  _unsubAs = onAsistencia(plaza, asistenciaFecha, asistenciaFecha, (list, err) => {
    if (!_s) return;
    _s.asistencia = list;
    if (err) _s.listenerErrors.asistencia = err;
    else delete _s.listenerErrors.asistencia;
    _repaintTab();
  });

  // Plantillas predefinidas (global, no depende de plaza)
  if (!_unsubP) {
    _unsubP = onPlantillas(list => {
      if (!_s) return;
      _s.plantillas = list;
      if (_s.tab === 'horarios') _repaintTab();
    });
  }

  // Notas generales de semana
  if (_unsubNS) { try { _unsubNS(); } catch (_) {} }
  _unsubNS = onNotasSemana(plaza, _s.semana, notas => {
    if (!_s) return;
    _s.notasSemana = notas || {};
    if (_s.tab === 'horarios') _repaintTab();
  });

  // Ticker para actualizar el tiempo transcurrido
  _ticker = setInterval(() => {
    if (!_s) return;
    _s.turnosActivos = [...(_s.turnosActivos || [])]; // fuerza re-render del tiempo
    _repaintTab();
  }, 60000);
}

function _restartListenerHorarios() {
  if (_unsubH)  { try { _unsubH(); }  catch (_) {} _unsubH  = null; }
  if (_unsubNS) { try { _unsubNS(); } catch (_) {} _unsubNS = null; }
  if (!_s?.plaza) return;
  _unsubH = onHorariosSemanales(_s.plaza, _s.semana, (list, err) => {
    if (!_s) return;
    _s.horarios = list;
    if (err) _s.listenerErrors.horarios = err;
    else delete _s.listenerErrors.horarios;
    _repaintTab();
  });
  _unsubNS = onNotasSemana(_s.plaza, _s.semana, notas => {
    if (!_s) return;
    _s.notasSemana = notas || {};
    if (_s.tab === 'horarios') _repaintTab();
  });
}

function _restartListenerAsistencia() {
  if (_unsubAs) { try { _unsubAs(); } catch (_) {} _unsubAs = null; }
  if (!_s?.plaza) return;
  const fecha = _s.asistenciaFecha;
  _unsubAs = onAsistencia(_s.plaza, fecha, fecha, (list, err) => {
    if (!_s) return;
    _s.asistencia = list;
    if (err) _s.listenerErrors.asistencia = err;
    else delete _s.listenerErrors.asistencia;
    _repaintTab();
  });
}

// ── Usuarios ──────────────────────────────────────────────────
async function _loadUsuarios() {
  if (!_s?.plaza) return;
  _s.usuariosLoading = true;
  _s.usuariosLoadError = null;
  try {
    _s.usuarios = await getUsuariosPlaza(_s.plaza);
  } catch (e) {
    _s.usuarios = [];
    _s.usuariosLoadError = e?.code === 'INDEX_MISSING'
      ? { code: LISTENER_ERROR.INDEX_MISSING, source: 'usuarios' }
      : { code: LISTENER_ERROR.OTHER, source: 'usuarios', message: e?.message };
    if (e?.code === 'INDEX_MISSING') {
      _s.listenerErrors.usuarios = _s.usuariosLoadError;
    }
  }
  _s.usuariosLoading = false;
  if (_s?.tab === 'horarios' || _s?.tab === 'asistencia') _repaintTab();
}

// ── Render principal ──────────────────────────────────────────
function _render() {
  if (!_ctr || !_s) return;
  const { isAdmin, plaza } = _s;

  const tabs = [
    { key: 'activos',    label: 'Turnos activos',   icon: 'badge' },
    { key: 'horarios',   label: 'Horarios',          icon: 'calendar_month' },
    ...(isAdmin ? [
      { key: 'asistencia', label: 'Asistencia',     icon: 'fact_check' },
      { key: 'historial',  label: 'Historial',       icon: 'history' },
    ] : [
      { key: 'historial',  label: 'Mi historial',   icon: 'history' },
    ]),
  ];

  _ctr.innerHTML = `
<div class="tu">
  <div class="tu-header">
    <div class="tu-title-row">
      <h1 class="tu-title">
        <span class="material-symbols-outlined">schedule</span>
        Turnos y Horarios
      </h1>
      ${plaza ? `<span class="tu-plaza-badge">${esc(plaza)}</span>` : ''}
    </div>
    <nav class="tu-tabs" id="tuTabs">
      ${tabs.map(t => `
        <button class="tu-tab${_s.tab === t.key ? ' tu-tab--active' : ''}"
                type="button" data-tab="${t.key}">
          <span class="material-symbols-outlined">${t.icon}</span>
          ${t.label}
        </button>`).join('')}
    </nav>
  </div>
  <div class="tu-body" id="tuBody">
    ${!plaza ? _renderNoPlaza() : indexErrorBannerHtml(_s.listenerErrors) + _renderTabContent()}
  </div>
</div>`;

  _bindTabs();
}

function _renderNoPlaza() {
  return `<div class="tu-empty-state">
    <span class="material-symbols-outlined">location_off</span>
    <p>Selecciona una plaza para ver los turnos y horarios.</p>
  </div>`;
}

function _repaintTab() {
  const body = _ctr?.querySelector('#tuBody');
  if (!body || !_s) return;
  body.innerHTML = !_s.plaza
    ? _renderNoPlaza()
    : indexErrorBannerHtml(_s.listenerErrors) + _renderTabContent();
  _bindTabBody();
}

function _renderTabContent() {
  switch (_s.tab) {
    case 'activos':    return _renderActivos();
    case 'horarios':   return _renderHorarios();
    case 'asistencia': return _renderAsistencia();
    case 'historial':  return _renderHistorial();
    default:           return '';
  }
}

// ── Tab Activos ───────────────────────────────────────────────
function _renderActivos() {
  const { turnosActivos, miTurno, uid, isAdmin, plaza, profile } = _s;

  const myCard = `
<div class="tu-section">
  <div class="tu-section-title">Mi turno</div>
  ${miTurno ? _renderTurnoCard(miTurno, true) : `
  <div class="tu-mi-turno-empty">
    <p>Sin turno activo.</p>
    <button class="tu-btn tu-btn--green" id="tuBtnIniciar"
            ${(!uid || !plaza) ? 'disabled' : ''} type="button">
      <span class="material-symbols-outlined">play_circle</span>
      Iniciar turno
    </button>
  </div>`}
</div>`;

  let otrosTurnos = '';
  if (isAdmin) {
    const otros = turnosActivos.filter(t => t.usuarioId !== uid);
    otrosTurnos = `
<div class="tu-section">
  <div class="tu-section-title">Personal en turno <span class="tu-count">${turnosActivos.length}</span></div>
  ${turnosActivos.length === 0
    ? '<p class="tu-empty">Nadie ha iniciado turno en esta plaza.</p>'
    : `<div class="tu-cards-grid">
        ${turnosActivos.map(t => _renderTurnoCard(t, t.usuarioId === uid)).join('')}
       </div>`}
</div>`;
  }

  return myCard + otrosTurnos;
}

function _renderTurnoCard(turno, esPropio) {
  const inicio = turnoInicioDate(turno);
  const elapsed = formatElapsed(Date.now() - inicio.getTime());
  const since   = inicio.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const nombre  = esc(turno.usuarioNombre || 'Usuario');

  return `
<div class="tu-card tu-card--turno${esPropio ? ' tu-card--own' : ''}">
  <div class="tu-card-head">
    <span class="tu-card-avatar">${nombre.charAt(0).toUpperCase()}</span>
    <div class="tu-card-info">
      <div class="tu-card-name">${nombre}</div>
      <div class="tu-card-rol">${esc(turno.usuarioRol || '')}</div>
    </div>
    <div class="tu-turno-badge">
      <span class="tu-turno-dot"></span>
      En turno
    </div>
  </div>
  <div class="tu-card-footer">
    <span class="tu-card-time">
      <span class="material-symbols-outlined">schedule</span>
      ${elapsed} · Desde las ${since}
    </span>
    ${esPropio ? `
    <button class="tu-btn tu-btn--red tu-btn--sm" data-cerrar="${esc(turno.id)}" type="button">
      <span class="material-symbols-outlined">stop_circle</span>
      Cerrar
    </button>` : ''}
  </div>
  ${_renderTurnoMeta(turno)}
</div>`;
}

function _renderTurnoMeta(turno) {
  const bits = [];
  if (turno.faceVerified === true) {
    bits.push('<span class="tu-meta-chip tu-meta-chip--ok"><span class="material-symbols-outlined">verified_user</span> Rostro</span>');
  } else if (turno.faceVerified === false) {
    bits.push('<span class="tu-meta-chip"><span class="material-symbols-outlined">face</span> Sin rostro</span>');
  }
  if (turno.geoWarn) {
    bits.push('<span class="tu-meta-chip tu-meta-chip--warn"><span class="material-symbols-outlined">location_off</span> Lejos</span>');
  } else if (Number.isFinite(turno.lat) && Number.isFinite(turno.lon)) {
    bits.push('<span class="tu-meta-chip"><span class="material-symbols-outlined">location_on</span> Ubicación</span>');
  }
  if (!bits.length) return '';
  return `<div class="tu-card-meta">${bits.join('')}</div>`;
}

// ── Tab Horarios (paridad ChecadorGLOBAL: selects coloreados) ─
function _cellSelectValue(cell, plantillas) {
  if (!cell) return '';
  if (cell.tipo && cell.tipo !== 'NORMAL') return `tipo:${cell.tipo}`;
  const p = matchPlantilla(cell, plantillas);
  if (p) return `p:${p.id}`;
  if (cell.tipo === 'NORMAL' && cell.inicio && cell.fin) {
    return `custom:${cell.inicio}-${cell.fin}`;
  }
  return '';
}

function _cellStyle(cell, plantillas) {
  if (!cell) return '';
  if (cell.tipo && cell.tipo !== 'NORMAL') {
    const bg = TIPOS_DIA[cell.tipo]?.color || '#94a3b8';
    return `background:${bg};color:${contraste(bg)}`;
  }
  const p = matchPlantilla(cell, plantillas);
  if (p || cell.tipo === 'NORMAL') {
    const bg = colorDeTurno(p || { id: `${cell.inicio}-${cell.fin}`, color: cell.color });
    return `background:${bg};color:${contraste(bg)}`;
  }
  return '';
}

function _renderCellSelect(u, diaKey, cell, plantillas, editable) {
  const realUid = normalizeUsuarioUid(u);
  const val = _cellSelectValue(cell, plantillas);
  const sty = _cellStyle(cell, plantillas);
  if (!editable) {
    if (!cell) return '<span class="tu-cell-empty">—</span>';
    if (cell.tipo === 'NORMAL') {
      const p = matchPlantilla(cell, plantillas);
      const label = p ? p.nombre : `${cell.inicio}–${cell.fin}`;
      return `<div class="tu-cell-horario" style="${sty}">${esc(label)}<small>${esc(cell.inicio)}–${esc(cell.fin)}</small></div>`;
    }
    return `<div class="tu-cell-tipo" style="${sty}">${esc(TIPOS_DIA[cell.tipo]?.label || cell.tipo)}</div>`;
  }

  const tipoOpts = Object.entries(TIPOS_DIA)
    .filter(([k]) => k !== 'NORMAL')
    .map(([k, v]) => `<option value="tipo:${k}"${val === `tipo:${k}` ? ' selected' : ''}>${esc(v.label)}</option>`)
    .join('');
  const plantOpts = plantillas.map((p) => {
    const v = `p:${p.id}`;
    return `<option value="${esc(v)}"${val === v ? ' selected' : ''}>${esc(p.nombre)} (${esc(p.inicio)}–${esc(p.fin)})</option>`;
  }).join('');
  let customOpt = '';
  if (val.startsWith('custom:')) {
    customOpt = `<option value="${esc(val)}" selected>Custom ${esc(cell.inicio)}–${esc(cell.fin)}</option>`;
  }

  return `<div class="tu-cell-sel-wrap">
  <select class="tu-grid-sel"
      data-edit-uid="${esc(realUid)}"
      data-edit-nombre="${esc(nombreUsuario(u))}"
      data-edit-rol="${esc(u.rol || u.role || '')}"
      data-edit-dia="${diaKey}"
      style="${sty}"
      title="Asignar turno">
    <option value="">—</option>
    ${plantOpts}
    ${tipoOpts}
    ${customOpt}
  </select>
  <button type="button" class="tu-cell-edit-btn"
      data-edit-uid="${esc(realUid)}"
      data-edit-nombre="${esc(nombreUsuario(u))}"
      data-edit-rol="${esc(u.rol || u.role || '')}"
      data-edit-dia="${diaKey}"
      title="Editar detalle">
    <span class="material-symbols-outlined">edit</span>
  </button>
  </div>`;
}

function _renderHorarios() {
  const { semana, horarios, usuarios, isAdmin, usuariosLoading, uid, plantillas, notasSemana, showGestionPlantillas, profile } = _s;

  const semanaEditable = isAdmin && !esSemanaPasada(semana);

  const semanaFin = moverSemana(semana, 1);
  const semanaFinDisplay = new Date(semanaFin + 'T00:00:00');
  semanaFinDisplay.setDate(semanaFinDisplay.getDate() - 1);

  const fmtSemana = (s) => {
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  };

  const totalMin = totalMinutosSemana(horarios);
  const totalHoras = (totalMin / 60).toFixed(1);

  // Encabezado de columnas con notas generales
  const diasHeaders = DIAS.map(d => {
    const fecha = fechaDia(semana, d);
    const dObj  = new Date(fecha + 'T00:00:00');
    const esHoy = fecha === hoy();
    const notaGen = notasSemana[d] || '';
    return `<th class="tu-grid-th${esHoy ? ' tu-grid-th--today' : ''}">
      <div class="tu-grid-dia">${DIA_NOMBRE[d].slice(0, 3)}</div>
      <div class="tu-grid-fecha${esHoy ? ' tu-grid-fecha--today' : ''}">
        ${dObj.getDate()}
      </div>
      ${notaGen
        ? `<button type="button" class="tu-grid-nota-gen" title="${esc(notaGen)}" ${semanaEditable ? `data-nota-dia="${d}" data-nota-val="${esc(notaGen)}"` : 'disabled'}>
            <span class="material-symbols-outlined">sticky_note_2</span>
          </button>`
        : (semanaEditable ? `<button class="tu-grid-nota-add" data-nota-dia="${d}" title="Agregar nota general" type="button"><span class="material-symbols-outlined">add</span></button>` : '')
      }
    </th>`;
  }).join('');

  // Filas de usuarios
  let filas = '';
  if (usuariosLoading) {
    filas = `<tr><td colspan="8" class="tu-grid-loading">Cargando usuarios…</td></tr>`;
  } else {
    const lista = resolveUsuariosLista(usuarios, { isAdmin, uid, profile });
    const emptyMsg = usuariosPlazaEmptyMessage({
      usuariosLoading: false,
      hasIndexError: !!(_s.listenerErrors?.usuarios || _s.usuariosLoadError?.code === LISTENER_ERROR.INDEX_MISSING),
      hasUsuarios: lista.length > 0,
    });
    if (emptyMsg) {
      filas = `<tr><td colspan="8" class="tu-grid-empty">${esc(emptyMsg)}</td></tr>`;
    } else {
      for (const u of lista) {
        const realUid = normalizeUsuarioUid(u);
        const horario = horarios.find(h => h.usuarioId === realUid);
        const esYo    = realUid === uid;
        filas += `<tr class="tu-grid-row${esYo ? ' tu-grid-row--own' : ''}">
          <td class="tu-grid-td-name">
            <span class="tu-grid-avatar">${initialUsuario(u)}</span>
            <span class="tu-grid-uname">${esc(nombreUsuario(u))}</span>
          </td>
          ${DIAS.map(d => {
            const cell  = horario?.dias?.[d];
            const fecha = fechaDia(semana, d);
            const esHoy = fecha === hoy();
            return `<td class="tu-grid-td tu-grid-td--sel${esHoy ? ' tu-grid-td--today' : ''}${semanaEditable ? ' tu-grid-td--editable' : ''}">
              ${_renderCellSelect(u, d, cell, plantillas, semanaEditable)}
            </td>`;
          }).join('')}
        </tr>`;
      }
    }
  }

  // Panel gestión de catálogo (plantillas con color — paridad CHECADOR)
  const gestionPanel = showGestionPlantillas ? `
<div class="tu-plantillas-panel" id="tuPlantillasPanel">
  <div class="tu-plantillas-panel-head">
    <span class="material-symbols-outlined">schedule</span>
    <h3>Catálogo de turnos</h3>
    <button class="tu-btn tu-btn--icon" id="tuCerrarGestion" type="button">
      <span class="material-symbols-outlined">close</span>
    </button>
  </div>
  <div class="tu-plantillas-list" id="tuPlantillasList">
    ${plantillas.length === 0
      ? '<p class="tu-empty" style="padding:8px 0;">Sin turnos. Crea el primero (ej. Mañana 08:00–16:00).</p>'
      : plantillas.map(p => {
        const bg = colorDeTurno(p);
        const fg = contraste(bg);
        return `
        <div class="tu-plantilla-item">
          <span class="tu-plantilla-swatch" style="background:${bg};color:${fg}"></span>
          <span class="tu-plantilla-item-name">${esc(p.nombre)}</span>
          <span class="tu-plantilla-item-hours">${esc(p.inicio)}–${esc(p.fin)}</span>
          <button class="tu-btn tu-btn--sm tu-btn--red" data-del-plantilla="${esc(p.id)}" type="button">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>`;
      }).join('')}
  </div>
  <div class="tu-plantillas-form">
    <input class="tu-input" type="text" id="tuPNombre" placeholder="Nombre (ej: Turno Mañana)">
    <div class="tu-horas-row" style="margin-top:8px;">
      <div class="tu-field-group">
        <label class="tu-label">Entrada</label>
        <input class="tu-input" type="time" id="tuPInicio" value="08:00">
      </div>
      <div class="tu-field-group">
        <label class="tu-label">Salida</label>
        <input class="tu-input" type="time" id="tuPFin" value="16:00">
      </div>
      <div class="tu-field-group">
        <label class="tu-label">Color</label>
        <input class="tu-input tu-input--color" type="color" id="tuPColor" value="#3B82F6">
      </div>
      <div class="tu-field-group">
        <label class="tu-label">Pausa (min)</label>
        <input class="tu-input" type="number" id="tuPPausa" value="0" min="0" max="180" step="5">
      </div>
    </div>
    <button class="tu-btn tu-btn--primary tu-btn--full" id="tuGuardarPlantilla" type="button" style="margin-top:8px;">
      <span class="material-symbols-outlined">add</span> Agregar turno
    </button>
  </div>
</div>` : '';

  return `
<div class="tu-horarios">
  ${isAdmin && !semanaEditable ? `
  <div class="tu-banner tu-banner--readonly">
    <span class="material-symbols-outlined">lock</span>
    Semana pasada — solo lectura
  </div>` : ''}
  <div class="tu-horarios-toolbar">
    <button class="tu-btn tu-btn--icon" id="tuSemPrev" type="button">
      <span class="material-symbols-outlined">chevron_left</span>
    </button>
    <span class="tu-semana-label">
      Semana del ${fmtSemana(semana)} al ${fmtSemana(semanaFinDisplay.toISOString().slice(0, 10))}
    </span>
    <button class="tu-btn tu-btn--icon" id="tuSemNext" type="button">
      <span class="material-symbols-outlined">chevron_right</span>
    </button>
    <button class="tu-btn tu-btn--ghost" id="tuSemHoy" type="button">Hoy</button>
    ${semanaEditable ? `
    <button class="tu-btn tu-btn--ghost" id="tuCopiarSemana" type="button">
      <span class="material-symbols-outlined">content_copy</span> Copiar semana anterior
    </button>` : ''}
    <span class="tu-sem-total" id="tuSemTotal">Total semana: <strong>${esc(totalHoras)} h</strong></span>
    <div style="flex:1"></div>
    ${isAdmin ? `
    <button class="tu-btn tu-btn--ghost" id="tuGestionPlantillas" type="button">
      <span class="material-symbols-outlined">schedule</span> Catálogo
    </button>` : ''}
    <button class="tu-btn tu-btn--ghost" id="tuExportar" type="button">
      <span class="material-symbols-outlined">picture_as_pdf</span> Exportar PDF
    </button>
  </div>
  ${gestionPanel}
  <div class="tu-grid-wrap">
    <table class="tu-grid">
      <thead>
        <tr>
          <th class="tu-grid-th-name">Colaborador</th>
          ${diasHeaders}
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  </div>
  ${isAdmin ? `<div class="tu-horarios-legend">
    ${plantillas.map(p => {
      const bg = colorDeTurno(p);
      return `<span class="tu-legend-item">
        <span class="tu-legend-dot" style="background:${bg}"></span>${esc(p.nombre)}
      </span>`;
    }).join('')}
    ${Object.entries(TIPOS_DIA).filter(([k]) => k !== 'NORMAL').map(([, v]) =>
      `<span class="tu-legend-item">
        <span class="tu-legend-dot" style="background:${v.color}"></span>${v.label}
      </span>`).join('')}
  </div>` : ''}
</div>

<!-- Editor de celda -->
<div class="tu-editor" id="tuEditor" style="display:none">
  <div class="tu-editor-inner">
    <div class="tu-editor-head">
      <span id="tuEditorTitle">Asignar horario</span>
      <button class="tu-btn tu-btn--icon" id="tuEditorClose" type="button">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div class="tu-editor-body">
      ${plantillas.length ? `
      <div>
        <label class="tu-label">Usar turno del catálogo</label>
        <div class="tu-plantillas-chips" id="tuPlantillasChips">
          ${plantillas.map(p => {
            const bg = colorDeTurno(p);
            const fg = contraste(bg);
            return `
            <button class="tu-plantilla-chip" type="button"
                    data-pid="${esc(p.id)}" data-inicio="${esc(p.inicio)}" data-fin="${esc(p.fin)}"
                    data-pausa="${Number(p.pausaMin) || 0}"
                    style="--chip-bg:${bg};--chip-fg:${fg}">
              ${esc(p.nombre)}
              <span class="tu-plantilla-chip-time">${esc(p.inicio)}–${esc(p.fin)}</span>
            </button>`;
          }).join('')}
        </div>
      </div>` : ''}
      <div>
        <label class="tu-label">Tipo de día</label>
        <div class="tu-tipo-btns" id="tuTipoBtns">
          ${Object.entries(TIPOS_DIA).map(([k, v]) =>
            `<button class="tu-tipo-btn" type="button" data-tipo="${k}"
                     style="border-color:${v.color}40;color:${v.color}">
              ${v.label}
             </button>`).join('')}
        </div>
      </div>
      <div id="tuHorasRow" class="tu-horas-row">
        <div class="tu-field-group">
          <label class="tu-label">Entrada</label>
          <input class="tu-input" type="time" id="tuHoraInicio" value="08:00">
        </div>
        <div class="tu-field-group">
          <label class="tu-label">Salida</label>
          <input class="tu-input" type="time" id="tuHoraFin" value="16:00">
        </div>
      </div>
      <div class="tu-field-group">
        <label class="tu-label">Nota para este colaborador</label>
        <input class="tu-input" type="text" id="tuNotaDia" placeholder="Ej: Va a GDL ese día">
      </div>
      <button class="tu-btn tu-btn--ghost tu-btn--full" id="tuEditorBorrar" type="button" style="margin-bottom:8px;">
        Quitar asignación
      </button>
      <button class="tu-btn tu-btn--primary tu-btn--full" id="tuEditorGuardar" type="button">
        <span class="material-symbols-outlined">save</span>
        Guardar
      </button>
    </div>
  </div>
</div>

<!-- Modal nota general de día -->
<div class="tu-nota-modal" id="tuNotaModal" style="display:none">
  <div class="tu-nota-modal-inner">
    <div class="tu-editor-head">
      <span id="tuNotaModalTitle">Nota del día</span>
      <button class="tu-btn tu-btn--icon" id="tuNotaModalClose" type="button">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <p style="font-size:12px;color:#64748b;margin:0 0 10px;">Visible para todos en la vista de horarios.</p>
    <input type="hidden" id="tuNotaModalDia">
    <textarea class="tu-input" id="tuNotaModalTexto" rows="3"
              placeholder="Ej: Habrá más actividad ese día"></textarea>
    <button class="tu-btn tu-btn--primary tu-btn--full" id="tuNotaModalGuardar" type="button" style="margin-top:8px;">
      <span class="material-symbols-outlined">save</span> Guardar nota
    </button>
  </div>
</div>`;
}

// ── Tab Asistencia ────────────────────────────────────────────
function _renderAsistencia() {
  const { asistenciaFecha, asistencia, usuarios, usuariosLoading } = _s;
  const pendientes = (asistencia || []).filter(a => String(a.estado || '').toUpperCase() === 'PENDIENTE').length;

  let filas = '';
  if (usuariosLoading) {
    filas = `<tr><td colspan="5" class="tu-grid-empty">Cargando…</td></tr>`;
  } else {
    const lista = resolveUsuariosLista(usuarios, { isAdmin: true, uid: _s.uid, profile: _s.profile });
    const emptyMsg = usuariosPlazaEmptyMessage({
      usuariosLoading: false,
      hasIndexError: !!(_s.listenerErrors?.usuarios || _s.usuariosLoadError?.code === LISTENER_ERROR.INDEX_MISSING),
      hasUsuarios: lista.length > 0,
    });
    if (emptyMsg) {
      filas = `<tr><td colspan="5" class="tu-grid-empty">${esc(emptyMsg)}</td></tr>`;
    } else {
      for (const u of lista) {
        const uUid = normalizeUsuarioUid(u);
        const reg = asistencia.find(a => a.usuarioId === uUid);
        const est = String(reg?.estado || '').toUpperCase();
        const nota = reg?.nota || '';
        const isPendiente = est === 'PENDIENTE';
        const badge = est
          ? `<span class="tu-asist-badge tu-asist-badge--${esc(est.toLowerCase())}">${esc(ESTADOS_ASISTENCIA[est]?.label || est)}</span>`
          : '<span class="tu-asist-badge tu-asist-badge--empty">Sin registrar</span>';
        filas += `<tr class="tu-asist-row${isPendiente ? ' tu-asist-row--pending' : ''}" data-uid="${esc(uUid)}" data-nombre="${esc(nombreUsuario(u))}">
        <td class="tu-td-main">${esc(nombreUsuario(u))}</td>
        <td>${badge}</td>
        <td>
          <select class="tu-select tu-asist-estado" data-uid="${esc(uUid)}">
            <option value="">— elegir —</option>
            ${Object.entries(ESTADOS_ASISTENCIA).map(([k, v]) =>
              `<option value="${k}" ${est === k ? 'selected' : ''}>${v.label}</option>`
            ).join('')}
          </select>
        </td>
        <td>
          <input class="tu-input tu-asist-nota" type="text" placeholder="Nota (opcional)"
                 value="${esc(nota)}" data-uid="${esc(uUid)}">
        </td>
        <td class="tu-td-actions">
          ${isPendiente ? `
          <button class="tu-btn tu-btn--sm tu-btn--primary tu-asist-confirm" type="button"
                  data-uid="${esc(uUid)}" data-nombre="${esc(nombreUsuario(u))}" title="Confirmar presente">
            Confirmar
          </button>` : ''}
          <button class="tu-btn tu-btn--sm tu-btn--ghost tu-asist-save" type="button"
                  data-uid="${esc(uUid)}" data-nombre="${esc(nombreUsuario(u))}" title="Guardar">
            Guardar
          </button>
        </td>
      </tr>`;
      }
    }
  }

  return `
<div class="tu-asistencia tu-formal">
  <div class="tu-asist-toolbar">
    <label class="tu-label">Fecha</label>
    <input class="tu-input" type="date" id="tuAsistFecha" value="${esc(asistenciaFecha)}">
    ${pendientes ? `<span class="tu-asist-pending-count">${pendientes} por confirmar</span>` : ''}
    <div class="tu-asist-legend">
      ${Object.entries(ESTADOS_ASISTENCIA).map(([, v]) =>
        `<span class="tu-legend-item">
          <span class="tu-legend-dot" style="background:${v.color}"></span>${v.label}
         </span>`).join('')}
    </div>
  </div>
  <div class="tu-table-wrap">
    <table class="tu-table">
      <thead>
        <tr>
          <th>Colaborador</th>
          <th>Registro</th>
          <th>Estado</th>
          <th>Nota</th>
          <th class="tu-th-actions">Acciones</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  </div>
</div>`;
}

// ── Tab Historial (por colaborador — patrón CHECADOR) ─────────
function _renderHistorial() {
  const { historial, historialCargado, historialLoading, historialMostrado, isAdmin, uid, listenerErrors } = _s;

  if (listenerErrors?.historial?.code === LISTENER_ERROR.INDEX_MISSING) {
    return `<div class="tu-empty-state">
      <span class="material-symbols-outlined">construction</span>
      <p>El historial requiere un índice de Firestore que aún no está desplegado.</p>
      <p style="font-size:12px;color:#64748b;margin-top:8px;">Ejecuta <code>firebase deploy --only firestore:indexes</code></p>
    </div>`;
  }

  const filtros = _renderHistorialFiltros();

  if (isAdmin && !historialMostrado) {
    return `
<div class="tu-historial">
  ${filtros}
  <div class="tu-empty-state tu-hist-empty">
    <span class="material-symbols-outlined">person_search</span>
    <p>Selecciona un colaborador y pulsa <strong>Ver historial</strong>.</p>
  </div>
</div>`;
  }

  if (historialLoading || (!historialCargado && !isAdmin)) {
    return `
<div class="tu-historial">
  ${filtros}
  <div class="tu-loading">
    <div class="tu-spinner"></div>
    <span>Cargando historial…</span>
  </div>
</div>`;
  }

  const targetUid = isAdmin ? _s.historialUsuarioId : uid;
  const usuario = _usuarioHistorial(targetUid);
  const resumen = _historialResumen(historial);

  if (!historial.length) {
    return `
<div class="tu-historial">
  ${filtros}
  ${_renderHistorialSubject(usuario, resumen)}
  <div class="tu-empty-state">
    <span class="material-symbols-outlined">history</span>
    <p>No hay turnos cerrados en este rango.</p>
  </div>
</div>`;
  }

  return `
<div class="tu-historial">
  ${filtros}
  ${_renderHistorialSubject(usuario, resumen)}
  ${_renderHistorialTabla(historial)}
</div>`;
}

// ── Bind ──────────────────────────────────────────────────────
function _bindTabs() {
  _ctr?.querySelector('#tuTabs')?.addEventListener('click', e => {
    const btn = e.target.closest('.tu-tab');
    if (!btn || !_s) return;
    _s.tab = btn.dataset.tab;
    if (_s.tab === 'historial' && !_s.isAdmin && !_s.historialCargado) {
      void _loadHistorialUsuario();
    }
    _ctr.querySelectorAll('.tu-tab').forEach(b => b.classList.toggle('tu-tab--active', b.dataset.tab === _s.tab));
    _repaintTab();
  });
  _bindTabBody();
}

function _bindTabBody() {
  if (!_ctr || !_s) return;
  switch (_s.tab) {
    case 'activos':    _bindActivos();    break;
    case 'horarios':   _bindHorarios();   break;
    case 'asistencia': _bindAsistencia(); break;
    case 'historial':  _bindHistorial();  break;
  }
}

function _bindActivos() {
  // Iniciar turno → gate cámara + face + geo
  _ctr?.querySelector('#tuBtnIniciar')?.addEventListener('click', async () => {
    const btn = _ctr?.querySelector('#tuBtnIniciar');
    if (btn) btn.disabled = true;
    try {
      const { profile, plaza } = _s;
      const authUid = window._auth?.currentUser?.uid;
      await iniciarTurno({ uid: authUid, ...profile }, plaza);
    } catch (e) {
      if (e?.code === 'GATE_CANCELLED') {
        if (_s && btn) btn.disabled = false;
        return;
      }
      console.warn('[turnos] iniciarTurno:', e);
      _toastTurnoError(e, 'iniciar el turno');
      if (_s && btn) btn.disabled = false;
    }
  });

  // Cerrar turno propio → gate cámara + geo (face opcional)
  _ctr?.querySelectorAll('[data-cerrar]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.cerrar;
      btn.disabled = true;
      try {
        await cerrarTurno(id, { user: _s?.profile, plaza: _s?.plaza });
      } catch (e) {
        if (e?.code === 'GATE_CANCELLED') {
          btn.disabled = false;
          return;
        }
        console.warn('[turnos] cerrarTurno:', e);
        _toastTurnoError(e, 'cerrar el turno');
        btn.disabled = false;
      }
    });
  });
}

function _bindHorarios() {
  // Navegación de semanas
  _ctr?.querySelector('#tuSemPrev')?.addEventListener('click', () => {
    if (!_s) return;
    _s.semana = moverSemana(_s.semana, -1);
    _restartListenerHorarios();
    _repaintTab();
  });
  _ctr?.querySelector('#tuSemNext')?.addEventListener('click', () => {
    if (!_s) return;
    _s.semana = moverSemana(_s.semana, 1);
    _restartListenerHorarios();
    _repaintTab();
  });
  _ctr?.querySelector('#tuSemHoy')?.addEventListener('click', () => {
    if (!_s) return;
    _s.semana = semanaInicio();
    _restartListenerHorarios();
    _repaintTab();
  });

  _ctr?.querySelector('#tuCopiarSemana')?.addEventListener('click', async () => {
    if (!_s?.isAdmin || !_s?.plaza) return;
    const semanaActual = semanaInicio();
    if (_s.semana < semanaActual) {
      _toast('No puedes copiar horarios en una semana pasada.', 'Semana bloqueada');
      return;
    }
    const ok = typeof window.mexConfirm === 'function'
      ? await window.mexConfirm(
        'Copiar semana anterior',
        '¿Copiar los horarios de la semana pasada a esta semana? Se sobrescribirán celdas existentes.',
        'warning'
      )
      : false;
    if (!ok) return;
    const btn = _ctr?.querySelector('#tuCopiarSemana');
    if (btn) btn.disabled = true;
    try {
      const { count, semanaOrigen } = await copiarSemanaAnterior(_s.plaza, _s.semana);
      if (!count) {
        _toast('No hay horarios en la semana anterior para copiar.', 'Sin datos');
      } else {
        _toast(`${count} horario(s) copiados desde la semana del ${semanaOrigen}.`, 'Listo');
      }
    } catch (e) {
      console.warn('[turnos] copiarSemana:', e);
      _toast(e?.message || 'No se pudo copiar la semana.', 'Error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Exportar
  _ctr?.querySelector('#tuExportar')?.addEventListener('click', _exportarHorarios);

  // Gestionar plantillas (toggle panel)
  _ctr?.querySelector('#tuGestionPlantillas')?.addEventListener('click', () => {
    if (!_s) return;
    _s.showGestionPlantillas = !_s.showGestionPlantillas;
    _repaintTab();
  });
  _ctr?.querySelector('#tuCerrarGestion')?.addEventListener('click', () => {
    if (!_s) return;
    _s.showGestionPlantillas = false;
    _repaintTab();
  });

  // Guardar nuevo turno del catálogo
  _ctr?.querySelector('#tuGuardarPlantilla')?.addEventListener('click', async () => {
    const nombre = _ctr.querySelector('#tuPNombre')?.value.trim();
    const inicio = _ctr.querySelector('#tuPInicio')?.value;
    const fin    = _ctr.querySelector('#tuPFin')?.value;
    const color  = _ctr.querySelector('#tuPColor')?.value || '#3B82F6';
    const pausaMin = Number(_ctr.querySelector('#tuPPausa')?.value) || 0;
    if (!nombre || !inicio || !fin) return;
    const btn = _ctr.querySelector('#tuGuardarPlantilla');
    if (btn) btn.disabled = true;
    try {
      await guardarPlantilla(nombre, inicio, fin, null, { color, pausaMin });
      const el = _ctr.querySelector('#tuPNombre');
      if (el) el.value = '';
    } catch (e) {
      console.warn('[turnos] guardarPlantilla:', e);
      _toast(e?.message || 'No se pudo guardar el turno.', 'Error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Eliminar plantilla
  _ctr?.querySelectorAll('[data-del-plantilla]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await eliminarPlantilla(btn.dataset.delPlantilla); }
      catch (e) { console.warn('[turnos] eliminarPlantilla:', e); btn.disabled = false; }
    });
  });

  // Notas generales de día
  _ctr?.querySelectorAll('[data-nota-dia]').forEach(el => {
    el.addEventListener('click', () => _openNotaModal(el.dataset.notaDia, el.dataset.notaVal || ''));
  });
  _bindNotaModal();

  // Selects inline (paridad CHECADOR)
  if (_s.isAdmin) {
    _ctr?.querySelectorAll('.tu-grid-sel').forEach(sel => {
      sel.addEventListener('change', async () => {
        const uid = sel.dataset.editUid;
        const nombre = sel.dataset.editNombre;
        const rol = sel.dataset.editRol;
        const diaKey = sel.dataset.editDia;
        if (!uid || !diaKey || !_s) return;
        sel.disabled = true;
        try {
          const cell = _parseSelectValue(sel.value, _s.plantillas);
          await guardarHorarioCelda(uid, _s.plaza, _s.semana, diaKey, cell, { nombre, rol });
        } catch (e) {
          console.warn('[turnos] grid-sel:', e);
          _toast(e?.message || 'No se pudo guardar.', 'Error');
          _repaintTab();
        } finally {
          sel.disabled = false;
        }
      });
    });
    _ctr?.querySelectorAll('.tu-cell-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _openEditor(btn);
      });
    });
    _bindEditor();
  }
}

function _parseSelectValue(value, plantillas = []) {
  const v = String(value || '');
  if (!v) return null;
  if (v.startsWith('tipo:')) {
    return { tipo: v.slice(5) };
  }
  if (v.startsWith('p:')) {
    const id = v.slice(2);
    const p = plantillas.find(x => x.id === id);
    if (!p) throw new Error('Turno del catálogo no encontrado.');
    return {
      tipo: 'NORMAL',
      inicio: p.inicio,
      fin: p.fin,
      plantillaId: p.id,
      pausaMin: Number(p.pausaMin) || 0,
    };
  }
  if (v.startsWith('custom:')) {
    const [inicio, fin] = v.slice(7).split('-');
    return { tipo: 'NORMAL', inicio, fin };
  }
  return null;
}

function _openEditor(td) {
  const editor = _ctr?.querySelector('#tuEditor');
  if (!editor || !_s) return;
  const uid    = td.dataset.editUid;
  const nombre = td.dataset.editNombre;
  const rol    = td.dataset.editRol;
  const diaKey = td.dataset.editDia;
  if (!uid || !diaKey) return;

  // Cargar valores existentes
  const horario = _s.horarios.find(h => h.usuarioId === uid);
  const cell    = horario?.dias?.[diaKey];

  _s.editDia = { uid, nombre, rol, diaKey, plantillaId: cell?.plantillaId || null };

  // Setear título
  const titleEl = editor.querySelector('#tuEditorTitle');
  if (titleEl) titleEl.textContent = `${DIA_NOMBRE[diaKey]} — ${nombre}`;

  // Tipo activo
  const tipo = cell?.tipo || 'NORMAL';
  editor.querySelectorAll('.tu-tipo-btn').forEach(b => {
    b.classList.toggle('tu-tipo-btn--active', b.dataset.tipo === tipo);
  });

  // Horas
  const horasRow = editor.querySelector('#tuHorasRow');
  if (horasRow) horasRow.style.display = tipo === 'NORMAL' ? '' : 'none';
  const ini = editor.querySelector('#tuHoraInicio');
  const fin = editor.querySelector('#tuHoraFin');
  if (ini) ini.value = cell?.inicio || '08:00';
  if (fin) fin.value = cell?.fin    || '16:00';

  // Chips plantilla
  editor.querySelectorAll('.tu-plantilla-chip').forEach(c => {
    c.classList.toggle('tu-plantilla-chip--active', c.dataset.pid === cell?.plantillaId);
  });

  // Nota del día
  const notaEl = editor.querySelector('#tuNotaDia');
  if (notaEl) notaEl.value = cell?.nota || '';

  editor.style.display = '';
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _bindEditor() {
  const editor = _ctr?.querySelector('#tuEditor');
  if (!editor) return;

  editor.querySelector('#tuEditorClose')?.addEventListener('click', () => {
    editor.style.display = 'none';
    _s.editDia = null;
  });

  editor.querySelectorAll('.tu-tipo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      editor.querySelectorAll('.tu-tipo-btn').forEach(b => b.classList.remove('tu-tipo-btn--active'));
      btn.classList.add('tu-tipo-btn--active');
      const horasRow = editor.querySelector('#tuHorasRow');
      if (horasRow) horasRow.style.display = btn.dataset.tipo === 'NORMAL' ? '' : 'none';
      if (btn.dataset.tipo !== 'NORMAL' && _s?.editDia) {
        _s.editDia.plantillaId = null;
        editor.querySelectorAll('.tu-plantilla-chip').forEach(c => c.classList.remove('tu-plantilla-chip--active'));
      }
    });
  });

  // Plantillas: click auto-rellena horas y activa tipo NORMAL
  editor.querySelectorAll('.tu-plantilla-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const ini = editor.querySelector('#tuHoraInicio');
      const fin = editor.querySelector('#tuHoraFin');
      if (ini) ini.value = chip.dataset.inicio;
      if (fin) fin.value = chip.dataset.fin;
      if (_s?.editDia) _s.editDia.plantillaId = chip.dataset.pid || null;
      if (_s?.editDia) _s.editDia.pausaMin = Number(chip.dataset.pausa) || 0;
      // Activar NORMAL
      editor.querySelectorAll('.tu-tipo-btn').forEach(b => {
        b.classList.toggle('tu-tipo-btn--active', b.dataset.tipo === 'NORMAL');
      });
      const horasRow = editor.querySelector('#tuHorasRow');
      if (horasRow) horasRow.style.display = '';
      // Resaltar chip seleccionado
      editor.querySelectorAll('.tu-plantilla-chip').forEach(c => c.classList.remove('tu-plantilla-chip--active'));
      chip.classList.add('tu-plantilla-chip--active');
    });
  });

  editor.querySelector('#tuEditorBorrar')?.addEventListener('click', async () => {
    const { editDia, plaza, semana } = _s;
    if (!editDia) return;
    const btn = editor.querySelector('#tuEditorBorrar');
    if (btn) btn.disabled = true;
    try {
      await guardarHorarioCelda(editDia.uid, plaza, semana, editDia.diaKey, null, {
        nombre: editDia.nombre,
        rol: editDia.rol,
      });
      editor.style.display = 'none';
      _s.editDia = null;
    } catch (e) {
      console.warn('[turnos] borrarCelda:', e);
      _toast(e?.message || 'No se pudo quitar.', 'Error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  editor.querySelector('#tuEditorGuardar')?.addEventListener('click', async () => {
    const { editDia, plaza, semana } = _s;
    if (!editDia) return;
    const btn = editor.querySelector('#tuEditorGuardar');
    if (btn) btn.disabled = true;

    try {
      const tipoActivo = editor.querySelector('.tu-tipo-btn--active')?.dataset.tipo || 'NORMAL';
      const inicio     = editor.querySelector('#tuHoraInicio')?.value || '08:00';
      const fin        = editor.querySelector('#tuHoraFin')?.value    || '16:00';
      const nota       = (editor.querySelector('#tuNotaDia')?.value || '').trim();

      let cellData;
      if (tipoActivo === 'NORMAL') {
        cellData = {
          tipo: 'NORMAL',
          inicio,
          fin,
          plantillaId: editDia.plantillaId || null,
          pausaMin: Number(editDia.pausaMin) || 0,
        };
        // Si las horas coinciden con una plantilla, enlazar
        if (!cellData.plantillaId) {
          const match = (_s.plantillas || []).find(p => p.inicio === inicio && p.fin === fin);
          if (match) {
            cellData.plantillaId = match.id;
            cellData.pausaMin = Number(match.pausaMin) || 0;
          }
        }
      } else {
        cellData = { tipo: tipoActivo };
      }
      if (nota) cellData.nota = nota;

      await guardarHorarioCelda(editDia.uid, plaza, semana, editDia.diaKey, cellData, {
        nombre: editDia.nombre,
        rol:    editDia.rol,
      });

      editor.style.display = 'none';
      _s.editDia = null;
    } catch (e) {
      console.warn('[turnos] guardarHorarioCelda:', e);
      _toast(e?.message || 'No se pudo guardar.', 'Error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function _openNotaModal(diaKey, valorActual = '') {
  const modal = _ctr?.querySelector('#tuNotaModal');
  if (!modal) return;
  const titulo = _ctr.querySelector('#tuNotaModalTitle');
  if (titulo) titulo.textContent = `Nota general — ${DIA_NOMBRE[diaKey] || diaKey}`;
  const diaEl = _ctr.querySelector('#tuNotaModalDia');
  if (diaEl) diaEl.value = diaKey;
  const textoEl = _ctr.querySelector('#tuNotaModalTexto');
  if (textoEl) textoEl.value = valorActual;
  modal.style.display = '';
}

function _bindNotaModal() {
  const modal = _ctr?.querySelector('#tuNotaModal');
  if (!modal) return;
  _ctr.querySelector('#tuNotaModalClose')?.addEventListener('click', () => { modal.style.display = 'none'; });
  _ctr.querySelector('#tuNotaModalGuardar')?.addEventListener('click', async () => {
    const diaKey = _ctr.querySelector('#tuNotaModalDia')?.value;
    const nota   = _ctr.querySelector('#tuNotaModalTexto')?.value.trim() || '';
    if (!diaKey || !_s) return;
    const btn = _ctr.querySelector('#tuNotaModalGuardar');
    if (btn) btn.disabled = true;
    try {
      await guardarNotaSemana(_s.plaza, _s.semana, diaKey, nota);
      modal.style.display = 'none';
    } catch (e) {
      console.warn('[turnos] guardarNotaSemana:', e);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function _bindAsistencia() {
  _ctr?.querySelector('#tuAsistFecha')?.addEventListener('change', e => {
    if (!_s) return;
    _s.asistenciaFecha = e.target.value || hoy();
    _restartListenerAsistencia();
    _repaintTab();
  });

  _ctr?.querySelectorAll('.tu-asist-confirm').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      const nombre = btn.dataset.nombre;
      const row = btn.closest('.tu-asist-row');
      const nota = row?.querySelector('.tu-asist-nota')?.value || '';
      if (!uid) return;
      btn.disabled = true;
      try {
        await confirmarAsistencia(uid, _s.plaza, _s.asistenciaFecha, 'PRESENTE', { nombre, nota });
        _toast(`Asistencia de ${nombre} confirmada.`, 'Asistencia');
      } catch (e) {
        console.warn('[turnos] confirmarAsistencia:', e);
        _toast(e?.message || 'No se pudo confirmar.', 'Error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  _ctr?.querySelectorAll('.tu-asist-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      const nombre = btn.dataset.nombre;
      const row = btn.closest('.tu-asist-row');
      const estado = row?.querySelector('.tu-asist-estado')?.value || '';
      const nota = row?.querySelector('.tu-asist-nota')?.value || '';
      if (!estado || !uid) {
        _toast('Elige un estado antes de guardar.', 'Asistencia');
        return;
      }
      btn.disabled = true;
      try {
        const opts = { nombre, nota, origen: 'ADMIN' };
        if (estado !== 'PENDIENTE') {
          await confirmarAsistencia(uid, _s.plaza, _s.asistenciaFecha, estado, opts);
        } else {
          await registrarAsistencia(uid, _s.plaza, _s.asistenciaFecha, estado, opts);
        }
        _toast('Asistencia guardada.', 'Asistencia');
      } catch (e) {
        console.warn('[turnos] registrarAsistencia:', e);
        _toast(e?.message || 'No se pudo guardar.', 'Error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function _minutosEntre(inicio, fin, pausaMin = 0) {
  return minutosEntre(inicio, fin, pausaMin);
}

function _contrasteHex(hex) {
  return contraste(hex);
}

function _exportCabeceraEmpresa() {
  const emp = window._empresaActual || {};
  const nombre = emp.nombre || emp.nombreComercial || emp.razonSocial || '';
  const logo = emp.logoUrl || emp.logo || '';
  if (!nombre && !logo) return '';
  return `<header class="rpt-cab">
    ${logo ? `<img class="rpt-logo" src="${esc(logo)}" alt="">` : ''}
    <div class="rpt-empresa">
      ${nombre ? `<strong>${esc(nombre)}</strong>` : ''}
      <span>Turnos y horarios</span>
    </div>
  </header>`;
}

function _exportarHorarios() {
  if (!_s) return;
  const { semana, horarios, usuarios, notasSemana, isAdmin, uid, profile, plaza, plantillas } = _s;
  const lista = resolveUsuariosLista(usuarios || [], { isAdmin, uid, profile });
  if (!lista.length) {
    _toast('No hay colaboradores para exportar.', 'Exportar');
    return;
  }

  const semanaFin = moverSemana(semana, 1);
  const finDisp = new Date(semanaFin + 'T00:00:00');
  finDisp.setDate(finDisp.getDate() - 1);
  const fmt = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

  const thDias = DIAS.map((d) => {
    const fecha = fechaDia(semana, d);
    const dObj = new Date(`${fecha}T12:00:00`);
    const finde = dObj.getDay() === 0 || dObj.getDay() === 6;
    const nota = notasSemana[d] ? `<br><small class="nota">${esc(notasSemana[d])}</small>` : '';
    return `<th class="${finde ? 'we' : ''}">${esc(DIA_NOMBRE[d].slice(0, 3))}<br><small>${esc(fmt(fecha))}</small>${nota}</th>`;
  }).join('');

  // Leer selects en vivo (paridad CHECADOR pdfTurnos) si existen
  const liveVal = (uid, dia) => {
    const sel = _ctr?.querySelector(`.tu-grid-sel[data-edit-uid="${uid}"][data-edit-dia="${dia}"]`);
    if (!sel) return null;
    try { return _parseSelectValue(sel.value, plantillas); } catch (_) { return null; }
  };

  let totalMin = 0;
  const rows = lista.map((u) => {
    const realUid = normalizeUsuarioUid(u);
    const horario = horarios.find(h => h.usuarioId === realUid);
    const celdas = DIAS.map((d) => {
      const cell = liveVal(realUid, d) || horario?.dias?.[d];
      if (!cell) return '<td class="off">Descanso</td>';
      if (cell.tipo === 'NORMAL') {
        const p = matchPlantilla(cell, plantillas);
        const mins = _minutosEntre(cell.inicio, cell.fin, cell.pausaMin ?? p?.pausaMin);
        totalMin += mins;
        const bg = colorDeTurno(p || { id: `${cell.inicio}-${cell.fin}` });
        const fg = contraste(bg);
        const label = p ? p.nombre : `${cell.inicio}–${cell.fin}`;
        const nota = cell.nota ? `<br><small>${esc(cell.nota)}</small>` : '';
        return `<td style="background:${bg};color:${fg}"><strong>${esc(label)}</strong><br><small>${esc(cell.inicio)}–${esc(cell.fin)}</small>${nota}</td>`;
      }
      const meta = TIPOS_DIA[cell.tipo] || { label: cell.tipo, color: '#94a3b8' };
      const bg = meta.color || '#94a3b8';
      const fg = contraste(bg);
      const nota = cell.nota ? `<br><small>${esc(cell.nota)}</small>` : '';
      return `<td style="background:${bg};color:${fg};font-weight:600">${esc(meta.label || cell.tipo)}${nota}</td>`;
    }).join('');
    return `<tr><td class="emp">${esc(nombreUsuario(u))}</td>${celdas}</tr>`;
  }).join('');

  const totalHoras = (totalMin / 60).toFixed(1);
  const rangoLabel = `Semana del ${fmt(semana)} al ${fmt(finDisp.toISOString().slice(0, 10))}`;
  const titulo = `Distribución de turnos${plaza ? ` — ${plaza}` : ''}`;
  const cab = _exportCabeceraEmpresa();

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>${esc(titulo)}</title>
<style>
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font:12px Inter,system-ui,-apple-system,sans-serif;margin:22px;color:#0f172a}
  h1{font-size:17px;margin:0 0 2px}
  .sub{color:#64748b;font-size:11px;margin:0 0 14px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  table{border-collapse:collapse;width:100%;table-layout:fixed}
  th,td{border:1px solid #cbd5e1;padding:6px 7px;text-align:center;vertical-align:middle}
  th{background:#f1f5f9;font-size:10px;line-height:1.3;text-transform:uppercase;letter-spacing:0.04em}
  th small,td small{font-weight:400;opacity:.8;font-size:9px;text-transform:none;letter-spacing:0}
  td.emp,th.emp{text-align:left;white-space:nowrap;font-weight:600;background:#f8fafc;width:150px}
  td.off{color:#94a3b8;font-style:italic}
  .we{background:#e2e8f0}
  .nota{color:#6366f1}
  .rpt-cab{display:flex;align-items:center;gap:14px;border-bottom:2px solid #0f172a;padding-bottom:10px;margin:0 0 14px}
  .rpt-logo{height:46px;width:auto;object-fit:contain}
  .rpt-empresa{display:flex;flex-direction:column;line-height:1.35}
  .rpt-empresa strong{font-size:14px;color:#0f172a}
  .rpt-empresa span{font-size:10px;color:#64748b}
  .no-print{margin-top:16px}
  .btn-print{padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600}
  @page{size:landscape;margin:12mm}
  @media print{body{margin:0}.no-print{display:none}}
</style></head><body>
${cab}
<h1>${esc(titulo)}</h1>
<div class="sub"><span>${esc(rangoLabel)}</span><span>Total semana: ${esc(totalHoras)} h</span></div>
<table>
  <thead><tr><th class="emp">Colaborador</th>${thDias}</tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="no-print">
  <button class="btn-print" type="button" onclick="window.print()">Imprimir / Guardar PDF</button>
</div>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) {
    _toast('Permite ventanas emergentes para exportar.', 'Exportar');
    return;
  }
  win.document.write(html);
  win.document.close();
}

function _bindHistorial() {
  _ctr?.querySelector('#tuHistSemana')?.addEventListener('click', () => {
    if (!_s) return;
    _s.historialDesde = _isoHaceDias(7);
    _s.historialHasta = hoy();
    _repaintTab();
  });

  _ctr?.querySelector('#tuHistDesde')?.addEventListener('change', e => {
    if (!_s) return;
    _s.historialDesde = String(e.target.value || _isoHaceDias(30)).slice(0, 10);
  });

  _ctr?.querySelector('#tuHistHasta')?.addEventListener('change', e => {
    if (!_s) return;
    const val = String(e.target.value || hoy()).slice(0, 10);
    _s.historialHasta = val > hoy() ? hoy() : val;
  });

  _ctr?.querySelector('#tuHistUsuario')?.addEventListener('change', e => {
    if (!_s) return;
    _s.historialUsuarioId = String(e.target.value || '').trim();
  });

  _ctr?.querySelector('#tuHistVer')?.addEventListener('click', () => {
    if (!_s) return;
    if (_s.isAdmin && !_s.historialUsuarioId) {
      _toast('Selecciona un colaborador.', 'Historial');
      return;
    }
    const desde = _ctr?.querySelector('#tuHistDesde')?.value || _s.historialDesde;
    const hasta = _ctr?.querySelector('#tuHistHasta')?.value || _s.historialHasta;
    _s.historialDesde = String(desde).slice(0, 10);
    _s.historialHasta = String(hasta > hoy() ? hoy() : hasta).slice(0, 10);
    if (_s.historialDesde > _s.historialHasta) {
      _toast('La fecha inicio no puede ser posterior a la final.', 'Historial');
      return;
    }
    if (_s.isAdmin) {
      _s.historialUsuarioId = _ctr?.querySelector('#tuHistUsuario')?.value || _s.historialUsuarioId;
    }
    _s.historialMostrado = true;
    const wrap = _ctr?.querySelector('#tuHistFilters');
    if (wrap) wrap.open = false;
    void _loadHistorialUsuario();
  });
}

// ── Historial loader (un colaborador + rango) ─────────────────
async function _loadHistorialUsuario() {
  if (!_s) return;
  const { plaza, isAdmin, uid } = _s;
  const usuarioId = isAdmin ? _s.historialUsuarioId : uid;
  if (!usuarioId) return;

  _s.historialLoading = true;
  _repaintTab();

  try {
    const items = await getHistorialTurnos(plaza, {
      usuarioId,
      desde: _s.historialDesde,
      hasta: _s.historialHasta,
      limit: 120
    });
    if (!_s) return;
    delete _s.listenerErrors.historial;
    _s.historial = items;
    _s.historialCargado = true;
    _s.historialLoading = false;
    _repaintTab();
  } catch (e) {
    console.warn('[turnos] historial:', e);
    if (!_s) return;
    if (e?.code === 'INDEX_MISSING') {
      _s.listenerErrors.historial = { code: LISTENER_ERROR.INDEX_MISSING, source: 'historial' };
      _toast('Índice de historial pendiente. Despliega firestore:indexes.', 'Índice requerido');
    }
    _s.historial = [];
    _s.historialCargado = true;
    _s.historialLoading = false;
    _repaintTab();
  }
}
