// empresa-context.js — SaaS multi-tenant context manager.
// Tracks which empresa the current user belongs to and loads its document
// from Firestore (empresas/{empresaId}).  Exposes window.mexEmpresaContext.
//
// Usage after login:
//   const empresa = await window.mexEmpresaContext.cargarParaUsuario(profile);
//
// Superadmin (PROGRAMADOR bootstrap) gets an all-access synthetic context;
// from the programador panel use switchEmpresa(id) to inspect any tenant.
(function () {
  'use strict';

  const SESSION_KEY = 'mex.empresaCtx.v1';
  const LOCAL_KEY   = 'mex.empresaCtx.local.v1';

  // ─── Storage helpers ──────────────────────────────────────────────────────

  function safeJsonParse(raw, fallback) {
    try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
  }

  function readStoredEmpresaId() {
    try {
      return safeJsonParse(sessionStorage.getItem(SESSION_KEY), null)
          || safeJsonParse(localStorage.getItem(LOCAL_KEY), null)
          || null;
    } catch (_) { return null; }
  }

  function writeStoredEmpresaId(id) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(id));
      localStorage.setItem(LOCAL_KEY, JSON.stringify(id));
    } catch (_) {}
  }

  function clearStoredEmpresaId() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(LOCAL_KEY);
    } catch (_) {}
  }

  // ─── Apply ────────────────────────────────────────────────────────────────

  function applyEmpresaGlobal(empresa) {
    window._empresaActual = empresa;
    if (empresa && empresa.configuracion) {
      try {
        window.MEX_CONFIG = window.MEX_CONFIG || {};
        window.MEX_CONFIG.empresa = window.MEX_CONFIG.empresa || {};
        window.MEX_CONFIG.empresa.configuracion = empresa.configuracion;
      } catch (_) {}
    }
    try {
      window.dispatchEvent(new CustomEvent('mex:empresa-change', {
        detail: { empresaId: empresa ? empresa.id : '', empresa }
      }));
    } catch (_) {}
  }

  // ─── Firestore fetch ──────────────────────────────────────────────────────

  async function fetchEmpresa(empresaId) {
    if (!empresaId || !window._db) return null;
    try {
      const doc = await window._db.collection('empresas').doc(empresaId).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    } catch (_) { return null; }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  // Call this right after loading the user profile on login.
  // Resolves and applies the empresa context for the authenticated user.
  async function cargarParaUsuario(profile) {
    if (!profile) return null;

    // Superadmin (bootstrap programmer) — synthetic all-access context.
    // No real empresa document; switchEmpresa() is used for inspection.
    if (profile.rol === 'PROGRAMADOR' && profile.bootstrapProgrammer === true) {
      const ctx = { id: '__superadmin__', isSuperAdminContext: true, nombre: 'SUPERADMIN', features: {} };
      applyEmpresaGlobal(ctx);
      writeStoredEmpresaId('__superadmin__');
      return ctx;
    }

    // Regular user: empresaId comes from their Firestore profile.
    const empresaId = String(profile.empresaId || '').trim()
                   || readStoredEmpresaId()
                   || null;

    if (!empresaId || empresaId === '__superadmin__') return null;

    const empresa = await fetchEmpresa(empresaId);
    if (empresa) {
      applyEmpresaGlobal(empresa);
      writeStoredEmpresaId(empresa.id);
    }
    return empresa;
  }

  // Superadmin only: switch active empresa context (programador panel).
  async function switchEmpresa(empresaId) {
    if (!empresaId) return null;
    const empresa = await fetchEmpresa(empresaId);
    if (!empresa) return null;
    applyEmpresaGlobal(empresa);
    writeStoredEmpresaId(empresa.id);
    return empresa;
  }

  // Restore the context from storage on page reload (before auth resolves).
  // Call early in bootstrap if you want _empresaActual available synchronously.
  async function restaurarDesdeStorage() {
    const stored = readStoredEmpresaId();
    if (!stored || stored === '__superadmin__') {
      if (stored === '__superadmin__') {
        applyEmpresaGlobal({ id: '__superadmin__', isSuperAdminContext: true, features: {} });
      }
      return null;
    }
    const empresa = await fetchEmpresa(stored);
    if (empresa) applyEmpresaGlobal(empresa);
    return empresa;
  }

  function getEmpresaActual() { return window._empresaActual || null; }

  function getEmpresaId() {
    return (window._empresaActual && window._empresaActual.id) || readStoredEmpresaId() || '';
  }

  function isSuperAdminContext() {
    return window._empresaActual != null && window._empresaActual.isSuperAdminContext === true;
  }

  // Call on logout to wipe the tenant context.
  function limpiarContexto() {
    window._empresaActual = null;
    clearStoredEmpresaId();
  }

  window.mexEmpresaContext = Object.freeze({
    cargarParaUsuario,
    switchEmpresa,
    restaurarDesdeStorage,
    getEmpresaActual,
    getEmpresaId,
    isSuperAdminContext,
    limpiarContexto,
  });

  // Restore stored empresa context immediately on load (pre-auth).
  // This makes window._empresaActual available synchronously from storage
  // for code that runs before the full cargarParaUsuario call.
  restaurarDesdeStorage().catch(() => {});
})();
