/**
 * Invitaciones — panel admin (códigos de acceso).
 * Reutiliza la vista de gestión sin duplicar lógica.
 */
import { mount as mountGestion, unmount as unmountGestion } from '/js/app/views/gestion.js';

let _host = null;

export function mountInvitacionesPanel(host) {
  unmountInvitacionesPanel();
  _host = host;
  _host.classList.add('adm-invitaciones-host');
  _host.innerHTML = '<div class="adm-invitaciones-mount"></div>';
  const mountEl = _host.querySelector('.adm-invitaciones-mount');
  mountGestion({ container: mountEl });
  const title = mountEl.querySelector('.gestion-title');
  const sub = mountEl.querySelector('.gestion-sub');
  if (title) title.textContent = 'Invitaciones';
  if (sub) sub.textContent = 'Genera y revoca códigos de acceso por plaza y rol.';
}

export function syncInvitacionesSelection() {
  /* lista en tiempo real vía subscribeInvitaciones */
}

export function unmountInvitacionesPanel() {
  unmountGestion();
  if (_host) {
    _host.classList.remove('adm-invitaciones-host');
    _host.innerHTML = '';
  }
  _host = null;
}
