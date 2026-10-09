const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { installProjectFixture } = require('./project-test-server.cjs');
const root = path.resolve(__dirname, '..');
const alice = '11111111-1111-1111-1111-111111111111', bob = '22222222-2222-2222-2222-222222222222';

function modelBytes() {
  const values = new Float32Array([-1, 0, -1, 0, 1, 1, 1, 0, -1, 0, 0, .5, 1, 1, 0, 0, .894427, -.447214, 0, .894427, -.447214, 0, .894427, -.447214]);
  const binary = Buffer.from(values.buffer);
  const data = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1, NORMAL: 2 }, material: 0 }] }],
    materials: [{ name: '测试模型', doubleSided: true }], buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }, { buffer: 0, byteOffset: 60, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 0, -1], max: [1, 1, 1] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }, { bufferView: 2, componentType: 5126, count: 3, type: 'VEC3' }] };
  const json = Buffer.from(JSON.stringify(data)), chunk = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(chunk);
  const result = Buffer.alloc(28 + chunk.length + binary.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(chunk.length, 12); result.writeUInt32LE(0x4e4f534a, 16); chunk.copy(result, 20);
  result.writeUInt32LE(binary.length, 20 + chunk.length); result.writeUInt32LE(0x004e4942, 24 + chunk.length); binary.copy(result, 28 + chunk.length);
  return result;
}

(async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/fixture.glb') { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(modelBytes()); return; }
      if (pathname === '/__form_design_view' || pathname === '/__form_parts_view') { res.setHeader('Content-Type', 'application/json'); res.end('null'); return; }
      const filename = path.resolve(root, '.' + pathname);
      if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml' };
      res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream'); res.end(await fs.readFile(filename));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, errors = [], requests = [];
  let browser;
  const auth = async (context, id) => context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth() {} export const authState = () => ({id:' + JSON.stringify(id) + '});' }));
  const ready = page => page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const owner = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await auth(owner, alice); const state = await installProjectFixture(owner);
    const setup = await owner.newPage(); setup.on('pageerror', e => errors.push(e.message));
    await setup.goto(base + '/asset-library.html'); await ready(setup);
    const ids = await setup.evaluate(async () => {
      const { saveAsset } = await import('./shared/asset-store.js');
      const canvas = document.createElement('canvas'); canvas.width = 3072; canvas.height = 2304;
      const ctx = canvas.getContext('2d');
      for (let i = 0; i < 12; i++) { ctx.fillStyle = i % 2 ? '#53a88d' : '#e49cb0'; ctx.fillRect(i * 256, 0, 256, canvas.height); }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const fabric = await saveAsset({ kind: 'material', name: '公开云端面料', category: '面布', surface: { color: '#ffffff', roughness: .65 }, physical: { mode: 'physical', sizeSource: 'manual', widthCm: 12, heightCm: 9 }, maps: { map: new File([blob], 'source.png', { type: 'image/png' }) } });
      const model = await saveAsset({ kind: 'model', name: '公开云端模型', file: new File([await (await fetch('./fixture.glb')).arrayBuffer()], 'fixture.glb') });
      return { fabric: fabric.id, model: model.id };
    });
    const manifest = state.assets.get(ids.fabric).manifest;
    const sourcePath = manifest.files[manifest.maps.map].path, runtimePath = manifest.files[manifest.runtimeMaps.map].path;
    assert.notEqual(sourcePath, runtimePath, 'Original and resized runtime maps are separate resources');
    await setup.reload(); await ready(setup);
    const sourceReads = () => requests.filter(request => request.method === 'GET' && request.path.endsWith(sourcePath)).length;
    const viewer = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await auth(viewer, bob); await installProjectFixture(viewer, { state, userId: bob });
    viewer.on('request', req => requests.push({ path: new URL(req.url()).pathname, method: req.method() }));
    viewer.on('page', page => page.on('pageerror', e => errors.push(e.message)));
    const page = await viewer.newPage(); await page.goto(base + '/asset-library.html'); await ready(page);
    const card = page.locator(`[data-asset-id="${ids.fabric}"]`);
    assert.equal(await card.count(), 1); assert.equal(sourceReads(), 0);
    assert.equal(requests.some(req => req.path.endsWith('.formmat')), false);
    await card.locator('.asset-menu-trigger').click();
    assert.equal(await card.getByRole('menuitem', { name: '另存副本', exact: true }).count(), 1);
    assert.equal(await card.getByRole('menuitem', { name: '删除', exact: true }).count(), 0);
    await card.getByRole('menuitem', { name: '收藏', exact: true }).click();
    await page.waitForFunction(id => document.querySelector('[data-asset-id="' + id + '"]').classList.contains('is-favorite'), ids.fabric);
    await setup.reload(); await ready(setup);
    assert.equal(await setup.locator(`[data-asset-id="${ids.fabric}"].is-favorite`).count(), 0);
    await card.locator('.asset-art').click();
    await page.waitForFunction(() => !document.getElementById('fabricPreviewTexture').hidden);
    assert.equal(sourceReads(), 0, 'Detail downloads runtime maps, not original maps');
    const dimensions = await page.evaluate(async id => {
      const asset = await (await import('./shared/asset-store.js')).getAsset(id, { runtime: true });
      const bitmap = await createImageBitmap(asset.maps.map); const result = { width: bitmap.width, height: bitmap.height, size: asset.physical.widthCm }; bitmap.close(); return result;
    }, ids.fabric);
    assert.deepEqual(dimensions, { width: 2048, height: 1536, size: 12 });
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('fabricPreviewDialog').open);
    await page.screenshot({ path: path.join(root, 'checks/asset-cloud-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 }); await ready(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(root, 'checks/asset-cloud-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const design = await viewer.newPage(); await design.goto(base + '/design.html?asset=' + ids.model);
    await design.waitForFunction(() => document.getElementById('loading').hidden && document.querySelectorAll('.material-item').length > 0, null, { timeout: 60000 });
    await design.locator('#addDockAsset').click(); await design.locator('#pickerSearch').fill('公开云端面料');
    await design.locator(`.picker-card[data-asset-id="${ids.fabric}"]`).click(); await design.locator('#confirmAssetPicker').click();
    await design.waitForFunction(() => !document.getElementById('assetPicker').open && document.getElementById('materialName').value === '公开云端面料');
    const swatch = design.locator('#materialList .material-item.active .material-thumb');
    await swatch.scrollIntoViewIfNeeded(); const swatchBox = await swatch.boundingBox();
    await design.mouse.move(swatchBox.x + swatchBox.width / 2, swatchBox.y + swatchBox.height / 2); await design.mouse.down();
    let hit = false;
    for (const [x, y] of [[620, 580], [680, 630], [520, 650], [740, 560]]) {
      await design.mouse.move(x, y, { steps: 8 });
      if (await design.locator('#materialDropHint').isVisible()) { hit = true; break; }
    }
    assert.ok(hit, 'Cloud fabric can be dropped on the model'); await design.mouse.up();
    await design.waitForFunction(() => !document.getElementById('undoMaterial').disabled);
    await design.waitForTimeout(2300);
    assert.equal(sourceReads(), 0, 'Design application keeps originals deferred');
    const uploads = state.objects.size;
    await design.locator('#saveProject').click();
    await design.waitForFunction(() => document.getElementById('toast').textContent === '已保存到项目库' && document.getElementById('loading').hidden, null, { timeout: 60000 });
    assert.equal(state.projects.size, 1);
    const saved = [...state.projects.values()][0];
    assert.ok(Object.values(saved.manifest.files).some(ref => ref.path === runtimePath));
    assert.ok(Object.values(saved.manifest.files).some(ref => ref.path === sourcePath));
    assert.ok(state.objects.size <= uploads + 1, 'Saving the project only uploads its thumbnail');
    assert.equal(sourceReads(), 0, 'Project save retains references without downloading source maps');
    const pixels = await design.evaluate(async () => {
      const img = new Image(); img.src = document.getElementById('canvas').toDataURL(); await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = 128; c.getContext('2d').drawImage(img, 0, 0, 128, 128);
      const values = c.getContext('2d').getImageData(0, 0, 128, 128).data, colors = new Set(); let saturated = 0;
      for (let i = 0; i < values.length; i += 4) {
        colors.add(values[i] + ',' + values[i + 1] + ',' + values[i + 2]);
        if (Math.max(values[i], values[i + 1], values[i + 2]) - Math.min(values[i], values[i + 1], values[i + 2]) > 40) saturated++;
      }
      return { colors: colors.size, saturated };
    });
    assert.ok(pixels.colors > 20 && pixels.saturated > 20, '3D model displays the colored cloud texture');
    await design.screenshot({ path: path.join(root, 'checks/asset-cloud-design.png') });
    await design.setViewportSize({ width: 390, height: 844 }); await design.locator('#closeInspector').click();
    await design.keyboard.press('f'); await design.waitForTimeout(1500);
    await design.screenshot({ path: path.join(root, 'checks/asset-cloud-design-mobile.png') });
    await setup.evaluate(async id => (await import('./shared/asset-store.js')).deleteAsset(id), ids.fabric);
    await setup.evaluate(async id => (await import('./shared/asset-store.js')).deleteAsset(id), ids.model);
    await design.goto(base + '/design.html?project=' + saved.id);
    await design.waitForFunction(() => document.getElementById('loading').hidden && [...document.querySelectorAll('.material-name,.material-item strong')].some(el => el.textContent === '公开云端面料'), null, { timeout: 60000 });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ runtime: dimensions, sourceReads: sourceReads(), savedFiles: Object.keys(saved.manifest.files).length, errors: errors.length }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
