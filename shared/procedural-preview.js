import * as THREE from '../vendor/three/build/three.module.js';
import { setPhysicalTransform } from '../physical-textures.js';
import { configureTextureSampling } from './texture-sampling.js';
import { compressImageFile } from './asset-thumbnail.js';

// Diagnostic maps share the editor's meshes, physical UVs, camera and controls.
// Their unlit material preserves RGB values, especially the normal map's blue.
export function mountProceduralPreview({ renderer, plane, ball, material, physical, onCrop, onError, onPreviewState }) {
  const $ = id => document.getElementById(id);
  const tabs = $('materialPreviewMaps'), viewport = $('proceduralCropViewport'), canvas = $('proceduralCropCanvas');
  const textures = new Map(), versions = new Map();
  const channels = { base: 'map', normal: 'normalMap', roughness: 'roughnessMap', metalness: 'metalnessMap', ao: 'aoMap' };
  const display = new THREE.MeshBasicMaterial({ toneMapped: false });
  let mode = 'material', enabled = false, source = null, sourceVersion = 0, disposed = false;
  const apply = () => {
    const texture = textures.get(mode);
    if (mode !== 'material' && !(mode === 'input' ? source : texture)) mode = 'material';
    display.map = textures.get(mode) || null; display.needsUpdate = true;
    plane.material = ball.material = enabled && mode !== 'material' ? display : material;
    tabs.querySelectorAll('[data-preview-map]').forEach(button => {
      const key = button.dataset.previewMap;
      button.disabled = key === 'input' ? !source : key !== 'material' && !textures.has(key);
      button.setAttribute('aria-pressed', String(button.dataset.previewMap === mode));
    });
    syncPresentation();
  };
  const configure = (texture, key) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    const original = material[channels[key]];
    if (original) {
      // Ordinary materials may use legacy UVs or per-map DPI. Match the
      // actual channel's placement instead of imposing physical tiling.
      texture.channel = original.channel;
      texture.wrapS = original.wrapS; texture.wrapT = original.wrapT;
      texture.matrixAutoUpdate = original.matrixAutoUpdate;
      texture.offset.copy(original.offset); texture.repeat.copy(original.repeat);
      texture.center.copy(original.center); texture.rotation = original.rotation;
      texture.matrix.copy(original.matrix);
    } else {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      setPhysicalTransform(texture, physical(), 1);
    }
    configureTextureSampling(texture, renderer);
  };
  const clear = key => {
    versions.set(key, (versions.get(key) || 0) + 1);
    textures.get(key)?.dispose(); textures.delete(key); apply();
  };
  const setMap = (key, original) => {
    versions.set(key, (versions.get(key) || 0) + 1);
    textures.get(key)?.dispose(); textures.delete(key);
    if (!original || disposed) { apply(); return; }
    const texture = original.clone(); configure(texture, key);
    if (key === 'input') texture.magFilter = THREE.NearestFilter;
    textures.set(key, texture); apply();
  };
  const setFile = async (key, file) => {
    clear(key);
    const version = versions.get(key);
    let texture;
    try {
      // Preview-only images are bounded to the same runtime size as PBR maps.
      const runtime = await compressImageFile(file, Math.min(8192, renderer.capabilities.maxTextureSize));
      const runtimeUrl = URL.createObjectURL(runtime);
      try { texture = await new THREE.TextureLoader().loadAsync(runtimeUrl); }
      finally { URL.revokeObjectURL(runtimeUrl); }
      if (disposed || versions.get(key) !== version) { texture.dispose(); return; }
      configure(texture, key);
      if (key === 'input') texture.magFilter = THREE.NearestFilter;
      textures.set(key, texture); apply();
    } catch (error) { texture?.dispose(); if (!disposed && versions.get(key) === version) onError(error); }
  };

  // Crop coordinates intentionally use the original BMP's pixel aspect ratio,
  // independent of the centimetre calibration used by the Three.js preview.
  const view = { scale: 1, offsetX: 0, offsetY: 0, dragging: null, canPan: null, onTransform: null };
  view.render = () => {
    canvas.style.width = `${canvas.width * view.scale}px`;
    canvas.style.height = `${canvas.height * view.scale}px`;
    canvas.style.transform = `translate(calc(-50% + ${view.offsetX}px),calc(-50% + ${view.offsetY}px))`;
    view.onTransform?.();
    if (enabled && mode === 'input' && !crop.active) {
      const bounds = viewport.getBoundingClientRect();
      const fit = Math.min((bounds.width - 24) / canvas.width, (bounds.height - 24) / canvas.height);
      const label = `${Math.round(view.scale / fit * 100)}%`;
      $('materialPreviewZoom').textContent = label;
      $('materialPreviewZoom').setAttribute('aria-label', `BMP 原图缩放 ${label}`);
      $('materialPreviewZoom').hidden = false;
    }
  };
  view.reset = () => {
    view.dragging = null; view.offsetX = view.offsetY = 0;
    const bounds = viewport.getBoundingClientRect();
    const fit = canvas.width ? Math.min((bounds.width - 24) / canvas.width, (bounds.height - 24) / canvas.height) : 1;
    view.scale = Math.max(.02, Math.min(8, fit)); view.render();
  };
  const syncPresentation = () => {
    const input = enabled && mode === 'input', cropping = crop.active;
    tabs.classList.toggle('has-procedural-source', !!source);
    tabs.querySelector('.material-preview-input').classList.toggle('is-expanded', input && !!source);
    tabs.querySelector('[data-preview-map="input"]').setAttribute('aria-expanded', String(input && !!source));
    $('proceduralCropStart').hidden = !source;
    $('proceduralCropStart').inert = !input;
    viewport.hidden = !input && !cropping;
    $('previewPane').classList.toggle('procedural-cropping', cropping);
    $('previewPane').classList.toggle('procedural-input-preview', input && !cropping);
    onPreviewState(input || cropping);
  };
  const crop = globalThis.mountBmpCropTool({
    viewport, canvas, view, button: $('proceduralCropStart'), toolbar: $('proceduralCropToolbar'),
    progress: $('proceduralCropProgress'), reset: $('proceduralCropReset'),
    cancel: $('proceduralCropCancel'), apply: $('proceduralCropApply'),
    showInput: () => { syncPresentation(); view.reset(); },
    onApply: rect => onCrop(rect), onError,
    onExit: () => { syncPresentation(); if (enabled && mode === 'input') view.render(); }
  });
  const stop = () => { view.dragging = null; viewport.classList.remove('is-panning'); };
  viewport.addEventListener('wheel', event => {
    if (!crop.active && !(enabled && mode === 'input')) return;
    event.preventDefault();
    const bounds = viewport.getBoundingClientRect(), before = view.scale;
    const fit = Math.min((bounds.width - 24) / canvas.width, (bounds.height - 24) / canvas.height);
    view.scale = Math.max(fit * .35, Math.min(Math.max(64, fit * 12), before * (event.deltaY < 0 ? 1.12 : .89)));
    const factor = view.scale / before - 1;
    view.offsetX -= (event.clientX - bounds.left - bounds.width / 2 - view.offsetX) * factor;
    view.offsetY -= (event.clientY - bounds.top - bounds.height / 2 - view.offsetY) * factor;
    view.render();
  }, { passive: false });
  viewport.addEventListener('pointerdown', event => {
    if ((!crop.active && !(enabled && mode === 'input')) || event.target.closest('button')) return;
    if (!(view.canPan ? view.canPan(event) : event.button === 0 || event.button === 1)) return;
    event.preventDefault(); view.dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId); viewport.classList.add('is-panning');
  });
  viewport.addEventListener('pointermove', event => {
    if (!view.dragging || event.pointerId !== view.dragging.id) return;
    view.offsetX += event.clientX - view.dragging.x; view.offsetY += event.clientY - view.dragging.y;
    view.dragging.x = event.clientX; view.dragging.y = event.clientY; view.render();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(name, stop);
  const resize = new ResizeObserver(() => { if (crop.active || (enabled && mode === 'input')) view.render(); }); resize.observe(viewport);
  tabs.addEventListener('click', event => {
    const button = event.target.closest('[data-preview-map]');
    if (!button || button.disabled) return;
    crop.cancel(); mode = button.dataset.previewMap; apply();
    if (mode === 'input') view.reset();
  });
  return {
    setMap, setFile, clear,
    updatePhysical() { for (const [key, texture] of textures) configure(texture, key); },
    enable(value) { enabled = value; tabs.hidden = !value; if (!value) { crop.cancel(); mode = 'material'; } apply(); },
    async setSource(file) {
      const version = ++sourceVersion;
      source = null; crop.cancel(); $('proceduralCropStart').disabled = true; apply();
      const bitmap = await createImageBitmap(file);
      if (disposed || sourceVersion !== version) { bitmap.close(); return; }
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
      source = file; $('proceduralCropStart').disabled = false; apply();
    },
    clearSource() { sourceVersion++; source = null; crop.cancel(); canvas.width = canvas.height = 0; $('proceduralCropStart').disabled = true; apply(); },
    startCrop() {
      if (!enabled || !source || crop.active) return;
      $('proceduralCropStart').click();
    },
    cancelCrop() { crop.cancel(); },
    get cropping() { return crop.active; },
    get showingInput() { return enabled && mode === 'input'; },
    dispose() {
      disposed = true; sourceVersion++; crop.cancel(); resize.disconnect();
      for (const key of textures.keys()) clear(key);
      display.dispose(); canvas.width = canvas.height = 0;
    }
  };
}
