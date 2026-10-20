const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { installProjectFixture } = require('./project-test-server.cjs');
const { saveOnlineProject, openOnlineProject } = require('./project-roundtrip.cjs');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth() { document.documentElement.classList.remove("auth-pending"); document.getElementById("authBootLoading")?.remove(); } export const authState=()=>({id:"11111111-1111-1111-1111-111111111111"}); export const workspaceClient=async()=>(await import("./project-store.js")).fixtureAccess();' }));
    const state = await installProjectFixture(context), errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('**/app.js', async route => {
      const source = await fs.readFile(path.join(__dirname, '../app.js'), 'utf8');
      await route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.readScanState=()=>({history:assignmentHistory.length,slots:["面布","边布","包边条"].map(type=>({type,values:materialSlotsForPartType(type).map(({mesh,slot})=>{const material=slotMaterial(mesh,slot),entry=entries.find(e=>e.material===material);return {id:entry?.assetId||null,color:material.color.getHexString(),name:entry?.name};})}))});' });
    });
    const editor = await context.newPage();
    await editor.goto(base + '/material-editor.html');
    await editor.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    assert.equal(await editor.locator('#materialIdentity').isVisible(), false);
    let releaseSave, failSave = false;
    await editor.route('**/__cloud_test/rpc', async route => {
      if (route.request().postDataJSON().name !== 'spenic_save_asset') return route.fallback();
      if (releaseSave) await releaseSave.promise;
      if (failSave) return route.fulfill({ json: { error: { message: 'test upload failure' } } });
      return route.fallback();
    });
    releaseSave = {}; releaseSave.promise = new Promise(resolve => { releaseSave.resolve = resolve; });
    await editor.locator('#name').fill('扫码面料'); await editor.locator('#fabricColorCode').fill('DBW'); await editor.locator('#category').selectOption('边布');
    await editor.locator('#saveMaterial').click(); await editor.locator('#confirmPreviewGeneration').click();
    await editor.waitForFunction(() => document.querySelector('#materialIdentity .fabric-identity-status').textContent.includes('正在上传'));
    assert.equal(await editor.locator('#materialIdentity [data-label-download]').isVisible(), false);
    releaseSave.resolve(); releaseSave = null;
    await editor.locator('#materialIdentity .fabric-identity-ready').waitFor({ state: 'visible' });
    const editorId = new URL(editor.url()).searchParams.get('asset');
    assert.equal(state.assets.get(editorId).metadata.fabricIdentityVersion, 1);
    assert.equal(await editor.locator('.fabric-identity-code').textContent(), editorId);
    const [download] = await Promise.all([editor.waitForEvent('download'), editor.locator('[data-label-download]').click()]);
    const label = await fs.readFile(await download.path(), 'utf8'); assert.ok(label.includes(editorId)); assert.ok(label.includes('边布 · 色号 DBW'));
    const decoded = await editor.evaluate(async id => {
      const { fabricQrSvg } = await import('./shared/fabric-label.js'); const { createQrDecoder } = await import('./shared/qr-decoder.js');
      Object.defineProperty(window, 'BarcodeDetector', { value: undefined, configurable: true });
      const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fabricQrSvg(id)); await image.decode();
      const decoder = await createQrDecoder(), result = await decoder.decode(image); decoder.reset(); return result;
    }, editorId);
    assert.equal(decoded, editorId);
    const nativeEmptyFallback = await editor.evaluate(async id => {
      const { fabricQrSvg } = await import('./shared/fabric-label.js'); const { createQrDecoder } = await import('./shared/qr-decoder.js');
      Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: class {
        static async getSupportedFormats() { return ['qr_code']; }
        async detect() { return []; }
      } });
      const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fabricQrSvg(id)); await image.decode();
      const decoder = await createQrDecoder(), result = await decoder.decode(image); decoder.reset(); return result;
    }, editorId);
    assert.equal(nativeEmptyFallback, editorId, 'ZXing fallback should run when native detection returns no result');
    const sampleResults = await editor.evaluate(async () => {
      const { fabricQrSvg } = await import('./shared/fabric-label.js');
      const { createQrDecoder } = await import('./shared/qr-decoder.js');
      const ids = ['08d840e1-ef74-4c95-9c7f-eec75fa18f6c', '12345678-abcd-4321-8765-123456789abc'];
      for (let i = 0; i < 24; i++) {
        const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fabric-qr-regression-' + i)));
        const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('').slice(0, 32);
        ids.push([hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-'));
      }
      const decoder = await createQrDecoder(), results = [];
      for (const id of ids) {
        const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fabricQrSvg(id)); await image.decode();
        results.push([id, await decoder.decode(image)]);
      }
      decoder.reset(); return results;
    });
    assert.ok(sampleResults.every(([expected, actual]) => expected === actual), JSON.stringify(sampleResults.filter(([expected, actual]) => expected !== actual)));
    await editor.evaluate(() => { const open = window.open.bind(window); window.open = (...args) => { const popup = open(...args); if (popup) popup.print = () => { popup.labelPrinted = true; }; return popup; }; });
    const [printWindow] = await Promise.all([editor.waitForEvent('popup'), editor.locator('[data-label-print]').click()]);
    await printWindow.waitForFunction(() => window.labelPrinted === true);
    assert.ok((await printWindow.locator('svg').first().textContent()).includes(editorId)); await printWindow.close();
    await editor.locator('#name').fill('扫码面料修改'); await editor.locator('#saveMaterial').click(); await editor.locator('#confirmPreviewGeneration').click();
    await editor.waitForFunction(() => document.getElementById('status').textContent === '已生成预览图并保存到资产库');
    assert.equal(new URL(editor.url()).searchParams.get('asset'), editorId);
    failSave = true; await editor.locator('#name').fill('失败后重试'); await editor.locator('#saveMaterial').click(); await editor.locator('#confirmPreviewGeneration').click();
    await editor.waitForFunction(() => document.querySelector('#materialIdentity .fabric-identity-status').textContent.includes('上传失败'));
    assert.equal(await editor.locator('[data-label-download]').isVisible(), false);
    failSave = false; await editor.evaluate(async () => { const queue = await import('./shared/upload-queue.js'); const tasks = await queue.listUploads(); await queue.retryUpload(tasks.find(task => task.status === 'failed').id); });
    await editor.locator('#materialIdentity .fabric-identity-ready').waitFor({ state: 'visible' });
    await editor.setViewportSize({ width: 390, height: 844 }); await editor.locator('#materialIdentity').scrollIntoViewIfNeeded();
    assert.equal(await editor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await fs.mkdir('outputs/fabric-scan', { recursive: true }); await editor.screenshot({ path: 'outputs/fabric-scan/editor-mobile.png' });
    const library = await context.newPage(); await library.goto(base + '/asset-library.html');
    await library.locator('.asset-card .asset-art').first().waitFor(); await library.locator('.asset-card .asset-art').first().click();
    await library.locator('#fabricPreviewIdentity .fabric-identity-ready').waitFor({ state: 'visible' });
    await library.waitForFunction(() => document.getElementById('fabricPreviewSurface').getAttribute('aria-busy') === 'false');
    assert.equal(await library.locator('#fabricPreviewIdentity .fabric-identity-code').textContent(), editorId);
    assert.equal(await library.locator('.fabric-preview-details #fabricPreviewIdentity').count(), 1);
    assert.deepEqual(await library.locator('.fabric-preview-field-label').allTextContents(), ['名称', '色号', '设计信息', '供应商', '简介']);
    assert.equal(await library.locator('.fabric-preview-field').filter({ has: library.getByText('色号', { exact: true }) }).locator('strong').textContent(), 'DBW');
    const qrTrigger = library.getByRole('button', { name: '面料二维码，下载或打印标签' });
    const labelActions = library.locator('#fabricPreviewIdentity .fabric-identity-actions');
    assert.equal(await labelActions.isVisible(), false);
    await qrTrigger.click(); await library.keyboard.press('Escape');
    assert.equal(await labelActions.isVisible(), false);
    assert.equal(await library.locator('#fabricPreviewDialog').evaluate(dialog => dialog.open), true);
    assert.equal(await qrTrigger.evaluate(button => button === document.activeElement), true);
    await qrTrigger.click(); await library.locator('#fabricPreviewDetailsTitle').click();
    assert.equal(await labelActions.isVisible(), false);
    await qrTrigger.click();
    const [libraryDownload] = await Promise.all([library.waitForEvent('download'), library.locator('#fabricPreviewIdentity [data-label-download]').click()]);
    assert.ok((await fs.readFile(await libraryDownload.path(), 'utf8')).includes(editorId));
    assert.equal(await labelActions.isVisible(), false);
    await library.evaluate(() => { const open = window.open.bind(window); window.open = (...args) => { const popup = open(...args); if (popup) popup.print = () => { popup.labelPrinted = true; }; return popup; }; });
    await qrTrigger.click();
    const [libraryPrint] = await Promise.all([library.waitForEvent('popup'), library.locator('#fabricPreviewIdentity [data-label-print]').click()]);
    await libraryPrint.waitForFunction(() => window.labelPrinted === true);
    assert.ok((await libraryPrint.locator('svg').first().textContent()).includes(editorId)); await libraryPrint.close();
    await library.screenshot({ path: 'outputs/fabric-scan/library-desktop.png' });
    await library.setViewportSize({ width: 390, height: 844 });
    const fieldsBox = await library.locator('#fabricPreviewFields').boundingBox(), qrBox = await qrTrigger.boundingBox();
    assert.ok(qrBox.x >= fieldsBox.x + fieldsBox.width, 'QR remains to the right of fabric information on mobile');
    assert.equal(await library.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await qrTrigger.click();
    assert.equal(await labelActions.isVisible(), true);
    await library.screenshot({ path: 'outputs/fabric-scan/library-mobile-actions.png' });
    await library.keyboard.press('Escape'); await library.keyboard.press('Escape');
    await library.waitForFunction(() => !document.getElementById('fabricPreviewDialog').open);
    await library.locator('.asset-card .asset-art').first().click();
    await qrTrigger.waitFor(); assert.equal(await labelActions.isVisible(), false);
    const ids = await library.evaluate(async () => {
      const THREE = await import('./vendor/three/build/three.module.js'); const { prepareModelRuntime } = await import('./shared/model-runtime.js'); const { saveAsset } = await import('./shared/asset-store.js');
      const root = new THREE.Group();
      ['面布', '边布', '包边条'].forEach((type, index) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhysicalMaterial({ name: type, color: 0xbbbbbb })); mesh.position.x = (index - 1) * 1.2; root.add(mesh); });
      const runtime = await prepareModelRuntime(root, { name: '扫码测试.glb', textureConvention: 'gltf' });
      const model = await saveAsset({ kind: 'model', name: '扫码测试模型', file: new File([runtime], '扫码测试.glb'), runtimeModelFile: runtime, partAssignments: { 0: ['面布'], 1: ['边布'], 2: ['包边条'] } });
      const result = { model: model.id };
      for (const [key, category, color] of [['face', '面布', '#cc2233'], ['edge', '边布', '#2266cc'], ['piping', '包边条', '#22aa66'], ['other', '其他', '#555555']]) result[key] = (await saveAsset({ kind: 'material', materialType: 'fabric', name: key + '扫码面料', category, fabricColorCode: 'DBW', surface: { color, roughness: .45 }, physical: { mode: 'physical', widthCm: 10, heightCm: 10 }, maps: {} })).id;
      result.pattern = (await saveAsset({ kind: 'material', materialType: 'pattern', name: '非面料', category: '', surface: { color: '#ffffff' }, maps: {} })).id;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f09b17'; ctx.fillRect(0, 0, 32, 32);
      const texture = await new Promise(resolve => canvas.toBlob(resolve));
      result.textured = (await saveAsset({ kind: 'material', materialType: 'fabric', name: '网络贴图测试', category: '面布', surface: { color: '#ffffff' }, physical: { mode: 'physical', widthCm: 10, heightCm: 10 }, maps: { map: new File([texture], 'unique-scan-texture.png', { type: 'image/png' }) }, preview: texture })).id;
      return result;
    });
    delete state.assets.get(ids.other).metadata.fabricIdentityVersion;
    const design = await context.newPage();
    await design.addInitScript(() => { Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { throw new DOMException('no camera in fixture', 'NotFoundError'); } }); });
    await design.goto(base + '/design.html?asset=' + ids.model);
    await design.waitForFunction(() => document.getElementById('loading').hidden && window.readScanState?.().slots.every(slot => slot.values.length === 1), null, { timeout: 60000 });
    const read = () => design.evaluate(() => readScanState());
    const settings = async () => { if (!(await design.locator('#fabricScanSettings').isVisible())) await design.getByRole('button', { name: '扫码设置', exact: true }).click(); };
    const scan = async id => { await settings(); await design.locator('#fabricScanInput').fill(id); await design.locator('#fabricScanInput').press('Enter'); await design.waitForFunction(() => document.querySelector('#fabricScanDialog form').getAttribute('aria-busy') === 'false'); return design.locator('#fabricScanStatus').textContent(); };
    await design.locator('[data-fabric="面布"]').click(); await design.locator('#scanFabric').click();
    assert.equal(await design.locator('#materialDock #scanFabric').count(), 1);
    assert.equal(await design.locator('.topbar #scanFabric').count(), 0);
    assert.equal(await design.locator('#fabricScanSettings').isVisible(), false);
    assert.equal(await design.locator('.fabric-scan-video').isVisible(), true);
    const cameraBox = await design.locator('#fabricScanDialog').boundingBox(), dockBox = await design.locator('#materialDock').boundingBox();
    assert.ok(Math.abs(cameraBox.width - cameraBox.height) < 1, 'Primary camera window is square');
    assert.equal(cameraBox.width, 224, 'Desktop camera window is compact');
    assert.ok(cameraBox.y + cameraBox.height < dockBox.y, 'Camera window floats above the material bar');
    assert.equal(await design.locator('.fabric-scan-close').count(), 0, 'Camera overlay has no close button');
    assert.equal(await design.locator('#fabricScanDialog button:visible').count(), 1, 'Only settings appears over the camera');
    assert.ok((await design.locator('#fabricScanTitle').boundingBox()).width <= 1, 'Camera title is visually removed');
    assert.ok((await design.locator('#fabricScanStatus').boundingBox()).width <= 1, 'Camera status is visually removed');
    assert.match(await scan(ids.edge), /已将“边布”/);
    assert.equal(await design.locator('#fabricScanTitle').textContent(), '扫码设置');
    assert.ok((await design.locator('#fabricScanStatus').boundingBox()).width <= 1, 'Settings status is visually removed');
    let value = await read(); assert.equal(value.slots[1].values[0].id, ids.edge); assert.equal(value.slots[0].values[0].id, null); assert.equal(value.history, 1);
    assert.match(await scan(ids.edge), /无需重复替换/); assert.equal((await read()).history, 1);
    assert.match(await scan(ids.face), /已将“面布”/); assert.match(await scan(ids.piping), /已将“包边条”/); assert.equal((await read()).history, 3);
    await design.keyboard.press('Escape'); await design.locator('#headerUndo').click(); assert.equal((await read()).slots[2].values[0].id, null);
    await design.evaluate(async id => { const store = await import('./shared/asset-store.js'); const asset = await store.getAsset(id); await store.saveAsset({ ...asset, name: '最新边布', surface: { ...asset.surface, color: '#11aaee' } }); }, ids.edge);
    await design.locator('#scanFabric').click(); assert.match(await scan(ids.edge), /最新边布/); assert.equal((await read()).slots[1].values[0].color, '11aaee');
    await design.keyboard.press('Escape'); await design.locator('#materialList .material-item.active').click(); await design.locator('#compactColor').fill('#ff9900');
    assert.equal((await read()).slots[1].values[0].color, 'ff9900');
    await design.locator('#scanFabric').click(); assert.match(await scan(ids.edge), /最新边布/);
    assert.equal((await read()).slots[1].values[0].color, '11aaee', 'Rescanning restores the saved surface after local edits');
    const beforeDownloadFailure = await read();
    const texturePath = state.assets.get(ids.textured).manifest.files['runtime/map'].path;
    await design.route('**/__cloud_test/objects/**', route => decodeURIComponent(new URL(route.request().url()).pathname).endsWith(texturePath) ? route.fulfill({ status: 503 }) : route.fallback());
    assert.match(await scan(ids.textured), /failed|失败/); assert.deepEqual(await read(), beforeDownloadFailure);
    await design.unroute('**/__cloud_test/objects/**');
    assert.match(await scan(ids.textured), /网络贴图测试/);
    await design.keyboard.press('Escape'); await design.locator('#headerUndo').click(); await design.locator('#scanFabric').click();
    const beforeErrors = await read();
    assert.match(await scan('bad-code'), /无效/); assert.match(await scan('00000000-0000-0000-0000-000000000000'), /不存在/);
    assert.match(await scan(ids.pattern), /不是面料/); assert.match(await scan(ids.other), /没有可用/);
    state.assets.get(ids.other).metadata.fabricIdentityVersion = 1;
    state.assets.get(ids.other).updated_at = new Date(Date.now() + 1000).toISOString();
    assert.match(await scan(ids.other), /尚未配置/); assert.deepEqual(await read(), beforeErrors);
    let releaseQuery; const queryGate = new Promise(resolve => { releaseQuery = resolve; });
    await design.route('**/__cloud_test/query', async route => { const payload = route.request().postDataJSON(); if (payload.table === 'spenic_assets' && payload.filters.id === ids.face) await queryGate; return route.fallback(); });
    await settings(); await design.locator('#fabricScanInput').fill(ids.face); await design.locator('#fabricScanInput').press('Enter');
    await design.waitForFunction(() => document.querySelector('#fabricScanDialog form').getAttribute('aria-busy') === 'true');
    await design.keyboard.press('Escape'); releaseQuery();
    await design.waitForFunction(() => document.querySelector('#fabricScanDialog form').getAttribute('aria-busy') === 'false');
    await design.unroute('**/__cloud_test/query'); assert.deepEqual(await read(), beforeErrors);
    await design.evaluate(() => {
      window.cameraTracks = []; window.cameraValue = ''; window.cameraDenied = false;
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 480);
      window.cameraCanvasTimer = setInterval(() => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 480); }, 100);
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { if (window.cameraDenied) throw new DOMException('denied', 'NotAllowedError'); const stream = canvas.captureStream(10); window.cameraTracks.push(...stream.getTracks()); return stream; } });
      Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [{ kind: 'videoinput', deviceId: 'one', label: '测试摄像头一' }, { kind: 'videoinput', deviceId: 'two', label: '测试摄像头二' }] });
      Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: class { static async getSupportedFormats() { return ['qr_code']; } async detect() { return window.cameraValue ? [{ rawValue: window.cameraValue }] : []; } } });
    });
    await design.locator('#scanFabric').click();
    await design.waitForFunction(() => window.cameraTracks.length === 1 && document.querySelectorAll('#fabricScanCamera option').length === 2);
    assert.equal(await design.locator('#fabricScanSettings').isVisible(), false);
    await settings(); await design.locator('#fabricScanCamera').selectOption('two');
    await design.waitForFunction(() => window.cameraTracks.length === 2 && window.cameraTracks[0].readyState === 'ended');
    await design.evaluate(id => { window.cameraValue = id; }, ids.piping);
    const settingsHistory = (await read()).history; await design.waitForTimeout(350);
    assert.equal((await read()).history, settingsHistory, 'Camera scanning pauses while settings are open');
    await design.getByRole('button', { name: '返回扫码', exact: true }).click();
    await design.waitForFunction(id => readScanState().slots[2].values[0].id === id, ids.piping, { timeout: 15000 });
    const cameraHistory = (await read()).history; await design.waitForTimeout(1300); assert.equal((await read()).history, cameraHistory);
    await design.screenshot({ path: 'outputs/fabric-scan/scanner-desktop.png' });
    await design.keyboard.press('Escape'); assert.equal(await design.evaluate(() => window.cameraTracks.every(track => track.readyState === 'ended')), true);
    await design.evaluate(() => { window.cameraDenied = true; }); await design.locator('#scanFabric').click();
    await design.waitForFunction(() => document.getElementById('fabricScanStatus').textContent.includes('权限被拒绝'));
    await settings(); await design.evaluate(() => { window.cameraDenied = false; window.cameraValue = ''; }); await design.locator('.fabric-scan-camera').click();
    await design.waitForFunction(() => window.cameraTracks.length === 3 && document.querySelector('.fabric-scan-camera').textContent === '关闭摄像头');
    await design.locator('.fabric-scan-camera').click();
    assert.equal(await design.evaluate(() => window.cameraTracks.every(track => track.readyState === 'ended')), true);
    await design.screenshot({ path: 'outputs/fabric-scan/scanner-settings-desktop.png' });
    await design.keyboard.press('Escape');
    // A failed first camera session can be recovered by returning from settings;
    // the primary square view must not retain the stale recognition error.
    await design.evaluate(() => {
      window.cameraRetryCalls = 0;
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
        window.cameraRetryCalls++;
        if (window.cameraRetryCalls === 1) throw new DOMException('temporary camera failure', 'NotReadableError');
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 320;
        const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 320, 320);
        const stream = canvas.captureStream(10); window.cameraTracks.push(...stream.getTracks()); return stream;
      } });
    });
    await design.locator('#scanFabric').click();
    await design.waitForFunction(() => document.getElementById('fabricScanStatus').textContent.includes('摄像头无法使用'));
    await design.getByRole('button', { name: '扫码设置', exact: true }).click();
    await design.getByRole('button', { name: '返回扫码', exact: true }).click();
    await design.waitForFunction(() => document.querySelector('.fabric-scan-camera').textContent === '关闭摄像头');
    assert.equal(await design.locator('#fabricScanStatus').getAttribute('data-state'), '');
    await design.locator('#scanFabric').click();
    await design.locator('#scanFabric').click();
    // WebKit can collapse a dialog whose children are all absolutely positioned.
    // Exercise the explicit height without relying on aspect-ratio sizing.
    const tabletSizing = await design.addStyleTag({ content: '.fabric-scan-dialog:not(.is-settings){aspect-ratio:auto}' });
    for (const [name, width, height] of [['landscape', 1194, 700], ['portrait', 834, 1080], ['landscape-toolbar-hidden', 1194, 780]]) {
      await design.setViewportSize({ width, height });
      await design.waitForFunction(() => {
        const scan = document.getElementById('fabricScanDialog').getBoundingClientRect();
        const dock = document.getElementById('materialDock').getBoundingClientRect();
        return scan.height >= 120 && Math.abs(scan.width - scan.height) < 1 && scan.x >= 0 && scan.y >= 0 && scan.right <= innerWidth && scan.bottom < dock.top;
      });
      assert.equal((await design.locator('#fabricScanDialog').boundingBox()).height, 224, name + ': tablet camera keeps its height');
      assert.ok((await design.locator('.fabric-scan-video').boundingBox()).height > 200, name + ': video is visible');
      const guide = await design.locator('.fabric-scan-guide').boundingBox();
      const view = await design.locator('.fabric-scan-camera-view').boundingBox();
      assert.ok(Math.abs(guide.width / view.width - .8) < .01, name + ': guide stays at 80%');
      await settings();
      assert.ok((await design.locator('#fabricScanDialog').boundingBox()).height > 224, name + ': settings expands for its controls');
      await design.getByRole('button', { name: '返回扫码', exact: true }).click();
      assert.equal((await design.locator('#fabricScanDialog').boundingBox()).height, 224, name + ': returning restores the square camera');
      await design.screenshot({ path: 'outputs/fabric-scan/scanner-ipad-' + name + '.png' });
    }
    await tabletSizing.evaluate(style => style.remove());
    await design.setViewportSize({ width: 390, height: 844 }); assert.equal(await design.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.equal(await design.locator('#scanFabric').isVisible(), true);
    const mobileCamera = await design.locator('#fabricScanDialog').boundingBox();
    assert.ok(Math.abs(mobileCamera.width - mobileCamera.height) < 1 && mobileCamera.x >= 0 && mobileCamera.y >= 0);
    assert.equal(mobileCamera.width, 216, 'Mobile camera window is compact');
    await design.screenshot({ path: 'outputs/fabric-scan/scanner-mobile.png' });
    await settings(); await design.screenshot({ path: 'outputs/fabric-scan/scanner-settings-mobile.png' });
    await design.keyboard.press('Escape'); await design.setViewportSize({ width: 1440, height: 1000 });
    // Closing while permission is pending must release a stream that arrives later.
    await design.evaluate(() => {
      window.cameraOpenCalls = 0;
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
        window.cameraOpenCalls++;
        await new Promise(resolve => { window.releasePendingCamera = resolve; });
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 320;
        const stream = canvas.captureStream(10); window.cameraTracks.push(...stream.getTracks()); return stream;
      } });
    });
    await design.locator('#scanFabric').click(); await design.waitForFunction(() => window.cameraOpenCalls === 1);
    await design.locator('#scanFabric').click();
    await design.evaluate(() => window.releasePendingCamera());
    await design.waitForFunction(() => window.cameraTracks.every(track => track.readyState === 'ended'));
    assert.equal(await design.locator('#scanFabric').getAttribute('aria-expanded'), 'false');
    // Feed a real label through the square video crop and local ZXing decoder.
    // Start from a different material so a stale assignment cannot pass the test.
    await design.locator('#scanFabric').click();
    assert.match(await scan(ids.edge), /最新边布/);
    await design.locator('#scanFabric').click();
    assert.equal((await read()).slots[1].values[0].id, ids.edge);
    const beforeCameraDecode = (await read()).history;
    await design.evaluate(async id => {
      clearInterval(window.cameraCanvasTimer);
      Object.defineProperty(window, 'BarcodeDetector', { value: undefined, configurable: true });
      const { fabricQrSvg } = await import('./shared/fabric-label.js');
      const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fabricQrSvg(id)); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d');
      const draw = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 480); ctx.drawImage(image, 140, 60, 360, 360); };
      draw(); window.cameraCanvasTimer = setInterval(draw, 100);
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { const stream = canvas.captureStream(10); window.cameraTracks.push(...stream.getTracks()); return stream; } });
    }, editorId);
    await design.locator('#scanFabric').click();
    await design.waitForFunction(id => readScanState().slots[1].values[0].id === id, editorId, { timeout: 15000 });
    assert.equal((await read()).history, beforeCameraDecode + 1, 'Decoding a camera frame must perform a replacement');
    assert.match(await design.locator('#fabricScanStatus').textContent(), /已将“边布”/);
    await design.locator('#scanFabric').click();
    assert.equal(await design.evaluate(() => window.cameraTracks.every(track => track.readyState === 'ended')), true);
    const expectedSlots = (await read()).slots, project = await saveOnlineProject(design);
    await openOnlineProject(design, project); assert.deepEqual((await read()).slots, expectedSlots);
    assert.deepEqual(errors, []); await context.close();
    console.log('PASS: save pending/failure/retry, identity, QR roundtrip, label download/print, category replacement, latest version, local edit reset, download failure/retry, undo, cancel, camera switch/denial/cleanup, duplicate suppression, mobile and project roundtrip');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
