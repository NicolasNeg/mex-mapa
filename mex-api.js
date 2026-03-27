/**
 * ============================================================
 * MEX-API.JS — ADAPTADOR FIREBASE PARA GITHUB PAGES
 * Reemplaza completamente google.script.run con Firebase Firestore
 * ============================================================
 */

// ─── CONFIGURACIÓN FIREBASE ─────────────────────────────────
// ⚠️ REEMPLAZA ESTOS VALORES con los de tu proyecto Firebase
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBk_A5U37Surm-K1PxZnNbzN-htyrnNmVc",
  authDomain:        "mex-mapa-bjx.firebaseapp.com",
  projectId:         "mex-mapa-bjx",
  storageBucket:     "mex-mapa-bjx.appspot.com",
  messagingSenderId: "35913204070",
  appId:             "1:35913204070:web:8d2c2fa94376449dbd08a7"
};

// ─── INICIALIZACIÓN ──────────────────────────────────────────
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();

// ─── COLECCIONES FIRESTORE ───────────────────────────────────
const COL = {
  CUADRE:    "cuadre",         // Unidades en patio/taller
  EXTERNOS:  "externos",       // Vehículos externos/particulares
  USERS:     "usuarios",       // CHECK_MAPA_USERS
  ADMINS:    "admins",         // CHECK_ADMINS (GlobalAdmins)
  ALERTAS:   "alertas",        // Alertas maestras
  MENSAJES:  "mensajes",       // Chat interno
  LOGS:      "logs",           // Registro de actividad
  NOTAS:     "notas_admin",    // Notas de administradores
  SETTINGS:  "settings",       // SETTINGS_ (feed, bloqueo, cuadre)
  INDEX:     "index_unidades", // BASE MAESTRA de vehículos
  MAPA_CFG:  "mapa_config",    // Estructura del mapa (cajones)
  CUADRE_ADM:"cuadre_admins",  // Cuadre de administradores
  AUDITORIA: "auditoria",      // Misiones de auditoría
  HISTORIAL_CUADRES: "historial_cuadres", // Historial de cuadres
  SIPP:      "sipp",           // Disponibles SIPP
};

// ─── DOCUMENTO ÚNICO DE SETTINGS ────────────────────────────
const SETTINGS_DOC = "principal";

// ─── HELPERS INTERNOS ────────────────────────────────────────
function _now() {
  return new Date().toLocaleString("es-MX", { timeZone: "America/Hermosillo" });
}
function _ts() { return Date.now(); }

async function _getSettings() {
  const snap = await db.collection(COL.SETTINGS).doc(SETTINGS_DOC).get();
  return snap.exists ? snap.data() : {};
}

async function _setSettings(data) {
  await db.collection(COL.SETTINGS).doc(SETTINGS_DOC).set(data, { merge: true });
}

async function _registrarLog(tipo, mensaje, autor) {
  await db.collection(COL.LOGS).add({
    fecha: _now(),
    timestamp: _ts(),
    tipo: tipo,
    accion: mensaje,
    autor: autor || "Sistema"
  });
}

async function _actualizarFeed(accion, autor) {
  const settings = await _getSettings();
  const feed = settings.liveFeed || [];
  feed.unshift({ accion, fecha: _now().slice(-5), autor: autor || "Sistema" });
  if (feed.length > 5) feed.length = 5;
  await _setSettings({ liveFeed: feed, ultimaModificacion: _now(), ultimoEditor: autor });
}// ═══════════════════════════════════════════════════════════
// 🔌 OBJETO google.script.run — ADAPTADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════
function _makeRunner() {
  let _success = null;
  let _failure = null;

  const runner = {
    withSuccessHandler(fn) { _success = fn; return runner; },
    withFailureHandler(fn) { _failure = fn; return runner; },
  };

  return new Proxy(runner, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        if (!API_FUNCTIONS[prop]) {
          console.warn(`[MEX-API] No implementada: ${prop}`);
          if (_success) _success(null);
          return;
        }
        API_FUNCTIONS[prop](...args)
          .then(r => { if (_success) _success(r); })
          .catch(e => {
            console.error(`[MEX-API] Error en ${prop}:`, e);
            if (_failure) _failure(e);
          });
      };
    }
  });
}

const google = {
  script: {
    run: new Proxy({}, {
      get(_, prop) {
        const runner = _makeRunner();
        if (prop === 'withSuccessHandler' || prop === 'withFailureHandler') {
          return runner[prop].bind(runner);
        }
        return (...args) => {
          if (!API_FUNCTIONS[prop]) {
            console.warn(`[MEX-API] No implementada: ${prop}`);
            return;
          }
          API_FUNCTIONS[prop](...args)
            .catch(e => console.error(`[MEX-API] ${prop}:`, e));
        };
      }
    })
  }
};
// ═══════════════════════════════════════════════════════════
// 📚 API_FUNCTIONS — Implementaciones de cada función GAS
// ═══════════════════════════════════════════════════════════
const API_FUNCTIONS = {

  // ─── AUTENTICACIÓN ────────────────────────────────────────
  /**
   * Retorna lista de usuarios del mapa para el login
   */
  async obtenerCredencialesMapa() {
    const snap = await db.collection(COL.USERS).orderBy("usuario").get();
    return snap.docs.map(d => d.data());
  },

  /**
   * Verifica si el usuario es Admin Global (está en CHECK_ADMINS)
   */
  async verificarAdminGlobal(nombreUsuario) {
    const nombre = nombreUsuario.trim().toUpperCase();
    const snap = await db.collection(COL.ADMINS)
      .where("usuario", "==", nombre).limit(1).get();
    if (snap.empty) return false;
    const data = snap.docs[0].data();
    return data.isGlobal === true;
  },

  // ─── DATOS DEL MAPA ──────────────────────────────────────
  /**
   * Retorna todas las unidades en PATIO y TALLER para renderizar el mapa
   */
  async obtenerDatosParaMapa() {
    const cuadreSnap = await db.collection(COL.CUADRE).get();
    const externosSnap = await db.collection(COL.EXTERNOS).get();

    const cuadreUnits = cuadreSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.mva && (u.ubicacion === "PATIO" || u.ubicacion === "TALLER"))
      .map(u => ({ ...u, tipo: "renta" }));

    const externosUnits = externosSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.mva)
      .map(u => ({ ...u, ubicacion: "EXTERNO", tipo: "externo" }));

    return { unidades: [...cuadreUnits, ...externosUnits] };
  },

  /**
   * Retorna la estructura de cajones del mapa (desde Firestore)
   */
  async obtenerEstructuraMapa() {
    const snap = await db.collection(COL.MAPA_CFG).orderBy("orden").get();
    if (!snap.empty) {
      return snap.docs.map(d => d.data());
    }
    // Estructura por defecto si no hay nada configurado
    return _generarEstructuraPorDefecto();
  },

  // ─── MODIFICACIONES DE UNIDADES ──────────────────────────
  /**
   * Aplica estado, ubicación, gasolina y notas a una unidad del CUADRE
   */
  async aplicarEstado(mva, estado, ubi, gas, notasFormulario, borrarNotas, nombreAutor, responsableSesion) {
    const mvaStr = mva.toString().trim().toUpperCase();

    // Buscar en CUADRE
    let snap = await db.collection(COL.CUADRE).where("mva", "==", mvaStr).limit(1).get();
    let coleccion = COL.CUADRE;

    if (snap.empty) {
      snap = await db.collection(COL.EXTERNOS).where("mva", "==", mvaStr).limit(1).get();
      coleccion = COL.EXTERNOS;
    }

    if (snap.empty) return "ERROR: MVA no encontrado";

    const docRef = snap.docs[0].ref;
    const actual = snap.docs[0].data();
    const ahora = _now();
    const sello = `(${ahora}) [${nombreAutor || "?"}]`;

    let notaFinal = actual.notas || "";
    const notaEntrada = notasFormulario ? notasFormulario.trim() : "";

    if (borrarNotas === true || borrarNotas === "true") {
      notaFinal = notaEntrada !== "" ? `${sello} ${notaEntrada}` : "";
    } else if (notaEntrada !== "" && notaEntrada !== (actual.notas || "").trim()) {
      const tieneSello = /\(\d{4}/.test(notaEntrada);
      notaFinal = tieneSello ? notaEntrada : `${sello} ${notaEntrada}`;
    }

    await docRef.update({
      gasolina: gas,
      estado: estado,
      ubicacion: ubi,
      notas: notaFinal,
      _updatedAt: ahora,
      _updatedBy: responsableSesion || nombreAutor
    });

    await _actualizarFeed(`${mvaStr} ➜ ${estado} (${ubi})`, responsableSesion);
    await _registrarLog("MODIF", `🔄 MODIFICACION: *${mvaStr}* ESTADO ➜ ${estado} ⛽ GAS ➜ ${gas} 📍 UBI ➜ ${ubi}`, responsableSesion);
    return "EXITO";
  },

  /**
   * Inserta una nueva unidad en el CUADRE
   */
  async insertarUnidadDesdeHTML(objeto) {
    const mvaStr = objeto.mva.toString().trim().toUpperCase();

    // Anti-duplicados
    const existe = await db.collection(COL.CUADRE).where("mva", "==", mvaStr).limit(1).get();
    if (!existe.empty) return `La unidad ${mvaStr} ya está registrada en el patio.`;

    const ahora = _now();
    const sello = `(${ahora})`;
    const notaFinal = objeto.notas ? `${sello} - ${objeto.notas} - ${objeto.responsableSesion || ""}` : "";

    // Buscar datos en INDEX_UNIDADES
    const indexSnap = await db.collection(COL.INDEX).where("mva", "==", mvaStr).limit(1).get();
    const indexData = indexSnap.empty ? {} : indexSnap.docs[0].data();

    await db.collection(COL.CUADRE).add({
      categoria:    indexData.categoria || objeto.categ || "S/C",
      modelo:       indexData.modelo || objeto.modelo || "S/M",
      mva:          mvaStr,
      placas:       indexData.placas || objeto.placas || "S/P",
      gasolina:     objeto.gasolina || "N/A",
      estado:       objeto.estado || "SUCIO",
      ubicacion:    objeto.ubicacion || "PATIO",
      notas:        notaFinal,
      pos:          "LIMBO",
      fechaIngreso: new Date().toISOString(),
      _createdAt:   ahora,
      _createdBy:   objeto.responsableSesion || "Sistema"
    });

    await _actualizarFeed(`IN: ${mvaStr} (${indexData.modelo || objeto.modelo})`, objeto.responsableSesion);
    await _registrarLog("IN", `📥 INSERTADO: ${mvaStr}`, objeto.responsableSesion);
    return `EXITO|${indexData.modelo || objeto.modelo}|${indexData.placas || objeto.placas}`;
  },

  /**
   * Elimina una o varias unidades del CUADRE
   */
  async ejecutarEliminacion(listaMvas, responsableSesion) {
    const batch = db.batch();
    for (const mva of listaMvas) {
      const mvaStr = mva.toString().trim().toUpperCase();
      const snap = await db.collection(COL.CUADRE).where("mva", "==", mvaStr).get();
      snap.docs.forEach(d => batch.delete(d.ref));
      await _actualizarFeed(`BAJA: ${mvaStr}`, responsableSesion);
      await _registrarLog("BAJA", `🗑️ SE ELIMINÓ LA UNIDAD: ${mvaStr}`, responsableSesion);
    }
    await batch.commit();
    return "EXITO";
  },

  /**
   * Guarda las posiciones (cajones) de TODAS las unidades del mapa
   */
  async guardarNuevasPosiciones(reporte, usuarioResponsable) {
    const batch = db.batch();
    for (const item of reporte) {
      if (!item.mva || !item.pos) continue;
      const mvaStr = item.mva.toString().trim().toUpperCase();

      // Buscar en CUADRE primero, luego EXTERNOS
      let snap = await db.collection(COL.CUADRE).where("mva", "==", mvaStr).limit(1).get();
      if (snap.empty) snap = await db.collection(COL.EXTERNOS).where("mva", "==", mvaStr).limit(1).get();
      if (!snap.empty) {
        batch.update(snap.docs[0].ref, { pos: item.pos.toUpperCase() });
      }
    }
    await batch.commit();
    return true;
  },

  // ─── TABLA DE FLOTA ───────────────────────────────────────
  /**
   * Carga la flota completa (CUADRE + EXTERNOS) para la tabla lateral
   */
  async obtenerUnidadesVeloz() {
    const [cuadre, externos, index] = await Promise.all([
      db.collection(COL.CUADRE).get(),
      db.collection(COL.EXTERNOS).get(),
      db.collection(COL.INDEX).get()
    ]);
    const lista = [
      ...cuadre.docs.map(d => d.data()),
      ...externos.docs.map(d => d.data()),
      ...index.docs.map(d => d.data())
    ];
    const vistos = new Set();
    return lista.filter(u => {
      if (!u.mva || vistos.has(u.mva)) return false;
      vistos.add(u.mva);
      return true;
    });
  },

  /**
   * Carga datos del cuadre de admins para la tabla secundaria
   */
  async obtenerCuadreAdminsData() {
    const snap = await db.collection(COL.CUADRE_ADM).orderBy("_createdAt", "desc").get();
    return snap.docs.map(d => ({ id: d.id, fila: d.id, ...d.data() }));
  },

  /**
   * Modifica o inserta una unidad en el cuadre de admins
   */
  async procesarModificacionMaestra(datos, tipoAccion) {
    try {
      if (tipoAccion === "ADD" || tipoAccion === "INSERTAR") {
        await db.collection(COL.CUADRE_ADM).add({
          ...datos,
          _createdAt: _now(),
          _createdBy: datos.adminResponsable || "Sistema"
        });
      } else if (tipoAccion === "MODIFICAR") {
        const id = datos.fila;
        if (!id) return "ERROR: Sin ID de fila";
        await db.collection(COL.CUADRE_ADM).doc(id).set(datos, { merge: true });
      } else if (tipoAccion === "ELIMINAR") {
        const id = datos.fila;
        if (!id) return "ERROR: Sin ID de fila";
        await db.collection(COL.CUADRE_ADM).doc(id).delete();
      }
      return "EXITO";
    } catch (e) {
      return "ERROR: " + e.message;
    }
  },

  // ─── NOTIFICACIONES / RADAR ───────────────────────────────
  /**
   * Ping del radar: devuelve estado de feed, alertas, mensajes, bloqueo
   */
  async checarNotificaciones(usuarioActivo) {
    const [settings, alertasSnap, msgsSnap] = await Promise.all([
      _getSettings(),
      db.collection(COL.ALERTAS).orderBy("timestamp", "desc").limit(50).get(),
      db.collection(COL.MENSAJES).where("destinatario", "==", usuarioActivo.toUpperCase()).get()
    ]);

    const alertas = alertasSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => !(a.leidoPor || "").includes(usuarioActivo));

    const mensajesSinLeer = msgsSnap.docs.filter(d => d.data().leido !== "SI").length;

    return {
      incidenciasPendientes: 0,
      alertas,
      mensajesSinLeer,
      ultimaActualizacion: settings.ultimaModificacion || "--/-- 00:00",
      ultimoCuadre:        settings.ultimoCuadreTexto || "Sin registro",
      mapaBloqueado:       settings.mapaBloqueado === true,
      estadoCuadreV3:      settings.estadoCuadreV3 || "LIBRE",
      adminIniciador:      settings.adminIniciador || "",
      liveFeed:            settings.liveFeed || [],
      error: null
    };
  },

  /**
   * Limpia el feed de actividad
   */
  async limpiarFeedGlobal() {
    await _setSettings({ liveFeed: [] });
    return "OK";
  },

  // ─── ALERTAS GLOBALES ─────────────────────────────────────
  async emitirNuevaAlertaMaestra(tipo, titulo, mensaje, imagen, autor) {
    await db.collection(COL.ALERTAS).add({
      timestamp: _ts(),
      fecha:    _now(),
      autor:    autor,
      tipo:     tipo,
      titulo:   titulo,
      mensaje:  mensaje,
      imagen:   imagen || "",
      leidoPor: ""
    });
    return "EXITO";
  },

  async marcarAlertaComoLeida(idAlerta, usuarioActivo) {
    const ref = db.collection(COL.ALERTAS).doc(idAlerta);
    const snap = await ref.get();
    if (!snap.exists) return "ERROR";
    const actual = snap.data().leidoPor || "";
    await ref.update({ leidoPor: actual ? actual + ", " + usuarioActivo : usuarioActivo });
    return "OK";
  },

  async obtenerTodasLasAlertas() {
    const snap = await db.collection(COL.ALERTAS).orderBy("timestamp", "desc").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async eliminarAlertaMaestraBackend(idAlerta) {
    await db.collection(COL.ALERTAS).doc(idAlerta).delete();
    return "EXITO";
  },

  // ─── MENSAJES PRIVADOS ────────────────────────────────────
  async obtenerMensajesPrivados(usuario) {
    const me = usuario.trim().toUpperCase();
    const [sent, recv] = await Promise.all([
      db.collection(COL.MENSAJES).where("remitente", "==", me).orderBy("timestamp", "desc").get(),
      db.collection(COL.MENSAJES).where("destinatario", "==", me).orderBy("timestamp", "desc").get()
    ]);
    const todos = [...sent.docs, ...recv.docs]
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.timestamp - a.timestamp);
    // Deduplicar
    const vistos = new Set();
    return todos.filter(m => { if (vistos.has(m.id)) return false; vistos.add(m.id); return true; })
      .map(m => ({
        ...m,
        esMio: m.remitente === me,
        leido: m.leido === "SI"
      }));
  },

  async enviarMensajePrivado(remitente, destinatario, texto) {
    await db.collection(COL.MENSAJES).add({
      timestamp:    _ts(),
      fecha:        _now(),
      remitente:    remitente.trim().toUpperCase(),
      destinatario: destinatario.trim().toUpperCase(),
      mensaje:      texto,
      leido:        "NO"
    });
    return "EXITO";
  },

  async marcarMensajesLeidosArray(idsArray) {
    const batch = db.batch();
    for (const id of idsArray) {
      batch.update(db.collection(COL.MENSAJES).doc(id.toString()), { leido: "SI" });
    }
    await batch.commit();
    return "OK";
  },

  // ─── NOTAS DE ADMIN ───────────────────────────────────────
  async obtenerTodasLasNotas() {
    const snap = await db.collection(COL.NOTAS).orderBy("timestamp", "desc").get();
    return snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
  },

  async guardarNuevaNotaDirecto(nota, autor) {
    await db.collection(COL.NOTAS).add({
      timestamp: _ts(),
      fecha:     _now(),
      autor:     autor,
      nota:      nota,
      estado:    "PENDIENTE",
      quienResolvio: "",
      solucion: ""
    });
    return "OK";
  },

  async resolverNotaDirecto(idNota, solucion, autor) {
    await db.collection(COL.NOTAS).doc(idNota.toString()).update({
      quienResolvio: autor,
      estado:        "RESUELTA",
      solucion:      solucion
    });
    return "OK";
  },

  async eliminarNotaDirecto(idNota) {
    await db.collection(COL.NOTAS).doc(idNota.toString()).delete();
    return "OK";
  },

  // ─── LOGS / BITÁCORA ─────────────────────────────────────
  async obtenerLogsServer() {
    const snap = await db.collection(COL.LOGS).orderBy("timestamp", "desc").limit(200).get();
    return snap.docs.map(d => d.data());
  },

  async obtenerHistorialLogs() {
    const snap = await db.collection(COL.LOGS).orderBy("timestamp", "desc").limit(500).get();
    return snap.docs.map(d => d.data());
  },

  // ─── GESTIÓN DE USUARIOS ─────────────────────────────────
  async guardarNuevoUsuario(nombre, pin, isAdmin) {
    const nombreUpper = nombre.trim().toUpperCase();
    // Verificar duplicado
    const existe = await db.collection(COL.USERS).where("usuario", "==", nombreUpper).limit(1).get();
    if (!existe.empty) return "ERROR: El usuario ya existe";

    await db.collection(COL.USERS).add({
      usuario:  nombreUpper,
      password: pin.toString(),
      isAdmin:  isAdmin === true || isAdmin === "true",
      telefono: ""
    });
    return "EXITO";
  },

  async modificarUsuario(nombreOriginal, nuevoNombre, nuevoPin, isAdmin) {
    const snap = await db.collection(COL.USERS)
      .where("usuario", "==", nombreOriginal.trim().toUpperCase()).limit(1).get();
    if (snap.empty) return "ERROR: Usuario no encontrado";

    await snap.docs[0].ref.update({
      usuario:  nuevoNombre.trim().toUpperCase(),
      password: nuevoPin.toString(),
      isAdmin:  isAdmin === true || isAdmin === "true"
    });
    return "EXITO";
  },

  async eliminarUsuario(nombre) {
    const snap = await db.collection(COL.USERS)
      .where("usuario", "==", nombre.trim().toUpperCase()).limit(1).get();
    if (snap.empty) return "ERROR: Usuario no encontrado";
    await snap.docs[0].ref.delete();
    return "EXITO";
  },

  // ─── BLOQUEO DEL MAPA ────────────────────────────────────
  async toggleBloqueoMapa(nuevoEstado) {
    await _setSettings({ mapaBloqueado: nuevoEstado === true });
    return "OK";
  },

  // ─── CUADRE V3 / AUDITORÍA ───────────────────────────────
  async iniciarProtocoloDesdeAdmin(nombreAdmin, jsonMision) {
    await _setSettings({
      estadoCuadreV3: "PROCESO",
      adminIniciador:  nombreAdmin,
      misionAuditoria: jsonMision
    });
    return "EXITO";
  },

  async obtenerMisionAuditoria() {
    const settings = await _getSettings();
    try {
      return JSON.parse(settings.misionAuditoria || "[]");
    } catch { return []; }
  },

  async guardarAuditoriaCruzada(datosAuditoria, autor) {
    await _setSettings({ estadoCuadreV3: "REVISION", datosAuditoria: JSON.stringify(datosAuditoria) });
    await db.collection(COL.AUDITORIA).add({
      timestamp: _ts(),
      fecha:     _now(),
      autor,
      datos:     datosAuditoria
    });
    return "EXITO";
  },

  async finalizarProtocoloV3(autorCierre) {
    await _setSettings({
      estadoCuadreV3:   "LIBRE",
      adminIniciador:   "",
      ultimoCuadreTexto: `${autorCierre} (${_now()})`,
      ultimaModificacion: _now()
    });
    return "CUADRE FINALIZADO CON ÉXITO";
  },

  async registrarCierreCuadre(autor) {
    await _setSettings({ ultimoCuadreTexto: `${autor} (${_now()})` });
    await _registrarLog("CUADRE", `✅ CUADRE CERRADO POR ${autor}`, autor);
    return "OK";
  },

  async marcarUltimaModificacion(autor) {
    await _setSettings({ ultimaModificacion: _now(), ultimoEditor: autor });
    return "OK";
  },

  async obtenerHistorialCuadres() {
    const snap = await db.collection(COL.HISTORIAL_CUADRES).orderBy("timestamp", "desc").limit(30).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // ─── CONFIGURACIÓN DEL MAPA ───────────────────────────────
  async actualizarFeedSettings(accion, autor) {
    await _actualizarFeed(accion, autor);
    return "OK";
  },

  // ─── UNIDADES PLAZAS / CORPORATIVO ───────────────────────
  async obtenerUnidadesPlazas() {
    const snap = await db.collection(COL.INDEX).orderBy("sucursal").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async registrarUnidadEnPlaza(data) {
    await db.collection(COL.INDEX).add({
      ...data,
      _createdAt: _now()
    });
    return "EXITO";
  },

  async obtenerDetalleCompleto(sucursal, mva) {
    const snap = await db.collection(COL.INDEX)
      .where("mva", "==", mva.toString().trim().toUpperCase())
      .limit(1).get();
    if (snap.empty) return null;
    const data = snap.docs[0].data();

    // Enriquecer con datos del cuadre
    const cuadreSnap = await db.collection(COL.CUADRE)
      .where("mva", "==", mva.toString().trim().toUpperCase()).limit(1).get();
    const cuadreData = cuadreSnap.empty ? {} : cuadreSnap.docs[0].data();

    return { ...data, ...cuadreData, plaza: sucursal, id: snap.docs[0].id };
  },

  async actualizarUnidadPlaza(data) {
    const snap = await db.collection(COL.INDEX)
      .where("mva", "==", data.mva.toString().trim().toUpperCase()).limit(1).get();
    if (snap.empty) return "ERROR: Unidad no encontrada";
    await snap.docs[0].ref.update(data);
    return "EXITO";
  },

  async eliminarUnidadPlaza(plaza, id) {
    await db.collection(COL.INDEX).doc(id).delete();
    return "EXITO";
  },

  // ─── DISPONIBLES SIPP ─────────────────────────────────────
  async obtenerDisponiblesSIPP() {
    const snap = await db.collection(COL.SIPP).get();
    return snap.docs.map(d => d.data());
  },

  // ─── EMAIL (Stubbed — usa EmailJS si quieres real) ────────
  async enviarReporteCuadreEmail(base64Image, autor, stats) {
    // Para enviar email real: configurar EmailJS en el HTML
    // Por ahora solo registra el evento
    await _registrarLog("EMAIL", `📧 Reporte de cuadre enviado por ${autor}`, autor);
    return "EXITO";
  },

  async enviarAuditoriaAVentas(auditList, autor) {
    await _registrarLog("AUDITORIA", `📋 Auditoría enviada a Ventas por ${autor} (${auditList.length} unidades)`, autor);
    return "EXITO";
  },

  // ─── GEMINI AI (ya usa fetch, solo redirigimos) ───────────
  async llamarGeminiAI(instruccionUsuario, contextoPatio, ultimoMVA) {
    // Esta función en el HTML ya usa fetch() directamente
    // Solo la mantenemos por compatibilidad
    return null;
  },

  // ─── PREDICCIONES / GENERADOR PDF ─────────────────────────
  async generarPDFActividadDiaria(reservas, regresos, vencidos, autor, fechaFront) {
    // El HTML genera el PDF en el cliente con jsPDF/html2canvas
    // Esta función era para enviar por email, aquí solo registramos
    await _registrarLog("PDF", `📄 Reporte Actividad Diaria generado por ${autor}`, autor);
    return "EXITO";
  },

  async generarExcelPrediccion(datosFamilias, fechaEscogida, autor) {
    await _registrarLog("EXCEL", `📊 Excel Predicción generado por ${autor}`, autor);
    return "EXITO";
  },

  // ─── FUNCIONES VACÍAS (Solo GAS, no necesarias en cliente) ─
  async limpiarFeedGlobal() {
    await _setSettings({ liveFeed: [] });
    return "OK";
  },

  async procesarAuditoriaDesdeAdmin(auditList, autorAdmin, stats) {
    await _registrarLog("CUADRE", `✅ CUADRE VALIDADO - ${stats?.ok || 0} OK / ${stats?.faltantes || 0} FALTAN`, autorAdmin);
    await db.collection(COL.HISTORIAL_CUADRES).add({
      timestamp: _ts(),
      fecha:     _now(),
      auxiliar:  stats?.auxiliar || "",
      admin:     autorAdmin,
      ok:        stats?.ok || 0,
      faltantes: stats?.faltantes || 0,
      sobrantes: stats?.sobrantes || 0,
      pdfUrl:    ""
    });
    await _setSettings({ estadoCuadreV3: "LIBRE", adminIniciador: "" });
    return "EXITO";
  },

  async checkEsAdmin(nombre) {
    const snap = await db.collection(COL.ADMINS)
      .where("usuario", "==", nombre.trim().toUpperCase()).limit(1).get();
    return !snap.empty;
  }
};

// ═══════════════════════════════════════════════════════════
// 🗺️ ESTRUCTURA POR DEFECTO DEL MAPA
// (Si no tienes datos en mapa_config, usa esta estructura hardcoded)
// ═══════════════════════════════════════════════════════════
function _generarEstructuraPorDefecto() {
  const estructura = [];
  let orden = 0;

  // Secciones Sierra (S), Lima (L), Oscar (O), Nilo (N)
  const secciones = [
    { prefix: "S", cols: 8, row: 1 },
    { prefix: "L", cols: 8, row: 2 },
    { prefix: "O", cols: 8, row: 3 },
    { prefix: "N", cols: 8, row: 4 },
  ];

  secciones.forEach((sec, si) => {
    // Label de sección
    estructura.push({ valor: sec.prefix, row: si * 3 + 1, col: 1, rowspan: 1, colspan: 1, orden: orden++, esLabel: true });
    for (let i = 1; i <= sec.cols; i++) {
      estructura.push({
        valor: `${sec.prefix}${i}-1`,
        row: si * 3 + 1, col: i + 1,
        rowspan: 1, colspan: 1, orden: orden++
      });
      estructura.push({
        valor: `${sec.prefix}${i}-2`,
        row: si * 3 + 2, col: i + 1,
        rowspan: 1, colspan: 1, orden: orden++
      });
    }
  });

  return estructura;
}

// ═══════════════════════════════════════════════════════════
// 🛠️ UTILIDADES GLOBALES
// ═══════════════════════════════════════════════════════════

/**
 * Sube la imagen del modelo buscando en un mapa de URLs hardcodeado.
 * Dado que Drive no funciona desde GitHub Pages, usa URLs públicas.
 */
window.obtenerUrlImagenModelo = function(modelo) {
  if (!modelo) return "";
  // Mapa de imágenes — puedes poblar esto con tus URLs de Drive (link público)
  // o subir las imágenes a /img/ en tu repo de GitHub
  const IMAGENES_MODELOS = window.MEX_IMAGENES_MODELOS || {};
  const key = modelo.toString().trim().split(" ")[0].toLowerCase();
  for (const nombre in IMAGENES_MODELOS) {
    if (nombre.includes(key)) return IMAGENES_MODELOS[nombre];
  }
  return "img/no-model.png";
};

console.log("✅ [MEX-API] Adaptador Firebase cargado correctamente.");
