const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const { installProjectFixture } = require('./project-test-server.cjs');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth() {} export const authState = () => null;' }));
      const state = await installProjectFixture(context), page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/asset-library.html');
      const fixtures = await page.evaluate(async () => {
        const { saveAsset } = await import('./shared/asset-store.js');
        const result = {};
        for (const name of ['auxiliary', 'runtime', 'degraded', 'previewOnly', 'plain']) {
          const canvas = document.createElement('canvas'); canvas.width = 4200; canvas.height = 1400;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = { auxiliary: '#e04422', runtime: '#c05533', degraded: '#994466', previewOnly: '#663399', plain: '#2a8b5c' }[name]; ctx.fillRect(0, 0, 2100, 1400);
          ctx.fillStyle = '#2277dd'; ctx.fillRect(2100, 0, 2100, 1400);
          const color = new File([await new Promise(resolve => canvas.toBlob(resolve))], name + '.png', { type: 'image/png' });
          canvas.width = canvas.height = 32; ctx.fillStyle = '#8080ff'; ctx.fillRect(0, 0, 32, 32);
          const normal = new File([await new Promise(resolve => canvas.toBlob(resolve))], 'normal.png', { type: 'image/png' });
          const saved = await saveAsset({ kind: 'material', name, category: '面布', physical: { widthCm: 237.59, heightCm: 80.01 },
            surface: { color: '#2a8b5c', roughness: .65 }, preview: name === 'previewOnly' ? color : undefined,
            maps: name === 'plain' ? {} : name === 'previewOnly' ? { normalMap: normal } : { map: color, normalMap: normal } });
          result[name] = { id: saved.id, preview: saved.preview, manifest: saved.assetManifest };
        }
        return result;
      });
      // Simulate unavailable cloud objects using the real asset hydration code.
      const normalPath = fixtures.auxiliary.manifest.files['source/normalMap'].path;
      state.objects.delete(normalPath);
      const runtimeOriginal = fixtures.runtime.manifest.files['source/map'].path;
      assert.notEqual(runtimeOriginal, fixtures.runtime.manifest.files['runtime/map'].path);
      state.objects.delete(runtimeOriginal);
      const degradedOriginal = fixtures.degraded.manifest.files['source/map'].path;
      const restoreOriginal = state.objects.get(degradedOriginal);
      state.objects.delete(degradedOriginal);
      state.objects.delete(fixtures.degraded.manifest.files['runtime/map'].path);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
      const open = async name => {
        await page.locator(`[data-asset-id="${fixtures[name].id}"] .asset-art`).click();
        await page.waitForFunction(() => document.getElementById('fabricPreviewSurface').getAttribute('aria-busy') === 'false');
      };
      const close = async () => {
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('fabricPreviewDialog').open);
      };
      for (const name of ['auxiliary', 'runtime']) {
        await open(name);
        await page.waitForFunction(() => document.getElementById('fabricPreviewTextureFallback').hidden);
        assert.equal(await page.locator('#fabricPreviewTexture').isVisible(), true);
        assert.equal(await page.locator('#fabricPreviewError').isVisible(), false);
        assert.equal(await page.locator('#fabricPreviewZoomControl').isVisible(), true);
        const controlSize = await page.locator('#fabricPreviewZoomControl').evaluate(el => {
          const rect = el.getBoundingClientRect(), button = el.querySelector('button').getBoundingClientRect(), thumb = el.querySelector('.fabric-preview-zoom-thumb').getBoundingClientRect();
          return { width: Math.round(rect.width), height: Math.round(rect.height), button: [Math.round(button.width), Math.round(button.height)], thumb: [Math.round(thumb.width), Math.round(thumb.height)] };
        });
        assert.deepEqual(controlSize, { width: 30, height: 170, button: [24, 24], thumb: [18, 18] });
        assert.equal(await page.locator('#fabricPreviewTexture').getAttribute('data-width-cm'), '120');
        await page.locator('#fabricPreviewZoomIn').click();
        assert.equal(await page.locator('#fabricPreviewTexture').getAttribute('data-width-cm'), '116');
        const pixel = await page.locator('#fabricPreviewTexture').evaluate(canvas => [...canvas.getContext('2d').getImageData(600, 450, 1, 1).data]);
        assert.ok(pixel[0] !== pixel[1] || pixel[1] !== pixel[2], 'A real colored texture is rendered');
        if (name === 'auxiliary') await page.screenshot({ path: `checks/fabric-preview-fixed-${width}.png` });
        for (const [buttonId, boardWidth] of [['fabricPreviewZoomIn', '40'], ['fabricPreviewZoomOut', '200']]) {
          const thumb = await page.locator('.fabric-preview-zoom-thumb').boundingBox(), button = await page.locator('#' + buttonId).boundingBox();
          await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
          await page.mouse.down();
          await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2, { steps: 8 });
          await page.mouse.up();
          assert.equal(await page.locator('#fabricPreviewTexture').getAttribute('data-width-cm'), boardWidth);
          const moved = await page.locator('.fabric-preview-zoom-thumb').boundingBox();
          assert.ok(Math.abs(moved.y + moved.height / 2 - button.y - button.height / 2) < 1, 'Thumb reaches the button center');
        }
        await page.locator('#fabricPreviewZoomRange').press('ArrowUp');
        assert.equal(await page.locator('#fabricPreviewTexture').getAttribute('data-width-cm'), '196');
        await page.locator('#fabricPreviewZoomRange').press('End');
        assert.equal(await page.locator('#fabricPreviewTexture').getAttribute('data-width-cm'), '40');
        await page.locator('#fabricPreviewZoomRange').press('Home');
        assert.equal(await page.locator('#fabricPreviewTexture').getAttribute('data-width-cm'), '200');
        await close();
      }
      await open('degraded');
      await page.waitForFunction(() => document.getElementById('fabricPreviewTextureFallback').hidden);
      assert.equal(await page.locator('#fabricPreviewTexture').isVisible(), true);
      assert.equal(await page.locator('#fabricPreviewErrorMessage').innerText(), '纹理暂时无法加载，已显示预览图');
      assert.equal(await page.locator('#fabricPreviewZoomControl').isVisible(), false);
      await close();
      await context.route('**' + fixtures.degraded.preview, route => route.fulfill({ status: 503, body: 'unavailable' }));
      await open('degraded');
      assert.equal(await page.locator('#fabricPreviewErrorMessage').innerText(), '纹理加载失败，请重试');
      assert.equal(await page.locator('#fabricPreviewLoadingImage').getAttribute('src'), null);
      state.objects.set(degradedOriginal, restoreOriginal);
      await page.locator('#retryFabricPreview').click();
      await page.waitForFunction(() => !document.getElementById('fabricPreviewTexture').hidden && document.getElementById('fabricPreviewError').hidden);
      await page.waitForFunction(() => document.getElementById('fabricPreviewTextureFallback').hidden);
      assert.equal(await page.locator('#fabricPreviewZoomControl').isVisible(), true);
      await close();
      await open('previewOnly');
      await page.waitForFunction(() => document.getElementById('fabricPreviewTextureFallback').hidden);
      assert.equal(await page.locator('#fabricPreviewTexture').isVisible(), true);
      assert.equal(await page.locator('#fabricPreviewTexture').getAttribute('aria-label'), '面料预览图');
      assert.equal(await page.locator('#fabricPreviewZoomControl').isVisible(), false);
      assert.equal(await page.locator('#fabricPreviewError').isVisible(), false);
      await close();
      await open('plain');
      await page.waitForFunction(() => document.getElementById('fabricPreviewTextureFallback').hidden);
      const plain = await page.locator('#fabricPreviewTexture').evaluate(canvas => [...canvas.getContext('2d').getImageData(600, 450, 1, 1).data]);
      assert.deepEqual(plain, [42, 139, 92, 255]);
      assert.equal(await page.locator('#fabricPreviewError').isVisible(), false);
      await close();
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${width}: auxiliary failure, original-to-runtime fallback, sharp preview, visible failure, retry, zoom, no color map and plain color`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
