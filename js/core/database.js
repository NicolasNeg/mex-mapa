// ═══════════════════════════════════════════════════════════
//  js/core/database.js  —  ES6 Module
//
//  CAPA DE DATOS  —  Todas las funciones de acceso a Firebase.
//
//  REQUISITO: La página que importe este módulo debe cargar
//  los siguientes scripts ANTES que cualquier <script type="module">:
//
//    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
//    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
//    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
//    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-storage-compat.js"></script>
//    <script src="/config.js"></script>
//    <script src="/js/core/firebase-init.js"></script>
//    <script src="/mex-api.js"></script>   ← hasta que la migración esté completa
//
//  PATRÓN "BRIDGE":
//  Durante la migración, este módulo re-exporta las funciones de
//  window.api (que mex-api.js registra). Así el código nuevo puede
//  usar `import { suscribirMapa } from '/js/core/database.js'`
//  mientras el código legacy sigue usando `api.suscribirMapa()`.
//  Cuando la migración esté completa, este archivo contendrá
//  la implementación directa (sin window.api) y mex-api.js
//  podrá eliminarse.
//
//  USO:
//    import { suscribirMapa, aplicarEstado } from '/js/core/database.js';
//    import db from '/js/core/database.js';  // default: todo el api
// ═══════════════════════════════════════════════════════════

// ── Acceso a instancias inicializadas por firebase-init.js ──
export const db      = window._db;
export const auth    = window._auth;
export const storage = window._storage;
export const functions = window._functions;

// ── Constantes de colecciones ─────────────────────────────
export const COL = Object.freeze({
  CUADRE:             'cuadre',
  EXTERNOS:           'externos',
  USERS:              'usuarios',
  ADMINS:             'admins',
  ALERTAS:            'alertas',
  MENSAJES:           'mensajes',
  LOGS:               'logs',
  ADMIN_AUDIT:        'bitacora_gestion',
  NOTAS:              'notas_admin',
  SETTINGS:           'settings',
  INDEX:              'index_unidades',
  MAPA_CFG:           'mapa_config',
  CUADRE_ADM:         'cuadre_admins',
  AUDITORIA:          'auditoria',
  HISTORIAL_CUADRES:  'historial_cuadres',
  SIPP:               'sipp',
  CONFIG:             'configuracion',
  PLANTILLAS_ALERTAS: 'plantillas_alertas',
});

// ── Meta de roles ─────────────────────────────────────────
export const ACCESS_ROLE_META = Object.freeze({
  AUXILIAR:        { isAdmin: false, isGlobal: false },
  VENTAS:          { isAdmin: true,  isGlobal: false },
  GERENTE_PLAZA:   { isAdmin: true,  isGlobal: false },
  JEFE_REGIONAL:   { isAdmin: true,  isGlobal: false },
  CORPORATIVO_USER:{ isAdmin: true,  isGlobal: true  },
  PROGRAMADOR:     { isAdmin: true,  isGlobal: true  },
  JEFE_OPERACION:  { isAdmin: true,  isGlobal: true  },
});

// ═══════════════════════════════════════════════════════════
//  BRIDGE — re-exports de window.api
//  Cada función delega al objeto global para no duplicar código.
// ═══════════════════════════════════════════════════════════
function _api() {
  if (!window.api) throw new Error('[database.js] window.api no está disponible. ¿Olvidaste cargar mex-api.js?');
  return window.api;
}

// ── Autenticación ─────────────────────────────────────────
export const obtenerCredencialesMapa  = (...a) => _api().obtenerCredencialesMapa(...a);
export const obtenerNombresUsuarios   = (...a) => _api().obtenerNombresUsuarios(...a);
export const verificarAdminGlobal     = (...a) => _api().verificarAdminGlobal(...a);

// ── Mapa (tiempo real y estructura) ──────────────────────
export const suscribirMapa            = (...a) => _api().suscribirMapa(...a);
export const obtenerDatosParaMapa     = (...a) => _api().obtenerDatosParaMapa(...a);
export const obtenerEstructuraMapa    = (...a) => _api().obtenerEstructuraMapa(...a);
export const suscribirEstructuraMapa  = (...a) => _api().suscribirEstructuraMapa(...a);
export const guardarEstructuraMapa    = (...a) => _api().guardarEstructuraMapa(...a);

// ── Operaciones de flota ──────────────────────────────────
export const aplicarEstado            = (...a) => _api().aplicarEstado(...a);
export const insertarUnidadDesdeHTML  = (...a) => _api().insertarUnidadDesdeHTML(...a);
export const ejecutarEliminacion      = (...a) => _api().ejecutarEliminacion(...a);
export const guardarNuevasPosiciones  = (...a) => _api().guardarNuevasPosiciones(...a);

// ── Tabla de flota ────────────────────────────────────────
export const obtenerUnidadesVeloz        = (...a) => _api().obtenerUnidadesVeloz(...a);
export const obtenerDatosFlotaConsola    = (...a) => _api().obtenerDatosFlotaConsola(...a);
export const obtenerCuadreAdminsData     = (...a) => _api().obtenerCuadreAdminsData(...a);
export const procesarModificacionMaestra = (...a) => _api().procesarModificacionMaestra(...a);

// ── Dashboard ─────────────────────────────────────────────
export const obtenerConteoGeneral        = (...a) => _api().obtenerConteoGeneral(...a);
export const obtenerMovimientosRecientes = (...a) => _api().obtenerMovimientosRecientes(...a);

// ── Notificaciones y feed ─────────────────────────────────
export const checarNotificaciones        = (...a) => _api().checarNotificaciones(...a);
export const limpiarFeedGlobal           = (...a) => _api().limpiarFeedGlobal(...a);
export const actualizarFeedSettings      = (...a) => _api().actualizarFeedSettings(...a);

// ── Alertas ───────────────────────────────────────────────
export const emitirNuevaAlertaMaestra     = (...a) => _api().emitirNuevaAlertaMaestra(...a);
export const marcarAlertaComoLeida        = (...a) => _api().marcarAlertaComoLeida(...a);
export const actualizarAlertaMaestra      = (...a) => _api().actualizarAlertaMaestra(...a);
export const obtenerTodasLasAlertas       = (...a) => _api().obtenerTodasLasAlertas(...a);
export const eliminarAlertaMaestraBackend = (...a) => _api().eliminarAlertaMaestraBackend(...a);
export const obtenerPlantillasAlerta      = (...a) => _api().obtenerPlantillasAlerta(...a);
export const guardarPlantillaAlerta       = (...a) => _api().guardarPlantillaAlerta(...a);

// ── Mensajería interna ────────────────────────────────────
export const obtenerMensajesPrivados   = (...a) => _api().obtenerMensajesPrivados(...a);
export const enviarMensajePrivado      = (...a) => _api().enviarMensajePrivado(...a);
export const actualizarReaccionesChatDb= (...a) => _api().actualizarReaccionesChatDb(...a);
export const marcarMensajesLeidosArray = (...a) => _api().marcarMensajesLeidosArray(...a);
export const editarMensajeChatDb       = (...a) => _api().editarMensajeChatDb(...a);
export const eliminarMensajeChatDb     = (...a) => _api().eliminarMensajeChatDb(...a);

// ── Incidencias / Notas Admin ─────────────────────────────
export const obtenerTodasLasNotas   = (...a) => _api().obtenerTodasLasNotas(...a);
export const suscribirNotasAdmin    = (...a) => _api().suscribirNotasAdmin(...a);
export const guardarNuevaNotaDirecto= (...a) => _api().guardarNuevaNotaDirecto(...a);
export const resolverNotaDirecto    = (...a) => _api().resolverNotaDirecto(...a);
export const eliminarNotaDirecto    = (...a) => _api().eliminarNotaDirecto(...a);

// ── Reportes y logs ───────────────────────────────────────
export const obtenerResumenFlotaPatio = (...a) => _api().obtenerResumenFlotaPatio(...a);
export const obtenerHistorialLogs     = (...a) => _api().obtenerHistorialLogs(...a);
export const obtenerLogsServer        = (...a) => _api().obtenerLogsServer(...a);
export const obtenerEventosGestion    = (...a) => _api().obtenerEventosGestion(...a);
export const registrarEventoGestion   = (...a) => _api().registrarEventoGestion(...a);

// ── Usuarios ──────────────────────────────────────────────
export const modificarUsuario    = (...a) => _api().modificarUsuario(...a);
export const eliminarUsuario     = (...a) => _api().eliminarUsuario(...a);
export const guardarNuevoUsuarioAuth = (...a) => _api().guardarNuevoUsuarioAuth(...a);

// ── Control del sistema ───────────────────────────────────
export const toggleBloqueoMapa   = (...a) => _api().toggleBloqueoMapa(...a);

// ── Protocolo de auditoría ────────────────────────────────
export const iniciarProtocoloDesdeAdmin  = (...a) => _api().iniciarProtocoloDesdeAdmin(...a);
export const obtenerMisionAuditoria      = (...a) => _api().obtenerMisionAuditoria(...a);
export const guardarAuditoriaCruzada     = (...a) => _api().guardarAuditoriaCruzada(...a);
export const finalizarProtocoloV3        = (...a) => _api().finalizarProtocoloV3(...a);
export const procesarAuditoriaDesdeAdmin = (...a) => _api().procesarAuditoriaDesdeAdmin(...a);

// ── Cuadre y cierre ───────────────────────────────────────
export const registrarCierreCuadre    = (...a) => _api().registrarCierreCuadre(...a);
export const marcarUltimaModificacion = (...a) => _api().marcarUltimaModificacion(...a);
export const obtenerHistorialCuadres  = (...a) => _api().obtenerHistorialCuadres(...a);

// ── Configuración global ──────────────────────────────────
export const obtenerConfiguracion       = (...a) => _api().obtenerConfiguracion(...a);
export const guardarConfiguracionListas = (...a) => _api().guardarConfiguracionListas(...a);

// ── Plazas (SIPP) ─────────────────────────────────────────
export const obtenerUnidadesPlazas   = (...a) => _api().obtenerUnidadesPlazas(...a);
export const registrarUnidadEnPlaza  = (...a) => _api().registrarUnidadEnPlaza(...a);
export const obtenerDetalleCompleto  = (...a) => _api().obtenerDetalleCompleto(...a);
export const actualizarUnidadPlaza   = (...a) => _api().actualizarUnidadPlaza(...a);
export const eliminarUnidadPlaza     = (...a) => _api().eliminarUnidadPlaza(...a);
export const obtenerDisponiblesSIPP  = (...a) => _api().obtenerDisponiblesSIPP(...a);

// ── Email y reportes generados ────────────────────────────
export const enviarReporteCuadreEmail = (...a) => _api().enviarReporteCuadreEmail(...a);
export const enviarAuditoriaAVentas   = (...a) => _api().enviarAuditoriaAVentas(...a);
export const generarPDFActividadDiaria= (...a) => _api().generarPDFActividadDiaria(...a);
export const generarExcelPrediccion   = (...a) => _api().generarExcelPrediccion(...a);

// ── IA / Utilidades ───────────────────────────────────────
export const llamarGeminiAI           = (...a) => _api().llamarGeminiAI(...a);
export const checkEsAdmin             = (...a) => _api().checkEsAdmin(...a);
export const obtenerUrlImagenModelo   = (...a) => _api().obtenerUrlImagenModelo(...a);
export const analizarPlacaVisionAPI   = (...a) => _api().analizarPlacaVisionAPI(...a);

// ── Acceso requests ───────────────────────────────────────
export const procesarSolicitudAcceso  = (...a) => _api().procesarSolicitudAcceso?.(...a);

// ── Export default (para usarlo como objeto completo) ─────
export default window.api;
