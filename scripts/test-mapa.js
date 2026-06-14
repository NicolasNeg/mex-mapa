#!/usr/bin/env node
// scripts/test-mapa.js
// Playwright smoke-test: login → /app/mapa → sidebar + controles menu
//
// Usage:
//   node scripts/test-mapa.js                  # headless (CI)
//   node scripts/test-mapa.js --headed          # visible browser
//   node scripts/test-mapa.js --url http://localhost:5000

const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');

const BASE_URL  = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://localhost:5000';
const HEADED    = process.argv.includes('--headed');
const EMAIL     = 'jlp@gmail.com';
const PASSWORD  = '123456';

// ── ANSI helpers ──────────────────────────────────────────────
const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const B = s => `\x1b[34m${s}\x1b[0m`;

function pass(label) { console.log(G('  ✔ ') + label); }
function fail(label, err) { console.log(R('  ✘ ') + label + (err ? ` — ${err}` : '')); }
function info(label) { console.log(B('  → ') + label); }

// ── Start local server if needed ──────────────────────────────
let _serverProc = null;
async function ensureServer() {
  const http = require('http');
  return new Promise(resolve => {
    const req = http.get(BASE_URL, () => { req.destroy(); resolve(false); })
      .on('error', () => resolve(true));
  }).then(needsStart => {
    if (!needsStart) { info(`Servidor ya activo en ${BASE_URL}`); return; }
    info(`Iniciando servidor en ${BASE_URL}...`);
    _serverProc = spawn('npx', ['serve', '.', '--single', '--listen', '5000'], {
      cwd: process.cwd(),
      stdio: 'ignore',
      detached: false,
    });
    return new Promise(r => setTimeout(r, 2000));
  });
}

// ── Main test ─────────────────────────────────────────────────
(async () => {
  console.log(Y('\n── mex-mapa smoke test ──────────────────────────────\n'));

  await ensureServer();

  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 120 : 0 });
  const ctx     = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    geolocation: { latitude: 19.4326, longitude: -99.1332 },  // CDMX
    permissions: ['geolocation'],
  });
  const page    = await ctx.newPage();

  // Collect console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  let passed = 0, failed = 0;
  function check(label, ok, errMsg) {
    if (ok) { pass(label); passed++; } else { fail(label, errMsg); failed++; }
  }

  try {
    // ── 1. Login ─────────────────────────────────────────────
    info('Navegando a login...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Wait for Firebase to init and show the login form
    await page.waitForSelector('#auth_email', { timeout: 15000 });
    check('Página de login cargó', page.url().includes('login'));

    await page.fill('#auth_email', EMAIL);
    await page.fill('#auth_pass', PASSWORD);
    info(`Login como ${EMAIL}...`);
    await page.click('button[type="submit"], #btn-login, button:has-text("Entrar"), button:has-text("Iniciar")');

    // Wait for redirect to /app/*
    await page.waitForURL('**/app/**', { timeout: 20000 }).catch(() => {});
    check('Redirigió tras login', page.url().includes('/app/'));

    // ── 2. Navegar a /app/mapa ────────────────────────────────
    info('Navegando a /app/mapa...');
    await page.goto(`${BASE_URL}/app/mapa`, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Wait for mapa stage to initialize
    await page.waitForFunction(
      () => document.getElementById('mex-legacy-mapa-stage')?.dataset?.mexInit === '1',
      { timeout: 20000 }
    ).catch(() => {});

    const stageInit = await page.evaluate(
      () => document.getElementById('mex-legacy-mapa-stage')?.dataset?.mexInit === '1'
    );
    check('Mapa stage inicializado', stageInit);

    // Dismiss location gate if it appears
    await page.waitForTimeout(1500);
    const locationGateActive = await page.evaluate(
      () => document.getElementById('mexLocationGateOverlay')?.classList.contains('active')
    );
    if (locationGateActive) {
      info('Location gate activo — descartando programáticamente...');
      await page.evaluate(
        () => document.getElementById('mexLocationGateOverlay')?.classList.remove('active')
      );
      await page.waitForTimeout(300);
    }

    // ── 3. toggleControlesMenu ────────────────────────────────
    info('Probando toggleControlesMenu...');
    const menuDefined = await page.evaluate(() => typeof window.toggleControlesMenu === 'function');
    check('window.toggleControlesMenu definido', menuDefined);

    if (menuDefined) {
      const btnControles = await page.$('#btnControles');
      check('#btnControles existe en el DOM', !!btnControles);

      if (btnControles) {
        await btnControles.click();
        await page.waitForTimeout(200);
        const menuVisible = await page.evaluate(() => {
          const m = document.getElementById('controlesMenu');
          return m && m.style.display !== 'none';
        });
        check('CONTROLES menu abre al hacer click', menuVisible);

        // Close it by clicking outside
        await page.keyboard.press('Escape');
        await page.click('body');
        await page.waitForTimeout(200);
        const menuClosed = await page.evaluate(() => {
          const m = document.getElementById('controlesMenu');
          return !m || m.style.display === 'none';
        });
        check('CONTROLES menu se cierra al clickear fuera', menuClosed);
      }
    }

    // ── 4. Sidebar de unidades ────────────────────────────────
    info('Probando sidebar de unidades...');
    const sidebarExists = await page.evaluate(() => !!document.getElementById('sidebar'));
    check('#sidebar existe en el DOM', sidebarExists);

    const btnAbrir = await page.$('#btnAbrirUnidades');
    check('#btnAbrirUnidades existe en el DOM', !!btnAbrir);

    if (sidebarExists) {
      // Try opening via the fleet button in the header
      const fleetBtn = await page.$('#mexHdrMapaFleet');
      if (fleetBtn) {
        await fleetBtn.click();
      } else if (btnAbrir) {
        await btnAbrir.click();
      } else {
        await page.evaluate(() => window.toggleSidebar?.());
      }

      await page.waitForTimeout(400);
      const sidebarOpen = await page.evaluate(
        () => document.getElementById('sidebar')?.classList.contains('open')
      );
      check('Sidebar se abre (clase .open)', sidebarOpen);

      // Verify key elements are inside
      const hasLimbo = await page.evaluate(() => !!document.getElementById('unidades-limbo'));
      const hasTaller = await page.evaluate(() => !!document.getElementById('unidades-taller'));
      const hasSearch = await page.evaluate(() => !!document.getElementById('searchInputMobile'));
      check('#unidades-limbo existe en sidebar', hasLimbo);
      check('#unidades-taller existe en sidebar', hasTaller);
      check('#searchInputMobile existe en sidebar', hasSearch);

      // Close sidebar
      await page.evaluate(() => window.toggleSidebar?.(false));
      await page.waitForTimeout(400);
      const sidebarClosed = await page.evaluate(
        () => !document.getElementById('sidebar')?.classList.contains('open')
      );
      check('Sidebar se cierra', sidebarClosed);
    }

    // ── 5. Console errors ─────────────────────────────────────
    const criticalErrors = errors.filter(e =>
      e.includes('ReferenceError') ||
      e.includes('toggleControlesMenu') ||
      e.includes('TypeError') ||
      e.includes('is not defined')
    );
    check('Sin ReferenceError en consola', criticalErrors.length === 0,
      criticalErrors.length > 0 ? criticalErrors[0].slice(0, 120) : '');

  } catch (err) {
    fail('Error inesperado', err.message);
    failed++;
  } finally {
    await browser.close();
    if (_serverProc) _serverProc.kill();
  }

  // ── Summary ───────────────────────────────────────────────
  console.log('');
  console.log(Y('── Resultado ────────────────────────────────────────'));
  console.log(`  ${G(`${passed} passed`)}  ${failed > 0 ? R(`${failed} failed`) : '0 failed'}`);
  if (errors.length > 0) {
    console.log(Y(`\n  Console errors capturados (${errors.length}):`));
    errors.slice(0, 5).forEach(e => console.log(R('  ' + e.slice(0, 200))));
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
})();
