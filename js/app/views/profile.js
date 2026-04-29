import { db, COL } from '/js/core/database.js';
import { getState, setState } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';

const APP_PROFILE_CSS_SELECTOR = 'link[data-app-profile-css="1"]';

let _ctx = null;
let _mounted = false;
let _formState = null;
let _offGlobalSearch = null;

export function mount(ctx) {
  _ctx = ctx;
  _mounted = true;
  _ensureCss();
  const { profile, role } = getState();
  if (!profile) {
    ctx.container.innerHTML = `<div style="padding:30px;color:#ef4444;">No se pudo cargar el perfil.</div>`;
    return;
  }
  _formState = _makeFormState(profile);
  ctx.container.innerHTML = _html(profile, role, _formState);
  _bindGlobalSearch();
  _bind();
  _renderAvatarPreview();
  _setDirty(false);
}

export function unmount() {
  if (typeof _offGlobalSearch === 'function') {
    try { _offGlobalSearch(); } catch (_) {}
  }
  _offGlobalSearch = null;
  _mounted = false;
  _ctx = null;
  _formState = null;
}

function _ensureCss() {
  const existing = document.querySelector(APP_PROFILE_CSS_SELECTOR);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/app-profile.css';
  link.dataset.appProfileCss = '1';
  document.head.appendChild(link);
}

function _bindGlobalSearch() {
  const handler = event => {
    if (!_mounted || !_ctx?.container) return;
    const route = String(event?.detail?.route || '');
    if (!(route.startsWith('/app/profile') || route === '/profile')) return;
    const query = String(event?.detail?.query || '').toLowerCase().trim();
    const blocks = Array.from(_ctx.container.querySelectorAll('[data-profile-search-text]'));
    blocks.forEach(block => {
      const text = String(block.getAttribute('data-profile-search-text') || '');
      block.hidden = !!query && !text.includes(query);
    });
  };
  window.addEventListener('mex:global-search', handler);
  _offGlobalSearch = () => window.removeEventListener('mex:global-search', handler);
}

function _bind() {
  const c = _ctx?.container;
  if (!c) return;
  const save = c.querySelector('#appProfileSave');
  const cancel = c.querySelector('#appProfileCancel');
  const avatar = c.querySelector('#appProfileAvatarUrl');

  [
    '#appProfileName',
    '#appProfilePhone',
    '#appProfileAvatarUrl',
    '#appProfileTheme',
    '#appProfileDensity',
    '#appProfileLanguage',
    '#appProfileHomeView',
    '#appProfileDefaultPlaza',
  ].forEach(selector => {
    const el = c.querySelector(selector);
    el?.addEventListener('input', _onFormChange);
    el?.addEventListener('change', _onFormChange);
  });

  c.querySelectorAll('.app-profile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.target || '';
      const target = c.querySelector(`#${targetId}`);
      if (!target) return;
      const top = target.getBoundingClientRect().top + window.scrollY - 120;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
  });

  avatar?.addEventListener('input', _renderAvatarPreview);
  save?.addEventListener('click', _saveProfile);
  cancel?.addEventListener('click', _resetForm);
}

function _onFormChange() {
  _syncFormFromDom();
  _setDirty(true);
}

function _syncFormFromDom() {
  const c = _ctx?.container;
  if (!c || !_formState) return;
  _formState.nombreCompleto = String(c.querySelector('#appProfileName')?.value || '').trim();
  _formState.telefono = String(c.querySelector('#appProfilePhone')?.value || '').trim();
  _formState.avatarUrl = String(c.querySelector('#appProfileAvatarUrl')?.value || '').trim();
  _formState.theme = String(c.querySelector('#appProfileTheme')?.value || 'light').trim();
  _formState.visualDensity = String(c.querySelector('#appProfileDensity')?.value || 'compacta').trim();
  _formState.language = String(c.querySelector('#appProfileLanguage')?.value || 'es').trim();
  _formState.homeView = String(c.querySelector('#appProfileHomeView')?.value || 'dashboard').trim();
  _formState.defaultPlaza = String(c.querySelector('#appProfileDefaultPlaza')?.value || '').trim().toUpperCase();
}

function _resetForm() {
  if (!_mounted) return;
  const { profile } = getState();
  _formState = _makeFormState(profile || {});
  const c = _ctx?.container;
  if (!c) return;
  c.querySelector('#appProfileName').value = _formState.nombreCompleto;
  c.querySelector('#appProfilePhone').value = _formState.telefono;
  c.querySelector('#appProfileAvatarUrl').value = _formState.avatarUrl;
  c.querySelector('#appProfileTheme').value = _formState.theme;
  c.querySelector('#appProfileDensity').value = _formState.visualDensity;
  c.querySelector('#appProfileLanguage').value = _formState.language;
  c.querySelector('#appProfileHomeView').value = _formState.homeView;
  c.querySelector('#appProfileDefaultPlaza').value = _formState.defaultPlaza;
  _renderAvatarPreview();
  _setDirty(false);
  _setStatus('Cambios restaurados.', 'info');
}

async function _saveProfile() {
  if (!_mounted || !_formState) return;
  _setStatus('Guardando cambios...', 'info');
  const current = getState().profile || {};
  const docId = String(current.id || current.email || '').toLowerCase().trim();
  if (!docId) return _setStatus('No se pudo resolver el usuario actual.', 'error');
  if (_formState.avatarUrl && !/^https?:\/\//i.test(_formState.avatarUrl)) {
    _setStatus('Avatar URL debe iniciar con http:// o https://', 'error');
    return;
  }

  const payload = {
    nombreCompleto: _formState.nombreCompleto || current.nombreCompleto || current.nombre || '',
    nombre: _formState.nombreCompleto || current.nombre || '',
    usuario: _formState.nombreCompleto || current.usuario || '',
    telefono: _formState.telefono || '',
    avatarUrl: _formState.avatarUrl || '',
    photoURL: _formState.avatarUrl || '',
    fotoURL: _formState.avatarUrl || '',
    profilePhotoUrl: _formState.avatarUrl || '',
    profilePreferences: {
      ...(current.profilePreferences || {}),
      theme: _formState.theme,
      visualDensity: _formState.visualDensity,
      language: _formState.language,
      homeView: _formState.homeView,
      defaultPlaza: _formState.defaultPlaza || String(current.plazaAsignada || current.plaza || '').toUpperCase()
    },
    updatedAt: Date.now(),
    actualizadoAt: Date.now(),
    updatedFrom: 'app_profile',
  };

  try {
    await db.collection(COL.USERS).doc(docId).set(_cleanUndefined(payload), { merge: true });
    if (!_mounted) return;
    const nextProfile = { ...current, ...payload };
    setState({ profile: nextProfile });
    _ctx?.shell?.setProfile?.(nextProfile, getState().role);
    _setDirty(false);
    _setStatus('Perfil actualizado correctamente.', 'ok');
  } catch (err) {
    _setStatus(err?.message || 'No se pudieron guardar los cambios.', 'error');
  }
}

function _setStatus(msg, type) {
  const el = _ctx?.container?.querySelector('#appProfileStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = `app-profile-status is-${type}`;
}

function _setDirty(isDirty) {
  const c = _ctx?.container;
  if (!c) return;
  c.querySelector('#appProfileSave')?.classList.toggle('is-dirty', Boolean(isDirty));
}

function _renderAvatarPreview() {
  const c = _ctx?.container;
  if (!c) return;
  const url = String(c.querySelector('#appProfileAvatarUrl')?.value || '').trim();
  const holder = c.querySelector('#appProfileAvatarPreview');
  const initials = c.querySelector('#appProfileAvatarInitials');
  if (!holder || !initials) return;
  const fallbackName = String(c.querySelector('#appProfileName')?.value || '').trim() || 'USUARIO';
  const ini = fallbackName.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'U';
  initials.textContent = ini;
  if (url) {
    const safeUrl = url.replace(/"/g, '%22');
    holder.style.backgroundImage = `url("${safeUrl}")`;
    holder.style.backgroundSize = 'cover';
    holder.style.backgroundPosition = 'center';
  } else {
    holder.style.backgroundImage = 'none';
    holder.style.background = '#0f172a';
  }
}

function _makeFormState(profile = {}) {
  return {
    nombreCompleto: String(profile.nombreCompleto || profile.nombre || profile.usuario || '').trim(),
    telefono: String(profile.telefono || '').trim(),
    avatarUrl: String(profile.avatarUrl || profile.photoURL || profile.fotoURL || profile.profilePhotoUrl || '').trim(),
    theme: String(profile?.profilePreferences?.theme || 'light').trim(),
    visualDensity: String(profile?.profilePreferences?.visualDensity || 'compacta').trim(),
    language: String(profile?.profilePreferences?.language || 'es').trim(),
    homeView: String(profile?.profilePreferences?.homeView || 'dashboard').trim(),
    defaultPlaza: String(profile?.profilePreferences?.defaultPlaza || profile.plazaAsignada || profile.plaza || '').trim().toUpperCase()
  };
}

function _availablePlazas(profile = {}) {
  const fromState = Array.isArray(getState().availablePlazas) ? getState().availablePlazas : [];
  const out = new Set(fromState.map(v => String(v || '').trim().toUpperCase()).filter(Boolean));
  [profile.plazaAsignada, profile.plaza].forEach(v => {
    const val = String(v || '').trim().toUpperCase();
    if (val) out.add(val);
  });
  (Array.isArray(profile.plazasPermitidas) ? profile.plazasPermitidas : []).forEach(v => {
    const val = String(v || '').trim().toUpperCase();
    if (val) out.add(val);
  });
  return [...out];
}

function _html(profile, role, form) {
  const name = form.nombreCompleto || profile.email || 'Usuario';
  const email = profile.email || profile.id || '';
  const roleLabel = ROLE_LABELS[role] || profile.roleLabel || role || 'AUXILIAR';
  const plaza = String(profile.plazaAsignada || profile.plaza || '').toUpperCase().trim() || '—';
  const secondaryPlazas = (Array.isArray(profile.plazasPermitidas) ? profile.plazasPermitidas : [])
    .map(v => String(v || '').toUpperCase().trim())
    .filter(Boolean)
    .join(', ') || 'Sin plazas secundarias';
  const isAdmin = Boolean(profile.isAdmin || profile.isGlobal);
  const plazas = _availablePlazas(profile);
  const plazaOptions = plazas.length
    ? plazas.map(item => `<option value="${escAttr(item)}" ${item === form.defaultPlaza ? 'selected' : ''}>${esc(item)}</option>`).join('')
    : `<option value="${escAttr(form.defaultPlaza)}">${esc(form.defaultPlaza || 'GLOBAL')}</option>`;

  return `
<div class="app-profile">
  <section class="app-profile-hero">
    <div id="appProfileAvatarPreview" class="app-profile-avatar">
      <span id="appProfileAvatarInitials">${esc((name || 'U').slice(0, 1).toUpperCase())}</span>
    </div>
    <div class="app-profile-hero-main">
      <h1>${esc(name)}</h1>
      <p>${esc(email || 'Sin correo')}</p>
      <div class="app-profile-badges">
        <span>${esc(roleLabel)}</span>
        <span>${esc(plaza)}</span>
        <span>${esc(String(profile.status || 'ACTIVO').toUpperCase())}</span>
      </div>
    </div>
    <div class="app-profile-stats">
      <div><strong>${isAdmin ? 'Admin' : 'Operativo'}</strong><small>Nivel</small></div>
      <div><strong>${esc(String(plazas.length || 1))}</strong><small>Plazas</small></div>
      <div><strong>${esc(form.homeView || 'dashboard')}</strong><small>Vista</small></div>
    </div>
  </section>

  <div class="app-profile-body">
    <aside class="app-profile-nav">
      <button class="app-profile-tab" data-target="appProfileGeneral">General</button>
      <button class="app-profile-tab" data-target="appProfilePrefs">Preferencias</button>
      <button class="app-profile-tab" data-target="appProfileAccess">Accesos</button>
    </aside>
    <div class="app-profile-main">
      <section class="app-profile-card" id="appProfileGeneral" data-profile-search-text="general nombre telefono avatar email rol plaza perfil">
        <h2>General</h2>
        <div class="app-profile-grid">
          <label>Nombre completo
            <input id="appProfileName" value="${escAttr(form.nombreCompleto)}" />
          </label>
          <label>Correo
            <input value="${escAttr(email)}" readonly />
          </label>
          <label>Telefono
            <input id="appProfilePhone" value="${escAttr(form.telefono)}" />
          </label>
          <label>Rol actual
            <input value="${escAttr(roleLabel)}" readonly />
          </label>
          <label>Plaza principal
            <input value="${escAttr(plaza)}" readonly />
          </label>
          <label>Plazas secundarias
            <input value="${escAttr(secondaryPlazas)}" readonly />
          </label>
          <label class="app-profile-wide">Avatar URL
            <input id="appProfileAvatarUrl" value="${escAttr(form.avatarUrl)}" placeholder="https://..." />
          </label>
        </div>
      </section>

      <section class="app-profile-card" id="appProfilePrefs" data-profile-search-text="preferencias tema densidad idioma vista plaza defecto interfaz">
        <h2>Preferencias de Interfaz</h2>
        <div class="app-profile-grid">
          <label>Tema
            <select id="appProfileTheme">
              <option value="light" ${form.theme === 'light' ? 'selected' : ''}>Claro</option>
              <option value="dark" ${form.theme === 'dark' ? 'selected' : ''}>Oscuro</option>
            </select>
          </label>
          <label>Idioma
            <select id="appProfileLanguage">
              <option value="es" ${form.language === 'es' ? 'selected' : ''}>Espanol</option>
              <option value="en" ${form.language === 'en' ? 'selected' : ''}>English</option>
            </select>
          </label>
          <label>Vista inicial
            <select id="appProfileHomeView">
              <option value="dashboard" ${form.homeView === 'dashboard' ? 'selected' : ''}>Dashboard</option>
              <option value="mapa" ${form.homeView === 'mapa' ? 'selected' : ''}>Mapa</option>
              <option value="mensajes" ${form.homeView === 'mensajes' ? 'selected' : ''}>Mensajes</option>
              <option value="cuadre" ${form.homeView === 'cuadre' ? 'selected' : ''}>Cuadre</option>
            </select>
          </label>
          <label>Densidad visual
            <select id="appProfileDensity">
              <option value="compacta" ${form.visualDensity === 'compacta' ? 'selected' : ''}>Compacta</option>
              <option value="media" ${form.visualDensity === 'media' ? 'selected' : ''}>Media</option>
              <option value="amplia" ${form.visualDensity === 'amplia' ? 'selected' : ''}>Amplia</option>
            </select>
          </label>
          <label>Plaza por defecto
            <select id="appProfileDefaultPlaza">${plazaOptions}</select>
          </label>
        </div>
      </section>

      <section class="app-profile-card" id="appProfileAccess" data-profile-search-text="accesos seguridad permisos bloqueados lectura">
        <h2>Resumen de Accesos</h2>
        <div class="app-profile-readonly-grid">
          <p><strong>Rol operativo:</strong> ${esc(roleLabel)}</p>
          <p><strong>Nivel:</strong> ${isAdmin ? 'Administrativo' : 'Operativo'}</p>
          <p><strong>Email:</strong> ${esc(email || '-')}</p>
          <p><strong>Plaza:</strong> ${esc(plaza)}</p>
          <p><strong>Campos bloqueados:</strong> email, uid, rol, permisos, isAdmin/isGlobal, plazasPermitidas, plazaAsignada, password, status.</p>
        </div>
      </section>

      <div class="app-profile-actions">
        <button id="appProfileSave" type="button">Guardar cambios</button>
        <button id="appProfileCancel" type="button">Cancelar</button>
        <a href="/profile">Abrir perfil legacy</a>
      </div>
      <div id="appProfileStatus" class="app-profile-status"></div>
    </div>
  </div>
</div>`;
}

function _cleanUndefined(value) {
  if (Array.isArray(value)) return value.map(_cleanUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce((acc, [key, val]) => {
    if (val === undefined) return acc;
    acc[key] = _cleanUndefined(val);
    return acc;
  }, {});
}

function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(v) { return esc(v).replace(/'/g, '&#39;'); }
