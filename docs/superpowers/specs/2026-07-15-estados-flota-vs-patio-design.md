# Diseño: Estados flota (global) vs estados patio (cuadre)

> **Fecha:** 2026-07-15  
> **Estado:** aprobado — Fase 0–3 en código (dominio, sync, UI cuadre, buscador, expediente)  
> **Alcance:** modelo de datos, UI cuadre/mapa, buscador global, base para contratos futuros

---

## 1. Problema

Hoy `estado` se usa para dos ideas distintas:

1. **Disponibilidad de negocio** (¿se puede rentar / está en tránsito / venta?)
2. **Condición operativa en patio** (¿está limpia / lista / en taller?)

Eso produce:

- En la tabla de cuadre, LISTO/SUCIO y ARRENDABLE/NO ARRENDABLE compiten en la misma columna con badges de color.
- En el buscador global solo aparece el chip “En cuadre” (derivado de `plazaActual`), sin estado de negocio ni de patio.
- No hay puente claro para contratos futuros: “¿puedo rentar?” vs “¿está lista físicamente?”.

---

## 2. Principio operativo

| Pregunta | Capa | Quién la mira primero |
|----------|------|------------------------|
| ¿La unidad es rentable / está rentada / en traslado / venta? | **Estado flota** (global) | Contratos, Unidades, buscador, reportes |
| ¿Está lista, sucia, en mantenimiento de patio? | **Estado patio** (cuadre) | Mapa, cuadre, cola de preparación |
| ¿Dónde está físicamente? | **Ubicación** | Mapa, cuadre, buscador |

**Regla de producto (acordada):**

- El equipo operativo se guía por **mapa/cuadre** (patio + ubicación).
- En **global**, la unidad aparece como **ARRENDABLE** cuando está en patio en LISTO o SUCIO (u otros estados patio “rentables”).
- Al abrir un **contrato** (futuro): filtrar primero por estado flota; si flota = ARRENDABLE pero patio = SUCIO → **alerta**, no bloqueo duro por defecto.
- Misma idea para MANTENIMIENTO patio vs flota.

---

## 3. Modelo de datos

### 3.1 Dos campos explícitos

| Campo | Colección fuente | Valores canónicos |
|-------|------------------|-------------------|
| `estadoFlota` | `index_unidades` (también denormalizado en detalle SPA) | `ARRENDABLE`, `NO ARRENDABLE`, `EN RENTA`, `TRASLADO`, `VENTA`, `MANTENIMIENTO` |
| `estadoPatio` | `cuadre` / `externos` (campo actual `estado`) | `LISTO`, `SUCIO`, `MANTENIMIENTO`, `RESGUARDO`, `RETENIDA`, (+ `EXTERNO` en externos) |
| `ubicacion` | cuadre + sync a index | PATIO, TALLER, posiciones, EXTERNO, etc. |

**Compatibilidad:**

- Seguir leyendo `estado` / `estatus` en index como alias de `estadoFlota` durante migración.
- En cuadre, el campo Firestore sigue llamándose `estado` (= patio) para no romper `aplicarEstado` de golpe; en código nuevo se nombra `estadoPatio` en view-models.

### 3.2 Catálogos

**Flota (fijo de producto + colores en config opcional):**

```
ARRENDABLE | NO ARRENDABLE | EN RENTA | TRASLADO | VENTA | MANTENIMIENTO
```

**Patio (sigue en `MEX_CONFIG.listas.estados` / `ESTADOS_PATIO`):**

```
LISTO | SUCIO | MANTENIMIENTO | RESGUARDO | RETENIDA | …
```

`TRASLADO`, `VENTA`, `NO ARRENDABLE` que hoy viven en selects de patio se tratan como **acciones que cambian flota** (y pueden dejar patio en N/A o RESGUARDO según regla).

### 3.3 Sync patio → flota (`aplicarEstado` / mutaciones)

| Nuevo estado patio (o acción) | Efecto en `estadoFlota` |
|-------------------------------|-------------------------|
| `LISTO`, `SUCIO`, `RESGUARDO` | → `ARRENDABLE` **solo si** flota actual ∉ {`EN RENTA`, `TRASLADO`, `VENTA`} |
| `MANTENIMIENTO` (patio) | → `MANTENIMIENTO` (mismo guard: no pisar EN RENTA/TRASLADO/VENTA) |
| `NO ARRENDABLE` | → `NO ARRENDABLE` |
| `RETENIDA` | → `NO ARRENDABLE` (o mantener `NO ARRENDABLE` + patio RETENIDA) |
| Acción “poner en renta” (futuro contrato) | → `EN RENTA` (patio puede quedar vacío o “EN RENTA” display-only) |
| Acción traslado / venta | → `TRASLADO` / `VENTA` |

**No pisar flota “cerrada”:** si está `EN RENTA` / `TRASLADO` / `VENTA`, un cambio de lavado (LISTO↔SUCIO) **no** debe volverla ARRENDABLE.

Index sync hoy solo escribe `plazaActual` + `ubicacion`. **Ampliación:** también escribir `estadoFlota` (y opcionalmente `estadoPatio` denormalizado en index para buscador sin second hop).

### 3.4 Denormalización recomendada en `index_unidades`

Para el buscador global (sin N lecturas a cuadre):

```
estadoFlota: 'ARRENDABLE'
estadoPatio: 'SUCIO' | null   // null si no está en cuadre
plazaActual, ubicacion, pos, …
```

Actualizar `estadoPatio` en el mismo path que ya sincroniza ubicación al aplicar estado.

---

## 4. UI

### 4.1 Tabla cuadre / mapa flota

**Antes:** badges de color en ESTADO y UBICACIÓN (mezcla LISTO + NO ARRENDABLE).

**Después:**

| Columna | Contenido | Estilo |
|---------|-----------|--------|
| **Flota** (nueva o renombrar) | ARRENDABLE / EN RENTA / … | Texto o chip **neutro** (gris/borde); color solo tipografía suave, no relleno fuerte |
| **Patio** | LISTO / SUCIO / … | Chip con color de patio (vars actuales `.st-LISTO`, etc.) **solo si** hay plaza en cuadre |
| **Ubicación** | PATIO, TV-2, TALLER… | Texto plano o chip gris; **sin** `.ubi-*` de color en texto |

Filtros: chips de patio siguen siendo los operativos; filtro flota opcional en fase 2.

### 4.2 Buscador global (`mapa-buscador.js`)

Ficha unidad (imagen 2):

1. Chip **estado flota** (siempre que exista en index).
2. Chip **estado patio** si `estadoPatio` o hidratación; si no hay plaza → no mostrar patio.
3. Mantener chip **En cuadre / No registrado** (presencia en plaza), distinto de flota/patio.
4. Resto de KV igual (sucursal, plaza, ubicación, placas…).

Filas de resultados: punto o texto corto de flota (no solo verde “en cuadre”).

### 4.3 Unidades / expediente

Mostrar flota como campo editable de negocio; patio como read-only link “Ver en cuadre / cola” cuando aplique.

---

## 5. Contratos futuros (hook, no implementar ahora)

Flujo propuesto:

```
1. Filtrar candidatos: estadoFlota === 'ARRENDABLE'
2. Al seleccionar unidad:
   - si estadoPatio === 'SUCIO' → alerta “Unidad sucia — confirmar preparación”
   - si estadoPatio === 'MANTENIMIENTO' → alerta fuerte / bloquear según política
   - si estadoPatio === 'LISTO' → OK
   - si sin patio / sin plazaActual → alerta “No está en cuadre de esta plaza”
3. Al firmar contrato → estadoFlota = EN RENTA
```

Cola de preparación encaja: checklist 4/4 → LISTO patio → (ya) sync LISTO→cuadre; flota ya ARRENDABLE.

---

## 6. Fases de implementación

### Fase 0 — Dominio (sin UI)
- Extender `domain/estado.model.js`: `ESTADOS_FLOTA`, helpers `esFlotaCerrada`, `derivarFlotaDesdePatio(patio, flotaActual)`.
- Tests mentales / smoke en comentarios de contrato de sync.

### Fase 1 — Sync index
- En `aplicarEstado` (y alta unidad): escribir `estadoFlota` + `estadoPatio` en `index_unidades`.
- Backfill opcional: script o lazy al abrir Unidades (LISTO/SUCIO → ARRENDABLE si flota vacía).

### Fase 2 — UI cuadre
- Separar columnas flota / patio; quitar color de ubicación; patio conserva chips de color.
- Selects: patio vs acciones flota (o un select patio + acciones admin para NO ARRENDABLE/VENTA).

### Fase 3 — Buscador global
- Leer `estadoFlota` / `estadoPatio` del index; chips en ficha y hint en lista.
- Fallback: si falta `estadoPatio` y hay `plazaActual`, one-shot a cuadre (cache por MVA).

### Fase 4 — Unidades + expediente
- Formulario: campo flota; badge patio read-only.
- Documentar política de contratos (sección 5) en PLAN_MAESTRO / feature contratos.

---

## 7. Fuera de alcance (esta iteración)

- Módulo contratos / apertura de renta.
- Rediseño completo de chips de filtros del mapa.
- Renombrar campo Firestore `estado` en documentos `cuadre` (alias en código basta).
- Cambiar colores de autos en el mapa SVG (pueden seguir usando patio).

---

## 8. Criterios de éxito

1. En cuadre, ubicación ya no usa badges de color; patio y flota se distinguen a simple vista.
2. Buscador muestra estado flota (p. ej. ARRENDABLE) y, si aplica, patio (LISTO/SUCIO).
3. Marcar LISTO o SUCIO deja flota en ARRENDABLE sin romper EN RENTA/TRASLADO/VENTA.
4. Documentación lista para que contratos filtren flota y alerten por patio.

---

## 9. Decisión pendiente de producto (menor)

¿`RETENIDA` mapa a `NO ARRENDABLE` en flota, o a un flota propio `RETENIDA`?  
**Default propuesto:** flota `NO ARRENDABLE` + patio `RETENIDA` (menos estados globales).
