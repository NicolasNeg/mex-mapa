# Firebase App Check (web)

## Qué hace

El cliente inicializa **Firebase App Check** con **reCAPTCHA Enterprise** (compat SDK `firebase-app-check-compat.js`) justo después de `firebase.initializeApp` en `js/core/firebase-init.js`. El token se adjunta automáticamente a Auth, Firestore, Storage y Functions cuando el SDK lo solicita. **Enforcement** en consola queda fuera de este paso (observación primero).

## Provider

| Variable | Valor | SDK |
|---|---|---|
| `window.MEX_APPCHECK_PROVIDER` | `enterprise` (default) | `ReCaptchaEnterpriseProvider` |
| `window.MEX_APPCHECK_PROVIDER` | `v3` | `ReCaptchaV3Provider` |

Preferir **Enterprise** si la app web en Firebase Console → App Check está registrada con reCAPTCHA Enterprise (caso actual: app **mapGestion**).

## Dónde poner la site key (pública)

Archivo: `js/core/firebase-config.js`

```js
window.MEX_APPCHECK_SITE_KEY = '<SITE_KEY_PUBLICA>';
```

Origen de la clave:

1. [Firebase Console](https://console.firebase.google.com/) → proyecto → **App Check**
2. App web **mapGestion** → proveedor **reCAPTCHA Enterprise** (o reCAPTCHA v3 si usas `MEX_APPCHECK_PROVIDER = 'v3'`)
3. Copiar solo la **Site key** (pública). Nunca pegues API keys de Google Cloud ni secretos de servidor en el cliente.

También puedes definir `window.MEX_APPCHECK_SITE_KEY` en un script **antes** de cargar `firebase-config.js`.

## Scripts HTML

Tras `firebase-app-compat.js` y **antes** de `firebase-init.js`:

```html
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check-compat.js"></script>
```

## Login

`login.html` carga App Check → `firebase-init` lo activa → `js/views/login.js` llama `getToken()` antes de email/Google para asegurar token en el flujo de Auth.

## Debug tokens (localhost)

No añadas `localhost` a los dominios permitidos de reCAPTCHA.

En **localhost** / `127.0.0.1` el init activa el debug provider (`self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`). La consola del navegador muestra un UUID; regístralo en:

**Firebase Console → App Check → overflow menu → Manage debug tokens**

Opciones:

| Método | Uso |
|---|---|
| Auto en localhost | `FIREBASE_APPCHECK_DEBUG_TOKEN = true` |
| `localStorage.setItem('mex.appcheck.debug', '1')` | Fuerza debug en cualquier host (solo pruebas) |
| `localStorage.setItem('mex.appcheck.debug', '<uuid>')` | Reutiliza un token ya registrado |
| `window.MEX_APPCHECK_DEBUG_TOKEN = true` o `'<uuid>'` | Antes de `firebase-init.js` |

Quitar debug: `localStorage.removeItem('mex.appcheck.debug')`.
