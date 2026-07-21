# Diseño: Papeletas — rediseño mobile-app (captura rápida)

> **Fecha:** 2026-07-20  
> **Estado:** Approved — pending user review gate before implementation plan  
> **Enfoque aprobado:** Cirugía UI (UI surgery) — reusar dominio / data / storage / PDF / reportes / rutas  
> **Complementa:** [`2026-07-20-papeletas-digitales-design.md`](./2026-07-20-papeletas-digitales-design.md) (diseño beta ya shipped). Este documento **no lo reemplaza ni lo borra**; redefine la UX de captura y afloja reglas de fotos/entrega sobre el mismo expediente.

---

## 1. Context & goals

Papeletas digitales ya existen en la SPA (`/app/papeletas`): unicidad por unidad, checklist, diagrama, fotos, firma, PDF, regreso y bandeja Ventas. La UI actual sigue la estética “hoja de inspección” (papel industrial) y un wizard corto que exige **12 fotos** para entregar — demasiado lento en patio.

**Meta de producto:** inspección de salida usable en **1–2 minutos** (sin contar el tiempo de tomar fotos), en celular, con look de app limpia MapGestion — no de formulario papel.

**Metas concretas:**

1. Flujo de salida en **6 pasos** con barra inferior Atrás / Continuar.
2. Fotos **core (~6) obligatorias**; resto de zonas opcionales.
3. Daños tipados en diagrama (tap → tipo → severidad); freehand secundario.
4. Entregar con **6 fotos core + checklist completo** (fotos de daño opcionales para entregar).
5. Conservar Firestore español, Storage, perms, PDF formal, reportes Ventas y rutas actuales.
6. Autosave con debounce; auditoría en correcciones de maestro; fix merge de `salida` al entregar.

---

## 2. Non-goals

| No hacer | Por qué |
|----------|---------|
| Renombrar statuses Firestore a inglés (`draft`, `in_progress`, …) | Rompe docs existentes y reglas; UI ya puede mapear conceptos |
| Segundo flujo paralelo (“modo app” vs “modo hoja”) | Una sola experiencia; menos mantenimiento |
| Reescritura completa de `papeletas.js` / features / Cloud Functions | Cirugía UI: reusar capas estables |
| Migración one-shot de `diagramaStrokes` → marcas tipadas | Frágil; dual-read es suficiente |
| Añadir enum `dañado` al checklist | Daños viven en diagrama / reportes |
| WhatsApp / correo automático, CRM/contrato real, plantillas por tipo de carro | Follow-ups (§15) |
| Offline-first completo (cola offline robusta) | Solo draft local + mensaje si no hay red (§10) |

---

## 3. Routes (unchanged URLs)

| URL | Rol en el rediseño |
|-----|--------------------|
| `/app/papeletas` | Dashboard / listado |
| `/app/papeletas/nueva` | Paso 1 — seleccionar unidad |
| `/app/papeletas/p/:uid` | Pasos 2–6 (salida) o tabs Regreso/Salida/Reportar (post-entrega) |
| `/app/papeletas/ventas` | Bandeja Ventas |
| Legacy `/app/papeletas/:uid` | Sigue reescribiendo a `/app/papeletas/p/:uid` |

Feature gate `papeletas` y perms `view_papeletas` / `manage_papeletas_ventas` **sin cambio**.

---

## 4. Six-step salida UX

### 4.1 Chrome mobile fijo

- **Header:** atrás · nombre del paso · `N de 6` · chip `Guardando…` / `Guardado`.
- **Footer fijo:** **Atrás** | **Continuar** (altura táctil ≥ 48px, respeta `safe-area-inset-bottom`).
- Una acción primaria por pantalla.
- Bottom sheets / fullscreen para cámara y daños; en flujo normal usar `mexDialog` / sheets — no `alert()` / `confirm()` nativos.
- Sin texturas de papel, sin tipografía industrial condensada en captura.

### 4.2 Paso 1 — Seleccionar unidad (`/nueva`)

- Buscar por MVA / placas / modelo / VIN (`index_unidades` u origen ya usado).
- **Escanear QR:** si ya hay escáner en la app, engancharlo; si no, CTA placeholder “Próximamente” (no bloquea el flujo).
- Resultado = tarjeta: foto (si hay), MVA, modelo, placas, color, estado, ubicación.
- CTA primario: **Seleccionar esta unidad**.
- Si ya existe papeleta `activoPorUnidad == true` → abrir esa; **no** crear segunda.
- El documento borrador se crea **solo al confirmar** selección (no al teclear búsqueda).

### 4.3 Paso 2 — Confirmar datos

- Ficha **read-only** por defecto: unidad + contrato/cliente si existen + último KM/gas/inspección + resumen de daños preexistentes (si hay historial visible).
- CTA primario: **Datos correctos** → Continuar.
- Secundario: **Corregir** — campos limitados (p. ej. color, placas visibles, notas de identidad) + **motivo obligatorio** + **audit log** (quién, qué cambió, cuándo, motivo).
- Distinguir corrección “solo en esta papeleta” vs “sugerir cambio a ficha de unidad” — **nunca** overwrite silencioso del maestro de flota.

### 4.4 Paso 3 — KM y gas

- KM: input numérico grande; mostrar KM anterior + delta; alertas si KM menor que anterior o salto anómalo → justificación si aplica.
- Gas: **grid táctil 3×3** (E … F / niveles del sistema), no `<select>` diminuto.
- Opcional: foto de tablero (`fotoTableroPath`) — no cuenta como zona core.
- CTA: **Continuar** (persiste en `salida.km` / `salida.gas` o campos equivalentes ya usados).

### 4.5 Paso 4 — Checklist

- Interacción **por excepción**: botón superior **Confirmar todo presente** (marca `ok` en ítems vacíos).
- Filas → bottom sheet: `Presente (ok)` / `Faltante` / `N/A` (+ nota/foto opcional de evidencia).
- **Llantas:** 4 posiciones (`marcasLlantas`) + *Marcar todas* solo tras confirmar un valor.
- **Tapetes:** contadores − / + (`tapetes.usoRudo`, `tapetes.alfombra`).
- Valores checklist siguen siendo **`ok` | `faltante` | `na`** (sin `dañado`).
- CTA: **Continuar**.

### 4.6 Paso 5 — Marcar daños

- Silueta limpia (SVG/PNG transparente): vistas superior / laterales / frente / trasera.
- La hoja papel **no** es el fondo interactivo (solo referencia para PDF / extracción de silueta).
- Flujo principal: tap → tipo → severidad → foto opcional + nota → marca numerada `#N`.
- Freehand (`diagramaStrokes`) secundario (undo/clear).
- Lista inferior de daños; tap resalta marca; editar/borrar **pre-firma**.
- Dual-read de strokes legacy (§5).

### 4.7 Paso 6 — Fotos → resumen → firma

1. **Cámara guiada** para las **6 zonas core** (orden fijo §6); progreso `n/6`.
2. Zonas restantes de `ZONAS_V1`: accesibles como “Fotos opcionales”, no bloquean.
3. Fotos asociadas a `danosMarcados[].photoIds`: **opcionales para entregar** (pueden pedirse con énfasis visual, no gate).
4. **Resumen:** checklist faltantes, daños, fotos core, alertas.
5. **Firma:** canvas ancho, sin scroll que “pinte” un solo punto; label con `clienteNombre` o “Cliente”.
6. Al firmar con éxito: status `entregada`, salida inmutable, PDF generado una vez, pantalla de éxito + descarga/impresión.

**Entregar sin `clienteNombre`:** permitido con confirmación fuerte (igual que diseño shipped).

---

## 5. Diagram & damages data model + PDF rasterization

### 5.1 UX de captura

- Controles grandes; diagrama casi a ancho completo; zoom/vista ampliada sin perder marcas.
- Tipos de daño: `scratch` | `deep` | `dent` | `glass` | `missing` | `hit` | `other`  
  (UI ES: rayón, rayón profundo, abolladura, cristal, faltante, golpe, otro).
- Severidad: `small` | `medium` | `large`.

### 5.2 Shape `danosMarcados[]` (nuevo, canónico para marcas tipadas)

```json
{
  "id": "d1",
  "view": "left_side",
  "x": 0.42,
  "y": 0.61,
  "damageType": "scratch",
  "severity": "medium",
  "isPreexisting": false,
  "note": "",
  "photoIds": [],
  "number": 1
}
```

| Campo | Regla |
|-------|--------|
| `x`, `y` | Siempre normalizados **0–1** respecto al viewBox de esa `view` (nunca píxeles de pantalla) |
| `view` | Identificador de silueta: `top` \| `left_side` \| `right_side` \| `front` \| `rear` |
| `number` | Entero 1…N estable en la sesión de salida; se recalcula al borrar pre-firma |
| `isPreexisting` | En regreso, marcas de salida se muestran como preexistentes (`true`) |
| `photoIds` | Paths Storage opcionales; no bloquean `puedeEntregar` |

### 5.3 Dual-read con legacy

- Seguir leyendo y pintando `diagramaStrokes` (array de trazos/sellos actuales).
- Escritura nueva de daños tipados → `danosMarcados`.
- Freehand nuevo (si el usuario lo usa) puede seguir append a `diagramaStrokes`.
- **No borrar** strokes al abrir docs viejos.
- UI y PDF: capas = silueta + strokes legacy + marcas tipadas numeradas.

### 5.4 PDF

- Al entregar (o regenerar PDF): **rasterizar** silueta limpia + marcas tipadas + números + leyenda (+ strokes legacy si existen) → imagen embebida.
- Conservar siempre el JSON (`danosMarcados` / `diagramaStrokes`) en Firestore — la imagen es export, no fuente de verdad.
- PDF permanece **documento formal tipo hoja** (no el look app de captura): datos, checklist, fotos, firma, pie “Exportado por …” y nombre `USUARIO_FECHA_EMPRESA.pdf` (política de firma del repo).

---

## 6. Photo core zones (`ZONAS_CORE`)

`ZONAS_V1` (12) se mantiene intacta en el modelo. Se añade:

```js
export const ZONAS_CORE = Object.freeze([
  'frente_defensa',
  'trasera_cajuela',
  'lateral_der',
  'lateral_izq',
  'parabrisas',
  'cofre',
]);
```

### Mapping (obligatorias → ids existentes)

| # | id `ZONAS_V1` | Label | Rol en walkaround |
|--:|---------------|-------|-------------------|
| 1 | `frente_defensa` | Frente / defensa | Frente |
| 2 | `trasera_cajuela` | Trasera / cajuela | Trasera |
| 3 | `lateral_der` | Lateral derecho | Costado derecho |
| 4 | `lateral_izq` | Lateral izquierdo | Costado izquierdo |
| 5 | `parabrisas` | Parabrisas | Cristal / proxy cabina |
| 6 | `cofre` | Cofre | Capó / cuerpo superior |

### Opcionales (no bloquean entregar)

`cristal_der`, `cristal_izq`, `llanta_del_der`, `llanta_tras_der`, `llanta_del_izq`, `llanta_tras_izq`, más fotos de daño (`danosMarcados[].photoIds`) y `fotoTableroPath`.

### Helpers de dominio

- `coreZonasHaveFoto(zonas)` — las 6 de `ZONAS_CORE` tienen `fotoPath`.
- `allZonasHaveFoto` puede quedarse para “inspección completa” / progreso opcional; **deja de ser gate de entrega**.

---

## 7. Regreso / Ventas / Dashboard

### 7.1 Regreso (concepto de tabs **sin cambio**)

Pestañas: **Regreso** | **Salida** (solo lectura) | **Reportar**.

Al abrir una papeleta `entregada` / `en_retorno`:

- Entrar en pestaña **Regreso** (nunca wizard de salida vacío).
- Cargar snapshot de salida: KM/gas, checklist, diagrama (strokes + `danosMarcados`), fotos, firma.
- Pedir solo: KM entrada, gas entrada, checklist por excepción, cambios nuevos.
- Acciones rápidas: **Sin cambios** · **Daño nuevo** · **Faltante nuevo** · **Daño anterior reparado**.
- Al registrar entrada: `activoPorUnidad: false`, `status: en_retorno` (igual que shipped). `cerrada_historial` cuando el caso Ventas se cierra o no hay pendientes — no saltar directo a historial si hay reporte abierto.
- Daño ya documentado en salida → no crear caso Ventas nuevo (`descartado` / toast).
- Daño/faltante nuevo → reporte a Ventas con evidencias (placas + VIN + fotos) como hoy.

### 7.2 Ventas

- Misma lengua visual app (no papel).
- Lista: unidad, contrato/cliente, tipo, daño/faltante, evidencias, fecha, responsable, estado.
- Acciones por permiso: Ver / Promover / Cerrar (Reabrir solo si el dominio ya lo permite).
- **No** edita la inspección firmada.

### 7.3 Dashboard (listado)

- Desktop: tabla (como ahora).
- Mobile: filas compactas / cards (no tabla horizontal imposible).
- Filtros: En curso · Entregadas · En regreso · Finalizadas · Con reporte · Canceladas.
- CTA **Nueva** siempre visible.
- Chips de estado claros: borrador ≠ lista ≠ entregada ≠ cancelada.

---

## 8. Domain changes (minimal)

Archivo: `domain/papeleta.model.js` (+ tests `scripts/test-papeleta-model.js`).

### 8.1 Statuses Firestore (español — sin rename)

```
borrador | lista | entregada | en_retorno | cerrada_historial | cancelada
```

| Firestore | Concepto brief (UI) | Label UI (ES) |
|-----------|---------------------|---------------|
| `borrador` | draft / in_progress | Borrador · En curso* |
| `lista` | ready_for_signature | Lista para firmar |
| `entregada` | delivered | Entregada |
| `en_retorno` | return_in_progress | En regreso |
| `cerrada_historial` | completed | Finalizada |
| `cancelada` | cancelled | Cancelada |

\*UI puede distinguir “Borrador” (casi vacío) vs “En curso” (progreso parcial) **sin** crear un status Firestore extra — ambos persisten como `borrador`.

**`cancelada`:** libera unidad (`activoPorUnidad: false`); no editable; no cuenta como activa. Quién puede cancelar: mismos roles que editan salida + bypass admin/programador (detalle en plan; no ampliar permisos nuevos en este spec).

### 8.2 `ZONAS_CORE`

Ver §6. Exportar constante + `coreZonasHaveFoto`.

### 8.3 `computeStatusAfterSave` / `puedeEntregar`

```text
puedeEntregar(status, zonas, checklist) =
  status === 'lista'
  && coreZonasHaveFoto(zonas)
  && checklistCompleto(checklist)

computeStatusAfterSave({ status, zonas, checklist }) =
  if status ∈ {entregada, en_retorno, cerrada_historial, cancelada} → status
  else if coreZonasHaveFoto && checklistCompleto → lista
  else → borrador
```

Daños tipados / fotos de daño **no** entran en estos gates.

### 8.4 `danosMarcados`

Array en doc raíz (o bajo `salida` si el plan prefiere un solo merge — preferencia: **raíz** junto a `diagramaStrokes` para dual-read simétrico). Shape §5.2.

### 8.5 Checklist

Sin cambio de enum: `ok` | `faltante` | `na` | `''`.  
`CHECKLIST_KEYS` / llantas / tapetes se mantienen.

### 8.6 Fix `entregarPapeleta` salida merge

Hoy `entregarPapeleta` hace `salida: { … }` y **pisa** el mapa completo (pierde KM/gas/llantas/tapetes u otros campos ya guardados en `salida`).

**Regla:** merge superficial con el `salida` actual:

```js
salida: {
  ...(current.salida || {}),
  quienEntrega,
  km: km ?? current.salida?.km ?? null,
  gas: gas ?? current.salida?.gas ?? null,
  firmadoAt,
  firmaPath,
  entregadoPorUid,
}
```

---

## 9. Visual tokens (scoped)

Scope CSS: `.pap` (migrar tokens de “papel industrial” → “app limpia”). No contaminar shell global.

| Token | Valor | Uso |
|-------|-------|-----|
| Fondo app | `#F6F8FC` | Canvas de captura / listados |
| Superficie | `#FFFFFF` | Cards / sheets |
| Primario | `#3b82f6` (MapGestion `--accent`) | CTA Continuar, links, focus |
| Primario hover | `#2563eb` | Hover/pressed |
| OK | verde sistema existente (`--color-success` / equivalente) | Checklist presente, guardado |
| Alerta | rojo / naranja sistema | Faltantes, daños, KM anómalo |
| Texto | `var(--text)` | Cuerpo |
| Bordes | `var(--border)` | Separadores suaves |
| Radios | `12px` / `16px` | Cards, sheets, botones |
| Sombra | mínima (1 capa suave) | Cards elevadas |
| Tipografía | Inter 400/500/600/700 | Sin condensada industrial en captura |
| Iconos | Material Symbols | Sin emoji funcionales |

**PDF:** sigue look formal papel (crema/negro tipográfico aceptable en plantilla de impresión). Captura UI y PDF son lenguajes visuales distintos a propósito.

Dark theme: respetar `body.dark-theme` con variables existentes donde aplique; no inventar paleta púrpura.

---

## 10. Autosave / offline / unmount cleanup

| Tema | Comportamiento |
|------|----------------|
| Autosave | Debounce por paso (~400–800 ms) al cambiar checklist, KM/gas, marcas, notas |
| Chip | `Guardando…` → `Guardado` / `Error al guardar` con reintento |
| Draft local | `sessionStorage` / memoria del paso actual como red de seguridad; sync a Firestore cuando hay red |
| Offline | Sin cola offline completa: avisar “Se requiere conexión para guardar”; no marcar `lista`/`entregada` sin confirmación servidor |
| Cámara | Cerrar stream al salir del paso / unmount |
| Listeners | Unsubscribe `onSnapshot` y timers de debounce en `unmount()` |
| Diagrama | Flush strokes/`danosMarcados` pendientes antes de navegar Atrás/Continuar |

---

## 11. Compatibility & migration (dual-read)

| Dato | Lectura | Escritura nueva |
|------|---------|-----------------|
| `status` español | Igual | + `cancelada` |
| `diagramaStrokes` | Pintar siempre si existe | Freehand secundario |
| `danosMarcados` | Pintar si existe | Camino principal de daños |
| `zonas.*.fotoPath` | 12 ids | Core obligatorio; resto opcional |
| Checklist / llantas / tapetes | Normalizers actuales | Sin breaking |
| Docs pre-rediseño (12 fotos) | Siguen válidos; `lista`/`entregada` no se reescribe | Nuevos docs usan gate de 6 core |
| PDF viejo vs nuevo | Regenerar usa raster dual-read | — |

No hay job de migración masiva. Índices Firestore existentes bastan; `cancelada` entra en filtros client-side / queries por `status` ya usados.

---

## 12. Testing requirements

Mapear el brief del usuario a dominio/UI:

| # | Caso | Expectativa |
|---|------|-------------|
| 1 | Unicidad | No dos `activoPorUnidad` para la misma unidad; cancelar/entrada libera |
| 2 | Gate entrega | `puedeEntregar` true solo con 6 core + checklist + status `lista` |
| 3 | Daño sin foto | Puede entregar (foto de daño opcional) |
| 4 | Checklist | Solo `ok`/`faltante`/`na`; sin `dañado` |
| 5 | Dual-read diagrama | Doc con solo strokes legacy se ve en UI + PDF; doc nuevo con `danosMarcados` también |
| 6 | Coords | Marcas persisten 0–1 tras resize/rotación de layout |
| 7 | Merge entrega | Tras `entregarPapeleta`, KM/gas/llantas/tapetes previos en `salida` no se pierden |
| 8 | Inmutabilidad | Post-`entregada`: no editar zonas/checklist/daños de salida |
| 9 | Regreso tabs | Abre en Regreso; Salida readonly; Reportar no duplica daño de salida |
| 10 | Cancelada | `activoPorUnidad: false`; no aparece como activa; chip Cancelada |
| 11 | Audit corrección | Corregir datos en paso 2 deja rastro (campo/colección audit) |
| 12 | Unmount | Sin leaks de cámara/listeners tras navegar fuera |
| 13 | PDF firma | Incluye firma + “Exportado por …” + filename política repo |
| 14 | Tests dominio | Actualizar `scripts/test-papeleta-model.js`: `ZONAS_CORE`, `puedeEntregar` con 6, status `cancelada`, helpers marcas |

Smoke manual mínimo: crear → 6 fotos → checklist → daño tipado → firmar → PDF → regreso sin cambios → regreso con daño nuevo → Ventas.

---

## 13. Acceptance criteria

1. Captura de salida es un wizard de **6 pasos** con footer Atrás/Continuar en mobile.
2. Look de captura = app limpia (`#F6F8FC` / blanco / azul MapGestion); **sin** textura papel en UI de captura.
3. Se puede pasar a `lista` y **entregar** con exactamente las 6 fotos core + checklist completo, aunque falten las otras 6 zonas y aunque haya daños sin foto.
4. Statuses en Firestore siguen en español; UI muestra labels de concepto; existe `cancelada`.
5. Diagrama principal = marcas tipadas; freehand secundario; dual-read de `diagramaStrokes`.
6. PDF sigue siendo documento formal con silueta marcada rasterizada, fotos, firma y política de export.
7. Regreso conserva tabs Regreso / Salida / Reportar y libera unidad al registrar entrada.
8. Autosave con chip de estado; cleanup en unmount; merge de `salida` al entregar corregido.
9. Correcciones de datos de unidad en papeleta dejan audit trail.
10. Rutas, Storage paths, feature gate y perms existentes siguen funcionando sin migración breaking.

---

## 14. Implementation priority order

1. **Dominio:** `ZONAS_CORE`, `coreZonasHaveFoto`, `cancelada`, gates `puedeEntregar` / `computeStatusAfterSave`, shape/helpers `danosMarcados`; tests.
2. **Data fix:** merge correcto en `entregarPapeleta`; write paths para `danosMarcados` + `cancelada`; audit de correcciones.
3. **Wizard shell:** chrome 6 pasos + footer + router step state (sin rediseñar todo el CSS aún).
4. **Pasos 1–4:** unidad → confirmar datos → KM/gas → checklist (reordenar UI existente).
5. **Paso 5:** silueta limpia + bottom sheet tipado + dual-read + lista de daños.
6. **Paso 6:** cámara guiada solo core → resumen → firma → PDF raster dual-read.
7. **CSS tokens `.pap`:** migrar de papel industrial → app limpia (captura + listado + ventas).
8. **Regreso / Ventas / Dashboard:** polish visual + acciones rápidas de regreso; filtros cancelada.
9. **Autosave / unmount / offline messaging.**
10. **Smoke manual + ajuste tests.**

---

## 15. Out of scope / follow-ups

- WhatsApp / correo con el mismo PDF.
- Escáner QR real si aún no existe en la app (placeholder en v1 de este rediseño).
- Plantillas de silueta por tipo (SUV / van / moto).
- Comparador visual lado a lado salida vs entrada con slider.
- Offline-first con cola de fotos y sync conflict UI.
- Contrato/CRM real (más que `clienteNombre`).
- Partir `papeletas.js` en módulos por paso (recomendado durante §14.3–6, no bloqueante del diseño).
- Promoción TTL/reportes Cloud Function — ya especificada en diseño shipped; no reabrir aquí salvo bugs.

---

## Self-review checklist

- [x] Sin placeholders TBD.
- [x] No contradice dual-read ni statuses en español.
- [x] Gate de entrega = 6 core + checklist (no 12; fotos de daño opcionales).
- [x] Checklist sin enum `dañado`.
- [x] PDF formal vs UI app separados.
- [x] Rutas sin cambio.
- [x] Alcance acotado a un plan de implementación (cirugía UI + dominio mínimo).
- [x] Documento prior shipped referenciado, no borrado.

---

## Resumen ejecutivo

Rediseño de **captura** de Papeletas a app mobile limpia en 6 pasos, reusando el backend ya shipped. Firestore sigue en español (+ `cancelada`); el diagrama gana `danosMarcados` con dual-read de strokes; entregar exige 6 fotos core + checklist. El PDF permanece documento formal; la UI de patio deja de parecer papel.
`)