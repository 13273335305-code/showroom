import test from 'node:test';
import assert from 'node:assert/strict';
import { convexPixels, renderConvexPreview } from '../shared/convex-preview.js';

test('convex preview bends texture toward the silhouette with matte diffuse shading', () => {
  const size = 101, pixels = new Uint8ClampedArray(size * size * 4);
  // A red coordinate ramp reveals how the texture moves; green stays uniform
  // so it independently measures the diffuse shading applied to both channels.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    pixels.set([x * 2, 200, 100, 255], i);
  }
  const before = pixels.slice(), output = convexPixels(pixels, size);
  const sample = (x, y, c) => output[(y * size + x) * 4 + c];
  const sourceX = x => sample(x, 50, 0) / sample(x, 50, 1) * 100;
  assert.ok(Math.abs(sourceX(50) - 50) < 1);
  assert.ok(sourceX(75) < 70, 'central texture expands across the convex front');
  assert.ok(sourceX(98) - sourceX(93) > sourceX(80) - sourceX(75), 'texture bands compress near the edge');
  assert.ok(sample(50, 50, 1) > sample(98, 50, 1), 'silhouette is diffusely shaded');
  for (let i = 0; i < output.length; i += 4) {
    assert.ok(output[i + 1] <= 200, 'no added white specular spot');
    assert.equal(output[i + 3], 255, 'no transparent seam behind the circular clip');
  }
  assert.deepEqual(pixels, before, 'original texture stays intact');
});

test('cloud dock previews request CORS before loading and display the projected result', async () => {
  const source = 'https://storage.example.test/preview.png?token=cloud-preview';
  let decoded, loadMode, draws = 0;
  const document = { createElement(tag) {
    if (tag === 'img') {
      decoded = { naturalWidth: 400, naturalHeight: 300,
        set src(value) { this.url = value; loadMode = this.crossOrigin; queueMicrotask(() => this.onload()); },
      };
      return decoded;
    }
    assert.equal(tag, 'canvas');
    return { getContext() { return {
      fillRect() {}, drawImage(image) { assert.equal(image, decoded); draws++; },
      getImageData() {
        // Match the browser's security rule for a remote image loaded without CORS.
        if (loadMode !== 'anonymous') throw new Error('SecurityError: canvas is tainted');
        return { data: new Uint8ClampedArray(320 * 320 * 4).fill(128) };
      }, putImageData() {},
    }; }, toDataURL() { return 'data:image/png;base64,convex-cloud-result'; } };
  } };
  const image = { ownerDocument: document, style: {}, classList: { add() {} } };
  await renderConvexPreview(image, source, { widthCm: 40, heightCm: 30 });
  assert.equal(loadMode, 'anonymous');
  assert.equal(draws, 1);
  assert.equal(image.src, 'data:image/png;base64,convex-cloud-result', 'cloud preview must not fall back to the flat source');
  const second = { ...image, style: {} };
  await renderConvexPreview(second, source, { widthCm: 40, heightCm: 30 });
  assert.equal(draws, 1, 'reuse the projected thumbnail when the dock rerenders');
  assert.equal(second.src, image.src);
});
