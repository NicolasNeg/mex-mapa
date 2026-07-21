// ═══════════════════════════════════════════════════════════
//  checado-gate.js — wizard modal INICIAR / CERRAR TURNO
//  Verificación de identidad SIN foto: biometría nativa del
//  dispositivo (Face ID / Touch ID / Windows Hello) → reconocimiento
//  facial en la app (Human.js, sin selfie) → PIN de 6 dígitos como
//  respaldo universal. Geo soft-warn + firma digital en inicio.
// ═══════════════════════════════════════════════════════════

import {
  cargarMotor,
  analizar,
  similitud,
  normalizarDescriptor,
  UMBRAL_SIMILITUD,
  UMBRAL_VIVEZA,
  UMBRAL_REAL,
} from '/js/app/features/turnos/face-verify.js';
import {
  solicitarCamara,
  iniciarPreview,
  detenerCamara,
} from '/js/app/features/turnos/camera.js';
import { obtenerUbicacion, evaluarGeoPlaza } from '/js/app/features/turnos/geo-check.js';
import {
  biometriaNativaDisponible,
  enrolarBiometriaNativa,
  verificarBiometriaNativa,
} from '/js/app/features/turnos/webauthn-check.js';
import {
  PIN_LENGTH,
  pinFormatValido,
  tienePinConfigurado,
  configurarPin,
  verificarPin,
} from '/js/app/features/turnos/pin-check.js';

const FACE_TXT = {
  cargando: 'Cargando verificación…',
  sincara: 'Centra tu rostro',
  liveness: 'Mira a la cámara, sin fotos',
  verificando: 'Verificando identidad…',
  enrolando: 'Registrando rostro…',
  match: 'Identidad confirmada',
  error: 'No se pudo verificar',
};

const FACE_ICON = {
  cargando: 'progress_activity',
  sincara: 'face',
  liveness: 'warning',
  verificando: 'face_retouching_natural',
  enrolando: 'person_add',
  match: 'check_circle',
  error: 'error',
};

function ensureGateCss() {
  if (document.querySelector('link[data-turnos-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/css/app-turnos.css';
  l.dataset.turnosCss = '1';
  document.head.appendChild(l);
}

/**
 * Abre el gate de checado.
 * @param {{ mode: 'inicio'|'cierre', user: object, docId: string, plazaId: string }} opts
 * @returns {Promise<{ cancelled: true } | object>}
 */
export function runChecadoGate(opts = {}) {
  ensureGateCss();
  const mode = opts.mode === 'cierre' ? 'cierre' : 'inicio';
  const requireSigna = opts.signature !== false && mode === 'inicio';
  const user = opts.user || {};
  const docId = String(opts.docId || user.id || '').trim();
  const plazaId = String(opts.plazaId || '').toUpperCase().trim();

  return new Promise((resolve) => {
    let settled = false;
    let faceLoopId = null;
    let geo = { lat: null, lon: null, accuracy: 0, status: 'pendiente' };
    let faceDescriptor = normalizarDescriptor(user.faceDescriptor);
    let webauthnCredentialId = String(user.webauthnCredentialId || '').trim();
    let pinConfigurado = tienePinConfigurado(user);
    let result = {
      lat: null,
      lon: null,
      direccion: null,
      metodo: null,
      faceVerified: false,
      faceSimilarity: null,
      viveza: null,
      antiSpoof: null,
      firmaDataURL: null,
      geoWarn: false,
      distanciaPlazaM: null,
      enrolled: false,
    };

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      detenerGateFacial();
      detenerCamara();
      overlay.remove();
      resolve(payload);
    };

    const cancel = () => finish({ cancelled: true });

    const overlay = document.createElement('div');
    overlay.className = 'tu-gate';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = _shellHtml(mode);
    document.body.appendChild(overlay);

    const $ = (sel) => overlay.querySelector(sel);
    const showStep = (name) => {
      overlay.querySelectorAll('[data-gate-step]').forEach((el) => {
        el.hidden = el.dataset.gateStep !== name;
      });
    };

    function detenerGateFacial() {
      if (faceLoopId) { clearInterval(faceLoopId); faceLoopId = null; }
    }

    // ── Bind global ───────────────────────────────────────
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-gate-action]');
      if (!btn) return;
      const action = btn.dataset.gateAction;
      if (action === 'cancel') cancel();
      else if (action === 'setup-webauthn') void setupWebauthn();
      else if (action === 'setup-face') showFaceStep({ enrolar: true });
      else if (action === 'setup-pin') showPinStep({ enrolar: true });
      else if (action === 'use-pin') showPinStep({ enrolar: !pinConfigurado });
      else if (action === 'retry-webauthn') void tryWebauthn();
      else if (action === 'geo-continue') proceedAfterVerificacion();
      else if (action === 'firma-clear') limpiarFirma();
      else if (action === 'firma-confirm') void confirmarFirma();
    });
    overlay.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-gate-form="pin"]');
      if (!form) return;
      e.preventDefault();
      void submitPin(form);
    });

    // ── Boot ──────────────────────────────────────────────
    void boot();

    async function boot() {
      showStep('permisos');
      // Geo en paralelo: nunca bloquea la verificación de identidad.
      void obtenerUbicacion({ force: false }).then((g) => {
        geo = g;
        result.lat = geo.lat;
        result.lon = geo.lon;
      }).catch(() => {});

      const nativaDisponible = await biometriaNativaDisponible().catch(() => false);
      const tieneAlgunMetodo = (nativaDisponible && webauthnCredentialId) || faceDescriptor || pinConfigurado;

      if (!tieneAlgunMetodo) {
        showEnrolarIntro(nativaDisponible);
        return;
      }

      if (nativaDisponible && webauthnCredentialId) {
        void tryWebauthn();
      } else if (faceDescriptor) {
        showFaceStep();
      } else {
        showPinStep();
      }
    }

    // ── Paso: elegir método (primera vez, nada enrolado) ──
    function showEnrolarIntro(nativaDisponible) {
      showStep('enrolar-intro');
      const btnNativa = $('#tuGateEnrolNativa');
      if (btnNativa) btnNativa.hidden = !nativaDisponible;
    }

    async function setupWebauthn() {
      try {
        webauthnCredentialId = await enrolarBiometriaNativa(docId, user.nombre || user.nombreCompleto || docId);
        result.metodo = 'webauthn';
        result.faceVerified = true; // "identidad confirmada" generico, no exclusivo de face
        proceedAfterVerificacion();
      } catch (e) {
        console.warn('[checado-gate] enrolar webauthn:', e);
        showPinStep({ enrolar: true });
      }
    }

    // ── Método: biometría nativa (Face ID / Touch ID / Windows Hello) ──
    async function tryWebauthn() {
      showStep('webauthn');
      const chip = $('#tuGateWaChip');
      if (chip) chip.textContent = 'Confirma con Face ID, Touch ID o Windows Hello…';
      const ok = await verificarBiometriaNativa(webauthnCredentialId);
      if (ok) {
        result.metodo = 'webauthn';
        result.faceVerified = true;
        proceedAfterVerificacion();
        return;
      }
      if (chip) chip.textContent = 'No se pudo confirmar. Intenta de nuevo o usa otro método.';
      const retry = $('#tuGateWaRetry');
      if (retry) retry.hidden = false;
    }

    // ── Método: reconocimiento facial (sin foto) ──────────
    function showFaceStep({ enrolar = false } = {}) {
      showStep('face');
      const video = $('#tuGateVideo');
      const enrolarUi = $('#tuGateFaceEnrolIntro');
      const scanUi = $('#tuGateFaceScan');
      if (enrolar || !faceDescriptor) {
        if (enrolarUi) enrolarUi.hidden = false;
        if (scanUi) scanUi.hidden = true;
        void solicitarCamara().then((stream) => iniciarPreview(video, stream)).catch(() => {
          setFaceEstado('error');
          showPinStep({ enrolar: !pinConfigurado });
        });
      } else {
        if (enrolarUi) enrolarUi.hidden = true;
        if (scanUi) scanUi.hidden = false;
        void solicitarCamara().then((stream) => {
          iniciarPreview(video, stream);
          startVerifyLoop();
        }).catch(() => {
          setFaceEstado('error');
          showPinStep({ enrolar: !pinConfigurado });
        });
      }
    }

    overlay?.addEventListener('click', (e) => {
      if (e.target.closest('[data-gate-action="face-enrol-start"]')) void startEnrolarFace();
    });

    async function startEnrolarFace() {
      const enrolarUi = $('#tuGateFaceEnrolIntro');
      const scanUi = $('#tuGateFaceScan');
      if (enrolarUi) enrolarUi.hidden = true;
      if (scanUi) scanUi.hidden = false;
      const video = $('#tuGateVideo');
      setFaceEstado('cargando');
      try {
        await cargarMotor();
      } catch (e) {
        console.error('[checado-gate] Human no cargó:', e);
        showPinStep({ enrolar: !pinConfigurado });
        return;
      }
      let ocupado = false;
      faceLoopId = setInterval(async () => {
        if (ocupado || settled) return;
        ocupado = true;
        try {
          const cara = await analizar(video);
          if (!cara) { setFaceEstado('sincara'); return; }
          if (cara.real < UMBRAL_REAL || cara.live < UMBRAL_VIVEZA) { setFaceEstado('liveness'); return; }
          faceDescriptor = Array.from(cara.embedding);
          result.enrolled = true;
          result.viveza = cara.live;
          result.antiSpoof = cara.real;
          result.metodo = 'face';
          result.faceVerified = true;
          setFaceEstado('match');
          detenerGateFacial();
          if (navigator.vibrate) navigator.vibrate(40);
          setTimeout(() => proceedAfterVerificacion(), 700);
        } catch (e) {
          console.error('[checado-gate] enrol face:', e);
        } finally {
          ocupado = false;
        }
      }, 400);
    }

    function setFaceEstado(estado) {
      const ring = $('#tuGateRing');
      const chip = $('#tuGateChip');
      if (ring) ring.dataset.estado = estado;
      if (chip) {
        chip.dataset.estado = estado;
        const icon = chip.querySelector('.tu-gate__status-icon');
        const txt = chip.querySelector('.tu-gate__status-txt');
        if (icon) icon.textContent = FACE_ICON[estado] || 'face';
        if (txt) txt.textContent = FACE_TXT[estado] || '';
      }
    }

    function startVerifyLoop() {
      detenerGateFacial();
      setFaceEstado('cargando');
      void (async () => {
        try {
          await cargarMotor();
        } catch (e) {
          console.error('[checado-gate] Human:', e);
          showPinStep({ enrolar: !pinConfigurado });
          return;
        }
        let ocupado = false;
        const escapeAt = Date.now() + 12000;
        faceLoopId = setInterval(async () => {
          if (ocupado || settled) return;
          if (Date.now() > escapeAt) {
            detenerGateFacial();
            const skip = $('#tuGateFaceSkip');
            if (skip) skip.hidden = false;
            return;
          }
          ocupado = true;
          try {
            const video = $('#tuGateVideo');
            const cara = await analizar(video);
            if (!cara) { setFaceEstado('sincara'); return; }
            if (cara.real < UMBRAL_REAL || cara.live < UMBRAL_VIVEZA) { setFaceEstado('liveness'); return; }
            const sim = similitud(cara.embedding, faceDescriptor);
            if (sim >= UMBRAL_SIMILITUD) {
              result.metodo = 'face';
              result.faceVerified = true;
              result.viveza = cara.live;
              result.antiSpoof = cara.real;
              result.faceSimilarity = Math.round(sim * 1000) / 1000;
              setFaceEstado('match');
              detenerGateFacial();
              setTimeout(() => proceedAfterVerificacion(), 500);
            } else {
              setFaceEstado('verificando');
            }
          } catch (e) {
            console.error('[checado-gate] verify:', e);
          } finally {
            ocupado = false;
          }
        }, 400);
      })();
    }

    // ── Método: PIN de 6 dígitos ───────────────────────────
    function showPinStep({ enrolar = false } = {}) {
      detenerGateFacial();
      detenerCamara();
      showStep('pin');
      const title = $('#tuGatePinTitle');
      const input = $('#tuGatePinInput');
      const err = $('#tuGatePinError');
      if (title) title.textContent = enrolar ? `Crea tu PIN de ${PIN_LENGTH} dígitos` : 'Ingresa tu PIN';
      if (err) err.hidden = true;
      if (input) { input.value = ''; input.dataset.enrolar = enrolar ? '1' : '0'; setTimeout(() => input.focus(), 50); }
      const confirmWrap = $('#tuGatePinConfirmWrap');
      if (confirmWrap) confirmWrap.hidden = !enrolar;
    }

    async function submitPin(form) {
      const input = form.querySelector('#tuGatePinInput');
      const confirmInput = form.querySelector('#tuGatePinConfirm');
      const err = $('#tuGatePinError');
      const pin = String(input?.value || '').trim();
      const enrolar = input?.dataset.enrolar === '1';

      if (!pinFormatValido(pin)) {
        if (err) { err.textContent = `El PIN debe tener ${PIN_LENGTH} dígitos.`; err.hidden = false; }
        return;
      }
      if (enrolar) {
        const confirmPin = String(confirmInput?.value || '').trim();
        if (pin !== confirmPin) {
          if (err) { err.textContent = 'Los PIN no coinciden.'; err.hidden = false; }
          return;
        }
        try {
          await configurarPin(docId, pin);
          pinConfigurado = true;
          result.metodo = 'pin';
          result.faceVerified = true;
          proceedAfterVerificacion();
        } catch (e) {
          if (err) { err.textContent = e?.message || 'No se pudo guardar el PIN.'; err.hidden = false; }
        }
        return;
      }
      const ok = await verificarPin(user, pin);
      if (!ok) {
        if (err) { err.textContent = 'PIN incorrecto.'; err.hidden = false; }
        if (input) input.value = '';
        return;
      }
      result.metodo = 'pin';
      result.faceVerified = true;
      proceedAfterVerificacion();
    }

    // ── Tras verificar identidad (cualquier método): geo → firma ──
    async function proceedAfterVerificacion() {
      detenerGateFacial();
      detenerCamara();
      if (result.lat == null) {
        const g = await obtenerUbicacion({ force: true });
        result.lat = g.lat;
        result.lon = g.lon;
      }
      const evalGeo = await evaluarGeoPlaza(result.lat, result.lon, plazaId);
      result.direccion = evalGeo.direccion;
      result.geoWarn = evalGeo.geoWarn;
      result.distanciaPlazaM = evalGeo.distanciaPlazaM;

      if (result.geoWarn) {
        showStep('geo-warn');
        const msg = $('#tuGateGeoMsg');
        if (msg) {
          const km = (result.distanciaPlazaM / 1000).toFixed(1);
          msg.textContent =
            `Estás a ~${result.distanciaPlazaM >= 1000 ? km + ' km' : result.distanciaPlazaM + ' m'} de la plaza ${plazaId || ''}. ` +
            'Puedes continuar, pero quedará registrado.';
        }
        const dir = $('#tuGateGeoDir');
        if (dir) dir.textContent = result.direccion || `${result.lat?.toFixed(5)}, ${result.lon?.toFixed(5)}`;
        return;
      }
      if (requireSigna) showFirma();
      else void finalizeGate();
    }

    // ── Firma digital (canvas) ─────────────────────────────
    let firmaCtx = null;
    let firmaDibujo = false;
    let firmaTieneTrazo = false;

    function showFirma() {
      showStep('firma');
      const canvas = $('#tuGateFirmaCanvas');
      if (!canvas) { void finalizeGate(); return; }
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(300, rect.width) * dpr;
      canvas.height = Math.max(150, rect.height) * dpr;
      firmaCtx = canvas.getContext('2d');
      firmaCtx.scale(dpr, dpr);
      firmaCtx.lineWidth = 2.5;
      firmaCtx.lineCap = 'round';
      firmaCtx.lineJoin = 'round';
      const dark = document.body.classList.contains('dark-theme');
      firmaCtx.strokeStyle = dark ? '#f8fafc' : '#0f172a';
      firmaTieneTrazo = false;
      _setFirmaConfirm(false);

      const pos = (ev) => {
        const r = canvas.getBoundingClientRect();
        const p = ev.touches ? ev.touches[0] : ev;
        return { x: p.clientX - r.left, y: p.clientY - r.top };
      };
      const start = (ev) => { ev.preventDefault(); firmaDibujo = true; const { x, y } = pos(ev); firmaCtx.beginPath(); firmaCtx.moveTo(x, y); };
      const move = (ev) => {
        if (!firmaDibujo) return;
        ev.preventDefault();
        const { x, y } = pos(ev);
        firmaCtx.lineTo(x, y); firmaCtx.stroke();
        firmaTieneTrazo = true; _setFirmaConfirm(true);
      };
      const end = () => { firmaDibujo = false; };

      canvas.onmousedown = start; canvas.onmousemove = move;
      window.addEventListener('mouseup', end);
      canvas.ontouchstart = start; canvas.ontouchmove = move; canvas.ontouchend = end;
    }

    function _setFirmaConfirm(enabled) {
      const btn = $('#tuGateFirmaConfirm');
      if (btn) btn.disabled = !enabled;
    }

    function limpiarFirma() {
      const canvas = $('#tuGateFirmaCanvas');
      if (canvas && firmaCtx) firmaCtx.clearRect(0, 0, canvas.width, canvas.height);
      firmaTieneTrazo = false;
      _setFirmaConfirm(false);
    }

    async function confirmarFirma() {
      const canvas = $('#tuGateFirmaCanvas');
      if (!firmaTieneTrazo || !canvas) return;
      try { result.firmaDataURL = canvas.toDataURL('image/png'); }
      catch (e) { console.warn('[checado-gate] firma:', e); }
      await finalizeGate();
    }

    async function finalizeGate() {
      showStep('guardando');
      finish({
        cancelled: false,
        ...result,
        faceDescriptor: result.enrolled ? faceDescriptor : null,
      });
    }
  });
}

/**
 * Overlay de éxito tras registrar el turno (paridad ChecadorGLOBAL).
 * @param {object} info { mode, hora, fecha, plaza, direccion, metodo, duracion }
 */
export function showChecadoExito(info = {}) {
  ensureGateCss();
  const esInicio = info.mode !== 'cierre';
  const metodoLabel = { webauthn: 'Verificado con biometría del dispositivo', face: 'Verificado por reconocimiento facial', pin: 'Verificado con PIN' }[info.metodo] || 'Identidad verificada';
  const overlay = document.createElement('div');
  overlay.className = 'tu-gate tu-gate--exito';
  overlay.setAttribute('role', 'dialog');
  overlay.innerHTML = `
<div class="tu-gate__backdrop"></div>
<div class="tu-gate__panel tu-gate__panel--exito">
  <div class="tu-exito__check"><span class="material-symbols-outlined">${esInicio ? 'login' : 'logout'}</span></div>
  <h2 class="tu-exito__title">${esInicio ? 'Turno iniciado' : 'Turno cerrado'}</h2>
  <p class="tu-exito__sub">${info.hora ? info.hora : ''}${info.fecha ? ` · ${info.fecha}` : ''}</p>
  <div class="tu-exito__rows">
    <div class="tu-exito__row"><span class="material-symbols-outlined">verified_user</span><span>${metodoLabel}</span></div>
    ${info.plaza ? `<div class="tu-exito__row"><span class="material-symbols-outlined">store</span><span>${info.plaza}</span></div>` : ''}
    ${info.direccion ? `<div class="tu-exito__row"><span class="material-symbols-outlined">location_on</span><span>${info.direccion}</span></div>` : ''}
    ${info.duracion ? `<div class="tu-exito__row"><span class="material-symbols-outlined">timer</span><span>${info.duracion}</span></div>` : ''}
  </div>
  <button type="button" class="tu-btn tu-btn--primary tu-btn--full" data-exito-close>Listo</button>
</div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('[data-exito-close]')?.addEventListener('click', close);
  overlay.querySelector('.tu-gate__backdrop')?.addEventListener('click', close);
  setTimeout(close, 6000);
}

function _shellHtml(mode) {
  const titulo = mode === 'cierre' ? 'Cerrar turno' : 'Iniciar turno';
  const sub = mode === 'cierre'
    ? 'Confirma tu identidad y ubicación para cerrar'
    : 'Verifica tu identidad y ubicación para abrir turno';
  return `
<div class="tu-gate__backdrop" data-gate-action="cancel"></div>
<div class="tu-gate__panel">
  <header class="tu-gate__header">
    <button type="button" class="tu-gate__close" data-gate-action="cancel" aria-label="Cancelar">
      <span class="material-symbols-outlined">close</span>
    </button>
    <div>
      <h2 class="tu-gate__title">${titulo}</h2>
      <p class="tu-gate__sub">${sub}</p>
    </div>
  </header>

  <div data-gate-step="permisos" class="tu-gate__body tu-gate__body--center">
    <div class="tu-gate__spinner"></div>
    <p>Preparando verificación…</p>
  </div>

  <div data-gate-step="enrolar-intro" class="tu-gate__body tu-gate__body--center" hidden>
    <span class="material-symbols-outlined tu-gate__warn-icon" style="color:#3b82f6">verified_user</span>
    <h3>Configura tu verificación</h3>
    <p class="tu-gate__hint">La usarás cada vez que inicies o cierres turno. Elige una:</p>
    <div class="tu-gate__row" style="flex-direction:column;gap:10px;width:100%;max-width:320px;margin:12px auto 0;">
      <button type="button" id="tuGateEnrolNativa" class="tu-btn tu-btn--primary tu-btn--full" data-gate-action="setup-webauthn" hidden>
        <span class="material-symbols-outlined">fingerprint</span> Face ID / Touch ID del equipo
      </button>
      <button type="button" class="tu-btn tu-btn--ghost tu-btn--full" data-gate-action="setup-face">
        <span class="material-symbols-outlined">face</span> Reconocimiento facial
      </button>
      <button type="button" class="tu-btn tu-btn--ghost tu-btn--full" data-gate-action="setup-pin">
        <span class="material-symbols-outlined">pin</span> PIN de ${PIN_LENGTH} dígitos
      </button>
    </div>
  </div>

  <div data-gate-step="webauthn" class="tu-gate__body tu-gate__body--center" hidden>
    <span class="material-symbols-outlined tu-gate__warn-icon" style="color:#3b82f6">fingerprint</span>
    <p id="tuGateWaChip">Confirma con Face ID, Touch ID o Windows Hello…</p>
    <div class="tu-gate__row">
      <button type="button" id="tuGateWaRetry" class="tu-btn tu-btn--ghost" data-gate-action="retry-webauthn" hidden>Reintentar</button>
      <button type="button" class="tu-btn tu-btn--ghost" data-gate-action="use-pin">Usar PIN en su lugar</button>
    </div>
  </div>

  <div data-gate-step="face" class="tu-gate__body tu-gate__body--foto" hidden>
    <div id="tuGateFaceEnrolIntro" class="tu-gate-facescan__intro-standalone" hidden>
      <div class="tu-gate-facescan__intro-card">
        <span class="material-symbols-outlined tu-gate-facescan__intro-icon">face_retouching_natural</span>
        <h3>Registrar tu rostro</h3>
        <p>Lo guardamos una sola vez para confirmar tu identidad. No se toma ninguna foto.</p>
        <ul>
          <li>Rostro descubierto, mirando al frente</li>
          <li>Sin lentes oscuros, gorra ni cubrebocas</li>
          <li>Busca un lugar bien iluminado</li>
        </ul>
        <button type="button" class="tu-btn tu-btn--primary" data-gate-action="face-enrol-start">Comenzar</button>
        <button type="button" class="tu-btn tu-btn--ghost" data-gate-action="use-pin">Usar PIN en su lugar</button>
      </div>
    </div>
    <div id="tuGateFaceScan" class="tu-gate-facescan" hidden>
      <video id="tuGateVideo" class="tu-gate-facescan__cam" autoplay playsinline muted></video>
      <div class="tu-gate-facescan__stage">
        ${_frameHtml('tuGateRing')}
      </div>
      <div id="tuGateChip" class="tu-gate-facescan__status" data-estado="cargando">
        <span class="material-symbols-outlined tu-gate__status-icon">progress_activity</span>
        <span class="tu-gate__status-txt">Cargando verificación…</span>
      </div>
      <div class="tu-gate-facescan__actions">
        <button type="button" id="tuGateFaceSkip" class="tu-gate-facescan__skip" data-gate-action="use-pin" hidden>Usar PIN en su lugar</button>
      </div>
    </div>
  </div>

  <div data-gate-step="pin" class="tu-gate__body tu-gate__body--center" hidden>
    <span class="material-symbols-outlined tu-gate__warn-icon" style="color:#3b82f6">pin</span>
    <h3 id="tuGatePinTitle">Ingresa tu PIN</h3>
    <form data-gate-form="pin" class="tu-gate__row" style="flex-direction:column;gap:10px;width:100%;max-width:260px;margin:0 auto;">
      <input id="tuGatePinInput" type="password" inputmode="numeric" pattern="\\d*" maxlength="${PIN_LENGTH}" placeholder="••••••" class="tu-input" style="text-align:center;font-size:22px;letter-spacing:6px;" autocomplete="off">
      <div id="tuGatePinConfirmWrap" hidden>
        <input id="tuGatePinConfirm" type="password" inputmode="numeric" pattern="\\d*" maxlength="${PIN_LENGTH}" placeholder="Confirma tu PIN" class="tu-input" style="text-align:center;font-size:22px;letter-spacing:6px;width:100%;box-sizing:border-box;" autocomplete="off">
      </div>
      <p id="tuGatePinError" class="tu-gate__hint" style="color:#ef4444" hidden></p>
      <button type="submit" class="tu-btn tu-btn--primary tu-btn--full">Confirmar</button>
    </form>
  </div>

  <div data-gate-step="firma" class="tu-gate__body tu-gate__body--firma" hidden>
    <h3 class="tu-gate__firma-title">Firma para confirmar</h3>
    <p class="tu-gate__hint">Dibuja tu firma con el dedo o el mouse.</p>
    <div class="tu-gate-firma">
      <canvas id="tuGateFirmaCanvas" class="tu-gate-firma__canvas"></canvas>
      <span class="tu-gate-firma__line"></span>
    </div>
    <div class="tu-gate__row">
      <button type="button" class="tu-btn tu-btn--ghost" data-gate-action="firma-clear">Limpiar</button>
      <button type="button" id="tuGateFirmaConfirm" class="tu-btn tu-btn--primary" data-gate-action="firma-confirm" disabled>Confirmar</button>
    </div>
  </div>

  <div data-gate-step="geo-warn" class="tu-gate__body tu-gate__body--center" hidden>
    <span class="material-symbols-outlined tu-gate__warn-icon" style="color:#f59e0b">location_off</span>
    <h3>Ubicación lejos de la plaza</h3>
    <p id="tuGateGeoMsg" class="tu-gate__geo-msg"></p>
    <p id="tuGateGeoDir" class="tu-gate__hint"></p>
    <div class="tu-gate__row">
      <button type="button" class="tu-btn tu-btn--ghost" data-gate-action="cancel">Cancelar</button>
      <button type="button" class="tu-btn tu-btn--primary" data-gate-action="geo-continue">Continuar de todos modos</button>
    </div>
  </div>

  <div data-gate-step="guardando" class="tu-gate__body tu-gate__body--center" hidden>
    <div class="tu-gate__spinner"></div>
    <p>Registrando turno…</p>
  </div>

  <div data-gate-step="error" class="tu-gate__body tu-gate__body--center" hidden>
    <span class="material-symbols-outlined tu-gate__warn-icon" style="color:#ef4444">error</span>
    <p id="tuGateErrorMsg"></p>
    <button type="button" class="tu-btn tu-btn--primary" data-gate-action="cancel">Cerrar</button>
  </div>
</div>`;
}

function _frameHtml(id) {
  return `
<div id="${id}" class="tu-gate-facescan__frame" data-estado="cargando">
  <span class="tu-gate-facescan__ticks" aria-hidden="true"></span>
  <svg class="tu-gate-facescan__guide" viewBox="0 0 100 112" aria-hidden="true">
    <path d="M50 14c-16 0-25 13-25 31 0 21 13 36 25 36s25-15 25-36c0-18-9-31-25-31z"/>
    <circle cx="39" cy="48" r="2.6"/><circle cx="61" cy="48" r="2.6"/>
    <path d="M41 64c4 4 14 4 18 0"/>
  </svg>
  <span class="tu-gate-facescan__scan" aria-hidden="true"></span>
  <span class="tu-gate-facescan__check" aria-hidden="true">
    <span class="material-symbols-outlined">check</span>
  </span>
</div>`;
}
