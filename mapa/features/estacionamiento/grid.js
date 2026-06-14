// ======================================================================
//  mapa/features/estacionamiento/grid.js
//  Modo operativo para negocios donde el mapa del estacionamiento es el
//  centro del flujo: cajones, ocupacion, filtros y movimientos en sitio.
// ======================================================================

const PARKING_TOOLBAR_ID = 'parking-map-toolbar';
const PARKING_FILTERS = Object.freeze([
  ['todos', 'Todos'],
  ['ocupados', 'Ocupados'],
  ['libres', 'Libres'],
  ['reservados', 'Reservados'],
  ['bloqueados', 'Bloqueados'],
  ['sin-cajon', 'Sin cajon']
]);

function _txt(value) {
  return String(value || '').trim();
}

function _up(value) {
  return _txt(value).toUpperCase();
}

function _slug(value) {
  return _txt(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function _esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getMapaTipoNegocio() {
  const empresa = window._empresaActual || window.MEX_CONFIG?.empresa || {};
  const raw = empresa.tipoNegocio || empresa.giro || empresa.businessType || empresa.tipo || '';
  const normalized = _slug(raw);
  if (['estacionamiento', 'parking', 'parkings', 'parqueo', 'garage'].includes(normalized)) return 'estacionamiento';
  if (['arrendadora', 'renta-autos', 'renta-de-autos', 'rentadora'].includes(normalized)) return 'arrendadora';
  return normalized || 'default';
}

export function esMapaEstacionamiento() {
  return getMapaTipoNegocio() === 'estacionamiento';
}

function _placeForSlot(slotId) {
  const slot = _up(slotId);
  if (!slot) return 'Sin etiqueta';
  if (slot.startsWith('TLLRS')) return 'Talleres';
  if (slot.startsWith('B-')) return 'Servicio';
  if (slot.startsWith('L2-')) return 'Largo plazo 2';
  if (slot.startsWith('L-')) return 'Largo plazo';
  if (slot.startsWith('OFICINA')) return 'Check-in';
  if (slot.startsWith('VS-')) return 'Visitas';
  if (slot.startsWith('S')) return 'Seccion lateral';
  if (slot.startsWith('O-')) return 'Operacion';
  if (slot.startsWith('M-')) return 'Maniobra';
  return 'Patio';
}

function _layerForSlot(slotId) {
  const slot = _up(slotId);
  if (slot.startsWith('TLLRS')) return 'taller';
  if (slot.startsWith('B-')) return 'servicio';
  if (slot.startsWith('OFICINA')) return 'oficina';
  if (slot.startsWith('VS-')) return 'visitas';
  if (slot.startsWith('S')) return 'lateral';
  if (slot.startsWith('L')) return 'largo-plazo';
  return 'patio';
}

function _slot(valor, x, y, width, height, extra = {}) {
  const layer = extra.layer || _layerForSlot(valor);
  const place = extra.place || _placeForSlot(valor);
  return {
    valor,
    x,
    y,
    width,
    height,
    rotation: extra.rotation || 0,
    tipo: extra.tipo || 'cajon',
    esLabel: extra.esLabel === true,
    orden: extra.orden || 0,
    zone: extra.zone || place,
    subzone: extra.subzone || layer,
    isReserved: extra.isReserved === true,
    isBlocked: extra.isBlocked === true,
    metadata: {
      businessView: 'estacionamiento',
      parkingLayer: layer,
      parkingPlace: place,
      parkingPreset: 'beta-estacionamientos-v1',
      ...(extra.metadata || {})
    }
  };
}

function _row(prefix, count, x0, y, width, height, step, options = {}) {
  const out = [];
  for (let i = 1; i <= count; i += 1) {
    const value = `${prefix}${i}`;
    const w = typeof options.widthFor === 'function' ? options.widthFor(i, width) : width;
    const x = typeof options.xFor === 'function' ? options.xFor(i, x0, step) : x0 + ((i - 1) * step);
    out.push(_slot(value, x, y, w, height, options.extra || {}));
  }
  return out;
}

export function buildEstacionamientoDefaultStructure() {
  const sideRows = [];
  [7, 6, 5, 4, 3, 2, 1].forEach((n, index) => {
    const y = 330 + (index * 76);
    sideRows.push(
      _slot(`S4-${n}`, 866, y, 196, 64),
      _slot(`S3-${n}`, 1074, y, 96, 64),
      _slot(`S2-${n}`, 1178, y, 96, 64),
      _slot(`S1-${n}`, 1282, y, 96, 64)
    );
  });

  const structure = [
    ..._row('L-', 11, 34, 32, 96, 132, 104, {
      widthFor: i => (i <= 2 ? 92 : 96)
    }),
    ..._row('L2-', 11, 34, 180, 96, 132, 104, {
      widthFor: i => (i <= 2 ? 92 : 96)
    }),
    _slot('O-1', 34, 330, 196, 64),
    _slot('O-2', 242, 330, 196, 64),
    _slot('O-3', 450, 330, 196, 64),
    _slot('O-4', 658, 330, 196, 64),
    ...sideRows,
    _slot('SERVICIO-INTERNO', 34, 406, 400, 132, {
      tipo: 'area',
      zone: 'Servicio',
      layer: 'servicio',
      place: 'Servicio'
    }),
    _slot('M-1', 138, 548, 196, 132),
    _slot('OFICINA-1', 554, 548, 96, 132),
    _slot('OFICINA-2', 670, 548, 96, 132),
    _slot('B-1', 34, 612, 92, 64),
    _slot('B-2', 138, 612, 92, 64),
    _slot('B-3', 242, 612, 96, 64),
    _slot('B-4', 346, 612, 96, 64),
    _slot('PATIO-ESPERA', 450, 710, 500, 128, {
      tipo: 'area',
      zone: 'Espera',
      layer: 'patio',
      place: 'Espera'
    }),
    _slot('VS-2', 970, 710, 96, 128),
    _slot('VS-1', 1074, 710, 96, 128),
    _slot('AREA-SERVICIO-1', 1200, 32, 188, 132, {
      tipo: 'area',
      zone: 'Servicio',
      layer: 'servicio',
      place: 'Servicio'
    }),
    ..._row('TLLRS-', 6, 1612, 32, 194, 90, 100)
  ];

  return structure.map((item, index) => ({ ...item, orden: index }));
}

export function isGenericDefaultStructure(estructura = []) {
  if (!Array.isArray(estructura) || estructura.length === 0) return true;
  if (estructura.length !== 1) return false;
  const item = estructura[0] || {};
  return _up(item.valor) === 'A1'
    && _txt(item.tipo || 'cajon') === 'cajon'
    && Number(item.x || 0) === 0
    && Number(item.y || 0) === 0
    && Number(item.width || 120) === 120
    && Number(item.height || 80) === 80;
}

export function resolveEstacionamientoStructure(estructura = [], options = {}) {
  const force = options.force === true;
  if (!force && !esMapaEstacionamiento()) return estructura;
  if (!isGenericDefaultStructure(estructura)) return estructura;
  return buildEstacionamientoDefaultStructure();
}

function _setKpiLabel(id, label) {
  const value = document.getElementById(id);
  const labelEl = value?.parentElement?.querySelector?.('.kpi-label');
  if (labelEl) labelEl.textContent = label;
}

function _ensureToolbar() {
  let toolbar = document.getElementById(PARKING_TOOLBAR_ID);
  if (toolbar) return toolbar;
  const content = document.querySelector('.content');
  const stage = document.getElementById('map-stage');
  if (!content || !stage) return null;

  toolbar = document.createElement('div');
  toolbar.id = PARKING_TOOLBAR_ID;
  toolbar.className = 'parking-map-toolbar';
  toolbar.innerHTML = `
    <div class="parking-toolbar-main">
      <span class="material-icons">local_parking</span>
      <div>
        <strong>Mapa estacionamiento</strong>
        <small data-parking-plaza>Plaza</small>
      </div>
    </div>
    <div class="parking-toolbar-occupancy" aria-live="polite">
      <span data-parking-occupancy-text>0/0</span>
      <div><i data-parking-occupancy-bar></i></div>
    </div>
    <div class="parking-toolbar-filters">
      ${PARKING_FILTERS.map(([key, label]) => `
        <button type="button" data-parking-filter="${_esc(key)}">${_esc(label)}</button>
      `).join('')}
    </div>
    <div class="parking-toolbar-actions">
      <button type="button" data-parking-action="inventory" title="Inventario"><span class="material-icons">view_list</span></button>
      <button type="button" data-parking-action="editor" title="Editor"><span class="material-icons">edit_location_alt</span></button>
      <button type="button" data-parking-action="refresh" title="Actualizar"><span class="material-icons">sync</span></button>
    </div>
  `;
  content.insertBefore(toolbar, stage);
  _bindToolbar(toolbar);
  return toolbar;
}

function _bindToolbar(toolbar) {
  if (!toolbar || toolbar.dataset.bound === '1') return;
  toolbar.dataset.bound = '1';
  toolbar.addEventListener('click', event => {
    const filterBtn = event.target.closest('[data-parking-filter]');
    if (filterBtn) {
      document.body.dataset.parkingFilter = filterBtn.dataset.parkingFilter || 'todos';
      applyEstacionamientoFilter();
      return;
    }

    const action = event.target.closest('[data-parking-action]')?.dataset?.parkingAction || '';
    if (action === 'inventory') window.toggleSidebar?.();
    if (action === 'editor') window.abrirEditorMapa?.();
    if (action === 'refresh') window.refrescarDatos?.(true);
  });
}

export function syncEstacionamientoMode(options = {}) {
  const active = esMapaEstacionamiento();
  document.body.classList.toggle('mapa-business-estacionamiento', active);
  if (!active) {
    document.getElementById(PARKING_TOOLBAR_ID)?.remove();
    return false;
  }

  const plaza = _up(options.plaza || window.getMexCurrentPlaza?.() || window.__mexCurrentPlazaId || '');
  const toolbar = _ensureToolbar();
  const plazaEl = toolbar?.querySelector('[data-parking-plaza]');
  if (plazaEl) plazaEl.textContent = plaza ? `Plaza ${plaza}` : 'Plaza activa';

  _setKpiLabel('kpi-total', 'CAJONES');
  _setKpiLabel('kpi-listos', 'OCUPADOS');
  _setKpiLabel('kpi-sucios', 'LIBRES');
  _setKpiLabel('kpi-manto', 'RESERVADOS');
  _setKpiLabel('kpi-patio', 'BLOQUEADOS');
  _setKpiLabel('kpi-taller-loc', 'SIN CAJON');

  if (!document.body.dataset.parkingFilter) document.body.dataset.parkingFilter = 'todos';
  applyEstacionamientoFilter();

  // Inicializar sub-módulos de forma lazy (dynamic import para evitar circular)
  Promise.all([
    import('/mapa/features/estacionamiento/entrada-salida.js').then(m => m.initEntradaSalida()),
    import('/mapa/features/estacionamiento/reservas.js').then(m => m.initReservas()),
  ]).catch(() => {});

  return true;
}

export function decorateEstacionamientoSpot(el, celda = {}) {
  if (!el || !esMapaEstacionamiento()) return;
  const valor = _txt(celda.valor || el.dataset?.spot || '');
  const meta = celda.metadata && typeof celda.metadata === 'object' ? celda.metadata : {};
  const layer = meta.parkingLayer || celda.subzone || _layerForSlot(valor);
  const place = meta.parkingPlace || celda.zone || _placeForSlot(valor);
  el.classList.add('parking-slot');
  el.dataset.parkingLayer = _slug(layer);
  el.dataset.parkingPlace = place;
  if (celda.tipo !== 'cajon') el.classList.add('parking-area');
  if (valor) el.setAttribute('aria-label', `${valor} ${place}`);
}

export function decorateEstacionamientoUnit(car, unit = {}) {
  if (!car || !esMapaEstacionamiento()) return;
  const estado = _up(unit.estado || car.dataset?.estado || '');
  const ubicacion = _up(unit.ubicacion || car.dataset?.ubicacion || '');
  let status = 'estacionado';
  if (estado.includes('RESERV') || estado.includes('APART')) status = 'reservado';
  else if (estado.includes('INCID')) status = 'incidencia';
  else if (estado.includes('MANT') || estado.includes('TALLER') || ubicacion.includes('TALLER')) status = 'servicio';
  else if (estado.includes('BLOQ') || estado.includes('RETEN')) status = 'bloqueado';
  Array.from(car.classList)
    .filter(cls => cls.startsWith('parking-unit--'))
    .forEach(cls => car.classList.remove(cls));
  car.classList.add('parking-unit', `parking-unit--${status}`);
  car.dataset.parkingStatus = status;
}

export function applyEstacionamientoFilter(root = document) {
  if (!esMapaEstacionamiento()) return;
  const filter = document.body.dataset.parkingFilter || 'todos';
  root.querySelectorAll('[data-parking-filter]').forEach(btn => {
    btn.classList.toggle('is-active', (btn.dataset.parkingFilter || 'todos') === filter);
  });
}

export function updateEstacionamientoKpis(root = document) {
  if (!syncEstacionamientoMode()) return false;

  const spots = Array.from(root.querySelectorAll('.spot'));
  const limbo = root.getElementById?.('unidades-limbo') || document.getElementById('unidades-limbo');
  const taller = root.getElementById?.('unidades-taller') || document.getElementById('unidades-taller');
  const countLimbo = document.getElementById('count-limbo');
  const countTaller = document.getElementById('count-taller');
  if (countLimbo && limbo) countLimbo.textContent = String(limbo.children.length);
  if (countTaller && taller) countTaller.textContent = String(taller.children.length);

  let occupied = 0;
  let reserved = 0;
  let blocked = 0;

  spots.forEach(spot => {
    const hasUnit = Boolean(spot.querySelector('.car'));
    const isReserved = spot.dataset.reserved === 'true';
    const isBlocked = spot.dataset.blocked === 'true';
    spot.classList.toggle('parking-occupied', hasUnit);
    spot.classList.toggle('parking-free', !hasUnit && !isBlocked);
    spot.classList.toggle('parking-reserved', isReserved);
    spot.classList.toggle('parking-blocked', isBlocked);
    if (hasUnit) occupied += 1;
    if (isReserved) reserved += 1;
    if (isBlocked) blocked += 1;
  });

  const total = spots.length;
  const free = Math.max(0, total - occupied - blocked);
  const withoutSlot = (limbo?.children.length || 0) + (taller?.children.length || 0);
  const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;

  const values = {
    'kpi-total': total,
    'kpi-listos': occupied,
    'kpi-sucios': free,
    'kpi-manto': reserved,
    'kpi-patio': blocked,
    'kpi-taller-loc': withoutSlot
  };
  Object.entries(values).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  });

  const text = document.querySelector('[data-parking-occupancy-text]');
  const bar = document.querySelector('[data-parking-occupancy-bar]');
  if (text) text.textContent = `${occupied}/${total} ocupados`;
  if (bar) bar.style.width = `${pct}%`;
  document.body.dataset.parkingOccupancy = pct >= 90 ? 'critica' : (pct >= 75 ? 'alta' : 'normal');
  applyEstacionamientoFilter(root);
  return true;
}
