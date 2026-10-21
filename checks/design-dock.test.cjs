const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'spenic-dock-'));
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' }), errors = [];
    await require('./project-test-server.cjs').installProjectFixture(page.context());
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('design.html', process.env.FORM_BASE_URL || 'http://127.0.0.1:4186').href);
    await page.waitForFunction(() => document.getElementById('loading').hidden);
    assert.equal(await page.locator('#materialList .material-item').count(), 0, 'Model-owned materials are hidden');
    assert.deepEqual(await page.locator('#fabricDock .fabric-categories button').allTextContents(), ['面布', '边布', '辅料']);
    assert.equal(await page.locator('[data-fabric="其他"]').count(), 0, 'Other is hidden from the material dock');
    assert.equal(await page.locator('#inspector').isVisible(), false);
    assert.equal(await page.locator('#restoreInspector').isVisible(), true);
    assert.equal(await page.locator('#inspector').getAttribute('aria-hidden'), 'true');
    await page.waitForFunction(() => document.getElementById('scrollRight').hidden);
    assert.equal(await page.locator('#scrollLeft').isVisible(), false);
    assert.equal(await page.locator('.dock-delete-tools > #addDockAsset').count(), 1);
    assert.equal(await page.locator('.dock-add-icon').evaluate(el => getComputedStyle(el).borderRadius), '10px');
    const add = await page.locator('#addDockAsset').boundingBox(), scan = await page.locator('#scanFabric').boundingBox(), zone = await page.locator('#dockDeleteZone').boundingBox(), trash = await page.locator('#dockTrash').boundingBox();
    assert.ok(add.y + add.height <= zone.y && scan.y + scan.height <= zone.y, 'Add and scan stay above the delete separator');
    assert.ok(Math.abs(trash.y - zone.y) < 1 && Math.abs(trash.height - zone.height) < 1, 'The whole area below the separator is the delete target');
    assert.equal(await page.locator('#dockDeleteZone').evaluate(el => getComputedStyle(el).borderTopColor), 'rgb(223, 120, 130)');
    await page.screenshot({ path: path.join(temp, 'desktop.png') });
    await page.locator('#restoreInspector').click(); assert.equal(await page.locator('#inspector').isVisible(), true);
    await page.locator('#collapseInspector').click(); assert.equal(await page.locator('#inspector').isVisible(), false);
    await page.evaluate(async () => {
      const { saveAsset } = await import('./shared/asset-store.js');
      await saveAsset({ kind: 'material', name: '分页面料', category: '面布', maps: {}, surface: { color: '#884ab1' } });
    });
    for (let count = 1; count <= 9; count++) {
      await page.locator('#addDockAsset').click();
      await page.locator('.picker-card').click(); await page.locator('#confirmAssetPicker').click();
      await page.waitForFunction(count => document.querySelectorAll('#materialList .material-item').length === count, count);
    }
    await page.setViewportSize({ width: 900, height: 900 });
    await page.locator('#scrollRight').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#scrollLeft').isVisible(), false);
    await page.locator('#scrollRight').click();
    await page.waitForFunction(() => document.getElementById('materialList').scrollLeft > 100);
    await page.locator('#scrollLeft').waitFor({ state: 'visible' });
    for (let i = 0; i < 5 && await page.locator('#scrollRight').isVisible(); i++) { await page.locator('#scrollRight').click(); await page.waitForTimeout(30); }
    await page.waitForFunction(() => document.getElementById('scrollRight').hidden);
    assert.ok(await page.locator('#addDockAsset').isVisible());
    await page.screenshot({ path: path.join(temp, 'last-page.png') });
    await page.locator('[data-fabric="边布"]').click();
    await page.waitForFunction(() => document.getElementById('scrollLeft').hidden && document.getElementById('scrollRight').hidden);
    assert.equal(await page.locator('.dock-delete-tools > #addDockAsset').count(), 1);
    await page.locator('#patternDockTab').click();
    assert.equal(await page.locator('.dock-delete-tools > #addDockAsset').count(), 1);
    assert.equal(await page.locator('.dock-add-icon').evaluate(el => getComputedStyle(el).borderRadius), '12px');
    assert.equal(await page.locator('#scrollRight').isVisible(), false);
    await page.evaluate(async () => {
      const { saveAsset } = await import('./shared/asset-store.js');
      const image = await (await fetch('./checks/fabric-no-dpi.png')).blob();
      await saveAsset({ kind: 'material', name: '分页图案', materialType: 'pattern', category: '面布', surface: { color: '#ffffff', roughness: .6 }, physical: { mode: 'physical', sizeSource: 'manual', widthCm: 20, heightCm: 20, angle: 0, initialized: true }, maps: { map: new File([image], 'pattern.png', { type: 'image/png' }) } });
    });
    for (let i = 1; i <= 8; i++) {
      await page.locator('#addDockAsset').scrollIntoViewIfNeeded(); await page.locator('#addDockAsset').click();
      await page.locator('.picker-card').click();
      await page.locator('#confirmAssetPicker').click();
      await page.waitForFunction(count => document.querySelectorAll('#patternDock .material-item').length === count, i);
    }
    assert.equal(await page.locator('.dock-delete-tools > #addDockAsset').count(), 1);
    await page.locator('#patternDock').evaluate(el => el.scrollLeft = 0);
    await page.locator('#scrollRight').waitFor({ state: 'visible' });
    const fabricScroll = await page.locator('#materialList').evaluate(el => el.scrollLeft);
    await page.locator('#scrollRight').click();
    await page.waitForFunction(() => document.getElementById('patternDock').scrollLeft > 100);
    assert.equal(await page.locator('#materialList').evaluate(el => el.scrollLeft), fabricScroll);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForFunction(() => document.getElementById('scrollLeft').hidden && document.getElementById('scrollRight').hidden);
    await page.screenshot({ path: path.join(temp, 'patterns.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#closeInspector').click(); assert.equal(await page.locator('#inspector').isVisible(), false);
    await page.locator('#restoreInspector').click(); assert.equal(await page.locator('#inspector').isVisible(), true);
    await page.locator('#closeInspector').click();
    await page.locator('#scrollRight').waitFor({ state: 'visible' });
    await page.locator('#scrollRight').click();
    await page.screenshot({ path: path.join(temp, 'mobile.png') });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('PASS: collapsed startup, inspector controls, inline round/square add, category changes, bidirectional paging, resize, pattern additions and mobile. Screenshots: ' + temp);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
