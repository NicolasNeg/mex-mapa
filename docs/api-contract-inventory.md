# Contrato Público `window.api`

## Objetivo
- Congelar la superficie pública mientras la migración modular sigue avanzando.
- Permitir que `mex-api.js` siga funcionando como adaptador legacy y que `api/*` vaya tomando ownership sin romper rutas HTML, `onclick`s ni imports desde `js/core/database.js`.

## Reglas actuales
- `window.api` sigue siendo el contrato estable para todas las páginas operativas.
- `js/core/database.js` sigue siendo un bridge ES module y reexporta esa misma superficie.
- Los módulos `api/*` tienen prioridad sobre implementaciones homólogas dentro de `mex-api.js`.
- El ensamblado final ocurre en [`api/_assemble.js`](/home/negrura/Escritorio/MYPROYECT/mex-mapa/api/_assemble.js).

## Diagnóstico en runtime
- `window.__mexApiDiagnostics`: snapshot del ensamblado actual.
- `window.api.obtenerDiagnosticoCompatibilidad()`: devuelve funciones disponibles, módulos cargados y faltantes del contrato mínimo.
- Evento `mex:api-ready`: se emite al terminar `_assemble`.

## Superficie mínima congelada
- Auth y perfil: `obtenerCredencialesMapa`, `obtenerNombresUsuarios`, `verificarAdminGlobal`
- Mapa: `suscribirMapa`, `suscribirMapaPlaza`, `obtenerDatosParaMapa`, `obtenerEstructuraMapa`, `suscribirEstructuraMapa`, `guardarEstructuraMapa`
- Flota y movimientos: `aplicarEstado`, `insertarUnidadDesdeHTML`, `insertarUnidadExterna`, `guardarNuevasPosiciones`, `ejecutarEliminacion`
- Gestión Cuadre Admins: `obtenerCuadreAdminsData`, `procesarModificacionMaestra`
- Configuración: `obtenerConfiguracion`, `guardarConfiguracionListas`, `toggleBloqueoMapa`, `ensureGlobalSettingsDoc`
- Comunicaciones: `obtenerTodasLasAlertas`, `obtenerMensajesPrivados`, `enviarMensajePrivado`, `obtenerTodasLasNotas`
- Usuarios: `modificarUsuario`, `eliminarUsuario`, `guardarNuevoUsuarioAuth`

## Módulos actuales
- `api/helpers.js`: query builders, diagnóstico y compatibilidad
- `api/auth.js`
- `api/mapa.js`
- `api/cuadre.js`
- `api/externos.js`
- `api/flota.js`
- `api/alertas.js`
- `api/notas.js`
- `api/historial.js`
- `api/settings.js`
- `api/users.js`

## Notas de migración
- `mex-api.js` todavía contiene implementaciones legacy y utilidades internas en `window._mex`.
- Los módulos nuevos deben apoyarse en `window._mex` o helpers puros antes de duplicar lógica.
- No se deben cambiar firmas públicas hasta que todas las rutas consumidoras estén migradas.
