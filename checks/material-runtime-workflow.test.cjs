const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const requests = [], errors = [];
  const projects = new Map(), resources = new Map(), objects = new Map(); let resourceUploads = 0, projectDownloads = 0;
  const vertices = new Float32Array([-1,0,-1, 1,0,-1, 0,1,1]);
  const binary = Buffer.from(vertices.buffer);
  const modelJson = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], materials: [{ name: '测试远程模型', doubleSided: true }], buffers: [{ byteLength: binary.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.length }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1,0,-1], max: [1,1,1] }] }));
  const jsonChunk = Buffer.alloc(Math.ceil(modelJson.length / 4) * 4, 32); modelJson.copy(jsonChunk);
  const modelBytes = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binary.length);
  modelBytes.writeUInt32LE(0x46546c67, 0); modelBytes.writeUInt32LE(2, 4); modelBytes.writeUInt32LE(modelBytes.length, 8);
  modelBytes.writeUInt32LE(jsonChunk.length, 12); modelBytes.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(modelBytes, 20);
  modelBytes.writeUInt32LE(binary.length, 20 + jsonChunk.length); modelBytes.writeUInt32LE(0x004e4942, 24 + jsonChunk.length); binary.copy(modelBytes, 28 + jsonChunk.length);
  const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      requests.push(pathname);
      if (pathname === '/shared/auth.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export async function requireAuth() {}\nexport const authState = () => ({id:"11111111-1111-1111-1111-111111111111"});'); return; }
      if (pathname === '/shared/project-store.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(root, 'checks/project-cloud-fixture.js'))); return; }
      if (pathname === '/shared/asset-cloud-store.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export const listCloudAssets = async () => []; export const listAssetFavorites = async () => new Set();'); return; }
      if (pathname.startsWith('/__cloud_test/')) {
        const route = pathname.slice('/__cloud_test/'.length), chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        if (route.startsWith('objects/')) {
          const key = route.slice('objects/'.length);
          if (req.method === 'PUT') { objects.set(key, { body, type: req.headers['content-type'] }); resourceUploads++; res.end('{}'); }
          else { const object = objects.get(key); res.setHeader('Content-Type', object.type || 'application/octet-stream'); res.end(object.body); }
          return;
        }
        const data = JSON.parse(body), collection = data.table === 'spenic_projects' ? projects : resources;
        if (route === 'query') {
          if (data.operation === 'upsert') { collection.set(data.query.row.hash, data.query.row); res.end(JSON.stringify({ data: null })); return; }
          const rows = [...collection.values()].filter(row => Object.entries(data.filters).every(([key, value]) => row[key] === value));
          if (data.operation === 'delete') rows.forEach(row => collection.delete(row.id));
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: data.query.single ? rows[0] || null : rows.slice(data.query.start || 0, (data.query.end ?? 199) + 1) })); return;
        }
        if (route === 'rpc') {
          if (data.name === 'spenic_set_project_visibility') { const row = projects.get(data.args.project_id); row.visibility = data.args.make_public ? 'public' : 'personal'; res.end(JSON.stringify({ data: null })); return; }
          const row = data.args.project_data, old = projects.get(row.id);
          if (old && data.args.expected_revision !== old.updated_at) { res.end(JSON.stringify({ error: { code: '40001' } })); return; }
          const next = { ...row, owner_id: data.userId, created_at: old?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
          projects.set(row.id, next); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: next })); return;
        }
      }
      if (pathname === '/assets/builtin/manifest.json') {
        const manifest = JSON.parse(await fs.readFile(path.join(root, 'assets/builtin/manifest.json')));
        manifest.push({ id: 'remote-model', kind: 'model', name: 'runtime-model.glb', url: './runtime-model.glb', version: 'v1' });
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(manifest)); return;
      }
      if (pathname === '/assets/builtin/runtime-model.glb') { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(modelBytes); return; }
      if (pathname === '/__form_design_view' || pathname === '/__form_parts_view') { res.setHeader('Content-Type', 'application/json'); res.end('null'); return; }
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'spenic-runtime-'));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.on('page', page => { page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') console.log('BROWSER ERROR:', message.text()); }); });
    const packages = () => requests.filter(value => value.endsWith('.formmat'));
    const checkCanvas = async page => {
      const pixels = await page.evaluate(async () => {
        const image = new Image(); image.src = document.getElementById('canvas').toDataURL(); await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 128, 128);
        const data = context.getImageData(0, 0, 128, 128).data, colors = new Set(); let opaque = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) { opaque++; colors.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2]); }
        return { opaque, colors: colors.size };
      });
      assert.ok(pixels.opaque > 1000 && pixels.colors > 20, '3D canvas renders a nonblank scene');
    };
    const library = await context.newPage(); await library.goto(base + '/asset-library.html');
    await library.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    assert.equal(packages().length, 0);
    assert.equal(requests.some(value => value.includes('/runtime/')), false);
    const card = library.locator('.asset-card[data-asset-id="builtin-测试面布6"]');
    await card.locator('.asset-art').click();
    await library.waitForFunction(() => !document.getElementById('fabricPreviewTexture').hidden);
    assert.equal(packages().length, 0, 'Detail uses independent runtime maps');
    await library.keyboard.press('Escape');
    const beforeCached = requests.filter(value => value.includes('/runtime/')).length;
    await card.locator('.asset-art').click();
    await library.waitForFunction(() => !document.getElementById('fabricPreviewTexture').hidden);
    assert.equal(requests.filter(value => value.includes('/runtime/')).length, beforeCached);
    await library.keyboard.press('Escape');

    const page = await context.newPage(); await page.goto(base + '/design.html');
    page.on('download', () => projectDownloads++);
    await page.waitForFunction(() => document.getElementById('loading').hidden && document.querySelectorAll('.material-item').length >= 9, null, { timeout: 90000 });
    await page.locator('#addDockAsset').click();
    await page.locator('#pickerSearch').fill('测试面布6');
    await page.locator('.picker-card[data-asset-id="builtin-测试面布6"]').click();
    await page.locator('#confirmAssetPicker').click();
    await page.waitForFunction(() => !document.getElementById('assetPicker').open && document.getElementById('materialName').value === '测试面布6');
    assert.equal(packages().length, 0, 'Adding fabric never fetches the source package');
    assert.equal(requests.filter(value => value.includes('/runtime/')).length, beforeCached, 'Design reuses the detail cache');
    const source = page.locator('#materialList .material-item.active .material-thumb');
    await source.scrollIntoViewIfNeeded(); const box = await source.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    let target;
    for (const y of [380, 430, 480, 530, 580, 630]) {
      await page.mouse.move(660, y, { steps: 6 });
      if (await page.locator('#materialDropHint').isVisible()) { target = { x: 660, y }; break; }
    }
    assert.ok(target, 'Fabric finds a model surface'); await page.mouse.up();
    await page.waitForFunction(() => !document.getElementById('undoMaterial').disabled);
    await page.waitForTimeout(2400);
    assert.equal(packages().length, 0, 'Applying fabric never fetches the source package');
    const runtimeAsset = await page.evaluate(async () => {
      const { getAsset } = await import('./shared/asset-store.js');
      const asset = await getAsset('builtin-测试面布6', { runtime: true });
      const image = await createImageBitmap(asset.runtimeMaps.map);
      const result = { physical: asset.physical, width: image.width, height: image.height, bytes: asset.runtimeMaps.map.size, runtimeOnly: asset.runtimeOnly };
      image.close(); return result;
    });
    assert.equal(runtimeAsset.width, 2048); assert.ok(runtimeAsset.height > 1000);
    assert.equal(runtimeAsset.physical.widthCm, 231.4956);
    assert.equal(runtimeAsset.runtimeOnly, true);
    await checkCanvas(page);
    await page.screenshot({ path: path.join(root, 'checks/material-runtime-desktop.png') });

    await page.locator('#patternDockTab').click(); await page.locator('#addDockAsset').click();
    await page.locator('#pickerSearch').fill('测试刺绣');
    await page.locator('.picker-card[data-asset-id="builtin-test-embroidery"]').click();
    await page.locator('#confirmAssetPicker').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-pattern-kind=source]').length === 1);
    const pattern = page.locator('[data-pattern-kind=source] .material-thumb');
    await pattern.scrollIntoViewIfNeeded(); const patternBox = await pattern.boundingBox();
    await page.mouse.move(patternBox.x + 20, patternBox.y + 20); await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 }); await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('[data-pattern-kind=placed]').length === 1);
    assert.equal(packages().length, 0, 'Pattern addition and placement never fetch source packages');
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(2500);
    await page.locator('#closeInspector').click(); await page.waitForTimeout(1500);
    await checkCanvas(page);
    await page.screenshot({ path: path.join(root, 'checks/material-runtime-mobile.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.locator('#saveProject').click();
    await page.waitForFunction(() => document.getElementById('loading').hidden && document.getElementById('toast').textContent === '已保存到项目库', null, { timeout: 90000 });
    assert.equal(projects.size, 1); assert.equal(packages().length, 0); assert.equal(projectDownloads, 0);
    const saved = [...projects.values()][0], config = saved.manifest;
    assert.equal(config.format, 'SPENIC-PROJECT');
    assert.equal(objects.size, new Set([...Object.values(config.files).map(file => file.path),saved.thumbnail_path]).size, 'Shared runtime channels upload once');
    const fabric = config.materials.find(value => value.name === '测试面布6');
    assert.equal(config.files[fabric.maps.map.path].kind, 'cloud', 'Local preview references become portable cloud files');
    assert.equal(config.files[fabric.maps.map.path].size, runtimeAsset.bytes);
    assert.equal(config.files[config.patterns[0].path].kind, 'cloud');
    assert.equal(JSON.stringify(config).includes('127.0.0.1'), false);
    const firstUploads = resourceUploads;
    await page.locator('#saveProject').click(); await page.waitForFunction(() => document.getElementById('loading').hidden);
    assert.equal(projects.size, 1); assert.equal(resourceUploads, firstUploads, 'Repeated save reuses source resources');
    assert.ok(JSON.stringify(config).length < 30000);
    const { unpackMaterial } = await import('../shared/material-package.js');
    const original = await unpackMaterial(new File([await fs.readFile(path.join(root, 'assets/builtin/测试面布6.formmat'))], 'fabric.formmat'));
    const clean = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const restored = await clean.newPage(); restored.on('pageerror', error => errors.push(error.message));
    await restored.goto(base + '/design.html?project=' + saved.id);
    try {
      await restored.waitForFunction(() => document.getElementById('loading').hidden && document.querySelectorAll('[data-pattern-kind=placed]').length === 1, null, { timeout: 90000 });
    } catch (error) {
      console.log('RESTORE STATE:', await restored.evaluate(() => ({ loading: document.getElementById('loading').hidden, toast: document.getElementById('toast').textContent, patterns: document.querySelectorAll('[data-pattern-kind=placed]').length, sources: document.querySelectorAll('[data-pattern-kind=source]').length, material: document.getElementById('materialName').value })));
      await restored.screenshot({ path: path.join(root, 'checks/material-runtime-restore-failure.png') });
      throw error;
    }
    await checkCanvas(restored);
    assert.equal(packages().length, 0, 'New browser restores using the manifest and independent runtime maps');
    const modelUploadsBeforeRestoreSave = resourceUploads;
    await restored.locator('#saveProject').click(); await restored.waitForFunction(() => document.getElementById('loading').hidden);
    assert.equal(projects.size, 1, JSON.stringify([...projects.values()].map(row => ({id:row.id,owner:row.owner_id,name:row.name})))); assert.ok(resourceUploads <= modelUploadsBeforeRestoreSave + 1, 'Restored model and material references are reused');
    const projectLibrary = await clean.newPage(); await projectLibrary.goto(base + '/project-library.html');
    await projectLibrary.locator('.project-card').waitFor();
    await projectLibrary.locator('.project-more').click();
    assert.equal(await projectLibrary.getByRole('menuitem', { name: '下载', exact: true }).count(), 0);
    assert.equal(await projectLibrary.locator('#projectFiles').count(), 0);
    await projectLibrary.keyboard.press('Escape');
    const publicId = '22222222-2222-2222-2222-222222222222';
    projects.set(publicId, { ...projects.get(saved.id), id: publicId, owner_id: publicId, name: '其他账号的公开项目', visibility: 'public' });
    await projectLibrary.goto(base + '/project-library.html?view=public');
    const publicCard = projectLibrary.locator('.project-card[data-project-id="' + publicId + '"]');
    await publicCard.waitFor();
    assert.equal(await publicCard.locator('.project-more').count(), 0);
    assert.equal((await publicCard.textContent()).includes('undefined'), false);
    projects.delete(publicId);
    await projectLibrary.screenshot({ path: path.join(root, 'checks/project-cloud-library.png') });
    await clean.close();

    const editor = await context.newPage(); await editor.goto(base + '/material-editor.html?asset=' + encodeURIComponent('builtin-测试面布6'));
    await editor.waitForFunction(() => document.getElementById('name').value === '测试面布6' && !document.getElementById('saveMaterial').disabled);
    const [exported] = await Promise.all([editor.waitForEvent('download'), editor.locator('#exportMaterial').click()]);
    const exportedPath = path.join(temp, 'export.formmat'); await exported.saveAs(exportedPath);
    const exportedMaterial = await unpackMaterial(new File([await fs.readFile(exportedPath)], 'export.formmat'));
    assert.deepEqual(Buffer.from(await exportedMaterial.maps.map.arrayBuffer()), Buffer.from(await original.maps.map.arrayBuffer()));
    assert.equal(packages().length, 1, 'Only editing retrieves the original material package');
    assert.equal(requests.some(value => value.endsWith('runtime-model.glb')), false, 'Model listing does not download the model');
    await page.goto(base + '/design.html?asset=remote-model');
    await page.waitForFunction(() => document.getElementById('loading').hidden && document.getElementById('modelName').textContent === 'runtime-model.glb');
    assert.equal(requests.filter(value => value.endsWith('runtime-model.glb')).length, 1);
    assert.match(await page.locator('#modelStats').textContent(), /1 网格/);
    await page.evaluate(async () => (await import('./shared/asset-store.js')).getAsset('remote-model'));
    assert.equal(requests.filter(value => value.endsWith('runtime-model.glb')).length, 1, 'Model cache avoids repeated downloads');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ runtimeBytes: runtimeAsset.bytes, manifestBytes: JSON.stringify(config).length, packagesDuringSaveAndRestore: 0, projectDownloads, browserErrors: errors.length }));
    console.log('PASS: runtime application, cloud manifest save, repeated-save deduplication, fresh-browser restore, project library without download/import, and original material editor export.');
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    if (path.dirname(temp) !== os.tmpdir() || !path.basename(temp).startsWith('spenic-runtime-')) throw new Error('Unexpected temporary directory');
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
