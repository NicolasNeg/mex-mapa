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
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('La cámara no está disponible en este navegador o contexto (usa HTTPS).');
  }
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
