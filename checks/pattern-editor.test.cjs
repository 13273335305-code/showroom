const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

function withDpi(png, x, y) {
  const chunk = Buffer.alloc(21); chunk.writeUInt32BE(9); chunk.write('pHYs', 4);
  chunk.writeUInt32BE(x, 8); chunk.writeUInt32BE(y, 12); chunk[16] = 1;
  let crc = 0xffffffff;
  for (const b of chunk.subarray(4, 17)) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 17);
  const parts = [png.subarray(0, 33), chunk];
  for (let p = 33; p + 12 <= png.length;) { const end = p + 12 + png.readUInt32BE(p); if (png.toString('ascii', p + 4, p + 8) !== 'pHYs') parts.push(png.subarray(p, end)); p = end; }
  return Buffer.concat(parts);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'spenic-pattern-editor-'));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/material-editor.html');
    await page.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    const png = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#365779'; ctx.fillRect(25, 25, 550, 250);
      ctx.fillStyle = '#e9cfa1'; ctx.font = 'bold 56px sans-serif'; ctx.fillText('PATTERN', 152, 170);
      return canvas.toDataURL().split(',')[1];
    }), 'base64');
    const fixture = path.join(temp, 'pattern-300x150dpi.png'); await fs.writeFile(fixture, withDpi(png, 11811, 5906));
    const expectedWidth = 600 / (11811 * .0254) * 2.54, expectedHeight = 300 / (5906 * .0254) * 2.54;
    const dimensions = async () => [Number(await page.locator('#widthCm').inputValue()), Number(await page.locator('#heightCm').inputValue())];
    const checkAuto = async () => { const [w, h] = await dimensions(); assert.ok(Math.abs(w - expectedWidth) < .0001); assert.ok(Math.abs(h - expectedHeight) < .0001); };
    const upload = async (key, file) => {
      await page.locator('#map-' + key).setInputFiles(file);
      await page.waitForFunction(({ key, name }) => document.getElementById('file-' + key).textContent === name && !document.getElementById('saveMaterial').disabled, { key, name: typeof file === 'string' ? path.basename(file) : file.name });
    };
    await page.locator('[data-material-type=pattern]').click();
    assert.equal(await page.locator('#materialCanvas').isVisible(), false);
    assert.equal(await page.locator('.preview-controls').isVisible(), false);
    assert.equal(await page.locator('#readDpi').isVisible(), false);
    await upload('map', fixture); await checkAuto();
    assert.match(await page.locator('#sizeNote').textContent(), /300 × 150.01 DPI.*自动/);
    assert.match(await page.locator('[data-width]').textContent(), /4.6567 cm/);
    for (const selector of ['.preview-copy', '#sizeNote', '#pbrHeading', '.pbr-help', '.pbr-columns']) assert.equal(await page.locator(selector).isVisible(), false);
    const ratio = await page.locator('[data-image-frame]').evaluate(el => Number(el.getAttribute('width')) / Number(el.getAttribute('height')));
    assert.ok(Math.abs(ratio - expectedWidth / expectedHeight) < .0001, 'Preview respects physical aspect, including unequal DPI axes');
    const geometry = await page.evaluate(() => {
      const img = document.querySelector('[data-image-frame]').getBoundingClientRect(), w = document.querySelector('[data-width]').getBoundingClientRect(), h = document.querySelector('[data-height]').getBoundingClientRect();
      return { top: w.bottom < img.top + img.height * 25 / 300, right: h.left > img.left + img.width * 575 / 600 };
    });
    assert.deepEqual(geometry, { top: true, right: true });
    const originalBounds = await page.locator('[data-image-frame]').boundingBox();
    await page.locator('#patternPreview').hover(); await page.mouse.wheel(0, -350);
    await page.waitForFunction(() => Number(document.getElementById('patternPreview').dataset.zoom) > 1.4);
    assert.ok((await page.locator('[data-image-frame]').boundingBox()).width > originalBounds.width * 1.4);
    assert.match(await page.locator('[data-width]').textContent(), /4.6567 cm/, 'Zoom does not alter physical dimensions');
    await page.mouse.move(400, 400); await page.mouse.down(); await page.mouse.move(440, 420); await page.mouse.up();
    await page.keyboard.press('f');
    assert.equal(await page.locator('#patternPreview').getAttribute('data-zoom'), '1.0000');
    const resetBounds = await page.locator('[data-image-frame]').boundingBox();
    assert.ok(Math.abs(resetBounds.x - originalBounds.x) < .1 && Math.abs(resetBounds.width - originalBounds.width) < .1);
    await upload('normalMap', 'checks/fabric-no-dpi.png'); await checkAuto();
    assert.match(await page.locator('#sizeNote').textContent(), /已自动/);
    await page.locator('#name').fill('自动 DPI 图案');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportMaterial').click()]);
    const saved = path.join(temp, 'pattern.formmat'); await download.saveAs(saved);
    const { unpackMaterial } = await import('../shared/material-package.js');
    const asset = await unpackMaterial(new File([await fs.readFile(saved)], 'pattern.formmat'));
    assert.equal(asset.materialType, 'pattern'); assert.equal(asset.physical.sizeSource, 'dpi');
    assert.equal(asset.physical.widthCm, expectedWidth); assert.equal(asset.physical.heightCm, expectedHeight);
    await page.locator('.editor-panel').evaluate(el => el.scrollTop = 0);
    await page.screenshot({ path: path.join(temp, 'auto-dpi.png') });
    await page.locator('#widthCm').fill('24'); await page.locator('#widthCm').press('Tab');
    await page.locator('#heightCm').fill('12'); await page.locator('#heightCm').press('Tab');
    assert.equal(await page.locator('[data-width]').textContent(), '22 cm'); assert.equal(await page.locator('[data-height]').textContent(), '10 cm');
    await page.locator('[data-material-type=pattern]').click(); assert.deepEqual(await dimensions(), [24, 12], 'Clicking the active tab preserves manual edits');
    await page.locator('#saveMaterial').click();
    await page.waitForFunction(() => document.getElementById('status').textContent === '已保存到资产库');
    await page.reload(); await page.waitForFunction(() => document.getElementById('name').value === '自动 DPI 图案' && !document.getElementById('saveMaterial').disabled);
    assert.deepEqual(await dimensions(), [24, 12], 'Saved manual sizes survive restore');
    assert.equal(await page.locator('#patternPreview').isVisible(), true);
    await upload('map', fixture); await checkAuto();
    await page.locator('#widthCm').fill('24'); await page.locator('#widthCm').press('Tab');
    await page.locator('#heightCm').fill('12'); await page.locator('#heightCm').press('Tab');
    await upload('map', 'checks/fabric-no-dpi.png'); assert.deepEqual(await dimensions(), [24, 12]);
    assert.match(await page.locator('#sizeNote').textContent(), /未记录有效 DPI/);
    await page.locator('[data-material-type=fabric]').click();
    assert.equal(await page.locator('#materialCanvas').isVisible(), true);
    await upload('map', fixture); assert.deepEqual(await dimensions(), [24, 12], 'Fabric uploads retain manual sizing');
    await page.locator('[data-material-type=pattern]').click(); await checkAuto();
    await page.locator('#widthCm').fill('24'); await page.locator('#widthCm').press('Tab');
    await page.locator('#heightCm').fill('12'); await page.locator('#heightCm').press('Tab');
    await page.locator('.editor-panel').evaluate(el => el.scrollTop = 0);
    await page.screenshot({ path: path.join(temp, 'dimensions-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#patternPreview').scrollIntoViewIfNeeded();
    const bounds = await page.locator('[data-height]').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(temp, 'dimensions-mobile.png') });
    await page.locator('#remove-map').click();
    assert.equal(await page.locator('.pattern-drawing').isVisible(), false);
    assert.equal(await page.locator('.pattern-preview-empty').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('PASS: automatic DPI, anisotropic sizes, 2D dimensions, auxiliary maps, package export, saved manual sizes, missing DPI, type switching, remove and mobile. Screenshots: ' + temp);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
