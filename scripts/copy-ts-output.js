// Copies compiled output for each TS-authored file (from tsconfig.papeletas.json's
// `include`, excluding .d.ts) from the temporary outDir back to its real served path.
// `allowJs` pulls untouched .js dependencies into the same compilation (needed so
// this migration's .ts files can read their types), and giving tsc a real outDir
// avoids TS5055 (emit would overwrite input) -- but that means only the genuinely
// authored .ts outputs should be copied back, not the incidental passthrough copies
// of files this migration never touched.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.papeletas.json'), 'utf8'));
const outDir = tsconfig.compilerOptions.outDir;
if (!outDir) throw new Error('tsconfig.papeletas.json must set compilerOptions.outDir');
const outRoot = path.join(root, outDir);

let copied = 0;
for (const entry of tsconfig.include) {
  if (entry.endsWith('.d.ts')) continue; // ambient declarations only, never compiled to a servable .js
  if (!entry.endsWith('.ts')) continue;
  const tsSourcePath = path.join(root, entry);
  if (!fs.existsSync(tsSourcePath)) {
    // Not yet converted by this migration -- do NOT check outDir here. tsc's
    // allowJs pulls in the still-plain .js sibling of any not-yet-converted
    // entry as a passthrough dependency of whatever .ts file imports it, so a
    // compiled copy of it DOES exist in outDir even though we never authored
    // a .ts for it yet. Copying that back would silently overwrite/reformat
    // an untouched source file. Always gate on the real .ts source existing.
    console.warn(`[copy-ts-output] skip (not yet converted): ${entry}`);
    continue;
  }
  const jsRelPath = entry.replace(/\.ts$/, '.js');
  const src = path.join(outRoot, jsRelPath);
  const dest = path.join(root, jsRelPath);
  fs.copyFileSync(src, dest);
  copied += 1;
  console.log(`[copy-ts-output] ${jsRelPath}`);
}
console.log(`[copy-ts-output] done - ${copied} file(s) copied from ${outDir}`);
