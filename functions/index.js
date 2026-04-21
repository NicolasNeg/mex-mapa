const admin = require("firebase-admin");
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const functions = require("firebase-functions/v1");
const nodemailer = require("nodemailer");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const HttpsError = functions.https.HttpsError;

const REGION = "us-central1";
const USERS_COL = "usuarios";
const SETTINGS_COL = "settings";
const CONFIG_COL = "configuracion";
const MAPA_COL = "mapa_config";
const OPS_EVENTS_COL = "ops_events";
const ERRORS_COL = "programmer_errors";
const JOBS_COL = "programmer_jobs";
const AUDIT_COL = "programmer_audit";
const ADMIN_AUDIT_COL = "bitacora_gestion";
const PROGRAMMER_ROLES = new Set(["PROGRAMADOR", "JEFE_OPERACION", "CORPORATIVO_USER"]);
const ADMIN_ROLES = new Set(["VENTAS", "SUPERVISOR", "JEFE_PATIO", "GERENTE_PLAZA", "JEFE_REGIONAL", "CORPORATIVO_USER", "PROGRAMADOR", "JEFE_OPERACION"]);
const BOOTSTRAP_PROGRAMMER_EMAILS = new Set(["angelarmentta@icloud.com"]);
const DEFAULT_ROLE_CAPABILITIES = Object.freeze({
  AUXILIAR: { use_programmer_console: false, operational_admin: false, view_exact_location_logs: false },
  VENTAS: { use_programmer_console: false, operational_admin: true, view_exact_location_logs: false },
  SUPERVISOR: { use_programmer_console: false, operational_admin: true, view_exact_location_logs: false },
  JEFE_PATIO: { use_programmer_console: false, operational_admin: true, view_exact_location_logs: false },
  GERENTE_PLAZA: { use_programmer_console: false, operational_admin: true, view_exact_location_logs: false },
  JEFE_REGIONAL: { use_programmer_console: false, operational_admin: true, view_exact_location_logs: false },
  CORPORATIVO_USER: { use_programmer_console: true, operational_admin: true, view_exact_location_logs: true },
  PROGRAMADOR: { use_programmer_console: true, operational_admin: true, view_exact_location_logs: true },
  JEFE_OPERACION: { use_programmer_console: true, operational_admin: true, view_exact_location_logs: true }
});
const DEVICE_PREF_DEFAULTS = Object.freeze({
  muteAll: false,
  directMessages: true,
  cuadreMissions: true,
  criticalAlerts: true
});

function nowMillis() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeString(value).toUpperCase();
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function normalizePlaza(value) {
  return normalizeUpper(value);
}

function safeCtorInstance(value, ctor) {
  return typeof ctor === "function" && value instanceof ctor;
}

function ctorName(value) {
  return normalizeString(value?.constructor?.name);
}

function isFirestoreTimestamp(value) {
  return Boolean(value) && (
    safeCtorInstance(value, admin.firestore.Timestamp)
    || (typeof value.toMillis === "function" && typeof value.toDate === "function")
  );
}

function isFirestoreGeoPoint(value) {
  return Boolean(value) && (
    safeCtorInstance(value, admin.firestore.GeoPoint)
    || (ctorName(value) === "GeoPoint" && Number.isFinite(value.latitude) && Number.isFinite(value.longitude))
  );
}

function isFirestoreDocumentReference(value) {
  return Boolean(value) && (
    safeCtorInstance(value, admin.firestore.DocumentReference)
    || (ctorName(value) === "DocumentReference" && typeof value.path === "string" && typeof value.get === "function")
  );
}

function isFirestoreBytes(value) {
  return Boolean(value) && (
    safeCtorInstance(value, admin.firestore.Bytes)
    || (ctorName(value) === "Bytes" && typeof value.toBase64 === "function")
  );
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFailedPreconditionError(error) {
  const code = error?.code;
  const message = normalizeString(error?.message || "");
  return code === 9
    || normalizeString(code).toLowerCase() === "failed-precondition"
    || message.includes("FAILED_PRECONDITION");
}

function sanitizePlainObject(value) {
  if (value == null) return value;
  if (isFirestoreTimestamp(value)) return value.toMillis();
  if (Array.isArray(value)) return value.map(sanitizePlainObject);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, inner]) => inner !== undefined)
        .map(([key, inner]) => [key, sanitizePlainObject(inner)])
    );
  }
  return value;
}

function normalizeFirestorePath(value) {
  return normalizeString(value)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/{2,}/g, "/");
}

function firestorePathSegments(path = "") {
  const normalized = normalizeFirestorePath(path);
  return normalized ? normalized.split("/").filter(Boolean) : [];
}

function isCollectionPath(path = "") {
  const segments = firestorePathSegments(path);
  return segments.length > 0 && segments.length % 2 === 1;
}

function isDocumentPath(path = "") {
  const segments = firestorePathSegments(path);
  return segments.length > 0 && segments.length % 2 === 0;
}

function requireCollectionPath(path, label = "collectionPath") {
  const normalized = normalizeFirestorePath(path);
  if (!isCollectionPath(normalized)) {
    throw new HttpsError("invalid-argument", `${label} debe apuntar a una colección válida.`);
  }
  return normalized;
}

function requireDocumentPath(path, label = "docPath") {
  const normalized = normalizeFirestorePath(path);
  if (!isDocumentPath(normalized)) {
    throw new HttpsError("invalid-argument", `${label} debe apuntar a un documento válido.`);
  }
  return normalized;
}

function collectionRefFromPath(path, label = "collectionPath") {
  const normalized = requireCollectionPath(path, label);
  const segments = firestorePathSegments(normalized);
  if (segments.length === 1) return db.collection(normalized);
  const parentDocPath = segments.slice(0, -1).join("/");
  const collectionId = segments[segments.length - 1];
  return db.doc(parentDocPath).collection(collectionId);
}

function documentRefFromPath(path, label = "docPath") {
  const normalized = requireDocumentPath(path, label);
  return db.doc(normalized);
}

function notificationKindLabel(eventType = "") {
  const type = normalizeLower(eventType);
  if (type === "message.created") return "Mensaje";
  if (type === "alert.critical.created") return "Alerta critica";
  if (type === "cuadre.assigned") return "Mision de cuadre";
  if (type === "cuadre.updated") return "Cuadre actualizado";
  if (type === "cuadre.review_ready") return "Revision de cuadre";
  if (type === "system.test.push") return "Prueba de notificacion";
  return "Notificacion";
}

function serializeFirestoreValue(value) {
  if (value == null) return value;
  if (value instanceof Date) {
    return { __type: "timestamp", ms: value.getTime(), iso: value.toISOString() };
  }
  if (isFirestoreTimestamp(value)) {
    return { __type: "timestamp", ms: value.toMillis(), iso: value.toDate().toISOString() };
  }
  if (isFirestoreGeoPoint(value)) {
    return {
      __type: "geopoint",
      latitude: value.latitude,
      longitude: value.longitude
    };
  }
  if (isFirestoreDocumentReference(value)) {
    return { __type: "reference", path: value.path };
  }
  if (isFirestoreBytes(value)) {
    return { __type: "bytes", base64: value.toBase64() };
  }
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, inner]) => inner !== undefined)
        .map(([key, inner]) => [key, serializeFirestoreValue(inner)])
    );
  }
  return value;
}

function reviveConsoleFirestoreValue(value) {
  if (Array.isArray(value)) return value.map(reviveConsoleFirestoreValue);
  if (value && typeof value === "object") {
    const type = normalizeLower(value.__type);
    if (type === "timestamp") {
      const numeric = Number(value.ms);
      if (Number.isFinite(numeric)) {
        return admin.firestore.Timestamp.fromMillis(numeric);
      }
      const parsed = Date.parse(normalizeString(value.iso));
      if (!Number.isNaN(parsed)) {
        return admin.firestore.Timestamp.fromMillis(parsed);
      }
    }
    if (type === "geopoint") {
      const latitude = Number(value.latitude);
      const longitude = Number(value.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return new admin.firestore.GeoPoint(latitude, longitude);
      }
    }
    if (type === "reference") {
      return db.doc(requireDocumentPath(value.path, "reference.path"));
    }
    if (type === "bytes") {
      const base64 = normalizeString(value.base64);
      if (base64) return admin.firestore.Bytes.fromBase64String(base64);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, reviveConsoleFirestoreValue(inner)])
    );
  }
  return value;
}

function buildDocumentPreview(data = {}) {
  return Object.entries(data || {})
    .slice(0, 4)
    .map(([key, raw]) => {
      const value = raw && typeof raw === "object"
        ? JSON.stringify(serializeFirestoreValue(raw))
        : String(raw ?? "");
      return `${key}: ${value.slice(0, 64)}`;
    })
    .join(" · ");
}

function snapshotDateLabel(value) {
  try {
    return value?.toDate?.().toISOString?.() || "";
  } catch (_) {
    return "";
  }
}

function serializeDocumentSummary(snap) {
  const data = snap.exists ? (snap.data() || {}) : {};
  return {
    id: snap.id,
    path: snap.ref.path,
    exists: snap.exists,
    fieldCount: Object.keys(data).length,
    preview: buildDocumentPreview(data),
    sample: serializeFirestoreValue(Object.fromEntries(Object.entries(data).slice(0, 6))),
    createTime: snapshotDateLabel(snap.createTime),
    updateTime: snapshotDateLabel(snap.updateTime)
  };
}

function serializeDocumentDetail(snap) {
  const data = snap.exists ? (snap.data() || {}) : {};
  return {
    id: snap.id,
    path: snap.ref.path,
    exists: snap.exists,
    fieldCount: Object.keys(data).length,
    createTime: snapshotDateLabel(snap.createTime),
    updateTime: snapshotDateLabel(snap.updateTime),
    data: serializeFirestoreValue(data)
  };
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function inferRole(data = {}, email = "") {
  const normalizedEmail = normalizeLower(email || data.email);
  if (BOOTSTRAP_PROGRAMMER_EMAILS.has(normalizedEmail)) return "PROGRAMADOR";
  const explicit = normalizeUpper(data.rol);
  if (explicit) {
    return explicit;
  }
  if (data.isGlobal === true) return "CORPORATIVO_USER";
  if (data.isAdmin === true) return "VENTAS";
  return "AUXILIAR";
}

async function loadSecurityConfig() {
  try {
    const snap = await db.collection(CONFIG_COL).doc("empresa").get();
    const empresa = snap.exists ? (snap.data() || {}) : {};
    return empresa.security || {};
  } catch (_) {
    return {};
  }
}

function roleCapabilities(role, security = {}) {
  const normalizedRole = normalizeUpper(role);
  const fallback = DEFAULT_ROLE_CAPABILITIES[normalizedRole] || DEFAULT_ROLE_CAPABILITIES.AUXILIAR;
  const configured = security?.roles?.[normalizedRole];
  const configuredPermissions = configured && typeof configured.permissions === "object" ? configured.permissions : {};
  return {
    use_programmer_console: configured?.fullAccess === true
      ? true
      : (typeof configuredPermissions.use_programmer_console === "boolean"
        ? configuredPermissions.use_programmer_console
        : fallback.use_programmer_console),
    operational_admin: configured?.fullAccess === true
      ? true
      : (typeof configuredPermissions.view_admin_cuadre === "boolean"
        ? configuredPermissions.view_admin_cuadre
        : fallback.operational_admin),
    view_exact_location_logs: configured?.fullAccess === true
      ? true
      : (typeof configuredPermissions.view_exact_location_logs === "boolean"
        ? configuredPermissions.view_exact_location_logs
        : fallback.view_exact_location_logs)
  };
}

function profileHasPermission(profileData = {}, role, permissionKey, security = {}) {
  const overrides = profileData?.permissionOverrides && typeof profileData.permissionOverrides === "object"
    ? profileData.permissionOverrides
    : {};
  if (typeof overrides[permissionKey] === "boolean") return overrides[permissionKey];
  return Boolean(roleCapabilities(role, security)[permissionKey]);
}

function canUseProgrammerConsole(role, security = {}, profileData = {}) {
  return profileHasPermission(profileData, role, "use_programmer_console", security);
}

function isOperationalAdmin(role, security = {}, profileData = {}) {
  if (ADMIN_ROLES.has(normalizeUpper(role))) return true;
  return profileHasPermission(profileData, role, "operational_admin", security);
}

function canViewExactLocationLogs(role, security = {}, profileData = {}) {
  return profileHasPermission(profileData, role, "view_exact_location_logs", security);
}

function defaultSettingsPayload() {
  return {
    mapaBloqueado: false,
    estadoCuadreV3: "LIBRE",
    adminIniciador: "",
    liveFeed: JSON.stringify([]),
    ultimaModificacion: nowIso(),
    ultimoEditor: "Sistema",
    notifications: {
      vapidKey: "",
      allowForegroundPush: false
    },
    featureFlags: {
      programmerConsoleV2: true,
      inboxBeta: true,
      opsEventsBeta: true
    },
    observability: {
      enabled: true
    },
    integrations: {}
  };
}

function defaultConfigPayload(plaza) {
  return {
    ubicaciones: [
      { nombre: "PATIO", isPlazaFija: true, plazaId: plaza },
      { nombre: "TALLER", isPlazaFija: true, plazaId: plaza },
      { nombre: "AGENCIA", isPlazaFija: true, plazaId: plaza },
      { nombre: "TALLER EXTERNO", isPlazaFija: true, plazaId: plaza }
    ]
  };
}

function defaultMapPiece() {
  return {
    valor: "A1",
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    rotation: 0,
    tipo: "cajon",
    esLabel: false,
    orden: 0
  };
}

async function recordProgrammerError(scope, error, extra = {}) {
  try {
    const payload = sanitizePlainObject({
      timestamp: nowMillis(),
      fecha: nowIso(),
      scope: normalizeString(scope) || "functions",
      message: normalizeString(error?.message || error),
      stack: normalizeString(error?.stack || ""),
      code: normalizeString(error?.code || error?.details?.code || ""),
      ...extra
    });
    await db.collection(ERRORS_COL).add(payload);
  } catch (writeError) {
    logger.error("No se pudo registrar programmer_error", writeError);
  }
}

async function recordProgrammerAudit(entry = {}) {
  await db.collection(AUDIT_COL).add(sanitizePlainObject({
    timestamp: nowMillis(),
    fecha: nowIso(),
    ...entry
  }));
}

async function countDocs(ref) {
  try {
    const snap = await ref.count().get();
    return snap.data().count || 0;
  } catch (_) {
    const snap = await ref.get();
    return snap.size;
  }
}

async function safeCountDocs(ref, label, fallback = 0) {
  try {
    return await countDocs(ref);
  } catch (error) {
    if (isFailedPreconditionError(error)) {
      logger.warn(`safeCountDocs fallback for ${label}`, { code: error.code || "", message: error.message || "" });
      return fallback;
    }
    throw error;
  }
}

async function safeRows(label, loader, fallback = []) {
  try {
    return await loader();
  } catch (error) {
    if (isFailedPreconditionError(error)) {
      logger.warn(`safeRows fallback for ${label}`, { code: error.code || "", message: error.message || "" });
      return fallback;
    }
    throw error;
  }
}

function sortRowsByTimestamp(rows = [], key = "timestamp") {
  return [...rows].sort((a, b) => timestampToMillis(b?.[key]) - timestampToMillis(a?.[key]));
}

async function latestCollectionGroupRows(groupName, orderKey, limit) {
  const fetchLimit = Math.min(Math.max((Number(limit) || 40) * 4, 40), 200);
  return safeRows(`collectionGroup:${groupName}`, async () => {
    const snap = await db.collectionGroup(groupName).limit(fetchLimit).get();
    const rows = snap.docs.map(doc => ({ id: doc.id, path: doc.ref.path, ...sanitizePlainObject(doc.data()) }));
    return sortRowsByTimestamp(rows, orderKey).slice(0, limit);
  }, []);
}

function deviceOwnerDocIdFromPath(path = "") {
  const segments = firestorePathSegments(path);
  if (segments.length >= 4 && segments[0] === USERS_COL && segments[2] === "devices") {
    return segments[1];
  }
  return "";
}

async function enrichDeviceRows(rows = []) {
  const ownerIds = [...new Set(rows.map(row => deviceOwnerDocIdFromPath(row.path)).filter(Boolean))];
  if (!ownerIds.length) return rows;

  const profileMap = new Map();
  for (const group of chunk(ownerIds, 25)) {
    const refs = group.map(id => db.collection(USERS_COL).doc(id));
    const snaps = await db.getAll(...refs);
    snaps.forEach(snap => {
      profileMap.set(snap.id, snap.exists ? (snap.data() || {}) : {});
    });
  }

  return rows.map(row => {
    const userDocId = deviceOwnerDocIdFromPath(row.path);
    const profile = profileMap.get(userDocId) || {};
    const userEmail = normalizeLower(profile.email || userDocId);
    return {
      ...row,
      userDocId,
      userEmail,
      userName: normalizeString(profile.nombre || profile.usuario || userEmail || userDocId),
      userRole: inferRole(profile, userEmail),
      userStatus: normalizeUpper(profile.status || "ACTIVO")
    };
  });
}

async function findUserProfileFromAuth(auth) {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sesión requerida.");
  const email = normalizeLower(auth.token?.email);
  if (email) {
    const direct = await db.collection(USERS_COL).doc(email).get();
    if (direct.exists) return { id: direct.id, ref: direct.ref, data: direct.data() || {} };

    const byEmail = await db.collection(USERS_COL).where("email", "==", email).limit(1).get();
    if (!byEmail.empty) {
      const doc = byEmail.docs[0];
      return { id: doc.id, ref: doc.ref, data: doc.data() || {} };
    }
  }

  const byUid = await db.collection(USERS_COL).doc(auth.uid).get();
  if (byUid.exists) return { id: byUid.id, ref: byUid.ref, data: byUid.data() || {} };

  throw new HttpsError("permission-denied", "Perfil no encontrado.");
}

async function requireProgrammerAuth(request) {
  const profile = await findUserProfileFromAuth(request.auth);
  const role = inferRole(profile.data, profile.data?.email || request.auth?.token?.email);
  const security = await loadSecurityConfig();
  if (!canUseProgrammerConsole(role, security, profile.data || {})) {
    throw new HttpsError("permission-denied", "No autorizado para la consola de programador.");
  }
  return { ...profile, role, security };
}

async function resolveUserDocIdsByHandle(handle) {
  const raw = normalizeString(handle);
  if (!raw) return [];
  const upper = normalizeUpper(raw);
  const lower = normalizeLower(raw);
  const found = new Map();

  async function absorbDoc(doc) {
    if (!doc?.exists) return;
    found.set(doc.id, doc.ref.path);
  }

  await Promise.all([
    db.collection(USERS_COL).doc(lower).get().then(absorbDoc),
    db.collection(USERS_COL).doc(upper).get().then(absorbDoc),
    db.collection(USERS_COL).where("email", "==", lower).limit(5).get().then(snap => snap.docs.forEach(doc => found.set(doc.id, doc.ref.path))),
    db.collection(USERS_COL).where("nombre", "==", upper).limit(5).get().then(snap => snap.docs.forEach(doc => found.set(doc.id, doc.ref.path))),
    db.collection(USERS_COL).where("usuario", "==", upper).limit(5).get().then(snap => snap.docs.forEach(doc => found.set(doc.id, doc.ref.path)))
  ]);

  return [...found.keys()];
}

async function resolveAlertRecipients(data = {}) {
  const destCsv = normalizeString(data.destinatarios || "");
  const tokens = destCsv.split(",").map(item => normalizeString(item)).filter(Boolean);
  if (!tokens.length || tokens.includes("GLOBAL")) {
    const snap = await db.collection(USERS_COL).get();
    return snap.docs.map(doc => doc.id);
  }

  const security = await loadSecurityConfig();
  const resolved = new Set();
  for (const token of tokens) {
    const normalized = normalizeUpper(token);
    if (normalized === "ADMINS" || normalized === "ADMINS" || normalized === "OPERACION") {
      const snap = await db.collection(USERS_COL).get();
      snap.docs.forEach(doc => {
        if (isOperationalAdmin(inferRole(doc.data(), doc.data()?.email), security, doc.data() || {})) resolved.add(doc.id);
      });
      continue;
    }
    (await resolveUserDocIdsByHandle(token)).forEach(id => resolved.add(id));
  }
  return [...resolved];
}

async function resolveCuadreRecipients(plaza, adminIniciador = "") {
  const plazaUp = normalizePlaza(plaza);
  const byPlaza = await db.collection(USERS_COL).where("plazaAsignada", "==", plazaUp).limit(200).get();
  const recipients = byPlaza.docs.filter(doc => {
    const data = doc.data() || {};
    const role = inferRole(data, data.email);
    const sameActor = normalizeUpper(data.nombre || data.usuario) === normalizeUpper(adminIniciador);
    if (sameActor) return false;
    return role === "AUXILIAR";
  });
  if (recipients.length) return recipients.map(doc => doc.id);
  return byPlaza.docs
    .filter(doc => normalizeUpper(doc.data()?.nombre || doc.data()?.usuario) !== normalizeUpper(adminIniciador))
    .map(doc => doc.id);
}

async function resolveCuadreReviewRecipients(plaza, actorName = "", security = {}) {
  const plazaUp = normalizePlaza(plaza);
  const byPlaza = await db.collection(USERS_COL).where("plazaAsignada", "==", plazaUp).limit(200).get();
  return byPlaza.docs.filter(doc => {
    const data = doc.data() || {};
    const role = inferRole(data, data.email);
    const sameActor = normalizeUpper(data.nombre || data.usuario) === normalizeUpper(actorName);
    if (sameActor) return false;
    return isOperationalAdmin(role, security, data);
  }).map(doc => doc.id);
}

function normalizeNotificationPrefs(raw = {}) {
  return {
    muteAll: raw.muteAll === true,
    directMessages: raw.directMessages !== false,
    cuadreMissions: raw.cuadreMissions !== false,
    criticalAlerts: raw.criticalAlerts !== false
  };
}

function normalizeRequestIp(value = "") {
  return normalizeString(value).replace(/^::ffff:/, "");
}

function requestHeader(rawRequest, name) {
  const value = rawRequest?.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return normalizeString(value[0]);
  return normalizeString(value);
}

function extractClientRequestMeta(rawRequest) {
  const forwardedFor = requestHeader(rawRequest, "x-forwarded-for");
  const firstForwardedIp = forwardedFor
    .split(",")
    .map(item => normalizeRequestIp(item))
    .find(Boolean);
  const directIp = normalizeRequestIp(rawRequest?.ip || rawRequest?.socket?.remoteAddress || rawRequest?.connection?.remoteAddress || "");
  return {
    ipAddress: firstForwardedIp || directIp,
    forwardedFor,
    userAgent: requestHeader(rawRequest, "user-agent")
  };
}

function normalizeExactLocation(value = {}) {
  if (!value || typeof value !== "object") return null;
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const accuracy = Number(value.accuracy);
  const capturedAt = Number(value.capturedAt);
  const city = normalizeString(value.city || value.locality || "");
  const state = normalizeString(value.state || value.region || "");
  const addressLabel = normalizeString(value.addressLabel || [city, state].filter(Boolean).join(", "));
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    capturedAt: Number.isFinite(capturedAt) ? capturedAt : nowMillis(),
    source: normalizeString(value.source || "browser") || "browser",
    city,
    state,
    addressLabel,
    googleMapsUrl: `https://maps.google.com/?q=${latitude},${longitude}`
  };
}

function normalizeLocationStatus(value = "") {
  const status = normalizeLower(value);
  return status || "pending";
}

function sanitizeAdminAuditExtra(extra = {}) {
  const payload = sanitizePlainObject(extra || {});
  const exactLocation = normalizeExactLocation(payload.exactLocation || payload.location || {});
  return {
    entidad: normalizeString(payload.entidad),
    referencia: normalizeString(payload.referencia),
    detalles: normalizeString(payload.detalles),
    objetivo: normalizeString(payload.objetivo),
    rolObjetivo: normalizeString(payload.rolObjetivo),
    plazaObjetivo: normalizePlaza(payload.plazaObjetivo),
    resultado: normalizeString(payload.resultado),
    deviceId: normalizeString(payload.deviceId),
    activeRoute: normalizeString(payload.activeRoute),
    locationStatus: normalizeLocationStatus(payload.locationStatus || (exactLocation ? "granted" : "")),
    exactLocation
  };
}

function shouldDeviceReceiveEvent(device = {}, eventType = "") {
  const prefs = normalizeNotificationPrefs(device.notificationPrefs || DEVICE_PREF_DEFAULTS);
  if (prefs.muteAll || device.pushEnabled === false) return false;
  if (device.permission && device.permission !== "granted") return false;
  const focused = device.isFocused === true;
  if (focused && device.suppressWhileFocused === true) return false;
  if (eventType === "message.created") return prefs.directMessages;
  if (eventType === "cuadre.assigned" || eventType === "cuadre.updated" || eventType === "cuadre.review_ready") return prefs.cuadreMissions;
  if (eventType === "alert.critical.created") return prefs.criticalAlerts;
  return true;
}

function buildWebpushData(payload = {}) {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])
  );
}

async function deliverNotificationToUsers({ eventId, eventType, title, body, deepLink, payload = {}, recipientDocIds = [], priority = "normal", actorName = "", plaza = "", sourceRef = "" }) {
  const uniqueRecipients = [...new Set(recipientDocIds.filter(Boolean))];
  if (!uniqueRecipients.length) return { inboxCount: 0, pushCount: 0, invalidTokens: 0 };

  let pushCount = 0;
  let inboxCount = 0;
  let invalidTokens = 0;

  for (const userDocId of uniqueRecipients) {
    const userRef = db.collection(USERS_COL).doc(userDocId);
    const inboxRef = userRef.collection("inbox").doc(eventId);
    const inboxPayload = sanitizePlainObject({
      notificationId: eventId,
      type: eventType,
      kindLabel: notificationKindLabel(eventType),
      senderLabel: normalizeString(actorName || "Sistema"),
      title,
      body,
      deepLink,
      payload,
      sourceRef,
      plaza: normalizePlaza(plaza),
      actorName: normalizeString(actorName),
      createdAt: nowMillis(),
      timestamp: payload.timestamp || nowMillis(),
      read: false,
      readAt: 0,
      status: "UNREAD",
      priority: normalizeUpper(priority || "normal")
    });

    await inboxRef.set(inboxPayload, { merge: true });
    inboxCount += 1;

    const devicesSnap = await userRef.collection("devices").get();
    const deviceDocs = devicesSnap.docs.map(doc => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }));
    const targetDevices = deviceDocs.filter(item => normalizeString(item.data.token) && shouldDeviceReceiveEvent(item.data, eventType));
    const tokens = [...new Set(targetDevices.map(item => normalizeString(item.data.token)).filter(Boolean))];

    if (!tokens.length) {
      await inboxRef.set({ delivery: { mode: "INBOX_ONLY", sentAt: nowMillis(), tokenCount: 0 } }, { merge: true });
      continue;
    }

    try {
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: buildWebpushData({
          notificationId: eventId,
          type: eventType,
          title,
          body,
          url: deepLink,
          actorName,
          plaza: normalizePlaza(plaza)
        }),
        webpush: {
          headers: {
            Urgency: priority === "high" ? "high" : "normal",
            TTL: "3600"
          },
          notification: {
            title,
            body,
            icon: "/img/logo.png",
            badge: "/img/logo.png",
            tag: `${eventType}:${userDocId}`,
            renotify: priority === "high",
            requireInteraction: priority === "high",
            data: {
              url: deepLink,
              notificationId: eventId,
              type: eventType
            }
          },
          fcmOptions: {
            link: deepLink
          }
        }
      });

      pushCount += response.successCount;
      const invalidByToken = new Set();
      response.responses.forEach((item, index) => {
        if (item.success) return;
        const code = item.error?.code || "";
        if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
          invalidByToken.add(tokens[index]);
        }
      });

      if (invalidByToken.size) {
        invalidTokens += invalidByToken.size;
        await Promise.all(deviceDocs
          .filter(item => invalidByToken.has(normalizeString(item.data.token)))
          .map(item => item.ref.set({
            invalidToken: true,
            pushEnabled: false,
            lastErrorAt: nowMillis(),
            lastErrorCode: "TOKEN_INVALID"
          }, { merge: true })));
      }

      await inboxRef.set({
        delivery: {
          mode: "PUSH",
          sentAt: nowMillis(),
          tokenCount: tokens.length,
          successCount: response.successCount,
          failureCount: response.failureCount
        }
      }, { merge: true });
    } catch (error) {
      await inboxRef.set({
        delivery: {
          mode: "FAILED",
          sentAt: nowMillis(),
          tokenCount: tokens.length,
          error: normalizeString(error.message || error)
        }
      }, { merge: true });
      await recordProgrammerError("push-delivery", error, { eventType, userDocId, sourceRef });
    }
  }

  return { inboxCount, pushCount, invalidTokens };
}

async function writeOpsEvent(docId, payload) {
  await db.collection(OPS_EVENTS_COL).doc(docId).set(sanitizePlainObject({
    createdAt: nowMillis(),
    ...payload
  }), { merge: true });
}

function buildPatioEvent(data = {}, sourceId) {
  const moveType = normalizeUpper(data.tipo || "MOVE");
  const mappedType = moveType === "SWAP"
    ? "unit.swap"
    : (moveType === "DEL" ? "unit.del" : "unit.move");
  return {
    id: `patio_${sourceId}`,
    type: mappedType,
    source: "historial_patio",
    sourceRef: `historial_patio/${sourceId}`,
    timestamp: timestampToMillis(data.timestamp) || nowMillis(),
    plaza: normalizePlaza(data.plaza),
    actorName: normalizeString(data.autor || "Sistema"),
    locationStatus: normalizeLocationStatus(data.locationStatus || ""),
    exactLocation: normalizeExactLocation(data.exactLocation || {}),
    ipAddress: normalizeString(data.ipAddress || ""),
    forwardedFor: normalizeString(data.forwardedFor || ""),
    unit: {
      mva: normalizeUpper(data.mva),
      from: normalizeUpper(data.posAnterior),
      to: normalizeUpper(data.posNueva),
      sheet: normalizeUpper(data.hoja)
    },
    summary: `${normalizeUpper(data.mva)} ${normalizeUpper(data.posAnterior)} -> ${normalizeUpper(data.posNueva)}`
  };
}

function stripSensitiveLocationData(value) {
  if (Array.isArray(value)) return value.map(stripSensitiveLocationData);
  if (!value || typeof value !== "object") return value;
  const next = {};
  Object.entries(value).forEach(([key, entryValue]) => {
    if (["exactLocation", "googleMapsUrl", "ipAddress", "forwardedFor"].includes(key)) return;
    next[key] = stripSensitiveLocationData(entryValue);
  });
  return next;
}

function safeParseArray(rawValue) {
  try {
    const parsed = JSON.parse(normalizeString(rawValue || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isCriticalAlert(data = {}) {
  const type = normalizeUpper(data.tipo);
  return type === "URGENTE" || type === "CRITICA" || type === "CRÍTICA" || type === "ALTA";
}

exports.onPatioHistoryCreated = functions.region(REGION).firestore.document("historial_patio/{histId}").onCreate(async (snap, context) => {
  try {
    const data = snap.data();
    if (!data) return;
    const opsEvent = buildPatioEvent(data, context.params.histId);
    await writeOpsEvent(opsEvent.id, opsEvent);
  } catch (error) {
    logger.error("onPatioHistoryCreated", error);
    await recordProgrammerError("onPatioHistoryCreated", error, { histId: context.params.histId });
  }
});

exports.onPrivateMessageCreated = functions.region(REGION).firestore.document("mensajes/{msgId}").onCreate(async (snap, context) => {
  try {
    const data = snap.data();
    if (!data) return;
    const recipients = await resolveUserDocIdsByHandle(data.destinatario);
    const eventId = `msg_${context.params.msgId}`;
    const actorName = normalizeUpper(data.remitente || "Sistema");
    const deepLink = `/mapa?notif=chat&chatUser=${encodeURIComponent(actorName)}`;
    const bodyText = normalizeString(data.mensaje || data.archivoNombre || "Tienes un nuevo mensaje.");
    await writeOpsEvent(eventId, {
      id: eventId,
      type: "message.created",
      source: "mensajes",
      sourceRef: `mensajes/${context.params.msgId}`,
      timestamp: timestampToMillis(data.timestamp) || nowMillis(),
      actorName,
      plaza: normalizePlaza(data.plaza),
      targetUsers: recipients,
      payload: {
        remitente: actorName,
        destinatario: normalizeUpper(data.destinatario),
        preview: bodyText.slice(0, 160)
      }
    });
    await deliverNotificationToUsers({
      eventId,
      eventType: "message.created",
      title: `Mensaje de ${actorName}`,
      body: bodyText.slice(0, 180),
      deepLink,
      payload: {
        remitente: actorName,
        destinatario: normalizeUpper(data.destinatario),
        timestamp: timestampToMillis(data.timestamp) || nowMillis()
      },
      recipientDocIds: recipients,
      priority: "high",
      actorName,
      plaza: data.plaza || "",
      sourceRef: `mensajes/${context.params.msgId}`
    });
  } catch (error) {
    logger.error("onPrivateMessageCreated", error);
    await recordProgrammerError("onPrivateMessageCreated", error, { msgId: context.params.msgId });
  }
});

exports.onCriticalAlertCreated = functions.region(REGION).firestore.document("alertas/{alertId}").onCreate(async (snap, context) => {
  try {
    const data = snap.data();
    if (!data || !isCriticalAlert(data)) return;
    const recipients = await resolveAlertRecipients(data);
    const eventId = `alert_${context.params.alertId}`;
    const actorName = normalizeString(data.autor || data.actor || "Sistema");
    const title = normalizeString(data.titulo || "Alerta crítica");
    const body = normalizeString(data.mensaje || "Revisa la alerta en la plataforma.").slice(0, 180);
    const deepLink = "/mapa?notif=alerts";
    await writeOpsEvent(eventId, {
      id: eventId,
      type: "alert.critical.created",
      source: "alertas",
      sourceRef: `alertas/${context.params.alertId}`,
      timestamp: timestampToMillis(data.timestamp) || nowMillis(),
      actorName,
      plaza: normalizePlaza(data.plaza),
      targetUsers: recipients,
      payload: {
        tipo: normalizeUpper(data.tipo),
        titulo: title,
        mensaje: body
      }
    });
    await deliverNotificationToUsers({
      eventId,
      eventType: "alert.critical.created",
      title,
      body,
      deepLink,
      payload: {
        tipo: normalizeUpper(data.tipo),
        timestamp: timestampToMillis(data.timestamp) || nowMillis()
      },
      recipientDocIds: recipients,
      priority: "high",
      actorName,
      plaza: data.plaza || "",
      sourceRef: `alertas/${context.params.alertId}`
    });
  } catch (error) {
    logger.error("onCriticalAlertCreated", error);
    await recordProgrammerError("onCriticalAlertCreated", error, { alertId: context.params.alertId });
  }
});

exports.onCuadreSettingsWritten = functions.region(REGION).firestore.document(`${SETTINGS_COL}/{plazaId}`).onWrite(async (change, context) => {
  try {
    const before = change.before.exists ? (change.before.data() || {}) : {};
    const after = change.after.exists ? (change.after.data() || {}) : {};
    const plazaId = normalizePlaza(context.params.plazaId);
    if (!plazaId || plazaId === "GLOBAL") return;

    const previousState = normalizeUpper(before.estadoCuadreV3 || "LIBRE");
    const nextState = normalizeUpper(after.estadoCuadreV3 || "LIBRE");
    const missionChanged = normalizeString(before.misionAuditoria) !== normalizeString(after.misionAuditoria);
    const adminChanged = normalizeString(before.adminIniciador) !== normalizeString(after.adminIniciador);
    const reviewChanged = normalizeString(before.datosAuditoria) !== normalizeString(after.datosAuditoria);
    const shouldNotifyMission = nextState === "PROCESO" && (previousState !== "PROCESO" || missionChanged || adminChanged);
    const shouldNotifyReview = nextState === "REVISION" && (previousState !== "REVISION" || reviewChanged);
    if (!shouldNotifyMission && !shouldNotifyReview) return;

    const adminName = normalizeString(after.adminIniciador || "Operación");
    const actorName = normalizeString(after.ultimoEditor || adminName || "Operación");
    const security = await loadSecurityConfig();
    const recipients = shouldNotifyMission
      ? await resolveCuadreRecipients(plazaId, adminName)
      : await resolveCuadreReviewRecipients(plazaId, actorName, security);
    const eventType = shouldNotifyMission
      ? (previousState === "PROCESO" ? "cuadre.updated" : "cuadre.assigned")
      : "cuadre.review_ready";
    const eventId = `cuadre_${eventType.replace(/\./g, "_")}_${plazaId}_${timestampToMillis(after.ultimaModificacion) || nowMillis()}`;
    const title = shouldNotifyMission
      ? (previousState === "PROCESO" ? `Misión de cuadre actualizada en ${plazaId}` : `Nueva misión de cuadre en ${plazaId}`)
      : `Auditoría lista para revisar en ${plazaId}`;
    const body = shouldNotifyMission
      ? (adminName ? `${adminName} te envió la misión del cuadre.` : "Ya tienes una nueva misión de cuadre asignada.")
      : `${actorName || "Patio"} terminó la auditoría y ya puedes finalizar el cuadre.`;
    const deepLink = `/mapa?notif=cuadre&openCuadre=1&plaza=${encodeURIComponent(plazaId)}`;

    await writeOpsEvent(eventId, {
      id: eventId,
      type: eventType,
      source: `${SETTINGS_COL}/${plazaId}`,
      sourceRef: `${SETTINGS_COL}/${plazaId}`,
      timestamp: nowMillis(),
      actorName: shouldNotifyMission ? adminName : actorName,
      plaza: plazaId,
      targetUsers: recipients,
      payload: {
        estadoCuadreV3: nextState,
        adminIniciador: adminName,
        missionSize: safeParseArray(after.misionAuditoria).length,
        reviewSize: safeParseArray(after.datosAuditoria).length
      }
    });

    await deliverNotificationToUsers({
      eventId,
      eventType,
      title,
      body,
      deepLink,
      payload: {
        plaza: plazaId,
        timestamp: nowMillis()
      },
      recipientDocIds: recipients,
      priority: "high",
      actorName: shouldNotifyMission ? adminName : actorName,
      plaza: plazaId,
      sourceRef: `${SETTINGS_COL}/${plazaId}`
    });
  } catch (error) {
    logger.error("onCuadreSettingsWritten", error);
    await recordProgrammerError("onCuadreSettingsWritten", error, { plazaId: context.params.plazaId });
  }
});

exports.registerDevice = functions.region(REGION).https.onCall(async (data, context) => {
  try {
    const profile = await findUserProfileFromAuth(context.auth);
    const role = inferRole(profile.data, profile.data?.email || context.auth?.token?.email);
    const payloadIn = sanitizePlainObject(data || {});
    const deviceId = normalizeString(payloadIn.deviceId);
    if (!deviceId) throw new HttpsError("invalid-argument", "deviceId es requerido.");
    const clientMeta = extractClientRequestMeta(context.rawRequest);

    const ref = profile.ref.collection("devices").doc(deviceId);
    const exactLocation = normalizeExactLocation(payloadIn.exactLocation || payloadIn.location || {});
    const locationStatus = normalizeLocationStatus(payloadIn.locationStatus || (exactLocation ? "granted" : ""));
    const payload = {
      deviceId,
      token: normalizeString(payloadIn.token),
      permission: normalizeString(payloadIn.permission || "default"),
      platform: normalizeString(payloadIn.platform || "web"),
      browser: normalizeString(payloadIn.browser || ""),
      userAgent: normalizeString(payloadIn.userAgent || clientMeta.userAgent),
      plaza: normalizePlaza(payloadIn.plaza || profile.data?.plazaAsignada || ""),
      role,
      appVersion: normalizeString(payloadIn.appVersion || ""),
      swVersion: normalizeString(payloadIn.swVersion || ""),
      lastSeenAt: nowMillis(),
      createdAt: payloadIn.createdAt || nowMillis(),
      updatedAt: nowMillis(),
      isFocused: payloadIn.isFocused === true,
      activeRoute: normalizeString(payloadIn.activeRoute || "/mapa"),
      invalidToken: false,
      pushEnabled: payloadIn.pushEnabled !== false,
      suppressWhileFocused: payloadIn.suppressWhileFocused === true,
      ipAddress: clientMeta.ipAddress,
      forwardedFor: clientMeta.forwardedFor,
      locationStatus,
      ...(exactLocation ? { exactLocation } : {}),
      notificationPrefs: {
        ...DEVICE_PREF_DEFAULTS,
        ...normalizeNotificationPrefs(payloadIn.notificationPrefs || {})
      }
    };
    await ref.set(payload, { merge: true });
    return { ok: true, deviceId, userDocId: profile.id, ipAddress: clientMeta.ipAddress };
  } catch (error) {
    await recordProgrammerError("registerDevice", error, { authUid: context.auth?.uid || "" });
    throw error;
  }
});

exports.syncDeviceContext = functions.region(REGION).https.onCall(async (data, context) => {
  try {
    const profile = await findUserProfileFromAuth(context.auth);
    const role = inferRole(profile.data, profile.data?.email || context.auth?.token?.email);
    const payloadIn = sanitizePlainObject(data || {});
    const deviceId = normalizeString(payloadIn.deviceId);
    if (!deviceId) throw new HttpsError("invalid-argument", "deviceId es requerido.");

    const clientMeta = extractClientRequestMeta(context.rawRequest);
    const ref = profile.ref.collection("devices").doc(deviceId);
    const exactLocation = normalizeExactLocation(payloadIn.exactLocation || payloadIn.location || {});
    const locationStatus = normalizeLocationStatus(payloadIn.locationStatus || (exactLocation ? "granted" : ""));
    const payload = {
      deviceId,
      permission: normalizeString(payloadIn.permission || "default"),
      platform: normalizeString(payloadIn.platform || "web"),
      browser: normalizeString(payloadIn.browser || ""),
      userAgent: normalizeString(payloadIn.userAgent || clientMeta.userAgent),
      plaza: normalizePlaza(payloadIn.plaza || profile.data?.plazaAsignada || ""),
      role,
      appVersion: normalizeString(payloadIn.appVersion || ""),
      swVersion: normalizeString(payloadIn.swVersion || ""),
      lastSeenAt: nowMillis(),
      updatedAt: nowMillis(),
      isFocused: payloadIn.isFocused === true,
      activeRoute: normalizeString(payloadIn.activeRoute || "/mapa"),
      suppressWhileFocused: payloadIn.suppressWhileFocused === true,
      ipAddress: clientMeta.ipAddress,
      forwardedFor: clientMeta.forwardedFor,
      locationStatus,
      ...(exactLocation ? { exactLocation } : {}),
      notificationPrefs: {
        ...DEVICE_PREF_DEFAULTS,
        ...normalizeNotificationPrefs(payloadIn.notificationPrefs || {})
      }
    };
    await ref.set(payload, { merge: true });
    return {
      ok: true,
      deviceId,
      ipAddress: clientMeta.ipAddress,
      forwardedFor: clientMeta.forwardedFor,
      updatedAt: payload.updatedAt,
      lastSeenAt: payload.lastSeenAt
    };
  } catch (error) {
    await recordProgrammerError("syncDeviceContext", error, { authUid: context.auth?.uid || "" });
    throw error;
  }
});

exports.recordAdminAuditEvent = functions.region(REGION).https.onCall(async (data, context) => {
  try {
    const profile = await findUserProfileFromAuth(context.auth);
    const role = inferRole(profile.data, profile.data?.email || context.auth?.token?.email);
    const security = await loadSecurityConfig();
    if (!isOperationalAdmin(role, security, profile.data || {})) {
      throw new HttpsError("permission-denied", "No autorizado para registrar auditoria administrativa.");
    }

    const payloadIn = sanitizePlainObject(data || {});
    const clientMeta = extractClientRequestMeta(context.rawRequest);
    const extra = sanitizeAdminAuditExtra(payloadIn.extra || {});
    const eventId = `gest_${nowMillis()}_${Math.floor(Math.random() * 1000)}`;
    const eventPayload = {
      fecha: nowIso(),
      timestamp: nowMillis(),
      tipo: normalizeUpper(payloadIn.tipo || payloadIn.type || "GESTION") || "GESTION",
      accion: normalizeString(payloadIn.mensaje || payloadIn.message || "Accion administrativa"),
      autor: normalizeString(payloadIn.autor || profile.data?.nombre || profile.data?.usuario || profile.data?.email || "Sistema"),
      userDocId: profile.id,
      userEmail: normalizeLower(profile.data?.email || context.auth?.token?.email || ""),
      role,
      plaza: normalizePlaza(payloadIn.plaza || profile.data?.plazaAsignada || ""),
      ipAddress: clientMeta.ipAddress,
      forwardedFor: clientMeta.forwardedFor,
      userAgent: clientMeta.userAgent,
      ...extra
    };
    await db.collection(ADMIN_AUDIT_COL).doc(eventId).set(eventPayload, { merge: true });
    return {
      ok: true,
      id: eventId,
      timestamp: eventPayload.timestamp,
      ipAddress: clientMeta.ipAddress,
      forwardedFor: clientMeta.forwardedFor
    };
  } catch (error) {
    await recordProgrammerError("recordAdminAuditEvent", error, { authUid: context.auth?.uid || "" });
    throw error;
  }
});

exports.unregisterDevice = functions.region(REGION).https.onCall(async (data, context) => {
  try {
    const profile = await findUserProfileFromAuth(context.auth);
    const deviceId = normalizeString(data?.deviceId);
    if (!deviceId) throw new HttpsError("invalid-argument", "deviceId es requerido.");
    await profile.ref.collection("devices").doc(deviceId).delete();
    return { ok: true };
  } catch (error) {
    await recordProgrammerError("unregisterDevice", error, { authUid: context.auth?.uid || "" });
    throw error;
  }
});

exports.ackNotification = functions.region(REGION).https.onCall(async (data, context) => {
  try {
    const profile = await findUserProfileFromAuth(context.auth);
    const notificationId = normalizeString(data?.notificationId);
    if (!notificationId) throw new HttpsError("invalid-argument", "notificationId es requerido.");
    await profile.ref.collection("inbox").doc(notificationId).set({
      read: true,
      readAt: nowMillis(),
      status: "READ"
    }, { merge: true });
    return { ok: true, notificationId };
  } catch (error) {
    await recordProgrammerError("ackNotification", error, { authUid: context.auth?.uid || "" });
    throw error;
  }
});

async function queryOverview() {
  const [usersCount, settingsCount, opsEventsCount, jobsCount, errorsCount, unreadInboxCount, devicesCount] = await Promise.all([
    safeCountDocs(db.collection(USERS_COL), USERS_COL),
    safeCountDocs(db.collection(SETTINGS_COL), SETTINGS_COL),
    safeCountDocs(db.collection(OPS_EVENTS_COL), OPS_EVENTS_COL),
    safeCountDocs(db.collection(JOBS_COL), JOBS_COL),
    safeCountDocs(db.collection(ERRORS_COL), ERRORS_COL),
    safeCountDocs(db.collectionGroup("inbox").where("read", "==", false), "collectionGroup:inbox:unread"),
    safeCountDocs(db.collectionGroup("devices"), "collectionGroup:devices")
  ]);
  return {
    usersCount,
    settingsCount,
    opsEventsCount,
    jobsCount,
    errorsCount,
    unreadInboxCount,
    devicesCount
  };
}

async function queryDbCollections(rawParams = {}) {
  const parentPath = normalizeFirestorePath(rawParams.parentPath || "");
  if (parentPath && !isDocumentPath(parentPath)) {
    throw new HttpsError("invalid-argument", "parentPath debe apuntar a un documento o venir vacío.");
  }
  const collections = parentPath
    ? await db.doc(parentPath).listCollections()
    : await db.listCollections();
  const rows = collections.map(ref => ({
    id: ref.id,
    path: ref.path,
    parentPath,
    level: firestorePathSegments(ref.path).length,
    kind: parentPath ? "subcollection" : "root"
  }));
  return {
    rows,
    parentPath,
    count: rows.length
  };
}

async function queryDbDocs(rawParams = {}) {
  const collectionPath = requireCollectionPath(rawParams.collectionPath || rawParams.path || "", "collectionPath");
  const limit = Math.min(300, Math.max(20, Number(rawParams.limit) || 80));
  const ref = collectionRefFromPath(collectionPath, "collectionPath");
  let snap;
  try {
    snap = await ref
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(limit)
      .get();
  } catch (error) {
    logger.warn("queryDbDocs fallback sin orderBy", {
      collectionPath,
      code: normalizeString(error?.code || ""),
      message: normalizeString(error?.message || "")
    });
    snap = await ref.limit(limit).get();
  }
  const orderedDocs = [...snap.docs].sort((a, b) => a.id.localeCompare(b.id));
  const rows = orderedDocs.map(serializeDocumentSummary);
  return {
    rows,
    collectionPath,
    limit,
    truncated: orderedDocs.length >= limit
  };
}

async function queryDbDocument(rawParams = {}) {
  const docPath = requireDocumentPath(rawParams.docPath || rawParams.path || "", "docPath");
  const ref = documentRefFromPath(docPath, "docPath");
  const [snap, subcollections] = await Promise.all([
    ref.get(),
    ref.listCollections()
  ]);
  return {
    rows: snap.exists ? [serializeDocumentSummary(snap)] : [],
    docPath,
    document: serializeDocumentDetail(snap),
    subcollections: subcollections.map(col => ({
      id: col.id,
      path: col.path
    }))
  };
}

async function runNamedQuery(name, rawParams = {}) {
  const params = sanitizePlainObject(rawParams || {});
  const limit = Math.min(150, Math.max(10, Number(params.limit) || 40));
  const plaza = normalizePlaza(params.plaza || "");

  if (name === "overview") {
    return { rows: [await queryOverview()] };
  }

  if (name === "ops_events") {
    const rows = await safeRows(`ops_events:${plaza || "GLOBAL"}`, async () => {
      if (!plaza) {
        const snap = await db.collection(OPS_EVENTS_COL).orderBy("timestamp", "desc").limit(limit).get();
        return snap.docs.map(doc => ({ id: doc.id, ...sanitizePlainObject(doc.data()) }));
      }
      const fetchLimit = Math.min(Math.max(limit * 4, 40), 200);
      const snap = await db.collection(OPS_EVENTS_COL).where("plaza", "==", plaza).limit(fetchLimit).get();
      const rows = snap.docs.map(doc => ({ id: doc.id, ...sanitizePlainObject(doc.data()) }));
      return sortRowsByTimestamp(rows, "timestamp").slice(0, limit);
    }, []);
    return { rows };
  }

  if (name === "notifications") {
    return { rows: await latestCollectionGroupRows("inbox", "timestamp", limit) };
  }

  if (name === "devices") {
    const rows = await latestCollectionGroupRows("devices", "updatedAt", limit);
    return { rows: await enrichDeviceRows(rows) };
  }

  if (name === "errors") {
    const snap = await db.collection(ERRORS_COL).orderBy("timestamp", "desc").limit(limit).get();
    return { rows: snap.docs.map(doc => ({ id: doc.id, ...sanitizePlainObject(doc.data()) })) };
  }

  if (name === "jobs") {
    const snap = await db.collection(JOBS_COL).orderBy("createdAt", "desc").limit(limit).get();
    return { rows: snap.docs.map(doc => ({ id: doc.id, ...sanitizePlainObject(doc.data()) })) };
  }

  if (name === "audit") {
    const snap = await db.collection(AUDIT_COL).orderBy("timestamp", "desc").limit(limit).get();
    return { rows: snap.docs.map(doc => ({ id: doc.id, ...sanitizePlainObject(doc.data()) })) };
  }

  if (name === "users") {
    const snap = await db.collection(USERS_COL).orderBy("nombre").limit(limit).get();
    return { rows: snap.docs.map(doc => ({ id: doc.id, ...sanitizePlainObject(doc.data()) })) };
  }

  if (name === "settings") {
    const globalSnap = await db.collection(SETTINGS_COL).doc("GLOBAL").get();
    const plazaSnap = plaza ? await db.collection(SETTINGS_COL).doc(plaza).get() : null;
    return {
      rows: [{
        global: sanitizePlainObject(globalSnap.exists ? globalSnap.data() : {}),
        plaza,
        plazaSettings: sanitizePlainObject(plazaSnap?.exists ? plazaSnap.data() : {})
      }]
    };
  }

  if (name === "db_collections") {
    return queryDbCollections(params);
  }

  if (name === "db_docs") {
    return queryDbDocs(params);
  }

  if (name === "db_document") {
    return queryDbDocument(params);
  }

  throw new HttpsError("invalid-argument", `Consulta no soportada: ${name}`);
}

exports.queryProgrammerConsole = functions.region(REGION).https.onCall(async (data, context) => {
  const queryName = normalizeString(data?.query || "overview");
  try {
    const actor = await requireProgrammerAuth(context);
    const canViewLocation = canViewExactLocationLogs(actor.role, actor.security, actor.data || {});
    const payloadRaw = await runNamedQuery(queryName, data || {});
    const payload = canViewLocation ? payloadRaw : stripSensitiveLocationData(payloadRaw);
    await recordProgrammerAudit({
      actor: normalizeString(actor.data?.nombre || actor.data?.email || actor.id),
      actorRole: actor.role,
      action: "queryProgrammerConsole",
      query: queryName,
      plaza: normalizePlaza(data?.plaza || ""),
      resultCount: Array.isArray(payload.rows) ? payload.rows.length : 0
    });
    return payload;
  } catch (error) {
    await recordProgrammerError("queryProgrammerConsole", error, {
      query: queryName,
      plaza: normalizePlaza(data?.plaza || ""),
      authUid: context.auth?.uid || ""
    });
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", normalizeString(error?.message || "Error interno al consultar la consola."));
  }
});

async function createJobDocument(job, actor, params) {
  const ref = db.collection(JOBS_COL).doc();
  await ref.set({
    job,
    dryRun: params.dryRun !== false,
    status: "RUNNING",
    createdAt: nowMillis(),
    updatedAt: nowMillis(),
    actor: normalizeString(actor.data?.nombre || actor.data?.email || actor.id),
    actorRole: actor.role,
    params: sanitizePlainObject(params)
  });
  return ref;
}

async function finishJob(ref, status, result) {
  await ref.set({
    status,
    updatedAt: nowMillis(),
    result: sanitizePlainObject(result)
  }, { merge: true });
}

async function runValidatePlazasJob(params = {}) {
  const dryRun = params.dryRun !== false;
  const empresaSnap = await db.collection(CONFIG_COL).doc("empresa").get();
  const empresa = empresaSnap.exists ? (empresaSnap.data() || {}) : {};
  const plazasDetalle = Array.isArray(empresa.plazasDetalle) ? empresa.plazasDetalle : [];
  const plazas = [...new Set([
    ...(Array.isArray(empresa.plazas) ? empresa.plazas : []),
    ...plazasDetalle.map(item => item?.id)
  ].map(normalizePlaza).filter(Boolean))];

  const rows = [];
  for (const plaza of plazas) {
    const [settingsSnap, configSnap, estructuraSnap] = await Promise.all([
      db.collection(SETTINGS_COL).doc(plaza).get(),
      db.collection(CONFIG_COL).doc(plaza).get(),
      db.collection(MAPA_COL).doc(plaza).collection("estructura").limit(1).get()
    ]);
    const row = {
      plaza,
      hasSettings: settingsSnap.exists,
      hasConfig: configSnap.exists,
      hasStructure: !estructuraSnap.empty
    };
    rows.push(row);

    if (!dryRun) {
      const writes = [];
      if (!settingsSnap.exists) writes.push(db.collection(SETTINGS_COL).doc(plaza).set(defaultSettingsPayload(), { merge: true }));
      if (!configSnap.exists) writes.push(db.collection(CONFIG_COL).doc(plaza).set(defaultConfigPayload(plaza), { merge: true }));
      if (estructuraSnap.empty) writes.push(db.collection(MAPA_COL).doc(plaza).collection("estructura").doc("cel_0").set(defaultMapPiece(), { merge: true }));
      if (writes.length) await Promise.all(writes);
    }
  }
  return { total: rows.length, rows, dryRun };
}

async function runBackfillOpsEventsJob(params = {}) {
  const dryRun = params.dryRun !== false;
  const cutoff = Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60);
  const snap = await db.collection("historial_patio").where("timestamp", ">=", cutoff).orderBy("timestamp", "desc").limit(1000).get();
  let created = 0;
  for (const doc of snap.docs) {
    const targetId = `legacy_${doc.id}`;
    const existing = await db.collection(OPS_EVENTS_COL).doc(targetId).get();
    if (existing.exists) continue;
    if (!dryRun) {
      const payload = buildPatioEvent(doc.data() || {}, doc.id);
      await writeOpsEvent(targetId, { ...payload, id: targetId, source: "legacy_backfill" });
    }
    created += 1;
  }
  return { scanned: snap.size, created, dryRun };
}

async function runExportConfigJob() {
  const [configSnap, settingsSnap] = await Promise.all([
    db.collection(CONFIG_COL).get(),
    db.collection(SETTINGS_COL).get()
  ]);
  return {
    config: configSnap.docs.map(doc => ({ id: doc.id, ...sanitizePlainObject(doc.data()) })),
    settings: settingsSnap.docs.map(doc => ({ id: doc.id, ...sanitizePlainObject(doc.data()) }))
  };
}

async function runCleanupDeviceTokensJob(params = {}) {
  const dryRun = params.dryRun !== false;
  const snap = await db.collectionGroup("devices").where("invalidToken", "==", true).limit(200).get();
  if (!dryRun) {
    await Promise.all(snap.docs.map(doc => doc.ref.delete()));
  }
  return { total: snap.size, dryRun };
}

async function runSendTestNotificationJob(params = {}) {
  const target = normalizeString(params.targetUser || params.targetEmail || "");
  const title = normalizeString(params.title || "Prueba de notificacion");
  const body = normalizeString(params.body || "Esta es una notificación de prueba enviada desde la consola.");
  const recipients = await resolveUserDocIdsByHandle(target);
  if (!recipients.length) throw new HttpsError("not-found", "No se encontró el usuario destino.");
  const eventId = `test_${nowMillis()}_${Math.floor(Math.random() * 1000)}`;
  const deepLink = "/mapa?notif=inbox";
  await writeOpsEvent(eventId, {
    id: eventId,
    type: "system.test.push",
    source: "programmer_console",
    sourceRef: JOBS_COL,
    timestamp: nowMillis(),
    actorName: "Programmer Console",
    plaza: "",
    targetUsers: recipients,
    payload: { title, body }
  });
  const delivery = await deliverNotificationToUsers({
    eventId,
    eventType: "system.test.push",
    title,
    body,
    deepLink,
    payload: { timestamp: nowMillis(), test: true },
    recipientDocIds: recipients,
    priority: "high",
    actorName: "Programmer Console",
    plaza: "",
    sourceRef: `${JOBS_COL}/${eventId}`
  });
  return { recipients, delivery };
}

async function runUpsertDocumentJob(params = {}) {
  const docPath = requireDocumentPath(params.docPath || params.path || "", "docPath");
  const merge = params.merge !== false;
  const dryRun = params.dryRun === true;
  let rawPayload = params.data;

  if (typeof rawPayload === "string") {
    rawPayload = JSON.parse(rawPayload || "{}");
  }
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new HttpsError("invalid-argument", "data debe ser un objeto JSON.");
  }

  const revivedPayload = reviveConsoleFirestoreValue(rawPayload);
  if (!dryRun) {
    await db.doc(docPath).set(revivedPayload, { merge });
  }

  const snap = await db.doc(docPath).get();
  return {
    docPath,
    merge,
    dryRun,
    exists: snap.exists,
    fieldCount: Object.keys(snap.exists ? (snap.data() || {}) : {}).length,
    updateTime: snapshotDateLabel(snap.updateTime)
  };
}

async function runDeleteDocumentJob(params = {}) {
  const docPath = requireDocumentPath(params.docPath || params.path || "", "docPath");
  const dryRun = params.dryRun === true;
  const ref = db.doc(docPath);
  const snap = await ref.get();

  if (!dryRun) {
    await ref.delete();
  }

  return {
    docPath,
    dryRun,
    existed: snap.exists,
    deleted: !dryRun,
    note: "Solo elimina el documento. Las subcolecciones viven aparte y deben borrarse manualmente."
  };
}

exports.runProgrammerJob = functions.region(REGION).https.onCall(async (data, context) => {
  const actor = await requireProgrammerAuth(context);
  const job = normalizeString(data?.job || "");
  if (!job) throw new HttpsError("invalid-argument", "Debes indicar un job.");
  const params = sanitizePlainObject(data || {});
  const jobRef = await createJobDocument(job, actor, params);

  try {
    let result;
    if (job === "validate-plazas") result = await runValidatePlazasJob(params);
    else if (job === "backfill-ops-events") result = await runBackfillOpsEventsJob(params);
    else if (job === "export-config") result = await runExportConfigJob(params);
    else if (job === "cleanup-device-tokens") result = await runCleanupDeviceTokensJob(params);
    else if (job === "send-test-notification") result = await runSendTestNotificationJob(params);
    else if (job === "upsert-document") result = await runUpsertDocumentJob(params);
    else if (job === "delete-document") result = await runDeleteDocumentJob(params);
    else throw new HttpsError("invalid-argument", `Job no soportado: ${job}`);

    await finishJob(jobRef, "SUCCESS", result);
    await recordProgrammerAudit({
      actor: normalizeString(actor.data?.nombre || actor.data?.email || actor.id),
      actorRole: actor.role,
      action: "runProgrammerJob",
      job,
      dryRun: params.dryRun !== false,
      resultSummary: sanitizePlainObject(result)
    });
    return { ok: true, jobId: jobRef.id, result };
  } catch (error) {
    await finishJob(jobRef, "ERROR", { message: normalizeString(error.message || error) });
    await recordProgrammerError("runProgrammerJob", error, { job, actor: actor.id });
    throw error;
  }
});

// ══════════════════════════════════════════════════════════════
//  enviarCorreoSolicitud — HTTPS callable
//  Envía un correo de confirmación al solicitante de acceso.
//  Credenciales SMTP via Firebase config:
//    firebase functions:config:set mail.user="..." mail.pass="..."
// ══════════════════════════════════════════════════════════════
exports.enviarCorreoSolicitud = functions
  .region(REGION)
  .https.onCall(async (data) => {
    const { nombre, email, puesto } = data || {};
    if (!nombre || !email) {
      throw new HttpsError("invalid-argument", "Nombre y correo son requeridos.");
    }

    // Credenciales desde Firebase config (firebase functions:config:set mail.user mail.pass)
    const mailUser = (functions.config().mail || {}).user || "";
    const mailPass = (functions.config().mail || {}).pass || "";

    if (!mailUser || !mailPass) {
      // Si no hay config de correo, solo loguear — no bloquear el flujo
      logger.warn("[enviarCorreoSolicitud] Sin config mail.user/mail.pass — correo omitido.");
      return { ok: true, sent: false, reason: "no_mail_config" };
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: mailUser, pass: mailPass },
    });

    const html = `
      <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;background:#f8fafc;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#0b2548,#1a53a0);padding:32px 36px;">
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:900;">Armenta Rent A Car</h1>
          <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">Sistema de Administración de Flota</p>
        </div>
        <div style="padding:32px 36px;background:#fff;">
          <h2 style="color:#0f172a;font-size:18px;font-weight:800;margin:0 0 8px;">Solicitud recibida ✓</h2>
          <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">
            Hola <strong>${nombre}</strong>, recibimos tu solicitud de acceso al sistema.<br>
            Un administrador revisará tu solicitud y te notificará sobre la decisión.
          </p>
          <div style="background:#f1f5f9;border-radius:12px;padding:18px 20px;margin-bottom:24px;">
            <div style="font-size:12px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Datos de tu solicitud</div>
            <div style="font-size:13px;color:#334155;"><strong>Nombre:</strong> ${nombre}</div>
            <div style="font-size:13px;color:#334155;margin-top:6px;"><strong>Correo:</strong> ${email}</div>
            <div style="font-size:13px;color:#334155;margin-top:6px;"><strong>Puesto solicitado:</strong> ${puesto || "—"}</div>
          </div>
          <p style="color:#94a3b8;font-size:12px;margin:0;">
            Si no solicitaste acceso, ignora este correo.
          </p>
        </div>
        <div style="padding:16px 36px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="color:#cbd5e1;font-size:11px;margin:0;text-align:center;">Armenta Rent A Car · Sistema MEX Mapa</p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"Armenta Rent A Car" <${mailUser}>`,
      to: email,
      subject: "Solicitud de acceso recibida — Armenta Rent A Car",
      html,
    });

    logger.info("[enviarCorreoSolicitud] Correo enviado a", email);
    return { ok: true, sent: true };
  });

// ══════════════════════════════════════════════════════════════
//  MEX API — REST pública con API Keys
//  Fase 1: gestión de keys + endpoints GET (unidades, historial, mapa)
//
//  Flujo:
//    1. Cliente externo envía header X-API-Key: mex_live_<hex>
//    2. Se valida la key contra Firestore (por lookupId + hash SHA-256)
//    3. Se verifica rate limit (por día y por minuto)
//    4. Se verifica permiso específico del endpoint
//    5. Se ejecuta la query y se devuelve JSON
//    6. Se registra la llamada en api_key_logs (async)
//
//  Seguridad: la key en texto plano NUNCA se almacena en Firestore,
//  solo su hash SHA-256. El texto plano solo se muestra al crear la key.
// ══════════════════════════════════════════════════════════════

const API_KEYS_COL   = "api_keys";
const API_KEY_USAGE_COL = "api_key_usage";
const API_KEY_LOGS_COL  = "api_key_logs";
const MEX_KEY_LIVE_PREFIX = "mex_live_";
const MEX_KEY_TEST_PREFIX = "mex_test_";
const MEX_KEY_LOOKUP_LEN  = 10; // chars usados como ID de búsqueda rápida

// ─── Helpers de criptografía ─────────────────────────────────

function sha256hex(str) {
  return crypto.createHash("sha256").update(String(str), "utf8").digest("hex");
}

function mexKeyLookupId(rawKey) {
  if (rawKey.startsWith(MEX_KEY_LIVE_PREFIX)) {
    return rawKey.slice(MEX_KEY_LIVE_PREFIX.length, MEX_KEY_LIVE_PREFIX.length + MEX_KEY_LOOKUP_LEN);
  }
  if (rawKey.startsWith(MEX_KEY_TEST_PREFIX)) {
    return rawKey.slice(MEX_KEY_TEST_PREFIX.length, MEX_KEY_TEST_PREFIX.length + MEX_KEY_LOOKUP_LEN);
  }
  return "";
}

function generateMexApiKey(isTest = false) {
  const prefix = isTest ? MEX_KEY_TEST_PREFIX : MEX_KEY_LIVE_PREFIX;
  return prefix + crypto.randomBytes(24).toString("hex"); // 48 hex chars
}

// ─── Validación de API key ────────────────────────────────────

async function resolveApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return null;
  const isLive = rawKey.startsWith(MEX_KEY_LIVE_PREFIX);
  const isTest = rawKey.startsWith(MEX_KEY_TEST_PREFIX);
  if (!isLive && !isTest) return null;

  const lookupId = mexKeyLookupId(rawKey);
  if (!lookupId) return null;
  const hash = sha256hex(rawKey);

  // Búsqueda por lookupId (índice automático de Firestore), luego verificar hash
  const snap = await db.collection(API_KEYS_COL)
    .where("lookupId", "==", lookupId)
    .limit(5)
    .get();

  if (snap.empty) return null;

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.keyHash === hash) {
      if (d.status !== "ACTIVA") return null;
      return { _docId: doc.id, ...d };
    }
  }
  return null;
}

// ─── Rate limiting ────────────────────────────────────────────

async function checkAndIncrementRateLimit(keyDocId, limites) {
  const dailyLimit  = Math.max(1, Number(limites?.llamadasPorDia)    || 5000);
  const minuteLimit = Math.max(1, Number(limites?.llamadasPorMinuto) || 60);

  const now = new Date();
  // Campos "planos" para evitar subcollections innecesarias
  const dayField = "d_" + now.toISOString().slice(0, 10).replace(/-/g, ""); // d_20260420
  const minField = "m_" + now.toISOString().slice(0, 16).replace(/[-T:]/g, ""); // m_202604201030

  const usageRef = db.collection(API_KEY_USAGE_COL).doc(keyDocId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const data = snap.exists ? snap.data() : {};
    const dayCount = (data[dayField] || 0) + 1;
    const minCount = (data[minField] || 0) + 1;

    if (dayCount  > dailyLimit)  return { allowed: false, reason: "rate_limit_daily",  limit: dailyLimit };
    if (minCount  > minuteLimit) return { allowed: false, reason: "rate_limit_minute", limit: minuteLimit };

    tx.set(usageRef, {
      [dayField]: dayCount,
      [minField]: minCount,
      _lastCall: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return { allowed: true };
  });
}

// ─── Errores tipados para routes ──────────────────────────────

class ApiPermissionError extends Error {
  constructor(msg) { super(msg); this.apiCode = "permission_denied"; }
}
class ApiNotFoundError extends Error {
  constructor(msg) { super(msg); this.apiCode = "not_found"; }
}
class ApiInvalidArgError extends Error {
  constructor(msg) { super(msg); this.apiCode = "invalid_argument"; }
}

function requireApiPermiso(keyDoc, recurso, accion) {
  if (!keyDoc?.permisos?.[recurso]?.[accion]) {
    throw new ApiPermissionError(`Sin permiso: ${recurso}.${accion}`);
  }
}

function requireApiPlazaScope(keyDoc, plaza) {
  if (!plaza) throw new ApiInvalidArgError("Plaza requerida.");
  const scope = keyDoc?.scope || {};
  if (scope.global === true) return;
  const allowed = Array.isArray(scope.plazas)
    ? scope.plazas.map(normalizePlaza)
    : [];
  if (!allowed.includes(normalizePlaza(plaza))) {
    throw new ApiPermissionError(`Sin acceso a plaza: ${plaza}`);
  }
}

// ─── Handlers por endpoint ────────────────────────────────────

async function apiHandleGetUnidades(req, keyDoc) {
  requireApiPermiso(keyDoc, "unidades", "leer");
  const plaza = normalizePlaza(req.query.plaza || "");
  if (!plaza) throw new ApiInvalidArgError("Parámetro 'plaza' requerido.");
  requireApiPlazaScope(keyDoc, plaza);

  const estado    = normalizeUpper(req.query.estado    || "");
  const categoria = normalizeUpper(req.query.categoria || "");
  const limit     = Math.min(Math.max(1, parseInt(req.query.limit) || 100), 500);

  let q = db.collection("cuadre").where("plaza", "==", plaza);
  if (estado)    q = q.where("estado",    "==", estado);
  if (categoria) q = q.where("categoria", "==", categoria);
  q = q.limit(limit);

  const snap = await q.get();
  const data = snap.docs.map(d => serializeFirestoreValue({ id: d.id, ...d.data() }));
  return { ok: true, data, meta: { total: data.length, plaza, timestamp: nowIso() } };
}

async function apiHandleGetUnidad(mva, keyDoc) {
  requireApiPermiso(keyDoc, "unidades", "leer");
  const snap = await db.collection("cuadre")
    .where("mva", "==", normalizeUpper(mva))
    .limit(1)
    .get();
  if (snap.empty) throw new ApiNotFoundError(`Unidad no encontrada: ${mva}`);
  const doc  = snap.docs[0];
  const data = serializeFirestoreValue({ id: doc.id, ...doc.data() });
  requireApiPlazaScope(keyDoc, data.plaza || "");
  return { ok: true, data, meta: { timestamp: nowIso() } };
}

async function apiHandleGetHistorial(req, keyDoc) {
  requireApiPermiso(keyDoc, "historial", "leer");
  const plaza = normalizePlaza(req.query.plaza || "");
  if (!plaza) throw new ApiInvalidArgError("Parámetro 'plaza' requerido.");
  requireApiPlazaScope(keyDoc, plaza);
  const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 50), 200);

  const snap = await db.collection("historial_patio")
    .where("plaza", "==", plaza)
    .orderBy("timestamp", "desc")
    .limit(limit)
    .get();

  const data = snap.docs.map(d => serializeFirestoreValue({ id: d.id, ...d.data() }));
  return { ok: true, data, meta: { total: data.length, plaza, timestamp: nowIso() } };
}

async function apiHandleGetMapa(plaza, keyDoc) {
  requireApiPermiso(keyDoc, "mapa", "leer");
  requireApiPlazaScope(keyDoc, plaza);
  const plazaKey = normalizePlaza(plaza);
  const snap = await db.collection("mapa_config").doc(plazaKey)
    .collection("estructura")
    .get();
  if (snap.empty) throw new ApiNotFoundError(`Sin configuración de mapa para: ${plaza}`);
  const data = snap.docs.map(d => serializeFirestoreValue({ id: d.id, ...d.data() }));
  return { ok: true, data, meta: { plaza: plazaKey, total: data.length, timestamp: nowIso() } };
}

// ─── Logger async (fire-and-forget) ──────────────────────────

function apiLogCall(keyDoc, endpoint, statusCode, latencyMs, req) {
  db.collection(API_KEY_LOGS_COL).add({
    keyDocId:  normalizeString(keyDoc?._docId  || ""),
    keyNombre: normalizeString(keyDoc?.nombre  || ""),
    endpoint,
    status:    statusCode,
    latencyMs,
    ip:        normalizeString(req.headers["x-forwarded-for"] || req.ip || ""),
    userAgent: normalizeString(req.headers["user-agent"] || ""),
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  }).catch(err => logger.warn("[mexApi] Error escribiendo log:", err.message));
}

// ─── FUNCIÓN PRINCIPAL HTTP ───────────────────────────────────

exports.mexApi = functions.region(REGION).https.onRequest(async (req, res) => {
  // CORS — permite llamadas desde cualquier origen
  res.set("Access-Control-Allow-Origin",  "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "X-API-Key, Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  const startMs = Date.now();
  const method  = normalizeString(req.method);

  function apiErr(status, code, message) {
    res.status(status).json({ ok: false, error: { code, message } });
  }

  // 1. Extraer key
  const rawKey = normalizeString(
    req.headers["x-api-key"] || req.headers["X-API-Key"] || req.query.api_key || ""
  );
  if (!rawKey) {
    return apiErr(401, "missing_key", "API key requerida. Usa el header X-API-Key.");
  }

  // 2. Validar key
  let keyDoc;
  try {
    keyDoc = await resolveApiKey(rawKey);
  } catch (err) {
    logger.error("[mexApi] Error validando key:", err.message);
    return apiErr(500, "server_error", "Error interno.");
  }
  if (!keyDoc) {
    return apiErr(401, "invalid_key", "API key inválida o revocada.");
  }

  // 3. Rate limit
  let rl;
  try {
    rl = await checkAndIncrementRateLimit(keyDoc._docId, keyDoc.limites);
  } catch (err) {
    logger.error("[mexApi] Error en rate limit:", err.message);
    return apiErr(500, "server_error", "Error interno al verificar límite.");
  }
  if (!rl.allowed) {
    res.set("Retry-After", "60");
    return apiErr(429, rl.reason, `Límite excedido. Máx: ${rl.limit} llamadas.`);
  }

  // 4. Routing  — /v1/<recurso>[/<id>]
  const segments   = normalizeString(req.path).replace(/^\//, "").split("/").filter(Boolean);
  const version    = segments[0] || "";
  const resource   = segments[1] || "";
  const resourceId = segments[2] || "";
  const endpoint   = `${method} /${segments.join("/")}`;

  if (version !== "v1") {
    return apiErr(404, "not_found", "Versión no soportada. Usa /v1/...");
  }

  let result;
  try {
    if (resource === "ping" && method === "GET") {
      result = { ok: true, data: { pong: true, keyNombre: keyDoc.nombre, timestamp: nowIso() } };

    } else if (resource === "unidades" && method === "GET" && !resourceId) {
      result = await apiHandleGetUnidades(req, keyDoc);

    } else if (resource === "unidades" && method === "GET" && resourceId) {
      result = await apiHandleGetUnidad(resourceId, keyDoc);

    } else if (resource === "historial" && method === "GET") {
      result = await apiHandleGetHistorial(req, keyDoc);

    } else if (resource === "mapa" && method === "GET" && resourceId) {
      result = await apiHandleGetMapa(resourceId, keyDoc);

    } else {
      return apiErr(404, "not_found", `Endpoint no soportado: ${endpoint}`);
    }
  } catch (err) {
    const latency = Date.now() - startMs;
    if (err instanceof ApiPermissionError) {
      apiLogCall(keyDoc, endpoint, 403, latency, req);
      return apiErr(403, "permission_denied", err.message);
    }
    if (err instanceof ApiNotFoundError) {
      apiLogCall(keyDoc, endpoint, 404, latency, req);
      return apiErr(404, "not_found", err.message);
    }
    if (err instanceof ApiInvalidArgError) {
      apiLogCall(keyDoc, endpoint, 400, latency, req);
      return apiErr(400, "invalid_argument", err.message);
    }
    logger.error(`[mexApi] Error en ${endpoint}:`, err.message);
    return apiErr(500, "server_error", "Error interno del servidor.");
  }

  const latency = Date.now() - startMs;
  apiLogCall(keyDoc, endpoint, 200, latency, req);
  res.status(200).json(result);
});

// ══════════════════════════════════════════════════════════════
//  crearApiKey — HTTPS callable (solo PROGRAMADOR)
//  Genera y almacena una nueva API key. La key en texto plano
//  se devuelve UNA SOLA VEZ — después es irrecuperable.
// ══════════════════════════════════════════════════════════════

exports.crearApiKey = functions.region(REGION).https.onCall(async (data, context) => {
  const actor = await requireProgrammerAuth(context);

  const nombre      = normalizeString(data?.nombre      || "");
  const descripcion = normalizeString(data?.descripcion || "");
  if (!nombre) throw new HttpsError("invalid-argument", "El campo 'nombre' es requerido.");

  const isTest   = data?.test === true;
  const rawKey   = generateMexApiKey(isTest);
  const lookupId = mexKeyLookupId(rawKey);
  const keyHash  = sha256hex(rawKey);

  // Permisos por defecto: solo lectura de unidades y mapa
  const defaultPermisos = {
    unidades:  { leer: true,  escribir: false, borrar: false },
    mapa:      { leer: true,  escribir: false, borrar: false },
    historial: { leer: false, escribir: false, borrar: false },
    cuadre:    { leer: false, escribir: false, borrar: false },
    alertas:   { leer: false, escribir: false, borrar: false }
  };

  const permisos = (data?.permisos && typeof data.permisos === "object")
    ? sanitizePlainObject(data.permisos)
    : defaultPermisos;

  const scope = (data?.scope && typeof data.scope === "object")
    ? sanitizePlainObject(data.scope)
    : { plazas: [], global: false };

  const limites = {
    llamadasPorMinuto: Math.min(Math.max(1, parseInt(data?.limites?.llamadasPorMinuto) || 60), 600),
    llamadasPorDia:    Math.min(Math.max(1, parseInt(data?.limites?.llamadasPorDia)    || 5000), 100000)
  };

  const docData = {
    nombre, descripcion, lookupId, keyHash,
    status: "ACTIVA",
    scope, permisos, limites,
    test: isTest,
    creadoPor: normalizeString(actor.data?.email || actor.id),
    creadoEn:  admin.firestore.FieldValue.serverTimestamp()
  };

  const docRef = await db.collection(API_KEYS_COL).add(docData);

  await recordProgrammerAudit({
    actor:     normalizeString(actor.data?.nombre || actor.data?.email || actor.id),
    actorRole: actor.role,
    action:    "crearApiKey",
    keyId:     docRef.id,
    keyNombre: nombre,
    isTest
  });

  logger.info("[crearApiKey] Creada key:", docRef.id, "nombre:", nombre);
  // La key en texto plano se devuelve UNA sola vez aquí
  return { ok: true, keyId: docRef.id, key: rawKey, nombre, isTest };
});

// ══════════════════════════════════════════════════════════════
//  revocarApiKey — HTTPS callable (solo PROGRAMADOR)
//  Cambia el status de una key a REVOCADA, SUSPENDIDA o ACTIVA.
// ══════════════════════════════════════════════════════════════

exports.revocarApiKey = functions.region(REGION).https.onCall(async (data, context) => {
  const actor = await requireProgrammerAuth(context);
  const keyId = normalizeString(data?.keyId || "");
  if (!keyId) throw new HttpsError("invalid-argument", "keyId requerido.");

  const nuevoStatus = normalizeUpper(data?.status || "REVOCADA");
  if (!["REVOCADA", "SUSPENDIDA", "ACTIVA"].includes(nuevoStatus)) {
    throw new HttpsError("invalid-argument", "status debe ser REVOCADA, SUSPENDIDA o ACTIVA.");
  }

  const ref  = db.collection(API_KEYS_COL).doc(keyId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", `API key no encontrada: ${keyId}`);

  await ref.update({
    status:     nuevoStatus,
    _updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await recordProgrammerAudit({
    actor:       normalizeString(actor.data?.nombre || actor.data?.email || actor.id),
    actorRole:   actor.role,
    action:      "revocarApiKey",
    keyId,
    nuevoStatus
  });

  return { ok: true, keyId, status: nuevoStatus };
});

// ══════════════════════════════════════════════════════════════
//  listarApiKeys — HTTPS callable (solo PROGRAMADOR)
//  Lista todas las API keys SIN exponer el keyHash.
// ══════════════════════════════════════════════════════════════

exports.listarApiKeys = functions.region(REGION).https.onCall(async (_data, context) => {
  await requireProgrammerAuth(context);

  const snap = await db.collection(API_KEYS_COL)
    .orderBy("creadoEn", "desc")
    .limit(200)
    .get();

  const data = snap.docs.map(doc => {
    const { keyHash: _omit, ...safe } = doc.data();
    return { keyId: doc.id, ...serializeFirestoreValue(safe) };
  });

  return { ok: true, data };
});
