const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'spenic-daylight-'));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => document.getElementById('loading').hidden && !document.getElementById('dayCycle').disabled, null, { timeout: 60000 });
    const model = await page.locator('#modelName').textContent(), materials = await page.locator('#materialList').textContent();
    const button = page.locator('#dayCycle');
    await page.locator('#restoreInspector').click();
    const settled = () => page.waitForFunction(() => document.getElementById('dayCycle').dataset.transitioning === 'false');
    assert.equal(await button.getAttribute('data-phase'), 'morning', 'Morning is active without clicking');
    assert.equal((await button.textContent()).trim(), '', 'Only the icon is visible');
    assert.equal(await page.locator('#sceneName').inputValue(), '清晨场景');
    assert.equal(await page.locator('#exposure').inputValue(), '0.55');
    assert.equal(await page.locator('#lightAngle').inputValue(), '-123');
    assert.ok((await button.boundingBox()).width <= 72, 'Compact icon button');
    await button.screenshot({ path: path.join(temp, 'initial-icon.png') });
    for (const phase of ['evening', 'night', 'morning']) {
      await button.click();
      await page.waitForFunction(() => {
        const y = Number(document.querySelector('[data-day-disc]').getAttribute('cy'));
        const phase = document.getElementById('dayCycle').dataset.phase;
        return phase === 'evening' ? y > 27 && y < 35 : phase === 'night' ? y < 35 && y > 28 : y < 24.8;
      });
      if (phase === 'evening') {
        const angle = Number(await page.locator('#lightAngle').inputValue());
        assert.notEqual(angle, 95, 'Light moves gradually');
        assert.equal(await button.getAttribute('data-transitioning'), 'true');
        assert.equal(await button.locator('[data-day-disc]').count(), 1, 'A single body morphs between all phases');
        const y = Number(await button.locator('[data-day-disc]').getAttribute('cy'));
        assert.ok(y > 24 && y < 38, 'The sun physically sinks to the horizon');
        await page.screenshot({ path: path.join(temp, 'transition.png') });
      }
      await button.screenshot({ path: path.join(temp, phase + '-morph.png') });
      await settled();
      assert.equal(await button.getAttribute('data-phase'), phase);
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#saveScene').click()]);
      const saved = path.join(temp, phase + '.formscene'); await download.saveAs(saved);
      const expected = JSON.parse(await fs.readFile('assets/scenes/' + phase + '.json', 'utf8'));
      assert.deepEqual(JSON.parse(await fs.readFile(saved, 'utf8')), expected, 'Exact supplied preset at transition end');
      await page.screenshot({ path: path.join(temp, phase + '.png') });
      await button.screenshot({ path: path.join(temp, phase + '-icon.png') });
    }
    assert.equal(await page.locator('#modelName').textContent(), model);
    assert.equal(await page.locator('#materialList').textContent(), materials);
    await button.click();
    await page.waitForFunction(() => Number(document.querySelector('[data-day-disc]').getAttribute('cy')) > 26);
    await button.click(); await button.click();
    await settled(); assert.equal(await button.getAttribute('data-phase'), 'morning', 'Rapid clicks settle at most recent target');
    await button.click();
    await page.locator('#sceneFile').setInputFiles('assets/scenes/night.json');
    await page.waitForFunction(() => document.getElementById('sceneName').value === '夜晚场景');
    assert.equal(await button.getAttribute('data-phase'), 'night', 'Import cancels animation and synchronizes icon');
    assert.equal(await button.getAttribute('data-transitioning'), 'false');
    await button.focus(); await page.keyboard.press('Enter'); await settled();
    assert.equal(await button.getAttribute('data-phase'), 'morning', 'Keyboard cycles scenes');
    await button.click();
    await page.locator('#exposure').evaluate(el => { el.value = '1.2'; el.dispatchEvent(new Event('input')); });
    assert.equal(await button.getAttribute('data-transitioning'), 'false');
    assert.equal(await page.locator('#exposure').inputValue(), '1.2', 'Manual scene edits cancel animation');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await button.click(); await settled();
    assert.equal(await button.getAttribute('data-phase'), 'morning');
    await page.locator('#collapseInspector').click();
    const disjoint = async () => {
      const a = await button.boundingBox(), b = await page.locator('#restoreInspector').boundingBox();
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'Scene button must not overlap inspector restore');
    };
    await disjoint();
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await button.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await disjoint();
    await button.click(); await settled(); assert.equal(await button.getAttribute('data-phase'), 'evening');
    await page.screenshot({ path: path.join(temp, 'mobile.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: exact presets, intermediate light/icon blending, rapid interruption, imports, manual edits, keyboard, reduced motion and mobile. Screenshots: ' + temp);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
