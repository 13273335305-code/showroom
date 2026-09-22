// Blob/File storage shared by the three pages on the same local server origin.
const DB_NAME = 'spenic-workspace-assets';
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
    const manifestUrl = new URL('../assets/builtin/manifest.json', import.meta.url);
    const manifestResponse = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!manifestResponse.ok) throw new Error('找不到内置素材清单，请运行“更新内置素材.bat”');
    const BUILTIN_ASSETS = await manifestResponse.json();
    if (!Array.isArray(BUILTIN_ASSETS)) throw new Error('内置素材清单格式无效');
    const existing = await transaction('readonly', store => store.getAll());
    const known = new Map(existing.map(asset => [asset.id, asset]));
    for (const definition of BUILTIN_ASSETS) {
      if (known.has(definition.id) && known.get(definition.id).builtinVersion === definition.version) continue;
      const url = new URL(definition.url, manifestUrl);
      url.searchParams.set('v', definition.version);
      const response = await fetch(url);
      if (!response.ok) throw new Error('无法载入内置素材：' + definition.name);
      const file = new File([await response.arrayBuffer()], definition.name + '.formmat', { type: 'application/zip' });
      const asset = await import('./material-package.js').then(({ unpackMaterial }) => unpackMaterial(file));
      await transaction('readwrite', store => store.put({
        ...asset,
        id: definition.id,
        name: definition.name,
        category: definition.category,
        builtin: true,
        builtinVersion: definition.version,
        updatedAt: 0,
      }));
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
