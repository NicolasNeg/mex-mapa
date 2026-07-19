# Design: Rechazo de imagen/PDF sin filas detectadas (import + actividad)

**Date:** 2026-07-19  
**Status:** Approved (approach A)  
**Related:** `2026-07-15-reporte-actividad-desde-imagen-design.md`, Obsidian `(11) arreglar formatos y opciones.md`

## Goal

Si OCR/parse de una imagen (o PDF vía OCR en unidades) **no detecta al menos una fila estructurada válida**, la captura se **rechaza**: no se trata como éxito parcial ni se abre reporte/import vacío.

Umbral: **≥ 1 fila válida**.

## Scope

| Flujo | Entrada | Criterio aceptar | Ya existe rechazo servidor? |
|--------|---------|------------------|-----------------------------|
| Import unidades (`/app/unidades`) | Imagen / PDF (OCR Tesseract) | ≥ 1 fila con `mva` tras parse | No — hoy deja texto y pide editar |
| Actividad diaria (captura Optima) | Imagen → Gemini callable | ≥ 1 de `reservas` / `regresos` / `vencidos` | Sí (`failed-precondition`) |

**Fuera de alcance:** rediseño de export XLS/PDF/CSV de unidades (ya existe); pegado manual de texto en import; cambio de modelo Gemini.

## Approach A — rechazo duro en cliente

### Unidades (`js/app/views/unidades.js` + `unidades-import.js`)

Tras `extractTextFromImageFile` / `extractTextFromPdfFile` → `matrixFromOcrText` → `_rebuildImportRows`:

1. Si `_s.importRows.length === 0`:
   - Toast/mensaje de error: *«No se detectaron filas en la imagen. Prueba otra captura.»* (PDF: misma idea, «en el PDF»).
   - Limpiar file input del import.
   - No dejar el flujo como “OCR listo, edita el texto”.
   - Vaciar o no aplicar preview de filas; resetear `importRows` / mapping como fallo.
2. Si hay ≥ 1 fila con `mva`: comportamiento actual (previsualizar y aplicar).

El camino **pegar texto / CSV / Excel** no cambia: solo endurece imagen y PDF OCR.

### Actividad (`js/features/cuadre/pdf-reservas.js` + CF)

- Cloud Function `generarReporteActividadDesdeImagen` ya lanza si las tres listas van vacías — **mantener**.
- Cliente:
  - Tras callable, si `counts` total = 0 (o arrays vacíos), no llamar `abrirReporteImpresion` / PDF.
  - Toast con mensaje usable (`No se detectaron filas en la captura.` o el de la CF).
  - Limpiar input (`_setActividadImageBusy` ya limpia al terminar).
- Mismo criterio en `procesarAnalisisReservasDesdeImagen` si aplica preview en modal: rechazar si 0 filas derivadas.

## UX

- Un solo mensaje claro; sin JSON ni detalle de OCR/API.
- Usuario puede reintentar con otra captura o usar fallback de texto (unidades / modal avanzado actividad).

## Acceptance

1. Imagen de unidades sin MVA detectables → toast de rechazo, sin filas listas para importar, input limpio.
2. Imagen de unidades con ≥ 1 MVA → preview con filas como hoy.
3. Captura actividad sin filas → toast, sin abrir reporte.
4. Captura actividad con ≥ 1 reserva/regreso/vencido → reporte como hoy.
5. CSV/Excel/paste unidades sin regresión.

## Non-goals

- Umbral > 1 fila.
- Mejorar precisión OCR/Gemini.
- Unificar parsers unidades ↔ actividad en un helper compartido (opcional futuro).
