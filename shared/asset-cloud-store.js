import { createAssetCloud } from './asset-cloud.js';
import { uploadProjectResource, downloadProjectResource } from './project-store.js';

const cloud = createAssetCloud(async () => (await import('./auth.js')).workspaceClient(), { upload: uploadProjectResource, download: downloadProjectResource });
export const listCloudAssets = () => cloud.list();
export const getCloudAsset = (id, options) => cloud.get(id, options);
export const saveCloudAsset = asset => cloud.save(asset);
export const updateCloudAsset = (id, changes) => cloud.update(id, changes);
export const deleteCloudAsset = id => cloud.remove(id);
export const getCloudMaterialSource = reference => cloud.source(reference);
export const listAssetFavorites = () => cloud.favorites();
export const setAssetFavorite = (id, value) => cloud.favorite(id, value);
