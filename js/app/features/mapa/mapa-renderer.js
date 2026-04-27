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

function _coalesce(...values) {
  for (const value of values) {
    const next = String(value || '').trim();
    if (next) return next;
  }
  return '';
}

function _unitZone(unit = {}) {
  return _coalesce(unit.ubicacion, unit.pos, unit.zone, unit.subzone, 'SIN ZONA');
}

function _unitState(unit = {}) {
  return _coalesce(unit.estado, 'SIN ESTADO').toUpperCase();
}

function _searchIndex(unit = {}) {
  return [
    unit.id,
    unit.mva,
    unit.placas,
    unit.modelo,
    unit.estado,
    unit.ubicacion,
    unit.pos,
    unit.notas,
    unit.categoria
  ].map(v => String(v || '').toUpperCase()).join(' ');
}

function _toUiUnit(unit = {}) {
  return {
    id: _coalesce(unit.id, unit.mva, `${Date.now()}-${Math.random()}`),
    mva: _coalesce(unit.mva, '—'),
    placas: _coalesce(unit.placas, '—'),
    modelo: _coalesce(unit.modelo, unit.categoria, 'Sin modelo'),
    estado: _unitState(unit),
    zona: _unitZone(unit),
    notas: _coalesce(unit.notas, ''),
    tipo: _coalesce(unit.tipo, ''),
    _raw: unit,
    _search: _searchIndex(unit)
  };
}

function _stateClass(state = '') {
  const normalized = up(state)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized ? `is-${normalized.toLowerCase()}` : 'is-sin-estado';
}

export function normalizeMapaViewModel(data = {}) {
  const structure = Array.isArray(data?.structure) ? data.structure : [];
  const unitsRaw = Array.isArray(data?.units) ? data.units : [];
  const query = String(data?.query || '').trim().toUpperCase();

  const units = unitsRaw.map(_toUiUnit);
  const filtered = query
    ? units.filter(unit => unit._search.includes(query))
    : units;

  const zonesFromStructure = structure
    .map(item => _coalesce(item?.zone, item?.subzone, item?.valor, item?.ubicacion))
    .filter(Boolean);

  const zoneMap = new Map();
  const ensureZone = (name) => {
    const key = _coalesce(name, 'SIN ZONA').toUpperCase();
    if (!zoneMap.has(key)) {
      zoneMap.set(key, { key, label: key, units: [] });
    }
    return zoneMap.get(key);
  };

  zonesFromStructure.forEach(name => ensureZone(name));
  filtered.forEach(unit => ensureZone(unit.zona).units.push(unit));

  const zones = Array.from(zoneMap.values())
    .filter(zone => zone.units.length > 0 || zonesFromStructure.includes(zone.label))
    .sort((a, b) => b.units.length - a.units.length || a.label.localeCompare(b.label));

  const stateCounts = filtered.reduce((acc, unit) => {
    acc[unit.estado] = (acc[unit.estado] || 0) + 1;
    return acc;
  }, {});

  const topStates = Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));

  return {
    totalUnits: units.length,
    filteredUnits: filtered.length,
    activeZones: zones.filter(zone => zone.units.length > 0).length,
    topStates,
    zones,
    units: filtered
  };
}

export function renderZone(zone, options = {}) {
  const selectedId = String(options.selectedId || '');
  const cards = zone.units.map(unit => renderUnit(unit, { selectedId })).join('');
  return `
    <section class="app-mapa-zone">
      <header class="app-mapa-zone-head">
        <h3>${esc(zone.label)}</h3>
        <span>${zone.units.length} unidad(es)</span>
      </header>
      ${cards ? `<div class="app-mapa-zone-grid">${cards}</div>` : '<div class="app-mapa-zone-empty">Sin unidades en esta zona.</div>'}
    </section>
  `;
}

export function renderUnit(unit, options = {}) {
  const selectedId = String(options.selectedId || '');
  const selected = selectedId && selectedId === String(unit.id);
  return `
    <button type="button" class="app-mapa-unit ${selected ? 'is-selected' : ''}" data-unit-id="${esc(unit.id)}">
      <div class="app-mapa-unit-top">
        <strong>${esc(unit.mva)}</strong>
        <span class="app-mapa-unit-state ${_stateClass(unit.estado)}">${esc(unit.estado)}</span>
      </div>
      <div class="app-mapa-unit-meta">${esc(unit.modelo)} · ${esc(unit.placas)}</div>
      <div class="app-mapa-unit-zona">${esc(unit.zona)}</div>
    </button>
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
  const vm = normalizeMapaViewModel({
    units: snapshot.units,
    structure: snapshot.structure,
    query: options.query || ''
  });
  const selectedId = String(options.selectedId || '');
  const selected = vm.units.find(unit => String(unit.id) === selectedId) || null;
  const stateLabel = vm.topStates.length
    ? vm.topStates.map(item => `${item.name}: ${item.count}`).join(' · ')
    : 'Sin estados';

  const zonesHtml = vm.filteredUnits === 0
    ? renderEmptyState(options.query ? `Sin resultados para "${options.query}".` : 'No hay unidades disponibles en esta plaza.')
    : vm.zones.map(zone => renderZone(zone, { selectedId })).join('');

  container.innerHTML = `
    <section class="app-mapa-summary">
      <article><span>Total</span><strong>${vm.totalUnits}</strong></article>
      <article><span>Zonas activas</span><strong>${vm.activeZones}</strong></article>
      <article><span>Filtro</span><strong>${vm.filteredUnits}</strong></article>
      <article><span>Estados</span><strong>${esc(stateLabel)}</strong></article>
    </section>
    <section class="app-mapa-layout">
      <div class="app-mapa-zones">${zonesHtml}</div>
      <aside class="app-mapa-detail">
        ${
          selected
            ? `
              <h3>${esc(selected.mva)}</h3>
              <p><strong>Estado:</strong> ${esc(selected.estado)}</p>
              <p><strong>Modelo:</strong> ${esc(selected.modelo)}</p>
              <p><strong>Placas:</strong> ${esc(selected.placas)}</p>
              <p><strong>Ubicación:</strong> ${esc(selected.zona)}</p>
              <p><strong>Tipo:</strong> ${esc(selected.tipo || '—')}</p>
              <p><strong>Notas:</strong> ${esc(selected.notas || '—')}</p>
              <small>Detalle solo lectura.</small>
            `
            : '<p>Selecciona una unidad para ver detalle read-only.</p>'
        }
      </aside>
    </section>
  `;
}
