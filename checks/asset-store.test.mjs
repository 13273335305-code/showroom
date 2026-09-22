import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packMaterial } from '../shared/material-package.js';

// Small asynchronous storage double; package parsing and fetch responses are real.
function storage(initial = []) {
  const records = new Map(initial.map(asset => [asset.id, asset]));
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { transaction() {
        const tx = {};
        tx.objectStore = () => {
          const operation = run => {
            const result = {};
            queueMicrotask(() => { result.result = structuredClone(run()); tx.oncomplete(); });
            return result;
          };
          return {
            getAll: () => operation(() => [...records.values()]),
            get: id => operation(() => records.get(id)),
            put: asset => operation(() => { records.set(asset.id, structuredClone(asset)); return asset.id; }),
          };
        };
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } };
  return records;
}
const freshStore = () => import('../shared/asset-store.js?test=' + crypto.randomUUID());
const definition = (id, version = 'v1') => ({ id, version, name: id, category: '面布', url: './' + id + '.formmat' });
const packageBytes = await (await packMaterial({ kind: 'material', name: '测试', surface: { color: '#ffffff' }, maps: {} })).arrayBuffer();
const materialResponse = () => new Response(packageBytes.slice(0));
function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('cached and newly downloaded assets appear while the next download is pending; cached editing does not wait', async t => {
  const old = { id: 'old', name: '旧素材', kind: 'material', builtinVersion: 'v1' };
  storage([old]);
  const manifest = gate(), slow = gate(), started = gate();
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.pathname.endsWith('manifest.json')) return manifest.promise;
    if (url.pathname.endsWith('slow.formmat')) { started.resolve(); return slow.promise; }
    return materialResponse();
  });
  const store = await freshStore(), snapshots = [];
  const initial = gate();
  const pending = store.listAssets({ onProgress(items, progress) {
    snapshots.push({ ids: items.map(item => item.id), ...progress });
    initial.resolve();
  } });
  await initial.promise;
  assert.deepEqual(snapshots[0].ids, ['old']);
  assert.equal(snapshots[0].loading, true);
  manifest.resolve(Response.json([definition('old'), definition('first'), definition('slow')]));
  await started.promise;
  assert.ok(snapshots.some(s => s.ids.includes('first') && s.loading));
  assert.deepEqual(await store.getAsset('old'), old);
  const secondSnapshots = [];
  const second = store.listAssets({ onProgress: items => secondSnapshots.push(items.length) });
  slow.resolve(materialResponse());
  assert.equal((await pending).length, 3);
  assert.equal((await second).length, 3);
  assert.ok(secondSnapshots.includes(3));
  assert.equal(snapshots.at(-1).loading, false);
  assert.equal(snapshots.at(-1).message, '');
});

test('failed downloads and invalid packages keep old versions, continue to later assets, and can retry', async t => {
  storage([{ id: 'broken', name: '旧版本', builtinVersion: 'v0' }]);
  let fail = true;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.pathname.endsWith('manifest.json')) return Response.json(['broken', 'corrupt', 'good'].map(id => definition(id)));
    if (fail && url.pathname.endsWith('broken.formmat')) return new Response('', { status: 404 });
    if (fail && url.pathname.endsWith('corrupt.formmat')) return new Response('not a zip');
    return materialResponse();
  });
  const store = await freshStore();
  let final;
  const first = await store.listAssets({ onProgress: (_, progress) => { final = progress; } });
  assert.deepEqual(first.map(a => a.id), ['broken', 'good']);
  assert.equal(first[0].builtinVersion, 'v0');
  assert.match(final.message, /broken.*404/);
  assert.match(final.message, /corrupt/);
  assert.equal(final.completed, 3);
  fail = false;
  const retried = await store.listAssets({ onProgress: (_, progress) => { final = progress; } });
  assert.equal(retried.length, 3);
  assert.equal(retried.find(a => a.id === 'broken').builtinVersion, 'v1');
  assert.equal(final.message, '');
});

test('manifest network and format failures preserve saved assets', async t => {
  for (const response of [() => { throw new Error('offline'); }, () => Response.json({ invalid: true })]) {
    storage([{ id: 'saved', name: '已保存' }]);
    const fetchMock = t.mock.method(globalThis, 'fetch', response);
    const store = await freshStore();
    let final;
    assert.equal((await store.listAssets({ onProgress: (_, progress) => { final = progress; } }))[0].id, 'saved');
    assert.equal(final.loading, false);
    assert.match(final.message, /素材同步失败/);
    fetchMock.mock.restore();
  }
});

test('stalled response bodies time out and later assets still load', async t => {
  storage();
  const realTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, ms) => realTimeout(callback, ms === 120000 ? 5 : ms));
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    if (url.pathname.endsWith('manifest.json')) return Response.json([definition('stalled'), definition('good')]);
    if (url.pathname.endsWith('stalled.formmat')) return { ok: true, arrayBuffer: () => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }) };
    return materialResponse();
  });
  const store = await freshStore();
  let final;
  assert.deepEqual((await store.listAssets({ onProgress: (_, progress) => { final = progress; } })).map(a => a.id), ['good']);
  assert.match(final.message, /stalled（下载超时）/);
});
