// domain/invitacion.model.js — lógica pura de códigos de invitación (sin Firebase).
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin O,0,I,1
const DIA_MS = 24 * 60 * 60 * 1000;

export function generarCodigo() {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  }
  return out;
}

export function nuevaInvitacion({ plaza, rol, expiraEnDias = 7, creadoPor }) {
  const ahora = Date.now();
  return {
    codigo: generarCodigo(),
    plaza: String(plaza || '').toUpperCase().trim(),
    rol: String(rol || 'AUXILIAR').toUpperCase().trim(),
    creadoPor: String(creadoPor || '').toLowerCase().trim(),
    creadoEnMs: ahora,
    expiraEnMs: ahora + Math.max(1, expiraEnDias) * DIA_MS,
    usadaPor: null,
    usadaEnMs: null,
    revocada: false,
  };
}

export function estadoInvitacion(doc, ahoraMs = Date.now()) {
  if (!doc) return 'REVOCADA';
  if (doc.revocada) return 'REVOCADA';
  if (doc.usadaPor) return 'USADA';
  if (ahoraMs > doc.expiraEnMs) return 'EXPIRADA';
  return 'VIGENTE';
}

export function puedeUsarse(doc, ahoraMs = Date.now()) {
  return estadoInvitacion(doc, ahoraMs) === 'VIGENTE';
}
