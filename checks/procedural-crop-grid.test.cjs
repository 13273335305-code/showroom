const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const runtime = 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/';
const { chromium } = require(process.env.PLAYWRIGHT_PATH || runtime + 'playwright');
const { PNG } = require(process.env.PNGJS_PATH || runtime + 'pngjs');
const root = path.resolve(__dirname, '..');

function checkerboardBmp() {
  const width = 48, height = 36, stride = width * 3, data = Buffer.alloc(54 + stride * height);
  data.write('BM'); data.writeUInt32LE(data.length, 2); data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14); data.writeInt32LE(width, 18); data.writeInt32LE(height, 22);
  data.writeUInt16LE(1, 26); data.writeUInt16LE(24, 28);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = 54 + y * stride + x * 3;
    data.set((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? [15, 50, 235] : [255, 255, 255], i);
  }
  return data;
}

// Read the rendered PNGs independently of canvas/SVG coordinate calculations.
function edgesAt(raster, grid, axis, sample) {
  const length = axis === 'x' ? raster.width : raster.height;
  const offset = i => axis === 'x' ? (sample * raster.width + i) * 4 : (i * raster.width + sample) * 4;
  const pixels = [], lines = [];
  let previous, weight = 0, weighted = 0;
  for (let i = 0; i < length; i++) {
    const p = offset(i), red = raster.data[p + 1] < 140;
    if (previous !== undefined && red !== previous) pixels.push(i);
    previous = red;
    const ink = Math.max(Math.abs(grid.data[p] - raster.data[p]), Math.abs(grid.data[p + 1] - raster.data[p + 1]), Math.abs(grid.data[p + 2] - raster.data[p + 2]));
    if (ink > 2) { weight += ink; weighted += (i + .5) * ink; }
    else if (weight) { lines.push(weighted / weight); weight = weighted = 0; }
  }
  return { pixels: pixels.filter(i => i > 3 && i < length - 3), lines: lines.filter(i => i > 3 && i < length - 3) };
}

(async () => {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname, file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    for (const dpr of [1, 1.25, 2]) {
      const page = await browser.newPage({ viewport: { width: 1441, height: 1001 }, deviceScaleFactor: dpr });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:' + server.address().port + '/web-demo/index.html');
      await page.locator('#fileInput').setInputFiles({ name: 'pixel-grid.bmp', mimeType: 'image/bmp', buffer: checkerboardBmp() });
      await page.waitForFunction(() => !document.getElementById('cropButton').disabled);
      for (const zoom of [.9, 1, 1.1]) {
        await page.evaluate(zoom => { cropTool.cancel(); document.body.style.zoom = zoom; }, zoom);
        await page.locator('#cropButton').click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
        await page.evaluate(() => {
          inputViewport.scale = 45.37; inputViewport.offsetX = 13.27; inputViewport.offsetY = -8.61; inputViewport.render();
          document.getElementById('inputPreviewWrap').style.background = '#fff';
        });
        const viewport = await page.locator('#inputPreviewWrap').boundingBox();
        await page.mouse.move(viewport.x + 180, viewport.y + 160);
        await page.mouse.down({ button: 'middle' }); await page.mouse.move(viewport.x + 203, viewport.y + 177); await page.mouse.up({ button: 'middle' });
        await page.mouse.wheel(0, -100);
        await page.waitForTimeout(80);
        await page.mouse.move(0, 0);
        const clip = { x: Math.ceil(viewport.x + 40), y: Math.ceil(viewport.y + 120), width: 500, height: 500 };
        await page.locator('.crop-overlay').evaluate(el => el.style.visibility = 'hidden');
        const raster = PNG.sync.read(await page.screenshot({ clip }));
        await page.locator('.crop-overlay').evaluate(el => el.style.visibility = '');
        const grid = PNG.sync.read(await page.screenshot({ clip }));
        const measured = {};
        for (const axis of ['x', 'y']) {
          const other = edgesAt(raster, grid, axis === 'x' ? 'y' : 'x', 100);
          const sample = Math.floor((other.lines[1] + other.lines[2]) / 2);
          const { pixels, lines } = edgesAt(raster, grid, axis, sample);
          assert.ok(pixels.length >= 4 && lines.length >= 7, JSON.stringify({ dpr, zoom, axis, sample, pixels, lines, other }));
          const deltas = pixels.map(edge => Math.min(...lines.map(line => Math.abs(edge - line))));
          const max = Math.max(...deltas);
          assert.ok(max <= 1.5 * dpr, 'Raster and grid ' + axis + ' edges differ by ' + max.toFixed(2) + ' device pixels at DPR ' + dpr + ', page zoom ' + zoom);
          measured[axis] = pixels[Math.floor(pixels.length / 2)];
        }
        // A click on an actual rendered BMP corner must select that same grid corner.
        await page.mouse.click(clip.x + measured.x / dpr, clip.y + measured.y / dpr);
        assert.equal(await page.locator('#cropProgress').textContent(), '1 / 3');
        const point = await page.locator('.crop-overlay circle').evaluate(el => {
          const p = new DOMPoint(el.cx.baseVal.value, el.cy.baseVal.value).matrixTransform(el.getScreenCTM());
          return { x: p.x, y: p.y };
        });
        assert.ok(Math.abs((point.x - clip.x) * dpr - measured.x) <= 1.5 * dpr, 'Selected corner matches the raster x edge');
        assert.ok(Math.abs((point.y - clip.y) * dpr - measured.y) <= 1.5 * dpr, 'Selected corner matches the raster y edge');
        if (dpr === 1 && zoom === 1.1) {
          await page.locator('#cropReset').click();
          await fs.mkdir(path.join(root, '.codex-project-check'), { recursive: true });
          await page.screenshot({ path: path.join(root, '.codex-project-check/procedural-crop-grid-aligned.png'), clip });
        }
      }
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('PASS: rendered BMP edges, grid lines and snapped crop corners align after pan/zoom at 90/100/110% page zoom and DPR 1/1.25/2.');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
