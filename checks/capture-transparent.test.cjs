const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
 const browser = await chromium.launch({ headless: true, channel: 'msedge' });
 try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto((process.env.FORM_BASE_URL || 'http://127.0.0.1:4186') + '/design.html');
  await page.waitForFunction(() => document.getElementById('loading').hidden && !document.getElementById('dayCycle').disabled, null, { timeout: 90000 });
  await page.locator('#snapshot').click();
  await page.waitForFunction(() => document.body.classList.contains('capture-frame-settled'));
  assert.equal(await page.locator('#captureStatus').count(), 0);
  await page.locator('#captureTransparent').check();
  const canvasPixels = () => page.evaluate(() => {
   const source = document.getElementById('canvas'), output = document.createElement('canvas');
   output.width = source.width; output.height = source.height;
   const context = output.getContext('2d'); context.drawImage(source, 0, 0);
   const pixels = context.getImageData(0, 0, output.width, output.height).data;
   let transparent = 0, opaque = 0;
   for (let i = 3; i < pixels.length; i += 4) { if (!pixels[i]) transparent++; if (pixels[i] === 255) opaque++; }
   return { transparent, opaque, total: output.width * output.height, cornerAlpha: pixels[3] };
  });
  await page.waitForFunction(() => document.body.classList.contains('capture-transparent'));
  await page.waitForTimeout(100);
  const preview = await canvasPixels();
  assert.equal(preview.cornerAlpha, 0);
  assert.ok(preview.transparent > preview.total * .1);
  assert.ok(preview.opaque > preview.total * .05, 'Model renders against transparent surround');
  await page.screenshot({ path: 'checks/capture-transparent-desktop.png' });
  const downloadPromise = page.waitForEvent('download'); await page.locator('#captureShoot').click();
  const downloaded = await downloadPromise;
  assert.match(downloaded.suggestedFilename(), /-transparent\.png$/);
  const bytes = await fs.readFile(await downloaded.path());
  const exported = await page.evaluate(async data => {
   const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
   const output = document.createElement('canvas'); output.width = bitmap.width; output.height = bitmap.height;
   const context = output.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
   const pixels = context.getImageData(0, 0, output.width, output.height).data;
   let transparent = 0, opaque = 0;
   for (let i = 3; i < pixels.length; i += 4) { if (!pixels[i]) transparent++; if (pixels[i] === 255) opaque++; }
   return { width: output.width, height: output.height, cornerAlpha: pixels[3], transparent, opaque };
  }, bytes.toString('base64'));
  assert.equal(exported.width, 1920); assert.equal(exported.height, 1080);
  assert.equal(exported.cornerAlpha, 0); assert.ok(exported.transparent > 0); assert.ok(exported.opaque > 0);
  await page.locator('#captureTransparent').uncheck(); await page.waitForTimeout(100);
  assert.equal((await canvasPixels()).transparent, 0, 'Opaque backdrop returns when disabled');
  await page.locator('#captureTransparent').check(); await page.locator('#captureExit').click();
  await page.waitForFunction(() => !document.body.classList.contains('capture-mode'));
  assert.equal((await canvasPixels()).transparent, 0, 'Exiting restores the normal scene');
  await page.locator('#snapshot').click(); await page.waitForFunction(() => document.body.classList.contains('capture-frame-settled'));
  assert.ok((await canvasPixels()).transparent > 0, 'Transparency preference survives re-entry');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
  const panel = await page.locator('#capturePanel').boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 390);
  await page.screenshot({ path: 'checks/capture-transparent-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: removed caption, transparent preview and PNG alpha, output dimensions, opaque restoration, re-entry, desktop/mobile layout');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
