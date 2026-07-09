---
title: Ideas futuras — MapGestión
tags: [roadmap, ideas, mapgestion]
created: 2026-07-09
status: backlog
---

# 🗺️ Ideas futuras — MapGestión

Backlog de features grandes y mejoras que **no** están en el flujo actual pero
que ya se discutieron y valen la pena. Cada una tiene contexto, enfoque
recomendado y notas de implementación para retomarla sin re-derivar todo.

> Prioridad sugerida: **Importador de unidades** > **Apps móviles (PWA wrap)** >
> **Demo público**. Las tres son independientes.

---

## 1. 🚗 Importador de unidades (Excel / CSV / PDF / JSON)

### Problema
Dar de alta unidades una por una es lento. Los clientes suelen entregar
**tablas de Excel**, pero también pueden mandar PDF, JSON u otros formatos.
Necesitamos poder importar en lote y tener la tecnología para leer lo que sea
que entreguen.

### Enfoque recomendado
- **Excel/CSV** (el 90% de los casos): parseo **en el cliente** con una librería
  tipo [SheetJS/xlsx](https://sheetjs.com/) → **mapeo de columnas** (arrastrar
  "columna del archivo" → "campo de la unidad") → **preview** de las filas →
  alta batch en Firestore (`index_unidades` + opcionalmente al cuadre).
- **JSON**: import directo con **validación de esquema** antes de escribir.
- **PDF**: extracción de tablas (lo más complejo). Posible **OCR/parse en una
  Cloud Function**. Nota: el mapa ya tiene un módulo OCR en
  `mapa/features/extras/ocr.js` que podría reaprovecharse.

### Campos a mapear (mínimo)
`mva` / número económico · `vin` · `placas` · `modelo` · `marca` · `categoria` ·
`año` · `sucursal` (plaza de origen) · `estado` inicial · `ubicacion`.

### UI
Un botón **"Importar unidades"** en el panel admin → selector de archivo →
detecta formato → mapeo → preview → confirmar. Mostrar conteo de creadas /
actualizadas / con error.

### Notas técnicas
- Reusar la escritura batch como en `backfillUbicacionGlobal()` (api/flota.js).
- Respetar la regla nueva: crear en `index_unidades` está permitido a
  autenticados (con `mva`). Ver [[completitud-del-indice]] abajo.
- Deduplicar por `mva` (upsert): si ya existe, actualizar; si no, crear.

---

## 2. 📱 Apps móviles (Android / iOS) sobre el MISMO Firestore

### Idea
Apps móviles conectadas **al mismo proyecto Firebase/Firestore** que la web →
datos, auth y realtime **compartidos**. Las `firestore.rules` aplican a todos
los clientes por igual (server-side) → **cero re-trabajo de seguridad**.

### Caminos (de menos a más trabajo) — recomendado #1
1. **Envolver la PWA actual** (ya hay `manifest.json` + service worker) con
   **TWA (Bubblewrap)** o **Capacitor** → **100% reuso de código**, en Play
   Store en horas. iOS también con Capacitor (Apple más estricto; push en PWA
   iOS es limitado). **← EMPEZAR AQUÍ.**
2. **Flutter** — un solo código → Android + iOS **nativos**; SDK Firebase
   oficial; se reescribe solo la UI, no el backend. Buen balance si el objetivo
   es tienda + iOS con look nativo.
3. **Nativo puro** (Android Studio/Kotlin + Swift) — máximo control y trabajo;
   solo si hay features nativas profundas que la web no cubra.

### Notas
- Android nativo/Flutter: registrar la app en Firebase (package +
  `google-services.json`). **TWA no lo necesita** (corre la web tal cual).
- Un cambio desde web aparece al instante en la app y viceversa
  (`onSnapshot` ↔ `addSnapshotListener`).

---

## 3. 🧪 Demo público (sin login) — `demo.mapgestion.com`

### Idea
Un botón en el landing (mapgestion.com) → `demo.mapgestion.com` que carga
**todo el proyecto** en modo "beta" **sin login ni validación de permisos**,
con datos falsos/prueba y **editable igual** que el real.

### Enfoque recomendado: **proyecto Firebase separado** (NO Supabase, NO namespacing)
- ❌ **Supabase**: obligaría a reescribir toda la capa de datos
  (Firestore→SQL, otro realtime, otro SDK). No.
- ❌ **Colecciones `demo_` en la misma DB**: cada referencia sería demo-aware;
  riesgo de fuga a datos reales. No.
- ✅ **Nuevo proyecto `mapgestion-demo`** (Firestore aislado, datos falsos),
  **MISMO código** apuntado por `js/core/firebase-config.js`. Alias `demo` en
  `.firebaserc` (ya existen `production`/`staging`). Deploy `firebase deploy -P demo`.

### Cambios de código mínimos (~1 archivo)
1. Detectar demo por hostname (`location.hostname.startsWith('demo.')`) →
   `window.__MEX_DEMO`.
2. **Auto-login** (`signInAnonymously` o cuenta demo sembrada) en boot si demo
   → salta el login.
3. Usuario demo con rol **PROGRAMADOR** (ya bypasea permisos) — no se borra nada
   de permisos, solo se otorga acceso total.
4. **Reglas permisivas** en el proyecto demo
   (`allow read, write: if request.auth != null`) — datos falsos.
5. **Cloud Function programada (cron)** que borra + re-siembra las colecciones
   demo para auto-limpiar después de que los visitantes la desordenen.
6. Conectar `demo.mapgestion.com` al hosting del proyecto demo.

### Bonus
El tráfico/lecturas demo pega a la **cuota del proyecto demo, no a producción**.

### Decisión pendiente
Reset **compartido** (simple, v1) vs **aislado por sesión** (más robusto,
después).

---

## 4. Mejoras menores / deuda

### <a id="completitud-del-indice"></a>Completitud del índice global
- Ya se implementó: al insertar al cuadre se **crea el doc en `index_unidades`**
  si falta, y `backfillUbicacionGlobal()` **crea** los faltantes. Correr el
  backfill una vez tras el deploy.

### KPIs siempre visibles en el cuadre mobile
- Hoy los KPIs (TOTAL FLOTA / LISTOS) viven en el panel GESTOR (bottom-sheet en
  mobile) → solo se ven al abrir una unidad. Opción: **barra compacta de KPIs**
  fija arriba de la lista en mobile (requiere reflejar los números con un
  pequeño ajuste de DOM/JS).

### Limpieza
- Borrar funciones inertes `procesarSolicitudAcceso` / `enviarCorreoSolicitud`
  (sin callers, quedaron del pivote single-tenant).
- Arreglar `firebase.json` para que `deploy:rules` incluya **storage:rules**
  (hoy falla: "Could not find rules for the following storage targets: rules").

### Cloud Functions y plan Blaze
- El proyecto parece estar en plan **Spark** (se topó la cuota de Hosting). Las
  **Cloud Functions requieren Blaze** para desplegarse. Varias features de arriba
  (seed/reset del demo, OCR de PDF, `syncDeviceContext`) necesitan Functions →
  evaluar upgrade a Blaze (pago por uso, para esta escala casi gratis).

---

## Referencias en el repo
- Deploy y convenciones: `CLAUDE.md`
- Reglas: `firestore.rules`
- Índice global de unidades: `api/flota.js` (`obtenerUnidadesPlazas`,
  `backfillUbicacionGlobal`) + `api/cuadre.js` (sync)
- Buscador global: `js/views/mapa-buscador.js`
