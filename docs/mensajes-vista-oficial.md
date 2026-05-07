# Mensajes vista oficial

Fecha: 2026-05-07 · FASE 15E

## Estado

- `/app/mensajes` = **OFICIAL_OPERATIVA**.
- `/mensajes` = **CLASSIC_FALLBACK**.
- Redirect `/mensajes -> /app/mensajes` = **ACTIVO**.
- Escape clásico: `localStorage["mex.legacy.force"] = "1"` o abrir `/mensajes?legacy=1`.

## Auditoría legacy

- UI legacy: `mensajes.html` con layout `chatv2-*`, panel de contactos, panel de chat, composer, búsqueda y filtros.
- Datos: colección `mensajes`.
- Campos reales auditados: `remitente`, `destinatario`, `mensaje`, `timestamp`, `fecha`, `leido`, `remitenteEmail`, `destinatarioEmail`, `remitenteNombre`, `destinatarioNombre`, `archivoUrl`, `archivoNombre`, `replyTo`.
- APIs seguras reutilizadas: `obtenerMensajesPrivados`, `enviarMensajePrivado`, `marcarMensajesLeidosArray`.
- APIs no migradas a App oficial: adjuntos Storage, edición, borrado, reacciones complejas.

## Funciones oficiales en `/app/mensajes`

- Header “Mensajes operativo”.
- Estado de última sincronización.
- Refrescar.
- Bandeja de conversaciones con avatar/inicial, nombre, email, último mensaje, fecha y badge no leído.
- Filtros por plaza, rol, no leídos, activos e inactivos.
- Búsqueda global del App Shell por nombre, email, texto, plaza, rol y fecha.
- Chat con bubbles diferenciadas mío/otro.
- Composer con validación de texto vacío y envío real.
- Marca leído al abrir conversación si la API está disponible.
- Refresh por intervalo controlado solo con pestaña visible.
- CTA a mensajes clásico.

## Identidad canónica

- La conversación se agrupa por email normalizado si existe `remitenteEmail` o `destinatarioEmail`.
- El nombre visible se usa solo para display.
- Si no hay email, se usa fallback legacy por nombre normalizado.
- Cambiar nombre no debe duplicar conversación si el email es igual.

## Funciones en mensajes clásico

- Adjuntos/subida.
- Edición de mensajes.
- Eliminación de mensajes o conversaciones.
- Reacciones complejas.
- Push/archivo avanzado.

## QA

- `/mensajes` debe abrir `/app/mensajes` si `mex.legacy.force` no está activo.
- `/mensajes?legacy=1` debe abrir clásico y activar escape.
- En clásico debe aparecer CTA “Estás en mensajes clásico · Abrir mensajes operativo”.
- Enviar texto vacío no debe ejecutar API.
- Al enviar con éxito, el composer se limpia.
- Al salir de la vista se limpian timer y listener de búsqueda global.
