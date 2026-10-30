const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.route(origin + '/**', async route => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname).slice(1);
      try {
        await route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(name)] || 'application/octet-stream', body: await fs.readFile(path.join(root, name)) });
      } catch { await route.fulfill({ status: 404, body: '' }); }
    });
    await require('./project-test-server.cjs').installProjectFixture(context);
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth(){document.documentElement.classList.remove("auth-pending");document.getElementById("authBootLoading")?.remove();} export const authState=()=>({id:"11111111-1111-1111-1111-111111111111"}); export const workspaceClient=async()=>(await import("./project-store.js")).fixtureAccess();' }));
    await context.route('**/app.js', async route => route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(root, 'app.js'), 'utf8') + `
      window.lightFixture = {
        read: () => ({ state: {...state}, position: key.position.toArray(), target: key.target.position.toArray(), shadow: key.shadow.matrix.elements.slice() }),
        apply: value => { daylightCycle.cancel(); Object.assign(state, value); applyScene(); },
        select: id => daylightCycle.select(id),
        transition: () => daylightCycle.next({ duration: 2600 }),
        loadScene: async file => { const {unpackScene}=await import('./shared/scene-file.js'); const saved=await unpackScene(new Blob([file])); daylightCycle.cancel(); Object.assign(state,saved.scene); applyScene(); }
      };` }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/design.html');
    const ready = () => page.waitForFunction(() => document.getElementById('loading').hidden && !document.getElementById('dayCycle').disabled, null, { timeout: 90000 });
    await ready();
    await page.locator('#restoreInspector').click();
    const read = () => page.evaluate(() => lightFixture.read());
    const initial = await read();
    const a = initial.state.lightAngle * Math.PI / 180;
    assert.ok(Math.abs(initial.position[0] - Math.sin(a) * 7) < 1e-10);
    assert.ok(Math.abs(initial.position[1] - 8) < 1e-10, 'Legacy scenes retain the original light position');
    assert.ok(Math.abs(initial.position[2] - Math.cos(a) * 7) < 1e-10);
    const setTilt = async degrees => {
      await page.locator('#lightElevation').fill(String(degrees));
      assert.equal(await page.locator('#lightElevationValue').textContent(), degrees + '°');
      const { state, position, target } = await read();
      const dx = position[0] - target[0], dy = position[1] - target[1], dz = position[2] - target[2];
      assert.ok(Math.abs(Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI - degrees) < 1e-8, 'Rendered light direction follows the slider');
      assert.ok(Math.abs(Math.hypot(dx, dy, dz) - Math.hypot(7, 7.5)) < 1e-10);
      assert.equal(state.lightAngle, initial.state.lightAngle, 'Tilt keeps the horizontal angle');
    };
    for (const degrees of [0, 25, 90]) {
      await setTilt(degrees);
      await page.waitForFunction(() => lightFixture.read().shadow.every(Number.isFinite));
    }
    await setTilt(25);
    await page.locator('#lightAngle').fill('70');
    assert.equal((await read()).state.lightElevation, 25, 'Horizontal rotation keeps the tilt');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#saveScene').click()]);
    const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.equal(exported.scene.lightElevation, 25);
    assert.equal(exported.scene.lightAngle, 70);
    await page.evaluate(() => lightFixture.select('night'));
    await page.evaluate(file => lightFixture.loadScene(file), JSON.stringify(exported));
    assert.equal((await read()).state.lightElevation, 25, 'Scene import restores the tilt');
    assert.equal(await page.locator('#lightElevationValue').textContent(), '25°');

    const { saveOnlineProject, openOnlineProject } = require('./project-roundtrip.cjs');
    const project = await saveOnlineProject(page);
    assert.equal(project.manifest.scene.lightElevation, 25);
    await openOnlineProject(page, project); await ready();
    assert.equal((await read()).state.lightElevation, 25, 'Project reload restores the tilt');
    await page.locator('#restoreInspector').click();
    await page.locator('#lightElevation').fill('35');
    await page.locator('#lightElevation').blur();
    await page.locator('.brand-logo').hover(); await page.keyboard.type('admin');
    await page.locator('#developerToggle').click();
    const developerTilt = page.locator('[data-dev-scene="lightElevation"]');
    await page.waitForFunction(() => document.querySelector('[data-dev-scene="lightElevation"]').value === '35');
    await developerTilt.fill('60');
    assert.equal((await read()).state.lightElevation, 60);
    assert.equal(await page.locator('#lightElevationValue').textContent(), '60°');
    await page.locator('#developerClose').click();

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => lightFixture.transition());
    await page.waitForFunction(() => lightFixture.read().state.lightElevation < 59 && lightFixture.read().state.lightElevation > 48);
    await page.locator('#lightElevation').fill('15');
    assert.equal(await page.locator('#dayCycle').getAttribute('data-transitioning'), 'false');
    assert.equal((await read()).state.lightElevation, 15, 'Manual tilt cancels the scene transition');
    await page.locator('#resetScene').click();
    assert.ok(Math.abs((await read()).position[1] - 8) < 1e-10, 'Reset restores the original tilt');
    await page.locator('#lightElevation').fill('25');
    await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'outputs/light-elevation-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#lightElevation').scrollIntoViewIfNeeded();
    const bounds = await page.locator('#lightElevation').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await page.locator('#lightElevation').focus(); await page.keyboard.press('ArrowRight');
    assert.equal((await read()).state.lightElevation, 26, 'Keyboard adjusts the tilt');
    await page.screenshot({ path: path.join(root, 'outputs/light-elevation-mobile.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: legacy light position, 0–90° direction, independent axes, export/import, project reload, developer controls, transition interruption, reset and mobile keyboard control.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
