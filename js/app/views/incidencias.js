// ═══════════════════════════════════════════════════════════
//  /js/app/views/incidencias.js
//  Fase 8B — vista real /app/incidencias con plaza global.
// ═══════════════════════════════════════════════════════════

import { getState, getCurrentPlaza, onPlazaChange } from '/js/app/app-state.js';
import { subscribeIncidencias, createIncidencia, resolveIncidencia } from '/js/app/features/incidencias/incidencias-data.js';

let _container = null;
let _state = null;
let _unsubIncidencias = null;
let _unsubPlaza = null;
let _offGlobalSearch = null;
let _cssInjected = false;

const q = id => _container?.querySelector(`#${id}`) || null;
const qsa = sel => Array.from(_container?.querySelectorAll(sel) || []);

function _trackListener(action, name, extra = {}) {
  if (typeof window.__mexTrackListener !== 'function') return;
  window.__mexTrackListener(window.location.pathname, `app/incidencias:${name}`, action, extra);
}

function _makeState(plaza) {
  const url = new URL(window.location.href);
  return {
    plaza,
    allItems: [],
    items: [],
    tab: 'viewTab',
    query: '',
    statusFilter: 'TODAS',
    priorityFilter: { CRITICA: true, ALTA: true, MEDIA: true, BAJA: true },
    selectedId: '',
    mvaFromQuery: String(url.searchParams.get('mva') || '').trim().toUpperCase(),
    loading: true,
    errorMessage: '',
    hasPermissionDenied: false,
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
      _state.errorMessage = err?.message || 'Error al cargar incidencias.';
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

  q('incResolverCancelar')?.addEventListener('click', () => _toggleResolverModal(false));
  q('btnConfirmarResInc')?.addEventListener('click', _confirmResolve);
}

function _applyFilters() {
  const query = _state.query;
  _state.items = (_state.allItems || []).filter(item => {
    const p = _priority(item);
    if (!_state.priorityFilter[p]) return false;
    const status = _legacyStatus(item);
    if (_state.statusFilter !== 'TODAS' && status !== _state.statusFilter) return false;
    if (!query) return true;
    const hay = `${item.titulo || ''} ${item.descripcion || ''} ${item.autor || ''} ${item.codigo || ''} ${item.mva || ''}`.toLowerCase();
    return hay.includes(query);
  }).sort((a, b) => _dateMs(b.creadoEn || b.fecha) - _dateMs(a.creadoEn || a.fecha));
}

function _render() {
  if (!_state) return;
  _setText('incPlazaBadge', _state.plaza || '—');
  _setText('incMetaUbicacion', _state.plaza || 'GLOBAL');
  _setText('incGlobalSearchHint', _state.query ? `Filtro global activo: "${_state.query}"` : 'Búsqueda principal desde header App Shell');
  _renderStats();
  _renderTabs();
  _renderList();
  _renderPreview();
}

function _renderStats() {
  const total = _state.allItems.length;
  const pend = _state.allItems.filter(i => _legacyStatus(i) === 'PENDIENTE').length;
  const crit = _state.allItems.filter(i => _priority(i) === 'CRITICA' && _legacyStatus(i) === 'PENDIENTE').length;
  const res = _state.allItems.filter(i => _legacyStatus(i) === 'RESUELTA').length;
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
    list.innerHTML = _empty('Selecciona una plaza para ver incidencias.');
    return;
  }
  if (_state.loading) {
    list.innerHTML = _empty('Cargando registros...', true);
    return;
  }
  if (_state.hasPermissionDenied) {
    list.innerHTML = _empty('No tienes permisos para ver incidencias de esta plaza.');
    return;
  }
  if (_state.errorMessage) {
    list.innerHTML = _empty(_state.errorMessage);
    return;
  }
  if (!_state.allItems.length) {
    list.innerHTML = _empty('No hay incidencias registradas.');
    return;
  }
  if (!_state.items.length) {
    list.innerHTML = _empty('No se encontraron incidencias con los filtros actuales.');
    return;
  }

  list.innerHTML = _state.items.map(item => {
    const pr = _priorityMeta(item);
    const st = _stateMeta(item);
    const open = _legacyStatus(item) === 'PENDIENTE';
    const evidencias = _evidenceRows(item);
    return `
      <article class="nota-card" data-prioridad="${esc(pr.key)}">
        <div class="nota-top">
          <div class="nota-main">
            <div class="nota-icon"><span class="material-icons">${esc(pr.icon)}</span></div>
            <div class="nota-main-copy">
              <div class="nota-title-row">
                <h4 class="nota-title">${esc(item.titulo || 'Incidencia sin titulo')}</h4>
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
                <span>${esc(item.mva || 'SIN MVA')}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="nota-body">${esc(item.descripcion || 'Sin descripción').replace(/\n/g, '<br>')}</div>
        ${_renderEvidenceBlock(evidencias)}
        <div class="nota-footer">
          <div class="nota-footer-left">
            <span class="nota-chip">${esc(item.plaza || _state.plaza || '—')}</span>
            <span class="nota-chip">${esc(pr.label)}</span>
            ${evidencias.length ? `<span class="nota-chip">${evidencias.length} adjunto${evidencias.length === 1 ? '' : 's'}</span>` : ''}
          </div>
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
}

function _renderEvidenceBlock(items) {
  if (!items.length) {
    return '<div class="nota-attachments-empty">Sin evidencias adjuntas.</div>';
  }
  return `
    <div class="nota-attachments">
      ${items.map(item => item.url
        ? `<a class="nota-attachment-file" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><span class="material-icons">attach_file</span><span class="nota-attachment-copy"><strong>${esc(item.label)}</strong><span>Abrir evidencia</span></span></a>`
        : `<div class="nota-attachment-file nota-attachment-file--no-url"><span class="material-icons">folder</span><span class="nota-attachment-copy"><strong>${esc(item.label)}</strong><span>Disponible en legacy (sin URL directa)</span></span></div>`
      ).join('')}
    </div>
  `;
}

function _toggleResolverModal(show) {
  q('modalAuthIncidencia')?.classList.toggle('active', !!show);
  if (show) q('authComentario')?.focus();
}

async function _confirmResolve() {
  const id = String(_state?.selectedId || '').trim();
  const comentario = String(q('authComentario')?.value || '').trim();
  if (!id) return _showNotice('No se pudo identificar la incidencia a resolver.', 'error');
  if (!comentario) return _showNotice('Describe cómo se solucionó.', 'error');
  const btn = q('btnConfirmarResInc');
  const gs = getState();
  const autor = gs.profile?.email || gs.profile?.nombre || 'Usuario';
  btn.disabled = true;
  try {
    await resolveIncidencia(id, comentario, autor);
    _showNotice('Incidencia resuelta.', 'ok');
    _toggleResolverModal(false);
    q('authComentario').value = '';
  } catch (error) {
    _showNotice(error?.message || 'No se pudo resolver la incidencia.', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function _onCreateIncidencia() {
  if (!_state?.plaza) return _showNotice('Selecciona una plaza para registrar incidencias.', 'error');
  const titulo = String(q('nuevaNotaTitulo')?.value || '').trim();
  const descripcion = String(q('nuevaNotaTxt')?.value || '').trim();
  const prioridad = String(q('nuevaNotaPrioridad')?.value || 'MEDIA').toUpperCase();
  const mva = String(q('incMvaInput')?.value || '').trim().toUpperCase();
  if (!titulo) return _showNotice('Escribe el titulo de la incidencia.', 'error');
  if (!descripcion) return _showNotice('Escribe la descripción.', 'error');

  const btn = q('btnPublicarInc');
  const gs = getState();
  const autor = gs.profile?.email || gs.profile?.nombre || 'Usuario';
  btn.disabled = true;
  try {
    await createIncidencia({
      titulo,
      descripcion,
      nota: descripcion,
      prioridad,
      mva,
      plaza: _state.plaza,
      plazaID: _state.plaza,
      autor,
      creadoPor: autor,
      estado: 'PENDIENTE',
      source: 'app_shell'
    });
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
  q('nuevaNotaPrioridad').value = 'ALTA';
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
  _setText('incPreviewTitulo', String(q('nuevaNotaTitulo')?.value || '').trim() || 'Nueva incidencia');
  _setText('incPreviewBody', String(q('nuevaNotaTxt')?.value || '').trim() || 'Documenta el evento con precision tecnica para que el historial operativo conserve contexto e impacto.');
  _setText('incPreviewAutor', `Emitido por: ${String(q('autorNuevaNota')?.value || '--')}`);
  _setText('incPreviewEstado', 'Pendiente');
  const badge = q('incPreviewPrioridad');
  if (badge) {
    badge.className = `inc-preview-priority ${meta.className}`;
    badge.innerHTML = `<span class="material-icons" style="font-size:15px;">${meta.icon}</span><span>${esc(meta.label)}</span>`;
  }
}

function _legacyStatus(item) {
  const value = String(item?.estado || '').toUpperCase().trim();
  if (value === 'RESUELTA' || value === 'CERRADA') return 'RESUELTA';
  return 'PENDIENTE';
}

function _priority(item) {
  const p = String(item?.prioridad || '').toUpperCase().trim();
  if (p === 'CRITICA' || p === 'CRÍTICA') return 'CRITICA';
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

function _stateMeta(item) {
  if (_legacyStatus(item) === 'RESUELTA') return { className: 'is-resuelta', label: 'Resuelta' };
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
              <h2 class="incv2-header-title">BITÁCORA</h2>
              <p class="incv2-header-sub">Incidencias operativas</p>
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
              <div class="inc-history-footer"><a class="inc-load-more" href="/incidencias">Abrir legacy para eliminación/adjuntos avanzados</a></div>
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
                  <label class="inc-field-label">Titulo de la incidencia</label>
                  <input type="text" id="nuevaNotaTitulo" class="inc-input" placeholder="Ej: Disrupcion operativa en unidad">
                </div>
                <div class="inc-field">
                  <label class="inc-field-label">Descripcion de la incidencia</label>
                  <textarea id="nuevaNotaTxt" class="inc-editor-textarea" placeholder="Describe causas, impacto y contexto operativo"></textarea>
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
              <div class="inc-warning-card"><span class="material-icons">warning</span><p>Adjuntos avanzados y eliminación se mantienen en legacy para seguridad de Storage.</p></div>
              <div class="inc-preview-card">
                <div class="inc-preview-top"><span id="incPreviewPrioridad" class="inc-preview-priority is-alta">Alta</span><span id="incPreviewStamp" class="inc-preview-stamp">Sin adjuntos</span></div>
                <h3 id="incPreviewTitulo" class="inc-preview-title">Nueva incidencia</h3>
                <div id="incPreviewBody" class="inc-preview-body">Documenta el evento operativo con claridad.</div>
                <div class="inc-preview-meta"><span id="incPreviewAutor">Emitido por: --</span><span id="incPreviewEstado">Pendiente</span></div>
              </div>
            </aside>
          </div>
        </div>
      </div>

      <div id="modalAuthIncidencia" class="modal-overlay">
        <div class="modal-box">
          <div class="modal-title">Resolver Incidencia</div>
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
