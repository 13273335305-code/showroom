import { installRoughnessShader } from './roughness-map.js';

export const MATERIAL_MAPS = [
  ['map', '基础颜色', 'BASE COLOR', true], ['normalMap', '法线', 'NORMAL', false],
  ['roughnessMap', '粗糙度', 'ROUGHNESS', false], ['metalnessMap', '金属度', 'METALLIC', false],
  ['aoMap', '环境遮蔽', 'AO', false], ['bumpMap', '凹凸高度', 'BUMP', false], ['emissiveMap', '自发光', 'EMISSIVE', true]
];
export const CATEGORIES = ['面布', '边布', '包边条'];
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
    aoStrength: material.aoMapIntensity, emissive: '#' + material.emissive.getHexString(),
    emissiveStrength: material.emissiveIntensity, bumpStrength: material.bumpScale,
    opacity: material.opacity, transparent: material.transparent, alphaTest: material.alphaTest, side: material.side };
}
export function applySurface(material, data) {
  for (const key of ['roughnessGrayscale', 'roughnessInvert']) if (typeof data[key] === 'boolean') material.userData[key] = data[key];
  installRoughnessShader(material);
  for (const key of ['color', 'emissive']) if (/^#[\da-f]{6}$/i.test(data[key])) material[key].set(data[key]);
  for (const [key, property, max] of [['roughness', 'roughness', 1], ['metalness', 'metalness', 1], ['aoStrength', 'aoMapIntensity', 3], ['emissiveStrength', 'emissiveIntensity', 3], ['bumpStrength', 'bumpScale', .2], ['opacity', 'opacity', 1], ['alphaTest', 'alphaTest', 1]]) {
    if (Number.isFinite(data[key])) material[property] = Math.max(0, Math.min(max, data[key]));
  }
  if (Number.isFinite(data.normalStrength)) material.normalScale.set(Math.max(0, Math.min(3, data.normalStrength)), Math.max(0, Math.min(3, data.normalStrength)) * (data.flip ? -1 : 1));
  if (typeof data.transparent === 'boolean') material.transparent = data.transparent;
  if ([0, 1, 2].includes(data.side)) material.side = data.side;
  material.needsUpdate = true;
}
