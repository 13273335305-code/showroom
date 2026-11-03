import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const helper = app.slice(app.indexOf('async function ensureCaptureProject(){'), app.indexOf('async function captureFrameBlob('));
function harness({ existing = null, saved = { id: 'saved-project' }, fail = false, guest = false } = {}) {
  let saves = 0;
  const make = new Function('isGuest', 'isDesign', 'workspaceClient', 'getStoredProject', 'saveProject', `let loadingModel=false,model={},modelGeneration=1,activeProjectId=${JSON.stringify(existing?.id || null)}; ${helper};return {ensure:ensureCaptureProject,switch(){modelGeneration++;}};`);
  const runtime = make(() => guest, () => true, async () => ({ userId: 'owner' }), async () => existing, async () => { saves++; if (fail) throw new Error('保存失败'); return saved; });
  return { ...runtime, saves: () => saves };
}
test('first capture saves a project, existing owned captures reuse it and public projects create owned copies', async () => {
  const fresh = harness(); assert.equal(await fresh.ensure(), 'saved-project'); assert.equal(fresh.saves(), 1);
  const own = harness({ existing: { id: 'owned-project', ownerId: 'owner' } }); assert.equal(await own.ensure(), 'owned-project'); assert.equal(own.saves(), 0);
  const publicProject = harness({ existing: { id: 'public-project', ownerId: 'other' } }); assert.equal(await publicProject.ensure(), 'saved-project'); assert.equal(publicProject.saves(), 1);
});
test('failed save, incomplete annotations, guest mode and a project switch stop capture association', async () => {
  await assert.rejects(harness({ fail: true }).ensure(), /保存失败/);
  await assert.rejects(harness({ saved: null }).ensure(), /未保存/);
  await assert.rejects(harness({ guest: true }).ensure(), /可出图/);
  const runtime = harness(); const promise = runtime.ensure(); runtime.switch(); await assert.rejects(promise, /切换/);
});
