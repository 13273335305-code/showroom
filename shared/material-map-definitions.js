export const MATERIAL_MAPS = [
  ['map', '基础颜色', 'BASE COLOR', true], ['normalMap', '法线', 'NORMAL', false],
  ['roughnessMap', '粗糙度', 'ROUGHNESS', false], ['metalnessMap', '金属度', 'METALLIC', false],
  ['aoMap', '环境遮蔽', 'AO', false]
];

export const isRemovedMaterialMap = key => key === 'bumpMap' || key === 'emissiveMap';
export const filterMaterialMaps = maps => Object.fromEntries(Object.entries(maps || {}).filter(([key]) => !isRemovedMaterialMap(key)));
export function filterMaterialSurface(value) {
  if (!value) return value;
  const surface = { ...value };
  for (const key of ['emissive', 'emissiveStrength', 'bumpStrength']) delete surface[key];
  return surface;
}

export function disableRemovedMaterialChannels(material) {
  material.bumpMap = null; material.bumpScale = 0;
  material.emissiveMap = null; material.emissiveIntensity = 0;
  material.emissive?.set(0x000000);
}
