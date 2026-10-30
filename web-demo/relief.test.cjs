"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const renderer = require("./test-renderer.cjs");

function options(overrides = {}) {
  const width = 3, height = 3;
  const classMap = new Uint32Array(width * height);
  classMap[4] = 1;
  return {
    width, height, classMap, palette: [],
    cellW: 129, cellH: 129, outW: 387, outH: 387,
    reliefClasses: [1], reliefRadius: 64 / 129, reliefDepth: 1,
    ...overrides
  };
}

function rgba(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 4)];
}

test("Thorn height matches the inverted fourth-power reference and joins a white plane", () => {
  const image = renderer.renderHeight(options());
  const center = 193;
  // These samples cover the sharp centre and soft tail. Smoothstep and a
  // linear radial ramp produce visibly different values at all four radii.
  for (const distance of [0, 8, 16, 32, 48, 64, 70]) {
    const t = Math.min(1, distance / 64);
    const value = Math.round(255 * (1 - Math.pow(1 - t, 4)));
    assert.deepEqual(rgba(image, center + distance, center), [value, value, value, 255]);
    assert.deepEqual(rgba(image, center, center - distance), [value, value, value, 255]);
  }
  assert.deepEqual(rgba(image, 0, 0), [255, 255, 255, 255]);
});

test("overlapping Thorn stamps use Multiply before height quantization", () => {
  const settings = options({
    width: 3, height: 1, classMap: new Uint32Array([1, 1, 0]),
    cellW: 65, cellH: 65, outW: 195, outH: 65,
    reliefRadius: 1.5, reliefDepth: .8
  });
  const image = renderer.renderHeight(settings);
  let differsFromMinimum = false;
  for (let x = 54; x <= 75; x++) {
    const factors = [32.5, 97.5].map(center => {
      const t = Math.min(1, Math.abs(x + .5 - center) / 97.5);
      return 1 - .8 * Math.pow(1 - t, 4);
    });
    const expected = Math.round(255 * factors[0] * factors[1]);
    assert.deepEqual(rgba(image, x, 32), [expected, expected, expected, 255]);
    if (expected < Math.round(255 * Math.min(...factors)) - 5) differsFromMinimum = true;
  }
  assert.ok(differsFromMinimum, "overlap must deepen beyond the darkest single stamp");
});

test("isolated Thorn stamps keep expanding beyond the former app and renderer radius limits", () => {
  function probe(radius, distance) {
    // Sample a one-pixel crop far from the only selected source pixel. This
    // checks the full physical radius without allocating an enormous image.
    const width = distance + 1;
    const classMap = new Uint32Array(width);
    classMap[0] = 1;
    return renderer.renderHeight(options({
      width, height: 1, classMap, cellW: 1, cellH: 1,
      outW: 1, outH: 1, originX: distance, originY: 0,
      reliefRadius: radius, reliefDepth: 1
    })).data[0];
  }
  const expected = (radius, distance) => Math.round(255 * (1 - Math.pow(1 - distance / radius, 4)));
  assert.equal(probe(3, 25), 255, "a point outside radius 3 stays on the white plane");
  assert.equal(probe(50, 25), expected(50, 25));
  assert.ok(probe(50, 25) < probe(3, 25), "radius 50 must reach beyond the former app limit");
  const wide = probe(20000, 10000);
  const wider = probe(40000, 10000);
  assert.equal(wide, expected(20000, 10000));
  assert.equal(wider, expected(40000, 10000));
  assert.ok(wider < wide, "radii above 10000 must retain their distinct Thorn profiles");
});

test("only selected color classes create dents, including selectable class zero", () => {
  const settings = options({
    width: 3, height: 1, classMap: new Uint32Array([0, 1, 2]),
    cellW: 65, cellH: 65, outW: 195, outH: 65,
    reliefClasses: [0, 2], reliefRadius: .4, reliefDepth: .6
  });
  const image = renderer.renderHeight(settings);
  assert.deepEqual(rgba(image, 32, 32), [102, 102, 102, 255]);
  assert.deepEqual(rgba(image, 97, 32), [255, 255, 255, 255]);
  assert.deepEqual(rgba(image, 162, 32), [102, 102, 102, 255]);
});

test("an empty selection or zero depth leaves white heights and flat normals", () => {
  for (const override of [{ reliefClasses: [] }, { reliefDepth: 0 }]) {
    const settings = options({ cellW: 21, cellH: 35, outW: 63, outH: 105, ...override });
    const height = renderer.renderHeight(settings);
    const normal = renderer.renderNormal(settings);
    for (let p = 0; p < height.data.length; p += 4) {
      assert.deepEqual([...height.data.slice(p, p + 4)], [255, 255, 255, 255]);
      assert.deepEqual([...normal.data.slice(p, p + 4)], [128, 128, 255, 255]);
    }
  }
});

test("overlapping height and normal outputs are byte-identical across async row batches", async () => {
  const settings = options({
    classMap: new Uint32Array([0, 1, 0, 1, 1, 0, 0, 0, 1]),
    cellW: 31, cellH: 53, outW: 93, outH: 159, reliefRadius: 1.4, reliefDepth: .78
  });
  for (const kind of ["Height", "Normal"]) {
    const progress = [];
    const expected = renderer[`render${kind}`](settings);
    const actual = await renderer[`render${kind}Async`](settings, { onProgress: value => progress.push(value) });
    assert.deepEqual(Buffer.from(actual.data), Buffer.from(expected.data));
    assert.ok(progress.length > 1, "the image must cross a batch boundary");
    assert.equal(progress.at(-1), 1);
  }
});

test("normal strength remains stable at matching physical positions when DPI triples", () => {
  const lowOptions = options({ cellW: 41, cellH: 69, outW: 123, outH: 207, reliefRadius: .95, reliefDepth: .78 });
  const low = renderer.renderNormal(lowOptions);
  const high = renderer.renderNormal({ ...lowOptions, cellW: 123, cellH: 207, outW: 369, outH: 621 });
  for (const [x, y] of [[68, 103], [61, 110], [68, 110], [49, 97], [73, 111]]) {
    const a = rgba(low, x, y), b = rgba(high, x * 3 + 1, y * 3 + 1);
    for (let channel = 0; channel < 3; channel++) {
      assert.ok(Math.abs(a[channel] - b[channel]) <= 2, `${x},${y} channel ${channel}: ${a[channel]} vs ${b[channel]}`);
    }
  }
});

// Load the real app, replacing only browser APIs. The JPEG encoder stub emits
// a JFIF header so the tests inspect the actual DPI patching bytes, rather
// than merely asserting a call to a metadata helper.
function appHarness() {
  const elements = new Map(), encodings = [], blobs = [], jobs = [], downloads = [];
  const values = { dpi: "300", quality: "92", backgroundColor: "#FFFFFF", contrast: "66", angle: "0", reliefRadius: ".95", reliefDepth: "78" };
  const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 2, 0, 0, 1, 0, 1, 0, 0, 255, 217]);
  function makeElement(id = "offscreen") {
    const listeners = {};
    const ctx = { images: [], putImageData(image) { this.images.push(image); }, clearRect() {}, drawImage() {} };
    return {
      id, width: 0, height: 0, value: values[id] ?? "", disabled: true, hidden: false, style: {},
      classList: { toggle() {} }, listeners,
      getBoundingClientRect() { return { width: 800, height: 600 }; },
      getContext() { return ctx; },
      addEventListener(event, callback) { listeners[event] = callback; },
      toBlob(callback, type, quality) {
        encodings.push({ canvas: this, width: this.width, height: this.height, type, quality });
        callback(new Blob([jpeg], { type: "image/jpeg" }));
      },
      click() { downloads.push({ href: this.href, download: this.download }); }
    };
  }
  function element(id) {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  }
  const context = vm.createContext({
    Blob, console, setTimeout, clearTimeout, URLSearchParams, location: { search: '' },
    window: { addEventListener() {} },
    ResizeObserver: class { observe() {} }, requestAnimationFrame() {},
    mountBmpCropTool() { return { cancel() {} }; },
    document: { body: { classList: { toggle() {} } }, querySelectorAll() { return []; }, getElementById: element, createElement: tag => makeElement(tag) },
    URL: { createObjectURL(blob) { blobs.push(blob); return `blob:test-${blobs.length}`; }, revokeObjectURL() {} },
    ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
    KnitRenderJob: { start(settings, callbacks) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const job = { options: settings, callbacks, promise, resolve, cancel() {} };
      jobs.push(job);
      return job;
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"), context, { filename: "app.js" });
  return { context, element, encodings, blobs, jobs, downloads };
}

test("the radius input and app pass unrestricted large radius values to the renderer", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const radiusInput = html.match(/<input\b[^>]*\bid="reliefRadius"[^>]*>/)?.[0];
  assert.ok(radiusInput, "the radius number input must exist");
  assert.doesNotMatch(radiusInput, /\bmax\s*=/i, "the input must not impose an upper limit");
  const harness = appHarness();
  vm.runInContext("state.width = 1; state.height = 1; state.classMap = new Uint32Array(1);", harness.context);
  for (const radius of [50, 100, 20000]) {
    harness.element("reliefRadius").value = String(radius);
    assert.equal(harness.context.currentRenderOptions().reliefRadius, radius, `radius ${radius} must reach the renderer unchanged`);
  }
});

async function assertDpi(blob, dpi) {
  assert.equal(blob.type, "image/jpeg");
  const bytes = new DataView(await blob.arrayBuffer());
  assert.equal(bytes.getUint16(0), 0xFFD8);
  assert.equal(bytes.getUint8(13), 1, "JFIF density must use dots per inch");
  assert.equal(bytes.getUint16(14), dpi);
  assert.equal(bytes.getUint16(16), dpi);
}

test("the shared JPEG encoder uses requested MIME, quality and both DPI axes", async () => {
  const harness = appHarness();
  const canvas = harness.element("outputCanvas");
  canvas.width = 637; canvas.height = 425;
  const blob = await harness.context.encodeCanvasJpeg(canvas, { dpi: 300, quality: .92 });
  assert.equal(harness.encodings.length, 1);
  assert.deepEqual({ ...harness.encodings[0], canvas: undefined }, { canvas: undefined, width: 637, height: 425, type: "image/jpeg", quality: .92 });
  await assertDpi(blob, 300);
});

test("map preview and JPEG encoding preserve the full generated dimensions", async () => {
  const harness = appHarness();
  const image = { width: 1601, height: 901, data: new Uint8ClampedArray(1601 * 901 * 4) };
  const preview = harness.element("heightPreviewCanvas");
  harness.context.showMapPreview(preview, preview.getContext(), image);
  assert.equal(preview.width, image.width);
  assert.equal(preview.height, image.height);
  const blob = await harness.context.encodeImageJpeg(image, { dpi: 200, quality: .97 });
  const encoded = harness.encodings.at(-1);
  assert.equal(encoded.width, image.width);
  assert.equal(encoded.height, image.height);
  assert.equal(encoded.type, "image/jpeg");
  assert.equal(encoded.quality, .97);
  assert.notEqual(encoded.canvas, preview);
  await assertDpi(blob, 200);
});

test("one relief job exports three JPGs with captured dimensions, quality and DPI", async () => {
  const harness = appHarness();
  harness.element("dpi").value = "200";
  vm.runInContext(`
    state.width = 120; state.height = 70;
    state.classMap = new Uint32Array(120 * 70);
    state.imageData = {}; state.palette = [{ loopRgb: { r: 255, g: 255, b: 255 } }];
    state.recessedClasses = new Set([1]);
  `, harness.context);
  const texture = harness.context.currentRenderOptions();
  const completion = harness.context.renderNormal();
  assert.equal(harness.jobs.length, 1);
  const reliefJob = harness.jobs[0];
  assert.equal(reliefJob.options.output, "relief");
  assert.equal(texture.outW, 945);
  assert.equal(texture.outH, 919);
  for (const key of ["dpi", "outW", "outH", "cellW", "cellH", "physicalWidthCm", "physicalHeightCm"]) {
    assert.equal(reliefJob.options[key], texture[key], key);
  }
  // An input edit while encoding is pending must not label the already
  // rendered pixels with a new DPI. UI invalidation is tested separately.
  harness.element("dpi").value = "300";
  const makeImage = () => ({ width: texture.outW, height: texture.outH, data: new Uint8ClampedArray(texture.outW * texture.outH * 4) });
  for (const kind of ["height", "normal", "ao"]) await reliefJob.callbacks.onMap(kind, makeImage());
  reliefJob.resolve({ elapsed: 1 });
  await completion;
  assert.equal(harness.jobs.length, 1);
  assert.equal(harness.encodings.length, 3);
  assert.equal(harness.blobs.length, 3);
  for (const encoded of harness.encodings) {
    assert.equal(encoded.width, texture.outW);
    assert.equal(encoded.height, texture.outH);
    assert.equal(encoded.type, "image/jpeg");
    assert.equal(encoded.quality, .92);
  }
  for (const blob of harness.blobs) await assertDpi(blob, 200);
  for (const id of ["heightDownloadButton", "normalDownloadButton", "aoDownloadButton"]) {
    assert.equal(harness.element(id).disabled, false);
    harness.element(id).listeners.click();
  }
  assert.deepEqual(harness.downloads.map(item => item.download), ["fabric-height-radial.jpg", "fabric-normal-opengl.jpg", "fabric-ao.jpg"]);
});
