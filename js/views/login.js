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

function _eid() {
  const ctx = window._empresaActual;
  if (!ctx || ctx.isSuperAdminContext) return '';
  return ctx.id || '';
}

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
  btn.innerText = 'INICIAR SESIÓN';
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
      // Cargar contexto de empresa/tenant para el usuario autenticado.
      if (typeof window.mexEmpresaContext?.cargarParaUsuario === 'function') {
        await window.mexEmpresaContext.cargarParaUsuario(record).catch(() => {});
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
  btn.innerText = 'VERIFICANDO...';
  _hideError();

  try {
    const persistence = remember
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;
    await firebase.auth().setPersistence(persistence);

    const gate = await tryVerifyRecaptchaForLogin(RECAPTCHA_ACTION_EMAIL);
    if (gate.blocked) {
      btn.disabled = false;
      btn.innerText = 'INICIAR SESIÓN';
      _showError(gate.message || 'No pudimos validar seguridad, intenta de nuevo.');
      return;
    }

    await firebase.auth().signInWithEmailAndPassword(email, pass);
    // onAuthStateChanged redirige automáticamente
  } catch (err) {
    btn.disabled = false;
    btn.innerText = 'INICIAR SESIÓN';
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
      btn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width:18px;"> CUENTA DE GOOGLE';
      _showError(gate.message || 'No pudimos validar seguridad, intenta de nuevo.');
      return;
    }

    btn.innerHTML = '<span class="material-icons" style="font-size:16px;animation:spin 1s linear infinite">sync</span> CONECTANDO...';
    await firebase.auth().signInWithPopup(provider);
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width:18px;"> CUENTA DE GOOGLE';
    if (err.code === 'auth/popup-closed-by-user') return;
    const code = err?.code || '';
    if (String(code).startsWith('auth/')) {
      _showError('Error con Google. Intenta de nuevo.');
    } else {
      _showError(err?.message || 'No pudimos validar seguridad, intenta de nuevo.');
    }
  }
};

// ── Modal de solicitud de acceso — flujo multi-tenant ─────
// _solEmpresa almacena el tenant verificado al completar el Paso 1.
let _solEmpresa = null; // { id, nombre, plazas: string[] }

window.abrirModalSolicitud = () => {
  _solEmpresa = null;
  const empInput = document.getElementById('sol_empresa_id');
  if (empInput) empInput.value = '';
  _solSetEmpError('');
  solIrAPaso(1);
  document.getElementById('modal-solicitud').style.display = 'flex';
};

window.cerrarModalSolicitud = () => {
  document.getElementById('modal-solicitud').style.display = 'none';
};

function _solSetEmpError(msg) {
  const el = document.getElementById('sol-emp-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function _solSetStep2Error(msg) {
  const el = document.getElementById('sol-step2-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

window.solIrAPaso = function (paso) {
  [1, 2, 3].forEach(n => {
    const panel = document.getElementById(`sol-step-${n}`);
    if (panel) panel.style.display = n === paso ? '' : 'none';
    const dot = document.querySelector(`.sol-step-dot[data-step="${n}"]`);
    if (!dot) return;
    dot.classList.toggle('sol-step-active', n === paso);
    dot.classList.toggle('sol-step-done', n < paso);
    if (n === paso) dot.classList.remove('sol-step-done');
  });
};

window.solBuscarEmpresa = async function () {
  const inp = document.getElementById('sol_empresa_id');
  const empresaId = (inp?.value || '').trim().toLowerCase().replace(/\s+/g, '-');
  _solSetEmpError('');

  if (!empresaId || empresaId.length < 2) {
    _solSetEmpError('Ingresa el código de empresa (mínimo 2 caracteres).');
    return;
  }

  const btn = document.getElementById('btnBuscarEmpresa');
  if (btn) { btn.disabled = true; btn.innerText = 'BUSCANDO...'; }

  try {
    const callable = functions.httpsCallable('getEmpresaPublicInfo');
    const result = await callable({ empresaId });
    const d = result?.data || {};

    _solEmpresa = { id: d.id || empresaId, nombre: d.nombre || empresaId, plazas: d.plazas || [] };

    // Populate empresa confirmation card
    const card = document.getElementById('sol-emp-card');
    if (card) {
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="material-icons" style="color:#22c55e;font-size:28px;">verified</span>
          <div>
            <div class="emp-name">${_solEmpresa.nombre}</div>
            <div class="emp-id">${_solEmpresa.id}</div>
          </div>
        </div>`;
    }

    // Populate plaza select
    const sel = document.getElementById('sol_plaza');
    const plazaWrap = document.getElementById('sol-plaza-wrap');
    if (sel) {
      sel.innerHTML = '<option value="">— Sucursal / Plaza (opcional) —</option>';
      _solEmpresa.plazas.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        sel.appendChild(opt);
      });
    }
    if (plazaWrap) plazaWrap.style.display = _solEmpresa.plazas.length > 0 ? '' : 'none';

    // Reset role select
    const rolSel = document.getElementById('sol_rol_solicitado');
    if (rolSel) rolSel.value = '';

    solIrAPaso(2);
  } catch (e) {
    const code = String(e?.code || '');
    const msg = code === 'not-found'
      ? 'No encontramos esa empresa. Verifica el código con tu administrador.'
      : code === 'failed-precondition'
      ? 'Esta empresa no está activa en la plataforma.'
      : code === 'invalid-argument'
      ? 'Código de empresa inválido.'
      : 'Error al buscar la empresa. Intenta de nuevo.';
    _solSetEmpError(msg);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = 'BUSCAR EMPRESA'; }
  }
};

window.solConfirmarEmpresa = function () {
  const rol = document.getElementById('sol_rol_solicitado')?.value;
  _solSetStep2Error('');
  if (!rol) {
    _solSetStep2Error('Selecciona el puesto que solicitas.');
    return;
  }
  solIrAPaso(3);
};

window.enviarSolicitudAcceso = async function () {
  const REQUEST_COLLECTION = 'solicitudes';
  const nombre   = document.getElementById('sol_nombre').value.trim().toUpperCase();
  const email    = document.getElementById('sol_email').value.trim().toLowerCase();
  const telefono = document.getElementById('sol_telefono')?.value.trim() || '';
  const pass     = document.getElementById('sol_pass')?.value || '';
  const confirm  = document.getElementById('sol_pass_confirm')?.value || '';
  const plaza    = document.getElementById('sol_plaza')?.value || '';
  const rol      = document.getElementById('sol_rol_solicitado')?.value || '';
  const btn      = document.getElementById('btnEnviarSolicitud');

  if (!nombre || !email) {
    await _mexAlert('Solicitud incompleta', 'Nombre y correo son obligatorios.', 'warning'); return;
  }
  if (!rol) {
    await _mexAlert('Puesto requerido', 'Vuelve al paso anterior y selecciona el puesto.', 'warning'); return;
  }
  if (!pass || pass.length < 6) {
    await _mexAlert('Contraseña corta', 'La contraseña debe tener mínimo 6 caracteres.', 'warning'); return;
  }
  if (pass !== confirm) { await _mexAlert('Contraseña distinta', 'Las contraseñas no coinciden.', 'warning'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await _mexAlert('Correo inválido', 'Ingresa un correo electrónico válido.', 'warning'); return;
  }
  if (telefono && !/^[0-9+\-\s()]{7,20}$/.test(telefono)) {
    await _mexAlert('Teléfono inválido', 'Revisa el formato del teléfono.', 'warning'); return;
  }

  btn.disabled = true;
  btn.innerText = 'ENVIANDO...';

  try {
    await db.collection(REQUEST_COLLECTION).doc(email).set({
      nombre,
      email,
      puesto: rol,
      telefono,
      password: pass,
      rolSolicitado: rol,
      plazaSolicitada: plaza || null,
      empresaId: _solEmpresa?.id || null,
      empresaNombre: _solEmpresa?.nombre || null,
      fecha: new Date().toLocaleString('es-MX', { timeZone: 'America/Mazatlan' }),
      estado: 'PENDIENTE',
      _ts: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedFrom: 'public_solicitud',
      source: 'solicitud_publica'
    });
    cerrarModalSolicitud();
    await _mexAlert('Solicitud enviada', 'Un administrador la revisará pronto y te asignará acceso.', 'success');
  } catch (e) {
    console.error('[login.js] enviarSolicitud:', e);
    const code = String(e?.code || '');
    if (code.includes('already-exists') || code.includes('permission-denied')) {
      await _mexAlert('Solicitud no disponible', 'Ya existe una solicitud para este correo o no es posible modificarla desde este formulario.', 'warning');
    } else {
      await _mexAlert('Error al enviar', 'Intenta de nuevo.', 'error');
    }
  } finally {
    btn.disabled = false;
    btn.innerText = 'ENVIAR SOLICITUD';
  }
};

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

document.addEventListener('DOMContentLoaded', () => {
  const emailEl = document.getElementById('auth_email');
  const passEl  = document.getElementById('auth_pass');

  const tryLogin = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    loginManual();
  };
  emailEl?.addEventListener('keydown', tryLogin);
  passEl?.addEventListener('keydown',  tryLogin);

  // Paso 1: Enter en el campo de código de empresa inicia búsqueda
  document.getElementById('sol_empresa_id')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); window.solBuscarEmpresa(); }
  });

  // Paso 3: Enter en campos de datos personales envía la solicitud
  ['sol_nombre', 'sol_email', 'sol_pass', 'sol_pass_confirm'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); window.enviarSolicitudAcceso(); }
    });
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('modal-solicitud')?.style.display === 'flex') {
      cerrarModalSolicitud();
    }
  });
});
