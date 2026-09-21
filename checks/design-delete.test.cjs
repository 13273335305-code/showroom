const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'spenic-delete-'));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.FORM_BASE_URL || 'http://127.0.0.1:4186');
    await page.waitForFunction(() => document.getElementById('loading').hidden && document.querySelectorAll('#materialList .material-item').length === 9);
    async function checkPlus() {
      const center = await page.locator('.dock-add-icon').evaluate(el => {
        const s = getComputedStyle(el), p = getComputedStyle(el, '::before');
        return { x: parseFloat(p.left), y: parseFloat(p.top), width: el.clientWidth, height: el.clientHeight, textSize: s.fontSize };
      });
      assert.ok(Math.abs(center.x - center.width / 2) < .1 && Math.abs(center.y - center.height / 2) < .1);
      assert.equal(center.textSize, '0px');
    }
    await checkPlus();
    await page.locator('#dockTrash').click();
    assert.equal(await page.locator('#materialList .material-item:disabled').count(), 9);
    assert.equal(await page.locator('#materialList .dock-select-box').count(), 0);
    assert.equal(await page.locator('#dockDeleteSelected').isDisabled(), true);
    assert.equal(await page.locator('#addDockAsset').isVisible(), false);
    await page.locator('#dockCancelDelete').click();
    await page.evaluate(async () => {
      const { saveAsset } = await import('./shared/asset-store.js');
      const image = await (await fetch('./checks/fabric-no-dpi.png')).blob();
      const base = { kind: 'material', category: '面布', surface: { color: '#ffffff', roughness: .6 }, physical: { mode: 'physical', sizeSource: 'manual', widthCm: 30, heightCm: 30, angle: 0, initialized: true } };
      await saveAsset({ ...base, name: '删除测试面料', materialType: 'fabric', maps: {} });
      await saveAsset({ ...base, name: '删除测试图案', materialType: 'pattern', maps: { map: new File([image], 'pattern.png', { type: 'image/png' }) } });
    });
    async function add(type, count) {
      await page.locator(type === 'fabric' ? '#fabricDockTab' : '#patternDockTab').click();
      for (let i = 0; i < count; i++) {
        await page.locator('#addDockAsset').scrollIntoViewIfNeeded(); await page.locator('#addDockAsset').click();
        await page.locator('.picker-card').click(); await page.locator('#assetPicker').waitFor({ state: 'hidden' });
      }
    }
    async function drop(locator) {
      await locator.scrollIntoViewIfNeeded(); const box = await locator.locator('.material-thumb').boundingBox();
      await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down(); await page.mouse.move(640, 500, { steps: 12 });
      let hit = false;
      for (let y = 370; y < 680 && !hit; y += 35) { await page.mouse.move(640, y); hit = await page.locator('#materialDropHint').isVisible(); }
      assert.ok(hit, 'Drop hits model'); await page.mouse.up();
    }
    await add('fabric', 3);
    await drop(page.locator('[data-entry-id="9"]'));
    await page.locator('#dockTrash').click();
    assert.equal(await page.locator('[data-entry-id="9"]').isDisabled(), true, 'Applied new fabric is protected');
    for (const id of [10, 11]) { await page.locator(`[data-entry-id="${id}"]`).click(); }
    assert.equal(await page.locator('#dockDeleteSelected').textContent(), '删除 (2)');
    await page.locator('#dockCancelDelete').click();
    assert.equal(await page.locator('#materialList .material-item').count(), 12);
    await page.locator('#dockTrash').click();
    assert.equal(await page.locator('#dockDeleteSelected').isDisabled(), true);
    const unusedOriginal = page.locator('#materialList .material-item:not(:disabled)').filter({ hasNotText: '删除测试面料' }).first();
    const originalId = Number(await unusedOriginal.getAttribute('data-entry-id'));
    await unusedOriginal.click();
    for (const id of [10, 11]) await page.locator(`[data-entry-id="${id}"]`).click();
    assert.equal(await page.locator('#dockDeleteSelected').textContent(), '删除 (3)');
    await page.screenshot({ path: path.join(temp, 'fabric-selection.png') });
    await page.locator('#dockDeleteSelected').click();
    assert.equal(await page.locator('#materialList .material-item').count(), 9);
    assert.equal(await page.locator('[data-entry-id="9"]').count(), 1);
    assert.equal(await page.locator('#dockUndo').isDisabled(), true, 'Undo cannot restore a removed original material');
    assert.equal(await page.locator('#dockTrash').isVisible(), true);
    await add('pattern', 2); await checkPlus();
    await drop(page.locator('[data-pattern-kind="source"]').first());
    assert.equal(await page.locator('[data-pattern-kind="placed"]').count(), 1);
    await page.locator('#dockTrash').click();
    assert.equal(await page.locator('[data-pattern-kind="source"]').first().isDisabled(), true, 'Applied pattern source is protected');
    assert.equal(await page.locator('[data-pattern-kind="placed"]').isDisabled(), true);
    assert.equal(await page.locator('#patternDock .dock-select-box').count(), 1);
    await page.locator('[data-pattern-kind="source"]').nth(1).click();
    await page.locator('#dockDeleteSelected').click();
    assert.equal(await page.locator('[data-pattern-kind="source"]').count(), 1);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#saveProject').click()]);
    const project = path.join(temp, 'deletion.form'); await download.saveAs(project);
    const { unzipSync, strFromU8 } = await import('../vendor/three/addons/libs/fflate.module.js');
    const config = JSON.parse(strFromU8(unzipSync(new Uint8Array(await fs.readFile(project)))['project.json']));
    assert.equal(config.materials[10].removed, true); assert.equal(config.materials[11].removed, true);
    assert.equal(config.materials[originalId].removed, true);
    assert.ok(config.assignments.flat().includes(9));
    assert.equal(config.patternSources[0].key, config.patterns[0].sourceKey);
    await page.locator('#projectFile').setInputFiles(project);
    await page.waitForFunction(() => document.getElementById('loading').hidden && document.querySelectorAll('[data-pattern-kind="placed"]').length === 1);
    assert.equal(await page.locator('[data-entry-id="10"]').count(), 0); assert.equal(await page.locator('[data-entry-id="11"]').count(), 0);
    assert.equal(await page.locator(`[data-entry-id="${originalId}"]`).count(), 0, 'Unused FBX material stays removed after reload');
    await page.locator('#fabricDockTab').click(); await page.locator('#dockTrash').click();
    assert.equal(await page.locator('[data-entry-id="9"]').isDisabled(), true);
    await page.locator('#patternDockTab').click();
    assert.equal(await page.locator('#patternDock .material-item:disabled').count(), 2, 'Pattern usage survives project reload');
    await page.keyboard.press('Escape');
    await page.locator('[data-pattern-kind="placed"]').click(); await page.locator('#dockPatternDelete').click();
    await page.locator('#dockTrash').click();
    assert.equal(await page.locator('#patternDock .dock-select-box').count(), 1, 'Source can be deleted after its final placement is removed');
    await page.locator('[data-pattern-kind="source"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(temp, 'mobile-selection.png') });
    for (const id of ['dockCancelDelete', 'dockDeleteSelected']) {
      const box = await page.locator('#' + id).boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('#dockDeleteSelected').click(); assert.equal(await page.locator('#patternDock .material-item').count(), 0);
    await page.locator('#addDockAsset').click(); await page.locator('.picker-card').waitFor(); assert.equal(await page.locator('.picker-card').count(), 1, 'Global asset library is retained');
    assert.deepEqual(errors, []);
    console.log('PASS: centered plus icons, applied material protection, multi-select/cancel/delete, applied pattern sources, project roundtrip, mobile and library preservation. Screenshots: ' + temp);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
