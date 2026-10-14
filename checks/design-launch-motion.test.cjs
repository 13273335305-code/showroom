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
        await route.fulfill({ response, body: (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') });
      });
      const page = await context.newPage();
      await page.goto(`${base}/design.html`);
      assert.equal(await page.locator('.design-launch-card strong').textContent(), '正在进入设计台');
      const session = await context.newCDPSession(page);
      await session.send('Performance.enable');
      await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const layoutCount = async () => (await session.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'LayoutCount').value;
      const before = await layoutCount();
      const samples = await page.locator('.loading-228').evaluate(async el => {
        const result = [];
        for (let i = 0; i < 40; i++) {
          const css = getComputedStyle(el, '::before'), rightCss = getComputedStyle(el, '::after'), rect = el.getBoundingClientRect();
          const matrix = new DOMMatrix(css.transform);
          const bounds = style => {
            const transform = new DOMMatrix(style.transform);
            const width = parseFloat(style.width) + (style.boxSizing === 'border-box' ? 0 : 2 * parseFloat(style.borderLeftWidth));
            const center = rect.x + parseFloat(style.left) + width / 2 + transform.e;
            return [center - width * transform.a / 2, center + width * transform.a / 2];
          };
          const left = bounds(css), right = bounds(rightCss), label = el.nextElementSibling.getBoundingClientRect();
          const visualCenter = (Math.min(left[0], right[0]) + Math.max(left[1], right[1])) / 2;
          result.push({ width: css.width, height: css.height, scale: matrix.a, x: matrix.e,
            centerOffset: visualCenter - (label.x + label.width / 2),
            rect: [rect.x, rect.y, rect.width, rect.height] });
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return result;
      });
      assert.equal(await layoutCount(), before, 'Animation must not trigger layout, including under CPU throttling');
      assert.ok(samples.every(sample => sample.width === '132px' && sample.height === '88px'));
      assert.ok(samples.every(sample => sample.scale >= .5 && sample.scale <= 1), 'Never enlarge the rasterized layer');
      assert.ok(Math.max(...samples.map(sample => sample.scale)) - Math.min(...samples.map(sample => sample.scale)) > .4);
      assert.ok(samples.every(sample => JSON.stringify(sample.rect) === JSON.stringify(samples[0].rect)), 'Animation keeps its layout stable');
      assert.ok(samples.every(sample => Math.abs(sample.centerOffset) < .1), 'Visible animation and label stay centered throughout the loop');
      await page.screenshot({ path: `checks/design-launch-${name}.png` });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.loading-228').evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
      assert.equal(await page.locator('.design-launch-card strong span').first().evaluate(el => getComputedStyle(el).animationName), 'none');
      console.log(`PASS ${name}: graphic and text share the same center throughout two cycles, no layout under 4x CPU throttling, native resolution and reduced motion`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
