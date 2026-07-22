/**
 * Guided fullscreen in-app camera for papeletas zone photos (v3).
 * - Jump chips (no forced skip chain)
 * - Optimistic advance after capture (upload in background)
 * - Post-7 sheet: Daño específico | Continuar
 * - Landscape-stable chrome
 */

/**
 * @typedef {{ id: string, label: string, optional?: boolean }} CameraZone
 * @typedef {{
 *   zones: CameraZone[],
 *   startIndex?: number,
 *   hasFoto?: (zonaId: string) => boolean,
 *   hardZoneIds?: string[],
 *   onCapture: (zona: CameraZone, index: number, file: File) => Promise<void>|void,
 *   onSkip?: (zona: CameraZone, index: number) => void,
 *   onMarkDamage?: (zona: CameraZone, index: number) => void,
 *   onDamageExtra?: () => void,
 *   onComplete?: () => void,
 *   onClose?: () => void,
 * }} GuidedCameraOpts
 */

const CONSTRAINT_CHAIN = [
  { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
  { audio: false, video: { facingMode: 'environment' } },
  { audio: false, video: { facingMode: { ideal: 'user' } } },
  { audio: false, video: true },
];

/**
 * @param {GuidedCameraOpts} opts
 * @returns {{ close: () => void, setIndex: (i: number) => void }}
 */
export function openGuidedCamera(opts) {
  const zones = Array.isArray(opts.zones) ? opts.zones : [];
  if (!zones.length) throw new Error('Sin zonas para fotografiar');

  const hardIds = new Set(
    Array.isArray(opts.hardZoneIds) && opts.hardZoneIds.length
      ? opts.hardZoneIds
      : zones.filter((z) => !z.optional).map((z) => z.id)
  );

  let idx = Math.max(0, Math.min(zones.length - 1, Number(opts.startIndex) || 0));
  let stream = null;
  let busy = false;
  let lastBlobUrl = '';
  let toastTimer = null;
  let closed = false;
  let starting = false;
  let postSheetShown = false;

  const root = document.createElement('div');
  root.className = 'pap-camflow';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Cámara guiada de papeleta');
  root.innerHTML = `
    <div class="pap-camflow__bar">
      <button type="button" class="pap-camflow__icon" data-cam="close" aria-label="Cerrar">
        <span class="material-symbols-outlined">close</span>
      </button>
      <div class="pap-camflow__progress">
        <strong data-cam-title></strong>
        <span data-cam-sub></span>
      </div>
      <button type="button" class="pap-camflow__icon" data-cam="chips" aria-label="Zonas" title="Ir a zona">
        <span class="material-symbols-outlined">grid_view</span>
      </button>
    </div>
    <div class="pap-camflow__chips" data-cam-chips hidden role="tablist" aria-label="Zonas"></div>
    <div class="pap-camflow__stage">
      <video class="pap-camflow__video" playsinline webkit-playsinline muted autoplay></video>
      <img class="pap-camflow__shot" alt="" hidden/>
      <div class="pap-camflow__thumb-spin" data-cam-spin hidden aria-hidden="true"></div>
      <div class="pap-camflow__fallback" hidden>
        <p>No se pudo abrir la cámara en este dispositivo.</p>
        <label class="pap-camflow__pill">
          <input type="file" accept="image/*" capture="environment" data-cam-file-capture hidden/>
          Usar cámara del sistema
        </label>
      </div>
      <div class="pap-camflow__toast" data-cam-toast hidden>Foto tomada</div>
    </div>
    <div class="pap-camflow__dock">
      <button type="button" class="pap-camflow__sec" data-cam="dano">Daño</button>
      <button type="button" class="pap-camflow__shutter" data-cam="shutter" aria-label="Tomar foto">
        <span></span>
      </button>
      <label class="pap-camflow__sec pap-camflow__sec--file">
        <input type="file" accept="image/*" data-cam-file-gallery hidden/>
        Galería
      </label>
    </div>
    <div class="pap-camflow__hint" data-cam-hint></div>
    <div class="pap-camflow__sheet" data-cam-sheet hidden>
      <div class="pap-camflow__sheet-panel">
        <h3>Core completo</h3>
        <p>Las fotos obligatorias están listas. ¿Capturar daño específico o continuar?</p>
        <button type="button" class="pap-camflow__sheet-btn" data-cam="sheet-damage">Daño específico</button>
        <button type="button" class="pap-camflow__sheet-btn pap-camflow__sheet-btn--primary" data-cam="sheet-continue">Continuar</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  document.body.classList.add('pap-camflow-open');

  const video = /** @type {HTMLVideoElement} */ (root.querySelector('.pap-camflow__video'));
  const shot = root.querySelector('.pap-camflow__shot');
  const fallback = root.querySelector('.pap-camflow__fallback');
  const toastEl = root.querySelector('[data-cam-toast]');
  const titleEl = root.querySelector('[data-cam-title]');
  const subEl = root.querySelector('[data-cam-sub]');
  const hintEl = root.querySelector('[data-cam-hint]');
  const chipsEl = root.querySelector('[data-cam-chips]');
  const sheetEl = root.querySelector('[data-cam-sheet]');
  const spinEl = root.querySelector('[data-cam-spin]');

  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;

  function zone() {
    return zones[idx];
  }

  function hasFoto(id) {
    return typeof opts.hasFoto === 'function' ? !!opts.hasFoto(id) : false;
  }

  function hardDoneCount() {
    let n = 0;
    for (const z of zones) {
      if (hardIds.has(z.id) && hasFoto(z.id)) n += 1;
    }
    return n;
  }

  function hardTotal() {
    let n = 0;
    for (const z of zones) if (hardIds.has(z.id)) n += 1;
    return n || zones.length;
  }

  function allHardDone() {
    return [...hardIds].every((id) => hasFoto(id));
  }

  function hasLiveStream() {
    return !!(stream && stream.getTracks().some((t) => t.readyState === 'live'));
  }

  function setFallbackVisible(show) {
    fallback.hidden = !show;
    if (show) video.classList.add('is-obscured');
    else {
      video.classList.remove('is-obscured');
      video.hidden = false;
    }
  }

  function paintChips() {
    chipsEl.innerHTML = zones.map((z, i) => {
      const done = hasFoto(z.id);
      const hard = hardIds.has(z.id);
      return `<button type="button" class="pap-camflow__chip ${i === idx ? 'is-on' : ''} ${done ? 'is-done' : ''} ${hard ? '' : 'is-opt'}"
        data-cam-jump="${i}" role="tab">${_esc(z.label)}${done ? ' ✓' : ''}</button>`;
    }).join('');
  }

  function refreshChrome() {
    const z = zone();
    const done = hasFoto(z.id);
    const hd = hardDoneCount();
    const ht = hardTotal();
    titleEl.textContent = `${z.label}`;
    subEl.textContent = `Core ${hd}/${ht}${done ? ' · ya capturada' : ''}`;
    hintEl.textContent = done
      ? 'Toca una zona arriba para saltar, o el obturador para retomar.'
      : 'Captura y avanza al instante. Usa la cuadrícula para saltar.';
    paintChips();
  }

  function showToast(msg = 'Foto tomada') {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 700);
  }

  function showPreview(url) {
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = url || '';
    if (url) {
      shot.src = url;
      shot.hidden = false;
      video.hidden = true;
    } else {
      shot.hidden = true;
      shot.removeAttribute('src');
      video.hidden = false;
    }
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach((t) => {
        try { t.stop(); } catch (_) { /* ignore */ }
      });
      stream = null;
    }
    if (video) {
      try { video.pause(); } catch (_) { /* ignore */ }
      video.srcObject = null;
    }
  }

  function waitForVideoReady(el, timeoutMs = 4000) {
    if (el.videoWidth > 0 && el.videoHeight > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        el.removeEventListener('loadedmetadata', onMeta);
        el.removeEventListener('playing', onPlaying);
        clearTimeout(timer);
        resolve(ok);
      };
      const onMeta = () => { if (el.videoWidth > 0) finish(true); };
      const onPlaying = () => { if (el.videoWidth > 0) finish(true); };
      el.addEventListener('loadedmetadata', onMeta);
      el.addEventListener('playing', onPlaying);
      const timer = setTimeout(() => finish(el.videoWidth > 0), timeoutMs);
    });
  }

  async function tryGetUserMedia() {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    let lastErr = null;
    for (const constraints of CONSTRAINT_CHAIN) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    return null;
  }

  async function attachStream(mediaStream) {
    stopStream();
    stream = mediaStream;
    video.srcObject = mediaStream;
    video.hidden = false;
    await video.play().catch(() => {});
    const painted = await waitForVideoReady(video);
    return painted || hasLiveStream();
  }

  async function startStream() {
    if (closed || starting) return false;
    starting = true;
    setFallbackVisible(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setFallbackVisible(true);
        return false;
      }
      const mediaStream = await tryGetUserMedia();
      if (closed) {
        mediaStream?.getTracks().forEach((t) => t.stop());
        return false;
      }
      if (!mediaStream) {
        setFallbackVisible(true);
        return false;
      }
      const ok = await attachStream(mediaStream);
      if (closed) {
        stopStream();
        return false;
      }
      if (ok || hasLiveStream()) {
        setFallbackVisible(false);
        video.hidden = false;
        return true;
      }
      stopStream();
      setFallbackVisible(true);
      return false;
    } catch (_) {
      stopStream();
      if (!closed) setFallbackVisible(true);
      return false;
    } finally {
      starting = false;
    }
  }

  function captureFromVideo() {
    if (!hasLiveStream()) return null;
    const w = video.videoWidth || 0;
    const h = video.videoHeight || 0;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(null); return; }
        const file = new File([blob], `zona-${zone().id}-${Date.now()}.jpg`, { type: 'image/jpeg' });
        resolve(file);
      }, 'image/jpeg', 0.85);
    });
  }

  function nextPendingIndex(from) {
    const total = zones.length;
    for (let step = 1; step <= total; step += 1) {
      const i = (from + step) % total;
      const z = zones[i];
      if (hardIds.has(z.id) && !hasFoto(z.id)) return i;
    }
    for (let step = 1; step <= total; step += 1) {
      const i = (from + step) % total;
      if (!hasFoto(zones[i].id)) return i;
    }
    return from;
  }

  function maybeShowPostSheet() {
    if (postSheetShown || !allHardDone()) return false;
    postSheetShown = true;
    sheetEl.hidden = false;
    return true;
  }

  async function maybePromptRefaccion(capturedZone) {
    if (capturedZone?.id !== 'herramienta') return;
    if (typeof opts.onDamageExtra !== 'function') return;
    // Soft prompt: non-blocking via sheet-like confirm using native confirm is avoided —
    // use post toast + chip for refacción if present in zones.
    const refIdx = zones.findIndex((z) => z.id === 'refaccion');
    if (refIdx < 0) return;
    showToast('Opcional: foto de refacción');
  }

  /**
   * Advance UI immediately; upload in background with spinner on thumb.
   */
  function handleFile(file) {
    if (!file || busy || closed) return;
    const capturedZone = zone();
    const capturedIdx = idx;
    busy = true;
    root.classList.add('is-busy');
    spinEl.hidden = false;

    const preview = URL.createObjectURL(file);
    showPreview(preview);
    showToast('Foto tomada');

    // Optimistic: treat as done for navigation (caller should update hasFoto via onCapture)
    const next = nextPendingIndex(capturedIdx);

    // Advance UI synchronously after brief flash
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (closed) return;
        showPreview('');
        spinEl.hidden = true;
        maybePromptRefaccion(capturedZone);
        if (allHardDone() || (hardIds.has(capturedZone.id) && hardDoneCount() + (hasFoto(capturedZone.id) ? 0 : 1) >= hardTotal())) {
          // hasFoto may not yet reflect optimistic — check after onCapture settles
        }
        idx = next;
        refreshChrome();
        busy = false;
        root.classList.remove('is-busy');
      }, 120);
    });

    Promise.resolve(opts.onCapture(capturedZone, capturedIdx, file))
      .then(() => {
        if (closed) return;
        refreshChrome();
        if (allHardDone()) maybeShowPostSheet();
      })
      .catch((e) => {
        if (closed) return;
        showToast(e?.message || 'Error al guardar');
        refreshChrome();
      });
  }

  async function onShutter() {
    if (busy || closed) return;
    if (!hasLiveStream() || video.hidden) {
      root.querySelector('[data-cam-file-capture]')?.click();
      return;
    }
    const file = await captureFromVideo();
    if (!file) {
      await waitForVideoReady(video, 1500);
      const retry = await captureFromVideo();
      if (!retry) {
        root.querySelector('[data-cam-file-capture]')?.click();
        return;
      }
      handleFile(retry);
      return;
    }
    handleFile(file);
  }

  function close() {
    if (closed) return;
    closed = true;
    if (toastTimer) clearTimeout(toastTimer);
    stopStream();
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    root.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    root.remove();
    document.body.classList.remove('pap-camflow-open');
    if (typeof opts.onClose === 'function') opts.onClose();
  }

  function onClick(e) {
    const jump = e.target.closest('[data-cam-jump]');
    if (jump) {
      const i = Number(jump.getAttribute('data-cam-jump'));
      if (Number.isFinite(i)) {
        idx = Math.max(0, Math.min(zones.length - 1, i));
        chipsEl.hidden = true;
        showPreview('');
        refreshChrome();
      }
      return;
    }

    const btn = e.target.closest('[data-cam]');
    if (!btn) return;
    const act = btn.getAttribute('data-cam');
    if (act === 'close') close();
    if (act === 'shutter') onShutter();
    if (act === 'chips') {
      chipsEl.hidden = !chipsEl.hidden;
      paintChips();
    }
    if (act === 'dano') {
      if (typeof opts.onMarkDamage === 'function') opts.onMarkDamage(zone(), idx);
      else if (typeof opts.onDamageExtra === 'function') opts.onDamageExtra();
    }
    if (act === 'sheet-damage') {
      sheetEl.hidden = true;
      if (typeof opts.onDamageExtra === 'function') opts.onDamageExtra();
      else if (typeof opts.onMarkDamage === 'function') opts.onMarkDamage(zone(), idx);
    }
    if (act === 'sheet-continue') {
      sheetEl.hidden = true;
      if (typeof opts.onComplete === 'function') opts.onComplete();
      close();
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  root.querySelector('[data-cam-file-capture]')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) handleFile(f);
  });
  root.querySelector('[data-cam-file-gallery]')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) handleFile(f);
  });

  refreshChrome();
  // Show chips by default on open for jump UX
  chipsEl.hidden = false;
  startStream();

  return {
    close,
    setIndex(i) {
      idx = Math.max(0, Math.min(zones.length - 1, Number(i) || 0));
      showPreview('');
      refreshChrome();
    },
  };
}
