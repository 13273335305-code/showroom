// Blob/File storage shared by the three pages on the same local server origin.
import { compressImageFile, createAssetThumbnail, createRuntimeMaps } from './asset-thumbnail.js';
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
const progressListeners = new Set();
let builtinProgress = { loading: false, completed: 0, total: null, errors: [] };
async function normalizeAssetMaps(asset) {
  if (asset?.kind === 'texture' && asset.file) {
    const file = await compressImageFile(asset.file, 8192);
    const runtimeFile = asset.runtimeFile || await compressImageFile(file, 2048);
    return { ...asset, file, runtimeFile };
  }
  if (!asset?.maps || typeof asset.maps !== 'object') return asset;
  const maps = {};
  for (const [key, file] of Object.entries(asset.maps)) if (file) maps[key] = await compressImageFile(file, 8192);
  const runtimeMaps = asset.runtimeMaps && Object.keys(asset.runtimeMaps).length
    ? asset.runtimeMaps
    : await createRuntimeMaps({ maps }, 2048);
  return { ...asset, maps, runtimeMaps };
}
function progressMessage() {
  const { loading, completed, total, errors } = builtinProgress;
  const pending = loading ? (total === null ? '正在检查内置素材…' : `正在加载内置素材 ${completed}/${total}，已显示的素材可直接使用…`) : '';
  return [pending, errors.length ? `部分内置素材未能加载：${errors.join('；')}。可刷新网页重试。` : ''].filter(Boolean).join(' ');
}
async function reportProgress() {
  if (!progressListeners.size) return;
  const assets = await transaction('readonly', store => store.getAll());
  const progress = { ...builtinProgress, message: progressMessage() };
  for (const listener of progressListeners) {
    try { listener(assets, progress); } catch (error) { console.error('更新资产列表失败', error); }
  }
}
async function fetchBuiltin(url, timeout, read, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('下载超时');
    throw error;
  } finally { clearTimeout(timer); }
}
async function ensureBuiltinAssets() {
  if (!builtinAssetsPromise) builtinAssetsPromise = (async () => {
    builtinProgress = { loading: true, completed: 0, total: null, errors: [] };
    // Show the browser's saved assets before starting any network requests.
    await reportProgress();
    const manifestUrl = new URL('../assets/builtin/manifest.json', import.meta.url);
    const BUILTIN_ASSETS = await fetchBuiltin(manifestUrl, 15000, response => response.json(), { cache: 'no-cache' });
    if (!Array.isArray(BUILTIN_ASSETS)) throw new Error('内置素材清单格式无效');
    const existing = await transaction('readonly', store => store.getAll());
    const known = new Map(existing.map(asset => [asset.id, asset]));
    builtinProgress.total = BUILTIN_ASSETS.length;
    await reportProgress();
    for (const definition of BUILTIN_ASSETS) {
      let changed = false;
      try {
        if (known.has(definition.id) && known.get(definition.id).builtinVersion === definition.version) {
          const cached = known.get(definition.id);
          const normalized = await normalizeAssetMaps(cached);
          if (normalized !== cached || !cached.runtimeMaps) {
            Object.assign(cached, normalized);
            await transaction('readwrite', store => store.put(cached));
          }
          if (!cached.thumbnail) {
            const thumbnail = await createAssetThumbnail(cached);
            if (thumbnail) { cached.thumbnail = thumbnail; await transaction('readwrite', store => store.put(cached)); }
          }
          continue;
        }
        const url = new URL(definition.url, manifestUrl);
        url.searchParams.set('v', definition.version);
        const bytes = await fetchBuiltin(url, 120000, response => response.arrayBuffer());
        const file = new File([bytes], definition.name + '.formmat', { type: 'application/zip' });
        const asset = await import('./material-package.js').then(({ unpackMaterial }) => unpackMaterial(file));
        const normalized = await normalizeAssetMaps(asset);
        Object.assign(asset, normalized);
        const thumbnail = await createAssetThumbnail(asset);
        if (thumbnail) asset.thumbnail = thumbnail;
        await transaction('readwrite', store => store.put({
          ...asset,
          id: definition.id,
          name: definition.name,
          category: definition.category,
          builtin: true,
          builtinVersion: definition.version,
          updatedAt: 0,
        }));
        changed = true;
      } catch (error) {
        builtinProgress.errors.push(definition.name + '（' + error.message + '）');
        changed = true;
      } finally {
        builtinProgress.completed++;
        if (changed) await reportProgress();
      }
    }
  })().catch(error => {
    // An unavailable manifest must not hide assets already stored in this browser.
    builtinProgress.errors.push('素材同步失败（' + error.message + '）');
  }).finally(async () => {
    builtinProgress.loading = false;
    await reportProgress();
    if (builtinProgress.errors.length) builtinAssetsPromise = null;
  });
  return builtinAssetsPromise;
}
export async function listAssets({ onProgress } = {}) {
  if (onProgress) progressListeners.add(onProgress);
  try {
    const syncing = ensureBuiltinAssets();
    await reportProgress();
    await syncing;
    return await transaction('readonly', store => store.getAll());
  } finally { if (onProgress) progressListeners.delete(onProgress); }
}
export const getAsset = async id => {
  const cached = await transaction('readonly', store => store.get(id));
  if (cached) return cached;
  await ensureBuiltinAssets();
  return transaction('readonly', store => store.get(id));
};
export const deleteAsset = id => transaction('readwrite', store => store.delete(id));
export async function saveAsset(asset) {
  if (!['material', 'model', 'texture'].includes(asset.kind) || !asset.name?.trim()) throw new Error('资产名称或类型无效');
  const normalized = await normalizeAssetMaps(asset);
  const saved = { ...normalized, id: asset.id || crypto.randomUUID(), name: asset.name.trim(), updatedAt: Date.now() };
  if (!saved.thumbnail) { const thumbnail = await createAssetThumbnail(saved); if (thumbnail) saved.thumbnail = thumbnail; }
  await transaction('readwrite', store => store.put(saved));
  return saved;
}
