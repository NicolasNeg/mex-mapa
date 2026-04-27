import { db, COL } from '/js/core/database.js';
import { getState, setState } from '/js/app/app-state.js';
import { ROLE_LABELS } from '/js/shell/navigation.config.js';

let _ctx = null;
let _mounted = false;
let _formState = null;

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
  _bind();
}

export function unmount() {
  _mounted = false;
  _ctx = null;
  _formState = null;
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
  save?.addEventListener('click', () => _saveProfile());
  cancel?.addEventListener('click', () => _resetForm());
}

function _syncFormFromDom() {
  const c = _ctx?.container;
  if (!c || !_formState) return;
  _formState.nombreCompleto = String(c.querySelector('#appProfileName')?.value || '').trim();
  _formState.telefono = String(c.querySelector('#appProfilePhone')?.value || '').trim();
  _formState.avatarUrl = String(c.querySelector('#appProfileAvatarUrl')?.value || '').trim();
  _formState.theme = String(c.querySelector('#appProfileTheme')?.value || 'light').trim();
  _formState.visualDensity = String(c.querySelector('#appProfileDensity')?.value || 'compacta').trim();
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
      visualDensity: _formState.visualDensity
    }
  };

  try {
    await db.collection(COL.USERS).doc(docId).set(payload, { merge: true });
    if (!_mounted) return;
    const nextProfile = { ...current, ...payload };
    setState({ profile: nextProfile });
    _ctx?.shell?.setProfile?.(nextProfile, getState().role);
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

function _makeFormState(profile = {}) {
  return {
    nombreCompleto: String(profile.nombreCompleto || profile.nombre || profile.usuario || '').trim(),
    telefono: String(profile.telefono || '').trim(),
    avatarUrl: String(profile.avatarUrl || profile.photoURL || profile.fotoURL || profile.profilePhotoUrl || '').trim(),
    theme: String(profile?.profilePreferences?.theme || 'light').trim(),
    visualDensity: String(profile?.profilePreferences?.visualDensity || 'compacta').trim()
  };
}

function _html(profile, role, form) {
  const name = form.nombreCompleto || profile.email || 'Usuario';
  const email = profile.email || profile.id || '';
  const roleLabel = ROLE_LABELS[role] || profile.roleLabel || role || 'AUXILIAR';
  const plaza = String(profile.plazaAsignada || profile.plaza || '').toUpperCase().trim() || '—';
  return `
<div style="padding:24px;max-width:760px;margin:0 auto;font-family:Inter,sans-serif;">
  <h1 style="margin:0 0 12px;font-size:26px;color:#0f172a;">Mi perfil</h1>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;background:#fff;">
      <div style="font-size:11px;color:#94a3b8;">Usuario</div><div style="font-weight:800;color:#0f172a;">${esc(name)}</div>
    </div>
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;background:#fff;">
      <div style="font-size:11px;color:#94a3b8;">Rol · Plaza</div><div style="font-weight:700;color:#334155;">${esc(roleLabel)} · ${esc(plaza)}</div>
    </div>
  </div>
  <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;background:#fff;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Nombre / Nombre completo
        <input id="appProfileName" value="${escAttr(form.nombreCompleto)}" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Teléfono
        <input id="appProfilePhone" value="${escAttr(form.telefono)}" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Avatar URL
        <input id="appProfileAvatarUrl" value="${escAttr(form.avatarUrl)}" placeholder="https://..." style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Email (solo lectura)
        <input value="${escAttr(email)}" readonly style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:8px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Rol (solo lectura)
        <input value="${escAttr(roleLabel)}" readonly style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:8px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Plaza (solo lectura)
        <input value="${escAttr(plaza)}" readonly style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:8px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Tema
        <select id="appProfileTheme" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
          <option value="light" ${form.theme === 'light' ? 'selected' : ''}>Claro</option>
          <option value="dark" ${form.theme === 'dark' ? 'selected' : ''}>Oscuro</option>
        </select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#475569;">Densidad visual
        <select id="appProfileDensity" style="border:1px solid #dbe3ef;border-radius:8px;padding:8px;">
          <option value="compacta" ${form.visualDensity === 'compacta' ? 'selected' : ''}>Compacta</option>
          <option value="media" ${form.visualDensity === 'media' ? 'selected' : ''}>Media</option>
          <option value="amplia" ${form.visualDensity === 'amplia' ? 'selected' : ''}>Amplia</option>
        </select>
      </label>
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
