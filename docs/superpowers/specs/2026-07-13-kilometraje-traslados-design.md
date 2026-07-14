---
title: Kilometraje global por unidad + módulo de Traslados
date: 2026-07-13
status: Fase A IMPLEMENTADA (deploy hosting pendiente) · Fase B pendiente — ver "ESTADO DE IMPLEMENTACIÓN"
---

# Kilometraje global + Traslados

---

## ⚡ ESTADO DE IMPLEMENTACIÓN (2026-07-14) — leer antes de continuar

> Sección para el agente que retome este trabajo (Codex u otro). El diseño de
> abajo está APROBADO por el usuario — no re-diseñar; implementar lo que falta.

### ✅ HECHO — Fase A (Kilometraje) COMPLETA en `main`

Plan ejecutado: `docs/superpowers/plans/2026-07-13-kilometraje-fase-a.md` (9/9 tareas,
cada una con code review; bitácora detallada en `.superpowers/sdd/progress.md`).
Commits propios: `5891760..1fa38c9` (11, intercalados con commits de rediseño ajenos).

| Pieza | Dónde vive |
|---|---|
| Lógica pura `parseKm` / `clasificarCaptura` | `domain/kilometraje.model.js` (+ self-check: `node scripts/check-kilometraje.mjs`) |
| `api.registrarKm({mva, km, fuente, usuario, plaza, motivo?, nota?, trasladoId?})` → `'EXITO'\|'DISCREPANCIA'\|error-string` | `api/cuadre.js` (con copia privada `_clasificarKm` — los api/*.js son scripts clásicos, no importan ES modules) |
| Captura al insertar (campo `#f_km` obligatorio) | `cuadre.html` + `ejecutarGuardadoFlota` en `js/views/mapa.js` |
| Captura al retirar (diálogo `_pedirKmRetiro` km + motivo RENTA/OTRO; Cuadre Admins exento) | `js/views/mapa.js` (`confirmarBorradoFlotaUI`/`ejecutarBorradoReal`) + 4º param `retiro` de `ejecutarEliminacion` |
| Captura en auditoría (input `#audit-km-{mva}` prellenado; escribe solo si cambió, al marcar OK, solo auxiliar) | `js/views/mapa.js` (`_renderAuditCard`, `marcarUnidadAudit`) |
| Corrección con permiso `km_corregir` (modo edición) | `js/views/mapa.js` (`seleccionarFilaFlota`, `validarBotonGuardar`, `ejecutarGuardadoFlota`) |
| Permiso `km_corregir` (default GERENTE_PLAZA + JEFE_REGIONAL) | `domain/permissions.model.js` + `js/core/feature-gates.js` (`_PERM_DEFAULTS`) + `firestore.rules` (`rolTienePermiso`) |
| Reglas `km_registros` (append-only) y `km_discrepancias` + whitelist índice (`km`,`kmFecha`,`kmFuenteUltima`) | `firestore.rules` — **YA DESPLEGADAS en prod** |
| Columna KM (ordenable, sin filtro) + gas progressbar | `cuadre.html` (thead) + `renderFlota`/`filtrarFlota` en `js/views/mapa.js` + `css/mapa.css` (`.gas-cell*`, `.td-km`) |
| Constantes | `js/core/database.js`: `COL.KM_REGISTROS`, `COL.KM_DISCREPANCIAS` + bridge `registrarKm` |

Verificado: self-check OK; smoke Playwright 19/19 (`node scripts/test-mapa.js`);
columna KM y `#f_km` presentes en DOM real (el `/cuadre` redirige a `/app/cuadre` y
la página vive en un IFRAME — al automatizar, buscar en `p.frames()`); llamada real
`api.registrarKm` desde sesión autenticada contra Firestore de prod devolvió EXITO.

### ⏳ PENDIENTE INMEDIATO

1. **Deploy de hosting de la Fase A** — al cierre estaba BLOQUEADO: una sesión
   paralela dejó `api/cuadre.js` y `mex-api.js` a medio editar (sin parsear) en el
   working tree, y `firebase deploy` sube el DISCO, no el commit. Antes de desplegar:
   `node --check api/cuadre.js && node --check mex-api.js` → verdes → `npm run deploy`
   (bumpea el SW solo) → `git add . && git commit && git push`. HEAD `407f5a1` está sano.
2. **Fase B — Traslados: TODO el bloque de abajo.** No existe plan aún: escribirlo
   desde este spec (el flujo de la casa es superpowers:writing-plans → ejecutar
   tarea por tarea con review). La vista `/app/traslados` se implementa con el skill
   `ui-ux-pro-max` y `ESTILO.md` (glass/minimalista); los screenshots del usuario
   son inspiración funcional, no estética.

### 🧾 Debt aceptado de Fase A (no bloqueante; detalles en `.superpowers/sdd/progress.md`)

- 1er insert de una unidad NUNCA vista: el índice se crea con `.add()` sin await y
  `registrarKm` no le escribe km (se autocura en la 2ª captura). Fix opcional 1 línea.
- Fila optimista de la tabla sin km hasta recargar (`actualizarTablaLocal` no pasa km).
- `colspan="7"` desactualizado en el placeholder "Cargando inventario" (`js/views/mapa.js` ~6070).
- Eliminación por comando de voz/IA no captura km (llama `ejecutarEliminacion` con 3 args).
- Monotonía `km >= anterior` validada solo en cliente (subir a callables si hay manipulación).
- **Para Fase B**: apretar la regla `update` de `km_discrepancias` — exigir
  `resource.data.estado == "PENDIENTE"` + `hasOnly` de campos de resolución (hoy un
  `km_corregir` podría reescribir `kmCapturado` o re-resolver una resuelta).

### 📐 Reglas de la casa que aplican (resumen para agente externo)

- No hay build step. `api/*.js` = scripts clásicos IIFE sobre `window._mexParts`
  (PROHIBIDO `import`); `js/views/mapa.js` SÍ es ES module (~23k líneas — ancla por
  grep, nunca por número de línea). `api/_assemble.js` pisa los duplicados de
  `mex-api.js` — tocar solo `api/*.js`.
- `firestore.rules`: check barato PRIMERO en cadenas `&&`/`||` (límite 1000 expr).
- Nunca `git add .` si hay archivos ajenos modificados — commitear por archivo.
- Deploy: siempre vía `npm run deploy` (bump SW automático); después commit + push.

---

Dos subsistemas acoplados, implementados en dos fases:

- **Fase A — Kilometraje**: km actual por unidad + historial inmutable de capturas
  + detección de discrepancias + permiso de corrección + cambios en la tabla del
  cuadre (columna KM, gas como progressbar).
- **Fase B — Traslados**: sección nueva `/app/traslados` con ciclo de vida
  completo (crear/programar/editar/cerrar), choferes, razones configurables,
  historial de ediciones y cierre con cambio de plaza automático.

**Enfoque aprobado**: colecciones planas + estado derivado, **sin Cloud
Functions**. Validaciones baratas en reglas Firestore (km numérico y monotónico,
permisos). Si algún día se detecta manipulación desde consola, se sube a
callables — el modelo de datos no cambia.

---

## Fase A — Kilometraje global

### Modelo de datos

**`index_unidades/{doc}`** (existente) gana:
- `km` (number) — kilometraje actual global.
- `kmFecha` (timestamp) — cuándo se capturó.

**`km_registros`** (nueva, plana, append-only — nunca se edita ni borra):

```
{ mva, km, kmAnterior, delta,
  fuente: INSERT | CUADRE | RETIRO | TRASLADO_SALIDA | TRASLADO_LLEGADA | CORRECCION,
  usuario, plaza, fecha, trasladoId?, nota? }
```

**`km_discrepancias`** (nueva, plana):

```
{ mva, kmEsperado, kmCapturado, delta, fuente, usuario, plaza, fecha,
  estado: PENDIENTE | RESUELTA, resueltoPor?, fechaResolucion?, notaResolucion? }
```

### Puntos de captura

| Momento | Comportamiento |
|---|---|
| Insertar al cuadre | Campo km **obligatorio** en el modal de inserción (cuadre y mapa si aplica). |
| Retirar del cuadre | Km **obligatorio** + motivo de salida (RENTA / otro) en el flujo de eliminación. |
| Cuadre de flota (auditoría) | Km **prellenado** con el último conocido por unidad; el auxiliar confirma con un tap o teclea el real si difiere. Cero tecleo si no cambió. |
| Traslado | Salida y llegada — ver Fase B. |
| Corrección | Solo con permiso `km_corregir`; único caso donde el km puede bajar. Genera registro `CORRECCION` con antes→después. |

### Detección de discrepancias

Al capturar se compara contra el último km conocido:

- **delta ≤ umbral** (configurable en `configuracion/listas`, default **5 km**):
  actualiza en silencio — movimientos de patio normales.
- **delta > umbral** y el último evento de la unidad **NO** fue salida legítima
  (retiro por RENTA o traslado): se guarda el km real **y** se crea discrepancia
  PENDIENTE ("mal uso de unidad o km alterado sin traslado/contrato").
- **km menor al anterior** sin permiso `km_corregir`: la captura se **rechaza**
  (regla Firestore valida `km >= anterior`).
- Las discrepancias PENDIENTES se muestran como **nota ligera** (banner inline,
  no mexDialog ni alerta global) cada vez que se abre la sección de Traslados,
  hasta que alguien con `km_corregir` las marque RESUELTA con nota de resolución.
  **Nota de fases**: la colección y la detección nacen en Fase A; su UI (banner +
  pestaña Discrepancias) llega con la sección de Traslados en Fase B.

### Permiso nuevo

`km_corregir` — corregir km ya guardado y resolver discrepancias. Asignable a
cualquier rol vía `rolePermissions` en `configuracion/empresa` (mexPerms), para
darlo a GERENTE_PLAZA, JEFE_PATIO o SUPERVISOR a conveniencia.

### Reglas Firestore

- `km_registros`: create con usuario autenticado + km numérico ≥ 0; update/delete
  denegados (append-only). Monotonía: `km >= kmAnterior` salvo fuente CORRECCION
  con permiso.
- `km_discrepancias`: create autenticado; update solo cambio de estado
  PENDIENTE→RESUELTA con permiso.
- **OJO**: check barato primero en los OR (bug conocido de reglas, ver
  `reference_firestore_or_bug`).

### UI del cuadre (cuadre.html, tabla FLOTA REGULAR)

- Columna **KM** inmediatamente después de GAS: solo lectura, ordenable con el
  `sortFlota` existente, **sin dropdown de filtro**.
- Columna **GAS**: el chip de letra (F/H/E) se reemplaza por una **mini
  progressbar** con el porcentaje/color que ya calcula la lógica `_fuelToPct`
  del panel "unidad seleccionada" (misma conversión, mismos colores).

---

## Fase B — Traslados

### Modelo: colección `traslados` (plana)

```
{ folio,                                  ← secuencial corto (contador transaccional en configuracion/counters)
  mva, modelo, placas,                    ← denormalizados; 1 traslado = 1 unidad (OBLIGATORIA)
  tipo,                                   ← razón, de lista configurable (código + etiqueta)
  choferUid, choferNombre,
  plazaOrigen, plazaDestino,              ← iguales = salida temporal; distintas = cambio de plaza
  kmSalida, gasSalida,                    ← gasSalida se copia AUTOMÁTICO del valor actual (sin input)
  kmLlegada?, gasLlegada?,                ← al cerrar
  fechaSalida,                            ← default ahora + 2 min; programable a futuro
  fechaRegresoEstimada?,
  estado: ABIERTO | CERRADO,              ← PROGRAMADO se deriva: fechaSalida > ahora
  fechaCierre?, cerradoPor?,
  creadoPor, fechaCreacion,
  notas:     [ { texto, usuario, fecha } ],
  ediciones: [ { campo, antes, despues, usuario, fecha } ] }
```

Decisión: **una unidad por traslado**. Un convoy de N unidades = N traslados
(mantiene el km y la trazabilidad por unidad). La referencia visual del usuario
permite multi-unidad; aquí se descarta a propósito.

### Choferes

En `usuarios/{id}`: `isChofer: boolean` + `licenciaVencimiento` (fecha),
administrados desde el panel de usuarios existente. El selector de chofer solo
lista usuarios con `isChofer` y licencia **vigente** (vencida = no elegible).

### Razones (tipos) configurables

Lista en `configuracion/listas` con `codigo` + `etiqueta`. Seed inicial
(editable): `CORT - Cortesía`, `GAS - Carga de gasolina`, `TRANS - Transporte
de personal`, `DROP - Retorno por drop off`, `INTER - Intercambio`,
`NOCOM - No comercial`.

### Ciclo de vida

1. **Crear** (permiso `traslados_gestionar`, default VENTAS+): unidad (debe
   estar en el cuadre de la plaza origen y sin traslado abierto), chofer, tipo,
   destino, fechas. Km salida prellenado con el actual (editable; si difiere >
   umbral dispara discrepancia). Gas salida se copia solo. Genera
   `km_registros` fuente TRASLADO_SALIDA.
2. **Programado / Abierto** — derivado, sin cron: `fechaSalida > ahora` ⇒ se
   muestra PROGRAMADO. Desde la creación la unidad luce el badge 🚛 con destino
   en el mapa (campo `traslado_destino` existente en el doc del cuadre).
3. **Editar** mientras no esté cerrado (mismo permiso): chofer, tipo, fechas,
   notas. Cada cambio se apila en `ediciones` (quién, qué, antes→después). El
   detalle es el mismo formulario rellenado, editable inline si hay permiso.
4. **Cerrar** (mismo permiso): km llegada obligatorio (≥ salida), gas llegada,
   hora de cierre = ahora por default; editable pero nunca futura ni anterior a
   (ahora − 5 min). Que pase `fechaRegresoEstimada` **no cierra nada**: sigue ABIERTO
   hasta que un operativo lo cierre. Genera `km_registros` TRASLADO_LLEGADA.
   - Destino = misma plaza: la unidad vuelve, km/gas actualizados, badge fuera.
   - Destino = otra plaza: el cierre retira la unidad del cuadre origen e
     **inserta automáticamente** en el cuadre destino (pos LIMBO) con el km de
     llegada. El guard de `plazaActual` no estorba: el cierre hace ambas cosas.

### Permiso nuevo

`traslados_gestionar` — crear, editar y cerrar traslados. Default VENTAS y
superiores; asignable vía rolePermissions.

### UI: vista SPA nativa `/app/traslados`

Patrón "Adding a new SPA view" del CLAUDE.md (router + route-resolver +
navigation.config + `css/app-traslados.css`). Estética glass/minimalista según
`ESTILO.md`; **usar el skill `ui-ux-pro-max` al implementar la vista**. Las
capturas de referencia del usuario (sistema externo estilo Bootstrap) son
inspiración funcional, NO se copia su estética.

- **Pestañas**: Activos (programados + abiertos) · Historial (cerrados) ·
  Discrepancias.
- **Filtros**: folio, unidad/número económico (**filtrable**), chofer
  (dropdown buscable), usuario creador, razón/tipo, plaza salida, plaza
  regreso, estatus, rango de fechas salida/regreso.
- **Tabla**: folio, unidad, chofer, fechas salida/regreso, plazas, razón,
  estatus (chip ABIERTO/PROGRAMADO/CERRADO), acciones ver/editar.
- **Nuevo**: formulario con los campos del modelo (unidad con buscador por
  MVA/placas/modelo). **Detalle** = mismo formulario rellenado; editable inline
  con permiso; botón **Cerrar traslado** si está abierto; timeline de
  `ediciones` y `notas`.
- **Banner de discrepancias** PENDIENTES al abrir la sección (nota ligera,
  persistente hasta resolver).

### Reglas Firestore (traslados)

- create/update solo autenticado con `traslados_gestionar` (vía rol o permiso).
- CERRADO es terminal: update de un doc con `estado == 'CERRADO'` denegado.
- delete denegado (trazabilidad); un traslado erróneo se cierra con nota.

---

## Casos borde y errores

- Unidad sin km previo (histórico viejo): primera captura fija la base, sin
  discrepancia.
- Unidad con traslado abierto: no se puede crear otro traslado ni retirarla del
  cuadre por eliminación normal.
- Chofer cuya licencia vence con traslado abierto: el traslado sigue válido; el
  chofer deja de ser elegible para traslados nuevos.
- `km_registros` y `traslados` son planos → los exports a Excel/CSV (feature
  futura del roadmap) se resuelven con queries simples.

## Verificación

- Self-checks de lógica pura (domain): clasificación de discrepancia
  (umbral/salida legítima), validación de cierre (km ≥ salida, tolerancia
  −5 min), elegibilidad de chofer (licencia vigente). `domain/traslado.model.js`
  + `domain/kilometraje.model.js` con asserts ejecutables.
- Manual: insertar con km, retiro con motivo, cuadre de flota con prellenado,
  crear/editar/cerrar traslado (misma plaza y cambio de plaza), discrepancia
  >5 km y resolución, columna KM + gas progressbar en cuadre.
- Smoke test Playwright existente debe seguir verde.

## Orden de implementación

1. **Fase A** completa (km + discrepancias + UI cuadre + reglas) → deploy.
2. **Fase B** (traslados + choferes + vista SPA + reglas) → deploy.
   Cada fase: commits atómicos, bump SW automático, `git push` tras deploy.
