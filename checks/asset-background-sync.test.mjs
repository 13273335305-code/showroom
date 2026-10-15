import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../entries/asset-library.js', import.meta.url), 'utf8');
const refreshSource = source.slice(source.indexOf('async function refresh({'), source.indexOf('const tabs ='));
function fixture({ fail = false, initial = false } = {}) {
  const renders = [], statuses = []; let loadingStarts = 0;
  const context = { hiddenDeletedAssetIds:new Set(), assetsLoading: initial, renderVersion: 0, assets: [{ id:'a', updatedAt:1, preview:'existing-preview' }], selectedAssetIds:new Set(['a']), renderedCards:new Map(), cardUrls:new Map(),
    assetLoading:{begin(){loadingStarts++;}}, render:options=>renders.push(options), status:message=>statuses.push(message), URL:{revokeObjectURL(){}},
    listAssets:async()=>{if(fail) throw new Error('offline'); return [{id:'a',updatedAt:1,preview:'new-signed-url'},{id:'b',updatedAt:2,preview:'new-cover'}];} };
  vm.createContext(context); vm.runInContext(refreshSource,context);
  return {context,renders,statuses,get loadingStarts(){return loadingStarts;}};
}
test('upload background sync preserves existing covers and skips the global loader',async()=>{
  const f=fixture(); await f.context.refresh({background:true});
  assert.equal(f.loadingStarts,0); assert.equal(f.renders.length,1); assert.equal(f.renders[0].background,true);
  assert.equal(f.context.assets.find(asset=>asset.id==='a').preview,'existing-preview');
  assert.equal(f.context.assets.length,2); assert.equal(f.context.selectedAssetIds.has('a'),true);
});
test('failed background sync keeps the current cards visible',async()=>{
  const f=fixture({fail:true}); await f.context.refresh({background:true});
  assert.equal(f.loadingStarts,0); assert.equal(f.renders.length,0); assert.equal(f.context.assets.length,1); assert.deepEqual(f.statuses,['offline']);
});
test('background sync cannot restore an optimistically deleted asset',async()=>{
  const f=fixture(); f.context.hiddenDeletedAssetIds.add('b');
  await f.context.refresh({background:true});
  assert.equal(f.context.assets.some(asset=>asset.id==='b'),false);
});
test('initial loading still completes through the normal loading flow',async()=>{
  const f=fixture({initial:true}); await f.context.refresh({background:true});
  assert.equal(f.loadingStarts,1); assert.equal(f.renders[0].background,false); assert.equal(f.context.assetsLoading,false);
});
