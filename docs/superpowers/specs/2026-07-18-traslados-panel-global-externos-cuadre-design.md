---
title: Traslados ENTRADA + panel global + externos + finalizar cuadre
date: 2026-07-18
status: approved — implementing
source: MapGestion/MEJORA EN TRASLADOS Y PANEL DE UNIDADES GLOBAL.md
---

# Paquete: traslados, panel global, externos, finalizar cuadre

## Objetivo

Cuatro parches acotados (enfoque A) sobre código existente, sin rediseñar módulos.

## 1. Traslados — fila ENTRADA

**Comportamiento**
- Traslado abierto sin cerrar: solo fila de **salida** (KM + gas).
- Al pulsar “Cerrar traslado”: en el bloque Unidades aparece fila **ENTRADA · KM · GAS** (editable), junto a salida.
- Traslado cerrado: fila ENTRADA visible en solo lectura.

**Reglas**
- `km entrada ≥ km salida` siempre (UI + API; validación de cierre existente).
- Errores de kilometraje: corrección solo vía admin (`km_corregir`), no en el traslado.
- Sin texto “km recorridos” ni cálculo de consumo.
- Modelo: seguir con `kmLlegada` / `gasLlegada` (solo etiquetas UI).

**Fuera de alcance:** choferes, tipos, cambio de plaza, historial de ediciones.

## 2. Panel unidad global

**Dónde:** ficha `fichaUnidad` en `js/views/mapa-buscador.js`.

**Cambios**
- Mostrar **KM** (o `—` si no hay).
- Botón **Ver unidad** → `/app/cuadre/u/{MVA}` (cierra panel).
- Botón **Ver en mapa** → deep-link actual; solo si el usuario puede ver la plaza.
- Badge “En cuadre” informativo; no es el CTA de mapa.

## 3. Externos — mapa sí, operación no

**Naturaleza:** vehículos de personal en patio; no arrendables.

**Sí:** visibles en el mapa.  
**No:** tabla de cuadre, misión/auditoría, exports de flota, totales/KPIs de inventario arrendable, reportes de cuadre.

**Implementación:** helper `esUnidadExterna(u)` (tipo/ubicacion/estado/hoja) y filtrar en consumidores operativos. No borrar colección ni quitar alta. Dashboard KPI “Externos” puede quedar informativo y separado del total de flota.

## 4. Finalizar cuadre desde historial

**Bug:** el botón del historial llama `manejadorFlujoV3()` leyendo `txtV3`; si no dice exactamente `FINALIZAR CUADRE`, no entra al branch de revisión y “no pasa nada” / abre flujo equivocado (Cuadre Admins vacío).

**Fix:** `finalizarCuadreDesdeHistorial` abre siempre el flujo de **revisión de ventas** (`sales-review` + `obtenerRevisionAuditoria`), sin depender del texto de `txtV3`. Continuar el flujo de cuadre existente hasta firmar/cerrar.

## Testing manual

1. Traslado abierto → Cerrar → fila ENTRADA editable; km &lt; salida rechazado; cerrado muestra ENTRADA.
2. Buscador global → ficha con KM + Ver unidad + Ver en mapa.
3. Externo en mapa; ausente en tabla cuadre, export y misión.
4. Historial con misión en revisión → Finalizar cuadre abre revisión de ventas con unidades.
