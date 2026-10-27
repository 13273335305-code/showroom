"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the app's actual job setup without allocating a 134-million-pixel
// image. The job and canvas stubs retain dimensions but never allocate pixels.
function createAppHarness() {
  const elements = new Map();
  const jobs = [];
  const values = { dpi: "100", quality: "100", backgroundColor: "#F5F0F0", texture: "30", contrast: "36", angle: "20" };
  function element(id) {
    if (!elements.has(id)) {
      const context = {
        images: [],
        putImageData(image) { this.images.push(image); },
        clearRect() {}, drawImage() {}
      };
      elements.set(id, {
        value: values[id] ?? "", disabled: true, hidden: false, textContent: "",
        classList: { toggle() {} }, style: {},
        addEventListener() {}, getContext() { return context; },
        toBlob(callback) { callback({ type: "image/jpeg" }); }
      });
    }
    return elements.get(id);
  }
  const context = vm.createContext({
    console, setTimeout, clearTimeout,
    document: { getElementById: element },
    URL: { createObjectURL: () => "blob:resolution-test", revokeObjectURL() {} },
    ImageData: class {
      constructor(data, width, height) { Object.assign(this, { data, width, height }); }
    },
    KnitRenderJob: {
      start(options, callbacks) {
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        const job = { options, callbacks, promise, resolve, reject, cancel() {} };
        jobs.push(job);
        return job;
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"), context, { filename: "app.js" });
  vm.runInContext(`
    state.width = 2376;
    state.height = 600;
    state.classMap = new Uint32Array([0]);
    state.palette = [{ loopRgb: { r: 255, g: 255, b: 255 } }];
  `, context);
  return { context, jobs, element };
}

test("100 DPI follows BMP physical calibration and detail finishes independently", async () => {
  const { context, jobs, element } = createAppHarness();
  const mainCompletion = context.renderNow();
  assert.equal(jobs.length, 2, "main and detail jobs must both start without waiting for the full image");
  const [main, detail] = jobs;
  assert.equal(main.options.width, 2376);
  assert.equal(main.options.height, 600);
  assert.equal(main.options.dpi, 100);
  assert.equal(main.options.loopsY, 2);
  assert.equal(main.options.outW, 9354);
  assert.equal(main.options.outH, 3937);
  assert.ok(main.options.outW * main.options.outH > 30_000_000);
  assert.equal(main.options.cellW, 9354 / 2376);
  assert.equal(main.options.cellH, 3937 / 600);
  assert.equal(detail.options.cellW, 28);
  assert.equal(detail.options.outW, 728);
  assert.equal(detail.options.outH, 653);
  assert.equal(detail.options.originX, 1175);
  assert.equal(detail.options.originY, 293);
  assert.equal(detail.options.loopsY, 2);
  assert.equal(detail.options.classMap, main.options.classMap);

  detail.resolve({ image: { width: 728, height: 653, data: new Uint8ClampedArray(4) }, elapsed: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element("detailCanvas").getContext().images.length, 1);
  assert.equal(element("downloadDetailButton").disabled, false);
  assert.equal(element("outputCanvas").getContext().images.length, 0, "main job must still be pending");

  main.resolve({ image: { width: 13794, height: 9685, data: new Uint8ClampedArray(4) }, elapsed: 1000 });
  await mainCompletion;
  assert.equal(element("outputCanvas").width, 13794);
  assert.equal(element("outputCanvas").height, 9685);
  assert.equal(element("outputCanvas").getContext().images.length, 1);
  assert.equal(element("downloadButton").disabled, false);
  assert.doesNotMatch(element("renderInfo").textContent, /4000 万像素限制/);
});

test("editable vertical BMP pixels per centimetre changes physical height and detail aspect", () => {
  const { context, element } = createAppHarness();
  element("bmpPixelsPerCmY").value = "4";

  const metrics = context.physicalMetrics(100);
  assert.ok(Math.abs(metrics.widthCm - 237.6) < 1e-9, "horizontal calibration stays fixed");
  assert.ok(Math.abs(metrics.heightCm - 150) < 1e-9, "600 BMP rows at 4 pixels/cm are 150 cm");
  assert.equal(metrics.outW, 9354);
  assert.equal(metrics.outH, 5906);
  assert.equal(metrics.pixelsPerCmY, 4);

  const options = context.currentRenderOptions();
  assert.equal(options.physicalHeightCm, 150);
  assert.equal(options.pixelsPerCmY, 4);
  assert.equal(options.outH, 5906);

  vm.runInContext(`state.renderOptions = { cellW: ${options.cellW}, cellH: ${options.cellH} };`, context);
  const detail = context.detailSettings();
  assert.equal(detail.cellW, 28);
  assert.ok(Math.abs(detail.cellH - (28 * options.cellH / options.cellW)) < 1e-9);
});
