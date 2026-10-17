const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { installProjectFixture } = require('./project-test-server.cjs');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';
const alice = '11111111-1111-1111-1111-111111111111', bob = '22222222-2222-2222-2222-222222222222';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const rows = new Map(), objects = new Map(), errors = [], calls = [];
  let failUpload = false, failList = false;
  async function setup(userId, viewport = { width: 1440, height: 1000 }) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addInitScript(id => { window.albumTestUser = id; }, userId);
    await installProjectFixture(context);
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: [
      "import { client } from '../checks/album-cloud-fixture.js';",
      'export const authState = () => ({id: window.albumTestUser});',
      'export async function workspaceClient() { return {client, userId: window.albumTestUser}; }',
      "export async function requireAuth() { document.documentElement.classList.remove('auth-pending'); document.getElementById('authBootLoading')?.remove(); return authState(); }"
    ].join('\n') }));
    await context.route('**/__album_test/**', async route => {
      const req = route.request(), url = new URL(req.url()), name = url.pathname.slice('/__album_test/'.length);
      if (name.startsWith('object/')) {
        const parts = name.slice(7).split('/'), bucket = parts.shift(), objectPath = parts.join('/');
        const actor = req.headers()['x-test-user']; calls.push({ method: req.method(), path: objectPath, bucket });
        if (actor !== objectPath.split('/')[0]) return route.fulfill({ status: 403, json: { error: { code: '42501' } } });
        if (req.method() === 'PUT') {
          if (failUpload) return route.fulfill({ json: { error: { message: '测试上传失败' } } });
          objects.set(bucket + '/' + objectPath, req.postDataBuffer()); return route.fulfill({ json: { data: { path: objectPath } } });
        }
        const bytes = objects.get(bucket + '/' + objectPath);
        return bytes ? route.fulfill({ contentType: 'image/png', body: bytes }) : route.fulfill({ status: 404 });
      }
      if (name === 'preview') {
        const objectPath = url.searchParams.get('path');
        if (!objectPath.startsWith(url.searchParams.get('user') + '/')) return route.fulfill({ status: 403 });
        const bytes = objects.get('spenic-album-photos/' + objectPath);
        return bytes ? route.fulfill({ contentType: 'image/png', body: bytes }) : route.fulfill({ status: 404 });
      }
      const payload = req.postDataJSON(), actor = payload.userId;
      if (name === 'query') {
        if (payload.operation === 'insert') {
          const row = payload.query.row;
          if (row.owner_id !== actor) return route.fulfill({ json: { error: { code: '42501' } } });
          const next = { ...row, created_at: new Date().toISOString() }; rows.set(row.id, next);
          return route.fulfill({ json: { data: next } });
        }
        if (failList && payload.operation === 'select' && !payload.query.single) return route.fulfill({ json: { error: { message: '测试读取失败' } } });
        const selected = [...rows.values()].filter(row => row.owner_id === actor && Object.entries(payload.filters).every(([key, value]) => row[key] === value)).sort((a, b) => b.created_at.localeCompare(a.created_at));
        if (payload.operation === 'delete') selected.forEach(row => rows.delete(row.id));
        const data = payload.query.single ? selected[0] || null : selected.slice(payload.query.start || 0, (payload.query.end ?? 199) + 1);
        return route.fulfill({ json: { data } });
      }
      if (name === 'sign') {
        assert.equal(payload.expires, 300);
        return route.fulfill({ json: { data: payload.paths.map(p => p.startsWith(actor + '/') ? { path: p, signedUrl: base + '/__album_test/preview?user=' + actor + '&path=' + encodeURIComponent(p) } : { path: p, error: 'Denied' }) } });
      }
      if (name === 'remove') {
        payload.paths.filter(p => p.startsWith(actor + '/')).forEach(p => objects.delete(payload.bucket + '/' + p));
        return route.fulfill({ json: { data: [] } });
      }
      return route.fulfill({ status: 404 });
    });
    context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
    return context;
  }
  const ready = page => page.waitForFunction(() => document.getElementById('albumGrid').getAttribute('aria-busy') === 'false');
  try {
    const owner = await setup(alice), home = await owner.newPage();
    await home.goto(base + '/index.html'); await home.locator('.album-card-home').waitFor();
    assert.equal(await home.locator('.workspace-card').count(), 5);
    for (const size of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      await home.setViewportSize(size); await home.locator('.album-card-home').scrollIntoViewIfNeeded();
      assert.ok(await home.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const box = await home.locator('.album-card-home').boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= size.height + 1);
    }
    await home.setViewportSize({ width: 1440, height: 1000 });
    const design = await owner.newPage(), downloads = [];
    design.on('download', d => downloads.push(d));
    await design.goto(base + '/design.html?new=1');
    await design.waitForFunction(() => document.getElementById('loading').hidden && !document.getElementById('dayCycle').disabled, null, { timeout: 90000 });
    await design.locator('#snapshot').click();
    await design.waitForFunction(() => document.body.classList.contains('capture-frame-settled'));
    await design.locator('#captureTransparent').check();
    await design.locator('#captureShoot').click();
    await design.waitForFunction(() => document.getElementById('toast').textContent.includes('已保存到云端图册'), null, { timeout: 60000 });
    assert.equal(downloads.length, 0, 'Capture uploads without a browser download');
    assert.equal(rows.size, 1); assert.equal(objects.size, 2);
    const first = [...rows.values()][0]; assert.equal(first.owner_id, alice); assert.equal(first.transparent, true);
    assert.equal(await design.locator('#captureShoot').isEnabled(), true);
    assert.ok(calls.filter(c => c.method === 'PUT').every(c => c.bucket === 'spenic-album-photos'));
    const original = objects.get('spenic-album-photos/' + first.image_path);
    const thumbnail = objects.get('spenic-album-photos/' + first.thumbnail_path);
    assert.equal(thumbnail.readUInt32BE(16), 400);
    assert.equal(thumbnail.readUInt32BE(20), 300);
    const pixels = await design.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = 0, opaque = 0;
      for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) transparent++; if (data[i] === 255) opaque++; }
      return { width: canvas.width, height: canvas.height, transparent, opaque };
    }, [...original]);
    assert.equal(pixels.width, 1920); assert.equal(pixels.height, 1080); assert.ok(pixels.transparent > 0 && pixels.opaque > 0);
    failUpload = true;
    await design.locator('#captureShoot').click();
    await design.waitForFunction(() => document.getElementById('toast').textContent.includes('测试上传失败'));
    assert.equal(rows.size, 1); assert.equal(downloads.length, 0); assert.equal(await design.locator('#captureShoot').isEnabled(), true);
    failUpload = false;
    await design.locator('#captureTransparent').uncheck();
    await design.locator('#captureWidth').fill('800'); await design.locator('#captureHeight').fill('600');
    await design.locator('#captureShoot').click();
    await design.waitForFunction(() => document.getElementById('toast').textContent.includes('已保存到云端图册'));
    assert.equal(rows.size, 2); assert.equal(downloads.length, 0);
    const album = await owner.newPage(); await album.goto(base + '/album.html'); await ready(album);
    assert.equal(await album.locator('.album-card').count(), 2); assert.equal(await album.locator('#albumEmpty').isVisible(), false);
    assert.equal(await album.locator('.tool-trigger,.tool-switcher-menu').count(), 0);
    assert.equal(calls.filter(c => c.method === 'GET').length, 0, 'Listing never downloads full originals');
    await album.screenshot({ path: 'checks/album-desktop.png', fullPage: true });
    const albumDownloads = []; album.on('download', file => albumDownloads.push(file));
    await album.locator('.album-preview').last().click();
    await album.waitForFunction(() => !document.getElementById('albumOriginalDownload').disabled);
    assert.equal(await album.locator('#albumPreviewDialog').evaluate(dialog => dialog.open), true);
    assert.deepEqual(await album.locator('#albumOriginalImage').evaluate(image => [image.naturalWidth, image.naturalHeight]), [1920, 1080]);
    assert.equal(albumDownloads.length, 0, 'Opening an original preview does not download a file');
    await album.screenshot({ path: 'checks/album-original-preview.png', fullPage: true });
    const [previewDownload] = await Promise.all([album.waitForEvent('download'), album.locator('#albumOriginalDownload').click()]);
    assert.deepEqual(await fs.readFile(await previewDownload.path()), original);
    await album.keyboard.press('Escape');
    await album.waitForFunction(() => !document.getElementById('albumPreviewDialog').open);
    assert.equal(await album.locator('#albumOriginalImage').getAttribute('src'), null);
    const [downloaded] = await Promise.all([album.waitForEvent('download'), album.locator('.album-preview-download').last().click()]);
    assert.equal(await album.locator('#albumPreviewDialog').evaluate(dialog => dialog.open), false);
    assert.equal(downloaded.suggestedFilename(), first.name + '.png');
    assert.deepEqual(await fs.readFile(await downloaded.path()), original);
    await album.reload(); await ready(album); assert.equal(await album.locator('.album-card').count(), 2);
    const otherDevice = await setup(alice), restored = await otherDevice.newPage();
    await restored.goto(base + '/album.html'); await ready(restored); assert.equal(await restored.locator('.album-card').count(), 2);
    const stranger = await setup(bob), privatePage = await stranger.newPage();
    await privatePage.goto(base + '/album.html'); await ready(privatePage);
    assert.equal(await privatePage.locator('.album-card').count(), 0); assert.equal(await privatePage.locator('#albumEmpty').isVisible(), true);
    await privatePage.screenshot({ path: 'checks/album-empty.png', fullPage: true });
    const blocked = await privatePage.evaluate(async id => {
      try { await (await import('./shared/album-store.js')).downloadPhoto(id); return false; } catch { return true; }
    }, first.id); assert.equal(blocked, true);
    const injection = await restored.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 10; c.height = 10; c.getContext('2d').fillRect(0,0,10,10);
      const blob = await new Promise(resolve => c.toBlob(resolve));
      return (await (await import('./shared/album-store.js')).addPhoto(blob, { name: '<img src=x onerror=alert(1)>.png', width: 10, height: 10 })).id;
    });
    await restored.reload(); await ready(restored);
    assert.equal(await restored.locator('.album-card-meta strong img').count(), 0);
    await album.setViewportSize({ width: 390, height: 844 }); await album.reload(); await ready(album);
    assert.ok(await album.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await album.locator('.brand-title').isVisible(), true);
    await album.screenshot({ path: 'checks/album-mobile.png', fullPage: true });
    failList = true; await album.reload(); await ready(album);
    assert.equal(await album.locator('#albumError').isVisible(), true); assert.equal(await album.locator('#albumEmpty').isVisible(), false);
    failList = false; await album.locator('#albumRetry').click(); await ready(album); assert.equal(await album.locator('.album-card').count(), 3);
    assert.equal(await album.locator('.album-card .album-delete,.album-card-actions').count(), 0);
    album.on('dialog', d => d.accept()); await album.locator('.album-preview').first().click();
    await album.locator('#albumPreviewDelete').click();
    await album.waitForFunction(() => document.querySelectorAll('.album-card').length === 2);
    assert.equal(rows.has(injection), false); assert.equal(objects.size, 4);
    assert.deepEqual(errors, []);
    console.log('PASS: private cloud upload; no automatic download; transparent PNG and exact original download; failure recovery; reload and fresh-browser restore; account isolation; safe filenames; static topbar; desktop/mobile layouts; deletion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

