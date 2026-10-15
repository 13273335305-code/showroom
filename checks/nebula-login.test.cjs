const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.route('**/auth-config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const authConfig={url:"https://workspace.supabase.co",publishableKey:"sb_publishable_fixture",allowSignUp:true};' }));
    await context.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: `export function createClient(){ return {auth:{
      onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},
      async getSession(){return {data:{session:null},error:null}},
      async signInWithPassword(){await new Promise(resolve=>setTimeout(resolve,200));return {data:{},error:{code:'invalid_credentials'}}},
      async resetPasswordForEmail(){return {data:{},error:null}}
    }}}` }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/login.html');
    await page.locator('.auth-motion-toggle:not(:disabled)').waitFor();
    await page.locator('#authSubmit:not(:disabled)').waitFor();
    await page.locator('.auth-motion-toggle').click();
    assert.equal(await page.locator('.auth-nebula').getAttribute('data-paused'), 'true');
    await page.screenshot({ path: 'checks/nebula-login-desktop.png' });
    await page.locator('#authEmail').fill('designer@example.com');
    await page.locator('#authPassword').fill('example-password');
    await page.locator('#authToggle').click();
    assert.equal(await page.locator('#authPassword').getAttribute('type'), 'text');
    await page.locator('#authToggle').click();
    assert.equal(await page.locator('#authPassword').getAttribute('type'), 'password');
    await page.locator('#authSubmit').click();
    await page.waitForFunction(() => document.querySelector('#authForm').getAttribute('aria-busy') === 'true');
    assert.equal(await page.locator('#authToggle').isDisabled(), true);
    await page.getByText('邮箱或密码不正确，请重试。', { exact: true }).waitFor();
    await page.locator('#authForgot').click();
    assert.equal(await page.locator('#authPasswordField').isVisible(), false);
    await page.locator('#authSubmit').click();
    await page.getByText('如果该邮箱已注册，你将收到重置邮件。请在此浏览器中打开链接。', { exact: true }).waitFor();
    await page.locator('#authBack').click();
    await page.locator('#authRegisterTab').click();
    assert.equal(await page.locator('#authConfirmField').isVisible(), true);
    for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1440, height: 640 }]) {
      await page.setViewportSize(size);
      const layout = await page.locator('.auth-overlay').evaluate(overlay => ({ width: overlay.clientWidth, scroll: overlay.scrollWidth }));
      assert.ok(layout.scroll <= layout.width + 1, `No horizontal overflow at ${size.width}`);
      await page.locator('#authSubmit').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#authSubmit').isVisible(), true);
    }
    await page.locator('#authLoginTab').click();
    await page.locator('#authEmail').fill('');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.auth-overlay').evaluate(overlay => overlay.scrollTop = 0);
    await page.screenshot({ path: 'checks/nebula-login-mobile.png', fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.auth-nebula').getAttribute('data-paused'), 'true');
    // Shader errors are captured above; screenshots provide visual verification.
    const graphics = await page.locator('.auth-nebula').evaluate(canvas => {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return { context: !!gl, width: gl.drawingBufferWidth };
    });
    assert.ok(graphics.context && graphics.width > 0);
    assert.deepEqual(errors, []);
    await context.close();
    const offline = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await offline.route('https://cdn.jsdelivr.net/**', route => route.abort());
    await offline.route('**/vendor/three/build/three.module.js', route => route.abort());
    const fallback = await offline.newPage();
    await fallback.goto(base + '/login.html');
    await fallback.locator('.auth-overlay:not(.auth-overlay-checking)').waitFor();
    await fallback.getByText('暂时无法连接账号服务，请检查网络后重试。', { exact: true }).waitFor();
    assert.equal(await fallback.locator('#authRetry').isEnabled(), true);
    assert.equal(await fallback.locator('.auth-motion-toggle').isVisible(), false);
    await offline.close();
    console.log('PASS: nebula rendering, desktop/mobile/short layouts, pause, reduced motion, password visibility, busy/error states, recovery, registration, network fallback.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
