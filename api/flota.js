// ═══════════════════════════════════════════════════════════
//  /api/flota.js  —  Tabla de flota, resumen y plazas corporativas
//  Depende de: window._mex (expuesto por mex-api.js)
// ═══════════════════════════════════════════════════════════
(function () {
  const {
    db, COL,
    _normalizePlazaId, _matchesPlaza, _now,
    _buscarUnidadEnSubcol
  } = window._mex;

  async function _resolverUnidadIndexRef(plaza, idOrToken = '', mva = '') {
    const plazaUp = _normalizePlazaId(plaza);
    const directId = String(idOrToken || '').trim();
    if (directId) {
      const directRef = db.collection(COL.INDEX).doc(directId);
      const directSnap = await directRef.get();
      if (directSnap.exists && (!plazaUp || _matchesPlaza(directSnap.data(), plazaUp))) {
        return directRef;
      }
    }

    const token = String(mva || idOrToken || '').trim().toUpperCase();
    if (!token) return null;
    const snaps = await Promise.all([
      db.collection(COL.INDEX).where("mva", "==", token).limit(10).get(),
      db.collection(COL.INDEX).where("fila", "==", token).limit(10).get()
    ]);
    const docs = snaps.flatMap(snap => snap.docs);
    const target = docs.find(doc => !plazaUp || _matchesPlaza(doc.data(), plazaUp));
    return target?.ref || null;
  }

  window._mexParts = window._mexParts || {};
  window._mexParts.flota = {

    // ─── TABLA DE FLOTA ───────────────────────────────────
    async obtenerUnidadesVeloz(plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const [cuadre, externos, index] = await Promise.all([
        db.collection(COL.CUADRE).where('plaza', '==', plazaUp).get(),
        db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp).get(),
        db.collection(COL.INDEX).get()
      ]);
      const lista = [];
      const vistos = new Set();
      [...cuadre.docs, ...externos.docs].forEach(d => {
        const u = d.data();
        if (!u.mva || vistos.has(u.mva)) return;
        vistos.add(u.mva);
        lista.push(u);
      });
      index.docs.forEach(d => {
        const u = d.data();
        if (!u.mva || vistos.has(u.mva) || !_matchesPlaza(u, plazaUp)) return;
        vistos.add(u.mva);
        lista.push(u);
      });
      return lista;
    },

    async obtenerDatosFlotaConsola(plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const ORDEN = { "LISTO":1,"SUCIO":2,"MANTENIMIENTO":3,"RESGUARDO":4,"TRASLADO":5,"NO ARRENDABLE":6,"RETENIDA":92,"VENTA":93 };
      const [cuadre, externos] = await Promise.all([
        db.collection(COL.CUADRE).where('plaza', '==', plazaUp).get(),
        db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp).get()
      ]);
      const lista = [
        ...cuadre.docs.map(d => ({ id: d.id, fila: d.id, ...d.data() })).filter(u => u.mva),
        ...externos.docs.map(d => ({ id: d.id, fila: d.id, ...d.data(), ubicacion: "EXTERNO" })).filter(u => u.mva)
      ].filter(u => _matchesPlaza(u, plazaUp));
      lista.forEach(u => { u.orden = ORDEN[(u.estado || "").toUpperCase()] || 99; });
      lista.sort((a, b) => (a.orden - b.orden) || (a.mva || "").localeCompare(b.mva || ""));
      return lista;
    },

    // ─── RESUMEN FLOTA ────────────────────────────────────
    async obtenerResumenFlotaPatio(plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const [cuadreSnap, externosSnap] = await Promise.all([
        db.collection(COL.CUADRE).where('plaza', '==', plazaUp).get(),
        db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp).get()
      ]);
      const cuadreUnits = cuadreSnap.docs.map(d => d.data()).filter(u => u.mva);
      const externosUnits = externosSnap.docs.map(d => ({ ...d.data(), ubicacion: "EXTERNO" })).filter(u => u.mva);

      function _agrupar(units) {
        const byEstado = {};
        for (const u of units) {
          const estado = (u.estado || "SIN ESTADO").toUpperCase();
          const cat = (u.categoria || "SIN CATEGORÍA").toUpperCase();
          const mod = (u.modelo || u.mva || "").toUpperCase();
          if (!byEstado[estado]) byEstado[estado] = {};
          if (!byEstado[estado][cat]) byEstado[estado][cat] = { cant: 0, modelos: [] };
          byEstado[estado][cat].cant++;
          if (mod && !byEstado[estado][cat].modelos.includes(mod)) byEstado[estado][cat].modelos.push(mod);
        }
        const lista = Object.entries(byEstado).map(([nombre, categorias]) => {
          const total = Object.values(categorias).reduce((s, c) => s + c.cant, 0);
          return { nombre, total, categorias };
        }).sort((a, b) => b.total - a.total);
        return { total: units.length, lista };
      }

      const patioUnits = cuadreUnits.filter(u => u.ubicacion === "PATIO" || u.ubicacion === "TALLER");
      const fueraUnits = [
        ...cuadreUnits.filter(u => u.ubicacion !== "PATIO" && u.ubicacion !== "TALLER"),
        ...externosUnits
      ];
      return { patio: _agrupar(patioUnits), fuera: _agrupar(fueraUnits) };
    },

    // ─── PLAZAS / CORPORATIVO ─────────────────────────────
    async obtenerUnidadesPlazas() {
      const snap = await db.collection(COL.INDEX).orderBy("sucursal").get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async registrarUnidadEnPlaza(data) {
      await db.collection(COL.INDEX).add({ ...data, _createdAt: _now() });
      return "EXITO";
    },

    async obtenerDetalleCompleto(sucursal, mva) {
      const mvaStr = mva.toString().trim().toUpperCase();
      const snap = await db.collection(COL.INDEX).where("mva", "==", mvaStr).limit(1).get();
      if (snap.empty) return null;
      const data = snap.docs[0].data();
      let cuadreData = {};
      const found = await _buscarUnidadEnSubcol(mvaStr);
      if (found) cuadreData = found.data;
      return {
        id: snap.docs[0].id, fila: snap.docs[0].id, plaza: sucursal,
        mva: data.mva || mvaStr, modelo: data.modelo || cuadreData.modelo || "",
        marca: data.marca || "", año: data.año || data.anio || "",
        vin: data.vin || data.VIN || "", placas: data.placas || cuadreData.placas || "",
        categoria: data.categoria || data.clase || cuadreData.categoria || "",
        sucursal: data.sucursal || sucursal || "",
        gasolina: cuadreData.gasolina || data.gasolina || "",
        estado: cuadreData.estado || data.estado || "",
        ubicacion: cuadreData.ubicacion || "", notas: cuadreData.notas || "",
        pos: cuadreData.pos || "LIMBO",
        ...data, ...cuadreData
      };
    },

    async actualizarUnidadPlaza(data) {
      const ref = await _resolverUnidadIndexRef(data?.plaza || data?.sucursal, data?.id || data?.fila || data?.mva, data?.mva);
      if (!ref) return "ERROR: Unidad no encontrada";
      const { id, ...payload } = data || {};
      await ref.update(payload);
      return "EXITO";
    },

    async eliminarUnidadPlaza(plaza, id) {
      const ref = await _resolverUnidadIndexRef(plaza, id, id);
      if (!ref) throw new Error("Unidad global no encontrada para eliminar.");
      await ref.delete();
      return "EXITO";
    },

    // ─── EXTRAS DE UNIDAD ────────────────────────────────
    async actualizarExtrasUnidad(mva, extras, plaza) {
      const mvaStr = mva.toString().trim().toUpperCase();
      const plazaUp = _normalizePlazaId(plaza);
      const docId = plazaUp ? `${plazaUp}_${mvaStr}` : mvaStr;
      const ref = db.collection('unit_extras').doc(docId);
      await ref.set({ ...extras, mva: mvaStr, plaza: plazaUp, _updatedAt: Date.now() }, { merge: true });
      return 'OK';
    },

    async obtenerExtrasUnidad(mva, plaza) {
      const mvaStr = mva.toString().trim().toUpperCase();
      const plazaUp = _normalizePlazaId(plaza);
      const docId = plazaUp ? `${plazaUp}_${mvaStr}` : mvaStr;
      const snap = await db.collection('unit_extras').doc(docId).get();
      return snap.exists ? snap.data() : {};
    },

    async obtenerExtrasPlaza(plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      if (!plazaUp) return {};
      const snap = await db.collection('unit_extras').where('plaza', '==', plazaUp).get();
      const result = {};
      snap.docs.forEach(d => { const data = d.data(); if (data.mva) result[data.mva] = data; });
      return result;
    },

  };
})();
