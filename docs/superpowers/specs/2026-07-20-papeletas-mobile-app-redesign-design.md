# Diseño: Papeletas — rediseño mobile-app (captura rápida)

> **Fecha:** 2026-07-20  
> **Estado:** Approved — pending user final approval gate before implementation plan  
> **Enfoque aprobado:** **Cirugía UI con extensiones aditivas y compatibles del modelo**  
> **Complementa:** [`2026-07-20-papeletas-digitales-design.md`](./2026-07-20-papeletas-digitales-design.md) (diseño beta ya shipped). Este documento **no lo reemplaza ni lo borra**; redefine la UX de captura y cierra reglas de dominio/datos sobre el mismo expediente.

---

## Framing (obligatorio)

| Capa | Responsabilidad |
|------|-----------------|
| **UI / vista** | Captura rápida, confirmaciones, sheets, pre-checks de UX, render |
| **Domain (`domain/papeleta.model.js`)** | `puedeEntregar`, `isChecklistComplete`, gates, comparación de daños, immutability checks, helpers de zonas |
| **Data (`js/app/features/papeletas/*-data.js`)** | Transacciones, locks, merge autorizado, `finalizeDelivery`, autosave con `revision`, Storage paths |
| **Rules (Firestore)** | Preferir rechazo de mutaciones ilegales post-`entregada` cuando sea viable |

**La UI sola NO inventa reglas de negocio.** Cualquier gate de entrega, unicidad, inmutabilidad, comparación de daños o finalize vive en domain/data (y rules cuando aplique). La vista solo invoca y muestra resultados.

Extensiones del modelo en este rediseño son **aditivas y compatibles**: no se renombran statuses Firestore, no se borran los 12 ids de `ZONAS_V1`, no se migra one-shot `diagramaStrokes` → tipados.

---

## 1. Context & goals

Papeletas digitales ya existen en la SPA (`/app/papeletas`): unicidad por unidad, checklist, diagrama, fotos, firma, PDF, regreso y bandeja Ventas. La UI actual sigue la estética “hoja de inspección” y un wizard que exige **12 fotos** para entregar — demasiado lento en patio.

**Meta de producto:** inspección de salida usable en **1–2 minutos** de captura operativa (select→cámara, excluyendo tiempo de tomar fotos), en celular, con look de app limpia MapGestion.

**Metas concretas:**

1. Flujo de salida en **6 pasos** con barra inferior Atrás / Continuar.
2. Fotos **core (6) obligatorias** vía `ZONAS_CORE` (§6); resto opcionales.
3. Daños tipados en diagrama (tap → tipo → severidad); freehand secundario.
4. Entregar solo cuando `puedeEntregar` (domain) es true; finalize atómico e idempotente.
5. Conservar Firestore español, Storage, perms, PDF formal, reportes Ventas y rutas actuales.
6. Autosave con debounce + `revision`; auditoría en correcciones; merge seguro de `salida` al entregar.

---

## 2. Non-goals

| No hacer | Por qué |
|----------|---------|
| Renombrar statuses Firestore a inglés | Rompe docs y reglas; UI mapea labels |
| Segundo flujo paralelo (“modo app” vs “modo hoja”) | Una sola experiencia |
| Reescritura completa de `papeletas.js` / CF | Cirugía UI + extensiones aditivas |
| Migración one-shot `diagramaStrokes` → tipados | Dual-read basta |
| Enum `dañado` en checklist | Daños viven en diagrama / reportes |
| WhatsApp / correo, CRM real, plantillas por carro | Follow-ups (§16) |
| Offline-first completo (cola robusta) | MVP: draft local + mensaje; sin finalize offline (§11) |
| Soft-expire silencioso de borradores | Abandono explícito + alertas (§12) |

---

## 3. Routes (unchanged URLs)

| URL | Rol |
|-----|-----|
| `/app/papeletas` | Dashboard / listado |
| `/app/papeletas/nueva` | Paso 1 — seleccionar unidad |
| `/app/papeletas/p/:uid` | Pasos 2–6 (salida) o tabs Regreso/Salida/Reportar |
| `/app/papeletas/ventas` | Bandeja Ventas |
| Legacy `/app/papeletas/:uid` | Reescribe a `/app/papeletas/p/:uid` |

Feature gate `papeletas` y perms `view_papeletas` / `manage_papeletas_ventas` **sin cambio**.

---

## 4. Six-step salida UX

### 4.1 Chrome mobile fijo

- **Header:** atrás · nombre del paso · `N de 6` · chip `Guardando…` / `Guardado` / conflicto.
- **Footer fijo:** **Atrás** | **Continuar** (≥ 48px, `safe-area-inset-bottom`).
- Una acción primaria por pantalla.
- Bottom sheets / fullscreen para cámara y daños; `mexDialog` / sheets — no `alert()` / `confirm()` nativos.
- Sin texturas de papel ni tipografía industrial en captura.

### 4.2 Paso 1 — Seleccionar unidad (`/nueva`)

- Buscar por MVA / placas / modelo / VIN.
- **Escanear QR:** enganchar si existe; si no, CTA “Próximamente”.
- Tarjeta resultado + CTA **Seleccionar esta unidad**.
- Pre-check UX: si ya hay activa → abrir esa; **no** crear segunda.
- Create definitivo = transacción + lock (§7). Documento se crea **solo al confirmar** selección.

### 4.3 Paso 2 — Confirmar datos

- Ficha read-only: unidad + contrato/cliente si existen + último KM/gas + daños preexistentes visibles.
- Primario: **Datos correctos**.
- Secundario: **Corregir** — campos limitados + motivo obligatorio + audit.
- Distinguir corrección “solo en esta papeleta” vs “sugerir cambio a ficha” — **nunca** overwrite silencioso del maestro.
- **Atrás desde paso 2** → sheet de abandono (§12).

### 4.4 Paso 3 — KM y gas

- KM numérico grande; KM anterior + delta; anomalía → justificación si aplica (hard block si requerida y vacía — §9).
- Gas: grid táctil 3×3.
- **Foto de tablero = zona core** `tablero_kilometraje` (no opcional).
- **Regla KM ↔ tablero:** si el usuario edita KM **después** de haber capturado la foto de tablero → **aviso soft** + recomendar retomar foto. No hard-block por defecto (solo warn + confirm al continuar).
- Persistencia: `salida.km` / `salida.gas` + `zonas.tablero_kilometraje.fotoPath`.

### 4.5 Paso 4 — Checklist

- Por excepción: **Confirmar todo presente** (marca `ok` en vacíos).
- Filas → sheet: `Presente (ok)` / `Faltante` / `N/A` (+ nota/foto evidencia opcional).
- **Llantas:** 4 posiciones + *Marcar todas* solo tras confirmar un valor.
- **Tapetes:** contadores − / + (`usoRudo`, `alfombra`); ambos deben estar definidos (número ≥ 0) para checklist completo.
- Valores: **`ok` | `faltante` | `na`** (sin `dañado`).
- **Faltante permite entregar** (soft warning en resumen — §9).

### 4.6 Paso 5 — Marcar daños

- Silueta limpia; vistas superior / laterales / frente / trasera.
- Flujo: tap → tipo → severidad → foto (política soft §14) + nota → marca con `displayNumber`.
- Freehand (`diagramaStrokes`) secundario.
- Lista inferior; editar/borrar **pre-firma / pre-`entregada`**.
- Dual-read + write rule (§5.3).
- Numeración §5.2; coords §5.4.

### 4.7 Paso 6 — Fotos → resumen → firma → finalize

1. Cámara guiada para las **6 `ZONAS_CORE`** (orden §6); progreso `n/6`.
2. Resto de `ZONAS_V1` + opcionales: “Fotos opcionales”, no bloquean.
3. Fotos de daño: política soft §14 (no hard gate salvo config futura).
4. **Resumen:** hard blocks vs soft warnings (§9); confirmación por warning.
5. **Firma** con metadata §13.
6. Éxito solo vía **`finalizeDelivery()`** (§8) — nunca status/`pdf` repartidos entre vista/firma/pdf modules.

---

## 5. Diagram & damages

### 5.1 UX

- Controles grandes; zoom por vista sin perder marcas.
- Tipos: `scratch` | `deep` | `dent` | `glass` | `missing` | `hit` | `other`.
- Severidad: `small` | `medium` | `large`.

### 5.2 Shape `danosMarcados[]` + numeración

```json
{
  "id": "d_uuid_stable",
  "displayNumber": 3,
  "view": "left_side",
  "x": 0.42,
  "y": 0.61,
  "damageType": "scratch",
  "severity": "medium",
  "note": "",
  "photoIds": [],
  "source": "salida"
}
```

| Campo | Regla (cerrada) |
|-------|-----------------|
| `id` | Permanente (uuid/id estable). Nunca reasignar. |
| `displayNumber` | Entero asignado al **crear** la marca en la sesión de salida. **Nunca se reutiliza** en esa sesión. **NO renumerar** al borrar. |
| `photoIds` | Ligados por **`damageId` / `id`**, nunca por número visual. |
| PDF | Puede calcular índice visual 1…N al export **sin mutar** ids ni `displayNumber` almacenados. |
| `isPreexisting` en `salida.danosMarcados[]` | **No mutar** en regreso (§10). |

Campo legacy `number` (si existiera en drafts previos del spec): migrar lectura a `displayNumber`; escritura nueva solo `displayNumber`.

### 5.3 Dual-read / dual-write (regla explícita)

| Operación | Comportamiento |
|-----------|----------------|
| **Read** | Silueta + `diagramaStrokes` legacy + `danosMarcados` tipados |
| **Write daños formales nuevos** | **Solo** `danosMarcados` |
| **Write freehand opcional** | Solo `diagramaStrokes` |
| Docs viejos | No borrar strokes al abrir |

UI y PDF: capas = silueta + strokes legacy + marcas tipadas.

### 5.4 Coordenadas por vista

- `x`, `y` normalizados **0–1** respecto a los **bounds de esa `view`**, no del SVG compuesto completo.
- Clamp a `[0, 1]` al capturar y al persistir.
- Matriz de prueba obligatoria: mobile portrait, mobile landscape, desktop, PDF export, zoom in/out, DPR alto/bajo — la marca debe caer en el mismo punto relativo de la silueta.

### 5.5 PDF

- Al finalizar entrega (o regenerar): rasterizar silueta + tipados + números visuales de export + leyenda (+ strokes legacy) → imagen embebida.
- JSON en Firestore es fuente de verdad; imagen es export.
- PDF = documento formal; pie “Exportado por …” + filename `USUARIO_FECHA_EMPRESA.pdf`.

---

## 6. Photo core zones (`ZONAS_CORE`)

### 6.1 `ZONAS_V1` actual (inspección en repo)

Ids existentes (12, **no eliminar**):

`trasera_cajuela`, `lateral_der`, `cristal_der`, `llanta_del_der`, `llanta_tras_der`, `lateral_izq`, `cristal_izq`, `llanta_del_izq`, `llanta_tras_izq`, `frente_defensa`, `parabrisas`, `cofre`.

Hoy **no** existen `tablero_kilometraje` ni `interior` en `ZONAS_V1`. Se **añaden** como ids aditivos (orden 13–14 o helper paralelo) sin quitar los 12.

### 6.2 Constante canónica (orden fijo de walkaround)

```js
export const ZONAS_CORE = Object.freeze([
  'frente_defensa',        // mapea label producto "frente"
  'trasera_cajuela',       // "trasera"
  'lateral_izq',           // "lateral_izquierdo"
  'lateral_der',           // "lateral_derecho"
  'tablero_kilometraje',   // NEW — CORE (antes opcional / fotoTableroPath)
  'interior',              // NEW — CORE
]);
```

### 6.3 Mapping producto → id real

| # | Label producto | id canónico | Origen |
|--:|----------------|-------------|--------|
| 1 | frente | `frente_defensa` | `ZONAS_V1` existente |
| 2 | trasera | `trasera_cajuela` | `ZONAS_V1` existente |
| 3 | lateral_izquierdo | `lateral_izq` | `ZONAS_V1` existente |
| 4 | lateral_derecho | `lateral_der` | `ZONAS_V1` existente |
| 5 | tablero_kilometraje | `tablero_kilometraje` | **NEW** aditivo; respalda claim de KM |
| 6 | interior | `interior` | **NEW** aditivo |

Aliases de lectura opcionales (`frente`, `trasera`, …) pueden mapear a estos ids; **escritura y gates usan solo ids canónicos**.

### 6.4 Qué deja de ser core

`parabrisas`, `cofre` y el resto de `ZONAS_V1` **no** están en `ZONAS_CORE` → opcionales (no bloquean entregar).  
`fotoTableroPath` legacy, si existe en docs viejos, se lee como fallback de `zonas.tablero_kilometraje.fotoPath` (dual-read de path); escritura nueva va al id de zona.

### 6.5 Helpers

- `coreZonasHaveFoto(zonas)` — las 6 de `ZONAS_CORE` tienen `fotoPath` no vacío.
- `allZonasHaveFoto` — progreso “inspección completa” opcional; **no** es gate de entrega.

### 6.6 KM edit after tablero (soft)

```text
if zonas.tablero_kilometraje.fotoPath exists
   AND user changes salida.km after that photo's capturedAt
→ UI soft warning: "El KM cambió; se recomienda retomar foto de tablero"
→ Continuar permitido con confirm (no hard block)
```

---

## 7. Uniqueness — transactional

**UI pre-check** (`getPapeletaActivaByUnidad`): solo UX (abrir existente / mensaje).

**Create definitivo (cerrado):** atómico con:

1. **Lock doc determinístico** `papeletas_activas/{unidadId}` (colección índice; un doc por unidad).
2. **Firestore transaction** que:
   - Lee el lock.
   - Si lock existe y apunta a papeleta activa → abort (`ACTIVE_EXISTS`) + return existing id.
   - Si no: crea doc papeleta (`activoPorUnidad: true`, `status: borrador`, `revision: 1`) **y** escribe lock `{ papeletaId, unidadId, createdAt, createdBy }`.
3. Si la creación del papeleta falla tras claim parcial → liberar lock en el mismo path de error (transaction rollback preferido; si split, compensating delete del lock).

**Liberar lock + `activoPorUnidad: false` en:**

| Evento | Acción |
|--------|--------|
| Cancelar papeleta | Confirm + audit + release |
| Complete return (`registrarEntrada` → `en_retorno`) | Release |
| Failed create | Release / no dejar lock huérfano |
| Abandoned draft cancelado (§12) | Release |

No hay expire silencioso del lock. Alertas operativas si el borrador bloquea la unidad demasiado tiempo (§12).

Índice compuesto existente `unidadId + activoPorUnidad` se mantiene como query de apoyo; la **autoridad** de unicidad es el lock + transaction.

---

## 8. `finalizeDelivery()` — atomic + idempotent

**Una sola función** en data layer (orquestada con validaciones de domain). **NO** repartir entre vista / firma / pdf modules.

Nombre canónico: `finalizeDelivery(papeletaId, payload)`. Reemplaza el flujo fragmentado actual de `entregarPapeleta` + PDF ad-hoc en la vista.

### Pasos (orden fijo, misma transacción lógica / run atómico)

1. **Re-read** doc actual (fresh).
2. **Validate** `puedeEntregar(doc)` (domain). Si false → throw con reasons.
3. **Idempotencia:** si `status === 'entregada'` (o `entregaFinalizedAt` ya set) → return `{ ok: true, alreadyFinalized: true, papeleta }` — **no** re-subir firma, **no** segundo PDF, **no** audit duplicado de entrega.
4. **Merge solo campos autorizados** en `salida` (nunca blind replace del mapa `salida`):

```js
salida: {
  ...(current.salida || {}),
  quienEntrega,
  km: km ?? current.salida?.km ?? null,
  gas: gas ?? current.salida?.gas ?? null,
  firma: { /* §13 */ },
  // campos de entrega autorizados únicamente
}
```

5. Persistir firma + metadata (§13).
6. `status → entregada`; set `entregadaAt`, `entregadaPor` (uid/nombre).
7. **Lock salida** — flags/domain: mutaciones a KM/gas/checklist/daños/fotos/firma de salida rechazadas (§8.1).
8. Request/create PDF **una vez** (`pdfUrl` / job marker). Si PDF ya existe y `alreadyFinalized`, no regenerar automáticamente.

### 8.1 Inmutabilidad más allá de la UI

Tras `entregada`:

| Capa | Regla |
|------|-------|
| Domain | Helpers `assertSalidaMutable(status)` / `puedeEditar` = false para campos de salida |
| Data | `actualizarPapeleta` / patches rechazan mutaciones a `salida.km|gas|checklist|danosMarcados|zonas|firma` (y equivalentes raíz) cuando status ∈ `{entregada, en_retorno, cerrada_historial}` |
| Firestore rules | Preferir deny de esos fields post-entrega cuando viable |

**Correcciones posteriores:** adenda / corrección auditada / flujo de regreso — **nunca** overwrite silencioso de la salida firmada.

---

## 9. `isChecklistComplete` / `puedeEntregar` — exacto

### 9.1 Hard blocks (no entregar)

| Condición | Block |
|-----------|-------|
| KM inválido (vacío, no numérico, o reglas de validación fallidas) | Sí |
| Gas unset | Sí |
| Ítems checklist requeridos sin responder (`''`) | Sí |
| Llantas sin responder (alguna de 4 vacía) | Sí |
| Tapetes: `usoRudo` o `alfombra` `null`/`undefined` | Sí |
| Falta alguna foto core (`ZONAS_CORE`) | Sí |
| Firma inválida (vacía, single-point, sin metadata mínima) | Sí |
| Writes pendientes/fallidos (autosave error sin recover) | Sí |
| Anomalía de KM requiere justificación y está vacía | Sí |
| Status no elegible (`puedeEditar` false o no `lista`/`borrador→lista` path) | Sí — `finalizeDelivery` exige pasar `puedeEntregar` |

`faltante` en checklist **no** es hard block.

### 9.2 Soft warnings (confirm para continuar)

| Condición | Warning |
|-----------|---------|
| Sin `clienteNombre` (ni nombre en firma de tercero) | Confirmación fuerte |
| Hay ítems `faltante` | Confirm |
| Daños sin foto (según §14) | Confirm + motivo si política lo pide |
| Fotos opcionales pendientes | Informativo / confirm ligero |
| Master data corregido solo en papeleta | Confirm / banner |
| Daños `large` (u otros umbrales) sin reporte Ventas | Confirm |

### 9.3 Pseudocódigo (domain)

```js
function isChecklistComplete(papeleta) {
  const cl = papeleta.checklist || {};
  const keysOk = CHECKLIST_KEYS.every((k) =>
    ['ok', 'faltante', 'na'].includes(String(cl[k] || ''))
  );
  const llantas = normalizeMarcasLlantas(papeleta);
  const llantasOk = LLANTA_KEYS.every((k) => String(llantas[k] || '').trim().length > 0);
  const tapetes = normalizeTapetes(papeleta);
  const tapetesOk = tapetes.usoRudo != null && tapetes.alfombra != null;
  return keysOk && llantasOk && tapetesOk;
}

function puedeEntregar(papeleta, { firma, pendingWrites, kmJustification } = {}) {
  // Terminal / no-salida statuses never deliver
  if (['entregada', 'en_retorno', 'cerrada_historial', 'cancelada'].includes(papeleta.status)) {
    return { ok: false, hard: ['status'] };
  }

  const hard = [];
  if (!isValidKm(papeleta.salida?.km)) hard.push('km');
  if (!isGasSet(papeleta.salida?.gas)) hard.push('gas');
  if (!isChecklistComplete(papeleta)) hard.push('checklist');
  if (!coreZonasHaveFoto(papeleta.zonas)) hard.push('core_photos');
  if (!isValidFirma(firma || papeleta.salida?.firma)) hard.push('firma');
  if (pendingWrites) hard.push('pending_writes');
  if (requiresKmJustification(papeleta) && !String(kmJustification || papeleta.salida?.kmJustificacion || '').trim()) {
    hard.push('km_justification');
  }
  if (hard.length) return { ok: false, hard, soft: [] };

  // Gates cumplidos ⇒ elegible (status puede ser borrador o lista; finalize setea entregada)
  const soft = [];
  if (!String(papeleta.clienteNombre || '').trim() && !firma?.signerName) soft.push('cliente');
  if (hasFaltantes(papeleta.checklist)) soft.push('faltantes');
  if (damagesMissingPhoto(papeleta.danosMarcados)) soft.push('damage_photos');
  if (optionalPhotosPending(papeleta.zonas)) soft.push('optional_photos');
  if (papeleta.correccionesSoloPapeleta) soft.push('master_corrected_local');
  if (largeDamagesWithoutVentasReport(papeleta)) soft.push('large_damage_report');

  return { ok: true, hard: [], soft };
}

// computeStatusAfterSave (actualizado):
// if status ∈ {entregada, en_retorno, cerrada_historial, cancelada} → keep
// else if coreZonasHaveFoto && isChecklistComplete && km/gas válidos → 'lista'
// else → 'borrador'
// Nota: puedeEntregar valida gates directamente; status 'lista' es proyección de esos gates.
```

UI: muestra `hard` como bloqueo; `soft` como sheet de confirmación antes de llamar `finalizeDelivery`. Tras confirm de soft, `finalizeDelivery` re-valida hard en servidor/cliente data (soft ya aceptado en payload `confirmedWarnings[]`).

---

## 10. Regreso — comparación de daños (sin mutar salida)

**NO** mutar `salida.danosMarcados[].isPreexisting` (ni fields de salida).

Comparación en **render** y/o persistida bajo `entrada`:

```js
{
  source: 'salida' | 'entrada',
  comparisonStatus: 'preexisting' | 'new' | 'repaired' | 'unchanged',
  sourceDamageId: 'd_uuid_from_salida' // cuando referencia daño de salida
}
```

Tabs sin cambio: **Regreso** | **Salida** (readonly) | **Reportar**.

- Al abrir `entregada` / `en_retorno` → pestaña Regreso.
- Snapshot de salida solo lectura.
- Acciones: **Sin cambios** · **Daño nuevo** · **Faltante nuevo** · **Daño anterior reparado**.
- Entrada: `activoPorUnidad: false`, `status: en_retorno`; release lock (§7).
- Daño ya en salida → no nuevo caso Ventas.
- Daño/faltante nuevo → reporte Ventas con evidencias.

---

## 11. Autosave / offline / conflicts

### MVP base

- Debounce ~400–800 ms.
- Draft local (`sessionStorage` / memoria) como red de seguridad.
- Mensaje si no hay red; **retry**.
- **No finalize offline.**

### Conflictos (obligatorio en este rediseño)

Cada doc lleva `updatedAt` + `revision` (enteros monotónicos).

- Autosave envía `knownRevision`.
- Data layer: update condicionada / transaction: si `remote.revision !== knownRevision` → **no** silent overwrite.
- Resolución: reload / safe merge / conflict UI.
- **Nunca** silent overwrite concurrente de: daños, fotos, firma, status, delivery, reportes.
- Preferir **field-specific updates** (paths concretos) sobre reemplazar arrays enteros (`danosMarcados`, `diagramaStrokes`, `zonas`) bajo riesgo de concurrencia.

Unmount: cerrar cámara, unsubscribe listeners, flush debounce, cancel timers.

---

## 12. Draft abandon (paso 2 atrás)

Bottom sheet con exactamente:

1. **Continuar después** — sale; deja borrador + lock (unidad sigue bloqueada).
2. **Cancelar papeleta** — requiere confirm + audit + release unidad/lock.
3. **Seguir editando** — cierra sheet.

**Borradores abandonados:**

- Mostrar edad del borrador.
- Recover (reabrir).
- Cancel por rol autorizado (+ bypass admin/programador).
- Alertar si bloquea la unidad demasiado tiempo (threshold operativo configurable; default sugerido 24h — alerta, no delete).
- **No expire silencioso.**

---

## 13. Firma metadata

```js
firma: {
  imagePath: '',
  signerName: '',
  signerRole: '',       // Cliente | Conductor | Representante | Otro
  signedAt: null,
  capturedBy: '',       // uid operador
  consentTextVersion: '' // versión del texto de consentimiento mostrado
}
```

- Si no hay cliente en ficha: capturar **nombre + relación** (`signerRole`).
- Confirmación fuerte si nombre vacío (alineado a soft warning §9.2).
- Canvas: scroll lock durante trazo; rechazar single-point / trazo vacío; normalizar imagen para PDF.
- Paths Storage existentes; no inventar bucket nuevo.

---

## 14. Damage photo policy (soft)

```js
export const DAMAGE_PHOTO_POLICY = Object.freeze({
  scratch: 'recommended',
  deep: 'strongly_recommended',
  dent: 'strongly_recommended',
  glass: 'strongly_recommended',
  missing: 'strongly_recommended',
  hit: 'strongly_recommended',
  other: 'recommended',
});
```

- Continuar sin foto: **confirm + motivo** cuando policy ≠ omitida; motivo auditado.
- **No** hard-block de entrega en MVP.
- Config-ready: misma tabla podrá pasar a hard en el futuro sin cambiar shape de daños.

---

## 15. Metrics (operativas)

Usar audit/telemetry existente (`bitacora_gestion` / `ops_events` / observability actual) — **sin** plataforma nueva.

| Métrica | Definición |
|---------|------------|
| Tiempo captura operativa | Desde confirmar unidad (fin paso 1) hasta abrir cámara del primer core — **excluye** tiempo de disparar/revisar fotos. Target mediana **≤ 2 min**. |
| Tiempo total con fotos | select unidad → `finalizeDelivery` success (incluye fotos). |
| Eventos (nombres) | `papeleta_unit_selected`, `papeleta_step_completed`, `papeleta_core_photo_captured`, `papeleta_damage_added`, `papeleta_finalize_success`, `papeleta_finalize_already`, `papeleta_cancel`, `papeleta_conflict_revision`, `papeleta_km_tablero_retake_warned` |

---

## 16. Regreso / Ventas / Dashboard (UX)

### Ventas

- Misma lengua visual app.
- No edita inspección firmada.
- Acciones por permiso: Ver / Promover / Cerrar.

### Dashboard

- Desktop tabla; mobile filas/cards.
- Filtros: En curso · Entregadas · En regreso · Finalizadas · Con reporte · Canceladas.
- CTA **Nueva**; chips de estado claros.

---

## 17. Domain changes (aditivos)

Archivo: `domain/papeleta.model.js` (+ `scripts/test-papeleta-model.js`).

| Cambio | Tipo |
|--------|------|
| `ZONAS_CORE` + `coreZonasHaveFoto` | Nuevo |
| Ids `tablero_kilometraje`, `interior` en template zonas | Aditivo a `ZONAS_V1` o lista extendida |
| `isChecklistComplete` (llantas+tapetes+keys) | Nuevo / endurecer `checklistCompleto` |
| `puedeEntregar` → `{ ok, hard, soft }` | Extender |
| `computeStatusAfterSave` usa core+checklist+km/gas | Actualizar |
| Helpers `danosMarcados` / `displayNumber` | Nuevo |
| `assertSalidaMutable` / immutability | Nuevo |
| `DAMAGE_PHOTO_POLICY` | Nuevo |
| Status `cancelada` | Aditivo (UI + release lock) |
| Statuses ES sin rename | Intactos |

Statuses Firestore:

```
borrador | lista | entregada | en_retorno | cerrada_historial | cancelada
```

---

## 18. Visual tokens (scoped `.pap`)

| Token | Valor |
|-------|-------|
| Fondo | `#F6F8FC` |
| Superficie | `#FFFFFF` |
| Primario | `#3b82f6` / hover `#2563eb` |
| OK / Alerta | tokens sistema |
| Radios | `12px` / `16px` |
| Tipografía | Inter 400/500/600/700 |
| Iconos | Material Symbols |

PDF sigue look formal papel. Dark theme vía variables existentes.

---

## 19. Compatibility & migration

| Dato | Lectura | Escritura nueva |
|------|---------|-----------------|
| Status ES | Igual | + `cancelada` |
| Strokes | Pintar si existe | Solo freehand |
| `danosMarcados` | Pintar si existe | Daños formales |
| Zonas 12 + 2 nuevas | Dual-read paths | Core = 6 de §6 |
| `fotoTableroPath` legacy | Fallback → tablero zona | Escribir zona id |
| Docs pre-rediseño (12 fotos) | Válidos | Nuevos usan gate core |
| `revision` / lock docs | Absent = tratar revision 0 | Set en create/update |

Sin job de migración masiva.

---

## 20. Testing requirements

| # | Caso | Expectativa |
|---|------|-------------|
| 1 | Unicidad TX | Dos creates concurrentes → uno gana; lock + `ACTIVE_EXISTS` |
| 2 | Release lock | Cancel / entrada / failed create liberan unidad |
| 3 | `puedeEntregar` hard/soft | Matriz §9; faltante → soft, no hard |
| 4 | Daño sin foto | Entrega con confirm+motivo según policy |
| 5 | `finalizeDelivery` idempotent | 2ª llamada `alreadyFinalized`; un PDF |
| 6 | Merge salida | KM/gas/llantas/tapetes no se pierden |
| 7 | Inmutabilidad | Post-entregada reject domain+data (+ rules si viable) |
| 8 | Numeración | Delete daño no renumerar; photos por `damageId` |
| 9 | Coords | Matriz portrait/landscape/desktop/PDF/zoom/DPR |
| 10 | Regreso compare | `salida.danosMarcados` intacto; compare en entrada/render |
| 11 | Conflict revision | Remote change → no silent overwrite daños/firma/status |
| 12 | Abandon sheet | 3 acciones; cancel = confirm+audit+release |
| 13 | Firma metadata | Shape §13; reject single-point |
| 14 | Tablero core | Sin foto tablero → hard block; KM edit → soft retake warn |
| 15 | Dual-write | Formal → solo `danosMarcados`; freehand → strokes |
| 16 | Tests dominio | Actualizar `scripts/test-papeleta-model.js` |

Smoke: crear → 6 core → checklist → daño tipado → firmar → finalize → PDF → regreso → Ventas.

---

## 21. Acceptance criteria

1. Wizard 6 pasos + footer mobile; look app limpia.
2. Entregar exige `ZONAS_CORE` (6, con tablero+interior) + checklist completo domain; faltante solo warning.
3. Create atómico con lock; release en cancel/entrada/fail.
4. `finalizeDelivery` único, merge autorizado, idempotente.
5. Inmutabilidad salida post-entrega en domain+data (rules preferidas).
6. Daños: `id` permanente, `displayNumber` sin reuse/renumber; fotos por id.
7. Coords 0–1 por vista + clamp; matriz dispositivos.
8. Regreso no muta `isPreexisting` de salida; comparisonStatus en entrada/render.
9. Autosave con `revision`; conflictos sin silent overwrite crítico.
10. Abandon sheet §12; sin expire silencioso.
11. Firma metadata §13; damage photo policy soft §14.
12. Métricas §15 sobre telemetría existente.
13. Dual-read/write §5.3.
14. Rutas, Storage, feature gate, perms sin breaking.

---

## 22. Implementation priority order

1. Domain: `ZONAS_CORE` (+2 ids), checklist/entregar exactos, damages helpers, immutability, policy, tests.
2. Data: lock+TX create; `finalizeDelivery`; revision autosave; reject post-entrega; cancel+release.
3. Wizard shell 6 pasos.
4. Pasos 1–4 (incl. tablero core + KM retake warn).
5. Paso 5 diagrama tipado + dual-write.
6. Paso 6 cámara core → resumen hard/soft → firma → finalize → PDF.
7. CSS `.pap`.
8. Regreso comparison + Ventas/Dashboard polish.
9. Abandon sheet + metrics events.
10. Smoke + tests.

---

## 23. Out of scope / follow-ups

- WhatsApp / correo PDF.
- QR real si no existe.
- Plantillas silueta por tipo de vehículo.
- Slider comparador visual salida vs entrada.
- Offline-first con cola de fotos.
- Hard-block configurable por `DAMAGE_PHOTO_POLICY`.
- CRM/contrato real.
- Split modular de `papeletas.js` (recomendado, no bloqueante del diseño).

---

## Self-review checklist

- [x] Sin placeholders TBD.
- [x] Framing: cirugía UI + extensiones aditivas; reglas en domain/data, no solo vista.
- [x] `ZONAS_CORE` = 6 con **tablero_kilometraje** e **interior** core; mapping a ids reales; sin contradicción con “tablero opcional”.
- [x] Unicidad transaccional + release paths cerrados.
- [x] `finalizeDelivery` atómico, merge autorizado, idempotente.
- [x] Inmutabilidad post-entrega más allá de UI.
- [x] Hard vs soft de `puedeEntregar` / `isChecklistComplete` explícitos + pseudocódigo.
- [x] Numeración daños / coords / regreso compare / autosave revision / abandon / firma / damage policy / metrics / dual-write — cerrados.
- [x] Checklist sin enum `dañado`; statuses ES; PDF formal vs UI app.
- [x] Spec shipped referenciado, no borrado.

---

## Resumen ejecutivo

Rediseño de captura Papeletas a app mobile en 6 pasos, con **cirugía UI y extensiones aditivas del modelo**. Las 6 fotos core incluyen **tablero** (respaldo de KM) e **interior**. Entrega, unicidad, inmutabilidad y finalize viven en domain/data (transacciones, lock, `finalizeDelivery` idempotente). Faltantes y fotos de daño son warnings, no hard blocks. El PDF sigue siendo el documento formal; la UI de patio deja de parecer papel.
