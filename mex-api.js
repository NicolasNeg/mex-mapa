// ─── CONFIGURACIÓN FIREBASE ─────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBk_A5U37Surm-K1PxZnNbzN-htyrnNmVc",
  authDomain:        "mex-mapa-bjx.firebaseapp.com",
  projectId:         "mex-mapa-bjx",
  storageBucket:     "mex-mapa-bjx.appspot.com",
  messagingSenderId: "35913204070",
  appId:             "1:35913204070:web:8d2c2fa94376449dbd08a7"
};


firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();

const COL = {
  CUADRE:    "cuadre",
  EXTERNOS:  "externos",
  USERS:     "usuarios",
  ADMINS:    "admins",
  ALERTAS:   "alertas",
  MENSAJES:  "mensajes",
  LOGS:      "logs",
  NOTAS:     "notas_admin",
  SETTINGS:  "settings",
  INDEX:     "index_unidades",
  MAPA_CFG:  "mapa_config",
  CUADRE_ADM:"cuadre_admins",
  AUDITORIA: "auditoria",
  HISTORIAL_CUADRES: "historial_cuadres",
  SIPP:      "sipp",
  CONFIG: "configuracion",
};

const SETTINGS_DOC = "principal";

function _now() {
  return new Date().toLocaleString("es-MX", { timeZone: "America/Mazatlan" });
}
function _ts() { return Date.now(); }
function _fecha(data) {
  try {
    const f = data.timestamp ? new Date(data.timestamp) : new Date(data.fecha);
    if (!isNaN(f)) return f.toLocaleString("es-MX", { timeZone: "America/Mazatlan" });
  } catch(e) {}
  return data.fecha || "";
}

async function _getSettings() {
  const snap = await db.collection(COL.SETTINGS).doc(SETTINGS_DOC).get();
  return snap.exists ? snap.data() : {};
}
async function _setSettings(data) {
  await db.collection(COL.SETTINGS).doc(SETTINGS_DOC).set(data, { merge: true });
}
async function _registrarLog(tipo, mensaje, autor) {
  const ts = _ts();
  const id = `log_${ts}_${Math.floor(Math.random() * 1000)}`;
  await db.collection(COL.LOGS).doc(id).set({
    fecha: _now(), timestamp: ts, tipo, accion: mensaje, autor: autor || "Sistema"
  });
}
async function _actualizarFeed(accion, autor) {
  const settings = await _getSettings();
  let feed = settings.liveFeed || [];
  if (typeof feed === "string") { try { feed = JSON.parse(feed); } catch(e) { feed = []; } }
  if (!Array.isArray(feed)) feed = [];
  feed.unshift({ accion: accion, fecha: _now().slice(-5), autor: autor || "Sistema" });
  if (feed.length > 5) feed.length = 5;
  await _setSettings({ liveFeed: JSON.stringify(feed), ultimaModificacion: _now(), ultimoEditor: autor });
}

const API_FUNCTIONS = {

  // ─── AUTENTICACIÓN ────────────────────────────────────────
  async obtenerCredencialesMapa() {
    const [usersSnap, adminsSnap] = await Promise.all([
      db.collection(COL.USERS).orderBy("usuario").get(),
      db.collection(COL.ADMINS).get()
    ]);
    const globalesSet = new Set(adminsSnap.docs
      .filter(d => d.data().isGlobal === true)
      .map(d => d.data().usuario));
    return usersSnap.docs.map(d => {
      const data = d.data();
      return { ...data, isGlobal: globalesSet.has(data.usuario) };
    });
  },

  async verificarAdminGlobal(nombreUsuario) {
    const nombre = nombreUsuario.trim().toUpperCase();
    const snap = await db.collection(COL.ADMINS).where("usuario", "==", nombre).limit(1).get();
    if (snap.empty) return false;
    return snap.docs[0].data().isGlobal === true;
  },

  // ─── MAPA ────────────────────────────────────────────────
  async obtenerDatosParaMapa() {
    const [cuadreSnap, externosSnap] = await Promise.all([
      db.collection(COL.CUADRE).get(),
      db.collection(COL.EXTERNOS).get()
    ]);
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

  async obtenerEstructuraMapa() {
    const snap = await db.collection(COL.MAPA_CFG).orderBy("orden").get();
    if (!snap.empty) return snap.docs.map(d => d.data());
    return _generarEstructuraPorDefecto();
  },

  async guardarEstructuraMapa(elementos) {
    // 1. Borrar todos los documentos actuales
    const snap = await db.collection(COL.MAPA_CFG).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    // 2. Insertar nueva estructura en lotes de 490
    for (let i = 0; i < elementos.length; i += 490) {
      const chunk = elementos.slice(i, i + 490);
      const batch = db.batch();
      chunk.forEach((el, j) => {
        const ref = db.collection(COL.MAPA_CFG).doc(`cel_${el.orden ?? (i + j)}`);
        batch.set(ref, el);
      });
      await batch.commit();
    }
    await _registrarLog("SISTEMA", "🗺️ Estructura del mapa actualizada", "Sistema");
    return "OK";
  },

  // ─── MODIFICACIONES ──────────────────────────────────────
  async aplicarEstado(mva, estado, ubi, gas, notasFormulario, borrarNotas, nombreAutor, responsableSesion) {
    const mvaStr = mva.toString().trim().toUpperCase();
    let snap = await db.collection(COL.CUADRE).where("mva", "==", mvaStr).limit(1).get();
    if (snap.empty) snap = await db.collection(COL.EXTERNOS).where("mva", "==", mvaStr).limit(1).get();
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

    await docRef.update({ gasolina: gas, estado, ubicacion: ubi, notas: notaFinal, _updatedAt: ahora, _updatedBy: responsableSesion || nombreAutor });
    await _actualizarFeed(`${mvaStr} ➜ ${estado} (${ubi})`, responsableSesion);
    await _registrarLog("MODIF", `🔄 MODIFICACION: *${mvaStr}* ESTADO ➜ ${estado} ⛽ GAS ➜ ${gas} 📍 UBI ➜ ${ubi}`, responsableSesion);
    return "EXITO";
  },

  async insertarUnidadDesdeHTML(objeto) {
    const mvaStr = objeto.mva.toString().trim().toUpperCase();
    const existe = await db.collection(COL.CUADRE).where("mva", "==", mvaStr).limit(1).get();
    if (!existe.empty) return `La unidad ${mvaStr} ya está registrada en el patio.`;

    const ahora = _now();
    const notaFinal = objeto.notas ? `(${ahora}) - ${objeto.notas} - ${objeto.responsableSesion || ""}` : "";
    const indexSnap = await db.collection(COL.INDEX).where("mva", "==", mvaStr).limit(1).get();
    const indexData = indexSnap.empty ? {} : indexSnap.docs[0].data();

    // Usar MVA como docId para evitar IDs random
    await db.collection(COL.CUADRE).doc(mvaStr).set({
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

  async ejecutarEliminacion(listaMvas, responsableSesion) {
    for (const mva of listaMvas) {
      const mvaStr = mva.toString().trim().toUpperCase();
      const snap = await db.collection(COL.CUADRE).where("mva", "==", mvaStr).get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      await _actualizarFeed(`BAJA: ${mvaStr}`, responsableSesion);
      await _registrarLog("BAJA", `🗑️ SE ELIMINÓ LA UNIDAD: ${mvaStr}`, responsableSesion);
    }
    return "EXITO";
  },

  async guardarNuevasPosiciones(reporte, usuarioResponsable) {
    const batch = db.batch();
    const histBatch = [];
    for (const item of reporte) {
      if (!item.mva || !item.pos) continue;
      const mvaStr = item.mva.toString().trim().toUpperCase();
      const posNueva = item.pos.toString().toUpperCase();
      let snap = await db.collection(COL.CUADRE).where("mva", "==", mvaStr).limit(1).get();
      let hoja = "CUADRE";
      if (snap.empty) { snap = await db.collection(COL.EXTERNOS).where("mva", "==", mvaStr).limit(1).get(); hoja = "EXTERNOS"; }
      if (!snap.empty) {
        const posAnterior = snap.docs[0].data().pos || "LIMBO";
        if (posAnterior !== posNueva) {
          batch.set(snap.docs[0].ref, { pos: posNueva }, { merge: true });
          histBatch.push({ mva: mvaStr, hoja, posAnterior, posNueva });
        }
      }
    }
    await batch.commit();
    for (let i = 0; i < histBatch.length; i++) {
      const h = histBatch[i];
      const ts = _ts();
      const id = `move_${i}_${ts}`;
      await db.collection("historial_patio").doc(id).set({
        timestamp: ts, fecha: _now(), tipo: "MOVE",
        mva: h.mva, hoja: h.hoja, posAnterior: h.posAnterior, posNueva: h.posNueva,
        autor: usuarioResponsable || "Sistema"
      });
    }
    return true;
  },

  // ─── TABLA DE FLOTA ───────────────────────────────────────
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
      vistos.add(u.mva); return true;
    });
  },

  async obtenerDatosFlotaConsola() {
    const ORDEN = { "LISTO":1,"SUCIO":2,"MANTENIMIENTO":3,"RESGUARDO":4,"TRASLADO":5,"NO ARRENDABLE":6,"RETENIDA":92,"VENTA":93 };
    const [cuadre, externos] = await Promise.all([db.collection(COL.CUADRE).get(), db.collection(COL.EXTERNOS).get()]);
    const lista = [
      ...cuadre.docs.map(d => ({ id: d.id, fila: d.id, ...d.data() })),
      ...externos.docs.map(d => ({ id: d.id, fila: d.id, ...d.data(), ubicacion: "EXTERNO" }))
    ];
    lista.forEach(u => { u.orden = ORDEN[(u.estado || "").toUpperCase()] || 99; });
    lista.sort((a, b) => (a.orden - b.orden) || (a.mva || "").localeCompare(b.mva || ""));
    return lista;
  },

  async obtenerCuadreAdminsData() {
    const snap = await db.collection(COL.CUADRE_ADM).orderBy("_createdAt", "desc").get();
    return snap.docs.map(d => ({ id: d.id, fila: d.id, ...d.data() }));
  },

  async procesarModificacionMaestra(datos, tipoAccion) {
    try {
      if (tipoAccion === "ADD" || tipoAccion === "INSERTAR") {
        await db.collection(COL.CUADRE_ADM).add({ ...datos, _createdAt: _now(), _createdBy: datos.adminResponsable || "Sistema" });
      } else if (tipoAccion === "MODIFICAR") {
        if (!datos.fila) return "ERROR: Sin ID de fila";
        await db.collection(COL.CUADRE_ADM).doc(datos.fila).set(datos, { merge: true });
      } else if (tipoAccion === "ELIMINAR") {
        if (!datos.fila) return "ERROR: Sin ID de fila";
        await db.collection(COL.CUADRE_ADM).doc(datos.fila).delete();
      }
      return "EXITO";
    } catch(e) { return "ERROR: " + e.message; }
  },

  async obtenerConteoGeneral() {
    const snap = await db.collection(COL.CUADRE).get();
    const conteo = { LISTO: 0, SUCIO: 0, MANTENIMIENTO: 0, total: 0 };
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

  // ─── RADAR ───────────────────────────────────────────────
  async checarNotificaciones(usuarioActivo) {
    const [settings, alertasSnap, msgsSnap] = await Promise.all([
      _getSettings(),
      db.collection(COL.ALERTAS).orderBy("timestamp", "desc").limit(50).get(),
      db.collection(COL.MENSAJES).where("destinatario", "==", usuarioActivo.toUpperCase()).get()
    ]);
    const alertas = alertasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(a => !(a.leidoPor || "").includes(usuarioActivo));
    const mensajesSinLeer = msgsSnap.docs.filter(d => d.data().leido !== "SI").length;
    let liveFeed = settings.liveFeed || [];
    if (typeof liveFeed === "string") { try { liveFeed = JSON.parse(liveFeed); } catch { liveFeed = []; } }
    if (!Array.isArray(liveFeed)) liveFeed = [];
    return {
      incidenciasPendientes: 0, alertas, mensajesSinLeer,
      ultimaActualizacion: settings.ultimaModificacion || "--/-- 00:00",
      ultimoCuadre:        settings.ultimoCuadreTexto || "Sin registro",
      mapaBloqueado:       settings.mapaBloqueado === true,
      estadoCuadreV3:      settings.estadoCuadreV3 || "LIBRE",
      adminIniciador:      settings.adminIniciador || "",
      liveFeed, error: null
    };
  },

  async limpiarFeedGlobal() {
    await _setSettings({ liveFeed: JSON.stringify([]) });
    return "OK";
  },

  async actualizarFeedSettings(accion, autor) {
    await _actualizarFeed(accion, autor);
    return "OK";
  },

  // ─── ALERTAS ─────────────────────────────────────────────
  async emitirNuevaAlertaMaestra(tipo, titulo, mensaje, imagen, autor) {
    await db.collection(COL.ALERTAS).add({ timestamp: _ts(), fecha: _now(), autor, tipo, titulo, mensaje, imagen: imagen || "", leidoPor: "" });
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

  // ─── MENSAJES ────────────────────────────────────────────
  async obtenerMensajesPrivados(usuario) {
    const me = usuario.trim().toUpperCase();
    const [sent, recv] = await Promise.all([
      db.collection(COL.MENSAJES).where("remitente", "==", me).orderBy("timestamp", "desc").get(),
      db.collection(COL.MENSAJES).where("destinatario", "==", me).orderBy("timestamp", "desc").get()
    ]);
    const todos = [...sent.docs, ...recv.docs].map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.timestamp - a.timestamp);
    const vistos = new Set();
    return todos.filter(m => { if (vistos.has(m.id)) return false; vistos.add(m.id); return true; })
      .map(m => ({ ...m, esMio: m.remitente === me, leido: m.leido === "SI" }));
  },
  async enviarMensajePrivado(remitente, destinatario, texto) {
    const ts = _ts();
    const id = `msg_${ts}_${Math.floor(Math.random() * 1000)}`;
    await db.collection(COL.MENSAJES).doc(id).set({ timestamp: ts, fecha: _now(), remitente: remitente.trim().toUpperCase(), destinatario: destinatario.trim().toUpperCase(), mensaje: texto, leido: "NO" });
    return "EXITO";
  },
  async marcarMensajesLeidosArray(idsArray) {
    const batch = db.batch();
    for (const id of idsArray) batch.update(db.collection(COL.MENSAJES).doc(id.toString()), { leido: "SI" });
    await batch.commit();
    return "OK";
  },

  // ─── NOTAS ───────────────────────────────────────────────
  async obtenerTodasLasNotas() {
    const snap = await db.collection(COL.NOTAS).orderBy("timestamp", "desc").get();
    return snap.docs.map(d => ({ id: d.id, _docId: d.id, ...d.data() }));
  },
  async guardarNuevaNotaDirecto(nota, autor) {
    const ts = _ts();
    await db.collection(COL.NOTAS).doc(ts.toString()).set({ timestamp: ts, fecha: _now(), autor, nota, estado: "PENDIENTE", quienResolvio: "", solucion: "" });
    return "OK";
  },
  async resolverNotaDirecto(idNota, solucion, autor) {
    const idStr = idNota.toString();
    const ref = db.collection(COL.NOTAS).doc(idStr);
    const snap = await ref.get();
    if (snap.exists) { await ref.update({ quienResolvio: autor, estado: "RESUELTA", solucion }); return "OK"; }
    const ts = parseInt(idStr);
    if (!isNaN(ts)) {
      const q = await db.collection(COL.NOTAS).where("timestamp", "==", ts).limit(1).get();
      if (!q.empty) { await q.docs[0].ref.update({ quienResolvio: autor, estado: "RESUELTA", solucion }); return "OK"; }
    }
    return "ERROR: Nota no encontrada";
  },
  async eliminarNotaDirecto(idNota) {
    const idStr = idNota.toString();
    const ref = db.collection(COL.NOTAS).doc(idStr);
    const snap = await ref.get();
    if (snap.exists) { await ref.delete(); return "OK"; }
    const ts = parseInt(idStr);
    if (!isNaN(ts)) {
      const q = await db.collection(COL.NOTAS).where("timestamp", "==", ts).limit(1).get();
      if (!q.empty) { await q.docs[0].ref.delete(); return "OK"; }
    }
    return "ERROR: Nota no encontrada";
  },

  // ─── RESUMEN FLOTA ──────────────────────────────────────
  async obtenerResumenFlotaPatio() {
    const [cuadreSnap, externosSnap] = await Promise.all([
      db.collection(COL.CUADRE).get(),
      db.collection(COL.EXTERNOS).get()
    ]);
    const cuadreUnits = cuadreSnap.docs.map(d => ({ ...d.data() })).filter(u => u.mva);
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

  // ─── HISTORIAL ───────────────────────────────────────────

  // Gestión de Flota → Más Controles → REGISTROS/MOVIMIENTOS
  // Lee de historial_patio: movimientos de cajón (MOVE)
  async obtenerHistorialLogs() {
    const snap = await db.collection("historial_patio").orderBy("timestamp", "desc").limit(500).get();
    return snap.docs.map(d => {
      const data = d.data();
      return {
        fecha:    _fecha(data),
        tipo:     data.tipo || "MOVE",
        accion:   `${data.mva || ""} ${data.hoja || ""} ${data.posAnterior || ""} → ${data.posNueva || ""}`.trim(),
        mva:      data.mva || "",
        detalles: `${data.posAnterior || ""} → ${data.posNueva || ""}`,
        ubicacion: data.posNueva || "",
        estado:   data.posNueva || "",
        autor:    data.autor || "",
        usuario:  data.autor || ""
      };
    });
  },

  // Sidebar → HISTORIAL ACTIVIDAD (AUDITORÍA DEL SISTEMA)
  // Lee de LOGS: inserciones, modificaciones de estado, bajas
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
        accion:   accion,
        mva:      data.mva || (mvaMatch ? mvaMatch[1] : ""),
        detalles: ubiMatch ? ubiMatch[1] : (estadoMatch ? estadoMatch[1] : ""),
        ubicacion: ubiMatch ? ubiMatch[1] : "",
        estado:   estadoMatch ? estadoMatch[1] : (data.tipo || ""),
        autor:    data.autor || "",
        usuario:  data.autor || ""
      };
    });
  },

  // ─── USUARIOS ────────────────────────────────────────────
  async guardarNuevoUsuario(nombre, pin, isAdmin, telefono, isGlobalAdmin) {
    const nombreUpper = nombre.trim().toUpperCase();
    const existe = await db.collection(COL.USERS).where("usuario", "==", nombreUpper).limit(1).get();
    if (!existe.empty) return "ERROR: El usuario ya existe";
    const docId = nombreUpper.replace(/\s+/g, '_');
    const esAdmin = isAdmin === true || isAdmin === "true";
    const esGlobal = isGlobalAdmin === true || isGlobalAdmin === "true";
    await db.collection(COL.USERS).doc(docId).set({
      usuario: nombreUpper,
      password: pin.toString(),
      isAdmin: esAdmin,
      telefono: (telefono || "").trim()
    });
    if (esAdmin && esGlobal) {
      await db.collection(COL.ADMINS).doc(nombreUpper).set({
        usuario: nombreUpper, password: pin.toString(), isGlobal: true
      });
    }
    return "EXITO";
  },
  async modificarUsuario(nombreOriginal, nuevoNombre, nuevoPin, isAdmin, telefono, isGlobalAdmin) {
    const origUpper = nombreOriginal.trim().toUpperCase();
    const nuevoUpper = nuevoNombre.trim().toUpperCase();
    const snap = await db.collection(COL.USERS).where("usuario", "==", origUpper).limit(1).get();
    if (snap.empty) return "ERROR: Usuario no encontrado";
    const esAdmin = isAdmin === true || isAdmin === "true";
    const esGlobal = isGlobalAdmin === true || isGlobalAdmin === "true";
    await snap.docs[0].ref.update({
      usuario: nuevoUpper,
      password: nuevoPin.toString(),
      isAdmin: esAdmin,
      telefono: (telefono || "").trim()
    });
    // Buscar por campo usuario (no por doc ID) para cubrir docs con ID legacy
    const adminSnap = await db.collection(COL.ADMINS).where("usuario", "==", origUpper).limit(1).get();
    if (esAdmin) {
      // Siempre mantener en admins — solo cambia el flag isGlobal
      if (adminSnap.empty) {
        await db.collection(COL.ADMINS).doc(nuevoUpper).set({
          usuario: nuevoUpper, password: nuevoPin.toString(), isGlobal: esGlobal
        });
      } else {
        await adminSnap.docs[0].ref.update({ usuario: nuevoUpper, password: nuevoPin.toString(), isGlobal: esGlobal });
      }
    } else {
      // Ya no es admin — eliminar de admins
      if (!adminSnap.empty) await adminSnap.docs[0].ref.delete();
    }
    return "EXITO";
  },
  async eliminarUsuario(nombre) {
    const nombreUpper = nombre.trim().toUpperCase();
    const snap = await db.collection(COL.USERS).where("usuario", "==", nombreUpper).limit(1).get();
    if (snap.empty) return "ERROR: Usuario no encontrado";
    await snap.docs[0].ref.delete();
    const adminSnap = await db.collection(COL.ADMINS).where("usuario", "==", nombreUpper).limit(1).get();
    if (!adminSnap.empty) await adminSnap.docs[0].ref.delete();
    return "EXITO";
  },

  // ─── BLOQUEO ─────────────────────────────────────────────
  async toggleBloqueoMapa(nuevoEstado) {
    await _setSettings({ mapaBloqueado: nuevoEstado === true });
    return "OK";
  },

  // ─── CUADRE V3 ───────────────────────────────────────────
  async iniciarProtocoloDesdeAdmin(nombreAdmin, jsonMision) {
    await _setSettings({ estadoCuadreV3: "PROCESO", adminIniciador: nombreAdmin, misionAuditoria: jsonMision });
    return "EXITO";
  },
  async obtenerMisionAuditoria() {
    const settings = await _getSettings();
    try { return JSON.parse(settings.misionAuditoria || "[]"); } catch { return []; }
  },
  async guardarAuditoriaCruzada(datosAuditoria, autor) {
    await _setSettings({ estadoCuadreV3: "REVISION", datosAuditoria: JSON.stringify(datosAuditoria) });
    await db.collection(COL.AUDITORIA).add({ timestamp: _ts(), fecha: _now(), autor, datos: datosAuditoria });
    return "EXITO";
  },
  async finalizarProtocoloV3(autorCierre) {
    await _setSettings({ estadoCuadreV3: "LIBRE", adminIniciador: "", ultimoCuadreTexto: `${autorCierre} (${_now()})`, ultimaModificacion: _now() });
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
    return snap.docs.map(d => {
      const data = d.data();
      return {
        id:        d.id,
        fecha:     _fecha(data),
        auxiliar:  data.auxiliar || data.autor || "",
        admin:     data.admin || data.adminVentas || "",
        ok:        data.ok || "0",
        faltantes: data.faltantes || "0",
        sobrantes: data.sobrantes || data.numSobrantes || "0",
        pdfUrl:    data.pdfUrl || data.jsonCompleto || ""
      };
    });
  },

  // ─── CONFIGURACIÓN GLOBAL ────────────────────────────────
  async obtenerConfiguracion() {
    const [snapEmpresa, snapListas] = await Promise.all([
      db.collection(COL.CONFIG).doc("empresa").get(),
      db.collection(COL.CONFIG).doc("listas").get()
    ]);
    return {
      empresa: snapEmpresa.exists ? snapEmpresa.data() : { nombre: "MEX RENT A CAR" },
      listas: snapListas.exists ? snapListas.data() : { ubicaciones: [], estados: [], gasolinas: [], categorias: [] }
    };
  },

  async guardarConfiguracionListas(listasActualizadas) {
    await db.collection(COL.CONFIG).doc("listas").set(listasActualizadas, { merge: true });
    await _registrarLog("SISTEMA", "⚙️ Modificó los catálogos del sistema", "Admin Global");
    return "EXITO";
  },

  async procesarAuditoriaDesdeAdmin(auditList, autorAdmin, stats) {
    await _registrarLog("CUADRE", `✅ CUADRE VALIDADO - ${stats?.ok || 0} OK / ${stats?.faltantes || 0} FALTAN`, autorAdmin);
    await db.collection(COL.HISTORIAL_CUADRES).add({
      timestamp: _ts(), fecha: _now(),
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

  // ─── PLAZAS / CORPORATIVO ────────────────────────────────
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
    const cuadreSnap = await db.collection(COL.CUADRE).where("mva", "==", mvaStr).limit(1).get();
    const cuadreData = cuadreSnap.empty ? {} : cuadreSnap.docs[0].data();
    return {
      id: snap.docs[0].id, plaza: sucursal,
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
    const snap = await db.collection(COL.INDEX).where("mva", "==", data.mva.toString().trim().toUpperCase()).limit(1).get();
    if (snap.empty) return "ERROR: Unidad no encontrada";
    await snap.docs[0].ref.update(data);
    return "EXITO";
  },
  async eliminarUnidadPlaza(plaza, id) {
    await db.collection(COL.INDEX).doc(id).delete();
    return "EXITO";
  },

  // ─── SIPP ────────────────────────────────────────────────
  async obtenerDisponiblesSIPP() {
    const snap = await db.collection(COL.SIPP).get();
    return snap.docs.map(d => d.data());
  },

  // ─── EMAIL / AI / PDF ────────────────────────────────────
  async enviarReporteCuadreEmail(base64Image, autor, stats) {
    await _registrarLog("EMAIL", `📧 Reporte de cuadre enviado por ${autor}`, autor);
    return "EXITO";
  },
  async enviarAuditoriaAVentas(auditList, autor) {
    await _registrarLog("AUDITORIA", `📋 Auditoría enviada a Ventas por ${autor} (${auditList.length} unidades)`, autor);
    return { exito: true };
  },
  async llamarGeminiAI(instruccionUsuario, contextoPatio, ultimoMVA) { return null; },
  async generarPDFActividadDiaria(reservas, regresos, vencidos, autor, fechaFront) {
    await _registrarLog("PDF", `📄 Reporte Actividad Diaria generado por ${autor}`, autor);
    return "EXITO";
  },
  async generarExcelPrediccion(datosFamilias, fechaEscogida, autor) {
    await _registrarLog("EXCEL", `📊 Excel Predicción generado por ${autor}`, autor);
    return "EXITO";
  },

  async checkEsAdmin(nombre) {
    const snap = await db.collection(COL.ADMINS).where("usuario", "==", nombre.trim().toUpperCase()).limit(1).get();
    return !snap.empty;
  },

  async obtenerUrlImagenModelo(modelo) {
    if (!modelo) return "";
    const IMAGENES_MODELOS = window.MEX_IMAGENES_MODELOS || {};
    const key = modelo.toString().trim().split(" ")[0].toLowerCase();
    for (const nombre in IMAGENES_MODELOS) { if (nombre.includes(key)) return IMAGENES_MODELOS[nombre]; }
    return "img/no-model.png";
  },

  async analizarPlacaVisionAPI(_base64Image) {
    // La integración con Vision API requiere Cloud Functions; por ahora retorna vacío
    return "";
  }
};

// ─── ESTRUCTURA POR DEFECTO DEL MAPA ────────────────────────
function _generarEstructuraPorDefecto() {
  const estructura = [];
  let orden = 0;
  const secciones = [
    { prefix: "S", cols: 8, row: 1 }, { prefix: "L", cols: 8, row: 2 },
    { prefix: "O", cols: 8, row: 3 }, { prefix: "N", cols: 8, row: 4 },
  ];
  secciones.forEach((sec, si) => {
    estructura.push({ valor: sec.prefix, row: si * 3 + 1, col: 1, rowspan: 1, colspan: 1, orden: orden++, esLabel: true });
    for (let i = 1; i <= sec.cols; i++) {
      estructura.push({ valor: `${sec.prefix}${i}-1`, row: si * 3 + 1, col: i + 1, rowspan: 1, colspan: 1, orden: orden++ });
      estructura.push({ valor: `${sec.prefix}${i}-2`, row: si * 3 + 2, col: i + 1, rowspan: 1, colspan: 1, orden: orden++ });
    }
  });
  return estructura;
}

window.obtenerUrlImagenModelo = function(modelo) {
  if (!modelo) return "";
  const IMAGENES_MODELOS = window.MEX_IMAGENES_MODELOS || {};
  const key = modelo.toString().trim().split(" ")[0].toLowerCase();
  for (const nombre in IMAGENES_MODELOS) { if (nombre.includes(key)) return IMAGENES_MODELOS[nombre]; }
  return "img/no-model.png";
};


// ─── API PÚBLICA ─────────────────────────────────────────────
window.api = API_FUNCTIONS;
console.log('✅ [MEX-API] Firebase API lista con ' + Object.keys(API_FUNCTIONS).length + ' funciones.');