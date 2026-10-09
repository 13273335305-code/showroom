import { createProjectCloud, PROJECT_BUCKET } from './project-cloud.js';
import { createRuntimeMaps, compressImageFile } from './asset-thumbnail.js';
import { MATERIAL_MAPS } from './material-map-definitions.js';

const TABLE = 'spenic_assets', FAVORITES = 'spenic_asset_favorites';
const SUMMARY = 'id,owner_id,kind,name,category,library,parent_id,metadata,thumbnail_path,created_at,updated_at';
const metadataFields = ['description', 'designInfo', 'supplier', 'materialType', 'surface', 'physical', 'repeat', 'density', 'legacyMaps', 'placement', 'previewInfo', 'partAssignments'];
const channels = new Set(MATERIAL_MAPS.map(([key]) => key));
export const isCloudAssetId = id => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id || '');

function checked(result) {
  if (result.error) {
    if (['42P01', 'PGRST202', 'PGRST205'].includes(result.error.code)) throw new Error('公开资产库尚未初始化，请先执行 Supabase 资产库配置脚本');
    if (result.error.code === '40001') throw new Error('资产已在其他页面更新，请重新打开后保存');
    if (result.error.code === '42501') throw new Error('只有上传者可以修改、移动或删除资产');
    throw new Error('云端资产操作失败：' + (result.error.message || '请稍后重试'));
  }
  return result.data;
}
function summary(row, preview = null) {
  if (!row) return null;
  return { ...row.metadata, id: row.id, ownerId: row.owner_id, kind: row.kind, name: row.name, category: row.category,
    library: row.library, parentId: row.parent_id, cloud: true, preview, cloudPreview: preview,
    updatedAt: Date.parse(row.updated_at), revision: row.updated_at };
}
function validateManifest(manifest) {
  if (manifest?.format !== 'SPENIC-ASSET' || manifest.version !== 1 || !manifest.files || Array.isArray(manifest.files)) throw new Error('资产清单无效');
  const need = path => { if (!manifest.files[path]) throw new Error('资产缺少文件引用'); };
  for (const maps of [manifest.maps, manifest.runtimeMaps]) for (const [key, path] of Object.entries(maps || {})) {
    if (!channels.has(key)) throw new Error('资产贴图通道无效'); need(path);
  }
  for (const path of [manifest.filePath, manifest.runtimePath, manifest.previewPath, manifest.thumbnailPath].filter(Boolean)) need(path);
  for (const resource of manifest.resources || []) need(resource.path);
  return manifest;
}

export function createAssetCloud(access, resources = createProjectCloud(access)) {
  const loads = new Map();
  const read = async id => {
    const { client } = await access();
    return checked(await client.from(TABLE).select('*').eq('id', id).maybeSingle());
  };
  async function previewUrls(client, paths) {
    const unique = [...new Set(paths.filter(Boolean))], urls = new Map();
    for (let offset = 0; offset < unique.length; offset += 100) {
      const signed = checked(await client.storage.from(PROJECT_BUCKET).createSignedUrls(unique.slice(offset, offset + 100), 3600));
      for (const item of signed) if (!item.error) urls.set(item.path, item.signedUrl);
    }
    return urls;
  }
  async function favorites() {
    const { client, userId } = await access(), ids = new Set();
    for (let offset = 0; ; offset += 200) {
      const rows = checked(await client.from(FAVORITES).select('asset_id').eq('owner_id', userId).order('asset_id').range(offset, offset + 199));
      for (const row of rows) ids.add(row.asset_id);
      if (rows.length < 200) break;
    }
    return ids;
  }
  async function list() {
    const { client } = await access(), rows = [];
    for (let offset = 0; ; offset += 200) {
      const page = checked(await client.from(TABLE).select(SUMMARY).order('id').range(offset, offset + 199));
      rows.push(...page); if (page.length < 200) break;
    }
    const urls = await previewUrls(client, rows.map(row => row.thumbnail_path));
    return rows.map(row => summary(row, urls.get(row.thumbnail_path)));
  }
  async function hydrate(row, runtime) {
    const { client } = await access();
    const manifest = validateManifest(row.manifest), refs = manifest.files;
    const previewPath = refs[manifest.previewPath]?.path || row.thumbnail_path;
    const previews = await previewUrls(client, [previewPath]);
    const asset = { ...summary(row, previews.get(previewPath)), assetManifest: manifest, previewReference: refs[manifest.previewPath] || refs[manifest.thumbnailPath], previewExpiresAt: Date.now() + 3300000 };
    if (row.kind === 'material') {
      const sourceRefs = Object.fromEntries(Object.entries(manifest.maps || {}).map(([key, path]) => [key, refs[path]]));
      asset.sourcePackage = { cloud: true, files: sourceRefs, version: row.updated_at, name: row.name };
      asset.maps = {}; asset.projectRefs = {};
      const maps = runtime ? manifest.runtimeMaps : manifest.maps;
      await Promise.all(Object.entries(maps || {}).map(async ([key, path]) => {
        asset.maps[key] = await resources.download(refs[path]);
        if (runtime) asset.projectRefs[key] = { ...refs[path], prepared: true, reference: { ...asset.sourcePackage, key } };
      }));
      if (runtime) { asset.runtimeMaps = asset.maps; asset.runtimeOnly = true; asset.runtimePrepared = true; }
    } else {
      asset.file = await resources.download(refs[runtime && manifest.runtimePath ? manifest.runtimePath : manifest.filePath]);
      asset.resources = await Promise.all((manifest.resources || []).map(resource => resources.download(refs[resource.path])));
      if (row.kind === 'model') asset.projectReferences = { model: refs[manifest.filePath], resources: (manifest.resources || []).map(resource => refs[resource.path]) };
      if (row.kind === 'texture' && runtime) asset.runtimeFile = asset.file;
    }
    return asset;
  }
  async function get(id, { runtime = false } = {}) {
    const row = await read(id); if (!row) return null;
    if (row.kind === 'folder') return summary(row);
    const key = id + ':' + row.updated_at + ':' + runtime;
    for (const cached of loads.keys()) if (cached.startsWith(id + ':') && !cached.startsWith(id + ':' + row.updated_at + ':')) loads.delete(cached);
    if (!loads.has(key)) loads.set(key, hydrate(row, runtime).catch(error => { loads.delete(key); throw error; }));
    const asset = await loads.get(key);
    if (asset.previewReference && Date.now() >= asset.previewExpiresAt) {
      const { client } = await access(), path = asset.previewReference.path;
      const urls = await previewUrls(client, [path]);
      asset.preview = asset.cloudPreview = urls.get(path) || null; asset.previewExpiresAt = Date.now() + 3300000;
    }
    return asset;
  }
  async function write(asset, manifest, old) {
    const { client, userId } = await access();
    const fork = old && old.owner_id !== userId;
    const id = old && !fork ? old.id : crypto.randomUUID();
    const metadata = Object.fromEntries(metadataFields.filter(key => asset[key] !== undefined).map(key => [key, asset[key]]));
    const library = asset.kind === 'folder' ? asset.library || 'fabric' : asset.kind === 'model' ? 'model' : asset.kind === 'texture' || asset.materialType === 'pattern' ? 'pattern' : 'fabric';
    const row = { id, kind: asset.kind, name: asset.name.trim(), category: asset.category || '',
      library, parent_id: fork || old && old.library !== library ? null : asset.parentId || null,
      metadata, manifest: asset.kind === 'folder' ? null : manifest,
      thumbnail_path: manifest?.files[manifest.thumbnailPath]?.path || null };
    const result = checked(await client.rpc('spenic_save_asset', { asset_data: row, expected_revision: old && !fork ? asset.revision || old.updated_at : null }));
    const saved = Array.isArray(result) ? result[0] : result;
    const urls = await previewUrls(client, [saved.thumbnail_path]);
    return { ...asset, ...summary(saved, urls.get(saved.thumbnail_path)), assetManifest: manifest };
  }
  async function putPreview(manifest, preview) {
    if (!preview) return;
    if (typeof preview === 'string') {
      const response = await fetch(preview, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('无法读取预览图'); preview = await response.blob();
    }
    if (!(preview instanceof Blob) || !preview.size || preview.size > 16 * 1024 * 1024) throw new Error('预览图必须小于 16 MB');
    manifest.files.preview = await resources.upload(await compressImageFile(preview, 1024)); manifest.previewPath = 'preview';
    manifest.files.thumbnail = await resources.upload(await compressImageFile(preview, 320)); manifest.thumbnailPath = 'thumbnail';
  }
  async function save(asset) {
    if (!['material', 'model', 'texture', 'folder'].includes(asset.kind) || !asset.name?.trim()) throw new Error('资产名称或类型无效');
    const old = isCloudAssetId(asset.id) ? await read(asset.id) : null;
    if (isCloudAssetId(asset.id) && !old) throw new Error('资产已删除，请重新创建');
    const manifest = { format: 'SPENIC-ASSET', version: 1, files: {} };
    if (asset.kind === 'material') {
      manifest.maps = {}; manifest.runtimeMaps = {};
      const runtimeMaps = asset.runtimeOnly ? asset.runtimeMaps : await createRuntimeMaps(asset, 2048);
      for (const [key, file] of Object.entries(asset.maps || {})) {
        if (!channels.has(key) || !(file instanceof Blob) || file.size > 64 * 1024 * 1024) throw new Error('材质贴图无效或超过 64 MB');
        const path = 'source/' + key, runtimePath = 'runtime/' + key;
        manifest.files[path] = asset.runtimeOnly && asset.sourcePackage?.cloud ? asset.sourcePackage.files[key] : await resources.upload(file);
        manifest.files[runtimePath] = asset.runtimeOnly && asset.projectRefs?.[key] ? { ...asset.projectRefs[key], reference: undefined } : await resources.upload(runtimeMaps[key]);
        manifest.maps[key] = path; manifest.runtimeMaps[key] = runtimePath;
      }
    } else if (asset.kind !== 'folder') {
      if (asset.kind === 'texture' && (!(asset.file instanceof Blob) || asset.file.size > 64 * 1024 * 1024)) throw new Error('贴图无效或超过 64 MB');
      manifest.files.file = await resources.upload(asset.file); manifest.filePath = 'file';
      if (asset.kind === 'texture') { manifest.files.runtime = await resources.upload(await compressImageFile(asset.file, 2048)); manifest.runtimePath = 'runtime'; }
      if (asset.kind === 'model') {
        manifest.resources = [];
        for (const [i, file] of (asset.resources || []).entries()) {
          if (file.size > 64 * 1024 * 1024) throw new Error('模型配套资源超过 64 MB');
          const path = 'resources/' + i; manifest.files[path] = await resources.upload(file); manifest.resources.push({ path });
        }
      }
    }
    if (asset.kind !== 'folder') {
      if (asset.assetManifest?.previewPath && asset.preview === asset.cloudPreview) {
        for (const key of ['previewPath', 'thumbnailPath']) { const path = asset.assetManifest[key]; manifest[key] = path; manifest.files[path] = asset.assetManifest.files[path]; }
      } else {
        const automaticPreview = asset.kind === 'texture' ? asset.file : asset.maps?.map;
        await putPreview(manifest, asset.preview || asset.thumbnail || (automaticPreview ? await compressImageFile(automaticPreview, 1024) : null));
      }
    }
    return write(asset, manifest, old);
  }
  async function favorite(id, value) {
    const { client, userId } = await access();
    if (value) checked(await client.from(FAVORITES).upsert({ owner_id: userId, asset_id: id }, { onConflict: 'owner_id,asset_id', ignoreDuplicates: true }));
    else checked(await client.from(FAVORITES).delete().eq('owner_id', userId).eq('asset_id', id));
  }
  async function update(id, changes) {
    if (Object.keys(changes).some(key => !['name', 'description', 'designInfo', 'supplier', 'category', 'favorite', 'parentId', 'preview'].includes(key))) throw new Error('不支持的资产信息修改');
    const { userId } = await access(), row = await read(id);
    if (!row) throw new Error('资产已删除');
    const { favorite: star, ...metadata } = changes;
    if (Object.keys(metadata).length) {
      if (row.owner_id !== userId) throw new Error('只有上传者可以修改资产');
      const manifest = row.manifest ? structuredClone(row.manifest) : null;
      if (metadata.preview) await putPreview(manifest, metadata.preview);
      await write({ ...summary(row), ...metadata }, manifest, row);
    }
    if (star !== undefined) await favorite(id, star);
  }
  async function remove(id) {
    const { client, userId } = await access();
    const rows = checked(await client.from(TABLE).delete().eq('id', id).eq('owner_id', userId).select('id'));
    if (!rows.length) throw new Error('资产已删除或只有上传者可以删除');
  }
  async function source(reference) {
    if (!reference?.cloud || !reference.files) throw new Error('源材质引用无效');
    const maps = {};
    await Promise.all(Object.entries(reference.files).map(async ([key, ref]) => { if (!channels.has(key)) throw new Error('源材质通道无效'); maps[key] = await resources.download(ref); }));
    return { maps };
  }
  return { list, get, save, update, remove, source, favorites, favorite };
}
