// ═══════════════════════════════════════════════════════════
//  /api/historial.js  —  Historial de logs, movimientos y auditoría
//  Depende de: window._mex (expuesto por mex-api.js)
// ═══════════════════════════════════════════════════════════
(function () {
  const {
    db, COL,
    _fecha, _registrarEventoGestion
  } = window._mex;

  window._mexParts = window._mexParts || {};
  window._mexParts.historial = {

    // ─── HISTORIAL ────────────────────────────────────────
    async obtenerHistorialLogs() {
      const snap = await db.collection("historial_patio").orderBy("timestamp", "desc").limit(500).get();
      return snap.docs.map(d => {
        const data = d.data();
        return {
          fecha:    _fecha(data),
          tipo:     String(data.tipo || "MOVE").toUpperCase(),
          accion:   `${data.mva || ""} ${data.hoja || ""} ${data.posAnterior || ""} → ${data.posNueva || ""}`.trim(),
          mva:      data.mva || "",
          detalles: `${data.posAnterior || ""} → ${data.posNueva || ""}`,
          ubicacion: data.posNueva || "",
          estado:    data.posNueva || "",
          autor:     data.autor || "",
          usuario:   data.autor || "",
          timestamp: data.timestamp || 0,
          locationStatus: data.locationStatus || '',
          exactLocation: data.exactLocation || null,
          googleMapsUrl: data.exactLocation?.googleMapsUrl || '',
          ipAddress: data.ipAddress || '',
          forwardedFor: data.forwardedFor || ''
        };
      });
    },

    async obtenerLogsServer() {
      const snap = await db.collection(COL.LOGS).orderBy("timestamp", "desc").limit(200).get();
      return snap.docs.map(d => {
        const data = d.data();
        const accion = data.accion || "";
        const mvaMatch = accion.match(/\*(\w+)\*/);
        const estadoMatch = accion.match(/ESTADO\s*[→➜]\s*(\w+)/);
        const ubiMatch = accion.match(/UBI\s*[→➜]\s*(\w+)/);
        return {
          fecha:    _fecha(data),
          tipo:     data.tipo || "OTRO",
          accion,
          mva:      data.mva || (mvaMatch ? mvaMatch[1] : ""),
          detalles: ubiMatch ? ubiMatch[1] : (estadoMatch ? estadoMatch[1] : ""),
          ubicacion: ubiMatch ? ubiMatch[1] : "",
          estado:   estadoMatch ? estadoMatch[1] : (data.tipo || ""),
          autor:    data.autor || "",
          usuario:  data.autor || "",
          locationStatus: data.locationStatus || '',
          exactLocation: data.exactLocation || null,
          googleMapsUrl: data.exactLocation?.googleMapsUrl || '',
          ipAddress: data.ipAddress || '',
          forwardedFor: data.forwardedFor || ''
        };
      });
    },

    async obtenerEventosGestion() {
      const snap = await db.collection(COL.ADMIN_AUDIT).orderBy("timestamp", "desc").limit(300).get();
      return snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          fecha: _fecha(data),
          tipo: data.tipo || "GESTION",
          accion: data.accion || "",
          autor: data.autor || "Sistema",
          usuario: data.autor || "Sistema",
          referencia: data.referencia || "",
          entidad: data.entidad || "",
          detalles: data.detalles || "",
          objetivo: data.objetivo || "",
          rolObjetivo: data.rolObjetivo || "",
          plazaObjetivo: data.plazaObjetivo || "",
          resultado: data.resultado || "",
          locationStatus: data.locationStatus || '',
          exactLocation: data.exactLocation || null,
          googleMapsUrl: data.exactLocation?.googleMapsUrl || '',
          ipAddress: data.ipAddress || '',
          forwardedFor: data.forwardedFor || ''
        };
      });
    },

    async registrarEventoGestion(tipo, mensaje, autor, extra) {
      await _registrarEventoGestion(tipo, mensaje, autor, extra || {});
      return "OK";
    },

  };
})();
