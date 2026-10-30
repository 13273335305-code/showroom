(function (root) {
  'use strict';

  function snapPoint(x, y, width, height) {
    if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) return null;
    return { x: Math.max(0, Math.min(width, Math.round(x))), y: Math.max(0, Math.min(height, Math.round(y))) };
  }

  // The first edge follows the nearest image axis; the third corner supplies
  // the perpendicular edge. Every corner stays on integer pixel boundaries.
  function projectPoint(points, candidate) {
    if (!candidate || points.length >= 3) return null;
    if (!points.length) return { ...candidate };
    const first = points[0];
    if (points.length === 1) {
      return Math.abs(candidate.x - first.x) >= Math.abs(candidate.y - first.y)
        ? { x: candidate.x, y: first.y } : { x: first.x, y: candidate.y };
    }
    const second = points[1];
    return second.y === first.y ? { x: second.x, y: candidate.y } : { x: candidate.x, y: second.y };
  }

  function rectangle(points) {
    if (points.length !== 3 || !points.every(point => Number.isInteger(point.x) && Number.isInteger(point.y))) return null;
    const [a, b, c] = points;
    const horizontal = a.y === b.y && a.x !== b.x && b.x === c.x && b.y !== c.y;
    const vertical = a.x === b.x && a.y !== b.y && b.y === c.y && b.x !== c.x;
    if (!horizontal && !vertical) return null;
    return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), width: Math.abs(c.x - a.x), height: Math.abs(c.y - a.y) };
  }

  function checkImage(image) {
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.data?.length !== image.width * image.height * 4) throw new Error('BMP 像素数据无效');
  }

  function checkRect(width, height, rect) {
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) || rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.x + rect.width > width || rect.y + rect.height > height) throw new Error('裁剪范围无效');
  }

  function cropPixels(image, rect) {
    checkImage(image); checkRect(image.width, image.height, rect);
    const data = new Uint8ClampedArray(rect.width * rect.height * 4);
    for (let y = 0; y < rect.height; y++) {
      const start = ((rect.y + y) * image.width + rect.x) * 4;
      data.set(image.data.subarray(start, start + rect.width * 4), y * rect.width * 4);
    }
    return { width: rect.width, height: rect.height, data };
  }

  function cropIndexed(indexed, rect) {
    if (!indexed) return null;
    checkRect(indexed.width, indexed.height, rect);
    const indices = new Uint8Array(rect.width * rect.height);
    for (let y = 0; y < rect.height; y++) {
      const start = (rect.y + y) * indexed.width + rect.x;
      indices.set(indexed.indices.subarray(start, start + rect.width), y * rect.width);
    }
    return { width: rect.width, height: rect.height, palette: indexed.palette, indices };
  }

  // Keep an indexed source's palette and index values; other images use
  // uncompressed 24-bit BMP rows. No canvas encoding,
  // resampling or color conversion is involved in the saved source image.
  function encodeBmp(image, indexed = null) {
    checkImage(image);
    const { width, height, data } = image;
    const isIndexed = indexed?.width === width && indexed?.height === height && indexed?.indices?.length === width * height && indexed?.palette?.length > 0 && indexed.palette.length <= 256;
    const palette = isIndexed ? indexed.palette : [];
    const stride = Math.ceil(width * (isIndexed ? 1 : 3) / 4) * 4;
    const pixelOffset = 54 + palette.length * 4;
    const size = pixelOffset + stride * height;
    if (size > 0xffffffff) throw new Error('裁剪后的 BMP 文件过大');
    const bytes = new Uint8Array(size), header = new DataView(bytes.buffer);
    header.setUint16(0, 0x4d42, true); header.setUint32(2, size, true); header.setUint32(10, pixelOffset, true);
    header.setUint32(14, 40, true); header.setInt32(18, width, true); header.setInt32(22, height, true);
    header.setUint16(26, 1, true); header.setUint16(28, isIndexed ? 8 : 24, true); header.setUint32(34, stride * height, true);
    header.setUint32(46, palette.length, true);
    palette.forEach((color, i) => { bytes[54 + i * 4] = color.b; bytes[55 + i * 4] = color.g; bytes[56 + i * 4] = color.r; });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const row = pixelOffset + (height - 1 - y) * stride;
      if (isIndexed) bytes[row + x] = indexed.indices[y * width + x];
      else {
        const source = (y * width + x) * 4, target = row + x * 3;
        bytes[target] = data[source + 2]; bytes[target + 1] = data[source + 1]; bytes[target + 2] = data[source];
      }
    }
    return bytes;
  }

  root.BmpCrop = { snapPoint, projectPoint, rectangle, cropPixels, cropIndexed, encodeBmp };
})(globalThis);
