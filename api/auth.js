// ═══════════════════════════════════════════════════════════
//  /api/auth.js  —  Autenticación y credenciales de usuario
//  Depende de: window._mex (expuesto por mex-api.js)
// ═══════════════════════════════════════════════════════════
(function () {
  const {
    db, COL,
    _normalizeUserRoleData
  } = window._mex;

  window._mexParts = window._mexParts || {};
  window._mexParts.auth = {

    // ─── AUTENTICACIÓN ────────────────────────────────────
    async obtenerCredencialesMapa() {
      const usersSnap = await db.collection(COL.USERS).get();
      return usersSnap.docs.map(d => {
        const data = d.data();
        const roleData = _normalizeUserRoleData(data);
        const displayName = (data.nombre || data.usuario || data.email || '').toUpperCase();
        return { ...data, ...roleData, usuario: displayName };
      }).sort((a, b) => a.usuario.localeCompare(b.usuario));
    },

    async obtenerNombresUsuarios() {
      const snap = await db.collection(COL.USERS).get();
      return snap.docs.map(d => {
        const data = d.data();
        return (data.nombre || data.usuario || data.email || '').toUpperCase();
      }).filter(Boolean).sort();
    },

    async verificarAdminGlobal(nombreUsuario) {
      const nombre = nombreUsuario.trim().toUpperCase();
      const snap = await db.collection(COL.USERS).where("nombre", "==", nombre).limit(1).get();
      if (snap.empty) return false;
      return _normalizeUserRoleData(snap.docs[0].data()).isGlobal === true;
    },

  };
})();
