// ═══════════════════════════════════════════════════════════
//  js/app/features/mensajes/mensajes-attachments.js
//  Attachment handling: file staging, audio recording,
//  image lightbox, document icons.
// ═══════════════════════════════════════════════════════════

// ── Audio MIME helpers ────────────────────────────────────

function _audioMimeCandidates() {
  return [
    'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4',
    'audio/aac', 'audio/ogg;codecs=opus', 'audio/ogg'
  ];
}

export function audioMimeType() {
  if (typeof window.MediaRecorder === 'undefined') return '';
  if (typeof window.MediaRecorder.isTypeSupported !== 'function') return '';
  return _audioMimeCandidates().find(t => window.MediaRecorder.isTypeSupported(t)) || '';
}

export function audioExtFromMime(mimeType = '') {
  const v = String(mimeType || '').toLowerCase();
  if (v.includes('mp4') || v.includes('aac') || v.includes('m4a')) return 'm4a';
  if (v.includes('ogg')) return 'ogg';
  if (v.includes('wav')) return 'wav';
  return 'webm';
}

export async function getUserMediaAudio() {
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (_) {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
  }
  const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
  if (!legacy) throw new Error('Tu navegador no soporta micrófono en esta versión.');
  return new Promise((resolve, reject) => legacy.call(navigator, { audio: true }, resolve, reject));
}

// ── Document icon ─────────────────────────────────────────

export function docIconForExt(ext) {
  const e = (ext || '').toLowerCase();
  if (['pdf'].includes(e)) return 'picture_as_pdf';
  if (['doc', 'docx'].includes(e)) return 'description';
  if (['xls', 'xlsx'].includes(e)) return 'table_chart';
  if (['ppt', 'pptx'].includes(e)) return 'slideshow';
  return 'insert_drive_file';
}

// ── Linkify text ──────────────────────────────────────────

export function linkifyText(text) {
  const urlPattern = /(https?:\/\/[^\s<]+)/g;
  return text.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

// ── File validation ───────────────────────────────────────

export function validateFile(file) {
  if (!file) return 'No se seleccionó archivo.';
  if (file.size > 10 * 1024 * 1024) return 'Archivo demasiado grande (máx 10MB).';
  return null;
}

export function isImageFile(name) {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(name || '');
}

export function isAudioFile(name) {
  return /\.(ogg|mp3|wav|m4a|webm)$/i.test(name || '');
}
