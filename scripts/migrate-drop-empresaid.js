// scripts/migrate-drop-empresaid.js — migración single-tenant (sin gcloud).
// Uso (PowerShell):
//   $env:GOOGLE_APPLICATION_CREDENTIALS='C:\ruta\fuera-del-webroot\service-account.json'
//   node scripts/migrate-drop-empresaid.js --dry
//   node scripts/migrate-drop-empresaid.js
//
// CORRE EL BACKUP PRIMERO (scripts/backup-firestore.js) y verifica con --dry.
//
// Hace 3 cosas:
//   1) Borra el campo `empresaId` de las colecciones planas.
//   2) Renombra doc ids `{empresaId}__{PLAZA}` → `{PLAZA}` en settings y mapa_config
//      (copia datos + subcolecciones, p.ej. mapa_config/.../estructura, y borra el viejo).
//   3) Mueve empresas/{id}/unidades → unidades_catalogo (colección plana).

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
const DRY = process.argv.includes('--dry');
const tag = DRY ? ' (dry)' : '';

// Colecciones donde SOLO se elimina el campo empresaId.
const DROP_FIELD_COLS = [
  'alertas', 'notas', 'externos', 'usuarios', 'cuadre', 'cuadre_adm',
  'historial_patio', 'historial_cuadres', 'auditoria', 'ops_events',
  'index', 'mensajes', 'plantillas_alertas',
];

// Colecciones con doc id compuesto {empresaId}__{PLAZA} → {PLAZA}.
const RENAME_DOCID_COLS = ['settings', 'mapa_config'];

async function dropField(col) {
  const snap = await db.collection(col).get();
  let batch = db.batch(), n = 0, total = 0;
  for (const doc of snap.docs) {
    if (!('empresaId' in doc.data())) continue;
    if (!DRY) batch.update(doc.ref, { empresaId: admin.firestore.FieldValue.delete() });
    total++;
    if (++n >= 400) { if (!DRY) await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (!DRY && n) await batch.commit();
  console.log(`[${col}] empresaId borrado en ${total} docs${tag}`);
}

// Copia doc (datos + subcolecciones) recursivamente al destino.
async function copyDeep(srcRef, dstRef, dropEmpresaId) {
  const snap = await srcRef.get();
  if (snap.exists) {
    const data = snap.data();
    if (dropEmpresaId) delete data.empresaId;
    if (!DRY) await dstRef.set(data, { merge: true });
  }
  const subs = await srcRef.listCollections();
  for (const sub of subs) {
    const subSnap = await sub.get();
    for (const d of subSnap.docs) {
      await copyDeep(d.ref, dstRef.collection(sub.id).doc(d.id), false);
    }
  }
}

async function deleteDeep(ref) {
  const subs = await ref.listCollections();
  for (const sub of subs) {
    const s = await sub.get();
    for (const d of s.docs) await deleteDeep(d.ref);
  }
  if (!DRY) await ref.delete();
}

async function renameDocIds(col) {
  const snap = await db.collection(col).get();
  let moved = 0;
  for (const doc of snap.docs) {
    const sep = doc.id.indexOf('__');
    if (sep < 0) continue; // ya es {PLAZA}
    const plaza = doc.id.slice(sep + 2);
    if (!plaza) continue;
    await copyDeep(doc.ref, db.collection(col).doc(plaza), true);
    await deleteDeep(doc.ref);
    moved++;
  }
  console.log(`[${col}] ${moved} doc ids {empresaId}__{PLAZA} → {PLAZA}${tag}`);
}

async function moveUnidadesCatalogo() {
  let empresas;
  try { empresas = await db.collection('empresas').get(); }
  catch { console.log('[unidades_catalogo] sin colección empresas, omitido'); return; }
  let moved = 0;
  for (const emp of empresas.docs) {
    const units = await emp.ref.collection('unidades').get();
    for (const u of units.docs) {
      if (!DRY) {
        const data = u.data();
        delete data.empresaId;
        await db.collection('unidades_catalogo').doc(u.id).set(data, { merge: true });
      }
      moved++;
    }
  }
  console.log(`[unidades_catalogo] ${moved} unidades movidas${tag}`);
}

(async () => {
  console.log(DRY ? '=== DRY RUN (no escribe) ===' : '=== MIGRACIÓN REAL ===');
  for (const c of DROP_FIELD_COLS) await dropField(c);
  for (const c of RENAME_DOCID_COLS) await renameDocIds(c);
  await moveUnidadesCatalogo();
  console.log(`\n✓ Migración ${DRY ? 'simulada' : 'completa'}.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
