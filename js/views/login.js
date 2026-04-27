// ═══════════════════════════════════════════════════════════
//  js/views/login.js  —  ES6 Module
//  Controlador de la vista /login
//
//  Responsabilidades:
//   1. Detectar si ya hay sesión activa → redirigir a /home
//   2. Manejar login con email/contraseña
//   3. Manejar login con Google
//   4. Enviar solicitudes de acceso
//   5. Toggle de contraseña visible/oculta
// ═══════════════════════════════════════════════════════════

import { auth, db, COL } from '/js/core/database.js';

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function unique(values = []) {
  return Array.from(new Set((values || []).map(upper).filter(Boolean)));
}

function requestPlazas() {
  const empresa = window.MEX_CONFIG?.empresa || {};
  const direct = Array.isArray(empresa.plazas) ? empresa.plazas : [];
  const detailed = Array.isArray(empresa.plazasDetalle)
    ? empresa.plazasDetalle.map(item => item?.id)
    : [];
  return unique([...direct, ...detailed]);
}

function populateSolicitudPlazas(selectedValue = '') {
  const select = document.getElementById('sol_plaza');
  if (!select) return [];
  const plazas = requestPlazas();
  if (!plazas.length) {
    select.innerHTML = '<option value="">No hay plazas disponibles</option>';
    select.disabled = true;
    return [];
  }
  select.disabled = false;
  select.innerHTML = '<option value="">Selecciona una plaza</option>' + plazas
    .map(plaza => `<option value="${plaza}">${plaza}</option>`)
    .join('');
  const preferred = upper(selectedValue || window.getMexCurrentPlaza?.() || '');
  if (preferred && plazas.includes(preferred)) select.value = preferred;
  return plazas;
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
    const emailNorm = user.email.trim().toLowerCase();
    const snap = await db.collection(COL.USERS)
      .where('email', '==', emailNorm).get();

    if (!snap.empty) {
      if (typeof window.__mexRequireLocationAccess === 'function') {
        await window.__mexRequireLocationAccess({
          title: 'Ubicacion obligatoria para entrar',
          copy: 'Antes de entrar al sistema necesitamos tu ubicacion exacta para auditar movimientos, configuraciones y actividad operativa.',
          allowLogout: true,
          force: true
        });
      }
      // Sesión válida → App Shell como destino principal post-login (Fase 6)
      // Fallback: si /app falla por alguna razón, el usuario puede ir a /home manualmente.
      window.location.href = '/app/dashboard';
    } else {
      _showError(`❌ El correo ${user.email} no tiene permisos en el sistema.`);
      await auth.signOut();
    }
  } catch (e) {
    console.error('[login.js] Error validando sesión:', e);
    _showError('❌ Error de conexión. Intenta de nuevo.');
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
    await firebase.auth().signInWithEmailAndPassword(email, pass);
    // onAuthStateChanged redirige automáticamente
  } catch (err) {
    btn.disabled = false;
    btn.innerText = 'INICIAR SESIÓN';
    const MSGS = {
      'auth/wrong-password':     'Contraseña incorrecta.',
      'auth/invalid-credential': 'Contraseña incorrecta.',
      'auth/user-not-found':     'Correo no registrado.',
      'auth/invalid-email':      'Formato de correo inválido.',
      'auth/too-many-requests':  'Demasiados intentos. Espera un poco.',
      'auth/user-disabled':      'Esta cuenta ha sido deshabilitada.',
    };
    _showError(MSGS[err.code] || 'Error al iniciar sesión.');
  }
};

// ── Login con Google ──────────────────────────────────────
window.loginConGoogle = function () {
  const provider = new firebase.auth.GoogleAuthProvider();
  const btn = document.getElementById('btnGoogleLogin');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons" style="font-size:16px;animation:spin 1s linear infinite">sync</span> CONECTANDO...';
  _hideError();

  firebase.auth().signInWithPopup(provider).catch((err) => {
    btn.disabled = false;
    btn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width:18px;"> CUENTA DE GOOGLE';
    if (err.code !== 'auth/popup-closed-by-user') {
      _showError('Error con Google. Intenta de nuevo.');
    }
  });
};

// ── Modal de solicitud de acceso ──────────────────────────
window.abrirModalSolicitud  = () => { document.getElementById('modal-solicitud').style.display = 'flex'; };
window.cerrarModalSolicitud = () => { document.getElementById('modal-solicitud').style.display = 'none'; };

window.enviarSolicitudAcceso = async function () {
  const REQUEST_COLLECTION = 'solicitudes';
  const nombre   = document.getElementById('sol_nombre').value.trim().toUpperCase();
  const email    = document.getElementById('sol_email').value.trim().toLowerCase();
  const puesto   = document.getElementById('sol_puesto').value.trim().toUpperCase();
  const plaza    = upper(document.getElementById('sol_plaza')?.value);
  const telefono = document.getElementById('sol_telefono').value.trim();
  const pass     = document.getElementById('sol_pass').value.trim();
  const confirm  = document.getElementById('sol_pass_confirm').value.trim();
  const btn      = document.getElementById('btnEnviarSolicitud');
  const plazasDisponibles = populateSolicitudPlazas(plaza);

  if (!nombre || !email || !puesto || !plaza || !pass) {
    alert('Completa los campos obligatorios.'); return;
  }
  if (!plazasDisponibles.includes(plaza)) { alert('Selecciona una plaza válida.'); return; }
  if (pass !== confirm) { alert('Las contraseñas no coinciden.'); return; }
  if (pass.length < 6)  { alert('La contraseña debe tener mínimo 6 caracteres.'); return; }

  btn.disabled = true;
  btn.innerText = 'ENVIANDO...';

  try {
    const docId = email;
    await db.collection(REQUEST_COLLECTION).doc(docId).set({
      nombre, email, puesto, telefono,
      password: pass,
      rolSolicitado: null,
      plazaSolicitada: plaza,
      fecha: new Date().toLocaleString('es-MX', { timeZone: 'America/Mazatlan' }),
      estado: 'PENDIENTE',
      _ts: firebase.firestore.FieldValue.serverTimestamp()
    });
    cerrarModalSolicitud();
    alert('✅ Solicitud enviada. Un administrador la revisará pronto.');
  } catch (e) {
    console.error('[login.js] enviarSolicitud:', e);
    if (String(e?.code || '').includes('permission-denied')) {
      alert('Ese correo ya tiene una solicitud pendiente o no se pudo registrar de nuevo.');
    } else {
      alert('Error al enviar. Intenta de nuevo.');
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
  const passEl = document.getElementById('auth_pass');
  const requestFields = ['sol_nombre', 'sol_email', 'sol_puesto', 'sol_plaza', 'sol_telefono', 'sol_pass', 'sol_pass_confirm']
    .map(id => document.getElementById(id))
    .filter(Boolean);

  const tryLogin = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    loginManual();
  };

  emailEl?.addEventListener('keydown', tryLogin);
  passEl?.addEventListener('keydown', tryLogin);

  requestFields.forEach(field => {
    field.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      if (field.id === 'sol_telefono') return;
      event.preventDefault();
      enviarSolicitudAcceso();
    });
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('modal-solicitud')?.style.display === 'flex') {
      cerrarModalSolicitud();
    }
  });

  Promise.resolve(window.__mexConfigReadyPromise).catch(() => null).finally(() => {
    populateSolicitudPlazas();
  });
});
