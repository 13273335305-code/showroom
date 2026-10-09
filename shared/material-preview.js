// Preserve the physical framing even when the saved raster has a different
// pixel aspect ratio. These images are centered inside an overflow-hidden box.
export const assetImageUrl = source => typeof source === 'string' ? source : URL.createObjectURL(source);
export function fitMaterialPreview(image, info, boxRatio = 4 / 3) {
  const width = Number(info?.widthCm), height = Number(info?.heightCm);
  if (!(width > 0 && height > 0 && Number.isFinite(width / height))) return;
  const ratio = width / height;
  Object.assign(image.style, {
    position: 'absolute', inset: 'auto', left: '50%', top: '50%',
    width: `${100 * Math.max(1, ratio / boxRatio)}%`,
    height: `${100 * Math.max(1, boxRatio / ratio)}%`,
    maxWidth: 'none', maxHeight: 'none', objectFit: 'fill',
    transform: 'translate(-50%, -50%)',
  });
}
