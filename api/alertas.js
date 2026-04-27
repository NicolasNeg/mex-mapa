// ═══════════════════════════════════════════════════════════
//  /api/alertas.js  —  Alertas maestras, plantillas y mensajes
//  Depende de: window._mex (expuesto por mex-api.js)
// ═══════════════════════════════════════════════════════════
(function () {
  const {
    db, COL, firebase,
    _now, _ts, _sanitizeText,
    _serializeAlertCsv, _splitAlertCsv,
    _normalizeAlertType, _normalizeAlertMode, _normalizeAlertDestMode,
    _normalizeAlertCta, _normalizeAlertBanner, _normalizeAlertAuthor,
    _registrarEventoGestion
  } = window._mex;

  window._mexParts = window._mexParts || {};
  window._mexParts.alertas = {

    // ─── ALERTAS ─────────────────────────────────────────
    async emitirNuevaAlertaMaestra(tipo, titulo, mensaje, imagen, autor, destinatarios, modo, meta = {}) {
      const destinatariosNormalizados = _serializeAlertCsv(destinatarios);
      const actor = _sanitizeText(autor) || "Sistema";
      const tipoNormalizado = _normalizeAlertType(tipo);
      const authorMeta = _normalizeAlertAuthor(meta.author || {}, actor);
      const banner = _normalizeAlertBanner(meta.banner || {}, tipoNormalizado);
      await db.collection(COL.ALERTAS).add({
        timestamp: _ts(), fecha: _now(), actor,
        autor: authorMeta.visible, authorMode: authorMeta.mode, authorValue: authorMeta.value,
        tipo: tipoNormalizado, banner,
        titulo: _sanitizeText(titulo),
        mensaje: String(mensaje || "").trim(),
        imagen: String(imagen || "").trim(),
        leidoPor: "",
        destinatarios: destinatariosNormalizados,
        destMode: _normalizeAlertDestMode(meta.destMode, destinatariosNormalizados),
        modo: _normalizeAlertMode(modo),
        cta: _normalizeAlertCta(meta.cta),
        version: 1
      });
      await _registrarEventoGestion("ALERTA_EMITIDA", `Emitió alerta maestra "${titulo}" (${tipo})`, autor, {
        entidad: "ALERTAS", referencia: titulo || ""
      });
      return "EXITO";
    },

    async marcarAlertaComoLeida(idAlerta, usuarioActivo) {
      const ref = db.collection(COL.ALERTAS).doc(idAlerta);
      const snap = await ref.get();
      if (!snap.exists) return "ERROR";
      const lectores = _splitAlertCsv(snap.data().leidoPor);
      // Fallback al usuario de Firebase Auth cuando usuarioActivo llega vacío
      const currentUser = firebase.auth().currentUser;
      const usuario = String(
        usuarioActivo ||
        currentUser?.displayName ||
        currentUser?.email ||
        currentUser?.uid ||
        ""
      ).trim().toUpperCase();
      if (!usuario) return "ERROR";
      if (!lectores.includes(usuario)) lectores.push(usuario);
      await ref.update({ leidoPor: lectores.join(", ") });
      return "OK";
    },

    async actualizarAlertaMaestra(idAlerta, cambios = {}, actor = "Sistema") {
      const ref = db.collection(COL.ALERTAS).doc(idAlerta);
      const snap = await ref.get();
      if (!snap.exists) return "ERROR: Alerta no encontrada";
      const actual = snap.data() || {};
      const destinatarios = _serializeAlertCsv(cambios.destinatarios || actual.destinatarios || "GLOBAL");
      const tipo = _normalizeAlertType(cambios.tipo || actual.tipo);
      const titulo = _sanitizeText(cambios.titulo || actual.titulo);
      const mensaje = String(cambios.mensaje ?? actual.mensaje ?? "").trim();
      const imagen = String(cambios.imagen ?? actual.imagen ?? "").trim();
      const modo = _normalizeAlertMode(cambios.modo || actual.modo);
      const destMode = _normalizeAlertDestMode(cambios.destMode || actual.destMode, destinatarios);
      const cta = _normalizeAlertCta(cambios.cta || actual.cta || {});
      const authorMeta = _normalizeAlertAuthor(
        cambios.author || {
          mode: actual.authorMode || actual.autorModo || actual.author?.mode || "",
          value: actual.authorValue || actual.autorValor || actual.author?.value || actual.autor || ""
        },
        actor
      );
      const banner = _normalizeAlertBanner(cambios.banner || actual.banner || {}, tipo);
      const ahora = _now();
      await ref.update({
        timestamp: _ts(), fecha: ahora,
        actor: _sanitizeText(actor) || "Sistema",
        autor: authorMeta.visible, authorMode: authorMeta.mode, authorValue: authorMeta.value,
        tipo, banner, titulo, mensaje, imagen, destinatarios, destMode, modo, cta,
        leidoPor: "", editadoPor: _sanitizeText(actor) || "Sistema", editadoEn: ahora,
        version: Number(actual.version || 1) + 1
      });
      await _registrarEventoGestion("ALERTA_EDITADA", `Editó alerta maestra "${titulo}" (${tipo})`, actor, {
        entidad: "ALERTAS", referencia: idAlerta,
        detalles: `Modo ${modo} · Destino ${destMode}`
      });
      return "EXITO";
    },

    async obtenerTodasLasAlertas() {
      const snap = await db.collection(COL.ALERTAS).orderBy("timestamp", "desc").get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async eliminarAlertaMaestraBackend(idAlerta, actor = "Sistema") {
      const ref = db.collection(COL.ALERTAS).doc(idAlerta);
      const snap = await ref.get();
      const titulo = snap.exists ? (snap.data().titulo || idAlerta) : idAlerta;
      const autorOriginal = snap.exists ? (snap.data().autor || "") : "";
      await ref.delete();
      await _registrarEventoGestion("ALERTA_ELIMINADA", `Eliminó alerta maestra "${titulo}"`, actor || "Sistema", {
        entidad: "ALERTAS", referencia: idAlerta,
        detalles: autorOriginal ? `Alerta creada originalmente por ${autorOriginal}` : ""
      });
      return "EXITO";
    },

    async obtenerPlantillasAlerta() {
      const snap = await db.collection(COL.PLANTILLAS_ALERTAS).orderBy("nombre").get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async guardarPlantillaAlerta(nombre, tipo, titulo, mensaje, modo, autor, meta = {}) {
      try {
        const tipoNormalizado = _normalizeAlertType(tipo);
        const authorMeta = _normalizeAlertAuthor(meta.author || {}, autor);
        await db.collection(COL.PLANTILLAS_ALERTAS).add({
          nombre, tipo: tipoNormalizado, titulo, mensaje, modo, autor,
          authorMode: authorMeta.mode, authorValue: authorMeta.value,
          banner: _normalizeAlertBanner(meta.banner || {}, tipoNormalizado),
          imagen: String(meta.imagen || "").trim(),
          cta: _normalizeAlertCta(meta.cta),
          timestamp: _ts(), fecha: _now()
        });
        return "EXITO";
      } catch(e) { return "ERROR: " + e.message; }
    },

    // ─── MENSAJES ─────────────────────────────────────────
    async obtenerMensajesPrivados(usuario) {
      const me = usuario.trim().toUpperCase();
      const [sent, recv] = await Promise.all([
        db.collection(COL.MENSAJES).where("remitente", "==", me).orderBy("timestamp", "desc").get(),
        db.collection(COL.MENSAJES).where("destinatario", "==", me).orderBy("timestamp", "desc").get()
      ]);
      const todos = [...sent.docs, ...recv.docs].map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.timestamp - a.timestamp);
      const vistos = new Set();
      return todos.filter(m => { if (vistos.has(m.id)) return false; vistos.add(m.id); return true; })
        .map(m => ({ ...m, esMio: m.remitente === me, leido: m.leido === "SI" }));
    },

    async enviarMensajePrivado(remitente, destinatario, texto, archivoUrl = null, archivoNombre = null, replyTo = null) {
      const ts = _ts();
      const id = `msg_${ts}_${Math.floor(Math.random() * 1000)}`;
      const payload = {
        timestamp: ts, fecha: _now(),
        remitente: remitente.trim().toUpperCase(),
        destinatario: destinatario.trim().toUpperCase(),
        mensaje: texto || "", leido: "NO"
      };
      if (archivoUrl)  { payload.archivoUrl = archivoUrl; payload.archivoNombre = archivoNombre; }
      if (replyTo)     { payload.replyTo = { id: replyTo.id, remitente: replyTo.remitente, mensaje: replyTo.mensaje }; }
      await db.collection(COL.MENSAJES).doc(id).set(payload);
      return "EXITO";
    },

    async actualizarReaccionesChatDb(msgId, reacciones) {
      await db.collection(COL.MENSAJES).doc(msgId).update({ reacciones });
      return "OK";
    },

    async marcarMensajesLeidosArray(idsArray) {
      const batch = db.batch();
      for (const id of idsArray) batch.update(db.collection(COL.MENSAJES).doc(id.toString()), { leido: "SI" });
      await batch.commit();
      return "OK";
    },

    async editarMensajeChatDb(idStr, nuevoTexto) {
      await db.collection(COL.MENSAJES).doc(idStr).update({ mensaje: nuevoTexto });
      return "OK";
    },

    async eliminarMensajeChatDb(idStr) {
      const ref = db.collection(COL.MENSAJES).doc(idStr);
      const snap = await ref.get();
      if (snap.exists && snap.data().archivoUrl) {
        try {
          const storageRef = firebase.storage().refFromURL(snap.data().archivoUrl);
          await storageRef.delete();
        } catch(e) { console.warn("Could not delete associated chat file", e); }
      }
      await ref.delete();
      return "OK";
    },

  };
})();
