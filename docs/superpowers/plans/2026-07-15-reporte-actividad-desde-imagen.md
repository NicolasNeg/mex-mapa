# Reporte Actividad desde Imagen (Gemini) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Usuario sube captura Optima → Cloud Function + Gemini → JSON → PDF/impresión existente, sin exponer pasos intermedios.

**Architecture:** Callable `generarReporteActividadDesdeImagen` llama Gemini con la imagen; cliente solo comprime, invoca y abre `generarHtmlActividadDiaria` / `abrirReporteImpresion`.

**Tech Stack:** Firebase Functions v1, Gemini REST (`generateContent`), JS cliente legacy/cuadre.

**Spec:** `docs/superpowers/specs/2026-07-15-reporte-actividad-desde-imagen-design.md`

## Global Constraints

- API key solo en Functions config/env.
- Mensajes de error genéricos al usuario.
- Reutilizar shape de filas del parser actual.
- No tocar OCR de placas ni import unidades en esta fase.

---

## File map

| File | Role |
|------|------|
| `functions/index.js` | Callable + Gemini + normalización JSON |
| `js/features/cuadre/pdf-reservas.js` | UI subir imagen + orquestación cliente |
| `mapa.html` / `mapa/templates/mapa-core.html` / `gestion.html` | Zona upload en modal (si el HTML está duplicado) |
| `css/mapa.css` (mínimo) | Estilos sobrios del upload si hace falta |

---

### Task 1: Cloud Function Gemini

- [x] Add `generarReporteActividadDesdeImagen` in `functions/index.js`
- [x] Auth + `ADMIN_ROLES`; read `gemini.api_key` / `GEMINI_API_KEY`
- [x] Strip data-URL prefix; validate mime + size
- [x] Call Gemini (`gemini-2.0-flash` or `gemini-1.5-flash`) with JSON schema prompt
- [x] Parse/normalize arrays; return counts
- [ ] Deploy functions (user must set API key first)

### Task 2: Cliente — upload opaco → PDF

- [x] In `pdf-reservas.js`: compress image, call callable, open report
- [x] Wire button/input in modal HTML(s)
- [x] Hide/collapse textareas as secondary path
- [x] Toast genérico on failure; loading state on button

### Task 3: Verify

- [ ] Manual: subir captura → PDF con tablas
- [ ] Confirm no API key in network tab / JS bundles
- [ ] Commit only when user asks
