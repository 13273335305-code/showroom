const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth() {} export const authState = () => ({id:"11111111-1111-1111-1111-111111111111"});' }));
    const cloud = await require('./project-test-server.cjs').installProjectFixture(context);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/material-editor.html');
    await page.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    await page.locator('#map-map').setInputFiles('checks/fabric-no-dpi.png');
    await page.waitForFunction(() => !document.getElementById('saveMaterial').disabled && document.getElementById('upload-map').classList.contains('has-image'));
    await page.locator('#saveMaterial').click();
    const physical = page.locator('#previewPhysicalLock'), pixel = page.locator('#previewPixelLock');
    assert.equal(await physical.getAttribute('aria-pressed'), 'true'); assert.equal(await pixel.getAttribute('aria-pressed'), 'true');
    const sizes = () => page.evaluate(() => ['previewPhysicalWidth','previewPhysicalHeight','previewPixelWidth','previewPixelHeight'].map(id => Number(document.getElementById(id).value)));
    assert.deepEqual((await sizes()).slice(0,2), [120,90]);
    for (const [category, expected] of [['边布',[40,30]],['包边条',[10,7.5]],['其他',[10,7.5]],['面布',[120,90]]]) {
      await page.locator('#cancelPreviewGeneration').click();
      await page.locator('#category').selectOption(category);
      await page.locator('#saveMaterial').click();
      assert.deepEqual((await sizes()).slice(0,2), expected);
      assert.equal(await physical.getAttribute('aria-pressed'), 'true');
    }
    const initial = await sizes(), ratio = initial[0] / initial[1];
    await page.locator('#previewPhysicalWidth').fill(String(initial[0] * 2));
    assert.equal((await sizes())[1], Number((initial[1] * 2).toFixed(2)));
    await page.locator('#previewPhysicalHeight').fill('15');
    assert.equal((await sizes())[0], Number((15 * ratio).toFixed(2)));
    await page.locator('#previewPixelWidth').fill('800'); assert.deepEqual((await sizes()).slice(2), [800,600]);
    await page.locator('#previewPixelHeight').fill('450'); assert.deepEqual((await sizes()).slice(2), [600,450]);
    await physical.click(); await pixel.click();
    await page.locator('#previewPhysicalWidth').fill('40'); await page.locator('#previewPhysicalHeight').fill('30');
    await page.locator('#previewPixelWidth').fill('800'); await page.locator('#previewPixelHeight').fill('400');
    assert.deepEqual(await sizes(), [40,30,800,400]);
    await physical.click(); await pixel.click();
    await page.locator('#previewPhysicalWidth').fill('80'); await page.locator('#previewPixelHeight').fill('600');
    assert.deepEqual(await sizes(), [80,60,1200,600]);
    await page.locator('#previewPixelWidth').fill(''); assert.equal(await page.locator('#confirmPreviewGeneration').isDisabled(), true);
    await page.locator('#previewPixelWidth').fill('2048'); assert.deepEqual((await sizes()).slice(2), [2048,1024]);
    await page.locator('#previewPixelWidth').fill('64'); assert.equal(await page.locator('#confirmPreviewGeneration').isDisabled(), true);
    await page.locator('#previewPixelWidth').fill('800');
    assert.equal(await page.locator('#confirmPreviewGeneration').isDisabled(), false);
    await physical.click(); await pixel.click();
    await page.locator('#cancelPreviewGeneration').click(); await page.locator('#saveMaterial').click();
    assert.equal(await physical.getAttribute('aria-pressed'), 'true'); assert.equal(await pixel.getAttribute('aria-pressed'), 'true');
    await physical.click(); await pixel.click();
    await page.locator('#previewPhysicalWidth').fill('40'); await page.locator('#previewPhysicalHeight').fill('30');
    await page.locator('#previewPixelWidth').fill('400'); await page.locator('#previewPixelHeight').fill('300');
    await physical.click(); await pixel.click();
    for (const viewport of [{width:1440,height:1000},{width:820,height:1180},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      const boxes = await page.locator('.preview-size-pair').evaluateAll(pairs => pairs.map(pair => {
        const box = element => { const {x,y,width,height} = element.getBoundingClientRect(); return {x,y,width,height}; };
        const labels = [...pair.querySelectorAll('label')].map(label => { const range = document.createRange(); range.selectNode(label.firstChild); return box(range); });
        return { pair:box(pair), button:box(pair.querySelector('button')), labels, inputs:[...pair.querySelectorAll('input')].map(box), icon:pair.querySelector('img').naturalWidth };
      }));
      for (const box of boxes) {
        assert.ok(box.icon > 0);
        assert.ok(box.button.x >= box.pair.x && box.button.x + box.button.width <= box.pair.x + box.pair.width + 1);
        for (const input of box.inputs) assert.ok(box.button.x + box.button.width <= input.x + 1, 'Chain button sits to the left of the inputs');
        for (const label of box.labels) assert.ok(label.x + label.width <= box.button.x + 1, 'Chain button sits to the right of the labels');
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({path:`checks/material-preview-ratio-${viewport.width}.png`});
    }
    await page.locator('#confirmPreviewGeneration').click();
    await page.waitForFunction(() => document.getElementById('status').textContent === '已生成预览图并保存到资产库');
    assert.equal(cloud.assets.size, 1);
    assert.deepEqual([...cloud.assets.values()][0].metadata.previewInfo, {widthCm:40,heightCm:30,widthPx:400,heightPx:300});
    await page.reload(); await page.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    await page.locator('#saveMaterial').click();
    assert.deepEqual(await sizes(), [40,30,400,300]);
    assert.equal(await physical.getAttribute('aria-pressed'), 'true');
    await page.locator('#previewPhysicalWidth').fill('80'); assert.equal((await sizes())[1],60);
    await page.locator('#cancelPreviewGeneration').click(); await page.locator('#category').selectOption('包边条'); await page.locator('#saveMaterial').click();
    assert.deepEqual((await sizes()).slice(0,2), [10,7.5], 'Changing classification uses its defaults instead of the previous saved size');
    assert.deepEqual(errors, []);
    console.log('Material preview ratio checks passed: category defaults, default locks, bidirectional changes, independent unlocks, relock, validation, saved dimensions, reload, centered icons on desktop/tablet/mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
