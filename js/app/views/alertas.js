// ═══════════════════════════════════════════════════════════
//  /js/app/views/alertas.js
//  Alertas maestras nativas del App Shell.
// ═══════════════════════════════════════════════════════════

import { getState } from '/js/app/app-state.js';
import {
  db,
  COL,
  emitirNuevaAlertaMaestra,
  actualizarAlertaMaestra,
  obtenerTodasLasAlertas,
  eliminarAlertaMaestraBackend,
  obtenerPlantillasAlerta,
  guardarPlantillaAlerta
} from '/js/core/database.js';
import { esAdmin, tieneAccesoTotal } from '/domain/permissions.model.js';

let _container = null;
let _shell = null;
let _ctx = null;
let _offGlobalSearch = null;
let _mode = 'emitir';
let _selectionRange = null;
let _history = [];
let _templates = [];
let _users = [];
let _editingId = '';
let _destMode = 'GLOBAL';
let _selectedDest = [];
let _plazaScope = '';
let _historyFilter = { q: '', tipo: '', modo: '' };

const _mexAlert = (titulo, texto, tipo = 'info') =>
  typeof window.mexAlert === 'function' ? window.mexAlert(titulo, texto, tipo) : Promise.resolve(true);
const _mexConfirm = (titulo, texto, tipo = 'warning') =>
  typeof window.mexConfirm === 'function' ? window.mexConfirm(titulo, texto, tipo) : Promise.resolve(false);
const _mexPrompt = (titulo, texto, placeholder = '', inputTipo = 'text', valor = '') =>
  typeof window.mexPrompt === 'function' ? window.mexPrompt(titulo, texto, placeholder, inputTipo, valor) : Promise.resolve(null);

const ALERTA_TIPO_META = Object.freeze({
  URGENTE: { label: 'URGENTE', bg: '#fee2e2', color: '#ef4444', selectBg: '#fef2f2', border: '#ef4444' },
  WARNING: { label: 'ADVERTENCIA', bg: '#fef3c7', color: '#d97706', selectBg: '#fffbeb', border: '#f59e0b' },
  INFO: { label: 'INFORMATIVO', bg: '#dbeafe', color: '#1d4ed8', selectBg: '#eff6ff', border: '#60a5fa' }
});

const ALERTA_MODO_META = Object.freeze({
  INTERRUPTIVA: { label: 'INTERRUPTIVA', icon: 'bolt', bg: '#eff6ff', color: '#1a73e8' },
  PASIVA: { label: 'PASIVA', icon: 'notifications', bg: '#f8fafc', color: '#475569' }
});

const ALERTA_ACTION_META = Object.freeze({
  NONE: {
    icon: 'remove_circle',
    defaultLabel: '',
    valueLabel: 'Sin accion',
    valuePlaceholder: '',
    extraLabel: '',
    extraPlaceholder: '',
    help: 'La alerta solo mostrara el boton para marcarla como leida.'
  },
  URL: {
    icon: 'open_in_new',
    defaultLabel: 'Abrir enlace',
    valueLabel: 'URL destino',
    valuePlaceholder: 'https://...',
    extraLabel: 'Texto secundario',
    extraPlaceholder: 'Ej. Se abrira en una nueva pestana',
    help: 'Abre una pagina externa o documento cuando el usuario pulse el boton.'
  },
  WHATSAPP: {
    icon: 'chat',
    defaultLabel: 'Abrir WhatsApp',
    valueLabel: 'Numero de WhatsApp',
    valuePlaceholder: '5215512345678',
    extraLabel: 'Mensaje inicial',
    extraPlaceholder: 'Texto que aparecera precargado',
    help: 'Abre una conversacion directa de WhatsApp con el numero indicado.'
  },
  COPY: {
    icon: 'content_copy',
    defaultLabel: 'Copiar informacion',
    valueLabel: 'Texto o enlace a copiar',
    valuePlaceholder: 'Codigo, URL o mensaje corto',
    extraLabel: 'Confirmacion',
    extraPlaceholder: 'Ej. Enlace copiado',
    help: 'Copia contenido util al portapapeles del usuario.'
  }
});

const q = selector => _container?.querySelector(selector) || null;
const qa = selector => Array.from(_container?.querySelectorAll(selector) || []);

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _toast(message, type = 'info') {
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
    return;
  }
  console[type === 'error' ? 'error' : 'log'](`[alertas] ${message}`);
}

function _hasPermission() {
  const state = getState();
  const role = String(state.role || state.profile?.rol || '').toUpperCase();
  return tieneAccesoTotal(role) || esAdmin(role);
}

function _actorName() {
  const state = getState();
  return String(
    state.profile?.nombreCompleto ||
    state.profile?.nombre ||
    state.profile?.usuario ||
    state.user?.displayName ||
    state.user?.email ||
    'Sistema'
  ).trim();
}

function _ensureCss() {
  [
    ['/css/alertas.css', 'data-app-alertas-legacy-css'],
    ['/css/app-alertas.css', 'data-app-alertas-css']
  ].forEach(([href, attr]) => {
    if (document.querySelector(`link[${attr}]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute(attr, '1');
    document.head.appendChild(link);
  });
}

export function mount(ctx = {}) {
  unmount();
  _ctx = ctx;
  _container = ctx.container;
  _shell = ctx.shell || null;
  _mode = window.location.pathname.replace(/\/+$/, '') === '/app/alertas/historial' ? 'historial' : 'emitir';
  _historyFilter = { q: new URLSearchParams(window.location.search).get('q') || '', tipo: '', modo: '' };
  _ensureCss();
  document.body.classList.add('app-alertas-active');
  _renderHeaderActions();
  _render();
  _bindGlobalSearch();
  _bootstrap();
}

export function unmount() {
  if (typeof _offGlobalSearch === 'function') {
    try { _offGlobalSearch(); } catch (_) {}
  }
  try { _shell?.setHeaderActions?.(''); } catch (_) {}
  document.body.classList.remove('app-alertas-active');
  if (_container) _container.innerHTML = '';
  _container = null;
  _shell = null;
  _ctx = null;
  _offGlobalSearch = null;
  _selectionRange = null;
}

function _renderHeaderActions() {
  _shell?.setHeaderActions?.(`
    <button type="button" class="app-alertas-hdr-btn ${_mode === 'emitir' ? 'is-active' : ''}" id="appAlertasEmitirBtn">
      <span class="material-symbols-outlined">campaign</span>
      <span>Emitir</span>
    </button>
    <button type="button" class="app-alertas-hdr-btn ${_mode === 'historial' ? 'is-active' : ''}" id="appAlertasHistBtn">
      <span class="material-symbols-outlined">notifications_active</span>
      <span>Historial</span>
    </button>
  `);
  document.getElementById('appAlertasEmitirBtn')?.addEventListener('click', () => _ctx?.navigate?.('/app/alertas'));
  document.getElementById('appAlertasHistBtn')?.addEventListener('click', () => _ctx?.navigate?.('/app/alertas/historial'));
}

function _bindGlobalSearch() {
  const handler = event => {
    const route = String(event?.detail?.route || getState().currentRoute || '');
    if (!route.startsWith('/app/alertas')) return;
    const query = String(event?.detail?.query || '').trim();
    if (_mode === 'historial') {
      _historyFilter.q = query;
      const input = q('#alertaHistBuscador');
      if (input) input.value = query;
      _renderHistoryList();
    }
  };
  window.addEventListener('mex:global-search', handler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', handler);
}

function _getEmpresaPlazas() {
  const empresa = window.MEX_CONFIG?.empresa;
  if (!empresa) return [];
  return Array.isArray(empresa.plazas) ? empresa.plazas.filter(Boolean) : [];
}

async function _bootstrap() {
  if (window.mexFeatures && !window.mexFeatures.puedeUsar('alertas')) {
    _renderFeatureDisabled();
    return;
  }
  if (!_hasPermission()) {
    _renderNoAccess();
    return;
  }
  if (_mode === 'emitir') {
    await Promise.all([_loadUsers(), _loadTemplates()]);
    _renderDestinations();
    _renderTemplates();
    const editId = String(new URLSearchParams(window.location.search).get('edit') || '').trim();
    if (editId) await _loadEditAlert(editId);
    else _prepareEditor();
    _updatePreview();
    return;
  }
  _paintCachedHistory();
  await _loadHistory();
}

function _render() {
  if (!_container) return;
  _container.innerHTML = _mode === 'historial' ? _renderHistory() : _renderEditor();
  _bindUi();
}

function _renderNoAccess() {
  if (!_container) return;
  _container.innerHTML = `
    <section class="app-alertas-page app-alertas-denied">
      <span class="material-symbols-outlined">lock</span>
      <h2>Sin permiso para alertas maestras</h2>
      <p>Tu rol actual no puede emitir ni administrar alertas globales.</p>
    </section>
  `;
}

function _renderFeatureDisabled() {
  if (!_container) return;
  _container.innerHTML = `
    <section class="app-alertas-page app-alertas-denied">
      <span class="material-symbols-outlined">campaign</span>
      <h2>Funcion no disponible</h2>
      <p>El modulo de alertas no esta habilitado para tu empresa. Contacta al administrador para activarlo.</p>
    </section>
  `;
}

function _renderEditor() {
  return `
    <section class="app-alertas-page app-alertas-page--editor">
      <div class="app-alertas-topline">
        <div>
          <p class="app-alertas-eyebrow">Alertas maestras</p>
          <h1 id="tituloModalCrearAlerta">Emitir alerta maestra</h1>
        </div>
        <button type="button" class="app-alertas-ghost" data-alert-action="go-history">
          <span class="material-symbols-outlined">history</span>
          Historial
        </button>
      </div>

      <div class="alerta-studio-layout app-alertas-studio">
        <div class="alerta-config-card">
          <p class="app-alertas-card-kicker">Configuracion</p>

          <label class="app-alertas-field">
            <span>Nivel de urgencia</span>
            <select id="alertaNuevaTipo">
              <option value="URGENTE">URGENTE</option>
              <option value="WARNING">ADVERTENCIA</option>
              <option value="INFO">INFORMATIVO</option>
            </select>
          </label>

          <label class="app-alertas-field">
            <span>Firma visible</span>
            <select id="alertaAutorModo">
              <option value="CURRENT">Usuario actual</option>
              <option value="NONE">Sin autor visible</option>
              <option value="CUSTOM">Autor personalizado</option>
            </select>
            <input type="text" id="alertaAutorCustom" placeholder="Ej. Equipo de operaciones">
          </label>

          <div class="app-alertas-banner-config">
            <label class="app-alertas-check">
              <input type="checkbox" id="alertaBannerCustomToggle">
              <span>Personalizar banner visible</span>
            </label>
            <div id="alertaBannerCustomWrap">
              <input type="text" id="alertaBannerLabel" placeholder="Texto del banner">
              <div class="app-alertas-color-grid">
                <label>Fondo <input type="color" id="alertaBannerBg" value="#fee2e2"></label>
                <label>Texto <input type="color" id="alertaBannerText" value="#ef4444"></label>
              </div>
            </div>
          </div>

          <div class="app-alertas-dest">
            <span>Destinatarios</span>
            <div class="app-alertas-segmented">
              <button type="button" id="destBtnGlobal" data-alert-action="dest" data-mode="GLOBAL">Global</button>
              <button type="button" id="destBtnSel" data-alert-action="dest" data-mode="SEL">Varios</button>
              <button type="button" id="destBtnSolo" data-alert-action="dest" data-mode="SOLO">Solo a</button>
            </div>
            <div id="destPanelSel" class="app-alertas-dest-panel">
              <input type="text" id="destBuscadorUsuarios" placeholder="Filtrar usuarios...">
              <div id="destListaCheckboxes" class="app-alertas-dest-list"></div>
            </div>
            <div id="destPanelSolo" class="app-alertas-dest-panel">
              <select id="destSoloUsuario"></select>
            </div>
          </div>

          ${_renderPlazaScopeField()}

          <div class="app-alertas-mode-grid">
            <button type="button" id="modoCardInterr" data-alert-action="modo" data-mode="INTERRUPTIVA">
              <span class="material-symbols-outlined">notification_important</span>
              <strong>Interruptiva</strong>
              <small>Bloquea pantalla hasta que se lea</small>
            </button>
            <button type="button" id="modoCardPasiva" data-alert-action="modo" data-mode="PASIVA">
              <span class="material-symbols-outlined">notifications</span>
              <strong>Pasiva</strong>
              <small>Solo en la campana</small>
            </button>
            <input type="hidden" id="alertaModoActual" value="INTERRUPTIVA">
          </div>

          <label class="app-alertas-field">
            <span>Titulo principal</span>
            <input type="text" id="alertaNuevaTitulo" placeholder="Ej. Actualizacion del sistema">
          </label>

          <div class="app-alertas-field">
            <span>Imagen superior opcional</span>
            <label for="alertaFile" class="app-alertas-upload">
              <span class="material-symbols-outlined">add_photo_alternate</span>
              <span id="textoUploadAlerta">Seleccionar imagen...</span>
            </label>
            <input type="file" id="alertaFile" accept="image/*">
            <input type="hidden" id="alertaNuevaImagen">
            <button type="button" class="app-alertas-mini-btn" data-alert-action="clear-image">Quitar imagen actual</button>
          </div>

          <div class="alerta-action-stack">
            <label class="app-alertas-field">
              <span>Boton y funcion</span>
              <select id="alertaActionType">
                <option value="NONE">Sin boton extra</option>
                <option value="URL">Abrir enlace</option>
                <option value="WHATSAPP">Abrir WhatsApp</option>
                <option value="COPY">Copiar texto / enlace</option>
              </select>
            </label>
            <div id="alertaActionConfig" class="alerta-action-grid">
              <label class="alerta-action-field"><span id="alertaActionLabelCaption">Texto del boton</span><input id="alertaActionLabel" type="text"></label>
              <label class="alerta-action-field"><span id="alertaActionValueCaption">Destino</span><input id="alertaActionValue" type="text"></label>
              <label class="alerta-action-field" id="alertaActionExtraWrap"><span id="alertaActionExtraCaption">Dato extra</span><input id="alertaActionExtra" type="text"></label>
            </div>
            <div id="alertaActionHelp" class="alerta-action-help"></div>
          </div>

          <button type="button" id="btnEmitirAlertaGlobal" class="app-alertas-submit" data-alert-action="emit">
            <span class="material-symbols-outlined">send</span>
            <span id="txtBtnEmitir">Emitir a toda la red</span>
          </button>
        </div>

        <div class="alerta-editor-card">
          <div class="alerta-editor-topline">
            <div>
              <p class="app-alertas-card-kicker">Diseno del cuerpo</p>
              <div class="app-alertas-muted">Texto, formato, enlaces, imagenes y preview en vivo.</div>
            </div>
            <div class="app-alertas-template-tools">
              <div class="alerta-live-pill"><span class="alerta-live-dot"></span><span id="alertaPreviewSyncLabel">Preview sincronizado</span></div>
              <select id="alertaPlantillasSelect"><option value="">Cargar plantilla...</option></select>
              <button type="button" class="app-alertas-mini-btn" data-alert-action="save-template">Guardar plantilla</button>
            </div>
          </div>

          <div class="alerta-editor-shell">
            <div class="alerta-editor-info">
              <div>
                <strong>Texto del mensaje</strong>
                <span>El lector vera este mismo contenido en su alerta.</span>
              </div>
              <div id="alertaEditorDestinos" class="alerta-editor-destino">
                <span class="material-symbols-outlined">public</span>
                <span>GLOBAL</span>
              </div>
            </div>
            <div class="alerta-editor-toolbar">
              ${_toolbarButton('bold', 'format_bold', 'Negrita')}
              ${_toolbarButton('italic', 'format_italic', 'Cursiva')}
              ${_toolbarButton('underline', 'format_underlined', 'Subrayado')}
              ${_toolbarSep()}
              <button type="button" data-alert-cmd="fontSize" data-value="1" title="Pequeno">A<sub>s</sub></button>
              <button type="button" data-alert-cmd="fontSize" data-value="3" title="Normal">A</button>
              <button type="button" data-alert-cmd="fontSize" data-value="5" title="Grande">A<sup>+</sup></button>
              ${_toolbarSep()}
              <label class="app-alertas-color-btn" title="Color de texto">
                <span class="material-symbols-outlined">format_color_text</span>
                <input type="color" id="alertaColorPicker" value="#334155">
              </label>
              ${_toolbarSep()}
              ${_toolbarButton('justifyLeft', 'format_align_left', 'Izquierda')}
              ${_toolbarButton('justifyCenter', 'format_align_center', 'Centrar')}
              ${_toolbarButton('justifyRight', 'format_align_right', 'Derecha')}
              ${_toolbarSep()}
              <button type="button" data-alert-action="insert-link" title="Insertar enlace"><span class="material-symbols-outlined">link</span></button>
              <button type="button" data-alert-action="body-image" title="Insertar imagen"><span class="material-symbols-outlined">image</span></button>
              <input type="file" id="alertaBodyImageFile" accept="image/*">
              ${_toolbarButton('insertUnorderedList', 'format_list_bulleted', 'Lista')}
              ${_toolbarButton('insertHorizontalRule', 'horizontal_rule', 'Linea')}
              ${_toolbarSep()}
              ${_toolbarButton('removeFormat', 'format_clear', 'Limpiar formato', 'is-danger')}
            </div>
            <div id="alertaEditorCuerpo" contenteditable="true" class="alerta-rich-editor alerta-scroll-thin"></div>
            <div class="alerta-editor-status">
              <span id="alertaEditorStats">0 palabras · 0 caracteres</span>
              <span id="alertaPreviewHoraStatus">Ultima vista previa: --:--</span>
            </div>
          </div>

          <div class="alerta-preview-shell">
            <div class="alerta-preview-caption"><span class="alerta-live-dot"></span>Vista previa en tiempo real</div>
            <div class="alerta-preview-card">
              <div id="alertaPreviewBanner" class="alerta-preview-banner"></div>
              <div class="alerta-preview-content">
                <div class="alerta-preview-head">
                  <div class="app-alertas-preview-badges">
                    <span id="alertaPreviewBadge" class="app-alertas-badge">URGENTE</span>
                    <span id="alertaPreviewModoBadge" class="app-alertas-badge">INTERRUPTIVA</span>
                    <span id="alertaPreviewDestinatarios" class="alerta-preview-recipient"><span class="material-symbols-outlined">public</span> GLOBAL</span>
                  </div>
                  <span id="alertaPreviewHora" class="app-alertas-preview-time">Ahora</span>
                </div>
                <h3 id="alertaPreviewTitulo">Sin titulo</h3>
                <div id="alertaPreviewSubline" class="app-alertas-preview-subline">Mensaje listo para toda la red</div>
                <div id="alertaPreviewMensaje" class="alerta-preview-message alerta-scroll-thin"></div>
                <div id="alertaPreviewActionWrap" class="alerta-preview-action">
                  <button id="alertaPreviewActionBtn" type="button" class="alerta-preview-action-btn"></button>
                  <div id="alertaPreviewActionHint" class="alerta-preview-action-hint"></div>
                </div>
                <div class="alerta-preview-meta">
                  <span id="alertaPreviewAuthorWrap">Enviado por: <span id="alertaPreviewAutor"></span></span>
                  <span id="alertaPreviewStats">0 palabras · 0 caracteres</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function _renderPlazaScopeField() {
  const plazas = _getEmpresaPlazas();
  if (plazas.length <= 1) return '';
  const opts = plazas.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  return `
    <label class="app-alertas-field">
      <span>Alcance por plaza</span>
      <select id="alertaPlazaScope">
        <option value="">Toda la empresa</option>
        ${opts}
      </select>
    </label>
  `;
}

function _toolbarButton(cmd, icon, title, extra = '') {
  return `<button type="button" class="${extra}" data-alert-cmd="${esc(cmd)}" title="${esc(title)}"><span class="material-symbols-outlined">${esc(icon)}</span></button>`;
}

function _toolbarSep() {
  return '<span class="app-alertas-toolbar-sep"></span>';
}

function _renderHistory() {
  return `
    <section class="app-alertas-page app-alertas-page--history">
      <div class="app-alertas-topline">
        <div>
          <p class="app-alertas-eyebrow">Alertas maestras</p>
          <h1>Historial de alertas</h1>
        </div>
        <button type="button" class="app-alertas-primary" data-alert-action="go-emit">
          <span class="material-symbols-outlined">campaign</span>
          Emitir alerta
        </button>
      </div>
      <div id="alertaHistStatsBar" class="app-alertas-stats">
        <span>Cargando metricas...</span>
      </div>
      <div class="app-alertas-filters">
        <input id="alertaHistBuscador" type="text" placeholder="Buscar titulo, autor o cuerpo..." value="${esc(_historyFilter.q)}">
        <select id="alertaHistTipo">
          <option value="">Todos los tipos</option>
          <option value="URGENTE">URGENTE</option>
          <option value="WARNING">ADVERTENCIA</option>
          <option value="INFO">INFORMATIVO</option>
        </select>
        <select id="alertaHistModo">
          <option value="">Todos los modos</option>
          <option value="INTERRUPTIVA">Interruptiva</option>
          <option value="PASIVA">Pasiva</option>
        </select>
        <button type="button" class="app-alertas-ghost" data-alert-action="refresh-history"><span class="material-symbols-outlined">refresh</span></button>
        <button type="button" class="app-alertas-ghost" data-alert-action="clear-history-filters">Limpiar</button>
      </div>
      <div id="listaHistorialAlertas" class="app-alertas-history-list">
        <div class="app-alertas-loading"><span class="material-symbols-outlined">sync</span> Cargando historial...</div>
      </div>
    </section>
  `;
}

function _bindUi() {
  if (!_container) return;
  _container.addEventListener('click', _onClick);
  _container.addEventListener('input', _onInput);
  _container.addEventListener('change', _onChange);
  q('#alertaEditorCuerpo')?.addEventListener('mouseup', _saveSelection);
  q('#alertaEditorCuerpo')?.addEventListener('keyup', _saveSelection);
  q('#alertaEditorCuerpo')?.addEventListener('blur', _saveSelection);
}

function _onClick(event) {
  const actionEl = event.target.closest('[data-alert-action]');
  const cmdEl = event.target.closest('[data-alert-cmd]');
  if (cmdEl) {
    const cmd = cmdEl.dataset.alertCmd;
    const value = cmdEl.dataset.value || null;
    _execCommand(cmd, value);
    return;
  }
  if (!actionEl) return;
  const action = actionEl.dataset.alertAction;
  if (action === 'go-history') _ctx?.navigate?.('/app/alertas/historial');
  if (action === 'go-emit') _ctx?.navigate?.('/app/alertas');
  if (action === 'dest') _setDestMode(actionEl.dataset.mode);
  if (action === 'modo') _selectModo(actionEl.dataset.mode);
  if (action === 'clear-image') _clearHeaderImage();
  if (action === 'insert-link') _insertLink();
  if (action === 'body-image') q('#alertaBodyImageFile')?.click();
  if (action === 'save-template') _saveTemplate();
  if (action === 'emit') _emitAlert();
  if (action === 'refresh-history') _loadHistory();
  if (action === 'clear-history-filters') _clearHistoryFilters();
  if (action === 'edit-alert') _ctx?.navigate?.(`/app/alertas?edit=${encodeURIComponent(actionEl.dataset.id || '')}`);
  if (action === 'delete-alert') _deleteAlert(actionEl.dataset.id || '');
  if (action === 'readers-alert') _showReaders(actionEl.dataset.id || '');
}

function _onInput(event) {
  const target = event.target;
  if (_mode === 'historial') {
    if (target.id === 'alertaHistBuscador') {
      _historyFilter.q = target.value || '';
      _renderHistoryList();
    }
    return;
  }
  if (target.id === 'destBuscadorUsuarios') _filterDestinations();
  if (target.id === 'alertaEditorCuerpo') _saveSelection();
  _updatePreview();
}

function _onChange(event) {
  const target = event.target;
  if (_mode === 'historial') {
    if (target.id === 'alertaHistTipo') _historyFilter.tipo = target.value || '';
    if (target.id === 'alertaHistModo') _historyFilter.modo = target.value || '';
    _renderHistoryList();
    return;
  }
  if (target.id === 'alertaFile') _compressHeaderImage(target.files?.[0]);
  if (target.id === 'alertaBodyImageFile') _insertBodyImage(target.files?.[0], target);
  if (target.id === 'alertaColorPicker') _execCommand('foreColor', target.value);
  if (target.id === 'alertaActionType') _updateActionFields(true);
  if (target.id === 'alertaPlantillasSelect') _loadTemplateIntoForm(target.value);
  if (target.id === 'alertaBannerCustomToggle') _updateBannerUi();
  if (target.id === 'alertaAutorModo') _updateAuthorUi();
  if (target.id === 'alertaPlazaScope') { _plazaScope = String(target.value || '').trim().toUpperCase(); }
  if (target.id === 'destSoloUsuario') {
    _selectedDest = target.value ? [String(target.value).toUpperCase()] : [];
  }
  if (target.matches('[data-dest-user]')) {
    const user = String(target.dataset.destUser || '').toUpperCase();
    const set = new Set(_selectedDest);
    if (target.checked) set.add(user);
    else set.delete(user);
    _selectedDest = Array.from(set).sort((a, b) => a.localeCompare(b));
  }
  _updatePreview();
}

async function _loadUsers() {
  try {
    const query = db.collection(COL.USERS);
    const snap = await query.get();
    _users = snap.docs.map(doc => {
      const data = doc.data() || {};
      return String(data.usuario || data.nombreCompleto || data.nombre || data.email || doc.id || '').trim().toUpperCase();
    }).filter(Boolean);
    _users = Array.from(new Set(_users)).sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.warn('[app-alertas] usuarios:', error);
    _users = [];
  }
}

async function _loadTemplates() {
  try {
    _templates = await obtenerPlantillasAlerta() || [];
  } catch (error) {
    console.warn('[app-alertas] plantillas:', error);
    _templates = [];
  }
}

async function _loadEditAlert(id) {
  try {
    const all = _history.length ? _history : await obtenerTodasLasAlertas();
    _history = all || [];
    const alert = _history.find(item => String(item.id) === String(id));
    if (!alert) throw new Error('No encontre la alerta para editar.');
    _fillForm(alert);
  } catch (error) {
    _toast(error?.message || 'No se pudo cargar la alerta para editar.', 'error');
    _prepareEditor();
  }
}

function _historyCacheKey() {
  return 'mex.app.alertas.history.visible';
}

function _paintCachedHistory() {
  try {
    const raw = localStorage.getItem(_historyCacheKey()) || sessionStorage.getItem(_historyCacheKey());
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.items)) return;
    _history = parsed.items;
    _renderHistoryList();
  } catch (_) {}
}

async function _loadHistory() {
  const list = q('#listaHistorialAlertas');
  if (list && !_history.length) {
    list.innerHTML = '<div class="app-alertas-loading"><span class="material-symbols-outlined">sync</span> Cargando historial...</div>';
  }
  try {
    _history = (await obtenerTodasLasAlertas() || []).map(item => ({
      ...item,
      mensaje: _sanitizeMessage(item.mensaje || '')
    }));
    try {
      const payload = JSON.stringify({ at: Date.now(), items: _history.slice(0, 100) });
      localStorage.setItem(_historyCacheKey(), payload);
      sessionStorage.setItem(_historyCacheKey(), payload);
    } catch (_) {}
    _renderHistoryList();
  } catch (error) {
    if (list) list.innerHTML = '<div class="app-alertas-empty is-error">No se pudo cargar el historial.</div>';
    _toast('No se pudo cargar el historial de alertas.', 'error');
  }
}

function _prepareEditor() {
  _editingId = '';
  _destMode = 'GLOBAL';
  _selectedDest = [];
  _plazaScope = '';
  q('#alertaNuevaTipo').value = 'URGENTE';
  q('#alertaAutorModo').value = 'CURRENT';
  q('#alertaAutorCustom').value = '';
  q('#alertaBannerCustomToggle').checked = false;
  q('#alertaNuevaTitulo').value = '';
  q('#alertaNuevaImagen').value = '';
  q('#alertaEditorCuerpo').innerHTML = '';
  q('#alertaActionType').value = 'NONE';
  q('#alertaActionLabel').value = '';
  q('#alertaActionValue').value = '';
  q('#alertaActionExtra').value = '';
  _setDestMode('GLOBAL');
  _selectModo('INTERRUPTIVA');
  _updateAuthorUi();
  _updateBannerUi();
  _updateActionFields(true);
  _updateTitle();
}

function _fillForm(alert = {}) {
  _editingId = String(alert.id || '');
  q('#alertaNuevaTipo').value = String(alert.tipo || 'URGENTE').toUpperCase();
  q('#alertaNuevaTitulo').value = alert.titulo || '';
  q('#alertaNuevaImagen').value = alert.imagen || '';
  q('#alertaEditorCuerpo').innerHTML = _sanitizeMessage(alert.mensaje || '');
  const mode = _normalizeAuthorMode(alert.authorMode || alert.autorModo || alert.author?.mode || (alert.authorValue ? 'CUSTOM' : 'CURRENT'));
  q('#alertaAutorModo').value = mode;
  q('#alertaAutorCustom').value = mode === 'CUSTOM' ? String(alert.authorValue || alert.autorValor || alert.author?.value || alert.autor || '') : '';
  _setBannerForm(alert.banner || {}, alert.tipo || 'URGENTE');
  _setActionForm(alert.cta || {});
  _setDestMode(_inferDestMode(alert));
  _selectedDest = _parseCsv(alert.destinatarios).filter(item => item !== 'GLOBAL');
  _plazaScope = String(alert.plaza || '').trim().toUpperCase();
  if (q('#alertaPlazaScope')) q('#alertaPlazaScope').value = _plazaScope;
  _renderDestinations();
  _selectModo(alert.modo || 'INTERRUPTIVA');
  _updateAuthorUi();
  _updateTitle();
  _updatePreview();
}

function _updateTitle() {
  const title = q('#tituloModalCrearAlerta');
  if (title) title.textContent = _editingId ? 'Editar alerta maestra' : 'Emitir alerta maestra';
  const txt = q('#txtBtnEmitir');
  if (txt) txt.textContent = _editingId ? 'Guardar cambios' : 'Emitir a toda la red';
}

function _renderTemplates() {
  const select = q('#alertaPlantillasSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Cargar plantilla...</option>' +
    _templates.map(item => `<option value="${esc(item.id)}">${esc(item.nombre || 'Plantilla')}</option>`).join('');
}

function _renderDestinations() {
  const list = q('#destListaCheckboxes');
  const solo = q('#destSoloUsuario');
  if (!list || !solo) return;
  if (!_users.length) {
    list.innerHTML = '<div class="app-alertas-muted">No hay usuarios cargados.</div>';
    solo.innerHTML = '<option value="">No hay usuarios disponibles</option>';
    return;
  }
  const selected = new Set(_selectedDest);
  list.innerHTML = _users.map(user => `
    <label data-user-search="${esc(user.toLowerCase())}">
      <input type="checkbox" data-dest-user="${esc(user)}" ${selected.has(user) ? 'checked' : ''}>
      <span>${esc(user)}</span>
    </label>
  `).join('');
  solo.innerHTML = '<option value="">Seleccionar usuario...</option>' +
    _users.map(user => `<option value="${esc(user)}">${esc(user)}</option>`).join('');
  solo.value = _destMode === 'SOLO' ? (_selectedDest[0] || '') : '';
  _filterDestinations();
}

function _filterDestinations() {
  const term = String(q('#destBuscadorUsuarios')?.value || '').toLowerCase().trim();
  qa('#destListaCheckboxes label[data-user-search]').forEach(row => {
    row.style.display = !term || row.dataset.userSearch.includes(term) ? 'flex' : 'none';
  });
}

function _setDestMode(mode) {
  _destMode = ['GLOBAL', 'SEL', 'SOLO'].includes(String(mode || '').toUpperCase()) ? String(mode).toUpperCase() : 'GLOBAL';
  if (_destMode === 'GLOBAL') _selectedDest = [];
  if (_destMode === 'SOLO' && _selectedDest.length > 1) _selectedDest = _selectedDest.slice(0, 1);
  const panels = {
    GLOBAL: null,
    SEL: q('#destPanelSel'),
    SOLO: q('#destPanelSolo')
  };
  q('#destPanelSel')?.classList.toggle('is-open', _destMode === 'SEL');
  q('#destPanelSolo')?.classList.toggle('is-open', _destMode === 'SOLO');
  ['Global', 'Sel', 'Solo'].forEach(key => {
    q(`#destBtn${key}`)?.classList.toggle('is-active', key.toUpperCase() === _destMode || (key === 'Sel' && _destMode === 'SEL'));
  });
  if (panels[_destMode]) panels[_destMode].classList.add('is-open');
  _renderDestinations();
  _updatePreview();
}

function _selectModo(mode) {
  const normalized = _normalizeMode(mode);
  q('#alertaModoActual').value = normalized;
  q('#modoCardInterr')?.classList.toggle('is-active', normalized === 'INTERRUPTIVA');
  q('#modoCardPasiva')?.classList.toggle('is-active', normalized === 'PASIVA');
  _updatePreview();
}

function _updateAuthorUi() {
  const custom = q('#alertaAutorCustom');
  if (custom) custom.style.display = _normalizeAuthorMode(q('#alertaAutorModo')?.value) === 'CUSTOM' ? 'block' : 'none';
}

function _updateBannerUi() {
  const custom = !!q('#alertaBannerCustomToggle')?.checked;
  q('#alertaBannerCustomWrap')?.classList.toggle('is-open', custom);
  if (!custom) {
    const meta = _typeMeta(q('#alertaNuevaTipo')?.value);
    if (q('#alertaBannerBg')) q('#alertaBannerBg').value = meta.bg;
    if (q('#alertaBannerText')) q('#alertaBannerText').value = meta.color;
    if (q('#alertaBannerLabel')) q('#alertaBannerLabel').value = '';
  }
}

function _updateActionFields(forceDefaults = false) {
  const action = _getActionForm();
  const meta = ALERTA_ACTION_META[action.type] || ALERTA_ACTION_META.NONE;
  q('#alertaActionConfig')?.classList.toggle('is-open', action.type !== 'NONE');
  if (q('#alertaActionValueCaption')) q('#alertaActionValueCaption').textContent = meta.valueLabel;
  if (q('#alertaActionValue')) q('#alertaActionValue').placeholder = meta.valuePlaceholder;
  if (q('#alertaActionExtraCaption')) q('#alertaActionExtraCaption').textContent = meta.extraLabel || 'Dato extra';
  if (q('#alertaActionExtra')) q('#alertaActionExtra').placeholder = meta.extraPlaceholder;
  if (q('#alertaActionHelp')) q('#alertaActionHelp').textContent = meta.help;
  q('#alertaActionExtraWrap')?.classList.toggle('is-hidden', !meta.extraLabel);
  if (forceDefaults && action.type !== 'NONE' && q('#alertaActionLabel') && !q('#alertaActionLabel').value.trim()) {
    q('#alertaActionLabel').value = meta.defaultLabel;
  }
}

function _updatePreview() {
  if (_mode !== 'emitir') return;
  _updateAuthorUi();
  _updateBannerUi();
  _updateActionFields(false);
  const form = _getForm();
  const typeMeta = _typeMeta(form.tipo);
  const modeMeta = _modeMeta(form.modo);
  const banner = form.banner;
  const stats = _stats(form.mensaje);
  const dest = _destSummary();
  const now = _timeNow();
  const badge = q('#alertaPreviewBadge');
  if (badge) {
    badge.textContent = banner.label;
    badge.style.background = banner.bg;
    badge.style.color = banner.color;
  }
  const modeBadge = q('#alertaPreviewModoBadge');
  if (modeBadge) {
    modeBadge.textContent = modeMeta.label;
    modeBadge.style.background = modeMeta.bg;
    modeBadge.style.color = modeMeta.color;
  }
  if (q('#alertaPreviewTitulo')) q('#alertaPreviewTitulo').textContent = form.titulo || 'Sin titulo';
  if (q('#alertaPreviewMensaje')) {
    q('#alertaPreviewMensaje').innerHTML = form.mensaje || '<span class="alerta-empty-state">Escribe aqui el texto de la alerta. La vista previa se actualiza al instante.</span>';
  }
  if (q('#alertaPreviewHora')) q('#alertaPreviewHora').textContent = now;
  if (q('#alertaPreviewStats')) q('#alertaPreviewStats').textContent = `${stats.words} palabras · ${stats.chars} caracteres`;
  if (q('#alertaEditorStats')) q('#alertaEditorStats').textContent = `${stats.words} palabras · ${stats.chars} caracteres`;
  if (q('#alertaPreviewHoraStatus')) q('#alertaPreviewHoraStatus').textContent = `Ultima vista previa: ${now}`;
  if (q('#alertaPreviewSyncLabel')) q('#alertaPreviewSyncLabel').textContent = stats.chars ? `Preview sincronizado ${now}` : 'Preview sincronizado';
  const scopeLabel = form.plazaScope ? `Solo plaza ${form.plazaScope}` : 'Toda la empresa';
  const modeLabel = form.modo === 'PASIVA' ? 'Alerta pasiva en campana' : 'Mensaje interruptivo para lectura obligatoria';
  if (q('#alertaPreviewSubline')) q('#alertaPreviewSubline').textContent = `${modeLabel} · ${scopeLabel}`;
  if (q('#alertaPreviewDestinatarios')) {
    q('#alertaPreviewDestinatarios').innerHTML = `<span class="material-symbols-outlined">${esc(dest.icon)}</span>${esc(dest.label)}`;
    q('#alertaPreviewDestinatarios').title = dest.detail;
  }
  if (q('#alertaEditorDestinos')) {
    q('#alertaEditorDestinos').innerHTML = `<span class="material-symbols-outlined">${esc(dest.icon)}</span><span>${esc(dest.label)}</span>`;
    q('#alertaEditorDestinos').title = dest.detail;
  }
  if (q('#alertaPreviewAutor')) q('#alertaPreviewAutor').textContent = form.author.visible || '';
  q('#alertaPreviewAuthorWrap')?.classList.toggle('is-hidden', !form.author.visible);
  const previewBanner = q('#alertaPreviewBanner');
  if (previewBanner) {
    if (form.imagen && _safeUrl(form.imagen, true)) {
      previewBanner.style.backgroundImage = `url('${_safeCssUrl(form.imagen)}')`;
      previewBanner.style.display = 'block';
    } else {
      previewBanner.style.backgroundImage = '';
      previewBanner.style.display = 'none';
    }
  }
  _renderActionPreview(form.cta, typeMeta.color);
  _updateTitle();
}

function _getForm() {
  const tipo = String(q('#alertaNuevaTipo')?.value || 'URGENTE').toUpperCase();
  const modo = _normalizeMode(q('#alertaModoActual')?.value || 'INTERRUPTIVA');
  const mensaje = _sanitizeMessage(q('#alertaEditorCuerpo')?.innerHTML || '');
  const action = _getActionForm();
  const author = _getAuthorForm();
  const banner = _getBannerForm(tipo);
  let destinatarios = 'GLOBAL';
  if (_destMode === 'SEL') destinatarios = _selectedDest.join(', ');
  if (_destMode === 'SOLO') destinatarios = _selectedDest[0] || '';
  return {
    tipo,
    modo,
    titulo: String(q('#alertaNuevaTitulo')?.value || '').trim(),
    imagen: String(q('#alertaNuevaImagen')?.value || '').trim(),
    mensaje,
    cta: action,
    author,
    banner,
    destinatarios,
    destMode: _destMode,
    plazaScope: _plazaScope
  };
}

function _getAuthorForm() {
  const mode = _normalizeAuthorMode(q('#alertaAutorModo')?.value || 'CURRENT');
  const value = String(q('#alertaAutorCustom')?.value || '').trim();
  return {
    mode,
    value: mode === 'CUSTOM' ? value : '',
    visible: mode === 'NONE' ? '' : (mode === 'CUSTOM' ? value : _actorName())
  };
}

function _getBannerForm(tipo = 'INFO') {
  const meta = _typeMeta(tipo);
  if (!q('#alertaBannerCustomToggle')?.checked) {
    return { label: meta.label, bg: meta.bg, color: meta.color, custom: false };
  }
  return {
    label: String(q('#alertaBannerLabel')?.value || '').trim() || meta.label,
    bg: _hex(q('#alertaBannerBg')?.value, meta.bg),
    color: _hex(q('#alertaBannerText')?.value, meta.color),
    custom: true
  };
}

function _getActionForm() {
  const rawType = String(q('#alertaActionType')?.value || 'NONE').toUpperCase();
  const type = Object.hasOwn(ALERTA_ACTION_META, rawType) ? rawType : 'NONE';
  if (type === 'NONE') return { type: 'NONE', label: '', value: '', extra: '' };
  return {
    type,
    label: String(q('#alertaActionLabel')?.value || '').trim() || ALERTA_ACTION_META[type].defaultLabel,
    value: String(q('#alertaActionValue')?.value || '').trim(),
    extra: String(q('#alertaActionExtra')?.value || '').trim()
  };
}

function _setActionForm(action = {}) {
  const normalized = _normalizeAction(action);
  q('#alertaActionType').value = normalized.type;
  q('#alertaActionLabel').value = normalized.label || '';
  q('#alertaActionValue').value = normalized.value || '';
  q('#alertaActionExtra').value = normalized.extra || '';
  _updateActionFields(true);
}

function _setBannerForm(banner = {}, tipo = 'INFO') {
  const meta = _typeMeta(tipo);
  const custom = !!(banner.custom || banner.label || banner.bg || banner.color);
  q('#alertaBannerCustomToggle').checked = custom;
  q('#alertaBannerLabel').value = custom ? String(banner.label || meta.label) : '';
  q('#alertaBannerBg').value = _hex(banner.bg, meta.bg);
  q('#alertaBannerText').value = _hex(banner.color, meta.color);
  _updateBannerUi();
}

async function _emitAlert() {
  const form = _getForm();
  const plain = _plainText(form.mensaje);
  if (!form.titulo) return _toast('Escribe el titulo de la alerta.', 'error');
  if (!plain) return _toast('Escribe el cuerpo del mensaje.', 'error');
  if (form.author.mode === 'CUSTOM' && !form.author.value) return _toast('Escribe el autor personalizado.', 'error');
  if (form.destMode === 'SEL' && !_selectedDest.length) return _toast('Selecciona al menos un usuario.', 'error');
  if (form.destMode === 'SOLO' && !_selectedDest[0]) return _toast('Selecciona el usuario destinatario.', 'error');
  if (form.cta.type !== 'NONE' && !form.cta.value) return _toast('Completa el destino del boton de accion.', 'error');

  const btn = q('#btnEmitirAlertaGlobal');
  const previous = btn?.innerHTML || '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined app-alertas-spin">sync</span><span>Guardando...</span>';
  }

  try {
    const actor = _actorName();
    const result = _editingId
      ? await actualizarAlertaMaestra(_editingId, {
        tipo: form.tipo,
        titulo: form.titulo,
        mensaje: form.mensaje,
        imagen: form.imagen,
        modo: form.modo,
        cta: form.cta,
        destinatarios: form.destinatarios,
        destMode: form.destMode,
        author: { mode: form.author.mode, value: form.author.value },
        banner: form.banner,
        plazaScope: form.plazaScope
      }, actor)
      : await emitirNuevaAlertaMaestra(
        form.tipo,
        form.titulo,
        form.mensaje,
        form.imagen,
        actor,
        form.destinatarios,
        form.modo,
        { destMode: form.destMode, cta: form.cta, author: { mode: form.author.mode, value: form.author.value }, banner: form.banner, plazaScope: form.plazaScope }
      );
    if (result !== 'EXITO') throw new Error(String(result || 'No se pudo guardar la alerta.'));
    _toast(_editingId ? 'Alerta actualizada correctamente.' : 'Alerta emitida a la red.', 'success');
    _history = [];
    if (!_editingId) _prepareEditor();
    _ctx?.navigate?.('/app/alertas/historial');
  } catch (error) {
    _toast(error?.message || 'No se pudo guardar la alerta.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = previous;
      _updateTitle();
    }
  }
}

async function _saveTemplate() {
  const form = _getForm();
  if (!form.titulo && !_plainText(form.mensaje)) return _toast('Primero disena la alerta antes de guardarla como plantilla.', 'error');
  const name = await _mexPrompt('Guardar plantilla', 'Nombre para la plantilla:', 'Nombre de plantilla', 'text', form.titulo ? `Plantilla ${form.titulo}` : 'Nueva plantilla');
  if (!name || !String(name).trim()) return;
  try {
    const result = await guardarPlantillaAlerta(String(name).trim(), form.tipo, form.titulo || 'Sin titulo', form.mensaje, form.modo, _actorName(), {
      imagen: form.imagen,
      cta: form.cta,
      author: { mode: form.author.mode, value: form.author.value },
      banner: form.banner
    });
    if (result !== 'EXITO') throw new Error(String(result || 'No se pudo guardar la plantilla.'));
    await _loadTemplates();
    _renderTemplates();
    _toast('Plantilla guardada.', 'success');
  } catch (error) {
    _toast(error?.message || 'No se pudo guardar la plantilla.', 'error');
  }
}

function _loadTemplateIntoForm(id) {
  const template = _templates.find(item => String(item.id) === String(id));
  if (!template) return;
  q('#alertaNuevaTipo').value = template.tipo || 'INFO';
  q('#alertaNuevaTitulo').value = template.titulo || '';
  q('#alertaNuevaImagen').value = template.imagen || '';
  q('#alertaEditorCuerpo').innerHTML = _sanitizeMessage(template.mensaje || '');
  q('#alertaAutorModo').value = _normalizeAuthorMode(template.authorMode || template.autorModo || template.author?.mode || 'CURRENT');
  q('#alertaAutorCustom').value = template.authorValue || template.autorValor || template.author?.value || '';
  _setBannerForm(template.banner || {}, template.tipo || 'INFO');
  _setActionForm(template.cta || {});
  _selectModo(template.modo || 'INTERRUPTIVA');
  _updatePreview();
}

function _renderHistoryList() {
  const list = q('#listaHistorialAlertas');
  const stats = q('#alertaHistStatsBar');
  if (!list || !stats) return;
  const term = String(_historyFilter.q || '').toLowerCase().trim();
  const tipo = String(_historyFilter.tipo || '').toUpperCase().trim();
  const modo = String(_historyFilter.modo || '').toUpperCase().trim();
  const filtered = _history.filter(alert => {
    const text = [
      alert.titulo,
      alert.actor,
      alert.autor,
      alert.fecha,
      _plainText(alert.mensaje),
      _destSummaryForAlert(alert).detail
    ].join(' ').toLowerCase();
    return (!term || text.includes(term)) &&
      (!tipo || String(alert.tipo || '').toUpperCase() === tipo) &&
      (!modo || _normalizeMode(alert.modo) === modo);
  });
  const interruptivas = _history.filter(a => _normalizeMode(a.modo) === 'INTERRUPTIVA').length;
  const pasivas = _history.length - interruptivas;
  stats.innerHTML = `
    <span>${_history.length} TOTAL</span>
    <span>${filtered.length} FILTRADAS</span>
    <span>${interruptivas} INTERRUPTIVAS</span>
    <span>${pasivas} PASIVAS</span>
  `;
  if (!filtered.length) {
    list.innerHTML = '<div class="app-alertas-empty">No hay alertas que coincidan con los filtros actuales.</div>';
    return;
  }
  list.innerHTML = filtered.map(alert => _renderHistoryCard(alert)).join('');
}

function _renderHistoryCard(alert = {}) {
  const typeMeta = _typeMeta(alert.tipo);
  const modeMeta = _modeMeta(alert.modo);
  const banner = _bannerForAlert(alert);
  const readers = _parseCsv(alert.leidoPor);
  const dest = _destSummaryForAlert(alert);
  const author = _authorForAlert(alert, '');
  const img = alert.imagen && _safeUrl(alert.imagen, true)
    ? `<div class="app-alertas-card-image" style="background-image:url('${_safeCssUrl(alert.imagen)}')"></div>`
    : '';
  return `
    <article class="app-alertas-history-card">
      <header>
        <div class="app-alertas-history-badges">
          <span style="background:${esc(banner.bg)};color:${esc(banner.color)}">${esc(banner.label)}</span>
          <span style="background:${esc(modeMeta.bg)};color:${esc(modeMeta.color)}">${esc(modeMeta.label)}</span>
          <span style="background:${esc(typeMeta.selectBg)};color:${esc(typeMeta.color)}">BASE ${esc(typeMeta.label)}</span>
          <span>${esc(dest.label)}</span>
        </div>
        <div class="app-alertas-card-date">
          <strong>${esc(alert.fecha || 'Sin fecha')}</strong>
          <small>${readers.length} lectura${readers.length === 1 ? '' : 's'}</small>
        </div>
      </header>
      ${img}
      <div class="app-alertas-card-body">
        <div>
          <h2>${esc(alert.titulo || 'Sin titulo')}</h2>
          <p>${author ? `Emitida como ${esc(author)}` : 'Sin autor visible'}</p>
          ${alert.actor ? `<p>Publicada por ${esc(alert.actor)}</p>` : ''}
          ${alert.editadoEn ? `<p>Editada por ${esc(alert.editadoPor || 'Sistema')} · ${esc(alert.editadoEn)}</p>` : ''}
        </div>
        <aside>
          <span>Alcance</span>
          <strong>${esc(dest.detail)}</strong>
        </aside>
      </div>
      <details>
        <summary>Ver cuerpo completo</summary>
        <div class="app-alertas-history-message">${_sanitizeMessage(alert.mensaje || '') || '<span>Sin contenido.</span>'}</div>
      </details>
      <footer>
        <button type="button" data-alert-action="readers-alert" data-id="${esc(alert.id)}"><span class="material-symbols-outlined">visibility</span> Leido por ${readers.length}</button>
        <button type="button" data-alert-action="edit-alert" data-id="${esc(alert.id)}"><span class="material-symbols-outlined">edit</span> Editar</button>
        <button type="button" class="is-danger" data-alert-action="delete-alert" data-id="${esc(alert.id)}"><span class="material-symbols-outlined">delete</span> Borrar</button>
      </footer>
    </article>
  `;
}

function _clearHistoryFilters() {
  _historyFilter = { q: '', tipo: '', modo: '' };
  if (q('#alertaHistBuscador')) q('#alertaHistBuscador').value = '';
  if (q('#alertaHistTipo')) q('#alertaHistTipo').value = '';
  if (q('#alertaHistModo')) q('#alertaHistModo').value = '';
  _renderHistoryList();
}

async function _deleteAlert(id) {
  const alert = _history.find(item => String(item.id) === String(id));
  if (!alert) return;
  if (!await _mexConfirm('Borrar alerta', `¿Borrar la alerta "${alert.titulo || id}" definitivamente?`, 'danger')) return;
  try {
    const result = await eliminarAlertaMaestraBackend(id, _actorName());
    if (result !== 'EXITO') throw new Error(String(result || 'No se pudo borrar la alerta.'));
    _toast('Alerta eliminada.', 'success');
    await _loadHistory();
  } catch (error) {
    _toast(error?.message || 'No se pudo borrar la alerta.', 'error');
  }
}

function _showReaders(id) {
  const alert = _history.find(item => String(item.id) === String(id));
  const readers = _parseCsv(alert?.leidoPor);
  const text = readers.length ? `Han confirmado:\n\n- ${readers.join('\n- ')}` : 'Nadie ha confirmado la lectura aun.';
  _mexAlert('Reporte de lecturas', text, 'info');
}

function _execCommand(cmd, value = null) {
  const editor = q('#alertaEditorCuerpo');
  if (!editor) return;
  _restoreSelection();
  try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
  if (cmd === 'removeFormat') {
    document.execCommand('removeFormat', false, null);
    document.execCommand('unlink', false, null);
  } else {
    document.execCommand(cmd, false, value);
  }
  _saveSelection();
  _updatePreview();
}

async function _insertLink() {
  _saveSelection();
  const url = await _mexPrompt('Insertar enlace', 'Enlace para insertar:', 'https://', 'url', 'https://');
  if (!url || !String(url).trim()) return;
  const normalized = _normalizeUrl(url);
  if (!_safeUrl(normalized)) return _toast('Ese enlace no es valido.', 'error');
  _execCommand('createLink', normalized);
}

function _insertHtml(html = '') {
  const editor = q('#alertaEditorCuerpo');
  if (!editor || !String(html).trim()) return;
  _restoreSelection();
  try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
  document.execCommand('insertHTML', false, html);
  _saveSelection();
  _updatePreview();
}

function _saveSelection() {
  const editor = q('#alertaEditorCuerpo');
  const sel = window.getSelection();
  if (!editor || !sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (editor.contains(range.commonAncestorContainer)) _selectionRange = range.cloneRange();
}

function _restoreSelection() {
  const editor = q('#alertaEditorCuerpo');
  const sel = window.getSelection();
  if (!editor || !sel) return;
  editor.focus();
  if (_selectionRange) {
    sel.removeAllRanges();
    sel.addRange(_selectionRange);
  }
}

async function _compressHeaderImage(file) {
  if (!file) return;
  const label = q('#textoUploadAlerta');
  if (label) label.textContent = 'Procesando...';
  try {
    const base64 = await _compressImage(file, { maxWidth: 900, quality: 0.62 });
    const blob = await (await fetch(base64)).blob();
    const { uploadMedia } = await import('/js/core/media-upload.js');
    const uploaded = await uploadMedia({
      folder: 'alertas',
      file: blob,
      publicId: `header_${Date.now()}`,
      resourceType: 'image',
    });
    q('#alertaNuevaImagen').value = uploaded.url;
    if (label) label.textContent = 'Imagen cargada lista para enviar';
    _updatePreview();
  } catch (error) {
    if (label) label.textContent = 'No se pudo procesar la imagen';
    _toast('No se pudo procesar la imagen.', 'error');
  }
}

function _clearHeaderImage() {
  if (q('#alertaFile')) q('#alertaFile').value = '';
  if (q('#alertaNuevaImagen')) q('#alertaNuevaImagen').value = '';
  if (q('#textoUploadAlerta')) q('#textoUploadAlerta').textContent = 'Seleccionar imagen...';
  _updatePreview();
}

async function _insertBodyImage(file, input) {
  if (!file) return;
  try {
    const base64 = await _compressImage(file, { maxWidth: 1100, quality: 0.7 });
    const blob = await (await fetch(base64)).blob();
    const { uploadMedia } = await import('/js/core/media-upload.js');
    const uploaded = await uploadMedia({
      folder: 'alertas',
      file: blob,
      publicId: `body_${Date.now()}`,
      resourceType: 'image',
    });
    const alt = esc((file.name || 'Imagen alerta').replace(/\.[^.]+$/, ''));
    _insertHtml(`<div style="text-align:center; margin:14px 0;"><img src="${esc(uploaded.url)}" alt="${alt}" style="display:block; max-width:100%; width:auto; margin:0 auto; border-radius:18px;"></div>`);
  } catch (error) {
    _toast('No se pudo insertar la imagen.', 'error');
  } finally {
    if (input) input.value = '';
  }
}

function _compressImage(file, options = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = event => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
      img.onload = () => {
        const maxWidth = Number(options.maxWidth || 1000);
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', Number(options.quality || 0.68)));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function _sanitizeMessage(html = '') {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  const allowed = new Set(['B', 'I', 'U', 'STRONG', 'EM', 'BR', 'DIV', 'P', 'SPAN', 'UL', 'OL', 'LI', 'A', 'FONT', 'IMG', 'HR', 'SUB', 'SUP']);
  const clean = node => {
    Array.from(node.children || []).forEach(child => {
      const tag = child.tagName;
      if (!allowed.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes));
        return;
      }
      clean(child);
      Array.from(child.attributes || []).forEach(attr => {
        const name = attr.name.toLowerCase();
        if (tag === 'A' && name === 'href') {
          const href = _normalizeUrl(attr.value);
          if (_safeUrl(href)) {
            child.setAttribute('href', href);
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener noreferrer');
          } else child.removeAttribute(attr.name);
          return;
        }
        if (tag === 'IMG' && name === 'src') {
          if (_safeUrl(attr.value, true)) return;
          child.remove();
          return;
        }
        if (tag === 'IMG' && name === 'alt') return;
        if (tag === 'FONT' && ['color', 'size'].includes(name)) return;
        if (name === 'style') {
          const safe = String(attr.value || '').split(';').map(rule => {
            const [propRaw, valueRaw] = rule.split(':');
            const prop = String(propRaw || '').trim().toLowerCase();
            const value = String(valueRaw || '').trim();
            if (!prop || !value) return '';
            if (['color', 'background-color', 'text-align', 'font-weight', 'font-style', 'text-decoration'].includes(prop)) return `${prop}:${value}`;
            if (prop === 'font-size' && /^(\d{1,2}px|\d{1,3}%|small|medium|large|x-large)$/i.test(value)) return `${prop}:${value}`;
            return '';
          }).filter(Boolean).join('; ');
          if (safe) child.setAttribute('style', safe);
          else child.removeAttribute(attr.name);
          return;
        }
        child.removeAttribute(attr.name);
      });
    });
  };
  clean(template.content);
  return template.innerHTML.trim();
}

function _plainText(html = '') {
  const div = document.createElement('div');
  div.innerHTML = _sanitizeMessage(html);
  return String(div.textContent || div.innerText || '').trim().replace(/\s+/g, ' ');
}

function _stats(html = '') {
  const text = _plainText(html);
  return {
    chars: text.length,
    words: text ? text.split(/\s+/).length : 0
  };
}

function _parseCsv(value = '') {
  return String(value || '').split(',').map(item => item.trim().toUpperCase()).filter(Boolean);
}

function _typeMeta(type) {
  return ALERTA_TIPO_META[String(type || '').toUpperCase()] || ALERTA_TIPO_META.INFO;
}

function _normalizeMode(mode) {
  return String(mode || '').toUpperCase() === 'PASIVA' ? 'PASIVA' : 'INTERRUPTIVA';
}

function _modeMeta(mode) {
  return ALERTA_MODO_META[_normalizeMode(mode)];
}

function _normalizeAuthorMode(mode) {
  const value = String(mode || '').toUpperCase();
  return value === 'NONE' || value === 'CUSTOM' ? value : 'CURRENT';
}

function _normalizeAction(action = {}) {
  const rawType = String(action.type || action.tipo || '').toUpperCase();
  const type = Object.hasOwn(ALERTA_ACTION_META, rawType) ? rawType : 'NONE';
  if (type === 'NONE') return { type: 'NONE', label: '', value: '', extra: '' };
  return {
    type,
    label: String(action.label || action.texto || action.text || '').trim(),
    value: String(action.value || action.url || action.telefono || action.contenido || '').trim(),
    extra: String(action.extra || action.mensaje || action.helper || '').trim()
  };
}

function _normalizeUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^(https?:\/\/|mailto:|tel:)/i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, '')}`;
}

function _safeUrl(url = '', allowDataImage = false) {
  const value = String(url || '').trim();
  if (!value) return false;
  if (allowDataImage && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value)) return true;
  return /^(https?:\/\/|mailto:|tel:)/i.test(value);
}

function _safeCssUrl(url = '') {
  return String(url || '').replace(/'/g, '%27');
}

function _hex(color = '', fallback = '#1d4ed8') {
  const clean = String(color || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(clean)) return clean;
  if (/^#[0-9a-f]{3}$/i.test(clean)) return clean.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3');
  return fallback;
}

function _timeNow() {
  return new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function _authorForAlert(alert = {}, fallback = _actorName()) {
  const mode = _normalizeAuthorMode(alert.authorMode || alert.autorModo || alert.author?.mode);
  const value = String(alert.authorValue || alert.autorValor || alert.author?.value || alert.autor || '').trim();
  if (mode === 'NONE') return '';
  if (mode === 'CUSTOM') return value;
  return value || String(alert.actor || alert.emitidoPor || fallback || '').trim();
}

function _bannerForAlert(alert = {}) {
  const meta = _typeMeta(alert.tipo);
  const banner = alert.banner || {};
  return {
    label: String(banner.label || meta.label).trim(),
    bg: _hex(banner.bg, meta.bg),
    color: _hex(banner.color, meta.color),
    custom: !!banner.custom
  };
}

function _inferDestMode(alert = {}) {
  const mode = String(alert.destMode || '').toUpperCase();
  if (mode === 'SEL' || mode === 'SOLO') return mode;
  const dest = _parseCsv(alert.destinatarios);
  if (!dest.length || dest.includes('GLOBAL')) return 'GLOBAL';
  return dest.length === 1 ? 'SOLO' : 'SEL';
}

function _destSummary() {
  if (_destMode === 'SEL') {
    return {
      icon: 'group',
      label: _selectedDest.length ? `${_selectedDest.length} usuarios` : 'Selecciona usuarios',
      detail: _selectedDest.length ? _selectedDest.join(', ') : 'Sin destinatarios seleccionados'
    };
  }
  if (_destMode === 'SOLO') {
    return {
      icon: 'person',
      label: _selectedDest[0] || 'Selecciona usuario',
      detail: _selectedDest[0] || 'Sin destinatario seleccionado'
    };
  }
  return { icon: 'public', label: 'GLOBAL', detail: 'Toda la red' };
}

function _destSummaryForAlert(alert = {}) {
  const dest = _parseCsv(alert.destinatarios);
  const mode = _inferDestMode(alert);
  if (mode === 'GLOBAL') return { label: 'GLOBAL', detail: 'Toda la red' };
  if (mode === 'SOLO') return { label: dest[0] || 'SOLO', detail: dest[0] || 'Un usuario' };
  return { label: `${dest.length} USUARIOS`, detail: dest.join(', ') };
}

function _renderActionPreview(action = {}, color = '#1a73e8') {
  const normalized = _normalizeAction(action);
  const wrap = q('#alertaPreviewActionWrap');
  const btn = q('#alertaPreviewActionBtn');
  const hint = q('#alertaPreviewActionHint');
  if (!wrap || !btn || !hint) return;
  wrap.style.display = normalized.type === 'NONE' ? 'none' : 'flex';
  if (normalized.type === 'NONE') return;
  const meta = ALERTA_ACTION_META[normalized.type] || ALERTA_ACTION_META.URL;
  btn.style.background = color;
  btn.innerHTML = `<span class="material-symbols-outlined">${esc(meta.icon)}</span><span>${esc(normalized.label || meta.defaultLabel)}</span>`;
  hint.textContent = normalized.extra || meta.help;
}
