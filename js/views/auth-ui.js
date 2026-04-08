    // ── Mostrar / ocultar contraseña ──────────────────────────
    function togglePassword(inputId, iconEl) {
      var input = document.getElementById(inputId);
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
    }

    // ── Error visual en el login ──────────────────────────────
    function showLoginError(msg) {
      var el = document.getElementById('login-error');
      var msgEl = document.getElementById('login-error-msg');
      if (!el) return;
      el.style.display = 'flex';
      if (msgEl) msgEl.innerText = msg;
      else el.innerText = msg;
    }

    function hideLoginError() {
      var el = document.getElementById('login-error');
      if (el) el.style.display = 'none';
    }

    // ── Reset de botones al volver a la pantalla de login ─────
    function _resetLoginButtons() {
      var btnM = document.getElementById('btnLoginManual');
      var btnG = document.getElementById('btnGoogleLogin');
      if (btnM) { btnM.disabled = false; btnM.innerText = 'INICIAR SESIÓN'; }
      if (btnG) {
        btnG.disabled = false;
        btnG.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width:18px;"> CUENTA DE GOOGLE';
      }
      hideLoginError();
    }

    // ── Login con correo y contraseña ─────────────────────────
    async function loginManual() {
      var email = document.getElementById('auth_email').value.trim();
      var pass = document.getElementById('auth_pass').value.trim();
      var remember = document.getElementById('auth_remember') ? document.getElementById('auth_remember').checked : true;
      var btn = document.getElementById('btnLoginManual');

      if (!email || !pass) {
        showLoginError('Ingresa correo y contraseña.');
        return;
      }

      btn.disabled = true;
      btn.innerText = 'VERIFICANDO...';
      hideLoginError();

      try {
        // Persistencia: LOCAL = sobrevive cierre de navegador, SESSION = sólo pestaña actual
        var persistence = remember
          ? firebase.auth.Auth.Persistence.LOCAL
          : firebase.auth.Auth.Persistence.SESSION;

        await firebase.auth().setPersistence(persistence);
        await firebase.auth().signInWithEmailAndPassword(email, pass);
        // onAuthStateChanged toma el control desde aquí
      } catch (err) {
        btn.disabled = false;
        btn.innerText = 'INICIAR SESIÓN';
        var msg;
        switch (err.code) {
          case 'auth/wrong-password':
          case 'auth/invalid-credential': msg = 'Contraseña incorrecta.'; break;
          case 'auth/user-not-found': msg = 'Correo no registrado.'; break;
          case 'auth/invalid-email': msg = 'Formato de correo inválido.'; break;
          case 'auth/too-many-requests': msg = 'Demasiados intentos. Espera un poco.'; break;
          case 'auth/user-disabled': msg = 'Esta cuenta ha sido deshabilitada.'; break;
          default: msg = 'Error al iniciar sesión.';
        }
        showLoginError(msg);
      }
    }

    // ── Login con Google ──────────────────────────────────────
    function loginConGoogle() {
      var provider = new firebase.auth.GoogleAuthProvider();
      var btn = document.getElementById('btnGoogleLogin');
      btn.disabled = true;
      btn.innerHTML = '<span class="material-icons" style="font-size:16px;animation:spin 1s linear infinite">sync</span> CONECTANDO...';
      hideLoginError();

      firebase.auth().signInWithPopup(provider).catch(function (err) {
        btn.disabled = false;
        btn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width:18px;"> CUENTA DE GOOGLE';
        if (err.code !== 'auth/popup-closed-by-user') {
          showLoginError('Error con Google. Intenta de nuevo.');
        }
      });
    }

    // ── Solicitud de acceso ───────────────────────────────────
    function abrirModalSolicitud() {
      document.getElementById('modal-solicitud').style.display = 'flex';
    }
    function cerrarModalSolicitud() {
      document.getElementById('modal-solicitud').style.display = 'none';
    }
