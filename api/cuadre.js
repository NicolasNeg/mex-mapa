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
    _isMissingIndexError, _warnQueryFallback, _clasificarMovimientoPatio,
    _parseNotaOperativa, _formatNotasCuadreLikeFlota, _notaMetaFields
  } = window._mex;

  // Sincroniza la ubicación global de la unidad en index_unidades sin leer los
  // cuadres de todas las plazas. plazaActual = dónde está AHORA (vs sucursal =
  // de dónde es). Fire-and-forget: nunca rompe la mutación principal.
  async function _syncIndexUbicacion(mva, fields) {
    try {
      const mvaStr = String(mva || '').toUpperCase().trim();
      if (!mvaStr || !fields) return;
      const snap = await db.collection(COL.INDEX).where('mva', '==', mvaStr).limit(1).get();
      if (!snap.empty) await snap.docs[0].ref.set(fields, { merge: true });
    } catch (_) { /* el sync del índice no debe afectar la mutación */ }
  }

  // ponytail: espejo de domain/estado.model.js (scripts clásicos no importan ES modules).
  const _ESTADOS_FLOTA_CERRADOS = ['EN RENTA', 'TRASLADO', 'VENTA'];
  const _ESTADOS_PATIO_ARRENDABLES = ['LISTO', 'SUCIO', 'RESGUARDO'];

  function _normFlota(valor) {
    const upper = String(valor || '').trim().toUpperCase();
    if (!upper) return null;
    if (upper === 'RENTADO' || upper === 'RENTADA') return 'EN RENTA';
    if (upper === 'DISPONIBLE' || upper === 'LIMPIO') return 'ARRENDABLE';
    const ok = ['ARRENDABLE', 'NO ARRENDABLE', 'EN RENTA', 'TRASLADO', 'VENTA', 'MANTENIMIENTO'];
    return ok.includes(upper) ? upper : null;
  }

  function _normPatio(valor) {
    const upper = String(valor || '').trim().toUpperCase();
    if (!upper) return null;
    const ok = ['LISTO', 'SUCIO', 'MANTENIMIENTO', 'RESGUARDO', 'TRASLADO', 'NO ARRENDABLE', 'RETENIDA', 'VENTA', 'EXTERNO'];
    return ok.includes(upper) ? upper : upper;
  }

  function _leerFlotaIndex(data) {
    return _normFlota((data && (data.estadoFlota || data.estado || data.estatus)) || '');
  }

  function _derivarFlotaDesdePatio(estadoPatio, flotaActual) {
    const patio = _normPatio(estadoPatio);
    const actual = _normFlota(flotaActual);
    if (actual && _ESTADOS_FLOTA_CERRADOS.includes(actual)) return actual;
    if (!patio || patio === 'EXTERNO') return actual;
    if (_ESTADOS_PATIO_ARRENDABLES.includes(patio)) return 'ARRENDABLE';
    if (patio === 'MANTENIMIENTO') return 'MANTENIMIENTO';
    if (patio === 'NO ARRENDABLE' || patio === 'RETENIDA') return 'NO ARRENDABLE';
    if (patio === 'TRASLADO') return 'TRASLADO';
    if (patio === 'VENTA') return 'VENTA';
    return actual;
  }

  /** Sync ubicación + estadoFlota/estadoPatio al índice global. */
  async function _syncIndexEstadoYUbicacion(mva, { plazaActual, ubicacion, estadoPatio, pos } = {}) {
    try {
      const mvaStr = String(mva || '').toUpperCase().trim();
      if (!mvaStr) return;
      const snap = await db.collection(COL.INDEX).where('mva', '==', mvaStr).limit(1).get();
      if (snap.empty) return;
      const doc = snap.docs[0];
      const data = doc.data() || {};
      const patio = _normPatio(estadoPatio);
      const flotaActual = _leerFlotaIndex(data);
      const patch = {};
      if (plazaActual !== undefined) patch.plazaActual = plazaActual;
      if (ubicacion !== undefined) patch.ubicacion = ubicacion;
      if (pos !== undefined) patch.pos = pos;
      if (patio) {
        patch.estadoPatio = patio;
        const nextFlota = _derivarFlotaDesdePatio(patio, flotaActual);
        if (nextFlota) {
          patch.estadoFlota = nextFlota;
          // Alias legacy: Unidades / formularios que aún leen `estado` del index.
          if (!flotaActual || !_ESTADOS_FLOTA_CERRADOS.includes(flotaActual)) {
            patch.estado = nextFlota;
          }
        }
      }
      if (Object.keys(patch).length) await doc.ref.set(patch, { merge: true });
    } catch (_) { /* sync índice no debe romper mutación */ }
  }

  // ── KILOMETRAJE ──────────────────────────────────────────
  // ponytail: copia privada de domain/kilometraje.model.js::clasificarCaptura
  // (los scripts clásicos no importan ES modules). Mantener en sincronía.
  function _clasificarKm({ kmNuevo, kmAnterior, umbral = 5, fuenteUltima = '', esCorreccion = false }) {
    if (typeof kmNuevo !== 'number' || !Number.isFinite(kmNuevo) || kmNuevo < 0) return { tipo: 'INVALIDO', delta: 0 };
    if (kmAnterior == null) return { tipo: 'NORMAL', delta: 0 };
    const delta = kmNuevo - kmAnterior;
    if (esCorreccion) return { tipo: 'CORRECCION', delta };
    if (delta < 0) return { tipo: 'RECHAZADO_MENOR', delta };
    if (delta <= umbral) return { tipo: 'NORMAL', delta };
    const legitimas = ['RETIRO_RENTA', 'TRASLADO_SALIDA'];
    return legitimas.includes(String(fuenteUltima).toUpperCase().trim())
      ? { tipo: 'NORMAL', delta }
      : { tipo: 'DISCREPANCIA', delta };
  }

  function _parseKmInput(raw) {
    if (raw == null || raw === '') return null;
    const kmStr = String(raw).replace(/[,\s]/g, '');
    const kmNum = /^\d+$/.test(kmStr) ? parseInt(kmStr, 10) : NaN;
    return Number.isFinite(kmNum) && kmNum >= 0 ? kmNum : null;
  }

  function _kmUmbral() {
    const n = parseInt(window.MEX_CONFIG && window.MEX_CONFIG.listas && window.MEX_CONFIG.listas.kmUmbralDiscrepancia, 10);
    return Number.isFinite(n) && n >= 0 ? n : 5;
  }

  async function _cerrarInboxMisionCuadre(userDocId, missionId, extra = {}) {
    const uid = String(userDocId || '').trim();
    const mid = String(missionId || '').trim().toUpperCase();
    if (!uid || !mid) return;
    await db.collection(COL.USERS).doc(uid).collection('inbox').doc(mid).set({
      read: true,
      status: 'READ',
      missionStatus: 'COMPLETED',
      completedAt: Date.now(),
      updatedAt: Date.now(),
      ...extra
    }, { merge: true }).catch(() => {});
  }

  function _feedAccionUnidad(mvaStr, actual = {}, estado = '', ubi = '', gas = '', notaFinal = '', notaEntrada = '', borrarNotas = false) {
    const oldNotes = String(actual.notas || '').toUpperCase();
    const newNotes = String(notaFinal || notaEntrada || '').toUpperCase();
    const entered = String(notaEntrada || '').toUpperCase();
    const isErase = borrarNotas === true || borrarNotas === 'true';
    if (isErase && oldNotes.includes('DOBLE CERO') && !newNotes.includes('DOBLE CERO')) return `QUITAR_DOBLE_CERO: ${mvaStr}`;
    if (isErase && (oldNotes.includes('APARTAD') || oldNotes.includes('RESERVAD')) && !(newNotes.includes('APARTAD') || newNotes.includes('RESERVAD'))) return `QUITAR_APARTADO: ${mvaStr}`;
    if (isErase && oldNotes.includes('URGENTE') && !newNotes.includes('URGENTE')) return `QUITAR_URGENTE: ${mvaStr}`;
    if ((entered.includes('DOBLE CERO') || newNotes.includes('DOBLE CERO')) && !oldNotes.includes('DOBLE CERO')) return `DOBLE_CERO: ${mvaStr}`;
    if ((entered.includes('APARTAD') || entered.includes('RESERVAD') || newNotes.includes('APARTAD') || newNotes.includes('RESERVAD')) && !(oldNotes.includes('APARTAD') || oldNotes.includes('RESERVAD'))) return `APARTADO: ${mvaStr}`;
    if ((entered.includes('URGENTE') || newNotes.includes('URGENTE')) && !oldNotes.includes('URGENTE')) return `URGENTE: ${mvaStr}`;
    if (String(actual.estado || '') !== estado) return `${mvaStr} · ${actual.estado || 'SIN ESTADO'} → ${estado} (${ubi})`;
    if (String(actual.gasolina || '') !== gas) return `GAS: ${mvaStr} · ${actual.gasolina || '?'} → ${gas} (${ubi})`;
    if (String(notaFinal || '').trim() !== String(actual.notas || '').trim() && String(notaEntrada || '').trim()) return `NOTA: ${mvaStr}`;
    return `${mvaStr} · ${actual.estado || 'SIN ESTADO'} → ${estado} (${ubi})`;
  }

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
      const actorNota = nombreAutor || responsableSesion || "?";
      const notaFinal = _formatNotasCuadreLikeFlota(notasFormulario, actorNota, {
        borrarNotas,
        previousNotas: actual.notas || ""
      });
      const notaMeta = _notaMetaFields(notaFinal);
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
      const notaEntrada = notasFormulario ? String(notasFormulario).trim() : "";

      const touchActor = responsableSesion || nombreAutor || "Sistema";
      const nextVersion = currentVersion > 0 ? currentVersion + 1 : 1;
      const updatePayload = {
        gasolina: gas,
        estado,
        ubicacion: ubi,
        notas: notaFinal,
        notaAutor: notaMeta.notaAutor,
        notaFecha: notaMeta.notaFecha,
        _updatedAt: ahora,
        _updatedBy: touchActor,
        _version: nextVersion,
        version: nextVersion,
        lastTouchedAt: ahora,
        lastTouchedBy: touchActor
      };
      if (plazaUp && !actual.plaza) updatePayload.plaza = plazaUp;
      await docRef.update(updatePayload);
      _syncIndexEstadoYUbicacion(mvaStr, {
        plazaActual: plazaUp,
        ubicacion: ubi,
        estadoPatio: estado
      });
      await _actualizarFeed(_feedAccionUnidad(mvaStr, actual, estado, ubi, gas, notaFinal, notaEntrada, borrarNotas), responsableSesion, plazaUp);

      const cambiosReales = [];
      const cambiosEstructurados = [];
      const etiquetasCambio = [];
      const estadoAnterior = actual.estado || '';
      const estadoCambio = estadoAnterior !== estado;
      if (estadoCambio) {
        cambiosReales.push(`Estado ${estadoAnterior || '?'} → ${estado}`);
        cambiosEstructurados.push({ campo: 'estado', anterior: estadoAnterior, nuevo: estado });
        etiquetasCambio.push('Cambio de estado');
      }
      const gasolinaAnterior = actual.gasolina || '';
      if (gasolinaAnterior !== gas) {
        cambiosReales.push(`Gas ${gasolinaAnterior || '?'} → ${gas}`);
        cambiosEstructurados.push({ campo: 'gasolina', anterior: gasolinaAnterior, nuevo: gas });
        etiquetasCambio.push('Cambio de gasolina');
      }
      const ubicacionAnterior = actual.ubicacion || '';
      const ubicacionCambio = ubicacionAnterior !== ubi;
      if (ubicacionCambio) {
        cambiosReales.push(`Ubi ${ubicacionAnterior || '?'} → ${ubi}`);
        cambiosEstructurados.push({ campo: 'ubicacion', anterior: ubicacionAnterior, nuevo: ubi });
        etiquetasCambio.push('Cambio de ubicación');
      }
      const notaAnteriorRaw = (actual.notas || '').trim();
      const notaCambio = notaFinal.trim() !== notaAnteriorRaw;
      const notaAnterior = _parseNotaOperativa(notaAnteriorRaw).texto;
      const notaNueva = _parseNotaOperativa(notaFinal).texto;
      if (notaCambio) {
        if (!notaNueva) cambiosReales.push('Notas eliminadas');
        else if (borrarNotas === true || borrarNotas === 'true') cambiosReales.push('Notas reemplazadas');
        else cambiosReales.push('Nota añadida');
        cambiosEstructurados.push({ campo: 'notas', anterior: notaAnterior, nuevo: notaNueva });
        etiquetasCambio.push(notaNueva ? 'Notas actualizadas' : 'Notas eliminadas');
      }
      const logMsg = cambiosReales.length > 0
        ? `${mvaStr}: ${cambiosReales.join(' | ')}`
        : `${mvaStr} (revisión sin cambios)`;
      const cambioHuman = etiquetasCambio.length > 0
        ? etiquetasCambio.filter((c, i, arr) => arr.indexOf(c) === i).join(' · ')
        : 'Revisión sin cambios';
      await _registrarLog("MODIF", logMsg, responsableSesion, plazaUp, {
        mva: mvaStr,
        cambio: cambioHuman,
        ...(estadoCambio ? { estadoAnterior: estadoAnterior || '?', estadoNuevo: estado } : {}),
        ...(ubicacionCambio ? { ubicacionAnterior, ubicacionNueva: ubi } : {}),
        ...(notaCambio ? { notaAnterior, notaNueva } : {}),
        cambios: cambiosEstructurados
      });
      return "EXITO";
    },

    // Registra una captura de km: historial en km_registros (append-only),
    // actualiza index_unidades y el doc del cuadre si existe, y crea
    // discrepancia si el delta rebasa el umbral sin salida legítima.
    // fuente: INSERT | CUADRE | RETIRO | TRASLADO_SALIDA | TRASLADO_LLEGADA | CORRECCION
    async registrarKm({ mva, km, fuente, usuario, plaza, motivo = '', nota = '', trasladoId = '' }) {
      const mvaStr = String(mva || '').toUpperCase().trim();
      const kmNum = _parseKmInput(km);
      if (!mvaStr) return 'Falta MVA';
      if (kmNum == null) return 'Kilometraje inválido';
      const plazaUp = _normalizePlazaId(plaza);
      const fuenteUp = String(fuente || '').toUpperCase().trim();

      const idxSnap = await db.collection(COL.INDEX).where('mva', '==', mvaStr).limit(1).get();
      const idxData = idxSnap.empty ? {} : idxSnap.docs[0].data();
      const kmAnterior = (typeof idxData.km === 'number') ? idxData.km : null;

      const esCorreccion = fuenteUp === 'CORRECCION';
      if (esCorreccion && !(window.mexPerms && window.mexPerms.canDo('km_corregir'))) {
        return 'No tienes permiso para corregir kilometraje';
      }

      let c = _clasificarKm({
        kmNuevo: kmNum, kmAnterior, umbral: _kmUmbral(),
        fuenteUltima: idxData.kmFuenteUltima || '', esCorreccion
      });
      if (c.tipo === 'DISCREPANCIA' && (fuenteUp === 'TRASLADO_SALIDA' || fuenteUp === 'TRASLADO_LLEGADA')) {
        c = { tipo: 'NORMAL', delta: c.delta };
      }
      if (c.tipo === 'INVALIDO') return 'Kilometraje inválido';
      if (c.tipo === 'RECHAZADO_MENOR') {
        return `El km (${kmNum}) es menor al último registrado (${kmAnterior}). Si el registro anterior está mal, usa una corrección.`;
      }

      const ahora = _now();
      // RETIRO por renta se recuerda como salida legítima: el regreso con delta
      // grande no genera discrepancia.
      const fuenteUltima = (fuenteUp === 'RETIRO' && String(motivo).toUpperCase().trim() === 'RENTA')
        ? 'RETIRO_RENTA' : fuenteUp;

      await db.collection('km_registros').add({
        mva: mvaStr, km: kmNum, kmAnterior, delta: c.delta,
        fuente: fuenteUp, motivo: String(motivo || '').toUpperCase().trim(),
        usuario: usuario || 'Sistema', plaza: plazaUp || '',
        fecha: ahora, timestamp: _ts(),
        trasladoId: trasladoId || '', nota: nota || ''
      });

      if (!idxSnap.empty) {
        await idxSnap.docs[0].ref.set({ km: kmNum, kmFecha: ahora, kmFuenteUltima: fuenteUltima }, { merge: true });
      }
      // update (no set): si la unidad no está en el cuadre NO crear doc fantasma.
      try {
        await db.collection(COL.CUADRE).doc(_mvaToDocId(mvaStr)).update({ km: kmNum });
      } catch (_) { /* unidad puede no estar en cuadre (p.ej. solo índice) */ }

      if (c.tipo === 'DISCREPANCIA') {
        await db.collection('km_discrepancias').add({
          mva: mvaStr, kmEsperado: kmAnterior, kmCapturado: kmNum, delta: c.delta,
          fuente: fuenteUp, usuario: usuario || 'Sistema', plaza: plazaUp || '',
          fecha: ahora, timestamp: _ts(), estado: 'PENDIENTE'
        });
        await _registrarLog('KM', `KM DISCREPANCIA: ${mvaStr} · ${kmAnterior} → ${kmNum} (+${c.delta} km sin salida registrada)`, usuario, plazaUp, {
          mva: mvaStr,
          cambio: `Discrepancia de km: ${kmAnterior} → ${kmNum} (+${c.delta} km sin salida registrada)`
        });
        return 'DISCREPANCIA';
      }
      if (esCorreccion) {
        await _registrarLog('KM', `KM CORREGIDO: ${mvaStr} · ${kmAnterior} → ${kmNum}`, usuario, plazaUp, {
          mva: mvaStr,
          cambio: `Km corregido: ${kmAnterior} → ${kmNum}`
        });
      }
      return 'EXITO';
    },

    async insertarUnidadDesdeHTML(objeto) {
      const mvaStr = objeto.mva.toString().trim().toUpperCase();
      const docId  = _mvaToDocId(mvaStr);
      const plazaUp = (objeto.plaza || '').toUpperCase().trim();

      // Guard duro por docId (1 MVA = 1 doc en cuadre): evita duplicados aunque
      // falle el índice compuesto plaza+mva o el campo plaza esté vacío.
      const existingSnap = await db.collection(COL.CUADRE).doc(docId).get();
      if (existingSnap.exists) {
        const plazaDoc = String(existingSnap.data()?.plaza || '').toUpperCase().trim();
        if (!plazaUp || !plazaDoc || plazaDoc === plazaUp) {
          return `La unidad ${mvaStr} ya está registrada en el patio.`;
        }
        return `La unidad ${mvaStr} está en el cuadre de ${plazaDoc}. Retírala de ahí antes de insertarla aquí.`;
      }

      // Misma unidad en EXTERNOS (cualquier plaza) → bloquear insertar en patio.
      const existingExt = await db.collection(COL.EXTERNOS).doc(docId).get();
      if (existingExt.exists) {
        const plazaExt = String(existingExt.data()?.plaza || '').toUpperCase().trim();
        if (!plazaUp || !plazaExt || plazaExt === plazaUp) {
          return `La unidad ${mvaStr} ya está registrada como externa.`;
        }
        return `La unidad ${mvaStr} está en externos de ${plazaExt}. Retírala de ahí antes de insertarla aquí.`;
      }

      const dupQuery = plazaUp
        ? db.collection(COL.CUADRE).where("plaza", "==", plazaUp).where("mva", "==", mvaStr).limit(1)
        : db.collection(COL.CUADRE).where("mva", "==", mvaStr).limit(1);
      const existeLeg = await dupQuery.get();
      if (!existeLeg.empty) return `La unidad ${mvaStr} ya está registrada en el patio.`;

      const ahora = _now();
      const textoNota = _parseNotaOperativa(objeto.notas).texto;
      const notaFinal = textoNota
        ? `(${ahora}) [${objeto.responsableSesion || "?"}] ${textoNota}`
        : "";
      const notaMeta = _notaMetaFields(notaFinal);
      const indexSnap = await db.collection(COL.INDEX).where("mva", "==", mvaStr).limit(1).get();
      const indexData = indexSnap.empty ? {} : indexSnap.docs[0].data();

      // Guard: la unidad no puede estar activa en otra plaza (índice global).
      const plazaActualIdx = String(indexData.plazaActual || '').toUpperCase().trim();
      if (plazaActualIdx && plazaActualIdx !== plazaUp) {
        return `La unidad ${mvaStr} está registrada en la plaza ${plazaActualIdx}. Retírala de ahí antes de insertarla aquí.`;
      }
      // Si plazaActual vacío pero el índice apunta sucursal distinta y hay
      // señal de ocupación (pos), no insertar a ciegas en otra plaza.
      const sucursalIdx = String(indexData.sucursal || '').toUpperCase().trim();
      const posIdx = String(indexData.pos || '').trim();
      if (!plazaActualIdx && sucursalIdx && plazaUp && sucursalIdx !== plazaUp && posIdx) {
        return `La unidad ${mvaStr} figura activa en ${sucursalIdx}. Retírala de ahí antes de insertarla aquí.`;
      }

      const kmInsert = _parseKmInput(objeto.km);
      const unitData = {
        categoria:    indexData.categoria || objeto.categ || "S/C",
        modelo:       indexData.modelo || objeto.modelo || "S/M",
        mva:          mvaStr,
        placas:       indexData.placas || objeto.placas || "S/P",
        gasolina:     objeto.gasolina || "N/A",
        estado:       objeto.estado || "SUCIO",
        ubicacion:    objeto.ubicacion || "PATIO",
        notas:        notaFinal,
        notaAutor:    notaMeta.notaAutor,
        notaFecha:    notaMeta.notaFecha,
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
      // Persistir km en el doc de cuadre en el mismo write (no depender solo de
      // registrarKm posterior: si falla el historial, el km igual queda en unidad).
      if (kmInsert != null) unitData.km = kmInsert;

      // Transacción: evita carrera get-then-set si dos clientes insertan el mismo MVA.
      const cuadreRef = db.collection(COL.CUADRE).doc(docId);
      try {
        await db.runTransaction(async (tx) => {
          const live = await tx.get(cuadreRef);
          if (live.exists) {
            const plazaDoc = String(live.data()?.plaza || '').toUpperCase().trim();
            const msg = (!plazaUp || !plazaDoc || plazaDoc === plazaUp)
              ? `La unidad ${mvaStr} ya está registrada en el patio.`
              : `La unidad ${mvaStr} está en el cuadre de ${plazaDoc}. Retírala de ahí antes de insertarla aquí.`;
            const err = new Error(msg);
            err.code = 'already-exists';
            throw err;
          }
          tx.set(cuadreRef, unitData);
        });
      } catch (e) {
        if (e && (e.code === 'already-exists' || /ya está registrada|está en el cuadre/i.test(String(e.message || '')))) {
          return e.message;
        }
        throw e;
      }
      await _actualizarFeed(`IN: ${mvaStr} (${indexData.modelo || objeto.modelo})`, objeto.responsableSesion, plazaUp);
      await _registrarLog("IN", `INSERTADO: ${mvaStr}`, objeto.responsableSesion, plazaUp, {
        mva: mvaStr,
        cambio: 'Unidad insertada',
        ...(kmInsert != null ? { km: kmInsert } : {})
      });
      // Completitud del índice global: si la unidad no tiene doc en index_unidades,
      // lo creamos para que sea buscable (con su ubicación actual ya puesta).
      if (indexSnap.empty) {
        const patioInit = _normPatio(objeto.estado || 'SUCIO') || 'SUCIO';
        const flotaInit = _derivarFlotaDesdePatio(patioInit, null) || 'ARRENDABLE';
        // km lo escribe registrarKm (historial + índice) para que kmAnterior
        // quede null en la primera captura.
        await db.collection(COL.INDEX).add({
          mva: mvaStr,
          sucursal: plazaUp || '',
          modelo: unitData.modelo, placas: unitData.placas, categoria: unitData.categoria,
          plazaActual: plazaUp || '', pos: 'LIMBO', ubicacion: objeto.ubicacion || 'PATIO',
          estadoPatio: patioInit,
          estadoFlota: flotaInit,
          estado: flotaInit,
          _createdAt: ahora, _createdBy: objeto.responsableSesion || 'Sistema'
        }).catch(function () {});
      } else {
        _syncIndexEstadoYUbicacion(mvaStr, {
          plazaActual: plazaUp || '',
          pos: 'LIMBO',
          ubicacion: objeto.ubicacion || 'PATIO',
          estadoPatio: objeto.estado || 'SUCIO'
        });
      }
      // Historial append-only + sync índice/cuadre. Tolerante si falta km
      // (callers legacy p.ej. comando de voz).
      if (kmInsert != null) {
        try {
          const kmRes = await this.registrarKm({
            mva: mvaStr, km: kmInsert, fuente: 'INSERT',
            usuario: objeto.responsableSesion, plaza: plazaUp
          });
          if (kmRes !== 'EXITO' && kmRes !== 'DISCREPANCIA') {
            console.warn('[insertarUnidad] registrarKm:', kmRes);
          }
        } catch (err) {
          console.warn('[insertarUnidad] registrarKm falló; km ya está en cuadre:', err?.message || err);
        }
      }
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

      // Guard: la unidad no puede estar activa en otra plaza (índice global).
      const idxSnapExt = await db.collection(COL.INDEX).where("mva", "==", mvaStr).limit(1).get();
      const plazaActualExt = idxSnapExt.empty ? '' : String(idxSnapExt.docs[0].data().plazaActual || '').toUpperCase().trim();
      if (plazaActualExt && plazaActualExt !== plazaUp) {
        return `La unidad ${mvaStr} está registrada en la plaza ${plazaActualExt}.`;
      }

      const ahora = _now();
      const textoNota = _parseNotaOperativa(objeto.notas).texto;
      const notaFinal = textoNota
        ? `(${ahora}) [${objeto.responsableSesion || "?"}] ${textoNota}`
        : "";
      const notaMeta = _notaMetaFields(notaFinal);
      const unitData = {
        mva:          mvaStr,
        modelo:       (objeto.modelo || "S/M").toUpperCase(),
        categoria:    (objeto.categoria || objeto.categ || "EXTERNO").toUpperCase(),
        placas:       (objeto.placas || "S/P").toUpperCase(),
        estado:       "EXTERNO",
        ubicacion:    "EXTERNO",
        gasolina:     "N/A",
        notas:        notaFinal,
        notaAutor:    notaMeta.notaAutor,
        notaFecha:    notaMeta.notaFecha,
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
      await _registrarLog("IN", `EXTERNO INSERTADO: ${mvaStr}`, objeto.responsableSesion, plazaUp, {
        mva: mvaStr,
        cambio: 'Unidad externa insertada'
      });
      _syncIndexUbicacion(mvaStr, { plazaActual: plazaUp || '', pos: 'LIMBO', ubicacion: 'EXTERNO' });
      return `EXITO|${objeto.modelo || 'S/M'}|${objeto.placas || 'S/P'}`;
    },

    async ejecutarEliminacion(listaMvas, responsableSesion, plaza, retiro = null) {
      // Km de salida + motivo (RENTA/OTRO), solo para retiros individuales.
      const esRetiroIndividual = listaMvas.length === 1 && retiro && typeof retiro === 'object';
      const kmRetiro = esRetiroIndividual ? _parseKmInput(retiro.km) : null;
      const motivoInput = esRetiroIndividual ? String(retiro.motivo || '').trim().toUpperCase() : '';
      const motivoSalida = motivoInput === 'RENTA' || motivoInput === 'OTRO' ? motivoInput : '';
      if (kmRetiro != null) {
        try {
          await this.registrarKm({
            mva: listaMvas[0], km: kmRetiro, fuente: 'RETIRO',
            motivo: motivoSalida, usuario: responsableSesion, plaza
          });
        } catch (_) { /* best-effort: la eliminación procede igual */ }
      }
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
          await _registrarLog("BAJA", `SE ELIMINÓ LA UNIDAD: ${mvaStr}`, responsableSesion, plazaUp, {
            mva: mvaStr,
            cambio: 'Unidad eliminada',
            ...(kmRetiro != null ? { km: kmRetiro } : {}),
            ...(motivoSalida ? { motivoSalida } : {})
          });
          // Sale de todo cuadre → queda "No Registrado" en el índice global.
          _syncIndexUbicacion(mvaStr, { plazaActual: '', pos: '', ubicacion: '' });
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
          db.collection(COL.CUADRE).where('plaza', '==', plazaUp).get(),
          db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp).get()
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

      // Sincronizar la posición global de cada unidad movida (pos = nuevo cajón).
      histBatch.forEach(h => _syncIndexUbicacion(h.mva, { plazaActual: plazaUp || '', pos: h.posNueva }));

      // Solo movimientos REALES. (Bug previo: se insertaba la clave inversa con "+0",
      // así que has(reverse) era SIEMPRE true → TODO movimiento se marcaba SWAP.)
      const moveKeys = new Map();
      histBatch.forEach(h => {
        const key = `${String(h.posAnterior || '').toUpperCase()}->${String(h.posNueva || '').toUpperCase()}`;
        moveKeys.set(key, (moveKeys.get(key) || 0) + 1);
      });

      const auditExtra = _windowLocationAuditExtra(extra);
      const historialWrites = histBatch.map((h, i) => {
        const ts = _ts();
        const origen = String(h.posAnterior || '').toUpperCase();
        const destino = String(h.posNueva || '').toUpperCase();
        const tipo = _clasificarMovimientoPatio(origen, destino, moveKeys);
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
      const media = window.mexMedia?.uploadMedia
        ? window.mexMedia
        : await import('/js/core/media-upload.js');
      const folderFromPath = String(rutaStorage || 'evidencias_cuadre')
        .replace(/\/[^/]+$/, '') || 'evidencias_cuadre';
      const leaf = String(rutaStorage || '').split('/').pop()?.replace(/\.[^.]+$/, '') || `ev_${Date.now()}`;
      const type = String(file?.type || '');
      const resourceType = type.startsWith('image/')
        ? 'image'
        : (type.startsWith('video/') || type.startsWith('audio/') ? 'video' : 'raw');
      const result = await media.uploadMedia({
        folder: folderFromPath,
        file,
        publicId: leaf,
        resourceType
      });
      return result.url;
    },

    async obtenerCuadreAdminsData(plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const query = plazaUp
        ? db.collection(COL.CUADRE_ADM).where('plaza', '==', plazaUp).orderBy('_createdAt', 'desc')
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
            _previousNotas: actual.notas || "",
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
    async iniciarProtocoloDesdeAdmin(nombreAdmin, jsonMision, plaza, meta = {}) {
      const plazaUp = _normalizePlazaId(plaza);
      const missionId = String(meta.missionId || ('cuadre_' + Date.now() + '_' + Math.random().toString(16).slice(2, 8))).toUpperCase();
      const destinatarioDocId = String(meta.destinatarioDocId || meta.recipientDocId || meta.docId || '').trim();
      const destinatarioNombre = String(meta.destinatarioNombre || meta.recipientName || meta.nombre || '').trim();
      let unidades = [];
      if (Array.isArray(jsonMision)) {
        unidades = jsonMision;
      } else if (jsonMision && typeof jsonMision === 'object' && Array.isArray(jsonMision.unidades)) {
        unidades = jsonMision.unidades;
      } else if (typeof jsonMision === 'string') {
        try {
          const parsed = JSON.parse(jsonMision);
          if (Array.isArray(parsed)) {
            unidades = parsed;
          } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.unidades)) {
            unidades = parsed.unidades;
          }
        } catch (_) {}
      }
      const missionPayload = {
        missionId,
        tipo: 'CUADRE_FLOTA',
        creador: nombreAdmin || 'Sistema',
        creadorDocId: String(meta.creadorDocId || meta.adminDocId || '').trim(),
        creadorEmail: String(meta.creadorEmail || meta.adminEmail || '').trim(),
        destinatarioDocId,
        destinatarioNombre,
        plaza: plazaUp,
        unidades,
        estado: 'PENDIENTE',
        creadoEn: _now(),
        creadoAt: _ts()
      };
      await _setSettings({
        estadoCuadreV3: 'PROCESO',
        adminIniciador: nombreAdmin || 'Sistema',
        adminIniciadorDocId: String(meta.creadorDocId || meta.adminDocId || '').trim(),
        adminIniciadorEmail: String(meta.creadorEmail || meta.adminEmail || '').trim(),
        misionAuditoria: JSON.stringify(missionPayload),
        datosAuditoria: '[]',
        cuadreMissionId: missionId,
        cuadreDestinoDocId: destinatarioDocId,
        cuadreDestinoNombre: destinatarioNombre,
        cuadreMissionEstado: 'ENVIADA',
        ultimaModificacion: _now(),
        ultimoEditor: nombreAdmin || 'Sistema'
      }, plazaUp);
      if (destinatarioDocId) {
        await db.collection(COL.USERS).doc(destinatarioDocId).collection('inbox').doc(missionId).set({
          notificationId: missionId,
          type: 'cuadre.assigned',
          kindLabel: 'Mision de patio',
          title: 'Mision de patio',
          body: destinatarioNombre
            ? ('Tienes una nueva mision de cuadre para ' + (plazaUp || 'tu plaza') + '.')
            : 'Tienes una nueva mision de cuadre asignada.',
          deepLink: '/app/cuadrarflota?missionId=' + encodeURIComponent(missionId) + (plazaUp ? '&plaza=' + encodeURIComponent(plazaUp) : '') + '&source=inbox',
          plaza: plazaUp,
          senderLabel: nombreAdmin || 'Sistema',
          actorName: nombreAdmin || 'Sistema',
          recipientDocId: destinatarioDocId,
          recipientLabel: destinatarioNombre,
          missionId,
          missionUnits: unidades.length,
          timestamp: _ts(),
          createdAt: Date.now(),
          read: false,
          status: 'UNREAD',
          priority: 'HIGH',
          payload: {
            missionId,
            plaza: plazaUp,
            destinatarioDocId,
            destinatarioNombre,
            missionUnits: unidades.length,
            creadoPor: nombreAdmin || 'Sistema'
          }
        }, { merge: true });
      }
      await _registrarLog('CUADRE', 'MISION DE PATIO ENVIADA POR ' + (nombreAdmin || 'Sistema') + (destinatarioNombre ? ' A ' + destinatarioNombre : '') + ' (' + unidades.length + ' unidades)', nombreAdmin, plazaUp);
      return { exito: true, missionId, destinatarioDocId, destinatarioNombre, unidades: unidades.length };
    },

    async obtenerMisionAuditoria(plaza) {
      const settings = await _getSettings(plaza);
      const raw = settings.misionAuditoria || '[]';
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') {
          const unidades = Array.isArray(parsed.unidades)
            ? parsed.unidades
            : (Array.isArray(parsed.items) ? parsed.items : []);
          if (Array.isArray(unidades)) {
            unidades.meta = parsed;
            return unidades;
          }
        }
      } catch (_) {}
      return [];
    },

    async obtenerRevisionAuditoria(plaza) {
      const settings = await _getSettings(plaza);
      const raw = settings.datosAuditoria || '[]';
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') {
          const unidades = Array.isArray(parsed.unidades)
            ? parsed.unidades
            : (Array.isArray(parsed.items) ? parsed.items : []);
          if (Array.isArray(unidades)) {
            unidades.meta = parsed;
            return unidades;
          }
        }
      } catch (_) {}
      return [];
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
      const settings = await _getSettings(plaza);
      const missionId = String(settings.cuadreMissionId || '').trim();
      const destinoDocId = String(settings.cuadreDestinoDocId || '').trim();
      if (missionId && destinoDocId) {
        await _cerrarInboxMisionCuadre(destinoDocId, missionId, {
          title: 'Cuadre de flota completado',
          body: 'La misión de patio fue completada y cerrada por ventas.'
        });
      }
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
      await _registrarLog("CUADRE", `CUADRE CERRADO POR ${autor}`, autor, plaza);
      return "OK";
    },

    async marcarUltimaModificacion(autor, plaza) {
      await _setSettings({ ultimaModificacion: _now(), ultimoEditor: autor }, plaza);
      return "OK";
    },

    async obtenerHistorialCuadres(plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const rows = [];
      const seen = new Set();
      const pushDoc = (docSnap, plazaPath = "") => {
        const data = docSnap.data() || {};
        const rowPlaza = _normalizePlazaId(data.plaza || plazaPath);
        if (plazaUp && rowPlaza && rowPlaza !== plazaUp && !_matchesPlaza(data, plazaUp)) return;
        const key = docSnap.id;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({ id: docSnap.id, data: { ...data, plaza: rowPlaza || data.plaza || plazaUp } });
      };

      try {
        const snap = await db.collection(COL.HISTORIAL_CUADRES).orderBy("timestamp", "desc").limit(200).get();
        snap.docs.forEach(d => {
          if (_matchesPlaza(d.data(), plazaUp)) pushDoc(d);
        });
      } catch (error) {
        console.warn('[cuadre] historial plano no disponible:', error);
      }

      if (plazaUp) {
        try {
          const subSnap = await db.collection(COL.HISTORIAL_CUADRES)
            .doc(plazaUp)
            .collection('registros')
            .orderBy("timestamp", "desc")
            .limit(200)
            .get();
          subSnap.docs.forEach(d => pushDoc(d, plazaUp));
        } catch (error) {
          console.warn('[cuadre] historial por plaza no disponible:', error);
        }
      }

      return rows
        .sort((a, b) => Number(b.data.timestamp || 0) - Number(a.data.timestamp || 0))
        .slice(0, 30)
        .map(row => {
        const data = row.data;
        return {
          id:        row.id,
          fecha:     window._mex._fecha(data),
          tipo:      data.tipo || data.etapa || 'CUADRE',
          auxiliar:  data.auxiliar || data.autor || "",
          admin:     data.admin || data.adminVentas || "",
          ok:        data.ok || "0",
          faltantes: data.faltantes || "0",
          sobrantes: data.sobrantes || data.numSobrantes || "0",
          firmaAuxiliar: data.firmaAuxiliar || data.auxFirmaNombre || "",
          firmaVentas: data.firmaVentas || data.ventasFirmaNombre || "",
          estado:    data.estado || data.status || "",
          pdfUrl:    data.pdfUrl || "",
          jsonCompleto: data.jsonCompleto || "",
          meta:      data.meta || {},
          unidades:  Array.isArray(data.unidades) ? data.unidades : [],
          plaza:     data.plaza || plazaUp || ""
        };
      });
    },

    async procesarAuditoriaDesdeAdmin(auditList, autorAdmin, stats, plaza, meta = {}) {
      const plazaUp = (plaza || stats?.plaza || '').toUpperCase().trim();
      const units = Array.isArray(auditList)
        ? auditList
        : (auditList && typeof auditList === 'object' && Array.isArray(auditList.unidades) ? auditList.unidades : []);
      const revisionMeta = auditList && typeof auditList === 'object' && !Array.isArray(auditList)
        ? (auditList.meta || {})
        : (meta || {});
      const auxiliarNombre = String(meta.auxiliarNombre || revisionMeta.auxiliarNombre || revisionMeta.auxiliar || stats?.auxiliar || '').trim();
      const firmaAuxiliar = String(meta.firmaAuxiliar || revisionMeta.firmaAuxiliar || revisionMeta.auxiliarFirmaNombre || '').trim();
      const firmaVentas = String(meta.firmaVentas || meta.firmaNombre || autorAdmin || '').trim();
      const missionId = String(meta.missionId || revisionMeta.missionId || revisionMeta.cuadreMissionId || '').trim().toUpperCase();
      const auxiliarDocId = String(meta.auxiliarDocId || revisionMeta.auxiliarDocId || revisionMeta.destinatarioDocId || '').trim();
      const sobrantes = stats?.sobrantes ?? stats?.extras ?? 0;
      const faltantes = stats?.faltantes ?? 0;
      const ok = stats?.ok ?? 0;
      const pdfPayload = {
        unidades: units,
        stats: { ...(stats || {}), ok, faltantes, sobrantes, extras: sobrantes },
        meta: {
          ...revisionMeta,
          ...meta,
          missionId,
          auxiliarDocId,
          auxiliarNombre,
          firmaAuxiliar,
          firmaVentas,
          cerradoPor: autorAdmin || '',
          cerradoEn: _now(),
          plaza: plazaUp || ''
        }
      };
      await _registrarLog("CUADRE", `CUADRE VALIDADO - ${stats?.ok || 0} OK / ${stats?.faltantes || 0} FALTAN`, autorAdmin, plazaUp);
      const registro = {
        timestamp: _ts(), fecha: _now(),
        tipo:      'CUADRE_FLOTA',
        etapa:     'VENTAS',
        auxiliar:  auxiliarNombre,
        admin:     autorAdmin,
        ok,
        faltantes,
        sobrantes,
        firmaAuxiliar,
        firmaVentas,
        estado:    'CERRADO',
        plaza:     plazaUp || "",
        pdfUrl:    "",
        meta:      pdfPayload.meta,
        jsonCompleto: JSON.stringify(pdfPayload)
      };
      const docRef = await db.collection(COL.HISTORIAL_CUADRES).add(registro);
      if (plazaUp) {
        db.collection(COL.HISTORIAL_CUADRES)
          .doc(plazaUp)
          .collection('registros')
          .doc(docRef.id)
          .set(registro, { merge: true })
          .catch(error => console.warn('[cuadre] no se pudo espejar historial por plaza:', error));
      }
      await _setSettings({
        estadoCuadreV3: "LIBRE",
        adminIniciador: "",
        misionAuditoria: "[]",
        datosAuditoria: "[]",
        cuadreMissionId: "",
        cuadreDestinoDocId: "",
        cuadreDestinoNombre: "",
        cuadreRevisionEstado: "CERRADO",
        ultimaModificacion: _now(),
        ultimoEditor: autorAdmin || "Sistema"
      }, plazaUp);
      if (missionId && auxiliarDocId) {
        await _cerrarInboxMisionCuadre(auxiliarDocId, missionId, {
          title: 'Cuadre de flota completado',
          body: `Ventas cerró el cuadre${plazaUp ? ' de ' + plazaUp : ''}.`,
          payload: {
            missionId,
            plaza: plazaUp,
            historialId: docRef.id
          }
        });
      }
      return { exito: true, id: docRef.id, registro };
    },

  };
})();
