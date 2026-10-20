const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<link rel="stylesheet" href="/fabric-scan.css"><style>body{background:#e6ebf0}.fabric-scan-dialog{inset:32px auto auto 32px}</style><button id="scan">扫码</button><script type="module">import {mountFabricScanner} from "/shared/fabric-scanner.js"; window.pending=[]; window.scanner=mountFabricScanner({button:document.getElementById("scan"),apply:(id,options)=>new Promise((resolve,reject)=>pending.push({id,...options,resolve,reject}))}); window.mounted=true;</script>');
      return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 834, height: 1080 }, reducedMotion: 'no-preference' }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.cameraValue = '';
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 320;
        const context = canvas.getContext('2d');
        const draw = () => {
          for (let y = 0; y < 320; y += 6) for (let x = 0; x < 320; x += 6) { context.fillStyle = (x / 6 + y / 6) % 2 ? '#fff' : '#000'; context.fillRect(x, y, 6, 6); }
          context.fillStyle = '#82929a'; context.fillRect(102, 102, 116, 116);
        };
        draw(); window.cameraTimer = setInterval(draw, 100);
        return canvas.captureStream(10);
      } });
      Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [] });
      Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: class { static async getSupportedFormats() { return ['qr_code']; } async detect() { return window.cameraValue ? [{ rawValue: window.cameraValue }] : []; } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.mounted);
    await page.locator('#scan').click();
    await page.waitForFunction(() => document.querySelector('.fabric-scan-dialog').classList.contains('has-camera'));
    await page.evaluate(() => {
      const guide = document.querySelector('.fabric-scan-guide');
      window.stages = []; new MutationObserver(records => { for (const record of records) if (record.attributeName === 'data-state') stages.push(guide.dataset.state || 'idle'); }).observe(guide, { attributes: true });
    });
    const guide = page.locator('.fabric-scan-guide');
    const setCode = value => page.evaluate(value => { window.cameraValue = value; }, value);
    const waitPending = count => page.waitForFunction(count => pending.length === count, count);
    const waitState = value => page.waitForFunction(value => document.querySelector('.fabric-scan-guide').dataset.state === value, value);
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
    await fs.mkdir(path.join(root, 'outputs/fabric-scan'), { recursive: true });
    const cameraContrast = async () => {
      const buffer = await page.locator('.fabric-scan-camera-view').screenshot();
      return page.evaluate(async data => {
        const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return [[.035,.4,.045,.1],[.13,.13,.045,.045],[.25,.35,.05,.08]].map(([x,y,w,h]) => {
          const pixels = ctx.getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),Math.ceil(w*canvas.width),Math.ceil(h*canvas.height)).data;
          const values = Array.from({length:pixels.length/4},(_,i)=>pixels[i*4]);
          const mean = values.reduce((sum,value)=>sum+value,0)/values.length;
          return Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length);
        });
      }, buffer.toString('base64'));
    };
    const sharpCamera = await cameraContrast();
    assert.ok(sharpCamera.every(value => value > 60), 'The camera fixture begins with sharp detail');
    await setCode(ids[0]); await waitPending(1);
    assert.equal(await guide.getAttribute('data-state'), 'recognized', 'Recognition starts with the blue square');
    await waitState('loading');
    const morph = await page.locator('.fabric-scan-outline').evaluate(element => {
      const animation = element.getAnimations().find(animation => animation.transitionProperty === 'clip-path');
      if (!animation) return null;
      animation.pause(); animation.currentTime = 200; window.outlineMorph = animation;
      const blur = document.querySelector('.fabric-scan-camera-blur').getAnimations().find(animation => animation.transitionProperty === 'clip-path');
      blur.pause(); blur.currentTime = 200; window.blurMorph = blur;
      return { duration: animation.effect.getTiming().duration, easing: animation.effect.getTiming().easing };
    });
    assert.deepEqual(morph, { duration: 400, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' }, 'The slower morph keeps the motion skill on-screen easing');
    const assertHollow = async label => {
      const buffer = await guide.screenshot();
      const pixels = await page.evaluate(async data => {
        const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return [[.5,.5],[.3,.4],[.7,.6]].map(([x,y]) => [...ctx.getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),1,1).data]);
      }, buffer.toString('base64'));
      assert.ok(pixels.every(pixel => pixel.slice(0,3).every((value,index) => Math.abs(value - [130,146,154][index]) <= 2)), label + ': camera remains visible through the outline');
    };
    await assertHollow('Halfway through the square-to-circle morph');
    await page.locator('.fabric-scan-dialog').screenshot({ path: 'outputs/fabric-scan/feedback-morph.png' });
    await page.evaluate(() => { window.outlineMorph.play(); window.blurMorph.play(); });
    await waitState('settling');
    const rebound = await page.evaluate(() => {
      const outline = document.querySelector('.fabric-scan-outline').getAnimations().find(animation => animation.id === 'fabric-scan-rebound');
      const blur = document.querySelector('.fabric-scan-camera-blur').getAnimations().find(animation => animation.id === 'fabric-scan-rebound');
      const startDelta = outline.startTime - blur.startTime;
      outline.pause(); blur.pause(); outline.currentTime = blur.currentTime = 0;
      window.outlineRebound = outline; window.blurRebound = blur;
      const frames = outline.effect.getKeyframes(), outsideFrames = blur.effect.getKeyframes();
      const radius = frame => (parseFloat(frame.clipPath.match(/[-\d.]+%/)[0]) * 1.04 - 52) * 2;
      return { duration: outline.effect.getTiming().duration, first: radius(frames[0]), last: radius(frames.at(-1)), max: Math.max(...frames.map(radius)), synced: frames.every((frame,index) => frame.offset === outsideFrames[index].offset), startDelta };
    });
    assert.equal(rebound.duration, 500, 'Rebound uses the motion skill spring duration');
    assert.ok(Math.abs(rebound.first - 92) < .01, 'The contraction finishes at a slightly smaller circle');
    assert.ok(Math.abs(rebound.last - 100) < .01, 'The rebound returns to the existing circle size');
    assert.ok(rebound.max > 100 && rebound.max < 102, 'Spring overshoot stays subtle');
    assert.equal(rebound.synced, true); assert.equal(rebound.startDelta, 0, 'Outline and blur spring share one timeline');
    await assertHollow('The contracted circle before rebound');
    await page.locator('.fabric-scan-dialog').screenshot({ path: 'outputs/fabric-scan/feedback-contracted.png' });
    await page.evaluate(() => { window.outlineRebound.play(); window.blurRebound.play(); });
    await page.waitForTimeout(520);
    assert.deepEqual((await page.evaluate(() => stages)).slice(0, 2), ['recognized', 'loading']);
    assert.equal(await page.locator('.fabric-scan-feedback').evaluate(element => getComputedStyle(element).clipPath), 'inset(0px round 50%)');
    assert.equal(await page.locator('.fabric-scan-feedback').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'Feedback never has a solid blue fill');
    assert.equal(await page.locator('.fabric-scan-outline').evaluate(element => getComputedStyle(element, '::after').backgroundColor), 'rgb(57, 120, 237)');
    await assertHollow('The blue circle while loading');
    const focusedCamera = await cameraContrast();
    assert.ok(focusedCamera[0] < sharpCamera[0] * .25, 'Camera detail outside the original square is blurred');
    assert.ok(focusedCamera[1] < sharpCamera[1] * .25, 'The blur follows the morph into the circle corners');
    assert.ok(focusedCamera[2] > sharpCamera[2] * .9, 'Camera detail inside the circle remains sharp');
    await page.locator('.fabric-scan-dialog').screenshot({ path: 'outputs/fabric-scan/feedback-loading.png' });
    // Preview is allowed to prepare while application is pending, but success
    // must be confirmed before the ball can appear.
    await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48; const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#bc8749'; ctx.fillRect(0, 0, 48, 48); ctx.fillStyle = '#704b29';
      for (let x = 0; x < 48; x += 8) ctx.fillRect(x, 0, 3, 48);
      pending[0].onPreview({ id: pending[0].id, name: '条纹面料', source: canvas.toDataURL(), color: '#bc8749', info: { widthCm: 10, heightCm: 10 } });
    });
    await page.waitForFunction(() => !!document.querySelector('.fabric-scan-sphere img'));
    assert.equal(await guide.getAttribute('data-state'), 'settling', 'Preloading does not claim application success');
    await page.evaluate(() => pending[0].resolve('已应用')); await waitState('ready'); await page.waitForTimeout(260);
    assert.equal(await guide.getAttribute('data-asset-id'), ids[0]);
    assert.equal(await page.locator('.fabric-scan-sphere img').evaluate(image => image.naturalWidth), 320);
    assert.equal(await page.locator('.fabric-scan-material').evaluate(element => getComputedStyle(element).opacity), '1');
    await page.locator('.fabric-scan-dialog').screenshot({ path: 'outputs/fabric-scan/feedback-material.png' });
    // A different code interrupts the hold immediately, using its own color.
    await setCode(ids[1]); await waitPending(2);
    assert.equal(await page.locator('.fabric-scan-sphere').count(), 0, 'The previous sphere is removed for a new code');
    await page.evaluate(() => { pending[1].onPreview({ id: pending[1].id, color: '#22aa66' }); pending[1].resolve('已应用'); });
    await waitState('settling');
    assert.equal(await page.locator('.fabric-scan-material').evaluate(element => getComputedStyle(element).opacity), '0', 'An early preview waits for the spring to finish');
    await waitState('ready');
    assert.equal(await guide.getAttribute('data-asset-id'), ids[1]);
    assert.equal(await page.locator('.fabric-scan-material').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(34, 170, 102)');
    await page.waitForFunction(() => !document.querySelector('.fabric-scan-guide').dataset.state);
    const resumedCamera = await cameraContrast();
    assert.ok(resumedCamera[0] > sharpCamera[0] * .9, 'Returning to scanning restores sharp camera detail');
    assert.equal(await page.locator('.fabric-scan-sphere').count(), 0, 'The hold returns to the white scanning guide');
    // Failed application restores scanning; a broken preview still permits a
    // color sphere and does not turn a successful replacement into an error.
    await setCode(ids[2]); await waitPending(3);
    await page.evaluate(() => pending[2].reject(new Error('测试应用失败')));
    await page.waitForFunction(() => document.getElementById('fabricScanStatus').dataset.state === 'error');
    assert.equal(await guide.getAttribute('data-state'), null);
    await page.waitForTimeout(180);
    assert.equal(await page.locator('.fabric-scan-camera-blur').evaluate(element => getComputedStyle(element).opacity), '0', 'Failed application removes the outer blur');
    await setCode(ids[3]); await waitPending(4);
    await page.evaluate(() => { pending[3].onPreview({ id: pending[3].id, source: '/missing-preview.png', color: '#cc2233' }); pending[3].resolve('已应用'); });
    await waitState('ready'); assert.equal(await page.locator('.fabric-scan-sphere img').count(), 0);
    assert.equal(await page.locator('.fabric-scan-material').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(204, 34, 51)');
    // Entry into settings cancels an asynchronous image, even if application
    // succeeds after returning to the camera.
    let releasePreview; const imageGate = new Promise(resolve => { releasePreview = resolve; });
    await page.route('**/slow-preview.svg', async route => { await imageGate; await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="blue" d="M0 0h32v32H0z"/></svg>' }); });
    await setCode(ids[0]); await waitPending(5);
    await page.evaluate(() => pending[4].onPreview({ id: pending[4].id, source: '/slow-preview.svg' }));
    await waitState('settling');
    await page.getByRole('button', { name: '扫码设置', exact: true }).click();
    assert.equal(await guide.getAttribute('data-state'), null);
    assert.equal(await page.locator('.fabric-scan-camera-blur video').evaluate(video => video.srcObject === null && video.paused), true, 'Settings releases the temporary blur playback');
    assert.equal(await page.evaluate(() => document.getAnimations().some(animation => animation.id === 'fabric-scan-rebound')), false, 'Settings cancels the spring immediately');
    await page.evaluate(() => pending[4].resolve('已应用'));
    await page.getByRole('button', { name: '返回扫码', exact: true }).click(); releasePreview();
    await page.waitForTimeout(500); assert.equal(await guide.getAttribute('data-state'), null);
    assert.equal(await page.locator('.fabric-scan-sphere').count(), 0);
    // Close and reopen while the old apply is pending: its callback must not
    // revive feedback in the new camera session.
    await setCode(ids[1]); await waitPending(6);
    await waitState('settling');
    await page.locator('#scan').click(); await setCode(''); await page.locator('#scan').click();
    await page.evaluate(() => { pending[5].onPreview({ id: pending[5].id, color: '#ff0000' }); pending[5].resolve('过期结果'); });
    await page.waitForTimeout(500); assert.equal(await guide.getAttribute('data-state'), null);
    // Reduced motion keeps the color / fade feedback without morph or spin.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setCode(ids[2]); await waitPending(7); await waitState('settling');
    assert.equal(await page.locator('.fabric-scan-feedback').evaluate(element => getComputedStyle(element).transitionProperty), 'opacity');
    assert.equal(await page.locator('.fabric-scan-outline').evaluate(element => getComputedStyle(element).transitionProperty), 'none', 'Reduced motion skips the shape morph');
    assert.equal(await page.locator('.fabric-scan-camera-blur').evaluate(element => getComputedStyle(element).transitionProperty), 'opacity', 'Reduced motion retains only the blur fade');
    assert.equal(await page.locator('.fabric-scan-loading').evaluate(element => getComputedStyle(element).animationName), 'none');
    assert.equal(await page.evaluate(() => document.getAnimations().some(animation => animation.id === 'fabric-scan-rebound')), false, 'Reduced motion skips the spring');
    await page.evaluate(() => { pending[6].onPreview({ id: pending[6].id, color: '#2266cc' }); pending[6].resolve('已应用'); });
    await waitState('ready'); await page.waitForTimeout(180);
    assert.equal(await page.locator('.fabric-scan-material').evaluate(element => getComputedStyle(element).transform), 'none');
    await page.locator('#scan').click();
    assert.equal(await guide.getAttribute('data-state'), null);
    assert.equal(await page.locator('.fabric-scan-camera-blur video').evaluate(video => video.srcObject === null && video.paused), true, 'Closing releases the temporary blur playback');
    assert.deepEqual(errors, []);
    console.log('PASS: blue square → circle → projected fabric sphere, application gating, continuous scanning, color/image fallback, failure, settings/close cancellation and reduced motion');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
