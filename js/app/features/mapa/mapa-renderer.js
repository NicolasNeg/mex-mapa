import { buildMapaReadOnlyViewModel, normalizeMapUnit } from '/js/app/features/mapa/mapa-view-model.js';

function _up(v) {
  return String(v || '').trim().toUpperCase();
}

/** Filtro rápido cliente (sin queries nuevas): reduce unidades antes del VM. */
export function applyMapaQuickFilter(units, quickFilter) {
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
  return list;
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
  return `
    <button type="button" class="app-mapa-unit ${selected ? 'is-selected' : ''}${dndActive ? ' app-mapa-unit--dnd' : ''}${dim}${matchClass}"
      data-unit-id="${esc(unit.id)}"${baseAttrs}${dndAttrs}>
      <div class="app-mapa-unit-top">
        <strong>${esc(unit.mva)}</strong>
        <span class="app-mapa-unit-state ${_stateClass(unit.estado)}">${esc(unit.estado)}</span>
      </div>
      <div class="app-mapa-unit-meta">${esc(unit.modelo)} · ${esc(unit.placas)}</div>
      <div class="app-mapa-unit-zona">${esc(position || '—')}${zoneHint ? ` · <span class="app-mapa-unit-zone-hint">${esc(zoneHint)}</span>` : ''}</div>
    </button>
  `;
}

function _renderSlotRow(row, options) {
  const { selectedId, dndActive, query } = options;
  const dim = row.emptyByFilter || (query && row.mutedByFilter);
  const mod = dim ? ' is-filter-dim' : '';
  const cellQ = query && row.matchesCellQuery ? ' is-cell-query-match' : '';
  const blocked = row.blocked ? ' is-blocked' : '';
  const reserved = row.reserved ? ' is-reserved' : '';
  const cards = (row.units || [])
    .map(u =>
      renderUnit(
        { ...u, cellZone: row.zoneLabel, positionKey: row.positionKey, currentCell: row.cellId },
        { selectedId, dndActive, query, currentCellOverride: row.cellId, currentPositionOverride: u.pos }
      )
    )
    .join('');
  const stateEmpty = !row.occupiedCount;
  const labelSub = row.zoneLabel
    ? `<span class="app-mapa-slot-zone">${esc(row.zoneLabel)}</span>`
    : '';

  return `
    <div class="app-mapa-slot${mod}${cellQ}${blocked}${reserved}"
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

function _renderLabelRow(row) {
  return `
    <div class="app-mapa-row-label" role="presentation">
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

function _findSelected(vm, selectedId) {
  const sid = String(selectedId || '');
  if (!sid) return null;
  const scan = [...(vm.limboUnits || []), ...(vm.tallerUnits || []), ...(vm.orphanUnits || [])];
  for (const u of scan) {
    if (String(u.id) === sid) return u;
  }
  for (const row of vm.rows || []) {
    if (row.kind !== 'slot') continue;
    for (const u of row.unitsAll || []) {
      if (String(u.id) === sid) {
        return { ...u, cellZone: row.zoneLabel, positionKey: row.positionKey };
      }
    }
  }
  return null;
}

function _inferOrigenDatos(unit = {}) {
  const u = String(unit.ubicacion || '')
    .trim()
    .toUpperCase();
  if (u.includes('EXTERNO')) return 'Externos';
  return 'Cuadre / patio';
}

function _detailPanel(selected, plaza) {
  if (!selected) {
    return '<p class="app-mapa-detail-placeholder">Selecciona una unidad para ver detalle.</p>';
  }
  return `
    <h3>${esc(selected.mva)}</h3>
    <p class="app-mapa-detail-actions-top">
      <button type="button" class="app-mapa-copy-mva" data-copy-mva="${esc(selected.mva)}">Copiar MVA</button>
    </p>
    <p><strong>MVA:</strong> ${esc(selected.mva)}</p>
    <p><strong>Posición:</strong> ${esc(selected.pos || '—')}</p>
    <p><strong>Ubicación:</strong> ${esc(selected.ubicacion || '—')}</p>
    <p><strong>Estado:</strong> ${esc(selected.estado)}</p>
    <p><strong>Modelo:</strong> ${esc(selected.modelo)}</p>
    <p><strong>Placas:</strong> ${esc(selected.placas)}</p>
    <p><strong>Tipo / categoría:</strong> ${esc(selected.tipo || '—')} · ${esc(selected.categoria || '—')}</p>
    <p><strong>Notas:</strong> ${esc(selected.notas || '—')}</p>
    <p><strong>Plaza:</strong> ${esc(selected.plaza || plaza || '—')}</p>
    <p><strong>Origen datos:</strong> ${esc(_inferOrigenDatos(selected))}</p>
    <p><a class="app-mapa-mini-cta" href="/mapa">Abrir mapa classic (legacy)</a></p>
    <small class="app-mapa-detail-foot">Solo lectura en App Shell. Edición en mapa legacy.</small>
  `;
}

export function renderEmptyState(label = 'No hay unidades para mostrar.') {
  return `<div class="app-mapa-state app-mapa-state-empty">${esc(label)}</div>`;
}

export function renderErrorState(label = 'No se pudo cargar el mapa.') {
  return `<div class="app-mapa-state app-mapa-state-error">${esc(label)}</div>`;
}

export function renderMapaReadOnly(container, snapshot = {}, options = {}) {
  if (!container) return;
  const dndActive = options.dndActive === true;
  const query = String(options.query || '');
  const plaza = snapshot.plaza || options.plaza || '';
  const unitsFiltered = applyMapaQuickFilter(snapshot.units, options.quickFilter);

  const vm = buildMapaReadOnlyViewModel({
    estructura: snapshot.structure,
    unidades: unitsFiltered,
    plaza,
    query
  });

  const selectedId = String(options.selectedId || '');
  const selected = _findSelected(vm, selectedId);

  if (options.viewMode === 'list') {
    const filterLine = vm.query
      ? `<article class="app-mapa-summary-filter"><span>Coincidencias</span><strong>${vm.filteredCount}</strong> de ${vm.totalUnits}</article>`
      : '';
    const stateLabel =
      vm.slotRows && vm.slotRows.length
        ? `${vm.occupiedSlots}/${vm.slotRows.length} celdas con unidad`
        : 'Sin estructura';
    const queryUpper = String(vm.query || '').trim().toUpperCase();
    const noResults =
      Boolean(queryUpper) && vm.totalUnits > 0 && (vm.filteredCount || 0) === 0;
    const rows = unitsFiltered.slice(0, 420).map(raw => {
      const nu = normalizeMapUnit(raw);
      const id = String(nu.id || nu.mva || '');
      const sel = selectedId && id === selectedId ? ' is-selected' : '';
      return `<tr class="app-mapa-list-row${sel}" data-unit-id="${esc(id)}">
        <td><strong>${esc(nu.mva)}</strong></td>
        <td>${esc(String(nu.estado || '—'))}</td>
        <td>${esc(String(nu.modelo || '—'))}</td>
        <td>${esc(String(nu.pos || 'LIMBO'))}</td>
        <td>${esc(String(nu.ubicacion || '—'))}</td>
      </tr>`;
    }).join('');
    container.innerHTML = `
    <section class="app-mapa-summary">
      <article><span>Unidades (filtro)</span><strong>${vm.totalUnits}</strong></article>
      <article><span>Celdas</span><strong>${vm.slotRows.length}</strong></article>
      <article><span>Ocupación</span><strong>${esc(stateLabel)}</strong></article>
      <article><span>Plaza</span><strong>${esc(vm.plaza || '—')}</strong></article>
      ${filterLine}
    </section>
    ${noResults ? `<p class="app-mapa-noresults" role="status">Sin resultados para la búsqueda actual.</p>` : ''}
    <section class="app-mapa-layout app-mapa-layout--list">
      <div class="app-mapa-list-scroll">
        <table class="app-mapa-list-table">
          <thead><tr><th>MVA</th><th>Estado</th><th>Modelo</th><th>Pos</th><th>Ubicación</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="app-mapa-list-empty">Sin unidades para este filtro.</td></tr>`}</tbody>
        </table>
      </div>
      <aside class="app-mapa-detail">${_detailPanel(selected, plaza)}</aside>
    </section>`;
    return;
  }
  const stateLabel =
    vm.slotRows && vm.slotRows.length
      ? `${vm.occupiedSlots}/${vm.slotRows.length} celdas con unidad`
      : 'Sin estructura';

  const renderOpts = { selectedId, dndActive, query };

  const mainRows = (vm.rows || [])
    .map(row => {
      if (row.kind === 'label') return _renderLabelRow(row);
      if (row.kind === 'decor') return _renderDecorRow(row);
      if (row.kind === 'slot') return _renderSlotRow(row, renderOpts);
      return '';
    })
    .join('');

  const orphanTitle = 'Huérfanos · posición no encontrada en estructura';
  const buckets =
    _renderBucket('Sin ubicación asignada (Limbo)', vm.limboFiltered, renderOpts) +
    _renderBucket('Taller', vm.tallerFiltered, renderOpts) +
    _renderBucket(orphanTitle, vm.orphanFiltered, renderOpts);

  const filterLine = vm.query
    ? `<article class="app-mapa-summary-filter"><span>Coincidencias</span><strong>${vm.filteredCount}</strong> de ${vm.totalUnits}</article>`
    : '';

  const queryUpper = String(vm.query || '').trim().toUpperCase();
  const noResults =
    Boolean(queryUpper) && vm.totalUnits > 0 && (vm.filteredCount || 0) === 0;

  container.innerHTML = `
    <section class="app-mapa-summary">
      <article><span>Unidades</span><strong>${vm.totalUnits}</strong></article>
      <article><span>Celdas en estructura</span><strong>${vm.slotRows.length}</strong></article>
      <article><span>Ocupación cajones</span><strong>${esc(stateLabel)}</strong></article>
      <article><span>Plaza</span><strong>${esc(vm.plaza || '—')}</strong></article>
      ${filterLine}
    </section>
    ${noResults ? `<p class="app-mapa-noresults" role="status">Sin resultados para la búsqueda actual.</p>` : ''}
    <p class="app-mapa-results-hint" ${vm.query ? '' : 'hidden'}>Filtro activo: mostrando coincidencias y atenuando celdas sin resultados.</p>
    <section class="app-mapa-layout app-mapa-layout--grid">
      <div class="app-mapa-main">
        <div class="app-mapa-canvas">
          ${
            vm.slotRows.length === 0 && !(vm.rows || []).length
              ? renderEmptyState('No hay estructura de mapa para esta plaza. Usa el mapa completo para revisar configuración.')
              : `<div class="app-mapa-canvas-inner">${mainRows}</div>`
          }
        </div>
        ${buckets ? `<div class="app-mapa-buckets" id="app-mapa-buckets">${buckets}</div>` : ''}
      </div>
      <aside class="app-mapa-detail">${_detailPanel(selected, plaza)}</aside>
    </section>
  `;

}
