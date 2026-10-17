const cache = new Map();
const requests = new WeakMap();
const SIZE = 320;

// Orthographic hemisphere: a constant-width band on the fabric becomes
// narrower near the silhouette. Broad diffuse lighting keeps it matte.
export function convexPixels(pixels, size) {
  const output = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x + .5) / size * 2 - 1, ny = (y + .5) / size * 2 - 1;
    const radius = Math.hypot(nx, ny), r = Math.min(radius, 1);
    const scale = r > 0 ? Math.asin(r) / (Math.PI / 2) / r : 2 / Math.PI;
    const sx = Math.max(0, Math.min(size - 1, (nx * scale * .5 + .5) * (size - 1)));
    const sy = Math.max(0, Math.min(size - 1, (ny * scale * .5 + .5) * (size - 1)));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0 + 1, size - 1), y1 = Math.min(y0 + 1, size - 1);
    const fx = sx - x0, fy = sy - y0, index = (y * size + x) * 4;
    const nz = Math.sqrt(1 - r * r);
    const light = Math.max(0, (-.3 * nx - .4 * ny + nz) / Math.sqrt(1.25));
    const shade = .66 + .34 * light;
    for (let c = 0; c < 3; c++) {
      const top = pixels[(y0 * size + x0) * 4 + c] * (1 - fx) + pixels[(y0 * size + x1) * 4 + c] * fx;
      const bottom = pixels[(y1 * size + x0) * 4 + c] * (1 - fx) + pixels[(y1 * size + x1) * 4 + c] * fx;
      output[index + c] = (top * (1 - fy) + bottom * fy) * shade;
    }
    // Fill through the circular clip, including the antialiased silhouette.
    output[index + 3] = 255;
  }
  return output;
}

export function renderConvexPreview(image, source, info, baseColor = '#6c7278') {
  const width = Number(info?.widthCm), height = Number(info?.heightCm);
  const ratio = width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : null;
  const key = JSON.stringify([source, ratio, baseColor]);
  requests.set(image, key);
  image.classList.add('convex-preview');
  // Reset flat-image framing. The output already fills a square and is clipped
  // by the host, avoiding inline-image baseline gaps and exposed pale edges.
  Object.assign(image.style, { position: 'absolute', inset: '-1px', left: '-1px', top: '-1px', width: 'calc(100% + 2px)', height: 'calc(100% + 2px)', maxWidth: 'none', maxHeight: 'none', objectFit: 'fill', transform: 'none', display: 'block' });
  image.src = source;
  if (!cache.has(key)) {
    const decoded = image.ownerDocument.createElement('img');
    const ready = new Promise((resolve, reject) => { decoded.onload = resolve; decoded.onerror = reject; });
    // Cloud asset previews are signed storage URLs. Request CORS permission
    // before loading so drawing them does not taint the projection canvas.
    decoded.crossOrigin = 'anonymous';
    decoded.src = source;
    const result = ready.then(() => {
      const canvas = image.ownerDocument.createElement('canvas'); canvas.width = canvas.height = SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = baseColor; ctx.fillRect(0, 0, SIZE, SIZE);
      const framing = ratio || decoded.naturalWidth / decoded.naturalHeight;
      const w = SIZE * Math.max(1, framing), h = SIZE * Math.max(1, 1 / framing);
      // Small bleed covers fractional crop seams in saved previews.
      ctx.drawImage(decoded, (SIZE - w * 1.02) / 2, (SIZE - h * 1.02) / 2, w * 1.02, h * 1.02);
      const data = ctx.getImageData(0, 0, SIZE, SIZE);
      data.data.set(convexPixels(data.data, SIZE)); ctx.putImageData(data, 0, 0);
      return canvas.toDataURL('image/png');
    }).catch(() => { cache.delete(key); return source; });
    cache.set(key, result);
    if (cache.size > 48) cache.delete(cache.keys().next().value);
  }
  return cache.get(key).then(url => { if (requests.get(image) === key) image.src = url; });
}
