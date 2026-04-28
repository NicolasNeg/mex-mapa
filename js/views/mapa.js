// ═══════════════════════════════════════════════════════════
//  js/views/mapa.js  —  ES6 Module
//  Vista principal: mapa visual de flota.
//
//  Depende de:
//   - firebase-init.js (cargado como <script> antes que este módulo)
//   - mex-api.js      (cargado como <script>, expone window.api)
//   - database.js     (ES6 module, re-exporta auth/db/COL)
// ═══════════════════════════════════════════════════════════
let _bannerState = { bloqueado: false, pctOcup: 0, alertasCriticas: 0 };
let _supervisionData = {}; // { [plaza]: { total, listos, sucios, manto, taller, traslados } }
let PLAZA_ACTIVA_MAPA = ''; // declarada al top para evitar TDZ en inicializarConfiguracion

import { db, auth, COL, ACCESS_ROLE_META } from '/js/core/database.js';
import {
  configureNotifications,
  initNotificationCenter,
  teardownNotificationCenter,
  consumeNotificationDeepLink,
  openNotificationCenter,
  closeNotificationCenter,
  requestDeviceNotifications,
  getCurrentDeviceSnapshot,
  updateCurrentDevicePreferences,
  syncCurrentDeviceContext
} from '/js/core/notifications.js';
import { installProgrammerErrorReporter, reportProgrammerError } from '/js/core/observability.js';
import { initErrorTracking, setErrorUser, captureError } from '/js/core/error-tracking.js';
import { initPwaInstall }  from '/js/core/pwa-install.js';
import * as _pdfReservas   from '/js/features/cuadre/pdf-reservas.js';
import * as _prediccion    from '/js/features/cuadre/prediccion.js';
import { normalizarUnidad } from '/domain/unidad.model.js';
import { normalizarElemento } from '/domain/mapa.model.js';
import { buildMapaViewModel, buildUnitViewModel } from '/mapa/mapa-view-model.js';
import { renderSidebarHTML, bindSidebarShell, displayUserName, roleLabel, consumeShellSearch, ensureRouteShellLayout, queueShellSearch } from '/js/views/home.js';

// Acceso al API legacy (mex-api.js lo expone en window.api)
const api = window.api;

// dialogs.js se carga como <script> antes que este módulo; en ES modules el
// scope global no se accede por nombre sin prefijo, así que capturamos aquí.
const mexConfirm = (...a) => (window.mexConfirm || (() => Promise.resolve(true)))(...a);
const mexDialog  = (...a) => (window.mexDialog  || (() => Promise.resolve(null)))(...a);

const APP_DEFAULT_COMPANY_NAME = 'EMPRESA';
const USER_PRESENCE_HEARTBEAT_MS = 45000;
const USER_PRESENCE_STALE_MS = 120000;
const APP_AVATAR_COLORS = ['#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#3182ce', '#805ad5', '#d53f8c', '#00b5d8', '#e36112', '#2f855a'];
const APP_BUILD_TAG = 'mapa-v79';
const ADMIN_LOCATION_CACHE_MS = 90000;
const STANDALONE_ROUTE_RE = /^\/(?:editmap|profile)(?:\/|$)/i;
const SHOULD_SKIP_MAIN_MAP_BOOTSTRAP = STANDALONE_ROUTE_RE.test(window.location.pathname || '');
const EDITMAP_STANDALONE_ROUTE_RE = /^\/(?:editmap)(?:\/|$)/i;
const EDITMAP_ACTIVE_PLAZA_KEY = 'mex:last-active-plaza';
const EDITMAP_LAST_ROUTE_PLAZA_KEY = 'mex:last-editmap-plaza';

function _rememberActivePlaza(plaza, options = {}) {
  const { forEditmap = false } = options;
  const normalized = _normalizePlaza(
    typeof window.setMexCurrentPlaza === 'function'
      ? window.setMexCurrentPlaza(plaza || '', { source: forEditmap ? 'editmap' : 'mapa' })
      : (plaza || '')
  );
  window.__mexCurrentPlazaId = normalized;
  if (normalized) window.PLAZA_ACTIVA_MAPA = normalized;
  try {
    if (normalized) {
      sessionStorage.setItem(EDITMAP_ACTIVE_PLAZA_KEY, normalized);
      if (forEditmap) sessionStorage.setItem(EDITMAP_LAST_ROUTE_PLAZA_KEY, normalized);
    } else {
      sessionStorage.removeItem(EDITMAP_ACTIVE_PLAZA_KEY);
      if (forEditmap) sessionStorage.removeItem(EDITMAP_LAST_ROUTE_PLAZA_KEY);
    }
  } catch (_) { /* noop */ }
  return normalized;
}

function _clearRememberedPlaza() {
  if (typeof window.clearMexCurrentPlaza === 'function') {
    window.clearMexCurrentPlaza({ source: 'mapa' });
  }
  window.__mexCurrentPlazaId = '';
  try {
    sessionStorage.removeItem(EDITMAP_ACTIVE_PLAZA_KEY);
    sessionStorage.removeItem(EDITMAP_LAST_ROUTE_PLAZA_KEY);
  } catch (_) { /* noop */ }
}

function abrirRutaEditmap(plazaOverride = '') {
  const targetPlaza = _rememberActivePlaza(
    plazaOverride || _miPlaza() || currentUserProfile?.plazaAsignada || '',
    { forEditmap: true }
  );
  window.location.href = targetPlaza
    ? `/editmap/${encodeURIComponent(targetPlaza)}`
    : '/editmap';
}


// 1. Blindamos la variable para que NUNCA sea undefined y la app no truene
window.MEX_CONFIG = {
  empresa: { nombre: APP_DEFAULT_COMPANY_NAME },
  listas: {
    ubicaciones: [],
    estados: [],
    gasolinas: [],
    categorias: []
  }
};

// 2. Función que descarga los datos de Firebase en tiempo real
const ESTADOS_DEFAULT = [
  { id: "LISTO", color: "#10b981", orden: 1 },
  { id: "SUCIO", color: "#f59e0b", orden: 2 },
  { id: "MANTENIMIENTO", color: "#ef4444", orden: 3 },
  { id: "RESGUARDO", color: "#64748b", orden: 4 },
  { id: "TRASLADO", color: "#c084fc", orden: 5 },
  { id: "EN RENTA", color: "#38bdf8", orden: 6 },
  { id: "NO ARRENDABLE", color: "#cbd5e1", orden: 7 },
  { id: "HYP", color: "#ef4444", orden: 8 },
  { id: "RETENIDA", color: "#78350f", orden: 92 },
  { id: "VENTA", color: "#1e293b", orden: 93 }
];

function _companyNameFrom(empresaObj = window.MEX_CONFIG?.empresa || {}) {
  return String(empresaObj?.nombre || APP_DEFAULT_COMPANY_NAME).trim() || APP_DEFAULT_COMPANY_NAME;
}

function _setTextById(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

function aplicarVariablesDeEmpresa(empresaObj) {
  if (!empresaObj) return;
  const nombre = _companyNameFrom(empresaObj);
  const color = empresaObj.colorPrincipal || "var(--mex-blue)";

  _setTextById('empresa-cfg-lbl', nombre);
  _setTextById('cfg-footer-company-name', nombre);
  _setTextById('resv2-company-name', nombre);
  _setTextById('chatv2-company-label', nombre);

  if (window.location.pathname.includes('/mapa')) {
    document.title = `Mapa — ${nombre}`;
  }

  document.documentElement.style.setProperty('--mex-blue', color);
}

// ── Aplica los colores de estados desde MEX_CONFIG al CSS de los autos del mapa ──
function _aplicarColoresEstados() {
  const estados = window.MEX_CONFIG?.listas?.estados || [];
  if (estados.length === 0) return;

  // Genera CSS por cada estado configurado
  const css = estados.map(e => {
    const id = typeof e === 'string' ? e : e.id;
    const color = typeof e === 'object' ? (e.color || '#64748b') : '#64748b';
    if (!id) return '';
    // Mismo algoritmo de clase que usa _actualizarNodoUnidadMapa
    const clase = id.toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-');
    // Gradiente basado en el color del estado
    return `.car.${clase} { background: linear-gradient(160deg, ${color} 0%, ${_darken(color, 20)} 100%) !important; }`;
  }).join('\n');

  let styleTag = document.getElementById('mex-estado-colors');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'mex-estado-colors';
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = css;
}

// Oscurece un color hex por un % (0-100)
function _darken(hex, pct) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const r = Math.max(0, parseInt(c.slice(0, 2), 16) - Math.round(2.55 * pct));
  const g = Math.max(0, parseInt(c.slice(2, 4), 16) - Math.round(2.55 * pct));
  const b = Math.max(0, parseInt(c.slice(4, 6), 16) - Math.round(2.55 * pct));
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

async function inicializarConfiguracion() {
  try {
    const plaza = _miPlaza();
    const config = typeof window.__mexEnsureConfigLoaded === 'function'
      ? await window.__mexEnsureConfigLoaded(plaza)
      : await api.obtenerConfiguracion(plaza);

    if (config && config.listas) {
      // Auto-seed estados si Firestore no los tiene
      if (!config.listas.estados || config.listas.estados.length === 0) {
        config.listas.estados = ESTADOS_DEFAULT;
        api.guardarConfiguracionListas(config.listas, 'Sistema', _miPlaza()).catch(e => console.warn("No se pudo guardar estados por defecto:", e));
      }
      window.MEX_CONFIG = config;
      _ensureSecurityConfig();
      console.log("✅ Configuración Global Cargada:", window.MEX_CONFIG);
      aplicarVariablesDeEmpresa(window.MEX_CONFIG.empresa);
      _aplicarColoresEstados();
      if (typeof llenarSelectsDinamicos === 'function') llenarSelectsDinamicos();
      if (typeof _renderPlazaSwitcher === 'function') _renderPlazaSwitcher();
      _syncEmpresaCorreosInternosState();
      _updateGlobalPlazaEmail();
    }
  } catch (error) {
    console.error("❌ Error descargando la configuración:", error);
  }
}

// 3. Le decimos a la app que descargue esto en cuanto cargue la página
if (!SHOULD_SKIP_MAIN_MAP_BOOTSTRAP) {
  document.addEventListener("DOMContentLoaded", () => {
    const ready = window.__mexConfigReadyPromise || Promise.resolve();
    ready.finally(() => {
      inicializarConfiguracion();
    });
  });
}


// ==========================================
// 0. DIÁLOGOS MODALES PERSONALIZADOS
// ==========================================
let modalConfirmCallback = null;

function _ensureCustomModalDom() {
  let modal = document.getElementById('customModal');
  if (modal) return modal;
  if (!document.body) return null;
  modal = document.createElement('div');
  modal.id = 'customModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-box">
      <div class="material-icons modal-icon" id="modalIcon">warning</div>
      <div class="modal-title" id="modalTitle">Confirmación</div>
      <div class="modal-text" id="modalText">¿Estás seguro de continuar?</div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" type="button" onclick="cerrarCustomModal()">CANCELAR</button>
        <button class="modal-btn modal-btn-confirm" type="button" id="modalConfirmBtn">ACEPTAR</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function mostrarCustomModal(titulo, texto, icono, colorIcono, textConfirm, colorBtn, onConfirm) {
  let iconName = icono;
  let iconColor = colorIcono;
  let confirmText = textConfirm;
  let confirmColor = colorBtn;
  let cancelText = 'CANCELAR';
  let confirmHandler = onConfirm;

  if (typeof icono === 'function') {
    confirmHandler = icono;
    iconName = 'tune';
    iconColor = '#2563eb';
    confirmText = colorIcono || 'ACEPTAR';
    cancelText = textConfirm || 'CANCELAR';
    confirmColor = '#2563eb';
  }

  const modal = _ensureCustomModalDom();
  if (!modal) {
    showToast('No se pudo abrir el diálogo de confirmación.', 'error');
    return;
  }

  document.getElementById('modalTitle').innerText = titulo;
  const textEl = document.getElementById('modalText');
  if (/<[a-z][\s\S]*>/i.test(String(texto || ''))) {
    textEl.innerHTML = texto;
  } else {
    textEl.innerText = texto;
  }
  const ic = document.getElementById('modalIcon');
  ic.innerText = iconName || 'warning';
  ic.style.color = iconColor || '#f59e0b';

  const btn = document.getElementById('modalConfirmBtn');
  btn.innerText = confirmText || 'ACEPTAR';
  btn.style.background = confirmColor || '#2563eb';
  const cancelBtn = document.querySelector('#customModal .modal-btn-cancel');
  if (cancelBtn) cancelBtn.innerText = cancelText;

  modalConfirmCallback = confirmHandler;
  modal.classList.add('active');
}

function cerrarCustomModal() {
  const modal = document.getElementById('customModal');
  if (modal) modal.classList.remove('active');
  modalConfirmCallback = null;
}

document.addEventListener('click', async event => {
  const button = event.target?.closest?.('#modalConfirmBtn');
  if (!button) return;
  try {
    if (!modalConfirmCallback) {
      cerrarCustomModal();
      return;
    }
    const shouldClose = await modalConfirmCallback();
    if (shouldClose === false) return;
    cerrarCustomModal();
  } catch (error) {
    console.error('[customModal] confirm error:', error);
    showToast(error?.message || 'No se pudo completar la acción.', 'error');
  }
});

function confirmarCierreSesion() {
  mostrarCustomModal("Cerrar Sesión", "¿Seguro que quieres salir de la consola?", "logout", "#ef4444", "SALIR", "#ef4444", () => {
    cerrarSesion();
  });
}

function confirmarBorradoFlotaUI() {
  if (!SELECT_REF_FLOTA) return;
  mostrarCustomModal(
    "Eliminar Unidad",
    `¿Estás absolutamente seguro de eliminar la unidad ${SELECT_REF_FLOTA.mva}?\nEsta acción no se puede deshacer.`,
    "delete_forever",
    "#dc2626",
    "ELIMINAR",
    "#dc2626",
    ejecutarBorradoReal
  );
}

function _ensureToastContainer() {
  let box = document.getElementById('toastContainer');
  if (box) return box;
  if (!document.body) return null;
  box = document.createElement('div');
  box.id = 'toastContainer';
  document.body.appendChild(box);
  return box;
}

function showToast(msg, type = 'success') {
  const box = _ensureToastContainer();
  if (!box) {
    const method = type === 'error' ? 'error' : 'log';
    console[method]('[toast]', msg);
    return;
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="material-icons">${type === 'success' ? 'check_circle' : 'error'}</span> ${msg}`;
  box.appendChild(t);
  setTimeout(() => { if (t.parentElement) t.remove(); }, 3500);
}


// Variable para saber en qué pestaña estamos
let VISTA_ACTUAL_FLOTA = 'NORMAL';
let DB_ADMINS = []; // Aquí guardaremos los autos de los jefes
let ADMIN_INSERT_UNIT = null;
function _findUbicacionCatalogEntry(ubiNombre, plaza = _miPlaza()) {
  const ubicaciones = Array.isArray(window.MEX_CONFIG?.listas?.ubicaciones)
    ? window.MEX_CONFIG.listas.ubicaciones
    : [];
  const target = String(ubiNombre || '').trim().toUpperCase();
  if (!target) return null;

  const matches = ubicaciones.filter(item => {
    const nombre = typeof item === 'object' ? (item.id || item.nombre) : item;
    return String(nombre || '').trim().toUpperCase() === target;
  });
  if (matches.length === 0) return null;

  const plazaUp = _normalizePlaza(plaza || '');
  const exact = matches.find(item => _safeUpper(typeof item === 'object' ? item.plazaId : '') === plazaUp);
  if (exact) return exact;

  const global = matches.find(item => {
    const scope = _safeUpper(typeof item === 'object' ? item.plazaId : '');
    return !scope || scope === 'ALL';
  });
  return global || matches[0];
}

function _esPlazaFija(ubiNombre) {
  if (!window.MEX_CONFIG || !window.MEX_CONFIG.listas || !window.MEX_CONFIG.listas.ubicaciones) {
    return ['PATIO', 'TALLER', 'AGENCIA', 'TALLER EXTERNO', 'HYP COBIAN'].includes(ubiNombre); // Fallback safe
  }
  const item = _findUbicacionCatalogEntry(ubiNombre);
  if (!item) return ['PATIO', 'TALLER', 'AGENCIA', 'TALLER EXTERNO', 'HYP COBIAN'].includes(ubiNombre);
  return typeof item === 'object' ? item.isPlazaFija : ['PATIO', 'TALLER', 'AGENCIA', 'TALLER EXTERNO', 'HYP COBIAN'].includes(item);
}

function _obtenerPlazaOperativaCuadreAdmin(fallback = '') {
  return _normalizePlaza(
    (currentUserProfile && (currentUserProfile.plazaAsignada || currentUserProfile.plaza))
    || fallback
    || ''
  );
}

// Retorna true SOLO si la ubicacion está explícitamente marcada como persona (isPlazaFija===false en catálogo)
function _esPersonaEnCatalogo(nombre) {
  const entry = _findUbicacionCatalogEntry(nombre);
  return !!(entry && typeof entry === 'object' && entry.isPlazaFija === false);
}

function _resolverResponsableCuadreAdmin(item = {}) {
  const ubicacionRaw = String(item.ubicacion || '').trim();
  const ubicacion = ubicacionRaw.replace(/^👤\s*/i, '').trim();
  // Usar ubicacion como responsable SOLO si está registrada como persona en el catálogo
  // (no si es un estado o valor suelto que coincide con un nombre)
  if (ubicacion && _esPersonaEnCatalogo(ubicacion)) return ubicacion;
  return String(
    item.responsable
    || item.responsableVisual
    || item.adminResponsable
    || item._updatedBy
    || item._createdBy
    || ''
  ).trim();
}

function _resumirTextoCuadreAdmin(texto = '', max = 84) {
  const limpio = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!limpio) return 'Sin notas registradas';
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
}

function actualizarEstadoArchivosAdmin(inputId, statusId) {
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);
  if (!input || !status) return;
  const total = input.files ? input.files.length : 0;
  if (!total) {
    status.innerHTML = inputId === 'a_ins_file'
      ? '<span class="material-icons">folder_open</span> Sin archivos seleccionados todavía'
      : '<span class="material-icons">add_photo_alternate</span> Sin archivos nuevos por cargar';
    return;
  }
  const files = Array.from(input.files || []);
  const totalBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  const sample = files.slice(0, 3).map(file => {
    const ext = String(file.name || '').split('.').pop().toLowerCase();
    const icon = _docIconForExt(ext);
    return `<span class="admin-file-chip"><span class="material-icons">${icon}</span>${escapeHtml(file.name)}</span>`;
  }).join('');
  const summary = total === 1
    ? `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`
    : `${total} archivos · ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
  status.innerHTML = `
    <div class="admin-file-status-top">
      <span class="material-icons">attach_file</span>
      <strong>${summary}</strong>
    </div>
    <div class="admin-file-status-list">${sample}${total > 3 ? `<span class="admin-file-chip soft">+${total - 3} más</span>` : ''}</div>
  `;
}

function actualizarPanelLateralFlota() {
  const esAdmins = VISTA_ACTUAL_FLOTA === 'ADMINS';
  const title = document.getElementById('formTitleFlota');
  const hint = document.getElementById('admin-flota-panel-hint');
  const autofill = document.getElementById('autofill-section');
  const fields = document.getElementById('form-fields-container');
  const btnLabel = document.getElementById('btnNuevaUnidadFlotaLabel');
  const btnSave = document.getElementById('btnSaveFlota');
  const btnDel = document.getElementById('btnDelFlota');
  const delNote = document.getElementById('del-note-wrapper');
  const search = document.getElementById('searchFlota');
  const autofillInput = document.getElementById('autofill-input');
  const autofillResults = document.getElementById('autofill-results');
  const autofillReset = document.getElementById('btnResetAutofill');

  if (btnLabel) btnLabel.innerText = esAdmins ? 'REGISTRAR EN CUADRE ADMINS' : 'REGISTRAR NUEVA UNIDAD';
  if (hint) hint.style.display = esAdmins ? 'block' : 'none';
  if (autofill) autofill.style.display = 'none';
  if (fields) fields.style.display = 'none';
  if (delNote) delNote.style.display = 'none';
  if (btnSave) btnSave.style.display = esAdmins ? 'none' : 'flex';
  if (btnDel) btnDel.style.display = 'none';
  if (search) search.placeholder = esAdmins
    ? 'Buscar MVA, notas, placas, modelo o responsable...'
    : 'Buscar MVA, Notas, Placas o Modelo...';
  if (autofillInput) {
    autofillInput.value = '';
    autofillInput.disabled = false;
  }
  if (autofillResults) autofillResults.style.display = 'none';
  if (autofillReset) autofillReset.style.display = 'none';
  if (title) {
    title.innerText = esAdmins ? 'GESTIÓN CUADRE ADMINS' : 'SELECCIONA UNA UNIDAD';
    title.style.color = esAdmins ? '#d97706' : 'var(--mex-blue)';
  }
}

function cambiarTabFlota(tabSeleccionado) {
  VISTA_ACTUAL_FLOTA = tabSeleccionado;
  SELECT_REF_FLOTA = null;
  ADMIN_INSERT_UNIT = null;
  if (_isCuadreFleetMode() && !_isDedicatedCuadreIframeMode()) {
    _syncInlineFleetRoute(tabSeleccionado);
  }

  // 🔥 NUEVO: Resetear buscador y chips al cambiar de pestaña
  document.getElementById('searchFlota').value = "";
  currentFilterFlota = "TODOS";
  currentFiltroEspecial = "TODOS";
  document.querySelectorAll('#chipContainer .chip').forEach(c => c.classList.remove('active'));
  const chipTodos = document.querySelector('#chipContainer .chip:first-child');
  if (chipTodos) chipTodos.classList.add('active');

  // 1. Lógica Visual de los botones superiores
  const btnNormal = document.getElementById('tabFlotaNormal');
  const btnAdmins = document.getElementById('tabFlotaAdmins');

  if (tabSeleccionado === 'NORMAL') {
    btnNormal.style.background = 'var(--mex-blue)';
    btnNormal.style.color = 'white';
    btnAdmins.style.background = '#f1f5f9';
    btnAdmins.style.color = '#64748b';
    cargarFlota();
  } else {
    btnAdmins.style.background = '#d97706';
    btnAdmins.style.color = 'white';
    btnNormal.style.background = '#f1f5f9';
    btnNormal.style.color = '#64748b';

    document.getElementById('tablaCuerpoFlota').innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 40px;"><span class="material-icons spinner">sync</span> Cargando Cuadre Admins...</td></tr>`;

    api.obtenerCuadreAdminsData(_miPlaza()).then(data => {
      DB_ADMINS = data;
      renderFlota(DB_ADMINS);
      document.getElementById('statTotal').innerText = DB_ADMINS.length;
      document.getElementById('statListos').innerText = DB_ADMINS.filter(d => d.estado === 'LISTO').length;
    }).catch(e => console.error(e));
  }


  // 3. Limpieza de interfaz del panel derecho
  actualizarPanelLateralFlota();
}

if (!SHOULD_SKIP_MAIN_MAP_BOOTSTRAP) {
  setTimeout(actualizarPanelLateralFlota, 0);
}

// loginConToken eliminado (reemplazado por loginManual en el módulo de autenticación)


// ==========================================
// 1. LÓGICA DE LOGIN Y ROLES
// ==========================================
const BASE_PERMISSION_CATALOG = Object.freeze({
  view_admin_panel: {
    label: 'Abrir Panel Admin',
    description: 'Mostrar el acceso general al panel administrativo.',
    group: 'Panel Admin'
  },
  view_admin_users: {
    label: 'Ver vista Usuarios',
    description: 'Abrir el directorio y editor de usuarios del Panel Admin.',
    group: 'Panel Admin'
  },
  view_admin_roles: {
    label: 'Ver vista Roles',
    description: 'Consultar la matriz de roles y permisos del Panel Admin.',
    group: 'Panel Admin'
  },
  view_admin_requests: {
    label: 'Ver vista Solicitudes',
    description: 'Entrar al buzón de solicitudes de acceso desde Panel Admin.',
    group: 'Panel Admin'
  },
  view_admin_operation_catalogs: {
    label: 'Ver catálogos operativos',
    description: 'Entrar a estados, categorías, modelos y gasolinas del Panel Admin.',
    group: 'Panel Admin'
  },
  view_admin_structure: {
    label: 'Ver estructura',
    description: 'Entrar a plazas y ubicaciones dentro del Panel Admin.',
    group: 'Panel Admin'
  },
  view_admin_organization: {
    label: 'Ver organización',
    description: 'Consultar empresa y parámetros administrativos del negocio.',
    group: 'Panel Admin'
  },
  view_admin_system: {
    label: 'Ver sistema',
    description: 'Abrir acciones globales sensibles como bloqueo de patio.',
    group: 'Panel Admin'
  },
  view_admin_programmer: {
    label: 'Ver acceso Programador',
    description: 'Mostrar el acceso hacia la consola técnica desde Panel Admin.',
    group: 'Panel Admin'
  },
  manage_users: {
    label: 'Gestionar usuarios',
    description: 'Crear, editar o eliminar cuentas del sistema.',
    group: 'Usuarios'
  },
  assign_roles: {
    label: 'Asignar roles',
    description: 'Cambiar el rol base de otros usuarios.',
    group: 'Usuarios'
  },
  process_access_requests: {
    label: 'Procesar solicitudes',
    description: 'Aprobar o rechazar solicitudes de acceso.',
    group: 'Usuarios'
  },
  emit_master_alerts: {
    label: 'Emitir alertas maestras',
    description: 'Crear alertas globales y comunicados.',
    group: 'Operación'
  },
  view_admin_cuadre: {
    label: 'Ver Cuadre Admins',
    description: 'Consultar expedientes del cuadre administrativo.',
    group: 'Cuadre Admins'
  },
  edit_admin_cuadre: {
    label: 'Editar Cuadre Admins',
    description: 'Crear, modificar o retirar expedientes administrativos.',
    group: 'Cuadre Admins'
  },
  insert_external_units: {
    label: 'Registrar externos',
    description: 'Agregar unidades externas o sobrantes al flujo.',
    group: 'Operación'
  },
  manage_global_fleet: {
    label: 'Gestionar flota global',
    description: 'Editar base maestra, unidades y catálogos globales.',
    group: 'Flota'
  },
  manage_system_settings: {
    label: 'Gestionar configuración avanzada',
    description: 'Administrar variables globales y configuración avanzada de la plataforma.',
    group: 'Sistema'
  },
  manage_roles_permissions: {
    label: 'Editar roles y permisos',
    description: 'Cambiar matrices de permisos y crear roles beta.',
    group: 'Sistema'
  },
  use_programmer_console: {
    label: 'Centro de Control',
    description: 'Acceso a /programador: herramientas, Firestore, jobs, seguridad y monitoreo.',
    group: 'Sistema'
  },
  view_exact_location_logs: {
    label: 'Ver ubicaciones exactas',
    description: 'Consultar coordenadas y abrir Google Maps desde bitácoras, movimientos y auditorías.',
    group: 'Auditoría'
  },
  lock_map: {
    label: 'Bloquear mapa',
    description: 'Bloquear o liberar el mapa principal.',
    group: 'Sistema'
  },
  platform_full_access: {
    label: 'Acceso total',
    description: 'Bypass operativo completo para soporte global.',
    group: 'Sistema'
  }
});

const BASE_ROLE_META = Object.freeze({
  AUXILIAR: {
    level: 10,
    label: 'AUXILIAR',
    isAdmin: false,
    fullAccess: false,
    needsPlaza: true,
    multiPlaza: false,
    permissions: {}
  },
  VENTAS: {
    level: 20,
    label: 'VENTAS',
    isAdmin: true,
    fullAccess: false,
    needsPlaza: true,
    multiPlaza: false,
    permissions: {
      view_admin_cuadre: true
    }
  },
  SUPERVISOR: {
    level: 25,
    label: 'SUPERVISOR',
    isAdmin: true,
    fullAccess: false,
    needsPlaza: true,
    multiPlaza: false,
    permissions: {
      view_admin_cuadre: true,
      edit_admin_cuadre: true,
      insert_external_units: true
    }
  },
  JEFE_PATIO: {
    level: 25,
    label: 'JEFE DE PATIO',
    isAdmin: true,
    fullAccess: false,
    needsPlaza: true,
    multiPlaza: false,
    permissions: {
      view_admin_cuadre: true,
      edit_admin_cuadre: true,
      insert_external_units: true
    }
  },
  GERENTE_PLAZA: {
    level: 25,
    label: 'GERENTE DE PLAZA',
    isAdmin: true,
    fullAccess: false,
    needsPlaza: true,
    multiPlaza: false,
    permissions: {
      view_admin_cuadre: true,
      edit_admin_cuadre: true,
      insert_external_units: true,
      manage_global_fleet: true
    }
  },
  JEFE_REGIONAL: {
    level: 30,
    label: 'JEFE REGIONAL',
    isAdmin: true,
    fullAccess: false,
    needsPlaza: true,
    multiPlaza: true,
    permissions: {
      view_admin_panel: true,
      view_admin_requests: true,
      process_access_requests: true,
      view_admin_cuadre: true,
      edit_admin_cuadre: true,
      insert_external_units: true,
      manage_global_fleet: true
    }
  },
  CORPORATIVO_USER: {
    level: 40,
    label: 'CORPORATIVO USER',
    isAdmin: true,
    fullAccess: true,
    needsPlaza: false,
    multiPlaza: true,
    permissions: {
      manage_users: true,
      assign_roles: true,
      process_access_requests: true,
      emit_master_alerts: true,
      view_admin_cuadre: true,
      edit_admin_cuadre: true,
      insert_external_units: true,
      manage_global_fleet: true,
      manage_system_settings: true,
      manage_roles_permissions: true,
      use_programmer_console: true,
      view_exact_location_logs: true,
      lock_map: true,
      platform_full_access: true
    }
  },
  PROGRAMADOR: {
    level: 50,
    label: 'PROGRAMADOR',
    isAdmin: true,
    fullAccess: true,
    needsPlaza: false,
    multiPlaza: true,
    permissions: {
      manage_users: true,
      assign_roles: true,
      process_access_requests: true,
      emit_master_alerts: true,
      view_admin_cuadre: true,
      edit_admin_cuadre: true,
      insert_external_units: true,
      manage_global_fleet: true,
      manage_system_settings: true,
      manage_roles_permissions: true,
      use_programmer_console: true,
      view_exact_location_logs: true,
      lock_map: true,
      platform_full_access: true
    }
  },
  JEFE_OPERACION: {
    level: 60,
    label: 'JEFE DE OPERACION',
    isAdmin: true,
    fullAccess: true,
    needsPlaza: false,
    multiPlaza: true,
    permissions: {
      manage_users: true,
      assign_roles: true,
      process_access_requests: true,
      emit_master_alerts: true,
      view_admin_cuadre: true,
      edit_admin_cuadre: true,
      insert_external_units: true,
      manage_global_fleet: true,
      manage_system_settings: true,
      manage_roles_permissions: true,
      use_programmer_console: true,
      view_exact_location_logs: true,
      lock_map: true,
      platform_full_access: true
    }
  }
});

let ROLE_META = {};
let ROLE_OPTIONS = [];

function _cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function _configuredSecurity() {
  const security = window.MEX_CONFIG?.empresa?.security;
  return security && typeof security === 'object' ? security : null;
}

function _permissionCatalog() {
  const configured = _configuredSecurity()?.permissionsCatalog;
  const output = {};
  Object.entries(BASE_PERMISSION_CATALOG).forEach(([key, meta]) => {
    const incoming = configured && typeof configured[key] === 'object' ? configured[key] : {};
    output[key] = {
      label: String(incoming.label || meta.label || key).trim() || key,
      description: String(incoming.description || meta.description || '').trim(),
      group: String(incoming.group || meta.group || 'General').trim() || 'General'
    };
  });
  return output;
}

function _normalizePermissionMap(raw = {}, fallback = {}) {
  const out = {};
  const catalog = _permissionCatalog();
  Object.keys(catalog).forEach(key => {
    if (typeof fallback[key] === 'boolean') out[key] = fallback[key];
    if (typeof raw?.[key] === 'boolean') out[key] = raw[key];
  });
  return out;
}

function _buildRoleMetaEntry(roleKey, raw = {}, fallback = {}) {
  const normalizedRole = String(roleKey || '').trim().toUpperCase();
  const permissions = _normalizePermissionMap(raw.permissions || {}, fallback.permissions || {});
  const fullAccess = raw.fullAccess === undefined ? Boolean(fallback.fullAccess) : Boolean(raw.fullAccess);
  if (fullAccess) Object.keys(_permissionCatalog()).forEach(key => { permissions[key] = true; });
  const meta = {
    level: Number.isFinite(Number(raw.level)) ? Number(raw.level) : Number(fallback.level || 0),
    label: String(raw.label || fallback.label || normalizedRole).trim() || normalizedRole,
    isAdmin: raw.isAdmin === undefined ? Boolean(fallback.isAdmin) : Boolean(raw.isAdmin),
    fullAccess,
    needsPlaza: raw.needsPlaza === undefined ? Boolean(fallback.needsPlaza) : Boolean(raw.needsPlaza),
    multiPlaza: raw.multiPlaza === undefined ? Boolean(fallback.multiPlaza) : Boolean(raw.multiPlaza),
    permissions
  };
  meta.canManageUsers = Boolean(permissions.manage_users);
  meta.canProcessAccessRequests = Boolean(permissions.process_access_requests);
  meta.canEmitMasterAlerts = Boolean(permissions.emit_master_alerts);
  meta.canEditAdminCuadre = Boolean(permissions.edit_admin_cuadre);
  meta.canViewAdminCuadre = Boolean(permissions.view_admin_cuadre || permissions.edit_admin_cuadre);
  meta.canUseProgrammerConfig = Boolean(permissions.use_programmer_console);
  meta.canLockMap = Boolean(permissions.lock_map);
  return meta;
}

function _buildRoleCatalog() {
  const configuredRoles = _configuredSecurity()?.roles;
  const built = {};

  Object.entries(BASE_ROLE_META).forEach(([role, meta]) => {
    built[role] = _buildRoleMetaEntry(role, meta, meta);
  });

  if (configuredRoles && typeof configuredRoles === 'object') {
    Object.entries(configuredRoles).forEach(([rawRole, incoming]) => {
      const role = String(rawRole || '').trim().toUpperCase();
      if (!role || !incoming || typeof incoming !== 'object') return;
      built[role] = _buildRoleMetaEntry(role, incoming, built[role] || {});
    });
  }

  return built;
}

function _refreshSecurityRoleCatalog() {
  ROLE_META = _buildRoleCatalog();
  ROLE_OPTIONS = Object.keys(ROLE_META).sort((a, b) => {
    const aMeta = ROLE_META[a];
    const bMeta = ROLE_META[b];
    if ((aMeta?.level || 0) !== (bMeta?.level || 0)) return (aMeta?.level || 0) - (bMeta?.level || 0);
    return a.localeCompare(b);
  });
}

function _normalizePermissionOverrides(raw = {}) {
  const catalog = _permissionCatalog();
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(catalog).forEach(key => {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  });
  return out;
}

function _permissionOverrides(profile = currentUserProfile) {
  return _normalizePermissionOverrides(profile?.permissionOverrides || {});
}

function hasPermission(permissionKey, profile = currentUserProfile, role = userAccessRole) {
  const key = String(permissionKey || '').trim();
  if (!key) return false;
  const overrides = _permissionOverrides(profile);
  if (typeof overrides[key] === 'boolean') return overrides[key];
  const meta = _roleMeta(role);
  return Boolean(meta.fullAccess || meta.permissions?.[key]);
}

function _ensureSecurityConfig() {
  window.MEX_CONFIG = window.MEX_CONFIG || {};
  window.MEX_CONFIG.empresa = window.MEX_CONFIG.empresa || {};
  if (!window.MEX_CONFIG.empresa.security || typeof window.MEX_CONFIG.empresa.security !== 'object') {
    window.MEX_CONFIG.empresa.security = {};
  }

  const security = window.MEX_CONFIG.empresa.security;
  if (!security.permissionsCatalog || typeof security.permissionsCatalog !== 'object') {
    security.permissionsCatalog = {};
  }
  if (!security.roles || typeof security.roles !== 'object') {
    security.roles = {};
  }

  security.permissionsCatalog = _cloneJson(_permissionCatalog());
  security.roles = _cloneJson(
    Object.fromEntries(
      Object.entries(_buildRoleCatalog()).map(([role, meta]) => [role, {
        label: meta.label,
        level: meta.level,
        isAdmin: meta.isAdmin,
        fullAccess: meta.fullAccess,
        needsPlaza: meta.needsPlaza,
        multiPlaza: meta.multiPlaza,
        permissions: { ...(meta.permissions || {}) }
      }])
    )
  );
  _refreshSecurityRoleCatalog();
  return security;
}

function _isSystemRole(role) {
  return Boolean(BASE_ROLE_META[String(role || '').trim().toUpperCase()]);
}

_refreshSecurityRoleCatalog();
const UI_PROGRAMADOR_BOOTSTRAP_EMAILS = Object.freeze([
  'angelarmentta@icloud.com'
]);

let userRole = null;
let USER_NAME = "";
let dbUsuariosLogin = [];
let isGlobalAdmin = false; // <-- NUEVA VARIABLE GLOBAL
let userAccessRole = "AUXILIAR";
let currentUserProfile = null;
let DB_MAESTRA = [];
let DB_MAESTRA_READY = false;
let _adminMaestraPromise = null;
const ADMIN_MAESTRA_CACHE_KEY = 'mex_mapa_admin_maestra_v2';
const ADMIN_MAESTRA_CACHE_TTL_MS = 15 * 60 * 1000;
let _presenceTimer = null;
let _presenceBound = false;


// Inicializar error tracking si Sentry está configurado
if (window.__MEX_SENTRY_DSN) initErrorTracking(window.__MEX_SENTRY_DSN);

// Inicializar banner de instalación PWA (Fase 3)
initPwaInstall();
installProgrammerErrorReporter({
  screen: 'mapa',
  getProfile: () => currentUserProfile || window.CURRENT_USER_PROFILE || null,
  getBuild: () => APP_BUILD_TAG,
  enabled: () => Boolean(auth.currentUser)
});

// Variable global de Auth
// Declared before auth init to avoid TDZ when onAuthStateChanged fires synchronously
let radarInterval = null;
let isSaving = false;

function _sanitizeRole(role) {
  const normalized = String(role || '').trim().toUpperCase();
  return ROLE_META[normalized] ? normalized : null;
}

function _legacyRoleFromFlags(data = {}) {
  if (data.isGlobal === true) return 'CORPORATIVO_USER';
  if (data.isAdmin === true) return 'VENTAS';
  return 'AUXILIAR';
}

function _roleMeta(role = userAccessRole) {
  return ROLE_META[_sanitizeRole(role) || 'AUXILIAR'];
}

function _normalizePlaza(value) {
  return String(value || '').trim().toUpperCase();
}

function _profileDocId(email) {
  return String(email || '').trim().toLowerCase();
}

function _isBootstrapProgrammerEmail(email) {
  return UI_PROGRAMADOR_BOOTSTRAP_EMAILS.includes(_profileDocId(email));
}

function _resolveStoredRoleForEmail(email, role) {
  const normalizedRole = _sanitizeRole(role) || 'AUXILIAR';
  return _isBootstrapProgrammerEmail(email) ? 'PROGRAMADOR' : normalizedRole;
}

async function _ensureBootstrapProgrammerProfile(user) {
  const emailNormalizado = _profileDocId(user?.email || '');
  if (!emailNormalizado || !_isBootstrapProgrammerEmail(emailNormalizado)) return null;

  const nombre = String(user?.displayName || 'PROGRAMADOR').trim().toUpperCase() || 'PROGRAMADOR';
  const payload = {
    email: emailNormalizado,
    nombre,
    usuario: nombre,
    rol: 'PROGRAMADOR',
    isAdmin: true,
    isGlobal: true,
    plazaAsignada: '',
    telefono: '',
    status: 'ACTIVO',
    authUid: String(user?.uid || '').trim(),
    bootstrapProgrammer: true,
    lastBootstrapLoginAt: Date.now()
  };

  await db.collection(COL.USERS).doc(emailNormalizado).set(payload, { merge: true });
  const persisted = await db.collection(COL.USERS).doc(emailNormalizado).get();
  if (persisted.exists) {
    return _normalizeUserProfile({ id: persisted.id, ...persisted.data(), email: emailNormalizado });
  }
  return _normalizeUserProfile({ id: emailNormalizado, ...payload });
}

function _avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < String(name || '').length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % APP_AVATAR_COLORS.length;
  }
  return APP_AVATAR_COLORS[Math.abs(h)] || APP_AVATAR_COLORS[0];
}

function _coerceTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function _getUserAvatarUrl(user = {}) {
  return String(
    user.avatarUrl
    || user.fotoURL
    || user.profilePhotoUrl
    || user.photoURL
    || ''
  ).trim();
}

function _userPresenceIsOnline(user = {}) {
  const lastSeenAt = _coerceTimestamp(user.lastSeenAt || user.lastActiveAt);
  return user.isOnline === true && lastSeenAt > 0 && (Date.now() - lastSeenAt) < USER_PRESENCE_STALE_MS;
}

function _formatearUltimaConexion(rawTs) {
  const ts = _coerceTimestamp(rawTs);
  if (!ts) return 'Sin actividad reciente';
  const fecha = new Date(ts);
  if (Number.isNaN(fecha.getTime())) return 'Sin actividad reciente';
  return fecha.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function _buildAvatarMarkup(user = {}, fallbackName = '') {
  const nombre = String(user.nombre || user.usuario || fallbackName || '').trim();
  const url = _getUserAvatarUrl(user);
  if (url) {
    return {
      background: '#0f172a',
      html: `<img src="${escapeHtml(url)}" alt="${escapeHtml(nombre || 'Usuario')}" class="user-avatar-photo">`
    };
  }
  return {
    background: _avatarColor(nombre || fallbackName || 'U'),
    html: `<span class="avatar-initial">${escapeHtml(_obtenerInicialesUsuario(nombre || fallbackName || 'U'))}</span>`
  };
}

function _paintAvatarElement(el, user = {}, fallbackName = '') {
  if (!el) return;
  const avatar = _buildAvatarMarkup(user, fallbackName);
  el.style.background = avatar.background;
  el.innerHTML = avatar.html;
}

function _normalizeUserProfile(raw = {}) {
  const email = _profileDocId(raw.email || raw.id || '');
  const explicitRole = _sanitizeRole(raw.rol);
  const rol = _resolveStoredRoleForEmail(email, explicitRole || _legacyRoleFromFlags(raw));
  const meta = _roleMeta(rol);
  const nombre = String(raw.nombre || raw.usuario || raw.email || '').trim().toUpperCase();
  return {
    ...raw,
    id: raw.id || '',
    nombre,
    usuario: nombre,
    email,
    rol,
    roleLabel: meta.label,
    roleLevel: meta.level,
    isAdmin: meta.isAdmin,
    isGlobal: meta.fullAccess,
    plazaAsignada: _normalizePlaza(raw.plazaAsignada || raw.plaza || raw.sucursalAsignada || raw.sucursal || ''),
    telefono: String(raw.telefono || '').trim(),
    status: String(raw.status || 'ACTIVO').trim().toUpperCase() || 'ACTIVO',
    isOnline: Boolean(raw.isOnline),
    lastSeenAt: _coerceTimestamp(raw.lastSeenAt || raw.lastActiveAt || raw.ultimaConexionTs),
    avatarUrl: _getUserAvatarUrl(raw),
    avatarPath: String(raw.avatarPath || '').trim(),
    plazasPermitidas: Array.isArray(raw.plazasPermitidas) ? raw.plazasPermitidas.map(_normalizePlaza).filter(Boolean) : [],
    permissionOverrides: _normalizePermissionOverrides(raw.permissionOverrides || raw.permisosUsuario || {})
  };
}

// Plaza activa en el mapa (puede cambiar si JEFE_REGIONAL cambia de vista)
// PLAZA_ACTIVA_MAPA declarada al top del módulo (línea 11)

function _miPlaza() {
  if (PLAZA_ACTIVA_MAPA) return PLAZA_ACTIVA_MAPA;
  const remembered = _normalizePlaza(
    typeof window.getMexCurrentPlaza === 'function'
      ? window.getMexCurrentPlaza()
      : window.__mexCurrentPlazaId
  );
  if (remembered) return remembered;
  if (currentUserProfile?.plazaAsignada) return currentUserProfile.plazaAsignada;
  // Fallback para fullAccess sin plaza asignada: primera plaza configurada
  const plazas = window.MEX_CONFIG?.empresa?.plazas;
  return (Array.isArray(plazas) && plazas.length > 0) ? plazas[0] : '';
}
function _puedeVerTodasPlazas() { return hasFullAccess(); }
function _plazasPermitidas() {
  if (_puedeVerTodasPlazas()) return null; // null = sin restricción
  const pp = currentUserProfile?.plazasPermitidas;
  if (_roleMeta().multiPlaza && Array.isArray(pp) && pp.length > 0) return [currentUserProfile.plazaAsignada, ...pp].filter(Boolean);
  return [currentUserProfile?.plazaAsignada].filter(Boolean);
}

function _setSessionProfile(profile) {
  currentUserProfile = profile;
  USER_NAME = profile.nombre || profile.nombreCompleto || profile.displayName
    || auth.currentUser?.displayName
    || profile.email
    || '';
  userAccessRole = profile.rol || 'AUXILIAR';
  userRole = (profile.isAdmin || _roleMeta(userAccessRole).isAdmin) ? 'admin' : 'visitante';
  isGlobalAdmin = _roleMeta(userAccessRole).fullAccess;
  // Inicializar plaza activa del mapa con la plaza del usuario
  const rememberedPlaza = _normalizePlaza(
    typeof window.getMexCurrentPlaza === 'function'
      ? window.getMexCurrentPlaza()
      : window.__mexCurrentPlazaId
  );
  PLAZA_ACTIVA_MAPA = _normalizePlaza(profile.plazaAsignada || profile.plaza || rememberedPlaza || '');
  window.CURRENT_USER_PROFILE = profile;
  window.__mexSeedCurrentUserRecordCache?.(profile, auth.currentUser);
  _rememberActivePlaza(PLAZA_ACTIVA_MAPA);
  _updateGlobalPlazaEmail();
  console.log('[MEX-INTEG] _setSessionProfile →', { email: profile.email, rol: userAccessRole, plaza: PLAZA_ACTIVA_MAPA || '(sin plaza)', userRole, fullAccess: isGlobalAdmin });
  setErrorUser({ email: profile.email, role: userAccessRole, plaza: PLAZA_ACTIVA_MAPA });
  _inyectarSidebar();
}

function _inyectarSidebar() {
  const container = document.getElementById('mapaLeftSidebarContainer');
  if (!container || !currentUserProfile) return;
  const companyName = window.MEX_CONFIG?.empresa?.nombre || APP_DEFAULT_COMPANY_NAME;
  const activeMetrics = ((window._supervisionData || _supervisionData || {})[PLAZA_ACTIVA_MAPA]) || {};
  const shellUserName = displayUserName(currentUserProfile);
  const html = renderSidebarHTML(currentUserProfile, activeMetrics, PLAZA_ACTIVA_MAPA, companyName, shellUserName, '/mapa');
  container.innerHTML = html;
  bindSidebarShell(document, { currentPlaza: PLAZA_ACTIVA_MAPA });
  _syncMapShellHeader();
}

function _syncMapShellHeader() {
  if (!currentUserProfile) return;
  const shellUserName = displayUserName(currentUserProfile);
  const shellRole = roleLabel(currentUserProfile);
  const shellAvatar = _obtenerInicialesUsuario(shellUserName || USER_NAME || currentUserProfile?.email || 'U');

  const topbarName = document.getElementById('shellUserName');
  const topbarMeta = document.getElementById('shellUserMeta');
  const topbarAvatar = document.getElementById('shellUserAvatar');
  if (topbarName) topbarName.textContent = shellUserName;
  if (topbarMeta) topbarMeta.textContent = `${shellRole} · En línea`;
  if (topbarAvatar) topbarAvatar.textContent = shellAvatar;
}

function _openAlertsOrNotifications() {
  const hasAlerts = Array.isArray(filaAlertasPendientes) && filaAlertasPendientes.length > 0;
  if (hasAlerts) {
    abrirSiguienteAlerta();
    return;
  }
  openNotificationCenter();
}

function _applyPendingShellSearch(attempt = 0) {
  const pending = attempt === 0 ? consumeShellSearch() : window.__mexPendingShellSearch;
  if (!pending?.query) return;

  const inputDesktop = document.getElementById('searchInput');
  const inputMobile = document.getElementById('searchInputMobile');
  if (!inputDesktop || !inputMobile || document.querySelectorAll('.car').length === 0) {
    if (attempt < 12) {
      window.__mexPendingShellSearch = pending;
      setTimeout(() => _applyPendingShellSearch(attempt + 1), 250);
    }
    return;
  }

  window.__mexPendingShellSearch = null;
  inputDesktop.value = pending.query;
  inputMobile.value = pending.query;
  if (typeof buscarMasivo === 'function') buscarMasivo();
}

function _clearSessionProfile() {
  currentUserProfile = null;
  USER_NAME = "";
  userAccessRole = "AUXILIAR";
  userRole = null;
  isGlobalAdmin = false;
  window.CURRENT_USER_PROFILE = null;
  _clearRememberedPlaza();
  if (typeof window.getPlazaActualEmail === 'function') window.PLAZA_ACTUAL_EMAIL = window.getPlazaActualEmail('');
}

function _obtenerInicialesUsuario(nombre = '') {
  const partes = String(nombre || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!partes.length) return '--';
  return partes.map(parte => parte[0]).join('').toUpperCase();
}

function _currentUserDocId() {
  // Prefer the actual Firestore doc ID from the loaded profile (may be UID-keyed)
  if (currentUserProfile?.id) return currentUserProfile.id;
  return _profileDocId(auth.currentUser?.email || currentUserProfile?.email || '');
}

async function _actualizarPresenciaUsuario(isOnline = true) {
  // Bootstrap programmer no tiene doc real en Firestore — no escribir presencia
  if (currentUserProfile?._syntheticProfile) return;
  if (_isBootstrapProgrammerEmail(currentUserProfile?.email)) return;
  const docId = _currentUserDocId();
  if (!docId) return;
  const ahora = Date.now();
  const payload = {
    isOnline,
    lastSeenAt: ahora,
    lastActiveAt: ahora
  };
  try {
    // Usamos .update() en vez de .set({merge:true}) para que las reglas Firestore
    // evalúen correctamente solo los campos que cambian (self-service presencia).
    await db.collection(COL.USERS).doc(docId).update(payload);
    if (currentUserProfile && docId === currentUserProfile.email) {
      currentUserProfile = { ...currentUserProfile, ...payload };
      window.CURRENT_USER_PROFILE = currentUserProfile;
    }
  } catch (error) {
    // Presencia no es crítica — fallo silencioso para no saturar la consola
    // (puede fallar por permisos en roles sin perfil o conexión intermitente)
    if (error?.code !== 'permission-denied') {
      console.warn('No se pudo actualizar presencia del usuario:', error?.code || error);
    }
  }
}

function _detenerPresenciaUsuario(forceOffline = false) {
  if (_presenceTimer) {
    clearInterval(_presenceTimer);
    _presenceTimer = null;
  }
  if (forceOffline) {
    _actualizarPresenciaUsuario(false).catch(() => { });
  }
}

function _iniciarPresenciaUsuario() {
  if (!currentUserProfile || !_currentUserDocId()) return;
  _detenerPresenciaUsuario(false);
  _actualizarPresenciaUsuario(true).catch(() => { });
  _presenceTimer = setInterval(() => {
    _actualizarPresenciaUsuario(true).catch(() => { });
  }, USER_PRESENCE_HEARTBEAT_MS);

  if (_presenceBound) return;
  _presenceBound = true;

  document.addEventListener('visibilitychange', () => {
    if (!currentUserProfile) return;
    _actualizarPresenciaUsuario(!document.hidden).catch(() => { });
  });

  window.addEventListener('pagehide', () => {
    if (!currentUserProfile) return;
    _actualizarPresenciaUsuario(false).catch(() => { });
  });
}

function _actualizarIdentidadSidebarUsuario() {
  const profile = window.CURRENT_USER_PROFILE || {};
  const nombre = USER_NAME || profile.nombre || 'SIN SESIÓN';
  const roleLabel = profile.roleLabel || _roleMeta().label;
  const plaza = profile.plazaAsignada ? ` · ${profile.plazaAsignada}` : '';

  const avatar = document.getElementById('adminSidebarUserAvatar');
  const nameEl = document.getElementById('adminSidebarUserName');
  const metaEl = document.getElementById('adminSidebarUserMeta');

  if (avatar) _paintAvatarElement(avatar, profile, nombre);
  if (nameEl) nameEl.innerText = nombre;
  if (metaEl) metaEl.innerText = USER_NAME ? `${roleLabel}${plaza}` : 'Esperando autenticación';
}

function _actualizarBloquesAdminSidebar() {
  const nav = document.getElementById('adminSidebarNav');
  if (!nav) return;

  const children = Array.from(nav.children);
  children.forEach(child => {
    if (child.classList.contains('admin-nav-group')) {
      const hasVisibleButton = Array.from(child.querySelectorAll('.sb-btn'))
        .some(btn => getComputedStyle(btn).display !== 'none');
      child.style.display = hasVisibleButton ? 'flex' : 'none';
    }
  });

  children.forEach((child, index) => {
    if (!child.classList.contains('sb-divider')) return;
    const prev = [...children.slice(0, index)].reverse().find(el => !el.classList.contains('sb-divider'));
    const next = children.slice(index + 1).find(el => !el.classList.contains('sb-divider'));
    const prevVisible = prev && getComputedStyle(prev).display !== 'none';
    const nextVisible = next && getComputedStyle(next).display !== 'none';
    child.style.display = prevVisible && nextVisible ? 'block' : 'none';
  });
}

function canManageUsers() { return hasPermission('manage_users'); }
function canProcessAccessRequests() { return hasPermission('process_access_requests'); }
function canEmitMasterAlerts() { return hasPermission('emit_master_alerts'); }
function canEditAdminCuadre() { return hasPermission('edit_admin_cuadre'); }
function canViewAdminCuadre() { return hasPermission('view_admin_cuadre') || canEditAdminCuadre(); }
function canUseProgrammerConfig() { return hasPermission('use_programmer_console'); }
function canViewExactLocationLogs() { return hasPermission('view_exact_location_logs'); }
function canLockMap() { return hasPermission('lock_map') || _roleMeta().fullAccess; }
function canInsertExternalUnits() { return hasPermission('insert_external_units') || _roleMeta().level >= (_roleMeta('GERENTE_PLAZA').level || 25); }
function hasFullAccess() { return hasPermission('platform_full_access') || _roleMeta().fullAccess; }
function canViewAdminUsers() { return hasPermission('view_admin_users') || canManageUsers(); }
function canViewAdminRoles() { return hasPermission('view_admin_roles') || hasPermission('manage_roles_permissions') || canManageUsers(); }
function canViewAdminRequests() { return hasPermission('view_admin_requests') || canProcessAccessRequests() || canManageUsers() || canUseProgrammerConfig(); }
function canViewAdminOperationCatalogs() {
  return hasPermission('view_admin_operation_catalogs')
    || hasPermission('manage_system_settings')
    || canUseProgrammerConfig();
}
function canViewAdminStructure() {
  return hasPermission('view_admin_structure')
    || hasPermission('manage_system_settings')
    || canUseProgrammerConfig();
}
function canViewAdminOrganization() {
  return hasPermission('view_admin_organization')
    || hasPermission('manage_system_settings')
    || canUseProgrammerConfig();
}
function canViewAdminSystem() {
  return hasPermission('view_admin_system')
    || canLockMap()
    || hasPermission('manage_system_settings')
    || canUseProgrammerConfig();
}
function canViewAdminProgrammer() { return hasPermission('view_admin_programmer') || canUseProgrammerConfig(); }
function _cfgCanAccessTab(tabName = '') {
  const normalized = String(tabName || '').trim().toLowerCase();
  if (normalized === 'usuarios') return canViewAdminUsers();
  if (normalized === 'roles') return canViewAdminRoles();
  if (normalized === 'solicitudes') return canViewAdminRequests();
  if (['estados', 'categorias', 'modelos', 'gasolinas'].includes(normalized)) return canViewAdminOperationCatalogs();
  if (['plazas', 'ubicaciones'].includes(normalized)) return canViewAdminStructure();
  if (normalized === 'empresa') return canViewAdminOrganization();
  if (normalized === 'programador') return canViewAdminProgrammer();
  return false;
}
function _cfgVisibleAdminTabs() {
  return ['usuarios', 'roles', 'solicitudes', 'estados', 'categorias', 'modelos', 'gasolinas', 'plazas', 'ubicaciones', 'empresa', 'programador']
    .filter(tabName => _cfgCanAccessTab(tabName));
}
function _cfgResolveAllowedTab(preferred = 'usuarios') {
  const normalized = String(preferred || 'usuarios').trim().toLowerCase() || 'usuarios';
  const visibleTabs = _cfgVisibleAdminTabs();
  if (visibleTabs.includes(normalized)) return normalized;
  return visibleTabs[0] || '';
}
function _cfgRefreshSidebarSections() {
  document.querySelectorAll('#cfg-admin-sidebar .cfg-nav-group').forEach(section => {
    const buttons = Array.from(section.querySelectorAll('.cfg-nav-group-body .cfg-tab'));
    const hasVisibleButton = buttons.some(btn => getComputedStyle(btn).display !== 'none');
    section.style.display = hasVisibleButton ? '' : 'none';
  });
}
function canOpenAdminPanel() {
  const visibleTabs = _cfgVisibleAdminTabs();
  const panelOverride = _permissionOverrides()?.view_admin_panel;
  if (panelOverride === false) return false;
  return visibleTabs.length > 0;
}

function abrirPanelAdministracion() {
  abrirPanelConfiguracion(_cfgResolveAllowedTab('usuarios'));
}

function _abrirProgrammerConsoleRoute() {
  if (!canUseProgrammerConfig()) {
    showToast('Tu rol no puede abrir el Centro de Control.', 'error');
    return;
  }
  _navigateTop('/programador');
}

function cerrarPanelConfiguracion() {
  if (_isDedicatedGestionIframeMode()) {
    _navigateTop('/mapa');
    return;
  }
  // En la página /gestion standalone, navegar de vuelta al mapa
  if (/^\/gestion(?:\.html)?$/i.test(window.location.pathname || '')) {
    window.location.href = '/mapa';
    return;
  }
  _resetGestionAdminChrome();
  document.getElementById('modal-config-global')?.classList.remove('active');
  sincronizarEstadoSidebars();
}

function _ensureProgrammerRouteButton() {
  const group = document.getElementById('navGroupPanelAdmin');
  if (!group) return;
  let btn = document.getElementById('btnProgrammerRoute');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'btnProgrammerRoute';
    btn.className = 'sb-btn sb-btn-dark';
    btn.type = 'button';
    btn.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="material-icons" style="color:#67e8f9;">terminal</span>
        <span style="font-weight:800; font-size:11px;">CONSOLA PROGRAMADOR</span>
      </div>
      <span class="material-icons sb-chevron">open_in_new</span>
    `;
    btn.addEventListener('click', _abrirProgrammerConsoleRoute);
    group.appendChild(btn);
  }
  btn.style.display = canUseProgrammerConfig() ? 'flex' : 'none';
}

function canAssignRole(targetRole) {
  const role = _sanitizeRole(targetRole) || 'AUXILIAR';
  const meta = _roleMeta(role);
  if (!canManageUsers()) return false;
  if (userAccessRole === 'CORPORATIVO_USER') {
    return !(meta.fullAccess || meta.canUseProgrammerConfig || meta.permissions?.manage_roles_permissions);
  }
  return true;
}

function canManageTargetRole(targetRole) {
  const role = _sanitizeRole(targetRole) || 'AUXILIAR';
  const meta = _roleMeta(role);
  if (!canManageUsers()) return false;
  if (userAccessRole === 'CORPORATIVO_USER') {
    return !(meta.fullAccess || meta.canUseProgrammerConfig || meta.permissions?.manage_roles_permissions);
  }
  return true;
}

function _roleOptionsHtml(selectedRole = 'AUXILIAR') {
  const normalized = _sanitizeRole(selectedRole) || 'AUXILIAR';
  return ROLE_OPTIONS.map(role => {
    const meta = ROLE_META[role];
    const selected = role === normalized ? 'selected' : '';
    const disabled = canAssignRole(role) ? '' : 'disabled';
    return `<option value="${role}" ${selected} ${disabled}>${meta.label}</option>`;
  }).join('');
}

// Todos los roles excepto JEFE_OPERACION y PROGRAMADOR tienen plaza asignada
function _roleNeedsPlaza(role) {
  return _roleMeta(role).needsPlaza;
}

// JEFE_REGIONAL puede ver múltiples plazas (además de su plaza base)
function _roleNeedsMultiplePlazas(role) {
  return _roleMeta(role).multiPlaza;
}

function _inferRequestedAccessRole(puesto, email = '') {
  if (_isBootstrapProgrammerEmail(email)) return 'PROGRAMADOR';
  const texto = String(puesto || '').trim().toUpperCase();
  if (!texto) return 'AUXILIAR';
  if (texto.includes('PROGRAMADOR')) return 'PROGRAMADOR';
  if (texto.includes('JEFE DE OPERACION') || texto.includes('JEFE OPERACION')) return 'JEFE_OPERACION';
  if (texto.includes('CORPORATIVO')) return 'CORPORATIVO_USER';
  if (texto.includes('JEFE REGIONAL')) return 'JEFE_REGIONAL';
  if (texto.includes('JEFE DE PATIO') || texto.includes('JEFE PATIO')) return 'JEFE_PATIO';
  if (texto.includes('SUPERVISOR')) return 'SUPERVISOR';
  if (texto.includes('GERENTE')) return 'GERENTE_PLAZA';
  if (texto.includes('VENTAS') || texto.includes('ADMIN')) return 'VENTAS';
  return 'AUXILIAR';
}

function _syncRoleScope(prefix) {
  const roleInput = document.getElementById(`${prefix}-role`);
  const plazaRow = document.getElementById(`${prefix}-plaza-row`);
  const multiRow = document.getElementById(`${prefix}-plazas-multi-row`);
  if (!roleInput || !plazaRow) return;
  const rol = roleInput.value;
  const needsPlaza = _roleNeedsPlaza(rol);
  const needsMulti = _roleNeedsMultiplePlazas(rol);
  plazaRow.style.display = needsPlaza ? '' : 'none';
  if (multiRow) multiRow.style.display = needsMulti ? '' : 'none';
  if (!needsPlaza) {
    const plazaSelect = document.getElementById(`${prefix}-plaza`);
    if (plazaSelect) plazaSelect.value = '';
  }
}

// Genera el <select> de plazas desde MEX_CONFIG
function _plazaSelectHtml(id, selectedValue = '', extraAttr = '') {
  const direct = Array.isArray(window.MEX_CONFIG?.empresa?.plazas) ? window.MEX_CONFIG.empresa.plazas : [];
  const detailed = Array.isArray(window.MEX_CONFIG?.empresa?.plazasDetalle)
    ? window.MEX_CONFIG.empresa.plazasDetalle.map(item => _normalizePlaza(item?.id))
    : [];
  const plazas = [...new Set([...direct, ...detailed].map(_normalizePlaza).filter(Boolean))];
  const opts = plazas.map(p =>
    `<option value="${escapeHtml(p)}" ${p === selectedValue ? 'selected' : ''}>${escapeHtml(p)}</option>`
  ).join('');
  return `<select id="${id}" ${extraAttr} style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;background:white;color:var(--text);">
        <option value="">— Sin plaza —</option>
        ${opts}
      </select>`;
}

// Genera checkboxes de plazas permitidas para JEFE_REGIONAL
function _plazasMultiHtml(id, selected = []) {
  const plazas = (window.MEX_CONFIG?.empresa?.plazas || []);
  if (plazas.length === 0) return '<span style="font-size:12px;color:#94a3b8;">Sin plazas configuradas.</span>';
  return `<div id="${id}" style="display:flex;flex-wrap:wrap;gap:6px;padding:6px 0;">
        ${plazas.map(p => {
    const checked = Array.isArray(selected) && selected.includes(p) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:8px;border:1.5px solid #e2e8f0;background:white;cursor:pointer;font-size:12px;font-weight:700;color:#334155;">
            <input type="checkbox" value="${escapeHtml(p)}" ${checked} style="accent-color:var(--mex-accent);width:14px;height:14px;">
            ${escapeHtml(p)}
          </label>`;
  }).join('')}
      </div>`;
}

// Lee las plazas seleccionadas del multi-selector
function _getSelectedPlazas(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

function _permissionEntries() {
  const catalog = _permissionCatalog();
  return Object.entries(catalog).map(([key, meta]) => ({ key, ...meta }));
}

function _permissionSummaryText(overrides = {}) {
  const entries = Object.entries(_normalizePermissionOverrides(overrides));
  if (!entries.length) return 'Sin overrides individuales';
  const grants = entries.filter(([, value]) => value === true).length;
  const denies = entries.filter(([, value]) => value === false).length;
  return `${grants} concedido${grants === 1 ? '' : 's'} · ${denies} bloqueado${denies === 1 ? '' : 's'}`;
}

function _permissionOverridesEditorHtml(containerId, overrides = {}, disabled = false) {
  const groups = _permissionEntries().reduce((acc, item) => {
    const group = item.group || 'General';
    acc[group] = acc[group] || [];
    acc[group].push(item);
    return acc;
  }, {});
  const disabledAttr = disabled ? 'disabled' : '';
  return `
    <div id="${containerId}" class="cfg-security-permission-groups">
      ${Object.entries(groups).map(([group, items]) => `
        <section class="cfg-security-permission-group">
          <div class="cfg-security-permission-group-head">
            <div class="cfg-security-permission-group-title">${escapeHtml(group)}</div>
            <span class="cfg-security-permission-group-meta">${escapeHtml(String(items.length))} reglas</span>
          </div>
          <div class="cfg-security-permission-grid">
            ${items.map(item => {
              const current = _normalizePermissionOverrides(overrides)[item.key];
              return `
                <div class="cfg-security-permission-item">
                  <div class="cfg-security-permission-copy">
                    <strong>${escapeHtml(item.label)}</strong>
                    <small>${escapeHtml(item.description)}</small>
                  </div>
                  <select data-permission-key="${escapeHtml(item.key)}" ${disabledAttr}>
                    <option value="inherit" ${current === undefined ? 'selected' : ''}>Heredar rol</option>
                    <option value="allow" ${current === true ? 'selected' : ''}>Permitir</option>
                    <option value="deny" ${current === false ? 'selected' : ''}>Bloquear</option>
                  </select>
                </div>
              `;
            }).join('')}
          </div>
        </section>
      `).join('')}
    </div>
  `;
}

function _readPermissionOverrides(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return {};
  const overrides = {};
  container.querySelectorAll('[data-permission-key]').forEach(select => {
    const key = select.getAttribute('data-permission-key');
    if (!key) return;
    if (select.value === 'allow') overrides[key] = true;
    else if (select.value === 'deny') overrides[key] = false;
  });
  return overrides;
}

// Retorna plazas únicas de los usuarios cargados (para chips de filtro)
function _umGetPlazasDisponibles() {
  const set = new Set();
  _umUsers.forEach(u => { if (u.plazaAsignada) set.add(u.plazaAsignada.toUpperCase()); });
  return [...set].sort();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const _adminAuditLocationState = {
  status: 'pending',
  exactLocation: null,
  lastUpdated: 0,
  error: ''
};
let _gestionAdminBooted = false;
let _cuadreFleetBooted = false;
let _adminInlineRouteBound = false;
let _fleetInlineRouteBound = false;

function _safeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function _safeLower(value) {
  return String(value || '').trim().toLowerCase();
}

function _qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function _isGestionAdminMode() {
  return _qs('admin') === '1' || /^\/gestion(?:\.html)?$/i.test(window.location.pathname || '');
}

function _isCuadreFleetMode() {
  const tab = (_qs('tab') || '').toLowerCase();
  return _qs('fleet') === '1'
    || /^\/cuadre(?:\.html)?$/i.test(window.location.pathname || '')
    || tab === 'cuadre'
    || tab === 'cuadreadmins';
}

function _isDedicatedGestionIframeMode() {
  return _qs('admin') === '1';
}

function _isDedicatedCuadreIframeMode() {
  return _qs('fleet') === '1';
}

function _isDedicatedMessagesIframeMode() {
  return _qs('messages') === '1';
}

function _isMessagesMode() {
  return _qs('messages') === '1' || /^\/mensajes(?:\.html)?$/i.test(window.location.pathname || '');
}

function _gestionInitialTab() {
  return String(_qs('tab') || 'usuarios').trim().toLowerCase() || 'usuarios';
}

function _cuadreInitialTab() {
  const raw = String(_qs('tab') || 'normal').trim().toLowerCase();
  return (raw === 'admins' || raw === 'cuadreadmins') ? 'ADMINS' : 'NORMAL';
}

function _buildGestionRouteUrl(tab = 'usuarios') {
  const params = new URLSearchParams();
  const tabName = String(tab || 'usuarios').trim().toLowerCase();
  if (tabName) params.set('tab', tabName);
  const query = params.toString();
  return `/gestion${query ? `?${query}` : ''}`;
}

function _buildCuadreRouteUrl(tab = 'normal') {
  const isAdmins = String(tab || 'normal').trim().toLowerCase() === 'admins';
  return `/mapa?tab=${isAdmins ? 'cuadreadmins' : 'cuadre'}`;
}

function _navigateTop(url) {
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = url;
      return;
    }
  } catch (_) {}
  window.location.href = url;
}

function _syncInlineAdminRoute(tab = 'usuarios') {
  if (_isDedicatedGestionIframeMode() || !window.history?.pushState) return;
  const normalizedTab = String(tab || 'usuarios').trim().toLowerCase() || 'usuarios';
  const targetUrl = _buildGestionRouteUrl(normalizedTab);
  try {
    if (/^\/gestion(?:\.html)?$/i.test(window.location.pathname || '')) {
      window.history.replaceState({ mexInlineRoute: 'admin', tab: normalizedTab }, '', targetUrl);
    } else {
      window.history.pushState({ mexInlineRoute: 'admin', tab: normalizedTab }, '', targetUrl);
    }
  } catch (_) {}
}

function _restoreInlineAdminRoute() {
  if (_isDedicatedGestionIframeMode() || !window.history?.replaceState) return;
  try {
    window.history.replaceState({ mexInlineRoute: 'map' }, '', '/mapa');
  } catch (_) {}
}

function _resetGestionAdminChrome() {
  document.documentElement.classList.remove('gestion-admin-route');
  document.body?.classList.remove('gestion-admin-route');
  const footer = document.querySelector('.cfg-v2-footer');
  if (footer) footer.style.display = '';
  const closeBtn = document.querySelector('.cfg-v2-close');
  if (closeBtn) closeBtn.title = 'Cerrar panel';
}

function _bindInlineAdminRouteState() {
  if (_adminInlineRouteBound) return;
  _adminInlineRouteBound = true;
  window.addEventListener('popstate', () => {
    if (_isDedicatedGestionIframeMode()) return;
    const modal = document.getElementById('modal-config-global');
    if (!modal) return;
    if (_isGestionAdminMode()) {
      const targetTab = _gestionInitialTab();
      if (!modal.classList.contains('active')) {
        abrirPanelConfiguracion(targetTab);
      } else {
        _applyGestionAdminChrome();
        const targetButton = document.getElementById(`cfg-tab-${targetTab}`) || document.querySelector(`.cfg-tab[onclick*="'${targetTab}'"]`);
        if (targetButton) abrirTabConfig(targetTab, targetButton);
      }
      return;
    }
    if (modal.classList.contains('active')) {
      modal.classList.remove('active');
      _resetGestionAdminChrome();
      sincronizarEstadoSidebars();
      refrescarDatos();
    }
  });
}

function _syncInlineFleetRoute(tab = 'NORMAL') {
  if (_isDedicatedCuadreIframeMode() || !window.history?.pushState) return;
  const targetUrl = _buildCuadreRouteUrl(String(tab || 'NORMAL').trim().toLowerCase() === 'admins' ? 'admins' : 'normal');
  try {
    if (/^\/cuadre(?:\.html)?$/i.test(window.location.pathname || '')) {
      window.history.replaceState({ mexInlineRoute: 'fleet', tab }, '', targetUrl);
    } else {
      window.history.pushState({ mexInlineRoute: 'fleet', tab }, '', targetUrl);
    }
  } catch (_) {}
}

function _restoreInlineFleetRoute() {
  if (_isDedicatedCuadreIframeMode() || !window.history?.replaceState) return;
  try {
    window.history.replaceState({ mexInlineRoute: 'map' }, '', '/mapa');
  } catch (_) {}
}

function _bindInlineFleetRouteState() {
  if (_fleetInlineRouteBound) return;
  _fleetInlineRouteBound = true;
  window.addEventListener('popstate', () => {
    if (_isDedicatedCuadreIframeMode()) return;
    const modal = document.getElementById('fleet-modal');
    if (!modal) return;
    if (_isCuadreFleetMode()) {
      if (!modal.classList.contains('active')) {
        _openFleetModalInPlace(_cuadreInitialTab());
      } else {
        setTimeout(() => cambiarTabFlota(_cuadreInitialTab()), 0);
      }
      return;
    }
    if (modal.classList.contains('active')) {
      modal.classList.remove('active');
      sincronizarEstadoSidebars();
      refrescarDatos();
    }
  });
}

function _updateGlobalPlazaEmail() {
  window.__mexCurrentPlazaId = _miPlaza();
  if (typeof window.getPlazaActualEmail === 'function') {
    window.PLAZA_ACTUAL_EMAIL = window.getPlazaActualEmail();
  }
}

function _normalizeCorreosInternosEmpresa(empresa = window.MEX_CONFIG?.empresa || {}) {
  const normalized = [];
  const seen = new Map();
  const plazasDetalle = Array.isArray(empresa?.plazasDetalle) ? empresa.plazasDetalle : [];
  const rawList = Array.isArray(empresa?.correosInternos) ? empresa.correosInternos : [];

  function upsert(rawItem, fallback = {}) {
    const isObject = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem);
    const correo = _safeLower(isObject ? (rawItem.correo || rawItem.email || rawItem.mail) : rawItem);
    if (!correo) return;

    const next = {
      titulo: String(
        isObject
          ? (rawItem.titulo || rawItem.nombre || fallback.titulo || '')
          : (fallback.titulo || '')
      ).trim(),
      correo,
      plazaId: _safeUpper(isObject ? rawItem.plazaId : fallback.plazaId)
    };

    if (seen.has(correo)) {
      const current = seen.get(correo);
      if (!current.titulo && next.titulo) current.titulo = next.titulo;
      if (!current.plazaId && next.plazaId) current.plazaId = next.plazaId;
      return;
    }

    seen.set(correo, next);
    normalized.push(next);
  }

  rawList.forEach(item => upsert(item));

  plazasDetalle.forEach(plaza => {
    const plazaId = _safeUpper(plaza?.id);
    if (plaza?.correo) {
      upsert(
        { correo: plaza.correo, plazaId },
        { titulo: `${plazaId} INSTITUCIONAL`, plazaId }
      );
    }
    if (plaza?.correoGerente) {
      upsert(
        { correo: plaza.correoGerente, plazaId },
        { titulo: `${plazaId} GERENCIA`, plazaId }
      );
    }
  });

  return normalized;
}

function _syncEmpresaCorreosInternosState() {
  window.MEX_CONFIG = window.MEX_CONFIG || {};
  window.MEX_CONFIG.empresa = window.MEX_CONFIG.empresa || {};
  window.MEX_CONFIG.empresa.correosInternos = _normalizeCorreosInternosEmpresa(window.MEX_CONFIG.empresa);
  return window.MEX_CONFIG.empresa.correosInternos;
}

function _getAdminRouteSignature() {
  return `${window.location.pathname}${window.location.search || ''}`;
}

function _currentAdminDeviceId() {
  const snapshot = getCurrentDeviceSnapshot?.() || {};
  return String(snapshot?.currentDevice?.deviceId || snapshot?.currentDevice?.id || '').trim();
}

function _locationMapsUrl(exactLocation = null) {
  const lat = Number(exactLocation?.latitude);
  const lng = Number(exactLocation?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `https://maps.google.com/?q=${lat},${lng}`;
}

async function _pushAdminLocationToDevice(exactLocation = null, locationStatus = 'pending') {
  try {
    await syncCurrentDeviceContext({
      locationStatus,
      ...(exactLocation ? { exactLocation: { ...exactLocation, googleMapsUrl: _locationMapsUrl(exactLocation) } } : {})
    }, { force: true });
  } catch (error) {
    console.warn('No se pudo sincronizar la ubicación exacta del admin en el dispositivo:', error);
  }
}

async function _captureAdminExactLocation(options = {}) {
  if (typeof window.__mexGetExactLocationSnapshot === 'function') {
    const snapshot = await window.__mexGetExactLocationSnapshot({
      force: options.force === true,
      maxAgeMs: ADMIN_LOCATION_CACHE_MS,
      timeoutMs: 12000
    });
    _adminAuditLocationState.status = snapshot.status || 'pending';
    _adminAuditLocationState.exactLocation = snapshot.exactLocation ? { ...snapshot.exactLocation } : null;
    _adminAuditLocationState.lastUpdated = Number(snapshot.lastUpdated || Date.now());
    _adminAuditLocationState.error = String(snapshot.error || '').trim();
    await _pushAdminLocationToDevice(_adminAuditLocationState.exactLocation, _adminAuditLocationState.status);
    return { ..._adminAuditLocationState };
  }

  const force = options.force === true;
  const now = Date.now();
  if (!force && _adminAuditLocationState.lastUpdated && (now - _adminAuditLocationState.lastUpdated) < ADMIN_LOCATION_CACHE_MS) {
    return { ..._adminAuditLocationState };
  }

  if (!window.isSecureContext || !navigator.geolocation) {
    _adminAuditLocationState.status = 'unsupported';
    _adminAuditLocationState.exactLocation = null;
    _adminAuditLocationState.lastUpdated = now;
    await _pushAdminLocationToDevice(null, 'unsupported');
    return { ..._adminAuditLocationState };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const exactLocation = {
          latitude: Number(position.coords?.latitude || 0),
          longitude: Number(position.coords?.longitude || 0),
          accuracy: Number(position.coords?.accuracy || 0),
          capturedAt: Date.now(),
          source: 'browser'
        };
        _adminAuditLocationState.status = 'granted';
        _adminAuditLocationState.exactLocation = exactLocation;
        _adminAuditLocationState.lastUpdated = Date.now();
        _adminAuditLocationState.error = '';
        await _pushAdminLocationToDevice(exactLocation, 'granted');
        resolve({ ..._adminAuditLocationState });
      },
      async (error) => {
        const denied = Number(error?.code) === 1;
        _adminAuditLocationState.status = denied ? 'denied' : 'error';
        _adminAuditLocationState.exactLocation = null;
        _adminAuditLocationState.lastUpdated = Date.now();
        _adminAuditLocationState.error = String(error?.message || '').trim();
        await _pushAdminLocationToDevice(null, _adminAuditLocationState.status);
        resolve({ ..._adminAuditLocationState });
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: force ? 0 : 30000
      }
    );
  });
}

async function _adminAuditExtra(extra = {}, options = {}) {
  const snapshot = await _captureAdminExactLocation({ force: options.forceLocation === true });
  const payload = {
    ...extra,
    deviceId: _currentAdminDeviceId(),
    activeRoute: _getAdminRouteSignature(),
    locationStatus: snapshot.status || 'pending'
  };
  if (snapshot.exactLocation) {
    payload.exactLocation = {
      ...snapshot.exactLocation,
      googleMapsUrl: _locationMapsUrl(snapshot.exactLocation)
    };
  }
  return payload;
}

async function registrarEventoGestion(tipo, mensaje, extra = {}) {
  const auditExtra = await _adminAuditExtra(extra, { forceLocation: false });
  try {
    const callable = window._functions?.httpsCallable?.('recordAdminAuditEvent');
    if (callable) {
      try {
        await callable({
          tipo,
          mensaje,
          autor: USER_NAME || 'Sistema',
          plaza: _miPlaza(),
          extra: auditExtra
        });
        return;
      } catch (callableError) {
        console.warn('recordAdminAuditEvent falló; usando fallback cliente:', callableError);
      }
    }
    await api.registrarEventoGestion(tipo, mensaje, USER_NAME || 'Sistema', auditExtra);
  } catch (error) {
    console.warn('No se pudo registrar el evento de gestión:', error);
  }
}

function generarSlugArchivo(texto) {
  return String(texto || 'reporte')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'reporte';
}

function descargarArchivoLocal(nombreArchivo, contenido, mimeType) {
  const blob = new Blob([contenido], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function abrirReporteImpresion(htmlContenido) {
  const container = document.getElementById('reporte-pdf-container');
  if (!container) return;

  const originalScrollX = window.scrollX || window.pageXOffset || 0;
  const originalScrollY = window.scrollY || window.pageYOffset || 0;
  const originalBodyOverflow = document.body.style.overflow;
  const originalHtmlOverflow = document.documentElement.style.overflow;
  let cleaned = false;
  let fallbackTimer = null;
  let mediaQueryList = null;
  let mediaQueryHandler = null;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (mediaQueryList && mediaQueryHandler) {
      if (typeof mediaQueryList.removeEventListener === 'function') {
        mediaQueryList.removeEventListener('change', mediaQueryHandler);
      } else if (typeof mediaQueryList.removeListener === 'function') {
        mediaQueryList.removeListener(mediaQueryHandler);
      }
    }
    container.innerHTML = '';
    container.style.display = 'none';
    document.body.style.overflow = originalBodyOverflow;
    document.documentElement.style.overflow = originalHtmlOverflow;
    window.requestAnimationFrame(() => {
      window.scrollTo(originalScrollX, originalScrollY);
    });
  };

  window.addEventListener('afterprint', cleanup, { once: true });
  container.innerHTML = htmlContenido;
  container.style.display = 'block';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';

  try {
    mediaQueryList = window.matchMedia('print');
    mediaQueryHandler = event => {
      if (!event.matches) cleanup();
    };
    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', mediaQueryHandler);
    } else if (typeof mediaQueryList.addListener === 'function') {
      mediaQueryList.addListener(mediaQueryHandler);
    }
  } catch (_) {}

  setTimeout(() => {
    try {
      window.print();
      fallbackTimer = setTimeout(cleanup, 12000);
    } catch (error) {
      cleanup();
      console.error('No se pudo abrir la impresión:', error);
      showToast('No se pudo abrir el generador de PDF.', 'error');
    }
  }, 80);
}

function formatearFechaDocumento(fechaTexto) {
  const fecha = new Date(fechaTexto);
  if (Number.isNaN(fecha.getTime())) return String(fechaTexto || '');
  return fecha.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// auth ya está declarada en mex-api.js — no redeclarar

// Handler único: valida por email (funciona con Google y email/contraseña)
auth.onAuthStateChanged(async (user) => {
  _trackLegacyListener('create', 'auth-state');
  if (SHOULD_SKIP_MAIN_MAP_BOOTSTRAP) {
    console.info('[MEX-ROUTE] mapa.js bootstrap omitido en ruta standalone:', window.location.pathname);
    return;
  }
  if (user) {
    const emailNormalizado = _profileDocId(user?.email || '');
    try {
      // Force token refresh so Firestore security rules get the auth context immediately
      await user.getIdToken(true);
      let perfilValidado = null;
      const cachedProfile = typeof window.__mexLoadCurrentUserRecord === 'function'
        ? await window.__mexLoadCurrentUserRecord(user).catch(() => null)
        : null;
      let docs = cachedProfile ? [cachedProfile] : [];

      if (!docs.length && user.uid) {
        const uidSnap = await db.collection(COL.USERS).doc(user.uid).get();
        if (uidSnap.exists) {
          docs = [{ id: uidSnap.id, email: emailNormalizado, ...uidSnap.data() }];
        }
      }

      if (docs.length) {
        const bestMatch = docs.find(d => d.id === emailNormalizado)
          || docs.find(d => d.id === user.uid)
          || docs[0];
        const datos = _normalizeUserProfile(bestMatch);
        _setSessionProfile(datos);
        configurarPermisosUI();
        perfilValidado = datos;
      } else if (_isBootstrapProgrammerEmail(emailNormalizado)) {
        try {
          const datosProvisionados = await _ensureBootstrapProgrammerProfile(user);
          if (datosProvisionados) {
            console.warn('[AUTH] Bootstrap programmer sin doc en Firestore — perfil autoprovisionado');
            _setSessionProfile(datosProvisionados);
            configurarPermisosUI();
            perfilValidado = datosProvisionados;
          }
        } catch (bootstrapError) {
          console.warn('[AUTH] No se pudo autoprovisionar el perfil PROGRAMADOR:', bootstrapError);
        }

        if (!perfilValidado) {
          // Último fallback: mantener acceso visual para no bloquear la sesión
          const datosSinteticos = _normalizeUserProfile({
            id: emailNormalizado,
            email: emailNormalizado,
            nombre: user.displayName || 'PROGRAMADOR',
            rol: 'PROGRAMADOR',
            isAdmin: true,
            isGlobal: true,
            plazaAsignada: '',
            telefono: '',
            status: 'ACTIVO',
            _syntheticProfile: true
          });
          _setSessionProfile(datosSinteticos);
          configurarPermisosUI();
          perfilValidado = datosSinteticos;
        }
      } else {
        // Email no autorizado — redirigir a login con mensaje
        auth.signOut();
        sessionStorage.setItem('login_error', `❌ El correo ${user.email} no tiene permisos en el sistema.`);
        window.location.replace('/login');
        return;
      }
    } catch (e) {
      console.error("Error validando usuario:", e);
      const fallbackDisplayName = String(
        user?.displayName
        || currentUserProfile?.nombreCompleto
        || currentUserProfile?.displayName
        || currentUserProfile?.nombre
        || currentUserProfile?.usuario
        || (user?.email ? user.email.split('@')[0] : '')
        || 'USUARIO'
      ).trim();
      const fallbackRole = String(
        currentUserProfile?.rol
        || (typeof userAccessRole !== 'undefined' ? userAccessRole : '')
        || (typeof _isBootstrapProgrammerEmail === 'function' && _isBootstrapProgrammerEmail(emailNormalizado) ? 'PROGRAMADOR' : 'AUXILIAR')
        || 'AUXILIAR'
      ).trim().toUpperCase();
      if (user?.email) {
        const datosSinteticos = _normalizeUserProfile({
          id: emailNormalizado,
          email: emailNormalizado,
          nombre: fallbackDisplayName,
          nombreCompleto: fallbackDisplayName,
          displayName: fallbackDisplayName,
          usuario: fallbackDisplayName,
          nombreUsuario: fallbackDisplayName,
          rol: fallbackRole,
          plazaAsignada: currentUserProfile?.plazaAsignada || _miPlaza() || '',
          telefono: currentUserProfile?.telefono || '',
          status: 'ACTIVO',
          isAdmin: currentUserProfile?.isAdmin === true || fallbackRole === 'PROGRAMADOR',
          isGlobal: currentUserProfile?.isGlobal === true,
          permissionOverrides: currentUserProfile?.permissionOverrides || {},
          _syntheticProfile: true
        });
        _setSessionProfile(datosSinteticos);
        configurarPermisosUI();
        perfilValidado = datosSinteticos;
        console.warn('[AUTH] Fallback de perfil activado tras error de conexión:', { email: emailNormalizado, rol: fallbackRole });
      } else {
        sessionStorage.setItem('login_error', '❌ Error de conexión. Intenta de nuevo.');
        window.location.replace('/login');
        return;
      }
    }
    if (typeof window.__mexRequireLocationAccess === 'function') {
      await window.__mexRequireLocationAccess({
        title: 'Ubicacion obligatoria para entrar',
        copy: 'Activa tu ubicacion exacta para permitir auditoria de movimientos, cambios globales y eventos operativos dentro de la plataforma.',
        allowLogout: true,
        force: false
      });
    }
    // iniciarApp fuera del try/catch: errores de UI no deben redirigir a /login
    iniciarApp(true);
  } else {
    // Sin sesión — redirigir a /login
    _detenerPresenciaUsuario(false);
    _clearSessionProfile();
    window.location.replace('/login');
  }
});


// loginManual, loginConGoogle, togglePassword, showLoginError, _resetLoginButtons,
// abrirModalSolicitud, cerrarModalSolicitud — definidos en el módulo de autenticación
// (script aislado antes del admin-sidebar)

async function enviarSolicitudAcceso() {
  const REQUEST_COLLECTION = 'solicitudes';
  const nombre = document.getElementById('sol_nombre').value.trim().toUpperCase();
  const email = document.getElementById('sol_email').value.trim().toLowerCase();
  const puesto = document.getElementById('sol_puesto').value.trim().toUpperCase();
  const telefono = document.getElementById('sol_telefono').value.trim();
  const pass = document.getElementById('sol_pass').value;
  const passConfirm = document.getElementById('sol_pass_confirm').value;
  const btn = document.getElementById('btnEnviarSolicitud');
  const emailNormalizado = _profileDocId(email);
  const rolSolicitado = _inferRequestedAccessRole(puesto, emailNormalizado);

  // Validaciones con Toasts de error
  if (!nombre || !email || !puesto || !telefono || !pass || !passConfirm) {
    return showToast("Llena todos los campos del formulario", "error");
  }
  if (pass.length < 6) {
    return showToast("La contraseña debe tener mínimo 6 caracteres", "error");
  }
  if (pass !== passConfirm) {
    document.getElementById('sol_pass_confirm').value = "";
    document.getElementById('sol_pass_confirm').focus();
    return showToast("Las contraseñas no coinciden", "error");
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="material-icons spinner" style="font-size: 18px; vertical-align: middle;">sync</span> ENVIANDO...`;

  try {
    await db.collection(REQUEST_COLLECTION).doc(emailNormalizado).set({
      nombre: nombre,
      email: emailNormalizado,
      puesto: puesto,
      telefono: telefono,
      password: pass,
      rolSolicitado: rolSolicitado,
      plazaSolicitada: "",
      fecha: new Date().toISOString(),
      estado: "PENDIENTE",
      _ts: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Toast de éxito y limpieza
    showToast("Solicitud enviada a revisión", "success");

    document.getElementById('sol_nombre').value = "";
    document.getElementById('sol_email').value = "";
    document.getElementById('sol_puesto').value = "";
    document.getElementById('sol_telefono').value = "";
    document.getElementById('sol_pass').value = "";
    document.getElementById('sol_pass_confirm').value = "";

    cerrarModalSolicitud();
  } catch (error) {
    console.error("Error al guardar solicitud:", error);
    showToast(error && error.message ? error.message : "Error de conexión al enviar", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `ENVIAR SOLICITUD`;
  }
}

function renderModernDropdown(usersList) {
  const listDiv = document.getElementById('dropdownList');
  if (!listDiv) return;
  if (usersList.length === 0) {
    listDiv.innerHTML = '<div style="padding:15px; text-align:center; color:#ef4444; font-weight:800;">🚫 No encontrado</div>';
    return;
  }
  listDiv.innerHTML = usersList.map(u =>
    `<div class="dropdown-item" onclick="seleccionarUsuario('${u.usuario}')">
       <span class="material-icons" style="color:#94a3b8; font-size:18px;">person</span> ${u.usuario}
     </div>`
  ).join('');
}

function filterModernUsers() {
  const searchInput = document.getElementById('dropdownSearchInput');
  if (!searchInput) return;
  const term = searchInput.value.toLowerCase().trim();
  const filtered = dbUsuariosLogin.filter(u => u.usuario.toLowerCase().includes(term));
  renderModernDropdown(filtered);
}

// Cierra el menú al hacer clic afuera
document.addEventListener('click', (e) => {
  const wrapper = document.getElementById('loginUserWrapper');
  const drop = document.getElementById('modernDropdown');
  if (wrapper && !wrapper.contains(e.target) && drop && drop.classList.contains('show')) {
    toggleModernDropdown();

  }
});


// Trigger de Enter (el elemento puede no existir en mapa.html)
const _authPassEl = document.getElementById('auth_pass');
if (_authPassEl) {
  _authPassEl.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') loginManual();
  });
}



function iniciarApp(esNuevoLogin = true) {
  // Asegurar que overlays de carga no bloqueen la UI
  document.documentElement.classList.remove('mex-app-booting');
  const _locGate = document.getElementById('mexLocationGateOverlay');
  if (_locGate) _locGate.style.display = 'none';
  // Limpiar URLs inline de sesiones anteriores al hacer nuevo login
  if (esNuevoLogin && !_isDedicatedGestionIframeMode() && !_isDedicatedCuadreIframeMode()) {
    // Solo limpiar URL si estamos realmente dentro del mapa principal con una ruta inline sobrante.
    const _isGestionStandalone = !!document.getElementById('gestion-auth-loader');
    const _isMensajesStandalone = /^\/mensajes(?:\.html)?$/i.test(window.location.pathname || '');
    const _isCuadreStandalone = /^\/cuadre(?:\.html)?$/i.test(window.location.pathname || '');
    if (!_isGestionStandalone && !_isMensajesStandalone && !_isCuadreStandalone && /^\/(gestion|mensajes|cuadre)(?:\.html)?/i.test(window.location.pathname || '')) {
      try { window.history.replaceState({}, '', '/mapa'); } catch (_) {}
    }
  }
  const _loginOverlay = document.getElementById('login-overlay');
  if (_loginOverlay) _loginOverlay.style.display = 'none';

  // Modo mensajes: aplicar clase de inmediato para evitar flash del mapa
  if (_isMessagesMode()) {
    document.body.classList.add('messages-mode');
  }

  _actualizarIdentidadSidebarUsuario();
  window._openAlertsOrNotifications = _openAlertsOrNotifications;
  configureNotifications({
    profileGetter: () => currentUserProfile || window.CURRENT_USER_PROFILE || null,
    getCurrentUserName: () => USER_NAME,
    getCurrentUserDocId: () => _currentUserDocId(),
    getCurrentPlaza: () => _miPlaza(),
    toast: showToast,
    routeHandlers: {
      openChat:   nombre => _abrirChatDesdeNotificacion(nombre),
      openBuzon:  () => abrirBuzon(),
      openCuadre: () => _abrirCuadreDesdeNotificacion(),
      openAlerts: () => abrirSiguienteAlerta()
    }
  });
  if (typeof window.__mexGetLastLocationAuditPayload === 'function') {
    syncCurrentDeviceContext(window.__mexGetLastLocationAuditPayload(), { force: true }).catch(() => {});
    if (!window.__mexLocationSyncHandlerBound) {
      window.addEventListener('mex-location-updated', event => {
        const detail = event?.detail || {};
        const payload = {
          locationStatus: detail.status || 'pending'
        };
        if (detail.exactLocation) payload.exactLocation = { ...detail.exactLocation };
        syncCurrentDeviceContext(payload, { force: true }).catch(() => {});
      });
      window.__mexLocationSyncHandlerBound = true;
    }
  }
  _iniciarPresenciaUsuario();

  // Cerramos sidebars
  closeMainSidebars();

  // Mostramos botones de alertas/admin
  if (document.getElementById('btnAlerts')) document.getElementById('btnAlerts').style.display = 'flex';
  if (document.getElementById('btnAdmin')) document.getElementById('btnAdmin').style.display = 'flex';
  if (document.getElementById('btnBuzon')) document.getElementById('btnBuzon').style.display = 'flex';
  if (document.getElementById('btnNotificationCenter')) document.getElementById('btnNotificationCenter').style.display = 'flex';


  if (esNuevoLogin) {
    const btn = document.getElementById('btnLoginBtn');
    if (btn) { btn.disabled = false; btn.innerText = "INGRESAR"; }
  }

  const isDedicatedCuadreRoute = _isDedicatedCuadreIframeMode();
  if (!isDedicatedCuadreRoute) {
    iniciarRadarNotificaciones();
    _scheduleInitialRadarPing();
  }

  // Re-cargar config después de auth — garantiza que persistence esté lista
  // y que los selects estén poblados con datos frescos de Firestore
  const configReadyPromise = inicializarConfiguracion();

  _iniciarSincronizacionUsuarios(); // Poblar dbUsuariosLogin en tiempo real
  init(); // Carga el mapa
  setTimeout(() => _applyPendingShellSearch(), 900);
  _schedulePrivilegedRoutePrefetch();

  // [TEST] Abrir editor de mapa directamente si ?editor=1 en la URL
  if (new URLSearchParams(window.location.search).get('editor') === '1') {
    setTimeout(() => abrirEditorMapa(), 800);
  }
  if (!isDedicatedCuadreRoute) {
    initNotificationCenter()
      .then(() => {
        _renderNotificationProfileState();
        setTimeout(() => consumeNotificationDeepLink(), 550);
      })
      .catch(error => {
        console.warn('No se pudo inicializar el centro de notificaciones:', error);
        reportProgrammerError({
          kind: 'notifications.init',
          scope: 'mapa',
          message: error?.message || 'No se pudo inicializar notificaciones',
          stack: error?.stack || ''
        });
      });
  }

  Promise.resolve(configReadyPromise)
    .finally(() => {
      if (_isGestionAdminMode()) {
        _bootGestionAdminRoute().catch(error => {
          console.warn('No se pudo abrir el modo gestion dedicado:', error);
        });
      }
      if (_isMessagesMode()) {
        _bootMessagesRoute();
      }
      if (_isCuadreFleetMode()) {
        try {
          _bootCuadreFleetRoute();
        } catch (error) {
          console.warn('No se pudo abrir el modo flota dedicado:', error);
        }
      }
    });

  // [F2.7] Qué cambió desde última visita
  _registrarYMostrarResumenVisita();

  // Notificar a gestion.html que la app está lista
  window.dispatchEvent(new CustomEvent('mex-app-ready'));
}

function _registrarYMostrarResumenVisita() {
  const email = auth.currentUser?.email || '';
  if (!email) return;
  const clave = `mex_lastVisit_${_profileDocId(email)}`;
  const plaza = _miPlaza();
  const ahora = Date.now();
  const ultimaVisita = Number(localStorage.getItem(clave) || 0);

  // Guardar nueva visita
  localStorage.setItem(clave, String(ahora));

  // Sólo mostrar resumen si la visita anterior fue hace más de 10 min
  const MIN_GAP = 10 * 60 * 1000;
  if (!ultimaVisita || (ahora - ultimaVisita) < MIN_GAP) return;

  // Consultar movimientos recientes desde la última visita (máx 50)
  setTimeout(async () => {
    try {
      const desde = ultimaVisita;
      let query = db.collection('historial_patio')
        .where('timestamp', '>', desde)
        .orderBy('timestamp', 'desc')
        .limit(50);
      if (plaza) query = db.collection('historial_patio')
        .where('plaza', '==', plaza)
        .where('timestamp', '>', desde)
        .orderBy('timestamp', 'desc')
        .limit(50);

      const snap = await query.get();
      if (snap.empty) return;

      const movimientos = snap.docs.map(d => d.data());
      const totalMovs    = movimientos.filter(m => m.tipo === 'MOVE' || m.tipo === 'SWAP').length;
      const totalEntradas = movimientos.filter(m => String(m.posAnterior || '').toUpperCase() === 'LIMBO').length;
      const totalSalidas  = movimientos.filter(m => String(m.posNueva || '').toUpperCase() === 'LIMBO').length;

      if (totalMovs + totalEntradas + totalSalidas === 0) return;

      const fechaFormato = new Date(ultimaVisita).toLocaleString('es-MX', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });

      const partes = [];
      if (totalMovs > 0)     partes.push(`${totalMovs} movimiento${totalMovs > 1 ? 's' : ''}`);
      if (totalEntradas > 0) partes.push(`${totalEntradas} entrada${totalEntradas > 1 ? 's' : ''}`);
      if (totalSalidas > 0)  partes.push(`${totalSalidas} salida${totalSalidas > 1 ? 's' : ''}`);

      showToast(`Desde tu última visita (${fechaFormato}): ${partes.join(', ')} en el patio.`, 'info');
    } catch (_) {
      // Silencioso — no es crítico
    }
  }, 3500);
}

function _iniciarSincronizacionUsuarios() {
  if (_unsubUsersLive) { _unsubUsersLive(); _unsubUsersLive = null; _trackLegacyListener('cleanup', 'users-live'); }

  _unsubUsersLive = db.collection(COL.USERS).onSnapshot(snap => {
    dbUsuariosLogin = snap.docs
      .map(d => _normalizeUserProfile({ id: d.id, ...d.data() }))
      .sort((a, b) => a.usuario.localeCompare(b.usuario));
    if (typeof renderModernDropdown === 'function') renderModernDropdown(dbUsuariosLogin);
    if (document.getElementById('crear-alerta-modal')?.classList.contains('active') && typeof _renderDestinatariosAlerta === 'function') {
      _renderDestinatariosAlerta();
      _updateBtnEmitir();
    }

    // Detectar si el usuario actual tiene _reloadRequired → recargar permisos
    const myEmail = _profileDocId(auth.currentUser?.email || '');
    if (myEmail) {
      const myDoc = snap.docs.find(d => d.id === myEmail);
      if (myDoc?.exists) {
        const perfilActualizado = _normalizeUserProfile({ id: myDoc.id, ...myDoc.data() });
        currentUserProfile = perfilActualizado;
        window.CURRENT_USER_PROFILE = perfilActualizado;
        _actualizarIdentidadSidebarUsuario();
        if (document.getElementById('perfil-modal')?.classList.contains('active') && typeof _renderPerfilUsuarioActual === 'function') {
          _renderPerfilUsuarioActual();
          _renderNotificationProfileState();
        }
        if (document.getElementById('buzon-modal')?.classList.contains('active') && typeof renderContactos === 'function') {
          renderContactos();
          if (activeChatUser && typeof _actualizarHeaderChatActivo === 'function') _actualizarHeaderChatActivo();
        }
      }
      const _reloadFlagStorageKey = email => `mex.reload.handled.${_profileDocId(email)}`;
      const _reloadFlagMarker = profile => JSON.stringify({
        rol: _sanitizeRole(profile?.rol || ''),
        plaza: _normalizePlaza(profile?.plazaAsignada || profile?.plaza || ''),
        plazasPermitidas: Array.isArray(profile?.plazasPermitidas) ? [...profile.plazasPermitidas].filter(Boolean).sort() : [],
        status: String(profile?.status || '').trim().toUpperCase(),
        version: String(profile?._version || profile?.version || ''),
        updatedAt: String(_coerceTimestamp(profile?._updatedAt || profile?.updatedAt || profile?.lastTouchedAt || 0)),
        permissionOverrides: Object.entries(_normalizePermissionOverrides(profile?.permissionOverrides || profile?.permisosUsuario || {}))
          .sort(([a], [b]) => a.localeCompare(b))
      });
      const _clearReloadTracking = email => {
        try {
          sessionStorage.removeItem('_reloadGuard');
          localStorage.removeItem(_reloadFlagStorageKey(email));
        } catch (_) { }
      };

      const docData = myDoc?.data() || null;
      const reloadMarker = _reloadFlagMarker({ ...docData, ...(currentUserProfile || {}) });
      const handledMarker = (() => {
        try {
          return localStorage.getItem(_reloadFlagStorageKey(myEmail)) || '';
        } catch (_) {
          return '';
        }
      })();

      if (docData?._reloadRequired && !sessionStorage.getItem('_reloadGuard') && handledMarker !== reloadMarker) {
        // Anti-loop real:
        // 1) Marcamos el cambio como consumido en localStorage por "firma" del perfil
        // 2) El guard de sessionStorage evita reentradas durante el mismo reload
        // 3) Si Firestore niega limpiar el flag, no volveremos a recargar por la misma firma
        try {
          sessionStorage.setItem('_reloadGuard', '1');
          localStorage.setItem(_reloadFlagStorageKey(myEmail), reloadMarker);
        } catch (_) { }

        db.collection(COL.USERS).doc(myEmail)
          .update({ _reloadRequired: false })
          .catch(err => {
            console.warn('[_reloadRequired] No se pudo limpiar flag:', err.code);
          });

        showToast('Tus permisos fueron actualizados. Recargando...', 'warning');
        setTimeout(() => {
          window.location.reload();
        }, 1400);
      } else if (!docData?._reloadRequired) {
        // En cuanto el flag realmente desaparece, liberamos la protección para futuros cambios.
        _clearReloadTracking(myEmail);
      }
    }
  }, err => console.warn('onSnapshot usuarios live:', err));
  _trackLegacyListener('create', 'users-live');
}

function cerrarSesion() {
  _detenerPresenciaUsuario(true);
  teardownNotificationCenter();
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  _limpiarRadar();
  if (_unsubMapa) { _unsubMapa(); _unsubMapa = null; _trackLegacyListener('cleanup', 'mapa-sub'); }
  if (_unsubMapaEstructura) { _unsubMapaEstructura(); _unsubMapaEstructura = null; }
  if (_unsubUsersLive) { _unsubUsersLive(); _unsubUsersLive = null; _trackLegacyListener('cleanup', 'users-live'); }
  if (saveTimeout) { clearTimeout(saveTimeout); saveTimeout = null; }
  dbUsuariosLogin = [];
  _mapaRuntime.pendingUnits = null;
  _mapaSyncState.hasPendingWrite = false;
  _mapaSyncState.lastSavedFingerprint = '';
  isMoving = false;
  isSaving = false;

  // Destruir la sesión iniciada
  localStorage.removeItem('mex_mapa_session');

  _clearSessionProfile();

  document.getElementById('btnAdmin').style.display = 'none';
  if (document.getElementById('btnAlerts')) document.getElementById('btnAlerts').style.display = 'none';
  if (document.getElementById('btnBuzon')) document.getElementById('btnBuzon').style.display = 'none';
  if (document.getElementById('btnNotificationCenter')) document.getElementById('btnNotificationCenter').style.display = 'none';

  toggleAdminSidebar(false);
  document.getElementById('fleet-modal').classList.remove('active');
  sincronizarEstadoSidebars();

  // 🛑 APAGAR OVERLAY DE AUDITORIA DE INMEDIATO
  const auditOverlay = document.getElementById('overlayAuditoria');
  if (auditOverlay) {
    auditOverlay.style.display = 'none';
    auditOverlay.className = "";
  }

  cerrarPanel();
  cerrarCustomModal();

  // signOut dispara onAuthStateChanged(null) → redirige a /login
  auth.signOut().catch(e => console.warn("signOut error:", e));
}

function _formatAdminUnitLabel(unit = {}) {
  const pieces = [
    unit.mva,
    unit.placas,
    unit.modelo,
    unit.categoria || unit.categ,
    unit.plaza || unit.sucursal
  ].filter(Boolean);
  return pieces.join(' • ').toUpperCase();
}

function _buildAdminSearchIndex(unit = {}) {
  return [
    unit.mva,
    unit.placas,
    unit.modelo,
    unit.categoria,
    unit.categ,
    unit.plaza,
    unit.sucursal,
    unit.marca,
    unit.vin
  ].filter(Boolean).join(' ').toUpperCase();
}

function _normalizeAdminMaestraUnit(unit = {}) {
  const plaza = _normalizePlaza(unit.plaza || unit.sucursal || unit.plazaId || '');
  const categoria = String(unit.categoria || unit.categ || '').trim().toUpperCase();
  const modelo = String(unit.modelo || '').trim().toUpperCase();
  const placas = String(unit.placas || '').trim().toUpperCase();
  const mva = String(unit.mva || '').trim().toUpperCase();
  const normalized = {
    ...unit,
    plaza,
    sucursal: plaza,
    categoria,
    categ: categoria,
    modelo,
    placas,
    mva
  };
  normalized.etiqueta = _formatAdminUnitLabel(normalized);
  normalized.searchIndex = _buildAdminSearchIndex(normalized);
  return normalized;
}

function _dedupeAdminMaestra(units = []) {
  const seen = new Set();
  return units.reduce((acc, unit) => {
    const normalized = _normalizeAdminMaestraUnit(unit);
    if (!normalized.mva || seen.has(normalized.mva)) return acc;
    seen.add(normalized.mva);
    acc.push(normalized);
    return acc;
  }, []).sort((a, b) => {
    const plazaCompare = String(a.plaza || '').localeCompare(String(b.plaza || ''));
    if (plazaCompare !== 0) return plazaCompare;
    return String(a.mva || '').localeCompare(String(b.mva || ''));
  });
}

function _adminMaestraCacheRead() {
  try {
    const raw = sessionStorage.getItem(ADMIN_MAESTRA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    if ((Date.now() - Number(parsed.savedAt || 0)) > ADMIN_MAESTRA_CACHE_TTL_MS) return null;
    return _dedupeAdminMaestra(parsed.rows);
  } catch (_) {
    return null;
  }
}

function _adminMaestraCacheWrite(rows = []) {
  try {
    sessionStorage.setItem(ADMIN_MAESTRA_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      rows
    }));
  } catch (_) { }
}

function _setAdminMaestraRows(rows = [], source = 'remote') {
  DB_MAESTRA = _dedupeAdminMaestra(rows);
  DB_MAESTRA_READY = DB_MAESTRA.length > 0;
  _adminMaestraCacheWrite(DB_MAESTRA);
  const hint = document.getElementById('a_ins_searchMeta');
  if (hint) {
    hint.innerHTML = `
      <span class="material-icons" style="font-size:14px;">dataset</span>
      ${DB_MAESTRA.length.toLocaleString('es-MX')} unidades indexadas · ${source === 'cache' ? 'cache local' : 'base global'}
    `;
  }
}

function _scoreAdminMaestraMatch(unit = {}, term = '') {
  const cleanTerm = String(term || '').trim().toUpperCase();
  if (!cleanTerm) return 0;
  const mva = String(unit.mva || '').toUpperCase();
  const placas = String(unit.placas || '').toUpperCase();
  const modelo = String(unit.modelo || '').toUpperCase();
  const plaza = String(unit.plaza || unit.sucursal || '').toUpperCase();
  const index = String(unit.searchIndex || '').toUpperCase();
  const tokens = cleanTerm.split(/\s+/).filter(Boolean);
  let score = 0;

  if (mva === cleanTerm) score += 180;
  else if (mva.startsWith(cleanTerm)) score += 120;
  else if (mva.includes(cleanTerm)) score += 90;

  if (placas === cleanTerm) score += 170;
  else if (placas.startsWith(cleanTerm)) score += 115;
  else if (placas.includes(cleanTerm)) score += 80;

  if (modelo.startsWith(cleanTerm)) score += 70;
  else if (modelo.includes(cleanTerm)) score += 55;

  if (plaza === cleanTerm) score += 40;

  tokens.forEach(token => {
    if (mva.includes(token)) score += 28;
    if (placas.includes(token)) score += 22;
    if (modelo.includes(token)) score += 16;
    if (index.includes(token)) score += 8;
  });

  return score;
}

async function cargarMaestra(force = false) {
  const cached = !force ? _adminMaestraCacheRead() : null;
  if (cached && cached.length > 0) {
    _setAdminMaestraRows(cached, 'cache');
  }

  if (_adminMaestraPromise && !force) return _adminMaestraPromise;

  _adminMaestraPromise = api.obtenerUnidadesPlazas().then(data => {
    _setAdminMaestraRows(data || [], 'remote');
    return DB_MAESTRA;
  }).catch(e => {
    console.error(e);
    if (!DB_MAESTRA.length) DB_MAESTRA_READY = false;
    throw e;
  }).finally(() => {
    _adminMaestraPromise = null;
  });

  return _adminMaestraPromise;
}

// ==========================================
// 2. LÓGICA DEL MAPA PRINCIPAL Y ZOOM NATIVO
// ==========================================
let selectedAuto = null;
let MAP_SWAP_MODE_ACTIVE = false;
let zoomLevel = 0.8;
const MAP_MIN_ZOOM = 0.3;
const MAP_MAX_ZOOM = 1.5;
isSaving = false;
let isMoving = false; // 🔥
let autoRefreshInterval = null; // mantenido por compatibilidad pero no se usa para el mapa
let _unsubMapa = null;          // función para cancelar onSnapshot del mapa
let _unsubMapaEstructura = null;
let _subPlaza = null;           // plaza actualmente suscrita (guard para evitar reinicios duplicados)
let _unsubUsersLive = null;     // función para cancelar onSnapshot de usuarios (chat/dropdown)
function _trackLegacyListener(action, name, extra = {}) {
  if (typeof window.__mexTrackListener !== 'function') return;
  window.__mexTrackListener(window.location.pathname, `legacy/mapa:${name}`, action, extra);
}
let saveTimeout = null;
let lastMoveTime = 0;
const MAPA_SAVE_DEBOUNCE_MS = 120;
const MAPA_SAVE_RETRY_MS = 2500;
let _mapaRenderRAF = 0;
let _mapDragSuppressClickUntil = 0;
let _mapDragState = {
  sourceCar: null,
  sourceSpot: null,
  currentZone: null,
  ghost: null,
  touchTimer: null,
  pendingTouch: null,
  activeTouchId: null,
  pendingPointer: null,
  activePointerId: null,
  active: false
};
let _plazaPrefetchPromises = new Map();
let _plazaSwitchState = {
  token: 0,
  plaza: '',
  structureReady: false,
  unitsReady: false,
  hideTimer: null
};
let _ultimaFlotaMapa = [];
let _ultimaEstructuraMapa = [];
let _mapaRuntime = {
  estructuraReady: false,
  unidadesReady: false,
  estructuraSig: '',
  viewportBound: false,
  gesturesBound: false,
  dragBindingsBound: false,
  pinchState: null,
  pendingUnits: null,
  rolePrefetchScheduled: false,
  plazaPrefetchScheduled: false,
  adminWarmupScheduled: false
};
let _mapaSyncState = {
  hasPendingWrite: false,
  lastSavedFingerprint: '',
  lastConflicts: []
};
let _currentMapViewModel = { cajones: [], unitMap: new Map(), stats: {} };
let _initialRadarPingHandle = null;
const MAP_LOCAL_CACHE_PREFIX = 'mex:mapa:cache';
const MAP_LOCAL_CACHE_VERSION = 1;
const MAP_LOCAL_STRUCTURE_TTL_MS = 12 * 60 * 60 * 1000;
const MAP_LOCAL_UNITS_TTL_MS = 5 * 60 * 1000;

function _getMapaDiagnosticsSnapshot() {
  return {
    plaza: _normalizePlaza(_miPlaza?.() || window.__mexCurrentPlazaId || ''),
    listeners: {
      mapa: Boolean(_unsubMapa),
      estructura: Boolean(_unsubMapaEstructura),
      usersLive: Boolean(_unsubUsersLive)
    },
    runtime: {
      unidadesReady: Boolean(_mapaRuntime?.unidadesReady),
      estructuraReady: Boolean(_mapaRuntime?.estructuraReady),
      hasPendingWrite: Boolean(_mapaSyncState?.hasPendingWrite)
    },
    timestamps: {
      emittedAt: Date.now()
    }
  };
}

window.__mexMapaDiagnostics = Object.assign(window.__mexMapaDiagnostics || {}, {
  getSnapshot: _getMapaDiagnosticsSnapshot
});

function _mapCacheScope(plaza = _miPlaza()) {
  return _normalizePlaza(plaza || 'GLOBAL') || 'GLOBAL';
}

function _mapCacheKey(kind, plaza = _miPlaza()) {
  return `${MAP_LOCAL_CACHE_PREFIX}:${MAP_LOCAL_CACHE_VERSION}:${kind}:${_mapCacheScope(plaza)}`;
}

function _readMapCache(kind, plaza, ttlMs) {
  try {
    const raw = localStorage.getItem(_mapCacheKey(kind, plaza));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const savedAt = Number(parsed.savedAt || 0);
    if (!savedAt) return null;
    if (ttlMs > 0 && (Date.now() - savedAt) > ttlMs) return null;
    return parsed.data ?? null;
  } catch (_) {
    return null;
  }
}

function _scheduleMapCacheWrite(kind, plaza, data) {
  const payload = { savedAt: Date.now(), data };
  const persist = () => {
    try {
      localStorage.setItem(_mapCacheKey(kind, plaza), JSON.stringify(payload));
    } catch (_) { /* noop */ }
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(persist, { timeout: 700 });
  } else {
    setTimeout(persist, 32);
  }
}

function _serializeMapUnitForCache(unit = {}) {
  const normalized = _normalizarUnidadMapa(unit);
  return {
    mva: normalized.mva || '',
    pos: normalized.pos || 'LIMBO',
    ubicacion: normalized.ubicacion || '',
    estado: normalized.estado || '',
    gasolina: normalized.gasolina || '',
    notas: normalized.notas || '',
    placas: normalized.placas || '',
    modelo: normalized.modelo || '',
    categoria: normalized.categoria || '',
    fechaIngreso: normalized.fechaIngreso || '',
    plaza: normalized.plaza || '',
    traslado_destino: normalized.traslado_destino || '',
    version: Number(normalized.version || 0) || 0,
    lastTouchedAt: normalized.lastTouchedAt || null,
    lastTouchedBy: normalized.lastTouchedBy || '',
    tipo: normalized.tipo || ''
  };
}

function _persistMapStructureCache(estructura = [], plaza = _miPlaza()) {
  if (!Array.isArray(estructura) || estructura.length === 0) return;
  _scheduleMapCacheWrite('estructura', plaza, estructura);
}

function _persistMapUnitsCache(unidades = [], plaza = _miPlaza()) {
  if (!Array.isArray(unidades) || unidades.length === 0) return;
  _scheduleMapCacheWrite(
    'unidades',
    plaza,
    unidades.map(_serializeMapUnitForCache).filter(item => item?.mva)
  );
}

function _resolveMapCachePresence(plaza = _miPlaza()) {
  const plazaScope = _mapCacheScope(plaza);
  return {
    plaza: plazaScope,
    structure: Array.isArray(_readMapCache('estructura', plazaScope, MAP_LOCAL_STRUCTURE_TTL_MS)),
    units: Array.isArray(_readMapCache('unidades', plazaScope, MAP_LOCAL_UNITS_TTL_MS))
  };
}

function _hydrateMapFromLocalCache(plaza = _miPlaza()) {
  const plazaScope = _mapCacheScope(plaza);
  const cachedStructure = _readMapCache('estructura', plazaScope, MAP_LOCAL_STRUCTURE_TTL_MS);
  const cachedUnits = _readMapCache('unidades', plazaScope, MAP_LOCAL_UNITS_TTL_MS);
  const result = { hydrated: false, structure: false, units: false, plaza: plazaScope };

  if (Array.isArray(cachedStructure) && cachedStructure.length > 0) {
    console.log('[MEX-CACHE] estructura local →', { plaza: plazaScope, celdas: cachedStructure.length });
    _mapaRuntime.estructuraReady = true;
    dibujarMapaCompleto(cachedStructure);
    result.hydrated = true;
    result.structure = true;
  }

  if (Array.isArray(cachedUnits) && cachedUnits.length > 0) {
    console.log('[MEX-CACHE] snapshot local →', { plaza: plazaScope, unidades: cachedUnits.length });
    _mapaRuntime.unidadesReady = true;
    sincronizarMapa(cachedUnits, { immediate: true });
    result.hydrated = true;
    result.units = true;
  }

  return result;
}

function _shouldBootstrapMapFetch() {
  return !_mapaRuntime.unidadesReady && !_mapaRuntime.pendingUnits && !_unsubMapa;
}

function _getPlazaSwitchOverlay() {
  let overlay = document.getElementById('plaza-switch-loader');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'plaza-switch-loader';
  overlay.style.cssText = 'display:none;position:fixed;right:14px;top:82px;z-index:76000;pointer-events:none;padding:0;';
  overlay.innerHTML = `
    <div style="min-width:190px;max-width:min(90vw,260px);background:rgba(15,23,42,0.9);color:#e2e8f0;border:1px solid rgba(148,163,184,0.28);border-radius:999px;padding:8px 12px;box-shadow:0 10px 26px rgba(15,23,42,0.22);display:flex;align-items:center;gap:8px;">
      <span class="material-icons spinner" style="font-size:17px;color:#38bdf8;">sync</span>
      <div id="plaza-switch-loader-title" style="font-size:12px;font-weight:800;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Sincronizando plaza...</div>
      <div id="plaza-switch-loader-meta" style="margin-left:auto;padding:2px 7px;border-radius:999px;background:rgba(30,41,59,0.65);font-size:10px;font-weight:800;color:#cbd5e1;">0%</div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function _setPlazaSwitchLoading(active, { plaza = '', text = '', structure = false, units = false } = {}) {
  const overlay = _getPlazaSwitchOverlay();
  const title = overlay.querySelector('#plaza-switch-loader-title');
  const meta = overlay.querySelector('#plaza-switch-loader-meta');
  if (title) title.textContent = text || (plaza ? `Sincronizando ${plaza}...` : 'Sincronizando plaza...');
  if (meta) {
    const progress = (structure ? 50 : 0) + (units ? 50 : 0);
    meta.textContent = `${progress}%`;
  }
  overlay.style.display = active ? 'flex' : 'none';
}

function _beginPlazaSwitchLoading(plaza, cacheState = {}) {
  if (_plazaSwitchState.hideTimer) {
    clearTimeout(_plazaSwitchState.hideTimer);
    _plazaSwitchState.hideTimer = null;
  }
  const token = Date.now();
  _plazaSwitchState = {
    token,
    plaza,
    structureReady: cacheState.structure === true,
    unitsReady: cacheState.units === true,
    hideTimer: null
  };
  _setPlazaSwitchLoading(true, {
    plaza,
    text: `Sincronizando ${plaza}...`,
    structure: _plazaSwitchState.structureReady,
    units: _plazaSwitchState.unitsReady
  });
  if (_plazaSwitchState.structureReady && _plazaSwitchState.unitsReady) {
    _plazaSwitchState.hideTimer = setTimeout(() => {
      if (_plazaSwitchState.token === token) _setPlazaSwitchLoading(false);
    }, 180);
  }
  return token;
}

function _markPlazaSwitchReady(plaza, part) {
  const plazaUp = _normalizePlaza(plaza || '');
  if (!_plazaSwitchState.token || _plazaSwitchState.plaza !== plazaUp) return;
  if (part === 'structure') _plazaSwitchState.structureReady = true;
  if (part === 'units') _plazaSwitchState.unitsReady = true;
  _setPlazaSwitchLoading(true, {
    plaza: plazaUp,
    text: (_plazaSwitchState.structureReady && _plazaSwitchState.unitsReady)
      ? `${plazaUp} lista`
      : `Sincronizando ${plazaUp}...`,
    structure: _plazaSwitchState.structureReady,
    units: _plazaSwitchState.unitsReady
  });
  if (_plazaSwitchState.structureReady && _plazaSwitchState.unitsReady) {
    if (_plazaSwitchState.hideTimer) clearTimeout(_plazaSwitchState.hideTimer);
    _plazaSwitchState.hideTimer = setTimeout(() => {
      if (_plazaSwitchState.plaza === plazaUp) _setPlazaSwitchLoading(false);
    }, 220);
  }
}

async function _warmPlazaCache(plaza, options = {}) {
  const plazaUp = _normalizePlaza(plaza || '');
  if (!plazaUp) return { estructura: 0, unidades: 0 };
  if (_plazaPrefetchPromises.has(plazaUp) && !options.force) return _plazaPrefetchPromises.get(plazaUp);

  const run = (async () => {
    const _api = window.api || api;
    const result = { estructura: 0, unidades: 0 };
    try {
      if (typeof _api?.obtenerEstructuraMapa === 'function') {
        const estructura = await _api.obtenerEstructuraMapa(plazaUp);
        if (Array.isArray(estructura) && estructura.length > 0) {
          _persistMapStructureCache(estructura, plazaUp);
          result.estructura = estructura.length;
        }
      }
    } catch (error) {
      console.warn('[MEX-PREFETCH] No se pudo precalentar estructura:', plazaUp, error);
    }

    try {
      if (typeof _api?.obtenerDatosParaMapa === 'function') {
        const data = await _api.obtenerDatosParaMapa(plazaUp);
        const unidades = Array.isArray(data?.unidades) ? data.unidades : [];
        if (unidades.length > 0) {
          _persistMapUnitsCache(unidades, plazaUp);
          result.unidades = unidades.length;
        }
      }
    } catch (error) {
      console.warn('[MEX-PREFETCH] No se pudo precalentar unidades:', plazaUp, error);
    }

    return result;
  })().finally(() => {
    _plazaPrefetchPromises.delete(plazaUp);
    if (typeof _renderPlazaSwitcher === 'function') _renderPlazaSwitcher();
  });

  _plazaPrefetchPromises.set(plazaUp, run);
  return run;
}

function _schedulePlazaCachePrefetch() {
  if (_mapaRuntime.plazaPrefetchScheduled) return;
  const plazas = _puedeVerTodasPlazas()
    ? (window.MEX_CONFIG?.empresa?.plazas || [])
    : (_plazasPermitidas() || []);
  const targets = plazas.filter(p => p && _normalizePlaza(p) !== _normalizePlaza(_miPlaza()));
  if (targets.length === 0) return;
  _mapaRuntime.plazaPrefetchScheduled = true;

  const runQueue = () => {
    targets.reduce((chain, plaza, index) => {
      return chain.then(() => new Promise(resolve => {
        const invoke = () => {
          _warmPlazaCache(plaza).finally(resolve);
        };
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(invoke, { timeout: 1200 + (index * 250) });
        } else {
          setTimeout(invoke, 250 * (index + 1));
        }
      }));
    }, Promise.resolve()).catch(error => {
      console.warn('[MEX-PREFETCH] cola de plazas:', error);
    });
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(runQueue, { timeout: 2200 });
  } else {
    setTimeout(runQueue, 1200);
  }
}

function _scheduleAdminWarmup() {
  if (_mapaRuntime.adminWarmupScheduled || !canOpenAdminPanel()) return;
  _mapaRuntime.adminWarmupScheduled = true;
  const warm = () => {
    cargarMaestra().catch(() => {});
    if (canViewAdminRequests() && typeof actualizarBadgeSolicitudes === 'function') {
      actualizarBadgeSolicitudes().catch(() => {});
    }
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warm, { timeout: 1800 });
  } else {
    setTimeout(warm, 900);
  }
}

function _scheduleInitialRadarPing() {
  if (_initialRadarPingHandle) return;
  const run = () => {
    _initialRadarPingHandle = null;
    if (_radarReady.settings && _radarReady.globalSettings && _radarReady.alertas && _radarReady.mensajes && _radarReady.incidencias) return;
    hacerPingNotificaciones();
  };
  if (typeof window.requestIdleCallback === 'function') {
    _initialRadarPingHandle = window.requestIdleCallback(run, { timeout: 1800 });
  } else {
    _initialRadarPingHandle = setTimeout(run, 900);
  }
}

function _schedulePrivilegedRoutePrefetch() {
  if (_mapaRuntime.rolePrefetchScheduled) return;
  const role = String(userAccessRole || '').trim().toUpperCase();
  if (!(hasFullAccess() || role === 'PROGRAMADOR' || role === 'JEFE_OPERACION')) return;
  _mapaRuntime.rolePrefetchScheduled = true;

  const enqueue = () => {
    [
      '/gestion?tab=usuarios',
      '/mensajes',
      '/profile',
      '/programador',
      '/editmap',
      '/incidencias'
    ].forEach(href => {
      if (document.head.querySelector(`link[rel="prefetch"][href="${href}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'document';
      link.href = href;
      document.head.appendChild(link);
    });
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(enqueue, { timeout: 2500 });
  } else {
    setTimeout(enqueue, 1200);
  }

  _schedulePlazaCachePrefetch();
  _scheduleAdminWarmup();
}

function _currentMapUiState() {
  const conflicts = new Set(
    (Array.isArray(_mapaSyncState.lastConflicts) ? _mapaSyncState.lastConflicts : [])
      .map(item => String(item?.mva || '').trim().toUpperCase())
      .filter(Boolean)
  );
  return {
    selectedMva: String(selectedAuto?.dataset?.mva || '').trim().toUpperCase(),
    highlightedMva: '',
    conflicts
  };
}

function _rebuildCurrentMapViewModel(unidades = _ultimaFlotaMapa, estructura = _ultimaEstructuraMapa) {
  const normalizedStructure = Array.isArray(estructura)
    ? estructura.map((item, index) => normalizarElemento(item, index))
    : [];
  const normalizedUnits = Array.isArray(unidades)
    ? unidades.map(_normalizarUnidadMapa).filter(item => item?.mva)
    : [];
  _currentMapViewModel = buildMapaViewModel(normalizedStructure, normalizedUnits, _currentMapUiState(), {
    cuadreAdmins: DB_ADMINS,
    notasAbiertas: notasGlobales
  });
  return _currentMapViewModel;
}

function _unitViewModelFor(unit = {}) {
  const mva = String(unit?.mva || '').trim().toUpperCase();
  if (mva && _currentMapViewModel?.unitMap?.has?.(mva)) {
    return _currentMapViewModel.unitMap.get(mva);
  }
  return buildUnitViewModel(_normalizarUnidadMapa(unit), _currentMapUiState(), {
    cuadreAdmins: DB_ADMINS,
    notasAbiertas: notasGlobales
  });
}

function _setMapSyncBadge(mode = 'live', text = '') {
  const badge = document.getElementById('mapSyncBadge');
  const icon = document.getElementById('mapSyncIcon');
  const label = document.getElementById('mapSyncText');
  if (!badge || !icon || !label) return;

  badge.className = `map-sync-badge sync-${mode}`;

  const meta = {
    live: { icon: 'cloud_done', text: 'EN VIVO' },
    queued: { icon: 'schedule', text: 'CAMBIOS EN COLA' },
    saving: { icon: 'sync', text: 'SINCRONIZANDO...' },
    error: { icon: 'wifi_off', text: 'REINTENTANDO...' },
    locked: { icon: 'lock', text: 'BLOQUEADO' }
  }[mode] || { icon: 'cloud_done', text: 'EN VIVO' };

  icon.innerText = meta.icon;
  icon.classList.toggle('spinner', mode === 'saving');
  label.innerText = text || meta.text;
}

function _obtenerReportePosicionesMapa() {
  const reporte = [];
  document.querySelectorAll('.car').forEach(car => {
    let pos = "LIMBO";
    const parent = car.parentElement;
    if (parent && parent.id && parent.id.startsWith('spot-')) {
      pos = _spotValueFromElement(parent);
    }
    if (car.dataset.mva) {
      reporte.push({
        mva: car.dataset.mva,
        pos,
        expectedVersion: Number(car.dataset.version || 0) || 0
      });
    }
  });
  return reporte.sort((a, b) => a.mva.localeCompare(b.mva));
}

function _firmaReportePosicionesMapa(reporte = []) {
  return reporte
    .map(item => `${String(item.mva || '').trim().toUpperCase()}:${String(item.pos || '').trim().toUpperCase()}`)
    .sort()
    .join('|');
}

function _programarGuardadoMapa(delay = MAPA_SAVE_DEBOUNCE_MS) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    ejecutarAutoGuardado();
  }, Math.max(0, Number(delay) || 0));
}

function _procesarSnapshotPendienteMapa() {
  if (!Array.isArray(_mapaRuntime.pendingUnits)) return;
  const pending = _mapaRuntime.pendingUnits;
  _mapaRuntime.pendingUnits = null;
  sincronizarMapa(pending, { immediate: true });
}

function _finalizarCicloGuardadoMapa() {
  isMoving = false;
  _procesarSnapshotPendienteMapa();
  if (!window.MAPA_LOCKED && !isSaving && !saveTimeout && !_mapaSyncState.hasPendingWrite) {
    _setMapSyncBadge('live');
  }
}

function _forzarGuardadoMapaPendiente() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (_mapaSyncState.hasPendingWrite || isMoving) {
    ejecutarAutoGuardado(true);
  }
}

function _isShortcutEditableTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function _cerrarCapasRapidas() {
  if (document.getElementById('profile-avatar-crop-modal')?.classList.contains('active')) {
    cancelarRecorteAvatarPerfil();
    return true;
  }
  if (document.getElementById('chatLightboxOverlay')?.style.display === 'flex') {
    cerrarLightboxChat();
    return true;
  }
  if (document.getElementById('chat-user-info-modal')?.classList.contains('active')) {
    cerrarInfoContacto();
    return true;
  }
  if (document.getElementById('perfil-modal')?.classList.contains('active')) {
    cerrarPerfilUsuario();
    return true;
  }
  if (document.getElementById('notifications-center-modal')?.classList.contains('active')) {
    closeNotificationCenter();
    return true;
  }
  if (activeChatUser) {
    cerrarChat();
    return true;
  }
  if (document.getElementById('buzon-modal')?.classList.contains('active')) {
    document.getElementById('buzon-modal').classList.remove('active');
    _stopChatListener();
    return true;
  }
  if (document.getElementById('modal-cuadre-3v')?.classList.contains('active')) {
    cerrarCuadre3V();
    return true;
  }
  if (document.getElementById('modal-resumen-flota')?.classList.contains('active')) {
    document.getElementById('modal-resumen-flota').classList.remove('active');
    return true;
  }
  if (document.getElementById('info-panel')?.classList.contains('open')) {
    cerrarPanel();
    return true;
  }
  return false;
}

function _handleGlobalShortcuts(event) {
  if (event.defaultPrevented) return;
  const key = String(event.key || '').toLowerCase();

  if (key === 'escape') {
    if (_cerrarCapasRapidas()) event.preventDefault();
    return;
  }

  if (_isShortcutEditableTarget(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (key === '/') {
    const search = document.getElementById('searchInput') || document.getElementById('searchInputMobile');
    if (search) {
      event.preventDefault();
      search.focus();
      search.select?.();
    }
    return;
  }

  if (!event.shiftKey) return;

  if (key === 'c') {
    event.preventDefault();
    abrirModalFlota();
    return;
  }
  if (key === 'm') {
    event.preventDefault();
    _navigateTop('/mensajes');
    return;
  }
  if (key === 'p') {
    event.preventDefault();
    _navigateTop('/profile');
    return;
  }
  if (key === 'r') {
    event.preventDefault();
    abrirResumenFlota();
  }
}

function _bindGlobalShortcuts() {
  if (_globalShortcutsBound) return;
  document.addEventListener('keydown', _handleGlobalShortcuts);
  _globalShortcutsBound = true;
}

function init() {
  startAutoRefresh();
  updateZoom();
  _ajustarViewportMapa();
  _setMapSyncBadge(window.MAPA_LOCKED ? 'locked' : 'live');
  _bindMapZoomGestures();
  _bindGlobalShortcuts();
  if (!_mapaRuntime.viewportBound) {
    window.addEventListener('resize', _ajustarViewportMapa);
    _mapaRuntime.viewportBound = true;
  }
  // Intentar renderizar el switcher de plaza cuando el perfil ya está listo
  if (typeof _renderPlazaSwitcher === 'function') _renderPlazaSwitcher();
}

function startAutoRefresh() {
  if (_isDedicatedCuadreIframeMode()) return;
  // Siempre usar window.api fresco — el const api puede ser snapshot anterior al assemble
  const _api = window.api || api;
  const plazaActiva = _miPlaza();
  const cacheState = _resolveMapCachePresence(plazaActiva);

  // Guard: no reiniciar si ya tenemos suscripciones activas para esta misma plaza
  if (_subPlaza === plazaActiva && _unsubMapa !== null && _unsubMapaEstructura !== null) return;

  if (_unsubMapa) { _unsubMapa(); _unsubMapa = null; _trackLegacyListener('cleanup', 'mapa-sub'); }
  if (_unsubMapaEstructura) { _unsubMapaEstructura(); _unsubMapaEstructura = null; }

  if (!_api || typeof _api.suscribirMapa !== 'function') {
    console.warn('[MEX-INTEG] startAutoRefresh: window.api no está listo, reintentando en 500ms', { api: typeof _api, keys: Object.keys(_api || {}).length });
    setTimeout(startAutoRefresh, 500);
    return;
  }

  console.log('[MEX-INTEG] startAutoRefresh →', { plaza: plazaActiva || '(sin plaza)', apiKeys: Object.keys(_api).length });
  _subPlaza = plazaActiva; // Registrar plaza activa ANTES de suscribir

  const plazaYaCargada = cacheState.structure === true && cacheState.units === true;
  const plazaCambioVisible = !_subPlaza || _subPlaza !== plazaActiva;
  if (!plazaYaCargada && (plazaCambioVisible || !cacheState.hydrated)) {
    _beginPlazaSwitchLoading(plazaActiva || 'MAPA', { ...cacheState, hydrated: false });
  }

  if (typeof _api.suscribirEstructuraMapa === 'function') {
    _unsubMapaEstructura = _api.suscribirEstructuraMapa(estructura => {
      _persistMapStructureCache(estructura, plazaActiva);
      _mapaRuntime.estructuraReady = true;
      _markPlazaSwitchReady(plazaActiva, 'structure');
      dibujarMapaCompleto(estructura);
    }, plazaActiva);
  } else {
    console.warn('[MEX-INTEG] suscribirEstructuraMapa no disponible — usando dibujarMapaCompleto directo');
    dibujarMapaCompleto();
  }

  const suscribir = _api.suscribirMapaPlaza
    ? (cb) => _api.suscribirMapaPlaza(plazaActiva, cb)
    : _api.suscribirMapa.bind(_api);

  _unsubMapa = suscribir(unidades => {
    _persistMapUnitsCache(unidades, plazaActiva);
    _mapaRuntime.unidadesReady = true;
    _markPlazaSwitchReady(plazaActiva, 'units');
    if (window.PAUSA_CONEXIONES) return;
    if (isSaving || isMoving) {
      _mapaRuntime.pendingUnits = unidades;
      return;
    }
    _mapaRuntime.pendingUnits = null;
    sincronizarMapa(unidades);
  });
  _trackLegacyListener('create', 'mapa-sub', { plaza: plazaActiva });

  _hydrateMapFromLocalCache(plazaActiva);
}

// Cambia la plaza activa en el mapa y reinicia las suscripciones
function cambiarPlazaMapa(plaza) {
  const normalizedPlaza = _normalizePlaza(plaza || '');
  if (!normalizedPlaza || PLAZA_ACTIVA_MAPA === normalizedPlaza) return;
  console.log('[MEX-INTEG] cambiarPlazaMapa →', { de: PLAZA_ACTIVA_MAPA || '(sin plaza)', a: normalizedPlaza });
  PLAZA_ACTIVA_MAPA = normalizedPlaza;
  _rememberActivePlaza(PLAZA_ACTIVA_MAPA);
  _updateGlobalPlazaEmail();
  _mapaRuntime.estructuraReady = false;
  _mapaRuntime.unidadesReady = false;
  _mapaRuntime.pendingUnits = null;
  const cacheState = _hydrateMapFromLocalCache(normalizedPlaza);
  _beginPlazaSwitchLoading(normalizedPlaza, cacheState);
  _warmPlazaCache(normalizedPlaza).then(result => {
    if ((_plazaSwitchState.plaza || '') !== normalizedPlaza) return;
    if (result.estructura > 0) _markPlazaSwitchReady(normalizedPlaza, 'structure');
    if (result.unidades > 0) _markPlazaSwitchReady(normalizedPlaza, 'units');
  }).catch(() => {});
  _subPlaza = null; // forzar reinicio aunque la plaza sea la misma string
  _renderPlazaSwitcher();
  inicializarConfiguracion();
  cargarMaestra().catch(() => {});
  startAutoRefresh();
  iniciarRadarNotificaciones();
  hacerPingNotificaciones(true);
  if (document.getElementById('fleet-modal')?.classList.contains('active')) {
    if (VISTA_ACTUAL_FLOTA === 'ADMINS') cambiarTabFlota('ADMINS');
    else cargarFlota();
  }
  // Cerrar el dropdown si está abierto
  const dd = document.getElementById('plaza-picker-dropdown');
  if (dd) dd.style.display = 'none';
}

// Abre / cierra el dropdown del picker en el header
function _togglePlazaPicker() {
  const dd = document.getElementById('plaza-picker-dropdown');
  if (!dd) return;
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

// Renderiza el picker de plaza en el header (solo si el usuario tiene acceso a >1 plaza)
// Requiere que perfil Y config estén cargados — si no, no hace nada (se llama dos veces en la init)
function _renderPlazaSwitcher() {
  // Guard: perfil y config deben estar disponibles
  if (!currentUserProfile || !window.MEX_CONFIG?.empresa?.plazas?.length) return;

  const picker = document.getElementById('plaza-map-picker');
  const pickerLabel = document.getElementById('plaza-picker-label');
  const dropdown = document.getElementById('plaza-picker-dropdown');
  if (!picker) return;

  let plazas;
  if (_puedeVerTodasPlazas()) {
    plazas = window.MEX_CONFIG.empresa.plazas || [];
  } else {
    plazas = _plazasPermitidas() || [];
  }

  if (!plazas || plazas.length <= 1) {
    picker.style.display = 'none';
    return;
  }

  // Auto-seleccionar primera plaza si aún no hay ninguna activa
  if (!PLAZA_ACTIVA_MAPA && plazas.length > 0) {
    PLAZA_ACTIVA_MAPA = plazas[0];
    _updateGlobalPlazaEmail();
    // startAutoRefresh se llama desde init() — si ya terminó, forzar reinicio
    if (_subPlaza !== PLAZA_ACTIVA_MAPA) {
      _subPlaza = null;
      startAutoRefresh();
      iniciarRadarNotificaciones();
      hacerPingNotificaciones(true);
    }
  }

  const activa = PLAZA_ACTIVA_MAPA || plazas[0];
  const plazasDetalle = window.MEX_CONFIG?.empresa?.plazasDetalle || [];
  picker.style.display = 'flex';
  if (pickerLabel) pickerLabel.textContent = activa;
  if (dropdown) {
    dropdown.innerHTML = plazas.map(p => {
      const cacheState = _resolveMapCachePresence(p);
      const cachedReady = cacheState.structure && cacheState.units;
      const warming = _plazaPrefetchPromises.has(_normalizePlaza(p));
      const detalle = plazasDetalle.find(item => item.id === p) || {};
      const locality = detalle.localidad || detalle.nombre || 'Plaza operativa';
      const badgeText = cachedReady ? 'LISTA' : (warming ? 'CARGANDO' : 'WARM');
      const badgeBg = cachedReady
        ? 'rgba(16,185,129,0.14)'
        : (warming ? 'rgba(245,158,11,0.16)' : 'rgba(59,130,246,0.12)');
      const badgeColor = cachedReady
        ? '#047857'
        : (warming ? '#b45309' : '#1d4ed8');
      return `
          <button class="plaza-picker-option${activa === p ? ' active' : ''}"
            onclick="cambiarPlazaMapa('${escapeHtml(p)}')">
            <span class="material-icons" style="font-size:13px;margin-right:8px;vertical-align:middle;">${activa === p ? 'check_circle' : 'location_city'}</span>
            <span style="display:grid;gap:2px;text-align:left;flex:1;min-width:0;">
              <span style="font-size:12px;font-weight:900;letter-spacing:.02em;">${escapeHtml(p)}</span>
              <span style="font-size:10px;color:#64748b;font-weight:700;">${escapeHtml(locality)}</span>
            </span>
            <span style="margin-left:auto;padding:4px 8px;border-radius:999px;background:${badgeBg};color:${badgeColor};font-size:10px;font-weight:800;">
              ${badgeText}
            </span>
          </button>
        `;
    }).join('');
  }
}

function _ajustarViewportMapa() {
  const stage = document.getElementById('map-stage');
  const container = document.getElementById('map-zoom-container');
  const grid = document.getElementById('grid-map');
  if (!stage || !container || !grid) {
    if (_profileAvatarCropState) _renderProfileAvatarCrop();
    return;
  }

  const isMobile = window.innerWidth <= 768;
  const outerPad = isMobile ? 14 : Math.max(16, Math.min(36, Math.round(window.innerWidth * 0.022)));
  const topMargin = isMobile ? 14 : 82;
  container.style.setProperty('--map-outer-pad', `${outerPad}px`);
  stage.style.marginTop = `${topMargin}px`;

  // [F2] Canvas libre: el tamaño lo imponen las celdas absolutas — solo sync stage
  if (!_ultimaEstructuraMapa.length) {
    if (_profileAvatarCropState) _renderProfileAvatarCrop();
    return;
  }
  _syncMapStageSize();
  if (_profileAvatarCropState) _renderProfileAvatarCrop();
}

function _getMapViewport() {
  return document.querySelector('.content');
}

function _clampMapZoom(value) {
  return Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, Number(value) || zoomLevel));
}

function _getViewportCenterPoint() {
  const viewport = _getMapViewport();
  if (!viewport) return null;
  const rect = viewport.getBoundingClientRect();
  return {
    clientX: rect.left + (rect.width / 2),
    clientY: rect.top + (rect.height / 2)
  };
}

function _syncMapStageSize() {
  const stage = document.getElementById('map-stage');
  const mapContainer = document.getElementById('map-zoom-container');
  if (!stage || !mapContainer) return;

  const rawWidth = mapContainer.scrollWidth;
  const rawHeight = mapContainer.scrollHeight;
  stage.style.width = `${Math.ceil(rawWidth * zoomLevel)}px`;
  stage.style.height = `${Math.ceil(rawHeight * zoomLevel)}px`;
}

function _isMapZoomTarget(target) {
  return !!target?.closest?.('#map-stage, #map-zoom-container');
}

function _getTouchDistance(touchA, touchB) {
  return Math.hypot(touchA.clientX - touchB.clientX, touchA.clientY - touchB.clientY);
}

function _getTouchCenter(touchA, touchB) {
  return {
    clientX: (touchA.clientX + touchB.clientX) / 2,
    clientY: (touchA.clientY + touchB.clientY) / 2
  };
}

function _applyMapZoom(nextZoom, anchorPoint = null) {
  const mapContainer = document.getElementById('map-zoom-container');
  const viewport = _getMapViewport();
  const clampedZoom = _clampMapZoom(nextZoom);
  const prevZoom = zoomLevel;
  if (!mapContainer || clampedZoom === prevZoom) return;

  const hasAnchor = viewport
    && anchorPoint
    && Number.isFinite(anchorPoint.clientX)
    && Number.isFinite(anchorPoint.clientY);

  let contentX = 0;
  let contentY = 0;
  let pointX = 0;
  let pointY = 0;

  if (hasAnchor) {
    const rect = viewport.getBoundingClientRect();
    pointX = anchorPoint.clientX - rect.left;
    pointY = anchorPoint.clientY - rect.top;
    contentX = (viewport.scrollLeft + pointX) / prevZoom;
    contentY = (viewport.scrollTop + pointY) / prevZoom;
  }

  zoomLevel = clampedZoom;
  updateZoom();

  if (hasAnchor) {
    viewport.scrollLeft = Math.max(0, (contentX * clampedZoom) - pointX);
    viewport.scrollTop = Math.max(0, (contentY * clampedZoom) - pointY);
  }
}

function _handleMapWheelZoom(event) {
  if (window.innerWidth <= 768) return;
  if (!_isMapZoomTarget(event.target)) return;
  if (!event.ctrlKey && !event.metaKey) return; // plain scroll → native pan
  event.preventDefault();
  const deltaMultiplier = event.deltaMode === 1 ? 16 : 1;
  const normalizedDelta = event.deltaY * deltaMultiplier;
  const nextZoom = zoomLevel * Math.exp(-normalizedDelta * 0.0015);
  _applyMapZoom(nextZoom, { clientX: event.clientX, clientY: event.clientY });
}

function _handleMapTouchStart(event) {
  if (event.touches.length !== 2 || !_isMapZoomTarget(event.target)) return;
  const [touchA, touchB] = event.touches;
  _mapaRuntime.pinchState = {
    startDistance: _getTouchDistance(touchA, touchB),
    startZoom: zoomLevel
  };
  event.preventDefault();
}

function _handleMapTouchMove(event) {
  if (!_mapaRuntime.pinchState || event.touches.length !== 2) return;
  const [touchA, touchB] = event.touches;
  const distance = _getTouchDistance(touchA, touchB);
  if (!distance || !_mapaRuntime.pinchState.startDistance) return;
  const scaleFactor = distance / _mapaRuntime.pinchState.startDistance;
  _applyMapZoom(_mapaRuntime.pinchState.startZoom * scaleFactor, _getTouchCenter(touchA, touchB));
  event.preventDefault();
}

function _handleMapTouchEnd(event) {
  if (event.touches.length === 2) {
    const [touchA, touchB] = event.touches;
    _mapaRuntime.pinchState = {
      startDistance: _getTouchDistance(touchA, touchB),
      startZoom: zoomLevel
    };
    return;
  }
  _mapaRuntime.pinchState = null;
}

function _bindMapZoomGestures() {
  const viewport = _getMapViewport();
  if (!viewport || _mapaRuntime.gesturesBound) return;
  viewport.addEventListener('wheel', _handleMapWheelZoom, { passive: false });
  viewport.addEventListener('touchstart', _handleMapTouchStart, { passive: false });
  viewport.addEventListener('touchmove', _handleMapTouchMove, { passive: false });
  viewport.addEventListener('touchend', _handleMapTouchEnd, { passive: true });
  viewport.addEventListener('touchcancel', _handleMapTouchEnd, { passive: true });
  _mapaRuntime.gesturesBound = true;
}

function adjustZoom(delta, anchorPoint = null) {
  _applyMapZoom(zoomLevel + delta, anchorPoint || _getViewportCenterPoint());
}

function updateZoom() {
  const mapContainer = document.getElementById('map-zoom-container');
  if (mapContainer) {
    mapContainer.style.transform = `scale(${zoomLevel})`;
    mapContainer.style.transformOrigin = '0 0';
  }
  _syncMapStageSize();
}

let searchTimeout;

// 1. EL DISPARADOR (Anti-Lag)
// Se ejecuta cada vez que tecleas, pero reinicia el contador.
// Solo ejecuta la búsqueda pesada cuando dejas de teclear por 300ms.
function buscarMasivo() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    ejecutarFiltroMasivo();
  }, 300);
}

// 2. EL MOTOR DE BÚSQUEDA (Optimizado)
function ejecutarFiltroMasivo() {
  const inputDesktop = document.getElementById('searchInput');
  const inputMobile = document.getElementById('searchInputMobile');
  const activeInput = document.activeElement === inputMobile ? inputMobile : inputDesktop;
  const query = activeInput.value.toLowerCase().trim();

  // Sincronizar barras de búsqueda
  if (activeInput === inputDesktop) inputMobile.value = inputDesktop.value;
  else inputDesktop.value = inputMobile.value;

  const cars = document.querySelectorAll('.car');
  const spots = document.querySelectorAll('.spot');

  // Limpiar enfoque previo (brillo azul)
  cars.forEach(c => c.classList.remove('car-focus'));

  // 1. CASO: BÚSQUEDA VACÍA
  if (query === "") {
    cars.forEach(car => {
      car.classList.remove('fade', 'hide');
      car.style.opacity = "";
    });
    spots.forEach(spot => spot.style.opacity = "1");
    return;
  }

  let coincidencias = [];

  // 2. CASO: FILTRADO ACTIVO
  cars.forEach(car => {
    const mva = (car.dataset.mva || "").toLowerCase();
    const placas = (car.dataset.placas || "").toLowerCase();
    const modelo = (car.dataset.modelo || "").toLowerCase();
    const notas = (car.dataset.notas || "").toLowerCase();
    const searchTokens = (car.dataset.searchTokens || "").toLowerCase();

    // 🔥 BUSCADOR TOTAL: MVA, Placa, Modelo o Notas 🔥
    const isMatch = mva.includes(query) ||
      placas.includes(query) ||
      modelo.includes(query) ||
      notas.includes(query) ||
      searchTokens.includes(query);

    car.classList.remove('fade', 'hide');

    if (!isMatch) {
      // Si no coincide, esconder o difuminar
      if (car.parentElement.id.includes("unidades")) {
        car.classList.add('hide'); // Esconder en el Limbo/Taller
      } else {
        car.classList.add('fade'); // Opacar en el mapa
      }
    } else {
      coincidencias.push(car);
    }
  });

  // 3. CONTROL DE CAJONES (SPOTS)
  // Apagar visualmente los cajones que no tienen el auto que buscas
  spots.forEach(spot => {
    const hasMatch = spot.querySelector('.car:not(.fade)');
    spot.style.opacity = hasMatch ? "1" : "0.2";
  });

  // 🎯 4. SMART FOCUS — 1 resultado: zoom + highlight + auto-panel
  if (coincidencias.length === 1) {
    const target = coincidencias[0];
    const parentSpot = target.parentElement;

    if (parentSpot && parentSpot.classList.contains('spot')) {
      // Highlight visual
      target.classList.add('car-focus');
      if (typeof enfocarCajon === "function") enfocarCajon(parentSpot);

      // Auto-abrir panel tras completar el scroll (~500ms)
      clearTimeout(window._searchPanelTimer);
      window._searchPanelTimer = setTimeout(() => {
        if (!document.getElementById('info-panel')?.classList.contains('open')) {
          _selectCarOnMap(target, { openPanel: true, preserveSwap: false });
        }
      }, 520);

      // Quitar highlight temporal a los 4s
      clearTimeout(window._searchFocusTimer);
      window._searchFocusTimer = setTimeout(() => {
        target.classList.remove('car-focus');
      }, 4000);

    } else if (parentSpot) {
      // Unidad en limbo/taller: highlight sin zoom
      target.classList.add('car-focus');
      clearTimeout(window._searchFocusTimer);
      window._searchFocusTimer = setTimeout(() => target.classList.remove('car-focus'), 4000);
    }
  } else {
    // Limpiar timers si hay múltiples o cero resultados
    clearTimeout(window._searchPanelTimer);
    clearTimeout(window._searchFocusTimer);
  }
}

const MAPA_RENDER_AIRE_X = 6;
const MAPA_RENDER_AIRE_Y = 8;
const MAPA_RENDER_BASE_X = 120;
const MAPA_RENDER_BASE_Y = 84;

// [F2] Normaliza estructura al modelo de posicionamiento absoluto x,y,width,height.
// Acepta tanto el formato nuevo (x,y,width,height) como el legado (row,col,rowspan,colspan).
function _normalizarEstructuraMapa(estructura = [], opciones = {}) {
  if (!Array.isArray(estructura) || !estructura.length) {
    return { items: [], canvasW: 0, canvasH: 0, signature: 'empty' };
  }
  const aplicarAireRender = opciones.aplicarAireRender !== false;

  const items = estructura
    .map((celda, index) => {
      const base = normalizarElemento(celda, index);
      const valor = String(base.valor || '').trim();
      const tipo = base.tipo;
      const esLabel = Boolean(base.esLabel);
      const orden = Number(base.orden ?? index);

      // [F2] Si ya viene con x,y usar directo; si es legado grid → convertir
      let x, y, width, height, rotation;
      if (celda?.x !== undefined || celda?.y !== undefined) {
        x = Number(base.x) || 0;
        y = Number(base.y) || 0;
        width = Number(base.width) || 120;
        height = Number(base.height) || 80;
        rotation = Number(base.rotation) || 0;
      } else {
        // Legado: col/row/colspan/rowspan → calcular px con base 120×80 + 4 gap
        const col = Math.max(1, Number(celda?.col) || 1);
        const row = Math.max(1, Number(celda?.row) || 1);
        const colspan = Math.max(1, Number(celda?.colspan) || 1);
        const rowspan = Math.max(1, Number(celda?.rowspan) || 1);
        const CW = 120, CH = 80, GAP = 4;
        x = (col - 1) * (CW + GAP);
        y = (row - 1) * (CH + GAP);
        width = colspan * CW + (colspan - 1) * GAP;
        height = rowspan * CH + (rowspan - 1) * GAP;
        rotation = 0;
      }
      if (aplicarAireRender) {
        x += Math.floor(Math.max(0, x) / MAPA_RENDER_BASE_X) * MAPA_RENDER_AIRE_X;
        y += Math.floor(Math.max(0, y) / MAPA_RENDER_BASE_Y) * MAPA_RENDER_AIRE_Y;
      }
      return {
        valor,
        tipo,
        esLabel,
        orden,
        x,
        y,
        width,
        height,
        rotation,
        allowedCategories: base.allowedCategories,
        zone: base.zone,
        subzone: base.subzone,
        isReserved: base.isReserved,
        isBlocked: base.isBlocked,
        isTemporaryHolding: base.isTemporaryHolding,
        priority: base.priority,
        googleMapsUrl: base.googleMapsUrl,
        pathType: base.pathType
      };
    })
    .sort((a, b) => a.orden - b.orden);

  let canvasW = 0, canvasH = 0;
  items.forEach(c => {
    canvasW = Math.max(canvasW, c.x + c.width);
    canvasH = Math.max(canvasH, c.y + c.height);
  });

  const signature = items
    .map(c => `${c.valor}|${c.x}|${c.y}|${c.width}|${c.height}|${c.tipo}|${c.isBlocked ? 1 : 0}|${c.isReserved ? 1 : 0}|${c.zone || ''}|${c.subzone || ''}`)
    .join('~');

  return { items, canvasW: canvasW + 8, canvasH: canvasH + 8, signature };
}

function _sanitizeSpotToken(value = '') {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

function _spotDomId(spotValue, plaza = _miPlaza()) {
  const plazaToken = _sanitizeSpotToken(plaza || 'GLOBAL') || 'GLOBAL';
  const spotToken = _sanitizeSpotToken(spotValue || 'LIMBO') || 'LIMBO';
  return `spot-${plazaToken}-${spotToken}`;
}

function _spotValueFromElement(el) {
  if (!el) return 'LIMBO';
  if (el.dataset?.spot) return _sanitizeSpotToken(el.dataset.spot) || 'LIMBO';
  if (el.id && el.id.startsWith('spot-')) {
    const parts = el.id.split('-');
    return parts.slice(2).join('-') || 'LIMBO';
  }
  return 'LIMBO';
}

function dibujarMapaCompleto(estructura = null) {
  const grid = document.getElementById("grid-map");
  if (!grid) return Promise.resolve();

  if (!Array.isArray(estructura)) {
    console.log('[MEX-INTEG] dibujarMapaCompleto: sin estructura → obteniendo de Firestore', { plaza: _miPlaza() || '(sin plaza)' });
    return (window.api || api).obtenerEstructuraMapa(_miPlaza())
      .then(dibujarMapaCompleto)
      .catch(e => { console.error('[MEX-INTEG] dibujarMapaCompleto fetch error:', e); captureError(e, { context: 'dibujarMapaCompleto' }); });
  }

  _ultimaEstructuraMapa = estructura;
  _persistMapStructureCache(estructura, _miPlaza());
  _rebuildCurrentMapViewModel(_ultimaFlotaMapa, estructura);
  const normalizada = _normalizarEstructuraMapa(estructura);

  if (normalizada.signature === _mapaRuntime.estructuraSig && grid.children.length) {
    _ajustarViewportMapa();
    if (_ultimaFlotaMapa.length) sincronizarMapa(_ultimaFlotaMapa, { immediate: true });
    else if (_shouldBootstrapMapFetch()) refrescarDatos(true);
    return Promise.resolve();
  }

  _mapaRuntime.estructuraSig = normalizada.signature;
  const prevSelectedMva = selectedAuto?.dataset?.mva || '';

  // [F2] Canvas libre: contenedor position:relative con tamaño calculado
  grid.innerHTML = "";
  grid.className = "map-grid mapa-canvas-libre"; // [F2]
  grid.style.width = `${normalizada.canvasW}px`; // [F2]
  grid.style.height = `${normalizada.canvasH}px`; // [F2]
  grid.style.removeProperty('--map-cols'); // ya no usa CSS grid

  const fragment = document.createDocumentFragment();
  normalizada.items.forEach(celda => {
    const div = document.createElement("div");
    div.className = `mapa-celda-libre ${celda.tipo === 'cajon' ? 'spot' : 'area'}`; // [F2]
    div.id = _spotDomId(celda.valor, _miPlaza());
    div.dataset.spot = _sanitizeSpotToken(celda.valor);
    div.dataset.plaza = _normalizePlaza(_miPlaza());
    // [F2.2] Restricciones de categoría para validación en drop
    if (celda.allowedCategories?.length) {
      div.dataset.allowedCategories = celda.allowedCategories.join(',');
      div.classList.add('spot-restricted'); // [F2.9] indicador visual
    }
    if (celda.zone) div.dataset.zone = celda.zone;
    if (celda.subzone) div.dataset.subzone = celda.subzone;
    if (celda.isBlocked) div.dataset.blocked = 'true';
    if (celda.isReserved) div.dataset.reserved = 'true';
    if (celda.isTemporaryHolding) div.dataset.temporaryHolding = 'true';
    if (celda.googleMapsUrl) div.dataset.googleMapsUrl = celda.googleMapsUrl;
    if (celda.pathType) div.dataset.pathType = celda.pathType;
    // [F2] Posicionamiento absoluto
    div.style.position = 'absolute';
    div.style.left = `${celda.x}px`;
    div.style.top = `${celda.y}px`;
    div.style.width = `${celda.width}px`;
    div.style.height = `${celda.height}px`;
    if (celda.rotation) div.style.transform = `rotate(${celda.rotation}deg)`; // [F2]
    if (celda.tipo === 'cajon') div.innerHTML = `<label>${celda.valor}</label>`;
    else div.innerHTML = `<span>${celda.valor}</span>`;
    fragment.appendChild(div);
  });
  grid.appendChild(fragment);
  _bindMapDropZones();

  _ajustarViewportMapa();

  if (_ultimaFlotaMapa.length) sincronizarMapa(_ultimaFlotaMapa, { immediate: true });
  else if (_shouldBootstrapMapFetch()) refrescarDatos(true);

  if (prevSelectedMva) {
    const nuevaSeleccion = document.getElementById(`auto-${prevSelectedMva}`);
    if (nuevaSeleccion) {
      selectedAuto = nuevaSeleccion;
      nuevaSeleccion.classList.add('selected');
    }
  }

  return Promise.resolve();
}

function _normalizarUnidadMapa(unit = {}) {
  const base = normalizarUnidad(unit);
  const plaza = _normalizePlaza(unit?.plaza || unit?.plazaId || unit?.sucursal || unit?.plazaAsignada || base.plaza || '');
  return {
    ...unit,
    ...base,
    notas: String(base.notas || '').replace(/[\r\n]+/g, ' ').trim(),
    fechaIngreso: String(base.fechaIngreso || '').trim(),
    plaza,
    version: Number(unit?.version || unit?._version || base.version || 0) || 0,
    lastTouchedAt: unit?.lastTouchedAt || unit?._updatedAt || unit?._createdAt || null,
    lastTouchedBy: String(unit?.lastTouchedBy || unit?._updatedBy || unit?._createdBy || base.lastTouchedBy || '').trim(),
    traslado_destino: String(unit?.traslado_destino || unit?.trasladoDestino || base.traslado_destino || '').trim().toUpperCase()
  };
}

function _firmaUnidadMapa(unit) {
  return [
    unit.mva,
    unit.pos,
    unit.ubicacion,
    unit.estado,
    unit.gasolina,
    unit.notas,
    unit.placas,
    unit.modelo,
    unit.categoria || '',
    unit.fechaIngreso,
    unit.plaza,
    unit.traslado_destino || '',
    unit.version || 0,
    unit.lastTouchedAt || '',
    unit.lastTouchedBy || ''
  ].join('|');
}

function _obtenerDestinoUnidadMapa(unit) {
  const plazaActual = _normalizePlaza(_miPlaza());
  if (plazaActual && unit.plaza && unit.plaza !== plazaActual) return null;

  if (unit.pos === "LIMBO") {
    return unit.ubicacion === "TALLER"
      ? document.getElementById("unidades-taller")
      : document.getElementById("unidades-limbo");
  }

  const destinoMapa = document.getElementById(_spotDomId(unit.pos, plazaActual));
  if (destinoMapa) return destinoMapa;

  return unit.ubicacion === "TALLER"
    ? document.getElementById("unidades-taller")
    : document.getElementById("unidades-limbo");
}

function _renderGasolinaMapa(gasolina) {
  if (!gasolina || gasolina === "N/A") return "";

  let pct = 0;
  let gasColor = "#ffffff";
  if (gasolina === "F") pct = 100;
  else if (gasolina === "E") pct = 0;
  else if (gasolina === "H") pct = 50;
  else if (gasolina.includes('/')) {
    const parts = gasolina.split('/');
    if (parts.length === 2 && parseFloat(parts[1]) !== 0) {
      pct = Math.round((parseFloat(parts[0]) / parseFloat(parts[1])) * 100);
    }
  }

  if (pct >= 75) gasColor = "#4ade80";
  else if (pct >= 37) gasColor = "#facc15";
  else gasColor = "#f87171";

  return `<div class="gas-container"><div class="gas-fill" style="width: ${pct}%; background: ${gasColor};"></div><span class="gas-text">${gasolina}</span></div>`;
}

function _actualizarNodoUnidadMapa(car, unit, signature) {
  const unitVm = _unitViewModelFor(unit);
  const esGhost = car.classList.contains('ghost');
  const esForgotten = car.classList.contains('forgotten');
  const esSelected = car.classList.contains('selected');

  car.dataset.mva = unitVm.mva;
  car.dataset.placas = unitVm.placas || "";
  car.dataset.modelo = unitVm.modelo || "";
  car.dataset.categoria = unitVm.categoria || "";
  car.dataset.estado = unitVm.estado || "SUCIO";
  car.dataset.gasolina = unitVm.gasolina || "N/A";
  car.dataset.ubicacion = unitVm.ubicacion;
  car.dataset.plaza = unitVm.plaza || "";
  car.dataset.ingreso = unitVm.fechaIngreso || "";
  car.dataset.notas = unitVm.notas || "";
  car.dataset.version = String(unitVm.version || 0);
  car.dataset.lastTouchedAt = unitVm.lastTouchedAt ? String(unitVm.lastTouchedAt) : "";
  car.dataset.lastTouchedBy = unitVm.lastTouchedBy || "";
  car.dataset.searchTokens = Array.isArray(unitVm.searchTokens) ? unitVm.searchTokens.join('|') : "";
  car.dataset.hasEvidence = unitVm.hasEvidence ? 'SI' : 'NO';
  car.dataset.hasQuickNotes = unitVm.hasQuickNotes ? 'SI' : 'NO';
  car.dataset.conflicted = unitVm.isConflicted ? 'SI' : 'NO';
  car.dataset.trasladoDestino = unitVm.traslado_destino || "";

  const textoNotas = (unitVm.notas || "").toUpperCase();
  const urgHtml = textoNotas.includes("URGENTE") ? `<div class="urgent-badge">⚡</div>` : '';
  const lockHtml = (textoNotas.includes("RESERVAD") || textoNotas.includes("APARTAD")) ? `<div class="lock-badge">🔒</div>` : '';
  const docHtml = textoNotas.includes("DOBLE CERO") ? `<div class="doc-badge">🍃</div>` : '';
  const mantoHtml = (unitVm.estado === "MANTENIMIENTO" || unitVm.estado === "TALLER") ? `<div class="manto-badge">⚙️</div>` : '';
  const trasladoDest = unitVm.traslado_destino ? ` → ${unitVm.traslado_destino}` : '';
  const trasladoHtml = unitVm.isInTransit ? `<div class="traslado-badge" title="En traslado${trasladoDest ? ': ' + unitVm.traslado_destino : ''}">🚛${trasladoDest ? `<span class="traslado-dest">${unitVm.traslado_destino}</span>` : ''}</div>` : '';
  const termometro = obtenerDisenoCalor(unitVm.fechaIngreso);
  const calorHtml = `<div class="badge-calor ${termometro.clase}" style="background: ${termometro.bg}; border: 1px solid ${termometro.border}; color: ${termometro.color};"><span class="material-icons" style="font-size: 11px;">${termometro.icon}</span> ${termometro.text}</div>`;
  const gasBarHtml = _renderGasolinaMapa(unitVm.gasolina);
  const estadoClase = unitVm.estado
    ? unitVm.estado.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-')
    : "sucio";

  const estadoSidebar = unitVm.isInTransit ? 'EN TRASLADO' : (unitVm.estado || 'DISPONIBLE');
  const placasSide = unitVm.placas ? `<span class="car-sb-chip"><span class="material-icons" style="font-size:11px;vertical-align:middle;">pin</span> ${unitVm.placas}</span>` : '';
  const modeloSide = unitVm.modelo ? `<span class="car-sb-chip"><span class="material-icons" style="font-size:11px;vertical-align:middle;">directions_car</span> ${unitVm.modelo}</span>` : '';
  const metaSide = (placasSide || modeloSide) ? `<div class="car-sb-meta">${placasSide}${modeloSide}</div>` : '';
  const sidebarBody = `<div class="car-sidebar-body"><div class="car-sb-main"><span class="car-sb-mva">${unitVm.mva}</span><span class="car-sb-badge car-sb-badge--${estadoClase}">${estadoSidebar}</span></div>${metaSide}</div>`;
  car.innerHTML = `${calorHtml}${lockHtml}${docHtml}${mantoHtml}${trasladoHtml}${urgHtml}<div class="car-map-content" style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;pointer-events:none;"><span style="font-size:19px;flex:1;display:flex;align-items:center;">${unitVm.mva}</span>${gasBarHtml}</div>${sidebarBody}`;
  car.className = `car ${estadoClase}`;
  if (esGhost) car.classList.add('ghost');
  if (esForgotten) car.classList.add('forgotten');
  if (esSelected) car.classList.add('selected');
  if (unitVm.isConflicted) car.classList.add('car-focus');
  car.dataset.renderHash = signature;
}

function _flushMapaSync() {
  _mapaRenderRAF = 0;
  if (!_ultimaFlotaMapa.length) {
    if (selectedAuto) cerrarPanel();
    document.querySelectorAll('.car').forEach(car => car.remove());
    actualizarContadores();
    return;
  }

  if (!_mapaRuntime.estructuraReady && !document.getElementById('grid-map')?.children.length) return;

  const mapaVm = _rebuildCurrentMapViewModel(_ultimaFlotaMapa, _ultimaEstructuraMapa);
  const nuevas = [...mapaVm.unitMap.values()]
    .filter(unit => {
      if (!unit.mva) return false;
      const plazaActual = _normalizePlaza(_miPlaza());
      return !plazaActual || !unit.plaza || unit.plaza === plazaActual;
    })
    .sort((a, b) => a.mva.localeCompare(b.mva));

  const idsActuales = new Set(nuevas.map(unit => `auto-${unit.mva}`));
  let huboCambios = false;

  document.querySelectorAll('.car').forEach(car => {
    if (!idsActuales.has(car.id)) {
      if (selectedAuto && car.id === selectedAuto.id) {
        cerrarPanel();
      }
      car.remove();
      huboCambios = true;
    }
  });

  nuevas.forEach(unit => {
    const id = `auto-${unit.mva}`;
    const destino = _obtenerDestinoUnidadMapa(unit);
    if (!destino) return;

    let car = document.getElementById(id);
    if (!car) {
      car = document.createElement('div');
      car.id = id;
      huboCambios = true;
    }

    const signature = _firmaUnidadMapa(unit);
    if (car.dataset.renderHash !== signature) {
      _actualizarNodoUnidadMapa(car, unit, signature);
      huboCambios = true;
    }

    _bindCarMapInteractions(car);

    if (car.parentElement !== destino) {
      destino.appendChild(car);
      huboCambios = true;
    }
  });

  _bindMapDragDropEvents();
  _bindMapDropZones();

  if (huboCambios) {
    actualizarContadores();
    const q = (document.getElementById('searchInput')?.value || document.getElementById('searchInputMobile')?.value || '').trim();
    if (q && typeof buscarMasivo === 'function') buscarMasivo();
    if (selectedAuto && selectedAuto.isConnected) {
      mostrarDetalle(selectedAuto.dataset, true);
    }
  }
}

let _f7ExtrasVerificado = false;
function sincronizarMapa(nuevas, opciones = {}) {
  _ultimaFlotaMapa = Array.isArray(nuevas) ? nuevas : [];
  _rebuildCurrentMapViewModel(_ultimaFlotaMapa, _ultimaEstructuraMapa);
  // [F3.3] Actualizar panel de supervisión multi-plaza
  if (typeof _actualizarSupervisionConUnidades === 'function') {
    _actualizarSupervisionConUnidades(_ultimaFlotaMapa);
  }
  // [F7] Verificar recordatorios una sola vez tras la primera carga
  if (!_f7ExtrasVerificado && _ultimaFlotaMapa.length > 0) {
    _f7ExtrasVerificado = true;
    if (typeof _verificarRecordatoriosVencidos === 'function') {
      setTimeout(_verificarRecordatoriosVencidos, 2000);
    }
  }

  if (opciones.immediate === true) {
    if (_mapaRenderRAF) cancelAnimationFrame(_mapaRenderRAF);
    _flushMapaSync();
    return;
  }

  if (_mapaRenderRAF) return;
  _mapaRenderRAF = requestAnimationFrame(_flushMapaSync);
}

function _resolveMapDropZone(target) {
  if (!target || !(target instanceof Element)) return null;
  return target.closest('.spot, #unidades-limbo, #unidades-taller');
}

function _clearMapDropHighlight() {
  if (_mapDragState.currentZone) {
    _mapDragState.currentZone.classList.remove('map-drop-target', 'map-drop-target-active', 'map-drop-target-empty', 'map-drop-target-swap');
    _mapDragState.currentZone = null;
  }
}

function _updateMapDropHighlight(zone, movingCar = null) {
  if (_mapDragState.currentZone === zone) return;
  _clearMapDropHighlight();
  if (!zone) return;
  zone.classList.add('map-drop-target', 'map-drop-target-active');
  const occupant = zone.classList.contains('spot') ? zone.querySelector('.car') : null;
  zone.classList.add(occupant && occupant !== movingCar ? 'map-drop-target-swap' : 'map-drop-target-empty');
  _mapDragState.currentZone = zone;
}

function _positionMapDragGhost(clientX, clientY) {
  if (!_mapDragState.ghost) return;
  _mapDragState.ghost.style.left = `${clientX}px`;
  _mapDragState.ghost.style.top = `${clientY}px`;
}

function _removeMapDragGhost() {
  if (_mapDragState.ghost?.isConnected) _mapDragState.ghost.remove();
  _mapDragState.ghost = null;
}

function _createMapDragGhost(car, clientX, clientY) {
  _removeMapDragGhost();
  const ghost = document.createElement('div');
  ghost.className = 'map-drag-ghost';
  ghost.innerHTML = `<span>${escapeHtml(car?.dataset?.mva || 'AUTO')}</span><small>${MAP_SWAP_MODE_ACTIVE ? 'SWAP' : 'MOVER'}</small>`;
  document.body.appendChild(ghost);
  _mapDragState.ghost = ghost;
  _positionMapDragGhost(clientX, clientY);
}

function _cancelPendingMapTouchDrag() {
  if (_mapDragState.touchTimer) {
    clearTimeout(_mapDragState.touchTimer);
    _mapDragState.touchTimer = null;
  }
  _mapDragState.pendingTouch = null;
}

function _cancelPendingMapPointerDrag() {
  _mapDragState.pendingPointer = null;
  _mapDragState.activePointerId = null;
}

function _finishMapDrag() {
  _cancelPendingMapTouchDrag();
  _cancelPendingMapPointerDrag();
  if (_mapDragState.sourceCar) _mapDragState.sourceCar.classList.remove('drag-origin');
  // [F2.4] Quitar highlight del spot origen y sugerencias de cajones disponibles
  if (_mapDragState.sourceSpot) _mapDragState.sourceSpot.classList.remove('spot-drag-origin');
  document.querySelectorAll('.spot-available-hint').forEach(s => s.classList.remove('spot-available-hint'));
  _mapDragState.sourceSpot = null;
  _clearMapDropHighlight();
  _removeMapDragGhost();
  _mapDragState.sourceCar = null;
  _mapDragState.activeTouchId = null;
  _mapDragState.active = false;
}

// [F2.10] Resaltar cajones disponibles y compatibles con la categoría de la unidad
function _mostrarSugerenciasDisponibles(car) {
  document.querySelectorAll('.spot-available-hint').forEach(s => s.classList.remove('spot-available-hint'));
  const unitCat = (car.dataset.categoria || '').trim().toUpperCase();
  document.querySelectorAll('.spot').forEach(spot => {
    if (spot.querySelector('.car')) return; // ocupado
    const allowed = spot.dataset.allowedCategories
      ? spot.dataset.allowedCategories.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
      : [];
    if (allowed.length === 0 || !unitCat || allowed.includes(unitCat)) {
      spot.classList.add('spot-available-hint');
    }
  });
}

function _selectCarOnMap(car, options = {}) {
  if (!car) return;
  const { openPanel = true, preserveSwap = false } = options;

  if (selectedAuto && selectedAuto !== car) selectedAuto.classList.remove('selected');
  selectedAuto = car;
  car.classList.add('selected');
  if (!preserveSwap) MAP_SWAP_MODE_ACTIVE = false;

  const searchDesktop = document.getElementById('searchInput');
  const searchMobile = document.getElementById('searchInputMobile');
  if (searchDesktop) searchDesktop.value = "";
  if (searchMobile) searchMobile.value = "";
  if (typeof buscarMasivo === "function") buscarMasivo();

  if (window.zoomBuscadorActivo) {
    zoomLevel = 0.8;
    updateZoom();
    window.zoomBuscadorActivo = false;
  }

  limpiarBusqueda(false);

  if (document.getElementById('sidebar')?.classList.contains('open')) {
    toggleSidebar();
  }

  if (openPanel) mostrarDetalle(car.dataset);
  else _renderSwapStatus();
}

async function _handleMapUnitDrop(unidad, destino, options = {}) {
  if (!unidad || !destino || unidad.parentElement === destino) return false;
  const fromDrag = options.fromDrag === true;

  if (destino.dataset.blocked === 'true') {
    showToast('Ese cajón está bloqueado y no acepta movimientos.', 'warning');
    return false;
  }
  if (destino.dataset.reserved === 'true') {
    showToast('Ese cajón está marcado como reservado. Revisa la operación antes de dejar la unidad ahí.', 'warning');
  }

  // [F2.2] Validación suave de categoría permitida en el cajón
  if (destino.classList.contains('spot') && destino.dataset.allowedCategories) {
    const allowed = destino.dataset.allowedCategories.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
    const unitCat = (unidad.dataset.categoria || '').trim().toUpperCase();
    if (allowed.length > 0 && unitCat && !allowed.includes(unitCat)) {
      showToast(`⚠️ Categoría ${unitCat} no está permitida en este cajón (permitidas: ${allowed.join(', ')})`, 'warning');
      // Validación suave: sólo avisa, no bloquea
    }
  }

  // [F2.3] Confirm si el usuario arrastra una unidad DESDE un cajón AL limbo
  const fromSpot = unidad.parentElement?.classList.contains('spot');
  const toLimbo  = destino.id === 'unidades-limbo';
  if (fromDrag && fromSpot && toLimbo) {
    const mvaLabel = unidad.dataset.mva || 'la unidad';
    const ok = await mexConfirm(
      'Mover al limbo',
      `¿Sacar ${mvaLabel} del cajón? La unidad quedará sin posición asignada en el mapa.`,
      'warning'
    );
    if (!ok) return false;
    moverUnidadInmediato(unidad, destino);
    return true;
  }

  const occupant = destino.classList.contains('spot') ? destino.querySelector('.car') : null;
  if (occupant && occupant !== unidad) {
    if (!MAP_SWAP_MODE_ACTIVE && !fromDrag) {
      showToast('Ese cajón ya está ocupado. Activa modo swap para intercambiar.', 'warning');
      return false;
    }
    // Drag a cajón ocupado: confirmar swap directamente (sin toast previo para no bloquear el diálogo)
    return mostrarConfirmacionSwap(unidad, occupant, destino);
  }

  moverUnidadInmediato(unidad, destino);
  return true;
}

function _handleMapCarDragStart(event) {
  const car = event.currentTarget;
  if (!car) return;
  _finishMapDrag();
  _selectCarOnMap(car, { openPanel: false, preserveSwap: true });
  _mapDragState.sourceCar = car;
  car.classList.add('drag-origin');
  // [F2.4] Highlight del spot origen
  const sourceSpot = car.parentElement;
  if (sourceSpot?.classList.contains('spot')) {
    sourceSpot.classList.add('spot-drag-origin');
    _mapDragState.sourceSpot = sourceSpot;
  }
  // [F2.10] Mostrar cajones disponibles compatibles
  _mostrarSugerenciasDisponibles(car);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', car.id);
  }
}

function _handleMapCarDragEnd() {
  _finishMapDrag();
}

function _handleMapDragOver(event) {
  if (!_mapDragState.sourceCar) return;
  if (event.__mexMapDropHandled === true) return;
  const zone = _resolveMapDropZone(event.target);
  if (!zone) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  _updateMapDropHighlight(zone, _mapDragState.sourceCar);
}

async function _handleMapDrop(event) {
  if (!_mapDragState.sourceCar) return;
  if (event.__mexMapDropHandled === true) return;
  const zone = _resolveMapDropZone(event.target) || _mapDragState.currentZone;
  if (!zone) return;
  event.preventDefault();
  _mapDragSuppressClickUntil = Date.now() + 350;
  const sourceCar = _mapDragState.sourceCar;
  _finishMapDrag();
  await _handleMapUnitDrop(sourceCar, zone, { fromDrag: true });
}

function _handleMapZoneDragOver(event) {
  if (!_mapDragState.sourceCar) return;
  const zone = _resolveMapDropZone(event.currentTarget) || _resolveMapDropZone(event.target);
  if (!zone) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  _updateMapDropHighlight(zone, _mapDragState.sourceCar);
}

async function _handleMapZoneDrop(event) {
  if (!_mapDragState.sourceCar) return;
  const zone = _resolveMapDropZone(event.currentTarget) || _resolveMapDropZone(event.target);
  if (!zone) return;
  event.preventDefault();
  event.stopPropagation();
  event.__mexMapDropHandled = true;
  _mapDragSuppressClickUntil = Date.now() + 350;
  const sourceCar = _mapDragState.sourceCar;
  _finishMapDrag();
  await _handleMapUnitDrop(sourceCar, zone, { fromDrag: true });
}

function _handleMapCarTouchStart(event) {
  if (event.touches.length !== 1 || _mapaRuntime.pinchState) return;
  const car = event.currentTarget;
  const touch = event.touches[0];
  _finishMapDrag();
  _mapDragState.sourceCar = car;
  _mapDragState.pendingTouch = { id: touch.identifier, startX: touch.clientX, startY: touch.clientY };
  _mapDragState.touchTimer = setTimeout(() => {
    _mapDragState.active = true;
    _mapDragState.activeTouchId = touch.identifier;
    _selectCarOnMap(car, { openPanel: false, preserveSwap: true });
    car.classList.add('drag-origin');
    // [F2.4] Highlight del spot origen
    const sourceSpot = car.parentElement;
    if (sourceSpot?.classList.contains('spot')) {
      sourceSpot.classList.add('spot-drag-origin');
      _mapDragState.sourceSpot = sourceSpot;
    }
    // [F2.10] Mostrar cajones disponibles compatibles
    _mostrarSugerenciasDisponibles(car);
    _createMapDragGhost(car, touch.clientX, touch.clientY);
  }, 220);
}

function _startPointerMapDrag(pointerState, clientX, clientY) {
  const car = pointerState?.car;
  if (!car) return;
  _mapDragState.active = true;
  _mapDragState.activePointerId = pointerState.id;
  _mapDragState.pendingPointer = null;
  _mapDragState.sourceCar = car;
  _selectCarOnMap(car, { openPanel: false, preserveSwap: true });
  car.classList.add('drag-origin');
  const sourceSpot = car.parentElement;
  if (sourceSpot?.classList.contains('spot')) {
    sourceSpot.classList.add('spot-drag-origin');
    _mapDragState.sourceSpot = sourceSpot;
  }
  _mostrarSugerenciasDisponibles(car);
  _createMapDragGhost(car, clientX, clientY);
}

function _handleMapCarPointerDown(event) {
  if (!window.PointerEvent) return;
  if (_mapaRuntime.pinchState) return;
  if (event.pointerType === 'touch') return;
  if (event.button !== 0) return;
  const car = event.currentTarget;
  if (!car) return;
  _finishMapDrag();
  _mapDragState.pendingPointer = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    car
  };
}

function _handleMapPointerMove(event) {
  const pending = _mapDragState.pendingPointer;
  if (pending && !_mapDragState.active) {
    if (event.pointerId !== pending.id) return;
    const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
    if (distance < 8) return;
    event.preventDefault();
    _startPointerMapDrag(pending, event.clientX, event.clientY);
  }

  if (!_mapDragState.active || event.pointerId !== _mapDragState.activePointerId) return;
  event.preventDefault();
  _positionMapDragGhost(event.clientX, event.clientY);
  const zone = _resolveMapDropZone(document.elementFromPoint(event.clientX, event.clientY));
  _updateMapDropHighlight(zone, _mapDragState.sourceCar);
}

async function _handleMapPointerUp(event) {
  if (_mapDragState.pendingPointer && !_mapDragState.active) {
    if (event.pointerId === _mapDragState.pendingPointer.id) {
      _cancelPendingMapPointerDrag();
    }
    return;
  }
  if (!_mapDragState.active || event.pointerId !== _mapDragState.activePointerId) return;
  event.preventDefault();
  const zone = _resolveMapDropZone(document.elementFromPoint(event.clientX, event.clientY)) || _mapDragState.currentZone;
  _mapDragSuppressClickUntil = Date.now() + 450;
  const sourceCar = _mapDragState.sourceCar;
  _finishMapDrag();
  await _handleMapUnitDrop(sourceCar, zone, { fromDrag: true });
}

function _handleMapTouchDragMove(event) {
  if (_mapDragState.touchTimer && !_mapDragState.active && _mapDragState.pendingTouch) {
    const touch = Array.from(event.touches).find(t => t.identifier === _mapDragState.pendingTouch.id);
    if (!touch) return;
    if (Math.hypot(touch.clientX - _mapDragState.pendingTouch.startX, touch.clientY - _mapDragState.pendingTouch.startY) > 12) {
      _finishMapDrag();
    }
    return;
  }

  if (!_mapDragState.active) return;
  const touch = Array.from(event.touches).find(t => t.identifier === _mapDragState.activeTouchId);
  if (!touch) return;
  event.preventDefault();
  _positionMapDragGhost(touch.clientX, touch.clientY);
  const zone = _resolveMapDropZone(document.elementFromPoint(touch.clientX, touch.clientY));
  _updateMapDropHighlight(zone, _mapDragState.sourceCar);
}

async function _handleMapTouchDragEnd(event) {
  if (_mapDragState.touchTimer && !_mapDragState.active) {
    _finishMapDrag();
    return;
  }
  if (!_mapDragState.active) return;

  const touch = Array.from(event.changedTouches).find(t => t.identifier === _mapDragState.activeTouchId) || event.changedTouches[0];
  const zone = touch
    ? (_resolveMapDropZone(document.elementFromPoint(touch.clientX, touch.clientY)) || _mapDragState.currentZone)
    : _mapDragState.currentZone;
  _mapDragSuppressClickUntil = Date.now() + 450;
  if (touch) event.preventDefault();
  const sourceCar = _mapDragState.sourceCar;
  _finishMapDrag();
  await _handleMapUnitDrop(sourceCar, zone, { fromDrag: true });
}

function _bindMapDragDropEvents() {
  if (_mapaRuntime.dragBindingsBound) return;
  document.addEventListener('dragover', _handleMapDragOver);
  document.addEventListener('drop', _handleMapDrop);
  if (window.PointerEvent) {
    document.addEventListener('pointermove', _handleMapPointerMove, { passive: false });
    document.addEventListener('pointerup', _handleMapPointerUp, { passive: false });
    document.addEventListener('pointercancel', _handleMapPointerUp, { passive: false });
  }
  document.addEventListener('touchmove', _handleMapTouchDragMove, { passive: false });
  document.addEventListener('touchend', _handleMapTouchDragEnd, { passive: false });
  document.addEventListener('touchcancel', _handleMapTouchDragEnd, { passive: false });
  _mapaRuntime.dragBindingsBound = true;
}

function _bindMapDropZoneInteractions(zone) {
  if (!zone || zone.dataset.mapDropBound === '1') return;
  zone.dataset.mapDropBound = '1';
  zone.addEventListener('dragover', _handleMapZoneDragOver);
  zone.addEventListener('drop', _handleMapZoneDrop);
}

function _bindMapDropZones() {
  document.querySelectorAll('.spot').forEach(_bindMapDropZoneInteractions);
  _bindMapDropZoneInteractions(document.getElementById('unidades-limbo'));
  _bindMapDropZoneInteractions(document.getElementById('unidades-taller'));
}

function _bindCarMapInteractions(car) {
  if (!car || car.dataset.dragBound === '1') return;
  car.dataset.dragBound = '1';
  const usePointerDrag = Boolean(window.PointerEvent);
  car.setAttribute('draggable', usePointerDrag ? 'false' : 'true');
  if (!usePointerDrag) {
    car.addEventListener('dragstart', _handleMapCarDragStart);
    car.addEventListener('dragend', _handleMapCarDragEnd);
  } else {
    car.addEventListener('pointerdown', _handleMapCarPointerDown);
  }
  car.addEventListener('touchstart', _handleMapCarTouchStart, { passive: true });
}

function _renderSwapStatus() {
  const swapDiv = document.getElementById('swap-container');
  if (!swapDiv) return;
  if (!MAP_SWAP_MODE_ACTIVE || !selectedAuto) {
    swapDiv.innerHTML = "";
    return;
  }
  swapDiv.innerHTML = `
        <div style="background:#eff6ff; border:2px solid #60a5fa; padding:15px; border-radius:18px; margin-top:15px;">
          <p style="color:#1d4ed8; font-weight:800; font-size:14px; text-align:center; margin:0 0 10px;">🔄 MODO CAMBIAR ACTIVO</p>
          <p style="color:#1e3a8a; font-weight:700; font-size:12px; line-height:1.6; text-align:center; margin:0;">
            Arrastra o toca otro auto para intercambiar posición. También puedes soltar <b>${selectedAuto.dataset.mva}</b> en un cajón vacío.
          </p>
          <button onclick="desactivarModoSwap(true)" style="margin-top:12px; width:100%; padding:12px; border-radius:12px; border:none; background:#dbeafe; color:#1d4ed8; font-weight:900; cursor:pointer;">
            CANCELAR CAMBIO
          </button>
        </div>
      `;
}

function activarModoSwap() {
  if (!selectedAuto) return;
  MAP_SWAP_MODE_ACTIVE = true;
  const menu = document.getElementById('moreActionsMenu');
  if (menu) menu.classList.remove('show');
  _renderSwapStatus();
  showToast(`Modo CAMBIAR activo para ${selectedAuto.dataset.mva}`, 'success');
}

function desactivarModoSwap(showFeedback = false) {
  MAP_SWAP_MODE_ACTIVE = false;
  _renderSwapStatus();
  if (showFeedback) showToast('Cambio de posición cancelado', 'info');
}

document.addEventListener('click', (e) => {
  if (Date.now() < _mapDragSuppressClickUntil) return;
  const carClicked = e.target.closest('.car');
  const spotClicked = e.target.closest('.spot') || e.target.closest('#unidades-limbo') || e.target.closest('#unidades-taller');

  if (MAP_SWAP_MODE_ACTIVE && selectedAuto) {
    if (carClicked && carClicked !== selectedAuto) {
      e.preventDefault();
      void mostrarConfirmacionSwap(selectedAuto, carClicked, carClicked.parentElement);
      e.stopPropagation();
      return;
    }
    if (spotClicked && !carClicked) {
      e.preventDefault();
      void _handleMapUnitDrop(selectedAuto, spotClicked);
      e.stopPropagation();
      return;
    }
  }

  if (carClicked) {
    _selectCarOnMap(carClicked);
    e.stopPropagation();
    return;
  }

  if (spotClicked && selectedAuto) {
    void _handleMapUnitDrop(selectedAuto, spotClicked);
  }
});

function mostrarDetalle(d, esActualizacionRemota = false) {
  if (!esActualizacionRemota) {
    const inputD = document.getElementById('searchInput');
    const inputM = document.getElementById('searchInputMobile');
    if (inputD) inputD.value = "";
    if (inputM) inputM.value = "";
    if (typeof buscarMasivo === "function") buscarMasivo();
  }

  const car = document.getElementById(`auto-${d.mva}`);
  const parent = car?.parentElement;
  const loc = parent?.classList?.contains('spot')
    ? _spotValueFromElement(parent)
    : (parent?.id === 'unidades-taller' ? 'TALLER' : 'LIMBO');

  const notasHtml = d.notas ? `<div class="nota-display" style="display:block;">📝 ${d.notas}</div>` : '';

  document.getElementById('detalle-unidad').innerHTML = `
    <div style="text-align: center; padding: 10px 0;">
      <h3 style="color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; margin-bottom: 2px;">Unidad Seleccionada</h3>
      <h2 style="color: var(--primary); font-weight: 900; font-size: 32px; line-height: 1; margin-bottom: 12px;">${d.mva}</h2>
      <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; font-size: 13px; font-weight: 600; color: #475569; background: #f1f5f9; padding: 10px; border-radius: 12px;">
        <span>📍 ${loc}</span><span style="color: #cbd5e1;">•</span><span>🏷️ ${d.placas || 'N/A'}</span><span style="color: #cbd5e1;">•</span><span>🚗 ${d.modelo || 'S/M'}</span><span style="color: #cbd5e1;">•</span><span style="text-transform: capitalize;">⚙️ ${d.estado || 'N/A'}</span>
      </div>
      ${notasHtml}
    </div>
  `;

  // --- LÓGICA DEL MENÚ INTELIGENTE ---
  let notesUpper = (d.notas || "").toUpperCase();
  let esUrgente = notesUpper.includes("URGENTE");
  let esDobleCero = notesUpper.includes("DOBLE CERO");
  let esApartado = notesUpper.includes("RESERVAD") || notesUpper.includes("APARTAD");
  let esManto = d.estado === "MANTENIMIENTO" || d.estado === "TALLER";

  let actionsHtml = "";
  let removeActions = "";

  // 🛡️ VERIFICACIÓN DE PERMISOS: ¿Es Auxiliar o Admin?
  const esAdmin = (typeof userRole !== 'undefined' && userRole === 'admin');

  // OPCIONES PARA AGREGAR
  if (esAdmin && !esApartado) actionsHtml += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'APARTAR')"><span class="material-icons" style="color:#fbbf24">lock</span> APARTAR UNIDAD</div>`;

  if (!esDobleCero) actionsHtml += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'DOBLE_CERO')"><span class="material-icons" style="color:#3b82f6">verified</span> AÑADIR DOBLE CERO</div>`;

  if (esAdmin && !esUrgente) actionsHtml += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'URGENTE')"><span class="material-icons" style="color:#ef4444">priority_high</span> MARCAR COMO URGENTE</div>`;

  if (esAdmin && !esManto) actionsHtml += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'MANTENIMIENTO')"><span class="material-icons" style="color:#ef4444">build</span> PONER EN "TALLER"</div>`;

  if (d.estado !== "LISTO") actionsHtml += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'LISTO')"><span class="material-icons" style="color:#10b981">check_circle</span> PONER EN "LISTO"</div>`;
  actionsHtml += `<div class="action-item" onclick="activarModoSwap()"><span class="material-icons" style="color:#2563eb">swap_horiz</span> CAMBIAR POSICIÓN</div>`;

  // OPCIONES PARA QUITAR (BORRAN LAS NOTAS) - Solo Admins pueden quitar cosas delicadas
  if (esAdmin && esApartado) removeActions += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'QUITAR_APARTADO')"><span class="material-icons" style="color:#64748b">lock_open</span> QUITAR APARTADO</div>`;

  // Cualquiera puede quitar doble cero si se equivocó
  if (esDobleCero) removeActions += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'QUITAR_DOBLE_CERO')"><span class="material-icons" style="color:#64748b">do_not_disturb_on</span> QUITAR DOBLE CERO</div>`;

  if (esAdmin && esUrgente) removeActions += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'QUITAR_URGENTE')"><span class="material-icons" style="color:#64748b">notifications_paused</span> QUITAR URGENTE</div>`;

  if (esAdmin && esManto) removeActions += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'QUITAR_MANTENIMIENTO')"><span class="material-icons" style="color:#64748b">build_circle</span> QUITAR DE MANTENIMIENTO</div>`;

  let divider = removeActions !== "" ? `<div style="height:1px; background:#e2e8f0; margin:5px 0;"></div>` : "";

  // DIBUJAR BOTONES
  const btnGrid = document.getElementById('infoPanelBtnGrid');
  if (!btnGrid) return;
  btnGrid.style.gridTemplateColumns = "1fr 1fr 1fr";
  let btnLimboStyle = (loc === "unidades-limbo" || loc === "unidades-taller") ? "opacity: 0.5; pointer-events: none;" : "cursor:pointer;";

  btnGrid.innerHTML = `
    <button id="btnMandarLimbo" onclick="resetUnitToLimbo()" style="padding:15px; border-radius:14px; border:none; background:#fee2e2; color:#ef4444; font-weight:900; font-size:13px; ${btnLimboStyle}">LIMBO 🗑️</button>

    <div style="position: relative;">
      <button onclick="document.getElementById('moreActionsMenu').classList.toggle('show')" style="width:100%; padding:15px; border-radius:14px; border:none; background:#e0f2fe; color:#0284c7; font-weight:900; cursor:pointer; font-size:13px; display:flex; align-items:center; justify-content:center; gap:5px; box-shadow: 0 4px 6px rgba(2, 132, 199, 0.2);">
        <span class="material-icons" style="font-size:18px">bolt</span> ACCIONES
      </button>
      <div id="moreActionsMenu" class="actions-dropdown">
        ${actionsHtml}
        ${divider}
        ${removeActions}
      </div>
    </div>

    <button onclick="cerrarPanel()" style="padding:15px; border-radius:14px; border:none; background:#f1f5f9; color:var(--primary); font-weight:900; cursor:pointer; font-size:13px;">CERRAR</button>
  `;

  document.getElementById('info-panel').classList.add('open');
  _renderSwapStatus();
  const zoomControls = document.querySelector('.zoom-controls');
  if (zoomControls) zoomControls.classList.add('panel-open');
  // [F7] Panel de utilidades rápidas
  if (typeof _renderPanelExtrasUnidad === 'function') _renderPanelExtrasUnidad(d.mva);
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('moreActionsMenu');
  if (menu && menu.classList.contains('show') && !e.target.closest('#info-panel div[style*="position: relative"]')) {
    menu.classList.remove('show');
  }
});

// Ocultar menú si das click afuera
document.addEventListener('click', (e) => {
  const menu = document.getElementById('moreActionsMenu');
  if (menu && menu.classList.contains('show') && !e.target.closest('#info-panel div[style*="position: relative"]')) {
    menu.classList.remove('show');
  }
});

// Ocultar el menú si hacen clic en cualquier otro lado
document.addEventListener('click', (e) => {
  const menu = document.getElementById('moreActionsMenu');
  if (menu && menu.classList.contains('show') && !e.target.closest('#info-panel div[style*="position: relative"]')) {
    menu.classList.remove('show');
  }
});

async function mostrarConfirmacionSwap(moviendo, ocupante, destino) {
  const destinoLabel = destino?.classList?.contains('spot')
    ? _spotValueFromElement(destino)
    : (destino?.id === 'unidades-taller' ? 'TALLER' : 'LIMBO');
  const ok = await mexConfirm(
    'Confirmar intercambio',
    `${destinoLabel} ya está ocupado por ${ocupante.dataset.mva}. ¿Intercambiar ${moviendo.dataset.mva} por ${ocupante.dataset.mva}?`,
    'warning'
  );
  if (!ok) {
    _renderSwapStatus();
    return false;
  }

  const origenRef = moviendo.parentElement;
  if (!origenRef || !destino) return false;
  MAP_SWAP_MODE_ACTIVE = false;
  origenRef.appendChild(ocupante);
  destino.appendChild(moviendo);
  lastMoveTime = Date.now();
  solicitarGuardadoProgresivo();
  cerrarPanel();
  actualizarContadores();
  return true;
}

function moverUnidadInmediato(unidad, destino) {
  if (!unidad || !destino || unidad.parentElement === destino) return;
  MAP_SWAP_MODE_ACTIVE = false;
  destino.appendChild(unidad);
  lastMoveTime = Date.now();
  solicitarGuardadoProgresivo();
  cerrarPanel();
  actualizarContadores();
}

function resetUnitToLimbo() {
  if (!selectedAuto) return;
  MAP_SWAP_MODE_ACTIVE = false;
  document.getElementById("unidades-limbo").appendChild(selectedAuto);
  lastMoveTime = Date.now();
  solicitarGuardadoProgresivo();
  cerrarPanel();
}

function solicitarGuardadoProgresivo() {
  _mapaSyncState.hasPendingWrite = true;
  isMoving = true;
  _setMapSyncBadge('queued');
  _programarGuardadoMapa(MAPA_SAVE_DEBOUNCE_MS);
}

function cerrarPanel() {
  if (selectedAuto) selectedAuto.classList.remove('selected');
  MAP_SWAP_MODE_ACTIVE = false;
  selectedAuto = null;
  document.getElementById('info-panel').classList.remove('open');
  document.getElementById('swap-container').innerHTML = "";

  const zoomBtn = document.querySelector('.zoom-controls');
  if (zoomBtn) zoomBtn.classList.remove('panel-open');

  if (window.zoomBuscadorActivo) {
    zoomLevel = (window.innerWidth <= 768) ? 0.5 : 0.8;
    updateZoom();
    window.zoomBuscadorActivo = false;
  }

  limpiarBusqueda(false);
}

function sincronizarEstadoSidebars() {
  const sidebarOpen = document.getElementById('sidebar')?.classList.contains('open');
  const adminOpen = document.getElementById('admin-sidebar')?.classList.contains('open');
  document.body.classList.toggle('sidebar-open', !!sidebarOpen);
  document.body.classList.toggle('admin-sidebar-open', !!adminOpen);
  document.getElementById('overlay')?.classList.toggle('active', !!(sidebarOpen || adminOpen));
}

function toggleSidebar(forceState = null) {
  const sidebar = document.getElementById('sidebar');
  const adminSidebar = document.getElementById('admin-sidebar');
  if (!sidebar) return;

  const abrir = typeof forceState === 'boolean' ? forceState : !sidebar.classList.contains('open');
  if (abrir) adminSidebar?.classList.remove('open');
  sidebar.classList.toggle('open', abrir);
  sincronizarEstadoSidebars();
}

function toggleAdminSidebar(forceState = null) {
  toggleSidebar(forceState);
}

function closeMainSidebars() {
  toggleSidebar(false);
  toggleAdminSidebar(false);
}

function actualizarContadores() {
  // 1. Contadores del sidebar izquierdo (Limbo)
  const limbo = document.getElementById('unidades-limbo');
  const taller = document.getElementById('unidades-taller');
  if (limbo) document.getElementById('count-limbo').innerText = limbo.children.length;
  if (taller) document.getElementById('count-taller').innerText = taller.children.length;

  // 2. CÁLCULO DE KPIs SUPERIORES
  let total = 0, listos = 0, sucios = 0, manto = 0, enPatio = 0, enTaller = 0;

  document.querySelectorAll('.car').forEach(car => {
    const estado = (car.dataset.estado || "").toUpperCase();
    const ubicacion = (car.dataset.ubicacion || "").toUpperCase();

    // Clasificar por Estado
    if (estado === "LISTO") listos++;
    else if (estado === "SUCIO") sucios++;
    else if (estado === "MANTENIMIENTO" || estado === "TALLER") manto++;

    // Clasificar por Ubicación Física
    if (ubicacion === "PATIO") {
      enPatio++;
      total++; // ¡MAGIA AQUÍ! Solo sumamos al TOTAL general si está en PATIO
    }
    else if (ubicacion === "TALLER") {
      enTaller++;
    }
  });

  // 3. Imprimir en la barra
  if (document.getElementById('kpi-total')) {
    document.getElementById('kpi-total').innerText = total;
    document.getElementById('kpi-listos').innerText = listos;
    document.getElementById('kpi-sucios').innerText = sucios;
    document.getElementById('kpi-manto').innerText = manto;
    document.getElementById('kpi-patio').innerText = enPatio;
    document.getElementById('kpi-taller-loc').innerText = enTaller;
  }

  // [F3.4] Actualizar banner global con niveles de saturación
  const totalSpots = document.querySelectorAll('.spot').length;
  _bannerState._totalSpots = totalSpots; // [F4] exponer para proyección
  _actualizarBannerGlobal({ ocupados: enPatio, totalSpots });
  // [F4.2] Recomendación automática cuando saturación ≥ 80%
  if (typeof _autoRecomendacionSaturacion === 'function') {
    const pctAuto = totalSpots > 0 ? Math.round((enPatio / totalSpots) * 100) : 0;
    _autoRecomendacionSaturacion(pctAuto);
  }
}

function ejecutarAutoGuardado() {
  const reporte = _obtenerReportePosicionesMapa();
  const fingerprint = _firmaReportePosicionesMapa(reporte);

  if (!_mapaSyncState.hasPendingWrite && fingerprint === _mapaSyncState.lastSavedFingerprint && !isSaving) {
    _finalizarCicloGuardadoMapa();
    return;
  }

  if (isSaving) {
    _mapaSyncState.hasPendingWrite = true;
    _setMapSyncBadge('queued');
    return;
  }

  isSaving = true;
  _mapaSyncState.hasPendingWrite = false;
  _setMapSyncBadge('saving');

  const locationAuditPayload = typeof window.__mexGetLastLocationAuditPayload === 'function'
    ? window.__mexGetLastLocationAuditPayload()
    : {};
  api.guardarNuevasPosiciones(reporte, USER_NAME, _miPlaza(), locationAuditPayload).then((res) => {
    isSaving = false;

    if (res === true || res?.ok === true) {
      _mapaSyncState.lastConflicts = Array.isArray(res?.conflicts) ? res.conflicts : [];
      if (_mapaSyncState.lastConflicts.length > 0) {
        showToast(`Se detectaron ${_mapaSyncState.lastConflicts.length} conflicto(s) y el mapa se refrescará para evitar sobrescrituras.`, 'warning');
        refrescarDatos(true);
      }
      _mapaSyncState.lastSavedFingerprint = fingerprint;
      const currentFingerprint = _firmaReportePosicionesMapa(_obtenerReportePosicionesMapa());
      if (_mapaSyncState.hasPendingWrite || currentFingerprint !== fingerprint) {
        _mapaSyncState.hasPendingWrite = true;
        _setMapSyncBadge('queued');
        _programarGuardadoMapa(120);
        return;
      }
      _finalizarCicloGuardadoMapa();
    } else if (res?.code === 'CONFLICT' || (Array.isArray(res?.conflicts) && res.conflicts.length > 0)) {
      _mapaSyncState.lastConflicts = Array.isArray(res?.conflicts) ? res.conflicts : [];
      _setMapSyncBadge('error', 'CONFLICTO');
      showToast(`Otro usuario actualizó ${_mapaSyncState.lastConflicts.length || 1} unidad(es) antes de guardar. Se recargará el mapa.`, 'warning');
      refrescarDatos(true);
      _finalizarCicloGuardadoMapa();
    } else {
      _mapaSyncState.lastConflicts = [];
      _mapaSyncState.hasPendingWrite = true;
      _setMapSyncBadge('error');
      _programarGuardadoMapa(MAPA_SAVE_RETRY_MS);
    }
  }).catch((err) => {
    isSaving = false;
    _mapaSyncState.hasPendingWrite = true;
    _setMapSyncBadge('error', 'ERROR DE RED');
    _programarGuardadoMapa(MAPA_SAVE_RETRY_MS);
    console.error(err);
  });
}

function enfocarCajon(elemento) {
  window.zoomBuscadorActivo = true;

  // 1. ZOOM INTELIGENTE: Si es celular (<= 768px), se acerca a 0.95, si es PC a 1.1
  zoomLevel = (window.innerWidth <= 768) ? 0.95 : 1.1;
  updateZoom();

  // 2. EL TRUCO DEL CENTRADO: Esperamos 50ms para que el mapa termine de "inflarse"
  // antes de calcular dónde quedó el auto, así no falla la puntería.
  setTimeout(() => {
    const container = document.querySelector('.content');
    const elementRect = elemento.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const targetTop = container.scrollTop + (elementRect.top - containerRect.top) - (containerRect.height / 2) + (elementRect.height / 2);
    const targetLeft = container.scrollLeft + (elementRect.left - containerRect.left) - (containerRect.width / 2) + (elementRect.width / 2);

    container.scrollTo({
      top: targetTop,
      left: targetLeft,
      behavior: 'smooth'
    });

    showToast("Unidad localizada 🎯", "success");
  }, 50);
}

function limpiarBusqueda(resetearZoom = true) {
  const desktopInput = document.getElementById('searchInput');
  const mobileInput = document.getElementById('searchInputMobile');
  if (desktopInput) desktopInput.value = "";
  if (mobileInput) mobileInput.value = "";

  if (resetearZoom) {
    // ZOOM DE SALIDA INTELIGENTE: 0.5 para celular (más lejos), 0.8 para PC
    zoomLevel = (window.innerWidth <= 768) ? 0.5 : 0.8;
    updateZoom();
    window.zoomBuscadorActivo = false;
  }

  document.querySelectorAll('.car').forEach(c => c.classList.remove('car-focus'));
  ejecutarFiltroMasivo();
}




// ==========================================
// 3. FUNCIONES ADMIN (AUDITORIA, CSV, AGING)
// ==========================================

function activarAlertaOlvidados(checkbox) {
  const cars = document.querySelectorAll('.car');
  const hoy = new Date();
  const limiteDias = 4; // Tu criterio solicitado

  if (!checkbox.checked) {
    cars.forEach(car => car.classList.remove('ghost', 'forgotten'));
    return;
  }

  cars.forEach(car => {
    let fechaStr = car.dataset.ingreso;
    if (fechaStr && fechaStr !== "") {
      // Convertir fecha de Excel (DD/MM/YYYY) a objeto JS
      let partes = fechaStr.split(/[\/\- ]/);
      let fecha;
      if (partes[0].length === 4) fecha = new Date(partes[0], partes[1] - 1, partes[2]);
      else fecha = new Date(partes[2], partes[1] - 1, partes[0]);

      if (!isNaN(fecha)) {
        let diff = Math.floor((hoy - fecha) / (1000 * 60 * 60 * 24));
        if (diff >= limiteDias) {
          car.classList.add('forgotten');
          car.classList.remove('ghost');
        } else {
          car.classList.add('ghost');
          car.classList.remove('forgotten');
        }
      } else { car.classList.add('ghost'); }
    } else { car.classList.add('ghost'); }
  });
  toggleAdminSidebar(false); // Cerrar para ver el resultado
}

function exportarMapa() {
  showToast("Capturando imagen... (Espera unos segundos)", "success");
  toggleAdminSidebar(false); // Cerramos el menú

  const mapContainer = document.getElementById('map-zoom-container');
  const gridMap = document.getElementById('grid-map');

  // 1. Guardar el nivel de zoom actual
  let prevZoom = zoomLevel;

  // 2. Resetear el zoom a 1 (Tamaño real)
  zoomLevel = 1;
  updateZoom();

  // 3. Darle 500ms al navegador para redibujar el CSS antes de tomar la foto
  setTimeout(() => {
    // Usamos html2canvas sobre el Grid directamente
    html2canvas(gridMap, {
      backgroundColor: "#2A3441",
      scale: 2, // Multiplicador para HD
      useCORS: true,
      // Forzamos el tamaño real del grid
      width: gridMap.scrollWidth,
      height: gridMap.scrollHeight
    }).then(canvas => {

      // 4. Restaurar el zoom como lo tenía el usuario
      zoomLevel = prevZoom;
      updateZoom();

      // 5. Convertir a imagen y descargar
      let link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `Captura_Patio_${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      showToast("¡Fotografía guardada con éxito!", "success");
    }).catch(err => {
      // Si hay error, de todos modos restauramos el zoom
      zoomLevel = prevZoom;
      updateZoom();
      showToast("Error al generar la captura", "error");
      console.error(err);
    });
  }, 500);
}

function abrirAuditoria() {
  toggleAdminSidebar(false);
  document.getElementById('audit-modal').classList.add('active');

  let htmlLimbo = "";
  let htmlCajones = "";
  let countLimbo = 0;
  let countCajones = 0;

  // Recorremos todos los carros dibujados en el mapa
  document.querySelectorAll('.car').forEach(car => {
    const mva = car.dataset.mva;
    const placa = car.dataset.placas || "S/P";
    const parentId = car.parentElement.id;

    if (parentId === 'unidades-limbo' || parentId === 'unidades-taller') {
      // ESTÁ EN EL LIMBO
      countLimbo++;
      let origen = parentId === 'unidades-limbo' ? "Patio" : "Taller";
      htmlLimbo += `<tr><td style="font-weight:900;">${mva}</td><td>${placa}</td><td style="font-size:10px; color:#64748b;">${origen}</td></tr>`;
    } else if (parentId.startsWith('spot-')) {
      // ESTÁ EN UN CAJÓN
      countCajones++;
      let cajon = _spotValueFromElement(car.parentElement);
      htmlCajones += `<tr><td style="font-weight:900; color:var(--mex-accent);">${mva}</td><td>${placa}</td><td style="font-weight:800;">${cajon}</td></tr>`;
    }
  });

  document.getElementById('audit-faltan-count').innerText = countLimbo;
  document.getElementById('audit-faltan-body').innerHTML = htmlLimbo || '<tr><td colspan="3" style="text-align:center; padding:20px;">No hay unidades en Limbo.</td></tr>';

  document.getElementById('audit-sobran-count').innerText = countCajones;
  document.getElementById('audit-sobran-body').innerHTML = htmlCajones || '<tr><td colspan="3" style="text-align:center; padding:20px;">No hay unidades asignadas.</td></tr>';
}
// ==========================================
// 4. LÓGICA DE GESTIÓN DE FLOTA Y ORDENAMIENTO
// ==========================================
let DB_FLOTA = [];
let currentFilterFlota = "TODOS";
let SELECT_REF_FLOTA = null;
let MODO_FLOTA = "INSERTAR";
let sortCol = "";
let sortAsc = true;
// 🔥 NUEVAS VARIABLES PARA EL MODO SWIPE Y FOTOS DE DRIVE 🔥
let window_IS_SWIPE_ACTIVE = false;
let currentSwipeIndex = 0; // 🔥 NUEVA GLOBAL PARA RASTREAR EL CARRO ACTUAL
let CACHE_IMAGENES_AUDIT = {};

function abrirModalFlota(initialTab) {
  if (!_isDedicatedCuadreIframeMode()) {
    _bindInlineFleetRouteState();
    const requestedTab = String(initialTab || (VISTA_ACTUAL_FLOTA === 'ADMINS' ? 'ADMINS' : 'NORMAL')).trim().toUpperCase() === 'ADMINS' ? 'ADMINS' : 'NORMAL';
    _syncInlineFleetRoute(requestedTab);
    _openFleetModalInPlace(requestedTab);
    return;
  }
  _openFleetModalInPlace(_cuadreInitialTab());
}

function _openFleetModalInPlace(initialTab = 'NORMAL') {
  document.getElementById('fleet-modal').classList.add('active');
  toggleAdminSidebar(false);
  // Repoblar selects cada vez que se abre — garantiza que estén al día
  if (typeof llenarSelectsDinamicos === 'function') llenarSelectsDinamicos();
  cargarFlota();

  // 1. BLINDAJE PARA AUXILIARES (Operativos)
  const esOperario = (typeof userRole !== 'undefined' && userRole !== 'admin');

  // Apagar botón de Registrar Nueva Unidad
  const btnNuevo = document.getElementById('btnNuevaUnidadFlota');
  if (btnNuevo) btnNuevo.style.display = esOperario ? 'none' : 'flex';

  // 🔥 APAGAR EL BOTÓN COMPLETO DE "MÁS CONTROLES" 🔥
  const menuMasControles = document.getElementById('btnMasControlesWrapper');
  if (menuMasControles) menuMasControles.style.display = esOperario ? 'none' : 'inline-block';


  // 2. BLINDAJE EXCLUSIVO PARA JEFES (Globales)
  const adminSection = document.getElementById('btnAdminControlsWrapper');
  if (adminSection) {
    adminSection.style.display = hasFullAccess() ? 'inline-block' : 'none';
  }

  const itemInsertarExterno = document.getElementById('mcInsertarExterno');
  if (itemInsertarExterno) {
    itemInsertarExterno.style.display = canInsertExternalUnits() ? 'flex' : 'none';
  }

  const btnLock = document.getElementById('btnLockMapa');
  if (btnLock) {
    btnLock.style.display = canLockMap() ? 'flex' : 'none';
  }

  const targetTab = String(initialTab || 'NORMAL').toUpperCase() === 'ADMINS' ? 'ADMINS' : 'NORMAL';
  setTimeout(() => cambiarTabFlota(targetTab), 0);
}

function cerrarModalFlota() {
  document.getElementById('fleet-modal').classList.remove('active');
  if (_isDedicatedCuadreIframeMode()) {
    _navigateTop('/mapa');
    return;
  }
  if (/^\/cuadre(?:\.html)?$/i.test(window.location.pathname || '')) {
    _restoreInlineFleetRoute();
  }
  sincronizarEstadoSidebars();
  refrescarDatos();
}

function cargarFlota() {
  document.getElementById('tablaCuerpoFlota').innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 40px; color: #64748b;"><span class="material-icons spinner" style="vertical-align:middle; margin-right:8px;">sync</span>Cargando inventario...</td></tr>`;

  api.obtenerDatosFlotaConsola(_miPlaza()).then(data => {
    let unicos = [];
    let mvasVistos = new Set();
    (data || []).forEach(u => {
      if (!mvasVistos.has(u.mva)) {
        mvasVistos.add(u.mva);
        unicos.push(u);
      }
    });

    DB_FLOTA = unicos;
    filtrarFlota();
    document.getElementById('statTotal').innerText = DB_FLOTA.length;
    document.getElementById('statListos').innerText = DB_FLOTA.filter(d => d.estado === 'LISTO').length;
  }).catch(e => console.error(e));
}

function sortFlota(col) {
  if (sortCol === col) {
    sortAsc = !sortAsc;
  } else {
    sortCol = col;
    sortAsc = true;
  }

  document.querySelectorAll('.sort-icon').forEach(icon => icon.innerText = 'unfold_more');
  const activeIcon = document.getElementById(`sort-${col}`);
  if (activeIcon) activeIcon.innerText = sortAsc ? 'expand_less' : 'expand_more';

  filtrarFlota();
}

function filtrarFlota() {
  const s = document.getElementById('searchFlota').value.toUpperCase().trim();

  // 1. Capturamos lo que el usuario eligió en los filtros tipo Excel
  const fCat = document.getElementById('filter-cat') ? document.getElementById('filter-cat').value.toUpperCase() : "";
  const fMod = document.getElementById('filter-modelo') ? document.getElementById('filter-modelo').value.toUpperCase() : "";
  const fEst = document.getElementById('filter-est') ? document.getElementById('filter-est').value.toUpperCase() : "";
  const fUbi = document.getElementById('filter-ubi') ? document.getElementById('filter-ubi').value.toUpperCase() : "";

  // Colorear los filtros de Azul si están activos
  ['filter-cat', 'filter-modelo', 'filter-est', 'filter-ubi'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('filter-active', el.value !== "");
  });

  const baseDatosActiva = (VISTA_ACTUAL_FLOTA === 'NORMAL') ? DB_FLOTA : DB_ADMINS;

  let filtrados = baseDatosActiva.filter(u => {
    const notas = (u.notas || "").toUpperCase();
    const estado = (u.estado || "").toUpperCase();
    const responsable = _resolverResponsableCuadreAdmin(u).toUpperCase();
    const adminResponsable = String(u.adminResponsable || u._updatedBy || u._createdBy || '').toUpperCase();

    // A) BUSCADOR GLOBAL
    const stringBusqueda = (
      u.etiqueta || `${u.categoria} ${u.modelo} ${u.placas} ${u.mva} ${u.estado} ${u.ubicacion}`
    ).toUpperCase() + " " + notas + " " + responsable + " " + adminResponsable;
    const pasaBuscador = s === "" || stringBusqueda.includes(s);

    // B) FILTROS EXCEL
    const pasaCat = fCat === "" || (u.categoria || u.categ || "").toUpperCase().includes(fCat);
    const pasaMod = fMod === "" || (u.modelo || "").toUpperCase().includes(fMod);
    const pasaEst = fEst === "" || estado === fEst;
    const pasaUbi = fUbi === "" || (u.ubicacion || "").toUpperCase().includes(fUbi);

    // C) 🔥 FILTROS ESPECIALES (CHIPS DE NOTAS + ESTADO + UBICACIÓN) 🔥
    let pasaEspecial = true;
    if (currentFiltroEspecial === 'DOBLE CERO') {
      pasaEspecial = notas.includes('DOBLE CERO');
    } else if (currentFiltroEspecial === 'APARTADO') {
      pasaEspecial = notas.includes('RESERVAD') || notas.includes('APARTAD');
    } else if (currentFiltroEspecial === 'URGENTE') {
      pasaEspecial = notas.includes('URGENTE');
    } else if (currentFiltroEspecial === 'RESGUARDO') {
      pasaEspecial = estado === 'RESGUARDO' || notas.includes('RESGUARDO');
    // [F2.5] Modo limpieza — filtros por estado operativo
    } else if (currentFiltroEspecial === 'SUCIO') {
      pasaEspecial = estado === 'SUCIO';
    } else if (currentFiltroEspecial === 'LISTO') {
      pasaEspecial = estado === 'LISTO';
    } else if (currentFiltroEspecial === 'MANTENIMIENTO') {
      pasaEspecial = estado === 'MANTENIMIENTO' || estado === 'NO ARRENDABLE' || estado === 'RETENIDA';
    } else if (currentFiltroEspecial === 'TRASLADO') {
      pasaEspecial = estado === 'TRASLADO';
    // [F2.6] Modo taller — ubicación en taller
    } else if (currentFiltroEspecial === 'TALLER') {
      const ubi = (u.ubicacion || '').toUpperCase();
      pasaEspecial = ubi.includes('TALLER') || estado === 'MANTENIMIENTO' || estado === 'RETENIDA' || estado === 'NO ARRENDABLE';
    }

    // Solo mostramos el auto si cumple con TODO lo que esté seleccionado
    return pasaBuscador && pasaCat && pasaMod && pasaEst && pasaUbi && pasaEspecial;
  });

  // Ordenamiento (MVA, Modelo, etc.)
  if (sortCol) {
    filtrados.sort((a, b) => {
      let valA = (a[sortCol] || '').toString().toLowerCase();
      let valB = (b[sortCol] || '').toString().toLowerCase();
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  renderFlota(filtrados);
}

// 🔥 FUNCIÓN PARA EL BOTÓN "X" (LIMPIAR TODO) 🔥
function limpiarFiltrosFlota() {
  document.getElementById('searchFlota').value = "";

  if (document.getElementById('filter-cat')) document.getElementById('filter-cat').value = "";
  if (document.getElementById('filter-est')) document.getElementById('filter-est').value = "";
  if (document.getElementById('filter-ubi')) document.getElementById('filter-ubi').value = "";

  // Reseteamos la memoria del chip especial a "TODOS"
  currentFiltroEspecial = "TODOS";

  // Apagamos los chips azules y prendemos el primero ("Todos")
  document.querySelectorAll('#chipContainer .chip').forEach(c => c.classList.remove('active'));
  const chipTodos = document.querySelector('#chipContainer .chip:first-child');
  if (chipTodos) chipTodos.classList.add('active');

  filtrarFlota();
  _actualizarBatchBar(); // [2.5]
}


let DATOS_TABLA_ACTUAL = []; // 🔥 Memoria para saber qué estamos viendo


function renderFlota(data) {
  // 🔥 1. GUARDAMOS LA LISTA FILTRADA EN LA MEMORIA 🔥
  DATOS_TABLA_ACTUAL = data;

  const tbody = document.getElementById('tablaCuerpoFlota');
  const thAutor = document.getElementById('th-autor');

  if (thAutor) {
    thAutor.style.display = (VISTA_ACTUAL_FLOTA === 'ADMINS') ? 'table-cell' : 'none';
    thAutor.innerText = 'Notas / Responsable';
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 40px; color: #64748b;">No se encontraron registros.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map((u, i) => {
    const gasClass = u.gasolina === "F" ? "td-gas-f" : "td-gas";
    const estadoClass = u.estado ? u.estado.replace(/\s+/g, '') : "SUCIO";

    let ubiClass = "ubi-DEFAULT";
    let ubiUpper = (u.ubicacion || "").toUpperCase();
    if (ubiUpper.includes("PATIO")) ubiClass = "ubi-PATIO";
    else if (ubiUpper.includes("TALLER")) ubiClass = "ubi-TALLER";
    else if (ubiUpper.includes("AGENCIA")) ubiClass = "ubi-AGENCIA";
    else if (ubiUpper.includes("EXTERNO") || ubiUpper.includes("HYP")) ubiClass = "ubi-EXTERNO";
    else if (ubiUpper && !_esPlazaFija(ubiUpper.replace(/^👤\s*/i, '').trim())) ubiClass = "ubi-PERSONA";

    const responsable = _resolverResponsableCuadreAdmin(u);
    const adminResponsable = String(u.adminResponsable || u._updatedBy || u._createdBy || '').trim();
    const notaResumen = escapeHtml(_resumirTextoCuadreAdmin(u.notas || ''));
    const responsableLabel = escapeHtml(responsable || adminResponsable || 'Sin responsable');
    const extraAdminLine = adminResponsable && adminResponsable !== responsable
      ? `<span style="font-size:10px; color:#94a3b8; font-weight:800;">Capturó: ${escapeHtml(adminResponsable)}</span>`
      : '';
    const tdAutor = (VISTA_ACTUAL_FLOTA === 'ADMINS')
      ? `<td style="min-width:220px;">
          <div style="display:flex; flex-direction:column; gap:5px;">
            <span style="font-size:10px; font-weight:900; color:#0f172a;">${notaResumen}</span>
            <span style="font-size:10px; color:#64748b; font-weight:800;">Responsable: ${responsableLabel}</span>
            ${extraAdminLine}
          </div>
        </td>`
      : '';

    const isMobileOrAdmin = (typeof userRole !== 'undefined' && userRole === 'admin');
    const isMobileVisual = window.innerWidth <= 950;
    const formBotones = (isMobileOrAdmin && isMobileVisual && VISTA_ACTUAL_FLOTA === 'NORMAL')
      ? '<div style="display:flex; gap:10px; margin-top:10px; width:100%; border-top:1px dashed #e2e8f0; padding-top:10px;" class="card-quick-actions">' +
      '<button onclick="event.stopPropagation(); seleccionarFilaFlota(' + i + ', this.closest(\'tr\')); setTimeout(()=>window.scrollTo(0, document.body.scrollHeight), 50);" style="background:#f1f5f9; color:var(--mex-blue); border:none; padding:8px 15px; border-radius:8px; display:flex; align-items:center; gap:5px; font-weight:800; cursor:pointer; flex:1; justify-content:center;">' +
      '<span class="material-icons" style="font-size:16px;">edit</span> EDITAR' +
      '</button>' +
      '<button onclick="event.stopPropagation(); seleccionarFilaFlota(' + i + ', this.closest(\'tr\')); setTimeout(()=>document.getElementById(\'btnDelFlota\').click(), 100);" style="background:#fee2e2; color:var(--mex-red); border:none; padding:8px 15px; border-radius:8px; display:flex; align-items:center; gap:5px; font-weight:800; cursor:pointer; flex:1; justify-content:center;">' +
      '<span class="material-icons" style="font-size:16px;">delete</span> ELIMINAR' +
      '</button>' +
      '</div>'
      : '';

    return `
    <tr onclick="seleccionarFilaFlota(${i}, this)" data-mva="${u.mva}">
      <td class="td-mva"><div style="display:block;">${u.mva}</div>${formBotones}</td>
      <td><span class="td-cat">${u.categoria || u.categ || 'N/A'}</span></td>
      <td>${u.modelo}</td>
      <td style="color: #64748b;">${u.placas}</td>
      <td><span class="${gasClass}">${u.gasolina}</span></td>
      <td><span class="badge st-${estadoClass}">${u.estado}</span></td>
      <td><span class="ubi-badge ${ubiClass}">${u.ubicacion}</span></td>
      ${tdAutor}
    </tr>
    `;
  }).join('');
  _actualizarBatchBar(); // [2.5] refresh count after render
}


function abrirFormularioFlota() {
  const panel = document.getElementById('form-flota-panel');
  const overlay = document.getElementById('form-flota-overlay');
  if (panel) panel.classList.add('active');
  if (overlay) overlay.classList.add('active');
}

function cerrarFormularioFlota() {
  const panel = document.getElementById('form-flota-panel');
  const overlay = document.getElementById('form-flota-overlay');
  if (panel) panel.classList.remove('active');
  if (overlay) overlay.classList.remove('active');
}

// ==========================================
// MANEJADOR BOTÓN FLOTANTE GLOBAL DE CUADRE
// ==========================================
function manejarBotonAgregarFlotante() {
  if (VISTA_ACTUAL_FLOTA === 'ADMINS') {
    if (!hasFullAccess()) {
      showToast("No tienes permisos suficientes para modificar Cuadre Admins.", "error");
      return;
    }
    abrirModalInsertarAdmin();
  } else {
    prepararNuevoFlota();
  }
}

function seleccionarFilaFlota(index, rowElement) {
  // Resaltar la fila seleccionada
  document.querySelectorAll('#tablaCuerpoFlota tr').forEach(tr => tr.classList.remove('selected'));
  rowElement.classList.add('selected');

  // Obtener la unidad desde la memoria de la tabla actual
  SELECT_REF_FLOTA = DATOS_TABLA_ACTUAL[index];

  if (!SELECT_REF_FLOTA) return;

  if (VISTA_ACTUAL_FLOTA === 'NORMAL') {
    // ---- LÓGICA FLOTA REGULAR (Panel Lateral Derecho) [cite: 883] ----
    MODO_FLOTA = "MODIFICAR";
    let esSoloLectura = (typeof userRole !== 'undefined' && userRole !== 'admin');

    document.getElementById('formTitleFlota').innerText = (esSoloLectura ? "VISUALIZANDO: " : "MODIFICANDO: ") + SELECT_REF_FLOTA.mva;
    document.getElementById('admin-flota-panel-hint').style.display = 'none';
    document.getElementById('autofill-section').style.display = 'none';
    document.getElementById('form-fields-container').style.display = 'flex';

    document.getElementById('f_mva').value = SELECT_REF_FLOTA.mva || "";
    document.getElementById('f_cat').value = SELECT_REF_FLOTA.categoria || SELECT_REF_FLOTA.categ || "N/A";
    document.getElementById('f_mod').value = SELECT_REF_FLOTA.modelo || "";
    document.getElementById('f_pla').value = SELECT_REF_FLOTA.placas || "";
    document.getElementById('f_est').value = SELECT_REF_FLOTA.estado || "";
    document.getElementById('f_gas').value = SELECT_REF_FLOTA.gasolina || "N/A";
    document.getElementById('f_ubi').value = SELECT_REF_FLOTA.ubicacion || "";
    document.getElementById('f_not').value = SELECT_REF_FLOTA.notas || "";

    ['f_est', 'f_gas', 'f_ubi', 'f_not'].forEach(id => document.getElementById(id).disabled = esSoloLectura);

    document.getElementById('del-note-wrapper').style.display = esSoloLectura ? 'none' : 'flex';
    if (document.getElementById('f_del_note')) document.getElementById('f_del_note').checked = false;

    if (document.getElementById('btnDelFlota')) document.getElementById('btnDelFlota').style.display = esSoloLectura ? "none" : "flex";
    if (document.getElementById('btnSaveFlota')) document.getElementById('btnSaveFlota').style.display = esSoloLectura ? "none" : "flex";

    abrirFormularioFlota();
  } else {
    // ---- LÓGICA CUADRE ADMINS (Abre el Modal de Expediente) [cite: 890] ----

    // Verificamos permisos mínimos
    if (typeof userRole === 'undefined' || userRole !== 'admin') {
      showToast("No tienes permisos para ver esta información.", "error");
      return;
    }

    // Determinamos si es un Admin Normal (Solo Lectura) o Global (Edición) [cite: 891]
    let esSoloLecturaAdmin = !canEditAdminCuadre();

    // Abrimos el modal correcto [cite: 1234]
    document.getElementById('modal-editar-admin').classList.add('active');

    // Ponemos el MVA en la cabecera del modal [cite: 1235]
    document.getElementById('a_mod_badgeMVA').innerText = SELECT_REF_FLOTA.mva;

    // Llamamos a la función que llena los campos del expediente [cite: 1140]
    abrirExpedienteAdmin(SELECT_REF_FLOTA, esSoloLecturaAdmin);
  }
  validarBotonGuardar();
}

let autofillTimer;
function debouncedAutofill(val) {
  clearTimeout(autofillTimer);
  autofillTimer = setTimeout(() => {
    filtrarAutofill(val);
  }, 300);
}

function filtrarAutofill(val) {
  const term = val.toUpperCase().trim();
  const container = document.getElementById('autofill-results');
  if (term === "") { container.style.display = 'none'; return; }

  const filtrados = DB_MAESTRA.filter(u =>
    (u.mva && u.mva.toUpperCase().includes(term)) ||
    (u.placas && u.placas.toUpperCase().includes(term)) ||
    (u.modelo && u.modelo.toUpperCase().includes(term))
  ).slice(0, 15);

  if (filtrados.length === 0) {
    container.innerHTML = '<div style="padding:15px; font-size:13px; color:#64748b; text-align:center;">🚫 No encontrada en Base Maestra</div>';
  } else {
    container.innerHTML = filtrados.map(u => `
      <div class="autofill-item" onclick='aplicarAutofill(${JSON.stringify(u)})'>
        <div>
          <b style="font-size:14px; color:var(--mex-blue); display:block;">${u.mva}</b>
          <span style="font-size:11px; color:#64748b; font-weight:600;">🚗 ${u.modelo} • 🏷️ ${u.placas}</span>
        </div>
        <span class="material-icons" style="color:var(--mex-accent);">add_circle</span>
      </div>
    `).join('');
  }
  container.style.display = 'block';
}

function aplicarAutofill(u) {
  document.getElementById('f_mva').value = u.mva || '';
  document.getElementById('f_cat').value = u.categoria || u.categ || '';
  document.getElementById('f_mod').value = u.modelo || '';
  document.getElementById('f_pla').value = u.placas || '';

  document.getElementById('autofill-results').style.display = 'none';
  document.getElementById('autofill-input').value = u.mva + " - " + u.modelo;
  document.getElementById('autofill-input').disabled = true;
  document.getElementById('btnResetAutofill').style.display = 'block';

  document.getElementById('form-fields-container').style.display = 'flex';
  showToast("Datos autocompletados", "success");
  validarBotonGuardar();
}

function resetAutofill() {
  document.getElementById('form-fields-container').style.display = 'none';
  document.getElementById('autofill-input').disabled = false;
  document.getElementById('autofill-input').value = "";
  document.getElementById('btnResetAutofill').style.display = 'none';
  document.getElementById('autofill-input').focus();

  // Limpiamos todos los campos de texto
  ['f_mva', 'f_cat', 'f_mod', 'f_pla', 'f_not', 'f_est', 'f_ubi'].forEach(id => {
    if (document.getElementById(id)) document.getElementById(id).value = "";
  });

  // 🚨 CORRECCIÓN: La gasolina debe regresar a "N/A", no a vacío
  if (document.getElementById('f_gas')) document.getElementById('f_gas').value = "N/A";

  // Forzamos al botón a actualizarse
  validarBotonGuardar();
}

function prepararNuevoFlota() {
  // 1. BLOQUEO OPERATIVO (Por si de casualidad ve el botón) [cite: 2179]
  if (typeof userRole !== 'undefined' && userRole !== 'admin') {
    showToast("No tienes permisos para registrar unidades.", "error");
    return;
  }

  // 🔥 2. SI ESTAMOS EN CUADRE ADMINS 🔥 [cite: 2180]
  if (VISTA_ACTUAL_FLOTA === 'ADMINS') {
    if (!canEditAdminCuadre()) {
      showToast("⛔ Tu rol solo puede consultar el Cuadre Administrativo.", "error");
      return;
    }
    // Si es Jefe, le abrimos el modal diseñado específicamente para esto [cite: 2181]
    abrirModalInsertarAdmin();
    return;
  }

  // 3. LÓGICA: FLOTA REGULAR (Panel lateral derecho) [cite: 2182]
  MODO_FLOTA = "INSERTAR";
  SELECT_REF_FLOTA = null;
  document.querySelectorAll('#tablaCuerpoFlota tr').forEach(tr => tr.classList.remove('selected'));
  document.getElementById('formTitleFlota').innerText = "NUEVO REGISTRO";
  document.getElementById('formTitleFlota').style.color = "var(--mex-blue)";

  abrirFormularioFlota();

  document.getElementById('form-fields-container').style.display = 'none';
  document.getElementById('admin-flota-panel-hint').style.display = 'none';
  document.getElementById('autofill-section').style.display = 'block';
  resetAutofill();
  document.getElementById('del-note-wrapper').style.display = 'none';
  if (document.getElementById('f_del_note')) document.getElementById('f_del_note').checked = false;
  if (document.getElementById('btnDelFlota')) document.getElementById('btnDelFlota').style.display = "none";

  const btnGuardar = document.getElementById('btnSaveFlota');
  if (btnGuardar) btnGuardar.style.display = "flex";

  // 🔥 4. NUEVO: GUÍA VISUAL Y AUTO-FOCUS 🔥
  const searchInput = document.getElementById('autofill-input');
  if (searchInput) {
    // a) Ponemos el cursor adentro automáticamente para que escriban de una vez
    setTimeout(() => searchInput.focus(), 100);

    // b) Forzamos el reinicio de la animación por si le dan clic varias veces seguidas
    searchInput.classList.remove('pulse-attention');
    void searchInput.offsetWidth; // Truco de CSS para reiniciar la animación
    searchInput.classList.add('pulse-attention');

    // c) Aseguramos que la caja esté visible haciendo scroll si hace falta
    searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  validarBotonGuardar();
}


function ejecutarGuardadoFlota() {
  const mvaField = document.getElementById('f_mva');
  const estField = document.getElementById('f_est');

  let isValid = true;
  if (!mvaField.value) {
    showToast("Busca y selecciona una unidad", "error");
    isValid = false;
  }
  if (!estField.value) {
    estField.classList.add('input-error');
    setTimeout(() => estField.classList.remove('input-error'), 400);
    isValid = false;
  }
  if (!isValid) return;

  // 🔥 SINCRONIZADOR: Si movieron el mapa justo antes de entrar a la tabla, guarda ese movimiento AHORA
  if (saveTimeout || _mapaSyncState.hasPendingWrite || isMoving) {
    _forzarGuardadoMapaPendiente();
  }

  const btn = document.getElementById('btnSaveFlota');
  btn.innerHTML = `<span class="material-icons spinner">sync</span> Guardando...`;
  btn.disabled = true;

  const payload = {
    mva: mvaField.value.toUpperCase().trim(),
    categ: document.getElementById('f_cat').value.toUpperCase().trim(),
    modelo: document.getElementById('f_mod').value.toUpperCase().trim(),
    placas: document.getElementById('f_pla').value.toUpperCase().trim(),
    gasolina: document.getElementById('f_gas').value,
    estado: estField.value,
    ubicacion: document.getElementById('f_ubi').value,
    notas: document.getElementById('f_not').value,
    borrarNotas: document.getElementById('f_del_note') ? document.getElementById('f_del_note').checked : false,
    autor: USER_NAME, responsableSesion: USER_NAME, adminResponsable: USER_NAME,
    fila: SELECT_REF_FLOTA ? SELECT_REF_FLOTA.fila : null
  };

  if (VISTA_ACTUAL_FLOTA === 'NORMAL') {
    // ⚡ APLICACIÓN INSTANTÁNEA (SIN LAG) ⚡
    if (MODO_FLOTA === "INSERTAR") {
      actualizarTablaLocal(payload.mva, 'INSERTAR', payload); // Actualiza tabla
      showToast("Unidad insertada", "success");
      restaurarBotonFlota();
      prepararNuevoFlota();

      // Guardado silencioso de fondo en Google — etiquetar con plaza del usuario
      payload.plaza = _miPlaza() || '';
      api.insertarUnidadDesdeHTML(payload).catch(() => showToast("Error de red de fondo", "error"));
    } else {
      // 1. Modifica la Tabla al instante
      actualizarTablaLocal(payload.mva, 'MODIFICAR', payload);
      // 2. Modifica el mapa visual al instante
      if (typeof aplicarCambioDOM === "function") aplicarCambioDOM(payload.mva, payload.estado, payload.ubicacion, payload.gasolina, payload.notas);

      showToast("Modificación instantánea", "success");
      restaurarBotonFlota();
      prepararNuevoFlota(); // Limpia formulario

      // 3. Enviamos los datos reales a Google sin trabar la pantalla
      api.aplicarEstado(payload.mva, payload.estado, payload.ubicacion, payload.gasolina, payload.notas, payload.borrarNotas, payload.autor, payload.responsableSesion, _miPlaza()).catch(() => showToast("Error de sincronización", "error"));
    }
  }
  else {
    // 👑 LÓGICA CUADRE ADMINS (Requiere recarga por las fotos y archivos pesados)
    const tipoAccion = (MODO_FLOTA === "INSERTAR") ? "ADD" : "MODIFICAR";
    api.procesarModificacionMaestra(payload, tipoAccion).then(res => {
      if (res === "EXITO") {
        showToast("Cuadre Admins actualizado", "success");
        cambiarTabFlota('ADMINS');
        restaurarBotonFlota();
        prepararNuevoFlota();
      } else {
        showToast(res, "error");
        restaurarBotonFlota();
      }
    }).catch(err => { showToast("Error en Cuadre Admins", "error"); restaurarBotonFlota(); });
  }
}

function ejecutarBorradoReal() {
  if (!SELECT_REF_FLOTA) return;

  const btn = document.getElementById('btnDelFlota');
  btn.innerHTML = `<span class="material-icons spinner">sync</span>`;
  btn.disabled = true;

  if (VISTA_ACTUAL_FLOTA === 'NORMAL') {
    const mvaABorrar = SELECT_REF_FLOTA.mva;

    // --- ⚡ ACTUALIZACIÓN OPTIMISTA (SIN LAG) ⚡ ---
    actualizarTablaLocal(mvaABorrar, 'ELIMINAR'); // Borra de la tabla instantáneamente

    // Borra del mapa si es necesario
    const carVisual = document.getElementById(`auto-${mvaABorrar}`);
    if (carVisual) carVisual.remove();

    showToast("Unidad eliminada de Flota", "success");

    // 🔥 CORRECCIÓN: Ya no descargamos la base vieja. Solo limpiamos la interfaz.
    restaurarBotonFlota();
    prepararNuevoFlota();
    actualizarContadores(); // Refresca los números gigantes de arriba

    // Guardado silencioso (El servidor lo borra tranquilamente en segundo plano)
    api.ejecutarEliminacion([mvaABorrar], USER_NAME, _miPlaza()).catch(() => showToast("Error de sincronización al borrar", "error"));

  }
  else {
    // 👑 BORRADO ADMINS (Mantiene la recarga porque es un proceso más complejo)
    const payload = {
      mva: SELECT_REF_FLOTA.mva,
      fila: SELECT_REF_FLOTA.fila,
      adminResponsable: USER_NAME
    };

    api.procesarModificacionMaestra(payload, "ELIMINAR").then(res => {
      if (res === "EXITO") {
        showToast("Fila eliminada de Cuadre Admins", "success");
        cambiarTabFlota('ADMINS');
        restaurarBotonFlota();
        prepararNuevoFlota();
      } else {
        showToast(res, "error");
        restaurarBotonFlota();
      }
    }).catch(err => { showToast("Error al eliminar de Admins", "error"); restaurarBotonFlota(); });
  }
}

function restaurarBotonFlota() {
  const btn = document.getElementById('btnSaveFlota');
  btn.innerHTML = `<span class="material-icons" style="font-size:18px">save</span> GUARDAR CAMBIOS`;
  btn.disabled = false;

  const btnDel = document.getElementById('btnDelFlota');
  if (btnDel) {
    btnDel.innerHTML = `<span class="material-icons">delete</span>`;
    btnDel.disabled = false;
  }
}

function finalizacionFlota() {
  restaurarBotonFlota();
  prepararNuevoFlota();
  cargarFlota();
}





// Variable para saber qué acción estamos confirmando en el modal
// ==========================================
// 5. LÓGICA DE ACCIONES RÁPIDAS Y MODALES
// ==========================================
let accionPendiente = null;
let mvaPendiente = null;

function ejecutarAccionRapida(mva, accion) {
  document.getElementById('moreActionsMenu').classList.remove('show');
  let car = document.getElementById(`auto-${mva}`);
  if (!car) return;

  mvaPendiente = mva;
  accionPendiente = accion;

  let estadoActual = car.dataset.estado;
  let notasActuales = car.dataset.notas || "";
  let ubiActual = car.dataset.ubicacion;
  let gasActual = car.dataset.gasolina;

  let nuevoEstado = estadoActual;
  let nuevasNotas = notasActuales;
  let msg = "Actualizando unidad...";
  let borrarTodo = false;

  if (accion === 'MANTENIMIENTO') {
    return prepararModalInput("Mandar a Taller", "¿Por qué este vehículo se va a mantenimiento?", "MANDAR A TALLER", "#ef4444");
  }
  else if (accion === 'APARTAR') {
    return prepararModalInput("Apartar Unidad", "Ingresa el nombre del cliente o motivo:", "GUARDAR APARTADO", "#1e293b");
  }

  // AÑADIR INSIGNIAS (Sumamos al historial, no borramos)
  if (accion === 'DOBLE_CERO') {
    nuevasNotas = notasActuales ? notasActuales + " | DOBLE CERO" : "DOBLE CERO";
    borrarTodo = false;
    msg = "Doble Cero añadido";
  }
  else if (accion === 'URGENTE') {
    nuevasNotas = notasActuales ? notasActuales + " | URGENTE" : "URGENTE";
    borrarTodo = false;
    msg = "Marcado como Urgente";

    // Rescatamos los valores en memoria por si el auto parpadea o se mueve en el DOM
    let waModelo = car.dataset.modelo || "S/M";
    let waPlacas = car.dataset.placas || "S/P";
    let waUbi = ubiActual;

    // 🔥 MAGIA WHATSAPP: Usamos tu modal personalizado anti-bloqueos
    setTimeout(() => {
      mostrarCustomModal(
        "Alerta de WhatsApp",
        `¿Deseas enviar un aviso al patio para que preparen el ${mva} INMEDIATAMENTE?`,
        "campaign",
        "#25D366",
        "ELEGIR AUXILIAR",
        "#25D366",
        () => {
          notificarUrgenciaWhatsApp(mva, waModelo, waPlacas, waUbi);
        }
      );
    }, 600);
  }
  else if (accion === 'LISTO') {
    nuevoEstado = "LISTO";
    msg = "Estado actualizado a LISTO";
  }

  // QUITAR INSIGNIAS (Vacían las notas en Google Sheets)
  else if (accion === 'QUITAR_DOBLE_CERO' || accion === 'QUITAR_URGENTE' || accion === 'QUITAR_APARTADO') {
    nuevasNotas = "";
    borrarTodo = true;
    msg = "Insignia retirada y notas borradas";
  }
  else if (accion === 'QUITAR_MANTENIMIENTO') {
    nuevoEstado = "SUCIO";
    nuevasNotas = "";
    borrarTodo = true;
    msg = "Retirado de taller y notas borradas";
  }

  showToast(msg, "success");
  enviarCambioRapido(mva, nuevoEstado, ubiActual, gasActual, nuevasNotas, borrarTodo);
}

function prepararModalInput(titulo, texto, btnTexto, btnColor) {
  document.getElementById('resTitle').innerText = titulo;
  document.getElementById('resText').innerText = texto;
  document.getElementById('reserveReason').value = "";
  document.getElementById('reserveReason').readOnly = false;

  let btn = document.getElementById('btnConfirmRes');
  btn.innerText = btnTexto;
  btn.style.background = btnColor;
  btn.onclick = procesarInputModal;

  document.getElementById('reserveModal').classList.add('active');
  setTimeout(() => document.getElementById('reserveReason').focus(), 100);
}

function procesarInputModal() {
  let notaIngresada = document.getElementById('reserveReason').value.trim();
  if (!notaIngresada) return showToast("Debes ingresar un motivo", "error");

  let car = document.getElementById(`auto-${mvaPendiente}`);
  if (!car) return;

  let estadoFinal = car.dataset.estado;
  let notasNuevasCompletas = "";

  if (accionPendiente === 'MANTENIMIENTO') {
    notasNuevasCompletas = `TALLER: ${notaIngresada.toUpperCase()}`;
    estadoFinal = "MANTENIMIENTO";
    showToast("Enviado a Taller", "success");
  }
  else if (accionPendiente === 'APARTAR') {
    notasNuevasCompletas = `APARTADO: ${notaIngresada.toUpperCase()}`;
    showToast("Unidad Apartada", "success");
  }

  cerrarReserveModal();

  // 🔥 CORRECCIÓN: Cambiamos 'true' por 'false' al final. ¡Queremos guardar la nota nueva!
  enviarCambioRapido(mvaPendiente, estadoFinal, car.dataset.ubicacion, car.dataset.gasolina, notasNuevasCompletas, false);
}

// 🔥 NUEVA FUNCIÓN: ACTUALIZACIÓN OPTIMISTA (INSTANTÁNEA) 🔥
// 🔥 NUEVA FUNCIÓN: ACTUALIZACIÓN OPTIMISTA (INSTANTÁNEA Y SEGURA) 🔥
function aplicarCambioDOM(mva, estado, ubi, gas, notas) {
  const car = document.getElementById(`auto-${mva}`);
  const ubiUpper = (ubi || "").toString().toUpperCase().trim();

  // 1. SI EL AUTO NO ESTABA EN PANTALLA
  if (!car) {
    if (ubiUpper === "PATIO" || ubiUpper === "TALLER" || ubiUpper === "LIMBO") {
      setTimeout(refrescarDatos, 500);
    }
    return;
  }

  const oldUbi = (car.dataset.ubicacion || "").toString().toUpperCase().trim();

  // 2. SI SALIÓ DEL PATIO O TALLER: Lo desaparecemos al instante
  if (ubiUpper !== "PATIO" && ubiUpper !== "TALLER" && ubiUpper !== "LIMBO") {
    car.style.transition = "all 0.3s ease";
    car.style.transform = "scale(0)";
    car.style.opacity = "0";
    setTimeout(() => {
      car.remove();
      actualizarContadores();
    }, 300);
    return;
  }

  // 3. EL TRUCO DEL LIMBO: Si regresó a PATIO o TALLER
  if (ubiUpper === "PATIO" && oldUbi !== "PATIO") {
    document.getElementById("unidades-limbo").appendChild(car);
    if (typeof solicitarGuardadoProgresivo === "function") solicitarGuardadoProgresivo();
  } else if (ubiUpper === "TALLER" && oldUbi !== "TALLER") {
    document.getElementById("unidades-taller").appendChild(car);
    if (typeof solicitarGuardadoProgresivo === "function") solicitarGuardadoProgresivo();
  }

  // 4. ACTUALIZAMOS DATOS EN MEMORIA
  car.dataset.estado = estado;
  car.dataset.ubicacion = ubi;
  if (gas) car.dataset.gasolina = gas;
  if (notas !== undefined) car.dataset.notas = notas;

  // Colores de estado
  const estadoClase = estado.toLowerCase().trim().replace(/\s+/g, '-');
  let extraClasses = "";
  if (car.classList.contains('ghost')) extraClasses += " ghost";
  if (car.classList.contains('forgotten')) extraClasses += " forgotten";
  if (car.classList.contains('selected')) extraClasses += " selected";
  car.className = `car ${estadoClase}${extraClasses}`;

  // ==========================================
  // 🔥 5. MAGIA DE INSIGNIAS INSTANTÁNEAS 🔥
  // ==========================================
  let textoNotas = (car.dataset.notas || "").toUpperCase();

  // Evaluamos las notas al momento para poner los iconos
  let urgHtml = textoNotas.includes("URGENTE") ? `<div class="urgent-badge">⚡</div>` : '';
  let lockHtml = (textoNotas.includes("RESERVAD") || textoNotas.includes("APARTAD")) ? `<div class="lock-badge">🔒</div>` : '';
  let docHtml = textoNotas.includes("DOBLE CERO") ? `<div class="doc-badge">🍃</div>` : '';
  let mantoHtml = (estado === "MANTENIMIENTO" || estado === "TALLER") ? `<div class="manto-badge">⚙️</div>` : '';

  // Rescatar el HTML del termómetro (Mapa de Calor) si lo tiene, para no borrarlo
  let calorHtml = "";
  const calorNode = car.querySelector('.badge-calor');
  if (calorNode) calorHtml = calorNode.outerHTML;

  // Reconstruir la barra de gasolina
  let gasBarHtml = "";
  let currentGas = car.dataset.gasolina;
  if (currentGas && currentGas !== "N/A") {
    let pct = 0; let gasColor = "#ffffff";
    if (currentGas === "F") pct = 100;
    else if (currentGas === "E") pct = 0;
    else if (currentGas === "H") pct = 50;
    else if (currentGas.includes('/')) {
      let parts = currentGas.split('/');
      if (parts.length === 2 && parseFloat(parts[1]) !== 0) pct = Math.round((parseFloat(parts[0]) / parseFloat(parts[1])) * 100);
    }
    if (pct >= 75) gasColor = "#4ade80"; else if (pct >= 37) gasColor = "#facc15"; else gasColor = "#f87171";
    gasBarHtml = `<div class="gas-container"><div class="gas-fill" style="width: ${pct}%; background: ${gasColor};"></div><span class="gas-text">${currentGas}</span></div>`;
  }

  // ¡REINYECCIÓN TOTAL AL INSTANTE!
  car.innerHTML = `${calorHtml}${lockHtml}${docHtml}${mantoHtml}${urgHtml}<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; pointer-events:none;"><span style="font-size: 19px; flex: 1; display: flex; align-items: center;">${mva}</span>${gasBarHtml}</div>`;

  actualizarContadores();
}

function enviarCambioRapido(mva, estado, ubi, gas, notas, borrarNotas = false) {
  cerrarPanel();

  // 🔥 SINCRONIZADOR: Si había un movimiento de auto pendiente de guardarse, FUÉRZALO a guardarse AHORA
  if (saveTimeout || _mapaSyncState.hasPendingWrite || isMoving) {
    _forzarGuardadoMapaPendiente();
  }

  // 1. MAGIA VISUAL: Actualiza el auto en el mapa al instante
  if (typeof aplicarCambioDOM === "function") aplicarCambioDOM(mva, estado, ubi, gas, notas);

  // 2. MAGIA EN TABLA: Actualiza la memoria para que los CHIPS funcionen al instante
  if (typeof actualizarTablaLocal === "function") {
    actualizarTablaLocal(mva, 'MODIFICAR', {
      estado: estado,
      ubicacion: ubi,
      gasolina: gas,
      notas: (borrarNotas) ? "" : notas // Si borrarNotas es true, mandamos vacío
    });
  }

  // 3. Sincronización silenciosa en Google (El orden de variables es correcto)
  api.aplicarEstado(mva, estado, ubi, gas, notas, borrarNotas, USER_NAME, USER_NAME, _miPlaza()).catch(() => showToast("Error de conexión", "error"));
}

function cerrarReserveModal() {
  document.getElementById('reserveModal').classList.remove('active');
}
// Alias para el botón estático del reserveModal (onclick="confirmarReserva()")
function confirmarReserva() { procesarInputModal(); }

function obtenerCredencialesMapa() { return getUsuariosAdmin(); }



// ==========================================
// 6. MÓDULO: GESTIÓN DE USUARIOS Y ROLES
// ==========================================
let _unsubUsuarios = null;
let _umUsers = [];
let _umSelectedId = null;

function abrirUsuarios() {
  if (!canManageUsers()) {
    showToast("Tu rol no puede gestionar usuarios.", "error");
    return;
  }
  abrirPanelConfiguracion('usuarios');
}

function cerrarUsuariosModal() {
  // Ahora los usuarios están dentro del Config modal; solo limpiar estado interno
  if (_unsubUsuarios) { _unsubUsuarios(); _unsubUsuarios = null; }
  _umUsers = []; _umSelectedId = null;
}

function _umIniciar() {
  if (_unsubUsuarios) _unsubUsuarios();
  document.getElementById('um-cards-container').innerHTML =
    '<div class="um-loading"><span class="material-icons spinner" style="vertical-align:middle;">sync</span> Cargando usuarios...</div>';

  _unsubUsuarios = db.collection(COL.USERS).onSnapshot(snap => {
    const currentDocId = String(
      currentUserProfile?.id
      || currentUserProfile?.email
      || auth.currentUser?.email
      || ''
    ).trim().toLowerCase();
    _umUsers = snap.docs
      .map(d => _normalizeUserProfile({ id: d.id, ...d.data() }))
      .filter(profile => {
        const candidateId = String(profile?.id || profile?.email || '').trim().toLowerCase();
        return !currentDocId || candidateId !== currentDocId;
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

    _umRenderCards();
    _cfgRefreshAdminHeroStats(true).catch(() => {});

    if (_umSelectedId) {
      const updated = _umUsers.find(u => u.id === _umSelectedId);
      if (updated) _umRenderEditForm(updated);
    }
  }, err => console.error('onSnapshot usuarios:', err));
}

function _umAvatarStyle(nombre) {
  const hue = ((nombre.charCodeAt(0) || 65) * 37) % 360;
  return `background:hsl(${hue},55%,48%);color:white;`;
}

function _umInitials(nombre) {
  return nombre.split(' ').slice(0, 2).map(w => w[0] || '').join('') || '?';
}

function _umRoleBadge(role) {
  const normalized = _sanitizeRole(role) || 'AUXILIAR';
  const styles = {
    AUXILIAR: 'background:#e2e8f0;color:#475569;',
    VENTAS: 'background:#dbeafe;color:#1d4ed8;',
    JEFE_REGIONAL: 'background:#dcfce7;color:#166534;',
    CORPORATIVO_USER: 'background:#fee2e2;color:#991b1b;',
    PROGRAMADOR: 'background:#ede9fe;color:#6d28d9;',
    JEFE_OPERACION: 'background:#fef3c7;color:#92400e;'
  };
  return {
    label: ROLE_META[normalized].label,
    style: styles[normalized] || styles.AUXILIAR
  };
}

function _umRenderCards() {
  const container = document.getElementById('um-cards-container');
  if (!container) {
    if (_unsubUsuarios) { _unsubUsuarios(); _unsubUsuarios = null; }
    return;
  }
  _umRenderPlazaChips();
  const list = _umGetFilteredUsers();
  _umRenderWorkspaceInsights(list);

  if (list.length === 0) {
    container.innerHTML = `
      <div class="um-loading um-loading-empty">
        <span class="material-icons">person_search</span>
        <strong>No encontramos usuarios con ese criterio</strong>
        <small>Ajusta el buscador o cambia el filtro de plaza para recuperar resultados.</small>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(u => {
    const badge = _umRoleBadge(u.rol);
    const active = u.id === _umSelectedId ? ' active' : '';
    const plazaLabel = escapeHtml(u.plazaAsignada || 'Sin plaza');
    const statusLabel = escapeHtml((u.status || 'ACTIVO').toUpperCase());
    const multiPlazas = Array.isArray(u.plazasPermitidas) ? u.plazasPermitidas.filter(Boolean) : [];
    return `<button type="button" class="um-card${active}" onclick="umSeleccionar('${u.id}')" aria-pressed="${active ? 'true' : 'false'}">
          <div class="um-avatar" style="${_umAvatarStyle(u.nombre)}">${_umInitials(u.nombre)}</div>
          <div class="um-card-info">
            <div class="um-card-head">
              <div class="um-card-copy">
                <div class="um-card-name" title="${escapeHtml(u.nombre)}">${u.nombre}</div>
                <div class="um-card-email" title="${escapeHtml(u.email || '(usuario heredado)')}">${u.email || '(usuario heredado)'}</div>
              </div>
              <div class="um-card-badges">
                <span class="um-role-badge" style="${badge.style}">${badge.label}</span>
                ${multiPlazas.length > 0 ? `<span class="um-role-badge um-role-badge-muted">+${escapeHtml(String(multiPlazas.length))} plazas</span>` : ''}
              </div>
            </div>
            <div class="um-card-meta">
              <span><span class="material-icons">apartment</span>${plazaLabel}</span>
              <span class="${statusLabel === 'ACTIVO' ? 'success' : ''}"><span class="material-icons">verified</span>${statusLabel}</span>
            </div>
          </div>
        </button>`;
  }).join('');
}

function umFiltrar() { _umRenderCards(); }

function umSeleccionar(id) {
  _umSelectedId = id;
  _umRenderCards();
  const user = _umUsers.find(u => u.id === id);
  if (user) _umRenderEditForm(user);
}

function _umRenderEditForm(user) {
  const roleBadge = _umRoleBadge(user.rol);
  const canEdit = canManageTargetRole(user.rol);
  const plazasPermitidas = Array.isArray(user.plazasPermitidas) ? user.plazasPermitidas.filter(Boolean) : [];
  const accessMeta = ROLE_META[_sanitizeRole(user.rol) || 'AUXILIAR'] || {};
  const contextCards = [
    ['Cobertura', plazasPermitidas.length > 0 ? `Multi-plaza (${plazasPermitidas.length})` : (user.plazaAsignada || 'Sin plaza base')],
    ['Nivel', accessMeta.fullAccess ? 'Global' : (accessMeta.isAdmin ? 'Administrativo' : 'Operativo')],
    ['Cuenta', user.email ? 'Cuenta activa' : 'Perfil heredado']
  ];

  const roleLockedMsg = canEdit ? '' : `
        <div style="margin:14px 0;padding:12px 14px;border-radius:12px;background:#fff7ed;color:#9a3412;font-weight:700;font-size:12px;">
          Tu rol actual no puede modificar a ${roleBadge.label}.
        </div>`;

  // Helper: campo bloqueado con lápiz para habilitar
  const lockBtn = (fieldId) => canEdit
    ? `<button type="button" class="um-edit-lock-btn" onclick="_umToggleField('${fieldId}')" title="Editar campo">
             <span class="material-icons" style="font-size:15px;">edit</span>
           </button>`
    : '';

  document.getElementById('um-placeholder').style.display = 'none';
  const container = document.getElementById('um-form-container');
  container.style.display = 'block';
  container.innerHTML = `<div class="um-form-card">
        <div class="um-profile-hero">
          <div class="um-form-avatar" style="${_umAvatarStyle(user.nombre)}">${_umInitials(user.nombre)}</div>
          <div class="um-profile-hero-copy">
            <div class="um-form-title">${escapeHtml(user.nombre)}</div>
            <div class="um-form-subtitle">${escapeHtml(user.email || 'Usuario heredado')}</div>
            <div class="um-profile-tags">
              <span class="um-info-pill">${escapeHtml(roleBadge.label)}</span>
              <span class="um-info-pill">${escapeHtml(user.plazaAsignada || 'Sin plaza')}</span>
              ${plazasPermitidas.length > 0 ? `<span class="um-info-pill neutral">+${escapeHtml(String(plazasPermitidas.length))} plazas extra</span>` : ''}
            </div>
          </div>
        </div>

        <div class="um-context-grid">
          ${contextCards.map(([label, value]) => `
            <div class="um-context-tile">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `).join('')}
        </div>

        <div class="um-form-grid2">
          <div class="um-info-panel">
            <div class="um-form-section">Identidad</div>
            <div class="um-form-field">
              <div class="um-field-label-row">
                <label>Nombre completo</label>
                ${lockBtn('um-edit-nombre')}
              </div>
              <input type="text" id="um-edit-nombre" value="${escapeHtml(user.nombre)}" placeholder="Nombre completo" disabled>
            </div>

            <div class="um-form-field">
              <label>Correo electrónico</label>
              <input type="email" id="um-edit-email" value="${escapeHtml(user.email || '')}" disabled
                title="Para cambiar el email usa Firebase Console">
            </div>

            <div class="um-form-field">
              <div class="um-field-label-row">
                <label>Teléfono (opcional)</label>
                ${lockBtn('um-edit-telefono')}
              </div>
              <input type="tel" id="um-edit-telefono" value="${escapeHtml(user.telefono || '')}" placeholder="Ej. 6441234567" disabled>
            </div>
          </div>

          <div class="um-info-panel">
            <div class="um-form-section" style="display:flex;align-items:center;justify-content:space-between;">
              Rol y alcance
              ${canEdit ? `<button type="button" class="um-edit-lock-btn" onclick="_umToggleRolSection()" title="Editar rol">
            <span class="material-icons" style="font-size:15px;">edit</span>
          </button>` : ''}
            </div>

            <div class="um-form-field">
              <label>Rol</label>
              <select id="um-edit-role" onchange="_syncRoleScope('um-edit')" disabled>
                ${_roleOptionsHtml(user.rol)}
              </select>
            </div>

            <div class="um-form-field" id="um-edit-plaza-row" style="${_roleNeedsPlaza(user.rol) ? '' : 'display:none;'}">
              <div class="um-field-label-row">
                <label>Plaza base</label>
                ${canEdit ? `<button type="button" class="um-edit-lock-btn" onclick="_umToggleField('um-edit-plaza')" title="Cambiar plaza">
              <span class="material-icons" style="font-size:15px;">edit</span>
            </button>` : ''}
              </div>
              ${_plazaSelectHtml('um-edit-plaza', user.plazaAsignada || '', 'disabled')}
            </div>

            <div class="um-form-field" id="um-edit-plazas-multi-row" style="${_roleNeedsMultiplePlazas(user.rol) ? '' : 'display:none;'}">
              <label>Plazas permitidas <span style="font-size:10px;color:#64748b;font-weight:600;">(puede ver estos mapas)</span></label>
              ${_plazasMultiHtml('um-edit-plazas-permitidas', user.plazasPermitidas || [])}
            </div>
          </div>
        </div>

        <div class="um-info-panel">
          <div class="um-form-section">Permisos individuales</div>
          <div class="um-form-field">
            <label>Overrides del usuario</label>
            <div class="um-permission-intro">
              ${_permissionSummaryText(user.permissionOverrides || {})}. Usa esto para bloquear o conceder permisos específicos sin cambiar el rol.
            </div>
            ${_permissionOverridesEditorHtml('um-edit-permission-overrides', user.permissionOverrides || {}, !canEdit)}
          </div>
        </div>

        ${roleLockedMsg}

        <div class="um-divider"></div>
        <div class="um-actions">
          <button class="um-btn-save" id="um-btn-guardar" onclick="umGuardarCambios('${user.id}')" ${canEdit ? '' : 'disabled'}>
            <span class="material-icons" style="font-size:17px;">save</span> GUARDAR CAMBIOS
          </button>
          ${user.email ? `<button class="um-btn-secondary" onclick="umResetPassword('${escapeHtml(user.email)}')" ${canEdit ? '' : 'disabled'}>
            <span class="material-icons" style="font-size:17px;">lock_reset</span> Restablecer contraseña
          </button>` : ''}
          <button class="um-btn-danger" onclick="umEliminar('${user.id}', '${user.nombre.replace(/'/g, "\\'")}')" ${canEdit ? '' : 'disabled'}>
            <span class="material-icons" style="font-size:17px;">person_remove</span> Eliminar usuario
          </button>
        </div>
      </div>`;
  _syncRoleScope('um-edit');
}

// Alterna disabled/enabled en un campo de edición de usuario
function _umToggleField(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  el.disabled = !el.disabled;
  if (!el.disabled) { el.focus(); el.select?.(); }
}

// Desbloquea el select de rol y el de plaza
function _umToggleRolSection() {
  const roleEl = document.getElementById('um-edit-role');
  const plazaEl = document.getElementById('um-edit-plaza');
  if (!roleEl) return;
  const nowEditing = roleEl.disabled;
  roleEl.disabled = !nowEditing;
  if (plazaEl) plazaEl.disabled = !nowEditing;
}

async function umGuardarCambios(docId) {
  if (!canManageUsers()) return showToast('No tienes permisos para editar usuarios.', 'error');
  const targetUser = _umUsers.find(u => u.id === docId);
  if (!targetUser) return showToast('Usuario no encontrado.', 'error');

  const nombre = (document.getElementById('um-edit-nombre').value || '').trim().toUpperCase();
  const telefono = (document.getElementById('um-edit-telefono').value || '').trim();
  const rolSeleccionado = _sanitizeRole(document.getElementById('um-edit-role').value) || 'AUXILIAR';
  const rol = _resolveStoredRoleForEmail(targetUser.email, rolSeleccionado);
  const plazaAsignada = _roleNeedsPlaza(rol)
    ? _normalizePlaza(document.getElementById('um-edit-plaza')?.value || '')
    : '';
  const plazasPermitidas = _roleNeedsMultiplePlazas(rol)
    ? _getSelectedPlazas('um-edit-plazas-permitidas')
    : [];
  const permissionOverrides = _readPermissionOverrides('um-edit-permission-overrides');
  const meta = ROLE_META[rol];

  if (!nombre) return showToast('El nombre es obligatorio', 'error');
  if (!canManageTargetRole(targetUser.rol) || !canAssignRole(rol)) {
    return showToast('Tu rol no puede modificar ese nivel de acceso.', 'error');
  }

  // Confirmación si el rol cambió
  const rolAnterior = targetUser.rol || 'AUXILIAR';
  if (rolAnterior !== rol) {
    const ok = await mexConfirm(
      'Cambio de Rol',
      `¿Confirmas cambiar el rol de ${targetUser.nombre}?\n\n${ROLE_META[rolAnterior].label}  →  ${meta.label}\n\nEste cambio se aplicará de inmediato.`,
      'warning'
    );
    if (!ok) return;
  }

  const btn = document.getElementById('um-btn-guardar');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons spinner" style="font-size:17px;">sync</span> Guardando...';

  try {
    const cambios = [];
    if ((targetUser.nombre || '') !== nombre) cambios.push(`Nombre: ${targetUser.nombre || 'N/D'} → ${nombre}`);
    if ((targetUser.telefono || '') !== telefono) cambios.push(`Teléfono: ${targetUser.telefono || 'N/D'} → ${telefono || 'N/D'}`);
    if (rolAnterior !== rol) cambios.push(`Rol: ${ROLE_META[rolAnterior].label} → ${meta.label}`);
    if ((targetUser.plazaAsignada || '') !== plazaAsignada) cambios.push(`Plaza: ${targetUser.plazaAsignada || 'SIN PLAZA'} → ${plazaAsignada || 'SIN PLAZA'}`);
    if (_roleNeedsMultiplePlazas(rol)) cambios.push(`Plazas permitidas: [${plazasPermitidas.join(', ')}]`);
    if (JSON.stringify(_normalizePermissionOverrides(targetUser.permissionOverrides || {})) !== JSON.stringify(permissionOverrides)) {
      cambios.push(`Overrides: ${_permissionSummaryText(permissionOverrides)}`);
    }

    const updateData = {
      nombre,
      telefono,
      email: targetUser.email,
      rol,
      plazaAsignada,
      isAdmin: meta.isAdmin,
      isGlobal: meta.fullAccess,
      permissionOverrides
    };
    if (Object.keys(permissionOverrides).length === 0) {
      updateData.permissionOverrides = firebase.firestore.FieldValue.delete();
    }
    if (_roleNeedsMultiplePlazas(rol)) {
      updateData.plazasPermitidas = plazasPermitidas;
    } else {
      // Borrar campos huérfanos de roles anteriores que ya no aplican
      updateData.plazasPermitidas = firebase.firestore.FieldValue.delete();
    }

    await db.collection(COL.USERS).doc(docId).update(updateData);

    await registrarEventoGestion('USUARIO_EDITADO', `Actualizó al usuario ${nombre}`, {
      entidad: 'USUARIOS', referencia: docId,
      objetivo: targetUser.email || targetUser.nombre || docId,
      rolObjetivo: rol, plazaObjetivo: plazaAsignada || '',
      detalles: cambios.join(' | ') || 'Sin cambios visibles.',
      resultado: 'EXITO'
    });

    // Si el rol cambió, forzar recarga del usuario afectado via flag en Firestore
    if (rolAnterior !== rol) {
      db.collection(COL.USERS).doc(docId).update({ _reloadRequired: true }).catch(() => { });
    }

    showToast('Usuario actualizado', 'success');
  } catch (e) {
    console.error(e);
    showToast('Error: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons" style="font-size:17px;">save</span> GUARDAR CAMBIOS';
  }
}

async function umResetPassword(email) {
  const ok = await mexConfirm(
    'Restablecer contraseña',
    `Se enviará un correo de restablecimiento a:\n${email}`,
    'warning'
  );
  if (!ok) return;
  try {
    await firebase.auth().sendPasswordResetEmail(email);
    await registrarEventoGestion('PASSWORD_RESET_ENVIADO', `Envió restablecimiento de contraseña a ${email}`, {
      entidad: 'USUARIOS',
      referencia: email,
      objetivo: email,
      resultado: 'EXITO'
    });
    showToast(`Correo enviado a ${email}`, 'success');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function umEliminar(docId, nombre) {
  if (!canManageUsers()) return showToast('No tienes permisos para eliminar usuarios.', 'error');
  const targetUser = _umUsers.find(u => u.id === docId);
  if (!targetUser || !canManageTargetRole(targetUser.rol)) {
    return showToast('Tu rol no puede eliminar ese usuario.', 'error');
  }
  const ok = await mexConfirm(
    'Eliminar usuario',
    `¿Eliminar a ${nombre}?\nEsta acción le quitará el acceso permanentemente.`,
    'error'
  );
  if (!ok) return;
  try {
    await db.collection(COL.USERS).doc(docId).delete();
    await registrarEventoGestion('USUARIO_ELIMINADO', `Eliminó al usuario ${nombre}`, {
      entidad: 'USUARIOS',
      referencia: docId,
      objetivo: targetUser.email || nombre,
      rolObjetivo: targetUser.rol || 'AUXILIAR',
      plazaObjetivo: targetUser.plazaAsignada || '',
      resultado: 'EXITO'
    });
    showToast('Usuario eliminado', 'success');
    _umSelectedId = null;
    document.getElementById('um-form-container').style.display = 'none';
    document.getElementById('um-placeholder').style.display = 'block';
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

function umNuevoUsuario() {
  if (!canManageUsers()) {
    showToast('Tu rol no puede crear usuarios.', 'error');
    return;
  }
  _umSelectedId = null;
  _umRenderCards();
  document.getElementById('um-placeholder').style.display = 'none';
  const container = document.getElementById('um-form-container');
  container.style.display = 'block';
  container.innerHTML = `<div class="um-form-card">
        <div class="um-profile-hero">
          <div class="um-form-avatar" style="background:var(--mex-accent);color:white;">
            <span class="material-icons" style="font-size:28px;">person_add</span>
          </div>
          <div class="um-profile-hero-copy">
            <div class="um-form-title">Nuevo usuario</div>
            <div class="um-form-subtitle">Prepara la cuenta, define su alcance y déjala lista para operar desde la plaza correcta.</div>
            <div class="um-profile-tags">
              <span class="um-info-pill">Alta controlada</span>
              <span class="um-info-pill">${escapeHtml((typeof _miPlaza === 'function' ? _miPlaza() : '') || 'Sin plaza activa')}</span>
            </div>
          </div>
        </div>

        <div class="um-form-grid2">
          <div class="um-info-panel">
            <div class="um-form-section">Identidad</div>
            <div class="um-form-field">
              <label>Nombre completo <span style="color:#ef4444;">*</span></label>
              <input type="text" id="um-new-nombre" placeholder="Ej. Juan Pérez" oninput="_umValidarNuevo()">
            </div>
            <div class="um-form-field">
              <label>Correo electrónico <span style="color:#ef4444;">*</span></label>
              <input type="email" id="um-new-email" placeholder="correo@ejemplo.com" oninput="_umValidarNuevo()">
            </div>
            <div class="um-form-field">
              <label>Contraseña temporal <span style="color:#ef4444;">*</span></label>
              <input type="password" id="um-new-pass" placeholder="Mínimo 6 caracteres" autocomplete="new-password" oninput="_umValidarNuevo()">
            </div>
            <div class="um-form-field">
              <label>Teléfono (opcional)</label>
              <input type="tel" id="um-new-tel" placeholder="Ej. 6441234567">
            </div>
          </div>

          <div class="um-info-panel">
            <div class="um-form-section">Rol y alcance</div>
            <div class="um-form-field">
              <label>Rol <span style="color:#ef4444;">*</span></label>
              <select id="um-new-role" onchange="_syncRoleScope('um-new'); _umValidarNuevo();">
                ${_roleOptionsHtml('AUXILIAR')}
              </select>
            </div>
            <div class="um-form-field" id="um-new-plaza-row">
              <label>Plaza base <span style="color:#ef4444;">*</span></label>
              ${_plazaSelectHtml('um-new-plaza', '', 'onchange="_umValidarNuevo()"')}
            </div>

            <div class="um-form-field" id="um-new-plazas-multi-row" style="display:none;">
              <label>Plazas permitidas <span style="font-size:10px;color:#64748b;font-weight:600;">(puede ver estos mapas)</span></label>
              ${_plazasMultiHtml('um-new-plazas-permitidas', [])}
            </div>

            <div class="um-permission-intro">
              El alcance se define desde el rol. Si el usuario necesita excepciones puntuales, podrás asignarlas después desde su editor contextual.
            </div>
          </div>
        </div>

        <div class="um-info-panel">
          <div class="um-form-section">Validación</div>
          <div id="um-new-hints" class="um-permission-intro">
            Completa los campos requeridos (<span style="color:#ef4444;">*</span>) antes de crear la cuenta.
          </div>
        </div>

        <div class="um-divider"></div>
        <div class="um-actions">
          <button class="um-btn-save" id="um-btn-crear" onclick="umCrearUsuario()" disabled style="opacity:.5;cursor:not-allowed;">
            <span class="material-icons" style="font-size:17px;">person_add</span> CREAR USUARIO
          </button>
        </div>
      </div>`;
  _syncRoleScope('um-new');
  _umValidarNuevo();
}

// Valida campos del form nuevo usuario y habilita/deshabilita el botón
function _umValidarNuevo() {
  const nombre = (document.getElementById('um-new-nombre')?.value || '').trim();
  const email = (document.getElementById('um-new-email')?.value || '').trim();
  const pass = (document.getElementById('um-new-pass')?.value || '').trim();
  const rol = document.getElementById('um-new-role')?.value || '';
  const needsPlaza = _roleNeedsPlaza(rol);
  const plaza = needsPlaza ? (document.getElementById('um-new-plaza')?.value || '').trim() : 'OK';

  const btn = document.getElementById('um-btn-crear');
  const hint = document.getElementById('um-new-hints');
  if (!btn) return;

  const missing = [];
  if (!nombre) missing.push('nombre');
  if (!email || !email.includes('@')) missing.push('correo válido');
  if (pass.length < 6) missing.push('contraseña (mín. 6)');
  if (!plaza) missing.push('plaza');

  const ok = missing.length === 0;
  btn.disabled = !ok;
  btn.style.opacity = ok ? '1' : '.5';
  btn.style.cursor = ok ? 'pointer' : 'not-allowed';
  if (hint) hint.innerHTML = ok
    ? '<span style="color:#10b981;">✓ Listo para crear</span>'
    : `Falta: ${missing.join(', ')}`;
}

async function umCrearUsuario() {
  if (!canManageUsers()) return showToast('No tienes permisos para crear usuarios.', 'error');
  const nombre = (document.getElementById('um-new-nombre').value || '').trim().toUpperCase();
  const email = (document.getElementById('um-new-email').value || '').trim().toLowerCase();
  const pass = (document.getElementById('um-new-pass').value || '').trim();
  const telefono = (document.getElementById('um-new-tel').value || '').trim();
  const rolSeleccionado = _sanitizeRole(document.getElementById('um-new-role').value) || 'AUXILIAR';
  const rol = _resolveStoredRoleForEmail(email, rolSeleccionado);
  const plazaAsignada = _roleNeedsPlaza(rol)
    ? _normalizePlaza(document.getElementById('um-new-plaza').value)
    : '';
  const plazasPermitidas = _roleNeedsMultiplePlazas(rol)
    ? _getSelectedPlazas('um-new-plazas-permitidas')
    : [];

  if (!nombre) return showToast('El nombre es obligatorio', 'error');
  if (!email || !email.includes('@')) return showToast('Correo inválido', 'error');
  if (pass.length < 6) return showToast('La contraseña debe tener mínimo 6 caracteres', 'error');
  if (!canAssignRole(rol)) {
    return showToast('Tu rol no puede crear ese nivel de acceso.', 'error');
  }

  const btn = document.getElementById('um-btn-crear');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons spinner" style="font-size:17px;">sync</span> Creando...';

  const res = await api.guardarNuevoUsuarioAuth(nombre, email, pass, rol, telefono, plazaAsignada, plazasPermitidas);
  if (res === 'EXITO') {
    await registrarEventoGestion('USUARIO_CREADO', `Creó al usuario ${nombre}`, {
      entidad: 'USUARIOS',
      referencia: email,
      objetivo: email,
      rolObjetivo: rol,
      plazaObjetivo: plazaAsignada || '',
      resultado: 'EXITO'
    });
    showToast('Usuario creado exitosamente', 'success');
    umNuevoUsuario(); // limpiar form
    // onSnapshot actualizará la lista
  } else {
    showToast(res, 'error');
    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons" style="font-size:17px;">person_add</span> CREAR USUARIO';
  }
}


let _logsData = [];

function abrirLogs() {
  toggleAdminSidebar(false);
  document.getElementById('logs-modal').classList.add('active');

  const tbody = document.getElementById('logs-table-body');
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px;"><span class="material-icons spinner" style="vertical-align:middle;">sync</span> Extrayendo historial de la base de datos...</td></tr>`;
  document.getElementById('logsContador').textContent = '';

  api.obtenerHistorialLogs().then(logs => {
    _logsData = logs;

    // Rellenar selector de usuarios con los que aparecen en los datos
    const usuarios = [...new Set(logs.map(l => l.usuario).filter(Boolean))].sort();
    const selUsuario = document.getElementById('logsUsuario');
    selUsuario.innerHTML = `<option value="">Todos los usuarios</option>` +
      usuarios.map(u => `<option value="${u}">${u}</option>`).join('');

    _renderLogsTabla();
  }).catch(e => {
    console.error(e);
    document.getElementById('logs-table-body').innerHTML =
      `<tr><td colspan="6" style="text-align:center;padding:20px;color:#ef4444;font-weight:800;">Error al cargar el historial.</td></tr>`;
  });
}

function _renderLogsTabla() {
  const busq = (document.getElementById('logsBuscador').value || '').toLowerCase().trim();
  const fecha = document.getElementById('logsFecha').value;      // YYYY-MM-DD o ""
  const tipo = document.getElementById('logsTipo').value;
  const usuario = document.getElementById('logsUsuario').value;

  let filtered = _logsData;

  if (busq) {
    filtered = filtered.filter(l =>
      (l.mva || '').toLowerCase().includes(busq) ||
      (l.usuario || '').toLowerCase().includes(busq) ||
      (l.detalles || '').toLowerCase().includes(busq) ||
      (l.tipo || '').toLowerCase().includes(busq)
    );
  }

  if (fecha) {
    filtered = filtered.filter(l => {
      if (!l.timestamp) return false;
      const d = new Date(l.timestamp * 1000);
      const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return dStr === fecha;
    });
  }

  if (tipo) filtered = filtered.filter(l => l.tipo === tipo);
  if (usuario) filtered = filtered.filter(l => l.usuario === usuario);

  const tbody = document.getElementById('logs-table-body');
  document.getElementById('logsContador').textContent =
    `${filtered.length} de ${_logsData.length} registros`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#64748b; font-weight:800;">
      No hay registros que coincidan con los filtros.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(l => `
    <tr>
      <td style="font-size:11px; color:#64748b; font-weight:800;">${l.fecha}</td>
      <td><span class="badge ${l.tipo === 'MOVE' ? 'st-MOVE' : (l.tipo === 'SWAP' ? 'st-SWAP' : 'st-DELETE')}">${l.tipo}</span></td>
      <td style="font-weight:900; color:var(--mex-blue); font-size:14px;">${l.mva}</td>
      <td style="font-size:12px; font-weight:700;">${l.detalles}</td>
      <td style="font-size:11px; font-weight:800;">${_logExactLocationHtml(l)}</td>
      <td style="font-size:11px; font-weight:800;">${l.usuario}</td>
    </tr>
  `).join('');
}

function _limpiarFiltrosLogs() {
  document.getElementById('logsBuscador').value = '';
  document.getElementById('logsFecha').value = '';
  document.getElementById('logsTipo').value = '';
  document.getElementById('logsUsuario').value = '';
  _renderLogsTabla();
}

function _bindEditorInspectorDrag() {
  const card = document.querySelector('.editor-inspector-card');
  const header = card?.querySelector('.editor-card-header');
  if (!card || !header || card.dataset.dragBound === '1') return;
  card.dataset.dragBound = '1';
  card.style.touchAction = 'none';

  let state = null;

  const stopDrag = () => {
    state = null;
    document.body.classList.remove('editor-inspector-dragging');
  };

  header.style.cursor = 'move';
  header.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = card.getBoundingClientRect();
    state = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top
    };
    document.body.classList.add('editor-inspector-dragging');
    card.setPointerCapture?.(event.pointerId);
  });

  window.addEventListener('pointermove', event => {
    if (!state || event.pointerId !== state.pointerId) return;
    event.preventDefault();
    const maxLeft = window.innerWidth - card.offsetWidth - 12;
    const maxTop = window.innerHeight - card.offsetHeight - 12;
    const nextLeft = Math.min(maxLeft, Math.max(12, state.left + (event.clientX - state.startX)));
    const nextTop = Math.min(maxTop, Math.max(12, state.top + (event.clientY - state.startY)));
    card.style.left = `${nextLeft}px`;
    card.style.top = `${nextTop}px`;
    card.style.right = 'auto';
    card.style.bottom = 'auto';
  });

  window.addEventListener('pointerup', stopDrag);
  window.addEventListener('pointercancel', stopDrag);
}


// SISTEMA DE NOTAS...

let notasGlobales = [];
let idFilaPendiente = null;
let _unsubNotasAdmin = null;
let archivosNuevaNota = [];
let incidenciaDraftCode = `INC-${String(Date.now()).slice(-6).padStart(6, '0')}`;
const notasExpandState = new Set();
const INC_PRIORITY_META = Object.freeze({
  CRITICA: { label: 'Critica', className: 'is-critica', icon: 'priority_high' },
  ALTA: { label: 'Alta', className: 'is-alta', icon: 'notification_important' },
  MEDIA: { label: 'Media', className: 'is-media', icon: 'info' },
  BAJA: { label: 'Baja', className: 'is-baja', icon: 'check_circle' }
});

function generarCodigoIncidencia(timestamp = Date.now()) {
  return `INC-${String(timestamp).slice(-6).padStart(6, '0')}`;
}

function metaPrioridadIncidencia(prioridad = 'MEDIA') {
  return INC_PRIORITY_META[String(prioridad || '').toUpperCase()] || INC_PRIORITY_META.MEDIA;
}

function metaEstadoIncidencia(estado = 'PENDIENTE') {
  const normalized = String(estado || '').toUpperCase();
  return normalized === 'RESUELTA'
    ? { label: 'Resuelta', className: 'is-resuelta' }
    : { label: 'Pendiente', className: 'is-pendiente' };
}

function formatearTamanoArchivo(bytes = 0) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 KB';
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${size} B`;
}

function esAdjuntoImagenIncidencia(item = {}) {
  const mime = String(item.mimeType || '').toLowerCase();
  const name = String(item.fileName || '').toLowerCase();
  return mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name);
}

function iconoAdjuntoIncidencia(item = {}) {
  const mime = String(item.mimeType || '').toLowerCase();
  const name = String(item.fileName || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name)) return 'image';
  if (mime.includes('pdf') || /\.pdf$/.test(name)) return 'picture_as_pdf';
  if (mime.includes('csv') || /\.csv$/.test(name)) return 'table_chart';
  if (mime.includes('text') || /\.txt$/.test(name) || /\.log$/.test(name)) return 'description';
  return 'attach_file';
}

function obtenerResumenNota(texto = '', limite = 320) {
  const limpio = String(texto || '').replace(/\s+/g, ' ').trim();
  if (limpio.length <= limite) return limpio;
  return `${limpio.slice(0, limite).trim()}...`;
}

function renderizarTextoNotaHtml(texto = '') {
  const lineas = String(texto || '').replace(/\r/g, '').split('\n');
  const salida = [];
  let listaActiva = null;

  const aplicarInline = valor => escapeHtml(valor)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*]+)\*(?=($|[\s).,!?:;]))/g, '$1<em>$2</em>');

  const cerrarLista = () => {
    if (!listaActiva) return;
    salida.push(listaActiva === 'ul' ? '</ul>' : '</ol>');
    listaActiva = null;
  };

  lineas.forEach(linea => {
    const actual = linea.trim();
    if (!actual) {
      cerrarLista();
      return;
    }

    if (/^[-*]\s+/.test(actual)) {
      if (listaActiva !== 'ul') {
        cerrarLista();
        salida.push('<ul>');
        listaActiva = 'ul';
      }
      salida.push(`<li>${aplicarInline(actual.replace(/^[-*]\s+/, ''))}</li>`);
      return;
    }

    if (/^\d+\.\s+/.test(actual)) {
      if (listaActiva !== 'ol') {
        cerrarLista();
        salida.push('<ol>');
        listaActiva = 'ol';
      }
      salida.push(`<li>${aplicarInline(actual.replace(/^\d+\.\s+/, ''))}</li>`);
      return;
    }

    cerrarLista();
    salida.push(`<p>${aplicarInline(actual)}</p>`);
  });

  cerrarLista();
  return salida.join('') || '<p>Sin descripcion.</p>';
}

function renderizarAdjuntosIncidencia(adjuntos = []) {
  if (!Array.isArray(adjuntos) || !adjuntos.length) return '';
  return `
    <div class="nota-attachments">
      ${adjuntos.map(item => {
    const url = escapeHtml(item.url || '#');
    const fileName = escapeHtml(item.fileName || 'Adjunto');
    const meta = escapeHtml(`${formatearTamanoArchivo(item.size)}${item.mimeType ? ` · ${item.mimeType}` : ''}`);
    if (esAdjuntoImagenIncidencia(item)) {
      return `<a class="nota-attachment-image" href="${url}" target="_blank" rel="noopener noreferrer" title="${fileName}"><img src="${url}" alt="${fileName}"></a>`;
    }
    return `
          <a class="nota-attachment-file" href="${url}" target="_blank" rel="noopener noreferrer" title="${fileName}">
            <span class="material-icons">${iconoAdjuntoIncidencia(item)}</span>
            <span class="nota-attachment-copy">
              <strong>${fileName}</strong>
              <span>${meta}</span>
            </span>
          </a>
        `;
  }).join('')}
    </div>
  `;
}

function actualizarResumenIncidencias() {
  const total = notasGlobales.length;
  const pendientes = notasGlobales.filter(n => String(n.estado || '').toUpperCase() === 'PENDIENTE').length;
  const resueltas = notasGlobales.filter(n => String(n.estado || '').toUpperCase() === 'RESUELTA').length;
  const criticas = notasGlobales.filter(n => String(n.prioridad || '').toUpperCase() === 'CRITICA').length;
  const adjuntos = notasGlobales.reduce((acc, n) => acc + ((Array.isArray(n.adjuntos) ? n.adjuntos.length : 0)), 0);

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  };

  setText('incStatTotal', total);
  setText('incStatPendientes', pendientes);
  setText('incStatCriticas', criticas);
  setText('incCountPendientes', pendientes);
  setText('incCountResueltas', resueltas);
  setText('incCountAdjuntos', adjuntos);
}

function actualizarMetaNuevaNota() {
  const profile = window.CURRENT_USER_PROFILE || {};
  const plaza = profile.plazaAsignada || profile.plaza || 'GLOBAL';
  const ahora = new Date().toISOString();
  const timestampLabel = formatearFechaDocumento(ahora);
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  };

  setText('incMetaTimestamp', timestampLabel);
  setText('incMetaUbicacion', plaza);
  setText('incMetaId', incidenciaDraftCode);
}

function actualizarPreviewNuevaNota() {
  actualizarMetaNuevaNota();
  const prioridad = document.getElementById('nuevaNotaPrioridad')?.value || 'MEDIA';
  const titulo = document.getElementById('nuevaNotaTitulo')?.value.trim() || 'Nueva incidencia';
  const descripcion = document.getElementById('nuevaNotaTxt')?.value.trim()
    || 'Documenta el evento con precision tecnica para que el historial operativo conserve contexto, impacto y evidencia.';
  const autor = document.getElementById('autorNuevaNota')?.value || USER_NAME || 'Sistema';
  const meta = metaPrioridadIncidencia(prioridad);

  const badge = document.getElementById('incPreviewPrioridad');
  const stamp = document.getElementById('incPreviewStamp');
  const title = document.getElementById('incPreviewTitulo');
  const body = document.getElementById('incPreviewBody');
  const authorEl = document.getElementById('incPreviewAutor');
  const stateEl = document.getElementById('incPreviewEstado');

  if (badge) {
    badge.className = `inc-preview-priority ${meta.className}`;
    badge.innerHTML = `<span class="material-icons" style="font-size:15px;">${meta.icon}</span><span>${escapeHtml(meta.label)}</span>`;
  }
  if (stamp) stamp.innerText = `${archivosNuevaNota.length} adjunto${archivosNuevaNota.length === 1 ? '' : 's'}`;
  if (title) title.innerText = titulo;
  if (body) body.innerHTML = escapeHtml(obtenerResumenNota(descripcion, 280)).replace(/\n/g, '<br>');
  if (authorEl) authorEl.innerText = `Emitido por: ${autor}`;
  if (stateEl) stateEl.innerText = 'Pendiente';
}

function limpiarArchivosNuevaNota() {
  archivosNuevaNota.forEach(item => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  archivosNuevaNota = [];
}

function renderizarArchivosNuevaNota() {
  const contenedor = document.getElementById('incAdjuntosLista');
  if (!contenedor) return;

  if (!archivosNuevaNota.length) {
    contenedor.innerHTML = '';
    actualizarPreviewNuevaNota();
    return;
  }

  contenedor.innerHTML = archivosNuevaNota.map((item, index) => {
    const fileName = escapeHtml(item.file.name || 'Adjunto');
    const meta = escapeHtml(`${formatearTamanoArchivo(item.file.size)} · ${(item.file.type || 'archivo').toUpperCase()}`);
    const visual = item.previewUrl
      ? `<div class="inc-upload-thumb"><img src="${item.previewUrl}" alt="${fileName}"></div>`
      : `<div class="inc-upload-file-icon"><span class="material-icons">${iconoAdjuntoIncidencia({ fileName: item.file.name, mimeType: item.file.type })}</span></div>`;
    return `
      <div class="inc-upload-chip">
        ${visual}
        <div class="inc-upload-details">
          <div class="inc-upload-name">${fileName}</div>
          <div class="inc-upload-meta">${meta}</div>
        </div>
        <button class="inc-upload-remove" onclick="eliminarArchivoNuevaNota(${index})" title="Quitar adjunto">
          <span class="material-icons" style="font-size:18px;">close</span>
        </button>
      </div>
    `;
  }).join('');

  actualizarPreviewNuevaNota();
}

function manejarArchivosNuevaNota(filesLike) {
  const files = Array.from(filesLike || []);
  if (!files.length) return;

  const permitidos = /\.(pdf|png|jpe?g|webp|gif|txt|log|csv)$/i;
  const limiteBytes = 25 * 1024 * 1024;
  const existentes = new Set(archivosNuevaNota.map(item => `${item.file.name}-${item.file.size}-${item.file.lastModified}`));

  files.forEach(file => {
    const key = `${file.name}-${file.size}-${file.lastModified}`;
    if (existentes.has(key)) return;
    if (file.size > limiteBytes) {
      showToast(`"${file.name}" supera el maximo de 25MB`, 'warning');
      return;
    }
    if (!permitidos.test(file.name)) {
      showToast(`Formato no soportado: ${file.name}`, 'warning');
      return;
    }
    archivosNuevaNota.push({
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
    });
    existentes.add(key);
  });

  const input = document.getElementById('nuevaNotaArchivos');
  if (input) input.value = '';
  renderizarArchivosNuevaNota();
}

function eliminarArchivoNuevaNota(index) {
  const [item] = archivosNuevaNota.splice(index, 1);
  if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  renderizarArchivosNuevaNota();
}

function abrirSelectorArchivosNota() {
  document.getElementById('nuevaNotaArchivos')?.click();
}

function estadoDragNota(activo) {
  const zone = document.getElementById('incDropZone');
  if (!zone) return;
  zone.classList.toggle('dragover', !!activo);
}

function manejarDragNota(event) {
  event.preventDefault();
  estadoDragNota(true);
}

function soltarArchivosNota(event) {
  event.preventDefault();
  estadoDragNota(false);
  manejarArchivosNuevaNota(event.dataTransfer?.files || []);
}

function resetFormularioIncidencia() {
  incidenciaDraftCode = generarCodigoIncidencia();
  const titulo = document.getElementById('nuevaNotaTitulo');
  const descripcion = document.getElementById('nuevaNotaTxt');
  const prioridad = document.getElementById('nuevaNotaPrioridad');
  if (titulo) titulo.value = '';
  if (descripcion) descripcion.value = '';
  if (prioridad) prioridad.value = 'ALTA';
  limpiarArchivosNuevaNota();
  renderizarArchivosNuevaNota();
  actualizarPreviewNuevaNota();
}

async function aplicarFormatoIncidencia(tipo) {
  const area = document.getElementById('nuevaNotaTxt');
  if (!area) return;

  const start = area.selectionStart;
  const end = area.selectionEnd;
  const valor = area.value;
  const seleccionado = valor.slice(start, end) || 'texto';
  let reemplazo = seleccionado;
  let offsetStart = 0;
  let offsetEnd = 0;

  if (tipo === 'bold') {
    reemplazo = `**${seleccionado}**`;
    offsetStart = 2;
    offsetEnd = 2;
  } else if (tipo === 'italic') {
    reemplazo = `*${seleccionado}*`;
    offsetStart = 1;
    offsetEnd = 1;
  } else if (tipo === 'link') {
    const url = await mexPrompt(
      'Insertar enlace',
      'Ingresa la URL del enlace:',
      'https://',
      'url',
      'https://'
    );
    if (url === null || !url.trim()) return;
    const enlace = url.trim();
    reemplazo = `[${seleccionado}](${enlace})`;
    offsetStart = 1;
    offsetEnd = enlace.length + 3;
  } else if (tipo === 'ul') {
    reemplazo = seleccionado.split('\n').map(linea => `- ${linea}`).join('\n');
  } else if (tipo === 'ol') {
    reemplazo = seleccionado.split('\n').map((linea, index) => `${index + 1}. ${linea}`).join('\n');
  }

  area.value = `${valor.slice(0, start)}${reemplazo}${valor.slice(end)}`;
  area.focus();
  area.selectionStart = start + offsetStart;
  area.selectionEnd = start + reemplazo.length - offsetEnd;
  actualizarPreviewNuevaNota();
}

function abrirIncidencias() {
  toggleAdminSidebar(false);
  document.getElementById('incidencias-modal').classList.add('active');
  document.getElementById('autorNuevaNota').value = USER_NAME || 'Sistema';
  actualizarPreviewNuevaNota();
  if (!_unsubNotasAdmin && typeof api.suscribirNotasAdmin === 'function') {
    _unsubNotasAdmin = api.suscribirNotasAdmin(notas => {
      notasGlobales = notas || [];
      actualizarResumenIncidencias();
      filtrarListaNotas();
    }, _miPlaza());
  }
  cargarNotasIncidencias();
}

function cerrarIncidencias() {
  document.getElementById('incidencias-modal').classList.remove('active');
  if (_unsubNotasAdmin) {
    _unsubNotasAdmin();
    _unsubNotasAdmin = null;
  }
  notasExpandState.clear();
}

function switchIncTab(e, tabId) {
  const modal = document.getElementById('incidencias-modal');
  if (!modal) return;
  modal.querySelectorAll('.inc-tab, .inc-content').forEach(el => el.classList.remove('active'));
  const tab = e?.target?.closest?.('.inc-tab') || modal.querySelector(`[data-inc-tab="${tabId}"]`);
  if (tab) tab.classList.add('active');
  modal.querySelector(`#${tabId}`)?.classList.add('active');
  if (tabId === 'viewTab') cargarNotasIncidencias();
  if (tabId === 'addTab') actualizarPreviewNuevaNota();
}

function cargarNotasIncidencias() {
  const contenedor = document.getElementById('listaNotas');
  if (contenedor) {
    contenedor.innerHTML = `<div class="inc-empty-state"><span class="material-icons spinner">sync</span><div>Cargando registros...</div></div>`;
  }
  api.obtenerTodasLasNotas(_miPlaza()).then(notas => {
    notasGlobales = notas || [];
    actualizarResumenIncidencias();
    filtrarListaNotas();
  }).catch(e => console.error(e));
}

function obtenerPrioridadesSeleccionadas() {
  return new Set([
    ['incFilterCritica', 'CRITICA'],
    ['incFilterAlta', 'ALTA'],
    ['incFilterMedia', 'MEDIA'],
    ['incFilterBaja', 'BAJA']
  ].filter(([id]) => document.getElementById(id)?.checked).map(([, value]) => value));
}

function toggleExpandIncidencia(id) {
  const key = String(id);
  if (notasExpandState.has(key)) notasExpandState.delete(key);
  else notasExpandState.add(key);
  filtrarListaNotas();
}

function filtrarListaNotas() {
  const termino = (document.getElementById('buscadorNotas')?.value || '').toLowerCase();
  const estadoFiltro = document.getElementById('filtroEstado')?.value || 'TODAS';
  const prioridades = obtenerPrioridadesSeleccionadas();
  const contenedor = document.getElementById('listaNotas');
  if (!contenedor) return;

  const filtradas = notasGlobales.filter(n => {
    const textoStr = `${n.titulo || ''} ${n.nota || ''} ${n.autor || ''} ${n.codigo || ''} ${n.prioridad || ''}`.toLowerCase();
    const coincideTexto = textoStr.includes(termino);
    const coincideEstado = estadoFiltro === "TODAS" || String(n.estado || '').toUpperCase() === estadoFiltro;
    const coincidePrioridad = prioridades.has(String(n.prioridad || '').toUpperCase());
    return coincideTexto && coincideEstado && coincidePrioridad;
  });

  if (!filtradas.length) {
    contenedor.innerHTML = `
      <div class="inc-empty-state">
        <span class="material-icons">search_off</span>
        <div>No se encontraron incidencias con los filtros actuales.</div>
      </div>
    `;
    return;
  }

  contenedor.innerHTML = filtradas.map(n => {
    const puedeBorrar = (String(n.estado || '').toUpperCase() === 'PENDIENTE' && n.autor === USER_NAME);
    const prioridad = metaPrioridadIncidencia(n.prioridad);
    const estado = metaEstadoIncidencia(n.estado);
    const expandida = notasExpandState.has(String(n.id));
    const descripcion = String(n.nota || '').trim();
    const descripcionRender = expandida
      ? renderizarTextoNotaHtml(descripcion)
      : renderizarTextoNotaHtml(obtenerResumenNota(descripcion, 360));
    const puedeExpandir = descripcion.length > 360;
    const adjuntosHtml = renderizarAdjuntosIncidencia(Array.isArray(n.adjuntos) ? n.adjuntos : []);
    const idSeguro = `'${String(n.id).replace(/'/g, "\\'")}'`;

    return `
      <div class="nota-card" data-prioridad="${escapeHtml(String(n.prioridad || 'MEDIA').toUpperCase())}">
        ${puedeBorrar ? `<button class="btn-delete-inc" onclick="prepararEliminarIncidencia(${idSeguro})" title="Eliminar"><span class="material-icons">delete</span></button>` : ''}

        <div class="nota-top">
          <div class="nota-main">
            <div class="nota-icon"><span class="material-icons">${prioridad.icon}</span></div>
            <div class="nota-main-copy">
              <div class="nota-title-row">
                <h4 class="nota-title">${escapeHtml(n.titulo || 'Incidencia sin titulo')}</h4>
                <div class="nota-badges">
                  <span class="nota-priority-badge ${prioridad.className}">${escapeHtml(prioridad.label)}</span>
                  <span class="nota-state-badge ${estado.className}">${escapeHtml(estado.label)}</span>
                </div>
              </div>
              <div class="nota-meta">
                <strong>${escapeHtml(n.autor || 'Sistema')}</strong>
                <span class="nota-meta-separator"></span>
                <span>${escapeHtml(n.fecha || '')}</span>
                <span class="nota-meta-separator"></span>
                <span>${escapeHtml(n.codigo || generarCodigoIncidencia(n.timestamp))}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="nota-body">${descripcionRender}</div>
        ${adjuntosHtml}

        <div class="nota-footer">
          <div class="nota-footer-left">
            <span class="nota-chip">${escapeHtml(n.codigo || generarCodigoIncidencia(n.timestamp))}</span>
            <span class="nota-chip">${escapeHtml(prioridad.label)}</span>
            ${Array.isArray(n.adjuntos) && n.adjuntos.length ? `<span class="nota-chip">${n.adjuntos.length} adjunto${n.adjuntos.length === 1 ? '' : 's'}</span>` : ''}
          </div>
          <div class="nota-footer-right">
            ${puedeExpandir ? `<button class="btn-inline-inc" onclick="toggleExpandIncidencia(${idSeguro})"><span class="material-icons" style="font-size:16px;">${expandida ? 'unfold_less' : 'unfold_more'}</span>${expandida ? 'Contraer' : 'Ver detalle'}</button>` : ''}
          </div>
        </div>

        ${String(n.estado || '').toUpperCase() === 'PENDIENTE'
        ? `<button class="btn-res-inc" style="margin-top:18px;" onclick="abrirModalResolver(${idSeguro})">Marcar como resuelta</button>`
        : `<div class="nota-resolution">
            <div class="nota-resolution-head">
              <span>Resuelta por ${escapeHtml(n.quienResolvio || 'Sistema')}</span>
              <span>${escapeHtml(n.resueltaEn || '')}</span>
            </div>
            <div class="nota-resolution-body">${escapeHtml(n.solucion || 'Sin detalle de solucion.').replace(/\n/g, '<br>')}</div>
          </div>`
      }
      </div>
    `;
  }).join('');
}

async function guardarNuevaNota(event) {
  if (event?.preventDefault) event.preventDefault();
  const titulo = document.getElementById('nuevaNotaTitulo').value.trim();
  const nota = document.getElementById('nuevaNotaTxt').value.trim();
  const prioridad = document.getElementById('nuevaNotaPrioridad').value;
  const btn = document.getElementById('btnPublicarInc');
  const storageDisponible = typeof firebase !== 'undefined' && typeof firebase.storage === 'function';

  if (!titulo) return showToast("Escribe el titulo de la incidencia", "warning");
  if (!nota) return showToast("Escribe la descripción", "warning");
  if (archivosNuevaNota.length && !storageDisponible) {
    return showToast("Los adjuntos no están disponibles todavía. Recarga la app e intenta de nuevo.", "error");
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="material-icons spinner">sync</span> ENVIANDO...`;

  try {
    const res = await api.guardarNuevaNotaDirecto({
      titulo,
      descripcion: nota,
      prioridad,
      archivos: archivosNuevaNota.map(item => item.file),
      codigo: incidenciaDraftCode,
      autor: USER_NAME || 'Sistema',
      plaza: _miPlaza()
    }, USER_NAME);

    if (res !== 'OK') {
      throw new Error(typeof res === 'string' ? res : 'No se pudo publicar la nota.');
    }

    showToast("Nota publicada", "success");
    resetFormularioIncidencia();
    switchIncTab({ target: document.querySelector('[data-inc-tab="viewTab"]') }, 'viewTab');
  } catch (error) {
    console.error('Error publicando incidencia:', error);
    showToast(error?.message || "Error al publicar", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Publicar Nota</span><span class="material-icons" style="font-size:18px;">send</span>`;
  }
}

function abrirModalResolver(id) {
  idFilaPendiente = id;
  document.getElementById('authComentario').value = "";
  document.getElementById('modalAuthIncidencia').classList.add('active');
}

function ejecutarResolucion() {
  const comentario = document.getElementById('authComentario').value.trim();
  const btn = document.getElementById('btnConfirmarResInc');

  if (!comentario) return showToast("Describe cómo se solucionó.", "warning");

  btn.disabled = true;
  btn.innerHTML = `RESOLVIENDO...`;

  api.resolverNotaDirecto(idFilaPendiente, comentario, USER_NAME).then(res => {
    if (res === "OK") {
      showToast("Incidencia resuelta", "success");
      document.getElementById('modalAuthIncidencia').classList.remove('active');
      if (!_unsubNotasAdmin) cargarNotasIncidencias();
    } else { showToast("Error: " + res, "error"); }
    btn.disabled = false; btn.innerHTML = `CONFIRMAR`;
  }).catch(() => {
    showToast("Error de conexión", "error");
    btn.disabled = false; btn.innerHTML = `CONFIRMAR`;
  });
}

// Reutilizamos el CustomModal global de tu sistema para no inyectar código basura
function prepararEliminarIncidencia(id) {
  mostrarCustomModal(
    "Eliminar Incidencia",
    "¿Estás seguro de eliminar este registro? Esta acción no se puede deshacer.",
    "delete_forever", "#ef4444", "ELIMINAR", "#ef4444",
    () => { ejecutarEliminacionIncidencia(id); }
  );
}

function ejecutarEliminacionIncidencia(id) {
  showToast("Eliminando...", "success");
  api.eliminarNotaDirecto(id).then(res => {
    if (res === "OK") {
      showToast("Nota eliminada", "success");
      notasExpandState.delete(String(id));
      if (!_unsubNotasAdmin) cargarNotasIncidencias();
    } else { showToast("Error al eliminar", "error"); }
  }).catch(e => console.error(e));
}



// ==========================================
// 8. RADAR DE NOTIFICACIONES Y ALERTAS
// ==========================================
radarInterval = null;
let filaAlertasPendientes = [];
let alertaActualMostrandose = null;
let historialAlertasCache = [];
let alertasPlantillasCache = [];
let alertaSelectionRange = null;
let alertaAccionActualActiva = null;
let alertaEditorState = {
  editingId: '',
  destMode: 'GLOBAL',
  destinatariosSeleccionados: [],
  editorBound: false,
  cta: { type: 'NONE', label: '', value: '', extra: '' }
};

const ALERTA_TIPO_META = Object.freeze({
  URGENTE: { label: 'URGENTE', bg: '#fee2e2', color: '#ef4444', selectBg: '#fef2f2', border: '#ef4444' },
  WARNING: { label: 'ADVERTENCIA', bg: '#fef3c7', color: '#d97706', selectBg: '#fffbeb', border: '#f59e0b' },
  INFO: { label: 'INFORMATIVO', bg: '#dbeafe', color: '#1d4ed8', selectBg: '#eff6ff', border: '#60a5fa' }
});

const ALERTA_MODO_META = Object.freeze({
  INTERRUPTIVA: { label: 'INTERRUPTIVA', icon: '⚡', bg: '#eff6ff', color: '#1a73e8' },
  PASIVA: { label: 'PASIVA', icon: '🔔', bg: '#f8fafc', color: '#475569' }
});

const ALERTA_ACTION_META = Object.freeze({
  NONE: {
    icon: 'remove_circle_outline',
    defaultLabel: '',
    valueLabel: 'Sin acción',
    valuePlaceholder: '',
    extraLabel: '',
    extraPlaceholder: '',
    help: 'La alerta solo mostrará el botón para marcarla como leída.'
  },
  URL: {
    icon: 'open_in_new',
    defaultLabel: 'Abrir enlace',
    valueLabel: 'URL destino',
    valuePlaceholder: 'https://...',
    extraLabel: 'Texto secundario (opcional)',
    extraPlaceholder: 'Ej. Se abrirá en una nueva pestaña',
    help: 'Abre una página externa o documento cuando el usuario pulse el botón.'
  },
  WHATSAPP: {
    icon: 'chat',
    defaultLabel: 'Abrir WhatsApp',
    valueLabel: 'Número de WhatsApp',
    valuePlaceholder: '5215512345678',
    extraLabel: 'Mensaje inicial (opcional)',
    extraPlaceholder: 'Texto que aparecerá precargado',
    help: 'Abre una conversación directa de WhatsApp con el número indicado.'
  },
  COPY: {
    icon: 'content_copy',
    defaultLabel: 'Copiar información',
    valueLabel: 'Texto o enlace a copiar',
    valuePlaceholder: 'Código, URL o mensaje corto',
    extraLabel: 'Confirmación (opcional)',
    extraPlaceholder: 'Ej. Enlace copiado al portapapeles',
    help: 'Copia contenido útil al portapapeles del usuario con un toque.'
  }
});

function _obtenerMetaTipoAlerta(tipo) {
  return ALERTA_TIPO_META[String(tipo || '').trim().toUpperCase()] || ALERTA_TIPO_META.INFO;
}

function _normalizarHexColorAlerta(color = '', fallback = '#1d4ed8') {
  const limpio = String(color || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(limpio)) return limpio.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(limpio)) {
    const [, r, g, b] = limpio;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

function _normalizarModoAutorAlerta(mode = 'CURRENT') {
  const normalized = String(mode || '').trim().toUpperCase();
  if (normalized === 'NONE' || normalized === 'CUSTOM') return normalized;
  return 'CURRENT';
}

function _resolverAutorVisibleDesdeConfig(config = {}, fallback = USER_NAME || 'Sistema') {
  const mode = _normalizarModoAutorAlerta(config.mode || config.modo || config.type);
  const value = String(config.value || config.autor || config.nombre || '').trim();
  if (mode === 'NONE') return '';
  if (mode === 'CUSTOM') return value;
  return value || String(fallback || '').trim();
}

function _obtenerAutorFormularioAlerta() {
  const mode = _normalizarModoAutorAlerta(document.getElementById('alertaAutorModo')?.value || 'CURRENT');
  const customValue = String(document.getElementById('alertaAutorCustom')?.value || '').trim();
  return {
    mode,
    value: mode === 'CUSTOM' ? customValue : '',
    visible: _resolverAutorVisibleDesdeConfig({ mode, value: customValue }, USER_NAME || 'Sistema')
  };
}

function _obtenerAutorVisibleAlerta(alerta = {}, fallback = USER_NAME || 'Sistema') {
  return _resolverAutorVisibleDesdeConfig({
    mode: alerta.authorMode || alerta.autorModo || alerta.author?.mode || alerta.author?.modo,
    value: alerta.authorValue || alerta.autorValor || alerta.author?.value || alerta.author?.autor || alerta.autor || ''
  }, alerta.actor || alerta.emitidoPor || fallback);
}

function _normalizarBannerAlerta(banner = {}, tipo = 'INFO') {
  const metaTipo = _obtenerMetaTipoAlerta(tipo);
  const labelRaw = String(banner.label || banner.text || banner.nombre || '').trim();
  const bgRaw = String(banner.bg || banner.background || banner.fondo || '').trim();
  const colorRaw = String(banner.color || banner.textColor || banner.texto || '').trim();
  const custom = banner.custom === true || Boolean(labelRaw || bgRaw || colorRaw);
  return {
    label: labelRaw || metaTipo.label,
    bg: _normalizarHexColorAlerta(bgRaw, metaTipo.bg),
    color: _normalizarHexColorAlerta(colorRaw, metaTipo.color),
    custom
  };
}

function _obtenerBannerVisibleAlerta(alerta = {}, tipoFallback = '') {
  const tipo = alerta.tipo || tipoFallback || 'INFO';
  return _normalizarBannerAlerta(alerta.banner || alerta.badge || {}, tipo);
}

function _actualizarAutorAlertaUI() {
  const mode = _normalizarModoAutorAlerta(document.getElementById('alertaAutorModo')?.value || 'CURRENT');
  const customInput = document.getElementById('alertaAutorCustom');
  if (!customInput) return;
  customInput.style.display = mode === 'CUSTOM' ? 'block' : 'none';
  if (mode !== 'CUSTOM') customInput.value = '';
}

function _actualizarBannerAlertaUI() {
  const toggle = document.getElementById('alertaBannerCustomToggle');
  const wrap = document.getElementById('alertaBannerCustomWrap');
  const tipo = document.getElementById('alertaNuevaTipo')?.value || 'INFO';
  const metaTipo = _obtenerMetaTipoAlerta(tipo);
  const inputLabel = document.getElementById('alertaBannerLabel');
  const inputBg = document.getElementById('alertaBannerBg');
  const inputText = document.getElementById('alertaBannerText');
  const custom = !!toggle?.checked;

  if (wrap) wrap.style.display = custom ? 'flex' : 'none';
  if (!custom) {
    if (inputLabel) inputLabel.value = '';
    if (inputBg) inputBg.value = metaTipo.bg;
    if (inputText) inputText.value = metaTipo.color;
    return;
  }

  if (inputBg && !inputBg.value) inputBg.value = metaTipo.bg;
  if (inputText && !inputText.value) inputText.value = metaTipo.color;
}

function _obtenerBannerFormularioAlerta() {
  const tipo = document.getElementById('alertaNuevaTipo')?.value || 'INFO';
  const custom = !!document.getElementById('alertaBannerCustomToggle')?.checked;
  if (!custom) return _normalizarBannerAlerta({}, tipo);
  return _normalizarBannerAlerta({
    custom: true,
    label: document.getElementById('alertaBannerLabel')?.value || '',
    bg: document.getElementById('alertaBannerBg')?.value || '',
    color: document.getElementById('alertaBannerText')?.value || ''
  }, tipo);
}

function _setAutorFormularioAlerta(data = {}) {
  const mode = _normalizarModoAutorAlerta(data.mode || data.modo || data.authorMode || ((data.value || data.autor || data.nombre) ? 'CUSTOM' : 'CURRENT'));
  const modeSelect = document.getElementById('alertaAutorModo');
  const customInput = document.getElementById('alertaAutorCustom');
  if (modeSelect) modeSelect.value = mode;
  if (customInput) {
    customInput.value = mode === 'CUSTOM' ? String(data.value || data.autor || data.nombre || '').trim() : '';
  }
  _actualizarAutorAlertaUI();
}

function _setBannerFormularioAlerta(data = {}, tipo = 'INFO') {
  const normalized = _normalizarBannerAlerta(data, tipo);
  const toggle = document.getElementById('alertaBannerCustomToggle');
  const inputLabel = document.getElementById('alertaBannerLabel');
  const inputBg = document.getElementById('alertaBannerBg');
  const inputText = document.getElementById('alertaBannerText');
  if (toggle) toggle.checked = !!normalized.custom;
  if (inputLabel) inputLabel.value = normalized.custom ? normalized.label : '';
  if (inputBg) inputBg.value = normalized.bg;
  if (inputText) inputText.value = normalized.color;
  _actualizarBannerAlertaUI();
}

function _normalizarModoAlerta(modo) {
  return String(modo || '').trim().toUpperCase() === 'PASIVA' ? 'PASIVA' : 'INTERRUPTIVA';
}

function _obtenerMetaModoAlerta(modo) {
  return ALERTA_MODO_META[_normalizarModoAlerta(modo)];
}

function _crearAccionAlertaVacia() {
  return { type: 'NONE', label: '', value: '', extra: '' };
}

function _normalizarAccionAlerta(accion = {}) {
  const rawType = String((accion && (accion.type || accion.tipo)) || '').trim().toUpperCase();
  const type = Object.prototype.hasOwnProperty.call(ALERTA_ACTION_META, rawType) ? rawType : 'NONE';
  const label = String((accion && (accion.label || accion.texto || accion.text)) || '').trim();
  const value = String((accion && (accion.value || accion.url || accion.telefono || accion.contenido)) || '').trim();
  const extra = String((accion && (accion.extra || accion.mensaje || accion.helper)) || '').trim();
  if (type === 'NONE') return _crearAccionAlertaVacia();
  return { type, label, value, extra };
}

function _obtenerMetaAccionAlerta(type) {
  return ALERTA_ACTION_META[String(type || '').trim().toUpperCase()] || ALERTA_ACTION_META.NONE;
}

function _obtenerAccionFormularioAlerta() {
  return _normalizarAccionAlerta({
    type: document.getElementById('alertaActionType')?.value || 'NONE',
    label: document.getElementById('alertaActionLabel')?.value || '',
    value: document.getElementById('alertaActionValue')?.value || '',
    extra: document.getElementById('alertaActionExtra')?.value || ''
  });
}

function _sincronizarFormularioAccionAlerta(accion = _crearAccionAlertaVacia(), forceDefaults = false) {
  const normalized = _normalizarAccionAlerta(accion);
  const typeSelect = document.getElementById('alertaActionType');
  const labelInput = document.getElementById('alertaActionLabel');
  const valueInput = document.getElementById('alertaActionValue');
  const extraInput = document.getElementById('alertaActionExtra');
  if (typeSelect) typeSelect.value = normalized.type;
  if (labelInput) labelInput.value = normalized.label || '';
  if (valueInput) valueInput.value = normalized.value || '';
  if (extraInput) extraInput.value = normalized.extra || '';
  alertaEditorState.cta = normalized;
  _actualizarCamposAccionAlerta(forceDefaults);
}

function _actualizarCamposAccionAlerta(forceDefaults = false) {
  const current = _obtenerAccionFormularioAlerta();
  const meta = _obtenerMetaAccionAlerta(current.type);
  const config = document.getElementById('alertaActionConfig');
  const labelCaption = document.getElementById('alertaActionLabelCaption');
  const valueCaption = document.getElementById('alertaActionValueCaption');
  const extraCaption = document.getElementById('alertaActionExtraCaption');
  const valueInput = document.getElementById('alertaActionValue');
  const extraInput = document.getElementById('alertaActionExtra');
  const help = document.getElementById('alertaActionHelp');
  const extraWrap = document.getElementById('alertaActionExtraWrap');
  const labelInput = document.getElementById('alertaActionLabel');

  if (config) config.style.display = current.type === 'NONE' ? 'none' : 'grid';
  if (labelCaption) labelCaption.innerText = 'Texto del botón';
  if (valueCaption) valueCaption.innerText = meta.valueLabel;
  if (extraCaption) extraCaption.innerText = meta.extraLabel || 'Dato extra';
  if (valueInput) valueInput.placeholder = meta.valuePlaceholder;
  if (extraInput) extraInput.placeholder = meta.extraPlaceholder;
  if (extraWrap) extraWrap.style.display = meta.extraLabel ? 'flex' : 'none';
  if (help) help.innerText = meta.help;

  if (labelInput && current.type !== 'NONE' && (forceDefaults || !labelInput.value.trim())) {
    labelInput.value = meta.defaultLabel;
  }

  alertaEditorState.cta = _obtenerAccionFormularioAlerta();
}

function _normalizarUrlAccionAlerta(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^(https?:\/\/|mailto:|tel:)/i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, '')}`;
}

function _esUrlSeguraAlerta(url = '', allowDataImage = false) {
  const value = String(url || '').trim();
  if (!value) return false;
  if (allowDataImage) return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value);
  return /^(https?:\/\/|mailto:|tel:)/i.test(value);
}

function _obtenerTextoBotonAccionAlerta(accion = {}) {
  const normalized = _normalizarAccionAlerta(accion);
  if (normalized.type === 'NONE') return '';
  return normalized.label || _obtenerMetaAccionAlerta(normalized.type).defaultLabel || 'Abrir';
}

function _obtenerHintAccionAlerta(accion = {}) {
  const normalized = _normalizarAccionAlerta(accion);
  if (normalized.type === 'URL') {
    return normalized.value ? `Abrirá ${normalized.value}` : 'Configura la URL que quieres abrir.';
  }
  if (normalized.type === 'WHATSAPP') {
    return normalized.value ? `Abrirá WhatsApp con ${normalized.value}` : 'Configura el número de destino.';
  }
  if (normalized.type === 'COPY') {
    return normalized.extra || 'Copiará contenido útil al portapapeles.';
  }
  return '';
}

function _renderizarBotonAccionAlerta(boton, accion = {}, color = 'var(--mex-accent)') {
  if (!boton) return;
  const normalized = _normalizarAccionAlerta(accion);
  if (normalized.type === 'NONE') {
    boton.style.display = 'none';
    boton.innerHTML = '';
    return;
  }
  const meta = _obtenerMetaAccionAlerta(normalized.type);
  boton.style.display = 'inline-flex';
  boton.style.background = color;
  boton.style.boxShadow = `0 16px 32px ${color}33`;
  boton.innerHTML = `<span class="material-icons" style="font-size:17px;">${meta.icon}</span><span>${escapeHtml(_obtenerTextoBotonAccionAlerta(normalized))}</span>`;
}

function _copiarTextoAlPortapapeles(texto = '') {
  const contenido = String(texto || '').trim();
  if (!contenido) return Promise.reject(new Error('No hay contenido para copiar.'));
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(contenido);
  }
  return new Promise((resolve, reject) => {
    try {
      const area = document.createElement('textarea');
      area.value = contenido;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.focus();
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      if (!ok) throw new Error('copy failed');
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

async function ejecutarAccionAlertaActual() {
  const accion = _normalizarAccionAlerta(alertaAccionActualActiva || alertaActualMostrandose?.cta || {});
  if (accion.type === 'NONE') return;

  try {
    if (accion.type === 'URL') {
      const target = _normalizarUrlAccionAlerta(accion.value);
      if (!_esUrlSeguraAlerta(target)) throw new Error('URL inválida');
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }

    if (accion.type === 'WHATSAPP') {
      const numero = String(accion.value || '').replace(/\D/g, '');
      if (numero.length < 8) throw new Error('Número inválido');
      const texto = encodeURIComponent(accion.extra || alertaActualMostrandose?.titulo || '');
      const url = `https://wa.me/${numero}${texto ? `?text=${texto}` : ''}`;
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    if (accion.type === 'COPY') {
      await _copiarTextoAlPortapapeles(accion.value || accion.extra || alertaActualMostrandose?.titulo || '');
      showToast(accion.extra || 'Información copiada', 'success');
      return;
    }
  } catch (error) {
    console.error(error);
    showToast(error?.message || 'No se pudo ejecutar la acción.', 'error');
  }
}

function _parseListaAlertaCsv(valor) {
  return Array.from(new Set(
    String(valor || '')
      .split(',')
      .map(item => item.trim().toUpperCase())
      .filter(Boolean)
  ));
}

function _alertaYaLeidaPor(alerta, usuario = USER_NAME) {
  return _parseListaAlertaCsv(alerta && alerta.leidoPor).includes(String(usuario || '').trim().toUpperCase());
}

function _alertaAplicaAUsuario(alerta, usuario = USER_NAME) {
  const usuarioNorm = String(usuario || '').trim().toUpperCase();
  if (!usuarioNorm) return false;
  const destinatarios = _parseListaAlertaCsv(alerta && alerta.destinatarios).filter(item => item !== 'GLOBAL');
  if (destinatarios.length === 0) return true;
  return destinatarios.includes(usuarioNorm);
}

function _inferirModoDestinatariosAlerta(alerta = {}) {
  const modoGuardado = String(alerta.destMode || '').trim().toUpperCase();
  if (modoGuardado === 'SEL' || modoGuardado === 'SOLO' || modoGuardado === 'GLOBAL') return modoGuardado;
  const destinatarios = _parseListaAlertaCsv(alerta.destinatarios).filter(item => item !== 'GLOBAL');
  if (destinatarios.length === 0) return 'GLOBAL';
  return destinatarios.length === 1 ? 'SOLO' : 'SEL';
}

function _obtenerResumenDestinatariosAlerta(alerta = {}) {
  const destinatarios = _parseListaAlertaCsv(alerta.destinatarios).filter(item => item !== 'GLOBAL');
  const modo = _inferirModoDestinatariosAlerta(alerta);
  if (destinatarios.length === 0 || modo === 'GLOBAL') {
    return { icon: 'public', label: 'GLOBAL', detail: 'Visible para toda la red', count: 0 };
  }
  if (modo === 'SOLO' || destinatarios.length === 1) {
    return { icon: 'person', label: `SOLO A ${destinatarios[0]}`, detail: destinatarios[0], count: 1 };
  }
  const detalle = destinatarios.length > 4
    ? `${destinatarios.slice(0, 4).join(', ')} +${destinatarios.length - 4}`
    : destinatarios.join(', ');
  return {
    icon: 'groups',
    label: `${destinatarios.length} SELECCIONADOS`,
    detail: detalle,
    count: destinatarios.length
  };
}

function _obtenerResumenDestinatariosEditor() {
  const destinatarios = _parseListaAlertaCsv(alertaEditorState.destinatariosSeleccionados.join(',')).filter(item => item !== 'GLOBAL');
  if (alertaEditorState.destMode === 'SOLO') {
    const usuario = destinatarios[0] || '';
    return {
      icon: 'person',
      label: usuario ? `SOLO A ${usuario}` : 'SOLO A',
      detail: usuario || 'Selecciona un usuario',
      count: usuario ? 1 : 0
    };
  }
  if (alertaEditorState.destMode === 'SEL') {
    const detalle = destinatarios.length > 3
      ? `${destinatarios.slice(0, 3).join(', ')} +${destinatarios.length - 3}`
      : (destinatarios.join(', ') || 'Selecciona destinatarios');
    return {
      icon: 'groups',
      label: destinatarios.length ? `${destinatarios.length} SELECCIONADOS` : 'SELECCIONADOS',
      detail: detalle,
      count: destinatarios.length
    };
  }
  return { icon: 'public', label: 'GLOBAL', detail: 'Visible para toda la red', count: 0 };
}

function _obtenerStatsTextoAlerta(html = '') {
  const plano = _obtenerTextoPlanoAlerta(html);
  const palabras = plano ? plano.split(/\s+/).filter(Boolean).length : 0;
  const caracteres = plano.length;
  const bloques = String(html || '').trim()
    ? Math.max(1, (String(html).match(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<hr\b/gi) || []).length + 1)
    : 0;
  return { palabras, caracteres, bloques };
}

function _obtenerSublineaModoAlerta(modo, resumenDest) {
  const metaModo = _obtenerMetaModoAlerta(modo);
  if (_normalizarModoAlerta(modo) === 'PASIVA') {
    return `${metaModo.label} · Llega a campanita · ${resumenDest.label}`;
  }
  return `${metaModo.label} · Aparece al abrir el mapa · ${resumenDest.label}`;
}

function _horaPreviewActual() {
  return new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function _ordenarAlertasPendientes(alertas = []) {
  return [...alertas].sort((a, b) => {
    const modoA = _normalizarModoAlerta(a && a.modo) === 'INTERRUPTIVA' ? 0 : 1;
    const modoB = _normalizarModoAlerta(b && b.modo) === 'INTERRUPTIVA' ? 0 : 1;
    if (modoA !== modoB) return modoA - modoB;
    return Number(b && b.timestamp || 0) - Number(a && a.timestamp || 0);
  });
}

function _normalizarMensajeAlertaHtml(mensaje) {
  const contenido = String(mensaje || '').trim();
  if (!contenido) return '';
  if (/<[a-z][\s\S]*>/i.test(contenido)) return _sanitizarHtmlAlerta(contenido);
  return escapeHtml(contenido).replace(/\n/g, '<br>');
}

function _sanitizarHtmlAlerta(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');

  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI', 'SPAN', 'FONT', 'HR', 'BLOCKQUOTE', 'IMG', 'A']);
  const allowedStyles = new Set([
    'text-align', 'color', 'font-size', 'font-weight', 'font-style', 'text-decoration',
    'display', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
    'width', 'max-width', 'border-radius', 'line-height'
  ]);

  function limpiarNodo(node) {
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;

      limpiarNodo(child);

      const tag = child.tagName.toUpperCase();
      if (!allowedTags.has(tag)) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META'].includes(tag)) {
          child.remove();
          return;
        }
        child.replaceWith(...Array.from(child.childNodes));
        return;
      }

      Array.from(child.attributes).forEach(attr => {
        const attrName = attr.name.toLowerCase();
        if (attrName.startsWith('on')) {
          child.removeAttribute(attr.name);
          return;
        }
        if (attrName === 'style') {
          const safeStyle = attr.value
            .split(';')
            .map(rule => rule.trim())
            .filter(Boolean)
            .map(rule => {
              const parts = rule.split(':');
              if (parts.length < 2) return '';
              const prop = parts.shift().trim().toLowerCase();
              const value = parts.join(':').trim();
              if (!allowedStyles.has(prop)) return '';
              if (/[<>]/.test(value) || /url\s*\(/i.test(value)) return '';
              return `${prop}:${value}`;
            })
            .filter(Boolean)
            .join('; ');
          if (safeStyle) child.setAttribute('style', safeStyle);
          else child.removeAttribute('style');
          return;
        }
        if (tag === 'FONT' && (attrName === 'color' || attrName === 'size')) return;
        if (tag === 'IMG' && attrName === 'src') {
          if (_esUrlSeguraAlerta(attr.value, true)) return;
          child.remove();
          return;
        }
        if (tag === 'IMG' && attrName === 'alt') return;
        if (tag === 'A' && attrName === 'href') {
          const href = _normalizarUrlAccionAlerta(attr.value);
          if (_esUrlSeguraAlerta(href)) {
            child.setAttribute('href', href);
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener noreferrer');
            return;
          }
          child.removeAttribute(attr.name);
          return;
        }
        child.removeAttribute(attr.name);
      });

      if (tag === 'A' && !child.getAttribute('href')) {
        child.replaceWith(...Array.from(child.childNodes));
      }
    });
  }

  limpiarNodo(template.content);
  return template.innerHTML.trim();
}

function _obtenerTextoPlanoAlerta(html) {
  const div = document.createElement('div');
  div.innerHTML = _normalizarMensajeAlertaHtml(html);
  return String(div.textContent || div.innerText || '').trim().replace(/\s+/g, ' ');
}

function _safeCssUrl(url) {
  return String(url || '').replace(/'/g, '%27');
}

function _obtenerUsuariosDestinoAlerta() {
  return Array.from(new Set(
    (dbUsuariosLogin || [])
      .map(u => String((u && (u.usuario || u.nombre)) || '').trim().toUpperCase())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
}

function _obtenerEditorAlerta() {
  return document.getElementById('alertaEditorCuerpo');
}

function _colocarCursorFinalAlerta(editor) {
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(editor);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  alertaSelectionRange = range.cloneRange();
}

function _guardarSeleccionEditorAlerta() {
  const editor = _obtenerEditorAlerta();
  const sel = window.getSelection();
  if (!editor || !sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (editor.contains(range.commonAncestorContainer)) {
    alertaSelectionRange = range.cloneRange();
  }
}

function _restaurarSeleccionEditorAlerta() {
  const editor = _obtenerEditorAlerta();
  const sel = window.getSelection();
  if (!editor || !sel) return;
  editor.focus();
  sel.removeAllRanges();
  if (alertaSelectionRange && editor.contains(alertaSelectionRange.commonAncestorContainer)) {
    sel.addRange(alertaSelectionRange);
  } else {
    _colocarCursorFinalAlerta(editor);
  }
}

function _asegurarBindingsEditorAlerta() {
  if (alertaEditorState.editorBound) return;
  const editor = _obtenerEditorAlerta();
  if (!editor) return;

  ['keyup', 'mouseup', 'focus', 'blur', 'input'].forEach(evento => {
    editor.addEventListener(evento, _guardarSeleccionEditorAlerta);
  });

  editor.addEventListener('paste', event => {
    event.preventDefault();
    const textoPlano = (event.clipboardData || window.clipboardData).getData('text/plain');
    _restaurarSeleccionEditorAlerta();
    document.execCommand('insertHTML', false, escapeHtml(textoPlano).replace(/\n/g, '<br>'));
    _guardarSeleccionEditorAlerta();
    _actualizarPreviewAlerta();
  });

  alertaEditorState.editorBound = true;
}

function _renderBotonEmitirAlerta() {
  const btn = document.getElementById('btnEmitirAlertaGlobal');
  if (!btn) return;
  const icon = alertaEditorState.editingId ? 'save' : 'send';
  btn.innerHTML = `<span class="material-icons">${icon}</span><span id="txtBtnEmitir"></span>`;
  _updateBtnEmitir();
}


function refrescarDatos(force = false) {
  if (isSaving || window.PAUSA_CONEXIONES) return; // 🛑 ESCUDO DOBLE: Si estamos guardando o pausados, no hacer nada
  if (!force && _mapaRuntime.unidadesReady) return;
  api.obtenerDatosParaMapa(_miPlaza()).then(data => {
    if (data && data.unidades) {
      _persistMapUnitsCache(data.unidades, _miPlaza());
      sincronizarMapa(data.unidades);
    }
  }).catch(e => console.error(e));
}


let _unsubRadar = [];
let _radarState = { settings: null, globalSettings: null, alertas: null, mensajes: null, incidencias: 0 };
let _radarReady = { settings: false, globalSettings: false, alertas: false, mensajes: false, incidencias: false };
let _radarMissingIndexWarned = false;

function _hasOperationalMapChrome() {
  return Boolean(
    document.getElementById('btnProtocoloV3')
    || document.getElementById('overlayAuditoria')
    || document.getElementById('badgeAlerts')
    || document.getElementById('badgeIncidencias')
    || document.getElementById('lastUpdateDesktop')
  );
}

function _isMissingIndexRadarError(error) {
  const runtimeHelper = window._mex?._isMissingIndexError;
  if (typeof runtimeHelper === 'function') return runtimeHelper(error);
  const code = String(error?.code || '').trim().toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'failed-precondition' || message.includes('requires an index');
}

function _limpiarRadar() {
  if (radarInterval) { clearInterval(radarInterval); radarInterval = null; }
  _unsubRadar.forEach(u => u());
  _unsubRadar = [];
  _radarState = { settings: null, globalSettings: null, alertas: null, mensajes: null, incidencias: 0 };
  _radarReady = { settings: false, globalSettings: false, alertas: false, mensajes: false, incidencias: false };
}

function iniciarRadarNotificaciones() {
  _limpiarRadar();
  if (!USER_NAME) return;
  if (canLockMap() && typeof api.ensureGlobalSettingsDoc === 'function') {
    api.ensureGlobalSettingsDoc().catch(err => console.warn('GLOBAL settings:', err));
  }

  const emitir = () => {
    if (!_radarState.settings || !_radarState.globalSettings) return; // Esperar primera carga
    let liveFeed = _radarState.settings.liveFeed || [];
    if (typeof liveFeed === "string") { try { liveFeed = JSON.parse(liveFeed); } catch { liveFeed = []; } }
    if (!Array.isArray(liveFeed)) liveFeed = [];
    const mapaBloqueadoLocal = _radarState.settings.mapaBloqueado === true;
    const mapaBloqueadoGlobal = _radarState.globalSettings.mapaBloqueadoGlobal === true;
    const alertas = _ordenarAlertasPendientes((_radarState.alertas || []).filter(a =>
      !_alertaYaLeidaPor(a, USER_NAME) && _alertaAplicaAUsuario(a, USER_NAME)
    ));
    _procesarPingUI({
      incidenciasPendientes: _radarState.incidencias || 0,
      alertas,
      mensajesSinLeer: _radarState.mensajes || 0,
      ultimaActualizacion: _radarState.settings.ultimaModificacion || "--/-- 00:00",
      ultimoCuadre: _radarState.settings.ultimoCuadreTexto || "Sin registro",
      mapaBloqueado: mapaBloqueadoLocal || mapaBloqueadoGlobal,
      mapaBloqueadoScope: mapaBloqueadoGlobal ? 'GLOBAL' : (mapaBloqueadoLocal ? 'PLAZA' : ''),
      mapaBloqueadoLocal,
      mapaBloqueadoGlobal,
      estadoCuadreV3: _radarState.settings.estadoCuadreV3 || "LIBRE",
      adminIniciador: _radarState.settings.adminIniciador || "",
      liveFeed,
      error: null
    });
  };

  _unsubRadar.push(
    db.collection('settings').doc((_miPlaza() || 'GLOBAL').toUpperCase()).onSnapshot(snap => {
      _radarState.settings = snap.exists ? snap.data() : {};
      _radarReady.settings = true;
      emitir();
    }, err => console.warn('Radar settings:', err))
  );

  _unsubRadar.push(
    db.collection('settings').doc('GLOBAL').onSnapshot(snap => {
      _radarState.globalSettings = snap.exists ? snap.data() : {};
      _radarReady.globalSettings = true;
      emitir();
    }, err => console.warn('Radar settings global:', err))
  );

  _unsubRadar.push(
    db.collection('alertas').orderBy('timestamp', 'desc').limit(50).onSnapshot(snap => {
      _radarState.alertas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _radarReady.alertas = true;
      emitir();
    }, err => console.warn('Radar alertas:', err))
  );

  _unsubRadar.push(
    db.collection('mensajes').where('destinatario', '==', USER_NAME.toUpperCase()).onSnapshot(snap => {
      _radarState.mensajes = snap.docs.filter(d => d.data().leido !== 'SI').length;
      _radarReady.mensajes = true;
      emitir();
    }, err => console.warn('Radar mensajes:', err))
  );

  _unsubRadar.push(
    db.collection('notas_admin').where('estado', '==', 'PENDIENTE').onSnapshot(snap => {
      _radarState.incidencias = snap.size;
      _radarReady.incidencias = true;
      emitir();
    }, err => console.warn('Radar incidencias:', err))
  );
}

let STRING_ULTIMO_FEED = ""; // Memoria para detectar cambios reales

// Conservado para llamadas directas puntuales si se necesitan
function hacerPingNotificaciones(force = false) {
  if (window.PAUSA_CONEXIONES || !USER_NAME) return;
  if (!force && _radarReady.settings && _radarReady.globalSettings && _radarReady.alertas && _radarReady.mensajes && _radarReady.incidencias) return;
  api.checarNotificaciones(USER_NAME, _miPlaza()).then(res => {
    if (res) _procesarPingUI(res);
  }).catch(err => {
    if (_isMissingIndexRadarError(err)) {
      if (!_radarMissingIndexWarned) {
        console.warn("⚠️ RADAR: falta desplegar el índice compuesto de Firestore para alertas; usando actualización por listeners en tiempo real.", err);
        _radarMissingIndexWarned = true;
      }
      return;
    }
    console.error("❌ RADAR ERROR:", err);
  });
}

function _feedStateSlug(value) {
  return String(value || 'sin-estado')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sin-estado';
}

function _feedUnitLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'MVA';
  const clean = raw.replace(/^MVA[-\s:]*/i, '').replace(/\s+/g, '');
  return `MVA-${clean || raw}`;
}

function _parseLiveFeedLog(log = {}) {
  const accion = String(log.accion || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const autor = String(log.autor || 'Sistema').trim();
  const fecha = String(log.fecha || '').trim();
  const base = {
    title: autor || 'Sistema',
    subtitle: accion || 'Actualización del sistema',
    from: '',
    to: '',
    time: 'Ahora',
    fullTime: fecha
  };

  const detailed = accion.match(/^(.+?)\s*[·•]\s*(.+?)\s*(?:➜|→|->)\s*([^(|]+?)(?:\s*\(([^)]*)\))?\s*$/i);
  if (detailed) {
    const ubicacion = String(detailed[4] || '').trim();
    return {
      ...base,
      title: _feedUnitLabel(detailed[1]),
      subtitle: `Actualización automática${ubicacion ? ` · ${ubicacion}` : ''}`,
      from: String(detailed[2] || '').trim(),
      to: String(detailed[3] || '').trim()
    };
  }

  const simple = accion.match(/^(.+?)\s*(?:➜|→|->)\s*([^(|]+?)(?:\s*\(([^)]*)\))?\s*$/i);
  if (simple) {
    const ubicacion = String(simple[3] || '').trim();
    return {
      ...base,
      title: _feedUnitLabel(simple[1]),
      subtitle: `Actualización automática${ubicacion ? ` · ${ubicacion}` : ''}`,
      to: String(simple[2] || '').trim()
    };
  }

  if (/CUADRE VALIDADO/i.test(accion)) {
    return {
      ...base,
      title: 'Cuadre validado',
      subtitle: accion.replace(/^CUADRE VALIDADO\s*-?\s*/i, '') || 'Checklist operativo actualizado',
      to: 'VALIDADO'
    };
  }

  return base;
}

function _renderFeedChip(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return '';
  return `<span class="feed-state-chip feed-state--${_feedStateSlug(text)}">${escapeHtml(text)}</span>`;
}

function _renderLiveFeedItem(log, index) {
  const item = _parseLiveFeedLog(log);
  const flow = item.from || item.to
    ? `<div class="feed-change-flow">
        ${_renderFeedChip(item.from)}
        ${item.from && item.to ? '<span class="feed-change-arrow">→</span>' : ''}
        ${_renderFeedChip(item.to)}
      </div>`
    : `<p class="feed-change-message">${escapeHtml(item.subtitle)}</p>`;

  return `
    <article class="feed-item feed-change-card ${index === 0 ? 'new-item-glow' : ''}">
      <div class="feed-change-top">
        <div class="feed-change-copy">
          <strong class="feed-change-title">${escapeHtml(item.title)}</strong>
          <span class="feed-change-subtitle">${escapeHtml(item.subtitle)}</span>
        </div>
        <time title="${escapeHtml(item.fullTime || item.time)}">${escapeHtml(item.time)}</time>
      </div>
      ${flow}
    </article>
  `;
}

function _renderLiveActivityFeed(feed = []) {
  const items = (Array.isArray(feed) ? feed : []).map((log, index) => _renderLiveFeedItem(log, index)).join('');
  return `
    <section class="feed-history-panel" aria-label="Historial de cambios">
      <header class="feed-history-header">
        <span>Historial de cambios</span>
        <button type="button" class="feed-history-close" aria-label="Ocultar historial" onclick="this.closest('#liveActivityFeed').innerHTML = '';">×</button>
      </header>
      <div class="feed-history-list">
        ${items}
      </div>
    </section>
  `;
}

function _procesarPingUI(res) {
  if (!res) return;
  // En rutas standalone sin chrome operativo del mapa, no intentamos pintar UI del mapa.
  if (!_hasOperationalMapChrome()) return;
  if (res.error) console.error("Error en servidor:", res.error);

  // 1. ACTUALIZAR RELOJES DE MODIFICACIÓN
  if (res.ultimaActualizacion) {
    const uAdmin = document.getElementById('lastUpdateAdmin');
    const uDesktop = document.getElementById('lastUpdateDesktop');
    if (uAdmin) uAdmin.innerText = res.ultimaActualizacion;
    if (uDesktop) uDesktop.innerText = res.ultimaActualizacion;
  }

  // 2. ACTUALIZAR SELLO DE CUADRE
  const lblCuadre = document.getElementById('lblUltimoCuadre');
  if (lblCuadre && res.ultimoCuadre) {
    lblCuadre.innerText = "✅ " + res.ultimoCuadre;
  }

  // 3. GESTIÓN DE BADGES (INCIDENCIAS)
  const badgeInc = document.getElementById('badgeIncidencias');
  const menuBadgeInc = document.getElementById('menuBadgeIncidencias');
  if (res.incidenciasPendientes > 0) {
    if (badgeInc) { badgeInc.innerText = res.incidenciasPendientes; badgeInc.style.display = 'flex'; }
    if (menuBadgeInc) { menuBadgeInc.innerText = res.incidenciasPendientes; menuBadgeInc.style.display = 'flex'; }
  } else {
    if (badgeInc) badgeInc.style.display = 'none';
    if (menuBadgeInc) menuBadgeInc.style.display = 'none';
  }

  // 4. 🛑 LÓGICA DE AUDITORÍA (BLOQUEO DINÁMICO)
  const overlay = document.getElementById('overlayAuditoria');
  const viewAdmin = document.getElementById('auditViewAdmin');
  const viewUser = document.getElementById('auditViewUser');
  const switchLock = document.getElementById('switchLockAdmin');
  const txtLock = document.getElementById('txtLockAdmin');
  const scope = res.mapaBloqueadoScope === 'GLOBAL' ? 'GLOBAL' : (res.mapaBloqueado ? 'PLAZA' : '');
  estadoLockLocal = res.mapaBloqueadoLocal === true;
  estadoLockGlobal = res.mapaBloqueadoGlobal === true;
  window.MAPA_LOCK_SCOPE = scope;

  if (res.mapaBloqueado) {
    window.MAPA_LOCKED = true;
    document.body.classList.add('map-locked');

    if (overlay) {
      overlay.style.display = 'flex';

      if (canLockMap()) {
        // PRENDER VISTA ADMIN
        overlay.className = "is-admin-global";
        if (viewAdmin) viewAdmin.style.display = "flex";
        if (viewUser) viewUser.style.display = "none";
      } else {
        // PRENDER VISTA INTRUSIVA USUARIO
        overlay.className = "is-user-normal";
        if (viewAdmin) viewAdmin.style.display = "none";
        if (viewUser) viewUser.style.display = "flex";
      }
    }
    _setMapSyncBadge('locked');
    if (switchLock) switchLock.style.background = "#ef4444";
    if (txtLock) txtLock.innerText = scope === 'GLOBAL' ? 'LIBERAR BLOQUEO GLOBAL' : 'LIBERAR BLOQUEO PLAZA';
    _actualizarBannerGlobal({ bloqueado: true, bloqueadoScope: scope }); // [F3.4]

  } else {
    window.MAPA_LOCKED = false;
    window.MAPA_LOCK_SCOPE = '';
    document.body.classList.remove('map-locked');

    if (overlay) {
      overlay.style.display = 'none';
      overlay.className = "";
    }

    if (switchLock) switchLock.style.background = "#64748b";
    if (txtLock) txtLock.innerText = 'BLOQUEAR PATIO';
    if (isSaving) _setMapSyncBadge('saving');
    else if (_mapaSyncState.hasPendingWrite || saveTimeout) _setMapSyncBadge('queued');
    else _setMapSyncBadge('live');
    _actualizarBannerGlobal({ bloqueado: false }); // [F3.4]
  }
  // 5. 🕒 LÓGICA DE FEED INTELIGENTE (CON BRILLO Y AUTO-CLEAN)
  const currentFeedStr = JSON.stringify(res.liveFeed);

  if (currentFeedStr !== STRING_ULTIMO_FEED) {
    STRING_ULTIMO_FEED = currentFeedStr;
    const feedContainer = document.getElementById('liveActivityFeed');

    if (feedContainer && res.liveFeed && res.liveFeed.length > 0) {
      feedContainer.innerHTML = _renderLiveActivityFeed(res.liveFeed);

      // 🕒 AUTO-LIMPIADOR: Después de 15 segundos de inactividad, vaciamos el feed visualmente
      clearTimeout(window.feedTimer);
      window.feedTimer = setTimeout(() => {
        // Solo lo limpiamos si el usuario no ha movido nada nuevo
        api.limpiarFeedGlobal(_miPlaza()).catch(e => console.error(e));
      }, 15000);

    } else if (feedContainer) {
      feedContainer.innerHTML = "";
    }
  }


  // 7 GESTION DE CUADRE
  const btn = document.getElementById('btnProtocoloV3');
  const txt = document.getElementById('txtV3');
  const ico = document.getElementById('icoV3');

  const estadoV3 = res.estadoCuadreV3; // Puede ser "LIBRE", "PROCESO" o "REVISION"

  if (btn && txt && ico) {
    // 🔥 CAMBIADO: Ahora cualquier Admin puede gestionar el cuadre
    if (userRole === 'admin') {
      if (estadoV3 === "PROCESO") {
        // Misión enviada, esperando al auxiliar
        btn.style.opacity = "0.5";
        btn.disabled = true;
        btn.style.background = "#64748b";
        txt.innerText = "MISIÓN EN PATIO...";
        ico.innerText = "directions_run";
      } else if (estadoV3 === "REVISION") {
        // Auxiliar terminó, te toca a ti
        btn.style.opacity = "1";
        btn.disabled = false;
        btn.style.background = "#f59e0b"; // Naranja urgente
        txt.innerText = "FINALIZAR CUADRE";
        ico.innerText = "fact_check";
      } else {
        // Sistema Libre
        btn.style.opacity = "1";
        btn.disabled = false;
        btn.style.background = "#0284c7";
        txt.innerText = "INICIAR CUADRE (ADMIN)";
        ico.innerText = "play_arrow";
      }
    } else {
      // ---------------- AUXILIAR (No es Admin) ----------------
      if (estadoV3 === "PROCESO") {
        btn.style.opacity = "1";
        btn.disabled = false;
        btn.style.background = "#10b981"; // Verde
        txt.innerText = "VERIFICAR INVENTARIO";
        ico.innerText = "fact_check";
      } else if (estadoV3 === "REVISION") {
        btn.style.opacity = "0.5";
        btn.disabled = true;
        btn.style.background = "#64748b";
        txt.innerText = "REPORTE ENVIADO";
        ico.innerText = "check_circle";
      } else {
        btn.style.opacity = "0.5";
        btn.disabled = true;
        btn.style.background = "#64748b";
        txt.innerText = "ESPERANDO ADMIN...";
        ico.innerText = "lock";
      }
    }
  }

  // 6. GESTIÓN DE ALERTAS (CAMPANA)
  const badgeAlt = document.getElementById('badgeAlerts');
  const shellBellBadge = document.getElementById('shellBellBadge');
  const alertasPendientes = _ordenarAlertasPendientes((res.alertas || []).filter(a =>
    !_alertaYaLeidaPor(a, USER_NAME) && _alertaAplicaAUsuario(a, USER_NAME)
  ));
  if (alertasPendientes.length > 0) {
    if (badgeAlt) {
      badgeAlt.innerText = alertasPendientes.length;
      badgeAlt.style.display = 'flex';
    }
    if (shellBellBadge) {
      shellBellBadge.innerText = alertasPendientes.length;
      shellBellBadge.style.display = 'flex';
    }
    filaAlertasPendientes = alertasPendientes;

    const modalAlertas = document.getElementById('modalAlertaMaestra');
    const modalOpen = modalAlertas ? modalAlertas.classList.contains('active') : false;
    const hasInterruptiva = alertasPendientes.some(a => _normalizarModoAlerta(a.modo) === 'INTERRUPTIVA');

    if (hasInterruptiva && !modalOpen && !window.PAUSA_CONEXIONES) {
      abrirSiguienteAlerta();
    }
  } else {
    if (badgeAlt) badgeAlt.style.display = 'none';
    if (shellBellBadge) shellBellBadge.style.display = 'none';
    filaAlertasPendientes = [];
  }

  // 🔥 7. GESTIÓN DEL BUZÓN DE MENSAJES (EL CULPABLE) 🔥
  const badgeBuzon = document.getElementById('badgeBuzon');
  if (res.mensajesSinLeer > 0) {
    if (badgeBuzon) {
      badgeBuzon.innerText = res.mensajesSinLeer;
      badgeBuzon.style.display = 'flex';
    }
    if (shellBellBadge && alertasPendientes.length === 0) {
      shellBellBadge.innerText = res.mensajesSinLeer;
      shellBellBadge.style.display = 'flex';
    }
  } else {
    if (badgeBuzon) badgeBuzon.style.display = 'none';
    if (shellBellBadge && alertasPendientes.length === 0) shellBellBadge.style.display = 'none';
  }
}


// Llama al modal flotante de la primera alerta en la fila
function abrirSiguienteAlerta() {
  filaAlertasPendientes = _ordenarAlertasPendientes(filaAlertasPendientes.filter(a =>
    !_alertaYaLeidaPor(a, USER_NAME) && _alertaAplicaAUsuario(a, USER_NAME)
  ));

  if (filaAlertasPendientes.length === 0) {
    showToast("No tienes alertas nuevas", "success");
    return;
  }

  const modalAlerta = document.getElementById('modalAlertaMaestra');
  const tituloAlerta = document.getElementById('alertaTitulo');
  const mensajeAlerta = document.getElementById('alertaMensaje');
  const fechaAlerta = document.getElementById('alertaFecha');
  const autorAlerta = document.getElementById('alertaAutor');
  const tipoAlerta = document.getElementById('alertaTipo');
  const bannerAlerta = document.getElementById('alertaBannerImg');
  const btnCerrar = document.getElementById('btnCerrarAlerta');
  const btnAccion = document.getElementById('btnAccionAlerta');
  if (!modalAlerta || !tituloAlerta || !mensajeAlerta || !fechaAlerta || !autorAlerta || !tipoAlerta || !bannerAlerta || !btnCerrar || !btnAccion) {
    showToast('Tienes alertas nuevas. Revísalas desde el mapa operativo.', 'info');
    return;
  }

  alertaActualMostrandose = filaAlertasPendientes[0];
  const alerta = alertaActualMostrandose;
  const metaTipo = _obtenerMetaTipoAlerta(alerta.tipo);
  const bannerMeta = _obtenerBannerVisibleAlerta(alerta);
  const autorVisible = _obtenerAutorVisibleAlerta(alerta, '');
  const mensajeHtml = _normalizarMensajeAlertaHtml(alerta.mensaje);
  const accion = _normalizarAccionAlerta(alerta.cta || {});

  tituloAlerta.innerText = alerta.titulo || 'Sin título';
  mensajeAlerta.innerHTML = mensajeHtml || `<div style="color:#94a3b8;">Sin contenido disponible.</div>`;
  mensajeAlerta.scrollTop = 0;
  fechaAlerta.innerText = alerta.fecha || 'Reciente';
  autorAlerta.innerText = autorVisible || '';
  const autorWrap = document.getElementById('alertaFinalAuthorWrap');
  if (autorWrap) autorWrap.style.display = autorVisible ? 'block' : 'none';

  tipoAlerta.innerText = bannerMeta.label;
  tipoAlerta.style.background = bannerMeta.bg;
  tipoAlerta.style.color = bannerMeta.color;

  if (alerta.imagen && (String(alerta.imagen).startsWith('http') || String(alerta.imagen).startsWith('data:image'))) {
    bannerAlerta.style.backgroundImage = `url('${_safeCssUrl(alerta.imagen)}')`;
    bannerAlerta.style.display = 'block';
  } else {
    bannerAlerta.style.backgroundImage = '';
    bannerAlerta.style.display = 'none';
  }

  // Definimos la variable para el contenido
  let contenidoBoton;

  if (_normalizarModoAlerta(alerta.modo) === 'PASIVA') {
    contenidoBoton = 'MARCAR COMO LEÍDA';
  } else {
    // Generamos el HTML con el ícono de Material Icons
    // Añadimos estilos en línea para alinear el ícono verticalmente con el texto
    contenidoBoton = `ENTENDIDO ( <span class="material-icons" style="font-size: 18px; vertical-align: middle; margin-bottom: 2px;">check_circle</span> )`;
  }

  // IMPORTANTE: Cambiamos .innerText por .innerHTML para poder renderizar el ícono
  btnCerrar.innerHTML = contenidoBoton;

  // El resto del código se mantiene igual
  btnCerrar.style.background = metaTipo.color;

  alertaAccionActualActiva = accion.type === 'NONE' ? null : accion;
  _renderizarBotonAccionAlerta(btnAccion, accion, metaTipo.color);

  modalAlerta.classList.add('active');
}

function procesarAlertaLeida() {
  if (!alertaActualMostrandose) return;

  const btn = document.getElementById('btnCerrarAlerta');
  btn.disabled = true;
  btn.innerText = "PROCESANDO...";

  api.marcarAlertaComoLeida(alertaActualMostrandose.id, USER_NAME).then(() => {
    filaAlertasPendientes = filaAlertasPendientes.filter(a => a.id !== alertaActualMostrandose.id);
    document.getElementById('modalAlertaMaestra').classList.remove('active');
    btn.disabled = false;
    btn.innerText = "ENTENDIDO (MARCAR COMO LEÍDA)";
    alertaActualMostrandose = null;
    alertaAccionActualActiva = null;
    hacerPingNotificaciones();
  }).catch(e => {
    console.error(e);
    btn.disabled = false;
    btn.innerText = "REINTENTAR";
  });
}

function alertaCmd(cmd, value = null) {
  const editor = _obtenerEditorAlerta();
  if (!editor) return;
  _restaurarSeleccionEditorAlerta();
  try { document.execCommand('styleWithCSS', false, true); } catch (e) { }
  if (cmd === 'removeFormat') {
    document.execCommand('removeFormat', false, null);
    document.execCommand('unlink', false, null);
  } else {
    document.execCommand(cmd, false, value);
  }
  _guardarSeleccionEditorAlerta();
  _actualizarPreviewAlerta();
}

function alertaFontSize(size) {
  alertaCmd('fontSize', size);
}

function alertaInsertHR() {
  alertaCmd('insertHorizontalRule');
}

async function alertaInsertLink() {
  _guardarSeleccionEditorAlerta();
  const url = await mexPrompt(
    'Insertar enlace',
    'Enlace para insertar:',
    'https://',
    'url',
    'https://'
  );
  if (url === null || !url.trim()) return;
  const normalized = _normalizarUrlAccionAlerta(url);
  if (!_esUrlSeguraAlerta(normalized)) {
    showToast('Ese enlace no es válido.', 'error');
    return;
  }
  alertaCmd('createLink', normalized);
}

function alertaInsertHtml(html = '') {
  if (!String(html || '').trim()) return;
  const editor = _obtenerEditorAlerta();
  if (!editor) return;
  _restaurarSeleccionEditorAlerta();
  try { document.execCommand('styleWithCSS', false, true); } catch (e) { }
  document.execCommand('insertHTML', false, html);
  _guardarSeleccionEditorAlerta();
  _actualizarPreviewAlerta();
}

function abrirSelectorImagenCuerpoAlerta() {
  const input = document.getElementById('alertaBodyImageFile');
  if (input) input.click();
}

function _comprimirArchivoImagenAlerta(file, options = {}) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = event => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_WIDTH = Number(options.maxWidth || 1000);
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', Number(options.quality || 0.68)));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function insertarImagenCuerpoAlerta(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;

  try {
    const base64 = await _comprimirArchivoImagenAlerta(file, { maxWidth: 1100, quality: 0.7 });
    const alt = escapeHtml((file.name || 'Imagen alerta').replace(/\.[^.]+$/, ''));
    alertaInsertHtml(`<div style="text-align:center; margin:14px 0;"><img src="${base64}" alt="${alt}" style="display:block; max-width:100%; width:auto; margin:0 auto; border-radius:18px;"></div>`);
    showToast('Imagen agregada al cuerpo.', 'success');
  } catch (error) {
    console.error(error);
    showToast('No se pudo insertar la imagen.', 'error');
  } finally {
    if (input) input.value = '';
  }
}

function _renderDestinatariosAlerta() {
  const lista = document.getElementById('destListaCheckboxes');
  const soloSelect = document.getElementById('destSoloUsuario');
  if (!lista || !soloSelect) return;

  const usuarios = _obtenerUsuariosDestinoAlerta();
  if (!usuarios.length) {
    lista.innerHTML = `<span style="color:#94a3b8; font-size:12px; font-weight:700; padding:4px;">No hay usuarios cargados todavía.</span>`;
    soloSelect.innerHTML = `<option value="">No hay usuarios disponibles</option>`;
    return;
  }

  const usuariosSet = new Set(usuarios);
  alertaEditorState.destinatariosSeleccionados = alertaEditorState.destinatariosSeleccionados.filter(usuario => usuariosSet.has(usuario));
  const seleccionados = new Set(_parseListaAlertaCsv(alertaEditorState.destinatariosSeleccionados.join(',')));

  lista.innerHTML = usuarios.map(usuario => `
    <label data-usuario="${escapeHtml(usuario.toLowerCase())}" style="display:flex; align-items:center; gap:8px; padding:7px 8px; border-radius:8px; background:#f8fafc; border:1px solid #e2e8f0; cursor:pointer;">
      <input type="checkbox" data-usuario="${escapeHtml(usuario)}" ${seleccionados.has(usuario) ? 'checked' : ''} onchange="_toggleDestinatarioAlerta(this.dataset.usuario, this.checked)">
      <span style="font-size:12px; font-weight:700; color:#334155;">${escapeHtml(usuario)}</span>
    </label>
  `).join('');

  soloSelect.innerHTML = `<option value="">Seleccionar usuario...</option>` +
    usuarios.map(usuario => `<option value="${escapeHtml(usuario)}">${escapeHtml(usuario)}</option>`).join('');
  soloSelect.value = alertaEditorState.destMode === 'SOLO'
    ? (alertaEditorState.destinatariosSeleccionados[0] || '')
    : '';

  _filtrarDestinatarios();
}

function _toggleDestinatarioAlerta(usuario, checked) {
  const set = new Set(alertaEditorState.destinatariosSeleccionados);
  if (checked) set.add(String(usuario || '').trim().toUpperCase());
  else set.delete(String(usuario || '').trim().toUpperCase());
  alertaEditorState.destinatariosSeleccionados = Array.from(set).sort((a, b) => a.localeCompare(b));
  _updateBtnEmitir();
  _actualizarPreviewAlerta();
}

function _seleccionarUsuarioDestino(usuario) {
  alertaEditorState.destinatariosSeleccionados = usuario ? [String(usuario).trim().toUpperCase()] : [];
  _updateBtnEmitir();
  _actualizarPreviewAlerta();
}

function _filtrarDestinatarios() {
  const term = String(document.getElementById('destBuscadorUsuarios')?.value || '').trim().toLowerCase();
  document.querySelectorAll('#destListaCheckboxes label[data-usuario]').forEach(item => {
    item.style.display = !term || item.dataset.usuario.includes(term) ? 'flex' : 'none';
  });
}

function _pintarBotonDestino(btn, activo, colorActivo) {
  if (!btn) return;
  btn.style.borderColor = activo ? colorActivo : '#e2e8f0';
  btn.style.background = activo ? colorActivo : 'white';
  btn.style.color = activo ? 'white' : '#64748b';
}

function _setDestMode(mode) {
  const normalized = String(mode || '').trim().toUpperCase();
  alertaEditorState.destMode = normalized === 'SOLO' || normalized === 'SEL' ? normalized : 'GLOBAL';

  if (alertaEditorState.destMode === 'SOLO' && alertaEditorState.destinatariosSeleccionados.length > 1) {
    alertaEditorState.destinatariosSeleccionados = alertaEditorState.destinatariosSeleccionados.slice(0, 1);
  }

  const panelSel = document.getElementById('destPanelSel');
  const panelSolo = document.getElementById('destPanelSolo');
  _pintarBotonDestino(document.getElementById('destBtnGlobal'), alertaEditorState.destMode === 'GLOBAL', 'var(--mex-blue)');
  _pintarBotonDestino(document.getElementById('destBtnSel'), alertaEditorState.destMode === 'SEL', '#0f766e');
  _pintarBotonDestino(document.getElementById('destBtnSolo'), alertaEditorState.destMode === 'SOLO', '#7c3aed');

  if (panelSel) panelSel.style.display = alertaEditorState.destMode === 'SEL' ? 'flex' : 'none';
  if (panelSolo) panelSolo.style.display = alertaEditorState.destMode === 'SOLO' ? 'block' : 'none';

  _renderDestinatariosAlerta();
  _updateBtnEmitir();
  _actualizarPreviewAlerta();
}

function _selectModo(mode) {
  const normalized = _normalizarModoAlerta(mode);
  const inter = document.getElementById('modoCardInterr');
  const pasiva = document.getElementById('modoCardPasiva');
  const input = document.getElementById('alertaModoActual');
  if (input) input.value = normalized;

  if (inter) {
    inter.style.borderColor = normalized === 'INTERRUPTIVA' ? 'var(--mex-blue)' : '#e2e8f0';
    inter.style.background = normalized === 'INTERRUPTIVA' ? '#eff6ff' : 'white';
  }
  if (pasiva) {
    pasiva.style.borderColor = normalized === 'PASIVA' ? '#475569' : '#e2e8f0';
    pasiva.style.background = normalized === 'PASIVA' ? '#f8fafc' : 'white';
  }

  _updateBtnEmitir();
  _actualizarPreviewAlerta();
}

function _updateAlertaTipoStyle() {
  const select = document.getElementById('alertaNuevaTipo');
  if (!select) return;
  const meta = _obtenerMetaTipoAlerta(select.value);
  select.style.borderColor = meta.border;
  select.style.background = meta.selectBg;
  select.style.color = meta.color;
  if (!document.getElementById('alertaBannerCustomToggle')?.checked) {
    _actualizarBannerAlertaUI();
  }
}

function _actualizarTituloModalAlerta() {
  const titulo = document.getElementById('tituloModalCrearAlerta');
  if (titulo) {
    titulo.innerHTML = `<span class="material-icons" style="font-size:22px; vertical-align:bottom;">campaign</span> ${alertaEditorState.editingId ? 'EDITAR ALERTA MAESTRA' : 'EMITIR ALERTA MAESTRA'}`;
  }

  const btn = document.getElementById('btnEmitirAlertaGlobal');
  if (btn) {
    btn.style.background = alertaEditorState.editingId ? '#1a73e8' : '#ef4444';
    btn.style.boxShadow = alertaEditorState.editingId
      ? '0 6px 16px rgba(26,115,232,0.30)'
      : '0 6px 16px rgba(239,68,68,0.30)';
  }

  _renderBotonEmitirAlerta();
}

function _updateBtnEmitir() {
  const btn = document.getElementById('btnEmitirAlertaGlobal');
  const txt = document.getElementById('txtBtnEmitir');
  if (!btn || !txt) return;

  let label = alertaEditorState.editingId ? 'GUARDAR CAMBIOS' : 'EMITIR A TODA LA RED';
  let destinatariosValidos = true;

  if (alertaEditorState.destMode === 'SEL') {
    const total = alertaEditorState.destinatariosSeleccionados.length;
    destinatariosValidos = total > 0;
    label = total > 0 ? `${alertaEditorState.editingId ? 'GUARDAR PARA' : 'EMITIR A'} ${total} USUARIO${total === 1 ? '' : 'S'}`
      : 'SELECCIONA USUARIOS';
  } else if (alertaEditorState.destMode === 'SOLO') {
    const usuario = alertaEditorState.destinatariosSeleccionados[0] || '';
    destinatariosValidos = Boolean(usuario);
    label = usuario
      ? `${alertaEditorState.editingId ? 'GUARDAR PARA' : 'EMITIR A'} ${usuario}`
      : 'SELECCIONA UN USUARIO';
  } else if (alertaEditorState.editingId) {
    label = 'GUARDAR CAMBIOS GLOBALES';
  }

  btn.disabled = !destinatariosValidos;
  btn.style.opacity = destinatariosValidos ? '1' : '0.65';
  txt.innerText = label;
}

function _actualizarPreviewAlerta() {
  const tipo = document.getElementById('alertaNuevaTipo')?.value || 'URGENTE';
  const titulo = document.getElementById('alertaNuevaTitulo')?.value.trim() || '';
  const imagen = document.getElementById('alertaNuevaImagen')?.value.trim() || '';
  const modo = document.getElementById('alertaModoActual')?.value || 'INTERRUPTIVA';
  const html = _sanitizarHtmlAlerta(_obtenerEditorAlerta()?.innerHTML || '');
  const accion = _obtenerAccionFormularioAlerta();
  const autor = _obtenerAutorFormularioAlerta();
  const banner = _obtenerBannerFormularioAlerta();

  const metaTipo = _obtenerMetaTipoAlerta(tipo);
  const metaModo = _obtenerMetaModoAlerta(modo);
  const resumenDest = _obtenerResumenDestinatariosEditor();
  const statsTexto = _obtenerStatsTextoAlerta(html);
  const hora = _horaPreviewActual();

  const badge = document.getElementById('alertaPreviewBadge');
  if (badge) {
    badge.innerText = banner.label;
    badge.style.background = banner.bg;
    badge.style.color = banner.color;
  }

  const badgeModo = document.getElementById('alertaPreviewModoBadge');
  if (badgeModo) {
    badgeModo.innerText = `${metaModo.icon} ${metaModo.label}`;
    badgeModo.style.background = metaModo.bg;
    badgeModo.style.color = metaModo.color;
  }

  const tituloPreview = document.getElementById('alertaPreviewTitulo');
  if (tituloPreview) tituloPreview.innerText = titulo || 'Sin título';

  const mensajePreview = document.getElementById('alertaPreviewMensaje');
  if (mensajePreview) {
    mensajePreview.innerHTML = html || `<span class="alerta-empty-state">Escribe aquí el texto de la alerta. La vista previa y el modal final se actualizan al instante.</span>`;
  }

  const autorPreviewWrap = document.getElementById('alertaPreviewAuthorWrap');
  const autorPreview = document.getElementById('alertaPreviewAutor');
  if (autorPreviewWrap) autorPreviewWrap.style.display = autor.visible ? 'inline' : 'none';
  if (autorPreview) autorPreview.innerText = autor.visible || '';

  const previewHora = document.getElementById('alertaPreviewHora');
  if (previewHora) previewHora.innerText = hora;

  const previewStats = document.getElementById('alertaPreviewStats');
  if (previewStats) previewStats.innerText = `${statsTexto.palabras} palabras · ${statsTexto.caracteres} caracteres`;

  const editorStats = document.getElementById('alertaEditorStats');
  if (editorStats) editorStats.innerText = `${statsTexto.palabras} palabras · ${statsTexto.caracteres} caracteres · ${statsTexto.bloques} bloque${statsTexto.bloques === 1 ? '' : 's'}`;

  const previewSync = document.getElementById('alertaPreviewSyncLabel');
  if (previewSync) previewSync.innerText = statsTexto.caracteres > 0 ? `Preview sincronizado ${hora}` : 'Preview sincronizado';

  const previewHoraStatus = document.getElementById('alertaPreviewHoraStatus');
  if (previewHoraStatus) previewHoraStatus.innerText = `Última vista previa: ${hora}`;

  const previewSubline = document.getElementById('alertaPreviewSubline');
  if (previewSubline) previewSubline.innerText = _obtenerSublineaModoAlerta(modo, resumenDest);

  const previewDest = document.getElementById('alertaPreviewDestinatarios');
  if (previewDest) {
    previewDest.innerHTML = `<span class="material-icons" style="font-size:14px;">${resumenDest.icon}</span>${escapeHtml(resumenDest.label)}`;
    previewDest.title = resumenDest.detail;
  }

  const editorDestino = document.getElementById('alertaEditorDestinos');
  if (editorDestino) {
    editorDestino.innerHTML = `<span class="material-icons" style="font-size:14px;">${resumenDest.icon}</span><span>${escapeHtml(resumenDest.label)}</span>`;
    editorDestino.title = resumenDest.detail;
  }

  const bannerPreview = document.getElementById('alertaPreviewBanner');
  if (bannerPreview) {
    if (imagen && (imagen.startsWith('http') || imagen.startsWith('data:image'))) {
      bannerPreview.style.backgroundImage = `url('${_safeCssUrl(imagen)}')`;
      bannerPreview.style.display = 'block';
    } else {
      bannerPreview.style.backgroundImage = '';
      bannerPreview.style.display = 'none';
    }
  }

  const actionWrap = document.getElementById('alertaPreviewActionWrap');
  const actionHint = document.getElementById('alertaPreviewActionHint');
  _renderizarBotonAccionAlerta(document.getElementById('alertaPreviewActionBtn'), accion, metaTipo.color);
  if (actionWrap) actionWrap.style.display = accion.type === 'NONE' ? 'none' : 'flex';
  if (actionHint) actionHint.innerText = accion.type === 'NONE' ? '' : _obtenerHintAccionAlerta(accion);

  alertaEditorState.cta = accion;
}

function limpiarImagenAlerta() {
  const fileInput = document.getElementById('alertaFile');
  const hidden = document.getElementById('alertaNuevaImagen');
  const texto = document.getElementById('textoUploadAlerta');
  if (fileInput) fileInput.value = '';
  if (hidden) hidden.value = '';
  if (texto) {
    texto.innerText = 'Seleccionar imagen...';
    texto.style.color = '#64748b';
  }
  _actualizarPreviewAlerta();
}

async function _cargarPlantillasAlerta() {
  const select = document.getElementById('alertaPlantillasSelect');
  if (!select) return;
  select.disabled = true;
  select.innerHTML = `<option value="">📂 Cargando plantillas...</option>`;

  try {
    alertasPlantillasCache = await api.obtenerPlantillasAlerta() || [];
    select.innerHTML = `<option value="">📂 Cargar plantilla...</option>` +
      alertasPlantillasCache.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre || 'Plantilla')}</option>`).join('');
  } catch (error) {
    console.error(error);
    select.innerHTML = `<option value="">No se pudieron cargar</option>`;
  } finally {
    select.disabled = false;
  }
}

function cargarPlantillaSeleccionada() {
  const select = document.getElementById('alertaPlantillasSelect');
  const plantilla = alertasPlantillasCache.find(item => item.id === select?.value);
  if (!plantilla) return;

  document.getElementById('alertaNuevaTipo').value = plantilla.tipo || 'INFO';
  document.getElementById('alertaNuevaTitulo').value = plantilla.titulo || '';
  document.getElementById('alertaNuevaImagen').value = plantilla.imagen || '';
  _setAutorFormularioAlerta({
    mode: plantilla.authorMode || plantilla.autorModo || plantilla.author?.mode || 'CURRENT',
    value: plantilla.authorValue || plantilla.autorValor || plantilla.author?.value || plantilla.autor || ''
  });
  _setBannerFormularioAlerta(plantilla.banner || {}, plantilla.tipo || 'INFO');
  _obtenerEditorAlerta().innerHTML = _normalizarMensajeAlertaHtml(plantilla.mensaje);
  _sincronizarFormularioAccionAlerta(plantilla.cta || {}, true);
  _selectModo(plantilla.modo || 'INTERRUPTIVA');
  const textoUpload = document.getElementById('textoUploadAlerta');
  if (textoUpload) {
    if (plantilla.imagen) {
      textoUpload.innerText = 'Imagen actual cargada';
      textoUpload.style.color = '#1a73e8';
    } else {
      textoUpload.innerText = 'Seleccionar imagen...';
      textoUpload.style.color = '#64748b';
    }
  }
  _updateAlertaTipoStyle();
  _actualizarPreviewAlerta();
  showToast(`Plantilla "${plantilla.nombre}" cargada`, 'success');
}

async function guardarComoPlantilla() {
  if (!canEmitMasterAlerts()) {
    showToast("Tu rol no puede guardar plantillas de alertas.", "error");
    return;
  }

  const tipo = document.getElementById('alertaNuevaTipo').value;
  const titulo = document.getElementById('alertaNuevaTitulo').value.trim();
  const mensaje = _sanitizarHtmlAlerta(_obtenerEditorAlerta()?.innerHTML || '');
  const mensajePlano = _obtenerTextoPlanoAlerta(mensaje);
  const modo = document.getElementById('alertaModoActual').value || 'INTERRUPTIVA';
  const imagen = document.getElementById('alertaNuevaImagen').value.trim();
  const cta = _obtenerAccionFormularioAlerta();
  const autor = _obtenerAutorFormularioAlerta();
  const banner = _obtenerBannerFormularioAlerta();

  if (!titulo && !mensajePlano) {
    showToast("Primero diseña la alerta antes de guardar una plantilla.", "error");
    return;
  }
  if (autor.mode === 'CUSTOM' && !autor.value) {
    showToast("Escribe el autor personalizado o cambia la firma visible.", "error");
    return;
  }

  const sugerencia = titulo ? `Plantilla ${titulo}` : 'Nueva plantilla';
  const nombre = await mexPrompt(
    'Guardar plantilla',
    'Nombre para la plantilla:',
    'Nombre de la plantilla',
    'text',
    sugerencia
  );
  if (nombre === null || !nombre.trim()) return;

  try {
    const res = await api.guardarPlantillaAlerta(nombre.trim(), tipo, titulo || 'Sin título', mensaje, modo, USER_NAME, {
      imagen,
      cta,
      author: { mode: autor.mode, value: autor.value },
      banner
    });
    if (res === 'EXITO') {
      await _cargarPlantillasAlerta();
      showToast("Plantilla guardada", "success");
    } else {
      showToast(res, "error");
    }
  } catch (error) {
    console.error(error);
    showToast("No se pudo guardar la plantilla.", "error");
  }
}

function _prepararFormularioAlerta(alerta = null) {
  alertaEditorState.editingId = alerta && alerta.id ? alerta.id : '';
  alertaEditorState.destMode = alerta ? _inferirModoDestinatariosAlerta(alerta) : 'GLOBAL';
  alertaEditorState.destinatariosSeleccionados = alerta
    ? _parseListaAlertaCsv(alerta.destinatarios).filter(item => item !== 'GLOBAL')
    : [];

  document.getElementById('alertaNuevaTipo').value = alerta?.tipo || 'URGENTE';
  document.getElementById('alertaNuevaTitulo').value = alerta?.titulo || '';
  document.getElementById('alertaNuevaImagen').value = alerta?.imagen || '';
  document.getElementById('alertaFile').value = '';
  _setAutorFormularioAlerta({
    mode: alerta?.authorMode || alerta?.autorModo || alerta?.author?.mode || 'CURRENT',
    value: alerta?.authorValue || alerta?.autorValor || alerta?.author?.value || alerta?.author?.autor || alerta?.autor || ''
  });
  _setBannerFormularioAlerta(alerta?.banner || {}, alerta?.tipo || 'URGENTE');

  const editor = _obtenerEditorAlerta();
  editor.innerHTML = _normalizarMensajeAlertaHtml(alerta?.mensaje || '');
  if (!editor.innerHTML.trim()) editor.innerHTML = '';
  _colocarCursorFinalAlerta(editor);

  const textoUpload = document.getElementById('textoUploadAlerta');
  if (alerta?.imagen) {
    textoUpload.innerText = 'Imagen actual cargada';
    textoUpload.style.color = '#1a73e8';
  } else {
    textoUpload.innerText = 'Seleccionar imagen...';
    textoUpload.style.color = '#64748b';
  }

  _sincronizarFormularioAccionAlerta(alerta?.cta || {}, true);
  _renderDestinatariosAlerta();
  _setDestMode(alertaEditorState.destMode);
  if (alertaEditorState.destMode === 'SOLO') {
    const soloSelect = document.getElementById('destSoloUsuario');
    soloSelect.value = alertaEditorState.destinatariosSeleccionados[0] || '';
  }
  _selectModo(alerta?.modo || 'INTERRUPTIVA');
  _updateAlertaTipoStyle();
  _actualizarTituloModalAlerta();
  _actualizarPreviewAlerta();
}

// Función para abrir el modal de creación
function abrirCreadorAlertas(alerta = null) {
  if (!canEmitMasterAlerts()) {
    showToast("Tu rol no puede emitir alertas maestras.", "error");
    return;
  }

  const adminSidebar = document.getElementById('admin-sidebar');
  if (adminSidebar?.classList.contains('open')) toggleAdminSidebar();
  document.getElementById('gestor-alertas-modal').classList.remove('active');
  document.getElementById('crear-alerta-modal').classList.add('active');
  _asegurarBindingsEditorAlerta();
  _prepararFormularioAlerta(alerta);
  _cargarPlantillasAlerta();
}

// Función que manda la alerta al backend
async function emitirAlertaGlobal() {
  if (!canEmitMasterAlerts()) {
    showToast("Tu rol no puede emitir alertas maestras.", "error");
    return;
  }

  const tipo = document.getElementById('alertaNuevaTipo').value;
  const titulo = document.getElementById('alertaNuevaTitulo').value.trim();
  const mensaje = _sanitizarHtmlAlerta(_obtenerEditorAlerta()?.innerHTML || '');
  const mensajePlano = _obtenerTextoPlanoAlerta(mensaje);
  const imagen = document.getElementById('alertaNuevaImagen').value.trim();
  const modo = _normalizarModoAlerta(document.getElementById('alertaModoActual').value);
  const cta = _obtenerAccionFormularioAlerta();
  const autor = _obtenerAutorFormularioAlerta();
  const banner = _obtenerBannerFormularioAlerta();
  const btn = document.getElementById('btnEmitirAlertaGlobal');

  let destinatarios = 'GLOBAL';
  const destinatariosSeleccionados = _parseListaAlertaCsv(alertaEditorState.destinatariosSeleccionados.join(','));

  if (alertaEditorState.destMode === 'SEL') {
    if (destinatariosSeleccionados.length === 0) return showToast("Selecciona al menos un usuario.", "error");
    destinatarios = destinatariosSeleccionados.join(', ');
  }

  if (alertaEditorState.destMode === 'SOLO') {
    const solo = destinatariosSeleccionados[0];
    if (!solo) return showToast("Selecciona el usuario destinatario.", "error");
    destinatarios = solo;
  }

  if (!titulo || !mensajePlano) {
    return showToast("Título y cuerpo del mensaje son obligatorios.", "error");
  }
  if (autor.mode === 'CUSTOM' && !autor.value) {
    return showToast("Escribe el autor personalizado o cambia la firma visible.", "error");
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="material-icons spinner">sync</span> ${alertaEditorState.editingId ? 'GUARDANDO...' : 'EMITIENDO...'}`;

  try {
    const res = alertaEditorState.editingId
      ? await api.actualizarAlertaMaestra(alertaEditorState.editingId, {
        tipo,
        titulo,
        mensaje,
        imagen,
        modo,
        cta,
        destinatarios,
        destMode: alertaEditorState.destMode,
        author: { mode: autor.mode, value: autor.value },
        banner
      }, USER_NAME)
      : await api.emitirNuevaAlertaMaestra(
        tipo,
        titulo,
        mensaje,
        imagen,
        USER_NAME,
        destinatarios,
        modo,
        { destMode: alertaEditorState.destMode, cta, author: { mode: autor.mode, value: autor.value }, banner }
      );

    _actualizarTituloModalAlerta();

    if (res === "EXITO") {
      showToast(alertaEditorState.editingId ? "Alerta actualizada correctamente." : "¡Alerta disparada a la red!", "success");
      document.getElementById('crear-alerta-modal').classList.remove('active');
      historialAlertasCache = [];
      hacerPingNotificaciones();
    } else {
      showToast(res, "error");
    }
  } catch (e) {
    console.error(e);
    showToast("No se pudo guardar la alerta.", "error");
    _actualizarTituloModalAlerta();
  }
}

// ==========================================
// COMPRESOR DE IMÁGENES PARA ALERTAS
// ==========================================
function comprimirImagenAlerta(event) {
  const file = event.target.files[0];
  if (!file) return;

  const textoUpload = document.getElementById('textoUploadAlerta');
  textoUpload.innerText = "Procesando...";
  _comprimirArchivoImagenAlerta(file, { maxWidth: 900, quality: 0.6 })
    .then(base64Comprimido => {
      document.getElementById('alertaNuevaImagen').value = base64Comprimido;
      textoUpload.innerText = "¡Imagen cargada lista para enviar!";
      textoUpload.style.color = "#10b981";
      if (typeof _actualizarPreviewAlerta === "function") _actualizarPreviewAlerta();
    })
    .catch(error => {
      console.error(error);
      textoUpload.innerText = "No se pudo procesar la imagen";
      textoUpload.style.color = "#ef4444";
      showToast("No se pudo procesar la imagen.", "error");
    });
}



function abrirGestorAlertas() {
  if (!canEmitMasterAlerts()) {
    showToast("Tu rol no puede consultar el historial de alertas.", "error");
    return;
  }

  const adminSidebar = document.getElementById('admin-sidebar');
  if (adminSidebar?.classList.contains('open')) toggleAdminSidebar();
  document.getElementById('gestor-alertas-modal').classList.add('active');
  document.getElementById('alertaHistStatsBar').innerHTML = `<span style="font-size:12px; color:#94a3b8; font-weight:700;">Cargando métricas...</span>`;
  document.getElementById('listaHistorialAlertas').innerHTML = `<div style="text-align:center; padding:40px; color:#64748b; font-weight:700;"><span class="material-icons spinner" style="vertical-align:middle;">sync</span> Cargando historial...</div>`;

  api.obtenerTodasLasAlertas().then(alertas => {
    historialAlertasCache = (alertas || []).map(alerta => ({
      ...alerta,
      mensaje: _normalizarMensajeAlertaHtml(alerta.mensaje)
    }));
    _renderHistorialAlertas();
  }).catch(e => {
    console.error(e);
    document.getElementById('listaHistorialAlertas').innerHTML = `<div style="text-align:center; padding:40px; color:#dc2626; font-weight:700;">No se pudo cargar el historial.</div>`;
    document.getElementById('alertaHistStatsBar').innerHTML = `<span style="font-size:12px; color:#dc2626; font-weight:800;">Error al cargar métricas</span>`;
  });
}

function _limpiarFiltrosHistAlertas() {
  const buscador = document.getElementById('alertaHistBuscador');
  const tipo = document.getElementById('alertaHistTipo');
  const modo = document.getElementById('alertaHistModo');
  if (buscador) buscador.value = '';
  if (tipo) tipo.value = '';
  if (modo) modo.value = '';
  _renderHistorialAlertas();
}

function _renderHistorialAlertas() {
  const contenedor = document.getElementById('listaHistorialAlertas');
  const stats = document.getElementById('alertaHistStatsBar');
  if (!contenedor || !stats) return;

  const term = String(document.getElementById('alertaHistBuscador')?.value || '').trim().toLowerCase();
  const filtroTipo = String(document.getElementById('alertaHistTipo')?.value || '').trim().toUpperCase();
  const filtroModo = String(document.getElementById('alertaHistModo')?.value || '').trim().toUpperCase();

  const filtradas = historialAlertasCache.filter(alerta => {
    const resumenDest = _obtenerResumenDestinatariosAlerta(alerta);
    const autorVisible = _obtenerAutorVisibleAlerta(alerta, '');
    const bannerMeta = _obtenerBannerVisibleAlerta(alerta);
    const textoBusqueda = [
      alerta.titulo || '',
      autorVisible,
      alerta.actor || '',
      bannerMeta.label,
      resumenDest.label,
      resumenDest.detail,
      _obtenerTextoPlanoAlerta(alerta.mensaje)
    ].join(' ').toLowerCase();

    const coincideTipo = !filtroTipo || String(alerta.tipo || '').toUpperCase() === filtroTipo;
    const coincideModo = !filtroModo || _normalizarModoAlerta(alerta.modo) === filtroModo;
    const coincideTexto = !term || textoBusqueda.includes(term);
    return coincideTipo && coincideModo && coincideTexto;
  });

  const total = historialAlertasCache.length;
  const interruptivas = historialAlertasCache.filter(alerta => _normalizarModoAlerta(alerta.modo) === 'INTERRUPTIVA').length;
  const pasivas = total - interruptivas;
  const globales = historialAlertasCache.filter(alerta => _inferirModoDestinatariosAlerta(alerta) === 'GLOBAL').length;

  stats.innerHTML = `
    <span style="padding:6px 10px; border-radius:999px; background:#eff6ff; color:#1d4ed8; font-size:11px; font-weight:900;">${total} TOTAL</span>
    <span style="padding:6px 10px; border-radius:999px; background:#ecfeff; color:#0f766e; font-size:11px; font-weight:900;">${filtradas.length} FILTRADAS</span>
    <span style="padding:6px 10px; border-radius:999px; background:#fef2f2; color:#dc2626; font-size:11px; font-weight:900;">${interruptivas} INTERRUPTIVAS</span>
    <span style="padding:6px 10px; border-radius:999px; background:#f8fafc; color:#475569; font-size:11px; font-weight:900;">${pasivas} PASIVAS</span>
    <span style="padding:6px 10px; border-radius:999px; background:#eef2ff; color:#4338ca; font-size:11px; font-weight:900;">${globales} GLOBALES</span>
  `;

  if (filtradas.length === 0) {
    contenedor.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b; font-weight:700;">No hay alertas que coincidan con los filtros actuales.</div>`;
    return;
  }

  contenedor.innerHTML = filtradas.map(alerta => {
    const metaTipo = _obtenerMetaTipoAlerta(alerta.tipo);
    const bannerMeta = _obtenerBannerVisibleAlerta(alerta);
    const metaModo = _obtenerMetaModoAlerta(alerta.modo);
    const resumenDest = _obtenerResumenDestinatariosAlerta(alerta);
    const autorVisible = _obtenerAutorVisibleAlerta(alerta, '');
    const actorVisible = String(alerta.actor || alerta.emitidoPor || '').trim();
    const lectores = _parseListaAlertaCsv(alerta.leidoPor);
    const editadaInfo = alerta.editadoEn
      ? `<div style="font-size:11px; color:#64748b; font-weight:700;">Editada por <span style="color:#1a73e8;">${escapeHtml(alerta.editadoPor || 'Sistema')}</span> · ${escapeHtml(alerta.editadoEn)}</div>`
      : '';
    const actorInfo = actorVisible && actorVisible.toUpperCase() !== String(autorVisible || '').toUpperCase()
      ? `<div style="font-size:11px; color:#64748b; font-weight:700;">Publicada por <span style="color:#1a73e8;">${escapeHtml(actorVisible)}</span></div>`
      : '';
    const imagen = alerta.imagen
      ? `<div style="width:100%; height:130px; border-radius:12px; background-image:url('${_safeCssUrl(alerta.imagen)}'); background-size:cover; background-position:center;"></div>`
      : '';

    return `
      <div style="background:white; border-radius:16px; padding:18px; border:1px solid #dbe4f0; box-shadow:0 10px 30px rgba(15,23,42,0.06); display:flex; flex-direction:column; gap:14px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <span style="font-size:10px; font-weight:900; padding:5px 10px; border-radius:999px; background:${bannerMeta.bg}; color:${bannerMeta.color}; letter-spacing:0.8px;">${escapeHtml(bannerMeta.label)}</span>
            <span style="font-size:10px; font-weight:900; padding:5px 10px; border-radius:999px; background:${metaModo.bg}; color:${metaModo.color}; letter-spacing:0.8px;">${metaModo.icon} ${metaModo.label}</span>
            <span style="font-size:10px; font-weight:900; padding:5px 10px; border-radius:999px; background:#f8fafc; color:#475569; letter-spacing:0.8px; display:flex; align-items:center; gap:4px;">
              <span class="material-icons" style="font-size:13px;">${resumenDest.icon}</span>${escapeHtml(resumenDest.label)}
            </span>
            <span style="font-size:10px; font-weight:900; padding:5px 10px; border-radius:999px; background:${metaTipo.selectBg}; color:${metaTipo.color}; letter-spacing:0.8px;">BASE ${metaTipo.label}</span>
          </div>
          <div style="text-align:right; min-width:145px;">
            <div style="font-size:11px; color:#64748b; font-weight:900;">${escapeHtml(alerta.fecha || 'Sin fecha')}</div>
            <div style="font-size:10px; color:#94a3b8; font-weight:700;">${lectores.length} lectura${lectores.length === 1 ? '' : 's'}</div>
          </div>
        </div>

        ${imagen}

        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:14px; flex-wrap:wrap;">
          <div style="flex:1; min-width:220px;">
            <h3 style="margin:0 0 6px; color:#163a63; font-size:18px; line-height:1.2;">${escapeHtml(alerta.titulo || 'Sin título')}</h3>
            <div style="font-size:12px; color:#64748b; font-weight:800; margin-bottom:4px;">${autorVisible ? `Emitida como <span style="color:#1a73e8;">${escapeHtml(autorVisible)}</span>` : 'Sin autor visible'}</div>
            ${actorInfo}
            ${editadaInfo}
          </div>
          <div style="min-width:180px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:10px 12px;">
            <div style="font-size:10px; color:#94a3b8; font-weight:900; letter-spacing:0.8px; margin-bottom:6px;">ALCANCE</div>
            <div style="font-size:12px; color:#334155; font-weight:800;">${escapeHtml(resumenDest.detail)}</div>
          </div>
        </div>

        <details style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px;">
          <summary style="cursor:pointer; font-size:12px; font-weight:900; color:#334155; letter-spacing:0.5px;">VER CUERPO COMPLETO</summary>
          <div style="margin-top:12px; font-size:14px; color:#334155; line-height:1.7;">
            ${alerta.mensaje || `<div style="color:#94a3b8;">Sin contenido.</div>`}
          </div>
        </details>

        <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
          <button onclick="verLectoresAlerta('${alerta.id}')" style="background:white; border:1px solid #cbd5e1; padding:9px 12px; border-radius:10px; font-size:11px; font-weight:900; color:#0f172a; cursor:pointer; display:flex; align-items:center; gap:6px;">
            <span class="material-icons" style="font-size:14px;">visibility</span> LEÍDO POR ${lectores.length}
          </button>
          <button onclick="editarAlertaDesdeHistorial('${alerta.id}')" style="background:#eff6ff; border:1px solid #bfdbfe; padding:9px 12px; border-radius:10px; font-size:11px; font-weight:900; color:#1d4ed8; cursor:pointer; display:flex; align-items:center; gap:6px;">
            <span class="material-icons" style="font-size:14px;">edit</span> EDITAR
          </button>
          <button onclick="eliminarAlertaDesdeHistorial('${alerta.id}')" style="background:#fef2f2; border:1px solid #fecaca; padding:9px 12px; border-radius:10px; font-size:11px; font-weight:900; color:#dc2626; cursor:pointer; display:flex; align-items:center; gap:6px;">
            <span class="material-icons" style="font-size:14px;">delete</span> BORRAR
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function editarAlertaDesdeHistorial(idAlerta) {
  const alerta = historialAlertasCache.find(item => item.id === idAlerta);
  if (!alerta) {
    showToast("No encontré la alerta para editar.", "error");
    return;
  }
  abrirCreadorAlertas(alerta);
}

function verLectoresAlerta(idAlerta) {
  const alerta = historialAlertasCache.find(item => item.id === idAlerta);
  const lectores = _parseListaAlertaCsv(alerta && alerta.leidoPor);
  let texto = "Nadie ha confirmado la lectura aún.";
  if (lectores.length > 0) {
    texto = "Han confirmado de enterados:\n\n• " + lectores.join('\n• ');
  }

  document.getElementById('modalText').style.whiteSpace = 'pre-wrap';
  mostrarCustomModal("Reporte de Lecturas", texto, "visibility", "var(--mex-blue)", "CERRAR", "#64748b", null);
  setTimeout(() => { document.getElementById('modalText').style.whiteSpace = 'normal'; }, 5000);
}

function eliminarAlertaDesdeHistorial(idAlerta) {
  mostrarCustomModal("Eliminar Alerta", "¿Borrar esta alerta del sistema definitivamente?", "delete_forever", "#ef4444", "BORRAR", "#ef4444", () => {
    showToast("Borrando alerta...", "success");
    api.eliminarAlertaMaestraBackend(idAlerta, USER_NAME).then(res => {
      if (res === "EXITO") {
        showToast("Alerta eliminada", "success");
        abrirGestorAlertas(); // Recarga la lista
        hacerPingNotificaciones(); // Actualiza campanas
      } else {
        showToast(res, "error");
      }
    }).catch(e => console.error(e));
  });
}

// ==========================================
// 🔥 MAPA DE CALOR LÓGICA
// ==========================================

function toggleMapaCalor() {
  // Ponemos o quitamos la clase maestra al body
  document.body.classList.toggle('heatmap-active');

  const isActivo = document.body.classList.contains('heatmap-active');
  if (isActivo) {
    showToast("🔥 Mapa de Calor Activado", "success");
  } else {
    showToast("❄️ Mapa de Calor Desactivado", "success");
  }
}

// Devuelve el color y diseño del globito según los días
function obtenerDisenoCalor(fechaIngresoStr) {
  // Si está vacío (coches viejos), no mostramos nada
  if (!fechaIngresoStr || fechaIngresoStr.trim() === "") return { bg: 'transparent', border: 'transparent', color: 'transparent', text: '', icon: '', clase: '' };

  try {
    // Como el backend envía ISO 8601 (yyyy-MM-ddTHH:mm:ss), JS lo entiende perfecto:
    const fechaAuto = new Date(fechaIngresoStr);

    // Validar si la fecha es inválida (evita el NaN)
    if (isNaN(fechaAuto.getTime())) throw new Error("Fecha inválida");

    const hoy = new Date();

    // Calculamos diferencia en milisegundos y pasamos a días completos (con decimales)
    const diffTime = Math.abs(hoy - fechaAuto);
    const dias = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (dias <= 2) {
      return { bg: '#dcfce7', border: '#86efac', color: '#16a34a', text: dias + ' DÍAS', icon: 'eco', clase: '' };
    } else if (dias <= 5) {
      return { bg: '#fef9c3', border: '#fde047', color: '#ca8a04', text: dias + ' DÍAS', icon: 'schedule', clase: '' };
    } else {
      return { bg: '#fee2e2', border: '#fca5a5', color: '#ef4444', text: dias + ' DÍAS', icon: 'local_fire_department', clase: 'calor-fuego' };
    }
  } catch (e) {
    // Si algo sale mal, no mostramos el globo feo de NaN, lo ocultamos discretamente
    return { bg: 'transparent', border: 'transparent', color: 'transparent', text: '', icon: '', clase: '' };
  }
}


// --- LÓGICA DEL MENÚ 'MÁS CONTROLES' ---

function toggleMoreControls() {
  document.getElementById('adminControlsDropdown').classList.remove('show'); // close the other
  const menu = document.getElementById('moreControlsDropdown');
  menu.classList.toggle('show');
}

function toggleAdminControls() {
  document.getElementById('moreControlsDropdown').classList.remove('show'); // close the other
  const menu = document.getElementById('adminControlsDropdown');
  menu.classList.toggle('show');
}

// Cerrar los menús si hacemos clic afuera de ellos
document.addEventListener('click', function (event) {
  const wrappers = document.querySelectorAll('.more-controls-wrapper');
  let clickInside = false;
  wrappers.forEach(w => { if (w.contains(event.target)) clickInside = true; });

  if (!clickInside) {
    document.getElementById('moreControlsDropdown')?.classList.remove('show');
    document.getElementById('adminControlsDropdown')?.classList.remove('show');
  }
});

// --- MOTOR: RESUMEN DE FLOTA V2 ---

const ICONOS_RESUMEN = {
  "LISTO": "check_circle",
  "SUCIO": "cleaning_services",
  "TRASLADO": "local_shipping",
  "RESGUARDO": "shield",
  "MANTENIMIENTO": "build",
  "RETENIDA": "lock",
  "VENTA": "sell",
  "NO ARRENDABLE": "block",
  "SIN ESTADO": "help_outline"
};

let globalResData = null;
let vistaActualResumen = 'patio';

function abrirResumenFlota() {
  toggleMoreControls();
  document.getElementById('modal-resumen-flota').classList.add('active');
  const branch = document.getElementById('resv2-branch');
  if (branch) branch.innerText = _miPlaza() || '---';

  // Loader
  document.getElementById('main-grid-resumen').innerHTML = `<div style="grid-column: span 2; text-align: center; padding: 40px; color: #94a3b8;">
        <span class="material-icons spinner" style="border-top-color: var(--mex-green); width: 30px; height: 30px;">sync</span>
        <br><br><span style="font-weight:700; font-size:12px;">Calculando inventario...</span></div>`;
  document.getElementById('total-val-resumen').innerText = "...";
  document.getElementById('resv2-patio-val').innerText = "...";
  document.getElementById('resv2-fuera-val').innerText = "...";
  document.getElementById('resv2-footer-num').innerText = "...";

  actualizarFechaResumen();

  api.obtenerResumenFlotaPatio(_miPlaza()).then(res => {
    globalResData = res;

    // Populate metrics row (always show both)
    const totalFlota = res.patio.total + res.fuera.total;
    document.getElementById('total-val-resumen').innerText = totalFlota;
    document.getElementById('resv2-patio-val').innerText = res.patio.total;
    document.getElementById('resv2-fuera-val').innerText = res.fuera.total;
    document.getElementById('resv2-footer-num').innerText = totalFlota;
    document.getElementById('resv2-sync-time').innerText = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    cambiarVistaResumen('patio');
  }).catch(() => {
    document.getElementById('main-grid-resumen').innerHTML = `<div style="grid-column: span 2; text-align: center; padding: 40px; color: #DC2626; font-weight:700;">Error al cargar datos del servidor.</div>`;
  });
}

function cambiarVistaResumen(v) {
  vistaActualResumen = v;
  document.getElementById('btn-patio-res').classList.toggle('active', v === 'patio');
  document.getElementById('btn-fuera-res').classList.toggle('active', v === 'fuera');
  renderizarResumen();
}

function renderizarResumen() {
  if (!globalResData) return;
  const grid = document.getElementById('main-grid-resumen');
  const d = globalResData[vistaActualResumen];

  // Update footer
  document.getElementById('resv2-footer-num').innerText = d.total;
  grid.innerHTML = "";

  d.lista.forEach((info, index) => {
    const box = document.createElement('div');
    box.className = `stat-box ${info.nombre.replace(/\s+/g, '-')}`;
    box.style.animationDelay = `${index * 0.05}s`;

    const iconName = ICONOS_RESUMEN[info.nombre] || "help_outline";

    let detHtml = "";
    for (let c in info.categorias) {
      detHtml += `<div class="fila-cat"><span>${c}</span><span>${info.categorias[c].cant}</span></div>
                  <span class="mod-list">${info.categorias[c].modelos.join(' · ')}</span>`;
    }

    box.innerHTML = `<div class="stat-top">
                       <div class="stat-icon"><span class="material-icons">${iconName}</span></div>
                       <span class="lbl">${info.nombre}</span>
                     </div>
                     <span class="val">${info.total}</span>
                     <div class="inner-detail">${detHtml}</div>`;

    box.onclick = () => {
      const isA = box.classList.contains('active');
      document.querySelectorAll('#main-grid-resumen .stat-box').forEach(b => b.classList.remove('active'));
      if (!isA) box.classList.add('active');
    };
    grid.appendChild(box);
  });
}

function actualizarFechaResumen() {
  const ahora = new Date();
  const opciones = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
  document.getElementById('fecha-full-resumen').innerText = ahora.toLocaleDateString('es-MX', opciones).toUpperCase();
  document.getElementById('reloj-big-resumen').innerText = ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// ==============================================================
// LÓGICA: INSERTAR UNIDAD AL CUADRE ADMINS
// ==============================================================
function abrirModalInsertarAdmin() {
  const menu = document.getElementById('moreControlsDropdown');
  if (menu) menu.classList.remove('show');
  const plazaOperativa = _obtenerPlazaOperativaCuadreAdmin();
  if (!plazaOperativa && !hasFullAccess()) {
    showToast("No tienes una plaza asignada para registrar en Cuadre Admins.", "error");
    return;
  }
  ADMIN_INSERT_UNIT = null;

  // 1. Mostrar el modal
  document.getElementById('modal-insertar-admin').classList.add('active');

  // 🔥 Aseguramos que el contenedor sea visible desde el segundo 1
  document.getElementById('a_ins_formContainer').style.display = 'block';
  document.getElementById('a_ins_formContainer').scrollTop = 0;
  document.getElementById('a_ins_badgePlaza').innerText = `PLAZA ${plazaOperativa || 'GLOBAL'}`;
  document.getElementById('a_ins_badgeAdmin').innerText = `RESPONSABLE ${USER_NAME || 'SISTEMA'}`;

  // 2. Limpiar y habilitar el buscador
  const searchInput = document.getElementById('a_ins_searchInput');
  const searchMeta = document.getElementById('a_ins_searchMeta');
  searchInput.disabled = false;
  searchInput.value = "";
  searchInput.placeholder = DB_MAESTRA_READY
    ? 'Buscar por MVA, placas, modelo o plaza...'
    : 'Sincronizando base maestra global...';
  document.getElementById('a_ins_results').style.display = 'none';
  if (searchMeta) {
    searchMeta.innerHTML = DB_MAESTRA_READY
      ? `<span class="material-icons" style="font-size:14px;">bolt</span> Base maestra lista para búsqueda inmediata`
      : `<span class="material-icons spinner" style="font-size:14px;">sync</span> Cargando índice global de unidades...`;
  }
  setTimeout(() => searchInput.focus(), 80);

  // 3. Resetear todos los campos para que aparezcan vacíos pero visibles
  ['a_ins_mva', 'a_ins_cat', 'a_ins_mod', 'a_ins_pla', 'a_ins_est', 'a_ins_ubi', 'a_ins_not'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.value = "";
    }
  });
  if (document.getElementById('a_ins_gas')) document.getElementById('a_ins_gas').value = 'N/A';

  const fileInput = document.getElementById('a_ins_file');
  if (fileInput) fileInput.value = "";
  actualizarEstadoArchivosAdmin('a_ins_file', 'a_ins_fileStatus');

  cargarMaestra().then(() => {
    searchInput.placeholder = 'Buscar por MVA, placas, modelo o plaza...';
  }).catch(() => {
    if (searchMeta) {
      searchMeta.innerHTML = `<span class="material-icons" style="font-size:14px;">warning</span> No se pudo refrescar la base global.`;
    }
  });
}

function limpiarFormularioInsertarExterno() {
  ['ext_mva', 'ext_categoria', 'ext_modelo', 'ext_placas', 'ext_notas'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function abrirModalInsertarExterno() {
  if (!canInsertExternalUnits()) {
    showToast("Esta operación está disponible desde Gerente de Plaza hacia arriba.", "error");
    return;
  }
  const plaza = _miPlaza();
  if (!plaza) {
    showToast("Selecciona primero una plaza operativa.", "error");
    return;
  }
  document.getElementById('moreControlsDropdown')?.classList.remove('show');
  const badge = document.getElementById('ext_badgePlaza');
  if (badge) badge.innerText = `PLAZA ${plaza}`;
  limpiarFormularioInsertarExterno();
  document.getElementById('modal-insertar-externo').classList.add('active');
  setTimeout(() => document.getElementById('ext_mva')?.focus(), 80);
}

function ejecutarInsertarExterno() {
  const plaza = _miPlaza();
  const mva = (document.getElementById('ext_mva')?.value || '').trim().toUpperCase();
  const categoria = (document.getElementById('ext_categoria')?.value || '').trim().toUpperCase();
  const modelo = (document.getElementById('ext_modelo')?.value || '').trim().toUpperCase();
  const placas = (document.getElementById('ext_placas')?.value || '').trim().toUpperCase();
  const notas = (document.getElementById('ext_notas')?.value || '').trim();

  if (!plaza) return showToast("Selecciona una plaza antes de registrar externos.", "error");
  if (!mva) return showToast("El MVA es obligatorio para registrar el externo.", "error");

  const btn = document.getElementById('btnGuardarExterno');
  const txt = document.getElementById('txtGuardarExterno');
  const icon = document.getElementById('iconGuardarExterno');
  if (btn) btn.disabled = true;
  if (txt) txt.innerText = 'REGISTRANDO...';
  if (icon) { icon.innerText = 'sync'; icon.classList.add('spinner'); }

  api.insertarUnidadExterna({
    plaza,
    mva,
    categoria,
    categ: categoria,
    modelo,
    placas,
    notas,
    responsableSesion: USER_NAME
  }).then(res => {
    if (String(res || '').startsWith('EXITO')) {
      showToast(`Unidad externa ${mva} registrada en ${plaza}.`, 'success');
      document.getElementById('modal-insertar-externo')?.classList.remove('active');
      if (document.getElementById('fleet-modal')?.classList.contains('active')) cargarFlota();
    } else {
      showToast(String(res || 'No se pudo registrar la unidad externa.'), 'error');
    }
  }).catch(err => {
    showToast(err?.message || 'No se pudo registrar la unidad externa.', 'error');
  }).finally(() => {
    if (btn) btn.disabled = false;
    if (txt) txt.innerText = 'REGISTRAR EXTERNO';
    if (icon) { icon.innerText = 'save'; icon.classList.remove('spinner'); }
  });
}

function filtrarBusquedaAdmin() {
  const term = (document.getElementById('a_ins_searchInput')?.value || '').toUpperCase().trim();
  const resDiv = document.getElementById('a_ins_results');
  const searchMeta = document.getElementById('a_ins_searchMeta');
  if (!resDiv) return;

  if (term.length < 2) {
    resDiv.style.display = 'none';
    if (searchMeta) {
      searchMeta.innerHTML = DB_MAESTRA_READY
        ? `<span class="material-icons" style="font-size:14px;">bolt</span> Busca por MVA, placas, modelo o plaza`
        : `<span class="material-icons spinner" style="font-size:14px;">sync</span> Preparando la base maestra global...`;
    }
    return;
  }

  const matches = DB_MAESTRA
    .map(unit => ({ unit, score: _scoreAdminMaestraMatch(unit, term) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(item => item.unit);

  if (!matches.length) {
    resDiv.style.display = 'none';
    if (searchMeta) {
      searchMeta.innerHTML = `<span class="material-icons" style="font-size:14px;">search_off</span> Sin coincidencias para <strong>${escapeHtml(term)}</strong>`;
    }
    return;
  }

  if (searchMeta) {
    searchMeta.innerHTML = `<span class="material-icons" style="font-size:14px;">tune</span> ${matches.length} resultado${matches.length === 1 ? '' : 's'} rápidos · ${DB_MAESTRA.length.toLocaleString('es-MX')} unidades indexadas`;
  }

  resDiv.innerHTML = matches.map(u => `
    <div class="result-item admin-search-result-card" onclick='autocompletarInsertarAdmin(${JSON.stringify(u)})'>
      <div class="res-info">
        <div class="admin-search-result-top">
          <b>${escapeHtml(u.mva || 'SIN MVA')}</b>
          <span class="admin-search-result-plaza">${escapeHtml(u.plaza || u.sucursal || 'GLOBAL')}</span>
        </div>
        <small>${escapeHtml(u.modelo || 'MODELO SIN REGISTRO')} • ${escapeHtml(u.placas || 'SIN PLACAS')}</small>
        <div class="admin-search-result-tags">
          <span>${escapeHtml(u.categoria || u.categ || 'SIN CAT')}</span>
          <span>${escapeHtml((u.vin || '').slice(-6) ? `VIN · ${(u.vin || '').slice(-6)}` : 'BASE GLOBAL')}</span>
        </div>
      </div>
      <span class="material-icons" style="color:var(--mex-blue);">north_east</span>
    </div>
  `).join('');
  resDiv.style.display = 'block';
}

function autocompletarInsertarAdmin(u) {
  ADMIN_INSERT_UNIT = u;
  // Bloqueamos el buscador
  const input = document.getElementById('a_ins_searchInput');
  input.value = `${u.mva} - ${u.modelo}`;
  input.disabled = true;
  document.getElementById('a_ins_results').style.display = 'none';
  const plazaOperativa = _obtenerPlazaOperativaCuadreAdmin(u.plaza || u.sucursal);
  document.getElementById('a_ins_badgePlaza').innerText = `PLAZA ${plazaOperativa || 'GLOBAL'}`;

  // Mostramos formulario y llenamos los datos inamovibles
  document.getElementById('a_ins_formContainer').style.display = 'block';
  document.getElementById('a_ins_mva').value = u.mva || "";
  document.getElementById('a_ins_cat').value = u.categoria || u.categ || "";
  document.getElementById('a_ins_mod').value = u.modelo || "";
  document.getElementById('a_ins_pla').value = u.placas || "";

  showToast("Completa los datos administrativos", "success");
}

async function ejecutarInsertarAdmin() {
  const mva = document.getElementById('a_ins_mva').value.toUpperCase().trim();
  const est = document.getElementById('a_ins_est').value;
  const ubi = document.getElementById('a_ins_ubi').value;
  const plaza = _obtenerPlazaOperativaCuadreAdmin(
    (ADMIN_INSERT_UNIT && (ADMIN_INSERT_UNIT.plaza || ADMIN_INSERT_UNIT.sucursal)) || ''
  );

  if (!mva) return showToast("Primero selecciona una unidad desde Base Maestra.", "error");
  if (!plaza) return showToast("No se pudo resolver la plaza operativa para este registro.", "error");
  if (!est || !ubi) return showToast("Debes seleccionar un Estado y una Ubicación", "error");

  const btn = document.getElementById('btnGuardarAdmin');
  const txt = document.getElementById('txtGuardarAdmin');
  const icon = document.getElementById('iconGuardarAdmin');

  btn.disabled = true; txt.innerText = "Sincronizando...";
  icon.innerText = "sync"; icon.classList.add("spinner");

  const files = Array.from(document.getElementById('a_ins_file').files || []);

  // Empaquetamos la data tal como la recibe 'procesarModificacionMaestra'
  const data = {
    plaza,
    mva: mva,
    categ: document.getElementById('a_ins_cat').value,
    modelo: document.getElementById('a_ins_mod').value,
    placas: document.getElementById('a_ins_pla').value,
    gasolina: document.getElementById('a_ins_gas').value,
    estado: est,
    ubicacion: ubi,
    notas: document.getElementById('a_ins_not').value,
    borrarNotas: false, // Es nuevo en admins
    evidenceFiles: files,
    adminResponsable: USER_NAME
  };

  // 🔥 Llama a la función correcta: procesarModificacionMaestra, tipo: "INSERTAR"
  api.procesarModificacionMaestra(data, "INSERTAR").then((res) => {
    btn.disabled = false; txt.innerText = "CONFIRMAR REGISTRO";
    icon.innerText = "save"; icon.classList.remove("spinner");

    if (res && (res.includes("ERROR") || res.includes("DUPLICADO"))) {
      showToast(res, "error");
    } else {
      showToast("Unidad registrada en Cuadre Admins", "success");
      document.getElementById('modal-insertar-admin').classList.remove('active');
      // Recargar la tabla
      if (VISTA_ACTUAL_FLOTA === 'ADMINS') cambiarTabFlota('ADMINS');
    }
  }).catch((err) => {
    showToast(err && err.message ? err.message : "Fallo de red", "error");
    btn.disabled = false; txt.innerText = "REINTENTAR";
    icon.innerText = "error"; icon.classList.remove("spinner");
  });
}

window.PAUSA_CONEXIONES = false; // 🔥 NUESTRA VARIABLE SEMÁFORO GLOBAL

async function abrirUltimoCuadre() {
  const ok = await mexConfirm(
    'Validar Cuadre',
    '¿Deseas VALIDAR el CUADRE y enviar el reporte a Gerencia?',
    'warning'
  );
  if (!ok) return;

  window.PAUSA_CONEXIONES = true; // 🛑 DETENEMOS EL RADAR PARA NO ATURDIR A GOOGLE
  showToast("Capturando mapa...", "info");

  try {
    const gridMap = document.getElementById('grid-map');
    const canvas = await html2canvas(gridMap, { backgroundColor: "#2A3441", scale: 1, useCORS: true });
    const base64Image = canvas.toDataURL("image/png");

    const stats = {
      total: document.getElementById('kpi-total').innerText,
      listos: document.getElementById('kpi-listos').innerText,
      taller: document.getElementById('kpi-taller-loc').innerText
    };

    const btnTxt = document.getElementById('lblUltimoCuadre');
    if (btnTxt) btnTxt.innerText = "⏳ ENVIANDO...";

    // 1. Sellamos primero en la base de datos
    api.registrarCierreCuadre(USER_NAME).then(res => {
      showToast("Aplicando sello. Generando correo...", "info");

      // 2. CUANDO EL SELLO TERMINA, MANDAMOS EL CORREO (Peticiones en fila india)
      api.enviarReporteCuadreEmail(base64Image, USER_NAME, stats).then(resMail => {
        window.PAUSA_CONEXIONES = false; // 🟢 REACTIVAMOS EL RADAR
        if (resMail === "EXITO") {
          showToast("¡Cuadre enviado con éxito!", "success");
          if (btnTxt) btnTxt.innerText = "✅ " + new Date().toLocaleString('es-MX') + " (" + USER_NAME + ")";
        } else {
          showToast("Fallo el correo: " + resMail, "error");
        }
        hacerPingNotificaciones(); // Hacemos un ping limpio
      }).catch(err => {
        window.PAUSA_CONEXIONES = false; // 🟢 REACTIVAMOS EL RADAR
        showToast("Error enviando el correo", "error");
      });

    }).catch(err => {
      window.PAUSA_CONEXIONES = false; // 🟢 REACTIVAMOS EL RADAR
      showToast("Error de conexión", "error");
    });

  } catch (err) {
    window.PAUSA_CONEXIONES = false; // 🟢 REACTIVAMOS EL RADAR
    showToast("Error visual al capturar", "error");
  }
}

// ==============================================================
// LÓGICA ACTO 3: MODALES GLOBALES (UNIVERSALES)
// ==============================================================

let FLOTA_TOTAL_GLOBAL = [];
let UNIDAD_GLOBAL_ACTIVA = null;

// --- 1. INSERTAR (ALTA UNIVERSAL) ---
function abrirModalInsertarGlobal() {
  if (!hasFullAccess()) {
    showToast("Tu rol no puede insertar unidades globales.", "error");
    return;
  }
  toggleMoreControls();
  document.getElementById('modal-insertar-global').classList.add('active');
  limpiarFormularioAltaGlobal();
  const scrollPanel = document.querySelector('#modal-insertar-global .form-modal-scroll');
  if (scrollPanel) scrollPanel.scrollTop = 0;
}

function ejecutarInsertarGlobal() {
  const btn = document.getElementById('btnGuardarGlobal');
  const txt = document.getElementById('txtInsertGlobal');
  const icon = document.getElementById('iconInsertGlobal');

  const data = {
    plaza: document.getElementById('g_plaza').value,
    vin: document.getElementById('g_vin').value.toUpperCase(),
    categoria: document.getElementById('g_categoria').value.toUpperCase(),
    año: document.getElementById('g_año').value,
    marca: document.getElementById('g_marca').value.toUpperCase(),
    // 🔥 AQUÍ ESTABA EL ERROR: El ID correcto es g_ins_mod, no g_modelo
    modelo: document.getElementById('g_ins_mod').value.toUpperCase(),
    mva: document.getElementById('g_mva').value.toUpperCase(),
    placas: document.getElementById('g_placas').value.toUpperCase()
  };

  if (!data.vin || !data.mva) return showToast("El VIN y el MVA son obligatorios", "error");

  btn.disabled = true; txt.innerText = "REGISTRANDO...";
  icon.innerText = "sync"; icon.classList.add("spinner");

  api.registrarUnidadEnPlaza(data).then((msg) => {
    showToast("Unidad registrada con éxito", "success");
    btn.disabled = false; txt.innerText = "GUARDAR EN PLAZA";
    icon.innerText = "save"; icon.classList.remove("spinner");
    limpiarFormularioAltaGlobal();
    document.getElementById('modal-insertar-global').classList.remove('active');
  }).catch((err) => {
    showToast("Error: " + err.message, "error");
    btn.disabled = false; txt.innerText = "REINTENTAR";
    icon.innerText = "error"; icon.classList.remove("spinner");
  });
}

function limpiarFormularioAltaGlobal() {
  // Se corrigió 'g_modelo' por 'g_ins_mod' y se agregó un escudo anti-nulos
  ['g_vin', 'g_categoria', 'g_año', 'g_marca', 'g_ins_mod', 'g_mva', 'g_placas'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

// ==============================================================
// LÓGICA 1: EDICIÓN GLOBAL (MODIFICADOR MAESTRO - VIN/AÑO)
// ==============================================================

function abrirModalEditarGlobal() {
  if (!hasFullAccess()) {
    showToast("Tu rol no puede abrir la edición global.", "error");
    return;
  }
  toggleMoreControls();
  document.getElementById('modal-editar-global').classList.add('active');
  desbloquearEdicionGlobal();
  const scrollPanel = document.querySelector('#modal-editar-global .form-modal-scroll');
  if (scrollPanel) scrollPanel.scrollTop = 0;

  const input = document.getElementById('g_edit_searchInput');
  input.disabled = true;
  input.placeholder = "⏳ Descargando base global...";


  api.obtenerUnidadesPlazas().then(data => {
    FLOTA_TOTAL_GLOBAL = data;
    input.disabled = false;
    input.placeholder = "🔍 Buscar MVA, Modelo o Placa...";
    input.focus();
  }).catch(e => console.error(e));
}

async function guardarEdicionGlobal(tipoAccion) {
  if (!hasFullAccess()) {
    showToast("Tu rol no puede modificar la flota global.", "error");
    return;
  }
  if (tipoAccion === 'ELIMINAR') {
    const ok = await mexConfirm(
      'Eliminar unidad global',
      `Eliminarás a ${UNIDAD_GLOBAL_ACTIVA.mva} de la plaza ${UNIDAD_GLOBAL_ACTIVA.plaza} definitivamente. ¿Continuar?`,
      'danger'
    );
    if (!ok) return;
  }

  const data = {
    id: UNIDAD_GLOBAL_ACTIVA.id || UNIDAD_GLOBAL_ACTIVA.fila || '',
    plaza: UNIDAD_GLOBAL_ACTIVA.plaza || UNIDAD_GLOBAL_ACTIVA.sucursal || '',
    fila: document.getElementById('g_edit_fila').value,
    vin: document.getElementById('g_edit_vin').value,
    categoria: document.getElementById('g_edit_cat').value,
    año: document.getElementById('g_edit_año').value,
    marca: document.getElementById('g_edit_mar').value,
    modelo: document.getElementById('g_edit_mod').value, // <--- Lee el texto de tu nuevo <input> sin problemas
    mva: document.getElementById('g_edit_mva').value,
    placas: document.getElementById('g_edit_pla').value
  };

  showToast(tipoAccion === 'ELIMINAR' ? "Eliminando..." : "Actualizando...", "warning");

  if (tipoAccion === 'MODIFICAR') {
    api.actualizarUnidadPlaza(data).then(res => {
      showToast("Unidad Actualizada", "success");
      cerrarModificadorGlobal();
    }).catch(e => {
      console.error(e);
      showToast("Error al actualizar: " + (e.message || e), "error");
    });
  } else {
    const docIdEliminar = UNIDAD_GLOBAL_ACTIVA.id || UNIDAD_GLOBAL_ACTIVA.fila || data.fila || data.mva;
    if (!docIdEliminar) {
      showToast("Error: No se pudo identificar el documento a eliminar (ID vacío).", "error");
      return;
    }
    api.eliminarUnidadPlaza(data.plaza, docIdEliminar).then(res => {
      showToast("Unidad Eliminada", "success");
      cerrarModificadorGlobal();
    }).catch(e => {
      console.error(e);
      showToast("Error al eliminar: " + (e.message || e), "error");
    });
  }
}

async function guardarEdicionAdmin(tipoAccion) {
  if (!canEditAdminCuadre()) {
    showToast("Tu rol solo puede consultar el Cuadre Administrativo.", "error");
    return;
  }
  const plaza = _obtenerPlazaOperativaCuadreAdmin(SELECT_REF_FLOTA.plaza || SELECT_REF_FLOTA.sucursal);
  if (!plaza) {
    showToast("No se pudo resolver la plaza operativa para esta unidad.", "error");
    return;
  }
  if (tipoAccion === 'ELIMINAR') {
    const ok = await mexConfirm(
      'Retirar del Cuadre Administrativo',
      `¿Deseas retirar a ${SELECT_REF_FLOTA.mva} del Cuadre Administrativo? Esta acción no se puede deshacer.`,
      'warning'
    );
    if (!ok) return;
  } else if (!document.getElementById('a_mod_est').value || !document.getElementById('a_mod_ubi').value) {
    showToast("Debes seleccionar Estado y Ubicación para guardar el expediente administrativo.", "error");
    return;
  }

  showToast("Sincronizando Cuadre Admins...", "warning");

  const files = Array.from(document.getElementById('a_mod_file').files || []);

  const data = {
    plaza,
    fila: SELECT_REF_FLOTA.fila, // Asegúrate que tu array DB_ADMINS tiene .fila
    mva: SELECT_REF_FLOTA.mva,
    placas: document.getElementById('a_mod_pla').value,
    categ: document.getElementById('a_mod_cat').value,
    modelo: document.getElementById('a_mod_mod').value,
    gasolina: document.getElementById('a_mod_gas').value,
    estado: document.getElementById('a_mod_est').value,
    ubicacion: document.getElementById('a_mod_ubi').value,
    notas: document.getElementById('a_mod_not').value,
    borrarNotas: document.getElementById('a_mod_del_note').checked,
    evidenceFiles: files,
    adminResponsable: USER_NAME
  };

  // 👈 Llama a procesarModificacionMaestra para Cuadre Admins
  api.procesarModificacionMaestra(data, tipoAccion).then(res => {
    if (res === "EXITO") {
      showToast(`Cuadre Actualizado`, "success");
      document.getElementById('modal-editar-admin').classList.remove('active');
      cambiarTabFlota('ADMINS'); // Recarga la tabla de admins
    } else {
      showToast("Error: " + res, "error");
    }
  }).catch(e => {
    console.error(e);
    showToast(e && e.message ? e.message : "Fallo de conexión al actualizar Cuadre Admins", "error");
  });
}


function abrirModalEliminarGlobal() {
  if (!hasFullAccess()) {
    showToast("Tu rol no puede eliminar unidades globales.", "error");
    return;
  }
  abrirModalEditarGlobal();
  showToast("Busca la unidad que deseas eliminar globalmente", "warning");
}

function filtrarEdicionGlobal() {
  const term = document.getElementById('g_edit_searchInput').value.toUpperCase().trim();
  const resDiv = document.getElementById('g_edit_results');
  if (term.length < 2) { resDiv.style.display = 'none'; return; }

  const matches = FLOTA_TOTAL_GLOBAL.filter(u => (u.etiqueta || "").includes(term)).slice(0, 6);

  if (matches.length > 0) {
    resDiv.innerHTML = matches.map(u => `
      <div class="result-item" onclick="seleccionarUnidadEdicionGlobal('${u.sucursal}', '${u.mva}')">
        <div class="res-info"><b>${u.mva}</b><small>${u.modelo} • ${u.placas}</small></div>
        <div style="font-size:10px; font-weight:800; color:var(--mex-blue); text-align:right;">${u.sucursal}</div>
      </div>
    `).join('');
    resDiv.style.display = 'block';
  } else { resDiv.style.display = 'none'; }
}


function filtrarGlobal() {
  const term = document.getElementById('g_searchInput').value.toUpperCase().trim();
  const resDiv = document.getElementById('g_results');
  if (term.length < 2) { resDiv.style.display = 'none'; return; }

  const matches = FLOTA_TOTAL_GLOBAL.filter(u => (u.etiqueta || "").includes(term)).slice(0, 6);

  if (matches.length > 0) {
    resDiv.innerHTML = matches.map(u => `
      <div class="result-item" onclick="seleccionarUnidadGlobal('${u.sucursal}', '${u.mva}')">
        <div class="res-info"><b>${u.mva}</b><small>${u.modelo} • ${u.placas}</small></div>
        <div style="font-size:10px; font-weight:800; color:var(--mex-blue); text-align:right;">${u.sucursal}</div>
      </div>
    `).join('');
    resDiv.style.display = 'block';
  } else { resDiv.style.display = 'none'; }
}

function seleccionarUnidadEdicionGlobal(sucursal, mva) {
  document.getElementById('g_edit_searchCont').style.display = 'none';
  document.getElementById('g_edit_emptyState').style.display = 'none';
  document.getElementById('g_edit_unitIdentity').style.display = 'flex';
  document.getElementById('g_edit_badgeMVA').innerText = mva;
  document.getElementById('g_edit_badgePlaza').innerText = "SEDE: " + sucursal;
  document.getElementById('g_edit_results').style.display = 'none';

  showToast("Abriendo expediente técnico...", "success");

  api.obtenerDetalleCompleto(sucursal, mva).then(u => {
    UNIDAD_GLOBAL_ACTIVA = u;
    UNIDAD_GLOBAL_ACTIVA.plaza = sucursal;

    document.getElementById('g_edit_formContainer').style.display = 'block';
    document.getElementById('g_edit_formContainer').scrollTop = 0;

    document.getElementById('g_edit_fila').value = u.fila || "";
    document.getElementById('g_edit_vin').value = u.vin || "";
    document.getElementById('g_edit_cat').value = u.categoria || u.categ || "";
    document.getElementById('g_edit_año').value = u.año || "";
    document.getElementById('g_edit_mar').value = u.marca || "";
    document.getElementById('g_edit_mod').value = u.modelo || "";
    document.getElementById('g_edit_mva').value = u.mva || "";
    document.getElementById('g_edit_pla').value = u.placas || "";
  }).catch(e => console.error(e));
}

function desbloquearEdicionGlobal() {
  document.getElementById('g_edit_searchCont').style.display = 'block';
  document.getElementById('g_edit_emptyState').style.display = 'flex';
  document.getElementById('g_edit_unitIdentity').style.display = 'none';
  document.getElementById('g_edit_formContainer').style.display = 'none';
  document.getElementById('g_edit_searchInput').value = "";
  document.getElementById('g_edit_formContainer').scrollTop = 0;
  UNIDAD_GLOBAL_ACTIVA = null;
}



function seleccionarUnidadGlobal(sucursal, mva) {
  document.getElementById('g_searchCont').style.display = 'none';
  document.getElementById('g_emptyState').style.display = 'none';
  document.getElementById('g_unitIdentity').style.display = 'flex';
  document.getElementById('g_badgeMVA').innerText = mva;
  document.getElementById('g_badgePlaza').innerText = "SEDE: " + sucursal;
  document.getElementById('g_results').style.display = 'none';
  document.getElementById('btnCambiarGlobal').style.display = 'block'; // Mostramos el botón cambiar

  showToast("Abriendo expediente...", "success");

  api.obtenerDetalleCompleto(sucursal, mva).then(u => {
    abrirExpedienteGlobal(u, sucursal); // Separamos esto para poder reutilizarlo
  }).catch(e => console.error(e));
}


function _obtenerEvidenciasAdminUI(u = {}) {
  if (Array.isArray(u.evidencias) && u.evidencias.length) {
    return u.evidencias.filter(item => item && (item.url || item.path));
  }
  const legacyUrl = u.url || u.URL || u.urlArchivo || u.urlEvidencia || u.evidencia || "";
  return legacyUrl ? [{ url: legacyUrl, fileName: 'EVIDENCIA', mimeType: '' }] : [];
}

function renderizarVisorEvidenciasAdmin(u = {}) {
  const evidencias = _obtenerEvidenciasAdminUI(u);
  const visorContenedor = document.getElementById('a_visor_evidencia');
  const visorFrame = document.getElementById('a_visor_frame');
  const visorList = document.getElementById('a_visor_list');
  const linkDrive = document.getElementById('a_link_drive');
  const fileStatus = document.getElementById('a_mod_fileStatus');

  if (!visorContenedor || !visorFrame || !visorList || !linkDrive) return;

  if (!evidencias.length) {
    visorContenedor.style.display = 'none';
    visorFrame.innerHTML = "";
    visorList.innerHTML = "";
    linkDrive.href = "#";
    if (fileStatus) fileStatus.innerHTML = "⚪ SIN EVIDENCIA REGISTRADA";
    return;
  }

  const principal = evidencias[0];
  const principalUrl = principal.url || "";
  const mime = String(principal.mimeType || '').toLowerCase();
  const fileName = principal.fileName || 'ARCHIVO PRINCIPAL';
  const esCarpetaDrive = principalUrl.includes('drive.google.com') && principalUrl.includes('/folders/');
  const esImagen = mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(principalUrl);
  const esPdf = mime === 'application/pdf' || /\.pdf(\?|$)/i.test(principalUrl);

  visorContenedor.style.display = 'block';
  linkDrive.href = principalUrl || "#";
  linkDrive.style.display = principalUrl ? 'inline-flex' : 'none';
  linkDrive.innerHTML = `<span class="material-icons" style="font-size:14px;">open_in_new</span> ${escapeHtml(fileName.toUpperCase())}`;

  if (esCarpetaDrive) {
    visorFrame.innerHTML = `
          <div style="padding: 20px; color: #64748b; display: flex; flex-direction: column; align-items: center;">
            <span class="material-icons" style="font-size: 48px; color: var(--mex-blue); margin-bottom: 10px;">folder_shared</span>
            <b style="color: #0d2a54; font-size: 14px;">CARPETA DE EVIDENCIAS</b>
            <span style="font-size: 11px; margin-top: 5px;">Drive bloquea previsualizar carpetas.<br>Abre el archivo principal para verlas.</span>
          </div>`;
  } else if (esImagen && principalUrl) {
    visorFrame.innerHTML = `<img src="${principalUrl}" alt="${escapeHtml(fileName)}" style="max-width:100%; max-height:100%; object-fit:contain; display:block;">`;
  } else if ((esPdf || principalUrl.includes('drive.google.com')) && principalUrl) {
    const previewUrl = principalUrl.includes('/view') ? principalUrl.replace('/view', '/preview') : principalUrl;
    visorFrame.innerHTML = `<iframe src="${previewUrl}" width="100%" height="100%" frameborder="0" allow="autoplay"></iframe>`;
  } else {
    visorFrame.innerHTML = `
          <div style="padding: 20px; color: #64748b; display: flex; flex-direction: column; align-items: center;">
            <span class="material-icons" style="font-size: 48px; color: var(--mex-blue); margin-bottom: 10px;">attach_file</span>
            <b style="color: #0d2a54; font-size: 14px;">ARCHIVO REGISTRADO</b>
            <span style="font-size: 11px; margin-top: 5px;">La vista previa no está disponible para este formato.<br>Usa el enlace para abrirlo.</span>
          </div>`;
  }

  visorList.innerHTML = evidencias.map((item, index) => {
    const nombre = escapeHtml(item.fileName || `EVIDENCIA ${index + 1}`);
    if (!item.url) {
      return `<span style="padding:7px 10px; border-radius:999px; background:#f8fafc; border:1px solid #e2e8f0; color:#64748b; font-size:11px; font-weight:800;">${nombre}</span>`;
    }
    const url = escapeHtml(item.url);
    return `<a href="${url}" target="_blank" style="padding:7px 10px; border-radius:999px; background:#f8fafc; border:1px solid #dbeafe; color:#1d4ed8; text-decoration:none; font-size:11px; font-weight:800;">${nombre}</a>`;
  }).join('');

  if (fileStatus) {
    fileStatus.innerHTML = `✅ ${evidencias.length} evidencia${evidencias.length === 1 ? '' : 's'} registrada${evidencias.length === 1 ? '' : 's'}`;
  }
}

// Función que llena los datos del modal maestro y aplica bloqueos
function abrirExpedienteAdmin(u, esSoloLectura) {
  let setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
  const plaza = _obtenerPlazaOperativaCuadreAdmin(u.plaza || u.sucursal);
  const responsable = _resolverResponsableCuadreAdmin(u) || USER_NAME || 'Sistema';

  setVal('a_mod_cat', u.categoria || u.categ);
  setVal('a_mod_mod', u.modelo);
  setVal('a_mod_mva', u.mva);
  setVal('a_mod_pla', u.placas);
  setVal('a_mod_gas', u.gasolina || 'N/A');
  setVal('a_mod_est', u.estado);
  setVal('a_mod_ubi', u.ubicacion);
  setVal('a_mod_not', u.notas);
  if (document.getElementById('a_mod_del_note')) document.getElementById('a_mod_del_note').checked = false;
  if (document.getElementById('a_mod_badgePlaza')) document.getElementById('a_mod_badgePlaza').innerText = `PLAZA: ${plaza || 'GLOBAL'}`;
  if (document.getElementById('a_mod_metaPlaza')) document.getElementById('a_mod_metaPlaza').innerText = plaza || 'GLOBAL';
  if (document.getElementById('a_mod_metaResponsable')) document.getElementById('a_mod_metaResponsable').innerText = responsable;
  if (document.getElementById('a_mod_metaUpdated')) document.getElementById('a_mod_metaUpdated').innerText = u._updatedAt || u._createdAt || 'SIN FECHA';
  if (document.getElementById('a_mod_file')) document.getElementById('a_mod_file').value = '';
  renderizarVisorEvidenciasAdmin(u);

  // BLOQUEOS DE SOLO LECTURA
  const idsBloquear = ['a_mod_cat', 'a_mod_mod', 'a_mod_pla', 'a_mod_gas', 'a_mod_est', 'a_mod_ubi', 'a_mod_not'];
  idsBloquear.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = esSoloLectura;
      el.style.backgroundColor = esSoloLectura ? "#f1f5f9" : "white";
      el.style.color = esSoloLectura ? "#475569" : "#0d2a54";
    }
  });

  const inputCargarNuevo = document.getElementById('a_mod_file') ? document.getElementById('a_mod_file').parentElement : null;
  if (inputCargarNuevo) inputCargarNuevo.style.display = esSoloLectura ? 'none' : 'block';

  const zonaPeligro = document.getElementById('a_mod_danger_zone');
  if (zonaPeligro) zonaPeligro.style.display = esSoloLectura ? 'none' : 'flex';

  const botonesGuardar = document.getElementById('a_mod_btn_container');
  if (botonesGuardar) botonesGuardar.style.display = esSoloLectura ? 'none' : 'flex';

  const formContainer = document.getElementById('a_mod_formContainer');
  if (formContainer) formContainer.scrollTop = 0;
}


function desbloquearBuscadorGlobal() {
  document.getElementById('g_searchCont').style.display = 'block';
  document.getElementById('g_emptyState').style.display = 'flex';
  document.getElementById('g_unitIdentity').style.display = 'none';
  document.getElementById('g_formContainer').style.display = 'none';
  document.getElementById('g_searchInput').value = "";
  UNIDAD_GLOBAL_ACTIVA = null;
}

function cerrarModificadorGlobal() {
  document.getElementById('modal-editar-global').classList.remove('active');
  desbloquearEdicionGlobal();
}


function cerrarModificadorMaestro() {
  document.getElementById('modal-editar-global').classList.remove('active');
  desbloquearBuscadorGlobal();
}

const toBase64Global = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = error => reject(error);
});

async function ejecutarEdicionGlobal(tipoAccion) {
  if (tipoAccion === 'ELIMINAR') {
    const ok = await mexConfirm(
      'Eliminar unidad global',
      `Estás a punto de eliminar la unidad ${UNIDAD_GLOBAL_ACTIVA.mva}. Esta acción es irreversible. ¿Deseas continuar?`,
      'danger'
    );
    if (!ok) return;
  }

  const btnMod = document.getElementById('btnModGlobal');
  const btnDel = document.getElementById('btnDelGlobal');
  btnMod.disabled = true; btnDel.disabled = true;

  showToast(tipoAccion === 'ELIMINAR' ? "Eliminando unidad..." : "Guardando cambios maestros...", "warning");

  const files = document.getElementById('g_mod_file').files;
  let archivosBase64 = [];
  for (const file of files) {
    const base64 = await toBase64Global(file);
    archivosBase64.push({ base64: base64.split(',')[1], mimeType: file.type, fileName: file.name });
  }

  const data = {
    plaza: UNIDAD_GLOBAL_ACTIVA.plaza,
    fila: document.getElementById('g_mod_fila').value,
    mva: UNIDAD_GLOBAL_ACTIVA.mva,
    placas: document.getElementById('g_mod_pla').value,
    categ: document.getElementById('g_mod_cat').value,
    modelo: document.getElementById('g_mod_mod').value,
    gasolina: document.getElementById('g_mod_gas').value,
    estado: document.getElementById('g_mod_est').value,
    ubicacion: document.getElementById('g_mod_ubi').value,
    notas: document.getElementById('g_mod_not').value,
    borrarNotas: document.getElementById('g_mod_del_note').checked,
    archivos: archivosBase64,
    adminResponsable: USER_NAME
  };

  api.procesarModificacionMaestra(data, tipoAccion).then(res => {
    btnMod.disabled = false; btnDel.disabled = false;
    if (res === "EXITO") {
      showToast(`Operación exitosa (${tipoAccion})`, "success");
      cerrarModificadorMaestro();

      // Si estamos en la vista de admins, recargar la tabla por si modificamos algo
      if (VISTA_ACTUAL_FLOTA === 'ADMINS') cambiarTabFlota('ADMINS');

    } else {
      showToast("Error: " + res, "error");
    }
  }).catch(err => {
    btnMod.disabled = false; btnDel.disabled = false;
    showToast("Fallo de conexión", "error");
  });
}


// Función que llena los datos del modal maestro y aplica bloqueos
function abrirExpedienteGlobal(u, plazaForzada, esSoloLectura = false) {
  UNIDAD_GLOBAL_ACTIVA = u;
  UNIDAD_GLOBAL_ACTIVA.plaza = plazaForzada || u.ubicacion || "BJX";

  document.getElementById('g_formContainer').style.display = 'block';

  // Llenamos los inputs/selects
  let setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };

  setVal('g_mod_fila', u.fila);
  setVal('g_mod_cat', u.categoria || u.categ);
  setVal('g_mod_mod', u.modelo);
  setVal('g_mod_mva', u.mva);
  setVal('g_mod_pla', u.placas);
  setVal('g_mod_gas', u.gasolina);
  setVal('g_mod_est', u.estado);
  setVal('g_mod_ubi', u.ubicacion);
  setVal('g_mod_not', u.notas);

  const checkBorrar = document.getElementById('g_mod_del_note');
  if (checkBorrar) checkBorrar.checked = false;

  // 🔥 LÓGICA DE EVIDENCIA SÚPER BLINDADA 🔥
  // Buscamos la URL en todas las posibles variaciones de nombre de propiedad
  const urlDrive = u.url || u.URL || u.urlArchivo || u.urlEvidencia || u.evidencia || "";

  // Verificamos si hay algún indicador de archivo adjunto
  const estadoArchivo = (u.file || u.FILE || u.archivoStatus || u.tieneArchivo || u.File || "").toString().toUpperCase().trim();
  const tieneEvidencia = estadoArchivo === "SI" || urlDrive !== "";

  const visorContenedor = document.getElementById('g_visor_evidencia');
  const visorFrame = document.getElementById('g_visor_frame');
  const linkDrive = document.getElementById('g_link_drive');
  const fileStatus = document.getElementById('g_mod_fileStatus');
  const inputCargarNuevo = document.getElementById('g_mod_file').parentElement;

  if (tieneEvidencia && urlDrive.includes('drive.google.com')) {
    // Formateamos la URL para la vista previa de Drive
    let previewUrl = urlDrive.replace('/view', '/preview');

    visorContenedor.style.display = 'block';
    linkDrive.href = urlDrive;
    visorFrame.innerHTML = `<iframe src="${previewUrl}" width="100%" height="100%" frameborder="0" allow="autoplay"></iframe>`;

    if (fileStatus) fileStatus.innerHTML = "";
  } else if (tieneEvidencia && !urlDrive) {
    visorContenedor.style.display = 'none';
    visorFrame.innerHTML = "";
    if (fileStatus) fileStatus.innerHTML = "✅ EVIDENCIA REGISTRADA (Link no disponible)";
  } else {
    visorContenedor.style.display = 'none';
    visorFrame.innerHTML = "";
    if (fileStatus) fileStatus.innerHTML = "⚪ SIN EVIDENCIA REGISTRADA";
  }

  // --- 🛡️ APLICAR BLOQUEOS DE SOLO LECTURA ---
  const idsBloquear = ['g_mod_cat', 'g_mod_mod', 'g_mod_pla', 'g_mod_gas', 'g_mod_est', 'g_mod_ubi', 'g_mod_not'];

  idsBloquear.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = esSoloLectura;
      el.style.backgroundColor = esSoloLectura ? "#f1f5f9" : "white";
      el.style.color = esSoloLectura ? "#475569" : "#0d2a54";
    }
  });

  // Ocultar controles de edición si es Admin de Solo Lectura
  const zonaPeligro = document.querySelector('.danger-zone');
  const botonesGuardar = document.getElementById('btnModGlobal').parentElement;

  if (inputCargarNuevo) inputCargarNuevo.style.display = esSoloLectura ? 'none' : 'block';
  if (zonaPeligro) zonaPeligro.style.display = esSoloLectura ? 'none' : 'flex';
  if (botonesGuardar) botonesGuardar.style.display = esSoloLectura ? 'none' : 'flex';
}



// 🔥 ACTUALIZACIÓN OPTIMISTA PARA LA TABLA 🔥
// 🔥 FUNCIÓN DE MAGIA: ACTUALIZACIÓN INSTANTÁNEA DE TABLA 🔥
function actualizarTablaLocal(mva, tipoAccion, datosNuevos = null) {
  if (VISTA_ACTUAL_FLOTA !== 'NORMAL') return;

  if (tipoAccion === 'ELIMINAR') {
    DB_FLOTA = DB_FLOTA.filter(u => u.mva !== mva);
  }
  else if (tipoAccion === 'INSERTAR' && datosNuevos) {
    const nuevaUnidad = {
      mva: datosNuevos.mva, categoria: datosNuevos.categ, modelo: datosNuevos.modelo,
      placas: datosNuevos.placas, gasolina: datosNuevos.gasolina, estado: datosNuevos.estado,
      ubicacion: datosNuevos.ubicacion, notas: datosNuevos.notas,
      etiqueta: `${datosNuevos.categ} ${datosNuevos.modelo} ${datosNuevos.placas} ${datosNuevos.mva} ${datosNuevos.estado} ${datosNuevos.ubicacion}`.toUpperCase()
    };
    DB_FLOTA.unshift(nuevaUnidad); // Pone la nueva unidad hasta arriba
  }
  else if (tipoAccion === 'MODIFICAR' && datosNuevos) {
    const index = DB_FLOTA.findIndex(u => u.mva === mva);
    if (index !== -1) {
      DB_FLOTA[index].estado = datosNuevos.estado;
      DB_FLOTA[index].gasolina = datosNuevos.gasolina;
      DB_FLOTA[index].ubicacion = datosNuevos.ubicacion;
      DB_FLOTA[index].notas = datosNuevos.notas;
      DB_FLOTA[index].etiqueta = `${DB_FLOTA[index].categoria} ${DB_FLOTA[index].modelo} ${DB_FLOTA[index].placas} ${mva} ${datosNuevos.estado} ${datosNuevos.ubicacion}`.toUpperCase();
    }
  }

  // Refrescar los números estadísticos de arriba
  const statTotal = document.getElementById('statTotal');
  const statListos = document.getElementById('statListos');
  if (statTotal) statTotal.innerText = DB_FLOTA.length;
  if (statListos) statListos.innerText = DB_FLOTA.filter(d => d.estado === 'LISTO').length;

  // Redibuja la tabla al instante
  filtrarFlota();
}

// ==============================================================
// LÓGICA: REGISTROS Y MOVIMIENTOS (AUDITORÍA)
// ==============================================================
let aud_logsGlobales = [];
let aud_logsFiltrados = [];
let aud_paginaActual = 1;
let aud_modoActual = 'OPERACION';
const AUD_ITEMS_POR_PAGINA = 25;

function _metaModoAuditoria(mode = aud_modoActual) {
  if (mode === 'GESTION') {
    return {
      title: 'BITÁCORA DE GESTIÓN',
      subtitle: 'Usuarios, solicitudes, bloqueos, alertas y cambios globales',
      placeholder: 'Buscar usuario, acción, rol o referencia...',
      loadingText: 'Sincronizando bitácora de gestión...',
      emptyText: 'La bitácora de gestión está vacía.',
      options: [
        { value: 'TODOS', label: 'Todas las acciones' },
        { value: 'SOLICITUD_APROBADA', label: 'Solicitudes aprobadas' },
        { value: 'SOLICITUD_RECHAZADA', label: 'Solicitudes rechazadas' },
        { value: 'USUARIO_CREADO', label: 'Usuarios creados' },
        { value: 'USUARIO_EDITADO', label: 'Usuarios editados' },
        { value: 'USUARIO_ELIMINADO', label: 'Usuarios eliminados' },
        { value: 'CONFIG_GLOBAL', label: 'Configuración global' }
      ]
    };
  }

  return {
    title: 'AUDITORÍA DEL SISTEMA',
    subtitle: 'Historial operativo del mapa y la flota',
    placeholder: 'Buscar unidad, fecha o autor...',
    loadingText: 'Sincronizando registros operativos...',
    emptyText: 'El registro operativo está vacío.',
    options: [
      { value: 'TODOS', label: 'Todas las acciones' },
      { value: 'IN', label: 'Solo Entradas (IN)' },
      { value: 'BAJA', label: 'Solo Bajas (BAJA)' },
      { value: 'MODIF', label: 'Modificaciones' }
    ]
  };
}

function actualizarModoAuditoriaUI() {
  const meta = _metaModoAuditoria();
  const title = document.getElementById('auditTitle');
  const subtitle = document.getElementById('auditSubtitle');
  const search = document.getElementById('logBuscador');
  const filter = document.getElementById('logFiltroTipo');
  const tabOperacion = document.getElementById('auditModeOperacion');
  const tabGestion = document.getElementById('auditModeGestion');

  if (title) title.innerText = meta.title;
  if (subtitle) subtitle.innerText = meta.subtitle;
  if (search) search.placeholder = meta.placeholder;
  if (filter) {
    filter.innerHTML = meta.options.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
  }

  if (tabOperacion) {
    tabOperacion.style.background = aud_modoActual === 'OPERACION' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)';
    tabOperacion.style.color = aud_modoActual === 'OPERACION' ? 'white' : '#cbd5e1';
  }

  if (tabGestion) {
    tabGestion.style.display = hasFullAccess() ? 'inline-flex' : 'none';
    tabGestion.style.background = aud_modoActual === 'GESTION' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)';
    tabGestion.style.color = aud_modoActual === 'GESTION' ? 'white' : '#cbd5e1';
  }
}

function cambiarModoAuditoria(mode) {
  if (mode === 'GESTION' && !hasFullAccess()) {
    showToast('Solo los roles de acceso total pueden ver la bitácora de gestión.', 'error');
    return;
  }
  aud_modoActual = mode === 'GESTION' ? 'GESTION' : 'OPERACION';
  const search = document.getElementById('logBuscador');
  if (search) search.value = '';
  actualizarModoAuditoriaUI();
  cargarLogsAuditoria();
}

function abrirRegistrosMovimientos() {
  toggleMoreControls(); // Cierra el menú desplegable
  aud_modoActual = 'OPERACION';
  document.getElementById('modal-registros-movimientos').classList.add('active');
  const search = document.getElementById('logBuscador');
  if (search) search.value = '';
  actualizarModoAuditoriaUI();
  cargarLogsAuditoria();
}

function cargarLogsAuditoria() {
  const meta = _metaModoAuditoria();
  const icon = document.getElementById('logRefreshIcon');
  const contenedor = document.getElementById('listaLogsAuditoria');
  const btnMas = document.getElementById('btnCargarMasLogs');

  icon.classList.add('spinner');
  btnMas.style.display = 'none';
  contenedor.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b;"><span class="material-icons spinner" style="font-size:30px;">sync</span><br>${meta.loadingText}</div>`;

  const fetcher = aud_modoActual === 'GESTION' ? api.obtenerEventosGestion() : api.obtenerLogsServer();
  fetcher.then(data => {
    icon.classList.remove('spinner');
    aud_logsGlobales = Array.isArray(data) ? data : [];
    if (aud_logsGlobales.length === 0) {
      contenedor.innerHTML = `<div style="text-align:center; padding:30px; font-weight:700; color:#64748b;">${meta.emptyText}</div>`;
      return;
    }
    aplicarFiltrosLogs(true);
  }).catch(error => {
    icon.classList.remove('spinner');
    console.error(error);
    contenedor.innerHTML = `<div style="text-align:center; padding:30px; color:#ef4444; font-weight:700;">No se pudieron cargar los registros.</div>`;
  });
}

function aplicarFiltrosLogs(reiniciarPagina = false) {
  if (reiniciarPagina) aud_paginaActual = 1;

  const termino = document.getElementById('logBuscador').value.toLowerCase().trim();
  const tipo = document.getElementById('logFiltroTipo').value;

  aud_logsFiltrados = aud_logsGlobales.filter(log => {
    const coincideTipo = (tipo === "TODOS") || ((log.tipo || "").toUpperCase() === tipo);
    const textoCombinado = [
      log.autor || "",
      log.accion || "",
      log.fecha || "",
      log.entidad || "",
      log.referencia || "",
      log.detalles || "",
      log.objetivo || "",
      log.rolObjetivo || "",
      log.plazaObjetivo || ""
    ].join(' ').toLowerCase();
    const coincideTexto = textoCombinado.includes(termino);

    return coincideTipo && coincideTexto;
  });

  renderizarLogsAuditoria();
}

function _resolveLogExactLocation(log = {}) {
  const exactLocation = log.exactLocation || {};
  const latitude = Number(exactLocation.latitude ?? log.latitude ?? log.geoLatitude);
  const longitude = Number(exactLocation.longitude ?? log.longitude ?? log.geoLongitude);
  const accuracy = Number(exactLocation.accuracy ?? log.accuracy ?? log.geoAccuracy);
  const mapsUrl = String(exactLocation.googleMapsUrl || log.googleMapsUrl || '').trim();
  const status = String(log.locationStatus || exactLocation.status || '').trim().toLowerCase();
  const city = String(exactLocation.city || log.city || '').trim();
  const state = String(exactLocation.state || log.state || '').trim();
  const addressLabel = String(exactLocation.addressLabel || log.addressLabel || [city, state].filter(Boolean).join(', ')).trim();
  return { latitude, longitude, accuracy, mapsUrl, status, city, state, addressLabel };
}

function _logExactLocationHtml(log = {}, compact = false) {
  if (!canViewExactLocationLogs()) {
    return compact
      ? '<span style="color:#94a3b8;font-weight:800;">Ubicación protegida</span>'
      : '<span style="display:inline-flex;align-items:center;gap:6px;color:#94a3b8;font-weight:800;"><span class="material-icons" style="font-size:14px;">lock</span>Ubicación protegida</span>';
  }

  const { latitude, longitude, mapsUrl, status, addressLabel, city, state } = _resolveLogExactLocation(log);
  const summaryLabel = addressLabel || [city, state].filter(Boolean).join(', ') || 'Ubicación disponible';
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const href = mapsUrl || `https://maps.google.com/?q=${latitude},${longitude}`;
    const buttonHtml = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 12px;border-radius:999px;background:#0f766e;color:#fff;font-weight:900;text-decoration:none;">
      <span class="material-icons" style="font-size:15px;">map</span>Ver ubi
    </a>`;
    if (compact) {
      return `<span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="color:#0f172a;font-weight:800;">${escapeHtml(summaryLabel)}</span>
        ${buttonHtml}
      </span>`;
    }
    return `<span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="display:inline-flex;align-items:center;gap:6px;color:#0f172a;font-weight:800;">
        <span class="material-icons" style="font-size:15px;color:#0f766e;">location_on</span>${escapeHtml(summaryLabel)}
      </span>
      ${buttonHtml}
    </span>`;
  }

  if (mapsUrl) {
    return `<span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="color:#0f172a;font-weight:800;">${escapeHtml(summaryLabel)}</span>
      <a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 12px;border-radius:999px;background:#0f766e;color:#fff;font-weight:900;text-decoration:none;">
        <span class="material-icons" style="font-size:15px;">map</span>Ver ubi
      </a>
    </span>`;
  }

  if (status === 'denied') return '<span style="color:#b45309;font-weight:800;">Permiso denegado</span>';
  if (status === 'unsupported') return '<span style="color:#64748b;font-weight:800;">Sin soporte</span>';
  if (status === 'error') return '<span style="color:#dc2626;font-weight:800;">Error de ubicación</span>';
  return '<span style="color:#94a3b8;font-weight:800;">Sin ubicación exacta</span>';
}

function _visualLogAuditoria(log) {
  const tipo = String(log.tipo || '').toUpperCase();

  if (aud_modoActual === 'GESTION') {
    if (tipo.includes('APROBADA') || tipo.includes('CREADO') || tipo.includes('EMITIDA') || tipo.includes('LIBERADO')) {
      return { colorClass: 'log-badge-in', borderLeft: '#10b981' };
    }
    if (tipo.includes('RECHAZADA') || tipo.includes('ELIMINADO') || tipo.includes('BLOQUEADO')) {
      return { colorClass: 'log-badge-baja', borderLeft: '#ef4444' };
    }
    return { colorClass: 'log-badge-modif', borderLeft: '#0ea5e9' };
  }

  if (tipo === "IN") return { colorClass: 'log-badge-in', borderLeft: '#10b981' };
  if (tipo === "BAJA") return { colorClass: 'log-badge-baja', borderLeft: '#ef4444' };
  if (tipo === "MODIF" || tipo === "MODIFICACION") return { colorClass: 'log-badge-modif', borderLeft: '#f59e0b' };
  return { colorClass: 'log-badge-default', borderLeft: '#e2e8f0' };
}

function renderizarLogsAuditoria() {
  const contenedor = document.getElementById('listaLogsAuditoria');
  const btnMas = document.getElementById('btnCargarMasLogs');
  const meta = _metaModoAuditoria();

  if (aud_logsFiltrados.length === 0) {
    contenedor.innerHTML = `<div style="text-align:center; padding:30px; color:#64748b; font-weight:700;">No se encontraron movimientos.</div>`;
    btnMas.style.display = 'none';
    return;
  }

  const recortes = aud_logsFiltrados.slice(0, aud_paginaActual * AUD_ITEMS_POR_PAGINA);
  btnMas.style.display = (aud_logsFiltrados.length > recortes.length) ? 'flex' : 'none';

  contenedor.innerHTML = recortes.map((log, index) => {
    const visual = _visualLogAuditoria(log);
    const detalles = [
      log.entidad ? `Entidad: ${escapeHtml(log.entidad)}` : '',
      log.referencia ? `Ref: ${escapeHtml(log.referencia)}` : '',
      log.objetivo ? `Objetivo: ${escapeHtml(log.objetivo)}` : '',
      log.rolObjetivo ? `Rol: ${escapeHtml(log.rolObjetivo)}` : '',
      log.plazaObjetivo ? `Plaza: ${escapeHtml(log.plazaObjetivo)}` : '',
      log.resultado ? `Resultado: ${escapeHtml(log.resultado)}` : '',
      log.detalles ? escapeHtml(log.detalles) : ''
    ].filter(Boolean);
    const locationHtml = _logExactLocationHtml(log, true);
    const extraHtml = detalles.length
      ? `<div style="margin-top:10px; padding-top:10px; border-top:1px dashed #dbe4ee; color:#64748b; font-size:11px; line-height:1.5;">${detalles.join(' · ')}${locationHtml ? ` · ${locationHtml}` : ''}</div>`
      : (locationHtml ? `<div style="margin-top:10px; padding-top:10px; border-top:1px dashed #dbe4ee; color:#64748b; font-size:11px; line-height:1.5;">${locationHtml}</div>` : '');

    return `
      <div class="log-card" style="animation-delay: ${index * 0.03}s">
        <div class="log-card-header">
          <div>
            <div class="log-author">
              <span class="material-icons" style="font-size:16px;">account_circle</span>
              ${escapeHtml(log.autor || 'Sistema')}
            </div>
            <div class="log-date">${escapeHtml(log.fecha || '')}</div>
          </div>
          <div class="log-badge ${visual.colorClass}">${escapeHtml(log.tipo || 'INFO')}</div>
        </div>
        <div class="log-action-text" style="border-left-color: ${visual.borderLeft}">
          ${escapeHtml(log.accion || meta.emptyText)}
        </div>
        ${extraHtml}
      </div>
    `;
  }).join('');
}

function cargarMasLogs() {
  aud_paginaActual++;
  renderizarLogsAuditoria();
}



let currentFiltroEspecial = "TODOS";

// Función que se activa al tocar un chip
function filtrarEspecial(tipo, element) {
  currentFiltroEspecial = tipo; // Guarda el filtro solicitado (ej. "URGENTE")

  // Quita el color azul de todos los chips y se lo pone al que tocaste
  document.querySelectorAll('#chipContainer .chip').forEach(c => c.classList.remove('active'));
  if (element) element.classList.add('active');

  // Llama al motor principal para que redibuje la tabla
  filtrarFlota();
  _actualizarBatchBar(); // [2.5]
}

// [2.5] Batch action bar
function _actualizarBatchBar() {
  const bar = document.getElementById('batch-action-bar');
  const label = document.getElementById('batch-count-label');
  if (!bar) return;
  const filas = document.querySelectorAll('#tabla-flota tbody tr[data-mva]');
  const visible = filas.length;
  if (currentFiltroEspecial !== 'TODOS' && visible > 0) {
    bar.style.display = 'flex';
    if (label) label.textContent = `${visible} unidad${visible !== 1 ? 'es' : ''} filtradas`;
    const prog = document.getElementById('batch-progress-label');
    if (prog) prog.textContent = '';
    const sel = document.getElementById('batch-estado-select');
    if (sel) sel.value = '';
  } else {
    bar.style.display = 'none';
  }
}

async function ejecutarAccionBatch() {
  const sel = document.getElementById('batch-estado-select');
  const nuevoEstado = sel ? sel.value : '';
  if (!nuevoEstado) { showToast('Selecciona un estado para aplicar', 'warn'); return; }

  const filas = Array.from(document.querySelectorAll('#tabla-flota tbody tr[data-mva]'));
  if (!filas.length) { showToast('No hay unidades filtradas', 'warn'); return; }

  const ok = await showConfirmDialog(`¿Aplicar estado "${nuevoEstado}" a ${filas.length} unidad(es) filtradas?`);
  if (!ok) return;

  const prog = document.getElementById('batch-progress-label');
  const usuario = window._mex?.sesionActiva?.nombre || 'Batch';
  const plaza = _miPlaza();
  let done = 0, errores = 0;

  for (const fila of filas) {
    const mva = fila.dataset.mva;
    if (!mva) continue;
    // Find current unit data
    const unit = DB_FLOTA.find(u => u.mva === mva) || DB_ADMINS.find(u => u.mva === mva);
    if (!unit) { errores++; continue; }
    try {
      await window.api.aplicarEstado(mva, nuevoEstado, unit.ubicacion || 'PATIO', unit.gasolina || 'N/A', '', false, usuario, usuario, plaza);
      done++;
    } catch (e) {
      console.error('[batch]', mva, e);
      errores++;
    }
    if (prog) prog.textContent = `${done}/${filas.length}${errores ? ` (${errores} errores)` : ''}`;
  }
  showToast(`Batch completado: ${done} ok${errores ? `, ${errores} errores` : ''}`, errores ? 'warn' : 'ok');
}


// 🔥 EL GUARDIÁN CORREGIDO 🔥
function validarBotonGuardar() {
  const btn = document.getElementById('btnSaveFlota');
  if (!btn) return;

  const mva = document.getElementById('f_mva').value.trim();
  const est = document.getElementById('f_est').value.trim();
  const gas = document.getElementById('f_gas').value.trim();
  const ubi = document.getElementById('f_ubi').value.trim();
  const not = document.getElementById('f_not').value.trim();
  const delNote = document.getElementById('f_del_note') ? document.getElementById('f_del_note').checked : false;

  let habilitar = false;

  if (MODO_FLOTA === "INSERTAR") {
    // 🚨 CORRECCIÓN: Ya no obligamos a que Gasolina sea diferente de "N/A"
    if (mva !== "" && est !== "" && ubi !== "") {
      habilitar = true;
    }
  }
  else if (MODO_FLOTA === "MODIFICAR" && SELECT_REF_FLOTA) {
    const estOriginal = String(SELECT_REF_FLOTA.estado || "").trim();
    const gasOriginal = String(SELECT_REF_FLOTA.gasolina || "N/A").trim();
    const ubiOriginal = String(SELECT_REF_FLOTA.ubicacion || "").trim();
    const notOriginal = String(SELECT_REF_FLOTA.notas || "").trim();

    const hayCambios = (
      est !== estOriginal ||
      gas !== gasOriginal ||
      ubi !== ubiOriginal ||
      not !== notOriginal ||
      delNote === true
    );

    // 🚨 CORRECCIÓN: Si hay cambios, solo validamos que Estado y Ubicación no estén vacíos
    if (hayCambios && est !== "" && ubi !== "") {
      habilitar = true;
    }
  }

  if (habilitar) {
    btn.disabled = false;
    btn.style.opacity = "1";
    btn.style.cursor = "pointer";
  } else {
    btn.disabled = true;
    btn.style.opacity = "0.4";
    btn.style.cursor = "not-allowed";
  }
}

// 🔌 CONECTAR LOS SENSORES A LOS CAMPOS AL INICIAR
document.addEventListener("DOMContentLoaded", () => {
  ['f_est', 'f_gas', 'f_ubi'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', validarBotonGuardar);
  });

  const fNot = document.getElementById('f_not');
  if (fNot) fNot.addEventListener('input', validarBotonGuardar); // Se activa al teclear

  const fDelNote = document.getElementById('f_del_note');
  if (fDelNote) fDelNote.addEventListener('change', validarBotonGuardar);
});



let estadoLockLocal = false;
let estadoLockGlobal = false;

async function _elegirAlcanceBloqueoMapa(nuevoEstado) {
  const plazaActual = (_miPlaza() || 'ACTUAL').toUpperCase();

  if (!nuevoEstado) {
    if (estadoLockGlobal && estadoLockLocal) {
      return mexDialog({
        titulo: 'Liberar patio',
        texto: `Hay un bloqueo GLOBAL y otro en la plaza ${plazaActual}. Elige cuál quieres liberar.`,
        tipo: 'warning',
        btnConfirmar: `PLAZA ${plazaActual}`,
        btnExtra: 'GLOBAL',
        btnCancelar: 'CANCELAR',
        valorConfirmar: 'PLAZA',
        valorExtra: 'GLOBAL',
        valorCancelar: null
      });
    }
    if (estadoLockGlobal) return 'GLOBAL';
    return 'PLAZA';
  }

  return mexDialog({
    titulo: 'Bloquear patio',
    texto: `Selecciona el alcance del bloqueo.\n\nPLAZA ${plazaActual}: solo el patio que estás viendo.\nGLOBAL: bloquea todas las plazas al mismo tiempo desde settings/GLOBAL.`,
    tipo: 'warning',
    btnConfirmar: `PLAZA ${plazaActual}`,
    btnExtra: 'GLOBAL',
    btnCancelar: 'CANCELAR',
    valorConfirmar: 'PLAZA',
    valorExtra: 'GLOBAL',
    valorCancelar: null
  });
}

async function solicitarToggleBloqueo() {
  console.log('[DEBUG] solicitarToggleBloqueo', { canLock: canLockMap(), role: userAccessRole });
  if (!canLockMap()) {
    console.warn('[DEBUG] canLockMap=false, rol:', userAccessRole);
    showToast("🚫 Solo los roles con acceso total pueden bloquear el patio.", "error");
    return;
  }

  const nuevo = !window.MAPA_LOCKED;
  const scope = await _elegirAlcanceBloqueoMapa(nuevo);
  if (!scope) return;
  const plazaActual = (_miPlaza() || 'ACTUAL').toUpperCase();
  const scopeLabel = scope === 'GLOBAL' ? 'todas las plazas' : `la plaza ${plazaActual}`;
  const msj = nuevo
    ? `¿Bloquear todos los movimientos en ${scopeLabel}?`
    : `¿Liberar el mapa para movimientos en ${scopeLabel}?`;

  const ok = await mexConfirm(
    nuevo ? (scope === 'GLOBAL' ? 'Bloquear global' : 'Bloquear plaza') : (scope === 'GLOBAL' ? 'Liberar global' : 'Liberar plaza'),
    msj,
    'warning'
  );
  if (!ok) return;

  showToast(
    nuevo
      ? (scope === 'GLOBAL' ? "Congelando todas las plazas..." : `Congelando plaza ${plazaActual}...`)
      : (scope === 'GLOBAL' ? "Liberando bloqueo global..." : `Liberando plaza ${plazaActual}...`),
    "warning"
  );
  api.toggleBloqueoMapa(nuevo, USER_NAME, _miPlaza(), scope).then(() => {
    showToast(
      nuevo
        ? (scope === 'GLOBAL' ? "Bloqueo global activado" : `Plaza ${plazaActual} bloqueada`)
        : (scope === 'GLOBAL' ? "Bloqueo global liberado" : `Plaza ${plazaActual} disponible`),
      "success"
    );
    hacerPingNotificaciones();
  }).catch(e => console.error(e));
}


async function ejecutarSelloCuadre() {
  const modal = document.getElementById('modalSellarCuadre');
  modal.style.display = 'none'; // Escondemos el modal para que no salga en la foto

  showToast("Capturando mapa y enviando reporte...", "info");

  try {
    const gridMap = document.getElementById('grid-map');

    // 1. Tomamos la "foto" del mapa
    const canvas = await html2canvas(gridMap, {
      backgroundColor: "#2A3441",
      scale: 1, // Calidad normal para que el correo no pese demasiado
      useCORS: true
    });
    const base64Image = canvas.toDataURL("image/png");

    // 2. Recopilamos los números actuales del tablero
    const stats = {
      total: document.getElementById('kpi-total').innerText,
      listos: document.getElementById('kpi-listos').innerText,
      taller: document.getElementById('kpi-taller-loc').innerText
    };

    // 3. Mandamos TODO a Google Sheets (Sello + Correo)
    api.registrarCierreCuadre(USER_NAME).then(res => {
      if (res === "EXITO") {
        showToast("¡Cuadre validado y correo enviado!", "success");
        hacerPingNotificaciones();
      } else {
        showToast("Error: " + res, "error");
      }
    }).catch(err => showToast("Fallo de red", "error"));

    // 4. Mandamos el correo (Función asíncrona de fondo)
    api.enviarReporteCuadreEmail(base64Image, USER_NAME, stats).catch(e => console.error(e));

  } catch (err) {
    console.error("Error en captura:", err);
    showToast("Error al generar reporte visual", "error");
  }
}

async function ejecutarLimpiarFeed() {
  const ok = await mexConfirm(
    'Limpiar feed global',
    '¿Deseas limpiar los globos de actividad para todos?',
    'warning'
  );
  if (!ok) return;

  showToast("Limpiando feed...", "info");
  api.limpiarFeedGlobal().then(() => {
    showToast("Feed vaciado", "success");
    hacerPingNotificaciones(); // Para que desaparezcan de tu pantalla rápido
  }).catch(e => console.error(e));
}


// 🔥 FASE 3V: PREPARACIÓN DEL MODAL
function abrirModalCuadre3V() {
  // 1. Cargamos los datos actuales de los KPIs para el Paso 1
  document.getElementById('v3-listos').innerText = document.getElementById('kpi-listos').innerText;
  document.getElementById('v3-sucios').innerText = document.getElementById('kpi-sucios').innerText;
  document.getElementById('v3-taller').innerText = document.getElementById('kpi-taller-loc').innerText;
  document.getElementById('v3-total').innerText = document.getElementById('kpi-total').innerText;

  // 2. Resetear visualmente el modal al Paso 1
  document.getElementById('paso1-ui').style.display = 'block';
  document.getElementById('paso2-ui').style.display = 'none';
  document.getElementById('paso3-ui').style.display = 'none';

  // Colores de los círculos de progreso
  document.getElementById('step1-dot').style.background = 'var(--mex-blue)';
  document.getElementById('step2-dot').style.background = '#e2e8f0';
  document.getElementById('step3-dot').style.background = '#e2e8f0';

  // Abrir el modal
  document.getElementById('modal-cuadre-3v').classList.add('active');
}

// Lógica para avanzar al Paso 2 (Captura)
function irAPaso2() {
  document.getElementById('paso1-ui').style.display = 'none';
  document.getElementById('paso2-ui').style.display = 'block';
  document.getElementById('step2-dot').style.background = 'var(--mex-blue)';
  document.getElementById('step2-dot').style.color = 'white';
}

// Cerrar el modal manualmente
function cerrarCuadre3V() {
  document.getElementById('modal-cuadre-3v').classList.remove('active');
  EVIDENCIA_V3 = null; // Limpiar memoria de imagen
}

let EVIDENCIA_V3 = null; // Variable global para la foto

async function ejecutarCapturaV3() {
  const btn = document.getElementById('btnCapturarV3');
  btn.disabled = true;
  btn.innerHTML = `<span class="material-icons spinner">sync</span> CAPTURANDO MAPA...`;

  try {
    const gridMap = document.getElementById('grid-map');
    // Tomamos la captura HD
    const canvas = await html2canvas(gridMap, { backgroundColor: "#2A3441", scale: 1, useCORS: true });
    EVIDENCIA_V3 = canvas.toDataURL("image/png");

    // Mostrar miniatura en el modal
    document.getElementById('preview-photo').innerHTML = `<img src="${EVIDENCIA_V3}" style="width:100%; height:100%; object-fit:cover;">`;

    // Avanzar al Paso 3 automáticamente tras 1 segundo
    setTimeout(() => {
      document.getElementById('paso2-ui').style.display = 'none';
      document.getElementById('paso3-ui').style.display = 'block';
      document.getElementById('v3-firma-nombre').innerText = USER_NAME;
      document.getElementById('step3-dot').style.background = '#10b981';
      document.getElementById('step3-dot').style.color = 'white';
    }, 1000);

  } catch (e) {
    showToast("Error en cámara virtual", "error");
    btn.disabled = false;
    btn.innerText = "REINTENTAR CAPTURA";
  }
}

function finalizarCuadre3V() {
  showToast("Sellando inventario y notificando...", "info");

  const stats = {
    total: document.getElementById('v3-total').innerText,
    listos: document.getElementById('v3-listos').innerText,
    taller: document.getElementById('v3-taller').innerText
  };

  // 1. Mandamos el sello final al servidor para liberar F2/F3
  api.finalizarProtocoloV3(USER_NAME, _miPlaza()).then(res => {
    showToast("¡CUADRE CERTIFICADO!", "success");
    cerrarCuadre3V();
    hacerPingNotificaciones(); // Actualiza el botón del sidebar para todos
  }).catch(e => console.error(e));

  // 2. Enviamos el reporte por Email de fondo
  api.enviarReporteCuadreEmail(EVIDENCIA_V3, USER_NAME, stats).catch(e => console.error(e));
}




// ==========================================
// --- MOTOR DE LECTURA DE ARCHIVOS BLINDADO (V2) ---
// ==========================================
window.UNIDADES_SISTEMA_CORPORATIVO = [];

window.procesarDropSeguro = function (e) {
  if (e.dataTransfer && e.dataTransfer.files.length > 0) {
    document.getElementById('csvFileInput').files = e.dataTransfer.files;
    window.ejecutarLectorCSV(e.dataTransfer.files[0]);
  }
};

window.procesarInputSeguro = function (input) {
  if (input.files && input.files.length > 0) {
    window.ejecutarLectorCSV(input.files[0]);
  }
};

window.ejecutarLectorCSV = function (file) {
  try {
    document.getElementById('upload-icon').innerText = "hourglass_empty";
    document.getElementById('upload-icon').classList.add('spinner');
    document.getElementById('upload-text').innerText = "Organizando columnas...";

    const notificar = (msg, tipo) => showToast(msg, tipo || 'error');

    const reader = new FileReader();

    reader.onload = function (e) {
      try {
        const text = e.target.result;
        const rows = text.split(/\r?\n/);

        if (rows.length < 2) return notificar("El archivo está vacío", "error");

        let mvaCol = -1, placaCol = -1, modCol = -1;
        let startRow = -1;
        let separador = ',';

        // 1. Buscar los encabezados en las primeras 20 filas
        for (let i = 0; i < Math.min(20, rows.length); i++) {
          let rowText = rows[i];

          // Detectar si Excel lo guardó con punto y coma (;) o coma (,)
          if (rowText.indexOf(';') > -1 && rowText.split(';').length > rowText.split(',').length) {
            separador = ';';
          }

          // Separar la fila en celdas limpias
          let cells = rowText.split(new RegExp(`${separador}(?=(?:(?:[^"]*"){2})*[^"]*$)`))
            .map(c => c.replace(/^"|"$/g, '').trim().toUpperCase());

          // Buscar en cada celda las palabras clave (quitando acentos para asegurar)
          for (let j = 0; j < cells.length; j++) {
            let cell = cells[j];
            let normalCell = cell.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            // 🔥 CORRECCIÓN: Agregamos "=== -1" para que SOLO tome la PRIMERA
            // coincidencia y no la sobreescriba con "Entidad Federativa de la Placa"
            if (mvaCol === -1 && (normalCell.includes('MVA') || normalCell.includes('ECONOMICO') || normalCell.includes('ECO'))) mvaCol = j;
            if (placaCol === -1 && normalCell.includes('PLACA')) placaCol = j;
            if (modCol === -1 && (normalCell.includes('MODELO') || normalCell.includes('VEHICULO'))) modCol = j;
          }

          // Si encontró la columna del Económico, marcamos esta fila como el Inicio y rompemos el ciclo
          if (mvaCol !== -1) {
            startRow = i + 1; // Los autos empiezan una fila abajo de los encabezados
            break;
          }
        }

        let unidadesExtraidas = [];
        const mvaRegexEstricto = /^[A-Z]{1,2}\d{3,4}$/i;

        // 2. Extraer la data estructurada
        if (startRow !== -1) {
          for (let i = startRow; i < rows.length; i++) {
            if (!rows[i].trim()) continue;

            let cells = rows[i].split(new RegExp(`${separador}(?=(?:(?:[^"]*"){2})*[^"]*$)`))
              .map(c => c.replace(/^"|"$/g, '').trim());

            let mva = (cells[mvaCol] || "").toUpperCase().replace(/\s/g, '');
            let placas = placaCol !== -1 ? (cells[placaCol] || "S/P").toUpperCase() : "S/P";
            let modelo = modCol !== -1 ? (cells[modCol] || "S/M").toUpperCase() : "S/M";

            // Si el MVA es válido (ej. C2871)
            if (mva && mvaRegexEstricto.test(mva)) {
              // Evitar meter el mismo auto dos veces
              if (!unidadesExtraidas.find(u => u.mva === mva)) {
                unidadesExtraidas.push({ mva: mva, placas: placas, modelo: modelo });
              }
            }
          }
        }

        window.UNIDADES_SISTEMA_CORPORATIVO = unidadesExtraidas;
        document.getElementById('upload-icon').classList.remove('spinner');

        if (unidadesExtraidas.length === 0) {
          document.getElementById('upload-icon').innerText = "error_outline";
          document.getElementById('upload-icon').style.color = "#ef4444";
          document.getElementById('upload-text').innerText = "Columnas no encontradas";
          return notificar("No se pudo estructurar el archivo CSV.", "error");
        }

        // Actualizar la vista a Éxito
        document.getElementById('upload-icon').innerText = "check_circle";
        document.getElementById('upload-icon').style.color = "#10b981";
        document.getElementById('upload-text').innerText = "¡Lectura estructurada exitosa!";

        document.getElementById('csv-count').innerText = unidadesExtraidas.length;
        document.getElementById('csv-preview-info').style.display = 'block';

        const btn = document.getElementById('btnIniciarMision');
        btn.disabled = false;
        btn.style.opacity = '1';

        notificar("Base corporativa cargada", "success");
        console.log("LISTA LIMPIA Y ESTRUCTURADA:", window.UNIDADES_SISTEMA_CORPORATIVO);

      } catch (err) {
        console.error("Error estructurando Arrays del CSV:", err);
        notificar("Error al estructurar las columnas", "error");
        document.getElementById('upload-icon').innerText = "warning";
        document.getElementById('upload-icon').classList.remove('spinner');
      } finally {
        document.getElementById('csvFileInput').value = "";
      }
    };

    reader.onerror = function () {
      notificar("El navegador bloqueó la lectura", "error");
      document.getElementById('upload-icon').innerText = "warning";
      document.getElementById('upload-icon').classList.remove('spinner');
    };

    // Usamos ISO-8859-1 para respetar la 'ñ' y acentos típicos de Excel en español
    reader.readAsText(file, 'ISO-8859-1');

  } catch (err) {
    console.error("Error crítico:", err);
  }
};







// ==========================================
// --- FLUJO DE AUDITORÍA: AUXILIAR Y ADMIN ---
// ==========================================
window.AUDIT_LIST = [];

// ==========================================
// 📋 MOTOR DE AUDITORÍA (LISTA PURA)
// ==========================================
// ==========================================
// 📋 MOTOR DE AUDITORÍA (LISTA PURA Y ESTABLE)
// ==========================================

function _renderAuditCard(u) {
  const statusClass = u.status === 'OK'      ? 'audit-card--ok'
                    : u.status === 'FALTANTE' ? 'audit-card--faltante'
                    : u.status === 'EXTRA'    ? 'audit-card--extra'
                    : '';

  const btnCrossClass = u.status === 'FALTANTE' ? 'audit-btn-action--active-faltante' : '';
  const btnCheckClass = u.status === 'OK'       ? 'audit-btn-action--active-ok'
                      : u.status === 'EXTRA'    ? 'audit-btn-action--active-extra-ok'
                      : '';

  return `
    <div class="audit-card ${statusClass}">
      <div class="audit-card-info">
        <h3 class="audit-card-mva">${u.mva}</h3>
        <span class="audit-card-meta">${u.modelo} &bull; ${u.placas}</span>
        ${u.status === 'EXTRA' ? '<span class="audit-card-extra-badge">&#9888; SOBRANTE</span>' : ''}
      </div>
      <div class="audit-card-actions">
        <button class="audit-btn-action ${btnCrossClass}" onclick="marcarUnidadAudit('${u.mva}', 'FALTANTE')" title="Marcar faltante">
          <span class="material-icons">close</span>
        </button>
        <button class="audit-btn-action ${btnCheckClass}" onclick="marcarUnidadAudit('${u.mva}', 'OK')" title="Marcar presente">
          <span class="material-icons">check</span>
        </button>
      </div>
    </div>
  `;
}

function renderizarPaseLista() {
  const container = document.getElementById('audit-list-container');
  if (!container) return;

  const inputSearch = document.getElementById('audit-search');
  const term = inputSearch ? inputSearch.value.toUpperCase().trim() : "";

  // 1. Progreso
  const total = window.AUDIT_LIST.length;
  const pendientes = window.AUDIT_LIST.filter(u => u.status === 'PENDIENTE').length;
  const revisadas = total - pendientes;
  const pct = total > 0 ? Math.round((revisadas / total) * 100) : 0;

  const progress = document.getElementById('audit-progress');
  if (progress) progress.innerText = `${revisadas} / ${total} REVISADAS`;

  const fill = document.getElementById('audit-progress-fill');
  if (fill) fill.style.width = `${pct}%`;

  // 2. Botón finalizar
  const btnFinalizar = document.getElementById('btnFinalizarAudit');
  if (btnFinalizar) {
    const listo = pendientes === 0 && total > 0;
    btnFinalizar.disabled = !listo;
    btnFinalizar.style.background = listo ? "#10b981" : "#cbd5e1";
    btnFinalizar.style.cursor = listo ? "pointer" : "not-allowed";
  }

  // 3. Filtrar
  const filtradas = window.AUDIT_LIST.filter(u => {
    if (term === "") return true;
    return u.mva.includes(term) || (u.placas && u.placas.includes(term)) || (u.modelo && u.modelo.includes(term));
  });

  if (filtradas.length === 0) {
    container.innerHTML = `<div class="audit-empty-msg">Sin coincidencias para "${term}".</div>`;
    return;
  }

  // 4. Separar por sección y renderizar con dividers
  const pendientesList = filtradas.filter(u => u.status === 'PENDIENTE');
  const revisadasList  = filtradas.filter(u => u.status !== 'PENDIENTE');

  let html = '';

  if (pendientesList.length > 0) {
    if (term === "") html += `<div class="audit-section-label">Pendientes (${pendientesList.length})</div>`;
    html += pendientesList.map(_renderAuditCard).join('');
  }

  if (revisadasList.length > 0) {
    if (term === "") html += `<div class="audit-section-label">Revisadas (${revisadasList.length})</div>`;
    html += revisadasList.map(_renderAuditCard).join('');
  }

  container.innerHTML = html;
}

function marcarUnidadAudit(mva, status) {
  const index = window.AUDIT_LIST.findIndex(u => u.mva === mva);
  if (index !== -1) {
    // Si agregó un sobrante por error y le da a la "X", lo borramos de la lista
    if (window.AUDIT_LIST[index].status === 'EXTRA' && status === 'FALTANTE') {
      window.AUDIT_LIST.splice(index, 1);
    }
    // Si toca el MISMO botón que ya estaba marcado (Ej. estaba en OK y le vuelve a dar OK), lo desmarca
    else if (window.AUDIT_LIST[index].status === status) {
      window.AUDIT_LIST[index].status = 'PENDIENTE';
    }
    // Aplica la decisión normal (Falta o Está)
    else {
      window.AUDIT_LIST[index].status = status;
    }

    // Cerramos el teclado del celular para que pueda seguir scrolleando
    const searchInput = document.getElementById('audit-search');
    if (searchInput) searchInput.value = "";
    document.activeElement.blur();

    // Renderizamos al instante
    renderizarPaseLista();
  }
}


// 📱 MODAL PERSONALIZADO PARA EXTRA
function agregarUnidadExtra() {
  // Limpiamos los 3 campos cada vez que se abre el modal
  document.getElementById('inputExtraMva').value = "";
  document.getElementById('inputExtraModelo').value = "";
  document.getElementById('inputExtraPlacas').value = "";

  document.getElementById('modalAddExtra').classList.add('active');
  setTimeout(() => document.getElementById('inputExtraMva').focus(), 100);
}

function procesarUnidadExtra() {
  const mvaClean = document.getElementById('inputExtraMva').value.toUpperCase().trim().replace(/\s/g, '');
  const modeloClean = document.getElementById('inputExtraModelo').value.toUpperCase().trim();
  let placasClean = document.getElementById('inputExtraPlacas').value.toUpperCase().trim();

  // Validaciones obligatorias
  if (!mvaClean) {
    showToast("El MVA es obligatorio", "error");
    document.getElementById('inputExtraMva').focus();
    return;
  }
  if (!modeloClean) {
    showToast("Debes ingresar el modelo", "error");
    document.getElementById('inputExtraModelo').focus();
    return;
  }

  // Si no pusieron placas (unidades retenidas, etc), le ponemos S/P para que no se rompa nada
  if (!placasClean) {
    placasClean = "S/P";
  }

  if (window.AUDIT_LIST.find(u => u.mva === mvaClean)) {
    showToast("¡Cuidado! Esta unidad SÍ estaba en el Excel.", "warning");
    document.getElementById('audit-search').value = mvaClean;
    document.getElementById('modalAddExtra').classList.remove('active');
  } else {
    // Registramos la unidad con los datos reales que escribió el auxiliar
    window.AUDIT_LIST.push({ mva: mvaClean, placas: placasClean, modelo: modeloClean, status: 'EXTRA' });
    document.getElementById('audit-search').value = mvaClean;
    showToast("Sobrante agregado", "success");
    document.getElementById('modalAddExtra').classList.remove('active');
  }

  renderizarPaseLista();
}

function finalizarPaseLista() {
  const pendientes = window.AUDIT_LIST.filter(u => u.status === 'PENDIENTE');
  if (pendientes.length > 0) {
    mostrarCustomModal("Aviso de Pendientes", `Tienes ${pendientes.length} unidades sin revisar.\nSe marcarán como FALTANTES automáticamente. ¿Continuar?`, "warning", "#f59e0b", "CONTINUAR", "#f59e0b", () => {
      window.AUDIT_LIST.forEach(u => { if (u.status === 'PENDIENTE') u.status = 'FALTANTE'; });
      llamarAlJuezDeAuditoria();
    });
    return;
  }
  llamarAlJuezDeAuditoria();
}

function llamarAlJuezDeAuditoria() {
  document.getElementById('audit-paso2').style.display = 'none';
  document.getElementById('audit-paso3').style.display = 'block';

  document.getElementById('res-faltantes-count').innerText = window.AUDIT_LIST.filter(u => u.status === 'FALTANTE').length;
  document.getElementById('res-extras-count').innerText = window.AUDIT_LIST.filter(u => u.status === 'EXTRA').length;
  document.getElementById('res-ok-count').innerText = window.AUDIT_LIST.filter(u => u.status === 'OK').length;

  const btn = document.getElementById('btnCertificarFinal');

  // Cambiamos el diseño del botón según quién esté operando
  if (userRole === 'admin') {
    btn.innerHTML = `<span class="material-icons">picture_as_pdf</span> VALIDAR Y GENERAR REPORTE`;
    btn.style.background = "#0284c7"; // Azul corporativo
  } else {
    btn.innerHTML = `<span class="material-icons">send</span> ENVIAR REPORTE A VENTAS`;
    btn.style.background = "#1e293b"; // Negro elegante
  }
}

// 📱 COMPARTIR POR WHATSAPP AL TERMINAR
function compartirWhatsApp() {
  const oks = document.getElementById('res-ok-count').innerText;
  const faltantes = document.getElementById('res-faltantes-count').innerText;
  const extras = document.getElementById('res-extras-count').innerText;

  const texto = `✅ *CUADRE DE FLOTA LISTO*\nEl auxiliar *${USER_NAME}* ha finalizado el escaneo físico en patio.\n\n📊 *Resumen Previo:*\n✔️ Cuadrados: ${oks}\n⚠️ Sobrantes: ${extras}\n🚨 Faltantes: ${faltantes}\n\n👉 El Admin de Ventas ya puede *FINALIZAR CUADRE* en el sistema para asentar los datos y generar el PDF.`;

  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
}

// ☁️ EL AUXILIAR O EL ADMIN MANDAN EL REPORTE (SIN ALERTS NATIVOS)
function enviarReporteAuditoriaFinal() {
  const btn = document.getElementById('btnCertificarFinal');

  if (userRole === 'admin') {
    // 👑 MODAL HTML PARA EL ADMIN
    mostrarCustomModal(
      "Certificar Inventario",
      "¿Estás seguro de certificar las correcciones? Se generará el PDF oficial y se enviará la Auditoría Nocturna por correo.",
      "verified", "#0284c7", "CERTIFICAR Y ENVIAR", "#0284c7",
      () => {
        btn.disabled = true;
        btn.innerHTML = `<span class="material-icons spinner">sync</span> PROCESANDO AUDITORÍA...`;

        // 🔥 SÚPER IMPORTANTE: Armamos los stats para mandarlos al Backend
        const stats = {
          total: document.getElementById('kpi-total').innerText,
          listos: document.getElementById('kpi-listos').innerText,
          taller: document.getElementById('kpi-taller-loc').innerText
        };

        api.procesarAuditoriaDesdeAdmin(window.AUDIT_LIST, USER_NAME, stats, _miPlaza()).then(res => {
          document.getElementById('audit-modal').classList.remove('active');

          // 🚨 REVISAMOS EL VEREDICTO DEL SERVIDOR 🚨
          if (res === "EXITO") {
            showToast("¡Auditoría finalizada y Correo Enviado!", "success");
          }
          else if (res === "EXITO_SIN_CORREO") {
            showToast("✅ PDF creado, pero la celda B6 (Correos) está vacía.", "warning");
          }
          else if (res && res.toString().startsWith("ERROR_CORREO")) {
            showToast("❌ PDF creado, pero el correo falló: Revisa la celda B6.", "error");
            console.error("Motivo del fallo:", res);
          }
          else {
            showToast("Error: " + res, "error");
          }

          setTimeout(() => {
            document.getElementById('audit-paso3').style.display = 'none';
            document.getElementById('audit-paso1').style.display = 'block';
            btn.disabled = false;
          }, 1000);
          hacerPingNotificaciones();
        }).catch(err => {
          showToast("Fallo de red o servidor", "error");
          btn.disabled = false;
          btn.innerHTML = `<span class="material-icons">picture_as_pdf</span> REINTENTAR`;
        });
      }
    );
  } else {
    // 👷 MODAL HTML PARA EL AUXILIAR
    mostrarCustomModal(
      "Enviar a Ventas",
      "¿Terminaste el escaneo en el patio? Se enviará a Ventas para la revisión final.",
      "send", "#10b981", "ENVIAR REPORTE", "#10b981",
      () => {
        const auditoriaPayload = Array.isArray(window.AUDIT_LIST) ? window.AUDIT_LIST : [];
        if (!auditoriaPayload.length) {
          showToast("No hay datos de auditoría para enviar.", "error");
          return;
        }
        btn.disabled = true;
        btn.innerHTML = `<span class="material-icons spinner">sync</span> ENVIANDO REPORTE...`;

        const _resetEnviarBtn = () => {
          btn.disabled = false;
          btn.innerHTML = `<span class="material-icons">send</span> ENVIAR REPORTE`;
        };

        // Timeout de 30s para no dejar el botón congelado si la Cloud Function falla
        const _enviarTimeout = setTimeout(() => {
          _resetEnviarBtn();
          showToast("Tiempo de espera agotado. Verifica tu conexión e intenta de nuevo.", "error");
        }, 30000);

        api.enviarAuditoriaAVentas(auditoriaPayload, USER_NAME, _miPlaza()).then(async res => {
          clearTimeout(_enviarTimeout);
          if (res && res.exito) {
            let confirmacionPersistencia = true;
            try {
              const revision = await api.obtenerRevisionAuditoria(_miPlaza());
              confirmacionPersistencia = Array.isArray(revision) && revision.length > 0;
            } catch (error) {
              confirmacionPersistencia = false;
              console.warn('No se pudo confirmar persistencia de auditoría en revisión:', error);
            }
            document.getElementById('audit-modal').classList.remove('active');
            showToast(
              confirmacionPersistencia
                ? "Auditoría enviada a Ventas. ¡Buen trabajo!"
                : "Auditoría enviada, pero sin confirmación inmediata. Revisa en unos segundos.",
              confirmacionPersistencia ? "success" : "warning"
            );
            setTimeout(compartirWhatsApp, 1000);
            setTimeout(() => {
              document.getElementById('audit-paso3').style.display = 'none';
              document.getElementById('audit-paso1').style.display = 'block';
              _resetEnviarBtn();
              hacerPingNotificaciones();
            }, 1000);
          } else {
            clearTimeout(_enviarTimeout);
            _resetEnviarBtn();
            showToast("Error al enviar. Intenta de nuevo.", "error");
          }
        }).catch(err => {
          clearTimeout(_enviarTimeout);
          _resetEnviarBtn();
          const msg = err?.code === 'permission-denied'
            ? "Sin permisos para enviar. Contacta al administrador."
            : "Error de red: " + (err?.message || err);
          showToast(msg, "error");
          console.error("[enviarAuditoria]", err);
        });
      }
    );
  }
}



// 👑 ADMIN Y AUXILIAR: EL BOTÓN MÁGICO DE FLUJO
function manejadorFlujoV3() {
  const estadoActual = document.getElementById('txtV3').innerText;

  if (userRole === 'admin' && estadoActual === "INICIAR CUADRE (ADMIN)") {
    toggleAdminSidebar(false);
    document.getElementById('audit-modal').classList.add('active');
    document.getElementById('audit-paso1').style.display = 'block';
    document.getElementById('audit-paso2').style.display = 'none';
    document.getElementById('audit-paso3').style.display = 'none';
    window.UNIDADES_SISTEMA_CORPORATIVO = [];
  }
  else if (userRole === 'admin' && estadoActual === "FINALIZAR CUADRE") {
    // 🔥 EL ADMIN DESCARGA LA REVISIÓN DEL AUXILIAR Y LA ABRE EN SU PANTALLA
    toggleAdminSidebar(false);
    showToast("Descargando revisión del patio...", "info");

    api.obtenerRevisionAuditoria(_miPlaza()).then(mision => {
      hacerPingNotificaciones();
      if (mision && mision.length > 0) {
        window.AUDIT_LIST = mision; // Carga los estados (OK, FALTANTE, etc.) que puso el auxiliar

        document.getElementById('audit-modal').classList.add('active');
        document.getElementById('audit-paso1').style.display = 'none';
        document.getElementById('audit-paso2').style.display = 'flex';
        document.getElementById('audit-paso3').style.display = 'none';

        // Le avisa visualmente al Admin que está en modo revisión
        document.querySelector('#audit-paso2 h3').innerHTML = '<span class="material-icons">admin_panel_settings</span> REVISIÓN DE ADMINISTRADOR';

        renderizarPaseLista();
      } else {
        showToast("No hay datos del auxiliar.", "error");
      }
    }).catch(e => console.error(e));
  }
  else if (userRole !== 'admin' && estadoActual === "VERIFICAR INVENTARIO") {
    // 👷 EL AUXILIAR DESCARGA LA MISIÓN
    toggleAdminSidebar(false);
    showToast("Descargando misión...", "info");

    api.obtenerMisionAuditoria(_miPlaza()).then(mision => {
      hacerPingNotificaciones();
      if (mision && mision.length > 0) {
        window.UNIDADES_SISTEMA_CORPORATIVO = mision;
        window.AUDIT_LIST = window.UNIDADES_SISTEMA_CORPORATIVO.map(u => ({ mva: u.mva, placas: u.placas, modelo: u.modelo, status: 'PENDIENTE' }));

        document.getElementById('audit-modal').classList.add('active');
        document.getElementById('audit-paso1').style.display = 'none';
        document.getElementById('audit-paso2').style.display = 'flex';
        document.getElementById('audit-paso3').style.display = 'none';
        renderizarPaseLista();
      } else showToast("La misión está vacía.", "error");
    }).catch(e => console.error(e));
  }
}
// ⚡ EL ADMIN SUBE CSV Y ENVÍA MISIÓN
function iniciarMisionAuditoria() {
  const btn = document.getElementById('btnIniciarMision');
  btn.disabled = true; btn.innerHTML = `<span class="material-icons spinner">sync</span> DESPLEGANDO AL PATIO...`;

  api.iniciarProtocoloDesdeAdmin(USER_NAME, JSON.stringify(window.UNIDADES_SISTEMA_CORPORATIVO), _miPlaza()).then(res => {
    showToast("¡Misión enviada al celular del patio! 📡", "success");
    document.getElementById('audit-modal').classList.remove('active');
    hacerPingNotificaciones();
    btn.innerHTML = `INICIAR MISIÓN DE AUDITORÍA`;
  }).catch(e => console.error(e));
}

// 🗄️ ABRIR EL ARCHIVERO DE CUADRES
let globalHistorialAuditorias = [];

function abrirHistorialCuadres() {
  toggleAdminSidebar(false);
  document.getElementById('historial-cuadres-modal').classList.add('active');
  const container = document.getElementById('lista-historial-cuadres');
  container.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b;"><span class="material-icons spinner">sync</span> Buscando en los archivos...</div>`;

  api.obtenerHistorialCuadres(_miPlaza()).then(data => {
    globalHistorialAuditorias = data || [];
    // Llenar select de autores
    const autorSelect = document.getElementById('filtroAutorArchivero');
    if (autorSelect) {
      const autores = [...new Set(data.flatMap(c => [c.auxiliar, c.admin].filter(Boolean)))].sort();
      autorSelect.innerHTML = '<option value="">Todos los autores</option>' +
        autores.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    }
    renderHistorialCuadres();
  }).catch(e => console.error(e));
}

// Convierte URL de Google Drive share a URL de embed iframe
function _toDriveEmbedUrl(url) {
  if (!url) return '';
  const m = url.match(/\/file\/d\/([^/?#]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  return url; // Firebase Storage URL u otra — usar directamente
}

function limpiarFiltrosArchivero() {
  const buscador = document.getElementById('buscadorArchivero');
  const fecha = document.getElementById('filtroFechaArchivero');
  const autor = document.getElementById('filtroAutorArchivero');
  if (buscador) buscador.value = '';
  if (fecha) fecha.value = '';
  if (autor) autor.value = '';
  renderHistorialCuadres();
}

function toggleIframe(id) {
  const el = document.getElementById(id);
  if (el.style.display === 'none') { el.style.display = 'block'; }
  else { el.style.display = 'none'; }
}

function renderHistorialCuadres() {
  const container = document.getElementById('lista-historial-cuadres');
  const query = (document.getElementById('buscadorArchivero')?.value || "").toLowerCase().trim();
  const fechaFiltro = (document.getElementById('filtroFechaArchivero')?.value || "").trim(); // "YYYY-MM-DD"
  const autorFiltro = (document.getElementById('filtroAutorArchivero')?.value || "").toLowerCase().trim();

  let filtered = globalHistorialAuditorias;

  if (query) {
    filtered = filtered.filter(c =>
      String(c.auxiliar || "").toLowerCase().includes(query) ||
      String(c.admin || "").toLowerCase().includes(query) ||
      String(c.fecha || "").toLowerCase().includes(query)
    );
  }

  if (fechaFiltro) {
    // c.fecha may be "27/3/2026" or "2026-03-27 14:00" — try to match date
    filtered = filtered.filter(c => {
      const f = String(c.fecha || '');
      // Normalize to "YYYY-MM-DD" for comparison
      const parts = f.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (parts) {
        const yr = parts[3].length === 2 ? '20' + parts[3] : parts[3];
        const mn = parts[2].padStart(2, '0');
        const dy = parts[1].padStart(2, '0');
        return `${yr}-${mn}-${dy}` === fechaFiltro;
      }
      return f.includes(fechaFiltro);
    });
  }

  if (autorFiltro) {
    filtered = filtered.filter(c =>
      String(c.auxiliar || "").toLowerCase().includes(autorFiltro) ||
      String(c.admin || "").toLowerCase().includes(autorFiltro)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b; font-weight:800;">No hay cuadres que coincidan con los filtros.</div>`;
    return;
  }

  container.innerHTML = filtered.map((c, i) => {
    const embedUrl = _toDriveEmbedUrl(c.pdfUrl);
    const hasPdf = !!embedUrl;
    return `
        <div style="background: white; border: 1px solid var(--border); border-radius: 16px; padding: 22px; display: flex; flex-direction: column; gap: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 15px;">
            <div>
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                <span class="material-icons" style="color:var(--mex-blue); font-size:20px;">description</span>
                <h3 style="margin: 0; color: var(--mex-blue); font-size: 16px; font-weight:800;">Reporte del ${String(c.fecha).split(' ')[0]}</h3>
              </div>

              <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom: 16px;">
                <div style="background:#f8fafc; padding:10px 14px; border-radius:10px; border:1px solid #e2e8f0;">
                  <span style="display:block; font-size:10px; color:#94a3b8; font-weight:800; letter-spacing:0.5px; text-transform:uppercase; margin-bottom:4px;">Auxiliar en Patio</span>
                  <span style="font-size: 13px; color: var(--mex-accent); font-weight: 800;">${escapeHtml(c.auxiliar || 'N/A')}</span>
                </div>
                <div style="background:#f8fafc; padding:10px 14px; border-radius:10px; border:1px solid #e2e8f0;">
                  <span style="display:block; font-size:10px; color:#94a3b8; font-weight:800; letter-spacing:0.5px; text-transform:uppercase; margin-bottom:4px;">Autorizado por (Ventas)</span>
                  <span style="font-size: 13px; color: var(--mex-blue); font-weight: 800;">${escapeHtml(c.admin || 'N/A')}</span>
                </div>
              </div>

              <div style="display: flex; gap: 12px; font-size: 11px; font-weight: 800; background:#f1f5f9; padding:8px 12px; border-radius:8px; width:fit-content;">
                <span style="color: #16a34a; display:flex; align-items:center; gap:4px;"><span class="material-icons" style="font-size:14px;">check_circle</span> OK: ${c.ok}</span>
                <span style="color: #dc2626; display:flex; align-items:center; gap:4px;"><span class="material-icons" style="font-size:14px;">error</span> FALTAN: ${c.faltantes}</span>
                <span style="color: #d97706; display:flex; align-items:center; gap:4px;"><span class="material-icons" style="font-size:14px;">warning</span> SOBRAN: ${c.sobrantes}</span>
              </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:8px;">
              ${hasPdf ? `<button onclick="window.open('${escapeHtml(c.pdfUrl)}', '_blank')" style="background: #0f172a; color: white; border: none; padding: 12px 18px; border-radius: 12px; font-weight: 800; font-size:12px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                <span class="material-icons" style="font-size:16px;">download</span> DESCARGAR PDF
              </button>
              <button onclick="toggleIframe('iframe-pdf-${i}')" style="background: white; color: #0f172a; border: 1.5px solid #0f172a; padding: 12px 18px; border-radius: 12px; font-weight: 800; font-size:12px; cursor: pointer; display: flex; justify-content:center; align-items: center; gap: 8px;">
                <span class="material-icons" style="font-size:16px;">visibility</span> VISTA PREVIA
              </button>` : `<div style="font-size:11px; color:#94a3b8; font-weight:700; text-align:center; padding:8px; background:#f8fafc; border-radius:8px; border:1px dashed #e2e8f0;">Sin PDF adjunto</div>`}
            </div>
          </div>

          ${hasPdf ? `<div id="iframe-pdf-${i}" style="display:none; width:100%; height:500px; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden; margin-top:4px; background:#f1f5f9;">
            <iframe src="${escapeHtml(embedUrl)}" style="width:100%; height:100%; border:none;" allow="autoplay" loading="lazy"></iframe>
          </div>` : ''}
        </div>`;
  }).join('');
}




// ==========================================
// 💬 LÓGICA DE CHAT INTERNO (TIPO INSTAGRAM)
// ==========================================
let allChatMessages = [];
let activeChatUser = null;
let pendingChatFile = null;   // { file, previewUrl, isImg }
let pendingAudioBlob = null;   // { blob, localUrl, mimeType, extension }
let replyingToMsg = null;   // { id, remitente, mensaje }
let _chatListenerUnsubs = [];
let chatMediaRecorder = null;
let chatAudioChunks = [];
let _chatAudioCtx = null;
let _chatAnalyser = null;
let _chatSpectrumRaf = null;
let emojiPickerTarget = null;  // msgId for reaction picker
let _chatReplyHoverTimers = new Map();
const CHAT_ARCHIVE_STORAGE_PREFIX = 'mex_chat_archived_threads_v1';
let _chatArchivedThreads = {};
let _chatArchivedMode = false;
let _profileAvatarCropState = null;
let _globalShortcutsBound = false;

function _chatAudioMimeCandidates() {
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus',
    'audio/ogg'
  ];
}

function _chatAudioMimeType() {
  if (typeof window.MediaRecorder === 'undefined') return '';
  if (typeof window.MediaRecorder.isTypeSupported !== 'function') return '';
  return _chatAudioMimeCandidates().find(type => window.MediaRecorder.isTypeSupported(type)) || '';
}

function _chatAudioExtensionFromMime(mimeType = '') {
  const value = String(mimeType || '').toLowerCase();
  if (value.includes('mp4') || value.includes('aac') || value.includes('m4a')) return 'm4a';
  if (value.includes('ogg')) return 'ogg';
  if (value.includes('wav')) return 'wav';
  return 'webm';
}

async function _chatGetUserMediaAudio() {
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (_) {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
  }

  const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
  if (!legacy) throw new Error('Tu navegador no soporta micrófono en esta versión.');
  return new Promise((resolve, reject) => {
    legacy.call(navigator, { audio: true }, resolve, reject);
  });
}

function _chatUserName(value = '') {
  return String(value || '').trim().toUpperCase();
}

function _chatMessageTimestamp(msg = {}) {
  return _coerceTimestamp(msg.timestamp || msg.ts || msg.createdAt || msg.id);
}

function _chatContactByName(name = '') {
  const normalized = _chatUserName(name);
  if (!normalized) return null;
  return dbUsuariosLogin.find(user => _chatUserName(user.usuario || user.nombre) === normalized) || null;
}

function _chatContactByIdentifier(identifier = '') {
  const normalizedEmail = _profileDocId(identifier);
  if (normalizedEmail) {
    const foundByEmail = dbUsuariosLogin.find(user => _profileDocId(user.email) === normalizedEmail);
    if (foundByEmail) return foundByEmail;
  }
  return _chatContactByName(identifier);
}

function _activeChatContact() {
  return _chatContactByName(activeChatUser);
}

function _chatPresenceLabel(user = {}) {
  if (_userPresenceIsOnline(user)) return 'En línea';
  const lastSeen = _coerceTimestamp(user.lastSeenAt || user.lastActiveAt);
  return lastSeen ? `Últ. ${_formatearUltimaConexion(lastSeen)}` : 'Sin actividad reciente';
}

function _chatListTimeLabel(ts) {
  const safeTs = _coerceTimestamp(ts);
  if (!safeTs) return '';
  const date = new Date(safeTs);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });
}

function _chatMessageSnippet(msg = {}) {
  if (msg.archivoUrl) {
    const fileName = String(msg.archivoNombre || '').trim();
    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(fileName)) return 'Foto adjunta';
    if (/\.(ogg|mp3|wav|m4a|webm)$/i.test(fileName)) return 'Audio adjunto';
    return fileName ? `Archivo: ${fileName}` : 'Archivo adjunto';
  }

  const text = String(msg.mensaje || '').trim();
  if (!text) return 'Toca para chatear';
  return text;
}

function _chatArchiveStorageKey() {
  return `${CHAT_ARCHIVE_STORAGE_PREFIX}:${_chatUserName(USER_NAME || currentUserProfile?.email || auth.currentUser?.email || 'anon')}`;
}

function _loadChatArchivedThreads() {
  try {
    const raw = localStorage.getItem(_chatArchiveStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    const next = {};
    Object.entries(parsed || {}).forEach(([name, ts]) => {
      const normalized = _chatUserName(name);
      const safeTs = _coerceTimestamp(ts);
      if (normalized && safeTs) next[normalized] = safeTs;
    });
    _chatArchivedThreads = next;
  } catch (_) {
    _chatArchivedThreads = {};
  }
}

function _saveChatArchivedThreads() {
  const entries = Object.entries(_chatArchivedThreads)
    .map(([name, ts]) => [_chatUserName(name), _coerceTimestamp(ts)])
    .filter(([name, ts]) => name && ts);
  if (entries.length === 0) {
    localStorage.removeItem(_chatArchiveStorageKey());
    return;
  }
  localStorage.setItem(_chatArchiveStorageKey(), JSON.stringify(Object.fromEntries(entries)));
}

function _chatConversationLastTimestamp(name = '') {
  const target = _chatUserName(name);
  if (!target) return 0;
  return allChatMessages.reduce((max, msg) => {
    const other = _chatUserName(msg.esMio ? msg.destinatario : msg.remitente);
    if (other !== target) return max;
    const ts = _chatMessageTimestamp(msg);
    return ts > max ? ts : max;
  }, 0);
}

function _chatIsArchived(name = '', lastTs = null) {
  const target = _chatUserName(name);
  if (!target) return false;
  const archivedAt = _coerceTimestamp(_chatArchivedThreads[target]);
  const safeLastTs = _coerceTimestamp(lastTs || _chatConversationLastTimestamp(target));
  return Boolean(archivedAt && safeLastTs && safeLastTs <= archivedAt);
}

function _archiveChatConversation(name, lastTs = null, options = {}) {
  const target = _chatUserName(name);
  const safeTs = _coerceTimestamp(lastTs || _chatConversationLastTimestamp(target));
  if (!target || !safeTs) return;
  _chatArchivedThreads[target] = safeTs;
  _saveChatArchivedThreads();
  if (activeChatUser === target) cerrarChat();
  renderContactos();
  if (!options.silent) showToast(`Conversación con ${target} archivada.`, 'success');
}

function _restoreChatConversation(name, options = {}) {
  const target = _chatUserName(name);
  if (!target || !_chatArchivedThreads[target]) return;
  delete _chatArchivedThreads[target];
  _saveChatArchivedThreads();
  renderContactos();
  _actualizarHeaderChatActivo();
  if (!options.silent) showToast(`Conversación con ${target} restaurada.`, 'success');
}

function _syncChatArchiveUi(summary = {}) {
  const archivedCount = Number(summary.archivedCount || 0);
  const archivedToggle = document.getElementById('chatArchivedToggle');
  if (archivedToggle) {
    archivedToggle.classList.toggle('active-mode', _chatArchivedMode);
    archivedToggle.innerText = _chatArchivedMode
      ? `Ocultar archivados${archivedCount ? ` (${archivedCount})` : ''}`
      : `Archivados${archivedCount ? ` (${archivedCount})` : ''}`;
  }

  const archiveBtn = document.getElementById('chatArchiveBtn');
  const archiveIcon = archiveBtn?.querySelector('.material-icons');
  if (archiveBtn && archiveIcon) {
    const target = _chatUserName(activeChatUser);
    const lastTs = _chatConversationLastTimestamp(target);
    const canToggle = Boolean(target && lastTs);
    archiveBtn.style.display = canToggle ? 'inline-flex' : 'none';
    if (!canToggle) {
      archiveBtn.classList.remove('is-restore');
      return;
    }
    const archived = _chatIsArchived(target, lastTs);
    archiveBtn.title = archived ? 'Restaurar conversación' : 'Archivar conversación';
    archiveBtn.classList.toggle('is-restore', archived);
    archiveIcon.textContent = archived ? 'unarchive' : 'delete_outline';
  }
}

function toggleArchivadosChat() {
  _chatArchivedMode = !_chatArchivedMode;
  renderContactos();
}

function toggleArchivoChatActivo() {
  if (!activeChatUser) return;
  const lastTs = _chatConversationLastTimestamp(activeChatUser);
  if (!lastTs) return;
  if (_chatIsArchived(activeChatUser, lastTs)) _restoreChatConversation(activeChatUser);
  else _archiveChatConversation(activeChatUser, lastTs);
}

function prepararNuevoChat() {
  _chatArchivedMode = false;
  limpiarFiltrosChat();
  cerrarChat();
  requestAnimationFrame(() => document.getElementById('buscadorContactos')?.focus());
}

function _setSelectOptions(selectEl, items, placeholder) {
  if (!selectEl) return;
  const current = selectEl.value;
  selectEl.innerHTML = `<option value="">${placeholder}</option>` + items.map(item =>
    `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`
  ).join('');
  if (current && items.some(item => item.value === current)) {
    selectEl.value = current;
  }
}

function _renderChatFilterOptions() {
  const plazaSelect = document.getElementById('chatFilterPlaza');
  const roleSelect = document.getElementById('chatFilterRol');
  const statusSelect = document.getElementById('chatFilterStatus');

  const plazas = Array.from(new Set([
    ...(window.MEX_CONFIG?.empresa?.plazas || []).map(_normalizePlaza),
    ...dbUsuariosLogin.map(user => _normalizePlaza(user.plazaAsignada)).filter(Boolean)
  ])).sort();

  const roles = ROLE_OPTIONS.map(role => ({
    value: role,
    label: ROLE_META[role]?.label || role
  }));

  const statuses = Array.from(new Set(
    dbUsuariosLogin
      .map(user => String(user.status || 'ACTIVO').trim().toUpperCase())
      .filter(Boolean)
  )).sort();

  _setSelectOptions(plazaSelect, plazas.map(plaza => ({ value: plaza, label: plaza })), 'Todas');
  _setSelectOptions(roleSelect, roles, 'Todos');
  _setSelectOptions(statusSelect, statuses.map(status => ({ value: status, label: status })), 'Todos');
}

function _chatFilterState() {
  const term = (document.getElementById('buscadorContactos')?.value || '').trim().toLowerCase();
  const plaza = _normalizePlaza(document.getElementById('chatFilterPlaza')?.value || '');
  const rol = _sanitizeRole(document.getElementById('chatFilterRol')?.value || '');
  const status = String(document.getElementById('chatFilterStatus')?.value || '').trim().toUpperCase();
  return {
    term,
    plaza,
    rol,
    status,
    hasFilters: Boolean(term || plaza || rol || status)
  };
}

function actualizarFiltrosChat() {
  renderContactos();
}

function limpiarFiltrosChat() {
  const search = document.getElementById('buscadorContactos');
  const plaza = document.getElementById('chatFilterPlaza');
  const rol = document.getElementById('chatFilterRol');
  const status = document.getElementById('chatFilterStatus');

  if (search) search.value = '';
  if (plaza) plaza.value = '';
  if (rol) rol.value = '';
  if (status) status.value = '';

  renderContactos();
}

function _actualizarHeaderChatActivo() {
  const nameEl = document.getElementById('chat-active-name');
  const avatarEl = document.getElementById('chat-active-avatar');
  const statusEl = document.querySelector('.chatv2-active-status');

  if (!nameEl || !avatarEl || !statusEl) return;
  if (!activeChatUser) {
    nameEl.innerText = 'Nombre';
    avatarEl.style.background = _avatarColor('U');
    avatarEl.innerHTML = '<span class="avatar-initial">U</span>';
    statusEl.innerText = 'Conversación segura';
    _syncChatArchiveUi();
    return;
  }

  const contact = _activeChatContact() || { usuario: activeChatUser, nombre: activeChatUser };
  const plaza = _normalizePlaza(contact.plazaAsignada || '');
  const role = contact.roleLabel || contact.rol || 'Contacto';
  const pieces = [role];
  if (plaza) pieces.unshift(plaza);
  pieces.push(_chatPresenceLabel(contact));

  nameEl.innerText = activeChatUser;
  avatarEl.dataset.userEmail = contact.email || '';
  _paintAvatarElement(avatarEl, contact, activeChatUser);
  statusEl.innerText = pieces.join(' · ');
  _syncChatArchiveUi();
}

function _renderChatContactInfo(user = {}) {
  const container = document.getElementById('chat-user-info-content');
  if (!container) return;

  const fallbackName = _chatUserName(user.usuario || user.nombre || activeChatUser || 'USUARIO');
  const avatar = _buildAvatarMarkup(user, fallbackName);
  const plaza = _normalizePlaza(user.plazaAsignada || '') || 'Sin plaza asignada';
  const role = user.roleLabel || user.rol || 'Sin rol';
  const accountStatus = String(user.status || 'ACTIVO').trim().toUpperCase() || 'ACTIVO';
  const liveStatus = _userPresenceIsOnline(user) ? 'ONLINE' : 'OFFLINE';
  const lastSeen = _chatPresenceLabel(user);
  const safeEmail = String(user.email || '').trim().toLowerCase();

  container.innerHTML = `
    <div class="chat-user-info-hero">
      <div class="chat-user-info-avatar" style="background:${avatar.background};">${avatar.html}</div>
      <div>
        <div class="chat-user-info-name">${escapeHtml(fallbackName)}</div>
        <div class="chat-user-info-sub">${escapeHtml(role)} · ${escapeHtml(plaza)}</div>
      </div>
    </div>

    <div class="chat-user-info-body">
      <div class="chat-user-info-row">
        <span class="chat-user-info-label">Correo</span>
        <span class="chat-user-info-value">${escapeHtml(safeEmail || 'Sin correo registrado')}</span>
      </div>
      <div class="chat-user-info-row">
        <span class="chat-user-info-label">Plaza</span>
        <span class="chat-user-info-value">${escapeHtml(plaza)}</span>
      </div>
      <div class="chat-user-info-row">
        <span class="chat-user-info-label">Rol</span>
        <span class="chat-user-info-value">${escapeHtml(role)}</span>
      </div>
      <div class="chat-user-info-row">
        <span class="chat-user-info-label">Status cuenta</span>
        <span class="chat-user-info-value">${escapeHtml(accountStatus)}</span>
      </div>
      <div class="chat-user-info-row">
        <span class="chat-user-info-label">Presencia</span>
        <span class="chat-user-info-value">${escapeHtml(liveStatus)}</span>
      </div>
      <div class="chat-user-info-row">
        <span class="chat-user-info-label">Última conexión</span>
        <span class="chat-user-info-value">${escapeHtml(lastSeen)}</span>
      </div>
      <div class="chat-user-info-row">
        <span class="chat-user-info-label">Teléfono</span>
        <span class="chat-user-info-value">${escapeHtml(user.telefono || 'Sin teléfono registrado')}</span>
      </div>
    </div>

    <div class="chat-user-info-actions">
      <button class="primary" data-chat-name="${escapeHtml(fallbackName)}" onclick="abrirChat(this.dataset.chatName); cerrarInfoContacto();">
        Abrir chat
      </button>
      <button class="secondary" onclick="cerrarInfoContacto()">
        Cerrar
      </button>
    </div>
  `;
}

function abrirInfoContacto(identifier = '') {
  const user = _chatContactByIdentifier(identifier) || _activeChatContact();
  if (!user && !identifier && !activeChatUser) {
    showToast('Selecciona un contacto primero.', 'warning');
    return;
  }

  _renderChatContactInfo(user || {
    usuario: _chatUserName(identifier || activeChatUser || 'USUARIO'),
    nombre: _chatUserName(identifier || activeChatUser || 'USUARIO')
  });
  document.getElementById('chat-user-info-modal')?.classList.add('active');
}

function abrirInfoContactoActivo() {
  if (!activeChatUser) {
    showToast('Abre una conversación para ver más información.', 'warning');
    return;
  }
  abrirInfoContacto(activeChatUser);
}

function cerrarInfoContacto() {
  document.getElementById('chat-user-info-modal')?.classList.remove('active');
}

function _toggleProfileSettingVisual(id, enabled) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('is-on', Boolean(enabled));
  el.classList.toggle('is-off', !enabled);
  el.setAttribute('aria-pressed', enabled ? 'true' : 'false');
}

function _friendlyProfileDeviceLabel(device = {}) {
  const platform = String(device?.platform || '').trim().toLowerCase();
  const browser = String(device?.browser || '').trim().toLowerCase();
  if (platform === 'ios') return 'iPhone';
  if (platform === 'android') return 'Celular';
  if (platform === 'mac' || platform === 'windows') return 'Computadora';
  if (browser === 'safari') return 'Safari';
  if (browser === 'chrome') return 'Chrome';
  if (browser === 'firefox') return 'Firefox';
  if (browser === 'edge') return 'Edge';
  return 'Navegador';
}

async function _togglePerfilNotificacion(field) {
  const snapshot = getCurrentDeviceSnapshot();
  const current = snapshot?.currentDevice?.notificationPrefs || {};
  const nextValue = !(current?.[field] !== false);
  await updateCurrentDevicePreferences({ [field]: nextValue });
  _renderNotificationProfileState();
}

async function _togglePerfilMasterNotifications() {
  const snapshot = getCurrentDeviceSnapshot();
  const currentDevice = snapshot?.currentDevice || {};
  const isMuted = currentDevice?.notificationPrefs?.muteAll === true;
  const permission = ('Notification' in window) ? Notification.permission : 'unsupported';

  if (permission !== 'granted') {
    await requestDeviceNotifications(true);
    _renderNotificationProfileState();
    return;
  }

  await updateCurrentDevicePreferences({ muteAll: !isMuted });
  _renderNotificationProfileState();
}

async function solicitarPermisoNotificacionesDispositivo() {
  await requestDeviceNotifications(true);
  _renderNotificationProfileState();
}

// Prompt obligatorio de notificaciones — llamado desde notifications.js cuando el permiso es 'default'
window._mexShowPushPrompt = function () {
  mostrarCustomModal(
    'Activa las notificaciones',
    'Para recibir mensajes, misiones de cuadre y alertas críticas en este dispositivo, necesitas permitir las notificaciones del sitio.\n\nEs obligatorio para el correcto funcionamiento del sistema.',
    'notifications_active',
    '#2563eb',
    'ACTIVAR AHORA',
    '#2563eb',
    () => { solicitarPermisoNotificacionesDispositivo(); }
  );
};

function _abrirChatDesdeNotificacion(nombre = '') {
  const target = _chatUserName(nombre);
  if (!target) return;
  abrirBuzon();
  setTimeout(() => {
    abrirChat(target);
  }, 180);
}

function _abrirCuadreDesdeNotificacion() {
  try {
    manejadorFlujoV3();
  } catch (error) {
    console.warn('No se pudo abrir el cuadre desde la notificación:', error);
  }
}

function _renderNotificationProfileState() {
  const snapshot = getCurrentDeviceSnapshot();
  const currentDevice = snapshot?.currentDevice || {};
  const prefs = {
    directMessages: currentDevice?.notificationPrefs?.directMessages !== false,
    cuadreMissions: currentDevice?.notificationPrefs?.cuadreMissions !== false,
    criticalAlerts: currentDevice?.notificationPrefs?.criticalAlerts !== false,
    muteAll: currentDevice?.notificationPrefs?.muteAll === true
  };
  const permission = ('Notification' in window) ? Notification.permission : 'unsupported';
  const masterEnabled = permission === 'granted' && currentDevice?.pushEnabled !== false && !prefs.muteAll;

  _toggleProfileSettingVisual('profileNotifMasterToggle', masterEnabled);
  _toggleProfileSettingVisual('profileNotifMessagesToggle', prefs.directMessages);
  _toggleProfileSettingVisual('profileNotifCuadreToggle', prefs.cuadreMissions);
  _toggleProfileSettingVisual('profileNotifCriticalToggle', prefs.criticalAlerts);
  _toggleProfileSettingVisual('profileNotifMuteToggle', prefs.muteAll);

  const badge = document.getElementById('profileNotificationBadge');
  const meta = document.getElementById('profileNotificationMeta');
  const sessionBadge = document.getElementById('profileSessionBadge');
  const permissionSummary = document.getElementById('profilePermissionSummary');
  const permissionPill = document.getElementById('profilePermissionPill');
  const currentDeviceSummary = document.getElementById('profileCurrentDeviceSummary');

  if (badge) badge.innerText = masterEnabled ? 'Activo en este equipo' : (snapshot?.unread > 0 ? `${snapshot.unread} nuevas` : 'Activalas');
  if (meta) {
    const lastSeen = currentDevice?.lastSeenAt
      ? new Date(Number(currentDevice.lastSeenAt)).toLocaleString('es-MX')
      : 'Sin registro todavía';
    meta.innerText = `${masterEnabled ? 'Push activo' : 'Push en pausa'} en ${_friendlyProfileDeviceLabel(currentDevice)} · Última actividad: ${lastSeen}`;
  }
  if (sessionBadge) sessionBadge.innerText = _userPresenceIsOnline(currentUserProfile || {}) ? 'En línea' : 'Sesión activa';
  if (permissionSummary) {
    permissionSummary.innerText = permission === 'granted'
      ? 'Este equipo ya puede recibir notificaciones reales del sistema.'
      : (permission === 'denied'
        ? 'El permiso está bloqueado. Puedes volver a activarlo desde la configuración del sitio.'
        : 'Activa el permiso para recibir mensajes, cuadre y alertas críticas en este equipo.');
  }
  const permissionToggle = document.getElementById('profilePermissionToggle');
  if (permissionToggle) {
    const isGranted = permission === 'granted';
    const isDenied  = permission === 'denied';
    _toggleProfileSettingVisual('profilePermissionToggle', isGranted);
    const supPush = typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
    permissionToggle.disabled = isDenied || !supPush;
    permissionToggle.title = isGranted
      ? 'Push activo — haz clic para ir a configuración del sitio'
      : (isDenied ? 'Bloqueado en el navegador — actívalo manualmente desde la configuración del sitio' : 'Toca para activar notificaciones push');
  }
  if (currentDeviceSummary) {
    currentDeviceSummary.innerText = `${_friendlyProfileDeviceLabel(currentDevice)} · ${currentDevice?.activeRoute || '/mapa'} · ${prefs.muteAll ? 'Silenciado' : 'Disponible'}`;
  }
}

function _bindProfileNotificationButtons() {
  if (window.__profileNotificationButtonsBound) return;
  window.__profileNotificationButtonsBound = true;

  document.getElementById('profileNotifMasterToggle')?.addEventListener('click', () => _togglePerfilMasterNotifications());
  document.getElementById('profileNotifMessagesToggle')?.addEventListener('click', () => _togglePerfilNotificacion('directMessages'));
  document.getElementById('profileNotifCuadreToggle')?.addEventListener('click', () => _togglePerfilNotificacion('cuadreMissions'));
  document.getElementById('profileNotifCriticalToggle')?.addEventListener('click', () => _togglePerfilNotificacion('criticalAlerts'));
  document.getElementById('profileNotifMuteToggle')?.addEventListener('click', () => _togglePerfilNotificacion('muteAll'));
  document.getElementById('profileOpenNotificationsCenterBtn')?.addEventListener('click', () => {
    openNotificationCenter();
  });
  document.getElementById('profilePermissionToggle')?.addEventListener('click', () => {
    const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    if (perm === 'granted') {
      // Ya activo — abrir centro de notificaciones
      openNotificationCenter();
    } else {
      solicitarPermisoNotificacionesDispositivo();
    }
  });
}

function _renderPerfilUsuarioActual() {
  const profile = currentUserProfile || window.CURRENT_USER_PROFILE;
  if (!profile) return;

  const avatarEl = document.getElementById('profileCurrentAvatar');
  const nameEl = document.getElementById('profileCurrentName');
  const metaEl = document.getElementById('profileCurrentMeta');
  const badgesEl = document.getElementById('profileCurrentBadges');
  const removeBtn = document.querySelector('#perfil-modal .profile-modal-btn:not(.primary)');

  if (avatarEl) _paintAvatarElement(avatarEl, profile, profile.nombre || USER_NAME || 'U');
  if (nameEl) nameEl.innerText = profile.nombre || profile.usuario || USER_NAME || 'Usuario';

  const meta = [
    profile.roleLabel || profile.rol || 'Sin rol',
    _normalizePlaza(profile.plazaAsignada || '') || 'Sin plaza',
    profile.email || _currentUserDocId() || 'Sin correo'
  ];
  if (metaEl) metaEl.innerText = meta.join(' · ');
  if (badgesEl) {
    const chips = [
      { icon: 'badge', label: profile.roleLabel || profile.rol || 'Sin rol' },
      { icon: 'apartment', label: _normalizePlaza(profile.plazaAsignada || '') || 'Sin plaza' },
      { icon: 'verified_user', label: String(profile.status || 'ACTIVO').trim().toUpperCase() || 'ACTIVO' }
    ];
    badgesEl.innerHTML = chips.map(chip =>
      `<span class="profile-modal-badge"><span class="material-icons">${chip.icon}</span>${escapeHtml(chip.label)}</span>`
    ).join('');
  }
  if (removeBtn) removeBtn.disabled = !_getUserAvatarUrl(profile);
  _bindProfileNotificationButtons();
  _renderNotificationProfileState();
}

function _bindProfileAvatarCropStage() {
  const stage = document.getElementById('profileAvatarCropStage');
  if (!stage || stage.dataset.bound === '1') return;
  stage.dataset.bound = '1';

  let activePointerId = null;

  const endDrag = event => {
    if (!_profileAvatarCropState?.dragging) return;
    _profileAvatarCropState.dragging = false;
    if (activePointerId !== null && event?.pointerId === activePointerId) {
      try { stage.releasePointerCapture(activePointerId); } catch (_) { }
    }
    activePointerId = null;
  };

  stage.addEventListener('pointerdown', event => {
    if (!_profileAvatarCropState) return;
    if (event.button !== undefined && event.button !== 0) return;
    activePointerId = event.pointerId;
    _profileAvatarCropState.dragging = true;
    _profileAvatarCropState.dragStartX = event.clientX;
    _profileAvatarCropState.dragStartY = event.clientY;
    _profileAvatarCropState.dragOriginX = _profileAvatarCropState.offsetX;
    _profileAvatarCropState.dragOriginY = _profileAvatarCropState.offsetY;
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener('pointermove', event => {
    if (!_profileAvatarCropState?.dragging || event.pointerId !== activePointerId) return;
    event.preventDefault();
    _profileAvatarCropState.offsetX = _profileAvatarCropState.dragOriginX + (event.clientX - _profileAvatarCropState.dragStartX);
    _profileAvatarCropState.offsetY = _profileAvatarCropState.dragOriginY + (event.clientY - _profileAvatarCropState.dragStartY);
    _renderProfileAvatarCrop();
  });

  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('lostpointercapture', endDrag);
}

function _profileAvatarCropMetrics() {
  const stage = document.getElementById('profileAvatarCropStage');
  if (!stage) return null;
  const stageW = stage.clientWidth || 320;
  const stageH = stage.clientHeight || 320;
  const boxSize = Math.min(stageW, stageH) - 36;
  const left = Math.round((stageW - boxSize) / 2);
  const top = Math.round((stageH - boxSize) / 2);
  return { stage, stageW, stageH, box: { left, top, size: boxSize } };
}

function _clampProfileAvatarCropOffsets() {
  if (!_profileAvatarCropState) return;
  const metrics = _profileAvatarCropMetrics();
  if (!metrics) return;
  const { box } = metrics;
  const scaledW = _profileAvatarCropState.naturalW * _profileAvatarCropState.scale;
  const scaledH = _profileAvatarCropState.naturalH * _profileAvatarCropState.scale;
  const minX = box.left + box.size - scaledW;
  const minY = box.top + box.size - scaledH;
  const maxX = box.left;
  const maxY = box.top;
  _profileAvatarCropState.offsetX = Math.min(maxX, Math.max(minX, _profileAvatarCropState.offsetX));
  _profileAvatarCropState.offsetY = Math.min(maxY, Math.max(minY, _profileAvatarCropState.offsetY));
}

function _drawRoundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function _drawProfileAvatarCropToCanvas(canvas, options = {}) {
  if (!_profileAvatarCropState) return;
  const { clip = 'square' } = options;
  const img = document.getElementById('profileAvatarCropImage');
  const metrics = _profileAvatarCropMetrics();
  if (!canvas || !img || !metrics) return;

  const { box } = metrics;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const ratio = canvas.width / box.size;
  const drawX = (_profileAvatarCropState.offsetX - box.left) * ratio;
  const drawY = (_profileAvatarCropState.offsetY - box.top) * ratio;
  const drawW = _profileAvatarCropState.naturalW * _profileAvatarCropState.scale * ratio;
  const drawH = _profileAvatarCropState.naturalH * _profileAvatarCropState.scale * ratio;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (clip === 'circle') {
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
  } else if (clip === 'rounded') {
    _drawRoundedRectPath(ctx, 0, 0, canvas.width, canvas.height, canvas.width * 0.22);
    ctx.clip();
  }
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();
}

function _renderProfileAvatarCrop() {
  if (!_profileAvatarCropState) return;
  const img = document.getElementById('profileAvatarCropImage');
  const zoomInput = document.getElementById('profileAvatarCropZoom');
  const metrics = _profileAvatarCropMetrics();
  if (!img || !metrics) return;

  _clampProfileAvatarCropOffsets();
  img.style.width = `${_profileAvatarCropState.naturalW * _profileAvatarCropState.scale}px`;
  img.style.height = `${_profileAvatarCropState.naturalH * _profileAvatarCropState.scale}px`;
  img.style.transform = `translate(${_profileAvatarCropState.offsetX}px, ${_profileAvatarCropState.offsetY}px)`;

  if (zoomInput) zoomInput.value = String(_profileAvatarCropState.zoomFactor || 1);
  _drawProfileAvatarCropToCanvas(document.getElementById('profileAvatarPreviewCircle'), { clip: 'circle' });
  _drawProfileAvatarCropToCanvas(document.getElementById('profileAvatarPreviewCard'), { clip: 'rounded' });
}

function _resetProfileAvatarCropTransform() {
  if (!_profileAvatarCropState) return;
  const metrics = _profileAvatarCropMetrics();
  if (!metrics) return;
  const { box } = metrics;
  const baseScale = Math.max(box.size / _profileAvatarCropState.naturalW, box.size / _profileAvatarCropState.naturalH);
  _profileAvatarCropState.baseScale = baseScale;
  _profileAvatarCropState.zoomFactor = 1;
  _profileAvatarCropState.scale = baseScale;
  _profileAvatarCropState.offsetX = box.left + (box.size - (_profileAvatarCropState.naturalW * _profileAvatarCropState.scale)) / 2;
  _profileAvatarCropState.offsetY = box.top + (box.size - (_profileAvatarCropState.naturalH * _profileAvatarCropState.scale)) / 2;
  _renderProfileAvatarCrop();
}

function _abrirRecorteAvatarPerfil(file, inputEl) {
  const objectUrl = URL.createObjectURL(file);
  const modal = document.getElementById('profile-avatar-crop-modal');
  const img = document.getElementById('profileAvatarCropImage');
  const zoomInput = document.getElementById('profileAvatarCropZoom');
  if (!modal || !img || !zoomInput) return;

  _cleanupProfileAvatarCropState({ preserveInput: true });
  _profileAvatarCropState = {
    file,
    inputEl,
    objectUrl,
    naturalW: 0,
    naturalH: 0,
    baseScale: 1,
    scale: 1,
    zoomFactor: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false
  };

  _bindProfileAvatarCropStage();
  zoomInput.value = '1';
  img.onload = () => {
    if (!_profileAvatarCropState) return;
    _profileAvatarCropState.naturalW = img.naturalWidth || 1;
    _profileAvatarCropState.naturalH = img.naturalHeight || 1;
    _resetProfileAvatarCropTransform();
  };
  img.onerror = () => {
    console.warn('No se pudo decodificar la imagen seleccionada para avatar.');
    showToast('Ese formato no permite recorte aquí. Subiremos la imagen original.', 'warning');
    const fallbackFile = _profileAvatarCropState?.file || file;
    _cleanupProfileAvatarCropState({ preserveInput: true });
    (async () => {
      try {
        await _subirBlobAvatarPerfil(fallbackFile, fallbackFile?.type || 'image/jpeg');
      } catch (error) {
        console.error('No se pudo subir imagen original del avatar:', error);
        showToast('No se pudo subir la foto seleccionada.', 'error');
      } finally {
        if (inputEl) inputEl.value = '';
      }
    })();
  };
  img.decoding = 'async';
  img.src = objectUrl;
  modal.classList.add('active');
}

function _cleanupProfileAvatarCropState(options = {}) {
  const { preserveInput = false } = options;
  const modal = document.getElementById('profile-avatar-crop-modal');
  const img = document.getElementById('profileAvatarCropImage');
  const zoomInput = document.getElementById('profileAvatarCropZoom');
  const input = document.getElementById('profileAvatarInput');

  if (_profileAvatarCropState?.objectUrl) {
    URL.revokeObjectURL(_profileAvatarCropState.objectUrl);
  }

  _profileAvatarCropState = null;
  if (modal) modal.classList.remove('active');
  if (img) {
    img.onload = null;
    img.onerror = null;
    img.removeAttribute('src');
    img.style.width = '';
    img.style.height = '';
    img.style.transform = '';
  }
  if (zoomInput) zoomInput.value = '1';
  if (!preserveInput && input) input.value = '';
}

function ajustarZoomAvatarPerfil(value) {
  if (!_profileAvatarCropState) return;
  const zoomFactor = Math.max(1, Math.min(3, Number(value) || 1));
  const metrics = _profileAvatarCropMetrics();
  if (!metrics) return;
  const { box } = metrics;

  const prevScale = _profileAvatarCropState.scale;
  const nextScale = _profileAvatarCropState.baseScale * zoomFactor;
  const centerX = box.left + (box.size / 2);
  const centerY = box.top + (box.size / 2);
  const relX = (centerX - _profileAvatarCropState.offsetX) / prevScale;
  const relY = (centerY - _profileAvatarCropState.offsetY) / prevScale;

  _profileAvatarCropState.zoomFactor = zoomFactor;
  _profileAvatarCropState.scale = nextScale;
  _profileAvatarCropState.offsetX = centerX - (relX * nextScale);
  _profileAvatarCropState.offsetY = centerY - (relY * nextScale);
  _renderProfileAvatarCrop();
}

function cancelarRecorteAvatarPerfil() {
  _cleanupProfileAvatarCropState();
}

function _avatarExtensionFromContentType(contentType = 'image/jpeg') {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('bmp')) return 'bmp';
  if (normalized.includes('avif')) return 'avif';
  if (normalized.includes('heic') || normalized.includes('heif')) return 'heic';
  return 'jpg';
}

async function _subirBlobAvatarPerfil(fileBlob, contentType = 'image/jpeg') {
  const docId = _currentUserDocId();
  if (!fileBlob || !docId) return;

  const ext = _avatarExtensionFromContentType(contentType);
  const avatarPath = `profile_avatars/${docId}/avatar_${Date.now()}.${ext}`;
  const previousPath = String(currentUserProfile?.avatarPath || '').trim();
  const previousUrl = String(currentUserProfile?.avatarUrl || '').trim();

  showToast('Subiendo foto de perfil...', 'info');
  const ref = firebase.storage().ref(avatarPath);
  await ref.put(fileBlob, { contentType });
  const avatarUrl = await ref.getDownloadURL();

  const payload = {
    avatarUrl,
    avatarPath,
    photoURL: avatarUrl,
    fotoURL: avatarUrl,
    profilePhotoUrl: avatarUrl
  };

  await db.collection(COL.USERS).doc(docId).set(payload, { merge: true });
  if (previousPath && previousPath !== avatarPath) {
    firebase.storage().ref(previousPath).delete().catch(() => { });
  } else if (!previousPath && previousUrl && previousUrl !== avatarUrl) {
    firebase.storage().refFromURL(previousUrl).delete().catch(() => { });
  }

  if (auth.currentUser?.updateProfile) {
    auth.currentUser.updateProfile({ photoURL: avatarUrl }).catch(() => { });
  }

  currentUserProfile = { ...(currentUserProfile || {}), ...payload };
  window.CURRENT_USER_PROFILE = currentUserProfile;
  _actualizarIdentidadSidebarUsuario();
  _renderPerfilUsuarioActual();
  if (document.getElementById('buzon-modal')?.classList.contains('active')) {
    renderContactos();
    if (activeChatUser) _actualizarHeaderChatActivo();
  }
  showToast('Foto de perfil actualizada.', 'success');
}

function abrirPerfilUsuario() {
  console.log('[DEBUG] abrirPerfilUsuario', { profile: currentUserProfile, windowProfile: window.CURRENT_USER_PROFILE });
  if (!currentUserProfile && !window.CURRENT_USER_PROFILE) {
    console.warn('[DEBUG] currentUserProfile es null — perfil no cargado');
    showToast('Tu perfil todavía no está listo. Intenta de nuevo en unos segundos.', 'warning');
    return;
  }
  _renderPerfilUsuarioActual();
  document.getElementById('perfil-modal')?.classList.add('active');
}

function cerrarPerfilUsuario() {
  document.getElementById('perfil-modal')?.classList.remove('active');
  const input = document.getElementById('profileAvatarInput');
  if (input) input.value = '';
  cancelarRecorteAvatarPerfil();
}

function subirAvatarPerfil(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file || !_currentUserDocId()) return;

  const fileType = String(file.type || '').toLowerCase();
  const fileName = String(file.name || '').toLowerCase();
  const looksLikeImage = /\.(jpe?g|png|webp|gif|bmp|svg|heic|heif|avif)$/i.test(fileName);
  if (!fileType.startsWith('image/') && !looksLikeImage) {
    showToast('Selecciona una imagen válida para tu perfil.', 'error');
    inputEl.value = '';
    return;
  }

  if (file.size > 12 * 1024 * 1024) {
    showToast('La imagen es demasiado grande. Máximo 12MB.', 'error');
    inputEl.value = '';
    return;
  }

  _abrirRecorteAvatarPerfil(file, inputEl);
}

async function guardarAvatarRecortadoPerfil() {
  if (!_profileAvatarCropState) return;
  const saveBtn = document.getElementById('profileAvatarCropSaveBtn');
  const prevHtml = saveBtn?.innerHTML || '';

  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="material-icons spinner" style="font-size:16px;">sync</span> Guardando...';
    }

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    _drawProfileAvatarCropToCanvas(canvas, { clip: 'square' });

    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    let contentType = 'image/jpeg';
    if (!blob) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.95));
      contentType = 'image/png';
    }
    if (!blob) throw new Error('No se pudo generar el recorte del avatar');

    await _subirBlobAvatarPerfil(blob, contentType);
    _cleanupProfileAvatarCropState();
  } catch (error) {
    console.error('No se pudo guardar el avatar recortado:', error);
    showToast('No se pudo guardar tu foto recortada.', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = prevHtml || '<span class="material-icons" style="font-size:18px;">check</span> Guardar Foto';
    }
  }
}

async function eliminarAvatarPerfil() {
  const docId = _currentUserDocId();
  const avatarPath = String(currentUserProfile?.avatarPath || '').trim();
  const avatarUrl = String(currentUserProfile?.avatarUrl || '').trim();
  if (!docId || (!_getUserAvatarUrl(currentUserProfile || {}) && !avatarPath && !avatarUrl)) {
    showToast('No tienes foto de perfil configurada.', 'info');
    return;
  }

  const ok = await mexConfirm('Quitar foto de perfil', 'Se eliminará tu foto actual del sistema.', 'warning');
  if (!ok) return;

  try {
    if (avatarPath) {
      await firebase.storage().ref(avatarPath).delete().catch(() => { });
    } else if (avatarUrl) {
      await firebase.storage().refFromURL(avatarUrl).delete().catch(() => { });
    }

    const payload = {
      avatarUrl: '',
      avatarPath: '',
      photoURL: '',
      fotoURL: '',
      profilePhotoUrl: ''
    };

    await db.collection(COL.USERS).doc(docId).set(payload, { merge: true });
    if (auth.currentUser?.updateProfile) {
      auth.currentUser.updateProfile({ photoURL: '' }).catch(() => { });
    }

    currentUserProfile = { ...(currentUserProfile || {}), ...payload };
    window.CURRENT_USER_PROFILE = currentUserProfile;
    _actualizarIdentidadSidebarUsuario();
    _renderPerfilUsuarioActual();
    if (document.getElementById('buzon-modal')?.classList.contains('active')) {
      renderContactos();
      if (activeChatUser) _actualizarHeaderChatActivo();
    }
    showToast('Foto de perfil eliminada.', 'success');
  } catch (error) {
    console.error('No se pudo eliminar el avatar del perfil:', error);
    showToast('No se pudo eliminar tu foto de perfil.', 'error');
  }
}

function abrirBuzon() {
  console.log('[DEBUG] abrirBuzon called, modal:', document.getElementById('buzon-modal'));
  const _buzonEl = document.getElementById('buzon-modal');
  if (!_buzonEl) { console.error('[DEBUG] buzon-modal no encontrado en el DOM'); return; }
  _buzonEl.classList.add('active');
  _loadChatArchivedThreads();
  _chatArchivedMode = false;

  // En mobile: ocultar el panel de chat al abrir (slide-out)
  const win = document.getElementById('chat-window-view');
  if (window.innerWidth <= 768) {
    win.style.transform = 'translateX(100%)';
    win.classList.remove('open');
  }

  activeChatUser = null;

  // Empty state visible, chat oculto
  const emptyState = document.getElementById('chat-empty-state');
  const chatHeader = document.getElementById('chat-active-header');
  const chatMessages = document.getElementById('chat-messages-container');
  const chatInputBar = document.getElementById('chat-input-bar');
  if (emptyState) emptyState.style.display = 'flex';
  if (chatHeader) chatHeader.style.display = 'none';
  if (chatMessages) chatMessages.style.display = 'none';
  if (chatInputBar) chatInputBar.style.display = 'none';

  // Nombre de usuario en el panel header (usa el nombre del usuario actual)
  const panelUsername = document.getElementById('chatPanelUsername');
  if (panelUsername) panelUsername.textContent = USER_NAME || 'Mensajes';

  const lbl = document.getElementById('chatv2-company-label');
  if (lbl) lbl.innerText = _companyNameFrom(window.MEX_CONFIG?.empresa);
  cerrarInfoContacto();
  _renderChatFilterOptions();
  _actualizarHeaderChatActivo();
  renderContactos();
  _startChatListener();
}

function _stopChatListener() {
  _chatListenerUnsubs.forEach(u => u && u());
  _chatListenerUnsubs = [];
}

function _startChatListener() {
  _stopChatListener();
  const me = USER_NAME.trim().toUpperCase();
  let _sentMsgs = [];
  let _recvMsgs = [];

  function _mergeAndRender() {
    const seen = new Set();
    allChatMessages = [..._sentMsgs, ..._recvMsgs]
      .filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
      .sort((a, b) => _chatMessageTimestamp(b) - _chatMessageTimestamp(a))
      .map(m => ({ ...m, esMio: _chatUserName(m.remitente) === me, leido: m.leido === true || m.leido === 'SI' }));
    renderContactos();
    if (activeChatUser) renderChatWindow();
  }

  _chatListenerUnsubs.push(
    db.collection('mensajes').where('remitente', '==', me)
      .orderBy('timestamp', 'desc').limit(300)
      .onSnapshot(snap => {
        _sentMsgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _mergeAndRender();
      }, err => console.error('chat:sent', err))
  );

  _chatListenerUnsubs.push(
    db.collection('mensajes').where('destinatario', '==', me)
      .orderBy('timestamp', 'desc').limit(300)
      .onSnapshot(snap => {
        _recvMsgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _mergeAndRender();
      }, err => console.error('chat:recv', err))
  );
}

function _linkifyText(text) {
  const urlPattern = /(https?:\/\/[^\s<]+)/g;
  return text.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function renderContactos() {
  const container = document.getElementById('listaContactosContainer');
  if (!container) return;

  _renderChatFilterOptions();
  const hintEl = document.getElementById('chatContactsHint');
  const { term, plaza, rol, status, hasFilters } = _chatFilterState();

  const ultimosMensajes = {};
  const noLeidos = {};
  const lastMessageTs = {};

  // Agrupamos los mensajes por conversación
  allChatMessages.forEach(m => {
    const elOtro = _chatUserName(m.esMio ? m.destinatario : m.remitente);
    if (!elOtro) return;
    const ts = _chatMessageTimestamp(m);
    if (!ultimosMensajes[elOtro] || ts > (lastMessageTs[elOtro] || 0)) {
      ultimosMensajes[elOtro] = m;
      lastMessageTs[elOtro] = ts;
    }
    if (typeof noLeidos[elOtro] !== 'number') noLeidos[elOtro] = 0;
    if (!m.esMio && !m.leido) noLeidos[elOtro]++;
  });

  const miNombre = _chatUserName(USER_NAME);
  const usuariosMap = new Map();

  dbUsuariosLogin
    .filter(user => _chatUserName(user.usuario || user.nombre) !== miNombre)
    .forEach(user => {
      usuariosMap.set(_chatUserName(user.usuario || user.nombre), user);
    });

  Object.keys(ultimosMensajes).forEach(nombre => {
    if (!usuariosMap.has(nombre) && nombre !== miNombre) {
      usuariosMap.set(nombre, {
        usuario: nombre,
        nombre: nombre,
        email: '',
        rol: '',
        roleLabel: 'Sin perfil',
        plazaAsignada: '',
        status: 'ACTIVO',
        telefono: '',
        isOnline: false,
        lastSeenAt: 0,
        avatarUrl: ''
      });
    }
  });

  let usuariosMostrar = Array.from(usuariosMap.values()).filter(user => {
    const nombre = _chatUserName(user.usuario || user.nombre);
    const samePlaza = plaza ? _normalizePlaza(user.plazaAsignada) === plaza : true;
    const sameRole = rol ? _sanitizeRole(user.rol) === rol : true;
    const sameStatus = status ? String(user.status || 'ACTIVO').trim().toUpperCase() === status : true;
    const hasConversation = Boolean(ultimosMensajes[nombre]);
    const isArchived = hasConversation && _chatIsArchived(nombre, lastMessageTs[nombre]);
    const inDefaultScope = _normalizePlaza(user.plazaAsignada) === _normalizePlaza(_miPlaza()) || hasConversation || nombre === _chatUserName(activeChatUser);
    const searchable = [
      user.usuario,
      user.nombre,
      user.email,
      user.plazaAsignada,
      user.roleLabel,
      user.rol,
      user.status
    ].some(value => String(value || '').toLowerCase().includes(term));

    if (!samePlaza || !sameRole || !sameStatus) return false;
    if (term && !searchable) return false;
    if (_chatArchivedMode) return hasConversation && isArchived;
    if (isArchived) return false;
    return hasFilters ? true : inDefaultScope;
  });

  usuariosMostrar.sort((a, b) => {
    const nameA = _chatUserName(a.usuario || a.nombre);
    const nameB = _chatUserName(b.usuario || b.nombre);
    let unreadA = noLeidos[nameA] || 0;
    let unreadB = noLeidos[nameB] || 0;
    if (unreadA !== unreadB) return unreadB - unreadA;

    let msgA = ultimosMensajes[nameA];
    let msgB = ultimosMensajes[nameB];

    if (msgA && msgB) {
      return _chatMessageTimestamp(msgB) - _chatMessageTimestamp(msgA);
    }
    if (msgA && !msgB) return -1;
    if (!msgA && msgB) return 1;

    const plazaA = _normalizePlaza(a.plazaAsignada);
    const plazaB = _normalizePlaza(b.plazaAsignada);
    const miPlaza = _normalizePlaza(_miPlaza());
    const plazaScoreA = plazaA && plazaA === miPlaza ? 1 : 0;
    const plazaScoreB = plazaB && plazaB === miPlaza ? 1 : 0;
    if (plazaScoreA !== plazaScoreB) return plazaScoreB - plazaScoreA;

    const onlineA = _userPresenceIsOnline(a) ? 1 : 0;
    const onlineB = _userPresenceIsOnline(b) ? 1 : 0;
    if (onlineA !== onlineB) return onlineB - onlineA;

    return nameA.localeCompare(nameB);
  });

  const archivedCount = Object.keys(lastMessageTs)
    .filter(nombre => _chatIsArchived(nombre, lastMessageTs[nombre]))
    .length;
  _syncChatArchiveUi({ archivedCount, visibleCount: usuariosMostrar.length });

  if (hintEl) {
    if (_chatArchivedMode) {
      hintEl.innerText = archivedCount > 0
        ? `${usuariosMostrar.length} chat${usuariosMostrar.length === 1 ? '' : 's'} archivado${usuariosMostrar.length === 1 ? '' : 's'} listo${usuariosMostrar.length === 1 ? '' : 's'} para restaurar.`
        : 'No tienes conversaciones archivadas.';
    } else {
      const baseHint = hasFilters
        ? 'Búsqueda global habilitada.'
        : 'Mostrando tu plaza y chats existentes.';
      hintEl.innerText = `${usuariosMostrar.length} contacto${usuariosMostrar.length === 1 ? '' : 's'} · ${baseHint}${archivedCount ? ` · ${archivedCount} archivado${archivedCount === 1 ? '' : 's'}` : ''}`;
    }
  }

  if (usuariosMostrar.length === 0) {
    const emptyCopy = _chatArchivedMode
      ? 'No hay conversaciones archivadas por ahora.'
      : (hasFilters ? 'No hay contactos que coincidan con tu búsqueda.' : 'No hay contactos disponibles en tu plaza todavía.');
    container.innerHTML = `<div style="text-align:center; padding:34px 20px; color:#64748b; font-weight:700; border:1px dashed #dbe4ee; border-radius:20px; background:#f8fbff;">${emptyCopy}</div>`;
    return;
  }

  container.innerHTML = usuariosMostrar.map(u => {
    const uName = _chatUserName(u.usuario || u.nombre);
    const unread = noLeidos[uName] || 0;
    const lastMsg = ultimosMensajes[uName];
    const lastTs = lastMessageTs[uName] || 0;
    const isArchived = Boolean(lastMsg) && _chatIsArchived(uName, lastTs);
    const avatar = _buildAvatarMarkup(u, uName);
    const online = _userPresenceIsOnline(u);
    const plazaLabel = _normalizePlaza(u.plazaAsignada || '') || 'Sin plaza';
    const roleLabel = u.roleLabel || u.rol || 'Sin rol';
    const encodedName = encodeURIComponent(uName);
    const activeClass = _chatUserName(activeChatUser) === uName ? ' active' : '';
    const unreadClass = unread > 0 ? ' unread' : '';
    const archivedClass = isArchived ? ' archived' : '';

    let snippet = lastMsg ? _chatMessageSnippet(lastMsg) : 'Toca para iniciar conversación';
    let dateStr = '';
    let dateClass = 'chat-contact-time';
    let unreadBadge = '';
    let snippetClass = 'chat-contact-snippet';
    const presenceClass = online ? 'online' : 'offline';
    const presenceLabel = online ? 'En línea' : 'Sin conexión';
    const summaryLine = `${roleLabel} · ${plazaLabel}`;

    if (lastMsg) {
      const rawText = _chatMessageSnippet(lastMsg);
      const raw = lastMsg.esMio ? `Tú: ${rawText}` : rawText;
      snippet = raw.length > 58 ? raw.substring(0, 58) + "…" : raw;
      dateStr = _chatListTimeLabel(lastTs);
    } else if (online) {
      dateStr = 'En línea';
    }

    if (unread > 0) {
      unreadBadge = `<span class="chat-contact-badge unread">${unread}</span>`;
      snippetClass += ' unread';
      dateClass += ' has-unread';
    }

    const archivedBadge = isArchived ? `<span class="chat-contact-mini-badge">Archivado</span>` : '';
    const infoButton = `
      <button class="chat-contact-action" type="button" data-user-id="${escapeHtml(u.email || uName)}"
        onclick="event.stopPropagation(); abrirInfoContacto(this.dataset.userId)" title="Ver contacto">
        <span class="material-icons" style="font-size:16px;">info</span>
      </button>
    `;
    const archiveButton = lastMsg
      ? `
        <button class="chat-contact-action${isArchived ? ' restore' : ''}" type="button"
          onclick="event.stopPropagation(); ${isArchived ? `_restoreChatConversation(decodeURIComponent('${encodedName}'))` : `_archiveChatConversation(decodeURIComponent('${encodedName}'), ${lastTs})`}"
          title="${isArchived ? 'Restaurar conversación' : 'Archivar conversación'}">
          <span class="material-icons" style="font-size:16px;">${isArchived ? 'unarchive' : 'delete_outline'}</span>
        </button>
      `
      : '';

    return `
      <div class="chat-contact${activeClass}${unreadClass}${archivedClass}" data-chat-name="${escapeHtml(uName)}" onclick="abrirChat(this.dataset.chatName)">
        <button class="chat-avatar chat-avatar-button" data-user-id="${escapeHtml(u.email || uName)}"
          onclick="event.stopPropagation(); abrirInfoContacto(this.dataset.userId)"
          style="background:${avatar.background}; width:48px; height:48px; font-size:18px; flex-shrink:0;">
          ${avatar.html}
          <span class="chat-presence-dot ${online ? 'online' : 'offline'}"></span>
        </button>
        <div class="chat-contact-main">
          <div class="chat-contact-top">
            <div class="chat-contact-heading">
              <div class="chat-contact-name-row">
                <span class="chat-contact-name">${escapeHtml(uName)}</span>
                ${archivedBadge}
              </div>
              <div class="chat-contact-subline">${escapeHtml(summaryLine)}</div>
            </div>
            <div class="chat-contact-side">
              <span class="${dateClass}">${escapeHtml(dateStr || '')}</span>
              ${unreadBadge}
            </div>
          </div>
          <div class="chat-contact-bottom">
            <span class="${snippetClass}" title="${escapeHtml(snippet)}">${escapeHtml(snippet)}</span>
            <div class="chat-contact-actions">
              <span class="chat-contact-presence ${presenceClass}">
                <span class="material-icons" style="font-size:12px;">${online ? 'circle' : 'schedule'}</span>
                ${escapeHtml(presenceLabel)}
              </span>
              ${infoButton}
              ${archiveButton}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function abrirChat(nombre) {
  activeChatUser = _chatUserName(nombre);
  _actualizarHeaderChatActivo();

  // En mobile: slide-in con transform
  const win = document.getElementById('chat-window-view');
  if (window.innerWidth <= 768) {
    win.style.transform = 'translateX(0)';
    win.classList.add('open');
  } else {
    win.style.transform = '';
  }

  // Mostrar elementos del chat activo, ocultar empty state
  const emptyState = document.getElementById('chat-empty-state');
  const chatHeader = document.getElementById('chat-active-header');
  const chatMessages = document.getElementById('chat-messages-container');
  const chatInputBar = document.getElementById('chat-input-bar');
  if (emptyState) emptyState.style.display = 'none';
  if (chatHeader) chatHeader.style.display = 'flex';
  if (chatMessages) chatMessages.style.display = 'block';
  if (chatInputBar) chatInputBar.style.display = 'flex';

  // Actualizar nombre del usuario en el panel header
  const panelUsername = document.getElementById('chatPanelUsername');
  if (panelUsername && window._currentChatProfile?.nombre) {
    panelUsername.textContent = window._currentChatProfile.nombre;
  }

  const input = document.getElementById('chat-input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }
  _clearChatStaging();

  let idsToMark = [];
  allChatMessages.forEach(m => {
    let rem = _chatUserName(m.remitente);
    if (rem === activeChatUser && !m.leido && !m.esMio) {
      m.leido = true;
      idsToMark.push(m.id);
    }
  });

  renderChatWindow();

  if (idsToMark.length > 0) {
    api.marcarMensajesLeidosArray(idsToMark).then(hacerPingNotificaciones).catch(e => console.error(e));
  }
}



function cerrarChat() {
  activeChatUser = null;

  const win = document.getElementById('chat-window-view');
  if (window.innerWidth <= 768) {
    win.style.transform = 'translateX(100%)';
    win.classList.remove('open');
  }

  // En desktop: restaurar el empty state
  const emptyState = document.getElementById('chat-empty-state');
  const chatHeader = document.getElementById('chat-active-header');
  const chatMessages = document.getElementById('chat-messages-container');
  const chatInputBar = document.getElementById('chat-input-bar');
  if (emptyState) emptyState.style.display = 'flex';
  if (chatHeader) chatHeader.style.display = 'none';
  if (chatMessages) chatMessages.style.display = 'none';
  if (chatInputBar) chatInputBar.style.display = 'none';

  // Restaurar nombre del panel
  const panelUsername = document.getElementById('chatPanelUsername');
  if (panelUsername) panelUsername.textContent = 'Mensajes';

  _actualizarHeaderChatActivo();
  renderContactos(); // Refresca los snippets
}

function _setChatReplyHoverState(bubbleId, visible) {
  const bubble = document.getElementById(`bubble-${bubbleId}`);
  if (!bubble) return;

  const prevTimer = _chatReplyHoverTimers.get(bubbleId);
  if (prevTimer) {
    clearTimeout(prevTimer);
    _chatReplyHoverTimers.delete(bubbleId);
  }

  if (visible) {
    bubble.classList.add('reply-visible');
    return;
  }

  const timer = setTimeout(() => {
    bubble.classList.remove('reply-visible');
    _chatReplyHoverTimers.delete(bubbleId);
  }, 1500);
  _chatReplyHoverTimers.set(bubbleId, timer);
}

function renderChatWindow() {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;
  _actualizarHeaderChatActivo();

  let history = allChatMessages.filter(m =>
    _chatUserName(m.remitente) === activeChatUser ||
    _chatUserName(m.destinatario) === activeChatUser
  ).reverse();

  if (history.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:40px 20px; color:#94a3b8; font-weight:600; font-size:12px; background:white; border-radius:16px; border:1px solid #f1f5f9; margin-top:20px;">
          <span class="material-icons" style="font-size:32px; display:block; margin-bottom:8px; color:#cbd5e1;">chat_bubble_outline</span>
          Inicio de la conversación con ${activeChatUser}<br><br>Escribe un mensaje para comenzar.</div>`;
    return;
  }

  container.innerHTML = history.map(m => {
    const typeClass = m.esMio ? "sent" : "received";
    const mIdSafe = String(m.id).replace(/[^a-zA-Z0-9_-]/g, '_');

    let checkIcon = "";
    if (m.esMio) {
      checkIcon = m.leido ?
        `<span class="material-icons" style="font-size:12px; color:#93c5fd;">done_all</span>` :
        `<span class="material-icons" style="font-size:12px; opacity:0.5;">done</span>`;
    }

    let partesFecha = String(m.fecha || "").split(' ');
    let horaLimpia = partesFecha.length > 1 ? partesFecha[1] : "";

    // ── Reply quote context ──
    let replyHtml = "";
    if (m.replyTo) {
      const rqText = escapeHtml(String(m.replyTo.mensaje || "").substring(0, 80));
      const rqAuthor = escapeHtml(m.replyTo.remitente || "");
      replyHtml = `<div class="chat-reply-quote">
            <div class="rq-author">${rqAuthor}</div>
            <div class="rq-text">${rqText}</div>
          </div>`;
    }

    // ── Message text (hide if it's just the auto-file label and file is present) ──
    let msgText = m.mensaje || "";
    if (m.archivoUrl && msgText === `📎 ${m.archivoNombre}`) msgText = "";
    let contenido = msgText ? _linkifyText(escapeHtml(msgText)) : "";

    // ── File/media attachment ──
    let fileHtml = "";
    if (m.archivoUrl) {
      const nom = m.archivoNombre || '';
      const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(nom);
      const isAudio = /\.(ogg|mp3|wav|m4a|webm)$/i.test(nom);
      if (isImg) {
        fileHtml = `<div style="margin-top:${contenido ? 4 : 0}px;">
              <img class="chat-img-thumb" src="${m.archivoUrl}" alt="${escapeHtml(nom)}"
                onclick="abrirLightboxChat('${m.archivoUrl}')">
            </div>`;
      } else if (isAudio) {
        fileHtml = `<div class="chat-audio-card">
              <span class="material-icons audio-icon">graphic_eq</span>
              <audio controls src="${m.archivoUrl}"></audio>
            </div>`;
      } else {
        const ext = nom.split('.').pop().toUpperCase();
        const docIcon = _docIconForExt(ext);
        fileHtml = `<div class="chat-doc-card">
              <span class="material-icons doc-icon">${docIcon}</span>
              <div class="doc-info">
                <div class="doc-name">${escapeHtml(nom || 'Archivo')}</div>
                <div class="doc-ext">${ext}</div>
              </div>
              <a class="doc-dl" href="${m.archivoUrl}" target="_blank" rel="noopener" download title="Descargar">
                <span class="material-icons" style="font-size:16px;">download</span>
              </a>
            </div>`;
      }
    }

    // ── Reactions ──
    let reactionsHtml = "";
    const reacs = m.reacciones || {};
    const reacEntries = Object.entries(reacs).filter(([, users]) => users && users.length > 0);
    if (reacEntries.length > 0 || true) {
      const reacBtns = reacEntries.map(([emoji, users]) => {
        const mine = users.includes(USER_NAME) ? " mine" : "";
        const whoStr = users.join(', ');
        return `<button class="chat-reaction-btn${mine}" title="${escapeHtml(whoStr)}"
              onclick="toggleReaccionChat('${mIdSafe}','${emoji}')">${emoji}<span class="rc-count">${users.length}</span></button>`;
      }).join('');
      reactionsHtml = `<div class="chat-reactions">
            ${reacBtns}
            <button class="chat-add-reaction" onclick="mostrarEmojiPickerReaccion('${mIdSafe}',this)" title="Reaccionar">😊</button>
          </div>`;
    }

    // ── Edit/Delete options (own messages) ──
    let opcionesNav = "";
    if (m.esMio) {
      opcionesNav = `
            <div class="chat-options-menu" style="position: absolute; top: -5px; right: -5px; opacity: 0; display: flex; gap: 4px; transition: 0.2s;">
               <button onclick="editarMensajeChat('${m.id}')" title="Editar" style="background: white; border: 1px solid #e2e8f0; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #64748b; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"><span class="material-icons" style="font-size:12px;">edit</span></button>
               <button onclick="eliminarMensajeChat('${m.id}')" title="Borrar" style="background: white; border: 1px solid #e2e8f0; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #ef4444; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"><span class="material-icons" style="font-size:12px;">delete</span></button>
            </div>
          `;
    }

    // ── Reply button ──
    const replyBtn = `<button class="chat-reply-btn" onclick="iniciarRespuestaChat('${mIdSafe}')" title="Responder">
          <span class="material-icons" style="font-size:14px;">reply</span>
        </button>`;

    return `
       <div class="chat-bubble ${typeClass}" id="bubble-${mIdSafe}"
         onmouseenter="_setChatReplyHoverState('${mIdSafe}', true); this.querySelector('.chat-options-menu') ? this.querySelector('.chat-options-menu').style.opacity = 1 : null"
         onmouseleave="_setChatReplyHoverState('${mIdSafe}', false); this.querySelector('.chat-options-menu') ? this.querySelector('.chat-options-menu').style.opacity = 0 : null"
         onfocusin="_setChatReplyHoverState('${mIdSafe}', true)"
         onfocusout="_setChatReplyHoverState('${mIdSafe}', false)">
          ${replyHtml}${contenido}${fileHtml}
          ${opcionesNav}
          ${replyBtn}
          <span class="chat-time">${horaLimpia} ${checkIcon}</span>
          ${reactionsHtml}
       </div>
     `;
  }).join('');

  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 50);
}

function _docIconForExt(ext) {
  const e = (ext || '').toLowerCase();
  if (['pdf'].includes(e)) return 'picture_as_pdf';
  if (['doc', 'docx'].includes(e)) return 'description';
  if (['xls', 'xlsx'].includes(e)) return 'table_chart';
  if (['ppt', 'pptx'].includes(e)) return 'slideshow';
  return 'insert_drive_file';
}


async function editarMensajeChat(idMsg) {
  const msg = allChatMessages.find(m => m.id == idMsg);
  if (!msg) return;
  const act = prompt("Edita tu mensaje:", msg.mensaje);
  if (act && act !== msg.mensaje) {
    msg.mensaje = act;
    renderChatWindow();
    try {
      await api.editarMensajeChatDb(idMsg.toString(), act);
      showToast("Mensaje editado.", "success");
    } catch (e) {
      showToast("Error al editar", "error");
    }
  }
}

async function eliminarMensajeChat(idMsg) {
  const ok = await mexConfirm("Confirmación", "¿Borrar este mensaje para todos?", "warning");
  if (!ok) return;
  allChatMessages = allChatMessages.filter(m => m.id != idMsg);
  renderChatWindow();
  try {
    await api.eliminarMensajeChatDb(idMsg.toString());
    showToast("Mensaje borrado.", "info");
  } catch (e) {
    showToast("Error al borrar", "error");
  }
}

async function enviarMensajeChat() {
  const input = document.getElementById('chat-input');
  const txt = input.value.trim();
  if (!txt && !pendingChatFile && !pendingAudioBlob) return;
  if (!activeChatUser) return;
  _restoreChatConversation(activeChatUser, { silent: true });

  input.value = "";
  input.style.height = "auto";
  input.focus();

  const tempId = Date.now();
  const now = new Date();
  const tempDate = ("0" + now.getDate()).slice(-2) + "/" + ("0" + (now.getMonth() + 1)).slice(-2) + "/" + now.getFullYear() + " " + ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);

  const capturedReply = replyingToMsg ? { ...replyingToMsg } : null;

  // ── Upload pending file or audio ──
  let archivoUrl = null, archivoNombre = null;
  if (pendingChatFile) {
    const file = pendingChatFile.file;
    const ts2 = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    try {
      showToast("Subiendo archivo...", "info");
      const snap = await firebase.storage().ref(`mensajes_chat/${ts2}-${safeName}`).put(file);
      archivoUrl = await snap.ref.getDownloadURL();
      archivoNombre = file.name;
    } catch (e) {
      console.error("Error upload chat file:", e);
      showToast("Error al subir archivo", "error");
      return;
    }
  } else if (pendingAudioBlob) {
    const ts2 = Date.now();
    const extension = pendingAudioBlob.extension || _chatAudioExtensionFromMime(pendingAudioBlob.mimeType);
    const contentType = pendingAudioBlob.mimeType || `audio/${extension}`;
    const fname = `audio_${ts2}.${extension}`;
    try {
      showToast("Subiendo audio...", "info");
      const snap = await firebase.storage().ref(`mensajes_chat/${ts2}-${fname}`).put(pendingAudioBlob.blob, { contentType });
      archivoUrl = await snap.ref.getDownloadURL();
      archivoNombre = fname;
    } catch (e) {
      console.error("Error upload audio:", e);
      showToast("Error al subir audio", "error");
      return;
    }
  }

  _clearChatStaging();

  const finalTxt = txt || (archivoNombre ? "" : "");

  const msgLocal = {
    id: tempId, fecha: tempDate, remitente: USER_NAME, destinatario: activeChatUser,
    mensaje: finalTxt, leido: false, esMio: true,
    replyTo: capturedReply || undefined
  };
  if (archivoUrl) { msgLocal.archivoUrl = archivoUrl; msgLocal.archivoNombre = archivoNombre; }

  allChatMessages.unshift(msgLocal);
  renderChatWindow();

  api.enviarMensajePrivado(USER_NAME, activeChatUser, finalTxt, archivoUrl, archivoNombre, capturedReply)
    .then(() => hacerPingNotificaciones()).catch(e => console.error(e));
}

// Stage a selected file (no auto-send)
function stagedArchivoChatV2(inputEl) {
  if (!inputEl.files || !inputEl.files[0]) return;
  const file = inputEl.files[0];
  if (file.size > 10 * 1024 * 1024) {
    showToast("Archivo demasiado grande (máx 10MB)", "error");
    inputEl.value = "";
    return;
  }
  const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
  const previewUrl = isImg ? URL.createObjectURL(file) : null;
  pendingChatFile = { file, previewUrl, isImg };
  _renderStagingArea();
  inputEl.value = "";
  document.getElementById('chat-input').focus();
}

function _clearChatStaging() {
  if (pendingChatFile && pendingChatFile.previewUrl) URL.revokeObjectURL(pendingChatFile.previewUrl);
  if (pendingAudioBlob && pendingAudioBlob.localUrl) URL.revokeObjectURL(pendingAudioBlob.localUrl);
  pendingChatFile = null;
  pendingAudioBlob = null;
  replyingToMsg = null;
  _renderStagingArea();
}

function _renderStagingArea() {
  const area = document.getElementById('chatStagingArea');
  if (!area) return;
  const chips = [];

  // ── Recording in progress: show spectrum canvas ──
  const isRecordingNow = chatMediaRecorder && chatMediaRecorder.state === 'recording';
  if (isRecordingNow) {
    chips.push(`<div class="chatv2-staging-chip" style="gap:10px; padding:8px 12px;">
          <span class="material-icons" style="color:#ef4444; font-size:18px; animation:micPulse 1s infinite;">mic</span>
          <canvas id="chatSpectrumCanvas" width="180" height="30" style="flex:1; border-radius:4px;"></canvas>
          <span style="font-size:11px; color:#ef4444; font-weight:700;" id="chatRecordTimer">0:00</span>
          <button class="chip-cancel" style="background:#fee2e2; border-radius:6px; width:auto; padding:0 6px; height:24px; color:#ef4444;"
            onclick="toggleGrabacionChat()">
            <span class="material-icons" style="font-size:14px;">stop</span>
          </button>
        </div>`);
    area.innerHTML = chips.join('');
    area.classList.add('active');
    _dibujarEspectroGrabacion();
    _iniciarTimerGrabacion();
    return;
  }

  // ── Reply context ──
  if (replyingToMsg) {
    chips.push(`<div class="chatv2-staging-chip chatv2-reply-chip">
          <span class="material-icons chip-icon" style="color:#1d4ed8; font-size:16px;">reply</span>
          <div style="flex:1; overflow:hidden;">
            <div style="font-size:10px; color:#1d4ed8; font-weight:800;">${escapeHtml(replyingToMsg.remitente)}</div>
            <div class="chip-name" style="font-size:11px; color:#475569;">${escapeHtml(String(replyingToMsg.mensaje || '').substring(0, 60))}</div>
          </div>
          <button class="chip-cancel" onclick="cancelarRespuestaChat()">
            <span class="material-icons" style="font-size:14px;">close</span>
          </button>
        </div>`);
  }

  // ── Pending file ──
  if (pendingChatFile) {
    const f = pendingChatFile;
    const imgEl = f.isImg && f.previewUrl
      ? `<img src="${f.previewUrl}" alt="preview">`
      : `<span class="material-icons chip-icon">insert_drive_file</span>`;
    chips.push(`<div class="chatv2-staging-chip">
          ${imgEl}
          <span class="chip-name">${escapeHtml(f.file.name)}</span>
          <span style="font-size:10px; color:#94a3b8; flex-shrink:0;">${(f.file.size / 1024).toFixed(0)} KB</span>
          <button class="chip-cancel" onclick="cancelarArchivoChat()">
            <span class="material-icons" style="font-size:14px;">close</span>
          </button>
        </div>`);
  }

  // ── Pending audio (preview before send) ──
  if (pendingAudioBlob) {
    chips.push(`<div class="chatv2-staging-chip" style="flex-direction:column; align-items:stretch; gap:6px; padding:10px 12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="material-icons" style="color:#1d4ed8; font-size:20px;">graphic_eq</span>
            <audio controls src="${pendingAudioBlob.localUrl}" style="flex:1; height:32px; max-width:220px;"></audio>
            <button class="chip-cancel" onclick="cancelarAudioChat()">
              <span class="material-icons" style="font-size:14px;">delete</span>
            </button>
          </div>
          <div style="font-size:10px; color:#64748b; font-weight:600; text-align:center;">
            Escucha tu audio · luego presiona <strong>enviar →</strong>
          </div>
        </div>`);
  }

  area.innerHTML = chips.join('');
  area.classList.toggle('active', chips.length > 0);
}

let _recTimerInterval = null;
function _iniciarTimerGrabacion() {
  if (_recTimerInterval) clearInterval(_recTimerInterval);
  const start = Date.now();
  _recTimerInterval = setInterval(() => {
    const el = document.getElementById('chatRecordTimer');
    if (!el) { clearInterval(_recTimerInterval); return; }
    const s = Math.floor((Date.now() - start) / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
}

function cancelarArchivoChat() {
  if (pendingChatFile && pendingChatFile.previewUrl) URL.revokeObjectURL(pendingChatFile.previewUrl);
  pendingChatFile = null;
  _renderStagingArea();
}

function cancelarRespuestaChat() {
  replyingToMsg = null;
  _renderStagingArea();
}

// ── Reply ──
function iniciarRespuestaChat(mIdSafe) {
  // Find message by safe id (convert back)
  const msg = allChatMessages.find(m => String(m.id).replace(/[^a-zA-Z0-9_-]/g, '_') === mIdSafe);
  if (!msg) return;
  replyingToMsg = { id: msg.id, remitente: msg.remitente, mensaje: msg.mensaje };
  _renderStagingArea();
  document.getElementById('chat-input').focus();
}

// ── Lightbox ──
function abrirLightboxChat(url) {
  const lb = document.getElementById('chatLightboxOverlay');
  const img = document.getElementById('chatLightboxImg');
  const dl = document.getElementById('chatLightboxDownload');
  if (!lb || !img) return;
  img.src = url;
  if (dl) dl.href = url;
  lb.style.display = 'flex';
}
function cerrarLightboxChat() {
  const lb = document.getElementById('chatLightboxOverlay');
  if (lb) lb.style.display = 'none';
}

// ── Emoji Reactions ──
const EMOJI_LIST = ["😀", "😂", "😍", "🥰", "😎", "😢", "😡", "👍", "👎", "❤️", "🔥", "🎉", "✅", "🙏", "😮", "🤔", "💯", "🚀", "💪", "😴", "😅", "🤣", "🤩", "😇", "😏", "🥳", "😤", "🤯", "👏", "🙌", "🤝", "💔", "💥", "⭐", "🌟", "✨", "🎁", "🎊", "🎈", "💡", "📌", "📎", "🔒", "🔑", "📢", "💬", "📱", "💻", "🖥️", "📊", "📈", "🚗", "🏠", "🌍", "🍕", "☕", "🍺", "🌈", "☀️", "❄️", "🌙", "⚡", "🌊", "🐶", "🐱", "😻", "👀", "🫡", "🫶", "🤌", "💀", "👻", "🤖", "🦊", "🦁", "🐸", "🍀", "🌸", "🌺", "🎵", "🎶", "🎸", "🏆", "⚽", "🏀", "🎮", "🎯", "🎲", "📚", "✏️", "🔎", "🧩", "🧠", "💊", "🌡️", "🛒", "🎬", "📸", "🖼️", "🗺️", "⏰", "📅", "🔔", "🔕", "❓", "❗", "⚠️", "🆕", "🆓", "🆙", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪"];

let emojiPickerTimeout = null;

function mostrarEmojiPickerReaccion(mIdSafe, btn) {
  const panel = document.getElementById('chatEmojiPickerPanel');
  if (!panel) return;

  // Toggle off if same message
  if (emojiPickerTarget === mIdSafe && panel.classList.contains('active')) {
    panel.classList.remove('active');
    emojiPickerTarget = null;
    return;
  }

  emojiPickerTarget = mIdSafe;

  panel.innerHTML = `
        <input class="emoji-picker-search" type="text" placeholder="Buscar emoji..." id="emojiSearch"
          oninput="_filtrarEmojisReaccion()">
        <div class="emoji-picker-grid" id="emojiGrid"></div>
      `;
  _renderEmojiGrid(mIdSafe, '');
  panel.classList.add('active');
  setTimeout(() => { const inp = document.getElementById('emojiSearch'); if (inp) inp.focus(); }, 50);
}

function _renderEmojiGrid(mIdSafe, filter) {
  const grid = document.getElementById('emojiGrid');
  if (!grid) return;
  const filtered = filter ? EMOJI_LIST.filter(em => em.includes(filter)) : EMOJI_LIST;
  grid.innerHTML = filtered.map(em => {
    const safeEm = em.replace(/'/g, "\\'");
    return `<button onclick="toggleReaccionChat('${mIdSafe}','${safeEm}'); cerrarEmojiPickerReaccion();">${em}</button>`;
  }).join('');
}

function _filtrarEmojisReaccion() {
  const inp = document.getElementById('emojiSearch');
  const val = inp ? inp.value.trim() : '';
  if (emojiPickerTarget) _renderEmojiGrid(emojiPickerTarget, val);
}

function cerrarEmojiPickerReaccion() {
  const panel = document.getElementById('chatEmojiPickerPanel');
  if (panel) panel.classList.remove('active');
  emojiPickerTarget = null;
}

async function toggleReaccionChat(mIdSafe, emoji) {
  const msg = allChatMessages.find(m => String(m.id).replace(/[^a-zA-Z0-9_-]/g, '_') === mIdSafe);
  if (!msg) return;

  if (!msg.reacciones) msg.reacciones = {};
  if (!msg.reacciones[emoji]) msg.reacciones[emoji] = [];

  const idx = msg.reacciones[emoji].indexOf(USER_NAME);
  if (idx === -1) {
    msg.reacciones[emoji].push(USER_NAME);
  } else {
    msg.reacciones[emoji].splice(idx, 1);
    if (msg.reacciones[emoji].length === 0) delete msg.reacciones[emoji];
  }

  renderChatWindow();

  try {
    await api.actualizarReaccionesChatDb(String(msg.id), msg.reacciones);
  } catch (e) {
    console.warn("Error guardando reacción:", e);
  }
}

// ── Audio recording con espectro ──
async function toggleGrabacionChat() {
  if (chatMediaRecorder && chatMediaRecorder.state === 'recording') {
    try {
      if (typeof chatMediaRecorder.requestData === 'function') chatMediaRecorder.requestData();
    } catch (_) { }
    chatMediaRecorder.stop();
    if (_chatSpectrumRaf) cancelAnimationFrame(_chatSpectrumRaf);
    return;
  }
  if (typeof window.MediaRecorder === 'undefined') {
    showToast("Tu navegador no soporta grabación de audio en tiempo real", "error");
    return;
  }
  if (!navigator.mediaDevices && !navigator.getUserMedia && !navigator.webkitGetUserMedia && !navigator.mozGetUserMedia) {
    showToast("Tu navegador no soporta grabación de audio", "error");
    return;
  }
  try {
    const stream = await _chatGetUserMediaAudio();
    chatAudioChunks = [];

    // AudioContext para el espectro (si no está disponible, grabamos sin visualizador).
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) {
        _chatAudioCtx = new AudioCtor();
        _chatAnalyser = _chatAudioCtx.createAnalyser();
        _chatAnalyser.fftSize = 64;
        const source = _chatAudioCtx.createMediaStreamSource(stream);
        source.connect(_chatAnalyser);
      } else {
        _chatAudioCtx = null;
        _chatAnalyser = null;
      }
    } catch (_) {
      _chatAudioCtx = null;
      _chatAnalyser = null;
    }

    const mimeType = _chatAudioMimeType();
    const recorderOptions = mimeType ? { mimeType } : undefined;
    chatMediaRecorder = new MediaRecorder(stream, recorderOptions);
    chatMediaRecorder.onerror = event => {
      const error = event?.error || null;
      console.error('Error grabando audio de chat:', error || event);
      showToast('El micrófono falló durante la grabación. Reintenta en unos segundos.', 'error');
    };
    chatMediaRecorder.ondataavailable = ev => { if (ev.data.size > 0) chatAudioChunks.push(ev.data); };
    chatMediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (_chatAudioCtx) { _chatAudioCtx.close(); _chatAudioCtx = null; }
      if (_chatSpectrumRaf) { cancelAnimationFrame(_chatSpectrumRaf); _chatSpectrumRaf = null; }
      const micBtn = document.getElementById('chatMicBtn');
      micBtn?.classList.remove('recording');
      const micIcon = micBtn?.querySelector('.material-icons');
      if (micIcon) micIcon.textContent = 'mic';

      if (chatAudioChunks.length === 0) {
        showToast("No se detectó audio. Intenta acercar el micrófono.", "warning");
        return;
      }
      const fallbackMime = /iphone|ipad|ipod|safari/i.test(navigator.userAgent || '') ? 'audio/mp4' : 'audio/webm';
      const finalMime = chatMediaRecorder?.mimeType || chatAudioChunks?.[0]?.type || mimeType || fallbackMime;
      const blob = new Blob(chatAudioChunks, { type: finalMime });
      chatAudioChunks = [];
      if (!blob.size) {
        showToast("No se pudo capturar audio válido.", "error");
        return;
      }
      if (blob.size > 10 * 1024 * 1024) { showToast("Audio demasiado largo (máx 10MB)", "error"); return; }

      // Stage el audio (no auto-enviar)
      if (pendingAudioBlob && pendingAudioBlob.localUrl) URL.revokeObjectURL(pendingAudioBlob.localUrl);
      pendingAudioBlob = {
        blob,
        localUrl: URL.createObjectURL(blob),
        mimeType: finalMime,
        extension: _chatAudioExtensionFromMime(finalMime)
      };
      _renderStagingArea();
    };

    chatMediaRecorder.start(300);
    const micBtn = document.getElementById('chatMicBtn');
    micBtn?.classList.add('recording');
    const micIcon = micBtn?.querySelector('.material-icons');
    if (micIcon) micIcon.textContent = 'stop';

    // Mostrar espectro en staging area
    _renderStagingArea();
    _dibujarEspectroGrabacion();

  } catch (err) {
    const code = Number(err?.code || 0);
    if (code === 1 || String(err?.name || '').toLowerCase().includes('notallowed')) {
      showToast("Permiso de micrófono denegado. Actívalo y vuelve a intentar.", "error");
    } else if (code === 2 || String(err?.name || '').toLowerCase().includes('notfound')) {
      showToast("No encontramos micrófono disponible en este equipo.", "error");
    } else {
      showToast("No se pudo acceder al micrófono", "error");
    }
    console.error(err);
  }
}

function _dibujarEspectroGrabacion() {
  const canvas = document.getElementById('chatSpectrumCanvas');
  if (!canvas || !_chatAnalyser) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const bufLen = _chatAnalyser.frequencyBinCount;
  const dataArr = new Uint8Array(bufLen);

  function draw() {
    _chatSpectrumRaf = requestAnimationFrame(draw);
    _chatAnalyser.getByteFrequencyData(dataArr);
    ctx.clearRect(0, 0, W, H);
    const barW = Math.floor(W / bufLen);
    for (let i = 0; i < bufLen; i++) {
      const v = dataArr[i] / 255;
      const h = v * H;
      const r = Math.round(239 - v * 80);
      const g = Math.round(68 + v * 50);
      ctx.fillStyle = `rgb(${r},${g},68)`;
      ctx.fillRect(i * barW, H - h, barW - 1, h);
    }
  }
  draw();
}

function cancelarAudioChat() {
  if (pendingAudioBlob && pendingAudioBlob.localUrl) URL.revokeObjectURL(pendingAudioBlob.localUrl);
  pendingAudioBlob = null;
  _renderStagingArea();
}

// Close emoji picker when clicking outside
document.addEventListener('click', function (e) {
  const panel = document.getElementById('chatEmojiPickerPanel');
  if (panel && panel.classList.contains('active') && !panel.contains(e.target) && !e.target.closest('.chat-add-reaction')) {
    cerrarEmojiPickerReaccion();
  }
});
// ==========================================
// 🧠 PARSER INTELIGENTE DE ACTIVIDAD DIARIA
// ==========================================


function validarTextareasActividad() {
  const txtRes = document.getElementById('textoBrutoReservas').value.trim();
  const txtReg = document.getElementById('textoBrutoRegresos').value.trim();
  const btn = document.getElementById('btnGenerarPdfActividad');

  if (txtRes !== "" && txtReg !== "") {
    btn.disabled = false;
    btn.style.background = "var(--mex-blue)";
    btn.style.color = "white";
    btn.style.cursor = "pointer";
    btn.style.boxShadow = "0 10px 25px rgba(13,42,84,0.2)";
    btn.innerHTML = `<span class="material-icons">picture_as_pdf</span> GENERAR REPORTE COMPLETO`;
  } else {
    btn.disabled = true;
    btn.style.background = "#e2e8f0";
    btn.style.color = "#94a3b8";
    btn.style.cursor = "not-allowed";
    btn.style.boxShadow = "none";
    btn.innerHTML = `<span class="material-icons">lock</span> ESPERANDO DATOS...`;
  }
}

// togglePassword definido en el módulo de autenticación (aislado)

function parsearTablaSucia(rawText, esReserva) {
  let data = [];
  if (!rawText) return data;

  // 1. Limpieza de basura inicial
  let textoLimpio = rawText
    .replace(/EN DOS DÍAS, REGISTROS:\s*\d+/ig, '')
    .replace(/HOY, REGISTROS:\s*\d+/ig, '')
    .replace(/MAÑANA, REGISTROS:\s*\d+/ig, '')
    .replace(/PENDIENTES, REGISTROS:\s*\d+/ig, '')
    .replace(/CONTRATOS VENCIDOS.*?REGISTROS:\s*\d+/ig, '') // 🔥 LIMPIA EL ENCABEZADO DE VENCIDOS
    .replace(/NÚMERO\s*RECOGIDA\s*CLASE\s*CLIENTE/ig, '')
    .replace(/NÚMERO\s*REGRESO\s*CLASE\s*CLIENTE/ig, '')
    .replace(/RECOGIDA\s*CLASE\s*CLIENTE/ig, '')
    .trim();

  // 2. PATRÓN ANCLA (Mantiene tu lógica perfecta)
  const regexAncla = /(20\d{2}-\d{2}-\d{2}\s\d{1,2}:\d{2}:\d{2})\s*([A-Z]{4})/gi;

  let matches = [];
  let match;
  while ((match = regexAncla.exec(textoLimpio)) !== null) {
    matches.push({ fecha: match[1].trim(), clase: match[2].toUpperCase().trim(), start: match.index, end: match.index + match[0].length });
  }

  if (matches.length === 0) return data;

  let primerHueco = textoLimpio.substring(0, matches[0].start).trim();
  let contratoActual = primerHueco || "S/C";

  for (let i = 0; i < matches.length; i++) {
    let current = matches[i];
    let next = matches[i + 1];
    let hueco = next ? textoLimpio.substring(current.end, next.start) : textoLimpio.substring(current.end);

    let contratoProximo = "S/C";
    let textoClienteYTags = hueco.trim();

    if (next) {
      const regexContrato = /(\d{4,12}[A-Za-z]?|[A-Za-z]{2,4}\d{4,10})$/i;
      let matchContrato = textoClienteYTags.match(regexContrato);
      if (matchContrato) {
        contratoProximo = matchContrato[1].trim();
        textoClienteYTags = textoClienteYTags.slice(0, -contratoProximo.length).trim();
      }
    }

    let pago = false, frecuente = false;
    if (/con pago/i.test(textoClienteYTags)) { pago = true; textoClienteYTags = textoClienteYTags.replace(/con pago/ig, '').trim(); }
    if (/cliente frecuente/i.test(textoClienteYTags)) { frecuente = true; textoClienteYTags = textoClienteYTags.replace(/cliente frecuente/ig, '').trim(); }

    let cliente = textoClienteYTags || "SIN NOMBRE";

    data.push({ numero: contratoActual, fecha: current.fecha, clase: current.clase, cliente: cliente, pago: pago, frecuente: frecuente, tipo: esReserva ? "RESERVA" : "REGRESO" });
    contratoActual = contratoProximo;
  }
  return data;
}

function _inicioDiaSeguro(fechaTexto) {
  const fecha = new Date(fechaTexto);
  if (Number.isNaN(fecha.getTime())) return null;
  fecha.setHours(0, 0, 0, 0);
  return fecha;
}

function _badgeTiempoActividad(fechaTexto, fechaBase, forzarUrgente = false) {
  const fechaItem = _inicioDiaSeguro(fechaTexto);
  const fechaRef = _inicioDiaSeguro(fechaBase);
  if (!fechaItem || !fechaRef) return `<span class="status-badge bg-gray">SIN FECHA</span>`;

  const dias = Math.round((fechaItem.getTime() - fechaRef.getTime()) / 86400000);
  if (forzarUrgente || dias < 0) return `<span class="status-badge bg-red">URGENTE</span>`;
  if (dias === 0) return `<span class="status-badge bg-yellow">HOY</span>`;
  if (dias === 1) return `<span class="status-badge bg-green">MAÑANA</span>`;
  return `<span class="status-badge bg-gray">${dias} DÍAS</span>`;
}

function _tablaActividadHtml(items, fechaBase, opciones = {}) {
  const {
    vacio = 'Sin registros.',
    colorEncabezado = '#0d2a54',
    mostrarEtiquetas = false,
    forzarUrgente = false
  } = opciones;

  if (!items.length) {
    return `<div style="padding:14px 16px; border:1px dashed #cbd5e1; border-radius:12px; color:#64748b; font-weight:700; background:#f8fafc;">${escapeHtml(vacio)}</div>`;
  }

  const filas = items.map(item => {
    const etiquetas = [];
    if (item.pago) etiquetas.push('CON PAGO');
    if (item.frecuente) etiquetas.push('CLIENTE FRECUENTE');
    const etiquetaHtml = mostrarEtiquetas
      ? (etiquetas.length
        ? etiquetas.map(tag => `<span class="status-badge bg-gray" style="margin-right:4px;">${escapeHtml(tag)}</span>`).join('')
        : `<span style="color:#94a3b8; font-weight:700;">--</span>`)
      : '';

    return `
      <tr>
        <td>${escapeHtml(item.numero || 'S/C')}</td>
        <td>${escapeHtml(formatearFechaDocumento(item.fecha))}</td>
        <td>${escapeHtml(item.clase || 'S/C')}</td>
        <td>${escapeHtml(item.cliente || 'SIN NOMBRE')}</td>
        <td>${_badgeTiempoActividad(item.fecha, fechaBase, forzarUrgente)}</td>
        ${mostrarEtiquetas ? `<td>${etiquetaHtml}</td>` : ''}
      </tr>
    `;
  }).join('');

  return `
    <table class="pdf-table">
      <thead>
        <tr>
          <th style="background:${colorEncabezado};">Contrato</th>
          <th style="background:${colorEncabezado};">Fecha</th>
          <th style="background:${colorEncabezado};">Clase</th>
          <th style="background:${colorEncabezado};">Cliente</th>
          <th style="background:${colorEncabezado};">Ventana</th>
          ${mostrarEtiquetas ? `<th style="background:${colorEncabezado};">Etiquetas</th>` : ''}
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  `;
}

function _resumenActividadCard(titulo, valor, colorFondo, colorTexto) {
  return `
    <div style="padding:14px 16px; border-radius:14px; background:${colorFondo}; color:${colorTexto};">
      <div style="font-size:11px; font-weight:900; letter-spacing:0.8px;">${escapeHtml(titulo)}</div>
      <div style="font-size:26px; font-weight:900; margin-top:4px;">${escapeHtml(valor)}</div>
    </div>
  `;
}

function generarHtmlActividadDiaria(reservas, regresos, vencidos, autor, fechaFront) {
  return `
    <div>
      <div class="pdf-header">
        <div>
          <h1 class="pdf-title">Reporte de Actividad Diaria</h1>
          <div style="font-size:12px; color:#475569; font-weight:700; margin-top:6px;">Reservas, contratos por cerrar y vencidos del día</div>
        </div>
        <div class="pdf-meta">
          <div><b>Generado por:</b> ${escapeHtml(autor || 'Sistema')}</div>
          <div><b>Emitido:</b> ${escapeHtml(formatearFechaDocumento(new Date().toISOString()))}</div>
          <div><b>Base:</b> ${escapeHtml(formatearFechaDocumento(fechaFront))}</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:18px;">
        ${_resumenActividadCard('RESERVAS', reservas.length, '#fffbeb', '#b45309')}
        ${_resumenActividadCard('REGRESOS', regresos.length, '#eff6ff', '#1d4ed8')}
        ${_resumenActividadCard('VENCIDOS', vencidos.length, '#fef2f2', '#b91c1c')}
      </div>

      <div class="pdf-section-title">1. Reservas priorizadas (${reservas.length})</div>
      ${_tablaActividadHtml(reservas, fechaFront, {
    vacio: 'No se detectaron reservas en la captura.',
    colorEncabezado: '#d97706',
    mostrarEtiquetas: true
  })}

      <div class="pdf-section-title">2. Contratos por cerrar (${regresos.length})</div>
      ${_tablaActividadHtml(regresos, fechaFront, {
    vacio: 'No se detectaron regresos en la captura.',
    colorEncabezado: '#0284c7',
    mostrarEtiquetas: true
  })}

      <div class="pdf-section-title">3. Vencidos / posibles llegadas (${vencidos.length})</div>
      ${_tablaActividadHtml(vencidos, fechaFront, {
    vacio: 'No hay vencidos incluidos en este reporte.',
    colorEncabezado: '#dc2626',
    forzarUrgente: true
  })}
    </div>
  `;
}

async function procesarActividadDiaria() {
  const txtRes = document.getElementById('textoBrutoReservas').value;
  const txtReg = document.getElementById('textoBrutoRegresos').value;
  const txtVen = document.getElementById('textoBrutoVencidos').value;
  const btn = document.getElementById('btnGenerarPdfActividad');

  btn.disabled = true;
  btn.innerHTML = `<span class="material-icons spinner">sync</span> ARMANDO REPORTE...`;

  try {
    const reservas = parsearTablaSucia(txtRes, true).sort((a, b) => {
      const scoreA = (a.pago ? 2 : 0) + (a.frecuente ? 1 : 0);
      const scoreB = (b.pago ? 2 : 0) + (b.frecuente ? 1 : 0);
      if (scoreA !== scoreB) return scoreB - scoreA;
      return new Date(a.fecha) - new Date(b.fecha);
    });

    const regresos = parsearTablaSucia(txtReg, false).sort((a, b) => {
      if (a.frecuente && !b.frecuente) return -1;
      if (!a.frecuente && b.frecuente) return 1;
      return new Date(a.fecha) - new Date(b.fecha);
    });

    const vencidos = parsearTablaSucia(txtVen, false).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    const fechaFront = new Date().toISOString();

    await api.generarPDFActividadDiaria(reservas, regresos, vencidos, USER_NAME, fechaFront).catch(e => console.warn('No se pudo registrar el reporte diario:', e));
    abrirReporteImpresion(generarHtmlActividadDiaria(reservas, regresos, vencidos, USER_NAME, fechaFront));

    document.getElementById('textoBrutoReservas').value = "";
    document.getElementById('textoBrutoRegresos').value = "";
    document.getElementById('textoBrutoVencidos').value = "";
    document.getElementById('modal-lector-reservas').classList.remove('active');
    validarTextareasActividad();
    showToast('Se abrió el generador de PDF del reporte diario.', 'success');
  } catch (error) {
    console.error(error);
    showToast('No se pudo generar el reporte diario.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span class="material-icons">picture_as_pdf</span> GENERAR REPORTE COMPLETO`;
  }
}
// ==========================================
// 🔮 MOTOR DEL CUADRE DE PREDICCIONES
// ==========================================
let htmlTablaPrediccion = "";
let datosCalculadosParaExcel = [];
let fechaSeleccionadaStr = "";
let fechaSeleccionadaIso = "";
let resumenPrediccionActual = null;

// Función que lee los textos sucios y extrae solo las siglas oficiales (SIPP)
function extraerConteoClases(textoRaw) {
  let conteo = {};
  if (!textoRaw) return conteo;

  let textoLimpio = textoRaw.toUpperCase()
    .replace(/CON PAGO/g, '')
    .replace(/HOY, REGISTROS/g, '')
    .replace(/MAÑANA, REGISTROS/g, '')
    .replace(/PENDIENTES, REGISTROS/g, '');

  let lineas = textoLimpio.split('\n');

  // 🔥 AQUÍ ESTÁN TODOS TUS CÓDIGOS SIPP (INCLUYENDO XXAR, PICKUPS Y VAN)
  const codigosValidos = [
    "XXAR",
    "ECAR",
    "CCAR",
    "ICAR", "SCAR",
    "FCAR",
    "CFAR",
    "IFAR", "SFAR",
    "FWAR",
    "FFBH", "PFAR",
    "MVAR", "MVAH", "IVAH",
    "PVAR", "CKMR", "MPMN", "GVMD", "FKAR"
  ];

  for (let linea of lineas) {
    if (!linea.trim()) continue;
    for (let codigo of codigosValidos) {
      let regex = new RegExp(`\\b${codigo}\\b`, 'i');
      if (regex.test(linea)) {
        conteo[codigo] = (conteo[codigo] || 0) + 1;
        break;
      }
    }
  }
  return conteo;
}


function reiniciarPrediccion() {
  // 1. Ocultar la tabla de resultados y mostrar de nuevo las cajas de texto
  document.getElementById('prediccion-paso-2').style.display = 'none';
  document.getElementById('prediccion-paso-1').style.display = 'block';
  htmlTablaPrediccion = "";
  datosCalculadosParaExcel = [];
  resumenPrediccionActual = null;
  fechaSeleccionadaStr = "";
  fechaSeleccionadaIso = "";

  // 2. Limpiar las cajas de texto para que queden en blanco
  document.getElementById('txt-pred-reservas').value = "";
  document.getElementById('txt-pred-regresos').value = "";
  const tabla = document.getElementById('tabla-prediccion-container');
  if (tabla) tabla.innerHTML = '';

  // 3. Restaurar el botón de Excel por si se había quedado en "Cargando..."
  const btnExcel = document.getElementById('btnDescargarPrediccionExcel');
  if (btnExcel) {
    btnExcel.disabled = false;
    btnExcel.innerHTML = `<span class="material-icons">table_view</span> CREAR HOJA DE EXCEL EDITABLE`;
  }
  const btnPdf = document.getElementById('btnDescargarPrediccionPdf');
  if (btnPdf) {
    btnPdf.disabled = false;
    btnPdf.innerHTML = `<span class="material-icons">picture_as_pdf</span> GUARDAR PDF OFICIAL`;
  }
}


async function ejecutarPrediccion() {
  const txtRes = document.getElementById('txt-pred-reservas').value;
  const txtReg = document.getElementById('txt-pred-regresos').value;
  const inputFecha = document.getElementById('fecha-prediccion').value;

  if (!inputFecha) return showToast("Por favor selecciona una fecha.", "warning");
  if (!txtRes && !txtReg) return showToast("Pega datos en alguna de las cajas.", "warning");

  const f = new Date(inputFecha + 'T12:00:00');
  const meses = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
  fechaSeleccionadaStr = `${("0" + f.getDate()).slice(-2)}/ ${meses[f.getMonth()]}/ ${f.getFullYear()}`;
  fechaSeleccionadaIso = inputFecha;

  const btn = document.getElementById('btnProcesarPrediccion');
  btn.disabled = true;
  btn.innerHTML = `<span class="material-icons spinner">sync</span> CALCULANDO...`;

  try {
    const conteoReservas = extraerConteoClases(txtRes);
    const conteoRegresos = extraerConteoClases(txtReg);
    const inventarioActual = await api.obtenerDatosFlotaConsola();
    const estadosDisponibles = new Set(["LISTO", "SUCIO", "RESGUARDO", "TRASLADO"]);

    let conteoDisponibles = {};
    (inventarioActual || []).forEach(car => {
      let est = (car.estado || "").toUpperCase();
      let cat = (car.categoria || car.categ || "").toUpperCase().trim();

      if (estadosDisponibles.has(est) && cat) {
        conteoDisponibles[cat] = (conteoDisponibles[cat] || 0) + 1;
      }
    });

    // 🔥 EL DICCIONARIO MAESTRO: EMPATA LOS SIPP CON LAS SUB-CATEGORÍAS
    const mapeoFamilias = [
      { nombre: "COMPACTOS (AVEO/RIO/VERSA/MIRAGE)", codigos: ["XXAR", "ECAR", "CCAR", "CCMR"] },
      { nombre: "INTERMEDIOS (CAVALIER/K3/VIRTUS)", codigos: ["ICAR"] },
      { nombre: "FULLSIZE (OMODA)(JETTA)", codigos: ["FCAR", "SCAR"] },
      { nombre: "SUV 1 (KICKS/TRACKER/TAOS)", codigos: ["CFAR"] },
      { nombre: "SUV 2 (XTRAIL/TERRITORY/JOURNEY/SPORTAGE)", codigos: ["SFAR", "IFAR"] },
      { nombre: "SUV 3 (XPANDER/AVANZA)", codigos: ["FWAR"] },
      { nombre: "SUV 4 (CHEROKEE/ TANK)", codigos: ["FFBH"] },
      { nombre: "MINIVAN (SIENNA/GN8)", codigos: ["MVAR", "MVAH", "IVAH", "IVAR"] },
      { nombre: "HIACE O TORNADO", codigos: ["CKMR", "FKAR"] },
      { nombre: "SUBURBAN", codigos: ["PFAR"] }
    ];

    let trs = "";
    let totRes = 0, totDev = 0, totDis = 0, totPred = 0;
    datosCalculadosParaExcel = [];

    mapeoFamilias.forEach(fam => {
      let res = 0, dev = 0, dis = 0;

      fam.codigos.forEach(codigo => {
        res += conteoReservas[codigo] || 0;
        dev += conteoRegresos[codigo] || 0;
        dis += conteoDisponibles[codigo] || 0;
      });

      let pred = dis + dev - res;
      totRes += res; totDev += dev; totDis += dis; totPred += pred;

      datosCalculadosParaExcel.push({ nombre: fam.nombre, res: res, dev: dev, dis: dis, pred: pred });

      let colorPred = pred < 0 ? "background: #ffcdd2; color: #b71c1c;" : (pred === 0 ? "background: #fff9c4; color: #f57f17;" : "background: #b9f6ca; color: #1b5e20;");

      trs += `
         <tr>
           <td style="padding: 8px; border: 1px solid #cbd5e1; background: #f8fafc; font-weight: 800; font-size: 11px;">${fam.nombre}</td>
           <td style="padding: 8px; border: 1px solid #cbd5e1; background: #ffca28; text-align: center; font-weight: bold; font-size: 13px;">${res}</td>
           <td style="padding: 8px; border: 1px solid #cbd5e1; background: #dce775; text-align: center; font-weight: bold; font-size: 13px;">${dev}</td>
           <td style="padding: 8px; border: 1px solid #cbd5e1; background: #aed581; text-align: center; font-weight: bold; font-size: 13px;">${dis}</td>
           <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; font-weight: 900; font-size: 15px; ${colorPred}">${pred}</td>
         </tr>
       `;
    });

    trs += `
      <tr style="background: #f1f5f9;">
        <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: 900; font-size: 13px;">TOTAL</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; background: #ffb300; text-align: center; font-weight: 900; font-size: 14px;">${totRes}</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; background: #c0ca33; text-align: center; font-weight: 900; font-size: 14px;">${totDev}</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; background: #8bc34a; text-align: center; font-weight: 900; font-size: 14px;">${totDis}</td>
        <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: 900; font-size: 16px; ${totPred < 0 ? 'background: #e53935; color: white;' : 'background: #4caf50; color: white;'}">${totPred}</td>
      </tr>
    `;

    htmlTablaPrediccion = `<table style="width: 100%; border-collapse: collapse; font-family: inherit;"><thead><tr><th style="background: #e2e8f0; color: #1e293b; padding: 10px; border: 1px solid #cbd5e1; font-size: 10px;">CATEGORIA</th><th style="background: #e2e8f0; color: #1e293b; padding: 10px; border: 1px solid #cbd5e1; font-size: 10px;">RESERVAS</th><th style="background: #e2e8f0; color: #1e293b; padding: 10px; border: 1px solid #cbd5e1; font-size: 10px;">DEVOLUCIONES</th><th style="background: #e2e8f0; color: #1e293b; padding: 10px; border: 1px solid #cbd5e1; font-size: 10px;">DISPONIBLES</th><th style="background: #e2e8f0; color: #1e293b; padding: 10px; border: 1px solid #cbd5e1; font-size: 10px;">PREDICCIÓN</th></tr></thead><tbody>${trs}</tbody></table>`;
    resumenPrediccionActual = { totRes, totDev, totDis, totPred };
    document.getElementById('tabla-prediccion-container').innerHTML = htmlTablaPrediccion;

    document.getElementById('prediccion-paso-1').style.display = 'none';
    document.getElementById('prediccion-paso-2').style.display = 'block';
    showToast('Predicción calculada con datos actuales de Firebase.', 'success');
  } catch (error) {
    console.error(error);
    showToast('No se pudo calcular la predicción.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span class="material-icons">auto_awesome</span> CALCULAR DISPONIBILIDAD`;
  }
}

function generarHtmlPrediccionPdf() {
  if (!htmlTablaPrediccion) return '';
  const total = resumenPrediccionActual ? resumenPrediccionActual.totPred : 0;
  const colorTotal = total < 0 ? '#dc2626' : '#16a34a';
  return `
    <div>
      <div class="pdf-header">
        <div>
          <h1 class="pdf-title">Cuadre de Predicción</h1>
          <div style="font-size:12px; color:#475569; font-weight:700; margin-top:6px;">Comparativo reservas vs regresos vs inventario disponible</div>
        </div>
        <div class="pdf-meta">
          <div><b>Fecha objetivo:</b> ${escapeHtml(fechaSeleccionadaStr || fechaSeleccionadaIso || '--')}</div>
          <div><b>Generado por:</b> ${escapeHtml(USER_NAME || 'Sistema')}</div>
          <div><b>Total predicción:</b> <span style="color:${colorTotal}; font-weight:900;">${escapeHtml(total)}</span></div>
        </div>
      </div>
      <div style="margin-top:8px;">${htmlTablaPrediccion}</div>
    </div>
  `;
}

async function descargarPDFPrediccion() {
  if (!htmlTablaPrediccion) return showToast('Primero calcula la predicción.', 'warning');
  const btn = document.getElementById('btnDescargarPrediccionPdf');
  btn.disabled = true;
  btn.innerHTML = `<span class="material-icons spinner">sync</span> PREPARANDO PDF...`;

  try {
    abrirReporteImpresion(generarHtmlPrediccionPdf());
    showToast('Se abrió el generador de PDF de la predicción.', 'success');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span class="material-icons">picture_as_pdf</span> GUARDAR PDF OFICIAL`;
  }
}

async function crearExcelPrediccion() {
  if (!datosCalculadosParaExcel.length) return showToast('Primero calcula la predicción.', 'warning');
  const btn = document.getElementById('btnDescargarPrediccionExcel');
  btn.disabled = true;
  btn.innerHTML = `<span class="material-icons spinner">sync</span> ARMANDO EXCEL...`;

  try {
    const filas = datosCalculadosParaExcel.map(item => `
      <tr>
        <td>${escapeHtml(item.nombre)}</td>
        <td>${escapeHtml(item.res)}</td>
        <td>${escapeHtml(item.dev)}</td>
        <td>${escapeHtml(item.dis)}</td>
        <td>${escapeHtml(item.pred)}</td>
      </tr>
    `).join('');

    const totalRow = resumenPrediccionActual ? `
      <tr style="font-weight:900; background:#e2e8f0;">
        <td>TOTAL</td>
        <td>${escapeHtml(resumenPrediccionActual.totRes)}</td>
        <td>${escapeHtml(resumenPrediccionActual.totDev)}</td>
        <td>${escapeHtml(resumenPrediccionActual.totDis)}</td>
        <td>${escapeHtml(resumenPrediccionActual.totPred)}</td>
      </tr>
    ` : '';

    const contenido = `\ufeff
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
        <head>
          <meta charset="utf-8">
          <style>
            table { border-collapse: collapse; font-family: Arial, sans-serif; width: 100%; }
            th, td { border: 1px solid #cbd5e1; padding: 8px; }
            th { background: #0d2a54; color: white; }
          </style>
        </head>
        <body>
          <h2>Cuadre de Predicción</h2>
          <p><b>Fecha objetivo:</b> ${escapeHtml(fechaSeleccionadaStr || fechaSeleccionadaIso || '--')}</p>
          <p><b>Generado por:</b> ${escapeHtml(USER_NAME || 'Sistema')}</p>
          <table>
            <thead>
              <tr>
                <th>CATEGORIA</th>
                <th>RESERVAS</th>
                <th>DEVOLUCIONES</th>
                <th>DISPONIBLES</th>
                <th>PREDICCIÓN</th>
              </tr>
            </thead>
            <tbody>
              ${filas}
              ${totalRow}
            </tbody>
          </table>
        </body>
      </html>`;

    const fechaArchivo = (fechaSeleccionadaIso || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, '');
    descargarArchivoLocal(`prediccion-cuadre-${generarSlugArchivo(fechaArchivo)}.xls`, contenido, 'application/vnd.ms-excel;charset=utf-8;');
    await api.generarExcelPrediccion(datosCalculadosParaExcel, fechaSeleccionadaStr, USER_NAME).catch(e => console.warn('No se pudo registrar el Excel de predicción:', e));
    showToast('Hoja compatible con Excel descargada.', 'success');
  } catch (error) {
    console.error(error);
    showToast('No se pudo generar la hoja de predicción.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span class="material-icons">table_view</span> CREAR HOJA DE EXCEL EDITABLE`;
  }
}




// 🧠 INTELIGENCIA DE HÁBITOS: Sugerencias automáticas CARGA MASIVA DE FUNCIONES NUEVAS
async function verificarHabitosUbicacion() {
  if (MODO_FLOTA !== "MODIFICAR" || !SELECT_REF_FLOTA) return;

  const ubiNueva = document.getElementById('f_ubi').value;
  const ubiVieja = (SELECT_REF_FLOTA.ubicacion || "").toUpperCase();
  const estSelect = document.getElementById('f_est');
  const TALLERES = ["TALLER", "TALLER EXTERNO", "HYP COBIAN"];

  // REGLA 1: Regresa al PATIO desde afuera → sugerir SUCIO
  if (ubiNueva === "PATIO" && ubiVieja !== "PATIO" && ubiVieja !== "") {
    if (estSelect.value !== "SUCIO" && estSelect.value !== "MANTENIMIENTO") {
      const ok = await mexConfirm(
        'Hábito detectado',
        `La unidad regresa de [${ubiVieja}] al PATIO.\n¿Cambiar su estado a SUCIO para que pase a lavado?`,
        'info'
      );
      if (ok) {
        estSelect.value = "SUCIO";
        showToast("Estado cambiado a SUCIO automáticamente", "info");
        validarBotonGuardar();
      }
    }
  }

  // REGLA 2: Sale del PATIO con estado SUCIO → sugerir LISTO antes de entregarla
  else if (ubiVieja === "PATIO" && ubiNueva !== "PATIO" && ubiNueva !== "" && !TALLERES.includes(ubiNueva)) {
    if (estSelect.value === "SUCIO") {
      const ok = await mexConfirm(
        'Hábito detectado',
        `La unidad sale del PATIO con estado SUCIO.\n¿Cambiarla a LISTO antes de enviarla?`,
        'warning'
      );
      if (ok) {
        estSelect.value = "LISTO";
        showToast("Estado cambiado a LISTO", "info");
        validarBotonGuardar();
      }
    }
  }

  // REGLA 3: Va a TALLER / TALLER EXTERNO / HYP → sugerir MANTENIMIENTO
  else if (TALLERES.includes(ubiNueva) && estSelect.value !== "MANTENIMIENTO") {
    const ok = await mexConfirm(
      'Hábito detectado',
      `La unidad va a [${ubiNueva}].\n¿Cambiar su estado a MANTENIMIENTO?`,
      'info'
    );
    if (ok) {
      estSelect.value = "MANTENIMIENTO";
      showToast("Estado cambiado a MANTENIMIENTO", "info");
      validarBotonGuardar();
    }
  }
}


// 🔥 VARIABLES TEMPORALES PARA GUARDAR EL AUTO MIENTRAS ELEGIMOS CONTACTO
let dataWaTemporal = {};

function notificarUrgenciaWhatsApp(mva, modelo, placas, ubicacion) {
  // Guardamos la info del auto en la memoria temporal
  dataWaTemporal = { mva, modelo, placas, ubicacion };

  const select = document.getElementById('wa-select-user');
  select.innerHTML = '<option value="">Selecciona un contacto...</option>';

  // Filtramos la base de datos de usuarios (que ya cargó al iniciar sesión)
  // para mostrar SOLO a los que tienen un teléfono válido guardado
  const contactosValidos = dbUsuariosLogin.filter(u => u.telefono && u.telefono.length >= 10);

  if (contactosValidos.length === 0) {
    showToast("No hay contactos con teléfono registrado en la base (Columna D).", "error");
    return;
  }

  // Llenamos la lista desplegable
  contactosValidos.forEach(u => {
    select.innerHTML += `<option value="${u.telefono}">${u.usuario}</option>`;
  });

  // Abrimos el modal elegante
  document.getElementById('modalWhatsapp').classList.add('active');
}

// 🟢 FUNCIÓN QUE SE EJECUTA AL DARLE CLIC AL BOTÓN VERDE DEL MODAL
function ejecutarWhatsApp() {
  const num = document.getElementById('wa-select-user').value;

  if (!num) {
    showToast("Selecciona un contacto válido", "warning");
    return;
  }

  // Rescatamos los datos del auto de la memoria
  const { mva, modelo, placas, ubicacion } = dataWaTemporal;

  // Armamos el mensaje
  let texto = `🚨 *URGENTE - PRIORIDAD ALTA* 🚨\n\nFavor de preparar y entregar la unidad:\n🚗 *${mva}* (${modelo})\n🏷️ Placas: ${placas}\n 📍 Ubicación actual: ${ubicacion}\n`;

  // Lanzamos WhatsApp y cerramos el modal
  window.open(`https://wa.me/52${num}?text=${encodeURIComponent(texto)}`, '_blank');
  showToast("Abriendo WhatsApp...", "success");

  document.getElementById('modalWhatsapp').classList.remove('active');
}


// 📸 FUNCIÓN PUENTE: Llama al backend y guarda en cache local
function obtenerImagenAuto(mva, modelo, callback) {
  if (!modelo) return;
  const searchKey = modelo.toUpperCase().split(" ")[0].trim();

  // Si ya la pedimos antes y está en cache local, la devolvemos
  if (CACHE_IMAGENES_AUDIT[searchKey]) {
    callback(CACHE_IMAGENES_AUDIT[searchKey]);
    return;
  }

  // Si no está, la pedimos al motor de Google Script
  api.obtenerUrlImagenModelo(modelo).then(res => {
    CACHE_IMAGENES_AUDIT[searchKey] = res; // Guardamos en cache local
    callback(res);
  }).catch(() => callback("")); // Falla, genérico
}
function initTheme() {
  const savedTheme = localStorage.getItem('mex_mapa_theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
    // Actualizamos el ícono a un "Sol" si ya estamos en oscuro
    window.addEventListener('DOMContentLoaded', () => {
      const icon = document.getElementById('iconTheme');
      if (icon) icon.innerText = 'light_mode';
    });
  }
}
initTheme(); // Llamada inmediata para evitar el parpadeo blanco

// 2. Función del botón Toggle
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-theme');
  const icon = document.getElementById('iconTheme');

  if (isDark) {
    localStorage.setItem('mex_mapa_theme', 'dark');
    if (icon) icon.innerText = 'light_mode'; // Cambia el ícono a Sol
    if (typeof showToast === "function") showToast("Modo Oscuro activado 🌙", "info");
  } else {
    localStorage.setItem('mex_mapa_theme', 'light');
    if (icon) icon.innerText = 'dark_mode';  // Cambia el ícono a Luna
    if (typeof showToast === "function") showToast("Modo Claro activado ☀️", "info");
  }
}

/**
 * ⚡ EL EJECUTOR MAESTRO (Versión Blindada 17.5 - Multimodal y Enriquecida)
 */
function ejecutarAccionGemini(respuestaIA) {
  console.log("📥 Instrucción recibida de la IA:", respuestaIA);
  if (!respuestaIA || !respuestaIA.acciones) return;

  respuestaIA.acciones.forEach(cmd => {

    // --- 🗣️ RESPUESTA DUAL (VOZ + VISUAL) ---
    if (cmd.respuesta_voz || cmd.respuesta_visual) {
      notificarRespuestaIA(cmd.respuesta_voz, cmd.respuesta_visual);
    }

    // --- 0. BÚSQUEDA GLOBAL ---
    if (cmd.accion === "HABLAR" && cmd.data && cmd.data.isGlobal) {
      mostrarDetalleGlobal(cmd.data);
    }

    // --- 1. MODIFICAR (Cualquiera puede mandar al LIMBO) ---
    else if (cmd.accion === "MODIFICAR") {
      const carNode = document.getElementById(`auto-${cmd.mva}`);
      const d = cmd.data || {};

      if (carNode) {
        carNode.classList.add('car-focus');
        setTimeout(() => carNode.classList.remove('car-focus'), 5000);

        let estNueva = (d.estado || d.est || carNode.dataset.estado).toUpperCase();
        let ubiNueva = (d.ubicacion || d.ubi || carNode.dataset.ubicacion).toUpperCase();
        let gasNueva = (d.gasolina || d.gas || carNode.dataset.gasolina).toUpperCase();
        let posNueva = (d.posicion || d.pos) ? (d.posicion || d.pos).toUpperCase() : null;

        if (ubiNueva !== "PATIO" && ubiNueva !== "TALLER") posNueva = "LIMBO";

        if (posNueva) {
          const dest = posNueva === "LIMBO"
            ? document.getElementById("unidades-limbo")
            : document.getElementById(_spotDomId(posNueva, _miPlaza()));
          if (dest) {
            dest.appendChild(carNode);
            if (typeof solicitarGuardadoProgresivo === "function") solicitarGuardadoProgresivo();
          }
        }
        enviarCambioRapido(cmd.mva, estNueva, ubiNueva, gasNueva, (d.notas || d.agregar_notas || carNode.dataset.notas));
      }
    }

    // --- 2. ELIMINAR (¡SOLO ADMINISTRADORES!) ---
    else if (cmd.accion === "ELIMINAR") {
      const esAdmin = (typeof userRole !== 'undefined' && userRole === 'admin');

      if (!esAdmin) {
        // Ya no lanzamos notificación aquí, el backend ya lo bloqueó y mandó un HABLAR
        return;
      }

      const mvaTarget = cmd.mva.toUpperCase();
      if (typeof VISTA_ACTUAL_FLOTA !== 'undefined' && VISTA_ACTUAL_FLOTA === 'NORMAL') {
        actualizarTablaLocal(mvaTarget, 'ELIMINAR');
        const carVisual = document.getElementById(`auto-${mvaTarget}`);
        if (carVisual) carVisual.remove();
        actualizarContadores();
        api.ejecutarEliminacion([mvaTarget], USER_NAME, _miPlaza()).catch(e => console.error(e));
      } else {
        const itemAdmin = DB_ADMINS.find(u => u.mva === mvaTarget);
        if (itemAdmin) {
          api.procesarModificacionMaestra({ mva: mvaTarget, fila: itemAdmin.fila, adminResponsable: USER_NAME }, "ELIMINAR").then(() => { cambiarTabFlota('ADMINS'); }).catch(e => console.error(e));
        }
      }
    }

    // --- 3. INSERTAR NUEVO (Solo Admins + Autocompletado Backend) ---
    else if (cmd.accion === "INSERTAR_NUEVO") {
      const esAdmin = (typeof userRole !== 'undefined' && userRole === 'admin');
      if (!esAdmin) return; // Bloqueo de seguridad cliente

      const d = cmd.data || {};

      // Ahora el Payload recibe los datos enriquecidos que mandó el Backend
      const payloadNuevo = {
        mva: cmd.mva,
        categ: (d.categoria || d.categ || "N/A").toUpperCase(),
        modelo: (d.modelo || "S/M").toUpperCase(),
        placas: (d.placas || "S/P").toUpperCase(),
        estado: (d.estado || d.est || "SUCIO").toUpperCase(),
        ubicacion: (d.ubicacion || d.ubi || "PATIO").toUpperCase(),
        gasolina: (d.gasolina || d.gas || "N/A").toUpperCase(),
        notas: (d.agregar_notas || d.notas || ""),
        responsableSesion: USER_NAME,
        plaza: _miPlaza() || ''
      };

      // Magia Visual: Actualiza la tabla al instante (Optimistic UI)
      if (typeof VISTA_ACTUAL_FLOTA !== 'undefined' && VISTA_ACTUAL_FLOTA === 'NORMAL') {
        if (typeof actualizarTablaLocal === "function") actualizarTablaLocal(payloadNuevo.mva, 'INSERTAR', payloadNuevo);
      }

      // Manda a guardar a Google Sheets
      api.insertarUnidadDesdeHTML(payloadNuevo).then((res) => {
        if (res.startsWith("EXITO")) refrescarDatos();
      }).catch(e => console.error(e));
    }

    // --- 4. WHATSAPP (Cualquiera puede avisar) ---
    else if (cmd.accion === "WHATSAPP" && cmd.whatsapp) {
      const waUsuario = dbUsuariosLogin.find(u => u.usuario.toLowerCase().includes(cmd.whatsapp.destinatario.toLowerCase()));
      if (waUsuario && waUsuario.telefono) {
        window.open(`https://wa.me/52${waUsuario.telefono}?text=${encodeURIComponent(cmd.whatsapp.mensaje)}`, '_blank');
      }
    }
  });
}


/**
 * 🎨 AYUDANTE: FICHA PARA UNIDADES FUERA DEL MAPA
 */
function mostrarDetalleGlobal(d) {
  const panel = document.getElementById('info-panel');
  const detalle = document.getElementById('detalle-unidad');
  detalle.innerHTML = `
        <div style="text-align: center; padding: 10px 0;">
            <span style="background:#1e293b; color:#fbbf24; padding:5px 12px; border-radius:50px; font-size:10px; font-weight:900; letter-spacing:1px;">📍 LOCALIZADO FUERA DEL MAPA</span>
            <h2 style="color: var(--primary); font-weight: 900; font-size: 35px; line-height: 1; margin: 15px 0 10px;">${d.mva}</h2>
            <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; font-size: 13px; font-weight: 700; color: #475569; background: #f8fafc; padding: 15px; border-radius: 16px; border: 1px solid #e2e8f0;">
                <span style="color:#0284c7;">👤 ${d.ubicacion}</span>
                <span style="color: #cbd5e1;">•</span>
                <span style="color:#ef4444;">⚙️ ${d.estado}</span>
                <span style="color: #cbd5e1;">•</span>
                <span>🚗 ${d.modelo || 'S/M'}</span>
            </div>
            ${d.notas ? `<div class="nota-display" style="display:block; margin-top:15px; background:#fffbeb; border-left:4px solid #fbbf24;">📝 ${d.notas}</div>` : ''}
        </div>
    `;
  const btnGrid = document.getElementById('infoPanelBtnGrid');
  if (btnGrid) btnGrid.innerHTML = `<button onclick="cerrarPanel()" style="grid-column: span 3; padding:18px; border-radius:14px; border:none; background:#f1f5f9; color:var(--primary); font-weight:900; cursor:pointer;">ENTENDIDO</button>`;
  panel.classList.add('open');
}
/**
 * 🎙️ EL RECEPTOR SENSORIAL
 * Toma la orden y le toma una "foto" al patio para enviársela a la IA.
 */
function procesarComandoInteligente() {
  const input = document.getElementById('smartCommandInput');
  const textoOriginal = input.value.trim();
  if (!textoOriginal) return;

  notificarRespuestaIA("Analizando el patio...");
  console.log("🎙️ Escuchado:", textoOriginal);

  // 📸 Fotografía ligera de la flota actual
  const contextoFlota = Array.from(document.querySelectorAll('.car')).map(c => ({
    mva: c.dataset.mva,
    modelo: c.dataset.modelo || "S/M",
    est: c.dataset.estado,
    ubi: c.dataset.ubicacion,
    pos: c.parentElement.id.includes('spot') ? _spotValueFromElement(c.parentElement) : 'LIMBO',
    gas: c.dataset.gasolina,
    notas: c.dataset.notas || "",
    ingreso: c.dataset.ingreso || ""
  }));

  // 🔐 Empacar contexto con metadata del usuario para validación de roles en el servidor
  const contextoConMeta = {
    _meta: {
      rol: (typeof userRole !== 'undefined' ? userRole : "operador"),
      nombre: (typeof USER_NAME !== 'undefined' ? USER_NAME : "Operador")
    },
    flota: contextoFlota
  };

  api.llamarGeminiAI(textoOriginal, JSON.stringify(contextoConMeta), window.ultimoMVA_MEXIA).then(ejecutarAccionGemini).catch(() => notificarRespuestaIA("Fallo de red al contactar al cerebro."));

  input.value = "";
  colapsarTerminal();
}

function limpiarEInterfaz() {
  document.getElementById('smartCommandInput').value = "";
  document.activeElement.blur();
  colapsarTerminal();
  if (typeof actualizarContadores === "function") actualizarContadores();
}

// Variable global para controlar el silencio
window.IA_MUTED = false;

function toggleMuteIA(event) {
  event.stopPropagation(); // Evita que se cierre la terminal
  window.IA_MUTED = !window.IA_MUTED;
  const btn = document.getElementById('btnMuteIA');
  const icon = document.getElementById('iconMuteIA');

  if (window.IA_MUTED) {
    btn.classList.add('muted');
    icon.innerText = 'volume_off';
    showToast("Voz de la IA silenciada (Modo Cliente)", "info");
  } else {
    btn.classList.remove('muted');
    icon.innerText = 'volume_up';
    showToast("Voz de la IA activada", "success");
  }
}
/**
 * 🗣️ RECEPTOR DE RESPUESTAS (Voz + Panel Visual SIEMPRE)
 */
function notificarRespuestaIA(mensaje) {
  if (!mensaje) return;

  // 1. Mostrar texto en el panel flotante
  const panel = document.getElementById('ai-response-panel');
  const content = document.getElementById('ai-response-content');

  if (panel && content) {
    content.innerHTML = mensaje.replace(/\n/g, '<br>'); // Respeta saltos de línea
    panel.style.display = 'flex';
  } else {
    // Respaldo de seguridad si olvidaste pegar el HTML
    showToast(mensaje, "info");
  }

  // 2. Reproducir voz simultáneamente
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel(); // Evita que las voces se encimen

    // Limpiamos los emojis para que no los lea
    const textoLimpio = mensaje.replace(/[✅❌🗑️⛔🏁🚀🎙️📍]/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(textoLimpio);
    utterance.lang = 'es-MX';
    utterance.rate = 0.95;

    const voces = window.speechSynthesis.getVoices();
    const mejorVoz = voces.find(v => v.name.includes('Google') && v.lang.includes('es')) ||
      voces.find(v => v.lang.includes('es-MX')) || voces[0];
    if (mejorVoz) utterance.voice = mejorVoz;

    window.speechSynthesis.speak(utterance);
  }
}


function expandirTerminal() {
  const wrapper = document.getElementById('smartTerminalWrapper');
  const input = document.getElementById('smartCommandInput'); // [cite: 3031]

  if (wrapper && wrapper.classList.contains('smart-terminal-collapsed')) {
    wrapper.classList.remove('smart-terminal-collapsed');
    wrapper.classList.add('smart-terminal-expanded');

    // 🛡️ ESCUDO ANTI-CRASH: Solo hacemos focus si el input existe y es visible
    setTimeout(() => {
      if (input) {
        input.focus();
      }
    }, 300); // Damos tiempo a la animación de CSS
  }
}

function colapsarTerminal() {
  // Le damos 200ms para asegurar que si dio clic en "Enviar", se procese primero
  setTimeout(() => {
    const input = document.getElementById('smartCommandInput');
    if (input.value.trim() === '') {
      const wrapper = document.getElementById('smartTerminalWrapper');
      wrapper.classList.remove('smart-terminal-expanded');
      wrapper.classList.add('smart-terminal-collapsed');
    }
  }, 200);
}
/**
 * 👁️ RECONOCIMIENTO DE PLACAS OPTIMIZADO (SIN ALERTS)
 */
async function procesarImagenOCR(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Notificación visual de progreso
  notificarRespuestaIA("👁️ Procesando placa... por favor espera.");

  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.src = e.target.result;
    img.onload = function () {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const MAX_WIDTH = 1000;
      let width = img.width;
      let height = img.height;
      if (width > MAX_WIDTH) {
        height *= MAX_WIDTH / width;
        width = MAX_WIDTH;
      }
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);

      api.analizarPlacaVisionAPI(compressedBase64).then(function (textoDetectado) {
        // Ejecutamos la lógica de búsqueda sin alertas
        ejecutarLogicaOCR(textoDetectado);
      }).catch(function (err) {
        notificarRespuestaIA("❌ Error de comunicación con la cámara.");
      });
    };
  };
  reader.readAsDataURL(file);
  event.target.value = "";
}

/**
 * 🔍 BUSCADOR DE PLACAS (FILTRO DE BASURA)
 */
function ejecutarLogicaOCR(textoDetectado) {
  if (!textoDetectado || textoDetectado === "NO_TEXT_FOUND" || textoDetectado.startsWith("ERROR")) {
    return notificarRespuestaIA("❌ No logré leer la placa. Intenta de nuevo.");
  }

  // 1. Limpiamos el texto de la cámara y lo dividimos en palabras (Tokens)
  // Esto separa "GJS-358-G" de "GUANAJUATO"
  const tokensOCR = textoDetectado.toUpperCase().split(/\s+/).map(p => p.replace(/[^A-Z0-9]/gi, ''));

  const todosLosAutos = Array.from(document.querySelectorAll('.car'));
  let carNode = null;

  for (let car of todosLosAutos) {
    // Obtenemos la placa de la base de datos limpia
    let placaDB = (car.dataset.placas || "").toUpperCase().replace(/[^A-Z0-9]/gi, '');
    if (placaDB.length < 4) continue;

    // 2. BUSCADOR: ¿Alguna palabra de la foto contiene la placa de la base de datos?
    // Ejemplo: Si el token es "GJS358G" y tu placa es "GJS358G", hay match.
    if (tokensOCR.some(token => token.includes(placaDB) || (token.length >= 5 && placaDB.includes(token)))) {
      carNode = car;
      break;
    }
  }

  if (carNode) {
    window.ultimoMVA_MEXIA = carNode.dataset.mva; // Actualizar memoria RAM

    carNode.classList.add('car-focus');
    setTimeout(() => carNode.classList.remove('car-focus'), 5000);

    notificarRespuestaIA(`✅ Identificado: ${carNode.dataset.mva}. ¿Qué orden tienes?`);
    expandirTerminal(); // Abre la terminal automáticamente
  } else {
    notificarRespuestaIA(`❌ Placa no registrada en el patio.`);
  }
}

// ═══════════════════════════════════════════════════════════
// 🗺️  EDITOR VISUAL DE MAPA — [F2] Posicionamiento absoluto libre
// ═══════════════════════════════════════════════════════════

// [F2] Cada celda: { id, valor, tipo, esLabel, orden, x, y, width, height, rotation }
let _edCeldas = [];
let _edSel = null;          // celda seleccionada actualmente
let _edModo = null;         // 'cajon' | 'area' | 'label' | null (herramienta activa)
let _edDrag = null;         // estado de drag: { celdaId, startMouseX, startMouseY, startCeldaX, startCeldaY }
let _edResize = null;       // estado de resize: { celdaId, startMouseX, startMouseY, startW, startH, dir }
let _edZoom = 1.0;          // zoom del canvas
let _edMultiSel = [];       // multi-selección de celdas
let _edRotate = null;       // estado de rotación: { celdaId, cx, cy, startAngle }
let _edRectSel = null;      // rect de selección: { startX, startY }
let _edMenuHideHandler = null;

// [F2] Defaults para celdas nuevas
const _ED_DEFAULT_W = 120;
const _ED_DEFAULT_H = 80;

function _edSelectedRefs() {
  const refs = new Map();
  if (_edSel) {
    const selected = _edCeldas.find(c => c.id === _edSel.id) || _edSel;
    if (selected) refs.set(selected.id, selected);
  }
  _edMultiSel.forEach(item => {
    const ref = _edCeldas.find(c => c.id === item.id) || item;
    if (ref) refs.set(ref.id, ref);
  });
  return Array.from(refs.values());
}

function _edSelectionBounds(selection = _edSelectedRefs()) {
  if (!selection.length) return null;
  const minX = Math.min(...selection.map(c => c.x));
  const minY = Math.min(...selection.map(c => c.y));
  const maxX = Math.max(...selection.map(c => c.x + c.width));
  const maxY = Math.max(...selection.map(c => c.y + c.height));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function _edFillSelectionForm(celda) {
  const noSel = document.getElementById('editor-no-sel');
  const selForm = document.getElementById('editor-sel-form');
  if (noSel) noSel.style.display = celda ? 'none' : 'block';
  if (selForm) selForm.style.display = celda ? 'block' : 'none';
  if (!celda) return;

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };

  setVal('ep-nombre', celda.valor || '');
  setVal('ep-tipo', celda.tipo || 'cajon');
  setVal('ep-x', Math.round(celda.x || 0));
  setVal('ep-y', Math.round(celda.y || 0));
  setVal('ep-width', Math.round(celda.width || _ED_DEFAULT_W));
  setVal('ep-height', Math.round(celda.height || _ED_DEFAULT_H));
  setVal('ep-rotation', Math.round(celda.rotation || 0));
}

function _edSyncEditorHud() {
  const hint = document.getElementById('editor-add-hint');
  const summary = document.getElementById('editor-selection-summary');
  const liveBadge = document.getElementById('editor-live-badge');
  const selectionActions = document.getElementById('editor-selection-actions');
  const groupActions = document.getElementById('editor-group-actions');
  const selectedRefs = _edSelectedRefs();
  const selectedCount = selectedRefs.length;

  if (hint) {
    if (_edModo) {
      const labels = {
        cajon: 'Haz clic en el plano para soltar un cajón nuevo.',
        area: 'Haz clic en el plano para crear una zona especial.',
        label: 'Haz clic en el plano para colocar una etiqueta.'
      };
      hint.innerHTML = `<span class="material-icons" style="font-size:18px; flex-shrink:0;">touch_app</span>${labels[_edModo] || 'Haz clic en el plano para agregar una pieza.'}`;
      hint.style.display = 'flex';
    } else {
      hint.style.display = 'none';
    }
  }

  if (summary) {
    let icon = 'mouse';
    let text = 'Haz clic o encierra con el mouse para empezar.';
    if (_edModo) {
      icon = 'add_box';
      text = `Modo ${_edModo.toUpperCase()} activo.`;
    } else if (selectedCount > 1) {
      icon = 'select_all';
      text = `${selectedCount} piezas seleccionadas.`;
    } else if (_edSel) {
      icon = 'tune';
      text = `Editando ${_edSel.valor || 'pieza'}.`;
    }
    summary.innerHTML = `<span class="material-icons" style="font-size:18px;">${icon}</span><span>${text}</span>`;
  }

  if (liveBadge) {
    const parts = [`${_edCeldas.length} pieza${_edCeldas.length === 1 ? '' : 's'}`];
    parts.push(selectedCount ? `${selectedCount} seleccionada${selectedCount === 1 ? '' : 's'}` : 'Vista previa en vivo');
    liveBadge.innerHTML = `<span class="material-icons" style="font-size:18px;">visibility</span><span>${parts.join(' · ')}</span>`;
  }

  if (selectionActions) selectionActions.style.display = selectedCount ? 'flex' : 'none';
  if (groupActions) groupActions.style.display = selectedCount > 1 ? 'flex' : 'none';
}

function _edCloseMoreMenu() {
  const menu = document.getElementById('ed-more-menu');
  if (menu) {
    menu.style.display = 'none';
    menu.style.visibility = '';
    menu.style.removeProperty('left');
    menu.style.removeProperty('top');
  }
  if (_edMenuHideHandler) {
    document.removeEventListener('mousedown', _edMenuHideHandler);
    _edMenuHideHandler = null;
  }
}

function _edOpenMoreMenuAt(clientX, clientY, celda = _edSel) {
  const menu = document.getElementById('ed-more-menu');
  const wrapper = document.getElementById('editor-grid-wrapper');
  if (!menu || !wrapper) return;

  _edCloseMoreMenu();
  if (celda) _edSelectCelda(celda, { preserveMulti: true });

  menu.style.display = 'block';
  menu.style.visibility = 'hidden';

  requestAnimationFrame(() => {
    const rect = wrapper.getBoundingClientRect();
    const maxLeft = Math.max(12, rect.width - menu.offsetWidth - 12);
    const left = Math.min(Math.max(12, clientX - rect.left), maxLeft);
    const maxTop = Math.max(12, rect.height - menu.offsetHeight - 12);
    const top = Math.max(
      12,
      Math.min(clientY - rect.top - menu.offsetHeight - 12, maxTop)
    );
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = 'visible';
  });

  _edMenuHideHandler = e => {
    if (!menu.contains(e.target)) _edCloseMoreMenu();
  };
  setTimeout(() => document.addEventListener('mousedown', _edMenuHideHandler), 10);
}

function _edToggleSelection(celda) {
  const idx = _edMultiSel.findIndex(item => item.id === celda.id);
  if (idx >= 0) {
    _edMultiSel.splice(idx, 1);
    if (_edSel?.id === celda.id) _edSel = _edMultiSel[_edMultiSel.length - 1] || null;
  } else {
    _edMultiSel.push(celda);
    _edSel = celda;
  }

  _edModo = null;
  _edFillSelectionForm(_edSel);
  _edSyncEditorHud();
  _renderEditorCanvas();
}

function abrirEditorMapa(plazaOverride) {
  console.log('[DEBUG] abrirEditorMapa', { role: userAccessRole, canAdmin: canOpenAdminPanel(), modal: !!document.getElementById('modal-editor-mapa'), plazaOverride });
  // Si se pasa una plaza explícita (desde /editmap/PLAZA), sobreescribir la activa
  if (plazaOverride) {
    PLAZA_ACTIVA_MAPA = _rememberActivePlaza(plazaOverride, { forEditmap: true });
  } else {
    _rememberActivePlaza(_miPlaza(), { forEditmap: true });
  }
  toggleAdminSidebar(false);
  const _edModal = document.getElementById('modal-editor-mapa');
  if (!_edModal) { console.error('[DEBUG] modal-editor-mapa NO ENCONTRADO en DOM'); return; }
  _edModal.classList.add('active');
  console.log('[DEBUG] modal-editor-mapa classList:', _edModal.classList.toString(), 'display:', getComputedStyle(_edModal).display);
  document.getElementById('editor-loading').style.display = 'flex';
  document.getElementById('editor-grid-wrapper').style.display = 'none';
  _edCeldas = []; _edSel = null; _edModo = null; _edDrag = null; _edResize = null; _edZoom = 1.0; _edMultiSel = []; _edRotate = null; _edRectSel = null; _edDragResizeBound = false;
  const zl = document.getElementById('ed-zoom-label'); if (zl) zl.innerText = '100%';
  _edCloseMoreMenu();
  _resetEditorPanel();
  _edSyncEditorHud();
  _bindEditorInspectorDrag();

  (window.api || api).obtenerEstructuraMapa(_miPlaza()).then(estructura => {
    document.getElementById('editor-loading').style.display = 'none';
    document.getElementById('editor-grid-wrapper').style.display = 'block';
    // [F2] Normalizar al formato absoluto (también acepta legado grid)
    const normalizada = _normalizarEstructuraMapa(estructura, { aplicarAireRender: false });
    _edCeldas = normalizada.items.map((c, i) => ({
      id: 'ec_' + i + '_' + Math.random().toString(36).substr(2, 5),
      valor: c.valor,
      tipo: c.tipo || 'cajon',
      esLabel: c.esLabel || false,
      orden: c.orden ?? i,
      x: c.x ?? 0,       // [F2]
      y: c.y ?? 0,       // [F2]
      width: c.width ?? _ED_DEFAULT_W, // [F2]
      height: c.height ?? _ED_DEFAULT_H, // [F2]
      rotation: c.rotation ?? 0,       // [F2]
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
    _renderEditorCanvas();
    _edSyncEditorHud();
  }).catch(err => {
    document.getElementById('editor-loading').innerHTML =
      `<span style="color:#ef4444;font-weight:700;">Error: ${err}</span>`;
  });
}

// [F2] Renderiza el canvas libre del editor con celdas posicionadas absolutamente
function _renderEditorCanvas() {
  const wrapper = document.getElementById('editor-grid-wrapper');
  if (!wrapper) return;

  // Calcular tamaño del canvas
  let canvasW = 900, canvasH = 560;
  _edCeldas.forEach(c => {
    canvasW = Math.max(canvasW, c.x + c.width + 80);
    canvasH = Math.max(canvasH, c.y + c.height + 80);
  });

  let canvas = document.getElementById('editor-canvas-libre');
  if (!canvas) {
    canvas = document.createElement('div');
    canvas.id = 'editor-canvas-libre';
    wrapper.appendChild(canvas);
  }

  let inner = document.getElementById('editor-canvas-inner');
  if (!inner) {
    inner = document.createElement('div');
    inner.id = 'editor-canvas-inner';
    canvas.appendChild(inner);
  }
  inner.className = 'mapa-canvas-libre editor-live-canvas';
  inner.style.width = `${canvasW}px`;
  inner.style.height = `${canvasH}px`;
  inner.style.transform = `scale(${_edZoom})`;
  inner.innerHTML = '';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'ed-guides-svg';
  svg.setAttribute('width', canvasW);
  svg.setAttribute('height', canvasH);
  svg.style.cssText = 'position:absolute; top:0; left:0; pointer-events:none; z-index:100;';
  inner.appendChild(svg);

  inner.oncontextmenu = e => {
    if (e.target !== inner) return;
    e.preventDefault();
    _edCloseMoreMenu();
  };

  inner.onmousedown = e => {
    if (e.button !== 0 || e.target !== inner) return;
    if (_edModo) return; // el click se maneja en onclick
    _edCloseMoreMenu();
    const rect = inner.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / _edZoom;
    const sy = (e.clientY - rect.top) / _edZoom;
    _edRectSel = { startX: sx, startY: sy, additive: e.shiftKey || e.ctrlKey || e.metaKey };
    const rectEl = document.createElement('div');
    rectEl.id = 'ed-rect-sel';
    rectEl.style.cssText = `position:absolute; border:1.5px dashed #a855f7; background:rgba(168,85,247,0.08); pointer-events:none; z-index:99;
          left:${sx}px; top:${sy}px; width:0; height:0;`;
    inner.appendChild(rectEl);
  };

  inner.onclick = e => {
    if (e.target !== inner) return;
    _edCloseMoreMenu();
    if (!_edModo) {
      if (_edSel || _edMultiSel.length) {
        _resetEditorPanel();
        _renderEditorCanvas();
      }
      return;
    }
    const rect = inner.getBoundingClientRect();
    _edClickLibre(Math.round((e.clientX - rect.left) / _edZoom), Math.round((e.clientY - rect.top) / _edZoom));
  };

  [..._edCeldas].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)).forEach(celda => {
    const isSel = _edSel && _edSel.id === celda.id;
    const isMulti = _edMultiSel.some(c => c.id === celda.id);
    const isLabel = celda.tipo === 'label';
    const typeClass = isLabel ? 'ed-label' : celda.tipo === 'area' ? 'area' : 'spot';

    const el = document.createElement('div');
    el.className = `mapa-celda-libre ed-celda-libre ${typeClass}${isSel ? ' ed-celda-sel' : ''}${isMulti && !isSel ? ' ed-celda-multi' : ''}`;
    el.dataset.id = celda.id;
    el.style.cssText = `
          position:absolute;
          left:${celda.x}px; top:${celda.y}px;
          width:${celda.width}px; height:${celda.height}px;
          z-index:${10 + (celda.orden ?? 0)};
          cursor:grab; text-align:center; word-break:break-word;
          user-select:none; box-sizing:border-box; overflow:visible;
          ${celda.rotation ? `transform:rotate(${celda.rotation}deg);` : ''}
        `;

    if (isLabel) {
      el.innerHTML = `<span class="ed-label-chip">${escapeHtml(celda.valor || 'Etiqueta')}</span>`;
    } else if (celda.tipo === 'area') {
      el.innerHTML = `<span class="ed-area-text">${escapeHtml(celda.valor || 'AREA')}</span>`;
    } else {
      el.innerHTML = `
        <label>${escapeHtml(celda.valor || 'SPOT')}</label>
        <div class="ed-spot-inner">
          <span class="material-icons">drive_eta</span>
        </div>
      `;
    }

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'ed-spot-menu-trigger';
    menuBtn.innerHTML = '<span class="material-icons">more_horiz</span>';
    menuBtn.addEventListener('mousedown', e => e.stopPropagation());
    menuBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      _edSelectCelda(celda, { preserveMulti: _edMultiSel.some(item => item.id === celda.id) });
      _edOpenMoreMenuAt(e.clientX, e.clientY, celda);
    });
    el.appendChild(menuBtn);

    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      _edSelectCelda(celda, { preserveMulti: _edMultiSel.some(item => item.id === celda.id) });
      _edOpenMoreMenuAt(e.clientX, e.clientY, celda);
    });

    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      _edCloseMoreMenu();
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        _edToggleSelection(celda);
        return;
      }

      const keepMulti = _edMultiSel.length > 1 && _edMultiSel.some(item => item.id === celda.id);
      _edSelectCelda(celda, { preserveMulti: keepMulti });
      _edDrag = {
        celdaId: celda.id, startMouseX: e.clientX, startMouseY: e.clientY, startCeldaX: celda.x, startCeldaY: celda.y,
        multiStarts: _edSelectedRefs().map(c => ({ id: c.id, x: c.x, y: c.y }))
      };
    });

    if (isSel) {
      const handleDefs = [
        { dir: 'nw', style: 'top:-5px; left:-5px; cursor:nw-resize;' },
        { dir: 'n', style: `top:-5px; left:${celda.width / 2 - 5}px; cursor:n-resize;` },
        { dir: 'ne', style: `top:-5px; left:${celda.width - 5}px; cursor:ne-resize;` },
        { dir: 'w', style: `top:${celda.height / 2 - 5}px; left:-5px; cursor:w-resize;` },
        { dir: 'e', style: `top:${celda.height / 2 - 5}px; left:${celda.width - 5}px; cursor:e-resize;` },
        { dir: 'sw', style: `top:${celda.height - 5}px; left:-5px; cursor:sw-resize;` },
        { dir: 's', style: `top:${celda.height - 5}px; left:${celda.width / 2 - 5}px; cursor:s-resize;` },
        { dir: 'se', style: `top:${celda.height - 5}px; left:${celda.width - 5}px; cursor:se-resize;` },
      ];
      handleDefs.forEach(({ dir, style }) => {
        const h = document.createElement('div');
        h.className = 'ed-handle-8';
        h.style.cssText += style;
        h.addEventListener('mousedown', e => {
          if (e.button !== 0) return;
          e.stopPropagation();
          _edResize = {
            celdaId: celda.id, dir, startMouseX: e.clientX, startMouseY: e.clientY,
            startW: celda.width, startH: celda.height, startX: celda.x, startY: celda.y
          };
        });
        el.appendChild(h);
      });

      // Handle de rotación
      const rotH = document.createElement('div');
      rotH.className = 'ed-rotate-handle';
      rotH.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
        _edRotate = { celdaId: celda.id, cx, cy, startAngle, startRotation: celda.rotation || 0 };
      });
      el.appendChild(rotH);
    }

    inner.appendChild(el);
  });

  _bindEditorDragResize(inner);
  _edSyncEditorHud();
}

// [F2] Bind de drag y resize en el canvas del editor
let _edDragResizeBound = false;
function _bindEditorDragResize(inner) {
  if (_edDragResizeBound) return;
  _edDragResizeBound = true;

  document.addEventListener('mousemove', e => {
    // --- ROTATE ---
    if (_edRotate) {
      const angle = Math.atan2(e.clientY - _edRotate.cy, e.clientX - _edRotate.cx) * (180 / Math.PI);
      const delta = angle - _edRotate.startAngle;
      const c = _edCeldas.find(x => x.id === _edRotate.celdaId);
      if (c) {
        c.rotation = Math.round(_edRotate.startRotation + delta);
        const el = inner.querySelector(`.ed-celda-libre[data-id="${c.id}"]`);
        if (el) el.style.transform = `rotate(${c.rotation}deg)`;
        const rEl = document.getElementById('ep-rotation'); if (rEl) rEl.value = c.rotation;
      }
      return;
    }
    // --- DRAG ---
    if (_edDrag) {
      const rawDx = (e.clientX - _edDrag.startMouseX) / _edZoom;
      const rawDy = (e.clientY - _edDrag.startMouseY) / _edZoom;
      const c = _edCeldas.find(x => x.id === _edDrag.celdaId);
      if (c) {
        let nx = Math.max(0, _edDrag.startCeldaX + rawDx);
        let ny = Math.max(0, _edDrag.startCeldaY + rawDy);
        // Snap guides
        const snap = _edComputeSnap(c, nx, ny);
        nx = snap.x; ny = snap.y;
        c.x = nx; c.y = ny;
        // Mover multi-selección con el mismo delta
        if (_edDrag.multiStarts.length > 0) {
          _edDrag.multiStarts.forEach(ms => {
            const mc = _edCeldas.find(x => x.id === ms.id);
            if (mc && mc.id !== c.id) {
              mc.x = Math.max(0, ms.x + (nx - _edDrag.startCeldaX));
              mc.y = Math.max(0, ms.y + (ny - _edDrag.startCeldaY));
              const mel = inner.querySelector(`.ed-celda-libre[data-id="${mc.id}"]`);
              if (mel) { mel.style.left = `${mc.x}px`; mel.style.top = `${mc.y}px`; }
            }
          });
        }
        // Dibujar guías
        _edDrawGuides(c, snap.guideLines);
        // Actualizar posición visual sin re-renderizar todo
        const el = inner.querySelector(`.ed-celda-libre[data-id="${c.id}"]`);
        if (el) { el.style.left = `${c.x}px`; el.style.top = `${c.y}px`; }
        else _renderEditorCanvas();
        _edFillSelectionForm(c);
      }
      return;
    }
    // --- RESIZE ---
    if (_edResize) {
      const dx = (e.clientX - _edResize.startMouseX) / _edZoom;
      const dy = (e.clientY - _edResize.startMouseY) / _edZoom;
      const c = _edCeldas.find(x => x.id === _edResize.celdaId);
      if (c) {
        const dir = _edResize.dir;
        if (dir.includes('e')) c.width = Math.max(40, _edResize.startW + dx);
        if (dir.includes('s')) c.height = Math.max(30, _edResize.startH + dy);
        if (dir.includes('w')) { const nw = Math.max(40, _edResize.startW - dx); c.x = _edResize.startX + (_edResize.startW - nw); c.width = nw; }
        if (dir.includes('n')) { const nh = Math.max(30, _edResize.startH - dy); c.y = _edResize.startY + (_edResize.startH - nh); c.height = nh; }
        _renderEditorCanvas();
      }
      return;
    }
    // --- RECT SELECT ---
    if (_edRectSel) {
      const rect = inner.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / _edZoom;
      const cy = (e.clientY - rect.top) / _edZoom;
      const rx = Math.min(cx, _edRectSel.startX);
      const ry = Math.min(cy, _edRectSel.startY);
      const rw = Math.abs(cx - _edRectSel.startX);
      const rh = Math.abs(cy - _edRectSel.startY);
      const rectEl = document.getElementById('ed-rect-sel');
      if (rectEl) { rectEl.style.left = rx + 'px'; rectEl.style.top = ry + 'px'; rectEl.style.width = rw + 'px'; rectEl.style.height = rh + 'px'; }
      _edRectSel.curX = cx; _edRectSel.curY = cy;
    }
  });

  document.addEventListener('mouseup', e => {
    if (_edRotate) {
      const preserve = _edSelectedRefs().length > 1;
      _edRotate = null;
      if (_edSel) _edSelectCelda(_edSel, { preserveMulti: preserve });
      return;
    }
    if (_edDrag) {
      _edDrag = null;
      const svg = document.getElementById('ed-guides-svg');
      if (svg) svg.innerHTML = '';
      _renderEditorCanvas();
    }
    if (_edResize) {
      const preserve = _edSelectedRefs().length > 1;
      _edResize = null;
      if (_edSel) _edSelectCelda(_edSel, { preserveMulti: preserve });
    }
    if (_edRectSel) {
      // Finalizar rect select
      const sx = Math.min(_edRectSel.startX, _edRectSel.curX || _edRectSel.startX);
      const sy = Math.min(_edRectSel.startY, _edRectSel.curY || _edRectSel.startY);
      const ex = Math.max(_edRectSel.startX, _edRectSel.curX || _edRectSel.startX);
      const ey = Math.max(_edRectSel.startY, _edRectSel.curY || _edRectSel.startY);
      const hits = _edCeldas.filter(c => !(c.x + c.width < sx || c.y + c.height < sy || c.x > ex || c.y > ey));
      if (hits.length) {
        if (_edRectSel.additive) {
          const merged = new Map(_edSelectedRefs().map(c => [c.id, c]));
          hits.forEach(c => merged.set(c.id, c));
          _edMultiSel = Array.from(merged.values());
        } else {
          _edMultiSel = hits.slice();
        }
        _edSel = hits[hits.length - 1];
        _edFillSelectionForm(_edSel);
      } else if (!_edRectSel.additive) {
        _resetEditorPanel();
      }
      _edRectSel = null;
      _renderEditorCanvas();
    }
  });
}

// Calcular snap y líneas guía durante drag
function _edComputeSnap(dragged, nx, ny) {
  const TOL = 6;
  let snapX = nx, snapY = ny;
  const guideLines = [];
  const dEdges = {
    l: nx, r: nx + dragged.width, cx: nx + dragged.width / 2,
    t: ny, b: ny + dragged.height, cy: ny + dragged.height / 2
  };
  _edCeldas.forEach(other => {
    if (other.id === dragged.id) return;
    const oEdges = {
      l: other.x, r: other.x + other.width, cx: other.x + other.width / 2,
      t: other.y, b: other.y + other.height, cy: other.y + other.height / 2
    };
    // Snap X
    const xPairs = [
      [dEdges.l, oEdges.l], [dEdges.l, oEdges.r], [dEdges.r, oEdges.l], [dEdges.r, oEdges.r],
      [dEdges.cx, oEdges.cx]
    ];
    xPairs.forEach(([da, oa]) => {
      if (Math.abs(da - oa) < TOL) {
        snapX = nx + (oa - da);
        guideLines.push({ x1: oa, y1: 0, x2: oa, y2: 9999 });
      }
    });
    // Snap Y
    const yPairs = [
      [dEdges.t, oEdges.t], [dEdges.t, oEdges.b], [dEdges.b, oEdges.t], [dEdges.b, oEdges.b],
      [dEdges.cy, oEdges.cy]
    ];
    yPairs.forEach(([da, oa]) => {
      if (Math.abs(da - oa) < TOL) {
        snapY = ny + (oa - da);
        guideLines.push({ x1: 0, y1: oa, x2: 9999, y2: oa });
      }
    });
  });
  return { x: snapX, y: snapY, guideLines };
}

// Dibujar líneas guía en el SVG overlay
function _edDrawGuides(dragged, lines) {
  const svg = document.getElementById('ed-guides-svg');
  if (!svg) return;
  svg.innerHTML = '';
  lines.forEach(l => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', l.x1); line.setAttribute('y1', l.y1);
    line.setAttribute('x2', l.x2); line.setAttribute('y2', l.y2);
    line.setAttribute('stroke', '#a855f7');
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '4,3');
    line.setAttribute('opacity', '0.8');
    svg.appendChild(line);
  });
}

// [F2] Selecciona una celda y actualiza el panel de propiedades
function _edSelectCelda(celda, options = {}) {
  const { preserveMulti = false } = options;
  _edModo = null;
  const addHint = document.getElementById('editor-add-hint');
  if (addHint) addHint.style.display = 'none';
  _edSel = celda;
  if (celda && !preserveMulti) _edMultiSel = [celda];
  if (celda && preserveMulti && !_edMultiSel.some(item => item.id === celda.id)) _edMultiSel.push(celda);
  _edFillSelectionForm(celda);
  _edSyncEditorHud();
  _renderEditorCanvas();
}

function _resetEditorPanel() {
  _edSel = null;
  _edMultiSel = [];
  _edFillSelectionForm(null);
  const hint = document.getElementById('editor-add-hint');
  if (hint) hint.style.display = 'none';
  ['btn-tool-cajon', 'btn-tool-area', 'btn-tool-label'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  _edCloseMoreMenu();
  _edSyncEditorHud();
}

// [F2] Clic en área vacía del canvas al tener herramienta activa
function _edClickLibre(cx, cy) {
  const tipo = _edModo;
  if (!tipo) return;
  const n = _edCeldas.filter(x => x.tipo === tipo).length + 1;
  const nombre = tipo === 'cajon' ? `X${n}` : tipo === 'area' ? `AREA${n}` : `S${n}`;
  const w = tipo === 'area' ? _ED_DEFAULT_W * 2 : _ED_DEFAULT_W; // [F2]
  const h = tipo === 'area' ? _ED_DEFAULT_H * 2 : _ED_DEFAULT_H; // [F2]
  const nueva = {
    id: 'ec_new_' + Date.now(), valor: nombre, tipo, esLabel: tipo === 'label',
    orden: _edCeldas.length,
    x: Math.max(0, cx - Math.round(w / 2)), y: Math.max(0, cy - Math.round(h / 2)), // [F2]
    width: w, height: h, rotation: 0, // [F2]
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
  _edCeldas.push(nueva);
  _edModo = null;
  _edMultiSel = [nueva];
  _edSelectCelda(nueva);
}

// [F2] Cambio de propiedades desde el panel lateral
function editorPropChange() {
  if (!_edSel) return;
  _edSel.valor = document.getElementById('ep-nombre').value.toUpperCase();
  _edSel.tipo = document.getElementById('ep-tipo').value;
  _edSel.esLabel = _edSel.tipo === 'label';
  // [F2] Leer x,y,width,height,rotation del panel
  const toNum = (id, fallback) => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? fallback : v; };
  _edSel.x = toNum('ep-x', _edSel.x);
  _edSel.y = toNum('ep-y', _edSel.y);
  _edSel.width = Math.max(20, toNum('ep-width', _edSel.width));
  _edSel.height = Math.max(20, toNum('ep-height', _edSel.height));
  _edSel.rotation = toNum('ep-rotation', _edSel.rotation || 0);
  const idx = _edCeldas.findIndex(c => c.id === _edSel.id);
  if (idx >= 0) _edCeldas[idx] = { ..._edSel };
  _edFillSelectionForm(_edSel);
  _renderEditorCanvas();
}

// [F2] editorSpanChange renombrado a editorDimChange — ajusta width/height en pasos
function editorSpanChange(prop, delta) {
  if (!_edSel) return;
  if (prop === 'width') _edSel.width = Math.max(20, (_edSel.width || _ED_DEFAULT_W) + delta);
  else if (prop === 'height') _edSel.height = Math.max(20, (_edSel.height || _ED_DEFAULT_H) + delta);
  const idx = _edCeldas.findIndex(c => c.id === _edSel.id);
  if (idx >= 0) { _edCeldas[idx].width = _edSel.width; _edCeldas[idx].height = _edSel.height; }
  _edFillSelectionForm(_edSel);
  _renderEditorCanvas();
}

// [F2] editorMoverCelda — mueve en pasos de px
function editorMoverCelda(dCol, dRow) {
  const refs = _edSelectedRefs();
  if (!refs.length) return;
  const STEP = 10;
  refs.forEach(ref => {
    ref.x = Math.max(0, (ref.x || 0) + dCol * STEP);
    ref.y = Math.max(0, (ref.y || 0) + dRow * STEP);
  });
  if (_edSel) _edFillSelectionForm(_edSel);
  _renderEditorCanvas();
}

function editorEliminarCelda() {
  const refs = _edSelectedRefs();
  if (!refs.length) return;
  const ids = new Set(refs.map(c => c.id));
  _edCeldas = _edCeldas.filter(c => !ids.has(c.id));
  _resetEditorPanel();
  _renderEditorCanvas();
}

// ── ZOOM ──
function editorZoom(delta) {
  if (delta === 0) { _edZoom = 1.0; }
  else { _edZoom = Math.min(3, Math.max(0.25, _edZoom + delta)); }
  const inner = document.getElementById('editor-canvas-inner');
  if (inner) { inner.style.transform = `scale(${_edZoom})`; inner.style.transformOrigin = 'top left'; }
  const lbl = document.getElementById('ed-zoom-label');
  if (lbl) lbl.innerText = Math.round(_edZoom * 100) + '%';
}

// ── COPIAR CELDA ──
function editorCopiarCelda() {
  const refs = _edSelectedRefs();
  if (!refs.length) return;
  const copias = refs.map((ref, index) => ({
    ...ref,
    id: 'ec_copy_' + Date.now() + '_' + index,
    x: ref.x + 24,
    y: ref.y + 24,
    orden: (_edCeldas.length + index)
  }));
  _edCeldas.push(...copias);
  _edMultiSel = copias;
  _edSelectCelda(copias[copias.length - 1], { preserveMulti: true });
}

// ── FORMAS PREDETERMINADAS ──
function editorAgregarForma(tipo) {
  const cx = 80, cy = 80;
  const baseX = 60, baseY = 60;
  const n = _edCeldas.length + 1;
  const nombre = `C${n}`;
  if (tipo === 'fila-3') {
    const nuevas = [];
    const y = baseY + (_edCeldas.length > 0 ? Math.max(..._edCeldas.map(c => c.y + c.height)) + 10 : 0);
    [0, 1, 2].forEach(i => {
      const c = {
        id: 'ec_new_' + Date.now() + i, valor: `C${_edCeldas.length + 1}`, tipo: 'cajon', esLabel: false,
        orden: _edCeldas.length, x: baseX + i * 84, y, width: 80, height: 80, rotation: 0,
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
      _edCeldas.push(c);
      nuevas.push(c);
    });
    _edMultiSel = nuevas;
    _edSelectCelda(nuevas[nuevas.length - 1], { preserveMulti: true });
    return;
  }
  const dims = { 'cuadrado': [80, 80], 'rect-h': [120, 80], 'rect-v': [80, 120], 'rect-grande': [240, 80] };
  const [w, h] = dims[tipo] || [80, 80];
  const nueva = {
    id: 'ec_new_' + Date.now(), valor: nombre, tipo: 'cajon', esLabel: false,
    orden: _edCeldas.length, x: baseX, y: baseY + (_edCeldas.length > 0 ? Math.max(..._edCeldas.map(c => c.y + c.height)) + 10 : 0),
    width: w, height: h, rotation: 0,
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
  _edCeldas.push(nueva);
  _edSelectCelda(nueva);
}

// ── MENÚ "..." ──
function editorToggleMoreMenu() {
  const selected = _edSel || _edSelectedRefs()[0];
  if (!selected) {
    showToast('Selecciona una pieza para ver más opciones.', 'warning');
    return;
  }
  const menu = document.getElementById('ed-more-menu');
  if (menu?.style.display === 'block') {
    _edCloseMoreMenu();
    return;
  }
  const anchor = document.querySelector(`.ed-celda-libre[data-id="${selected.id}"]`);
  const rect = anchor?.getBoundingClientRect();
  const fallbackX = window.innerWidth / 2;
  const fallbackY = window.innerHeight / 2;
  _edOpenMoreMenuAt(rect ? rect.right : fallbackX, rect ? rect.bottom : fallbackY, selected);
}

function editorCentrarH() {
  _edCloseMoreMenu();
  const refs = _edSelectedRefs();
  if (!refs.length) return;
  const inner = document.getElementById('editor-canvas-inner');
  const cw = inner ? parseInt(inner.style.width) : 800;
  const bounds = _edSelectionBounds(refs);
  const offset = Math.round((cw - (bounds?.width || 0)) / 2) - (bounds?.minX || 0);
  refs.forEach(ref => { ref.x = Math.max(0, ref.x + offset); });
  _edSelectCelda(_edSel, { preserveMulti: refs.length > 1 });
}

function editorCentrarV() {
  _edCloseMoreMenu();
  const refs = _edSelectedRefs();
  if (!refs.length) return;
  const inner = document.getElementById('editor-canvas-inner');
  const ch = inner ? parseInt(inner.style.height) : 500;
  const bounds = _edSelectionBounds(refs);
  const offset = Math.round((ch - (bounds?.height || 0)) / 2) - (bounds?.minY || 0);
  refs.forEach(ref => { ref.y = Math.max(0, ref.y + offset); });
  _edSelectCelda(_edSel, { preserveMulti: refs.length > 1 });
}

function editorTraerFrente() {
  _edCloseMoreMenu();
  const refs = _edSelectedRefs();
  if (!refs.length) return;
  let nextOrden = Math.max(..._edCeldas.map(c => c.orden ?? 0), 0) + 1;
  refs.forEach(ref => { ref.orden = nextOrden++; });
  _renderEditorCanvas();
}

function editorEnviarFondo() {
  _edCloseMoreMenu();
  const refs = _edSelectedRefs();
  if (!refs.length) return;
  let nextOrden = Math.min(..._edCeldas.map(c => c.orden ?? 0), 0) - refs.length;
  refs.forEach(ref => { ref.orden = nextOrden++; });
  _renderEditorCanvas();
}

function editorDuplicarFila() {
  _edCloseMoreMenu();
  if (!_edSel) return;
  const filaY = _edSel.y;
  const tol = 20;
  const fila = _edCeldas.filter(c => Math.abs(c.y - filaY) <= tol);
  const maxY = Math.max(...fila.map(c => c.y + c.height));
  const offsetY = maxY + 10 - filaY;
  fila.forEach(c => {
    const copia = { ...c, id: 'ec_copy_' + Date.now() + Math.random(), y: c.y + offsetY, orden: _edCeldas.length };
    _edCeldas.push(copia);
  });
  _renderEditorCanvas();
}

// ── ALINEACIÓN DE GRUPO ──
function editorAlinearGrupo(modo) {
  const sel = _edSelectedRefs();
  if (sel.length < 2) { showToast('Selecciona 2+ celdas con Shift+clic', 'error'); return; }
  const refs = sel.map(c => _edCeldas.find(x => x.id === c.id)).filter(Boolean);
  if (modo === 'left') { const min = Math.min(...refs.map(c => c.x)); refs.forEach(c => c.x = min); }
  if (modo === 'right') { const max = Math.max(...refs.map(c => c.x + c.width)); refs.forEach(c => c.x = max - c.width); }
  if (modo === 'centerH') { const avg = refs.reduce((s, c) => s + c.x + c.width / 2, 0) / refs.length; refs.forEach(c => c.x = Math.round(avg - c.width / 2)); }
  if (modo === 'top') { const min = Math.min(...refs.map(c => c.y)); refs.forEach(c => c.y = min); }
  if (modo === 'bottom') { const max = Math.max(...refs.map(c => c.y + c.height)); refs.forEach(c => c.y = max - c.height); }
  if (modo === 'centerV') { const avg = refs.reduce((s, c) => s + c.y + c.height / 2, 0) / refs.length; refs.forEach(c => c.y = Math.round(avg - c.height / 2)); }
  _renderEditorCanvas();
}

function editorDistribuirGrupo(eje) {
  const sel = _edSelectedRefs();
  if (sel.length < 3) { showToast('Selecciona 3+ celdas para distribuir', 'error'); return; }
  const refs = sel.map(c => _edCeldas.find(x => x.id === c.id)).filter(Boolean);
  if (eje === 'H') {
    refs.sort((a, b) => a.x - b.x);
    const totalW = refs.reduce((s, c) => s + c.width, 0);
    const space = (refs[refs.length - 1].x + refs[refs.length - 1].width - refs[0].x - totalW) / (refs.length - 1);
    let cur = refs[0].x + refs[0].width;
    for (let i = 1; i < refs.length - 1; i++) { refs[i].x = Math.round(cur + space); cur = refs[i].x + refs[i].width; }
  } else {
    refs.sort((a, b) => a.y - b.y);
    const totalH = refs.reduce((s, c) => s + c.height, 0);
    const space = (refs[refs.length - 1].y + refs[refs.length - 1].height - refs[0].y - totalH) / (refs.length - 1);
    let cur = refs[0].y + refs[0].height;
    for (let i = 1; i < refs.length - 1; i++) { refs[i].y = Math.round(cur + space); cur = refs[i].y + refs[i].height; }
  }
  _renderEditorCanvas();
}

function modoAgregarEditor(tipo) {
  _edModo = tipo;
  _resetEditorPanel();
  ['btn-tool-cajon', 'btn-tool-area', 'btn-tool-label'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const btnMap = { cajon: 'btn-tool-cajon', area: 'btn-tool-area', label: 'btn-tool-label' };
  const activeBtn = document.getElementById(btnMap[tipo]);
  if (activeBtn) activeBtn.classList.add('active');
  _edSyncEditorHud();
  _renderEditorCanvas();
}

// [F2] editorCambiarGrid ya no aplica al canvas libre — se mantiene por compatibilidad HTML pero no hace nada
function editorCambiarGrid(dim, delta) { /* [F2] sin efecto en canvas libre */ }

function guardarMapaEditor(btn) {
  if (_edCeldas.length === 0) { showToast("El mapa está vacío", "error"); return; }
  const saveLabelHtml = '<span class="material-icons" style="font-size:17px;">save</span> GUARDAR CAMBIOS';
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons spinner" style="font-size:16px;">sync</span> Guardando...';
  const isStandaloneEditmap = EDITMAP_STANDALONE_ROUTE_RE.test(window.location.pathname || '') || window.__MEX_EDITMAP_STANDALONE === true;

  // [F2] Payload con campos de posicionamiento absoluto
  const payload = _edCeldas.map((c, i) => ({
    valor: c.valor,
    tipo: c.tipo,
    esLabel: c.tipo === 'label',
    orden: i,
    x: Math.round(c.x || 0),       // [F2]
    y: Math.round(c.y || 0),       // [F2]
    width: Math.round(c.width || _ED_DEFAULT_W), // [F2]
    height: Math.round(c.height || _ED_DEFAULT_H), // [F2]
    rotation: Math.round(c.rotation || 0),       // [F2]
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

  const _plazaGuardado = _miPlaza();
  _rememberActivePlaza(_plazaGuardado, { forEditmap: true });
  console.log('[MEX-INTEG] guardarMapaEditor →', { plaza: _plazaGuardado || '(sin plaza)', celdas: payload.length });
  if (!_plazaGuardado) {
    showToast('⚠️ No hay plaza activa para guardar el mapa. Selecciona una plaza.', 'warning');
    btn.disabled = false;
    btn.innerHTML = saveLabelHtml;
    return;
  }
  (window.api || api).guardarEstructuraMapa(payload, _plazaGuardado).then(res => {
    btn.disabled = false;
    btn.innerHTML = saveLabelHtml;
    if (res === 'OK') {
      showToast("✅ Mapa guardado correctamente", "success");
      if (isStandaloneEditmap) {
        return;
      }
      setTimeout(() => {
        document.getElementById('modal-editor-mapa').classList.remove('active');
        dibujarMapaCompleto();
      }, 1200);
    }
  }).catch(err => {
    btn.disabled = false;
    btn.innerHTML = saveLabelHtml;
    showToast("Error: " + err, "error");
  });
}

async function migrarConfiguracionAFirestore() {
  const configInicial = {
    empresa: {
      nombre: "NO NAME",
      slogan: "Administración de Flota",
      colorPrincipal: "#004a99"
    },
    listas: {
      ubicaciones: ["PATIO", "TALLER", "AGENCIA", "TALLER EXTERNO", "HYP COBIAN", "JORGE", "GERARDO", "OSVALDO", "BALANDRAN", "ULISES", "JOSUE", "ISRAEL", "ISAAC", "ANGEL", "LEO", "BRAULIO", "LONGORIA", "MARTHA", "FERNANDA", "ZALLO", "UBALDO", "JOSE LUIS", "PASCUAL", "EDUARDO", "EDGAR"],
      estados: [
        { id: "LISTO", color: "#10b981", orden: 1 },
        { id: "SUCIO", color: "#f59e0b", orden: 2 },
        { id: "MANTENIMIENTO", color: "#ef4444", orden: 3 },
        { id: "RESGUARDO", color: "#64748b", orden: 4 },
        { id: "TRASLADO", color: "#c084fc", orden: 5 },
        { id: "EN RENTA", color: "#38bdf8", orden: 6 },
        { id: "NO ARRENDABLE", color: "#cbd5e1", orden: 7 },
        { id: "HYP", color: "#ef4444", orden: 8 },
        { id: "RETENIDA", color: "#78350f", orden: 92 },
        { id: "VENTA", color: "#1e293b", orden: 93 }
      ],
      gasolinas: ["F", "15/16", "7/8", "13/16", "3/4", "11/16", "5/8", "9/16", "H", "7/16", "3/8", "5/16", "1/4", "3/16", "1/8", "1/16", "E", "N/A"],
      categorias: ["ECAR", "CCAR", "ICAR", "FCAR", "SCAR", "CFAR", "SFAR", "FWAR", "MVAR", "IVAH", "MVAH", "FFBH", "CKMR", "MPMN", "PFAR", "GVMD"]
    }
  };

  await db.collection("configuracion").doc("empresa").set(configInicial.empresa);
  await db.collection("configuracion").doc("listas").set(configInicial.listas);
  console.log("✅ ¡Migración de configuración completada!");
}


let TAB_ACTIVA_CFG = 'usuarios';
let _cfgCatalogSelectedIndex = null;
let _cfgCatalogEditIndex = null;

const _cfgAdminTabMeta = {
  usuarios: {
    group: 'accesos',
    groupLabel: 'Accesos y permisos',
    label: 'Usuarios',
    badge: 'Usuarios',
    description: 'Administra cuentas, plazas base, permisos individuales y acciones operativas del equipo.'
  },
  roles: {
    group: 'accesos',
    groupLabel: 'Accesos y permisos',
    label: 'Roles',
    badge: 'Seguridad',
    description: 'Define alcances, jerarquías y permisos por rol para la operación y administración del sistema.'
  },
  solicitudes: {
    group: 'accesos',
    groupLabel: 'Accesos y permisos',
    label: 'Solicitudes',
    badge: 'Onboarding',
    description: 'Revisa solicitudes pendientes, aprueba accesos y convierte formularios en perfiles listos para operar.'
  },
  estados: {
    group: 'operacion',
    groupLabel: 'Operación',
    label: 'Estados',
    badge: 'Catálogo',
    description: 'Organiza los estados visibles de las unidades y su impacto en filtros, alertas y lectura operativa.'
  },
  categorias: {
    group: 'operacion',
    groupLabel: 'Operación',
    label: 'Categorías',
    badge: 'Catálogo',
    description: 'Agrupa unidades por familia operativa y prepara la base para reglas visuales y acomodo.'
  },
  modelos: {
    group: 'operacion',
    groupLabel: 'Operación',
    label: 'Modelos',
    badge: 'Inventario',
    description: 'Mantén el catálogo de modelos y su relación con categorías, imagen y formularios internos.'
  },
  gasolinas: {
    group: 'operacion',
    groupLabel: 'Operación',
    label: 'Gasolinas',
    badge: 'Catálogo',
    description: 'Configura los niveles de combustible disponibles para reporte, estado y seguimiento operativo.'
  },
  plazas: {
    group: 'estructura',
    groupLabel: 'Estructura',
    label: 'Plazas',
    badge: 'Estructura',
    description: 'Gestiona plazas, contactos, direcciones, correos y herramientas asociadas al mapa operativo.'
  },
  ubicaciones: {
    group: 'estructura',
    groupLabel: 'Estructura',
    label: 'Ubicaciones',
    badge: 'Layout',
    description: 'Define responsables, plazas fijas y puntos del patio visibles para operación, asignación y control.'
  },
  empresa: {
    group: 'organizacion',
    groupLabel: 'Organización',
    label: 'Empresa',
    badge: 'Negocio',
    description: 'Centraliza identidad visual, correos globales, parámetros base y configuración administrativa global.'
  },
  programador: {
    group: 'programador',
    groupLabel: 'Programador',
    label: 'Consola técnica',
    badge: 'Control',
    description: 'Accede al Centro de Control técnico para observabilidad, jobs, seguridad y herramientas avanzadas.'
  }
};
let _programmerConsoleState = { log: [], selectedPlaza: '', jsonDraft: '' };
let _cfgAdminStatsCache = { users: null, pending: null, stamp: 0 };

function _cfgCatalogDisplayValue(tabName, item) {
  if (!item) return '';
  const tab = String(tabName || '').trim().toLowerCase();
  if (tab === 'categorias') return String(typeof item === 'object' ? (item.nombre || item.id) : item).trim();
  if (tab === 'gasolinas') return String(typeof item === 'object' ? (item.nombre || item.id || item.valor) : item).trim();
  if (tab === 'modelos') return String(item.nombre || item.id || '').trim();
  if (tab === 'ubicaciones') return String(item.nombre || item.id || item).trim();
  if (tab === 'estados') return String(item.id || item.nombre || item).trim();
  return String(item.nombre || item.id || item).trim();
}

function _cfgCatalogDescriptionValue(tabName, item) {
  if (!item || typeof item !== 'object') return '';
  if (String(tabName || '').trim().toLowerCase() === 'categorias') {
    return String(item.descripcion || item.description || item.desc || '').trim();
  }
  return '';
}

function _cfgCatalogOrderValue(item, index = 0) {
  const raw = typeof item === 'object' ? Number(item.orden) : 0;
  return Number.isFinite(raw) && raw > 0 ? raw : (Number(index) + 1);
}

function _cfgCatalogApplyOrder(list = [], tabName = TAB_ACTIVA_CFG) {
  const tab = String(tabName || '').trim().toLowerCase();
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    if (tab === 'estados' || tab === 'ubicaciones' || tab === 'categorias' || tab === 'modelos') {
      item.orden = index + 1;
    }
  });
  return list;
}

function _cfgNormalizeDesiredOrder(value, fallback = 1, total = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.min(Math.max(Number(fallback) || 1, 1), Math.max(total, 1));
  return Math.min(Math.max(Math.round(parsed), 1), Math.max(total, 1));
}

function _cfgMoveCatalogItem(list = [], fromIndex = 0, desiredOrder = 1, tabName = TAB_ACTIVA_CFG) {
  if (!Array.isArray(list) || fromIndex < 0 || fromIndex >= list.length) return list;
  const targetIndex = _cfgNormalizeDesiredOrder(desiredOrder, fromIndex + 1, list.length) - 1;
  if (targetIndex === fromIndex) {
    _cfgCatalogApplyOrder(list, tabName);
    return list;
  }
  const [moved] = list.splice(fromIndex, 1);
  list.splice(targetIndex, 0, moved);
  _cfgCatalogApplyOrder(list, tabName);
  return list;
}

function _cfgReadValue(id, fallback = '') {
  const el = document.getElementById(id);
  if (!el) return fallback;
  return String(el.value ?? fallback).trim();
}

function _cfgSetInsightValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (value === null || value === undefined || value === '') {
    el.textContent = '--';
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    el.textContent = value.toLocaleString('es-MX');
    return;
  }
  el.textContent = String(value);
}

function _cfgCatalogItemsTotal() {
  const listas = window.MEX_CONFIG?.listas || {};
  return Object.values(listas).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
}

function _cfgResolveTabButton(tabName = '') {
  const tab = String(tabName || '').trim().toLowerCase();
  return document.getElementById(`cfg-tab-${tab}`) || document.querySelector(`.cfg-tab[onclick*="'${tab}'"]`);
}

function _cfgMetaForTab(tabName = TAB_ACTIVA_CFG) {
  return _cfgAdminTabMeta[String(tabName || '').trim().toLowerCase()] || {
    group: 'organizacion',
    groupLabel: 'Centro admin',
    label: 'Configuración',
    badge: 'Config',
    description: 'Ajusta catálogos, estructura y parámetros del sistema sin salir del flujo actual.'
  };
}

function _cfgApplySidebarPinState(forcePinned = null) {
  const sidebar = document.getElementById('cfg-admin-sidebar');
  const toggle = document.getElementById('cfg-sidebar-pin');
  if (!sidebar) return;
  const pinned = forcePinned === null
    ? localStorage.getItem('mex.admin.sidebar.pinned') !== '0'
    : Boolean(forcePinned);
  sidebar.classList.toggle('is-pinned', pinned);
  if (toggle) {
    toggle.title = pinned ? 'Desfijar sidebar' : 'Fijar sidebar expandido';
    toggle.setAttribute('aria-pressed', pinned ? 'true' : 'false');
  }
}

function _cfgToggleSidebarPin() {
  const sidebar = document.getElementById('cfg-admin-sidebar');
  const nextPinned = !(sidebar?.classList.contains('is-pinned'));
  localStorage.setItem('mex.admin.sidebar.pinned', nextPinned ? '1' : '0');
  _cfgApplySidebarPinState(nextPinned);
}

function _cfgOpenNavGroup(groupKey = '', keepOthers = false) {
  const target = String(groupKey || '').trim().toLowerCase();
  document.querySelectorAll('.cfg-nav-group').forEach(section => {
    if (!keepOthers) section.classList.remove('open');
    if (section.getAttribute('data-group') === target) section.classList.add('open');
  });
}

function _cfgToggleNavGroup(groupKey = '') {
  const target = document.querySelector(`.cfg-nav-group[data-group="${String(groupKey || '').trim().toLowerCase()}"]`);
  if (!target) return;
  const shouldOpen = !target.classList.contains('open');
  target.classList.toggle('open', shouldOpen);
}

function _cfgSyncNavState(tabName = TAB_ACTIVA_CFG) {
  const meta = _cfgMetaForTab(tabName);
  _cfgOpenNavGroup(meta.group, true);
}

function _cfgRoleContextLabel() {
  const normalizedRole = String(userAccessRole || currentUserProfile?.rol || '').trim().toUpperCase();
  return ROLE_META?.[normalizedRole]?.label || normalizedRole || 'Sin rol';
}

function _cfgSetMetaChip(id, icon, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `
    <span class="material-icons">${escapeHtml(icon)}</span>
    <span>${escapeHtml(text)}</span>
  `;
}

function _cfgUpdateWorkspaceHeader(tabName = TAB_ACTIVA_CFG) {
  const meta = _cfgMetaForTab(tabName);
  const breadcrumb = document.getElementById('cfg-module-breadcrumb');
  const title = document.getElementById('cfg-module-title');
  const subtitle = document.getElementById('cfg-module-subtitle');
  const badge = document.getElementById('cfg-module-badge');
  if (breadcrumb) breadcrumb.textContent = `${meta.groupLabel.toUpperCase()} · CENTRO ADMIN`;
  if (title) title.textContent = meta.label;
  if (subtitle) subtitle.textContent = meta.description;
  if (badge) badge.textContent = meta.badge;

  const activeUser = currentUserProfile?.nombre || currentUserProfile?.email || 'Sin sesión';
  const activePlaza = _miPlaza() || currentUserProfile?.plazaAsignada || 'GLOBAL';
  _cfgSetMetaChip('cfg-meta-user', 'person', `Usuario: ${activeUser}`);
  _cfgSetMetaChip('cfg-meta-plaza', 'location_city', `Plaza foco: ${activePlaza}`);
  _cfgSetMetaChip('cfg-meta-scope', 'verified_user', `Rol: ${_cfgRoleContextLabel()}`);
}

function _cfgSearchPlaceholderForTab(tabName = TAB_ACTIVA_CFG) {
  const map = {
    ubicaciones: 'Buscar ubicación o responsable...',
    estados: 'Buscar estado...',
    categorias: 'Buscar categoría...',
    modelos: 'Buscar modelo...',
    gasolinas: 'Buscar nivel de gasolina...'
  };
  return map[tabName] || 'Buscar catálogo...';
}

function _cfgRefreshSearchPlaceholder() {
  const input = document.getElementById('cfg-search-input');
  if (!input) return;
  input.placeholder = _cfgSearchPlaceholderForTab(TAB_ACTIVA_CFG);
}

function _cfgJumpTab(tabName = 'usuarios') {
  const btn = _cfgResolveTabButton(tabName);
  if (!btn || btn.style.display === 'none') return;
  abrirTabConfig(tabName, btn);
}

async function _cfgRefreshAdminHeroStats(force = false) {
  _cfgSetInsightValue('cfg-insight-plazas', (window.MEX_CONFIG?.empresa?.plazas || []).length);
  _cfgSetInsightValue('cfg-insight-catalogs', _cfgCatalogItemsTotal());

  if (_umUsers.length > 0) _cfgSetInsightValue('cfg-insight-users', _umUsers.length);
  else if (_cfgAdminStatsCache.users !== null) _cfgSetInsightValue('cfg-insight-users', _cfgAdminStatsCache.users);
  else _cfgSetInsightValue('cfg-insight-users', '--');

  if (_cfgAdminStatsCache.pending !== null) _cfgSetInsightValue('cfg-insight-pending', _cfgAdminStatsCache.pending);
  else _cfgSetInsightValue('cfg-insight-pending', '--');

  const now = Date.now();
  if (!force && (now - _cfgAdminStatsCache.stamp) < 25000) return;
  _cfgAdminStatsCache.stamp = now;

  const jobs = [];
  if ((canViewAdminUsers() || canUseProgrammerConfig()) && db?.collection) {
    jobs.push(
      db.collection(COL.USERS).get().then(snap => {
        _cfgAdminStatsCache.users = snap.size;
      }).catch(() => {})
    );
  }
  if (canViewAdminRequests() && db?.collection) {
    jobs.push(
      _obtenerSolicitudesPorEstado('PENDIENTE').then(solicitudes => {
        _cfgAdminStatsCache.pending = solicitudes.length;
      }).catch(() => {})
    );
  }

  if (jobs.length > 0) await Promise.allSettled(jobs);
  if (_cfgAdminStatsCache.users !== null) _cfgSetInsightValue('cfg-insight-users', _cfgAdminStatsCache.users);
  if (_cfgAdminStatsCache.pending !== null) _cfgSetInsightValue('cfg-insight-pending', _cfgAdminStatsCache.pending);
}

function _cfgRefreshQuickTools() {
  const tools = document.getElementById('cfg-v2-tools');
  if (!tools) return;

  const canManageAdvancedConfig = hasPermission('manage_system_settings') || canUseProgrammerConfig();
  const isCatalogTab = ['ubicaciones', 'estados', 'categorias', 'modelos', 'gasolinas'].includes(TAB_ACTIVA_CFG);
  const canPublishCurrentTab = TAB_ACTIVA_CFG === 'roles'
    ? (hasPermission('manage_roles_permissions') || canUseProgrammerConfig())
    : canManageAdvancedConfig;
  const matrix = {
    'new-user': canManageUsers(),
    'new-role': hasPermission('manage_roles_permissions') || canManageUsers(),
    'new-plaza': canManageAdvancedConfig,
    'new-item': isCatalogTab && canManageAdvancedConfig,
    'go-map': true,
    'open-programmer': canUseProgrammerConfig(),
    'publish': canPublishCurrentTab
  };

  tools.querySelectorAll('.cfg-v2-tool-btn[data-tool]').forEach(btn => {
    const key = btn.getAttribute('data-tool') || '';
    const enabled = matrix[key] !== false;
    btn.disabled = !enabled;
    if (key === 'open-programmer') btn.style.display = canUseProgrammerConfig() ? '' : 'none';
    if (key === 'new-user') btn.style.display = canManageUsers() ? '' : 'none';
    if (key === 'new-role') btn.style.display = (hasPermission('manage_roles_permissions') || canManageUsers()) ? '' : 'none';
    if (key === 'new-plaza') btn.style.display = canManageAdvancedConfig ? '' : 'none';
    if (key === 'new-item') btn.style.display = (isCatalogTab && canManageAdvancedConfig) ? '' : 'none';
    if (key === 'publish') btn.style.display = canPublishCurrentTab ? '' : 'none';
  });

  const lockBtn = document.getElementById('cfg-action-bloqueo-patio');
  if (lockBtn) lockBtn.style.display = canLockMap() ? '' : 'none';
}

async function _cfgQuickAction(action = '') {
  const mode = String(action || '').trim();
  if (!mode) return;
  if (mode === 'new-user') {
    if (!canManageUsers()) return showToast('No tienes permisos para crear usuarios.', 'error');
    _cfgJumpTab('usuarios');
    setTimeout(() => { if (typeof _umNuevoUsuarioConAnim === 'function') _umNuevoUsuarioConAnim(); }, 120);
    return;
  }
  if (mode === 'new-plaza') {
    const canManageAdvancedConfig = hasPermission('manage_system_settings') || canUseProgrammerConfig();
    if (!canManageAdvancedConfig) return showToast('No tienes permisos para crear plazas.', 'error');
    _cfgJumpTab('plazas');
    setTimeout(() => { if (typeof _abrirModalNuevaplaza === 'function') _abrirModalNuevaplaza(); }, 120);
    return;
  }
  if (mode === 'new-role') {
    if (!hasPermission('manage_roles_permissions') && !canManageUsers()) {
      return showToast('No tienes permisos para crear roles.', 'error');
    }
    _cfgJumpTab('roles');
    setTimeout(() => { if (typeof _cfgCrearRolDesdePanel === 'function') _cfgCrearRolDesdePanel(); }, 120);
    return;
  }
  if (mode === 'new-item') {
    const isCatalogTab = ['ubicaciones', 'estados', 'categorias', 'modelos', 'gasolinas'].includes(TAB_ACTIVA_CFG);
    if (!isCatalogTab) _cfgJumpTab('ubicaciones');
    setTimeout(() => abrirModalNuevaConfig(), 100);
    return;
  }
  if (mode === 'go-map') {
    cerrarPanelConfiguracion();
    return;
  }
  if (mode === 'toggle-lock') {
    await solicitarToggleBloqueo();
    return;
  }
  if (mode === 'open-programmer') {
    if (!canUseProgrammerConfig()) return showToast('No tienes permisos para abrir programador.', 'error');
    _abrirProgrammerConsoleRoute();
    return;
  }
  if (mode === 'publish') {
    await guardarConfiguracionEnFirebase();
    return;
  }
  if (mode === 'refresh') {
    await _cfgRefreshAdminHeroStats(true);
    if (typeof renderizarListaConfig === 'function') renderizarListaConfig();
  }
}

function _cfgModelImageValue(item) {
  if (!item || typeof item !== 'object') return '';
  return String(item.imagenURL || item.imagen || item.image || item.foto || '').trim();
}

function _cfgPreviewModeloImg(raw = '', prefix = 'cfg-add') {
  const wrap = document.getElementById(`${prefix}-modelo-preview`);
  const img = document.getElementById(`${prefix}-modelo-preview-img`);
  const label = document.getElementById(`${prefix}-modelo-preview-label`);
  const value = String(raw || '').trim();
  if (!wrap || !img) return;
  if (!value) {
    wrap.style.display = 'none';
    img.removeAttribute('src');
    return;
  }
  wrap.style.display = 'flex';
  img.src = value;
  if (label) label.textContent = 'Preview de imagen';
}

function _cfgReadFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

async function _cfgRemoveLightBackground(file) {
  const dataUrl = await _cfgReadFileAsDataUrl(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = dataUrl;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('No se pudo preparar la imagen.'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No se pudo preparar el editor de imagen.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = (r + g + b) / 3;
    const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
    if (brightness >= 242 && maxDiff <= 18) {
      data[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('No se pudo generar la imagen PNG.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

async function _cfgUploadModelImage(prefix = 'cfg-add') {
  const fileInput = document.getElementById(`${prefix}-modelo-file`);
  const urlInput = document.getElementById(`${prefix}-modelo-img`);
  const statusEl = document.getElementById(`${prefix}-modelo-upload-status`);
  const removeBg = document.getElementById(`${prefix}-modelo-remove-bg`)?.checked === true;
  const file = fileInput?.files?.[0];
  if (!file || !urlInput) return;

  if (typeof firebase === 'undefined' || typeof firebase.storage !== 'function') {
    showToast('Firebase Storage no está disponible para subir imágenes.', 'error');
    return;
  }

  try {
    if (statusEl) statusEl.textContent = removeBg ? 'Procesando fondo y subiendo...' : 'Subiendo imagen...';
    const sourceBlob = removeBg ? await _cfgRemoveLightBackground(file) : file;
    const ext = removeBg ? 'png' : ((_safeText(file.name).split('.').pop() || 'png').toLowerCase());
    const folder = `catalogo_modelos/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const ref = firebase.storage().ref(folder);
    const snapshot = await ref.put(sourceBlob, {
      contentType: removeBg ? 'image/png' : (file.type || 'image/png')
    });
    const url = await snapshot.ref.getDownloadURL();
    urlInput.value = url;
    _cfgPreviewModeloImg(url, prefix);
    if (statusEl) statusEl.textContent = removeBg ? 'PNG generado y cargado.' : 'Imagen cargada correctamente.';
    showToast('Imagen del modelo cargada.', 'success');
  } catch (error) {
    if (statusEl) statusEl.textContent = 'No se pudo procesar la imagen.';
    showToast(error?.message || 'No se pudo subir la imagen del modelo.', 'error');
  }
}

async function _copyTextToClipboard(value = '', label = 'Texto') {
  const text = String(value || '').trim();
  if (!text) {
    showToast(`No hay ${label.toLowerCase()} para copiar.`, 'error');
    return;
  }
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showToast(`${label} copiado.`, 'success');
  } catch (_) {
    showToast(`No se pudo copiar ${label.toLowerCase()}.`, 'error');
  }
}

function _copyPlazaCorreo(selectId, label = 'Correo') {
  const el = document.getElementById(selectId);
  const value = el ? el.value : '';
  _copyTextToClipboard(value, label);
}

function _programmerConsoleReadLog() {
  try {
    const raw = localStorage.getItem('programmer_console_log') || '[]';
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 50) : [];
  } catch {
    return [];
  }
}

function _programmerConsolePushLog(title, detail = '', kind = 'info') {
  const entry = {
    ts: Date.now(),
    title,
    detail,
    kind
  };
  _programmerConsoleState.log = [entry, ..._programmerConsoleReadLog()].slice(0, 50);
  localStorage.setItem('programmer_console_log', JSON.stringify(_programmerConsoleState.log));
  const view = document.getElementById('programmer-console-log');
  if (view) view.innerHTML = _programmerConsoleRenderLog();
}

function _programmerConsoleRenderLog() {
  const rows = _programmerConsoleState.log.length ? _programmerConsoleState.log : _programmerConsoleReadLog();
  return rows.map(item => `
    <div class="programmer-log-item">
      <div class="programmer-log-top">
        <span class="programmer-log-kind kind-${escapeHtml(item.kind || 'info')}">${escapeHtml(String(item.kind || 'info').toUpperCase())}</span>
        <span class="programmer-log-time">${new Date(item.ts).toLocaleString('es-MX')}</span>
      </div>
      <div class="programmer-log-title">${escapeHtml(item.title || '')}</div>
      ${item.detail ? `<div class="programmer-log-detail">${escapeHtml(item.detail)}</div>` : ''}
    </div>
  `).join('') || '<div style="color:#94a3b8; font-weight:700; text-align:center; padding:16px;">Sin acciones todavía.</div>';
}

function _programmerConsoleSetJsonDraft(obj) {
  _programmerConsoleState.jsonDraft = JSON.stringify(obj, null, 2);
  const ta = document.getElementById('programmer-json-editor');
  if (ta) ta.value = _programmerConsoleState.jsonDraft;
}

function _programmerConsoleLoadSelectedPlaza() {
  const plaza = (document.getElementById('programmer-plaza-select')?.value || '').trim().toUpperCase();
  _programmerConsoleState.selectedPlaza = plaza;
  const live = document.getElementById('programmer-plaza-preview');
  const summary = _programmerConsoleBuildPlazaSummary(plaza);
  if (live) live.innerHTML = summary;
}

function _programmerConsoleBuildPlazaSummary(plaza = '') {
  const selected = String(plaza || '').trim().toUpperCase();
  const empresa = window.MEX_CONFIG?.empresa || {};
  const plazasDetalle = Array.isArray(empresa.plazasDetalle) ? empresa.plazasDetalle : [];
  const plazaDetail = plazasDetalle.find(p => String(p.id || '').toUpperCase() === selected) || {};
  const settings = selected ? (window._programmerCache?.settings?.[selected] || null) : null;
  const estructura = selected ? (window._programmerCache?.estructura?.[selected] || []) : [];
  const correo = plazaDetail.correo || '—';
  const correoGerente = plazaDetail.correoGerente || '—';
  return `
    <div class="programmer-summary-grid">
      <div><span>Plaza</span><strong>${escapeHtml(selected || 'GLOBAL')}</strong></div>
      <div><span>Correo</span><strong>${escapeHtml(correo)}</strong></div>
      <div><span>Gerencia</span><strong>${escapeHtml(correoGerente)}</strong></div>
      <div><span>Ubicaciones</span><strong>${escapeHtml(String((window.MEX_CONFIG?.plazas?.[selected]?.length || 0)))}</strong></div>
      <div><span>Estructura</span><strong>${escapeHtml(String(estructura.length || 0))}</strong></div>
      <div><span>Bloqueo</span><strong>${settings?.mapaBloqueado ? 'ACTIVO' : 'LIBRE'}</strong></div>
    </div>
  `;
}

function _programmerConsoleRefreshCaches() {
  _programmerConsolePushLog('Cache bump local', 'Forzando re-render y limpieza de datos temporales', 'info');
  if (typeof limpiarBusqueda === 'function') limpiarBusqueda(false);
  if (typeof renderizarListaConfig === 'function') renderizarListaConfig();
}

async function _programmerConsoleLoadData() {
  const plazas = (window.MEX_CONFIG?.empresa?.plazasDetalle || []).map(p => String(p.id || '').trim().toUpperCase()).filter(Boolean);
  window._programmerCache = window._programmerCache || { settings: {}, estructura: {}, unidades: {} };
  const selectedPlaza = _programmerConsoleState.selectedPlaza || _miPlaza();
  const targetPlazas = [...new Set([selectedPlaza, ...plazas].filter(Boolean))];
  const out = [];
  for (const plaza of targetPlazas) {
    try {
      const [settingsSnap, estructuraSnap] = await Promise.all([
        db.collection('settings').doc(plaza).get(),
        db.collection('mapa_config').doc(plaza).collection('estructura').get()
      ]);
      window._programmerCache.settings[plaza] = settingsSnap.exists ? (settingsSnap.data() || {}) : {};
      window._programmerCache.estructura[plaza] = estructuraSnap.docs.map(d => d.data());
      out.push(`${plaza}: ${window._programmerCache.estructura[plaza].length} piezas`);
    } catch (error) {
      out.push(`${plaza}: error`);
      console.warn(error);
    }
  }
  _programmerConsolePushLog('Inspección de plazas', out.join(' | '), 'success');
  _programmerConsoleLoadSelectedPlaza();
}

async function _programmerConsoleSaveJsonDraft() {
  const area = document.getElementById('programmer-json-editor');
  if (!area) return;
  try {
    _programmerConsoleState.jsonDraft = area.value;
    const payload = JSON.parse(area.value);
    const plaza = _programmerConsoleState.selectedPlaza || _miPlaza() || 'GLOBAL';
    await db.collection('settings').doc(plaza).set(payload, { merge: true });
    _programmerConsolePushLog('JSON guardado', `settings/${plaza}`, 'success');
    showToast(`JSON aplicado en ${plaza}`, 'success');
  } catch (error) {
    _programmerConsolePushLog('JSON inválido', error.message, 'error');
    showToast('JSON inválido: ' + error.message, 'error');
  }
}

async function _programmerConsoleExportConfig() {
  const payload = {
    empresa: window.MEX_CONFIG?.empresa || {},
    listas: window.MEX_CONFIG?.listas || {},
    ts: new Date().toISOString()
  };
  descargarArchivoLocal(`configuracion_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
  _programmerConsolePushLog('Exportación', 'Se generó un JSON de configuración global', 'success');
}

function _programmerConsoleRender() {
  _programmerConsoleState.log = _programmerConsoleReadLog();
  const plazas = (window.MEX_CONFIG?.empresa?.plazasDetalle || []).map(p => String(p.id || '').trim().toUpperCase()).filter(Boolean);
  const options = plazas.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  const selected = _programmerConsoleState.selectedPlaza || _miPlaza() || plazas[0] || '';
  _programmerConsoleState.selectedPlaza = selected;
  return `
    <div class="programmer-console-shell">
      <div class="programmer-console-hero">
        <div>
          <div class="programmer-console-kicker">Centro de Control</div>
          <h3>Control total de la plataforma</h3>
          <p>Consultas, migraciones, reindexado, validación y edición global con seguridad y trazabilidad.</p>
        </div>
        <div class="programmer-console-actions">
          <button type="button" onclick="_abrirProgrammerConsoleRoute()">Abrir consola completa</button>
          <button type="button" onclick="ejecutarMigracionLegacy()">Migrar legacy</button>
          <button type="button" onclick="_programmerConsoleLoadData()">Inspeccionar plazas</button>
          <button type="button" onclick="_programmerConsoleRefreshCaches()">Refrescar UI</button>
          <button type="button" onclick="_programmerConsoleExportConfig()">Exportar config</button>
        </div>
      </div>
      <div class="programmer-console-grid">
        <section class="programmer-console-card">
          <div class="programmer-console-card-head">
            <h4>Acciones rápidas</h4>
            <span>Dry-run mentalmente seguro</span>
          </div>
          <div class="programmer-console-actions-list">
            <button type="button" onclick="_programmerConsolePushLog('Validación', 'Chequeo manual de plazas y settings', 'info'); _programmerConsoleLoadData();">Validar plazas</button>
            <button type="button" onclick="_programmerConsolePushLog('Reindex', 'Reindexación lógica manual pendiente de backend', 'warning')">Reindexar</button>
            <button type="button" onclick="_programmerConsolePushLog('Backfill', 'Usa el bloque de migración legacy o agrega tu flujo', 'warning')">Backfill</button>
            <button type="button" onclick="_programmerConsolePushLog('Logs', 'Consulta de logs preparada', 'info')">Auditar logs</button>
          </div>
        </section>
        <section class="programmer-console-card">
          <div class="programmer-console-card-head">
            <h4>Inspección por plaza</h4>
            <span>settings / estructura / correo</span>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:12px;">
            <select id="programmer-plaza-select" class="cfg-add-select" onchange="_programmerConsoleLoadSelectedPlaza()" style="flex:1; min-width:180px;">
              <option value="">GLOBAL</option>
              ${options}
            </select>
            <button type="button" onclick="_programmerConsoleLoadData()">Cargar</button>
          </div>
          <div id="programmer-plaza-preview">${_programmerConsoleBuildPlazaSummary(selected)}</div>
        </section>
        <section class="programmer-console-card programmer-console-json">
          <div class="programmer-console-card-head">
            <h4>Editor JSON</h4>
            <span>merge directo sobre settings/{plaza}</span>
          </div>
          <textarea id="programmer-json-editor"></textarea>
          <div class="programmer-console-json-actions">
            <button type="button" onclick="_programmerConsoleSetJsonDraft(window.MEX_CONFIG?.empresa || {})">Cargar empresa</button>
            <button type="button" onclick="_programmerConsoleSaveJsonDraft()">Guardar JSON</button>
          </div>
        </section>
        <section class="programmer-console-card programmer-console-log-card">
          <div class="programmer-console-card-head">
            <h4>Historial</h4>
            <span>últimas acciones</span>
          </div>
          <div id="programmer-console-log" class="programmer-console-log">
            ${_programmerConsoleRenderLog()}
          </div>
        </section>
      </div>
    </div>
  `;
}

let _cfgSecuritySelectedRole = 'GERENTE_PLAZA';

function _cfgSecurityRoleKey(raw = '') {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || '';
}

function _cfgEnsureRoleSelection() {
  _ensureSecurityConfig();
  if (!ROLE_META[_cfgSecuritySelectedRole]) {
    _cfgSecuritySelectedRole = ROLE_OPTIONS.includes('GERENTE_PLAZA') ? 'GERENTE_PLAZA' : (ROLE_OPTIONS[0] || 'AUXILIAR');
  }
  return _cfgSecuritySelectedRole;
}

function _cfgRoleTemplate(role) {
  _ensureSecurityConfig();
  return window.MEX_CONFIG.empresa.security.roles[role] || {};
}

function _cfgUpsertRole(role, patch = {}) {
  const roleKey = _cfgSecurityRoleKey(role);
  if (!roleKey) return;
  const security = _ensureSecurityConfig();
  const base = security.roles[roleKey] || {
    label: roleKey,
    level: 10,
    isAdmin: false,
    fullAccess: false,
    needsPlaza: true,
    multiPlaza: false,
    permissions: {}
  };
  security.roles[roleKey] = {
    ...base,
    ...patch,
    permissions: {
      ...(base.permissions || {}),
      ...(patch.permissions || {})
    }
  };
  _refreshSecurityRoleCatalog();
}

function _cfgRenderRolesTab(container) {
  _cfgEnsureRoleSelection();
  const selectedRole = _cfgSecuritySelectedRole;
  const selectedMeta = _roleMeta(selectedRole);
  const selectedTemplate = _cfgRoleTemplate(selectedRole);
  const canEditRoles = hasPermission('manage_roles_permissions') || canManageUsers() || canUseProgrammerConfig();
  const disabledAttr = canEditRoles ? '' : 'disabled';
  const permissionEntries = _permissionEntries();
  const permissionGroups = permissionEntries.reduce((acc, item) => {
    acc[item.group] = acc[item.group] || [];
    acc[item.group].push(item);
    return acc;
  }, {});
  const isSystem = _isSystemRole(selectedRole);
  const scopeLabel = selectedMeta.fullAccess
    ? 'Global'
    : (selectedMeta.multiPlaza ? 'Multi-plaza' : (selectedMeta.needsPlaza ? 'Por plaza' : 'Libre'));
  const accessLabel = selectedMeta.fullAccess
    ? 'Acceso total'
    : (selectedMeta.isAdmin ? 'Administrativo' : 'Operativo');

  container.innerHTML = `
    <div class="cfg-security-shell">
      <aside class="cfg-security-sidebar-panel">
        <div class="cfg-security-panel-head">
          <div>
            <strong>Roles activos</strong>
            <small>${ROLE_OPTIONS.length} perfiles configurados</small>
          </div>
          <button type="button" class="cfg-security-mini-btn" onclick="_cfgCrearRolDesdePanel()" ${disabledAttr} style="${canEditRoles ? '' : 'display:none;'}">
            <span class="material-icons">add</span> Nuevo rol
          </button>
        </div>
        <div class="cfg-security-role-list">
          ${ROLE_OPTIONS.map(role => {
            const meta = _roleMeta(role);
            const active = role === selectedRole ? 'active' : '';
            return `
              <button type="button" class="cfg-security-role-pill ${active}" onclick="_cfgSeleccionarRol('${role}')">
                <div>
                  <strong>${escapeHtml(meta.label)}</strong>
                  <small>${escapeHtml(role)} · Nivel ${meta.level}</small>
                </div>
                <span>${meta.fullAccess ? 'FULL' : (meta.canUseProgrammerConfig ? 'PRO' : (meta.canEditAdminCuadre ? 'OPS' : 'BASE'))}</span>
              </button>
            `;
          }).join('')}
        </div>
      </aside>

      <section class="cfg-security-main-panel">
        <div class="cfg-security-panel-head">
          <div>
            <strong>${escapeHtml(selectedMeta.label)}</strong>
            <small>${escapeHtml(selectedRole)} · ${isSystem ? 'Rol base del sistema' : 'Rol personalizado'}</small>
          </div>
          <div class="cfg-security-head-actions">
            ${(!isSystem && canEditRoles) ? `
              <button type="button" class="cfg-security-mini-btn danger" onclick="_cfgEliminarRolSeleccionado()">
                <span class="material-icons">delete</span> Eliminar
              </button>
            ` : ''}
          </div>
        </div>

        <div class="cfg-security-role-insights">
          <div class="cfg-security-insight-chip">
            <span>Alcance</span>
            <strong>${escapeHtml(scopeLabel)}</strong>
          </div>
          <div class="cfg-security-insight-chip">
            <span>Nivel</span>
            <strong>${escapeHtml(String(selectedTemplate.level ?? selectedMeta.level ?? 10))}</strong>
          </div>
          <div class="cfg-security-insight-chip">
            <span>Modo</span>
            <strong>${escapeHtml(accessLabel)}</strong>
          </div>
          <div class="cfg-security-insight-chip">
            <span>Permisos</span>
            <strong>${escapeHtml(String(permissionEntries.length))} activos</strong>
          </div>
        </div>

        ${canEditRoles ? '' : `
          <div class="cfg-security-compact-note">
            Estás viendo esta vista en modo solo lectura. Para editar roles o permisos necesitas un permiso explícito de gestión.
          </div>
        `}

        <div class="cfg-security-main-scroll">
          <div class="cfg-security-role-form">
            <label>
              <span>Nombre visible</span>
              <input type="text" value="${escapeHtml(selectedTemplate.label || selectedMeta.label)}" onchange="_cfgActualizarRolCampo('${selectedRole}','label', this.value)" ${disabledAttr}>
            </label>
            <label>
              <span>Nivel</span>
              <input type="number" min="1" max="99" value="${escapeHtml(String(selectedTemplate.level ?? selectedMeta.level ?? 10))}" onchange="_cfgActualizarRolCampo('${selectedRole}','level', this.value)" ${disabledAttr}>
            </label>
            <label class="cfg-security-check">
              <input type="checkbox" ${selectedMeta.isAdmin ? 'checked' : ''} onchange="_cfgActualizarRolBoolean('${selectedRole}','isAdmin', this.checked)" ${disabledAttr}>
              <span>Es admin</span>
            </label>
            <label class="cfg-security-check">
              <input type="checkbox" ${selectedMeta.needsPlaza ? 'checked' : ''} onchange="_cfgActualizarRolBoolean('${selectedRole}','needsPlaza', this.checked)" ${disabledAttr}>
              <span>Requiere plaza base</span>
            </label>
            <label class="cfg-security-check">
              <input type="checkbox" ${selectedMeta.multiPlaza ? 'checked' : ''} onchange="_cfgActualizarRolBoolean('${selectedRole}','multiPlaza', this.checked)" ${disabledAttr}>
              <span>Puede ver varias plazas</span>
            </label>
            <label class="cfg-security-check">
              <input type="checkbox" ${selectedMeta.fullAccess ? 'checked' : ''} onchange="_cfgActualizarRolBoolean('${selectedRole}','fullAccess', this.checked)" ${disabledAttr}>
              <span>Acceso total</span>
            </label>
          </div>

          <div class="cfg-security-compact-note">
            Ajusta el rol aquí y deja el catálogo avanzado cerrado salvo que realmente necesites cambiar etiquetas o descripciones del panel.
          </div>

          <div class="cfg-security-permission-matrix">
            ${Object.entries(permissionGroups).map(([group, items]) => `
              <section class="cfg-security-matrix-group">
                <div class="cfg-security-matrix-group-title">${escapeHtml(group)}</div>
                ${items.map(item => `
                  <label class="cfg-security-matrix-item">
                    <div>
                      <strong>${escapeHtml(item.label)}</strong>
                      <small>${escapeHtml(item.description)}</small>
                    </div>
                    <input type="checkbox" ${selectedMeta.permissions?.[item.key] ? 'checked' : ''} ${(selectedMeta.fullAccess || !canEditRoles) ? 'disabled' : ''} onchange="_cfgToggleRolPermiso('${selectedRole}','${item.key}', this.checked)">
                  </label>
                `).join('')}
              </section>
            `).join('')}
          </div>

          <details class="cfg-security-permission-library">
            <summary>
              <div>
                <strong>Catálogo de permisos</strong>
                <small>Editar solo cuando cambie el lenguaje del panel o la taxonomía interna.</small>
              </div>
              <span class="material-icons">expand_more</span>
            </summary>
            <div class="cfg-security-permission-editor">
              ${permissionEntries.map(item => `
                <div class="cfg-security-catalog-item">
                  <div class="cfg-security-catalog-key">${escapeHtml(item.key)}</div>
                  <input type="text" value="${escapeHtml(item.label)}" onchange="_cfgActualizarPermisoMeta('${item.key}','label', this.value)" ${disabledAttr}>
                  <input type="text" value="${escapeHtml(item.description)}" onchange="_cfgActualizarPermisoMeta('${item.key}','description', this.value)" ${disabledAttr}>
                </div>
              `).join('')}
            </div>
          </details>
        </div>
      </section>
    </div>
  `;
}

function _cfgSeleccionarRol(role) {
  _cfgSecuritySelectedRole = _cfgSecurityRoleKey(role) || _cfgSecuritySelectedRole;
  renderizarListaConfig();
}

async function _cfgActualizarRolCampo(role, field, value) {
  const roleKey = _cfgSecurityRoleKey(role);
  if (!roleKey) return;
  const normalizedValue = field === 'level' ? Math.max(1, Math.min(99, Number(value) || 1)) : String(value || '').trim();
  _cfgUpsertRole(roleKey, { [field]: normalizedValue });
  await _persistSecurityAdminAction(
    'ROL_ACTUALIZADO',
    `Actualizó el campo ${field} del rol ${roleKey}`,
    'Rol actualizado.',
    { referencia: roleKey, campo: field }
  );
}

async function _cfgActualizarRolBoolean(role, field, value) {
  const roleKey = _cfgSecurityRoleKey(role);
  if (!roleKey) return;
  _cfgUpsertRole(roleKey, { [field]: Boolean(value) });
  renderizarListaConfig();
  await _persistSecurityAdminAction(
    'ROL_ACTUALIZADO',
    `Actualizó el indicador ${field} del rol ${roleKey}`,
    'Rol actualizado.',
    { referencia: roleKey, campo: field }
  );
}

async function _cfgToggleRolPermiso(role, permissionKey, enabled) {
  const roleKey = _cfgSecurityRoleKey(role);
  if (!roleKey) return;
  _cfgUpsertRole(roleKey, {
    permissions: {
      ...(ROLE_META[roleKey]?.permissions || {}),
      [permissionKey]: Boolean(enabled)
    }
  });
  await _persistSecurityAdminAction(
    'ROL_PERMISO_ACTUALIZADO',
    `Actualizó el permiso ${permissionKey} del rol ${roleKey}`,
    'Permiso del rol actualizado.',
    { referencia: roleKey, permiso: permissionKey, habilitado: Boolean(enabled) }
  );
}

async function _cfgActualizarPermisoMeta(permissionKey, field, value) {
  const security = _ensureSecurityConfig();
  security.permissionsCatalog[permissionKey] = security.permissionsCatalog[permissionKey] || {};
  security.permissionsCatalog[permissionKey][field] = String(value || '').trim();
  _refreshSecurityRoleCatalog();
  await _persistSecurityAdminAction(
    'CATALOGO_PERMISOS_ACTUALIZADO',
    `Actualizó el catálogo del permiso ${permissionKey}`,
    'Catálogo de permisos actualizado.',
    { referencia: permissionKey, campo: field }
  );
}

async function _cfgCrearRolDesdePanel() {
  if (!hasPermission('manage_roles_permissions')) {
    showToast('Tu rol no puede crear roles nuevos.', 'error');
    return;
  }
  const sourceRole = _cfgEnsureRoleSelection();
  const label = await mexPrompt(
    'Crear nuevo rol',
    `Escribe el nombre visible del nuevo rol. Se copiará la base de ${_roleMeta(sourceRole).label}.`,
    ''
  );
  if (label === null) return;
  const roleKey = _cfgSecurityRoleKey(label);
  if (!roleKey) return showToast('Escribe un nombre válido para el rol.', 'error');
  if (ROLE_META[roleKey]) return showToast(`El rol ${roleKey} ya existe.`, 'error');

  const sourceMeta = _roleMeta(sourceRole);
  _cfgUpsertRole(roleKey, {
    label: String(label || roleKey).trim() || roleKey,
    level: sourceMeta.level,
    isAdmin: sourceMeta.isAdmin,
    fullAccess: sourceMeta.fullAccess,
    needsPlaza: sourceMeta.needsPlaza,
    multiPlaza: sourceMeta.multiPlaza,
    permissions: { ...(sourceMeta.permissions || {}) }
  });
  _cfgSecuritySelectedRole = roleKey;
  renderizarListaConfig();
  await _persistSecurityAdminAction(
    'ROL_CREADO',
    `Creó el rol ${roleKey}`,
    `Rol ${roleKey} creado.`,
    { referencia: roleKey }
  );
}

async function _cfgEliminarRolSeleccionado() {
  const roleKey = _cfgEnsureRoleSelection();
  if (_isSystemRole(roleKey)) {
    showToast('Los roles base del sistema no se pueden eliminar.', 'error');
    return;
  }
  const ok = await mexConfirm(
    'Eliminar rol',
    `Se eliminará el rol ${roleKey}. Los usuarios que lo usen deberán reasignarse manualmente. ¿Continuar?`,
    'warning'
  );
  if (!ok) return;
  const security = _ensureSecurityConfig();
  delete security.roles[roleKey];
  _refreshSecurityRoleCatalog();
  _cfgSecuritySelectedRole = 'GERENTE_PLAZA';
  renderizarListaConfig();
  await _persistSecurityAdminAction(
    'ROL_ELIMINADO',
    `Eliminó el rol ${roleKey}`,
    `Rol ${roleKey} eliminado.`,
    { referencia: roleKey }
  );
}

function _applyGestionAdminChrome() {
  if (!_isGestionAdminMode()) return;
  document.documentElement.classList.add('gestion-admin-route');
  document.body?.classList.add('gestion-admin-route');
  const modal = document.getElementById('modal-config-global');
  if (modal) modal.classList.add('active');
  const footer = document.querySelector('.cfg-v2-footer');
  if (footer) footer.style.display = 'none';
  const closeBtn = document.querySelector('.cfg-v2-close');
  if (closeBtn) closeBtn.title = 'Volver al mapa';
}

async function _bootGestionAdminRoute() {
  if (!_isGestionAdminMode() || _gestionAdminBooted) return;
  _gestionAdminBooted = true;
  _applyGestionAdminChrome();
  abrirPanelConfiguracion(_gestionInitialTab());
  await _captureAdminExactLocation({ force: true });
}

let _messagesBooted = false;
function _mountMessagesShell() {
  if (!_isMessagesMode()) return;
  const buzon = document.getElementById('buzon-modal');
  if (!buzon) return;
  const currentPlaza = _normalizePlaza(
    typeof window.getMexCurrentPlaza === 'function'
      ? window.getMexCurrentPlaza()
      : (PLAZA_ACTIVA_MAPA || currentUserProfile?.plazaAsignada || '')
  );
  ensureRouteShellLayout({
    appRoot: buzon,
    layoutId: 'messagesShellLayout',
    sidebarHostId: 'messagesSidebarHost',
    topbarHostId: 'messagesTopbarHost',
    mainId: 'messagesMainStage',
    currentRoute: '/mensajes',
    profile: currentUserProfile || {},
    config: window.MEX_CONFIG || {},
    currentPlaza,
    metrics: {
      focus: currentPlaza,
      incidenciasAbiertas: Array.isArray(filaAlertasPendientes) ? filaAlertasPendientes.length : 0
    },
    mainClass: 'overflow-hidden h-screen pb-0 bg-slate-50',
    searchId: 'messagesRouteSearchInput',
    plazaSelectId: 'messagesRoutePlazaSelect',
    searchPlaceholder: 'Buscar unidad, ruta o conversación...',
    onSearch: (query) => {
      const targetPlaza = _normalizePlaza(currentPlaza || PLAZA_ACTIVA_MAPA);
      if (targetPlaza) _rememberActivePlaza(targetPlaza);
      if (typeof window.setMexCurrentPlaza === 'function' && targetPlaza) {
        window.setMexCurrentPlaza(targetPlaza);
      }
      queueShellSearch(query, targetPlaza);
      window.location.href = '/mapa';
    }
  });
  _syncMapShellHeader();
}

function _bootMessagesRoute() {
  if (!_isMessagesMode() || _messagesBooted) return;
  _messagesBooted = true;
  document.body.classList.add('messages-mode');
  _mountMessagesShell();
  abrirBuzon();
}

function _bootCuadreFleetRoute() {
  if (!_isCuadreFleetMode() || _cuadreFleetBooted) return;
  _cuadreFleetBooted = true;
  abrirModalFlota(_cuadreInitialTab());
}

function abrirPanelConfiguracion(tabInicial) {
  console.log('[DEBUG] abrirPanelConfiguracion', { tabInicial, role: userAccessRole, canOpen: canOpenAdminPanel(), profile: !!currentUserProfile });
  if (!canOpenAdminPanel()) {
    console.warn('[DEBUG] canOpenAdminPanel=false, rol:', userAccessRole);
    showToast("Tu rol no puede abrir el panel administrativo.", "error");
    return;
  }
  const targetTab = _cfgResolveAllowedTab(tabInicial || 'usuarios');
  if (!targetTab) {
    showToast("No tienes vistas visibles dentro del panel administrativo.", "error");
    return;
  }
  // Si estamos en el mapa principal (no en /gestion ni en iframe ?admin=1), navegar a /gestion
  if (!_isGestionAdminMode() && !_isDedicatedGestionIframeMode()) {
    window.location.href = _buildGestionRouteUrl(targetTab);
    return;
  }
  const visibilityMap = {
    usuarios: canViewAdminUsers(),
    roles: canViewAdminRoles(),
    solicitudes: canViewAdminRequests(),
    estados: canViewAdminOperationCatalogs(),
    categorias: canViewAdminOperationCatalogs(),
    modelos: canViewAdminOperationCatalogs(),
    gasolinas: canViewAdminOperationCatalogs(),
    plazas: canViewAdminStructure(),
    ubicaciones: canViewAdminStructure(),
    empresa: canViewAdminOrganization(),
    programador: canViewAdminProgrammer()
  };
  Object.entries(visibilityMap).forEach(([tab, visible]) => {
    const button = document.getElementById(`cfg-tab-${tab}`) || document.querySelector(`.cfg-tab[onclick*="'${tab}'"]`);
    if (button) button.style.display = visible ? 'inline-flex' : 'none';
  });
  _cfgRefreshSidebarSections();
  if (typeof toggleAdminSidebar === 'function') toggleAdminSidebar(false);
  _applyGestionAdminChrome();
  const _cfgModal = document.getElementById('modal-config-global');
  console.log('[DEBUG] modal-config-global:', _cfgModal, 'gestionMode:', _isGestionAdminMode(), 'pathname:', window.location.pathname);
  if (!_cfgModal) { console.error('[DEBUG] modal-config-global NO ENCONTRADO en DOM'); return; }
  _cfgModal.classList.add('active');
  console.log('[DEBUG] modal-config-global classList after add:', _cfgModal.classList.toString(), 'display:', getComputedStyle(_cfgModal).display);
  // Extra debug: verify dimensions and z-index after repaint
  requestAnimationFrame(() => {
    const r = _cfgModal.getBoundingClientRect();
    const cs = getComputedStyle(_cfgModal);
    console.log('[DEBUG] modal-config-global rect (after paint):', JSON.stringify({ top: r.top, left: r.left, width: r.width, height: r.height }), 'z-index:', cs.zIndex, 'visibility:', cs.visibility, 'opacity:', cs.opacity, 'bg:', cs.backgroundColor);
  });
  _cfgApplySidebarPinState();
  _captureAdminExactLocation({ force: false }).catch(() => {});
  _cfgRefreshSearchPlaceholder();
  _cfgUpdateWorkspaceHeader(targetTab);
  _cfgRefreshQuickTools();
  _cfgRefreshAdminHeroStats(true).catch(() => {});
  const targetButton = document.getElementById(`cfg-tab-${targetTab}`) || document.querySelector(`.cfg-tab[onclick*="'${targetTab}'"]`);
  if (targetTab) {
    const fallbackTab = _cfgResolveAllowedTab(targetTab);
    const fallbackButton = _cfgResolveTabButton(fallbackTab);
    if (targetButton && targetButton.style.display !== 'none') abrirTabConfig(targetTab, targetButton);
    else if (fallbackTab && fallbackButton) abrirTabConfig(fallbackTab, fallbackButton);
    else renderizarListaConfig();
  } else {
    renderizarListaConfig();
  }
}

function abrirTabConfig(tabName, btnElement) {
  const normalizedTab = _cfgResolveAllowedTab(tabName);
  if (!normalizedTab) {
    showToast("No tienes acceso a esa vista administrativa.", "error");
    return;
  }
  if (normalizedTab === 'programador') {
    _abrirProgrammerConsoleRoute();
    return;
  }
  if (_isGestionAdminMode() && !_isDedicatedGestionIframeMode()) {
    _syncInlineAdminRoute(normalizedTab);
  }
  // Si estábamos en el tab de usuarios, desuscribir el listener
  if (TAB_ACTIVA_CFG === 'usuarios' && _unsubUsuarios) {
    _unsubUsuarios(); _unsubUsuarios = null;
    _umUsers = []; _umSelectedId = null;
  }

  if (!btnElement) {
    btnElement = document.getElementById(`cfg-tab-${normalizedTab}`) || document.querySelector(`.cfg-tab[onclick*="'${normalizedTab}'"]`);
  }
  document.querySelectorAll('.cfg-tab').forEach(btn => btn.classList.remove('active'));
  btnElement?.classList.add('active');
  const previousTab = TAB_ACTIVA_CFG;
  TAB_ACTIVA_CFG = normalizedTab.replace('cfg-', '');
  if (previousTab !== TAB_ACTIVA_CFG) {
    _cfgCatalogSelectedIndex = null;
    _cfgCatalogEditIndex = null;
  }

  const searchBox = document.querySelector('.cfg-v2-add-bar');
  const tabsSinBarra = ['empresa', 'usuarios', 'roles', 'solicitudes', 'plazas'];
  if (tabsSinBarra.includes(TAB_ACTIVA_CFG)) {
    if (searchBox) searchBox.style.display = 'none';
  } else {
    if (searchBox) searchBox.style.display = 'flex';
  }
  _cfgRefreshSearchPlaceholder();
  _cfgSyncNavState(TAB_ACTIVA_CFG);
  _cfgUpdateWorkspaceHeader(TAB_ACTIVA_CFG);
  const progTab = document.getElementById('cfg-tab-programador');
  if (progTab) progTab.style.display = canUseProgrammerConfig() ? 'inline-flex' : 'none';

  // Remove any existing extra filter bars
  ['cfg-ubi-plaza-filter-wrap', 'cfg-modelo-cat-filter-wrap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  // Plaza filter for ubicaciones
  if (TAB_ACTIVA_CFG === 'ubicaciones' && searchBox) {
    const plazas = (window.MEX_CONFIG?.empresa?.plazas || []);
    if (plazas.length > 0) {
      const wrap = document.createElement('div');
      wrap.id = 'cfg-ubi-plaza-filter-wrap';
      wrap.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:8px;';
      wrap.innerHTML = `
            <span class="material-icons" style="font-size:16px; color:#94a3b8;">location_city</span>
            <select id="cfg-ubi-plaza-filter" onchange="renderizarListaConfig()"
              style="padding:7px 10px; border-radius:8px; border:1.5px solid #e2e8f0; font-size:12px; font-weight:700; outline:none; background:white; color:#334155; cursor:pointer;">
              <option value="">Todas las plazas</option>
              ${plazas.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')}
            </select>
          `;
      searchBox.parentNode.insertBefore(wrap, searchBox);
    }
  }

  // Category filter for modelos
  if (TAB_ACTIVA_CFG === 'modelos' && searchBox) {
    const cats = (window.MEX_CONFIG?.listas?.categorias || []);
    if (cats.length > 0) {
      const wrap = document.createElement('div');
      wrap.id = 'cfg-modelo-cat-filter-wrap';
      wrap.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:8px;';
      const catOpts = cats.map(c => {
        const n = typeof c === 'object' ? (c.nombre || c.id) : c;
        return `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`;
      }).join('');
      wrap.innerHTML = `
            <span class="material-icons" style="font-size:16px; color:#94a3b8;">category</span>
            <select id="cfg-modelo-cat-filter" onchange="renderizarListaConfig()"
              style="padding:7px 10px; border-radius:8px; border:1.5px solid #e2e8f0; font-size:12px; font-weight:700; outline:none; background:white; color:#334155; cursor:pointer;">
              <option value="">Todas las categorías</option>
              ${catOpts}
            </select>
          `;
      searchBox.parentNode.insertBefore(wrap, searchBox);
    }
  }

  _cfgRefreshQuickTools();
  _cfgRefreshAdminHeroStats(false).catch(() => {});
  renderizarListaConfig();
}

function _cfgIsCatalogDetailTab(tabName = TAB_ACTIVA_CFG) {
  return ['ubicaciones', 'estados', 'categorias', 'modelos', 'gasolinas'].includes(String(tabName || '').trim().toLowerCase());
}

function _cfgSelectCatalogItem(index) {
  if (_cfgCatalogEditIndex !== null && Number(index) !== Number(_cfgCatalogEditIndex)) {
    _cfgCatalogEditIndex = null;
  }
  _cfgCatalogSelectedIndex = Number(index);
  renderizarListaConfig();
}

function _cfgCatalogIcon(tabName = TAB_ACTIVA_CFG) {
  const map = {
    ubicaciones: 'place',
    estados: 'tune',
    categorias: 'directions_car',
    modelos: 'no_crash',
    gasolinas: 'local_gas_station'
  };
  return map[String(tabName || '').trim().toLowerCase()] || 'list_alt';
}

function _cfgCatalogPrimaryLabel(tabName, item) {
  return _cfgCatalogDisplayValue(tabName, item) || 'Sin selección';
}

function _cfgCatalogRelatedModels(tabName, item) {
  if (String(tabName || '').trim().toLowerCase() !== 'categorias') return [];
  const title = _cfgCatalogPrimaryLabel(tabName, item);
  return (window.MEX_CONFIG?.listas?.modelos || []).filter(model => {
    const category = typeof model === 'object' ? String(model.categoria || '').trim() : '';
    return category === title;
  });
}

function _cfgCatalogPlazaOptions(selected = 'ALL') {
  const normalized = String(selected || 'ALL').trim().toUpperCase() || 'ALL';
  const plazas = window.MEX_CONFIG?.empresa?.plazas || [];
  return `
    <option value="ALL"${normalized === 'ALL' ? ' selected' : ''}>ALL · Todas las plazas</option>
    ${plazas.map(plaza => {
      const value = String(plaza || '').trim().toUpperCase();
      return `<option value="${escapeHtml(value)}"${value === normalized ? ' selected' : ''}>${escapeHtml(value)}</option>`;
    }).join('')}
  `;
}

function _cfgCatalogCategoryOptions(selected = '') {
  const normalized = String(selected || '').trim().toUpperCase();
  const categories = window.MEX_CONFIG?.listas?.categorias || [];
  return `
    <option value="">Sin categoría</option>
    ${categories.map(category => {
      const value = String(typeof category === 'object' ? (category.nombre || category.id) : category).trim().toUpperCase();
      return `<option value="${escapeHtml(value)}"${value === normalized ? ' selected' : ''}>${escapeHtml(value)}</option>`;
    }).join('')}
  `;
}

function _cfgCatalogInlineEditorHtml(tabName, item, index) {
  const title = _cfgCatalogPrimaryLabel(tabName, item);
  const description = _cfgCatalogDescriptionValue(tabName, item);
  const orderValue = _cfgCatalogOrderValue(item, index);
  const itemType = typeof item === 'object' ? item : {};
  const relatedModels = _cfgCatalogRelatedModels(tabName, item);

  if (tabName === 'ubicaciones') {
    const isFixed = typeof item === 'object'
      ? item.isPlazaFija === true
      : ['PATIO', 'TALLER', 'AGENCIA', 'TALLER EXTERNO', 'HYP COBIAN'].includes(title);
    const plazaId = typeof item === 'object' ? (item.plazaId || 'ALL') : 'ALL';
    return `
      <div class="cfg-detail-form">
        <div class="cfg-detail-field">
          <label>Nombre visible</label>
          <input id="cfg-inline-name" type="text" value="${escapeHtml(title)}" placeholder="Ej: PATIO">
        </div>
        <div class="cfg-detail-grid-two">
          <label class="cfg-detail-toggle">
            <input id="cfg-inline-is-plaza" type="checkbox" ${isFixed ? 'checked' : ''}>
            <span>Es plaza fija</span>
          </label>
          <div class="cfg-detail-field">
            <label>Orden</label>
            <input id="cfg-inline-order" type="number" value="${escapeHtml(String(orderValue))}" min="1" max="999">
          </div>
        </div>
        <div class="cfg-detail-field">
          <label>Plaza visible</label>
          <select id="cfg-inline-plaza">${_cfgCatalogPlazaOptions(plazaId || 'ALL')}</select>
        </div>
      </div>
    `;
  }

  if (tabName === 'estados') {
    const color = itemType.color || '#64748b';
    return `
      <div class="cfg-detail-form">
        <div class="cfg-detail-field">
          <label>Clave del estado</label>
          <input id="cfg-inline-name" type="text" value="${escapeHtml(title)}" placeholder="Ej: LISTO">
        </div>
        <div class="cfg-detail-grid-two">
          <div class="cfg-detail-field">
            <label>Color</label>
            <div class="cfg-detail-color-row">
              <input id="cfg-inline-color" type="color" value="${escapeHtml(color)}">
              <input id="cfg-inline-color-text" type="text" value="${escapeHtml(color)}" placeholder="#64748B" oninput="document.getElementById('cfg-inline-color').value=this.value">
            </div>
          </div>
          <div class="cfg-detail-field">
            <label>Orden</label>
            <input id="cfg-inline-order" type="number" value="${escapeHtml(String(orderValue))}" min="1" max="999">
          </div>
        </div>
      </div>
    `;
  }

  if (tabName === 'categorias') {
    return `
      <div class="cfg-detail-form">
        <div class="cfg-detail-grid-two">
          <div class="cfg-detail-field">
            <label>Categoría</label>
            <input id="cfg-inline-name" type="text" value="${escapeHtml(title)}" placeholder="Ej: ICAR">
          </div>
          <div class="cfg-detail-field">
            <label>Orden</label>
            <input id="cfg-inline-order" type="number" value="${escapeHtml(String(orderValue))}" min="1" max="999">
          </div>
        </div>
        <div class="cfg-detail-field">
          <label>Descripción</label>
          <textarea id="cfg-inline-description" rows="4" placeholder="Explica para qué se usa esta categoría.">${escapeHtml(description)}</textarea>
        </div>
        <div class="cfg-detail-related-block">
          <div class="cfg-detail-related-head">
            <strong>Modelos ligados</strong>
            <span>${relatedModels.length}</span>
          </div>
          <div class="cfg-detail-related-chips">
            ${relatedModels.length > 0
              ? relatedModels.map(model => `<span class="cfg-detail-chip">${escapeHtml(_cfgCatalogDisplayValue('modelos', model))}</span>`).join('')
              : '<span class="cfg-detail-chip muted">Sin modelos asignados</span>'}
          </div>
        </div>
      </div>
    `;
  }

  if (tabName === 'modelos') {
    const imageUrl = _cfgModelImageValue(item);
    return `
      <div class="cfg-detail-form">
        <div class="cfg-detail-grid-two">
          <div class="cfg-detail-field">
            <label>Modelo</label>
            <input id="cfg-inline-name" type="text" value="${escapeHtml(title)}" placeholder="Ej: AVEO">
          </div>
          <div class="cfg-detail-field">
            <label>Orden</label>
            <input id="cfg-inline-order" type="number" value="${escapeHtml(String(orderValue))}" min="1" max="999">
          </div>
        </div>
        <div class="cfg-detail-field">
          <label>Categoría</label>
          <select id="cfg-inline-modelo-cat">${_cfgCatalogCategoryOptions(itemType.categoria || '')}</select>
        </div>
        <div class="cfg-detail-field">
          <label>Imagen del modelo</label>
          <input id="cfg-inline-modelo-img" type="url" value="${escapeHtml(imageUrl)}" placeholder="https://..." oninput="_cfgPreviewModeloImg(this.value, 'cfg-inline')">
        </div>
        <div class="cfg-detail-upload-grid">
          <input id="cfg-inline-modelo-file" type="file" accept="image/*">
          <label class="cfg-detail-toggle">
            <input id="cfg-inline-modelo-remove-bg" type="checkbox">
            <span>Eliminar fondo claro</span>
          </label>
          <button type="button" class="cfg-detail-btn" onclick="_cfgUploadModelImage('cfg-inline')">
            <span class="material-icons">upload</span>
            Subir desde equipo
          </button>
        </div>
        <div id="cfg-inline-modelo-upload-status" class="cfg-detail-upload-status"></div>
        <div id="cfg-inline-modelo-preview" class="cfg-add-modelo-preview"${imageUrl ? '' : ' style="display:none;"'}>
          <img id="cfg-inline-modelo-preview-img" alt="Preview modelo" loading="lazy"${imageUrl ? ` src="${escapeHtml(imageUrl)}"` : ''}>
          <span id="cfg-inline-modelo-preview-label">Vista previa</span>
        </div>
      </div>
    `;
  }

  if (tabName === 'gasolinas') {
    return `
      <div class="cfg-detail-form">
        <div class="cfg-detail-field">
          <label>Nivel visible</label>
          <input id="cfg-inline-name" type="text" value="${escapeHtml(title)}" placeholder="Ej: 3/4">
        </div>
        <div class="cfg-detail-callout">Mantén nombres cortos para que el indicador de gasolina siga siendo claro dentro del mapa y los formularios.</div>
      </div>
    `;
  }

  return '';
}

function _cfgCatalogMetaRows(tabName, item, index) {
  const title = _cfgCatalogPrimaryLabel(tabName, item);
  if (!item) return [];
  if (tabName === 'ubicaciones') {
    const isFixed = typeof item === 'object' ? item.isPlazaFija === true : ['PATIO', 'TALLER', 'AGENCIA', 'TALLER EXTERNO', 'HYP COBIAN'].includes(title);
    return [
      ['Tipo', isFixed ? 'Plaza fija' : 'Responsable / referencia'],
      ['Plaza visible', (item.plazaId || 'ALL').toUpperCase()],
      ['Orden', String(_cfgCatalogOrderValue(item, index))],
      ['Impacto', isFixed ? 'Referencia de operación global' : 'Persona o punto operativo']
    ];
  }
  if (tabName === 'estados') {
    return [
      ['Clave', title],
      ['Color', item.color || 'Sin color'],
      ['Orden', String(_cfgCatalogOrderValue(item, index))],
      ['Impacto', 'Filtros, badges y lectura visual']
    ];
  }
  if (tabName === 'categorias') {
    const models = _cfgCatalogRelatedModels(tabName, item);
    const description = _cfgCatalogDescriptionValue(tabName, item);
    return [
      ['Categoría', title],
      ['Modelos ligados', String(models.length)],
      ['Descripción', description ? description : 'Sin descripción'],
      ['Orden', String(_cfgCatalogOrderValue(item, index))]
    ];
  }
  if (tabName === 'modelos') {
    return [
      ['Modelo', title],
      ['Categoría', item.categoria || 'Sin categoría'],
      ['Imagen', _cfgModelImageValue(item) ? 'Configurada' : 'Sin imagen'],
      ['Orden', String(_cfgCatalogOrderValue(item, index))]
    ];
  }
  if (tabName === 'gasolinas') {
    return [
      ['Nivel', title],
      ['Porcentaje', `${_gasToPercent(title)}%`],
      ['Uso', 'Indicador operativo y revisión'],
      ['Registro', `Elemento ${index + 1}`]
    ];
  }
  return [];
}

function _cfgCatalogCallout(tabName, item) {
  const title = _cfgCatalogPrimaryLabel(tabName, item);
  const description = _cfgCatalogDescriptionValue(tabName, item);
  const map = {
    ubicaciones: `Esta ubicación define alcance operativo por plaza. Usa ALL solo cuando de verdad deba verse en todas las plazas.`,
    estados: `Los estados afectan color, lectura del mapa y filtros operativos. Cambiarlos impacta la interpretación diaria del patio.`,
    categorias: description
      ? description
      : `La categoría ${title} sirve como capa de orden para modelos, reglas blandas y futuras restricciones de acomodo.`,
    modelos: `Mantén la categoría e imagen consistentes para que el inventario administrativo y el operativo no se descuadren.`,
    gasolinas: `Este nivel se refleja en reportes y visualizaciones rápidas. Conviene mantenerlo corto y entendible para operación.`
  };
  return map[tabName] || 'Este catálogo impacta la operación del sistema.';
}

function _cfgCatalogDetailHtml(tabName, item, index) {
  if (!item || index < 0) {
    return `
      <div class="cfg-detail-card">
        <div class="cfg-detail-empty">
          <span class="material-icons">list_alt</span>
          <strong>Selecciona un elemento</strong>
          <span>El editor contextual aparecerá aquí con metadata, impacto operativo y acciones disponibles.</span>
        </div>
      </div>
    `;
  }

  const title = _cfgCatalogPrimaryLabel(tabName, item);
  const metaRows = _cfgCatalogMetaRows(tabName, item, index);
  const isEditing = _cfgCatalogEditIndex === index;
  const preview = tabName === 'modelos' && _cfgModelImageValue(item)
    ? `<img src="${escapeHtml(_cfgModelImageValue(item))}" alt="${escapeHtml(title)}" class="cfg-detail-preview-img" loading="lazy">`
    : '';
  const relatedModels = _cfgCatalogRelatedModels(tabName, item);

  return `
    <div class="cfg-detail-card">
      <div class="cfg-detail-card-head">
        <div>
          <h4>Editor contextual</h4>
          <p>Resumen operativo, metadata útil y acciones rápidas del catálogo activo.</p>
        </div>
        <span class="cfg-catalog-count">${escapeHtml(_cfgMetaForTab(tabName).badge)}</span>
      </div>
      <div class="cfg-detail-card-body">
        <div class="cfg-detail-hero">
          <div class="cfg-detail-icon">
            <span class="material-icons">${_cfgCatalogIcon(tabName)}</span>
          </div>
          <div>
            <h5>${escapeHtml(title)}</h5>
            <p>${escapeHtml(_cfgMetaForTab(tabName).description)}</p>
          </div>
        </div>
        ${preview}
        ${isEditing ? _cfgCatalogInlineEditorHtml(tabName, item, index) : `
          <div class="cfg-detail-meta-grid">
            ${metaRows.map(([label, value]) => `
              <div class="cfg-detail-meta-item">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
              </div>
            `).join('')}
          </div>
          ${tabName === 'categorias' ? `
            <div class="cfg-detail-related-block">
              <div class="cfg-detail-related-head">
                <strong>Modelos de esta categoría</strong>
                <span>${relatedModels.length}</span>
              </div>
              <div class="cfg-detail-related-chips">
                ${relatedModels.length > 0
                  ? relatedModels.map(model => `<span class="cfg-detail-chip">${escapeHtml(_cfgCatalogDisplayValue('modelos', model))}</span>`).join('')
                  : '<span class="cfg-detail-chip muted">Aún no hay modelos ligados</span>'}
              </div>
            </div>
          ` : ''}
          <div class="cfg-detail-callout">${escapeHtml(_cfgCatalogCallout(tabName, item))}</div>
        `}
        <div class="cfg-detail-actions">
          ${isEditing ? `
            <button type="button" class="cfg-detail-btn primary" onclick="_cfgSaveInlineEdit()">
              <span class="material-icons">save</span>
              Guardar cambios
            </button>
            <button type="button" class="cfg-detail-btn" onclick="_cfgCancelInlineEdit()">
              <span class="material-icons">close</span>
              Cancelar
            </button>
          ` : `
            <button type="button" class="cfg-detail-btn primary" onclick="editarElementoConfig(${index})">
              <span class="material-icons">edit</span>
              Editar elemento
            </button>
          `}
          <button type="button" class="cfg-detail-btn danger" onclick="eliminarElementoConfig(${index})">
            <span class="material-icons">delete</span>
            Eliminar
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderizarListaConfig() {
  const container = document.getElementById('cfg-lista-items');

  if (TAB_ACTIVA_CFG === 'empresa') {
    const emp = window.MEX_CONFIG.empresa || {};
    const correosInternos = emp.correosInternos || [];
    const correoTagsHtml = correosInternos.map((c, i) => `
          <span class="cfg-email-tag">
            <span class="material-icons" style="font-size:13px; margin-right:2px;">alternate_email</span>
            ${escapeHtml(c)}
            <button onclick="eliminarCorreoInterno(${i})" title="Eliminar">×</button>
          </span>
        `).join('');

    const logoHtml = emp.logoURL
      ? `<div class="cfg-emp-logo-img-wrap"><img src="${escapeHtml(emp.logoURL)}" alt="Logo empresa" class="cfg-emp-logo-big"></div>
             <div class="cfg-emp-logo-footer">
               <span style="font-size:11px;font-weight:800;color:#10b981;display:flex;align-items:center;gap:4px;flex:1;">
                 <span class="material-icons" style="font-size:14px;">check_circle</span> Logo activo
               </span>
               <button class="cfg-emp-logo-btn" onclick="document.getElementById('cfg-logo-file').click()" title="Cambiar logo">
                 <span class="material-icons">edit</span>
               </button>
               <button class="cfg-emp-logo-btn danger" onclick="eliminarLogoEmpresa()" title="Eliminar logo">
                 <span class="material-icons">delete</span>
               </button>
             </div>`
      : `<div class="cfg-emp-logo-placeholder" onclick="document.getElementById('cfg-logo-file').click()" style="cursor:pointer;">
               <span class="material-icons">add_photo_alternate</span>
               <span>Clic para subir logo</span>
               <span style="font-size:10px; color:#cbd5e1;">PNG, JPG, SVG — máx 2MB</span>
             </div>`;

    const plazasHtml = (emp.plazas || []).map((p, idx) => `
          <div class="cfg-emp-plaza-item">
            <div class="cfg-emp-plaza-item-left">
              <div class="cfg-emp-plaza-badge">${escapeHtml((p).slice(0, 3))}</div>
              <strong style="font-size:14px;">${escapeHtml(p)}</strong>
            </div>
            <button class="cfg-plaza-delete-btn" onclick="window.MEX_CONFIG.empresa.plazas.splice(${idx},1); renderizarListaConfig();" title="Eliminar Plaza">
              <span class="material-icons" style="font-size:16px;">delete</span>
            </button>
          </div>
        `).join('');

    container.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:14px; width:100%;">

            <!-- Identidad Visual -->
            <div class="cfg-emp-card">
              <div class="cfg-emp-section-header">
                <span class="material-icons">palette</span>
                Identidad Visual
              </div>

              <div class="cfg-emp-field">
                <label>Logo de la Empresa</label>
                <div class="cfg-emp-logo-zone" id="cfg-logo-zone" onclick="document.getElementById('cfg-logo-file').click()">
                  ${logoHtml}
                </div>
                <input type="file" id="cfg-logo-file" accept="image/*" style="display:none" onchange="subirLogoEmpresa(this)">
                ${emp.logoURL ? `<div style="margin-top:8px; display:flex; align-items:center; gap:10px;">
                  <span style="font-size:11px; font-weight:800; color:#10b981; display:flex; align-items:center; gap:4px;"><span class="material-icons" style="font-size:14px;">check_circle</span> Logo activo</span>
                  <button onclick="eliminarLogoEmpresa()" style="background:#fee2e2;color:#ef4444;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:800;cursor:pointer;">ELIMINAR</button>
                </div>` : ''}
              </div>

              <div class="cfg-emp-field">
                <label>Nombre de la Empresa</label>
                <div style="display:flex; align-items:center; gap:8px;">
                  <input type="text" id="cfg-empresa-nombre" class="cfg-emp-input cfg-empresa-nombre-locked" value="${escapeHtml(emp.nombre || '')}"
                    placeholder="Ej: Nombre real de la empresa" disabled
                    onchange="window.MEX_CONFIG.empresa.nombre = this.value"
                    style="flex:1;">
                  <button id="cfg-empresa-nombre-pencil"
                    onclick="(function(){
                      const inp=document.getElementById('cfg-empresa-nombre');
                      const btn=document.getElementById('cfg-empresa-nombre-pencil');
                      const ico=btn.querySelector('.material-icons');
                      if(inp.disabled){inp.disabled=false;inp.classList.remove('cfg-empresa-nombre-locked');inp.focus();ico.textContent='lock';}
                      else{inp.disabled=true;inp.classList.add('cfg-empresa-nombre-locked');ico.textContent='edit';}
                    })()"
                    class="cfg-emp-pencil-btn" title="Editar nombre">
                    <span class="material-icons">edit</span>
                  </button>
                </div>
              </div>

              <div class="cfg-emp-field">
                <label>Paleta de Colores de la Empresa</label>
                <p style="font-size:11px; color:#94a3b8; font-weight:600; margin:0 0 12px;">Aplican al guardar y publicar.</p>
                <div class="cfg-emp-palette-grid">
                  ${[
        { key: 'colorPrincipal', label: 'Principal', default: '#004a99', hint: 'Barra, botones' },
        { key: 'colorSecundario', label: 'Secundario', default: '#1d4ed8', hint: 'Acentos, hover' },
        { key: 'colorAcento', label: 'Acento', default: '#f59e0b', hint: 'Alertas, highlights' },
        { key: 'colorTexto', label: 'Texto', default: '#0f172a', hint: 'Texto principal' },
      ].map(c => {
        const val = emp[c.key] || c.default;
        return `
                    <div class="cfg-emp-palette-item">
                      <div class="cfg-emp-palette-swatch-wrap">
                        <div class="cfg-emp-palette-swatch" style="background:${val}" onclick="document.getElementById('emp-picker-${c.key}').click()"></div>
                        <input type="color" id="emp-picker-${c.key}" value="${val}" style="position:absolute;opacity:0;width:0;height:0;pointer-events:none;"
                          oninput="window.MEX_CONFIG.empresa['${c.key}']=this.value; document.getElementById('emp-hex-${c.key}').value=this.value.toUpperCase(); document.querySelector('#emp-swatch-wrapper-${c.key}').style.background=this.value;">
                        <div class="cfg-emp-palette-hex-wrap" id="emp-swatch-wrapper-${c.key}" style="background:${val}">
                          <input type="text" id="emp-hex-${c.key}" class="cfg-emp-palette-hex-input" value="${val.toUpperCase()}"
                            maxlength="7"
                            oninput="if(/^#[0-9a-fA-F]{6}$/.test(this.value)){window.MEX_CONFIG.empresa['${c.key}']=this.value;document.getElementById('emp-picker-${c.key}').value=this.value;document.querySelector('#emp-swatch-wrapper-${c.key}').style.background=this.value;}">
                        </div>
                      </div>
                      <div class="cfg-emp-palette-info">
                        <div class="cfg-emp-palette-name">${c.label}</div>
                        <div class="cfg-emp-palette-hint">${c.hint}</div>
                      </div>
                    </div>`;
      }).join('')}
                </div>
              </div>
            </div>

            <!-- Correos Corporativos -->
            <div class="cfg-emp-card">
              <div class="cfg-emp-section-header">
                <span class="material-icons">alternate_email</span>
                Correos Corporativos
              </div>

              ${[
        { id: 'cfg-correo-empresa', key: 'correoEmpresa', label: 'Correo de la Empresa', ph: 'contacto@tuempresa.com' },
        { id: 'cfg-correo-facturacion', key: 'correoFacturacion', label: 'Correo de Facturación', ph: 'facturacion@tuempresa.com' },
      ].map(f => `
                <div class="cfg-emp-field">
                  <label>${f.label}</label>
                  <div style="display:flex; gap:6px; align-items:center;">
                    <input type="email" id="${f.id}" class="cfg-emp-input" style="flex:1;"
                      value="${escapeHtml(emp[f.key] || '')}" placeholder="${f.ph}"
                      readonly
                      oninput="window.MEX_CONFIG.empresa['${f.key}'] = this.value"
                      onfocus="this.style.borderColor='var(--mex-accent)'" onblur="this.style.borderColor=''">
                    <button onclick="_toggleEditCorreo('${f.id}')" title="Editar"
                      style="background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; width:34px; height:34px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;">
                      <span class="material-icons" style="font-size:16px; color:#475569;">edit</span>
                    </button>
                    <button onclick="_borrarCampoCorreo('${f.id}','${f.key}')" title="Borrar"
                      style="background:#fee2e2; border:1px solid #fca5a5; border-radius:8px; width:34px; height:34px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;">
                      <span class="material-icons" style="font-size:16px; color:#ef4444;">delete</span>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>

            <!-- Correos Internos -->
            <div class="cfg-emp-card">
              <div class="cfg-emp-section-header">
                <span class="material-icons">notifications_active</span>
                Correos Internos · MAPA
              </div>
              <p style="font-size:12px; color:#64748b; font-weight:600; margin-bottom:12px; line-height:1.6;">
                Reciben notificaciones automáticas (alertas, resúmenes, eventos críticos).
              </p>

              <!-- Buscador -->
              <div style="display:flex; align-items:center; gap:6px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:6px 10px; margin-bottom:10px;">
                <span class="material-icons" style="font-size:16px; color:#94a3b8;">search</span>
                <input type="text" id="cfg-correo-interno-search" placeholder="Buscar correo o título..."
                  oninput="_renderCorreosInternosList()"
                  style="border:none; background:transparent; outline:none; font-size:12px; flex:1; color:#334155;">
              </div>

              <div id="cfg-correos-internos-list" style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px;">
                ${_renderCorreosInternosHtml(emp.correosInternos || [])}
              </div>

              <!-- Agregar nuevo -->
              <div style="background:#f8fafc; border:1.5px dashed #cbd5e1; border-radius:10px; padding:10px 12px;">
                <div style="font-size:11px; font-weight:800; color:#64748b; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Agregar Correo</div>
                <div style="display:flex; gap:6px; margin-bottom:6px;">
                  <input type="text" id="cfg-correo-interno-titulo" placeholder="Título (ej: Gerente GDL)"
                    style="flex:1; padding:7px 10px; border-radius:8px; border:1.5px solid #e2e8f0; font-size:12px; outline:none;">
                </div>
                <div style="display:flex; gap:6px;">
                  <input type="email" id="cfg-correo-interno-input" placeholder="nuevo@correo.com"
                    onkeydown="if(event.key==='Enter') agregarCorreoInterno()"
                    style="flex:1; padding:7px 10px; border-radius:8px; border:1.5px solid #e2e8f0; font-size:12px; outline:none;">
                  <button onclick="agregarCorreoInterno()"
                    style="background:var(--mex-blue); color:white; border:none; border-radius:8px; padding:7px 14px; font-weight:800; font-size:12px; cursor:pointer; white-space:nowrap;">+ AÑADIR</button>
                </div>
              </div>
            </div>

            <!-- Catálogo de Plazas movido al tab Plazas -->

            ${canUseProgrammerConfig() ? `
            <div class="cfg-emp-card" id="cfg-backfill-card">
              <div class="cfg-emp-section-header">
                <span class="material-icons">tag</span>
                Backfill de Plaza en Unidades
              </div>
              <p style="font-size:12px; color:#64748b; line-height:1.6; margin:0 0 12px;">
                Inyecta el campo <code>plaza</code> en documentos de <b>cuadre</b> y <b>externos</b> que aún no lo tienen
                (datos legacy sin campo plaza → los inferimos de <code>sucursal</code> / <code>plazaAsignada</code>).
                <br><strong style="color:#f59e0b;">Seguro: solo actualiza campo faltante, no borra nada.</strong>
              </p>
              <div id="cfg-bf-progress" style="display:none; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; color:#64748b; margin-bottom:4px;">
                  <span id="cfg-bf-label">Iniciando...</span><span id="cfg-bf-pct">0%</span>
                </div>
                <div style="background:#e2e8f0; border-radius:99px; height:7px; overflow:hidden;">
                  <div id="cfg-bf-bar" style="height:100%; width:0%; background:#10b981; border-radius:99px; transition:width .3s;"></div>
                </div>
              </div>
              <div id="cfg-bf-log" style="display:none; font-size:11px; color:#475569; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px; max-height:100px; overflow-y:auto; margin-bottom:10px; font-family:monospace; white-space:pre-wrap;"></div>
              <button id="cfg-bf-btn" onclick="ejecutarBackfillPlaza()"
                style="background:#10b981; color:white; border:none; border-radius:10px; padding:10px 20px; font-size:13px; font-weight:800; cursor:pointer; display:flex; align-items:center; gap:8px;">
                <span class="material-icons" style="font-size:16px;">sync</span>
                Inyectar campo plaza en unidades legacy
              </button>
            </div>` : ''}

            ${canUseProgrammerConfig() ? `
            <div class="cfg-emp-card" id="cfg-migration-card">
              <div class="cfg-emp-section-header">
                <span class="material-icons">move_up</span>
                Migración de Datos Legacy → Subcollections
              </div>
              <p style="font-size:12px; color:#64748b; line-height:1.6; margin:0 0 12px;">
                Mueve los documentos de colecciones planas (<b>cuadre</b>, <b>externos</b>, <b>cuadre_admins</b>, <b>historial_cuadres</b>) a su subcollection por plaza correcta.
                <br><strong style="color:#f59e0b;">Solo copia — no borra el legacy. Seguro de ejecutar.</strong>
              </p>
              <div id="cfg-mig-progress" style="display:none; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; color:#64748b; margin-bottom:4px;">
                  <span id="cfg-mig-label">Iniciando...</span>
                  <span id="cfg-mig-pct">0%</span>
                </div>
                <div style="background:#e2e8f0; border-radius:99px; height:7px; overflow:hidden;">
                  <div id="cfg-mig-bar" style="height:100%; width:0%; background:#6366f1; border-radius:99px; transition:width .3s;"></div>
                </div>
              </div>
              <div id="cfg-mig-log" style="display:none; font-size:11px; color:#475569; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px; max-height:120px; overflow-y:auto; margin-bottom:10px; font-family:monospace; white-space:pre-wrap;"></div>
              <button id="cfg-mig-btn" onclick="ejecutarMigracionLegacy()"
                style="background:#6366f1; color:white; border:none; border-radius:10px; padding:10px 20px; font-size:13px; font-weight:800; cursor:pointer; display:flex; align-items:center; gap:8px;">
                <span class="material-icons" style="font-size:16px;">move_up</span>
                Migrar datos legacy a subcollections
              </button>
            </div>` : ''}

            <div class="cfg-emp-card" style="padding:18px 20px;">
              <div style="display:flex; justify-content:flex-end; gap:12px; flex-wrap:wrap;">
                <button type="button" class="cfg-save-btn" onclick="guardarEmpresaConfig()">
                  <span class="material-icons">save</span>
                  Guardar empresa
                </button>
              </div>
            </div>

          </div>
        `;
    return;
  }

  if (TAB_ACTIVA_CFG === 'usuarios') {
    renderizarTabConfigUsuarios(container);
    return;
  }

  if (TAB_ACTIVA_CFG === 'roles') {
    if (!canViewAdminRoles()) {
      container.innerHTML = '<div style="padding:28px; text-align:center; color:#ef4444; font-weight:800;">Sin permiso para editar roles o permisos.</div>';
      return;
    }
    _cfgRenderRolesTab(container);
    return;
  }

  if (TAB_ACTIVA_CFG === 'solicitudes') {
    renderizarTabConfigSolicitudes(container);
    return;
  }

  if (TAB_ACTIVA_CFG === 'programador') {
    if (!canUseProgrammerConfig()) {
      container.innerHTML = '<div style="padding:28px; text-align:center; color:#ef4444; font-weight:800;">Sin permiso para abrir la consola de programador.</div>';
      return;
    }
    container.innerHTML = `
      <div style="padding:28px; display:grid; gap:14px; text-align:center;">
        <div style="font-size:13px; font-weight:800; color:#64748b; letter-spacing:.08em; text-transform:uppercase;">Ruta dedicada</div>
        <div style="font-size:28px; font-weight:900; color:#0f172a;">Centro de Control Técnico</div>
        <div style="font-size:14px; color:#475569; max-width:560px; margin:0 auto; line-height:1.7;">
          Panel avanzado con herramientas, Firestore, jobs, seguridad, notificaciones y monitoreo en tiempo real. Ruta: <b>/programador</b>.
        </div>
        <div style="display:flex; justify-content:center; gap:12px; flex-wrap:wrap;">
          <button type="button" class="cfg-save-btn" onclick="_abrirProgrammerConsoleRoute()">
            <span class="material-icons">terminal</span>
            Abrir Centro de Control
          </button>
              <button type="button" class="cfg-cancel-btn" onclick="abrirTabConfig('usuarios', document.getElementById('cfg-tab-usuarios'))">
            Volver a usuarios
          </button>
        </div>
      </div>
    `;
    return;
  }

  if (TAB_ACTIVA_CFG === 'plazas') {
    const plazasActivas = Array.isArray(window.MEX_CONFIG?.empresa?.plazas) ? window.MEX_CONFIG.empresa.plazas : [];
    if (_plazaSeleccionadaCfg && !plazasActivas.includes(_plazaSeleccionadaCfg)) {
      _plazaSeleccionadaCfg = null;
    }
    renderizarTabConfigPlazas(container);
    return;
  }

  const rawLista = window.MEX_CONFIG.listas[TAB_ACTIVA_CFG] || [];
  const query = (document.getElementById('cfg-search-input')?.value || "").trim().toUpperCase();
  const plazaFilter = TAB_ACTIVA_CFG === 'ubicaciones' ? (document.getElementById('cfg-ubi-plaza-filter')?.value || '') : '';
  const catFilter = TAB_ACTIVA_CFG === 'modelos' ? (document.getElementById('cfg-modelo-cat-filter')?.value || '') : '';

  // GERENTE_PLAZA only sees their plaza's ubicaciones
  const myPlaza = (typeof currentUserProfile !== 'undefined' && currentUserProfile?.plazaAsignada) || '';
  const esGerentePlaza = (typeof userAccessRole !== 'undefined') && userAccessRole === 'GERENTE_PLAZA';

  let lista = rawLista.map((item, idx) => ({ ...((typeof item === 'object') ? item : { nombre: item }), _origIndex: idx }));

  if (query) {
    lista = lista.filter(item => (item.id || item.nombre || "").toUpperCase().includes(query));
  }

  if (catFilter) {
    lista = lista.filter(item => (typeof item === 'object' ? item.categoria : '') === catFilter);
  }

  if (TAB_ACTIVA_CFG === 'ubicaciones') {
    // Si no tiene acceso global, solo ver ubicaciones de SU plaza
    const activePlazaFilter = plazaFilter
      || (!_puedeVerTodasPlazas() ? _miPlaza() : '')
      || (esGerentePlaza ? myPlaza : '');
    if (activePlazaFilter) {
      const apfUp = activePlazaFilter.toUpperCase();
      lista = lista.filter(item =>
        !item.plazaId ||
        item.plazaId === 'ALL' ||
        (item.plazaId || '').toUpperCase() === apfUp
      );
    }
  }

  const tabsSinDrag = ['gasolinas'];
  const usaDrag = !tabsSinDrag.includes(TAB_ACTIVA_CFG) && !query && !plazaFilter;
  const visibleIndices = lista.map(itemObj => itemObj._origIndex);
  if (_cfgIsCatalogDetailTab(TAB_ACTIVA_CFG) && !visibleIndices.includes(_cfgCatalogSelectedIndex)) {
    _cfgCatalogSelectedIndex = visibleIndices[0] ?? null;
  }

  const rowsHtml = lista.map((itemObj, visIndex) => {
    const i = itemObj._origIndex;
    const item = rawLista[i];
    const esEstado = typeof item === 'object' && item.color !== undefined;
    let valor = esEstado ? item.id : (item.nombre || item);
    const color = esEstado ? item.color : null;
    let pText = "";

    if (TAB_ACTIVA_CFG === 'ubicaciones') {
      const isPlaza = typeof item === 'object' ? item.isPlazaFija : ['PATIO', 'TALLER', 'AGENCIA', 'TALLER EXTERNO', 'HYP COBIAN'].includes(item);
      const plazaTag = item.plazaId ? `<span style="font-size:10px; background:#0ea5e9; color:white; padding:2px 6px; border-radius:4px; font-weight:700; display:inline-block; margin-left:4px;">${escapeHtml(item.plazaId)}</span>` : '';
      pText = (isPlaza
        ? `<span style="font-size:10px; background:#10b981; color:white; padding:2px 6px; border-radius:4px; font-weight:700; display:inline-block; margin-left:8px;">PLAZA FIJA</span>`
        : `<span style="font-size:10px; background:#6366f1; color:white; padding:2px 6px; border-radius:4px; font-weight:700; display:inline-block; margin-left:8px;">PERSONA RESPON.</span>`) + plazaTag;
    }

    if (TAB_ACTIVA_CFG === 'modelos') {
      const modCat = typeof item === 'object' ? item.categoria : 'SIN ASIGNAR';
      const catFilter = document.getElementById('cfg-modelo-cat-filter')?.value || '';
      pText = `<span style="font-size:10px; background:#475569; color:white; padding:2px 6px; border-radius:4px; display:inline-block; margin-left:8px;">${escapeHtml(modCat || 'SIN CAT.')}</span>`;
    }

    const modelImgUrl = TAB_ACTIVA_CFG === 'modelos' ? _cfgModelImageValue(item) : '';
    const modelThumb = modelImgUrl
      ? `<img src="${escapeHtml(modelImgUrl)}" class="cfg-model-thumb" alt="Modelo" loading="lazy">`
      : '';

    if (TAB_ACTIVA_CFG === 'categorias') {
      const modelos = (window.MEX_CONFIG.listas.modelos || []).filter(m => (typeof m === 'object' ? m.categoria : '') === valor);
      const preview = modelos.slice(0, 3).map(m => m.nombre).join(', ');
      const extra = modelos.length > 3 ? ` +${modelos.length - 3}` : '';
      if (modelos.length > 0) {
        pText = `<span style="font-size:11px; color:#64748b; font-weight:600; margin-left:8px; cursor:pointer;" onclick="cfgToggleModelos('catmod-${i}')" title="Ver modelos">
              [${preview}${extra}] <span class="material-icons" style="font-size:11px; vertical-align:middle;">expand_more</span>
            </span>`;
      }
    }

    if (TAB_ACTIVA_CFG === 'gasolinas') {
      const pct = _gasToPercent(valor);
      pText = `<span style="display:inline-flex; align-items:center; gap:6px; margin-left:8px;">
            <span style="width:80px; height:8px; background:#e2e8f0; border-radius:4px; overflow:hidden; display:inline-block;">
              <span style="display:block; height:100%; width:${pct}%; background:${pct > 60 ? '#10b981' : pct > 30 ? '#f59e0b' : '#ef4444'}; border-radius:4px; transition:width 0.3s;"></span>
            </span>
            <span style="font-size:10px; font-weight:800; color:#64748b;">${pct}%</span>
          </span>`;
    }

    const dragAttrs = usaDrag ? `draggable="true" ondragstart="cfgDragStart(event,${i})" ondragover="cfgDragOver(event)" ondrop="cfgDrop(event,${i})"` : '';
    const dragHandle = usaDrag ? `<span class="cfg-drag-handle" title="Arrastrar para reordenar"><span class="material-icons">drag_indicator</span></span>` : '';
    const activeClass = _cfgCatalogSelectedIndex === i ? ' active' : '';
    const orderBadge = typeof item === 'object' && ['ubicaciones', 'estados', 'categorias', 'modelos'].includes(TAB_ACTIVA_CFG)
      ? `<span style="font-size:10px; color:#94a3b8; font-weight:800; flex-shrink:0;">#${_cfgCatalogOrderValue(item, visIndex)}</span>`
      : '';

    const modelosExpandidos = TAB_ACTIVA_CFG === 'categorias'
      ? `<div id="catmod-${i}" class="cfg-cat-models-expand" style="display:none;">
              ${(window.MEX_CONFIG.listas.modelos || []).filter(m => (typeof m === 'object' ? m.categoria : '') === valor).map(m => `<span class="cfg-cat-model-chip">${escapeHtml(m.nombre)}</span>`).join('') || '<span style="font-size:11px;color:#94a3b8;">Sin modelos asignados</span>'}
            </div>` : '';

    return `<div class="cfg-item${activeClass}" onclick="_cfgSelectCatalogItem(${i})" ${dragAttrs} data-cfg-idx="${i}" style="padding:12px 14px; display:flex; flex-direction:column; background:white; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:8px; transition:opacity 0.15s; cursor:pointer;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
              ${dragHandle}
              ${color ? `<div style="background:${color}; width:14px; height:14px; border-radius:50%; flex-shrink:0; box-shadow:0 0 0 1px rgba(0,0,0,0.1);" title="${color}"></div>` : ''}
              ${modelThumb}
              <strong style="white-space:nowrap; text-overflow:ellipsis; overflow:hidden; font-size:13px;">${escapeHtml(valor)}</strong>
              ${pText}
              ${orderBadge}
            </div>
            <span class="material-icons" style="font-size:18px; color:${activeClass ? '#2563eb' : '#cbd5e1'};">chevron_right</span>
          </div>
          ${modelosExpandidos}
        </div>`;
  }).join('');

  if (!lista || lista.length === 0) {
    container.innerHTML = `
      <div class="cfg-catalog-shell">
        <div class="cfg-catalog-list-col">
          <div class="cfg-catalog-panel">
            <div class="cfg-catalog-panel-head">
              <div>
                <h4>${escapeHtml(_cfgMetaForTab(TAB_ACTIVA_CFG).label)}</h4>
                <p>${escapeHtml(_cfgMetaForTab(TAB_ACTIVA_CFG).description)}</p>
              </div>
              <span class="cfg-catalog-count">0 registros</span>
            </div>
            <div class="cfg-catalog-list-stack">
              <div style="text-align:center; padding:30px; color:#94a3b8; font-weight:700; font-size:13px;">Sin elementos. Agrega el primero desde la barra superior.</div>
            </div>
          </div>
        </div>
        <div class="cfg-catalog-detail-col">
          ${_cfgCatalogDetailHtml(TAB_ACTIVA_CFG, null, -1)}
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="cfg-catalog-shell">
      <div class="cfg-catalog-list-col">
        <div class="cfg-catalog-panel">
          <div class="cfg-catalog-panel-head">
            <div>
              <h4>${escapeHtml(_cfgMetaForTab(TAB_ACTIVA_CFG).label)}</h4>
              <p>${escapeHtml(_cfgMetaForTab(TAB_ACTIVA_CFG).description)}</p>
            </div>
            <span class="cfg-catalog-count">${escapeHtml(String(lista.length))} registros</span>
          </div>
          <div class="cfg-catalog-list-stack">
            ${rowsHtml}
          </div>
        </div>
      </div>
      <div class="cfg-catalog-detail-col">
        ${_cfgCatalogDetailHtml(TAB_ACTIVA_CFG, rawLista[_cfgCatalogSelectedIndex], _cfgCatalogSelectedIndex)}
      </div>
    </div>
  `;
}

// ── Drag-and-drop para listas de configuración ──────────────────────
let _cfgDragSrcIdx = null;

function cfgDragStart(event, origIdx) {
  _cfgDragSrcIdx = origIdx;
  event.dataTransfer.effectAllowed = 'move';
  event.currentTarget.style.opacity = '0.4';
}

function cfgDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

async function cfgDrop(event, destOrigIdx) {
  event.preventDefault();
  if (_cfgDragSrcIdx === null || _cfgDragSrcIdx === destOrigIdx) {
    _cfgDragSrcIdx = null;
    return;
  }
  const lista = window.MEX_CONFIG.listas[TAB_ACTIVA_CFG];
  if (!lista) return;
  const moved = lista.splice(_cfgDragSrcIdx, 1)[0];
  // Adjust dest index if we removed an element before it
  const adjustedDest = destOrigIdx > _cfgDragSrcIdx ? destOrigIdx - 1 : destOrigIdx;
  lista.splice(adjustedDest, 0, moved);
  _cfgCatalogApplyOrder(lista, TAB_ACTIVA_CFG);
  _cfgCatalogSelectedIndex = adjustedDest;
  _cfgCatalogEditIndex = null;
  _cfgDragSrcIdx = null;
  renderizarListaConfig();
  await _persistListAdminAction(
    'CATALOGO_REORDENADO',
    `Reordenó elementos del catálogo ${TAB_ACTIVA_CFG}`,
    'Orden actualizado.',
    { entidad: TAB_ACTIVA_CFG, referencia: TAB_ACTIVA_CFG }
  );
}

function cfgToggleModelos(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}

// Convierte valor de gasolina a porcentaje (0-100)
function _gasToPercent(val) {
  const v = String(val || '').trim().toUpperCase();
  if (v === 'F') return 100;
  if (v === 'H') return 50;
  if (v === 'E') return 0;
  if (v === 'N/A') return 0;
  const parts = v.split('/');
  if (parts.length === 2) {
    const n = Number(parts[0]), d = Number(parts[1]);
    if (d > 0) return Math.round((n / d) * 100);
  }
  return 0;
}

function buscarEnListaConfig() { renderizarListaConfig(); }

// ── Helpers para modal-cfg-add ─────────────────────────────────
function _cfgSetModalMeta(type, isEdit) {
  const META = {
    ubicaciones: { icon: 'place', sub: 'Patio, persona o lugar de destino' },
    estados: { icon: 'sell', sub: 'Estado con color personalizado para el mapa' },
    modelos: { icon: 'directions_car', sub: 'Modelo o versión de vehículo' },
    categorias: { icon: 'category', sub: 'Agrupación de modelos de vehículo' },
    gasolinas: { icon: 'local_gas_station', sub: 'Nivel de combustible (ej: ½, ¾, F)' },
  };
  const LABELS = { ubicaciones: 'Ubicación', estados: 'Estado', modelos: 'Modelo', categorias: 'Categoría', gasolinas: 'Nivel de gasolina' };
  const m = META[type] || { icon: 'add_circle', sub: '' };
  const label = LABELS[type] || 'Elemento';
  const title = isEdit ? `Editar ${label}` : `Nueva ${label}`;
  const iconEl = document.getElementById('cfg-add-header-icon');
  const titleEl = document.getElementById('modal-cfg-add-title');
  const subEl = document.getElementById('cfg-add-header-sub');
  if (iconEl) iconEl.innerHTML = `<span class="material-icons">${m.icon}</span>`;
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = m.sub;
}

function _cfgUpdateColorSwatch(hex) {
  const swatch = document.getElementById('cfg-add-color-swatch');
  const hexLabel = document.getElementById('cfg-add-color-hex');
  const colorIn = document.getElementById('cfg-add-color');
  if (swatch) swatch.style.background = hex;
  if (hexLabel) hexLabel.textContent = hex.toUpperCase();
  if (colorIn && colorIn.value !== hex) colorIn.value = hex;
}

function _cfgFillColorPresets() {
  const PRESETS = ['#0f172a', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#f97316', '#ec4899', '#14b8a6', '#64748b', '#e2e8f0'];
  const el = document.getElementById('cfg-add-color-presets');
  if (!el) return;
  el.innerHTML = PRESETS.map(c =>
    `<div class="cfg-add-color-preset" style="background:${c}" onclick="_cfgUpdateColorSwatch('${c}')" title="${c}"></div>`
  ).join('');
}

function _cfgShowModal() {
  const overlay = document.getElementById('modal-cfg-add');
  overlay.style.display = 'flex';
  // Forzar re-animación
  const card = overlay.querySelector('.cfg-add-card');
  if (card) { card.style.animation = 'none'; card.offsetHeight; card.style.animation = ''; }
  setTimeout(() => document.getElementById('cfg-add-name')?.focus(), 120);
}

function abrirModalNuevaConfig() {
  const cfgName = document.getElementById('cfg-add-name');
  if (!cfgName) { console.warn('[cfg] modal-cfg-add no encontrado en el DOM'); return; }
  _cfgCatalogEditIndex = null;
  cfgName.value = '';
  document.getElementById('cfg-add-ubi-options').style.display = 'none';
  document.getElementById('cfg-add-estado-options').style.display = 'none';
  document.getElementById('cfg-add-modelo-options').style.display = 'none';
  document.getElementById('cfg-add-categoria-options').style.display = 'none';

  if (TAB_ACTIVA_CFG === 'ubicaciones') {
    document.getElementById('cfg-add-ubi-options').style.display = 'block';
    document.getElementById('cfg-add-is-plaza').checked = true;
    _llenarSelectPlazasUbi('cfg-add-ubi-plaza', '');
  } else if (TAB_ACTIVA_CFG === 'estados') {
    document.getElementById('cfg-add-estado-options').style.display = 'block';
    document.getElementById('cfg-add-color').value = '#64748b';
    document.getElementById('cfg-add-orden').value = '99';
    _cfgUpdateColorSwatch('#64748b');
    _cfgFillColorPresets();
  } else if (TAB_ACTIVA_CFG === 'modelos') {
    document.getElementById('cfg-add-modelo-options').style.display = 'block';
    const cats = window.MEX_CONFIG.listas.categorias || [];
    document.getElementById('cfg-add-modelo-cat').innerHTML = '<option value="">(Ninguna)</option>' + cats.map(c => `<option value="${escapeHtml(typeof c === 'object' ? c.nombre || c.id : c)}">${escapeHtml(typeof c === 'object' ? c.nombre || c.id : c)}</option>`).join('');
    const imgInput = document.getElementById('cfg-add-modelo-img');
    if (imgInput) imgInput.value = '';
    const fileInput = document.getElementById('cfg-add-modelo-file');
    if (fileInput) fileInput.value = '';
    const uploadStatus = document.getElementById('cfg-add-modelo-upload-status');
    if (uploadStatus) uploadStatus.textContent = '';
    const orderInput = document.getElementById('cfg-add-modelo-orden');
    if (orderInput) orderInput.value = String((window.MEX_CONFIG?.listas?.modelos || []).length + 1);
    _cfgPreviewModeloImg('');
  } else if (TAB_ACTIVA_CFG === 'categorias') {
    document.getElementById('cfg-add-categoria-options').style.display = 'block';
    const descInput = document.getElementById('cfg-add-categoria-desc');
    const orderInput = document.getElementById('cfg-add-categoria-orden');
    if (descInput) descInput.value = '';
    if (orderInput) orderInput.value = String((window.MEX_CONFIG?.listas?.categorias || []).length + 1);
  }

  document.getElementById('cfg-add-name').dataset.editIndex = -1;
  _cfgSetModalMeta(TAB_ACTIVA_CFG, false);
  _cfgShowModal();
}

function _cfgStartInlineEdit(index) {
  _cfgCatalogSelectedIndex = Number(index);
  _cfgCatalogEditIndex = Number(index);
  renderizarListaConfig();
}

function _cfgCancelInlineEdit() {
  _cfgCatalogEditIndex = null;
  renderizarListaConfig();
}

function _cfgBuildCatalogPayload(prefix = 'cfg-add', tabName = TAB_ACTIVA_CFG, listLength = 0, fallbackIndex = 0) {
  const rawName = _cfgReadValue(`${prefix}-name`);
  const normalizedName = rawName.toUpperCase();
  if (!normalizedName) {
    showToast('Escribe un nombre.', 'error');
    return null;
  }

  let newItem;
  let desiredOrder = fallbackIndex + 1;

  if (tabName === 'estados') {
    desiredOrder = _cfgNormalizeDesiredOrder(_cfgReadValue(`${prefix}-order`, String(fallbackIndex + 1)), fallbackIndex + 1, Math.max(listLength, 1));
    newItem = {
      id: normalizedName,
      color: _cfgReadValue(`${prefix}-color`, '#64748b') || '#64748b',
      orden: desiredOrder
    };
  } else if (tabName === 'ubicaciones') {
    desiredOrder = _cfgNormalizeDesiredOrder(_cfgReadValue(`${prefix}-order`, String(fallbackIndex + 1)), fallbackIndex + 1, Math.max(listLength, 1));
    newItem = {
      nombre: normalizedName,
      isPlazaFija: document.getElementById(`${prefix}-is-plaza`)?.checked === true,
      plazaId: _cfgReadValue(`${prefix}-plaza`, 'ALL').toUpperCase() || 'ALL',
      orden: desiredOrder
    };
  } else if (tabName === 'categorias') {
    desiredOrder = _cfgNormalizeDesiredOrder(_cfgReadValue(`${prefix}-order`, String(fallbackIndex + 1)), fallbackIndex + 1, Math.max(listLength, 1));
    newItem = {
      nombre: normalizedName,
      descripcion: _cfgReadValue(`${prefix}-description`),
      orden: desiredOrder
    };
  } else if (tabName === 'modelos') {
    desiredOrder = _cfgNormalizeDesiredOrder(_cfgReadValue(`${prefix}-order`, String(fallbackIndex + 1)), fallbackIndex + 1, Math.max(listLength, 1));
    newItem = {
      nombre: normalizedName,
      categoria: _cfgReadValue(`${prefix}-modelo-cat`).toUpperCase(),
      orden: desiredOrder
    };
    const imageUrl = _cfgReadValue(`${prefix}-modelo-img`);
    if (imageUrl) newItem.imagenURL = imageUrl;
  } else {
    newItem = normalizedName;
  }

  return { normalizedName, desiredOrder, newItem };
}

async function _cfgSaveInlineEdit() {
  if (_cfgCatalogEditIndex === null || _cfgCatalogEditIndex < 0) return;
  const lista = window.MEX_CONFIG?.listas?.[TAB_ACTIVA_CFG];
  if (!Array.isArray(lista)) return;
  const payload = _cfgBuildCatalogPayload('cfg-inline', TAB_ACTIVA_CFG, lista.length, _cfgCatalogEditIndex);
  if (!payload) return;

  const duplicated = lista.some((entry, idx) => {
    if (idx === _cfgCatalogEditIndex) return false;
    return _cfgCatalogDisplayValue(TAB_ACTIVA_CFG, entry) === payload.normalizedName;
  });
  if (duplicated) {
    showToast(`"${payload.normalizedName}" ya existe.`, 'error');
    return;
  }

  lista[_cfgCatalogEditIndex] = payload.newItem;
  _cfgMoveCatalogItem(lista, _cfgCatalogEditIndex, payload.desiredOrder, TAB_ACTIVA_CFG);
  _cfgCatalogSelectedIndex = Math.max(0, lista.findIndex(entry => _cfgCatalogDisplayValue(TAB_ACTIVA_CFG, entry) === payload.normalizedName));
  _cfgCatalogEditIndex = null;
  renderizarListaConfig();
  await _persistListAdminAction(
    'CATALOGO_EDITADO',
    `Actualizó ${payload.normalizedName} en ${TAB_ACTIVA_CFG}`,
    'Elemento actualizado.',
    { entidad: TAB_ACTIVA_CFG, referencia: payload.normalizedName }
  );
}

function editarElementoConfig(index) {
  _cfgStartInlineEdit(index);
}

async function confirmarAgregadoConfig() {
  window.MEX_CONFIG.listas[TAB_ACTIVA_CFG] = window.MEX_CONFIG.listas[TAB_ACTIVA_CFG] || [];
  const lista = window.MEX_CONFIG.listas[TAB_ACTIVA_CFG];
  const editIndex = parseInt(document.getElementById('cfg-add-name').dataset.editIndex, 10);
  const payload = _cfgBuildCatalogPayload('cfg-add', TAB_ACTIVA_CFG, lista.length + (editIndex > -1 ? 0 : 1), editIndex > -1 ? editIndex : lista.length);
  if (!payload) return;

  const existe = lista.some((i, idx) => {
    if (idx === editIndex) return false; // ignore self
    return _cfgCatalogDisplayValue(TAB_ACTIVA_CFG, i) === payload.normalizedName;
  });
  if (existe) { showToast(`"${payload.normalizedName}" ya existe`, "error"); return; }

  if (editIndex > -1) {
    lista[editIndex] = payload.newItem;
    _cfgMoveCatalogItem(lista, editIndex, payload.desiredOrder, TAB_ACTIVA_CFG);
  } else {
    lista.push(payload.newItem);
    _cfgMoveCatalogItem(lista, lista.length - 1, payload.desiredOrder, TAB_ACTIVA_CFG);
  }

  _cfgCatalogSelectedIndex = Math.max(0, lista.findIndex(entry => _cfgCatalogDisplayValue(TAB_ACTIVA_CFG, entry) === payload.normalizedName));
  document.getElementById('modal-cfg-add').style.display = 'none';
  renderizarListaConfig();
  await _persistListAdminAction(
    editIndex > -1 ? 'CATALOGO_EDITADO' : 'CATALOGO_CREADO',
    `${editIndex > -1 ? 'Actualizó' : 'Agregó'} ${payload.normalizedName} en ${TAB_ACTIVA_CFG}`,
    editIndex > -1 ? 'Elemento actualizado.' : 'Elemento agregado.',
    { entidad: TAB_ACTIVA_CFG, referencia: payload.normalizedName }
  );
}

function moverElementoConfig(index, dir) {
  const lista = window.MEX_CONFIG.listas[TAB_ACTIVA_CFG];
  if (index + dir < 0 || index + dir >= lista.length) return;
  const temp = lista[index];
  lista[index] = lista[index + dir];
  lista[index + dir] = temp;
  _cfgCatalogApplyOrder(lista, TAB_ACTIVA_CFG);
  _cfgCatalogSelectedIndex = index + dir;
  _cfgCatalogEditIndex = null;
  renderizarListaConfig();
  _persistListAdminAction(
    'CATALOGO_REORDENADO',
    `Reordenó elementos del catálogo ${TAB_ACTIVA_CFG}`,
    'Orden actualizado.',
    { entidad: TAB_ACTIVA_CFG, referencia: TAB_ACTIVA_CFG }
  );
}

function eliminarElementoConfig(index) {
  const item = window.MEX_CONFIG.listas[TAB_ACTIVA_CFG][index];
  const nombre = typeof item === 'object' ? (item.id || item.nombre) : item;
  mexConfirm(`Eliminar "${nombre}"`, '¿Estás seguro? Esta acción no se puede deshacer.', 'danger').then(ok => {
    if (!ok) return;
    window.MEX_CONFIG.listas[TAB_ACTIVA_CFG].splice(index, 1);
    _cfgCatalogApplyOrder(window.MEX_CONFIG.listas[TAB_ACTIVA_CFG], TAB_ACTIVA_CFG);
    _cfgCatalogEditIndex = null;
    if (_cfgCatalogSelectedIndex === index) {
      _cfgCatalogSelectedIndex = window.MEX_CONFIG.listas[TAB_ACTIVA_CFG][index] ? index : Math.max(0, index - 1);
    } else if (_cfgCatalogSelectedIndex > index) {
      _cfgCatalogSelectedIndex -= 1;
    }
    renderizarListaConfig();
    _persistListAdminAction(
      'CATALOGO_ELIMINADO',
      `Eliminó ${nombre} del catálogo ${TAB_ACTIVA_CFG}`,
      'Elemento eliminado.',
      { entidad: TAB_ACTIVA_CFG, referencia: nombre }
    );
  });
}

function _persistPlazaForAdminLists() {
  if (TAB_ACTIVA_CFG === 'ubicaciones') {
    const selectedPlaza = document.getElementById('cfg-ubi-plaza-filter')?.value || '';
    return _safeUpper(selectedPlaza || 'ALL');
  }
  return _safeUpper(_miPlaza());
}

async function _reloadConfigAfterAdminPersist() {
  try {
    if (typeof window.__mexInvalidateConfigCache === 'function') {
      window.__mexInvalidateConfigCache();
    }
    await inicializarConfiguracion();
    _syncEmpresaCorreosInternosState();
    _updateGlobalPlazaEmail();
    _refreshSecurityRoleCatalog();
  } catch (error) {
    console.warn('No se pudo refrescar la configuración tras guardar admin:', error);
  }
}

async function _persistEmpresaAdminAction(actionType, message, successMessage, extra = {}, options = {}) {
  const canSave = hasPermission('manage_system_settings')
    || canUseProgrammerConfig()
    || (options.allowManageUsers && (canManageUsers() || hasPermission('manage_roles_permissions')));
  if (!canSave) {
    showToast("Tu rol no puede publicar esta configuración.", "error");
    return false;
  }

  try {
    _syncEmpresaCorreosInternosState();
    await _captureAdminExactLocation({ force: true });
    await db.collection("configuracion").doc("empresa").set(window.MEX_CONFIG.empresa, { merge: true });
    await api.garantizarPlazasOperativas(window.MEX_CONFIG?.empresa?.plazas || []);
    await registrarEventoGestion(actionType, message, extra);
    await _reloadConfigAfterAdminPersist();
    if (document.getElementById('modal-config-global')?.classList.contains('active')) {
      renderizarListaConfig();
      if (TAB_ACTIVA_CFG === 'plazas' && _plazaSeleccionadaCfg) plazaSeleccionarCfg(_plazaSeleccionadaCfg);
    }
    showToast(successMessage, 'success');
    return true;
  } catch (error) {
    await _reloadConfigAfterAdminPersist();
    showToast(`Error al guardar: ${error.message}`, 'error');
    return false;
  }
}

async function _persistSecurityAdminAction(actionType, message, successMessage, extra = {}) {
  return _persistEmpresaAdminAction(
    actionType,
    message,
    successMessage,
    { entidad: 'ROLES', referencia: _cfgEnsureRoleSelection(), ...extra },
    { allowManageUsers: true }
  );
}

async function _persistListAdminAction(actionType, message, successMessage, extra = {}) {
  if (!hasPermission('manage_system_settings') && !canUseProgrammerConfig()) {
    showToast("Tu rol no puede publicar esta configuración.", "error");
    return false;
  }
  try {
    await _captureAdminExactLocation({ force: true });
    await api.guardarConfiguracionListas(window.MEX_CONFIG.listas, USER_NAME, _persistPlazaForAdminLists());
    await registrarEventoGestion(actionType, message, {
      entidad: 'CONFIGURACION_LISTAS',
      referencia: TAB_ACTIVA_CFG || 'GLOBAL',
      resultado: 'OK',
      ...extra
    });
    await _reloadConfigAfterAdminPersist();
    renderizarListaConfig();
    showToast(successMessage, 'success');
    return true;
  } catch (error) {
    await _reloadConfigAfterAdminPersist();
    showToast(`Error al guardar: ${error.message}`, 'error');
    return false;
  }
}

async function guardarConfiguracionEnFirebase() {
  const canSaveRoles = TAB_ACTIVA_CFG === 'roles' && (hasPermission('manage_roles_permissions') || canUseProgrammerConfig());
  if (!canSaveRoles && !hasPermission('manage_system_settings') && !canUseProgrammerConfig()) {
    showToast("Tu rol no puede publicar esta configuración.", "error");
    return;
  }
  try {
    await _captureAdminExactLocation({ force: true });
    _ensureSecurityConfig();
    _syncEmpresaCorreosInternosState();
    await db.collection("configuracion").doc("empresa").set(window.MEX_CONFIG.empresa, { merge: true });
    await api.garantizarPlazasOperativas(window.MEX_CONFIG?.empresa?.plazas || []);
    await api.guardarConfiguracionListas(window.MEX_CONFIG.listas, USER_NAME, _persistPlazaForAdminLists());
    await registrarEventoGestion('CONFIG_GLOBAL', 'Publicó manualmente la configuración administrativa', {
      entidad: 'CONFIGURACION',
      referencia: TAB_ACTIVA_CFG || 'GLOBAL',
      resultado: 'OK'
    });
    await _reloadConfigAfterAdminPersist();
    _refreshSecurityRoleCatalog();
    renderizarListaConfig();
    if (TAB_ACTIVA_CFG === 'plazas' && _plazaSeleccionadaCfg) plazaSeleccionarCfg(_plazaSeleccionadaCfg);
    showToast("Configuración actualizada", "success");
    if (!_isGestionAdminMode()) document.getElementById('modal-config-global').classList.remove('active');
  } catch (error) {
    await _reloadConfigAfterAdminPersist();
    showToast("Error al guardar: " + error.message, "error");
  }
}

async function guardarEmpresaConfig(actionType = 'EMPRESA_ACTUALIZADA', message = 'Actualizó la configuración de empresa', successMessage = 'Empresa actualizada.', extra = {}) {
  _syncEmpresaCorreosInternosState();
  return _persistEmpresaAdminAction(
    actionType,
    message,
    successMessage,
    { entidad: 'EMPRESA', referencia: 'empresa', ...extra }
  );
}

// ─── LÓGICA DE USUARIOS EN CONFIGURACIÓN ──────────────────────
function renderizarTabConfigUsuarios(container) {
  container.innerHTML = `
        <div class="um-workspace um-workspace-lite">
          <div class="um-body um-workspace-shell um-workspace-shell-lite">
            <div class="um-list-col">
              <div class="um-column-head um-column-head-lite">
                <div>
                  <span class="um-column-kicker">Directorio</span>
                </div>
                <span id="um-directory-count" class="cfg-catalog-count">0 visibles</span>
              </div>

              <div class="um-list-toolbar">
                <div class="um-search-wrap">
                  <span class="material-icons um-search-icon">search</span>
                  <input type="text" id="um-search" placeholder="Buscar por nombre, correo o rol..." oninput="umFiltrar()">
                </div>
                <div id="um-plaza-chips" class="um-filter-row"></div>
              </div>

              <div id="um-cards-container" class="um-cards-stack">
                <div class="um-loading"><span class="material-icons spinner" style="vertical-align:middle;">sync</span> Cargando usuarios...</div>
              </div>
            </div>

            <div class="um-edit-col">
              <div class="um-column-head um-column-head-lite">
                <div>
                  <span class="um-column-kicker">Editor contextual</span>
                  <h4>Perfil, alcance y permisos</h4>
                  <p>Todo el cambio importante vive aquí: identidad, rol, plaza y permisos puntuales.</p>
                </div>
                <div class="um-column-actions">
                  <button id="btn-nuevo-usuario" type="button" class="um-toolbar-btn primary" onclick="_umNuevoUsuarioConAnim()" ${canManageUsers() ? '' : 'style="display:none;"'}>
                    <span class="material-icons">person_add</span>
                    Nuevo usuario
                  </button>
                </div>
              </div>

              <div class="um-editor-stage">
                <div id="um-placeholder" class="um-placeholder">
                  <span class="material-icons">manage_accounts</span>
                  <h5>Selecciona un usuario</h5>
                  <p>Desde aquí podrás editar identidad, rol, plaza base, alcance multi-plaza y permisos individuales sin salir de la misma pantalla.</p>
                </div>
                <div id="um-form-container" class="um-form-container" style="display:none;"></div>
              </div>
            </div>
          </div>
        </div>
      `;
  _umRenderPlazaChips();
  _umIniciar();
}

// Variable para el filtro de plaza activo en usuarios
let _umPlazaFiltro = null;

function _umRenderPlazaChips() {
  const wrap = document.getElementById('um-plaza-chips');
  if (!wrap) return;
  const plazas = _umGetPlazasDisponibles();
  if (plazas.length === 0) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = plazas.map(p => {
    const active = _umPlazaFiltro === p;
    return `<button type="button" class="um-filter-chip${active ? ' active' : ''}" onclick="_umTogglePlazaChip('${escapeHtml(p)}')">${p}</button>`;
  }).join('');
}

function _umTogglePlazaChip(plaza) {
  _umPlazaFiltro = _umPlazaFiltro === plaza ? null : plaza;
  _umRenderPlazaChips();
  _umRenderCards();
}

function _umGoToConfigTab(tabName) {
  const btn = document.getElementById(`cfg-tab-${tabName}`) || document.querySelector(`.cfg-tab[onclick*="'${tabName}'"]`);
  abrirTabConfig(tabName, btn);
}

function _umGetOperatorProfileSummary() {
  const profile = (typeof currentUserProfile !== 'undefined' && currentUserProfile) ? currentUserProfile : {};
  const operatorName = profile.nombre || profile.email || 'Operador activo';
  const operatorRole = (typeof userAccessRole !== 'undefined' && userAccessRole) ? userAccessRole : (profile.rol || 'AUXILIAR');
  const roleBadge = _umRoleBadge(operatorRole);
  const plazaActiva = (typeof _miPlaza === 'function' ? _normalizePlaza(_miPlaza()) : '')
    || _normalizePlaza(profile.plazaAsignada || '')
    || 'GLOBAL';
  return {
    operatorName,
    roleLabel: roleBadge.label,
    plazaActiva
  };
}

function _umGetFilteredUsers() {
  const q = (document.getElementById('um-search')?.value || '').toLowerCase().trim();
  let list = _umUsers.slice();

  if (q) {
    list = list.filter(u =>
      u.nombre.toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (_umRoleBadge(u.rol).label || '').toLowerCase().includes(q)
    );
  }

  if (_umPlazaFiltro) {
    list = list.filter(u => (u.plazaAsignada || '').toUpperCase() === _umPlazaFiltro);
  }

  return list;
}

function _umRenderWorkspaceInsights(list = _umGetFilteredUsers()) {
  const summary = document.getElementById('um-summary-strip');
  const countBadge = document.getElementById('um-directory-count');
  if (countBadge) countBadge.textContent = `${list.length} visibles`;
  if (!summary) return;

  const total = _umUsers.length;
  const filtered = Boolean((document.getElementById('um-search')?.value || '').trim() || _umPlazaFiltro);
  const adminCount = list.filter(u => {
    const meta = ROLE_META[_sanitizeRole(u.rol) || 'AUXILIAR'] || {};
    return !!(meta.isAdmin || meta.fullAccess);
  }).length;
  const noPlazaCount = list.filter(u => !_normalizePlaza(u.plazaAsignada || '')).length;
  const plazaCoverage = new Set(list.map(u => _normalizePlaza(u.plazaAsignada || '')).filter(Boolean)).size;
  const cards = [
    {
      label: 'Usuarios visibles',
      value: list.length,
      detail: filtered ? `Filtrados desde ${total} registros` : 'Directorio listo para operar',
      tone: 'primary',
      icon: 'groups'
    },
    {
      label: 'Acceso sensible',
      value: adminCount,
      detail: adminCount > 0 ? 'Perfiles con permisos elevados' : 'Sin perfiles elevados en este filtro',
      tone: 'info',
      icon: 'shield'
    },
    {
      label: 'Sin plaza base',
      value: noPlazaCount,
      detail: noPlazaCount > 0 ? 'Conviene revisar alcance y asignación' : 'Todas las cuentas visibles tienen plaza',
      tone: noPlazaCount > 0 ? 'warning' : 'success',
      icon: 'apartment'
    },
    {
      label: 'Plazas cubiertas',
      value: plazaCoverage,
      detail: plazaCoverage > 0 ? 'Cobertura operativa en el directorio visible' : 'Aún sin cobertura por plaza',
      tone: 'neutral',
      icon: 'location_city'
    }
  ];

  summary.innerHTML = cards.map(card => `
      <article class="um-stat-card ${card.tone}">
        <div class="um-stat-icon">
          <span class="material-icons">${card.icon}</span>
        </div>
        <div class="um-stat-copy">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(String(card.value))}</strong>
          <small>${escapeHtml(card.detail)}</small>
        </div>
      </article>
    `).join('');
}

// Botón "Nuevo Usuario" con animación de carga antes de abrir el form
function _umNuevoUsuarioConAnim() {
  const btn = document.getElementById('btn-nuevo-usuario');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons spinner" style="font-size:17px;">sync</span> Preparando...';
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons" style="font-size:17px;">person_add</span> NUEVO USUARIO';
      umNuevoUsuario();
    }, 600);
  } else {
    umNuevoUsuario();
  }
}

// ─── LÓGICA DE SOLICITUDES EN CONFIGURACIÓN ──────────────────────
function renderizarTabConfigSolicitudes(container) {
  if (!canViewAdminRequests()) {
    container.innerHTML = '<div style="padding:28px; text-align:center; color:#ef4444; font-weight:800;">Sin permiso para abrir solicitudes.</div>';
    return;
  }
  const readOnlyNotice = canProcessAccessRequests()
    ? ''
    : `<div style="padding:12px 15px;border-bottom:1px solid #e2e8f0;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:800;line-height:1.5;">
         Vista en solo lectura. Puedes revisar solicitudes, pero no aprobar ni rechazar sin un permiso explícito de procesamiento.
       </div>`;
  container.innerHTML = `
         <div style="background:white; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden; display:flex; flex-direction:column; height: 100%; min-height: 60vh; margin: 0 10px;">
            <div style="display:flex; border-bottom:1px solid #e2e8f0; background:#f8fafc;">
               <button id="tab-sol-PENDIENTE" class="sol-tab active" onclick="cambiarTabSolicitudes('PENDIENTE')" style="flex:1; padding:12px; font-weight:800; font-size:12px; color:var(--mex-blue); border:none; background:transparent; border-bottom:2px solid var(--mex-blue); cursor:pointer;">PENDIENTES</button>
               <button id="tab-sol-APROBADO" class="sol-tab" onclick="cambiarTabSolicitudes('APROBADO')" style="flex:1; padding:12px; font-weight:800; font-size:12px; color:#64748b; border:none; background:transparent; border-bottom:2px solid transparent; cursor:pointer;">APROBADAS</button>
               <button id="tab-sol-RECHAZADO" class="sol-tab" onclick="cambiarTabSolicitudes('RECHAZADO')" style="flex:1; padding:12px; font-weight:800; font-size:12px; color:#64748b; border:none; background:transparent; border-bottom:2px solid transparent; cursor:pointer;">RECHAZADAS</button>
            </div>
            ${readOnlyNotice}
            <div style="padding:15px; border-bottom:1px solid #e2e8f0;">
               <div style="position:relative; width:100%;">
                  <span class="material-icons" style="position:absolute; left:12px; top:10px; color:#94a3b8; font-size:18px;">search</span>
                  <input type="text" id="busqueda-solicitudes" placeholder="Buscar por nombre, correo, rol o puesto..." oninput="filtrarSolicitudesActuales()" style="width:100%; padding:10px 10px 10px 36px; border:1px solid #cbd5e1; border-radius:8px; font-family:inherit; outline:none; box-sizing:border-box;">
               </div>
            </div>
            <div id="contenedor-solicitudes-v2" style="padding:15px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:10px;">
               <div style="text-align:center; padding: 30px;"><span class="material-icons spinner" style="font-size:30px; color:var(--mex-blue);">sync</span></div>
            </div>
         </div>
       `;
  cambiarTabSolicitudes('PENDIENTE');
}

// ─── LÓGICA DE PLAZAS EN CONFIGURACIÓN ──────────────────────
let _plazaSeleccionadaCfg = null;

function renderizarTabConfigPlazas(container) {
  const emp = window.MEX_CONFIG.empresa || {};
  const plazas = emp.plazas || [];

  const editColHtml = _plazaSeleccionadaCfg
    ? _renderPlazaForm(_plazaSeleccionadaCfg)
    : `<div class="cfg-plaza-placeholder">
             <span class="material-icons">location_city</span>
             <p>Selecciona una plaza para<br>configurar sus detalles.</p>
           </div>`;

  container.innerHTML = `
        <div style="margin-bottom:8px; padding:0 10px; display:flex; gap:8px; align-items:center;">
          <div style="flex:1; display:flex; align-items:center; gap:8px; background:#f1f5f9; border-radius:10px; padding:8px 12px;">
            <span class="material-icons" style="color:#94a3b8; font-size:17px;">search</span>
            <input type="text" id="cfg-plaza-search" placeholder="Buscar plaza..."
              style="flex:1; border:none; background:transparent; font-size:13px; font-weight:600; outline:none; color:#334155;"
              oninput="_filtrarPlazasCfg()">
          </div>
          <button onclick="_abrirModalNuevaplaza()"
            style="background:var(--mex-blue);color:white;border:none;border-radius:10px;padding:9px 16px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px;">
            <span class="material-icons" style="font-size:16px;">add_location_alt</span> NUEVA
          </button>
          <button onclick="abrirComparadorPlazas()"
            title="Comparar KPIs entre plazas"
            style="background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:5px;">
            <span class="material-icons" style="font-size:16px;">compare</span> COMPARAR
          </button>
        </div>
        <div class="cfg-plazas-body">
          <div class="cfg-plazas-list-col">
            <div class="cfg-plazas-cards" id="cfg-plazas-cards">
              ${plazas.length === 0
      ? '<div style="padding:20px; text-align:center; color:#94a3b8; font-size:12px; font-weight:700;">No hay plazas.<br>Pulsa NUEVA para agregar.</div>'
      : _renderPlazaCards(plazas)
    }
            </div>
          </div>
          <div class="cfg-plazas-edit-col" id="cfg-plaza-edit-col">
            ${editColHtml}
          </div>
        </div>
      `;
}

function _renderPlazaCards(plazas, filter) {
  const plazasDetalle = (window.MEX_CONFIG.empresa || {}).plazasDetalle || [];
  const filterUp = (filter || '').toUpperCase().trim();
  const filtered = filterUp ? plazas.filter(p => p.includes(filterUp)) : plazas;
  if (filtered.length === 0) {
    return '<div style="padding:20px; text-align:center; color:#94a3b8; font-size:12px; font-weight:700;">Sin resultados.</div>';
  }
  return filtered.map(plazaId => {
    const detalle = plazasDetalle.find(d => d.id === plazaId) || {};
    const isActive = _plazaSeleccionadaCfg === plazaId ? ' active' : '';
    const sub = escapeHtml(detalle.descripcion || detalle.nombre || detalle.localidad || 'Sin configurar');
    const tempBadge = detalle.temporal
      ? `<span style="font-size:9px; background:#f59e0b; color:white; padding:2px 5px; border-radius:4px; font-weight:800; margin-top:2px; display:inline-block;">TEMPORAL</span>`
      : '';
    return `
          <div class="cfg-plaza-card${isActive}" onclick="plazaSeleccionarCfg('${escapeHtml(plazaId)}')">
            <div class="cfg-plaza-icon" style="${detalle.temporal ? 'background:#f59e0b;' : ''}">${escapeHtml(plazaId.slice(0, 3))}</div>
            <div class="cfg-plaza-info">
              <div class="cfg-plaza-name">${escapeHtml(plazaId)}</div>
              <div class="cfg-plaza-local">${sub}</div>
              ${tempBadge}
            </div>
          </div>
        `;
  }).join('');
}

function _togglePlazaAddRow() { _abrirModalNuevaplaza(); } // legacy alias

function _abrirModalNuevaplaza() {
  const m = document.getElementById('modal-nueva-plaza');
  if (!m) return;
  document.getElementById('nueva-plaza-id').value = '';
  document.getElementById('nueva-plaza-nombre').value = '';
  document.getElementById('nueva-plaza-descripcion').value = '';
  m.style.display = 'flex';
  const card = m.querySelector('.cfg-add-card');
  if (card) { card.style.animation = 'none'; card.offsetHeight; card.style.animation = ''; }
  setTimeout(() => document.getElementById('nueva-plaza-id')?.focus(), 100);
}

function _cerrarModalNuevaplaza() {
  const m = document.getElementById('modal-nueva-plaza');
  if (m) m.style.display = 'none';
}

async function _confirmarNuevaplaza() {
  const idInp = document.getElementById('nueva-plaza-id');
  const nomInp = document.getElementById('nueva-plaza-nombre');
  const descInp = document.getElementById('nueva-plaza-descripcion');
  const p = (idInp?.value || '').trim().toUpperCase();
  if (!p) { showToast('Escribe una clave para la plaza (ej: GDL)', 'error'); idInp?.focus(); return; }
  const emp = window.MEX_CONFIG.empresa = window.MEX_CONFIG.empresa || {};
  emp.plazas = emp.plazas || [];
  if (emp.plazas.includes(p)) { showToast('Esa plaza ya existe', 'error'); idInp?.focus(); return; }
  emp.plazas.push(p);
  // Pre-populate detalle
  emp.plazasDetalle = emp.plazasDetalle || [];
  emp.plazasDetalle.push({
    id: p,
    nombre: (nomInp?.value || '').trim(),
    descripcion: (descInp?.value || '').trim(),
  });
  _cerrarModalNuevaplaza();
  _plazaSeleccionadaCfg = p;
  _plazaFormLocked = false; // open in edit mode since just created
  renderizarListaConfig();
  setTimeout(() => plazaSeleccionarCfg(p), 50);
  await _persistEmpresaAdminAction(
    'PLAZA_CREADA',
    `Creó la plaza ${p}`,
    `Plaza "${p}" creada.`,
    { entidad: 'PLAZAS', referencia: p }
  );
}

function _filtrarPlazasCfg() {
  const inp = document.getElementById('cfg-plaza-search');
  const filter = inp ? inp.value : '';
  const plazas = (window.MEX_CONFIG.empresa || {}).plazas || [];
  const cards = document.getElementById('cfg-plazas-cards');
  if (cards) cards.innerHTML = plazas.length === 0
    ? '<div style="padding:20px; text-align:center; color:#94a3b8; font-size:12px; font-weight:700;">No hay plazas.</div>'
    : _renderPlazaCards(plazas, filter);
}

let _plazaFormLocked = true;

// [F3.1] Toggle plaza temporal
function _togglePlazaTemporal() {
  const hidden = document.getElementById('plaza-temporal-val');
  const toggle = document.getElementById('plaza-temporal-toggle');
  if (!hidden || !toggle) return;
  const isOn = hidden.value === '1';
  const newVal = !isOn;
  hidden.value = newVal ? '1' : '0';
  toggle.style.background = newVal ? '#f59e0b' : '#cbd5e1';
  const knob = toggle.querySelector('div');
  if (knob) knob.style.left = newVal ? '19px' : '3px';
}

function _togglePlazaFormEdit() {
  _plazaFormLocked = !_plazaFormLocked;
  const card = document.querySelector('.cfg-plaza-form-card');
  if (!card) return;
  card.classList.toggle('plaza-locked', _plazaFormLocked);
  const btn = document.getElementById('plaza-edit-toggle-btn');
  if (btn) {
    btn.innerHTML = `<span class="material-icons">${_plazaFormLocked ? 'edit' : 'lock'}</span>`;
    btn.title = _plazaFormLocked ? 'Editar plaza' : 'Bloquear edición';
    btn.className = `cfg-plaza-header-btn${_plazaFormLocked ? '' : ' active'}`;
  }
}

function _plazaConfirmMaps() {
  const q = (document.getElementById('plaza-maps-url')?.value || '').trim();
  if (!q) return;
  const preview = document.getElementById('plaza-maps-preview');
  const iframe = document.getElementById('plaza-maps-iframe');
  if (!preview || !iframe) return;
  iframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
  preview.classList.remove('hidden');
}

function _plazaGetUserEmailOptions(selectedVal, currentPlazaId, fieldName = 'correo', plazaData = {}) {
  const currentPlaza = _safeUpper(currentPlazaId);
  const currentValue = _safeLower(selectedVal);
  const correosInternos = _syncEmpresaCorreosInternosState();
  const counterpartValue = _safeLower(fieldName === 'correo' ? plazaData?.correoGerente : plazaData?.correo);

  const disponibles = correosInternos
    .filter(item => {
      const correo = _safeLower(item?.correo);
      const plazaId = _safeUpper(item?.plazaId);
      if (!correo) return false;
      if (currentValue && correo === currentValue) return true;
      if (counterpartValue && correo === counterpartValue) return false;
      return !plazaId || plazaId === currentPlaza;
    })
    .sort((a, b) => String(a?.correo || '').localeCompare(String(b?.correo || ''), 'es'));

  const optionItems = [...disponibles];
  if (currentValue && !optionItems.some(item => _safeLower(item?.correo) === currentValue)) {
    optionItems.unshift({
      titulo: fieldName === 'correoGerente' ? `${currentPlaza} GERENCIA` : `${currentPlaza} INSTITUCIONAL`,
      correo: currentValue,
      plazaId: currentPlaza
    });
  }

  if (optionItems.length === 0) {
    return `<option value="">— Sin correos disponibles —</option>`;
  }

  return `<option value="">— Sin asignar —</option>` + optionItems.map(item => {
    const correo = _safeLower(item?.correo);
    const titulo = String(item?.titulo || '').trim();
    const assigned = _safeUpper(item?.plazaId);
    const suffix = assigned && assigned !== currentPlaza ? ` · ${assigned}` : '';
    const label = titulo ? `${titulo} · ${correo}${suffix}` : `${correo}${suffix}`;
    return `<option value="${escapeHtml(correo)}"${correo === currentValue ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function _reassignCorreoCatalogForPlaza(plazaId, correoInstitucional = '', correoGerente = '') {
  const currentPlaza = _safeUpper(plazaId);
  const selected = new Set([_safeLower(correoInstitucional), _safeLower(correoGerente)].filter(Boolean));
  const catalog = _syncEmpresaCorreosInternosState();

  catalog.forEach(item => {
    const correo = _safeLower(item?.correo);
    const assigned = _safeUpper(item?.plazaId);
    if (!correo) return;
    if (assigned === currentPlaza && !selected.has(correo)) {
      item.plazaId = '';
    }
    if (selected.has(correo)) {
      item.plazaId = currentPlaza;
    }
  });

  selected.forEach(correo => {
    if (catalog.some(item => _safeLower(item?.correo) === correo)) return;
    catalog.push({
      titulo: correo === _safeLower(correoGerente) ? `${currentPlaza} GERENCIA` : `${currentPlaza} INSTITUCIONAL`,
      correo,
      plazaId: currentPlaza
    });
  });

  window.MEX_CONFIG.empresa.correosInternos = catalog;
}

function _releaseCorreoCatalogForPlaza(plazaId = '') {
  const currentPlaza = _safeUpper(plazaId);
  const catalog = _syncEmpresaCorreosInternosState();
  catalog.forEach(item => {
    if (_safeUpper(item?.plazaId) === currentPlaza) item.plazaId = '';
  });
  window.MEX_CONFIG.empresa.correosInternos = catalog;
}

function _renderPlazaForm(plazaId) {
  const emp = window.MEX_CONFIG.empresa || {};
  const plazasDetalle = emp.plazasDetalle || [];
  const d = plazasDetalle.find(x => x.id === plazaId) || {};
  const contactos = Array.isArray(d.contactos) ? d.contactos : [];
  const locked = _plazaFormLocked;

  const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#f97316', '#ec4899'];
  function _initials(n) {
    if (!n) return '?';
    const p = n.trim().split(/\s+/);
    return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : n.slice(0, 2).toUpperCase();
  }

  const contactosHtml = contactos.length > 0
    ? contactos.map((c, ci) => {
      const color = AVATAR_COLORS[ci % AVATAR_COLORS.length];
      return `
            <div class="plaza-contact-chip" id="plaza-contact-${ci}" onclick="_toggleContactExpand(${ci})">
              <div class="plaza-cnt-avatar" style="background:${color}">${_initials(c.nombre)}</div>
              <div class="plaza-contact-chip-info">
                <div class="plaza-contact-chip-name">${escapeHtml(c.nombre || 'Sin nombre')}</div>
                ${c.rol ? `<span class="plaza-contact-chip-role">${escapeHtml(c.rol)}</span>` : ''}
              </div>
              <span class="material-icons plaza-contact-chip-arrow">expand_more</span>
            </div>
            <div class="plaza-contact-expanded" id="plaza-cnt-detail-${ci}" style="display:none;">
              <div class="plaza-cnt-fields">
                <input type="text" class="plaza-cnt-nombre" value="${escapeHtml(c.nombre || '')}" placeholder="Nombre completo">
                <div class="plaza-cnt-row2">
                  <input type="text" class="plaza-cnt-rol" value="${escapeHtml(c.rol || '')}" placeholder="Puesto / Rol">
                  <input type="tel" class="plaza-cnt-tel" value="${escapeHtml(c.telefono || '')}" placeholder="Teléfono">
                </div>
              </div>
              <button class="plaza-cnt-del" onclick="event.stopPropagation(); _plazaRemoveContact(${ci})" title="Eliminar">
                <span class="material-icons">delete_outline</span>
              </button>
            </div>`;
    }).join('')
    : `<div id="plaza-contacts-empty" class="plaza-contacts-empty">
             <span class="material-icons">contacts</span>
             <span>Sin contactos registrados</span>
           </div>`;

  const mapsEmbedUrl = d.mapsUrl
    ? `https://maps.google.com/maps?q=${encodeURIComponent(d.mapsUrl)}&output=embed`
    : '';
  const heroSub = escapeHtml(d.descripcion || d.nombre || 'Descripción de la plaza');

  return `
        <div class="cfg-plaza-form-card${locked ? ' plaza-locked' : ''}">

          <!-- ── Hero ── -->
          <div class="cfg-plaza-form-hero">
            <div class="cfg-plaza-form-hero-badge">${escapeHtml(plazaId.slice(0, 3))}</div>
            <div class="cfg-plaza-form-hero-info">
              <div class="cfg-plaza-form-hero-name" id="plaza-hero-title">${escapeHtml(plazaId)}</div>
              <div class="cfg-plaza-form-hero-sub" id="plaza-hero-sub">${heroSub}</div>
            </div>
            <button id="plaza-edit-toggle-btn"
              class="cfg-plaza-header-btn${locked ? '' : ' active'}"
              onclick="_togglePlazaFormEdit()"
              title="${locked ? 'Editar plaza' : 'Bloquear edición'}">
              <span class="material-icons">${locked ? 'edit' : 'lock'}</span>
            </button>
          </div>

          <!-- ── Tipo de Plaza ── -->
          <div class="cfg-plaza-section-header">
            <span class="material-icons">info_outline</span> Tipo de Plaza
          </div>
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px; padding:12px 14px; background:#f8fafc; border-radius:10px; border:1.5px solid #e2e8f0;">
            <label class="cfg-toggle-wrap" style="display:flex; align-items:center; gap:10px; cursor:pointer; flex:1;">
              <div class="cfg-toggle${d.temporal ? ' on' : ''}" id="plaza-temporal-toggle" onclick="_togglePlazaTemporal()" style="width:38px; height:21px; border-radius:11px; background:${d.temporal ? '#f59e0b' : '#cbd5e1'}; position:relative; cursor:pointer; flex-shrink:0; transition:background .2s;">
                <div style="position:absolute; top:3px; left:${d.temporal ? '19px' : '3px'}; width:15px; height:15px; background:white; border-radius:50%; transition:left .2s; box-shadow:0 1px 3px rgba(0,0,0,.2);"></div>
              </div>
              <div>
                <div style="font-size:13px; font-weight:800; color:#0f172a;">Plaza Temporal</div>
                <div style="font-size:11px; color:#64748b; font-weight:600;">Resguardo externo, bodega o ubicación provisional</div>
              </div>
            </label>
            ${d.temporal ? `<span style="font-size:10px; background:#f59e0b; color:white; padding:3px 8px; border-radius:6px; font-weight:800; letter-spacing:.04em;">TEMPORAL</span>` : ''}
          </div>
          <input type="hidden" id="plaza-temporal-val" value="${d.temporal ? '1' : '0'}">

          <!-- ── Información General ── -->
          <div class="cfg-plaza-section-header">
            <span class="material-icons">edit_note</span> Información General
          </div>
          <div class="cfg-plaza-form-grid2">
            <div class="cfg-plaza-form-field">
              <label>Nombre oficial</label>
              <input type="text" id="plaza-nombre" value="${escapeHtml(d.nombre || '')}" placeholder="Ej: Hermosillo Centro"
                oninput="document.getElementById('plaza-hero-title').textContent=this.value||'${escapeHtml(plazaId)}'">
            </div>
            <div class="cfg-plaza-form-field">
              <label>Descripción (subtítulo)</label>
              <input type="text" id="plaza-descripcion" value="${escapeHtml(d.descripcion || '')}" placeholder="Ej: Sucursal del Bajío"
                oninput="document.getElementById('plaza-hero-sub').textContent=this.value||'Descripción de la plaza'">
            </div>
          </div>
          <div class="cfg-plaza-form-field">
            <label>Localidad</label>
            <input type="text" id="plaza-localidad" value="${escapeHtml(d.localidad || '')}" placeholder="Ej: Hermosillo, Sonora">
          </div>
          <div class="cfg-plaza-form-field">
            <label>Dirección completa</label>
            <input type="text" id="plaza-direccion" value="${escapeHtml(d.direccion || '')}" placeholder="Ej: Blvd. Rodríguez 123, Col. Centro">
          </div>

          <!-- ── Mapa ── -->
          <div class="cfg-plaza-section-header">
            <span class="material-icons">map</span> Ubicación en Mapa
          </div>
          <div class="cfg-plaza-form-field">
            <label>Dirección o coordenadas para Google Maps</label>
            <div class="cfg-plaza-maps-input-wrap">
              <span class="material-icons cfg-plaza-maps-pin">location_on</span>
              <input type="text" id="plaza-maps-url" value="${escapeHtml(d.mapsUrl || '')}"
                placeholder="Ej: 29.0924,-110.9600  o  nombre del lugar">
              <button class="cfg-plaza-maps-confirm-btn" onclick="_plazaConfirmMaps()" title="Confirmar ubicación en mapa">
                <span class="material-icons">task_alt</span>
              </button>
            </div>
          </div>
          <div id="plaza-maps-preview" class="cfg-plaza-maps-preview${mapsEmbedUrl ? '' : ' hidden'}">
            <iframe id="plaza-maps-iframe" src="${mapsEmbedUrl ? escapeHtml(mapsEmbedUrl) : ''}"
              loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>
          </div>

          <!-- ── Contacto de la plaza ── -->
          <div class="cfg-plaza-section-header">
            <span class="material-icons">phone_in_talk</span> Contacto de la Plaza
          </div>
          <div class="cfg-plaza-form-grid2">
            <div class="cfg-plaza-form-field">
              <label>Correo institucional</label>
              <div class="cfg-plaza-input-icon-wrap">
                <span class="material-icons">alternate_email</span>
                <select id="plaza-correo" class="cfg-plaza-select-correo">
                  ${_plazaGetUserEmailOptions(d.correo || '', plazaId, 'correo', d)}
                </select>
                <button type="button" class="cfg-copy-inline-btn" onclick="_copyPlazaCorreo('plaza-correo','Correo institucional')" title="Copiar correo institucional">
                  <span class="material-icons">content_copy</span>
                </button>
              </div>
            </div>
            <div class="cfg-plaza-form-field">
              <label>Teléfono directo</label>
              <div class="cfg-plaza-input-icon-wrap">
                <span class="material-icons">call</span>
                <input type="tel" id="plaza-telefono" value="${escapeHtml(d.telefono || '')}" placeholder="Ej: 6441234567">
              </div>
            </div>
          </div>

          <!-- ── Gerencia ── -->
          <div class="cfg-plaza-section-header">
            <span class="material-icons">manage_accounts</span> Gerencia
          </div>
          <div class="cfg-plaza-form-grid2">
            <div class="cfg-plaza-form-field">
              <label>Gerente de Plaza</label>
              <input type="text" id="plaza-gerente" value="${escapeHtml(d.gerente || '')}" placeholder="Nombre del gerente">
            </div>
            <div class="cfg-plaza-form-field">
              <label>Correo del Gerente</label>
              <div class="cfg-plaza-input-icon-wrap">
                <span class="material-icons">alternate_email</span>
                <select id="plaza-correo-gerente" class="cfg-plaza-select-correo">
                  ${_plazaGetUserEmailOptions(d.correoGerente || '', plazaId, 'correoGerente', d)}
                </select>
                <button type="button" class="cfg-copy-inline-btn" onclick="_copyPlazaCorreo('plaza-correo-gerente','Correo de gerencia')" title="Copiar correo gerencial">
                  <span class="material-icons">content_copy</span>
                </button>
              </div>
            </div>
          </div>

          <!-- ── Contactos Adicionales ── -->
          <div class="cfg-plaza-section-header" style="justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="material-icons">groups</span> Contactos
              <span class="plaza-cnt-count">${contactos.length}</span>
            </div>
            <button class="cfg-plaza-add-contact-btn" onclick="_plazaAddContact()">
              <span class="material-icons">person_add</span> Agregar
            </button>
          </div>
          <div class="cfg-plaza-contacts-hint">Haz clic en un nombre para ver y editar sus datos.</div>
          <div id="plaza-contacts-list" class="plaza-contacts-list">
            ${contactosHtml}
          </div>

          <!-- ── Guardar ── -->
          <button class="cfg-plaza-save-btn" onclick="plazaGuardarCfg('${escapeHtml(plazaId)}')">
            <span class="material-icons">save</span>
            Guardar Plaza
          </button>

          <!-- ── F6.1 Herramientas de estructura ── -->
          <div style="margin-top:14px; padding:12px 14px; background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:12px;">
            <div style="font-size:10px; font-weight:900; color:#94a3b8; text-transform:uppercase; letter-spacing:.06em; margin-bottom:10px;">Herramientas de Mapa</div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button onclick="abrirDuplicarEstructura('${escapeHtml(plazaId)}')"
                style="background:#fff; border:1.5px solid #e2e8f0; border-radius:8px; padding:7px 12px; font-size:11px; font-weight:800; cursor:pointer; color:#334155; display:flex; align-items:center; gap:5px;">
                <span class="material-icons" style="font-size:15px; color:#0284c7;">content_copy</span>
                Duplicar hacia...
              </button>
              <button onclick="abrirGuardarPlantilla('${escapeHtml(plazaId)}')"
                style="background:#fff; border:1.5px solid #e2e8f0; border-radius:8px; padding:7px 12px; font-size:11px; font-weight:800; cursor:pointer; color:#334155; display:flex; align-items:center; gap:5px;">
                <span class="material-icons" style="font-size:15px; color:#7c3aed;">bookmark_add</span>
                Guardar plantilla
              </button>
              <button onclick="abrirAplicarPlantilla('${escapeHtml(plazaId)}')"
                style="background:#fff; border:1.5px solid #e2e8f0; border-radius:8px; padding:7px 12px; font-size:11px; font-weight:800; cursor:pointer; color:#334155; display:flex; align-items:center; gap:5px;">
                <span class="material-icons" style="font-size:15px; color:#059669;">library_books</span>
                Aplicar plantilla
              </button>
            </div>
          </div>

          <!-- ── Zona de peligro ── -->
          <div class="cfg-plaza-danger-zone">
            <button class="cfg-plaza-danger-btn" onclick="eliminarPlazaCatalogo('${escapeHtml(plazaId)}')">
              <span class="material-icons">delete_forever</span>
              Eliminar Plaza
            </button>
          </div>

        </div>
      `;
}

function _toggleContactExpand(ci) {
  const detail = document.getElementById(`plaza-cnt-detail-${ci}`);
  const chip = document.getElementById(`plaza-contact-${ci}`);
  if (!detail) return;
  const open = detail.style.display !== 'none';
  detail.style.display = open ? 'none' : 'flex';
  const arrow = chip?.querySelector('.plaza-contact-chip-arrow');
  if (arrow) arrow.style.transform = open ? '' : 'rotate(180deg)';
}

function _plazaPreviewMaps() {
  const q = (document.getElementById('plaza-maps-url')?.value || document.getElementById('plaza-direccion')?.value || '').trim();
  const preview = document.getElementById('plaza-maps-preview');
  const iframe = document.getElementById('plaza-maps-iframe');
  if (!preview || !iframe) return;
  if (!q) { preview.style.display = 'none'; iframe.src = ''; return; }
  const url = `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
  iframe.src = url;
  preview.style.display = 'block';
}

function _plazaAddContact() {
  const list = document.getElementById('plaza-contacts-list');
  if (!list) return;
  const empty = document.getElementById('plaza-contacts-empty');
  if (empty) empty.remove();
  const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#f97316', '#ec4899'];
  // ci = total de contactos existentes (chips + details)
  const ci = list.querySelectorAll('.plaza-contact-chip').length;
  const color = AVATAR_COLORS[ci % AVATAR_COLORS.length];

  // Chip (collapsed summary)
  const chip = document.createElement('div');
  chip.className = 'plaza-contact-chip';
  chip.id = `plaza-contact-${ci}`;
  chip.onclick = () => _toggleContactExpand(ci);
  chip.innerHTML = `
        <div class="plaza-cnt-avatar" style="background:${color}">?</div>
        <div class="plaza-contact-chip-info">
          <div class="plaza-contact-chip-name plaza-chip-live-name">Nuevo contacto</div>
        </div>
        <span class="material-icons plaza-contact-chip-arrow" style="transform:rotate(180deg)">expand_more</span>`;

  // Detail (expanded edit)
  const detail = document.createElement('div');
  detail.className = 'plaza-contact-expanded';
  detail.id = `plaza-cnt-detail-${ci}`;
  detail.style.display = 'flex';
  detail.innerHTML = `
        <div class="plaza-cnt-fields">
          <input type="text" class="plaza-cnt-nombre" placeholder="Nombre completo"
            oninput="const av=document.querySelector('#plaza-contact-${ci} .plaza-cnt-avatar'); const ln=document.querySelector('#plaza-contact-${ci} .plaza-chip-live-name'); const p=this.value.trim().split(/\\s+/); if(av) av.textContent=p.length>=2?(p[0][0]+p[1][0]).toUpperCase():(this.value.slice(0,2).toUpperCase()||'?'); if(ln) ln.textContent=this.value||'Nuevo contacto';">
          <div class="plaza-cnt-row2">
            <input type="text" class="plaza-cnt-rol" placeholder="Puesto / Rol">
            <input type="tel" class="plaza-cnt-tel" placeholder="Teléfono">
          </div>
        </div>
        <button class="plaza-cnt-del" onclick="event.stopPropagation(); this.closest('.plaza-contact-expanded').previousElementSibling.remove(); this.closest('.plaza-contact-expanded').remove();" title="Eliminar contacto">
          <span class="material-icons">delete_outline</span>
        </button>`;

  list.appendChild(chip);
  list.appendChild(detail);
  detail.querySelector('.plaza-cnt-nombre')?.focus();
}

function _plazaRemoveContact(ci) {
  const row = document.getElementById(`plaza-contact-${ci}`);
  if (row) row.remove();
}

function plazaSeleccionarCfg(plazaId) {
  _plazaSeleccionadaCfg = plazaId;
  const plazas = (window.MEX_CONFIG.empresa || {}).plazas || [];
  const searchInp = document.getElementById('cfg-plaza-search');
  const filter = searchInp ? searchInp.value : '';
  const cardsContainer = document.getElementById('cfg-plazas-cards');
  if (cardsContainer) cardsContainer.innerHTML = _renderPlazaCards(plazas, filter);
  const editCol = document.getElementById('cfg-plaza-edit-col');
  if (editCol) editCol.innerHTML = _renderPlazaForm(plazaId);
}

async function plazaGuardarCfg(plazaId) {
  const emp = window.MEX_CONFIG.empresa;
  if (!emp) return showToast('Error: config no cargada', 'error');
  emp.plazasDetalle = emp.plazasDetalle || [];
  const idx = emp.plazasDetalle.findIndex(d => d.id === plazaId);

  // Recopilar contactos del DOM — leer desde los campos del detail expandido
  const detailEls = document.querySelectorAll('.plaza-contact-expanded');
  const contactos = Array.from(detailEls).map(detail => ({
    nombre: (detail.querySelector('.plaza-cnt-nombre')?.value || '').trim().toUpperCase(),
    rol: (detail.querySelector('.plaza-cnt-rol')?.value || '').trim().toUpperCase(),
    telefono: (detail.querySelector('.plaza-cnt-tel')?.value || '').trim()
  })).filter(c => c.nombre || c.telefono);

  const datos = {
    id: plazaId,
    nombre: (document.getElementById('plaza-nombre')?.value || '').trim(),
    descripcion: (document.getElementById('plaza-descripcion')?.value || '').trim(),
    localidad: (document.getElementById('plaza-localidad')?.value || '').trim(),
    direccion: (document.getElementById('plaza-direccion')?.value || '').trim(),
    mapsUrl: (document.getElementById('plaza-maps-url')?.value || '').trim(),
    temporal: document.getElementById('plaza-temporal-val')?.value === '1', // [F3.1]
    correo: (document.getElementById('plaza-correo')?.value || '').trim().toLowerCase(),
    telefono: (document.getElementById('plaza-telefono')?.value || '').trim(),
    gerente: (document.getElementById('plaza-gerente')?.value || '').trim().toUpperCase(),
    correoGerente: (document.getElementById('plaza-correo-gerente')?.value || '').trim().toLowerCase(),
    contactos
  };
  if (datos.correo && datos.correoGerente && datos.correo === datos.correoGerente) {
    showToast('Selecciona correos distintos para la plaza y la gerencia.', 'error');
    return;
  }
  if (idx > -1) emp.plazasDetalle[idx] = datos;
  else emp.plazasDetalle.push(datos);
  _reassignCorreoCatalogForPlaza(plazaId, datos.correo, datos.correoGerente);
  _plazaSeleccionadaCfg = plazaId;
  _plazaFormLocked = true;
  const saved = await _persistEmpresaAdminAction(
    'PLAZA_GUARDADA',
    `Actualizó la plaza ${plazaId}`,
    `Plaza ${plazaId} guardada.`,
    {
      entidad: 'PLAZAS',
      referencia: plazaId,
      correo: datos.correo || '',
      correoGerente: datos.correoGerente || ''
    }
  );
  if (saved) plazaSeleccionarCfg(plazaId);
}

function _llenarSelectPlazasUbi(selectId, selected) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const plazas = (window.MEX_CONFIG?.empresa?.plazas || []);
  sel.innerHTML =
    `<option value="ALL"${selected === 'ALL' ? ' selected' : ''}>🌐 Todas las plazas (ALL)</option>` +
    plazas.map(p => `<option value="${escapeHtml(p)}"${p === selected ? ' selected' : ''}>${escapeHtml(p)}</option>`).join('');
}

function agregarPlazaCatalogo() { _confirmarNuevaplaza(); } // legacy alias → modal

async function eliminarPlazaCatalogo(plazaId) {
  const ok = await mexConfirm(
    `Eliminar plaza "${plazaId}"`,
    'Se eliminará del catálogo. Los datos de la plaza configurada también se perderán.',
    'danger'
  );
  if (!ok) return;
  const emp = window.MEX_CONFIG.empresa || {};
  emp.plazas = (emp.plazas || []).filter(p => p !== plazaId);
  emp.plazasDetalle = (emp.plazasDetalle || []).filter(d => d.id !== plazaId);
  _releaseCorreoCatalogForPlaza(plazaId);
  if (_plazaSeleccionadaCfg === plazaId) _plazaSeleccionadaCfg = null;
  await _persistEmpresaAdminAction(
    'PLAZA_ELIMINADA',
    `Eliminó la plaza ${plazaId}`,
    `Plaza "${plazaId}" eliminada.`,
    { entidad: 'PLAZAS', referencia: plazaId }
  );
}

// ─── HELPERS EMPRESA ─────────────────────────────────────────────

function _toggleEditCorreo(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const locked = el.hasAttribute('readonly');
  if (locked) {
    el.removeAttribute('readonly');
    el.focus();
    el.select();
  } else {
    el.setAttribute('readonly', true);
  }
}

async function _borrarCampoCorreo(inputId, key) {
  const ok = await mexConfirm('Borrar correo', '¿Eliminar este correo del registro global?', 'warning');
  if (!ok) return;
  const el = document.getElementById(inputId);
  if (el) el.value = '';
  if (window.MEX_CONFIG && window.MEX_CONFIG.empresa) window.MEX_CONFIG.empresa[key] = '';
  await guardarEmpresaConfig(
    'CORREO_GLOBAL_ELIMINADO',
    `Eliminó el correo global ${key}`,
    'Correo global eliminado.',
    { entidad: 'EMPRESA', referencia: key }
  );
}

function _renderCorreosInternosHtml(correos, filter) {
  const q = filter || (document.getElementById('cfg-correo-interno-search')?.value || '').toLowerCase().trim();
  const lista = correos.filter(c => {
    if (!q) return true;
    const str = typeof c === 'object' ? `${c.titulo || ''} ${c.correo || ''}` : c;
    return str.toLowerCase().includes(q);
  });
  if (lista.length === 0) return '<div style="font-size:12px; color:#cbd5e1; font-weight:700; padding:8px 0;">Sin correos configurados.</div>';
  return lista.map((c, i) => {
    const correo = typeof c === 'object' ? (c.correo || '') : c;
    const titulo = typeof c === 'object' ? (c.titulo || '') : '';
    const plazaId = typeof c === 'object' ? _safeUpper(c.plazaId) : '';
    const origIdx = correos.indexOf(c);
    const correoEsc = correo.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `<div style="display:flex; align-items:center; gap:8px; background:white; border:1px solid #e2e8f0; border-radius:10px; padding:8px 10px;">
          <span class="material-icons" style="font-size:16px; color:#94a3b8; flex-shrink:0;">email</span>
          <div style="flex:1; overflow:hidden;">
            ${titulo ? `<div style="font-size:10px; font-weight:800; color:#64748b; text-transform:uppercase;">${escapeHtml(titulo)}</div>` : ''}
            <div style="font-size:12px; font-weight:700; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(correo)}</div>
            <div style="font-size:10px; font-weight:800; color:${plazaId ? '#2563eb' : '#94a3b8'}; margin-top:2px;">
              ${plazaId ? `Asignado a ${escapeHtml(plazaId)}` : 'Disponible para asignar'}
            </div>
          </div>
          <button onclick="_copyTextToClipboard('${correoEsc}','Correo')" title="Copiar"
            style="background:#eff6ff; border:1px solid #93c5fd; border-radius:6px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;">
            <span class="material-icons" style="font-size:14px; color:#2563eb;">content_copy</span>
          </button>
          <button onclick="_borrarCorreoInterno(${origIdx})" title="Eliminar"
            style="background:#fee2e2; border:1px solid #fca5a5; border-radius:6px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;">
            <span class="material-icons" style="font-size:14px; color:#ef4444;">delete</span>
          </button>
        </div>`;
  }).join('');
}

function _renderCorreosInternosList() {
  const el = document.getElementById('cfg-correos-internos-list');
  if (!el) return;
  const emp = window.MEX_CONFIG?.empresa || {};
  el.innerHTML = _renderCorreosInternosHtml(emp.correosInternos || []);
}

async function _borrarCorreoInterno(idx) {
  const emp = window.MEX_CONFIG?.empresa || {};
  const lista = emp.correosInternos || [];
  const item = lista[idx];
  const correoStr = typeof item === 'object' ? item.correo : item;
  const ok = await mexConfirm(
    'Eliminar correo interno',
    `"${correoStr}" desaparecerá del registro global y dejará de recibir notificaciones del sistema.`,
    'danger'
  );
  if (!ok) return;
  emp.plazasDetalle = (emp.plazasDetalle || []).map(det => {
    const next = { ...(det || {}) };
    if (_safeLower(next.correo) === _safeLower(correoStr)) next.correo = '';
    if (_safeLower(next.correoGerente) === _safeLower(correoStr)) next.correoGerente = '';
    return next;
  });
  lista.splice(idx, 1);
  emp.correosInternos = lista;
  _renderCorreosInternosList();
  await guardarEmpresaConfig(
    'CORREO_INTERNO_ELIMINADO',
    `Eliminó el correo interno ${correoStr}`,
    'Correo interno eliminado.',
    { entidad: 'CORREOS_INTERNOS', referencia: correoStr }
  );
}

async function agregarCorreoInterno() {
  const input = document.getElementById('cfg-correo-interno-input');
  const tInput = document.getElementById('cfg-correo-interno-titulo');
  if (!input) return;
  const correo = input.value.trim().toLowerCase();
  const titulo = tInput ? tInput.value.trim() : '';
  if (!correo || !correo.includes('@')) { showToast('Correo inválido', 'error'); return; }
  const emp = window.MEX_CONFIG.empresa || {};
  emp.correosInternos = emp.correosInternos || [];
  const yaExiste = emp.correosInternos.some(c => _safeLower(typeof c === 'object' ? c.correo : c) === correo);
  if (yaExiste) { showToast('Ese correo ya existe', 'error'); return; }
  emp.correosInternos.push({ correo, titulo, plazaId: '' });
  window.MEX_CONFIG.empresa = emp;
  input.value = '';
  if (tInput) tInput.value = '';
  _renderCorreosInternosList();
  await guardarEmpresaConfig(
    'CORREO_INTERNO_CREADO',
    `Agregó el correo interno ${correo}`,
    'Correo interno agregado.',
    { entidad: 'CORREOS_INTERNOS', referencia: correo }
  );
}

function renderCorreosInternos() {
  const container = document.getElementById('cfg-correos-internos-tags');
  if (!container) return;
  const correos = (window.MEX_CONFIG.empresa || {}).correosInternos || [];
  container.innerHTML = correos.length === 0
    ? '<span style="font-size:12px; color:#cbd5e1; font-weight:700;">Sin correos internos configurados.</span>'
    : correos.map((c, i) => `
            <span class="cfg-email-tag">
              <span class="material-icons" style="font-size:13px; margin-right:2px;">alternate_email</span>
              ${escapeHtml(c)}
              <button onclick="eliminarCorreoInterno(${i})" title="Eliminar">×</button>
            </span>
          `).join('');
}

async function subirLogoEmpresa(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('El archivo no debe superar 2MB', 'error'); return; }

  const zone = document.getElementById('cfg-logo-zone');
  if (zone) zone.innerHTML = `
        <div class="cfg-emp-logo-placeholder">
          <span class="material-icons spinner">sync</span>
          <span>Subiendo logo...</span>
        </div>`;

  try {
    const ext = file.name.split('.').pop() || 'png';
    const storageRef = firebase.storage().ref('empresa_config/logo.' + ext);
    const snapshot = await storageRef.put(file);
    const url = await snapshot.ref.getDownloadURL();
    window.MEX_CONFIG.empresa = window.MEX_CONFIG.empresa || {};
    window.MEX_CONFIG.empresa.logoURL = url;
    if (zone) zone.innerHTML = `
          <div class="cfg-emp-logo-img-wrap"><img src="${escapeHtml(url)}" alt="Logo empresa" class="cfg-emp-logo-big"></div>
          <div class="cfg-emp-logo-footer">
            <span style="font-size:11px;font-weight:800;color:#10b981;display:flex;align-items:center;gap:4px;flex:1;">
              <span class="material-icons" style="font-size:14px;">check_circle</span> Logo activo
            </span>
            <button class="cfg-emp-logo-btn" onclick="document.getElementById('cfg-logo-file').click()" title="Cambiar logo">
              <span class="material-icons">edit</span>
            </button>
            <button class="cfg-emp-logo-btn danger" onclick="eliminarLogoEmpresa()" title="Eliminar logo">
              <span class="material-icons">delete</span>
            </button>
          </div>`;
    await guardarEmpresaConfig(
      'LOGO_EMPRESA_ACTUALIZADO',
      'Actualizó el logo de la empresa',
      'Logo actualizado.',
      { entidad: 'EMPRESA', referencia: 'logoURL' }
    );
  } catch (e) {
    console.error(e);
    showToast('Error al subir logo: ' + e.message, 'error');
    if (zone) zone.innerHTML = `<div class="cfg-emp-logo-placeholder"><span class="material-icons">add_photo_alternate</span><span>Click para subir logo</span></div>`;
  }
}

async function eliminarLogoEmpresa() {
  const ok = await mexConfirm('Eliminar logo', '¿Eliminar el logo de la empresa?', 'danger');
  if (!ok) return;
  try {
    if (window.MEX_CONFIG.empresa?.logoURL) {
      try { await firebase.storage().refFromURL(window.MEX_CONFIG.empresa.logoURL).delete(); } catch (_) { }
    }
    window.MEX_CONFIG.empresa.logoURL = '';
    renderizarListaConfig();
    await guardarEmpresaConfig(
      'LOGO_EMPRESA_ELIMINADO',
      'Eliminó el logo de la empresa',
      'Logo eliminado.',
      { entidad: 'EMPRESA', referencia: 'logoURL' }
    );
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────

function cambiarTabSolicitudes(estado) {
  window._filtroSolicitudesEstatus = estado;
  ['PENDIENTE', 'APROBADO', 'RECHAZADO'].forEach(st => {
    const btn = document.getElementById('tab-sol-' + st);
    if (btn) {
      if (st === estado) {
        btn.style.color = 'var(--mex-blue)';
        btn.style.borderBottomColor = 'var(--mex-blue)';
      } else {
        btn.style.color = '#64748b';
        btn.style.borderBottomColor = 'transparent';
      }
    }
  });
  const searchUrl = document.getElementById('busqueda-solicitudes');
  if (searchUrl) searchUrl.value = '';
  cargarSolicitudesDeTab(estado);
}

async function cargarSolicitudesDeTab(estado) {
  if (!canViewAdminRequests()) return;
  const contenedor = document.getElementById('contenedor-solicitudes-v2');
  if (!contenedor) return;
  contenedor.innerHTML = `<div style="text-align:center; padding: 30px;"><span class="material-icons spinner" style="font-size:30px; color:var(--mex-blue);">sync</span></div>`;

  try {
    const estBD = estado === 'RECHAZADO' ? 'RECHAZADA' : estado === 'APROBADO' ? 'APROBADA' : 'PENDIENTE';
    const solicitudes = await _obtenerSolicitudesPorEstado(estBD);

    if (estado === 'PENDIENTE') {
      const badgeCfg = document.getElementById('badge-config-solicitudes');
      if (badgeCfg) badgeCfg.style.display = solicitudes.length > 0 ? 'inline-block' : 'none';
      const badgeSb = document.getElementById('badge-solicitudes');
      if (badgeSb) {
        badgeSb.innerText = solicitudes.length;
        badgeSb.style.display = solicitudes.length > 0 ? 'inline-block' : 'none';
      }
      _cfgAdminStatsCache.pending = solicitudes.length;
      _cfgSetInsightValue('cfg-insight-pending', solicitudes.length);
    }

    if (!solicitudes.length) {
      contenedor.innerHTML = `
           <div style="text-align: center; color: #64748b; padding: 40px; font-weight: 700;">
             <span class="material-icons" style="font-size: 40px; color: #cbd5e1;">check_circle</span><br>
             No hay solicitudes en este buzón.
           </div>`;
      window._objSolicitudesMemoria = [];
      return;
    }

    window._objSolicitudesMemoria = solicitudes;
    filtrarSolicitudesActuales();

  } catch (e) { console.error(e); }
}

function filtrarSolicitudesActuales() {
  const query = (document.getElementById('busqueda-solicitudes')?.value || "").toUpperCase().trim();
  const contenedor = document.getElementById('contenedor-solicitudes-v2');
  if (!contenedor) return;
  const canProcess = canProcessAccessRequests();

  const dataList = window._objSolicitudesMemoria.filter(data => {
    if (!query) return true;
    const str = `${data.nombre || ''} ${data.email || ''} ${data.puesto || ''} ${data.rolSolicitado || ''}`.toUpperCase();
    return str.includes(query);
  });

  if (dataList.length === 0) {
    contenedor.innerHTML = `<div style="text-align:center;color:#64748b;">Sin coincidencias...</div>`;
    return;
  }

  let html = "";
  dataList.forEach(data => {
    const requestedRole = _resolveStoredRoleForEmail(data.email, _sanitizeRole(data.rolSolicitado) || _inferRequestedAccessRole(data.puesto, data.email));
    const roleLabel = ROLE_META[requestedRole] ? ROLE_META[requestedRole].label : requestedRole;
    let actionBtns = "";
    if (window._filtroSolicitudesEstatus === 'PENDIENTE' && canProcess) {
      actionBtns = `
              <button onclick="procesarSolicitud('${data.id}', false, '${data.__collection || ACCESS_REQUEST_PRIMARY_COLLECTION}')" style="background: #fee2e2; color: #ef4444; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size:11px;">
                <span class="material-icons" style="font-size: 14px;">close</span> RECHAZAR
              </button>
              <button onclick="procesarSolicitud('${data.id}', true, '${data.__collection || ACCESS_REQUEST_PRIMARY_COLLECTION}')" style="background: #10b981; color: white; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size:11px;">
                <span class="material-icons" style="font-size: 14px;">check</span> APROBAR
              </button>
            `;
    } else if (window._filtroSolicitudesEstatus === 'RECHAZADO' && canProcess) {
      const motivoEsc = escapeHtml(data.motivo_rechazo || 'Sin motivo registrado');
      const porEsc = escapeHtml(data.rechazadoPor || 'Desconocido');
      actionBtns = `
              <button onclick="verInfoRechazo('${data.id}')" style="background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; padding: 8px 12px; border-radius: 6px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size:11px;">
                <span class="material-icons" style="font-size: 14px;">info</span> MÁS INFO
              </button>
              <button onclick="procesarSolicitud('${data.id}', true, '${data.__collection || ACCESS_REQUEST_PRIMARY_COLLECTION}')" style="background: #10b981; color: white; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size:11px;">
                <span class="material-icons" style="font-size: 14px;">refresh</span> RE-APROBAR
              </button>
            `;
    } else if (!canProcess) {
      actionBtns = `
              <span style="display:inline-flex;align-items:center;min-height:34px;padding:0 12px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;border:1px solid #bfdbfe;">
                Solo lectura
              </span>
            `;
    }

    html += `
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
              <div>
                <h4 style="margin: 0; color: #0f172a; font-weight: 900; font-size: 14px;">${data.nombre}</h4>
                <div style="color: #64748b; font-size: 12px; font-weight: 600; margin-top: 4px;">
                  <span class="material-icons" style="font-size: 12px; vertical-align: text-bottom;">email</span> ${data.email}
                </div>
                <div style="color: var(--mex-blue); font-size: 10px; font-weight: 800; margin-top: 6px; background: #e0f2fe; display: inline-block; padding: 3px 6px; border-radius: 4px;">
                  📍 ${data.puesto || 'N/A'}
                </div>
                <div style="color: #7c3aed; font-size: 10px; font-weight: 800; margin-top: 6px; background: #f3e8ff; display: inline-block; padding: 3px 6px; border-radius: 4px;">
                  🔐 ${roleLabel}
                </div>
              </div>
              <div style="display: flex; gap: 8px;">
                ${actionBtns}
              </div>
            </div>
          `;
  });
  contenedor.innerHTML = html;
}

function verInfoRechazo(docId) {
  const data = (window._objSolicitudesMemoria || []).find(d => d.id === docId);
  if (!data) return;
  const motivo = data.motivo_rechazo || 'Sin motivo registrado';
  const rechPor = data.rechazadoPor || 'Desconocido';
  const fecha = data.fecha || '';
  mexAlert(
    `Rechazo — ${data.nombre}`,
    `Rechazado por: ${rechPor}\nFecha: ${fecha}\n\nMotivo:\n"${motivo}"`,
    'warning'
  );
}

// ─── Inyecta MEX_CONFIG en todos los <select> de la app ──────────────────────
function llenarSelectsDinamicos() {
  if (!window.MEX_CONFIG || !window.MEX_CONFIG.listas) return;
  const { ubicaciones = [], estados = [], categorias = [], gasolinas = [] } = window.MEX_CONFIG.listas;

  const EMOJI_ESTADO = {
    'LISTO': '🟢', 'SUCIO': '🟡', 'MANTENIMIENTO': '🔴', 'RESGUARDO': '🔘',
    'TRASLADO': '🟣', 'VENTA': '⚫', 'RETENIDA': '🟤', 'NO ARRENDABLE': '▫️',
    'HYP': '🚚', 'EN RENTA': '✈️', 'HIBRIDO': '🍃'
  };

  function _setOptions(selectId, options) {
    if (!options || options.length === 0) return; // No borrar si no hay datos
    const el = document.getElementById(selectId);
    if (!el) return;
    const saved = el.value;
    const firstBlank = el.querySelector('option[value=""], option[value="N/A"]');
    el.innerHTML = '';
    if (firstBlank) el.appendChild(firstBlank.cloneNode(true));
    options.forEach(o => el.appendChild(o.cloneNode(true)));
    if (el.querySelector(`option[value="${saved}"]`)) el.value = saved;
  }

  function _labelGasolina(value) {
    const gas = String(value || '').trim().toUpperCase();
    if (gas === 'F') return 'F (Lleno Total)';
    if (gas === 'H') return 'H (Medio)';
    if (gas === 'E') return 'E (Vacio)';
    if (gas === 'N/A') return 'N/A';
    return gas;
  }

  function _clasificarGasolina(value) {
    const gas = String(value || '').trim().toUpperCase();
    if (!gas || gas === 'N/A') return 'SIN_APLICA';
    if (gas === 'F') return 'COMPLETO';
    if (gas === 'H') return 'MEDIO';
    if (gas === 'E') return 'BAJO';
    const partes = gas.split('/');
    if (partes.length === 2) {
      const numerador = Number(partes[0]);
      const denominador = Number(partes[1]);
      if (Number.isFinite(numerador) && Number.isFinite(denominador) && denominador > 0) {
        return (numerador / denominador) >= 0.5 ? 'MEDIO' : 'BAJO';
      }
    }
    return 'OTROS';
  }

  function _setGasOptions(selectIds, values) {
    if (!Array.isArray(values) || values.length === 0) return;

    const unicos = Array.from(new Set(
      values.map(v => String(v || '').trim().toUpperCase()).filter(Boolean)
    ));

    const grupos = {
      COMPLETO: [],
      MEDIO: [],
      BAJO: [],
      OTROS: [],
      SIN_APLICA: []
    };

    unicos.forEach(valor => {
      grupos[_clasificarGasolina(valor)].push(valor);
    });

    selectIds.forEach(selectId => {
      const el = document.getElementById(selectId);
      if (!el) return;

      const saved = String(el.value || '').trim().toUpperCase() || 'N/A';
      el.innerHTML = '';

      const placeholder = document.createElement('option');
      placeholder.value = 'N/A';
      placeholder.textContent = 'Seleccionar...';
      el.appendChild(placeholder);

      grupos.COMPLETO.forEach(valor => {
        const opt = document.createElement('option');
        opt.value = valor;
        opt.textContent = _labelGasolina(valor);
        el.appendChild(opt);
      });

      if (grupos.MEDIO.length) {
        const grp = document.createElement('optgroup');
        grp.label = 'MEDIO';
        grupos.MEDIO.forEach(valor => {
          const opt = document.createElement('option');
          opt.value = valor;
          opt.textContent = _labelGasolina(valor);
          grp.appendChild(opt);
        });
        el.appendChild(grp);
      }

      if (grupos.BAJO.length) {
        const grp = document.createElement('optgroup');
        grp.label = 'BAJO';
        grupos.BAJO.forEach(valor => {
          const opt = document.createElement('option');
          opt.value = valor;
          opt.textContent = _labelGasolina(valor);
          grp.appendChild(opt);
        });
        el.appendChild(grp);
      }

      if (grupos.OTROS.length) {
        const grp = document.createElement('optgroup');
        grp.label = 'OTROS';
        grupos.OTROS.forEach(valor => {
          const opt = document.createElement('option');
          opt.value = valor;
          opt.textContent = _labelGasolina(valor);
          grp.appendChild(opt);
        });
        el.appendChild(grp);
      }

      if (!unicos.includes('N/A')) {
        const opt = document.createElement('option');
        opt.value = 'N/A';
        opt.textContent = 'N/A';
        el.appendChild(opt);
      }

      if (el.querySelector(`option[value="${saved}"]`)) {
        el.value = saved;
      } else {
        el.value = 'N/A';
      }
    });
  }

  // Categorías
  const catOpts = categorias.map(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; return o; });
  ['filter-cat'].forEach(id => _setOptions(id, catOpts));

  // Modelos
  const modOpts = (window.MEX_CONFIG.listas.modelos || []).map(m => { const o = document.createElement('option'); o.value = m.nombre; o.textContent = m.nombre; return o; });
  ['filter-modelo'].forEach(id => _setOptions(id, modOpts));

  // Estados (normalizar: admite strings simples o maps {id,color,orden})
  const estNorm = estados.map(e => typeof e === 'string' ? { id: e, color: '#64748b', orden: 99 } : e);
  const estOrdenados = estNorm.sort((a, b) => ((a.orden || 99) - (b.orden || 99)));
  const estOpts = estOrdenados.map(est => {
    const o = document.createElement('option');
    o.value = est.id;
    o.textContent = `${EMOJI_ESTADO[est.id] || '●'} ${est.id}`;
    return o;
  });
  ['filter-est', 'f_est', 'a_ins_est', 'a_mod_est'].forEach(id => _setOptions(id, estOpts));

  // Filtrar ubicaciones siempre por la plaza activa para evitar mezclar plazas
  // plazaId='ALL' siempre aparece en todas las plazas
  let ubicFiltradas = ubicaciones;
  const miP = (_miPlaza() || '').toUpperCase();
  if (miP) {
    ubicFiltradas = ubicaciones.filter(u => {
      const plazaId = ((typeof u === 'object' ? u.plazaId : null) || '').toUpperCase();
      return !plazaId || plazaId === 'ALL' || plazaId === miP;
    });
  }

  // Formatea objetos {nombre, isPlazaFija} y legacy strings a un estándar interno para dividir en grupos OptGroup.
  const ubiParsed = ubicFiltradas.map(u => typeof u === 'object' ? u : { nombre: u, isPlazaFija: ['PATIO', 'TALLER', 'AGENCIA', 'TALLER EXTERNO', 'HYP COBIAN'].includes(u) });
  const plazas = ubiParsed.filter(u => u.isPlazaFija).map(u => u.nombre);
  const personas = ubiParsed.filter(u => !u.isPlazaFija).map(u => u.nombre);

  ['filter-ubi', 'f_ubi', 'a_ins_ubi', 'a_mod_ubi'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const saved = el.value;
    const firstBlank = el.querySelector('option[value=""]');
    el.innerHTML = '';
    if (firstBlank) el.appendChild(firstBlank.cloneNode(true));

    if (plazas.length) {
      const grp = document.createElement('optgroup'); grp.label = 'PLAZAS FIJAS';
      plazas.forEach(u => { const o = document.createElement('option'); o.value = u; o.textContent = u; grp.appendChild(o); });
      el.appendChild(grp);
    }
    if (personas.length) {
      const grp = document.createElement('optgroup'); grp.label = 'PERSONA RESPONSABLE';
      personas.forEach(u => { const o = document.createElement('option'); o.value = u; o.textContent = `👤 ${u}`; grp.appendChild(o); });
      el.appendChild(grp);
    }
    if (el.querySelector(`option[value="${saved}"]`)) el.value = saved;
  });

  // Gasolinas
  _setGasOptions(['f_gas', 'a_ins_gas', 'a_mod_gas'], gasolinas);

  console.log('✅ Selects actualizados desde MEX_CONFIG');
}

function configurarPermisosUI() {
  const operacionAdmin = [
    'btnMenuAuditoria',
    'btnMenuBitacora',
    'btnMenuExportar',
    'btnVerCuadres'
  ];

  const btnAdminNut = document.getElementById('btnAdmin');
  if (btnAdminNut) btnAdminNut.style.display = 'flex';

  const visibilidadEspecial = {
    btnMenuAlertasGlobales: canEmitMasterAlerts(),
    btnMenuHistorialAlertas: canEmitMasterAlerts(),
    btnLockMaestro: canLockMap(),
    btnMenuHistorial: hasFullAccess(),
    btnLockAdminSidebar: canLockMap(),
    btnEditorMapa: hasFullAccess(),
    panelAdminDivider: canOpenAdminPanel(),
    navGroupPanelAdmin: canOpenAdminPanel()
  };

  Object.entries(visibilidadEspecial).forEach(([id, visible]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? (el.tagName === 'DIV' && !el.classList.contains('sb-divider') ? 'flex' : (el.classList.contains('sb-divider') ? 'block' : 'flex')) : 'none';
  });
  _ensureProgrammerRouteButton();

  if (userRole === 'admin') {
    operacionAdmin.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = 'flex';
    });

    if (canOpenAdminPanel()) {
      inicializarConfiguracion();
    }

    if (typeof cargarMaestra === "function" && canViewAdminCuadre()) cargarMaestra();

  } else {
    operacionAdmin.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = 'none';
    });
  }

  _actualizarBloquesAdminSidebar();
}


// --- LÓGICA DE SOLICITUDES DE ACCESO ---

const ACCESS_REQUEST_PRIMARY_COLLECTION = 'solicitudes';
const ACCESS_REQUEST_LEGACY_COLLECTION = 'solicitudes_acceso';

function _accessRequestCollections(preferred = '') {
  return Array.from(new Set(
    [preferred, ACCESS_REQUEST_PRIMARY_COLLECTION, ACCESS_REQUEST_LEGACY_COLLECTION]
      .map(name => String(name || '').trim())
      .filter(Boolean)
  ));
}

function _normalizeAccessRequestDoc(docSnap, collectionName = '') {
  const data = docSnap?.data ? docSnap.data() : (docSnap || {});
  const email = _profileDocId(data.email || docSnap?.id || data.id || '');
  const fechaMs = _coerceTimestamp(data._ts)?.getTime?.() || Date.parse(data.fecha || '') || 0;
  return {
    id: email || String(docSnap?.id || data.id || '').trim(),
    ...data,
    email,
    __collection: collectionName || data.__collection || ACCESS_REQUEST_PRIMARY_COLLECTION,
    __fechaMs: Number.isFinite(fechaMs) ? fechaMs : 0
  };
}

async function _obtenerSolicitudesPorEstado(estado = 'PENDIENTE') {
  const batches = await Promise.all(_accessRequestCollections().map(async collectionName => {
    try {
      const snapshot = await db.collection(collectionName)
        .where('estado', '==', estado)
        .get();
      return snapshot.docs.map(doc => _normalizeAccessRequestDoc(doc, collectionName));
    } catch (error) {
      if ((error?.code || '') !== 'permission-denied') {
        console.warn('[solicitudes] read state', collectionName, estado, error);
      }
      return [];
    }
  }));

  const merged = new Map();
  batches.flat().forEach(item => {
    const key = _profileDocId(item.email || item.id || '');
    if (!key) return;
    const previous = merged.get(key);
    if (!previous || item.__collection === ACCESS_REQUEST_PRIMARY_COLLECTION) {
      merged.set(key, item);
    }
  });

  return Array.from(merged.values()).sort((a, b) => {
    if ((b.__fechaMs || 0) !== (a.__fechaMs || 0)) return (b.__fechaMs || 0) - (a.__fechaMs || 0);
    return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' });
  });
}

async function _obtenerSolicitudDoc(docId, collectionHint = '') {
  const normalizedId = _profileDocId(docId);
  for (const collectionName of _accessRequestCollections(collectionHint)) {
    try {
      const docSnap = await db.collection(collectionName).doc(normalizedId).get();
      if (docSnap.exists) {
        return {
          id: normalizedId,
          collectionName,
          docSnap,
          data: _normalizeAccessRequestDoc(docSnap, collectionName)
        };
      }
    } catch (error) {
      if ((error?.code || '') !== 'permission-denied') {
        console.warn('[solicitudes] read doc', collectionName, normalizedId, error);
      }
    }
  }
  return null;
}

function abrirModalSolicitudes() {
  if (!canViewAdminRequests()) {
    showToast("Solo los roles superiores pueden revisar solicitudes.", "error");
    return;
  }
  abrirPanelConfiguracion('solicitudes');
}

// Mantener solo la actualización del badge del sidebar en tiempo de carga
async function cargarSolicitudesPendientes() {
  if (!canViewAdminRequests()) return;
  try {
    const solicitudes = await _obtenerSolicitudesPorEstado('PENDIENTE');
    const badge = document.getElementById('badge-solicitudes');
    if (badge) {
      badge.innerText = solicitudes.length;
      badge.style.display = solicitudes.length > 0 ? 'inline-block' : 'none';
    }
    const badgeCfg = document.getElementById('badge-config-solicitudes');
    if (badgeCfg) badgeCfg.style.display = solicitudes.length > 0 ? 'inline-block' : 'none';
    _cfgAdminStatsCache.pending = solicitudes.length;
    _cfgSetInsightValue('cfg-insight-pending', solicitudes.length);
  } catch (e) { console.warn('cargarSolicitudesPendientes badge error', e); }
}

function _solicitudApprovalFormHtml(data = {}) {
  const requestedRole = _sanitizeRole(data.requestedRole || data.rolSolicitado) || 'AUXILIAR';
  const requestedRoleLabel = ROLE_META[requestedRole]?.label || requestedRole;
  const requestedPlaza = _normalizePlaza(data.requestedPlaza || data.plazaSolicitada || '');
  return `
    <div style="display:grid;gap:14px;text-align:left;">
      <div style="padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,#ecfdf5 0%,#eff6ff 100%);border:1px solid #bfdbfe;">
        <div style="font-size:11px;font-weight:900;letter-spacing:.08em;color:#0f766e;text-transform:uppercase;margin-bottom:8px;">Alta de perfil</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:#ffffff;color:#0f172a;font-size:12px;font-weight:800;border:1px solid #dbeafe;">
            <span class="material-icons" style="font-size:16px;color:#2563eb;">badge</span>
            ${escapeHtml(requestedRoleLabel)}
          </span>
          <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:#ffffff;color:#0f172a;font-size:12px;font-weight:800;border:1px solid #dbeafe;">
            <span class="material-icons" style="font-size:16px;color:#0f766e;">apartment</span>
            ${escapeHtml(requestedPlaza || 'Sin plaza solicitada')}
          </span>
        </div>
        <p style="margin:10px 0 0;color:#475569;font-size:12px;line-height:1.5;">
          Puedes ajustar el perfil antes de aprobar. El correo y el puesto quedan como referencia de la solicitud original.
        </p>
      </div>

      <div style="display:grid;gap:12px;">
        <label style="display:grid;gap:6px;">
          <span style="font-size:12px;font-weight:800;color:#334155;">Nombre</span>
          <input id="sol-apr-nombre" type="text" value="${escapeHtml(data.nombre || '')}" style="width:100%;padding:12px 14px;border:1.5px solid #dbe2ea;border-radius:12px;font-size:13px;background:#fff;color:#0f172a;">
        </label>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <label style="display:grid;gap:6px;">
            <span style="font-size:12px;font-weight:800;color:#334155;">Correo</span>
            <input id="sol-apr-email" type="email" value="${escapeHtml(data.email || '')}" disabled style="width:100%;padding:12px 14px;border:1.5px solid #dbe2ea;border-radius:12px;font-size:13px;background:#f8fafc;color:#475569;">
          </label>
          <label style="display:grid;gap:6px;">
            <span style="font-size:12px;font-weight:800;color:#334155;">Teléfono</span>
            <input id="sol-apr-telefono" type="text" value="${escapeHtml(data.telefono || '')}" style="width:100%;padding:12px 14px;border:1.5px solid #dbe2ea;border-radius:12px;font-size:13px;background:#fff;color:#0f172a;">
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <label style="display:grid;gap:6px;">
            <span style="font-size:12px;font-weight:800;color:#334155;">Puesto solicitado</span>
            <input id="sol-apr-puesto" type="text" value="${escapeHtml(data.puesto || '')}" disabled style="width:100%;padding:12px 14px;border:1.5px solid #dbe2ea;border-radius:12px;font-size:13px;background:#f8fafc;color:#475569;">
          </label>
          <label style="display:grid;gap:6px;">
            <span style="font-size:12px;font-weight:800;color:#334155;">Rol final</span>
            <select id="sol-apr-role" onchange="_syncSolicitudApprovalScope()" style="width:100%;padding:12px 14px;border:1.5px solid #dbe2ea;border-radius:12px;font-size:13px;background:#fff;color:#0f172a;">
              ${_roleOptionsHtml(requestedRole)}
            </select>
          </label>
        </div>

        <label id="sol-apr-plaza-row" style="display:grid;gap:6px;">
          <span style="font-size:12px;font-weight:800;color:#334155;">Plaza asignada</span>
          ${_plazaSelectHtml('sol-apr-plaza', requestedPlaza)}
        </label>
      </div>
    </div>
  `;
}

function _syncSolicitudApprovalScope() {
  const roleSelect = document.getElementById('sol-apr-role');
  const plazaRow = document.getElementById('sol-apr-plaza-row');
  const plazaSelect = document.getElementById('sol-apr-plaza');
  if (!roleSelect || !plazaRow) return;
  const role = _sanitizeRole(roleSelect.value) || 'AUXILIAR';
  const needsPlaza = _roleNeedsPlaza(role);
  plazaRow.style.display = needsPlaza ? '' : 'none';
  if (!needsPlaza && plazaSelect) plazaSelect.value = '';
}

function _readSolicitudApprovalForm() {
  const nombre = String(document.getElementById('sol-apr-nombre')?.value || '').trim().toUpperCase();
  const telefono = String(document.getElementById('sol-apr-telefono')?.value || '').trim();
  const role = _sanitizeRole(document.getElementById('sol-apr-role')?.value) || 'AUXILIAR';
  const plaza = _normalizePlaza(document.getElementById('sol-apr-plaza')?.value || '');
  if (!nombre) {
    showToast('Captura un nombre para el nuevo perfil.', 'error');
    return null;
  }
  if (_roleNeedsPlaza(role) && !plaza) {
    showToast('Selecciona una plaza para ese rol.', 'error');
    return null;
  }
  return { nombre, telefono, role, plaza };
}

async function _abrirEditorAprobacionSolicitud(solicitudInfo = {}) {
  return new Promise(resolve => {
    const cancelBtn = document.querySelector('#customModal .modal-btn-cancel');
    const cleanup = () => {
      cancelBtn?.removeEventListener('click', handleCancel);
    };
    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    mostrarCustomModal(
      `Aprobar acceso para ${solicitudInfo.nombre || 'solicitante'}`,
      _solicitudApprovalFormHtml(solicitudInfo),
      'person_add_alt_1',
      '#10b981',
      'APROBAR',
      '#10b981',
      async () => {
        const payload = _readSolicitudApprovalForm();
        if (!payload) return false;
        cleanup();
        resolve(payload);
        return true;
      }
    );

    cancelBtn?.addEventListener('click', handleCancel, { once: true });
    window.setTimeout(_syncSolicitudApprovalScope, 0);
  });
}

async function _procesarSolicitudCallable(payload = {}) {
  if (typeof api?.procesarSolicitudAcceso === 'function') {
    return api.procesarSolicitudAcceso(payload);
  }
  const functions = window._functions || (typeof firebase?.functions === 'function' ? firebase.app().functions('us-central1') : null);
  if (!functions || typeof functions.httpsCallable !== 'function') {
    throw new Error('Firebase Functions no está disponible para procesar solicitudes.');
  }
  const response = await functions.httpsCallable('procesarSolicitudAcceso')(payload);
  return response?.data || response;
}

async function procesarSolicitud(docId, esAprobado, collectionHint = '') {
  if (!canProcessAccessRequests()) {
    return showToast("No tienes permisos para procesar solicitudes.", "error");
  }
  const solicitudInfo = await _obtenerSolicitudDoc(docId, collectionHint);
  if (!solicitudInfo?.docSnap?.exists) return showToast("La solicitud ya no existe", "error");

  const { email, nombre, puesto, telefono, password, rolSolicitado, plazaSolicitada } = solicitudInfo.data;
  const requestedRole = _resolveStoredRoleForEmail(
    email,
    _sanitizeRole(rolSolicitado) || _inferRequestedAccessRole(puesto, email)
  );
  const requestedPlaza = _roleNeedsPlaza(requestedRole) ? _normalizePlaza(plazaSolicitada) : "";
  let motivo = "";
  let approvalPayload = null;

  if (!esAprobado) {
    motivo = await mexPrompt(
      `Rechazar solicitud de ${nombre}`,
      'Escribe el motivo del rechazo (se enviará al solicitante):',
      'No cumples con los criterios de acceso requeridos.'
    );
    if (motivo === null) return;
    if (!motivo.trim()) motivo = "No cumples con los criterios de acceso requeridos en este momento.";
  } else {
    approvalPayload = await _abrirEditorAprobacionSolicitud({
      nombre,
      email,
      puesto,
      telefono,
      requestedRole,
      requestedPlaza,
      password
    });
    if (!approvalPayload) return;
  }

  showToast("Procesando...", "info"); // Aviso visual mientras piensa

  try {
    if (esAprobado) {
      await _procesarSolicitudCallable({
        action: 'approve',
        docId: solicitudInfo.id,
        collectionName: solicitudInfo.collectionName,
        email,
        nombre: approvalPayload ? approvalPayload.nombre : nombre,
        puesto,
        telefono: approvalPayload ? approvalPayload.telefono : telefono,
        role: approvalPayload ? approvalPayload.role : requestedRole,
        plaza: approvalPayload ? approvalPayload.plaza : requestedPlaza,
        password
      });
    } else {
      await _procesarSolicitudCallable({
        action: 'reject',
        docId: solicitudInfo.id,
        collectionName: solicitudInfo.collectionName,
        email,
        nombre,
        puesto,
        telefono,
        motivo
      });
    }

    if (typeof enviarCorreoWebhook === "function") {
      enviarCorreoWebhook(email, nombre, esAprobado ? "APROBADO" : "RECHAZADO", motivo);
    }

    showToast(`Solicitud ${esAprobado ? 'APROBADA' : 'RECHAZADA'} con éxito`, "success");
    // Recargar el tab actual del panel de solicitudes v2
    if (typeof cargarSolicitudesDeTab === 'function' && document.getElementById('contenedor-solicitudes-v2')) {
      cargarSolicitudesDeTab(window._filtroSolicitudesEstatus || 'PENDIENTE');
    }
    cargarSolicitudesPendientes();

  } catch (error) {
    console.error("Error procesando solicitud:", error);
    showToast(error?.message || "Error en el servidor al procesar", "error");
  }
}

// --- CONEXIÓN CON GOOGLE APPS SCRIPT (WEBHOOK) ---
function enviarCorreoWebhook(email, nombre, estado, motivo) {
  // 🔥 ESTA URL LA CAMBIAREMOS POR LA TUYA EN EL SIGUIENTE PASO
  const WEBHOOK_URL = "URL_DE_TU_APPS_SCRIPT_AQUI";

  if (WEBHOOK_URL === "URL_DE_TU_APPS_SCRIPT_AQUI") {
    console.log("Simulando envío de correo a:", email, estado, motivo);
    return; // Evita el error hasta que hagamos el script
  }

  const payload = {
    email: email,
    nombre: nombre,
    estado: estado, // "APROBADO" o "RECHAZADO"
    motivo: motivo
  };

  fetch(WEBHOOK_URL, {
    method: 'POST',
    mode: 'no-cors', // Importante para evitar bloqueos de CORS desde GAS
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(e => console.error("Error en Webhook:", e));
}

// ── Asignaciones críticas explícitas (evitan ReferenceError si el módulo carga tarde) ──
window.toggleSidebar = toggleSidebar;
window.abrirReporteImpresion  = abrirReporteImpresion;
window.descargarArchivoLocal  = descargarArchivoLocal;
window.generarSlugArchivo     = generarSlugArchivo;
window.toggleAdminSidebar = toggleAdminSidebar;
window._togglePlazaPicker = _togglePlazaPicker;
window._cfgApplySidebarPinState = _cfgApplySidebarPinState;
window._cfgToggleSidebarPin = _cfgToggleSidebarPin;
window._cfgOpenNavGroup = _cfgOpenNavGroup;
window._cfgToggleNavGroup = _cfgToggleNavGroup;
window._cfgSyncNavState = _cfgSyncNavState;
window._cfgQuickAction = _cfgQuickAction;

// ── Exponer funciones al scope global para onclick/onchange ────────────────
// (ES6 modules son strict y no exponen al window automáticamente)
Object.assign(window, {
  _guardarNotaRapida,
  _actualizarAutorAlertaUI,
  _actualizarBannerAlertaUI,
  _actualizarBloquesAdminSidebar,
  _actualizarCamposAccionAlerta,
  _actualizarIdentidadSidebarUsuario,
  _actualizarNodoUnidadMapa,
  _actualizarPreviewAlerta,
  _actualizarTituloModalAlerta,
  _ajustarViewportMapa,
  _alertaAplicaAUsuario,
  _alertaYaLeidaPor,
  _applyMapZoom,
  _asegurarBindingsEditorAlerta,
  _avatarColor,
  _badgeTiempoActividad,
  _bindMapZoomGestures,
  _borrarCampoCorreo,
  _borrarCorreoInterno,
  _cargarPlantillasAlerta,
  _clampMapZoom,
  _clearChatStaging,
  _clearSessionProfile,
  _colocarCursorFinalAlerta,
  _comprimirArchivoImagenAlerta,
  _copiarTextoAlPortapapeles,
  _crearAccionAlertaVacia,
  _dibujarEspectroGrabacion,
  _docIconForExt,
  _edSelectCelda,
  _esPlazaFija,
  _esUrlSeguraAlerta,
  _filtrarDestinatarios,
  _filtrarEmojisReaccion,
  _filtrarPlazasCfg,
  _finalizarCicloGuardadoMapa,
  _firmaReportePosicionesMapa,
  _firmaUnidadMapa,
  _flushMapaSync,
  _forzarGuardadoMapaPendiente,
  _getMapViewport,
  _getTouchCenter,
  _getTouchDistance,
  _getViewportCenterPoint,
  _guardarSeleccionEditorAlerta,
  _handleMapTouchEnd,
  _handleMapTouchMove,
  _handleMapTouchStart,
  _handleMapWheelZoom,
  _horaPreviewActual,
  _inferRequestedAccessRole,
  _inferirModoDestinatariosAlerta,
  _iniciarSincronizacionUsuarios,
  _iniciarTimerGrabacion,
  _inicioDiaSeguro,
  _isBootstrapProgrammerEmail,
  _isMapZoomTarget,
  _legacyRoleFromFlags,
  _limpiarFiltrosHistAlertas,
  _limpiarFiltrosLogs,
  _limpiarRadar,
  _linkifyText,
  _llenarSelectPlazasUbi,
  _metaModoAuditoria,
  _normalizarAccionAlerta,
  _normalizarBannerAlerta,
  _normalizarEstructuraMapa,
  _normalizarHexColorAlerta,
  _normalizarMensajeAlertaHtml,
  _normalizarModoAlerta,
  _normalizarModoAutorAlerta,
  _normalizarUnidadMapa,
  _normalizarUrlAccionAlerta,
  _normalizePlaza,
  _normalizeUserProfile,
  _obtenerAccionFormularioAlerta,
  _obtenerAutorFormularioAlerta,
  _obtenerAutorVisibleAlerta,
  _obtenerBannerFormularioAlerta,
  _obtenerBannerVisibleAlerta,
  _obtenerDestinoUnidadMapa,
  _obtenerEditorAlerta,
  _obtenerEvidenciasAdminUI,
  _obtenerHintAccionAlerta,
  _obtenerInicialesUsuario,
  _obtenerMetaAccionAlerta,
  _obtenerMetaModoAlerta,
  _obtenerMetaTipoAlerta,
  _obtenerPlazaOperativaCuadreAdmin,
  _obtenerReportePosicionesMapa,
  _obtenerResumenDestinatariosAlerta,
  _obtenerResumenDestinatariosEditor,
  _obtenerStatsTextoAlerta,
  _obtenerSublineaModoAlerta,
  _obtenerTextoBotonAccionAlerta,
  _obtenerTextoPlanoAlerta,
  _obtenerUsuariosDestinoAlerta,
  _ordenarAlertasPendientes,
  _parseListaAlertaCsv,
  _pintarBotonDestino,
  _prepararFormularioAlerta,
  _procesarPingUI,
  _procesarSnapshotPendienteMapa,
  _profileDocId,
  _programarGuardadoMapa,
  _renderBotonEmitirAlerta,
  _renderCorreosInternosHtml,
  _renderCorreosInternosList,
  _renderDestinatariosAlerta,
  _renderEmojiGrid,
  _renderGasolinaMapa,
  _renderHistorialAlertas,
  _renderLogsTabla,
  _renderPlazaCards,
  _renderPlazaForm,
  _renderStagingArea,
  _renderizarBotonAccionAlerta,
  _resetEditorPanel,
  _resolveStoredRoleForEmail,
  _resolverAutorVisibleDesdeConfig,
  _resolverResponsableCuadreAdmin,
  _restaurarSeleccionEditorAlerta,
  _resumenActividadCard,
  _resumirTextoCuadreAdmin,
  _roleMeta,
  _roleNeedsPlaza,
  _roleNeedsMultiplePlazas,
  _getSelectedPlazas,
  _roleOptionsHtml,
  _safeCssUrl,
  _sanitizarHtmlAlerta,
  _sanitizeRole,
  _seleccionarUsuarioDestino,
  _selectModo,
  _setAutorFormularioAlerta,
  _setBannerFormularioAlerta,
  _setDestMode,
  _setMapSyncBadge,
  _setSessionProfile,
  _sincronizarFormularioAccionAlerta,
  _startChatListener,
  _stopChatListener,
  _syncMapStageSize,
  _syncRoleScope,
  _tablaActividadHtml,
  _toggleDestinatarioAlerta,
  _toggleEditCorreo,
  _cfgJumpTab,
  _cfgQuickAction,
  _cfgSelectCatalogItem,
  _cfgSaveInlineEdit,
  _cfgCancelInlineEdit,
  _cfgPreviewModeloImg,
  _copyPlazaCorreo,
  _copyTextToClipboard,
  _togglePlazaAddRow,
  _umAvatarStyle,
  _umGetPlazasDisponibles,
  _umIniciar,
  _umNuevoUsuarioConAnim,
  _umGoToConfigTab,
  _umRenderPlazaChips,
  _umToggleField,
  _umTogglePlazaChip,
  _umToggleRolSection,
  _umValidarNuevo,
  _umInitials,
  _umRenderCards,
  _umRenderEditForm,
  _umRoleBadge,
  _updateAlertaTipoStyle,
  _updateBtnEmitir,
  _visualLogAuditoria,
  abrirAuditoria,
  abrirBuzon,
  abrirChat,
  abrirCreadorAlertas,
  abrirEditorMapa,
  abrirRutaEditmap,
  abrirExpedienteAdmin,
  abrirExpedienteGlobal,
  abrirFormularioFlota,
  abrirGestorAlertas,
  abrirHistorialCuadres,
  abrirIncidencias,
  abrirLightboxChat,
  abrirLogs,
  abrirModalCuadre3V,
  abrirModalEditarGlobal,
  abrirModalEliminarGlobal,
  abrirModalFlota,
  abrirModalInsertarAdmin,
  abrirModalInsertarExterno,
  abrirModalInsertarGlobal,
  abrirModalNuevaConfig,
  abrirModalResolver,
  abrirModalSolicitudes,
  abrirPanelAdministracion,
  abrirPanelConfiguracion,
  abrirRegistrosMovimientos,
  abrirReporteImpresion,
  abrirResumenFlota,
  abrirSelectorArchivosNota,
  abrirSelectorImagenCuerpoAlerta,
  abrirSiguienteAlerta,
  abrirTabConfig,
  abrirUltimoCuadre,
  abrirUsuarios,
  activarAlertaOlvidados,
  activarModoSwap,
  actualizarContadores,
  actualizarEstadoArchivosAdmin,
  actualizarFechaResumen,
  actualizarMetaNuevaNota,
  actualizarModoAuditoriaUI,
  actualizarPanelLateralFlota,
  actualizarPreviewNuevaNota,
  actualizarResumenIncidencias,
  actualizarTablaLocal,
  adjustZoom,
  agregarCorreoInterno,
  agregarPlazaCatalogo,
  agregarUnidadExtra,
  alertaCmd,
  alertaFontSize,
  alertaInsertHR,
  alertaInsertHtml,
  alertaInsertLink,
  aplicarAutofill,
  aplicarCambioDOM,
  aplicarFiltrosLogs,
  aplicarFormatoIncidencia,
  aplicarVariablesDeEmpresa,
  autocompletarInsertarAdmin,
  buscarEnListaConfig,
  buscarMasivo,
  cambiarModoAuditoria,
  cambiarTabFlota,
  cambiarTabSolicitudes,
  cambiarVistaResumen,
  canAssignRole,
  canEditAdminCuadre,
  canEmitMasterAlerts,
  canLockMap,
  canManageTargetRole,
  canManageUsers,
  canProcessAccessRequests,
  canUseProgrammerConfig,
  canViewAdminCuadre,
  cancelarArchivoChat,
  cancelarAudioChat,
  cancelarRecorteAvatarPerfil,
  cancelarRespuestaChat,
  cargarFlota,
  cargarLogsAuditoria,
  cargarMaestra,
  cargarMasLogs,
  cargarNotasIncidencias,
  cargarPlantillaSeleccionada,
  cargarSolicitudesDeTab,
  cargarSolicitudesPendientes,
  cerrarChat,
  cerrarPanelConfiguracion,
  cerrarCuadre3V,
  cerrarCustomModal,
  cerrarEmojiPickerReaccion,
  cerrarFormularioFlota,
  cerrarIncidencias,
  cerrarLightboxChat,
  cerrarModalFlota,
  cerrarModificadorGlobal,
  cerrarModificadorMaestro,
  cerrarPanel,
  cerrarReserveModal,
  cerrarSesion,
  confirmarReserva,
  cerrarUsuariosModal,
  closeMainSidebars,
  colapsarTerminal,
  compartirWhatsApp,
  comprimirImagenAlerta,
  configurarPermisosUI,
  confirmarAgregadoConfig,
  confirmarBorradoFlotaUI,
  confirmarCierreSesion,
  crearExcelPrediccion,
  debouncedAutofill,
  desbloquearBuscadorGlobal,
  desbloquearEdicionGlobal,
  descargarArchivoLocal,
  descargarPDFPrediccion,
  dibujarMapaCompleto,
  desactivarModoSwap,
  editarAlertaDesdeHistorial,
  editarElementoConfig,
  editarMensajeChat,
  editorAgregarForma,
  editorAlinearGrupo,
  editorCambiarGrid,
  editorCentrarH,
  editorCentrarV,
  editorCopiarCelda,
  editorDistribuirGrupo,
  editorDuplicarFila,
  editorEliminarCelda,
  editorEnviarFondo,
  editorMoverCelda,
  editorPropChange,
  editorSpanChange,
  editorToggleMoreMenu,
  editorTraerFrente,
  editorZoom,
  ejecutarAccionAlertaActual,
  ejecutarAccionGemini,
  ejecutarAccionRapida,
  ejecutarAutoGuardado,
  ejecutarBorradoReal,
  ejecutarCapturaV3,
  ejecutarEdicionGlobal,
  ejecutarEliminacionIncidencia,
  ejecutarFiltroMasivo,
  ejecutarMigracionLegacy,
  ejecutarGuardadoFlota,
  ejecutarInsertarAdmin,
  ejecutarInsertarExterno,
  ejecutarInsertarGlobal,
  ejecutarLimpiarFeed,
  ejecutarLogicaOCR,
  ejecutarPrediccion,
  ejecutarResolucion,
  ejecutarSelloCuadre,
  ejecutarWhatsApp,
  eliminarAlertaDesdeHistorial,
  eliminarArchivoNuevaNota,
  eliminarElementoConfig,
  eliminarLogoEmpresa,
  eliminarMensajeChat,
  eliminarPlazaCatalogo,
  emitirAlertaGlobal,
  enfocarCajon,
  enviarCambioRapido,
  enviarCorreoWebhook,
  enviarMensajeChat,
  enviarReporteAuditoriaFinal,
  enviarSolicitudAcceso,
  esAdjuntoImagenIncidencia,
  escapeHtml,
  estadoDragNota,
  expandirTerminal,
  exportarMapa,
  extraerConteoClases,
  filterModernUsers,
  filtrarAutofill,
  filtrarBusquedaAdmin,
  filtrarEdicionGlobal,
  filtrarEspecial,
  filtrarFlota,
  filtrarGlobal,
  filtrarListaNotas,
  filtrarSolicitudesActuales,
  finalizacionFlota,
  finalizarCuadre3V,
  finalizarPaseLista,
  formatearFechaDocumento,
  formatearTamanoArchivo,
  generarCodigoIncidencia,
  generarHtmlActividadDiaria,
  generarHtmlPrediccionPdf,
  generarSlugArchivo,
  guardarComoPlantilla,
  guardarConfiguracionEnFirebase,
  guardarEmpresaConfig,
  guardarEdicionAdmin,
  guardarEdicionGlobal,
  guardarMapaEditor,
  guardarNuevaNota,
  hacerPingNotificaciones,
  hasFullAccess,
  iconoAdjuntoIncidencia,
  inicializarConfiguracion,
  iniciarApp,
  iniciarMisionAuditoria,
  iniciarRadarNotificaciones,
  iniciarRespuestaChat,
  init,
  initTheme,
  insertarImagenCuerpoAlerta,
  irAPaso2,
  limpiarArchivosNuevaNota,
  limpiarBusqueda,
  limpiarEInterfaz,
  limpiarFiltrosFlota,
  limpiarFormularioAltaGlobal,
  limpiarImagenAlerta,
  llamarAlJuezDeAuditoria,
  llenarSelectsDinamicos,
  manejadorFlujoV3,
  manejarArchivosNuevaNota,
  manejarBotonAgregarFlotante,
  manejarDragNota,
  marcarUnidadAudit,
  metaEstadoIncidencia,
  metaPrioridadIncidencia,
  migrarConfiguracionAFirestore,
  modoAgregarEditor,
  mostrarConfirmacionSwap,
  mostrarCustomModal,
  mostrarDetalle,
  mostrarDetalleGlobal,
  mostrarEmojiPickerReaccion,
  moverElementoConfig,
  moverUnidadInmediato,
  notificarRespuestaIA,
  notificarUrgenciaWhatsApp,
  obtenerCredencialesMapa,
  obtenerDisenoCalor,
  obtenerImagenAuto,
  obtenerPrioridadesSeleccionadas,
  obtenerResumenNota,
  parsearTablaSucia,
  plazaGuardarCfg,
  plazaSeleccionarCfg,
  prepararEliminarIncidencia,
  prepararModalInput,
  prepararNuevoFlota,
  procesarActividadDiaria,
  procesarAlertaLeida,
  procesarComandoInteligente,
  procesarImagenOCR,
  procesarInputModal,
  procesarSolicitud,
  procesarUnidadExtra,
  refrescarDatos,
  registrarEventoGestion,
  reiniciarPrediccion,
  renderChatWindow,
  renderContactos,
  renderCorreosInternos,
  renderFlota,
  renderHistorialCuadres,
  limpiarFiltrosArchivero,
  toggleIframe,
  cfgDragStart,
  cfgDragOver,
  cfgDrop,
  cfgToggleModelos,
  _plazaPreviewMaps,
  _plazaAddContact,
  _plazaRemoveContact,
  _programmerConsoleExportConfig,
  _programmerConsoleLoadData,
  _programmerConsoleLoadSelectedPlaza,
  _programmerConsolePushLog,
  _programmerConsoleRefreshCaches,
  _programmerConsoleSaveJsonDraft,
  _programmerConsoleSetJsonDraft,
  renderModernDropdown,
  renderizarAdjuntosIncidencia,
  renderizarArchivosNuevaNota,
  renderizarListaConfig,
  renderizarLogsAuditoria,
  renderizarPaseLista,
  renderizarResumen,
  renderizarTabConfigPlazas,
  renderizarTabConfigSolicitudes,
  renderizarTabConfigUsuarios,
  renderizarTextoNotaHtml,
  renderizarVisorEvidenciasAdmin,
  resetAutofill,
  resetFormularioIncidencia,
  resetUnitToLimbo,
  restaurarBotonFlota,
  seleccionarFilaFlota,
  seleccionarUnidadEdicionGlobal,
  seleccionarUnidadGlobal,
  showToast,
  sincronizarEstadoSidebars,
  sincronizarMapa,
  solicitarGuardadoProgresivo,
  solicitarToggleBloqueo,
  soltarArchivosNota,
  sortFlota,
  stagedArchivoChatV2,
  startAutoRefresh,
  subirLogoEmpresa,
  switchIncTab,
  toggleAdminControls,
  toggleAdminSidebar,
  toggleDarkMode,
  toggleExpandIncidencia,
  toggleGrabacionChat,
  toggleIframe,
  toggleMapaCalor,
  toggleMoreControls,
  toggleMuteIA,
  toggleReaccionChat,
  toggleSidebar,
  umCrearUsuario,
  umEliminar,
  umFiltrar,
  umGuardarCambios,
  umNuevoUsuario,
  umResetPassword,
  umSeleccionar,
  updateZoom,
  validarBotonGuardar,
  validarTextareasActividad,
  verInfoRechazo,
  verLectoresAlerta,
  verificarHabitosUbicacion,
  // Helpers de Config Global (llamados desde HTML inline)
  _cfgActualizarPermisoMeta,
  _cfgActualizarRolBoolean,
  _cfgActualizarRolCampo,
  _cfgCrearRolDesdePanel,
  _cfgEliminarRolSeleccionado,
  _cfgSeleccionarRol,
  _cfgToggleRolPermiso,
  _cfgUpdateColorSwatch,
  _cfgFillColorPresets,
  _cfgSetModalMeta,
  _cfgShowModal,
  _toggleContactExpand,
  _plazaConfirmMaps,
  _togglePlazaFormEdit,
  _abrirModalNuevaplaza,
  _cerrarModalNuevaplaza,
  _confirmarNuevaplaza,
  _plazaGetUserEmailOptions,
  // Plaza isolation helpers
  _miPlaza,
  _puedeVerTodasPlazas,
  _plazasPermitidas,
  // Plaza switcher
  cambiarPlazaMapa,
  _renderPlazaSwitcher,
  _togglePlazaPicker,
  // Chat / perfil
  _actualizarHeaderChatActivo,
  _archiveChatConversation,
  _renderChatFilterOptions,
  _renderPerfilUsuarioActual,
  _restoreChatConversation,
  _abrirProgrammerConsoleRoute,
  abrirInfoContacto,
  abrirInfoContactoActivo,
  abrirPerfilUsuario,
  actualizarFiltrosChat,
  closeNotificationCenter,
  cerrarInfoContacto,
  cerrarPerfilUsuario,
  eliminarAvatarPerfil,
  limpiarFiltrosChat,
  openNotificationCenter,
  prepararNuevoChat,
  guardarAvatarRecortadoPerfil,
  solicitarPermisoNotificacionesDispositivo,
  subirAvatarPerfil,
  ajustarZoomAvatarPerfil,
  _setChatReplyHoverState,
  toggleArchivadosChat,
  toggleArchivoChatActivo,
  // Fase 3
  _togglePlazaTemporal,
  abrirComparadorPlazas,
  cerrarComparadorPlazas,
  exportarComparadorCSV,
  // Fase 4
  abrirModalPDFReservas,
  cerrarModalPDFReservas,
  _onPDFDrop,
  _onPDFFileInput,
  _ejecutarAnalisisPDF,
  // Fase 5
  activarBusquedaVoz,
  // Fase 6
  abrirDuplicarEstructura,
  abrirGuardarPlantilla,
  abrirAplicarPlantilla,
  // Fase 7
  exportarMapaPDF,
  copiarDatosUnidad,
  toggleTagUnidad,
  abrirModalRecordatorio,
  cerrarModalRecordatorio,
  guardarRecordatorio,
  borrarRecordatorio,
  _mostrarPopoverEvidencia,
  _ocultarPopoverEvidencia,
  // Fase 5
  ejecutarBackfillPlaza,
  ejecutarMigracionLegacy,
  // [2.5] Batch
  ejecutarAccionBatch,
  _actualizarBatchBar,
});

// ═══════════════════════════════════════════════════════════
//  FASE 3 — OPERACIÓN INTELIGENTE
// ═══════════════════════════════════════════════════════════

// ── F3.4 Banner global ──────────────────────────────────────

function _actualizarBannerGlobal({ bloqueado, bloqueadoScope, ocupados, totalSpots, alertasCriticas } = {}) {
  if (bloqueado !== undefined) _bannerState.bloqueado = bloqueado;
  if (alertasCriticas !== undefined) _bannerState.alertasCriticas = alertasCriticas;
  if (ocupados !== undefined && totalSpots !== undefined && totalSpots > 0) {
    _bannerState.pctOcup = Math.round((ocupados / totalSpots) * 100);
  }

  const banner = document.getElementById('global-status-banner');
  if (!banner) return;

  const msgs = [];
  let severity = 'info';

  if (_bannerState.bloqueado) {
    const scope = bloqueadoScope || window.MAPA_LOCK_SCOPE || '';
    msgs.push(`🔒 MAPA BLOQUEADO${scope === 'GLOBAL' ? ' — AUDITORÍA GLOBAL' : ' — AUDITORÍA PLAZA'}`);
    severity = 'locked';
  }
  if (_bannerState.pctOcup >= 90) {
    msgs.push(`🔴 SATURACIÓN CRÍTICA: ${_bannerState.pctOcup}% cajones ocupados`);
    severity = severity !== 'locked' ? 'critical' : severity;
  } else if (_bannerState.pctOcup >= 80) {
    msgs.push(`🟡 Saturación alta: ${_bannerState.pctOcup}% ocupado`);
    if (severity === 'info') severity = 'warning';
  }
  if (_bannerState.alertasCriticas > 0) {
    msgs.push(`⚠️ ${_bannerState.alertasCriticas} incidencia${_bannerState.alertasCriticas > 1 ? 's' : ''} pendiente${_bannerState.alertasCriticas > 1 ? 's' : ''}`);
    if (severity === 'info') severity = 'warning';
  }

  if (msgs.length === 0) {
    banner.style.display = 'none';
    return;
  }

  const bgMap = { locked: '#1e293b', critical: '#dc2626', warning: '#d97706', info: '#0369a1' };
  banner.style.cssText = `display:flex; align-items:center; justify-content:center; gap:18px; padding:7px 16px; background:${bgMap[severity]}; color:white; font-size:12px; font-weight:800; letter-spacing:.04em; flex-wrap:wrap; position:relative; z-index:200;`;
  banner.innerHTML = msgs.map(m => `<span>${m}</span>`).join('<span style="opacity:.4;">·</span>');
}

// ── F3.3 Panel de supervisión (KPIs multi-plaza) ────────────
let _supervisionUnsub = null;

function _actualizarPanelSupervision() {
  const panel = document.getElementById('panel-supervision');
  if (!panel) return;

  // Solo visible para roles que pueden ver todas las plazas
  const canSeeAll = _puedeVerTodasPlazas && _puedeVerTodasPlazas();
  if (!canSeeAll) { panel.style.display = 'none'; return; }

  const plazas = window.MEX_CONFIG?.empresa?.plazas || [];
  if (plazas.length <= 1) { panel.style.display = 'none'; return; }

  const data = _supervisionData;
  const plazasConDatos = plazas.filter(p => data[p]);
  if (plazasConDatos.length === 0) { panel.style.display = 'none'; return; }

  panel.style.cssText = 'display:flex; gap:8px; overflow-x:auto; padding:6px 12px; background:rgba(15,23,42,0.9); backdrop-filter:blur(6px); border-radius:0 0 12px 12px; position:relative; z-index:190; flex-wrap:nowrap; scrollbar-width:none;';

  panel.innerHTML = plazasConDatos.map(plaza => {
    const d = data[plaza] || {};
    const pct = d.totalSpots > 0 ? Math.round(((d.total || 0) / d.totalSpots) * 100) : 0;
    const pctColor = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981';
    const plazasDetalle = window.MEX_CONFIG?.empresa?.plazasDetalle || [];
    const detalle = plazasDetalle.find(x => x.id === plaza) || {};
    const esTemporal = detalle.temporal;
    return `<div style="display:flex; flex-direction:column; align-items:center; gap:3px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:8px 12px; min-width:90px; flex-shrink:0; ${esTemporal ? 'border-color:#f59e0b44;' : ''}">
      <div style="font-size:11px; font-weight:900; color:white; letter-spacing:.05em;">${escapeHtml(plaza)}${esTemporal ? ' <span style="font-size:8px;color:#f59e0b;">TEMP</span>' : ''}</div>
      <div style="font-size:9px; color:${pctColor}; font-weight:800;">${pct}% ocupado</div>
      <div style="display:flex; gap:5px; font-size:10px; font-weight:700; color:rgba(255,255,255,.7);">
        <span title="Listos" style="color:#4ade80;">✓${d.listos || 0}</span>
        <span title="Sucios" style="color:#facc15;">⟳${d.sucios || 0}</span>
        <span title="Manto" style="color:#f87171;">⚙${d.manto || 0}</span>
        ${(d.traslados || 0) > 0 ? `<span title="Traslados" style="color:#c084fc;">🚛${d.traslados}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  panel.style.display = 'flex';
}

// Actualizar datos de supervisión cuando se reciben unidades
function _actualizarSupervisionConUnidades(unidades) {
  if (!_puedeVerTodasPlazas || !_puedeVerTodasPlazas()) return;
  const plazas = window.MEX_CONFIG?.empresa?.plazas || [];
  if (plazas.length <= 1) return;

  const newData = {};
  unidades.forEach(unit => {
    const p = _normalizePlaza(unit?.plaza || unit?.plazaId || '');
    if (!p) return;
    if (!newData[p]) newData[p] = { total: 0, listos: 0, sucios: 0, manto: 0, traslados: 0 };
    const estado = (unit?.estado || '').toUpperCase();
    newData[p].total++;
    if (estado === 'LISTO') newData[p].listos++;
    else if (estado === 'SUCIO') newData[p].sucios++;
    else if (estado === 'MANTENIMIENTO' || estado === 'TALLER') newData[p].manto++;
    else if (estado === 'TRASLADO') newData[p].traslados++;
  });
  _supervisionData = newData;
  window._supervisionData = _supervisionData;
  _actualizarPanelSupervision();
}

// ── F3.2 Comparador de plazas ───────────────────────────────
let _comparadorCache = null;

async function _obtenerMetricasComparadorPlaza(plaza) {
  const [lista, estructura] = await Promise.all([
    api.obtenerDatosFlotaConsola(plaza),
    api.obtenerEstructuraMapa(plaza)
  ]);

  const registros = Array.isArray(lista) ? lista : [];
  const totalSpots = Array.isArray(estructura)
    ? estructura.filter(item => String(item?.tipo || (item?.esLabel ? 'label' : 'cajon')).trim().toLowerCase() === 'cajon').length
    : 0;

  const metricas = {
    plaza,
    total: registros.length,
    listos: 0,
    sucios: 0,
    manto: 0,
    externos: 0,
    traslados: 0,
    totalSpots,
    ocupacion: totalSpots > 0 ? Math.round((registros.length / totalSpots) * 100) : null
  };

  registros.forEach(item => {
    const estado = String(item?.estado || '').trim().toUpperCase();
    const ubicacion = String(item?.ubicacion || '').trim().toUpperCase();
    if (estado === 'LISTO') metricas.listos++;
    if (estado === 'SUCIO') metricas.sucios++;
    if (estado === 'MANTENIMIENTO' || estado === 'TALLER' || estado === 'NO ARRENDABLE' || estado === 'RETENIDA') metricas.manto++;
    if (estado === 'TRASLADO') metricas.traslados++;
    if (ubicacion === 'EXTERNO') metricas.externos++;
  });

  return metricas;
}

async function abrirComparadorPlazas() {
  const modal = document.getElementById('modal-comparador-plazas');
  if (!modal) return;
  modal.style.display = 'flex';
  _renderComparadorLoading();
  try {
    const plazas = window.MEX_CONFIG?.empresa?.plazas || [];
    if (plazas.length === 0) {
      document.getElementById('comparador-content').innerHTML =
        '<div style="text-align:center; padding:40px; color:#94a3b8; font-weight:700;">No hay plazas configuradas.</div>';
      return;
    }
    const resultados = await Promise.all(plazas.map(async p => {
      try {
        return await _obtenerMetricasComparadorPlaza(p);
      } catch {
        return { plaza: p, error: true };
      }
    }));
    _comparadorCache = resultados;
    _renderComparadorTabla(resultados);
  } catch (e) {
    document.getElementById('comparador-content').innerHTML =
      `<div style="text-align:center; padding:40px; color:#ef4444; font-weight:700;">Error cargando datos: ${escapeHtml(String(e.message || e))}</div>`;
  }
}

function _renderComparadorLoading() {
  const c = document.getElementById('comparador-content');
  if (!c) return;
  c.innerHTML = '<div style="text-align:center; padding:40px; color:#94a3b8; font-weight:700; display:flex; align-items:center; justify-content:center; gap:10px;"><span class="material-icons" style="animation:spin 1s linear infinite; font-size:22px;">sync</span> Cargando datos de todas las plazas...</div>';
}

function _renderComparadorTabla(resultados) {
  const c = document.getElementById('comparador-content');
  if (!c) return;
  const plazasDetalle = window.MEX_CONFIG?.empresa?.plazasDetalle || [];
  const exitosos = resultados.filter(item => !item.error);

  const cols = [
    { key: 'total', label: 'Total', color: '#0f172a' },
    { key: 'listos', label: 'Listos', color: '#10b981' },
    { key: 'sucios', label: 'Sucios', color: '#f59e0b' },
    { key: 'manto', label: 'Manto.', color: '#ef4444' },
    { key: 'externos', label: 'Externos', color: '#6366f1' },
    { key: 'ocupacion', label: '% Ocup.', color: '#0ea5e9' },
  ];

  const topOcupacion = exitosos
    .filter(item => typeof item.ocupacion === 'number')
    .sort((a, b) => b.ocupacion - a.ocupacion)[0];
  const topListos = [...exitosos].sort((a, b) => (b.listos || 0) - (a.listos || 0))[0];
  const totalUnidades = exitosos.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const totalExternos = exitosos.reduce((sum, item) => sum + Number(item.externos || 0), 0);

  const resumenCards = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px;">
      <div style="padding:12px 14px;border-radius:14px;background:#eff6ff;border:1px solid #bfdbfe;">
        <div style="font-size:11px;font-weight:900;color:#1d4ed8;letter-spacing:.06em;text-transform:uppercase;">Unidades consolidadas</div>
        <div style="font-size:26px;font-weight:900;color:#0f172a;margin-top:4px;">${totalUnidades}</div>
        <div style="font-size:11px;color:#64748b;font-weight:700;">Lectura rápida de todas las plazas</div>
      </div>
      <div style="padding:12px 14px;border-radius:14px;background:#fefce8;border:1px solid #fde68a;">
        <div style="font-size:11px;font-weight:900;color:#b45309;letter-spacing:.06em;text-transform:uppercase;">Mayor ocupación</div>
        <div style="font-size:26px;font-weight:900;color:#0f172a;margin-top:4px;">${topOcupacion ? `${topOcupacion.ocupacion}%` : '—'}</div>
        <div style="font-size:11px;color:#64748b;font-weight:700;">${escapeHtml(topOcupacion?.plaza || 'Sin datos')}</div>
      </div>
      <div style="padding:12px 14px;border-radius:14px;background:#f0fdf4;border:1px solid #bbf7d0;">
        <div style="font-size:11px;font-weight:900;color:#047857;letter-spacing:.06em;text-transform:uppercase;">Plaza más lista</div>
        <div style="font-size:26px;font-weight:900;color:#0f172a;margin-top:4px;">${topListos ? topListos.listos : 0}</div>
        <div style="font-size:11px;color:#64748b;font-weight:700;">${escapeHtml(topListos?.plaza || 'Sin datos')}</div>
      </div>
      <div style="padding:12px 14px;border-radius:14px;background:#eef2ff;border:1px solid #c7d2fe;">
        <div style="font-size:11px;font-weight:900;color:#4338ca;letter-spacing:.06em;text-transform:uppercase;">Externos activos</div>
        <div style="font-size:26px;font-weight:900;color:#0f172a;margin-top:4px;">${totalExternos}</div>
        <div style="font-size:11px;color:#64748b;font-weight:700;">Total detectado en comparativo</div>
      </div>
    </div>
  `;

  const filas = resultados.map(r => {
    const d = plazasDetalle.find(x => x.id === r.plaza) || {};
    const total = Number(r.total || r.totalUnidades || 0);
    const listos = Number(r.listos || r.totalListos || 0);
    const sucios = Number(r.sucios || r.totalSucios || 0);
    const manto = Number(r.manto || r.totalManto || r.totalMantenimiento || 0);
    const externos = Number(r.externos || r.totalExternos || 0);
    const spots = Number(r.totalSpots || r.cajones || 0);
    const pctOcup = typeof r.ocupacion === 'number' ? r.ocupacion : (spots > 0 ? Math.round((total / spots) * 100) : '—');
    const esTemporal = d.temporal;
    const badgeTemp = esTemporal ? `<span style="font-size:9px; background:#f59e0b; color:white; padding:1px 5px; border-radius:4px; font-weight:800; margin-left:4px;">TEMP</span>` : '';

    if (r.error) {
      return `<tr>
        <td style="font-weight:800; padding:10px 12px;">${escapeHtml(r.plaza)}${badgeTemp}</td>
        <td colspan="${cols.length}" style="color:#ef4444; font-size:12px; font-weight:700; padding:10px 12px;">Error al cargar datos</td>
      </tr>`;
    }
    const ocupPct = typeof pctOcup === 'number' ? pctOcup : 0;
    const ocupColor = ocupPct >= 90 ? '#dc2626' : ocupPct >= 80 ? '#d97706' : '#10b981';
    return `<tr style="border-bottom:1px solid #f1f5f9;">
      <td style="font-weight:900; padding:11px 12px; color:#0f172a; font-size:13px;">${escapeHtml(r.plaza)}${badgeTemp}<br><span style="font-size:10px; color:#94a3b8; font-weight:600;">${escapeHtml(d.localidad || d.nombre || '')}</span></td>
      <td style="text-align:center; padding:11px 8px; font-weight:800; font-size:14px;">${total}</td>
      <td style="text-align:center; padding:11px 8px; font-weight:800; font-size:14px; color:#10b981;">${listos}</td>
      <td style="text-align:center; padding:11px 8px; font-weight:800; font-size:14px; color:#f59e0b;">${sucios}</td>
      <td style="text-align:center; padding:11px 8px; font-weight:800; font-size:14px; color:#ef4444;">${manto}</td>
      <td style="text-align:center; padding:11px 8px; font-weight:800; font-size:14px; color:#6366f1;">${externos}</td>
      <td style="text-align:center; padding:11px 8px; font-weight:800; font-size:14px; color:${ocupColor};">${typeof pctOcup === 'number' ? pctOcup + '%' : '—'}</td>
    </tr>`;
  }).join('');

  c.innerHTML = `
    ${resumenCards}
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
            <th style="text-align:left; padding:10px 12px; font-weight:900; color:#475569; font-size:11px; text-transform:uppercase; letter-spacing:.06em;">Plaza</th>
            ${cols.map(col => `<th style="text-align:center; padding:10px 8px; font-weight:900; color:${col.color}; font-size:11px; text-transform:uppercase; letter-spacing:.06em; min-width:70px;">${col.label}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
    <div style="margin-top:10px; font-size:11px; color:#94a3b8; font-weight:600; text-align:right;">
      Última consulta: ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
      · <button onclick="abrirComparadorPlazas()" style="background:none;border:none;color:#0ea5e9;font-size:11px;font-weight:800;cursor:pointer;">Actualizar</button>
    </div>`;
}

function cerrarComparadorPlazas() {
  const modal = document.getElementById('modal-comparador-plazas');
  if (modal) modal.style.display = 'none';
}

function exportarComparadorCSV() {
  if (!_comparadorCache?.length) { showToast('Abre el comparador primero', 'warning'); return; }
  const plazasDetalle = window.MEX_CONFIG?.empresa?.plazasDetalle || [];
  const encabezado = ['Plaza', 'Localidad', 'Temporal', 'Total', 'Listos', 'Sucios', 'Manto', 'Externos', '% Ocup'];
  const filas = _comparadorCache.map(r => {
    const d = plazasDetalle.find(x => x.id === r.plaza) || {};
    const total = r.total || r.totalUnidades || 0;
    const spots = r.totalSpots || r.cajones || 0;
    const pct = spots > 0 ? Math.round((total / spots) * 100) : '';
    return [
      r.plaza,
      d.localidad || d.nombre || '',
      d.temporal ? 'TEMPORAL' : 'FIJA',
      total,
      r.listos || r.totalListos || 0,
      r.sucios || r.totalSucios || 0,
      r.manto || r.totalManto || r.totalMantenimiento || 0,
      r.externos || r.totalExternos || 0,
      pct !== '' ? pct + '%' : '—'
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  const csv = [encabezado.join(','), ...filas].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `comparador_plazas_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast('CSV exportado correctamente', 'success');
}

// ═══════════════════════════════════════════════════════════
//  FASE 4 — SATURACIÓN Y PROYECCIÓN OPERATIVA
// ═══════════════════════════════════════════════════════════

// ── F4.1  Modal de carga ────────────────────────────────────
function abrirModalPDFReservas() {
  const modal = document.getElementById('modal-pdf-reservas');
  if (!modal) return;
  // Limpiar estado previo
  const ta = document.getElementById('pdf-texto-bruto');
  const res = document.getElementById('pdf-resultados');
  if (ta) ta.value = '';
  if (res) { res.style.display = 'none'; res.innerHTML = ''; }
  const dz = document.getElementById('pdf-drop-zone');
  if (dz) { dz.style.borderColor = '#cbd5e1'; dz.style.background = ''; }
  modal.style.display = 'flex';
}

function cerrarModalPDFReservas() {
  const modal = document.getElementById('modal-pdf-reservas');
  if (modal) modal.style.display = 'none';
}

function _onPDFDrop(event) {
  event.preventDefault();
  const dz = document.getElementById('pdf-drop-zone');
  if (dz) { dz.style.borderColor = '#cbd5e1'; dz.style.background = ''; }
  const file = event.dataTransfer?.files?.[0];
  if (file) _procesarArchivoReservas(file);
}

function _onPDFFileInput(input) {
  const file = input?.files?.[0];
  if (file) _procesarArchivoReservas(file);
}

function _procesarArchivoReservas(file) {
  const dz = document.getElementById('pdf-drop-zone');
  if (dz) {
    dz.innerHTML = `<span class="material-icons" style="font-size:28px;color:#0284c7;display:block;margin-bottom:6px;animation:spin 1s linear infinite;">sync</span><div style="font-size:12px;font-weight:800;color:#0369a1;">Leyendo ${escapeHtml(file.name)}...</div>`;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result || '';
    const ta = document.getElementById('pdf-texto-bruto');
    if (ta) ta.value = text;
    if (dz) {
      dz.innerHTML = `<span class="material-icons" style="font-size:28px;color:#10b981;display:block;margin-bottom:6px;">check_circle</span><div style="font-size:12px;font-weight:800;color:#10b981;">Archivo cargado: ${escapeHtml(file.name)}</div>`;
    }
  };
  reader.onerror = () => {
    showToast('No se pudo leer el archivo', 'error');
    if (dz) dz.innerHTML = `<span class="material-icons" style="font-size:38px;color:#94a3b8;display:block;margin-bottom:8px;">upload_file</span><div style="font-size:13px;font-weight:800;color:#475569;">Arrastra tu PDF aquí o haz clic para seleccionar</div><div style="font-size:11px;color:#94a3b8;margin-top:4px;">Reportes de reservas, regresos o asignaciones</div><input id="pdf-file-input" type="file" accept=".pdf,.txt" style="display:none" onchange="_onPDFFileInput(this)">`;
  };
  // Leer como texto (funciona para .txt; PDFs se leen como texto con metadata extraíble)
  reader.readAsText(file, 'UTF-8');
}

// ── F4.1  Parser de texto (reservas / regresos / entregas) ──
function _parsearTextoReservas(texto) {
  const lineas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const resultados = [];

  // Patrones: MVA = letra(s) + 3-5 dígitos, flexible a muchos formatos
  const reMVA = /\b([A-Z]{1,3}\d{3,5})\b/g;
  // Palabras clave de acción
  const keywordsEntrada = /\b(reserva|reservado|reservar|ingresa|ingreso|entreg[ao]|llegad[ao]|retorno|regreso)\b/i;
  const keywordsSalida  = /\b(sale|sali[oó]|salida|retira|retiro|desasign|libera|liberar)\b/i;
  // Fecha: DD/MM/YY, DD-MM-YY, DD/MM/YYYY
  const reFecha = /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/;

  lineas.forEach(linea => {
    let mva;
    reMVA.lastIndex = 0;
    while ((mva = reMVA.exec(linea)) !== null) {
      const codigo = mva[1].toUpperCase();
      let accion = 'DESCONOCIDO';
      if (keywordsEntrada.test(linea)) accion = 'ENTRADA';
      else if (keywordsSalida.test(linea)) accion = 'SALIDA';

      let fecha = null;
      const mf = reFecha.exec(linea);
      if (mf) {
        const dia = mf[1].padStart(2, '0');
        const mes = mf[2].padStart(2, '0');
        const anio = mf[3] ? (mf[3].length === 2 ? '20' + mf[3] : mf[3]) : new Date().getFullYear();
        fecha = `${anio}-${mes}-${dia}`;
      }

      // Evitar duplicados en la misma línea
      if (!resultados.find(r => r.mva === codigo && r.linea === linea)) {
        resultados.push({ mva: codigo, accion, fecha, linea: linea.slice(0, 120) });
      }
    }
  });

  return resultados;
}

// ── F4.2  Motor de proyección operativa ────────────────────
function _calcularPresionOperativa(reservas) {
  const enPatio = _ultimaFlotaMapa?.length || 0;
  const totalSpots = _bannerState._totalSpots || 0;
  const disponibles = Math.max(0, totalSpots - enPatio);

  const entradas = reservas.filter(r => r.accion === 'ENTRADA').length;
  const salidas  = reservas.filter(r => r.accion === 'SALIDA').length;
  const noIdentif = reservas.filter(r => r.accion === 'DESCONOCIDO').length;

  const proyectado = enPatio + entradas - salidas;
  const pctProyectado = totalSpots > 0 ? Math.round((proyectado / totalSpots) * 100) : null;

  let nivel = 'OK'; // OK | MEDIO | ALTO | CRITICO
  if (pctProyectado !== null) {
    if (pctProyectado >= 95) nivel = 'CRITICO';
    else if (pctProyectado >= 85) nivel = 'ALTO';
    else if (pctProyectado >= 70) nivel = 'MEDIO';
  }

  return { enPatio, disponibles, totalSpots, entradas, salidas, noIdentif, proyectado, pctProyectado, nivel };
}

// ── F4.2  Recomendaciones contextuales ─────────────────────
function _generarRecomendaciones(presion) {
  const recs = [];
  const { nivel, disponibles, entradas, salidas, noIdentif } = presion;

  if (nivel === 'CRITICO') {
    recs.push({ tipo: 'danger', icono: 'error', titulo: 'Saturación crítica proyectada', texto: `Con ${entradas} entradas y ${salidas} salidas, el patio quedaría al ${presion.pctProyectado}%. Activar resguardo temporal o redistribuir unidades a otra plaza.` });
    if (disponibles < entradas) {
      recs.push({ tipo: 'danger', icono: 'block', titulo: `Déficit de ${entradas - disponibles} cajones`, texto: 'No hay suficiente espacio físico para absorber todas las entradas. Gestionar traslados antes del ingreso.' });
    }
  } else if (nivel === 'ALTO') {
    recs.push({ tipo: 'warning', icono: 'warning', titulo: 'Saturación alta', texto: `El patio llegaría al ${presion.pctProyectado}%. Considerar redistribuir unidades LISTAS o en MANTENIMIENTO a patios secundarios.` });
  } else if (nivel === 'MEDIO') {
    recs.push({ tipo: 'info', icono: 'info', titulo: 'Presión moderada', texto: `Proyección al ${presion.pctProyectado}%. Monitorear regresos programados y priorizar lavado de unidades SUCIAS.` });
  } else {
    recs.push({ tipo: 'success', icono: 'check_circle', titulo: 'Capacidad suficiente', texto: `Patio proyectado al ${presion.pctProyectado !== null ? presion.pctProyectado + '%' : '—'}. No se anticipan conflictos de espacio.` });
  }

  if (noIdentif > 0) {
    recs.push({ tipo: 'info', icono: 'help_outline', titulo: `${noIdentif} unidad(es) sin acción identificada`, texto: 'Revisar manualmente las líneas donde no se detectó RESERVA, REGRESO ni SALIDA.' });
  }

  return recs;
}

// ── F4  Ejecutar análisis y renderizar resultado ────────────
function _ejecutarAnalisisPDF() {
  const ta = document.getElementById('pdf-texto-bruto');
  const texto = ta?.value?.trim() || '';
  if (!texto) { showToast('Pega texto o carga un archivo primero', 'warning'); return; }

  const btn = document.getElementById('btn-analizar-pdf');
  const origHtml = btn?.innerHTML;
  if (btn) { btn.innerHTML = '<span class="material-icons" style="font-size:18px;animation:spin 1s linear infinite;">sync</span> Analizando...'; btn.disabled = true; }

  // Pequeño delay para que la UI actualice antes del procesamiento sincrónico
  setTimeout(() => {
    try {
      const reservas = _parsearTextoReservas(texto);
      const presion = _calcularPresionOperativa(reservas);
      const recs = _generarRecomendaciones(presion);
      _renderResultadosPDF(reservas, presion, recs);
      // Actualizar panel de recomendación en el mapa
      _actualizarPanelRecomendacion(presion, recs);
    } catch (err) {
      showToast('Error al analizar el texto', 'error');
      console.error('[F4] Error análisis PDF:', err);
    } finally {
      if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
    }
  }, 80);
}

function _renderResultadosPDF(reservas, presion, recs) {
  const container = document.getElementById('pdf-resultados');
  if (!container) return;

  const colores = { danger: '#dc2626', warning: '#d97706', info: '#0369a1', success: '#059669' };
  const bg = { danger: '#fef2f2', warning: '#fffbeb', info: '#f0f9ff', success: '#f0fdf4' };
  const border = { danger: '#fecaca', warning: '#fde68a', info: '#bae6fd', success: '#bbf7d0' };

  const recHtml = recs.map(r => `
    <div style="background:${bg[r.tipo]}; border:1.5px solid ${border[r.tipo]}; border-radius:10px; padding:12px 14px; display:flex; gap:10px; align-items:flex-start;">
      <span class="material-icons" style="color:${colores[r.tipo]}; font-size:20px; flex-shrink:0; margin-top:1px;">${r.icono}</span>
      <div>
        <div style="font-size:12px; font-weight:900; color:${colores[r.tipo]}; margin-bottom:3px;">${escapeHtml(r.titulo)}</div>
        <div style="font-size:11px; color:#475569; font-weight:600; line-height:1.5;">${escapeHtml(r.texto)}</div>
      </div>
    </div>`).join('');

  const pctColor = presion.pctProyectado !== null
    ? (presion.pctProyectado >= 90 ? '#dc2626' : presion.pctProyectado >= 75 ? '#d97706' : '#059669')
    : '#94a3b8';

  const listaUnidades = reservas.slice(0, 60).map(r => {
    const aColor = r.accion === 'ENTRADA' ? '#059669' : r.accion === 'SALIDA' ? '#dc2626' : '#94a3b8';
    const aLabel = r.accion === 'ENTRADA' ? '↓ ENT' : r.accion === 'SALIDA' ? '↑ SAL' : '?';
    return `<div style="display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid #f1f5f9; font-size:11px;">
      <span style="font-weight:900; color:#0f172a; min-width:60px;">${escapeHtml(r.mva)}</span>
      <span style="font-weight:800; color:${aColor}; min-width:40px;">${aLabel}</span>
      <span style="color:#94a3b8; font-weight:600;">${r.fecha || '—'}</span>
      <span style="color:#64748b; font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:200px;" title="${escapeHtml(r.linea)}">${escapeHtml(r.linea)}</span>
    </div>`;
  }).join('');

  container.style.display = 'block';
  container.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px;">
      <div style="background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:10px; padding:12px; text-align:center;">
        <div style="font-size:22px; font-weight:900; color:#0f172a;">${reservas.length}</div>
        <div style="font-size:10px; color:#64748b; font-weight:800; text-transform:uppercase; letter-spacing:.05em;">Unidades detectadas</div>
      </div>
      <div style="background:#f0fdf4; border:1.5px solid #bbf7d0; border-radius:10px; padding:12px; text-align:center;">
        <div style="font-size:22px; font-weight:900; color:#059669;">${presion.entradas}</div>
        <div style="font-size:10px; color:#059669; font-weight:800; text-transform:uppercase; letter-spacing:.05em;">Entradas</div>
      </div>
      <div style="background:#fef2f2; border:1.5px solid #fecaca; border-radius:10px; padding:12px; text-align:center;">
        <div style="font-size:22px; font-weight:900; color:#dc2626;">${presion.salidas}</div>
        <div style="font-size:10px; color:#dc2626; font-weight:800; text-transform:uppercase; letter-spacing:.05em;">Salidas</div>
      </div>
    </div>
    <div style="background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:10px; padding:14px; margin-bottom:14px;">
      <div style="font-size:11px; font-weight:900; color:#475569; text-transform:uppercase; letter-spacing:.06em; margin-bottom:10px;">Proyección de ocupación</div>
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
        <div style="flex:1; height:10px; background:#e2e8f0; border-radius:99px; overflow:hidden;">
          <div style="height:100%; width:${Math.min(100, presion.pctProyectado || 0)}%; background:${pctColor}; border-radius:99px; transition:width .6s;"></div>
        </div>
        <div style="font-size:18px; font-weight:900; color:${pctColor}; min-width:46px; text-align:right;">${presion.pctProyectado !== null ? presion.pctProyectado + '%' : '—'}</div>
      </div>
      <div style="display:flex; gap:16px; font-size:11px; font-weight:700; color:#64748b;">
        <span>Actual: <strong style="color:#0f172a;">${presion.enPatio}</strong></span>
        <span>Proyectado: <strong style="color:${pctColor};">${presion.proyectado}</strong></span>
        <span>Cajones totales: <strong style="color:#0f172a;">${presion.totalSpots || '—'}</strong></span>
        <span>Disponibles: <strong style="color:#0f172a;">${presion.disponibles}</strong></span>
      </div>
    </div>
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:14px;">${recHtml}</div>
    ${reservas.length > 0 ? `
    <details style="border:1.5px solid #e2e8f0; border-radius:10px; overflow:hidden;">
      <summary style="padding:10px 14px; font-size:11px; font-weight:900; color:#475569; text-transform:uppercase; letter-spacing:.06em; cursor:pointer; background:#f8fafc;">
        Detalle de unidades detectadas (${reservas.length})
      </summary>
      <div style="padding:8px 14px; max-height:220px; overflow-y:auto;">
        ${listaUnidades}
        ${reservas.length > 60 ? `<div style="text-align:center; font-size:11px; color:#94a3b8; padding:8px;">... y ${reservas.length - 60} más</div>` : ''}
      </div>
    </details>` : ''}`;
}

// ── F4  Panel de recomendación inline en el mapa ────────────
function _actualizarPanelRecomendacion(presion, recs) {
  const panel = document.getElementById('panel-recomendacion');
  if (!panel) return;
  if (!presion || recs.length === 0) { panel.style.display = 'none'; return; }

  // Solo mostrar si hay presión media o mayor
  if (presion.nivel === 'OK' && presion.noIdentif === 0) { panel.style.display = 'none'; return; }

  const top = recs[0];
  const colores = { danger: '#dc2626', warning: '#d97706', info: '#0369a1', success: '#059669' };
  const bgMap   = { danger: 'rgba(220,38,38,0.12)', warning: 'rgba(217,119,6,0.12)', info: 'rgba(3,105,161,0.12)', success: 'rgba(5,150,105,0.12)' };

  panel.style.cssText = `display:flex; align-items:center; gap:10px; padding:7px 14px; margin:0 12px 6px; background:${bgMap[top.tipo]}; border:1px solid ${colores[top.tipo]}33; border-radius:10px; font-size:12px; position:relative; z-index:185; animation:bannerSlideIn .3s ease;`;
  panel.innerHTML = `
    <span class="material-icons" style="color:${colores[top.tipo]};font-size:18px;flex-shrink:0;">${top.icono}</span>
    <div style="flex:1;">
      <span style="font-weight:900; color:${colores[top.tipo]};">${escapeHtml(top.titulo)}</span>
      <span style="color:#475569; font-weight:600; margin-left:6px;">${escapeHtml(top.texto)}</span>
    </div>
    <button onclick="abrirModalPDFReservas()" style="background:none;border:1px solid ${colores[top.tipo]}55;border-radius:6px;padding:3px 8px;font-size:10px;font-weight:900;cursor:pointer;color:${colores[top.tipo]};flex-shrink:0;">Ver detalle</button>
    <button onclick="document.getElementById('panel-recomendacion').style.display='none'" style="background:none;border:none;cursor:pointer;padding:2px;flex-shrink:0;">
      <span class="material-icons" style="font-size:14px;color:#94a3b8;">close</span>
    </button>`;
}

// Disparar recomendación automática cuando saturación ≥80% (sin PDF)
function _autoRecomendacionSaturacion(pct) {
  if (pct < 80) {
    const p = document.getElementById('panel-recomendacion');
    if (p && p.dataset.source !== 'pdf') p.style.display = 'none';
    return;
  }
  const nivel = pct >= 95 ? 'CRITICO' : pct >= 85 ? 'ALTO' : 'MEDIO';
  const presionAuto = {
    enPatio: _ultimaFlotaMapa?.length || 0,
    disponibles: 0,
    totalSpots: 0,
    entradas: 0, salidas: 0, noIdentif: 0,
    proyectado: 0, pctProyectado: pct, nivel
  };
  const recsAuto = _generarRecomendaciones(presionAuto);
  const panel = document.getElementById('panel-recomendacion');
  if (panel) panel.dataset.source = 'auto';
  _actualizarPanelRecomendacion(presionAuto, recsAuto);
}

// ═══════════════════════════════════════════════════════════
//  FASE 5 — VOZ E INTERACCIÓN
// ═══════════════════════════════════════════════════════════

// ── F5.1  Tabla fonética NATO (ES + EN) ────────────────────
const _NATO_MAP = {
  'ALFA':'A','ALPHA':'A',
  'BRAVO':'B',
  'CHARLIE':'C','CHARLI':'C',
  'DELTA':'D',
  'ECO':'E','ECHO':'E',
  'FOXTROT':'F','FOX':'F',
  'GOLF':'G',
  'HOTEL':'H',
  'INDIA':'I',
  'JULIETT':'J','JULIETA':'J','JULIET':'J',
  'KILO':'K',
  'LIMA':'L',
  'MIKE':'M','MIGUEL':'M',
  'NOVIEMBRE':'N','NOVEMBER':'N',
  'OSCAR':'O',
  'PAPA':'P',
  'QUEBEC':'Q','KEBEC':'Q',
  'ROMEO':'R',
  'SIERRA':'S',
  'TANGO':'T',
  'UNIFORME':'U','UNIFORM':'U',
  'VICTOR':'V',
  'WHISKEY':'W','WHISKY':'W',
  'XRAY':'X','EQUIS':'X',
  'YANKI':'Y','YANKEE':'Y',
  'ZULU':'Z',
};

// ── F5.1  Parser NATO → MVA ─────────────────────────────────
// "Delta 2019" → "D2019"  |  "alfa bravo 1234" → "AB1234"
function _parsearNATO(texto) {
  if (!texto) return texto;
  // Normalizar: mayúsculas, sin acentos
  const normalizado = texto.trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const palabras = normalizado.split(/\s+/);

  let letras = '';
  let numeros = '';
  let modoNumeros = false;

  for (const palabra of palabras) {
    if (!modoNumeros && _NATO_MAP[palabra]) {
      letras += _NATO_MAP[palabra];
    } else if (/^\d+$/.test(palabra)) {
      numeros += palabra;
      modoNumeros = true;
    } else if (!modoNumeros && /^[A-Z]$/.test(palabra)) {
      letras += palabra;
    } else if (modoNumeros) {
      break; // después de los dígitos, parar
    }
  }

  if (letras && numeros) return letras + numeros;
  if (letras && !numeros) return letras;
  // No se detectaron palabras NATO, devolver el texto original limpio
  return normalizado.replace(/\s+/g, '');
}

// ── F5.1  Motor de voz ─────────────────────────────────────
let _vozRecognition = null;
let _vozActiva = false;

function activarBusquedaVoz(esMobile) {
  esMobile = !!esMobile;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast('Tu navegador no soporta búsqueda por voz', 'warning');
    return;
  }

  // Si ya está activa, detener
  if (_vozActiva && _vozRecognition) {
    _vozRecognition.stop();
    return;
  }

  const btnDesktop = document.getElementById('btn-voz-busqueda');
  const btnMobile  = document.getElementById('btn-voz-busqueda-mobile');
  const transcriptDesktop = document.getElementById('voz-transcript-bar');
  const transcriptMobile  = document.getElementById('voz-transcript-bar-mobile');

  _setVozUI(true, btnDesktop, btnMobile, transcriptDesktop, transcriptMobile);

  _vozRecognition = new SR();
  _vozRecognition.lang = 'es-MX';
  _vozRecognition.interimResults = true;
  _vozRecognition.maxAlternatives = 3;
  _vozActiva = true;

  _vozRecognition.onresult = (event) => {
    const isFinal = event.results[event.results.length - 1].isFinal;
    const textoInterim = Array.from(event.results)
      .map(r => r[0].transcript)
      .join(' ')
      .trim();

    // Mostrar transcripción en tiempo real
    [transcriptDesktop, transcriptMobile].forEach(el => {
      if (el) el.textContent = '🎙️ ' + (textoInterim || '...');
    });

    if (!isFinal) return;

    // Resultado final: probar las 3 alternativas, tomar la que produzca un MVA válido primero
    const alternativas = Array.from(event.results[0]).map(a => a.transcript.trim());
    let query = _parsearNATO(alternativas[0]);
    for (const alt of alternativas) {
      const parsed = _parsearNATO(alt);
      if (/^[A-Z]{1,3}\d{3,5}$/.test(parsed)) { query = parsed; break; }
    }

    // Rellenar ambas barras de búsqueda
    ['searchInput', 'searchInputMobile'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = query;
    });
    // Disparar búsqueda
    if (typeof ejecutarFiltroMasivo === 'function') ejecutarFiltroMasivo();
    showToast(`\uD83C\uDF99\uFE0F Buscando: "${query}"`, 'info');
  };

  _vozRecognition.onerror = (event) => {
    if (event.error !== 'aborted') {
      const msgs = {
        'not-allowed': 'Permiso de micrófono denegado',
        'no-speech':   'No se detectó voz, intenta de nuevo',
        'network':     'Error de red al procesar voz',
      };
      showToast(msgs[event.error] || 'Error de reconocimiento de voz', 'warning');
    }
    _setVozUI(false, btnDesktop, btnMobile, transcriptDesktop, transcriptMobile);
    _vozActiva = false;
  };

  _vozRecognition.onend = () => {
    _setVozUI(false, btnDesktop, btnMobile, transcriptDesktop, transcriptMobile);
    _vozActiva = false;
  };

  _vozRecognition.start();
}

function _setVozUI(activa, btnDesktop, btnMobile, transcriptDesktop, transcriptMobile) {
  [btnDesktop, btnMobile].forEach(btn => {
    if (!btn) return;
    if (activa) {
      btn.classList.add('voz-activa');
      btn.title = 'Escuchando… (clic para detener)';
    } else {
      btn.classList.remove('voz-activa');
      btn.style.color = '';
      btn.style.background = '';
      btn.title = 'Buscar por voz — alfabeto NATO (ej: "Delta 2019")';
    }
  });
  [transcriptDesktop, transcriptMobile].forEach(el => {
    if (!el) return;
    if (activa) {
      el.textContent = '🎙️ Escuchando…';
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
      el.textContent = '';
    }
  });
  ['searchInput', 'searchInputMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (activa) {
      el.placeholder = '🎙️ Escuchando...';
      el.style.borderColor = 'rgba(239,68,68,0.5)';
    } else {
      el.placeholder = 'MVA, Placas o Modelo...';
      el.style.borderColor = '';
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  FASE 6 — CONFIGURACIÓN Y REUTILIZACIÓN
// ═══════════════════════════════════════════════════════════

// ── F6.1  Duplicar estructura entre plazas ──────────────────
async function abrirDuplicarEstructura(plazaOrigen) {
  const plazas = (window.MEX_CONFIG?.empresa?.plazas || []).filter(p => p !== plazaOrigen);
  if (plazas.length === 0) {
    showToast('No hay otras plazas disponibles como destino', 'warning');
    return;
  }

  const opciones = plazas.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  const html = `
    <div style="padding:4px 0;">
      <p style="font-size:13px; color:#475569; margin:0 0 12px; font-weight:600;">
        Copia la estructura del mapa de <strong>${escapeHtml(plazaOrigen)}</strong> a otra plaza.<br>
        <span style="color:#ef4444; font-size:11px; font-weight:800;">La estructura destino será reemplazada.</span>
      </p>
      <label style="font-size:11px; font-weight:800; color:#64748b; display:block; margin-bottom:5px;">PLAZA DESTINO</label>
      <select id="dup-plaza-destino" style="width:100%; padding:9px 12px; border:1.5px solid #e2e8f0; border-radius:8px; font-size:13px; font-weight:700; color:#0f172a; outline:none;">
        ${opciones}
      </select>
    </div>`;

  mostrarCustomModal(
    `Duplicar estructura — ${plazaOrigen}`,
    html,
    async () => {
      const destino = document.getElementById('dup-plaza-destino')?.value;
      if (!destino) {
        showToast('Selecciona una plaza destino', 'warning');
        return false;
      }
      try {
        showToast('Duplicando estructura...', 'info');
        const res = await api.duplicarEstructuraMapa(plazaOrigen, destino);
        await registrarEventoGestion('MAPA_ESTRUCTURA_DUPLICADA', `Duplicó estructura de ${plazaOrigen} hacia ${destino}`, {
          entidad: 'MAPA_ESTRUCTURA',
          referencia: plazaOrigen,
          objetivo: destino,
          plazaObjetivo: destino,
          resultado: `COPIADAS_${res.total || 0}_CELDAS`
        });
        showToast(`✓ Estructura duplicada a ${destino} (${res.total} celdas)`, 'success');
      } catch (err) {
        showToast(err.message || 'Error al duplicar estructura', 'error');
        return false;
      }
      return true;
    },
    'Duplicar',
    'Cancelar'
  );
}

// ── F6.2  Guardar como plantilla ───────────────────────────
async function abrirGuardarPlantilla(plazaId) {
  const html = `
    <div style="padding:4px 0;">
      <p style="font-size:13px; color:#475569; margin:0 0 12px; font-weight:600;">
        Guarda la estructura actual de <strong>${escapeHtml(plazaId)}</strong> como plantilla reutilizable.
      </p>
      <label style="font-size:11px; font-weight:800; color:#64748b; display:block; margin-bottom:5px;">NOMBRE DE LA PLANTILLA</label>
      <input id="plantilla-nombre-input" type="text" placeholder="Ej: Patio estándar 50 cajones"
        style="width:100%; padding:9px 12px; border:1.5px solid #e2e8f0; border-radius:8px; font-size:13px; font-weight:700; color:#0f172a; outline:none; box-sizing:border-box;"
        onfocus="this.style.borderColor='#0284c7'" onblur="this.style.borderColor='#e2e8f0'">
    </div>`;

  mostrarCustomModal(
    `Guardar plantilla — ${plazaId}`,
    html,
    async () => {
      const nombre = document.getElementById('plantilla-nombre-input')?.value?.trim();
      if (!nombre) {
        showToast('Escribe un nombre para la plantilla', 'warning');
        return false;
      }
      try {
        const estructura = await api.obtenerEstructuraMapa(plazaId);
        showToast('Guardando plantilla...', 'info');
        const res = await api.guardarPlantillaMapa(nombre, estructura);
        await registrarEventoGestion('MAPA_PLANTILLA_GUARDADA', `Guardó la plantilla ${nombre} desde ${plazaId}`, {
          entidad: 'MAPA_PLANTILLA',
          referencia: nombre,
          objetivo: plazaId,
          plazaObjetivo: plazaId,
          resultado: `GUARDADA_${res.total || 0}_CELDAS`
        });
        showToast(`✓ Plantilla "${nombre}" guardada (${res.total} celdas)`, 'success');
      } catch (err) {
        showToast(err.message || 'Error al guardar plantilla', 'error');
        return false;
      }
      return true;
    },
    'Guardar',
    'Cancelar'
  );
}

// ── F6.2  Aplicar plantilla a una plaza ────────────────────
async function abrirAplicarPlantilla(plazaId) {
  // Primero cargar lista de plantillas
  let plantillas = [];
  try {
    plantillas = await api.listarPlantillasMapa();
  } catch (err) {
    showToast('Error al cargar plantillas', 'error');
    return;
  }

  if (plantillas.length === 0) {
    showToast('No hay plantillas guardadas aún', 'info');
    return;
  }

  const opciones = plantillas.map(p => `
    <option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre)} — ${p.totalCeldas || '?'} celdas</option>`).join('');

  const html = `
    <div style="padding:4px 0;">
      <p style="font-size:13px; color:#475569; margin:0 0 12px; font-weight:600;">
        Aplica una plantilla a <strong>${escapeHtml(plazaId)}</strong>.<br>
        <span style="color:#ef4444; font-size:11px; font-weight:800;">Reemplaza la estructura actual de la plaza.</span>
      </p>
      <label style="font-size:11px; font-weight:800; color:#64748b; display:block; margin-bottom:5px;">PLANTILLA</label>
      <select id="plantilla-select" style="width:100%; padding:9px 12px; border:1.5px solid #e2e8f0; border-radius:8px; font-size:13px; font-weight:700; color:#0f172a; outline:none;">
        ${opciones}
      </select>
    </div>`;

  mostrarCustomModal(
    `Aplicar plantilla — ${plazaId}`,
    html,
    async () => {
      const id = document.getElementById('plantilla-select')?.value;
      if (!id) {
        showToast('Selecciona una plantilla', 'warning');
        return false;
      }
      try {
        showToast('Aplicando plantilla...', 'info');
        const elementos = await api.obtenerPlantillaMapa(id);
        await api.guardarEstructuraMapa(elementos, plazaId);
        await registrarEventoGestion('MAPA_PLANTILLA_APLICADA', `Aplicó la plantilla ${id} sobre ${plazaId}`, {
          entidad: 'MAPA_PLANTILLA',
          referencia: id,
          objetivo: plazaId,
          plazaObjetivo: plazaId,
          resultado: `APLICADA_${elementos.length || 0}_CELDAS`
        });
        showToast(`✓ Plantilla aplicada a ${plazaId} (${elementos.length} celdas)`, 'success');
      } catch (err) {
        showToast(err.message || 'Error al aplicar plantilla', 'error');
        return false;
      }
      return true;
    },
    'Aplicar',
    'Cancelar'
  );
}

// ═══════════════════════════════════════════════════════════
//  FASE 7 — UTILIDADES DE UNIDAD
// ═══════════════════════════════════════════════════════════

// ── F7.1  Export mapa como PDF ──────────────────────────────
function exportarMapaPDF() {
  showToast('Preparando PDF...', 'info');
  const gridMap = document.getElementById('grid-map');
  if (!gridMap) return;
  const prevZoom = zoomLevel;
  zoomLevel = 1;
  updateZoom();
  setTimeout(() => {
    html2canvas(gridMap, {
      backgroundColor: '#2A3441',
      scale: 2,
      useCORS: true,
      width: gridMap.scrollWidth,
      height: gridMap.scrollHeight,
    }).then(canvas => {
      zoomLevel = prevZoom;
      updateZoom();
      const dataUrl = canvas.toDataURL('image/png');
      const printWin = window.open('', '_blank');
      if (!printWin) { showToast('Activa ventanas emergentes para exportar PDF', 'warning'); return; }
      printWin.document.write(`<!DOCTYPE html><html><head><title>Mapa Patio ${new Date().toLocaleDateString('es-MX')}</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#fff;}img{max-width:100%;height:auto;display:block;}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}</style></head><body><img src="${dataUrl}" style="width:100%;"><script>setTimeout(()=>{window.print();},400);<\/script></body></html>`);
      printWin.document.close();
      showToast('PDF listo — usa Ctrl+P para guardar', 'success');
    }).catch(() => {
      zoomLevel = prevZoom;
      updateZoom();
      showToast('Error al generar PDF', 'error');
    });
  }, 400);
}

// ── F7.2  Copiar datos de unidad al portapapeles ────────────
function copiarDatosUnidad(mva) {
  const car = document.getElementById(`auto-${mva}`);
  if (!car) return;
  const d = _ultimaFlotaMapa?.find(u => (u.mva || u.id || '').toUpperCase() === mva.toUpperCase()) || {};
  const parent = car.parentElement;
  const loc = parent?.classList?.contains('spot')
    ? _spotValueFromElement(parent)
    : (parent?.id?.includes('taller') ? 'TALLER' : 'LIMBO');
  const texto = [
    `MVA: ${d.mva || mva}`,
    `Placas: ${d.placas || 'N/A'}`,
    `Modelo: ${d.modelo || 'S/M'}`,
    `Estado: ${d.estado || 'N/A'}`,
    `Ubicacion: ${loc}`,
    d.notas ? `Notas: ${d.notas}` : null,
  ].filter(Boolean).join('\n');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(texto).then(() => showToast('Datos copiados al portapapeles', 'success'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = texto; ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    showToast('Datos copiados', 'success');
  }
}

// ── F7.3  Preview evidencia inline ─────────────────────────
function _mostrarPopoverEvidencia(mva, targetEl) {
  const unidad = _ultimaFlotaMapa?.find(u => (u.mva || '').toUpperCase() === mva.toUpperCase());
  const evs = unidad ? _obtenerEvidenciasUnidad(unidad) : [];
  if (!evs.length) return;
  const popover = document.getElementById('popover-evidencia');
  const img     = document.getElementById('popover-evidencia-img');
  const label   = document.getElementById('popover-evidencia-label');
  if (!popover || !img) return;
  img.src = evs[0].url || evs[0];
  if (label) label.textContent = `${mva} · ${evs.length} foto${evs.length > 1 ? 's' : ''}`;
  const rect = targetEl.getBoundingClientRect();
  const top  = Math.max(8, rect.top - 180);
  const left = Math.min(window.innerWidth - 240, rect.right + 8);
  popover.style.cssText = `display:block; position:fixed; top:${top}px; left:${left}px; z-index:75400; pointer-events:none;`;
}

function _ocultarPopoverEvidencia() {
  const p = document.getElementById('popover-evidencia');
  if (p) p.style.display = 'none';
}

function _obtenerEvidenciasUnidad(u) {
  if (Array.isArray(u.evidencias) && u.evidencias.length) return u.evidencias.filter(e => e && (e.url || typeof e === 'string'));
  const leg = u.url || u.URL || u.urlArchivo || u.urlEvidencia || u.evidencia || '';
  return leg ? [{ url: leg }] : [];
}

// ── F7.4  Nota rápida desde panel ──────────────────────────
function _renderNotaRapida(mva) {
  const container = document.getElementById('panel-nota-rapida');
  if (!container) return;
  const unidad = _ultimaFlotaMapa?.find(u => (u.mva || '').toUpperCase() === mva.toUpperCase());
  const notaActual = unidad?.notas || '';
  const tieneNota = notaActual.trim().length > 0;
  const collapsed = container.dataset.collapsed !== 'false';
  container.innerHTML = `
    <button onclick="
      const b=this.closest('[id]');
      const body=b.querySelector('.panel-collapsible-body');
      const ic=b.querySelector('.panel-toggle-icon');
      const isOpen=body.style.display!=='none';
      body.style.display=isOpen?'none':'flex';
      ic.textContent=isOpen?'expand_more':'expand_less';
      b.dataset.collapsed=isOpen?'true':'false';
    " style="width:100%;background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:0;gap:6px;">
      <span style="font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;display:flex;align-items:center;gap:5px;">
        Nota rápida${tieneNota ? `<span style="background:#10b981;color:#fff;border-radius:10px;padding:1px 6px;font-size:9px;">●</span>` : ''}
      </span>
      <span class="material-icons panel-toggle-icon" style="font-size:16px;color:#94a3b8;">${collapsed ? 'expand_more' : 'expand_less'}</span>
    </button>
    <div class="panel-collapsible-body" style="display:${collapsed ? 'none' : 'flex'};flex-direction:column;gap:6px;padding-top:6px;">
      <div style="display:flex;gap:6px;align-items:flex-start;">
        <textarea id="nota-rapida-input-${mva}" rows="2"
          style="flex:1;padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12px;font-weight:600;color:#334155;resize:none;outline:none;font-family:inherit;transition:border-color .2s;"
          onfocus="this.style.borderColor='#0284c7'" onblur="this.style.borderColor='#e2e8f0'"
          placeholder="Agregar nota...">${escapeHtml(notaActual)}</textarea>
        <button onclick="_guardarNotaRapida('${mva}')"
          style="background:#0284c7;color:white;border:none;border-radius:8px;padding:7px 10px;font-size:11px;font-weight:900;cursor:pointer;flex-shrink:0;display:flex;align-items:center;">
          <span class="material-icons" style="font-size:14px;">save</span>
        </button>
      </div>
    </div>`;
}

async function _guardarNotaRapida(mva) {
  const ta = document.getElementById(`nota-rapida-input-${mva}`);
  if (!ta) return;
  const unidad = _ultimaFlotaMapa?.find(u => (u.mva || '').toUpperCase() === mva.toUpperCase());
  if (!unidad) { showToast('Unidad no encontrada', 'error'); return; }
  try {
    ta.disabled = true;
    await api.aplicarEstado(mva, unidad.estado, unidad.ubicacion, unidad.gasolina, ta.value.trim(), false, USER_NAME, USER_NAME, _miPlaza());
    showToast('Nota guardada', 'success');
  } catch { showToast('Error al guardar nota', 'error'); }
  finally { ta.disabled = false; }
}

// ── F7.5  Etiquetas de color ────────────────────────────────
const _TAG_COLORS = {
  rojo:    { dot: '#ef4444', border: '#ef4444', label: 'Urgente' },
  naranja: { dot: '#f97316', border: '#f97316', label: 'Pendiente' },
  amarillo:{ dot: '#eab308', border: '#eab308', label: 'Atención' },
  verde:   { dot: '#22c55e', border: '#22c55e', label: 'OK' },
  azul:    { dot: '#3b82f6', border: '#3b82f6', label: 'Reservado' },
  morado:  { dot: '#8b5cf6', border: '#8b5cf6', label: 'Externo' },
};

const _extrasCache = {};

async function _cargarExtrasUnidad(mva) {
  if (_extrasCache[mva] !== undefined) return _extrasCache[mva];
  try {
    _extrasCache[mva] = await api.obtenerExtrasUnidad(mva, _miPlaza()) || {};
  } catch { _extrasCache[mva] = {}; }
  return _extrasCache[mva];
}

function _renderTagsUnidad(mva, extras) {
  const container = document.getElementById('panel-tags-unidad');
  if (!container) return;
  const tags = extras?.tags || [];
  const activos = tags.length;
  const chips = Object.entries(_TAG_COLORS).map(([key, c]) => {
    const activo = tags.includes(key);
    return `<button onclick="toggleTagUnidad('${mva}','${key}')" title="${c.label}"
      style="width:22px;height:22px;border-radius:50%;border:2.5px solid ${activo ? c.border : '#d1d5db'};background:${activo ? c.dot : '#fff'};cursor:pointer;transition:all .15s;flex-shrink:0;"></button>`;
  }).join('');
  const collapsed = container.dataset.collapsed !== 'false';
  container.innerHTML = `
    <button onclick="
      const b=this.closest('[id]');
      const body=b.querySelector('.panel-collapsible-body');
      const ic=b.querySelector('.panel-toggle-icon');
      const isOpen=body.style.display!=='none';
      body.style.display=isOpen?'none':'flex';
      ic.textContent=isOpen?'expand_more':'expand_less';
      b.dataset.collapsed=isOpen?'true':'false';
    " style="width:100%;background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:0;gap:6px;">
      <span style="font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;display:flex;align-items:center;gap:5px;">
        Etiqueta${activos > 0 ? `<span style="background:#3b82f6;color:#fff;border-radius:10px;padding:1px 6px;font-size:9px;">${activos}</span>` : ''}
      </span>
      <span class="material-icons panel-toggle-icon" style="font-size:16px;color:#94a3b8;">${collapsed ? 'expand_more' : 'expand_less'}</span>
    </button>
    <div class="panel-collapsible-body" style="display:${collapsed ? 'none' : 'flex'};gap:6px;align-items:center;padding-top:6px;">${chips}</div>`;
}

async function toggleTagUnidad(mva, tag) {
  const extras = await _cargarExtrasUnidad(mva);
  const tags = [...(extras.tags || [])];
  const idx = tags.indexOf(tag);
  if (idx >= 0) tags.splice(idx, 1); else tags.push(tag);
  extras.tags = tags;
  _extrasCache[mva] = extras;
  try {
    await api.actualizarExtrasUnidad(mva, { tags }, _miPlaza());
  } catch { showToast('Error al guardar etiqueta', 'error'); return; }
  _renderTagsUnidad(mva, extras);
  _actualizarTagsBadgeCar(mva, tags);
}

function _actualizarTagsBadgeCar(mva, tags) {
  const car = document.getElementById(`auto-${mva}`);
  if (!car) return;
  let badge = car.querySelector('.car-tags-badge');
  if (!badge && tags.length > 0) {
    badge = document.createElement('div');
    badge.className = 'car-tags-badge';
    badge.style.cssText = 'position:absolute;bottom:2px;right:2px;display:flex;gap:2px;z-index:2;';
    car.style.position = 'relative';
    car.appendChild(badge);
  }
  if (!badge) return;
  badge.innerHTML = tags.map(t => {
    const c = _TAG_COLORS[t];
    return c ? `<span style="width:6px;height:6px;border-radius:50%;background:${c.dot};display:inline-block;"></span>` : '';
  }).join('');
  badge.style.display = tags.length > 0 ? 'flex' : 'none';
}

// ── F7.6  Recordatorios ─────────────────────────────────────
function abrirModalRecordatorio(mva) {
  _cargarExtrasUnidad(mva).then(extras => {
    const rec = extras.recordatorio || {};
    document.getElementById('recordatorio-mva').value  = mva;
    document.getElementById('recordatorio-fecha').value  = rec.fecha || '';
    document.getElementById('recordatorio-mensaje').value = rec.mensaje || '';
    document.getElementById('modal-recordatorio').style.display = 'flex';
  });
}

function cerrarModalRecordatorio() {
  document.getElementById('modal-recordatorio').style.display = 'none';
}

async function guardarRecordatorio() {
  const mva    = document.getElementById('recordatorio-mva').value;
  const fecha  = document.getElementById('recordatorio-fecha').value;
  const mensaje = document.getElementById('recordatorio-mensaje').value.trim();
  if (!fecha) { showToast('Selecciona una fecha', 'warning'); return; }
  const extras = _extrasCache[mva] || {};
  extras.recordatorio = { fecha, mensaje };
  _extrasCache[mva] = extras;
  try {
    await api.actualizarExtrasUnidad(mva, { recordatorio: extras.recordatorio }, _miPlaza());
    showToast('Recordatorio guardado', 'success');
    cerrarModalRecordatorio();
    _actualizarRecordatorioBadgeCar(mva, extras.recordatorio);
    _renderRecordatorioUnidad(mva, extras);
  } catch { showToast('Error al guardar recordatorio', 'error'); }
}

async function borrarRecordatorio() {
  const mva = document.getElementById('recordatorio-mva').value;
  const extras = _extrasCache[mva] || {};
  extras.recordatorio = null;
  _extrasCache[mva] = extras;
  try {
    await api.actualizarExtrasUnidad(mva, { recordatorio: null }, _miPlaza());
    showToast('Recordatorio eliminado', 'success');
    cerrarModalRecordatorio();
    _actualizarRecordatorioBadgeCar(mva, null);
    _renderRecordatorioUnidad(mva, extras);
  } catch { showToast('Error al eliminar recordatorio', 'error'); }
}

function _actualizarRecordatorioBadgeCar(mva, recordatorio) {
  const car = document.getElementById(`auto-${mva}`);
  if (!car) return;
  let badge = car.querySelector('.car-reminder-badge');
  if (recordatorio?.fecha) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'car-reminder-badge material-icons';
      badge.style.cssText = 'position:absolute;top:2px;right:2px;font-size:11px;z-index:3;text-shadow:0 0 3px rgba(0,0,0,.6);';
      badge.textContent = 'alarm';
      car.style.position = 'relative';
      car.appendChild(badge);
    }
    const hoy = new Date().toISOString().slice(0, 10);
    badge.style.color = recordatorio.fecha <= hoy ? '#ef4444' : '#f59e0b';
  } else if (badge) {
    badge.remove();
  }
}

function _renderRecordatorioUnidad(mva, extras) {
  const container = document.getElementById('panel-recordatorio-unidad');
  if (!container) return;
  const rec = extras?.recordatorio;
  if (!rec?.fecha) {
    container.innerHTML = `
      <button onclick="abrirModalRecordatorio('${mva}')"
        style="background:none;border:1px dashed #e2e8f0;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:800;color:#94a3b8;cursor:pointer;display:flex;align-items:center;gap:5px;width:100%;justify-content:center;">
        <span class="material-icons" style="font-size:14px;">alarm_add</span> Agregar recordatorio
      </button>`;
    return;
  }
  const hoy = new Date().toISOString().slice(0, 10);
  const vencido = rec.fecha <= hoy;
  const color = vencido ? '#ef4444' : '#d97706';
  container.innerHTML = `
    <div style="background:${vencido ? '#fef2f2' : '#fffbeb'};border:1.5px solid ${color}33;border-radius:8px;padding:7px 10px;display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="abrirModalRecordatorio('${mva}')">
      <span class="material-icons" style="color:${color};font-size:16px;flex-shrink:0;">alarm</span>
      <div style="flex:1;">
        <div style="font-size:11px;font-weight:900;color:${color};">${rec.fecha}${vencido ? ' — VENCIDO' : ''}</div>
        ${rec.mensaje ? `<div style="font-size:10px;color:#475569;font-weight:600;">${escapeHtml(rec.mensaje)}</div>` : ''}
      </div>
      <span class="material-icons" style="font-size:14px;color:#94a3b8;">edit</span>
    </div>`;
}

// ── F7  Panel de extras: cargar al abrir detalle ────────────
async function _renderPanelExtrasUnidad(mva) {
  const panel = document.getElementById('panel-extras-unidad');
  if (!panel) return;
  panel.style.display = 'flex';
  const unidad = _ultimaFlotaMapa?.find(u => (u.mva || '').toUpperCase() === mva.toUpperCase());
  const evs = unidad ? _obtenerEvidenciasUnidad(unidad) : [];
  const accionesEl = document.getElementById('panel-acciones-rapidas');
  if (accionesEl) {
    accionesEl.innerHTML = evs.length > 0 ? `
      <button onmouseenter="_mostrarPopoverEvidencia('${mva}',this)" onmouseleave="_ocultarPopoverEvidencia()"
        style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:800;cursor:pointer;color:#334155;display:flex;align-items:center;gap:4px;">
        <span class="material-icons" style="font-size:14px;color:#059669;">photo_camera</span>${evs.length} foto${evs.length > 1 ? 's' : ''}
      </button>` : '';
  }
  const extras = await _cargarExtrasUnidad(mva);
  _renderTagsUnidad(mva, extras);
  _renderNotaRapida(mva);
  _renderRecordatorioUnidad(mva, extras);
}

// ── F7  Verificar recordatorios al iniciar ─────────────────
async function _verificarRecordatoriosVencidos() {
  try {
    const extrasMap = await api.obtenerExtrasPlaza(_miPlaza());
    const hoy = new Date().toISOString().slice(0, 10);
    let vencidos = 0;
    Object.values(extrasMap).forEach(extras => {
      if (extras.recordatorio?.fecha && extras.recordatorio.fecha <= hoy) vencidos++;
      if (extras.tags?.length) _actualizarTagsBadgeCar(extras.mva, extras.tags);
      if (extras.recordatorio?.fecha) _actualizarRecordatorioBadgeCar(extras.mva, extras.recordatorio);
    });
    if (vencidos > 0) showToast(`🔔 ${vencidos} recordatorio${vencidos > 1 ? 's' : ''} vencido${vencidos > 1 ? 's' : ''}`, 'warning');
  } catch { /* silencioso */ }
}

// ═══════════════════════════════════════════════════════════
//  FASE 5 — MIGRACIÓN LEGACY → SUBCOLLECTIONS
// ═══════════════════════════════════════════════════════════

// ── UI helper: actualizar barra de progreso en el panel cfg ─
function _migSetUI(btnId, barId, labelId, pctId, logId, progressId) {
  return {
    setLoading(text) {
      const btn = document.getElementById(btnId);
      if (btn) { btn.disabled = true; btn.innerHTML = `<span class="material-icons" style="font-size:16px;animation:spin 1s linear infinite;">sync</span> ${text}`; }
      const p = document.getElementById(progressId);
      if (p) p.style.display = 'block';
      const l = document.getElementById(logId);
      if (l) l.style.display = 'block';
    },
    setProgress(label, pct) {
      const lbl = document.getElementById(labelId); if (lbl) lbl.textContent = label;
      const p = document.getElementById(pctId); if (p) p.textContent = pct + '%';
      const bar = document.getElementById(barId); if (bar) bar.style.width = pct + '%';
    },
    log(msg) {
      const l = document.getElementById(logId);
      if (l) { l.textContent += msg + '\n'; l.scrollTop = l.scrollHeight; }
    },
    setDone(text, color) {
      const btn = document.getElementById(btnId);
      if (btn) { btn.disabled = false; btn.style.background = color || '#10b981'; btn.innerHTML = `<span class="material-icons" style="font-size:16px;">check_circle</span> ${text}`; }
    },
    setError(text) {
      const btn = document.getElementById(btnId);
      if (btn) { btn.disabled = false; btn.innerHTML = `<span class="material-icons" style="font-size:16px;">error</span> ${text}`; btn.style.background = '#ef4444'; }
    },
  };
}

// ── Backfill de campo plaza en unidades legacy ─────────────
async function ejecutarBackfillPlaza() {
  const ok = await mexConfirm(
    'Backfill de plaza en unidades',
    '¿Inyectar el campo "plaza" en documentos que no lo tienen? Operación segura, no borra nada.',
    'warning'
  );
  if (!ok) return;

  const ui = _migSetUI('cfg-bf-btn', 'cfg-bf-bar', 'cfg-bf-label', 'cfg-bf-pct', 'cfg-bf-log', 'cfg-bf-progress');
  ui.setLoading('Inyectando...');
  ui.log('Iniciando backfill de campo plaza...');
  try {
    const res = await api.backfillPlazaEnUnidades(({ col, done, total, errores }) => {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      ui.setProgress(`${col}: ${done}/${total}`, pct);
    });
    ui.log(`Completado: ${res?.ok ?? '?'} docs actualizados, ${res?.errores?.length ?? 0} errores.`);
    ui.setDone('Backfill completado', '#10b981');
    showToast(`Backfill completado: ${res?.ok ?? '?'} docs`, 'success');
  } catch (err) {
    ui.log(`Error: ${err.message}`);
    ui.setError('Error en backfill');
    showToast('Error durante el backfill', 'error');
  }
}

// ── Migración legacy → subcollections ─────────────────────
async function ejecutarMigracionLegacy() {
  const ok = await mexConfirm(
    'Migrar datos legacy a subcollections',
    '¿Copiar los documentos de colecciones planas a sus subcollections por plaza? Esta operación es segura: no borra nada, solo copia donde no existe.',
    'warning'
  );
  if (!ok) return;

  const ui = _migSetUI('cfg-mig-btn', 'cfg-mig-bar', 'cfg-mig-label', 'cfg-mig-pct', 'cfg-mig-log', 'cfg-mig-progress');
  ui.setLoading('Migrando...');
  ui.log('Iniciando migración legacy → subcollections...\n');

  const COLS = ['cuadre', 'externos', 'cuadre_admins', 'historial_cuadres'];
  let colIdx = 0;

  try {
    const res = await api.migrarDatosLegacyAPlazas(({ col, done, total, errores }) => {
      const idx = COLS.indexOf(col);
      if (idx >= 0 && idx > colIdx) { colIdx = idx; ui.log(`✓ ${COLS[idx - 1]} completado`); }
      const colNum = Math.max(0, colIdx);
      const pct = Math.round(((colNum / COLS.length) + (total > 0 ? (done / total) / COLS.length : 0)) * 100);
      ui.setProgress(`${col}: ${done}/${total}  (errores: ${errores})`, Math.min(98, pct));
    });

    const errCount = res.errores?.length || 0;
    ui.setProgress('Completado', 100);
    ui.log(`\n✅ ${res.ok} documentos migrados`);
    if (errCount > 0) {
      ui.log(`⚠️ ${errCount} sin plaza detectada (saltados):`);
      res.errores.slice(0, 20).forEach(e => ui.log('  · ' + e));
    }
    ui.setDone(`Migración completa: ${res.ok} docs`, '#6366f1');
    showToast(`Migración completa: ${res.ok} documentos copiados`, 'success');
  } catch (err) {
    ui.log(`\n❌ Error: ${err.message}`);
    ui.setError('Error en migración');
    showToast('Error durante la migración', 'error');
    console.error('[F5] migración error:', err);
  }
}
