const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { installProjectFixture } = require('./project-test-server.cjs');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'spenic-fabric-batch-'));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth() {} export const authState = () => ({ id: "11111111-1111-1111-1111-111111111111" });' }));
    const state = await installProjectFixture(context), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/material-editor.html');
    await page.waitForFunction(() => !document.getElementById('batchFabric').disabled);
    const heading = await page.locator('.material-info-heading h2').boundingBox(), button = await page.locator('#batchFabric').boundingBox();
    assert.ok(button.x > heading.x + heading.width);
    assert.ok(Math.abs(button.y + button.height / 2 - heading.y - heading.height / 2) < 2);
    await page.screenshot({ path: 'checks/fabric-batch-button.png' });
    const buffer = await fs.readFile('checks/fabric-no-dpi.png');
    const colorCodes = ['DBW', 'GWW', 'KGW', 'WBK', 'WBR', 'WLG', 'WWW', 'ZGW'];
    for (const code of colorCodes) await fs.writeFile(path.join(folder, '389' + code + '.jpg'), buffer);
    await fs.writeFile(path.join(folder, '389-f.jpg'), buffer);
    await fs.writeFile(path.join(folder, '389BAD.jpg'), 'invalid image');
    await fs.writeFile(path.join(folder, 'notes.txt'), 'skip this');
    await page.locator('#name').fill('当前编辑中的面料');
    await page.locator('#fabricColorCode').fill('CURRENT');
    await page.locator('#category').selectOption('面布');
    await page.locator('#roughness').fill('0.42');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#batchFabric').click();
    await (await chooser).setFiles(folder);
    await page.locator('#batchFabricCategoryDialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#batchFabricCategoryDescription').count(), 0);
    assert.equal(await page.locator('#batchFabricSwatches li').count(), 9);
    assert.equal(await page.locator('#batchFabricSwatches [data-configured=true]').count(), 8);
    assert.equal(await page.locator('.batch-fabric-swatch-code').count(), 0);
    await page.getByRole('button', { name: '设为默认色号 WBR', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '设为默认色号 WBR', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(state.assets.size, 0, 'No uploads start before choosing a category');
    assert.equal(await page.locator('#batchFabricCategory').inputValue(), '面布');
    await page.locator('#batchFabricCategory').selectOption('边布');
    await page.locator('#confirmBatchFabric').click();
    await page.waitForFunction(() => document.getElementById('batchFabricSummary').textContent.includes('齐色批处理完成'), null, { timeout: 60000 });
    assert.match(await page.locator('#batchFabricSummary').textContent(), /8 项已加入上传队列/);
    assert.match(await page.locator('#batchFabricSummary').textContent(), /1 项失败/);
    assert.match(await page.locator('#batchFabricSummary').textContent(), /389BAD.jpg/);
    assert.equal(await page.locator('#name').inputValue(), '当前编辑中的面料');
    assert.equal(await page.locator('#fabricColorCode').inputValue(), 'CURRENT');
    assert.equal(await page.locator('#category').inputValue(), '面布');
    assert.equal(await page.locator('#previewGenerationDialog').isVisible(), false);
    await page.waitForFunction(async () => {
      const tasks = await (await import('./shared/upload-queue.js')).listUploads();
      return tasks.length === 8 && tasks.every(task => task.status === 'completed');
    }, null, { timeout: 60000 });
    assert.equal(state.assets.size, 8);
    const assets = await page.evaluate(async () => {
      const store = await import('./shared/asset-store.js');
      return Promise.all((await store.listAssets()).map(async card => {
        const asset = await store.getAsset(card.id);
        return { id: asset.id, name: asset.name, code: asset.fabricColorCode, category: asset.category, roughness: asset.surface.roughness,
          base: asset.maps.map.name, normal: asset.maps.normalMap.name, previewInfo: asset.previewInfo };
      }));
    });
    assert.equal(new Set(assets.map(asset => asset.id)).size, 8);
    assert.deepEqual(assets.map(asset => asset.code).sort(), [...colorCodes].sort());
    for (const asset of assets) {
      assert.equal(asset.name, '389'); assert.equal(asset.category, '边布'); assert.equal(asset.roughness, .42);
      assert.equal(asset.base, '389' + asset.code + '.jpg'); assert.equal(asset.normal, '389-f.jpg');
      assert.deepEqual(asset.previewInfo, { widthCm: 40, heightCm: 30, widthPx: 400, heightPx: 300 });
    }
    await page.screenshot({ path: 'checks/fabric-batch-complete.png' });
    const cancelChooser = page.waitForEvent('filechooser');
    await page.locator('#batchFabric').click();
    await (await cancelChooser).setFiles(folder);
    await page.locator('#batchFabricCategoryDialog').waitFor({ state: 'visible' });
    await page.locator('#batchFabricCategoryDialog button[value=cancel]').last().click();
    await page.waitForFunction(() => !document.getElementById('batchFabric').disabled);
    assert.equal((await page.evaluate(async () => (await import('./shared/upload-queue.js')).listUploads())).length, 8);
    await fs.unlink(path.join(folder, '389-f.jpg'));
    const noNormalChooser = page.waitForEvent('filechooser');
    await page.locator('#batchFabric').click();
    await (await noNormalChooser).setFiles(folder);
    await page.locator('#batchFabricCategoryDialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#batchFabricSwatches li').count(), 9);
    await page.locator('#batchFabricCategory').selectOption('包边条');
    await page.locator('#confirmBatchFabric').click();
    await page.waitForFunction(async () => {
      const tasks = await (await import('./shared/upload-queue.js')).listUploads();
      return tasks.length === 16 && tasks.every(task => task.status === 'completed');
    }, null, { timeout: 60000 });
    assert.equal(state.assets.size, 16);
    const plain = await page.evaluate(async () => {
      const store = await import('./shared/asset-store.js');
      const cards = (await store.listAssets()).filter(asset => asset.category === '包边条');
      return Promise.all(cards.map(async card => {
        const asset = await store.getAsset(card.id);
        return { normal: !!asset.maps.normalMap, previewInfo: asset.previewInfo };
      }));
    });
    assert.equal(plain.length, 8);
    assert.ok(plain.every(asset => !asset.normal && asset.previewInfo.widthCm === 10 && asset.previewInfo.heightCm === 7.5));
    await page.locator('[data-material-type=pattern]').click();
    assert.equal(await page.locator('#batchFabric').isVisible(), false);
    await page.locator('[data-material-type=fabric]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#batchFabric').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#batchFabric').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS: batch category selection and cancellation, uploads with/without normals, cloud saves, failed image recovery and mobile layout');
  } finally {
    await browser.close();
    const resolved = path.resolve(folder);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('spenic-fabric-batch-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
