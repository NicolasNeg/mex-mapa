// ─── CONFIGURACIÓN FIREBASE ─────────────────────────────────
// Los valores vienen de /config.js (no está en git — se genera en CI o localmente)
if (!window.FIREBASE_CONFIG) {
  document.body.innerHTML = '<div style="font-family:sans-serif;padding:40px;text-align:center;color:#ef4444;">'
    + '<h2>⚠️ Error de configuración</h2>'
    + '<p>No se encontró <code>config.js</code>. '
    + 'Si eres desarrollador, crea el archivo /config.js con <code>window.FIREBASE_CONFIG = {...}</code>.<br>'
    + 'Si ves esto en producción, contacta al administrador.</p></div>';
  throw new Error('config.js no encontrado — window.FIREBASE_CONFIG no definido');
}
function _normalizeFirebaseConfig(config = {}) {
  const next = { ...config };
  const projectId = String(next.projectId || '').trim();
  const rawBucket = String(next.storageBucket || '').trim().replace(/^gs:\/\//i, '');
  const derivedBucket = projectId ? `${projectId}.firebasestorage.app` : '';

  if (derivedBucket && (!rawBucket || rawBucket.endsWith('.appspot.com'))) {
    if (rawBucket && rawBucket !== derivedBucket) {
      console.warn(`Firebase Storage bucket legado detectado (${rawBucket}). Se usará ${derivedBucket}.`);
    }
    next.storageBucket = derivedBucket;
  } else if (rawBucket) {
    next.storageBucket = rawBucket;
  }

  return next;
}

const FIREBASE_CONFIG = _normalizeFirebaseConfig(window.FIREBASE_CONFIG);
window.FIREBASE_CONFIG = FIREBASE_CONFIG;

// Reutilizar la app ya inicializada por firebase-init.js (si existe),
// o inicializar aquí si mex-api.js se carga solo (e.g. en index.html legacy).
const app = firebase.apps.length
  ? firebase.apps[0]
  : firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

function _getStorageClient() {
  return (typeof firebase !== "undefined" && typeof firebase.storage === "function")
    ? firebase.storage()
    : null;
}

// ── Persistencia offline — solo si firebase-init.js no lo hizo ya ────────
if (!window._firestorePersistenceEnabled) {
  window._firestorePersistenceEnabled = true;
  db.enablePersistence({ synchronizeTabs: true })
    .catch(err => {
      if (err.code === 'failed-precondition') {
        console.warn('Offline persistence: múltiples pestañas, solo una activa.');
      } else if (err.code === 'unimplemented') {
        console.warn('Offline persistence: navegador no compatible.');
      }
    });
}

const COL = {
  CUADRE:    "cuadre",
  EXTERNOS:  "externos",
  USERS:     "usuarios",
  ADMINS:    "admins",
  ALERTAS:   "alertas",
  MENSAJES:  "mensajes",
  LOGS:      "logs",
  ADMIN_AUDIT: "bitacora_gestion",
  NOTAS:     "notas_admin",
  SETTINGS:  "settings",
  INDEX:     "index_unidades",
  MAPA_CFG:  "mapa_config",
  CUADRE_ADM:"cuadre_admins",
  AUDITORIA: "auditoria",
  HISTORIAL_CUADRES: "historial_cuadres",
  SIPP:      "sipp",
  CONFIG: "configuracion",
  PLANTILLAS_ALERTAS: "plantillas_alertas"
};

// [F1] SETTINGS_DOC eliminado — settings se lean/escriben por plaza: settings/{plazaActual}
const EVIDENCE_FOLDER = "evidencias_cuadre_admins";
const NOTE_ATTACHMENT_FOLDER = "notas_admin_adjuntos";

// [F1] Helpers eliminados: _cuadreRef, _externosRef, _cuadreAdmRef, _histCuadreRef
// [F1] migrarDatosLegacyAPlazas eliminada (ya no tiene sentido con colecciones planas por plaza)

// [F1] Sigue siendo necesario para configuracion/{plaza}
function _configPlazaRef(plaza) {
  return db.collection('configuracion').doc((plaza || '').toUpperCase().trim());
}

const DEFAULT_PLAZA_LOCATIONS = Object.freeze([
  { nombre: "PATIO", isPlazaFija: true },
  { nombre: "TALLER", isPlazaFija: true },
  { nombre: "AGENCIA", isPlazaFija: true },
  { nombre: "TALLER EXTERNO", isPlazaFija: true },
  { nombre: "HYP COBIAN", isPlazaFija: true },
  { nombre: "OTRA PLAZA", isPlazaFija: true }
]);

function _normalizePlazaId(value) {
  return String(value || '').trim().toUpperCase();
}

function _inferPlazaId(data = {}) {
  return _normalizePlazaId(
    data.plaza
    || data.plazaId
    || data.plazaAsignada
    || data.sucursalAsignada
    || data.sucursal
  );
}

function _matchesPlaza(data = {}, plaza) {
  const plazaUp = _normalizePlazaId(plaza);
  if (!plazaUp) return true;
  return _inferPlazaId(data) === plazaUp;
}

function _normalizePlazaLocationItem(item, plaza) {
  const plazaUp = _normalizePlazaId(plaza);
  const raw = typeof item === 'object' && item !== null ? item : { nombre: String(item || '').trim() };
  const nombre = _sanitizeText(raw.nombre || raw.id || (typeof item === 'string' ? item : ''));
  if (!nombre) return null;
  const nombreUp = nombre.toUpperCase();
  return {
    nombre: nombreUp,
    isPlazaFija: typeof raw.isPlazaFija === 'boolean' ? raw.isPlazaFija : ADMIN_FIXED_LOCATIONS.has(nombreUp),
    plazaId: plazaUp
  };
}

function _buildDefaultPlazaLocations(plaza) {
  return DEFAULT_PLAZA_LOCATIONS
    .map(item => _normalizePlazaLocationItem(item, plaza))
    .filter(Boolean);
}

function _buildDefaultPlazaSettings() {
  return {
    mapaBloqueado: false,
    estadoCuadreV3: "LIBRE",
    adminIniciador: "",
    liveFeed: JSON.stringify([]),
    ultimaModificacion: _now(),
    ultimoEditor: "Sistema"
  };
}

function _buildDefaultPlazaDetalle(plaza) {
  const plazaUp = _normalizePlazaId(plaza);
  return {
    id: plazaUp,
    nombre: plazaUp,
    descripcion: "",
    localidad: "",
    direccion: "",
    mapsUrl: "",
    correo: "",
    telefono: "",
    gerente: "",
    correoGerente: "",
    contactos: []
  };
}

async function _ensurePlazaBootstrap(plaza) {
  const plazaUp = _normalizePlazaId(plaza);
  if (!plazaUp || plazaUp === 'GLOBAL') return;

  const empresaRef = db.collection(COL.CONFIG).doc('empresa');
  const plazaRef = _configPlazaRef(plazaUp);
  const settingsRef = _settingsDoc(plazaUp);
  const estructuraRef = db.collection(COL.MAPA_CFG).doc(plazaUp).collection('estructura');

  const [empresaSnap, plazaSnap, settingsSnap, estructuraSnap] = await Promise.all([
    empresaRef.get(),
    plazaRef.get(),
    settingsRef.get(),
    estructuraRef.limit(1).get()
  ]);

  const writes = [];

  const empresa = empresaSnap.exists ? (empresaSnap.data() || {}) : {};
  const plazas = Array.isArray(empresa.plazas) ? [...empresa.plazas] : [];
  if (!plazas.includes(plazaUp)) plazas.push(plazaUp);

  const plazasDetalle = Array.isArray(empresa.plazasDetalle) ? [...empresa.plazasDetalle] : [];
  if (!plazasDetalle.some(item => _normalizePlazaId(item?.id) === plazaUp)) {
    plazasDetalle.push(_buildDefaultPlazaDetalle(plazaUp));
  }

  if (!empresaSnap.exists || plazas.length !== (empresa.plazas || []).length || plazasDetalle.length !== (empresa.plazasDetalle || []).length) {
    writes.push(
      empresaRef.set({
        plazas,
        plazasDetalle
      }, { merge: true })
    );
  }

  const plazaData = plazaSnap.exists ? (plazaSnap.data() || {}) : {};
  if (!Array.isArray(plazaData.ubicaciones) || plazaData.ubicaciones.length === 0) {
    writes.push(
      plazaRef.set({
        ubicaciones: _buildDefaultPlazaLocations(plazaUp)
      }, { merge: true })
    );
  }

  if (!settingsSnap.exists || Object.keys(settingsSnap.data() || {}).length === 0) {
    writes.push(
      settingsRef.set(_buildDefaultPlazaSettings(), { merge: true })
    );
  }

  if (estructuraSnap.empty) {
    const batch = db.batch();
    _generarEstructuraPorDefecto().forEach((el, idx) => {
      batch.set(estructuraRef.doc(`cel_${el.orden ?? idx}`), el);
    });
    writes.push(batch.commit());
  }

  if (writes.length > 0) {
    await Promise.all(writes);
  }
}

// Busca una unidad en las colecciones planas.
// Si se pasa plaza busca primero con filtro. Si no encuentra (o no se pasó plaza),
// busca docs que NO tengan campo plaza (legacy sin stampear).
// NUNCA devuelve un doc de otra plaza cuando se especifica plaza.
async function _buscarUnidadEnSubcol(mvaStr, plaza) {
  const plazaUp = _normalizePlazaId(plaza);
  if (plazaUp) {
    const [cuadreSnap, externosSnap] = await Promise.all([
      db.collection(COL.CUADRE).where('mva', '==', mvaStr).limit(10).get(),
      db.collection(COL.EXTERNOS).where('mva', '==', mvaStr).limit(10).get()
    ]);
    for (const d of [...cuadreSnap.docs, ...externosSnap.docs]) {
      if (_matchesPlaza(d.data(), plazaUp)) return { ref: d.ref, data: d.data() };
    }
    return null;
  }
  // Sin plaza — buscar sin filtro (solo para contextos que no tienen plaza)
  let snap = await db.collection(COL.CUADRE).where('mva', '==', mvaStr).limit(1).get();
  if (!snap.empty) return { ref: snap.docs[0].ref, data: snap.docs[0].data() };
  snap = await db.collection(COL.EXTERNOS).where('mva', '==', mvaStr).limit(1).get();
  if (!snap.empty) return { ref: snap.docs[0].ref, data: snap.docs[0].data() };
  return null;
}

async function _buscarUnidadLegacy(mvaStr, plaza) {
  return _buscarUnidadEnSubcol(mvaStr, plaza);
}

// ── Backfill: inyectar campo plaza en docs legacy que no lo tienen ──────────
// Lee campo sucursal/plazaAsignada/plaza del propio doc para inferir la plaza.
// Si no se puede inferir → skips (no toca el doc).
// Llama onProgress({ col, total, done, stamped, skipped })
async function backfillPlazaEnUnidades(onProgress) {
  const informe = { stamped: 0, skipped: 0, errores: [] };
  const cols = [COL.CUADRE, COL.EXTERNOS];
  for (const colName of cols) {
    try {
      const snap = await db.collection(colName).get();
      const docs = snap.docs;
      let done = 0;
      if (typeof onProgress === 'function') onProgress({ col: colName, total: docs.length, done: 0, ...informe });
      const batch = db.batch();
      let batchCount = 0;
      for (const d of docs) {
        const data = d.data();
        // Ya tiene plaza correcta → skip
        if (data.plaza && data.plaza.trim()) { informe.skipped++; done++; continue; }
        // Inferir de otros campos
        const inferred = _inferPlazaId(data);
        if (!inferred) { informe.skipped++; done++; continue; }
        batch.update(d.ref, { plaza: inferred });
        informe.stamped++;
        batchCount++;
        done++;
        // Commit cada 490 docs
        if (batchCount >= 490) {
          await batch.commit(); batchCount = 0;
        }
        if (typeof onProgress === 'function') onProgress({ col: colName, total: docs.length, done, ...informe });
      }
      if (batchCount > 0) await batch.commit();
    } catch (e) {
      informe.errores.push(`${colName}: ${e.message}`);
    }
  }
  return informe;
}

// Convierte un MVA a un ID de documento Firestore seguro (sin '/', sin segmentos pares, etc.)
function _mvaToDocId(mvaStr) {
  return (mvaStr || '').replace(/\//g, '_').replace(/\s+/g, '_').trim() || 'SINMVA';
}

const ADMIN_FIXED_LOCATIONS = new Set([
  "PATIO",
  "TALLER",
  "AGENCIA",
  "TALLER EXTERNO",
  "HYP COBIAN",
  "OTRA PLAZA"
]);
const ACCESS_ROLE_META = Object.freeze({
  AUXILIAR: { isAdmin: false, isGlobal: false, fullAccess: false },
  VENTAS: { isAdmin: true, isGlobal: false, fullAccess: false },
  SUPERVISOR: { isAdmin: true, isGlobal: false, fullAccess: false },
  JEFE_PATIO: { isAdmin: true, isGlobal: false, fullAccess: false },
  GERENTE_PLAZA: { isAdmin: true, isGlobal: false, fullAccess: false },
  JEFE_REGIONAL: { isAdmin: true, isGlobal: false, fullAccess: false },
  CORPORATIVO_USER: { isAdmin: true, isGlobal: true, fullAccess: true },
  PROGRAMADOR: { isAdmin: true, isGlobal: true, fullAccess: true },
  JEFE_OPERACION: { isAdmin: true, isGlobal: true, fullAccess: true }
});
const API_PROGRAMADOR_BOOTSTRAP_EMAILS = Object.freeze([
  "angelarmentta@icloud.com"
]);

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

function _splitAlertCsv(value) {
  return Array.from(new Set(
    String(value || "")
      .split(",")
      .map(item => item.trim().toUpperCase())
      .filter(Boolean)
  ));
}

function _serializeAlertCsv(value) {
  if (Array.isArray(value)) return _splitAlertCsv(value.join(",")).join(", ");
  const normalized = _splitAlertCsv(value);
  return normalized.length ? normalized.join(", ") : "GLOBAL";
}

function _normalizeAlertType(tipo) {
  const normalized = String(tipo || "").trim().toUpperCase();
  return normalized === "URGENTE" || normalized === "WARNING" ? normalized : "INFO";
}

function _normalizeAlertMode(modo) {
  return String(modo || "").trim().toUpperCase() === "PASIVA" ? "PASIVA" : "INTERRUPTIVA";
}

function _normalizeAlertDestMode(destMode, destinatarios) {
  const explicit = String(destMode || "").trim().toUpperCase();
  if (explicit === "GLOBAL" || explicit === "SEL" || explicit === "SOLO") return explicit;
  const lista = _splitAlertCsv(destinatarios).filter(item => item !== "GLOBAL");
  if (!lista.length) return "GLOBAL";
  return lista.length === 1 ? "SOLO" : "SEL";
}

function _normalizeAlertCta(cta = {}) {
  const rawType = String((cta && (cta.type || cta.tipo)) || "").trim().toUpperCase();
  const type = rawType === "URL" || rawType === "WHATSAPP" || rawType === "COPY" ? rawType : "NONE";
  if (type === "NONE") {
    return { type: "NONE", label: "", value: "", extra: "" };
  }
  return {
    type,
    label: _sanitizeText(cta.label || cta.texto || cta.text || ""),
    value: String(cta.value || cta.url || cta.telefono || cta.contenido || "").trim(),
    extra: _sanitizeText(cta.extra || cta.mensaje || cta.helper || "")
  };
}

function _normalizeAlertHexColor(color = "", fallback = "#1D4ED8") {
  const value = String(color || "").trim();
  if (/^#[0-9A-F]{6}$/i.test(value)) return value.toUpperCase();
  if (/^#[0-9A-F]{3}$/i.test(value)) {
    const [, r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

function _defaultAlertBannerMeta(tipo = "INFO") {
  const normalized = _normalizeAlertType(tipo);
  if (normalized === "URGENTE") return { label: "URGENTE", bg: "#FEE2E2", color: "#EF4444" };
  if (normalized === "WARNING") return { label: "ADVERTENCIA", bg: "#FEF3C7", color: "#D97706" };
  return { label: "INFORMATIVO", bg: "#DBEAFE", color: "#1D4ED8" };
}

function _normalizeAlertBanner(banner = {}, tipo = "INFO") {
  const meta = _defaultAlertBannerMeta(tipo);
  const labelRaw = _sanitizeText(banner.label || banner.text || banner.nombre || "");
  const bgRaw = String(banner.bg || banner.background || banner.fondo || "").trim();
  const colorRaw = String(banner.color || banner.textColor || banner.texto || "").trim();
  const custom = banner.custom === true || Boolean(labelRaw || bgRaw || colorRaw);
  return {
    label: labelRaw || meta.label,
    bg: _normalizeAlertHexColor(bgRaw, meta.bg),
    color: _normalizeAlertHexColor(colorRaw, meta.color),
    custom
  };
}

function _normalizeAlertAuthor(author = {}, fallbackActor = "") {
  const rawValue = _sanitizeText(author.value || author.autor || author.nombre || "");
  const rawMode = String(author.mode || author.modo || author.type || "").trim().toUpperCase();
  let mode = rawMode === "NONE" || rawMode === "CUSTOM"
    ? rawMode
    : (rawValue ? "CUSTOM" : "CURRENT");

  if (mode === "CUSTOM" && !rawValue) mode = "CURRENT";

  return {
    mode,
    value: mode === "CUSTOM" ? rawValue : "",
    visible: mode === "NONE"
      ? ""
      : (mode === "CUSTOM" ? rawValue : (_sanitizeText(fallbackActor) || "Sistema"))
  };
}

function _alertMatchesUser(alerta, usuarioActivo) {
  const usuario = String(usuarioActivo || "").trim().toUpperCase();
  if (!usuario) return false;
  const destinatarios = _splitAlertCsv(alerta && alerta.destinatarios).filter(item => item !== "GLOBAL");
  if (!destinatarios.length) return true;
  return destinatarios.includes(usuario);
}

function _alertReadByUser(alerta, usuarioActivo) {
  const usuario = String(usuarioActivo || "").trim().toUpperCase();
  if (!usuario) return false;
  return _splitAlertCsv(alerta && alerta.leidoPor).includes(usuario);
}

function _sanitizeRole(role) {
  const normalized = String(role || "").trim().toUpperCase();
  if (ACCESS_ROLE_META[normalized]) return normalized;
  const configuredRoles = window.MEX_CONFIG?.empresa?.security?.roles;
  if (configuredRoles && typeof configuredRoles === "object" && configuredRoles[normalized]) return normalized;
  return null;
}

function _runtimeRoleMeta(role) {
  const normalized = _sanitizeRole(role) || "AUXILIAR";
  const configured = window.MEX_CONFIG?.empresa?.security?.roles?.[normalized];
  const fallback = ACCESS_ROLE_META[normalized] || ACCESS_ROLE_META.AUXILIAR;
  return {
    isAdmin: configured?.isAdmin === undefined ? Boolean(fallback.isAdmin) : Boolean(configured.isAdmin),
    isGlobal: configured?.fullAccess === true || configured?.isGlobal === true
      ? true
      : (configured?.isGlobal === undefined ? Boolean(fallback.isGlobal) : Boolean(configured.isGlobal)),
    fullAccess: configured?.fullAccess === undefined ? Boolean(fallback.fullAccess) : Boolean(configured.fullAccess)
  };
}

function _profileDocId(email) {
  return String(email || "").trim().toLowerCase();
}

function _sanitizeStorageSegment(value) {
  return String(value || "sin-dato")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "SIN-DATO";
}

function _isBootstrapProgrammerEmail(email) {
  return API_PROGRAMADOR_BOOTSTRAP_EMAILS.includes(_profileDocId(email));
}

function _resolveRoleForEmail(email, role) {
  const normalizedRole = _sanitizeRole(role) || "AUXILIAR";
  return _isBootstrapProgrammerEmail(email) ? "PROGRAMADOR" : normalizedRole;
}

function _sanitizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function _sanearEventoGestionExtra(extra = {}) {
  const lat = Number(extra?.exactLocation?.latitude);
  const lng = Number(extra?.exactLocation?.longitude);
  const acc = Number(extra?.exactLocation?.accuracy);
  const capturedAt = Number(extra?.exactLocation?.capturedAt);
  const city = _sanitizeText(extra?.exactLocation?.city || "");
  const state = _sanitizeText(extra?.exactLocation?.state || "");
  const addressLabel = _sanitizeText(extra?.exactLocation?.addressLabel || [city, state].filter(Boolean).join(", "));
  return {
    entidad: _sanitizeText(extra.entidad),
    referencia: _sanitizeText(extra.referencia),
    detalles: _sanitizeText(extra.detalles),
    objetivo: _sanitizeText(extra.objetivo),
    rolObjetivo: _sanitizeText(extra.rolObjetivo),
    plazaObjetivo: _sanitizeText(extra.plazaObjetivo),
    resultado: _sanitizeText(extra.resultado),
    deviceId: _sanitizeText(extra.deviceId),
    activeRoute: _sanitizeText(extra.activeRoute),
    locationStatus: _sanitizeText(extra.locationStatus),
    exactLocation: (Number.isFinite(lat) && Number.isFinite(lng)) ? {
      latitude: lat,
      longitude: lng,
      accuracy: Number.isFinite(acc) ? acc : null,
      capturedAt: Number.isFinite(capturedAt) ? capturedAt : Date.now(),
      source: _sanitizeText(extra?.exactLocation?.source || 'browser'),
      city,
      state,
      addressLabel,
      googleMapsUrl: _sanitizeText(extra?.exactLocation?.googleMapsUrl || `https://maps.google.com/?q=${lat},${lng}`)
    } : null
  };
}

function _inferRole(roleOrIsAdmin, plazaOrIsGlobal) {
  if (typeof roleOrIsAdmin === "string") {
    return _sanitizeRole(roleOrIsAdmin) || "AUXILIAR";
  }
  if (roleOrIsAdmin === true || roleOrIsAdmin === "true") {
    return (plazaOrIsGlobal === true || plazaOrIsGlobal === "true")
      ? "CORPORATIVO_USER"
      : "VENTAS";
  }
  return "AUXILIAR";
}

function _normalizeUserRoleData(data = {}) {
  const rolBase = _sanitizeRole(data.rol) || (data.isGlobal ? "CORPORATIVO_USER" : (data.isAdmin ? "VENTAS" : "AUXILIAR"));
  const rol = _resolveRoleForEmail(data.email || data.id || "", rolBase);
  const meta = _runtimeRoleMeta(rol);
  return {
    rol,
    isAdmin: meta.isAdmin,
    isGlobal: meta.isGlobal,
    plazaAsignada: String(data.plazaAsignada || data.plaza || "").trim().toUpperCase()
  };
}

function _normalizeEvidenceItems(items = []) {
  const source = Array.isArray(items) ? items : [];
  return source.map(item => ({
    path: _sanitizeText(item.path || item.storagePath),
    fileName: _sanitizeText(item.fileName || item.name || item.nombre) || "EVIDENCIA",
    mimeType: _sanitizeText(item.mimeType || item.type),
    size: Number(item.size || item.bytes || 0) || 0,
    uploadedAt: _sanitizeText(item.uploadedAt || item.fecha),
    uploadedBy: _sanitizeText(item.uploadedBy || item.autor),
    url: _sanitizeText(item.url)
  })).filter(item => item.path || item.url);
}

function _normalizeLegacyEvidence(data = {}) {
  if (Array.isArray(data.evidencias) && data.evidencias.length > 0) {
    return _normalizeEvidenceItems(data.evidencias);
  }

  const legacyUrl = _sanitizeText(data.url || data.URL || data.urlArchivo || data.urlEvidencia || data.evidencia);
  if (!legacyUrl) return [];

  return [{
    path: _sanitizeText(data.evidenciaPath || data.storagePath),
    fileName: "EVIDENCIA",
    mimeType: "",
    size: 0,
    uploadedAt: "",
    uploadedBy: "",
    url: legacyUrl
  }];
}

function _dedupeEvidenceItems(items = []) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.path || item.url || `${item.fileName}-${item.uploadedAt}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function _resolveAdminResponsibleValue(data = {}) {
  const ubicacionRaw = _sanitizeText(data.ubicacion || "");
  const ubicacion = ubicacionRaw.replace(/^👤\s*/i, "").trim();
  const ubicacionUpper = ubicacion.toUpperCase();
  if (ubicacion && !ADMIN_FIXED_LOCATIONS.has(ubicacionUpper)) return ubicacion;
  return _sanitizeText(
    data.responsable
    || data.adminResponsable
    || data.responsableVisual
    || data._updatedBy
    || data._createdBy
    || data.autor
  );
}

async function _hydrateEvidenceItemsWithUrls(items = []) {
  const normalized = _normalizeEvidenceItems(items);
  const storage = _getStorageClient();
  if (!storage) return normalized;

  return Promise.all(normalized.map(async item => {
    if (item.url || !item.path) return item;
    try {
      return { ...item, url: await storage.ref(item.path).getDownloadURL() };
    } catch (error) {
      console.warn("No se pudo hidratar URL de evidencia:", item.path, error);
      return item;
    }
  }));
}

function _normalizeIncidentPriority(value, fallbackText = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if (["CRITICA", "CRÍTICA", "URGENTE", "CRITICO", "CRÍTICO"].includes(normalized)) return "CRITICA";
  if (["ALTA", "HIGH"].includes(normalized)) return "ALTA";
  if (["BAJA", "LOW"].includes(normalized)) return "BAJA";

  const fallback = String(fallbackText || "").toUpperCase();
  if (fallback.includes("URGENT") || fallback.includes("CRITIC")) return "CRITICA";
  if (fallback.includes("ALTA")) return "ALTA";
  if (fallback.includes("BAJA")) return "BAJA";
  return "MEDIA";
}

function _normalizeIncidentStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "RESUELTA" || normalized === "RESUELTO" ? "RESUELTA" : "PENDIENTE";
}

function _buildIncidentCode(timestampValue) {
  const stamp = String(timestampValue || _ts());
  return `INC-${stamp.slice(-6).padStart(6, "0")}`;
}

function _normalizeIncidentAttachments(data = {}) {
  return _dedupeEvidenceItems(_normalizeEvidenceItems(
    data.adjuntos || data.attachments || data.evidencias || []
  ));
}

function _buildIncidentPayload(data = {}, autor = "", adjuntos = [], timestampValue = null) {
  const timestamp = Number(timestampValue || data.timestamp || _ts()) || _ts();
  const descripcion = String(data.descripcion ?? data.nota ?? "").trim();
  const tituloBase = _sanitizeText(data.titulo || "");
  const titulo = tituloBase || (descripcion ? descripcion.split(/\r?\n/)[0].slice(0, 90) : "Incidencia sin título");
  const prioridad = _normalizeIncidentPriority(data.prioridad, `${titulo} ${descripcion}`);
  const estado = _normalizeIncidentStatus(data.estado);
  const archivos = _dedupeEvidenceItems(_normalizeEvidenceItems(adjuntos));
  const fecha = _sanitizeText(data.fecha) || _now();

  return {
    timestamp,
    fecha,
    autor: _sanitizeText(autor || data.autor) || "Sistema",
    titulo,
    prioridad,
    nota: descripcion,
    descripcion,
    estado,
    quienResolvio: _sanitizeText(data.quienResolvio || ""),
    solucion: _sanitizeText(data.solucion || ""),
    resueltaEn: _sanitizeText(data.resueltaEn || ""),
    codigo: _sanitizeText(data.codigo || "") || _buildIncidentCode(timestamp),
    adjuntos: archivos,
    version: Number(data.version || 1) || 1
  };
}

function _normalizeIncidentRecord(docId, data = {}) {
  const timestamp = Number(data.timestamp || parseInt(docId, 10) || _ts()) || _ts();
  const fecha = _sanitizeText(data.fecha) || _fecha({ timestamp, fecha: data.fecha });
  const adjuntos = _normalizeIncidentAttachments(data);
  return {
    id: docId,
    _docId: docId,
    ..._buildIncidentPayload({
      ...data,
      fecha,
      codigo: data.codigo || _buildIncidentCode(timestamp)
    }, data.autor, adjuntos, timestamp)
  };
}

async function _uploadIncidentAttachments(filesLike, docId, author) {
  const files = Array.from(filesLike || []).filter(Boolean);
  if (!files.length) return [];
  const storage = _getStorageClient();
  if (!storage) throw new Error("Firebase Storage no está disponible para subir adjuntos.");

  const uploadedAt = _now();
  const uploadedBy = _sanitizeText(author) || "Sistema";
  const uploads = [];

  for (const file of files) {
    const safeName = _sanitizeStorageSegment(file.name || `archivo-${_ts()}`);
    const path = `${NOTE_ATTACHMENT_FOLDER}/${docId}/${Date.now()}-${safeName}`;
    const ref = storage.ref(path);
    const contentType = _resolveUploadContentType(file);
    const snapshot = await ref.put(file, {
      contentType,
      customMetadata: { uploadedBy }
    });
    const url = await snapshot.ref.getDownloadURL();
    uploads.push({
      path,
      fileName: file.name || safeName,
      mimeType: file.type || "",
      size: Number(file.size || 0) || 0,
      uploadedAt,
      uploadedBy,
      url
    });
  }

  return uploads;
}

function _resolveUploadContentType(file = {}) {
  const explicit = _sanitizeText(file.type || '');
  if (explicit) return explicit;

  const name = String(file.name || '').trim().toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.doc')) return 'application/msword';
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.heic')) return 'image/heic';
  if (name.endsWith('.heif')) return 'image/heif';
  return 'application/octet-stream';
}

async function _uploadAdminEvidenceFiles(filesLike, docId, author) {
  const files = Array.from(filesLike || []).filter(file =>
    file
    && typeof file.name === "string"
    && typeof file.size !== "undefined"
  );
  if (!files.length) return [];

  const storage = _getStorageClient();
  if (!storage) throw new Error("Firebase Storage no está disponible para subir evidencias del Cuadre Admins.");

  const uploadedAt = _now();
  const uploadedBy = _sanitizeText(author) || "Sistema";
  const uploads = [];

  for (const file of files) {
    const safeName = _sanitizeStorageSegment(file.name || `evidencia-${_ts()}`);
    const path = `${EVIDENCE_FOLDER}/${docId}/${Date.now()}-${safeName}`;
    const ref = storage.ref(path);
    const contentType = _resolveUploadContentType(file);
    const snapshot = await ref.put(file, {
      contentType,
      customMetadata: { uploadedBy }
    });
    const url = await snapshot.ref.getDownloadURL();
    uploads.push({
      path,
      fileName: file.name || safeName,
      mimeType: file.type || "",
      size: Number(file.size || 0) || 0,
      uploadedAt,
      uploadedBy,
      url
    });
  }

  return uploads;
}

function _buildCuadreAdminPayload(datos = {}, evidencias = []) {
  const payload = { ...datos };
  const evidenciaLista = _dedupeEvidenceItems(_normalizeEvidenceItems(evidencias));
  const principal = evidenciaLista[0] || null;
  const adminResponsable = _sanitizeText(
    payload.adminResponsable || payload._updatedBy || payload._createdBy || payload.autor
  ) || "Sistema";
  const plaza = _inferPlazaId(payload);
  const notas = payload.borrarNotas ? "" : _sanitizeText(payload.notas || payload.nota || payload.observaciones || "");
  const responsable = _resolveAdminResponsibleValue({
    ...payload,
    adminResponsable,
    notas
  });
  const principalUrl = principal
    ? principal.url
    : _sanitizeText(payload.url || payload.URL || payload.urlArchivo || payload.urlEvidencia || payload.evidencia);

  delete payload.archivos;
  delete payload.files;
  delete payload.evidenceFiles;
  delete payload.borrarNotas;
  payload.plaza = plaza;
  payload.plazaId = plaza;
  payload.notas = notas;
  payload.adminResponsable = adminResponsable;
  payload.responsable = responsable;
  payload.responsableVisual = responsable || adminResponsable;
  payload.evidencias = evidenciaLista;
  payload.url = principalUrl;
  payload.urlArchivo = principalUrl;
  payload.urlEvidencia = principalUrl;
  payload.evidencia = principalUrl;
  payload.evidenciaPath = principal ? principal.path : "";
  payload.archivoStatus = evidenciaLista.length > 0 ? "SI" : "NO";
  payload.tieneArchivo = evidenciaLista.length > 0 ? "SI" : "NO";
  payload.file = evidenciaLista.length > 0 ? "SI" : "NO";
  payload.evidenciaCount = evidenciaLista.length;
  payload._updatedAt = _now();
  payload._updatedBy = adminResponsable;
  if (!payload._createdAt) payload._createdAt = _now();
  if (!payload._createdBy) payload._createdBy = adminResponsable;

  return payload;
}

async function _normalizeCuadreAdminRecord(docId, data = {}) {
  const evidencias = await _hydrateEvidenceItemsWithUrls(_dedupeEvidenceItems([
    ..._normalizeLegacyEvidence(data),
    ..._normalizeEvidenceItems(data.evidencias || [])
  ]));
  const principal = evidencias[0] || null;
  const plaza = _inferPlazaId(data);
  const adminResponsable = _sanitizeText(
    data.adminResponsable || data._updatedBy || data._createdBy || data.autor
  );
  const responsable = _resolveAdminResponsibleValue(data);
  const notas = _sanitizeText(data.notas || data.nota || data.observaciones || "");
  const legacyFlag = (data.file || data.FILE || data.archivoStatus || data.tieneArchivo || data.File || "")
    .toString()
    .toUpperCase()
    .trim() === "SI";
  const tieneArchivo = evidencias.length > 0 || legacyFlag;
  const categoria = _sanitizeText(data.categoria || data.categ);
  const modelo = _sanitizeText(data.modelo);
  const placas = _sanitizeText(data.placas);
  const mva = _sanitizeText(data.mva).toUpperCase();
  const estado = _sanitizeText(data.estado);
  const ubicacion = _sanitizeText(data.ubicacion);
  const gasolina = _sanitizeText(data.gasolina);

  return {
    id: docId,
    fila: docId,
    ...data,
    plaza,
    plazaId: plaza,
    categoria,
    categ: categoria || _sanitizeText(data.categ),
    modelo,
    placas,
    mva,
    estado,
    ubicacion,
    gasolina,
    notas,
    adminResponsable: adminResponsable || responsable || "Sistema",
    responsable,
    responsableVisual: responsable || adminResponsable || "Sistema",
    evidencias,
    url: (principal && principal.url) || _sanitizeText(data.url || data.URL || data.urlArchivo || data.urlEvidencia || data.evidencia),
    urlArchivo: (principal && principal.url) || _sanitizeText(data.urlArchivo || data.url || data.URL || data.urlEvidencia || data.evidencia),
    urlEvidencia: (principal && principal.url) || _sanitizeText(data.urlEvidencia || data.url || data.URL || data.urlArchivo || data.evidencia),
    evidenciaPath: (principal && principal.path) || _sanitizeText(data.evidenciaPath || data.storagePath),
    evidenciaCount: evidencias.length,
    archivoStatus: tieneArchivo ? "SI" : "NO",
    tieneArchivo: tieneArchivo ? "SI" : "NO",
    file: tieneArchivo ? "SI" : "NO",
    etiqueta: [
      plaza,
      categoria,
      modelo,
      placas,
      mva,
      estado,
      ubicacion,
      gasolina,
      notas,
      responsable,
      adminResponsable
    ].filter(Boolean).join(" ").toUpperCase()
  };
}

async function _resolveCuadreAdminDocId(mva, plaza) {
  const baseDocId = _mvaToDocId(_sanitizeText(mva).toUpperCase());
  const plazaUp = _normalizePlazaId(plaza);
  const snap = await db.collection(COL.CUADRE_ADM).where('mva', '==', _sanitizeText(mva).toUpperCase()).get();

  const samePlaza = snap.docs.find(doc => _matchesPlaza(doc.data(), plazaUp));
  if (samePlaza) {
    return { duplicate: true, docId: samePlaza.id };
  }

  const usedIds = new Set(snap.docs.map(doc => String(doc.id || '').toUpperCase()));
  if (!usedIds.has(baseDocId.toUpperCase())) {
    return { duplicate: false, docId: baseDocId };
  }

  let idx = 1;
  while (usedIds.has(`${baseDocId}_${idx}`.toUpperCase())) {
    idx += 1;
  }
  return { duplicate: false, docId: `${baseDocId}_${idx}` };
}

async function subirEvidenciaAdmin(file, rutaStorage) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('rutaStorage', rutaStorage);
  
  const response = await fetch('/api/uploadFile', {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) throw new Error('Error subiendo archivo');
  return await response.json();
}

async function _deleteEvidenceFiles(items = []) {
  const storage = _getStorageClient();
  if (!storage) return;
  for (const item of _normalizeEvidenceItems(items)) {
    if (!item.path) continue;
    try {
      await storage.ref(item.path).delete();
    } catch (error) {
      console.warn("No se pudo borrar evidencia en Storage:", item.path, error);
    }
  }
}

// [F1] _getSettings/_setSettings ahora usan doc por plaza (settings/{plazaActual})
// _settingsPlaza se inyecta desde las funciones públicas que ya conocen la plaza.
// Cuando no se conoce la plaza se usa 'GLOBAL' como fallback.
let _settingsPlazaActual = 'GLOBAL';
function _settingsDoc(plaza) {
  return db.collection(COL.SETTINGS).doc(((plaza || _settingsPlazaActual) || 'GLOBAL').toUpperCase().trim() || 'GLOBAL'); // [F1]
}
function _resolverEstadoBloqueoMapa(settingsPlaza = {}, settingsGlobal = {}) {
  const mapaBloqueadoLocal = settingsPlaza.mapaBloqueado === true;
  const mapaBloqueadoGlobal = settingsGlobal.mapaBloqueadoGlobal === true;
  return {
    mapaBloqueado: mapaBloqueadoLocal || mapaBloqueadoGlobal,
    mapaBloqueadoScope: mapaBloqueadoGlobal ? 'GLOBAL' : (mapaBloqueadoLocal ? 'PLAZA' : ''),
    mapaBloqueadoLocal,
    mapaBloqueadoGlobal
  };
}
async function _getSettings(plaza) {
  const plazaUp = _normalizePlazaId(plaza);
  if (plazaUp && plazaUp !== 'GLOBAL') {
    await _ensurePlazaBootstrap(plazaUp);
  }
  const snap = await _settingsDoc(plaza).get(); // [F1]
  return snap.exists ? snap.data() : {};
}
async function _setSettings(data, plaza) {
  await _settingsDoc(plaza).set(data, { merge: true }); // [F1]
}
async function _ensureGlobalSettingsDoc() {
  const existing = await _getSettings('GLOBAL');
  if (existing && Object.keys(existing).length) return existing;
  const defaults = {
    mapaBloqueadoGlobal: false,
    ultimaModificacion: _now(),
    ultimoEditor: 'Sistema'
  };
  await _setSettings(defaults, 'GLOBAL');
  return defaults;
}

function _windowLocationAuditExtra(extra = {}) {
  const base = (typeof window !== 'undefined' && typeof window.__mexGetLastLocationAuditPayload === 'function')
    ? (window.__mexGetLastLocationAuditPayload() || {})
    : {};
  const incoming = extra && typeof extra === 'object' ? extra : {};
  return _sanearEventoGestionExtra({
    ...base,
    ...incoming
  });
}

async function _registrarLog(tipo, mensaje, autor, plaza, extra = {}) {
  const ts = _ts();
  const id = `log_${ts}_${Math.floor(Math.random() * 1000)}`;
  const payload = { fecha: _now(), timestamp: ts, tipo, accion: mensaje, autor: autor || "Sistema" };
  if (plaza) payload.plaza = (plaza || '').toUpperCase().trim(); // [F1] campo plaza en logs
  const auditExtra = _windowLocationAuditExtra(extra);
  if (auditExtra.locationStatus) payload.locationStatus = auditExtra.locationStatus;
  if (auditExtra.exactLocation) payload.exactLocation = auditExtra.exactLocation;
  if (auditExtra.ipAddress) payload.ipAddress = auditExtra.ipAddress;
  if (auditExtra.forwardedFor) payload.forwardedFor = auditExtra.forwardedFor;
  await db.collection(COL.LOGS).doc(id).set(payload);
}
async function _registrarEventoGestion(tipo, mensaje, autor, extra = {}) {
  const ts = _ts();
  const id = `gest_${ts}_${Math.floor(Math.random() * 1000)}`;
  const extraSanitizado = _windowLocationAuditExtra(extra);
  await db.collection(COL.ADMIN_AUDIT).doc(id).set({
    fecha: _now(),
    timestamp: ts,
    tipo: _sanitizeText(tipo) || "GESTION",
    accion: _sanitizeText(mensaje),
    autor: _sanitizeText(autor) || "Sistema",
    ...extraSanitizado
  });
}

async function _guardarPerfilUsuarioPorEmail(email, data = {}) {
  const docId = _profileDocId(email);
  if (!docId) throw new Error("Correo inválido para perfil de usuario");

  const payload = {
    ...data,
    email: docId
  };

  await db.collection(COL.USERS).doc(docId).set(payload, { merge: true });
  return docId;
}
async function _actualizarFeed(accion, autor, plaza) {
  const settings = await _getSettings(plaza); // [F1]
  let feed = settings.liveFeed || [];
  if (typeof feed === "string") { try { feed = JSON.parse(feed); } catch(e) { feed = []; } }
  if (!Array.isArray(feed)) feed = [];
  const _fd = new Date();
  const _feedFecha = _fd.toLocaleString("es-MX", { timeZone:"America/Mazatlan", month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false });
  feed.unshift({ accion: accion, fecha: _feedFecha, autor: autor || "Sistema" });
  if (feed.length > 5) feed.length = 5;
  await _setSettings({ liveFeed: JSON.stringify(feed), ultimaModificacion: _now(), ultimoEditor: autor }, plaza); // [F1]
}

const MAPA_SNAPSHOT_MERGE_MS = 90;

// ─── SHARED NAMESPACE ────────────────────────────────────────
// Expone todas las utilidades internas para que los módulos /api/*.js
// puedan acceder a ellas sin duplicar código.
window._mex = {
  // Firebase
  db, auth, firebase, FIREBASE_CONFIG, COL, MAPA_SNAPSHOT_MERGE_MS,
  // Tiempo y texto
  _now, _ts, _fecha, _sanitizeText, _sanitizeStorageSegment, _sanitizeRole,
  // Plaza
  _normalizePlazaId, _inferPlazaId, _matchesPlaza,
  _normalizePlazaLocationItem, _buildDefaultPlazaLocations,
  _buildDefaultPlazaSettings, _buildDefaultPlazaDetalle,
  _configPlazaRef, _ensurePlazaBootstrap,
  // Unidades
  _mvaToDocId, _buscarUnidadEnSubcol, _buscarUnidadLegacy,
  backfillPlazaEnUnidades,
  // Alertas
  _splitAlertCsv, _serializeAlertCsv,
  _normalizeAlertType, _normalizeAlertMode, _normalizeAlertDestMode,
  _normalizeAlertCta, _normalizeAlertHexColor, _defaultAlertBannerMeta,
  _normalizeAlertBanner, _normalizeAlertAuthor,
  _alertMatchesUser, _alertReadByUser,
  // Roles / usuarios
  ACCESS_ROLE_META, ADMIN_FIXED_LOCATIONS, API_PROGRAMADOR_BOOTSTRAP_EMAILS,
  _runtimeRoleMeta, _profileDocId, _isBootstrapProgrammerEmail,
  _resolveRoleForEmail, _normalizeUserRoleData, _inferRole,
  _guardarPerfilUsuarioPorEmail,
  // Evidencias
  _normalizeEvidenceItems, _normalizeLegacyEvidence, _dedupeEvidenceItems,
  _hydrateEvidenceItemsWithUrls, _resolveAdminResponsibleValue,
  _resolveUploadContentType, _getStorageClient,
  // Incidencias
  _normalizeIncidentPriority, _normalizeIncidentStatus, _buildIncidentCode,
  _normalizeIncidentAttachments, _buildIncidentPayload, _normalizeIncidentRecord,
  _uploadIncidentAttachments, _uploadAdminEvidenceFiles, _deleteEvidenceFiles,
  // Cuadre admins
  _buildCuadreAdminPayload, _normalizeCuadreAdminRecord, _resolveCuadreAdminDocId,
  subirEvidenciaAdmin,
  // Settings
  _settingsDoc, _resolverEstadoBloqueoMapa, _getSettings, _setSettings,
  _ensureGlobalSettingsDoc, _actualizarFeed,
  // Logs
  _windowLocationAuditExtra, _registrarLog, _registrarEventoGestion,
  _sanearEventoGestionExtra,
  // Mapa
  _generarEstructuraPorDefecto,
};
window._mexParts = {};

// ─── MÓDULOS API (cargados después vía <script> en el HTML) ──
// /api/auth.js, /api/mapa.js, /api/cuadre.js, /api/flota.js,
// /api/alertas.js, /api/notas.js, /api/historial.js,
// /api/settings.js, /api/users.js, /api/_assemble.js

// Mantener window.api sincronizado para páginas que no cargan los módulos nuevos
// (compatibilidad hacia atrás — se sobreescribe por _assemble.js si está presente)
const API_FUNCTIONS = {

  // ─── AUTENTICACIÓN ────────────────────────────────────────
  async obtenerCredencialesMapa() {
    const usersSnap = await db.collection(COL.USERS).get();
    return usersSnap.docs.map(d => {
      const data = d.data();
      const roleData = _normalizeUserRoleData(data);
      // Normalizar: usuarios nuevos (Firebase Auth) tienen nombre+email, los viejos tenían usuario
      const displayName = (data.nombre || data.usuario || data.email || '').toUpperCase();
      return {
        ...data,
        ...roleData,
        usuario: displayName, // campo unificado que usa el resto de la app
      };
    }).sort((a, b) => a.usuario.localeCompare(b.usuario));
  },

  async obtenerNombresUsuarios() {
    const snap = await db.collection(COL.USERS).get();
    return snap.docs.map(d => {
      const data = d.data();
      return (data.nombre || data.usuario || data.email || '').toUpperCase();
    }).filter(Boolean).sort();
  },

  async verificarAdminGlobal(nombreUsuario) {
    const nombre = nombreUsuario.trim().toUpperCase();
    const snap = await db.collection(COL.USERS).where("nombre", "==", nombre).limit(1).get();
    if (snap.empty) return false;
    return _normalizeUserRoleData(snap.docs[0].data()).isGlobal === true;
  },

  // ─── MAPA — SUSCRIPCIÓN EN TIEMPO REAL ──────────────────
  // [F1] Lee directamente de colecciones planas (cuadre, externos).
  // Para filtrar por plaza usa suscribirMapaPlaza().
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

    // [F1] Colecciones planas raíz
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

  // [F1] suscribirMapaPlaza — colecciones planas filtradas por campo plaza
  suscribirMapaPlaza(plaza, callback) {
    const plazaUp = _normalizePlazaId(plaza);
    if (!plazaUp) return this.suscribirMapa(callback);

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

    // [F1] Colección plana — filtra client-side para incluir docs legacy sin campo plaza
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
    // [F1] Colecciones planas filtradas por campo plaza
    // Traer todo y filtrar client-side (compatibilidad con docs legacy sin campo plaza)
    const [cuadreSnap, externosSnap] = await Promise.all([
      db.collection(COL.CUADRE).get(), db.collection(COL.EXTERNOS).get()
    ]);
    const cuadreDocs2 = cuadreSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(u => _matchesPlaza(u, plazaUp));
    const externosDocs2 = externosSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(u => _matchesPlaza(u, plazaUp));
    return { unidades: [
      ...cuadreDocs2
        .filter(u => u.mva && (u.ubicacion === "PATIO" || u.ubicacion === "TALLER"))
        .map(u => ({ ...u, tipo: "renta" })),
      ...externosDocs2
        .filter(u => u.mva)
        .map(u => ({ ...u, ubicacion: "EXTERNO", tipo: "externo" }))
    ]};
  },

  // ── Estructura de mapa por plaza ─────────────────────────────────────────
  // Nueva arquitectura: mapa_config/{plaza}/estructura/{cel_N}
  // Legacy fallback:   mapa_config/cel_N  (datos anteriores al cambio)

  async obtenerEstructuraMapa(plaza) {
    const p = _normalizePlazaId(plaza);
    // [F1-B] mapa_config/{plazaId}/estructura/{cel}
    if (p) {
      await _ensurePlazaBootstrap(p);
      const snap = await db.collection('mapa_config').doc(p).collection('estructura').orderBy('orden').get();
      if (!snap.empty) return snap.docs.map(d => d.data());
      return _generarEstructuraPorDefecto();
    }
    // Fallback: colección legacy (documentos raíz cuyo ID empieza con "cel_")
    const legSnap = await db.collection(COL.MAPA_CFG).orderBy('orden').get();
    const legDocs = legSnap.docs.filter(d => d.id.startsWith('cel_'));
    if (legDocs.length > 0) return legDocs.map(d => d.data());
    return _generarEstructuraPorDefecto();
  },

  suscribirEstructuraMapa(callback, plaza) {
    const p = _normalizePlazaId(plaza);
    // [F1-B] mapa_config/{plazaId}/estructura/{cel}
    if (p) {
      _ensurePlazaBootstrap(p).catch(err => console.warn("No se pudo bootstrapear la plaza:", p, err));
      return db.collection('mapa_config').doc(p).collection('estructura').orderBy('orden')
        .onSnapshot(snap => {
          callback(!snap.empty ? snap.docs.map(d => d.data()) : _generarEstructuraPorDefecto());
        }, err => console.error('onSnapshot mapa_cfg:', err));
    }
    // Sin plaza → suscribir legacy collection
    return db.collection(COL.MAPA_CFG).orderBy('orden').onSnapshot(snap => {
      const docs = snap.docs.filter(d => d.id.startsWith('cel_'));
      callback(docs.length > 0 ? docs.map(d => d.data()) : _generarEstructuraPorDefecto());
    }, err => console.error('onSnapshot mapa_cfg (legacy):', err));
  },

  async guardarEstructuraMapa(elementos, plaza) {
    if (!plaza) throw new Error('Plaza requerida para guardar estructura del mapa');
    const p = plaza.toUpperCase().trim();
    const ref = db.collection('mapa_config').doc(p).collection('estructura'); // [F1-B]
    // 1. Borrar todos los documentos actuales
    const snap = await ref.get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    // 2. Insertar nueva estructura en lotes de 490
    // [F2] Persiste x,y,width,height,rotation junto a valor/tipo/orden
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
          x:        el.x        ?? 0,        // [F2]
          y:        el.y        ?? 0,        // [F2]
          width:    el.width    ?? 120,      // [F2]
          height:   el.height   ?? 80,       // [F2]
          rotation: el.rotation ?? 0,        // [F2]
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
    await _registrarLog('SISTEMA', `🗺️ Estructura del mapa (${p}) actualizada`, 'Sistema', p); // [F1]
    return 'OK';
  },

  // ─── MODIFICACIONES ──────────────────────────────────────
  async aplicarEstado(mva, estado, ubi, gas, notasFormulario, borrarNotas, nombreAutor, responsableSesion, plaza) {
    const mvaStr = mva.toString().trim().toUpperCase();
    const plazaUp = _normalizePlazaId(plaza);

    let docRef = null, actual = null;

    // [F1] Buscar en colecciones planas filtrando por plaza y mva
    if (plazaUp) {
      let snap = await db.collection(COL.CUADRE).where('plaza', '==', plazaUp).where('mva', '==', mvaStr).limit(1).get(); // [F1]
      if (!snap.empty) { docRef = snap.docs[0].ref; actual = snap.docs[0].data(); }
      if (!docRef) {
        snap = await db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp).where('mva', '==', mvaStr).limit(1).get(); // [F1]
        if (!snap.empty) { docRef = snap.docs[0].ref; actual = snap.docs[0].data(); }
      }
    }
    // Fallback: buscar respetando plaza (solo encuentra docs legacy sin campo plaza de otra plaza)
    if (!docRef) {
      const found = await _buscarUnidadEnSubcol(mvaStr, plazaUp);
      if (!found) return "ERROR: MVA no encontrado";
      docRef = found.ref;
      actual = found.data;
    }
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

    // Si el doc no tiene plaza (legacy), stampearla ahora
    const updatePayload = { gasolina: gas, estado, ubicacion: ubi, notas: notaFinal, _updatedAt: ahora, _updatedBy: responsableSesion || nombreAutor };
    if (plazaUp && !actual.plaza) updatePayload.plaza = plazaUp;
    await docRef.update(updatePayload);
    await _actualizarFeed(`${mvaStr} ➜ ${estado} (${ubi})`, responsableSesion, plazaUp); // [F1]

    // Registrar SOLO los cambios reales (no mostrar campos sin cambio)
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
    await _registrarLog("MODIF", logMsg, responsableSesion, plazaUp); // [F1] incluye plaza en log
    return "EXITO";
  },

  // ── F7  Extras por unidad (tags, recordatorios, notas rápidas) ──────────
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

  async insertarUnidadDesdeHTML(objeto) {
    const mvaStr = objeto.mva.toString().trim().toUpperCase();
    const docId  = _mvaToDocId(mvaStr);
    const plazaUp = (objeto.plaza || '').toUpperCase().trim(); // [F1]

    // Verificar duplicado solo dentro de la misma plaza
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
      plaza:        plazaUp || null, // [F1] siempre inyectar campo plaza
      fechaIngreso: new Date().toISOString(),
      _createdAt:   ahora,
      _createdBy:   objeto.responsableSesion || "Sistema"
    };

    // [F1] Escribir siempre en colección raíz con docId sanitizado
    await db.collection(COL.CUADRE).doc(docId).set(unitData); // [F1]

    await _actualizarFeed(`IN: ${mvaStr} (${indexData.modelo || objeto.modelo})`, objeto.responsableSesion, plazaUp); // [F1]
    await _registrarLog("IN", `📥 INSERTADO: ${mvaStr}`, objeto.responsableSesion, plazaUp); // [F1]
    return `EXITO|${indexData.modelo || objeto.modelo}|${indexData.placas || objeto.placas}`;
  },

  async insertarUnidadExterna(objeto) {
    const mvaStr  = objeto.mva.toString().trim().toUpperCase();
    const docId   = _mvaToDocId(mvaStr);
    const plazaUp = (objeto.plaza || '').toUpperCase().trim(); // [F1]

    // Verificar duplicado solo dentro de la misma plaza
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
      plaza:        plazaUp || null, // [F1] siempre inyectar campo plaza
      tipo:         "externo",
      fechaIngreso: new Date().toISOString(),
      _createdAt:   ahora,
      _createdBy:   objeto.responsableSesion || "Sistema"
    };

    // [F1] Escribir siempre en colección raíz con docId sanitizado
    await db.collection(COL.EXTERNOS).doc(docId).set(unitData); // [F1]

    await _actualizarFeed(`EXT IN: ${mvaStr} (${objeto.modelo || 'S/M'})`, objeto.responsableSesion, plazaUp); // [F1]
    await _registrarLog("IN", `🚗 EXTERNO INSERTADO: ${mvaStr}`, objeto.responsableSesion, plazaUp); // [F1]
    return `EXITO|${objeto.modelo || 'S/M'}|${objeto.placas || 'S/P'}`;
  },

  async ejecutarEliminacion(listaMvas, responsableSesion, plaza) {
    const plazaUp = _normalizePlazaId(plaza);
    for (const mva of listaMvas) {
      const mvaStr = mva.toString().trim().toUpperCase();
      let eliminado = false;

      // [F1] Buscar en colecciones planas filtrando por plaza y mva
      if (plazaUp) {
        let snap = await db.collection(COL.CUADRE).where('plaza', '==', plazaUp).where('mva', '==', mvaStr).limit(1).get(); // [F1]
        if (!snap.empty) { await snap.docs[0].ref.delete(); eliminado = true; }
        snap = await db.collection(COL.EXTERNOS).where('plaza', '==', plazaUp).where('mva', '==', mvaStr).limit(1).get(); // [F1]
        if (!snap.empty) { await snap.docs[0].ref.delete(); eliminado = true; }
      }

      // Fallback: solo docs legacy sin campo plaza (o misma plaza)
      if (!eliminado) {
        const found = await _buscarUnidadEnSubcol(mvaStr, plazaUp);
        if (found) { await found.ref.delete(); eliminado = true; }
      }

      if (eliminado) {
        await _actualizarFeed(`BAJA: ${mvaStr}`, responsableSesion, plazaUp); // [F1]
        await _registrarLog("BAJA", `🗑️ SE ELIMINÓ LA UNIDAD: ${mvaStr}`, responsableSesion, plazaUp); // [F1]
      }
    }
    return "EXITO";
  },

  async guardarNuevasPosiciones(reporte, usuarioResponsable, plaza, extra = {}) {
    const plazaUp = _normalizePlazaId(plaza);
    const batch = db.batch();
    const histBatch = [];

    // [PERF] Cargar TODOS los docs de la plaza de una sola vez (2 queries en paralelo)
    // en lugar de 2 queries secuenciales por cada unidad del reporte.
    const unitMap = {}; // mva → { ref, data, hoja }
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

      // Fallback a subcollections si no se encontró en colecciones planas
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
          batch.set(found.ref, { pos: posNueva }, { merge: true });
          histBatch.push({ mva: mvaStr, hoja: found.hoja, posAnterior, posNueva });
        }
      }
    }
    if (!histBatch.length) return true;

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
        timestamp: ts,
        fecha: _now(),
        tipo,
        mva: h.mva,
        hoja: h.hoja,
        posAnterior: h.posAnterior,
        posNueva: h.posNueva,
        autor: usuarioResponsable || "Sistema",
        plaza: plazaUp || ""
      };
      if (auditExtra.locationStatus) payload.locationStatus = auditExtra.locationStatus;
      if (auditExtra.exactLocation) payload.exactLocation = auditExtra.exactLocation;
      if (auditExtra.ipAddress) payload.ipAddress = auditExtra.ipAddress;
      if (auditExtra.forwardedFor) payload.forwardedFor = auditExtra.forwardedFor;
      return db.collection("historial_patio").doc(`${tipo.toLowerCase()}_${i}_${ts}`).set(payload);
    });

    Promise.allSettled(historialWrites).then(results => {
      const errores = results.filter(r => r.status === 'rejected');
      if (errores.length) {
        console.warn(`[guardarNuevasPosiciones] ${errores.length} registros de historial no se pudieron guardar.`);
      }
    });

    return true;
  },

  // ─── TABLA DE FLOTA ───────────────────────────────────────
  async obtenerUnidadesVeloz(plaza) {
    const plazaUp = _normalizePlazaId(plaza);
    // [F1.4] Filtrar por plaza en la query cuando sea posible
    const [cuadre, externos, index] = await Promise.all([
      plazaUp ? db.collection(COL.CUADRE).where('plaza','==',plazaUp).get() : db.collection(COL.CUADRE).get(),
      plazaUp ? db.collection(COL.EXTERNOS).where('plaza','==',plazaUp).get() : db.collection(COL.EXTERNOS).get(),
      db.collection(COL.INDEX).get()
    ]);
    const lista = [];
    const vistos = new Set();
    [...cuadre.docs, ...externos.docs].forEach(d => {
      const u = d.data();
      if (!u.mva || vistos.has(u.mva) || !_matchesPlaza(u, plazaUp)) return;
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
    // [F1.4] Filtrar por plaza en la query cuando sea posible
    const ORDEN = { "LISTO":1,"SUCIO":2,"MANTENIMIENTO":3,"RESGUARDO":4,"TRASLADO":5,"NO ARRENDABLE":6,"RETENIDA":92,"VENTA":93 };
    const [cuadre, externos] = await Promise.all([
      plazaUp ? db.collection(COL.CUADRE).where('plaza','==',plazaUp).get() : db.collection(COL.CUADRE).get(),
      plazaUp ? db.collection(COL.EXTERNOS).where('plaza','==',plazaUp).get() : db.collection(COL.EXTERNOS).get(),
    ]);
    const lista = [
      ...cuadre.docs.map(d => ({ id: d.id, fila: d.id, ...d.data() })).filter(u => u.mva),
      ...externos.docs.map(d => ({ id: d.id, fila: d.id, ...d.data(), ubicacion: "EXTERNO" })).filter(u => u.mva)
    ].filter(u => _matchesPlaza(u, plazaUp));
    lista.forEach(u => { u.orden = ORDEN[(u.estado || "").toUpperCase()] || 99; });
    lista.sort((a, b) => (a.orden - b.orden) || (a.mva || "").localeCompare(b.mva || ""));
    return lista;
  },

  async obtenerCuadreAdminsData(plaza) {
    const plazaUp = _normalizePlazaId(plaza);
    // [F1] Colección plana cuadre_admins filtrada por plaza
    let snap;
    // [F1.4] Filtrar por plaza en la query cuando sea posible
    snap = plazaUp
      ? await db.collection(COL.CUADRE_ADM).where('plaza','==',plazaUp).orderBy("_createdAt", "desc").get()
      : await db.collection(COL.CUADRE_ADM).orderBy("_createdAt", "desc").get();
    const allDocs = snap.docs.filter(d => _matchesPlaza(d.data(), plazaUp));
    return Promise.all(allDocs.map(d => _normalizeCuadreAdminRecord(d.id, d.data())));
  },

  async procesarModificacionMaestra(datos, tipoAccion) {
    try {
      const actor = _sanitizeText(datos.adminResponsable || datos._updatedBy || datos._createdBy || datos.autor) || "Sistema";
      const mva = _sanitizeText(datos.mva).toUpperCase();
      const manualEvidence = _normalizeEvidenceItems(datos.evidencias || []);
      const evidenceFiles = datos.evidenceFiles || [];

      if (tipoAccion === "ADD" || tipoAccion === "INSERTAR") {
        if (!mva) return "ERROR: Falta la unidad (MVA) para registrar en Cuadre Admins.";

        const payload = _buildCuadreAdminPayload({
          ...datos, mva, _createdAt: _now(), _createdBy: actor
        }, manualEvidence);
        if (!payload.plaza) return "ERROR: Falta la plaza operativa para registrar en Cuadre Admins.";
        const plazaUp = _normalizePlazaId(payload.plaza);
        const docResolution = await _resolveCuadreAdminDocId(mva, plazaUp);
        if (docResolution.duplicate) return `DUPLICADO: La unidad ${mva} ya está registrada en Cuadre Admins para la plaza ${plazaUp}.`;

        const newRef = db.collection(COL.CUADRE_ADM).doc(docResolution.docId);
        const uploadedEvidence = await _uploadAdminEvidenceFiles(evidenceFiles, newRef.id, actor);
        const finalPayload = _buildCuadreAdminPayload({
          ...datos, mva, _createdAt: _now(), _createdBy: actor
        }, [...manualEvidence, ...uploadedEvidence]);
        await newRef.set(finalPayload); // [F1]

      } else if (tipoAccion === "MODIFICAR") {
        if (!datos.fila) return "ERROR: Sin ID de fila";

        // [F1] Buscar directamente en colección plana por doc ID
        const ref = db.collection(COL.CUADRE_ADM).doc(datos.fila); // [F1]
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
        await ref.set(payload, { merge: true }); // [F1]

      } else if (tipoAccion === "ELIMINAR") {
        if (!datos.fila) return "ERROR: Sin ID de fila";

        // [F1] Eliminar directamente por doc ID en colección plana
        const ref = db.collection(COL.CUADRE_ADM).doc(datos.fila); // [F1]
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
    // [F1] Colección plana cuadre raíz
    const conteo = { LISTO: 0, SUCIO: 0, MANTENIMIENTO: 0, total: 0 };
    const snap = await db.collection(COL.CUADRE).get(); // [F1]
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
  async checarNotificaciones(usuarioActivo, plaza) {
    const [settings, globalSettings, alertasSnap, msgsSnap, notasSnap] = await Promise.all([
      _getSettings(plaza), // [F1] settings por plaza
      _getSettings('GLOBAL'),
      db.collection(COL.ALERTAS).orderBy("timestamp", "desc").limit(50).get(),
      db.collection(COL.MENSAJES).where("destinatario", "==", usuarioActivo.toUpperCase()).get(),
      db.collection(COL.NOTAS).where("estado", "==", "PENDIENTE").get()
    ]);
    const alertas = alertasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(a => !_alertReadByUser(a, usuarioActivo))
      .filter(a => _alertMatchesUser(a, usuarioActivo));
    const mensajesSinLeer = msgsSnap.docs.filter(d => d.data().leido !== "SI").length;
    let liveFeed = settings.liveFeed || [];
    if (typeof liveFeed === "string") { try { liveFeed = JSON.parse(liveFeed); } catch { liveFeed = []; } }
    if (!Array.isArray(liveFeed)) liveFeed = [];
    const lockState = _resolverEstadoBloqueoMapa(settings, globalSettings);
    return {
      incidenciasPendientes: notasSnap.size, alertas, mensajesSinLeer,
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
    await _setSettings({ liveFeed: JSON.stringify([]) }, plaza); // [F1]
    return "OK";
  },

  async actualizarFeedSettings(accion, autor, plaza) {
    await _actualizarFeed(accion, autor, plaza); // [F1]
    return "OK";
  },

  // ─── ALERTAS ─────────────────────────────────────────────
  async emitirNuevaAlertaMaestra(tipo, titulo, mensaje, imagen, autor, destinatarios, modo, meta = {}) {
    const destinatariosNormalizados = _serializeAlertCsv(destinatarios);
    const actor = _sanitizeText(autor) || "Sistema";
    const tipoNormalizado = _normalizeAlertType(tipo);
    const authorMeta = _normalizeAlertAuthor(meta.author || {}, actor);
    const banner = _normalizeAlertBanner(meta.banner || {}, tipoNormalizado);
    await db.collection(COL.ALERTAS).add({
      timestamp: _ts(),
      fecha: _now(),
      actor,
      autor: authorMeta.visible,
      authorMode: authorMeta.mode,
      authorValue: authorMeta.value,
      tipo: tipoNormalizado,
      banner,
      titulo: _sanitizeText(titulo),
      mensaje: String(mensaje || "").trim(),
      imagen: String(imagen || "").trim(),
      leidoPor: "",
      destinatarios: destinatariosNormalizados,
      destMode: _normalizeAlertDestMode(meta.destMode, destinatariosNormalizados),
      modo: _normalizeAlertMode(modo),
      cta: _normalizeAlertCta(meta.cta),
      version: 1
    });
    await _registrarEventoGestion("ALERTA_EMITIDA", `Emitió alerta maestra "${titulo}" (${tipo})`, autor, {
      entidad: "ALERTAS",
      referencia: titulo || ""
    });
    return "EXITO";
  },
  async marcarAlertaComoLeida(idAlerta, usuarioActivo) {
    const ref = db.collection(COL.ALERTAS).doc(idAlerta);
    const snap = await ref.get();
    if (!snap.exists) return "ERROR";
    const lectores = _splitAlertCsv(snap.data().leidoPor);
    const usuario = String(usuarioActivo || "").trim().toUpperCase();
    if (!usuario) return "ERROR";
    if (!lectores.includes(usuario)) lectores.push(usuario);
    await ref.update({ leidoPor: lectores.join(", ") });
    return "OK";
  },
  async actualizarAlertaMaestra(idAlerta, cambios = {}, actor = "Sistema") {
    const ref = db.collection(COL.ALERTAS).doc(idAlerta);
    const snap = await ref.get();
    if (!snap.exists) return "ERROR: Alerta no encontrada";

    const actual = snap.data() || {};
    const destinatarios = _serializeAlertCsv(cambios.destinatarios || actual.destinatarios || "GLOBAL");
    const tipo = _normalizeAlertType(cambios.tipo || actual.tipo);
    const titulo = _sanitizeText(cambios.titulo || actual.titulo);
    const mensaje = String(cambios.mensaje ?? actual.mensaje ?? "").trim();
    const imagen = String(cambios.imagen ?? actual.imagen ?? "").trim();
    const modo = _normalizeAlertMode(cambios.modo || actual.modo);
    const destMode = _normalizeAlertDestMode(cambios.destMode || actual.destMode, destinatarios);
    const cta = _normalizeAlertCta(cambios.cta || actual.cta || {});
    const authorMeta = _normalizeAlertAuthor(
      cambios.author || {
        mode: actual.authorMode || actual.autorModo || actual.author?.mode || "",
        value: actual.authorValue || actual.autorValor || actual.author?.value || actual.autor || ""
      },
      actor
    );
    const banner = _normalizeAlertBanner(cambios.banner || actual.banner || {}, tipo);
    const ahora = _now();
    const nuevoTimestamp = _ts();

    await ref.update({
      timestamp: nuevoTimestamp,
      fecha: ahora,
      actor: _sanitizeText(actor) || "Sistema",
      autor: authorMeta.visible,
      authorMode: authorMeta.mode,
      authorValue: authorMeta.value,
      tipo,
      banner,
      titulo,
      mensaje,
      imagen,
      destinatarios,
      destMode,
      modo,
      cta,
      leidoPor: "",
      editadoPor: _sanitizeText(actor) || "Sistema",
      editadoEn: ahora,
      version: Number(actual.version || 1) + 1
    });

    await _registrarEventoGestion("ALERTA_EDITADA", `Editó alerta maestra "${titulo}" (${tipo})`, actor, {
      entidad: "ALERTAS",
      referencia: idAlerta,
      detalles: `Modo ${modo} · Destino ${destMode}`
    });
    return "EXITO";
  },
  async obtenerTodasLasAlertas() {
    const snap = await db.collection(COL.ALERTAS).orderBy("timestamp", "desc").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async eliminarAlertaMaestraBackend(idAlerta, actor = "Sistema") {
    const ref = db.collection(COL.ALERTAS).doc(idAlerta);
    const snap = await ref.get();
    const titulo = snap.exists ? (snap.data().titulo || idAlerta) : idAlerta;
    const autorOriginal = snap.exists ? (snap.data().autor || "") : "";
    await ref.delete();
    await _registrarEventoGestion("ALERTA_ELIMINADA", `Eliminó alerta maestra "${titulo}"`, actor || "Sistema", {
      entidad: "ALERTAS",
      referencia: idAlerta,
      detalles: autorOriginal ? `Alerta creada originalmente por ${autorOriginal}` : ""
    });
    return "EXITO";
  },

  async obtenerPlantillasAlerta() {
    const snap = await db.collection(COL.PLANTILLAS_ALERTAS).orderBy("nombre").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  
  async guardarPlantillaAlerta(nombre, tipo, titulo, mensaje, modo, autor, meta = {}) {
    try {
      const tipoNormalizado = _normalizeAlertType(tipo);
      const authorMeta = _normalizeAlertAuthor(meta.author || {}, autor);
      await db.collection(COL.PLANTILLAS_ALERTAS).add({
        nombre,
        tipo: tipoNormalizado,
        titulo,
        mensaje,
        modo,
        autor,
        authorMode: authorMeta.mode,
        authorValue: authorMeta.value,
        banner: _normalizeAlertBanner(meta.banner || {}, tipoNormalizado),
        imagen: String(meta.imagen || "").trim(),
        cta: _normalizeAlertCta(meta.cta),
        timestamp: _ts(),
        fecha: _now()
      });
      return "EXITO";
    } catch(e) { return "ERROR: " + e.message; }
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
  async enviarMensajePrivado(remitente, destinatario, texto, archivoUrl = null, archivoNombre = null, replyTo = null) {
    const ts = _ts();
    const id = `msg_${ts}_${Math.floor(Math.random() * 1000)}`;
    const payload = { timestamp: ts, fecha: _now(), remitente: remitente.trim().toUpperCase(), destinatario: destinatario.trim().toUpperCase(), mensaje: texto || "", leido: "NO" };
    if (archivoUrl)  { payload.archivoUrl = archivoUrl; payload.archivoNombre = archivoNombre; }
    if (replyTo)     { payload.replyTo = { id: replyTo.id, remitente: replyTo.remitente, mensaje: replyTo.mensaje }; }
    await db.collection(COL.MENSAJES).doc(id).set(payload);
    return "EXITO";
  },
  async actualizarReaccionesChatDb(msgId, reacciones) {
    await db.collection(COL.MENSAJES).doc(msgId).update({ reacciones });
    return "OK";
  },
  async marcarMensajesLeidosArray(idsArray) {
    const batch = db.batch();
    for (const id of idsArray) batch.update(db.collection(COL.MENSAJES).doc(id.toString()), { leido: "SI" });
    await batch.commit();
    return "OK";
  },
  async editarMensajeChatDb(idStr, nuevoTexto) {
    await db.collection(COL.MENSAJES).doc(idStr).update({ mensaje: nuevoTexto });
    return "OK";
  },
  async eliminarMensajeChatDb(idStr) {
    const ref = db.collection(COL.MENSAJES).doc(idStr);
    const snap = await ref.get();
    if(snap.exists && snap.data().archivoUrl) {
      try {
         const storageRef = firebase.storage().refFromURL(snap.data().archivoUrl);
         await storageRef.delete();
      } catch(e) { console.warn("Could not delete associated chat file", e); }
    }
    await ref.delete();
    return "OK";
  },

  // ─── NOTAS ───────────────────────────────────────────────
  async obtenerTodasLasNotas(plaza) {
    const plazaUp = _normalizePlazaId(plaza);
    const snap = await db.collection(COL.NOTAS).orderBy("timestamp", "desc").get();
    const docs = snap.docs.filter(d => _matchesPlaza(d.data(), plazaUp));
    return docs.map(d => _normalizeIncidentRecord(d.id, d.data()));
  },
  suscribirNotasAdmin(callback, plaza) {
    const plazaUp = _normalizePlazaId(plaza);
    return db.collection(COL.NOTAS).orderBy("timestamp", "desc").onSnapshot(snap => {
      const docs = snap.docs.filter(d => _matchesPlaza(d.data(), plazaUp));
      callback(docs.map(d => _normalizeIncidentRecord(d.id, d.data())));
    }, err => console.error("onSnapshot notas_admin:", err));
  },
  async guardarNuevaNotaDirecto(nota, autor) {
    const ts = _ts();
    const id = ts.toString();
    const payloadEntrada = typeof nota === "object" && nota !== null
      ? { ...nota }
      : { descripcion: String(nota || "") };
    const actor = _sanitizeText(payloadEntrada.autor || autor) || "Sistema";
    const archivosNuevos = Array.from(payloadEntrada.archivos || payloadEntrada.files || []);
    const adjuntosManual = _normalizeEvidenceItems(payloadEntrada.adjuntos || payloadEntrada.attachments || []);
    const adjuntosSubidos = archivosNuevos.length
      ? await _uploadIncidentAttachments(archivosNuevos, id, actor)
      : [];

    const plazaNotaUp = (payloadEntrada.plaza || '').toUpperCase().trim();
    const payload = _buildIncidentPayload({
      ...payloadEntrada,
      fecha: _now(),
      estado: "PENDIENTE",
      quienResolvio: "",
      solucion: "",
      resueltaEn: ""
    }, actor, [...adjuntosManual, ...adjuntosSubidos], ts);
    if (plazaNotaUp) payload.plaza = plazaNotaUp;

    await db.collection(COL.NOTAS).doc(id).set(payload);
    return "OK";
  },
  async resolverNotaDirecto(idNota, solucion, autor) {
    const idStr = idNota.toString();
    const ref = db.collection(COL.NOTAS).doc(idStr);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.update({
        quienResolvio: _sanitizeText(autor) || "Sistema",
        estado: "RESUELTA",
        solucion: _sanitizeText(solucion),
        resueltaEn: _now(),
        version: Number((snap.data() || {}).version || 1) + 1
      });
      return "OK";
    }
    const ts = parseInt(idStr);
    if (!isNaN(ts)) {
      const q = await db.collection(COL.NOTAS).where("timestamp", "==", ts).limit(1).get();
      if (!q.empty) {
        const actual = q.docs[0].data() || {};
        await q.docs[0].ref.update({
          quienResolvio: _sanitizeText(autor) || "Sistema",
          estado: "RESUELTA",
          solucion: _sanitizeText(solucion),
          resueltaEn: _now(),
          version: Number(actual.version || 1) + 1
        });
        return "OK";
      }
    }
    return "ERROR: Nota no encontrada";
  },
  async eliminarNotaDirecto(idNota) {
    const idStr = idNota.toString();
    const ref = db.collection(COL.NOTAS).doc(idStr);
    const snap = await ref.get();
    if (snap.exists) {
      await _deleteEvidenceFiles(_normalizeIncidentAttachments(snap.data()));
      await ref.delete();
      return "OK";
    }
    const ts = parseInt(idStr);
    if (!isNaN(ts)) {
      const q = await db.collection(COL.NOTAS).where("timestamp", "==", ts).limit(1).get();
      if (!q.empty) {
        await _deleteEvidenceFiles(_normalizeIncidentAttachments(q.docs[0].data()));
        await q.docs[0].ref.delete();
        return "OK";
      }
    }
    return "ERROR: Nota no encontrada";
  },

  // ─── RESUMEN FLOTA ──────────────────────────────────────
  async obtenerResumenFlotaPatio(plaza) {
    const plazaUp = _normalizePlazaId(plaza);
    // [F1.4] Filtrar por plaza en la query cuando sea posible
    const [cuadreSnap, externosSnap] = await Promise.all([
      plazaUp ? db.collection(COL.CUADRE).where('plaza','==',plazaUp).get() : db.collection(COL.CUADRE).get(),
      plazaUp ? db.collection(COL.EXTERNOS).where('plaza','==',plazaUp).get() : db.collection(COL.EXTERNOS).get(),
    ]);
    const cuadreUnits = cuadreSnap.docs
      .map(d => ({ ...d.data() }))
      .filter(u => u.mva && _matchesPlaza(u, plazaUp));
    const externosUnits = externosSnap.docs
      .map(d => ({ ...d.data(), ubicacion: "EXTERNO" }))
      .filter(u => u.mva && _matchesPlaza(u, plazaUp));

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
  // Lee de historial_patio: movimientos de cajón (MOVE / SWAP / DEL)
  async obtenerHistorialLogs() {
    const snap = await db.collection("historial_patio").orderBy("timestamp", "desc").limit(500).get();
    return snap.docs.map(d => {
      const data = d.data();
      return {
        fecha:    _fecha(data),
        tipo:     String(data.tipo || "MOVE").toUpperCase(),
        accion:   `${data.mva || ""} ${data.hoja || ""} ${data.posAnterior || ""} → ${data.posNueva || ""}`.trim(),
        mva:      data.mva || "",
        detalles:  `${data.posAnterior || ""} → ${data.posNueva || ""}`,
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
        usuario:  data.autor || "",
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
async guardarNuevoUsuarioAuth(nombre, email, password, roleOrIsAdmin, telefono, plazaOrIsGlobal, plazasPermitidas) {
    try {
      const emailNormalizado = _profileDocId(email);
      const rol = _resolveRoleForEmail(emailNormalizado, _inferRole(roleOrIsAdmin, plazaOrIsGlobal));
      const roleData = _normalizeUserRoleData({
        rol,
        plazaAsignada: typeof roleOrIsAdmin === "string" ? plazaOrIsGlobal : ""
      });
      // 1. Creamos un hilo secundario fantasma para no interrumpir tu sesión actual
      const appSecundaria = firebase.initializeApp(FIREBASE_CONFIG, "AppRegistro_" + Date.now());

      // 2. Registramos la cuenta real con tokens en Firebase Auth
      const credencial = await appSecundaria.auth().createUserWithEmailAndPassword(email, password);
      const nuevoUid = credencial.user.uid;

      // Perfil extra: plazasPermitidas para JEFE_REGIONAL
      const perfilExtra = {};
      if (Array.isArray(plazasPermitidas) && plazasPermitidas.length > 0) {
        perfilExtra.plazasPermitidas = plazasPermitidas;
      }

      // 3. Guardamos su perfil con el correo como ID estable del documento
      const docId = await _guardarPerfilUsuarioPorEmail(emailNormalizado, {
        nombre: nombre.trim().toUpperCase(),
        email: emailNormalizado,
        telefono: telefono || "",
        ...roleData,
        ...perfilExtra,
        authUid: nuevoUid,
        status: "ACTIVO"
      });

      // Limpia un posible documento legacy con UID para evitar duplicados raros.
      if (nuevoUid && nuevoUid !== docId) {
        const legacyRef = db.collection(COL.USERS).doc(nuevoUid);
        const legacySnap = await legacyRef.get();
        if (legacySnap.exists) await legacyRef.delete();
      }

      // 4. Destruimos el hilo secundario
      await appSecundaria.auth().signOut();
      await appSecundaria.delete();

      return "EXITO";
    } catch (error) {
      return "ERROR: " + error.message;
    }
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
    }, plaza); // [F1]
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

  // ─── CUADRE V3 ───────────────────────────────────────────
  async iniciarProtocoloDesdeAdmin(nombreAdmin, jsonMision, plaza) {
    await _setSettings({
      estadoCuadreV3: "PROCESO",
      adminIniciador: nombreAdmin,
      misionAuditoria: jsonMision,
      datosAuditoria: "[]",
      ultimaModificacion: _now(),
      ultimoEditor: nombreAdmin || "Sistema"
    }, plaza); // [F1]
    return "EXITO";
  },
  async obtenerMisionAuditoria(plaza) {
    const settings = await _getSettings(plaza); // [F1]
    try { return JSON.parse(settings.misionAuditoria || "[]"); } catch { return []; }
  },
  async obtenerRevisionAuditoria(plaza) {
    const settings = await _getSettings(plaza); // [F1]
    try { return JSON.parse(settings.datosAuditoria || "[]"); } catch { return []; }
  },
  async guardarAuditoriaCruzada(datosAuditoria, autor, plaza) {
    const plazaUp = _normalizePlazaId(plaza);
    await _setSettings({
      estadoCuadreV3: "REVISION",
      datosAuditoria: JSON.stringify(datosAuditoria),
      ultimaModificacion: _now(),
      ultimoEditor: autor || "Sistema"
    }, plazaUp); // [F1]
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
    }, plaza); // [F1]
    return "CUADRE FINALIZADO CON ÉXITO";
  },
  async registrarCierreCuadre(autor, plaza) {
    await _setSettings({ ultimoCuadreTexto: `${autor} (${_now()})` }, plaza); // [F1]
    await _registrarLog("CUADRE", `✅ CUADRE CERRADO POR ${autor}`, autor, plaza); // [F1]
    return "OK";
  },
  async marcarUltimaModificacion(autor, plaza) {
    await _setSettings({ ultimaModificacion: _now(), ultimoEditor: autor }, plaza); // [F1]
    return "OK";
  },
  async obtenerHistorialCuadres(plaza) {
    const plazaUp = _normalizePlazaId(plaza);
    // [F1] Colección plana historial_cuadres filtrada por campo plaza
    let snap;
    // [F1] Filtro client-side para evitar índice compuesto plaza+timestamp
    snap = await db.collection(COL.HISTORIAL_CUADRES).orderBy("timestamp", "desc").limit(200).get();
    const filtrados = snap.docs.filter(d => _matchesPlaza(d.data(), plazaUp)).slice(0, 30);
    snap = { docs: filtrados };
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
        pdfUrl:    data.pdfUrl || data.jsonCompleto || "",
        plaza:     data.plaza || plazaUp || ""
      };
    });
  },

  // ─── CONFIGURACIÓN GLOBAL ────────────────────────────────
  // Fase 4: ubicaciones se guardan por plaza en configuracion/{plaza}
  // El resto (estados, gasolinas, categorias, modelos) sigue en configuracion/listas (global)
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

    // Si la plaza tiene sus propias ubicaciones, úsalas; si no, cae al campo global
    let ubicaciones = globalListas.ubicaciones || [];
    if (snapPlaza && snapPlaza.exists && Array.isArray(snapPlaza.data().ubicaciones)) {
      ubicaciones = snapPlaza.data().ubicaciones;
    } else if (plazaUp && Array.isArray(globalListas.ubicaciones)) {
      // Migración suave: filtrar las del global que correspondan a esta plaza
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

    // Siempre guarda los catálogos globales (sin ubicaciones) en /listas
    await db.collection(COL.CONFIG).doc("listas").set(globalRest, { merge: true });

    // Si hay plaza activa, guarda las ubicaciones en el doc de esa plaza
    if (plazaUp && Array.isArray(ubicaciones)) {
      await _ensurePlazaBootstrap(plazaUp);
      await _configPlazaRef(plazaUp).set({
        ubicaciones: ubicaciones
          .map(item => _normalizePlazaLocationItem(item, plazaUp))
          .filter(Boolean)
      }, { merge: true });
    } else if (Array.isArray(ubicaciones)) {
      // Sin plaza → escribe en global (retrocompat)
      await db.collection(COL.CONFIG).doc("listas").set({ ubicaciones }, { merge: true });
    }

    await _registrarLog("SISTEMA", "⚙️ Modificó los catálogos del sistema", autor || "Admin Global");
    await _registrarEventoGestion("CONFIG_GLOBAL", "Publicó cambios en catálogos globales", autor || "Admin Global", {
      entidad: "CONFIGURACION",
      referencia: "listas"
    });
    return "EXITO";
  },

  async garantizarPlazasOperativas(plazas = []) {
    const lista = Array.isArray(plazas) ? plazas.map(_normalizePlazaId).filter(Boolean) : [];
    for (const plaza of lista) {
      await _ensurePlazaBootstrap(plaza);
    }
    return "EXITO";
  },

  async procesarAuditoriaDesdeAdmin(auditList, autorAdmin, stats, plaza) {
    const plazaUp = (plaza || stats?.plaza || '').toUpperCase().trim();
    await _registrarLog("CUADRE", `✅ CUADRE VALIDADO - ${stats?.ok || 0} OK / ${stats?.faltantes || 0} FALTAN`, autorAdmin, plazaUp); // [F1]
    const registro = {
      timestamp: _ts(), fecha: _now(),
      auxiliar:  stats?.auxiliar || "",
      admin:     autorAdmin,
      ok:        stats?.ok || 0,
      faltantes: stats?.faltantes || 0,
      sobrantes: stats?.sobrantes || 0,
      plaza:     plazaUp || "", // [F1] campo plaza siempre presente
      pdfUrl:    ""
    };
    // [F1] Colección plana historial_cuadres con .add() — Firestore genera ID
    await db.collection(COL.HISTORIAL_CUADRES).add(registro); // [F1]
    await _setSettings({
      estadoCuadreV3: "LIBRE",
      adminIniciador: "",
      misionAuditoria: "[]",
      datosAuditoria: "[]",
      ultimaModificacion: _now(),
      ultimoEditor: autorAdmin || "Sistema"
    }, plazaUp); // [F1]
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
    // [F1] Busca estado operativo en colección plana cuadre/externos por campo mva
    let cuadreData = {};
    const found = await _buscarUnidadEnSubcol(mvaStr); // [F1]
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
    const snap = await db.collection(COL.USERS).where("nombre", "==", nombre.trim().toUpperCase()).limit(1).get();
    if (snap.empty) return false;
    return _normalizeUserRoleData(snap.docs[0].data()).isAdmin === true;
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
  },

  // Inyectar campo `plaza` en docs legacy de cuadre/externos que no lo tengan.
  // Usa batch de 490. Infiere plaza de sucursal/plazaAsignada/plazaId del propio doc.
  async backfillPlazaEnUnidades(onProgress) {
    return backfillPlazaEnUnidades(onProgress);
  },
};

// ─── ESTRUCTURA POR DEFECTO DEL MAPA ────────────────────────
// [F2] Genera estructura con coordenadas absolutas x,y,width,height
function _generarEstructuraPorDefecto() {
  return [
    {
      valor: 'A1',
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      rotation: 0,
      tipo: 'cajon',
      esLabel: false,
      orden: 0
    }
  ];
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
