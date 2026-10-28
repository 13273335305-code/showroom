const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const html = (await fs.readFile(path.join(root, 'design.html'), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('http://procedural-wipe.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (name === 'design.html') return route.fulfill({ contentType: 'text/html', body: html });
      if (name === 'shared/asset-store.js') return route.fulfill({ contentType: 'text/javascript', body: 'export async function listAssets(){return []} export async function getAsset(){return null}' });
      try {
        await route.fulfill({ contentType: { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(name)] || 'application/octet-stream', body: await fs.readFile(path.join(root, name)) });
      } catch { await route.fulfill({ status: 404, body: '' }); }
    });
    await page.goto('http://procedural-wipe.test/design.html');
    await page.evaluate(async () => {
      document.documentElement.classList.remove('auth-pending');
      for (const id of ['authBootLoading', 'designLaunchLoading', 'loading']) document.getElementById(id)?.remove();
      document.querySelector('.workspace').classList.remove('inspector-collapsed');
      const inspector = document.getElementById('inspector');
      inspector.classList.add('open'); inspector.setAttribute('aria-hidden', 'false');
      inspector.style.cssText = 'visibility:visible;opacity:1;transform:none;--inspector-content-opacity:1';
      document.getElementById('compactMaterialPanel').hidden = false;
      const { createDesignWorkspace } = await import('./design-workspace.js');
      window.calls = []; window.updatePending = null; window.refreshedGradient = '';
      window.proceduralTarget = { entry: { color: '#FFFFFF', proceduralMapping: { palette: [{ index: 0, loopHex: '#5DAD62' }, { index: 1, loopHex: '#FFFFFF' }] } } };
      window.otherTarget = { entry: { color: '#FFFFFF', proceduralMapping: { palette: [{ index: 0, loopHex: '#FF0000' }] } } };
      proceduralTarget.entry.meshes = new Set(); otherTarget.entry.meshes = new Set([{}]);
      window.workspaceFixture = createDesignWorkspace({
        cancelPlacement() {}, undo() {}, preview() {},
        read: t => ({ color: t.entry.color, proceduralMapping: t.entry.proceduralMapping, proceduralColorEnabled: t.entry.meshes.size > 0, offset: [0, 0], angle: 0, fabricColorCodes: [] }),
        notify(message) { calls.push(['notify', message]); },
        async proceduralColor(t, index, color) {
          calls.push(['mapping', index, color]);
          await new Promise((resolve, reject) => { updatePending = { resolve, reject }; });
          t.entry.proceduralMapping.palette.find(entry => entry.index === index).loopHex = color;
          workspaceFixture.sync();
          refreshedGradient = document.querySelector('.compact-procedural-swatch').style.backgroundImage;
        }
      });
      workspaceFixture.select(proceduralTarget);
      // Step browser animation frames deterministically, independently of screenshot timing.
      let now = performance.now(), frameId = 0;
      const frames = new Map();
      performance.now = () => now;
      window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
      window.cancelAnimationFrame = id => frames.delete(id);
      window.advanceAnimation = elapsed => {
        now += elapsed; const pending = [...frames.values()]; frames.clear();
        for (const callback of pending) callback(now);
      };
      window.animationFrameCount = () => frames.size;
    });
    const swatches = page.locator('.compact-procedural-swatch'), first = swatches.first();
    const editor = page.locator('#compactProceduralColorEditor'), confirm = page.locator('.compact-procedural-confirm');
    const isPlaceholder = () => editor.evaluate(el => el.classList.contains('is-placeholder'));
    const assertPlaceholder = async () => {
      assert.equal(await editor.isVisible(), true, 'Idle picker stays in the property sidebar');
      assert.equal(await isPlaceholder(), true);
      assert.equal(await editor.evaluate(el => el.inert), true);
      assert.equal(await confirm.isDisabled(), true);
      assert.equal(await page.locator('#compactProceduralValue').inputValue(), '');
      assert.equal(await page.locator('#compactProceduralValue').isDisabled(), true);
      for (const canvas of await editor.locator('canvas').all()) {
        assert.equal(await canvas.evaluate(el => el.getContext('2d').getImageData(0, 0, el.width, el.height).data.some((value, index) => index % 4 === 3 && value !== 0)), false, 'Placeholder clears both rendered controls');
        assert.equal(await canvas.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(233, 236, 240)');
      }
    };
    await assertPlaceholder();
    const idleBounds = await editor.boundingBox();
    const uvOffset = () => page.locator('#compactMaterialPanel .uv-row').evaluate(el => el.getBoundingClientRect().y - document.getElementById('compactProceduralColorEditor').getBoundingClientRect().y);
    const idleUvY = await uvOffset();
    await fs.mkdir(path.join(root, '.codex-project-check'), { recursive: true });
    await editor.screenshot({ path: path.join(root, '.codex-project-check/procedural-picker-placeholder-desktop.png') });
    await confirm.evaluate(el => el.click());
    assert.deepEqual(await page.evaluate(() => calls), [], 'Idle controls cannot update a material');
    assert.equal(await first.isDisabled(), true, 'Unapplied procedural material has no editable palette');
    await first.evaluate(el => el.click()); await first.dispatchEvent('click');
    await assertPlaceholder();
    assert.deepEqual(await page.evaluate(() => calls), [], 'Unapplied swatch clicks do not update the material');
    await page.evaluate(() => { proceduralTarget.entry.meshes.add({}); workspaceFixture.sync(); });
    assert.equal(await first.isDisabled(), false, 'Applying the material enables the swatches');
    await first.click(); await page.locator('#compactProceduralValue').fill('#112233');
    await page.evaluate(() => { proceduralTarget.entry.meshes.clear(); workspaceFixture.sync(); });
    await assertPlaceholder();
    assert.equal(await first.isDisabled(), true, 'Removing the last model assignment disables the swatches');
    assert.deepEqual(await page.evaluate(() => calls), [], 'Detaching the material discards the draft');
    await page.evaluate(() => { proceduralTarget.entry.meshes.add({}); workspaceFixture.sync(); });
    await first.click();
    await page.locator('#compactProceduralValue').fill('#112233');
    await page.evaluate(() => proceduralTarget.entry.meshes.clear());
    await confirm.click();
    await assertPlaceholder();
    assert.deepEqual(await page.evaluate(() => calls), [], 'Confirm rechecks model use even before a panel refresh');
    await page.evaluate(() => { proceduralTarget.entry.meshes.add({}); workspaceFixture.sync(); });
    const start = async color => {
      if (await isPlaceholder()) await first.click();
      assert.equal(await isPlaceholder(), false);
      await page.locator('#compactProceduralValue').fill(color); await confirm.click();
      assert.equal(await confirm.isDisabled(), true);
    };
    const gradient = () => first.evaluate(el => el.style.backgroundImage);
    const advance = elapsed => page.evaluate(elapsed => advanceAnimation(elapsed), elapsed);
    const complete = async () => { await page.evaluate(() => updatePending.resolve()); };
    const assertFinished = async color => {
      assert.equal(await gradient(), '');
      assert.equal(await first.getAttribute('aria-busy'), null);
      assert.equal(await first.evaluate(el => el.style.backgroundColor), color);
      assert.equal(await confirm.isDisabled(), await isPlaceholder());
      assert.equal(await page.evaluate(() => animationFrameCount()), 0);
    };

    await start('#E63B0C'); await advance(260);
    assert.equal((await editor.boundingBox()).height, idleBounds.height, 'Opening the picker preserves its reserved height');
    assert.equal(await uvOffset(), idleUvY, 'Opening the picker does not move UV controls');
    const sector = await gradient();
    assert.match(sector, /^conic-gradient\((?:from 0deg, )?rgb\(230, 59, 12\) 0deg/);
    assert.ok(sector.includes('rgb(230, 59, 12) 144deg'), 'New color starts at twelve o’clock and sweeps clockwise');
    assert.ok(sector.includes('rgb(93, 173, 98) 144deg') && sector.includes('rgb(93, 173, 98) 360deg'), 'Old color remains in the unswept sector');
    assert.equal(await swatches.nth(1).evaluate(el => el.style.backgroundImage), '');
    await page.evaluate(() => workspaceFixture.sync());
    assert.equal(await gradient(), sector, 'Unrelated panel refresh preserves the current sector');
    await fs.mkdir(path.join(root, '.codex-project-check'), { recursive: true });
    await page.locator('#compactMaterialPanel').screenshot({ path: path.join(root, '.codex-project-check/procedural-color-wipe-panel.png') });
    await first.evaluate(el => { el.style.width = el.style.height = '180px'; });
    await first.screenshot({ path: path.join(root, '.codex-project-check/procedural-color-wipe-sector.png') });
    await first.evaluate(el => { el.style.width = el.style.height = ''; });
    await advance(1000);
    assert.ok((await gradient()).includes('324deg'), 'Slow generation retains the final old-color sector');
    assert.equal(await first.getAttribute('aria-busy'), 'true');
    await complete();
    assert.equal(await page.evaluate(() => refreshedGradient), await gradient(), 'Committed mapping refresh does not flash the solid new color');
    await advance(80); assert.ok((await gradient()).includes('342deg'));
    await advance(80); await page.waitForFunction(() => document.getElementById('compactProceduralColorEditor').classList.contains('is-placeholder'));
    await assertFinished('rgb(230, 59, 12)');
    await assertPlaceholder();
    assert.equal((await editor.boundingBox()).height, idleBounds.height);
    assert.equal(await uvOffset(), idleUvY);

    await start('#336699'); await complete();
    assert.ok((await gradient()).includes('rgb(51, 102, 153) 0deg, rgb(51, 102, 153) 0deg'), 'Fast generation still allows the visible wipe to run');
    await advance(325); assert.ok((await gradient()).includes('180deg'));
    await advance(325); await assertFinished('rgb(51, 102, 153)');

    await start('#ABCDEF'); await advance(260);
    await page.evaluate(() => updatePending.reject(new Error('测试渲染失败')));
    await page.waitForFunction(() => !document.querySelector('.compact-procedural-confirm').disabled);
    await assertFinished('rgb(51, 102, 153)');
    assert.equal(await editor.isVisible(), true, 'Failed update keeps the draft open for retry');
    assert.equal(await page.locator('#compactProceduralValue').inputValue(), '#ABCDEF');
    assert.match(await page.evaluate(() => calls.at(-1)[1]), /测试渲染失败/);

    await start('#ABCDEF'); await advance(260);
    const pendingSector = await gradient();
    await page.evaluate(() => workspaceFixture.select(otherTarget));
    await assertPlaceholder();
    assert.equal(await gradient(), ''); assert.equal(await first.getAttribute('aria-busy'), null);
    assert.equal(await first.evaluate(el => el.style.backgroundColor), 'rgb(255, 0, 0)');
    await page.evaluate(() => workspaceFixture.select({ entry: proceduralTarget.entry }));
    assert.equal(await gradient(), pendingSector, 'Returning via a new target wrapper resumes the same material wipe');
    await page.evaluate(() => workspaceFixture.select(otherTarget));
    await complete(); await advance(1000);
    await assertFinished('rgb(255, 0, 0)');
    await page.evaluate(() => workspaceFixture.select(proceduralTarget));
    await assertFinished('rgb(171, 205, 239)');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await start('#119944');
    assert.equal(await gradient(), '');
    assert.equal(await first.evaluate(el => el.style.backgroundColor), 'rgb(171, 205, 239)');
    assert.equal(await first.getAttribute('aria-busy'), 'true');
    await complete(); await page.waitForFunction(() => document.getElementById('compactProceduralColorEditor').classList.contains('is-placeholder'));
    await assertFinished('rgb(17, 153, 68)');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await start('#119944');
    assert.equal(await gradient(), ''); assert.equal(await first.getAttribute('aria-busy'), null);
    await complete(); await page.waitForFunction(() => document.getElementById('compactProceduralColorEditor').classList.contains('is-placeholder'));
    await assertFinished('rgb(17, 153, 68)');
    await page.setViewportSize({ width: 390, height: 1000 });
    await editor.scrollIntoViewIfNeeded();
    await assertPlaceholder();
    const mobileBounds = await editor.boundingBox();
    await editor.screenshot({ path: path.join(root, '.codex-project-check/procedural-picker-placeholder-mobile.png') });
    await first.click();
    assert.equal((await editor.boundingBox()).height, mobileBounds.height);
    await page.locator('#compactProceduralValue').fill('#A04488');
    await editor.screenshot({ path: path.join(root, '.codex-project-check/procedural-picker-active-mobile.png') });
    await page.locator('#compactProceduralValue').press('Escape');
    await assertPlaceholder();
    assert.equal((await editor.boundingBox()).height, mobileBounds.height);
    await first.click(); await first.click(); await assertPlaceholder();
    await page.evaluate(() => { proceduralTarget.entry.meshes.clear(); workspaceFixture.sync(); });
    assert.equal(await first.isDisabled(), true);
    await first.dispatchEvent('click'); await assertPlaceholder();
    await page.evaluate(() => { proceduralTarget.entry.meshes.add({}); workspaceFixture.sync(); });
    await first.click(); assert.equal(await isPlaceholder(), false);
    await page.locator('#compactProceduralValue').press('Escape'); await assertPlaceholder();
    assert.deepEqual(errors, []);
    console.log('PASS: model-use gate, unapplied click suppression, applying/removing/reapplying, confirm recheck, gray placeholders, stable desktop/mobile layout, clockwise animation, failure retry, material switching and reduced motion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
