// scripts/backup-firestore.js — respaldo local de Firestore a JSON (sin gcloud).
// Uso (PowerShell):
//   $env:GOOGLE_APPLICATION_CREDENTIALS='C:\ruta\fuera-del-webroot\service-account.json'
//   node scripts/backup-firestore.js
//
// Vuelca TODAS las colecciones (con subcolecciones) a backups/<timestamp>/.
// Los Timestamp se guardan como { _seconds, _nanoseconds } (restaurable).

const path = require('path');
const fs = require('fs');
const admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));

const configuredKeyPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
if (!configuredKeyPath) {
  console.error('Define GOOGLE_APPLICATION_CREDENTIALS con una ruta fuera de la raiz publica.');
  process.exit(1);
}
const keyPath = path.resolve(configuredKeyPath);
if (!fs.existsSync(keyPath)) {
  console.error('No existe la service-account key configurada.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
const db = admin.firestore();

const outDir = path.join(__dirname, '../backups', new Date().toISOString().replace(/[:.]/g, '-'));

async function dumpCollection(ref, dir) {
  const snap = await ref.get();
  if (snap.empty) return 0;
  fs.mkdirSync(dir, { recursive: true });
  const docs = {};
  let count = 0;
  for (const doc of snap.docs) {
    docs[doc.id] = doc.data();
    count++;
    const subs = await doc.ref.listCollections();
    for (const sub of subs) {
      count += await dumpCollection(sub, path.join(dir, doc.id, sub.id));
    }
  }
  fs.writeFileSync(path.join(dir, '_docs.json'), JSON.stringify(docs, null, 2));
  return count;
}

(async () => {
  const cols = await db.listCollections();
  let total = 0;
  for (const col of cols) {
    const n = await dumpCollection(col, path.join(outDir, col.id));
    console.log(`[${col.id}] ${n} docs`);
    total += n;
  }
  console.log(`\n✓ Backup completo: ${total} docs en ${outDir}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
