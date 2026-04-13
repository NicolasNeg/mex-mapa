    // ── Registrar Service Worker ──────────────────────────────
    if ('serviceWorker' in navigator) {
      window.__mexSwRegistrationPromise = new Promise(resolve => {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js')
            .then(reg => {
              window.__mexSwRegistration = reg;
              console.log('✅ SW registrado:', reg.scope);
              resolve(reg);
            })
            .catch(err => {
              console.warn('SW error:', err);
              resolve(null);
            });
        }, { once: true });
      });
    }

    // ── Indicador offline / online ────────────────────────────
    (function () {
      const banner = document.getElementById('offline-banner');
      const msg = document.getElementById('offline-banner-msg');

      function actualizarEstado() {
        if (!navigator.onLine) {
          banner.style.display = 'flex';
          msg.textContent = 'Sin conexión — mostrando datos guardados';
        } else {
          msg.textContent = 'Conexión restaurada ✓';
          banner.style.display = 'flex';
          setTimeout(() => { banner.style.display = 'none'; }, 2500);
        }
      }

      window.addEventListener('offline', actualizarEstado);
      window.addEventListener('online', actualizarEstado);
      // Estado inicial — solo mostrar si ya está offline al cargar
      if (!navigator.onLine) actualizarEstado();
    })();

    // ── Prompt de instalación "Añadir a pantalla" ─────────────
    let _deferredInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      _deferredInstallPrompt = e;
      // Mostrar botón de instalación si existe en el DOM
      const btn = document.getElementById('btnInstalarPWA');
      if (btn) btn.style.display = 'flex';
    });

    window.addEventListener('appinstalled', () => {
      _deferredInstallPrompt = null;
      const btn = document.getElementById('btnInstalarPWA');
      if (btn) btn.style.display = 'none';
      showToast('App instalada correctamente', 'success');
    });

    function instalarPWA() {
      if (!_deferredInstallPrompt) return;
      _deferredInstallPrompt.prompt();
      _deferredInstallPrompt.userChoice.then(result => {
        if (result.outcome === 'accepted') showToast('Instalando Mapa...', 'success');
        _deferredInstallPrompt = null;
      });
    }
