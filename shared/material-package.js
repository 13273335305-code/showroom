import { zipSync, unzipSync, strToU8, strFromU8 } from '../vendor/three/addons/libs/fflate.module.js';
import { MATERIAL_MAPS } from './material-data.js';
import { readPhysical } from '../physical-textures.js';
import { compressImageFile } from './asset-thumbnail.js';

export async function packMaterial(asset) {
  const archive = {}, maps = {};
  let preview;
  if (asset.preview) {
    archive['preview'] = new Uint8Array(await asset.preview.arrayBuffer());
    preview = { path: 'preview', type: asset.preview.type };
  }
  for (const [key] of MATERIAL_MAPS) {
    const file = asset.maps?.[key] && await compressImageFile(asset.maps[key], 8192);
    if (!file) continue;
    const path = 'textures/' + key;
    archive[path] = new Uint8Array(await file.arrayBuffer());
    maps[key] = { path, name: file.name, type: file.type };
  }
  archive['material.json'] = strToU8(JSON.stringify({ format: 'SPENIC-MATERIAL', version: 1, name: asset.name, description: asset.description, preview, materialType: asset.materialType || 'fabric', category: asset.category, surface: asset.surface, physical: asset.physical, repeat: asset.repeat, maps, placement: asset.placement, density: asset.density, legacyMaps: asset.legacyMaps }));
  return new Blob([zipSync(archive, { level: 0 })], { type: 'application/zip' });
}

export async function unpackMaterial(file) {
  if (file.size > 512 * 1024 * 1024) throw new Error('材质包不能超过 512 MB');
  let size = 0;
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: item => {
    size += item.originalSize;
    if (size > 512 * 1024 * 1024) throw new Error('材质包解压后过大');
    return true;
  } });
  if (!archive['material.json']) throw new Error('材质包缺少 material.json');
  const data = JSON.parse(strFromU8(archive['material.json']));
  if (data.format !== 'SPENIC-MATERIAL' || data.version !== 1 || typeof data.name !== 'string' || !data.surface) throw new Error('无效的材质包');
  const maps = {};
  for (const [key] of MATERIAL_MAPS) {
    const meta = data.maps?.[key];
    if (!meta) continue;
    if (!archive[meta.path] || archive[meta.path].length > 64 * 1024 * 1024) throw new Error('贴图缺失或超过 64 MB');
    maps[key] = new File([archive[meta.path]], String(meta.name || key + '.png'), { type: meta.type || 'image/png' });
  }
  let preview;
  if (data.preview) {
    const bytes = archive[data.preview.path];
    if (!bytes || bytes.length > 16 * 1024 * 1024 || !/^image\/(png|jpeg|webp|bmp)$/.test(data.preview.type)) throw new Error('预览图缺失、格式无效或超过 16 MB');
    preview = new Blob([bytes], { type: data.preview.type });
  }
  return { kind: 'material', description: typeof data.description === 'string' ? data.description : '', preview, placement: data.placement, materialType: data.materialType === 'pattern' ? 'pattern' : 'fabric', name: data.name, category: data.category || '面布', surface: data.surface, physical: readPhysical(data.physical, true), repeat: data.repeat || [1, 1], maps, density: data.density || {}, legacyMaps: data.legacyMaps || {} };
}
