import { installRoughnessShader } from './roughness-map.js';
import { disableRemovedMaterialChannels } from './material-map-definitions.js';

export { MATERIAL_MAPS } from './material-map-definitions.js';
export const CATEGORIES = ['面布', '边布', '辅料'];
export function readLegacyUV(texture) {
  return { repeat: texture.repeat.toArray(), offset: texture.offset.toArray(), center: texture.center.toArray(), rotation: texture.rotation, flipY: texture.flipY };
}
export function applyLegacyUV(texture, data) {
  for (const key of ['repeat', 'offset', 'center']) if (Array.isArray(data[key]) && data[key].length === 2 && data[key].every(Number.isFinite)) texture[key].fromArray(data[key]);
  if (Number.isFinite(data.rotation)) texture.rotation = data.rotation;
  if (typeof data.flipY === 'boolean') texture.flipY = data.flipY;
  texture.channel = 0; texture.matrixAutoUpdate = true; texture.updateMatrix();
}
export function readSurface(material) {
  return { color: '#' + material.color.getHexString(), roughness: material.roughness, metalness: material.metalness,
    roughnessGrayscale: !!material.userData.roughnessGrayscale, roughnessInvert: !!material.userData.roughnessInvert,
    normalStrength: Math.abs(material.normalScale.x), flip: material.normalScale.y < 0,
    aoStrength: material.aoMapIntensity,
    sheen: material.sheen ?? 0, sheenRoughness: material.sheenRoughness ?? 1,
    opacity: material.opacity, transparent: material.transparent, alphaTest: material.alphaTest, side: material.side };
}
export function applySurface(material, data) {
  disableRemovedMaterialChannels(material);
  for (const key of ['roughnessGrayscale', 'roughnessInvert']) if (typeof data[key] === 'boolean') material.userData[key] = data[key];
  installRoughnessShader(material);
  // The shader derives the fiber tint from the surface; keep its multiplier
  // neutral here. Old assets keep the layer disabled.
  if (material.isMeshPhysicalMaterial) {
    if (Number.isFinite(data.sheen)) material.sheen = Math.max(0, Math.min(2, data.sheen));
    if (Number.isFinite(data.sheenRoughness)) material.sheenRoughness = Math.max(0, Math.min(1, data.sheenRoughness));
    material.sheenColor.set(0xffffff);
  }
  if (/^#[\da-f]{6}$/i.test(data.color)) material.color.set(data.color);
  for (const [key, property, max] of [['roughness', 'roughness', 1], ['metalness', 'metalness', 1], ['aoStrength', 'aoMapIntensity', 3], ['opacity', 'opacity', 1], ['alphaTest', 'alphaTest', 1]]) {
    if (Number.isFinite(data[key])) material[property] = Math.max(0, Math.min(max, data[key]));
  }
  if (Number.isFinite(data.normalStrength)) material.normalScale.set(Math.max(0, Math.min(3, data.normalStrength)), Math.max(0, Math.min(3, data.normalStrength)) * (data.flip ? -1 : 1));
  if (typeof data.transparent === 'boolean') material.transparent = data.transparent;
  if ([0, 1, 2].includes(data.side)) material.side = data.side;
  material.needsUpdate = true;
}
