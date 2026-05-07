/**
 * Safe unit action controller for /app/mapa.
 *
 * Data-only module: no DOM access, no listeners, no side effects on import.
 */

import { esGlobal } from '/domain/permissions.model.js';
import { persistUnitMove } from '/js/app/features/mapa/mapa-mutations.js';

const MUTATING_ACTIONS = new Set([
  'update_status',
  'update_notes',
  'update_gas',
  'mark_ready',
  'persist_position'
]);

const BLOCKED_ACTIONS = new Set([
  'delete_unit',
  'insert_unit',
  'bulk_insert',
  'bulk_update',
  'formal_close',
  'report_pdf',
  'edit_structure',
  'edit_mapa_config'
]);

const ACTION_DEFS = Object.freeze({
  update_status: {
    id: 'update_status',
    label: 'Cambiar estado operativo',
    mutates: true,
    requiresConfirmation: true,
    requiredApi: 'aplicarEstado'
  },
  update_notes: {
    id: 'update_notes',
    label: 'Actualizar notas',
    mutates: true,
    requiresConfirmation: true,
    requiredApi: 'aplicarEstado'
  },
  update_gas: {
    id: 'update_gas',
    label: 'Actualizar gasolina',
    mutates: true,
    requiresConfirmation: true,
    requiredApi: 'aplicarEstado'
  },
  mark_ready: {
    id: 'mark_ready',
    label: 'Marcar LISTO',
    mutates: true,
    requiresConfirmation: true,
    requiredApi: 'aplicarEstado'
  },
  send_to_preparacion: {
    id: 'send_to_preparacion',
    label: 'Enviar a cola preparacion',
    mutates: true,
    requiresConfirmation: true,
    requiredApi: 'NO_SAFE_LEGACY_API'
  },
  create_incident_link_only: {
    id: 'create_incident_link_only',
    label: 'Abrir incidencia por MVA',
    mutates: false,
    requiresConfirmation: false
  },
  open_legacy: {
    id: 'open_legacy',
    label: 'Abrir mapa clásico',
    mutates: false,
    requiresConfirmation: false
  },
  copy_json: {
    id: 'copy_json',
    label: 'Preparar JSON',
    mutates: false,
    requiresConfirmation: false
  },
  refresh_unit: {
    id: 'refresh_unit',
    label: 'Refrescar unidad',
    mutates: false,
    requiresConfirmation: false,
    requiredApi: 'obtenerDatosFlotaConsola'
  },
  persist_position: {
    id: 'persist_position',
    label: 'Persistir posicion',
    mutates: true,
    requiresConfirmation: true,
    requiredApi: 'guardarNuevasPosiciones'
  }
});

function _text(value) {
  return String(value ?? '').trim();
}

function _upper(value) {
  return _text(value).toUpperCase();
}

function _isFn(fn) {
  return typeof fn === 'function';
}

function _safeApi(api) {
  if (api && typeof api === 'object') return api;
  try {
    return window.api || {};
  } catch (_) {
    return {};
  }
}

function _profileFromState(state = {}) {
  return state.profile || state.currentUserProfile || state.userProfile || state.user || null;
}

function _roleFromContext(context = {}) {
  const state = context.state || {};
  const profile = context.profile || _profileFromState(state) || {};
  return _upper(context.role || profile.rol || profile.role || state.role || state.userAccessRole || '');
}

function _isAdminGlobalContext(context = {}) {
  const state = context.state || {};
  const profile = context.profile || _profileFromState(state) || {};
  const role = _roleFromContext(context);
  return profile.isAdmin === true && esGlobal(role);
}

function _canMutate(context = {}) {
  const role = _roleFromContext(context);
  if (role === 'PROGRAMADOR') return true;
  return _isAdminGlobalContext(context);
}

function _unitMva(unit = {}) {
  return _upper(unit.mva || unit.MVA || unit.id || '');
}

function _unitState(unit = {}) {
  return _upper(unit.estado || unit.status || 'SUCIO') || 'SUCIO';
}

function _unitLocation(unit = {}) {
  return _upper(unit.ubicacion || unit.location || 'PATIO') || 'PATIO';
}

function _unitGas(unit = {}) {
  return _text(unit.gasolina || unit.gas || 'N/A') || 'N/A';
}

function _unitNotes(unit = {}) {
  return _text(unit.notas || unit.notes || '');
}

function _actorName(context = {}) {
  const user = context.user || context.currentUser || {};
  const profile = context.profile || {};
  return (
    _text(context.usuario || context.actor || context.userName) ||
    _text(user.nombre || user.displayName || user.email) ||
    _text(profile.nombre || profile.email) ||
    ''
  );
}

function _actionDef(action) {
  return ACTION_DEFS[_text(action)];
}

function _unavailable(action, reason, extra = {}) {
  return {
    action,
    available: false,
    reason,
    ...extra
  };
}

function _available(action, extra = {}) {
  const def = _actionDef(action) || {};
  return {
    action,
    available: true,
    reason: '',
    mutates: def.mutates === true,
    requiresConfirmation: def.requiresConfirmation === true,
    ...extra
  };
}

function _hasApiForAction(api, action) {
  const def = _actionDef(action);
  if (!def?.requiredApi) return true;
  if (def.requiredApi === 'NO_SAFE_LEGACY_API') return false;
  return _isFn(api?.[def.requiredApi]);
}

function _buildLegacyUrl(unit, context = {}) {
  const params = new URLSearchParams();
  const plaza = _upper(context.plaza || '');
  const mva = _unitMva(unit);
  params.set('legacy', '1');
  if (plaza) params.set('plaza', plaza);
  if (mva) params.set('q', mva);
  const qs = params.toString();
  return qs ? `/mapa?${qs}` : '/mapa';
}

function _buildIncidentUrl(unit, context = {}) {
  const params = new URLSearchParams();
  const plaza = _upper(context.plaza || '');
  const mva = _unitMva(unit);
  if (mva) params.set('mva', mva);
  if (plaza) params.set('plaza', plaza);
  const qs = params.toString();
  return qs ? `/app/incidencias?${qs}` : '/app/incidencias';
}

function _validateCommon(action, unit, payload = {}, context = {}) {
  const def = _actionDef(action);
  if (!def) return { ok: false, code: 'UNKNOWN_ACTION', message: 'Accion no reconocida.' };
  if (BLOCKED_ACTIONS.has(action)) return { ok: false, code: 'BLOCKED', message: 'Accion bloqueada por contrato.' };

  const mva = _unitMva(unit);
  if (!unit || typeof unit !== 'object') return { ok: false, code: 'NO_UNIT', message: 'Unidad requerida.' };
  if (!mva) return { ok: false, code: 'NO_MVA', message: 'MVA requerido.' };

  const plaza = _upper(context.plaza || '');
  if (!plaza) return { ok: false, code: 'NO_PLAZA', message: 'Plaza activa requerida.' };

  if (def.mutates) {
    if (!_actorName(context)) return { ok: false, code: 'NO_USER', message: 'Usuario requerido.' };
    if (!_canMutate(context)) return { ok: false, code: 'AUTH', message: 'Rol no autorizado para mutaciones en mapa operativo.' };
    if (def.requiresConfirmation && payload.confirmed !== true && context.confirmed !== true) {
      return { ok: false, code: 'CONFIRMATION', message: 'Confirmacion explicita requerida.' };
    }
  }

  return { ok: true, code: 'OK', message: '', mva, plaza };
}

function _validatePayload(action, unit, payload = {}) {
  if (action === 'update_status') {
    if (!_upper(payload.estado || payload.status)) return { ok: false, code: 'NO_STATUS', message: 'Estado requerido.' };
  }
  if (action === 'update_notes') {
    if (payload.notas == null && payload.notes == null) return { ok: false, code: 'NO_NOTES', message: 'Notas requeridas.' };
  }
  if (action === 'update_gas') {
    if (!_text(payload.gasolina || payload.gas)) return { ok: false, code: 'NO_GAS', message: 'Gasolina requerida.' };
  }
  if (action === 'persist_position') {
    if (!_text(payload.posNueva || payload.pos || payload.destKey)) return { ok: false, code: 'NO_DEST', message: 'Destino requerido.' };
  }
  return { ok: true, code: 'OK', message: '', unit };
}

async function _executeApplyEstado(api, action, unit, payload, context) {
  const mva = _unitMva(unit);
  const plaza = _upper(context.plaza);
  const actor = _actorName(context);
  const estado = action === 'mark_ready' ? 'LISTO' : _upper(payload.estado || payload.status || _unitState(unit));
  const ubicacion = _upper(payload.ubicacion || payload.location || _unitLocation(unit));
  const gasolina = _text(payload.gasolina || payload.gas || _unitGas(unit));
  const notas = action === 'update_notes' ? _text(payload.notas ?? payload.notes ?? '') : _unitNotes(unit);
  const borrarNotas = payload.borrarNotas === true || payload.replaceNotes === true;
  const result = await api.aplicarEstado(mva, estado, ubicacion, gasolina, notas, borrarNotas, actor, actor, plaza, {
    source: 'app_mapa_unit_actions',
    action
  });
  return normalizeActionResult(result);
}

async function _executeRefresh(api, unit, context) {
  const mva = _unitMva(unit);
  const plaza = _upper(context.plaza);
  const rows = await api.obtenerDatosFlotaConsola(plaza);
  const list = Array.isArray(rows) ? rows : [];
  const found = list.find(item => _unitMva(item) === mva) || null;
  return found
    ? { ok: true, code: 'OK', message: '', data: found }
    : { ok: false, code: 'UNIT_NOT_FOUND', message: 'Unidad no encontrada al refrescar.' };
}

async function _executePersistPosition(api, unit, payload, context) {
  const res = await persistUnitMove({
    api,
    plaza: context.plaza,
    usuario: _actorName(context),
    mva: _unitMva(unit),
    posNueva: payload.posNueva || payload.pos || payload.destKey,
    extra: {
      source: 'app_mapa_unit_actions',
      action: 'persist_position'
    }
  });
  return normalizeActionResult(res);
}

export function buildUnitActionContext(state = {}, unit = {}) {
  const profile = _profileFromState(state) || {};
  const plaza = _upper(
    state.currentPlaza ||
      state.plaza ||
      state.plazaId ||
      state.activePlaza ||
      profile.plazaAsignada ||
      ''
  );
  const user = state.currentUser || state.user || profile || null;
  return {
    state,
    unit,
    plaza,
    profile,
    user,
    role: _roleFromContext({ state, profile }),
    userName: _text(profile.nombre || user?.displayName || user?.email || ''),
    confirmed: false
  };
}

export function normalizeActionResult(result) {
  if (result?.ok === true || result?.success === true || result === true || result === 'OK' || result === 'EXITO') {
    return {
      ok: true,
      code: result?.code || 'OK',
      message: _text(result?.message || result?.msg || '') || 'Accion completada.',
      data: result?.data ?? null,
      raw: result
    };
  }
  const message = _text(result?.message || result?.error || result) || 'Accion no exitosa.';
  return {
    ok: false,
    code: result?.code || (message.startsWith('ERROR') ? 'ERROR' : 'FAILED'),
    message,
    data: result?.data ?? null,
    raw: result
  };
}

export function createMapaUnitActionsController({
  api,
  db = null,
  getState = () => ({}),
  getCurrentPlaza = null,
  getCurrentUser = null,
  profile = null,
  debug = false
} = {}) {
  const getApi = () => _safeApi(api);
  const getContext = (unit, context = {}) => {
    const state = context.state || getState() || {};
    const built = buildUnitActionContext(state, unit);
    const currentUser = context.user || (_isFn(getCurrentUser) ? getCurrentUser() : null);
    const currentProfile = context.profile || (_isFn(profile) ? profile() : null);
    const currentPlaza = context.plaza || (_isFn(getCurrentPlaza) ? getCurrentPlaza() : '');
    return {
      ...built,
      ...context,
      state,
      unit,
      db,
      user: currentUser || context.user || built.user,
      profile: currentProfile || context.profile || built.profile,
      plaza: _upper(currentPlaza || context.plaza || built.plaza)
    };
  };

  function getAvailableActions(unit, context = {}) {
    const apiRef = getApi();
    const ctx = getContext(unit, context);
    return Object.keys(ACTION_DEFS).map(action => {
      const def = _actionDef(action);
      const common = _validateCommon(action, unit, { confirmed: def?.requiresConfirmation ? true : undefined }, ctx);
      if (!common.ok && !['CONFIRMATION'].includes(common.code)) return _unavailable(action, common.message, { code: common.code });
      if (action === 'send_to_preparacion') {
        return _unavailable(action, 'No hay API clásica segura detectada', { code: 'NO_SAFE_LEGACY_API' });
      }
      if (!_hasApiForAction(apiRef, action)) {
        return _unavailable(action, 'No hay API clásica segura detectada', { code: 'NO_API' });
      }
      return _available(action, {
        href:
          action === 'open_legacy'
            ? _buildLegacyUrl(unit, ctx)
            : action === 'create_incident_link_only'
              ? _buildIncidentUrl(unit, ctx)
              : ''
      });
    });
  }

  function validateUnitAction(action, unit, payload = {}, context = {}) {
    const normalized = _text(action);
    if (BLOCKED_ACTIONS.has(normalized)) {
      return { ok: false, code: 'BLOCKED', message: 'Accion bloqueada por contrato.' };
    }
    const ctx = getContext(unit, context);
    const common = _validateCommon(normalized, unit, payload, ctx);
    if (!common.ok) return common;
    const apiRef = getApi();
    if (!_hasApiForAction(apiRef, normalized)) {
      return { ok: false, code: 'NO_API', message: 'No hay API clásica segura detectada.' };
    }
    return _validatePayload(normalized, unit, payload);
  }

  async function executeUnitAction(action, unit, payload = {}, context = {}) {
    const normalized = _text(action);
    const ctx = getContext(unit, context);
    const validation = validateUnitAction(normalized, unit, payload, ctx);
    if (!validation.ok) return { ...validation, ok: false };

    const apiRef = getApi();
    if (debug) console.log('[mapa-unit-actions]', normalized, { mva: _unitMva(unit), plaza: ctx.plaza });

    if (['update_status', 'update_notes', 'update_gas', 'mark_ready'].includes(normalized)) {
      return _executeApplyEstado(apiRef, normalized, unit, payload, ctx);
    }
    if (normalized === 'refresh_unit') return _executeRefresh(apiRef, unit, ctx);
    if (normalized === 'persist_position') return _executePersistPosition(apiRef, unit, payload, ctx);
    if (normalized === 'create_incident_link_only') {
      return { ok: true, code: 'LINK_ONLY', message: 'Abrir flujo de incidencia.', href: _buildIncidentUrl(unit, ctx) };
    }
    if (normalized === 'open_legacy') {
      return { ok: true, code: 'LINK_ONLY', message: 'Abrir mapa clásico.', href: _buildLegacyUrl(unit, ctx) };
    }
    if (normalized === 'copy_json') {
      return { ok: true, code: 'OK', message: 'JSON preparado.', data: { ...unit } };
    }
    return { ok: false, code: 'NO_EXECUTOR', message: 'Accion sin executor seguro.' };
  }

  return {
    getAvailableActions,
    resolveAvailableActions: getAvailableActions,
    validateUnitAction,
    executeUnitAction,
    normalizeActionResult,
    buildUnitActionContext,
    cleanup() {}
  };
}

export const createUnitActionsController = createMapaUnitActionsController;
export const createController = createMapaUnitActionsController;
export const MAPA_UNIT_ACTIONS = ACTION_DEFS;
export const MAPA_UNIT_BLOCKED_ACTIONS = BLOCKED_ACTIONS;
