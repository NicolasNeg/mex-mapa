// ═══════════════════════════════════════════════════════════
//  /api/mapa.js  —  Suscripciones y estructura del mapa
//  Depende de: window._mex (expuesto por mex-api.js)
// ═══════════════════════════════════════════════════════════
(function () {
  const {
    db, COL, MAPA_SNAPSHOT_MERGE_MS,
    _normalizePlazaId, _matchesPlaza, _ensurePlazaBootstrap,
    _registrarLog, _generarEstructuraPorDefecto
  } = window._mex;

  window._mexParts = window._mexParts || {};
  window._mexParts.mapa = {

    // ─── SUSCRIPCIÓN EN TIEMPO REAL ──────────────────────
    suscribirMapa(callback) {
      let pendingTimer = null;
      let fc = [], fe = [];
      let fcReady = false, feReady = false;

      function _emit(immediate = false) {
        if (!fcReady || !feReady) return;
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
          const cuadreUnits = fc
            .filter(u => u.mva && (u.ubicacion === "PATIO" || u.ubicacion === "TALLER"))
            .map(u => ({ ...u, tipo: "renta" }));
          const externosUnits = fe
            .filter(u => u.mva)
            .map(u => ({ ...u, ubicacion: "EXTERNO", tipo: "externo" }));
          callback([...cuadreUnits, ...externosUnits]);
        }, immediate ? 0 : MAPA_SNAPSHOT_MERGE_MS);
      }

      const unsubFlat1 = db.collection(COL.CUADRE).onSnapshot(snap => {
        const bootstrap = !fcReady || !feReady;
        fc = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        fcReady = true;
        _emit(bootstrap && feReady);
      }, err => console.error("onSnapshot cuadre:", err));
      const unsubFlat2 = db.collection(COL.EXTERNOS).onSnapshot(snap => {
        const bootstrap = !fcReady || !feReady;
        fe = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        feReady = true;
        _emit(bootstrap && fcReady);
      }, err => console.error("onSnapshot externos:", err));

      return () => {
        unsubFlat1();
        unsubFlat2();
        if (pendingTimer) clearTimeout(pendingTimer);
      };
    },

    suscribirMapaPlaza(plaza, callback) {
      const plazaUp = _normalizePlazaId(plaza);
      if (!plazaUp) return window._mexParts.mapa.suscribirMapa(callback);

      let cuadreDocs = [], externosDocs = [];
      let pendingTimer = null;
      let cuadreReady = false, externosReady = false;

      function emitir(immediate = false) {
        if (!cuadreReady || !externosReady) return;
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
          const cuadreUnits = cuadreDocs
            .filter(u => u.mva && (u.ubicacion === "PATIO" || u.ubicacion === "TALLER"))
            .map(u => ({ ...u, tipo: "renta" }));
          const externosUnits = externosDocs
            .filter(u => u.mva)
            .map(u => ({ ...u, ubicacion: "EXTERNO", tipo: "externo" }));
          callback([...cuadreUnits, ...externosUnits]);
        }, immediate ? 0 : MAPA_SNAPSHOT_MERGE_MS);
      }

      const unsubCuadre = db.collection(COL.CUADRE).onSnapshot(snap => {
        const bootstrap = !cuadreReady || !externosReady;
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        cuadreDocs = all.filter(u => _matchesPlaza(u, plazaUp));
        cuadreReady = true;
        emitir(bootstrap && externosReady);
      }, err => console.error("onSnapshot cuadre:", err));

      const unsubExternos = db.collection(COL.EXTERNOS).onSnapshot(snap => {
        const bootstrap = !cuadreReady || !externosReady;
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        externosDocs = all.filter(u => _matchesPlaza(u, plazaUp));
        externosReady = true;
        emitir(bootstrap && cuadreReady);
      }, err => console.error("onSnapshot externos:", err));

      return () => { unsubCuadre(); unsubExternos(); if (pendingTimer) clearTimeout(pendingTimer); };
    },

    async obtenerDatosParaMapa(plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const [cuadreSnap, externosSnap] = await Promise.all([
        db.collection(COL.CUADRE).get(), db.collection(COL.EXTERNOS).get()
      ]);
      const cuadreDocs2 = cuadreSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(u => _matchesPlaza(u, plazaUp));
      const externosDocs2 = externosSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(u => _matchesPlaza(u, plazaUp));
      return {
        unidades: [
          ...cuadreDocs2
            .filter(u => u.mva && (u.ubicacion === "PATIO" || u.ubicacion === "TALLER"))
            .map(u => ({ ...u, tipo: "renta" })),
          ...externosDocs2
            .filter(u => u.mva)
            .map(u => ({ ...u, ubicacion: "EXTERNO", tipo: "externo" }))
        ]
      };
    },

    // ── Estructura de mapa por plaza ──────────────────────
    async obtenerEstructuraMapa(plaza) {
      const p = _normalizePlazaId(plaza);
      if (p) {
        await _ensurePlazaBootstrap(p);
        const snap = await db.collection('mapa_config').doc(p).collection('estructura').orderBy('orden').get();
        if (!snap.empty) return snap.docs.map(d => d.data());
        return _generarEstructuraPorDefecto();
      }
      const legSnap = await db.collection(COL.MAPA_CFG).orderBy('orden').get();
      const legDocs = legSnap.docs.filter(d => d.id.startsWith('cel_'));
      if (legDocs.length > 0) return legDocs.map(d => d.data());
      return _generarEstructuraPorDefecto();
    },

    suscribirEstructuraMapa(callback, plaza) {
      const p = _normalizePlazaId(plaza);
      if (p) {
        _ensurePlazaBootstrap(p).catch(err => console.warn("No se pudo bootstrapear la plaza:", p, err));
        return db.collection('mapa_config').doc(p).collection('estructura').orderBy('orden')
          .onSnapshot(snap => {
            callback(!snap.empty ? snap.docs.map(d => d.data()) : _generarEstructuraPorDefecto());
          }, err => console.error('onSnapshot mapa_cfg:', err));
      }
      return db.collection(COL.MAPA_CFG).orderBy('orden').onSnapshot(snap => {
        const docs = snap.docs.filter(d => d.id.startsWith('cel_'));
        callback(docs.length > 0 ? docs.map(d => d.data()) : _generarEstructuraPorDefecto());
      }, err => console.error('onSnapshot mapa_cfg (legacy):', err));
    },

    async guardarEstructuraMapa(elementos, plaza) {
      if (!plaza) throw new Error('Plaza requerida para guardar estructura del mapa');
      const p = plaza.toUpperCase().trim();
      const ref = db.collection('mapa_config').doc(p).collection('estructura');
      const snap = await ref.get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      for (let i = 0; i < elementos.length; i += 490) {
        const chunk = elementos.slice(i, i + 490);
        const batch = db.batch();
        chunk.forEach((el, j) => {
          const docRef = ref.doc(`cel_${el.orden ?? (i + j)}`);
          batch.set(docRef, {
            valor:    el.valor    ?? '',
            tipo:     el.tipo     ?? 'cajon',
            esLabel:  el.esLabel  ?? false,
            orden:    el.orden    ?? (i + j),
            x:        el.x        ?? 0,
            y:        el.y        ?? 0,
            width:    el.width    ?? 120,
            height:   el.height   ?? 80,
            rotation: el.rotation ?? 0,
            // [F1.5] Campos extendidos de estructura
            zone:               el.zone               ?? null,
            subzone:            el.subzone             ?? null,
            isReserved:         el.isReserved          === true,
            isBlocked:          el.isBlocked           === true,
            isTemporaryHolding: el.isTemporaryHolding  === true,
            allowedCategories:  Array.isArray(el.allowedCategories) ? el.allowedCategories : [],
            priority:           el.priority            ?? 0,
            googleMapsUrl:      el.googleMapsUrl        ?? null,
            pathType:           el.pathType             ?? null,
          });
        });
        await batch.commit();
      }
      await _registrarLog('SISTEMA', `🗺️ Estructura del mapa (${p}) actualizada`, 'Sistema', p);
      return 'OK';
    },

  };
})();
