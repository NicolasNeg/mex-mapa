// ═══════════════════════════════════════════════════════════
//  face-verify.js — verificación facial (vladmandic/human)
//  Port de CHECADOR assets/js/face.js
// ═══════════════════════════════════════════════════════════

export const UMBRAL_SIMILITUD = 0.60;
export const UMBRAL_VIVEZA = 0.60; // face.live
export const UMBRAL_REAL = 0.60;   // face.real (anti-spoof)

const CFG = {
  modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human/models/',
  backend: 'webgl',
  filter: { enabled: true },
  face: {
    enabled: true,
    detector: { rotation: false, maxDetected: 1 },
    mesh: { enabled: true },
    description: { enabled: true },
    antispoof: { enabled: true },
    liveness: { enabled: true },
    iris: { enabled: false },
    emotion: { enabled: false },
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: false },
};

let _human = null;

/** Carga diferida del motor (~10MB CDN, cacheable). */
export async function cargarMotor() {
  if (_human) return _human;
  const { default: Human } = await import(
    'https://cdn.jsdelivr.net/npm/@vladmandic/human/dist/human.esm.js'
  );
  _human = new Human(CFG);
  await _human.load();
  await _human.warmup();
  return _human;
}

/** Analiza un frame de video. Devuelve null si no hay cara con embedding. */
export async function analizar(videoEl) {
  if (!_human) await cargarMotor();
  const res = await _human.detect(videoEl);
  const f = res.face && res.face[0];
  if (!f || !f.embedding) return null;
  return {
    embedding: f.embedding,
    live: f.live ?? 0,
    real: f.real ?? 0,
    box: f.box,
  };
}

/** Similitud coseno 0..1 (1 = idénticos). */
export function similitud(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return Math.max(0, dot / (Math.sqrt(na) * Math.sqrt(nb)));
}

/** Normaliza un descriptor guardado en Firestore (array o map indexado). */
export function normalizarDescriptor(raw) {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map(Number).filter(Number.isFinite);
  }
  if (typeof raw === 'object') {
    const keys = Object.keys(raw)
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!keys.length) return null;
    return keys.map((k) => Number(raw[k])).filter(Number.isFinite);
  }
  return null;
}
