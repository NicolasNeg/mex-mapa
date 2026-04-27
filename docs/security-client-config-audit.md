# Auditoría seguridad cliente — Firebase Web y frontend

Fecha: 2026-04-27  
Alcance: beta actual en Firebase Hosting.

## Principios

- El **Firebase Web `apiKey`** es **pública por diseño** del modelo Firebase; **no** es un secreto de servidor.
- **No** deben existir en el frontend: service accounts, private keys, tokens de servidor, client secrets OAuth ni credenciales SMTP/API privadas.
- El control de acceso real a datos sigue siendo **Firestore Rules** y **Storage Rules** (y backend donde aplique).

## Dónde vive la configuración cliente

La app carga **`/js/core/firebase-config.js`**, que define `window.FIREBASE_CONFIG` con solo parámetros del SDK cliente (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`). El archivo **`/config.js` en raíz ya no forma parte del flujo** de las páginas HTML principales.

Valores revisados (enmascarados en auditorías previas):

- `apiKey`: `AIza...`
- `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`: coherentes con proyecto Firebase Hosting.

## Clasificación

- **Público permitido**: configuración cliente Firebase listada arriba.
- **Público pero restringible**: cualquier API key adicional usada en navegador (p. ej. Maps) debe ir con restricciones de dominio/referrer en Google Cloud.
- **Secreto real (no permitido en frontend)**: no se detectaron en la revisión orientada a `firebase-config` y patrones típicos en JS/HTML expuestos al navegador.

## Recomendaciones para la beta actual

1. **Google Cloud — API key (Firebase Web)**  
   Revisar restricciones en Google Cloud Console → Credenciales → la key usada por Firebase Web:
   - Limitar a **APIs necesarias** (Firebase-related).
   - **Restricción HTTP referrer** para el sitio desplegado, por ejemplo:
     - `https://mex-mapa-bjx.web.app/*`
     - `https://mex-mapa-bjx.firebaseapp.com/*`
     - El dominio final cuando exista y esté enlazado al mismo proyecto.

2. **Firestore / Storage**  
   Mantener reglas revisadas como barrera principal; el `apiKey` visible no sustituye reglas.

3. **App Check**  
   Considerar activación cuando convenga endurecer el uso del SDK ante abusos; **no** es requisito para cerrar esta beta si las reglas y restricciones de key están bien aplicadas.

## Riesgos residuales

- Todo JS servido al navegador es inspeccionable; la política correcta es **no colocar secretos reales** en cliente.
- El `apiKey` seguirá visible donde el SDK la use; la seguridad no depende de ocultarla frente a DevTools.

## Mensajes / identidad

Los mensajes en App Shell priorizan **email** como identidad canónica cuando existe en datos o metadatos; los nombres pueden cambiar sin duplicar conversaciones si el email es estable.
