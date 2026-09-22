// Keep UI previews independent from the original, potentially very large map.
export async function createAssetThumbnail(asset, maxSize = 320) {
  if (asset?.thumbnail) return asset.thumbnail;
  const source = asset?.maps?.map || (asset?.kind === 'texture' ? asset.file : null);
  if (!source || typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    if (!canvas.width) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/jpeg', quality: .82 });
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
  } finally { bitmap.close(); }
}
