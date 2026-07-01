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

const RECAPTCHA_SITE_KEY = '6Le3cc4sAAAAAG4wNYaerrb-vz6Hn1OFw5k1J63j';
const RECAPTCHA_ACTION_EMAIL = 'LOGIN_EMAIL';
const RECAPTCHA_ACTION_GOOGLE = 'LOGIN_GOOGLE';

/** Respuestas que no deben bloquear el inicio de sesión si el servicio está mal configurado o caído. */
const SOFT_RECAPTCHA_CODES = new Set([
  'recaptcha_config_missing',
  'recaptcha_unavailable',
  'recaptcha_api_error',
  'unexpected_error',
]);

// Destino post-login — fuente única de verdad.
// Cambiar aquí si se mueve el entry point del App Shell.
const POST_LOGIN_ROUTE = '/app/dashboard';

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
        continue; // probar siguiente formato de docId
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

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function unique(values = []) {
  return Array.from(new Set((values || []).map(upper).filter(Boolean)));
}

function _mexAlert(titulo, texto, tipo = 'info') {
  if (typeof window.mexAlert === 'function') return window.mexAlert(titulo, texto, tipo);
  console.warn('[login] mexAlert no disponible:', titulo, texto);
  return Promise.resolve(true);
}


function _waitForRecaptchaEnterprise(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const done = () => {
      if (window.grecaptcha?.enterprise?.execute) return resolve();
    };
    done();
    const start = Date.now();
    const id = setInterval(() => {
      done();
      if (window.grecaptcha?.enterprise?.execute) {
        clearInterval(id);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        reject(new Error('reCAPTCHA Enterprise no está disponible.'));
      }
    }, 50);
  });
}

async function _getRecaptchaToken(action) {
  await _waitForRecaptchaEnterprise();
  return new Promise((resolve, reject) => {
    try {
      window.grecaptcha.enterprise.ready(async () => {
        try {
          const token = await window.grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, { action });
          resolve(token);
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Intenta validar el token en servidor. Si el servicio falla de forma recuperable,
 * devuelve blocked:false para no bloquear el login. Si la validación rechaza el token,
 * devuelve blocked:true con mensaje de seguridad (no confundir con credenciales).
 */
async function tryVerifyRecaptchaForLogin(action) {
  if (!functions || typeof functions.httpsCallable !== 'function') {
    console.warn('[login] Firebase Functions no disponible; se omite verificación reCAPTCHA.');
    return { blocked: false };
  }
  let token;
  try {
    token = await _getRecaptchaToken(action);
  } catch (e) {
    console.warn('[login] reCAPTCHA Enterprise no devolvió token (no bloquea login):', e?.message || e);
    return { blocked: false };
  }
  const callable = functions.httpsCallable('verifyRecaptchaLogin');
  let data;
  try {
    const res = await callable({ token, action });
    data = res?.data || {};
  } catch (err) {
    const code = err?.code || '';
    const details = err?.details;
    console.warn('[login] verifyRecaptchaLogin callable error (no bloquea login):', code, details || err?.message || err);
    return { blocked: false };
  }
  if (data.ok) {
    return { blocked: false };
  }
  if (data.code && SOFT_RECAPTCHA_CODES.has(data.code)) {
    console.warn('[login] reCAPTCHA soft-fail:', data.code);
    return { blocked: false };
  }
  return {
    blocked: true,
    message: data.message || 'No pudimos validar seguridad, intenta de nuevo.',
  };
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
      _showError('❌ Error de conexión. Intenta de nuevo.');
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
    const persistence = remember
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;
    await firebase.auth().setPersistence(persistence);

    const gate = await tryVerifyRecaptchaForLogin(RECAPTCHA_ACTION_EMAIL);
    if (gate.blocked) {
      btn.disabled = false;
      btn.innerText = 'LOGIN';
      _showError(gate.message || 'No pudimos validar seguridad, intenta de nuevo.');
      return;
    }

    await firebase.auth().signInWithEmailAndPassword(email, pass);
    // onAuthStateChanged redirige automáticamente
  } catch (err) {
    btn.disabled = false;
    btn.innerText = 'LOGIN';
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
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons" style="font-size:16px;animation:spin 1s linear infinite">sync</span> VERIFICANDO...';
  _hideError();

  try {
    const remember = document.getElementById('auth_remember')?.checked ?? true;
    const persistence = remember
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;
    await firebase.auth().setPersistence(persistence);

    const gate = await tryVerifyRecaptchaForLogin(RECAPTCHA_ACTION_GOOGLE);
    if (gate.blocked) {
      btn.disabled = false;
      btn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width:18px;"> Sign in with Google';
      _showError(gate.message || 'No pudimos validar seguridad, intenta de nuevo.');
      return;
    }

    btn.innerHTML = '<span class="material-icons" style="font-size:16px;animation:spin 1s linear infinite">sync</span> CONECTANDO...';
    await firebase.auth().signInWithPopup(provider);
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width:18px;"> Sign in with Google';
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
window.abrirModalSolicitud = () => {
  const m = document.getElementById('modal-solicitud');
  if (m) m.style.display = 'flex';
};
window.cerrarModalSolicitud = () => {
  const m = document.getElementById('modal-solicitud');
  if (m) m.style.display = 'none';
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
    btn.disabled = true; btn.textContent = 'Creando…';
    const payload = {
      codigo: document.getElementById('reg_codigo').value.trim().toUpperCase(),
      nombre: document.getElementById('reg_nombre').value.trim(),
      email:  document.getElementById('reg_email').value.trim().toLowerCase(),
      telefono: document.getElementById('reg_tel').value.trim(),
      password: document.getElementById('reg_pass').value,
    };
    try {
      await firebase.functions().httpsCallable('registrarConInvitacion')(payload);
      await firebase.auth().signInWithEmailAndPassword(payload.email, payload.password);
      window.location.href = '/app';
    } catch (e2) {
      if (err) { err.textContent = e2?.message || 'No se pudo crear la cuenta.'; err.style.display = 'block'; }
      btn.disabled = false; btn.textContent = 'Crear cuenta';
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
    if (event.key === 'Escape' && document.getElementById('modal-solicitud')?.style.display === 'flex') {
      cerrarModalSolicitud();
    }
  });
});
