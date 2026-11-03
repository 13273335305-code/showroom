import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { defaultPhysical, readPhysical, preparePhysicalUV, setPhysicalTransform } from '../physical-textures.js';
import { readImageDensity, physicalSizeFromDensity } from '../image-density.js';
import { mountNavigation } from '../shared/navigation.js';
import { getAsset } from '../shared/asset-store.js';
import { MATERIAL_MAPS, readSurface, applySurface, applyLegacyUV } from '../shared/material-data.js';
import { materialType } from '../shared/material-placement.js';
import { createPatternPreview } from '../shared/pattern-preview.js';
import { grayscalePixels } from '../shared/image-pixels.js';
import { configureTextureSampling } from '../shared/texture-sampling.js';
import { installRoughnessShader } from '../shared/roughness-map.js';
import { compressImageFile } from '../shared/asset-thumbnail.js';
import { requireAuth } from '../shared/auth.js';
import { fitMaterialPreview } from '../shared/material-preview.js';
import { renderConvexPreview } from '../shared/convex-preview.js';
import { fabricInfoFromFilename } from '../shared/fabric-info.js';
import { updateFabricColorSwatch, renderBatchFabricSwatches } from '../shared/fabric-color-swatch.js?v=fabric-default-color-20261015';
import { planFabricBatch, enqueueFabricBatch } from '../shared/fabric-batch.js';
import { enqueueMaterialUpload, getUpload, startUploadQueue, subscribeUploads } from '../shared/upload-queue.js';
import { normalizeFabricCategory, normalizeAssetCategories } from '../shared/fabric-category.js';
import { mountProceduralPreview } from '../shared/procedural-preview.js';
import { bindColorInput } from '../shared/color-picker-controls.js';

const $ = id => document.getElementById(id);
await requireAuth({ feature: 'material' });
mountNavigation('material');
let renderer, scene, camera, controls, plane, sheenBall, assetId, dirty = false, pending = 0, pageLeaving = false;
let sheenPreview = false, flatPreviewView = null;
let previewUv, previewPhysicalUv, previewPositions;
let physical = { ...defaultPhysical(), sizeSource: 'manual', initialized: true }, repeat = [1, 1];
let legacyMaps = {}, savedPlacement, libraryMetadata = {};
let proceduralMapping = null, proceduralSource = null;
let proceduralPreview = null;
const proceduralJobs = new Set();
const proceduralRevisions = { source: 0, base: 0, relief: 0 };
function syncPendingControls() {
  $('saveMaterial').disabled = pending > 0 || proceduralJobs.size > 0;
  const sourceName = proceduralSource?.name || '';
  $('proceduralBmpName').textContent = sourceName || '上传 BMP';
  $('uploadProceduralBmp').title = sourceName ? `${sourceName} · 点击更换 BMP` : '上传 BMP';
  $('uploadProceduralBmp').setAttribute('aria-label', sourceName ? `更换 BMP：${sourceName}` : '上传 BMP');
}
const files = {}, urls = {}, tokens = {}, density = {}, embeddedDensity = {};
const patternPreview = createPatternPreview($('patternPreview'));
let roughnessPreviewCache = null, savedPreview = null, savedPreviewInfo = null, previewGenerationCanvas = null;
let savedPreviewCategory = null;
let lastUploadTask = null, submittingPreview = false, batchingFabric = false, editGeneration = 0;
const previewCategorySizes = { '面布': [120, 90], '边布': [40, 30], '辅料': [10, 7.5], '其他': [10, 7.5] };
const previewSizePairs = [
  { width: 'previewPhysicalWidth', height: 'previewPhysicalHeight', button: 'previewPhysicalLock', name: '物理尺寸', digits: 2, ratio: 1 },
  { width: 'previewPixelWidth', height: 'previewPixelHeight', button: 'previewPixelLock', name: '输出像素', digits: 0, ratio: 4 / 3 },
];
const material = new THREE.MeshPhysicalMaterial({ color: '#d6dbe0', roughness: .98, metalness: 0, bumpScale: 0, emissiveIntensity: 0, sheen: .1, sheenRoughness: .4, sheenColor: 0xffffff });
installRoughnessShader(material);
const status = message => { $('status').textContent = message; };
const sliders = [['roughness', '粗糙度', 1, .01], ['metalness', '金属度', 1, .01], ['normalStrength', '法线强度', 3, .05], ['aoStrength', 'AO 强度', 3, .05]];
const sheenParameters = [['sheen', '侧面光强度', 2], ['sheenRoughness', '绒毛柔和度', 1]];

function initEditorScrollbar() {
  const panel = document.querySelector('.editor-panel');
  const scrollbar = $('editorScrollbar');
  const thumb = scrollbar?.querySelector('.editor-scrollbar-thumb');
  if (!panel || !scrollbar || !thumb) return;
  let dragging = null, syncFrame = 0;
  const sync = () => {
    syncFrame = 0;
    const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
    if (matchMedia('(max-width:760px)').matches || maxScroll <= 1) { scrollbar.hidden = true; return; }
    scrollbar.hidden = false;
    const trackHeight = scrollbar.clientHeight;
    const thumbHeight = Math.min(trackHeight, Math.max(72, Math.round(trackHeight * panel.clientHeight / panel.scrollHeight)));
    const travel = Math.max(0, trackHeight - thumbHeight);
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${Math.round(travel * panel.scrollTop / maxScroll)}px)`;
  };
  const queueSync = () => {
    if (!syncFrame) syncFrame = requestAnimationFrame(sync);
  };
  const scrollFromTrack = clientY => {
    const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
    const trackRect = scrollbar.getBoundingClientRect();
    const travel = Math.max(1, trackRect.height - thumb.offsetHeight);
    const offset = Math.max(0, Math.min(travel, clientY - trackRect.top - thumb.offsetHeight / 2));
    panel.scrollTop = maxScroll * offset / travel;
  };
  scrollbar.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (event.target === thumb) {
      dragging = { pointerId: event.pointerId, startY: event.clientY, startScroll: panel.scrollTop };
      thumb.setPointerCapture?.(event.pointerId);
    } else scrollFromTrack(event.clientY);
  });
  scrollbar.addEventListener('pointermove', event => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const travel = Math.max(1, scrollbar.clientHeight - thumb.offsetHeight);
    const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
    panel.scrollTop = dragging.startScroll + (event.clientY - dragging.startY) * maxScroll / travel;
  });
  const stopDragging = () => { dragging = null; };
  scrollbar.addEventListener('pointerup', stopDragging);
  scrollbar.addEventListener('pointercancel', stopDragging);
  scrollbar.addEventListener('wheel', event => { event.preventDefault(); panel.scrollTop += event.deltaY; }, { passive: false });
  panel.addEventListener('scroll', queueSync, { passive: true });
  window.addEventListener('resize', queueSync);
  new ResizeObserver(queueSync).observe(panel);
  new MutationObserver(queueSync).observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'src'] });
  queueSync();
}

function updatePatternPreview() {
  patternPreview.update({ url: urls.map, sourceImage: material.map?.image, widthCm: physical.widthCm, heightCm: physical.heightCm, angle: physical.angle, color: '#' + material.color.getHexString() });
}
function refreshRoughnessPreview() {
  const image = material.roughnessMap?.image;
  $('roughnessInvert').disabled = !image;
  if (!image) { roughnessPreviewCache = null; return; }
  if (roughnessPreviewCache?.image !== image) {
    const canvas = document.createElement('canvas'), scale = Math.min(1, 256 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    roughnessPreviewCache = { image, canvas, ctx, original: ctx.getImageData(0, 0, canvas.width, canvas.height), previews: {} };
  }
  const cache = roughnessPreviewCache, invert = !!material.userData.roughnessInvert, grayscale = !!material.userData.roughnessGrayscale, key = `${grayscale}-${invert}`;
  if (!cache.previews[key]) {
    const pixels = grayscale ? grayscalePixels(cache.original.data, invert) : new Uint8ClampedArray(cache.original.data);
    if (!grayscale && invert) for (let i = 0; i < pixels.length; i += 4) pixels[i] = pixels[i + 1] = pixels[i + 2] = 255 - pixels[i + 1];
    cache.ctx.putImageData(new ImageData(pixels, cache.canvas.width, cache.canvas.height), 0, 0);
    cache.previews[key] = cache.canvas.toDataURL();
  }
  $('preview-roughnessMap').src = cache.previews[key];
}
function applyBaseColorDpi() {
  const info = embeddedDensity.map;
  if (info && [info.widthCm, info.heightCm].every(v => v >= .01 && v <= 100000)) {
    physical = { ...physical, widthCm: info.widthCm, heightCm: info.heightCm, mode: 'physical', sizeSource: 'dpi', fallbackDpi: null };
    density.map = info;
  } else physical = { ...physical, mode: $('materialType').value === 'pattern' ? 'physical' : physical.mode, sizeSource: 'manual' };
  syncPhysicalControls();
}

function syncSurfaceControls() {
  const surface = readSurface(material);
  for (const key of ['color', ...sliders.map(item => item[0])]) $(key).value = surface[key];
  for (const [key] of [...sliders, ...sheenParameters]) $(key + 'Value').value = Number(surface[key]).toFixed(2);
  $('colorValue').value = surface.color;
  $('flip').checked = surface.flip;
  $('roughnessInvert').checked = surface.roughnessInvert; refreshRoughnessPreview();
}
function updateSurface() {
  const surface = { color: $('color').value, flip: $('flip').checked, roughnessInvert: $('roughnessInvert').checked };
  for (const [key] of sliders) surface[key] = Number($(key).value);
  for (const [key, , max] of sheenParameters) {
    const value = $(key + 'Value').valueAsNumber;
    if (Number.isFinite(value) && value >= 0 && value <= max) surface[key] = value;
  }
  applySurface(material, surface);
  dirty = true;
  syncSurfaceControls();
  updatePatternPreview();
}
function syncPhysicalControls() {
  $('sizing').value = physical.mode;
  for (const key of ['widthCm', 'heightCm', 'angle']) $(key).value = Number(physical[key].toFixed(4));
  $('lockSizing').checked = physical.locked !== false;
  $('repeatU').value = repeat[0]; $('repeatV').value = repeat[1];
  const pattern = $('materialType').value === 'pattern';
  $('physicalControls').hidden = !pattern && physical.mode !== 'physical';
  $('repeatControls').hidden = pattern || physical.mode !== 'legacy';
  updatePatternPreview();
}
function syncMaterialType() {
  const pattern = $('materialType').value === 'pattern';
  if (!pattern && lastUploadTask) void syncMaterialUpload().catch(() => {});
  document.querySelectorAll('[data-material-type]').forEach(button => { const active = button.dataset.materialType === $('materialType').value; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('fabricCategoryRow').hidden = pattern;
  $('fabricColorCodeRow').hidden = pattern;
  $('proceduralWorkspace').hidden = pattern;
  $('fabricSheenSection').hidden = pattern;
  $('materialPreviewModes').hidden = pattern;
  syncFabricColorSwatch();
  $('batchFabric').hidden = pattern;
  $('sizing').closest('label').hidden = pattern; $('repeatControls').hidden = pattern || physical.mode !== 'legacy';
  $('physicalControls').hidden = !pattern && physical.mode !== 'physical';
  $('materialCanvas').hidden = pattern; $('patternPreview').hidden = !pattern;
  $('materialPreviewZoom').hidden = pattern || sheenPreview;
  $('pbrHeading').hidden = pattern;
  document.body.classList.toggle('pattern-editing', pattern);
  controls.enabled = !pattern;
  proceduralPreview?.enable(!pattern);
  updatePatternPreview();
}
function syncFabricColorSwatch() {
  updateFabricColorSwatch($('fabricColorSwatch'), $('fabricColorCode').value);
}
function setSizingPageOpen(open) {
  $('sizingPage').hidden = !open;
  $('openSizingPage').setAttribute('aria-expanded', String(open));
  if (open) {
    document.querySelector('.editor-panel').scrollTop = 0;
    $('sizingPage').scrollTop = 0;
  }
  (open ? $('closeSizingPage') : $('openSizingPage')).focus({ preventScroll: true });
}
function configureMaps() {
  for (const [key, , , color] of MATERIAL_MAPS) {
    const texture = material[key];
    if (!texture) continue;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if ($('materialType').value === 'pattern') { texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.channel = 0; texture.matrixAutoUpdate = true; texture.center.set(.5,.5); texture.offset.set(0,0); texture.repeat.set(1,1); texture.rotation = physical.angle * Math.PI / 180; texture.updateMatrix(); }
    else if (legacyMaps[key]) applyLegacyUV(texture, legacyMaps[key]);
    else if (physical.mode === 'physical') setPhysicalTransform(texture, physical.sizeSource === 'dpi' && density[key] ? { ...physical, ...density[key] } : physical, 1);
    else { texture.channel = 0; texture.matrixAutoUpdate = true; texture.center.set(0, 0); texture.rotation = 0; texture.repeat.set(...repeat); texture.updateMatrix(); }
    configureTextureSampling(texture, renderer);
  }
  material.needsUpdate = true;
  proceduralPreview?.updatePhysical();
  updatePatternPreview();
}
function fillFabricPreview() {
  if (sheenPreview) { $('materialPreviewZoom').hidden = true; return; }
  const distance = camera.position.distanceTo(controls.target);
  const visibleHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(camera.zoom, .0001);
  const visibleWidth = visibleHeight * camera.aspect;
  const height = visibleHeight * 1.02;
  const width = visibleWidth * 1.02;
  plane.position.set(controls.target.x, controls.target.y, 0);
  plane.scale.set(width / 100, height / 100, 1);
  for (let i = 0; i < previewPositions.count; i++) {
    const x = plane.position.x + previewPositions.getX(i) * plane.scale.x + 50;
    const y = plane.position.y + previewPositions.getY(i) * plane.scale.y + 50;
    previewUv.setXY(i, x / 100, y / 100);
    previewPhysicalUv.setXY(i, x, y);
  }
  previewUv.needsUpdate = true;
  previewPhysicalUv.needsUpdate = true;
  const zoom = $('materialPreviewZoom');
  if (zoom) {
    const format = value => Number.isFinite(value) ? value.toFixed(1) : '';
    const label = `${format(visibleWidth)} × ${format(visibleHeight)} cm`;
    zoom.hidden = $('materialType').value === 'pattern';
    zoom.textContent = label;
    zoom.setAttribute('aria-label', `当前预览尺寸 ${label}`);
  }
}
function removeMap(key) {
  tokens[key] = (tokens[key] || 0) + 1;
  material[key]?.dispose(); material[key] = null;
  if (urls[key]) URL.revokeObjectURL(urls[key]);
  delete files[key]; delete urls[key]; delete density[key]; delete embeddedDensity[key]; delete legacyMaps[key];
  $('preview-' + key).removeAttribute('src'); $('file-' + key).textContent = '拖入或点击上传';
  $('upload-' + key).classList.remove('has-image'); $('remove-' + key).disabled = true;
  material.needsUpdate = true; dirty = true;
  if (key === 'map') proceduralPreview?.clear('base');
  if (key === 'normalMap') proceduralPreview?.clear('normal');
  if (key === 'roughnessMap') proceduralPreview?.clear('roughness');
  if (key === 'metalnessMap') proceduralPreview?.clear('metalness');
  if (key === 'aoMap') proceduralPreview?.clear('ao');
  if (key === 'roughnessMap') { applySurface(material, { roughnessInvert: false }); syncSurfaceControls(); }
  if (key === 'map') { physical.sizeSource = 'manual'; configureMaps(); }
  else updatePatternPreview();
}
function previewNumber(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : '';
}
function previewCrop(source, width, height, physicalWidth, physicalHeight, sourcePhysical = physical) {
  if (!source?.width || !source?.height || !Number.isInteger(width) || !Number.isInteger(height)) return null;
  const canvas = previewGenerationCanvas ||= document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  // Sample a centered physical window. Output pixels only resample that window.
  const sw = source.width * physicalWidth / sourcePhysical.widthCm;
  const sh = source.height * physicalHeight / sourcePhysical.heightCm;
  const sx = (source.width - sw) / 2, sy = (source.height - sh) / 2;
  const pattern = context.createPattern(source, 'repeat');
  if (!pattern) return null;
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.save();
  context.scale(width / sw, height / sh);
  context.translate(-sx, -sy);
  context.fillStyle = pattern;
  context.fillRect(sx, sy, sw, sh);
  context.restore();
  return canvas.toDataURL('image/png');
}
function previewBlobFromDataUrl(dataUrl) {
  if (!dataUrl) return Promise.resolve(null);
  const [header, payload] = dataUrl.split(',');
  const bytes = Uint8Array.from(atob(payload), char => char.charCodeAt(0));
  return Promise.resolve(new Blob([bytes], { type: header.match(/data:([^;]+)/)?.[1] || 'image/png' }));
}
function previewGenerationValues() {
  const values = {
    widthCm: Number($('previewPhysicalWidth').value), heightCm: Number($('previewPhysicalHeight').value),
    widthPx: Number($('previewPixelWidth').value), heightPx: Number($('previewPixelHeight').value),
  };
  if (![values.widthCm, values.heightCm].every(value => Number.isFinite(value) && value >= .01 && value <= 100000)) throw new Error('物理尺寸范围为 0.01–100000 cm');
  if (![values.widthPx, values.heightPx].every(value => Number.isInteger(value) && value >= 64 && value <= 2048)) throw new Error('像素范围为 64–2048 px');
  return values;
}
function syncPreviewGeneration() {
  const cardImage = $('previewCardImage'), ballImage = $('previewBallImage');
  const emptyCard = $('previewCardEmpty'), emptyBall = $('previewBallEmpty');
  $('previewCardName').textContent = $('name').value.trim() || '新材质';
  $('previewBallName').textContent = $('name').value.trim() || '新材质';
  try {
    const values = previewGenerationValues(), dataUrl = previewCrop(material.map?.image, values.widthPx, values.heightPx, values.widthCm, values.heightCm);
    fitMaterialPreview(cardImage, values);
    if (dataUrl) { cardImage.src = dataUrl; renderConvexPreview(ballImage, dataUrl, values, '#' + material.color.getHexString()); cardImage.hidden = ballImage.hidden = false; emptyCard.hidden = emptyBall.hidden = true; $('previewGenerationHint').textContent = `${previewNumber(values.widthCm)} × ${previewNumber(values.heightCm)} cm · ${values.widthPx} × ${values.heightPx} px`; }
    else { cardImage.removeAttribute('src'); ballImage.removeAttribute('src'); cardImage.hidden = ballImage.hidden = true; emptyCard.hidden = emptyBall.hidden = false; $('previewGenerationHint').textContent = '未上传基础颜色纹理，保存后显示“无预览图”'; }
    $('confirmPreviewGeneration').disabled = false;
  } catch (error) { $('previewGenerationHint').textContent = error.message; $('confirmPreviewGeneration').disabled = true; }
}
function openPreviewGeneration() {
  if (pending || proceduralJobs.size) { status('请等待贴图生成或载入完成'); return; }
  const dialog = $('previewGenerationDialog');
  const category = $('category').value, defaults = previewCategorySizes[category] || previewCategorySizes['其他'];
  const savedDimensions = savedPreviewCategory === category ? savedPreviewInfo : null;
  $('previewPhysicalWidth').value = savedDimensions?.widthCm || defaults[0];
  $('previewPhysicalHeight').value = savedDimensions?.heightCm || defaults[1];
  $('previewPixelWidth').value = savedPreviewInfo?.widthPx || 400;
  $('previewPixelHeight').value = savedPreviewInfo?.heightPx || 300;
  for (const pair of previewSizePairs) setPreviewRatioLock(pair, true);
  syncPreviewGeneration();
  if (!dialog.open) dialog.showModal();
  $('previewPhysicalWidth').focus();
}
function setPreviewRatioLock(pair, locked) {
  const button = $(pair.button);
  if (locked) {
    const width = Number($(pair.width).value), height = Number($(pair.height).value);
    if (!(width > 0 && height > 0 && Number.isFinite(width / height))) return;
    pair.ratio = width / height;
  }
  button.setAttribute('aria-pressed', String(locked));
  button.title = `${locked ? '解锁' : '锁定'}${pair.name}宽高比`;
}
function updatePreviewSize(pair, editedId) {
  const input = $(editedId), value = Number(input.value);
  if ($(pair.button).getAttribute('aria-pressed') === 'true' && value > 0 && Number.isFinite(value) && input.validity.valid) {
    const widthEdited = editedId === pair.width;
    const linked = widthEdited ? value / pair.ratio : value * pair.ratio;
    $(widthEdited ? pair.height : pair.width).value = Number(linked.toFixed(pair.digits));
  }
  syncPreviewGeneration();
}
async function saveMaterialWithPreview() {
  if (submittingPreview) return;
  submittingPreview = true;
  const saveButton = $('confirmPreviewGeneration');
  saveButton.disabled = true; $('saveMaterial').disabled = true;
  try {
    const generation = editGeneration;
    const values = previewGenerationValues(), dataUrl = previewCrop(material.map?.image, values.widthPx, values.heightPx, values.widthCm, values.heightCm);
    const preview = await previewBlobFromDataUrl(dataUrl);
    const asset = currentAsset({ preview, previewInfo: preview ? { widthCm: values.widthCm, heightCm: values.heightCm, widthPx: values.widthPx, heightPx: values.heightPx } : null });
    const task = await enqueueMaterialUpload(asset, { dependsOn: lastUploadTask });
    lastUploadTask = task.id; assetId = task.targetAssetId;
    if (asset.ownerId && asset.ownerId !== task.ownerId) libraryMetadata.parentId = null;
    libraryMetadata.ownerId = task.ownerId;
    savedPreview = preview; savedPreviewInfo = asset.previewInfo; savedPreviewCategory = asset.category;
    if (generation === editGeneration) dirty = false;
    history.replaceState(null, '', '?asset=' + encodeURIComponent(assetId) + '&upload=' + encodeURIComponent(task.id));
    $('previewGenerationDialog').close(); status('已加入后台上传任务');
    void syncMaterialUpload();
  } catch (error) { status('保存失败：' + error.message); }
  finally { submittingPreview = false; saveButton.disabled = false; $('saveMaterial').disabled = pending > 0; }
}
function chooseBatchFabricCategory(plan) {
  const dialog = $('batchFabricCategoryDialog'), select = $('batchFabricCategory');
  select.replaceChildren(...Array.from($('category').options, option => option.cloneNode(true)));
  select.value = $('category').value;
  renderBatchFabricSwatches($('batchFabricSwatches'), plan.variants);
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'upload' ? select.value : null), { once: true });
    dialog.showModal();
    select.focus();
  });
}
async function batchFabricFolder(selectedFiles) {
  if (!selectedFiles.length || batchingFabric) return;
  if (pending) { status('请等待贴图载入完成后再批处理齐色'); return; }
  batchingFabric = true;
  const button = $('batchFabric'), summary = $('batchFabricSummary');
  button.disabled = true; summary.hidden = false;
  summary.textContent = '正在读取齐色文件夹…';
  try {
    const plan = planFabricBatch(selectedFiles);
    summary.hidden = true;
    const category = await chooseBatchFabricCategory(plan);
    if (category === null) return;
    summary.hidden = false;
    const defaults = previewCategorySizes[category] || previewCategorySizes['其他'];
    const dimensions = savedPreviewCategory === category ? savedPreviewInfo : null;
    const template = {
      category, description: libraryMetadata.description, designInfo: libraryMetadata.designInfo, supplier: libraryMetadata.supplier,
      surface: readSurface(material), physical: { ...physical }, repeat: [...repeat], maps: { ...files }, density: { ...density }, legacyMaps: { ...legacyMaps },
      previewInfo: { widthCm: dimensions?.widthCm || defaults[0], heightCm: dimensions?.heightCm || defaults[1], widthPx: savedPreviewInfo?.widthPx || 400, heightPx: savedPreviewInfo?.heightPx || 300 },
    };
    const result = await enqueueFabricBatch(plan, template, {
      enqueue: asset => enqueueMaterialUpload(asset),
      createPreview: (image, sourcePhysical, values) => previewBlobFromDataUrl(previewCrop(image, values.widthPx, values.heightPx, values.widthCm, values.heightCm, sourcePhysical)),
      onProgress: ({ completed, total, queued }) => {
        button.textContent = `批处理中 ${completed}/${total}`;
        summary.textContent = `已处理 ${completed}/${total} 个色号，${queued} 项已加入上传队列`;
      },
    });
    summary.textContent = `齐色批处理完成：${result.queued} 项已加入上传队列` + (result.skipped ? `，已忽略 ${result.skipped} 个非色号文件` : '')
      + (result.failures.length ? `，${result.failures.length} 项失败\n` + result.failures.map(item => `${item.name}：${item.message}`).join('\n') : '');
    status(`齐色批处理完成，${result.queued} 项已加入上传队列`);
  } catch (error) { summary.hidden = false; summary.textContent = '齐色批处理失败：' + error.message; status(summary.textContent); }
  finally { batchingFabric = false; button.disabled = false; button.textContent = '批处理齐色'; $('batchFabricFolder').value = ''; }
}
async function syncMaterialUpload() {
  if (!lastUploadTask) return;
  const id = lastUploadTask, task = await getUpload(id);
  if (!task || id !== lastUploadTask) return;
  if (task.status === 'completed') {
    assetId = task.result.id;
    const previousRevision = libraryMetadata.revision;
    libraryMetadata.revision = task.result.revision;
    if (previousRevision !== task.result.revision) {
      let saved;
      try { saved = await getAsset(task.result.id, { previewOnly: true }); }
      catch {
        if (id !== lastUploadTask) return;
        status('面料已保存，但资产信息暂未载入，请重新打开面料或到资产库查看');
        return;
      }
      if (id !== lastUploadTask) return;
      libraryMetadata.fabricIdentityVersion = saved?.fabricIdentityVersion;
    }
    history.replaceState(null, '', '?asset=' + encodeURIComponent(task.result.id));
    if (!dirty && !pending) status('已生成预览图并保存到资产库');
  } else if (task.status === 'failed') {
    status('后台上传失败，可在资产库上传任务中重试。');
  } else if ($('materialType').value !== 'pattern') status('面料正在上传…');
}
async function uploadMap(key, file, restoring = false, preserveIdentity = false) {
  if (!/\.(png|jpe?g|webp|bmp)$/i.test(file.name) && !['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/x-ms-bmp'].includes(file.type)) throw new Error('请选择 PNG、JPG、WebP 或 BMP 图片');
  if (file.size > 64 * 1024 * 1024) throw new Error('单张贴图不能超过 64 MB');
  const token = tokens[key] = (tokens[key] || 0) + 1;
  const originalFile = file;
  pending++; syncPendingControls();
  let texture, url, meta;
  try {
    meta = readImageDensity(await originalFile.arrayBuffer());
    file = await compressImageFile(originalFile, 8192);
    url = URL.createObjectURL(file);
    texture = await new THREE.TextureLoader().loadAsync(url);
    if (tokens[key] !== token) { texture.dispose(); URL.revokeObjectURL(url); return; }
    if (Math.max(texture.image.width, texture.image.height) > renderer.capabilities.maxTextureSize) throw new Error('图片超过显卡支持尺寸');
    material[key]?.dispose();
    if (urls[key]) URL.revokeObjectURL(urls[key]);
    if (key === 'aoMap') texture.userData.formUpload = true;
    material[key] = texture; files[key] = originalFile; urls[key] = url;
    const sourceWidth = originalFile.imageWidth || texture.image.width;
    const sourceHeight = originalFile.imageHeight || texture.image.height;
    density[key] = physicalSizeFromDensity(meta, sourceWidth, sourceHeight, physical.fallbackDpi);
    embeddedDensity[key] = physicalSizeFromDensity(meta, sourceWidth, sourceHeight);
    if (!restoring) {
      delete legacyMaps[key];
      if (key === 'map') applyBaseColorDpi();
      if (key === 'map') material.color.set('#ffffff');
      if (key === 'map' && $('materialType').value === 'fabric' && !preserveIdentity) {
        const info = fabricInfoFromFilename(originalFile.name);
        $('name').value = info.name;
        $('fabricColorCode').value = info.fabricColorCode;
        syncFabricColorSwatch();
      }
      if (key === 'roughnessMap') { material.roughness = 1; applySurface(material, { roughnessGrayscale: true, roughnessInvert: false }); }
      if (key === 'metalnessMap') material.metalness = 1;
      dirty = true;
    }
    configureMaps(); syncSurfaceControls();
    if (key === 'map') proceduralPreview?.setMap('base', material.map);
    if (key === 'normalMap') proceduralPreview?.setMap('normal', material.normalMap);
    if (key === 'roughnessMap') proceduralPreview?.setMap('roughness', material.roughnessMap);
    if (key === 'metalnessMap') proceduralPreview?.setMap('metalness', material.metalnessMap);
    if (key === 'aoMap') proceduralPreview?.setMap('ao', material.aoMap);
    $('preview-' + key).src = url; $('file-' + key).textContent = file.name;
    $('upload-' + key).classList.add('has-image'); $('remove-' + key).disabled = false;
    if (key === 'roughnessMap') refreshRoughnessPreview();
  } catch (error) { texture?.dispose(); if (url) URL.revokeObjectURL(url); throw error; }
  finally { pending--; syncPendingControls(); }
}
function currentAsset(overrides = {}) {
  if (pending || proceduralJobs.size) throw new Error('请等待贴图生成或载入完成');
  if ($('materialType').value === 'pattern' && !files.map) throw new Error('图案需要基础颜色图片');
  if (!$('name').value.trim()) throw new Error('请输入材质名称');
  return { ...libraryMetadata, preview: savedPreview, previewInfo: savedPreviewInfo, ...overrides, id: assetId, kind: 'material', placement: savedPlacement, materialType: $('materialType').value, name: $('name').value.trim(), category: $('category').value, fabricColorCode: $('fabricColorCode').value.trim(), surface: readSurface(material), physical: { ...physical }, repeat: [...repeat], maps: { ...files }, density: { ...density }, legacyMaps: { ...legacyMaps }, proceduralMapping: proceduralMapping ? structuredClone(proceduralMapping) : undefined, proceduralSource: proceduralSource || undefined };
}
async function restoreAsset() {
  const parameters = new URLSearchParams(location.search), id = parameters.get('asset'), uploadId = parameters.get('upload');
  if (!id && !uploadId) return;
  const task = uploadId ? await getUpload(uploadId, { payload: true }) : null;
  if (uploadId && !task && !id) throw new Error('上传任务不可用，请返回原账号查看。');
  const asset = normalizeAssetCategories(task?.asset ? { ...task.asset, id: task.targetAssetId, ownerId: task.ownerId } : await getAsset(task?.result?.id || id));
  if (task) lastUploadTask = task.id;
  if (!asset) throw new Error('资产不存在，可能已被删除');
  libraryMetadata = { description: asset.description, designInfo: asset.designInfo, supplier: asset.supplier, fabricIdentityVersion: asset.fabricIdentityVersion, fabricGroupId: asset.fabricGroupId, fabricDefaultColorCode: asset.fabricDefaultColorCode, parentId: asset.parentId, revision: asset.revision, ownerId: asset.ownerId };
  savedPreview = asset.preview || null; savedPreviewInfo = asset.previewInfo || null;
  savedPreviewCategory = asset.category;
  proceduralMapping = asset.proceduralMapping ? structuredClone(asset.proceduralMapping) : null;
  proceduralSource = asset.proceduralSource || null;
  if (asset.kind === 'texture') { $('name').value = asset.name.replace(/\.[^.]+$/, ''); $('materialType').value = 'pattern'; await uploadMap('map', asset.file); syncMaterialType(); return; }
  if (asset.kind !== 'material') throw new Error('请从资产库选择材质或贴图');
  $('materialType').value = materialType(asset);
  physical = readPhysical(asset.physical, true); repeat = asset.repeat || [1, 1];
  legacyMaps = asset.legacyMaps || {}; savedPlacement = asset.placement;
  for (const [key] of MATERIAL_MAPS) if (asset.maps?.[key]) {
    await uploadMap(key, asset.maps[key], true);
    if (asset.density?.[key]) density[key] = asset.density[key];
  }
  applySurface(material, { ...asset.surface, roughnessGrayscale: asset.surface?.roughnessGrayscale ?? !!asset.maps?.roughnessMap });
  assetId = asset.id; $('name').value = asset.name; $('category').value = asset.category;
  $('fabricColorCode').value = asset.fabricColorCode ?? (materialType(asset) === 'fabric' ? fabricInfoFromFilename(asset.maps?.map?.name).fabricColorCode : '');
  syncSurfaceControls(); syncPhysicalControls(); syncMaterialType(); configureMaps(); dirty = false;
  if (task?.status === 'completed') history.replaceState(null, '', '?asset=' + encodeURIComponent(task.result.id));
}
function buildPbrRows() {
  const channelControls = { normalMap: 'normalStrength', roughnessMap: 'roughness', metalnessMap: 'metalness', aoMap: 'aoStrength' };
  function addSlider(host, id) {
    const [, title, max, step] = sliders.find(item => item[0] === id);
    const group = document.createElement('div'); group.className = 'pbr-parameter';
    const label = document.createElement('label'); label.htmlFor = id + 'Value'; label.textContent = title;
    const value = document.createElement('input'); Object.assign(value, { type: 'number', id: id + 'Value', min: 0, max, step }); value.setAttribute('aria-label', title + '数值');
    const range = document.createElement('input'); Object.assign(range, { type: 'range', id, min: 0, max, step }); range.setAttribute('aria-label', title);
    label.append(value); group.append(label, range); host.append(group);
    range.oninput = updateSurface;
    const commit = final => {
      const number = value.valueAsNumber;
      if (!Number.isFinite(number) || number < 0 || number > max) {
        if (final) { status(title + '范围为 0–' + max); syncSurfaceControls(); }
        return;
      }
      range.value = String(number); updateSurface();
    };
    value.oninput = () => { if (value.value !== '') { const number = value.valueAsNumber; if (Number.isFinite(number) && number >= 0 && number <= max) { range.value = String(number); const surface = readSurface(material); surface[id] = Number(range.value); applySurface(material, surface); dirty = true; } } };
    value.onchange = () => commit(true);
  }
  function addColor(host, id, title, initial) {
    const label = document.createElement('label'); label.className = 'pbr-color'; label.textContent = title;
    const controls = document.createElement('div'); controls.className = 'pbr-color-inputs';
    const text = document.createElement('input'); Object.assign(text, { id: id + 'Value', type: 'text', value: initial, maxLength: 7 }); text.setAttribute('aria-label', title + '色值'); text.spellcheck = false;
    const color = document.createElement('input'); Object.assign(color, { id, type: 'hidden', value: initial }); color.setAttribute('aria-label', title);
    text.onchange = () => { if (/^#[\da-f]{6}$/i.test(text.value)) { color.value = text.value; updateSurface(); } else { status('请输入 #RRGGBB 格式的色值'); syncSurfaceControls(); } };
    controls.append(text, color); bindColorInput(color); label.append(controls); host.append(label);
  }
  for (const [id, title, max] of sheenParameters) {
    const label = document.createElement('label'); label.htmlFor = id + 'Value';
    const text = document.createElement('span'); text.textContent = title;
    const value = document.createElement('input');
    Object.assign(value, { type: 'number', id: id + 'Value', min: 0, max, step: .01 });
    value.setAttribute('aria-label', title);
    value.oninput = () => {
      const number = value.valueAsNumber;
      if (Number.isFinite(number) && number >= 0 && number <= max) {
        applySurface(material, { [id]: number }); dirty = true;
      }
    };
    value.onchange = () => {
      if (!Number.isFinite(value.valueAsNumber) || value.valueAsNumber < 0 || value.valueAsNumber > max) status(title + '范围为 0–' + max);
      syncSurfaceControls();
    };
    label.append(text, value); $('fabricSheenControls').append(label);
  }
  for (const [key, title] of MATERIAL_MAPS) {
    const row = document.createElement('div'); row.className = 'map-row pbr-row'; row.dataset.map = key;
    const left = document.createElement('div'); left.className = 'pbr-texture';
    const remove = document.createElement('button'); Object.assign(remove, { id: 'remove-' + key, type: 'button', textContent: '×', disabled: true }); remove.className = 'pbr-remove'; remove.setAttribute('aria-label', '移除' + title); remove.onclick = event => { event.stopPropagation(); removeMap(key); };
    const input = document.createElement('input'); Object.assign(input, { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/bmp', id: 'map-' + key, hidden: true });
    const upload = document.createElement('div'); Object.assign(upload, { id: 'upload-' + key, className: 'pbr-dropzone' }); upload.setAttribute('role', 'button'); upload.tabIndex = 0; upload.setAttribute('aria-label', '上传' + title + '贴图'); upload.onclick = () => input.click(); upload.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } };
    const preview = document.createElement('img'); preview.id = 'preview-' + key; preview.alt = title + '贴图预览'; preview.draggable = false;
    const plus = document.createElement('span'); plus.className = 'upload-plus'; plus.textContent = '＋';
    const filename = document.createElement('small'); filename.id = 'file-' + key; filename.textContent = '拖入或点击上传';
    upload.append(preview, plus, remove); left.append(upload, filename, input);
    const right = document.createElement('div'); right.className = 'pbr-values';
    if (key === 'map') addColor(right, 'color', '基础颜色', '#d6dbe0');
    if (channelControls[key]) addSlider(right, channelControls[key]);
    if (key === 'normalMap') {
      const label = document.createElement('label'); label.className = 'pbr-flip';
      const flip = document.createElement('input'); Object.assign(flip, { type: 'checkbox', id: 'flip' }); label.append(flip, document.createTextNode('翻转法线 Y')); right.append(label);
    }
    if (key === 'roughnessMap') {
      const label = document.createElement('label'); label.className = 'pbr-flip';
      const invert = document.createElement('input'); Object.assign(invert, { type: 'checkbox', id: 'roughnessInvert', disabled: true });
      invert.onchange = updateSurface; label.append(invert, document.createTextNode('黑白反转')); right.append(label);
    }
    row.append(left, right); $('materialMaps').append(row);
    async function uploadFiles(list) {
      if (!list.length) return;
      if (list.length !== 1) return status('每个贴图通道请一次上传一张图片');
      try {
        await uploadMap(key, list[0]);
        const validDpi = embeddedDensity.map && [embeddedDensity.map.widthCm, embeddedDensity.map.heightCm].every(v => v >= .01 && v <= 100000);
        status(key === 'map' && !validDpi ? '图片未记录有效 DPI，已保留当前厘米尺寸' : '');
      } catch (error) { status(error.message); }
    }
    input.onchange = () => { const list = [...input.files]; input.value = ''; uploadFiles(list); };
    let depth = 0;
    const isFileDrag = event => [...(event.dataTransfer?.types || [])].includes('Files');
    row.addEventListener('dragenter', event => { if (!isFileDrag(event)) return; event.preventDefault(); depth++; row.classList.add('drag-over'); });
    row.addEventListener('dragover', event => { if (!isFileDrag(event)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; });
    row.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; row.classList.remove('drag-over'); } });
    row.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); depth = 0; row.classList.remove('drag-over'); uploadFiles([...(event.dataTransfer?.files || [])]); });
  }
  // A file dropped outside a channel must not navigate away from unsaved work.
  window.addEventListener('dragover', event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'none'; } });
  window.addEventListener('drop', event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) { event.preventDefault(); status('请将图片拖到对应的 PBR 贴图行'); } });
}
async function init() {
  renderer = new THREE.WebGLRenderer({ canvas: $('materialCanvas'), antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  // Match the texture's sRGB colors without a filmic contrast curve.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1;
  scene = new THREE.Scene(); scene.background = new THREE.Color('#eef2f6');
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, .04).texture; room.dispose(); pmrem.dispose();
  scene.environmentIntensity = .05;
  camera = new THREE.PerspectiveCamera(35, 1, .1, 2000); camera.position.set(0, 0, 120);
  controls = new OrbitControls(camera, $('materialCanvas'));
  // Flat mode pans the surface. Sphere mode orbits only the camera; the
  // sphere, scene lights and environment remain fixed in world space.
  controls.enableDamping = true;
  controls.enableRotate = false;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minDistance = 20; controls.maxDistance = 300;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.touches.ONE = THREE.TOUCH.PAN;
  // Neutral fill and key retain PBR detail without the old warm/blue cast.
  // Calibrate their combined irradiance on the front-facing preview plane.
  const irradiance = 2.8;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, irradiance * .65));
  const key = new THREE.DirectionalLight(0xffffff); key.position.set(80, 150, 150);
  key.intensity = irradiance * .35 / key.position.clone().normalize().z; scene.add(key);
  plane = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), material); plane.visible = true;
  preparePhysicalUV(plane); scene.add(plane);
  previewPositions = plane.geometry.attributes.position;
  previewUv = plane.geometry.attributes.uv;
  previewPhysicalUv = plane.geometry.attributes.uv2;
  sheenBall = new THREE.Mesh(new THREE.SphereGeometry(24, 64, 48), material);
  preparePhysicalUV(sheenBall); sheenBall.visible = false; scene.add(sheenBall);
  proceduralPreview = mountProceduralPreview({
    renderer, plane, ball: sheenBall, material,
    physical: () => physical,
    onCrop: rect => $('proceduralFrame').contentWindow?.postMessage({ type: 'procedural-crop', rect, sourceRevision: proceduralRevisions.source }, '*'),
    onError: error => status(error.message),
    onPreviewState: blocked => { controls.enabled = !blocked && $('materialType').value !== 'pattern'; }
  });
  const setPreviewMode = ball => {
    if (sheenPreview === ball) return;
    // Clear pending damping before changing coordinate systems so returning
    // from an orbit cannot leave the flat camera tilted or still rotating.
    controls.enableDamping = false; controls.update();
    if (ball) {
      flatPreviewView = { position: camera.position.clone(), target: controls.target.clone() };
      camera.position.set(0, 0, 120); controls.target.set(0, 0, 0);
    } else if (flatPreviewView) {
      camera.position.copy(flatPreviewView.position); controls.target.copy(flatPreviewView.target);
    }
    sheenPreview = ball; plane.visible = !ball; sheenBall.visible = ball;
    controls.enablePan = !ball; controls.enableRotate = ball;
    controls.mouseButtons.LEFT = ball ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    controls.mouseButtons.MIDDLE = ball ? THREE.MOUSE.DOLLY : THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = ball ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    controls.touches.ONE = ball ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN;
    controls.touches.TWO = ball ? THREE.TOUCH.DOLLY_ROTATE : THREE.TOUCH.DOLLY_PAN;
    controls.minDistance = ball ? 60 : 20; controls.update(); controls.enableDamping = true;
    $('materialCanvas').setAttribute('aria-label', ball ? '球体预览，拖动环绕视角，滚轮缩放，灯光固定' : '无限平铺面料预览，左键或中键拖动平移，滚轮缩放，不可旋转');
    document.querySelectorAll('[data-preview-mode]').forEach(button => button.setAttribute('aria-pressed', String((button.dataset.previewMode === 'ball') === ball)));
  };
  document.querySelectorAll('[data-preview-mode]').forEach(button => { button.onclick = () => setPreviewMode(button.dataset.previewMode === 'ball'); });
  new ResizeObserver(() => {
    const { width, height } = $('previewPane').getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }).observe($('previewPane'));
  renderer.setAnimationLoop(() => {
    if (pageLeaving || proceduralPreview?.cropping || proceduralPreview?.showingInput || $('materialType').value === 'pattern') return;
    controls.update(); fillFabricPreview();
    renderer.render(scene, camera);
  });
  window.addEventListener('pagehide', () => {
    pageLeaving = true;
    renderer?.setAnimationLoop(null);
    controls?.dispose();
    proceduralPreview?.dispose();
    renderer?.dispose();
  }, { once: true });
  buildPbrRows();
  initEditorScrollbar();
  $('batchFabric').onclick = () => {
    if (pending) { status('请等待贴图载入完成后再批处理齐色'); return; }
    $('batchFabricFolder').click();
  };
  $('batchFabricFolder').onchange = event => { void batchFabricFolder(Array.from(event.target.files || [])); };
  $('openSizingPage').onclick = () => setSizingPageOpen(true);
  $('closeSizingPage').onclick = () => setSizingPageOpen(false);
  for (const id of ['color', 'flip']) $(id).oninput = updateSurface;
  $('materialType').onchange = () => {
    if ($('materialType').value === 'pattern') physical.mode = 'physical';
    syncMaterialType(); syncPhysicalControls(); configureMaps(); dirty = true;
  };
  document.querySelectorAll('[data-material-type]').forEach(button => { button.onclick = () => { if ($('materialType').value === button.dataset.materialType) return; $('materialType').value = button.dataset.materialType; $('materialType').dispatchEvent(new Event('change')); }; });
  for (const id of ['name', 'category', 'fabricColorCode']) $(id).oninput = () => {
    dirty = true;
    if (id === 'fabricColorCode') syncFabricColorSwatch();
    if (id === 'name' && $('previewGenerationDialog').open) syncPreviewGeneration();
  };
  for (const id of ['widthCm', 'heightCm', 'angle', 'sizing', 'repeatU', 'repeatV']) $(id).onchange = () => {
    try {
      let widthCm = Number($('widthCm').value), heightCm = Number($('heightCm').value);
      if (['widthCm', 'heightCm'].includes(id) && $('lockSizing').checked) {
        const previous = id === 'widthCm' ? physical.widthCm : physical.heightCm;
        const value = id === 'widthCm' ? widthCm : heightCm;
        if (Number.isFinite(value) && value >= .01 && Number.isFinite(previous) && previous >= .01) {
          if (id === 'widthCm') heightCm = physical.heightCm * value / physical.widthCm;
          else widthCm = physical.widthCm * value / physical.heightCm;
        }
      }
      const next = readPhysical({ ...physical, mode: $('sizing').value, widthCm, heightCm, angle: Number($('angle').value), locked: $('lockSizing').checked, sizeSource: ['widthCm', 'heightCm'].includes(id) ? 'manual' : physical.sizeSource });
      const nextRepeat = [Number($('repeatU').value), Number($('repeatV').value)];
      if (!nextRepeat.every(value => Number.isFinite(value) && value >= .01 && value <= 100)) throw new Error('重复范围为 0.01–100');
      physical = next; repeat = nextRepeat; legacyMaps = {}; configureMaps(); dirty = true;
    } catch (error) { status(error.message); }
    syncPhysicalControls();
  };
  $('lockSizing').onchange = () => { physical = { ...physical, locked: $('lockSizing').checked }; dirty = true; syncPhysicalControls(); };
  $('saveMaterial').onclick = openPreviewGeneration;
  document.addEventListener('input', () => { editGeneration++; });
  document.addEventListener('change', () => { editGeneration++; });
  subscribeUploads(() => { void syncMaterialUpload().catch(() => {}); });
  startUploadQueue();
  for (const pair of previewSizePairs) {
    for (const id of [pair.width, pair.height]) $(id).oninput = () => updatePreviewSize(pair, id);
    $(pair.button).onclick = () => setPreviewRatioLock(pair, $(pair.button).getAttribute('aria-pressed') !== 'true');
  }
  $('closePreviewGeneration').onclick = () => $('previewGenerationDialog').close();
  $('cancelPreviewGeneration').onclick = () => $('previewGenerationDialog').close();
  $('previewGenerationDialog').addEventListener('cancel', event => { event.preventDefault(); $('previewGenerationDialog').close(); });
  $('confirmPreviewGeneration').onclick = saveMaterialWithPreview;
  const proceduralParameters = $('proceduralParameters'), proceduralFrame = $('proceduralFrame'), proceduralWorkspace = $('proceduralWorkspace');
  const proceduralOrigin = location.origin === 'null' ? '*' : location.origin;
  let frameReady = null, sourceUploadToken = 0;
  const ensureProceduralFrame = () => {
    proceduralWorkspace.open = true;
    proceduralParameters.hidden = false;
    return frameReady ||= new Promise((resolve, reject) => {
      proceduralFrame.addEventListener('load', resolve, { once: true });
      proceduralFrame.addEventListener('error', () => { frameReady = null; reject(new Error('程序化参数载入失败，请重试')); }, { once: true });
      proceduralFrame.src = './web-demo/index.html?embed=1&panel=inline';
    });
  };
  $('uploadProceduralBmp').onclick = event => {
    event.preventDefault(); event.stopPropagation();
    $('proceduralBmpInput').click();
  };
  proceduralWorkspace.addEventListener('toggle', () => {
    if (!proceduralWorkspace.open && frameReady) proceduralFrame.contentWindow?.postMessage({ type: 'procedural-dismiss-picker' }, proceduralOrigin);
  });
  $('proceduralBmpInput').onchange = async () => {
    const file = $('proceduralBmpInput').files[0]; $('proceduralBmpInput').value = '';
    if (!file) return;
    const token = ++sourceUploadToken;
    proceduralJobs.add('source'); syncPendingControls(); status('');
    try {
      await ensureProceduralFrame();
      if (token === sourceUploadToken && !pageLeaving) proceduralFrame.contentWindow.postMessage({ type: 'procedural-upload', sourceFile: file }, proceduralOrigin);
    } catch (error) {
      if (token !== sourceUploadToken) return;
      proceduralJobs.delete('source'); proceduralParameters.hidden = !proceduralSource;
      syncPendingControls(); status(error.message);
    }
  };
  document.querySelector('.editor-panel').addEventListener('scroll', () => {
    if (frameReady) proceduralFrame.contentWindow?.postMessage({ type: 'procedural-dismiss-picker' }, proceduralOrigin);
  }, { passive: true });
  const clearRelief = () => {
    proceduralJobs.delete('relief');
    proceduralPreview.clear('height'); removeMap('normalMap'); removeMap('aoMap');
  };
  window.addEventListener('message', async event => {
    if (pageLeaving || event.source !== proceduralFrame.contentWindow || (event.origin !== location.origin && event.origin !== 'null')) return;
    const data = event.data || {}, messageType = data.type;
    if (messageType === 'procedural-panel-size') {
      const height = Number(data.height);
      if (Number.isFinite(height) && height > 0 && height <= 20000) proceduralFrame.style.height = `${Math.ceil(height)}px`;
      return;
    }
    if (messageType === 'procedural-crop-request') { proceduralPreview.startCrop(); return; }
    if (messageType === 'procedural-error') { status(data.message || '程序化材质处理失败'); return; }
    if (messageType === 'procedural-preview-status') {
      if (!['source', 'base', 'relief'].includes(data.kind)) return;
      if (data.kind === 'source') {
        if (data.sourceRevision < proceduralRevisions.source) return;
        proceduralRevisions.source = data.sourceRevision;
        proceduralRevisions.base = data.baseRevision; proceduralRevisions.relief = data.reliefRevision;
        proceduralJobs.clear();
        if (data.resetGeneratedMaps || data.error) {
          clearRelief(); removeMap('map'); proceduralPreview.clearSource();
        }
        if (data.busy) proceduralJobs.add('source');
        if (data.error) { proceduralSource = null; proceduralMapping = null; proceduralParameters.hidden = true; dirty = true; status(data.error); }
        syncPendingControls(); return;
      }
      const kind = data.kind, revision = kind === 'base' ? data.baseRevision : data.reliefRevision;
      if (data.sourceRevision < proceduralRevisions.source || revision < proceduralRevisions[kind]) return;
      proceduralRevisions.source = data.sourceRevision;
      proceduralRevisions[kind] = revision;
      if (data.busy) {
        if (kind === 'base') { tokens.map = (tokens.map || 0) + 1; proceduralPreview.clear('base'); }
        else clearRelief();
        proceduralJobs.add(kind);
      } else {
        proceduralJobs.delete(kind);
        if (kind === 'base') removeMap('map'); else clearRelief();
        if (data.error) status('程序化贴图生成失败：' + data.error);
      }
      syncPendingControls(); return;
    }
    if (messageType === 'procedural-state') {
      if (!data.mapping || !(data.sourceFile || proceduralSource)) return;
      if (data.sourceRevision < proceduralRevisions.source) return;
      proceduralRevisions.source = data.sourceRevision ?? proceduralRevisions.source;
      proceduralJobs.delete('source');
      if (data.resetGeneratedMaps) proceduralRevisions.base = Math.max(proceduralRevisions.base, data.baseRevision || 0);
      if (data.resetGeneratedMaps || data.resetReliefMaps) proceduralRevisions.relief = Math.max(proceduralRevisions.relief, data.reliefRevision || 0);
      if (data.resetGeneratedMaps || data.resetReliefMaps) clearRelief();
      if (data.resetGeneratedMaps) { proceduralJobs.delete('base'); removeMap('map'); }
      proceduralMapping = structuredClone(data.mapping);
      if (data.sourceFile) {
        proceduralSource = data.sourceFile;
        proceduralParameters.hidden = false;
        proceduralJobs.add('base');
        void proceduralPreview.setSource(proceduralSource).catch(error => status('BMP 预览载入失败：' + error.message));
      }
      const widthCm = data.mapping.width * .1, heightCm = data.mapping.height / (Number(data.mapping.options?.pixelsPerCmY) || 6);
      if (widthCm > 0 && heightCm > 0) {
        physical = readPhysical({ ...physical, widthCm, heightCm, mode: 'physical', sizeSource: 'manual' });
        syncPhysicalControls(); configureMaps();
      }
      dirty = true; editGeneration++; syncPendingControls(); return;
    }
    if (!['procedural-material', 'procedural-normal-material', 'procedural-relief-material'].includes(messageType)) return;
    const relief = messageType !== 'procedural-material', kind = relief ? 'relief' : 'base';
    const revision = relief ? data.reliefRevision : data.baseRevision;
    if ((data.sourceRevision ?? 0) < proceduralRevisions.source || (revision ?? 0) < proceduralRevisions[kind]) return;
    proceduralRevisions[kind] = revision ?? proceduralRevisions[kind];
    const sourceRevision = proceduralRevisions.source, runRevision = proceduralRevisions[kind];
    const valid = () => !pageLeaving && sourceRevision === proceduralRevisions.source && runRevision === proceduralRevisions[kind];
    const uploads = messageType === 'procedural-relief-material'
      ? [['normalMap', data.maps?.normalMap, 'procedural-normal-opengl.jpg'], ['aoMap', data.maps?.aoMap, 'procedural-ao.jpg']]
      : [[relief ? 'normalMap' : 'map', data.file, data.name || (relief ? 'procedural-normal-opengl.jpg' : 'procedural-material.jpg')]];
    proceduralJobs.add(kind); syncPendingControls();
    try {
      if (uploads.some(([, file]) => !file?.size || typeof file.arrayBuffer !== 'function')) throw new Error('没有生成有效的 JPG 贴图');
      for (const [key, file, name] of uploads) {
        if (!valid()) return;
        await uploadMap(key, new File([file], name, { type: file.type || 'image/jpeg' }), false, true);
        if (!valid()) return;
      }
      if (data.maps?.height) await proceduralPreview.setFile('height', new File([data.maps.height], 'procedural-height.jpg', { type: 'image/jpeg' }));
      if (!valid()) return;
      const widthCm = Number(data.physical?.widthCm), heightCm = Number(data.physical?.heightCm);
      if (widthCm > 0 && heightCm > 0) {
        physical = readPhysical({ ...physical, widthCm, heightCm, mode: 'physical', sizeSource: 'manual' });
        syncPhysicalControls(); configureMaps();
      }
      dirty = true; editGeneration++; status('');
    } catch (error) {
      if (valid()) { if (relief) clearRelief(); else removeMap('map'); status('应用程序化材质失败：' + error.message); }
    } finally {
      if (valid()) proceduralJobs.delete(kind);
      syncPendingControls();
    }
  });
  $('newMaterial').onclick = () => { if (!dirty || confirm('当前材质尚未保存，确定新建？')) { dirty = false; location.href = './material-editor.html'; } };
  window.addEventListener('beforeunload', event => { if (dirty || pending || proceduralJobs.size || batchingFabric) { event.preventDefault(); event.returnValue = ''; } });
  syncSurfaceControls(); syncPhysicalControls();
  try { await restoreAsset(); } catch (error) { status('打开资产失败：' + error.message); }
  if (proceduralSource && proceduralMapping) {
    void proceduralPreview.setSource(proceduralSource).catch(error => status(error.message));
    proceduralJobs.add('source');
    void ensureProceduralFrame().then(() => {
      if (!pageLeaving) proceduralFrame.contentWindow.postMessage({ type: 'procedural-load', sourceFile: proceduralSource, mapping: structuredClone(proceduralMapping) }, proceduralOrigin);
    }).catch(error => { proceduralJobs.delete('source'); syncPendingControls(); status(error.message); });
  }
  syncPendingControls(); $('uploadProceduralBmp').disabled = false; $('batchFabric').disabled = false; syncMaterialType();
}
init().catch(error => { console.error(error); status('无法初始化材质预览，请检查 WebGL 2 和硬件加速：' + error.message); });
