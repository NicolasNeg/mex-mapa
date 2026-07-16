# Plan maestro: MapGestion como sistema operativo de arrendadora

> **Fecha:** 2026-07-15  
> **Estado:** visión largo plazo (1+ año) — **NO es el backlog actual**  
> **Backlog actual (complemento TSD / patio):**  
> [`docs/superpowers/plans/2026-07-15-complemento-tsd-operacion-flota.md`](./2026-07-15-complemento-tsd-operacion-flota.md)  
> **Tipo:** roadmap de producto + arquitectura  
> **Fuente:** briefing Codex + estado actual mex-mapa  
> **Posicionamiento futuro:** *El sistema que conecta el mostrador con lo que realmente pasa en el patio*  
> **Posicionamiento hoy:** *Complemento operativo al RMS (TSD u otro): mapa, cuadre, estados, cola, turnos*

---

## 0. Resumen ejecutivo

MapGestion ya resuelve lo que la mayoría de RMS tradicionales hacen mal: **ejecución física** (mapa, cuadre, estados, cola, incidencias, turnos, bitácora).

Para ser un sistema completo de arrendadora hay que rodear esa operación con un **Rental Management System**, sin perder el diferencial operativo.

### Ciclo de negocio objetivo

```text
Venta/reservación → contrato → operación → entrega
  → renta activa → devolución → daños → cobro
  → reacondicionamiento → nueva renta
```

### No copiar TSD / Rent Centric / HQ

Usarlos como benchmark de dominio. La oportunidad de MapGestion es:

> **Arrendamiento que conecta mostrador ↔ patio en tiempo real.**

### Stack de decisión (importante)

El briefing Codex sugiere Next.js + Nest + Postgres/Supabase. **MapGestion hoy** es Firebase + App Shell SPA + Cloud Functions.

| Camino | Cuándo |
|--------|--------|
| **A — Evolución sobre Firebase (recomendado corto/medio plazo)** | MVP comercial, Fases 1–4 operativas; contratos/pagos vía Functions + colecciones |
| **B — Monolito modular híbrido** | Cuando el motor de tarifas/disponibilidad y contabilidad rebasen Firestore |
| **C — Reescritura Next/Nest** | Solo si B demuestra límites claros; no como prerrequisito |

Este plan asume **camino A**, con fronteras de módulo listas para B/C.

---

## 1. Qué ya tenemos vs qué falta

| Dominio | Hoy en mex-mapa | Gap |
|---------|-----------------|-----|
| Multi-tenant empresas/plazas | `empresas`, feature-gates, plazas | Marcas, aeropuertos, talleres como nodos de ubicación tipados |
| Roles | RBAC jerárquico (AUXILIAR→PROGRAMADOR) | Roles de mostrador/caja/daños + permisos por *acción* |
| Flota / mapa / cuadre | Mapa, cuadre, `index_unidades` | Ficha financiera, documentos, ACRISS |
| Estados | **Flota + patio** (2026-07-15) | Faltan **comercial** + **custodia** (4 dimensiones) |
| Cola preparación | SPA + sync LISTO | Órdenes con subtareas/SLA/prioridad aeropuerto |
| Turnos / asistencia | Check-in + PENDIENTE confirmación | Integrar con preparación y mostrador |
| Incidencias / notas | Sí | Daños estructurados + comparación entrega/devolución |
| Reservaciones / tarifas | No | Motor completo |
| Contratos / firma / depósito | No | Entidad versionada + PROFECO MX |
| Pagos / CFDI | No | Pasarela + PAC |
| Disponibilidad | Conteo implícito | Motor con overlapping + buffer operativo |

---

## 2. Principio de estados: cuatro dimensiones (no un solo “estado”)

Extiende el diseño flota/patio ya implementado.

| Dimensión | Campo propuesto | Ejemplos | Quién lo mira |
|-----------|-----------------|----------|---------------|
| **Comercial** | `estadoComercial` | DISPONIBLE, RESERVADA, RENTADA, BLOQUEADA, FUERA_DE_FLOTA | Mostrador, disponibilidad, contratos |
| **Operativo (patio)** | `estadoPatio` | LISTO, SUCIO, LAVANDO, PREPARANDO, MANTENIMIENTO, INSPECCION | Patio, cola, mapa |
| **Custodia** | `custodia` | ARRENDADORA, CLIENTE, TALLER, ASEGURADORA, TRASLADISTA, CORRALON | Legal, multas, peajes |
| **Ubicación** | `plazaActual` + `ubicacion` + `pos` | Sucursal, patio, cajón, en tránsito, domicilio | Mapa, cuadre |

### Mapeo desde el modelo actual (2026-07-15)

| Hoy | Evoluciona a |
|-----|----------------|
| `estadoFlota` (ARRENDABLE, EN RENTA, TRASLADO…) | Subconjunto / alias de **comercial** (+ reglas) |
| `estado` en cuadre / `estadoPatio` | **Operativo** |
| `plazaActual`, `ubicacion`, `pos` | **Ubicación** |
| (nuevo) | **Custodia** |

### Ejemplo

- Comercial: `RESERVADA`  
- Operativo: `LAVANDO`  
- Custodia: `ARRENDADORA`  
- Ubicación: `BJX / PATIO / L-08`

Contratos futuros: filtrar por **comercial**, alertar por **operativo** (`precheckContratoUnidad` / `__mexPrecheckContrato`).

---

## 3. Visión modular (dominio)

```text
identity / organizations
customers / drivers
fleet (class + vehicle + docs)
availability
pricing
reservations / quotes
agreements (contratos versionados)
operations (MapGestion core: mapa, cola, movimientos)
inspections / damages / claims
maintenance
payments / deposits / billing (CFDI)
notifications / audit / reporting
integrations
```

### Eventos de dominio (contrato entre módulos)

```text
ReservationConfirmed
VehicleAssigned
PreparationRequested
VehicleReady
CustomerArrived
AgreementSigned
VehicleCheckedOut
RentalExtended
VehicleReplaced
VehicleReturned
DamageDetected
DepositCaptured
AgreementClosed
VehicleReleasedToOperations
```

**MapGestion (operations)** consume estos eventos → tareas, movimientos en mapa, alertas, cola.

---

## 4. Núcleo organizacional (Fase 1 base)

### 4.1 Tenant y ubicaciones

Por empresa (`empresas/{id}`):

- Marcas comerciales  
- Sucursales / aeropuertos / patios / talleres / lavado / puntos externos / almacenes  
- Moneda, impuestos, zona horaria por sucursal  
- Aislamiento estricto de datos (ya parcialmente con `empresaId` + rules)

### 4.2 Usuarios y permisos granulares

Roles de negocio (además del RBAC actual):

Director, Gerente regional/sucursal, Reservaciones, Mostrador, Cajero, Operador patio, Lavador, Preparador, Trasladista, Mecánico, Supervisor daños, Contabilidad, Auditor, Atención clientes.

Permisos a nivel acción (ejemplos):

- `contrato.crear`, `tarifa.editar`, `descuento.aplicar`, `deposito.omitir`  
- `unidad.cambiar`, `renta.cerrar_con_saldo`, `evidencia.eliminar`  
- `dano.liberar_unidad`, `reembolso.autorizar`, `km.editar`  
- `pii.ver`, `exportar`

Toda excepción guarda: usuario, fecha, motivo, valor anterior/nuevo, dispositivo, IP, sucursal → `audit` / `logs` / `bitacora_gestion`.

---

## 5. Catálogo maestro de flota

### 5.1 Clase / categoría (se vende la clase)

Campos: código interno, ACRISS, pax, puertas, equipaje, transmisión, combustible, A/C, edad mínima, depósito base, deducible, tarifa mínima, km incluidos, equivalentes, upgrades permitidos.

### 5.2 Unidad (expediente)

Ya hay base en Unidades/expediente. Completar:

| Bloque | Campos |
|--------|--------|
| ID | MVA, placas, VIN, motor, marca/modelo/versión/año/color, clase, propietario, financiadora |
| Docs | Circulación, póliza+vigencia, verificación, tenencia, factura, GPS/telemática |
| Operativo | Sucursal propietaria/actual, patio, pos, km, gas, llaves, accesorios, última limpieza/inspección, próxima renta |
| Financiero | Costo, valor contable, depreciación, gastos/ingresos, costo/km, utilidad, fecha venta objetivo |

---

## 6. Motor de disponibilidad

**No** es `flota - rentados`.

Considerar: overlapping de reservas/contratos, extensiones, tardanzas, mantto, daños, bloqueos, traslados, tiempo lavado/prep, one-way, buffers, overbooking permitido, altas/bajas programadas.

```text
Flota utilizable
- contratos activos
- reservaciones confirmadas
- bloqueos operativos
- mantenimiento
- colchón de seguridad
+ devoluciones confiables antes de la entrega
= disponibilidad vendible
```

Flujo estándar:

1. Reserva **categoría**  
2. Garantiza inventario de clase  
3. Asigna unidad cerca de entrega  
4. Operaciones prepara  
5. Sustitución / upgrade si falla  

Asignación **atómica** (transacción / bloqueo temporal) para evitar doble asignación.

---

## 7. Cotizaciones y reservaciones

### Cotización

Snapshot inmutable: fechas/horas, sucursales, categoría, tarifa, protecciones, extras, impuestos, descuento, depósito, km, combustible, moneda, vigencia, agente, canal.

### Estados de reservación

```text
BORRADOR → COTIZADA → PENDIENTE_DE_PAGO → PENDIENTE_DE_DOCUMENTOS
→ CONFIRMADA → EN_ESPERA → UNIDAD_ASIGNADA → EN_PREPARACION
→ LISTA_PARA_ENTREGA → CLIENTE_PRESENTE → CONVERTIDA_A_CONTRATO
| NO_SHOW | CANCELADA | VENCIDA
```

Canales: mostrador, teléfono, WhatsApp, web, app, empresa, agencia, OTA, broker, GDS, aseguradora.

---

## 8. Tarifas

Motor, no “precio diario” fijo. Tipos: hora, diaria, fin de semana, semanal, mensual, corporativa, promocional, temporada, last-minute, etc.

Dependencias: sucursal, categoría, fechas, duración, ocupación, canal, cliente, forma de pago, one-way.

Extras: conductor adicional/joven, baby seat, GPS, domicilio, aeropuerto, combustible, km extra, limpieza, llaves, frontera, etc.

**Regla:** al confirmar, **snapshot de tarifa**; cambios posteriores = ajuste versionado.

---

## 9. Clientes vs conductores

Separar:

- **Cliente** (persona o empresa que paga)  
- **Conductor(es)** (licencia, fotos, restricciones)  
- **Cuenta corporativa** (RFC, crédito, centros de costo, tarifas negociadas)

Perfil de riesgo configurable → alertas + autorización, no blacklist automática ciega.

---

## 10. Contratos (entidad, no solo PDF)

Estados: BORRADOR → … → ACTIVO → EN_DEVOLUCION → CERRADO / CERRADO_CON_SALDO / EN_DISPUTA / CANCELADO.

Contenido estructurado + **versionado** (extensión/reemplazo = nueva versión/anexo, nunca overwrite de firmado).

### México (PROFECO / adhesión)

- Cada empresa carga **su** contrato de adhesión registrado.  
- Número de registro visible.  
- Firma electrónica, conservación y envío.  
- No usar un contrato genérico de MapGestion como único modelo.

---

## 11. Depósitos y pagos

Separar: renta, depósito, preautorización, captura, saldo, reembolso, ajuste, penalización, chargeback.

Flujo tarjeta vía pasarela (tokenización); **nunca** CVV/PAN completo sin PCI.

Métodos: efectivo, tarjeta, transferencia, liga, crédito corporativo, split billing.

---

## 12. Operaciones (ventaja MapGestion)

### Orden de preparación (evolución de cola)

Entrada desde `PreparationRequested` / reserva próxima.

Subtareas: LOCALIZAR, MOVER, LAVAR, LIMPIAR, COMBUSTIBLE, NIVELES, LLANTAS, ACCESORIOS, INSPECCIONAR, FOTOGRAFIAR, LIBERAR, POSICIONAR.

Cada una: SLA, responsable, timestamps, evidencia, bloqueo, incidencia.

Prioridad ≠ solo FIFO: hora entrega, cliente presente, aeropuerto, VIP, corporativo, zona, duración prep, sustitutos.

### Check-out / check-in

Flujos móviles guiados + evidencia con metadata (servidor, usuario, dispositivo, hash, geo opcional).

Custodia pasa a CLIENTE → unidad sale del mapa de patio → renta activa.

Devolución: puede ser `VEHÍCULO_RECIBIDO` + `CONTRATO_PENDIENTE_DE_CIERRE`.

### Daños / siniestros / mantto / multas / peajes / combustible

Según briefing Codex §§14–16; daños con comparación lado a lado entrega vs devolución; multas resuelven contrato por **custodia en timestamp**.

---

## 13. Facturación MX

Integrar **PAC** para CFDI (UUID, XML, PDF, estado SAT, uso CFDI, etc.). MapGestion produce asientos/export; no reemplaza ERP de golpe.

---

## 14. MVP comercial correcto (no reemplazar TSD día 1)

Producto vendible inicial:

1. Flota + sucursales  
2. Ubicación visual  
3. Estados (4 dimensiones, mínimo comercial+operativo+ubicación)  
4. Reservaciones capturadas o importadas  
5. Asignación de unidad  
6. Cola / orden de preparación  
7. Inspección con evidencia  
8. Entrega  
9. Devolución  
10. Daños  
11. Historial + auditoría  
12. KPIs de tiempos  

Integrable con el admin/contratos que ya use la arrendadora. Después: tarifas nativas, clientes, contratos, cobros, CFDI.

### Pitch

> **Sistema operativo de la arrendadora:** conecta la reservación con el patio, coordina la preparación, acelera la entrega y conserva evidencia en todo el ciclo.

---

## 15. Orden de desarrollo (fases)

### Fase 0 — Definición de dominio (antes de más código grande)

- [ ] Entrevistas: mostrador, patio, caja, taller, gerencia  
- [ ] Diccionario de estados 4D + excepciones  
- [ ] Matriz de permisos por acción  
- [ ] Catálogo de eventos de dominio  
- [ ] Revisar contrato adhesión con abogado  
- [ ] Elegir pasarela + PAC (aunque se integren después)  
- [ ] Documentar procesos reales de 1–2 clientes piloto  

**Entregable:** `docs/superpowers/specs/YYYY-MM-DD-rental-domain-glossary.md`

### Fase 1 — Plataforma operativa sólida (evolución MapGestion)

- [ ] Completar 4D estados (comercial + custodia) sobre flota/patio actuales  
- [ ] Ubicaciones tipadas (aeropuerto, taller, lavado…)  
- [ ] Permisos granulares + auditoría de excepciones  
- [ ] Expediente unidad (docs + financiero básico)  
- [ ] Cola → órdenes de preparación con subtareas/SLA  
- [ ] Turnos ↔ preparación (quién está en turno)  
- [ ] KPIs operativos: tiempo prep, listos a tiempo, búsqueda  

**Base de código:** `js/app/features/*`, `domain/*`, `api/*`, rules, indexes.

### Fase 2 — Reservaciones + disponibilidad

- [ ] Customer / Driver / CompanyAccount  
- [ ] VehicleClass  
- [ ] Quote + Reservation + estados  
- [ ] Motor disponibilidad (v1: sin overbooking complejo)  
- [ ] Asignación atómica de unidad  
- [ ] Calendario por clase/sucursal  
- [ ] Evento `PreparationRequested` → cola  

### Fase 3 — Contratos y entrega

- [ ] RentalAgreement + versions  
- [ ] Depósito / pago mínimo (1 pasarela)  
- [ ] Firma + PDF plantilla por empresa (PROFECO-ready)  
- [ ] Inspección salida  
- [ ] Check-out → custodia CLIENTE, sale de mapa  
- [ ] Extensiones + reemplazos (cadena de unidades)  

### Fase 4 — Devolución

- [ ] Check-in + inspección comparativa  
- [ ] Cargos de devolución  
- [ ] Cierre / saldo  
- [ ] Reacondicionamiento → cola  
- [ ] Facturación básica o export  

### Fase 5 — Posrenta

- [ ] Daños / siniestros  
- [ ] Multas / peajes  
- [ ] Mantenimiento + bloqueo comercial  
- [ ] CxC / casos CRM  

### Fase 6 — Escalamiento

- [ ] Portal cliente / corporativo  
- [ ] Booking engine / WhatsApp  
- [ ] OTA/brokers  
- [ ] Telemática  
- [ ] Revenue management  

---

## 16. Modelo de datos mínimo (entidades)

```text
Organization, Branch, Location, ParkingSpace
User, Role, Permission
Customer, CompanyAccount, Driver, DriverLicense, IdentityDocument, CustomerFlag
VehicleClass, Vehicle, VehicleDocument
VehicleStatusEvent, VehicleLocationEvent, OdometerReading, FuelReading, Accessory
RatePlan, RateRule, Season, Quote, Reservation, ReservationItem
VehicleAssignment, AvailabilityBlock
RentalAgreement, AgreementVersion, AgreementExtension, VehicleReplacement, Signature
Inspection, InspectionItem, Damage, DamageMedia, Incident, InsuranceClaim
PreparationOrder, OperationalTask, Movement, Shift, Reconciliation
Charge, SecurityDeposit, Payment, Refund, PaymentAllocation, Invoice, CreditNote
MaintenanceOrder, RepairOrder, Vendor, Part
Toll, Fine, CustomerCase, Notification, AuditLog, Webhook
```

Firestore: no un solo documento gigante `unidades` ni un solo `contratos` sin historial.

### Firestore (corto plazo) vs SQL (medio plazo)

| En Firestore ahora | Candidato a Postgres cuando crezca |
|--------------------|-------------------------------------|
| Operations, cola, mapa, turnos, audit light | Availability engine, pricing rules, accounting, heavy reporting |
| Reservations/agreements v1 (docs + subcolecciones) | Joins complejos, reportes financieros |

---

## 17. Arquitectura técnica (adaptada a mex-mapa)

### Corto plazo (Camino A)

- Frontend: App Shell actual (`/app/*`) + PWA  
- Datos: Firestore + Storage (evidencias)  
- Backend: Cloud Functions (cobros idempotentes, webhooks, CFDI, jobs)  
- Tiempo real: `onSnapshot` (ya)  
- PDF: función de generación  
- Observabilidad: `programmer_errors` + ampliar  

### Patrones obligatorios

- UUID / IDs estables  
- UTC storage + TZ por sucursal en UI  
- Historial de estados + soft delete  
- Auditoría inmutable  
- Idempotencia en pagos  
- Concurrencia (asignación unidad, depósitos)  
- Versionado documental  
- Permisos por tenant + plaza  
- Evidencias originales + hash  
- Outbox / eventos críticos  

### Cuando pasar a Camino B

Señales: queries de disponibilidad > timeout, tarifas con demasiadas reglas en cliente, CFDI/contabilidad que requiera SQL fuerte, multi-región.

---

## 18. Relación con planes ya existentes

| Plan actual | Encaje en este roadmap |
|-------------|------------------------|
| Estados flota vs patio | Fase 1 — base de 4D (comercial≈flota, operativo=patio) |
| Cola preparación | Fase 1→2 — evoluciona a `PreparationOrder` |
| Turnos potenciado | Fase 1 — staffing de subtareas |
| PLAN_MAESTRO App Shell | Continúa como shell del RMS |

---

## 19. Criterios de éxito por horizonte

### 90 días

- 4 dimensiones de estado visibles y sincronizadas  
- Cola con prioridad por hora de entrega  
- Precheck contrato (`warn`/`block`) usado en al menos un flujo  
- 1 cliente piloto importa o captura reservas → asigna → prepara  

### 6–12 meses (MVP comercial)

- Ciclo reserva → prep → entrega → devolución → daño con evidencia  
- KPIs de tiempo publicados en dashboard  
- Integración con sistema admin externo o contratos v1  

### 12–24 meses

- Pagos + CFDI + portal cliente  
- Disponibilidad robusta + tarifas nativas  

---

## 20. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Querer “ser TSD” de golpe | MVP operativo (§14); integrar, no reemplazar |
| Un solo campo `estado` otra vez | Spec 4D + gate en code review |
| Firestore como ERP | Functions + export; SQL cuando duela |
| PCI / datos tarjeta | Solo pasarela tokenizada |
| Contrato genérico ilegal MX | Plantilla por empresa + registro PROFECO |
| Doble asignación | Transacción / lease temporal |

---

## 21. Próximo paso inmediato (ejecutable)

1. **Aprobar este roadmap** (producto).  
2. Abrir **Fase 0** glossary + matriz permisos (doc, sin code grande).  
3. En paralelo código: **extender estados a comercial + custodia** (spec hija de flota/patio).  
4. Diseñar **PreparationOrder** como evolución de `cola_preparacion` (spec + plan de implementación separado, bite-sized).

No implementar Fases 2–6 en un solo PR. Cada fase = spec + plan + PRs verticales.

---

## 22. Referencias externas (benchmark)

- [MapGestión](https://mapgestion.com/) — posicionamiento patio  
- [TSD Rental](https://tsdweb.com/car-rental-software/) — RMS completo  
- [Rent Centric](https://www.rentcentric.com/products/car-rental-software/) — contactless / identidad  
- [HQ Rental API](https://api-docs.hqrentalsoftware.com/doc-866060) — extensiones, depósitos, daños  
- [PROFECO — rentar automóvil](https://www.gob.mx/profeco/documentos/lo-que-debes-saber-antes-de-rentar-un-automovil)  
- [PROFECO — contrato tipo](https://rcal.profeco.gob.mx/contratostipo/ARRENDAMIENTO%20DE%20VEHICULOS%20PROFECO.pdf)  
- [PCI DSS 4.0.1](https://blog.pcisecuritystandards.org/just-published-pci-dss-v4-0-1)  
- [SAT Art. 29-A](https://wwwmatnp.sat.gob.mx/articulo/99662/articulo-29-a)  

---

## Changelog

| Fecha | Nota |
|-------|------|
| 2026-07-15 | Primer consolidado Codex → MapGestion; alineado a Firebase/SPA y estados flota/patio ya en código |
