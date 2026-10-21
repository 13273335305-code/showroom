const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth() {} export const authState = () => null;' }));
      await context.route('**/shared/asset-store.js', route => route.fulfill({ contentType: 'text/javascript', body: `
        const fixtures = [
          {id:'low',category:'面布',pixels:[180,90],physical:{widthCm:20,heightCm:15}},
          {id:'high',category:'面布',pixels:[4200,2100],physical:{widthCm:20,heightCm:15}},
          {id:'edge',category:'边布',pixels:[200,150],physical:{widthCm:4,heightCm:3}},
          {id:'binding',category:'辅料',pixels:[180,90],physical:{widthCm:8,heightCm:6}},
        ].map(item => ({...item,kind:'material',name:item.id,preview:'./checks/fabric-no-dpi.png'}));
        export const listAssets = async () => fixtures;
        export async function getAsset(id,options) {
          if (options?.runtime) throw new Error('Preview must request the original texture');
          await new Promise((resolve,reject)=>window.textureReads.push({id,resolve,reject}));
          const asset = fixtures.find(item => item.id === id), canvas = document.createElement('canvas');
          [canvas.width,canvas.height] = asset.pixels;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle='#ff0000';ctx.fillRect(0,0,canvas.width/2,canvas.height);
          ctx.fillStyle='#0000ff';ctx.fillRect(canvas.width/2,0,canvas.width/2,canvas.height);
          const map = await new Promise(resolve => canvas.toBlob(resolve));
          const runtimeCanvas=document.createElement('canvas');runtimeCanvas.width=16;runtimeCanvas.height=8;
          const runtimeMap=await new Promise(resolve=>runtimeCanvas.toBlob(resolve));
          return {...asset,maps:{map},runtimeMaps:{map:runtimeMap}};
        }
        export const saveAsset=async()=>{}, updateAsset=async()=>{}, deleteAsset=async()=>{};
      ` }));
      await context.addInitScript(() => {
        window.previewTiles = [];
        window.textureReads = [];
        const draw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (...args) {
          if (this.canvas.id === 'fabricPreviewTexture') previewTiles.push([...args.slice(1),args[0].width,args[0].height]);
          return draw.apply(this, args);
        };
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/asset-library.html`);
      await page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
      for (const [id, physicalWidth, physicalHeight, boardWidth] of [['low',20,15,120],['high',20,15,120],['edge',4,3,22],['binding',8,6,8]]) {
        await page.evaluate(() => { previewTiles = []; });
        await page.locator(`[data-asset-id="${id}"] .asset-art`).click();
        await page.waitForFunction(() => textureReads.length > 0);
        assert.equal(await page.locator('#fabricPreviewSurface').getAttribute('aria-busy'), 'true');
        assert.equal(await page.locator('#fabricPreviewTextureFallback').innerText(), '');
        assert.equal(await page.locator('#fabricPreviewLoader').isVisible(), true);
        const backdrop = await page.locator('#fabricPreviewLoadingImage').evaluate(img => ({
          source: img.currentSrc || img.src, filter: getComputedStyle(img.parentElement).filter,
          loaded: img.complete && img.naturalWidth > 0,
        }));
        assert.equal(backdrop.source, await page.locator(`[data-asset-id="${id}"] .asset-art img`).evaluate(img => img.currentSrc || img.src));
        assert.equal(backdrop.filter, 'blur(6px)');
        assert.equal(backdrop.loaded, true);
        const faceColors = await page.locator('.fabric-preview-texture .flip-card').evaluate(el => [...el.querySelectorAll('.flip-card__face')].map(face=>getComputedStyle(face).backgroundColor));
        assert.deepEqual(faceColors,['rgb(57, 120, 237)','rgb(57, 120, 237)']);
        if (id === 'low') {
          await page.waitForTimeout(350);
          const box = page.locator('.fabric-preview-texture .flip-card__box');
          const first = await box.evaluate(el => getComputedStyle(el).transform);
          await page.waitForTimeout(200);
          assert.notEqual(await box.evaluate(el => getComputedStyle(el).transform), first);
          const centered = await page.locator('#fabricPreviewLoader').evaluate(el => {
            const loader = el.getBoundingClientRect(), surface = document.getElementById('fabricPreviewSurface').getBoundingClientRect();
            return Math.abs(loader.x + loader.width/2 - surface.x - surface.width/2) < .1 && Math.abs(loader.y + loader.height/2 - surface.y - surface.height/2) < .1;
          });
          assert.equal(centered, true);
          await page.screenshot({path:`checks/fabric-preview-loading-${viewport.width}.png`});
          await page.emulateMedia({reducedMotion:'reduce'});
          assert.equal(await box.evaluate(el=>getComputedStyle(el).animationName),'none');
          await page.emulateMedia({reducedMotion:'no-preference'});
        }
        if (id === 'high') await page.emulateMedia({reducedMotion:'reduce'});
        await page.evaluate(() => textureReads.shift().resolve());
        await page.waitForFunction(() => !document.getElementById('fabricPreviewTexture').hidden);
        assert.equal(await page.locator('#fabricPreviewSurface').getAttribute('aria-busy'), 'false');
        if (id === 'low') {
          assert.equal(await page.locator('#fabricPreviewTextureFallback').evaluate(el=>el.classList.contains('is-revealing')),true);
          const fading = await page.locator('#fabricPreviewTextureFallback').evaluate(async el => {
            const animation = el.getAnimations().find(animation=>animation.animationName==='fabric-preview-loading-out');
            animation.pause(); animation.currentTime=160;
            await new Promise(resolve=>requestAnimationFrame(resolve));
            return {opacity:Number(getComputedStyle(el).opacity),hasImage:!!document.getElementById('fabricPreviewLoadingImage').src};
          });
          assert.ok(fading.opacity>0 && fading.opacity<1);
          assert.equal(fading.hasImage,true);
          await page.screenshot({path:`checks/fabric-preview-fade-${viewport.width}.png`});
          await page.locator('#fabricPreviewTextureFallback').evaluate(el=>el.getAnimations().forEach(animation=>animation.play()));
        }
        if (id === 'high') {
          assert.equal(await page.locator('#fabricPreviewTextureFallback').evaluate(el=>el.hidden),true);
          await page.emulateMedia({reducedMotion:'no-preference'});
        }
        await page.waitForFunction(() => document.getElementById('fabricPreviewTextureFallback').hidden);
        assert.equal(await page.locator('#fabricPreviewLoader').isVisible(), false);
        assert.equal(await page.locator('#fabricPreviewLoadingImage').getAttribute('src'), null);
        assert.equal(await page.locator('#fabricPreviewZoom').textContent(), `${boardWidth} × ${boardWidth * .75} cm`);
        const tiles = await page.evaluate(() => previewTiles);
        assert.ok(tiles.length > 0);
        const pixelsPerCm = 1200 / boardWidth;
        const tileWidth = physicalWidth * pixelsPerCm, tileHeight = physicalHeight * pixelsPerCm;
        assert.ok(tiles.every(tile => Math.abs(tile[2] - tileWidth) < 1e-6 && Math.abs(tile[3] - tileHeight) < 1e-6), `${id}: tile centimeter size must be independent of source pixel resolution`);
        const canvasSize = await page.locator('#fabricPreviewTexture').evaluate(canvas => [canvas.width,canvas.height,Number(canvas.dataset.widthCm)]);
        assert.deepEqual(canvasSize,[1200,900,boardWidth]);
        const bitmapWidth = {low:180,high:3600,edge:200,binding:180}[id];
        assert.ok(tiles.every(tile=>tile[4]===bitmapWidth && tile[5]===bitmapWidth/({edge:4/3}[id]||2)), 'Original map is used with a 3600px longest-edge limit');
        if (id === 'low') {
          const rendering = await page.locator('#fabricPreviewTexture').evaluate(canvas => {
            const ctx = canvas.getContext('2d');
            const rgb = x => [...ctx.getImageData(x,135,1,1).data].slice(0,3);
            return {a:rgb(10),b:rgb(110),repeat:rgb(210),width:canvas.width};
          });
          assert.notDeepEqual(rendering.a, rendering.b, 'Half a physical tile changes color');
          assert.deepEqual(rendering.a, rendering.repeat, 'Pattern repeats every 20 cm, not every 10 cm');
          assert.equal(rendering.width,1200);
          await page.locator('#fabricPreviewTexture').hover();
          await page.mouse.wheel(0,100);
          await page.waitForFunction(() => document.getElementById('fabricPreviewTexture').dataset.widthCm === '124');
          assert.equal(await page.locator('#fabricPreviewZoom').textContent(), '124 × 93 cm');
          const zoomedSize = await page.locator('#fabricPreviewTexture').evaluate(canvas => [canvas.width,canvas.height,Number(canvas.dataset.widthCm),Number(canvas.dataset.heightCm)]);
          assert.deepEqual(zoomedSize,[1200,900,124,93]);
          const zoomedTiles = await page.evaluate(() => previewTiles.filter(tile => Math.abs(tile[2] - 20 / 124 * 1200) < 1e-6));
          assert.ok(zoomedTiles.length > 0);
          assert.ok(zoomedTiles.every(tile => Math.abs(tile[3] - 15 / 124 * 1200) < 1e-6));
          await page.screenshot({path:`checks/fabric-preview-scale-${viewport.width}.png`});
        }
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('fabricPreviewDialog').open);
      }
      // A closed request cannot replace a newly opened card's loading state.
      await page.locator('[data-asset-id="low"] .asset-art').click();
      await page.waitForFunction(() => textureReads.length === 1);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('fabricPreviewDialog').open);
      assert.equal(await page.locator('#fabricPreviewLoadingImage').getAttribute('src'), null);
      await page.locator('[data-asset-id="high"] .asset-art').click();
      await page.waitForFunction(() => textureReads.length === 2);
      await page.evaluate(() => textureReads.shift().resolve());
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#fabricPreviewSurface').getAttribute('aria-busy'), 'true');
      assert.equal(await page.locator('#fabricPreviewTexture').isVisible(), false);
      await page.evaluate(() => textureReads.shift().reject(new Error('fixture failure')));
      await page.waitForFunction(() => document.getElementById('fabricPreviewSurface').getAttribute('aria-busy') === 'false');
      assert.equal(await page.locator('#fabricPreviewLoader').isVisible(), false);
      assert.equal(await page.locator('#fabricPreviewTextureFallback').innerText(), '');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('fabricPreviewDialog').open);
      await page.locator('[data-asset-id="low"] .asset-art').click();
      await page.waitForFunction(() => textureReads.length === 1);
      await page.evaluate(() => textureReads.shift().resolve());
      await page.waitForFunction(() => document.getElementById('fabricPreviewTextureFallback').classList.contains('is-revealing'));
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.waitForFunction(() => document.getElementById('fabricPreviewTextureFallback').hidden);
      assert.equal(await page.locator('#fabricPreviewLoadingImage').getAttribute('src'),null);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('fabricPreviewDialog').open);
      assert.deepEqual(errors,[]);
      console.log(`PASS ${viewport.width}: lighter blur, monochrome theme loader, whole loading layer fades out, reduced motion, stale/error states and correct physical scale`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
