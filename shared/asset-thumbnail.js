// Keep UI previews and runtime maps independent from the original, potentially
// very large map. The browser does the resize so the result is a real decoded
// image, rather than a CSS-only preview that still costs the original memory.
function outputType(type) {
  if (type === 'image/jpeg') return { type, extension: '.jpg', quality: .9 };
  if (type === 'image/webp') return { type, extension: '.webp', quality: .9 };
  return { type: 'image/png', extension: '.png' };
}

function outputName(name, extension) {
  const base = String(name || 'texture').replace(/\.[^.]+$/, '');
  return base + extension;
}

/** Resize an image file to a maximum edge while preserving its aspect ratio. */
export async function compressImageFile(file, maxSize = 2048) {
  if (!file || typeof createImageBitmap !== 'function') return file;
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    try { Object.defineProperties(file, { imageWidth: { value: bitmap.width, configurable: true }, imageHeight: { value: bitmap.height, configurable: true } }); } catch {}
    if (!longest || longest <= maxSize) return file;
    const scale = maxSize / longest;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
    if (!canvas.width) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext('2d', { alpha: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    const format = outputType(file.type);
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: format.type, ...(format.quality ? { quality: format.quality } : {}) })
      : await new Promise(resolve => canvas.toBlob(resolve, format.type, format.quality));
    if (!blob) throw new Error('无法压缩贴图');
    const result = new File([blob], outputName(file.name, format.extension), { type: blob.type || format.type, lastModified: file.lastModified });
    try { Object.defineProperties(result, { imageWidth: { value: width, configurable: true }, imageHeight: { value: height, configurable: true } }); } catch {}
    return result;
  } finally { bitmap.close(); }
}

export async function createAssetThumbnail(asset, maxSize = 320) {
  if (asset?.thumbnail) return asset.thumbnail;
  const source = asset?.maps?.map || (asset?.kind === 'texture' ? asset.file : null);
  if (!source) return null;
  return compressImageFile(source, maxSize);
}

export async function createRuntimeMaps(asset, maxSize = 2048) {
  const maps = {};
  for (const [key, file] of Object.entries(asset?.maps || {})) {
    if (file) maps[key] = await compressImageFile(file, maxSize);
  }
  return maps;
}
