const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const storageKey = 'spenic-procedural-color-favorites-v1';
const output = path.join(root, '.codex-project-check/color-palettes');
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/shared/procedural-color-picker.css">
  <style>*{box-sizing:border-box}body{margin:24px;background:#f4f6f9;font-family:'Microsoft YaHei',sans-serif}main{display:flex;flex-wrap:wrap;gap:24px}section{width:234px;margin:0!important}</style>
  <main><section id="first"></section><section id="second"></section></main><script src="/shared/procedural-color-picker.js"></script>
  <script>window.confirmed=[];window.cancelled=0;window.pickers=['first','second'].map(id=>ProceduralColorPicker.mount(document.getElementById(id),{prefix:id,onConfirm:color=>confirmed.push(color),onCancel:()=>{cancelled++;pickers.forEach(picker=>picker.clear())}}));pickers.forEach(picker=>picker.open('#FF0000'));</script>`;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
    await context.route('http://color-palettes.test/**', async route => {
      const name = new URL(route.request().url()).pathname;
      if (name === '/') return route.fulfill({ contentType: 'text/html', body: html });
      await route.fulfill({ contentType: name.endsWith('.js') ? 'text/javascript' : 'text/css', body: await fs.readFile(path.join(root, name)) });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://color-palettes.test/');
    const editor = page.locator('#first');
    const input = editor.locator('input');
    const toggle = editor.locator('.compact-procedural-palette-toggle');
    const favorite = editor.locator('.compact-procedural-favorite');
    const confirm = editor.locator('.compact-procedural-confirm');
    const tabs = editor.getByRole('tab');
    const swatches = editor.locator('.compact-procedural-palette-color');
    const swatch = value => editor.locator(`.compact-procedural-palette-color[data-color="${value}"]`);
    await fs.mkdir(output, { recursive: true });
    await editor.screenshot({ path: path.join(output, 'picker.png') });
    const originalHeight = (await editor.boundingBox()).height;
    assert.deepEqual(await editor.locator('.compact-procedural-color-actions').locator('button,input').evaluateAll(elements => elements.map(element => element.tagName)), ['BUTTON', 'INPUT', 'BUTTON', 'BUTTON']);
    assert.equal(await favorite.locator('svg,img').count(), 0, 'The favorite icon uses CSS');
    assert.notEqual(await favorite.locator('span').evaluate(element => getComputedStyle(element).maskImage), 'none');

    await toggle.click();
    assert.equal(await editor.locator('canvas').first().isVisible(), false);
    assert.equal((await editor.boundingBox()).height, originalHeight, 'Switching to palettes keeps the reserved height');
    assert.equal(await tabs.first().textContent(), '收藏');
    await tabs.first().click();
    assert.equal(await editor.getByText('暂无收藏', { exact: true }).isVisible(), true);
    await editor.screenshot({ path: path.join(output, 'favorites-empty.png') });
    await tabs.getByText('常用', { exact: true }).click();
    await swatch('#60A5FA').click();
    assert.equal(await input.inputValue(), '#60A5FA');
    assert.equal(await favorite.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await page.evaluate(() => confirmed), [], 'Palette selections remain drafts');
    await favorite.click();
    assert.equal(await favorite.getAttribute('aria-pressed'), 'true');
    await input.fill('abcdef'); await favorite.click();
    assert.equal(await input.inputValue(), '#ABCDEF');
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), ['#ABCDEF', '#60A5FA']);
    await page.evaluate(() => pickers[1].open('#abcdef'));
    assert.equal(await page.locator('#second .compact-procedural-favorite').getAttribute('aria-pressed'), 'true', 'Picker instances share favorites');
    await tabs.first().click();
    assert.equal(await swatches.count(), 2);
    await swatch('#60A5FA').click();
    await favorite.click();
    assert.equal(await swatches.count(), 1, 'Removing a favorite refreshes the visible palette');
    await swatches.first().click();
    await input.fill('#12'); await favorite.click();
    assert.equal(await input.evaluate(element => element.validity.valid), false);
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), ['#ABCDEF'], 'Invalid HEX values cannot be saved');
    await swatches.first().click();
    await confirm.click();
    assert.deepEqual(await page.evaluate(() => confirmed), ['#ABCDEF']);

    await page.reload();
    await toggle.click(); await tabs.first().click();
    assert.equal(await swatches.count(), 1, 'Favorites survive a reload');
    await swatches.first().click();
    assert.equal(await input.inputValue(), '#ABCDEF');
    assert.equal(await favorite.getAttribute('aria-pressed'), 'true');
    await input.fill('#5DAD62'); await favorite.click();
    await input.fill('#6F4E37'); await favorite.click();
    await editor.screenshot({ path: path.join(output, 'favorites.png') });

    const other = await context.newPage();
    await other.goto('http://color-palettes.test/');
    await other.locator('#first input').fill('#FF0000');
    await other.locator('#first .compact-procedural-favorite').click();
    await swatch('#FF0000').waitFor();
    await other.close();
    await tabs.first().focus(); await tabs.first().press('ArrowDown');
    assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
    await tabs.nth(1).press('End');
    assert.equal(await tabs.last().getAttribute('aria-selected'), 'true');
    await editor.screenshot({ path: path.join(output, 'palette.png') });
    await page.evaluate(() => pickers[0].setDisabled(true));
    assert.equal(await toggle.isDisabled(), true);
    assert.equal(await favorite.isDisabled(), true);
    assert.equal(await swatches.first().isDisabled(), true);
    const draft = await input.inputValue();
    await swatches.first().dispatchEvent('click');
    assert.equal(await input.inputValue(), draft);
    await page.evaluate(() => pickers[0].setDisabled(false));

    for (const width of [220, 234, 286]) {
      await editor.evaluate((element, width) => { element.style.width = width + 'px'; }, width);
      assert.equal(await editor.evaluate(element => element.scrollWidth <= element.clientWidth), true, `Footer fits at ${width}px`);
      const controls = await editor.locator('.compact-procedural-color-actions > *').evaluateAll(elements => elements.map(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right })));
      assert.ok(controls.every((control, index) => !index || control.left >= controls[index - 1].right), 'Footer controls never overlap');
      await toggle.click();
      assert.equal(await editor.locator('canvas').first().isVisible(), true);
      assert.equal(await input.inputValue(), draft, 'Switching views preserves the draft');
      await toggle.click();
    }
    await page.setViewportSize({ width: 390, height: 700 });
    await editor.evaluate(element => { element.style.width = '234px'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await editor.screenshot({ path: path.join(output, 'palette-mobile.png') });
    await input.press('Escape');
    assert.equal(await editor.evaluate(element => element.inert), true);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => cancelled), 1);

    // A write can fail even when reads work (for example, storage quota exhaustion).
    await page.evaluate(key => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(name, value) { if (name === key) throw new DOMException('Full', 'QuotaExceededError'); return setItem.call(this, name, value); };
      pickers[0].open('#123456');
    }, storageKey);
    await favorite.click();
    assert.equal(await favorite.getAttribute('aria-pressed'), 'true');
    assert.match(await editor.getByRole('status').textContent(), /本次使用/);
    await toggle.click(); await tabs.first().click();
    assert.equal(await swatch('#123456').count(), 1);
    await favorite.click();
    assert.equal(await swatch('#123456').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: palette drafts, CSS favorite icon, add/remove/validation, reload persistence, shared pickers and tabs, storage failure, keyboard, disabled controls and compact/mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
