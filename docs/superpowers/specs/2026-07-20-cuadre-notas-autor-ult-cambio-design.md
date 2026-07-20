---
title: Cuadre — NOTAS + AUTOR + ÚLT. CAMBIO
date: 2026-07-20
status: approved — implemented
---

# Cuadre — NOTAS + columnas opcionales AUTOR / ÚLT. CAMBIO

## Objetivo

Mejorar la tabla de flota del cuadre legacy: columna **Notas** más ancha con texto útil, y columnas opcionales **Autor** (quien insertó) y **Últ. cambio** (quien tocó la unidad por última vez + fecha compacta), revelables con un toggle de columnas.

## Decisiones

| Tema | Decisión |
|------|----------|
| Orden | NOTAS → AUTOR → ÚLT. CAMBIO |
| Toggle | Muestra/oculta AUTOR y ÚLT. CAMBIO juntas; preferencia en `localStorage` (`mex.cuadre.metaCols`) |
| AUTOR | `_createdBy` |
| ÚLT. CAMBIO | `lastTouchedBy` → `actualizadoPor` → `adminResponsable` → `_updatedBy`; fecha `lastTouchedAt` → `_updatedAt` |
| NOTAS | Texto sin prefijos `(fecha) [usuario]`; vacío → `—` |
| Alcance | Tabla desktop cuadre en `cuadre.html`, `mapa.html`, `mapa-arrendadora.html`; `renderFlota` en `mapa.js` |

## Fuera de alcance

- Cuadrarflota SPA, exports, cambios al formato Firestore de `notas`.
