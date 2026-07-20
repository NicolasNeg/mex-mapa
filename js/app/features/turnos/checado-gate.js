// ═══════════════════════════════════════════════════════════
//  checado-gate.js — wizard modal INICIAR / CERRAR TURNO
//  Cámara + face (Human.js) + geo soft-warn + firma digital.
//  Paridad ChecadorGLOBAL: firma en entrada + pantalla de éxito.
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
  capturarFoto,
  detenerCamara,
} from '/js/app/features/turnos/camera.js';
import { obtenerUbicacion, evaluarGeoPlaza } from '/js/app/features/turnos/geo-check.js';

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
 * @param {{ mode: 'inicio'|'cierre', user: object, plazaId: string, requireFace?: boolean }} opts
 * @returns {Promise<{ cancelled: true } | object>}
 */
export function runChecadoGate(opts = {}) {
  ensureGateCss();
  const mode = opts.mode === 'cierre' ? 'cierre' : 'inicio';
  const requireFace = opts.requireFace !== false && mode === 'inicio';
  const faceOptional = mode === 'cierre';
  // Firma digital obligatoria solo al iniciar turno (config: signature).
  const requireSigna = opts.signature !== false && mode === 'inicio';
  const user = opts.user || {};
  const plazaId = String(opts.plazaId || '').toUpperCase().trim();

  return new Promise((resolve) => {
    let settled = false;
    let faceLoopId = null;
    let faceEscapeId = null;
    let streamOk = false;
    let geo = { lat: null, lon: null, accuracy: 0, status: 'pendiente' };
    let faceDescriptor = normalizarDescriptor(user.faceDescriptor);
    let result = {
      lat: null,
      lon: null,
      direccion: null,
      faceVerified: false,
      faceSimilarity: null,
      viveza: null,
      antiSpoof: null,
      fotoDataURL: null,
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

    const setFaceEstado = (estado) => {
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
    };

    function detenerGateFacial() {
      if (faceLoopId) { clearInterval(faceLoopId); faceLoopId = null; }
      if (faceEscapeId) { clearTimeout(faceEscapeId); faceEscapeId = null; }
    }

    function habilitarShutter() {
      const btn = $('#tuGateShutter');
      if (!btn) return;
      btn.disabled = false;
      btn.removeAttribute('aria-disabled');
      btn.classList.add('face-listo');
      if (navigator.vibrate) navigator.vibrate(40);
    }

    // ── Bind global ───────────────────────────────────────
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-gate-action]');
      if (!btn) return;
      const action = btn.dataset.gateAction;
      if (action === 'cancel') cancel();
      else if (action === 'enrol-start') startEnrolar();
      else if (action === 'skip-face') {
        detenerGateFacial();
        result.faceVerified = false;
        habilitarShutter();
        setFaceEstado('sincara');
        const skip = $('#tuGateSkip');
        if (skip) skip.hidden = true;
      } else if (action === 'shutter') takePhoto();
      else if (action === 'retake') {
        $('#tuGateVideoSec').hidden = false;
        $('#tuGatePreviewSec').hidden = true;
        if (requireFace || (faceOptional && faceDescriptor)) {
          startVerifyLoop();
        } else {
          habilitarShutter();
        }
      } else if (action === 'confirm-photo') void confirmPhoto();
      else if (action === 'geo-continue') proceedAfterPhoto();
      else if (action === 'firma-clear') limpiarFirma();
      else if (action === 'firma-confirm') void confirmarFirma();
    });

    // ── Boot ──────────────────────────────────────────────
    void boot();

    async function boot() {
      showStep('permisos');
      try {
        try {
          await solicitarCamara();
          streamOk = true;
        } catch (_) {
          showStep('error');
          $('#tuGateErrorMsg').textContent =
            'No se pudo acceder a la cámara. Activa el permiso e inténtalo de nuevo.';
          return;
        }

        // Geo en paralelo: no bloquear el wizard facial mientras el GPS responde.
        void obtenerUbicacion({ force: false }).then((g) => {
          geo = g;
          result.lat = geo.lat;
          result.lon = geo.lon;
        }).catch(() => {});

        if (requireFace && !faceDescriptor) {
          showEnrolIntro();
        } else {
          showScan();
        }
      } catch (e) {
        console.warn('[checado-gate] boot:', e);
        showStep('error');
        $('#tuGateErrorMsg').textContent = e?.message || 'No se pudieron solicitar permisos.';
      }
    }

    function showEnrolIntro() {
      showStep('enrolar');
      $('#tuGateEnrolIntro').hidden = false;
      $('#tuGateEnrolStage').hidden = true;
      $('#tuGateEnrolChip').hidden = true;
      const video = $('#tuGateVideoEnrol');
      if (video) iniciarPreview(video);
    }

    function startEnrolar() {
      $('#tuGateEnrolIntro').hidden = true;
      $('#tuGateEnrolStage').hidden = false;
      $('#tuGateEnrolChip').hidden = false;
      const video = $('#tuGateVideoEnrol');
      if (video) iniciarPreview(video);
      void gateEnrolar(video);
    }

    async function gateEnrolar(video) {
      detenerGateFacial();
      const set = (e) => {
        const ring = $('#tuGateEnrolRing');
        const chip = $('#tuGateEnrolChip');
        if (ring) ring.dataset.estado = e;
        if (chip) {
          chip.dataset.estado = e;
          const icon = chip.querySelector('.tu-gate__status-icon');
          const txt = chip.querySelector('.tu-gate__status-txt');
          if (icon) icon.textContent = FACE_ICON[e] || 'face';
          if (txt) txt.textContent = FACE_TXT[e] || '';
        }
      };
      set('cargando');
      try {
        await cargarMotor();
      } catch (e) {
        console.error('[checado-gate] Human no cargó:', e);
        set('error');
        setTimeout(() => showScan({ skipFace: true }), 1600);
        return;
      }

      let ocupado = false;
      faceLoopId = setInterval(async () => {
        if (ocupado || settled) return;
        ocupado = true;
        try {
          const cara = await analizar(video);
          if (!cara) { set('sincara'); return; }
          if (cara.real < UMBRAL_REAL || cara.live < UMBRAL_VIVEZA) {
            set('liveness');
            return;
          }
          set('enrolando');
          faceDescriptor = Array.from(cara.embedding);
          result.enrolled = true;
          result.viveza = cara.live;
          result.antiSpoof = cara.real;
          set('match');
          detenerGateFacial();
          if (navigator.vibrate) navigator.vibrate(40);
          setTimeout(() => showScan(), 900);
        } catch (e) {
          console.error('[checado-gate] enrol:', e);
        } finally {
          ocupado = false;
        }
      }, 400);
    }

    function showScan({ skipFace = false } = {}) {
      showStep('scan');
      const video = $('#tuGateVideo');
      iniciarPreview(video);
      $('#tuGateVideoSec').hidden = false;
      $('#tuGatePreviewSec').hidden = true;

      const shutter = $('#tuGateShutter');
      shutter.disabled = true;
      shutter.setAttribute('aria-disabled', 'true');
      shutter.classList.remove('face-listo');
      const skip = $('#tuGateSkip');
      if (skip) skip.hidden = true;

      result.faceVerified = false;
      result.faceSimilarity = null;

      // Pre-calienta reverse geocode
      if (result.lat != null && result.lon != null) {
        void evaluarGeoPlaza(result.lat, result.lon, plazaId);
      }

      const needsFace = !skipFace && ((requireFace && faceDescriptor) || (faceOptional && faceDescriptor));
      if (needsFace) {
        startVerifyLoop();
      } else if (skipFace || (faceOptional && !faceDescriptor)) {
        // Motor facial no cargó (skipFace) o cierre sin enrolar: solo foto.
        // No forzar al usuario a encontrar el botón "saltar" — degradar directo.
        setFaceEstado('sincara');
        const chip = $('#tuGateChip');
        if (chip) {
          chip.querySelector('.tu-gate__status-txt').textContent = 'Toma una foto para continuar';
        }
        habilitarShutter();
      } else {
        setFaceEstado('error');
        if (skip) {
          skip.hidden = false;
          skip.textContent = 'Continuar sin verificar';
        }
        // Escape inmediato si no hay referencia
        habilitarShutter();
      }
    }

    function startVerifyLoop() {
      detenerGateFacial();
      setFaceEstado('cargando');
      const skip = $('#tuGateSkip');
      const escapeMs = faceOptional ? 5000 : 15000;
      faceEscapeId = setTimeout(() => {
        if (skip) {
          skip.hidden = false;
          skip.textContent = 'Continuar sin verificar';
        }
      }, escapeMs);

      void (async () => {
        try {
          await cargarMotor();
        } catch (e) {
          console.error('[checado-gate] Human:', e);
          setFaceEstado('error');
          if (skip) skip.hidden = false;
          return;
        }
        if (!faceDescriptor) {
          setFaceEstado('error');
          if (skip) skip.hidden = false;
          return;
        }

        let ocupado = false;
        faceLoopId = setInterval(async () => {
          if (ocupado || settled) return;
          ocupado = true;
          try {
            const video = $('#tuGateVideo');
            const cara = await analizar(video);
            if (!cara) { setFaceEstado('sincara'); return; }
            if (cara.real < UMBRAL_REAL || cara.live < UMBRAL_VIVEZA) {
              setFaceEstado('liveness');
              return;
            }
            const sim = similitud(cara.embedding, faceDescriptor);
            if (sim >= UMBRAL_SIMILITUD) {
              result.faceVerified = true;
              result.viveza = cara.live;
              result.antiSpoof = cara.real;
              result.faceSimilarity = Math.round(sim * 1000) / 1000;
              setFaceEstado('match');
              detenerGateFacial();
              habilitarShutter();
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

    function takePhoto() {
      detenerGateFacial();
      const video = $('#tuGateVideo');
      result.fotoDataURL = capturarFoto(video);
      const img = $('#tuGatePreviewImg');
      if (img) img.src = result.fotoDataURL;
      $('#tuGateVideoSec').hidden = true;
      $('#tuGatePreviewSec').hidden = false;
    }

    async function confirmPhoto() {
      // Refresh geo if missing
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
      proceedAfterPhoto();
    }

    /** Tras foto/geo: firma (entrada) o finalizar. */
    function proceedAfterPhoto() {
      if (requireSigna) showFirma();
      else void finalizeGate();
    }

    // ── Firma digital (canvas) ────────────────────────────
    let firmaCtx = null;
    let firmaDibujo = false;
    let firmaTieneTrazo = false;

    function showFirma() {
      showStep('firma');
      const canvas = $('#tuGateFirmaCanvas');
      if (!canvas) { void finalizeGate(); return; }
      // Ajustar resolución al tamaño real
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(300, rect.width) * dpr;
      canvas.height = Math.max(150, rect.height) * dpr;
      firmaCtx = canvas.getContext('2d');
      firmaCtx.scale(dpr, dpr);
      firmaCtx.lineWidth = 2.5;
      firmaCtx.lineCap = 'round';
      firmaCtx.lineJoin = 'round';
      firmaCtx.strokeStyle = '#0f172a';
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
      // Devolver descriptor enrolado para que mutations lo persista
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
 * @param {object} info { mode, hora, fecha, plaza, direccion, fotoDataURL, duracion }
 */
export function showChecadoExito(info = {}) {
  ensureGateCss();
  const esInicio = info.mode !== 'cierre';
  const overlay = document.createElement('div');
  overlay.className = 'tu-gate tu-gate--exito';
  overlay.setAttribute('role', 'dialog');
  overlay.innerHTML = `
<div class="tu-gate__backdrop"></div>
<div class="tu-gate__panel tu-gate__panel--exito">
  <div class="tu-exito__check"><span class="material-symbols-outlined">${esInicio ? 'login' : 'logout'}</span></div>
  <h2 class="tu-exito__title">${esInicio ? 'Turno iniciado' : 'Turno cerrado'}</h2>
  <p class="tu-exito__sub">${info.hora ? info.hora : ''}${info.fecha ? ` · ${info.fecha}` : ''}</p>
  ${info.fotoDataURL ? `<img class="tu-exito__foto" src="${info.fotoDataURL}" alt="Selfie">` : ''}
  <div class="tu-exito__rows">
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
    : 'Verificación facial y ubicación para abrir turno';
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
    <p>Solicitando cámara y ubicación…</p>
    <p id="tuGatePermisoGeo" class="tu-gate__hint" hidden>Sin ubicación — se registrará el turno igual.</p>
  </div>

  <div data-gate-step="enrolar" class="tu-gate__body tu-gate__body--foto" hidden>
    <div class="tu-gate-facescan">
      <video id="tuGateVideoEnrol" class="tu-gate-facescan__cam" autoplay playsinline muted></video>
      <div id="tuGateEnrolIntro" class="tu-gate-facescan__intro">
        <div class="tu-gate-facescan__intro-card">
          <span class="material-symbols-outlined tu-gate-facescan__intro-icon">face_retouching_natural</span>
          <h3>Registrar tu rostro</h3>
          <p>Lo guardamos una sola vez para confirmar tu identidad al iniciar turno.</p>
          <ul>
            <li>Rostro descubierto, mirando al frente</li>
            <li>Sin lentes oscuros, gorra ni cubrebocas</li>
            <li>Busca un lugar bien iluminado</li>
          </ul>
          <button type="button" class="tu-btn tu-btn--primary" data-gate-action="enrol-start">Comenzar</button>
        </div>
      </div>
      <div id="tuGateEnrolStage" class="tu-gate-facescan__stage" hidden>
        ${_frameHtml('tuGateEnrolRing')}
      </div>
      <div id="tuGateEnrolChip" class="tu-gate-facescan__status" data-estado="cargando" hidden>
        <span class="material-symbols-outlined tu-gate__status-icon">progress_activity</span>
        <span class="tu-gate__status-txt">Cargando verificación…</span>
      </div>
    </div>
  </div>

  <div data-gate-step="scan" class="tu-gate__body tu-gate__body--foto" hidden>
    <div id="tuGateVideoSec" class="tu-gate-facescan">
      <video id="tuGateVideo" class="tu-gate-facescan__cam" autoplay playsinline muted></video>
      <div class="tu-gate-facescan__stage">
        ${_frameHtml('tuGateRing')}
      </div>
      <div id="tuGateChip" class="tu-gate-facescan__status" data-estado="cargando">
        <span class="material-symbols-outlined tu-gate__status-icon">progress_activity</span>
        <span class="tu-gate__status-txt">Cargando verificación…</span>
      </div>
      <div class="tu-gate-facescan__actions">
        <button type="button" id="tuGateSkip" class="tu-gate-facescan__skip" data-gate-action="skip-face" hidden>Continuar sin verificar</button>
        <button type="button" id="tuGateShutter" class="tu-gate-facescan__shutter" data-gate-action="shutter" disabled aria-disabled="true" aria-label="Tomar foto">
          <span class="tu-gate-facescan__shutter-ring"></span>
        </button>
        <span class="tu-gate-facescan__shutter-lbl">Tomar foto</span>
      </div>
    </div>
    <div id="tuGatePreviewSec" class="tu-gate-facescan tu-gate-facescan--preview" hidden>
      <img id="tuGatePreviewImg" class="tu-gate-facescan__cam" alt="Vista previa">
      <p class="tu-gate-facescan__preview-hint">¿Se ve bien tu foto?</p>
      <div class="tu-gate-facescan__actions tu-gate-facescan__actions--confirm">
        <button type="button" class="tu-btn tu-btn--ghost" data-gate-action="retake">Repetir</button>
        <button type="button" class="tu-btn tu-btn--primary" data-gate-action="confirm-photo">Continuar</button>
      </div>
    </div>
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
    <span class="material-symbols-outlined tu-gate__warn-icon">location_off</span>
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
