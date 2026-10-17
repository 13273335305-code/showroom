import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlbumThumbnail } from '../shared/album-cloud.js';

function harness(t, width, height, { contextMissing = false, encodeFails = false, drawFails = false } = {}) {
  let closed = 0, drawn;
  const preview = new Blob(['thumbnail'], { type: 'image/png' });
  const bitmap = { width, height, close() { closed++; } };
  const context = { drawImage(...args) { drawn = args; if (drawFails) throw new Error('draw failed'); } };
  const canvas = { getContext: () => contextMissing ? null : context, toBlob(callback, type) { assert.equal(type, 'image/png'); callback(encodeFails ? null : preview); } };
  for (const [key, value] of Object.entries({ document: { createElement: () => canvas }, createImageBitmap: async () => bitmap })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  return { canvas, bitmap, context, preview, drawn: () => drawn, closed: () => closed };
}

for (const [width, height] of [[1600, 900], [600, 1200], [400, 300], [10, 10]]) {
  test('thumbnail has a fixed 400 x 300 canvas and centered crop for ' + width + ' x ' + height, async t => {
    const h = harness(t, width, height);
    assert.equal(await createAlbumThumbnail(new Blob(['original'], { type: 'image/png' })), h.preview);
    assert.equal(h.canvas.width, 400); assert.equal(h.canvas.height, 300);
    const [bitmap, x, y, w, hgt] = h.drawn();
    assert.equal(bitmap, h.bitmap);
    assert.ok(Math.abs(x * 2 + w - 400) < 1e-8);
    assert.ok(Math.abs(y * 2 + hgt - 300) < 1e-8);
    assert.ok(w >= 400 && hgt >= 300); assert.ok(Math.abs(w / hgt - width / height) < 1e-8);
    assert.equal(h.context.imageSmoothingQuality, 'high'); assert.equal(h.closed(), 1);
  });
}

for (const options of [{ contextMissing: true }, { encodeFails: true }, { drawFails: true }]) {
  test('thumbnail releases its bitmap when preparation fails: ' + JSON.stringify(options), async t => {
    const h = harness(t, 1600, 900, options);
    await assert.rejects(createAlbumThumbnail(new Blob(['original'], { type: 'image/png' })));
    assert.equal(h.closed(), 1);
  });
}
