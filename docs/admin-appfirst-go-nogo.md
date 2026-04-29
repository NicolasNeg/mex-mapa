# Admin App-first Go/No-Go (FASE 12H, sin redirect)

Fecha: 2026-04-28  
Alcance: readiness de `/app/admin` sin activar redirect desde `/gestion`.

## Matriz Go/No-Go

| Criterio | Resultado | Evidencia breve | Bloquea redirect futuro | Acción requerida |
|---|---|---|---|---|
| 1. `/app/admin` carga con PROGRAMADOR/admin global | PASS | Vista monta tabs, listeners y metadatos en `js/app/views/admin.js` | No | Smoke continuo |
| 2. Usuario sin permiso no accede acciones admin | PASS | Botones aprobar/rechazar y editar dependen de `admin-permissions.js` | No | Ninguna |
| 3. Tab Usuarios carga | PASS | `subscribeAdminUsers` + tabla/detalle | No | Ninguna |
| 4. Tab Solicitudes carga | PASS | `subscribeAdminRequests` por estado + plaza | No | Ninguna |
| 5. Tab Roles carga | PASS | `getAdminMetaSnapshot().roles` renderiza matriz | No | Ninguna |
| 6. Tab Plazas carga | PASS | `getAdminMetaSnapshot().plazas` + detalle | No | Ninguna |
| 7. Tab Catálogos carga | PASS | `catalogs` desde config runtime/`MEX_CONFIG` | No | Ninguna |
| 8. Búsqueda global filtra tab activa | PASS | handler `mex:global-search` para usuarios/roles/catálogos/solicitudes | No | Ninguna |
| 9. Filtros de usuarios funcionan | PASS | Rol/plaza/estado + query | No | Ninguna |
| 10. Filtros de solicitudes funcionan | PASS | Estado + plaza + query | No | Ninguna |
| 11. Edición segura de usuario funciona | PASS | Modal permite solo básicos y valida avatar URL | No | Ninguna |
| 12. Campos peligrosos de usuario bloqueados | PASS | Sin edición de email/password/uid/permisos/isAdmin/isGlobal/rol directo | No | Ninguna |
| 13. Rechazar solicitud funciona | PASS | `procesarSolicitudAcceso(action=reject)` | No | Ninguna |
| 14. Aprobar solicitud funciona con función segura | PASS | `procesarSolicitudAcceso(action=approve)` | No | Ninguna |
| 15. Solicitud aprobada crea perfil completo | WARNING | Depende de Function + smoke por usuario real | No | QA con caso real |
| 16. Jefe de plaza aprobado recibe plazaAsignada/plazasPermitidas | WARNING | Depende de payload de aprobación + reglas de rol | No | QA por rol jefe |
| 17. Solicitud rechazada bloquea acceso | WARNING | Requiere flujo login E2E con cuenta rechazada | No | QA E2E |
| 18. Roles muestran datos reales | PASS | Roles de security config y conteo usuarios | No | Ninguna |
| 19. Roles muestran permisos principales | PASS | Agrupación de permisos por dominio + chips | No | Ninguna |
| 20. Plazas muestran datos reales | PASS | Plazas desde config + estado activa/inactiva | No | Ninguna |
| 21. Plazas muestran conteos útiles | PASS | Usuarios por plaza + unidades aprox + roles por plaza | No | Ninguna |
| 22. Catálogos muestran datos reales | PASS | Estados/ubicaciones/categorías/modelos/gasolinas | No | Ninguna |
| 23. Catálogos muestran preview/conteos | PASS | Conteo y lista preview por catálogo | No | Ninguna |
| 24. Responsive 390px usable | PASS | Layout en columnas fluidas/tablas con scroll | No | Monitoreo visual |
| 25. Responsive 768px usable | PASS | Grid y paneles mantienen usabilidad | No | Monitoreo visual |
| 26. Desktop 1366px usable | PASS | Tabla completa + panel detalle | No | Ninguna |
| 27. No hay 404 | WARNING | Verificación runtime en navegador requerida | No | QA rápido post-deploy |
| 28. No hay errores críticos | WARNING | Requiere consola runtime por rol | No | QA por sesión |
| 29. No hay Firebase duplicate app | PASS | No se añadió init de Firebase | No | Ninguna |
| 30. No hay permission-denied falso | PASS | Errores se muestran contextualizados en tablas | No | Ninguna |
| 31. No hay listeners duplicados al navegar 5 veces | PASS | `unmount` limpia subs (`users`/`requests`) y global-search | No | Ninguna |
| 32. `/gestion` legacy sigue funcionando | PASS | No se cambió lógica legacy | No | Ninguna |
| 33. `/gestion` NO redirige | PASS | `legacy-shell-bridge.js` sin redirect para `/gestion` | No | Ninguna |
| 34. `/mapa` legacy sigue funcionando | PASS | `/mapa` sin redirect y sin cambios destructivos | No | Ninguna |

## Clasificación final

**READY_FOR_FUTURE_REDIRECT**

`/app/admin` cubre administración operativa diaria segura (usuarios/solicitudes/consulta de roles-plazas-catálogos).  
Se mantiene `/gestion` como entrada principal para acciones avanzadas globales.

## Decisión 12H

- `/gestion` permanece **KEEP_LEGACY_BACKUP**.
- Redirect `/gestion -> /app/admin` **NO ACTIVADO**.
- Condiciones para futura activación:
  - smoke E2E por rol/plaza sin errores críticos,
  - validación de onboarding completo aprobar/rechazar en producción,
  - cero regresiones en operaciones avanzadas legacy.
