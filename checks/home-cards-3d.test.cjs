const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const base = 'http://workspace.test';
const authFixture = `export const authState = () => ({ canManageSystemConfig: false }); export const workspaceClient = async () => null; export async function requireAuth() { document.documentElement.classList.remove('auth-pending'); document.getElementById('authBootLoading')?.remove(); }`;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const context = await browser.newContext({ viewport: { width: 1536, height: 730 } });
    await context.route(base + '/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/shared/auth.js') return route.fulfill({ contentType: 'text/javascript', body: authFixture });
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 403, body: '' });
      try {
        const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
        await route.fulfill({ contentType: type, body: await fs.readFile(file) });
      } catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    const card = page.locator('.material-card');
    const link = page.getByRole('link', { name: /材质编辑器/ });
    await link.waitFor({ state: 'visible' });
    const bounds = await link.boundingBox();
    await card.evaluate(el => {
      window.tiltChanges = [];
      new MutationObserver(records => {
        for (const record of records) {
          const before = (record.oldValue || '').split(/\s+/).includes('is-tilting');
          const after = el.classList.contains('is-tilting');
          if (before !== after) window.tiltChanges.push(after);
        }
      }).observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    });
    // A stationary pointer must stay hovered even when the lower edge lifts away.
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 1);
    await page.waitForTimeout(1400);
    assert.deepEqual(await page.evaluate(() => window.tiltChanges), [true], 'A stationary pointer at the lower edge must not toggle hover');
    assert.equal(await card.evaluate(el => el.classList.contains('is-tilting')), true);
    const steadyBounds = await link.boundingBox();
    assert.ok(Math.abs(steadyBounds.y - bounds.y) < .01 && Math.abs(steadyBounds.height - bounds.height) < .01, 'The link hit area stays fixed');

    // Sweep the lower edge and corners while the visual card is in motion.
    for (const fraction of [.1, .3, .5, .7, .9, .7, .5, .3, .1]) {
      await page.mouse.move(bounds.x + bounds.width * fraction, bounds.y + bounds.height - 1, { steps: 4 });
      await page.waitForTimeout(60);
    }
    assert.deepEqual(await page.evaluate(() => window.tiltChanges), [true]);
    const targetAtEdge = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href'), { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 1 });
    assert.equal(targetAtEdge, './material-editor.html', 'The lower edge remains a native clickable link');

    // Leaving starts the existing slow return once, without a delayed re-entry.
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height + 3);
    await page.waitForTimeout(80);
    const leaving = await card.evaluate(el => ({ active: el.classList.contains('is-tilting'), duration: getComputedStyle(el).transitionDuration, tilt: new DOMMatrix(getComputedStyle(el).transform).m23 }));
    assert.equal(leaving.active, false);
    assert.ok(leaving.duration.startsWith('0.6s'));
    assert.ok(Math.abs(leaving.tilt) > .001, 'Return is gradual');
    await page.waitForTimeout(750);
    assert.deepEqual(await page.evaluate(() => window.tiltChanges), [true, false]);
    assert.ok(Math.abs(await card.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m23)) < .0001);

    // Re-enter during the return; the tilt uses the unchanged hit area.
    await page.mouse.move(bounds.x + bounds.width * .85, bounds.y + bounds.height * .15);
    await page.waitForTimeout(50);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height + 3);
    await page.waitForTimeout(50);
    await page.mouse.move(bounds.x + bounds.width * .85, bounds.y + bounds.height * .15);
    const angles = await card.evaluate(el => ({ x: parseFloat(el.style.getPropertyValue('--card-rotate-x')), y: parseFloat(el.style.getPropertyValue('--card-rotate-y')) }));
    assert.ok(Math.abs(angles.x - 6.3) < .1 && Math.abs(angles.y - 8.4) < .1, JSON.stringify(angles));

    await page.mouse.move(768, 120);
    await link.focus();
    assert.equal(await card.evaluate(el => el.classList.contains('is-tilting')), false, 'Keyboard focus does not trigger tilt');
    if (process.env.WORKSPACE_CAPTURE_DIR) await page.screenshot({ path: path.join(process.env.WORKSPACE_CAPTURE_DIR, 'workspace-stable-hover.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await link.hover();
    assert.equal(await card.evaluate(el => getComputedStyle(el).transform), 'none');
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, cards: [...document.querySelectorAll('.workspace-card')].map(el => el.getBoundingClientRect().width), links: [...document.querySelectorAll('.workspace-cards a')].map(el => el.getBoundingClientRect().width) }));
    assert.equal(mobile.overflow, false);
    assert.equal(mobile.cards.length, 5);
    assert.ok(mobile.cards.every((width, i) => Math.abs(width - mobile.links[i]) < .01 && width > 300), JSON.stringify(mobile));
    if (process.env.WORKSPACE_CAPTURE_DIR) await page.screenshot({ path: path.join(process.env.WORKSPACE_CAPTURE_DIR, 'workspace-stable-hover-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: stationary lower edge, edge sweep, native link hit area, 0.6s return, re-entry, keyboard, reduced motion and mobile layout; no browser errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
