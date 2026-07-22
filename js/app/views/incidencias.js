// ═══════════════════════════════════════════════════════════
//  /js/app/views/incidencias.js
//  Paso 1 — Migración visual al design system de /INCIDENCIAS/
//  Mantiene toda la lógica Firestore (notas_admin), App Shell,
//  filtros, CRUD y caché. Reescribe HTML/UI a la nueva estructura.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { subscribeIncidencias, createIncidencia, resolveIncidencia, deleteIncidencia, updateIncidenciaField, toggleSeguidor } from '/js/app/features/incidencias/incidencias-data.js';

const LIST_ROUTE = '/app/notas';
const NEW_ROUTE = '/app/notas/nuevo';
const VIEW_PREFIX = '/app/notas/v/';

function _canCreateNota() {
  return window.mexPerms?.canDo?.('create_incidencia') !== false;
}
function _canEditNota() {
  return window.mexPerms?.canDo?.('edit_incidencia') !== false;
}
function _canDeleteNota() {
  return window.mexPerms?.canDo?.('delete_incidencia') === true;
}
function _canViewNotas() {
  return window.mexPerms?.canDo?.('view_incidencias') !== false;
}

let _container = null;
let _navigate = null;
let _state = null;
let _unsubIncidencias = null;
let _unsubPlaza = null;
let _offGlobalSearch = null;
let _cssInjected = false;
let _renderFrame = 0;

const _nameCache = new Map();
const _namePending = new Set();

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
const TIPOS_KNOWN = ['MECANICA', 'ACCIDENTE', 'LIMPIEZA', 'DOCUMENTOS', 'ADJUNTO', 'OTRO'];

function _makeState(plaza) {
  const url = new URL(window.location.href);
  const mvaFromQuery = String(url.searchParams.get('mva') || '').trim().toUpperCase();
  const queryFromUrl = String(url.searchParams.get('q') || '').trim();
  const priorityFilter = { CRITICA: true, ALTA: true, MEDIA: true, BAJA: true };
  const statusFilter = { PENDIENTE: true, EN_PROCESO: true, RESUELTA: true, CERRADA: true, ADJUNTO: true };
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
    activeTab: 'todas', // 'todas' | 'mias' | 'sigo'
    sortBy: 'recent', // 'recent' | 'priority'
    viewMode: 'list',
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
    detailMode: 'list', // list | new | detail
    // Live state para create dialog
    createDraft: {
      titulo: '',
      descripcion: '',
      prioridad: 'ALTA',
      tipo: 'OTRO',
      mva: ''
    },
    toastTimer: null,
  };
}

function _viewRoute(id) {
  return `${VIEW_PREFIX}${encodeURIComponent(String(id || ''))}`;
}

function _parseNotasPath() {
  const raw = String(window.location.pathname || '');
  const parts = raw.replace(/\/+$/, '').split('/').filter(Boolean);
  const idx = Math.max(parts.indexOf('notas'), parts.indexOf('incidencias'));
  const seg = idx >= 0 ? parts[idx + 1] || '' : '';
  const seg2 = idx >= 0 ? parts[idx + 2] || '' : '';
  if (seg === 'nuevo') return { mode: 'new', id: '' };
  if (seg === 'v' && seg2) return { mode: 'detail', id: decodeURIComponent(seg2) };
  return { mode: 'list', id: '' };
}

function _applyRouteMode() {
  if (!_state) return;
  const parsed = _parseNotasPath();
  _state.detailMode = parsed.mode;
  _state.detailOpenId = parsed.mode === 'detail' ? parsed.id : '';
}

function _go(path, opts = {}) {
  if (typeof _navigate === 'function') {
    _navigate(path, opts);
    return;
  }
  if (opts.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  _applyRouteMode();
  if (_container) {
    _container.innerHTML = _renderLayout();
    _bindUi();
    _render();
  }
}

// ────────────────────────────────────────────────────────────
// MOUNT / UNMOUNT
// ────────────────────────────────────────────────────────────
export async function mount(ctx) {
  _cleanup();
  _container = ctx.container;
  _navigate = ctx.navigate || null;
  _ensureCss();
  _state = _makeState(String(getCurrentPlaza() || ctx?.state?.currentPlaza || '').toUpperCase().trim());
  _applyRouteMode();
  if (_state.detailMode === 'new' && !_canCreateNota()) {
    _go(LIST_ROUTE, { replace: true });
    return;
  }
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
  _navigate = null;
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
    if (!(route.startsWith('/app/notas') || route.startsWith('/app/incidencias') || route === '/incidencias')) return;
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
      _state.errorMessage = err?.message || 'Error al cargar notas.';
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

  // Botones "Nueva nota"
  q('incBtnNew')?.addEventListener('click', () => _go(NEW_ROUTE));
  q('incBtnNewRail')?.addEventListener('click', () => _go(NEW_ROUTE));

  // Create · cerrar / volver a lista
  q('incCreateClose')?.addEventListener('click', () => _go(LIST_ROUTE));
  q('incCreateCancel')?.addEventListener('click', () => _go(LIST_ROUTE));
  q('incCreateBackdrop')?.addEventListener('click', event => {
    if (event.target === event.currentTarget && _state?.detailMode !== 'new') _go(LIST_ROUTE);
  });
  q('incBackList')?.addEventListener('click', () => _go(LIST_ROUTE));
  q('incDetailClose')?.addEventListener('click', () => _go(LIST_ROUTE));

  q('incListSearch')?.addEventListener('input', (e) => {
    _state.query = String(e.target.value || '').trim().toLowerCase();
    _applyFilters();
    _render();
  });

  if (_state?.detailMode === 'new') {
    _applyDraftMeta();
    const sub = q('incCreateSub');
    if (sub) sub.textContent = `Se publicará en la bitácora · ${_state?.plaza || 'GLOBAL'}`;
    _renderCreatePreview();
    _updateCreateSubmitState();
    setTimeout(() => q('nuevaNotaTitulo')?.focus(), 50);
  }

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
  q('nuevaNotaChip')?.addEventListener('input', _onDraftChange);
  const mvaInput = q('incMvaInput');
  if (mvaInput) {
    mvaInput.addEventListener('input', () => { _onDraftChange(); _showMvaSuggestions(mvaInput); });
    mvaInput.addEventListener('blur', () => { setTimeout(() => _hideMvaSuggestions(), 180); });
    mvaInput.setAttribute('autocomplete', 'off');
  }
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

  // Keyboard shortcut N para abrir create
  if (!_bindUi._kbBound) {
    _bindUi._kbBound = true;
    window.addEventListener('keydown', _onGlobalKey);
  }
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
    _go(NEW_ROUTE);
  } else if (e.key === 'Escape') {
    if (_state.detailMode === 'new' || _state.detailMode === 'detail') {
      _go(LIST_ROUTE);
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
  _renderCreatePreview();
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
    _renderCreatePreview();
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
  _renderCreatePreview();
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
    if (tab === 'sigo') {
      const profile = getState()?.profile || null;
      const myUid = String(profile?.uid || profile?.id || window._auth?.currentUser?.uid || '');
      const myEmail = String(profile?.email || window._auth?.currentUser?.email || '').toLowerCase();
      const segs = Array.isArray(item?.seguidores) ? item.seguidores : [];
      const follows = segs.some(s =>
        (myUid && String(s.uid || '') === myUid) ||
        (myEmail && String(s.email || '').toLowerCase() === myEmail)
      );
      if (!follows) return false;
    }

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
  if (_state.detailMode === 'new') {
    _applyDraftMeta();
    _renderCreatePreview();
    _updateCreateSubmitState();
    return;
  }
  if (_state.detailMode === 'detail') {
    _renderDetailPanel();
    return;
  }
  _renderHeader();
  _renderToolbar();
  _renderView(_state.items);
}

function _renderHeader() {
  const sub = q('incModSub');
  if (!sub) return;
  const total = (_state.allItems || []).length;
  const shown = (_state.items || []).length;
  sub.textContent = `Bitácora operativa · ${shown} de ${total} nota${total === 1 ? '' : 's'}`;
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
  const profile = getState()?.profile || null;
  const myUid = String(profile?.uid || window._auth?.currentUser?.uid || '');
  const myEmail = String(profile?.email || window._auth?.currentUser?.email || '').toLowerCase();
  const countSigo = all.filter(it => {
    const segs = Array.isArray(it?.seguidores) ? it.seguidores : [];
    return segs.some(s =>
      (myUid && String(s.uid || '') === myUid) ||
      (myEmail && String(s.email || '').toLowerCase() === myEmail)
    );
  }).length;
  const selCount = (_state.selectedIds || []).length;

  if (selCount > 0) {
    toolbar.className = 'inc-toolbar toolbar-bulk';
    toolbar.innerHTML = `
      <button class="bulk-clear" data-clear-sel title="Limpiar selección"><span class="material-icons" style="font-size:14px">close</span></button>
      <span class="bulk-count"><b>${selCount}</b> seleccionada${selCount === 1 ? '' : 's'}</span>
      <div class="bulk-sep"></div>
      <button class="bulk-act" data-bulk-resolve><span class="material-icons" style="font-size:13px">check</span>Marcar resuelta</button>
      <button class="bulk-act" data-bulk-copy><span class="material-icons" style="font-size:13px">content_copy</span>Copiar CSV</button>
    `;
  } else {
    toolbar.className = 'inc-toolbar';
    toolbar.innerHTML = `
      <div class="inc-tabs">
        <button class="inc-mobile-filter-btn" id="incMobileFilterBtn" title="Filtros">
          <span class="material-icons">filter_list</span> Filtros
        </button>
        <button class="inc-tab ${_state.activeTab === 'todas' ? 'is-active' : ''}" data-tab="todas">Todas <span class="inc-tab-count" id="tabCount_todas">${countTodas}</span></button>
        <button class="inc-tab ${_state.activeTab === 'mias' ? 'is-active' : ''}" data-tab="mias">Mis notas <span class="inc-tab-count" id="tabCount_mias">${countMias}</span></button>
        <button class="inc-tab ${_state.activeTab === 'sigo' ? 'is-active' : ''}" data-tab="sigo">Sigo <span class="inc-tab-count" id="tabCount_sigo">${countSigo}</span></button>
      </div>
      <div class="inc-toolbar-right">
        <span class="inc-results-count" id="incResultsCount">${_state.items.length} resultado${_state.items.length === 1 ? '' : 's'}</span>
        <select class="inc-sort" id="incSort">
          <option value="recent" ${_state.sortBy === 'recent' ? 'selected' : ''}>Más recientes</option>
          <option value="priority" ${_state.sortBy === 'priority' ? 'selected' : ''}>Prioridad</option>
        </select>
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
  q('incSort')?.addEventListener('change', event => {
    _state.sortBy = String(event.target.value || 'recent');
    _applyFilters();
    _render();
  });
  q('incRefreshBtn')?.addEventListener('click', () => {
    if (_state?.plaza) _startListener();
  });

  // Mobile filter drawer
  const mobileFilterBtn = q('incMobileFilterBtn');
  const rail = _container?.querySelector('.rail');
  const railBackdrop = _container?.querySelector('.rail-backdrop');
  if (mobileFilterBtn && rail) {
    const openRail = () => {
      rail.classList.add('is-mobile-open');
      railBackdrop?.classList.add('is-visible');
    };
    const closeRail = () => {
      rail.classList.remove('is-mobile-open');
      railBackdrop?.classList.remove('is-visible');
    };
    mobileFilterBtn.addEventListener('click', openRail);
    railBackdrop?.addEventListener('click', closeRail);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeRail(); });
  }

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
    cont.innerHTML = _empty('Selecciona una plaza para ver notas.', 'place');
    return;
  }
  if (_state.loading) {
    cont.innerHTML = _empty('Cargando registros…', 'loading', true);
    return;
  }
  if (_state.hasPermissionDenied || !_canViewNotas()) {
    cont.innerHTML = _empty('No tienes permisos para ver notas de esta plaza.', 'block');
    return;
  }
  if (_state.errorMessage) {
    cont.innerHTML = `<div class="inc-error">${esc(_state.errorMessage)}</div>` + _empty('Hubo un error al cargar.', 'error');
    return;
  }
  if (!_state.allItems.length) {
    cont.innerHTML = _empty('No hay notas registradas.', 'inbox');
    return;
  }
  if (!items.length) {
    cont.innerHTML = _empty('No hay resultados con los filtros actuales.', 'search');
    return;
  }

  _state.viewMode = 'list';
  cont.innerHTML = _renderTable(items);

  _attachRowHandlers();
}

function _attachRowHandlers() {
  // Click en filas → ruta de detalle
  qsa('[data-open-id]').forEach(el => {
    el.addEventListener('click', event => {
      if (event.target.closest('[data-stop]')) return;
      const id = el.dataset.openId;
      if (id) _go(_viewRoute(id));
    });
    el.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      const id = el.dataset.openId;
      if (id) _go(_viewRoute(id));
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
    const stLabel = _statusLabel(status, item);
    const isAdjunto = status === 'ADJUNTO' || String(item.tipo || '').toUpperCase() === 'ADJUNTO';
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
    const attCount = _evidenceRows(item).length;

    return `
      <div class="inc-row ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''} ${isAdjunto ? 'is-adjunto-row' : ''}" data-open-id="${esc(id)}">
        <div class="row-prio-bar ${isAdjunto ? 'is-adjunto' : `is-${esc(pr)}`}"></div>
        <label class="row-check" data-stop data-row-check="${esc(id)}">
          <input type="checkbox" ${isSelected ? 'checked' : ''}>
          <span class="row-check-box"></span>
        </label>
        <div class="inc-row-id" title="${esc(codigo)}">${esc(codigo)}</div>
        <div class="inc-row-main">
          <div class="inc-row-title-line">
            ${isAdjunto ? '' : `<span class="prio-dot is-${esc(pr)}"></span>`}
            <span class="inc-row-title">${esc(item.titulo || 'Sin título')}</span>
          </div>
          <div class="inc-row-meta">
            <span>${esc(isAdjunto ? 'Adjunto' : tipo)}</span>
            ${mva ? `<span class="sep">·</span><span class="mva">${esc(mva)}</span>` : ''}
            ${isAdjunto && attCount ? `<span class="sep">·</span><span>${attCount} archivo${attCount === 1 ? '' : 's'}</span>` : ''}
            <span class="sep">·</span>
            <span>${esc(fecha)}</span>
          </div>
        </div>
        <div class="row-sla">
          <span class="schedule-chip sla-neutral">—</span>
        </div>
        <div class="row-assignee">
          ${isAdjunto
            ? `<span class="row-unassigned">—</span>`
            : (asignadoRow || author)
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
      <div class="inc-empty-title">No hay notas con estos filtros</div>
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
    const stLabel = _statusLabel(status, item);
    const isActive = _state.detailOpenId === id;
    const tipo = String(item?.tipo || 'OTRO').toUpperCase().trim() || 'OTRO';

    return `
      <tr class="inc-row-clickable ${isActive ? 'is-active' : ''}" data-open-id="${esc(id)}" role="button" tabindex="0">
        <td class="td-id">${esc(codigo)}</td>
        <td>
          <div class="td-title">${esc(item.titulo || 'Sin título')}</div>
          <div class="td-sub">${esc(tipo)}</div>
        </td>
        <td class="td-mono">${esc(item.mva || '—')}</td>
        <td><span class="td-prio"><span class="prio-dot is-${esc(prLower)}"></span>${esc(_priorityLabel(pr))}</span></td>
        <td><span class="status-pill is-${esc(stKey)}"><span class="status-pill-dot"></span>${esc(stLabel)}</span></td>
        <td class="td-mono">${esc(_displayName(item.autor || item.creadoPor || '') || '—')}</td>
        <td class="td-time">${esc(_relativeDate(item.actualizadoEn || item.creadoEn || item.fecha))}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="inc-table-wrap">
      <table class="inc-table">
        <thead>
          <tr>
            <th>Folio</th>
            <th>Título</th>
            <th>MVA</th>
            <th>Prioridad</th>
            <th>Estado</th>
            <th>Autor</th>
            <th>Fecha</th>
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
  const id = item.legacyNotaId || item.id || '';
  if (!id) return;
  _go(_viewRoute(id));
}

function _closeDetail() {
  _go(LIST_ROUTE);
}

function _renderDetailPanel() {
  const panel = q('incDetailPanel');
  if (!panel) return;
  const id = _state.detailOpenId;
  if (!id) {
    panel.className = 'detail detail-empty';
    panel.innerHTML = `
      <div class="de-mark"><span class="material-icons">inbox</span></div>
      <div class="de-title">Selecciona una nota</div>
      <div class="de-sub">Abre una fila de la tabla para ver el detalle.</div>
    `;
    return;
  }
  if (_state.loading && !_state.allItems.length) {
    panel.className = 'detail detail-empty';
    panel.innerHTML = `
      <div class="de-mark"><span class="material-icons spin">sync</span></div>
      <div class="de-title">Cargando…</div>
    `;
    return;
  }
  const item = _state.allItems.find(it => (it.legacyNotaId || it.id) === id);
  if (!item) {
    panel.className = 'detail detail-empty';
    panel.innerHTML = `
      <div class="de-mark"><span class="material-icons">inbox</span></div>
      <div class="de-title">Nota no disponible</div>
      <div class="de-sub">Es posible que haya sido eliminada o ya no esté visible.</div>
      <button type="button" class="btn-ghost" id="incBackListEmpty">Volver a la tabla</button>
    `;
    q('incBackListEmpty')?.addEventListener('click', () => _go(LIST_ROUTE));
    return;
  }

  panel.className = 'detail';

  const codigo = item.codigo || item.legacyNotaId || item.id || '';
  const pr = _priority(item);
  const prLower = pr.toLowerCase();
  const status = _statusFromNota(item);
  const stKey = status.toLowerCase();
  const stLabel = _statusLabel(status, item);
  const isAdjunto = status === 'ADJUNTO' || String(item.tipo || '').toUpperCase() === 'ADJUNTO';
  const open = status === 'PENDIENTE' || status === 'EN_PROCESO';
  const canDelete = _canDelete(item);
  const evidencias = _evidenceRows(item);
  const descripcion = _renderRichText(item.descripcion || 'Sin descripción.', item.descripcionHtml);
  const resolved = status === 'RESUELTA' || status === 'CERRADA';
  const chipLabel = String(item.chipLabel || '').trim() || (isAdjunto ? 'ADJUNTO' : '');
  const asignadoA = item.asignadoA && (item.asignadoA.nombre || item.asignadoA.email)
    ? item.asignadoA : null;

  // Seguidores (real desde Firestore)
  const author = String(item.autor || item.creadoPor || 'Sistema').trim();
  const seguidores = Array.isArray(item.seguidores) ? item.seguidores : [];
  const gsMe = getState();
  const myUid = String(gsMe?.profile?.id || gsMe?.profile?.uid || '');
  const myEmail = String(gsMe?.profile?.email || '').toLowerCase();
  const amFollowing = seguidores.some(s =>
    (myUid && s.uid === myUid) || (myEmail && String(s.email || '').toLowerCase() === myEmail)
  );

  // Related (same tipo, excluir actual, máx 3)
  const tipoCur = String(item?.tipo || 'OTRO').toUpperCase().trim() || 'OTRO';
  const related = (_state.allItems || [])
    .filter(r => (r.legacyNotaId || r.id) !== id && (String(r?.tipo || 'OTRO').toUpperCase().trim() || 'OTRO') === tipoCur)
    .slice(0, 3);

  const adjuntoAttachmentsHtml = evidencias.length || chipLabel
    ? `<div class="dp-adjunto-attachments">
        ${evidencias.map(ev => ev.url
          ? `<a class="dp-adjunto-file" href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer"><span class="material-icons">attach_file</span><span>${esc(ev.label)}</span></a>`
          : `<span class="dp-adjunto-file"><span class="material-icons">attach_file</span><span>${esc(ev.label)}</span></span>`
        ).join('')}
        ${chipLabel ? `<span class="dp-adjunto-chip">${esc(chipLabel.toUpperCase())}</span>` : ''}
      </div>`
    : '';

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
      ${isAdjunto ? '' : `
      <div class="dp-pills">
        <span class="dp-pill"><span class="prio-dot is-${esc(prLower)}"></span>${esc(_priorityLabel(pr))}</span>
        <span class="status-pill is-${esc(stKey)}"><span class="status-pill-dot"></span>${esc(stLabel)}</span>
      </div>`}
    </div>

    <div class="dp-body">
      ${isAdjunto ? `
      <article class="dp-adjunto-card">
        <p class="dp-adjunto-desc">${descripcion}</p>
        <footer class="dp-adjunto-meta">
          <span>${esc(_displayName(item.autor || item.creadoPor || 'Sistema'))}</span>
          <span>${esc(_longDate(item.creadoEn || item.fecha))}</span>
        </footer>
        ${adjuntoAttachmentsHtml}
      </article>
      ` : `
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
      `}

      ${!isAdjunto && resolved ? `
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

      ${isAdjunto ? `
      <section class="dp-grid" style="margin-top:16px">
        <div>
          <div class="dp-section-label">MVA / Activo</div>
          <div class="dp-meta-val">${esc(item.mva || '—')}</div>
        </div>
        <div>
          <div class="dp-section-label">Visibilidad</div>
          <div class="dp-meta-val">${item.plaza && item.plaza !== 'GLOBAL'
            ? `<span class="dp-plaza-badge">${esc(item.plaza)}</span>`
            : `<span class="dp-plaza-badge is-global">GLOBAL</span>`
          }</div>
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
              const rStLabel = _statusLabel(rStatus, r);
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
    </div>

    <div class="dp-foot">
      ${isAdjunto ? `
        <span class="dp-foot-hint">Documento adjunto · no requiere resolución</span>
      ` : open && _canEditNota() ? `
        <button class="dp-btn dp-btn-primary" data-resolve-id="${esc(item.legacyNotaId || item.id)}" data-stop>
          <span class="material-icons" style="font-size:13px">check</span> Marcar resuelta
        </button>
      ` : !isAdjunto && !open && _canEditNota() ? `
        <button class="dp-btn dp-btn-secondary" data-reopen-id="${esc(item.legacyNotaId || item.id)}" data-stop>
          <span class="material-icons" style="font-size:13px">refresh</span> Reabrir nota
        </button>
      ` : ''}
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
  panel.querySelectorAll('[data-reopen-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rid = btn.dataset.reopenId;
      if (!rid) return;
      btn.disabled = true;
      try {
        await updateIncidenciaField(rid, {
          estado: 'PENDIENTE',
          quienResolvio: '',
          resueltaPor: '',
          resueltaEn: '',
          solucion: '',
        });
        _showToast('Reabierta', 'La nota fue marcada como pendiente.', 'ok');
      } catch (err) {
        _showToast('Error', err?.message || 'No se pudo reabrir.', 'error');
      } finally {
        btn.disabled = false;
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
        uid: gs3?.profile?.id || gs3?.profile?.uid || '',
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

}

// ────────────────────────────────────────────────────────────
// CREATE / RESOLVE / DELETE
// ────────────────────────────────────────────────────────────
function _toggleCreateDialog(show) {
  if (show) {
    if (!_canCreateNota()) {
      return _showNotice('No tienes permiso para crear notas.', 'error');
    }
    _go(NEW_ROUTE);
    return;
  }
  _go(LIST_ROUTE);
}

async function _onCreateIncidencia() {
  if (!_state?.plaza) return _showNotice('Selecciona una plaza para registrar notas.', 'error');
  _syncRichEditorToTextarea();
  const titulo = String(q('nuevaNotaTitulo')?.value || '').trim();
  const descripcion = String(q('nuevaNotaTxt')?.value || '').trim();
  const descripcionHtml = _sanitizeRichHtml(_state.descripcionHtmlNuevaNota || '');
  const prioridad = String(q('nuevaNotaPrioridad')?.value || 'MEDIA').toUpperCase();
  const tipo = String(q('nuevaNotaTipo')?.value || 'OTRO').toUpperCase();
  const mva = String(q('incMvaInput')?.value || '').trim().toUpperCase();
  const chipLabel = String(q('nuevaNotaChip')?.value || '').trim().toUpperCase();
  const esAdjunto = tipo === 'ADJUNTO';
  if (!titulo) return _showNotice('Escribe el título de la nota.', 'error');
  if (!descripcion) return _showNotice('Escribe la descripción.', 'error');
  if (esAdjunto && !chipLabel) return _showNotice('Escribe el chip del adjunto (ej. VIGENTE).', 'error');

  const btn = q('btnPublicarInc');
  const gs = getState();
  const autor = gs.profile?.nombreCompleto || gs.profile?.nombre || gs.profile?.displayName || gs.profile?.email || 'Usuario';
  if (btn) btn.disabled = true;
  try {
    const payload = {
      titulo,
      descripcion,
      descripcionHtml,
      notaHtml: descripcionHtml,
      nota: descripcion,
      codigo: `INC-${String(Date.now()).slice(-6)}`,
      prioridad: esAdjunto ? 'BAJA' : prioridad,
      tipo,
      mva,
      plaza: _state.plaza,
      plazaID: _state.plaza,
      autor,
      creadoPor: autor,
      estado: esAdjunto ? 'ADJUNTO' : 'PENDIENTE',
      chipLabel: esAdjunto ? chipLabel : '',
      source: 'notas_admin',
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
    _showToast('Nota publicada', titulo.slice(0, 60), 'ok');
    const createAnother = !!q('incCreateAgain')?.checked;
    _resetComposer();
    if (!createAnother) _go(LIST_ROUTE);
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
  const chip = q('nuevaNotaChip'); if (chip) chip.value = '';
  const chipWrap = q('nuevaNotaChipWrap'); if (chipWrap) chipWrap.hidden = true;
  _syncAdjuntoFormMode(false);
  // Reset segmented prio
  qsa('[data-ci-prio]').forEach(b => b.classList.toggle('is-on', b.dataset.ciPrio === 'ALTA'));
  if (_state.archivosNuevaNota) {
    _state.archivosNuevaNota.forEach(item => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
    _state.archivosNuevaNota = [];
  }
  _state.linksNuevaNota = [];
  _state.createDraft = { titulo: '', descripcion: '', prioridad: 'ALTA', tipo: 'OTRO', mva: '', chipLabel: '' };
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

function _hideMvaSuggestions() {
  const el = q('incMvaSuggestions');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

function _showMvaSuggestions(input) {
  const el = q('incMvaSuggestions');
  if (!el) return;
  const val = String(input.value || '').trim();
  if (!val || val.length < 1 || !window.mexUnidades) { _hideMvaSuggestions(); return; }
  const results = window.mexUnidades.buscar(val, 6);
  if (!results.length) { _hideMvaSuggestions(); return; }
  el.innerHTML = results.map(u => {
    const meta = [u.marca, u.modelo, u.placas].filter(Boolean).join(' · ');
    return `<div class="inc-mva-suggestion" data-mva="${esc(u.mva)}">
      <span class="sug-mva">${esc(u.mva)}</span>
      ${meta ? `<span class="sug-meta">${esc(meta)}</span>` : ''}
    </div>`;
  }).join('');
  el.style.display = 'block';
  el.querySelectorAll('.inc-mva-suggestion').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      input.value = item.dataset.mva;
      _hideMvaSuggestions();
      _onDraftChange();
    });
  });
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
  if (value === 'ADJUNTO' || value === 'DOCUMENTO' || value === 'INFO') return 'ADJUNTO';
  if (String(item?.tipo || '').toUpperCase() === 'ADJUNTO') return 'ADJUNTO';
  return 'PENDIENTE';
}

function _statusLabel(key, item = null) {
  if (key === 'ADJUNTO') {
    const chip = String(item?.chipLabel || '').trim();
    return chip || 'Adjunto';
  }
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
  return _canDeleteNota();
}

function _evidenceRows(item) {
  const list = [];
  const fromArray = value => {
    if (!Array.isArray(value)) return;
    value.forEach(v => list.push(v));
  };
  // Preferir adjuntos (lista canónica); evidencias solo si adjuntos vacío (legacy).
  if (Array.isArray(item?.adjuntos) && item.adjuntos.length) {
    fromArray(item.adjuntos);
  } else {
    fromArray(item?.evidencias);
  }
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
    if (!key || key === '||' || seen.has(key)) return;
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
  _state.createDraft.chipLabel = String(q('nuevaNotaChip')?.value || '').trim();
  const chipWrap = q('nuevaNotaChipWrap');
  if (chipWrap) chipWrap.hidden = _state.createDraft.tipo !== 'ADJUNTO';
  _syncAdjuntoFormMode(_state.createDraft.tipo === 'ADJUNTO');
  // Hint counter
  const titleHint = q('incCreateTitleHint');
  if (titleHint) {
    const n = _state.createDraft.titulo.length;
    titleHint.textContent = `Sé específico: incluye activo y síntoma. ${n}/120`;
  }
  _renderCreatePreview();
  _updateCreateSubmitState();
}

function _syncAdjuntoFormMode(isAdjunto) {
  const prioWrap = q('nuevaNotaPrioridadWrap');
  if (prioWrap) prioWrap.hidden = !!isAdjunto;
}

function _renderCreatePreview() {
  const card = q('incCreatePreviewCard');
  if (!card) return;
  const d = _state?.createDraft || { titulo: '', descripcion: '', prioridad: 'ALTA', tipo: 'OTRO', mva: '', chipLabel: '' };
  const tipo = String(d.tipo || 'OTRO').toUpperCase();
  const isAdjunto = tipo === 'ADJUNTO';
  const gs = getState();
  const me = gs?.profile?.nombreCompleto || gs?.profile?.nombre || gs?.profile?.email || 'Sistema';
  const meInitials = _initialsFrom(me);
  const files = Array.isArray(_state?.archivosNuevaNota) ? _state.archivosNuevaNota : [];
  const links = Array.isArray(_state?.linksNuevaNota) ? _state.linksNuevaNota : [];

  if (isAdjunto) {
    const chip = String(d.chipLabel || 'ADJUNTO').trim().toUpperCase() || 'ADJUNTO';
    const attachRows = [
      ...files.map(item => {
        const name = esc(item.file?.name || 'Adjunto');
        return `<span class="ci-prev-att-file"><span class="material-icons">attach_file</span>${name}</span>`;
      }),
      ...links.map(item => {
        const label = esc(item.label || item.url || 'Enlace');
        return `<span class="ci-prev-att-file"><span class="material-icons">link</span>${label}</span>`;
      })
    ].join('');
    card.className = 'ci-prev-card ci-prev-card--adjunto';
    card.innerHTML = `
      <header class="ci-prev-adj-head">
        <strong class="ci-prev-adj-title">${d.titulo ? esc(d.titulo) : '<span class="ci-prev-empty">Título del documento</span>'}</strong>
      </header>
      <p class="ci-prev-adj-body">${d.descripcion ? esc(d.descripcion) : '<span class="ci-prev-empty">La descripción aparecerá aquí…</span>'}</p>
      <footer class="ci-prev-adj-meta">
        <span>${esc(me)}</span>
        <span>justo ahora</span>
      </footer>
      <div class="ci-prev-adj-attachments">
        ${attachRows || '<span class="ci-prev-empty">Sin archivo seleccionado</span>'}
        <span class="ci-prev-adj-chip">${esc(chip)}</span>
      </div>
      ${d.mva ? `<div class="ci-prev-adj-mva">${esc(d.mva)}</div>` : ''}
    `;
    return;
  }

  const prLower = String(d.prioridad).toLowerCase();
  card.className = 'ci-prev-card';
  card.innerHTML = `
    <div class="ci-prev-bar is-${esc(prLower)}"></div>
    <div class="ci-prev-top">
      <span class="ci-prev-id">INC-NUEVA</span>
      <span class="ci-prev-dot">·</span>
      <span>${esc(_state?.plaza || 'GLOBAL')}</span>
      <span class="ci-prev-dot">·</span>
      <span>justo ahora</span>
    </div>
    <h2 class="ci-prev-title">${d.titulo ? esc(d.titulo) : '<span class="ci-prev-empty">Título de la nota</span>'}</h2>
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

// Limpia un valor que puede ser email/nombre para mostrar solo el nombre.
// Para emails: primero busca en caché de usuarios; si no hay, muestra local part
// y lanza un lookup async que re-renderiza cuando resuelve.
function _displayName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  if (!raw.includes('@')) return raw;

  const emailLower = raw.toLowerCase();

  // Coincide con el usuario actual → usar nombre real
  const meProfile = getState()?.profile;
  if (meProfile && String(meProfile.email || '').toLowerCase() === emailLower) {
    const realName = String(meProfile.nombreCompleto || meProfile.nombre || meProfile.displayName || '').trim();
    if (realName) return realName;
  }

  // Caché de usuarios ya resueltos
  if (_nameCache.has(emailLower)) return _nameCache.get(emailLower);

  // Programar lookup asíncrono
  _scheduleNameLookup(emailLower);

  // Fallback mientras llega la respuesta
  const local = raw.split('@')[0];
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() || raw;
}

function _scheduleNameLookup(emailLower) {
  if (_namePending.has(emailLower)) return;
  _namePending.add(emailLower);
  import('/js/core/database.js').then(({ db, COL }) => {
    const docId = emailLower;
    return db.collection(COL.USERS).doc(docId).get()
      .then(snap => {
        if (snap.exists) {
          const d = snap.data();
          const name = String(d.nombreCompleto || d.nombre || d.displayName || '').trim();
          if (name) {
            _nameCache.set(emailLower, name);
            // Trigger re-render si el panel sigue abierto
            if (_state) _render();
          }
        }
      });
  }).catch(() => {}).finally(() => { _namePending.delete(emailLower); });
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
    { key: 'ADJUNTO',    label: 'Adjunto',    cls: 'is-adjunto' },
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
  const labels = {
    MECANICA: 'Mecánica',
    ACCIDENTE: 'Accidente',
    LIMPIEZA: 'Limpieza',
    DOCUMENTOS: 'Documentos',
    ADJUNTO: 'Adjunto',
    OTRO: 'Otro'
  };
  return TIPOS_KNOWN.map(t => `
    <label class="rail-check is-on" data-tipo="${t}">
      <input type="checkbox" checked>
      <span class="rail-tick"></span>
      <span class="rail-label">${esc(labels[t] || t)}</span>
      <span class="rail-num" data-count-tipo="${t}">0</span>
    </label>
  `).join('');
}

function _renderLayout() {
  const mode = _state?.detailMode || 'list';
  const modeClass = mode === 'new' ? 'inc-module--create' : mode === 'detail' ? 'inc-module--detail' : 'inc-module--table';
  return `
    <div class="inc-module ${modeClass}" data-theme="${document.body.classList.contains('dark-theme') ? 'dark' : 'light'}" data-density="regular">
      <header class="mod-head">
        <div class="mod-head-left">
          <h1 class="mod-title">Notas</h1>
          <p class="mod-sub" id="incModSub">Bitácora operativa</p>
        </div>
        <div class="mod-actions">
          ${_canCreateNota() ? `<button class="btn-primary" id="incBtnNew" title="Nueva nota (N)">
            <span class="material-icons">add</span> Nueva nota
          </button>` : ''}
        </div>
      </header>

      <div class="inc-editor-top">
        <div>
          <nav class="inc-breadcrumb" aria-label="Ruta">
            <button type="button" id="incBackList">Notas</button>
            <span>/</span>
            <strong>${mode === 'new' ? 'Nueva' : 'Detalle'}</strong>
          </nav>
          <h1>${mode === 'new' ? 'Nueva nota' : 'Detalle de la nota'}</h1>
        </div>
      </div>

      <div class="metrics" id="incMetrics" hidden></div>

      <div class="workspace">
        <aside class="rail" hidden>
          ${_canCreateNota() ? `<button class="rail-new" id="incBtnNewRail" title="Nueva nota (N)">
            <span class="material-icons" style="font-size:14px;">add</span>
            Nueva nota
            <span class="rail-new-kbd">N</span>
          </button>` : ''}

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

        </aside>

        <main class="inc-canvas">
          <div class="inc-controls">
            <label class="inc-search">
              <input id="incListSearch" type="search" placeholder="Buscar folio, título, MVA o autor" value="${esc(_state?.query || '')}">
            </label>
            <div class="inc-toolbar" id="incToolbar"></div>
          </div>
          <div class="inc-view-container" id="incViewContainer"></div>
        </main>

        <aside class="detail" id="incDetailPanel"></aside>
      </div>

      <!-- Dialog Nueva nota (split form + live preview) -->
      <div class="ci-backdrop${mode === 'new' ? ' is-open' : ''}" id="incCreateBackdrop">
        <div class="ci-sheet" role="dialog" aria-modal="true" aria-labelledby="incCreateTitle">
          <header class="ci-head">
            <div class="ci-head-left">
              <div class="ci-head-icon"><span class="material-icons">add</span></div>
              <div>
                <div class="ci-head-title" id="incCreateTitle">Nueva nota</div>
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
                <div class="ci-field" id="nuevaNotaPrioridadWrap">
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
                    <option value="ADJUNTO">Adjunto / documento</option>
                    <option value="OTRO" selected>Otro</option>
                  </select>
                </div>

                <div class="ci-field" id="nuevaNotaChipWrap" hidden>
                  <label class="ci-label">Chip personalizado</label>
                  <input type="text" id="nuevaNotaChip" class="ci-input" placeholder="Ej. VIGENTE, ORIGINAL, COPIA…" maxlength="24">
                  <p class="ci-hint" style="margin:6px 0 0;font-size:12px;color:var(--fg-muted)">Se muestra al lado del documento adjunto</p>
                </div>

                <div class="ci-field">
                  <label class="ci-label">MVA / Activo</label>
                  <input type="text" id="incMvaInput" class="ci-input ci-input-mono" placeholder="MVA-2241">
                  <div id="incMvaSuggestions" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:200;background:#fff;border:1.5px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.1);max-height:200px;overflow-y:auto;margin-top:2px;"></div>
                </div>

                <div class="ci-field">
                  <label class="ci-label">Reportado por</label>
                  <input type="text" id="autorNuevaNota" class="ci-input" disabled>
                </div>
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
