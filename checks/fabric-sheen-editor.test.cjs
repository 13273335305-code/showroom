const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/shared/auth.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end('export async function requireAuth(){ document.documentElement.classList.remove("auth-pending"); document.getElementById("authBootLoading")?.remove(); } export const authState = () => null;');
      return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
      res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
      const body = await fs.readFile(file);
      res.end(pathname === '/entries/material-editor.js' ? body.toString() + '\nwindow.sheenProbe = () => ({ camera, controls, scene, material, sheenBall, plane, currentAsset });' : body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('dialog', dialog => dialog.dismiss());
    await page.goto('http://127.0.0.1:' + server.address().port + '/material-editor.html');
    await page.waitForFunction(() => window.sheenProbe && !document.getElementById('saveMaterial').disabled);
    assert.equal(await page.locator('#roughnessValue').inputValue(), '0.98');
    assert.equal(await page.locator('#sheenValue').inputValue(), '0.10');
    assert.equal(await page.locator('#sheenRoughnessValue').inputValue(), '0.40');
    assert.equal(await page.locator('#fabricSheenControls input[type=range]').count(), 0);
    assert.equal(await page.locator('.fabric-sheen-hint').count(), 0);
    const verifyLayout = () => page.evaluate(() => {
      const a = document.getElementById('sheenValue').getBoundingClientRect();
      const b = document.getElementById('sheenRoughnessValue').getBoundingClientRect();
      const pane = document.getElementById('previewPane').getBoundingClientRect();
      const modes = document.getElementById('materialPreviewModes').getBoundingClientRect();
      const maps = document.getElementById('materialMaps').getBoundingClientRect();
      const sheen = document.getElementById('fabricSheenSection');
      return { atBottom: maps.bottom <= sheen.getBoundingClientRect().top && sheen === sheen.parentElement.lastElementChild, sameRow: Math.abs(a.top - b.top) < 1, separate: a.right < b.left, centered: Math.abs(modes.x + modes.width / 2 - pane.x - pane.width / 2) < 1, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.deepEqual(await verifyLayout(), { atBottom: true, sameRow: true, separate: true, centered: true, overflow: false });
    await page.locator('#sheenValue').fill('0.61');
    assert.equal(await page.evaluate(() => sheenProbe().material.sheen), .61);
    await page.locator('#sheenRoughnessValue').fill('0.42');
    await page.locator('#sheenRoughnessValue').press('Tab');
    assert.equal(await page.evaluate(() => sheenProbe().material.sheenRoughness), .42);
    await page.locator('#sheenValue').fill('2');
    await page.locator('#sheenValue').press('Tab');
    assert.equal(await page.locator('#sheenValue').inputValue(), '2.00');
    assert.equal(await page.evaluate(() => sheenProbe().material.sheen), 2);
    await page.locator('#sheenRoughnessValue').fill('0.5');
    await page.locator('#sheenRoughnessValue').press('Tab');
    assert.equal(await page.evaluate(() => sheenProbe().material.sheen), 2);
    await page.locator('#sheenValue').fill('3');
    await page.locator('#sheenValue').press('Tab');
    assert.equal(await page.locator('#sheenValue').inputValue(), '2.00');
    await page.locator('#sheenValue').fill('0.1');
    await page.locator('#sheenRoughnessValue').fill('0.4');
    await page.locator('#sheenRoughnessValue').press('Tab');
    const readView = () => page.evaluate(() => {
      const {camera, controls, scene, sheenBall} = sheenProbe();
      return {position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), target: controls.target.toArray(), ballRotation: sheenBall.quaternion.toArray(), lights: scene.children.filter(o => o.isLight).map(o => ({position: o.position.toArray(), quaternion: o.quaternion.toArray(), intensity: o.intensity})), environmentRotation: scene.environmentRotation.toArray()};
    });
    const flat = await readView();
    await page.getByRole('button', {name: '球体预览', exact: true}).click();
    await page.waitForFunction(() => sheenProbe().sheenBall.visible && sheenProbe().controls.enableRotate);
    const before = await readView(), canvas = await page.locator('#materialCanvas').boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width / 2 + 150, canvas.y + canvas.height / 2 + 50, {steps: 15}); await page.mouse.up();
    await page.waitForFunction(initial => sheenProbe().camera.position.distanceTo({x:initial[0],y:initial[1],z:initial[2]}) > 10, before.position);
    const orbited = await readView();
    assert.notDeepEqual(orbited.position, before.position);
    assert.deepEqual(orbited.ballRotation, before.ballRotation);
    assert.deepEqual(orbited.lights, before.lights);
    assert.deepEqual(orbited.environmentRotation, before.environmentRotation);
    await page.screenshot({path: path.join(root, 'checks/fabric-sheen-editor-desktop.png')});
    // Switch while damping is active: flat view must return without residual orbit.
    await page.getByRole('button', {name: '平铺预览', exact: true}).click();
    await page.evaluate(() => { for (let i = 0; i < 90; i++) sheenProbe().controls.update(); });
    const restored = await readView();
    flat.position.forEach((v, i) => assert.ok(Math.abs(v - restored.position[i]) < 1e-7));
    flat.quaternion.forEach((v, i) => assert.ok(Math.abs(v - restored.quaternion[i]) < 1e-7));
    assert.equal(await page.evaluate(() => sheenProbe().controls.enableRotate), false);
    const surface = await page.evaluate(() => sheenProbe().currentAsset().surface);
    assert.equal(surface.sheen, .1); assert.equal(surface.sheenRoughness, .4); assert.equal(surface.roughness, .98);
    await page.locator('[data-material-type=pattern]').click();
    assert.equal(await page.locator('#materialPreviewModes').isVisible(), false);
    assert.equal(await page.locator('#fabricSheenSection').isVisible(), false);
    await page.locator('[data-material-type=fabric]').click();
    await page.setViewportSize({width: 390, height: 844});
    assert.deepEqual(await verifyLayout(), { atBottom: true, sameRow: true, separate: true, centered: true, overflow: false });
    await page.getByRole('button', {name: '球体预览', exact: true}).click();
    await page.screenshot({path: path.join(root, 'checks/fabric-sheen-editor-mobile.png'), fullPage: true});
    assert.deepEqual(errors, []);
    console.log('PASS: sheen defaults, numeric-only row, validation, centered sphere switch, camera orbit with fixed lights, flat view restore, persistence and mobile layout');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => {console.error(error); process.exitCode = 1;});
