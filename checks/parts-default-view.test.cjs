const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'parts-default-view.json');
const base = 'http://127.0.0.1:4246';
let server, browser;

async function startServer() {
  server = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'server.ps1'), '-Port', '4246', '-NoBrowser'], { cwd: root, windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/__form_parts_view')).ok) return; } catch {}
    if (server.exitCode !== null) throw new Error('Test server exited');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start');
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
}
async function seedModel(page, id, dimensions) {
  await page.goto(base + '/model-parts.html');
  await page.evaluate(async ({ id, dimensions }) => {
    const THREE = await import('./vendor/three/build/three.module.js');
    const { saveAsset } = await import('./shared/asset-store.js');
    const geometry = new THREE.BoxGeometry(...dimensions).toNonIndexed();
    const positions = geometry.getAttribute('position').array;
    const json = { asset: { version: '2.0' }, buffers: [{ byteLength: positions.byteLength }], bufferViews: [{ buffer: 0, byteLength: positions.byteLength }], accessors: [{ bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: dimensions.map(v => -v / 2), max: dimensions.map(v => v / 2) }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
    const raw = new TextEncoder().encode(JSON.stringify(json)), jsonLength = Math.ceil(raw.length / 4) * 4;
    const buffer = new ArrayBuffer(12 + 8 + jsonLength + 8 + positions.byteLength), header = new DataView(buffer);
    header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, buffer.byteLength, true);
    header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true);
    new Uint8Array(buffer, 20, jsonLength).fill(32); new Uint8Array(buffer, 20, raw.length).set(raw);
    header.setUint32(20 + jsonLength, positions.byteLength, true); header.setUint32(24 + jsonLength, 0x004e4942, true);
    new Uint8Array(buffer, 28 + jsonLength).set(new Uint8Array(positions.buffer));
    await saveAsset({ id, kind: 'model', name: id, file: new File([buffer], id + '.glb') });
    geometry.dispose();
  }, { id, dimensions });
  await page.goto(base + '/model-parts.html?asset=' + id);
  await page.waitForFunction(() => document.getElementById('partsLoading').hidden);
  await page.keyboard.type('admin'); await page.locator('#partsDeveloperToggle').click();
}
async function cameraState(page) {
  await page.waitForTimeout(350);
  return page.locator('.parts-camera-values dd').allTextContents();
}

(async () => {
  const original = await fs.readFile(configPath);
  try {
    await startServer();
    assert.equal((await fetch(base + '/__form_parts_view')).headers.get('cache-control'), 'no-store');
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const errors = [], context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await seedModel(page, 'view-test-a', [3, 1, 2]);
    await page.mouse.move(550, 430); await page.mouse.down(); await page.mouse.move(655, 470, { steps: 12 }); await page.mouse.up();
    await page.mouse.wheel(0, -180); await page.waitForTimeout(1500);
    const captured = await cameraState(page);
    const posted = page.waitForResponse(response => response.url().endsWith('/__form_parts_view') && response.request().method() === 'POST');
    await page.locator('#partsSaveDefaultView').click();
    const postResponse = await posted;
    assert.equal(postResponse.status(), 200, await postResponse.text());
    await page.waitForFunction(() => document.getElementById('partsViewStatus').textContent.startsWith('已保存到'));
    const savedBytes = await fs.readFile(configPath), saved = JSON.parse(savedBytes);
    assert.ok(Math.abs(saved.view.azimuth - 40) > 1, 'Save captures the adjusted camera');
    assert.deepEqual(await (await fetch(base + '/__form_parts_view')).json(), saved);
    const readPreview = () => page.evaluate(async () => {
      const { getAsset } = await import('./shared/asset-store.js');
      const asset = await getAsset('view-test-a'), bitmap = await createImageBitmap(asset.preview);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4) if (Math.max(...pixels.slice(i, i + 3)) - Math.min(...pixels.slice(i, i + 3)) > 40) colored++;
      return { width: canvas.width, height: canvas.height, colored, bytes: [...new Uint8Array(await asset.preview.arrayBuffer())], thumbnailBytes: [...new Uint8Array(await asset.thumbnail.arrayBuffer())], fileSize: asset.file.size, assignments: asset.partAssignments };
    });
    await page.locator('.part-category-select').first().selectOption('面布');
    await page.locator('.material-row-button').first().click();
    await page.locator('#saveParts').click();
    await page.waitForFunction(() => document.getElementById('partsStatus').textContent === '已保存模型配置和预览图');
    assert.equal(await page.locator('#randomColorToggle').isChecked(), true);
    const firstPreview = await readPreview();
    assert.deepEqual([firstPreview.width, firstPreview.height], [400, 300]);
    assert.ok(firstPreview.colored > 1000, 'Preview contains a rendered model with random colors');
    assert.deepEqual(firstPreview.thumbnailBytes, firstPreview.bytes, 'Old thumbnail replaced together with preview');
    assert.deepEqual(firstPreview.assignments, { 0: ['面布'] });
    await fs.writeFile(path.join(root, 'checks/parts-model-preview.png'), Buffer.from(firstPreview.bytes));
    assert.equal(await page.locator('.parts-list-item.active').count(), 1, 'Screenshot preserves material selection');
    await page.mouse.move(550, 430); await page.mouse.down(); await page.mouse.move(630, 400, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(1500);
    await page.locator('#saveParts').click(); await page.waitForFunction(() => !document.getElementById('saveParts').disabled);
    const secondPreview = await readPreview();
    assert.deepEqual(secondPreview.bytes, firstPreview.bytes, 'Temporary camera movement does not change saved default preview');
    assert.equal(secondPreview.fileSize, firstPreview.fileSize, 'Model file retained with the preview');
    const library = await context.newPage(), previewRequests = [];
    await page.evaluate(async () => {
      const { getAsset, saveAsset } = await import('./shared/asset-store.js');
      const asset = await getAsset('view-test-a'), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      await saveAsset({ ...asset, thumbnail: await new Promise(resolve => canvas.toBlob(resolve)) });
    });
    library.on('request', request => { if (request.url().includes('/shared/model-preview.js')) previewRequests.push(request.url()); });
    await library.route('**/assets/builtin/manifest.json', route => route.fulfill({ json: [] }));
    await library.goto(base + '/asset-library.html'); await library.locator('#modelTab').click();
    const cardImage = library.locator('[data-asset-id="view-test-a"] .asset-art img');
    await cardImage.waitFor(); await cardImage.evaluate(image => image.decode());
    assert.deepEqual(await cardImage.evaluate(image => [image.naturalWidth, image.naturalHeight]), [400, 300]);
    const displayed = await cardImage.evaluate(async image => [...new Uint8Array(await (await fetch(image.src)).arrayBuffer())]);
    assert.deepEqual(displayed, secondPreview.bytes, 'Library card reads the stored preview directly');
    assert.deepEqual(previewRequests, [], 'Saved preview avoids reloading the 3D model');
    await library.screenshot({ path: path.join(root, 'checks/parts-model-library.png') }); await library.close();
    const fbxPage = await context.newPage();
    await fbxPage.goto(base + '/index.html');
    await fbxPage.evaluate(async () => {
      const { saveAsset } = await import('./shared/asset-store.js');
      const bytes = await (await fetch('./MM06-展厅版.fbx')).arrayBuffer();
      await saveAsset({ id: 'fbx-preview-test', kind: 'model', name: 'FBX preview', file: new File([bytes], 'MM06-展厅版.fbx') });
    });
    await fbxPage.goto(base + '/model-parts.html?asset=fbx-preview-test');
    await fbxPage.waitForFunction(() => document.getElementById('partsLoading').hidden, null, { timeout: 60000 });
    await fbxPage.locator('#saveParts').click();
    await fbxPage.waitForFunction(() => document.getElementById('partsStatus').textContent === '已保存模型配置和预览图');
    const fbxPreview = await fbxPage.evaluate(async () => {
      const { getAsset } = await import('./shared/asset-store.js'); const asset = await getAsset('fbx-preview-test');
      const bitmap = await createImageBitmap(asset.preview), dimensions = [bitmap.width, bitmap.height]; bitmap.close();
      return { dimensions, bytes: [...new Uint8Array(await asset.preview.arrayBuffer())] };
    });
    assert.deepEqual(fbxPreview.dimensions, [400, 300]);
    await fs.writeFile(path.join(root, 'checks/parts-fbx-preview.png'), Buffer.from(fbxPreview.bytes)); await fbxPage.close();
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload(); await page.waitForFunction(() => document.getElementById('partsLoading').hidden);
    await page.keyboard.type('admin'); await page.locator('#partsDeveloperToggle').click();
    assert.deepEqual(await cameraState(page), captured, 'Reload restores camera without applying inspector offset twice');
    assert.equal(await page.evaluate(() => localStorage.length), 0, 'No browser storage needed');
    await page.screenshot({ path: path.join(root, 'checks/parts-default-view-desktop.png') });
    await context.close();

    await stopServer(); await startServer();
    assert.deepEqual(await (await fetch(base + '/__form_parts_view')).json(), saved, 'Server restart reads the disk file');
    const secondBrowser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
      const second = await secondBrowser.newPage({ viewport: { width: 1440, height: 1000 } }); second.on('pageerror', error => errors.push(error.message));
      await seedModel(second, 'view-test-b', [1, 4, 2]);
      assert.equal((await cameraState(second))[2], captured[2], 'Fresh browser and different model use the shared angle');
      assert.match(await second.locator('#partsViewStatus').textContent(), /已自动读取/);
      assert.equal(await second.evaluate(() => localStorage.length), 0);
      await second.setViewportSize({ width: 390, height: 844 }); await second.reload();
      await second.waitForFunction(() => document.getElementById('partsLoading').hidden);
      await second.keyboard.type('admin'); await second.locator('#partsDeveloperToggle').click();
      assert.equal((await cameraState(second))[2], captured[2], 'Mobile keeps the saved camera angles');
      const button = await second.locator('#partsSaveDefaultView').boundingBox(); assert.ok(button.x >= 0 && button.x + button.width <= 390);
      await second.locator('#saveParts').click(); await second.waitForFunction(() => document.getElementById('partsStatus').textContent === '已保存模型配置和预览图');
      const mobilePreview = await second.evaluate(async () => {
        const { getAsset } = await import('./shared/asset-store.js'); const asset = await getAsset('view-test-b');
        const bitmap = await createImageBitmap(asset.preview), dimensions = [bitmap.width, bitmap.height]; bitmap.close(); return dimensions;
      });
      assert.deepEqual(mobilePreview, [400, 300], 'Mobile preview always saves at 400x300');
      await second.screenshot({ path: path.join(root, 'checks/parts-default-view-mobile.png') });
    } finally { await secondBrowser.close(); }

    for (const invalid of [{ ...saved, version: 9 }, { ...saved, view: { ...saved.view, offset: [0, 'bad', 0] } }, { ...saved, view: { ...saved.view, azimuth: true } }]) {
      assert.equal((await fetch(base + '/__form_parts_view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invalid) })).status, 400);
      assert.deepEqual(await fs.readFile(configPath), savedBytes, 'Invalid data does not overwrite saved view');
    }
    assert.equal((await fetch(base + '/__form_parts_view', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: JSON.stringify(saved) })).status, 403);
    assert.equal((await fetch(base + '/model-parts.html', { method: 'POST', body: '{}' })).status, 405);
    assert.equal((await fetch(base + '/__form_parts_view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(17000) })).status, 400);
    assert.deepEqual(errors, []);
    console.log('PASS: disk view persistence, default-angle 400x300 colored preview, saved model/assignments/thumbnail, unchanged selection, library image priority, mobile and fresh browser');
  } finally {
    if (browser) await browser.close(); await stopServer(); await fs.writeFile(configPath, original);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
