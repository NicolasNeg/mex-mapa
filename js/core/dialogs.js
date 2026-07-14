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

      function _ensureDialogStyles() {
        if (!document?.head) return;
        if (document.querySelector("link[data-mex-dialog-css], link[href=\"/css/dialogs.css\"], link[href$=\"/css/dialogs.css\"], link[href$=\"css/dialogs.css\"]")) return;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/css/dialogs.css";
        link.dataset.mexDialogCss = "true";
        document.head.appendChild(link);
      }

      function _ensureOverlay() {
        _ensureDialogStyles();
        let overlay = document.getElementById('mex-dialog-overlay');
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = 'mex-dialog-overlay';
        overlay.innerHTML = `
          <div class="mex-dlg-card" role="dialog" aria-modal="true" aria-labelledby="mex-dlg-title">
            <div class="mex-dlg-icon-row" id="mex-dlg-icon-row">
              <span class="material-icons mex-dlg-main-icon" id="mex-dlg-icon">info</span>
            </div>
            <div class="mex-dlg-body">
              <h3 class="mex-dlg-title" id="mex-dlg-title"></h3>
              <p class="mex-dlg-text" id="mex-dlg-text"></p>
              <div class="mex-dlg-input-wrap" id="mex-dlg-input-wrap" style="display:none;">
                <input class="mex-dlg-input" id="mex-dlg-input" type="text">
              </div>
            </div>
            <div class="mex-dlg-actions">
              <button type="button" class="mex-dlg-btn mex-dlg-btn-extra" id="mex-dlg-extra" style="display:none;"></button>
              <button type="button" class="mex-dlg-btn mex-dlg-btn-cancel" id="mex-dlg-cancel" style="display:none;"></button>
              <button type="button" class="mex-dlg-btn mex-dlg-btn-confirm" id="mex-dlg-confirm"></button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
      }

      window.mexDialog = function ({
        titulo = '',
        texto = '',
        tipo = 'info',
        icon,
        btnConfirmar = 'ACEPTAR',
        btnCancelar = null,
        btnExtra = null,
        valorConfirmar = true,
        valorCancelar = null,
        valorExtra = 'extra',
        input = null
      } = {}) {
        const dialogOptions = { titulo, texto, tipo, icon, btnConfirmar, btnCancelar, btnExtra, valorConfirmar, valorCancelar, valorExtra, input };
        try {
          if (!window.__MEX_DIALOG_STAY_LOCAL && window.parent && window.parent !== window && typeof window.parent.mexDialog === "function") {
            return window.parent.mexDialog(dialogOptions);
          }
        } catch (_) {}
        return new Promise(resolve => {
          const overlay = _ensureOverlay();
          const iconRow = document.getElementById('mex-dlg-icon-row');
          const iconEl = document.getElementById('mex-dlg-icon');
          const titleEl = document.getElementById('mex-dlg-title');
          const textEl = document.getElementById('mex-dlg-text');
          const inputWrap = document.getElementById('mex-dlg-input-wrap');
          const inputEl = document.getElementById('mex-dlg-input');
          const extraBtn = document.getElementById('mex-dlg-extra');
          const cancelBtn = document.getElementById('mex-dlg-cancel');
          const confirmBtn = document.getElementById('mex-dlg-confirm');
          const card = overlay?.querySelector('.mex-dlg-card');

          if (!overlay || !card || !iconRow || !iconEl || !titleEl || !textEl || !inputWrap || !inputEl || !extraBtn || !cancelBtn || !confirmBtn) {
            console.warn('[mexDialog] estructura incompleta');
            resolve(valorConfirmar);
            return;
          }

          // Clean up previous listeners if any
          if (_cleanup) { _cleanup(); _cleanup = null; }

          const cfg = tipoMap[tipo] || tipoMap.info;
          card.classList.toggle('mex-dlg-card--input', !!input);
          card.classList.toggle('mex-dlg-card--simple', !input);
          card.setAttribute('role', 'dialog');
          card.setAttribute('aria-modal', 'true');
          card.setAttribute('aria-labelledby', 'mex-dlg-title');

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

          if (btnExtra) {
            extraBtn.style.display = '';
            extraBtn.innerText = btnExtra;
            extraBtn.className = `mex-dlg-btn mex-dlg-btn-extra ${cfg.cls}`;
          } else {
            extraBtn.style.display = 'none';
            extraBtn.className = 'mex-dlg-btn mex-dlg-btn-extra';
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
            const val = input ? inputEl.value.trim() : valorConfirmar;
            hide(); resolve(val);
          }
          function onCancel() {
            hide(); resolve(valorCancelar);
          }
          function onExtra() {
            hide(); resolve(valorExtra);
          }

          const onKey = e => {
            if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
            if (e.key === 'Escape' && btnCancelar) { onCancel(); }
          };

          confirmBtn.onclick = onConfirm;
          cancelBtn.onclick = onCancel;
          extraBtn.onclick = onExtra;

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
