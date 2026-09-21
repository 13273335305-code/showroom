const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'spenic-entry-check-'));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    context.on('page', page => { page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); });
    const editor = await context.newPage(), requests = [];
    editor.on('request', request => requests.push(request.url()));
    await editor.goto(base + '/material-editor.html');
    await editor.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    assert.equal(requests.some(url => /\.fbx(?:\?|$)/i.test(url)), false, 'Standalone editor does not request a model');
    assert.equal(await editor.locator('.app-navigation a').count(), 3);
    await editor.locator('#name').fill('测试编织材质');
    await editor.locator('#map-map').setInputFiles('checks/fabric-no-dpi.png');
    await editor.waitForFunction(() => document.getElementById('file-map').textContent === 'fabric-no-dpi.png');
    await editor.locator('#roughness').fill('0.37');
    await editor.locator('#widthCm').fill('20'); await editor.locator('#widthCm').press('Tab');
    await editor.locator('#heightCm').fill('15'); await editor.locator('#heightCm').press('Tab');
    await editor.locator('#saveMaterial').click();
    await editor.waitForFunction(() => document.getElementById('status').textContent === '已保存到资产库');
    const assetId = new URL(editor.url()).searchParams.get('asset');
    const [materialDownload] = await Promise.all([editor.waitForEvent('download'), editor.locator('#exportMaterial').click()]);
    const materialPath = path.join(temp, 'test.formmat'); await materialDownload.saveAs(materialPath);
    await editor.screenshot({ path: 'checks/entry-material.png' });

    const library = await context.newPage(); await library.goto(base + '/asset-library.html');
    await library.locator('.asset-card').waitFor();
    assert.equal(await library.locator('.asset-card').count(), 1);
    await library.locator('#assetSearch').fill('不存在'); assert.equal(await library.locator('.asset-card').count(), 0);
    await library.locator('#assetSearch').fill('');
    await library.locator('#assetFiles').setInputFiles([materialPath, 'checks/fabric-300dpi.png']);
    await library.waitForFunction(() => document.querySelectorAll('.asset-card').length === 2);
    await library.getByRole('tab', { name: '图案库' }).click(); assert.equal(await library.locator('.asset-card').count(), 1);
    await library.getByRole('tab', { name: '面料库' }).click();
    assert.equal(await library.getByText('用于设计台', { exact: true }).count(), 0);
    const layout = await library.locator('.asset-card').first().evaluate(card => {
      const { width, height } = card.getBoundingClientRect();
      return { ratio: width / height, gap: getComputedStyle(card.parentElement).gap };
    });
    assert.ok(Math.abs(layout.ratio - 4 / 3) < .01);
    assert.equal(layout.gap, '8px');
    await library.screenshot({ path: 'checks/entry-assets.png' });
    await editor.reload();
    await editor.waitForFunction(() => document.getElementById('name').value === '测试编织材质');
    assert.equal(await editor.locator('#roughness').inputValue(), '0.37');
    assert.equal(await editor.locator('#widthCm').inputValue(), '20');
    assert.equal(await editor.locator('#file-map').textContent(), 'fabric-no-dpi.png');

    const design = await context.newPage(); await design.goto(base + '/index.html?asset=' + assetId);
    await design.waitForFunction(() => document.getElementById('materialName').value === '测试编织材质', null, { timeout: 60000 });
    assert.equal(await design.locator('.material-item').count(), 10, 'Library material is appended to original nine');
    assert.equal(await design.locator('#roughness').inputValue(), '0.37');
    assert.equal(await design.locator('#textureWidth').inputValue(), '20');
    await design.locator('.material-item.active').scrollIntoViewIfNeeded();
    const swatch = await design.locator('.material-item.active .material-thumb').boundingBox();
    await design.mouse.move(swatch.x + 30, swatch.y + 30); await design.mouse.down();
    await design.mouse.move(500, 400, { steps: 15 });
    let target = false;
    for (let y = 250; y < 630 && !target; y += 45) for (let x = 340; x < 800 && !target; x += 45) {
      await design.mouse.move(x, y);
      target = await design.locator('#materialDropHint').isVisible();
    }
    assert.ok(target, 'Model accepts an asset material'); await design.mouse.up();
    await design.waitForFunction(() => !document.getElementById('undoMaterial').disabled);
    const [projectDownload] = await Promise.all([design.waitForEvent('download'), design.locator('#saveProject').click()]);
    const projectPath = path.join(temp, 'test.form'); await projectDownload.saveAs(projectPath);
    await design.locator('#projectFile').setInputFiles(projectPath);
    await design.waitForFunction(() => document.getElementById('loading').hidden && document.getElementById('materialName').value === '测试编织材质');
    assert.equal(await design.locator('.material-item').count(), 10, 'Project restores additional material');
    assert.equal(await design.locator('#roughness').inputValue(), '0.37');
    assert.match(await design.locator('#materialUsage').textContent(), /应用于 [1-9]/, 'Project restores assignment');
    assert.ok(await design.locator('#slot-map').evaluate(element => element.classList.contains('has-image')));
    await design.locator('#materialList .material-item.active').click();
    assert.equal(await design.locator('#compactMaterialPanel').isVisible(),true);
    assert.equal(await design.locator('#textureSlots').isVisible(),false);
    await design.screenshot({ path: 'checks/entry-design.png' });

    await library.locator('#assetFiles').setInputFiles('MM06-展厅版.fbx');
    await library.waitForFunction(() => document.querySelector('#modelTab').getAttribute('aria-selected') === 'true' && document.querySelectorAll('.asset-card').length === 1);
    await library.locator('.asset-card .asset-art img').waitFor();
    const modelLink = await library.locator('.asset-card').getByRole('link', { name: '设计', exact: true }).getAttribute('href');
    await design.goto(new URL(modelLink, base).href);
    await design.waitForFunction(() => document.getElementById('loading').hidden && document.querySelectorAll('.material-item').length === 9);
    assert.equal(await design.locator('#modelName').textContent(), 'MM06-展厅版.fbx');
    await library.setViewportSize({ width: 390, height: 844 });
    assert.ok(await library.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Library fits mobile width');
    await editor.setViewportSize({ width: 390, height: 844 });
    assert.ok(await editor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Editor fits mobile width');
    await design.setViewportSize({ width: 390, height: 844 });
    await design.screenshot({ path: 'checks/entry-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: independent entries, PBR upload, IndexedDB sharing, filtering, material package export/import, editor reload, design drag assignment, project roundtrip, compact inspector, model asset load, mobile layouts; no browser errors');
  } finally {
    await browser.close();
    if (path.dirname(path.resolve(temp)) !== path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('spenic-entry-check-')) throw new Error('Unexpected test temporary directory');
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
