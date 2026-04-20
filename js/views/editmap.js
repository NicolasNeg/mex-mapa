// ═══════════════════════════════════════════════════════════
//  /js/views/editmap.js — Lógica de la ruta /editmap[/PLAZA]
//
//  Depende de:
//   - Firebase SDK (compat) cargado antes
//   - /js/core/firebase-init.js
//   - /api/mapa.js  (window.api.obtenerEstructuraMapa, guardarEstructuraMapa)
// ═══════════════════════════════════════════════════════════
'use strict';

import { db, auth } from '/js/core/database.js';

// ── Leer plaza desde la URL ──────────────────────────────────
// /editmap         → muestra selector de plaza
// /editmap/BJX     → edita directamente la plaza BJX
const _plazaFromUrl = (() => {
  const segs = window.location.pathname.replace(/\/+$/, '').split('/');
  return (segs[2] || '').trim().toUpperCase() || null;
})();

// ── Estado del editor ────────────────────────────────────────
let _plaza       = _plazaFromUrl;
let _cells       = [];
let _sel         = null;
let _multiSel    = [];
let _mode        = null;
let _zoom        = 1.0;
let _hasPending  = false;
let _userProfile = null;
let _dragCell    = null;
let _dragStartMouse = null;
let _dragStartPos   = null;

const EDITMAP_BOOTSTRAP_PROGRAMMER_EMAILS = Object.freeze([
  'angelarmentta@icloud.com'
]);

function _safeText(value) {
  return String(value || '').trim();
}

function _upperText(value) {
  return _safeText(value).toUpperCase();
}

function _lowerText(value) {
  return _safeText(value).toLowerCase();
}

function _profileDocId(email) {
  return _lowerText(email);
}

function _isBootstrapProgrammerEmail(email) {
  return EDITMAP_BOOTSTRAP_PROGRAMMER_EMAILS.includes(_profileDocId(email));
}

async function _ensureBootstrapProgrammerProfile(user) {
  const email = _profileDocId(user?.email || '');
  if (!email || !_isBootstrapProgrammerEmail(email)) return null;

  const nombre = _upperText(user?.displayName || 'PROGRAMADOR') || 'PROGRAMADOR';
  const payload = {
    email,
    nombre,
    usuario: nombre,
    rol: 'PROGRAMADOR',
    isAdmin: true,
    isGlobal: true,
    plazaAsignada: '',
    telefono: '',
    status: 'ACTIVO',
    authUid: _safeText(user?.uid),
    bootstrapProgrammer: true,
    lastBootstrapLoginAt: Date.now()
  };

  await db.collection('usuarios').doc(email).set(payload, { merge: true });
  return { id: email, ...payload };
}

// ── Auth guard ───────────────────────────────────────────────
auth.onAuthStateChanged(async user => {
  if (!user) { window.location.replace('/login'); return; }
  await _loadUserProfile(user);
  _boot();
});

async function _loadUserProfile(user) {
  const email = _profileDocId(user?.email || '');
  try {
    const candidates = [];

    if (email) {
      const byEmailDoc = await db.collection('usuarios').doc(email).get();
      if (byEmailDoc.exists) candidates.push({ id: byEmailDoc.id, ...byEmailDoc.data(), email });

      const byEmailQuery = await db.collection('usuarios').where('email', '==', email).limit(3).get();
      byEmailQuery.forEach(doc => {
        candidates.push({ id: doc.id, ...doc.data(), email });
      });
    }

    if ((!candidates.length) && _safeText(user?.uid)) {
      const byUidDoc = await db.collection('usuarios').doc(user.uid).get();
      if (byUidDoc.exists) {
        candidates.push({ id: byUidDoc.id, ...byUidDoc.data(), email });
      }
    }

    const bestMatch = candidates.find(item => item.id === email)
      || candidates.find(item => item.id === _safeText(user?.uid))
      || candidates[0];

    if (bestMatch) {
      _userProfile = { ...bestMatch };
      return;
    }

    if (_isBootstrapProgrammerEmail(email)) {
      _userProfile = await _ensureBootstrapProgrammerProfile(user);
      return;
    }

    _userProfile = {
      id: email || _safeText(user?.uid),
      email,
      nombre: _upperText(user?.displayName || email || 'USUARIO'),
      plazaAsignada: '',
      rol: '',
      status: 'ACTIVO'
    };
  } catch (e) {
    console.warn('[editmap] profile load:', e);
    _userProfile = {
      id: email || _safeText(user?.uid),
      email,
      nombre: _upperText(user?.displayName || email || 'USUARIO'),
      plazaAsignada: '',
      rol: '',
      status: 'ACTIVO'
    };
  }
}

// ── Arranque ─────────────────────────────────────────────────
async function _boot() {
  // Si la URL ya trae plaza, usarla directo
  if (_plazaFromUrl) {
    _plaza = _plazaFromUrl;
    _iniciarEditor();
    return;
  }

  // Sin plaza en URL: intentar resolver del perfil del usuario
  const plazaUsuario = (_userProfile?.plazaAsignada || '').trim().toUpperCase();

  if (plazaUsuario) {
    // Redirigir a /editmap/PLAZA para que la URL sea correcta y compartible
    window.location.replace('/editmap/' + plazaUsuario);
    return;
  }

  // PROGRAMADOR u otros sin plaza asignada → mostrar selector
  _mostrarSelectorPlaza();
}

// ── Selector de plaza (para PROGRAMADOR / sin plaza asignada) ─
async function _mostrarSelectorPlaza() {
  _showLoading(false);

  // Obtener plazas disponibles de la configuración
  let plazas = [];
  try {
    const empresaSnap = await db.collection('configuracion').doc('empresa').get();
    const empresaData = empresaSnap.exists ? empresaSnap.data() : {};
    plazas = Array.isArray(empresaData?.plazas)
      ? empresaData.plazas.map(_upperText).filter(Boolean)
      : [];
  } catch (e) {
    console.warn('[editmap] no se pudieron leer plazas desde configuracion/empresa:', e);
  }

  if (!plazas.length) {
    try {
      const snap = await db.collection('configuracion').get();
      snap.forEach(doc => {
        const id = _upperText(doc.id);
        if (id && id !== 'EMPRESA' && id !== 'LISTAS') plazas.push(id);
      });
    } catch (_) { /* ignore */ }
  }

  plazas = [...new Set(plazas)].sort();

  // Si solo hay una plaza, ir directo
  if (plazas.length === 1) {
    window.location.replace('/editmap/' + plazas[0]);
    return;
  }

  const canvas = document.getElementById('editmap-canvas');
  if (!canvas) return;

  canvas.innerHTML = `
    <div style="
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      height:100%; gap:20px; padding:32px;
    ">
      <span class="material-icons" style="font-size:56px; color:#38bdf8;">map</span>
      <div style="text-align:center;">
        <h2 style="font-size:20px; font-weight:900; color:#f1f5f9; margin:0 0 8px;">Selecciona una plaza</h2>
        <p style="font-size:13px; color:#64748b; margin:0;">Elige la plaza cuyo mapa deseas editar.</p>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:12px; justify-content:center; max-width:480px;">
        ${plazas.length
          ? plazas.map(p => `
              <button onclick="window.location.href='/editmap/${p}'" style="
                padding:14px 28px; background:linear-gradient(135deg,#0d2348,#1a53a0);
                color:#fff; border:1px solid rgba(96,165,250,0.3); border-radius:12px;
                font-size:15px; font-weight:800; cursor:pointer; font-family:inherit;
                transition:all 0.2s; min-width:100px;
              " onmouseover="this.style.transform='translateY(-2px)'"
                onmouseout="this.style.transform=''">
                ${p}
              </button>
            `).join('')
          : `<p style="color:#ef4444; font-size:14px;">No se encontraron plazas configuradas.</p>`
        }
      </div>
      <a href="/mapa" style="color:#64748b; font-size:13px; margin-top:8px;">← Volver al mapa</a>
    </div>
  `;
}

// ── Iniciar editor con plaza ya definida ─────────────────────
async function _iniciarEditor() {
  // Actualizar badge de plaza en topbar
  const pill  = document.getElementById('editmap-plaza-pill');
  const label = document.getElementById('editmap-plaza-label');
  if (pill && label) {
    label.textContent = _plaza;
    pill.style.display = 'flex';
  }

  // Actualizar título de la página
  document.title = `Editor — ${_plaza}`;

  await _cargarEstructura();
  _bindKeyboard();
  _bindCanvasClick();
  _bindInspectorInputs();
}

// ── Cargar estructura desde Firestore ────────────────────────
async function _cargarEstructura() {
  _showLoading(true);
  try {
    // Esperar a que window.api esté lista (max 3s)
    let attempts = 0;
    while (!window.api?.obtenerEstructuraMapa && attempts < 30) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    if (!window.api?.obtenerEstructuraMapa) throw new Error('API no disponible después de 3s');

    const estructura = await window.api.obtenerEstructuraMapa(_plaza);
    _cells = _normalizar(estructura);
    _renderGrid();
    _showLoading(false);
  } catch (err) {
    console.error('[editmap] cargar:', err);
    _showError('No se pudo cargar la estructura de ' + _plaza + '.<br>' + (err.message || ''));
  }
}

function _normalizar(estructura) {
  if (!estructura) return [];
  const items = Array.isArray(estructura) ? estructura : (estructura.items || []);
  return items.map((c, i) => ({
    id:       c.id || ('ec_' + i + '_' + Math.random().toString(36).substr(2, 5)),
    valor:    c.valor || '',
    tipo:     c.tipo  || 'cajon',
    esLabel:  c.esLabel || false,
    x:        Number(c.x) || (i % 10) * 90,
    y:        Number(c.y) || Math.floor(i / 10) * 74,
    width:    Number(c.width)  || 80,
    height:   Number(c.height) || 60,
    rotation: Number(c.rotation) || 0,
    orden:    c.orden ?? i,
    zone:               c.zone ?? null,
    subzone:            c.subzone ?? null,
    isReserved:         c.isReserved === true,
    isBlocked:          c.isBlocked === true,
    isTemporaryHolding: c.isTemporaryHolding === true,
    allowedCategories:  Array.isArray(c.allowedCategories) ? [...c.allowedCategories] : [],
    priority:           Number(c.priority) || 0,
    googleMapsUrl:      c.googleMapsUrl ?? null,
    pathType:           c.pathType ?? null
  }));
}

// ── Render del grid ──────────────────────────────────────────
const _ED_BG     = { cajon: '#0d2040', area: '#1a0d40', label: '#0d2214' };
const _ED_BORDER = { cajon: '#2563eb', area: '#7c3aed', label: '#16a34a' };

function _renderGrid() {
  const grid = document.getElementById('editmap-grid');
  if (!grid) return;
  grid.innerHTML = '';
  grid.style.cssText = 'position:absolute; inset:0; overflow:auto; transform-origin:0 0;';
  grid.style.transform = `scale(${_zoom})`;

  // Contenedor interno para el mapa
  let container = grid.querySelector('.ed-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'ed-container';
    container.style.cssText = 'position:relative; min-width:1200px; min-height:800px;';
    grid.appendChild(container);
  } else {
    container.innerHTML = '';
  }

  _cells.forEach(cell => {
    const el = document.createElement('div');
    el.dataset.id = cell.id;
    const isSel = cell.id === _sel || _multiSel.includes(cell.id);
    Object.assign(el.style, {
      position:       'absolute',
      left:           cell.x + 'px',
      top:            cell.y + 'px',
      width:          cell.width  + 'px',
      height:         cell.height + 'px',
      background:     _ED_BG[cell.tipo] || _ED_BG.cajon,
      border:         `2px solid ${isSel ? '#f59e0b' : (_ED_BORDER[cell.tipo] || '#2563eb')}`,
      borderRadius:   cell.tipo === 'label' ? '6px' : '10px',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      fontSize:       '12px',
      fontWeight:     '700',
      color:          '#e2e8f0',
      cursor:         'move',
      userSelect:     'none',
      boxSizing:      'border-box',
      overflow:       'hidden',
      whiteSpace:     'nowrap',
      textOverflow:   'ellipsis',
      boxShadow:      isSel ? '0 0 0 3px rgba(245,158,11,0.4)' : '0 2px 8px rgba(0,0,0,0.4)',
      transition:     'box-shadow 0.1s',
      transform:      cell.rotation ? `rotate(${cell.rotation}deg)` : '',
    });
    el.textContent = cell.valor || (cell.tipo === 'cajon' ? '' : cell.tipo[0].toUpperCase());

    el.addEventListener('mousedown',  e => _startDrag(e, cell.id));
    el.addEventListener('touchstart', e => _startDragTouch(e, cell.id), { passive: false });
    el.addEventListener('click',      e => { e.stopPropagation(); _seleccionar(cell.id); });

    container.appendChild(el);
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
  const cell  = _cells.find(c => c.id === _sel);
  const empty = document.getElementById('editmap-inspector-empty');
  const form  = document.getElementById('editmap-inspector-form');
  if (!cell) {
    if (empty) empty.style.display = 'block';
    if (form)  form.style.display  = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (form)  form.style.display  = 'block';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('ep-nombre',   cell.valor);
  set('ep-tipo',     cell.tipo);
  set('ep-x',        Math.round(cell.x));
  set('ep-y',        Math.round(cell.y));
  set('ep-width',    cell.width);
  set('ep-height',   cell.height);
  set('ep-rotation', cell.rotation || 0);
}

// ── Drag & drop ──────────────────────────────────────────────
function _startDrag(e, id) {
  if (_mode) return;
  e.preventDefault();
  e.stopPropagation();
  _seleccionar(id);
  const cell = _cells.find(c => c.id === id);
  _dragCell       = id;
  _dragStartMouse = { x: e.clientX, y: e.clientY };
  _dragStartPos   = { x: cell.x, y: cell.y };

  const onMove = ev => {
    const c = _cells.find(cc => cc.id === _dragCell);
    if (!c) return;
    c.x = _dragStartPos.x + (ev.clientX - _dragStartMouse.x) / _zoom;
    c.y = _dragStartPos.y + (ev.clientY - _dragStartMouse.y) / _zoom;
    _renderGrid();
    _hasPending = true;
  };
  const onUp = () => {
    _dragCell = null;
    _updateInspector();
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function _startDragTouch(e, id) {
  if (_mode) return;
  e.preventDefault();
  _seleccionar(id);
  const t = e.touches[0];
  const cell = _cells.find(c => c.id === id);
  _dragCell       = id;
  _dragStartMouse = { x: t.clientX, y: t.clientY };
  _dragStartPos   = { x: cell.x, y: cell.y };

  const onMove = ev => {
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
    _updateInspector();
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
  };
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
}

// ── Clic en canvas vacío ─────────────────────────────────────
function _bindCanvasClick() {
  const canvas = document.getElementById('editmap-canvas');
  if (!canvas) return;
  canvas.addEventListener('click', e => {
    if (e.target === canvas || e.target.id === 'editmap-grid') {
      if (_mode) {
        const rect = canvas.getBoundingClientRect();
        _agregarCelda(
          (e.clientX - rect.left) / _zoom,
          (e.clientY - rect.top)  / _zoom,
          _mode
        );
      } else {
        _sel = null;
        _renderGrid();
        _updateInspector();
      }
    }
  });
}

// ── Inspector inputs → celda ─────────────────────────────────
function _bindInspectorInputs() {
  ['ep-nombre','ep-tipo','ep-x','ep-y','ep-width','ep-height','ep-rotation'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', _onInspectorChange);
  });
}

function _onInspectorChange() {
  const cell = _cells.find(c => c.id === _sel);
  if (!cell) return;
  const get  = id => document.getElementById(id)?.value;
  cell.valor    = get('ep-nombre') || '';
  cell.tipo     = get('ep-tipo')   || 'cajon';
  cell.x        = parseFloat(get('ep-x'))        || 0;
  cell.y        = parseFloat(get('ep-y'))        || 0;
  cell.width    = Math.max(40, parseFloat(get('ep-width'))  || 80);
  cell.height   = Math.max(30, parseFloat(get('ep-height')) || 60);
  cell.rotation = parseFloat(get('ep-rotation')) || 0;
  _hasPending   = true;
  _renderGrid();
}

// ── Agregar celda ────────────────────────────────────────────
function _agregarCelda(x, y, tipo) {
  const cell = {
    id:       'ec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    valor:    tipo === 'label' ? 'ETIQUETA' : '',
    tipo,
    esLabel:  tipo === 'label',
    x:        Math.round(x - 40),
    y:        Math.round(y - 30),
    width:    tipo === 'label' ? 100 : 80,
    height:   tipo === 'label' ? 36  : 60,
    rotation: 0,
    orden:    _cells.length,
    zone: null,
    subzone: null,
    isReserved: false,
    isBlocked: false,
    isTemporaryHolding: false,
    allowedCategories: [],
    priority: 0,
    googleMapsUrl: null,
    pathType: null
  };
  _cells.push(cell);
  _hasPending = true;
  _seleccionar(cell.id);
}

// ── API pública (llamada desde botones en HTML) ───────────────
window.editmap_setMode = function(tipo) {
  _mode = (_mode === tipo) ? null : tipo;
  ['cajon','area','label'].forEach(t => {
    const btn = document.getElementById('editmap-btn-' + t);
    if (btn) btn.classList.toggle('active', _mode === t);
  });
  const hint = document.getElementById('editmap-add-hint');
  if (hint) hint.style.display = _mode ? 'flex' : 'none';
};

window.editmap_insertar = function(tipo = 'cajon') {
  const canvas = document.getElementById('editmap-canvas');
  if (!canvas) return;
  const r = canvas.getBoundingClientRect();
  _agregarCelda(r.width / 2 / _zoom, r.height / 2 / _zoom, tipo);
};

window.editmap_agregarForma = function(tipo = 'cajon') {
  window.editmap_insertar(tipo);
};

window.editmap_eliminar = function() {
  if (!_sel) return;
  _cells = _cells.filter(c => c.id !== _sel);
  _sel = null;
  _hasPending = true;
  _renderGrid();
  _updateInspector();
};

window.editmap_duplicar = function() {
  const cell = _cells.find(c => c.id === _sel);
  if (!cell) return;
  const copy = { ...cell, id: 'ec_' + Date.now(), x: cell.x + 20, y: cell.y + 20 };
  _cells.push(copy);
  _hasPending = true;
  _seleccionar(copy.id);
};

window.editmap_moverFlecha = function(dx, dy) {
  const cell = _cells.find(c => c.id === _sel);
  if (!cell) return;
  cell.x += dx;
  cell.y += dy;
  _hasPending = true;
  _renderGrid();
  _updateInspector();
};

window.editmap_ajustarTamano = function(prop, delta) {
  const cell = _cells.find(c => c.id === _sel);
  if (!cell) return;
  if (prop === 'width')  cell.width  = Math.max(40, (cell.width  || 80) + delta);
  if (prop === 'height') cell.height = Math.max(30, (cell.height || 60) + delta);
  _hasPending = true;
  _renderGrid();
  _updateInspector();
};

window.editmap_zoom = function(delta) {
  _zoom = delta === 0 ? 1.0 : Math.max(0.2, Math.min(3, _zoom + delta));
  const lbl = document.getElementById('editmap-zoom-label');
  if (lbl) lbl.textContent = Math.round(_zoom * 100) + '%';
  const grid = document.getElementById('editmap-grid');
  if (grid) grid.style.transform = `scale(${_zoom})`;
};

window.editmap_guardar = async function() {
  if (!_plaza) { alert('Sin plaza definida. Accede vía /editmap/PLAZA'); return; }
  const btn = document.getElementById('editmap-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    let attempts = 0;
    while (!window.api?.guardarEstructuraMapa && attempts < 30) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    if (!window.api?.guardarEstructuraMapa) throw new Error('API no disponible');

    const payload = _cells.map((c, index) => ({
      valor: c.valor || '',
      tipo: c.tipo || 'cajon',
      esLabel: c.tipo === 'label' || c.esLabel === true,
      orden: c.orden ?? index,
      x: Math.round(Number(c.x) || 0),
      y: Math.round(Number(c.y) || 0),
      width: Math.round(Number(c.width) || 80),
      height: Math.round(Number(c.height) || 60),
      rotation: Math.round(Number(c.rotation) || 0),
      zone: c.zone ?? null,
      subzone: c.subzone ?? null,
      isReserved: c.isReserved === true,
      isBlocked: c.isBlocked === true,
      isTemporaryHolding: c.isTemporaryHolding === true,
      allowedCategories: Array.isArray(c.allowedCategories) ? [...c.allowedCategories] : [],
      priority: Number(c.priority) || 0,
      googleMapsUrl: c.googleMapsUrl ?? null,
      pathType: c.pathType ?? null
    }));
    await window.api.guardarEstructuraMapa(payload, _plaza);
    _hasPending = false;
    _showSaveToast('✓ Mapa guardado — ' + _plaza);
  } catch (err) {
    console.error('[editmap] guardar:', err);
    alert('Error al guardar: ' + (err.message || err));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'GUARDAR CAMBIOS'; }
  }
};

function _showSaveToast(msg) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#22c55e;color:#fff;padding:10px 22px;border-radius:12px;font-weight:800;font-size:13px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.3);';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// ── Helpers de UI ─────────────────────────────────────────────
function _showLoading(show) {
  const l = document.getElementById('editmap-loading');
  const g = document.getElementById('editmap-grid');
  if (l) l.style.display = show ? 'flex' : 'none';
  if (g) g.style.display = show ? 'none'  : 'block';
}

function _showError(msg) {
  _showLoading(false);
  const canvas = document.getElementById('editmap-canvas');
  if (canvas) {
    canvas.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  height:100%;gap:14px;color:#ef4444;text-align:center;padding:24px;">
        <span class="material-icons" style="font-size:52px;">error_outline</span>
        <p style="font-size:14px;font-weight:700;max-width:380px;line-height:1.6;">${msg}</p>
        <a href="/mapa" style="color:#60a5fa;font-size:13px;margin-top:4px;">← Volver al mapa</a>
      </div>`;
  }
}

// ── Teclado ───────────────────────────────────────────────────
function _bindKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Delete' || e.key === 'Backspace')  window.editmap_eliminar();
    if (e.key === 'Escape') { _sel = null; _mode = null; _renderGrid(); _updateInspector(); }
    if (e.key === 'ArrowLeft')  window.editmap_moverFlecha(-10, 0);
    if (e.key === 'ArrowRight') window.editmap_moverFlecha( 10, 0);
    if (e.key === 'ArrowUp')    window.editmap_moverFlecha(0, -10);
    if (e.key === 'ArrowDown')  window.editmap_moverFlecha(0,  10);
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); window.editmap_guardar(); }
  });
}
