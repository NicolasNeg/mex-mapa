// ═══════════════════════════════════════════════════════════
//  /api/users.js  —  Gestión de usuarios (CRUD)
//  Depende de: window._mex (expuesto por mex-api.js)
// ═══════════════════════════════════════════════════════════
(function () {
  const {
    db, COL, firebase, FIREBASE_CONFIG,
    _profileDocId, _resolveRoleForEmail, _inferRole,
    _normalizeUserRoleData, _guardarPerfilUsuarioPorEmail,
    _registrarEventoGestion, _now, _ts
  } = window._mex;

  window._mexParts = window._mexParts || {};
  window._mexParts.users = {

    async guardarNuevoUsuarioAuth(nombre, email, password, roleOrIsAdmin, telefono, plazaOrIsGlobal, plazasPermitidas) {
      try {
        const emailNormalizado = _profileDocId(email);
        const rol = _resolveRoleForEmail(emailNormalizado, _inferRole(roleOrIsAdmin, plazaOrIsGlobal));
        const roleData = _normalizeUserRoleData({
          rol,
          plazaAsignada: typeof roleOrIsAdmin === "string" ? plazaOrIsGlobal : ""
        });
        const appSecundaria = firebase.initializeApp(FIREBASE_CONFIG, "AppRegistro_" + Date.now());
        const credencial = await appSecundaria.auth().createUserWithEmailAndPassword(email, password);
        const nuevoUid = credencial.user.uid;

        const perfilExtra = {};
        if (Array.isArray(plazasPermitidas) && plazasPermitidas.length > 0) {
          perfilExtra.plazasPermitidas = plazasPermitidas;
        }

        const docId = await _guardarPerfilUsuarioPorEmail(emailNormalizado, {
          nombre: nombre.trim().toUpperCase(),
          email: emailNormalizado,
          telefono: telefono || "",
          ...roleData,
          ...perfilExtra,
          authUid: nuevoUid,
          status: "ACTIVO"
        });

        if (nuevoUid && nuevoUid !== docId) {
          const legacyRef = db.collection(COL.USERS).doc(nuevoUid);
          const legacySnap = await legacyRef.get();
          if (legacySnap.exists) await legacyRef.delete();
        }

        await appSecundaria.auth().signOut();
        await appSecundaria.delete();
        return "EXITO";
      } catch (error) {
        return "ERROR: " + error.message;
      }
    },

    async modificarUsuario(nombreOriginal, nuevoNombre, nuevoPin, isAdmin, telefono, isGlobalAdmin) {
      const origUpper = nombreOriginal.trim().toUpperCase();
      const nuevoUpper = nuevoNombre.trim().toUpperCase();
      const snap = await db.collection(COL.USERS).where("usuario", "==", origUpper).limit(1).get();
      if (snap.empty) return "ERROR: Usuario no encontrado";
      const esAdmin = isAdmin === true || isAdmin === "true";
      const esGlobal = isGlobalAdmin === true || isGlobalAdmin === "true";
      await snap.docs[0].ref.update({
        usuario: nuevoUpper,
        password: nuevoPin.toString(),
        isAdmin: esAdmin,
        telefono: (telefono || "").trim()
      });
      const adminSnap = await db.collection(COL.ADMINS).where("usuario", "==", origUpper).limit(1).get();
      if (esAdmin) {
        if (adminSnap.empty) {
          await db.collection(COL.ADMINS).doc(nuevoUpper).set({
            usuario: nuevoUpper, password: nuevoPin.toString(), isGlobal: esGlobal
          });
        } else {
          await adminSnap.docs[0].ref.update({ usuario: nuevoUpper, password: nuevoPin.toString(), isGlobal: esGlobal });
        }
      } else {
        if (!adminSnap.empty) await adminSnap.docs[0].ref.delete();
      }
      return "EXITO";
    },

    async eliminarUsuario(nombre) {
      const nombreUpper = nombre.trim().toUpperCase();
      const snap = await db.collection(COL.USERS).where("usuario", "==", nombreUpper).limit(1).get();
      if (snap.empty) return "ERROR: Usuario no encontrado";
      await snap.docs[0].ref.delete();
      const adminSnap = await db.collection(COL.ADMINS).where("usuario", "==", nombreUpper).limit(1).get();
      if (!adminSnap.empty) await adminSnap.docs[0].ref.delete();
      return "EXITO";
    },

    async checkEsAdmin(nombre) {
      const snap = await db.collection(COL.USERS).where("nombre", "==", nombre.trim().toUpperCase()).limit(1).get();
      if (snap.empty) return false;
      return _normalizeUserRoleData(snap.docs[0].data()).isAdmin === true;
    },

  };
})();
