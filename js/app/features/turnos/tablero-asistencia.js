// ═══════════════════════════════════════════════════════════
//  /js/app/features/turnos/tablero-asistencia.js
//  Renderers puros del Tablero de Asistencia (heatmap mensual +
//  tarjeta lateral con 6 métricas) — pantalla 1.
//  Sin estado propio ni Firestore: recibe el sub-estado `a` y
//  devuelve HTML. El binding/carga viven en views/turnos.js.
// ═══════════════════════════════════════════════════════════

import { CAT_META, CAT_ORDEN } from '/js/app/features/turnos/asistencia-calc.js';
import {
  escHtml as esc,
  nombreUsuario,
  initialUsuario,
  normalizeUsuarioUid,
} from '/js/app/features/turnos/turnos-view-model.js';

function _mesLabel(anclaIso) {
  const d = new Date(`${anclaIso}T12:00:00`);
  const s = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function _codigoUsuario(u) {
  return String(u?.codigo || u?.numeroEmpleado || u?.numEmpleado || u?.noEmpleado || '').trim();
}

function _rolUsuario(u) {
  return String(u?.rol || u?.role || u?.puesto || '').trim();
}

/** Toolbar: navegación de mes, selector de plaza, acciones. */
export function tableroToolbarHtml(a) {
  const plazaOpts = (a.plazasDisponibles || []).map(p =>
    `<option value="${esc(p)}"${p === a.plaza ? ' selected' : ''}>${esc(p === 'TODAS' ? 'Todas las plazas' : p)}</option>`
  ).join('');

  return `
<div class="tu-asis-topbar">
  <div class="tu-asis-monthnav">
    <button class="tu-btn tu-btn--icon" id="tuAsisPrev" type="button" title="Mes anterior">
      <span class="material-symbols-outlined">chevron_left</span>
    </button>
    <span class="tu-asis-month">${esc(_mesLabel(a.ancla))}</span>
    <button class="tu-btn tu-btn--icon" id="tuAsisNext" type="button" title="Mes siguiente">
      <span class="material-symbols-outlined">chevron_right</span>
    </button>
    <label class="tu-asis-monthpick" title="Ir a mes">
      <span class="material-symbols-outlined">calendar_month</span>
      <input type="month" id="tuAsisMonth" value="${esc(a.ancla.slice(0, 7))}">
    </label>
    ${plazaOpts ? `
    <select class="tu-input tu-asis-plaza" id="tuAsisPlaza" title="Plaza">
      ${plazaOpts}
    </select>` : ''}
  </div>
  <div class="tu-asis-actions">
    <button class="tu-btn tu-btn--ghost" id="tuAsisPanel" type="button" aria-pressed="${a.panelOpen ? 'true' : 'false'}">
      <span class="material-symbols-outlined">view_sidebar</span> Panel
    </button>
    <button class="tu-btn tu-btn--ghost" id="tuAsisPdf" type="button">
      <span class="material-symbols-outlined">picture_as_pdf</span> Exportar PDF
    </button>
    <button class="tu-btn tu-btn--ghost" id="tuAsisReload" type="button">
      <span class="material-symbols-outlined">refresh</span> Actualizar
    </button>
  </div>
</div>
${tableroLeyendaHtml(a)}`;
}

/** Chips de leyenda que funcionan como filtro (dim de lo no seleccionado). */
export function tableroLeyendaHtml(a) {
  const activos = a.catFiltro instanceof Set ? a.catFiltro : new Set();
  return `<div class="tu-asis-legend" id="tuAsisLegend">
    ${CAT_ORDEN.map(cat => {
      const m = CAT_META[cat];
      const on = activos.size === 0 || activos.has(cat);
      return `<button type="button" class="tu-asis-leg${on ? '' : ' tu-asis-leg--off'}" data-leg="${cat}">
        <span class="tu-asis-leg__dot" style="background:${m.color}"></span>${esc(m.label)}
      </button>`;
    }).join('')}
  </div>`;
}

/** Cuerpo: grid heatmap + tarjeta lateral, o estados de carga/vacío/error. */
export function tableroBodyHtml(a) {
  if (a.error) {
    return `<div class="tu-empty-state">
      <span class="material-symbols-outlined">construction</span>
      <p>No se pudo cargar el tablero${a.error.code === 'INDEX_MISSING' ? ' — índice de Firestore pendiente' : ''}.</p>
      ${a.error.code === 'INDEX_MISSING' ? '<p style="font-size:12px;color:var(--text-muted,#64748b);margin-top:8px;">Despliega <code>firebase deploy --only firestore:indexes</code></p>' : ''}
    </div>`;
  }
  if (a.loading) {
    return `<div class="tu-loading"><div class="tu-spinner"></div><span>Cargando asistencia…</span></div>`;
  }
  const data = a.data;
  if (!data || !data.filas.length) {
    return `<div class="tu-empty-state">
      <span class="material-symbols-outlined">event_busy</span>
      <p>Sin colaboradores para este mes.</p>
    </div>`;
  }

  const selUid = a.selUid || data.filas[0]?.uid || '';
  const filaSel = data.filas.find(f => f.uid === selUid) || data.filas[0];

  return `<div class="tu-asis-layout${a.panelOpen ? '' : ' tu-asis-layout--nopanel'}">
    ${_gridHtml(data, a.catFiltro, selUid)}
    ${a.panelOpen ? _spotlightHtml(filaSel, a.plaza) : ''}
  </div>`;
}

function _gridHtml(data, catFiltro, selUid) {
  const activos = catFiltro instanceof Set ? catFiltro : new Set();
  const isDim = (cat) => activos.size > 0 && !activos.has(cat);

  const headCols = data.dias.map(d =>
    `<th class="tu-hm-daycol${d.esHoy ? ' tu-hm-daycol--today' : ''}${d.esFinde ? ' tu-hm-daycol--we' : ''}">
      <span class="tu-hm-dow">${esc(d.diaSemana)}</span>
      <span class="tu-hm-num">${d.dia}</span>
    </th>`
  ).join('');

  const rows = data.filas.map(fila => {
    const cells = fila.celdas.map(c => {
      const m = CAT_META[c.cat] || {};
      const dim = isDim(c.cat);
      const paint = c.cat === 'futuro'
        ? 'background:transparent'
        : `background:${m.color}${dim ? '22' : ''}`;
      return `<td class="tu-hm-cell${dim ? ' tu-hm-cell--dim' : ''}"
        style="${paint}"
        title="${esc(c.fecha)} · ${esc(c.label)}"
        data-uid="${esc(fila.uid)}" data-fecha="${esc(c.fecha)}" data-cat="${esc(c.cat)}"></td>`;
    }).join('');
    return `<tr class="tu-hm-row${fila.uid === selUid ? ' tu-hm-row--sel' : ''}" data-row-uid="${esc(fila.uid)}">
      <td class="tu-hm-emp">
        <span class="tu-hm-avatar">${esc(initialUsuario(fila.usuario))}</span>
        <span class="tu-hm-emp__info">
          <span class="tu-hm-emp__name">${esc(nombreUsuario(fila.usuario))}</span>
          ${_codigoUsuario(fila.usuario) ? `<span class="tu-hm-emp__code">${esc(_codigoUsuario(fila.usuario))}</span>` : ''}
        </span>
      </td>
      ${cells}
    </tr>`;
  }).join('');

  return `<div class="tu-hm-wrap">
    <table class="tu-hm">
      <thead><tr><th class="tu-hm-emp-head">Empleado</th>${headCols}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function _spotlightHtml(fila, plaza) {
  if (!fila) return '';
  const u = fila.usuario;
  const r = fila.resumen;
  const rol = _rolUsuario(u);
  const codigo = _codigoUsuario(u);
  const tiles = [
    ['asistencia', r.asistencia],
    ['retardo', r.retardo],
    ['falta', r.falta],
    ['permiso', r.permiso],
    ['descanso', r.descanso],
    ['sinasignar', r.sinasignar],
  ];
  return `<aside class="tu-spot">
    <div class="tu-spot__head">
      <span class="tu-spot__avatar">${esc(initialUsuario(u))}</span>
      <div class="tu-spot__id">
        <h3 class="tu-spot__name">${esc(nombreUsuario(u))}</h3>
        ${rol ? `<span class="tu-spot__rol">${esc(rol)}</span>` : ''}
        ${codigo ? `<span class="tu-spot__code">${esc(codigo)}</span>` : ''}
      </div>
    </div>
    <div class="tu-spot__tiles">
      ${tiles.map(([cat, val]) => {
        const m = CAT_META[cat];
        return `<div class="tu-spot__tile" style="--tile:${m.color}">
          <span class="tu-spot__val">${val}</span>
          <span class="tu-spot__lbl">${esc(m.label)}</span>
        </div>`;
      }).join('')}
    </div>
    <button class="tu-btn tu-btn--primary tu-btn--full" id="tuAsisVerHist" data-uid="${esc(fila.uid)}" type="button">
      Ver historial completo
    </button>
  </aside>`;
}

/** ID de usuario seleccionado por defecto (primera fila). */
export function primerUid(data) {
  return data?.filas?.[0]?.uid || '';
}

export { normalizeUsuarioUid };
