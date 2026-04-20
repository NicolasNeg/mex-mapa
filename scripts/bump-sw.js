#!/usr/bin/env node
/**
 * scripts/bump-sw.js
 * Incrementa automáticamente la versión del Service Worker antes de cada deploy.
 * Uso: node scripts/bump-sw.js
 * Se llama desde npm run deploy / npm run deploy:staging
 */

const fs   = require('fs');
const path = require('path');

const SW_PATH = path.join(__dirname, '..', 'sw.js');

const content = fs.readFileSync(SW_PATH, 'utf8');
const match   = content.match(/mapa-v(\d+)/);

if (!match) {
  console.error('[bump-sw] ERROR: No se encontró el patrón mapa-vXXX en sw.js');
  process.exit(1);
}

const current    = parseInt(match[1], 10);
const next       = current + 1;
const updated    = content.replace(/mapa-v\d+/g, `mapa-v${next}`);

fs.writeFileSync(SW_PATH, updated, 'utf8');
console.log(`[bump-sw] ✓ Service Worker: mapa-v${current} → mapa-v${next}`);
