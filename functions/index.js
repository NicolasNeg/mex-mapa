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
const ACCESS_REQUESTS_PRIMARY_COL = "solicitudes";
const ACCESS_REQUESTS_LEGACY_COL = "solicitudes_acceso";
const SUPERADMINS_COL = "superadmins";
const PROGRAMMER_ROLES = new Set(["PROGRAMADOR", "JEFE_OPERACION", "CORPORATIVO_USER"]);
const ADMIN_ROLES = new Set(["VENTAS", "SUPERVISOR", "JEFE_PATIO", "GERENTE_PLAZA", "JEFE_REGIONAL", "CORPORATIVO_USER", "PROGRAMADOR", "JEFE_OPERACION"]);
const BOOTSTRAP_PROGRAMMER_EMAILS = new Set(["angelarmentta@icloud.com", "armentanegreteangelnicolas@gmail.com"]);
const DEFAULT_ROLE_SPECS = Object.freeze({
  AUXILIAR:         { label: "AUXILIAR", isAdmin: false, fullAccess: false, needsPlaza: true, multiPlaza: false },
  VENTAS:           { label: "VENTAS", isAdmin: true, fullAccess: false, needsPlaza: true, multiPlaza: false },
  SUPERVISOR:       { label: "SUPERVISOR", isAdmin: true, fullAccess: false, needsPlaza: true, multiPlaza: false },
  JEFE_PATIO:       { label: "JEFE DE PATIO", isAdmin: true, fullAccess: false, needsPlaza: true, multiPlaza: false },
  GERENTE_PLAZA:    { label: "GERENTE DE PLAZA", isAdmin: true, fullAccess: false, needsPlaza: true, multiPlaza: false },
  JEFE_REGIONAL:    { label: "JEFE REGIONAL", isAdmin: true, fullAccess: false, needsPlaza: true, multiPlaza: true },
  CORPORATIVO_USER: { label: "CORPORATIVO USER", isAdmin: true, fullAccess: true, needsPlaza: false, multiPlaza: true },
  PROGRAMADOR:      { label: "PROGRAMADOR", isAdmin: true, fullAccess: true, needsPlaza: false, multiPlaza: true },
  JEFE_OPERACION:   { label: "JEFE DE OPERACION", isAdmin: true, fullAccess: true, needsPlaza: false, multiPlaza: true }
});
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
    throw new HttpsError("invalid-argument", `${label} debe apuntar a una colecci├│n v├ílida.`);
  }
  return normalized;
}

function requireDocumentPath(path, label = "docPath") {
  const normalized = normalizeFirestorePath(path);
  if (!isDocumentPath(normalized)) {
    throw new HttpsError("invalid-argument", `${label} debe apuntar a un documento v├ílido.`);
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
    .join(" ┬À ");
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

function permissionOverrideValue(profileData = {}, key = "") {
  const overrides = profileData?.permissionOverrides;
  if (!overrides || typeof overrides !== "object") return undefined;
  return typeof overrides[key] === "boolean" ? overrides[key] : undefined;
}

function rolePermissionValue(role, permissionKey, security = {}) {
  const normalizedRole = normalizeUpper(role);
  const configured = security?.roles?.[normalizedRole];
  const configuredPermissions = configured && typeof configured.permissions === "object" ? configured.permissions : {};
  if (configured?.fullAccess === true) return true;
  if (typeof configuredPermissions[permissionKey] === "boolean") return configuredPermissions[permissionKey];
  if (PROGRAMMER_ROLES.has(normalizedRole)) return true;
  if (permissionKey === "process_access_requests") return normalizedRole === "CORPORATIVO_USER";
  if (permissionKey === "manage_users") return normalizedRole === "CORPORATIVO_USER";
  if (permissionKey === "assign_roles") return normalizedRole === "CORPORATIVO_USER";
  return false;
}

function hasRolePermission(profileData = {}, role, permissionKey, security = {}) {
  const override = permissionOverrideValue(profileData, permissionKey);
  if (typeof override === "boolean") return override;
  return rolePermissionValue(role, permissionKey, security);
}

function roleDefinition(role, security = {}) {
  const normalizedRole = normalizeUpper(role);
  const fallback = DEFAULT_ROLE_SPECS[normalizedRole] || DEFAULT_ROLE_SPECS.AUXILIAR;
  const configured = security?.roles?.[normalizedRole];
  return {
    label: normalizeString(configured?.label || fallback.label || normalizedRole) || normalizedRole,
    isAdmin: typeof configured?.isAdmin === "boolean" ? configured.isAdmin : fallback.isAdmin,
    fullAccess: typeof configured?.fullAccess === "boolean" ? configured.fullAccess : fallback.fullAccess,
    needsPlaza: typeof configured?.needsPlaza === "boolean" ? configured.needsPlaza : fallback.needsPlaza,
    multiPlaza: typeof configured?.multiPlaza === "boolean" ? configured.multiPlaza : fallback.multiPlaza,
    permissions: configured && typeof configured.permissions === "object" ? configured.permissions : {}
  };
}

function canProcessAccessRequestsBackend(role, security = {}, profileData = {}) {
  return hasRolePermission(profileData, role, "process_access_requests", security);
}

function canManageUsersBackend(role, security = {}, profileData = {}) {
  return hasRolePermission(profileData, role, "manage_users", security);
}

function canAssignRolesBackend(role, security = {}, profileData = {}) {
  return hasRolePermission(profileData, role, "assign_roles", security);
}

function canActorManageTargetRole(actorRole, targetRole, security = {}) {
  const actor = normalizeUpper(actorRole);
  const target = normalizeUpper(targetRole);
  if (!target) return false;
  if (actor === "PROGRAMADOR" || actor === "JEFE_OPERACION") return true;
  if (actor !== "CORPORATIVO_USER") return false;
  if (target === "CORPORATIVO_USER" || target === "PROGRAMADOR" || target === "JEFE_OPERACION") return false;
  const meta = roleDefinition(target, security);
  if (meta.fullAccess) return false;
  return !(
    meta.permissions?.use_programmer_console === true
    || meta.permissions?.manage_system_settings === true
  );
}

function preferredAccessRequestCollections(preferred = "") {
  return Array.from(new Set(
    [preferred, ACCESS_REQUESTS_PRIMARY_COL, ACCESS_REQUESTS_LEGACY_COL]
      .map((entry) => normalizeString(entry))
      .filter(Boolean)
  ));
}

async function resolveAccessRequestDoc(docId, preferredCollection = "") {
  const normalizedId = normalizeLower(docId);
  if (!normalizedId) {
    throw new HttpsError("invalid-argument", "Solicitud inv├ílida.");
  }
  for (const collectionName of preferredAccessRequestCollections(preferredCollection)) {
    const snap = await db.collection(collectionName).doc(normalizedId).get();
    if (snap.exists) {
      return {
        id: snap.id,
        ref: snap.ref,
        collectionName,
        data: snap.data() || {}
      };
    }
  }
  throw new HttpsError("not-found", "La solicitud ya no existe.");
}

async function resolveUserProfileDocRefByEmail(email, authUser = null) {
  const normalizedEmail = normalizeLower(email);
  if (!normalizedEmail) {
    throw new HttpsError("invalid-argument", "Correo inv├ílido.");
  }
  const direct = await db.collection(USERS_COL).doc(normalizedEmail).get();
  if (direct.exists) return direct.ref;

  const byEmail = await db.collection(USERS_COL).where("email", "==", normalizedEmail).limit(1).get();
  if (!byEmail.empty) return byEmail.docs[0].ref;

  if (authUser?.uid) {
    const byUid = await db.collection(USERS_COL).doc(authUser.uid).get();
    if (byUid.exists) return byUid.ref;
  }

  return db.collection(USERS_COL).doc(normalizedEmail);
}

function normalizeUniquePlazas(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((entry) => normalizePlaza(entry))
    .filter(Boolean)));
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

function isActiveUserProfile(data = {}) {
  const hasOwn = key => Object.prototype.hasOwnProperty.call(data, key);
  const status = hasOwn("status") ? data.status : "";
  const flags = ["activo", "autorizado", "accesoSistema"];
  if (typeof status !== "string") return false;
  if (flags.some(key => hasOwn(key) && typeof data[key] !== "boolean")) return false;
  if (flags.some(key => data[key] === false)) return false;
  if (hasOwn("authUid") && typeof data.authUid !== "string") return false;
  return !["INACTIVO", "RECHAZADO", "BLOQUEADO", "SUSPENDIDO"].includes(normalizeUpper(status));
}

function assertProfileMatchesAuth(profile, auth) {
  const data = profile?.data || {};
  if (!isActiveUserProfile(data)) {
    throw new HttpsError("permission-denied", "Perfil inactivo o bloqueado.");
  }

  const linkedUid = normalizeString(data.authUid || "");
  if (linkedUid && linkedUid !== auth.uid) {
    throw new HttpsError("permission-denied", "El perfil no corresponde a esta sesion.");
  }
  return profile;
}

async function findUserProfileFromAuth(auth) {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sesi├│n requerida.");
  const email = normalizeLower(auth.token?.email);
  if (email) {
    const direct = await db.collection(USERS_COL).doc(email).get();
    if (direct.exists) {
      return assertProfileMatchesAuth({ id: direct.id, ref: direct.ref, data: direct.data() || {} }, auth);
    }

    const byEmail = await db.collection(USERS_COL).where("email", "==", email).limit(1).get();
    if (!byEmail.empty) {
      const doc = byEmail.docs[0];
      return assertProfileMatchesAuth({ id: doc.id, ref: doc.ref, data: doc.data() || {} }, auth);
    }
  }

  const byUid = await db.collection(USERS_COL).doc(auth.uid).get();
  if (byUid.exists) {
    return assertProfileMatchesAuth({ id: byUid.id, ref: byUid.ref, data: byUid.data() || {} }, auth);
  }

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
    db.collection(USERS_COL).where("authUid", "==", raw).limit(5).get().then(snap => snap.docs.forEach(doc => found.set(doc.id, doc.ref.path))),
    db.collection(USERS_COL).where("uid", "==", raw).limit(5).get().then(snap => snap.docs.forEach(doc => found.set(doc.id, doc.ref.path))),
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

function cuadreMissionTargetFromSettings(settings = {}) {
  const direct = normalizeString(
    settings.cuadreDestinoDocId ||
    settings.destinatarioDocId ||
    settings.auxiliarDocId ||
    settings.recipientDocId ||
    ""
  );
  if (direct) return direct;
  try {
    const parsed = typeof settings.misionAuditoria === "string"
      ? JSON.parse(settings.misionAuditoria || "{}")
      : (settings.misionAuditoria || {});
    return normalizeString(
      parsed.destinatarioDocId ||
      parsed.auxiliarDocId ||
      parsed.recipientDocId ||
      parsed.docId ||
      ""
    );
  } catch (_) {
    return "";
  }
}

async function resolveCuadreRecipients(plaza, adminIniciador = "", settings = {}) {
  const selectedDocId = cuadreMissionTargetFromSettings(settings);
  if (selectedDocId) return [selectedDocId];
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

async function resolveCuadreReviewRecipients(plaza, actorName = "", security = {}, settings = {}) {
  const plazaUp = normalizePlaza(plaza);
  const byPlaza = await db.collection(USERS_COL).where("plazaAsignada", "==", plazaUp).limit(200).get();
  const admins = byPlaza.docs.filter(doc => {
    const data = doc.data() || {};
    const role = inferRole(data, data.email);
    const sameActor = normalizeUpper(data.nombre || data.usuario) === normalizeUpper(actorName);
    if (sameActor) return false;
    return isOperationalAdmin(role, security, data);
  }).map(doc => doc.id);

  // Priorizar al admin que inici├│ la misi├│n; mantener al resto de admins de plaza.
  const iniciadorDocId = normalizeString(
    settings.adminIniciadorDocId
    || settings.creadorDocId
    || settings.cuadreIniciadorDocId
    || ""
  );
  if (!iniciadorDocId) return admins;
  const ordered = [iniciadorDocId, ...admins.filter(id => id !== iniciadorDocId)];
  return [...new Set(ordered)];
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
  return type === "URGENTE" || type === "CRITICA" || type === "CR├ìTICA" || type === "ALTA";
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

exports.onCriticalAlertCreated = functions.region(REGION).firestore.document("alertas/{alertId}").onCreate(async (snap, context) => {
  try {
    const data = snap.data();
    if (!data || !isCriticalAlert(data)) return;
    const recipients = await resolveAlertRecipients(data);
    const eventId = `alert_${context.params.alertId}`;
    const actorName = normalizeString(data.autor || data.actor || "Sistema");
    const title = normalizeString(data.titulo || "Alerta cr├¡tica");
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

    const adminName = normalizeString(after.adminIniciador || "Operaci├│n");
    const actorName = normalizeString(after.ultimoEditor || adminName || "Operaci├│n");
    const security = await loadSecurityConfig();
    const recipients = shouldNotifyMission
      ? await resolveCuadreRecipients(plazaId, adminName, after)
      : await resolveCuadreReviewRecipients(plazaId, actorName, security, after);
    const eventType = shouldNotifyMission
      ? (previousState === "PROCESO" ? "cuadre.updated" : "cuadre.assigned")
      : "cuadre.review_ready";
    const eventId = `cuadre_${eventType.replace(/\./g, "_")}_${plazaId}_${timestampToMillis(after.ultimaModificacion) || nowMillis()}`;
    const title = shouldNotifyMission
      ? (previousState === "PROCESO" ? `Misi├│n de cuadre actualizada en ${plazaId}` : `Nueva misi├│n de cuadre en ${plazaId}`)
      : `Auditor├¡a lista para revisar en ${plazaId}`;
    const body = shouldNotifyMission
      ? (adminName ? `${adminName} te envi├│ la misi├│n del cuadre.` : "Ya tienes una nueva misi├│n de cuadre asignada.")
      : `${actorName || "Patio"} termin├│ la auditor├¡a y ya puedes finalizar el cuadre.`;
    const missionId = normalizeString(after.cuadreMissionId || "");
    const deepLink = shouldNotifyMission
      ? `/app/cuadrarflota?plaza=${encodeURIComponent(plazaId)}${missionId ? `&missionId=${encodeURIComponent(missionId)}` : ""}&source=push`
      : `/app/cuadre?notif=cuadre&plaza=${encodeURIComponent(plazaId)}`;

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
        missionId,
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
        missionId,
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
    throw new HttpsError("invalid-argument", "parentPath debe apuntar a un documento o venir vac├¡o.");
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
  const body = normalizeString(params.body || "Esta es una notificaci├│n de prueba enviada desde la consola.");
  const recipients = await resolveUserDocIdsByHandle(target);
  if (!recipients.length) throw new HttpsError("not-found", "No se encontr├│ el usuario destino.");
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

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
//  enviarCorreoSolicitud ÔÇö HTTPS callable
//  Env├¡a un correo de confirmaci├│n al solicitante de acceso.
//  Credenciales SMTP via Firebase config:
//    firebase functions:config:set mail.user="..." mail.pass="..."
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
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
      // Si no hay config de correo, solo loguear ÔÇö no bloquear el flujo
      logger.warn("[enviarCorreoSolicitud] Sin config mail.user/mail.pass ÔÇö correo omitido.");
      return { ok: true, sent: false, reason: "no_mail_config" };
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: mailUser, pass: mailPass },
    });

    const html = `
      <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;background:#f8fafc;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#0b2548,#1a53a0);padding:32px 36px;">
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:900;">MapGestion</h1>
          <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">Sistema de Administraci├│n de Flota</p>
        </div>
        <div style="padding:32px 36px;background:#fff;">
          <h2 style="color:#0f172a;font-size:18px;font-weight:800;margin:0 0 8px;">Solicitud recibida</h2>
          <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">
            Hola <strong>${nombre}</strong>, recibimos tu solicitud de acceso al sistema.<br>
            Un administrador revisar├í tu solicitud y te notificar├í sobre la decisi├│n.
          </p>
          <div style="background:#f1f5f9;border-radius:12px;padding:18px 20px;margin-bottom:24px;">
            <div style="font-size:12px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Datos de tu solicitud</div>
            <div style="font-size:13px;color:#334155;"><strong>Nombre:</strong> ${nombre}</div>
            <div style="font-size:13px;color:#334155;margin-top:6px;"><strong>Correo:</strong> ${email}</div>
            <div style="font-size:13px;color:#334155;margin-top:6px;"><strong>Puesto solicitado:</strong> ${puesto || "ÔÇö"}</div>
          </div>
          <p style="color:#94a3b8;font-size:12px;margin:0;">
            Si no solicitaste acceso, ignora este correo.
          </p>
        </div>
        <div style="padding:16px 36px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="color:#cbd5e1;font-size:11px;margin:0;text-align:center;">MapGestion ┬À Sistema MEX Mapa</p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"MapGestion" <${mailUser}>`,
      to: email,
      subject: "Solicitud de acceso recibida ÔÇö MapGestion",
      html,
    });

    logger.info("[enviarCorreoSolicitud] Correo enviado a", email);
    return { ok: true, sent: true };
  });

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
//  verifyRecaptchaLogin ÔÇö HTTPS callable (sin auth)
//
//  Preferido en login: reCAPTCHA v2 checkbox (provider: "v2").
//  Secreto de servidor (NUNCA en cliente):
//    firebase functions:config:set recaptcha.v2_secret="TU_SECRET"
//    o env RECAPTCHA_V2_SECRET
//
//  Legacy: reCAPTCHA Enterprise (provider omitido / "enterprise"):
//    firebase functions:config:set recaptcha.api_key="TU_API_KEY"
//    firebase functions:config:set recaptcha.min_score="0.35"
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
exports.verifyRecaptchaLogin = functions.region(REGION).https.onCall(async (data) => {
  try {
    const token = normalizeString(data?.token);
    const provider = normalizeString(data?.provider || data?.version || "v2").toLowerCase();

    if (!token) {
      return { ok: false, code: "token_required", message: "Token reCAPTCHA requerido." };
    }

    const cfg = functions.config().recaptcha || {};

    // ÔöÇÔöÇ v2 checkbox ÔåÆ Google siteverify ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    if (provider === "v2" || provider === "checkbox") {
      const secret = normalizeString(cfg.v2_secret || process.env.RECAPTCHA_V2_SECRET);
      if (!secret) {
        logger.error("[verifyRecaptchaLogin] Falta RECAPTCHA_V2_SECRET / recaptcha.v2_secret");
        return {
          ok: false,
          code: "recaptcha_config_missing",
          message: "Servidor sin secreto reCAPTCHA v2. Configura RECAPTCHA_V2_SECRET (o recaptcha.v2_secret).",
        };
      }

      let res;
      try {
        const body = new URLSearchParams({
          secret,
          response: token,
        });
        res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
      } catch (e) {
        logger.error("[verifyRecaptchaLogin] v2 siteverify fetch error", e);
        return {
          ok: false,
          code: "recaptcha_unavailable",
          message: "No se pudo contactar reCAPTCHA.",
        };
      }

      const assessment = await res.json().catch(() => ({}));
      if (!res.ok) {
        logger.warn("[verifyRecaptchaLogin] v2 API HTTP error", res.status, assessment);
        return {
          ok: false,
          code: "recaptcha_api_error",
          message: "Verificaci├│n de seguridad no disponible.",
          status: res.status,
        };
      }

      if (!assessment.success) {
        logger.info("[verifyRecaptchaLogin] v2 token inv├ílido", assessment["error-codes"]);
        return {
          ok: false,
          code: "token_invalid",
          message: "Verificaci├│n de seguridad fallida. Marca ┬½No soy un robot┬╗ de nuevo.",
        };
      }

      return { ok: true, provider: "v2" };
    }

    // ÔöÇÔöÇ Legacy Enterprise assessment ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    const expectedAction = normalizeString(data?.action || "LOGIN_EMAIL");
    const siteKey = "6Lf1714tAAAAAK3wyyOhB8nCk6JRh7uwIFlR6ufC";
    const projectId = "mex-mapa-bjx";

    const apiKey = normalizeString(cfg.api_key || process.env.RECAPTCHA_ENTERPRISE_API_KEY);
    if (!apiKey) {
      logger.error("[verifyRecaptchaLogin] Falta recaptcha.api_key en functions config");
      return {
        ok: false,
        code: "recaptcha_config_missing",
        message: "Servidor sin clave reCAPTCHA Enterprise. Un administrador debe configurar recaptcha.api_key.",
      };
    }

    const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${encodeURIComponent(apiKey)}`;
    const body = {
      event: {
        token,
        expectedAction,
        siteKey,
      },
    };

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      logger.error("[verifyRecaptchaLogin] fetch error", e);
      return {
        ok: false,
        code: "recaptcha_unavailable",
        message: "No se pudo contactar reCAPTCHA Enterprise.",
      };
    }

    const assessment = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.warn("[verifyRecaptchaLogin] API error", res.status, assessment);
      return {
        ok: false,
        code: "recaptcha_api_error",
        message: "Verificaci├│n de seguridad no disponible.",
        status: res.status,
      };
    }

    const tp = assessment.tokenProperties || {};
    const risk = assessment.riskAnalysis || {};

    if (!tp.valid) {
      logger.info("[verifyRecaptchaLogin] token inv├ílido", tp.invalidReason);
      return {
        ok: false,
        code: "token_invalid",
        message: "Verificaci├│n de seguridad fallida. Intenta de nuevo.",
      };
    }

    if (expectedAction && tp.action && normalizeString(tp.action) !== normalizeString(expectedAction)) {
      logger.info("[verifyRecaptchaLogin] acci├│n no coincide", tp.action, expectedAction);
      return {
        ok: false,
        code: "action_mismatch",
        message: "Verificaci├│n de seguridad no coincide.",
      };
    }

    const score = Number(risk.score);
    const minScoreRaw = cfg.min_score ?? process.env.RECAPTCHA_MIN_SCORE;
    const minScore = Math.min(1, Math.max(0, Number(minScoreRaw != null && minScoreRaw !== "" ? minScoreRaw : 0.35)));

    if (Number.isFinite(score) && score < minScore) {
      logger.info("[verifyRecaptchaLogin] score bajo", score, "min", minScore);
      return {
        ok: false,
        code: "score_low",
        message: "No se pudo validar el acceso autom├ítico. Intenta de nuevo.",
      };
    }

    return { ok: true, score: Number.isFinite(score) ? score : null, provider: "enterprise" };
  } catch (e) {
    logger.error("[verifyRecaptchaLogin] unexpected", e);
    return {
      ok: false,
      code: "unexpected_error",
      message: "Error en verificaci├│n de seguridad.",
    };
  }
});

async function sendPasswordSetupEmail(email, nombre) {
  const mailConfig = functions.config().mail || {};
  if (!mailConfig.user || !mailConfig.pass) {
    logger.warn("[procesarSolicitudAcceso] Sin config de correo; usa Recuperar contrasena en Login.");
    return false;
  }

  const resetLink = await admin.auth().generatePasswordResetLink(email);
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: mailConfig.user, pass: mailConfig.pass },
  });
  await transporter.sendMail({
    from: `"MapGestion" <${mailConfig.user}>`,
    to: email,
    subject: "Configura tu acceso a MapGestion",
    text: `Hola ${normalizeString(nombre || "")}. Tu acceso fue aprobado. Configura una contrasena nueva desde este enlace: ${resetLink}`,
  });
  return true;
}

exports.procesarSolicitudAcceso = functions.region(REGION).https.onCall(async (data, context) => {
  try {
    const profile = await findUserProfileFromAuth(context.auth);
    const actorRole = inferRole(profile.data, profile.data?.email || context.auth?.token?.email);
    const security = await loadSecurityConfig();
    const actorEmail = normalizeLower(profile.data?.email || context.auth?.token?.email || "");
    const actorName = normalizeString(profile.data?.nombre || profile.data?.usuario || actorEmail || "Sistema");

    if (!canProcessAccessRequestsBackend(actorRole, security, profile.data || {})) {
      throw new HttpsError("permission-denied", "No autorizado para procesar solicitudes.");
    }

    const payload = sanitizePlainObject(data || {});
    const action = normalizeLower(payload.action || payload.accion);
    if (action !== "approve" && action !== "reject") {
      throw new HttpsError("invalid-argument", "Acci├│n inv├ílida.");
    }

    const solicitud = await resolveAccessRequestDoc(
      payload.docId || payload.email || "",
      payload.collectionName || payload.collection
    );
    const solicitudData = solicitud.data || {};
    const email = normalizeLower(payload.email || solicitudData.email || solicitud.id);
    const nombre = normalizeUpper(payload.nombre || solicitudData.nombre || "");
    const telefono = normalizeString(payload.telefono || solicitudData.telefono || "");
    const puesto = normalizeUpper(payload.puesto || solicitudData.puesto || "");

    if (!email || !nombre) {
      throw new HttpsError("invalid-argument", "La solicitud no contiene datos suficientes.");
    }

    if (action === "approve") {
      if (!canManageUsersBackend(actorRole, security, profile.data || {})) {
        throw new HttpsError("permission-denied", "No autorizado para gestionar usuarios.");
      }
      if (!canAssignRolesBackend(actorRole, security, profile.data || {})) {
        throw new HttpsError("permission-denied", "No autorizado para asignar roles.");
      }

      const role = normalizeUpper(payload.role || payload.rol || solicitudData.rolSolicitado || "AUXILIAR");
      if (!role) {
        throw new HttpsError("invalid-argument", "Debes seleccionar un rol.");
      }
      if (!canActorManageTargetRole(actorRole, role, security)) {
        throw new HttpsError("permission-denied", `No puedes asignar el rol ${role}.`);
      }

      const roleMeta = roleDefinition(role, security);
      const plazaAsignada = roleMeta.needsPlaza
        ? normalizePlaza(payload.plaza || payload.plazaAsignada || solicitudData.plazaSolicitada || "")
        : "";
      if (roleMeta.needsPlaza && !plazaAsignada) {
        throw new HttpsError("invalid-argument", "Debes asignar una plaza para ese rol.");
      }

      let authUser = null;
      let createdAuthUser = false;
      try {
        authUser = await admin.auth().getUserByEmail(email);
      } catch (error) {
        if (error?.code !== "auth/user-not-found") throw error;
      }

      if (!authUser) {
        authUser = await admin.auth().createUser({
          email,
          password: `${crypto.randomBytes(36).toString("base64url")}Aa1!`,
          displayName: nombre
        });
        createdAuthUser = true;
      } else {
        await admin.auth().updateUser(authUser.uid, {
          displayName: nombre
        }).catch(() => null);
      }

      const userRef = await resolveUserProfileDocRefByEmail(email, authUser);
      const userSnap = await userRef.get().catch(() => null);
      const requestedPlazas = normalizeUniquePlazas(
        payload.plazasPermitidas || solicitudData.plazasPermitidas || []
      );
      const plazasPermitidas = roleMeta.fullAccess
        ? requestedPlazas
        : normalizeUniquePlazas([
            ...(plazaAsignada ? [plazaAsignada] : []),
            ...(roleMeta.multiPlaza ? requestedPlazas : [])
          ]);
      const userPayload = {
        nombre,
        email,
        authUid: authUser.uid,
        telefono,
        puesto,
        rol: role,
        plazaAsignada,
        plaza: plazaAsignada,
        isAdmin: roleMeta.isAdmin,
        isGlobal: roleMeta.fullAccess,
        status: "ACTIVO",
        activo: true,
        autorizado: true,
        accesoSistema: true,
        solicitudId: solicitud.id,
        aprobadoPor: actorName,
        aprobadoPorEmail: actorEmail,
        approvedAt: nowIso(),
        updatedFrom: "app_admin_approve",
        canSwitchPlaza: plazasPermitidas.length > 1,
        actualizadoAt: nowIso(),
        actualizadoPor: actorEmail
      };
      if (!userSnap?.exists) {
        userPayload.creadoAt = nowIso();
        userPayload.creadoPor = actorEmail;
      }
      if (plazasPermitidas.length > 0) {
        userPayload.plazasPermitidas = plazasPermitidas;
      }
      await userRef.set(userPayload, { merge: true });

      await solicitud.ref.set({
        ...solicitudData,
        nombre,
        email,
        puesto,
        telefono,
        rolSolicitado: role,
        plazaSolicitada: plazaAsignada,
        password: admin.firestore.FieldValue.delete(),
        estado: "APROBADA",
        aprobadoPor: actorName,
        aprobadoPorEmail: actorEmail,
        aprobadoAt: nowIso()
      }, { merge: true });

      const auditId = `gest_${nowMillis()}_${Math.floor(Math.random() * 1000)}`;
      await db.collection(ADMIN_AUDIT_COL).doc(auditId).set({
        fecha: nowIso(),
        timestamp: nowMillis(),
        tipo: "SOLICITUD_APROBADA",
        accion: `Aprob├│ la solicitud de acceso de ${nombre}`,
        autor: actorName,
        userDocId: profile.id,
        userEmail: actorEmail,
        role: actorRole,
        plaza: plazaAsignada || normalizePlaza(profile.data?.plazaAsignada || ""),
        entidad: "SOLICITUDES",
        referencia: `${solicitud.collectionName}/${solicitud.id}`,
        objetivo: email,
        rolObjetivo: role,
        plazaObjetivo: plazaAsignada,
        resultado: "APROBADA",
        detalles: "Cuenta aprovisionada desde Cloud Functions"
      }, { merge: true });

      let passwordSetupEmailSent = false;
      if (createdAuthUser) {
        try {
          passwordSetupEmailSent = await sendPasswordSetupEmail(email, nombre);
        } catch (error) {
          logger.error("[procesarSolicitudAcceso] No se pudo enviar el enlace de alta.", error);
        }
      }

      return {
        ok: true,
        action: "approve",
        email,
        role,
        plazaAsignada,
        passwordSetupRequired: createdAuthUser,
        passwordSetupEmailSent,
        collectionName: solicitud.collectionName
      };
    }

    const motivo = normalizeString(payload.motivo || payload.reason);
    if (!motivo) {
      throw new HttpsError("invalid-argument", "Debes escribir un motivo de rechazo.");
    }

    await solicitud.ref.set({
      ...solicitudData,
      nombre,
      email,
      puesto,
      telefono,
      password: admin.firestore.FieldValue.delete(),
      estado: "RECHAZADA",
      motivo_rechazo: motivo,
      rechazadoPor: actorName,
      rechazadoPorEmail: actorEmail,
      rechazadoAt: nowIso(),
      updatedFrom: "app_admin_reject"
    }, { merge: true });

    let authDisabled = false;
    try {
      const authUser = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(authUser.uid, { disabled: true });
      authDisabled = true;
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }

    let profileBlocked = false;
    try {
      const userRef = await resolveUserProfileDocRefByEmail(email, null);
      const userSnap = await userRef.get().catch(() => null);
      if (userSnap?.exists) {
        await userRef.set({
          status: "RECHAZADO",
          activo: false,
          autorizado: false,
          accesoSistema: false,
          solicitudId: solicitud.id,
          motivoRechazo: motivo,
          actualizadoAt: nowIso(),
          actualizadoPor: actorEmail,
          updatedFrom: "app_admin_reject"
        }, { merge: true });
        profileBlocked = true;
      }
    } catch (_) { /* noop */ }

    const auditId = `gest_${nowMillis()}_${Math.floor(Math.random() * 1000)}`;
    await db.collection(ADMIN_AUDIT_COL).doc(auditId).set({
      fecha: nowIso(),
      timestamp: nowMillis(),
      tipo: "SOLICITUD_RECHAZADA",
      accion: `Rechaz├│ la solicitud de acceso de ${nombre}`,
      autor: actorName,
      userDocId: profile.id,
      userEmail: actorEmail,
      role: actorRole,
      plaza: normalizePlaza(profile.data?.plazaAsignada || ""),
      entidad: "SOLICITUDES",
      referencia: `${solicitud.collectionName}/${solicitud.id}`,
      objetivo: email,
      resultado: "RECHAZADA",
      detalles: motivo
    }, { merge: true });

    return {
      ok: true,
      action: "reject",
      email,
      collectionName: solicitud.collectionName,
      authDisabled,
      profileBlocked
    };
  } catch (error) {
    await recordProgrammerError("procesarSolicitudAcceso", error, { authUid: context.auth?.uid || "" });
    throw error;
  }
});

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
//  MEX API ÔÇö REST p├║blica con API Keys
//  Fase 1: gesti├│n de keys + endpoints GET (unidades, historial, mapa)
//
//  Flujo:
//    1. Cliente externo env├¡a header X-API-Key: mex_live_<hex>
//    2. Se valida la key contra Firestore (por lookupId + hash SHA-256)
//    3. Se verifica rate limit (por d├¡a y por minuto)
//    4. Se verifica permiso espec├¡fico del endpoint
//    5. Se ejecuta la query y se devuelve JSON
//    6. Se registra la llamada en api_key_logs (async)
//
//  Seguridad: la key en texto plano NUNCA se almacena en Firestore,
//  solo su hash SHA-256. El texto plano solo se muestra al crear la key.
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

const API_KEYS_COL   = "api_keys";
const API_KEY_USAGE_COL = "api_key_usage";
const API_KEY_LOGS_COL  = "api_key_logs";
const MEX_KEY_LIVE_PREFIX = "mex_live_";
const MEX_KEY_TEST_PREFIX = "mex_test_";
const MEX_KEY_LOOKUP_LEN  = 10; // chars usados como ID de b├║squeda r├ípida

// ÔöÇÔöÇÔöÇ Helpers de criptograf├¡a ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

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

// ÔöÇÔöÇÔöÇ Validaci├│n de API key ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

async function resolveApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return null;
  const isLive = rawKey.startsWith(MEX_KEY_LIVE_PREFIX);
  const isTest = rawKey.startsWith(MEX_KEY_TEST_PREFIX);
  if (!isLive && !isTest) return null;

  const lookupId = mexKeyLookupId(rawKey);
  if (!lookupId) return null;
  const hash = sha256hex(rawKey);

  // B├║squeda por lookupId (├¡ndice autom├ítico de Firestore), luego verificar hash
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

// ÔöÇÔöÇÔöÇ Rate limiting ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

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

// ÔöÇÔöÇÔöÇ Errores tipados para routes ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

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

// ÔöÇÔöÇÔöÇ Handlers por endpoint ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

async function apiHandleGetUnidades(req, keyDoc) {
  requireApiPermiso(keyDoc, "unidades", "leer");
  const plaza = normalizePlaza(req.query.plaza || "");
  if (!plaza) throw new ApiInvalidArgError("Par├ímetro 'plaza' requerido.");
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
  if (!plaza) throw new ApiInvalidArgError("Par├ímetro 'plaza' requerido.");
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
  if (snap.empty) throw new ApiNotFoundError(`Sin configuraci├│n de mapa para: ${plaza}`);
  const data = snap.docs.map(d => serializeFirestoreValue({ id: d.id, ...d.data() }));
  return { ok: true, data, meta: { plaza: plazaKey, total: data.length, timestamp: nowIso() } };
}

// ÔöÇÔöÇÔöÇ Logger async (fire-and-forget) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

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

// ÔöÇÔöÇÔöÇ FUNCI├ôN PRINCIPAL HTTP ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

exports.mexApi = functions.region(REGION).https.onRequest(async (req, res) => {
  // CORS ÔÇö permite llamadas desde cualquier origen
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
    return apiErr(401, "invalid_key", "API key inv├ílida o revocada.");
  }

  // 3. Rate limit
  let rl;
  try {
    rl = await checkAndIncrementRateLimit(keyDoc._docId, keyDoc.limites);
  } catch (err) {
    logger.error("[mexApi] Error en rate limit:", err.message);
    return apiErr(500, "server_error", "Error interno al verificar l├¡mite.");
  }
  if (!rl.allowed) {
    res.set("Retry-After", "60");
    return apiErr(429, rl.reason, `L├¡mite excedido. M├íx: ${rl.limit} llamadas.`);
  }

  // 4. Routing  ÔÇö /v1/<recurso>[/<id>]
  const segments   = normalizeString(req.path).replace(/^\//, "").split("/").filter(Boolean);
  const version    = segments[0] || "";
  const resource   = segments[1] || "";
  const resourceId = segments[2] || "";
  const endpoint   = `${method} /${segments.join("/")}`;

  if (version !== "v1") {
    return apiErr(404, "not_found", "Versi├│n no soportada. Usa /v1/...");
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

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
//  crearApiKey ÔÇö HTTPS callable (solo PROGRAMADOR)
//  Genera y almacena una nueva API key. La key en texto plano
//  se devuelve UNA SOLA VEZ ÔÇö despu├®s es irrecuperable.
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

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
  // La key en texto plano se devuelve UNA sola vez aqu├¡
  return { ok: true, keyId: docRef.id, key: rawKey, nombre, isTest };
});

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
//  revocarApiKey ÔÇö HTTPS callable (solo PROGRAMADOR)
//  Cambia el status de una key a REVOCADA, SUSPENDIDA o ACTIVA.
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

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

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
//  listarApiKeys ÔÇö HTTPS callable (solo PROGRAMADOR)
//  Lista todas las API keys SIN exponer el keyHash.
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

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


// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
//  INVITACIONES ÔÇö registro single-tenant por c├│digo de invitaci├│n.
//  Un c├│digo pre-asigna plaza + rol, es de un solo uso y expira.
//  El registro es autom├ítico (sin aprobaci├│n manual).
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
const INVITACIONES_COL = "invitaciones";
const _INV_ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O,0,I,1
const _INV_DIA_MS = 24 * 60 * 60 * 1000;
function _genCodigoInv() {
  let o = "";
  for (let i = 0; i < 8; i++) o += _INV_ALFABETO[Math.floor(Math.random() * _INV_ALFABETO.length)];
  return o;
}

exports.generarInvitacion = functions.region(REGION).https.onCall(async (data, context) => {
  const profile = await findUserProfileFromAuth(context.auth);
  const actorRole = inferRole(profile.data, profile.data?.email || context.auth?.token?.email);
  const security = await loadSecurityConfig();
  if (!canManageUsersBackend(actorRole, security, profile.data || {})) {
    throw new HttpsError("permission-denied", "No autorizado para generar invitaciones.");
  }
  const plaza = normalizeUpper(data?.plaza || "");
  const rol   = normalizeUpper(data?.rol || "AUXILIAR");
  const dias  = Math.max(1, Math.min(90, Number(data?.expiraEnDias) || 7));
  if (!plaza) throw new HttpsError("invalid-argument", "Plaza requerida.");
  if (!canActorManageTargetRole(actorRole, rol, security)) {
    throw new HttpsError("permission-denied", `No puedes invitar con el rol ${rol}.`);
  }
  const ahora = Date.now();
  let codigo, ref, exists = true, tries = 0;
  do {
    codigo = _genCodigoInv();
    ref = db.collection(INVITACIONES_COL).doc(codigo);
    exists = (await ref.get()).exists;
  } while (exists && ++tries < 5);
  if (exists) throw new HttpsError("internal", "No se pudo generar un c├│digo ├║nico.");
  const expiraEnMs = ahora + dias * _INV_DIA_MS;
  await ref.set({
    codigo, plaza, rol,
    creadoPor: normalizeLower(profile.data?.email || context.auth?.token?.email || ""),
    creadoEnMs: ahora, expiraEnMs,
    usadaPor: null, usadaEnMs: null, revocada: false,
    _createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, codigo, expiraEnMs };
});

exports.registrarConInvitacion = functions.region(REGION).https.onCall(async (data) => {
  const codigo = normalizeUpper(data?.codigo || "");
  const nombre = normalizeUpper(data?.nombre || "");
  const email  = normalizeLower(data?.email || "");
  const telefono = normalizeString(data?.telefono || "");
  const password = normalizeString(data?.password || "");
  if (!codigo || !nombre || !email) throw new HttpsError("invalid-argument", "Datos incompletos.");
  if (password.length < 6) throw new HttpsError("invalid-argument", "La contrase├▒a debe tener 6+ caracteres.");

  const ref = db.collection(INVITACIONES_COL).doc(codigo);
  const ahora = Date.now();

  // Validar + reservar el c├│digo en transacci├│n (un solo uso).
  const inv = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "C├│digo de invitaci├│n inv├ílido.");
    const d = snap.data();
    if (d.revocada) throw new HttpsError("failed-precondition", "El c├│digo fue revocado.");
    if (d.usadaPor) throw new HttpsError("failed-precondition", "El c├│digo ya fue usado.");
    if (ahora > d.expiraEnMs) throw new HttpsError("failed-precondition", "El c├│digo expir├│.");
    tx.update(ref, { usadaPor: email, usadaEnMs: ahora });
    return d;
  });

  // Crear/actualizar auth user.
  let authUser = null;
  try { authUser = await admin.auth().getUserByEmail(email); }
  catch (e) { if (e?.code !== "auth/user-not-found") throw e; }
  if (!authUser) {
    authUser = await admin.auth().createUser({ email, password, displayName: nombre });
  }

  // Crear perfil ÔÇö registro autom├ítico, sin aprobaci├│n.
  const userRef = await resolveUserProfileDocRefByEmail(email, authUser);
  await userRef.set({
    nombre, email, authUid: authUser.uid, telefono,
    rol: inv.rol,
    plaza: inv.plaza, plazaAsignada: inv.plaza,
    plazasPermitidas: [inv.plaza],
    status: "ACTIVO", activo: true, autorizado: true, accesoSistema: true,
    invitacionCodigo: codigo,
    creadoAt: nowIso(), creadoPor: inv.creadoPor || "invitacion",
    updatedFrom: "registro_invitacion",
  }, { merge: true });

  return { ok: true, uid: authUser.uid };
});

exports.revocarInvitacion = functions.region(REGION).https.onCall(async (data, context) => {
  const profile = await findUserProfileFromAuth(context.auth);
  const actorRole = inferRole(profile.data, profile.data?.email || context.auth?.token?.email);
  const security = await loadSecurityConfig();
  if (!canManageUsersBackend(actorRole, security, profile.data || {})) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }
  const codigo = normalizeUpper(data?.codigo || "");
  if (!codigo) throw new HttpsError("invalid-argument", "C├│digo requerido.");
  await db.collection(INVITACIONES_COL).doc(codigo).update({ revocada: true });
  return { ok: true };
});

// ÔöÇÔöÇÔöÇ Reporte actividad diaria desde imagen (Gemini) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

const GEMINI_MAX_IMAGE_BYTES = 900 * 1024;
const GEMINI_ACTIVITY_PROMPT = `Eres un extractor de datos de capturas del sistema Optima (rent a car M├®xico).
Analiza la imagen y extrae SOLO filas visibles de:
- reservas / reservaciones / salidas
- regresos / contratos por cerrar / llegadas
- vencidos / posibles llegadas (si aparecen)

Responde ├ÜNICAMENTE con JSON v├ílido (sin markdown) con esta forma exacta:
{
  "fechaBase": "YYYY-MM-DD o vac├¡o",
  "reservas": [{"numero":"","fecha":"YYYY-MM-DD HH:mm:ss","clase":"XXXX","cliente":"","pago":false,"frecuente":false}],
  "regresos": [{"numero":"","fecha":"YYYY-MM-DD HH:mm:ss","clase":"XXXX","cliente":"","pago":false,"frecuente":false}],
  "vencidos": [{"numero":"","fecha":"YYYY-MM-DD HH:mm:ss","clase":"XXXX","cliente":"","pago":false,"frecuente":false}]
}

Reglas:
- No inventes contratos. Si no se lee, omite la fila.
- "clase" suele ser un c├│digo de 4 letras (ej. ECAR, ICAR).
- "numero" es el contrato.
- "pago" true si dice CON PAGO; "frecuente" true si dice CLIENTE FRECUENTE.
- Si una secci├│n no aparece, usa [].`;

function _geminiApiKey() {
  const cfg = functions.config().gemini || {};
  return normalizeString(cfg.api_key || process.env.GEMINI_API_KEY);
}

function _geminiModel() {
  const cfg = functions.config().gemini || {};
  return normalizeString(cfg.model || process.env.GEMINI_MODEL || "gemini-2.0-flash");
}

function _stripDataUrl(raw) {
  const value = normalizeString(raw);
  const m = value.match(/^data:([^;]+);base64,(.+)$/i);
  if (m) return { mimeType: m[1], base64: m[2] };
  return { mimeType: "", base64: value.replace(/\s+/g, "") };
}

function _normalizeActivityRow(row, tipo) {
  if (!row || typeof row !== "object") return null;
  const numero = normalizeString(row.numero || row.contrato || row.auto_id || "");
  const fecha = normalizeString(row.fecha || row.fecha_regreso || row.fecha_salida || "");
  const clase = normalizeUpper(row.clase || row.class || "").slice(0, 8);
  const cliente = normalizeString(row.cliente || row.modelo || row.notas || "SIN NOMBRE");
  if (!numero && !fecha && !clase) return null;
  return {
    numero: numero || "S/C",
    fecha: fecha || "",
    clase: clase || "XXXX",
    cliente: cliente || "SIN NOMBRE",
    pago: row.pago === true || /con pago/i.test(String(row.cliente || "")),
    frecuente: row.frecuente === true || /frecuente/i.test(String(row.cliente || "")),
    tipo
  };
}

function _normalizeActivityList(list, tipo) {
  if (!Array.isArray(list)) return [];
  return list.map((row) => _normalizeActivityRow(row, tipo)).filter(Boolean);
}

function _parseGeminiJson(text) {
  let raw = normalizeString(text);
  if (!raw) throw new Error("Respuesta vac├¡a de Gemini");
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) raw = fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  return JSON.parse(raw);
}

async function _callGeminiActivityImage({ base64, mimeType }) {
  const apiKey = _geminiApiKey();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "Gemini no est├í configurado en el servidor.");
  }
  const model = _geminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: GEMINI_ACTIVITY_PROMPT },
        { inline_data: { mime_type: mimeType || "image/jpeg", data: base64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json"
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error("Gemini HTTP error", { status: res.status, payload });
    throw new HttpsError("internal", "No se pudo analizar la captura.");
  }
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((p) => p?.text || "")
    .join("\n") || "";
  return _parseGeminiJson(text);
}

exports.generarReporteActividadDesdeImagen = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onCall(async (data, context) => {
    const profile = await findUserProfileFromAuth(context.auth);
    const actorRole = inferRole(profile.data, profile.data?.email || context.auth?.token?.email);
    const security = await loadSecurityConfig();
    if (!isOperationalAdmin(actorRole, security, profile.data || {})) {
      throw new HttpsError("permission-denied", "No autorizado.");
    }

    const stripped = _stripDataUrl(data?.imageBase64 || data?.image || "");
    const mimeType = normalizeString(data?.mimeType || stripped.mimeType || "image/jpeg").toLowerCase();
    const base64 = stripped.base64;
    if (!base64) throw new HttpsError("invalid-argument", "Imagen requerida.");
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(mimeType)) {
      throw new HttpsError("invalid-argument", "Formato de imagen no soportado.");
    }

    let decodedLen = 0;
    try {
      decodedLen = Buffer.from(base64, "base64").length;
    } catch (_) {
      throw new HttpsError("invalid-argument", "Imagen inv├ílida.");
    }
    if (!decodedLen || decodedLen > GEMINI_MAX_IMAGE_BYTES) {
      throw new HttpsError("invalid-argument", "La imagen es demasiado grande. Usa una captura m├ís ligera.");
    }

    let parsed;
    try {
      parsed = await _callGeminiActivityImage({ base64, mimeType });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("generarReporteActividadDesdeImagen Gemini failed", err);
      await recordProgrammerError("generarReporteActividadDesdeImagen", err, {
        actor: normalizeLower(profile.data?.email || context.auth?.token?.email || "")
      });
      throw new HttpsError("internal", "No se pudo leer la captura.");
    }

    const reservas = _normalizeActivityList(parsed.reservas, "RESERVA");
    const regresos = _normalizeActivityList(parsed.regresos, "REGRESO");
    const vencidos = _normalizeActivityList(parsed.vencidos, "VENCIDO");
    const fechaBase = normalizeString(parsed.fechaBase || data?.fechaBase || "")
      || new Date().toISOString().slice(0, 10);

    if (!reservas.length && !regresos.length && !vencidos.length) {
      throw new HttpsError("failed-precondition", "No se detectaron filas en la captura.");
    }

    return {
      ok: true,
      fechaBase,
      reservas,
      regresos,
      vencidos,
      counts: {
        reservas: reservas.length,
        regresos: regresos.length,
        vencidos: vencidos.length
      }
    };
  });

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
//  Cloudinary ÔÇö signed uploads (API_SECRET never on client)
//  Env / secrets:
//    CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
//  Optional legacy config:
//    firebase functions:config:set cloudinary.cloud_name=ÔÇª api_key=ÔÇª api_secret=ÔÇª
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

function getCloudinaryEnv() {
  const cfg = (typeof functions.config === "function" ? (functions.config().cloudinary || {}) : {}) || {};
  return {
    cloudName: normalizeString(cfg.cloud_name || process.env.CLOUDINARY_CLOUD_NAME),
    apiKey: normalizeString(cfg.api_key || process.env.CLOUDINARY_API_KEY),
    apiSecret: normalizeString(cfg.api_secret || process.env.CLOUDINARY_API_SECRET)
  };
}

function assertCloudinaryConfigured() {
  const env = getCloudinaryEnv();
  if (!env.cloudName || !env.apiKey || !env.apiSecret) {
    throw new HttpsError(
      "failed-precondition",
      "Configura Cloudinary (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)."
    );
  }
  return env;
}

function getCloudinarySdk() {
  const env = assertCloudinaryConfigured();
  // Lazy require so deploy/boot works before dependency/secrets exist.
  // eslint-disable-next-line global-require
  const cloudinary = require("cloudinary").v2;
  cloudinary.config({
    cloud_name: env.cloudName,
    api_key: env.apiKey,
    api_secret: env.apiSecret,
    secure: true
  });
  return { cloudinary, env };
}

const CLOUDINARY_BASE_FOLDER = "mapgestion/prod";
const CLOUDINARY_ALLOWED_FOLDER_PREFIXES = [
  "mapgestion/prod/",
  "mapgestion/staging/",
  "mapgestion/dev/"
];

function sanitizeCloudinaryFolder(folder) {
  let cleaned = normalizeString(folder)
    .replace(/\\/g, "/")
    .replace(/[^a-zA-Z0-9/_-]/g, "_")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");

  // Collapse accidental doubles: mapgestion/prod/mapgestion/prod/ÔÇª
  for (const prefix of CLOUDINARY_ALLOWED_FOLDER_PREFIXES) {
    const base = prefix.replace(/\/$/, "");
    const doubled = `${base}/${base}/`;
    while (cleaned.startsWith(doubled)) cleaned = cleaned.slice(base.length + 1);
    if (cleaned === `${base}/${base}`) cleaned = base;
  }

  const full = cleaned.startsWith("mapgestion/")
    ? cleaned
    : `${CLOUDINARY_BASE_FOLDER}/${cleaned || "misc"}`;
  if (!CLOUDINARY_ALLOWED_FOLDER_PREFIXES.some((p) => full.startsWith(p))) {
    throw new HttpsError("invalid-argument", "Folder Cloudinary no permitido.");
  }
  if (full.length > 240) {
    throw new HttpsError("invalid-argument", "Folder Cloudinary demasiado largo.");
  }
  return full;
}

function sanitizeCloudinaryPublicId(publicId) {
  const cleaned = normalizeString(publicId)
    .replace(/\\/g, "/")
    .replace(/^\//, "")
    .replace(/\.\./g, "")
    .replace(/[^a-zA-Z0-9/_-]/g, "_");
  if (!cleaned) return "";
  if (cleaned.length > 200) {
    throw new HttpsError("invalid-argument", "publicId demasiado largo.");
  }
  return cleaned;
}

function extractCloudinaryPublicId(ref) {
  if (!ref) return "";
  if (typeof ref === "object") {
    return normalizeString(ref.publicId || ref.public_id || "");
  }
  const raw = normalizeString(ref);
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) {
    // Firebase path ÔåÆ not cloudinary
    if (
      raw.startsWith("papeletas")
      || raw.startsWith("profile_")
      || raw.startsWith("catalogo_")
      || raw.startsWith("mensajes_")
      || raw.startsWith("turnos_")
      || raw.startsWith("maps/")
      || raw.startsWith("licencias_")
      || raw.startsWith("notas_")
      || raw.startsWith("evidencias_")
      || raw.startsWith("empresa_config")
    ) {
      return "";
    }
    return raw.includes("/") ? raw.replace(/\.[a-z0-9]+$/i, "") : raw;
  }
  try {
    const u = new URL(raw);
    if (!/res\.cloudinary\.com$/i.test(u.hostname) && !/res\.cloudinary\.com$/i.test(u.host)) {
      if (!/cloudinary/i.test(u.hostname)) return "";
    }
    const parts = u.pathname.split("/").filter(Boolean);
    const uploadIdx = parts.findIndex((p) => p === "upload" || p === "authenticated" || p === "private");
    if (uploadIdx < 0) return "";
    let rest = parts.slice(uploadIdx + 1);
    if (rest[0] && /^v\d+$/i.test(rest[0])) rest = rest.slice(1);
    while (rest.length && /[,]|^(c_|w_|h_|q_|f_|e_|b_|r_|g_|l_|t_|dpr_|ar_)/.test(rest[0])) {
      rest = rest.slice(1);
    }
    if (!rest.length) return "";
    return rest.join("/").replace(/\.[a-z0-9]+$/i, "");
  } catch (_) {
    return "";
  }
}

function isFirebaseStoragePath(ref) {
  const raw = typeof ref === "object"
    ? normalizeString(ref.path || ref.storagePath || "")
    : normalizeString(ref);
  if (!raw || /^https?:\/\//i.test(raw)) return false;
  return (
    raw.startsWith("papeletas")
    || raw.startsWith("profile_")
    || raw.startsWith("catalogo_")
    || raw.startsWith("mensajes_")
    || raw.startsWith("turnos_")
    || raw.startsWith("maps/")
    || raw.startsWith("licencias_")
    || raw.startsWith("notas_")
    || raw.startsWith("evidencias_")
    || raw.startsWith("empresa_config")
    || raw.startsWith("papeletas_reportes")
    || raw.startsWith("papeletas_ventas")
  );
}

async function destroyCloudinaryPublicId(publicId, resourceType = "image") {
  const id = normalizeString(publicId);
  if (!id) return { ok: false, skipped: true };
  const { cloudinary } = getCloudinarySdk();
  const result = await cloudinary.uploader.destroy(id, {
    resource_type: normalizeString(resourceType) || "image",
    invalidate: true
  });
  return { ok: true, result };
}

/**
 * Callable: getCloudinaryUploadSignature
 * Auth required. Returns signed params for direct browser upload.
 */
const CLOUDINARY_SECRETS = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET"
];

exports.getCloudinaryUploadSignature = functions
  .region(REGION)
  .runWith({ secrets: CLOUDINARY_SECRETS, timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
    await findUserProfileFromAuth(context.auth);
    const env = assertCloudinaryConfigured();

    const folder = sanitizeCloudinaryFolder(data?.folder || CLOUDINARY_BASE_FOLDER);
    const publicIdLeaf = sanitizeCloudinaryPublicId(data?.publicId || data?.public_id || "");
    // Cloudinary public_id should NOT include folder when folder param is sent separately
    const publicId = publicIdLeaf.includes("/")
      ? publicIdLeaf.split("/").pop()
      : publicIdLeaf;
    const resourceType = normalizeString(data?.resourceType || data?.resource_type || "image") || "image";
    const timestamp = Math.round(Date.now() / 1000);

    const paramsToSign = { timestamp, folder };
    if (publicId) paramsToSign.public_id = publicId;

    // Prefer SDK helper for exact signature algorithm compatibility
    let signature;
    try {
      const { cloudinary } = getCloudinarySdk();
      signature = cloudinary.utils.api_sign_request(paramsToSign, env.apiSecret);
    } catch (err) {
      // Fallback SHA-1 if SDK missing
      const sorted = Object.keys(paramsToSign)
        .sort()
        .map((k) => `${k}=${paramsToSign[k]}`)
        .join("&");
      signature = crypto.createHash("sha1").update(sorted + env.apiSecret).digest("hex");
      logger.warn("getCloudinaryUploadSignature: SDK sign fallback", { err: err?.message });
    }

    return {
      cloudName: env.cloudName,
      apiKey: env.apiKey,
      timestamp,
      signature,
      folder,
      publicId: publicId || null,
      resourceType,
      provider: "cloudinary"
    };
  });

// ─── PDF server-side (Puppeteer → Cloudinary) ─────────────
// kind es un enum cerrado: el cliente nunca manda un path de Firestore
// libre, solo elige entre estos dos destinos fijos.
function _pdfTargetFor(kind) {
  const k = normalizeString(kind).toLowerCase();
  if (k === "cuadre") {
    return { collection: "historial_cuadres", field: "pdfUrl", folder: "mapgestion/prod/reportes_cuadre" };
  }
  if (k === "papeleta") {
    return { collection: "papeletas", field: "pdfUrl", folder: "mapgestion/prod/reportes_papeletas" };
  }
  return null;
}

/**
 * Callable: generarYSubirPdf - auth required. Renderiza un HTML completo
 * con Puppeteer, sube el PDF resultante a Cloudinary (resource_type raw),
 * y si viene { kind, docId } guarda la URL en el doc de Firestore que le
 * corresponda. Reemplaza el patron window.open + window.print() (nunca
 * producia un binario real, solo abria el dialogo de impresion nativo).
 */
exports.generarYSubirPdf = functions
  .region(REGION)
  .runWith({ secrets: CLOUDINARY_SECRETS, timeoutSeconds: 60, memory: "1GB" })
  .https.onCall(async (data, context) => {
    await findUserProfileFromAuth(context.auth);

    const html = normalizeString(data?.html);
    if (!html) throw new HttpsError("invalid-argument", "html requerido.");
    const filename = normalizeString(data?.filename) || `reporte_${Date.now()}`;
    const kind = normalizeString(data?.kind);
    const docId = normalizeString(data?.docId);
    const target = kind ? _pdfTargetFor(kind) : null;
    if (kind && !target) {
      throw new HttpsError("invalid-argument", "kind inválido (usa 'cuadre' o 'papeleta').");
    }

    let browser = null;
    let pdfBuffer;
    try {
      // eslint-disable-next-line global-require
      const chromiumModule = require("@sparticuz/chromium");
      // @sparticuz/chromium >=130 es ESM-only; require() desde CommonJS
      // envuelve la API real en .default.
      const chromium = chromiumModule.default || chromiumModule;
      // eslint-disable-next-line global-require
      const puppeteer = require("puppeteer-core");
      browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless ?? true,
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      pdfBuffer = await page.pdf({ format: "A4", landscape: true, printBackground: true });
    } catch (error) {
      logger.error("generarYSubirPdf: render", error);
      await recordProgrammerError("generarYSubirPdf.render", error, { kind, docId });
      throw new HttpsError("internal", "No se pudo renderizar el PDF.");
    } finally {
      if (browser) { try { await browser.close(); } catch (_) { /* noop */ } }
    }

    const folder = sanitizeCloudinaryFolder(target?.folder || "mapgestion/prod/reportes_pdf");
    let uploadResult;
    try {
      const { cloudinary } = getCloudinarySdk();
      uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: "raw",
            folder,
            public_id: sanitizeCloudinaryPublicId(filename) || undefined,
            use_filename: true,
            unique_filename: false,
          },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(pdfBuffer);
      });
    } catch (error) {
      logger.error("generarYSubirPdf: upload", error);
      await recordProgrammerError("generarYSubirPdf.upload", error, { kind, docId });
      throw new HttpsError("internal", "No se pudo subir el PDF a Cloudinary.");
    }

    const url = uploadResult.secure_url || uploadResult.url;

    if (target && docId) {
      try {
        await db.collection(target.collection).doc(docId).update({
          [target.field]: url,
          pdfGeneradoEn: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        // El PDF ya existe en Cloudinary aunque falle este update - no se pierde el render.
        logger.warn("generarYSubirPdf: firestore update failed", { kind, docId, err: error?.message });
        await recordProgrammerError("generarYSubirPdf.firestoreUpdate", error, { kind, docId });
      }
    }

    return { url };
  });

/** Callable: destroyCloudinaryMedia - auth required, best-effort cleanup. */
exports.destroyCloudinaryMedia = functions
  .region(REGION)
  .runWith({ secrets: CLOUDINARY_SECRETS, timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
    await findUserProfileFromAuth(context.auth);
    assertCloudinaryConfigured();
    const publicId = extractCloudinaryPublicId(data?.publicId || data?.public_id || data?.url || data);
    if (!publicId) {
      throw new HttpsError("invalid-argument", "publicId requerido.");
    }
    const resourceType = normalizeString(data?.resourceType || data?.resource_type || "image") || "image";
    try {
      return await destroyCloudinaryPublicId(publicId, resourceType);
    } catch (err) {
      logger.warn("destroyCloudinaryMedia failed", { publicId, err: err?.message });
      throw new HttpsError("internal", "No se pudo eliminar el archivo en Cloudinary.");
    }
  });

/** Limpia fotos de reportes de papeletas no promovidos tras expiresAt (TTL ~24h). */
exports.limpiarFotosReportesPapeletas = functions
  .region(REGION)
  .runWith({ secrets: CLOUDINARY_SECRETS })
  .pubsub.schedule("every 60 minutes")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const snap = await db.collection("papeletas_reportes")
      .where("status", "==", "abierto")
      .where("expiresAt", "<=", now.toDate())
      .limit(50)
      .get();

    if (snap.empty) {
      logger.info("limpiarFotosReportesPapeletas: nothing expired");
      return null;
    }

    const bucket = admin.storage().bucket();
    let cleaned = 0;
    let cloudinaryReady = false;
    try {
      assertCloudinaryConfigured();
      cloudinaryReady = true;
    } catch (_) {
      cloudinaryReady = false;
    }

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const refs = [];
      if (data.fotos?.placas) refs.push(data.fotos.placas);
      if (data.fotos?.vin) refs.push(data.fotos.vin);
      for (const p of data.fotos?.danos || []) if (p) refs.push(p);

      for (const ref of refs) {
        const publicId = extractCloudinaryPublicId(ref);
        if (publicId && cloudinaryReady) {
          try {
            await destroyCloudinaryPublicId(publicId, "image");
          } catch (err) {
            logger.warn("limpiarFotosReportesPapeletas cloudinary delete failed", {
              publicId,
              err: err?.message
            });
          }
          continue;
        }

        if (isFirebaseStoragePath(ref)) {
          const path = typeof ref === "object"
            ? normalizeString(ref.path || ref.storagePath)
            : normalizeString(ref);
          if (!path) continue;
          try {
            await bucket.file(path).delete({ ignoreNotFound: true });
          } catch (err) {
            logger.warn("limpiarFotosReportesPapeletas delete failed", { path, err: err?.message });
          }
        }
      }

      await doc.ref.update({
        status: "expirado",
        expiradoAt: admin.firestore.FieldValue.serverTimestamp(),
        fotos: { placas: "", vin: "", danos: [] },
      });
      cleaned += 1;
    }

    logger.info("limpiarFotosReportesPapeletas done", { cleaned });
    return null;
  });

// ═══════════════════════════════════════════════════════════
//  WEBAUTHN LOGIN (passkey) — Face ID / Touch ID / Windows Hello para
//  iniciar sesión sin contraseña.
//
//  A diferencia del checado de turnos (que confía en el resultado del
//  navegador sin verificarlo en servidor, porque el peor caso es un
//  registro de asistencia incorrecto), AQUÍ sí verificamos la firma
//  criptográfica en el servidor con @simplewebauthn/server, porque el
//  resultado es una sesión real de Firebase Auth.
//
//  rpID/origin fijos al dominio de producción: una passkey registrada
//  en un dominio no sirve en otro (mex-mapa-bjx.web.app ≠
//  app.mapgestion.com para WebAuthn), así que login con passkey solo
//  funciona probando directamente sobre ese dominio.
// ═══════════════════════════════════════════════════════════
const {
  generateRegistrationOptions: webauthnGenRegOptions,
  verifyRegistrationResponse: webauthnVerifyReg,
  generateAuthenticationOptions: webauthnGenAuthOptions,
  verifyAuthenticationResponse: webauthnVerifyAuth,
} = require("@simplewebauthn/server");

const WEBAUTHN_RP_NAME = "MapGestion";
const WEBAUTHN_RP_ID = "app.mapgestion.com";
const WEBAUTHN_ORIGIN = `https://${WEBAUTHN_RP_ID}`;
const WEBAUTHN_REG_CHALLENGES_COL = "webauthn_register_challenges";
const WEBAUTHN_LOGIN_CHALLENGES_COL = "webauthn_login_challenges";
const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

function _webauthnU8ToB64(u8) {
  return Buffer.from(u8).toString("base64");
}

function _webauthnB64ToU8(b64) {
  return new Uint8Array(Buffer.from(String(b64 || ""), "base64"));
}

/** Lee las credenciales guardadas de un doc de usuario, listas para la librería. */
function _webauthnCredentialsFromUserDoc(data = {}) {
  const arr = Array.isArray(data.webauthnLoginCredentials) ? data.webauthnLoginCredentials : [];
  return arr
    .filter((c) => c && c.credentialId && c.publicKey)
    .map((c) => ({
      id: c.credentialId,
      publicKey: _webauthnB64ToU8(c.publicKey),
      counter: Number(c.counter || 0),
      transports: Array.isArray(c.transports) && c.transports.length ? c.transports : ["internal"],
    }));
}

/** PASO 1 de registro: usuario YA logueado pide opciones para enrolar una passkey. */
exports.webauthnRegisterOptions = functions.region(REGION).https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión primero.");
  const email = normalizeLower(context.auth.token?.email || data?.email || "");
  if (!email) throw new HttpsError("invalid-argument", "No se pudo determinar tu correo.");

  const ref = await resolveUserProfileDocRefByEmail(email, context.auth);
  const snap = await ref.get();
  const userData = snap.data() || {};
  const existing = _webauthnCredentialsFromUserDoc(userData);

  const options = await webauthnGenRegOptions({
    rpName: WEBAUTHN_RP_NAME,
    rpID: WEBAUTHN_RP_ID,
    userName: email,
    userDisplayName: normalizeString(userData.nombre || userData.nombreCompleto || email),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
    },
  });

  await db.collection(WEBAUTHN_REG_CHALLENGES_COL).doc(uid).set({
    challenge: options.challenge,
    docRefPath: ref.path,
    email,
    createdAt: Date.now(),
  });

  return options;
});

/** PASO 2 de registro: verifica la respuesta del navegador y guarda la credencial. */
exports.webauthnRegisterVerify = functions.region(REGION).https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión primero.");
  const response = data?.response;
  const deviceLabel = normalizeString(data?.deviceLabel || "Este dispositivo").slice(0, 60);
  if (!response) throw new HttpsError("invalid-argument", "Falta la respuesta del navegador.");

  const chalRef = db.collection(WEBAUTHN_REG_CHALLENGES_COL).doc(uid);
  const chalSnap = await chalRef.get();
  if (!chalSnap.exists) throw new HttpsError("failed-precondition", "No hay un registro en curso. Intenta de nuevo.");
  const chal = chalSnap.data();
  await chalRef.delete();
  if (Date.now() - Number(chal.createdAt || 0) > WEBAUTHN_CHALLENGE_TTL_MS) {
    throw new HttpsError("deadline-exceeded", "El registro tardó demasiado. Intenta de nuevo.");
  }

  let verification;
  try {
    verification = await webauthnVerifyReg({
      response,
      expectedChallenge: chal.challenge,
      expectedOrigin: WEBAUTHN_ORIGIN,
      expectedRPID: WEBAUTHN_RP_ID,
    });
  } catch (e) {
    logger.warn("[webauthnRegisterVerify] verificación fallida", e?.message);
    throw new HttpsError("invalid-argument", "No se pudo verificar el registro.");
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpsError("invalid-argument", "No se pudo verificar el registro.");
  }

  const { credential } = verification.registrationInfo;
  const fv = admin.firestore.FieldValue;
  await db.doc(chal.docRefPath).set({
    webauthnLoginCredentials: fv.arrayUnion({
      credentialId: credential.id,
      publicKey: _webauthnU8ToB64(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports && credential.transports.length ? credential.transports : ["internal"],
      deviceLabel,
      createdAt: Date.now(),
    }),
  }, { merge: true });

  return { ok: true };
});

/** PASO 1 de login: sin sesión, pide opciones de autenticación para un correo conocido. */
exports.webauthnLoginOptions = functions.region(REGION).https.onCall(async (data) => {
  const email = normalizeLower(data?.email || "");
  if (!email) throw new HttpsError("invalid-argument", "Correo requerido.");

  const ref = await resolveUserProfileDocRefByEmail(email, null);
  const snap = await ref.get();
  const creds = snap.exists ? _webauthnCredentialsFromUserDoc(snap.data()) : [];
  if (!creds.length) {
    // Mismo mensaje sin importar si el correo existe o no tiene passkey.
    throw new HttpsError("not-found", "No hay una passkey configurada para este correo.");
  }

  const options = await webauthnGenAuthOptions({
    rpID: WEBAUTHN_RP_ID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
  });

  const sessionRef = db.collection(WEBAUTHN_LOGIN_CHALLENGES_COL).doc();
  await sessionRef.set({
    challenge: options.challenge,
    docRefPath: ref.path,
    email,
    createdAt: Date.now(),
  });

  return { options, sessionId: sessionRef.id };
});

/** PASO 2 de login: verifica la aserción y devuelve un custom token de Firebase Auth. */
exports.webauthnLoginVerify = functions.region(REGION).https.onCall(async (data) => {
  const sessionId = normalizeString(data?.sessionId || "");
  const response = data?.response;
  if (!sessionId || !response) throw new HttpsError("invalid-argument", "Solicitud incompleta.");

  const chalRef = db.collection(WEBAUTHN_LOGIN_CHALLENGES_COL).doc(sessionId);
  const chalSnap = await chalRef.get();
  if (!chalSnap.exists) throw new HttpsError("failed-precondition", "La sesión de verificación expiró. Intenta de nuevo.");
  const chal = chalSnap.data();
  await chalRef.delete();
  if (Date.now() - Number(chal.createdAt || 0) > WEBAUTHN_CHALLENGE_TTL_MS) {
    throw new HttpsError("deadline-exceeded", "La verificación tardó demasiado. Intenta de nuevo.");
  }

  const ref = db.doc(chal.docRefPath);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Usuario no encontrado.");
  const userData = snap.data() || {};
  const storedCreds = Array.isArray(userData.webauthnLoginCredentials) ? userData.webauthnLoginCredentials : [];
  const creds = _webauthnCredentialsFromUserDoc(userData);
  const matching = creds.find((c) => c.id === response.id);
  if (!matching) throw new HttpsError("invalid-argument", "Credencial no reconocida.");

  let verification;
  try {
    verification = await webauthnVerifyAuth({
      response,
      expectedChallenge: chal.challenge,
      expectedOrigin: WEBAUTHN_ORIGIN,
      expectedRPID: WEBAUTHN_RP_ID,
      credential: matching,
      requireUserVerification: true,
    });
  } catch (e) {
    logger.warn("[webauthnLoginVerify] verificación fallida", e?.message);
    throw new HttpsError("permission-denied", "No se pudo verificar tu identidad.");
  }
  if (!verification.verified) {
    throw new HttpsError("permission-denied", "No se pudo verificar tu identidad.");
  }

  // Actualiza el contador de esa credencial (previene ataques de repetición);
  // las demás credenciales del arreglo quedan intactas.
  const updatedCreds = storedCreds.map((c) => (c.credentialId === matching.id
    ? { ...c, counter: verification.authenticationInfo.newCounter }
    : c));
  await ref.update({ webauthnLoginCredentials: updatedCreds });

  let authUser;
  try {
    authUser = await admin.auth().getUserByEmail(chal.email);
  } catch (e) {
    logger.error("[webauthnLoginVerify] usuario Auth no encontrado", { email: chal.email, err: e?.message });
    throw new HttpsError("not-found", "No se encontró la cuenta de este correo.");
  }

  const token = await admin.auth().createCustomToken(authUser.uid);
  return { token };
});
