import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssetCloud } from '../shared/asset-cloud.js';
import { retainProjectSources } from '../shared/project-manifest.js';

const alice = '11111111-1111-1111-1111-111111111111', bob = '22222222-2222-2222-2222-222222222222';
function fixture() {
  const rows = new Map(), stars = new Map(), blobs = new Map(), downloads = [], fields = [];
  let userId = alice, uploads = 0, revision = 0;
  const client = {
    from(table) {
      const filters = {}; let selection = '*', operation = 'select', data, start = 0, end = 199;
      const collection = table === 'spenic_assets' ? rows : stars;
      const builder = {
        select(value = '*') { selection = value; fields.push({ table, value }); return this; },
        eq(key, value) { filters[key] = value; return this; }, order() { return this; },
        range(a, b) { start = a; end = b; return this; },
        delete() { operation = 'delete'; return this; }, upsert(row) { data = row; operation = 'upsert'; return this; },
        async maybeSingle() { return { data: [...collection.values()].find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) || null }; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (operation === 'upsert') { collection.set(data.owner_id + ':' + data.asset_id, data); return { data: null }; }
            const values = [...collection.values()].filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
            if (operation === 'delete') for (const row of values) collection.delete(row.id || row.owner_id + ':' + row.asset_id);
            return { data: values.slice(start, end + 1).map(row => selection === '*' ? row : Object.fromEntries(selection.split(',').map(key => [key, row[key]]))) };
          }).then(resolve, reject);
        },
      }; return builder;
    },
    async rpc(name, args) {
      assert.equal(name, 'spenic_save_asset');
      const row = args.asset_data, old = rows.get(row.id);
      if (old && old.owner_id !== userId) return { error: { code: '42501' } };
      if (old && old.updated_at !== args.expected_revision) return { error: { code: '40001' } };
      const next = { ...row, owner_id: userId, created_at: old?.created_at || '2026-10-09T00:00:00Z', updated_at: new Date(1800000000000 + revision++).toISOString() };
      rows.set(row.id, next); return { data: next };
    },
    storage: { from() { return { async createSignedUrls(paths) { return { data: paths.map(path => ({ path, signedUrl: 'https://assets.test/' + path })) }; } }; } },
  };
  const resources = {
    async upload(file) {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('');
      const path = userId + '/' + hash;
      if (!blobs.has(path)) { uploads++; blobs.set(path, file); }
      return { kind: 'cloud', hash, path, size: file.size, name: file.name || 'preview.png', type: file.type };
    },
    async download(ref) {
      downloads.push(ref.path);
      if (!blobs.has(ref.path)) throw new Error('Resource unavailable');
      return blobs.get(ref.path);
    },
  };
  return { cloud: createAssetCloud(async () => ({ client, userId }), resources), rows, stars, downloads, fields, blobs,
    setUser(id) { userId = id; }, get uploads() { return uploads; } };
}
const material = () => ({ kind: 'material', name: '面料', materialType: 'fabric', category: '面布',
  physical: { widthCm: 12, heightCm: 8 }, surface: { color: '#ffffff', roughness: .6 },
  maps: { map: new File(['original-color'], 'original.png', { type: 'image/png' }) }, preview: new Blob(['preview'], { type: 'image/png' }) });

test('retired material channels are never downloaded or saved, including unavailable legacy maps', async () => {
  const f = fixture(), saved = await f.cloud.save(material()), row = f.rows.get(saved.id);
  row.metadata.surface = { ...row.metadata.surface, emissive: '#ffffff', emissiveStrength: 3, bumpStrength: .2 };
  for (const key of ['bumpMap', 'emissiveMap']) {
    row.manifest.maps[key] = 'missing/' + key;
    row.manifest.runtimeMaps[key] = 'missing-runtime/' + key;
  }
  for (const runtime of [false, true]) {
    const loaded = await f.cloud.get(saved.id, { runtime });
    assert.deepEqual(Object.keys(loaded.maps), ['map']);
    assert.deepEqual(Object.keys(loaded.sourcePackage.files), ['map']);
    assert.deepEqual(loaded.surface, material().surface);
  }
  const source = await f.cloud.source({ cloud: true, files: { map: row.manifest.files[row.manifest.maps.map], bumpMap: null, emissiveMap: null } });
  assert.deepEqual(Object.keys(source.maps), ['map']);
  const updated = await f.cloud.save({ ...await f.cloud.get(saved.id), maps: { map: material().maps.map, bumpMap: new Blob(['old']), emissiveMap: new Blob(['old']) }, surface: row.metadata.surface });
  assert.deepEqual(Object.keys(updated.assetManifest.maps), ['map']);
  assert.deepEqual(f.rows.get(saved.id).metadata.surface, material().surface);
});

test('new fabric identities survive edits and forks while old assets are not enrolled', async () => {
  const f = fixture(), created = await f.cloud.save(material());
  assert.equal(created.fabricIdentityVersion, 1);
  const updated = await f.cloud.save({ ...await f.cloud.get(created.id), name: '修改面料' });
  assert.equal(updated.id, created.id); assert.equal(updated.fabricIdentityVersion, 1);
  const row = f.rows.get(created.id); delete row.metadata.fabricIdentityVersion;
  const legacy = await f.cloud.get(created.id); delete legacy.fabricIdentityVersion;
  const savedLegacy = await f.cloud.save({ ...legacy, name: '旧面料编辑' });
  assert.equal(savedLegacy.fabricIdentityVersion, undefined);
  f.setUser(bob);
  const copy = await f.cloud.save(await f.cloud.get(created.id));
  assert.notEqual(copy.id, created.id); assert.equal(copy.fabricIdentityVersion, 1);
  const pattern = await f.cloud.save({ ...material(), materialType: 'pattern' });
  assert.equal(pattern.fabricIdentityVersion, undefined);
  const variants = await Promise.all(['DBW', 'WBR'].map(fabricColorCode => f.cloud.save({ ...material(), fabricColorCode })));
  assert.equal(new Set(variants.map(asset => asset.id)).size, 2);
  assert.ok(variants.every(asset => asset.fabricIdentityVersion === 1));
});

test('fabric color codes survive saving, listing, reopening and metadata edits', async () => {
  const f = fixture(), saved = await f.cloud.save({ ...material(), fabricColorCode: 'DBW', fabricGroupId: 'batch-389', fabricDefaultColorCode: 'WBR' });
  assert.equal(f.rows.get(saved.id).metadata.fabricGroupId, 'batch-389');
  assert.equal((await f.cloud.list())[0].fabricGroupId, 'batch-389');
  assert.equal(f.rows.get(saved.id).metadata.fabricColorCode, 'DBW');
  assert.equal((await f.cloud.list())[0].fabricColorCode, 'DBW');
  const opened = await f.cloud.get(saved.id);
  assert.equal(opened.fabricDefaultColorCode, 'WBR');
  assert.equal(opened.fabricGroupId, 'batch-389');
  assert.equal(opened.fabricColorCode, 'DBW');
  await f.cloud.update(saved.id, { name: '389' });
  assert.equal((await f.cloud.list())[0].fabricDefaultColorCode, 'WBR');
  assert.equal((await f.cloud.get(saved.id)).fabricGroupId, 'batch-389');
  assert.equal((await f.cloud.get(saved.id)).fabricColorCode, 'DBW');
  await f.cloud.save({ ...await f.cloud.get(saved.id), fabricColorCode: '' });
  assert.equal((await f.cloud.get(saved.id)).fabricColorCode, '');
});

test('card covers use the saved preview without downloading source or runtime textures', async () => {
  const f = fixture();
  const saved = await f.cloud.save({ ...material(), previewInfo: { widthPx: 400, heightPx: 300, widthCm: 120, heightCm: 90 } });
  const cover = await f.cloud.get(saved.id, { previewOnly: true });
  const row = f.rows.get(saved.id);
  assert.equal(cover.preview, 'https://assets.test/' + row.manifest.files[row.manifest.previewPath].path);
  assert.deepEqual(cover.previewInfo, { widthPx: 400, heightPx: 300, widthCm: 120, heightCm: 90 });
  assert.equal(cover.maps, undefined);
  assert.equal(f.downloads.length, 0);
  await f.cloud.get(saved.id);
  assert.ok(f.downloads.length > 0, 'Preview-only cache does not replace the full material');
});

test('background material uploads report stages and use an idempotent creation ID', async () => {
  const f = fixture(), createId = crypto.randomUUID(), taskId = crypto.randomUUID(), stages = [];
  const asset = { ...material(), createId, uploadTaskId: taskId, uploadOwnerId: alice };
  const saved = await f.cloud.save(asset, { onProgress: value => stages.push(value) });
  assert.equal(saved.id, createId); assert.equal(f.rows.size, 1);
  assert.equal(stages[0].stage, 'preparing'); assert.equal(stages.at(-1).stage, 'saving');
  assert.equal(stages.at(-1).completed, 4); assert.equal(stages.at(-1).total, 4);
  const uploads = f.uploads, revision = saved.revision;
  const retry = await f.cloud.save(asset);
  assert.equal(retry.id, createId); assert.equal(retry.revision, revision); assert.equal(f.rows.size, 1); assert.equal(f.uploads, uploads);
  const edit = await f.cloud.save({ ...asset, createId: undefined, id: saved.id, revision, name: 'Updated', uploadTaskId: crypto.randomUUID() });
  assert.equal(edit.id, createId); assert.equal(f.rows.size, 1); assert.notEqual(edit.revision, revision);
});

test('background tasks cannot publish into a different account after switching users', async () => {
  const f = fixture(); f.setUser(bob);
  await assert.rejects(f.cloud.save({ ...material(), createId: crypto.randomUUID(), uploadTaskId: crypto.randomUUID(), uploadOwnerId: alice }), /账号已切换/);
  assert.equal(f.rows.size, 0); assert.equal(f.uploads, 0);
});

test('background copies reserve a stable ID and replay without creating duplicates', async () => {
  const f = fixture(), original = await f.cloud.save(material());
  f.setUser(bob);
  const asset = await f.cloud.get(original.id, { runtime: true });
  const createId = crypto.randomUUID();
  const copy = { ...asset, name: '后台副本', createId, uploadTaskId: crypto.randomUUID(), uploadOwnerId: bob };
  const saved = await f.cloud.save(copy);
  assert.equal(saved.id, createId); assert.equal(saved.ownerId, bob);
  const uploads = f.uploads;
  const replay = await f.cloud.save(copy);
  assert.equal(replay.id, createId); assert.equal(replay.revision, saved.revision);
  assert.equal(f.rows.size, 2); assert.equal(f.uploads, uploads);
  const next = await f.cloud.save({ ...copy, id: createId, createId: undefined, revision: saved.revision, uploadTaskId: crypto.randomUUID(), name: '副本更新' });
  assert.equal(next.id, createId); assert.equal(f.rows.size, 2);
  assert.equal(f.rows.get(original.id).name, original.name);
});

test('public asset lists load metadata and thumbnails; source maps and runtime maps hydrate only on demand', async () => {
  const f = fixture(), saved = await f.cloud.save(material());
  // Distinct prepared data represents an image generated by the browser resizer.
  const runtime = new File(['runtime'], 'runtime.png', { type: 'image/png' });
  const hash = 'a'.repeat(64), path = alice + '/' + hash; f.blobs.set(path, runtime);
  f.rows.get(saved.id).manifest.files['runtime/map'] = { kind: 'cloud', path, hash, size: runtime.size, name: runtime.name, type: runtime.type };
  f.setUser(bob);
  const [card] = await f.cloud.list();
  assert.equal(card.name, '面料'); assert.equal(card.ownerId, alice);
  assert.equal(card.maps, undefined); assert.equal(card.assetManifest, undefined); assert.equal(f.downloads.length, 0);
  assert.equal(f.fields.filter(x => x.table === 'spenic_assets' && x.value.includes('manifest')).length, 0);
  const asset = await f.cloud.get(saved.id, { runtime: true });
  assert.equal(await asset.maps.map.text(), 'runtime'); assert.equal(f.downloads.length, 1);
  assert.equal(asset.runtimeOnly, true); assert.equal(asset.projectRefs.map.prepared, true);
  await f.cloud.get(saved.id, { runtime: true }); assert.equal(f.downloads.length, 1);
  const source = await f.cloud.source(asset.sourcePackage); assert.equal(await source.maps.map.text(), 'original-color');
  assert.equal(asset.physical.widthCm, 12);
});

test('metadata updates do not download textures; nonowners cannot change but can delete originals', async () => {
  const f = fixture(), saved = await f.cloud.save(material());
  await f.cloud.update(saved.id, { name: '修改名称', supplier: '供应商' });
  assert.equal(f.downloads.length, 0); assert.equal(f.rows.get(saved.id).metadata.supplier, '供应商');
  await assert.rejects(f.cloud.save({ ...saved, name: 'stale' }), /其他页面更新/);
  f.setUser(bob);
  await assert.rejects(f.cloud.update(saved.id, { name: 'overwrite' }), /上传者/);
  assert.equal(f.rows.get(saved.id).name, '修改名称');
  await f.cloud.remove(saved.id);
  assert.equal(f.rows.has(saved.id), false, 'Any authenticated account can delete an asset');
});

test('texture previews skip missing auxiliary maps without poisoning full material loads', async () => {
  const f = fixture(), asset = material();
  asset.maps.normalMap = new File(['normal'], 'normal.png', { type: 'image/png' });
  const saved = await f.cloud.save(asset), manifest = f.rows.get(saved.id).manifest;
  f.blobs.delete(manifest.files['source/normalMap'].path);
  const preview = await f.cloud.get(saved.id, { texturePreview: true });
  assert.equal(await preview.maps.map.text(), 'original-color');
  assert.deepEqual(Object.keys(preview.maps), ['map']);
  assert.deepEqual(f.downloads, [manifest.files['source/map'].path]);
  await assert.rejects(f.cloud.get(saved.id), /Resource unavailable/);
});

test('texture previews fall back to prepared color and failed loads can be retried', async () => {
  const f = fixture(), saved = await f.cloud.save(material()), manifest = f.rows.get(saved.id).manifest;
  const runtime = new File(['prepared-color'], 'prepared.png', { type: 'image/png' });
  const path = alice + '/prepared';
  manifest.files['runtime/map'] = { ...manifest.files['source/map'], path };
  f.blobs.delete(manifest.files['source/map'].path);
  await assert.rejects(f.cloud.get(saved.id, { texturePreview: true }), /Resource unavailable/);
  f.blobs.set(path, runtime);
  const preview = await f.cloud.get(saved.id, { texturePreview: true });
  assert.equal(await preview.maps.map.text(), 'prepared-color');
  assert.equal(preview.runtimeOnly, undefined);
  assert.equal(preview.sourcePackage.files.map.path, manifest.files['source/map'].path);
  await assert.rejects(f.cloud.get(saved.id), /Resource unavailable/);
});

test('saving another users runtime asset forks without reuploading; favorites belong to each account', async () => {
  const f = fixture(), saved = await f.cloud.save(material()), uploads = f.uploads;
  f.setUser(bob); const asset = await f.cloud.get(saved.id, { runtime: true });
  const copy = await f.cloud.save({ ...asset, name: '副本' });
  assert.notEqual(copy.id, saved.id); assert.equal(copy.ownerId, bob); assert.equal(f.uploads, uploads);
  await f.cloud.favorite(saved.id, true); assert.equal((await f.cloud.favorites()).has(saved.id), true);
  f.setUser(alice); assert.equal((await f.cloud.favorites()).size, 0);
  f.setUser(bob); await f.cloud.favorite(saved.id, false); assert.equal((await f.cloud.favorites()).size, 0);
  const config = { files: { 'textures/map': asset.projectRefs.map } };
  retainProjectSources(config);
  assert.ok(Object.values(config.files).some(ref => ref.path === asset.sourcePackage.files.map.path));
});

test('cloud model and image assets restore original files and companion resources', async () => {
  const f = fixture();
  const model = await f.cloud.save({ kind: 'model', name: 'model.glb', file: new File(['glb'], 'model.glb'), resources: [new File(['png'], 'normal.png')] });
  const restored = await f.cloud.get(model.id);
  assert.equal(restored.file.name, 'model.glb'); assert.equal(restored.resources[0].name, 'normal.png');
  const texture = await f.cloud.save({ kind: 'texture', name: 'image.png', file: new File(['image'], 'image.png', { type: 'image/png' }) });
  assert.equal((await f.cloud.get(texture.id, { runtime: true })).runtimeFile.name, 'image.png');
});

test('prepared models download only the runtime file; originals remain available for configuration and copies', async () => {
  const f = fixture(), original = new File(['fbx-source'], 'model.fbx'), resource = new File(['original-texture'], 'map.png');
  const runtime = new File(['prepared-geometry'], 'model.fbx.spmodel');
  const saved = await f.cloud.save({ kind: 'model', name: 'Model', file: original, resources: [resource], runtimeModelFile: runtime, partAssignments: { 0: ['面布'] } });
  const manifest = f.rows.get(saved.id).manifest;
  assert.equal(manifest.modelRuntimeVersion, 1);
  f.setUser(bob);
  const loaded = await f.cloud.get(saved.id, { runtime: true });
  assert.equal(loaded.runtimeModel, true); assert.equal(await loaded.file.text(), 'prepared-geometry');
  assert.deepEqual(loaded.resources, []); assert.deepEqual(loaded.partAssignments, { 0: ['面布'] });
  assert.deepEqual(f.downloads, [manifest.files.runtime.path]);
  assert.equal(loaded.projectReferences.model.path, manifest.files.runtime.path);
  await assert.rejects(f.cloud.save(loaded), /部件配置/);
  const source = await f.cloud.get(saved.id);
  assert.equal(await source.file.text(), 'fbx-source'); assert.equal(source.resources[0].name, 'map.png');
  const copy = await f.cloud.save({ ...source, name: 'Copy' });
  assert.notEqual(copy.id, saved.id);
  assert.equal(f.rows.get(copy.id).manifest.files.runtime.path, manifest.files.runtime.path);
  const replaced = await f.cloud.save({ ...copy, file: new File(['new-original'], 'new.fbx') });
  assert.equal(f.rows.get(replaced.id).manifest.runtimePath, undefined, 'Changed source cannot reuse stale runtime');
});
