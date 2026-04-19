// ═══════════════════════════════════════════════════════════
//  /api/mapa.js  —  Suscripciones y estructura del mapa
//  Depende de: window._mex (expuesto por mex-api.js)
// ═══════════════════════════════════════════════════════════
(function () {
  const {
    db, COL, MAPA_SNAPSHOT_MERGE_MS,
    _normalizePlazaId, _matchesPlaza, _ensurePlazaBootstrap,
    _registrarLog, _generarEstructuraPorDefecto, _buildPlazaScopedQuery
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

      const cuadreQuery = typeof _buildPlazaScopedQuery === 'function'
        ? _buildPlazaScopedQuery(COL.CUADRE, plazaUp)
        : db.collection(COL.CUADRE).where('plaza', '==', plazaUp);
      const externosQuery = typeof _buildPlazaScopedQuery === 'function'
        ? _buildPlazaScopedQuery(COL.EXTERNOS, plazaUp)
        : db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp);

      const unsubCuadre = cuadreQuery.onSnapshot(snap => {
        const bootstrap = !cuadreReady || !externosReady;
        cuadreDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        cuadreReady = true;
        emitir(bootstrap && externosReady);
      }, err => console.error("onSnapshot cuadre:", err));

      const unsubExternos = externosQuery.onSnapshot(snap => {
        const bootstrap = !cuadreReady || !externosReady;
        externosDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        externosReady = true;
        emitir(bootstrap && cuadreReady);
      }, err => console.error("onSnapshot externos:", err));

      return () => { unsubCuadre(); unsubExternos(); if (pendingTimer) clearTimeout(pendingTimer); };
    },

    async obtenerDatosParaMapa(plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const cuadreQuery = plazaUp
        ? (typeof _buildPlazaScopedQuery === 'function'
          ? _buildPlazaScopedQuery(COL.CUADRE, plazaUp)
          : db.collection(COL.CUADRE).where('plaza', '==', plazaUp))
        : db.collection(COL.CUADRE);
      const externosQuery = plazaUp
        ? (typeof _buildPlazaScopedQuery === 'function'
          ? _buildPlazaScopedQuery(COL.EXTERNOS, plazaUp)
          : db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp))
        : db.collection(COL.EXTERNOS);
      const [cuadreSnap, externosSnap] = await Promise.all([
        cuadreQuery.get(), externosQuery.get()
      ]);
      const cuadreDocs2 = cuadreSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const externosDocs2 = externosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
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

    // ── F6.1  Duplicar estructura entre plazas ──────────────
    async duplicarEstructuraMapa(plazaOrigen, plazaDestino) {
      const pO = _normalizePlazaId(plazaOrigen);
      const pD = _normalizePlazaId(plazaDestino);
      if (!pO || !pD) throw new Error('Plazas inválidas para duplicar estructura');
      if (pO === pD) throw new Error('El origen y destino no pueden ser la misma plaza');

      // Leer estructura origen
      const snapOrigen = await db.collection('mapa_config').doc(pO).collection('estructura').orderBy('orden').get();
      if (snapOrigen.empty) throw new Error(`La plaza ${pO} no tiene estructura guardada`);
      const elementos = snapOrigen.docs.map(d => d.data());

      // Borrar destino existente
      const refDest = db.collection('mapa_config').doc(pD).collection('estructura');
      const snapDest = await refDest.get();
      if (!snapDest.empty) {
        const delBatch = db.batch();
        snapDest.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
      }

      // Copiar en batches de 490
      for (let i = 0; i < elementos.length; i += 490) {
        const chunk = elementos.slice(i, i + 490);
        const batch = db.batch();
        chunk.forEach((el, j) => {
          batch.set(refDest.doc(`cel_${el.orden ?? (i + j)}`), el);
        });
        await batch.commit();
      }
      await _registrarLog('SISTEMA', `🗺️ Estructura duplicada de ${pO} → ${pD} (${elementos.length} celdas)`, 'Sistema', pD);
      return { ok: true, total: elementos.length };
    },

    // ── F6.2  Plantillas de mapa ────────────────────────────
    async guardarPlantillaMapa(nombre, elementos) {
      if (!nombre) throw new Error('Nombre de plantilla requerido');
      const id = nombre.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      const ref = db.collection('mapa_plantillas').doc(id).collection('estructura');

      // Borrar anterior
      const snapAnterior = await ref.get();
      if (!snapAnterior.empty) {
        const delBatch = db.batch();
        snapAnterior.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
      }
      // Guardar metadata
      await db.collection('mapa_plantillas').doc(id).set({
        nombre: nombre.trim(),
        id,
        totalCeldas: elementos.length,
        _savedAt: Date.now(),
      });
      // Guardar celdas
      for (let i = 0; i < elementos.length; i += 490) {
        const chunk = elementos.slice(i, i + 490);
        const batch = db.batch();
        chunk.forEach((el, j) => batch.set(ref.doc(`cel_${el.orden ?? (i + j)}`), el));
        await batch.commit();
      }
      await _registrarLog('SISTEMA', `📐 Plantilla "${nombre}" guardada (${elementos.length} celdas)`, 'Sistema', '');
      return { ok: true, id, total: elementos.length };
    },

    async listarPlantillasMapa() {
      const snap = await db.collection('mapa_plantillas').orderBy('_savedAt', 'desc').get();
      return snap.docs.map(d => d.data());
    },

    async obtenerPlantillaMapa(id) {
      const snap = await db.collection('mapa_plantillas').doc(id).collection('estructura').orderBy('orden').get();
      if (snap.empty) throw new Error(`Plantilla "${id}" no encontrada`);
      return snap.docs.map(d => d.data());
    },

    async eliminarPlantillaMapa(id) {
      const ref = db.collection('mapa_plantillas').doc(id).collection('estructura');
      const snap = await ref.get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await db.collection('mapa_plantillas').doc(id).delete();
      return { ok: true };
    },

  };
})();
