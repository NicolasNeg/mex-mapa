# Smoke checklist — Papeletas digitales (beta)

Manual QA against `/app/papeletas` (authenticated user with `view_papeletas`).

## Domain (automated)

```bash
node scripts/test-papeleta-model.js
```

Expected: `OK papeleta.model 12 zonas`

## Manual flow

1. **Unicidad:** Nueva → unidad X → crear. Intentar otra para X → abre existente / error claro.
2. **Wizard:** Completar 12 fotos + checklist → status `lista`.
3. **Entregar sin cliente:** Confirmar aviso → firma → PDF con “Exportado por …” y nombre `USUARIO_FECHA_EMPRESA.pdf`.
4. **Inmutable:** Tras entregar, zonas/checklist no editables.
5. **Entrada:** Registrar entrada → `en_retorno`, `activoPorUnidad=false` → se puede crear nueva papeleta para la unidad.
6. **Daño ya en salida:** Reportar misma zona → status `descartado` / toast “Ya documentado en salida”.
7. **Daño nuevo:** placas + VIN + fotos → aparece en `/app/papeletas/ventas`.
8. **Caso abierto + nueva:** Banner de aviso al crear.
9. **Cerrar caso:** Solo Supervisor+ ve/usa “Cerrar caso”; papeleta puede pasar a `cerrada_historial`.
10. **Promover:** Ventas mueve evidencias a `papeletas_ventas/…`.

## Deploy notes (separate)

- Deploy rules + indexes before relying on queries in production.
- Deploy functions to enable `limpiarFotosReportesPapeletas`.
