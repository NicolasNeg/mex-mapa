# Import imagen rechazo sin filas — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rechazar imagen/PDF OCR (unidades) y captura Gemini (actividad) si hay 0 filas válidas.

**Architecture:** Hard reject en cliente; CF actividad ya rechaza. Sin helper compartido.

**Tech Stack:** Vanilla JS SPA + `pdf-reservas.js` + Cloud Function existente.

**Spec:** `docs/superpowers/specs/2026-07-19-import-imagen-rechazo-sin-filas-design.md`

---

### Task 1: Unidades — rechazo OCR imagen/PDF

**Files:** `js/app/views/unidades.js`

1. En ramas PDF e imagen de `_readImportFile`, si tras `_rebuildImportRows` no hay `importRows`:
   - Reset `importRaw` / `importMapping` / `importRows`
   - Vaciar paste opcional o dejar vacío al rechazar
   - Limpiar `#uni-import-file` (o input file del modal)
   - Mensaje + `showToast` de rechazo
   - `return` sin tratar como éxito
2. Verificar CSV/Excel/paste sin cambio de comportamiento de éxito.

### Task 2: Actividad — cliente no abre PDF vacío

**Files:** `js/features/cuadre/pdf-reservas.js`, caller en `js/views/mapa.js` si hace falta

1. En `procesarActividadDesdeImagen`: tras callable, si total filas = 0 → throw/toast y return (defensa además de CF).
2. En `procesarAnalisisReservasDesdeImagen`: si 0 filas derivadas → throw Error con mensaje claro.
3. Asegurar toast muestra `failed-precondition` / “No se detectaron filas…”.

### Task 3: Cierre

1. Marcar Obsidian `(11) arreglar formatos y opciones.md` como ARREGLADO.
2. Bump SW + commit + push (política workspace).
