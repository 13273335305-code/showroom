/*
 * BMP -> knit loops.
 *
 * The input palette is discovered from the pixels that are actually used in
 * the BMP. Palette entries are sorted by usage count, so the most common
 * source color becomes color 0. Every source pixel stores one palette index;
 * the renderer creates two vertically stacked knit-loop cells in that cell.
 */

const $ = (id) => document.getElementById(id);
const embeddedInMaterialEditor = new URLSearchParams(location.search).get("embed") === "1";
document.body.classList.toggle("embedded", embeddedInMaterialEditor);
const inputCanvas = $("inputCanvas");
const outputCanvas = $("outputCanvas");
const inputCtx = inputCanvas.getContext("2d", { willReadFrequently: true });
const outputCtx = outputCanvas.getContext("2d");
const heightPreviewCanvas = $("heightPreviewCanvas");
const heightPreviewCtx = heightPreviewCanvas?.getContext("2d");
const normalPreviewCanvas = $("normalPreviewCanvas");
const normalPreviewCtx = normalPreviewCanvas?.getContext("2d");
// The supplied case maps 10 BMP pixels to one centimetre horizontally and
// 6 BMP pixels to one centimetre vertically (2376×600 px → 237.6×100 cm).
// The horizontal calibration stays fixed; the vertical value is editable in
// the UI. Keep the calibration in one place so the UI and renderer use the
// same rule.
const BMP_CM_PER_PIXEL_X = 0.1;
const DEFAULT_BMP_PIXELS_PER_CM_Y = 6;
const CM_PER_INCH = 2.54;
const LOOPS_Y_PER_PIXEL = 2;
const state = {
  bitmap: null,
  imageData: null,
  classMap: null,
  width: 0,
  height: 0,
  pixels: 0,
  palette: [],
  jpegUrl: null,
  heightUrl: null,
  normalUrl: null,
  renderQueued: false,
  renderId: 0,
  renderedId: 0,
  jpegEncodeId: 0,
  renderJob: null,
  normalJob: null,
  normalRenderId: 0,
  heightJob: null,
  recessedClasses: new Set(),
  renderOptions: null,
  sourceFile: null,
  sourceName: "",
  requestId: null
};

function proceduralMappingSnapshot() {
  const options = state.renderOptions || currentRenderOptions();
  return {
    version: 1,
    sourceName: state.sourceName || state.sourceFile?.name || "source.bmp",
    width: state.width,
    height: state.height,
    palette: state.palette.map(entry => ({ index: entry.index, sourceHex: entry.sourceHex, loopHex: entry.loopHex, count: entry.count, sourceIndex: entry.sourceIndex })),
    recessedClasses: [...state.recessedClasses],
    options: {
      background: options.background,
      contrast: options.contrast,
      texture: options.texture,
      angle: options.angle,
      dpi: options.dpi,
      pixelsPerCmY: options.pixelsPerCmY,
      reliefRadius: options.reliefRadius,
      reliefDepth: options.reliefDepth,
      quality: Number($("quality")?.value || 92) / 100
    }
  };
}

function postProceduralState(includeSource = false) {
  if (!embeddedInMaterialEditor || !state.sourceFile) return;
  window.parent.postMessage({
    type: "procedural-state",
    sourceFile: includeSource ? state.sourceFile : undefined,
    mapping: proceduralMappingSnapshot()
  }, "*");
}

const previewViewports = [];
function mountPreviewViewport(viewport, canvas, label) {
  if (!viewport || !canvas) return null;
  const view = { viewport, canvas, scale: 1, fitScale: 1, offsetX: 0, offsetY: 0, initialized: false, dragging: null };
  const renderView = () => {
    if (!canvas.width || !canvas.height) return;
    const bounds = viewport.getBoundingClientRect();
    const fitScale = Math.min((bounds.width - 24) / canvas.width, (bounds.height - 24) / canvas.height);
    if (!(fitScale > 0)) return;
    view.fitScale = Math.max(.02, Math.min(8, fitScale));
    if (!view.initialized) { view.scale = view.fitScale; view.initialized = true; }
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    canvas.style.transform = `translate(calc(-50% + ${view.offsetX}px),calc(-50% + ${view.offsetY}px)) scale(${view.scale})`;
    if (label) label.textContent = `${Math.round(view.scale / view.fitScale * 100)}%`;
  };
  const reset = () => { view.initialized = false; view.offsetX = view.offsetY = 0; renderView(); };
  viewport.addEventListener('wheel', event => {
    if (!canvas.width) return;
    event.preventDefault();
    const bounds = viewport.getBoundingClientRect();
    const cursorX = event.clientX - bounds.left - bounds.width / 2 - view.offsetX;
    const cursorY = event.clientY - bounds.top - bounds.height / 2 - view.offsetY;
    const next = Math.max(view.fitScale * .35, Math.min(view.fitScale * 12, view.scale * (event.deltaY < 0 ? 1.12 : .89)));
    const factor = next / view.scale;
    view.offsetX -= cursorX * (factor - 1);
    view.offsetY -= cursorY * (factor - 1);
    view.scale = next;
    renderView();
  }, { passive: false });
  viewport.addEventListener('pointerdown', event => {
    if (!canvas.width || event.button !== 0) return;
    view.dragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture?.(event.pointerId);
    viewport.classList.add('is-panning');
  });
  viewport.addEventListener('pointermove', event => {
    if (!view.dragging || view.dragging.pointerId !== event.pointerId) return;
    view.offsetX += event.clientX - view.dragging.x;
    view.offsetY += event.clientY - view.dragging.y;
    view.dragging.x = event.clientX; view.dragging.y = event.clientY;
    renderView();
  });
  const stop = event => {
    if (!view.dragging || (event.pointerId !== undefined && view.dragging.pointerId !== event.pointerId)) return;
    view.dragging = null; viewport.classList.remove('is-panning');
  };
  viewport.addEventListener('pointerup', stop); viewport.addEventListener('pointercancel', stop); viewport.addEventListener('lostpointercapture', stop);
  new ResizeObserver(renderView).observe(viewport);
  view.render = renderView; view.reset = reset;
  previewViewports.push(view);
  return view;
}

const outputViewport = mountPreviewViewport($('outputWrap'), outputCanvas, $('textureZoomLabel'));
const heightViewport = mountPreviewViewport($('heightPreviewWrap'), heightPreviewCanvas);
const normalViewport = mountPreviewViewport($('normalPreviewWrap'), normalPreviewCanvas);
const previewPanels = { fabric: $('fabricPreviewPanel'), height: $('heightPreviewPanel'), normal: $('normalPreviewPanel') };
function setPreviewMap(mode) {
  for (const [key, panel] of Object.entries(previewPanels)) if (panel) panel.hidden = key !== mode;
  document.querySelectorAll('[data-preview-map]').forEach(button => {
    const active = button.dataset.previewMap === mode;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
  });
  requestAnimationFrame(() => previewViewports.forEach(view => view.render?.()));
}
document.querySelectorAll('[data-preview-map]').forEach(button => { button.addEventListener('click', () => setPreviewMap(button.dataset.previewMap)); });
setPreviewMap('fabric');

function outputDpi() {
  const input = $("dpi");
  const value = Number(input?.value);
  return Number.isFinite(value) && value > 0 ? Math.min(1200, Math.max(1, value)) : 100;
}

function bmpPixelsPerCmY() {
  const value = Number($("bmpPixelsPerCmY")?.value);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BMP_PIXELS_PER_CM_Y;
}

function physicalMetrics(dpi = outputDpi()) {
  const widthCm = state.width * BMP_CM_PER_PIXEL_X;
  const pixelsPerCmY = bmpPixelsPerCmY();
  const heightCm = state.height / pixelsPerCmY;
  return {
    widthCm,
    heightCm,
    pixelsPerCmY,
    widthIn: widthCm / CM_PER_INCH,
    heightIn: heightCm / CM_PER_INCH,
    dpi,
    outW: Math.max(1, Math.round(widthCm / CM_PER_INCH * dpi)),
    outH: Math.max(1, Math.round(heightCm / CM_PER_INCH * dpi))
  };
}

function updatePhysicalSizeInfo() {
  const info = $("physicalSizeInfo");
  if (!info) return;
  if (!state.width || !state.height) {
    info.textContent = "等待 BMP · 物理尺寸 —";
    return;
  }
  const metrics = physicalMetrics();
  info.textContent = `物理尺寸 ${metrics.widthCm.toFixed(1)} × ${metrics.heightCm.toFixed(1)} cm · ${metrics.widthIn.toFixed(2)} × ${metrics.heightIn.toFixed(2)} in · 输出 ${metrics.outW} × ${metrics.outH} px @ ${metrics.dpi} DPI · 纵向 ${metrics.pixelsPerCmY} BMP 像素/cm`;
}

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function clamp(n, lo = 0, hi = 255) { return Math.max(lo, Math.min(hi, n)); }

function updateRangeOutput(id, formatter = (v) => v) { $(id + "Value").value = formatter($(id).value); }
function colorKey(r, g, b) { return `${r},${g},${b}`; }

function parseIndexedBmp(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 54 || view.getUint16(0, true) !== 0x4D42) return null;
  const dibSize = view.getUint32(14, true);
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const bpp = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  if (dibSize < 40 || width <= 0 || rawHeight === 0 || bpp !== 8 || compression !== 0) return null;
  const height = Math.abs(rawHeight);
  const paletteCount = view.getUint32(46, true) || 256;
  const paletteOffset = 14 + dibSize;
  const palette = [];
  for (let i = 0; i < paletteCount && paletteOffset + i * 4 + 3 < view.byteLength; i++) {
    const b = view.getUint8(paletteOffset + i * 4);
    const g = view.getUint8(paletteOffset + i * 4 + 1);
    const r = view.getUint8(paletteOffset + i * 4 + 2);
    palette.push({ r, g, b });
  }
  const pixelsOffset = view.getUint32(10, true);
  const rowStride = Math.ceil(width / 4) * 4;
  if (pixelsOffset + rowStride * height > view.byteLength) return null;
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sourceRow = rawHeight > 0 ? height - 1 - y : y;
    for (let x = 0; x < width; x++) indices[y * width + x] = view.getUint8(pixelsOffset + sourceRow * rowStride + x);
  }
  return { width, height, indices, palette };
}

function renderPaletteControls() {
  const container = $("paletteControls");
  container.replaceChildren();
  if (!state.palette.length) {
    container.innerHTML = '<div class="palette-empty">等待 BMP 色号</div>';
    $("resetPalette").disabled = true;
    return;
  }
  for (const entry of state.palette) {
    const row = document.createElement("div");
    row.className = "palette-row";
    const relief = document.createElement("input");
    relief.type = "checkbox";
    relief.className = "relief-toggle";
    relief.checked = state.recessedClasses.has(entry.index);
    relief.title = `色号 ${entry.index} 的像素生成径向凹陷`;
    relief.setAttribute("aria-label", `色号 ${entry.index} 生成凹陷`);
    relief.addEventListener("change", () => {
      if (relief.checked) state.recessedClasses.add(entry.index);
      else state.recessedClasses.delete(entry.index);
      invalidateNormal("凹陷色号已修改，请重新生成高度图和法线图");
    });
    const id = document.createElement("span");
    id.className = "palette-id";
    id.textContent = `色号 ${entry.index}`;
    const source = document.createElement("span");
    source.className = "source-swatch";
    source.title = `BMP 原色 ${entry.sourceHex}${entry.sourceIndex === null ? "" : ` · BMP#${entry.sourceIndex}`}`;
    source.style.backgroundColor = entry.sourceHex;
    const input = document.createElement("input");
    input.type = "color";
    input.value = entry.loopHex;
    input.title = `色号 ${entry.index} 的线圈颜色`;
    const count = document.createElement("output");
    count.className = "palette-count";
    count.value = `${entry.count.toLocaleString()} px`;
    input.addEventListener("input", () => {
      entry.loopHex = input.value.toUpperCase();
      entry.loopRgb = hexToRgb(entry.loopHex);
      postProceduralState();
      requestRender();
    });
    row.append(relief, id, source, input, count);
    container.append(row);
  }
  $("resetPalette").disabled = false;
}

function analyzePalette(data, indexedBmp = null) {
  const counts = new Map();
  for (let p = 0; p < data.length / 4; p++) {
    const pixelOffset = p * 4;
    const paletteIndex = indexedBmp?.indices[p];
    const indexedColor = indexedBmp && indexedBmp.palette[paletteIndex];
    const r = indexedColor?.r ?? data[pixelOffset];
    const g = indexedColor?.g ?? data[pixelOffset + 1];
    const b = indexedColor?.b ?? data[pixelOffset + 2];
    const key = colorKey(r, g, b);
    const item = counts.get(key) || { count: 0, sourceIndex: paletteIndex ?? null };
    item.count++;
    if (paletteIndex !== undefined && paletteIndex < item.sourceIndex) item.sourceIndex = paletteIndex;
    counts.set(key, item);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  state.palette = entries.map(([key, item], index) => {
    const [r, g, b] = key.split(",").map(Number);
    const hex = rgbToHex(r, g, b);
    return { index, key, count: item.count, sourceIndex: item.sourceIndex, sourceHex: hex, loopHex: hex, loopRgb: { r, g, b } };
  });
  // The dominant/background color remains flat by default. Other color
  // classes are selected so the first generated map is useful immediately;
  // the checkboxes let the user refine the set per color number.
  state.recessedClasses = new Set(state.palette.map((entry) => entry.index).filter((index) => index > 0));
  const lookup = new Map(state.palette.map((entry) => [entry.key, entry.index]));
  state.classMap = new Uint32Array(state.pixels);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const paletteIndex = indexedBmp?.indices[p];
    const indexedColor = indexedBmp && indexedBmp.palette[paletteIndex];
    const key = colorKey(indexedColor?.r ?? data[i], indexedColor?.g ?? data[i + 1], indexedColor?.b ?? data[i + 2]);
    state.classMap[p] = lookup.get(key) ?? 0;
  }
  const indexedNote = indexedBmp ? `，保留 BMP 调色板索引（0 号色对应 BMP#${state.palette[0]?.sourceIndex ?? "-"}）` : "";
  $("paletteInfo").textContent = `自动识别 ${state.palette.length} 个实际颜色；按像素数量排序，${state.palette[0]?.sourceHex || ""} 为网页色号 0${indexedNote}。`;
  renderPaletteControls();
}

async function loadFile(file) {
  if (!file) return;
  setStatus("读取 BMP…", false);
  try {
    state.sourceFile = file;
    state.sourceName = file.name || "source.bmp";
    const buffer = await file.arrayBuffer();
    const indexedBmp = parseIndexedBmp(buffer);
    const bitmap = await createImageBitmap(new Blob([buffer], { type: file.type || "image/bmp" }));
    state.bitmap?.close();
    state.bitmap = bitmap;
    state.width = bitmap.width;
    state.height = bitmap.height;
    inputCanvas.width = state.width;
    inputCanvas.height = state.height;
    inputCtx.clearRect(0, 0, state.width, state.height);
    inputCtx.drawImage(bitmap, 0, 0);
    $("inputEmptyState").hidden = true;
    state.imageData = inputCtx.getImageData(0, 0, state.width, state.height);
    state.pixels = state.width * state.height;
    const usableIndexedBmp = indexedBmp && indexedBmp.width === state.width && indexedBmp.height === state.height ? indexedBmp : null;
    analyzePalette(state.imageData.data, usableIndexedBmp);
    updatePhysicalSizeInfo();
    $("renderButton").disabled = false;
    $("normalButton").disabled = false;
    invalidateNormal("已载入 BMP，可生成径向高度图和 OpenGL 法线图");
    setStatus(`已载入 ${file.name}`, true);
    postProceduralState(true);
    render();
  } catch (error) {
    console.error(error);
    setStatus("读取失败，请选择标准 BMP", false);
  }
}

async function loadSample() {
  try {
    const response = await fetch("../渲染案例/SPNC-440.bmp");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    await loadFile(new File([blob], "SPNC-440.bmp", { type: "image/bmp" }));
  } catch (error) {
    setStatus("案例读取失败，请手动选择 BMP", false);
    console.warn(error);
  }
}

function setStatus(text, ready) {
  $("statusPill").textContent = text;
  $("statusPill").classList.toggle("ready", ready);
}

function applyProceduralMapping(mapping = {}) {
  const options = mapping.options || {};
  const setValue = (id, value) => {
    const input = $(id);
    if (input && value !== undefined && value !== null && Number.isFinite(Number(value))) input.value = String(value);
  };
  setValue("texture", Number(options.texture || 0) * 100);
  setValue("contrast", Number(options.contrast || 0) * 100);
  setValue("angle", options.angle);
  setValue("dpi", options.dpi);
  setValue("bmpPixelsPerCmY", options.pixelsPerCmY);
  setValue("reliefRadius", options.reliefRadius);
  setValue("reliefDepth", Number(options.reliefDepth || 0) * 100);
  if (typeof options.quality === "number") setValue("quality", options.quality * 100);
  if (options.background) {
    const background = rgbToHex(options.background.r, options.background.g, options.background.b);
    $("backgroundColor").value = background;
    $("backgroundColorValue").value = background;
  }
  if (Array.isArray(mapping.palette)) {
    const byIndex = new Map(mapping.palette.map(entry => [Number(entry.index), entry]));
    for (const entry of state.palette) {
      const saved = byIndex.get(entry.index);
      if (!saved || !/^#[\da-f]{6}$/i.test(saved.loopHex || "")) continue;
      entry.loopHex = saved.loopHex.toUpperCase();
      entry.loopRgb = hexToRgb(entry.loopHex);
    }
    renderPaletteControls();
  }
  if (Array.isArray(mapping.recessedClasses)) state.recessedClasses = new Set(mapping.recessedClasses.map(Number).filter(Number.isInteger));
  updateRangeOutput("texture"); updateRangeOutput("contrast"); updateRangeOutput("angle", v => `${v}°`); updateRangeOutput("quality"); updateRangeOutput("reliefDepth"); updatePhysicalSizeInfo();
  invalidateNormal("色号映射已更新，可重新生成法线图");
  requestRender();
  postProceduralState();
}

window.addEventListener("message", async event => {
  const data = event.data;
  if (!data || !["procedural-load", "procedural-update"].includes(data.type)) return;
  try {
    state.requestId = data.requestId ?? null;
    const source = data.sourceFile;
    if (source && (!state.sourceFile || state.sourceFile.size !== source.size || state.sourceFile.name !== (source.name || state.sourceName))) {
      const file = source instanceof File ? source : new File([source], source.name || "source.bmp", { type: source.type || "image/bmp" });
      await loadFile(file);
    }
    if (!state.imageData) throw new Error("尚未载入 BMP 源图");
    applyProceduralMapping(data.mapping || {});
  } catch (error) {
    console.error(error);
    window.parent.postMessage({ type: "procedural-error", requestId: state.requestId, message: error.message }, "*");
  }
});

function invalidateNormal(message = "等待生成 OpenGL 法线图") {
  state.normalJob?.cancel();
  state.heightJob?.cancel();
  state.normalJob = null;
  state.heightJob = null;
  state.normalRenderId++;
  clearMapResults();
  const download = $("normalDownloadButton");
  if (download) download.disabled = true;
  const button = $("normalButton");
  if (button) button.disabled = !state.imageData;
  const info = $("normalInfo");
  if (info) info.textContent = message;
}

function currentRenderOptions() {
  const metrics = physicalMetrics(outputDpi());
  const { outW, outH } = metrics;
  const reliefRadius = Number($("reliefRadius")?.value || 1);
  return {
    width: state.width, height: state.height, classMap: state.classMap,
    palette: state.palette.map((entry) => entry.loopRgb),
    background: hexToRgb($("backgroundColor").value),
    cellW: outW / state.width, cellH: outH / state.height, outW, outH,
    loopsY: LOOPS_Y_PER_PIXEL,
    dpi: metrics.dpi, physicalWidthCm: metrics.widthCm, physicalHeightCm: metrics.heightCm,
    pixelsPerCmY: metrics.pixelsPerCmY,
    contrast: Number($("contrast").value) / 100,
    texture: Number($("texture").value) / 100,
    angle: Number($("angle").value),
    // The relief map is intentionally independent from loop shading. Pass a
    // plain array so the same settings survive Worker structured cloning.
    reliefClasses: [...state.recessedClasses],
    reliefRadius: Number.isFinite(reliefRadius) ? Math.max(.05, reliefRadius) : 1,
    reliefDepth: Math.max(0, Math.min(1, Number($("reliefDepth")?.value || 0) / 100))
  };
}

// All three outputs use the same JPEG encoder, quality and JFIF DPI writer.
async function encodeCanvasJpeg(canvas, { dpi, quality }) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("浏览器无法编码此尺寸的 JPG，请降低 DPI 重试。"));
    }, "image/jpeg", quality);
  });
  return applyJpegDpi(blob, dpi);
}

async function encodeImageJpeg(image, settings) {
  // Keep the export canvas separate from the bounded preview: a large map
  // must retain the exact pixel dimensions produced by physicalMetrics().
  const canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("JPG 编码画布不可用");
  try {
    ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    return await encodeCanvasJpeg(canvas, settings);
  } finally {
    // Release the full-size backing store after encoding each map.
    canvas.width = 1; canvas.height = 1;
  }
}

function showMapPreview(canvas, ctx, image) {
  if (!canvas || !ctx) return;
  // Preview maps at a bounded size so a 100-DPI case does not allocate a
  // second full-resolution RGBA backing store. Downloads still use `image` at
  // its original dimensions.
  const scale = Math.min(1, 1200 / image.width, 800 / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  canvas.width = width; canvas.height = height;
  if (scale === 1) {
    ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    return;
  }
  const preview = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scale));
      const source = (sourceY * image.width + sourceX) * 4;
      const target = (y * width + x) * 4;
      preview[target] = image.data[source];
      preview[target + 1] = image.data[source + 1];
      preview[target + 2] = image.data[source + 2];
      preview[target + 3] = 255;
    }
  }
  ctx.putImageData(new ImageData(preview, width, height), 0, 0);
}

async function replaceMapUrl(kind, image, settings, id) {
  const jpeg = await encodeImageJpeg(image, settings);
  if (id !== state.normalRenderId) return;
  const key = `${kind}Url`;
  if (state[key]) URL.revokeObjectURL(state[key]);
  state[key] = URL.createObjectURL(jpeg);
  const button = $(kind === "height" ? "heightDownloadButton" : "normalDownloadButton");
  if (button) button.disabled = false;
  if (kind === "normal" && embeddedInMaterialEditor) void applyRenderedNormal();
}

function clearMapResults() {
  for (const key of ["heightUrl", "normalUrl"]) {
    if (state[key]) URL.revokeObjectURL(state[key]);
    state[key] = null;
  }
  $("heightDownloadButton").disabled = true;
  $("normalDownloadButton").disabled = true;
  if ($("heightEmptyState")) $("heightEmptyState").hidden = false;
  if ($("normalEmptyState")) $("normalEmptyState").hidden = false;
}

async function renderNormal() {
  if (!state.imageData || !state.classMap?.length) return;
  const id = ++state.normalRenderId;
  state.normalJob?.cancel();
  state.heightJob?.cancel();
  clearMapResults();
  $("normalButton").disabled = true;
  const base = currentRenderOptions();
  const jpegSettings = { dpi: base.dpi, quality: Number($("quality").value) / 100 };
  const metrics = physicalMetrics(outputDpi());
  $("normalInfo").textContent = `${metrics.outW}×${metrics.outH} · 正在生成径向高度图…`;
  let lastProgress = -1;
  try {
    let heightJob = state.heightJob = KnitRenderJob.start({ ...base, output: "height" }, {
      onProgress(progress) {
        const percent = Math.floor(progress * 100);
        if (id === state.normalRenderId && percent !== lastProgress) {
          lastProgress = percent;
          $("normalInfo").textContent = `${metrics.outW}×${metrics.outH} · 正在生成高度图 ${percent}%`;
        }
      }
    });
    let { image: heightImage } = await heightJob.promise;
    if (id !== state.normalRenderId) return;
    showMapPreview(heightPreviewCanvas, heightPreviewCtx, heightImage);
    heightViewport?.reset();
    $("heightEmptyState").hidden = true;
    $("normalInfo").textContent = `${metrics.outW}×${metrics.outH} · 正在编码高度 JPG…`;
    await replaceMapUrl("height", heightImage, jpegSettings, id);
    heightImage = null;
    if (state.heightJob === heightJob) state.heightJob = null;
    heightJob = null;
    if (id !== state.normalRenderId) return;
    $("normalInfo").textContent = `${metrics.outW}×${metrics.outH} · 高度 JPG 完成，正在计算法线…`;
    lastProgress = -1;
    const normalJob = state.normalJob = KnitRenderJob.start({ ...base, output: "normal" }, {
      onProgress(progress) {
        const percent = Math.floor(progress * 100);
        if (id === state.normalRenderId && percent !== lastProgress) {
          lastProgress = percent;
          $("normalInfo").textContent = `${metrics.outW}×${metrics.outH} · 正在从高度图计算法线 ${percent}%`;
        }
      }
    });
    const { image: normalImage } = await normalJob.promise;
    if (id !== state.normalRenderId) return;
    showMapPreview(normalPreviewCanvas, normalPreviewCtx, normalImage);
    normalViewport?.reset();
    $("normalEmptyState").hidden = true;
    $("normalInfo").textContent = `${metrics.outW}×${metrics.outH} · 正在编码法线 JPG…`;
    await replaceMapUrl("normal", normalImage, jpegSettings, id);
    if (id !== state.normalRenderId) return;
    state.normalJob = null;
    $("normalInfo").textContent = `${normalImage.width}×${normalImage.height} · ${jpegSettings.dpi} DPI · 高度 JPG + OpenGL 法线 JPG 已生成`;
  } catch (error) {
    if (id !== state.normalRenderId || error.name === "AbortError") return;
    console.error(error);
    $("normalInfo").textContent = "高度图/法线图生成失败：" + error.message;
  } finally {
    if (id === state.normalRenderId) $("normalButton").disabled = false;
  }
}

function render() {
  if (!state.imageData || state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => { state.renderQueued = false; renderNow(); });
}
function requestRender() { render(); }

async function applyJpegDpi(blob, dpi) {
  if (!blob?.arrayBuffer) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 2 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return blob;
  const density = Math.max(1, Math.min(65535, Math.round(dpi)));
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xFF) { offset++; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xDA || marker === 0xD9) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (marker === 0xE0 && length >= 16
      && bytes[offset + 4] === 0x4A && bytes[offset + 5] === 0x46
      && bytes[offset + 6] === 0x49 && bytes[offset + 7] === 0x46
      && bytes[offset + 8] === 0x00) {
      bytes[offset + 11] = 1; // density units: dots per inch
      bytes[offset + 12] = density >> 8;
      bytes[offset + 13] = density & 0xFF;
      bytes[offset + 14] = density >> 8;
      bytes[offset + 15] = density & 0xFF;
      return new Blob([bytes], { type: "image/jpeg" });
    }
    offset += 2 + length;
  }
  // Browser encoders normally emit JFIF. Add the density segment when an
  // otherwise valid JPEG has no JFIF header, rather than silently losing DPI.
  const jfif = new Uint8Array([
    0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 1,
    density >> 8, density & 0xFF, density >> 8, density & 0xFF, 0, 0
  ]);
  return new Blob([bytes.subarray(0, 2), jfif, bytes.subarray(2)], { type: "image/jpeg" });
}

async function exportJpeg(id) {
  const encodeId = ++state.jpegEncodeId;
  const settings = { dpi: state.renderOptions?.dpi ?? outputDpi(), quality: Number($("quality").value) / 100 };
  $("downloadButton").disabled = true;
  const fail = (error) => {
    if (id !== state.renderId) return;
    console.error(error);
    $("renderInfo").textContent = "JPG 导出失败：" + error.message;
  };
  try {
    const jpeg = await encodeCanvasJpeg(outputCanvas, settings);
    if (id !== state.renderId || encodeId !== state.jpegEncodeId) return;
    if (state.jpegUrl) URL.revokeObjectURL(state.jpegUrl);
    state.jpegUrl = URL.createObjectURL(jpeg);
    $("downloadButton").disabled = false;
    if (embeddedInMaterialEditor) void applyRenderedMaterial();
  } catch (error) { fail(error); }
}

async function applyRenderedMaterial() {
  if (!embeddedInMaterialEditor || !state.jpegUrl) return;
  try {
    const response = await fetch(state.jpegUrl);
    if (!response.ok) throw new Error("无法读取生成的 JPG");
    const file = await response.blob();
    const metrics = state.renderOptions && physicalMetrics(state.renderOptions.dpi);
    window.parent.postMessage({
      type: "procedural-material",
      name: "procedural-material.jpg",
      file,
      requestId: state.requestId,
      physical: metrics ? { widthCm: metrics.widthCm, heightCm: metrics.heightCm } : null
    }, "*");
    setStatus("纹理 JPG 已自动应用到材质编辑器", true);
  } catch (error) {
    console.error(error);
    setStatus("应用 JPG 失败：" + error.message, false);
  }
}

async function applyRenderedNormal() {
  if (!embeddedInMaterialEditor || !state.normalUrl) return;
  try {
    const response = await fetch(state.normalUrl);
    if (!response.ok) throw new Error("无法读取生成的法线 JPG");
    const file = await response.blob();
    const metrics = state.renderOptions && physicalMetrics(state.renderOptions.dpi);
    window.parent.postMessage({
      type: "procedural-normal-material",
      name: "procedural-normal-opengl.jpg",
      file,
      requestId: state.requestId,
      physical: metrics ? { widthCm: metrics.widthCm, heightCm: metrics.heightCm } : null
    }, "*");
    setStatus("法线 JPG 已自动应用到材质编辑器", true);
  } catch (error) {
    console.error(error);
    setStatus("应用法线 JPG 失败：" + error.message, false);
  }
}

async function renderNow() {
  const id = ++state.renderId;
  state.renderJob?.cancel();
  $("downloadButton").disabled = true;
  try {
    const metrics = physicalMetrics(outputDpi());
    const { outW, outH } = metrics;
    const cellW = outW / state.width;
    const cellH = outH / state.height;
    $("renderInfo").textContent = `${outW}×${outH} · 正在渲染纱线与穿套阴影…`;
    $("emptyState").textContent = "正在生成面料…";
    const options = state.renderOptions = currentRenderOptions();
    let lastProgress = -1;
    const job = state.renderJob = KnitRenderJob.start(options, {
      onProgress(progress) {
        const percent = Math.floor(progress * 100);
        if (id === state.renderId && percent !== lastProgress) {
          lastProgress = percent;
          $("renderInfo").textContent = `${outW}×${outH} · 正在渲染 ${percent}%`;
        }
      }
    });
    const { image, elapsed } = await job.promise;
    if (id !== state.renderId) return;
    outputCanvas.width = image.width; outputCanvas.height = image.height;
    outputCtx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    outputViewport?.reset();
    state.renderedId = id;
    $("emptyState").hidden = true;
    const loopCellH = cellH / LOOPS_Y_PER_PIXEL;
    $("renderInfo").textContent = `${outW}×${outH} · ${metrics.widthCm.toFixed(1)}×${metrics.heightCm.toFixed(1)} cm · ${metrics.dpi} DPI · 1 像素 = 上下 2 个线圈 · 每个线圈 ${cellW.toFixed(2)}×${loopCellH.toFixed(2)} 像素 · ${(elapsed / 1000).toFixed(1)} 秒`;
    await exportJpeg(id);
  } catch (error) {
    if (id !== state.renderId || error.name === "AbortError") return;
    console.error(error);
    $("renderInfo").textContent = "渲染失败：" + error.message;
    $("emptyState").textContent = "渲染失败，请点击“渲染纹理”重试。";
  }
}

$("downloadButton").addEventListener("click", () => {
  if (!state.jpegUrl) return;
  const a = document.createElement("a");
  a.href = state.jpegUrl; a.download = "fabric-render.jpg"; a.click();
});
$("normalButton").addEventListener("click", () => { void renderNormal(); });
$("normalDownloadButton").addEventListener("click", () => {
  if (!state.normalUrl) return;
  const a = document.createElement("a");
  a.href = state.normalUrl; a.download = "fabric-normal-opengl.jpg"; a.click();
});
$("heightDownloadButton").addEventListener("click", () => {
  if (!state.heightUrl) return;
  const a = document.createElement("a");
  a.href = state.heightUrl; a.download = "fabric-height-radial.jpg"; a.click();
});
$("fileInput").addEventListener("change", (event) => {
  const file = event.target.files[0];
  // Reset the input so choosing the same BMP again still triggers a reload.
  event.target.value = "";
  void loadFile(file);
});
$("loadSample").addEventListener("click", loadSample);
$("renderButton").addEventListener("click", render);
$("resetPalette").addEventListener("click", () => {
  for (const entry of state.palette) {
    entry.loopHex = entry.sourceHex;
    entry.loopRgb = hexToRgb(entry.loopHex);
  }
  renderPaletteControls();
  postProceduralState();
  requestRender();
});
$("backgroundColor").addEventListener("input", () => {
  $("backgroundColorValue").value = $("backgroundColor").value.toUpperCase();
  requestRender();
});
for (const id of ["texture", "contrast", "angle", "quality"]) {
  $(id).addEventListener("input", () => {
    if (id === "angle") updateRangeOutput(id, (v) => `${v}°`);
    else updateRangeOutput(id);
    if (id === "quality") {
      if (state.renderedId === state.renderId && state.renderedId) exportJpeg(state.renderId);
      if (state.heightJob || state.normalJob || state.heightUrl || state.normalUrl) {
        invalidateNormal("JPG 质量已修改，请重新生成高度图和法线图");
      }
    } else {
      // The normal map contains only the class-based macro relief, so color
      // shading and yarn-angle changes do not invalidate a completed result.
      requestRender();
    }
    postProceduralState();
  });
}
$("reliefDepth").addEventListener("input", () => {
  updateRangeOutput("reliefDepth");
  invalidateNormal("径向凹陷深度已修改，请重新生成高度图和法线图");
  postProceduralState();
});
$("reliefRadius").addEventListener("input", () => {
  invalidateNormal("径向渐变半径已修改，请重新生成高度图和法线图");
  postProceduralState();
});
$("dpi").addEventListener("input", () => {
  updatePhysicalSizeInfo();
  if (state.heightJob || state.normalJob || state.heightUrl || state.normalUrl) invalidateNormal("DPI 已修改，请重新生成高度图和法线图");
  requestRender();
  postProceduralState();
});
$("bmpPixelsPerCmY").addEventListener("input", () => {
  updatePhysicalSizeInfo();
  if (state.heightJob || state.normalJob || state.heightUrl || state.normalUrl) {
    invalidateNormal("纵向 BMP 像素/cm 已修改，请重新生成高度图和法线图");
  }
  requestRender();
  postProceduralState();
});
updateRangeOutput("texture");
updateRangeOutput("contrast");
updateRangeOutput("angle", (v) => `${v}°`);
updateRangeOutput("quality");
updateRangeOutput("reliefDepth");
updatePhysicalSizeInfo();
