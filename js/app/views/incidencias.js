// ═══════════════════════════════════════════════════════════
//  /js/app/views/incidencias.js
//  Paso 1 — Migración visual al design system de /INCIDENCIAS/
//  Mantiene toda la lógica Firestore (notas_admin), App Shell,
//  filtros, CRUD y caché. Reescribe HTML/UI a la nueva estructura.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { subscribeIncidencias, createIncidencia, resolveIncidencia, deleteIncidencia, updateIncidenciaField, toggleSeguidor, searchUsuarios } from '/js/app/features/incidencias/incidencias-data.js';

let _container = null;
let _state = null;
let _unsubIncidencias = null;
let _unsubPlaza = null;
let _offGlobalSearch = null;
let _cssInjected = false;
let _renderFrame = 0;

const q = id => _container?.querySelector(`#${id}`) || null;
const qsa = sel => Array.from(_container?.querySelectorAll(sel) || []);
const _mexConfirm = (titulo, texto, tipo = 'warning') =>
  typeof window.mexConfirm === 'function' ? window.mexConfirm(titulo, texto, tipo) : Promise.resolve(false);
const _mexPrompt = (titulo, texto, placeholder = '', inputTipo = 'text', valor = '') =>
  typeof window.mexPrompt === 'function' ? window.mexPrompt(titulo, texto, placeholder, inputTipo, valor) : Promise.resolve(null);

function _trackListener(action, name, extra = {}) {
  if (typeof window.__mexTrackListener !== 'function') return;
  window.__mexTrackListener(window.location.pathname, `app/incidencias:${name}`, action, extra);
}

// ─── Tipos de incidencia conocidos (para FilterRail) ───
const TIPOS_KNOWN = ['MECANICA', 'ACCIDENTE', 'LIMPIEZA', 'DOCUMENTOS', 'OTRO'];

function _makeState(plaza) {
  const url = new URL(window.location.href);
  const mvaFromQuery = String(url.searchParams.get('mva') || '').trim().toUpperCase();
  const queryFromUrl = String(url.searchParams.get('q') || '').trim();
  const priorityFilter = { CRITICA: true, ALTA: true, MEDIA: true, BAJA: true };
  const statusFilter = { PENDIENTE: true, EN_PROCESO: true, RESUELTA: true, CERRADA: true };
  const tipoFilter = {};
  TIPOS_KNOWN.forEach(t => { tipoFilter[t] = true; });
  const profile = getState()?.profile || null;
  const myAuthor = String(profile?.email || profile?.nombre || profile?.displayName || '').trim().toLowerCase();
  return {
    plaza,
    allItems: [],
    items: [],
    query: (queryFromUrl || mvaFromQuery).toLowerCase(),
    priorityFilter,
    statusFilter,
    tipoFilter,
    activeTab: 'todas', // 'todas' | 'mias' | 'sin_asignar' | 'vencen_hoy'
    sortBy: 'recent', // 'recent' | 'priority'
    viewMode: 'list', // 'list' | 'table' | 'board'
    selectedId: '',
    selectedIds: [],
    detailOpenId: '',
    resolverTargetId: '',
    mvaFromQuery,
    loading: true,
    errorMessage: '',
    hasPermissionDenied: false,
    archivosNuevaNota: [],
    linksNuevaNota: [],
    descripcionHtmlNuevaNota: '',
    myAuthor,
    // Live state para create dialog
    createDraft: {
      titulo: '',
      descripcion: '',
      prioridad: 'ALTA',
      tipo: 'OTRO',
      mva: ''
    },
    toastTimer: null,
    asignarSelected: null,   // { uid, nombre, email, rol, plaza, isGlobal }
    asignarSearchTerm: '',
    asignarResults: [],
    asignarSearchTimer: null,
  };
}

// ────────────────────────────────────────────────────────────
// MOUNT / UNMOUNT
// ────────────────────────────────────────────────────────────
export async function mount(ctx) {
  _cleanup();
  _container = ctx.container;
  _ensureCss();
  _state = _makeState(String(getCurrentPlaza() || ctx?.state?.currentPlaza || '').toUpperCase().trim());
  _container.innerHTML = _renderLayout();
  _bindUi();
  _applyDraftMeta();
  _prefillMvaFromQuery();
  _bindGlobalSearch();
  _render();

  _unsubPlaza = onPlazaChange(nextPlaza => _reloadForPlaza(nextPlaza));
  _trackListener('create', 'plaza-sub');

  if (!_state.plaza) {
    _state.loading = false;
    _render();
    return;
  }
  _startListener();
}

export function unmount() {
  _cleanup();
}

function _ensureCss() {
  if (_cssInjected) return;
  if (document.querySelector('link[data-app-incidencias-css]')) {
    _cssInjected = true;
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-incidencias.css';
  link.setAttribute('data-app-incidencias-css', '1');
  document.head.appendChild(link);
  _cssInjected = true;
}

function _cleanup() {
  if (_renderFrame) {
    window.cancelAnimationFrame(_renderFrame);
    _renderFrame = 0;
  }
  if (typeof _unsubIncidencias === 'function') {
    try { _unsubIncidencias(); } catch (_) {}
    _trackListener('cleanup', 'incidencias-sub');
  }
  if (typeof _unsubPlaza === 'function') {
    try { _unsubPlaza(); } catch (_) {}
    _trackListener('cleanup', 'plaza-sub');
  }
  if (typeof _offGlobalSearch === 'function') {
    try { _offGlobalSearch(); } catch (_) {}
  }
  if (_bindUi._kbBound) {
    window.removeEventListener('keydown', _onGlobalKey);
    _bindUi._kbBound = false;
  }
  _unsubIncidencias = null;
  _unsubPlaza = null;
  _offGlobalSearch = null;
  _container = null;
  _state = null;
}

function _reloadForPlaza(nextPlaza) {
  if (!_state) return;
  const plaza = String(nextPlaza || '').toUpperCase().trim();
  if (plaza === _state.plaza) return;
  _state.plaza = plaza;
  _state.allItems = [];
  _state.items = [];
  _state.selectedId = '';
  _state.detailOpenId = '';
  _state.errorMessage = '';
  _state.hasPermissionDenied = false;
  _state.loading = !!plaza;
  _prefillMvaFromQuery();
  _render();
  if (!plaza) return;
  _startListener();
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_state || !_container) return;
    const route = String(event?.detail?.route || '');
    if (!(route.startsWith('/app/incidencias') || route === '/incidencias')) return;
    _state.query = String(event?.detail?.query || '').trim().toLowerCase();
    _applyFilters();
    _render();
  };
  window.addEventListener('mex:global-search', handler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', handler);
}

function _startListener() {
  if (typeof _unsubIncidencias === 'function') {
    try { _unsubIncidencias(); } catch (_) {}
  }
  _state.loading = true;
  _state.errorMessage = '';
  _state.hasPermissionDenied = false;
  _render();

  _unsubIncidencias = subscribeIncidencias({
    plaza: _state.plaza,
    onData: rows => {
      if (!_state) return;
      _state.loading = false;
      _state.allItems = Array.isArray(rows) ? rows : [];
      _registerNewTipos(_state.allItems);
      _applyFilters();
      _render();
    },
    onError: err => {
      if (!_state) return;
      _state.loading = false;
      _state.errorMessage = err?.message || 'Error al cargar notas e incidencias.';
      _state.hasPermissionDenied = String(err?.code || '').toLowerCase() === 'permission-denied';
      _render();
    }
  });
  _trackListener('create', 'incidencias-sub', { plaza: _state.plaza });
}

function _registerNewTipos(items) {
  if (!_state || !Array.isArray(items)) return;
  items.forEach(it => {
    const t = String(it?.tipo || 'OTRO').toUpperCase().trim() || 'OTRO';
    if (!(t in _state.tipoFilter)) _state.tipoFilter[t] = true;
  });
}

// ────────────────────────────────────────────────────────────
// BIND UI
// ────────────────────────────────────────────────────────────
function _bindUi() {
  // FilterRail · Prioridad
  qsa('[data-priority]').forEach(label => {
    const input = label.querySelector('input[type="checkbox"]');
    if (!input) return;
    const key = label.dataset.priority;
    input.addEventListener('change', () => {
      _state.priorityFilter[key] = !!input.checked;
      label.classList.toggle('is-on', !!input.checked);
      _applyFilters();
      _render();
    });
  });

  // FilterRail · Estado
  qsa('[data-status]').forEach(label => {
    const input = label.querySelector('input[type="checkbox"]');
    if (!input) return;
    const key = label.dataset.status;
    input.addEventListener('change', () => {
      _state.statusFilter[key] = !!input.checked;
      label.classList.toggle('is-on', !!input.checked);
      _applyFilters();
      _render();
    });
  });

  // FilterRail · Tipo
  qsa('[data-tipo]').forEach(label => {
    const input = label.querySelector('input[type="checkbox"]');
    if (!input) return;
    const key = label.dataset.tipo;
    input.addEventListener('change', () => {
      _state.tipoFilter[key] = !!input.checked;
      label.classList.toggle('is-on', !!input.checked);
      _applyFilters();
      _render();
    });
  });

  // Asignado a (radios) — solo visual por ahora
  qsa('input[name="incAssignTo"]').forEach(input => {
    input.addEventListener('change', () => {
      qsa('input[name="incAssignTo"]').forEach(other => {
        const lbl = other.closest('.rail-check');
        if (lbl) lbl.classList.toggle('is-on', other.checked);
      });
    });
  });

  // Botones "Nueva incidencia"
  q('incBtnNew')?.addEventListener('click', () => _toggleCreateDialog(true));
  q('incBtnNewRail')?.addEventListener('click', () => _toggleCreateDialog(true));

  // Create dialog · cerrar
  q('incCreateClose')?.addEventListener('click', () => _toggleCreateDialog(false));
  q('incCreateCancel')?.addEventListener('click', () => _toggleCreateDialog(false));
  q('incCreateBackdrop')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) _toggleCreateDialog(false);
  });

  // Search trigger — dispara mex:global-search abierto
  q('incSearchTrigger')?.addEventListener('click', () => {
    if (typeof window.mexOpenGlobalSearch === 'function') window.mexOpenGlobalSearch();
    else q('incSearchTrigger')?.focus();
  });

  // Composer
  q('btnPublicarInc')?.addEventListener('click', _onCreateIncidencia);
  q('nuevaNotaPrioridad')?.addEventListener('change', _applyDraftMeta);
  q('nuevaNotaTitulo')?.addEventListener('input', _onDraftChange);
  q('nuevaNotaTipo')?.addEventListener('change', _onDraftChange);
  q('incMvaInput')?.addEventListener('input', _onDraftChange);
  q('nuevaNotaRich')?.addEventListener('input', () => {
    _syncRichEditorToTextarea();
    _onDraftChange();
  });

  // Botones de prioridad segmentado
  qsa('[data-ci-prio]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.ciPrio;
      qsa('[data-ci-prio]').forEach(b => b.classList.toggle('is-on', b.dataset.ciPrio === key));
      const hidden = q('nuevaNotaPrioridad');
      if (hidden) {
        hidden.value = key;
        hidden.dispatchEvent(new Event('change'));
      }
      _state.createDraft.prioridad = key;
      _renderCreatePreview();
    });
  });

  // Editor compat (font size/family si existe en DOM oculto)
  q('incEditorFontSize')?.addEventListener('change', event => _applyRichCommand('fontSize', event.target.value || '3'));
  q('incEditorFontFamily')?.addEventListener('change', event => _applyRichCommand('fontName', event.target.value || 'Inter'));
  qsa('[data-inc-editor-cmd]').forEach(btn => {
    btn.addEventListener('click', () => _applyRichCommand(btn.dataset.incEditorCmd || ''));
  });

  q('incLinkInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      _addDraftLink();
    }
  });
  q('incAddLinkBtn')?.addEventListener('click', _addDraftLink);
  q('incAdjuntosInput')?.addEventListener('change', _onFilesSelected);

  // Resolver modal
  q('incResolverCancelar')?.addEventListener('click', () => _toggleResolverModal(false));
  q('btnConfirmarResInc')?.addEventListener('click', _confirmResolve);

  // Asignar a — búsqueda en tiempo real
  q('incAsignarInput')?.addEventListener('input', _onAsignarInput);
  q('incAsignarClear')?.addEventListener('click', _clearAsignar);

  // Keyboard shortcut N para abrir create
  if (!_bindUi._kbBound) {
    _bindUi._kbBound = true;
    window.addEventListener('keydown', _onGlobalKey);
  }
}

// ────────────────────────────────────────────────────────────
// ASIGNAR A — búsqueda de usuarios
// ────────────────────────────────────────────────────────────
function _onAsignarInput(e) {
  if (!_state) return;
  const term = String(e.target?.value || '').trim();
  _state.asignarSearchTerm = term;
  clearTimeout(_state.asignarSearchTimer);
  if (term.length < 2) {
    _renderAsignarDropdown([]);
    return;
  }
  _state.asignarSearchTimer = setTimeout(async () => {
    try {
      const results = await searchUsuarios(term, _state.plaza || '');
      if (_state?.asignarSearchTerm === term) _renderAsignarDropdown(results);
    } catch (_) { _renderAsignarDropdown([]); }
  }, 250);
}

function _renderAsignarDropdown(results) {
  const drop = q('incAsignarDropdown');
  if (!drop) return;
  if (!results.length) { drop.style.display = 'none'; drop.innerHTML = ''; return; }
  drop.style.display = 'block';
  drop.innerHTML = results.map(u => `
    <button type="button" class="ci-assign-result" data-uid="${esc(u.uid)}">
      <span class="inc-avatar" style="width:22px;height:22px;font-size:9px;">${esc(_initialsFrom(u.nombre || u.email))}</span>
      <span class="ci-assign-result-name">${esc(u.nombre || _displayName(u.email))}</span>
      <span class="ci-assign-result-meta">${esc(u.rol)}${u.plaza ? ' · ' + esc(u.plaza) : ''}${u.isGlobal ? ' · Global' : ''}</span>
    </button>
  `).join('');
  drop.querySelectorAll('.ci-assign-result').forEach((btn, i) => {
    btn.addEventListener('click', () => _selectAsignar(results[i]));
  });
}

function _selectAsignar(user) {
  if (!_state) return;
  _state.asignarSelected = user;
  _state.asignarSearchTerm = '';
  // Actualiza UI
  const sel = q('incAsignarSelected');
  const wrap = q('incAsignarSearchWrap');
  const av = q('incAsignarAvatar');
  const nm = q('incAsignarNombre');
  const rl = q('incAsignarRole');
  if (sel) sel.style.display = 'flex';
  if (wrap) wrap.style.display = 'none';
  if (av) av.textContent = _initialsFrom(user.nombre || user.email);
  if (nm) nm.textContent = user.nombre || _displayName(user.email);
  if (rl) rl.textContent = [user.rol, user.plaza, user.isGlobal ? 'Global' : ''].filter(Boolean).join(' · ');
  const drop = q('incAsignarDropdown');
  if (drop) { drop.style.display = 'none'; drop.innerHTML = ''; }
  const input = q('incAsignarInput');
  if (input) input.value = '';
  _renderCreatePreview();
}

function _clearAsignar() {
  if (!_state) return;
  _state.asignarSelected = null;
  const sel = q('incAsignarSelected');
  const wrap = q('incAsignarSearchWrap');
  if (sel) sel.style.display = 'none';
  if (wrap) wrap.style.display = 'flex';
  const input = q('incAsignarInput');
  if (input) { input.value = ''; input.focus(); }
  _renderCreatePreview();
}

function _onGlobalKey(e) {
  if (!_container || !_state) return;
  const tag = (e.target?.tagName || '').toLowerCase();
  const editing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
  if (editing) return;
  // Solo si la vista está montada
  if (!document.body.contains(_container)) return;
  if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    _toggleCreateDialog(true);
  } else if (e.key === 'Escape') {
    const bd = q('incCreateBackdrop');
    if (bd?.classList.contains('is-open')) {
      _toggleCreateDialog(false);
    }
  }
}

// ────────────────────────────────────────────────────────────
// COMPOSER / RICH EDITOR helpers (lógica conservada)
// ────────────────────────────────────────────────────────────
function _normalizeDraftUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function _editorEl() {
  return q('nuevaNotaRich');
}

function _sanitizeStyle(style = '') {
  const allowed = new Set(['font-weight', 'font-style', 'text-decoration', 'font-size', 'font-family', 'color', 'background-color']);
  return String(style || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const idx = part.indexOf(':');
      if (idx === -1) return '';
      const prop = part.slice(0, idx).trim().toLowerCase();
      const value = part.slice(idx + 1).trim().replace(/[<>"']/g, '');
      if (!allowed.has(prop) || /url\s*\(/i.test(value)) return '';
      return `${prop}: ${value}`;
    })
    .filter(Boolean)
    .join('; ');
}

function _sanitizeRichHtml(html = '') {
  const raw = String(html || '').trim();
  if (!raw) return '';
  const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN', 'FONT']);
  const root = document.createElement('div');
  root.innerHTML = raw;
  const walk = node => {
    Array.from(node.childNodes || []).forEach(child => {
      if (child.nodeType !== 1) return;
      const el = child;
      walk(el);
      if (!allowed.has(el.tagName)) {
        while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
        el.remove();
        return;
      }
      Array.from(el.attributes || []).forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '');
        const isLink = el.tagName === 'A' && name === 'href' && /^https?:\/\//i.test(value);
        const isSafeLinkAttr = el.tagName === 'A' && ['target', 'rel'].includes(name);
        const isStyle = name === 'style';
        const isFont = el.tagName === 'FONT' && ['size', 'color', 'face'].includes(name);
        if (!isLink && !isSafeLinkAttr && !isStyle && !isFont) el.removeAttribute(attr.name);
      });
      if (el.tagName === 'A') {
        const href = String(el.getAttribute('href') || '');
        if (!/^https?:\/\//i.test(href)) el.removeAttribute('href');
        else {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
          el.classList.add('inc-inline-link');
        }
      }
      if (el.hasAttribute('style')) {
        const style = _sanitizeStyle(el.getAttribute('style'));
        if (style) el.setAttribute('style', style);
        else el.removeAttribute('style');
      }
    });
  };
  walk(root);
  return root.innerHTML;
}

function _syncRichEditorToTextarea() {
  const editor = _editorEl();
  const textarea = q('nuevaNotaTxt');
  if (!editor || !textarea) return;
  const html = _sanitizeRichHtml(editor.innerHTML || '');
  _state.descripcionHtmlNuevaNota = html;
  textarea.value = String(editor.innerText || '').trim();
}

async function _applyRichCommand(cmd, value = null) {
  const editor = _editorEl();
  if (!editor) return;
  editor.focus();
  let exec = cmd;
  let val = value;
  if (cmd === 'link') {
    const raw = await _mexPrompt('Insertar enlace', 'Enlace para insertar:', 'https://', 'url', 'https://');
    const url = _normalizeDraftUrl(raw || '');
    if (!url) return;
    try { new URL(url); } catch (_) { return _showNotice('El enlace no tiene formato válido.', 'error'); }
    exec = 'createLink';
    val = url;
  } else if (cmd === 'ul') {
    exec = 'insertUnorderedList';
  } else if (cmd === 'ol') {
    exec = 'insertOrderedList';
  } else if (cmd === 'clear') {
    exec = 'removeFormat';
  }
  try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
  try { document.execCommand(exec, false, val); } catch (_) {}
  _syncRichEditorToTextarea();
}

function _addDraftLink() {
  const input = q('incLinkInput');
  const url = _normalizeDraftUrl(input?.value || '');
  if (!url) return _showNotice('Pega un link para agregarlo.', 'error');
  try {
    new URL(url);
  } catch (_) {
    return _showNotice('El link no tiene formato válido.', 'error');
  }
  if (_state.linksNuevaNota.some(item => item.url === url)) {
    input.value = '';
    return _showNotice('Ese link ya está agregado.', 'error');
  }
  _state.linksNuevaNota.push({ url, label: _labelFromUrl(url), tipo: 'link' });
  input.value = '';
  _renderLinksNuevos();
}

function _labelFromUrl(url = '') {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
    return decodeURIComponent(last).slice(0, 64) || parsed.hostname;
  } catch (_) {
    return String(url || 'Link').slice(0, 64);
  }
}

function _removeDraftLink(index) {
  _state.linksNuevaNota.splice(index, 1);
  _renderLinksNuevos();
}
window._incRemoveDraftLink = _removeDraftLink;

function _renderLinksNuevos() {
  const cont = q('incLinksNuevosCont');
  if (!cont) return;
  cont.innerHTML = (_state.linksNuevaNota || []).map((item, i) => `
    <div class="inc-link-chip">
      <span class="material-icons">link</span>
      <a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.label || item.url)}</a>
      <button type="button" onclick="window._incRemoveDraftLink(${i})" title="Quitar link"><span class="material-icons">close</span></button>
    </div>
  `).join('');
}

function _onFilesSelected(e) {
  if (!e.target.files?.length) return;
  const files = Array.from(e.target.files);
  files.forEach(f => {
    _state.archivosNuevaNota.push({
      file: f,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
    });
  });
  e.target.value = '';
  _renderAdjuntosNuevos();
}

function _eliminarArchivoNuevos(index) {
  const item = _state.archivosNuevaNota[index];
  if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  _state.archivosNuevaNota.splice(index, 1);
  _renderAdjuntosNuevos();
}
window._incEliminarArchivoNuevos = _eliminarArchivoNuevos;

function _renderAdjuntosNuevos() {
  const cont = q('incAdjuntosNuevosCont');
  if (!cont) return;
  if (!_state.archivosNuevaNota.length) {
    cont.innerHTML = '';
    return;
  }
  cont.innerHTML = _state.archivosNuevaNota.map((item, i) => `
    <div class="inc-upload-chip">
      ${item.previewUrl
        ? `<img src="${item.previewUrl}" alt="">`
        : `<span class="material-icons">insert_drive_file</span>`}
      <span class="upload-name">${esc(item.file.name)}</span>
      <button type="button" class="upload-remove" onclick="window._incEliminarArchivoNuevos(${i})"><span class="material-icons">close</span></button>
    </div>
  `).join('');
}

// ────────────────────────────────────────────────────────────
// FILTERS / SORT
// ────────────────────────────────────────────────────────────
function _applyFilters() {
  if (!_state) return;
  const query = _state.query;
  const tab = _state.activeTab;
  const me = _state.myAuthor;

  let arr = (_state.allItems || []).filter(item => {
    const p = _priority(item);
    if (!_state.priorityFilter[p]) return false;

    const status = _statusFromNota(item);
    if (!_state.statusFilter[status]) return false;

    const tipo = String(item?.tipo || 'OTRO').toUpperCase().trim() || 'OTRO';
    if (Object.prototype.hasOwnProperty.call(_state.tipoFilter, tipo) && !_state.tipoFilter[tipo]) return false;

    // Tabs
    const author = String(item?.autor || item?.creadoPor || '').toLowerCase();
    if (tab === 'mias' && me && author !== me) return false;
    if (tab === 'sin_asignar' && author) return false;

    if (!query) return true;
    const hay = [
      item.titulo,
      item.descripcion,
      item.descripcionHtml,
      item.nota,
      item.autor,
      item.creadoPor,
      item.codigo,
      item.mva,
      item.plaza,
      item.prioridad,
      item.source
    ].join(' ').toLowerCase();
    return hay.includes(query);
  });

  // Ordenamiento
  if (_state.sortBy === 'priority') {
    const weight = { CRITICA: 4, ALTA: 3, MEDIA: 2, BAJA: 1 };
    arr.sort((a, b) => {
      const wa = weight[_priority(a)] || 0;
      const wb = weight[_priority(b)] || 0;
      if (wb !== wa) return wb - wa;
      return _dateMs(b.creadoEn || b.fecha) - _dateMs(a.creadoEn || a.fecha);
    });
  } else {
    arr.sort((a, b) => _dateMs(b.creadoEn || b.fecha) - _dateMs(a.creadoEn || a.fecha));
  }

  _state.items = arr;
}

// ────────────────────────────────────────────────────────────
// RENDER (rAF coalesced)
// ────────────────────────────────────────────────────────────
function _render() {
  if (_renderFrame) return;
  _renderFrame = window.requestAnimationFrame(() => {
    _renderFrame = 0;
    _renderNow();
  });
}

function _renderNow() {
  if (!_state) return;
  _renderHeader();
  _renderMetrics();
  _renderFilterRail();
  _renderToolbar();
  _renderView(_state.items);
  _renderDetailPanel();
}

function _renderHeader() {
  const sub = q('incModSub');
  if (!sub) return;
  const total = (_state.allItems || []).length;
  const shown = (_state.items || []).length;
  sub.textContent = `Bitácora operativa · ${shown} de ${total} incidencia${total === 1 ? '' : 's'}`;
}

function _renderMetrics() {
  const cont = q('incMetrics');
  if (!cont) return;
  const all = _state.allItems || [];
  const today = new Date();
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const isToday = ms => {
    if (!ms) return false;
    const d = new Date(ms);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return ymd === todayYmd;
  };

  const abiertas = all.filter(it => {
    const s = _statusFromNota(it);
    return s === 'PENDIENTE' || s === 'EN_PROCESO';
  }).length;
  const criticas = all.filter(it => _priority(it) === 'CRITICA' && (_statusFromNota(it) === 'PENDIENTE' || _statusFromNota(it) === 'EN_PROCESO')).length;
  const enProceso = all.filter(it => _statusFromNota(it) === 'EN_PROCESO').length;
  const resueltasHoy = all.filter(it => {
    if (_statusFromNota(it) !== 'RESUELTA' && _statusFromNota(it) !== 'CERRADA') return false;
    return isToday(_dateMs(it.resueltaEn || it.resueltoEn || it.actualizadoEn));
  }).length;

  const cards = [
    { label: 'Abiertas',       value: abiertas,       sub: 'Pendientes o en proceso', tone: 'neutral' },
    { label: 'Críticas',       value: criticas,       sub: 'Atención inmediata',      tone: 'danger' },
    { label: 'En proceso',     value: enProceso,      sub: 'Trabajándose',            tone: 'neutral' },
    { label: 'Resueltas hoy',  value: resueltasHoy,   sub: 'Cerradas en el día',      tone: 'ok' },
    { label: 'SLA en riesgo',  value: '?',            sub: 'Sin cálculo de SLA',      tone: 'warning' },
    { label: 'Tiempo prom.',   value: '—',            sub: 'Próximamente',            tone: 'neutral' },
  ];

  cont.innerHTML = cards.map(c => `
    <div class="metric metric-${c.tone}">
      <div class="metric-label">${esc(c.label)}</div>
      <div class="metric-value">${esc(String(c.value))}</div>
      <div class="metric-sub">${esc(c.sub)}</div>
    </div>
  `).join('');
}

function _renderFilterRail() {
  _updateFilterCounts(_state.allItems);
  // Sincroniza checks visuales
  qsa('[data-priority]').forEach(label => {
    const key = label.dataset.priority;
    label.classList.toggle('is-on', !!_state.priorityFilter[key]);
    const input = label.querySelector('input[type="checkbox"]');
    if (input && input.checked !== !!_state.priorityFilter[key]) input.checked = !!_state.priorityFilter[key];
  });
  qsa('[data-status]').forEach(label => {
    const key = label.dataset.status;
    label.classList.toggle('is-on', !!_state.statusFilter[key]);
    const input = label.querySelector('input[type="checkbox"]');
    if (input && input.checked !== !!_state.statusFilter[key]) input.checked = !!_state.statusFilter[key];
  });
  qsa('[data-tipo]').forEach(label => {
    const key = label.dataset.tipo;
    label.classList.toggle('is-on', !!_state.tipoFilter[key]);
    const input = label.querySelector('input[type="checkbox"]');
    if (input && input.checked !== !!_state.tipoFilter[key]) input.checked = !!_state.tipoFilter[key];
  });
}

function _updateFilterCounts(items) {
  if (!_state) return;
  const counts = {
    priority: { CRITICA: 0, ALTA: 0, MEDIA: 0, BAJA: 0 },
    status: { PENDIENTE: 0, EN_PROCESO: 0, RESUELTA: 0, CERRADA: 0 },
    tipo: {},
  };
  (items || []).forEach(item => {
    const p = _priority(item);
    counts.priority[p] = (counts.priority[p] || 0) + 1;
    const s = _statusFromNota(item);
    counts.status[s] = (counts.status[s] || 0) + 1;
    const t = String(item?.tipo || 'OTRO').toUpperCase().trim() || 'OTRO';
    counts.tipo[t] = (counts.tipo[t] || 0) + 1;
  });

  Object.entries(counts.priority).forEach(([k, v]) => {
    const el = _container?.querySelector(`[data-count-priority="${k}"]`);
    if (el) el.textContent = String(v);
  });
  Object.entries(counts.status).forEach(([k, v]) => {
    const el = _container?.querySelector(`[data-count-status="${k}"]`);
    if (el) el.textContent = String(v);
  });
  Object.entries(counts.tipo).forEach(([k, v]) => {
    const el = _container?.querySelector(`[data-count-tipo="${k}"]`);
    if (el) el.textContent = String(v);
  });
}

function _renderToolbar() {
  const toolbar = q('incToolbar');
  if (!toolbar) return;

  const me = _state.myAuthor;
  const all = _state.allItems || [];
  const countTodas = all.length;
  const countMias = all.filter(it => me && String(it?.autor || it?.creadoPor || '').toLowerCase() === me).length;
  const countSinAsignar = all.filter(it => !String(it?.autor || it?.creadoPor || '').trim()).length;
  const selCount = (_state.selectedIds || []).length;

  if (selCount > 0) {
    toolbar.className = 'inc-toolbar toolbar-bulk';
    toolbar.innerHTML = `
      <button class="bulk-clear" data-clear-sel title="Limpiar selección"><span class="material-icons" style="font-size:14px">close</span></button>
      <span class="bulk-count"><b>${selCount}</b> seleccionada${selCount === 1 ? '' : 's'}</span>
      <div class="bulk-sep"></div>
      <button class="bulk-act" data-bulk-resolve><span class="material-icons" style="font-size:13px">check</span>Marcar resuelta</button>
      <button class="bulk-act" data-bulk-copy><span class="material-icons" style="font-size:13px">content_copy</span>Copiar CSV</button>
      <div style="flex:1"></div>
      <div class="inc-view-toggle">
        <button class="inc-view-btn ${_state.viewMode === 'list' ? 'is-active' : ''}" data-view="list" title="Lista"><span class="material-icons">view_list</span></button>
        <button class="inc-view-btn ${_state.viewMode === 'table' ? 'is-active' : ''}" data-view="table" title="Tabla"><span class="material-icons">table_rows</span></button>
        <button class="inc-view-btn ${_state.viewMode === 'board' ? 'is-active' : ''}" data-view="board" title="Tablero"><span class="material-icons">view_kanban</span></button>
      </div>
    `;
  } else {
    toolbar.className = 'inc-toolbar';
    toolbar.innerHTML = `
      <div class="inc-tabs">
        <button class="inc-tab ${_state.activeTab === 'todas' ? 'is-active' : ''}" data-tab="todas">Todas <span class="inc-tab-count" id="tabCount_todas">${countTodas}</span></button>
        <button class="inc-tab ${_state.activeTab === 'mias' ? 'is-active' : ''}" data-tab="mias">Asignadas a mí <span class="inc-tab-count" id="tabCount_mias">${countMias}</span></button>
        <button class="inc-tab ${_state.activeTab === 'sin_asignar' ? 'is-active' : ''}" data-tab="sin_asignar">Sin asignar <span class="inc-tab-count" id="tabCount_sin_asignar">${countSinAsignar}</span></button>
      </div>
      <div class="inc-toolbar-right">
        <span class="inc-results-count" id="incResultsCount">${_state.items.length} resultado${_state.items.length === 1 ? '' : 's'}</span>
        <select class="inc-sort" id="incSort">
          <option value="recent" ${_state.sortBy === 'recent' ? 'selected' : ''}>Más recientes</option>
          <option value="priority" ${_state.sortBy === 'priority' ? 'selected' : ''}>Prioridad</option>
        </select>
        <div class="inc-view-toggle">
          <button class="inc-view-btn ${_state.viewMode === 'list' ? 'is-active' : ''}" data-view="list" title="Lista"><span class="material-icons">view_list</span></button>
          <button class="inc-view-btn ${_state.viewMode === 'table' ? 'is-active' : ''}" data-view="table" title="Tabla"><span class="material-icons">table_rows</span></button>
          <button class="inc-view-btn ${_state.viewMode === 'board' ? 'is-active' : ''}" data-view="board" title="Tablero"><span class="material-icons">view_kanban</span></button>
        </div>
        <button class="inc-refresh-btn" id="incRefreshBtn" title="Actualizar"><span class="material-icons">refresh</span></button>
      </div>
    `;
  }
  _attachToolbarHandlers();
}

function _attachToolbarHandlers() {
  qsa('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.activeTab = btn.dataset.tab;
      _applyFilters();
      _render();
    });
  });
  qsa('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.viewMode = btn.dataset.view;
      _render();
    });
  });
  q('incSort')?.addEventListener('change', event => {
    _state.sortBy = String(event.target.value || 'recent');
    _applyFilters();
    _render();
  });
  q('incRefreshBtn')?.addEventListener('click', () => {
    if (_state?.plaza) _startListener();
  });
  _container?.querySelector('[data-clear-sel]')?.addEventListener('click', () => {
    _state.selectedIds = [];
    _render();
  });
  _container?.querySelector('[data-bulk-resolve]')?.addEventListener('click', _onBulkResolve);
  _container?.querySelector('[data-bulk-copy]')?.addEventListener('click', _onBulkCopyCsv);
}

function _renderView(items) {
  const cont = q('incViewContainer');
  if (!cont) return;

  if (!_state.plaza) {
    cont.innerHTML = _empty('Selecciona una plaza para ver notas e incidencias.', 'place');
    return;
  }
  if (_state.loading) {
    cont.innerHTML = _empty('Cargando registros…', 'loading', true);
    return;
  }
  if (_state.hasPermissionDenied) {
    cont.innerHTML = _empty('No tienes permisos para ver notas e incidencias de esta plaza.', 'block');
    return;
  }
  if (_state.errorMessage) {
    cont.innerHTML = `<div class="inc-error">${esc(_state.errorMessage)}</div>` + _empty('Hubo un error al cargar.', 'error');
    return;
  }
  if (!_state.allItems.length) {
    cont.innerHTML = _empty('No hay notas e incidencias registradas.', 'inbox');
    return;
  }
  if (!items.length) {
    cont.innerHTML = _empty('No hay resultados con los filtros actuales.', 'search');
    return;
  }

  if (_state.viewMode === 'table') {
    cont.innerHTML = _renderTable(items);
  } else if (_state.viewMode === 'board') {
    cont.innerHTML = _renderBoard(items);
  } else {
    cont.innerHTML = _renderList(items);
  }

  _attachRowHandlers();
}

function _attachRowHandlers() {
  // Click en filas / tarjetas
  qsa('[data-open-id]').forEach(el => {
    el.addEventListener('click', event => {
      // Evita interceptar clicks en botones internos
      if (event.target.closest('[data-stop]')) return;
      const id = el.dataset.openId;
      const item = _state.allItems.find(it => (it.legacyNotaId || it.id) === id);
      if (item) _openDetail(item);
    });
  });

  // Row check (toggle selection)
  qsa('[data-row-check]').forEach(label => {
    label.addEventListener('click', event => {
      event.stopPropagation();
      const id = label.dataset.rowCheck;
      if (!id) return;
      const sel = new Set(_state.selectedIds || []);
      if (sel.has(id)) sel.delete(id);
      else sel.add(id);
      _state.selectedIds = [...sel];
      _render();
    });
  });

  // Acción resolver
  qsa('[data-resolve-id]').forEach(btn => {
    btn.addEventListener('click', event => {
      event.stopPropagation();
      _state.resolverTargetId = btn.dataset.resolveId || '';
      _toggleResolverModal(true);
    });
  });

  // Acción eliminar
  qsa('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', async event => {
      event.stopPropagation();
      const id = btn.dataset.deleteId;
      if (await _mexConfirm('Eliminar registro', '¿Estás seguro de eliminar este registro? Esta acción no se puede deshacer.', 'danger')) {
        _onDeleteIncidencia(id);
      }
    });
  });
}

// ────────────────────────────────────────────────────────────
// LIST view
// ────────────────────────────────────────────────────────────
function _renderList(items) {
  const head = `
    <div class="inc-list-head">
      <span class="lh-prio"></span>
      <span class="lh-check"></span>
      <span class="lh-id">ID</span>
      <span class="lh-main">Incidencia</span>
      <span class="lh-sla">Programación</span>
      <span class="lh-assignee">Asignada</span>
      <span class="lh-status">Estado</span>
      <span class="lh-more"></span>
    </div>
  `;
  const sel = new Set(_state.selectedIds || []);

  const rows = items.map(item => {
    const id = item.legacyNotaId || item.id || '';
    const codigo = item.codigo || id;
    const pr = _priority(item).toLowerCase();
    const status = _statusFromNota(item);
    const stKey = status.toLowerCase();
    const stLabel = _statusLabel(status);
    const isActive = _state.detailOpenId === id;
    const isSelected = sel.has(id);
    const tipo = String(item?.tipo || 'OTRO').toUpperCase().trim() || 'OTRO';
    const mva = item.mva || '';
    const fecha = _relativeDate(item.creadoEn || item.fecha);
    const author = String(item.autor || item.creadoPor || '').trim();
    const asignadoRow = item.asignadoA && (item.asignadoA.nombre || item.asignadoA.email)
      ? item.asignadoA : null;
    const assigneeName = asignadoRow
      ? (asignadoRow.nombre || _displayName(asignadoRow.email))
      : _displayName(author);
    const initials = _initialsFrom(assigneeName);
    const firstName = (assigneeName || '').split(/\s+/)[0] || '';

    return `
      <div class="inc-row ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}" data-open-id="${esc(id)}">
        <div class="row-prio-bar is-${esc(pr)}"></div>
        <label class="row-check" data-stop data-row-check="${esc(id)}">
          <input type="checkbox" ${isSelected ? 'checked' : ''}>
          <span class="row-check-box"></span>
        </label>
        <div class="inc-row-id" title="${esc(codigo)}">${esc(codigo)}</div>
        <div class="inc-row-main">
          <div class="inc-row-title-line">
            <span class="prio-dot is-${esc(pr)}"></span>
            <span class="inc-row-title">${esc(item.titulo || 'Sin título')}</span>
          </div>
          <div class="inc-row-meta">
            <span>${esc(tipo)}</span>
            ${mva ? `<span class="sep">·</span><span class="mva">${esc(mva)}</span>` : ''}
            <span class="sep">·</span>
            <span>${esc(fecha)}</span>
          </div>
        </div>
        <div class="row-sla">
          <span class="schedule-chip sla-neutral">—</span>
        </div>
        <div class="row-assignee">
          ${(asignadoRow || author)
            ? `<span class="row-assignee-pill"><span class="inc-avatar" style="width:20px;height:20px;font-size:9px;">${esc(initials)}</span><span>${esc(firstName)}</span></span>`
            : `<span class="row-unassigned">Sin asignar</span>`}
        </div>
        <div class="row-status"><span class="status-pill is-${esc(stKey)}"><span class="status-pill-dot"></span>${esc(stLabel)}</span></div>
        <button class="row-more" data-stop title="Más"><span class="material-icons">more_vert</span></button>
      </div>
    `;
  }).join('');

  return `<div class="inc-list">${head}<div class="inc-list-body">${rows || _emptyListHtml()}</div></div>`;
}

function _emptyListHtml() {
  return `
    <div class="inc-empty">
      <div class="inc-empty-mark"><span class="material-icons">inbox</span></div>
      <div class="inc-empty-title">No hay incidencias con estos filtros</div>
      <div class="inc-empty-sub">Ajusta los filtros del panel izquierdo o crea una nueva.</div>
    </div>
  `;
}

function _initialsFrom(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  if (s.includes('@')) {
    const local = s.split('@')[0];
    return (local.charAt(0) + (local.charAt(1) || '')).toUpperCase();
  }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

// ────────────────────────────────────────────────────────────
// TABLE view
// ────────────────────────────────────────────────────────────
function _renderTable(items) {
  const rows = items.map(item => {
    const id = item.legacyNotaId || item.id || '';
    const codigo = item.codigo || id;
    const pr = _priority(item);
    const prLower = pr.toLowerCase();
    const status = _statusFromNota(item);
    const stKey = status.toLowerCase();
    const stLabel = _statusLabel(status);
    const isActive = _state.detailOpenId === id;
    const tipo = String(item?.tipo || 'OTRO').toUpperCase().trim() || 'OTRO';

    return `
      <tr class="${isActive ? 'is-active' : ''}" data-open-id="${esc(id)}">
        <td class="td-id">${esc(codigo)}</td>
        <td>
          <div class="td-title">${esc(item.titulo || 'Sin título')}</div>
          <div class="td-sub">${esc(tipo)}</div>
        </td>
        <td><span class="td-prio"><span class="prio-dot is-${esc(prLower)}"></span>${esc(_priorityLabel(pr))}</span></td>
        <td><span class="status-pill is-${esc(stKey)}"><span class="status-pill-dot"></span>${esc(stLabel)}</span></td>
        <td class="td-mono">${esc((item.asignadoA?.nombre) || _displayName(item.autor || item.creadoPor || '') || '—')}</td>
        <td class="td-mono">${esc(item.mva || '—')}</td>
        <td class="td-time">${esc(_relativeDate(item.actualizadoEn || item.creadoEn || item.fecha))}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="inc-table-wrap">
      <table class="inc-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Incidencia</th>
            <th>Prioridad</th>
            <th>Estado</th>
            <th>Asignada</th>
            <th>Activo</th>
            <th>Actualizada</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────
// BOARD view (Kanban)
// ────────────────────────────────────────────────────────────
function _renderBoard(items) {
  const cols = [
    { id: 'PENDIENTE', label: 'Pendiente', stKey: 'pendiente' },
    { id: 'EN_PROCESO', label: 'En proceso', stKey: 'en_proceso' },
    { id: 'RESUELTA', label: 'Resuelta', stKey: 'resuelta' },
  ];

  const html = cols.map(col => {
    const list = items.filter(it => _statusFromNota(it) === col.id);
    const cards = list.map(item => {
      const id = item.legacyNotaId || item.id || '';
      const codigo = item.codigo || id;
      const pr = _priority(item).toLowerCase();
      const isActive = _state.detailOpenId === id;
      const tipo = String(item?.tipo || 'OTRO').toUpperCase().trim() || 'OTRO';
      const mva = item.mva || '';
      return `
        <div class="inc-card ${isActive ? 'is-active' : ''}" data-open-id="${esc(id)}">
          <div class="inc-card-bar is-${esc(pr)}"></div>
          <div class="inc-card-head">
            <span class="inc-card-id">${esc(codigo)}</span>
            <span style="flex:1"></span>
            <span class="prio-dot is-${esc(pr)}"></span>
          </div>
          <div class="inc-card-title">${esc(item.titulo || 'Sin título')}</div>
          <div class="inc-card-foot">
            <span class="inc-card-cat">${esc(tipo)}${mva ? ' · ' + esc(mva) : ''}</span>
            <span style="flex:1"></span>
            <span>${esc(_relativeDate(item.creadoEn || item.fecha))}</span>
          </div>
        </div>
      `;
    }).join('');
    return `
      <div class="inc-board-col">
        <div class="inc-board-col-head">
          <span class="status-pill is-${esc(col.stKey)}"><span class="status-pill-dot"></span>${esc(col.label)}</span>
          <span class="inc-board-col-count">${list.length}</span>
        </div>
        <div class="inc-board-col-body">${cards || '<div class="inc-empty" style="padding:14px;"><div class="inc-empty-sub">Sin elementos</div></div>'}</div>
      </div>
    `;
  }).join('');

  return `<div class="inc-board">${html}</div>`;
}

// ────────────────────────────────────────────────────────────
// DETAIL PANEL
// ────────────────────────────────────────────────────────────
function _openDetail(item) {
  if (!item || !_state) return;
  _state.detailOpenId = item.legacyNotaId || item.id || '';
  _renderDetailPanel();
  _renderView(_state.items); // refrescar marca activa
}

function _closeDetail() {
  if (!_state) return;
  _state.detailOpenId = '';
  _renderDetailPanel();
  _renderView(_state.items);
}

function _renderDetailPanel() {
  const panel = q('incDetailPanel');
  if (!panel) return;
  const id = _state.detailOpenId;
  if (!id) {
    panel.className = 'detail detail-empty';
    panel.innerHTML = `
      <div class="de-mark"><span class="material-icons">inbox</span></div>
      <div class="de-title">Selecciona una incidencia</div>
      <div class="de-sub">Aquí verás el detalle completo, la línea de tiempo y las acciones.</div>
    `;
    return;
  }
  const item = _state.allItems.find(it => (it.legacyNotaId || it.id) === id);
  if (!item) {
    panel.className = 'detail detail-empty';
    panel.innerHTML = `
      <div class="de-mark"><span class="material-icons">inbox</span></div>
      <div class="de-title">Incidencia no disponible</div>
      <div class="de-sub">Es posible que haya sido eliminada o ya no esté visible.</div>
    `;
    return;
  }

  panel.className = 'detail';

  const codigo = item.codigo || item.legacyNotaId || item.id || '';
  const pr = _priority(item);
  const prLower = pr.toLowerCase();
  const status = _statusFromNota(item);
  const stKey = status.toLowerCase();
  const stLabel = _statusLabel(status);
  const open = status === 'PENDIENTE' || status === 'EN_PROCESO';
  const canDelete = _canDelete(item);
  const evidencias = _evidenceRows(item);
  const descripcion = _renderRichText(item.descripcion || 'Sin descripción.', item.descripcionHtml);
  const resolved = status === 'RESUELTA' || status === 'CERRADA';

  // Seguidores (real desde Firestore)
  const author = String(item.autor || item.creadoPor || 'Sistema').trim();
  const seguidores = Array.isArray(item.seguidores) ? item.seguidores : [];
  const gsMe = getState();
  const myUid = String(gsMe?.profile?.uid || '');
  const myEmail = String(gsMe?.profile?.email || '').toLowerCase();
  const amFollowing = seguidores.some(s =>
    (myUid && s.uid === myUid) || (myEmail && String(s.email || '').toLowerCase() === myEmail)
  );
  const asignadoA = item.asignadoA && (item.asignadoA.nombre || item.asignadoA.email)
    ? item.asignadoA : null;

  // Related (same tipo, excluir actual, máx 3)
  const tipoCur = String(item?.tipo || 'OTRO').toUpperCase().trim() || 'OTRO';
  const related = (_state.allItems || [])
    .filter(r => (r.legacyNotaId || r.id) !== id && (String(r?.tipo || 'OTRO').toUpperCase().trim() || 'OTRO') === tipoCur)
    .slice(0, 3);

  // Usuario actual (para caja de comentario)
  const gs = getState();
  const me = gs?.profile?.nombreCompleto || gs?.profile?.nombre || gs?.profile?.email || 'Usuario';
  const meInitials = _initialsFrom(me);

  panel.innerHTML = `
    <div class="dp-head">
      <div class="dp-head-top">
        <span class="dp-id">${esc(codigo)}</span>
        <span class="dp-id-sep">·</span>
        <span class="dp-region">${esc(item.plaza || _state.plaza || 'GLOBAL')}</span>
        <span class="dp-head-spacer" style="flex:1"></span>
        <button class="dp-icon-btn" id="incDetailClose" title="Cerrar"><span class="material-icons">close</span></button>
      </div>
      <h2 class="dp-title">${esc(item.titulo || 'Sin título')}</h2>
      <div class="dp-pills">
        <span class="dp-pill"><span class="prio-dot is-${esc(prLower)}"></span>${esc(_priorityLabel(pr))}</span>
        <span class="status-pill is-${esc(stKey)}"><span class="status-pill-dot"></span>${esc(stLabel)}</span>
        <span class="schedule-chip sla-neutral">—</span>
      </div>
    </div>

    <div class="dp-body">
      <section class="dp-section">
        <div class="dp-section-label">Descripción</div>
        <div class="dp-text">${descripcion}</div>
      </section>

      <section class="dp-grid">
        <div>
          <div class="dp-section-label">Creada</div>
          <div class="dp-meta-val-plain">${esc(_longDate(item.creadoEn || item.fecha))}</div>
        </div>
        <div>
          <div class="dp-section-label">Reportada por</div>
          <div class="dp-meta-val-plain">${esc(_displayName(item.autor || item.creadoPor || 'Sistema'))}</div>
        </div>
        <div>
          <div class="dp-section-label">MVA / Activo</div>
          <div class="dp-meta-val">${esc(item.mva || '—')}</div>
        </div>
        <div>
          <div class="dp-section-label">Tipo</div>
          <div class="dp-meta-val">${esc(String(item.tipo || 'OTRO').toUpperCase())}</div>
        </div>
        <div>
          <div class="dp-section-label">Asignada a</div>
          <div class="dp-meta-val-plain">${asignadoA
            ? `<span class="dp-assign-pill"><span class="inc-avatar" style="width:18px;height:18px;font-size:8px;">${esc(_initialsFrom(asignadoA.nombre || asignadoA.email))}</span>${esc(asignadoA.nombre || _displayName(asignadoA.email))}</span>`
            : `<span class="dp-unassigned">Sin asignar</span>`
          }</div>
        </div>
        <div>
          <div class="dp-section-label">Visibilidad</div>
          <div class="dp-meta-val">${item.plaza && item.plaza !== 'GLOBAL'
            ? `<span class="dp-plaza-badge">${esc(item.plaza)}</span>`
            : `<span class="dp-plaza-badge is-global">GLOBAL</span>`
          }</div>
        </div>
      </section>

      ${evidencias.length ? `
        <section class="dp-section">
          <div class="dp-section-label">Evidencias · ${evidencias.length}</div>
          ${(() => {
            const imgs = evidencias.filter(ev => ev.url && _isImageUrl(ev.url));
            const files = evidencias.filter(ev => !(ev.url && _isImageUrl(ev.url)));
            return `
              ${imgs.length ? `<div class="dp-image-grid">${imgs.map(ev => `
                <a class="dp-image-thumb" href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer" title="${esc(ev.label)}">
                  <img src="${esc(ev.url)}" alt="${esc(ev.label)}" loading="lazy">
                </a>`).join('')}</div>` : ''}
              ${files.length ? `<div class="dp-attachments">${files.map(ev => ev.url
                ? `<a class="dp-attachment" href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer"><span class="material-icons">attach_file</span><span class="dp-att-label">${esc(ev.label)}</span></a>`
                : `<div class="dp-attachment"><span class="material-icons">folder</span><span class="dp-att-label">${esc(ev.label)}</span></div>`
              ).join('')}</div>` : ''}
            `;
          })()}
        </section>
      ` : ''}

      ${resolved ? `
        <section class="dp-section">
          <div class="dp-section-label">Resolución</div>
          <div class="dp-resolution">
            <div class="dp-resolution-head">
              <span class="material-icons">check</span>
              Resuelta por ${esc(_displayName(item.resueltoPor || item.quienResolvio || 'Sistema'))} · ${esc(_longDate(item.resueltoEn || item.resueltaEn || item.actualizadoEn))}
            </div>
            <div class="dp-resolution-body">${esc(item.solucion || 'Sin detalle de solución.').replace(/\n/g, '<br>')}</div>
          </div>
        </section>
      ` : ''}

      <section class="dp-section">
        <div class="dp-section-label">Seguidores · ${seguidores.length}</div>
        <div class="dp-seguidores">
          <div class="dp-watcher-stack">
            ${seguidores.slice(0, 6).map((s, i) => `
              <div class="dp-watcher-av" style="z-index:${10 - i}" title="${esc(s.nombre || _displayName(s.email))}">
                <span class="inc-avatar" style="width:22px;height:22px;font-size:9px;">${esc(_initialsFrom(s.nombre || s.email))}</span>
              </div>
            `).join('')}
          </div>
          ${seguidores.length > 6 ? `<span class="dp-seg-more">+${seguidores.length - 6}</span>` : ''}
          <button class="dp-seguir-btn${amFollowing ? ' is-following' : ''}" id="incSeguirBtn" data-stop>
            <span class="material-icons" style="font-size:13px">${amFollowing ? 'notifications_off' : 'notifications'}</span>
            ${amFollowing ? 'Dejar de seguir' : 'Seguir'}
          </button>
        </div>
      </section>

      ${related.length ? `
        <section class="dp-section">
          <div class="dp-section-label">Relacionadas</div>
          <div class="dp-related">
            ${related.map(r => {
              const rid = r.legacyNotaId || r.id || '';
              const rPr = _priority(r).toLowerCase();
              const rStatus = _statusFromNota(r);
              const rStKey = rStatus.toLowerCase();
              const rStLabel = _statusLabel(rStatus);
              return `
                <button class="dp-related-row" data-open-id="${esc(rid)}">
                  <span class="prio-dot is-${esc(rPr)}"></span>
                  <span class="dp-related-id">${esc(r.codigo || rid)}</span>
                  <span class="dp-related-title">${esc(r.titulo || 'Sin título')}</span>
                  <span class="status-pill is-${esc(rStKey)}"><span class="status-pill-dot"></span>${esc(rStLabel)}</span>
                </button>
              `;
            }).join('')}
          </div>
        </section>
      ` : ''}

      <section class="dp-section">
        <div class="dp-section-label">Línea de tiempo</div>
        <ol class="inc-timeline">
          <li class="inc-timeline-item is-create">
            <div class="inc-timeline-mark"><span class="material-icons">add</span></div>
            <div class="inc-timeline-text"><b>${esc(_displayName(item.autor || item.creadoPor || 'Sistema'))}</b> · Creó la incidencia</div>
            <div class="inc-timeline-when">${esc(_longDate(item.creadoEn || item.fecha))}</div>
          </li>
          ${asignadoA ? `
            <li class="inc-timeline-item is-assign">
              <div class="inc-timeline-mark"><span class="material-icons">person</span></div>
              <div class="inc-timeline-text">Asignada a <b>${esc(asignadoA.nombre || _displayName(asignadoA.email))}</b></div>
              <div class="inc-timeline-when">${esc(_longDate(item.creadoEn || item.fecha))}</div>
            </li>
          ` : ''}
          ${resolved ? `
            <li class="inc-timeline-item is-resolve">
              <div class="inc-timeline-mark"><span class="material-icons">check</span></div>
              <div class="inc-timeline-text"><b>${esc(_displayName(item.resueltoPor || item.quienResolvio || 'Sistema'))}</b> · Marcó como resuelta</div>
              <div class="inc-timeline-when">${esc(_longDate(item.resueltoEn || item.resueltaEn || item.actualizadoEn))}</div>
            </li>
          ` : ''}
        </ol>
      </section>

      <section class="dp-section">
        <div class="dp-section-label">Comentar</div>
        <div class="dp-comment">
          <span class="inc-avatar" style="width:22px;height:22px;font-size:9px;">${esc(meInitials)}</span>
          <input id="incCommentInput" placeholder="Escribe un comentario o @menciona…">
          <button class="dp-send" id="incCommentSend"><span class="material-icons">send</span></button>
        </div>
      </section>
    </div>

    <div class="dp-foot">
      ${open ? `
        <button class="dp-btn dp-btn-secondary" data-stop>
          <span class="material-icons" style="font-size:13px">person</span> Reasignar
        </button>
        <button class="dp-btn dp-btn-primary" data-resolve-id="${esc(item.legacyNotaId || item.id)}" data-stop>
          <span class="material-icons" style="font-size:13px">check</span> Marcar resuelta
        </button>
      ` : `
        <button class="dp-btn dp-btn-secondary" data-stop>
          <span class="material-icons" style="font-size:13px">refresh</span> Reabrir incidencia
        </button>
      `}
      ${canDelete ? `
        <button class="dp-btn is-danger" data-delete-id="${esc(item.legacyNotaId || item.id)}" data-stop>
          <span class="material-icons" style="font-size:13px">delete</span>
        </button>
      ` : ''}
    </div>
  `;

  // Rebind dentro del panel
  q('incDetailClose')?.addEventListener('click', _closeDetail);
  panel.querySelectorAll('[data-resolve-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.resolverTargetId = btn.dataset.resolveId || '';
      _toggleResolverModal(true);
    });
  });
  panel.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteId;
      if (await _mexConfirm('Eliminar registro', '¿Estás seguro de eliminar este registro? Esta acción no se puede deshacer.', 'danger')) {
        _onDeleteIncidencia(id);
      }
    });
  });
  panel.querySelectorAll('[data-open-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rid = btn.dataset.openId;
      const ritem = _state.allItems.find(it => (it.legacyNotaId || it.id) === rid);
      if (ritem) _openDetail(ritem);
    });
  });
  // Seguir / Dejar de seguir
  const seguirBtn = q('incSeguirBtn');
  if (seguirBtn) {
    seguirBtn.addEventListener('click', async () => {
      const gs3 = getState();
      const me = {
        uid: gs3?.profile?.uid || '',
        nombre: gs3?.profile?.nombreCompleto || gs3?.profile?.nombre || '',
        email: gs3?.profile?.email || ''
      };
      if (!me.uid && !me.email) return _showToast('Error', 'No se pudo identificar tu usuario.', 'error');
      try {
        seguirBtn.disabled = true;
        await toggleSeguidor(id, me);
      } catch (err) {
        _showToast('Error', err?.message || 'No se pudo actualizar.', 'error');
      } finally {
        seguirBtn.disabled = false;
      }
    });
  }

  // Comentario stub (solo toast por ahora)
  q('incCommentSend')?.addEventListener('click', () => {
    const txt = String(q('incCommentInput')?.value || '').trim();
    if (!txt) return;
    _showToast('Comentario enviado', 'Próximamente: se guardará en la línea de tiempo.', 'ok');
    const inp = q('incCommentInput');
    if (inp) inp.value = '';
  });
}

// ────────────────────────────────────────────────────────────
// CREATE / RESOLVE / DELETE
// ────────────────────────────────────────────────────────────
function _toggleCreateDialog(show) {
  const bd = q('incCreateBackdrop');
  bd?.classList.toggle('is-open', !!show);
  if (show) {
    _applyDraftMeta();
    const sub = q('incCreateSub');
    if (sub) sub.textContent = `Se publicará en la bitácora · ${_state?.plaza || 'GLOBAL'}`;
    _onDraftChange();
    _renderCreatePreview();
    setTimeout(() => q('nuevaNotaTitulo')?.focus(), 50);
  }
}

async function _onCreateIncidencia() {
  if (!_state?.plaza) return _showNotice('Selecciona una plaza para registrar notas e incidencias.', 'error');
  _syncRichEditorToTextarea();
  const titulo = String(q('nuevaNotaTitulo')?.value || '').trim();
  const descripcion = String(q('nuevaNotaTxt')?.value || '').trim();
  const descripcionHtml = _sanitizeRichHtml(_state.descripcionHtmlNuevaNota || '');
  const prioridad = String(q('nuevaNotaPrioridad')?.value || 'MEDIA').toUpperCase();
  const tipo = String(q('nuevaNotaTipo')?.value || 'OTRO').toUpperCase();
  const mva = String(q('incMvaInput')?.value || '').trim().toUpperCase();
  if (!titulo) return _showNotice('Escribe el título de la nota.', 'error');
  if (!descripcion) return _showNotice('Escribe la descripción.', 'error');

  const btn = q('btnPublicarInc');
  const gs = getState();
  const autor = gs.profile?.email || gs.profile?.nombre || 'Usuario';
  if (btn) btn.disabled = true;
  try {
    const payload = {
      titulo,
      descripcion,
      descripcionHtml,
      notaHtml: descripcionHtml,
      nota: descripcion,
      codigo: `INC-${String(Date.now()).slice(-6)}`,
      prioridad,
      tipo,
      mva,
      plaza: _state.plaza,
      plazaID: _state.plaza,
      autor,
      creadoPor: autor,
      estado: 'PENDIENTE',
      source: 'notas_admin',
      asignadoA: _state.asignarSelected || null,
      seguidores: [],
    };
    const links = (_state.linksNuevaNota || []).map(item => ({
      url: item.url,
      label: item.label || _labelFromUrl(item.url),
      tipo: 'link'
    }));
    if (_state.archivosNuevaNota.length) {
      payload.evidencias = _state.archivosNuevaNota.map(item => item.file);
      payload.archivos = _state.archivosNuevaNota.map(item => item.file);
    }
    if (links.length) {
      payload.adjuntos = links;
      payload.links = links;
      payload.enlaces = links;
      payload.evidenciaUrls = links.map(item => item.url);
    }

    await createIncidencia(payload);
    _showToast('Incidencia publicada', titulo.slice(0, 60), 'ok');
    const createAnother = !!q('incCreateAgain')?.checked;
    _resetComposer();
    if (!createAnother) _toggleCreateDialog(false);
    else setTimeout(() => q('nuevaNotaTitulo')?.focus(), 50);
  } catch (error) {
    _showToast('No se pudo publicar', error?.message || 'Intenta de nuevo.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _resetComposer() {
  const t = q('nuevaNotaTitulo'); if (t) t.value = '';
  const x = q('nuevaNotaTxt'); if (x) x.value = '';
  const r = q('nuevaNotaRich'); if (r) r.innerHTML = '';
  _state.descripcionHtmlNuevaNota = '';
  const pri = q('nuevaNotaPrioridad'); if (pri) pri.value = 'ALTA';
  const tip = q('nuevaNotaTipo'); if (tip) tip.value = 'OTRO';
  // Reset segmented prio
  qsa('[data-ci-prio]').forEach(b => b.classList.toggle('is-on', b.dataset.ciPrio === 'ALTA'));
  if (_state.archivosNuevaNota) {
    _state.archivosNuevaNota.forEach(item => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
    _state.archivosNuevaNota = [];
  }
  _state.linksNuevaNota = [];
  _state.asignarSelected = null;
  _state.asignarSearchTerm = '';
  const selEl = q('incAsignarSelected');
  const wrapEl = q('incAsignarSearchWrap');
  const dropEl = q('incAsignarDropdown');
  if (selEl) selEl.style.display = 'none';
  if (wrapEl) wrapEl.style.display = 'flex';
  if (dropEl) { dropEl.style.display = 'none'; dropEl.innerHTML = ''; }
  const assignInput = q('incAsignarInput');
  if (assignInput) assignInput.value = '';
  _state.createDraft = { titulo: '', descripcion: '', prioridad: 'ALTA', tipo: 'OTRO', mva: '' };
  _renderAdjuntosNuevos();
  _renderLinksNuevos();
  _prefillMvaFromQuery();
  _applyDraftMeta();
  _renderCreatePreview();
  _updateCreateSubmitState();
}

function _prefillMvaFromQuery() {
  const input = q('incMvaInput');
  if (!input) return;
  input.value = _state?.mvaFromQuery || '';
}

function _applyDraftMeta() {
  const gs = getState();
  const autor = gs.profile?.nombreCompleto || gs.profile?.nombre || gs.profile?.email || 'Sistema';
  const autorEl = q('autorNuevaNota');
  if (autorEl) autorEl.value = autor;
}

function _toggleResolverModal(show) {
  q('modalAuthIncidencia')?.classList.toggle('active', !!show);
  if (show) q('authComentario')?.focus();
}

async function _confirmResolve() {
  const id = String(_state?.resolverTargetId || '').trim();
  const comentario = String(q('authComentario')?.value || '').trim();
  if (!id) return _showNotice('No se pudo identificar la nota a resolver.', 'error');
  if (!comentario) return _showNotice('Describe cómo se solucionó.', 'error');
  const btn = q('btnConfirmarResInc');
  const gs = getState();
  const autor = gs.profile?.email || gs.profile?.nombre || 'Usuario';
  if (btn) btn.disabled = true;
  try {
    await resolveIncidencia(id, comentario, autor);
    _showNotice('Nota resuelta.', 'ok');
    _toggleResolverModal(false);
    const txt = q('authComentario'); if (txt) txt.value = '';
  } catch (error) {
    _showNotice(error?.message || 'No se pudo resolver la nota.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function _onDeleteIncidencia(id) {
  try {
    await deleteIncidencia(id);
    _showNotice('Nota eliminada', 'ok');
    if (_state?.detailOpenId === id) _closeDetail();
    if (_state?.plaza) _startListener();
  } catch (err) {
    _showNotice('Error al eliminar: ' + (err.message || ''), 'error');
  }
}

// ────────────────────────────────────────────────────────────
// Helpers (estado/prioridad/render texto/fechas)
// ────────────────────────────────────────────────────────────
function _statusFromNota(item) {
  const value = String(item?.estado || '').toUpperCase().trim();
  if (value === 'RESUELTA' || value === 'RESUELTO') return 'RESUELTA';
  if (value === 'CERRADA' || value === 'CERRADO') return 'CERRADA';
  if (value === 'EN_PROCESO' || value === 'EN PROCESO') return 'EN_PROCESO';
  return 'PENDIENTE';
}

function _statusLabel(key) {
  switch (key) {
    case 'RESUELTA': return 'Resuelta';
    case 'CERRADA': return 'Cerrada';
    case 'EN_PROCESO': return 'En proceso';
    default: return 'Pendiente';
  }
}

function _priority(item) {
  const p = String(item?.prioridad || '').toUpperCase().trim();
  if (p === 'CRITICA' || p === 'CRÍTICA' || p === 'CRITICO' || p === 'CRÍTICO' || p === 'URGENTE') return 'CRITICA';
  if (p === 'ALTA') return 'ALTA';
  if (p === 'BAJA') return 'BAJA';
  return 'MEDIA';
}

function _priorityLabel(p) {
  switch (p) {
    case 'CRITICA': return 'Crítica';
    case 'ALTA': return 'Alta';
    case 'BAJA': return 'Baja';
    default: return 'Media';
  }
}

function _canDelete(item) {
  if (_statusFromNota(item) !== 'PENDIENTE') return false;
  const gs = getState();
  const author = String(item?.autor || item?.creadoPor || '').trim();
  if (!author) return false;
  return [
    gs.profile?.nombre,
    gs.profile?.nombreCompleto,
    gs.profile?.displayName,
    gs.profile?.email
  ].some(value => String(value || '').trim() === author);
}

function _evidenceRows(item) {
  const list = [];
  const fromArray = value => {
    if (!Array.isArray(value)) return;
    value.forEach(v => list.push(v));
  };
  fromArray(item?.evidencias);
  fromArray(item?.adjuntos);
  fromArray(item?.evidenciaUrls);
  fromArray(item?.links);
  fromArray(item?.enlaces);
  if (item?.url) list.push(item.url);
  if (item?.evidencia) list.push(item.evidencia);
  const out = [];
  const seen = new Set();
  list.forEach(entry => {
    let url = '';
    let path = '';
    let label = '';
    if (typeof entry === 'string') {
      url = entry.trim();
      label = url || 'Evidencia';
    } else if (entry && typeof entry === 'object') {
      url = String(entry.url || entry.href || '').trim();
      path = String(entry.path || '').trim();
      label = String(entry.nombre || entry.name || entry.filename || entry.fileName || entry.label || '').trim();
    }
    const key = `${url}|${path}|${label}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ url, path, label: label || (url || path || 'Evidencia') });
  });
  return out;
}

function _renderRichText(value = '', html = '') {
  const rich = _sanitizeRichHtml(html || '');
  if (rich) return rich;
  const escaped = esc(value || '');
  return escaped
    .replace(/(https?:\/\/[^\s<]+)/g, url => `<a class="inc-inline-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)
    .replace(/\n/g, '<br>');
}

function _dateMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function _longDate(value) {
  const t = _dateMs(value);
  if (!t) return '—';
  return new Date(t).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function _relativeDate(value) {
  const t = _dateMs(value);
  if (!t) return '—';
  const now = Date.now();
  const diff = now - t;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  const hrs = Math.floor(min / 60);
  const days = Math.floor(hrs / 24);
  if (min < 1) return 'hace segundos';
  if (min < 60) return `hace ${min}m`;
  if (hrs < 24) return `hace ${hrs}h`;
  if (days < 7) return `hace ${days}d`;
  return new Date(t).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

function _empty(message, kind = 'inbox', loading = false) {
  const icon = loading ? 'sync'
    : kind === 'search' ? 'search_off'
    : kind === 'error' ? 'error_outline'
    : kind === 'block' ? 'block'
    : kind === 'place' ? 'place'
    : 'inbox';
  return `
    <div class="inc-empty">
      <div class="inc-empty-mark ${loading ? 'spinning' : ''}"><span class="material-icons">${icon}</span></div>
      <div class="inc-empty-title">${esc(message)}</div>
    </div>
  `;
}

function _setText(id, value) {
  const el = q(id);
  if (el) el.textContent = String(value || '');
}

function _showNotice(message, type = 'ok') {
  // Compat: si recibe (mensaje, tipo) lo mapea al nuevo toast
  _showToast(message, '', type);
}

function _showToast(title, sub = '', tone = 'ok') {
  if (!_container) {
    // Fallback (no module mounted)
    let el = document.getElementById('app-inc-notice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'app-inc-notice';
      el.style.cssText = 'position:fixed;right:16px;bottom:18px;z-index:100001;padding:10px 12px;border-radius:10px;color:#fff;font:700 12px Inter,sans-serif;box-shadow:0 10px 26px rgba(15,23,42,.24);max-width:92vw;';
      document.body.appendChild(el);
    }
    el.style.background = tone === 'error' ? '#b91c1c' : '#166534';
    el.textContent = String(title || '');
    el.style.opacity = '1';
    clearTimeout(_showToast._t);
    _showToast._t = setTimeout(() => { el.style.opacity = '0'; }, 3200);
    return;
  }

  // Remueve toast anterior
  const old = _container.querySelector('.toast');
  if (old) old.remove();
  if (_state?.toastTimer) {
    clearTimeout(_state.toastTimer);
    _state.toastTimer = null;
  }

  const icon = tone === 'error' ? 'error_outline'
    : tone === 'warn' ? 'warning'
    : 'check';
  const cls = tone === 'error' ? 'toast-error'
    : tone === 'warn' ? 'toast-warn'
    : 'toast-ok';

  const wrap = document.createElement('div');
  wrap.className = `toast ${cls}`;
  wrap.innerHTML = `
    <div class="toast-icon"><span class="material-icons">${icon}</span></div>
    <div class="toast-body">
      <div class="toast-title">${esc(title || '')}</div>
      ${sub ? `<div class="toast-sub">${esc(sub)}</div>` : ''}
    </div>
    <button class="toast-close" title="Cerrar"><span class="material-icons">close</span></button>
  `;
  wrap.querySelector('.toast-close')?.addEventListener('click', () => {
    wrap.remove();
    if (_state?.toastTimer) { clearTimeout(_state.toastTimer); _state.toastTimer = null; }
  });
  _container.appendChild(wrap);
  if (_state) {
    _state.toastTimer = setTimeout(() => {
      wrap.remove();
      if (_state) _state.toastTimer = null;
    }, 3600);
  }
}

function _onBulkResolve() {
  const ids = (_state?.selectedIds || []).slice();
  if (!ids.length) return;
  _showToast('Resolución masiva', `${ids.length} incidencia${ids.length === 1 ? '' : 's'}: marca una por una desde el detalle.`, 'warn');
  // Limpia selección visual
  _state.selectedIds = [];
  _render();
}

function _onBulkCopyCsv() {
  const ids = new Set(_state?.selectedIds || []);
  if (!ids.size) return;
  const items = (_state.allItems || []).filter(it => ids.has(it.legacyNotaId || it.id));
  const header = ['ID', 'Titulo', 'Prioridad', 'Estado', 'Tipo', 'MVA', 'Autor', 'CreadoEn'];
  const rows = items.map(it => [
    it.codigo || it.legacyNotaId || it.id || '',
    (it.titulo || '').replace(/[\r\n]+/g, ' '),
    _priority(it),
    _statusFromNota(it),
    String(it.tipo || 'OTRO').toUpperCase(),
    it.mva || '',
    it.autor || it.creadoPor || '',
    _longDate(it.creadoEn || it.fecha)
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [header.join(','), ...rows].join('\n');
  const copy = navigator.clipboard?.writeText ? navigator.clipboard.writeText(csv) : Promise.reject();
  copy
    .then(() => _showToast('Copiado como CSV', `${items.length} incidencia${items.length === 1 ? '' : 's'} en el portapapeles`, 'ok'))
    .catch(() => _showToast('No se pudo copiar', 'Tu navegador bloqueó el acceso al portapapeles.', 'error'));
}

function _onDraftChange() {
  if (!_state) return;
  _state.createDraft.titulo = String(q('nuevaNotaTitulo')?.value || '');
  _state.createDraft.descripcion = String(q('nuevaNotaTxt')?.value || q('nuevaNotaRich')?.innerText || '');
  _state.createDraft.prioridad = String(q('nuevaNotaPrioridad')?.value || 'ALTA').toUpperCase();
  _state.createDraft.tipo = String(q('nuevaNotaTipo')?.value || 'OTRO').toUpperCase();
  _state.createDraft.mva = String(q('incMvaInput')?.value || '').trim();
  // Hint counter
  const titleHint = q('incCreateTitleHint');
  if (titleHint) {
    const n = _state.createDraft.titulo.length;
    titleHint.textContent = `Sé específico: incluye activo y síntoma. ${n}/120`;
  }
  _renderCreatePreview();
  _updateCreateSubmitState();
}

function _renderCreatePreview() {
  const card = q('incCreatePreviewCard');
  if (!card) return;
  const d = _state?.createDraft || { titulo: '', descripcion: '', prioridad: 'ALTA', tipo: 'OTRO', mva: '' };
  const prLower = String(d.prioridad).toLowerCase();
  const tipo = String(d.tipo || 'OTRO').toUpperCase();
  const gs = getState();
  const me = gs?.profile?.nombreCompleto || gs?.profile?.nombre || gs?.profile?.email || 'Sistema';
  const meInitials = _initialsFrom(me);

  card.innerHTML = `
    <div class="ci-prev-bar is-${esc(prLower)}"></div>
    <div class="ci-prev-top">
      <span class="ci-prev-id">INC-NUEVA</span>
      <span class="ci-prev-dot">·</span>
      <span>${esc(_state?.plaza || 'GLOBAL')}</span>
      <span class="ci-prev-dot">·</span>
      <span>justo ahora</span>
    </div>
    <h2 class="ci-prev-title">${d.titulo ? esc(d.titulo) : '<span class="ci-prev-empty">Título de la incidencia</span>'}</h2>
    <div class="ci-prev-pills">
      <span class="ci-prev-pill"><span class="prio-dot is-${esc(prLower)}"></span>${esc(_priorityLabel(d.prioridad))}</span>
      <span class="status-pill is-pendiente"><span class="status-pill-dot"></span>Pendiente</span>
      <span class="ci-prev-pill ci-prev-pill-soft">${esc(tipo)}</span>
      ${d.mva ? `<span class="ci-prev-pill ci-prev-pill-soft">${esc(d.mva)}</span>` : ''}
    </div>
    <section class="ci-prev-section">
      <div class="ci-prev-section-label">Descripción</div>
      <p class="ci-prev-note">${d.descripcion ? esc(d.descripcion) : '<span class="ci-prev-empty">La descripción aparecerá aquí…</span>'}</p>
    </section>
    <section class="ci-prev-meta">
      <div>
        <div class="ci-prev-meta-label">Reportada por</div>
        <div class="ci-prev-person">
          <span class="inc-avatar" style="width:20px;height:20px;font-size:9px;">${esc(meInitials)}</span>
          <div>
            <div class="ci-prev-person-name">${esc(me)}</div>
            <div class="ci-prev-person-sub">Notificación automática</div>
          </div>
        </div>
      </div>
      <div>
        <div class="ci-prev-meta-label">MVA / Activo</div>
        <div class="ci-prev-mono">${esc(d.mva || '—')}</div>
      </div>
    </section>
    <footer class="ci-prev-foot">
      <span class="material-icons">notifications</span>
      Se notificará al equipo de despacho al publicar
    </footer>
  `;
}

function _updateCreateSubmitState() {
  const btn = q('btnPublicarInc');
  if (!btn) return;
  const t = String(_state?.createDraft?.titulo || '').trim();
  if (t.length < 3) btn.classList.add('is-disabled');
  else btn.classList.remove('is-disabled');
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Limpia un valor que puede ser email/nombre para mostrar solo el nombre
function _displayName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  // Si contiene @ es un email → extraer parte antes de @ y capitalizar
  if (raw.includes('@')) {
    const local = raw.split('@')[0];
    // Reemplaza puntos/guiones con espacios y capitaliza cada palabra
    return local
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || raw;
  }
  return raw;
}

// Detecta si una URL apunta a una imagen
function _isImageUrl(url) {
  if (!url) return false;
  // Por extensión
  if (/\.(jpe?g|png|gif|webp|bmp|svg|avif)(\?|$)/i.test(url)) return true;
  // Firebase Storage URLs de imágenes suelen tener alt=media y un path con imagen
  if (/firebasestorage\.googleapis\.com/.test(url) && /\.(jpe?g|png|gif|webp)/i.test(url)) return true;
  return false;
}

// ────────────────────────────────────────────────────────────
// LAYOUT (HTML inicial)
// ────────────────────────────────────────────────────────────
function _renderPriorityChecks() {
  const opts = [
    { key: 'CRITICA', label: 'Crítica', cls: 'is-critica' },
    { key: 'ALTA',    label: 'Alta',    cls: 'is-alta' },
    { key: 'MEDIA',   label: 'Media',   cls: 'is-media' },
    { key: 'BAJA',    label: 'Baja',    cls: 'is-baja' },
  ];
  return opts.map(o => `
    <label class="rail-check is-on" data-priority="${o.key}">
      <input type="checkbox" checked>
      <span class="rail-tick"></span>
      <span class="prio-dot ${o.cls}"></span>
      <span class="rail-label">${o.label}</span>
      <span class="rail-num" data-count-priority="${o.key}">0</span>
    </label>
  `).join('');
}

function _renderStatusChecks() {
  const opts = [
    { key: 'PENDIENTE',  label: 'Pendiente',  cls: 'is-pendiente' },
    { key: 'EN_PROCESO', label: 'En proceso', cls: 'is-en_proceso' },
    { key: 'RESUELTA',   label: 'Resuelta',   cls: 'is-resuelta' },
    { key: 'CERRADA',    label: 'Cerrada',    cls: 'is-cerrada' },
  ];
  return opts.map(o => `
    <label class="rail-check is-on" data-status="${o.key}">
      <input type="checkbox" checked>
      <span class="rail-tick"></span>
      <span class="status-pill ${o.cls}" style="padding:1px 7px;font-size:10.5px;"><span class="status-pill-dot"></span>${o.label}</span>
      <span class="rail-num" data-count-status="${o.key}">0</span>
    </label>
  `).join('');
}

function _renderTipoChecks() {
  return TIPOS_KNOWN.map(t => `
    <label class="rail-check is-on" data-tipo="${t}">
      <input type="checkbox" checked>
      <span class="rail-tick"></span>
      <span class="rail-label">${esc(t.charAt(0) + t.slice(1).toLowerCase())}</span>
      <span class="rail-num" data-count-tipo="${t}">0</span>
    </label>
  `).join('');
}

function _renderLayout() {
  return `
    <div class="inc-module" data-theme="light" data-density="regular">
      <header class="mod-head">
        <div class="mod-head-left">
          <h1 class="mod-title">Incidencias</h1>
          <p class="mod-sub" id="incModSub">Bitácora operativa</p>
        </div>
        <div class="mod-actions">
          <button class="btn-ghost" id="incBtnNew" title="Nueva incidencia (N)">
            <span class="material-icons" style="font-size:13px;">add</span> Nueva incidencia
          </button>
        </div>
      </header>

      <div class="metrics" id="incMetrics"></div>

      <div class="workspace">
        <aside class="rail">
          <button class="rail-new" id="incBtnNewRail" title="Nueva incidencia (N)">
            <span class="material-icons" style="font-size:14px;">add</span>
            Nueva incidencia
            <span class="rail-new-kbd">N</span>
          </button>

          <div class="rail-section">
            <div class="rail-title">Prioridad</div>
            <div class="rail-list">
              ${_renderPriorityChecks()}
            </div>
          </div>

          <div class="rail-section">
            <div class="rail-title">Estado</div>
            <div class="rail-list">
              ${_renderStatusChecks()}
            </div>
          </div>

          <div class="rail-section">
            <div class="rail-title">Tipo</div>
            <div class="rail-list">
              ${_renderTipoChecks()}
            </div>
          </div>

          <div class="rail-section">
            <div class="rail-title">Asignado a</div>
            <div class="rail-list">
              <label class="rail-check is-on">
                <input type="radio" name="incAssignTo" checked>
                <span class="rail-radio"></span>
                <span class="rail-label">Cualquiera</span>
              </label>
              <label class="rail-check">
                <input type="radio" name="incAssignTo">
                <span class="rail-radio"></span>
                <span class="rail-label">Sin asignar</span>
              </label>
              <label class="rail-check">
                <input type="radio" name="incAssignTo">
                <span class="rail-radio"></span>
                <span class="rail-label">Yo</span>
              </label>
            </div>
          </div>

          <div class="rail-section">
            <div class="rail-title">Vistas guardadas</div>
            <div class="rail-list">
              <button type="button" class="rail-saved"><span class="rail-saved-dot"></span>Mi día</button>
              <button type="button" class="rail-saved"><span class="rail-saved-dot"></span>SLA crítico</button>
              <button type="button" class="rail-saved"><span class="rail-saved-dot"></span>Por flota</button>
              <button type="button" class="rail-saved"><span class="rail-saved-dot"></span>Cerradas semana</button>
            </div>
          </div>
        </aside>

        <main class="inc-canvas">
          <div class="inc-toolbar" id="incToolbar"></div>
          <div class="inc-view-container" id="incViewContainer"></div>
        </main>

        <aside class="detail" id="incDetailPanel"></aside>
      </div>

      <!-- Dialog Nueva incidencia (split form + live preview) -->
      <div class="ci-backdrop" id="incCreateBackdrop">
        <div class="ci-sheet" role="dialog" aria-modal="true" aria-labelledby="incCreateTitle">
          <header class="ci-head">
            <div class="ci-head-left">
              <div class="ci-head-icon"><span class="material-icons">add</span></div>
              <div>
                <div class="ci-head-title" id="incCreateTitle">Nueva incidencia</div>
                <div class="ci-head-sub" id="incCreateSub">Se publicará en la bitácora</div>
              </div>
            </div>
            <div class="ci-head-right">
              <span class="ci-kbd">⌘</span>
              <span class="ci-kbd">↵</span>
              <span class="ci-head-hint">para publicar</span>
              <button class="ci-close" id="incCreateClose" title="Cerrar"><span class="material-icons">close</span></button>
            </div>
          </header>

          <div class="ci-body">
            <div class="ci-form">
              <div class="ci-field">
                <label class="ci-label">Título</label>
                <input type="text" id="nuevaNotaTitulo" class="ci-input ci-input-lg" placeholder="Ej. Fuga hidráulica en compactador 03">
                <div class="ci-hint" id="incCreateTitleHint">Sé específico: incluye activo y síntoma.</div>
              </div>

              <div class="ci-grid">
                <div class="ci-field">
                  <label class="ci-label">Prioridad</label>
                  <div class="ci-prio-seg" id="incPrioSeg">
                    <button type="button" class="ci-prio-opt ci-prio-critica" data-ci-prio="CRITICA"><span class="prio-dot is-critica"></span>Crítica</button>
                    <button type="button" class="ci-prio-opt ci-prio-alta is-on" data-ci-prio="ALTA"><span class="prio-dot is-alta"></span>Alta</button>
                    <button type="button" class="ci-prio-opt ci-prio-media" data-ci-prio="MEDIA"><span class="prio-dot is-media"></span>Media</button>
                    <button type="button" class="ci-prio-opt ci-prio-baja" data-ci-prio="BAJA"><span class="prio-dot is-baja"></span>Baja</button>
                  </div>
                  <select id="nuevaNotaPrioridad" style="display:none">
                    <option value="BAJA">Baja</option>
                    <option value="MEDIA">Media</option>
                    <option value="ALTA" selected>Alta</option>
                    <option value="CRITICA">Crítica</option>
                  </select>
                </div>

                <div class="ci-field">
                  <label class="ci-label">Tipo</label>
                  <select id="nuevaNotaTipo" class="ci-input">
                    <option value="MECANICA">Mecánica</option>
                    <option value="ACCIDENTE">Accidente</option>
                    <option value="LIMPIEZA">Limpieza</option>
                    <option value="DOCUMENTOS">Documentos</option>
                    <option value="OTRO" selected>Otro</option>
                  </select>
                </div>

                <div class="ci-field">
                  <label class="ci-label">MVA / Activo</label>
                  <input type="text" id="incMvaInput" class="ci-input ci-input-mono" placeholder="MVA-2241">
                </div>

                <div class="ci-field">
                  <label class="ci-label">Reportado por</label>
                  <input type="text" id="autorNuevaNota" class="ci-input" disabled>
                </div>
              </div>

              <div class="ci-field" style="position:relative">
                <label class="ci-label">Asignar a <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--fg-muted)">(opcional)</span></label>
                <div class="ci-assign-selected" id="incAsignarSelected" style="display:none">
                  <span class="inc-avatar" style="width:22px;height:22px;font-size:9px;" id="incAsignarAvatar"></span>
                  <span id="incAsignarNombre" style="font-size:13px;color:var(--fg-strong);flex:1"></span>
                  <span id="incAsignarRole" style="font-size:11px;color:var(--fg-muted)"></span>
                  <button type="button" class="ci-assign-clear" id="incAsignarClear" title="Quitar asignación">
                    <span class="material-icons" style="font-size:14px">close</span>
                  </button>
                </div>
                <div class="ci-assign-search-wrap" id="incAsignarSearchWrap">
                  <span class="material-icons" style="font-size:14px;color:var(--fg-muted)">person_search</span>
                  <input type="text" id="incAsignarInput" class="ci-assign-search-input"
                    placeholder="Buscar por nombre, correo o rol…" autocomplete="off">
                </div>
                <div class="ci-assign-dropdown" id="incAsignarDropdown" style="display:none"></div>
              </div>

              <div class="ci-field">
                <label class="ci-label">Descripción</label>
                <div id="nuevaNotaRich" class="ci-textarea" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Describe qué ocurrió, qué se observó y cualquier acción tomada."></div>
                <textarea id="nuevaNotaTxt" style="display:none"></textarea>
              </div>

              <div class="ci-field">
                <label class="ci-label">Adjuntar evidencias</label>
                <label class="btn-ghost" style="align-self:flex-start;cursor:pointer;">
                  <span class="material-icons" style="font-size:13px">cloud_upload</span> Seleccionar archivos…
                  <input type="file" id="incAdjuntosInput" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="display:none;">
                </label>
                <div id="incAdjuntosNuevosCont"></div>
              </div>

              <div class="ci-field">
                <label class="ci-label">Link de evidencia</label>
                <div class="inc-link-input-row">
                  <input type="url" id="incLinkInput" class="ci-input ci-input-mono" placeholder="https://drive.google.com/...">
                  <button type="button" id="incAddLinkBtn" class="btn-ghost"><span class="material-icons" style="font-size:13px">add_link</span>Agregar</button>
                </div>
                <div id="incLinksNuevosCont" class="inc-link-chip-list"></div>
              </div>

              <!-- Compatibilidad: editor toolbar oculto (sigue siendo refireable desde código existente si usuarios lo usan) -->
              <div style="display:none">
                <select id="incEditorFontSize"><option value="3" selected>Normal</option></select>
                <select id="incEditorFontFamily"><option value="Inter" selected>Inter</option></select>
              </div>
            </div>

            <aside class="ci-preview" id="incCreatePreview">
              <div class="ci-prev-head">
                <span class="ci-prev-label">Vista previa</span>
                <span class="ci-prev-live"><span class="ci-prev-live-dot"></span>En vivo</span>
              </div>
              <div class="ci-prev-canvas">
                <article class="ci-prev-card" id="incCreatePreviewCard"></article>
              </div>
            </aside>
          </div>

          <footer class="ci-foot">
            <label class="ci-foot-check">
              <input type="checkbox" id="incCreateAgain" checked>
              <span class="ci-foot-check-box"></span>
              Crear otra después de publicar
            </label>
            <div style="flex:1"></div>
            <button type="button" id="incCreateCancel" class="btn-ghost">Cancelar</button>
            <button type="button" id="btnPublicarInc" class="btn-primary"><span class="material-icons" style="font-size:13px">check</span>Publicar nota</button>
          </footer>
        </div>
      </div>

      <!-- Modal resolver (mantenemos compat con IDs antiguos) -->
      <div id="modalAuthIncidencia" class="modal-overlay">
        <div class="modal-box">
          <div class="modal-title">Resolver nota</div>
          <div class="modal-text">Describe brevemente cómo se solucionó:</div>
          <textarea id="authComentario" rows="3"></textarea>
          <div class="modal-actions">
            <button id="incResolverCancelar" class="modal-btn modal-btn-cancel">CANCELAR</button>
            <button id="btnConfirmarResInc" class="modal-btn modal-btn-confirm">CONFIRMAR</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
