// ═══════════════════════════════════════════════════════════
//  /js/programador/main.js  —  Entry point del Panel Programador
//
//  Solo accesible para rol PROGRAMADOR.
//  Si el usuario no es PROGRAMADOR → /app
//  Si no está autenticado → /login
//
//  Este boot limpia cualquier contexto de empresa previo y
//  establece el contexto superadmin antes de montar el shell.
// ═══════════════════════════════════════════════════════════

import { auth } from '/js/core/database.js';

async function boot() {
  const user = await new Promise(resolve => {
    const unsub = auth.onAuthStateChanged(u => { unsub(); resolve(u || null); });
  });

  if (!user) {
    window.location.replace('/login');
    return;
  }

  let profile = null;
  try {
    profile = await window.__mexLoadCurrentUserRecord?.(user) ?? null;
  } catch (_) {}

  if (!profile) {
    try { await auth.signOut(); } catch (_) {}
    window.location.replace('/login');
    return;
  }

  const role = String(profile.rol || '').toUpperCase();
  if (role !== 'PROGRAMADOR') {
    window.location.replace('/app');
    return;
  }

  // Esperar config si está pendiente
  if (window.__mexConfigReadyPromise) {
    try { await window.__mexConfigReadyPromise; } catch (_) {}
  }

  const root = document.getElementById('appRoot');
  const spinner = document.getElementById('appLoadingSpinner');
  if (!root) return;

  root.style.display = '';
  spinner?.remove();

  const { mountProgramadorShell } = await import('/js/programador/shell.js');
  mountProgramadorShell({ profile, user, root });
}

boot().catch(err => {
  console.error('[programador/main] Boot error:', err);
  const spinner = document.getElementById('appLoadingSpinner');
  if (spinner) {
    spinner.innerHTML = `
      <div style="color:#f87171;font-family:Inter,sans-serif;text-align:center;padding:32px;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <div style="font-size:14px;margin-bottom:16px;">Error al cargar el panel</div>
        <a href="/login" style="color:#818cf8;text-decoration:none;font-size:13px;">Volver al login</a>
      </div>
    `;
  }
});
