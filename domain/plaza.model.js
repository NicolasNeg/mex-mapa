// domain/plaza.model.js
// Reglas puras de negocio del catálogo de Plazas (branches). Sin Firebase.

const PLAZA_KEY_RE = /^[A-Z0-9_-]{2,12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizarPlazaKey(raw) {
  return String(raw || '').trim().toUpperCase();
}

/** @returns {string} mensaje de error, o '' si es válida. */
export function validarPlazaKey(key, plazasExistentes = []) {
  const k = normalizarPlazaKey(key);
  if (!k) return 'Escribe una clave para la plaza.';
  if (!PLAZA_KEY_RE.test(k)) return 'La clave solo puede tener letras, números, "-" o "_" (2 a 12 caracteres).';
  const existentes = (Array.isArray(plazasExistentes) ? plazasExistentes : []).map(normalizarPlazaKey);
  if (existentes.includes(k)) return 'Esa plaza ya existe.';
  return '';
}

export function normalizarContacto(c = {}) {
  return {
    nombre: String(c?.nombre || '').trim().toUpperCase(),
    rol: String(c?.rol || '').trim().toUpperCase(),
    telefono: String(c?.telefono || '').trim()
  };
}

export function normalizarContactos(lista = []) {
  return (Array.isArray(lista) ? lista : [])
    .map(normalizarContacto)
    .filter(c => c.nombre || c.telefono);
}

/** @returns {string} mensaje de error, o '' si es válido. */
export function validarPlazaDetalle(datos = {}) {
  const correo = String(datos?.correo || '').trim();
  const correoGerente = String(datos?.correoGerente || '').trim();
  if (correo && !EMAIL_RE.test(correo)) return 'El correo institucional no es válido.';
  if (correoGerente && !EMAIL_RE.test(correoGerente)) return 'El correo del gerente no es válido.';
  if (correo && correoGerente && correo.toLowerCase() === correoGerente.toLowerCase()) {
    return 'Selecciona correos distintos para la plaza y la gerencia.';
  }
  return '';
}

/** Normaliza el objeto completo de detalle de una plaza (para guardar). */
export function normalizarPlazaDetalle(id, datos = {}) {
  return {
    id: normalizarPlazaKey(id),
    nombre: String(datos?.nombre || '').trim(),
    descripcion: String(datos?.descripcion || '').trim(),
    localidad: String(datos?.localidad || '').trim(),
    direccion: String(datos?.direccion || '').trim(),
    mapsUrl: String(datos?.mapsUrl || '').trim(),
    temporal: Boolean(datos?.temporal),
    correo: String(datos?.correo || '').trim().toLowerCase(),
    telefono: String(datos?.telefono || '').trim(),
    gerente: String(datos?.gerente || '').trim().toUpperCase(),
    correoGerente: String(datos?.correoGerente || '').trim().toLowerCase(),
    contactos: normalizarContactos(datos?.contactos)
  };
}
