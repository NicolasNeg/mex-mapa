// ═══════════════════════════════════════════════════════════
//  js/views/login.js  —  ES6 Module
//  Controlador de la vista /login
//
//  Responsabilidades:
//   1. Detectar si ya hay sesión activa → redirigir a /app/dashboard
//   2. Manejar login con email/contraseña
//   3. Manejar login con Google
//   4. Enviar solicitudes de acceso
//   5. Toggle de contraseña visible/oculta
// ═══════════════════════════════════════════════════════════

import { auth, db, COL, functions } from '/js/core/database.js';

<<<<<<< Updated upstream
// reCAPTCHA v2 checkbox ("No soy un robot"). Site key pública — no secretos aquí.
// No usar MEX_APPCHECK_SITE_KEY aquí: App Check es v3 y debe ser otra clave.
const RECAPTCHA_V2_SITE_KEY = String(
  window.MEX_RECAPTCHA_V2_SITE_KEY || ''
).trim();

/** Respuestas de servidor que no deben bloquear si el secreto aún no está configurado. */
=======
// Site key pública reCAPTCHA v2 (checkbox). Fuente: window.MEX_RECAPTCHA_V2_SITE_KEY
const RECAPTCHA_V2_SITE_KEY = String(
  window.MEX_RECAPTCHA_V2_SITE_KEY || '6Lf1714tAAAAAK3wyyOhB8nCk6JRh7uwIFlR6ufC'
).trim();

/** Respuestas del servidor que no bloquean login si el secreto aún no está configurado. */
>>>>>>> Stashed changes
const SOFT_RECAPTCHA_CODES = new Set([
  'recaptcha_config_missing',
  'recaptcha_unavailable',
  'recaptcha_api_error',
  'unexpected_error',
]);

let _recaptchaWidgetId = null;
let _recaptchaToken = '';
let _recaptchaRenderPromise = null;

function _setRecaptchaHint(visible) {
  const hint = document.getElementById('login-recaptcha-hint');
  if (hint) hint.hidden = !visible;
}

function _onRecaptchaSolved(token) {
  _recaptchaToken = String(token || '').trim();
  _setRecaptchaHint(false);
}

function _onRecaptchaExpired() {
  _recaptchaToken = '';
}

function _onRecaptchaError() {
  _recaptchaToken = '';
  console.warn('[login] reCAPTCHA v2 error (widget).');
}

function _waitForGrecaptcha(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const ready = () => typeof window.grecaptcha?.render === 'function';
    if (ready()) return resolve(window.grecaptcha);
    const start = Date.now();
    const id = setInterval(() => {
      if (ready()) {
        clearInterval(id);
        resolve(window.grecaptcha);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        reject(new Error('reCAPTCHA no cargó. Revisa la red o bloqueadores.'));
      }
    }, 50);
  });
}

/**
 * Renderiza el checkbox v2 en #login-recaptcha (render=explicit).
 * Idempotente: solo un widget por página.
 */
async function ensureRecaptchaWidget() {
  if (_recaptchaWidgetId != null) return _recaptchaWidgetId;
  if (_recaptchaRenderPromise) return _recaptchaRenderPromise;

  _recaptchaRenderPromise = (async () => {
    const container = document.getElementById('login-recaptcha');
    if (!container) throw new Error('Falta el contenedor #login-recaptcha.');
    if (!RECAPTCHA_V2_SITE_KEY) {
      throw new Error('Falta window.MEX_RECAPTCHA_V2_SITE_KEY (site key v2 pública).');
    }

    const grecaptcha = await _waitForGrecaptcha();
    await new Promise((resolve) => {
      if (typeof grecaptcha.ready === 'function') grecaptcha.ready(resolve);
      else resolve();
    });

    // Evitar doble render si dos llamadas corrieron en paralelo.
    if (_recaptchaWidgetId != null) return _recaptchaWidgetId;
    if (container.childElementCount > 0) {
      // Ya renderizado por otra vía.
      _recaptchaWidgetId = 0;
      return _recaptchaWidgetId;
    }

    _recaptchaWidgetId = grecaptcha.render(container, {
      sitekey: RECAPTCHA_V2_SITE_KEY,
      theme: 'light',
      size: 'normal',
      callback: _onRecaptchaSolved,
      'expired-callback': _onRecaptchaExpired,
      'error-callback': _onRecaptchaError,
    });
    console.info('[login] reCAPTCHA v2 checkbox listo.');
    return _recaptchaWidgetId;
  })();

  try {
    return await _recaptchaRenderPromise;
  } finally {
    _recaptchaRenderPromise = null;
  }
}

function resetRecaptcha() {
  _recaptchaToken = '';
  try {
    if (_recaptchaWidgetId != null && window.grecaptcha?.reset) {
      window.grecaptcha.reset(_recaptchaWidgetId);
    }
  } catch (e) {
    console.warn('[login] recaptcha reset:', e?.message || e);
  }
}

function getClientRecaptchaToken() {
  const fromState = String(_recaptchaToken || '').trim();
  if (fromState) return fromState;
  try {
    if (_recaptchaWidgetId != null && window.grecaptcha?.getResponse) {
      return String(window.grecaptcha.getResponse(_recaptchaWidgetId) || '').trim();
    }
  } catch (_) { /* ignore */ }
  return '';
}

/**
 * Gate de login: exige checkbox resuelto en cliente.
 * Si hay CF + secreto, valida en servidor; soft-fail si falta config.
 */
async function requireRecaptchaGate() {
  try {
    await ensureRecaptchaWidget();
  } catch (e) {
    console.error('[login] no se pudo montar reCAPTCHA:', e?.message || e);
    return {
      blocked: true,
      message: 'No se pudo cargar la verificación «No soy un robot». Recarga la página.',
    };
  }

  const token = getClientRecaptchaToken();
  if (!token) {
    _setRecaptchaHint(true);
    return {
      blocked: true,
      message: 'Marca «No soy un robot» antes de iniciar sesión.',
    };
  }

  if (!functions || typeof functions.httpsCallable !== 'function') {
    console.warn('[login] Functions no disponible; gate solo cliente (token presente).');
    return { blocked: false, token };
  }

  try {
    const callable = functions.httpsCallable('verifyRecaptchaLogin');
    const res = await callable({ token, provider: 'v2', version: 'v2' });
    const data = res?.data || {};
    if (data.ok) return { blocked: false, token };
    if (data.code && SOFT_RECAPTCHA_CODES.has(data.code)) {
      console.warn(
        '[login] verifyRecaptchaLogin soft-fail (client gate OK). Configura RECAPTCHA_V2_SECRET / recaptcha.v2_secret:',
        data.code
      );
      return { blocked: false, token };
    }
    resetRecaptcha();
    return {
      blocked: true,
      message: data.message || 'No pudimos validar seguridad, intenta de nuevo.',
    };
  } catch (err) {
    console.warn('[login] verifyRecaptchaLogin error (client gate OK):', err?.code || err?.message || err);
    return { blocked: false, token };
  }
}

// Destino post-login — fuente única de verdad.
// Cambiar aquí si se mueve el entry point del App Shell.
const POST_LOGIN_ROUTE = '/app/dashboard';

function _getRecaptchaV2Response() {
  try {
    if (typeof window.grecaptcha?.getResponse === 'function') {
      return String(window.grecaptcha.getResponse() || '').trim();
    }
  } catch (e) {
    console.warn('[login] grecaptcha.getResponse:', e?.message || e);
  }
  return '';
}

function _resetRecaptchaV2() {
  try {
    if (typeof window.grecaptcha?.reset === 'function') {
      window.grecaptcha.reset();
    }
  } catch (e) {
    console.warn('[login] grecaptcha.reset:', e?.message || e);
  }
}

/**
 * Exige casilla “No soy un robot” marcada (token no vacío).
 * Opcionalmente verifica en servidor (verifyRecaptchaLogin).
 * Si el secreto del servidor no está configurado → soft-fail (no bloquea),
 * pero la casilla del cliente SÍ es obligatoria.
 */
async function tryVerifyRecaptchaForLogin() {
  const token = _getRecaptchaV2Response();
  if (!token) {
    return {
      blocked: true,
      message: 'Marca la casilla «No soy un robot» para continuar.',
    };
  }

  if (!functions || typeof functions.httpsCallable !== 'function') {
    console.warn('[login] Firebase Functions no disponible; se omite verificación servidor (casilla OK).');
    return { blocked: false, token };
  }

  const callable = functions.httpsCallable('verifyRecaptchaLogin');
  let data;
  try {
    const res = await callable({ token, version: 'v2' });
    data = res?.data || {};
  } catch (err) {
    const code = err?.code || '';
    const details = err?.details;
    console.warn('[login] verifyRecaptchaLogin callable error (no bloquea login):', code, details || err?.message || err);
    return { blocked: false, token };
  }

  if (data.ok) {
    return { blocked: false, token };
  }
  if (data.code && SOFT_RECAPTCHA_CODES.has(data.code)) {
    console.warn('[login] reCAPTCHA soft-fail (casilla OK, secreto/servidor pendiente):', data.code);
    return { blocked: false, token };
  }
  return {
    blocked: true,
    message: data.message || 'No pudimos validar seguridad, intenta de nuevo.',
  };
}

/**
 * Resuelve el documento del usuario SOLO por docId (sin query/list).
 * Contrato esperado (Cloud Functions): usuarios/{emailLowercase} y fallback usuarios/{uid}.
 */
async function resolveUsuarioRecordForAuthUser(user) {
  const emailRaw = String(user?.email || '').trim();
  const emailNorm = emailRaw.toLowerCase();
  if (!emailRaw && !user?.uid) return null;

  const docIds = Array.from(new Set([emailRaw, emailNorm].filter(Boolean)));
  let lastPermissionDenied = null;

  for (const docId of docIds) {
    try {
      const snap = await db.collection(COL.USERS).doc(docId).get();
      if (snap?.exists) return snap;
    } catch (e) {
      const code = String(e?.code || '');
      if (code === 'permission-denied') {
        lastPermissionDenied = e;
        continue;
      }
      throw e;
    }
  }

  if (user?.uid) {
    try {
      const snap = await db.collection(COL.USERS).doc(user.uid).get();
      if (snap?.exists) return snap;
    } catch (e) {
      const code = String(e?.code || '');
      if (code === 'permission-denied') {
        lastPermissionDenied = e;
      } else {
        throw e;
      }
    }
  }

  if (lastPermissionDenied) throw lastPermissionDenied;
  return null;
}

function _resetManualLoginButton() {
  const btn = document.getElementById('btnLoginManual');
  if (!btn) return;
  btn.disabled = false;
  btn.innerText = 'LOGIN';
}

function _mexAlert(titulo, texto, tipo = 'info') {
  if (typeof window.mexAlert === 'function') return window.mexAlert(titulo, texto, tipo);
  console.warn('[login] mexAlert no disponible:', titulo, texto);
  return Promise.resolve(true);
}


// ── Mostrar errores pasados desde /mapa ───────────────────
const _pendingError = sessionStorage.getItem('login_error');
if (_pendingError) {
  sessionStorage.removeItem('login_error');
  // Esperar a que el DOM esté listo
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('login-error');
    const msg = document.getElementById('login-error-msg');
    if (el && msg) { msg.innerText = _pendingError; el.style.display = 'flex'; }
  }, { once: true });
}

// ── Redirección si ya tiene sesión ────────────────────────
auth.onAuthStateChanged(async (user) => {
  if (!user) return;

  try {
    await user.getIdToken(true);
    const docSnap = await resolveUsuarioRecordForAuthUser(user);

    if (docSnap) {
      const record = (typeof docSnap.data === 'function' ? docSnap.data() : docSnap?.data) || {};
      const status = String(record.status || '').toUpperCase();
      const isActive = record.activo !== false && status !== 'INACTIVO' && status !== 'RECHAZADO' && status !== 'BLOQUEADO';
      const isAuthorized = record.autorizado !== false && record.accesoSistema !== false;
      if (!isActive || !isAuthorized) {
        _showError(status === 'RECHAZADO'
          ? 'Tu solicitud fue rechazada. Contacta a administración si necesitas aclaración.'
          : 'Tu cuenta no está activa. Contacta a un administrador.');
        await auth.signOut();
        _resetManualLoginButton();
        return;
      }
      if (typeof window.__mexRequireLocationAccess === 'function') {
        await window.__mexRequireLocationAccess({
          title: 'Ubicacion obligatoria para entrar',
          copy: 'Antes de entrar al sistema necesitamos tu ubicacion exacta para auditar movimientos, configuraciones y actividad operativa.',
          allowLogout: true,
          force: true
        });
      }
      // Sesión válida → App Shell como destino principal post-login (Fase 6)
      console.log('[login] post-login redirect:', POST_LOGIN_ROUTE);
      window.location.href = POST_LOGIN_ROUTE;
    } else {
      _showError('Tu cuenta de acceso aún no está habilitada en el sistema.');
      await auth.signOut();
      _resetManualLoginButton();
    }
  } catch (e) {
    console.error('[login.js] Error validando sesión:', e);
    const code = String(e?.code || '');
    if (code === 'permission-denied') {
      _showError('No se pudo cargar tu perfil. Verifica conexión o contacta a administración.');
    } else {
      _showError('Error de conexión. Intenta de nuevo.');
    }
    _resetManualLoginButton();
  }
});

// ── Login con correo y contraseña ─────────────────────────
window.loginManual = async function () {
  const email    = document.getElementById('auth_email').value.trim();
  const pass     = document.getElementById('auth_pass').value.trim();
  const remember = document.getElementById('auth_remember')?.checked ?? true;
  const btn      = document.getElementById('btnLoginManual');

  if (!email || !pass) { _showError('Ingresa correo y contraseña.'); return; }

  btn.disabled = true;
  btn.innerText = 'VERIFYING…';
  _hideError();

  try {
    const gate = await tryVerifyRecaptchaForLogin();
    if (gate.blocked) {
      btn.disabled = false;
      btn.innerText = 'LOGIN';
      _resetRecaptchaV2();
      _showError(gate.message || 'Marca la casilla «No soy un robot» para continuar.');
      return;
    }

    const persistence = remember
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;
    await firebase.auth().setPersistence(persistence);

<<<<<<< Updated upstream
    const gate = await requireRecaptchaGate();
    if (gate.blocked) {
      btn.disabled = false;
      btn.innerText = 'LOGIN';
      _showError(gate.message || 'Marca «No soy un robot» antes de iniciar sesión.');
      return;
    }

=======
>>>>>>> Stashed changes
    await firebase.auth().signInWithEmailAndPassword(email, pass);
    // onAuthStateChanged redirige automáticamente
  } catch (err) {
    resetRecaptcha();
    btn.disabled = false;
    btn.innerText = 'LOGIN';
    _resetRecaptchaV2();
    const genericAuthMsg = 'No pudimos iniciar sesión. Verifica tus datos o confirma que tu cuenta ya fue autorizada.';
    const MSGS = {
      'auth/wrong-password': genericAuthMsg,
      'auth/invalid-credential': genericAuthMsg,
      'auth/invalid-login-credentials': genericAuthMsg,
      'auth/user-not-found': genericAuthMsg,
      'auth/invalid-email': 'Formato de correo inválido.',
      'auth/too-many-requests': 'Demasiados intentos. Espera un poco.',
      'auth/user-disabled': 'Tu cuenta no está activa. Contacta a un administrador.',
    };
    const code = err?.code || '';
    if (String(code).startsWith('auth/')) {
      _showError(MSGS[code] || 'Error al iniciar sesión.');
    } else {
      _showError(err?.message || 'Verificación de seguridad fallida.');
    }
  }
};

// ── Login con Google ──────────────────────────────────────
window.loginConGoogle = async function () {
  const provider = new firebase.auth.GoogleAuthProvider();
  const btn = document.getElementById('btnGoogleLogin');
  const googleBtnHtml = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt=""> Sign in with Google';
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons" style="font-size:16px;animation:spin 1s linear infinite">sync</span> VERIFICANDO...';
  _hideError();

  try {
    const gate = await tryVerifyRecaptchaForLogin();
    if (gate.blocked) {
      btn.disabled = false;
      btn.innerHTML = googleBtnHtml;
      _resetRecaptchaV2();
      _showError(gate.message || 'Marca la casilla «No soy un robot» para continuar.');
      return;
    }

    const remember = document.getElementById('auth_remember')?.checked ?? true;
    const persistence = remember
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;
    await firebase.auth().setPersistence(persistence);

<<<<<<< Updated upstream
    const gate = await requireRecaptchaGate();
    if (gate.blocked) {
      btn.disabled = false;
      btn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width:18px;"> Sign in with Google';
      _showError(gate.message || 'Marca «No soy un robot» antes de iniciar sesión.');
      return;
    }

=======
>>>>>>> Stashed changes
    btn.innerHTML = '<span class="material-icons" style="font-size:16px;animation:spin 1s linear infinite">sync</span> CONECTANDO...';
    await firebase.auth().signInWithPopup(provider);
  } catch (err) {
    resetRecaptcha();
    btn.disabled = false;
    btn.innerHTML = googleBtnHtml;
    _resetRecaptchaV2();
    if (err.code === 'auth/popup-closed-by-user') return;
    const code = err?.code || '';
    if (String(code).startsWith('auth/')) {
      _showError('Error con Google. Intenta de nuevo.');
    } else {
      _showError(err?.message || 'No pudimos validar seguridad, intenta de nuevo.');
    }
  }
};


// ── Registro con código de invitación ─────────────────────
// Vista Request Access: se alterna con una clase en <body> (CSS hace el slide).
window.abrirModalSolicitud = () => {
  document.body.classList.add('show-request');
  setTimeout(() => document.getElementById('reg_codigo')?.focus(), 300);
};
window.cerrarModalSolicitud = () => {
  document.body.classList.remove('show-request');
};
function _wireRegistroInvitacion() {
  const form = document.getElementById('inv-reg-form');
  if (!form) return;
  const err = document.getElementById('reg_err');
  document.getElementById('reg_cancel')?.addEventListener('click', window.cerrarModalSolicitud);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (err) err.style.display = 'none';
    const btn = document.getElementById('reg_submit');
    const pass  = document.getElementById('reg_pass').value;
    const pass2 = document.getElementById('reg_pass2')?.value;
    if (pass2 != null && pass !== pass2) {
      if (err) { err.textContent = 'Las contraseñas no coinciden.'; err.style.display = 'block'; }
      return;
    }
    btn.disabled = true; btn.textContent = 'Enviando…';
    const payload = {
      codigo: document.getElementById('reg_codigo').value.trim().toUpperCase(),
      nombre: document.getElementById('reg_nombre').value.trim(),
      email:  document.getElementById('reg_email').value.trim().toLowerCase(),
      telefono: document.getElementById('reg_tel').value.trim(),
      password: pass,
    };
    try {
      await firebase.functions().httpsCallable('registrarConInvitacion')(payload);
      await firebase.auth().signInWithEmailAndPassword(payload.email, payload.password);
      window.location.href = '/app';
    } catch (e2) {
      if (err) { err.textContent = e2?.message || 'No se pudo crear la cuenta.'; err.style.display = 'block'; }
      btn.disabled = false; btn.textContent = 'Request Access';
    }
  });
}

// ── Helpers UI ────────────────────────────────────────────
window.togglePassword = function (inputId, iconEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    iconEl.innerText = 'visibility_off';
    iconEl.style.color = '#3b82f6';
  } else {
    input.type = 'password';
    iconEl.innerText = 'visibility';
    iconEl.style.color = '#c4d0de';
  }
};

// ── Recuperar contraseña ──────────────────────────────────
window.olvidePassword = async function () {
  const typed = document.getElementById('auth_email')?.value.trim() || '';
  const email = window.mexPrompt
    ? await window.mexPrompt('Recuperar contraseña', 'Escribe tu correo y te enviaremos un enlace para restablecerla.', 'correo@empresa.com', 'email', typed)
    : window.prompt('Escribe tu correo para recuperar la contraseña:', typed);
  const dest = email?.toString().trim();
  if (!dest) return;
  try {
    await firebase.auth().sendPasswordResetEmail(dest);
    (window.mexAlert || window.alert)('Listo', 'Revisa tu correo para restablecer la contraseña.', 'success');
  } catch (err) {
    (window.mexAlert || window.alert)('No se pudo enviar', 'Verifica que la dirección sea correcta e intenta de nuevo.', 'error');
  }
};

function _showError(msg) {
  const el    = document.getElementById('login-error');
  const msgEl = document.getElementById('login-error-msg');
  if (!el) return;
  el.style.display = 'flex';
  if (msgEl) msgEl.innerText = msg;
}

function _hideError() {
  const el = document.getElementById('login-error');
  if (el) el.style.display = 'none';
}

// ── Branding de empresa en el login ───────────────────────
// La plantilla nace con un login simple (markup por defecto) y se rellena con
// logo + nombre + eslogan en cuanto llega la config. configuracion/empresa es de
// lectura pública (ver firestore.rules). Se cachea para no mostrar login sin imágenes.
const _BRANDING_CACHE_KEY = 'mex_login_branding';

function _applyBranding(cfg) {
  if (!cfg) return;
  const nombre = String(cfg.nombre || '').trim();
  const logo   = String(cfg.logoURL || '').trim();

  if (nombre) {
    document.querySelectorAll('.brand-name').forEach(el => { el.textContent = nombre; });
    document.title = nombre;
  }
  if (logo) {
    document.querySelectorAll('.brand-logo').forEach(box => {
      box.innerHTML = `<img src="${logo}" alt="" style="width:100%;height:100%;object-fit:contain;" onerror="this.remove()">`;
    });
  }
}

function _initBranding() {
  try {
    const cached = JSON.parse(localStorage.getItem(_BRANDING_CACHE_KEY) || 'null');
    if (cached) _applyBranding(cached);
  } catch (_) {}

  db.collection(COL.CONFIG).doc('empresa').get()
    .then(snap => {
      if (!snap.exists) return;
      const c = snap.data() || {};
      const branding = { nombre: c.nombre || '', logoURL: c.logoURL || '' };
      _applyBranding(branding);
      try { localStorage.setItem(_BRANDING_CACHE_KEY, JSON.stringify(branding)); } catch (_) {}
    })
    .catch(e => console.warn('[login] branding no disponible:', e?.message || e));
}

document.addEventListener('DOMContentLoaded', () => {
  _initBranding();

<<<<<<< Updated upstream
  // Montar checkbox v2 lo antes posible (no bloquear el resto de la UI).
  ensureRecaptchaWidget().catch((e) => {
    console.error('[login] render reCAPTCHA v2 falló:', e?.message || e);
    _setRecaptchaHint(true);
  });
=======
  // Sync site key from config if the widget attribute was stale.
  const widget = document.getElementById('login-recaptcha');
  if (widget && RECAPTCHA_V2_SITE_KEY) {
    widget.setAttribute('data-sitekey', RECAPTCHA_V2_SITE_KEY);
  }
>>>>>>> Stashed changes

  const emailEl = document.getElementById('auth_email');
  const passEl  = document.getElementById('auth_pass');

  const tryLogin = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    loginManual();
  };
  emailEl?.addEventListener('keydown', tryLogin);
  passEl?.addEventListener('keydown',  tryLogin);

  _wireRegistroInvitacion();

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('show-request')) {
      cerrarModalSolicitud();
    }
  });
});
