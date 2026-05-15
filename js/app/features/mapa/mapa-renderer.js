import { buildMapaReadOnlyViewModel, normalizeMapUnit } from '/js/app/features/mapa/mapa-view-model.js';
import { getMiniBitacoraItems } from '/js/app/features/mapa/mapa-unit-history.js';
import { generarSearchTokens } from '/domain/unidad.model.js';

function _up(v) {
  return String(v || '').trim().toUpperCase();
}

/**
 * Filtro rápido cliente (sin queries nuevas): reduce unidades antes del VM.
 * @param {object} [ctx] — `incidentsByMva`, `incidentsReady`, `incidentsFailed` para filtros de incidencias
 */
export function applyMapaQuickFilter(units, quickFilter, ctx = {}) {
  const qf = String(quickFilter || 'all').toLowerCase();
  const list = Array.isArray(units) ? [...units] : [];
  if (qf === 'all') return list;
  if (qf === 'disponibles') return list.filter(u => _up(u.estado) === 'LISTO');
  if (qf === 'no-arrendable') return list.filter(u => _up(u.estado).includes('NO ARREND'));
  if (qf === 'mantenimiento') return list.filter(u => ['MANTENIMIENTO', 'SUCIO'].includes(_up(u.estado)));
  if (qf === 'sin-ubicacion') return list.filter(u => !_up(u.pos) || _up(u.pos) === 'LIMBO');
  if (qf === 'externos') {
    return list.filter(
      u =>
        _up(u.ubicacion).includes('EXTERNO') ||
        _up(u.tipo) === 'EXTERNO' ||
        _up(String(u.origen || '')).includes('EXTERNO')
    );
  }
  if (qf === 'limbo') {
    return list.filter(u => {
      const p = _up(u.pos);
      const ubi = _up(u.ubicacion);
      return ubi !== 'TALLER' && (!p || p === 'LIMBO');
    });
  }
  if (qf === 'taller') {
    return list.filter(u => _up(u.ubicacion) === 'TALLER');
  }
  if (qf === 'con-ubicacion') {
    return list.filter(u => {
      const p = _up(u.pos);
      return Boolean(p && p !== 'LIMBO');
    });
  }
  if (qf === 'con-incidencias') {
    if (!ctx.incidentsReady || ctx.incidentsFailed) return list;
    const by = ctx.incidentsByMva || {};
    return list.filter(u => (by[_up(u.mva)]?.total || 0) > 0);
  }
  if (qf === 'criticas') {
    if (!ctx.incidentsReady || ctx.incidentsFailed) return list;
    const by = ctx.incidentsByMva || {};
    return list.filter(u => (by[_up(u.mva)]?.criticas || 0) > 0);
  }
  return list;
}

function _incidentSearchMap(byMva) {
  const o = {};
  if (!byMva || typeof byMva !== 'object') return o;
  for (const [k, v] of Object.entries(byMva)) {
    const mva = String(k || '')
      .toUpperCase()
      .trim();
    const st = String(v?.searchText || '').toUpperCase();
    if (mva && st) o[mva] = st;
  }
  return o;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function up(value) {
  return String(value || '').trim().toUpperCase();
}

function _stateClass(state = '') {
  const normalized = up(state)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized ? `is-${normalized.toLowerCase()}` : 'is-sin-estado';
}

function _gasPct(gas = '') {
  const raw = String(gas == null ? '' : gas).trim().toUpperCase();
  if (!raw || raw === 'N/A' || raw === '—') return 0;
  if (raw === 'F' || raw === 'FULL') return 100;
  if (raw === 'E') return 8;
  const fractions = {
    '15/16': 94,
    '7/8': 88,
    '13/16': 81,
    '3/4': 75,
    '11/16': 69,
    '5/8': 63,
    '9/16': 56,
    '1/2': 50,
    'H': 50,
    '7/16': 44,
    '3/8': 38,
    '5/16': 31,
    '1/4': 25,
    '3/16': 19,
    '1/8': 13,
    '1/16': 6
  };
  if (fractions[raw] != null) return fractions[raw];
  const num = Number(raw.replace('%', ''));
  return Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : 0;
}

function _gasClass(pct) {
  if (pct >= 70) return 'is-high';
  if (pct >= 35) return 'is-mid';
  if (pct > 0) return 'is-low';
  return 'is-empty';
}

/** Replica de `actualizarContadores()` en `js/views/mapa.js` (KPIs legacy). */
function _legacyKpiCountsFromUnits(units) {
  let total = 0;
  let listos = 0;
  let sucios = 0;
  let manto = 0;
  let enPatio = 0;
  let enTaller = 0;
  for (const raw of units || []) {
    const nu = normalizeMapUnit(raw || {});
    const estado = up(nu.estado);
    const ubicacion = up(nu.ubicacion);
    if (estado === 'LISTO') listos++;
    else if (estado === 'SUCIO') sucios++;
    else if (estado === 'MANTENIMIENTO' || estado === 'TALLER') manto++;
    if (ubicacion === 'PATIO') {
      enPatio++;
      total++;
    } else if (ubicacion === 'TALLER') {
      enTaller++;
    }
  }
  return { total, listos, sucios, manto, enPatio, enTaller };
}

/** Clases de gradiente legacy (css/mapa.css `.listo`, `.sucio`, …) para port visual. */
function _legacyCarPaintClass(estado = '', tipo = '', ubicacion = '') {
  const s = up(estado);
  const t = up(tipo);
  const u = up(ubicacion);
  if (s === 'LISTO') return 'listo';
  if (s === 'SUCIO') return 'sucio';
  if (s === 'MANTENIMIENTO' || s === 'TALLER' || s === 'HYP') return 'mantenimiento';
  if (s.includes('TRASLADO')) return 'traslado';
  if (s.includes('VENTA')) return 'venta';
  if (s.includes('NO ARREND') || s.includes('NO-ARREND')) return 'no-arrendable';
  if (s === 'RESGUARDO') return 'resguardo';
  if (s.includes('RENTA')) return 'traslado';
  if (s === 'RETENIDA') return 'retenida';
  if (t === 'EXTERNO' || u.includes('EXTERNO')) return 'externo';
  return '';
}

/** Barra KPI como `mapa.html` + `actualizarContadores` (totales = unidades con ubicación PATIO). */
function _renderLegacyKpiBar(snapshotUnits) {
  const k = _legacyKpiCountsFromUnits(snapshotUnits);
  const v = n => esc(String(n));
  return `
    <div class="kpi-container" id="app-mapa-metrics-anchor" role="region" aria-label="Indicadores de flota">
      <div class="kpi-item">
        <span class="kpi-value" id="app-mapa-kpi-total">${v(k.total)}</span>
        <span class="kpi-label">TOTALES</span>
      </div>
      <div class="kpi-divider"></div>
      <div class="kpi-item">
        <span class="kpi-value text-green" id="app-mapa-kpi-listos">${v(k.listos)}</span>
        <span class="kpi-label">LISTOS</span>
      </div>
      <div class="kpi-item">
        <span class="kpi-value text-yellow" id="app-mapa-kpi-sucios">${v(k.sucios)}</span>
        <span class="kpi-label">SUCIOS</span>
      </div>
      <div class="kpi-item">
        <span class="kpi-value text-red" id="app-mapa-kpi-manto">${v(k.manto)}</span>
        <span class="kpi-label">MANTENIMIENTO</span>
      </div>
      <div class="kpi-divider"></div>
      <div class="kpi-item">
        <span class="kpi-value text-blue" id="app-mapa-kpi-patio">${v(k.enPatio)}</span>
        <span class="kpi-label">EN PATIO</span>
      </div>
      <div class="kpi-item">
        <span class="kpi-value text-orange" id="app-mapa-kpi-taller">${v(k.enTaller)}</span>
        <span class="kpi-label">EN TALLER</span>
      </div>
    </div>
  `;
}

function _legacySearchStrip(vm) {
  if (!vm.query) return '';
  return `<div class="app-mapa-legacy-filter-strip" role="status">
    <span class="app-mapa-legacy-filter-strip__label">Búsqueda</span>
    <span class="app-mapa-legacy-filter-strip__meta"><strong>${vm.filteredCount}</strong> / ${vm.totalUnits} unidades visibles</span>
    <button type="button" class="app-mapa-legacy-filter-strip__clear" data-app-mapa-action="clear-search">Limpiar</button>
  </div>`;
}

/** @deprecated Usar buildMapaReadOnlyViewModel; se mantiene alias por si hay imports externos. */
export function normalizeMapaViewModel(data = {}) {
  return buildMapaReadOnlyViewModel({
    estructura: data.structure,
    unidades: data.units,
    plaza: data.plaza,
    query: data.query
  });
}

export function renderUnit(unit, options = {}) {
  const selectedId = String(options.selectedId || '');
  const selected = selectedId && selectedId === String(unit.id);
  const dndActive = options.dndActive === true;
  const allowUnitDrag = options.allowUnitDrag !== false;
  const query = String(options.query || '').trim().toUpperCase();
  const position = String(unit.pos || unit.positionKey || '').trim();
  const zoneHint = String(unit.zoneLabel || unit.cellZone || '').trim();
  const currentCell = String(
    options.currentCellOverride
    || unit.currentCell
    || unit.positionKey
    || position
    || ''
  ).trim();
  const currentPos = String(options.currentPositionOverride || position || currentCell || '').trim();
  const zk = esc(zoneHint || unit.ubicacion || '');
  const baseAttrs =
    ` data-mva="${esc(unit.mva)}" data-zone="${zk}" data-position="${esc(currentPos)}"` +
    ` data-current-cell="${esc(currentCell)}" data-current-position="${esc(currentPos)}"`;
  const dndAttrs = dndActive && allowUnitDrag ? ' data-dnd-unit="1"' : '';
  const dim = unit.matchesQuery === false ? ' app-mapa-unit--dim' : '';
  const matchClass = query && unit.matchesQuery ? ' is-query-match' : '';
  const mvaK = up(unit.mva);
  const inc = options.incidentsByMva?.[mvaK];
  const ir = options.incidentsReady === true;
  const showInc = ir && inc && inc.total > 0;
  const showCrit = ir && inc && inc.criticas > 0;
  const stateClass = _stateClass(unit.estado);
  const legacyCar = _legacyCarPaintClass(unit.estado, unit.tipo, unit.ubicacion);
  const legacyCarCls = legacyCar ? ` ${legacyCar}` : '';
  const gasPct = _gasPct(unit.gasolina);
  const gasLabel = unit.gasolina != null && unit.gasolina !== '' && unit.gasolina !== '—' ? String(unit.gasolina) : 'N/A';
  const incHtml =
    showInc || showCrit
      ? `<span class="app-mapa-unit-inc" aria-label="Incidencias">
        ${showCrit ? '<span class="app-mapa-inc-crit" title="Incluye prioridad alta/crítica">!</span>' : ''}
        ${showInc ? `<span class="app-mapa-inc-badge">${inc.total}</span>` : ''}
      </span>`
      : '';
  return `
    <button type="button" class="app-mapa-unit car${legacyCarCls} ${stateClass} ${selected ? 'is-selected selected' : ''}${dndActive ? ' app-mapa-unit--dnd' : ''}${dim}${matchClass}"
      data-unit-id="${esc(unit.id)}"${baseAttrs}${dndAttrs}>
      <div class="app-mapa-unit-top">
        <strong>${esc(unit.mva)}</strong>
        ${incHtml}
        <span class="app-mapa-unit-state ${stateClass}">${esc(unit.estado)}</span>
      </div>
      <div class="app-mapa-unit-meta">${esc(unit.modelo)} · ${esc(unit.placas)}</div>
      <div class="app-mapa-gas ${_gasClass(gasPct)}" aria-label="Gasolina ${esc(gasLabel)}">
        <span class="app-mapa-gas-fill" style="width:${gasPct}%"></span>
        <span class="app-mapa-gas-text">${esc(gasLabel)}</span>
      </div>
      <div class="app-mapa-unit-zona">${esc(position || '—')}${zoneHint ? ` · <span class="app-mapa-unit-zone-hint">${esc(zoneHint)}</span>` : ''}</div>
    </button>
  `;
}

function _renderSlotRow(row, options) {
  const { selectedId, dndActive, query, incidentsByMva, incidentsReady } = options;
  const dim = row.emptyByFilter || (query && row.mutedByFilter);
  const mod = dim ? ' is-filter-dim' : '';
  const cellQ = query && row.matchesCellQuery ? ' is-cell-query-match' : '';
  const blocked = row.blocked ? ' is-blocked' : '';
  const reserved = row.reserved ? ' is-reserved' : '';
  const cards = (row.units || [])
    .map(u =>
      renderUnit(
        { ...u, cellZone: row.zoneLabel, positionKey: row.positionKey, currentCell: row.cellId },
        {
          selectedId,
          dndActive,
          query,
          currentCellOverride: row.cellId,
          currentPositionOverride: u.pos,
          incidentsByMva,
          incidentsReady
        }
      )
    )
    .join('');
  const stateEmpty = !row.occupiedCount;
  const labelSub = row.zoneLabel
    ? `<span class="app-mapa-slot-zone">${esc(row.zoneLabel)}</span>`
    : '';

  return `
    <div class="app-mapa-slot spot${mod}${cellQ}${blocked}${reserved}"
      role="group"
      aria-label="Celda ${esc(row.label)}"
      data-drop-cell="1"
      data-cell-type="cajon"
      data-cell-id="${esc(row.cellId)}"
      data-zone="${esc(row.zoneLabel)}"
      data-zone-label="${esc(row.zoneLabel)}"
      data-position="${esc(row.positionKey)}">
      <div class="app-mapa-slot-head">
        <span class="app-mapa-slot-label">${esc(row.label)}</span>
        ${labelSub}
        ${row.blocked ? '<span class="app-mapa-pill app-mapa-pill--blocked">Bloqueado</span>' : ''}
        ${row.reserved ? '<span class="app-mapa-pill app-mapa-pill--reserved">Reservado</span>' : ''}
      </div>
      <div class="app-mapa-slot-body">
        ${
          cards
            ? `<div class="app-mapa-slot-units">${cards}</div>`
            : `<div class="app-mapa-slot-empty">${stateEmpty ? 'Vacío' : 'Sin coincidencias en filtro'}</div>`
        }
      </div>
    </div>
  `;
}

function _layoutStyle(row = {}) {
  const x = Number(row.x) || 0;
  const y = Number(row.y) || 0;
  const w = Math.max(8, Number(row.width) || 120);
  const h = Math.max(8, Number(row.height) || 80);
  const rot = Number(row.rotation) || 0;
  return `left:${x}px;top:${y}px;width:${w}px;height:${h}px;${rot ? `transform:rotate(${rot}deg);` : ''}`;
}

function _renderAbsoluteSlot(row, options) {
  const { selectedId, dndActive, query, incidentsByMva, incidentsReady } = options;
  const dim = row.emptyByFilter || (query && row.mutedByFilter);
  const mod = dim ? ' is-filter-dim' : '';
  const cellQ = query && row.matchesCellQuery ? ' is-cell-query-match' : '';
  const blocked = row.blocked ? ' is-blocked' : '';
  const reserved = row.reserved ? ' is-reserved' : '';
  const cards = (row.units || [])
    .map(u =>
      renderUnit(
        { ...u, cellZone: row.zoneLabel, positionKey: row.positionKey, currentCell: row.cellId },
        {
          selectedId,
          dndActive,
          query,
          currentCellOverride: row.cellId,
          currentPositionOverride: u.pos,
          incidentsByMva,
          incidentsReady
        }
      )
    )
    .join('');
  const stateEmpty = !row.occupiedCount;

  return `
    <div class="app-mapa-slot app-mapa-slot--absolute spot mapa-celda-libre${mod}${cellQ}${blocked}${reserved}"
      role="group"
      aria-label="Celda ${esc(row.label)}"
      data-drop-cell="1"
      data-cell-type="cajon"
      data-cell-id="${esc(row.cellId)}"
      data-zone="${esc(row.zoneLabel)}"
      data-zone-label="${esc(row.zoneLabel)}"
      data-position="${esc(row.positionKey)}"
      data-spot="${esc(row.positionKey)}"
      style="${_layoutStyle(row)}">
      <div class="app-mapa-slot-head">
        <span class="app-mapa-slot-label">${esc(row.label)}</span>
      </div>
      <div class="app-mapa-slot-body">
        ${
          cards
            ? `<div class="app-mapa-slot-units">${cards}</div>`
            : `<div class="app-mapa-slot-empty">${stateEmpty ? 'Vacío' : 'Sin coincidencias en filtro'}</div>`
        }
      </div>
    </div>
  `;
}

function _renderLabelRow(row) {
  return `
    <div class="app-mapa-row-label" role="presentation">
      <span>${esc(row.label)}</span>
      ${row.zoneId ? `<small>${esc(row.zoneId)}</small>` : ''}
    </div>
  `;
}

function _renderAbsoluteLabel(row) {
  return `
    <div class="app-mapa-row-label app-mapa-row-label--absolute mapa-celda-libre"
      role="presentation"
      style="${_layoutStyle(row)}">
      <span>${esc(row.label)}</span>
      ${row.zoneId ? `<small>${esc(row.zoneId)}</small>` : ''}
    </div>
  `;
}

function _renderDecorRow(row) {
  return `
    <div class="app-mapa-row-decor">
      <span class="app-mapa-decor-type">${esc(row.tipo)}</span>
      <span>${esc(row.label)}</span>
    </div>
  `;
}

function _renderAbsoluteDecor(row) {
  const fill = row.fill ? `background:${esc(row.fill)};` : '';
  const stroke = row.stroke ? `border-color:${esc(row.stroke)};` : '';
  return `
    <div class="app-mapa-row-decor app-mapa-row-decor--absolute mapa-celda-libre is-${esc(String(row.tipo || 'decor').toLowerCase())}"
      style="${_layoutStyle(row)}${fill}${stroke}">
      <span class="app-mapa-decor-type">${esc(row.tipo)}</span>
      <span>${esc(row.label)}</span>
    </div>
  `;
}

function _bucketCurrentCell(title) {
  const t = String(title || '').toUpperCase();
  if (t.includes('HUÉRFANO') || t.includes('HUERFANO')) return 'ORPHAN';
  if (t.includes('TALLER')) return 'TALLER';
  if (t.includes('LIMBO') || t.includes('SIN UBICAC')) return 'LIMBO';
  return 'LIMBO';
}

function _bucketAnchorId(title) {
  const tok = _bucketCurrentCell(title);
  if (tok === 'ORPHAN') return 'app-mapa-orphan-bucket';
  if (tok === 'TALLER') return 'app-mapa-taller-bucket';
  return 'app-mapa-limbo-bucket';
}

function _renderBucket(title, units, options) {
  if (!units || units.length === 0) return '';
  const cellToken = _bucketCurrentCell(title);
  const anchor = _bucketAnchorId(title);
  const cards = units
    .map(u =>
      renderUnit(
        { ...u, currentCell: cellToken },
        { ...options, allowUnitDrag: false }
      )
    )
    .join('');
  return `
    <section class="app-mapa-bucket app-mapa-bucket--${esc(cellToken.toLowerCase())}" id="${esc(anchor)}" aria-label="${esc(title)}">
      <header class="app-mapa-bucket-head">${esc(title)} <span class="app-mapa-bucket-count">${units.length}</span></header>
      <div class="app-mapa-bucket-grid">${cards}</div>
    </section>
  `;
}

function _renderCompactUnitsSection(title, icon, units, options, cellToken) {
  const list = Array.isArray(units) ? units : [];
  const cards = list
    .map(u => renderUnit({ ...u, currentCell: cellToken }, { ...options, allowUnitDrag: false }))
    .join('');
  return `
    <section class="app-mapa-units-menu-section app-mapa-units-menu-section--${esc(String(cellToken || '').toLowerCase())}">
      <p class="app-mapa-units-menu-label">
        <span class="material-icons">${esc(icon)}</span>
        ${esc(title)} <strong>${list.length}</strong>
      </p>
      <div class="app-mapa-units-menu-list">
        ${cards || '<p class="app-mapa-units-menu-empty">Sin unidades.</p>'}
      </div>
    </section>
  `;
}

function _renderCompactUnitsMenu(vm, options) {
  const limbo = Array.isArray(vm.limboFiltered) ? vm.limboFiltered : [];
  const taller = Array.isArray(vm.tallerFiltered) ? vm.tallerFiltered : [];
  const orphan = Array.isArray(vm.orphanFiltered) ? vm.orphanFiltered : [];
  const total = limbo.length + taller.length + orphan.length;
  const sections =
    _renderCompactUnitsSection('Patio — sin asignar', 'local_parking', limbo, options, 'LIMBO') +
    _renderCompactUnitsSection('Taller — sin asignar', 'build', taller, options, 'TALLER') +
    (orphan.length
      ? _renderCompactUnitsSection('Posición no encontrada', 'help_outline', orphan, options, 'ORPHAN')
      : '');
  return {
    total,
    html: `
    <div class="app-mapa-units-drawer" id="app-mapa-units-drawer" hidden>
      <div class="app-mapa-units-drawer-overlay" data-mapa-drawer-close></div>
      <div class="app-mapa-units-drawer-panel">
        <div class="app-mapa-units-drawer-head">
          <h2>UNIDADES</h2>
          <span>Patio y taller sin cajón activo · ${total}</span>
          <button type="button" class="app-mapa-units-drawer-close" data-mapa-drawer-close><span class="material-icons">close</span></button>
        </div>
        <div class="app-mapa-units-drawer-body">
          ${sections || '<p class="app-mapa-units-menu-empty">No hay unidades sin cajón.</p>'}
        </div>
      </div>
    </div>
  `
  };
}

function _findSelected(vm, selectedId) {
  const sid = String(selectedId || '');
  if (!sid) return null;
  const scan = [...(vm.limboUnits || []), ...(vm.tallerUnits || []), ...(vm.orphanUnits || [])];
  for (const u of scan) {
    if (String(u.id) === sid) return u;
    if (String(u.mva || '').toUpperCase() === sid.toUpperCase()) return u;
  }
  for (const row of vm.rows || []) {
    if (row.kind !== 'slot') continue;
    for (const u of row.unitsAll || []) {
      if (String(u.id) === sid || String(u.mva || '').toUpperCase() === sid.toUpperCase()) {
        return { ...u, cellZone: row.zoneLabel, positionKey: row.positionKey };
      }
    }
  }
  return null;
}

/**
 * Resuelve la unidad seleccionada con el mismo VM que el render (filtros rápidos + búsqueda).
 * Sirve para limpiar `selectedId` cuando el filtro oculta la unidad (evita detalle “fantasma”).
 */
export function getResolvedMapaSelection(snapshot = {}, options = {}) {
  const plaza = snapshot.plaza || options.plaza || '';
  const qfCtx = {
    incidentsByMva: options.incidentsByMva || {},
    incidentsReady: options.incidentsReady === true,
    incidentsFailed: options.incidentsFailed === true
  };
  const unitsFiltered = applyMapaQuickFilter(snapshot.units, options.quickFilter, qfCtx);
  const incidentSearchByMva = _incidentSearchMap(options.incidentsByMva);
  const vm = buildMapaReadOnlyViewModel({
    estructura: snapshot.structure,
    unidades: unitsFiltered,
    plaza,
    query: options.query || '',
    incidentSearchByMva
  });
  return _findSelected(vm, String(options.selectedId || ''));
}

function _inferOrigenDatos(unit = {}) {
  const u = String(unit.ubicacion || '')
    .trim()
    .toUpperCase();
  if (u.includes('EXTERNO')) return 'Externos';
  return 'Cuadre / patio';
}

function _fmtRawDate(raw) {
  const r = raw || {};
  const cand =
    r.lastTouchedAt ||
    r.lastModified ||
    r.ultimaModificacion ||
    r.updatedAt ||
    r._updatedAt ||
    r._createdAt ||
    r.fechaIngreso ||
    null;
  if (!cand) return '—';
  try {
    const d = cand?.toDate ? cand.toDate() : new Date(cand);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  } catch (_) {
    return '—';
  }
}

function _rawAuthor(raw) {
  const r = raw || {};
  return String(
    r.lastTouchedBy || r.actualizadoPor || r._updatedBy || r.autor || r.responsable || ''
  ).trim() || '—';
}

function _fmtLastAtMs(t) {
  if (!t) return '';
  try {
    return new Date(t).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  } catch (_) {
    return '';
  }
}

function _detailIncBlock(mva, byMva, ready, failed) {
  if (!ready && !failed) {
    return `<div class="app-mapa-inc-summary app-mapa-inc-summary--pending"><p class="app-mapa-inc-muted">Resumen de incidencias: cargando…</p></div>`;
  }
  if (failed) {
    return `<div class="app-mapa-inc-summary"><p class="app-mapa-inc-muted">Resumen de incidencias no disponible en este momento.</p></div>`;
  }
  const s = byMva?.[mva];
  if (!s || !s.total) {
    return `<div class="app-mapa-inc-summary"><p class="app-mapa-inc-muted">Sin incidencias registradas para este MVA en esta plaza.</p></div>`;
  }
  const lastTit = s.latestTitle || s.lastTitulo || '';
  const lastAt = s.latestAt || s.lastAt || 0;
  const lastLine = lastTit
    ? `${esc(lastTit)}${lastAt ? ` · ${_fmtLastAtMs(lastAt)}` : ''}`
    : '—';
  const miniItems = getMiniBitacoraItems(byMva, mva, 3);
  const miniHtml = miniItems.length
    ? `<ol class="app-mapa-mini-history">
      ${miniItems
        .map(item => {
          const when = item.timestamp ? _fmtLastAtMs(item.timestamp) : '';
          const meta = [item.prioridad, item.estado, when].filter(Boolean).join(' · ');
          return `<li>
            <strong>${esc(item.titulo)}</strong>
            ${meta ? `<span>${esc(meta)}</span>` : ''}
            ${item.descripcion ? `<small>${esc(item.descripcion)}</small>` : ''}
          </li>`;
        })
        .join('')}
    </ol>`
    : '';
  return `
    <div class="app-mapa-inc-summary">
      <h4 class="app-mapa-inc-summary-title">Incidencias / notas (notas_admin)</h4>
      <ul class="app-mapa-inc-stats">
        <li><span>Total</span><strong>${s.total}</strong></li>
        <li><span>Abiertas</span><strong>${s.abiertas}</strong></li>
        <li><span>Críticas / alta (abiertas)</span><strong>${s.criticas}</strong></li>
        <li class="app-mapa-inc-last"><span>Última</span><span>${lastLine}</span></li>
      </ul>
      ${miniHtml}
      <a class="app-mapa-mini-cta app-mapa-mini-cta--block" href="/app/incidencias?mva=${encodeURIComponent(mva)}">Ver bitácora completa</a>
    </div>
  `;
}

function _detailQuickHistoryBlock(mva, items = []) {
  const key = String(mva || '').toUpperCase().trim();
  const rows = (Array.isArray(items) ? items : [])
    .filter(item => !key || String(item?.mva || '').toUpperCase().trim() === key)
    .slice(0, 4);
  if (!rows.length) return '';
  return `
    <div class="app-mapa-inc-summary app-mapa-quick-history">
      <h4 class="app-mapa-inc-summary-title">Historial rápido</h4>
      <ol class="app-mapa-mini-history">
        ${rows.map(item => {
          const when = item.at ? _fmtLastAtMs(item.at) : '';
          const flow = [item.from, item.to].filter(Boolean).join(' → ');
          return `<li>
            <strong>${esc(item.message || 'Actualización operativa')}</strong>
            <span>${esc([item.user || 'Sistema', when].filter(Boolean).join(' · '))}</span>
            ${flow ? `<small>${esc(flow)}</small>` : ''}
          </li>`;
        }).join('')}
      </ol>
    </div>
  `;
}

function _renderUnitActionsBlock(selected, plaza, actions = {}) {
  if (!selected) return '';
  const mva = String(selected.mva || '').trim();
  const notes = String(selected.notas || selected.notes || '').toUpperCase();
  const isApartado = notes.includes('APARTAD') || notes.includes('RESERVAD');
  const isDobleCero = notes.includes('DOBLE CERO');

  const secureActions = Array.isArray(actions.secureActions) ? actions.secureActions : [];
  const actionable = secureActions.filter(a => a?.available && !a?.blocked);

  const secureHtml = actionable.length
    ? `<div class="app-mapa-actions-menu">
      ${actionable
        .map(action => {
          const aid = String(action.id || '').trim();
          const lbl = String(action.label || aid || 'Acción');
          const confirmText = action.requiresConfirm ? ' data-app-mapa-requires-confirm="1"' : '';
          return `<button type="button" class="app-mapa-action-btn app-mapa-action-btn--primary" data-app-mapa-unit-action="${esc(aid)}"${confirmText}>${esc(lbl)}</button>`;
        })
        .join('')}
    </div>`
    : '';

  return `
    <section class="app-mapa-actions">
      <div class="app-mapa-legacy-panel-actions">
        <button type="button" class="app-mapa-legacy-panel-btn app-mapa-legacy-panel-btn--danger" data-app-mapa-detail="limbo">LIMBO</button>
        <details class="app-mapa-legacy-actions-dropdown">
          <summary>ACCIONES</summary>
          <div class="app-mapa-legacy-actions-dropdown__body">
            ${isApartado
              ? '<button type="button" data-app-mapa-quick-action="QUITAR_APARTADO">QUITAR APARTADO</button>'
              : '<button type="button" data-app-mapa-quick-action="APARTAR">APARTAR UNIDAD</button>'}
            ${isDobleCero
              ? '<button type="button" data-app-mapa-quick-action="QUITAR_DOBLE_CERO">QUITAR DOBLE CERO</button>'
              : '<button type="button" data-app-mapa-quick-action="DOBLE_CERO">AÑADIR DOBLE CERO</button>'}
            <button type="button" data-app-mapa-detail="create-incident">CREAR INCIDENCIA</button>
            <button type="button" data-app-mapa-official-unit="edit-unit">EDITAR UNIDAD</button>
            <button type="button" data-copy-mva="${esc(mva)}">COPIAR MVA</button>
            ${secureHtml}
          </div>
        </details>
        <button type="button" class="app-mapa-legacy-panel-btn" data-app-mapa-detail="close-panel">CERRAR</button>
      </div>
    </section>
  `;
}

function _detailPanel(selected, plaza, incOpts = {}, actionsOpts = {}) {
  if (!selected) {
    return '<p class="app-mapa-detail-placeholder">Selecciona una unidad para ver detalle.</p>';
  }
  const raw = selected._raw || {};
  const mvaEnc = encodeURIComponent(String(selected.mva || '').trim());
  const mvaK = String(selected.mva || '')
    .toUpperCase()
    .trim();
  const { incidentsByMva = {}, incidentsReady = false, incidentsFailed = false, quickHistory = [] } = incOpts;
  return `
    <div class="app-mapa-detail-hero">
      <h2 class="app-mapa-detail-mva-title">${esc(selected.mva)}</h2>
      <p class="app-mapa-detail-posline"><span class="app-mapa-detail-k">Posición / celda</span> <span class="app-mapa-detail-v">${esc(selected.pos || '—')}</span></p>
      <p class="app-mapa-detail-subline"><span class="app-mapa-detail-k">Ubicación</span> <span class="app-mapa-detail-v">${esc(selected.ubicacion || '—')}</span></p>
    </div>
    ${_renderUnitActionsBlock(selected, plaza, actionsOpts)}
    ${_detailQuickHistoryBlock(mvaK, quickHistory)}
    ${_detailIncBlock(mvaK, incidentsByMva, incidentsReady, incidentsFailed)}
    <div class="app-mapa-detail-fields">
    <p><strong>Estado:</strong> ${esc(selected.estado)}</p>
    <p><strong>Modelo:</strong> ${esc(selected.modelo)}</p>
    <p><strong>Placas:</strong> ${esc(selected.placas)}</p>
    <p><strong>Gas:</strong> ${esc(selected.gasolina || raw.gasolina || '—')}</p>
    <p><strong>Tipo / categoría:</strong> ${esc(selected.tipo || '—')} · ${esc(selected.categoria || '—')}</p>
    <p><strong>Notas:</strong> ${esc(selected.notas || '—')}</p>
    <p><strong>Plaza:</strong> ${esc(selected.plaza || plaza || '—')}</p>
    <p><strong>Fuente datos:</strong> ${esc(_inferOrigenDatos(selected))}</p>
    <p><strong>Actualizado:</strong> ${_fmtRawDate(raw)}</p>
    <p><strong>Por:</strong> ${esc(_rawAuthor(raw))}</p>
    </div>
  `;
}

export function renderEmptyState(label = 'No hay unidades para mostrar.') {
  return `<div class="app-mapa-state app-mapa-state-empty">${esc(label)}</div>`;
}

export function renderErrorState(label = 'No se pudo cargar el mapa.', opts = {}) {
  const legacy = opts.legacyCta !== false;
  return `<div class="app-mapa-state app-mapa-state-error" role="alert">
    <div class="app-mapa-state-error-msg">${esc(label)}</div>
    ${
      legacy
        ? `<p class="app-mapa-legacy-fallback"><a class="app-mapa-legacy-fallback-link" href="/mapa?legacy=1">Fallback técnico</a></p>`
        : ''
    }
  </div>`;
}

export function renderMapaReadOnly(container, snapshot = {}, options = {}) {
  if (!container) return;
  const dndActive = options.dndActive === true;
  const query = String(options.query || '');
  const plaza = snapshot.plaza || options.plaza || '';
  const qfCtx = {
    incidentsByMva: options.incidentsByMva || {},
    incidentsReady: options.incidentsReady === true,
    incidentsFailed: options.incidentsFailed === true
  };
  const unitsFiltered = applyMapaQuickFilter(snapshot.units, options.quickFilter, qfCtx);
  const incidentSearchByMva = _incidentSearchMap(options.incidentsByMva);

  const vm = buildMapaReadOnlyViewModel({
    estructura: snapshot.structure,
    unidades: unitsFiltered,
    plaza,
    query,
    incidentSearchByMva
  });

  const selectedId = String(options.selectedId || '');
  const selected = _findSelected(vm, selectedId);

  const incOpts = {
    incidentsByMva: options.incidentsByMva || {},
    incidentsReady: options.incidentsReady === true,
    incidentsFailed: options.incidentsFailed === true,
    quickHistory: Array.isArray(options.quickHistory) ? options.quickHistory : []
  };
  const actionsOpts = { ...(options.unitActions || {}), showDiagnostics: options.showDiagnostics === true };

  if (options.viewMode === 'list') {
    const queryUpper = String(vm.query || '').trim().toUpperCase();
    const noResults =
      Boolean(queryUpper) && vm.totalUnits > 0 && (vm.filteredCount || 0) === 0;
    const kpiHtml = _renderLegacyKpiBar(snapshot.units || []);
    const filterStrip = _legacySearchStrip(vm);
    const rows = unitsFiltered.slice(0, 420).map(raw => {
      const nu = normalizeMapUnit(raw);
      const id = String(nu.id || nu.mva || '');
      const sel = selectedId && id === selectedId ? ' is-selected' : '';
      const mvaUp = String(nu.mva || '')
        .toUpperCase()
        .trim();
      const incTxt = String(incOpts.incidentsByMva?.[mvaUp]?.searchText || '').toUpperCase();
      const tokMatch =
        !queryUpper ||
        generarSearchTokens(nu).some(t => String(t).toUpperCase().includes(queryUpper)) ||
        (incTxt && incTxt.includes(queryUpper));
      const qm = queryUpper && tokMatch ? ' is-query-match' : '';
      const inc = incOpts.incidentsByMva?.[mvaUp];
      const incLabel = inc && inc.total ? `${inc.abiertas || 0}/${inc.total}` : '—';
      const pos = String(nu.pos || 'LIMBO');
      const mvaEnc = encodeURIComponent(String(nu.mva || ''));
      return `<tr class="app-mapa-list-row${sel}${qm}" data-unit-id="${esc(id)}">
        <td><strong>${esc(nu.mva)}</strong></td>
        <td>${esc(String(nu.modelo || '—'))}</td>
        <td>${esc(String(nu.placas || '—'))}</td>
        <td>${esc(String(nu.estado || '—'))}</td>
        <td>${esc(String(nu.gasolina || '—'))}</td>
        <td>${esc(String(nu.ubicacion || '—'))}</td>
        <td>${esc(pos)}</td>
        <td>${esc(incLabel)}</td>
        <td class="app-mapa-list-actions">
          <button type="button" class="app-mapa-list-action" data-copy-mva="${esc(nu.mva)}">Copiar MVA</button>
          <a class="app-mapa-list-action" href="/app/incidencias?mva=${mvaEnc}">Bitácora</a>
          <button type="button" class="app-mapa-list-action" data-app-mapa-official-unit="edit-unit">Editar</button>
        </td>
      </tr>`;
    }).join('');
    container.innerHTML = `
    <div class="app-mapa app-mapa-legacy-port app-mapa-operativo">
      <div class="content app-mapa-legacy-content">
        ${kpiHtml}
        ${filterStrip}
        ${noResults ? `<p class="app-mapa-noresults" role="status">Sin resultados para la búsqueda actual.</p>` : ''}
        <div class="app-mapa-legacy-mapdetail-row app-mapa-legacy-mapdetail-row--list">
          <div class="app-mapa-legacy-list-stage">
            <div class="app-mapa-list-scroll">
              <table class="app-mapa-list-table">
                <thead><tr><th>MVA</th><th>Modelo</th><th>Placas</th><th>Estado</th><th>Gas</th><th>Ubicación</th><th>Pos</th><th>Inc.</th><th>Acciones</th></tr></thead>
                <tbody>${rows || `<tr><td colspan="9" class="app-mapa-list-empty">Sin unidades para este filtro.</td></tr>`}</tbody>
              </table>
            </div>
          </div>
          <aside class="info-sidebar app-mapa-detail app-mapa-info-aside open">${_detailPanel(selected, plaza, incOpts, actionsOpts)}</aside>
        </div>
      </div>
    </div>`;
    return;
  }

  const renderOpts = {
    selectedId,
    dndActive,
    query,
    incidentsByMva: options.incidentsByMva || {},
    incidentsReady: options.incidentsReady === true
  };

  const absoluteLayout = vm.layoutMode === 'absolute';
  const mainRows = (vm.rows || [])
    .map(row => {
      if (absoluteLayout) {
        if (row.kind === 'label') return _renderAbsoluteLabel(row);
        if (row.kind === 'decor') return _renderAbsoluteDecor(row);
        if (row.kind === 'slot') return _renderAbsoluteSlot(row, renderOpts);
        return '';
      }
      if (row.kind === 'label') return _renderLabelRow(row);
      if (row.kind === 'decor') return _renderDecorRow(row);
      if (row.kind === 'slot') return _renderSlotRow(row, renderOpts);
      return '';
    })
    .join('');

  const queryUpper = String(vm.query || '').trim().toUpperCase();
  const noResults =
    Boolean(queryUpper) && vm.totalUnits > 0 && (vm.filteredCount || 0) === 0;
  const kpiHtml = _renderLegacyKpiBar(snapshot.units || []);
  const filterStrip = _legacySearchStrip(vm);
  const compactUnitsMenu = _renderCompactUnitsMenu(vm, renderOpts);

  container.innerHTML = `
    <div class="app-mapa app-mapa-legacy-port app-mapa-operativo">
      <div class="content app-mapa-legacy-content">
        ${kpiHtml}
        ${filterStrip}
        ${noResults ? `<p class="app-mapa-noresults" role="status">Sin resultados para la búsqueda actual.</p>` : ''}
        <div class="app-mapa-legacy-mapdetail-row${selected ? '' : ' app-mapa-legacy-mapdetail-row--no-detail'}">
          <div class="app-mapa-legacy-main-column">
            <div id="app-mapa-legacy-map-stage" class="map-stage app-mapa-map-stage">
              <div id="app-mapa-legacy-map-zoom" class="map-zoom-container app-mapa-canvas-viewport">
                ${
                  vm.slotRows.length === 0 && !(vm.rows || []).length
                    ? renderEmptyState('No hay estructura de mapa para esta plaza. Usa Editar patio para crear o revisar configuración.')
                    : `<div id="app-mapa-legacy-grid" class="map-grid app-mapa-canvas-inner${absoluteLayout ? ' mapa-canvas-libre app-mapa-canvas-inner--absolute' : ''}"${absoluteLayout ? ` style="width:${Math.max(1, Number(vm.canvasW) || 1)}px;height:${Math.max(1, Number(vm.canvasH) || 1)}px;"` : ''}>${mainRows}</div>`
                }
              </div>
            </div>
          </div>
          ${selected ? `<aside class="info-sidebar app-mapa-detail app-mapa-info-aside open">${_detailPanel(selected, plaza, incOpts, actionsOpts)}</aside>` : ''}
        </div>
        <div class="zoom-controls app-mapa-zoom-controls" aria-hidden="true">
          <button type="button" class="btn-zoom" data-app-mapa-zoom="in">+</button>
          <button type="button" class="btn-zoom" data-app-mapa-zoom="out">-</button>
        </div>
      </div>
    </div>
  `;
  return {
    unidadesData: compactUnitsMenu
  };
}
