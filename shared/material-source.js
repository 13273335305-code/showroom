export function materialSourceReference(asset, key) {
  if (asset.projectRefs?.[key]?.kind === 'runtime') return asset.projectRefs[key].reference;
  if (!asset.runtimeUrl) return null;
  const source = asset.sourcePackage || { id: asset.id, version: asset.builtinVersion, url: asset.packageUrl, name: asset.name };
  return { ...source, runtimeUrl: asset.runtimeUrl, key };
}

export async function resolveMaterialFile(file, reference) {
  if (!reference) return file;
  const { getMaterialSource } = await import('./asset-store.js');
  const source = await getMaterialSource(reference);
  if (!source?.maps?.[reference.key]) throw new Error('源材质缺少贴图：' + reference.key);
  return source.maps[reference.key];
}

export async function resolveMaterialMaps(asset) {
  if (!asset.runtimeOnly) return asset.maps || {};
  const { getMaterialSource } = await import('./asset-store.js');
  return (await getMaterialSource(asset.sourcePackage)).maps;
}
