# Firebase App Check + Login reCAPTCHA

## Separación importante

| Uso | Producto | Variable cliente | Dónde |
|---|---|---|---|
| **Login gate** | reCAPTCHA **v2 checkbox** (“No soy un robot”) | `window.MEX_RECAPTCHA_V2_SITE_KEY` | `login.html` + `js/views/login.js` |
| **App Check** (opcional) | reCAPTCHA **v3** / Enterprise | `window.MEX_APPCHECK_SITE_KEY` | resto de la app vía `firebase-init.js` |

**No reutilices la site key v2 del login como App Check.** Son productos distintos.

---

## Login — reCAPTCHA v2 checkbox

1. `login.html` carga `https://www.google.com/recaptcha/api.js` y renderiza el widget checkbox.
2. Site key pública: `js/core/firebase-config.js` → `MEX_RECAPTCHA_V2_SITE_KEY`.
3. Email/password y Google **bloquean** hasta `grecaptcha.getResponse()` no vacío.
4. Tras login fallido (o rechazo de verificación), se llama `grecaptcha.reset()`.
5. En `/login`, App Check está **desactivado** (`MEX_APPCHECK_DISABLED` + skip en `firebase-init`) para no pelear con el checkbox v2.

### Verificación en servidor (recomendado)

Callable: `verifyRecaptchaLogin` → Google `siteverify` con el **secret** de la clave v2.

Configura **uno** de estos secretos (no inventar valores; copiar el secret de [Google reCAPTCHA Admin](https://www.google.com/recaptcha/admin)):

```bash
# Preferido (Secret Manager)
firebase functions:secrets:set RECAPTCHA_SECRET_KEY
# alias aceptado:
firebase functions:secrets:set RECAPTCHA_V2_SECRET

# Legacy config (alternativa)
firebase functions:config:set recaptcha.secret_key="TU_SECRET_V2"
```

Luego:

```bash
npm run deploy:functions
```

Si el secreto **no** está configurado, la función responde `recaptcha_config_missing` y el cliente hace **soft-fail** (permite continuar) — pero la casilla del cliente **sigue siendo obligatoria**.

---

## App Check (reCAPTCHA v3) — opcional / observación

El cliente puede inicializar **Firebase App Check** con **reCAPTCHA v3** en `js/core/firebase-init.js` **fuera de login**, si hay site key.

| Variable | Valor | SDK |
|---|---|---|
| `window.MEX_APPCHECK_PROVIDER` | `v3` (default) | `ReCaptchaV3Provider` |
| `window.MEX_APPCHECK_PROVIDER` | `enterprise` | `ReCaptchaEnterpriseProvider` |

### Dónde poner la site key App Check (pública, v3)

Archivo: `js/core/firebase-config.js` → `window.MEX_APPCHECK_SITE_KEY`

<<<<<<< Updated upstream
```js
window.MEX_APPCHECK_SITE_KEY = '<SITE_KEY_V3_PUBLICA>';
```

**No reutilices la site key del login (reCAPTCHA v2 checkbox).** Son productos distintos:

| Uso | Tipo | Variable |
|---|---|---|
| Login «No soy un robot» | reCAPTCHA **v2** Checkbox | `MEX_RECAPTCHA_V2_SITE_KEY` |
| Firebase App Check | reCAPTCHA **v3** | `MEX_APPCHECK_SITE_KEY` |

Si ambas variables apuntan a la misma clave, `firebase-init.js` **omite App Check** a propósito. Si activas App Check con una clave v2, el SDK lanza en bucle `AppCheck: ReCAPTCHA error (appCheck/recaptcha-error)` y Auth puede fallar al pedir el token.

Con `MEX_APPCHECK_SITE_KEY` vacío (default), la app funciona sin App Check mientras enforcement esté en observación.

Origen de la clave v3:

1. [Firebase Console](https://console.firebase.google.com/) → proyecto → **App Check**
2. App web **mapGestion** → proveedor **reCAPTCHA** (v3) — registra un sitio **v3**, no el checkbox v2
3. Copiar solo la **Site key** (pública). Nunca pegues API keys de Google Cloud ni secretos de servidor en el cliente.
=======
Por defecto queda **vacío** (App Check off) hasta que registres una site key **v3** de App Check en consola.

Origen:

1. [Firebase Console](https://console.firebase.google.com/) → proyecto → **App Check**
2. App web → proveedor **reCAPTCHA** (v3)
3. Copiar solo la **Site key** (pública). Nunca pegues secretos en el cliente.
>>>>>>> Stashed changes

También puedes definir `window.MEX_APPCHECK_SITE_KEY` en un script **antes** de cargar `firebase-config.js`.

### Scripts HTML (páginas con App Check)

Tras `firebase-app-compat.js` y **antes** de `firebase-init.js`:

```html
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check-compat.js"></script>
```

`login.html` **no** carga App Check a propósito.

<<<<<<< Updated upstream
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
=======
### Debug tokens (localhost)
>>>>>>> Stashed changes

No añadas `localhost` a los dominios permitidos de reCAPTCHA (App Check).

En **localhost** / `127.0.0.1` el init activa el debug provider (`self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`) cuando App Check está habilitado. La consola del navegador muestra un UUID; regístralo en:

**Firebase Console → App Check → overflow menu → Manage debug tokens**

| Método | Uso |
|---|---|
| Auto en localhost | `FIREBASE_APPCHECK_DEBUG_TOKEN = true` |
| `localStorage.setItem('mex.appcheck.debug', '1')` | Fuerza debug en cualquier host (solo pruebas) |
| `localStorage.setItem('mex.appcheck.debug', '<uuid>')` | Reutiliza un token ya registrado |
| `window.MEX_APPCHECK_DEBUG_TOKEN = true` o `'<uuid>'` | Antes de `firebase-init.js` |

Quitar debug: `localStorage.removeItem('mex.appcheck.debug')`.
