import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packMaterial } from '../shared/material-package.js';
import { assetPage } from '../shared/asset-metadata.js';

function storage(initial = []) {
  const records = new Map(initial.map(asset => [asset.id, structuredClone(asset)]));
  const index = new Map(initial.map(({ maps, runtimeMaps, file, resources, ...asset }) => [asset.id, asset]));
  const stores = { assets: records, assetIndex: index };
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { transaction() {
        const tx = {}; let pending = 0, finished = false;
        tx.abort = () => { finished = true; queueMicrotask(() => tx.onabort?.()); };
        tx.objectStore = name => {
          const collection = stores[name];
          const operation = run => {
            const result = {}; pending++;
            queueMicrotask(() => {
              if (finished) return;
              result.result = structuredClone(run()); result.onsuccess?.(); pending--;
              queueMicrotask(() => { if (!pending && !finished) { finished = true; tx.oncomplete?.(); } });
            });
            return result;
          };
          return { getAll: () => operation(() => [...collection.values()]), get: id => operation(() => collection.get(id)), put: asset => operation(() => { collection.set(asset.id, structuredClone(asset)); return asset.id; }), delete: id => operation(() => collection.delete(id)) };
        };
        return tx;
      } }; request.onsuccess();
    }); return request;
  } }; return stores;
}
const freshStore = () => import('../shared/asset-store.js?test=' + crypto.randomUUID());
const definition = (id, version = 'v1') => ({ id, version, name: id, category: '面布', physical: { widthCm: 10, heightCm: 8 }, url: './' + id + '.formmat', preview: './previews/' + id + '.png' });
const packageBytes = await (await packMaterial({ kind: 'material', name: '测试', surface: { color: '#ffffff' }, maps: {} })).arrayBuffer();

test('listing reads only metadata; duplicate opens download one package; subsequent opens use the cached file', async t => {
  storage(); const calls = [];
  t.mock.method(globalThis, 'fetch', async url => { calls.push(String(url)); return String(url).includes('manifest.json') ? Response.json([definition('first'), definition('second')]) : new Response(packageBytes.slice(0)); });
  const store = await freshStore(), list = await store.listAssets();
  assert.equal(list.length, 2); assert.equal(calls.length, 1);
  assert.equal(list[0].maps, undefined); assert.match(list[0].preview, /previews\/first.png/);
  const [a, b] = await Promise.all([store.getAsset('first'), store.getAsset('first')]);
  assert.equal(a.id, b.id); assert.deepEqual(a.maps, {});
  assert.equal(calls.filter(url => url.includes('.formmat')).length, 1);
  await store.getAsset('first'); await store.listAssets();
  assert.equal(calls.length, 2);
});
test('metadata updates and deletion never hydrate textures', async t => {
  const data = storage(); let packages = 0;
  t.mock.method(globalThis, 'fetch', async url => { if (!String(url).includes('manifest.json')) packages++; return Response.json([definition('first')]); });
  const store = await freshStore(); await store.listAssets();
  await store.updateAsset('first', { name: '改名', favorite: true, parentId: 'folder' });
  const [asset] = await store.listAssets(); assert.equal(asset.name, '改名'); assert.equal(asset.favorite, true);
  assert.equal(data.assets.size, 0); assert.equal(packages, 0);
  await store.deleteAsset('first'); assert.equal((await store.listAssets()).length, 0);
});
test('offline catalog preserves local records and can retry; failed package loads can retry independently', async t => {
  storage([{ id: 'local', kind: 'material', name: '本地素材', maps: {} }]); let offline = true, invalid = true;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('manifest.json')) { if (offline) throw new Error('offline'); return Response.json([definition('remote')]); }
    return new Response(invalid ? 'not a zip' : packageBytes.slice(0));
  });
  const store = await freshStore(); let progress;
  assert.equal((await store.listAssets({ onProgress: (_, value) => { progress = value; } }))[0].id, 'local');
  assert.equal(progress.loading, false); assert.match(progress.message, /offline/);
  offline = false; assert.equal((await store.listAssets()).length, 2);
  await assert.rejects(store.getAsset('remote'));
  invalid = false; assert.equal((await store.getAsset('remote')).id, 'remote');
});
test('catalog versions invalidate only the requested package', async t => {
  storage(); let version = 'v1', packages = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('manifest.json')) return Response.json([definition('first', version)]);
    packages++; return new Response(packageBytes.slice(0));
  });
  const store = await freshStore(); await store.listAssets(); await store.getAsset('first');
  version = 'v2'; const [summary] = await store.listAssets({ refreshCatalog: true });
  assert.equal(summary.builtinVersion, 'v2'); assert.equal(packages, 1);
  assert.equal((await store.getAsset('first')).builtinVersion, 'v2'); assert.equal(packages, 2);
});
test('page boundaries handle 0, 30, 31, 65 items and clamp after removal', () => {
  for (const size of [0, 30, 31, 65]) {
    const items = Array.from({ length: size }, (_, id) => id), first = assetPage(items, 1), last = assetPage(items, 999);
    assert.ok(first.items.length <= 30); assert.ok(last.items.length <= 30);
    assert.equal(last.page, Math.max(1, Math.ceil(size / 30)));
    assert.deepEqual(Array.from({ length: last.totalPages }, (_, i) => assetPage(items, i + 1).items).flat(), items);
  }
  assert.equal(assetPage([1], 3).page, 1);
});
