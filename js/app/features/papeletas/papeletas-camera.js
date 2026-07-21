/**
 * Guided fullscreen in-app camera for papeletas zone photos.
 * Primary: getUserMedia + capture. Fallback: <input capture> / gallery.
 */

/**
 * @typedef {{ id: string, label: string }} CameraZone
 * @typedef {{
 *   zones: CameraZone[],
 *   startIndex?: number,
 *   hasFoto?: (zonaId: string) => boolean,
 *   onCapture: (zona: CameraZone, index: number, file: File) => Promise<void>|void,
 *   onSkip?: (zona: CameraZone, index: number) => void,
 *   onMarkDamage?: (zona: CameraZone, index: number) => void,
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

  let idx = Math.max(0, Math.min(zones.length - 1, Number(opts.startIndex) || 0));
  let stream = null;
  let busy = false;
  let lastBlobUrl = '';
  let toastTimer = null;
  let closed = false;
  let starting = false;

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
      <button type="button" class="pap-camflow__icon" data-cam="dano" aria-label="Marcar daño">
        <span class="material-symbols-outlined">report</span>
      </button>
    </div>
    <div class="pap-camflow__stage">
      <video class="pap-camflow__video" playsinline webkit-playsinline muted autoplay></video>
      <img class="pap-camflow__shot" alt="" hidden/>
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
      <button type="button" class="pap-camflow__sec" data-cam="skip">Saltar</button>
      <button type="button" class="pap-camflow__shutter" data-cam="shutter" aria-label="Tomar foto">
        <span></span>
      </button>
      <label class="pap-camflow__sec pap-camflow__sec--file">
        <input type="file" accept="image/*" data-cam-file-gallery hidden/>
        Galería
      </label>
    </div>
    <div class="pap-camflow__hint" data-cam-hint></div>
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

  // iOS Safari needs these as properties, not only attributes.
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;

  function zone() {
    return zones[idx];
  }

  function hasLiveStream() {
    return !!(stream && stream.getTracks().some((t) => t.readyState === 'live'));
  }

  function setFallbackVisible(show) {
    // Only hard-error when there is truly no usable stream.
    fallback.hidden = !show;
    if (show) {
      video.classList.add('is-obscured');
    } else {
      video.classList.remove('is-obscured');
      video.hidden = false;
    }
  }

  function refreshChrome() {
    const z = zone();
    const n = idx + 1;
    const total = zones.length;
    const done = typeof opts.hasFoto === 'function' ? opts.hasFoto(z.id) : false;
    titleEl.textContent = `${n}/${total} · ${z.label}`;
    subEl.textContent = done ? 'Ya hay foto · puedes repetir' : 'Fotografía esta parte';
    hintEl.textContent = done
      ? 'Toca el obturador para retomar, o Saltar para seguir.'
      : 'Mantente en cámara: captura y avanza automático.';
  }

  function showToast(msg = 'Foto tomada') {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 900);
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
      const onMeta = () => {
        if (el.videoWidth > 0) finish(true);
      };
      const onPlaying = () => {
        if (el.videoWidth > 0) finish(true);
      };
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
    // play() may reject on some WebViews; stream can still paint after metadata.
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
        // Live preview even if first frame is still settling — never hard-error.
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
      const done = typeof opts.hasFoto === 'function' ? opts.hasFoto(z.id) : false;
      if (!done) return i;
    }
    return Math.min(from + 1, total - 1);
  }

  async function handleFile(file) {
    if (!file || busy || closed) return;
    busy = true;
    root.classList.add('is-busy');
    try {
      const preview = URL.createObjectURL(file);
      showPreview(preview);
      showToast('Foto tomada');
      await opts.onCapture(zone(), idx, file);
      const next = nextPendingIndex(idx);
      await new Promise((r) => setTimeout(r, 450));
      idx = next;
      showPreview('');
      refreshChrome();
    } catch (e) {
      showToast(e?.message || 'Error al guardar');
      showPreview('');
    } finally {
      busy = false;
      root.classList.remove('is-busy');
    }
  }

  async function onShutter() {
    if (busy || closed) return;
    if (!hasLiveStream() || video.hidden) {
      root.querySelector('[data-cam-file-capture]')?.click();
      return;
    }
    const file = await captureFromVideo();
    if (!file) {
      // Frame not ready yet — wait briefly then retry once before system camera.
      await waitForVideoReady(video, 1500);
      const retry = await captureFromVideo();
      if (!retry) {
        root.querySelector('[data-cam-file-capture]')?.click();
        return;
      }
      await handleFile(retry);
      return;
    }
    await handleFile(file);
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
    const btn = e.target.closest('[data-cam]');
    if (!btn) return;
    const act = btn.getAttribute('data-cam');
    if (act === 'close') close();
    if (act === 'shutter') onShutter();
    if (act === 'skip') {
      if (typeof opts.onSkip === 'function') opts.onSkip(zone(), idx);
      idx = Math.min(idx + 1, zones.length - 1);
      showPreview('');
      refreshChrome();
    }
    if (act === 'dano' && typeof opts.onMarkDamage === 'function') {
      opts.onMarkDamage(zone(), idx);
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
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
