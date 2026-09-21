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
export const listAssets = () => transaction('readonly', store => store.getAll());
export const getAsset = id => transaction('readonly', store => store.get(id));
export const deleteAsset = id => transaction('readwrite', store => store.delete(id));
export async function saveAsset(asset) {
  if (!['material', 'model', 'texture'].includes(asset.kind) || !asset.name?.trim()) throw new Error('资产名称或类型无效');
  const saved = { ...asset, id: asset.id || crypto.randomUUID(), name: asset.name.trim(), updatedAt: Date.now() };
  await transaction('readwrite', store => store.put(saved));
  return saved;
}
