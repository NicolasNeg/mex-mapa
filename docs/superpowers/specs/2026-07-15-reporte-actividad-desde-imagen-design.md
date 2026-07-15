# Design: Reporte de Actividad Diaria desde imagen (Gemini)

**Date:** 2026-07-15  
**Status:** Approved  
**Provider:** Google Gemini (multimodal)

## Goal

El usuario sube una captura del reporte Optima. Sin ver texto crudo ni pasos intermedios, recibe el Reporte de Actividad Diaria (PDF/impresión) ya armado.

## User experience

1. Abrir modal de actividad diaria / lector de reservas.
2. Pulsar **Subir captura** y elegir imagen (jpg/png/webp).
3. Ver estado único: “Generando reporte…”.
4. Se abre el reporte existente (impresión/PDF).
5. Si falla: toast genérico (“No se pudo leer la captura”). Sin exponer JSON, prompts ni errores de API.

Las textareas de pegar texto quedan como fallback opcional (colapsado / avanzado), no como camino principal.

## Architecture

```
Cliente (comprimir imagen)
  → httpsCallable('generarReporteActividadDesdeImagen')
    → Auth + ADMIN_ROLES
    → Gemini Vision (API key solo en Functions)
    → JSON { reservas, regresos, vencidos, fechaBase }
  ← response
Cliente → generarHtmlActividadDiaria(...) → abrirReporteImpresion(...)
```

- La clave Gemini **nunca** va al cliente, SW, repo ni Firestore público.
- El PDF visual reutiliza el HTML actual (`js/features/cuadre/pdf-reservas.js`).
- Gemini debe devolver filas ya estructuradas (mismo shape que `parsearTablaSucia`).

## API contract

### Callable

`generarReporteActividadDesdeImagen` — region `us-central1`

### Request

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `imageBase64` | string | yes | raw base64 o `data:image/...;base64,...` |
| `mimeType` | string | no | default `image/jpeg` |
| `fechaBase` | string | no | `YYYY-MM-DD`; default hoy (zona MX) |

### Response (ok)

```json
{
  "ok": true,
  "fechaBase": "2026-07-15",
  "reservas": [],
  "regresos": [],
  "vencidos": [],
  "counts": { "reservas": 0, "regresos": 0, "vencidos": 0 }
}
```

Cada fila:

| Field | Type | Notes |
|-------|------|-------|
| `numero` | string | contrato |
| `fecha` | string | preferible `YYYY-MM-DD HH:mm:ss` |
| `clase` | string | 4 letras típicas Optima |
| `cliente` | string | |
| `pago` | boolean | |
| `frecuente` | boolean | |
| `tipo` | string | `RESERVA` \| `REGRESO` \| `VENCIDO` |

### Errors

- `unauthenticated` / `permission-denied` / `invalid-argument` / `resource-exhausted` / `internal`
- Mensaje cliente genérico; detalle en Cloud Logging.

## Security

- Firebase Auth required.
- Caller role must be in `ADMIN_ROLES` (same set as other admin callables).
- Secret: `functions.config().gemini.api_key` **or** `process.env.GEMINI_API_KEY`.
- Max decoded image size ~900 KB; reject larger.
- Timeout: 120s. Memory: 512 MB if needed.

## Gemini prompt (server)

- Instruct model to extract only reservations / returns / overdue from the screenshot.
- Output **JSON only** matching the response schema (no markdown fences if possible; strip if present).
- If a section is empty, return `[]`.
- Do not invent contracts; omit unreadable rows.

## Out of scope (this phase)

- Import de unidades desde foto.
- Export Excel/Word/ZIP del plan (11).
- Sustituir OCR de placas del mapa.
- PDF binario generado en servidor (puppeteer/pdfkit).

## Self-review

- No placeholders pendientes.
- Shape de filas alineado con `parsearTablaSucia` / `generarHtmlActividadDiaria`.
- Clave no expuesta en cliente.
- UX opaca acordada con el usuario.
