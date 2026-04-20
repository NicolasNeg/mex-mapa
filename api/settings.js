// ═══════════════════════════════════════════════════════════
//  /api/settings.js  —  Settings, radar, bloqueo, config global,
//                        SIPP, email/AI/PDF y utilidades
//  Depende de: window._mex (expuesto por mex-api.js)
// ═══════════════════════════════════════════════════════════
(function () {
  const {
    db, COL,
    _normalizePlazaId, _now, _ts, _sanitizeText,
    _getSettings, _setSettings, _ensureGlobalSettingsDoc,
    _resolverEstadoBloqueoMapa, _actualizarFeed,
    _registrarLog, _registrarEventoGestion,
    _alertMatchesUser, _alertReadByUser,
    _matchesPlaza, _normalizePlazaLocationItem,
    _buildDefaultPlazaLocations, _ensurePlazaBootstrap,
    _configPlazaRef, backfillPlazaEnUnidades, _buildPlazaScopedQuery,
    _isMissingIndexError, _warnQueryFallback
  } = window._mex;

  window._mexParts = window._mexParts || {};
  window._mexParts.settings = {

    // ─── RADAR ────────────────────────────────────────────
    async checarNotificaciones(usuarioActivo, plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const alertasQuery = plazaUp
        ? (typeof _buildPlazaScopedQuery === 'function'
          ? _buildPlazaScopedQuery(COL.ALERTAS, plazaUp, { orderBy: { field: 'timestamp', direction: 'desc' }, limit: 50 })
          : db.collection(COL.ALERTAS).where('plaza', '==', plazaUp).orderBy('timestamp', 'desc').limit(50))
        : db.collection(COL.ALERTAS).orderBy("timestamp", "desc").limit(50);
      const notasQuery = plazaUp
        ? db.collection(COL.NOTAS).where('plaza', '==', plazaUp).where("estado", "==", "PENDIENTE")
        : db.collection(COL.NOTAS).where("estado", "==", "PENDIENTE");
      const alertasPromise = alertasQuery.get().catch(async error => {
        if (!_isMissingIndexError?.(error) || !plazaUp) throw error;
        _warnQueryFallback?.('checarNotificaciones.alertas', error);
        return db.collection(COL.ALERTAS).orderBy('timestamp', 'desc').limit(200).get();
      });
      const notasPromise = notasQuery.get().catch(async error => {
        if (!_isMissingIndexError?.(error) || !plazaUp) throw error;
        _warnQueryFallback?.('checarNotificaciones.notas', error);
        return db.collection(COL.NOTAS).where("estado", "==", "PENDIENTE").get();
      });

      const [settings, globalSettings, alertasSnap, msgsSnap, notasSnap] = await Promise.all([
        _getSettings(plaza),
        _getSettings('GLOBAL'),
        alertasPromise,
        db.collection(COL.MENSAJES).where("destinatario", "==", usuarioActivo.toUpperCase()).get(),
        notasPromise
      ]);
      const alertas = alertasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(a => !plazaUp || _matchesPlaza(a, plazaUp))
        .filter(a => !_alertReadByUser(a, usuarioActivo))
        .filter(a => _alertMatchesUser(a, usuarioActivo));
      const mensajesSinLeer = msgsSnap.docs.filter(d => d.data().leido !== "SI").length;
      let liveFeed = settings.liveFeed || [];
      if (typeof liveFeed === "string") { try { liveFeed = JSON.parse(liveFeed); } catch { liveFeed = []; } }
      if (!Array.isArray(liveFeed)) liveFeed = [];
      const lockState = _resolverEstadoBloqueoMapa(settings, globalSettings);
      return {
        incidenciasPendientes: notasSnap.docs.filter(d => !plazaUp || _matchesPlaza(d.data(), plazaUp)).length, alertas, mensajesSinLeer,
        ultimaActualizacion: settings.ultimaModificacion || "--/-- 00:00",
        ultimoCuadre:        settings.ultimoCuadreTexto || "Sin registro",
        mapaBloqueado:       lockState.mapaBloqueado,
        mapaBloqueadoScope:  lockState.mapaBloqueadoScope,
        mapaBloqueadoLocal:  lockState.mapaBloqueadoLocal,
        mapaBloqueadoGlobal: lockState.mapaBloqueadoGlobal,
        estadoCuadreV3:      settings.estadoCuadreV3 || "LIBRE",
        adminIniciador:      settings.adminIniciador || "",
        liveFeed, error: null
      };
    },

    async limpiarFeedGlobal(plaza) {
      await _setSettings({ liveFeed: JSON.stringify([]) }, plaza);
      return "OK";
    },

    async actualizarFeedSettings(accion, autor, plaza) {
      await _actualizarFeed(accion, autor, plaza);
      return "OK";
    },

    // ─── BLOQUEO ──────────────────────────────────────────
    async ensureGlobalSettingsDoc() {
      await _ensureGlobalSettingsDoc();
      return "OK";
    },

    async toggleBloqueoMapa(nuevoEstado, actor = "Sistema", plaza, scope = "PLAZA") {
      const enabled = nuevoEstado === true;
      const scopeNorm = String(scope || "PLAZA").trim().toUpperCase() === "GLOBAL" ? "GLOBAL" : "PLAZA";
      const plazaUp = _normalizePlazaId(plaza);

      if (scopeNorm === "GLOBAL") {
        await _ensureGlobalSettingsDoc();
        await _setSettings({
          mapaBloqueadoGlobal: enabled,
          ultimaModificacion: _now(),
          ultimoEditor: actor || "Sistema"
        }, 'GLOBAL');
        await _registrarEventoGestion(
          enabled ? "MAPA_BLOQUEADO_GLOBAL" : "MAPA_LIBERADO_GLOBAL",
          enabled ? "Bloqueó el mapa operativo global" : "Liberó el mapa operativo global",
          actor || "Sistema",
          { entidad: "SETTINGS", referencia: "mapaBloqueadoGlobal", alcance: "GLOBAL" }
        );
        return "OK";
      }

      await _setSettings({
        mapaBloqueado: enabled,
        ultimaModificacion: _now(),
        ultimoEditor: actor || "Sistema"
      }, plaza);
      await _registrarEventoGestion(
        enabled ? "MAPA_BLOQUEADO" : "MAPA_LIBERADO",
        enabled
          ? `Bloqueó el mapa operativo de ${plazaUp || 'PLAZA ACTUAL'}`
          : `Liberó el mapa operativo de ${plazaUp || 'PLAZA ACTUAL'}`,
        actor || "Sistema",
        { entidad: "SETTINGS", referencia: "mapaBloqueado", alcance: plazaUp || "" }
      );
      return "OK";
    },

    // ─── CONFIGURACIÓN GLOBAL ─────────────────────────────
    async obtenerConfiguracion(plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      if (plazaUp) await _ensurePlazaBootstrap(plazaUp);
      const fetches = [
        db.collection(COL.CONFIG).doc("empresa").get(),
        db.collection(COL.CONFIG).doc("listas").get()
      ];
      if (plazaUp) fetches.push(_configPlazaRef(plazaUp).get());
      const snaps = await Promise.all(fetches);
      const snapEmpresa = snaps[0];
      const snapListas  = snaps[1];
      const snapPlaza   = snaps[2] || null;

      const globalListas = snapListas.exists
        ? snapListas.data()
        : { estados: [], gasolinas: [], categorias: [] };

      let ubicaciones = globalListas.ubicaciones || [];
      if (snapPlaza && snapPlaza.exists && Array.isArray(snapPlaza.data().ubicaciones)) {
        ubicaciones = snapPlaza.data().ubicaciones;
      } else if (plazaUp && Array.isArray(globalListas.ubicaciones)) {
        const filtradas = globalListas.ubicaciones.filter(u => _matchesPlaza(u, plazaUp));
        ubicaciones = filtradas.length > 0 ? filtradas : globalListas.ubicaciones;
      }

      if (plazaUp) {
        ubicaciones = (Array.isArray(ubicaciones) ? ubicaciones : [])
          .map(item => _normalizePlazaLocationItem(item, plazaUp))
          .filter(Boolean);
        if (ubicaciones.length === 0) ubicaciones = _buildDefaultPlazaLocations(plazaUp);
      }

      return {
        empresa: snapEmpresa.exists ? snapEmpresa.data() : { nombre: "EMPRESA" },
        listas: { ...globalListas, ubicaciones }
      };
    },

    async guardarConfiguracionListas(listasActualizadas, autor = "Admin Global", plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      const { ubicaciones, ...globalRest } = listasActualizadas;

      await db.collection(COL.CONFIG).doc("listas").set(globalRest, { merge: true });

      if (plazaUp && Array.isArray(ubicaciones)) {
        await _ensurePlazaBootstrap(plazaUp);
        await _configPlazaRef(plazaUp).set({
          ubicaciones: ubicaciones
            .map(item => _normalizePlazaLocationItem(item, plazaUp))
            .filter(Boolean)
        }, { merge: true });
      } else if (Array.isArray(ubicaciones)) {
        await db.collection(COL.CONFIG).doc("listas").set({ ubicaciones }, { merge: true });
      }

      await _registrarLog("SISTEMA", "⚙️ Modificó los catálogos del sistema", autor || "Admin Global");
      await _registrarEventoGestion("CONFIG_GLOBAL", "Publicó cambios en catálogos globales", autor || "Admin Global", {
        entidad: "CONFIGURACION", referencia: "listas"
      });
      return "EXITO";
    },

    async garantizarPlazasOperativas(plazas = []) {
      const lista = Array.isArray(plazas) ? plazas.map(_normalizePlazaId).filter(Boolean) : [];
      for (const plaza of lista) { await _ensurePlazaBootstrap(plaza); }
      return "EXITO";
    },

    // ─── SIPP ─────────────────────────────────────────────
    async obtenerDisponiblesSIPP() {
      const snap = await db.collection(COL.SIPP).get();
      return snap.docs.map(d => d.data());
    },

    // ─── EMAIL / AI / PDF ─────────────────────────────────
    async enviarReporteCuadreEmail(base64Image, autor, stats) {
      await _registrarLog("EMAIL", `📧 Reporte de cuadre enviado por ${autor}`, autor);
      return "EXITO";
    },

    async enviarAuditoriaAVentas(auditList, autor, plaza) {
      const plazaUp = _normalizePlazaId(plaza);
      await _setSettings({
        estadoCuadreV3: "REVISION",
        datosAuditoria: JSON.stringify(Array.isArray(auditList) ? auditList : []),
        ultimaModificacion: _now(),
        ultimoEditor: autor || "Sistema"
      }, plazaUp);
      await _registrarLog("AUDITORIA", `📋 Auditoría enviada a Ventas por ${autor} (${auditList.length} unidades)`, autor, plazaUp);
      return { exito: true, plaza: plazaUp };
    },

    async llamarGeminiAI(_instruccionUsuario, _contextoPatio, _ultimoMVA) { return null; },

    async generarPDFActividadDiaria(reservas, regresos, vencidos, autor, fechaFront) {
      await _registrarLog("PDF", `📄 Reporte Actividad Diaria generado por ${autor}`, autor);
      return "EXITO";
    },

    async generarExcelPrediccion(datosFamilias, fechaEscogida, autor) {
      await _registrarLog("EXCEL", `📊 Excel Predicción generado por ${autor}`, autor);
      return "EXITO";
    },

    async obtenerUrlImagenModelo(modelo) {
      if (!modelo) return "";
      const IMAGENES_MODELOS = window.MEX_IMAGENES_MODELOS || {};
      const key = modelo.toString().trim().split(" ")[0].toLowerCase();
      for (const nombre in IMAGENES_MODELOS) { if (nombre.includes(key)) return IMAGENES_MODELOS[nombre]; }
      return "img/no-model.png";
    },

    async analizarPlacaVisionAPI(_base64Image) { return ""; },

    async backfillPlazaEnUnidades(onProgress) {
      return backfillPlazaEnUnidades(onProgress);
    },

    // ─── MIGRACIÓN LEGACY ────────────────────────────────
    async migrarDatosLegacyAPlazas(onProgress) {
      const { _normalizePlazaId } = window._mex;
      const progreso = (col, done, total, errores) => {
        if (typeof onProgress === 'function') onProgress({ col, done, total, errores });
      };
      const BATCH_SIZE = 490;
      let totalOk = 0;
      const erroresGlobal = [];
      const copiarDocs = async (snapDocs, destFn, col) => {
        let done = 0; const total = snapDocs.length;
        progreso(col, 0, total, 0);
        for (let i = 0; i < snapDocs.length; i += BATCH_SIZE) {
          const chunk = snapDocs.slice(i, i + BATCH_SIZE);
          const batch = db.batch();
          for (const docSnap of chunk) {
            try {
              const data = docSnap.data();
              const destRef = destFn(data, docSnap.id);
              if (!destRef) { erroresGlobal.push(`Sin plaza: ${docSnap.id}`); done++; continue; }
              const destSnap = await destRef.get();
              if (destSnap.exists) { done++; totalOk++; continue; }
              batch.set(destRef, data);
              done++; totalOk++;
            } catch (e) { erroresGlobal.push(`${docSnap.id}: ${e.message}`); done++; }
          }
          await batch.commit();
          progreso(col, done, total, erroresGlobal.length);
        }
      };
      const cuadreSnap = await db.collection('cuadre').get();
      await copiarDocs(cuadreSnap.docs.filter(d => !d.ref.path.includes('/unidades/')), (data, id) => {
        const p = _normalizePlazaId(data.plaza || data.plazaAsignada || data.sucursal);
        return p ? db.collection('cuadre').doc(p).collection('unidades').doc(id) : null;
      }, 'cuadre');
      const externosSnap = await db.collection('externos').get();
      await copiarDocs(externosSnap.docs.filter(d => !d.ref.path.includes('/unidades/')), (data, id) => {
        const p = _normalizePlazaId(data.plaza || data.plazaAsignada || data.sucursal);
        return p ? db.collection('externos').doc(p).collection('unidades').doc(id) : null;
      }, 'externos');
      const cadmSnap = await db.collection('cuadre_admins').get();
      await copiarDocs(cadmSnap.docs.filter(d => !d.ref.path.includes('/registros/')), (data, id) => {
        const p = _normalizePlazaId(data.plaza || data.ubicacion);
        return p ? db.collection('cuadre_admins').doc(p).collection('registros').doc(id) : null;
      }, 'cuadre_admins');
      const histSnap = await db.collection('historial_cuadres').get();
      await copiarDocs(histSnap.docs.filter(d => !d.ref.path.includes('/registros/')), (data, id) => {
        const p = _normalizePlazaId(data.plaza || data.ubicacion);
        return p ? db.collection('historial_cuadres').doc(p).collection('registros').doc(id) : null;
      }, 'historial_cuadres');
      return { ok: totalOk, errores: erroresGlobal };
    },

  };
})();
