function _clean(value) {
  return String(value == null ? '' : value).trim();
}

function _upper(value) {
  return _clean(value).toUpperCase();
}

function _actorName(user) {
  return (
    _clean(user?.nombreCompleto) ||
    _clean(user?.nombre) ||
    _clean(user?.displayName) ||
    _clean(user?.email) ||
    _clean(user?.uid) ||
    'AppShell'
  );
}

function _incidentPayload({ unit, plaza, payload }) {
  const mva = _upper(unit?.mva || unit?.MVA);
  const title = _clean(payload?.titulo || payload?.title);
  const desc = _clean(payload?.descripcion || payload?.description);
  const prioridad = _upper(payload?.prioridad || payload?.priority || 'MEDIA') || 'MEDIA';
  return {
    titulo: title,
    descripcion: desc,
    prioridad,
    mva,
    unidad: mva,
    plaza: _upper(plaza),
    estado: 'PENDIENTE',
    origen: 'app_mapa',
    source: 'app_mapa_quick_incident'
  };
}

export function hasQuickIncidentApi(api) {
  return typeof api?.guardarNuevaNotaDirecto === 'function';
}

export function validateQuickIncident({ api, unit, plaza, user, payload } = {}) {
  if (!hasQuickIncidentApi(api)) {
    return { ok: false, code: 'NO_API', message: 'Incidencia rápida no disponible. Usa bitácora completa.' };
  }
  if (!_upper(plaza)) {
    return { ok: false, code: 'NO_PLAZA', message: 'Selecciona una plaza antes de crear incidencia.' };
  }
  if (!_upper(unit?.mva || unit?.MVA)) {
    return { ok: false, code: 'NO_MVA', message: 'La unidad no tiene MVA válido.' };
  }
  if (!_clean(user?.uid || user?.email || user?.nombre || user?.nombreCompleto)) {
    return { ok: false, code: 'NO_USER', message: 'No hay usuario válido para auditar la incidencia.' };
  }
  if (!_clean(payload?.titulo || payload?.title)) {
    return { ok: false, code: 'NO_TITLE', message: 'Agrega un título para la incidencia.' };
  }
  if (!_clean(payload?.descripcion || payload?.description)) {
    return { ok: false, code: 'NO_DESCRIPTION', message: 'Agrega una descripción para la incidencia.' };
  }
  return { ok: true };
}

export async function createQuickIncident({ api, unit, plaza, user, payload } = {}) {
  const validation = validateQuickIncident({ api, unit, plaza, user, payload });
  if (!validation.ok) return validation;

  const incident = _incidentPayload({ unit, plaza, payload });
  const author = _actorName(user);
  try {
    const out = await api.guardarNuevaNotaDirecto(incident, author);
    const ok = out === 'OK' || out?.ok === true || out?.success === true;
    if (!ok) {
      return {
        ok: false,
        code: 'API_ERROR',
        message: 'No se pudo crear la incidencia. Usa bitácora completa.',
        raw: out
      };
    }
    return { ok: true, message: 'Incidencia creada. Actualizando bitácora…', raw: out };
  } catch (err) {
    return {
      ok: false,
      code: 'API_EXCEPTION',
      message: String(err?.message || err || 'No se pudo crear la incidencia. Usa bitácora completa.')
    };
  }
}
