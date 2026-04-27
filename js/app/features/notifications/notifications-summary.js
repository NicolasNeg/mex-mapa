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

async function _countPendingRequests() {
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
  return emails.size;
}

export async function getNotificationsSummary({ profile = {}, role = '', plaza = '' } = {}) {
  const userIdentity = _safe(
    profile?.nombre
    || profile?.usuario
    || profile?.nombreCompleto
    || profile?.email
    || ''
  ).toUpperCase();
  const currentPlaza = _safeUp(plaza || profile?.plazaAsignada || profile?.plaza || '');
  if (!userIdentity) {
    return {
      total: 0,
      mensajes: 0,
      incidencias: 0,
      alertas: 0,
      solicitudes: 0,
      plaza: currentPlaza
    };
  }

  const notif = await checarNotificaciones(userIdentity, currentPlaza).catch(() => ({}));
  const mensajes = Number(notif?.mensajesSinLeer || 0);
  const incidencias = Number(notif?.incidenciasPendientes || 0);
  const alertas = Array.isArray(notif?.alertas) ? notif.alertas.length : 0;
  const solicitudes = _isAdminRole(role) ? await _countPendingRequests() : 0;
  return {
    total: mensajes + incidencias + alertas + solicitudes,
    mensajes,
    incidencias,
    alertas,
    solicitudes,
    plaza: currentPlaza
  };
}
