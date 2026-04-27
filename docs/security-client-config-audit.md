# Auditoría seguridad cliente — `config.js` y frontend

Fecha: 2026-04-27  
Alcance: beta actual en Firebase Hosting.

## Hallazgos en `config.js`

Se revisó el archivo servido al cliente (`/config.js`) y contiene únicamente parámetros del SDK cliente de Firebase:

- `apiKey` (Firebase client)
- `authDomain`
- `projectId`
- `storageBucket`
- `messagingSenderId`
- `appId`

Valores reportados (enmascarados):

- `apiKey`: `AIza...NmVc`
- `authDomain`: `mex-...app.com`
- `projectId`: `mex-...-bjx`
- `storageBucket`: `mex-...app`
- `messagingSenderId`: `3591...4070`
- `appId`: `1:35...8a7`

## Clasificación

- **Público permitido**: configuración cliente Firebase (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`).
- **Público pero restringible**: no se encontró una key de Maps browser separada en `config.js`. Si se usa una key browser adicional, debe ir con restricción por dominio/referrer.
- **Secreto real (NO permitido en frontend)**: no se detectaron secretos reales en `config.js` (sin bearer tokens, sin private keys, sin service account JSON, sin client secrets).

## Qué se deja en frontend

- Solo configuración pública del cliente Firebase, necesaria para inicializar Auth/Firestore/Storage/Messaging en navegador.

## Qué se elimina o mueve

- En esta auditoría no se encontraron secretos reales en `config.js` para mover.
- Se actualizó el encabezado de `config.js` para dejar explícito que **solo** debe contener configuración pública.

## Qué debe rotarse

- No se detectaron secretos privados expuestos en `config.js` que requieran rotación inmediata.
- Si alguna credencial privada estuvo anteriormente en frontend (histórico fuera de esta revisión), debe tratarse como comprometida y rotarse.

## Restricciones recomendadas (actuales)

- Mantener reglas de Firestore/Storage como control principal de acceso.
- En servicios externos que usen browser keys (si aplica), restringir por dominio/referrer permitido.
- Mantener secretos reales únicamente en backend (Cloud Functions config/entorno), nunca en JS cliente.

## Revisión de repo por patrones sensibles

Se ejecutó búsqueda por patrones (`apiKey`, `token`, `secret`, `client_secret`, `serviceAccount`, `x-api-key`, `authorization`, etc.) en JS/HTML/API/functions.

Resultado de riesgo:

- Se observaron referencias funcionales y nombres de campos esperados (por ejemplo `apiKey` de Firebase y lógica de API keys del backend en `functions/index.js`).
- No se detectó evidencia de claves privadas embebidas en frontend equivalentes a service account o secretos backend.
- Credenciales SMTP (`mail.user`, `mail.pass`) aparecen solo en Cloud Functions vía `functions.config()`, no en cliente.

## Riesgos restantes de seguridad (beta)

- Todo JS servido al navegador es inspeccionable en DevTools; por eso la regla es **no poner secretos reales** en frontend.
- El `apiKey` de Firebase cliente seguirá visible por diseño; la protección depende de reglas y control de acceso backend, no de ocultar ese valor.
