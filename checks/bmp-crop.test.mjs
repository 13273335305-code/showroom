import test from 'node:test';
import assert from 'node:assert/strict';
import '../web-demo/bmp-crop.js';
const { snapPoint, projectPoint, rectangle, cropPixels, cropIndexed, encodeBmp } = globalThis.BmpCrop;

test('three grid points form image-aligned rectangles in either direction', () => {
  const points = [];
  for (const [x, y] of [[2.2, 3.4], [8.4, 4.2], [7.7, 9.6]]) points.push(projectPoint(points, snapPoint(x, y, 12, 12)));
  assert.deepEqual(points, [{ x: 2, y: 3 }, { x: 8, y: 3 }, { x: 8, y: 10 }]);
  assert.deepEqual(rectangle(points), { x: 2, y: 3, width: 6, height: 7 });
  assert.deepEqual(rectangle([{ x: 8, y: 10 }, { x: 8, y: 3 }, { x: 2, y: 3 }]), { x: 2, y: 3, width: 6, height: 7 });
  assert.deepEqual(snapPoint(-1, 30, 12, 12), { x: 0, y: 12 });
  assert.equal(rectangle(points.slice(0, 2)), null);
  assert.equal(rectangle([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 4, y: 3 }]), null);
  assert.equal(rectangle([{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 1 }]), null);
  assert.equal(rectangle([{ x: 1.5, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }]), null);
});

test('indexed BMP crops retain palette slots, including duplicate colors, and original index bytes', () => {
  const palette = [{ r: 255, g: 255, b: 255 }, { r: 235, g: 40, b: 10 }, { r: 235, g: 40, b: 10 }];
  const source = { width: 4, height: 3, palette, indices: new Uint8Array([0, 1, 2, 0, 2, 1, 0, 2, 1, 0, 2, 1]) };
  const crop = cropIndexed(source, { x: 1, y: 1, width: 3, height: 2 });
  assert.deepEqual([...crop.indices], [1, 0, 2, 0, 2, 1]);
  const image = { width: 3, height: 2, data: new Uint8ClampedArray(24) };
  crop.indices.forEach((index, i) => { const color = palette[index]; image.data.set([color.r, color.g, color.b, 255], i * 4); });
  const bmp = encodeBmp(image, crop), header = new DataView(bmp.buffer);
  assert.equal(header.getUint16(28, true), 8); assert.equal(header.getUint32(46, true), 3);
  assert.deepEqual([...bmp.slice(54, 66)], [255, 255, 255, 0, 10, 40, 235, 0, 10, 40, 235, 0]);
  assert.deepEqual([...bmp.slice(66)], [0, 2, 1, 0, 1, 0, 2, 0]);
  assert.equal(cropIndexed(null, { x: 0, y: 0, width: 1, height: 1 }), null);
});

test('crop copies only complete source pixels and BMP preserves colors, row order and padding', () => {
  const image = { width: 5, height: 4, data: new Uint8ClampedArray(5 * 4 * 4) };
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) image.data.set([x * 40, y * 60, x + y, 255], (y * 5 + x) * 4);
  const before = image.data.slice();
  const crop = cropPixels(image, { x: 1, y: 1, width: 3, height: 2 });
  assert.deepEqual([...crop.data.slice(0, 4)], [40, 60, 2, 255]);
  assert.deepEqual([...crop.data.slice(-4)], [120, 120, 5, 255]);
  assert.deepEqual(image.data, before);
  const bytes = encodeBmp(crop), header = new DataView(bytes.buffer);
  assert.equal(header.getUint16(0, true), 0x4d42);
  assert.equal(header.getUint32(2, true), 78);
  assert.equal(header.getInt32(18, true), 3); assert.equal(header.getInt32(22, true), 2);
  assert.equal(header.getUint16(28, true), 24);
  const stride = 12;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) {
    const i = 54 + (1 - y) * stride + x * 3, original = ((1 + y) * 5 + 1 + x) * 4;
    assert.deepEqual([bytes[i + 2], bytes[i + 1], bytes[i]], [...image.data.slice(original, original + 3)]);
  }
  assert.deepEqual([...bytes.slice(63, 66)], [0, 0, 0]);
  assert.deepEqual(cropPixels(image, { x: 4, y: 3, width: 1, height: 1 }).data, image.data.slice(-4));
  for (const rect of [{ x: 0, y: 0, width: 0, height: 1 }, { x: .5, y: 0, width: 1, height: 1 }, { x: 4, y: 3, width: 2, height: 1 }]) assert.throws(() => cropPixels(image, rect));
});
