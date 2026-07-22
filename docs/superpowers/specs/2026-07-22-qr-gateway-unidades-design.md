# Diseño: QR Gateway de Unidades

> **Fecha:** 2026-07-22
> **Estado:** diseño aprobado — pendiente de plan de implementación (Fase 1)
> **Origen:** complementa `MapGestion-QR-Gateway-Diseno.md` (vault MapGestion) con arquitectura técnica, modelo de datos, fases y casos borde
> **Alcance:** ruta pública `/app/qr/:token`, resolución de unidad, seguridad público/privado, integración con mapa y módulos operativos

---

## 0. Regla dura de UX (no negociable)

**La misma URL `/app/qr/:token` sirve las dos vistas — nunca hay redirect a login.**

- Sin sesión → se muestran los datos públicos de la unidad, en esa misma pantalla.
- Con sesión → se muestran también las acciones y datos según rol/plaza.

No existe un estado "debes iniciar sesión para ver esto". El QR siempre resuelve a algo mostrable; la sesión solo amplía lo que se ve, nunca es requisito para ver la página.

---

## 1. Arquitectura de resolución

- **Ruta pública:** `/app/qr/:token` — vista nueva del App Shell (no legacy-stage, no iframe).
- **Token:** campo `qrToken` (nanoid, ~12 chars) en el doc correspondiente de `index_unidades`. No es el ID de Firestore ni expone `empresaId` en la URL.
- **Sin sesión:** el cliente llama a la HTTPS Function `getUnidadPublica(token)` (sin auth). La Function resuelve `index_unidades.where('qrToken','==',token).limit(1)`, arma el payload público y responde. Si el token no existe o la unidad está `FUERA_DE_FLOTA` → 404 genérico (nunca "existe pero oculto").
- **Con sesión:** el cliente resuelve el token contra Firestore directo (`index_unidades` + el doc real en `cuadre`/`externos` de esa empresa), aplicando las reglas de rol/plaza ya existentes — no se reinventa el permiso, solo se llega ahí vía token en vez de buscar manualmente.
- **Aislamiento de tenant:** si la sesión pertenece a una empresa distinta a la del token resuelto, la vista se degrada al modo público (mismos datos que sin sesión). Nunca se compara ni se expone que el token pertenece a otra empresa — evita fuga cross-tenant y evita el error duro.

---

## 2. Modelo de datos y seguridad

```
index_unidades/{mva}.qrToken: string   // nanoid, único
index_unidades/{mva}/archivos/{id}     // Fase 4 — ver §5
```

- `qrToken` se agrega a la whitelist de `actualizacionUbicacionIndexValida()` en `firestore.rules`, para que rotar/generar el token siga el mismo camino ya permitido a usuarios con perfil (no se abre un permiso nuevo).
- Generación **on-demand**: botón "Generar QR" en la ficha de unidad (bajo `puedeGestionarFlotaMaestra()`). No hay backfill masivo — se genera cuando alguien va a imprimir la calca.
- **Baja de unidad:** al marcar `FUERA_DE_FLOTA` (o equivalente), el mismo flujo que actualiza estado debe limpiar `qrToken`. Un QR pegado en una unidad ya vendida no debe seguir resolviendo.
- **`getUnidadPublica(token)`:**
  - Sin auth. Rate-limit básico por IP (contador simple con TTL — no WAF; subir solo si hay abuso real).
  - Responde solo: económico, marca, modelo, color, año, placas, fotoUrl.
  - No toca `cuadre`/`externos` — todo sale de `index_unidades`.

---

## 3. Fases de implementación

### Fase 1 — Gateway público (MVP, entregable solo)

- [ ] Campo `qrToken` + whitelist en `actualizacionUbicacionIndexValida()`
- [ ] Botón "Generar QR" en ficha de unidad (muestra el MVA/económico antes de confirmar, para evitar pegar el QR en la unidad equivocada)
- [ ] Function `getUnidadPublica(token)` + vista `/app/qr/:token` (estado sin sesión, regla §0)
- [ ] Mensaje "No disponible" si token inválido / unidad dada de baja

**Entregable:** escanear un QR impreso muestra la ficha pública sin login, demostrable solo.

### Fase 2 — Acciones rápidas autenticadas

- [ ] La misma vista detecta sesión → valida rol/plaza con las reglas existentes → arma acciones disponibles (filtradas por plaza, no una lista fija)
- [ ] Convención `?unidad={mva}` que cada vista destino (papeletas, traslados, entradas/salidas) lee en `mount()` para precargar la unidad
- [ ] Toggle "Buscar unidad" / "Escanear QR" dentro de esos módulos

**Entregable:** desde el QR se dispara papeleta/traslado/entrada-salida con la unidad ya cargada.

### Fase 3 — Integración con mapa

- [ ] Botón "Ver mapa" (gate: sesión + rol ≥ Auxiliar + permiso de plaza)
- [ ] Cambiar plaza activa → centrar cámara → resaltar unidad → abrir ficha lateral (reutiliza el flujo que ya dispara `mapa-loader`/`js/views/mapa.js` al seleccionar una unidad)
- [ ] Si no está en el mapa: aviso + botón "Agregar al mapa" (solo si hay permiso), si no, solo el aviso

### Fase 4 — Documentos (greenfield)

- [ ] Subcolección `index_unidades/{mva}/archivos/{id}` — `{ storagePath, visibilidad: 'PUBLIC'|'PRIVATE', tipo, subidoPor, fecha }`
- [ ] Rule: `allow read: if resource.data.visibilidad == 'PUBLIC' || tienePerfilActual()` (espejada en Storage)
- [ ] UI de subir/marcar visibilidad en ficha de unidad
- [ ] Auto-adjuntar PDF de papeleta al firmarse (público configurable por empresa)

Cada fase = spec hija + plan propio, PR vertical — no se implementa todo junto.

---

## 4. Casos borde

- **QR dañado / calca reemplazada:** "Generar QR" rota el token; el anterior deja de resolver de inmediato.
- **Unidad vendida / baja:** limpiar `qrToken` en el mismo flujo que marca la baja (ver §2).
- **Sesión de otra empresa:** degradar a vista pública, nunca error ni confirmación de que el token pertenece a otra empresa (ver §1).
- **Permisos por plaza:** acciones rápidas y "Ver mapa" siempre filtrados por plaza/rol de la sesión, igual que el resto de la app.
- **Sin conexión:** fuera de alcance (limitación de navegador/PWA); la ruta debe ser network-first en `sw.js` (ya es el default) para no servir datos de otra unidad desde caché.
- **Enumeración de tokens:** nanoid no es secuencial ni adivinable; el rate-limit de la Function cubre el resto.
- **QR en unidad equivocada:** mitigado en el flujo de generación (mostrar MVA antes de imprimir), no es un problema técnico.
- **Colisión de token:** probabilidad despreciable a esta escala, no se agrega verificación extra.

---

## 5. Relación con el doc original

Este spec complementa `MapGestion-QR-Gateway-Diseno.md` (vault MapGestion), que define el flujo funcional (información pública/privada, acciones rápidas, bootstrap de formularios, integración con mapa, seguridad, Fase 2 de papeletas). Este documento agrega la arquitectura técnica necesaria para implementarlo en `mex-mapa`.
