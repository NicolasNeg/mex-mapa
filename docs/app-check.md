# Firebase App Check (web)

## Qué hace

El cliente inicializa **Firebase App Check** con **reCAPTCHA v3** (compat SDK `firebase-app-check-compat.js`) justo después de `firebase.initializeApp` en `js/core/firebase-init.js`. El token se adjunta automáticamente a Auth, Firestore, Storage y Functions cuando el SDK lo solicita. **Enforcement** en consola queda fuera de este paso (observación primero).

## Provider

| Variable | Valor | SDK |
|---|---|---|
| `window.MEX_APPCHECK_PROVIDER` | `v3` (default) | `ReCaptchaV3Provider` |
| `window.MEX_APPCHECK_PROVIDER` | `enterprise` | `ReCaptchaEnterpriseProvider` |

Default actual: **reCAPTCHA v3** para la site key de App Check de **mapGestion**. Usa `enterprise` solo con la site key del proveedor Enterprise en consola.

## Dónde poner la site key (pública)

Archivo: `js/core/firebase-config.js` → `window.MEX_APPCHECK_SITE_KEY`

```js
window.MEX_APPCHECK_SITE_KEY = '<SITE_KEY_PUBLICA>';
```

Origen de la clave:

1. [Firebase Console](https://console.firebase.google.com/) → proyecto → **App Check**
2. App web **mapGestion** → proveedor **reCAPTCHA** (v3)
3. Copiar solo la **Site key** (pública). Nunca pegues API keys de Google Cloud ni secretos de servidor en el cliente.

También puedes definir `window.MEX_APPCHECK_SITE_KEY` en un script **antes** de cargar `firebase-config.js`.

## Scripts HTML

Tras `firebase-app-compat.js` y **antes** de `firebase-init.js`:

```html
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check-compat.js"></script>
```

## Login

En `/login` **App Check v3 se omite** a propósito (`firebase-init.js` → `_isLoginPage()`). El gate UX es un **reCAPTCHA v2 checkbox** visible («No soy un robot»).

| Pieza | Dónde |
|---|---|
| Script | `login.html` → `https://www.google.com/recaptcha/api.js?render=explicit` |
| Contenedor | `#login-recaptcha` |
| Site key (pública) | `window.MEX_RECAPTCHA_V2_SITE_KEY` en `js/core/firebase-config.js` |
| Controlador | `js/views/login.js` → `ensureRecaptchaWidget()` + `requireRecaptchaGate()` |

Comportamiento:

1. El widget se renderiza al cargar la página.
2. Email/Google **no avanzan** hasta que el checkbox esté resuelto (token cliente).
3. Si existe Cloud Function + secreto, se llama `verifyRecaptchaLogin` con `{ provider: 'v2' }`.
4. Si falta el secreto (`recaptcha_config_missing`), el cliente **sigue** con el token local (soft-fail) y deja un warning en consola.

### Secreto de servidor (v2)

El **secret key** de reCAPTCHA v2 **nunca** va en el cliente.

```bash
# Functions config (legacy)
firebase functions:config:set recaptcha.v2_secret="TU_SECRET_KEY"

# O variable de entorno en el runtime de Functions
# RECAPTCHA_V2_SECRET=TU_SECRET_KEY
```

Tras configurar el secreto, redespliega Functions (`npm run deploy:functions`) para que `verifyRecaptchaLogin` valide contra `https://www.google.com/recaptcha/api/siteverify`.

La site key debe ser de tipo **reCAPTCHA v2 Checkbox** en [Google reCAPTCHA Admin](https://www.google.com/recaptcha/admin) y el dominio de producción debe estar autorizado.

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
