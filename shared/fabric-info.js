export function fabricVariantGroupKey(variant) {
  const path = (variant.file.webkitRelativePath || variant.file.name).replace(/[^/]*$/, '');
  return JSON.stringify([path, variant.name]);
}

export function fabricInfoFromFilename(filename = '') {
  const stem = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
  const match = /^(\d+)([a-z]*)/i.exec(stem);
  return { name: match ? match[1] : stem, fabricColorCode: match?.[2] || '' };
}
