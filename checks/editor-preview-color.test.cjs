const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
// PLAYWRIGHT_PATH can point to a bundled installation outside the project.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/shared/auth.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export async function requireAuth() {}'); return; }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
      const body = await fs.readFile(file);
      // Read-only access to the real editor renderer; authentication is stubbed
      // only on this isolated test origin, without touching application files.
      res.end(pathname === '/entries/material-editor.js' ? body.toString() + '\nwindow.editorColorProbe = () => ({ renderer, scene, camera, material });' : body);
    }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/material-editor.html`);
    await page.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    async function upload(key, rgb) {
      const buffer = Buffer.from(await page.evaluate(color => {
        const c = document.createElement('canvas'); c.width = c.height = 32;
        const x = c.getContext('2d'); x.fillStyle = `rgb(${color.join(',')})`; x.fillRect(0, 0, 32, 32);
        return c.toDataURL().split(',')[1];
      }, rgb), 'base64');
      await page.locator('#map-' + key).setInputFiles({ name: key + '.png', mimeType: 'image/png', buffer });
      await page.waitForFunction(k => document.getElementById('upload-' + k).classList.contains('has-image') && !document.getElementById('saveMaterial').disabled, key);
    }
    const sample = () => page.evaluate(() => {
      const { renderer, scene, camera } = editorColorProbe(); renderer.render(scene, camera);
      const gl = renderer.getContext(), pixel = new Uint8Array(4);
      gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel].slice(0, 3);
    });
    const colors = [[40,40,40],[80,80,80],[128,128,128],[190,190,190],[240,240,240],[180,80,40],[40,100,180]], actual = [];
    for (const color of colors) { await upload('map', color); actual.push(await sample()); }
    const error = actual.reduce((sum, pixel, i) => sum + pixel.reduce((s, v, j) => s + Math.abs(v - colors[i][j]), 0), 0) / 21;
    assert.ok(error < 5, `Mean color error ${error} should stay below 5/255`);
    for (const pixel of actual.slice(0, 5)) assert.equal(Math.max(...pixel) - Math.min(...pixel), 0, 'Neutral grays stay neutral');
    await upload('map', [128, 128, 128]);
    const flat = await sample(); await upload('normalMap', [255, 128, 128]); const normal = await sample();
    assert.ok(normal.some((v, i) => Math.abs(v - flat[i]) > 2), 'Normal mapping still changes shading');
    await page.locator('#remove-normalMap').evaluate(button => button.click());
    await page.locator('#roughness').evaluate(input => { input.value = '.2'; input.dispatchEvent(new Event('input')); }); const smooth = await sample();
    await page.locator('#roughness').evaluate(input => { input.value = '.9'; input.dispatchEvent(new Event('input')); }); const rough = await sample();
    assert.notDeepEqual(smooth, rough, 'Roughness still affects reflection');
    assert.equal(await page.evaluate(() => editorColorProbe().material.isMeshStandardMaterial), true);
    assert.deepEqual(errors, [], 'Real editor compiles and renders without errors');
    console.log(JSON.stringify({ colors, actual, meanChannelError: error, flat, normal, smooth, rough }));
    console.log('PASS: real editor sRGB color accuracy, neutral gray balance, normal shading and roughness response.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
