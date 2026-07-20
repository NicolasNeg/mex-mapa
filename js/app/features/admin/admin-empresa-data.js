/**
 * Datos / mutaciones de la sección Empresa (panel admin SPA).
 */
import { db, storage } from '/js/core/database.js';
import { hasAppPermission } from '/js/app/features/admin/admin-permissions.js';

const COLOR_KEYS = [
  { key: 'colorPrincipal', label: 'Principal', default: '#004a99', hint: 'Barra, botones' },
  { key: 'colorSecundario', label: 'Secundario', default: '#1d4ed8', hint: 'Acentos, hover' },
  { key: 'colorAcento', label: 'Acento', default: '#f59e0b', hint: 'Alertas, highlights' },
  { key: 'colorTexto', label: 'Texto', default: '#0f172a', hint: 'Texto principal' }
];

export function empresaColorKeys() {
  return COLOR_KEYS.slice();
}

export function canEditEmpresa(profile, role) {
  const r = String(role || '').trim().toUpperCase();
  if (r === 'PROGRAMADOR' || r === 'JEFE_OPERACION' || r === 'CORPORATIVO_USER') return true;
  return hasAppPermission(profile, role, 'manage_system_settings')
    || hasAppPermission(profile, role, 'manage_settings');
}

export function getEmpresaSnapshot() {
  const emp = window.MEX_CONFIG?.empresa || {};
  return {
    nombre: String(emp.nombre || '').trim(),
    logoURL: String(emp.logoURL || emp.logoUrl || emp.logo || '').trim(),
    correoEmpresa: String(emp.correoEmpresa || '').trim(),
    correoFacturacion: String(emp.correoFacturacion || '').trim(),
    colorPrincipal: String(emp.colorPrincipal || '#004a99'),
    colorSecundario: String(emp.colorSecundario || '#1d4ed8'),
    colorAcento: String(emp.colorAcento || '#f59e0b'),
    colorTexto: String(emp.colorTexto || '#0f172a'),
    correosInternos: Array.isArray(emp.correosInternos)
      ? emp.correosInternos.map(c => String(c || '').trim()).filter(Boolean)
      : []
  };
}

function _ensureEmpresa() {
  if (!window.MEX_CONFIG) window.MEX_CONFIG = {};
  if (!window.MEX_CONFIG.empresa || typeof window.MEX_CONFIG.empresa !== 'object') {
    window.MEX_CONFIG.empresa = {};
  }
  return window.MEX_CONFIG.empresa;
}

export async function saveEmpresaFields(fields = {}) {
  const emp = _ensureEmpresa();
  if (fields.nombre != null) emp.nombre = String(fields.nombre || '').trim();
  if (fields.correoEmpresa != null) emp.correoEmpresa = String(fields.correoEmpresa || '').trim();
  if (fields.correoFacturacion != null) emp.correoFacturacion = String(fields.correoFacturacion || '').trim();
  for (const { key } of COLOR_KEYS) {
    if (fields[key] != null) {
      const hex = String(fields[key] || '').trim();
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) emp[key] = hex.toLowerCase();
    }
  }
  if (Array.isArray(fields.correosInternos)) {
    emp.correosInternos = fields.correosInternos
      .map(c => String(c || '').trim().toLowerCase())
      .filter(Boolean);
  }
  await db.collection('configuracion').doc('empresa').set(emp, { merge: true });
  try {
    if (typeof window.__mexInvalidateConfigCache === 'function') {
      window.__mexInvalidateConfigCache();
    }
  } catch (_) { /* ignore */ }
  return getEmpresaSnapshot();
}

export async function uploadEmpresaLogo(file) {
  if (!file) throw new Error('Selecciona una imagen.');
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('Solo se permiten imágenes.');
  }
  if (file.size > 2 * 1024 * 1024) throw new Error('El archivo no debe superar 2MB.');
  if (!storage?.ref) throw new Error('Firebase Storage no está disponible.');
  const extRaw = (String(file.name || '').split('.').pop() || 'png').toLowerCase();
  const ext = extRaw.replace(/[^a-z0-9]/g, '') || 'png';
  const ref = storage.ref(`empresa_config/logo.${ext}`);
  const snap = await ref.put(file, { contentType: file.type || 'image/png' });
  const url = await snap.ref.getDownloadURL();
  const emp = _ensureEmpresa();
  emp.logoURL = url;
  await db.collection('configuracion').doc('empresa').set({ logoURL: url }, { merge: true });
  return url;
}

export async function deleteEmpresaLogo() {
  const emp = _ensureEmpresa();
  const url = String(emp.logoURL || '').trim();
  if (url) {
    try {
      if (typeof firebase !== 'undefined' && firebase.storage) {
        await firebase.storage().refFromURL(url).delete();
      } else if (storage?.refFromURL) {
        await storage.refFromURL(url).delete();
      }
    } catch (_) { /* ignore missing */ }
  }
  emp.logoURL = '';
  await db.collection('configuracion').doc('empresa').set({ logoURL: '' }, { merge: true });
  return true;
}
