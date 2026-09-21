export function alphaBounds({ data, width, height }) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] === 0) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : { x: left / width, y: top / height, width: (right - left + 1) / width, height: (bottom - top + 1) / height };
}

export function imageAlphaBounds(image, angle = 0) {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.translate(canvas.width / 2, canvas.height / 2); ctx.scale(canvas.width, canvas.height); ctx.rotate(-angle * Math.PI / 180);
  ctx.drawImage(image, -.5, -.5, 1, 1);
  return alphaBounds(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

export function grayscalePixels(data, invert = false) {
  const result = new Uint8ClampedArray(data);
  for (let i = 0; i < result.length; i += 4) {
    const gray = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
    result[i] = result[i + 1] = result[i + 2] = invert ? 255 - gray : gray;
  }
  return result;
}
