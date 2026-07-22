# Firebase App Check (web)

## Qu├® hace

El cliente inicializa **Firebase App Check** con **reCAPTCHA v3** (compat SDK `firebase-app-check-compat.js`) justo despu├®s de `firebase.initializeApp` en `js/core/firebase-init.js`. El token se adjunta autom├íticamente a Auth, Firestore, Storage y Functions cuando el SDK lo solicita. **Enforcement** en consola queda fuera de este paso (observaci├│n primero).

## Provider

| Variable | Valor | SDK |
|---|---|---|
| `window.MEX_APPCHECK_PROVIDER` | `v3` (default) | `ReCaptchaV3Provider` |
| `window.MEX_APPCHECK_PROVIDER` | `enterprise` | `ReCaptchaEnterpriseProvider` |

Default actual: **reCAPTCHA v3** para la site key de App Check de **mapGestion**. Usa `enterprise` solo con la site key del proveedor Enterprise en consola.

## D├│nde poner la site key (p├║blica)

Archivo: `js/core/firebase-config.js` ÔåÆ `window.MEX_APPCHECK_SITE_KEY`

```js
window.MEX_APPCHECK_SITE_KEY = '<SITE_KEY_V3_PUBLICA>';
```

**No reutilices la site key del login (reCAPTCHA v2 checkbox).** Son productos distintos:

| Uso | Tipo | Variable |
|---|---|---|
| Login ┬½No soy un robot┬╗ | reCAPTCHA **v2** Checkbox | `MEX_RECAPTCHA_V2_SITE_KEY` |
| Firebase App Check | reCAPTCHA **v3** | `MEX_APPCHECK_SITE_KEY` |

Si ambas variables apuntan a la misma clave, `firebase-init.js` **omite App Check** a prop├│sito. Si activas App Check con una clave v2, el SDK lanza en bucle `AppCheck: ReCAPTCHA error (appCheck/recaptcha-error)` y Auth puede fallar al pedir el token.

Con `MEX_APPCHECK_SITE_KEY` vac├¡o (default), la app funciona sin App Check mientras enforcement est├® en observaci├│n.

Origen de la clave v3:

1. [Firebase Console](https://console.firebase.google.com/) ÔåÆ proyecto ÔåÆ **App Check**
2. App web **mapGestion** ÔåÆ proveedor **reCAPTCHA** (v3) ÔÇö registra un sitio **v3**, no el checkbox v2
3. Copiar solo la **Site key** (p├║blica). Nunca pegues API keys de Google Cloud ni secretos de servidor en el cliente.

Tambi├®n puedes definir `window.MEX_APPCHECK_SITE_KEY` en un script **antes** de cargar `firebase-config.js`.

## Scripts HTML

Tras `firebase-app-compat.js` y **antes** de `firebase-init.js`:

```html
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check-compat.js"></script>
```

## Login

En `/login` **App Check v3 se omite** a prop├│sito (`firebase-init.js` ÔåÆ `_isLoginPage()`). El gate UX es un **reCAPTCHA v2 checkbox** visible (┬½No soy un robot┬╗).

| Pieza | D├│nde |
|---|---|
| Script | `login.html` ÔåÆ `https://www.google.com/recaptcha/api.js?render=explicit` |
| Contenedor | `#login-recaptcha` |
| Site key (p├║blica) | `window.MEX_RECAPTCHA_V2_SITE_KEY` en `js/core/firebase-config.js` |
| Controlador | `js/views/login.js` ÔåÆ `ensureRecaptchaWidget()` + `requireRecaptchaGate()` |

Comportamiento:

1. El widget se renderiza al cargar la p├ígina.
2. Email/Google **no avanzan** hasta que el checkbox est├® resuelto (token cliente).
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

La site key debe ser de tipo **reCAPTCHA v2 Checkbox** en [Google reCAPTCHA Admin](https://www.google.com/recaptcha/admin) y el dominio de producci├│n debe estar autorizado.

## Debug tokens (localhost)

No a├▒adas `localhost` a los dominios permitidos de reCAPTCHA.

En **localhost** / `127.0.0.1` el init activa el debug provider (`self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`). La consola del navegador muestra un UUID; reg├¡stralo en:

**Firebase Console ÔåÆ App Check ÔåÆ overflow menu ÔåÆ Manage debug tokens**

Opciones:

| M├®todo | Uso |
|---|---|
| Auto en localhost | `FIREBASE_APPCHECK_DEBUG_TOKEN = true` |
| `localStorage.setItem('mex.appcheck.debug', '1')` | Fuerza debug en cualquier host (solo pruebas) |
| `localStorage.setItem('mex.appcheck.debug', '<uuid>')` | Reutiliza un token ya registrado |
| `window.MEX_APPCHECK_DEBUG_TOKEN = true` o `'<uuid>'` | Antes de `firebase-init.js` |

Quitar debug: `localStorage.removeItem('mex.appcheck.debug')`.
