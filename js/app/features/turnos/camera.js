// ═══════════════════════════════════════════════════════════
//  camera.js — preview y captura JPEG (selfie espejada)
//  Port de CHECADOR assets/js/camara.js
// ═══════════════════════════════════════════════════════════

let _stream = null;

export function getStream() {
  return _stream;
}

export async function solicitarCamara() {
  if (_stream?.active) return _stream;
  _stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user' },
    audio: false,
  });
  return _stream;
}

export function iniciarPreview(videoEl, stream = _stream) {
  if (!videoEl || !stream) return;
  _stream = stream;
  videoEl.srcObject = stream;
  // playsinline / muted ya en el markup; play() por si el browser lo exige
  const p = videoEl.play?.();
  if (p?.catch) p.catch(() => {});
}

/** Captura frame del video como dataURL JPEG (espejo horizontal). */
export function capturarFoto(videoEl, quality = 0.72) {
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth || 640;
  canvas.height = videoEl.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, 0, 0);
  return canvas.toDataURL('image/jpeg', quality);
}

export function dataUrlToBlob(dataUrl) {
  const [meta, b64] = String(dataUrl || '').split(',');
  if (!b64) return null;
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function detenerCamara() {
  if (_stream) {
    _stream.getTracks().forEach((t) => {
      try { t.stop(); } catch (_) {}
    });
  }
  _stream = null;
}
