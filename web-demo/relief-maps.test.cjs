const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const renderer = require('./test-renderer.cjs');
function settings(extra = {}) {
  const classMap = new Uint32Array(25); classMap[12] = 1;
  return { width: 5, height: 5, classMap, cellW: 21, cellH: 35, outW: 105, outH: 175, reliefClasses: [1], reliefRadius: .8, reliefDepth: .8, aoRadius: 2, ...extra };
}
const bytes = image => Buffer.from(image.data);
test('one floating-point field supplies all outputs, with blur applied once', async () => {
  const context = { module: { exports: {} }, calls: 0, setTimeout, console };
  const source = fs.readFileSync(path.join(__dirname, 'knit-renderer.js'), 'utf8').replace('function radialHeightAt(x, y, sampleX = .5, sampleY = .5) {', 'function radialHeightAt(x, y, sampleX = .5, sampleY = .5) { globalThis.calls++;');
  vm.runInNewContext(source, context);
  for (const gaussianBlur of [0, 1.2]) {
    context.calls = 0; const options = settings({ gaussianBlur });
    const maps = await context.module.exports.renderReliefAsync(options);
    assert.equal(context.calls, options.outW * options.outH);
    assert.deepEqual(bytes(maps.height), bytes(renderer.renderHeight(options)));
    assert.deepEqual(bytes(maps.normal), bytes(renderer.renderNormal(options)));
    const sync = renderer.renderRelief(options);
    for (const kind of ['height', 'normal', 'ao']) assert.deepEqual(bytes(maps[kind]), bytes(sync[kind]));
  }
});
test('AO measures neighboring occlusion: flat white, dark dents, grayscale and opaque', () => {
  for (const extra of [{ reliefClasses: [] }, { reliefDepth: 0 }, { aoStrength: 0 }]) {
    const { ao } = renderer.renderRelief(settings(extra));
    assert.ok(ao.data.every(value => value === 255));
  }
  const maps = renderer.renderRelief(settings());
  assert.equal(maps.ao.data[0], 255);
  assert.ok(maps.ao.data[(87 * 105 + 52) * 4] < 180);
  assert.notDeepEqual(bytes(maps.ao), bytes(maps.height));
  for (let p = 0; p < maps.ao.data.length; p += 4) {
    assert.equal(maps.ao.data[p], maps.ao.data[p + 1]); assert.equal(maps.ao.data[p], maps.ao.data[p + 2]); assert.equal(maps.ao.data[p + 3], 255);
  }
  const strong = renderer.renderRelief(settings({ aoStrength: 2 }));
  assert.deepEqual(bytes(strong.height), bytes(maps.height));
  assert.deepEqual(bytes(strong.normal), bytes(maps.normal));
  assert.ok(strong.ao.data[(87 * 105 + 52) * 4] < maps.ao.data[(87 * 105 + 52) * 4]);
});
test('AO physical scale remains stable across DPI and rectangular cells', () => {
  const options = settings({ cellW: 41, cellH: 69, outW: 205, outH: 345 });
  const low = renderer.renderRelief(options).ao;
  const high = renderer.renderRelief({ ...options, cellW: 123, cellH: 207, outW: 615, outH: 1035 }).ao;
  for (const [x, y] of [[102, 172], [109, 172], [102, 179], [96, 166]]) {
    const a = low.data[(y * low.width + x) * 4], b = high.data[((y * 3 + 1) * high.width + x * 3 + 1) * 4];
    assert.ok(Math.abs(a - b) <= 4, `${x},${y}: ${a} vs ${b}`);
  }
});
test('streaming waits for each consumer and supports cancellation in each stage', async () => {
  const kinds = []; let consumed = false;
  const result = await renderer.renderReliefAsync(settings({ gaussianBlur: 1 }), {
    onProgress(value, stage) { if (stage === 'normal' || stage === 'ao') assert.ok(consumed); },
    async onMap(kind) { consumed = false; await new Promise(resolve => setTimeout(resolve, 2)); kinds.push(kind); consumed = true; }
  });
  assert.deepEqual(kinds, ['height', 'normal', 'ao']); assert.equal(result.width, 105);
  for (const target of ['height-field', 'blur-x', 'blur-y', 'height', 'normal', 'ao']) {
    const controller = new AbortController(), emitted = [];
    await assert.rejects(renderer.renderReliefAsync(settings({ gaussianBlur: 1 }), { signal: controller.signal, onProgress(value, stage) { if (stage === target) controller.abort(); }, onMap(kind) { emitted.push(kind); } }), { name: 'AbortError' });
    assert.ok(!emitted.includes(target));
  }
});
