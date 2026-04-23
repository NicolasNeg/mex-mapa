// ═══════════════════════════════════════════════════════════
//  /api/cuadre.js  —  Modificaciones, cuadre admins, cuadre v3,
//                     unidades externas e inserción de flota
//  Depende de: window._mex (expuesto por mex-api.js)
// ═══════════════════════════════════════════════════════════
(function () {
  const {
    db, COL,
    _normalizePlazaId, _mvaToDocId, _now, _ts,
    _buscarUnidadEnSubcol,
    _actualizarFeed, _registrarLog, _registrarEventoGestion,
    _normalizeEvidenceItems, _normalizeLegacyEvidence, _dedupeEvidenceItems,
    _buildCuadreAdminPayload, _normalizeCuadreAdminRecord, _resolveCuadreAdminDocId,
    _uploadAdminEvidenceFiles, _deleteEvidenceFiles,
    _windowLocationAuditExtra, _matchesPlaza, _sanitizeText,
    _getSettings, _setSettings, _ensureGlobalSettingsDoc, _buildPlazaScopedQuery,
    _isMissingIndexError, _warnQueryFallback
  } = window._mex;

  window._mexParts = window._mexParts || {};
  window._mexParts.cuadre = {

    // ─── MODIFICACIONES ──────────────────────────────────
    async aplicarEstado(mva, estado, ubi, gas, notasFormulario, borrarNotas, nombreAutor, responsableSesion, plaza, meta = {}) {
      const mvaStr = mva.toString().trim().toUpperCase();
      const plazaUp = _normalizePlazaId(plaza);

      let docRef = null, actual = null;

      if (plazaUp) {
        let snap = await db.collection(COL.CUADRE).where('plaza', '==', plazaUp).where('mva', '==', mvaStr).limit(1).get();
        if (!snap.empty) { docRef = snap.docs[0].ref; actual = snap.docs[0].data(); }
        if (!docRef) {
          snap = await db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp).where('mva', '==', mvaStr).limit(1).get();
          if (!snap.empty) { docRef = snap.docs[0].ref; actual = snap.docs[0].data(); }
        }
      }
      if (!docRef) {
        const found = await _buscarUnidadEnSubcol(mvaStr, plazaUp);
        if (!found) return "ERROR: MVA no encontrado";
        docRef = found.ref;
        actual = found.data;
      }

      const ahora = _now();
      const sello = `(${ahora}) [${nombreAutor || "?"}]`;
      let notaFinal = actual.notas || "";
      const expectedVersion = Number(meta?.expectedVersion || meta?.version || 0) || 0;
      const currentVersion = Number(actual?.version || actual?._version || 0) || 0;
      if (expectedVersion && currentVersion && expectedVersion !== currentVersion) {
        return {
          ok: false,
          code: 'CONFLICT',
          mva: mvaStr,
          expectedVersion,
          currentVersion
        };
      }
      const notaEntrada = notasFormulario ? notasFormulario.trim() : "";
      if (borrarNotas === true || borrarNotas === "true") {
        notaFinal = notaEntrada !== "" ? `${sello} ${notaEntrada}` : "";
      } else if (notaEntrada !== "" && notaEntrada !== (actual.notas || "").trim()) {
        const tieneSello = /\(\d{4}/.test(notaEntrada);
        notaFinal = tieneSello ? notaEntrada : `${sello} ${notaEntrada}`;
      }

      const touchActor = responsableSesion || nombreAutor || "Sistema";
      const nextVersion = currentVersion > 0 ? currentVersion + 1 : 1;
      const updatePayload = {
        gasolina: gas,
        estado,
        ubicacion: ubi,
        notas: notaFinal,
        _updatedAt: ahora,
        _updatedBy: touchActor,
        _version: nextVersion,
        version: nextVersion,
        lastTouchedAt: ahora,
        lastTouchedBy: touchActor
      };
      if (plazaUp && !actual.plaza) updatePayload.plaza = plazaUp;
      await docRef.update(updatePayload);
      await _actualizarFeed(`${mvaStr} · ${actual.estado || "SIN ESTADO"} ➜ ${estado} (${ubi})`, responsableSesion, plazaUp);

      const cambiosReales = [];
      if ((actual.estado || '') !== estado) cambiosReales.push(`Estado ${actual.estado || '?'} → ${estado}`);
      if ((actual.gasolina || '') !== gas) cambiosReales.push(`Gas ${actual.gasolina || '?'} → ${gas}`);
      if ((actual.ubicacion || '') !== ubi) cambiosReales.push(`Ubi ${actual.ubicacion || '?'} → ${ubi}`);
      const notaAnterior = (actual.notas || '').trim();
      if (notaFinal.trim() !== notaAnterior && notaEntrada !== '') {
        cambiosReales.push(borrarNotas === true || borrarNotas === 'true' ? 'Notas reemplazadas' : 'Nota añadida');
      }
      if (borrarNotas === true || borrarNotas === 'true' && notaEntrada === '') {
        cambiosReales.push('Notas eliminadas');
      }
      const logMsg = cambiosReales.length > 0
        ? `✏️ ${mvaStr}: ${cambiosReales.join(' | ')}`
        : `🔄 ${mvaStr} (revisión sin cambios)`;
      await _registrarLog("MODIF", logMsg, responsableSesion, plazaUp);
      return "EXITO";
    },

    async insertarUnidadDesdeHTML(objeto) {
      const mvaStr = objeto.mva.toString().trim().toUpperCase();
      const docId  = _mvaToDocId(mvaStr);
      const plazaUp = (objeto.plaza || '').toUpperCase().trim();

      const dupQuery = plazaUp
        ? db.collection(COL.CUADRE).where("plaza", "==", plazaUp).where("mva", "==", mvaStr).limit(1)
        : db.collection(COL.CUADRE).where("mva", "==", mvaStr).limit(1);
      const existeLeg = await dupQuery.get();
      if (!existeLeg.empty) return `La unidad ${mvaStr} ya está registrada en el patio.`;

      const ahora = _now();
      const notaFinal = objeto.notas ? `(${ahora}) - ${objeto.notas} - ${objeto.responsableSesion || ""}` : "";
      const indexSnap = await db.collection(COL.INDEX).where("mva", "==", mvaStr).limit(1).get();
      const indexData = indexSnap.empty ? {} : indexSnap.docs[0].data();

      const unitData = {
        categoria:    indexData.categoria || objeto.categ || "S/C",
        modelo:       indexData.modelo || objeto.modelo || "S/M",
        mva:          mvaStr,
        placas:       indexData.placas || objeto.placas || "S/P",
        gasolina:     objeto.gasolina || "N/A",
        estado:       objeto.estado || "SUCIO",
        ubicacion:    objeto.ubicacion || "PATIO",
        notas:        notaFinal,
        pos:          "LIMBO",
        plaza:        plazaUp || null,
        fechaIngreso: new Date().toISOString(),
        _createdAt:   ahora,
        _createdBy:   objeto.responsableSesion || "Sistema",
        _updatedAt:   ahora,
        _updatedBy:   objeto.responsableSesion || "Sistema",
        _version:     1,
        version:      1,
        lastTouchedAt: ahora,
        lastTouchedBy: objeto.responsableSesion || "Sistema"
      };

      await db.collection(COL.CUADRE).doc(docId).set(unitData);
      await _actualizarFeed(`IN: ${mvaStr} (${indexData.modelo || objeto.modelo})`, objeto.responsableSesion, plazaUp);
      await _registrarLog("IN", `📥 INSERTADO: ${mvaStr}`, objeto.responsableSesion, plazaUp);
      return `EXITO|${indexData.modelo || objeto.modelo}|${indexData.placas || objeto.placas}`;
    },

    async insertarUnidadExterna(objeto) {
      const mvaStr  = objeto.mva.toString().trim().toUpperCase();
      const docId   = _mvaToDocId(mvaStr);
      const plazaUp = (objeto.plaza || '').toUpperCase().trim();

      const dupQueryExt = plazaUp
        ? db.collection(COL.EXTERNOS).where("plaza", "==", plazaUp).where("mva", "==", mvaStr).limit(1)
        : db.collection(COL.EXTERNOS).where("mva", "==", mvaStr).limit(1);
      const existeLeg = await dupQueryExt.get();
      if (!existeLeg.empty) return `La unidad externa ${mvaStr} ya está registrada.`;

      const ahora = _now();
      const notaFinal = objeto.notas ? `(${ahora}) - ${objeto.notas} - ${objeto.responsableSesion || ""}` : "";
      const unitData = {
        mva:          mvaStr,
        modelo:       (objeto.modelo || "S/M").toUpperCase(),
        categoria:    (objeto.categoria || objeto.categ || "EXTERNO").toUpperCase(),
        placas:       (objeto.placas || "S/P").toUpperCase(),
        estado:       "EXTERNO",
        ubicacion:    "EXTERNO",
        gasolina:     "N/A",
        notas:        notaFinal,
        pos:          "LIMBO",
        plaza:        plazaUp || null,
        tipo:         "externo",
        fechaIngreso: new Date().toISOString(),
        _createdAt:   ahora,
        _createdBy:   objeto.responsableSesion || "Sistema",
        _updatedAt:   ahora,
        _updatedBy:   objeto.responsableSesion || "Sistema",
        _version:     1,
        version:      1,
        lastTouchedAt: ahora,
        lastTouchedBy: objeto.responsableSesion || "Sistema"
      };

      await db.collection(COL.EXTERNOS).doc(docId).set(unitData);
      await _actualizarFeed(`EXT IN: ${mvaStr} (${objeto.modelo || 'S/M'})`, objeto.responsableSesion, plazaUp);
      await _registrarLog("IN", `🚗 EXTERNO INSERTADO: ${mvaStr}`, objeto.responsableSesion, plazaUp);
      return `EXITO|${objeto.modelo || 'S/M'}|${objeto.placas || 'S/P'}`;
    },

    async ejecutarEliminacion(listaMvas, responsableSesion, plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      for (const mva of listaMvas) {
        const mvaStr = mva.toString().trim().toUpperCase();
        let eliminado = false;

        if (plazaUp) {
          let snap = await db.collection(COL.CUADRE).where('plaza', '==', plazaUp).where('mva', '==', mvaStr).limit(1).get();
          if (!snap.empty) { await snap.docs[0].ref.delete(); eliminado = true; }
          snap = await db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp).where('mva', '==', mvaStr).limit(1).get();
          if (!snap.empty) { await snap.docs[0].ref.delete(); eliminado = true; }
        }

        if (!eliminado) {
          const found = await _buscarUnidadEnSubcol(mvaStr, plazaUp);
          if (found) { await found.ref.delete(); eliminado = true; }
        }

        if (eliminado) {
          await _actualizarFeed(`BAJA: ${mvaStr}`, responsableSesion, plazaUp);
          await _registrarLog("BAJA", `🗑️ SE ELIMINÓ LA UNIDAD: ${mvaStr}`, responsableSesion, plazaUp);
        }
      }
      return "EXITO";
    },

    async guardarNuevasPosiciones(reporte, usuarioResponsable, plaza, extra = {}) {
      const plazaUp = _normalizePlazaId(plaza);
      const batch = db.batch();
      const histBatch = [];
      const conflicts = [];
      const touchActor = usuarioResponsable || "Sistema";

      const unitMap = {};
      if (plazaUp) {
        const [cuadreSnap, externosSnap] = await Promise.all([
          (typeof _buildPlazaScopedQuery === 'function'
            ? _buildPlazaScopedQuery(COL.CUADRE, plazaUp)
            : db.collection(COL.CUADRE).where('plaza', '==', plazaUp)).get(),
          (typeof _buildPlazaScopedQuery === 'function'
            ? _buildPlazaScopedQuery(COL.EXTERNOS, plazaUp)
            : db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp)).get()
        ]);
        cuadreSnap.docs.forEach(d => {
          const mva = (d.data().mva || '').toString().trim().toUpperCase();
          if (mva && !unitMap[mva]) unitMap[mva] = { ref: d.ref, data: d.data(), hoja: 'CUADRE' };
        });
        externosSnap.docs.forEach(d => {
          const mva = (d.data().mva || '').toString().trim().toUpperCase();
          if (mva && !unitMap[mva]) unitMap[mva] = { ref: d.ref, data: d.data(), hoja: 'EXTERNOS' };
        });
      }

      for (const item of reporte) {
        if (!item.mva || !item.pos) continue;
        const mvaStr = item.mva.toString().trim().toUpperCase();
        const posNueva = item.pos.toString().toUpperCase();
        let found = unitMap[mvaStr] || null;

        if (!found) {
          const sub = await _buscarUnidadEnSubcol(mvaStr, plazaUp);
          if (sub) {
            const col = (sub.ref.parent?.id || '');
            found = { ref: sub.ref, data: sub.data, hoja: col === COL.EXTERNOS ? 'EXTERNOS' : 'CUADRE' };
          }
        }

        if (found) {
          const posAnterior = found.data.pos || "LIMBO";
          if (posAnterior !== posNueva) {
            const currentVersion = Number(found.data.version || found.data._version || 0) || 0;
            const expectedVersion = Number(item.expectedVersion || item.version || 0) || 0;
            if (expectedVersion && currentVersion && expectedVersion !== currentVersion) {
              conflicts.push({
                mva: mvaStr,
                expectedVersion,
                currentVersion,
                posAnterior,
                posNueva
              });
              continue;
            }
            const ahora = _now();
            const nextVersion = currentVersion > 0 ? currentVersion + 1 : 1;
            batch.set(found.ref, {
              pos: posNueva,
              version: nextVersion,
              _version: nextVersion,
              lastTouchedAt: ahora,
              lastTouchedBy: touchActor,
              _updatedAt: ahora,
              _updatedBy: touchActor
            }, { merge: true });
            histBatch.push({ mva: mvaStr, hoja: found.hoja, posAnterior, posNueva });
          }
        }
      }
      if (!histBatch.length) {
        return conflicts.length
          ? { ok: false, code: 'CONFLICT', conflicts }
          : true;
      }

      await batch.commit();

      const pairKeys = new Map();
      histBatch.forEach(h => {
        const key = `${String(h.posAnterior || '').toUpperCase()}->${String(h.posNueva || '').toUpperCase()}`;
        const reverseKey = `${String(h.posNueva || '').toUpperCase()}->${String(h.posAnterior || '').toUpperCase()}`;
        pairKeys.set(key, (pairKeys.get(key) || 0) + 1);
        pairKeys.set(reverseKey, (pairKeys.get(reverseKey) || 0) + 0);
      });

      const auditExtra = _windowLocationAuditExtra(extra);
      const historialWrites = histBatch.map((h, i) => {
        const ts = _ts();
        const origen = String(h.posAnterior || '').toUpperCase();
        const destino = String(h.posNueva || '').toUpperCase();
        const isLimboMove = destino === 'LIMBO';
        const isSwap = !isLimboMove && pairKeys.has(`${destino}->${origen}`);
        const tipo = isLimboMove ? 'DEL' : (isSwap ? 'SWAP' : 'MOVE');
        const payload = {
          timestamp: ts, fecha: _now(), tipo,
          mva: h.mva, hoja: h.hoja,
          posAnterior: h.posAnterior, posNueva: h.posNueva,
          autor: usuarioResponsable || "Sistema", plaza: plazaUp || ""
        };
        if (auditExtra.locationStatus) payload.locationStatus = auditExtra.locationStatus;
        if (auditExtra.exactLocation) payload.exactLocation = auditExtra.exactLocation;
        if (auditExtra.ipAddress) payload.ipAddress = auditExtra.ipAddress;
        if (auditExtra.forwardedFor) payload.forwardedFor = auditExtra.forwardedFor;
        return db.collection("historial_patio").doc(`${tipo.toLowerCase()}_${i}_${ts}`).set(payload);
      });

      Promise.allSettled(historialWrites).then(results => {
        const errores = results.filter(r => r.status === 'rejected');
        if (errores.length) console.warn(`[guardarNuevasPosiciones] ${errores.length} historial no guardado.`);
      });

      return conflicts.length
        ? { ok: true, saved: histBatch.length, conflicts }
        : true;
    },

    // ─── CUADRE ADMINS ────────────────────────────────────
    async subirEvidenciaAdmin(file, rutaStorage) {
      const { _getStorageClient } = window._mex;
      const storage = _getStorageClient();
      if (!storage) throw new Error('Storage no disponible');
      const ref = storage.ref(rutaStorage);
      await ref.put(file);
      return await ref.getDownloadURL();
    },

    async obtenerCuadreAdminsData(plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const query = plazaUp
        ? (typeof _buildPlazaScopedQuery === 'function'
          ? _buildPlazaScopedQuery(COL.CUADRE_ADM, plazaUp, { orderBy: { field: '_createdAt', direction: 'desc' } })
          : db.collection(COL.CUADRE_ADM).where('plaza', '==', plazaUp).orderBy('_createdAt', 'desc'))
        : db.collection(COL.CUADRE_ADM).orderBy("_createdAt", "desc");
      const snap = await query.get().catch(async error => {
        if (!_isMissingIndexError?.(error) || !plazaUp) throw error;
        _warnQueryFallback?.('obtenerCuadreAdminsData', error);
        return db.collection(COL.CUADRE_ADM).orderBy('_createdAt', 'desc').limit(300).get();
      });
      const docs = snap.docs.filter(d => !plazaUp || _matchesPlaza(d.data(), plazaUp));
      return Promise.all(docs.map(d => _normalizeCuadreAdminRecord(d.id, d.data())));
    },

    async procesarModificacionMaestra(datos, tipoAccion) {
      try {
        const actor = _sanitizeText(datos.adminResponsable || datos._updatedBy || datos._createdBy || datos.autor) || "Sistema";
        const mva = _sanitizeText(datos.mva).toUpperCase();
        const manualEvidence = _normalizeEvidenceItems(datos.evidencias || []);
        const evidenceFiles = datos.evidenceFiles || [];

        if (tipoAccion === "ADD" || tipoAccion === "INSERTAR") {
          if (!mva) return "ERROR: Falta la unidad (MVA) para registrar en Cuadre Admins.";
          const payload = _buildCuadreAdminPayload({ ...datos, mva, _createdAt: _now(), _createdBy: actor }, manualEvidence);
          if (!payload.plaza) return "ERROR: Falta la plaza operativa para registrar en Cuadre Admins.";
          const plazaUp = _normalizePlazaId(payload.plaza);
          const docResolution = await _resolveCuadreAdminDocId(mva, plazaUp);
          if (docResolution.duplicate) return `DUPLICADO: La unidad ${mva} ya está registrada en Cuadre Admins para la plaza ${plazaUp}.`;
          const newRef = db.collection(COL.CUADRE_ADM).doc(docResolution.docId);
          const uploadedEvidence = await _uploadAdminEvidenceFiles(evidenceFiles, newRef.id, actor);
          const finalPayload = _buildCuadreAdminPayload(
            { ...datos, mva, _createdAt: _now(), _createdBy: actor },
            [...manualEvidence, ...uploadedEvidence]
          );
          await newRef.set(finalPayload);

        } else if (tipoAccion === "MODIFICAR") {
          if (!datos.fila) return "ERROR: Sin ID de fila";
          const ref = db.collection(COL.CUADRE_ADM).doc(datos.fila);
          const snap = await ref.get();
          if (!snap.exists) return "ERROR: Registro no encontrado";
          const actual = snap.data();
          const uploadedEvidence = await _uploadAdminEvidenceFiles(evidenceFiles, datos.fila, actor);
          const evidencias = _dedupeEvidenceItems([
            ..._normalizeLegacyEvidence(actual), ...manualEvidence, ...uploadedEvidence
          ]);
          const payload = _buildCuadreAdminPayload({
            ...actual, ...datos,
            mva: mva || _sanitizeText(actual.mva).toUpperCase(),
            _createdAt: actual._createdAt || _now(),
            _createdBy: actual._createdBy || actor
          }, evidencias);
          if (!payload.plaza) return "ERROR: Falta la plaza operativa para actualizar en Cuadre Admins.";
          await ref.set(payload, { merge: true });

        } else if (tipoAccion === "ELIMINAR") {
          if (!datos.fila) return "ERROR: Sin ID de fila";
          const ref = db.collection(COL.CUADRE_ADM).doc(datos.fila);
          const snap = await ref.get();
          if (snap.exists) {
            await _deleteEvidenceFiles(_normalizeLegacyEvidence(snap.data()));
            await ref.delete();
          }
        }
        return "EXITO";
      } catch(e) { return "ERROR: " + e.message; }
    },

    async obtenerConteoGeneral() {
      const conteo = { LISTO: 0, SUCIO: 0, MANTENIMIENTO: 0, total: 0 };
      const snap = await db.collection(COL.CUADRE).get();
      snap.docs.forEach(d => {
        const estado = (d.data().estado || "").toUpperCase();
        if (conteo[estado] !== undefined) conteo[estado]++;
        conteo.total++;
      });
      return conteo;
    },

    async obtenerMovimientosRecientes() {
      const snap = await db.collection(COL.LOGS).orderBy("timestamp", "desc").limit(20).get();
      return snap.docs.map(d => d.data());
    },

    // ─── CUADRE V3 ────────────────────────────────────────
    async iniciarProtocoloDesdeAdmin(nombreAdmin, jsonMision, plaza) {
      await _setSettings({
        estadoCuadreV3: "PROCESO",
        adminIniciador: nombreAdmin,
        misionAuditoria: jsonMision,
        datosAuditoria: "[]",
        ultimaModificacion: _now(),
        ultimoEditor: nombreAdmin || "Sistema"
      }, plaza);
      return "EXITO";
    },

    async obtenerMisionAuditoria(plaza) {
      const settings = await _getSettings(plaza);
      try { return JSON.parse(settings.misionAuditoria || "[]"); } catch { return []; }
    },

    async obtenerRevisionAuditoria(plaza) {
      const settings = await _getSettings(plaza);
      try { return JSON.parse(settings.datosAuditoria || "[]"); } catch { return []; }
    },

    async guardarAuditoriaCruzada(datosAuditoria, autor, plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      await _setSettings({
        estadoCuadreV3: "REVISION",
        datosAuditoria: JSON.stringify(datosAuditoria),
        ultimaModificacion: _now(),
        ultimoEditor: autor || "Sistema"
      }, plazaUp);
      await db.collection(COL.AUDITORIA).add({ timestamp: _ts(), fecha: _now(), autor, datos: datosAuditoria, plaza: plazaUp });
      return "EXITO";
    },

    async finalizarProtocoloV3(autorCierre, plaza) {
      await _setSettings({
        estadoCuadreV3: "LIBRE",
        adminIniciador: "",
        misionAuditoria: "[]",
        datosAuditoria: "[]",
        ultimoCuadreTexto: `${autorCierre} (${_now()})`,
        ultimaModificacion: _now(),
        ultimoEditor: autorCierre || "Sistema"
      }, plaza);
      return "CUADRE FINALIZADO CON ÉXITO";
    },

    async registrarCierreCuadre(autor, plaza) {
      await _setSettings({ ultimoCuadreTexto: `${autor} (${_now()})` }, plaza);
      await _registrarLog("CUADRE", `✅ CUADRE CERRADO POR ${autor}`, autor, plaza);
      return "OK";
    },

    async marcarUltimaModificacion(autor, plaza) {
      await _setSettings({ ultimaModificacion: _now(), ultimoEditor: autor }, plaza);
      return "OK";
    },

    async obtenerHistorialCuadres(plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const snap = await db.collection(COL.HISTORIAL_CUADRES).orderBy("timestamp", "desc").limit(200).get();
      const filtrados = snap.docs.filter(d => _matchesPlaza(d.data(), plazaUp)).slice(0, 30);
      return filtrados.map(d => {
        const data = d.data();
        return {
          id:        d.id,
          fecha:     window._mex._fecha(data),
          auxiliar:  data.auxiliar || data.autor || "",
          admin:     data.admin || data.adminVentas || "",
          ok:        data.ok || "0",
          faltantes: data.faltantes || "0",
          sobrantes: data.sobrantes || data.numSobrantes || "0",
          pdfUrl:    data.pdfUrl || data.jsonCompleto || "",
          plaza:     data.plaza || plazaUp || ""
        };
      });
    },

    async procesarAuditoriaDesdeAdmin(auditList, autorAdmin, stats, plaza) {
      const plazaUp = (plaza || stats?.plaza || '').toUpperCase().trim();
      await _registrarLog("CUADRE", `✅ CUADRE VALIDADO - ${stats?.ok || 0} OK / ${stats?.faltantes || 0} FALTAN`, autorAdmin, plazaUp);
      const registro = {
        timestamp: _ts(), fecha: _now(),
        auxiliar:  stats?.auxiliar || "",
        admin:     autorAdmin,
        ok:        stats?.ok || 0,
        faltantes: stats?.faltantes || 0,
        sobrantes: stats?.sobrantes || 0,
        plaza:     plazaUp || "",
        pdfUrl:    ""
      };
      await db.collection(COL.HISTORIAL_CUADRES).add(registro);
      await _setSettings({
        estadoCuadreV3: "LIBRE",
        adminIniciador: "",
        misionAuditoria: "[]",
        datosAuditoria: "[]",
        ultimaModificacion: _now(),
        ultimoEditor: autorAdmin || "Sistema"
      }, plazaUp);
      return "EXITO";
    },

  };
})();
