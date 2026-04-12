// ═══════════════════════════════════════════════════════════
//  js/views/mapa.js  —  ES6 Module
//  Vista principal: mapa visual de flota.
//
//  Depende de:
//   - firebase-init.js (cargado como <script> antes que este módulo)
//   - mex-api.js      (cargado como <script>, expone window.api)
//   - database.js     (ES6 module, re-exporta auth/db/COL)
// ═══════════════════════════════════════════════════════════

import { db, auth, COL, ACCESS_ROLE_META } from '/js/core/database.js';

// Acceso al API legacy (mex-api.js lo expone en window.api)
const api = window.api;


    // 1. Blindamos la variable para que NUNCA sea undefined y la app no truene
    window.MEX_CONFIG = {
      empresa: { nombre: "OPTIMA PROVISIONAL" },
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

    function aplicarVariablesDeEmpresa(empresaObj) {
      if(!empresaObj) return;
      const nombre = empresaObj.nombre || "MEX RENT A CAR";
      const color = empresaObj.colorPrincipal || "var(--mex-blue)";

      const lbl = document.getElementById("empresa-cfg-lbl");
      if(lbl) lbl.innerText = nombre;

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
      const r = Math.max(0, parseInt(c.slice(0,2), 16) - Math.round(2.55 * pct));
      const g = Math.max(0, parseInt(c.slice(2,4), 16) - Math.round(2.55 * pct));
      const b = Math.max(0, parseInt(c.slice(4,6), 16) - Math.round(2.55 * pct));
      return `#${[r,g,b].map(v => v.toString(16).padStart(2,'0')).join('')}`;
    }

    async function inicializarConfiguracion() {
      try {
        const config = await api.obtenerConfiguracion(_miPlaza());

        if (config && config.listas) {
          // Auto-seed estados si Firestore no los tiene
          if (!config.listas.estados || config.listas.estados.length === 0) {
            config.listas.estados = ESTADOS_DEFAULT;
            api.guardarConfiguracionListas(config.listas, 'Sistema', _miPlaza()).catch(e => console.warn("No se pudo guardar estados por defecto:", e));
          }
          window.MEX_CONFIG = config;
          console.log("✅ Configuración Global Cargada:", window.MEX_CONFIG);
          aplicarVariablesDeEmpresa(window.MEX_CONFIG.empresa);
          _aplicarColoresEstados();
          if (typeof llenarSelectsDinamicos === 'function') llenarSelectsDinamicos();
          if (typeof _renderPlazaSwitcher === 'function') _renderPlazaSwitcher();
        }
      } catch (error) {
        console.error("❌ Error descargando la configuración:", error);
      }
    }

    // 3. Le decimos a la app que descargue esto en cuanto cargue la página
    document.addEventListener("DOMContentLoaded", () => {
      inicializarConfiguracion();
    });


    // ==========================================
    // 0. DIÁLOGOS MODALES PERSONALIZADOS
    // ==========================================
    let modalConfirmCallback = null;

    function mostrarCustomModal(titulo, texto, icono, colorIcono, textConfirm, colorBtn, onConfirm) {
      document.getElementById('modalTitle').innerText = titulo;
      document.getElementById('modalText').innerText = texto;
      const ic = document.getElementById('modalIcon');
      ic.innerText = icono;
      ic.style.color = colorIcono;

      const btn = document.getElementById('modalConfirmBtn');
      btn.innerText = textConfirm;
      btn.style.background = colorBtn;

      modalConfirmCallback = onConfirm;
      document.getElementById('customModal').classList.add('active');
    }

    function cerrarCustomModal() {
      document.getElementById('customModal').classList.remove('active');
      modalConfirmCallback = null;
    }

    document.getElementById('modalConfirmBtn').addEventListener('click', () => {
      if (modalConfirmCallback) modalConfirmCallback();
      cerrarCustomModal();
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

    function showToast(msg, type = 'success') {
      const box = document.getElementById('toastContainer');
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
    function _esPlazaFija(ubiNombre) {
      if(!window.MEX_CONFIG || !window.MEX_CONFIG.listas || !window.MEX_CONFIG.listas.ubicaciones) {
        return ['PATIO', 'TALLER', 'AGENCIA', 'TALLER EXTERNO', 'HYP COBIAN'].includes(ubiNombre); // Fallback safe
      }
      const item = window.MEX_CONFIG.listas.ubicaciones.find(u => (typeof u === 'object' ? (u.id || u.nombre) : u) === ubiNombre);
      if(!item) return ['PATIO', 'TALLER', 'AGENCIA', 'TALLER EXTERNO', 'HYP COBIAN'].includes(ubiNombre);
      return typeof item === 'object' ? item.isPlazaFija : ['PATIO', 'TALLER', 'AGENCIA', 'TALLER EXTERNO', 'HYP COBIAN'].includes(item);
    }

    function _obtenerPlazaOperativaCuadreAdmin(fallback = '') {
      return _normalizePlaza(
        (currentUserProfile && (currentUserProfile.plazaAsignada || currentUserProfile.plaza))
        || fallback
        || ''
      );
    }

    function _resolverResponsableCuadreAdmin(item = {}) {
      const ubicacionRaw = String(item.ubicacion || '').trim();
      const ubicacion = ubicacionRaw.replace(/^👤\s*/i, '').trim();
      const ubicacionUpper = ubicacion.toUpperCase();
      if (ubicacion && !_esPlazaFija(ubicacionUpper)) return ubicacion;
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
        status.innerText = inputId === 'a_ins_file'
          ? '⚪ SIN EVIDENCIA SELECCIONADA'
          : '⚪ SIN EVIDENCIA NUEVA SELECCIONADA';
        return;
      }
      const nombre = total === 1 ? input.files[0].name : `${total} archivos seleccionados`;
      status.innerText = `📎 ${nombre}`;
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
        renderFlota(DB_FLOTA);
        document.getElementById('statTotal').innerText = DB_FLOTA.length;
        document.getElementById('statListos').innerText = DB_FLOTA.filter(d => d.estado === 'LISTO').length;
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

    setTimeout(actualizarPanelLateralFlota, 0);

    // loginConToken eliminado (reemplazado por loginManual en el módulo de autenticación)


    // ==========================================
    // 1. LÓGICA DE LOGIN Y ROLES
    // ==========================================
    const ROLE_META = Object.freeze({
      AUXILIAR: {
        level: 10, label: 'AUXILIAR', isAdmin: false, fullAccess: false,
        canManageUsers: false, canProcessAccessRequests: false, canEmitMasterAlerts: false,
        canEditAdminCuadre: false, canViewAdminCuadre: false, canUseProgrammerConfig: false, canLockMap: false
      },
      VENTAS: {
        level: 20, label: 'VENTAS', isAdmin: true, fullAccess: false,
        canManageUsers: false, canProcessAccessRequests: false, canEmitMasterAlerts: false,
        canEditAdminCuadre: false, canViewAdminCuadre: true, canUseProgrammerConfig: false, canLockMap: false
      },
      GERENTE_PLAZA: {
        level: 25, label: 'GERENTE DE PLAZA', isAdmin: true, fullAccess: false,
        canManageUsers: false, canProcessAccessRequests: false, canEmitMasterAlerts: false,
        canEditAdminCuadre: false, canViewAdminCuadre: true, canUseProgrammerConfig: false, canLockMap: false
      },
      JEFE_REGIONAL: {
        level: 30, label: 'JEFE REGIONAL', isAdmin: true, fullAccess: false,
        canManageUsers: false, canProcessAccessRequests: false, canEmitMasterAlerts: false,
        canEditAdminCuadre: true, canViewAdminCuadre: true, canUseProgrammerConfig: false, canLockMap: false
      },
      CORPORATIVO_USER: {
        level: 40, label: 'CORPORATIVO USER', isAdmin: true, fullAccess: true,
        canManageUsers: true, canProcessAccessRequests: true, canEmitMasterAlerts: true,
        canEditAdminCuadre: true, canViewAdminCuadre: true, canUseProgrammerConfig: true, canLockMap: true
      },
      PROGRAMADOR: {
        level: 50, label: 'PROGRAMADOR', isAdmin: true, fullAccess: true,
        canManageUsers: true, canProcessAccessRequests: true, canEmitMasterAlerts: true,
        canEditAdminCuadre: true, canViewAdminCuadre: true, canUseProgrammerConfig: true, canLockMap: true
      },
      JEFE_OPERACION: {
        level: 60, label: 'JEFE DE OPERACION', isAdmin: true, fullAccess: true,
        canManageUsers: true, canProcessAccessRequests: true, canEmitMasterAlerts: true,
        canEditAdminCuadre: true, canViewAdminCuadre: true, canUseProgrammerConfig: true, canLockMap: true
      }
    });
    const ROLE_OPTIONS = Object.keys(ROLE_META);
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
        telefono: String(raw.telefono || '').trim()
      };
    }

    // Plaza activa en el mapa (puede cambiar si JEFE_REGIONAL cambia de vista)
    let PLAZA_ACTIVA_MAPA = '';

    function _miPlaza() {
      if (PLAZA_ACTIVA_MAPA) return PLAZA_ACTIVA_MAPA;
      if (currentUserProfile?.plazaAsignada) return currentUserProfile.plazaAsignada;
      // Fallback para fullAccess sin plaza asignada: primera plaza configurada
      const plazas = window.MEX_CONFIG?.empresa?.plazas;
      return (Array.isArray(plazas) && plazas.length > 0) ? plazas[0] : '';
    }
    function _puedeVerTodasPlazas() { return hasFullAccess(); }
    function _plazasPermitidas() {
      if (_puedeVerTodasPlazas()) return null; // null = sin restricción
      const rol = _roleMeta().level;
      const pp = currentUserProfile?.plazasPermitidas;
      if (rol >= 30 && Array.isArray(pp) && pp.length > 0) return [currentUserProfile.plazaAsignada, ...pp].filter(Boolean);
      return [currentUserProfile?.plazaAsignada].filter(Boolean);
    }

    function _setSessionProfile(profile) {
      currentUserProfile = profile;
      USER_NAME = profile.nombre || profile.usuario || '';
      userAccessRole = profile.rol || 'AUXILIAR';
      userRole = profile.isAdmin ? 'admin' : 'visitante';
      isGlobalAdmin = _roleMeta(userAccessRole).fullAccess;
      // Inicializar plaza activa del mapa con la plaza del usuario
      PLAZA_ACTIVA_MAPA = profile.plazaAsignada || '';
      window.CURRENT_USER_PROFILE = profile;
    }

    function _clearSessionProfile() {
      currentUserProfile = null;
      USER_NAME = "";
      userAccessRole = "AUXILIAR";
      userRole = null;
      isGlobalAdmin = false;
      window.CURRENT_USER_PROFILE = null;
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

    function _actualizarIdentidadSidebarUsuario() {
      const profile = window.CURRENT_USER_PROFILE || {};
      const nombre = USER_NAME || profile.nombre || 'SIN SESIÓN';
      const roleLabel = profile.roleLabel || _roleMeta().label;
      const plaza = profile.plazaAsignada ? ` · ${profile.plazaAsignada}` : '';

      const avatar = document.getElementById('adminSidebarUserAvatar');
      const nameEl = document.getElementById('adminSidebarUserName');
      const metaEl = document.getElementById('adminSidebarUserMeta');

      if (avatar) avatar.innerText = _obtenerInicialesUsuario(nombre);
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

    function canManageUsers() { return _roleMeta().canManageUsers; }
    function canProcessAccessRequests() { return _roleMeta().canProcessAccessRequests; }
    function canEmitMasterAlerts() { return _roleMeta().canEmitMasterAlerts; }
    function canEditAdminCuadre() { return _roleMeta().canEditAdminCuadre; }
    function canViewAdminCuadre() { return _roleMeta().canViewAdminCuadre; }
    function canUseProgrammerConfig() { return _roleMeta().canUseProgrammerConfig; }
    function canLockMap() { return _roleMeta().canLockMap; }
    function canInsertExternalUnits() { return _roleMeta().level >= ROLE_META.GERENTE_PLAZA.level; }
    function hasFullAccess() { return _roleMeta().fullAccess; }

    function canAssignRole(targetRole) {
      const role = _sanitizeRole(targetRole) || 'AUXILIAR';
      if (!canManageUsers()) return false;
      if (userAccessRole === 'CORPORATIVO_USER') {
        return !['CORPORATIVO_USER', 'PROGRAMADOR', 'JEFE_OPERACION'].includes(role);
      }
      return true;
    }

    function canManageTargetRole(targetRole) {
      const role = _sanitizeRole(targetRole) || 'AUXILIAR';
      if (!canManageUsers()) return false;
      if (userAccessRole === 'CORPORATIVO_USER') {
        return !['CORPORATIVO_USER', 'PROGRAMADOR', 'JEFE_OPERACION'].includes(role);
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
      const normalized = _sanitizeRole(role) || 'AUXILIAR';
      return normalized !== 'JEFE_OPERACION' && normalized !== 'PROGRAMADOR';
    }

    // JEFE_REGIONAL puede ver múltiples plazas (además de su plaza base)
    function _roleNeedsMultiplePlazas(role) {
      return (_sanitizeRole(role) || '') === 'JEFE_REGIONAL';
    }

    function _inferRequestedAccessRole(puesto, email = '') {
      if (_isBootstrapProgrammerEmail(email)) return 'PROGRAMADOR';
      const texto = String(puesto || '').trim().toUpperCase();
      if (!texto) return 'AUXILIAR';
      if (texto.includes('PROGRAMADOR')) return 'PROGRAMADOR';
      if (texto.includes('JEFE DE OPERACION') || texto.includes('JEFE OPERACION')) return 'JEFE_OPERACION';
      if (texto.includes('CORPORATIVO')) return 'CORPORATIVO_USER';
      if (texto.includes('JEFE REGIONAL')) return 'JEFE_REGIONAL';
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
      const plazas = (window.MEX_CONFIG?.empresa?.plazas || []);
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

    async function registrarEventoGestion(tipo, mensaje, extra = {}) {
      try {
        await api.registrarEventoGestion(tipo, mensaje, USER_NAME || 'Sistema', extra);
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

      const cleanup = () => {
        container.innerHTML = '';
        container.style.display = 'none';
      };

      window.addEventListener('afterprint', cleanup, { once: true });
      container.innerHTML = htmlContenido;
      container.style.display = 'block';

      setTimeout(() => {
        try {
          window.print();
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
      if (user) {
        try {
          // Force token refresh so Firestore security rules get the auth context immediately
          await user.getIdToken(true);
          const emailNormalizado = _profileDocId(user.email);
          const snapshot = await db.collection(COL.USERS).where("email", "==", emailNormalizado).get();

          let perfilValidado = null;
          if (!snapshot.empty) {
            const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            const bestMatch = docs.find(d => d.id === emailNormalizado)
              || docs.find(d => d.id === user.uid)
              || docs[0];
            const datos = _normalizeUserProfile(bestMatch);
            _setSessionProfile(datos);
            configurarPermisosUI();
            perfilValidado = datos;
          } else {
            // Email no autorizado — redirigir a login con mensaje
            auth.signOut();
            sessionStorage.setItem('login_error', `❌ El correo ${user.email} no tiene permisos en el sistema.`);
            window.location.replace('/login');
            return;
          }
        } catch (e) {
          console.error("Error validando usuario:", e);
          sessionStorage.setItem('login_error', '❌ Error de conexión. Intenta de nuevo.');
          window.location.replace('/login');
          return;
        }
        // iniciarApp fuera del try/catch: errores de UI no deben redirigir a /login
        iniciarApp(true);
      } else {
        // Sin sesión — redirigir a /login
        _clearSessionProfile();
        window.location.replace('/login');
      }
    });


    // loginManual, loginConGoogle, togglePassword, showLoginError, _resetLoginButtons,
    // abrirModalSolicitud, cerrarModalSolicitud — definidos en el módulo de autenticación
    // (script aislado antes del admin-sidebar)

    async function enviarSolicitudAcceso() {
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
        await db.collection("solicitudes_acceso").doc(emailNormalizado).set({
          nombre: nombre,
          email: emailNormalizado,
          puesto: puesto,
          telefono: telefono,
          password: pass,
          rolSolicitado: rolSolicitado,
          plazaSolicitada: "",
          fecha: new Date().toISOString(),
          estado: "PENDIENTE"
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
      const _loginOverlay = document.getElementById('login-overlay');
      if (_loginOverlay) _loginOverlay.style.display = 'none';
      _actualizarIdentidadSidebarUsuario();

      // Cerramos sidebars
      closeMainSidebars();

      // Mostramos botones de alertas/admin
      if (document.getElementById('btnAlerts')) document.getElementById('btnAlerts').style.display = 'flex';
      if (document.getElementById('btnAdmin')) document.getElementById('btnAdmin').style.display = 'flex';
      if (document.getElementById('btnBuzon')) document.getElementById('btnBuzon').style.display = 'flex';


      if (esNuevoLogin) {
        const btn = document.getElementById('btnLoginBtn');
        if (btn) { btn.disabled = false; btn.innerText = "INGRESAR"; }
      }

      // 🔥 SOLUCIÓN AL VACÍO: 
      // Ejecutamos el ping inmediatamente, y otro 1 segundo después para asegurar
      hacerPingNotificaciones();
      setTimeout(hacerPingNotificaciones, 1500);

      iniciarRadarNotificaciones();

      // Re-cargar config después de auth — garantiza que persistence esté lista
      // y que los selects estén poblados con datos frescos de Firestore
      inicializarConfiguracion();

      _iniciarSincronizacionUsuarios(); // Poblar dbUsuariosLogin en tiempo real
      init(); // Carga el mapa
    }

    function _iniciarSincronizacionUsuarios() {
      if (_unsubUsersLive) { _unsubUsersLive(); _unsubUsersLive = null; }

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
          if (myDoc?.data()?._reloadRequired && !sessionStorage.getItem('_reloadGuard')) {
            // Guard anti-loop: sessionStorage persiste en reloads del mismo tab
            sessionStorage.setItem('_reloadGuard', '1');
            // Limpiar flag — las reglas Firestore ahora permiten que el usuario
            // escriba sólo este campo en su propio doc
            db.collection(COL.USERS).doc(myEmail)
              .update({ _reloadRequired: false })
              .catch(err => {
                console.warn('[_reloadRequired] No se pudo limpiar flag:', err.code);
                // sessionStorage guard ya impide el loop aunque Firestore falle
              });
            showToast('Tus permisos fueron actualizados. Recargando...', 'warning');
            setTimeout(() => {
              sessionStorage.removeItem('_reloadGuard');
              window.location.reload();
            }, 2000);
          }
        }
      }, err => console.warn('onSnapshot usuarios live:', err));
    }

    function cerrarSesion() {
      if (autoRefreshInterval) clearInterval(autoRefreshInterval);
      _limpiarRadar();
      if (_unsubMapa) { _unsubMapa(); _unsubMapa = null; }
      if (_unsubMapaEstructura) { _unsubMapaEstructura(); _unsubMapaEstructura = null; }
      if (_unsubUsersLive) { _unsubUsersLive(); _unsubUsersLive = null; }
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

    function cargarMaestra() {
      api.obtenerUnidadesVeloz(_miPlaza()).then(data => {
        let unicos = [];
        let mvasVistos = new Set();
        (data || []).forEach(u => {
          if (!mvasVistos.has(u.mva)) {
            mvasVistos.add(u.mva);
            unicos.push(u);
          }
        });
        DB_MAESTRA = unicos;
      }).catch(e => console.error(e));
    }

    // ==========================================
    // 2. LÓGICA DEL MAPA PRINCIPAL Y ZOOM NATIVO
    // ==========================================
    let selectedAuto = null;
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
    let saveTimeout = null;
    let lastMoveTime = 0;
    const MAPA_SAVE_DEBOUNCE_MS = 120;
    const MAPA_SAVE_RETRY_MS = 2500;
    let _mapaRenderRAF = 0;
    let _ultimaFlotaMapa = [];
    let _ultimaEstructuraMapa = [];
    let _mapaRuntime = {
      estructuraReady: false,
      unidadesReady: false,
      estructuraSig: '',
      viewportBound: false,
      gesturesBound: false,
      pinchState: null,
      pendingUnits: null
    };
    let _mapaSyncState = {
      hasPendingWrite: false,
      lastSavedFingerprint: ''
    };

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
          pos = parent.id.replace('spot-', '');
        }
        if (car.dataset.mva) {
          reporte.push({ mva: car.dataset.mva, pos });
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

    function init() {
      startAutoRefresh();
      updateZoom();
      _ajustarViewportMapa();
      _setMapSyncBadge(window.MAPA_LOCKED ? 'locked' : 'live');
      _bindMapZoomGestures();
      if (!_mapaRuntime.viewportBound) {
        window.addEventListener('resize', _ajustarViewportMapa);
        _mapaRuntime.viewportBound = true;
      }
      // Intentar renderizar el switcher de plaza cuando el perfil ya está listo
      if (typeof _renderPlazaSwitcher === 'function') _renderPlazaSwitcher();
    }

    function startAutoRefresh() {
      const plazaActiva = _miPlaza();

      // Guard: no reiniciar si ya tenemos suscripciones activas para esta misma plaza
      if (_subPlaza === plazaActiva && _unsubMapa !== null && _unsubMapaEstructura !== null) return;

      if (_unsubMapa) { _unsubMapa(); _unsubMapa = null; }
      if (_unsubMapaEstructura) { _unsubMapaEstructura(); _unsubMapaEstructura = null; }

      if (typeof api === 'undefined' || typeof api.suscribirMapa !== 'function') {
        setTimeout(startAutoRefresh, 500);
        return;
      }

      _subPlaza = plazaActiva; // Registrar plaza activa ANTES de suscribir

      if (typeof api.suscribirEstructuraMapa === 'function') {
        _unsubMapaEstructura = api.suscribirEstructuraMapa(estructura => {
          _mapaRuntime.estructuraReady = true;
          dibujarMapaCompleto(estructura);
        }, plazaActiva);
      } else {
        dibujarMapaCompleto();
      }

      const suscribir = api.suscribirMapaPlaza
        ? (cb) => api.suscribirMapaPlaza(plazaActiva, cb)
        : api.suscribirMapa.bind(api);

      _unsubMapa = suscribir(unidades => {
        _mapaRuntime.unidadesReady = true;
        if (window.PAUSA_CONEXIONES) return;
        if (isSaving || isMoving) {
          _mapaRuntime.pendingUnits = unidades;
          return;
        }
        _mapaRuntime.pendingUnits = null;
        sincronizarMapa(unidades);
      });
    }

    // Cambia la plaza activa en el mapa y reinicia las suscripciones
    function cambiarPlazaMapa(plaza) {
      if (!plaza || PLAZA_ACTIVA_MAPA === plaza) return;
      PLAZA_ACTIVA_MAPA = plaza;
      _subPlaza = null; // forzar reinicio aunque la plaza sea la misma string
      _renderPlazaSwitcher();
      inicializarConfiguracion();
      cargarMaestra();
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
        // startAutoRefresh se llama desde init() — si ya terminó, forzar reinicio
        if (_subPlaza !== PLAZA_ACTIVA_MAPA) {
          _subPlaza = null;
          startAutoRefresh();
          iniciarRadarNotificaciones();
          hacerPingNotificaciones(true);
        }
      }

      const activa = PLAZA_ACTIVA_MAPA || plazas[0];
      picker.style.display = 'flex';
      if (pickerLabel) pickerLabel.textContent = activa;
      if (dropdown) {
        dropdown.innerHTML = plazas.map(p => `
          <button class="plaza-picker-option${activa === p ? ' active' : ''}"
            onclick="cambiarPlazaMapa('${escapeHtml(p)}')">
            <span class="material-icons" style="font-size:13px;margin-right:6px;vertical-align:middle;">${activa === p ? 'check_circle' : 'location_city'}</span>
            ${escapeHtml(p)}
          </button>
        `).join('');
      }
    }

    function _ajustarViewportMapa() {
      const stage = document.getElementById('map-stage');
      const container = document.getElementById('map-zoom-container');
      const grid = document.getElementById('grid-map');
      if (!stage || !container || !grid) return;

      const isMobile = window.innerWidth <= 768;
      const outerPad = isMobile ? 14 : Math.max(16, Math.min(36, Math.round(window.innerWidth * 0.022)));
      const topMargin = isMobile ? 14 : 82;
      container.style.setProperty('--map-outer-pad', `${outerPad}px`);
      stage.style.marginTop = `${topMargin}px`;

      // [F2] Canvas libre: el tamaño lo imponen las celdas absolutas — solo sync stage
      if (!_ultimaEstructuraMapa.length) return;
      _syncMapStageSize();
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

        // 🔥 BUSCADOR TOTAL: MVA, Placa, Modelo o Notas 🔥
        const isMatch = mva.includes(query) ||
          placas.includes(query) ||
          modelo.includes(query) ||
          notas.includes(query);

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

      // 🎯 4. SMART FOCUS (La Magia)
      // Si después de buscar por modelo o notas, solo queda UNA unidad, el mapa vuela hacia ella.
      if (coincidencias.length === 1) {
        const target = coincidencias[0];
        const parentSpot = target.parentElement;

        // Solo si está en un cajón (no queremos hacer zoom al menú lateral)
        if (parentSpot && parentSpot.classList.contains('spot')) {
          target.classList.add('car-focus');
          if (typeof enfocarCajon === "function") {
            enfocarCajon(parentSpot);
          }
        }
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
          const valor = String(celda?.valor || '').trim();
          const tipo  = celda?.esLabel ? 'label' : (celda?.tipo || 'cajon');
          const esLabel = Boolean(celda?.esLabel);
          const orden   = Number(celda?.orden ?? index);

          // [F2] Si ya viene con x,y usar directo; si es legado grid → convertir
          let x, y, width, height, rotation;
          if (celda?.x !== undefined || celda?.y !== undefined) {
            x        = Number(celda.x)        || 0;        // [F2]
            y        = Number(celda.y)        || 0;        // [F2]
            width    = Number(celda.width)    || 120;      // [F2]
            height   = Number(celda.height)   || 80;       // [F2]
            rotation = Number(celda.rotation) || 0;        // [F2]
          } else {
            // Legado: col/row/colspan/rowspan → calcular px con base 120×80 + 4 gap
            const col     = Math.max(1, Number(celda?.col)     || 1);
            const row     = Math.max(1, Number(celda?.row)     || 1);
            const colspan = Math.max(1, Number(celda?.colspan) || 1);
            const rowspan = Math.max(1, Number(celda?.rowspan) || 1);
            const CW = 120, CH = 80, GAP = 4;
            x        = (col  - 1) * (CW + GAP);
            y        = (row  - 1) * (CH + GAP);
            width    = colspan * CW + (colspan - 1) * GAP;
            height   = rowspan * CH + (rowspan - 1) * GAP;
            rotation = 0;
          }
          if (aplicarAireRender) {
            x += Math.floor(Math.max(0, x) / MAPA_RENDER_BASE_X) * MAPA_RENDER_AIRE_X;
            y += Math.floor(Math.max(0, y) / MAPA_RENDER_BASE_Y) * MAPA_RENDER_AIRE_Y;
          }
          return { valor, tipo, esLabel, orden, x, y, width, height, rotation };
        })
        .sort((a, b) => a.orden - b.orden);

      let canvasW = 0, canvasH = 0;
      items.forEach(c => {
        canvasW = Math.max(canvasW, c.x + c.width);
        canvasH = Math.max(canvasH, c.y + c.height);
      });

      const signature = items
        .map(c => `${c.valor}|${c.x}|${c.y}|${c.width}|${c.height}|${c.tipo}`)
        .join('~');

      return { items, canvasW: canvasW + 8, canvasH: canvasH + 8, signature };
    }

    function dibujarMapaCompleto(estructura = null) {
      const grid = document.getElementById("grid-map");
      if (!grid) return Promise.resolve();

      if (!Array.isArray(estructura)) {
        return api.obtenerEstructuraMapa(_miPlaza())
          .then(dibujarMapaCompleto)
          .catch(e => console.error(e));
      }

      _ultimaEstructuraMapa = estructura;
      const normalizada = _normalizarEstructuraMapa(estructura);

      if (normalizada.signature === _mapaRuntime.estructuraSig && grid.children.length) {
        _ajustarViewportMapa();
        if (_ultimaFlotaMapa.length) sincronizarMapa(_ultimaFlotaMapa, { immediate: true });
        else if (!_mapaRuntime.unidadesReady) refrescarDatos(true);
        return Promise.resolve();
      }

      _mapaRuntime.estructuraSig = normalizada.signature;
      const prevSelectedMva = selectedAuto?.dataset?.mva || '';

      // [F2] Canvas libre: contenedor position:relative con tamaño calculado
      grid.innerHTML = "";
      grid.className = "mapa-canvas-libre"; // [F2]
      grid.style.width  = `${normalizada.canvasW}px`; // [F2]
      grid.style.height = `${normalizada.canvasH}px`; // [F2]
      grid.style.removeProperty('--map-cols'); // ya no usa CSS grid

      const fragment = document.createDocumentFragment();
      normalizada.items.forEach(celda => {
        const div = document.createElement("div");
        div.className = `mapa-celda-libre ${celda.tipo === 'cajon' ? 'spot' : 'area'}`; // [F2]
        div.id = "spot-" + celda.valor.replace(/\s/g, '').toUpperCase();
        // [F2] Posicionamiento absoluto
        div.style.left   = `${celda.x}px`;
        div.style.top    = `${celda.y}px`;
        div.style.width  = `${celda.width}px`;
        div.style.height = `${celda.height}px`;
        if (celda.rotation) div.style.transform = `rotate(${celda.rotation}deg)`; // [F2]
        if (celda.tipo === 'cajon') div.innerHTML = `<label>${celda.valor}</label>`;
        else div.innerHTML = `<span>${celda.valor}</span>`;
        fragment.appendChild(div);
      });
      grid.appendChild(fragment);

      _ajustarViewportMapa();

      if (_ultimaFlotaMapa.length) sincronizarMapa(_ultimaFlotaMapa, { immediate: true });
      else if (!_mapaRuntime.unidadesReady) refrescarDatos(true);

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
      const mva = String(unit?.mva || '').trim().toUpperCase();
      const placas = String(unit?.placas || '').trim().toUpperCase();
      const modelo = String(unit?.modelo || '').trim().toUpperCase();
      const estado = String(unit?.estado || 'SUCIO').trim().toUpperCase();
      const gasolina = String(unit?.gasolina || 'N/A').trim().toUpperCase() || 'N/A';
      const ubicacion = String(unit?.ubicacion || 'PATIO').trim().toUpperCase();
      const pos = String(unit?.pos || 'LIMBO').trim().toUpperCase();
      const notas = String(unit?.notas || '').replace(/[\r\n]+/g, ' ').trim();
      const fechaIngreso = String(unit?.fechaIngreso || '').trim();
      return { ...unit, mva, placas, modelo, estado, gasolina, ubicacion, pos, notas, fechaIngreso };
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
        unit.fechaIngreso
      ].join('|');
    }

    function _obtenerDestinoUnidadMapa(unit) {
      if (unit.pos === "LIMBO") {
        return unit.ubicacion === "TALLER"
          ? document.getElementById("unidades-taller")
          : document.getElementById("unidades-limbo");
      }

      const destinoMapa = document.getElementById("spot-" + unit.pos.replace(/\s/g, ''));
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
      const esGhost = car.classList.contains('ghost');
      const esForgotten = car.classList.contains('forgotten');
      const esSelected = car.classList.contains('selected');

      car.dataset.mva = unit.mva;
      car.dataset.placas = unit.placas || "";
      car.dataset.modelo = unit.modelo || "";
      car.dataset.estado = unit.estado || "SUCIO";
      car.dataset.gasolina = unit.gasolina || "N/A";
      car.dataset.ubicacion = unit.ubicacion;
      car.dataset.ingreso = unit.fechaIngreso || "";
      car.dataset.notas = unit.notas || "";

      const textoNotas = unit.notas.toUpperCase();
      const urgHtml = textoNotas.includes("URGENTE") ? `<div class="urgent-badge">⚡</div>` : '';
      const lockHtml = (textoNotas.includes("RESERVAD") || textoNotas.includes("APARTAD")) ? `<div class="lock-badge">🔒</div>` : '';
      const docHtml = textoNotas.includes("DOBLE CERO") ? `<div class="doc-badge">🍃</div>` : '';
      const mantoHtml = (unit.estado === "MANTENIMIENTO" || unit.estado === "TALLER") ? `<div class="manto-badge">⚙️</div>` : '';
      const termometro = obtenerDisenoCalor(unit.fechaIngreso);
      const calorHtml = `<div class="badge-calor ${termometro.clase}" style="background: ${termometro.bg}; border: 1px solid ${termometro.border}; color: ${termometro.color};"><span class="material-icons" style="font-size: 11px;">${termometro.icon}</span> ${termometro.text}</div>`;
      const gasBarHtml = _renderGasolinaMapa(unit.gasolina);
      const estadoClase = unit.estado
        ? unit.estado.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-')
        : "sucio";

      car.innerHTML = `${calorHtml}${lockHtml}${docHtml}${mantoHtml}${urgHtml}<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100%; pointer-events:none;"><span style="font-size:19px; flex:1; display:flex; align-items:center;">${unit.mva}</span>${gasBarHtml}</div>`;
      car.className = `car ${estadoClase}`;
      if (esGhost) car.classList.add('ghost');
      if (esForgotten) car.classList.add('forgotten');
      if (esSelected) car.classList.add('selected');
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

      const nuevas = _ultimaFlotaMapa
        .map(_normalizarUnidadMapa)
        .filter(unit => unit.mva)
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

        if (car.parentElement !== destino) {
          destino.appendChild(car);
          huboCambios = true;
        }
      });

      if (huboCambios) {
        actualizarContadores();
        const q = (document.getElementById('searchInput')?.value || document.getElementById('searchInputMobile')?.value || '').trim();
        if (q && typeof buscarMasivo === 'function') buscarMasivo();
        if (selectedAuto && selectedAuto.isConnected) {
          mostrarDetalle(selectedAuto.dataset, true);
        }
      }
    }

    function sincronizarMapa(nuevas, opciones = {}) {
      _ultimaFlotaMapa = Array.isArray(nuevas) ? nuevas : [];

      if (opciones.immediate === true) {
        if (_mapaRenderRAF) cancelAnimationFrame(_mapaRenderRAF);
        _flushMapaSync();
        return;
      }

      if (_mapaRenderRAF) return;
      _mapaRenderRAF = requestAnimationFrame(_flushMapaSync);
    }

    document.addEventListener('click', (e) => {
      const carClicked = e.target.closest('.car');
      const spotClicked = e.target.closest('.spot') || e.target.closest('#unidades-limbo') || e.target.closest('#unidades-taller');

      if (carClicked) {
        if (selectedAuto) selectedAuto.classList.remove('selected');
        selectedAuto = carClicked;
        carClicked.classList.add('selected');

        // --- MAGIA AQUÍ: Limpiar búsqueda automáticamente ---
        const searchDesktop = document.getElementById('searchInput');
        const searchMobile = document.getElementById('searchInputMobile');
        if (searchDesktop) searchDesktop.value = "";
        if (searchMobile) searchMobile.value = "";

        // Ejecutamos la búsqueda vacía para que todos los autos recuperen su color
        if (typeof buscarMasivo === "function") buscarMasivo();
        // ----------------------------------------------------

        mostrarDetalle(carClicked.dataset);

        // 🔥 EL NUEVO TRUCO DE ZOOM 🔥
        // Si el zoom lo provocó la lupa, lo regresamos a su tamaño normal (0.8) al tocar el carro
        if (window.zoomBuscadorActivo) {
          zoomLevel = 0.8; // <-- Puedes cambiar este 0.8 si quieres que quede más cerca o más lejos
          updateZoom();
          window.zoomBuscadorActivo = false;
        }

        limpiarBusqueda(false); // Mantenemos el false para no interferir con el zoom manual

        if (document.getElementById('sidebar').classList.contains('open')) {
          toggleSidebar();
        }

        e.stopPropagation();
        return;
      }

      if (spotClicked && selectedAuto) {
        const occupant = spotClicked.querySelector('.car');
        if (occupant && occupant !== selectedAuto && spotClicked.classList.contains('spot')) {
          mostrarConfirmacionSwap(selectedAuto, occupant, spotClicked);
        } else {
          moverUnidadInmediato(selectedAuto, spotClicked);
        }
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
      const loc = car.parentElement.id.replace('spot-', '');

      document.getElementById('swap-container').innerHTML = "";

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

      // OPCIONES PARA QUITAR (BORRAN LAS NOTAS) - Solo Admins pueden quitar cosas delicadas
      if (esAdmin && esApartado) removeActions += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'QUITAR_APARTADO')"><span class="material-icons" style="color:#64748b">lock_open</span> QUITAR APARTADO</div>`;

      // Cualquiera puede quitar doble cero si se equivocó
      if (esDobleCero) removeActions += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'QUITAR_DOBLE_CERO')"><span class="material-icons" style="color:#64748b">do_not_disturb_on</span> QUITAR DOBLE CERO</div>`;

      if (esAdmin && esUrgente) removeActions += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'QUITAR_URGENTE')"><span class="material-icons" style="color:#64748b">notifications_paused</span> QUITAR URGENTE</div>`;

      if (esAdmin && esManto) removeActions += `<div class="action-item" onclick="ejecutarAccionRapida('${d.mva}', 'QUITAR_MANTENIMIENTO')"><span class="material-icons" style="color:#64748b">build_circle</span> QUITAR DE MANTENIMIENTO</div>`;

      let divider = removeActions !== "" ? `<div style="height:1px; background:#e2e8f0; margin:5px 0;"></div>` : "";

      // DIBUJAR BOTONES
      const btnGrid = document.querySelector('#info-panel div[style*="grid-template-columns"]');
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
      const zoomControls = document.querySelector('.zoom-controls');
      if (zoomControls) zoomControls.classList.add('panel-open');
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

    function mostrarConfirmacionSwap(moviendo, ocupante, destino) {
      const swapDiv = document.getElementById('swap-container');
      swapDiv.innerHTML = `
    <div style="background:#fffbeb; border:2px solid #fbbf24; padding:15px; border-radius:18px; margin-top:15px;">
      <p style="color:#92400e; font-weight:800; font-size:14px; text-align:center;">⚠️ EL CAJÓN ESTÁ OCUPADO POR ${ocupante.dataset.mva}</p>
      <button class="btn-swap-confirm" id="confirmSwapBtn">🔄 CONFIRMAR CAMBIO DE POSICIÓN</button>
    </div>
  `;
      document.getElementById('confirmSwapBtn').onclick = () => {
        const origenRef = moviendo.parentElement;
        origenRef.appendChild(ocupante);
        destino.appendChild(moviendo);
        lastMoveTime = Date.now();
        solicitarGuardadoProgresivo();
        cerrarPanel();
        actualizarContadores();
      };
    }

    function moverUnidadInmediato(unidad, destino) {
      destino.appendChild(unidad);
      lastMoveTime = Date.now();
      solicitarGuardadoProgresivo();
      cerrarPanel();
      actualizarContadores();
    }

    function resetUnitToLimbo() {
      if (!selectedAuto) return;
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
      const sidebar = document.getElementById('sidebar');
      const adminSidebar = document.getElementById('admin-sidebar');
      if (!adminSidebar) return;

      const abrir = typeof forceState === 'boolean' ? forceState : !adminSidebar.classList.contains('open');
      if (abrir) sidebar?.classList.remove('open');
      adminSidebar.classList.toggle('open', abrir);
      sincronizarEstadoSidebars();
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

      api.guardarNuevasPosiciones(reporte, USER_NAME, _miPlaza()).then((res) => {
        isSaving = false;

        if (res === true) {
          _mapaSyncState.lastSavedFingerprint = fingerprint;
          const currentFingerprint = _firmaReportePosicionesMapa(_obtenerReportePosicionesMapa());
          if (_mapaSyncState.hasPendingWrite || currentFingerprint !== fingerprint) {
            _mapaSyncState.hasPendingWrite = true;
            _setMapSyncBadge('queued');
            _programarGuardadoMapa(120);
            return;
          }
          _finalizarCicloGuardadoMapa();
        } else {
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
      document.getElementById('searchInput').value = "";
      document.getElementById('searchInputMobile').value = "";

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
      toggleAdminSidebar(); // Cerrar para ver el resultado
    }

    function exportarMapa() {
      showToast("Capturando imagen... (Espera unos segundos)", "success");
      toggleAdminSidebar(); // Cerramos el menú

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
      toggleAdminSidebar();
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
          let cajon = parentId.replace('spot-', '');
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

    function abrirModalFlota() {
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
    }

    function cerrarModalFlota() {
      document.getElementById('fleet-modal').classList.remove('active');
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

        // C) 🔥 FILTROS ESPECIALES (CHIPS DE NOTAS) 🔥
        let pasaEspecial = true;
        if (currentFiltroEspecial === 'DOBLE CERO') {
          pasaEspecial = notas.includes('DOBLE CERO');
        } else if (currentFiltroEspecial === 'APARTADO') {
          pasaEspecial = notas.includes('RESERVAD') || notas.includes('APARTAD');
        } else if (currentFiltroEspecial === 'URGENTE') {
          pasaEspecial = notas.includes('URGENTE');
        } else if (currentFiltroEspecial === 'RESGUARDO') {
          // En resguardo buscamos tanto en el Estado como en las Notas
          pasaEspecial = estado === 'RESGUARDO' || notas.includes('RESGUARDO');
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
               '<button onclick="event.stopPropagation(); seleccionarFilaFlota('+i+', this.closest(\'tr\')); setTimeout(()=>window.scrollTo(0, document.body.scrollHeight), 50);" style="background:#f1f5f9; color:var(--mex-blue); border:none; padding:8px 15px; border-radius:8px; display:flex; align-items:center; gap:5px; font-weight:800; cursor:pointer; flex:1; justify-content:center;">' +
                 '<span class="material-icons" style="font-size:16px;">edit</span> EDITAR' +
               '</button>' +
               '<button onclick="event.stopPropagation(); seleccionarFilaFlota('+i+', this.closest(\'tr\')); setTimeout(()=>document.getElementById(\'btnDelFlota\').click(), 100);" style="background:#fee2e2; color:var(--mex-red); border:none; padding:8px 15px; border-radius:8px; display:flex; align-items:center; gap:5px; font-weight:800; cursor:pointer; flex:1; justify-content:center;">' +
                 '<span class="material-icons" style="font-size:16px;">delete</span> ELIMINAR' +
               '</button>' +
             '</div>'
          : '';

        return `
    <tr onclick="seleccionarFilaFlota(${i}, this)">
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
    }


    function abrirFormularioFlota() {
      const panel = document.getElementById('form-flota-panel');
      const overlay = document.getElementById('form-flota-overlay');
      if(panel) panel.classList.add('active');
      if(overlay) overlay.classList.add('active');
    }

    function cerrarFormularioFlota() {
      const panel = document.getElementById('form-flota-panel');
      const overlay = document.getElementById('form-flota-overlay');
      if(panel) panel.classList.remove('active');
      if(overlay) overlay.classList.remove('active');
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
        _umUsers = snap.docs
          .map(d => _normalizeUserProfile({ id: d.id, ...d.data() }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre));

        _umRenderCards();

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

      const q = (document.getElementById('um-search')?.value || '').toLowerCase().trim();
      let list = _umUsers;

      // Filtro texto: nombre, email, rol label
      if (q) {
        list = list.filter(u =>
          u.nombre.toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (_umRoleBadge(u.rol).label || '').toLowerCase().includes(q)
        );
      }

      // Filtro chip plaza
      if (_umPlazaFiltro) {
        list = list.filter(u => (u.plazaAsignada || '').toUpperCase() === _umPlazaFiltro);
      }

      if (list.length === 0) {
        container.innerHTML = '<div class="um-loading">No se encontraron usuarios.</div>';
        return;
      }

      container.innerHTML = list.map(u => {
        const badge = _umRoleBadge(u.rol);
        const active = u.id === _umSelectedId ? ' active' : '';
        return `<div class="um-card${active}" onclick="umSeleccionar('${u.id}')">
          <div class="um-avatar" style="${_umAvatarStyle(u.nombre)}">${_umInitials(u.nombre)}</div>
          <div class="um-card-info">
            <div class="um-card-name">${u.nombre}</div>
            <div class="um-card-email">${u.email || '(usuario heredado)'}${u.plazaAsignada ? ` · <b>${u.plazaAsignada}</b>` : ''}</div>
          </div>
          <span class="um-role-badge" style="${badge.style}">${badge.label}</span>
        </div>`;
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
        <div class="um-form-avatar-row">
          <div class="um-form-avatar" style="${_umAvatarStyle(user.nombre)}">${_umInitials(user.nombre)}</div>
          <div style="flex:1;min-width:0;">
            <div class="um-form-title">${escapeHtml(user.nombre)}</div>
            <div class="um-form-subtitle">${escapeHtml(user.email || 'Usuario heredado')}</div>
          </div>
        </div>

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

        <div class="um-form-section" style="display:flex;align-items:center;justify-content:space-between;">
          Rol y alcance
          ${canEdit ? `<button type="button" class="um-edit-lock-btn" onclick="_umToggleRolSection()" title="Editar rol">
            <span class="material-icons" style="font-size:15px;">edit</span>
          </button>` : ''}
        </div>

        <div class="um-form-field">
          <label>ROL</label>
          <select id="um-edit-role" onchange="_syncRoleScope('um-edit')" disabled>
            ${_roleOptionsHtml(user.rol)}
          </select>
        </div>

        <div class="um-form-field" id="um-edit-plaza-row" style="${_roleNeedsPlaza(user.rol) ? '' : 'display:none;'}">
          <div class="um-field-label-row">
            <label>Plaza base ${_roleNeedsPlaza(user.rol) && !_roleNeedsMultiplePlazas(user.rol) ? '' : ''}</label>
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

        const updateData = { nombre, telefono, email: targetUser.email, rol, plazaAsignada, isAdmin: meta.isAdmin, isGlobal: meta.fullAccess };
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
          db.collection(COL.USERS).doc(docId).update({ _reloadRequired: true }).catch(() => {});
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
        <div class="um-form-avatar-row">
          <div class="um-form-avatar" style="background:var(--mex-accent);color:white;">
            <span class="material-icons" style="font-size:28px;">person_add</span>
          </div>
          <div>
            <div class="um-form-title">Nuevo Usuario</div>
            <div class="um-form-subtitle">Completa todos los campos para crear la cuenta.</div>
          </div>
        </div>

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

        <div class="um-divider"></div>
        <div class="um-actions">
          <button class="um-btn-save" id="um-btn-crear" onclick="umCrearUsuario()" disabled style="opacity:.5;cursor:not-allowed;">
            <span class="material-icons" style="font-size:17px;">person_add</span> CREAR USUARIO
          </button>
          <div id="um-new-hints" style="font-size:11px;color:#94a3b8;text-align:center;margin-top:4px;">
            Completa los campos requeridos (<span style="color:#ef4444;">*</span>)
          </div>
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
      toggleAdminSidebar();
      document.getElementById('logs-modal').classList.add('active');

      const tbody = document.getElementById('logs-table-body');
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px;"><span class="material-icons spinner" style="vertical-align:middle;">sync</span> Extrayendo historial de la base de datos...</td></tr>`;
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
          `<tr><td colspan="5" style="text-align:center;padding:20px;color:#ef4444;font-weight:800;">Error al cargar el historial.</td></tr>`;
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
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:#64748b; font-weight:800;">
      No hay registros que coincidan con los filtros.</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(l => `
    <tr>
      <td style="font-size:11px; color:#64748b; font-weight:800;">${l.fecha}</td>
      <td><span class="badge ${l.tipo === 'MOVE' ? 'st-LISTO' : 'st-SUCIO'}">${l.tipo}</span></td>
      <td style="font-weight:900; color:var(--mex-blue); font-size:14px;">${l.mva}</td>
      <td style="font-size:12px; font-weight:700;">${l.detalles}</td>
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
      api.obtenerDatosParaMapa().then(data => {
        if (data && data.unidades) sincronizarMapa(data.unidades);
      }).catch(e => console.error(e));
    }


    let _unsubRadar = [];
    let _radarState = { settings: null, globalSettings: null, alertas: null, mensajes: null, incidencias: 0 };
    let _radarReady = { settings: false, globalSettings: false, alertas: false, mensajes: false, incidencias: false };

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
      }).catch(err => console.error("❌ RADAR ERROR:", err));
    }

    function _procesarPingUI(res) {
      if (!res) return;
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
      }
      // 5. 🕒 LÓGICA DE FEED INTELIGENTE (CON BRILLO Y AUTO-CLEAN)
      const currentFeedStr = JSON.stringify(res.liveFeed);

      if (currentFeedStr !== STRING_ULTIMO_FEED) {
        STRING_ULTIMO_FEED = currentFeedStr;
        const feedContainer = document.getElementById('liveActivityFeed');

        if (feedContainer && res.liveFeed && res.liveFeed.length > 0) {
          feedContainer.innerHTML = res.liveFeed.map((log, index) => {
            const esValidacion = log.accion.includes("CUADRE VALIDADO");
            const colorTexto = esValidacion ? "#10b981" : "#1e293b";
            const prefijo = esValidacion ? "⭐ " : "";
            const autorEstilo = esValidacion ? "color:#059669; font-weight:900;" : "";

            // 🔥 Brillo solo al más reciente (índice 0)
            const claseAnimacion = (index === 0) ? "feed-item new-item-glow" : "feed-item";

            return `
              <div class="${claseAnimacion}">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <b style="${autorEstilo} font-size:10px;">${log.autor}</b>
                  <span style="font-size:9px; color:#64748b;">${log.fecha}</span>
                </div>
                <p style="color: ${colorTexto}; font-size:11px; font-weight:700; margin-top:2px;">${prefijo}${log.accion}</p>
              </div>
            `;
          }).join('');

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

      // 6. GESTIÓN DE ALERTAS (CAMPANA)
      const badgeAlt = document.getElementById('badgeAlerts');
      const alertasPendientes = _ordenarAlertasPendientes((res.alertas || []).filter(a =>
        !_alertaYaLeidaPor(a, USER_NAME) && _alertaAplicaAUsuario(a, USER_NAME)
      ));
      if (alertasPendientes.length > 0) {
        if (badgeAlt) {
          badgeAlt.innerText = alertasPendientes.length;
          badgeAlt.style.display = 'flex';
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
        filaAlertasPendientes = [];
      }

      // 🔥 7. GESTIÓN DEL BUZÓN DE MENSAJES (EL CULPABLE) 🔥
      const badgeBuzon = document.getElementById('badgeBuzon');
      if (res.mensajesSinLeer > 0) {
        if (badgeBuzon) {
          badgeBuzon.innerText = res.mensajesSinLeer;
          badgeBuzon.style.display = 'flex';
        }
      } else {
        if (badgeBuzon) badgeBuzon.style.display = 'none';
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

      alertaActualMostrandose = filaAlertasPendientes[0];
      const alerta = alertaActualMostrandose;
      const metaTipo = _obtenerMetaTipoAlerta(alerta.tipo);
      const bannerMeta = _obtenerBannerVisibleAlerta(alerta);
      const autorVisible = _obtenerAutorVisibleAlerta(alerta, '');
      const mensajeHtml = _normalizarMensajeAlertaHtml(alerta.mensaje);
      const accion = _normalizarAccionAlerta(alerta.cta || {});

      document.getElementById('alertaTitulo').innerText = alerta.titulo || 'Sin título';
      document.getElementById('alertaMensaje').innerHTML = mensajeHtml || `<div style="color:#94a3b8;">Sin contenido disponible.</div>`;
      document.getElementById('alertaMensaje').scrollTop = 0;
      document.getElementById('alertaFecha').innerText = alerta.fecha || 'Reciente';
      document.getElementById('alertaAutor').innerText = autorVisible || '';
      const autorWrap = document.getElementById('alertaFinalAuthorWrap');
      if (autorWrap) autorWrap.style.display = autorVisible ? 'block' : 'none';

      const tipoBadge = document.getElementById('alertaTipo');
      tipoBadge.innerText = bannerMeta.label;
      tipoBadge.style.background = bannerMeta.bg;
      tipoBadge.style.color = bannerMeta.color;

      const banner = document.getElementById('alertaBannerImg');
      if (alerta.imagen && (String(alerta.imagen).startsWith('http') || String(alerta.imagen).startsWith('data:image'))) {
        banner.style.backgroundImage = `url('${_safeCssUrl(alerta.imagen)}')`;
        banner.style.display = 'block';
      } else {
        banner.style.backgroundImage = '';
        banner.style.display = 'none';
      }

      const btnCerrar = document.getElementById('btnCerrarAlerta');

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
      _renderizarBotonAccionAlerta(document.getElementById('btnAccionAlerta'), accion, metaTipo.color);

      document.getElementById('modalAlertaMaestra').classList.add('active');
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
      wrappers.forEach(w => { if(w.contains(event.target)) clickInside = true; });
      
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
      searchInput.disabled = false;
      searchInput.value = "";
      document.getElementById('a_ins_results').style.display = 'none';
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
      const term = document.getElementById('a_ins_searchInput').value.toUpperCase().trim();
      const resDiv = document.getElementById('a_ins_results');
      if (term.length < 2) { resDiv.style.display = 'none'; return; }

      // Buscamos en DB_MAESTRA
      const matches = DB_MAESTRA.filter(u => {
        const texto = (
          u.etiqueta
          || `${u.mva || ''} ${u.placas || ''} ${u.modelo || ''} ${u.categoria || u.categ || ''} ${u.plaza || u.sucursal || ''}`
        ).toUpperCase();
        return texto.includes(term);
      }).slice(0, 6);

      if (matches.length > 0) {
        resDiv.innerHTML = matches.map(u => `
      <div class="result-item" onclick='autocompletarInsertarAdmin(${JSON.stringify(u)})'>
        <div class="res-info"><b>${u.mva}</b><small>${u.modelo} • ${u.placas}</small></div>
        <span class="material-icons" style="color:var(--mex-blue);">add_circle</span>
      </div>
    `).join('');
        resDiv.style.display = 'block';
      } else { resDiv.style.display = 'none'; }
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
        plaza: UNIDAD_GLOBAL_ACTIVA.plaza,
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
        }).catch(e => console.error(e));
      } else {
        const docIdEliminar = UNIDAD_GLOBAL_ACTIVA.id || UNIDAD_GLOBAL_ACTIVA.fila || data.fila;
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
        const extraHtml = detalles.length
          ? `<div style="margin-top:10px; padding-top:10px; border-top:1px dashed #dbe4ee; color:#64748b; font-size:11px; line-height:1.5;">${detalles.join(' · ')}</div>`
          : '';

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
      if (!canLockMap()) {
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
      api.finalizarProtocoloV3(USER_NAME).then(res => {
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

    function renderizarPaseLista() {
      const container = document.getElementById('audit-list-container');
      if (!container) return;

      const inputSearch = document.getElementById('audit-search');
      const term = inputSearch ? inputSearch.value.toUpperCase().trim() : "";

      // 1. Progreso y Botón Final
      const pendientes = window.AUDIT_LIST.filter(u => u.status === 'PENDIENTE').length;
      const total = window.AUDIT_LIST.length;
      const progress = document.getElementById('audit-progress');
      if (progress) progress.innerText = `${total - pendientes} / ${total} REVISADAS`;

      const btnFinalizar = document.getElementById('btnFinalizarAudit');
      if (btnFinalizar) {
        if (pendientes === 0 && total > 0) {
          btnFinalizar.disabled = false;
          btnFinalizar.style.background = "#10b981";
          btnFinalizar.style.cursor = "pointer";
        } else {
          btnFinalizar.disabled = true;
          btnFinalizar.style.background = "#cbd5e1";
          btnFinalizar.style.cursor = "not-allowed";
        }
      }

      // 2. Filtrar
      let filtradas = window.AUDIT_LIST.filter(u => {
        if (term === "") return true;
        return u.mva.includes(term) || (u.placas && u.placas.includes(term)) || (u.modelo && u.modelo.includes(term));
      });

      // 3. Ordenar (Solo si no busca, manda los PENDIENTES hasta arriba)
      filtradas.sort((a, b) => {
        if (term === "") {
          if (a.status === 'PENDIENTE' && b.status !== 'PENDIENTE') return -1;
          if (a.status !== 'PENDIENTE' && b.status === 'PENDIENTE') return 1;
        }
        return 0;
      });

      // 4. Dibujar
      if (filtradas.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 40px 20px; color: #94a3b8; font-weight: 800;">No se encontraron coincidencias.</div>`;
        return;
      }

      container.innerHTML = filtradas.map(u => {
        let bg = "white", border = "1px solid #e2e8f0", opacity = "1";
        let btnCheckColor = "#f1f5f9", btnCrossColor = "#f1f5f9";
        let iconCheckColor = "#94a3b8", iconCrossColor = "#94a3b8";

        if (u.status === 'OK') {
          bg = "#f0fdf4"; border = "2px solid #4ade80"; btnCheckColor = "#16a34a"; iconCheckColor = "white"; opacity = "0.7";
        } else if (u.status === 'FALTANTE') {
          bg = "#fef2f2"; border = "2px solid #f87171"; btnCrossColor = "#dc2626"; iconCrossColor = "white"; opacity = "0.7";
        } else if (u.status === 'EXTRA') {
          bg = "#fffbeb"; border = "2px dashed #f59e0b"; btnCheckColor = "#d97706"; iconCheckColor = "white";
        }

        return `
      <div style="background: ${bg}; border: ${border}; border-radius: 16px; padding: 15px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; opacity: ${opacity}; transition: 0.2s;">
        <div>
          <h3 style="margin: 0; font-size: 18px; color: var(--mex-blue); font-weight: 900;">${u.mva}</h3>
          <span style="font-size: 11px; color: #64748b; font-weight: 700;">${u.modelo} • ${u.placas}</span>
          ${u.status === 'EXTRA' ? `<span style="display:block; font-size:10px; color:#d97706; font-weight:900; margin-top:4px;">⚠️ SOBRANTE FÍSICO</span>` : ''}
        </div>
        <div style="display: flex; gap: 10px;">
          <button onclick="marcarUnidadAudit('${u.mva}', 'FALTANTE')" style="width: 45px; height: 45px; border-radius: 12px; border: none; background: ${btnCrossColor}; color: ${iconCrossColor}; font-weight: 900; cursor: pointer; transition:0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.05);"><span class="material-icons">close</span></button>
          <button onclick="marcarUnidadAudit('${u.mva}', 'OK')" style="width: 45px; height: 45px; border-radius: 12px; border: none; background: ${btnCheckColor}; color: ${iconCheckColor}; font-weight: 900; cursor: pointer; transition:0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.05);"><span class="material-icons">check</span></button>
        </div>
      </div>
    `;
      }).join('');
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
            btn.disabled = true;
            btn.innerHTML = `<span class="material-icons spinner">sync</span> ENVIANDO REPORTE...`;

            api.enviarAuditoriaAVentas(window.AUDIT_LIST, USER_NAME).then(res => {
              if (res && res.exito) {
                document.getElementById('audit-modal').classList.remove('active');
                showToast("Auditoría enviada a Ventas. ¡Buen trabajo!", "success");
                setTimeout(compartirWhatsApp, 1000);
                setTimeout(() => {
                  document.getElementById('audit-paso3').style.display = 'none';
                  document.getElementById('audit-paso1').style.display = 'block';
                  btn.disabled = false;
                  btn.innerHTML = `<span class="material-icons">send</span> ENVIAR REPORTE`;
                  hacerPingNotificaciones();
                }, 1000);
              } else {
                btn.disabled = false;
                btn.innerHTML = `<span class="material-icons">send</span> ENVIAR REPORTE`;
                showToast("Error al enviar. Intenta de nuevo.", "error");
              }
            }).catch(err => {
              btn.disabled = false;
              btn.innerHTML = `<span class="material-icons">send</span> ENVIAR REPORTE`;
              showToast("Error: " + err, "error");
            });
          }
        );
      }
    }



    // 👑 ADMIN Y AUXILIAR: EL BOTÓN MÁGICO DE FLUJO
    function manejadorFlujoV3() {
      const estadoActual = document.getElementById('txtV3').innerText;

      if (userRole === 'admin' && estadoActual === "INICIAR CUADRE (ADMIN)") {
        toggleAdminSidebar();
        document.getElementById('audit-modal').classList.add('active');
        document.getElementById('audit-paso1').style.display = 'block';
        document.getElementById('audit-paso2').style.display = 'none';
        document.getElementById('audit-paso3').style.display = 'none';
        window.UNIDADES_SISTEMA_CORPORATIVO = [];
      }
      else if (userRole === 'admin' && estadoActual === "FINALIZAR CUADRE") {
        // 🔥 EL ADMIN DESCARGA LA REVISIÓN DEL AUXILIAR Y LA ABRE EN SU PANTALLA
        toggleAdminSidebar();
        showToast("Descargando revisión del patio...", "info");

        api.obtenerMisionAuditoria().then(mision => {
          hacerPingNotificaciones();
          if (mision && mision.length > 0) {
            window.AUDIT_LIST = mision; // Carga los estados (OK, FALTANTE, etc.) que puso el auxiliar

            document.getElementById('audit-modal').classList.add('active');
            document.getElementById('audit-paso1').style.display = 'none';
            document.getElementById('audit-paso2').style.display = 'block';
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
        toggleAdminSidebar();
        showToast("Descargando misión...", "info");

        api.obtenerMisionAuditoria().then(mision => {
          hacerPingNotificaciones();
          if (mision && mision.length > 0) {
            window.UNIDADES_SISTEMA_CORPORATIVO = mision;
            window.AUDIT_LIST = window.UNIDADES_SISTEMA_CORPORATIVO.map(u => ({ mva: u.mva, placas: u.placas, modelo: u.modelo, status: 'PENDIENTE' }));

            document.getElementById('audit-modal').classList.add('active');
            document.getElementById('audit-paso1').style.display = 'none';
            document.getElementById('audit-paso2').style.display = 'block';
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

      api.iniciarProtocoloDesdeAdmin(USER_NAME, JSON.stringify(window.UNIDADES_SISTEMA_CORPORATIVO)).then(res => {
        showToast("¡Misión enviada al celular del patio! 📡", "success");
        document.getElementById('audit-modal').classList.remove('active');
        hacerPingNotificaciones();
        btn.innerHTML = `INICIAR MISIÓN DE AUDITORÍA`;
      }).catch(e => console.error(e));
    }

    // 🗄️ ABRIR EL ARCHIVERO DE CUADRES
    let globalHistorialAuditorias = [];
    
    function abrirHistorialCuadres() {
      toggleAdminSidebar();
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
       if(el.style.display === 'none') { el.style.display = 'block'; }
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
          String(c.auxiliar||"").toLowerCase().includes(query) ||
          String(c.admin||"").toLowerCase().includes(query) ||
          String(c.fecha||"").toLowerCase().includes(query)
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
          String(c.auxiliar||"").toLowerCase().includes(autorFiltro) ||
          String(c.admin||"").toLowerCase().includes(autorFiltro)
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
    let pendingChatFile  = null;   // { file, previewUrl, isImg }
    let pendingAudioBlob = null;   // { blob, localUrl }
    let replyingToMsg    = null;   // { id, remitente, mensaje }
    let _chatListenerUnsubs = [];
    let chatMediaRecorder = null;
    let chatAudioChunks  = [];
    let _chatAudioCtx    = null;
    let _chatAnalyser    = null;
    let _chatSpectrumRaf = null;
    let emojiPickerTarget = null;  // msgId for reaction picker

    const AVATAR_COLORS = ['#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#3182ce', '#805ad5', '#d53f8c', '#00b5d8', '#e36112', '#2f855a'];
    function _avatarColor(name) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length; return AVATAR_COLORS[Math.abs(h)]; }

    function abrirBuzon() {
      document.getElementById('buzon-modal').classList.add('active');
      document.getElementById('chat-window-view').style.transform = 'translateX(100%)';
      activeChatUser = null;
      // Inject companyName
      const lbl = document.getElementById('chatv2-company-label');
      if (lbl) lbl.innerText = typeof companyName !== 'undefined' ? companyName : '';
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
          .sort((a, b) => b.timestamp - a.timestamp)
          .map(m => ({ ...m, esMio: m.remitente === me, leido: m.leido === 'SI' }));
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
      const term = document.getElementById('buscadorContactos').value.toLowerCase().trim();

      let ultimosMensajes = {};
      let noLeidos = {};

      // Agrupamos los mensajes por conversación
      allChatMessages.forEach(m => {
        let elOtro = m.esMio ? m.destinatario : m.remitente;
        if (!ultimosMensajes[elOtro]) {
          ultimosMensajes[elOtro] = m;
          noLeidos[elOtro] = 0;
        }
        if (!m.esMio && !m.leido) noLeidos[elOtro]++;
      });

      let usuariosMostrar = dbUsuariosLogin.filter(u => u.usuario.trim().toUpperCase() !== USER_NAME.trim().toUpperCase());
      if (term) usuariosMostrar = usuariosMostrar.filter(u => u.usuario.toLowerCase().includes(term));

      usuariosMostrar.sort((a, b) => {
        let unreadA = noLeidos[a.usuario.trim().toUpperCase()] || 0;
        let unreadB = noLeidos[b.usuario.trim().toUpperCase()] || 0;
        if (unreadA !== unreadB) return unreadB - unreadA;

        let msgA = ultimosMensajes[a.usuario.trim().toUpperCase()];
        let msgB = ultimosMensajes[b.usuario.trim().toUpperCase()];

        // 🔥 ORDENAMIENTO SEGURO: Usamos el ID numérico en lugar de intentar leer el texto de la fecha
        if (msgA && msgB) {
          return Number(msgB.id) - Number(msgA.id);
        }
        if (msgA && !msgB) return -1;
        if (!msgA && msgB) return 1;
        return a.usuario.localeCompare(b.usuario);
      });

      if (usuariosMostrar.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:30px; color:#64748b; font-weight:700;">No hay usuarios.</div>`;
        return;
      }

      container.innerHTML = usuariosMostrar.map(u => {
        const uName = u.usuario.trim().toUpperCase();
        const unread = noLeidos[uName] || 0;
        const lastMsg = ultimosMensajes[uName];

        let snippet = "Toca para chatear";
        let dateStr = "";
        let unreadBadge = "";
        let snippetColor = "color:#8696a0;";
        let snippetWeight = "font-weight:400;";

        if (lastMsg) {
          const raw = lastMsg.esMio ? `✓ ${lastMsg.mensaje}` : lastMsg.mensaje;
          snippet = raw.length > 35 ? raw.substring(0, 35) + "…" : raw;
          let partesFecha = String(lastMsg.fecha || "").split(' ');
          dateStr = partesFecha.length > 1 ? partesFecha[1] : "";
        }

        if (unread > 0) {
          unreadBadge = `<span style="background:#25D366; color:white; font-size:11px; font-weight:900; min-width:20px; height:20px; padding:0 6px; border-radius:10px; display:flex; align-items:center; justify-content:center;">${unread}</span>`;
          snippetColor = "color:#111;";
          snippetWeight = "font-weight:600;";
          dateStr = `<span style="color:#25D366; font-weight:700;">${dateStr}</span>`;
        }

        const avatarColor = _avatarColor(uName);

        return `
      <div class="chat-contact" onclick="abrirChat('${uName}')">
         <div class="chat-avatar" style="background:${avatarColor}; width:46px; height:46px; font-size:18px; flex-shrink:0;">${uName.charAt(0)}</div>
         <div style="flex:1; overflow:hidden; padding: 0 10px; border-bottom: 1px solid #f0f0f0; padding-bottom:13px; margin-bottom:-13px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:3px;">
              <span style="font-weight:700; font-size:14.5px; color:#111; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:65%;">${uName}</span>
              <span style="font-size:11px; ${unread > 0 ? '' : 'color:#8696a0;'} flex-shrink:0;">${dateStr}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:13px; ${snippetColor} ${snippetWeight} white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:80%;">${snippet}</span>
              ${unreadBadge}
            </div>
         </div>
      </div>
    `;
      }).join('');
    }

    function abrirChat(nombre) {
      activeChatUser = String(nombre).trim().toUpperCase();

      document.getElementById('chat-active-name').innerText = activeChatUser;
      const avatarEl = document.getElementById('chat-active-avatar');
      avatarEl.innerText = activeChatUser.charAt(0);
      avatarEl.style.background = _avatarColor(activeChatUser);
      document.getElementById('chat-window-view').style.transform = 'translateX(0)';

      const input = document.getElementById('chat-input');
      input.value = "";
      input.style.height = "auto";
      _clearChatStaging();

      let idsToMark = [];
      allChatMessages.forEach(m => {
        // 🔥 BLINDAJE FRONTAL: Ignorar espacios al marcar como leídos
        let rem = String(m.remitente).trim().toUpperCase();
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
      document.getElementById('chat-window-view').style.transform = 'translateX(100%)';
      renderContactos(); // Refresca los snippets
    }

    function renderChatWindow() {
      const container = document.getElementById('chat-messages-container');

      let history = allChatMessages.filter(m =>
        String(m.remitente).trim().toUpperCase() === activeChatUser ||
        String(m.destinatario).trim().toUpperCase() === activeChatUser
      ).reverse();

      if (history.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:40px 20px; color:#94a3b8; font-weight:600; font-size:12px; background:white; border-radius:16px; border:1px solid #f1f5f9; margin-top:20px;">
          <span class="material-icons" style="font-size:32px; display:block; margin-bottom:8px; color:#cbd5e1;">chat_bubble_outline</span>
          Inicio de la conversación con ${activeChatUser}<br><br>Escribe un mensaje para comenzar.</div>`;
        return;
      }

      container.innerHTML = history.map(m => {
        const typeClass = m.esMio ? "sent" : "received";
        const mIdSafe   = String(m.id).replace(/[^a-zA-Z0-9_-]/g, '_');

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
          const rqText  = escapeHtml(String(m.replyTo.mensaje || "").substring(0, 80));
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
          const isImg   = /\.(jpg|jpeg|png|gif|webp)$/i.test(nom);
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
        const reacEntries = Object.entries(reacs).filter(([,users]) => users && users.length > 0);
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
         onmouseover="this.querySelector('.chat-options-menu') ? this.querySelector('.chat-options-menu').style.opacity = 1 : null"
         onmouseleave="this.querySelector('.chat-options-menu') ? this.querySelector('.chat-options-menu').style.opacity = 0 : null">
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
      if (['doc','docx'].includes(e)) return 'description';
      if (['xls','xlsx'].includes(e)) return 'table_chart';
      if (['ppt','pptx'].includes(e)) return 'slideshow';
      return 'insert_drive_file';
    }


    async function editarMensajeChat(idMsg) {
      const msg = allChatMessages.find(m => m.id == idMsg);
      if(!msg) return;
      const act = prompt("Edita tu mensaje:", msg.mensaje);
      if(act && act !== msg.mensaje) {
        msg.mensaje = act;
        renderChatWindow();
        try {
          await api.editarMensajeChatDb(idMsg.toString(), act);
          showToast("Mensaje editado.", "success");
        } catch(e) {
          showToast("Error al editar", "error");
        }
      }
    }

    async function eliminarMensajeChat(idMsg) {
      const ok = await mexConfirm("Confirmación", "¿Borrar este mensaje para todos?", "warning");
      if(!ok) return;
      allChatMessages = allChatMessages.filter(m => m.id != idMsg);
      renderChatWindow();
      try {
        await api.eliminarMensajeChatDb(idMsg.toString());
        showToast("Mensaje borrado.", "info");
      } catch(e) {
        showToast("Error al borrar", "error");
      }
    }

    async function enviarMensajeChat() {
      const input = document.getElementById('chat-input');
      const txt = input.value.trim();
      if (!txt && !pendingChatFile && !pendingAudioBlob) return;
      if (!activeChatUser) return;

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
        } catch(e) {
          console.error("Error upload chat file:", e);
          showToast("Error al subir archivo", "error");
          return;
        }
      } else if (pendingAudioBlob) {
        const ts2 = Date.now();
        const fname = `audio_${ts2}.webm`;
        try {
          showToast("Subiendo audio...", "info");
          const snap = await firebase.storage().ref(`mensajes_chat/${ts2}-${fname}`).put(pendingAudioBlob.blob, { contentType: 'audio/webm' });
          archivoUrl = await snap.ref.getDownloadURL();
          archivoNombre = fname;
        } catch(e) {
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
      if (archivoUrl)    { msgLocal.archivoUrl = archivoUrl; msgLocal.archivoNombre = archivoNombre; }

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
      pendingChatFile  = null;
      pendingAudioBlob = null;
      replyingToMsg    = null;
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
            <div class="chip-name" style="font-size:11px; color:#475569;">${escapeHtml(String(replyingToMsg.mensaje||'').substring(0,60))}</div>
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
          <span style="font-size:10px; color:#94a3b8; flex-shrink:0;">${(f.file.size/1024).toFixed(0)} KB</span>
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
        el.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
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
      const msg = allChatMessages.find(m => String(m.id).replace(/[^a-zA-Z0-9_-]/g,'_') === mIdSafe);
      if (!msg) return;
      replyingToMsg = { id: msg.id, remitente: msg.remitente, mensaje: msg.mensaje };
      _renderStagingArea();
      document.getElementById('chat-input').focus();
    }

    // ── Lightbox ──
    function abrirLightboxChat(url) {
      const lb = document.getElementById('chatLightbox');
      const img = document.getElementById('chatLightboxImg');
      img.src = url;
      lb.classList.add('active');
    }
    function cerrarLightboxChat() {
      document.getElementById('chatLightbox').classList.remove('active');
    }

    // ── Emoji Reactions ──
    const EMOJI_LIST = ["😀","😂","😍","🥰","😎","😢","😡","👍","👎","❤️","🔥","🎉","✅","🙏","😮","🤔","💯","🚀","💪","😴","😅","🤣","🤩","😇","😏","🥳","😤","🤯","👏","🙌","🤝","💔","💥","⭐","🌟","✨","🎁","🎊","🎈","💡","📌","📎","🔒","🔑","📢","💬","📱","💻","🖥️","📊","📈","🚗","🏠","🌍","🍕","☕","🍺","🌈","☀️","❄️","🌙","⚡","🌊","🐶","🐱","😻","👀","🫡","🫶","🤌","💀","👻","🤖","🦊","🦁","🐸","🍀","🌸","🌺","🎵","🎶","🎸","🏆","⚽","🏀","🎮","🎯","🎲","📚","✏️","🔎","🧩","🧠","💊","🌡️","🛒","🎬","📸","🖼️","🗺️","⏰","📅","🔔","🔕","❓","❗","⚠️","🆕","🆓","🆙","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪"];

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
      setTimeout(() => { const inp = document.getElementById('emojiSearch'); if(inp) inp.focus(); }, 50);
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
      const msg = allChatMessages.find(m => String(m.id).replace(/[^a-zA-Z0-9_-]/g,'_') === mIdSafe);
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
      } catch(e) {
        console.warn("Error guardando reacción:", e);
      }
    }

    // ── Audio recording con espectro ──
    async function toggleGrabacionChat() {
      if (chatMediaRecorder && chatMediaRecorder.state === 'recording') {
        chatMediaRecorder.stop();
        if (_chatSpectrumRaf) cancelAnimationFrame(_chatSpectrumRaf);
        return;
      }
      if (!navigator.mediaDevices) {
        showToast("Tu navegador no soporta grabación de audio", "error");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chatAudioChunks = [];

        // AudioContext para el espectro
        _chatAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        _chatAnalyser = _chatAudioCtx.createAnalyser();
        _chatAnalyser.fftSize = 64;
        const source = _chatAudioCtx.createMediaStreamSource(stream);
        source.connect(_chatAnalyser);

        chatMediaRecorder = new MediaRecorder(stream);
        chatMediaRecorder.ondataavailable = ev => { if (ev.data.size > 0) chatAudioChunks.push(ev.data); };
        chatMediaRecorder.onstop = () => {
          stream.getTracks().forEach(t => t.stop());
          if (_chatAudioCtx) { _chatAudioCtx.close(); _chatAudioCtx = null; }
          if (_chatSpectrumRaf) { cancelAnimationFrame(_chatSpectrumRaf); _chatSpectrumRaf = null; }
          document.getElementById('chatMicBtn').classList.remove('recording');
          document.getElementById('chatMicBtn').querySelector('.material-icons').textContent = 'mic';

          if (chatAudioChunks.length === 0) return;
          const blob = new Blob(chatAudioChunks, { type: 'audio/webm' });
          chatAudioChunks = [];
          if (blob.size > 10 * 1024 * 1024) { showToast("Audio demasiado largo (máx 10MB)", "error"); return; }

          // Stage el audio (no auto-enviar)
          if (pendingAudioBlob && pendingAudioBlob.localUrl) URL.revokeObjectURL(pendingAudioBlob.localUrl);
          pendingAudioBlob = { blob, localUrl: URL.createObjectURL(blob) };
          _renderStagingArea();
        };

        chatMediaRecorder.start();
        document.getElementById('chatMicBtn').classList.add('recording');
        document.getElementById('chatMicBtn').querySelector('.material-icons').textContent = 'stop';

        // Mostrar espectro en staging area
        _renderStagingArea();
        _dibujarEspectroGrabacion();

      } catch(err) {
        showToast("No se pudo acceder al micrófono", "error");
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
    document.addEventListener('click', function(e) {
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
              const dest = posNueva === "LIMBO" ? document.getElementById("unidades-limbo") : document.getElementById('spot-' + posNueva.replace(/[^A-Z0-9-]/gi, ''));
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
      const btnGrid = document.querySelector('#info-panel div[style*="grid-template-columns"]');
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
        pos: c.parentElement.id.includes('spot') ? c.parentElement.id.replace('spot-', '') : 'LIMBO',
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

    // [F2] Defaults para celdas nuevas
    const _ED_DEFAULT_W = 120;
    const _ED_DEFAULT_H = 80;

    function abrirEditorMapa() {
      toggleAdminSidebar();
      document.getElementById('modal-editor-mapa').classList.add('active');
      document.getElementById('editor-loading').style.display = 'flex';
      document.getElementById('editor-grid-wrapper').style.display = 'none';
      _edCeldas = []; _edSel = null; _edModo = null; _edDrag = null; _edResize = null; _edZoom = 1.0; _edMultiSel = []; _edRotate = null; _edRectSel = null; _edDragResizeBound = false;
      const zl = document.getElementById('ed-zoom-label'); if (zl) zl.innerText = '100%';
      _resetEditorPanel();

      api.obtenerEstructuraMapa(_miPlaza()).then(estructura => {
        document.getElementById('editor-loading').style.display = 'none';
        document.getElementById('editor-grid-wrapper').style.display = 'block';
        // [F2] Normalizar al formato absoluto (también acepta legado grid)
        const normalizada = _normalizarEstructuraMapa(estructura, { aplicarAireRender: false });
        _edCeldas = normalizada.items.map((c, i) => ({
          id: 'ec_' + i + '_' + Math.random().toString(36).substr(2, 5),
          valor:    c.valor,
          tipo:     c.tipo     || 'cajon',
          esLabel:  c.esLabel  || false,
          orden:    c.orden    ?? i,
          x:        c.x        ?? 0,       // [F2]
          y:        c.y        ?? 0,       // [F2]
          width:    c.width    ?? _ED_DEFAULT_W, // [F2]
          height:   c.height   ?? _ED_DEFAULT_H, // [F2]
          rotation: c.rotation ?? 0        // [F2]
        }));
        _renderEditorCanvas();
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
      let canvasW = 800, canvasH = 500;
      _edCeldas.forEach(c => {
        canvasW = Math.max(canvasW, c.x + c.width + 40);
        canvasH = Math.max(canvasH, c.y + c.height + 40);
      });

      // Reusar o crear el canvas container
      let canvas = document.getElementById('editor-canvas-libre');
      if (!canvas) {
        canvas = document.createElement('div');
        canvas.id = 'editor-canvas-libre';
        canvas.style.cssText = 'position:relative; overflow:auto; flex:1; background:rgba(0,0,0,0.22); border-radius:10px; border:1px solid rgba(255,255,255,0.07);';
        wrapper.appendChild(canvas);
      }

      // [F2] Contenedor interior con dimensiones calculadas
      let inner = document.getElementById('editor-canvas-inner');
      if (!inner) {
        inner = document.createElement('div');
        inner.id = 'editor-canvas-inner';
        inner.style.cssText = 'position:relative; margin:8px; transform-origin:top left;';
        canvas.appendChild(inner);
      }
      inner.style.width  = `${canvasW}px`;
      inner.style.height = `${canvasH}px`;
      inner.style.transform = `scale(${_edZoom})`;
      inner.innerHTML = '';

      // SVG para líneas guía de alineación
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'ed-guides-svg';
      svg.setAttribute('width', canvasW);
      svg.setAttribute('height', canvasH);
      svg.style.cssText = 'position:absolute; top:0; left:0; pointer-events:none; z-index:100;';
      inner.appendChild(svg);

      // Zona de drop + rect-select desde fondo vacío
      inner.onmousedown = e => {
        if (e.target !== inner) return;
        if (_edModo) return; // el click se maneja en onclick
        // Iniciar rect-select
        const rect = inner.getBoundingClientRect();
        const sx = (e.clientX - rect.left) / _edZoom;
        const sy = (e.clientY - rect.top)  / _edZoom;
        _edRectSel = { startX: sx, startY: sy };
        // Crear elemento visual del rect
        const rectEl = document.createElement('div');
        rectEl.id = 'ed-rect-sel';
        rectEl.style.cssText = `position:absolute; border:1.5px dashed #a855f7; background:rgba(168,85,247,0.08); pointer-events:none; z-index:99;
          left:${sx}px; top:${sy}px; width:0; height:0;`;
        inner.appendChild(rectEl);
      };
      inner.onclick = e => {
        if (e.target !== inner) return;
        if (!_edModo) {
          if (_edSel) { _edMultiSel = []; _resetEditorPanel(); _renderEditorCanvas(); }
          return;
        }
        const rect = inner.getBoundingClientRect();
        _edClickLibre(Math.round((e.clientX - rect.left) / _edZoom), Math.round((e.clientY - rect.top) / _edZoom));
      };

      // [F2] Renderizar cada celda como elemento absolutamente posicionado
      _edCeldas.forEach(celda => {
        const isSel = _edSel && _edSel.id === celda.id;
        const isMulti = _edMultiSel.some(c => c.id === celda.id);
        const isLabel = celda.tipo === 'label';
        const isArea  = celda.tipo === 'area';
        const bg = isLabel ? '#1e293b' : isArea ? '#334155' : '#3b82f6';
        const bgSel = isLabel ? '#0f172a' : isArea ? '#1e40af' : '#1d4ed8';

        const el = document.createElement('div');
        el.className = 'ed-celda-libre' + (isSel ? ' ed-celda-sel' : '') + (isMulti && !isSel ? ' ed-celda-multi' : '');
        el.dataset.id = celda.id;
        el.style.cssText = `
          position:absolute;
          left:${celda.x}px; top:${celda.y}px;
          width:${celda.width}px; height:${celda.height}px;
          background:${isSel ? bgSel : bg};
          border:${isSel ? '2.5px solid #fbbf24' : '1.5px solid rgba(255,255,255,0.15)'};
          border-radius:7px; color:white; display:flex; align-items:center;
          justify-content:center; font-weight:900;
          font-size:${celda.valor.length > 6 ? '9' : '11'}px;
          cursor:grab; text-align:center; word-break:break-all; padding:3px;
          user-select:none; box-sizing:border-box; overflow:visible;
          box-shadow:${isSel ? '0 0 0 3px rgba(251,191,36,0.35)' : '0 2px 6px rgba(0,0,0,0.35)'};
          ${celda.rotation ? `transform:rotate(${celda.rotation}deg);` : ''}
        `;
        el.innerText = celda.valor;

        // Click con shift para multi-selección
        el.addEventListener('mousedown', e => {
          e.stopPropagation();
          if (e.shiftKey) {
            // Toggle en multi-sel
            const idx = _edMultiSel.findIndex(c => c.id === celda.id);
            if (idx >= 0) _edMultiSel.splice(idx, 1);
            else _edMultiSel.push(celda);
            _renderEditorCanvas();
            return;
          }
          _edSelectCelda(celda);
          // [F2] Iniciar drag
          _edDrag = { celdaId: celda.id, startMouseX: e.clientX, startMouseY: e.clientY, startCeldaX: celda.x, startCeldaY: celda.y,
            multiStarts: _edMultiSel.length > 0 ? _edMultiSel.map(c => ({ id: c.id, x: c.x, y: c.y })) : [] };
        });

        if (isSel) {
          // 8 handles de resize
          const handleDefs = [
            { dir: 'nw', style: 'top:-5px; left:-5px; cursor:nw-resize;' },
            { dir: 'n',  style: `top:-5px; left:${celda.width/2-5}px; cursor:n-resize;` },
            { dir: 'ne', style: `top:-5px; left:${celda.width-5}px; cursor:ne-resize;` },
            { dir: 'w',  style: `top:${celda.height/2-5}px; left:-5px; cursor:w-resize;` },
            { dir: 'e',  style: `top:${celda.height/2-5}px; left:${celda.width-5}px; cursor:e-resize;` },
            { dir: 'sw', style: `top:${celda.height-5}px; left:-5px; cursor:sw-resize;` },
            { dir: 's',  style: `top:${celda.height-5}px; left:${celda.width/2-5}px; cursor:s-resize;` },
            { dir: 'se', style: `top:${celda.height-5}px; left:${celda.width-5}px; cursor:se-resize;` },
          ];
          handleDefs.forEach(({ dir, style }) => {
            const h = document.createElement('div');
            h.className = 'ed-handle-8';
            h.style.cssText += style;
            h.addEventListener('mousedown', e => {
              e.stopPropagation();
              _edResize = { celdaId: celda.id, dir, startMouseX: e.clientX, startMouseY: e.clientY,
                startW: celda.width, startH: celda.height, startX: celda.x, startY: celda.y };
            });
            el.appendChild(h);
          });

          // Handle de rotación
          const rotH = document.createElement('div');
          rotH.className = 'ed-rotate-handle';
          rotH.addEventListener('mousedown', e => {
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

      // [F2] Handlers globales de mousemove/mouseup para drag y resize
      _bindEditorDragResize(inner);
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
            if (dir.includes('e')) c.width  = Math.max(40, _edResize.startW + dx);
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
          const cy = (e.clientY - rect.top)  / _edZoom;
          const rx = Math.min(cx, _edRectSel.startX);
          const ry = Math.min(cy, _edRectSel.startY);
          const rw = Math.abs(cx - _edRectSel.startX);
          const rh = Math.abs(cy - _edRectSel.startY);
          const rectEl = document.getElementById('ed-rect-sel');
          if (rectEl) { rectEl.style.left=rx+'px'; rectEl.style.top=ry+'px'; rectEl.style.width=rw+'px'; rectEl.style.height=rh+'px'; }
          _edRectSel.curX = cx; _edRectSel.curY = cy;
        }
      });

      document.addEventListener('mouseup', e => {
        if (_edRotate) { _edRotate = null; if (_edSel) _edSelectCelda(_edSel); return; }
        if (_edDrag) {
          _edDrag = null;
          const svg = document.getElementById('ed-guides-svg');
          if (svg) svg.innerHTML = '';
          _renderEditorCanvas();
        }
        if (_edResize) {
          _edResize = null;
          if (_edSel) _edSelectCelda(_edSel);
        }
        if (_edRectSel) {
          // Finalizar rect select
          const sx = Math.min(_edRectSel.startX, _edRectSel.curX || _edRectSel.startX);
          const sy = Math.min(_edRectSel.startY, _edRectSel.curY || _edRectSel.startY);
          const ex = Math.max(_edRectSel.startX, _edRectSel.curX || _edRectSel.startX);
          const ey = Math.max(_edRectSel.startY, _edRectSel.curY || _edRectSel.startY);
          _edMultiSel = _edCeldas.filter(c => c.x >= sx && c.y >= sy && c.x + c.width <= ex && c.y + c.height <= ey);
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
    function _edSelectCelda(celda) {
      _edModo = null;
      document.getElementById('editor-add-hint').style.display = 'none';
      _edSel = celda;
      document.getElementById('editor-no-sel').style.display = 'none';
      document.getElementById('editor-sel-form').style.display = 'block';
      document.getElementById('ep-nombre').value = celda.valor;
      document.getElementById('ep-tipo').value = celda.tipo || 'cajon';
      // [F2] Campos de posición y dimensión
      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      setVal('ep-x',        Math.round(celda.x));
      setVal('ep-y',        Math.round(celda.y));
      setVal('ep-width',    Math.round(celda.width));
      setVal('ep-height',   Math.round(celda.height));
      setVal('ep-rotation', Math.round(celda.rotation || 0));
      _renderEditorCanvas();
    }

    function _resetEditorPanel() {
      _edSel = null;
      document.getElementById('editor-no-sel').style.display = 'block';
      document.getElementById('editor-sel-form').style.display = 'none';
      document.getElementById('editor-add-hint').style.display = 'none';
      ['btn-tool-cajon', 'btn-tool-area', 'btn-tool-label'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
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
        width: w, height: h, rotation: 0 // [F2]
      };
      _edCeldas.push(nueva);
      _edModo = null;
      _edSelectCelda(nueva);
    }

    // [F2] Cambio de propiedades desde el panel lateral
    function editorPropChange() {
      if (!_edSel) return;
      _edSel.valor    = document.getElementById('ep-nombre').value.toUpperCase();
      _edSel.tipo     = document.getElementById('ep-tipo').value;
      _edSel.esLabel  = _edSel.tipo === 'label';
      // [F2] Leer x,y,width,height,rotation del panel
      const toNum = (id, fallback) => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? fallback : v; };
      _edSel.x        = toNum('ep-x',        _edSel.x);
      _edSel.y        = toNum('ep-y',        _edSel.y);
      _edSel.width    = Math.max(20, toNum('ep-width',  _edSel.width));
      _edSel.height   = Math.max(20, toNum('ep-height', _edSel.height));
      _edSel.rotation = toNum('ep-rotation', _edSel.rotation || 0);
      const idx = _edCeldas.findIndex(c => c.id === _edSel.id);
      if (idx >= 0) _edCeldas[idx] = { ..._edSel };
      _renderEditorCanvas();
    }

    // [F2] editorSpanChange renombrado a editorDimChange — ajusta width/height en pasos
    function editorSpanChange(prop, delta) {
      if (!_edSel) return;
      const STEP = 10;
      if (prop === 'colspan') { _edSel.width  = Math.max(20, (_edSel.width  || _ED_DEFAULT_W) + delta * STEP); } // [F2]
      else                    { _edSel.height = Math.max(20, (_edSel.height || _ED_DEFAULT_H) + delta * STEP); } // [F2]
      const idx = _edCeldas.findIndex(c => c.id === _edSel.id);
      if (idx >= 0) { _edCeldas[idx].width = _edSel.width; _edCeldas[idx].height = _edSel.height; }
      // Actualizar inputs del panel
      const wEl = document.getElementById('ep-width');  if (wEl) wEl.value = Math.round(_edSel.width);
      const hEl = document.getElementById('ep-height'); if (hEl) hEl.value = Math.round(_edSel.height);
      _renderEditorCanvas();
    }

    // [F2] editorMoverCelda — mueve en pasos de px
    function editorMoverCelda(dCol, dRow) {
      if (!_edSel) return;
      const STEP = 10;
      _edSel.x = Math.max(0, (_edSel.x || 0) + dCol * STEP); // [F2]
      _edSel.y = Math.max(0, (_edSel.y || 0) + dRow * STEP); // [F2]
      const idx = _edCeldas.findIndex(c => c.id === _edSel.id);
      if (idx >= 0) { _edCeldas[idx].x = _edSel.x; _edCeldas[idx].y = _edSel.y; }
      const xEl = document.getElementById('ep-x'); if (xEl) xEl.value = Math.round(_edSel.x);
      const yEl = document.getElementById('ep-y'); if (yEl) yEl.value = Math.round(_edSel.y);
      _renderEditorCanvas();
    }

    function editorEliminarCelda() {
      if (!_edSel) return;
      _edCeldas = _edCeldas.filter(c => c.id !== _edSel.id);
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
      if (!_edSel) return;
      const copia = { ..._edSel, id: 'ec_copy_' + Date.now(), x: _edSel.x + 20, y: _edSel.y + 20, orden: _edCeldas.length };
      _edCeldas.push(copia);
      _edSelectCelda(copia);
    }

    // ── FORMAS PREDETERMINADAS ──
    function editorAgregarForma(tipo) {
      const cx = 80, cy = 80;
      const baseX = 60, baseY = 60;
      const n = _edCeldas.length + 1;
      const nombre = `C${n}`;
      if (tipo === 'fila-3') {
        const y = baseY + (_edCeldas.length > 0 ? Math.max(..._edCeldas.map(c => c.y + c.height)) + 10 : 0);
        [0,1,2].forEach(i => {
          const c = { id: 'ec_new_' + Date.now() + i, valor: `C${_edCeldas.length + 1}`, tipo: 'cajon', esLabel: false,
            orden: _edCeldas.length, x: baseX + i * 84, y, width: 80, height: 80, rotation: 0 };
          _edCeldas.push(c);
        });
        _edSelectCelda(_edCeldas[_edCeldas.length - 1]);
        return;
      }
      const dims = { 'cuadrado': [80,80], 'rect-h': [120,80], 'rect-v': [80,120], 'rect-grande': [240,80] };
      const [w, h] = dims[tipo] || [80, 80];
      const nueva = { id: 'ec_new_' + Date.now(), valor: nombre, tipo: 'cajon', esLabel: false,
        orden: _edCeldas.length, x: baseX, y: baseY + (_edCeldas.length > 0 ? Math.max(..._edCeldas.map(c => c.y + c.height)) + 10 : 0),
        width: w, height: h, rotation: 0 };
      _edCeldas.push(nueva);
      _edSelectCelda(nueva);
    }

    // ── MENÚ "..." ──
    function editorToggleMoreMenu() {
      const m = document.getElementById('ed-more-menu');
      if (!m) return;
      m.style.display = m.style.display === 'none' ? 'block' : 'none';
      if (m.style.display === 'block') {
        const hide = e => { if (!m.contains(e.target)) { m.style.display = 'none'; document.removeEventListener('mousedown', hide); } };
        setTimeout(() => document.addEventListener('mousedown', hide), 10);
      }
    }

    function editorCentrarH() {
      document.getElementById('ed-more-menu').style.display = 'none';
      if (!_edSel) return;
      const inner = document.getElementById('editor-canvas-inner');
      const cw = inner ? parseInt(inner.style.width) : 800;
      _edSel.x = Math.round((cw - _edSel.width) / 2);
      const idx = _edCeldas.findIndex(c => c.id === _edSel.id); if (idx >= 0) _edCeldas[idx].x = _edSel.x;
      _edSelectCelda(_edSel);
    }

    function editorCentrarV() {
      document.getElementById('ed-more-menu').style.display = 'none';
      if (!_edSel) return;
      const inner = document.getElementById('editor-canvas-inner');
      const ch = inner ? parseInt(inner.style.height) : 500;
      _edSel.y = Math.round((ch - _edSel.height) / 2);
      const idx = _edCeldas.findIndex(c => c.id === _edSel.id); if (idx >= 0) _edCeldas[idx].y = _edSel.y;
      _edSelectCelda(_edSel);
    }

    function editorTraerFrente() {
      document.getElementById('ed-more-menu').style.display = 'none';
      if (!_edSel) return;
      const maxOrden = Math.max(..._edCeldas.map(c => c.orden));
      const idx = _edCeldas.findIndex(c => c.id === _edSel.id);
      if (idx >= 0) { _edCeldas[idx].orden = maxOrden + 1; _edSel.orden = maxOrden + 1; }
      _renderEditorCanvas();
    }

    function editorEnviarFondo() {
      document.getElementById('ed-more-menu').style.display = 'none';
      if (!_edSel) return;
      const minOrden = Math.min(..._edCeldas.map(c => c.orden));
      const idx = _edCeldas.findIndex(c => c.id === _edSel.id);
      if (idx >= 0) { _edCeldas[idx].orden = minOrden - 1; _edSel.orden = minOrden - 1; }
      _renderEditorCanvas();
    }

    function editorDuplicarFila() {
      document.getElementById('ed-more-menu').style.display = 'none';
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
      const sel = _edMultiSel.length > 1 ? _edMultiSel : (_edSel ? [_edSel] : []);
      if (sel.length < 2) { showToast('Selecciona 2+ celdas con Shift+clic', 'error'); return; }
      const refs = sel.map(c => _edCeldas.find(x => x.id === c.id)).filter(Boolean);
      if (modo === 'left')    { const min = Math.min(...refs.map(c => c.x));    refs.forEach(c => c.x = min); }
      if (modo === 'right')   { const max = Math.max(...refs.map(c => c.x + c.width));  refs.forEach(c => c.x = max - c.width); }
      if (modo === 'centerH') { const avg = refs.reduce((s,c) => s + c.x + c.width/2, 0) / refs.length; refs.forEach(c => c.x = Math.round(avg - c.width/2)); }
      if (modo === 'top')     { const min = Math.min(...refs.map(c => c.y));    refs.forEach(c => c.y = min); }
      if (modo === 'bottom')  { const max = Math.max(...refs.map(c => c.y + c.height)); refs.forEach(c => c.y = max - c.height); }
      if (modo === 'centerV') { const avg = refs.reduce((s,c) => s + c.y + c.height/2, 0) / refs.length; refs.forEach(c => c.y = Math.round(avg - c.height/2)); }
      _renderEditorCanvas();
    }

    function editorDistribuirGrupo(eje) {
      const sel = _edMultiSel.length > 1 ? _edMultiSel : (_edSel ? [_edSel] : []);
      if (sel.length < 3) { showToast('Selecciona 3+ celdas para distribuir', 'error'); return; }
      const refs = sel.map(c => _edCeldas.find(x => x.id === c.id)).filter(Boolean);
      if (eje === 'H') {
        refs.sort((a,b) => a.x - b.x);
        const totalW = refs.reduce((s,c) => s + c.width, 0);
        const space = (refs[refs.length-1].x + refs[refs.length-1].width - refs[0].x - totalW) / (refs.length - 1);
        let cur = refs[0].x + refs[0].width;
        for (let i = 1; i < refs.length - 1; i++) { refs[i].x = Math.round(cur + space); cur = refs[i].x + refs[i].width; }
      } else {
        refs.sort((a,b) => a.y - b.y);
        const totalH = refs.reduce((s,c) => s + c.height, 0);
        const space = (refs[refs.length-1].y + refs[refs.length-1].height - refs[0].y - totalH) / (refs.length - 1);
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
      const hint = document.getElementById('editor-add-hint');
      hint.style.display = 'flex';
      const labels = { cajon: 'un cajón', area: 'un área especial', label: 'una etiqueta' };
      hint.innerHTML = `<span class="material-icons" style="font-size:18px; flex-shrink:0;">touch_app</span> Haz clic en el canvas para agregar ${labels[tipo] || tipo}`;
      _renderEditorCanvas();
    }

    // [F2] editorCambiarGrid ya no aplica al canvas libre — se mantiene por compatibilidad HTML pero no hace nada
    function editorCambiarGrid(dim, delta) { /* [F2] sin efecto en canvas libre */ }

    function guardarMapaEditor(btn) {
      if (_edCeldas.length === 0) { showToast("El mapa está vacío", "error"); return; }
      btn.disabled = true;
      btn.innerHTML = '<span class="material-icons spinner" style="font-size:16px;">sync</span> Guardando...';

      // [F2] Payload con campos de posicionamiento absoluto
      const payload = _edCeldas.map((c, i) => ({
        valor:    c.valor,
        tipo:     c.tipo,
        esLabel:  c.tipo === 'label',
        orden:    i,
        x:        Math.round(c.x        || 0),       // [F2]
        y:        Math.round(c.y        || 0),       // [F2]
        width:    Math.round(c.width    || _ED_DEFAULT_W), // [F2]
        height:   Math.round(c.height   || _ED_DEFAULT_H), // [F2]
        rotation: Math.round(c.rotation || 0)        // [F2]
      }));

      api.guardarEstructuraMapa(payload, _miPlaza()).then(res => {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons" style="font-size:17px;">save</span> GUARDAR';
        if (res === 'OK') {
          showToast("✅ Mapa guardado correctamente", "success");
          setTimeout(() => {
            document.getElementById('modal-editor-mapa').classList.remove('active');
            dibujarMapaCompleto();
          }, 1200);
        }
      }).catch(err => {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons" style="font-size:17px;">save</span> GUARDAR';
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


    let TAB_ACTIVA_CFG = 'ubicaciones';

    function abrirPanelConfiguracion(tabInicial) {
      if (!canUseProgrammerConfig()) {
        showToast("Tu rol no puede abrir la configuración global.", "error");
        return;
      }
      if(typeof toggleAdminSidebar === 'function') toggleAdminSidebar();
      document.getElementById('modal-config-global').classList.add('active');
      if(tabInicial) {
        // Activar el tab indicado
        const btnTarget = document.querySelector(`.cfg-tab[onclick*="'${tabInicial}'"]`);
        if(btnTarget) abrirTabConfig(tabInicial, btnTarget);
        else renderizarListaConfig();
      } else {
        renderizarListaConfig();
      }
    }

    function abrirTabConfig(tabName, btnElement) {
      // Si estábamos en el tab de usuarios, desuscribir el listener
      if (TAB_ACTIVA_CFG === 'usuarios' && _unsubUsuarios) {
        _unsubUsuarios(); _unsubUsuarios = null;
        _umUsers = []; _umSelectedId = null;
      }

      document.querySelectorAll('.cfg-tab').forEach(btn => btn.classList.remove('active'));
      btnElement.classList.add('active');
      TAB_ACTIVA_CFG = tabName.replace('cfg-', '');
      
      const searchBox = document.querySelector('.cfg-v2-add-bar');
      const tabsSinBarra = ['empresa', 'usuarios', 'solicitudes', 'plazas'];
      if(tabsSinBarra.includes(TAB_ACTIVA_CFG)) {
         if(searchBox) searchBox.style.display = 'none';
      } else {
         if(searchBox) searchBox.style.display = 'flex';
      }

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

      renderizarListaConfig();
    }

    function renderizarListaConfig() {
      const container = document.getElementById('cfg-lista-items');
      
      if(TAB_ACTIVA_CFG === 'empresa') {
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
              <div class="cfg-emp-plaza-badge">${escapeHtml((p).slice(0,3))}</div>
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
                    placeholder="Ej: MEX RENT A CAR" disabled
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
                    { key:'colorPrincipal',   label:'Principal',   default:'#004a99', hint:'Barra, botones' },
                    { key:'colorSecundario',  label:'Secundario',  default:'#1d4ed8', hint:'Acentos, hover' },
                    { key:'colorAcento',      label:'Acento',      default:'#f59e0b', hint:'Alertas, highlights' },
                    { key:'colorTexto',       label:'Texto',       default:'#0f172a', hint:'Texto principal' },
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
                { id:'cfg-correo-empresa',      key:'correoEmpresa',      label:'Correo de la Empresa',   ph:'contacto@tuempresa.com' },
                { id:'cfg-correo-facturacion',   key:'correoFacturacion',  label:'Correo de Facturación',  ph:'facturacion@tuempresa.com' },
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

          </div>
        `;
        return;
      }

      if(TAB_ACTIVA_CFG === 'usuarios') {
         renderizarTabConfigUsuarios(container);
         return;
      }

      if(TAB_ACTIVA_CFG === 'solicitudes') {
         renderizarTabConfigSolicitudes(container);
         return;
      }

      if(TAB_ACTIVA_CFG === 'plazas') {
         _plazaSeleccionadaCfg = null;
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

      if(query) {
         lista = lista.filter(item => (item.id || item.nombre || "").toUpperCase().includes(query));
      }

      if(catFilter) {
        lista = lista.filter(item => (typeof item === 'object' ? item.categoria : '') === catFilter);
      }

      if(TAB_ACTIVA_CFG === 'ubicaciones') {
        // Si no tiene acceso global, solo ver ubicaciones de SU plaza
        const activePlazaFilter = plazaFilter
          || (!_puedeVerTodasPlazas() ? _miPlaza() : '')
          || (esGerentePlaza ? myPlaza : '');
        if (activePlazaFilter) {
          const apfUp = activePlazaFilter.toUpperCase();
          lista = lista.filter(item => !item.plazaId || (item.plazaId || '').toUpperCase() === apfUp);
        }
      }

      if (!lista || lista.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:30px; color:#94a3b8; font-weight:700; font-size:13px;">Sin elementos. Agrega el primero arriba.</div>';
        return;
      }

      const tabsSinDrag = ['gasolinas'];
      const usaDrag = !tabsSinDrag.includes(TAB_ACTIVA_CFG) && !query && !plazaFilter;

      container.innerHTML = lista.map((itemObj, visIndex) => {
        const i = itemObj._origIndex;
        const item = rawLista[i];
        const esEstado = typeof item === 'object' && item.color !== undefined;
        let valor = esEstado ? item.id : (item.nombre || item);
        const color = esEstado ? item.color : null;
        let pText = "";

        if(TAB_ACTIVA_CFG === 'ubicaciones') {
          const isPlaza = typeof item === 'object' ? item.isPlazaFija : ['PATIO', 'TALLER', 'AGENCIA', 'TALLER EXTERNO', 'HYP COBIAN'].includes(item);
          const plazaTag = item.plazaId ? `<span style="font-size:10px; background:#0ea5e9; color:white; padding:2px 6px; border-radius:4px; font-weight:700; display:inline-block; margin-left:4px;">${escapeHtml(item.plazaId)}</span>` : '';
          pText = (isPlaza
            ? `<span style="font-size:10px; background:#10b981; color:white; padding:2px 6px; border-radius:4px; font-weight:700; display:inline-block; margin-left:8px;">PLAZA FIJA</span>`
            : `<span style="font-size:10px; background:#6366f1; color:white; padding:2px 6px; border-radius:4px; font-weight:700; display:inline-block; margin-left:8px;">PERSONA RESPON.</span>`) + plazaTag;
        }

        if(TAB_ACTIVA_CFG === 'modelos') {
          const modCat = typeof item === 'object' ? item.categoria : 'SIN ASIGNAR';
          const catFilter = document.getElementById('cfg-modelo-cat-filter')?.value || '';
          pText = `<span style="font-size:10px; background:#475569; color:white; padding:2px 6px; border-radius:4px; display:inline-block; margin-left:8px;">${escapeHtml(modCat || 'SIN CAT.')}</span>`;
        }

        if(TAB_ACTIVA_CFG === 'categorias') {
          const modelos = (window.MEX_CONFIG.listas.modelos || []).filter(m => (typeof m === 'object' ? m.categoria : '') === valor);
          const preview = modelos.slice(0, 3).map(m => m.nombre).join(', ');
          const extra = modelos.length > 3 ? ` +${modelos.length - 3}` : '';
          if (modelos.length > 0) {
            pText = `<span style="font-size:11px; color:#64748b; font-weight:600; margin-left:8px; cursor:pointer;" onclick="cfgToggleModelos('catmod-${i}')" title="Ver modelos">
              [${preview}${extra}] <span class="material-icons" style="font-size:11px; vertical-align:middle;">expand_more</span>
            </span>`;
          }
        }

        if(TAB_ACTIVA_CFG === 'gasolinas') {
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

        const modelosExpandidos = TAB_ACTIVA_CFG === 'categorias'
          ? `<div id="catmod-${i}" class="cfg-cat-models-expand" style="display:none;">
              ${(window.MEX_CONFIG.listas.modelos || []).filter(m => (typeof m === 'object' ? m.categoria : '') === valor).map(m => `<span class="cfg-cat-model-chip">${escapeHtml(m.nombre)}</span>`).join('') || '<span style="font-size:11px;color:#94a3b8;">Sin modelos asignados</span>'}
            </div>` : '';

        return `<div class="cfg-item" ${dragAttrs} data-cfg-idx="${i}" style="padding:10px 12px; display:flex; flex-direction:column; background:white; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:8px; transition:opacity 0.15s;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
              ${dragHandle}
              ${color ? `<div style="background:${color}; width:14px; height:14px; border-radius:50%; flex-shrink:0; box-shadow:0 0 0 1px rgba(0,0,0,0.1);" title="${color}"></div>` : ''}
              <strong style="white-space:nowrap; text-overflow:ellipsis; overflow:hidden; font-size:13px;">${escapeHtml(valor)}</strong>
              ${pText}
              ${esEstado && item.orden ? `<span style="font-size:10px; color:#94a3b8; font-weight:700; flex-shrink:0;">ord.${item.orden}</span>` : ''}
            </div>
            <div style="display:flex; gap:4px; flex-shrink:0;">
              <button style="border:none; background:#f1f5f9; padding:5px; border-radius:6px; cursor:pointer; display:flex; align-items:center;" onclick="editarElementoConfig(${i})" title="Editar">
                <span class="material-icons" style="font-size:14px; color:#0f172a;">edit</span>
              </button>
              <button class="cfg-item-del" style="border:none; background:#fee2e2; padding:5px; border-radius:6px; cursor:pointer; display:flex; align-items:center;" onclick="eliminarElementoConfig(${i})" title="Eliminar">
                <span class="material-icons" style="font-size:14px; color:#ef4444;">delete</span>
              </button>
            </div>
          </div>
          ${modelosExpandidos}
        </div>`;
      }).join('');
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

    function cfgDrop(event, destOrigIdx) {
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
      _cfgDragSrcIdx = null;
      renderizarListaConfig();
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
        ubicaciones: { icon: 'place',             sub: 'Patio, persona o lugar de destino' },
        estados:     { icon: 'sell',              sub: 'Estado con color personalizado para el mapa' },
        modelos:     { icon: 'directions_car',    sub: 'Modelo o versión de vehículo' },
        categorias:  { icon: 'category',          sub: 'Agrupación de modelos de vehículo' },
        gasolinas:   { icon: 'local_gas_station', sub: 'Nivel de combustible (ej: ½, ¾, F)' },
      };
      const LABELS = { ubicaciones:'Ubicación', estados:'Estado', modelos:'Modelo', categorias:'Categoría', gasolinas:'Nivel de gasolina' };
      const m = META[type] || { icon: 'add_circle', sub: '' };
      const label = LABELS[type] || 'Elemento';
      const title = isEdit ? `Editar ${label}` : `Nueva ${label}`;
      const iconEl  = document.getElementById('cfg-add-header-icon');
      const titleEl = document.getElementById('modal-cfg-add-title');
      const subEl   = document.getElementById('cfg-add-header-sub');
      if (iconEl)  iconEl.innerHTML  = `<span class="material-icons">${m.icon}</span>`;
      if (titleEl) titleEl.textContent = title;
      if (subEl)   subEl.textContent   = m.sub;
    }

    function _cfgUpdateColorSwatch(hex) {
      const swatch   = document.getElementById('cfg-add-color-swatch');
      const hexLabel = document.getElementById('cfg-add-color-hex');
      const colorIn  = document.getElementById('cfg-add-color');
      if (swatch)   swatch.style.background = hex;
      if (hexLabel) hexLabel.textContent = hex.toUpperCase();
      if (colorIn && colorIn.value !== hex) colorIn.value = hex;
    }

    function _cfgFillColorPresets() {
      const PRESETS = ['#0f172a','#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#0ea5e9','#f97316','#ec4899','#14b8a6','#64748b','#e2e8f0'];
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
      document.getElementById('cfg-add-name').value = '';
      document.getElementById('cfg-add-ubi-options').style.display = 'none';
      document.getElementById('cfg-add-estado-options').style.display = 'none';
      document.getElementById('cfg-add-modelo-options').style.display = 'none';

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
        document.getElementById('cfg-add-modelo-cat').innerHTML = '<option value="">(Ninguna)</option>' + cats.map(c => `<option value="${escapeHtml(typeof c === 'object'? c.nombre||c.id : c)}">${escapeHtml(typeof c === 'object'? c.nombre||c.id : c)}</option>`).join('');
      }

      document.getElementById('cfg-add-name').dataset.editIndex = -1;
      _cfgSetModalMeta(TAB_ACTIVA_CFG, false);
      _cfgShowModal();
    }

    function editarElementoConfig(index) {
      const lista = window.MEX_CONFIG.listas[TAB_ACTIVA_CFG];
      const item = lista[index];
      const nombre = typeof item === 'object' ? (item.id || item.nombre) : item;

      document.getElementById('cfg-add-name').value = nombre;
      document.getElementById('cfg-add-ubi-options').style.display = 'none';
      document.getElementById('cfg-add-estado-options').style.display = 'none';
      document.getElementById('cfg-add-modelo-options').style.display = 'none';

      if (TAB_ACTIVA_CFG === 'ubicaciones') {
        document.getElementById('cfg-add-ubi-options').style.display = 'block';
        document.getElementById('cfg-add-is-plaza').checked = typeof item === 'object' ? item.isPlazaFija : ['PATIO', 'TALLER', 'AGENCIA', 'TALLER EXTERNO', 'HYP COBIAN'].includes(item);
        const currentPlaza = typeof item === 'object' ? (item.plazaId || '') : '';
        _llenarSelectPlazasUbi('cfg-add-ubi-plaza', currentPlaza);
      } else if (TAB_ACTIVA_CFG === 'estados') {
        document.getElementById('cfg-add-estado-options').style.display = 'block';
        const color = (typeof item === 'object' ? item.color : null) || '#64748b';
        document.getElementById('cfg-add-color').value = color;
        document.getElementById('cfg-add-orden').value = (typeof item === 'object' ? item.orden : null) || '99';
        _cfgUpdateColorSwatch(color);
        _cfgFillColorPresets();
      } else if (TAB_ACTIVA_CFG === 'modelos') {
        document.getElementById('cfg-add-modelo-options').style.display = 'block';
        const cats = window.MEX_CONFIG.listas.categorias || [];
        document.getElementById('cfg-add-modelo-cat').innerHTML = '<option value="">(Ninguna)</option>' + cats.map(c => {
          const cName = typeof c === 'object' ? c.nombre||c.id : c;
          return `<option value="${escapeHtml(cName)}">${escapeHtml(cName)}</option>`;
        }).join('');
        document.getElementById('cfg-add-modelo-cat').value = typeof item === 'object' ? item.categoria : '';
      }

      document.getElementById('cfg-add-name').dataset.editIndex = index;
      _cfgSetModalMeta(TAB_ACTIVA_CFG, true);
      _cfgShowModal();
    }

    function confirmarAgregadoConfig() {
      const val = document.getElementById('cfg-add-name').value.trim().toUpperCase();
      if (!val) { showToast("Escribe un nombre", "error"); return; }
      
      window.MEX_CONFIG.listas[TAB_ACTIVA_CFG] = window.MEX_CONFIG.listas[TAB_ACTIVA_CFG] || [];
      const lista = window.MEX_CONFIG.listas[TAB_ACTIVA_CFG];
      
      const editIndex = parseInt(document.getElementById('cfg-add-name').dataset.editIndex, 10);
      const existe = lista.some((i, idx) => {
         if (idx === editIndex) return false; // ignore self
         return (typeof i === 'object' ? (i.id || i.nombre) : i) === val;
      });
      if (existe) { showToast(`"${val}" ya existe`, "error"); return; }

      let newItem;
      if (TAB_ACTIVA_CFG === 'estados') {
        newItem = { 
           id: val, 
           color: document.getElementById('cfg-add-color').value, 
           orden: parseInt(document.getElementById('cfg-add-orden').value || 99) 
        };
      } else if(TAB_ACTIVA_CFG === 'ubicaciones') {
        const plazaSel = document.getElementById('cfg-add-ubi-plaza')?.value || '';
        newItem = { nombre: val, isPlazaFija: document.getElementById('cfg-add-is-plaza').checked, plazaId: plazaSel };
      } else if(TAB_ACTIVA_CFG === 'modelos') {
        newItem = { nombre: val, categoria: document.getElementById('cfg-add-modelo-cat').value };
      } else {
        newItem = val;
      }

      if (editIndex > -1) {
         lista[editIndex] = newItem; // Edit
      } else {
         lista.push(newItem); // Add
      }

      document.getElementById('modal-cfg-add').style.display = 'none';
      renderizarListaConfig();
    }

    function moverElementoConfig(index, dir) {
       const lista = window.MEX_CONFIG.listas[TAB_ACTIVA_CFG];
       if(index + dir < 0 || index + dir >= lista.length) return;
       const temp = lista[index];
       lista[index] = lista[index+dir];
       lista[index+dir] = temp;
       renderizarListaConfig();
    }

    function eliminarElementoConfig(index) {
      const item = window.MEX_CONFIG.listas[TAB_ACTIVA_CFG][index];
      const nombre = typeof item === 'object' ? (item.id || item.nombre) : item;
      mexConfirm(`Eliminar "${nombre}"`, '¿Estás seguro? Esta acción no se puede deshacer.', 'danger').then(ok => {
        if (!ok) return;
        window.MEX_CONFIG.listas[TAB_ACTIVA_CFG].splice(index, 1);
        renderizarListaConfig();
      });
    }

    async function ejecutarMigracionLegacy() {
      if (!canUseProgrammerConfig()) { showToast("Sin permiso para esta operación.", "error"); return; }
      const ok = await mexConfirm(
        'Migrar datos legacy',
        '¿Migrar todos los datos al nuevo formato por plaza?\n\nEsta operación es segura: copia los datos, NO los borra.',
        'warning'
      );
      if (!ok) return;

      const btn   = document.getElementById('cfg-mig-btn');
      const prog  = document.getElementById('cfg-mig-progress');
      const bar   = document.getElementById('cfg-mig-bar');
      const label = document.getElementById('cfg-mig-label');
      const pct   = document.getElementById('cfg-mig-pct');
      const log   = document.getElementById('cfg-mig-log');

      const COLS = ['cuadre', 'externos', 'cuadre_admins', 'historial_cuadres', 'configuracion/listas'];
      let colIdx = 0;

      function onProgress({ col, informe }) {
        colIdx = COLS.indexOf(col);
        if (colIdx < 0) colIdx = COLS.length - 1;
        const pctVal = Math.round(((colIdx + 1) / COLS.length) * 100);
        bar.style.width = pctVal + '%';
        pct.textContent = pctVal + '%';
        label.textContent = `Procesando: ${col}`;
        log.style.display = 'block';
        log.textContent = `OK: ${informe.ok} | Skip: ${informe.skip} | Errores: ${informe.errores.length}`;
        if (informe.errores.length) log.textContent += '\n' + informe.errores.slice(-5).join('\n');
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="material-icons spinner" style="font-size:16px;">sync</span> Migrando...';
      prog.style.display = 'block';
      bar.style.width = '0%';
      log.style.display = 'none';
      log.textContent = '';

      try {
        const result = await api.migrarDatosLegacyAPlazas(onProgress);
        bar.style.width = '100%';
        bar.style.background = result.errores.length === 0 ? '#10b981' : '#f59e0b';
        pct.textContent = '100%';
        label.textContent = result.errores.length === 0 ? '¡Migración completada!' : 'Completado con advertencias';
        log.style.display = 'block';
        log.textContent = `✅ Migrados: ${result.ok} | ⏭ Ya existían: ${result.skip} | ❌ Errores: ${result.errores.length}`;
        if (result.errores.length) log.textContent += '\n\nSin plaza (no migrados):\n' + result.errores.join('\n');
        btn.innerHTML = '<span class="material-icons" style="font-size:16px;">check_circle</span> Migración completada';
        btn.style.background = '#10b981';
        showToast(`Migración terminada: ${result.ok} docs migrados`, result.errores.length ? 'warning' : 'success');
      } catch (e) {
        btn.innerHTML = '<span class="material-icons" style="font-size:16px;">error</span> Error';
        btn.style.background = '#ef4444';
        btn.disabled = false;
        showToast('Error en migración: ' + e.message, 'error');
      }
    }

    async function guardarConfiguracionEnFirebase() {
      if (!canUseProgrammerConfig()) {
        showToast("Tu rol no puede publicar esta configuración.", "error");
        return;
      }
      const ok = await mexConfirm('Publicar cambios', '¿Aplicar los cambios a toda la app ahora mismo?', 'warning');
      if (!ok) return;
      showToast("Subiendo configuración…", "info");
      try {
        await db.collection("configuracion").doc("empresa").set(window.MEX_CONFIG.empresa, {merge:true});
        await api.garantizarPlazasOperativas(window.MEX_CONFIG?.empresa?.plazas || []);
        await api.guardarConfiguracionListas(window.MEX_CONFIG.listas, USER_NAME, _miPlaza());
        showToast("Configuración actualizada", "success");
        aplicarVariablesDeEmpresa(window.MEX_CONFIG.empresa);
        _aplicarColoresEstados();
        llenarSelectsDinamicos();
        _renderPlazaSwitcher();
        document.getElementById('modal-config-global').classList.remove('active');
      } catch (error) {
        showToast("Error al guardar: " + error.message, "error");
      }
    }

    // ─── LÓGICA DE USUARIOS EN CONFIGURACIÓN ──────────────────────
    function renderizarTabConfigUsuarios(container) {
      container.innerHTML = `
        <div style="padding:0 10px 12px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <!-- Buscador + chips -->
          <div style="display:flex; flex-direction:column; gap:8px; flex:1; min-width:220px;">
            <div class="um-search-wrap">
              <span class="material-icons um-search-icon">search</span>
              <input type="text" id="um-search" placeholder="Buscar por nombre, correo o rol..." oninput="umFiltrar()">
            </div>
            <div id="um-plaza-chips" style="display:flex; gap:6px; flex-wrap:wrap;"></div>
          </div>
          <!-- Botón nuevo usuario -->
          <button id="btn-nuevo-usuario" onclick="_umNuevoUsuarioConAnim()"
            style="background:var(--mex-accent);color:white;border:none;padding:11px 20px;border-radius:12px;
                   font-size:12px;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:7px;
                   box-shadow:0 4px 14px rgba(99,102,241,0.3);transition:opacity .15s;white-space:nowrap;">
            <span class="material-icons" style="font-size:17px;">person_add</span> NUEVO USUARIO
          </button>
        </div>

        <div class="um-body" style="height:auto;min-height:55vh;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin:0 10px;">
          <div class="um-list-col">
            <div id="um-cards-container">
              <div class="um-loading"><span class="material-icons spinner" style="vertical-align:middle;">sync</span> Cargando...</div>
            </div>
          </div>
          <div class="um-edit-col">
            <div id="um-placeholder" class="um-placeholder">
              <span class="material-icons">manage_accounts</span>
              <p>Selecciona un usuario para editarlo<br>o crea uno nuevo.</p>
            </div>
            <div id="um-form-container" style="display:none;width:100%;max-width:480px;"></div>
          </div>
        </div>
      `;
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
        return `<button onclick="_umTogglePlazaChip('${escapeHtml(p)}')" style="
          padding:4px 11px; border-radius:20px; font-size:11px; font-weight:800; cursor:pointer; border:1.5px solid;
          ${active
            ? 'background:var(--mex-accent);color:white;border-color:var(--mex-accent);'
            : 'background:white;color:#475569;border-color:#e2e8f0;'
          }transition:all .15s;">${p}</button>`;
      }).join('');
    }

    function _umTogglePlazaChip(plaza) {
      _umPlazaFiltro = _umPlazaFiltro === plaza ? null : plaza;
      _umRenderPlazaChips();
      _umRenderCards();
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
       container.innerHTML = `
         <div style="background:white; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden; display:flex; flex-direction:column; height: 100%; min-height: 60vh; margin: 0 10px;">
            <div style="display:flex; border-bottom:1px solid #e2e8f0; background:#f8fafc;">
               <button id="tab-sol-PENDIENTE" class="sol-tab active" onclick="cambiarTabSolicitudes('PENDIENTE')" style="flex:1; padding:12px; font-weight:800; font-size:12px; color:var(--mex-blue); border:none; background:transparent; border-bottom:2px solid var(--mex-blue); cursor:pointer;">PENDIENTES</button>
               <button id="tab-sol-APROBADO" class="sol-tab" onclick="cambiarTabSolicitudes('APROBADO')" style="flex:1; padding:12px; font-weight:800; font-size:12px; color:#64748b; border:none; background:transparent; border-bottom:2px solid transparent; cursor:pointer;">APROBADAS</button>
               <button id="tab-sol-RECHAZADO" class="sol-tab" onclick="cambiarTabSolicitudes('RECHAZADO')" style="flex:1; padding:12px; font-weight:800; font-size:12px; color:#64748b; border:none; background:transparent; border-bottom:2px solid transparent; cursor:pointer;">RECHAZADAS</button>
            </div>
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
        return `
          <div class="cfg-plaza-card${isActive}" onclick="plazaSeleccionarCfg('${escapeHtml(plazaId)}')">
            <div class="cfg-plaza-icon">${escapeHtml(plazaId.slice(0,3))}</div>
            <div class="cfg-plaza-info">
              <div class="cfg-plaza-name">${escapeHtml(plazaId)}</div>
              <div class="cfg-plaza-local">${sub}</div>
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

    function _confirmarNuevaplaza() {
      const idInp   = document.getElementById('nueva-plaza-id');
      const nomInp  = document.getElementById('nueva-plaza-nombre');
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
      _plazaFormLocked = false; // open in edit mode since just created
      renderizarListaConfig();
      setTimeout(() => plazaSeleccionarCfg(p), 50);
      showToast(`Plaza "${p}" creada. Configura sus detalles y publica para guardar.`, 'success');
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

    function _plazaGetUserEmailOptions(selectedVal, currentPlazaId) {
      const users = (typeof _umUsers !== 'undefined' && _umUsers) ? _umUsers : [];
      const emails = [...new Set(users.map(u => u.email).filter(Boolean))].sort();

      // Correos ya asignados en OTRAS plazas (no en la actual)
      const plazasDetalle = window.MEX_CONFIG?.empresa?.plazasDetalle || [];
      const emailsOtrasPlazas = new Set();
      plazasDetalle.forEach(p => {
        if (p.id === currentPlazaId) return;
        if (p.correo) emailsOtrasPlazas.add(p.correo.toLowerCase());
        if (p.correoGerente) emailsOtrasPlazas.add(p.correoGerente.toLowerCase());
      });

      const disponibles = emails.filter(e => !emailsOtrasPlazas.has(e.toLowerCase()));

      if (disponibles.length === 0) {
        return `<option value="${escapeHtml(selectedVal)}">${escapeHtml(selectedVal || '— Sin correos disponibles —')}</option>`;
      }
      return `<option value="">— Sin asignar —</option>` +
        disponibles.map(e => `<option value="${escapeHtml(e)}"${e === selectedVal ? ' selected' : ''}>${escapeHtml(e)}</option>`).join('');
    }

    function _renderPlazaForm(plazaId) {
      const emp = window.MEX_CONFIG.empresa || {};
      const plazasDetalle = emp.plazasDetalle || [];
      const d = plazasDetalle.find(x => x.id === plazaId) || {};
      const contactos = Array.isArray(d.contactos) ? d.contactos : [];
      const locked = _plazaFormLocked;

      const AVATAR_COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#0ea5e9','#f97316','#ec4899'];
      function _initials(n) {
        if (!n) return '?';
        const p = n.trim().split(/\s+/);
        return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : n.slice(0,2).toUpperCase();
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
                <input type="text" class="plaza-cnt-nombre" value="${escapeHtml(c.nombre||'')}" placeholder="Nombre completo">
                <div class="plaza-cnt-row2">
                  <input type="text" class="plaza-cnt-rol" value="${escapeHtml(c.rol||'')}" placeholder="Puesto / Rol">
                  <input type="tel" class="plaza-cnt-tel" value="${escapeHtml(c.telefono||'')}" placeholder="Teléfono">
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
            <div class="cfg-plaza-form-hero-badge">${escapeHtml(plazaId.slice(0,3))}</div>
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

          <!-- ── Información General ── -->
          <div class="cfg-plaza-section-header">
            <span class="material-icons">info_outline</span> Información General
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
                  ${_plazaGetUserEmailOptions(d.correo || '', plazaId)}
                </select>
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
                  ${_plazaGetUserEmailOptions(d.correoGerente || '', plazaId)}
                </select>
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
      const chip   = document.getElementById(`plaza-contact-${ci}`);
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
      const AVATAR_COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#0ea5e9','#f97316','#ec4899'];
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

    function plazaGuardarCfg(plazaId) {
      const emp = window.MEX_CONFIG.empresa;
      if(!emp) return showToast('Error: config no cargada', 'error');
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
        correo: (document.getElementById('plaza-correo')?.value || '').trim().toLowerCase(),
        telefono: (document.getElementById('plaza-telefono')?.value || '').trim(),
        gerente: (document.getElementById('plaza-gerente')?.value || '').trim().toUpperCase(),
        correoGerente: (document.getElementById('plaza-correo-gerente')?.value || '').trim().toLowerCase(),
        contactos
      };
      if(idx > -1) emp.plazasDetalle[idx] = datos;
      else emp.plazasDetalle.push(datos);
      _plazaFormLocked = true;
      showToast(`Plaza ${plazaId} guardada. Publica los cambios para confirmar.`, 'success');
      plazaSeleccionarCfg(plazaId);
    }

    function _llenarSelectPlazasUbi(selectId, selected) {
      const sel = document.getElementById(selectId);
      if (!sel) return;
      const plazas = (window.MEX_CONFIG?.empresa?.plazas || []);
      sel.innerHTML = '<option value="">— Todas las plazas —</option>' +
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
      if (_plazaSeleccionadaCfg === plazaId) _plazaSeleccionadaCfg = null;
      renderizarListaConfig();
      showToast(`Plaza "${plazaId}" eliminada.`, 'success');
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
    }

    function _renderCorreosInternosHtml(correos, filter) {
      const q = filter || (document.getElementById('cfg-correo-interno-search')?.value || '').toLowerCase().trim();
      const lista = correos.filter(c => {
        if (!q) return true;
        const str = typeof c === 'object' ? `${c.titulo||''} ${c.correo||''}` : c;
        return str.toLowerCase().includes(q);
      });
      if (lista.length === 0) return '<div style="font-size:12px; color:#cbd5e1; font-weight:700; padding:8px 0;">Sin correos configurados.</div>';
      return lista.map((c, i) => {
        const correo = typeof c === 'object' ? (c.correo || '') : c;
        const titulo = typeof c === 'object' ? (c.titulo || '') : '';
        const origIdx = correos.indexOf(c);
        return `<div style="display:flex; align-items:center; gap:8px; background:white; border:1px solid #e2e8f0; border-radius:10px; padding:8px 10px;">
          <span class="material-icons" style="font-size:16px; color:#94a3b8; flex-shrink:0;">email</span>
          <div style="flex:1; overflow:hidden;">
            ${titulo ? `<div style="font-size:10px; font-weight:800; color:#64748b; text-transform:uppercase;">${escapeHtml(titulo)}</div>` : ''}
            <div style="font-size:12px; font-weight:700; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(correo)}</div>
          </div>
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
      lista.splice(idx, 1);
      emp.correosInternos = lista;
      _renderCorreosInternosList();
      showToast('Correo eliminado. Publica para confirmar.', 'success');
    }

    function agregarCorreoInterno() {
      const input  = document.getElementById('cfg-correo-interno-input');
      const tInput = document.getElementById('cfg-correo-interno-titulo');
      if(!input) return;
      const correo = input.value.trim().toLowerCase();
      const titulo = tInput ? tInput.value.trim() : '';
      if(!correo || !correo.includes('@')) { showToast('Correo inválido', 'error'); return; }
      const emp = window.MEX_CONFIG.empresa || {};
      emp.correosInternos = emp.correosInternos || [];
      const yaExiste = emp.correosInternos.some(c => (typeof c === 'object' ? c.correo : c) === correo);
      if(yaExiste) { showToast('Ese correo ya existe', 'error'); return; }
      emp.correosInternos.push(titulo ? { correo, titulo } : correo);
      window.MEX_CONFIG.empresa = emp;
      input.value = '';
      if (tInput) tInput.value = '';
      _renderCorreosInternosList();
      showToast('Correo añadido. Publica para guardar.', 'success');
    }

    function renderCorreosInternos() {
      const container = document.getElementById('cfg-correos-internos-tags');
      if(!container) return;
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
      if(!file) return;
      if(file.size > 2 * 1024 * 1024) { showToast('El archivo no debe superar 2MB', 'error'); return; }

      const zone = document.getElementById('cfg-logo-zone');
      if(zone) zone.innerHTML = `
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
        if(zone) zone.innerHTML = `
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
        showToast('Logo subido. Publica los cambios para guardar.', 'success');
      } catch(e) {
        console.error(e);
        showToast('Error al subir logo: ' + e.message, 'error');
        if(zone) zone.innerHTML = `<div class="cfg-emp-logo-placeholder"><span class="material-icons">add_photo_alternate</span><span>Click para subir logo</span></div>`;
      }
    }

    async function eliminarLogoEmpresa() {
      const ok = await mexConfirm('Eliminar logo', '¿Eliminar el logo de la empresa?', 'danger');
      if(!ok) return;
      try {
        if(window.MEX_CONFIG.empresa?.logoURL) {
          try { await firebase.storage().refFromURL(window.MEX_CONFIG.empresa.logoURL).delete(); } catch(_){}
        }
        window.MEX_CONFIG.empresa.logoURL = '';
        renderizarListaConfig();
        showToast('Logo eliminado. Publica los cambios.', 'success');
      } catch(e) {
        showToast('Error: ' + e.message, 'error');
      }
    }

    // ─────────────────────────────────────────────────────────────────────

    function cambiarTabSolicitudes(estado) {
       window._filtroSolicitudesEstatus = estado;
       ['PENDIENTE', 'APROBADO', 'RECHAZADO'].forEach(st => {
         const btn = document.getElementById('tab-sol-' + st);
         if(btn) {
           if(st === estado) {
             btn.style.color = 'var(--mex-blue)';
             btn.style.borderBottomColor = 'var(--mex-blue)';
           } else {
             btn.style.color = '#64748b';
             btn.style.borderBottomColor = 'transparent';
           }
         }
       });
       const searchUrl = document.getElementById('busqueda-solicitudes');
       if(searchUrl) searchUrl.value = '';
       cargarSolicitudesDeTab(estado);
    }

    async function cargarSolicitudesDeTab(estado) {
      if (!canProcessAccessRequests()) return;
      const contenedor = document.getElementById('contenedor-solicitudes-v2');
      if(!contenedor) return;
      contenedor.innerHTML = `<div style="text-align:center; padding: 30px;"><span class="material-icons spinner" style="font-size:30px; color:var(--mex-blue);">sync</span></div>`;

      try {
        const estBD = estado === 'RECHAZADO' ? 'RECHAZADA' : estado === 'APROBADO' ? 'APROBADA' : 'PENDIENTE';
        const snapshot = await db.collection("solicitudes_acceso")
          .where("estado", "==", estBD)
          .get();

        if(estado === 'PENDIENTE') {
           const badgeCfg = document.getElementById('badge-config-solicitudes');
           if(badgeCfg) badgeCfg.style.display = snapshot.size > 0 ? 'inline-block' : 'none';
           const badgeSb = document.getElementById('badge-solicitudes');
           if(badgeSb) {
             badgeSb.innerText = snapshot.size;
             badgeSb.style.display = snapshot.size > 0 ? 'inline-block' : 'none';
           }
        }

        if (snapshot.empty) {
          contenedor.innerHTML = `
           <div style="text-align: center; color: #64748b; padding: 40px; font-weight: 700;">
             <span class="material-icons" style="font-size: 40px; color: #cbd5e1;">check_circle</span><br>
             No hay solicitudes en este buzón.
           </div>`;
          window._objSolicitudesMemoria = [];
          return;
        }
        
        window._objSolicitudesMemoria = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        filtrarSolicitudesActuales();

      } catch(e) { console.error(e); }
    }

    function filtrarSolicitudesActuales() {
       const query = (document.getElementById('busqueda-solicitudes')?.value || "").toUpperCase().trim();
       const contenedor = document.getElementById('contenedor-solicitudes-v2');
       if(!contenedor) return;

       const dataList = window._objSolicitudesMemoria.filter(data => {
          if(!query) return true;
          const str = `${data.nombre || ''} ${data.email || ''} ${data.puesto || ''} ${data.rolSolicitado || ''}`.toUpperCase();
          return str.includes(query);
       });

       if(dataList.length === 0) {
          contenedor.innerHTML = `<div style="text-align:center;color:#64748b;">Sin coincidencias...</div>`;
          return;
       }

       let html = "";
       dataList.forEach(data => {
          const requestedRole = _resolveStoredRoleForEmail(data.email, _sanitizeRole(data.rolSolicitado) || _inferRequestedAccessRole(data.puesto, data.email));
          const roleLabel = ROLE_META[requestedRole] ? ROLE_META[requestedRole].label : requestedRole;
          let actionBtns = "";
          if (window._filtroSolicitudesEstatus === 'PENDIENTE') {
            actionBtns = `
              <button onclick="procesarSolicitud('${data.id}', false)" style="background: #fee2e2; color: #ef4444; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size:11px;">
                <span class="material-icons" style="font-size: 14px;">close</span> RECHAZAR
              </button>
              <button onclick="procesarSolicitud('${data.id}', true)" style="background: #10b981; color: white; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size:11px;">
                <span class="material-icons" style="font-size: 14px;">check</span> APROBAR
              </button>
            `;
          } else if (window._filtroSolicitudesEstatus === 'RECHAZADO') {
            const motivoEsc = escapeHtml(data.motivo_rechazo || 'Sin motivo registrado');
            const porEsc    = escapeHtml(data.rechazadoPor   || 'Desconocido');
            actionBtns = `
              <button onclick="verInfoRechazo('${data.id}')" style="background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; padding: 8px 12px; border-radius: 6px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size:11px;">
                <span class="material-icons" style="font-size: 14px;">info</span> MÁS INFO
              </button>
              <button onclick="procesarSolicitud('${data.id}', true)" style="background: #10b981; color: white; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size:11px;">
                <span class="material-icons" style="font-size: 14px;">refresh</span> RE-APROBAR
              </button>
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
      const motivo  = data.motivo_rechazo  || 'Sin motivo registrado';
      const rechPor = data.rechazadoPor    || 'Desconocido';
      const fecha   = data.fecha           || '';
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
      let ubicFiltradas = ubicaciones;
      const miP = (_miPlaza() || '').toUpperCase();
      if (miP) {
        ubicFiltradas = ubicaciones.filter(u => {
          const plazaId = ((typeof u === 'object' ? u.plazaId : null) || '').toUpperCase();
          return !plazaId || plazaId === miP;
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
        panelAdminDivider: canUseProgrammerConfig(),
        navGroupPanelAdmin: canUseProgrammerConfig()
      };

      Object.entries(visibilidadEspecial).forEach(([id, visible]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? (el.tagName === 'DIV' && !el.classList.contains('sb-divider') ? 'flex' : (el.classList.contains('sb-divider') ? 'block' : 'flex')) : 'none';
      });

      if (userRole === 'admin') {
        operacionAdmin.forEach(id => {
          const btn = document.getElementById(id);
          if (btn) btn.style.display = 'flex';
        });

        if (hasFullAccess()) {
          inicializarConfiguracion();
        }

        if (typeof cargarMaestra === "function") cargarMaestra();

      } else {
        operacionAdmin.forEach(id => {
          const btn = document.getElementById(id);
          if (btn) btn.style.display = 'none';
        });
      }

      _actualizarBloquesAdminSidebar();
    }


    // --- LÓGICA DE SOLICITUDES DE ACCESO ---

    function abrirModalSolicitudes() {
      if (!canProcessAccessRequests()) {
        showToast("Solo los roles superiores pueden revisar solicitudes.", "error");
        return;
      }
      abrirPanelConfiguracion('solicitudes');
    }

    // Mantener solo la actualización del badge del sidebar en tiempo de carga
    async function cargarSolicitudesPendientes() {
      if (!canProcessAccessRequests()) return;
      try {
        const snapshot = await db.collection("solicitudes_acceso")
          .where("estado", "==", "PENDIENTE")
          .get();
        const badge = document.getElementById('badge-solicitudes');
        if (badge) {
          badge.innerText = snapshot.size;
          badge.style.display = snapshot.size > 0 ? 'inline-block' : 'none';
        }
        const badgeCfg = document.getElementById('badge-config-solicitudes');
        if (badgeCfg) badgeCfg.style.display = snapshot.size > 0 ? 'inline-block' : 'none';
      } catch(e) { console.warn('cargarSolicitudesPendientes badge error', e); }
    }

    async function procesarSolicitud(docId, esAprobado) {
      if (!canProcessAccessRequests()) {
        return showToast("No tienes permisos para procesar solicitudes.", "error");
      }
      const docSnap = await db.collection("solicitudes_acceso").doc(docId).get();
      if (!docSnap.exists) return showToast("La solicitud ya no existe", "error");

      const { email, nombre, puesto, telefono, password, rolSolicitado, plazaSolicitada } = docSnap.data();
      const requestedRole = _resolveStoredRoleForEmail(
        email,
        _sanitizeRole(rolSolicitado) || _inferRequestedAccessRole(puesto, email)
      );
      const requestedRoleMeta = ROLE_META[requestedRole] || ROLE_META.AUXILIAR;
      const requestedPlaza = _roleNeedsPlaza(requestedRole) ? _normalizePlaza(plazaSolicitada) : "";
      let motivo = "";

      if (!esAprobado) {
        motivo = await mexPrompt(
          `Rechazar solicitud de ${nombre}`,
          'Escribe el motivo del rechazo (se enviará al solicitante):',
          'No cumples con los criterios de acceso requeridos.'
        );
        if (motivo === null) return;
        if (!motivo.trim()) motivo = "No cumples con los criterios de acceso requeridos en este momento.";
      } else {
        const ok = await mexConfirm(
          `Aprobar acceso para ${nombre}`,
          `Se creará una cuenta para: ${email}. Esta acción no se puede deshacer.`,
          'success'
        );
        if (!ok) return;
      }

      showToast("Procesando...", "info"); // Aviso visual mientras piensa

      try {
        let detalleGestion = "";
        if (esAprobado) {
          const appSecundaria = firebase.initializeApp(firebase.app().options, "AppRegistro_" + Date.now());
          let nuevoUid = null;
          try {
            const cred = await appSecundaria.auth().createUserWithEmailAndPassword(email, password);
            nuevoUid = cred && cred.user ? cred.user.uid : null;
            detalleGestion = "Cuenta creada en Firebase Auth";
          } catch (authErr) {
            console.warn("Aviso de Auth:", authErr.message);
            if (authErr.code !== 'auth/email-already-in-use') throw authErr;
            detalleGestion = "El correo ya existía en Auth; se restauró/actualizó solo el perfil de Firestore";
          }
          await appSecundaria.auth().signOut();
          await appSecundaria.delete();

          // Crea el perfil con solo los campos que valida perfilUsuarioValido
          const userDocId = _profileDocId(email);
          const perfilData = {
            nombre: String(nombre || '').trim().toUpperCase(),
            email: userDocId,
            telefono: telefono || "",
            rol: requestedRole,
            plazaAsignada: requestedPlaza,
            isAdmin: requestedRoleMeta.isAdmin,
            isGlobal: requestedRoleMeta.fullAccess
          };
          await db.collection("usuarios").doc(userDocId).set(perfilData, { merge: true });

          // Guardar datos extra en un sub-doc separado para no violar el schema estricto
          if (nuevoUid) {
            await db.collection("usuarios").doc(userDocId).update({ status: "ACTIVO" }).catch(() => {});
          }

          if (nuevoUid && nuevoUid !== userDocId) {
            const legacyRef = db.collection("usuarios").doc(nuevoUid);
            const legacySnap = await legacyRef.get();
            if (legacySnap.exists) await legacyRef.delete();
          }

          // Update solicitud con todos los campos que la regla exige (solicitudUpdateValida)
          const solDoc = docSnap.data();
          await db.collection("solicitudes_acceso").doc(docId).update({
            nombre: solDoc.nombre,
            email: solDoc.email,
            puesto: solDoc.puesto,
            telefono: solDoc.telefono,
            fecha: solDoc.fecha,
            rolSolicitado: solDoc.rolSolicitado ?? null,
            plazaSolicitada: solDoc.plazaSolicitada ?? null,
            password: "",
            estado: "APROBADA"
          });
          await registrarEventoGestion('SOLICITUD_APROBADA', `Aprobó la solicitud de acceso de ${nombre}`, {
            entidad: 'SOLICITUDES_ACCESO',
            referencia: docId,
            objetivo: email,
            rolObjetivo: requestedRole,
            plazaObjetivo: requestedPlaza,
            detalles: detalleGestion,
            resultado: 'APROBADA'
          });
        } else {
          // Update solicitud con todos los campos que la regla exige (solicitudUpdateValida)
          const solDocR = docSnap.data();
          await db.collection("solicitudes_acceso").doc(docId).update({
            nombre: solDocR.nombre,
            email: solDocR.email,
            puesto: solDocR.puesto,
            telefono: solDocR.telefono,
            fecha: solDocR.fecha,
            rolSolicitado: solDocR.rolSolicitado ?? null,
            plazaSolicitada: solDocR.plazaSolicitada ?? null,
            password: "",
            estado: "RECHAZADA",
            motivo_rechazo: motivo,
            rechazadoPor: (currentUserProfile?.nombre) || USER_NAME || "Sistema"
          });
          await registrarEventoGestion('SOLICITUD_RECHAZADA', `Rechazó la solicitud de acceso de ${nombre}`, {
            entidad: 'SOLICITUDES_ACCESO',
            referencia: docId,
            objetivo: email,
            detalles: motivo,
            resultado: 'RECHAZADA'
          });
        }

        if (typeof enviarCorreoWebhook === "function") {
          enviarCorreoWebhook(email, nombre, esAprobado ? "APROBADO" : "RECHAZADO", motivo);
        }

        showToast(`Solicitud ${esAprobado ? 'APROBADA' : 'RECHAZADA'} con éxito`, "success");
        // Recargar el tab actual del panel de solicitudes v2
        if(typeof cargarSolicitudesDeTab === 'function' && document.getElementById('contenedor-solicitudes-v2')) {
          cargarSolicitudesDeTab(window._filtroSolicitudesEstatus || 'PENDIENTE');
        }

      } catch (error) {
        console.error("Error procesando solicitud:", error);
        showToast("Error en el servidor al procesar", "error");
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
window.toggleSidebar       = toggleSidebar;
window.toggleAdminSidebar  = toggleAdminSidebar;
window._togglePlazaPicker  = _togglePlazaPicker;

// ── Exponer funciones al scope global para onclick/onchange ────────────────
// (ES6 modules son strict y no exponen al window automáticamente)
Object.assign(window, {
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
  _togglePlazaAddRow,
  _umAvatarStyle,
  _umGetPlazasDisponibles,
  _umIniciar,
  _umNuevoUsuarioConAnim,
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
});
