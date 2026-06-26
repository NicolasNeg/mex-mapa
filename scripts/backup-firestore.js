// scripts/backup-firestore.js — respaldo local de Firestore a JSON (sin gcloud).
// Uso:
//   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node scripts/backup-firestore.js
// o coloca el key en ./serviceAccountKey.json (gitignored) y corre sin env.
//
// Descarga la service-account key en:
//   Firebase Console → Configuración del proyecto → Cuentas de servicio →
//   "Generar nueva clave privada" → guarda como serviceAccountKey.json en la raíz.
//
// Vuelca TODAS las colecciones (con subcolecciones) a backups/<timestamp>/.
// Los Timestamp se guardan como { _seconds, _nanoseconds } (restaurable).

const path = require('path');
const fs = require('fs');
const admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('✗ Falta la service-account key en:', keyPath);
  console.error('  Descárgala de Firebase Console → Cuentas de servicio → Generar nueva clave privada.');
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
