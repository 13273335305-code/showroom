"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const renderer = require("./knit-renderer.js");
const jobSource = fs.readFileSync(path.join(__dirname, "render-task.js"), "utf8");

// Match the dimensions shown in the failure report without depending on a
// particular user's BMP or any files outside this directory.
function makeOptions(overrides = {}) {
  const width = 120, height = 70;
  const classMap = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      classMap[y * width + x] = (x * 3 + y * 7) % 19 < 5 ? 1 : 0;
    }
  }
  return {
    width, height, classMap,
    palette: [{ r: 255, g: 255, b: 255 }, { r: 226, g: 55, b: 25 }],
    cellW: 3.9369, cellH: 6.5617, outW: 472, outH: 459,
    contrast: .66, texture: .3, angle: 0,
    ...overrides
  };
}

function createHarness({ behavior = "success", protocol = "http:", renderAsync } = {}) {
  const metrics = { constructed: 0, posted: 0, terminated: 0, fallbacks: 0, prevented: 0, messages: [] };
  let latestWorker;
  class MockWorker {
    constructor(url) {
      metrics.constructed++;
      assert.equal(url, "./render-worker.js");
      if (behavior === "constructor-error") {
        const error = new Error("Worker cannot be accessed from origin null");
        error.name = "SecurityError";
        throw error;
      }
      latestWorker = this;
    }
    postMessage(message) {
      metrics.posted++;
      metrics.messages.push(message);
      if (behavior === "post-error") throw new Error("Cannot clone worker input");
      queueMicrotask(() => {
        if (behavior === "async-error") {
          this.onerror({ message: "Failed to load worker script", preventDefault() { metrics.prevented++; } });
        } else if (behavior === "message-error") {
          this.onmessageerror({});
        } else if (behavior === "render-error") {
          this.onmessage({ data: { type: "error", message: "Worker render failed" } });
        } else if (behavior === "success") {
          this.onmessage({ data: { type: "started" } });
          this.onmessage({ data: { type: "complete", image: renderer.render(message.options) } });
        }
      });
    }
    terminate() { metrics.terminated++; }
  }
  const context = vm.createContext({
    AbortController, performance, setTimeout, clearTimeout, queueMicrotask,
    location: { protocol }, Worker: MockWorker,
    KnitRenderer: {
      renderAsync(options, callbacks) {
        metrics.fallbacks++;
        return (renderAsync || renderer.renderAsync)(options, callbacks);
      }
    }
  });
  vm.runInContext(jobSource, context, { filename: "render-task.js" });
  return { start: context.KnitRenderJob.start, metrics, getWorker: () => latestWorker };
}

const screenshotOptions = makeOptions({ background: { r: 24, g: 36, b: 48 } });
const expectedImage = renderer.render(screenshotOptions);

function assertImageEquals(actual, expected = expectedImage) {
  assert.equal(actual.width, expected.width);
  assert.equal(actual.height, expected.height);
  assert.equal(actual.data.length, expected.width * expected.height * 4);
  assert.deepEqual(Buffer.from(actual.data), Buffer.from(expected.data));
  assert.equal(actual.data[3], 255);
}

for (const [behavior, expectedReason] of [
  ["constructor-error", /origin null/],
  ["post-error", /clone worker input/],
  ["async-error", /Failed to load worker script/],
  ["message-error", /后台渲染结果读取失败/],
  ["render-error", /Worker render failed/]
]) {
  test(`${behavior} automatically falls back and produces the full image`, async () => {
    const harness = createHarness({ behavior });
    const reasons = [], progress = [];
    const result = await harness.start(screenshotOptions, {
      onFallback: reason => reasons.push(reason.message),
      onProgress: value => progress.push(value)
    }).promise;
    assert.equal(result.mode, "fallback");
    assertImageEquals(result.image);
    assert.equal(harness.metrics.fallbacks, 1);
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], expectedReason);
    assert.ok(progress.length > 1);
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));
    assert.equal(harness.metrics.terminated, behavior === "constructor-error" ? 0 : 1);
    if (behavior === "async-error") assert.equal(harness.metrics.prevented, 1);
  });
}

test("file: URLs skip Worker creation and render successfully", async () => {
  const harness = createHarness({ protocol: "file:" });
  const result = await harness.start(screenshotOptions).promise;
  assert.equal(result.mode, "fallback");
  assertImageEquals(result.image);
  assert.equal(harness.metrics.constructed, 0);
  assert.equal(harness.metrics.posted, 0);
  assert.equal(harness.metrics.fallbacks, 1);
});

test("a fallback rejection reaches the caller instead of leaving a pending job", async () => {
  const failure = new Error("Canvas allocation failed");
  const harness = createHarness({ behavior: "constructor-error", renderAsync: async () => { throw failure; } });
  await assert.rejects(harness.start(screenshotOptions).promise, error => error === failure);
  assert.equal(harness.metrics.fallbacks, 1);
});

test("a synchronous fallback failure reaches the caller", async () => {
  const failure = new Error("Renderer unavailable");
  const harness = createHarness({ behavior: "constructor-error", renderAsync: () => { throw failure; } });
  await assert.rejects(harness.start(screenshotOptions).promise, error => error === failure);
});

test("cancel immediately after start prevents both Worker and fallback startup", async () => {
  const harness = createHarness();
  const job = harness.start(screenshotOptions);
  const rejected = assert.rejects(job.promise, { name: "AbortError" });
  job.cancel();
  job.cancel();
  await rejected;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.metrics.constructed, 0);
  assert.equal(harness.metrics.fallbacks, 0);
});

test("cancel during fallback aborts between batches and publishes no completed image", async () => {
  const harness = createHarness({ protocol: "file:" });
  const progress = [];
  const job = harness.start(screenshotOptions, {
    onProgress(value) {
      progress.push(value);
      job.cancel();
    }
  });
  await assert.rejects(job.promise, { name: "AbortError" });
  // Let the renderer resume its next batch and observe the abort signal.
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(progress.length, 1);
  assert.ok(progress[0] > 0 && progress[0] < 1);
  assert.equal(harness.metrics.fallbacks, 1);
});

test("cancel after Worker startup terminates it and ignores a late result", async () => {
  const harness = createHarness({ behavior: "pending" });
  const job = harness.start(screenshotOptions);
  const rejected = assert.rejects(job.promise, { name: "AbortError" });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(harness.metrics.posted, 1);
  job.cancel();
  harness.getWorker().onmessage({ data: { type: "complete", image: expectedImage } });
  await rejected;
  assert.equal(harness.metrics.terminated, 1);
  assert.equal(harness.metrics.fallbacks, 0);
});

test("a successful Worker result completes without starting the fallback", async () => {
  const harness = createHarness();
  const result = await harness.start(screenshotOptions).promise;
  assert.equal(result.mode, "worker");
  assertImageEquals(result.image);
  assert.equal(harness.metrics.fallbacks, 0);
  assert.equal(harness.metrics.terminated, 1);
  assert.equal(harness.metrics.messages[0].options, screenshotOptions);
  assert.ok(Number.isFinite(result.elapsed) && result.elapsed >= 0);
});

test("yielding renderer is byte-identical to synchronous rendering for the reported dimensions", async () => {
  const progress = [];
  const image = await renderer.renderAsync(screenshotOptions, { onProgress: value => progress.push(value) });
  assertImageEquals(image);
  assert.ok(progress.length > 1);
  assert.equal(progress.at(-1), 1);
});

test("yielding renderer preserves sampling for a magnified, offset detail region", async () => {
  const options = makeOptions({
    cellW: 28, cellH: 28 * 6.5617 / 3.9369,
    outW: 728, outH: 653, originX: 47, originY: 24, angle: 19,
    background: { r: 190, g: 170, b: 145 }
  });
  const image = await renderer.renderAsync(options);
  assertImageEquals(image, renderer.render(options));
});

test("uncovered stitch gaps stay neutral instead of inheriting a yarn color", () => {
  const options = makeOptions({
    width: 1, height: 1, classMap: new Uint32Array([1]),
    palette: [{ r: 255, g: 255, b: 255 }, { r: 80, g: 60, b: 180 }],
    cellW: 96, cellH: 160, outW: 96, outH: 160
  });
  const geometry = renderer.buildGeometry(0);
  const image = renderer.render(options);
  let uncovered = 0;
  for (let i = 0; i < geometry.coverage.length; i++) {
    if (geometry.coverage[i]) continue;
    uncovered++;
    const p = i * 4;
    assert.deepEqual([...image.data.slice(p, p + 3)], [255, 255, 255]);
  }
  assert.ok(uncovered > 0, "the geometry should contain visible gaps between loops");
});

test("changing the background colors only uncovered samples and preserves yarn shading", () => {
  const options = makeOptions({
    width: 1, height: 1, classMap: new Uint32Array([1]),
    palette: [{ r: 255, g: 255, b: 255 }, { r: 80, g: 60, b: 180 }],
    cellW: 96, cellH: 160, outW: 96, outH: 160
  });
  const original = renderer.render(options);
  const image = renderer.render({ ...options, background: { r: 24, g: 36, b: 48 } });
  const geometry = renderer.buildGeometry(0);
  for (let i = 0; i < geometry.coverage.length; i++) {
    const p = i * 4;
    if (geometry.coverage[i]) {
      assert.deepEqual(image.data.slice(p, p + 4), original.data.slice(p, p + 4));
    } else {
      assert.deepEqual([...image.data.slice(p, p + 4)], [24, 36, 48, 255]);
    }
  }
});

test("OpenGL normal rendering preserves dimensions, neutral gaps, and async output", async () => {
  const options = makeOptions({ output: "normal", normalDepth: .8 });
  const image = renderer.renderNormal(options);
  assert.equal(image.width, options.outW);
  assert.equal(image.height, options.outH);
  assert.equal(image.data.length, options.outW * options.outH * 4);
  let neutral = 0;
  for (let p = 0; p < image.data.length; p += 4) {
    assert.equal(image.data[p + 3], 255);
    if (image.data[p] === 128 && image.data[p + 1] === 128 && image.data[p + 2] === 255) neutral++;
  }
  assert.ok(neutral > 0, "uncovered stitch gaps should use the neutral OpenGL normal");
  const asyncImage = await renderer.renderNormalAsync(options);
  assert.deepEqual(Buffer.from(asyncImage.data), Buffer.from(image.data));
});

test("normal depth changes the class relief while color 0 remains the high layer", () => {
  const width = 12, height = 8;
  const classMap = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) classMap[y * width + x] = x < width / 2 ? 0 : 1;
  }
  const options = makeOptions({ width, height, classMap, output: "normal", normalDepth: .8 });
  const recessed = renderer.renderNormal(options);
  const flat = renderer.renderNormal({ ...options, normalDepth: 0 });
  let changed = 0;
  for (let p = 0; p < recessed.data.length; p += 4) {
    if (recessed.data[p] !== flat.data[p]
      || recessed.data[p + 1] !== flat.data[p + 1]
      || recessed.data[p + 2] !== flat.data[p + 2]) changed++;
  }
  assert.ok(changed > 0, "nonzero color classes should create a visible macro normal slope");
});

test("uniform color classes produce a completely flat normal map", () => {
  const options = makeOptions({
    width: 7, height: 5, classMap: new Uint32Array(35),
    outW: 91, outH: 65, cellW: 13, cellH: 13,
    output: "normal", normalDepth: .8
  });
  const image = renderer.renderNormal(options);
  for (let p = 0; p < image.data.length; p += 4) {
    assert.deepEqual([...image.data.slice(p, p + 4)], [128, 128, 255, 255]);
  }
});

test("radial relief produces a white-backed height map and matching normal", async () => {
  const width = 5, height = 5;
  const classMap = new Uint32Array(width * height);
  classMap[2 * width + 2] = 1;
  const options = makeOptions({
    width, height, classMap, outW: 100, outH: 100, cellW: 20, cellH: 20,
    reliefClasses: [1], reliefRadius: .48, reliefDepth: .78
  });
  const heightImage = renderer.renderHeight(options);
  const center = (50 * heightImage.width + 50) * 4;
  assert.equal(heightImage.data[center], heightImage.data[center + 1]);
  const distance = Math.hypot(.5, .5); // even-sized cell samples beside its centre
  const expected = Math.round(255 * (1 - .78 * (1 - distance / (20 * .48)) ** 4));
  assert.equal(heightImage.data[center], expected, "sample should follow the sharp Thorn profile");
  assert.deepEqual([...heightImage.data.slice(0, 4)], [255, 255, 255, 255]);
  const normalImage = renderer.renderNormal(options);
  assert.notDeepEqual([...normalImage.data.slice(center, center + 4)], [128, 128, 255, 255]);
  const asyncHeight = await renderer.renderHeightAsync(options);
  assert.deepEqual(Buffer.from(asyncHeight.data), Buffer.from(heightImage.data));
});

test("normal jobs use the worker/fallback task path", async () => {
  const options = { ...screenshotOptions, output: "normal", normalDepth: .5 };
  const expected = renderer.renderNormal(options);
  const harness = createHarness({ behavior: "success" });
  const result = await harness.start(options).promise;
  assert.equal(result.mode, "worker");
  assertImageEquals(result.image, expected);
});
