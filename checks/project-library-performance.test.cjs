const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';
const owner = '11111111-1111-1111-1111-111111111111';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'no-preference' });
      await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: `export async function requireAuth() {} export const authState = () => ({id:'${owner}'});` }));
      const state = await require('./project-test-server.cjs').installProjectFixture(context);
      const storeSource = await fs.readFile(path.join(__dirname, 'project-cloud-fixture.js'), 'utf8');
      await context.route('**/shared/project-store.js', route => route.fulfill({ contentType: 'text/javascript', body: storeSource.replace('async createSignedUrls(paths) {', `async createSignedUrls(paths) {
        (window.projectSignedBatches ||= []).push(paths);
        await new Promise(resolve => setTimeout(resolve, 300));
        if (window.failSigning) return {error:{message:'Temporary preview failure'}};`) }));
      const page = await context.newPage(), errors = [], reads = new Set();
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (request.method() === 'GET' && request.url().includes('/__cloud_test/objects/')) reads.add(decodeURIComponent(new URL(request.url()).pathname.split('/objects/')[1]));
      });
      await page.goto(base + '/login.html');
      const previews = await page.evaluate(async () => {
        const { createProjectThumbnail } = await import('./shared/project-thumbnail.js');
        const image = new Image(); image.src = './checks/model-runtime-1440.png'; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 3200; canvas.height = 2400;
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const original = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
        const small = await createProjectThumbnail(canvas), bitmap = await createImageBitmap(small);
        const landscape = [bitmap.width, bitmap.height]; bitmap.close();
        canvas.width = 900; canvas.height = 1800;
        const portraitBitmap = await createImageBitmap(await createProjectThumbnail(canvas));
        const portrait = [portraitBitmap.width, portraitBitmap.height]; portraitBitmap.close();
        canvas.width = 120; canvas.height = 90;
        const tinyBitmap = await createImageBitmap(await createProjectThumbnail(canvas));
        const tiny = [tinyBitmap.width, tinyBitmap.height]; tinyBitmap.close();
        return { small: [...new Uint8Array(await small.arrayBuffer())], original: [...new Uint8Array(await original.arrayBuffer())], landscape, portrait, tiny, type: small.type };
      });
      assert.deepEqual(previews.landscape, [640, 480]); assert.deepEqual(previews.portrait, [320, 640]);
      assert.deepEqual(previews.tiny, [120, 90]); assert.equal(previews.type, 'image/jpeg');
      assert.ok(previews.small.length < previews.original.length / 3);
      const small = Buffer.from(previews.small), original = Buffer.from(previews.original);
      function seed(id, name, options = {}) {
        const thumbnailPath = options.kind === 'folder' ? null : owner + '/' + id;
        state.projects.set(id, { id, owner_id: owner, kind: 'project', name, model_name: 'model.glb', parent_id: null, visibility: 'personal', created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z', thumbnail_path: thumbnailPath, ...options });
        if (thumbnailPath) state.objects.set(thumbnailPath, { body: id === 'root-119' ? original : small, type: 'image/jpeg' });
      }
      seed('folder', 'Collection', { kind: 'folder' });
      for (let index = 0; index < 120; index++) seed('root-' + index, 'Project ' + index, { updated_at: new Date(Date.UTC(2026, 9, 9, 0, 0, index)).toISOString() });
      for (let index = 0; index < 15; index++) seed('child-' + index, 'Child ' + index, { parent_id: 'folder' });
      for (let index = 0; index < 20; index++) seed('public-' + index, 'Public ' + index, { visibility: 'public' });
      await page.addInitScript(() => {
        window.holdProjectDecodes = true; window.pendingProjectDecodes = [];
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = async function () {
          await decode.call(this);
          if (this.closest('#projectGrid') && window.holdProjectDecodes) await new Promise(resolve => window.pendingProjectDecodes.push(resolve));
        };
      });
      const ready = () => page.waitForFunction(() => document.getElementById('projectPanel').getAttribute('aria-busy') === 'false');
      const release = async () => {
        await page.evaluate(() => { window.holdProjectDecodes = false; window.pendingProjectDecodes.splice(0).forEach(resolve => resolve()); });
        await ready();
      };
      await page.goto(base + '/project-library.html');
      await page.waitForFunction(() => window.projectSignedBatches?.length);
      assert.equal(await page.locator('.project-card').count(), 0, 'List waits for preview addresses before rendering');
      assert.equal(await page.locator('#projectLoading').isVisible(), true);
      await page.waitForFunction(() => window.pendingProjectDecodes.length > 0);
      assert.equal(await page.locator('#projectGrid .asset-card').count(), 30);
      assert.equal(await page.locator('#projectGrid').evaluate(grid => getComputedStyle(grid).visibility), 'hidden', 'Whole page stays hidden until all previews are decoded');
      assert.equal(await page.locator('#projectGrid').evaluate(grid => grid.inert), true);
      assert.equal(await page.locator('#projectLoading .asset-grid-loader span').first().evaluate(element => getComputedStyle(element).animationName), 'asset-grid-pulse');
      await page.screenshot({ path: `checks/project-library-loading-${viewport.width}.png` });
      await release();
      assert.equal(await page.locator('#projectLoading').isVisible(), false);
      const initial = await page.evaluate(() => ({ signed: window.projectSignedBatches.flat(), loaded: [...document.querySelectorAll('.project-card img')].filter(image => image.naturalWidth).length }));
      assert.equal(initial.loaded, 29, 'All projects on the current page load without scrolling');
      assert.equal(initial.signed.length, 155);
      assert.equal(reads.has(owner + '/root-0'), false, 'Other pages do not download images');
      assert.ok(reads.has(owner + '/root-91'), 'Offscreen card on the current page loads before scrolling');
      assert.equal(await page.locator('.project-card img').evaluateAll(images => images.every(image => image.loading === 'eager')), true);
      assert.ok(initial.signed.includes(owner + '/child-0'), 'Folder uses its saved child previews');
      await page.evaluate(async () => {
        await Promise.all([...document.querySelectorAll('.asset-art img')].map(image => image.decode()));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      if (viewport.width < 700) {
        const brand = await page.locator('.asset-brand').boundingBox(), search = await page.locator('.asset-search').boundingBox();
        assert.ok(search.y >= brand.y + brand.height, 'Mobile search does not overlap the project library title');
      }
      await page.screenshot({ path: `checks/project-library-performance-${viewport.width}.png` });
      await page.evaluate(() => { const main = document.querySelector('.library-main'); main.scrollTop = main.scrollHeight; });
      assert.equal(await page.evaluate(() => window.projectSignedBatches.flat().length), initial.signed.length, 'Scrolling does not trigger preview signing');
      await page.evaluate(() => { window.holdProjectDecodes = true; });
      await page.getByRole('button', { name: '下一页', exact: true }).click();
      await page.waitForFunction(() => window.pendingProjectDecodes.length > 0);
      assert.equal(await page.locator('#projectGrid').evaluate(grid => getComputedStyle(grid).visibility), 'hidden');
      assert.equal(await page.locator('#projectLoading').isVisible(), true);
      await release();
      assert.equal(await page.locator('.project-card').count(), 30);
      assert.equal(await page.locator('#projectPagination [aria-current="page"]').textContent(), '2');
      await page.locator('#projectMoreOptions').click(); await page.locator('#selectAllProjects').click(); await ready();
      assert.equal(await page.locator('.project-card.selected').count(), 30, 'Select all targets only the current page');
      await page.getByRole('button', { name: '第 5 页', exact: true }).click(); await ready();
      assert.equal(await page.locator('.project-card').count(), 1);
      assert.ok(reads.has(owner + '/root-0'), 'Changing pages loads that page immediately');
      await page.locator('#projectSort').selectOption('oldest');
      await ready();
      assert.equal(await page.locator('#projectPagination [aria-current="page"]').textContent(), '1');
      const afterSort = await page.evaluate(() => window.projectSignedBatches.flat());
      assert.equal(new Set(afterSort).size, afterSort.length, 'Sorting reuses signed URLs for already loaded resources');
      await page.locator('#projectSearch').fill('Project 119');
      await ready(); assert.equal(await page.locator('.project-card').count(), 1);
      await page.waitForFunction(() => document.querySelector('.project-card img')?.naturalWidth === 3200);
      await page.locator('#projectSearch').fill(''); await ready();
      await page.locator('[data-project-id="folder"]').click();
      await ready(); assert.equal(await page.locator('.project-card').count(), 15);
      await page.locator('#projectBreadcrumb button').first().click(); await ready();
      assert.equal(await page.locator('#projectGrid .asset-card').count(), 30);
      await page.locator('[data-project-view="public"]').click();
      await ready(); assert.equal(await page.locator('.project-card').count(), 20);
      await page.waitForFunction(() => [...document.querySelectorAll('.project-card img')].every(image => image.complete && image.naturalWidth === 640));
      await page.evaluate(() => {
        window.failSigning = true;
        const time = Date.now() + 3300000;
        Date.now = () => time;
      });
      await page.locator('#projectMoreOptions').click(); await page.locator('#refreshProjects').click();
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('读取项目库失败'));
      await ready();
      await page.evaluate(() => { window.failSigning = false; });
      await page.locator('#projectMoreOptions').click(); await page.locator('#refreshProjects').click();
      await ready();
      assert.equal(await page.locator('#status').textContent(), '');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      await page.locator('#projectSearch').fill('No matching project'); await ready();
      assert.equal(await page.locator('#projectEmpty').isVisible(), true);
      assert.equal(await page.locator('#projectLoading').isVisible(), false);
      assert.equal(await page.locator('#projectPagination').isVisible(), false);
      console.log(JSON.stringify({ viewport: viewport.width, firstPageCards: 30, loadedWithoutScrolling: initial.loaded, projects: state.projects.size, originalBytes: original.length, thumbnailBytes: small.length }));
      await context.close();
    }
    console.log('Project library checks passed: shared CSS loader, whole-page reveal, pagination, eager loading, URL reuse, folders, search, visibility, failure recovery, desktop/mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
