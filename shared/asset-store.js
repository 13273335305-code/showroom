// Card metadata and full material files are stored separately.
import { compressImageFile, createAssetThumbnail, createRuntimeMaps } from './asset-thumbnail.js';
import { MATERIAL_MAPS } from './material-map-definitions.js';
import { readPhysical } from './physical-data.js';
const DB_NAME = 'spenic-workspace-assets', INDEX = 'assetIndex';
let database, catalogPromise;
function notifyAssetChange() { try { localStorage.setItem('spenic-assets-revision', crypto.randomUUID()); } catch {} }
const downloads = new Map(), runtimeJobs = new Map(), sourceJobs = new Map();
const indexFields = ['id', 'kind', 'name', 'description', 'designInfo', 'supplier', 'category', 'materialType', 'library', 'parentId', 'children', 'favorite', 'updatedAt', 'surface', 'physical', 'previewInfo', 'builtin', 'builtinVersion', 'packageUrl', 'runtimeUrl', 'modelUrl', 'modelResources', 'partAssignments'];
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
async function persistDownloadedAsset(asset) {
  const db = await openDatabase();
  let saved;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['assets', INDEX], 'readwrite'), files = tx.objectStore('assets'), index = tx.objectStore(INDEX);
    const request = index.get(asset.id);
    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      if (current.builtinVersion !== asset.builtinVersion || current.runtimeUrl !== asset.runtimeUrl) { tx.abort(); return; }
      const previous = files.get(asset.id);
      previous.onsuccess = () => {
        const cached = previous.result?.builtinVersion === asset.builtinVersion ? previous.result : null;
        // Source and runtime downloads can finish together; preserve both cache levels.
        saved = asset.runtimeOnly && cached && !cached.runtimeOnly
          ? { ...asset, ...cached, runtimeMaps: asset.runtimeMaps, runtimePrepared: asset.runtimePrepared }
          : { ...asset, runtimeMaps: asset.runtimeMaps || cached?.runtimeMaps, runtimePrepared: asset.runtimePrepared || cached?.runtimePrepared };
        saved = { ...saved, ...current };
        files.put(saved); index.put(assetSummary(saved));
      };
    };
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('素材已更新，请重新打开'));
  });
  if (saved) notifyAssetChange();
  return saved || null;
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
    if (definitions.some(item => !item || !item.id || !item.url || !item.version || (item.kind !== 'model' && !item.runtime))) throw new Error('内置素材清单缺少必要字段，请重新生成清单');
    const known = new Map((await transaction(INDEX, 'readonly', store => store.getAll())).map(asset => [asset.id, asset]));
    for (const definition of definitions) {
      const cached = known.get(definition.id);
      const isModel = definition.kind === 'model', runtimeUrl = isModel ? null : new URL(definition.runtime, manifestUrl).href;
      if (cached?.builtinVersion === definition.version && (cached.packageUrl || cached.modelUrl) && cached.runtimeUrl === runtimeUrl) continue;
      const packageUrl = new URL(definition.url, manifestUrl); packageUrl.searchParams.set('v', definition.version);
      const preview = definition.preview ? new URL(definition.preview, manifestUrl).href : null;
      const modelResources = isModel ? (definition.resources || []).map(resource => {
        const url = new URL(resource.url, manifestUrl); url.searchParams.set('v', resource.version || definition.version);
        return { ...resource, url: url.href };
      }) : undefined;
      const summary = assetSummary({ ...definition, kind: isModel ? 'model' : 'material', builtin: true, builtinVersion: definition.version, packageUrl: isModel ? null : packageUrl.href, modelUrl: isModel ? packageUrl.href : null, modelResources, runtimeUrl, preview, updatedAt: 0 });
      const next = cached?.builtinVersion === definition.version ? { ...summary, ...cached, packageUrl: summary.packageUrl, modelUrl: summary.modelUrl, modelResources, runtimeUrl } : summary;
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
  if (cached && !cached.runtimeOnly && (!(summary?.packageUrl || summary?.modelUrl) || cached.builtinVersion === summary.builtinVersion)) return { ...cached, ...summary, preview: typeof summary?.preview === 'string' ? cached.preview || summary.preview : summary?.preview ?? cached.preview };
  if (!summary) { await syncCatalog(); summary = await transaction(INDEX, 'readonly', store => store.get(id)); }
  if (summary?.modelUrl) return readModelAsset(summary);
  if (!summary?.packageUrl) return cached || null;
  if (!downloads.has(id)) {
    const record = summary;
    const task = (async () => {
      const asset = await downloadMaterialSource({ id, version: record.builtinVersion, url: record.packageUrl, name: record.name });
      const current = await transaction(INDEX, 'readonly', store => store.get(id));
      if (!current) return null;
      if (current.builtinVersion !== record.builtinVersion) throw new Error('材质已更新，请重新打开');
      const latest = await transaction('assets', 'readonly', store => store.get(id));
      const runtimeCache = latest?.builtinVersion === record.builtinVersion ? latest : null;
      return persistDownloadedAsset({ ...asset, ...current, runtimeMaps: runtimeCache?.runtimeMaps, runtimePrepared: runtimeCache?.runtimePrepared, preview: typeof current.preview === 'string' ? asset.preview || current.preview : current.preview });
    })().finally(() => downloads.delete(id));
    downloads.set(id, task);
  }
  return downloads.get(id);
}

async function readModelAsset(summary) {
  const id = summary.id;
  if (!downloads.has(id)) downloads.set(id, (async () => {
    const name = decodeURIComponent(new URL(summary.modelUrl).pathname.split('/').pop());
    if (!/\.(fbx|glb)$/i.test(name)) throw new Error('模型必须是 FBX 或 GLB');
    const readFile = (url, filename, limit) => fetchBuiltin(url, 120000, async response => {
      if (Number(response.headers.get('content-length')) > limit) throw new Error('模型资源过大：' + filename);
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > limit) throw new Error('模型资源大小无效：' + filename);
      return new File([bytes], filename, { type: response.headers.get('content-type') || 'application/octet-stream' });
    });
    const resources = summary.modelResources || [];
    if (!Array.isArray(resources) || resources.length > 1000 || resources.some(resource => !resource.url || !resource.name)) throw new Error('模型资源清单无效');
    const names = resources.map(resource => resource.name.split(/[\\/]/).pop().toLowerCase());
    if (new Set(names).size !== names.length) throw new Error('模型配套资源存在重复文件名');
    const results = await Promise.allSettled([readFile(summary.modelUrl, name, 512 * 1024 * 1024), ...resources.map(resource => readFile(resource.url, resource.name, 64 * 1024 * 1024))]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const current = await transaction(INDEX, 'readonly', store => store.get(id));
    if (!current) return null;
    if (current.builtinVersion !== summary.builtinVersion) throw new Error('模型已更新，请重新打开');
    return persistDownloadedAsset({ ...current, file: results[0].value, resources: results.slice(1).map(result => result.value) });
  })().finally(() => downloads.delete(id)));
  return downloads.get(id);
}
export async function getAsset(id, { runtime = false } = {}) {
  if (runtime) {
    let summary = await transaction(INDEX, 'readonly', store => store.get(id));
    if (!summary) { await syncCatalog(); summary = await transaction(INDEX, 'readonly', store => store.get(id)); }
    if (summary?.runtimeUrl) return readRuntimeAsset(summary);
  }
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

async function downloadMaterialSource(reference) {
  const bytes = await fetchBuiltin(reference.url, 120000, async response => {
    if (Number(response.headers.get('content-length')) > 512 * 1024 * 1024) throw new Error('材质包不能超过 512 MB');
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 512 * 1024 * 1024) throw new Error('材质包不能超过 512 MB');
    return buffer;
  });
  if (/^[a-f0-9]{64}$/i.test(reference.version)) {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== reference.version) throw new Error('源材质版本已更改，请重新添加素材后保存');
  }
  const { unpackMaterialAsync } = await import('./material-package-loader.js');
  return unpackMaterialAsync(new File([bytes], (reference.name || 'material') + '.formmat', { type: 'application/zip' }));
}

export async function getMaterialSource(reference) {
  if (!reference?.url || !reference.version) throw new Error('源材质引用无效');
  const cached = reference.id && await transaction('assets', 'readonly', store => store.get(reference.id));
  if (cached && !cached.runtimeOnly && cached.builtinVersion === reference.version) return cached;
  const summary = reference.id && await transaction(INDEX, 'readonly', store => store.get(reference.id));
  if (summary?.builtinVersion === reference.version && summary.packageUrl === reference.url) return readAsset(reference.id);
  const key = reference.url + '\n' + reference.version;
  if (!sourceJobs.has(key)) sourceJobs.set(key, downloadMaterialSource(reference).finally(() => sourceJobs.delete(key)));
  return sourceJobs.get(key);
}

async function readRuntimeAsset(summary) {
  const id = summary.id, cached = await transaction('assets', 'readonly', store => store.get(id));
  if (cached?.builtinVersion === summary.builtinVersion && cached.runtimeMaps && cached.runtimeUrl === summary.runtimeUrl) return { ...cached, ...summary };
  const jobKey = id + '\n' + summary.builtinVersion + '\n' + summary.runtimeUrl;
  if (!runtimeJobs.has(jobKey)) runtimeJobs.set(jobKey, (async () => {
    const data = await fetchBuiltin(summary.runtimeUrl, 15000, async response => {
      const text = await response.text();
      if (text.length > 1024 * 1024) throw new Error('材质配置过大');
      return JSON.parse(text);
    });
    if (data?.format !== 'SPENIC-MATERIAL-RUNTIME' || data.version !== 1 || data.sourceVersion !== summary.builtinVersion || !data.surface || typeof data.surface !== 'object' || Array.isArray(data.surface) || !data.maps || typeof data.maps !== 'object' || Array.isArray(data.maps) || Object.keys(data.maps).some(key => !MATERIAL_MAPS.some(([channel]) => channel === key))) throw new Error('运行材质配置无效');
    const maps = {}, physical = readPhysical(data.physical, true);
    const jobs = MATERIAL_MAPS.filter(([key]) => data.maps[key]).map(async ([key]) => {
      const map = data.maps[key];
      if (typeof map.url !== 'string' || !/^image\/(png|jpeg|webp|bmp)$/.test(map.type)) throw new Error('运行贴图引用无效：' + key);
      const url = new URL(map.url, summary.runtimeUrl);
      if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('运行贴图地址无效');
      const blob = await fetchBuiltin(url, 120000, async response => {
        if (Number(response.headers.get('content-length')) > 64 * 1024 * 1024) throw new Error('单张贴图不能超过 64 MB');
        const value = await response.blob();
        if (!value.size || value.size > 64 * 1024 * 1024) throw new Error('运行贴图大小无效');
        return value;
      });
      maps[key] = new File([blob], String(map.name || key), { type: map.type });
      if (map.prepared !== true) maps[key] = await compressImageFile(maps[key], 2048);
    });
    // Settle all channels before retrying so failed loads cannot overlap new jobs.
    const results = await Promise.allSettled(jobs);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const current = await transaction(INDEX, 'readonly', store => store.get(id));
    if (!current) return null;
    if (current.builtinVersion !== summary.builtinVersion || current.runtimeUrl !== summary.runtimeUrl) throw new Error('材质已更新，请重新添加');
    const latest = await transaction('assets', 'readonly', store => store.get(id));
    const original = latest?.builtinVersion === summary.builtinVersion && !latest.runtimeOnly ? latest : null;
    return persistDownloadedAsset({ ...data, ...original, ...current, physical: original?.physical || physical, maps: original?.maps || maps, runtimeMaps: maps, runtimePrepared: true, runtimeOnly: !original, sourcePackage: { id, version: summary.builtinVersion, url: summary.packageUrl, name: summary.name } });
  })().finally(() => runtimeJobs.delete(jobKey)));
  return runtimeJobs.get(jobKey);
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
