import * as cloud from './asset-cloud-store.js';
import { isCloudAssetId } from './asset-cloud.js';
import { normalizeAssetCategories } from './fabric-category.js';

function notifyAssetChange() { try { localStorage.setItem('spenic-assets-revision', crypto.randomUUID()); } catch {} }
export async function listAssets({ onProgress } = {}) {
  const [uploaded, favorites] = await Promise.all([
    cloud.listCloudAssets(), cloud.listAssetFavorites(),
  ]);
  const assets = uploaded.map(asset => normalizeAssetCategories({ ...asset, favorite: favorites.has(asset.id) }));
  onProgress?.(assets, { loading: false, message: '' });
  return assets;
}
export const getAsset = async (id, options) => isCloudAssetId(id) ? normalizeAssetCategories(await cloud.getCloudAsset(id, options)) : null;
export async function getMaterialSource(reference) {
  if (!reference?.cloud) throw new Error('本地素材已停用，请从资产库重新添加云端素材');
  return cloud.getCloudMaterialSource(reference);
}
export async function saveAsset(asset, options) {
  const saved = await cloud.saveCloudAsset(normalizeAssetCategories(asset), options); notifyAssetChange(); return normalizeAssetCategories(saved);
}
export async function updateAsset(id, changes) {
  if (!isCloudAssetId(id)) throw new Error('资产不存在，请从资产库重新选择');
  await cloud.updateCloudAsset(id, changes);
  notifyAssetChange();
}
export async function deleteAsset(id) {
  if (!isCloudAssetId(id)) throw new Error('资产不存在，请从资产库重新选择');
  await cloud.deleteCloudAsset(id); notifyAssetChange();
}
