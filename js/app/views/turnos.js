// ═══════════════════════════════════════════════════════════
//  /js/app/views/turnos.js — Turnos & Horarios
//  Roles bajos (AUXILIAR, VENTAS): ver activos + su propio horario.
//  Roles admin (SUPERVISOR+): gestionar horarios, asistencia e historial.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { iniciarTurno, cerrarTurno, onTurnosActivos } from '/js/app/features/turnos/turnos-data.js';
import {
  DIAS, DIA_NOMBRE, TIPOS_DIA, ESTADOS_ASISTENCIA,
  semanaInicio, moverSemana, fechaDia, hoy, rangoSemana,
  onHorariosSemanales, guardarHorario,
  onAsistencia, registrarAsistencia,
  getHistorialTurnos, getUsuariosPlaza,
  getMiHorario,
  onPlantillas, guardarPlantilla, eliminarPlantilla,
  onNotasSemana, guardarNotaSemana,
} from '/js/app/features/turnos/horarios-data.js';

// ── Constantes de rol ──────────────────────────────────────────
const ROLES_ADMIN = new Set([
  'SUPERVISOR','JEFE_PATIO','GERENTE_PLAZA',
  'JEFE_REGIONAL','CORPORATIVO_USER','JEFE_OPERACION','PROGRAMADOR',
]);

function _isAdmin(role) { return ROLES_ADMIN.has(String(role || '').toUpperCase()); }

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
    isAdmin: _isAdmin(role),
    tab: 'activos',
    turnosActivos: [],
    miTurno: null,
    horarios: [],
    semana: semanaInicio(),
    usuarios: [],
    asistencia: [],
    asistenciaFecha: hoy(),
    historial: [],
    historialCargado: false,
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
  _unsubH = onHorariosSemanales(plaza, semana, list => {
    if (!_s) return;
    _s.horarios = list;
    _repaintTab();
  });

  // Asistencia del día seleccionado
  _unsubAs = onAsistencia(plaza, asistenciaFecha, asistenciaFecha, list => {
    if (!_s) return;
    _s.asistencia = list;
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
  _unsubH = onHorariosSemanales(_s.plaza, _s.semana, list => {
    if (!_s) return;
    _s.horarios = list;
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
  _unsubAs = onAsistencia(_s.plaza, fecha, fecha, list => {
    if (!_s) return;
    _s.asistencia = list;
    _repaintTab();
  });
}

// ── Usuarios ──────────────────────────────────────────────────
async function _loadUsuarios() {
  if (!_s?.plaza) return;
  _s.usuariosLoading = true;
  try {
    _s.usuarios = await getUsuariosPlaza(_s.plaza);
  } catch (_) {
    _s.usuarios = [];
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
    ${!plaza ? _renderNoPlaza() : _renderTabContent()}
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
  body.innerHTML = !_s.plaza ? _renderNoPlaza() : _renderTabContent();
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
  const inicio = turno.inicio?.toDate?.() || new Date(Number(turno.inicio) || Date.now());
  const ms     = Date.now() - inicio.getTime();
  const h      = Math.floor(ms / 3600000);
  const m      = Math.floor((ms % 3600000) / 60000);
  const elapsed = h > 0 ? `${h}h ${m}m` : `${m}m`;
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
</div>`;
}

// ── Tab Horarios ──────────────────────────────────────────────
function _renderHorarios() {
  const { semana, horarios, usuarios, isAdmin, usuariosLoading, uid, plantillas, notasSemana, showGestionPlantillas } = _s;

  const semanaFin = moverSemana(semana, 1);
  const semanaFinDisplay = new Date(semanaFin + 'T00:00:00');
  semanaFinDisplay.setDate(semanaFinDisplay.getDate() - 1);

  const fmtSemana = (s) => {
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  };

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
        ? `<div class="tu-grid-nota-gen" title="${esc(notaGen)}" ${isAdmin ? `data-nota-dia="${d}" data-nota-val="${esc(notaGen)}"` : ''}>📌</div>`
        : (isAdmin ? `<button class="tu-grid-nota-add" data-nota-dia="${d}" title="Agregar nota general" type="button">+</button>` : '')
      }
    </th>`;
  }).join('');

  // Filas de usuarios (FIX: usar u.uid || u.id para obtener el UID real)
  let filas = '';
  if (usuariosLoading) {
    filas = `<tr><td colspan="8" class="tu-grid-loading">Cargando usuarios…</td></tr>`;
  } else {
    const lista = isAdmin ? usuarios : usuarios.filter(u => (u.uid || u.id) === uid);
    if (!lista.length) {
      filas = `<tr><td colspan="8" class="tu-grid-empty">
        ${isAdmin ? 'No hay usuarios registrados en esta plaza.' : 'No se encontró tu perfil en esta plaza.'}
      </td></tr>`;
    } else {
      for (const u of lista) {
        const realUid = u.uid || u.id;
        const horario = horarios.find(h => h.usuarioId === realUid);
        const esYo    = realUid === uid;
        filas += `<tr class="tu-grid-row${esYo ? ' tu-grid-row--own' : ''}">
          <td class="tu-grid-td-name">
            <span class="tu-grid-avatar">${_initial(u)}</span>
            <span class="tu-grid-uname">${esc(_nombre(u))}</span>
          </td>
          ${DIAS.map(d => {
            const cell  = horario?.dias?.[d];
            const fecha = fechaDia(semana, d);
            const esHoy = fecha === hoy();
            const editable = isAdmin;
            let content = '';
            if (cell) {
              content = cell.tipo === 'NORMAL'
                ? `<div class="tu-cell-horario">${esc(cell.inicio)}–${esc(cell.fin)}</div>`
                : `<div class="tu-cell-tipo" style="background:${TIPOS_DIA[cell.tipo]?.color || '#94a3b8'}20;color:${TIPOS_DIA[cell.tipo]?.color || '#94a3b8'}">${TIPOS_DIA[cell.tipo]?.label || cell.tipo}</div>`;
              if (cell.nota) content += `<div class="tu-cell-nota" title="${esc(cell.nota)}">💬 ${esc(cell.nota)}</div>`;
            }
            return `<td class="tu-grid-td${esHoy ? ' tu-grid-td--today' : ''}${editable ? ' tu-grid-td--editable' : ''}"
                        ${editable ? `data-edit-uid="${esc(realUid)}" data-edit-nombre="${esc(_nombre(u))}" data-edit-rol="${esc(u.rol || u.role || '')}" data-edit-dia="${d}"` : ''}>
              ${content || (editable ? '<span class="tu-cell-add">+</span>' : '')}
            </td>`;
          }).join('')}
        </tr>`;
      }
    }
  }

  // Panel gestión de plantillas
  const gestionPanel = showGestionPlantillas ? `
<div class="tu-plantillas-panel" id="tuPlantillasPanel">
  <div class="tu-plantillas-panel-head">
    <span class="material-symbols-outlined">bookmark</span>
    <h3>Plantillas de horario</h3>
    <button class="tu-btn tu-btn--icon" id="tuCerrarGestion" type="button">
      <span class="material-symbols-outlined">close</span>
    </button>
  </div>
  <div class="tu-plantillas-list" id="tuPlantillasList">
    ${plantillas.length === 0
      ? '<p class="tu-empty" style="padding:8px 0;">Sin plantillas. Crea la primera.</p>'
      : plantillas.map(p => `
        <div class="tu-plantilla-item">
          <span class="tu-plantilla-item-name">${esc(p.nombre)}</span>
          <span class="tu-plantilla-item-hours">${esc(p.inicio)}–${esc(p.fin)}</span>
          <button class="tu-btn tu-btn--sm tu-btn--red" data-del-plantilla="${esc(p.id)}" type="button">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>`).join('')}
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
    </div>
    <button class="tu-btn tu-btn--primary tu-btn--full" id="tuGuardarPlantilla" type="button" style="margin-top:8px;">
      <span class="material-symbols-outlined">add</span> Agregar plantilla
    </button>
  </div>
</div>` : '';

  return `
<div class="tu-horarios">
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
    <div style="flex:1"></div>
    ${isAdmin ? `
    <button class="tu-btn tu-btn--ghost" id="tuGestionPlantillas" type="button">
      <span class="material-symbols-outlined">bookmark</span> Plantillas
    </button>` : ''}
    <button class="tu-btn tu-btn--ghost" id="tuExportar" type="button">
      <span class="material-symbols-outlined">share</span> Exportar
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
    ${Object.entries(TIPOS_DIA).map(([k, v]) =>
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
        <label class="tu-label">Usar plantilla</label>
        <div class="tu-plantillas-chips" id="tuPlantillasChips">
          ${plantillas.map(p => `
            <button class="tu-plantilla-chip" type="button"
                    data-pid="${esc(p.id)}" data-inicio="${esc(p.inicio)}" data-fin="${esc(p.fin)}">
              ${esc(p.nombre)}
              <span class="tu-plantilla-chip-time">${esc(p.inicio)}–${esc(p.fin)}</span>
            </button>`).join('')}
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
  const { asistenciaFecha, asistencia, usuarios, usuariosLoading, horarios, semana } = _s;

  let filas = '';
  if (usuariosLoading) {
    filas = `<tr><td colspan="4" class="tu-grid-loading">Cargando…</td></tr>`;
  } else if (!usuarios.length) {
    filas = `<tr><td colspan="4" class="tu-grid-empty">No hay usuarios en esta plaza.</td></tr>`;
  } else {
    for (const u of usuarios) {
      const uid  = u.uid || u.id || '';
      const reg  = asistencia.find(a => a.usuarioId === uid);
      const est  = reg?.estado || '';
      const nota = reg?.nota   || '';
      filas += `<tr class="tu-asist-row" data-uid="${esc(uid)}" data-nombre="${esc(_nombre(u))}">
        <td class="tu-asist-td-name">
          <span class="tu-grid-avatar">${_initial(u)}</span>
          <span>${esc(_nombre(u))}</span>
        </td>
        <td>
          <select class="tu-select tu-asist-estado" data-uid="${esc(uid)}">
            <option value="">— sin registrar —</option>
            ${Object.entries(ESTADOS_ASISTENCIA).map(([k, v]) =>
              `<option value="${k}" ${est === k ? 'selected' : ''}>${v.label}</option>`
            ).join('')}
          </select>
        </td>
        <td>
          <input class="tu-input tu-asist-nota" type="text" placeholder="Nota (opcional)"
                 value="${esc(nota)}" data-uid="${esc(uid)}">
        </td>
        <td>
          <button class="tu-btn tu-btn--sm tu-btn--primary tu-asist-save"
                  type="button" data-uid="${esc(uid)}" data-nombre="${esc(_nombre(u))}">
            <span class="material-symbols-outlined">save</span>
          </button>
        </td>
      </tr>`;
    }
  }

  return `
<div class="tu-asistencia">
  <div class="tu-asist-toolbar">
    <label class="tu-label">Fecha:</label>
    <input class="tu-input" type="date" id="tuAsistFecha" value="${esc(asistenciaFecha)}">
    <div class="tu-asist-legend">
      ${Object.entries(ESTADOS_ASISTENCIA).map(([k, v]) =>
        `<span class="tu-legend-item">
          <span class="tu-legend-dot" style="background:${v.color}"></span>${v.label}
         </span>`).join('')}
    </div>
  </div>
  <div class="tu-grid-wrap">
    <table class="tu-grid tu-asist-grid">
      <thead>
        <tr>
          <th class="tu-grid-th-name">Colaborador</th>
          <th>Estado</th>
          <th>Nota</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  </div>
</div>`;
}

// ── Tab Historial ─────────────────────────────────────────────
function _renderHistorial() {
  const { historial, historialCargado, isAdmin, uid } = _s;

  if (!historialCargado) {
    void _loadHistorial();
    return `<div class="tu-loading">
      <div class="tu-spinner"></div>
      <span>Cargando historial…</span>
    </div>`;
  }

  if (!historial.length) {
    return `<div class="tu-empty-state">
      <span class="material-symbols-outlined">history</span>
      <p>No hay turnos registrados.</p>
    </div>`;
  }

  const filas = historial.map(t => {
    const inicio = t.inicio?.toDate?.() || new Date(Number(t.inicio) || 0);
    const fin    = t.fin?.toDate?.()    || new Date(Number(t.fin)    || 0);
    const ms     = fin.getTime() - inicio.getTime();
    const h      = Math.floor(ms / 3600000);
    const m      = Math.floor((ms % 3600000) / 60000);
    const dur    = ms > 0 ? (h > 0 ? `${h}h ${m}m` : `${m}m`) : '—';
    const fechaStr = inicio.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    const inicioStr = inicio.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const finStr    = fin.toLocaleTimeString('es-MX',    { hour: '2-digit', minute: '2-digit' });
    return `<tr class="tu-hist-row">
      ${isAdmin ? `<td class="tu-hist-nombre">${esc(t.usuarioNombre || '—')}</td>` : ''}
      <td class="tu-hist-fecha">${fechaStr}</td>
      <td>${inicioStr}</td>
      <td>${finStr}</td>
      <td class="tu-hist-dur"><strong>${dur}</strong></td>
      <td class="tu-hist-plaza">${esc(t.plazaId || '—')}</td>
    </tr>`;
  }).join('');

  return `
<div class="tu-historial">
  <div class="tu-grid-wrap">
    <table class="tu-grid">
      <thead>
        <tr>
          ${isAdmin ? '<th>Colaborador</th>' : ''}
          <th>Fecha</th>
          <th>Entrada</th>
          <th>Salida</th>
          <th>Duración</th>
          <th>Plaza</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  </div>
  ${historial.length >= 40 ? `
  <div style="text-align:center;padding:16px;">
    <button class="tu-btn tu-btn--ghost" id="tuHistMore" type="button">Cargar más</button>
  </div>` : ''}
</div>`;
}

// ── Bind ──────────────────────────────────────────────────────
function _bindTabs() {
  _ctr?.querySelector('#tuTabs')?.addEventListener('click', e => {
    const btn = e.target.closest('.tu-tab');
    if (!btn || !_s) return;
    _s.tab = btn.dataset.tab;
    if (_s.tab === 'historial' && !_s.historialCargado) {
      _s.historialCargado = false;
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
  // Iniciar turno
  _ctr?.querySelector('#tuBtnIniciar')?.addEventListener('click', async () => {
    const btn = _ctr?.querySelector('#tuBtnIniciar');
    if (btn) btn.disabled = true;
    try {
      const { profile, plaza } = _s;
      const authUid = window._auth?.currentUser?.uid;
      await iniciarTurno({ uid: authUid, ...profile }, plaza);
    } catch (e) {
      console.warn('[turnos] iniciarTurno:', e);
      if (_s && btn) btn.disabled = false;
    }
  });

  // Cerrar turno
  _ctr?.querySelectorAll('[data-cerrar]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.cerrar;
      btn.disabled = true;
      try { await cerrarTurno(id); }
      catch (e) {
        console.warn('[turnos] cerrarTurno:', e);
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

  // Guardar nueva plantilla
  _ctr?.querySelector('#tuGuardarPlantilla')?.addEventListener('click', async () => {
    const nombre = _ctr.querySelector('#tuPNombre')?.value.trim();
    const inicio = _ctr.querySelector('#tuPInicio')?.value;
    const fin    = _ctr.querySelector('#tuPFin')?.value;
    if (!nombre || !inicio || !fin) return;
    const btn = _ctr.querySelector('#tuGuardarPlantilla');
    if (btn) btn.disabled = true;
    try {
      await guardarPlantilla(nombre, inicio, fin);
      const el = _ctr.querySelector('#tuPNombre');
      if (el) el.value = '';
    } catch (e) {
      console.warn('[turnos] guardarPlantilla:', e);
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

  // Notas generales de día — clic en 📌 o en "+"
  _ctr?.querySelectorAll('[data-nota-dia]').forEach(el => {
    el.addEventListener('click', () => _openNotaModal(el.dataset.notaDia, el.dataset.notaVal || ''));
  });
  _bindNotaModal();

  // Click en celda editable (abrir editor)
  if (_s.isAdmin) {
    _ctr?.querySelectorAll('.tu-grid-td--editable').forEach(td => {
      td.addEventListener('click', () => _openEditor(td));
    });
    _bindEditor();
  }
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

  _s.editDia = { uid, nombre, rol, diaKey };

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
    });
  });

  // Plantillas: click auto-rellena horas y activa tipo NORMAL
  editor.querySelectorAll('.tu-plantilla-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const ini = editor.querySelector('#tuHoraInicio');
      const fin = editor.querySelector('#tuHoraFin');
      if (ini) ini.value = chip.dataset.inicio;
      if (fin) fin.value = chip.dataset.fin;
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

  editor.querySelector('#tuEditorGuardar')?.addEventListener('click', async () => {
    const { editDia, horarios, plaza, semana } = _s;
    if (!editDia) return;
    const btn = editor.querySelector('#tuEditorGuardar');
    if (btn) btn.disabled = true;

    try {
      const tipoActivo = editor.querySelector('.tu-tipo-btn--active')?.dataset.tipo || 'NORMAL';
      const inicio     = editor.querySelector('#tuHoraInicio')?.value || '08:00';
      const fin        = editor.querySelector('#tuHoraFin')?.value    || '16:00';
      const nota       = (editor.querySelector('#tuNotaDia')?.value || '').trim();

      const horario = horarios.find(h => h.usuarioId === editDia.uid);
      const dias    = { ...(horario?.dias || {}) };
      const cellData = tipoActivo === 'NORMAL'
        ? { tipo: 'NORMAL', inicio, fin }
        : { tipo: tipoActivo };
      if (nota) cellData.nota = nota;
      dias[editDia.diaKey] = cellData;

      await guardarHorario(editDia.uid, plaza, semana, dias, {
        nombre: editDia.nombre,
        rol:    editDia.rol,
      });

      editor.style.display = 'none';
      _s.editDia = null;
    } catch (e) {
      console.warn('[turnos] guardarHorario:', e);
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

  _ctr?.querySelectorAll('.tu-asist-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid    = btn.dataset.uid;
      const nombre = btn.dataset.nombre;
      const row    = btn.closest('.tu-asist-row');
      const estado = row?.querySelector('.tu-asist-estado')?.value || '';
      const nota   = row?.querySelector('.tu-asist-nota')?.value   || '';
      if (!estado || !uid) return;
      btn.disabled = true;
      try {
        await registrarAsistencia(uid, _s.plaza, _s.asistenciaFecha, estado, { nombre, nota });
      } catch (e) {
        console.warn('[turnos] registrarAsistencia:', e);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function _exportarHorarios() {
  if (!_s) return;
  const { semana, horarios, usuarios, notasSemana } = _s;
  const semanaFin = moverSemana(semana, 1);
  const finDisp   = new Date(semanaFin + 'T00:00:00');
  finDisp.setDate(finDisp.getDate() - 1);
  const fmt = s => new Date(s + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

  const thDias = DIAS.map(d => {
    const fecha = fechaDia(semana, d);
    const dn    = DIA_NOMBRE[d];
    return `<th>${dn}<br><small>${fecha}</small>${notasSemana[d] ? `<br><small style="color:#6366f1">📌 ${notasSemana[d]}</small>` : ''}</th>`;
  }).join('');

  const rows = usuarios.map(u => {
    const realUid = u.uid || u.id;
    const horario = horarios.find(h => h.usuarioId === realUid);
    const celdas  = DIAS.map(d => {
      const cell = horario?.dias?.[d];
      if (!cell) return '<td>—</td>';
      const texto = cell.tipo === 'NORMAL' ? `${cell.inicio}–${cell.fin}` : (TIPOS_DIA[cell.tipo]?.label || cell.tipo);
      const nota  = cell.nota ? `<br><small style="color:#6366f1">${cell.nota}</small>` : '';
      return `<td>${texto}${nota}</td>`;
    }).join('');
    return `<tr><td><strong>${_nombre(u)}</strong></td>${celdas}</tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Horarios ${semana}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;color:#1e293b;padding:20px}
  h2{font-size:16px;margin:0 0 4px}
  p{color:#64748b;margin:0 0 16px;font-size:11px}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #e2e8f0;padding:7px 10px;text-align:center}
  th{background:#f8fafc;font-weight:700;font-size:11px}
  td:first-child{text-align:left;font-size:12px}
  small{font-size:10px;color:#64748b}
  @media print{body{padding:0}button{display:none}}
</style></head><body>
<h2>Horarios</h2>
<p>Semana del ${fmt(semana)} al ${fmt(finDisp.toISOString().slice(0,10))} · Plaza: ${_s.plaza}</p>
<table><thead><tr><th>Colaborador</th>${thDias}</tr></thead><tbody>${rows}</tbody></table>
<br>
<button onclick="window.print()" style="padding:8px 20px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">🖨️ Imprimir / Guardar PDF</button>
</body></html>`;

  const win = window.open('', '_blank');
  if (win) { win.document.write(html); win.document.close(); }
}

function _bindHistorial() {
  _ctr?.querySelector('#tuHistMore')?.addEventListener('click', () => {
    if (!_s) return;
    void _loadHistorial(true);
  });
}

// ── Historial loader ──────────────────────────────────────────
async function _loadHistorial(more = false) {
  if (!_s) return;
  const { plaza, isAdmin, uid } = _s;
  try {
    const items = await getHistorialTurnos(plaza, {
      limit: 40,
      ...(!isAdmin ? { usuarioId: uid } : {}),
    });
    if (!_s) return;
    _s.historial = more ? [...(_s.historial || []), ...items] : items;
    _s.historialCargado = true;
    _repaintTab();
  } catch (e) {
    console.warn('[turnos] historial:', e);
    if (_s) { _s.historialCargado = true; _repaintTab(); }
  }
}

// ── Helpers ───────────────────────────────────────────────────
function _nombre(u) {
  return String(u.nombreCompleto || u.nombre || u.email || u.id || '—').split(/\s+/).slice(0, 2).join(' ');
}

function _initial(u) {
  const n = _nombre(u);
  return n.charAt(0).toUpperCase();
}

function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
