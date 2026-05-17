// ═══════════════════════════════════════════════════════════
//  /js/app/views/incidencias.js
//  Paso 1 — Migración visual al design system de /INCIDENCIAS/
//  Mantiene toda la lógica Firestore (notas_admin), App Shell,
//  filtros, CRUD y caché. Reescribe HTML/UI a la nueva estructura.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { subscribeIncidencias, createIncidencia, resolveIncidencia, deleteIncidencia } from '/js/app/features/incidencias/incidencias-data.js';

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

  // Botón "Nueva"
  q('incBtnNew')?.addEventListener('click', () => _toggleCreateDialog(true));
  q('incCreateClose')?.addEventListener('click', () => _toggleCreateDialog(false));
  q('incCreateCancel')?.addEventListener('click', () => _toggleCreateDialog(false));
  q('incCreateBackdrop')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) _toggleCreateDialog(false);
  });

  // Toolbar · Tabs
  qsa('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.activeTab = btn.dataset.tab;
      _applyFilters();
      _render();
    });
  });

  // Toolbar · Sort
  q('incSort')?.addEventListener('change', event => {
    _state.sortBy = String(event.target.value || 'recent');
    _applyFilters();
    _render();
  });

  // Toolbar · View toggle
  qsa('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.viewMode = btn.dataset.view;
      _render();
    });
  });

  // Refresh
  q('incRefreshBtn')?.addEventListener('click', () => {
    if (_state?.plaza) _startListener();
  });

  // Detail panel · Cerrar
  q('incDetailClose')?.addEventListener('click', _closeDetail);

  // Composer
  q('btnPublicarInc')?.addEventListener('click', _onCreateIncidencia);
  q('nuevaNotaPrioridad')?.addEventListener('change', _applyDraftMeta);
  q('nuevaNotaTitulo')?.addEventListener('input', () => {});
  q('nuevaNotaRich')?.addEventListener('input', _syncRichEditorToTextarea);
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
  _renderFilterRail();
  _renderToolbar();
  _renderView(_state.items);
  _renderDetailPanel();
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
  // Tabs activos
  qsa('[data-tab]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.tab === _state.activeTab));
  // Vista activa
  qsa('[data-view]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.view === _state.viewMode));
  // Sort select
  const sortEl = q('incSort');
  if (sortEl && sortEl.value !== _state.sortBy) sortEl.value = _state.sortBy;

  // Tab counters
  const me = _state.myAuthor;
  const all = _state.allItems || [];
  _setText('tabCount_todas', all.length);
  _setText('tabCount_mias', all.filter(it => String(it?.autor || it?.creadoPor || '').toLowerCase() === me).length);
  _setText('tabCount_sin_asignar', all.filter(it => !String(it?.autor || it?.creadoPor || '').trim()).length);

  // Results count
  _setText('incResultsCount', `${_state.items.length} resultado${_state.items.length === 1 ? '' : 's'}`);
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
      <span></span>
      <span>ID</span>
      <span>Incidencia</span>
      <span>Estado</span>
      <span>Acción</span>
      <span></span>
    </div>
  `;
  const rows = items.map(item => {
    const id = item.legacyNotaId || item.id || '';
    const codigo = item.codigo || id;
    const pr = _priority(item).toLowerCase();
    const status = _statusFromNota(item);
    const stKey = status.toLowerCase();
    const stLabel = _statusLabel(status);
    const isActive = _state.detailOpenId === id;
    const open = status === 'PENDIENTE' || status === 'EN_PROCESO';
    const canDelete = _canDelete(item);
    const tipo = String(item?.tipo || 'OTRO').toUpperCase().trim() || 'OTRO';
    const mva = item.mva || '';
    const fecha = _relativeDate(item.creadoEn || item.fecha);

    return `
      <div class="inc-row ${isActive ? 'is-active' : ''}" data-open-id="${esc(id)}">
        <div class="row-prio-bar is-${esc(pr)}"></div>
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
        <div><span class="status-pill is-${esc(stKey)}"><span class="status-pill-dot"></span>${esc(stLabel)}</span></div>
        <div>
          ${open
            ? `<button class="inc-row-action" data-resolve-id="${esc(id)}" data-stop title="Marcar como resuelta"><span class="material-icons">check</span>Resolver</button>`
            : `<span class="status-pill is-resuelta"><span class="material-icons" style="font-size:11px;">check</span>Resuelta</span>`}
        </div>
        <div>
          ${canDelete ? `<button class="inc-row-delete" data-delete-id="${esc(id)}" data-stop title="Eliminar"><span class="material-icons">delete</span></button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `<div class="inc-list">${head}<div class="inc-list-body">${rows}</div></div>`;
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
        <td class="td-mono">${esc(item.autor || item.creadoPor || '—')}</td>
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
  const panel = q('incDetailPanel');
  panel?.classList.add('is-open');
}

function _closeDetail() {
  if (!_state) return;
  _state.detailOpenId = '';
  const panel = q('incDetailPanel');
  panel?.classList.remove('is-open');
  _renderView(_state.items);
}

function _renderDetailPanel() {
  const panel = q('incDetailPanel');
  if (!panel) return;
  const id = _state.detailOpenId;
  if (!id) {
    panel.innerHTML = `
      <div class="dp-empty">
        <div class="dp-empty-mark"><span class="material-icons">inbox</span></div>
        <div class="dp-empty-title">Selecciona una incidencia</div>
        <div class="dp-empty-sub">Aquí verás el detalle completo, la línea de tiempo y las acciones.</div>
      </div>
    `;
    return;
  }
  const item = _state.allItems.find(it => (it.legacyNotaId || it.id) === id);
  if (!item) {
    panel.innerHTML = `
      <div class="dp-empty">
        <div class="dp-empty-mark"><span class="material-icons">inbox</span></div>
        <div class="dp-empty-title">Incidencia no disponible</div>
        <div class="dp-empty-sub">Es posible que haya sido eliminada o ya no esté visible.</div>
      </div>
    `;
    return;
  }

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

  panel.innerHTML = `
    <div class="dp-head">
      <div class="dp-head-top">
        <span class="dp-id">${esc(codigo)}</span>
        <span class="dp-id-sep">·</span>
        <span class="dp-region">${esc(item.plaza || _state.plaza || 'GLOBAL')}</span>
        <span class="dp-head-spacer"></span>
        <button class="dp-icon-btn" id="incDetailClose" title="Cerrar"><span class="material-icons">close</span></button>
      </div>
      <h2 class="dp-title">${esc(item.titulo || 'Sin título')}</h2>
      <div class="dp-pills">
        <span class="dp-pill"><span class="prio-dot is-${esc(prLower)}"></span>${esc(_priorityLabel(pr))}</span>
        <span class="status-pill is-${esc(stKey)}"><span class="status-pill-dot"></span>${esc(stLabel)}</span>
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
          <div class="dp-meta-val-plain">${esc(item.autor || item.creadoPor || 'Sistema')}</div>
        </div>
        <div>
          <div class="dp-section-label">MVA / Activo</div>
          <div class="dp-meta-val">${esc(item.mva || '—')}</div>
        </div>
        <div>
          <div class="dp-section-label">Tipo</div>
          <div class="dp-meta-val">${esc(String(item.tipo || 'OTRO').toUpperCase())}</div>
        </div>
      </section>

      ${evidencias.length ? `
        <section class="dp-section">
          <div class="dp-section-label">Evidencias · ${evidencias.length}</div>
          <div class="dp-attachments">
            ${evidencias.map(ev => ev.url
              ? `<a class="dp-attachment" href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer"><span class="material-icons">attach_file</span><span class="dp-att-label">${esc(ev.label)}</span></a>`
              : `<div class="dp-attachment"><span class="material-icons">folder</span><span class="dp-att-label">${esc(ev.label)}</span></div>`
            ).join('')}
          </div>
        </section>
      ` : ''}

      ${resolved ? `
        <section class="dp-section">
          <div class="dp-section-label">Resolución</div>
          <div class="dp-resolution">
            <div class="dp-resolution-head">
              <span class="material-icons">check</span>
              Resuelta por ${esc(item.resueltoPor || item.quienResolvio || 'Sistema')} · ${esc(_longDate(item.resueltoEn || item.resueltaEn || item.actualizadoEn))}
            </div>
            <div class="dp-resolution-body">${esc(item.solucion || 'Sin detalle de solución.').replace(/\n/g, '<br>')}</div>
          </div>
        </section>
      ` : ''}

      <section class="dp-section">
        <div class="dp-section-label">Línea de tiempo</div>
        <ol class="inc-timeline">
          <li class="inc-timeline-item is-create">
            <div class="inc-timeline-mark"><span class="material-icons">add</span></div>
            <div class="inc-timeline-text"><b>${esc(item.autor || item.creadoPor || 'Sistema')}</b> · Creó la incidencia</div>
            <div class="inc-timeline-when">${esc(_longDate(item.creadoEn || item.fecha))}</div>
          </li>
          ${resolved ? `
            <li class="inc-timeline-item is-resolve">
              <div class="inc-timeline-mark"><span class="material-icons">check</span></div>
              <div class="inc-timeline-text"><b>${esc(item.resueltoPor || item.quienResolvio || 'Sistema')}</b> · Marcó como resuelta</div>
              <div class="inc-timeline-when">${esc(_longDate(item.resueltoEn || item.resueltaEn || item.actualizadoEn))}</div>
            </li>
          ` : ''}
        </ol>
      </section>
    </div>

    <div class="dp-foot">
      ${open ? `
        <button class="dp-btn is-primary" data-resolve-id="${esc(item.legacyNotaId || item.id)}" data-stop>
          <span class="material-icons">check</span> Marcar resuelta
        </button>
      ` : ''}
      ${canDelete ? `
        <button class="dp-btn is-danger" data-delete-id="${esc(item.legacyNotaId || item.id)}" data-stop>
          <span class="material-icons">delete</span> Eliminar
        </button>
      ` : ''}
      ${!open && !canDelete ? `<span style="font-size:11.5px;color:var(--fg-muted);align-self:center;">Sin acciones disponibles.</span>` : ''}
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
}

// ────────────────────────────────────────────────────────────
// CREATE / RESOLVE / DELETE
// ────────────────────────────────────────────────────────────
function _toggleCreateDialog(show) {
  const bd = q('incCreateBackdrop');
  bd?.classList.toggle('is-open', !!show);
  if (show) {
    _applyDraftMeta();
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
      source: 'notas_admin'
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
    _showNotice('Nota publicada.', 'ok');
    _resetComposer();
    _toggleCreateDialog(false);
  } catch (error) {
    _showNotice(error?.message || 'Error al publicar.', 'error');
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
  if (_state.archivosNuevaNota) {
    _state.archivosNuevaNota.forEach(item => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
    _state.archivosNuevaNota = [];
  }
  _state.linksNuevaNota = [];
  _renderAdjuntosNuevos();
  _renderLinksNuevos();
  _prefillMvaFromQuery();
  _applyDraftMeta();
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
  let el = document.getElementById('app-inc-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-inc-notice';
    el.style.cssText = 'position:fixed;right:16px;bottom:18px;z-index:100001;padding:10px 12px;border-radius:10px;color:#fff;font:700 12px Inter,sans-serif;box-shadow:0 10px 26px rgba(15,23,42,.24);max-width:92vw;';
    document.body.appendChild(el);
  }
  el.style.background = type === 'error' ? '#b91c1c' : '#166534';
  el.textContent = String(message || '');
  el.style.opacity = '1';
  clearTimeout(_showNotice._t);
  _showNotice._t = setTimeout(() => { el.style.opacity = '0'; }, 3200);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    <label class="inc-filter-check is-on" data-priority="${o.key}">
      <input type="checkbox" checked>
      <span class="inc-filter-tick"></span>
      <span class="prio-dot ${o.cls}"></span>
      <span class="inc-filter-label">${o.label}</span>
      <span class="inc-filter-count" data-count-priority="${o.key}">0</span>
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
    <label class="inc-filter-check is-on" data-status="${o.key}">
      <input type="checkbox" checked>
      <span class="inc-filter-tick"></span>
      <span class="status-pill ${o.cls}" style="padding:1px 7px;font-size:10.5px;"><span class="status-pill-dot"></span>${o.label}</span>
      <span class="inc-filter-count" data-count-status="${o.key}">0</span>
    </label>
  `).join('');
}

function _renderTipoChecks() {
  return TIPOS_KNOWN.map(t => `
    <label class="inc-filter-check is-on" data-tipo="${t}">
      <input type="checkbox" checked>
      <span class="inc-filter-tick"></span>
      <span class="inc-filter-label">${esc(t.charAt(0) + t.slice(1).toLowerCase())}</span>
      <span class="inc-filter-count" data-count-tipo="${t}">0</span>
    </label>
  `).join('');
}

function _renderLayout() {
  return `
    <div class="inc-module" data-theme="light" data-density="regular">
      <aside class="inc-filter-rail">
        <div class="inc-rail-head">
          <h2>Incidencias</h2>
          <button class="inc-btn-new" id="incBtnNew" title="Nueva incidencia (N)">
            <span class="material-icons" style="font-size:14px;">add</span> Nueva
          </button>
        </div>

        <section class="inc-rail-section">
          <h3>Prioridad</h3>
          ${_renderPriorityChecks()}
        </section>

        <section class="inc-rail-section">
          <h3>Estado</h3>
          ${_renderStatusChecks()}
        </section>

        <section class="inc-rail-section">
          <h3>Tipo</h3>
          ${_renderTipoChecks()}
        </section>
      </aside>

      <div class="inc-canvas">
        <div class="inc-toolbar">
          <div class="inc-tabs">
            <button class="inc-tab is-active" data-tab="todas">Todas <span class="inc-tab-count" id="tabCount_todas">0</span></button>
            <button class="inc-tab" data-tab="mias">Mis incidencias <span class="inc-tab-count" id="tabCount_mias">0</span></button>
            <button class="inc-tab" data-tab="sin_asignar">Sin asignar <span class="inc-tab-count" id="tabCount_sin_asignar">0</span></button>
          </div>
          <div class="inc-toolbar-right">
            <span class="inc-results-count" id="incResultsCount">0 resultados</span>
            <select class="inc-sort" id="incSort">
              <option value="recent">Más recientes</option>
              <option value="priority">Prioridad</option>
            </select>
            <div class="inc-view-toggle">
              <button class="inc-view-btn is-active" data-view="list" title="Lista"><span class="material-icons">view_list</span></button>
              <button class="inc-view-btn" data-view="table" title="Tabla"><span class="material-icons">table_rows</span></button>
              <button class="inc-view-btn" data-view="board" title="Tablero"><span class="material-icons">view_kanban</span></button>
            </div>
            <button class="inc-refresh-btn" id="incRefreshBtn" title="Actualizar"><span class="material-icons">refresh</span></button>
          </div>
        </div>

        <div class="inc-view-container" id="incViewContainer"></div>
      </div>

      <div class="inc-detail-panel" id="incDetailPanel"></div>

      <!-- Dialog Nueva nota -->
      <div class="inc-dialog-backdrop" id="incCreateBackdrop">
        <div class="inc-dialog" role="dialog" aria-modal="true" aria-labelledby="incCreateTitle">
          <div class="inc-dialog-head">
            <div class="inc-dialog-head-icon"><span class="material-icons">add_task</span></div>
            <div class="inc-dialog-head-text">
              <div class="inc-dialog-title" id="incCreateTitle">Nueva incidencia</div>
              <div class="inc-dialog-sub">Registra una nota operativa con prioridad, tipo y evidencias.</div>
            </div>
            <button class="inc-dialog-close" id="incCreateClose" title="Cerrar"><span class="material-icons">close</span></button>
          </div>
          <div class="inc-dialog-body">
            <div class="inc-grid-2">
              <div class="inc-field">
                <label class="inc-field-label">Reportado por</label>
                <input type="text" id="autorNuevaNota" class="inc-input" disabled>
              </div>
              <div class="inc-field">
                <label class="inc-field-label">Prioridad</label>
                <select id="nuevaNotaPrioridad" class="inc-select">
                  <option value="BAJA">Baja</option>
                  <option value="MEDIA">Media</option>
                  <option value="ALTA" selected>Alta</option>
                  <option value="CRITICA">Crítica</option>
                </select>
              </div>
            </div>
            <div class="inc-grid-2">
              <div class="inc-field">
                <label class="inc-field-label">Tipo</label>
                <select id="nuevaNotaTipo" class="inc-select">
                  <option value="MECANICA">Mecánica</option>
                  <option value="ACCIDENTE">Accidente</option>
                  <option value="LIMPIEZA">Limpieza</option>
                  <option value="DOCUMENTOS">Documentos</option>
                  <option value="OTRO" selected>Otro</option>
                </select>
              </div>
              <div class="inc-field">
                <label class="inc-field-label">MVA / Unidad</label>
                <input type="text" id="incMvaInput" class="inc-input" placeholder="Ej: MVA-1234">
              </div>
            </div>
            <div class="inc-field">
              <label class="inc-field-label">Título</label>
              <input type="text" id="nuevaNotaTitulo" class="inc-input" placeholder="Ej: Disrupción operativa en unidad">
            </div>
            <div class="inc-field">
              <label class="inc-field-label">Descripción</label>
              <div class="inc-editor-shell">
                <div class="inc-editor-toolbar" aria-label="Formato de nota">
                  <button type="button" class="inc-editor-btn" data-inc-editor-cmd="bold" title="Negritas"><span class="material-icons">format_bold</span></button>
                  <button type="button" class="inc-editor-btn" data-inc-editor-cmd="italic" title="Cursiva"><span class="material-icons">format_italic</span></button>
                  <button type="button" class="inc-editor-btn" data-inc-editor-cmd="underline" title="Subrayado"><span class="material-icons">format_underlined</span></button>
                  <span class="inc-toolbar-divider"></span>
                  <button type="button" class="inc-editor-btn" data-inc-editor-cmd="ul" title="Lista"><span class="material-icons">format_list_bulleted</span></button>
                  <button type="button" class="inc-editor-btn" data-inc-editor-cmd="ol" title="Lista numerada"><span class="material-icons">format_list_numbered</span></button>
                  <button type="button" class="inc-editor-btn" data-inc-editor-cmd="link" title="Enlace"><span class="material-icons">link</span></button>
                  <span class="inc-toolbar-divider"></span>
                  <select id="incEditorFontSize" class="inc-editor-select" title="Tamaño">
                    <option value="2">Chico</option>
                    <option value="3" selected>Normal</option>
                    <option value="4">Grande</option>
                    <option value="5">Título</option>
                  </select>
                  <select id="incEditorFontFamily" class="inc-editor-select" title="Fuente">
                    <option value="Inter" selected>Inter</option>
                    <option value="Arial">Arial</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Courier New">Mono</option>
                  </select>
                  <button type="button" class="inc-editor-btn inc-editor-btn--danger" data-inc-editor-cmd="clear" title="Limpiar formato"><span class="material-icons">format_clear</span></button>
                </div>
                <div id="nuevaNotaRich" class="inc-rich-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Describe causas, impacto y contexto operativo"></div>
                <textarea id="nuevaNotaTxt" class="inc-editor-textarea--hidden" tabindex="-1" aria-hidden="true"></textarea>
              </div>
            </div>
            <div class="inc-field">
              <label class="inc-field-label">Adjuntar evidencias</label>
              <label class="inc-btn-ghost" style="align-self:flex-start;cursor:pointer;">
                <span class="material-icons">cloud_upload</span> Seleccionar archivos…
                <input type="file" id="incAdjuntosInput" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="display:none;">
              </label>
              <div id="incAdjuntosNuevosCont"></div>
            </div>
            <div class="inc-field">
              <label class="inc-field-label">Agregar link de evidencia</label>
              <div class="inc-link-input-row">
                <input type="url" id="incLinkInput" class="inc-input" placeholder="https://drive.google.com/...">
                <button type="button" id="incAddLinkBtn" class="inc-btn-ghost"><span class="material-icons">add_link</span>Agregar</button>
              </div>
              <div id="incLinksNuevosCont" class="inc-link-chip-list"></div>
            </div>
          </div>
          <div class="inc-dialog-foot">
            <button type="button" id="incCreateCancel" class="inc-btn-ghost">Cancelar</button>
            <button type="button" id="btnPublicarInc" class="inc-btn-primary"><span class="material-icons">send</span>Publicar nota</button>
          </div>
        </div>
      </div>

      <!-- Modal resolver -->
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
