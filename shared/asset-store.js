// Blob/File storage shared by the three pages on the same local server origin.
const DB_NAME = 'spenic-workspace-assets';
const BUILTIN_ASSETS = [
  { id: 'builtin-test-embroidery', name: '测试刺绣', category: '面布', url: './assets/builtin/test-embroidery.formmat' },
  { id: 'builtin-test-fabric', name: '测试面布', category: '面布', url: './assets/builtin/test-fabric.formmat' },
  { id: 'builtin-test-edge-fabric', name: '测试边布', category: '边布', url: './assets/builtin/test-edge-fabric.formmat' },
  { id: 'builtin-test-piping', name: '测试包边条', category: '包边条', url: './assets/builtin/test-piping.formmat' },
];
let database;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本地资产库：' + request.error.message));
    request.onblocked = () => reject(new Error('请关闭其他旧版资产库页面后重试'));
  }).catch(error => { database = null; throw error; });
  return database;
}
async function transaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', mode);
    const request = operation(tx.objectStore('assets'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('资产操作失败，请检查浏览器存储空间'));
  });
}
let builtinAssetsPromise;
async function ensureBuiltinAssets() {
  if (!builtinAssetsPromise) builtinAssetsPromise = (async () => {
    const existing = await transaction('readonly', store => store.getAll());
    const known = new Set(existing.map(asset => asset.id));
    for (const definition of BUILTIN_ASSETS) {
      if (known.has(definition.id)) continue;
      const response = await fetch(definition.url);
      if (!response.ok) throw new Error('无法载入内置素材：' + definition.name);
      const file = new File([await response.arrayBuffer()], definition.name + '.formmat', { type: 'application/zip' });
      const asset = await import('./material-package.js').then(({ unpackMaterial }) => unpackMaterial(file));
      await transaction('readwrite', store => store.put({
        ...asset,
        id: definition.id,
        name: definition.name,
        category: definition.category,
        builtin: true,
        updatedAt: 0,
      }));
      known.add(definition.id);
    }
  })().catch(error => { builtinAssetsPromise = null; throw error; });
  return builtinAssetsPromise;
}
export const listAssets = async () => { await ensureBuiltinAssets(); return transaction('readonly', store => store.getAll()); };
export const getAsset = async id => { await ensureBuiltinAssets(); return transaction('readonly', store => store.get(id)); };
export const deleteAsset = id => transaction('readwrite', store => store.delete(id));
export async function saveAsset(asset) {
  if (!['material', 'model', 'texture'].includes(asset.kind) || !asset.name?.trim()) throw new Error('资产名称或类型无效');
  const saved = { ...asset, id: asset.id || crypto.randomUUID(), name: asset.name.trim(), updatedAt: Date.now() };
  await transaction('readwrite', store => store.put(saved));
  return saved;
}
