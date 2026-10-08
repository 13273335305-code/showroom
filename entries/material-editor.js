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
import { requireAuth } from '../shared/auth.js';

const $ = id => document.getElementById(id);
await requireAuth({ feature: 'material' });
mountNavigation('material');
let renderer, scene, camera, controls, plane, assetId, dirty = false, pending = 0;
let previewUv, previewPhysicalUv, previewPositions;
let physical = { ...defaultPhysical(), sizeSource: 'manual', initialized: true }, repeat = [1, 1];
let legacyMaps = {}, savedPlacement, libraryMetadata = {};
const files = {}, urls = {}, tokens = {}, density = {}, embeddedDensity = {};
const patternPreview = createPatternPreview($('patternPreview'));
let roughnessPreviewCache = null;
const material = new THREE.MeshStandardMaterial({ color: '#c2aa8b', roughness: .65, metalness: 0, bumpScale: .02 });
installRoughnessShader(material);
const status = message => { $('status').textContent = message; };
const sliders = [['roughness', '粗糙度', 1, .01], ['metalness', '金属度', 1, .01], ['normalStrength', '法线强度', 3, .05], ['aoStrength', 'AO 强度', 3, .05], ['emissiveStrength', '自发光强度', 3, .05], ['bumpStrength', '凹凸强度', .2, .005]];

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
  updatePatternPreview();
}
function syncMaterialType() {
  const pattern = $('materialType').value === 'pattern';
  document.querySelectorAll('[data-material-type]').forEach(button => { const active = button.dataset.materialType === $('materialType').value; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('fabricCategoryRow').hidden = pattern;
  $('sizing').closest('label').hidden = pattern; $('repeatControls').hidden = pattern || physical.mode !== 'legacy';
  $('physicalControls').hidden = !pattern && physical.mode !== 'physical';
  $('materialCanvas').hidden = pattern; $('patternPreview').hidden = !pattern;
  $('pbrHeading').hidden = pattern;
  document.body.classList.toggle('pattern-editing', pattern);
  controls.enabled = !pattern;
  updatePatternPreview();
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
function fillFabricPreview() {
  const distance = camera.position.distanceTo(controls.target);
  const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.02;
  const width = height * camera.aspect;
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
  if (key === 'map') { physical.sizeSource = 'manual'; configureMaps(); }
  else updatePatternPreview();
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
    const sourceWidth = originalFile.imageWidth || texture.image.width;
    const sourceHeight = originalFile.imageHeight || texture.image.height;
    density[key] = physicalSizeFromDensity(meta, sourceWidth, sourceHeight, physical.fallbackDpi);
    embeddedDensity[key] = physicalSizeFromDensity(meta, sourceWidth, sourceHeight);
    if (!restoring) {
      delete legacyMaps[key];
      if (key === 'map') applyBaseColorDpi();
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
  libraryMetadata = { description: asset.description, designInfo: asset.designInfo, supplier: asset.supplier, favorite: asset.favorite, preview: asset.preview };
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .75;
  scene = new THREE.Scene(); scene.background = new THREE.Color('#eef2f6');
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, .04).texture; room.dispose(); pmrem.dispose();
  camera = new THREE.PerspectiveCamera(35, 1, .1, 2000); camera.position.set(0, 0, 120);
  controls = new OrbitControls(camera, $('materialCanvas'));
  // The material editor is a flat-surface inspection window. Keep the camera
  // fixed toward the plane so dragging can only move the surface, never orbit
  // around it. The wheel changes zoom within the bounds below.
  controls.enableDamping = true;
  controls.enableRotate = false;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minDistance = 20; controls.maxDistance = 300;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.touches.ONE = THREE.TOUCH.PAN;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8798ad, 2));
  const key = new THREE.DirectionalLight(0xfff4e7, 3); key.position.set(80, 150, 150); scene.add(key);
  plane = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), material); plane.visible = true;
  preparePhysicalUV(plane); scene.add(plane);
  previewPositions = plane.geometry.attributes.position;
  previewUv = plane.geometry.attributes.uv;
  previewPhysicalUv = plane.geometry.attributes.uv2;
  new ResizeObserver(() => {
    const { width, height } = $('previewPane').getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }).observe($('previewPane'));
  renderer.setAnimationLoop(() => {
    if ($('materialType').value === 'pattern') return;
    controls.update(); fillFabricPreview();
    renderer.render(scene, camera);
  });
  buildPbrRows();
  initEditorScrollbar();
  for (const id of ['color', 'emissive', 'flip']) $(id).oninput = updateSurface;
  $('materialType').onchange = () => {
    if ($('materialType').value === 'pattern') physical.mode = 'physical';
    syncMaterialType(); syncPhysicalControls(); configureMaps(); dirty = true;
  };
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
  $('saveMaterial').onclick = async () => {
    $('saveMaterial').disabled = true;
    try {
      const current = assetId ? await getAsset(assetId) : null;
      if (current) libraryMetadata = { description: current.description, designInfo: current.designInfo, supplier: current.supplier, favorite: current.favorite, preview: current.preview };
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
