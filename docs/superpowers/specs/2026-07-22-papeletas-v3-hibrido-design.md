# Diseño: Papeletas v3 — captura híbrida + PDF + entrega operativa

> **Fecha:** 2026-07-22  
> **Estado:** aprobado por usuario (brainstorming)  
> **Fuente de producto:** `MapGestion/PAPELETAS.md` + sesión 2026-07-22  
> **Enfoque de entrega:** capas (B) — dominio → UI híbrida → cámara → diagrama → PDF → anotación fotos  
> **Relación:**
> - Extiende [`2026-07-22-papeletas-app-hoja-lapiz-design.md`](./2026-07-22-papeletas-app-hoja-lapiz-design.md) (§0A scope global, autosave, cliente diferible).
> - **Reemplaza** la UX primaria “solo scroll continuo en móvil” por **híbrido C**.
> - Conserva domain base de `2026-07-20-papeletas-mobile-app-redesign-design.md` y lo **amplía** (core 7, side-effects entrega).

---

## 0. Decisiones locked (brainstorming)

| # | Decisión | Valor |
|---|----------|--------|
| 1 | Captura UX | **C híbrido:** móvil = pantallas; desktop = scroll + hover zona→foto |
| 2 | Hard fotos | **A:** 7 core + **tablero obligatorio** (tablero no es “core 7” pero sí hard) |
| 3 | Side-effects entrega | **A:** PDF + lock + **sacar de cuadre** + unidad **RENTADA/ARRENDADA** |
| 4 | Corregir ficha | **A:** solo en **papeleta** (no master Unidades) |
| 5 | Anotar fotos | **A:** v1 con lápiz + marcas tipadas overlay |
| 6 | Rollout | **B:** por capas |

---

## 1. Arquitectura de captura (híbrido)

### 1.1 Móvil (< ~900px) — stack de pantallas

1. **Buscador grande** → elige unidad (catálogo empresa-global).  
2. **Hero unidad** — **imagen del modelo** como plano visual; encima: económico grande, modelo, placas, color, VIN. Readonly hasta “Editar”; correcciones **solo papeleta**. Confirmar → crea/abre papeleta (TX lock).  
3. **Datos operativos** — cliente/contrato opcionales; KM grande; gas selectable (orden de lista); foto tablero con preview; checklist 2 columnas + iconos; tapetes 0–9; marcas llantas rediseñadas. Autosave continuo.  
4. **Diagrama** *o* **Fotos** — orden libre; ambas deben satisfacer hard para entregar.  
5. **Resumen estilo PDF** → Entregar → fullscreen firma (reglas + consentimiento) → `finalizeDelivery`.

### 1.2 Desktop (≥ ~900px)

- Misma data y gates.  
- UI: **scroll continuo** con chips sticky.  
- Diagrama: **hover** región → preview cuadrado de la foto de esa zona.  
- Misma pantalla de resumen/firma.

### 1.3 Regla de oro autosave

Desde que existe la papeleta, **cada cambio de sección se persiste**. No hace falta terminar todas las secciones. Salir / apagar / cambiar de ruta no pierde datos (Firestore + `revision`).

---

## 2. Fotos, cámara guiada y diagrama

### 2.1 Core hard (7)

| # | Zona | Notas |
|---|------|--------|
| 1 | Frontal | |
| 2 | Parabrisas | |
| 3 | Lateral izquierdo | |
| 4 | Lateral derecho | |
| 5 | Defensa trasera | |
| 6 | Interior | |
| 7 | Herramienta | Cámara guiada ofrece **+ refacción** (2ª foto / slot extra) |

**Tablero** — obligatorio; capturado en pantalla KM; reutilizado en set de fotos; **hard** pero fuera del contador “7/7 core”.

### 2.2 Opcionales (solo daño)

- 4 llantas  
- Daño específico (fascia, parabrisas copiloto, etc.) ligado a marca / zona  

### 2.3 Cámara guiada — requisitos de producto

1. **Landscape estable** — no romper layout al rotar.  
2. **Tras captura** (cámara o galería) — transición a siguiente **inmediata** (sin demora percibida).  
3. **Navegación por chips/grid** — tap en la zona deseada; **prohibido** obligar a “Saltar… Saltar…”.  
4. Al completar las **7 hard** (+ tablero si aún falta): sheet  
   - **Daño específico** → captura foto de daño  
   - **Continuar** → cierra cámara y vuelve al flujo  

### 2.4 Diagrama fullscreen

- Stage a **pantalla completa** (sin scroll para ver el auto).  
- **Zoom + pan** cuando la herramienta **no** es lápiz.  
- **Solo con lápiz activo** se dibuja; soltar lápiz → otra vez pan/zoom.  
- Modo marca: tap = daño tipado (sheet tipo/severidad).  
- Desktop: hover zona → preview foto.

### 2.5 Anotación fullscreen de fotos (v1)

- Preview fullscreen de cualquier foto.  
- Editar: lápiz + marcas tipadas (mismos tipos/severidad que diagrama).  
- Overlay persistido ligado a esa foto.  
- Retomar foto sigue disponible.

---

## 3. PDF, resumen, firma y side-effects

### 3.1 Composición PDF

1. Top — info (unidad, cliente/contrato, KM/gas, plaza, meta).  
2. Centro — **diagrama grande**.  
3. Checklist **2 columnas**; **tapetes rudo + alfombra** dentro del checklist.  
4. Fotos a página completa.  
5. Firma cliente + fecha **grandes**.  

Cumple export-signing (firma interna + nombre archivo `USUARIO_FECHA_EMPRESA`).

### 3.2 Resumen pre-firma

Espejo visual del PDF. CTA Entregar → fullscreen firma con:

- Reglas rápidas (suciedad / olor cigarro = cobro, etc.)  
- Consentimiento: *“Recibo la unidad con las características especificadas en este documento y acepto.”*  
- Confirmar → `finalizeDelivery` (idempotente).

### 3.3 Side-effects al confirmar (automáticos)

1. `status → entregada`; salida locked; PDF.  
2. Unidad **eliminada / fuera de cuadre**.  
3. Estado/ubicación → **RENTADA** o **ARRENDADA** según vocabulario flota / `tipoNegocio`.  
4. Sellos: uid, nombre, plaza del lugar, fecha local + serverTimestamp.

### 3.4 Post-entrega

Salida inmutable. Cliente/contrato asignables. Regreso y reportes de daño = módulos aparte.

---

## 4. Dominio (ampliaciones)

### 4.1 Gates `puedeEntregar`

**Hard:** `km`, `gas`, `checklist` (incl. llantas + tapetes 0–9), `core_photos` (7), `tablero_photo`, `firma`, `pending_writes`, `km_justification` si aplica.

**Soft:** `cliente` (si no hay cliente/contrato/signer), faltantes, damage photos opcionales, etc.

### 4.2 Tapetes

- Un dígito **0–9** por campo (usoRudo, alfombra).  
- **0 = no tiene**.  
- Solo input numérico; máximo 1 carácter.

### 4.3 Scope global

Sin cambio vs §0A hoja+lápiz: empresa-global; `plazaId` = procedencia.

### 4.4 Correcciones unidad

Campos hero editables solo con patch a documento papeleta (`correccionesSoloPapeleta` / campos snapshot). No escribir master Unidades.

---

## 5. Archivos principales

| Área | Archivos |
|------|----------|
| Domain | `domain/papeleta.model.js` |
| Data | `js/app/features/papeletas/papeletas-data.js`, integración cuadre/unidades en finalize |
| Vista | `js/app/views/papeletas.js` (+ split recomendado: capture-mobile, capture-desktop) |
| Cámara | `js/app/features/papeletas/papeletas-camera.js` |
| Diagrama | `js/app/features/papeletas/papeletas-diagram.js` |
| PDF | `js/app/features/papeletas/papeletas-pdf.js` |
| CSS | `css/app-papeletas.css` |
| Lookup | `unidades-lookup.js` / `unidades-data.js` (imagen modelo) |

---

## 6. Fases (B)

| Fase | Entrega | Criterio done |
|------|----------|---------------|
| **1** | Domain + finalize side-effects | Gates 7+tablero; tapetes 0–9; RENTADA+cuadre en TX/post |
| **2** | UI híbrida + hero imagen modelo | Móvil stack; desktop scroll; correcciones locales |
| **3** | Cámara guiada | Landscape OK; chips jump; post-7 sheet; captura rápida |
| **4** | Diagrama fullscreen | Zoom/pan; lápiz solo on; hover desktop |
| **5** | PDF + resumen/firma | Layout nuevo; consentimiento; export-signing |
| **6** | Anotación fotos | Overlay persistido; retomar |

Cada fase: `node scripts/bump-sw.js` + commit + push; smoke patio.

---

## 7. Non-goals (esta oleada)

- CRM contrato SIPP completo  
- WhatsApp/correo automático del PDF  
- Reabrir salida post-entregada  
- Particionar papeletas por plaza  
- Escribir correcciones a master Unidades  

---

## 8. Self-review

- [x] Sin TBD críticos  
- [x] Consistente con decisiones A–C brainstorming  
- [x] Scope por fases (no un mega-PR)  
- [x] Hard/soft y side-effects explícitos  
- [x] Hero = imagen modelo + overlay datos  
