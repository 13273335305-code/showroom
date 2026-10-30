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
  sourceName: "",
  requestId: null
};
let paletteColorPicker = null, paletteColorIndex = null;
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
  let top = buttonRect.bottom + gap, above = false;
  if (top + editorRect.height > window.innerHeight - margin) {
    top = buttonRect.top - editorRect.height - gap;
    above = true;
  }
  top = Math.max(margin, Math.min(window.innerHeight - editorRect.height - margin, top));
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
      $("paletteControls").querySelector(`[data-color-index="${entry.index}"]`).style.backgroundColor = color;
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
    resetGeneratedMaps,
    resetReliefMaps,
    sourceFile: includeSource ? state.sourceFile : undefined,
    mapping: proceduralMappingSnapshot()
  }, "*");
}

const previewViewports = [];
function mountPreviewViewport(viewport, canvas, label) {
  if (!viewport || !canvas) return null;
  const view = { viewport, canvas, scale: 1, fitScale: 1, offsetX: 0, offsetY: 0, initialized: false, dragging: null };
  let filteredPreview = null, previewKey = '';
  const renderFilteredPreview = () => {
    if (canvas === inputCanvas) return;
    const pixelScale = view.scale * (window.devicePixelRatio || 1);
    const minified = pixelScale < 1;
    canvas.style.visibility = minified ? 'hidden' : '';
    if (!minified) {
      if (filteredPreview) filteredPreview.style.display = 'none';
      return;
    }
    if (!filteredPreview) {
      filteredPreview = document.createElement('canvas');
      filteredPreview.className = 'filtered-texture-preview';
      filteredPreview.setAttribute?.('aria-hidden', 'true');
      filteredPreview.style.pointerEvents = 'none';
      viewport.appendChild?.(filteredPreview);
    }
    const width = Math.max(1, Math.round(canvas.width * pixelScale));
    const height = Math.max(1, Math.round(canvas.height * pixelScale));
    const key = `${width}x${height}`;
    if (previewKey !== key) {
      // CSS transforms alone use too small a sampling footprint for dense
      // knit rasters. Reduce in stages, then filter to device-pixel size.
      // The original canvas remains intact for JPG export and 1:1 inspection.
      let source = canvas;
      while (source.width > width * 2 || source.height > height * 2) {
        const next = document.createElement('canvas');
        next.width = Math.max(width, Math.ceil(source.width / 2));
        next.height = Math.max(height, Math.ceil(source.height / 2));
        const ctx = next.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, next.width, next.height);
        if (source !== canvas) source.width = source.height = 1;
        source = next;
      }
      filteredPreview.width = width; filteredPreview.height = height;
      const ctx = filteredPreview.getContext('2d');
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, width, height);
      if (source !== canvas) source.width = source.height = 1;
      previewKey = key;
    }
    filteredPreview.style.display = 'block';
    filteredPreview.style.width = canvas.style.width;
    filteredPreview.style.height = canvas.style.height;
    filteredPreview.style.transform = canvas.style.transform;
  };
  const renderView = () => {
    if (!canvas.width || !canvas.height) return;
    const bounds = viewport.getBoundingClientRect();
    const fitScale = Math.min((bounds.width - 24) / canvas.width, (bounds.height - 24) / canvas.height);
    if (!(fitScale > 0)) return;
    view.fitScale = Math.max(.02, Math.min(8, fitScale));
    if (!view.initialized) { view.scale = view.fitScale; view.initialized = true; }
    // Size BMP pixels before translating: scaling a rasterized transform can
    // shift texel edges at fractional display/page zoom away from crop lines.
    const pixelated = canvas === inputCanvas;
    canvas.style.width = `${canvas.width * (pixelated ? view.scale : 1)}px`;
    canvas.style.height = `${canvas.height * (pixelated ? view.scale : 1)}px`;
    canvas.style.transform = `translate(calc(-50% + ${view.offsetX}px),calc(-50% + ${view.offsetY}px))${pixelated ? '' : ` scale(${view.scale})`}`;
    renderFilteredPreview();
    if (label) label.textContent = `${Math.round(view.scale / view.fitScale * 100)}%`;
    view.onTransform?.();
  };
  const reset = () => { previewKey = ''; view.initialized = false; view.offsetX = view.offsetY = 0; renderView(); };
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
    if (!canvas.width || !(view.canPan ? view.canPan(event) : event.button === 0)) return;
    view.dragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.preventDefault();
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

const inputViewport = mountPreviewViewport($('inputPreviewWrap'), inputCanvas, $('inputZoomLabel'));
const outputViewport = mountPreviewViewport($('outputWrap'), outputCanvas, $('textureZoomLabel'));
const heightViewport = mountPreviewViewport($('heightPreviewWrap'), heightPreviewCanvas, $('heightZoomLabel'));
const normalViewport = mountPreviewViewport($('normalPreviewWrap'), normalPreviewCanvas, $('normalZoomLabel'));
const aoViewport = mountPreviewViewport($('aoPreviewWrap'), aoPreviewCanvas, $('aoZoomLabel'));
const previewPanels = { input: $('inputPreviewPanel'), fabric: $('fabricPreviewPanel'), height: $('heightPreviewPanel'), normal: $('normalPreviewPanel'), ao: $('aoPreviewPanel') };
const previewViewByMode = { input: inputViewport, fabric: outputViewport, height: heightViewport, normal: normalViewport, ao: aoViewport };
function setPreviewMap(mode) {
  if (mode !== 'input') cropTool?.cancel();
  for (const [key, panel] of Object.entries(previewPanels)) if (panel) panel.hidden = key !== mode;
  document.querySelectorAll('[data-preview-map]').forEach(button => {
    const active = button.dataset.previewMap === mode;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  requestAnimationFrame(() => {
    // Each map has its own pan/zoom state. Returning to a map should start at
    // the complete image so its preview can be compared directly with the
    // downloaded file.
    previewViewByMode[mode]?.reset?.();
    previewViewports.forEach(view => view.render?.());
  });
}
document.querySelectorAll('[data-preview-map]').forEach(button => { button.addEventListener('click', () => setPreviewMap(button.dataset.previewMap)); });
const cropTool = mountBmpCropTool({
  viewport: $('inputPreviewWrap'), canvas: inputCanvas, view: inputViewport,
  button: $('cropButton'), toolbar: $('cropToolbar'), progress: $('cropProgress'),
  reset: $('cropReset'), cancel: $('cropCancel'), apply: $('cropApply'),
  showInput: () => setPreviewMap('input'), onApply: applyBmpCrop,
  onError: error => setStatus(error.message, false)
});
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
  if (!state.palette.length) {
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
      invalidateNormal();
    });
    const id = document.createElement("span");
    id.className = "palette-id";
    id.textContent = `色号 ${entry.index}`;
    const source = document.createElement("span");
    source.className = "source-swatch";
    source.title = `BMP 原色 ${entry.sourceHex}${entry.sourceIndex === null ? "" : ` · BMP#${entry.sourceIndex}`}`;
    source.style.backgroundColor = entry.sourceHex;
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
    const count = document.createElement("output");
    count.className = "palette-count";
    count.value = `${entry.count.toLocaleString()} px`;
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
  renderPaletteControls();
}

async function loadFile(file, resetGeneratedMaps = true) {
  if (!file) return;
  const loadId = ++state.sourceLoadId;
  cropTool.cancel();
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
    inputViewport?.reset();
    state.imageData = inputCtx.getImageData(0, 0, state.width, state.height);
    state.pixels = state.width * state.height;
    const usableIndexedBmp = indexedBmp && indexedBmp.width === state.width && indexedBmp.height === state.height ? indexedBmp : null;
    state.indexedBmp = usableIndexedBmp;
    analyzePalette(state.imageData.data, usableIndexedBmp);
    $('cropButton').disabled = false;
    updatePhysicalSizeInfo();
    $("renderButton").disabled = false;
    $("normalButton").disabled = false;
    invalidateNormal(false);
    setStatus(`已载入 ${file.name}`, true);
    postProceduralState(true, resetGeneratedMaps);
    render();
  } catch (error) {
    if (loadId !== state.sourceLoadId) return;
    console.error(error);
    setStatus("读取失败，请选择标准 BMP", false);
  } finally {
    if (loadId === state.sourceLoadId) $('cropButton').disabled = !state.imageData;
  }
}

function applyBmpCrop(rect) {
  const image = BmpCrop.cropPixels(state.imageData, rect);
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
  outputCanvas.width = outputCanvas.height = 0; $('textureZoomLabel').textContent = '';
  $('emptyState').textContent = ''; $('renderInfo').textContent = '';
  $('sourceFileName').textContent = sourceName; $('sourceFileName').title = sourceName;
  inputViewport.reset(); updatePhysicalSizeInfo(); setStatus('', true);
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
  const button = $("normalButton");
  if (button) button.disabled = !state.imageData;
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
  for (const id of ["heightZoomLabel", "normalZoomLabel", "aoZoomLabel"]) {
    if ($(id)) $(id).textContent = "";
  }
  if ($("heightEmptyState")) $("heightEmptyState").hidden = false;
  if ($("normalEmptyState")) $("normalEmptyState").hidden = false;
  if ($("aoEmptyState")) $("aoEmptyState").hidden = false;
}

async function renderNormal() {
  if (!state.imageData || !state.classMap?.length) return;
  const id = ++state.normalRenderId;
  state.normalJob?.cancel();
  clearMapResults();
  $("normalButton").disabled = true;
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
        previewViewByMode[kind]?.reset();
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
  } catch (error) {
    if (id !== state.normalRenderId || error.name === "AbortError") return;
    console.error(error);
    clearMapResults();
    $("normalInfo").textContent = "高度图 / 法线图 / AO 图生成失败：" + error.message;
  } finally {
    if (id === state.normalRenderId) { state.normalJob = null; $("normalButton").disabled = false; }
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
      physical: metrics ? { widthCm: metrics.widthCm, heightCm: metrics.heightCm } : null
    }, "*");
    setStatus("纹理 JPG 已自动应用到材质编辑器", true);
  } catch (error) {
    console.error(error);
    setStatus("应用 JPG 失败：" + error.message, false);
  }
}

async function applyRenderedRelief() {
  if (!embeddedInMaterialEditor || !state.normalUrl || !state.aoUrl) return;
  const renderId = state.normalRenderId, normalUrl = state.normalUrl, aoUrl = state.aoUrl;
  const options = state.reliefOptions;
  const [normalResponse, aoResponse] = await Promise.all([fetch(normalUrl), fetch(aoUrl)]);
  if (!normalResponse.ok || !aoResponse.ok) throw new Error("无法读取生成的法线 / AO JPG");
  const [normalFile, aoFile] = await Promise.all([normalResponse.blob(), aoResponse.blob()]);
  if (renderId !== state.normalRenderId || normalUrl !== state.normalUrl || aoUrl !== state.aoUrl) return;
  window.parent.postMessage({
    type: "procedural-relief-material",
    maps: { normalMap: normalFile, aoMap: aoFile },
    requestId: state.requestId,
    physical: options ? { widthCm: options.physicalWidthCm, heightCm: options.physicalHeightCm } : null
  }, "*");
}

async function renderNow() {
  const id = ++state.renderId;
  state.renderJob?.cancel();
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
    outputViewport?.reset();
    state.renderedId = id;
    $("emptyState").hidden = true;
    $("renderInfo").textContent = "";
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
