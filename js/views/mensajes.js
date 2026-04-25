// js/views/mensajes.js
import { auth, db, COL } from '/js/core/database.js';
import { ensureRouteShellLayout } from '/js/views/home.js';

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.replace('/login');
    return;
  }

  let profile = {};
  try {
    const email = (user.email || '').toLowerCase().trim();
    const snap = await db.collection(COL.USUARIOS).where('email', '==', email).limit(1).get();
    if (!snap.empty) profile = snap.docs[0].data() || {};
  } catch (_) { /* use empty profile if fetch fails */ }

  const appRoot = document.getElementById('buzon-modal');
  if (!appRoot) return;

  ensureRouteShellLayout({
    appRoot,
    profile,
    currentRoute: '/mensajes',
    mainClass: 'overflow-hidden p-0'
  });
});
