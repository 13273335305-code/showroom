const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const FABRIC_IDENTITY_VERSION = 1;
export { FABRIC_CATEGORIES } from './fabric-category.js';
import { FABRIC_CATEGORIES, LEGACY_FABRIC_CATEGORY, normalizeFabricCategory } from './fabric-category.js';
export function parseFabricIdentity(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!UUID.test(id)) throw new Error('二维码或身份码无效，请扫描面料标签');
  return id.toLowerCase();
}
export function hasFabricIdentity(asset) {
  return asset?.kind === 'material' && asset.materialType !== 'pattern'
    && asset.fabricIdentityVersion === FABRIC_IDENTITY_VERSION && UUID.test(asset.id || '');
}
export function validateScannedFabric(asset) {
  if (!asset) throw new Error('面料不存在，可能尚未上传完成或已被删除');
  if (asset.kind !== 'material' || asset.materialType === 'pattern') throw new Error('该二维码对应的不是面料');
  if (!hasFabricIdentity(asset)) throw new Error('该面料没有可用的扫码身份码');
  if (!FABRIC_CATEGORIES.includes(normalizeFabricCategory(asset.category, ''))) throw new Error('面料分类无效，请在材质编辑器中设置分类后保存');
  if (asset.category === LEGACY_FABRIC_CATEGORY) return { ...asset, category: '辅料' };
  return asset;
}
