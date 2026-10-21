const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const html = (await fs.readFile(path.join(root, 'design.html'), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const [name, width, height, reducedMotion] of [
      ['desktop', 1440, 960, 'no-preference'], ['mobile', 390, 844, 'no-preference'], ['reduced', 390, 844, 'reduce'],
    ]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // Exercise the real dock controller while isolating model loading and login.
      await page.route('http://delete-transition.test/**', async route => {
        const name = new URL(route.request().url()).pathname.slice(1);
        if (name === 'design.html') return route.fulfill({ contentType: 'text/html', body: html });
        if (name === 'shared/asset-store.js') return route.fulfill({ contentType: 'text/javascript', body: 'export async function listAssets(){return []} export async function getAsset(){return null}' });
        try {
          await route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', body: await fs.readFile(path.join(root, name)) });
        } catch { await route.fulfill({ status: 404, body: '' }); }
      });
      await page.goto('http://delete-transition.test/design.html');
      await page.evaluate(async () => {
        document.documentElement.classList.remove('auth-pending');
        for (const id of ['authBootLoading', 'designLaunchLoading', 'loading']) document.getElementById(id)?.remove();
        const dock = document.getElementById('materialDock');
        dock.classList.remove('opening-hidden'); dock.removeAttribute('aria-hidden');
        dock.style.cssText = 'opacity:1;visibility:visible;transform:none;display:block';
        const { createDesignWorkspace } = await import('./design-workspace.js');
        window.deletedItems = [];
        window.workspaceFixture = createDesignWorkspace({
          canRemove: item => !item.entry.used, prepareRemoval() {}, cancelPlacement() {}, undo() {}, showScene() {}, notify() {},
          removeUnused(items) { window.deletedItems.push(...items); return items.length; },
        });
        for (const used of [false, true]) {
          const button = document.createElement('button');
          button.id = used ? 'test-used' : 'test-unused'; button.className = 'material-item';
          button.textContent = used ? '正在使用' : '可删除'; button.setAttribute('aria-label', button.textContent);
          document.getElementById('materialList').append(button);
          window.workspaceFixture.bindDockItem(button, { entry: { used } });
        }
      });
      await page.waitForFunction(() => ['addDockAsset', 'scanFabric', 'dockTrash'].every(id => {
        const style = getComputedStyle(document.getElementById(id));
        return style.opacity === '1' && new DOMMatrix(style.transform).f === 0;
      }));
      const bounds = id => page.locator('#' + id).boundingBox();
      const scanBefore = await bounds('scanFabric'), addBefore = await bounds('addDockAsset');
      assert.equal(scanBefore.width, width > 760 ? 44 : 40);
      // Sample every animation frame to verify upward travel without moving the controls.
      const frames = await page.evaluate(async () => {
        const tools = document.querySelector('.dock-delete-tools');
        const sample = () => {
          const css = getComputedStyle(tools, '::after');
          const cancel = document.getElementById('dockCancelDelete').getBoundingClientRect();
          return { y: new DOMMatrix(css.transform).f, opacity: Number(css.opacity), cancelY: cancel.y };
        };
        const frames = [sample()];
        document.getElementById('dockTrash').click();
        for (let i = 0; i < 180; i++) {
          await new Promise(requestAnimationFrame);
          const frame = sample(); frames.push(frame);
          if (Math.abs(frame.y) < .1 && frame.opacity === 1) break;
        }
        return frames;
      });
      await page.locator('#scanFabric').waitFor({ state: 'hidden' });
      await page.locator('#addDockAsset').waitFor({ state: 'hidden' });
      await page.locator('#dockTrash').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#scanFabric').getAttribute('hidden'), '');
      assert.equal(await page.locator('#addDockAsset').getAttribute('hidden'), '');
      assert.equal(await page.locator('#dockTrash').getAttribute('hidden'), '');
      assert.deepEqual(await page.locator('.dock-delete-tools button:visible').evaluateAll(buttons => buttons.map(button => button.id)), ['dockCancelDelete', 'dockDeleteSelected']);
      const cancel = await bounds('dockCancelDelete'), confirm = await bounds('dockDeleteSelected'), tools = await page.locator('.dock-delete-tools').boundingBox(), dock = await bounds('materialDock');
      assert.ok(Math.abs(cancel.x - confirm.x) < .1 && cancel.y + cancel.height < confirm.y, 'Cancel is above confirm');
      assert.ok(Math.abs(tools.y - (dock.y + 1)) < 1, 'Pale-red surface reaches the dock top');
      assert.ok(cancel.x >= tools.x && confirm.x + confirm.width <= tools.x + tools.width);
      assert.ok(cancel.y > tools.y && confirm.y + confirm.height < tools.y + tools.height);
      assert.equal(await page.locator('#dockDeleteSelected').isDisabled(), true);
      assert.equal(await page.locator('#test-used').isDisabled(), true);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'dockCancelDelete');
      for (const id of ['dockCancelDelete', 'dockDeleteSelected']) {
        assert.equal(await page.locator('#' + id + ' svg').count(), 1);
        assert.equal((await page.locator('#' + id).innerText()).trim(), '');
      }
      const final = frames.at(-1);
      assert.ok(Math.abs(final.y) < .1, JSON.stringify({ name, final, frames })); assert.equal(final.opacity, 1);
      if (reducedMotion === 'reduce') assert.ok(frames.every(frame => frame.y === 0), 'Reduced motion uses a fade without travel');
      else {
        assert.ok(frames[0].y > 200);
        assert.ok(frames.some(frame => frame.y > 1 && frame.y < frames[0].y - 1), 'The background moves upward through intermediate frames');
        for (let i = 2; i < frames.length; i++) assert.ok(frames[i].y <= frames[i - 1].y + .1, 'Upward motion is monotonic');
      }
      await page.locator('#materialDock').screenshot({ path: path.join(root, 'outputs', 'design-delete-vertical-' + name + '.png') });
      const transitionDurations = await page.locator('.dock-delete-tools').evaluate(el => {
        const fill = getComputedStyle(el, '::after'), actions = getComputedStyle(document.getElementById('dockDeleteActions'));
        return { fill: fill.transitionDuration, actions: actions.transitionDuration, actionDelay: actions.transitionDelay, token: getComputedStyle(el).getPropertyValue('--dock-delete-duration').trim() };
      });
      assert.deepEqual(transitionDurations, { fill: reducedMotion === 'reduce' ? '0.4s' : '0.4s, 0.4s', actions: reducedMotion === 'reduce' ? '0s' : '0.4s, 0.4s, 0.4s', actionDelay: reducedMotion === 'reduce' ? '0s' : '0.4s, 0.4s, 0.4s', token: '400ms' });
      const reverseFrames = await page.evaluate(async () => {
        const sample = () => {
          const css = getComputedStyle(document.querySelector('.dock-delete-tools'), '::after');
          const actions = getComputedStyle(document.getElementById('dockDeleteActions'));
          const controls = ['addDockAsset', 'scanFabric', 'dockTrash'].map(id => getComputedStyle(document.getElementById(id)).opacity);
          return { y: new DOMMatrix(css.transform).f, opacity: Number(css.opacity), actionOpacity: Number(actions.opacity), actionDisplay: actions.display, controls: controls.map(Number) };
        };
        const frames = [sample()];
        document.getElementById('dockCancelDelete').click();
        for (let i = 0; i < 180; i++) {
          await new Promise(requestAnimationFrame);
          const frame = sample(); frames.push(frame);
          if (frame.opacity === 0 && frame.actionDisplay === 'none') break;
        }
        return frames;
      });
      if (reducedMotion === 'reduce') {
        assert.ok(reverseFrames.every(frame => frame.y === 0), 'Reduced motion skips return travel');
        assert.equal(reverseFrames.at(-1).actionDisplay, 'none');
      } else {
        assert.ok(reverseFrames.some(frame => frame.actionOpacity > 0 && frame.actionOpacity < 1 && frame.actionDisplay !== 'none'), 'Icons remain rendered while fading out');
        assert.equal(reverseFrames.at(-1).actionDisplay, 'none', 'Icons leave the layout after their return transition');
        assert.ok(reverseFrames.some(frame => frame.controls.some(opacity => opacity > 0 && opacity < 1)), 'Add, scan and trash controls fade back in');
        assert.ok(reverseFrames.at(-1).controls.every(opacity => opacity === 1), 'Restored controls finish fading in');
        assert.ok(reverseFrames[0].y < 1 && reverseFrames.at(-1).y > 200, 'Return animation travels back down');
        for (let i = 2; i < reverseFrames.length; i++) assert.ok(reverseFrames[i].y >= reverseFrames[i - 1].y - .1, 'Return motion is monotonic');
      }
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.dock-delete-tools'), '::after').opacity) === 0);
      assert.deepEqual(await bounds('scanFabric'), scanBefore, 'Scan restores its original position and size');
      assert.deepEqual(await bounds('addDockAsset'), addBefore);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'dockTrash');
      await page.locator('#dockTrash').click();
      await page.locator('#test-unused').click();
      assert.equal(await page.locator('#dockDeleteSelected').isEnabled(), true);
      assert.equal(await page.locator('#dockDeleteCount').textContent(), '1');
      await page.locator('#dockDeleteSelected').click();
      assert.equal(await page.locator('#scanFabric').isVisible(), true);
      assert.equal(await page.evaluate(() => window.deletedItems.length), 1);
      // Interrupt an entry with Escape and immediately enter again.
      await page.locator('#dockTrash').click(); await page.keyboard.press('Escape'); await page.locator('#dockTrash').click();
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.dock-delete-tools'), '::after').opacity) === 1);
      await page.locator('#scanFabric').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#scanFabric').getAttribute('hidden'), '');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#scanFabric').isVisible(), true);
      assert.equal(await page.locator('#dockDeleteActions').getAttribute('hidden'), '');
      assert.equal(await page.locator('#dockDeleteActions').evaluate(el => el.inert), true);
      await page.locator('#dockDeleteActions').waitFor({ state: 'hidden' });
      assert.deepEqual(errors, []);
      console.log('PASS ' + name + ': vertical icon controls, hidden scan, upward fill, cancel/delete, interruption and focus');
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
