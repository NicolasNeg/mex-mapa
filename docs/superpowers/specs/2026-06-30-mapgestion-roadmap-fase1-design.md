---
title: MapGestión — Roadmap priorizado + Fase 1 (bugs operativos)
date: 2026-06-30
status: approved-roadmap / fase1-detallada
source: bóveda Obsidian /home/negrura/Escritorio/MYPROYECT/MapGestion/
---

# MapGestión — Roadmap priorizado

Análisis de las ~20 notas de mejoras de la bóveda Obsidian, descompuesto en
fases ordenadas **por necesidad operativa** (lo más necesario primero). Cada
fase es un sub-proyecto con su propio ciclo spec → plan → implementación.

**Decisiones tomadas:** (1) se subirá a plan **Blaze** → habilita App Check,
OCR de PDF, demo, push, índices. (2) Se arranca por **Fase 1 completa**.

## Índice de fases

| Fase | Bloque | Estado |
|---|---|---|
| 0 | Habilitador: subir a Blaze | decisión tomada (acción del usuario en consola) |
| 1 | Bugs que rompen la operación | **← EN CURSO (este spec)** |
| 2 | Fricción operativa / UX | pendiente |
| 3 | Seguridad | pendiente |
| 4 | Rediseños UI/UX | pendiente |
| 5 | Features nuevas | pendiente |
| 6 | Grandes / futuro | pendiente |

### Fase 2 — Fricción operativa / UX
- Mapa: FOUC (HTML sin CSS ~1s), carga lenta al cambiar vista, cache,
  invitaciones (layout + toasts caen en el mapa).
- Notificaciones: marcar leído instantáneo + redirigir al clic (hoy tarda).
- Petición de ubicación: pedir solo al login (localStorage), modal si se
  deshabilita, diseño glass.
- Unidad seleccionada: modal muy grande en mobile → sidebar compacto.

### Fase 3 — Seguridad
- Restringir API key por dominio (HTTP referers) — consola.
- Security headers en `firebase.json` (X-Frame-Options, HSTS, CSP).
- App Check (reCAPTCHA Enterprise) + rate limiting en reglas + schema
  validation + budget alerts.

### Fase 4 — Rediseños UI/UX
- Cuadre profesional + firma digital 2 responsables + PDF nuevo (logo/datos
  fiscales de empresa) + historial de archivero tipo tabla.
- Chats corporativo. Unidad seleccionada / Sidebar Gestor. Reservas + PDF.
  Panel de notificaciones.

### Fase 5 — Features nuevas
- Importador de unidades (Excel/CSV → PDF/JSON). Exportar a Excel/CSV/ZIP.
  Sub-plazas temporales heredadas de plaza madre. Turnos por roles
  personalizables (comparar proyecto CHECADOR).

### Fase 6 — Grandes / futuro
- Modo oscuro/claro con animación. Demo público. Apps móviles (TWA/Capacitor).
  Landing "PRUÉBALO TÚ MISMO" (sandbox).

---

# Fase 1 — Bugs que rompen la operación (detalle)

Siete bugs, en orden de impacto. Cada uno: síntoma → causa (hipótesis a
confirmar en código) → fix → verificación. Se implementan y despliegan como un
solo bloque (1 deploy con bump de SW), commits atómicos por bug.

## 1.1 Doble inserción de unidad + validación de plaza  🔴 crítico de datos
**Síntoma:** se puede insertar 2× la misma unidad al cuadre; no valida que la
unidad ya esté en otra plaza.
**Causa:** `insertarUnidadDesdeHTML/Externa` (api/cuadre.js) no chequea
existencia previa en el cuadre ni el campo `plazaActual` del índice global.
**Fix (lazy):** antes de insertar, leer `index_unidades/{mva}`:
- si el `mva` ya existe en el cuadre de la plaza actual → bloquear con
  `mexAlert("La unidad ya está en este cuadre")`.
- si `plazaActual` tiene otra plaza (no vacía y ≠ plaza actual) → bloquear con
  `mexAlert("La unidad está registrada en la plaza X")`.
- La lectura del cuadre local ya está en memoria (lista renderizada) → chequeo
  O(n) en cliente para el duplicado; una lectura puntual del índice para
  `plazaActual`. Sin transacción (ponytail: colisión simultánea de 2 inserts
  del mismo mva es improbable a esta escala; subir a transacción si ocurre).
**Verificación:** intentar insertar el mismo mva dos veces → segundo intento
rechazado; insertar un mva con `plazaActual` de otra plaza → rechazado.

## 1.2 Turnos no cargan — "NO SE ENCONTRÓ TU USUARIO EN ESTA PLAZA"  🔴
**Síntoma:** turnos no cargan; mensaje de usuario no pertenece a la plaza aunque
sí pertenece. Consola: `The query requires an index` (asistencia: plaza+fecha).
**Causa (dos):**
1. Falta índice compuesto Firestore `asistencia` (`plaza` ASC, `fecha` ASC) —
   la query falla → el catch interpreta como "usuario no encontrado".
2. La verificación de pertenencia a plaza usa un campo/criterio equivocado
   (a confirmar en `horarios-data.js` / `turnos.js`).
**Fix:**
- Crear el índice: añadir a `firestore.indexes.json` y `firebase deploy --only
  firestore:indexes` (o usar el link de la consola). **Requiere el índice, no
  código.**
- Revisar el gate de pertenencia: comparar `plaza`/`plazaActual`/`sucursal` del
  perfil contra la plaza activa con normalización (upper/trim) como en las
  reglas. Separar el error de índice del error de pertenencia (no colapsar
  ambos en el mismo mensaje).
**Verificación:** turnos cargan para un usuario de la plaza; el índice aparece
como *Enabled* en consola.

## 1.3 Panel admin: todas las vistas redirigen a Usuarios  🔴
**Síntoma:** cualquier sub-vista del panel admin termina mostrando Usuarios.
**Causa (hipótesis):** router/switch del panel admin cae siempre al `default`
(Usuarios) porque el id de vista no matchea (o el enrutado por hash/pestaña se
resetea). A confirmar en la vista admin (`gestion` / `admin` legacy o su
`js/app/views/*`).
**Fix:** corregir el mapeo vista→render (que el id seleccionado se respete y no
caiga al default). Lazy: un solo punto de fallo esperado (el switch/lookup).
**Verificación:** navegar a cada sub-vista del panel admin → muestra la correcta.

## 1.4 Cuadre: restaurar "MÁS CONTROLES" y "CONTROLES ADMIN"  🔴
**Síntoma:** en cuadre ya no aparecen las herramientas "Más controles" y
"Controles admin".
**Causa (hipótesis):** quedaron ocultas por el blindaje CSS reciente
(`html.shell-embedded .fleet-header-top{display:none}` o un wrapper afectado) o
por un gate de permisos. A confirmar: `btnMasControlesWrapper` /
`btnAdminControlsWrapper` en `cuadre.html` + reglas CSS del `<style>`.
**Fix:** re-exponer los wrappers (mover fuera del contenedor oculto o excepción
CSS) manteniendo la limpieza del header duplicado. Verificar el gate de rol.
**Verificación:** en cuadre embebido en el shell aparecen ambos botones y abren
sus menús.

## 1.5 Buscador global "Ir al mapa" no resalta la unidad  🟠
**Síntoma:** al buscar una unidad y pulsar "Ver en mapa", el mapa cambia pero no
se envía el payload → el buscador del mapa no recibe el input ni resalta.
**Causa (hipótesis):** el focus pendiente (`window.__mexPendingMapFocus` →
`__mexFocusUnidad` en legacy-stage.js) se pierde por timing (iframe aún no listo)
o no se re-aplica tras el `setCurrentPlaza`/cambio de ruta. A confirmar el flujo
`__mexGoToMapUnit` (main.js) → `_applyPendingMapFocus` (legacy-stage.js) →
`__mexFocusUnidad` (mapa).
**Fix:** garantizar que el payload persista hasta que el iframe del mapa esté
`load`-eado y con la plaza correcta, y entonces aplicarlo (reintentar en el
`load` del iframe, no una sola vez). Rellenar el input del buscador del mapa y
resaltar el marcador.
**Verificación:** buscar unidad en otra plaza → "Ver en mapa" → cambia de plaza,
input del mapa con el texto, unidad resaltada.

## 1.6 Alertas: sin estilo y siempre visibles aunque leídas  🟠
**Síntoma:** las alertas salen sin el estilo definido y reaparecen aunque ya se
marcaron como leídas.
**Causa (dos):**
1. CSS de alertas no se está inyectando/cargando en el contexto donde salen
   (posible ruta de CSS legacy no cargada en el shell). A confirmar
   `css/alertas.css` + dónde se montan.
2. El flag de "leída" no se persiste o no se filtra al render (se marca en UI
   pero no en Firestore, o el listener no excluye leídas).
**Fix:** asegurar carga de `css/alertas.css` en el contexto; persistir
`leidaPor`/`leida` y filtrar en el render/listener.
**Verificación:** alerta con estilo correcto; marcar leída → no reaparece al
recargar.

## 1.7 Historial: filtro por fecha no funciona  🟠
**Síntoma:** filtrar por fecha no devuelve resultados; la fecha almacenada
incluye hora → comparación de formatos incompatible.
**Causa:** se compara un `Date`/timestamp con hora contra un `input[type=date]`
(medianoche) por igualdad o string, no por rango de día.
**Fix (lazy, native):** normalizar a **rango de día**: `inicio =
new Date(fecha+'T00:00:00')`, `fin = +1 día`, y filtrar
`ts >= inicio && ts < fin`. Usar `<input type="date">` (native). A confirmar en
la vista de historial (`ERROR EN HISTORIAL` → probablemente historial de
cuadres / bitácora).
**Verificación:** elegir un día con registros → aparecen todos los de ese día
sin importar la hora.

---

## Orden de ejecución y entrega
1. Investigar/confirmar causa de cada bug (lectura dirigida de los archivos
   citados) — sin re-derivar lo ya conocido.
2. Fix + self-check mínimo por bug (los de lógica no trivial: 1.1 dedup, 1.7
   rango de fecha).
3. Un solo deploy al final del bloque (bump SW), commits atómicos por bug,
   `git push`.
4. Índice de `asistencia` (1.2): desplegar `firestore:indexes` aparte.

## Riesgos / notas
- Varios "causa (hipótesis)" requieren confirmar en código antes de tocar —
  no asumir. Si la causa real difiere, se ajusta el fix (no el orden).
- 1.4 puede ser regresión de mi propio blindaje CSS de cuadre → revisar primero
  el `<style>` de `cuadre.html`.
- 1.2 depende de un índice Firestore (infra), no solo de código.
