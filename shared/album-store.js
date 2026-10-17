import { createAlbumCloud } from './album-cloud.js';

const cloud = createAlbumCloud(async () => (await import('./auth.js')).workspaceClient());
export const addPhoto = (blob, metadata) => cloud.add(blob, metadata);
export const listPhotos = () => cloud.list();
export const downloadPhoto = id => cloud.download(id);
export const removePhoto = id => cloud.remove(id);
