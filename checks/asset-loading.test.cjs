const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const designHtml = (await fs.readFile(path.join(root, 'design.html'), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      window.pendingAssets = []; window.previewJobs = []; window.decodeJobs = []; window.holdDecodes = true;
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = async function () {
        await decode.call(this);
        if (window.holdDecodes) await new Promise(resolve => window.decodeJobs.push({ id: this.closest('[data-asset-id]')?.dataset.assetId, resolve }));
      };
    });
    await context.route('http://loading.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (name === 'design.html') return route.fulfill({ contentType: 'text/html', body: designHtml });
      if (name === 'shared/asset-store.js') return route.fulfill({ contentType: 'text/javascript', body: `
        const image = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#679bd1"/></svg>'],{type:'image/svg+xml'});
        export const fixtures = [
          {id:'root',kind:'material',name:'根目录面料',updatedAt:4,thumbnail:image},
          {id:'folder',kind:'folder',library:'fabric',name:'面料文件夹',updatedAt:3},
          {id:'child',kind:'material',parentId:'folder',name:'文件夹面料',updatedAt:2,thumbnail:image},
          {id:'model',kind:'model',name:'模型',updatedAt:1},
          {id:'broken',kind:'material',materialType:'pattern',name:'损坏缩略图',updatedAt:1,thumbnail:new Blob(['invalid'],{type:'image/png'})}
        ];
        export function listAssets({onProgress}={}) {
          onProgress?.(fixtures.slice(0,1), {message:'正在加载'});
          return new Promise((resolve,reject)=>window.pendingAssets.push({resolve:()=>resolve(fixtures),empty:()=>resolve([]),reject:()=>reject(new Error('读取失败'))}));
        }
        export const getAsset=async()=>null, saveAsset=async()=>{}, deleteAsset=async()=>{};
      ` });
      if (name === 'shared/material-placement.js') return route.fulfill({ contentType: 'text/javascript', body: "export const materialType = a => a.materialType === 'pattern' ? 'pattern' : 'fabric';" });
      if (name === 'shared/model-preview.js') return route.fulfill({ contentType: 'text/javascript', body: `export function createModelPreview(){return new Promise(resolve=>window.previewJobs.push(()=>resolve(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="30" fill="#abc"/></svg>'],{type:'image/svg+xml'}))));}` });
      if (name === 'shared/material-package.js') return route.fulfill({ contentType: 'text/javascript', body: 'export const packMaterial=async()=>{}, unpackMaterial=async()=>{};' });
      try {
        await route.fulfill({ contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', body: await fs.readFile(path.join(root, name)) });
      } catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://loading.test/asset-library.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => pendingAssets.length === 1);
    assert.equal(await page.locator('#assetLoading').isVisible(), true);
    assert.equal(await page.locator('.asset-card').count(), 0, 'Incremental store results are not exposed');
    const animation = await page.locator('#assetLoading .asset-grid-loader').evaluate(el => {
      document.documentElement.style.setProperty('--blue', '#123456');
      const css = getComputedStyle(el), cell = getComputedStyle(el.firstElementChild);
      return { width: css.width, height: css.height, gap: css.gap, color: cell.backgroundColor, radius: cell.borderRadius, duration: cell.animationDuration, delays: [...el.children].map(child => getComputedStyle(child).animationDelay) };
    });
    assert.deepEqual(animation, { width:'98px',height:'98px',gap:'5.88px',color:'rgb(18, 52, 86)',radius:'3.92px',duration:'1.6s',delays:['0s','0.16s','0.32s','0.16s','0.32s','0.48s','0.32s','0.48s','0.64s'] });
    await page.evaluate(() => pendingAssets[0].resolve());
    await page.waitForFunction(() => decodeJobs.length === 2);
    assert.equal(await page.locator('#assetGrid').evaluate(el => el.inert && getComputedStyle(el).visibility === 'hidden'), true);
    await page.screenshot({ path: 'checks/asset-library-loading.png' });
    await page.evaluate(() => decodeJobs.splice(0).forEach(job => job.resolve()));
    await page.locator('[data-asset-id="root"]').waitFor();
    assert.equal(await page.locator('#assetLoading').isVisible(), false);
    await page.locator('[data-asset-id="folder"] .asset-art').click();
    await page.waitForFunction(() => decodeJobs.some(job => job.id === 'child'));
    await page.locator('#modelTab').click();
    await page.waitForFunction(() => previewJobs.length === 1);
    await page.evaluate(() => decodeJobs.splice(0).forEach(job => job.resolve()));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#assetLoading').isVisible(), true, 'A stale folder decode cannot reveal the model page');
    await page.evaluate(() => previewJobs.shift()());
    await page.waitForFunction(() => decodeJobs.some(job => job.id === 'model'));
    assert.equal(await page.locator('#assetLoading').isVisible(), true, 'Generated model previews also wait for image decoding');
    await page.evaluate(() => { holdDecodes = false; decodeJobs.splice(0).forEach(job => job.resolve()); });
    await page.locator('[data-asset-id="model"]').waitFor();
    await page.locator('#patternTab').click();
    await page.locator('[data-asset-id="broken"]').waitFor();
    assert.equal(await page.locator('#assetLoading').isVisible(), false, 'Broken previews settle without blocking the library');
    await page.locator('#assetSearch').fill('无匹配素材');
    await page.locator('#assetSearchForm').evaluate(form => form.requestSubmit());
    await page.locator('.asset-empty').waitFor();
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => pendingAssets.length === 2);
    await page.evaluate(() => pendingAssets[1].reject());
    await page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#status').textContent(), '读取失败');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.asset-grid-loader span').first().evaluate(el => getComputedStyle(el).animationName), 'none');

    const picker = await context.newPage();
    picker.on('pageerror', e => errors.push(e.message));
    await picker.goto('http://loading.test/design.html');
    await picker.evaluate(async () => {
      const { createDesignWorkspace } = await import('./design-workspace.js');
      window.notifications = [];
      createDesignWorkspace({ cancelPlacement(){},undo(){},showScene(){},notify(message){notifications.push(message);} });
      document.getElementById('materialDock').classList.remove('opening-hidden');
      document.getElementById('addDockAsset').click();
    });
    await picker.waitForFunction(() => pendingAssets.length === 1);
    assert.equal(await picker.locator('#pickerLoading').isVisible(), true);
    await picker.locator('#closeAssetPicker').click();
    await picker.evaluate(() => document.getElementById('addDockAsset').click());
    await picker.waitForFunction(() => pendingAssets.length === 2);
    await picker.evaluate(() => pendingAssets[0].resolve());
    assert.equal(await picker.locator('#pickerLoading').isVisible(), true);
    assert.equal(await picker.locator('.picker-card').count(), 0, 'A closed picker request cannot populate a new session');
    await picker.evaluate(() => pendingAssets[1].resolve());
    await picker.waitForFunction(() => decodeJobs.length === 1);
    assert.equal(await picker.locator('#pickerGrid').evaluate(el => el.inert), true);
    assert.equal(await picker.locator('#confirmAssetPicker').isDisabled(), true);
    await picker.screenshot({ path: 'checks/design-picker-loading.png' });
    await picker.evaluate(() => decodeJobs.splice(0).forEach(job => job.resolve()));
    await picker.locator('[data-asset-id="root"]').waitFor();
    await picker.locator('[data-asset-id="root"]').click();
    assert.equal(await picker.locator('#confirmAssetPicker').isEnabled(), true);
    await picker.locator('#closeAssetPicker').click();
    await picker.evaluate(() => document.getElementById('addDockAsset').click());
    await picker.waitForFunction(() => pendingAssets.length === 3);
    await picker.evaluate(() => pendingAssets[2].reject());
    await picker.waitForFunction(() => document.getElementById('assetPicker').getAttribute('aria-busy') === 'false');
    assert.deepEqual(await picker.evaluate(() => notifications), ['无法读取材质库：读取失败']);
    await picker.locator('#closeAssetPicker').click();
    await picker.evaluate(() => document.getElementById('addDockAsset').click());
    await picker.waitForFunction(() => pendingAssets.length === 4);
    await picker.evaluate(() => pendingAssets[3].empty());
    await picker.waitForFunction(() => document.getElementById('assetPicker').getAttribute('aria-busy') === 'false');
    assert.equal(await picker.locator('#pickerLoading').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS: themed 98px grid animation, final asset sync, thumbnails, model previews, stale navigation, picker reopen, empty/error results and reduced motion');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
