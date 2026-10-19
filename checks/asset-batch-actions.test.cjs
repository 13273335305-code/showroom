const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/shared/auth.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end('export async function requireAuth() { document.documentElement.classList.remove("auth-pending"); document.getElementById("authBootLoading")?.remove(); } export const authState = () => ({ id: "11111111-1111-1111-1111-111111111111" });');
      return;
    }
    if (pathname === '/shared/workspace-developer.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(''); return; }
    if (pathname === '/setup.html') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Batch fixture</title>'); return; }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const state = await require('./project-test-server.cjs').installProjectFixture(context);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base + '/setup.html');
    const ids = await page.evaluate(async () => {
      const { saveAsset } = await import('./shared/asset-store.js');
      const folder = await saveAsset({ kind: 'folder', name: '批量目标', library: 'fabric' });
      const a = await saveAsset({ kind: 'material', name: '批量面料 A', materialType: 'fabric', maps: {} });
      const b = await saveAsset({ kind: 'material', name: '批量面料 B', materialType: 'fabric', maps: {} });
      return { folder: folder.id, a: a.id, b: b.id };
    });
    const ready = () => page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    const menuAction = async id => { await page.locator('#moreOptions').click(); await page.locator('#' + id).click(); };
    await page.goto(base + '/asset-library.html'); await ready();
    await page.locator('#moreOptions').click();
    assert.deepEqual(await page.locator('#moreMenu button').allTextContents(), ['全选', '移动', '删除']);
    await page.locator('#moveSelectedAssets').click();
    assert.equal(await page.locator('#moveDialog').evaluate(el => el.open), false);
    assert.match(await page.locator('#status').textContent(), /请先选择/);
    await menuAction('selectAllAssets'); await ready();
    assert.equal(await page.locator('.asset-card.selected').count(), 2);
    await menuAction('moveSelectedAssets');
    assert.match(await page.locator('#moveDialogTitle').textContent(), /2/);
    await page.locator('#moveAssetTarget').selectOption(ids.folder);
    await page.locator('#saveMove').click();
    await page.waitForFunction(() => !document.getElementById('moveDialog').open); await ready();
    assert.equal(state.assets.get(ids.a).parent_id, ids.folder);
    assert.equal(state.assets.get(ids.b).parent_id, ids.folder);
    await page.locator(`[data-asset-id="${ids.folder}"] .asset-art`).click(); await ready();
    assert.equal(await page.locator('.asset-card').count(), 2);
    await menuAction('deleteSelectedAssets');
    await page.locator('#cancelDelete').click();
    assert.ok(state.assets.has(ids.a) && state.assets.has(ids.b));
    await menuAction('deleteSelectedAssets');
    await page.locator('#confirmDelete').click();
    await page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 0); await ready();
    assert.equal(state.assets.has(ids.a), false); assert.equal(state.assets.has(ids.b), false);
    assert.equal(state.assets.has(ids.folder), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#moreOptions').click();
    const box = await page.locator('#moreMenu').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390);
    await page.screenshot({ path: path.join(root, '.codex-project-check/asset-batch-actions-mobile.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: menu order, empty selection, select all, batch move, delete cancellation, confirmed deletion, mobile menu bounds');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
