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
const inlinePanel = embeddedInMaterialEditor && new URLSearchParams(location.search).get('panel') === 'inline';
document.body.classList.toggle("embedded", embeddedInMaterialEditor);
document.documentElement.classList.toggle('inline-panel', inlinePanel);
document.body.classList.toggle('inline-panel', inlinePanel);
if (inlinePanel) {
  // Let the editor own scrolling; only the parameter content determines the
  // frame height, so changing the frame itself cannot trigger a resize loop.
  let lastHeight = 0;
  new ResizeObserver(() => {
    const height = Math.ceil(document.querySelector('.controls').getBoundingClientRect().height);
    if (height > 0 && height !== lastHeight) {
      lastHeight = height;
      window.parent.postMessage({ type: 'procedural-panel-size', height }, '*');
    }
  }).observe(document.querySelector('.controls'));
}
const inputCanvas = $("inputCanvas");
const outputCanvas = $("outputCanvas");
const inputCtx = inputCanvas.getContext("2d", { willReadFrequently: true });
const outputCtx = outputCanvas.getContext("2d");
const heightPreviewCanvas = $("heightPreviewCanvas");
const heightPreviewCtx = heightPreviewCanvas?.getContext("2d");
const normalPreviewCanvas = $("normalPreviewCanvas");
const normalPreviewCtx = normalPreviewCanvas?.getContext("2d");
const aoPreviewCanvas = $("aoPreviewCanvas");
const aoPreviewCtx = aoPreviewCanvas?.getContext("2d");
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
  indexedBmp: null,
  classMap: null,
  width: 0,
  height: 0,
  pixels: 0,
  palette: [],
  jpegUrl: null,
  heightUrl: null,
  normalUrl: null,
  aoUrl: null,
  renderQueued: false,
  renderId: 0,
  renderedId: 0,
  jpegEncodeId: 0,
  renderJob: null,
  normalJob: null,
  normalRenderId: 0,
  reliefOptions: null,
  recessedClasses: new Set(),
  renderOptions: null,
  sourceFile: null,
  sourceLoadId: 0,
  sourceLoading: false,
  sourceName: "",
  requestId: null
};
let paletteColorPicker = null, paletteColorIndex = null;
function setRenderButtonState(id, status) {
  const button = $(id);
  const statuses = {
    empty: ['待上传 BMP', '上传 BMP 后即可渲染'],
    loading: ['读取 BMP…', '正在读取 BMP'],
    pending: id === 'normalButton'
      ? ['需刷新 · 点击渲染', '高度参数已变更，点击重新渲染高度、法线和 AO 贴图']
      : ['等待自动刷新', '纹理参数已变更，即将自动刷新渲染'],
    rendering: ['渲染中…', '正在渲染，请稍候'],
    ready: ['已更新', '当前渲染已更新，点击可重新渲染'],
    error: ['失败 · 点击重试', '渲染失败，请点击重新渲染']
  };
  const [label, hint] = statuses[status];
  button.dataset.renderState = status;
  button.querySelector('.render-action-status').textContent = label;
  button.title = hint;
  button.setAttribute('aria-busy', String(status === 'rendering' || status === 'loading'));
  button.disabled = !state.imageData || ['empty', 'loading', 'rendering'].includes(status);
}
function paletteColorButton(index) {
  return index === "background" ? $("backgroundColorSwatch") : $("paletteControls").querySelector(`[data-color-index="${index}"]`);
}
function positionPaletteColorEditor() {
  const editor = $("paletteColorEditor"), button = paletteColorButton(paletteColorIndex);
  if (!editor || !button || !document.body.classList.contains("embedded")) return;
  const margin = 12, gap = 10, buttonRect = button.getBoundingClientRect(), editorRect = editor.getBoundingClientRect();
  if (!editorRect.width || !editorRect.height) return;
  let left = buttonRect.right - editorRect.width;
  left = Math.max(margin, Math.min(window.innerWidth - editorRect.width - margin, left));
  let minTop = margin, maxBottom = window.innerHeight - margin;
  if (inlinePanel && window.frameElement) {
    const frame = window.frameElement.getBoundingClientRect();
    const panel = window.frameElement.closest('.editor-panel').getBoundingClientRect();
    const scale = frame.height / window.innerHeight || 1;
    minTop = Math.max(minTop, (Math.max(0, panel.top) - frame.top) / scale + margin);
    maxBottom = Math.min(maxBottom, (Math.min(window.parent.innerHeight, panel.bottom) - frame.top) / scale - margin);
  }
  let top = buttonRect.bottom + gap, above = false;
  if (top + editorRect.height > maxBottom) {
    top = buttonRect.top - editorRect.height - gap;
    above = true;
  }
  top = Math.max(minTop, Math.min(maxBottom - editorRect.height, top));
  editor.style.left = `${Math.round(left)}px`;
  editor.style.top = `${Math.round(top)}px`;
  editor.style.setProperty("--palette-transform-origin", `${Math.round(buttonRect.right - left)}px ${above ? "100%" : "0%"}`);
}
function syncPaletteColorSelection() {
  for (const button of $("paletteControls").querySelectorAll('[data-color-index]')) {
    button.setAttribute("aria-expanded", String(Number(button.dataset.colorIndex) === paletteColorIndex));
  }
  const background = $("backgroundColorSwatch");
  background.style.backgroundColor = $("backgroundColor").value;
  background.setAttribute("aria-expanded", String(paletteColorIndex === "background"));
}
function closePaletteColorEditor(restoreFocus = false) {
  const button = paletteColorButton(paletteColorIndex);
  paletteColorIndex = null; paletteColorPicker?.clear(); syncPaletteColorSelection();
  $("paletteColorEditor").dataset.open = "false";
  $("paletteColorEditor").hidden = !state.palette.length;
  if (restoreFocus) button?.focus({ preventScroll: true });
}
function openPaletteColorEditor(index, color) {
  ensurePaletteColorPicker();
  if (paletteColorIndex === index) { closePaletteColorEditor(true); return; }
  paletteColorIndex = index;
  const editor = $("paletteColorEditor");
  editor.hidden = false; editor.dataset.open = "true";
  syncPaletteColorSelection(); paletteColorPicker.open(color); positionPaletteColorEditor();
}
function ensurePaletteColorPicker() {
  if (paletteColorPicker || !globalThis.ProceduralColorPicker || !$("paletteColorEditor")) return;
  paletteColorPicker = globalThis.ProceduralColorPicker.mount($("paletteColorEditor"), {
    prefix: "paletteColor",
    onConfirm(color) {
      if (paletteColorIndex === "background") {
        $("backgroundColor").value = color;
        $("backgroundColor").dispatchEvent(new Event("input", { bubbles: true }));
        closePaletteColorEditor(true); return;
      }
      const entry = state.palette.find(item => item.index === paletteColorIndex);
      if (!entry) return;
      entry.loopHex = color; entry.loopRgb = hexToRgb(color);
      const swatch = $("paletteControls").querySelector(`[data-color-index="${entry.index}"]`);
      swatch.style.backgroundColor = color;
      swatch.closest('.palette-row').querySelector('.palette-hex').value = color.toUpperCase();
      closePaletteColorEditor(true); postProceduralState(); requestRender();
    },
    onCancel() { closePaletteColorEditor(true); }
  });
}
window.addEventListener("resize", () => { if (paletteColorIndex !== null) positionPaletteColorEditor(); });
document.addEventListener("scroll", () => { if (paletteColorIndex !== null) positionPaletteColorEditor(); }, true);
document.addEventListener("pointerdown", event => {
  if (paletteColorIndex === null) return;
  const editor = $("paletteColorEditor"), button = paletteColorButton(paletteColorIndex);
  if (editor.contains(event.target) || button?.contains(event.target)) return;
  closePaletteColorEditor();
}, true);

function proceduralMappingSnapshot() {
  // Read controls at snapshot time so edits made after the last texture
  // render (including relief and blur settings) are persisted immediately.
  const options = currentRenderOptions();
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
      angle: options.angle,
      dpi: options.dpi,
      pixelsPerCmY: options.pixelsPerCmY,
      reliefRadius: options.reliefRadius,
      reliefDepth: options.reliefDepth,
      gaussianBlur: options.gaussianBlur,
      tileable: options.tileable,
      aoRadius: options.aoRadius,
      aoStrength: options.aoStrength,
      quality: Number($("quality")?.value || 92) / 100
    }
  };
}

function postProceduralState(includeSource = false, resetGeneratedMaps = false, resetReliefMaps = false) {
  if (!embeddedInMaterialEditor || !state.sourceFile) return;
  window.parent.postMessage({
    type: "procedural-state",
    sourceRevision: state.sourceLoadId,
    baseRevision: state.renderId,
    reliefRevision: state.normalRenderId,
    resetGeneratedMaps,
    resetReliefMaps,
    sourceFile: includeSource ? state.sourceFile : undefined,
    mapping: proceduralMappingSnapshot()
  }, "*");
}

// The host owns visible previews and crop interaction; these canvases only
// retain source/generated pixels for encoding and export.
$("cropButton").disabled = true;
if (!embeddedInMaterialEditor || inlinePanel) $("cropButton").hidden = true;
$("cropButton").addEventListener("click", () => {
  if (embeddedInMaterialEditor && state.sourceFile) window.parent.postMessage({ type: "procedural-crop-request" }, "*");
});

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
    info.textContent = "";
    return;
  }
  const metrics = physicalMetrics();
  info.textContent = `${metrics.widthCm.toFixed(1)} × ${metrics.heightCm.toFixed(1)} cm · ${metrics.outW} × ${metrics.outH} px`;
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
  ensurePaletteColorPicker();
  closePaletteColorEditor();
  if (!state.palette.length) return;
  for (const entry of state.palette) {
    const row = document.createElement("div");
    row.className = "palette-row";
    const relief = document.createElement("input");
    relief.type = "checkbox";
    relief.className = "relief-toggle source-swatch";
    relief.id = `relief-color-${entry.index}`;
    relief.style.backgroundColor = entry.sourceHex;
    relief.checked = state.recessedClasses.has(entry.index);
    relief.title = `初始色 ${entry.sourceHex}${entry.sourceIndex === null ? "" : ` · BMP#${entry.sourceIndex}`} · 点击选择凹陷区域`;
    relief.setAttribute("aria-label", `${entry.index}号色生成凹陷`);
    relief.addEventListener("change", () => {
      if (relief.checked) state.recessedClasses.add(entry.index);
      else state.recessedClasses.delete(entry.index);
      invalidateNormal();
    });
    const id = document.createElement("label");
    id.className = "palette-id";
    id.htmlFor = relief.id;
    id.textContent = `${entry.index}号色`;
    const input = document.createElement("button");
    input.type = "button";
    input.className = "compact-procedural-swatch";
    input.style.backgroundColor = entry.loopHex;
    input.title = `编辑色号 ${entry.index} 的线圈颜色`;
    input.setAttribute("aria-label", `编辑色号 ${entry.index} 的线圈颜色`);
    input.dataset.colorIndex = String(entry.index);
    input.setAttribute("aria-controls", "paletteColorEditor");
    input.setAttribute("aria-expanded", String(paletteColorIndex === entry.index));
    input.onclick = () => openPaletteColorEditor(entry.index, entry.loopHex);
    const hex = document.createElement("output");
    hex.className = "palette-hex";
    hex.setAttribute('aria-label', `${entry.index}号色的线圈颜色`);
    hex.value = entry.loopHex.toUpperCase();
    row.append(relief, id, input, hex);
    container.append(row);
  }
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
  // the source swatches let the user refine the set per color number.
  state.recessedClasses = new Set(state.palette.map((entry) => entry.index).filter((index) => index > 0));
  const lookup = new Map(state.palette.map((entry) => [entry.key, entry.index]));
  state.classMap = new Uint32Array(state.pixels);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const paletteIndex = indexedBmp?.indices[p];
    const indexedColor = indexedBmp && indexedBmp.palette[paletteIndex];
    const key = colorKey(indexedColor?.r ?? data[i], indexedColor?.g ?? data[i + 1], indexedColor?.b ?? data[i + 2]);
    state.classMap[p] = lookup.get(key) ?? 0;
  }
  renderPaletteControls();
}

function postPreviewStatus(kind, busy, error = '', extra = {}) {
  if (!embeddedInMaterialEditor) return;
  window.parent.postMessage({ type: 'procedural-preview-status', kind, busy, error,
    sourceRevision: state.sourceLoadId, baseRevision: state.renderId, reliefRevision: state.normalRenderId, ...extra }, '*');
}

async function loadFile(file, resetGeneratedMaps = true) {
  if (!file) return;
  const loadId = ++state.sourceLoadId;
  state.sourceLoading = true;
  state.renderJob?.cancel(); state.renderJob = null; state.renderId++; state.jpegEncodeId++;
  invalidateNormal(false);
  setRenderButtonState('renderButton', 'loading');
  setRenderButtonState('normalButton', 'loading');
  postPreviewStatus('source', true, '', { resetGeneratedMaps });
  state.renderedId = 0; $('downloadButton').disabled = true;
  if (state.jpegUrl) URL.revokeObjectURL(state.jpegUrl);
  state.jpegUrl = null;
  $('cropButton').disabled = true;
  setStatus("读取 BMP…", false);
  try {
    const buffer = await file.arrayBuffer();
    const indexedBmp = parseIndexedBmp(buffer);
    const bitmap = await createImageBitmap(new Blob([buffer], { type: file.type || "image/bmp" }));
    if (loadId !== state.sourceLoadId) { bitmap.close(); return; }
    state.sourceFile = file;
    state.sourceName = file.name || "source.bmp";
    state.bitmap?.close();
    state.bitmap = bitmap;
    $("sourceFileName").textContent = state.sourceName;
    $("sourceFileName").title = state.sourceName;
    state.width = bitmap.width;
    state.height = bitmap.height;
    inputCanvas.width = state.width;
    inputCanvas.height = state.height;
    inputCtx.clearRect(0, 0, state.width, state.height);
    inputCtx.drawImage(bitmap, 0, 0);
    $("inputEmptyState").hidden = true;
    state.imageData = inputCtx.getImageData(0, 0, state.width, state.height);
    state.sourceLoading = false;
    state.pixels = state.width * state.height;
    const usableIndexedBmp = indexedBmp && indexedBmp.width === state.width && indexedBmp.height === state.height ? indexedBmp : null;
    state.indexedBmp = usableIndexedBmp;
    analyzePalette(state.imageData.data, usableIndexedBmp);
    $('cropButton').disabled = false;
    updatePhysicalSizeInfo();
    invalidateNormal(false);
    setStatus(`已载入 ${file.name}`, true);
    postProceduralState(true, resetGeneratedMaps);
    render();
  } catch (error) {
    if (loadId !== state.sourceLoadId) return;
    console.error(error);
    state.bitmap?.close(); state.bitmap = null; state.imageData = null;
    state.sourceLoading = false;
    state.sourceFile = null; state.classMap = null; state.indexedBmp = null;
    state.width = state.height = state.pixels = 0; state.palette = [];
    inputCanvas.width = inputCanvas.height = outputCanvas.width = outputCanvas.height = 0;
    setRenderButtonState('renderButton', 'empty');
    invalidateNormal(false);
    renderPaletteControls(); updatePhysicalSizeInfo();
    setStatus("读取失败，请选择标准 BMP", false);
    postPreviewStatus('source', false, '读取失败，请选择标准 BMP');
  } finally {
    if (loadId === state.sourceLoadId) $('cropButton').disabled = !embeddedInMaterialEditor || !state.imageData;
  }
}

function applyBmpCrop(rect) {
  const image = BmpCrop.cropPixels(state.imageData, rect);
  state.sourceLoadId++;
  const indexedBmp = BmpCrop.cropIndexed(state.indexedBmp, rect);
  const bytes = BmpCrop.encodeBmp(image, indexedBmp);
  const sourceName = (state.sourceName || 'source.bmp').replace(/(?:-crop)?\.bmp$/i, '') + '-crop.bmp';
  const file = new File([bytes], sourceName, { type: 'image/bmp' });
  const paletteByColor = new Map(state.palette.map(entry => [entry.sourceHex, { ...entry, recessed: state.recessedClasses.has(entry.index) }]));
  state.renderJob?.cancel(); state.renderJob = null; state.renderId++; state.jpegEncodeId++; state.renderedId = 0;
  if (state.jpegUrl) URL.revokeObjectURL(state.jpegUrl);
  state.jpegUrl = null; $('downloadButton').disabled = true;
  state.bitmap?.close(); state.bitmap = null;
  state.width = image.width; state.height = image.height; state.pixels = image.width * image.height;
  state.imageData = new ImageData(image.data, image.width, image.height);
  state.indexedBmp = indexedBmp;
  state.sourceFile = file; state.sourceName = sourceName;
  inputCanvas.width = image.width; inputCanvas.height = image.height; inputCtx.putImageData(state.imageData, 0, 0);
  analyzePalette(image.data, indexedBmp);
  state.recessedClasses.clear();
  for (const entry of state.palette) {
    const previous = paletteByColor.get(entry.sourceHex);
    if (!previous) continue;
    entry.loopHex = previous.loopHex; entry.loopRgb = { ...previous.loopRgb };
    if (previous.recessed) state.recessedClasses.add(entry.index);
  }
  renderPaletteControls(); invalidateNormal(false);
  outputCanvas.width = outputCanvas.height = 0;
  $('emptyState').textContent = ''; $('renderInfo').textContent = '';
  $('sourceFileName').textContent = sourceName; $('sourceFileName').title = sourceName;
  updatePhysicalSizeInfo(); setStatus('', true);
  postProceduralState(true, true); render();
}

function setStatus(text, ready) {
  $("statusPill").textContent = ready ? "" : text;
  $("statusPill").classList.toggle("ready", ready);
}

function applyProceduralMapping(mapping = {}) {
  const options = mapping.options || {};
  const setValue = (id, value) => {
    const input = $(id);
    if (input && value !== undefined && value !== null && Number.isFinite(Number(value))) input.value = String(value);
  };
  setValue("contrast", Number(options.contrast || 0) * 100);
  setValue("angle", options.angle);
  setValue("dpi", options.dpi);
  setValue("bmpPixelsPerCmY", options.pixelsPerCmY);
  setValue("reliefRadius", options.reliefRadius);
  if (options.reliefDepth !== undefined && options.reliefDepth !== null) {
    setValue("reliefDepth", Number(options.reliefDepth) * 100);
  }
  setValue("gaussianBlur", options.gaussianBlur);
  setValue("aoRadius", options.aoRadius ?? 5);
  setValue("aoStrength", options.aoStrength ?? 1);
  if (typeof options.quality === "number") setValue("quality", options.quality * 100);
  if (options.background) {
    const background = rgbToHex(options.background.r, options.background.g, options.background.b);
    $("backgroundColor").value = background;
    $("backgroundColorValue").value = background;
    syncPaletteColorSelection();
  }
  if (Array.isArray(mapping.palette)) {
    const byIndex = new Map(mapping.palette.map(entry => [Number(entry.index), entry]));
    for (const entry of state.palette) {
      const saved = byIndex.get(entry.index);
      if (!saved || !/^#[\da-f]{6}$/i.test(saved.loopHex || "")) continue;
      entry.loopHex = saved.loopHex.toUpperCase();
      entry.loopRgb = hexToRgb(entry.loopHex);
    }
  }
  if (Array.isArray(mapping.recessedClasses)) state.recessedClasses = new Set(mapping.recessedClasses.map(Number).filter(Number.isInteger));
  renderPaletteControls();
  updateRangeOutput("contrast"); updateRangeOutput("angle", v => `${v}°`); updateRangeOutput("quality"); updateRangeOutput("reliefDepth"); updateRangeOutput("gaussianBlur"); updateRangeOutput("aoStrength"); updatePhysicalSizeInfo();
  invalidateNormal(false);
  requestRender();
  postProceduralState();
}

window.addEventListener("message", async event => {
  const data = event.data;
  if (event.source !== window.parent || (event.origin !== location.origin && event.origin !== 'null')) return;
  if (data?.type === 'procedural-dismiss-picker') { closePaletteColorEditor(); return; }
  if (data?.type === 'procedural-upload') {
    state.requestId = null;
    if (data.sourceFile) await loadFile(data.sourceFile);
    return;
  }
  if (data?.type === 'procedural-crop') {
    try {
      if (data.sourceRevision !== state.sourceLoadId) throw new Error('BMP 已更新，请重新裁剪');
      applyBmpCrop(data.rect);
    } catch (error) { window.parent.postMessage({ type: 'procedural-error', message: error.message }, '*'); }
    return;
  }
  if (!data || !["procedural-load", "procedural-update"].includes(data.type)) return;
  try {
    state.requestId = data.requestId ?? null;
    const source = data.sourceFile;
    if (source && (!state.sourceFile || state.sourceFile.size !== source.size || state.sourceFile.name !== (source.name || state.sourceName))) {
      const file = source instanceof File ? source : new File([source], source.name || "source.bmp", { type: source.type || "image/bmp" });
      await loadFile(file, false);
    }
    if (!state.imageData) throw new Error("尚未载入 BMP 源图");
    applyProceduralMapping(data.mapping || {});
  } catch (error) {
    console.error(error);
    window.parent.postMessage({ type: "procedural-error", requestId: state.requestId, message: error.message }, "*");
  }
});

function invalidateNormal(resetMaterial = true) {
  state.normalJob?.cancel();
  state.normalJob = null;
  state.reliefOptions = null;
  state.normalRenderId++;
  clearMapResults();
  const download = $("normalDownloadButton");
  if (download) download.disabled = true;
  setRenderButtonState('normalButton', state.sourceLoading ? 'loading' : state.imageData ? 'pending' : 'empty');
  const info = $("normalInfo");
  if (info) info.textContent = "";
  if (resetMaterial) postProceduralState(false, false, true);
}

function currentRenderOptions() {
  const metrics = physicalMetrics(outputDpi());
  const { outW, outH } = metrics;
  const reliefRadius = Number($("reliefRadius")?.value || 5);
  return {
    width: state.width, height: state.height, classMap: state.classMap,
    palette: state.palette.map((entry) => entry.loopRgb),
    background: hexToRgb($("backgroundColor").value),
    cellW: outW / state.width, cellH: outH / state.height, outW, outH,
    loopsY: LOOPS_Y_PER_PIXEL,
    dpi: metrics.dpi, physicalWidthCm: metrics.widthCm, physicalHeightCm: metrics.heightCm,
    pixelsPerCmY: metrics.pixelsPerCmY,
    contrast: Number($("contrast").value) / 100,
    angle: Number($("angle").value),
    // The relief map is intentionally independent from loop shading. Pass a
    // plain array so the same settings survive Worker structured cloning.
    reliefClasses: [...state.recessedClasses],
    // Process this fabric as a repeating tile through height, blur, normal
    // and AO generation. This is shared by Worker and fallback jobs.
    tileable: true,
    reliefRadius: Number.isFinite(reliefRadius) ? Math.max(.05, reliefRadius) : 5,
    reliefDepth: Math.max(0, Math.min(1, Number($("reliefDepth")?.value || 0) / 100)),
    gaussianBlur: Math.max(0, Math.min(20, Number($("gaussianBlur")?.value || 0))),
    aoRadius: Math.max(.05, Number($("aoRadius")?.value || 5)),
    aoStrength: Math.max(0, Math.min(3, Number($("aoStrength")?.value ?? 1)))
  };
}

// Base color and all three derived maps share the JPEG encoder and DPI writer.
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
  // Keep the export canvas separate from the preview so encoding always uses
  // the exact pixel dimensions produced by physicalMetrics().
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
  // Keep the preview canvas pixel-identical to the generated map. The shared
  // viewport handles fit-to-window scaling through CSS, just like the fabric
  // preview, while pan and zoom still operate on the original pixels.
  canvas.width = image.width; canvas.height = image.height;
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
}

async function replaceMapUrl(kind, image, settings, id) {
  const jpeg = await encodeImageJpeg(image, settings);
  if (id !== state.normalRenderId) return;
  const key = `${kind}Url`;
  if (state[key]) URL.revokeObjectURL(state[key]);
  state[key] = URL.createObjectURL(jpeg);
  const button = $(`${kind}DownloadButton`);
  if (button) button.disabled = false;
}

function clearMapResults() {
  for (const key of ["heightUrl", "normalUrl", "aoUrl"]) {
    if (state[key]) URL.revokeObjectURL(state[key]);
    state[key] = null;
  }
  $("heightDownloadButton").disabled = true;
  $("normalDownloadButton").disabled = true;
  $("aoDownloadButton").disabled = true;
  for (const canvas of [heightPreviewCanvas, normalPreviewCanvas, aoPreviewCanvas]) {
    if (canvas) canvas.width = canvas.height = 0;
  }
  if ($("heightEmptyState")) $("heightEmptyState").hidden = false;
  if ($("normalEmptyState")) $("normalEmptyState").hidden = false;
  if ($("aoEmptyState")) $("aoEmptyState").hidden = false;
}

async function renderNormal() {
  if (!state.imageData || state.sourceLoading || !state.classMap?.length) return;
  const id = ++state.normalRenderId;
  postPreviewStatus("relief", true);
  state.normalJob?.cancel();
  clearMapResults();
  setRenderButtonState('normalButton', 'rendering');
  const base = state.reliefOptions = currentRenderOptions();
  const jpegSettings = { dpi: base.dpi, quality: Number($("quality").value) / 100 };
  const names = { "height-field": "计算高度场", "blur-x": "高斯模糊", "blur-y": "高斯模糊", height: "生成高度图", normal: "生成法线图", ao: "生成 AO 图" };
  const previews = { height: [heightPreviewCanvas, heightPreviewCtx], normal: [normalPreviewCanvas, normalPreviewCtx], ao: [aoPreviewCanvas, aoPreviewCtx] };
  try {
    const job = state.normalJob = KnitRenderJob.start({ ...base, output: "relief" }, {
      onProgress(progress, stage) {
        if (id === state.normalRenderId) $("normalInfo").textContent = `${names[stage] || "生成贴图"} ${Math.floor(progress * 100)}%`;
      },
      async onMap(kind, image) {
        if (id !== state.normalRenderId) return;
        showMapPreview(...previews[kind], image);
        $(`${kind}EmptyState`).hidden = true;
        $("normalInfo").textContent = `正在导出${kind === "height" ? "高度" : kind === "normal" ? "法线" : " AO "}图…`;
        await replaceMapUrl(kind, image, jpegSettings, id);
      }
    });
    await job.promise;
    if (id !== state.normalRenderId) return;
    // Apply the material channels together only after all outputs succeeded.
    await applyRenderedRelief();
    if (id !== state.normalRenderId) return;
    $("normalInfo").textContent = "";
    setRenderButtonState('normalButton', 'ready');
  } catch (error) {
    if (id !== state.normalRenderId || error.name === "AbortError") return;
    console.error(error);
    clearMapResults();
    postPreviewStatus("relief", false, error.message);
    $("normalInfo").textContent = "高度图 / 法线图 / AO 图生成失败：" + error.message;
    setRenderButtonState('normalButton', 'error');
  } finally {
    if (id === state.normalRenderId) { state.normalJob = null; $("normalButton").disabled = false; }
  }
}

function render() {
  if (!state.imageData || state.sourceLoading || state.renderQueued) return;
  state.renderQueued = true;
  setRenderButtonState('renderButton', 'rendering');
  $("downloadButton").disabled = true;
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
  setRenderButtonState('renderButton', 'rendering');
  $("downloadButton").disabled = true;
  const fail = (error) => {
    if (id !== state.renderId || encodeId !== state.jpegEncodeId || state.renderQueued) return;
    console.error(error);
    $("renderInfo").textContent = "JPG 导出失败：" + error.message;
    postPreviewStatus("base", false, error.message);
    setRenderButtonState('renderButton', 'error');
  };
  try {
    const jpeg = await encodeCanvasJpeg(outputCanvas, settings);
    if (id !== state.renderId || encodeId !== state.jpegEncodeId || state.renderQueued) return;
    if (state.jpegUrl) URL.revokeObjectURL(state.jpegUrl);
    state.jpegUrl = URL.createObjectURL(jpeg);
    $("downloadButton").disabled = false;
    setRenderButtonState('renderButton', 'ready');
    if (embeddedInMaterialEditor) void applyRenderedMaterial();
  } catch (error) { fail(error); }
}

async function applyRenderedMaterial() {
  if (!embeddedInMaterialEditor || !state.jpegUrl) return;
  const renderId = state.renderId, jpegUrl = state.jpegUrl;
  const metrics = state.renderOptions && physicalMetrics(state.renderOptions.dpi);
  try {
    const response = await fetch(jpegUrl);
    if (!response.ok) throw new Error("无法读取生成的 JPG");
    const file = await response.blob();
    if (renderId !== state.renderId || jpegUrl !== state.jpegUrl) return;
    window.parent.postMessage({
      type: "procedural-material",
      name: "procedural-material.jpg",
      file,
      requestId: state.requestId,
      sourceRevision: state.sourceLoadId, baseRevision: renderId,
      physical: metrics ? { widthCm: metrics.widthCm, heightCm: metrics.heightCm } : null
    }, "*");
    setStatus("纹理 JPG 已自动应用到材质编辑器", true);
  } catch (error) {
    if (renderId !== state.renderId || jpegUrl !== state.jpegUrl) return;
    console.error(error);
    setStatus("应用 JPG 失败：" + error.message, false);
    postPreviewStatus("base", false, error.message);
  }
}

async function applyRenderedRelief() {
  if (!embeddedInMaterialEditor || !state.heightUrl || !state.normalUrl || !state.aoUrl) return;
  const renderId = state.normalRenderId, urls = [state.heightUrl, state.normalUrl, state.aoUrl];
  const options = state.reliefOptions, sourceRevision = state.sourceLoadId;
  const responses = await Promise.all(urls.map(url => fetch(url)));
  if (responses.some(response => !response.ok)) throw new Error('无法读取生成的高度 / 法线 / AO JPG');
  const [height, normalMap, aoMap] = await Promise.all(responses.map(response => response.blob()));
  if (renderId !== state.normalRenderId || sourceRevision !== state.sourceLoadId) return;
  window.parent.postMessage({ type: 'procedural-relief-material', maps: { height, normalMap, aoMap },
    requestId: state.requestId, sourceRevision, reliefRevision: renderId,
    physical: options ? { widthCm: options.physicalWidthCm, heightCm: options.physicalHeightCm } : null
  }, '*');
}

async function renderNow() {
  if (!state.imageData || state.sourceLoading) return;
  const id = ++state.renderId;
  postPreviewStatus("base", true);
  state.renderJob?.cancel();
  setRenderButtonState('renderButton', 'rendering');
  $("downloadButton").disabled = true;
  try {
    const metrics = physicalMetrics(outputDpi());
    const { outW, outH } = metrics;
    $("renderInfo").textContent = "正在渲染…";
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
    const { image } = await job.promise;
    if (id !== state.renderId) return;
    outputCanvas.width = image.width; outputCanvas.height = image.height;
    outputCtx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    state.renderedId = id;
    $("emptyState").hidden = true;
    $("renderInfo").textContent = "";
    await exportJpeg(id);
  } catch (error) {
    if (id !== state.renderId || error.name === "AbortError") return;
    console.error(error);
    $("renderInfo").textContent = "渲染失败：" + error.message;
    postPreviewStatus("base", false, error.message);
    $("emptyState").textContent = "渲染失败，请点击“渲染纹理”重试。";
    if (!state.renderQueued) setRenderButtonState('renderButton', 'error');
  } finally {
    if (id === state.renderId) state.renderJob = null;
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
$("aoDownloadButton").addEventListener("click", () => {
  if (!state.aoUrl) return;
  const a = document.createElement("a");
  a.href = state.aoUrl; a.download = "fabric-ao.jpg"; a.click();
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
$("renderButton").addEventListener("click", render);
$("backgroundColor").addEventListener("input", () => {
  $("backgroundColorValue").value = $("backgroundColor").value.toUpperCase();
  syncPaletteColorSelection(); postProceduralState();
  requestRender();
});
$("backgroundColorSwatch").addEventListener("click", () => openPaletteColorEditor("background", $("backgroundColor").value.toUpperCase()));
for (const id of ["contrast", "angle", "quality"]) {
  $(id).addEventListener("input", () => {
    if (id === "angle") updateRangeOutput(id, (v) => `${v}°`);
    else updateRangeOutput(id);
    if (id === "quality") {
      if (state.renderedId === state.renderId && state.renderedId) exportJpeg(state.renderId);
      if (state.normalJob || state.heightUrl || state.normalUrl || state.aoUrl) {
        invalidateNormal();
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
  invalidateNormal();
  postProceduralState();
});
$("reliefRadius").addEventListener("input", () => {
  invalidateNormal();
  postProceduralState();
});
$("gaussianBlur").addEventListener("input", () => {
  updateRangeOutput("gaussianBlur");
  invalidateNormal();
  postProceduralState();
});
for (const id of ["aoRadius", "aoStrength"]) {
  $(id).addEventListener("input", () => {
    if (id === "aoStrength") updateRangeOutput(id);
    invalidateNormal(); postProceduralState();
  });
}
$("dpi").addEventListener("input", () => {
  updatePhysicalSizeInfo();
  if (state.normalJob || state.heightUrl || state.normalUrl || state.aoUrl) invalidateNormal();
  requestRender();
  postProceduralState();
});
$("bmpPixelsPerCmY").addEventListener("input", () => {
  updatePhysicalSizeInfo();
  if (state.normalJob || state.heightUrl || state.normalUrl || state.aoUrl) {
    invalidateNormal();
  }
  requestRender();
  postProceduralState();
});
updateRangeOutput("contrast");
updateRangeOutput("angle", (v) => `${v}°`);
updateRangeOutput("quality");
updateRangeOutput("reliefDepth");
updateRangeOutput("gaussianBlur");
updateRangeOutput("aoStrength");
updatePhysicalSizeInfo();
