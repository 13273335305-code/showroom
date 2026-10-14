export async function createProjectThumbnail(source, maxSize = 640) {
  if (!source?.width || !source?.height) return null;
  const scale = Math.min(1, maxSize / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#f1f5f9'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
  if (!blob) throw new Error('无法生成项目预览图，请重试');
  return blob;
}
