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
  onRolesOperativos,
  crearRolOperativo,
  renombrarRolOperativo,
  eliminarRolOperativo,
  reordenarRolOperativo,
  asignarUsuarioARol,
} from '/js/app/features/turnos/roles-operativos-data.js';
import {
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
  agruparPorRolOperativo,
  rolOperativoDeUsuario,
} from '/js/app/features/turnos/turnos-view-model.js';
import { colorDeTurno, contraste } from '/js/app/features/turnos/turno-color.js';
import {
  buildExportFilename,
  exportFooterHtml,
  getExportIdentity,
} from '/js/core/export-signing.js';
import { getTurnosRango } from '/js/app/features/turnos/turnos-data.js';
import {
  getHorariosRango, getAsistenciaRango,
} from '/js/app/features/turnos/horarios-data.js';
import {
  getNotasRango, getNotasColaborador,
  guardarNotaAsistencia, eliminarNotaAsistencia, TIPOS_NOTA,
} from '/js/app/features/turnos/notas-asistencia-data.js';
import {
  tableroMes, calendarioEmpleado, matrizCalendarioMes,
  CAT_META, CAT_ORDEN, ymd,
} from '/js/app/features/turnos/asistencia-calc.js';
import {
  tableroToolbarHtml, tableroBodyHtml,
} from '/js/app/features/turnos/tablero-asistencia.js';
import { getHistorialHechos, HECHO_LABEL, registrarHechoTurno } from '/js/app/features/turnos/turnos-audit.js';

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

/** Primer día (ISO) del mes que contiene la fecha dada (default hoy). */
function _mesAncla(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Suma n meses al ancla (primer día). */
function _moverMes(anclaIso, n) {
  const d = new Date(`${anclaIso}T00:00:00`);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Rango { desde, hasta } (primer y último día) del mes del ancla. */
function _mesRango(anclaIso) {
  const d = new Date(`${anclaIso}T00:00:00`);
  const desde = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const hasta = `${ultimo.getFullYear()}-${String(ultimo.getMonth() + 1).padStart(2, '0')}-${String(ultimo.getDate()).padStart(2, '0')}`;
  return { desde, hasta };
}

/** Plazas disponibles para el selector del tablero (del app-state + actual). */
function _plazasDisponibles() {
  const gs = getState();
  const set = new Set();
  const list = Array.isArray(gs.plazas) ? gs.plazas
    : Array.isArray(gs.plazasDisponibles) ? gs.plazasDisponibles : [];
  for (const p of list) {
    const id = String(p?.id || p?.plazaId || p || '').toUpperCase().trim();
    if (id) set.add(id);
  }
  if (_s?.plaza) set.add(_s.plaza);
  const arr = [...set].sort();
  // "Todas" solo para roles globales (multi-plaza).
  const role = String(gs.role || '').toUpperCase();
  const global = ['CORPORATIVO_USER', 'JEFE_OPERACION', 'JEFE_REGIONAL', 'PROGRAMADOR'].includes(role);
  return global && arr.length > 1 ? ['TODAS', ...arr] : arr;
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

function _puestoDeUsuario(u) {
  return String(u?.puesto || u?.rol || u?.role || '').trim();
}

function _renderHistorialFiltros() {
  const { isAdmin, usuarios, usuariosLoading, historialDesde, historialHasta, historialUsuarioId, historialPlaza, historialPuesto } = _s;
  let lista = resolveUsuariosLista(usuarios || [], {
    isAdmin: Boolean(isAdmin),
    uid: _s.uid,
    profile: _s.profile
  });
  // Filtro por puesto (afecta el combo de colaboradores)
  if (historialPuesto) {
    lista = lista.filter(u => _puestoDeUsuario(u).toUpperCase() === historialPuesto.toUpperCase());
  }
  const opts = lista.map(u => {
    const uid = normalizeUsuarioUid(u);
    return `<option value="${esc(uid)}"${uid === historialUsuarioId ? ' selected' : ''}>${esc(nombreUsuario(u))}</option>`;
  }).join('');

  const plazas = _plazasDisponibles().filter(p => p !== 'TODAS');
  const plazaOpts = plazas.map(p =>
    `<option value="${esc(p)}"${p === historialPlaza ? ' selected' : ''}>${esc(p)}</option>`
  ).join('');

  const puestos = [...new Set((usuarios || []).map(_puestoDeUsuario).filter(Boolean))].sort();
  const puestoOpts = puestos.map(p =>
    `<option value="${esc(p)}"${p === historialPuesto ? ' selected' : ''}>${esc(p)}</option>`
  ).join('');

  return `
  <details class="tu-hist-filters" id="tuHistFilters" open>
    <summary class="tu-hist-filters__summary">
      <span class="material-symbols-outlined">filter_list</span>
      Filtros
    </summary>
    <div class="tu-hist-filters__grid">
      ${isAdmin ? `
      <div class="tu-field-group">
        <label class="tu-label" for="tuHistPlaza">Plaza</label>
        <select class="tu-input" id="tuHistPlaza">
          <option value="">Seleccionar (todas)</option>
          ${plazaOpts}
        </select>
      </div>
      <div class="tu-field-group">
        <label class="tu-label" for="tuHistPuesto">Puesto</label>
        <select class="tu-input" id="tuHistPuesto">
          <option value="">Seleccionar (todos)</option>
          ${puestoOpts}
        </select>
      </div>
      <div class="tu-field-group">
        <label class="tu-label" for="tuHistUsuario">Empleado <span class="tu-req">*</span></label>
        <select class="tu-input" id="tuHistUsuario"${usuariosLoading ? ' disabled' : ''}>
          <option value="">Selecciona empleado…</option>
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
      <button class="tu-btn tu-btn--ghost" id="tuHistReset" type="button">
        <span class="material-symbols-outlined">restart_alt</span> Resetear
      </button>
      <button class="tu-btn tu-btn--primary" id="tuHistVer" type="button">Ver historial</button>
    </div>
  </details>`;
}

function _renderHistorialSubject(usuario, resumen) {
  const nombre = usuario ? nombreUsuario(usuario) : String(_s?.profile?.nombreCompleto || _s?.profile?.nombre || 'Colaborador');
  const rol = usuario?.rol || usuario?.role || _s?.profile?.rol || '';
  const plaza = _s?.historialPlaza || _s?.plaza || '';
  const targetUid = _s?.isAdmin ? _s?.historialUsuarioId : _s?.uid;
  return `
  <div class="tu-hist-subj">
    <span class="tu-hist-subj__avatar">${esc(initialUsuario(usuario || _s?.profile || {}))}</span>
    <div class="tu-hist-subj__info">
      <h3 class="tu-hist-subj__name">${esc(nombre)}</h3>
      <span class="tu-hist-subj__meta">${esc([rol, plaza].filter(Boolean).join(' · '))}</span>
    </div>
    <span class="tu-hist-subj__range">${esc(_fmtHistRange(_s.historialDesde, _s.historialHasta))}</span>
    <div class="tu-hist-subj__actions">
      <button class="tu-btn tu-btn--icon" id="tuHistStats" type="button" title="Resumen">
        <span class="material-symbols-outlined">bar_chart</span>
      </button>
      <button class="tu-btn tu-btn--icon" id="tuHistPdf" type="button" title="Descargar PDF">
        <span class="material-symbols-outlined">download</span>
      </button>
      ${_s?.isAdmin ? `
      <button class="tu-btn tu-btn--primary tu-btn--sm" id="tuHistNota" type="button" data-uid="${esc(targetUid)}" data-nombre="${esc(nombre)}">
        <span class="material-symbols-outlined">add</span> Nota
      </button>` : ''}
    </div>
  </div>`;
}

/** Píldoras de resumen (6 categorías) del rango/mes visible. */
function _renderHistStatsBar(resumen) {
  if (!resumen) return '';
  return `<div class="tu-hist-statsbar">
    ${CAT_ORDEN.map(cat => {
      const m = CAT_META[cat];
      return `<div class="tu-hist-pill" style="--pill:${m.color}">
        <span class="tu-hist-pill__val">${resumen[cat] || 0}</span>
        <span class="tu-hist-pill__lbl">${esc(m.label)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

/** Calendario mensual del colaborador (pantalla 2). */
function _renderCalendarioEmpleado() {
  const cal = _s.cal;
  const mesLabel = (() => {
    const d = new Date(`${cal.ancla}T12:00:00`);
    const s = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();
  const { semanas } = matrizCalendarioMes(cal.ancla);
  const porFecha = cal.data?.porFecha || {};
  const dows = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
  const hoyIso = hoy();

  const celdas = semanas.map(sem => `<div class="tu-cal-row">
    ${sem.map(d => {
      const est = porFecha[d.fecha];
      const m = est ? (CAT_META[est.cat] || {}) : {};
      const esHoy = d.fecha === hoyIso;
      const pintable = est && est.cat !== 'futuro' && !d.fuera;
      return `<button type="button" class="tu-cal-cell${d.fuera ? ' tu-cal-cell--out' : ''}${esHoy ? ' tu-cal-cell--today' : ''}"
        data-cal-fecha="${esc(d.fecha)}"
        style="${pintable ? `--cellbg:${m.color}1a;--cellbar:${m.color}` : ''}">
        <span class="tu-cal-num">${d.dia}</span>
        ${pintable ? `<span class="tu-cal-tag" style="color:${m.color}">${esc(m.label)}</span>` : ''}
      </button>`;
    }).join('')}
  </div>`).join('');

  return `<div class="tu-cal">
    <div class="tu-cal-nav">
      <button class="tu-btn tu-btn--icon" id="tuCalPrev" type="button"><span class="material-symbols-outlined">chevron_left</span></button>
      <span class="tu-cal-month">${esc(mesLabel)}</span>
      <button class="tu-btn tu-btn--icon" id="tuCalNext" type="button"><span class="material-symbols-outlined">chevron_right</span></button>
    </div>
    <div class="tu-cal-grid">
      <div class="tu-cal-row tu-cal-row--head">${dows.map(d => `<span class="tu-cal-dow">${d}</span>`).join('')}</div>
      ${cal.loading ? `<div class="tu-loading"><div class="tu-spinner"></div><span>Cargando…</span></div>` : celdas}
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
let _unsubRO = null;
let _ticker  = null;

// ── Lifecycle ─────────────────────────────────────────────────
export async function mount({ container }) {
  unmount();
  _ctr = container;
  _ensureCss();

  if (typeof window.mexPerms?.canDo === 'function' && !window.mexPerms.canDo('view_turnos')) {
    _ctr.innerHTML = `<div class="tu-empty-state">
      <span class="material-symbols-outlined">lock</span>
      <p>No tienes permiso para ver turnos y horarios.</p>
    </div>`;
    return;
  }

  const gs      = getState();
  const role    = String(gs.role || 'AUXILIAR').toUpperCase();
  const plaza   = String(getCurrentPlaza() || gs.profile?.plazaAsignada || '').toUpperCase().trim();
  const profile = gs.profile || {};
  const uid     = window._auth?.currentUser?.uid || profile.uid || profile.id || '';

  _s = {
    role, plaza, profile, uid,
    isAdmin: !!(window.mexPerms?.canDo?.('manage_turnos')),
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
    rolesOperativos: [],
    showGestionRoles: false,
    expandSinHorario: {},
    // Tablero de Asistencia (heatmap mensual — pantalla 1)
    asis: {
      ancla: _mesAncla(),
      plaza,
      plazasDisponibles: [],
      loading: false,
      error: null,
      data: null,
      selUid: '',
      catFiltro: new Set(),
      panelOpen: true,
    },
    // Calendario historial por empleado (pantalla 2)
    cal: {
      ancla: _mesAncla(),
      data: null,
      loading: false,
    },
    // Filtros de historial extendidos (pantalla 3)
    historialPlaza: '',
    historialPuesto: '',
    // Auditoría de personal (historial de cambios — pantalla 4)
    aud: {
      loading: false,
      rows: [],
      cargado: false,
      q: '',
      tipo: '',
      desde: '',
      hasta: '',
      expand: {},
    },
    showHistStats: false,
  };

  _render();
  _startListeners();
  void _loadUsuarios();

  _offs.push(onPlazaChange(next => {
    if (!_s) return;
    _s.plaza = String(next || '').toUpperCase().trim();
    // Resetear tablero/calendario a la nueva plaza (si no está en modo "Todas").
    if (_s.asis && _s.asis.plaza !== 'TODAS') {
      _s.asis.plaza = _s.plaza;
      _s.asis.data = null;
      _s.asis.selUid = '';
      _s.asis.plazasDisponibles = [];
    }
    if (_s.cal) _s.cal.data = null;
    _stopListeners();
    _render();
    _startListeners();
    void _loadUsuarios();
    if (_s.tab === 'asistencia') void _loadTablero();
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
  [_unsubTA, _unsubH, _unsubAs, _unsubP, _unsubNS, _unsubRO].forEach(fn => { if (fn) try { fn(); } catch (_) {} });
  _unsubTA = _unsubH = _unsubAs = _unsubP = _unsubNS = _unsubRO = null;
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

  // Roles operativos custom (por plaza)
  if (_unsubRO) { try { _unsubRO(); } catch (_) {} }
  _unsubRO = onRolesOperativos(plaza, (filas, err) => {
    if (!_s) return;
    _s.rolesOperativos = filas || [];
    if (err) _s.listenerErrors.roles = err;
    else delete _s.listenerErrors.roles;
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
    // El tablero (pantalla 1) carga su propio rango; no repintar aquí para
    // evitar flicker. Solo repinta si alguna vista legacy lo necesitara.
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
      { key: 'auditoria',  label: 'Cambios',         icon: 'manage_history' },
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
    case 'auditoria':  return _renderAuditoria();
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
  const {
    semana, horarios, usuarios, isAdmin, usuariosLoading, uid, plantillas,
    notasSemana, showGestionPlantillas, showGestionRoles, rolesOperativos,
    profile, expandSinHorario,
  } = _s;

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

  const roleSelectHtml = (u) => {
    if (!isAdmin || !rolesOperativos.length) return '';
    const realUid = normalizeUsuarioUid(u);
    const current = rolOperativoDeUsuario(realUid, rolesOperativos);
    const opts = [
      `<option value="">Sin asignar</option>`,
      ...rolesOperativos.map(r =>
        `<option value="${esc(r.id)}"${r.id === current ? ' selected' : ''}>${esc(r.nombre)}</option>`
      ),
    ].join('');
    return `<select class="tu-role-assign" data-assign-uid="${esc(realUid)}" title="Rol operativo" aria-label="Rol operativo">
      ${opts}
    </select>`;
  };

  const renderUserRow = (u) => {
    const realUid = normalizeUsuarioUid(u);
    const horario = horarios.find(h => h.usuarioId === realUid);
    const esYo    = realUid === uid;
    return `<tr class="tu-grid-row${esYo ? ' tu-grid-row--own' : ''}">
      <td class="tu-grid-td-name">
        <span class="tu-grid-avatar">${initialUsuario(u)}</span>
        <div class="tu-grid-uname-wrap">
          <span class="tu-grid-uname">${esc(nombreUsuario(u))}</span>
          ${roleSelectHtml(u)}
        </div>
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
  };

  // Filas de usuarios agrupadas por rol operativo
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
      const sections = agruparPorRolOperativo(lista, rolesOperativos, horarios, { compactEmpty: true });
      for (const sec of sections) {
        const totalSec = sec.conHorario.length + sec.sinHorario.length;
        if (sec.esSinAsignar && totalSec === 0) continue;
        if (!sec.esPlano && sec.nombre) {
          filas += `<tr class="tu-role-head${sec.esSinAsignar ? ' tu-role-head--muted' : ''}" data-role-id="${esc(sec.id)}">
            <td colspan="8">
              <span class="tu-role-head-label">${esc(sec.nombre)}</span>
              <span class="tu-role-head-count">${totalSec}</span>
            </td>
          </tr>`;
        }
        for (const u of sec.conHorario) filas += renderUserRow(u);

        if (sec.sinHorario.length) {
          const expanded = !!expandSinHorario?.[sec.id];
          filas += `<tr class="tu-role-empty-toggle">
            <td colspan="8">
              <button type="button" class="tu-role-empty-btn" data-toggle-empty="${esc(sec.id)}">
                <span class="material-symbols-outlined">${expanded ? 'expand_less' : 'expand_more'}</span>
                Sin horario esta semana (${sec.sinHorario.length})
              </button>
            </td>
          </tr>`;
          if (expanded) {
            for (const u of sec.sinHorario) {
              filas += renderUserRow(u).replace('tu-grid-row', 'tu-grid-row tu-grid-row--compact');
            }
          }
        }
      }
      if (!filas) {
        filas = `<tr><td colspan="8" class="tu-grid-empty">Sin colaboradores para mostrar.</td></tr>`;
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

  // Panel roles operativos (custom por plaza — vault TURNOS)
  const rolesPanel = showGestionRoles ? `
<div class="tu-roles-panel" id="tuRolesPanel">
  <div class="tu-plantillas-panel-head">
    <span class="material-symbols-outlined">group_work</span>
    <h3>Roles operativos</h3>
    <button class="tu-btn tu-btn--icon" id="tuCerrarRoles" type="button">
      <span class="material-symbols-outlined">close</span>
    </button>
  </div>
  <p class="tu-roles-hint">Filas personalizables de esta plaza (CAPACITACIÓN, AEROPUERTO…). No son roles del sistema.</p>
  <div class="tu-roles-list">
    ${rolesOperativos.length === 0
      ? '<p class="tu-empty" style="padding:8px 0;">Sin roles. Crea el primero para dividir el grid.</p>'
      : rolesOperativos.map((r, i) => `
        <div class="tu-role-item" data-role-row="${esc(r.id)}">
          <input class="tu-input tu-role-name-input" type="text" value="${esc(r.nombre)}" data-rename-role="${esc(r.id)}" maxlength="40">
          <span class="tu-role-item-count">${(r.usuarioIds || []).length}</span>
          <button class="tu-btn tu-btn--icon tu-btn--sm" type="button" data-role-up="${esc(r.id)}" ${i === 0 ? 'disabled' : ''} title="Subir">
            <span class="material-symbols-outlined">arrow_upward</span>
          </button>
          <button class="tu-btn tu-btn--icon tu-btn--sm" type="button" data-role-down="${esc(r.id)}" ${i === rolesOperativos.length - 1 ? 'disabled' : ''} title="Bajar">
            <span class="material-symbols-outlined">arrow_downward</span>
          </button>
          <button class="tu-btn tu-btn--sm tu-btn--red" type="button" data-del-role="${esc(r.id)}" title="Eliminar">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>`).join('')}
  </div>
  <div class="tu-roles-form">
    <input class="tu-input" type="text" id="tuRolNombre" placeholder="Nombre (ej: AEROPUERTO)" maxlength="40">
    <button class="tu-btn tu-btn--primary" id="tuCrearRol" type="button">
      <span class="material-symbols-outlined">add</span> Agregar rol
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
    <button class="tu-btn tu-btn--ghost" id="tuGestionRoles" type="button">
      <span class="material-symbols-outlined">group_work</span> Roles
    </button>
    <button class="tu-btn tu-btn--ghost" id="tuGestionPlantillas" type="button">
      <span class="material-symbols-outlined">schedule</span> Catálogo
    </button>` : ''}
    <button class="tu-btn tu-btn--ghost" id="tuExportar" type="button">
      <span class="material-symbols-outlined">picture_as_pdf</span> Exportar PDF
    </button>
  </div>
  ${rolesPanel}
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

// ── Tab Asistencia (Tablero mensual — pantalla 1) ─────────────
function _renderAsistencia() {
  if (!_s.asis.plazasDisponibles?.length) {
    _s.asis.plazasDisponibles = _plazasDisponibles();
  }
  return `
<div class="tu-asis-board">
  <div class="tu-asis-headline">
    <div>
      <h2 class="tu-asis-title">Tablero de Asistencia</h2>
      <p class="tu-asis-sub">Asistencia en tiempo real · ${esc(_s.asis.plaza === 'TODAS' ? 'Todas las plazas' : (_s.asis.plaza || _s.plaza || ''))}</p>
    </div>
  </div>
  ${tableroToolbarHtml(_s.asis)}
  <div class="tu-asis-bodywrap" id="tuAsisBody">${tableroBodyHtml(_s.asis)}</div>
</div>
${_marcarDiaModalHtml()}`;
}

function _marcarDiaModalHtml() {
  return `
<div class="tu-nota-modal" id="tuMarcarModal" style="display:none">
  <div class="tu-nota-modal-inner">
    <div class="tu-editor-head">
      <span id="tuMarcarTitle">Marcar día</span>
      <button class="tu-btn tu-btn--icon" id="tuMarcarClose" type="button">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <input type="hidden" id="tuMarcarUid">
    <input type="hidden" id="tuMarcarFecha">
    <input type="hidden" id="tuMarcarNombre">
    <input type="hidden" id="tuMarcarPlaza">
    <label class="tu-label">Estado del día</label>
    <div class="tu-tipo-btns" id="tuMarcarTipos">
      ${Object.entries(TIPOS_NOTA).map(([k, v]) => {
        const cat = _catDeTipoMarca(k);
        const color = CAT_META[cat]?.color || '#94a3b8';
        return `<button class="tu-tipo-btn" type="button" data-marca="${k}"
                 style="border-color:${color}55;color:${color}">${esc(v.label)}</button>`;
      }).join('')}
    </div>
    <label class="tu-label" style="margin-top:8px;">Nota (opcional)</label>
    <input class="tu-input" type="text" id="tuMarcarNota" placeholder="Motivo o detalle…">
    <div class="tu-hist-filters__actions" style="margin-top:10px;">
      <button class="tu-btn tu-btn--ghost" id="tuMarcarBorrar" type="button">Quitar marca</button>
      <button class="tu-btn tu-btn--primary" id="tuMarcarGuardar" type="button">
        <span class="material-symbols-outlined">save</span> Guardar
      </button>
    </div>
  </div>
</div>`;
}

function _catDeTipoMarca(tipo) {
  const map = {
    presente: 'asistencia', retardo: 'retardo', falta: 'falta',
    permiso: 'permiso', justificacion: 'permiso', vacaciones: 'permiso',
    festivo: 'descanso', descanso: 'descanso', nota: 'sinasignar',
  };
  return map[tipo] || 'sinasignar';
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
  const resumen = _s.cal?.data?.resumen || null;

  return `
<div class="tu-historial">
  ${filtros}
  ${_renderHistorialSubject(usuario, resumen)}
  ${_s.showHistStats ? _renderHistStatsBar(resumen) : ''}
  ${_renderCalendarioEmpleado()}
</div>
${_marcarDiaModalHtml()}`;
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
    case 'auditoria':  _bindAuditoria();  break;
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

  // Expandir filas sin horario
  _ctr?.querySelectorAll('[data-toggle-empty]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_s) return;
      const id = btn.dataset.toggleEmpty;
      _s.expandSinHorario = {
        ...(_s.expandSinHorario || {}),
        [id]: !_s.expandSinHorario?.[id],
      };
      _repaintTab();
    });
  });

  // Gestionar roles operativos
  _ctr?.querySelector('#tuGestionRoles')?.addEventListener('click', () => {
    if (!_s) return;
    _s.showGestionRoles = !_s.showGestionRoles;
    if (_s.showGestionRoles) _s.showGestionPlantillas = false;
    _repaintTab();
  });
  _ctr?.querySelector('#tuCerrarRoles')?.addEventListener('click', () => {
    if (!_s) return;
    _s.showGestionRoles = false;
    _repaintTab();
  });
  _ctr?.querySelector('#tuCrearRol')?.addEventListener('click', async () => {
    const inp = _ctr?.querySelector('#tuRolNombre');
    const nombre = inp?.value?.trim();
    if (!nombre || !_s?.plaza) return;
    const btn = _ctr.querySelector('#tuCrearRol');
    if (btn) btn.disabled = true;
    try {
      await crearRolOperativo(_s.plaza, nombre);
      if (inp) inp.value = '';
    } catch (e) {
      console.warn('[turnos] crearRol:', e);
      _toast(e?.message || 'No se pudo crear el rol.', 'Error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  _ctr?.querySelectorAll('[data-rename-role]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const id = inp.dataset.renameRole;
      const nombre = inp.value.trim();
      if (!id || !nombre || !_s?.plaza) return;
      try {
        await renombrarRolOperativo(_s.plaza, id, nombre);
      } catch (e) {
        console.warn('[turnos] renameRol:', e);
        _toast(e?.message || 'No se pudo renombrar.', 'Error');
        _repaintTab();
      }
    });
  });
  _ctr?.querySelectorAll('[data-del-role]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delRole;
      if (!id || !_s?.plaza) return;
      const ok = typeof window.mexConfirm === 'function'
        ? await window.mexConfirm('Eliminar rol', '¿Eliminar este rol? Los colaboradores pasan a Sin asignar.', 'warning')
        : false;
      if (!ok) return;
      btn.disabled = true;
      try {
        await eliminarRolOperativo(_s.plaza, id);
      } catch (e) {
        console.warn('[turnos] delRol:', e);
        _toast(e?.message || 'No se pudo eliminar.', 'Error');
        btn.disabled = false;
      }
    });
  });
  _ctr?.querySelectorAll('[data-role-up]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_s?.plaza) return;
      try { await reordenarRolOperativo(_s.plaza, btn.dataset.roleUp, -1); }
      catch (e) { console.warn('[turnos] roleUp:', e); }
    });
  });
  _ctr?.querySelectorAll('[data-role-down]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_s?.plaza) return;
      try { await reordenarRolOperativo(_s.plaza, btn.dataset.roleDown, 1); }
      catch (e) { console.warn('[turnos] roleDown:', e); }
    });
  });
  _ctr?.querySelectorAll('.tu-role-assign').forEach(sel => {
    sel.addEventListener('change', async () => {
      const uid = sel.dataset.assignUid;
      if (!uid || !_s?.plaza) return;
      sel.disabled = true;
      try {
        await asignarUsuarioARol(_s.plaza, uid, sel.value || null);
      } catch (e) {
        console.warn('[turnos] assignRol:', e);
        _toast(e?.message || 'No se pudo asignar.', 'Error');
        _repaintTab();
      } finally {
        sel.disabled = false;
      }
    });
  });

  // Gestionar plantillas (toggle panel)
  _ctr?.querySelector('#tuGestionPlantillas')?.addEventListener('click', () => {
    if (!_s) return;
    _s.showGestionPlantillas = !_s.showGestionPlantillas;
    if (_s.showGestionPlantillas) _s.showGestionRoles = false;
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
          void registrarHechoTurno({
            hecho: 'CAMBIO_HORARIO', plaza: _s.plaza, empleado: nombre, empleadoUid: uid,
            fecha: fechaDia(_s.semana, diaKey),
            nota: cell?.tipo === 'NORMAL' ? `${cell.inicio}–${cell.fin}` : (cell?.tipo || 'Sin turno'),
            detalle: { dia: diaKey, semana: _s.semana },
          });
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
      void registrarHechoTurno({
        hecho: 'CAMBIO_HORARIO', plaza, empleado: editDia.nombre, empleadoUid: editDia.uid,
        fecha: fechaDia(semana, editDia.diaKey), nota: 'Turno eliminado',
        detalle: { dia: editDia.diaKey, semana },
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
      void registrarHechoTurno({
        hecho: 'CAMBIO_HORARIO', plaza, empleado: editDia.nombre, empleadoUid: editDia.uid,
        fecha: fechaDia(semana, editDia.diaKey),
        nota: cellData?.tipo === 'NORMAL' ? `${cellData.inicio}–${cellData.fin}` : (cellData?.tipo || ''),
        detalle: { dia: editDia.diaKey, semana },
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

function _repaintAsisBody() {
  const body = _ctr?.querySelector('#tuAsisBody');
  if (body && _s) {
    body.innerHTML = tableroBodyHtml(_s.asis);
    _bindAsisBody();
  }
}

function _repaintAsisToolbar() {
  // Repinta leyenda (para reflejar filtros activos) sin recargar datos.
  const board = _ctr?.querySelector('.tu-asis-board');
  if (!board || !_s) return;
  _repaintTab();
}

async function _loadTablero() {
  if (!_s) return;
  const a = _s.asis;
  const plaza = a.plaza || _s.plaza;
  if (!plaza) return;
  const { desde, hasta } = _mesRango(a.ancla);
  a.loading = true;
  a.error = null;
  _repaintAsisBody();
  try {
    const [usuarios, turnos, asistencia, notas, horarios] = await Promise.all([
      getUsuariosPlaza(plaza),
      getTurnosRango(plaza, desde, hasta),
      getAsistenciaRango(plaza, desde, hasta),
      getNotasRango(plaza, desde, hasta),
      getHorariosRango(plaza, desde, hasta),
    ]);
    if (!_s) return;
    const lista = plaza === 'TODAS'
      ? usuarios
      : resolveUsuariosLista(usuarios, { isAdmin: true, uid: _s.uid, profile: _s.profile });
    a.data = tableroMes({
      usuarios: lista, turnos, asistencia, notas, horarios,
      desde, hasta, hoyIso: hoy(),
    });
    if (!a.selUid && a.data.filas.length) a.selUid = a.data.filas[0].uid;
    a.loading = false;
    _repaintAsisBody();
  } catch (e) {
    console.warn('[turnos] tablero:', e);
    if (!_s) return;
    a.loading = false;
    a.error = { code: e?.code === 'INDEX_MISSING' ? 'INDEX_MISSING' : 'OTHER' };
    _repaintAsisBody();
  }
}

function _bindAsistencia() {
  if (!_s.asis.data && !_s.asis.loading) void _loadTablero();

  _ctr?.querySelector('#tuAsisPrev')?.addEventListener('click', () => {
    _s.asis.ancla = _moverMes(_s.asis.ancla, -1); _s.asis.data = null; _repaintTab(); void _loadTablero();
  });
  _ctr?.querySelector('#tuAsisNext')?.addEventListener('click', () => {
    _s.asis.ancla = _moverMes(_s.asis.ancla, 1); _s.asis.data = null; _repaintTab(); void _loadTablero();
  });
  _ctr?.querySelector('#tuAsisMonth')?.addEventListener('change', e => {
    const v = e.target.value; if (!v) return;
    _s.asis.ancla = `${v}-01`; _s.asis.data = null; _repaintTab(); void _loadTablero();
  });
  _ctr?.querySelector('#tuAsisPlaza')?.addEventListener('change', e => {
    _s.asis.plaza = e.target.value; _s.asis.data = null; _s.asis.selUid = ''; _repaintTab(); void _loadTablero();
  });
  _ctr?.querySelector('#tuAsisReload')?.addEventListener('click', () => {
    _s.asis.data = null; void _loadTablero();
  });
  _ctr?.querySelector('#tuAsisPanel')?.addEventListener('click', () => {
    _s.asis.panelOpen = !_s.asis.panelOpen; _repaintAsisBody();
  });
  _ctr?.querySelector('#tuAsisPdf')?.addEventListener('click', _exportarTablero);

  _bindAsisBody();
  _bindMarcarModal();
}

function _bindAsisBody() {
  // Filtro por leyenda
  _ctr?.querySelectorAll('#tuAsisLegend [data-leg]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.leg;
      const set = _s.asis.catFiltro;
      if (set.has(cat)) set.delete(cat); else set.add(cat);
      _repaintTab();
    });
  });
  // Seleccionar fila (spotlight)
  _ctr?.querySelectorAll('.tu-hm-row').forEach(row => {
    row.querySelector('.tu-hm-emp')?.addEventListener('click', () => {
      _s.asis.selUid = row.dataset.rowUid || '';
      _repaintAsisBody();
    });
  });
  // Marcar día (click en celda)
  _ctr?.querySelectorAll('.tu-hm-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const uid = cell.dataset.uid;
      const fecha = cell.dataset.fecha;
      const fila = _s.asis.data?.filas.find(f => f.uid === uid);
      _openMarcarModal(uid, fecha, fila ? fila.nombre : '');
    });
  });
  // Ver historial completo → tab historial preseleccionando usuario
  _ctr?.querySelector('#tuAsisVerHist')?.addEventListener('click', (e) => {
    const uid = e.currentTarget.dataset.uid || _s.asis.selUid;
    _s.historialUsuarioId = uid;
    _s.historialMostrado = true;
    _s.tab = 'historial';
    _ctr.querySelectorAll('.tu-tab').forEach(b => b.classList.toggle('tu-tab--active', b.dataset.tab === 'historial'));
    _repaintTab();
    void _loadHistorialUsuario();
  });
}

function _openMarcarModal(uid, fecha, nombre, plaza) {
  if (!_s?.isAdmin) return;
  const modal = _ctr?.querySelector('#tuMarcarModal');
  if (!modal || !uid || !fecha) return;
  _ctr.querySelector('#tuMarcarUid').value = uid;
  _ctr.querySelector('#tuMarcarFecha').value = fecha;
  _ctr.querySelector('#tuMarcarNombre').value = nombre || '';
  const p = String(plaza || (_s.asis?.plaza === 'TODAS' ? _s.plaza : (_s.asis?.plaza || _s.plaza)) || '').toUpperCase();
  _ctr.querySelector('#tuMarcarPlaza').value = p;
  _ctr.querySelector('#tuMarcarTitle').textContent = `${nombre || 'Colaborador'} — ${fecha}`;
  _ctr.querySelector('#tuMarcarNota').value = '';
  modal.querySelectorAll('.tu-tipo-btn').forEach(b => b.classList.remove('tu-tipo-btn--active'));
  modal.style.display = '';
}

function _bindMarcarModal() {
  const modal = _ctr?.querySelector('#tuMarcarModal');
  if (!modal) return;
  modal.querySelector('#tuMarcarClose')?.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.querySelectorAll('.tu-tipo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.tu-tipo-btn').forEach(b => b.classList.remove('tu-tipo-btn--active'));
      btn.classList.add('tu-tipo-btn--active');
    });
  });
  modal.querySelector('#tuMarcarGuardar')?.addEventListener('click', async () => {
    const uid = _ctr.querySelector('#tuMarcarUid').value;
    const fecha = _ctr.querySelector('#tuMarcarFecha').value;
    const nombre = _ctr.querySelector('#tuMarcarNombre').value;
    const nota = _ctr.querySelector('#tuMarcarNota').value.trim();
    const tipo = modal.querySelector('.tu-tipo-btn--active')?.dataset.marca;
    if (!tipo) { _toast('Elige un estado para el día.', 'Marcar'); return; }
    const plaza = _ctr.querySelector('#tuMarcarPlaza').value || _s.plaza;
    const btn = modal.querySelector('#tuMarcarGuardar');
    if (btn) btn.disabled = true;
    try {
      await guardarNotaAsistencia({ plaza, usuarioId: uid, usuarioNombre: nombre, fecha, tipo, nota });
      modal.style.display = 'none';
      _afterMarcarDia();
    } catch (e) {
      console.warn('[turnos] marcarDia:', e);
      _toast(e?.message || 'No se pudo guardar.', 'Error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  modal.querySelector('#tuMarcarBorrar')?.addEventListener('click', async () => {
    const uid = _ctr.querySelector('#tuMarcarUid').value;
    const fecha = _ctr.querySelector('#tuMarcarFecha').value;
    const nombre = _ctr.querySelector('#tuMarcarNombre').value;
    const plaza = _ctr.querySelector('#tuMarcarPlaza').value || _s.plaza;
    if (!uid || !fecha) return;
    try {
      await eliminarNotaAsistencia(plaza, fecha, uid, { usuarioNombre: nombre });
      modal.style.display = 'none';
      _afterMarcarDia();
    } catch (e) {
      console.warn('[turnos] borrarMarca:', e);
      _toast(e?.message || 'No se pudo quitar.', 'Error');
    }
  });
}

/** Refresca la vista activa tras marcar/borrar un día. */
function _afterMarcarDia() {
  if (!_s) return;
  if (_s.tab === 'asistencia') { _s.asis.data = null; void _loadTablero(); }
  else if (_s.tab === 'historial') { void _loadCalendario(); }
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
  const { semana, horarios, usuarios, notasSemana, isAdmin, uid, profile, plaza, plantillas, rolesOperativos } = _s;
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

  const renderExportUser = (u) => {
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
  };

  const sections = agruparPorRolOperativo(lista, rolesOperativos || [], horarios, { compactEmpty: true });
  let rows = '';
  for (const sec of sections) {
    if (!sec.conHorario.length) continue; // export compacto: sin filas vacías
    if (!sec.esPlano && sec.nombre) {
      rows += `<tr class="role"><td colspan="8">${esc(sec.nombre)}</td></tr>`;
    }
    for (const u of sec.conHorario) rows += renderExportUser(u);
  }

  if (!rows) {
    _toast('No hay horarios asignados para exportar.', 'Exportar');
    return;
  }

  const totalHoras = (totalMin / 60).toFixed(1);
  const rangoLabel = `Semana del ${fmt(semana)} al ${fmt(finDisp.toISOString().slice(0, 10))}`;
  const titulo = `Distribución de turnos${plaza ? ` — ${plaza}` : ''}`;
  const cab = _exportCabeceraEmpresa();
  const id = getExportIdentity();
  const firma = exportFooterHtml({ escapeHtml: esc });
  const fileTitle = buildExportFilename('pdf').replace(/\.pdf$/i, '');

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>${esc(fileTitle)}</title>
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
  tr.role td{background:#0f172a;color:#fff;font-weight:700;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;text-align:left;padding:5px 8px}
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
<div class="sub"><span>${esc(rangoLabel)}</span><span>Total semana: ${esc(totalHoras)} h · ${esc(id.companyName)}</span></div>
<table>
  <thead><tr><th class="emp">Colaborador</th>${thDias}</tr></thead>
  <tbody>${rows}</tbody>
</table>
${firma}
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

function _exportarTablero() {
  if (!_s?.asis?.data) { _toast('Aún no hay datos del tablero.', 'Exportar'); return; }
  const a = _s.asis;
  const { data, ancla } = a;
  const plaza = a.plaza === 'TODAS' ? 'Todas las plazas' : (a.plaza || _s.plaza || '');
  const mesLabel = (() => {
    const d = new Date(`${ancla}T12:00:00`);
    const s = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();

  const thDias = data.dias.map(d =>
    `<th class="${d.esFinde ? 'we' : ''}">${esc(d.diaSemana)}<br><small>${d.dia}</small></th>`
  ).join('');

  const rows = data.filas.map(f => {
    const celdas = f.celdas.map(c => {
      if (c.cat === 'futuro') return '<td></td>';
      const m = CAT_META[c.cat] || {};
      const ini = (m.label || '?').charAt(0);
      return `<td style="background:${m.color};color:#fff" title="${esc(c.label)}">${esc(ini)}</td>`;
    }).join('');
    const r = f.resumen;
    return `<tr><td class="emp">${esc(f.nombre)}</td>${celdas}
      <td class="tot">${r.asistencia}/${r.retardo}/${r.falta}/${r.permiso}</td></tr>`;
  }).join('');

  const leyenda = CAT_ORDEN.map(cat => {
    const m = CAT_META[cat];
    return `<span class="lg"><span class="dot" style="background:${m.color}"></span>${esc(m.label)}</span>`;
  }).join('');

  const cab = _exportCabeceraEmpresa();
  const firma = exportFooterHtml({ escapeHtml: esc });
  const id = getExportIdentity();
  const fileTitle = buildExportFilename('pdf').replace(/\.pdf$/i, '');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>${esc(fileTitle)}</title>
<style>
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font:11px Inter,system-ui,sans-serif;margin:20px;color:#0f172a}
  h1{font-size:16px;margin:0 0 2px}
  .sub{color:#64748b;font-size:11px;margin:0 0 10px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  table{border-collapse:collapse;width:100%;table-layout:fixed}
  th,td{border:1px solid #cbd5e1;padding:3px 2px;text-align:center;font-size:9px}
  th{background:#f1f5f9;text-transform:uppercase}
  td.emp,th.emp{text-align:left;white-space:nowrap;font-weight:600;background:#f8fafc;width:130px;font-size:10px}
  td.tot{font-weight:700;background:#f8fafc;white-space:nowrap}
  .we{background:#e2e8f0}
  .legend{margin:10px 0;display:flex;gap:14px;flex-wrap:wrap;font-size:10px}
  .lg{display:inline-flex;align-items:center;gap:5px}
  .dot{width:10px;height:10px;border-radius:3px;display:inline-block}
  .rpt-cab{display:flex;align-items:center;gap:14px;border-bottom:2px solid #0f172a;padding-bottom:10px;margin:0 0 12px}
  .rpt-logo{height:44px;width:auto;object-fit:contain}
  .rpt-empresa{display:flex;flex-direction:column}
  .rpt-empresa strong{font-size:13px}.rpt-empresa span{font-size:10px;color:#64748b}
  .btn-print{padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;margin-top:14px}
  @page{size:landscape;margin:10mm}@media print{body{margin:0}.no-print{display:none}}
</style></head><body>
${cab}
<h1>Tablero de asistencia — ${esc(plaza)}</h1>
<div class="sub"><span>${esc(mesLabel)}</span><span>${esc(id.companyName)}</span></div>
<div class="legend">${leyenda}</div>
<table><thead><tr><th class="emp">Empleado</th>${thDias}<th class="tot">A/R/F/P</th></tr></thead>
<tbody>${rows}</tbody></table>
${firma}
<div class="no-print"><button class="btn-print" type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { _toast('Permite ventanas emergentes para exportar.', 'Exportar'); return; }
  win.document.write(html); win.document.close();
}

function _bindHistorial() {
  _ctr?.querySelector('#tuHistSemana')?.addEventListener('click', () => {
    if (!_s) return;
    _s.historialDesde = _isoHaceDias(7);
    _s.historialHasta = hoy();
    _repaintTab();
  });

  _ctr?.querySelector('#tuHistReset')?.addEventListener('click', () => {
    if (!_s) return;
    _s.historialPlaza = '';
    _s.historialPuesto = '';
    _s.historialUsuarioId = '';
    _s.historialDesde = _isoHaceDias(30);
    _s.historialHasta = hoy();
    _s.historialMostrado = false;
    _s.cal.data = null;
    // Recargar usuarios de la plaza base
    void _reloadHistUsuarios(_s.plaza);
    _repaintTab();
  });

  _ctr?.querySelector('#tuHistPlaza')?.addEventListener('change', e => {
    if (!_s) return;
    _s.historialPlaza = String(e.target.value || '').toUpperCase().trim();
    _s.historialUsuarioId = '';
    void _reloadHistUsuarios(_s.historialPlaza || _s.plaza);
  });

  _ctr?.querySelector('#tuHistPuesto')?.addEventListener('change', e => {
    if (!_s) return;
    _s.historialPuesto = String(e.target.value || '').trim();
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
      _toast('Selecciona un empleado.', 'Historial');
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
    _s.cal.ancla = _mesAncla(new Date(`${_s.historialHasta}T12:00:00`));
    const wrap = _ctr?.querySelector('#tuHistFilters');
    if (wrap) wrap.open = false;
    void _loadHistorialUsuario();
  });

  // Cabecera del empleado
  _ctr?.querySelector('#tuHistStats')?.addEventListener('click', () => {
    if (!_s) return;
    _s.showHistStats = !_s.showHistStats;
    _repaintTab();
  });
  _ctr?.querySelector('#tuHistPdf')?.addEventListener('click', _exportarHistorialEmpleado);
  _ctr?.querySelector('#tuHistNota')?.addEventListener('click', (e) => {
    const uid = e.currentTarget.dataset.uid;
    const nombre = e.currentTarget.dataset.nombre;
    _openMarcarModal(uid, hoy(), nombre, _s.historialPlaza || _s.plaza);
  });

  // Navegación del calendario
  _ctr?.querySelector('#tuCalPrev')?.addEventListener('click', () => {
    if (!_s) return;
    _s.cal.ancla = _moverMes(_s.cal.ancla, -1);
    void _loadCalendario();
  });
  _ctr?.querySelector('#tuCalNext')?.addEventListener('click', () => {
    if (!_s) return;
    _s.cal.ancla = _moverMes(_s.cal.ancla, 1);
    void _loadCalendario();
  });
  // Click en día → marcar (solo admin)
  _ctr?.querySelectorAll('.tu-cal-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      if (!_s?.isAdmin) return;
      const fecha = cell.dataset.calFecha;
      const uid = _s.isAdmin ? _s.historialUsuarioId : _s.uid;
      if (!uid) return;
      const u = _usuarioHistorial(uid);
      _openMarcarModal(uid, fecha, u ? nombreUsuario(u) : '', _s.historialPlaza || _s.plaza);
    });
  });

  _bindMarcarModal();
}

/** Recarga la lista de colaboradores para el filtro de historial. */
async function _reloadHistUsuarios(plaza) {
  if (!_s) return;
  const p = String(plaza || _s.plaza || '').toUpperCase().trim();
  _s.usuariosLoading = true;
  _repaintTab();
  try {
    _s.usuarios = await getUsuariosPlaza(p);
  } catch (e) {
    console.warn('[turnos] reloadHistUsuarios:', e);
    _s.usuarios = [];
  }
  _s.usuariosLoading = false;
  _repaintTab();
}

// ── Tab Auditoría (Historial de cambios — pantalla 4) ─────────
function _hechoColor(hecho) {
  const h = String(hecho || '').toUpperCase();
  if (['FALTA', 'AUSENTE', 'NOTA_ELIMINADA'].includes(h)) return '#ef4444';
  if (['TARDE', 'RETARDO'].includes(h)) return '#f59e0b';
  if (['PRESENTE', 'TURNO_INICIO'].includes(h)) return '#10b981';
  if (['PERMISO', 'JUSTIFICADO', 'VACACIONES'].includes(h)) return '#3b82f6';
  if (['DESCANSO', 'FESTIVO'].includes(h)) return '#94a3b8';
  if (['CAMBIO_HORARIO'].includes(h)) return '#8b5cf6';
  return '#64748b';
}

function _fmtFechaHora(ms) {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return '—'; }
}

function _auditoriaFiltradas() {
  const a = _s.aud;
  const q = a.q.trim().toLowerCase();
  const tipo = a.tipo;
  const desde = a.desde ? new Date(`${a.desde}T00:00:00`).getTime() : 0;
  const hasta = a.hasta ? new Date(`${a.hasta}T23:59:59.999`).getTime() : Infinity;
  return a.rows.filter(r => {
    if (tipo && r.hecho !== tipo) return false;
    if (r.timestampMs < desde || r.timestampMs > hasta) return false;
    if (q) {
      const hay = `${r.empleado} ${r.responsable} ${r.nota}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function _renderAuditoria() {
  const a = _s.aud;
  const tiposPresentes = [...new Set(a.rows.map(r => r.hecho).filter(Boolean))];
  const tipoOpts = tiposPresentes.map(t =>
    `<option value="${esc(t)}"${a.tipo === t ? ' selected' : ''}>${esc(HECHO_LABEL[t] || t)}</option>`
  ).join('');

  const rows = _auditoriaFiltradas();

  let body;
  if (a.loading) {
    body = `<div class="tu-loading"><div class="tu-spinner"></div><span>Cargando bitácora…</span></div>`;
  } else if (!rows.length) {
    body = `<div class="tu-empty-state"><span class="material-symbols-outlined">fact_check</span>
      <p>${a.cargado ? 'Sin cambios registrados con estos filtros.' : 'Pulsa Actualizar para cargar la bitácora.'}</p></div>`;
  } else {
    body = `<div class="tu-aud-table">
      <div class="tu-aud-head">
        <span>Fecha</span><span>Tipo de hecho</span><span>Empleado</span><span>Responsable</span><span></span>
      </div>
      ${rows.map(r => {
        const open = !!a.expand[r.id];
        const color = _hechoColor(r.hecho);
        return `<div class="tu-aud-row" data-aud-id="${esc(r.id)}">
          <div class="tu-aud-main" data-aud-toggle="${esc(r.id)}">
            <span class="tu-aud-date">${esc(_fmtFechaHora(r.timestampMs))}</span>
            <span><span class="tu-aud-badge" style="--b:${color}">${esc(r.hechoLabel || HECHO_LABEL[r.hecho] || r.hecho || 'Hecho')}</span></span>
            <span class="tu-aud-emp">${esc(r.empleado || '—')}${r.fechaHecho ? `<small>${esc(r.fechaHecho)}</small>` : ''}</span>
            <span class="tu-aud-resp">${esc(r.responsable || '—')}</span>
            <span class="tu-aud-chev"><span class="material-symbols-outlined">${open ? 'expand_less' : 'expand_more'}</span></span>
          </div>
          ${open ? `<div class="tu-aud-detail">
            ${r.nota ? `<div><strong>Nota:</strong> ${esc(r.nota)}</div>` : ''}
            ${r.accion ? `<div><strong>Acción:</strong> ${esc(r.accion)}</div>` : ''}
            <div><strong>Tipo:</strong> ${esc(HECHO_LABEL[r.hecho] || r.hecho || '—')}</div>
            ${r.fechaHecho ? `<div><strong>Fecha del hecho:</strong> ${esc(r.fechaHecho)}</div>` : ''}
            ${r.plaza ? `<div><strong>Plaza:</strong> ${esc(r.plaza)}</div>` : ''}
            ${r.id_empleado ? `<div><strong>ID empleado:</strong> ${esc(r.id_empleado)}</div>` : ''}
            ${r.created_by ? `<div><strong>Registrado por (uid):</strong> ${esc(r.created_by)}</div>` : ''}
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  return `
<div class="tu-aud">
  <div class="tu-asis-headline">
    <div>
      <h2 class="tu-asis-title">Historial de cambios</h2>
      <p class="tu-asis-sub">Quién marca asistencias y edita horarios${rows.length ? ` · ${rows.length} registros` : ''}</p>
    </div>
    <div class="tu-asis-actions">
      <button class="tu-btn tu-btn--ghost" id="tuAudPdf" type="button"><span class="material-symbols-outlined">picture_as_pdf</span> Generar PDF</button>
      <button class="tu-btn tu-btn--ghost" id="tuAudReload" type="button"><span class="material-symbols-outlined">refresh</span> Actualizar</button>
    </div>
  </div>
  <div class="tu-aud-filters">
    <div class="tu-aud-search">
      <span class="material-symbols-outlined">search</span>
      <input class="tu-input" type="text" id="tuAudQ" placeholder="Buscar empleado o responsable…" value="${esc(a.q)}">
    </div>
    <select class="tu-input" id="tuAudTipo">
      <option value="">Todos los tipos</option>
      ${tipoOpts}
    </select>
    <input class="tu-input" type="date" id="tuAudDesde" value="${esc(a.desde)}" title="Desde">
    <input class="tu-input" type="date" id="tuAudHasta" value="${esc(a.hasta)}" title="Hasta">
  </div>
  ${body}
</div>`;
}

function _bindAuditoria() {
  if (!_s.aud.cargado && !_s.aud.loading) void _loadAuditoria();
  _ctr?.querySelector('#tuAudReload')?.addEventListener('click', () => void _loadAuditoria());
  _ctr?.querySelector('#tuAudPdf')?.addEventListener('click', _exportarAuditoria);
  _ctr?.querySelector('#tuAudQ')?.addEventListener('input', e => { _s.aud.q = e.target.value; _repaintAudBody(); });
  _ctr?.querySelector('#tuAudTipo')?.addEventListener('change', e => { _s.aud.tipo = e.target.value; _repaintAudBody(); });
  _ctr?.querySelector('#tuAudDesde')?.addEventListener('change', e => { _s.aud.desde = e.target.value; _repaintAudBody(); });
  _ctr?.querySelector('#tuAudHasta')?.addEventListener('change', e => { _s.aud.hasta = e.target.value; _repaintAudBody(); });
  _bindAudRows();
}

function _repaintAudBody() { _repaintTab(); }

function _bindAudRows() {
  _ctr?.querySelectorAll('[data-aud-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.audToggle;
      _s.aud.expand[id] = !_s.aud.expand[id];
      _repaintTab();
    });
  });
}

async function _loadAuditoria() {
  if (!_s) return;
  _s.aud.loading = true;
  _repaintTab();
  try {
    const rows = await getHistorialHechos({ plaza: _s.plaza, limit: 500 });
    if (!_s) return;
    _s.aud.rows = rows;
    _s.aud.cargado = true;
    _s.aud.loading = false;
    _repaintTab();
  } catch (e) {
    console.warn('[turnos] auditoria:', e);
    if (!_s) return;
    _s.aud.rows = [];
    _s.aud.cargado = true;
    _s.aud.loading = false;
    if (e?.code === 'INDEX_MISSING' || String(e?.message || '').includes('index')) {
      _toast('La bitácora requiere un índice de Firestore. Despliega firestore:indexes.', 'Índice requerido');
    }
    _repaintTab();
  }
}

function _exportarAuditoria() {
  const rows = _auditoriaFiltradas();
  if (!rows.length) { _toast('No hay registros para exportar.', 'Exportar'); return; }
  const cab = _exportCabeceraEmpresa();
  const firma = exportFooterHtml({ escapeHtml: esc });
  const id = getExportIdentity();
  const fileTitle = buildExportFilename('pdf').replace(/\.pdf$/i, '');

  const trs = rows.map(r => `<tr>
    <td>${esc(_fmtFechaHora(r.timestampMs))}</td>
    <td><span class="bg" style="background:${_hechoColor(r.hecho)}">${esc(r.hechoLabel || HECHO_LABEL[r.hecho] || r.hecho)}</span></td>
    <td>${esc(r.empleado || '—')}${r.fechaHecho ? `<br><small>${esc(r.fechaHecho)}</small>` : ''}</td>
    <td>${esc(r.responsable || '—')}</td>
    <td>${esc(r.nota || r.accion || '—')}</td>
  </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>${esc(fileTitle)}</title>
<style>
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font:11px Inter,system-ui,sans-serif;margin:22px;color:#0f172a}
  h1{font-size:16px;margin:0 0 2px}
  .sub{color:#64748b;font-size:11px;margin:0 0 12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;font-size:10px;vertical-align:top}
  th{background:#f1f5f9;text-transform:uppercase}
  .bg{color:#fff;padding:2px 8px;border-radius:9999px;font-size:9px;font-weight:700;white-space:nowrap}
  .rpt-cab{display:flex;align-items:center;gap:14px;border-bottom:2px solid #0f172a;padding-bottom:10px;margin:0 0 12px}
  .rpt-logo{height:44px}.rpt-empresa{display:flex;flex-direction:column}.rpt-empresa strong{font-size:13px}.rpt-empresa span{font-size:10px;color:#64748b}
  .btn-print{padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;margin-top:14px}
  @media print{body{margin:0}.no-print{display:none}}
</style></head><body>
${cab}
<h1>Historial de cambios de asistencia</h1>
<div class="sub"><span>${esc(_s.plaza || '')} · ${rows.length} registros</span><span>${esc(id.companyName)}</span></div>
<table><thead><tr><th>Fecha</th><th>Tipo de hecho</th><th>Empleado</th><th>Responsable</th><th>Detalle</th></tr></thead>
<tbody>${trs}</tbody></table>
${firma}
<div class="no-print"><button class="btn-print" type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { _toast('Permite ventanas emergentes para exportar.', 'Exportar'); return; }
  win.document.write(html); win.document.close();
}

// ── Historial loader (un colaborador → calendario) ────────────
async function _loadHistorialUsuario() {
  if (!_s) return;
  _s.historialCargado = true;
  await _loadCalendario();
}

/** Carga y deriva el calendario mensual del colaborador seleccionado. */
async function _loadCalendario() {
  if (!_s) return;
  const isAdmin = _s.isAdmin;
  const usuarioId = isAdmin ? _s.historialUsuarioId : _s.uid;
  if (!usuarioId) return;
  const plaza = String(_s.historialPlaza || _s.plaza || '').toUpperCase().trim();
  const { desde, hasta } = _mesRango(_s.cal.ancla);

  _s.cal.loading = true;
  _s.historialLoading = false;
  _repaintTab();

  try {
    const [turnos, asistencia, notas, horarios] = await Promise.all([
      getTurnosRango(plaza, desde, hasta, { usuarioId }),
      getAsistenciaRango(plaza, desde, hasta),
      getNotasColaborador(plaza, usuarioId, desde, hasta),
      getHorariosRango(plaza, desde, hasta),
    ]);
    if (!_s) return;
    delete _s.listenerErrors.historial;
    const asisU = (asistencia || []).filter(a => String(a.usuarioId || '') === usuarioId);
    const horU = (horarios || []).filter(h => String(h.usuarioId || '') === usuarioId);
    _s.cal.data = calendarioEmpleado({
      usuarioId, turnos, asistencia: asisU, notas, horarios: horU,
      desde, hasta, hoyIso: hoy(),
    });
    _s.cal.loading = false;
    _repaintTab();
  } catch (e) {
    console.warn('[turnos] calendario:', e);
    if (!_s) return;
    if (e?.code === 'INDEX_MISSING') {
      _s.listenerErrors.historial = { code: LISTENER_ERROR.INDEX_MISSING, source: 'historial' };
      _toast('Índice de historial pendiente. Despliega firestore:indexes.', 'Índice requerido');
    }
    _s.cal.data = null;
    _s.cal.loading = false;
    _repaintTab();
  }
}

/** Exporta el calendario del colaborador a PDF firmado. */
function _exportarHistorialEmpleado() {
  if (!_s?.cal?.data) { _toast('Primero muestra el historial.', 'Exportar'); return; }
  const uid = _s.isAdmin ? _s.historialUsuarioId : _s.uid;
  const usuario = _usuarioHistorial(uid);
  const nombre = usuario ? nombreUsuario(usuario) : 'Colaborador';
  const resumen = _s.cal.data.resumen;
  const { semanas } = matrizCalendarioMes(_s.cal.ancla);
  const porFecha = _s.cal.data.porFecha || {};
  const mesLabel = (() => {
    const d = new Date(`${_s.cal.ancla}T12:00:00`);
    const s = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();

  const dows = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
  const filas = semanas.map(sem => `<tr>${sem.map(d => {
    const est = porFecha[d.fecha];
    const m = est && est.cat !== 'futuro' ? (CAT_META[est.cat] || {}) : null;
    if (d.fuera) return '<td class="out"></td>';
    return `<td${m ? ` style="background:${m.color}22"` : ''}>
      <div class="dn">${d.dia}</div>${m ? `<div class="dt" style="color:${m.color}">${esc(m.label)}</div>` : ''}
    </td>`;
  }).join('')}</tr>`).join('');

  const pills = CAT_ORDEN.map(cat => {
    const m = CAT_META[cat];
    return `<span class="pill"><b style="color:${m.color}">${resumen[cat] || 0}</b> ${esc(m.label)}</span>`;
  }).join('');

  const cab = _exportCabeceraEmpresa();
  const firma = exportFooterHtml({ escapeHtml: esc });
  const id = getExportIdentity();
  const fileTitle = buildExportFilename('pdf').replace(/\.pdf$/i, '');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>${esc(fileTitle)}</title>
<style>
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font:12px Inter,system-ui,sans-serif;margin:24px;color:#0f172a}
  h1{font-size:16px;margin:0 0 2px}
  .sub{color:#64748b;font-size:11px;margin:0 0 12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
  .pills{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 12px;font-size:11px}
  .pill b{font-size:13px}
  table{border-collapse:collapse;width:100%;table-layout:fixed}
  th,td{border:1px solid #cbd5e1;height:56px;vertical-align:top;padding:4px;width:14.28%}
  th{height:auto;background:#f1f5f9;text-transform:uppercase;font-size:10px;padding:6px}
  td.out{background:#f8fafc}
  .dn{font-weight:700;font-size:11px}.dt{font-size:9px;font-weight:600;margin-top:4px}
  .rpt-cab{display:flex;align-items:center;gap:14px;border-bottom:2px solid #0f172a;padding-bottom:10px;margin:0 0 12px}
  .rpt-logo{height:44px}.rpt-empresa{display:flex;flex-direction:column}.rpt-empresa strong{font-size:13px}.rpt-empresa span{font-size:10px;color:#64748b}
  .btn-print{padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;margin-top:14px}
  @media print{body{margin:0}.no-print{display:none}}
</style></head><body>
${cab}
<h1>Historial de asistencia — ${esc(nombre)}</h1>
<div class="sub"><span>${esc(mesLabel)}${_s.historialPlaza ? ` · ${esc(_s.historialPlaza)}` : ''}</span><span>${esc(id.companyName)}</span></div>
<div class="pills">${pills}</div>
<table><thead><tr>${dows.map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table>
${firma}
<div class="no-print"><button class="btn-print" type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { _toast('Permite ventanas emergentes para exportar.', 'Exportar'); return; }
  win.document.write(html); win.document.close();
}
