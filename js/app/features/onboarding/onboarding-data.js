import { db } from '/js/core/database.js';
import { buildEmpresaConfiguracion } from './onboarding-config.js';

const COL_EMPRESAS = 'empresas';
const COL_IMPORTACIONES = 'importaciones';

function _fv() {
  return window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || Date.now();
}

export async function iniciarOnboarding(empresaId) {
  if (!empresaId) throw new Error('empresaId requerido');
  await db.collection(COL_EMPRESAS).doc(empresaId).update({
    onboarding_completado: false,
    onboarding_paso: 'inicio',
  });
}

export async function configurarTipoNegocio(empresaId, tipoNegocio) {
  if (!empresaId || !tipoNegocio) throw new Error('empresaId y tipoNegocio requeridos');
  const configuracion = buildEmpresaConfiguracion(tipoNegocio);
  await db.collection(COL_EMPRESAS).doc(empresaId).update({
    tipo_negocio: tipoNegocio,
    configuracion,
    onboarding_paso: 'tipo',
  });
}

export async function guardarPlazas(empresaId, plazas) {
  if (!empresaId) throw new Error('empresaId requerido');
  const normalized = Array.isArray(plazas)
    ? plazas.map(p => ({
        nombre: String(p.nombre || '').trim(),
        capacidad: Number(p.capacidad) || 0,
      })).filter(p => p.nombre)
    : [];
  await db.collection(COL_EMPRESAS).doc(empresaId).update({
    onboarding_plazas: normalized,
    onboarding_paso: 'plazas',
  });
}

export async function completarOnboarding(empresaId) {
  if (!empresaId) throw new Error('empresaId requerido');
  await db.collection(COL_EMPRESAS).doc(empresaId).update({
    onboarding_completado: true,
    onboarding_paso: 'completo',
  });
}

export async function getEstadoOnboarding(empresaId) {
  if (!empresaId) return null;
  const doc = await db.collection(COL_EMPRESAS).doc(empresaId).get();
  if (!doc.exists) return null;
  const d = doc.data();
  return {
    onboarding_completado: d.onboarding_completado ?? false,
    onboarding_paso: d.onboarding_paso || null,
    tipo_negocio: d.tipo_negocio || null,
    configuracion: d.configuracion || null,
  };
}

export function onEstadoOnboarding(empresaId, callback) {
  if (!empresaId) { callback({}); return () => {}; }
  return db.collection(COL_EMPRESAS).doc(empresaId).onSnapshot(
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

export async function registrarImportacion(empresaId, { total, importados, errores }) {
  if (!empresaId) throw new Error('empresaId requerido');
  const ref = await db.collection(COL_IMPORTACIONES).add({
    empresaId,
    total: Number(total) || 0,
    importados: Number(importados) || 0,
    errores: Array.isArray(errores) ? errores : [],
    timestamp: _fv(),
  });
  return ref.id;
}
