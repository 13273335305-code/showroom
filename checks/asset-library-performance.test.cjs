const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const { packMaterial } = await import('../shared/material-package.js');
  const png = await fs.readFile(path.join(root, 'checks/fabric-no-dpi.png'));
  const pack = await packMaterial({ kind: 'material', name: '云端面料', surface: { color: '#ffffff', roughness: .65 }, physical: { mode: 'physical', widthCm: 10, heightCm: 8 }, maps: { map: new File([png], 'original.png', { type: 'image/png' }) }, preview: new Blob([png], { type: 'image/png' }) });
  const bytes = Buffer.from(await pack.arrayBuffer());
  const manifest = [
    { id: 'remote', name: '云端面料', category: '面布', materialType: 'fabric', version: 'v1', url: './fixture.formmat', preview: './previews/fixture.png', physical: { widthCm: 10, heightCm: 8 } },
    { id: 'legacy', name: '旧面料', category: '面布', materialType: 'fabric', version: 'v1', url: './fixture.formmat' },
  ];
  let packageRequests = 0;
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/shared/auth.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export async function requireAuth() {}'); return; }
    if (pathname === '/assets/builtin/manifest.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(manifest)); return; }
    if (pathname === '/assets/builtin/fixture.formmat') { packageRequests++; res.end(bytes); return; }
    if (pathname === '/assets/builtin/previews/fixture.png') { res.setHeader('Content-Type', 'image/png'); res.end(png); return; }
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
    context.on('request', req => requests.push(req.url()));
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
    assert.equal(packageRequests, 0, 'Cold browse never downloads material packages');
    assert.equal(requests.some(url => url.includes('/vendor/three/')), false, 'Card browse does not load Three.js');
    assert.equal(await page.locator('[data-asset-id=legacy] .asset-art').innerText(), '无预览图');
    await page.locator('[data-asset-id=remote] .asset-art').click();
    await page.waitForFunction(() => !document.getElementById('fabricPreviewTexture').hidden);
    assert.equal(packageRequests, 1, 'Opening a detail downloads just that package');
    const detail = await page.locator('#fabricPreviewTexture').evaluate(canvas => ({ w: canvas.width, h: canvas.height }));
    assert.ok(detail.w <= 3600 && detail.h <= 2700);
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('fabricPreviewDialog').open);
    await page.locator('[data-asset-id=remote] .asset-art').click(); await page.waitForFunction(() => !document.getElementById('fabricPreviewTexture').hidden);
    assert.equal(packageRequests, 1, 'Reopening uses the stored original');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('fabricPreviewDialog').open);
    const indexCheck = await page.evaluate(async () => {
      const store = await import('./shared/asset-store.js'), items = await store.listAssets();
      await store.updateAsset('legacy', { name: '旧面料改名', favorite: true });
      return items.every(item => !('maps' in item) && !('runtimeMaps' in item) && !('file' in item));
    });
    assert.equal(indexCheck, true); assert.equal(packageRequests, 1, 'Metadata edits do not hydrate a material');
    const runtimeCache = await page.evaluate(async () => {
      const { getAsset } = await import('./shared/asset-store.js');
      const decode = window.createImageBitmap; let decoded = 0;
      window.createImageBitmap = (...args) => { decoded++; return decode(...args); };
      try {
        const first = await getAsset('remote', { runtime: true }), firstDecoded = decoded;
        const second = await getAsset('remote', { runtime: true });
        return { firstDecoded, secondDecoded: decoded, maps: !!first.runtimeMaps.map && !!second.runtimeMaps.map };
      } finally { window.createImageBitmap = decode; }
    });
    assert.equal(runtimeCache.maps, true); assert.ok(runtimeCache.firstDecoded > 0); assert.equal(runtimeCache.firstDecoded, runtimeCache.secondDecoded, 'Runtime maps are prepared once and persist');
    await page.evaluate(async () => {
      const { saveAsset } = await import('./shared/asset-store.js');
      const preview = await (await fetch('./assets/builtin/previews/fixture.png')).blob();
      for (let i = 0; i < 65; i++) await saveAsset({ id: 'local-' + i, kind: 'material', name: '分页面料' + String(i).padStart(2, '0'), category: i % 2 ? '边布' : '面布', preview, maps: {} });
      await saveAsset({ id: 'folder', kind: 'folder', name: '测试文件夹', library: 'fabric' });
      await saveAsset({ id: 'child', kind: 'material', name: '文件夹面料', parentId: 'folder', preview, maps: {} });
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
    await page.locator('[data-asset-id=folder] .asset-art').click(); await page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('.asset-card').count(), 1); assert.equal(await page.locator('.asset-card h2').textContent(), '文件夹面料');
    await page.locator('#libraryBack').click(); await page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    const glass = await page.locator('#assetPagination').evaluate(el => ({ position: getComputedStyle(el).position, blur: getComputedStyle(el).backdropFilter, bottom: el.getBoundingClientRect().bottom, height: innerHeight }));
    assert.equal(glass.position, 'fixed'); assert.match(glass.blur, /blur/); assert.ok(glass.bottom < glass.height);
    await page.screenshot({ path: path.join(root, 'checks/asset-library-pagination.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.locator('#assetPagination').boundingBox(); assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 391);
    assert.equal(packageRequests, 1, 'Paging, search and folders never download PBR packages');
    // Upgrade an existing version-1 database without losing original files.
    const migrationContext = await browser.newContext(); const migration = await migrationContext.newPage();
    await migration.goto(base + '/setup.html');
    await migration.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('spenic-workspace-assets', 1); r.onupgradeneeded = () => r.result.createObjectStore('assets', { keyPath: 'id' }); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
      await new Promise((resolve, reject) => { const tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').put({ id: 'migrated', kind: 'material', name: '升级前面料', maps: { map: new Blob(['original']) } }); tx.oncomplete = resolve; tx.onerror = reject; }); db.close();
    });
    await migration.goto(base + '/asset-library.html'); await migration.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    assert.equal(await migration.locator('.asset-card').count(), 3);
    assert.equal(await migration.evaluate(async () => (await (await import('./shared/asset-store.js')).getAsset('migrated')).maps.map.text()), 'original');
    // The real design picker must hydrate the selected material before handing it to the scene.
    const pickerContext = await browser.newContext(), pickerPage = await pickerContext.newPage();
    pickerPage.on('pageerror', e => errors.push(e.message));
    await pickerPage.goto(base + '/design-fixture.html');
    await pickerPage.evaluate(async () => {
      window.addedMaterials = []; window.pickerErrors = [];
      const { createDesignWorkspace } = await import('./design-workspace.js');
      createDesignWorkspace({ cancelPlacement() {}, canRemove() { return false; }, notify(message) { pickerErrors.push(message); }, async add(asset) { addedMaterials.push(asset); } });
    });
    await pickerPage.locator('#addDockAsset').evaluate(button => button.click());
    await pickerPage.waitForFunction(() => document.getElementById('assetPicker').getAttribute('aria-busy') === 'false');
    assert.equal(packageRequests, 1, 'Design picker browsing does not download packages');
    await pickerPage.locator('.picker-card[data-asset-id=remote]').click();
    await pickerPage.locator('#confirmAssetPicker').click();
    await pickerPage.waitForFunction(() => !document.getElementById('assetPicker').open);
    assert.equal(packageRequests, 2, 'Confirming downloads only the selected material');
    assert.equal(await pickerPage.evaluate(() => addedMaterials.length === 1 && addedMaterials[0].maps.map instanceof Blob && addedMaterials[0].runtimeMaps.map instanceof Blob), true, 'Scene receives original and prepared runtime maps');
    assert.deepEqual(await pickerPage.evaluate(() => pickerErrors), []);
    await pickerContext.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ coldBrowseMs: coldMs, packageDownloadsDuringBrowse: 0, packageDownloadsAfterDetail: 1, packageDownloadsAfterDesignAdd: packageRequests, pageCounts: [30, 30, 8], screenshot: 'checks/asset-library-pagination.png' }));
    console.log('PASS: whole-page reveal, 30-card pagination, lightweight cold browse, worker detail loading, persistent cache, metadata edits, folder/search navigation, mobile glass bar, database migration and design picker hydration.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
