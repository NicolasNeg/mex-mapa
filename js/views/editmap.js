// ═══════════════════════════════════════════════════════════
//  /js/views/editmap.js — Lógica de la ruta /editmap[/PLAZA]
//
//  Depende de:
//   - Firebase SDK (compat) cargado antes
//   - /js/core/firebase-init.js
//   - /api/mapa.js  (window.api.obtenerEstructuraMapa, guardarEstructuraMapa)
//   - /api/auth.js  (auth guard)
// ═══════════════════════════════════════════════════════════
'use strict';

import { db, auth } from '/js/core/database.js';

// ── Leer plaza desde la URL ──────────────────────────────────
// /editmap         → usa la del perfil del usuario
// /editmap/BJX     → fuerza BJX
const _plazaFromUrl = (() => {
  const segs = window.location.pathname.replace(/\/+$/, '').split('/');
  return (segs[2] || '').trim().toUpperCase() || null;
})();

// ── Estado del editor ────────────────────────────────────────
let _plaza       = _plazaFromUrl;  // definido al login si null
let _cells       = [];             // array de celdas del mapa
let _sel         = null;           // celda seleccionada
let _multiSel    = [];
let _mode        = null;           // 'cajon' | 'area' | 'label' | null
let _zoom        = 1.0;
let _drag        = null;           // { cellId, startX, startY, origX, origY }
let _resize      = null;
let _hasPending  = false;
let _userProfile = null;

// ── Auth guard ───────────────────────────────────────────────
auth.onAuthStateChanged(async user => {
  if (!user) { window.location.replace('/login'); return; }
  await _loadUserProfile(user.email);
  _boot();
});

async function _loadUserProfile(email) {
  try {
    const snap = await db.collection('usuarios').doc(email).get();
    if (snap.exists) _userProfile = { id: snap.id, ...snap.data() };
  } catch (e) { console.warn('[editmap] profile load:', e); }
}

function _miPlaza() {
  return _plazaFromUrl
    || window.PLAZA_ACTIVA_MAPA
    || _userProfile?.plazaAsignada
    || '';
}

// ── Arranque ─────────────────────────────────────────────────
async function _boot() {
  _plaza = _miPlaza();

  // Mostrar badge de plaza
  const badge = document.getElementById('editmap-plaza-pill');
  if (badge) badge.textContent = _plaza || '—';

  if (!_plaza) {
    _showError('No se pudo determinar la plaza activa. Vuelve al mapa y selecciona una plaza.');
    return;
  }

  await _cargarEstructura();
  _bindKeyboard();
}

// ── Cargar estructura desde Firestore ────────────────────────
async function _cargarEstructura() {
  _showLoading(true);
  try {
    const api = window.api;
    if (!api?.obtenerEstructuraMapa) throw new Error('API no lista');
    const estructura = await api.obtenerEstructuraMapa(_plaza);
    _cells = _normalizar(estructura);
    _renderGrid();
    _showLoading(false);
  } catch (err) {
    console.error('[editmap] cargar:', err);
    _showError('No se pudo cargar la estructura. ' + (err.message || ''));
  }
}

function _normalizar(estructura) {
  if (!estructura) return [];
  const items = Array.isArray(estructura)
    ? estructura
    : (estructura.items || []);
  return items.map((c, i) => ({
    id:       c.id || ('ec_' + i + '_' + Math.random().toString(36).substr(2,5)),
    valor:    c.valor || '',
    tipo:     c.tipo  || 'cajon',
    esLabel:  c.esLabel || false,
    x:        c.x ?? (i % 10) * 90,
    y:        c.y ?? Math.floor(i / 10) * 70,
    width:    c.width  ?? 80,
    height:   c.height ?? 60,
    rotation: c.rotation ?? 0,
    orden:    c.orden ?? i,
  }));
}

// ── Render del grid ──────────────────────────────────────────
const _ED_COLORS = { cajon: '#1e3a5f', area: '#2d1b69', label: '#1a2e1a' };
const _ED_BORDER = { cajon: '#3b82f6', area: '#8b5cf6', label: '#22c55e' };

function _renderGrid() {
  const grid = document.getElementById('editmap-grid');
  if (!grid) return;

  grid.innerHTML = '';
  grid.style.position = 'relative';
  grid.style.width    = '100%';
  grid.style.height   = '100%';
  grid.style.transform = `scale(${_zoom})`;
  grid.style.transformOrigin = '0 0';

  _cells.forEach(cell => {
    const el = document.createElement('div');
    el.dataset.id = cell.id;
    el.className  = 'editmap-cell' + (cell.id === _sel ? ' selected' : '');
    const isSel   = cell.id === _sel || _multiSel.includes(cell.id);

    Object.assign(el.style, {
      position:        'absolute',
      left:            cell.x + 'px',
      top:             cell.y + 'px',
      width:           cell.width  + 'px',
      height:          cell.height + 'px',
      background:      _ED_COLORS[cell.tipo] || _ED_COLORS.cajon,
      border:          `2px solid ${isSel ? '#f59e0b' : (_ED_BORDER[cell.tipo] || '#3b82f6')}`,
      borderRadius:    cell.tipo === 'label' ? '6px' : '10px',
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      fontSize:        cell.tipo === 'label' ? '11px' : '12px',
      fontWeight:      '700',
      color:           '#e2e8f0',
      cursor:          'move',
      userSelect:      'none',
      transform:       cell.rotation ? `rotate(${cell.rotation}deg)` : '',
      boxShadow:       isSel ? '0 0 0 2px #f59e0b' : 'none',
      overflow:        'hidden',
      textOverflow:    'ellipsis',
      whiteSpace:      'nowrap',
      transition:      'box-shadow 0.15s',
      boxSizing:       'border-box',
    });

    el.textContent = cell.valor || (cell.esLabel ? '…' : cell.tipo[0].toUpperCase());

    // Drag to move
    el.addEventListener('mousedown',  e => _onCellMousedown(e, cell.id));
    el.addEventListener('touchstart', e => _onCellTouchstart(e, cell.id), { passive: false });
    el.addEventListener('click',      e => { e.stopPropagation(); _seleccionar(cell.id); });

    grid.appendChild(el);
  });

  // Resize handles for selected cell
  if (_sel) _addResizeHandles(grid);
}

function _addResizeHandles(grid) {
  const cell = _cells.find(c => c.id === _sel);
  if (!cell) return;
  const positions = ['nw','n','ne','e','se','s','sw','w'];
  positions.forEach(pos => {
    const h = document.createElement('div');
    h.className = 'editmap-resize-handle';
    const isCorner = pos.length === 2;
    const half = isCorner ? 8 : 6;
    const offsets = {
      nw: { left: -half, top: -half },    n:  { left: cell.width/2-half, top: -half },
      ne: { left: cell.width-half, top: -half }, e: { left: cell.width-half, top: cell.height/2-half },
      se: { left: cell.width-half, top: cell.height-half }, s: { left: cell.width/2-half, top: cell.height-half },
      sw: { left: -half, top: cell.height-half }, w: { left: -half, top: cell.height/2-half },
    };
    Object.assign(h.style, {
      position:  'absolute',
      left:      (cell.x + (offsets[pos].left  ?? 0)) + 'px',
      top:       (cell.y + (offsets[pos].top   ?? 0)) + 'px',
      width:     (half * 2) + 'px',
      height:    (half * 2) + 'px',
      background: '#f59e0b',
      border:    '2px solid #fff',
      borderRadius: isCorner ? '4px' : '50%',
      zIndex:    10,
      cursor:    pos + '-resize',
    });
    grid.appendChild(h);
  });
}

// ── Selección ────────────────────────────────────────────────
function _seleccionar(id) {
  _sel = id;
  _multiSel = [];
  _renderGrid();
  _updateInspector();
}

function _updateInspector() {
  const cell = _cells.find(c => c.id === _sel);
  const empty  = document.getElementById('editmap-inspector-empty');
  const form   = document.getElementById('editmap-inspector-form');
  if (!cell) {
    if (empty) empty.style.display = 'block';
    if (form)  form.style.display  = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (form)  form.style.display  = 'block';

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('ep-nombre',   cell.valor);
  set('ep-tipo',     cell.tipo);
  set('ep-x',        cell.x);
  set('ep-y',        cell.y);
  set('ep-width',    cell.width);
  set('ep-height',   cell.height);
  set('ep-rotation', cell.rotation || 0);
}

// ── Drag to move ─────────────────────────────────────────────
let _dragCell = null, _dragStartMouse = null, _dragStartPos = null;

function _onCellMousedown(e, id) {
  if (_mode) return; // si hay modo agregar, no drag
  e.preventDefault();
  _seleccionar(id);
  _dragCell     = id;
  _dragStartMouse = { x: e.clientX, y: e.clientY };
  const cell    = _cells.find(c => c.id === id);
  _dragStartPos = { x: cell.x, y: cell.y };

  const onMove = ev => {
    if (!_dragCell) return;
    const c = _cells.find(cc => cc.id === _dragCell);
    if (!c) return;
    c.x = _dragStartPos.x + (ev.clientX - _dragStartMouse.x) / _zoom;
    c.y = _dragStartPos.y + (ev.clientY - _dragStartMouse.y) / _zoom;
    _renderGrid();
    _hasPending = true;
  };
  const onUp = () => {
    _dragCell = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function _onCellTouchstart(e, id) {
  if (_mode) return;
  e.preventDefault();
  _seleccionar(id);
  const t = e.touches[0];
  _dragCell     = id;
  _dragStartMouse = { x: t.clientX, y: t.clientY };
  const cell    = _cells.find(c => c.id === id);
  _dragStartPos = { x: cell.x, y: cell.y };

  const onMove = ev => {
    if (!_dragCell) return;
    const touch = ev.touches[0];
    const c = _cells.find(cc => cc.id === _dragCell);
    if (!c) return;
    c.x = _dragStartPos.x + (touch.clientX - _dragStartMouse.x) / _zoom;
    c.y = _dragStartPos.y + (touch.clientY - _dragStartMouse.y) / _zoom;
    _renderGrid();
    _hasPending = true;
  };
  const onEnd = () => {
    _dragCell = null;
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
  };
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
}

// ── Clic en canvas: agregar nueva celda ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('editmap-canvas');
  if (canvas) {
    canvas.addEventListener('click', e => {
      if (!_mode || e.target !== canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / _zoom;
      const y = (e.clientY - rect.top)  / _zoom;
      _agregarCelda(x, y, _mode);
    });
    canvas.addEventListener('click', e => {
      if (e.target === canvas) { _sel = null; _multiSel = []; _renderGrid(); _updateInspector(); }
    });
  }

  // Inspector inputs → actualizar celda en tiempo real
  ['ep-nombre','ep-tipo','ep-x','ep-y','ep-width','ep-height','ep-rotation'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', _onInspectorChange);
  });
});

function _onInspectorChange() {
  const cell = _cells.find(c => c.id === _sel);
  if (!cell) return;
  const get = id => document.getElementById(id)?.value;
  cell.valor    = get('ep-nombre') || '';
  cell.tipo     = get('ep-tipo')   || 'cajon';
  cell.x        = parseFloat(get('ep-x'))        || 0;
  cell.y        = parseFloat(get('ep-y'))        || 0;
  cell.width    = Math.max(40, parseFloat(get('ep-width'))  || 80);
  cell.height   = Math.max(30, parseFloat(get('ep-height')) || 60);
  cell.rotation = parseFloat(get('ep-rotation')) || 0;
  _hasPending = true;
  _renderGrid();
}

// ── Agregar celda ────────────────────────────────────────────
function _agregarCelda(x, y, tipo) {
  const cell = {
    id:       'ec_' + Date.now() + '_' + Math.random().toString(36).substr(2,4),
    valor:    tipo === 'label' ? 'ETIQUETA' : '',
    tipo,
    esLabel:  tipo === 'label',
    x:        Math.round(x - 40),
    y:        Math.round(y - 30),
    width:    tipo === 'label' ? 100 : 80,
    height:   tipo === 'label' ? 36  : 60,
    rotation: 0,
    orden:    _cells.length,
  };
  _cells.push(cell);
  _hasPending = true;
  _seleccionar(cell.id);
}

// ── Toolbar pública ───────────────────────────────────────────
window.editmap_setMode = function(tipo) {
  _mode = (_mode === tipo) ? null : tipo;
  // Actualizar botones activos
  ['cajon','area','label'].forEach(t => {
    const btn = document.getElementById('editmap-btn-' + t);
    if (btn) btn.classList.toggle('active', _mode === t);
  });
  const hint = document.getElementById('editmap-add-hint');
  if (hint) hint.style.display = _mode ? 'flex' : 'none';
};

window.editmap_agregarForma = function(tipo) {
  const canvas = document.getElementById('editmap-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  _agregarCelda(rect.width / 2, rect.height / 2, tipo);
};

window.editmap_eliminar = function() {
  if (!_sel) return;
  _cells = _cells.filter(c => c.id !== _sel);
  _sel = null; _multiSel = [];
  _hasPending = true;
  _renderGrid(); _updateInspector();
};

window.editmap_duplicar = function() {
  const cell = _cells.find(c => c.id === _sel);
  if (!cell) return;
  const copy = { ...cell, id: 'ec_' + Date.now(), x: cell.x + 15, y: cell.y + 15 };
  _cells.push(copy);
  _hasPending = true;
  _seleccionar(copy.id);
};

window.editmap_moverFlecha = function(dx, dy) {
  const cell = _cells.find(c => c.id === _sel);
  if (!cell) return;
  cell.x += dx; cell.y += dy;
  _hasPending = true;
  _renderGrid(); _updateInspector();
};

window.editmap_zoom = function(delta) {
  if (delta === 0) { _zoom = 1.0; }
  else { _zoom = Math.max(0.3, Math.min(3, _zoom + delta)); }
  const label = document.getElementById('editmap-zoom-label');
  if (label) label.textContent = Math.round(_zoom * 100) + '%';
  _renderGrid();
};

// ── Guardar ───────────────────────────────────────────────────
window.editmap_guardar = async function() {
  if (!_plaza) {
    alert('No hay plaza seleccionada. No se puede guardar.');
    return;
  }
  const btn = document.getElementById('editmap-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const api = window.api;
    if (!api?.guardarEstructuraMapa) throw new Error('API no lista');
    const payload = { items: _cells.map(c => ({ ...c })), _version: Date.now() };
    await api.guardarEstructuraMapa(payload, _plaza);
    _hasPending = false;
    _showSaveOk();
  } catch (err) {
    console.error('[editmap] guardar:', err);
    alert('Error al guardar: ' + (err.message || err));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'GUARDAR CAMBIOS'; }
  }
};

function _showSaveOk() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#22c55e;color:#fff;padding:10px 20px;border-radius:12px;font-weight:700;font-size:13px;z-index:9999;';
  el.textContent = '✓ Mapa guardado';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ── Helpers de UI ─────────────────────────────────────────────
function _showLoading(show) {
  const l = document.getElementById('editmap-loading');
  const g = document.getElementById('editmap-grid');
  if (l) l.style.display = show ? 'flex' : 'none';
  if (g) g.style.display = show ? 'none' : 'block';
}

function _showError(msg) {
  _showLoading(false);
  const canvas = document.getElementById('editmap-canvas');
  if (canvas) {
    canvas.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:#ef4444;text-align:center;padding:24px;">
      <span class="material-icons" style="font-size:48px;">error_outline</span>
      <p style="font-size:14px;font-weight:700;max-width:360px;">${msg}</p>
      <a href="/mapa" style="color:#60a5fa;font-size:13px;">← Volver al mapa</a>
    </div>`;
  }
}

// ── Teclado ───────────────────────────────────────────────────
function _bindKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Delete' || e.key === 'Backspace') window.editmap_eliminar();
    if (e.key === 'Escape') { _sel = null; _multiSel = []; _mode = null; _renderGrid(); _updateInspector(); }
    if (e.key === 'ArrowLeft')  window.editmap_moverFlecha(-10, 0);
    if (e.key === 'ArrowRight') window.editmap_moverFlecha( 10, 0);
    if (e.key === 'ArrowUp')    window.editmap_moverFlecha(0, -10);
    if (e.key === 'ArrowDown')  window.editmap_moverFlecha(0,  10);
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); window.editmap_guardar(); }
  });
}
