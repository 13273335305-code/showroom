const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/shared/auth.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export async function requireAuth() {}\nexport const authState = () => ({id:"11111111-1111-1111-1111-111111111111"});'); return; }
    if (pathname === '/setup.html') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Fixture</title>'); return; }
    if (pathname === '/design-fixture.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end((await fs.readFile(path.join(root, 'design.html'), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
      return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream'); res.end(await fs.readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), requests = [], errors = [];
    const state = await require('./project-test-server.cjs').installProjectFixture(context);
    context.on('request', req => requests.push(req.url()));
    const setup = await context.newPage(); await setup.goto(base + '/setup.html');
    const ids = await setup.evaluate(async () => {
      const { saveAsset } = await import('./shared/asset-store.js');
      const png = await (await fetch('./checks/fabric-no-dpi.png')).blob();
      const canvas = document.createElement('canvas'); canvas.width = 4200; canvas.height = 2100;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ef4444'; ctx.fillRect(0, 0, 2100, 2100); ctx.fillStyle = '#3978ed'; ctx.fillRect(2100, 0, 2100, 2100);
      const original = await new Promise(resolve => canvas.toBlob(resolve));
      const remote = await saveAsset({ kind: 'material', name: '云端面料', category: '面布', materialType: 'fabric', surface: { color: '#ffffff', roughness: .65 }, physical: { mode: 'physical', widthCm: 10, heightCm: 8 }, maps: { map: new File([original], 'original.png', { type: 'image/png' }) }, preview: png });
      const legacy = await saveAsset({ kind: 'material', name: '无预览面料', category: '面布', materialType: 'fabric', maps: {} });
      return { remote: remote.id, legacy: legacy.id };
    });
    await setup.close(); requests.length = 0;
    const manifest = state.assets.get(ids.remote).manifest;
    const sourcePath = manifest.files[manifest.maps.map].path;
    const sourceDownloads = () => requests.filter(url => new URL(url).pathname === '/__cloud_test/objects/' + sourcePath).length;
    await context.addInitScript(() => {
      window.holdDecodes = !sessionStorage.getItem('decoded-test'); window.pendingDecodes = [];
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = async function () { await decode.call(this); if (window.holdDecodes) await new Promise(resolve => window.pendingDecodes.push(resolve)); };
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const start = Date.now(); await page.goto(base + '/asset-library.html');
    await page.waitForFunction(() => pendingDecodes.length > 0);
    assert.equal(await page.locator('.asset-card').count(), 2);
    assert.equal(await page.locator('#assetGrid').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'Whole page stays hidden until every current preview is ready');
    await page.evaluate(() => { holdDecodes = false; sessionStorage.setItem('decoded-test', '1'); pendingDecodes.splice(0).forEach(done => done()); });
    await page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    const coldMs = Date.now() - start;
    assert.equal(sourceDownloads(), 0, 'Cold browse never downloads original textures');
    assert.equal(requests.some(url => url.includes('/vendor/three/')), false, 'Card browse does not load Three.js');
    assert.equal(await page.locator(`[data-asset-id="${ids.legacy}"] .asset-art`).innerText(), '无预览图');
    await page.locator(`[data-asset-id="${ids.remote}"] .asset-art`).click();
    await page.waitForFunction(() => !document.getElementById('fabricPreviewTexture').hidden);
    assert.equal(sourceDownloads(), 1, 'Detail preview loads the original texture');
    const detail = await page.locator('#fabricPreviewTexture').evaluate(canvas => ({ w: canvas.width, h: canvas.height }));
    assert.deepEqual(detail, { w: 1200, h: 900 });
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('fabricPreviewDialog').open);
    await page.locator(`[data-asset-id="${ids.remote}"] .asset-art`).click(); await page.waitForFunction(() => !document.getElementById('fabricPreviewTexture').hidden);
    assert.equal(sourceDownloads(), 1, 'Reopening uses the downloaded original files');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('fabricPreviewDialog').open);
    const indexCheck = await page.evaluate(async id => {
      const store = await import('./shared/asset-store.js'), items = await store.listAssets();
      await store.updateAsset(id, { favorite: true });
      return items.every(item => !('maps' in item) && !('runtimeMaps' in item) && !('file' in item));
    }, ids.legacy);
    assert.equal(indexCheck, true); assert.equal(sourceDownloads(), 1, 'Metadata edits do not download original textures');
    const runtimeCache = await page.evaluate(async id => {
      const { getAsset } = await import('./shared/asset-store.js');
      const decode = window.createImageBitmap; let decoded = 0;
      window.createImageBitmap = (...args) => { decoded++; return decode(...args); };
      try {
        const first = await getAsset(id, { runtime: true }), firstDecoded = decoded;
        const second = await getAsset(id, { runtime: true });
        return { firstDecoded, secondDecoded: decoded, maps: !!first.runtimeMaps.map && !!second.runtimeMaps.map };
      } finally { window.createImageBitmap = decode; }
    }, ids.remote);
    assert.equal(runtimeCache.maps, true); assert.equal(runtimeCache.firstDecoded, 0); assert.equal(runtimeCache.secondDecoded, 0, 'Preprocessed runtime files do not need browser resizing');
    await page.evaluate(async () => {
      const { saveAsset } = await import('./shared/asset-store.js');
      const preview = await (await fetch('./checks/fabric-no-dpi.png')).blob();
      for (let i = 0; i < 65; i++) await saveAsset({ id: 'local-' + i, kind: 'material', name: '分页面料' + String(i).padStart(2, '0'), category: i % 2 ? '边布' : '面布', preview, maps: {} });
      const folder = await saveAsset({ kind: 'folder', name: '测试文件夹', library: 'fabric' }); window.folderFixtureId = folder.id;
      await saveAsset({ kind: 'material', name: '文件夹面料', parentId: folder.id, preview, maps: {} });
    });
    await page.reload(); await page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('.asset-card').count(), 30); assert.equal(await page.locator('.pagination-count').count(), 0, 'Pagination does not show an item count');
    await page.getByRole('button', { name: '下一页', exact: true }).click(); await page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('.asset-card').count(), 30); assert.equal(await page.locator('#assetPagination [aria-current=page]').textContent(), '2');
    await page.locator('#moreOptions').click(); await page.locator('#selectAllAssets').click();
    assert.equal(await page.locator('.asset-card.selected').count(), 30, 'Select all targets only the current page');
    await page.getByRole('button', { name: '下一页', exact: true }).click(); await page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('.asset-card').count(), 8); assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
    await page.locator('#assetSearch').fill('分页面料00'); await page.locator('#assetSearchForm').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('.asset-card').count(), 1); assert.equal(await page.locator('#assetPagination [aria-current=page]').textContent(), '1');
    await page.locator('#assetSearch').fill(''); await page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 30 && document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    await page.locator('.asset-folder .asset-art').click(); await page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('.asset-card').count(), 1); assert.equal(await page.locator('.asset-card h2').textContent(), '文件夹面料');
    await page.locator('#libraryBack').click(); await page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    const glass = await page.locator('#assetPagination').evaluate(el => ({ position: getComputedStyle(el.closest('.asset-library-footer')).position, blur: getComputedStyle(el).backdropFilter, bottom: el.getBoundingClientRect().bottom, height: innerHeight }));
    assert.equal(glass.position, 'fixed'); assert.match(glass.blur, /blur/); assert.ok(glass.bottom < glass.height);
    const paginationBox = await page.locator('#assetPagination').boundingBox(), uploadBox = await page.locator('#uploadTasksButton').boundingBox();
    assert.ok(uploadBox.x > paginationBox.x + paginationBox.width, 'Upload button sits to the right of pagination');
    assert.ok(Math.abs(uploadBox.y + uploadBox.height / 2 - paginationBox.y - paginationBox.height / 2) < 1, 'Footer controls share a vertical center');
    await page.screenshot({ path: path.join(root, 'checks/material-runtime-pagination.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.locator('#assetPagination').boundingBox(); assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 391);
    assert.equal(sourceDownloads(), 1, 'Paging, search and folders do not download original textures');
    // Old local records must not become available through the cloud-only asset store.
    const migrationContext = await browser.newContext(); const migration = await migrationContext.newPage();
    await require('./project-test-server.cjs').installProjectFixture(migrationContext, { state });
    await migration.goto(base + '/setup.html');
    await migration.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('spenic-workspace-assets', 1); r.onupgradeneeded = () => r.result.createObjectStore('assets', { keyPath: 'id' }); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
      await new Promise((resolve, reject) => { const tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').put({ id: 'migrated', kind: 'material', name: '升级前面料', maps: { map: new Blob(['original']) } }); tx.oncomplete = resolve; tx.onerror = reject; }); db.close();
    });
    await migration.goto(base + '/asset-library.html'); await migration.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    assert.equal(await migration.locator('.asset-card').count(), 30, 'Only cloud assets appear');
    assert.equal(await migration.evaluate(async () => (await import('./shared/asset-store.js')).getAsset('migrated')), null);
    const unsupportedSource = await migration.evaluate(async () => {
      try { await (await import('./shared/asset-store.js')).getMaterialSource({ id: 'migrated', version: 'v1', url: './missing.formmat' }); }
      catch (error) { return error.message; }
    });
    assert.match(unsupportedSource, /本地素材已停用/);
    await migrationContext.close();
    // The real design picker must hydrate the selected material before handing it to the scene.
    const pickerContext = await browser.newContext(), pickerPage = await pickerContext.newPage();
    await require('./project-test-server.cjs').installProjectFixture(pickerContext, { state });
    pickerContext.on('request', req => requests.push(req.url()));
    pickerPage.on('pageerror', e => errors.push(e.message));
    await pickerPage.goto(base + '/design-fixture.html');
    await pickerPage.evaluate(async () => {
      window.addedMaterials = []; window.pickerErrors = [];
      const { createDesignWorkspace } = await import('./design-workspace.js');
      createDesignWorkspace({ cancelPlacement() {}, canRemove() { return false; }, notify(message) { pickerErrors.push(message); }, async add(asset) { addedMaterials.push(asset); } });
    });
    await pickerPage.locator('#addDockAsset').evaluate(button => button.click());
    await pickerPage.waitForFunction(() => document.getElementById('assetPicker').getAttribute('aria-busy') === 'false');
    assert.equal(sourceDownloads(), 1, 'Design picker browsing does not download original textures');
    await pickerPage.locator('#pickerSearch').fill('云端面料');
    await pickerPage.locator(`.picker-card[data-asset-id="${ids.remote}"]`).click();
    await pickerPage.locator('#confirmAssetPicker').click();
    await pickerPage.waitForFunction(() => !document.getElementById('assetPicker').open);
    assert.equal(sourceDownloads(), 1, 'Confirming does not download original textures');
    assert.equal(await pickerPage.evaluate(() => addedMaterials.length === 1 && addedMaterials[0].runtimeOnly && addedMaterials[0].runtimeMaps.map instanceof Blob && addedMaterials[0].sourcePackage.cloud), true, 'Scene receives prepared runtime maps and cloud source references');
    assert.deepEqual(await pickerPage.evaluate(() => pickerErrors), []);
    await pickerContext.close();
    assert.deepEqual(errors, []);
    assert.equal(requests.some(url => url.includes('/assets/builtin/')), false, 'No local material requests remain');
    console.log(JSON.stringify({ coldBrowseMs: coldMs, sourceDownloadsDuringBrowse: 0, sourceDownloadsAfterDetail: 1, pageCounts: [30, 30, 8], screenshot: 'checks/material-runtime-pagination.png' }));
    console.log('PASS: cloud-only browse, whole-page reveal, 1200x900 detail, cached textures, 30-card pagination, metadata edits, folder/search navigation, mobile glass bar, local cache exclusion and design picker hydration.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
