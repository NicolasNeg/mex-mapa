/**
 * js/views/incidencias.js
 * Kanban de Incidencias — Fase 5.4
 *
 * Página standalone. No importa ni depende de mapa.js.
 * Firestore: colección global `incidencias` (documentos por plaza).
 * Subcollección: plazas/{plaza}/incidencias
 */

'use strict';

// ── Config ────────────────────────────────────────────────────

const COLS = [
  { id: 'abierta',    label: 'ABIERTA',     icon: 'radio_button_unchecked' },
  { id: 'en_proceso', label: 'EN PROCESO',  icon: 'autorenew' },
  { id: 'resuelta',   label: 'RESUELTA',    icon: 'check_circle' },
  { id: 'cerrada',    label: 'CERRADA',     icon: 'lock' },
];

const TIPOS = ['MECANICA', 'LIMPIEZA', 'ACCIDENTE', 'DOCUMENTOS', 'OTRO'];
const PRIORIDADES = ['alta', 'media', 'baja'];

let _auth, _db;
let _currentUser  = null;
let _currentPlaza = '';
let _incidencias  = [];
let _filtroTipo   = 'TODOS';
let _unsubscribe  = null;

// ── Bootstrap ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  _auth = window.firebase?.apps?.length ? firebase.auth() : null;
  _db   = window.firebase?.apps?.length ? firebase.firestore() : null;

  if (!_auth || !_db) {
    _toast('No se pudo conectar con Firebase.', 'error');
    return;
  }

  _renderBoard();
  _bindModalNueva();

  _auth.onAuthStateChanged(user => {
    if (!user) {
      window.location.href = '/login';
      return;
    }
    _currentUser = user;
    _cargarPerfilUsuario(user);
  });
});

// ── Perfil y plaza ────────────────────────────────────────────

async function _cargarPerfilUsuario(user) {
  const email = (user.email || '').toLowerCase().trim();

  const avatarEl = document.getElementById('inc-avatar');
  const nameEl   = document.getElementById('inc-username');
  if (nameEl) nameEl.textContent = user.displayName || email;
  if (avatarEl) {
    const iniciales = (user.displayName || email)
      .split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '??';
    avatarEl.textContent = iniciales;
  }

  try {
    const snap = await _db.collection('usuarios').doc(email).get();
    const data = snap.exists ? snap.data() : {};
    _currentPlaza = (data.plazaAsignada || data.plaza || '').toUpperCase().trim();

    const plazaEl = document.getElementById('inc-plaza');
    if (plazaEl) plazaEl.textContent = _currentPlaza || 'GLOBAL';

    _suscribirIncidencias();
  } catch (e) {
    console.error('[incidencias] _cargarPerfilUsuario:', e);
    _suscribirIncidencias();
  }
}

// ── Firestore ─────────────────────────────────────────────────

function _colRef() {
  if (_currentPlaza) {
    return _db.collection('plazas').doc(_currentPlaza).collection('incidencias');
  }
  return _db.collection('incidencias');
}

function _suscribirIncidencias() {
  if (_unsubscribe) _unsubscribe();

  _mostrarSkeletons();

  _unsubscribe = _colRef()
    .orderBy('creadoEn', 'desc')
    .onSnapshot(snap => {
      _incidencias = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _renderBoard();
    }, err => {
      console.error('[incidencias] onSnapshot:', err);
      _toast('Error al cargar incidencias.', 'error');
    });
}

async function _guardarIncidencia(data) {
  try {
    await _colRef().add({
      ...data,
      creadoEn:    firebase.firestore.FieldValue.serverTimestamp(),
      creadoPor:   _currentUser?.email || '',
      estado:      'abierta',
    });
    _toast('Incidencia creada.', 'success');
  } catch (e) {
    console.error('[incidencias] _guardarIncidencia:', e);
    _toast('No se pudo guardar la incidencia.', 'error');
    throw e;
  }
}

async function _moverIncidencia(id, nuevoEstado) {
  try {
    await _colRef().doc(id).update({
      estado:       nuevoEstado,
      actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoPor: _currentUser?.email || '',
    });
  } catch (e) {
    console.error('[incidencias] _moverIncidencia:', e);
    _toast('No se pudo mover la incidencia.', 'error');
  }
}

async function _cerrarIncidencia(id) {
  try {
    await _colRef().doc(id).update({
      estado:       'cerrada',
      cerradoEn:    firebase.firestore.FieldValue.serverTimestamp(),
      cerradoPor:   _currentUser?.email || '',
    });
    _toast('Incidencia cerrada.', 'success');
  } catch (e) {
    console.error('[incidencias] _cerrarIncidencia:', e);
    _toast('Error al cerrar la incidencia.', 'error');
  }
}

// ── Render Kanban ─────────────────────────────────────────────

function _renderBoard() {
  COLS.forEach(col => {
    const container = document.getElementById(`col-${col.id}`);
    const countEl   = document.getElementById(`count-${col.id}`);
    if (!container) return;

    const items = _incidencias.filter(i =>
      i.estado === col.id &&
      (_filtroTipo === 'TODOS' || i.tipo === _filtroTipo)
    );

    if (countEl) countEl.textContent = items.length;

    if (!items.length) {
      container.innerHTML = `
        <div class="inc-col-empty">
          <span class="material-icons">inbox</span>
          Sin incidencias
        </div>`;
      return;
    }

    container.innerHTML = items.map(inc => _cardHtml(inc)).join('');

    container.querySelectorAll('.inc-card').forEach(card => {
      card.addEventListener('click', () => _abrirDetalle(card.dataset.id));
    });
  });
}

function _cardHtml(inc) {
  const fecha = inc.creadoEn?.toDate
    ? inc.creadoEn.toDate().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })
    : '--';
  return `
    <div class="inc-card" data-id="${_esc(inc.id)}">
      <div class="inc-card-prioridad" data-p="${_esc(inc.prioridad || 'baja')}"></div>
      <div class="inc-card-mva">${_esc(inc.mva || 'SIN UNIDAD')}</div>
      <div class="inc-card-titulo">${_esc(inc.titulo || 'Sin título')}</div>
      <div class="inc-card-meta">
        <span class="inc-card-tipo" data-tipo="${_esc(inc.tipo || 'OTRO')}">${_esc(inc.tipo || 'OTRO')}</span>
        <span class="inc-card-fecha">${fecha}</span>
      </div>
      ${inc.responsable ? `
        <div class="inc-card-responsable">
          <span class="material-icons">person</span>
          ${_esc(inc.responsable)}
        </div>` : ''}
    </div>`;
}

function _mostrarSkeletons() {
  const skel = `
    <div class="inc-skeleton-card">
      <div class="inc-skeleton-line short"></div>
      <div class="inc-skeleton-line medium"></div>
      <div class="inc-skeleton-line short"></div>
    </div>`;
  COLS.forEach(col => {
    const container = document.getElementById(`col-${col.id}`);
    if (container) container.innerHTML = skel + skel;
  });
}

// ── Modal — nueva incidencia ──────────────────────────────────

function _bindModalNueva() {
  const overlay = document.getElementById('inc-modal-nueva');
  const btnNueva = document.getElementById('btnNuevaIncidencia');
  const btnClose = document.getElementById('inc-modal-close');
  const btnCancel = document.getElementById('inc-btn-cancel');
  const form = document.getElementById('inc-form');

  if (btnNueva)  btnNueva.addEventListener('click', () => overlay?.classList.add('active'));
  if (btnClose)  btnClose.addEventListener('click', () => overlay?.classList.remove('active'));
  if (btnCancel) btnCancel.addEventListener('click', () => overlay?.classList.remove('active'));

  overlay?.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('active');
  });

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('inc-btn-save');
    if (btn) { btn.disabled = true; btn.textContent = 'GUARDANDO...'; }

    const data = {
      mva:         document.getElementById('inc-f-mva').value.trim().toUpperCase(),
      titulo:      document.getElementById('inc-f-titulo').value.trim(),
      tipo:        document.getElementById('inc-f-tipo').value,
      prioridad:   document.getElementById('inc-f-prioridad').value,
      descripcion: document.getElementById('inc-f-descripcion').value.trim(),
      responsable: document.getElementById('inc-f-responsable').value.trim(),
      plaza:       _currentPlaza,
    };

    try {
      await _guardarIncidencia(data);
      form.reset();
      overlay?.classList.remove('active');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'GUARDAR INCIDENCIA'; }
    }
  });
}

// ── Modal — detalle ───────────────────────────────────────────

function _abrirDetalle(id) {
  const inc = _incidencias.find(i => i.id === id);
  if (!inc) return;

  const overlay = document.getElementById('inc-modal-detalle');
  if (!overlay) return;

  const fecha = inc.creadoEn?.toDate
    ? inc.creadoEn.toDate().toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '--';

  document.getElementById('inc-det-mva').textContent        = inc.mva || 'SIN UNIDAD';
  document.getElementById('inc-det-titulo').textContent     = inc.titulo || '--';
  document.getElementById('inc-det-tipo').textContent       = inc.tipo || '--';
  document.getElementById('inc-det-prioridad').textContent  = (inc.prioridad || '--').toUpperCase();
  document.getElementById('inc-det-descripcion').textContent = inc.descripcion || '(Sin descripción)';
  document.getElementById('inc-det-responsable').textContent = inc.responsable || '(No asignado)';
  document.getElementById('inc-det-fecha').textContent      = fecha;
  document.getElementById('inc-det-por').textContent        = inc.creadoPor || '--';
  document.getElementById('inc-det-estado').textContent     = inc.estado?.toUpperCase().replace('_', ' ') || '--';

  // Botones de movimiento
  const btnArea = document.getElementById('inc-det-move-btns');
  btnArea.innerHTML = '';
  COLS.filter(c => c.id !== inc.estado).forEach(col => {
    const btn = document.createElement('button');
    btn.className = 'inc-col-btn';
    btn.innerHTML = `<span class="material-icons">${col.icon}</span> MOVER A ${col.label}`;
    btn.addEventListener('click', async () => {
      overlay.classList.remove('active');
      await _moverIncidencia(id, col.id);
    });
    btnArea.appendChild(btn);
  });

  // Botón cerrar
  const btnCerrar = document.getElementById('inc-btn-cerrar');
  if (btnCerrar) {
    btnCerrar.style.display = inc.estado === 'cerrada' ? 'none' : 'block';
    btnCerrar.onclick = async () => {
      overlay.classList.remove('active');
      await _cerrarIncidencia(id);
    };
  }

  overlay.classList.add('active');
}

// ── Filtros ───────────────────────────────────────────────────

window.incFiltrar = function(tipo) {
  _filtroTipo = tipo;
  document.querySelectorAll('.inc-filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.tipo === tipo);
  });
  _renderBoard();
};

// ── Toast ─────────────────────────────────────────────────────

function _toast(msg, tipo = 'info') {
  const icons = { success: 'check_circle', error: 'error', warning: 'warning', info: 'info' };
  const el = document.getElementById('inc-toast');
  if (!el) return;
  el.className = `inc-toast ${tipo}`;
  el.innerHTML = `<span class="material-icons">${icons[tipo] || 'info'}</span>${_esc(msg)}`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}

// ── Helpers ───────────────────────────────────────────────────

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Cerrar modales con Escape ─────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.getElementById('inc-modal-nueva')?.classList.remove('active');
  document.getElementById('inc-modal-detalle')?.classList.remove('active');
});

// Cerrar modal detalle al click en overlay
document.getElementById?.('inc-modal-detalle')?.addEventListener('click', e => {
  if (e.target.id === 'inc-modal-detalle')
    e.target.classList.remove('active');
});
