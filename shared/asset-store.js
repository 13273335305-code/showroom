import * as builtin from './builtin-asset-store.js';
import * as cloud from './asset-cloud-store.js';
import { isCloudAssetId } from './asset-cloud.js';

function notifyAssetChange() { try { localStorage.setItem('spenic-assets-revision', crypto.randomUUID()); } catch {} }
export async function listAssets({ onProgress, refreshCatalog = false } = {}) {
  const [catalog, uploaded, favorites] = await Promise.all([
    builtin.listAssets({ refreshCatalog }), cloud.listCloudAssets(), cloud.listAssetFavorites(),
  ]);
  const assets = [...catalog.filter(asset => asset.builtin), ...uploaded].map(asset => ({ ...asset, favorite: favorites.has(asset.id) }));
  onProgress?.(assets, { loading: false, message: '' });
  return assets;
}
export const getAsset = (id, options) => isCloudAssetId(id) ? cloud.getCloudAsset(id, options) : builtin.getAsset(id, options);
export const getMaterialSource = reference => reference?.cloud ? cloud.getCloudMaterialSource(reference) : builtin.getMaterialSource(reference);
export async function saveAsset(asset) {
  const saved = await cloud.saveCloudAsset(asset); notifyAssetChange(); return saved;
}
export async function updateAsset(id, changes) {
  if (isCloudAssetId(id)) await cloud.updateCloudAsset(id, changes);
  else if (Object.keys(changes).every(key => key === 'favorite')) await cloud.setAssetFavorite(id, changes.favorite);
  else throw new Error('内置资产请另存副本后修改');
  notifyAssetChange();
}
export async function deleteAsset(id) {
  if (!isCloudAssetId(id)) throw new Error('内置资产不能删除');
  await cloud.deleteCloudAsset(id); notifyAssetChange();
}
