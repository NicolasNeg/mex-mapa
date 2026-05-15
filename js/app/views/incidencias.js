// ═══════════════════════════════════════════════════════════
//  /js/app/views/incidencias.js
//  Fase 8B — vista real /app/incidencias con plaza global.
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

function _trackListener(action, name, extra = {}) {
  if (typeof window.__mexTrackListener !== 'function') return;
  window.__mexTrackListener(window.location.pathname, `app/incidencias:${name}`, action, extra);
}

function _makeState(plaza) {
  const url = new URL(window.location.href);
  const mvaFromQuery = String(url.searchParams.get('mva') || '').trim().toUpperCase();
  const queryFromUrl = String(url.searchParams.get('q') || '').trim();
  return {
    plaza,
    allItems: [],
    items: [],
    tab: 'viewTab',
    query: (queryFromUrl || mvaFromQuery).toLowerCase(),
    statusFilter: 'TODAS',
    priorityFilter: { CRITICA: true, ALTA: true, MEDIA: true, BAJA: true },
    selectedId: '',
    mvaFromQuery,
    loading: true,
    errorMessage: '',
    hasPermissionDenied: false,
    archivosNuevaNota: [], // para guardar los adjuntos temporales
    linksNuevaNota: [],
    descripcionHtmlNuevaNota: '',
  };
}

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
  _state.errorMessage = '';
  _state.hasPermissionDenied = false;
  _state.loading = !plaza;
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

function _bindUi() {
  qsa('[data-inc-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.tab = btn.dataset.incTab;
      _render();
    });
  });

  q('filtroEstado')?.addEventListener('change', event => {
    _state.statusFilter = String(event.target.value || 'TODAS').toUpperCase();
    _applyFilters();
    _render();
  });

  ['Critica', 'Alta', 'Media', 'Baja'].forEach(name => {
    q(`incFilter${name}`)?.addEventListener('change', () => {
      _state.priorityFilter[name.toUpperCase()] = !!q(`incFilter${name}`)?.checked;
      _applyFilters();
      _render();
    });
  });

  q('incRefreshBtn')?.addEventListener('click', () => {
    if (_state?.plaza) _startListener();
  });

  q('incGoToAdd')?.addEventListener('click', () => {
    _state.tab = 'addTab';
    _render();
  });

  q('btnPublicarInc')?.addEventListener('click', _onCreateIncidencia);
  q('incDiscardBtn')?.addEventListener('click', _resetComposer);

  q('nuevaNotaPrioridad')?.addEventListener('change', _updatePreview);
  q('nuevaNotaTitulo')?.addEventListener('input', _updatePreview);
  q('nuevaNotaTxt')?.addEventListener('input', _updatePreview);
  q('nuevaNotaRich')?.addEventListener('input', () => {
    _syncRichEditorToTextarea();
    _updatePreview();
  });
  q('incEditorFontSize')?.addEventListener('change', event => _applyRichCommand('fontSize', event.target.value || '3'));
  q('incEditorFontFamily')?.addEventListener('change', event => _applyRichCommand('fontName', event.target.value || 'Inter'));
  qsa('[data-inc-editor-cmd]').forEach(btn => {
    btn.addEventListener('click', () => _applyRichCommand(btn.dataset.incEditorCmd || ''));
  });
  q('incMvaInput')?.addEventListener('input', _updatePreview);
  q('incLinkInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      _addDraftLink();
    }
  });
  q('incAddLinkBtn')?.addEventListener('click', _addDraftLink);

  q('incResolverCancelar')?.addEventListener('click', () => _toggleResolverModal(false));
  q('btnConfirmarResInc')?.addEventListener('click', _confirmResolve);

  q('incAdjuntosInput')?.addEventListener('change', _onFilesSelected);
}

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

function _applyRichCommand(cmd, value = null) {
  const editor = _editorEl();
  if (!editor) return;
  editor.focus();
  let exec = cmd;
  let val = value;
  if (cmd === 'link') {
    const url = _normalizeDraftUrl(prompt('Enlace para insertar:', 'https://') || '');
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
  _updatePreview();
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
  _updatePreview();
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
  _updatePreview();
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
  _updatePreview();
}

function _eliminarArchivoNuevos(index) {
  const item = _state.archivosNuevaNota[index];
  if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  _state.archivosNuevaNota.splice(index, 1);
  _renderAdjuntosNuevos();
}

function _renderAdjuntosNuevos() {
  const cont = q('incAdjuntosNuevosCont');
  if (!cont) return;
  if (!_state.archivosNuevaNota.length) {
    cont.innerHTML = '';
    return;
  }
  cont.innerHTML = _state.archivosNuevaNota.map((item, i) => `
    <div class="inc-upload-chip" style="display:flex;align-items:center;background:#f1f5f9;border-radius:6px;padding:6px;margin-top:6px;">
      ${item.previewUrl ? `<img src="${item.previewUrl}" style="width:24px;height:24px;border-radius:4px;object-fit:cover;margin-right:8px;">` : `<span class="material-icons" style="margin-right:8px;font-size:20px;color:#64748b;">insert_drive_file</span>`}
      <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#334155;">${esc(item.file.name)}</div>
      <button type="button" style="background:transparent;border:none;color:#ef4444;cursor:pointer;display:flex;" onclick="window._incEliminarArchivoNuevos(${i})"><span class="material-icons" style="font-size:16px;">close</span></button>
    </div>
  `).join('');
}
window._incEliminarArchivoNuevos = _eliminarArchivoNuevos;

function _applyFilters() {
  const query = _state.query;
  _state.items = (_state.allItems || []).filter(item => {
    const p = _priority(item);
    if (!_state.priorityFilter[p]) return false;
    const status = _statusFromNota(item);
    if (_state.statusFilter !== 'TODAS' && status !== _state.statusFilter) return false;
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
  }).sort((a, b) => _dateMs(b.creadoEn || b.fecha) - _dateMs(a.creadoEn || a.fecha));
}

function _render() {
  if (_renderFrame) return;
  _renderFrame = window.requestAnimationFrame(() => {
    _renderFrame = 0;
    _renderNow();
  });
}

function _renderNow() {
  if (!_state) return;
  _setText('incPlazaBadge', _state.plaza || '—');
  _setText('incMetaUbicacion', _state.plaza || 'GLOBAL');
  _setText('incGlobalSearchHint', _state.query ? `Filtro global activo: "${_state.query}"` : 'Búsqueda principal desde header App Shell');
  _renderStats();
  _renderTabs();
  _renderList();
  _renderPreview();
}

function _renderPreview() {
  if (!_state) return;
  _updatePreview();
  const stamp = q('incPreviewStamp');
  if (!stamp) return;
  
  if (_state.archivosNuevaNota.length) {
    const total = _state.archivosNuevaNota.length + (_state.linksNuevaNota?.length || 0);
    stamp.textContent = `${total} evidencia${total === 1 ? '' : 's'}`;
  } else if (_state.linksNuevaNota?.length) {
    stamp.textContent = `${_state.linksNuevaNota.length} link${_state.linksNuevaNota.length === 1 ? '' : 's'}`;
  } else {
    stamp.textContent = 'Sin adjuntos';
  }
}

function _renderStats() {
  const total = _state.allItems.length;
  const pend = _state.allItems.filter(i => _statusFromNota(i) === 'PENDIENTE').length;
  const crit = _state.allItems.filter(i => _priority(i) === 'CRITICA' && _statusFromNota(i) === 'PENDIENTE').length;
  const res = _state.allItems.filter(i => _statusFromNota(i) === 'RESUELTA').length;
  const adj = _state.allItems.reduce((acc, it) => acc + _evidenceRows(it).length, 0);
  _setText('incStatTotal', total);
  _setText('incStatPendientes', pend);
  _setText('incStatCriticas', crit);
  _setText('incCountPendientes', pend);
  _setText('incCountResueltas', res);
  _setText('incCountAdjuntos', adj);
}

function _renderTabs() {
  qsa('[data-inc-tab]').forEach(tab => tab.classList.toggle('active', tab.dataset.incTab === _state.tab));
  qsa('.inc-content').forEach(p => p.classList.toggle('active', p.id === _state.tab));
}

function _renderList() {
  const list = q('listaNotas');
  if (!list) return;

  if (!_state.plaza) {
    list.innerHTML = _empty('Selecciona una plaza para ver notas e incidencias.');
    return;
  }
  if (_state.loading) {
    list.innerHTML = _empty('Cargando registros...', true);
    return;
  }
  if (_state.hasPermissionDenied) {
    list.innerHTML = _empty('No tienes permisos para ver notas e incidencias de esta plaza.');
    return;
  }
  if (_state.errorMessage) {
    list.innerHTML = _empty(_state.errorMessage);
    return;
  }
  if (!_state.allItems.length) {
    list.innerHTML = _empty('No hay notas e incidencias registradas.');
    return;
  }
  if (!_state.items.length) {
    list.innerHTML = _empty('No se encontraron notas e incidencias con los filtros actuales.');
    return;
  }

  list.innerHTML = _state.items.map(item => {
    const pr = _priorityMeta(item);
    const st = _stateMeta(item);
    const open = _statusFromNota(item) === 'PENDIENTE';
    const evidencias = _evidenceRows(item);
    const codigo = item.codigo || item.legacyNotaId || item.id || '';
    const canDelete = _canDelete(item);
    return `
      <article class="nota-card" data-prioridad="${esc(pr.key)}">
        <div class="nota-top">
          <div class="nota-main">
            <div class="nota-icon"><span class="material-icons">${esc(pr.icon)}</span></div>
            <div class="nota-main-copy">
              <div class="nota-title-row">
                <h4 class="nota-title">${esc(item.titulo || 'Nota sin titulo')}</h4>
                <div class="nota-badges">
                  <span class="nota-priority-badge ${esc(pr.className)}">${esc(pr.label)}</span>
                  <span class="nota-state-badge ${esc(st.className)}">${esc(st.label)}</span>
                </div>
              </div>
              <div class="nota-meta">
                <strong>${esc(item.autor || item.creadoPor || 'Sistema')}</strong>
                <span class="nota-meta-separator"></span>
                <span>${esc(_longDate(item.creadoEn || item.fecha))}</span>
                <span class="nota-meta-separator"></span>
                <span>${esc(item.mva || codigo || 'SIN MVA')}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="nota-body">${_renderRichText(item.descripcion || 'Sin descripción', item.descripcionHtml)}</div>
        ${_renderEvidenceBlock(evidencias)}
        <div class="nota-footer">
          <div class="nota-footer-left">
            <span class="nota-chip">${esc(codigo || item.plaza || _state.plaza || '—')}</span>
            <span class="nota-chip">${esc(pr.label)}</span>
            ${evidencias.length ? `<span class="nota-chip">${evidencias.length} adjunto${evidencias.length === 1 ? '' : 's'}</span>` : ''}
          </div>
          ${canDelete ? `<button class="btn-res-inc" style="background:transparent;color:#ef4444;border-color:transparent;padding:0;" data-delete-id="${esc(item.legacyNotaId || item.id)}" title="Eliminar registro"><span class="material-icons" style="font-size:18px;">delete</span></button>` : ''}
        </div>
        ${open
          ? `<button class="btn-res-inc" data-resolve-id="${esc(item.legacyNotaId || item.id)}">Marcar como resuelta</button>`
          : `<div class="nota-resolution">
              <div class="nota-resolution-head">
                <span>Resuelta por ${esc(item.resueltoPor || 'Sistema')}</span>
                <span>${esc(_longDate(item.resueltoEn || item.fecha))}</span>
              </div>
              <div class="nota-resolution-body">${esc(item.solucion || 'Sin detalle de solucion.').replace(/\n/g, '<br>')}</div>
            </div>`}
      </article>
    `;
  }).join('');

  qsa('[data-resolve-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.selectedId = btn.dataset.resolveId || '';
      _toggleResolverModal(true);
    });
  });

  qsa('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.deleteId;
      if (confirm('¿Estás seguro de eliminar este registro? Esta acción no se puede deshacer.')) {
        _onDeleteIncidencia(id);
      }
    });
  });
}

async function _onDeleteIncidencia(id) {
  try {
    await deleteIncidencia(id);
    _showNotice('Nota eliminada', 'success');
    if (_state?.plaza) _startListener(); // Refresh
  } catch (err) {
    _showNotice('Error al eliminar: ' + (err.message || ''), 'error');
  }
}

function _renderEvidenceBlock(items) {
  if (!items.length) {
    return '<div class="nota-attachments-empty">Sin evidencias adjuntas.</div>';
  }
  return `
    <div class="nota-attachments">
      ${items.map(item => item.url
        ? `<a class="nota-attachment-file" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><span class="material-icons">attach_file</span><span class="nota-attachment-copy"><strong>${esc(item.label)}</strong><span>Abrir evidencia</span></span></a>`
        : `<div class="nota-attachment-file nota-attachment-file--no-url"><span class="material-icons">folder</span><span class="nota-attachment-copy"><strong>${esc(item.label)}</strong><span>Adjunto registrado sin URL directa</span></span></div>`
      ).join('')}
    </div>
  `;
}

function _renderRichText(value = '', html = '') {
  const rich = _sanitizeRichHtml(html || '');
  if (rich) return rich;
  const escaped = esc(value || '');
  return escaped
    .replace(/(https?:\/\/[^\s<]+)/g, url => `<a class="inc-inline-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)
    .replace(/\n/g, '<br>');
}

function _toggleResolverModal(show) {
  q('modalAuthIncidencia')?.classList.toggle('active', !!show);
  if (show) q('authComentario')?.focus();
}

async function _confirmResolve() {
  const id = String(_state?.selectedId || '').trim();
  const comentario = String(q('authComentario')?.value || '').trim();
  if (!id) return _showNotice('No se pudo identificar la nota a resolver.', 'error');
  if (!comentario) return _showNotice('Describe cómo se solucionó.', 'error');
  const btn = q('btnConfirmarResInc');
  const gs = getState();
  const autor = gs.profile?.email || gs.profile?.nombre || 'Usuario';
  btn.disabled = true;
  try {
    await resolveIncidencia(id, comentario, autor);
    _showNotice('Nota resuelta.', 'ok');
    _toggleResolverModal(false);
    q('authComentario').value = '';
  } catch (error) {
    _showNotice(error?.message || 'No se pudo resolver la nota.', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function _onCreateIncidencia() {
  if (!_state?.plaza) return _showNotice('Selecciona una plaza para registrar notas e incidencias.', 'error');
  _syncRichEditorToTextarea();
  const titulo = String(q('nuevaNotaTitulo')?.value || '').trim();
  const descripcion = String(q('nuevaNotaTxt')?.value || '').trim();
  const descripcionHtml = _sanitizeRichHtml(_state.descripcionHtmlNuevaNota || '');
  const prioridad = String(q('nuevaNotaPrioridad')?.value || 'MEDIA').toUpperCase();
  const mva = String(q('incMvaInput')?.value || '').trim().toUpperCase();
  if (!titulo) return _showNotice('Escribe el titulo de la nota.', 'error');
  if (!descripcion) return _showNotice('Escribe la descripción.', 'error');

    const btn = q('btnPublicarInc');
  const gs = getState();
  const autor = gs.profile?.email || gs.profile?.nombre || 'Usuario';
  btn.disabled = true;
  try {
    const payload = {
      titulo,
      descripcion,
      descripcionHtml,
      notaHtml: descripcionHtml,
      nota: descripcion,
      codigo: `INC-${String(Date.now()).slice(-6)}`,
      prioridad,
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
    _state.tab = 'viewTab';
    _render();
  } catch (error) {
    _showNotice(error?.message || 'Error al publicar.', 'error');
  } finally {
    btn.disabled = false;
  }
}

function _resetComposer() {
  q('nuevaNotaTitulo').value = '';
  q('nuevaNotaTxt').value = '';
  if (q('nuevaNotaRich')) q('nuevaNotaRich').innerHTML = '';
  _state.descripcionHtmlNuevaNota = '';
  q('nuevaNotaPrioridad').value = 'ALTA';
  if (_state.archivosNuevaNota) {
    _state.archivosNuevaNota.forEach(item => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    _state.archivosNuevaNota = [];
  }
  _state.linksNuevaNota = [];
  _renderAdjuntosNuevos();
  _renderLinksNuevos();
  _prefillMvaFromQuery();
  _applyDraftMeta();
  _updatePreview();
}

function _prefillMvaFromQuery() {
  const input = q('incMvaInput');
  if (!input) return;
  input.value = _state?.mvaFromQuery || '';
}

function _applyDraftMeta() {
  const gs = getState();
  const autor = gs.profile?.nombreCompleto || gs.profile?.nombre || gs.profile?.email || 'Sistema';
  q('autorNuevaNota').value = autor;
  _setText('incMetaTimestamp', _longDate(new Date()));
  _setText('incMetaId', `INC-${String(Date.now()).slice(-6)}`);
  _updatePreview();
}

function _updatePreview() {
  const prioridad = String(q('nuevaNotaPrioridad')?.value || 'ALTA').toUpperCase();
  const meta = _priorityMeta({ prioridad });
  _setText('incPreviewTitulo', String(q('nuevaNotaTitulo')?.value || '').trim() || 'Nueva nota');
  const previewBody = q('incPreviewBody');
  if (previewBody) {
    _syncRichEditorToTextarea();
    const fallback = 'Documenta el evento con precision tecnica para que el historial operativo conserve contexto e impacto.';
    previewBody.innerHTML = _renderRichText(String(q('nuevaNotaTxt')?.value || '').trim() || fallback, _state.descripcionHtmlNuevaNota);
  }
  _setText('incPreviewAutor', `Emitido por: ${String(q('autorNuevaNota')?.value || '--')}`);
  _setText('incPreviewEstado', String(q('incMvaInput')?.value || '').trim().toUpperCase() || 'Pendiente');
  const linksPreview = q('incPreviewLinks');
  if (linksPreview) {
    const links = _state?.linksNuevaNota || [];
    linksPreview.innerHTML = links.length
      ? links.map(item => `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><span class="material-icons">link</span>${esc(item.label || item.url)}</a>`).join('')
      : '';
  }
  const badge = q('incPreviewPrioridad');
  if (badge) {
    badge.className = `inc-preview-priority ${meta.className}`;
    badge.innerHTML = `<span class="material-icons" style="font-size:15px;">${meta.icon}</span><span>${esc(meta.label)}</span>`;
  }
}

function _statusFromNota(item) {
  const value = String(item?.estado || '').toUpperCase().trim();
  if (value === 'RESUELTA' || value === 'RESUELTO' || value === 'CERRADA' || value === 'CERRADO') return 'RESUELTA';
  return 'PENDIENTE';
}

function _priority(item) {
  const p = String(item?.prioridad || '').toUpperCase().trim();
  if (p === 'CRITICA' || p === 'CRÍTICA' || p === 'CRITICO' || p === 'CRÍTICO' || p === 'URGENTE') return 'CRITICA';
  if (p === 'ALTA') return 'ALTA';
  if (p === 'BAJA') return 'BAJA';
  return 'MEDIA';
}

function _priorityMeta(item) {
  const p = _priority(item);
  if (p === 'CRITICA') return { key: 'CRITICA', icon: 'error', label: 'Crítica', className: 'is-critica' };
  if (p === 'ALTA') return { key: 'ALTA', icon: 'priority_high', label: 'Alta', className: 'is-alta' };
  if (p === 'BAJA') return { key: 'BAJA', icon: 'low_priority', label: 'Baja', className: 'is-baja' };
  return { key: 'MEDIA', icon: 'report_problem', label: 'Media', className: 'is-media' };
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

function _stateMeta(item) {
  if (_statusFromNota(item) === 'RESUELTA') return { className: 'is-resuelta', label: 'Resuelta' };
  return { className: 'is-pendiente', label: 'Pendiente' };
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
      label = String(entry.nombre || entry.name || entry.filename || entry.fileName || '').trim();
    }
    const key = `${url}|${path}|${label}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ url, path, label: label || (url || path || 'Evidencia') });
  });
  return out;
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

function _empty(message, loading = false) {
  return `<div class="inc-empty-state"><span class="material-icons ${loading ? 'spinner' : ''}">${loading ? 'sync' : 'search_off'}</span><div>${esc(message)}</div></div>`;
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

function _renderLayout() {
  return `
    <div class="app-incidencias">
      <div class="incv2-header">
        <div class="incv2-header-bg"></div>
        <div class="incv2-header-content">
          <div class="incv2-header-left">
            <span class="material-icons">description</span>
            <div>
              <h2 class="incv2-header-title">NOTAS E INCIDENCIAS</h2>
              <p class="incv2-header-sub">Bitácora operativa del mapa</p>
            </div>
          </div>
          <div class="incv2-header-right">
            <div class="incv2-stat-pills">
              <div class="incv2-stat-pill"><span>Activas</span><strong id="incStatPendientes">0</strong></div>
              <div class="incv2-stat-pill"><span>Total</span><strong id="incStatTotal">0</strong></div>
              <div class="incv2-stat-pill incv2-stat-pill--danger"><span>Críticas</span><strong id="incStatCriticas">0</strong></div>
            </div>
            <span id="incPlazaBadge" class="inc-plaza-badge">—</span>
          </div>
        </div>
      </div>

      <div class="incidencias-shell">
        <div class="inc-tabs">
          <div class="inc-tab active" data-inc-tab="viewTab">Historial</div>
          <div class="inc-tab" data-inc-tab="addTab">+ Nueva</div>
        </div>

        <div id="viewTab" class="inc-content active">
          <div class="inc-history-grid">
            <aside class="inc-filter-column">
              <div class="inc-filter-card">
                <h3 class="inc-filter-title">Prioridad</h3>
                <div class="inc-filter-stack">
                  <label class="inc-filter-item"><span><span class="inc-filter-dot is-critica"></span> Crítica</span><input type="checkbox" id="incFilterCritica" checked></label>
                  <label class="inc-filter-item"><span><span class="inc-filter-dot is-alta"></span> Alta</span><input type="checkbox" id="incFilterAlta" checked></label>
                  <label class="inc-filter-item"><span><span class="inc-filter-dot is-media"></span> Media</span><input type="checkbox" id="incFilterMedia" checked></label>
                  <label class="inc-filter-item"><span><span class="inc-filter-dot is-baja"></span> Baja</span><input type="checkbox" id="incFilterBaja" checked></label>
                </div>
              </div>
              <div class="inc-filter-card">
                <h3 class="inc-filter-title">Estado</h3>
                <div class="inc-state-pills">
                  <span class="inc-filter-pill"><span class="inc-filter-dot is-pendiente"></span><span id="incCountPendientes">0</span></span>
                  <span class="inc-filter-pill"><span class="inc-filter-dot is-resuelta"></span><span id="incCountResueltas">0</span></span>
                  <span class="inc-filter-pill"><span class="material-icons">attach_file</span><span id="incCountAdjuntos">0</span></span>
                </div>
              </div>
              <button id="incGoToAdd" class="incv2-btn-new"><span class="material-icons">add</span> Nueva nota</button>
            </aside>

            <div class="inc-list-column">
              <div class="inc-history-toolbar">
                <div id="incGlobalSearchHint" class="inc-global-hint">Búsqueda principal desde header App Shell</div>
                <select id="filtroEstado" class="inc-select-filter">
                  <option value="TODAS">Todas</option>
                  <option value="PENDIENTE">Pendientes</option>
                  <option value="RESUELTA">Resueltas</option>
                </select>
                <button id="incRefreshBtn" class="btn-inline-inc"><span class="material-icons">refresh</span></button>
              </div>
              <div id="listaNotas" class="inc-history-list"></div>
            </div>
          </div>
        </div>

        <div id="addTab" class="inc-content">
          <div class="inc-compose-grid">
            <div class="inc-form-panel">
              <div class="inc-form-card">
                <div class="inc-field-grid">
                  <div class="inc-field">
                    <label class="inc-field-label">Reportado por</label>
                    <input type="text" id="autorNuevaNota" class="inc-input inc-input-readonly" disabled>
                  </div>
                  <div class="inc-field">
                    <label class="inc-field-label">Nivel de importancia</label>
                    <select id="nuevaNotaPrioridad" class="inc-select">
                      <option value="BAJA">Baja</option>
                      <option value="MEDIA">Media</option>
                      <option value="ALTA" selected>Alta</option>
                      <option value="CRITICA">Critica</option>
                    </select>
                  </div>
                </div>
                <div class="inc-field">
                  <label class="inc-field-label">Número de unidad (MVA)</label>
                  <input type="text" id="incMvaInput" class="inc-input" placeholder="Ej: MVA-1234">
                </div>
                <div class="inc-field">
                  <label class="inc-field-label">Titulo de la nota</label>
                  <input type="text" id="nuevaNotaTitulo" class="inc-input" placeholder="Ej: Disrupcion operativa en unidad">
                </div>
                <div class="inc-field">
                  <label class="inc-field-label">Descripcion de la nota/incidencia</label>
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
                    <textarea id="nuevaNotaTxt" class="inc-editor-textarea inc-editor-textarea--hidden" tabindex="-1" aria-hidden="true"></textarea>
                  </div>
                </div>
                <div class="inc-field">
                  <label class="inc-field-label">Adjuntar Evidencias</label>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <label class="inc-btn-ghost" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
                      <span class="material-icons" style="font-size:18px;">cloud_upload</span> Seleccionar archivos...
                      <input type="file" id="incAdjuntosInput" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="display:none;">
                    </label>
                  </div>
                  <div id="incAdjuntosNuevosCont" style="margin-top:8px;"></div>
                </div>
                <div class="inc-field">
                  <label class="inc-field-label">Agregar link de evidencia</label>
                  <div class="inc-link-input-row">
                    <input type="url" id="incLinkInput" class="inc-input" placeholder="https://drive.google.com/...">
                    <button type="button" id="incAddLinkBtn" class="inc-btn-ghost"><span class="material-icons">add_link</span>Agregar</button>
                  </div>
                  <div id="incLinksNuevosCont" class="inc-link-chip-list"></div>
                </div>
                <div class="inc-form-actions">
                  <button type="button" id="incDiscardBtn" class="inc-btn-ghost">Descartar</button>
                  <button type="button" id="btnPublicarInc" class="inc-btn-primary"><span>Publicar Nota</span><span class="material-icons">send</span></button>
                </div>
              </div>
            </div>
            <aside class="inc-side-panel">
              <div class="inc-side-kicker">Protocolo operativo v4.2</div>
              <div class="inc-system-card">
                <h3 class="inc-side-title">Detalles del sistema</h3>
                <div class="inc-system-rows">
                  <div class="inc-system-row"><span>Timestamp</span><strong id="incMetaTimestamp">--</strong></div>
                  <div class="inc-system-row"><span>Ubicacion</span><strong id="incMetaUbicacion">--</strong></div>
                  <div class="inc-system-row"><span>ID registro</span><strong id="incMetaId">INC-000000</strong></div>
                </div>
              </div>
              <div class="inc-preview-card">
                <div class="inc-preview-top"><span id="incPreviewPrioridad" class="inc-preview-priority is-alta">Alta</span><span id="incPreviewStamp" class="inc-preview-stamp">Sin adjuntos</span></div>
                <h3 id="incPreviewTitulo" class="inc-preview-title">Nueva nota</h3>
                <div id="incPreviewBody" class="inc-preview-body">Documenta el evento operativo con claridad.</div>
                <div id="incPreviewLinks" class="inc-preview-links"></div>
                <div class="inc-preview-meta"><span id="incPreviewAutor">Emitido por: --</span><span id="incPreviewEstado">Pendiente</span></div>
              </div>
            </aside>
          </div>
        </div>
      </div>

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
