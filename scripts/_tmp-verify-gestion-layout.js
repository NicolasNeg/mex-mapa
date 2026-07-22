const { chromium } = require('playwright');
const os = require('os');
const path = require('path');

const base = 'http://127.0.0.1:5000';
const stamp = Date.now();
const shots = {
  desktop: path.join(os.tmpdir(), `mex-historial-gestion-desktop-polish-${stamp}.png`),
  mobileLeft: path.join(os.tmpdir(), `mex-historial-gestion-mobile-left-polish-${stamp}.png`),
  mobileRight: path.join(os.tmpdir(), `mex-historial-gestion-mobile-right-polish-${stamp}.png`),
};

const verificationFailures = [];
function assert(value, message, details) {
  if (!value) verificationFailures.push({ message, details });
}

async function revealAndMock(page) {
  await page.evaluate(() => {
    document.documentElement.classList.remove('mex-app-booting');
    const root = document.getElementById('appRoot');
    if (root) root.style.visibility = 'visible';
    const overlay = document.getElementById('mexAppBootstrapOverlay');
    if (overlay) overlay.style.display = 'none';

    const fallback = document.createElement('style');
    fallback.textContent = `
      .material-icons, .material-symbols-outlined, .material-symbols-rounded {
        position: relative !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        flex: 0 0 18px !important;
        width: 18px !important;
        height: 18px !important;
        overflow: hidden !important;
        color: transparent !important;
        font-size: 0 !important;
      }
      .material-icons::after, .material-symbols-outlined::after, .material-symbols-rounded::after {
        content: '';
        width: 8px;
        height: 8px;
        border: 2px solid #64748b;
        border-radius: 2px;
      }
    `;
    document.head.appendChild(fallback);

    const now = Date.now();
    window.api.obtenerHistorialLogs = async () => [];
    window.api.obtenerLogsServer = async () => [];
    window.api.obtenerEventosGestion = async () => [
      {
        fecha: '21/7/2026, 6:09:51 p.m.', timestamp: now,
        tipo: 'USUARIO_EDITADO', accion: 'Permisos actualizados', autor: 'ANGEL ARMENTA',
        userEmail: 'angel@example.com', entidad: 'Usuario', referencia: 'leonardo@example.com',
        detalles: 'Rol y plazas actualizados', rolObjetivo: 'GERENTE_PLAZA', plazaObjetivo: 'BJX', resultado: 'OK',
        exactLocation: {
          latitude: 21.019015, longitude: -101.257359,
          addressLabel: 'Silao, Guanajuato', city: 'Silao', state: 'Guanajuato', capturedAt: now,
        },
      },
      {
        fecha: '21/7/2026, 5:30:00 p.m.', timestamp: now - 1000,
        tipo: 'CONFIG_GLOBAL', accion: 'Configuracion actualizada', autor: 'QA LOCAL',
        entidad: 'Empresa', referencia: 'Politica operativa', detalles: 'Cambio de configuracion',
        locationStatus: 'denied',
      },
    ];
  });
}

async function metrics(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.hist-op-root');
    const scroll = document.querySelector('#hist-op-panel-gestion .hist-op-table-scroll');
    const table = scroll?.querySelector('table');
    const first = table?.querySelector('tbody tr');
    const context = first?.querySelector('.hist-op-cell-context');
    const contextMain = context?.querySelector('strong');
    const contextMeta = context?.querySelector('span');
    const authorMain = first?.querySelector('.hist-op-cell-author strong');
    const link = first?.querySelector('.hist-op-ubi-btn');
    const locationCell = first?.querySelector('.hist-op-location-cell');
    const rect = el => {
      const r = el?.getBoundingClientRect();
      return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } : null;
    };
    const lineCount = el => {
      if (!el) return 0;
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = [...range.getClientRects()].map(r => Math.round(r.top * 10) / 10);
      return new Set(tops).size;
    };
    const scrollRect = rect(scroll);
    const linkRect = rect(link);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth },
      root: rect(root),
      scroll: {
        clientWidth: scroll?.clientWidth || 0,
        scrollWidth: scroll?.scrollWidth || 0,
        scrollLeft: scroll?.scrollLeft || 0,
        rect: scrollRect,
      },
      table: { rect: rect(table), layout: table ? getComputedStyle(table).tableLayout : '' },
      firstRowHeight: rect(first)?.height || 0,
      context: {
        rect: rect(context), mainText: contextMain?.textContent.trim() || '',
        mainLines: lineCount(contextMain), metaLines: lineCount(contextMeta),
      },
      author: { mainLines: lineCount(authorMain), rect: rect(authorMain) },
      verUbi: {
        text: link?.textContent.trim() || '', rect: linkRect,
        scrollWidth: link?.scrollWidth || 0, clientWidth: link?.clientWidth || 0,
        insideScrollViewport: !!(linkRect && scrollRect && linkRect.left >= scrollRect.left - 1 && linkRect.right <= scrollRect.right + 1),
        insideLocationCell: !!(linkRect && locationCell && linkRect.right <= locationCell.getBoundingClientRect().right + 1),
        href: link?.href || '',
      },
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  const report = { ok: false, shots, errors };
  try {
    await page.goto(`${base}/app/dashboard?qaAuth=1`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForFunction(() => typeof window.__mexShellNavigate === 'function' && !!window.api, null, { timeout: 25000 });
    await revealAndMock(page);
    await page.evaluate(() => window.__mexShellNavigate('/app/historial-operativo'));
    await page.waitForSelector('#hist-op-tab-ges', { timeout: 15000 });
    await page.click('#hist-op-tab-ges');
    await page.waitForFunction(() => document.querySelectorAll('#hist-op-tablaGes tbody tr').length === 2);

    report.desktop = await metrics(page);
    assert(report.desktop.table.layout === 'fixed', 'Gestion no usa table-layout fixed', report.desktop);
    assert(report.desktop.scroll.scrollWidth <= report.desktop.scroll.clientWidth, 'Gestion mantiene scroll horizontal en desktop', report.desktop.scroll);
    assert(report.desktop.document.scrollWidth <= 1441, 'Gestion causa overflow global en desktop', report.desktop.document);
    assert(report.desktop.verUbi.insideScrollViewport && report.desktop.verUbi.insideLocationCell, 'Ver ubi queda cortado en desktop', report.desktop.verUbi);
    assert(report.desktop.verUbi.scrollWidth <= report.desktop.verUbi.clientWidth + 1 && /Ver ubi/i.test(report.desktop.verUbi.text), 'Texto Ver ubi queda truncado', report.desktop.verUbi);
    assert(report.desktop.context.mainText === 'leonardo@example.com' && report.desktop.context.mainLines === 1, 'La referencia se parte de forma absurda', report.desktop.context);
    assert(report.desktop.context.metaLines <= 5 && report.desktop.author.mainLines <= 2, 'Contexto o autor tienen demasiadas lineas', { context: report.desktop.context, author: report.desktop.author });
    assert(report.desktop.firstRowHeight <= 125, 'La primera fila sigue demasiado alta', report.desktop.firstRowHeight);
    await page.screenshot({ path: shots.desktop, fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    report.mobileLeft = await metrics(page);
    assert(report.mobileLeft.document.scrollWidth <= 391, 'Gestion causa overflow global en movil', report.mobileLeft.document);
    assert(report.mobileLeft.root.left >= -1 && report.mobileLeft.root.right <= 391, 'Root de Gestion sale del viewport movil', report.mobileLeft.root);
    assert(report.mobileLeft.scroll.scrollWidth > report.mobileLeft.scroll.clientWidth, 'Gestion perdio el scroll interno movil', report.mobileLeft.scroll);
    await page.screenshot({ path: shots.mobileLeft, fullPage: false });

    await page.evaluate(() => {
      const scroll = document.querySelector('#hist-op-panel-gestion .hist-op-table-scroll');
      scroll.scrollLeft = scroll.scrollWidth;
    });
    await page.waitForTimeout(100);
    report.mobileRight = await metrics(page);
    assert(report.mobileRight.scroll.scrollLeft > 0, 'No se pudo desplazar la tabla movil', report.mobileRight.scroll);
    assert(report.mobileRight.verUbi.insideScrollViewport, 'Ver ubi no aparece completo al desplazar la tabla movil', report.mobileRight.verUbi);
    assert(report.mobileRight.document.scrollWidth <= 391, 'El scroll interno movil genero overflow global', report.mobileRight.document);
    await page.screenshot({ path: shots.mobileRight, fullPage: false });

    report.relevantErrors = errors.filter(error => {
      if (/ERR_NETWORK_ACCESS_DENIED|firebase is not defined|window\._mex|Firebase no est.{0,2} listo|unidades-lookup|reading 'collection'/i.test(error)) return false;
      return /historial-op|ReferenceError|TypeError|SyntaxError|pageerror/i.test(error);
    });
    assert(report.relevantErrors.length === 0, 'Errores relevantes de Historial', report.relevantErrors);
    report.verificationFailures = verificationFailures;
    report.ok = verificationFailures.length === 0;
    if (!report.ok) report.failure = verificationFailures.map(item => item.message).join('; ');
  } catch (error) {
    report.failure = error.message;
    report.failureDetails = error.details || null;
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
})();
