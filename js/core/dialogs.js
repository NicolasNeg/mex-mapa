    // ─── mexDialog — Sistema global de diálogos ──────────────────────────────────
    // Reemplaza alert(), confirm() y prompt() con un diseño propio.
    //
    // Uso:
    //   mexDialog({ titulo, texto, tipo, icon, btnConfirmar, btnCancelar, input })
    //     .then(resultado => { /* true|false|string|null */ })
    //
    //   tipo: 'info' | 'success' | 'warning' | 'danger' | 'error'
    //   input: { tipo:'text'|'number', placeholder:'...', valor:'...' }  ← activa campo de entrada
    //   btnCancelar: string  ← si se incluye, aparece botón de cancelar (resolve null)
    //
    // Shortcuts:
    //   mexAlert(titulo, texto, tipo?)            → Promise<true>
    //   mexConfirm(titulo, texto, tipo?)          → Promise<boolean>
    //   mexPrompt(titulo, texto, placeholder?, inputTipo?, valor?) → Promise<string|null>

    (function () {
      const tipoMap = {
        info: { icon: 'info', cls: 'dlg-info' },
        success: { icon: 'check_circle', cls: 'dlg-success' },
        warning: { icon: 'warning', cls: 'dlg-warning' },
        danger: { icon: 'dangerous', cls: 'dlg-danger' },
        error: { icon: 'error', cls: 'dlg-error' },
      };

      let _cleanup = null;

      window.mexDialog = function ({ titulo = '', texto = '', tipo = 'info', icon, btnConfirmar = 'ACEPTAR', btnCancelar = null, input = null } = {}) {
        return new Promise(resolve => {
          const overlay = document.getElementById('mex-dialog-overlay');
          const iconRow = document.getElementById('mex-dlg-icon-row');
          const iconEl = document.getElementById('mex-dlg-icon');
          const titleEl = document.getElementById('mex-dlg-title');
          const textEl = document.getElementById('mex-dlg-text');
          const inputWrap = document.getElementById('mex-dlg-input-wrap');
          const inputEl = document.getElementById('mex-dlg-input');
          const cancelBtn = document.getElementById('mex-dlg-cancel');
          const confirmBtn = document.getElementById('mex-dlg-confirm');
          const card = overlay.querySelector('.mex-dlg-card');

          // Clean up previous listeners if any
          if (_cleanup) { _cleanup(); _cleanup = null; }

          const cfg = tipoMap[tipo] || tipoMap.info;

          // Icon row
          iconRow.className = `mex-dlg-icon-row ${cfg.cls}`;
          iconEl.innerText = icon || cfg.icon;

          // Content
          titleEl.innerText = titulo;
          textEl.innerText = texto;

          // Input field
          if (input) {
            inputWrap.style.display = 'block';
            inputEl.type = input.tipo || 'text';
            inputEl.placeholder = input.placeholder || '';
            inputEl.value = input.valor || '';
            setTimeout(() => inputEl.focus(), 60);
          } else {
            inputWrap.style.display = 'none';
            inputEl.value = '';
          }

          // Cancel button
          if (btnCancelar) {
            cancelBtn.style.display = '';
            cancelBtn.innerText = btnCancelar;
          } else {
            cancelBtn.style.display = 'none';
          }

          // Confirm button
          confirmBtn.innerText = btnConfirmar;
          confirmBtn.className = `mex-dlg-btn mex-dlg-btn-confirm ${cfg.cls}`;

          // Show with animation
          overlay.classList.add('active');
          card.style.animation = 'none';
          void card.offsetWidth;
          card.style.animation = '';

          function hide() {
            overlay.classList.remove('active');
            document.removeEventListener('keydown', onKey);
            _cleanup = null;
          }

          function onConfirm() {
            const val = input ? inputEl.value.trim() : true;
            hide(); resolve(val);
          }
          function onCancel() {
            hide(); resolve(null);
          }

          const onKey = e => {
            if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
            if (e.key === 'Escape' && btnCancelar) { onCancel(); }
          };

          confirmBtn.onclick = onConfirm;
          cancelBtn.onclick = onCancel;

          // Close on overlay click (only if there's a cancel button)
          overlay.onclick = e => { if (e.target === overlay && btnCancelar) onCancel(); };

          document.addEventListener('keydown', onKey);
          _cleanup = () => document.removeEventListener('keydown', onKey);
        });
      };

      // Shortcuts
      window.mexAlert = function (titulo, texto, tipo = 'info') {
        return window.mexDialog({ titulo, texto, tipo, btnConfirmar: 'ENTENDIDO' });
      };

      window.mexConfirm = function (titulo, texto, tipo = 'warning') {
        return window.mexDialog({ titulo, texto, tipo, btnConfirmar: 'SÍ', btnCancelar: 'CANCELAR' })
          .then(r => r !== null);
      };

      window.mexPrompt = function (titulo, texto, placeholder = '', inputTipo = 'text', valor = '') {
        return window.mexDialog({
          titulo, texto, tipo: 'info',
          input: { tipo: inputTipo, placeholder, valor },
          btnConfirmar: 'ACEPTAR', btnCancelar: 'CANCELAR'
        });
      };
    })();
