const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      await context.route('**/auth-config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const authConfig = {url:"https://workspace.supabase.co",publishableKey:"sb_publishable_fixture"};' }));
      await context.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: 'export function createClient() { return {auth: window.authFixture}; }' }));
      await context.route('**/login.html?**', route => route.fulfill({ contentType: 'text/html', body: '<title>Login fixture</title>' }));
      await context.route('**/auth-verification-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
        <html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="login.css"></head>
        <body><main>Workspace fixture</main><script>
        window.remoteChecks = 0; window.authTime = 100000; window.focusTime = 0;
        Date.now = () => window.authTime;
        Object.defineProperty(performance, 'now', {value: () => window.focusTime});
        window.session = {access_token:'token',expires_at:10000,user:{id:'server-user'}};
        window.authFixture = {
          onAuthStateChange(fn) { window.emitAuth = event => fn(event, window.session); return {data:{subscription:{unsubscribe(){}}}}; },
          async getSession() { return {data:{session:window.session},error:null}; },
          async getUser() {
            window.remoteChecks++;
            if (window.authFailure === 'network') throw new Error('Failed to fetch');
            if (window.authFailure === 'revoked') return {data:{},error:{status:401,code:'bad_jwt'}};
            return {data:{user:{id:'server-user',email:'fixture@example.com'}},error:null};
          },
          async signOut() { window.session = null; window.emitAuth('SIGNED_OUT'); return {data:{},error:null}; }
        };
        </script><script type="module">
        window.authModule = await import('./shared/auth.js');
        await window.authModule.requireAuth(); window.authReady = true;
        </script></body></html>` }));
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/auth-verification-fixture.html`);
      await page.waitForFunction(() => window.authReady);
      assert.equal(await page.evaluate(() => window.remoteChecks), 1);
      await page.evaluate(async () => {
        await Promise.all(Array.from({ length: 20 }, () => window.authModule.workspaceClient()));
        for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('focus'));
      });
      assert.equal(await page.evaluate(() => window.remoteChecks), 1);
      await page.evaluate(async () => {
        window.authTime += 45000;
        await Promise.all(Array.from({ length: 20 }, () => window.authModule.workspaceClient()));
      });
      assert.equal(await page.evaluate(() => window.remoteChecks), 2);
      await page.evaluate(() => {
        window.authFailure = 'network'; window.focusTime += 16000;
        window.emitAuth('TOKEN_REFRESHED'); window.dispatchEvent(new Event('focus'));
      });
      await page.locator('.auth-verification-notice').waitFor();
      assert.match(page.url(), /auth-verification-fixture/);
      assert.equal(await page.evaluate(() => window.authModule.isAuthenticated()), true);
      for (let i = 0; i < 10; i++) await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(await page.evaluate(() => window.remoteChecks), 3);
      const box = await page.locator('.auth-verification-notice').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1);
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1);
      await page.screenshot({ path: `checks/auth-verification-${viewport.width}.png` });
      await page.evaluate(() => { window.authFailure = null; });
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await page.locator('.auth-verification-notice').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.remoteChecks), 4);
      await page.evaluate(() => {
        window.authFailure = 'revoked'; window.focusTime += 16000;
        window.emitAuth('TOKEN_REFRESHED'); window.dispatchEvent(new Event('focus'));
      });
      await page.waitForURL('**/login.html?**');
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Auth browser checks passed: verification reuse, focus throttling, network retry, revocation, desktop/mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
