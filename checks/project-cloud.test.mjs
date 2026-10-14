import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectCloud } from '../shared/project-cloud.js';
import { createProjectResource, createProjectPreview, resolveProjectResource, validateProjectManifest } from '../shared/project-manifest.js';

const owner = '11111111-1111-1111-1111-111111111111';
const hash = 'a'.repeat(64);
const manifest = () => ({ format: 'SPENIC-PROJECT', version: 1, modelPath: 'model.glb', files: { 'model.glb': { kind: 'cloud', hash, path: owner + '/' + hash, name: 'model.glb', size: 3 } }, materials: [], patterns: [], patternSources: [] });

test('project manifests reject missing files, mutable URLs and invalid versions', () => {
  assert.equal(validateProjectManifest(manifest()).format, 'SPENIC-PROJECT');
  assert.throws(() => validateProjectManifest({ ...manifest(), files: {} }), /缺少资源/);
  const invalid = manifest(); invalid.files['model.glb'].path = owner + '/other';
  assert.throws(() => validateProjectManifest(invalid), /引用无效/);
  assert.throws(() => validateProjectManifest({ ...manifest(), version: 2 }), /格式无效/);
});

test('saving runtime references never fetches source packages; restoring reads versioned channels', async t => {
  const calls = [], source = { id: 'fabric', version: hash, runtimeUrl: 'https://assets.test/runtime/' + hash + '/material.json', url: 'https://assets.test/fabric.formmat', key: 'map' };
  const reference = await createProjectResource(new File(['runtime'], 'color.png', { type: 'image/png' }), source, () => { throw new Error('Unexpected upload'); });
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url));
    return String(url).endsWith('material.json') ? Response.json({ format: 'SPENIC-MATERIAL-RUNTIME', version: 1, sourceVersion: hash, maps: { map: { url: './color.png', prepared: true, type: 'image/png' } } }) : new Response('image');
  });
  const first = await resolveProjectResource(reference), second = await resolveProjectResource(reference);
  assert.equal(first.size, 5); assert.equal(second.size, 5); assert.equal(calls.length, 2);
  assert.equal(calls.some(url => url.endsWith('.formmat')), false);
});

test('cloud resources deduplicate concurrent uploads and check downloaded bytes', async () => {
  const rows = new Map(), objects = new Map(); let uploads = 0, reads = 0;
  const client = {
    from() { const filters = {}; return {
      select() { return this; }, eq(key, value) { filters[key] = value; return this; },
      async maybeSingle() { return { data: rows.get(filters.hash) || null }; },
      async upsert(row) { rows.set(row.hash, row); return { data: null }; },
    }; },
    storage: { from() { return {
      async upload(path, file) { uploads++; objects.set(path, file); return { data: { path } }; },
      async download(path) { reads++; return { data: objects.get(path) }; },
    }; } },
  };
  const cloud = createProjectCloud(async () => ({ client, userId: owner }));
  const file = new File(['source'], 'a.png', { type: 'image/png' });
  const [a, b] = await Promise.all([cloud.upload(file), cloud.upload(file)]);
  assert.equal(a.path, b.path); assert.equal(uploads, 1);
  const downloaded = await cloud.download(a); assert.equal(await downloaded.text(), 'source');
  await cloud.download(a); assert.equal(reads, 1);
  await assert.rejects(cloud.download({ ...a, size: a.size + 1 }), /大小与清单不一致/);
  const fresh = createProjectCloud(async () => ({ client, userId: owner }));
  await fresh.upload(file); assert.equal(uploads, 1);
  objects.set(a.path, new Blob(['broken']));
  await assert.rejects(fresh.download(a), /版本不一致/);
});

test('local runtime URLs are published as portable cloud references', async () => {
  const reference = { runtimeUrl: 'http://127.0.0.1:4186/material.json', key: 'map' };
  const result = await createProjectResource(new File(['map'], 'map.png'), reference, async () => ({ kind: 'cloud', path: owner + '/' + hash, hash, size: 3 }));
  assert.equal(result.kind, 'cloud'); assert.equal(result.prepared, true);
  assert.equal(JSON.stringify(result).includes('127.0.0.1'), false);
});

test('local previews are published while remote previews keep their URL', async t => {
  let uploaded = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response('preview'));
  const upload = async file => { uploaded++; return { kind: 'cloud', size: file.size, path: owner + '/' + hash }; };
  const local = await createProjectPreview('http://localhost:4186/preview.png', upload);
  assert.equal(local.file.size, 7); assert.equal(uploaded, 1);
  const remote = await createProjectPreview('https://cdn.test/preview.png', upload);
  assert.equal(remote.url, 'https://cdn.test/preview.png'); assert.equal(uploaded, 1);
  const reference = { kind: 'cloud', path: owner + '/' + hash, hash, size: 7, name: 'preview.png' };
  assert.deepEqual(await createProjectPreview(reference, upload), { file: reference }); assert.equal(uploaded, 1);
});

test('project saves retain revision checks and public projects fork into the current account', async () => {
  let userId = owner, saved;
  const row = { id: crypto.randomUUID(), owner_id: owner, kind: 'project', name: 'original', model_name: 'model.glb', visibility: 'public', manifest: manifest(), updated_at: '2026-10-09T00:00:00.000Z', created_at: '2026-10-09T00:00:00.000Z' };
  const client = {
    from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: row }; } }; },
    async rpc(name, args) { saved = args; return { data: { ...row, ...args.project_data, owner_id: userId, updated_at: '2026-10-09T00:01:00.000Z' } }; },
  };
  const cloud = createProjectCloud(async () => ({ client, userId }));
  await cloud.save({ id: row.id, name: 'changed', manifest: manifest(), revision: row.updated_at });
  assert.equal(saved.expected_revision, row.updated_at);
  userId = '22222222-2222-2222-2222-222222222222';
  const copy = await cloud.save({ id: row.id, name: 'copy', manifest: manifest() });
  assert.notEqual(copy.id, row.id); assert.equal(copy.visibility, 'personal'); assert.equal(saved.expected_revision, null);
  await assert.rejects(cloud.update(row.id, { name: 'unauthorized' }), /所有者/);
});

test('project summaries can render without waiting for preview signing', async () => {
  let signed = 0, selection;
  const row = { id: 'project', kind: 'project', owner_id: owner, name: 'Design', thumbnail_path: owner + '/preview', created_at: '2026-10-09', updated_at: '2026-10-09' };
  const client = {
    from() { return { select(fields) { selection = fields; return this; }, order() { return this; }, async range() { return { data: [row] }; } }; },
    storage: { from() { return { async createSignedUrls() { signed++; throw new Error('Signing offline'); } }; } },
  };
  const cloud = createProjectCloud(async () => ({ client, userId: owner }));
  const rows = await cloud.list({ previews: false });
  assert.equal(rows[0].thumbnailPath, row.thumbnail_path); assert.equal(rows[0].thumbnailUrl, null);
  assert.equal(signed, 0); assert.equal(selection.includes('manifest'), false);
  await assert.rejects(cloud.list(), /Signing offline/);
});

test('preview URLs batch, deduplicate, expire and stay scoped to the account', async t => {
  let time = 100000, userId = owner;
  t.mock.method(Date, 'now', () => time);
  const batches = [];
  const client = { storage: { from() { return { async createSignedUrls(paths) {
    batches.push(paths);
    return { data: paths.map(path => ({ path, signedUrl: 'https://cloud.test/' + path + '?v=' + batches.length })) };
  } }; } } };
  const cloud = createProjectCloud(async () => ({ client, userId }));
  const paths = Array.from({ length: 205 }, (_, index) => owner + '/preview-' + index);
  const [first, overlapping] = await Promise.all([cloud.previewUrls(paths), cloud.previewUrls(paths.slice(0, 5))]);
  assert.equal(batches.length, 3); assert.ok(batches.every(batch => batch.length <= 100));
  assert.equal(first.get(paths[0]), overlapping.get(paths[0]));
  await cloud.previewUrls([paths[0], paths[0]]); assert.equal(batches.length, 3);
  time += 3300000; await cloud.previewUrls([paths[0]]); assert.equal(batches.length, 4);
  userId = 'other-account'; await cloud.previewUrls([paths[0]]); assert.equal(batches.length, 5);
});

test('failed and missing preview URLs can be retried without caching errors', async () => {
  let calls = 0;
  const client = { storage: { from() { return { async createSignedUrls(paths) {
    calls++;
    if (calls === 1) return { error: { message: 'Temporary failure' } };
    if (calls === 2) return { data: paths.map(path => ({ path, error: 'Missing' })) };
    return { data: paths.map(path => ({ path, signedUrl: 'https://cloud.test/preview' })) };
  } }; } } };
  const cloud = createProjectCloud(async () => ({ client, userId: owner }));
  await assert.rejects(cloud.previewUrls(['preview']), /Temporary failure/);
  assert.equal((await cloud.previewUrls(['preview'])).get('preview'), null);
  assert.equal((await cloud.previewUrls(['preview'])).get('preview'), 'https://cloud.test/preview');
  assert.equal(calls, 3);
});
