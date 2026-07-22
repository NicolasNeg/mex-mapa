# Plan de implementacion de seguridad

Fecha: 2026-07-21
Fuente: `MapGestion/PROTECCION SEGURIDAD.md`
Repositorio: `mex-mapa`
Estado: en implementacion

## Objetivo

Reducir primero los riesgos que permiten exponer secretos, conservar acceso despues de una baja o almacenar credenciales en Firestore. Despues, desplegar App Check, reglas de esquema, aislamiento y controles de abuso sin bloquear la aplicacion legitima.

## Decisiones de arquitectura

1. El producto actual es single-tenant. El plan previo del repositorio elimino `empresaId`, planes y consultas multiempresa de forma intencional.
2. Para la arquitectura actual, el aislamiento recomendado es un proyecto Firebase por cliente, con autorizacion interna por UID, rol y plaza.
3. No se agregara solamente `request.auth.token.idEmpresa` a las reglas actuales. Eso rompería consultas y dejaria sin migrar Storage, Functions, indices y datos existentes.
4. Si el producto vuelve a ser multi-tenant, sera una migracion completa: claim, paths, documentos, consultas, indices, Storage, backfill, pruebas y rollout. No es un parche de reglas.
5. `X-Frame-Options` se mantiene en `SAMEORIGIN`. La SPA usa iframes del mismo origen para Mapa, Cuadre y vistas legacy. `DENY` se habilitara solo cuando esas vistas sean nativas.
6. Las alertas de presupuesto no son un limite duro. Se usaran como deteccion; cualquier automatizacion para detener servicios requiere un runbook y aprobacion explicita.

## Hallazgos prioritarios

| Prioridad | Hallazgo | Estado inicial |
|---|---|---|
| P0 | Secreto OAuth versionado y anteriormente publicado por Hosting | Retirado de Hosting; rotacion pendiente |
| P0 | Hosting publica desde la raiz y el manifiesto incluyo herramientas, logs y un worktree | Ignores endurecidos y rutas verificadas en produccion |
| P0 | Passwords legacy en texto plano dentro de Firestore | Nuevas escrituras retiradas; purga de datos pendiente |
| P0 | Un perfil inactivo conserva acceso directo por Rules y Functions | Hardening inicial implementado; deploy pendiente |
| P0 | Perfiles globalmente legibles contienen telefono, licencia y biometria | Requiere separacion de documentos y migracion |
| P0 | Permisos configurables tienen confianza circular | Requiere escritura server-side y claims |
| P1 | App Check no esta cargado ni aplicado | Pendiente de staging real y site key Enterprise |
| P1 | No hay rate limits server-side por accion | Pendiente de mover operaciones abusables a callables |
| P1 | Varias colecciones carecen de esquema, transiciones y alcance por plaza | Pendiente de matriz de ataques y migracion de consultas |
| P1 | Service Workers aceptan destinos externos desde notificaciones | Corregido y cubierto por preflight |
| P2 | La CSP solo controlaba quien puede embeber la app | Baseline ampliada; CSP completa requiere inventario |

## Fase 0 - Contencion inmediata

Objetivo: cerrar exposiciones sin depender de una migracion de datos.

- [x] Eliminar `request.json` del arbol de trabajo.
- [x] Bloquear `request.json` en Git, Firebase CLI y Hosting.
- [x] Excluir de Hosting worktrees, metadatos de agentes, logs, Markdown, manifests de desarrollo y paquetes Node.
- [x] Ampliar CSP con `base-uri 'self'` y `object-src 'none'`, conservando `frame-ancestors 'self'`.
- [x] Restringir enlaces de notificaciones al mismo origen.
- [ ] Rotar o revocar el secreto OAuth expuesto en Google Cloud.
- [ ] Revisar todos los redirect URI y clientes OAuth asociados.
- [x] Retirar de Hosting los artefactos que estaban publicados.
- [x] Verificar en produccion que `/request.json`, `/serviceAccountKey.json`, `/.worktrees/`, `/.agents/`, `/package.json` y logs respondan 404.
- [ ] Evaluar limpieza de historial Git en una ventana coordinada. La rotacion es obligatoria aunque se limpie el historial.
- [x] Mover `serviceAccountKey.json` fuera de la raiz publica y exigir `GOOGLE_APPLICATION_CREDENTIALS`.
- [x] Eliminar logs de Firebase/Firestore del webroot y hacer que el preflight falle si reaparecen.

Salida: ningun secreto real o archivo interno entra al manifiesto de Hosting y el secreto expuesto ya no es valido.

## Fase 1 - Identidad y sesion

Objetivo: una baja o cambio de cuenta debe revocar acceso real, no solo ocultar la UI.

- [x] Hacer que Rules exijan un perfil habilitado en turnos, horarios, asistencia, notas y logs. Compatibilidad temporal: campos ausentes equivalen a activo; valores negativos o tipos invalidos niegan.
- [x] Aplicar la misma politica a los callables que usan `findUserProfileFromAuth()`.
- [ ] Inventariar perfiles duplicados, sin `authUid`, inactivos, con `password` o con biometria.
- [x] Eliminar nuevas escrituras de `password` en `usuarios` y `admins`, y retirar su viaje cliente-callable.
- [ ] Ejecutar una purga server-side de campos legacy y forzar restablecimiento de credenciales afectadas.
- [ ] Adoptar UID como identificador canonico y exigir `authUid == request.auth.uid` durante la migracion.
- [x] Guardar `authUid` en aprobaciones e invitaciones nuevas y validarlo cuando ya existe.
- [ ] Sustituir correos bootstrap por una custom claim de emergencia ligada a UID, MFA y auditoria.
- [ ] Mover cambios de rol, plaza, estado y overrides a callables con Admin SDK.
- [ ] Al suspender: deshabilitar Auth, revocar refresh tokens e incrementar `sessionVersion`.
- [ ] Al cerrar sesion: desregistrar FCM, borrar ubicacion y caches sensibles, y particionar cache restante por UID.

Salida: perfiles bloqueados fallan en cliente, Rules y Functions; recrear un correo no hereda autorizacion.

## Fase 2 - Privacidad y reglas

Objetivo: minimo privilegio, datos privados separados y escrituras con esquema.

- [ ] Separar `usuarios_publicos/{uid}` de `usuarios_privados/{uid}`.
- [ ] Mover telefono, licencia, dispositivos y descriptor facial a datos privados con retencion definida.
- [ ] Cerrar lectura cliente de `/admins` y retirar esa coleccion si queda redundante.
- [ ] Hacer `configuracion/empresa.security` inmutable desde cliente; administrarla con Function auditada.
- [ ] Definir `hasAll`, `hasOnly`, tipos, enums, longitudes y rangos por coleccion.
- [ ] Hacer bitacoras append-only y ligar actor a `request.auth.uid` y tiempo de servidor.
- [ ] Validar transiciones de turnos, asistencia, papeletas, traslados y kilometraje con `diff().affectedKeys()`.
- [ ] Aplicar alcance por plaza a paths, lecturas, escrituras y consultas.
- [ ] Replicar ownership, plaza, MIME y limites de tamano en Storage.
- [ ] Adaptar consultas: Firestore Rules no filtra resultados, por lo que cada query debe respetar el mismo alcance.

Salida: la matriz de ataques por rol, plaza, estado y ownership pasa en los emuladores de Firestore y Storage.

## Fase 3 - App Check

Objetivo: distinguir trafico de instancias registradas antes de imponer enforcement.

- [ ] Crear un proyecto staging real. Hoy los alias `staging` y `production` apuntan al mismo proyecto.
- [x] Registrar todas las apps web en App Check con reCAPTCHA Enterprise.
- [x] Cargar `firebase-app-check-compat` en cada entry point antes de usar Firestore, Storage o Functions.
- [x] Inicializar App Check desde una configuracion publica separada; debug tokens solo en localhost/CI y nunca en Git. Ver `docs/app-check.md`.
- [ ] Desplegar primero sin enforcement y observar metricas de trafico valido, invalido y ausente.
- [ ] Corregir clientes legacy, Service Workers y flujos de recuperacion detectados en metricas.
- [ ] Habilitar enforcement gradualmente: callables de bajo riesgo, Storage y finalmente Firestore.
- [ ] Usar replay protection solo en callables destructivos o de alto valor, midiendo su latencia.
- [ ] Mantener Auth, Rules y cuotas: App Check no los reemplaza.

Salida: trafico legitimo verificado de forma sostenida y rollback probado antes de enforcement en produccion.

## Fase 4 - Rate limiting y abuso

Objetivo: controlar acciones, no solo documentos individuales.

- [ ] Inventariar endpoints publicos y operaciones costosas: correo, invitaciones, Gemini, API REST, logs y escrituras masivas.
- [ ] Retirar el callable publico de correo si ya no tiene consumidores.
- [ ] Mover operaciones abusables a Functions con contadores transaccionales por UID y accion.
- [ ] Para endpoints publicos, agregar ventana por IP anonimizada, device/app token y destino.
- [ ] Usar documentos de lock con TTL y transacciones para evitar carreras.
- [ ] Limitar payload, frecuencia, concurrencia y tamano de respuesta.
- [ ] No aceptar API keys por query string; usar header y almacenar solo hashes.
- [ ] Agregar alertas por rechazos, picos, costos y latencia.

Salida: pruebas concurrentes demuestran que el limite se conserva aun con multiples solicitudes simultaneas.

## Fase 5 - Navegador y Hosting

Objetivo: llegar a una CSP estricta sin romper la aplicacion.

- [ ] Inventariar scripts, estilos, fuentes, conexiones, frames y workers por ruta.
- [ ] Eliminar handlers y estilos inline o migrarlos a archivos/nonce compatibles.
- [ ] Publicar CSP completa en `Report-Only` y revisar violaciones durante una ventana definida.
- [ ] Pasar a enforcement por directiva: `default-src`, `script-src`, `style-src`, `connect-src`, `img-src`, `font-src`, `frame-src`, `worker-src` y `form-action`.
- [ ] Mantener `SAMEORIGIN` mientras existan iframes internos; pasar a `DENY` al terminar la migracion nativa.
- [ ] Mantener HSTS actual; evaluar `preload` solo cuando todos los subdominios sean HTTPS permanente.
- [ ] Reemplazar `public: "."` por un directorio de distribucion dedicado cuando exista un paso de build/copias verificable.

Salida: CSP en enforcement sin violaciones legitimas y Hosting solo contiene artefactos runtime.

## Fase 6 - Claves y costos

Objetivo: reducir uso no autorizado y detectar gasto anormal.

- [ ] Restringir la API key web por APIs necesarias y HTTP referrers exactos.
- [ ] Incluir dominios finales y, mientras se usen, `mex-mapa-bjx.web.app/*` y `mex-mapa-bjx.firebaseapp.com/*`.
- [ ] Revisar por separado claves de Maps, Gemini, OAuth, SMTP y MEX API.
- [ ] Migrar `functions.config()` a Params/Secret Manager antes del retiro anunciado de Runtime Config en marzo de 2027.
- [ ] Crear alertas de presupuesto por proyecto con umbrales reales y pronosticados.
- [ ] Configurar cuotas de APIs cuando el producto lo permita.
- [ ] Definir degradacion controlada antes de automatizar apagados.
- [ ] No deshabilitar billing automaticamente sin backup, responsables, simulacro y procedimiento de recuperacion.

Salida: restricciones verificadas desde dominios permitidos/no permitidos y alertas probadas.

## Fase 7 - Pipeline y operacion

- [x] Ejecutar `security:preflight` antes de cada deploy de Hosting y Functions.
- [x] Crear una suite negativa de perfil activo para Rules; ejecucion pendiente de instalar Java.
- [x] Escanear secretos versionados y bloquear archivos internos en el manifiesto de Hosting.
- [ ] Probar login, logout, shell, iframes, camara, geolocalizacion, notificaciones y offline en staging.
- [ ] Registrar owner, fecha, evidencia, rollback y resultado por control.
- [ ] Bloquear el deploy si falla una prueba P0/P1.

## Orden de despliegue

1. Rotacion de secretos y redeploy de Hosting.
2. Contencion de passwords y perfiles inactivos.
3. Migraciones de UID y datos privados.
4. Rules y Storage por coleccion, con queries adaptadas.
5. App Check en observacion y luego enforcement gradual.
6. Rate limits server-side.
7. CSP completa y directorio de distribucion dedicado.

## Criterios de aceptacion globales

- Un usuario sin perfil, inactivo, bloqueado o con UID incorrecto no puede leer ni escribir datos operativos.
- Ningun documento cliente contiene password, PIN sensible, secreto OAuth o private key.
- Los datos biometricos no son legibles por perfiles sin necesidad operativa.
- Un rol no puede concederse permisos que el actor no posee.
- Toda operacion sensible tiene actor, tiempo de servidor, limite y auditoria inmutable.
- App Check puede activarse o revertirse por servicio sin interrumpir clientes legitimos.
- El manifiesto de Hosting no contiene archivos internos.
- Presupuesto y cuotas tienen alertas, responsables y un runbook probado.

## Acciones manuales bloqueantes

Estas acciones requieren acceso a consolas y no se resuelven solo con codigo:

1. Rotar el secreto OAuth expuesto.
2. Crear staging separado de produccion.
3. Crear/configurar la clave reCAPTCHA Enterprise para App Check.
4. Configurar restricciones de API key por dominio/API.
5. Configurar presupuesto, alertas, cuotas y destinatarios.

## Evidencia de esta primera iteracion

- `security:preflight`: 15 PASS, 0 FAIL; 419 archivos de texto trackeados revisados.
- Emulador de Hosting: `/request.json` y `/serviceAccountKey.json` responden 404 localmente.
- Produccion: `/request.json`, `/serviceAccountKey.json`, `/package.json`, `/firebase-debug.log`, `/.worktrees/` y `/.agents/` responden 404.
- Auditoria Firestore dry-run: 1 documento con `password`, en una solicitud `PENDIENTE`; no se purgo para no romper la Function actualmente desplegada.
- Dry-run Firebase: Firestore Rules y Storage Rules compilan sin errores; Cloud Functions se empaqueta correctamente.
- Suite de comportamiento de Rules: creada, pero no ejecutada porque Java no esta instalado en el equipo.
