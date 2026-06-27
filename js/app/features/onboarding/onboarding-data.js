import { db } from '/js/core/database.js';
import { buildEmpresaConfiguracion } from './onboarding-config.js';
import { TIPO_NEGOCIO } from '/js/core/constants.js';

// Single-tenant: la config del cliente vive en configuracion/empresa.
const CONFIG_COL = 'configuracion';
const CONFIG_DOC = 'empresa';
const COL_IMPORTACIONES = 'importaciones';

function _empresaRef() {
  return db.collection(CONFIG_COL).doc(CONFIG_DOC);
}

function _fv() {
  return window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || Date.now();
}

export async function iniciarOnboarding() {
  await _empresaRef().set({
    onboarding_completado: false,
    onboarding_paso: 'inicio',
  }, { merge: true });
}

// Producto especializado: el tipo de negocio es siempre arrendadora.
export async function configurarTipoNegocio() {
  const configuracion = buildEmpresaConfiguracion(TIPO_NEGOCIO);
  await _empresaRef().set({
    tipo_negocio: TIPO_NEGOCIO,
    configuracion,
    onboarding_paso: 'tipo',
  }, { merge: true });
}

export async function guardarPlazas(plazas) {
  const normalized = Array.isArray(plazas)
    ? plazas.map(p => ({
        nombre: String(p.nombre || '').trim(),
        capacidad: Number(p.capacidad) || 0,
      })).filter(p => p.nombre)
    : [];
  await _empresaRef().set({
    onboarding_plazas: normalized,
    plazas: normalized.map(p => p.nombre.toUpperCase()),
    onboarding_paso: 'plazas',
  }, { merge: true });
}

export async function completarOnboarding() {
  await _empresaRef().set({
    onboarding_completado: true,
    onboarding_paso: 'completo',
  }, { merge: true });
}

export async function getEstadoOnboarding() {
  const doc = await _empresaRef().get();
  if (!doc.exists) return null;
  const d = doc.data();
  return {
    onboarding_completado: d.onboarding_completado ?? false,
    onboarding_paso: d.onboarding_paso || null,
    tipo_negocio: d.tipo_negocio || null,
    configuracion: d.configuracion || null,
  };
}

export function onEstadoOnboarding(callback) {
  return _empresaRef().onSnapshot(
    snap => {
      if (!snap.exists) { callback({}); return; }
      const d = snap.data();
      callback({
        onboarding_completado: d.onboarding_completado ?? false,
        onboarding_paso: d.onboarding_paso || null,
        tipo_negocio: d.tipo_negocio || null,
        configuracion: d.configuracion || null,
        ...d,
      });
    },
    err => {
      console.warn('[onboarding] onSnapshot:', err?.message);
      callback({});
    }
  );
}

export async function registrarImportacion({ total, importados, errores }) {
  const ref = await db.collection(COL_IMPORTACIONES).add({
    total: Number(total) || 0,
    importados: Number(importados) || 0,
    errores: Array.isArray(errores) ? errores : [],
    timestamp: _fv(),
  });
  return ref.id;
}
