import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../entries/asset-library.js', import.meta.url), 'utf8');
const start = source.indexOf('async function deleteFabric(');
const end = source.indexOf('function folderContains', start);
function setup({ cancel = false, failAt, wait } = {}) {
  const deleted = [], removed = [], messages = [], statuses = [];
  const context = { canEdit: asset => asset.ownerId === 'me', askDelete: async (asset, message) => { messages.push(message); return !cancel; },
    deleteAsset: async id => { if (wait) await wait; if (id === failAt) throw new Error('删除失败'); deleted.push(id); },
    assets: [], selectedAssetIds:new Set(), hiddenDeletedAssetIds:new Set(), render() {},
    removeAssetsFromView: (asset, ids) => { removed.push(...ids); context.assets = context.assets.filter(candidate => !ids.includes(candidate.id)); }, status: message => statuses.push(message) };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  const variants = [{ id: 'a', name: '389', fabricColorCode: 'DBW', ownerId: 'me' }, { id: 'b', name: '389', fabricColorCode: 'WBR', ownerId: 'me' }];
  context.assets = [...variants];
  return { context, deleted, removed, messages, statuses, asset: { ...variants[1], fabricVariants: variants } };
}
test('delete color removes only the active color and identifies it in confirmation', async () => {
  const f = setup(); await f.context.deleteFabric(f.asset, false);
  assert.deepEqual(f.deleted, ['b']); assert.deepEqual(f.removed, ['b']); assert.match(f.messages[0], /WBR/);
});
test('delete fabric removes every color; cancellation removes nothing', async () => {
  const f = setup(); await f.context.deleteFabric(f.asset, true);
  assert.deepEqual(f.deleted, ['a', 'b']); assert.deepEqual(f.removed, ['a', 'b']); assert.match(f.messages[0], /全部 2 个色号/);
  const canceled = setup({ cancel: true }); await canceled.context.deleteFabric(canceled.asset, true);
  assert.deepEqual(canceled.deleted, []);
});
test('partial deletion updates the view and reports failure without deleting more assets', async () => {
  const f = setup({ failAt: 'b' }); await assert.rejects(f.context.deleteFabric(f.asset, true), /已删除 1\/2/);
  assert.deepEqual(f.deleted, ['a']); assert.deepEqual(f.removed, ['a', 'b']); assert.deepEqual(f.statuses, []);
  assert.equal(f.context.assets.length, 1); assert.equal(f.context.assets[0].id, 'b');
  assert.equal(f.context.hiddenDeletedAssetIds.has('b'), false);
});
test('confirmed fabric disappears before slow cloud deletion completes', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = setup({wait}); const deleting = f.context.deleteFabric(f.asset, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.removed, ['a', 'b']); assert.equal(f.context.assets.length, 0);
  assert.equal(f.deleted.length, 0); assert.equal(f.context.hiddenDeletedAssetIds.has('a'), true);
  release(); await deleting; assert.deepEqual(f.deleted, ['a', 'b']);
});
