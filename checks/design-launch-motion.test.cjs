const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const [name, width, height, deviceScaleFactor] of [
      ['desktop', 1440, 900, 1], ['ipad', 820, 1180, 2], ['ipad-landscape', 1180, 820, 2], ['mobile', 390, 844, 3],
    ]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor });
      // Hold the launch screen independently of authentication and model loading.
      await context.route('**/design.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace('<html lang="zh-CN" class="auth-pending">', '<html lang="zh-CN">') });
      });
      const page = await context.newPage();
      await page.goto(`${base}/design.html`);
      assert.equal(await page.locator('.design-launch-card strong').textContent(), '正在进入设计台');
      assert.equal(await page.locator('.design-platform-scene > span').count(), 9);
      const session = await context.newCDPSession(page);
      await session.send('Performance.enable');
      await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const layoutCount = async () => (await session.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'LayoutCount').value;
      const before = await layoutCount();
      const samples = await page.locator('.design-platform-scene').evaluate(async scene => {
        const result = [];
        for (let i = 0; i < 40; i++) {
          const rect = scene.getBoundingClientRect();
          const parts = [...scene.children].map(part => ({ opacity: Number(getComputedStyle(part).opacity), transform: getComputedStyle(part).transform }));
          result.push({ rect: [rect.x, rect.y, rect.width, rect.height], parts });
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return result;
      });
      assert.equal(await layoutCount(), before, 'Animation must not trigger layout, including under CPU throttling');
      assert.ok(samples.every(sample => JSON.stringify(sample.rect) === JSON.stringify(samples[0].rect)), 'Animation keeps its layout stable');
      for (const index of [1, 2, 3, 4, 5, 6, 7]) {
        assert.ok(Math.max(...samples.map(sample => sample.parts[index].opacity)) > .8, `Assembly part ${index} becomes visible`);
        assert.ok(Math.min(...samples.map(sample => sample.parts[index].opacity)) < .1, `Assembly part ${index} resets for the next cycle`);
      }
      assert.ok(samples.some(sample => sample.parts[3].opacity > .8 && sample.parts[4].opacity < .1), 'The deck appears before the frame');
      assert.ok(samples.some(sample => sample.parts[4].opacity > .8 && sample.parts[5].opacity < .1), 'The frame appears before the control panel');
      assert.equal(await page.locator('.design-platform-loader').evaluate(el => getComputedStyle(el, '::before').content), 'none', 'The former twin-frame spinner is removed');
      const alignment = await page.locator('.design-platform-scene').evaluate(async scene => {
        for (const part of scene.children) for (const animation of part.getAnimations()) { animation.pause(); animation.currentTime = 2000; }
        await new Promise(resolve => requestAnimationFrame(resolve));
        const center = selector => { const rect = scene.querySelector(selector).getBoundingClientRect(); return rect.x + rect.width / 2; };
        const legs = scene.querySelector('.design-platform-legs'), base = scene.querySelector('.design-platform-base');
        const leftLeg = legs.querySelector('.design-platform-leg-left').getBoundingClientRect();
        const rightLeg = legs.querySelector('.design-platform-leg-right').getBoundingClientRect();
        const baseRect = base.getBoundingClientRect();
        return {
          offsets: [
            center('.design-platform-legs .design-platform-leg-left') - center('.design-platform-frame-left'),
            center('.design-platform-legs .design-platform-leg-right') - center('.design-platform-frame-right'),
          ],
          behind: [...scene.children].indexOf(legs) < [...scene.children].indexOf(base),
          overlapsBase: [leftLeg.top < baseRect.bottom && leftLeg.bottom > baseRect.bottom, rightLeg.top < baseRect.bottom && rightLeg.bottom > baseRect.bottom],
        };
      });
      assert.ok(alignment.offsets.every(offset => Math.abs(offset) < .1), `Frame uprights and support legs share centerlines: ${alignment.offsets}`);
      assert.equal(alignment.behind, true, 'Support legs are painted behind the tabletop base');
      assert.ok(alignment.overlapsBase.every(Boolean), 'The tabletop base covers the top edge of each leg');
      await page.screenshot({ path: `checks/design-launch-${name}.png` });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.design-platform-scene > span').evaluateAll(parts => parts.every(part => getComputedStyle(part).animationName === 'none')), true);
      assert.equal(await page.locator('.design-launch-card strong span').first().evaluate(el => getComputedStyle(el).animationName), 'none');
      console.log(`PASS ${name}: assembly order, stable layout, no layout under 4x CPU throttling and reduced motion`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
