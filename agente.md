# Memoria del agente — MapGestion

Reglas duraderas del producto. Los agentes y desarrolladores deben respetarlas al implementar o modificar exportaciones.

---

## Regla de oro — Cierre de tarea (bump SW + commit + push)

**Siempre que se termine una tarea con cambios en el código**, antes de cerrar:

1. **Bump del Service Worker:** ejecutar `node scripts/bump-sw.js` (incrementa `CACHE_NAME = 'mapa-vXXX'` en `sw.js`) para que los usuarios no reciban assets cacheados viejos.
2. **Commit:** `git add -A && git commit -m "<mensaje descriptivo>"`.
3. **Push:** `git push` a la rama actual para mantener GitHub sincronizado.

Notas:

- Aplica aunque **no** se haga deploy (deploy es aparte y también bumpea el SW vía `npm run deploy`).
- Si el bump ya lo hizo un `npm run deploy`, no volver a bumpear en el mismo cambio.
- Si la terminal/entorno no responde, avisar que el bump/commit/push quedó pendiente hasta reiniciar el entorno.

---

## Regla de oro — Exportación de documentos

**Todo documento exportado** debe identificar quién lo exporta y la empresa.

### Por tipo de archivo

| Tipo | Firma / identificación |
|------|------------------------|
| **PDF** | Siempre firmado **dentro del documento** con datos de la empresa y del usuario que exporta (nombre, fecha, etc.). Preferir metadata o pie “Exportado por …” además del branding de empresa. |
| **Excel (xlsx/xls)** | También lleva datos de la empresa **dentro del archivo** (hoja, encabezado, pie, o celda meta). Preferir metadata/pie “Exportado por …” además del branding de empresa. |
| **CSV** | La firma va **solo en el nombre del archivo**. No hace falta fila meta obligatoria salvo que ya exista en ese flujo. |

### Formato de nombre de archivo (todos los tipos al descargar)

```
NOMBRE_USUARIO_FECHA_NOMBREEMPRESA.ext
```

**Ejemplo:** `ANGEL_ARMENTA_2026_09_16_OPTIMARENTACAR.pdf`

Reglas de sanitización:

- **Usuario:** mayúsculas; espacios → `_`
- **Fecha:** `YYYY_MM_DD`
- **Empresa:** nombre sanitizado en mayúsculas, sin espacios raros
- **Extensión:** según el tipo (`.pdf`, `.xlsx`, `.xls`, `.csv`, …)

### Checklist al implementar o tocar un export

1. ¿El nombre del archivo descarga sigue `NOMBRE_USUARIO_FECHA_NOMBREEMPRESA.ext`?
2. ¿PDF/Excel incluyen empresa + usuario (y fecha) dentro del archivo?
3. ¿Hay pie o metadata “Exportado por …” en PDF/Excel cuando aplica?
4. ¿CSV solo firma por nombre de archivo (salvo meta ya existente)?
