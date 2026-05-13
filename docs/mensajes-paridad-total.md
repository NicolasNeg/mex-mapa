# Mensajes — Matriz de Paridad Total

> Legacy `/mensajes` (mapa.js) → App Shell `/app/mensajes`

## Arquitectura de archivos

| Módulo | Ruta | Descripción |
|--------|------|-------------|
| Vista principal | `js/app/views/mensajes.js` | Controller: mount/unmount, eventos, estado |
| Data layer | `js/app/features/mensajes/mensajes-data.js` | Firestore RT, identidad canónica, conversaciones |
| Attachments | `js/app/features/mensajes/mensajes-attachments.js` | Audio, validación, icons, linkify |
| Renderer | `js/app/features/mensajes/mensajes-renderer.js` | HTML generators (layout, bubbles, contacts) |
| CSS | `css/app-mensajes.css` | Estilos scoped `.am-*` |

## Matriz de funciones

| # | Función Legacy | Status | Notas |
|---|---------------|--------|-------|
| 1 | Lista de contactos con avatar, nombre, snippet, hora | ✅ | `renderContactItem()` |
| 2 | Búsqueda por nombre/correo | ✅ | `#amSearch` con filtrado en tiempo real |
| 3 | Filtro por plaza | ✅ | `#amFilterPlaza` con metadata hidratada |
| 4 | Filtro por rol | ✅ | `#amFilterRol` |
| 5 | Filtro por status (no leídos, activos) | ✅ | `#amFilterStatus` |
| 6 | Chat en tiempo real (Firestore onSnapshot) | ✅ | `startRealtimeListener()` con multi-identity |
| 7 | Identidad canónica por email | ✅ | `getCanonicalMessageIdentity()` — sin duplicados |
| 8 | Enviar mensaje de texto | ✅ | `enviarMensajePrivado()` vía data layer |
| 9 | Enviar archivo adjunto (imagen/PDF/doc) | ✅ | `uploadChatFile()` → Firebase Storage |
| 10 | Grabar y enviar audio | ✅ | `toggleRecording()` con espectro visual |
| 11 | Preview de audio antes de enviar | ✅ | Staging area con `<audio controls>` |
| 12 | Preview de archivo antes de enviar | ✅ | Staging chip con thumbnail |
| 13 | Responder a mensajes (reply) | ✅ | `_startReply()` con quote context |
| 14 | Editar mensajes propios | ✅ | `editarMensajeChatDb()` |
| 15 | Eliminar mensajes propios | ✅ | `eliminarMensajeChatDb()` con confirmación |
| 16 | Reacciones emoji | ✅ | `_toggleReaction()` + emoji panel |
| 17 | Marcar como leído automático | ✅ | `marcarMensajesLeidosArray()` al abrir chat |
| 18 | Badge de no leídos en contacto | ✅ | `.am-unread-badge` |
| 19 | Archivar conversación | ✅ | localStorage con `saveArchived()` |
| 20 | Restaurar conversación archivada | ✅ | Toggle en vista archivados |
| 21 | Ver info de contacto (modal) | ✅ | `_showPeerInfo()` con metadata |
| 22 | Lightbox para imágenes | ✅ | `#amLightbox` fullscreen overlay |
| 23 | Visualización de documentos adjuntos | ✅ | Card con icono por extensión + download |
| 24 | Audio playback inline | ✅ | `<audio controls>` en burbujas |
| 25 | Links clickeables en mensajes | ✅ | `linkifyText()` |
| 26 | Estado vacío (sin mensajes) | ✅ | Empty state con CTA |
| 27 | Nuevo mensaje a usuario sin conversación | ✅ | `_openNewChat()` con prompt |
| 28 | Indicadores de lectura (✓ / ✓✓) | ✅ | `done` / `done_all` icons |
| 29 | Layout mobile responsivo (slide panel) | ✅ | `.am-chat.open` con transform |
| 30 | Espectro de frecuencia en grabación | ✅ | Canvas con `_drawSpectrum()` |

## Enrutamiento

- `/mensajes` → redirige automáticamente a `/app/mensajes` (legacy-shell-bridge.js)
- `/mensajes?legacy=1` → mantiene vista clásica como fallback
- `/app/mensajes` → vista completa App Shell

## Identidad canónica

```
getCanonicalMessageIdentity(raw, email)
→ { key: "EMAIL:user@email.com", email, label, raw }
→ { key: "LEGACY:NOMBRE", email: "", label, raw }
```

Todas las conversaciones se agrupan por `key`, evitando duplicados cuando un usuario cambia de nombre pero mantiene el mismo correo.

## Ciclo de vida

- `mount()` → inicia listeners Firestore, renderiza layout
- `unmount()` → detiene listeners, limpia grabación, revoca URLs
- Los listeners se cancelan correctamente para evitar memory leaks
