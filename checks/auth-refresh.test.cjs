const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer(async (req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
      res.setHeader('Content-Type', { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        window.sessionGate = new Promise(resolve => { window.releaseSession = resolve; });
      });
      await context.route('**/auth-config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const authConfig={url:"https://workspace.supabase.co",publishableKey:"sb_publishable_fixture",allowSignUp:true};' }));
      await context.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: [
        'export function createClient(){return {auth:{',
        'onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},',
        'async getSession(){await window.sessionGate;return {data:{session:window.fixtureAuthenticated?{access_token:"fixture",expires_at:4102444800,user:{id:"fixture"}}:null},error:null}},',
        'async getUser(){return {data:{user:{id:"fixture",email:"fixture@example.com"}},error:null}}',
        '}}}'
      ].join('') }));
      // Keep production HTML, styles and auth lifecycle; skip unrelated app startup.
      await context.route('**/entries/**', route => route.fulfill({ contentType: 'text/javascript', body: "import { requireAuth } from '../shared/auth.js'; await requireAuth();" }));
      await context.route('**/shared/workspace-developer.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
      await context.route('**/shared/upload-queue.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export function startUploadQueue(){}' }));
      for (const file of ['index.html', 'design.html', 'material-editor.html', 'asset-library.html', 'project-library.html', 'model-parts.html']) {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        let releaseModule;
        const moduleGate = new Promise(resolve => { releaseModule = resolve; });
        await page.route('**/shared/auth.js', async route => { await moduleGate; await route.continue(); });
        await page.goto(base + '/' + file, { waitUntil: 'commit' });
        const content = page.locator('body > header, body > main').first();
        await content.waitFor({ state: 'attached' });
        assert.equal(await content.isVisible(), false, file + ': content hidden before auth downloads');
        assert.equal(await page.locator('#authBootLoading .auth-intro-hello').count(), 0, file + ': no Hello before auth module downloads');
        releaseModule();
        await page.locator('#authOverlay').waitFor({ state: 'attached' });
        assert.equal(await content.isVisible(), false, file + ': hidden during session check');
        assert.equal(await page.locator('#authOverlay .auth-intro-hello').isVisible(), false, file + ': checking a session never shows Hello');
        await page.evaluate(() => window.releaseSession());
        await page.waitForFunction(() => document.querySelector('#authOverlay')?.dataset.authIntro === 'complete');
        assert.equal(await content.isVisible(), false, file + ': hidden behind login');
        assert.equal(await page.locator('#authSubmit').isVisible(), true);
        assert.equal(await page.locator('#authEmail').evaluate(element => {
          const rect = element.getBoundingClientRect();
          return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element;
        }), true, file + ': login input is above the Hello cover and accepts clicks');
        assert.equal(await page.locator('#authBootLoading').count(), 0, file + ': initial Hello cover is gone');
        assert.equal(await page.locator('#authOverlay .auth-intro-hello').textContent(), 'Hello', file + ': login retains its own greeting');
        await page.reload();
        await page.locator('#authOverlay').waitFor({ state: 'attached' });
        assert.equal(await content.isVisible(), false, file + ': reload does not expose content');
        assert.equal(await page.locator('#authBootLoading .auth-intro-hello').count(), 0, file + ': refresh cover has no Hello');
        assert.equal(await page.locator('#authOverlay .auth-intro-hello').isVisible(), false, file + ': login greeting stays hidden while restoring a session');
        await page.evaluate(() => { window.fixtureAuthenticated = true; window.releaseSession(); });
        await page.waitForFunction(() => !document.documentElement.classList.contains('auth-pending'));
        assert.equal(await content.isVisible(), true, file + ': verified session reveals content');
        assert.equal(await page.locator('.auth-intro-hello').count(), 0, file + ': verified workspace never enters the login intro');
        assert.equal(await page.locator('#authOverlay').count(), 0);
        assert.deepEqual(errors, []);
        await page.close();
        console.log('PASS ' + width + 'px ' + file + ': deferred auth, session check, login, reload, verified reveal');
      }
      const page = await context.newPage();
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await page.reload(); else await page.goto(base + '/login.html');
        await page.waitForFunction(() => document.querySelector('#authOverlay')?.dataset.authIntro === 'complete');
        assert.equal(await page.locator('body > :not(#authOverlay):not(script):not(#authBootLoading)').count(), 0);
        assert.equal(await page.locator('#authSubmit').isVisible(), true);
      }
      await page.close(); await context.close();
      console.log('PASS ' + width + 'px login.html: repeated refresh stays on login');
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
