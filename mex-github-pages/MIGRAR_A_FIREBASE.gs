/**
 * ============================================================
 * MIGRAR_A_FIREBASE.gs
 * Copia todos tus datos de Google Sheets → Firebase Firestore
 *
 * INSTRUCCIONES:
 * 1. En tu proyecto de Apps Script (el que ya tienes), crea un
 *    archivo nuevo y pega TODO este código.
 * 2. Reemplaza FIREBASE_PROJECT_ID y FIREBASE_API_KEY abajo.
 * 3. Ejecuta las funciones UNA por UNA en este orden:
 *       1. migrarUsuarios()
 *       2. migrarAdmins()
 *       3. migrarCuadre()
 *       4. migrarExternos()
 *       5. migrarIndexUnidades()
 *       6. migrarAlertas()
 *       7. migrarNotas()
 *       8. migrarLogs()
 *       9. migrarMensajes()
 *      10. migrarSettings()
 *      11. migrarMapaConfig()
 * ============================================================
 */

// ⚠️  REEMPLAZA ESTOS DOS VALORES
const FIREBASE_PROJECT_ID = "TU_PROJECT_ID";  // Ej: "mex-mapa-bjx"
const FIREBASE_API_KEY    = "TU_WEB_API_KEY"; // De la consola Firebase > Configuración del proyecto > API Key web

// ─── Helper: escribe un documento en Firestore vía REST ──────
function firestoreSet(coleccion, docId, datos) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${coleccion}/${docId}`;
  const token = ScriptApp.getOAuthToken();

  // Convertir objeto JS a formato Firestore
  function toFirestore(obj) {
    const fields = {};
    for (const key in obj) {
      const val = obj[key];
      if (val === null || val === undefined) {
        fields[key] = { nullValue: null };
      } else if (typeof val === "boolean") {
        fields[key] = { booleanValue: val };
      } else if (typeof val === "number") {
        fields[key] = { integerValue: String(val) };
      } else if (val instanceof Date) {
        fields[key] = { timestampValue: val.toISOString() };
      } else if (Array.isArray(val)) {
        fields[key] = { arrayValue: { values: val.map(v => {
          if (typeof v === "string") return { stringValue: v };
          if (typeof v === "number") return { integerValue: String(v) };
          if (typeof v === "boolean") return { booleanValue: v };
          return { stringValue: JSON.stringify(v) };
        })}} };
      } else {
        fields[key] = { stringValue: String(val) };
      }
    }
    return { fields };
  }

  const options = {
    method: "patch",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(toFirestore(datos)),
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch(url, options);
  const code = resp.getResponseCode();
  if (code !== 200) {
    Logger.log(`❌ Error ${code} en ${coleccion}/${docId}: ${resp.getContentText().slice(0, 200)}`);
  }
  return code === 200;
}

// ─── Helper: añade un documento con ID auto-generado ──────────
function firestoreAdd(coleccion, datos) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${coleccion}`;
  const token = ScriptApp.getOAuthToken();

  function toFirestore(obj) {
    const fields = {};
    for (const key in obj) {
      const val = obj[key];
      if (val === null || val === undefined) {
        fields[key] = { nullValue: null };
      } else if (typeof val === "boolean") {
        fields[key] = { booleanValue: val };
      } else if (typeof val === "number") {
        fields[key] = { doubleValue: val };
      } else if (val instanceof Date) {
        fields[key] = { timestampValue: val.toISOString() };
      } else {
        fields[key] = { stringValue: String(val) };
      }
    }
    return { fields };
  }

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(toFirestore(datos)),
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch(url, options);
  return resp.getResponseCode() === 200;
}

// ─────────────────────────────────────────────────────────────
// 1. USUARIOS DEL MAPA (CHECK_MAPA_USERS)
// ─────────────────────────────────────────────────────────────
function migrarUsuarios() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CHECK_MAPA_USERS");
  if (!sheet) { Logger.log("❌ Hoja CHECK_MAPA_USERS no encontrada"); return; }

  const data = sheet.getDataRange().getValues();
  let ok = 0;
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const nombre = data[i][0].toString().trim().toUpperCase();
    const doc = {
      usuario:  nombre,
      password: data[i][1] ? data[i][1].toString().trim() : "",
      isAdmin:  data[i][2] === true || data[i][2].toString().toUpperCase() === "TRUE",
      telefono: data[i][3] ? data[i][3].toString().trim().replace(/\D/g, '') : ""
    };
    if (firestoreSet("usuarios", nombre, doc)) ok++;
    Utilities.sleep(200);
  }
  Logger.log(`✅ Usuarios migrados: ${ok} de ${data.length - 1}`);
}

// ─────────────────────────────────────────────────────────────
// 2. ADMINS GLOBALES (CHECK_ADMINS)
// ─────────────────────────────────────────────────────────────
function migrarAdmins() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CHECK_ADMINS");
  if (!sheet) { Logger.log("❌ Hoja CHECK_ADMINS no encontrada"); return; }

  const data = sheet.getDataRange().getValues();
  let ok = 0;
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const nombre = data[i][0].toString().trim().toUpperCase();
    const doc = {
      usuario:  nombre,
      password: data[i][1] ? data[i][1].toString().trim() : "",
      isGlobal: data[i][2] === true || data[i][2].toString().toUpperCase() === "TRUE"
    };
    if (firestoreSet("admins", nombre, doc)) ok++;
    Utilities.sleep(200);
  }
  Logger.log(`✅ Admins globales migrados: ${ok} de ${data.length - 1}`);
}

// ─────────────────────────────────────────────────────────────
// 3. CUADRE DE FLOTA (CUADRE) — La más importante
// ─────────────────────────────────────────────────────────────
function migrarCuadre() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CUADRE");
  if (!sheet) { Logger.log("❌ Hoja CUADRE no encontrada"); return; }

  const data = sheet.getDataRange().getValues();
  let ok = 0;
  for (let i = 1; i < data.length; i++) {
    const mva = data[i][2] ? data[i][2].toString().trim() : "";
    if (!mva) continue;

    const fechaIngreso = data[i][11] instanceof Date
      ? data[i][11].toISOString()
      : (data[i][11] ? data[i][11].toString() : new Date().toISOString());

    const doc = {
      categoria:    data[i][0] ? data[i][0].toString().trim() : "",
      modelo:       data[i][1] ? data[i][1].toString().trim() : "",
      mva:          mva.toUpperCase(),
      placas:       data[i][3] ? data[i][3].toString().trim() : "",
      gasolina:     data[i][4] ? data[i][4].toString().trim().replace(/^'/, '') : "N/A",
      estado:       data[i][5] ? data[i][5].toString().trim() : "SUCIO",
      ubicacion:    data[i][6] ? data[i][6].toString().trim().toUpperCase() : "PATIO",
      notas:        data[i][8] ? data[i][8].toString().trim() : "",
      pos:          data[i][10] ? data[i][10].toString().trim().toUpperCase() : "LIMBO",
      fechaIngreso: fechaIngreso,
      _createdAt:   new Date().toISOString()
    };

    if (firestoreSet("cuadre", mva.toUpperCase(), doc)) ok++;
    Utilities.sleep(150);
    if (ok % 20 === 0) Logger.log(`  ... ${ok} unidades migradas`);
  }
  Logger.log(`✅ Cuadre migrado: ${ok} unidades`);
}

// ─────────────────────────────────────────────────────────────
// 4. EXTERNOS
// ─────────────────────────────────────────────────────────────
function migrarExternos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("EXTERNOS");
  if (!sheet) { Logger.log("⚠️ Hoja EXTERNOS no encontrada (puede estar vacía)"); return; }

  const data = sheet.getDataRange().getValues();
  let ok = 0;
  for (let i = 1; i < data.length; i++) {
    const mva = data[i][2] ? data[i][2].toString().trim() : "";
    if (!mva) continue;

    const doc = {
      categoria:  data[i][0] ? data[i][0].toString().trim() : "",
      modelo:     data[i][1] ? data[i][1].toString().trim() : "PARTICULAR",
      mva:        mva.toUpperCase(),
      placas:     data[i][3] ? data[i][3].toString().trim() : "N/A",
      gasolina:   data[i][4] ? data[i][4].toString().trim().replace(/^'/, '') : "N/A",
      estado:     data[i][5] ? data[i][5].toString().trim() : "EXTERNO",
      ubicacion:  "EXTERNO",
      notas:      data[i][8] ? data[i][8].toString().trim() : "",
      pos:        data[i][10] ? data[i][10].toString().trim().toUpperCase() : "LIMBO",
      fechaIngreso: data[i][11] instanceof Date ? data[i][11].toISOString() : ""
    };

    if (firestoreSet("externos", mva.toUpperCase(), doc)) ok++;
    Utilities.sleep(150);
  }
  Logger.log(`✅ Externos migrados: ${ok}`);
}

// ─────────────────────────────────────────────────────────────
// 5. INDEX DE UNIDADES (BASE MAESTRA CORPORATIVA)
// ─────────────────────────────────────────────────────────────
function migrarIndexUnidades() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("INDEX_UNIDADES");
  if (!sheet) { Logger.log("❌ Hoja INDEX_UNIDADES no encontrada"); return; }

  const data = sheet.getDataRange().getValues();
  let ok = 0;
  for (let i = 1; i < data.length; i++) {
    const mva = data[i][2] ? data[i][2].toString().trim() : "";
    if (!mva) continue;

    const modelo = data[i][1] ? data[i][1].toString().trim() : "";
    const placas = data[i][3] ? data[i][3].toString().trim() : "";

    const doc = {
      sucursal:  data[i][0] ? data[i][0].toString().trim() : "",
      modelo:    modelo,
      mva:       mva.toUpperCase(),
      placas:    placas,
      categoria: data[i][4] ? data[i][4].toString().trim() : "",
      etiqueta:  `${modelo} ${mva} ${placas}`.trim().toUpperCase()
    };

    if (firestoreSet("index_unidades", mva.toUpperCase(), doc)) ok++;
    Utilities.sleep(120);
    if (ok % 30 === 0) Logger.log(`  ... ${ok} entradas migradas`);
  }
  Logger.log(`✅ Index Unidades migrado: ${ok} entradas`);
}

// ─────────────────────────────────────────────────────────────
// 6. ALERTAS GLOBALES
// ─────────────────────────────────────────────────────────────
function migrarAlertas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("ALERTAS");
  if (!sheet) { Logger.log("⚠️ Hoja ALERTAS no encontrada"); return; }

  const data = sheet.getDataRange().getValues();
  let ok = 0;
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const id = data[i][0].toString().trim();
    const doc = {
      timestamp: parseFloat(id) || Date.now(),
      fecha:     data[i][1] ? data[i][1].toString() : "",
      autor:     data[i][2] ? data[i][2].toString().trim() : "",
      tipo:      data[i][3] ? data[i][3].toString().trim() : "INFO",
      titulo:    data[i][4] ? data[i][4].toString().trim() : "",
      mensaje:   data[i][5] ? data[i][5].toString().trim() : "",
      imagen:    data[i][6] ? data[i][6].toString().trim() : "",
      leidoPor:  data[i][7] ? data[i][7].toString().trim() : ""
    };
    if (firestoreSet("alertas", id, doc)) ok++;
    Utilities.sleep(200);
  }
  Logger.log(`✅ Alertas migradas: ${ok}`);
}

// ─────────────────────────────────────────────────────────────
// 7. NOTAS DE ADMINISTRADORES
// ─────────────────────────────────────────────────────────────
function migrarNotas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("admins_notas");
  if (!sheet) { Logger.log("⚠️ Hoja admins_notas no encontrada"); return; }

  const data = sheet.getDataRange().getValues();
  let ok = 0;
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const id = `nota_${i}`;
    const doc = {
      timestamp:     data[i][0] instanceof Date ? data[i][0].getTime() : Date.now(),
      fecha:         data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], "GMT-6", "dd/MM/yyyy HH:mm") : data[i][0].toString(),
      autor:         data[i][1] ? data[i][1].toString().trim() : "",
      nota:          data[i][2] ? data[i][2].toString().trim() : "",
      quienResolvio: data[i][3] ? data[i][3].toString().trim() : "",
      estado:        data[i][4] ? data[i][4].toString().trim() : "PENDIENTE",
      solucion:      data[i][5] ? data[i][5].toString().trim() : ""
    };
    if (firestoreSet("notas_admin", id, doc)) ok++;
    Utilities.sleep(200);
  }
  Logger.log(`✅ Notas migradas: ${ok}`);
}

// ─────────────────────────────────────────────────────────────
// 8. LOGS DE ACTIVIDAD (Últimos 200)
// ─────────────────────────────────────────────────────────────
function migrarLogs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("LOGS");
  if (!sheet) { Logger.log("⚠️ Hoja LOGS no encontrada"); return; }

  const data = sheet.getDataRange().getValues();
  const ultimos200 = data.slice(Math.max(1, data.length - 200));
  let ok = 0;

  for (let i = 0; i < ultimos200.length; i++) {
    const fila = ultimos200[i];
    if (!fila[0]) continue;

    let accion = "";
    for (let col = 2; col <= 10; col++) {
      if (fila[col]) accion += fila[col] + " ";
    }

    const id = `log_${Date.now()}_${i}`;
    const doc = {
      timestamp: fila[0] instanceof Date ? fila[0].getTime() : Date.now(),
      fecha:     fila[0] instanceof Date ? Utilities.formatDate(fila[0], "GMT-6", "dd/MM/yyyy HH:mm:ss") : fila[0].toString(),
      tipo:      fila[1] ? fila[1].toString().trim() : "OTRO",
      accion:    accion.trim(),
      autor:     fila[13] ? fila[13].toString().trim() : "Sistema"
    };
    if (firestoreSet("logs", id, doc)) ok++;
    Utilities.sleep(100);
  }
  Logger.log(`✅ Logs migrados: ${ok}`);
}

// ─────────────────────────────────────────────────────────────
// 9. MENSAJES PRIVADOS
// ─────────────────────────────────────────────────────────────
function migrarMensajes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MENSAJES");
  if (!sheet) { Logger.log("⚠️ Hoja MENSAJES no encontrada"); return; }

  const data = sheet.getDataRange().getValues();
  let ok = 0;
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const id = data[i][0].toString().trim();
    const doc = {
      timestamp:    parseFloat(id) || Date.now(),
      fecha:        data[i][1] ? data[i][1].toString().trim() : "",
      remitente:    data[i][2] ? data[i][2].toString().trim().toUpperCase() : "",
      destinatario: data[i][3] ? data[i][3].toString().trim().toUpperCase() : "",
      mensaje:      data[i][4] ? data[i][4].toString().trim() : "",
      leido:        data[i][5] ? data[i][5].toString().trim() : "NO"
    };
    if (firestoreSet("mensajes", id, doc)) ok++;
    Utilities.sleep(200);
  }
  Logger.log(`✅ Mensajes migrados: ${ok}`);
}

// ─────────────────────────────────────────────────────────────
// 10. SETTINGS (Estado del sistema: feed, bloqueo, cuadre)
// ─────────────────────────────────────────────────────────────
function migrarSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("SETTINGS_");
  if (!sheet) { Logger.log("⚠️ Hoja SETTINGS_ no encontrada, creando vacío..."); }

  const doc = {
    mapaBloqueado:     false,
    estadoCuadreV3:   "LIBRE",
    adminIniciador:    "",
    ultimaModificacion: new Date().toISOString(),
    ultimoEditor:      "Sistema",
    ultimoCuadreTexto: "Sin registro",
    liveFeed:          JSON.stringify([]),
    misionAuditoria:   JSON.stringify([])
  };

  // Si existe SETTINGS_, leer valores reales
  if (sheet) {
    try {
      const data = sheet.getRange("A2:C12").getValues();
      doc.ultimaModificacion = data[0][0] instanceof Date
        ? Utilities.formatDate(data[0][0], "GMT-6", "dd/MM - HH:mm")
        : (data[0][0] || doc.ultimaModificacion).toString();

      if (data[1][1]) doc.ultimoCuadreTexto = `${data[1][1]} (${data[1][2]})`;

      const bloqueado = data[3][1];
      doc.mapaBloqueado = bloqueado === true || bloqueado.toString() === "TRUE";

      const f2f3 = sheet.getRange("F2:F3").getValues();
      doc.estadoCuadreV3 = f2f3[0][0] || "LIBRE";
      doc.adminIniciador  = f2f3[1][0] || "";
    } catch(e) {
      Logger.log("⚠️ Error leyendo SETTINGS_: " + e.message);
    }
  }

  firestoreSet("settings", "principal", doc);
  Logger.log("✅ Settings migrados");
}

// ─────────────────────────────────────────────────────────────
// 11. CONFIGURACIÓN DEL MAPA (MAPA_CONFIG)
// ─────────────────────────────────────────────────────────────
function migrarMapaConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MAPA_CONFIG");
  if (!sheet) { Logger.log("⚠️ Hoja MAPA_CONFIG no encontrada — el mapa usará su estructura por defecto"); return; }

  const range = sheet.getDataRange();
  const values = range.getValues();
  const mergedRanges = range.getMergedRanges();

  let ok = 0;
  let orden = 0;

  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const valor = values[r][c];
      if (valor === "") continue;

      let rowspan = 1, colspan = 1;
      for (let m = 0; m < mergedRanges.length; m++) {
        const mr = mergedRanges[m];
        if (mr.getRow() === r + 1 && mr.getColumn() === c + 1) {
          rowspan = mr.getNumRows();
          colspan = mr.getNumColumns();
          break;
        }
      }

      const id = `celda_${r}_${c}`;
      const doc = {
        valor:   valor.toString(),
        row:     r + 1,
        col:     c + 1,
        rowspan: rowspan,
        colspan: colspan,
        orden:   orden++
      };

      if (firestoreSet("mapa_config", id, doc)) ok++;
      Utilities.sleep(100);
    }
  }
  Logger.log(`✅ Configuración del mapa migrada: ${ok} celdas`);
}

// ─────────────────────────────────────────────────────────────
// 🚀 MIGRACIÓN COMPLETA (Ejecuta todo en orden)
// ─────────────────────────────────────────────────────────────
function MIGRAR_TODO() {
  Logger.log("🚀 Iniciando migración completa a Firebase...\n");
  
  Logger.log("1/11 Migrando USUARIOS...");
  migrarUsuarios();
  
  Logger.log("2/11 Migrando ADMINS GLOBALES...");
  migrarAdmins();
  
  Logger.log("3/11 Migrando CUADRE DE FLOTA...");
  migrarCuadre();
  
  Logger.log("4/11 Migrando EXTERNOS...");
  migrarExternos();
  
  Logger.log("5/11 Migrando BASE MAESTRA (INDEX)...");
  migrarIndexUnidades();
  
  Logger.log("6/11 Migrando ALERTAS...");
  migrarAlertas();
  
  Logger.log("7/11 Migrando NOTAS...");
  migrarNotas();
  
  Logger.log("8/11 Migrando LOGS...");
  migrarLogs();
  
  Logger.log("9/11 Migrando MENSAJES...");
  migrarMensajes();
  
  Logger.log("10/11 Migrando SETTINGS...");
  migrarSettings();
  
  Logger.log("11/11 Migrando MAPA CONFIG...");
  migrarMapaConfig();
  
  Logger.log("\n✅✅✅ MIGRACIÓN COMPLETA. Revisa Firebase Console para verificar los datos.");
}
