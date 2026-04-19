// ═══════════════════════════════════════════════════════════
//  /api/notas.js  —  Incidencias / notas de administración
//  Depende de: window._mex (expuesto por mex-api.js)
// ═══════════════════════════════════════════════════════════
(function () {
  const {
    db, COL,
    _normalizePlazaId, _matchesPlaza, _now, _ts, _sanitizeText,
    _buildIncidentPayload, _normalizeIncidentRecord, _normalizeIncidentAttachments,
    _normalizeEvidenceItems, _uploadIncidentAttachments, _deleteEvidenceFiles,
    _buildPlazaScopedQuery
  } = window._mex;

  window._mexParts = window._mexParts || {};
  window._mexParts.notas = {

    // ─── NOTAS ────────────────────────────────────────────
    async obtenerTodasLasNotas(plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const query = plazaUp
        ? (typeof _buildPlazaScopedQuery === 'function'
          ? _buildPlazaScopedQuery(COL.NOTAS, plazaUp, { orderBy: { field: 'timestamp', direction: 'desc' } })
          : db.collection(COL.NOTAS).where('plaza', '==', plazaUp).orderBy('timestamp', 'desc'))
        : db.collection(COL.NOTAS).orderBy("timestamp", "desc");
      const snap = await query.get();
      return snap.docs.map(d => _normalizeIncidentRecord(d.id, d.data()));
    },

    suscribirNotasAdmin(callback, plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const query = plazaUp
        ? (typeof _buildPlazaScopedQuery === 'function'
          ? _buildPlazaScopedQuery(COL.NOTAS, plazaUp, { orderBy: { field: 'timestamp', direction: 'desc' } })
          : db.collection(COL.NOTAS).where('plaza', '==', plazaUp).orderBy('timestamp', 'desc'))
        : db.collection(COL.NOTAS).orderBy("timestamp", "desc");
      return query.onSnapshot(snap => {
        callback(snap.docs.map(d => _normalizeIncidentRecord(d.id, d.data())));
      }, err => console.error("onSnapshot notas_admin:", err));
    },

    async guardarNuevaNotaDirecto(nota, autor) {
      const ts = _ts();
      const id = ts.toString();
      const payloadEntrada = typeof nota === "object" && nota !== null
        ? { ...nota }
        : { descripcion: String(nota || "") };
      const actor = _sanitizeText(payloadEntrada.autor || autor) || "Sistema";
      const archivosNuevos = Array.from(payloadEntrada.archivos || payloadEntrada.files || []);
      const adjuntosManual = _normalizeEvidenceItems(payloadEntrada.adjuntos || payloadEntrada.attachments || []);
      const adjuntosSubidos = archivosNuevos.length
        ? await _uploadIncidentAttachments(archivosNuevos, id, actor)
        : [];

      const plazaNotaUp = (payloadEntrada.plaza || '').toUpperCase().trim();
      const payload = _buildIncidentPayload({
        ...payloadEntrada,
        fecha: _now(),
        estado: "PENDIENTE",
        quienResolvio: "",
        solucion: "",
        resueltaEn: ""
      }, actor, [...adjuntosManual, ...adjuntosSubidos], ts);
      if (plazaNotaUp) payload.plaza = plazaNotaUp;

      await db.collection(COL.NOTAS).doc(id).set(payload);
      return "OK";
    },

    async resolverNotaDirecto(idNota, solucion, autor) {
      const idStr = idNota.toString();
      const ref = db.collection(COL.NOTAS).doc(idStr);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.update({
          quienResolvio: _sanitizeText(autor) || "Sistema",
          estado: "RESUELTA",
          solucion: _sanitizeText(solucion),
          resueltaEn: _now(),
          version: Number((snap.data() || {}).version || 1) + 1
        });
        return "OK";
      }
      const ts = parseInt(idStr);
      if (!isNaN(ts)) {
        const q = await db.collection(COL.NOTAS).where("timestamp", "==", ts).limit(1).get();
        if (!q.empty) {
          const actual = q.docs[0].data() || {};
          await q.docs[0].ref.update({
            quienResolvio: _sanitizeText(autor) || "Sistema",
            estado: "RESUELTA",
            solucion: _sanitizeText(solucion),
            resueltaEn: _now(),
            version: Number(actual.version || 1) + 1
          });
          return "OK";
        }
      }
      return "ERROR: Nota no encontrada";
    },

    async eliminarNotaDirecto(idNota) {
      const idStr = idNota.toString();
      const ref = db.collection(COL.NOTAS).doc(idStr);
      const snap = await ref.get();
      if (snap.exists) {
        await _deleteEvidenceFiles(_normalizeIncidentAttachments(snap.data()));
        await ref.delete();
        return "OK";
      }
      const ts = parseInt(idStr);
      if (!isNaN(ts)) {
        const q = await db.collection(COL.NOTAS).where("timestamp", "==", ts).limit(1).get();
        if (!q.empty) {
          await _deleteEvidenceFiles(_normalizeIncidentAttachments(q.docs[0].data()));
          await q.docs[0].ref.delete();
          return "OK";
        }
      }
      return "ERROR: Nota no encontrada";
    },

  };
})();
