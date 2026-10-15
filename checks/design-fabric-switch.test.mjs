import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const switchSource = source.slice(source.indexOf('async function switchFabricColor('), source.indexOf('async function saveSelectedToLibrary('));
function fixture(load = async id => ({ id })) {
  const material = { userData: { partTypes: new Set(['面布']) }, map: { dispose() {} }, copy(other) { this.map = other.map; }, needsUpdate: false };
  const entry = { id: 0, assetId: 'a', fabricColorCode: 'WBR', fabricVariants: [{ id: 'a', fabricColorCode: 'WBR' }, { id: 'b', fabricColorCode: 'DBW' }, { id: 'c', fabricColorCode: 'WBK' }], fabricColorCodes: ['WBR','DBW','WBK'], uploads: {}, baseline: { map: material.map }, placement: { angle: 20, offset: [.1,.2] }, material };
  const requests = [], disposed = [], messages = [], context = { entries: [entry], selected: entry, modelGeneration: 1, MAPS: [['map']], compiledMaterials: new WeakSet(),
    designUI: { sync() {} }, getAsset: async id => { requests.push(id); return load(id); }, readAsset: async () => null, preloadFabricPreview: async () => {},
    prepareFabricEntry: async asset => ({ uploads: {}, previewUrl: asset.id + '-preview', previewInfo: { widthPx: 400, heightPx: 300 }, assetId: asset.id, fabricColorCode: entry.fabricVariants.find(v => v.id === asset.id).fabricColorCode, material: { map: { id: asset.id, dispose() {} }, dispose() {} }, baseline: { dispose() {} } }),
    disposePreparedFabric: prepared => disposed.push(prepared.assetId), finishReveal() {}, stopMaterialPulse() {}, installRoughnessShader() {}, configureTexture() {}, selectEntry() {}, renderMaterials() {}, notify: message => messages.push(message), URL: { revokeObjectURL() {} } };
  vm.createContext(context); vm.runInContext(switchSource, context);
  return { entry, context, requests, messages, disposed };
}
test('switch downloads on demand and updates the existing model material while preserving placement', async () => {
  const f = fixture(), original = f.entry.material, placement = f.entry.placement;
  assert.equal(f.requests.length, 0);
  await f.context.switchFabricColor(f.entry, 'DBW');
  assert.deepEqual(f.requests, ['b']); assert.equal(f.entry.material, original); assert.equal(f.entry.material.map.id, 'b');
  assert.equal(f.entry.previewUrl, 'b-preview'); assert.equal(f.entry.placement, placement); assert.equal(f.entry.fabricColorPending, null);
  await f.context.switchFabricColor(f.entry, 'DBW'); assert.equal(f.requests.length, 1);
});
test('failed color download preserves the current texture and preview', async () => {
  const f = fixture(async () => { throw new Error('offline'); }), original = f.entry.material.map;
  await f.context.switchFabricColor(f.entry, 'DBW');
  assert.equal(f.entry.material.map, original); assert.equal(f.entry.assetId, 'a'); assert.equal(f.entry.fabricColorPending, null); assert.match(f.messages[0], /offline/);
});

test('preview starts alongside runtime loading and model waits for preview decode', async () => {
  let finishRuntime, finishPreview, decodeStarted = false;
  const f = fixture(() => new Promise(resolve => { finishRuntime = resolve; }));
  f.context.readAsset = async (id, options) => { assert.equal(options.previewOnly, true); return { preview: 'saved-400x300.jpg' }; };
  f.context.preloadFabricPreview = () => { decodeStarted = true; return new Promise(resolve => { finishPreview = resolve; }); };
  const switching = f.context.switchFabricColor(f.entry, 'DBW');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(decodeStarted, true); assert.deepEqual(f.requests, ['b']);
  finishRuntime({ id: 'b' }); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.entry.assetId, 'a'); assert.equal(f.entry.fabricColorPending, 'DBW');
  finishPreview(); await switching;
  assert.equal(f.entry.assetId, 'b'); assert.equal(f.entry.fabricColorPending, null);
});
test('late color request cannot overwrite the last choice and clicking current color cancels a pending switch', async () => {
  const pending = new Map(), f = fixture(id => new Promise(resolve => pending.set(id, resolve)));
  const first = f.context.switchFabricColor(f.entry, 'DBW'), last = f.context.switchFabricColor(f.entry, 'WBK');
  pending.get('c')({ id: 'c' }); await last; pending.get('b')({ id: 'b' }); await first;
  assert.equal(f.entry.assetId, 'c'); assert.equal(f.entry.material.map.id, 'c');
  const next = f.context.switchFabricColor(f.entry, 'DBW'); await f.context.switchFabricColor(f.entry, 'WBK');
  pending.get('b')({ id: 'b' }); await next; assert.equal(f.entry.assetId, 'c');
});

test('failed preview preload preserves the current model color and clears loading', async () => {
  const f = fixture();
  f.context.readAsset = async () => ({ preview: 'broken.jpg' });
  f.context.preloadFabricPreview = async () => { throw new Error('preview offline'); };
  await f.context.switchFabricColor(f.entry, 'DBW');
  assert.equal(f.entry.assetId, 'a'); assert.equal(f.entry.fabricColorPending, null);
  assert.match(f.messages[0], /preview offline/);
});
