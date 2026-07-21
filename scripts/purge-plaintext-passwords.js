#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));

const COLLECTIONS = ['usuarios', 'admins', 'solicitudes', 'solicitudes_acceso'];
const APPLY_CONFIRMATION = 'PURGE-PLAINTEXT-PASSWORDS';
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find(arg => arg.startsWith('--confirm='))?.slice('--confirm='.length) || '';

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

if (apply && confirmation !== APPLY_CONFIRMATION) {
  console.error(`Para aplicar usa --apply --confirm=${APPLY_CONFIRMATION}`);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
const db = admin.firestore();

async function inspectCollection(collectionName) {
  const snap = await db.collection(collectionName).get();
  const affected = snap.docs.filter(doc => Object.prototype.hasOwnProperty.call(doc.data() || {}, 'password'));
  const states = affected.reduce((counts, doc) => {
    const state = String(doc.data()?.estado || 'SIN_ESTADO').trim().toUpperCase() || 'SIN_ESTADO';
    counts[state] = (counts[state] || 0) + 1;
    return counts;
  }, {});

  if (apply && affected.length > 0) {
    for (let offset = 0; offset < affected.length; offset += 400) {
      const batch = db.batch();
      affected.slice(offset, offset + 400).forEach(doc => {
        batch.update(doc.ref, { password: admin.firestore.FieldValue.delete() });
      });
      await batch.commit();
    }
  }

  return { scanned: snap.size, affected: affected.length, states };
}

(async () => {
  let scanned = 0;
  let affected = 0;
  console.log(apply ? 'Purga de passwords en texto plano' : 'Auditoria dry-run de passwords en texto plano');

  for (const collectionName of COLLECTIONS) {
    const result = await inspectCollection(collectionName);
    scanned += result.scanned;
    affected += result.affected;
    console.log(`${collectionName}: ${result.affected} afectados de ${result.scanned} revisados`);
    if (result.affected > 0) {
      console.log(`  estados: ${Object.entries(result.states).map(([key, value]) => `${key}=${value}`).join(', ')}`);
    }
  }

  console.log(`Total: ${affected} afectados de ${scanned} revisados`);
  if (!apply && affected > 0) {
    console.log(`Para purgar: node scripts/purge-plaintext-passwords.js --apply --confirm=${APPLY_CONFIRMATION}`);
  }
})().catch(error => {
  console.error(`Fallo la auditoria: ${error.message}`);
  process.exitCode = 1;
});
