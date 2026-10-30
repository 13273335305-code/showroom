const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
let savedPackage;

function makeBmp() {
  const width = 32, height = 24, stride = width * 3, data = Buffer.alloc(54 + stride * height);
  data.write('BM'); data.writeUInt32LE(data.length, 2); data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14); data.writeInt32LE(width, 18); data.writeInt32LE(height, 22);
  data.writeUInt16LE(1, 26); data.writeUInt16LE(24, 28);
  const colors = [[235, 229, 216], [76, 111, 102], [163, 103, 85]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgb = colors[(Math.floor(x / 5) + Math.floor(y / 4)) % 3], i = 54 + y * stride + x * 3;
    data[i] = rgb[2]; data[i + 1] = rgb[1]; data[i + 2] = rgb[0];
  }
  return data;
}

(async () => {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/crop-test.formmat' && savedPackage) { res.setHeader('Content-Type', 'application/zip'); res.end(savedPackage); return; }
    if (pathname === '/shared/auth.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end('export async function requireAuth(){document.documentElement.classList.remove("auth-pending");document.getElementById("authBootLoading")?.remove();} export const authState=()=>null; export const isAuthenticated=()=>true; export async function workspaceClient(){return null} export async function clearAuth(){}'); return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
      const body = await fs.readFile(file);
      res.end(pathname === '/entries/material-editor.js' ? body.toString() + '\nwindow.proceduralCropSnapshot = () => currentAsset();' : body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await require('./project-test-server.cjs').installProjectFixture(context);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/material-editor.html');
    await page.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    await page.locator('#exportMaterial').click();
    const frame = page.frameLocator('#proceduralFrame');
    await frame.locator('#cropButton').waitFor();
    assert.equal(await frame.locator('#texture, #textureValue, label[for="texture"]').count(), 0, 'Removed microtexture controls do not appear');
    assert.equal(await frame.locator('#cropButton').isDisabled(), true);
    await frame.locator('#fileInput').setInputFiles({ name: 'crop-sample.bmp', mimeType: 'image/bmp', buffer: makeBmp() });
    await page.waitForFunction(() => !document.getElementById('proceduralFrame').contentDocument.getElementById('downloadButton').disabled);
    const original = await frame.locator('body').evaluate(() => ({ pixels: [...state.imageData.data], width: state.width, height: state.height }));
    const clickPixel = async (x, y) => {
      const box = await frame.locator('#inputCanvas').boundingBox();
      const size = await frame.locator('#inputCanvas').evaluate(el => ({ width: el.width, height: el.height }));
      await page.mouse.click(box.x + x * box.width / size.width, box.y + y * box.height / size.height);
    };
    await frame.locator('#cropButton').click();
    assert.equal(await frame.locator('[data-preview-map=input]').getAttribute('aria-pressed'), 'true');
    assert.equal(await frame.locator('#cropApply').isDisabled(), true);
    assert.equal(await frame.locator('.crop-overlay').isVisible(), true);
    await frame.locator('.crop-overlay path').first().waitFor({ state: 'visible' });
    const viewport = await frame.locator('#inputPreviewWrap').boundingBox();
    await page.mouse.click(viewport.x + 10, viewport.y + 150);
    assert.equal(await frame.locator('#cropProgress').textContent(), '0 / 3', 'Clicks outside BMP do not select');
    await clickPixel(4.2, 3.2);
    await clickPixel(4.2, 3.2);
    assert.equal(await frame.locator('#cropProgress').textContent(), '1 / 3', 'Duplicate point does not create a zero-length edge');
    await clickPixel(22.2, 4.2);
    assert.equal(await frame.locator('#cropProgress').textContent(), '2 / 3');
    await page.keyboard.press('Backspace');
    assert.equal(await frame.locator('#cropProgress').textContent(), '1 / 3');
    await frame.locator('#cropReset').click();
    assert.equal(await frame.locator('#cropProgress').textContent(), '0 / 3');
    await frame.locator('#cropCancel').click();
    assert.equal(await frame.locator('#cropToolbar').isVisible(), false);
    assert.deepEqual(await frame.locator('body').evaluate(() => [...state.imageData.data]), original.pixels);
    await frame.locator('#cropButton').click(); await clickPixel(5, 5); await page.keyboard.press('Escape');
    assert.equal(await frame.locator('#cropToolbar').isVisible(), false);
    await frame.locator('#cropButton').click(); await frame.locator('[data-preview-map=fabric]').click();
    assert.equal(await frame.locator('#cropToolbar').isVisible(), false);
    const paletteBefore = await frame.locator('body').evaluate(() => {
      state.palette[0].loopHex = '#112233'; state.palette[0].loopRgb = { r: 17, g: 34, b: 51 };
      state.recessedClasses = new Set([0, 2]); renderPaletteControls();
      return state.palette.map(entry => ({ sourceHex: entry.sourceHex, loopHex: entry.loopHex, recessed: state.recessedClasses.has(entry.index) }));
    });
    await frame.locator('#normalButton').click();
    await page.waitForFunction(() => !document.getElementById('proceduralFrame').contentDocument.getElementById('normalDownloadButton').disabled);
    await frame.locator('#cropButton').click();
    const beforePan = await frame.locator('#inputCanvas').boundingBox();
    await page.mouse.move(beforePan.x + 40, beforePan.y + 40);
    await page.mouse.down({ button: 'middle' }); await page.mouse.move(beforePan.x + 63, beforePan.y + 57); await page.mouse.up({ button: 'middle' });
    const afterPan = await frame.locator('#inputCanvas').boundingBox();
    assert.ok(Math.abs(afterPan.x - beforePan.x - 23) < 1);
    assert.equal(await frame.locator('#cropProgress').textContent(), '0 / 3', 'Panning does not select a corner');
    await page.mouse.move(afterPan.x + 80, afterPan.y + 70); await page.mouse.wheel(0, -100);
    await page.waitForTimeout(80);
    await clickPixel(4.2, 3.2); await clickPixel(22.2, 4.2); await clickPixel(21.7, 18.2);
    assert.equal(await frame.locator('#cropProgress').textContent(), '18 × 15 px');
    const circles = await frame.locator('.crop-overlay circle').evaluateAll(nodes => nodes.map(el => [Number(el.getAttribute('cx')), Number(el.getAttribute('cy'))]));
    assert.equal(circles.length, 3); assert.equal(circles[0][1], circles[1][1]); assert.equal(circles[1][0], circles[2][0]);
    await fs.mkdir(path.join(root, '.codex-project-check'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.codex-project-check/procedural-crop-selection.png') });
    await frame.locator('#cropApply').click();
    assert.equal(await frame.locator('#cropToolbar').isVisible(), false);
    const cropped = await frame.locator('body').evaluate(async () => {
      const bmp = await state.sourceFile.arrayBuffer();
      const decoded = await createImageBitmap(state.sourceFile), probe = document.createElement('canvas');
      probe.width = decoded.width; probe.height = decoded.height; const ctx = probe.getContext('2d'); ctx.drawImage(decoded, 0, 0); decoded.close();
      return { width: state.width, height: state.height, pixels: [...state.imageData.data], bmpWidth: new DataView(bmp).getInt32(18, true), decoded: [...ctx.getImageData(0, 0, probe.width, probe.height).data], palette: state.palette.map(entry => ({ sourceHex: entry.sourceHex, loopHex: entry.loopHex, recessed: state.recessedClasses.has(entry.index) })) };
    });
    assert.equal(cropped.width, 18); assert.equal(cropped.height, 15); assert.equal(cropped.bmpWidth, 18);
    const expected = []; for (let y = 3; y < 18; y++) expected.push(...original.pixels.slice((y * 32 + 4) * 4, (y * 32 + 22) * 4));
    assert.deepEqual(cropped.pixels, expected, 'Confirmed crop copies the exact original grid cells');
    assert.deepEqual(cropped.decoded, expected, 'Persisted BMP decodes to identical colors and pixels');
    for (const entry of cropped.palette) assert.deepEqual(entry, paletteBefore.find(item => item.sourceHex === entry.sourceHex), 'Palette edits and relief choices follow source colors');
    assert.equal(await frame.locator('#normalDownloadButton').isDisabled(), true);
    assert.equal(await frame.locator('#heightDownloadButton').isDisabled(), true);
    await page.waitForFunction(() => document.getElementById('remove-normalMap').disabled);
    await page.waitForFunction(() => !document.getElementById('proceduralFrame').contentDocument.getElementById('downloadButton').disabled);
    const output = await frame.locator('#outputCanvas').evaluate(el => [el.width, el.height]);
    assert.deepEqual(output, [71, 98]);
    assert.match(await frame.locator('#physicalSizeInfo').textContent(), /1.8 × 2.5 cm/);
    await frame.locator('#normalButton').click();
    await page.waitForFunction(() => !document.getElementById('proceduralFrame').contentDocument.getElementById('normalDownloadButton').disabled);
    assert.deepEqual(await frame.locator('#normalPreviewCanvas').evaluate(el => [el.width, el.height]), output);
    await page.waitForFunction(() => !document.getElementById('remove-normalMap').disabled);
    await page.screenshot({ path: path.join(root, '.codex-project-check/procedural-crop-applied.png') });
    // A second crop can start with a vertical edge and run back toward the origin.
    await frame.locator('#cropButton').click(); await clickPixel(17, 14); await clickPixel(16, 1); await clickPixel(1, 2);
    assert.equal(await frame.locator('#cropProgress').textContent(), '16 × 13 px');
    await frame.locator('#cropApply').click();
    assert.deepEqual(await frame.locator('body').evaluate(() => [state.width, state.height]), [16, 13]);
    await page.setViewportSize({ width: 390, height: 844 });
    await frame.locator('#cropButton').click();
    assert.equal(await frame.locator('#cropToolbar').isVisible(), true);
    assert.equal(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await clickPixel(2, 2); await clickPixel(12, 3); await clickPixel(12, 10);
    assert.equal(await frame.locator('#cropProgress').textContent(), '10 × 8 px');
    await page.screenshot({ path: path.join(root, '.codex-project-check/procedural-crop-mobile.png') });
    await frame.locator('#cropCancel').click();
    assert.deepEqual(errors, []);
    await page.waitForFunction(() => !document.getElementById('saveMaterial').disabled && !document.getElementById('proceduralFrame').contentDocument.getElementById('downloadButton').disabled);
    const packaged = await page.evaluate(async () => {
      const asset = proceduralCropSnapshot();
      if ('texture' in asset.proceduralMapping.options) throw new Error('Saved mapping contains obsolete microtexture');
      // Reopen a legacy material with the removed effect set to its maximum.
      asset.proceduralMapping.options.texture = 1;
      const { packMaterial } = await import('./shared/material-package.js');
      return [...new Uint8Array(await (await packMaterial(asset)).arrayBuffer())];
    });
    savedPackage = Buffer.from(packaged);
    const savedPixels = await frame.locator('body').evaluate(() => [...state.imageData.data]);
    await context.route('**/shared/asset-store.js', route => route.fulfill({ contentType: 'text/javascript', body: 'import {unpackMaterial} from "./material-package.js"; export async function getAsset(){return {...await unpackMaterial(new File([await (await fetch("/crop-test.formmat")).blob()],"saved.formmat")),id:"saved-crop"}} export async function saveAsset(a){return a} export async function getMaterialSource(){return null}' }));
    await page.goto('http://127.0.0.1:' + server.address().port + '/material-editor.html?asset=saved-crop');
    await page.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    await page.locator('#exportMaterial').click();
    await frame.locator('#sourceFileName').filter({ hasText: 'crop-sample-crop.bmp' }).waitFor();
    assert.deepEqual(await frame.locator('body').evaluate(() => [state.width, state.height]), [16, 13]);
    assert.deepEqual(await frame.locator('body').evaluate(() => [...state.imageData.data]), savedPixels, 'Reopening saved material restores cropped source pixels');
    const restoredOptions = await frame.locator('body').evaluate(() => ({ render: 'texture' in currentRenderOptions(), saved: 'texture' in proceduralMappingSnapshot().options }));
    assert.deepEqual(restoredOptions, { render: false, saved: false }, 'Legacy microtexture cannot be restored or saved again');
    await page.waitForFunction(() => !('texture' in proceduralCropSnapshot().proceduralMapping.options));
    assert.deepEqual(errors, []);
    console.log('PASS: three-point grid snapping, both edge directions, duplicate/outside rejection, pan/zoom, reset/cancel/Escape, exact pixel crop, BMP persistence, palette preservation, map invalidation/regeneration, repeated crop and mobile layout.');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
