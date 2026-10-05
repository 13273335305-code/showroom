import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { defaultPhysical, readPhysical, preparePhysicalUV, setPhysicalTransform } from '../physical-textures.js';
import { readImageDensity, physicalSizeFromDensity } from '../image-density.js';
import { mountNavigation, downloadFile } from '../shared/navigation.js';
import { getAsset, saveAsset } from '../shared/asset-store.js';
import { MATERIAL_MAPS, readSurface, applySurface, applyLegacyUV } from '../shared/material-data.js';
import { materialType } from '../shared/material-placement.js';
import { packMaterial } from '../shared/material-package.js';
import { createPatternPreview } from '../shared/pattern-preview.js';
import { grayscalePixels } from '../shared/image-pixels.js';
import { configureTextureSampling } from '../shared/texture-sampling.js';
import { installRoughnessShader } from '../shared/roughness-map.js';
import { compressImageFile } from '../shared/asset-thumbnail.js';

const $ = id => document.getElementById(id);
mountNavigation('material');
let renderer, scene, camera, controls, sphere, plane, assetId, dirty = false, pending = 0;
let physical = { ...defaultPhysical(), sizeSource: 'manual', initialized: true }, repeat = [1, 1];
let legacyMaps = {}, savedPlacement, libraryMetadata = {};
const files = {}, urls = {}, tokens = {}, density = {}, embeddedDensity = {};
const patternPreview = createPatternPreview($('patternPreview'));
let roughnessPreviewCache = null;
const material = new THREE.MeshStandardMaterial({ color: '#c2aa8b', roughness: .65, metalness: 0, bumpScale: .02 });
installRoughnessShader(material);
const status = message => { $('status').textContent = message; };
const sliders = [['roughness', '粗糙度', 1, .01], ['metalness', '金属度', 1, .01], ['normalStrength', '法线强度', 3, .05], ['aoStrength', 'AO 强度', 3, .05], ['emissiveStrength', '自发光强度', 3, .05], ['bumpStrength', '凹凸强度', .2, .005]];

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
function updatePatternNote() {
  if ($('materialType').value !== 'pattern') return;
  const info = embeddedDensity.map;
  if (!files.map) $('sizeNote').textContent = '上传基础颜色贴图后自动读取 DPI，按像素 ÷ DPI × 2.54 换算厘米尺寸。';
  else if (!info) $('sizeNote').textContent = '基础颜色贴图未记录有效 DPI，保留当前尺寸，请手动填写实际宽高（cm）。';
  else if (![info.widthCm, info.heightCm].every(v => v >= .01 && v <= 100000)) $('sizeNote').textContent = 'DPI 换算尺寸超出 0.01–100000 cm，请手动填写有效宽高。';
  else $('sizeNote').textContent = `${info.pixelWidth} × ${info.pixelHeight} px · ${Number(info.dpiX.toFixed(2))} × ${Number(info.dpiY.toFixed(2))} DPI。${physical.sizeSource === 'dpi' ? '已自动换算实际厘米尺寸。' : '当前使用手动厘米尺寸。'}`;
}
function applyPatternDpi() {
  const info = embeddedDensity.map;
  if (info && [info.widthCm, info.heightCm].every(v => v >= .01 && v <= 100000)) {
    physical = { ...physical, widthCm: info.widthCm, heightCm: info.heightCm, mode: 'physical', sizeSource: 'dpi', fallbackDpi: null };
    density.map = info;
  } else physical = { ...physical, mode: 'physical', sizeSource: 'manual' };
  syncPhysicalControls(); updatePatternNote();
}

function syncSurfaceControls() {
  const surface = readSurface(material);
  for (const key of ['color', 'emissive', ...sliders.map(item => item[0])]) $(key).value = surface[key];
  for (const [key] of sliders) $(key + 'Value').value = Number(surface[key]).toFixed(key === 'bumpStrength' ? 3 : 2);
  $('colorValue').value = surface.color; $('emissiveValue').value = surface.emissive;
  $('flip').checked = surface.flip;
  $('roughnessInvert').checked = surface.roughnessInvert; refreshRoughnessPreview();
}
function updateSurface() {
  const surface = { color: $('color').value, emissive: $('emissive').value, flip: $('flip').checked, roughnessInvert: $('roughnessInvert').checked };
  for (const [key] of sliders) surface[key] = Number($(key).value);
  applySurface(material, surface);
  dirty = true;
  syncSurfaceControls();
  updatePatternPreview();
}
function syncPhysicalControls() {
  $('sizing').value = physical.mode;
  for (const key of ['widthCm', 'heightCm', 'angle']) $(key).value = Number(physical[key].toFixed(4));
  $('repeatU').value = repeat[0]; $('repeatV').value = repeat[1];
  const pattern = $('materialType').value === 'pattern';
  $('physicalControls').hidden = !pattern && physical.mode !== 'physical';
  $('repeatControls').hidden = pattern || physical.mode !== 'legacy';
  updatePatternNote(); updatePatternPreview();
}
function syncMaterialType() {
  const pattern = $('materialType').value === 'pattern';
  document.querySelectorAll('[data-material-type]').forEach(button => { const active = button.dataset.materialType === $('materialType').value; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('fabricCategoryRow').hidden = pattern;
  $('sizing').closest('label').hidden = pattern; $('repeatControls').hidden = pattern || physical.mode !== 'legacy';
  $('physicalControls').hidden = !pattern && physical.mode !== 'physical';
  $('spherePreview').disabled = pattern;
  $('materialCanvas').hidden = pattern; $('patternPreview').hidden = !pattern;
  document.querySelector('.preview-controls').hidden = pattern;
  for (const selector of ['.preview-copy', '#sizeNote', '#pbrHeading', '.pbr-help', '.pbr-columns']) document.querySelector(selector).hidden = pattern;
  document.body.classList.toggle('pattern-editing', pattern);
  controls.enabled = !pattern;
  document.querySelector('.preview-copy h1').innerHTML = pattern ? '图案二维预览' : '从一束光，<br>看见材质的细节。';
  document.querySelector('.preview-copy p').textContent = pattern ? '按实际宽高比例展示，上方为宽度，右侧为高度。' : '独立编辑 PBR 材质，保存后在设计台中使用。';
  $('readDpi').hidden = pattern;
  $('sizeNote').textContent = pattern ? '图案只贴一张，宽高为贴在模型上的实际厘米尺寸。' : '面料按厘米尺寸或原始 UV 重复平铺。';
  updatePatternNote(); updatePatternPreview();
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
  updatePatternPreview();
}
function removeMap(key) {
  tokens[key] = (tokens[key] || 0) + 1;
  material[key]?.dispose(); material[key] = null;
  if (urls[key]) URL.revokeObjectURL(urls[key]);
  delete files[key]; delete urls[key]; delete density[key]; delete embeddedDensity[key]; delete legacyMaps[key];
  $('preview-' + key).removeAttribute('src'); $('file-' + key).textContent = '拖入或点击上传';
  $('upload-' + key).classList.remove('has-image'); $('remove-' + key).disabled = true;
  material.needsUpdate = true; dirty = true;
  if (key === 'roughnessMap') { applySurface(material, { roughnessInvert: false }); syncSurfaceControls(); }
  if (key === 'map' && $('materialType').value === 'pattern') { physical.sizeSource = 'manual'; updatePatternNote(); }
  updatePatternPreview();
}
async function uploadMap(key, file, restoring = false) {
  if (!/\.(png|jpe?g|webp|bmp)$/i.test(file.name) && !['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/x-ms-bmp'].includes(file.type)) throw new Error('请选择 PNG、JPG、WebP 或 BMP 图片');
  if (file.size > 64 * 1024 * 1024) throw new Error('单张贴图不能超过 64 MB');
  const token = tokens[key] = (tokens[key] || 0) + 1;
  const originalFile = file;
  pending++; $('saveMaterial').disabled = true; $('exportMaterial').disabled = true;
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
    material[key] = texture; files[key] = file; urls[key] = url;
    density[key] = physicalSizeFromDensity(meta, texture.image.width, texture.image.height, physical.fallbackDpi);
    embeddedDensity[key] = physicalSizeFromDensity(meta, texture.image.width, texture.image.height);
    if (!restoring) {
      delete legacyMaps[key];
      if ($('materialType').value === 'pattern') { if (key === 'map') applyPatternDpi(); }
      else if (!density[key] && physical.sizeSource === 'dpi') { physical.sizeSource = 'manual'; $('sizeNote').textContent = '新贴图没有 DPI，已改用当前手动厘米尺寸。'; }
      if (key === 'map') material.color.set('#ffffff');
      if (key === 'roughnessMap') { material.roughness = 1; applySurface(material, { roughnessGrayscale: true, roughnessInvert: false }); }
      if (key === 'metalnessMap') material.metalness = 1;
      if (key === 'emissiveMap') material.emissive.set('#ffffff');
      dirty = true;
    }
    configureMaps(); syncSurfaceControls();
    $('preview-' + key).src = url; $('file-' + key).textContent = file.name;
    if (key === 'roughnessMap') refreshRoughnessPreview();
    $('upload-' + key).classList.add('has-image'); $('remove-' + key).disabled = false;
  } catch (error) { texture?.dispose(); if (url) URL.revokeObjectURL(url); throw error; }
  finally { pending--; $('saveMaterial').disabled = pending > 0; $('exportMaterial').disabled = pending > 0; }
}
function currentAsset() {
  if (pending) throw new Error('请等待贴图载入完成');
  if ($('materialType').value === 'pattern' && !files.map) throw new Error('图案需要基础颜色图片');
  if (!$('name').value.trim()) throw new Error('请输入材质名称');
  return { ...libraryMetadata, id: assetId, kind: 'material', placement: savedPlacement, materialType: $('materialType').value, name: $('name').value.trim(), category: $('category').value, surface: readSurface(material), physical: { ...physical }, repeat: [...repeat], maps: { ...files }, density: { ...density }, legacyMaps: { ...legacyMaps } };
}
async function restoreAsset() {
  const id = new URLSearchParams(location.search).get('asset');
  if (!id) return;
  const asset = await getAsset(id);
  if (!asset) throw new Error('资产不存在，可能已被删除');
  libraryMetadata = { description: asset.description, preview: asset.preview };
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
  syncSurfaceControls(); syncPhysicalControls(); syncMaterialType(); configureMaps(); dirty = false;
}
function buildPbrRows() {
  const channelControls = { normalMap: 'normalStrength', roughnessMap: 'roughness', metalnessMap: 'metalness', aoMap: 'aoStrength', bumpMap: 'bumpStrength', emissiveMap: 'emissiveStrength' };
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
    const color = document.createElement('input'); Object.assign(color, { id, type: 'color', value: initial }); color.setAttribute('aria-label', title);
    text.onchange = () => { if (/^#[\da-f]{6}$/i.test(text.value)) { color.value = text.value; updateSurface(); } else { status('请输入 #RRGGBB 格式的色值'); syncSurfaceControls(); } };
    controls.append(text, color); label.append(controls); host.append(label);
  }
  for (const [key, title] of MATERIAL_MAPS) {
    const row = document.createElement('div'); row.className = 'map-row pbr-row'; row.dataset.map = key;
    const left = document.createElement('div'); left.className = 'pbr-texture';
    const heading = document.createElement('div'); heading.className = 'pbr-texture-heading';
    const name = document.createElement('strong'); name.textContent = title;
    const remove = document.createElement('button'); Object.assign(remove, { id: 'remove-' + key, type: 'button', textContent: '×', disabled: true }); remove.setAttribute('aria-label', '移除' + title); remove.onclick = () => removeMap(key); heading.append(name, remove);
    const input = document.createElement('input'); Object.assign(input, { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/bmp', id: 'map-' + key, hidden: true });
    const upload = document.createElement('button'); Object.assign(upload, { type: 'button', id: 'upload-' + key, className: 'pbr-dropzone' }); upload.setAttribute('aria-label', '上传' + title + '贴图'); upload.onclick = () => input.click();
    const preview = document.createElement('img'); preview.id = 'preview-' + key; preview.alt = title + '贴图预览'; preview.draggable = false;
    const plus = document.createElement('span'); plus.className = 'upload-plus'; plus.textContent = '＋';
    const filename = document.createElement('small'); filename.id = 'file-' + key; filename.textContent = '拖入或点击上传';
    upload.append(preview, plus); left.append(heading, upload, filename, input);
    const right = document.createElement('div'); right.className = 'pbr-values';
    if (key === 'map') addColor(right, 'color', '基础颜色', '#c2aa8b');
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
    if (key === 'emissiveMap') addColor(right, 'emissive', '自发光颜色', '#000000');
    row.append(left, right); $('materialMaps').append(row);
    async function uploadFiles(list) {
      if (!list.length) return;
      if (list.length !== 1) return status('每个贴图通道请一次上传一张图片');
      try { await uploadMap(key, list[0]); status($('materialType').value === 'pattern' && key === 'map' && !embeddedDensity.map ? '贴图未记录有效 DPI，请手动填写厘米尺寸' : '已载入 ' + list[0].name); } catch (error) { status(error.message); }
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  scene = new THREE.Scene(); scene.background = new THREE.Color('#eef2f6');
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, .04).texture; room.dispose(); pmrem.dispose();
  camera = new THREE.PerspectiveCamera(35, 1, .1, 2000); camera.position.set(160, 75, 240);
  controls = new OrbitControls(camera, $('materialCanvas')); controls.enableDamping = true; controls.minDistance = 100; controls.maxDistance = 600;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8798ad, 2));
  const key = new THREE.DirectionalLight(0xfff4e7, 3); key.position.set(80, 150, 150); scene.add(key);
  sphere = new THREE.Mesh(new THREE.SphereGeometry(50, 80, 48), material);
  plane = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), material); plane.visible = false;
  preparePhysicalUV(sphere); preparePhysicalUV(plane); scene.add(sphere, plane);
  new ResizeObserver(() => { const { width, height } = $('previewPane').getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix(); }).observe($('previewPane'));
  renderer.setAnimationLoop(() => { if ($('materialType').value === 'pattern') return; controls.update(); renderer.render(scene, camera); });
  buildPbrRows();
  for (const id of ['color', 'emissive', 'flip']) $(id).oninput = updateSurface;
  $('materialType').onchange = () => { if ($('materialType').value === 'pattern') applyPatternDpi(); syncMaterialType(); configureMaps(); dirty = true; };
  document.querySelectorAll('[data-material-type]').forEach(button => { button.onclick = () => { if ($('materialType').value === button.dataset.materialType) return; $('materialType').value = button.dataset.materialType; $('materialType').dispatchEvent(new Event('change')); }; });
  for (const id of ['name', 'category']) $(id).oninput = () => { dirty = true; };
  for (const id of ['widthCm', 'heightCm', 'angle', 'sizing', 'repeatU', 'repeatV']) $(id).onchange = () => {
    try {
      const next = readPhysical({ ...physical, mode: $('sizing').value, widthCm: Number($('widthCm').value), heightCm: Number($('heightCm').value), angle: Number($('angle').value), sizeSource: ['widthCm', 'heightCm'].includes(id) ? 'manual' : physical.sizeSource });
      const nextRepeat = [Number($('repeatU').value), Number($('repeatV').value)];
      if (!nextRepeat.every(value => Number.isFinite(value) && value >= .01 && value <= 100)) throw new Error('重复范围为 0.01–100');
      physical = next; repeat = nextRepeat; legacyMaps = {}; configureMaps(); dirty = true;
    } catch (error) { status(error.message); }
    syncPhysicalControls();
  };
  $('readDpi').onclick = () => {
    if (!density.map) return status('基础颜色贴图没有有效 DPI，请手动填写厘米尺寸');
    if (MATERIAL_MAPS.some(([key]) => files[key] && !density[key])) return status('部分贴图没有有效 DPI，请使用手动厘米尺寸');
    physical = { ...physical, widthCm: density.map.widthCm, heightCm: density.map.heightCm, mode: 'physical', sizeSource: 'dpi' };
    configureMaps(); syncPhysicalControls(); dirty = true;
    $('sizeNote').textContent = `${density.map.dpiX.toFixed(2)} × ${density.map.dpiY.toFixed(2)} DPI；各贴图按各自 DPI 铺贴。`;
  };
  for (const [id, isSphere] of [['spherePreview', true], ['planePreview', false]]) $(id).onclick = () => {
    sphere.visible = isSphere; plane.visible = !isSphere; camera.position.set(isSphere ? 160 : 0, isSphere ? 75 : 0, 240); controls.target.set(0, 0, 0); controls.update();
    $('spherePreview').setAttribute('aria-pressed', String(isSphere)); $('planePreview').setAttribute('aria-pressed', String(!isSphere));
  };
  $('saveMaterial').onclick = async () => {
    $('saveMaterial').disabled = true;
    try {
      const current = assetId ? await getAsset(assetId) : null;
      if (current) libraryMetadata = { description: current.description, preview: current.preview };
      const asset = await saveAsset(currentAsset()); assetId = asset.id; dirty = false; history.replaceState(null, '', '?asset=' + encodeURIComponent(asset.id)); status('已保存到资产库');
    }
    catch (error) { status('保存失败：' + error.message); }
    finally { $('saveMaterial').disabled = pending > 0; }
  };
  $('exportMaterial').onclick = async () => { try { const asset = currentAsset(); downloadFile(await packMaterial(asset), asset.name + '.formmat'); status('已导出材质包，包含 PBR 贴图'); } catch (error) { status(error.message); } };
  $('newMaterial').onclick = () => { if (!dirty || confirm('当前材质尚未保存，确定新建？')) { dirty = false; location.href = './material-editor.html'; } };
  window.addEventListener('beforeunload', event => { if (dirty || pending) { event.preventDefault(); event.returnValue = ''; } });
  syncSurfaceControls(); syncPhysicalControls();
  try { await restoreAsset(); } catch (error) { status('打开资产失败：' + error.message); }
  $('saveMaterial').disabled = false; syncMaterialType();
}
init().catch(error => { console.error(error); status('无法初始化材质预览，请检查 WebGL 2 和硬件加速：' + error.message); });
