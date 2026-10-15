const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/shared/auth.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export async function requireAuth() {} export const authState = () => ({ id: "11111111-1111-1111-1111-111111111111" });'); return; }
    if (url.pathname === '/slow-test.bin') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': 8 * 65536, 'Cache-Control': 'no-store' });
      let sent = 0;
      const timer = setInterval(() => { res.write(Buffer.alloc(65536, 65)); if (++sent === 8) { clearInterval(timer); res.end(); } }, 220);
      res.on('close', () => clearInterval(timer)); return;
    }
    if (url.pathname === '/missing-test.bin') { res.writeHead(404).end('missing'); return; }
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { res.setHeader('Content-Type', { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream'); res.end(await fs.readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  if (process.argv.includes('--serve')) { console.log('Workspace developer verification server: ' + base); return; }
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth() {} export const authState = () => ({ id: "11111111-1111-1111-1111-111111111111" });' }));
    await require('./project-test-server.cjs').installProjectFixture(context);
    const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const page = await context.newPage();
    await page.goto(base);
    await page.locator('#workspaceDeveloper').click();
    assert.equal(await page.locator('#workspaceLogExport').isDisabled(), true);
    await page.locator('#workspaceLogToggle').click();
    await page.locator('#workspaceLogStatus[data-recording=true]').waitFor();
    await page.locator('.workspace-dev-close').click();
    await page.screenshot({ path: 'checks/workspace-developer-home.png' });
    await page.mouse.move(320, 300); await page.mouse.down(); await page.mouse.move(450, 320, { steps: 8 }); await page.mouse.up();
    await page.mouse.dblclick(450, 320); await page.mouse.click(450, 320, { button: 'right' }); await page.keyboard.press('Escape');
    await page.mouse.wheel(0, 80);
    await page.locator('#workspaceDeveloper').click();
    await page.evaluate(() => { window.streamDone = fetch('/slow-test.bin?token=SECRET_TOKEN').then(async response => ({ length: (await response.arrayBuffer()).byteLength, url: response.url, type: response.type })); });
    await page.waitForFunction(() => parseFloat(document.getElementById('workspaceLogSpeed').textContent) > 0 && document.getElementById('workspaceLogContent').textContent.includes('slow-test.bin'));
    await page.screenshot({ path: 'checks/workspace-developer-panel.png' });
    const result = await page.evaluate(() => window.streamDone);
    assert.equal(result.length, 8 * 65536); assert.ok(result.url.includes('token=SECRET_TOKEN')); assert.equal(result.type, 'basic');
    await page.evaluate(async () => {
      const response = await fetch('/missing-test.bin'); if (response.status !== 404) throw new Error('HTTP status changed');
      const controller = new AbortController(); const aborted = fetch('/slow-test.bin?abort=1', { signal: controller.signal }).then(r => r.blob()).catch(e => e.name); setTimeout(() => controller.abort(), 350); await aborted;
      await new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.open('GET', '/slow-test.bin?xhr=1'); xhr.responseType = 'arraybuffer'; xhr.onload = () => xhr.response.byteLength === 8 * 65536 ? resolve() : reject(new Error('XHR content changed')); xhr.onerror = reject; xhr.send(); });
      const responseJson = await fetch('/assets/scenes/morning.json'); if (!(await responseJson.json()).scene) { /* Parsing must still work regardless of scene shape. */ }
    });
    // A second tab joins the same session and a page navigation keeps the log.
    const editor = await context.newPage(); await editor.goto(base + '/material-editor.html');
    await editor.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    await editor.locator('.workspace-log-indicator[data-recording=true]').waitFor();
    await editor.mouse.click(340, 280);
    await page.goto(base + '/asset-library.html');
    await page.locator('.workspace-log-indicator[data-recording=true]').click();
    assert.equal(await page.locator('#workspaceLogPage').textContent(), '资产库');
    await page.locator('#workspaceLogToggle').click();
    await page.locator('#workspaceLogStatus[data-recording=false]').waitFor();
    await editor.locator('.workspace-log-indicator[data-recording=false]').waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#workspaceLogExport').click()]);
    const csv = await fs.readFile(await download.path(), 'utf8');
    await fs.writeFile(path.join(root, 'checks/workspace-developer-sample.csv'), csv);
    for (const expected of ['当前页面', '当前鼠标动作', '下载速度 (KB/s)', '当前下载内容', '时间（含时区）', '工作空间', '材质编辑器', '资产库', '点击', '右键', '双击', '滚轮', 'slow-test.bin', '下载失败', '下载已取消', '结束记录']) assert.ok(csv.includes(expected), `CSV includes ${expected}`);
    assert.equal(csv.includes('SECRET_TOKEN'), false, 'Signed query parameters are omitted');
    assert.match(csv, /下载已完成[^\r\n]*524288/, 'Exact stream byte count is recorded');
    assert.match(csv, /状态采样,[^\r\n]*,[1-9]\d*\.\d+,[^\r\n]*slow-test.bin/, 'Live speed and active content are sampled together');
    const count = target => target.evaluate(async () => {
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open('spenic-workspace-diagnostics'); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
      const total = await new Promise(resolve => { const request = database.transaction('records').objectStore('records').count(); request.onsuccess = () => resolve(request.result); }); database.close(); return total;
    });
    const stoppedCount = await count(page);
    await editor.mouse.move(500, 400); await editor.mouse.click(500, 400);
    await page.waitForTimeout(1200); assert.equal(await count(page), stoppedCount, 'Stop disables recording in every tab');
    await page.reload(); await page.locator('.workspace-log-indicator').click();
    const [again] = await Promise.all([page.waitForEvent('download'), page.locator('#workspaceLogExport').click()]);
    assert.equal(await fs.readFile(await again.path(), 'utf8'), csv, 'Reload preserves the completed log');
    await page.goto(base); await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#workspaceDeveloper').click();
    const bounds = await page.locator('#workspaceDeveloperDialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'checks/workspace-developer-mobile.png' });
    await page.locator('#workspaceLogToggle').click(); await page.locator('#workspaceLogStatus[data-recording=true]').waitFor();
    await page.locator('#workspaceLogToggle').click(); await page.locator('#workspaceLogStatus[data-recording=false]').waitFor();
    const [fresh] = await Promise.all([page.waitForEvent('download'), page.locator('#workspaceLogExport').click()]);
    assert.equal((await fs.readFile(await fresh.path(), 'utf8')).includes('slow-test.bin'), false, 'Starting again replaces the old session');
    assert.deepEqual(errors, []);
    console.log('PASS: home entry, live streamed fetch and XHR bytes, abort/error, mouse actions, page navigation, shared tabs, CSV export, signed URL redaction, stop, reload persistence, restart and mobile layout');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
