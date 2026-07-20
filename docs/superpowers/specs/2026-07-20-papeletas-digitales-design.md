# Diseño: Papeletas digitales (beta)

> **Fecha:** 2026-07-20  
> **Estado:** Draft para revisión de usuario  
> **Enfoque aprobado:** Papeleta por pasos (wizard por zonas)  
> **Alcance:** Beta operativa en SPA (`/app/papeletas`) — PDF imprimible; WhatsApp/correo después (mismo PDF)

---

## 1. Objetivo

Reemplazar la papeleta física de entrega/recepción de unidad por un expediente digital:

- Diagrama tocable del vehículo (carrocería, cristales, llantas).
- Checklist de accesorios/equipo.
- Datos de unidad, entrega y recepción.
- Fotos por zona (obligatorias en salida).
- Firma del cliente al entregar.
- Copia PDF para el cliente.
- Flujo de entrada con comparación y reporte de daño/faltante a Ventas.

**No es meta de la beta:** contrato/CRM completo, WhatsApp/correo automáticos, lápiz libre sobre el diagrama (híbrido v2), integración fuerte con cola de preparación.

---

## 2. Decisiones bloqueadas

| Tema | Decisión |
|------|----------|
| Módulo | Apartado fijo **PAPELETAS** en la app (independiente de cola de preparación) |
| Momento de creación | Libre: desde lavado o cuando el patio quiera |
| Unicidad | **1 papeleta activa por unidad**; se puede editar, no duplicar |
| Datos unidad | Auto-relleno desde flota/cuadre (MVA, modelo, placas, color, km, gas…); el auxiliar corrige si hace falta |
| Checklist | Revisión manual del auxiliar |
| Daños (beta) | **Tocar zona** + nota muy corta; círculo aprox. en la foto o foto detalle |
| Fotos salida | **Obligatorias en todas las zonas** (prueba de estado, con o sin daño) |
| Fotos placas/VIN | Solo en **reporte de daño nuevo** al regreso |
| Entrega | Puede preparar otra persona; al entregar: botón → firma cliente → PDF → **bloquea edición**. Estado mínimo: `lista`. Sin `clienteNombre`: se permite entregar con aviso fuerte (no bloquea). |
| Cliente | Ventas asigna **nombre** (beta); se muestra en entrega/firma (“ENTREGAR A …”) |
| Entrada | Buscar papeleta de salida → Registrar entrada / Reportar daño o faltante |
| Daño ya marcado | Si el daño ya estaba en salida, el reporte de “nuevo” se **descarta** |
| Liberar unidad | Al **registrar entrada** se puede crear nueva papeleta |
| Caso Ventas abierto | No bloquea nueva papeleta; aviso **C** a auxiliares |
| Cierre global caso | Solo roles **superiores a VENTAS** (Supervisor+) |
| Historial | Salida + entrada siempre se conservan como papelería |
| Copia cliente (beta) | **PDF** descargable/imprimible; futuro: WhatsApp + correo con el mismo PDF |
| Velocidad | UI pensada para rush: pasos cortos, sin fricción innecesaria |

---

## 3. Roles y permisos (beta)

| Acción | Quién |
|--------|--------|
| Crear / editar (mientras no entregada) / entregar / registrar entrada | Cualquier usuario autenticado con acceso al módulo |
| Asignar nombre de cliente | Ventas y superiores (y quien tenga permiso de papeletas ventas) |
| Ver bandeja de reportes de daño/faltante | Ventas y superiores |
| Cerrar caso global (contrato/papeleta en Ventas) | Roles **> VENTAS** (Supervisor, Jefe patio, Gerente, …, Programador) |
| Ver historial / PDF | Quien pueda ver el módulo |

Permisos (nombres definitivos para implementación):

- `view_papeletas` — ver módulo, crear/editar/entregar/entrada.
- `manage_papeletas_ventas` — bandeja Ventas + asignar cliente.
- Cierre de caso: `mexPerms` / rol **> VENTAS** (misma jerarquía del proyecto).
- Programador / bypass corporativo: acceso total.

Feature gate: `papeletas` (plan regional+ o flag en empresa; Programador siempre).

---

## 4. Ciclo de vida (estados)

```
borrador ──► lista ──► entregada ──► en_retorno ──► cerrada_historial
                │              │            │
                │              │            └── (opcional) caso_ventas_abierto
                │              └── BLOQUEADA edición
                └── aún editable
```

| Estado | Significado | Editable |
|--------|-------------|---------|
| `borrador` | Creada; faltan zonas/fotos/checklist | Sí |
| `lista` | Completa para entregar (todas las zonas con foto; checklist resuelto) | Sí |
| `entregada` | Firmada y entregada al cliente | **No** |
| `en_retorno` | Entrada registrada; `activoPorUnidad: false`; puede haber caso Ventas | No (sí alta de reporte) |
| `cerrada_historial` | Caso Ventas cerrado o sin pendientes; solo consulta | No |

**Regla de unicidad:** una unidad tiene a lo sumo **una** papeleta con `activoPorUnidad == true` (estados `{borrador, lista, entregada}`). Al **registrar entrada**, se setea `activoPorUnidad: false` y `status: en_retorno`; se permite crear otra papeleta aunque Ventas aún tenga caso abierto (banner de aviso). Reportes se pueden abrir mientras `status` es `entregada` o `en_retorno`.

---

## 5. Flujos

### 5.1 Salida (crear / editar)

1. Usuario abre **Papeletas** → “Nueva”.
2. Busca unidad (MVA / placas / modelo / VIN).
3. Si ya hay papeleta `activoPorUnidad` → abrir esa (error claro si intenta crear otra).
4. Sistema rellena: MVA, modelo, placas, color, km, gas, etc.
5. Recorrido por zonas (orden fijo, ver §6).
6. Por cada zona: foto obligatoria; si hay daño → marcar zona + círculo en foto o foto detalle + nota corta opcional (≤ 40 caracteres).
7. Checklist de accesorios (§7).
8. Guardar → `borrador`; si todas las zonas tienen foto y checklist completo → auto/`Marcar lista` → `lista`.
9. Ventas (cuando sepa) puede asignar `clienteNombre`.

### 5.2 Entregar

1. Solo desde estado `lista`.
2. Mostrar “ENTREGAR A {clienteNombre}”; si vacío → modal de confirmación “Sin cliente asignado — ¿continuar?”.
3. Botón **Entregar unidad** → captura: `entregadoPor`, `fechaHoraEntrega`, km/gas salida (snapshot).
4. Pantalla firma: canvas; label “{clienteNombre || 'Cliente'} — Firma”.
5. Subir firma; generar PDF; `status: entregada`; **bloquear edición**.
6. Ofrecer descargar/imprimir PDF (copia cliente).

### 5.3 Entrada (regreso)

1. Buscar papeleta por MVA/placas/modelo/VIN (estado `entregada`).
2. Ver datos, daños de salida, fotos (mini-ventana: “esta foto = zona X”).
3. **Registrar entrada:** quién recibe, km/gas entrada, notas → `en_retorno` + `activoPorUnidad: false`.
4. Si algo no cuadra: **Reportar daño** o **Reportar faltante** (gas, pieza, accesorio…).
5. Daño **nuevo** (zona no marcada en salida, o faltante de checklist):
   - Obligatorio: foto placas + foto VIN + fotos del daño/faltante.
   - Envío inmediato a bandeja Ventas (`status: abierto`).
6. Si el daño ya existía en salida → `status: descartado` al instante (toast “Ya documentado en salida”).

### 5.4 Ventas

1. Bandeja: reportes `abierto` (daño/faltante) con enlace a papeleta.
2. Ver fotos; **promover** evidencias al path permanente de Ventas (move/copy-then-delete del path temporal).
3. Fotos del reporte auxiliar: TTL **24 h** si no se promueven (`expiresAt`); job CF elimina Storage + marca expirado.
4. Cerrar caso (solo Supervisor+): reporte `cerrado` y, si aplica, papeleta `cerrada_historial`.

---

## 6. Diagrama y zonas (orden de recorrido)

Imagen base: esquema multi-vista (referencia del usuario). En UI beta: **pasos ordenados** + diagrama tocable por vista.

**Plantilla beta `zonasTemplateVersion: 1`** (orden fijo; UI muestra “1/N”):

| orden | id | label | vista |
|------:|----|-------|-------|
| 1 | `trasera_cajuela` | Trasera / cajuela | rear |
| 2 | `lateral_der` | Lateral derecho | right |
| 3 | `cristal_der` | Cristal derecho | right |
| 4 | `llanta_del_der` | Llanta delantera derecha | right |
| 5 | `llanta_tras_der` | Llanta trasera derecha | right |
| 6 | `lateral_izq` | Lateral izquierdo | left |
| 7 | `cristal_izq` | Cristal izquierdo | left |
| 8 | `llanta_del_izq` | Llanta delantera izquierda | left |
| 9 | `llanta_tras_izq` | Llanta trasera izquierda | left |
| 10 | `frente_defensa` | Frente / defensa | front |
| 11 | `parabrisas` | Parabrisas | front |
| 12 | `cofre` | Cofre | front |

Cada zona: `requiereFoto: true`. Ajustes finos de la lista se hacen en plan si el diagrama de referencia exige más/menos nodos, sin cambiar la regla “foto en todas”.

**Interacción daño (beta):**

- Tap zona → `ok` | `dano`.
- Si `dano`: nota ≤ 40 caracteres; en la foto, overlay de **círculo** (`x,y,r` normalizados 0..1) **o** segunda foto `fotoDetallePath`.

**Futuro (fuera de beta):** lápiz libre híbrido.

---

## 7. Checklist (salida)

Ítems booleanos (presente / faltante / N/A si aplica):

- Tapetes  
- Placas  
- Catalizador  
- Tapón de gas  
- Gato  
- Herramienta  
- Dado de seguridad  
- Refacción  
- Mofle  
- Antena  
- Limpiaparabrisas  
- Aire acondicionado  

Faltante en entrada (si en salida estaba OK) → puede generar **Reportar faltante** a Ventas.

---

## 8. Campos de datos

### Unidad (auto + editables)

- MVA, MODELO, PLACAS, COLOR  
- (VIN si existe en unidad — útil para búsqueda y reportes)

### Salida

- QUIEN ENTREGA (sistema al pulsar Entregar; editable override opcional)  
- KM SALIDA, GAS SALIDA (snapshot al entregar; prefill desde unidad)  
- FIRMA CLIENTE (dataURL / Storage)  
- FECHA ENTREGA (sistema)  
- clienteNombre (Ventas)

### Entrada

- QUIEN RECIBE  
- KM ENTRADA, GAS ENTRADA  
- FECHA ENTRADA (sistema)  
- NOTAS  

### Meta

- plazaId, creadoPor, actualizadoPor, timestamps  
- status, pdfUrl (opcional cache), casoVentasId  

---

## 9. Modelo de datos (Firestore — propuesta)

Colección: `papeletas/{papeletaId}`

```text
unidadId, mva, modelo, placas, color, vin
plazaId
status: borrador|lista|entregada|en_retorno|cerrada_historial
clienteNombre
checklist: { tapetes: 'ok'|'faltante'|'na', ... }
zonas: {
  [zonaId]: {
    estado: 'ok'|'dano',
    nota: string,
    fotoPath: string,
    fotoDetallePath?: string,
    circulo?: { x: 0..1, y: 0..1, r: 0..1 }
  }
}
salida: { quienEntrega, km, gas, firmadoAt, firmaPath, entregadoPorUid }
entrada: { quienRecibe, km, gas, registradoAt, registradoPorUid, notas }
activoPorUnidad: true  // índice / query para unicidad
```

Subcolección o colección hermana: `papeletas_reportes/{id}`

```text
papeletaId, unidadId, tipo: 'dano'|'faltante'
zonasNuevas[], itemsFaltantes[]
fotos: { placas, vin, danos[] }
status: abierto|descartado|promovido|cerrado
creadoAt, expiresAt (+24h si no promovido)
promovidoAPath?  // cuando Ventas mueve evidencias
```

Storage:

- `papeletas/{papeletaId}/zonas/{zonaId}.jpg`  
- `papeletas/{papeletaId}/firma.png`  
- `papeletas_reportes/{reporteId}/*` (TTL lógico 24h + job/Cloud Function de limpieza)  
- `papeletas_ventas/{casoId}/*` (permanente al promover)

Índices: `plazaId + status`, `mva`, `placas`, `activoPorUnidad + unidadId` (unicidad activa).

---

## 10. UI SPA (beta)

Ruta: `/app/papeletas` (+ detalle `/app/papeletas/:id`).

**Lista:**

- Buscador (MVA, placas, modelo, VIN, cliente).
- Filtros: activas / entregadas / historial / con caso Ventas.
- Card: MVA, modelo, status chip, cliente, plaza.

**Detalle / wizard:**

1. Datos unidad  
2. Zonas (paso a paso + progreso “8/12 fotos”)  
3. Checklist  
4. Resumen → Entregar / Registrar entrada  

**Ventas:** tab o ruta `/app/papeletas/ventas` — bandeja de reportes.

**PDF:** plantilla A4/carta con diagrama (zonas marcadas), checklist, datos, firma, sello “Exportado por…” según política de firma del proyecto; nombre de archivo `USUARIO_FECHA_EMPRESA.pdf`.

Estilo: ESTILO.md / tokens admin-ops (Inter, Material Symbols, sin UI genérica).

---

## 11. Arquitectura en mex-mapa

- Vista SPA: `js/app/views/papeletas.js` (+ features en `js/app/features/papeletas/`).
- Router + `route-resolver` + item en `navigation.config.js` (“Papeletas”).
- CSS: `css/app-papeletas.css`.
- API: módulos en `api/` o features con `database.js` / Firestore directo.
- PDF: cliente (html2canvas/jspdf o plantilla existente del repo).
- Limpieza 24h: Cloud Function programada `limpiarFotosReportesPapeletas`.

No depende de cola-preparación; puede leer unidad desde la misma fuente que cuadre/mapa.

---

## 12. Alcance beta vs después

### Beta (debe)

- CRUD papeleta + unicidad activa  
- Wizard zonas + fotos obligatorias + checklist  
- Entregar + firma + PDF  
- Entrada + reporte daño/faltante nuevo → Ventas  
- Aviso caso Ventas abierto  
- Asignar nombre cliente  
- Cierre caso (Supervisor+)  

### Después

- WhatsApp / correo con PDF  
- Diagrama híbrido (lápiz)  
- Cliente/contrato real (no solo nombre)  
- Comparador visual lado a lado salida vs entrada  
- Plantillas de diagrama por tipo de unidad (SUV vs sedan)  

---

## 13. Criterios de aceptación (beta)

1. No se pueden crear dos papeletas activas para la misma unidad.  
2. Tras **Entregar**, ningún campo de salida/zonas/checklist es editable.  
3. No se puede marcar `lista`/`entregada` sin foto en todas las zonas.  
4. PDF se genera y descarga al entregar; incluye firma y datos.  
5. Entrada libera creación de nueva papeleta; la anterior queda consultable.  
6. Reporte de daño ya existente en salida no crea caso Ventas.  
7. Reporte nuevo exige placas + VIN + fotos daño y aparece en bandeja Ventas.  
8. Auxiliar ve aviso si hay caso Ventas abierto al crear nueva.  
9. Solo roles > VENTAS cierran caso global.  

---

## 14. Errores y edge cases

| Caso | Comportamiento |
|------|----------------|
| Crear 2ª papeleta activa | Rechazo + abrir la existente |
| Entregar sin todas las fotos | Botón deshabilitado / error; no pasa a `lista` |
| Fallo subida foto | Reintento; zona queda incompleta |
| Fallo firma / PDF | No marcar `entregada` hasta firma persistida; PDF se puede regenerar |
| Offline parcial | Fuera de beta; mensaje “se requiere conexión” |
| Unidad sin MVA/placas | Permitir crear con warning; búsqueda degradada |

## 15. Pruebas (beta)

- Manual: smoke crear → 12 fotos → checklist → entregar → PDF → entrada → reporte nuevo → bandeja Ventas → cerrar (Supervisor).
- Manual: daño ya en salida → reporte descartado.
- Manual: caso Ventas abierto + nueva papeleta → banner.
- Reglas Firestore/Storage: auxiliar no escribe path Ventas permanente; no edita papeleta `entregada`.
- Playwright opcional: mount ruta `/app/papeletas` autenticado (smoke navigation).

## 16. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Rush + muchas fotos | Cámara a pantalla completa, JPEG comprimido, progreso “n/12” |
| Esquema de zonas incorrecto | `zonasTemplateVersion: 1` fijo; v2 sin romper historial |
| Storage lleno | TTL 24h + compresión + max ~800KB/foto |
| Disputa de edición | Inmutable post-entrega + PDF con fecha/usuario/empresa |

## 17. Fases de implementación (para el plan)

Una sola feature, plan en 3 entregas:

1. **Salida:** lista, wizard, unicidad, checklist, estados hasta `entregada` + firma + PDF.  
2. **Entrada:** registro, liberar unidad, UI comparación/fotos.  
3. **Ventas:** reportes, TTL/promoción, cierre Supervisor+, aviso caso abierto.

## 18. Resumen ejecutivo

Papeletas es un expediente digital por unidad: se prepara cuando el patio pueda, se entrega con firma y PDF, se recibe comparando contra la salida, y Ventas solo interviene en daños/faltantes **nuevos**. Una activa por unidad; historial permanente; velocidad de operación primero.
