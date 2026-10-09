// Card metadata and full material files are stored separately.
import { compressImageFile, createAssetThumbnail, createRuntimeMaps } from './asset-thumbnail.js';
const DB_NAME = 'spenic-workspace-assets', INDEX = 'assetIndex';
let database, catalogPromise;
function notifyAssetChange() { try { localStorage.setItem('spenic-assets-revision', crypto.randomUUID()); } catch {} }
const downloads = new Map(), runtimeJobs = new Map();
const indexFields = ['id', 'kind', 'name', 'description', 'designInfo', 'supplier', 'category', 'materialType', 'library', 'parentId', 'children', 'favorite', 'updatedAt', 'surface', 'physical', 'previewInfo', 'builtin', 'builtinVersion', 'packageUrl'];
function assetSummary(asset) {
  const summary = Object.fromEntries(indexFields.filter(key => key in asset).map(key => [key, asset[key]]));
  summary.preview = asset.kind === 'material' ? asset.preview || null : asset.preview || asset.thumbnail || null;
  return summary;
}
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains(INDEX)) {
        const index = db.createObjectStore(INDEX, { keyPath: 'id' });
        const cursor = request.transaction.objectStore('assets').openCursor();
        cursor.onsuccess = () => { const row = cursor.result; if (row) { index.put(assetSummary(row.value)); row.continue(); } };
      }
    };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); database = null; }; resolve(db); };
    request.onerror = () => reject(new Error('无法打开本地资产库：' + request.error.message));
    request.onblocked = () => reject(new Error('请关闭其他旧版资产库页面后重试'));
  }).catch(error => { database = null; throw error; });
  return database;
}
async function transaction(storeName, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode), request = operation(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('资产操作失败，请检查浏览器存储空间'));
  });
}
async function persist(asset) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['assets', INDEX], 'readwrite');
    tx.objectStore('assets').put(asset); tx.objectStore(INDEX).put(assetSummary(asset));
    tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error || new Error('资产保存失败'));
  });
  notifyAssetChange();
  return asset;
}
async function fetchBuiltin(url, timeout, read, options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('下载超时');
    throw error;
  } finally { clearTimeout(timer); }
}
async function syncCatalog() {
  if (!catalogPromise) catalogPromise = (async () => {
    const manifestUrl = new URL('../assets/builtin/manifest.json', import.meta.url);
    const definitions = await fetchBuiltin(manifestUrl, 15000, response => response.json(), { cache: 'no-cache' });
    if (!Array.isArray(definitions)) throw new Error('内置素材清单格式无效');
    if (definitions.some(item => !item || !item.id || !item.url || !item.version)) throw new Error('内置素材清单缺少必要字段');
    const known = new Map((await transaction(INDEX, 'readonly', store => store.getAll())).map(asset => [asset.id, asset]));
    for (const definition of definitions) {
      const cached = known.get(definition.id);
      if (cached?.builtinVersion === definition.version && cached.packageUrl) continue;
      const packageUrl = new URL(definition.url, manifestUrl); packageUrl.searchParams.set('v', definition.version);
      const preview = definition.preview ? new URL(definition.preview, manifestUrl).href : null;
      const summary = assetSummary({ ...definition, kind: 'material', builtin: true, builtinVersion: definition.version, packageUrl: packageUrl.href, preview, updatedAt: 0 });
      const next = cached?.builtinVersion === definition.version ? { ...summary, ...cached, packageUrl: summary.packageUrl } : summary;
      await transaction(INDEX, 'readwrite', store => store.put(next));
    }
  })().catch(error => { catalogPromise = null; throw error; });
  return catalogPromise;
}
export async function listAssets({ onProgress, refreshCatalog = false } = {}) {
  if (refreshCatalog) catalogPromise = null;
  const cached = await transaction(INDEX, 'readonly', store => store.getAll());
  onProgress?.(cached, { loading: true, message: '' });
  try { await syncCatalog(); }
  catch (error) {
    onProgress?.(cached, { loading: false, message: '素材清单更新失败：' + error.message + '，已保留本地资产' });
    return cached;
  }
  const assets = await transaction(INDEX, 'readonly', store => store.getAll());
  onProgress?.(assets, { loading: false, message: '' });
  return assets;
}
async function readAsset(id) {
  let summary = await transaction(INDEX, 'readonly', store => store.get(id));
  const cached = await transaction('assets', 'readonly', store => store.get(id));
  if (cached && (!summary?.packageUrl || cached.builtinVersion === summary.builtinVersion)) return { ...cached, ...summary, preview: typeof summary?.preview === 'string' ? cached.preview || summary.preview : summary?.preview ?? cached.preview };
  if (!summary) { await syncCatalog(); summary = await transaction(INDEX, 'readonly', store => store.get(id)); }
  if (!summary?.packageUrl) return cached || null;
  if (!downloads.has(id)) {
    const record = summary;
    const task = (async () => {
      const bytes = await fetchBuiltin(record.packageUrl, 120000, response => response.arrayBuffer());
      const file = new File([bytes], record.name + '.formmat', { type: 'application/zip' });
      const { unpackMaterialAsync } = await import('./material-package-loader.js');
      const asset = await unpackMaterialAsync(file);
      const current = await transaction(INDEX, 'readonly', store => store.get(id));
      if (!current) return null;
      if (current.builtinVersion !== record.builtinVersion) throw new Error('材质已更新，请重新打开');
      return persist({ ...asset, ...current, preview: typeof current.preview === 'string' ? asset.preview || current.preview : current.preview });
    })().finally(() => downloads.delete(id));
    downloads.set(id, task);
  }
  return downloads.get(id);
}
export async function getAsset(id, { runtime = false } = {}) {
  const asset = await readAsset(id);
  if (!runtime || !asset?.maps || Object.keys(asset.maps).every(key => asset.runtimeMaps?.[key])) return asset;
  if (!runtimeJobs.has(id)) runtimeJobs.set(id, (async () => {
    const runtimeMaps = await createRuntimeMaps(asset, 2048);
    const current = await transaction(INDEX, 'readonly', store => store.get(id));
    if (!current) return null;
    if (current.builtinVersion !== asset.builtinVersion || current.updatedAt !== asset.updatedAt) throw new Error('材质已更新，请重新添加');
    return persist({ ...asset, ...current, preview: asset.preview, runtimeMaps });
  })().finally(() => runtimeJobs.delete(id)));
  return runtimeJobs.get(id);
}
export async function deleteAsset(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['assets', INDEX], 'readwrite');
    tx.objectStore('assets').delete(id); tx.objectStore(INDEX).delete(id);
    tx.oncomplete = () => { notifyAssetChange(); resolve(); }; tx.onerror = tx.onabort = () => reject(tx.error || new Error('删除失败'));
  });
}
// Metadata edits never download or decode textures.
export async function updateAsset(id, changes) {
  const allowed = ['name', 'description', 'designInfo', 'supplier', 'category', 'favorite', 'parentId'];
  if (Object.keys(changes).some(key => !allowed.includes(key))) throw new Error('不支持的资产信息修改');
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['assets', INDEX], 'readwrite'), index = tx.objectStore(INDEX), files = tx.objectStore('assets');
    let next;
    const request = index.get(id);
    request.onsuccess = () => {
      if (!request.result) { tx.abort(); return; }
      next = { ...request.result, ...changes, updatedAt: Date.now() };
      if (!next.name?.trim()) { tx.abort(); return; }
      next.name = next.name.trim(); index.put(next);
      const full = files.get(id); full.onsuccess = () => { if (full.result) files.put({ ...full.result, ...next }); };
    };
    tx.oncomplete = () => { notifyAssetChange(); resolve(next); };
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('资产已删除或名称无效'));
  });
}
export async function saveAsset(asset) {
  if (!['material', 'model', 'texture', 'folder'].includes(asset.kind) || !asset.name?.trim()) throw new Error('资产名称或类型无效');
  const saved = { ...asset, id: asset.id || crypto.randomUUID(), name: asset.name.trim(), updatedAt: Date.now(), favorite: !!asset.favorite };
  if (saved.kind === 'folder') {
    saved.children = Array.isArray(saved.children) ? [...new Set(saved.children)] : [];
    saved.parentId ||= null; saved.library ||= 'fabric';
  } else if (saved.kind === 'texture') {
    saved.file = await compressImageFile(saved.file, 8192);
    saved.runtimeFile ||= await compressImageFile(saved.file, 2048);
    saved.thumbnail ||= await createAssetThumbnail(saved);
  } else if (saved.kind === 'material') {
    saved.runtimeMaps = await createRuntimeMaps(saved, 2048);
  }
  return persist(saved);
}
