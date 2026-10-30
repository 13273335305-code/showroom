const test = require('node:test');
const assert = require('node:assert/strict');
const renderer = require('./test-renderer.cjs');

function settings(extra = {}) {
  return { width: 5, height: 4,
    classMap: new Uint32Array([1,0,0,1,0, 0,0,1,0,0, 0,1,0,0,1, 1,0,0,0,0]),
    cellW: 7, cellH: 11, outW: 35, outH: 44,
    reliefClasses: [1], reliefRadius: 1.8, reliefDepth: .72,
    aoRadius: 1.6, aoStrength: 1.2, tileable: true, ...extra };
}

// Build actual surrounding copies with the previous clamped boundary rules.
// The centre is far enough from that boundary for all filter footprints.
function repeatSource(options, copies = 3) {
  const { width, height, classMap } = options;
  const tiled = new Uint32Array(width * height * copies * copies);
  for (let y = 0; y < height * copies; y++) for (let x = 0; x < width * copies; x++)
    tiled[y * width * copies + x] = classMap[(y % height) * width + x % width];
  return { ...options, width: width * copies, height: height * copies, classMap: tiled,
    outW: options.outW * copies, outH: options.outH * copies, tileable: false };
}
function assertCentre(actual, tiled, copies = 3, tolerance = 1) {
  assert.equal(tiled.width, actual.width * copies);
  assert.equal(tiled.height, actual.height * copies);
  const x0 = actual.width * Math.floor(copies / 2), y0 = actual.height * Math.floor(copies / 2);
  for (let y = 0; y < actual.height; y++) for (let x = 0; x < actual.width; x++) {
    const p = (y * actual.width + x) * 4, q = ((y + y0) * tiled.width + x + x0) * 4;
    for (let c = 0; c < 4; c++) assert.ok(Math.abs(actual.data[p + c] - tiled.data[q + c]) <= tolerance,
      `${x},${y} channel ${c}: ${actual.data[p + c]} vs ${tiled.data[q + c]}`);
  }
}

test('periodic height, blur, normals and AO equal a literal 3x3 tiling cropped to the centre', () => {
  for (const gaussianBlur of [0, 1.25]) {
    const options = settings({ gaussianBlur });
    const actual = renderer.renderRelief(options), tiled = renderer.renderRelief(repeatSource(options));
    for (const kind of ['height', 'normal', 'ao']) assertCentre(actual[kind], tiled[kind]);
    assertCentre(renderer.renderHeight(options), renderer.renderHeight(repeatSource(options)));
    assertCentre(renderer.renderNormal(options), renderer.renderNormal(repeatSource(options)));
    // The standalone and shared-field APIs use the same periodic derivatives.
    const standalone = renderer.renderNormal(options);
    for (let i = 0; i < standalone.data.length; i++)
      assert.ok(Math.abs(standalone.data[i] - actual.normal.data[i]) <= 1);
  }
});

test('corner stamps and radii larger than one tile include all neighbouring copies', () => {
  for (const reliefRadius of [.4, 1.1, 2.7]) {
    const options = settings({ width: 2, height: 2, classMap: new Uint32Array([1,0,0,0]),
      cellW: 5, cellH: 7, outW: 10, outH: 14, reliefRadius, reliefDepth: .4 });
    assertCentre(renderer.renderHeight(options), renderer.renderHeight(repeatSource(options, 5)), 5);
    assertCentre(renderer.renderNormal(options), renderer.renderNormal(repeatSource(options, 5)), 5);
  }
});

test('periodic filters handle single-pixel dimensions and kernels wider than the tile', () => {
  for (const [outW, outH] of [[1,1], [1,7], [7,1]]) {
    const options = settings({ width: 1, height: 1, classMap: new Uint32Array([1]),
      cellW: outW, cellH: outH, outW, outH, reliefRadius: .4, gaussianBlur: 1.4 });
    const actual = renderer.renderRelief(options), tiled = renderer.renderRelief(repeatSource(options, 13));
    for (const kind of ['height', 'normal', 'ao']) assertCentre(actual[kind], tiled[kind], 13);
  }
});

test('periodic class-height normals read the opposite edge on both axes', () => {
  const options = settings();
  delete options.reliefClasses; delete options.reliefRadius; delete options.reliefDepth;
  assertCentre(renderer.renderNormal(options), renderer.renderNormal(repeatSource(options)));
});

test('a repeating dent pattern has no extra border ridge in any derived map', () => {
  const options = settings({ classMap: new Uint32Array(20).fill(1), gaussianBlur: 1.2 });
  const maps = renderer.renderRelief(options);
  for (const image of Object.values(maps)) {
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const p = (y * image.width + x) * 4;
      const q = (((y % options.cellH) + options.cellH) * image.width
        + (x % options.cellW) + options.cellW) * 4;
      for (let c = 0; c < 4; c++) assert.ok(Math.abs(image.data[p + c] - image.data[q + c]) <= 1);
    }
  }
});

test('periodic maps are identical in synchronous, batched and streaming paths', async () => {
  const options = settings({ gaussianBlur: 1.1 });
  const sync = renderer.renderRelief(options), asyncMaps = await renderer.renderReliefAsync(options);
  const streamed = {};
  await renderer.renderReliefAsync(options, { onMap(kind, image) { streamed[kind] = image; } });
  for (const kind of ['height', 'normal', 'ao']) {
    assert.deepEqual(Buffer.from(asyncMaps[kind].data), Buffer.from(sync[kind].data));
    assert.deepEqual(Buffer.from(streamed[kind].data), Buffer.from(sync[kind].data));
  }
  assert.deepEqual(Buffer.from((await renderer.renderNormalAsync(options)).data),
    Buffer.from(renderer.renderNormal(options).data));
});
