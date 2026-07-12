// Rules test: ¿un usuario puede subir su foto de perfil (Storage) y escribir los
// campos de avatar en su doc (Firestore)?
// firebase emulators:exec --only firestore,storage "node scripts/test-avatar-rules.js"
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc } = require('firebase/firestore');
const { ref, uploadBytes, deleteObject } = require('firebase/storage');

const root = path.join(__dirname, '..');
const UID = 'user-uid-123';
const EMAIL = 'gerente@gmail.com';

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-avatar',
    firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') },
    storage: { rules: fs.readFileSync(path.join(root, 'storage.rules'), 'utf8') },
  });

  // seed
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'configuracion/empresa'), { security: { roles: { GERENTE_PLAZA: { permissions: {} } } } });
    // doc del usuario por UID (como en producción cuando existe por uid)
    await setDoc(doc(db, 'usuarios/' + UID), { rol: 'GERENTE_PLAZA', email: EMAIL, nombre: 'Ángel', avatarUrl: '', avatarPath: '' });
  });

  const ctx = testEnv.authenticatedContext(UID, { email: EMAIL });
  const results = [];

  // 1. Storage: subir foto a profile_avatars/{uid}/avatar.jpg
  try {
    const st = ctx.storage();
    const r = ref(st, `profile_avatars/${UID}/avatar_1.jpg`);
    await uploadBytes(r, new Uint8Array([255, 216, 255, 0]), { contentType: 'image/jpeg' });
    results.push(['Storage: subir avatar (uid path)', 'ALLOWED ✅']);
  } catch (e) { results.push(['Storage: subir avatar (uid path)', 'DENIED ❌ ' + (e.code || e.message)]); }

  // 2. Firestore: escribir campos de avatar en el doc propio
  try {
    const db = ctx.firestore();
    await updateDoc(doc(db, 'usuarios/' + UID), {
      avatarUrl: 'https://x/a.jpg', avatarPath: 'profile_avatars/' + UID + '/avatar_1.jpg',
      photoURL: 'https://x/a.jpg', fotoURL: 'https://x/a.jpg', profilePhotoUrl: 'https://x/a.jpg',
    });
    results.push(['Firestore: escribir campos avatar', 'ALLOWED ✅']);
  } catch (e) { results.push(['Firestore: escribir campos avatar', 'DENIED ❌ ' + (e.code || e.message)]); }

  // 3. Storage: BORRAR el avatar anterior (limpieza) bajo el path del email
  await testEnv.withSecurityRulesDisabled(async (c) => {
    const st = c.storage();
    await uploadBytes(ref(st, `profile_avatars/${EMAIL}/avatar_old.jpg`), new Uint8Array([255, 216, 255, 0]), { contentType: 'image/jpeg' });
  });
  try {
    const st = ctx.storage();
    await deleteObject(ref(st, `profile_avatars/${EMAIL}/avatar_old.jpg`));
    results.push(['Storage: borrar avatar anterior (email path)', 'ALLOWED ✅']);
  } catch (e) { results.push(['Storage: borrar avatar anterior (email path)', 'DENIED ❌ ' + (e.code || e.message)]); }

  console.log('\n── Cambiar foto de perfil ──');
  for (const [l, r] of results) console.log(`  ${r.padEnd(26)}  ${l}`);
  await testEnv.cleanup();
})();
