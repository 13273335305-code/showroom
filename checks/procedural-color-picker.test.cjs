const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');

function makeBmp() {
  const width = 32, height = 24, stride = width * 3, data = Buffer.alloc(54 + stride * height);
  data.write('BM'); data.writeUInt32LE(data.length, 2); data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14); data.writeInt32LE(width, 18); data.writeInt32LE(height, 22);
  data.writeUInt16LE(1, 26); data.writeUInt16LE(24, 28);
  const colors = [[239, 242, 245], [76, 111, 102], [163, 103, 85]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgb = colors[(Math.floor(x / 5) + Math.floor(y / 4)) % 3], i = 54 + y * stride + x * 3;
    data[i] = rgb[2]; data[i + 1] = rgb[1]; data[i + 2] = rgb[0];
  }
  return data;
}

(async () => {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/shared/auth.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end('export async function requireAuth(){document.documentElement.classList.remove("auth-pending");document.getElementById("authBootLoading")?.remove();} export const authState=()=>({id:"11111111-1111-1111-1111-111111111111"}); export const workspaceClient=async()=>(await import("./project-store.js")).fixtureAccess();');
    }
    const file = path.resolve(root, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
      res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream');
      const body = await fs.readFile(file);
      res.end(pathname === '/entries/material-editor.js' ? body.toString() + '\nwindow.pickerEditorSnapshot = () => currentAsset();' : body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const fixture = await require('./project-test-server.cjs').installProjectFixture(context);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/material-editor.html');
    await page.waitForFunction(() => window.pickerEditorSnapshot && !document.getElementById('saveMaterial').disabled);
    await page.locator('#exportMaterial').click();
    const frame = page.frameLocator('#proceduralFrame');
    await frame.locator('#fileInput').waitFor();
    await frame.locator('#dpi').fill('20');
    await frame.locator('#fileInput').setInputFiles({ name: 'color-picker.bmp', mimeType: 'image/bmp', buffer: makeBmp() });
    const waitRendered = () => frame.locator('body').evaluate(() => new Promise(resolve => {
      const check = () => !state.renderQueued && state.renderedId === state.renderId && !document.getElementById('downloadButton').disabled ? resolve() : setTimeout(check, 10);
      check();
    }));
    await waitRendered();
    const read = () => frame.locator('body').evaluate(() => ({ palette: state.palette.map(entry => ({ index: entry.index, color: entry.loopHex, source: entry.sourceHex })), recessed: [...state.recessedClasses], renders: state.renderId, pixels: [...outputCtx.getImageData(0, 0, outputCanvas.width, outputCanvas.height).data] }));
    const editor = frame.locator('#paletteColorEditor'), value = frame.locator('#paletteColorValue');
    const swatch = frame.locator('[data-color-index="1"]');
    const confirm = editor.locator('button');
    assert.equal(await frame.locator('input[type=color]').count(), 0);
    assert.equal(await frame.locator('.palette-row').count(), 3);
    assert.equal(await editor.evaluate(el => el.classList.contains('is-placeholder')), true);
    const initial = await read(), idleHeight = (await editor.boundingBox()).height;
    await swatch.click();
    assert.equal(await editor.evaluate(el => getComputedStyle(el).position), 'fixed');
    assert.equal(await editor.getAttribute('data-open'), 'true');
    assert.equal(await value.inputValue(), initial.palette[1].color);
    assert.equal((await editor.boundingBox()).height, idleHeight);
    for (const canvas of await editor.locator('canvas').all()) {
      assert.ok(await canvas.evaluate(el => new Set(el.getContext('2d').getImageData(0, 0, el.width, el.height).data).size > 20));
    }
    await value.fill('#12'); await confirm.click();
    assert.equal((await read()).palette[1].color, initial.palette[1].color);
    assert.equal(await value.evaluate(el => el.validity.valid), false);
    await value.fill('#123456');
    await value.press('Escape');
    assert.equal(await editor.evaluate(el => el.classList.contains('is-placeholder')), true);
    assert.equal(await editor.getAttribute('data-open'), 'false');
    assert.equal((await read()).renders, initial.renders, 'Cancelled drafts never render or change the mapping');

    await swatch.click();
    const hue = frame.locator('#paletteColorHue');
    await hue.click({ position: { x: 8, y: 68 } });
    const saturation = frame.locator('#paletteColorSaturation');
    const bounds = await saturation.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .3, bounds.y + 50); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + 80, { steps: 5 }); await page.mouse.up();
    assert.notEqual(await value.inputValue(), initial.palette[1].color);
    await saturation.press('ArrowLeft'); await hue.press('End');
    assert.equal(await hue.getAttribute('aria-valuenow'), '359');
    await value.fill('336699'); await value.press('Enter'); await waitRendered();
    const updated = await read();
    assert.equal(updated.palette[1].color, '#336699');
    assert.deepEqual(updated.palette.filter(entry => entry.index !== 1), initial.palette.filter(entry => entry.index !== 1));
    assert.deepEqual(updated.recessed, initial.recessed);
    assert.notDeepEqual(updated.pixels, initial.pixels);
    await page.waitForFunction(() => pickerEditorSnapshot().proceduralMapping.palette[1].loopHex === '#336699');

    await frame.locator('#backgroundColorSwatch').click();
    await value.fill('#F1E2D3'); await confirm.click(); await waitRendered();
    assert.equal(await frame.locator('#backgroundColorValue').textContent(), '#F1E2D3');
    await page.waitForFunction(() => pickerEditorSnapshot().proceduralMapping.options.background.r === 241);
    const relief = frame.locator('.relief-toggle').nth(1);
    const wasRecessed = await relief.isChecked(); await relief.click();
    assert.equal((await read()).recessed.includes(1), !wasRecessed);
    await relief.click();

    await swatch.click(); await value.fill('#ABCDEF');
    await frame.locator('#resetPalette').click();
    assert.equal(await editor.evaluate(el => el.classList.contains('is-placeholder')), true);
    assert.ok((await read()).palette.every(entry => entry.color === entry.source));
    await swatch.click(); await value.fill('#336699'); await confirm.click(); await waitRendered();
    await swatch.click();
    await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'outputs/procedural-shared-picker-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.scrollIntoViewIfNeeded();
    assert.equal(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const mobile = await editor.boundingBox();
    assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 390);
    await page.screenshot({ path: path.join(root, 'outputs/procedural-shared-picker-mobile.png') });
    await value.press('Escape');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#materialEditorMode').click();
    await page.locator('#saveMaterial').click(); await page.locator('#confirmPreviewGeneration').click();
    await page.waitForFunction(() => document.getElementById('status').textContent === '已生成预览图并保存到资产库');
    const id = new URL(page.url()).searchParams.get('asset');
    assert.equal(fixture.assets.get(id).metadata.proceduralMapping.palette[1].loopHex, '#336699');
    await page.reload();
    await page.waitForFunction(() => window.pickerEditorSnapshot && !document.getElementById('saveMaterial').disabled);
    await page.locator('#exportMaterial').click(); await frame.locator('.palette-row').first().waitFor();
    await swatch.click(); assert.equal(await value.inputValue(), '#336699');
    assert.equal(await frame.locator('#backgroundColorValue').textContent(), '#F1E2D3');
    assert.deepEqual(errors, []);
    console.log('PASS: shared HSV and HEX picker, draft cancellation, validation, pointer/keyboard controls, isolated palette updates, background, relief selection, reset, rendering, save/reopen and desktop/mobile layout.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
