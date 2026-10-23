const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';
const alice = '11111111-1111-1111-1111-111111111111';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: {width:1440,height:1000} });
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType:'text/javascript', body:`export async function requireAuth() { document.documentElement.classList.remove('auth-pending'); document.getElementById('authBootLoading')?.remove(); } export const authState = () => ({id:window.testOwner || '${alice}'});` }));
    const state = await require('./project-test-server.cjs').installProjectFixture(context);
    let holding = true, releaseUploads;
    const gate = new Promise(resolve => { releaseUploads = resolve; });
    let fail = false, commits = 0;
    await context.route('**/__cloud_test/objects/**', async route => {
      if (holding && route.request().method() === 'PUT') await gate;
      try { await route.fallback(); } catch {}
    });
    await context.route('**/__cloud_test/rpc', async route => {
      const payload = route.request().postDataJSON();
      if (payload.name === 'spenic_save_asset') {
        if (fail) { await route.fulfill({json:{error:{message:'Simulated network failure'}}}); return; }
        commits++;
      }
      await route.fallback();
    });
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const library = await context.newPage(); await library.goto(base + '/asset-library.html');
    const ready = page => page.waitForFunction(() => document.getElementById('assetPanel').getAttribute('aria-busy') === 'false');
    const waitCompleted = async (page, ids) => {
      const deadline = Date.now() + 60000;
      for (;;) {
        const tasks = await page.evaluate(async () => await (await import('./shared/upload-queue.js')).listUploads());
        if (ids.every(id => tasks.find(task => task.id === id)?.status === 'completed')) return;
        if (Date.now() > deadline) throw new Error('Tasks did not finish: ' + JSON.stringify(tasks));
        await page.waitForTimeout(100);
      }
    };
    await ready(library);
    assert.equal(await library.locator('#uploadTasksButton').isVisible(), false, 'Upload button is hidden without unfinished tasks');
    assert.equal(await library.locator('#uploadTasksPanel').isVisible(), false);
    const editor = await context.newPage(); await editor.goto(base + '/material-editor.html');
    await editor.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    await editor.locator('#name').fill('Background fabric');
    await editor.locator('#map-map').setInputFiles('checks/fabric-no-dpi.png');
    await editor.waitForFunction(() => !document.getElementById('saveMaterial').disabled && document.getElementById('upload-map').classList.contains('has-image'));
    await editor.locator('#saveMaterial').click(); await editor.locator('#confirmPreviewGeneration').click();
    await editor.waitForFunction(() => !document.getElementById('previewGenerationDialog').open && document.getElementById('status').textContent === '已加入后台上传任务');
    assert.equal(await editor.locator('#saveMaterial').isEnabled(), true, 'Editor is usable before upload completes');
    const first = new URL(editor.url()).searchParams.get('upload'); assert.ok(first);
    await library.waitForFunction(() => document.getElementById('uploadTasksBadge').textContent === '1');
    assert.equal(await library.locator('#uploadTasksButton').isVisible(), true, 'New uploads reveal the button across tabs');
    await library.locator('#uploadTasksButton').click();
    await library.locator(`[data-task-id="${first}"][data-status="uploading"]`).waitFor();
    await editor.locator('#name').fill('Background fabric updated');
    await editor.locator('#saveMaterial').click(); await editor.locator('#confirmPreviewGeneration').click();
    await editor.waitForFunction(previous => new URL(location.href).searchParams.get('upload') !== previous && !document.getElementById('previewGenerationDialog').open, first);
    const second = new URL(editor.url()).searchParams.get('upload');
    const queuedEditorUrl = editor.url();
    assert.ok(new URL(queuedEditorUrl).searchParams.get('asset'), 'Queued editor URL retains the reserved asset ID');
    await library.waitForFunction(() => document.getElementById('uploadTasksBadge').textContent === '2');
    await library.locator(`[data-task-id="${second}"][data-status="queued"]`).waitFor();
    for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
      await library.setViewportSize(viewport);
      await library.locator('#uploadTasksPanel').waitFor();
      const box = await library.locator('#uploadTasksPanel').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1);
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1);
      assert.equal(await library.locator('#uploadTasksButton img').evaluate(image => image.naturalWidth > 0), true);
      await library.screenshot({path:`checks/upload-tasks-active-${viewport.width}.png`});
    }
    await editor.reload(); await editor.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    assert.equal(await editor.locator('#name').inputValue(), 'Background fabric updated', 'Reload restores the queued snapshot');
    await editor.close();
    holding = false; releaseUploads();
    await waitCompleted(library, [first,second]);
    assert.equal(state.assets.size, 1, 'Two consecutive saves update one asset');
    assert.equal([...state.assets.values()][0].name, 'Background fabric updated');
    assert.equal(commits, 2, 'Multiple tabs do not duplicate commits');
    await library.waitForFunction(() => document.querySelector('.asset-card h2')?.textContent === 'Background fabric updated');
    await ready(library); assert.equal(await library.locator('#uploadTasksBadge').isVisible(), false);
    assert.equal(await library.locator('#uploadTasksButton').isVisible(), false, 'Completed history does not keep the button visible');
    assert.equal(await library.locator('#uploadTasksPanel').isVisible(), false, 'The panel closes when all uploads finish');
    assert.equal(await library.locator('#uploadTasksButton').getAttribute('aria-expanded'), 'false');
    await library.evaluate(async () => (await import('./shared/upload-queue.js')).clearCompletedUploads());
    await library.waitForFunction(() => document.getElementById('uploadTasksList').textContent === '暂无上传任务');
    const recovered = await context.newPage(); await recovered.goto(queuedEditorUrl);
    await recovered.waitForFunction(() => document.getElementById('name').value === 'Background fabric updated' && !document.getElementById('saveMaterial').disabled);
    assert.equal(await recovered.locator('#name').inputValue(), 'Background fabric updated', 'Clearing upload history preserves editor URL recovery');
    await recovered.close();
    await library.setViewportSize({width:1440,height:1000});
    await library.screenshot({path:'checks/upload-tasks-populated-1440.png'});
    await library.setViewportSize({width:390,height:844});
    fail = true;
    const failed = await library.evaluate(async () => {
      const { enqueueMaterialUpload } = await import('./shared/upload-queue.js');
      const image = await (await fetch('./checks/fabric-no-dpi.png')).blob();
      const asset = {kind:'material',name:'Retry fabric',category:'边布',materialType:'fabric',physical:{widthCm:40,heightCm:30},preview:image,maps:{map:new File([image],'retry.png',{type:'image/png'})}};
      const task = await enqueueMaterialUpload(asset); asset.name = 'Must not overwrite snapshot'; return task.id;
    });
    await library.locator('#uploadTasksButton').waitFor();
    await library.locator('#uploadTasksButton').click();
    await library.locator(`[data-task-id="${failed}"][data-status="failed"]`).waitFor({timeout:60000});
    assert.equal(await library.locator('#uploadTasksBadge').textContent(), '1');
    assert.match(await library.locator(`[data-task-id="${failed}"] .upload-task-error`).textContent(), /Simulated network failure/);
    await library.screenshot({path:'checks/upload-tasks-failed-390.png'});
    fail = false;
    await library.locator(`[data-task-id="${failed}"] .upload-task-retry`).click();
    await library.locator(`[data-task-id="${failed}"][data-status="completed"]`).waitFor({state:'attached',timeout:60000});
    assert.equal(await library.locator('#uploadTasksButton').isVisible(), false, 'Successful retry hides the button again');
    assert.equal(state.assets.size, 2); assert.ok([...state.assets.values()].some(asset => asset.name === 'Retry fabric'));
    fail = true;
    const deleted = await library.evaluate(async () => {
      const { enqueueMaterialUpload } = await import('./shared/upload-queue.js');
      const image = await (await fetch('./checks/fabric-no-dpi.png')).blob();
      const asset = {kind:'material',name:'Delete failed fabric',category:'面布',preview:image,maps:{map:new File([image],'delete.png',{type:'image/png'})}};
      const first = await enqueueMaterialUpload(asset);
      const next = await enqueueMaterialUpload({...asset,id:first.targetAssetId,name:'Later save'}, {dependsOn:first.id});
      return {first:first.id,next:next.id};
    });
    await library.locator('#uploadTasksButton').click();
    await library.locator(`[data-task-id="${deleted.first}"][data-status="failed"]`).waitFor();
    assert.equal(await library.locator(`[data-task-id="${deleted.next}"] .upload-task-delete`).count(), 0, 'Queued uploads cannot be deleted as failures');
    const protectedTasks = await library.evaluate(async ({first,next,completed}) => {
      const { deleteFailedUpload, getUpload } = await import('./shared/upload-queue.js');
      const queued = await deleteFailedUpload(next), done = await deleteFailedUpload(completed);
      window.testOwner = '22222222-2222-2222-2222-222222222222';
      let otherAccount;
      try { otherAccount = await deleteFailedUpload(first); } finally { window.testOwner = null; }
      return {queued,done,otherAccount,retained:(await getUpload(first)).status};
    }, {...deleted,completed:failed});
    assert.deepEqual(protectedTasks,{queued:false,done:false,otherAccount:false,retained:'failed'});
    const mirror = await context.newPage(); await mirror.goto(base + '/asset-library.html');
    await mirror.waitForFunction(() => document.getElementById('uploadTasksBadge').textContent === '2');
    for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
      await library.setViewportSize(viewport);
      const button = await library.locator(`[data-task-id="${deleted.first}"] .upload-task-delete`).boundingBox();
      const panel = await library.locator('#uploadTasksPanel').boundingBox();
      assert.ok(button.x >= panel.x && button.x + button.width <= panel.x + panel.width);
    }
    await library.locator(`[data-task-id="${deleted.first}"] .upload-task-delete`).click();
    await library.locator(`[data-task-id="${deleted.first}"]`).waitFor({state:'detached'});
    await mirror.locator(`[data-task-id="${deleted.first}"]`).waitFor({state:'detached'});
    await library.locator(`[data-task-id="${deleted.next}"][data-status="failed"]`).waitFor();
    assert.match(await library.locator(`[data-task-id="${deleted.next}"] .upload-task-error`).textContent(), /前一上传任务已删除/);
    assert.equal(await library.locator('#uploadTasksBadge').textContent(), '1');
    assert.equal(await library.evaluate(async id => (await import('./shared/upload-queue.js')).getUpload(id), deleted.first), null);
    await library.locator(`[data-task-id="${deleted.next}"] .upload-task-delete`).click();
    await library.locator('#uploadTasksButton').waitFor({state:'hidden'});
    await mirror.locator('#uploadTasksButton').waitFor({state:'hidden'});
    assert.equal(await library.locator('#uploadTasksPanel').isVisible(), false, 'Deleting the last failure closes the panel');
    await mirror.reload(); await ready(mirror);
    assert.equal(await mirror.evaluate(async ids => {
      const { listUploads } = await import('./shared/upload-queue.js');
      return (await listUploads()).some(task => ids.includes(task.id));
    }, Object.values(deleted)), false, 'Deleted tasks stay removed after reload');
    await mirror.close();
    assert.equal(state.assets.size, 2, 'Deleting upload tasks leaves cloud assets intact');
    fail = false;
    await context.setOffline(true);
    const resumed = await library.evaluate(async () => {
      const { enqueueMaterialUpload } = await import('./shared/upload-queue.js');
      return (await enqueueMaterialUpload({kind:'material',name:'Resume fabric',category:'其他',materialType:'fabric',maps:{},preview:null})).id;
    });
    await library.locator(`[data-task-id="${resumed}"][data-status="queued"]`).waitFor({state:'attached'});
    assert.equal(await library.locator('#uploadTasksButton').isVisible(), true);
    await library.close(); await context.setOffline(false);
    const restored = await context.newPage(); await restored.goto(base + '/asset-library.html');
    await waitCompleted(restored, [resumed]);
    assert.equal(state.assets.size, 3, 'Persistent task resumes after all old pages close');
    await restored.locator(`[data-task-id="${resumed}"][data-status="completed"]`).waitFor({state:'attached'});
    assert.equal(await restored.locator('#uploadTasksButton').isVisible(), false);
    await restored.evaluate(() => { window.testOwner = '22222222-2222-2222-2222-222222222222'; });
    assert.equal(await restored.evaluate(async () => (await (await import('./shared/upload-queue.js')).listUploads()).length), 0, 'Task list is isolated by account');
    assert.equal(await restored.evaluate(async id => await (await import('./shared/upload-queue.js')).getUpload(id,{payload:true}), resumed), null);
    await restored.evaluate(() => { window.testOwner = null; });
    const payloadCount = await restored.evaluate(() => new Promise((resolve,reject) => {
      const request = indexedDB.open('spenic-upload-tasks-v1',1);
      request.onsuccess = () => { const db = request.result, count = db.transaction('payloads').objectStore('payloads').count(); count.onsuccess = () => { resolve(count.result); db.close(); }; };
      request.onerror = () => reject(request.error);
    }));
    assert.equal(payloadCount, 0, 'Completed jobs release the stored files');
    assert.deepEqual(errors, []);
    console.log('Upload task workflow passed: immediate editor release, badge/list, snapshots, ordered saves, cross-tab deduplication, page reload/closure recovery, failure/retry/delete, dependent saves, account isolation, file cleanup, desktop/mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
