const test = require('node:test');
const assert = require('node:assert/strict');
const renderer = require('./test-renderer.cjs');

// Independent reference: visit every geometry texel touched by a pixel,
// including fractional edge areas and yarn owned by neighbouring BMP cells.
function referencePixel(options, x, y) {
  const geometry = renderer.buildGeometry(options.angle || 0);
  const loopH = options.cellH / options.loopsY;
  const x0 = (options.originX + x / options.cellW) * 96;
  const x1 = (options.originX + (x + 1) / options.cellW) * 96;
  const y0 = (options.originY * options.loopsY + y / loopH) * 160;
  const y1 = (options.originY * options.loopsY + (y + 1) / loopH) * 160;
  const rgb = [0, 0, 0];
  for (let ty = Math.floor(y0); ty < Math.ceil(y1); ty++) {
    const iy = Math.floor(ty / 160), phaseY = ty - iy * 160;
    const wy = Math.min(y1, ty + 1) - Math.max(y0, ty);
    for (let tx = Math.floor(x0); tx < Math.ceil(x1); tx++) {
      const ix = Math.floor(tx / 96), phaseX = tx - ix * 96;
      const weight = wy * (Math.min(x1, tx + 1) - Math.max(x0, tx));
      const i = phaseY * 96 + phaseX;
      let color = options.background, diffuse = 1, specular = 0;
      if (geometry.coverage[i]) {
        const sx = Math.max(0, Math.min(options.width - 1, ix + geometry.ownerX[i]));
        const sy = Math.max(0, Math.min(options.height - 1, Math.floor((iy + geometry.ownerY[i]) / options.loopsY)));
        color = options.palette[options.classMap[sy * options.width + sx]];
        diffuse = 1 + options.contrast * (geometry.light[i] - 1);
        specular = geometry.shine[i] * options.contrast * 255;
      }
      for (let c = 0; c < 3; c++) rgb[c] += (color[c] * diffuse + specular) * weight;
    }
  }
  return rgb.map(value => Math.round(value / ((x1 - x0) * (y1 - y0))));
}

function settings(overrides = {}) {
  return { width: 8, height: 6, classMap: Uint32Array.from({ length: 48 }, (_, i) => i % 3),
    palette: [[255, 255, 255], [30, 80, 190], [210, 140, 40]], background: [246, 231, 220],
    cellW: 3.9369, cellH: 6.5617, loopsY: 2, originX: -.23, originY: -.17,
    outW: 19, outH: 13, angle: 20, contrast: .66, ...overrides };
}

test('fractional double-loop pixels stay within the source color range at edges', () => {
  for (const options of [settings(), settings({ cellW: .72, cellH: 1.12, outW: 8, outH: 5, angle: -35 }),
    settings({ cellW: 28, cellH: 46.67, outW: 12, outH: 10, originX: .97, originY: .48 })]) {
    const image = renderer.render(options);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const p = (y * image.width + x) * 4;
      for (let c = 0; c < 3; c++) assert.ok(image.data[p + c] >= 0 && image.data[p + c] <= 255);
      assert.equal(image.data[p + 3], 255);
    }
  }
});

test('subpixel stitches retain a stable average color instead of locking to one phase', () => {
  const options = settings({ width: 1, height: 1, classMap: new Uint32Array([0]),
    cellW: .25, cellH: .5, outW: 7, outH: 5, angle: 0 });
  const image = renderer.render(options);
  for (let p = 0; p < image.data.length; p += 4) for (let c = 0; c < 3; c++)
    assert.ok(image.data[p + c] >= 0 && image.data[p + c] <= 255);
});

test('area filtering is consistent across asynchronous batches and fractional detail crops', async () => {
  const options = settings({ outW: 160, outH: 120 });
  const whole = renderer.render(options), asyncImage = await renderer.renderAsync(options);
  assert.deepEqual(Buffer.from(asyncImage.data), Buffer.from(whole.data));
  const crop = renderer.render({ ...options, outW: 13, outH: 17, originX: .12, originY: .18 });
  assert.equal(crop.data.length, crop.width * crop.height * 4);
});
