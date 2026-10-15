import { fabricInfoFromFilename, fabricVariantGroupKey } from './fabric-info.js';
import { compressImageFile } from './asset-thumbnail.js';
import { readImageDensity, physicalSizeFromDensity } from '../image-density.js';

const imageName = /\.(png|jpe?g|webp|bmp)$/i;
const normalName = /-f\.(png|jpe?g|webp|bmp)$/i;
const directory = file => (file.webkitRelativePath || file.name).replace(/[^/]*$/, '');

export function planFabricBatch(selectedFiles) {
  const images = Array.from(selectedFiles).filter(file => imageName.test(file.name));
  const normals = images.filter(file => normalName.test(file.name));
  const colors = images.filter(file => !normalName.test(file.name) && /^\d/.test(file.name) && fabricInfoFromFilename(file.name).fabricColorCode);
  if (!colors.length) throw new Error('文件夹中没有可识别的色号图片，例如 389DBW.jpg');
  return {
    variants: colors.map(file => {
      const info = fabricInfoFromFilename(file.name);
      const local = normals.filter(normal => directory(normal) === directory(file));
      const candidates = local.length ? local : normals.length === 1 ? normals : [];
      const matching = candidates.filter(normal => fabricInfoFromFilename(normal.name).name === info.name);
      const normal = candidates.length === 1 ? candidates[0] : matching.length === 1 ? matching[0] : null;
      if (candidates.length && !normal) throw new Error(`${file.webkitRelativePath || file.name} 无法确定共用法线图，请为所在文件夹保留一张 -F 法线图`);
      return { file, normal, ...info };
    }),
    skipped: Array.from(selectedFiles).length - colors.length - normals.length,
  };
}

async function readBatchImage(file) {
  if (file.size > 64 * 1024 * 1024) throw new Error('单张贴图不能超过 64 MB');
  const meta = readImageDensity(await file.arrayBuffer());
  const image = await createImageBitmap(await compressImageFile(file, 8192));
  return { image, meta };
}

export async function enqueueFabricBatch(plan, template, { enqueue, createPreview, onProgress = () => {} }) {
  const result = { queued: 0, failures: [], skipped: plan.skipped };
  const normalInfo = new Map();
  const groups = new Map();
  const defaultColors = new Map();
  for (const variant of plan.variants) {
    const key = fabricVariantGroupKey(variant);
    if (!defaultColors.has(key) || variant.isDefaultColor) defaultColors.set(key, variant.fabricColorCode.trim().toUpperCase());
  }
  for (const [index, variant] of plan.variants.entries()) {
    let source;
    onProgress({ completed: index, total: plan.variants.length, ...result });
    try {
      if (variant.normal && !normalInfo.has(variant.normal)) normalInfo.set(variant.normal, (async () => {
        const { image, meta } = await readBatchImage(variant.normal);
        try { return { meta, width: image.width, height: image.height }; }
        finally { image.close(); }
      })());
      const normal = variant.normal ? await normalInfo.get(variant.normal) : null;
      source = await readBatchImage(variant.file);
      const physical = { ...template.physical, sizeSource: 'manual' };
      const embedded = physicalSizeFromDensity(source.meta, source.image.width, source.image.height);
      if (embedded && [embedded.widthCm, embedded.heightCm].every(value => value >= .01 && value <= 100000)) {
        Object.assign(physical, { widthCm: embedded.widthCm, heightCm: embedded.heightCm, mode: 'physical', sizeSource: 'dpi', fallbackDpi: null });
      }
      const maps = { ...template.maps, map: variant.file };
      delete maps.normalMap;
      if (variant.normal) maps.normalMap = variant.normal;
      const density = { ...template.density,
        map: physicalSizeFromDensity(source.meta, source.image.width, source.image.height, physical.fallbackDpi),
      };
      delete density.normalMap;
      if (normal) density.normalMap = physicalSizeFromDensity(normal.meta, normal.width, normal.height, physical.fallbackDpi);
      const legacyMaps = { ...template.legacyMaps };
      delete legacyMaps.map; delete legacyMaps.normalMap;
      const preview = await createPreview(source.image, physical, template.previewInfo);
      const groupKey = fabricVariantGroupKey(variant);
      if (!groups.has(groupKey)) groups.set(groupKey, crypto.randomUUID());
      await enqueue({
        kind: 'material', materialType: 'fabric', name: variant.name, fabricColorCode: variant.fabricColorCode,
        fabricGroupId: groups.get(groupKey),
        fabricDefaultColorCode: defaultColors.get(groupKey),
        category: template.category, description: template.description, designInfo: template.designInfo, supplier: template.supplier,
        surface: { ...template.surface, color: '#ffffff' }, physical, repeat: [...template.repeat], maps, density, legacyMaps,
        preview, previewInfo: preview ? { ...template.previewInfo } : null,
      });
      result.queued++;
    } catch (error) { result.failures.push({ name: variant.file.webkitRelativePath || variant.file.name, message: error.message }); }
    finally { source?.image.close(); }
  }
  onProgress({ completed: plan.variants.length, total: plan.variants.length, ...result });
  return result;
}
