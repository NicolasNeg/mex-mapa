import { db, COL } from '/js/core/database.js';
import { getState, setState } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';

let _ctx = null;
let _mounted = false;
let _formState = null;
let _offGlobalSearch = null;

export function mount(ctx) {
  _ctx = ctx;
  _mounted = true;
  const { profile, role } = getState();
  if (!profile) {
    ctx.container.innerHTML = `<div style="padding:30px;color:#ef4444;">No se pudo cargar el perfil.</div>`;
    return;
  }
  _formState = _makeFormState(profile);
  ctx.container.innerHTML = _html(profile, role, _formState);
  _bindGlobalSearch();
  _bind();
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
  const name = c.querySelector('#appProfileName');
  const phone = c.querySelector('#appProfilePhone');
  const avatar = c.querySelector('#appProfileAvatarUrl');
  const theme = c.querySelector('#appProfileTheme');
  const density = c.querySelector('#appProfileDensity');
  const save = c.querySelector('#appProfileSave');
  const cancel = c.querySelector('#appProfileCancel');

  [name, phone, avatar, theme, density].forEach(el => {
    el?.addEventListener('input', () => _syncFormFromDom());
    el?.addEventListener('change', () => _syncFormFromDom());
  });
  avatar?.addEventListener('input', () => _renderAvatarPreview());
  save?.addEventListener('click', () => _saveProfile());
  cancel?.addEventListener('click', () => _resetForm());
  _renderAvatarPreview();
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
  _setStatus('Cambios restaurados.', 'info');
}

async function _saveProfile() {
  if (!_mounted || !_formState) return;
  _setStatus('Guardando cambios...', 'info');
  const current = getState().profile || {};
  const docId = String(current.id || current.email || '').toLowerCase().trim();
  if (!docId) return _setStatus('No se pudo resolver el usuario actual.', 'error');

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
    }
  };
  if (_formState.avatarUrl && !/^https?:\/\//i.test(_formState.avatarUrl)) {
    _setStatus('Avatar URL debe iniciar con http:// o https://', 'error');
    return;
  }

  try {
    await db.collection(COL.USERS).doc(docId).set(payload, { merge: true });
    if (!_mounted) return;
    const nextProfile = { ...current, ...payload };
    setState({ profile: nextProfile });
    _ctx?.shell?.setProfile?.(nextProfile, getState().role);
    _renderAvatarPreview();
    _setStatus('Perfil actualizado correctamente.', 'ok');
  } catch (err) {
    _setStatus(err?.message || 'No se pudieron guardar los cambios.', 'error');
  }
}

function _setStatus(msg, type) {
  const el = _ctx?.container?.querySelector('#appProfileStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'error' ? '#b91c1c' : (type === 'ok' ? '#15803d' : '#475569');
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

function _html(profile, role, form) {
  const name = form.nombreCompleto || profile.email || 'Usuario';
  const email = profile.email || profile.id || '';
  const roleLabel = ROLE_LABELS[role] || profile.roleLabel || role || 'AUXILIAR';
  const plaza = String(profile.plazaAsignada || profile.plaza || '').toUpperCase().trim() || '—';
  return `
<div style="padding:24px;max-width:980px;margin:0 auto;font-family:Inter,sans-serif;">
  <div style="border:1px solid #e2e8f0;border-radius:14px;padding:18px;background:#fff;margin-bottom:14px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
    <div id="appProfileAvatarPreview" style="width:76px;height:76px;border-radius:16px;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;">
      <span id="appProfileAvatarInitials">${esc((name || 'U').slice(0,1).toUpperCase())}</span>
    </div>
    <div style="flex:1;min-width:220px;">
      <h1 style="margin:0;font-size:24px;color:#0f172a;">${esc(name)}</h1>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">${esc(email)}</div>
      <div style="font-size:12px;color:#334155;margin-top:4px;font-weight:700;">${esc(roleLabel)} · ${esc(plaza)}</div>
    </div>
    <a href="/profile" style="font-size:12px;color:#0f172a;text-decoration:underline;">Abrir perfil legacy</a>
  </div>
  <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;background:#fff;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label data-profile-search-text="nombre nombre completo" style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Nombre / Nombre completo
        <input id="appProfileName" value="${escAttr(form.nombreCompleto)}" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
      </label>
      <label data-profile-search-text="telefono móvil celular" style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Teléfono
        <input id="appProfilePhone" value="${escAttr(form.telefono)}" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
      </label>
      <label data-profile-search-text="avatar foto imagen url" style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Avatar URL
        <input id="appProfileAvatarUrl" value="${escAttr(form.avatarUrl)}" placeholder="https://..." style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
      </label>
      <label data-profile-search-text="email correo" style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Email (solo lectura)
        <input value="${escAttr(email)}" readonly style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:8px;">
      </label>
      <label data-profile-search-text="rol permisos" style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Rol (solo lectura)
        <input value="${escAttr(roleLabel)}" readonly style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:8px;">
      </label>
      <label data-profile-search-text="plaza asignada" style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Plaza (solo lectura)
        <input value="${escAttr(plaza)}" readonly style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:8px;">
      </label>
      <label data-profile-search-text="tema apariencia claro oscuro" style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Tema
        <select id="appProfileTheme" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
          <option value="light" ${form.theme === 'light' ? 'selected' : ''}>Claro</option>
          <option value="dark" ${form.theme === 'dark' ? 'selected' : ''}>Oscuro</option>
        </select>
      </label>
      <label data-profile-search-text="densidad visual compacta media amplia" style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Densidad visual
        <select id="appProfileDensity" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
          <option value="compacta" ${form.visualDensity === 'compacta' ? 'selected' : ''}>Compacta</option>
          <option value="media" ${form.visualDensity === 'media' ? 'selected' : ''}>Media</option>
          <option value="amplia" ${form.visualDensity === 'amplia' ? 'selected' : ''}>Amplia</option>
        </select>
      </label>
      <label data-profile-search-text="idioma language" style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Idioma
        <select id="appProfileLanguage" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
          <option value="es" ${form.language === 'es' ? 'selected' : ''}>Español</option>
          <option value="en" ${form.language === 'en' ? 'selected' : ''}>Inglés</option>
        </select>
      </label>
      <label data-profile-search-text="vista inicial home dashboard mapa" style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Vista inicial
        <select id="appProfileHomeView" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
          <option value="dashboard" ${form.homeView === 'dashboard' ? 'selected' : ''}>Dashboard</option>
          <option value="mapa" ${form.homeView === 'mapa' ? 'selected' : ''}>Mapa</option>
          <option value="mensajes" ${form.homeView === 'mensajes' ? 'selected' : ''}>Mensajes</option>
        </select>
      </label>
      <label data-profile-search-text="plaza por defecto default plaza" style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Plaza por defecto
        <input id="appProfileDefaultPlaza" value="${escAttr(form.defaultPlaza)}" placeholder="Ej: CULIACAN" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
      </label>
    </div>
    <div style="margin-top:12px;padding:10px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;">
      <div style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">Contexto operativo y seguridad (solo lectura)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
        <div style="font-size:12px;color:#334155;"><strong>Plaza actual:</strong> ${esc(plaza)}</div>
        <div style="font-size:12px;color:#334155;"><strong>Rol:</strong> ${esc(roleLabel)}</div>
        <div style="font-size:12px;color:#334155;"><strong>Email:</strong> ${esc(email)}</div>
        <div style="font-size:12px;color:#334155;"><strong>Permisos sensibles:</strong> gestionados en legacy/admin</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap;">
      <button id="appProfileSave" type="button" style="border:none;background:#0f172a;color:#fff;border-radius:8px;padding:9px 12px;font-weight:700;cursor:pointer;">Guardar cambios</button>
      <button id="appProfileCancel" type="button" style="border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:8px;padding:9px 12px;font-weight:700;cursor:pointer;">Cancelar</button>
      <a href="/profile" style="margin-left:auto;font-size:12px;color:#0f172a;">Abrir perfil completo</a>
    </div>
    <div id="appProfileStatus" style="margin-top:8px;font-size:12px;color:#64748b;"></div>
  </div>
</div>`;
}

function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(v) { return esc(v).replace(/'/g, '&#39;'); }
