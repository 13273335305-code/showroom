const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
function makeBmp() {
  const width = 24, height = 18, stride = width * 3, data = Buffer.alloc(54 + stride * height);
  data.write('BM'); data.writeUInt32LE(data.length, 2); data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14); data.writeInt32LE(width, 18); data.writeInt32LE(height, 22); data.writeUInt16LE(1, 26); data.writeUInt16LE(24, 28);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(x >= 8 && x < 16 && y >= 6 && y < 12 ? [60, 90, 140] : [225, 235, 240], 54 + y * stride + x * 3);
  return data;
}
(async () => {
  let savedPackage;
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/relief-test.formmat' && savedPackage) { res.setHeader('Content-Type', 'application/zip'); res.end(savedPackage); return; }
    if (pathname === '/shared/auth.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(`export async function requireAuth(){document.documentElement.classList.remove('auth-pending');document.getElementById('authBootLoading')?.remove();} export const authState=()=>null; export const isAuthenticated=()=>true; export async function workspaceClient(){return null} export async function clearAuth(){}`); return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
      const body = await fs.readFile(file);
      const hook = `\nwindow.reliefSnapshot = () => ({ asset: currentAsset(), maps: Object.fromEntries(['normalMap','aoMap'].map(k => [k, material[k] ? { colorSpace: material[k].colorSpace, channel: material[k].channel, matrix: material[k].matrix.toArray() } : null])) });`;
      res.end(pathname === '/entries/material-editor.js' ? body.toString() + hook : body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port; let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await require('./project-test-server.cjs').installProjectFixture(context);
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(url + '/material-editor.html');
    await page.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    await page.evaluate(() => { window.reliefMessages = 0; addEventListener('message', event => { if (event.data?.type === 'procedural-relief-material') reliefMessages++; }); });
    await page.locator('#exportMaterial').click();
    const frame = page.frameLocator('#proceduralFrame');
    await frame.locator('#fileInput').setInputFiles({ name: 'relief.bmp', mimeType: 'image/bmp', buffer: makeBmp() });
    await page.waitForFunction(() => !document.getElementById('proceduralFrame').contentDocument.getElementById('downloadButton').disabled);
    await frame.locator('body').evaluate(() => {
      state.recessedClasses = new Set([1]); renderPaletteControls();
      document.getElementById('reliefRadius').value = '2'; document.getElementById('gaussianBlur').value = '1';
      document.getElementById('aoRadius').value = '3'; document.getElementById('aoStrength').value = '1.3';
      postProceduralState();
      window.reliefJobs = []; const start = KnitRenderJob.start;
      KnitRenderJob.start = (options, callbacks) => { const job = start(options, callbacks); if (options.output === 'relief') { reliefJobs.push(options.output); job.promise.then(result => { window.lastReliefMode = result.mode; }, () => {}); } return job; };
    });
    await frame.locator('#normalButton').click();
    await page.waitForFunction(() => !document.getElementById('remove-aoMap').disabled && !document.getElementById('remove-normalMap').disabled && !document.getElementById('saveMaterial').disabled);
    const generated = await frame.locator('body').evaluate(async () => {
      const images = {};
      for (const kind of ['height', 'normal', 'ao']) {
        const c = document.getElementById(kind + 'PreviewCanvas'), data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const bytes = new DataView(await (await fetch(state[kind + 'Url'])).arrayBuffer());
        images[kind] = { width: c.width, height: c.height, min: data.reduce((a, b) => Math.min(a, b), 255), dpiX: bytes.getUint16(14), dpiY: bytes.getUint16(16) };
      }
      return { images, jobs: reliefJobs, mode: lastReliefMode, tileable: currentRenderOptions().tileable };
    });
    assert.deepEqual(generated.jobs, ['relief']); assert.equal(generated.mode, 'worker');
    assert.equal(generated.tileable, true, 'The editor enables periodic height and normal generation');
    for (const image of Object.values(generated.images)) { assert.equal(image.width, 94); assert.equal(image.height, 118); assert.equal(image.dpiX, 100); assert.equal(image.dpiY, 100); }
    assert.ok(generated.images.ao.min < 250);
    const snapshot = await page.evaluate(() => { const s = reliefSnapshot(); return { names: Object.fromEntries(Object.entries(s.asset.maps).map(([key, file]) => [key, file.name])), maps: s.maps }; });
    assert.equal(snapshot.names.aoMap, 'procedural-ao.jpg'); assert.equal(snapshot.names.normalMap, 'procedural-normal-opengl.jpg');
    assert.equal(snapshot.maps.aoMap.colorSpace, ''); assert.equal(snapshot.maps.normalMap.colorSpace, '');
    assert.equal(snapshot.maps.aoMap.channel, snapshot.maps.normalMap.channel); assert.deepEqual(snapshot.maps.aoMap.matrix, snapshot.maps.normalMap.matrix);
    const downloaded = page.waitForEvent('download');
    await frame.locator('#aoDownloadButton').click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), 'fabric-ao.jpg');
    await frame.locator('[data-preview-map=ao]').click();
    await fs.mkdir(path.join(root, '.codex-project-check'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.codex-project-check/procedural-ao-desktop.png') });
    const packed = await page.evaluate(async () => { const { packMaterial } = await import('/shared/material-package.js'); const blob = await packMaterial(reliefSnapshot().asset); return [...new Uint8Array(await blob.arrayBuffer())]; });
    savedPackage = Buffer.from(packed);
    const restored = await page.evaluate(async () => { const { unpackMaterial } = await import('/shared/material-package.js'); const asset = await unpackMaterial(await (await fetch('/relief-test.formmat')).blob()); return { names: Object.keys(asset.maps), aoRadius: asset.proceduralMapping.options.aoRadius, aoStrength: asset.proceduralMapping.options.aoStrength, tileable: asset.proceduralMapping.options.tileable }; });
    assert.ok(restored.names.includes('aoMap')); assert.equal(restored.aoRadius, 3); assert.equal(restored.aoStrength, 1.3);
    assert.equal(restored.tileable, true, 'The material package retains periodic generation');
    await frame.locator('#aoStrength').fill('0.5'); await frame.locator('#aoStrength').dispatchEvent('input');
    await page.waitForFunction(() => document.getElementById('remove-aoMap').disabled && document.getElementById('remove-normalMap').disabled);
    for (const kind of ['height', 'normal', 'ao']) assert.equal(await frame.locator('#' + kind + 'DownloadButton').isDisabled(), true);
    await frame.locator('body').evaluate(() => { window.Worker = undefined; });
    await frame.locator('#normalButton').click();
    await page.waitForFunction(() => !document.getElementById('remove-aoMap').disabled && !document.getElementById('saveMaterial').disabled);
    assert.equal(await frame.locator('body').evaluate(() => lastReliefMode), 'fallback');
    // Cancel while a JPEG encode is pending. Its late completion must not
    // re-enable downloads or publish the cancelled run to material channels.
    const messagesBefore = await page.evaluate(() => reliefMessages);
    await frame.locator('body').evaluate(() => {
      window.encodeStarted = new Promise(resolve => { window.resolveEncodeStarted = resolve; });
      const encode = encodeImageJpeg;
      encodeImageJpeg = async (...args) => { encodeImageJpeg = encode; resolveEncodeStarted(); await new Promise(resolve => { window.releaseEncode = resolve; }); return encode(...args); };
      window.cancelledRender = renderNormal();
    });
    await frame.locator('body').evaluate(async () => { await encodeStarted; invalidateNormal(); releaseEncode(); await cancelledRender; });
    assert.equal(await page.evaluate(() => reliefMessages), messagesBefore);
    for (const kind of ['height', 'normal', 'ao']) assert.equal(await frame.locator('#' + kind + 'DownloadButton').isDisabled(), true);
    await page.waitForFunction(() => document.getElementById('remove-aoMap').disabled && document.getElementById('remove-normalMap').disabled);
    await frame.locator('#normalButton').click();
    await page.waitForFunction(() => !document.getElementById('remove-aoMap').disabled && !document.getElementById('saveMaterial').disabled);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await frame.locator('[data-preview-map=ao]').isVisible(), true);
    await page.screenshot({ path: path.join(root, '.codex-project-check/procedural-ao-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await context.route('**/shared/asset-store.js', route => route.fulfill({ contentType: 'text/javascript', body: `import {unpackMaterial} from './material-package.js'; export async function getAsset(){return {...await unpackMaterial(await (await fetch('/relief-test.formmat')).blob()),id:'saved-relief'}} export async function saveAsset(a){return a} export async function getMaterialSource(){return null}` }));
    await page.goto(url + '/material-editor.html?asset=saved-relief');
    await page.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    await page.locator('#exportMaterial').click();
    await frame.locator('#sourceFileName').filter({ hasText: 'relief.bmp' }).waitFor();
    await page.waitForFunction(() => !document.getElementById('proceduralFrame').contentDocument.getElementById('downloadButton').disabled);
    assert.equal(await page.locator('#remove-aoMap').isDisabled(), false, 'Opening the procedural editor preserves saved AO');
    assert.equal(await page.locator('#remove-normalMap').isDisabled(), false);
    assert.equal(await frame.locator('#aoRadius').inputValue(), '3');
    assert.equal(await frame.locator('#aoStrength').inputValue(), '1.3');
    assert.deepEqual(errors, []);
    console.log('PASS: one Worker field, three JPGs, AO channel/UV/color space, package persistence, invalidation, fallback and mobile layout');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
