const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'spenic-roughness-'));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto((process.env.FORM_BASE_URL || 'http://127.0.0.1:4186') + '/material-editor.html');
    await page.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    const png = Buffer.from(await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 32;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 32, 32); ctx.fillStyle = '#0000ff'; ctx.fillRect(32, 0, 32, 32);
      return c.toDataURL().split(',')[1];
    }), 'base64');
    await page.locator('#map-roughnessMap').setInputFiles({ name: 'roughness-color.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => document.getElementById('file-roughnessMap').textContent === 'roughness-color.png');
    const pixel = () => page.locator('#preview-roughnessMap').evaluate(async image => { await image.decode(); const c = document.createElement('canvas'); c.width = 64; c.height = 32; const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); return [...ctx.getImageData(8, 8, 1, 1).data]; });
    assert.deepEqual(await pixel(), [76, 76, 76, 255]);
    assert.equal(await page.locator('#roughness').inputValue(), '1', 'Map grayscale drives roughness without a second attenuation');
    await page.locator('#roughnessInvert').check(); assert.deepEqual(await pixel(), [179, 179, 179, 255]);
    await page.locator('#roughnessInvert').uncheck(); assert.deepEqual(await pixel(), [76, 76, 76, 255]);
    await page.locator('#roughnessInvert').check();
    await page.locator('#name').fill('反转粗糙度验证');
    await page.locator('#saveMaterial').click(); await page.waitForFunction(() => document.getElementById('status').textContent === '已保存到资产库');
    await page.reload(); await page.waitForFunction(() => document.getElementById('name').value === '反转粗糙度验证' && !document.getElementById('saveMaterial').disabled);
    assert.equal(await page.locator('#roughnessInvert').isChecked(), true); assert.deepEqual(await pixel(), [179, 179, 179, 255]);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportMaterial').click()]);
    const file = path.join(temp, 'roughness.formmat'); await download.saveAs(file);
    const { unpackMaterial } = await import('../shared/material-package.js');
    const asset = await unpackMaterial(new File([await fs.readFile(file)], 'roughness.formmat'));
    assert.equal(asset.surface.roughnessGrayscale, true); assert.equal(asset.surface.roughnessInvert, true);
    assert.deepEqual(Buffer.from(await asset.maps.roughnessMap.arrayBuffer()), png, 'Original roughness file is preserved');
    await page.locator('#roughnessInvert').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(temp, 'roughness-inverted.png') });
    await page.locator('[data-material-type=pattern]').click();
    assert.equal(await page.locator('#roughnessInvert').isChecked(), true);
    await page.locator('#map-map').setInputFiles('checks/fabric-300dpi.png');
    await page.waitForFunction(() => document.getElementById('file-map').textContent === 'fabric-300dpi.png');
    assert.equal(await page.locator('#roughnessInvert').isChecked(), true, 'Base color upload does not reset inversion');
    await page.locator('#remove-roughnessMap').click(); assert.equal(await page.locator('#roughnessInvert').isChecked(), false); assert.equal(await page.locator('#roughnessInvert').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS: grayscale pixels, reversible inversion, live WebGL material, saved asset, package roundtrip, original file preservation and removal. Screenshot: ' + temp);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
