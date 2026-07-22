import { db, checarNotificaciones } from '/js/core/database.js';

function _safe(value) {
  return String(value || '').trim();
}

function _safeUp(value) {
  return _safe(value).toUpperCase();
}

function _isAdminRole(role = '') {
  return [
    'SUPERVISOR',
    'JEFE_PATIO',
    'GERENTE_PLAZA',
    'JEFE_REGIONAL',
    'CORPORATIVO_USER',
    'JEFE_OPERACION',
    'PROGRAMADOR'
  ].includes(_safeUp(role));
}

let _pendingRequestsCache = { value: 0, at: 0 };
const PENDING_REQUESTS_TTL = 5 * 60 * 1000;

function _profileAliases(profile = {}) {
  return [
    profile?.nombre,
    profile?.usuario,
    profile?.nombreCompleto,
    profile?.displayName,
    profile?.email,
    profile?.uid
  ]
    .map(_safeUp)
    .filter(Boolean);
}

function _csvList(value = '') {
  if (Array.isArray(value)) return value.flatMap(_csvList);
  return String(value || '')
    .split(',')
    .map(_safeUp)
    .filter(Boolean);
}

function _isAlertReadByAnyAlias(alerta = {}, aliases = []) {
  if (!aliases.length) return false;
  const readers = new Set(_csvList(alerta.leidoPor || alerta.leidaPor || alerta.readBy || alerta.vistoPor));
  return aliases.some(alias => readers.has(alias));
}

async function _countPendingRequests() {
  const now = Date.now();
  if (now - _pendingRequestsCache.at < PENDING_REQUESTS_TTL) {
    return _pendingRequestsCache.value;
  }
  const [primary, legacy] = await Promise.all([
    db.collection('solicitudes').where('estado', '==', 'PENDIENTE').limit(120).get().catch(() => null),
    db.collection('solicitudes_acceso').where('estado', '==', 'PENDIENTE').limit(120).get().catch(() => null)
  ]);
  const emails = new Set();
  [primary, legacy].forEach(snap => {
    snap?.docs?.forEach(doc => {
      const email = _safe((doc.data() || {}).email || doc.id).toLowerCase();
      if (email) emails.add(email);
    });
  });
  _pendingRequestsCache = { value: emails.size, at: now };
  return emails.size;
}

export async function getNotificationsSummary({ profile = {}, role = '', plaza = '' } = {}) {
  const prefs = profile?.profilePreferences?.notifications || {};
  if (prefs.active === false) {
    return {
      total: 0,
      incidencias: 0,
      alertas: 0,
      solicitudes: 0,
      plaza: _safeUp(plaza || profile?.plazaAsignada || profile?.plaza || '')
    };
  }
  const aliases = _profileAliases(profile);
  const userIdentity = aliases[0] || '';
  const currentPlaza = _safeUp(plaza || profile?.plazaAsignada || profile?.plaza || '');
  if (!userIdentity) {
    return {
      total: 0,
      incidencias: 0,
      alertas: 0,
      solicitudes: 0,
      plaza: currentPlaza
    };
  }

  const notif = await checarNotificaciones(userIdentity, currentPlaza).catch(() => ({}));
  const incidencias = Number(notif?.incidenciasPendientes || 0);
  const alertas = prefs.passiveAlerts === false
    ? 0
    : Array.isArray(notif?.alertas)
    ? notif.alertas.filter(alerta => !_isAlertReadByAnyAlias(alerta, aliases)).length
    : 0;
  const solicitudes = _isAdminRole(role) ? await _countPendingRequests() : 0;
  const activeTotal = alertas + solicitudes;
  return {
    total: activeTotal,
    incidencias,
    alertas,
    solicitudes,
    plaza: currentPlaza
  };
}
