'use strict';

import { db, auth } from '/js/core/database.js';

const EDITMAP_BOOTSTRAP_PROGRAMMER_EMAILS = Object.freeze([
  'angelarmentta@icloud.com'
]);
const ACTIVE_PLAZA_STORAGE_KEY = 'mex:last-active-plaza';
const EDITMAP_LAST_ROUTE_PLAZA_KEY = 'mex:last-editmap-plaza';
const PLAZA_QUERY_KEYS = Object.freeze(['plaza', 'p']);

const _plazaFromPath = (() => {
  const segs = window.location.pathname.replace(/\/+$/, '').split('/');
  return _upperText(segs[2] || '');
})();

const _plazaFromQuery = (() => {
  const params = new URLSearchParams(window.location.search || '');
  for (const key of PLAZA_QUERY_KEYS) {
    const value = _upperText(params.get(key) || '');
    if (value) return value;
  }
  return '';
})();

let _userProfile = null;
let _editorOpened = false;

function _safeText(value) {
  return String(value || '').trim();
}

function _upperText(value) {
  return _safeText(value).toUpperCase();
}

function _lowerText(value) {
  return _safeText(value).toLowerCase();
}

function _profileDocId(email) {
  return _lowerText(email);
}

function _normalizePlaza(value) {
  return _upperText(value);
}

function _isBootstrapProgrammerEmail(email) {
  return EDITMAP_BOOTSTRAP_PROGRAMMER_EMAILS.includes(_profileDocId(email));
}

function _routeShell() {
  return document.getElementById('editmap-route-shell');
}

function _routeActions() {
  return document.getElementById('editmap-route-actions');
}

function _setRouteState(title, subtitle, actionsHtml = '') {
  const titleEl = document.getElementById('editmap-route-title');
  const subtitleEl = document.getElementById('editmap-route-subtitle');
  const actionsEl = _routeActions();
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;
  if (actionsEl) actionsEl.innerHTML = actionsHtml;
}

function _showRouteShell(show) {
  const shell = _routeShell();
  if (shell) shell.style.display = show ? 'flex' : 'none';
}

function _setPlazaBadge(plaza) {
  const normalized = _normalizePlaza(plaza);
  const pill = document.getElementById('editmap-plaza-pill');
  const label = document.getElementById('editmap-plaza-label');
  if (label) label.textContent = normalized || '—';
  if (pill) pill.style.display = normalized ? 'flex' : 'none';
  if (normalized) document.title = `Editor — ${normalized}`;
}

function _rememberPlaza(plaza) {
  const normalized = _normalizePlaza(plaza);
  try {
    if (normalized) {
      sessionStorage.setItem(ACTIVE_PLAZA_STORAGE_KEY, normalized);
      sessionStorage.setItem(EDITMAP_LAST_ROUTE_PLAZA_KEY, normalized);
    } else {
      sessionStorage.removeItem(ACTIVE_PLAZA_STORAGE_KEY);
      sessionStorage.removeItem(EDITMAP_LAST_ROUTE_PLAZA_KEY);
    }
  } catch (_) { /* noop */ }
  return normalized;
}

function _readRememberedPlaza() {
  try {
    return _normalizePlaza(
      sessionStorage.getItem(EDITMAP_LAST_ROUTE_PLAZA_KEY)
      || sessionStorage.getItem(ACTIVE_PLAZA_STORAGE_KEY)
      || ''
    );
  } catch (_) {
    return '';
  }
}

function _writeCanonicalRoute(plaza) {
  const normalized = _normalizePlaza(plaza);
  const target = normalized ? `/editmap/${encodeURIComponent(normalized)}` : '/editmap';
  if (window.location.pathname !== target || window.location.search) {
    window.history.replaceState({}, '', target);
  }
}

async function _waitFor(predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      if (predicate()) return true;
    } catch (_) { /* noop */ }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error('El editor compartido no terminó de cargar a tiempo.');
}

async function _ensureBootstrapProgrammerProfile(user) {
  const email = _profileDocId(user?.email || '');
  if (!email || !_isBootstrapProgrammerEmail(email)) return null;

  const nombre = _upperText(user?.displayName || 'PROGRAMADOR') || 'PROGRAMADOR';
  const payload = {
    email,
    nombre,
    usuario: nombre,
    rol: 'PROGRAMADOR',
    isAdmin: true,
    isGlobal: true,
    plazaAsignada: '',
    telefono: '',
    status: 'ACTIVO',
    authUid: _safeText(user?.uid),
    bootstrapProgrammer: true,
    lastBootstrapLoginAt: Date.now()
  };

  await db.collection('usuarios').doc(email).set(payload, { merge: true });
  return { id: email, ...payload };
}

async function _loadUserProfile(user) {
  const email = _profileDocId(user?.email || '');
  try {
    const cached = typeof window.__mexLoadCurrentUserRecord === 'function'
      ? await window.__mexLoadCurrentUserRecord(user).catch(() => null)
      : null;
    const candidates = cached ? [{ ...cached }] : [];

    if (!candidates.length && email) {
      const byEmailDoc = await db.collection('usuarios').doc(email).get();
      if (byEmailDoc.exists) candidates.push({ id: byEmailDoc.id, ...byEmailDoc.data(), email });

      const byEmailQuery = await db.collection('usuarios').where('email', '==', email).limit(3).get();
      byEmailQuery.forEach(doc => {
        candidates.push({ id: doc.id, ...doc.data(), email });
      });
    }

    if ((!candidates.length) && _safeText(user?.uid)) {
      const byUidDoc = await db.collection('usuarios').doc(user.uid).get();
      if (byUidDoc.exists) candidates.push({ id: byUidDoc.id, ...byUidDoc.data(), email });
    }

    const bestMatch = candidates.find(item => item.id === email)
      || candidates.find(item => item.id === _safeText(user?.uid))
      || candidates[0];

    if (bestMatch) return { ...bestMatch };
    if (_isBootstrapProgrammerEmail(email)) return await _ensureBootstrapProgrammerProfile(user);

    return {
      id: email || _safeText(user?.uid),
      email,
      nombre: _upperText(user?.displayName || email || 'USUARIO'),
      plazaAsignada: '',
      rol: '',
      status: 'ACTIVO'
    };
  } catch (error) {
    console.warn('[editmap] profile load:', error);
    return {
      id: email || _safeText(user?.uid),
      email,
      nombre: _upperText(user?.displayName || email || 'USUARIO'),
      plazaAsignada: '',
      rol: '',
      status: 'ACTIVO'
    };
  }
}

async function _loadConfiguredPlazas() {
  let plazas = [];
  try {
    const empresaSnap = await db.collection('configuracion').doc('empresa').get();
    const empresaData = empresaSnap.exists ? empresaSnap.data() : {};
    plazas = Array.isArray(empresaData?.plazas)
      ? empresaData.plazas.map(_normalizePlaza).filter(Boolean)
      : [];
  } catch (error) {
    console.warn('[editmap] no se pudieron leer plazas desde configuracion/empresa:', error);
  }

  if (!plazas.length) {
    try {
      const snap = await db.collection('configuracion').get();
      snap.forEach(doc => {
        const id = _normalizePlaza(doc.id);
        if (id && id !== 'EMPRESA' && id !== 'LISTAS') plazas.push(id);
      });
    } catch (_) { /* noop */ }
  }

  return [...new Set(plazas)].sort();
}

function _renderPlazaSelector(plazas) {
  const actions = plazas.length
    ? plazas.map(plaza => `
        <button class="editmap-route-btn" type="button" onclick="editmap_selectPlaza('${plaza}')">
          <span class="material-icons" style="font-size:18px;">location_city</span>
          <span>${plaza}</span>
        </button>
      `).join('')
    : `
      <a class="editmap-route-link" href="/mapa">
        <span class="material-icons" style="font-size:18px;">arrow_back</span>
        Volver al mapa
      </a>
    `;

  _setRouteState(
    'Selecciona una plaza',
    plazas.length
      ? 'No encontramos una plaza fija para tu sesión. Elige la plaza que quieres editar y abriremos el editor completo.'
      : 'No se encontraron plazas configuradas para abrir el editor en este momento.',
    actions
  );
  _showRouteShell(true);
}

async function _openEditorForPlaza(plaza) {
  const normalized = _rememberPlaza(plaza);
  if (!normalized || _editorOpened) return;

  _setPlazaBadge(normalized);
  _setRouteState('Abriendo editor', `Cargando la estructura operativa de ${normalized} con el motor completo del mapa.`, '');
  _showRouteShell(true);

  await _waitFor(() => typeof window.abrirEditorMapa === 'function' && typeof window._setSessionProfile === 'function');
  if (_userProfile) {
    window._setSessionProfile(_userProfile);
  }

  window.__MEX_EDITMAP_STANDALONE = true;
  _writeCanonicalRoute(normalized);
  window.abrirEditorMapa(normalized);
  _editorOpened = true;
  _showRouteShell(false);
}

async function _boot(user) {
  _setRouteState(
    'Preparando editor',
    'Estamos resolviendo tu sesión, la plaza activa y cargando el editor visual completo del mapa.',
    ''
  );
  _showRouteShell(true);

  _userProfile = await _loadUserProfile(user);
  const plazas = await _loadConfiguredPlazas();
  const profilePlaza = _normalizePlaza(_userProfile?.plazaAsignada || _userProfile?.plaza || '');
  const rememberedPlaza = _readRememberedPlaza();
  const singlePlaza = plazas.length === 1 ? plazas[0] : '';
  const resolvedPlaza = _normalizePlaza(
    _plazaFromPath
    || _plazaFromQuery
    || rememberedPlaza
    || profilePlaza
    || singlePlaza
  );

  if (resolvedPlaza) {
    await _openEditorForPlaza(resolvedPlaza);
    return;
  }

  _renderPlazaSelector(plazas);
}

window.editmap_selectPlaza = async function (plaza) {
  const normalized = _normalizePlaza(plaza);
  if (!normalized) return;
  _editorOpened = false;
  await _openEditorForPlaza(normalized);
};

window.cerrarEditmapStandalone = function () {
  try {
    const modal = document.getElementById('modal-editor-mapa');
    if (modal) modal.classList.remove('active');
  } catch (_) { /* noop */ }

  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  window.location.href = '/mapa';
};

auth.onAuthStateChanged(async user => {
  if (!user) {
    window.location.replace('/login');
    return;
  }

  try {
    await _boot(user);
  } catch (error) {
    console.error('[editmap] boot:', error);
    _setRouteState(
      'No se pudo abrir el editor',
      error?.message || 'Ocurrió un problema al preparar el editor del mapa.',
      '<button class="editmap-route-btn secondary" type="button" onclick="window.location.reload()">Reintentar</button><a class="editmap-route-link" href="/mapa">Volver al mapa</a>'
    );
    _showRouteShell(true);
  }
});
