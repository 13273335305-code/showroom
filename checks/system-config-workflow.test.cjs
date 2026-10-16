const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const html = (await fs.readFile(path.join(root, 'index.html'), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace('home-page-root auth-pending', 'home-page-root').replace(/<div id="authBootLoading"[^>]*><\/div>/, '')
    .replace('</body>', '<script type="module" src="shared/system-config.js"></script></body>');
  let saved = null, failSave = false;
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [];
  try {
    async function context() {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.route('http://settings.test/**', async route => {
        const name = new URL(route.request().url()).pathname.slice(1);
        if (!name || name === 'index.html') return route.fulfill({ contentType: 'text/html', body: html });
        if (name === 'shared/auth.js') return route.fulfill({ contentType: 'text/javascript', body: `export async function workspaceClient(){return {client:{from(){let value;return {select(){return this},eq(){return this},upsert(row){value=row.colors;return this},async maybeSingle(){return (await fetch('/__colors')).json()},async single(){return (await fetch('/__colors',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).json()}}}}}}` });
        if (name === '__colors') {
          if (route.request().method() === 'POST') {
            if (failSave) return route.fulfill({ json: { error: { code: '42501' } } });
            saved = route.request().postDataJSON();
          }
          return route.fulfill({ json: { data: saved ? { colors: saved } : null } });
        }
        try { return route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : 'image/png', body: await fs.readFile(path.join(root, name)) }); }
        catch { return route.fulfill({ status: 404, body: '' }); }
      });
      context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
      return context;
    }
    const first = await context(), page = await first.newPage();
    const open = async page => {
      await page.locator('#systemConfigEntry').click();
      assert.equal(await page.locator('.system-config-slot').count(), 9);
      assert.equal(await page.locator('.system-config-slot:disabled').count(), 8);
      await page.getByRole('button', { name: '色号球配置', exact: true }).click();
      await page.locator('.system-color-edit:not(:disabled)').first().waitFor();
    };
    await page.goto('http://settings.test/'); await open(page);
    assert.equal(await page.locator('.system-color-row').count(), 8);
    assert.equal(await page.locator('.system-color-code').count(), 8);
    assert.equal(await page.locator('.system-color-number').count(), 0);
    assert.equal(await page.locator('#systemColorRows input').count(), 0, 'Rows initially display read-only values');
    await page.getByRole('button', { name: '编辑色号 WBK', exact: true }).click();
    await page.getByRole('textbox', { name: '第 1 行底色 HEX', exact: true }).fill('#123456');
    await page.locator('.system-color-cancel').click();
    assert.equal(await page.locator('.system-color-row').first().locator('.system-color-hex').first().textContent(), '#f6f6f6');
    assert.equal(saved, null, 'Cancel never publishes a row');
    await page.screenshot({ path: 'checks/system-config-desktop.png' });
    // A consumer already open before saving uses the shared swatch renderer.
    const consumer = await first.newPage(); await consumer.goto('http://settings.test/');
    await consumer.evaluate(async () => {
      const { updateFabricColorSwatch } = await import('./shared/fabric-color-swatch.js');
      const ball = document.createElement('span'); ball.id = 'consumerSwatch'; ball.className = 'fabric-color-swatch';
      document.body.append(ball); updateFabricColorSwatch(ball, 'ABC'); ball.removeAttribute('title');
    });
    await page.locator('#systemColorAdd').click();
    await page.getByRole('textbox', { name: '第 9 行色号', exact: true }).fill('abc');
    await page.getByRole('textbox', { name: '第 9 行底色 HEX', exact: true }).fill('#123456');
    await page.getByRole('textbox', { name: '第 9 行线色 HEX', exact: true }).fill('#abcdef');
    assert.equal(saved, null, 'Draft changes are not published');
    await page.locator('.system-color-confirm').click();
    await page.getByText('已保存 ABC，全站色号球已更新', { exact: true }).waitFor();
    assert.deepEqual(saved.at(-1), { code: 'ABC', base: '#123456', line: '#abcdef' });
    await consumer.waitForFunction(() => document.getElementById('consumerSwatch').style.getPropertyValue('--fabric-swatch-base') === '#123456');
    assert.equal(await consumer.locator('#consumerSwatch').getAttribute('title'), null, 'Silent swatches retain their no-tooltip behavior');
    // Separate browser storage still reads the same saved global configuration.
    const second = await context(), other = await second.newPage(); await other.goto('http://settings.test/'); await open(other);
    assert.equal(await other.locator('.system-color-code').nth(8).textContent(), 'ABC');
    await other.reload(); await open(other);
    assert.equal(await other.locator('.system-color-row').nth(8).locator('.system-color-hex').first().textContent(), '#123456');
    await page.getByRole('button', { name: '编辑色号 ABC', exact: true }).click();
    await page.getByRole('textbox', { name: '第 9 行色号', exact: true }).fill('WBK'); await page.locator('.system-color-confirm').click();
    await page.getByText(/色号 WBK 重复/).waitFor(); assert.equal(saved.at(-1).code, 'ABC');
    await page.getByRole('textbox', { name: '第 9 行色号', exact: true }).fill('ABC');
    await page.getByRole('textbox', { name: '第 9 行线色 HEX', exact: true }).fill('#zzz'); await page.locator('.system-color-confirm').click();
    await page.getByText(/须为六位 HEX/).waitFor(); assert.equal(saved.at(-1).line, '#abcdef');
    await page.getByRole('textbox', { name: '第 9 行线色 HEX', exact: true }).fill('#111111');
    failSave = true; await page.locator('.system-color-confirm').click(); await page.getByText(/当前账号没有修改全站配置/).waitFor();
    assert.equal(saved.at(-1).line, '#abcdef'); failSave = false;
    await page.keyboard.press('Escape'); await page.locator('#systemConfigKeep').waitFor(); await page.locator('#systemConfigKeep').click();
    assert.equal(await page.locator('#systemConfigDialog').evaluate(el => el.open), true);
    await page.locator('#systemConfigBack').click(); await page.locator('#systemConfigLeave').click();
    await page.getByRole('button', { name: '色号球配置', exact: true }).click(); await page.locator('.system-color-edit:not(:disabled)').first().waitFor();
    assert.equal(await page.locator('.system-color-row').nth(8).locator('.system-color-hex').nth(1).textContent(), '#abcdef');
    await page.locator('#systemColorAdd').click(); await page.locator('.system-color-cancel').click();
    assert.equal(await page.locator('.system-color-row').count(), 9, 'Cancel discards the added row');
    await page.locator('#systemColorAdd').click(); assert.equal(await page.locator('.system-color-row').count(), 10);
    await page.getByRole('textbox', { name: '第 10 行色号', exact: true }).fill('XYZ');
    await page.locator('.system-color-confirm').click(); await page.getByText('已保存 XYZ，全站色号球已更新', { exact: true }).waitFor();
    for (const width of [390, 820, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 740 : 1000 });
      await page.locator('#systemConfigColors').evaluate(el => el.scrollIntoView());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('#systemConfigDialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      const hex = page.locator('.system-color-row').nth(8).locator('.system-color-hex').first();
      assert.ok((await hex.boundingBox()).width >= 40, 'HEX inputs remain legible');
      await page.screenshot({ path: `checks/system-config-${width}.png` });
      if (width === 390) {
        const scrollbar = page.locator('#systemConfigScrollbar'); await scrollbar.waitFor({ state: 'visible' });
        const track = await scrollbar.boundingBox();
        await page.mouse.click(track.x + track.width / 2, track.y + track.height - 8);
        assert.ok(await page.locator('#systemConfigScroll').evaluate(element => element.scrollTop > 0));
      }
    }
    await page.locator('#systemConfigBack').click(); await page.screenshot({ path: 'checks/system-config-menu.png' });
    assert.deepEqual(errors, []);
    console.log('System configuration workflow passed: nine slots, configured rows without placeholders, live preview, validation, confirmed global save, cross-tab update, independent browser persistence, unsaved changes, ten colors and responsive layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
