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
        const data = d.data() || {};
        const accion = data.accion || "";
        const clean = String(accion)
          .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, "")
          .replace(/\s{2,}/g, " ")
          .trim();

        // Structured fields first; parse legacy accion as fallback
        let mva = String(data.mva || "").toUpperCase().trim();
        let cambio = String(data.cambio || "").trim();
        let estadoAnterior = String(data.estadoAnterior || "").trim();
        let estadoNuevo = String(data.estadoNuevo || "").trim();

        if (!mva) {
          let m = clean.match(/^(?:EXTERNO\s+)?INSERTADO:\s*([A-Z0-9][\w-]*)\s*$/i)
            || clean.match(/^SE\s+ELIMIN[OÓ]\s+LA\s+UNIDAD:\s*([A-Z0-9][\w-]*)\s*$/i)
            || clean.match(/^KM\s+(?:DISCREPANCIA|CORREGIDO):\s*([A-Z0-9][\w-]*)\b/i)
            || clean.match(/^([A-Z0-9][\w-]*)\s*(?:\(|:)/);
          if (m) mva = String(m[1]).toUpperCase();
        }

        if (!cambio || (!estadoAnterior && !estadoNuevo)) {
          const bodyMatch = clean.match(/^[A-Z0-9][\w-]*\s*:\s*(.+)$/i);
          const body = bodyMatch ? bodyMatch[1] : "";
          if (body) {
            const chunks = body.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
            const otros = [];
            for (const chunk of chunks) {
              const est = chunk.match(/^Estado\s+(.+?)\s*(?:→|->|➜)\s*(.+)$/i);
              if (est) {
                if (!estadoAnterior) estadoAnterior = est[1].trim();
                if (!estadoNuevo) estadoNuevo = est[2].trim();
                continue;
              }
              otros.push(chunk
                .replace(/^Gas\s+/i, "Gasolina ")
                .replace(/^Ubi\s+/i, "Ubicación ")
                .replace(/Notas reemplazadas/i, "Notas actualizadas"));
            }
            if (!cambio) {
              const bits = [];
              if (estadoAnterior || estadoNuevo) bits.push("Cambio de estado");
              bits.push(...otros);
              cambio = bits.join(" · ") || body;
            }
          } else if (/revisi[oó]n\s+sin\s+cambios/i.test(clean)) {
            if (!cambio) cambio = "Revisión sin cambios";
          } else if (/INSERTADO/i.test(clean)) {
            if (!cambio) cambio = /externo/i.test(clean) ? "Unidad externa insertada" : "Unidad insertada";
          } else if (/ELIMIN/i.test(clean)) {
            if (!cambio) cambio = "Unidad eliminada";
          }
        }

        const estadoMatch = !estadoNuevo && accion.match(/ESTADO\s*[→➜]\s*(\w+)/i);
        const ubiMatch = accion.match(/UBI\s*[→➜]\s*(\w+)/i);
        return {
          fecha:    _fecha(data),
          tipo:     data.tipo || "OTRO",
          accion,
          cambio:   cambio || clean || accion,
          mva,
          detalles: ubiMatch ? ubiMatch[1] : (estadoMatch ? estadoMatch[1] : ""),
          ubicacion: ubiMatch ? ubiMatch[1] : "",
          estado:   estadoNuevo || (estadoMatch ? estadoMatch[1] : (data.tipo || "")),
          estadoAnterior,
          estadoNuevo,
          autor:    data.autor || "",
          usuario:  data.autor || "",
          timestamp: data.timestamp || 0,
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
