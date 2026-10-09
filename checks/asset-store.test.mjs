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
const definition = (id, version = 'v1') => ({ id, version, name: id, category: '面布', physical: { widthCm: 10, heightCm: 8 }, url: './' + id + '.formmat', runtime: './runtime/' + id + '-' + version + '/material.json', preview: './previews/' + id + '.png' });
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

const runtimeDefinition = (version = 'v1', maps = { map: { url: './color.png', type: 'image/png', prepared: true } }) => ({ format: 'SPENIC-MATERIAL-RUNTIME', version: 1, sourceVersion: version, surface: { color: '#ffffff', roughness: .65 }, physical: { mode: 'physical', sizeSource: 'manual', widthCm: 10, heightCm: 8 }, maps });

test('runtime opens fetch only independent channels, share concurrent jobs, cache files and defer the source package', async t => {
  storage(); const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const value = String(url); calls.push(value);
    if (value.includes('manifest.json')) return Response.json([definition('first'), definition('unused')]);
    if (value.endsWith('material.json')) return Response.json(runtimeDefinition());
    if (value.endsWith('color.png')) return new Response(new Uint8Array([1, 2, 3]));
    return new Response(packageBytes.slice(0));
  });
  const store = await freshStore(); await store.listAssets();
  const [a, b] = await Promise.all([store.getAsset('first', { runtime: true }), store.getAsset('first', { runtime: true })]);
  assert.equal(a.runtimeOnly, true); assert.equal(b.runtimeOnly, true);
  assert.ok(a.runtimeMaps.map instanceof File);
  assert.equal(a.physical.widthCm, 10);
  assert.equal(calls.filter(url => url.endsWith('material.json')).length, 1);
  assert.equal(calls.filter(url => url.endsWith('color.png')).length, 1);
  assert.equal(calls.some(url => url.includes('.formmat')), false);
  assert.equal(calls.some(url => url.includes('unused-')), false);
  await store.getAsset('first', { runtime: true }); assert.equal(calls.length, 3);
  const full = await store.getAsset('first');
  assert.equal(full.runtimeOnly, undefined); assert.equal(full.name, 'first');
  assert.equal(calls.filter(url => url.includes('.formmat')).length, 1);
  await store.getMaterialSource(a.sourcePackage);
  await store.getAsset('first', { runtime: true });
  assert.equal(calls.length, 4, 'Source upgrade retains prepared runtime files');
});

test('simultaneous source and runtime downloads retain both cache levels', async t => {
  const records = storage(), calls = [];
  const originalBytes = await (await packMaterial({ kind: 'material', name: '测试', surface: { color: '#ffffff' }, maps: { map: new File([new Uint8Array([9, 8, 7])], 'original.png', { type: 'image/png' }) } })).arrayBuffer();
  let releaseSource, releaseRuntime;
  t.mock.method(globalThis, 'fetch', async url => {
    const value = String(url); calls.push(value);
    if (value.includes('manifest.json')) return Response.json([definition('first')]);
    if (value.endsWith('material.json')) return Response.json(runtimeDefinition());
    if (value.endsWith('color.png')) {
      await new Promise(resolve => { releaseRuntime = resolve; });
      return new Response(new Uint8Array([1]));
    }
    await new Promise(resolve => { releaseSource = resolve; });
    return new Response(originalBytes.slice(0));
  });
  const store = await freshStore(); await store.listAssets();
  const runtime = store.getAsset('first', { runtime: true }), source = store.getAsset('first');
  while (!releaseSource || !releaseRuntime) await new Promise(resolve => setImmediate(resolve));
  releaseSource(); releaseRuntime();
  await Promise.all([runtime, source]);
  const cached = records.assets.get('first');
  assert.notEqual(cached.runtimeOnly, true);
  assert.equal(cached.maps.map.size, 3);
  assert.equal(cached.runtimeMaps.map.size, 1);
  await store.getAsset('first'); await store.getAsset('first', { runtime: true });
  assert.equal(calls.length, 4);
});

test('a failed runtime channel never caches a partial material and retry reloads it', async t => {
  const stores = storage(); let fail = true, colorLoads = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    const value = String(url);
    if (value.includes('manifest.json')) return Response.json([definition('first')]);
    if (value.endsWith('material.json')) return Response.json(runtimeDefinition('v1', { map: { url: 'color.png', type: 'image/png', prepared: true }, normalMap: { url: 'normal.png', type: 'image/png', prepared: true } }));
    if (value.endsWith('color.png')) colorLoads++;
    if (value.endsWith('normal.png') && fail) return new Response('', { status: 503 });
    return new Response(new Uint8Array([1]));
  });
  const store = await freshStore(); await store.listAssets();
  await assert.rejects(store.getAsset('first', { runtime: true }), /503/);
  assert.equal(stores.assets.size, 0);
  fail = false;
  const asset = await store.getAsset('first', { runtime: true });
  assert.deepEqual(Object.keys(asset.maps).sort(), ['map', 'normalMap']);
  assert.equal(colorLoads, 2);
});

test('runtime versions invalidate files and a version change during download cannot overwrite the new catalog', async t => {
  const stores = storage(); let version = 'v1', release;
  let delay = false;
  t.mock.method(globalThis, 'fetch', async url => {
    const value = String(url);
    if (value.includes('manifest.json')) return Response.json([definition('first', version)]);
    if (value.endsWith('material.json')) return Response.json(runtimeDefinition(value.includes('v1') ? 'v1' : 'v2'));
    if (delay) await new Promise(resolve => { release = resolve; });
    return new Response(new Uint8Array([1]));
  });
  const store = await freshStore(); await store.listAssets();
  delay = true; const opening = store.getAsset('first', { runtime: true });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  version = 'v2'; await store.listAssets({ refreshCatalog: true }); release();
  await assert.rejects(opening, /已更新/);
  assert.equal(stores.assets.size, 0);
  delay = false;
  assert.equal((await store.getAsset('first', { runtime: true })).builtinVersion, 'v2');
});

test('source downloads verify the content version before opening a replaced source package', async t => {
  storage();
  const store = await freshStore();
  t.mock.method(globalThis, 'fetch', async () => new Response(packageBytes.slice(0)));
  await assert.rejects(store.getMaterialSource({ url: 'https://example.test/replaced.formmat', version: '0'.repeat(64) }), /版本已更改/);
});

test('model catalogs stay lightweight and hydrate only the selected model and its companion resources', async t => {
  storage(); const calls = []; let version = 'v1';
  t.mock.method(globalThis, 'fetch', async url => {
    const value = String(url); calls.push(value);
    if (value.includes('manifest.json')) return Response.json([{ id: 'model', kind: 'model', name: '展厅模型', url: './models/bed.glb', version, resources: [{ name: 'normal.png', url: './models/textures/normal.png' }] }]);
    return new Response(new Uint8Array([1, 2, 3]));
  });
  const store = await freshStore(), [summary] = await store.listAssets();
  assert.equal(summary.kind, 'model'); assert.equal(summary.file, undefined); assert.equal(calls.length, 1);
  const [a, b] = await Promise.all([store.getAsset('model', { runtime: true }), store.getAsset('model')]);
  assert.equal(a.file.name, 'bed.glb'); assert.equal(b.resources[0].name, 'normal.png');
  assert.equal(calls.filter(url => url.includes('bed.glb')).length, 1);
  assert.equal(calls.filter(url => url.includes('normal.png')).length, 1);
  await store.getAsset('model'); assert.equal(calls.length, 3);
  version = 'v2'; await store.listAssets({ refreshCatalog: true }); await store.getAsset('model');
  assert.equal(calls.filter(url => url.includes('bed.glb')).length, 2);
});
