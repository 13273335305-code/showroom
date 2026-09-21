import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// One disposable renderer per queued preview; no animation loop or model mutation.
export async function createModelPreview(asset) {
  const urls = new Set(), resources = new Map((asset.resources || []).map(file => [file.name.split(/[\\/]/).pop().toLowerCase(), file]));
  const manager = new THREE.LoadingManager();
  const placeholder = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Xf6QAAAAAElFTkSuQmCC';
  manager.setURLModifier(url => {
    if (url.startsWith('data:')) return url;
    if (url.startsWith('blob:')) { urls.add(url); return url; }
    const file = resources.get(decodeURIComponent(url.replace(/\\/g, '/').split('/').pop()).toLowerCase());
    if (!file) return placeholder;
    const result = URL.createObjectURL(file); urls.add(result); return result;
  });
  let object, renderer;
  try {
    const buffer = await asset.file.arrayBuffer();
    const ready = new Promise(resolve => { manager.onLoad = resolve; });
    manager.itemStart('preview');
    try { object = new FBXLoader(manager).parse(buffer, ''); }
    finally { manager.itemEnd('preview'); }
    await ready;
    object.traverse(child => { if (child.isLight || child.isCamera) child.visible = false; });
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) throw new Error('模型没有可见几何体');
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(longest) || longest <= 0) throw new Error('模型尺寸无效');
    const group = new THREE.Group(); group.add(object); group.scale.setScalar(2 / longest);
    object.position.sub(center);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#e5edf5'); scene.add(group);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8192a6, 2.6));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 5, 4); scene.add(light);
    const camera = new THREE.PerspectiveCamera(36, 2, .01, 100);
    const radius = size.length() / longest;
    camera.position.copy(new THREE.Vector3(1.1, .65, 1.35).normalize().multiplyScalar(radius / Math.sin(THREE.MathUtils.degToRad(18)) * 1.08));
    camera.lookAt(0, 0, 0);
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(640, 320); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.render(scene, camera);
    const blob = await new Promise(resolve => renderer.domElement.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('无法生成模型预览图');
    return blob;
  } finally {
    const disposed = new Set();
    const dispose = resource => { if (resource && !disposed.has(resource)) { disposed.add(resource); resource.dispose(); } };
    object?.traverse(child => {
      dispose(child.geometry); dispose(child.skeleton);
      for (const material of child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : []) {
        for (const value of Object.values(material)) if (value?.isTexture) dispose(value);
        dispose(material);
      }
    });
    renderer?.dispose(); renderer?.forceContextLoss(); urls.forEach(url => URL.revokeObjectURL(url));
  }
}
