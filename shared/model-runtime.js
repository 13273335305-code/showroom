import * as THREE from '../vendor/three/build/three.module.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from '../vendor/three/addons/libs/fflate.module.js';
import { preparePhysicalUV } from '../physical-textures.js';
import { prepareAnnotationPicking, serializeAnnotationPicking } from './annotation-visibility.js';
import { MATERIAL_MAPS } from './material-map-definitions.js';

export const MODEL_RUNTIME_VERSION = 1;
const LIMIT = 512 * 1024 * 1024;
const typedArrays = { Float32Array, Float64Array, Uint32Array, Uint16Array, Uint8Array, Uint8ClampedArray, Int32Array, Int16Array, Int8Array };
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

// Lossless byte shuffle groups equal-significance bytes for ZIP compression.
// Float precision and vertex order remain unchanged after decoding.
function shuffleBytes(bytes, width, decode = false) {
  if (width <= 1) return bytes;
  const result = new Uint8Array(bytes.length), count = bytes.length / width;
  for (let byte = 0; byte < width; byte++) for (let index = 0; index < count; index++) {
    if (decode) result[index * width + byte] = bytes[byte * count + index];
    else result[byte * count + index] = bytes[index * width + byte];
  }
  return result;
}

function compactGeometry(geometry, mergeVertices) {
  if (Object.values(geometry.attributes).some(attribute => attribute.itemSize > 4)) return geometry;
  const compact = mergeVertices(geometry, 1e-6), count = geometry.index?.count || geometry.attributes.position.count;
  const attributes = [...Object.entries(geometry.attributes).map(([key, value]) => [value, compact.attributes[key]]), ...Object.entries(geometry.morphAttributes).flatMap(([key, values]) => values.map((value, index) => [value, compact.morphAttributes[key][index]]))];
  // mergeVertices uses tolerant hashes. Accept its result only when every
  // component is bit-for-bit equal in the original triangle order.
  for (let i = 0; i < count; i++) {
    const from = geometry.index ? geometry.index.getX(i) : i, to = compact.index.getX(i);
    for (const [original, next] of attributes) for (let component = 0; component < original.itemSize; component++) {
      if (!Object.is(original.array[from * original.itemSize + component], next.array[to * next.itemSize + component])) { compact.dispose(); return geometry; }
    }
  }
  return compact;
}

export function cloneSourceModel(source) {
  const object = source.clone(true), originals = [], copies = [], materials = new Map();
  source.traverse(node => originals.push(node)); object.traverse(node => copies.push(node));
  const nodes = new Map(originals.map((node, index) => [node, copies[index]]));
  for (let i = 0; i < originals.length; i++) {
    const from = originals[i], to = copies[i];
    if (!from.isMesh) continue;
    const copyMaterial = material => {
      if (!materials.has(material)) materials.set(material, material.clone());
      return materials.get(material);
    };
    to.material = Array.isArray(from.material) ? from.material.map(copyMaterial) : copyMaterial(from.material);
    if (from.isSkinnedMesh) to.skeleton = new THREE.Skeleton(from.skeleton.bones.map(bone => nodes.get(bone)), from.skeleton.boneInverses.map(matrix => matrix.clone()));
  }
  return object;
}

function texturePreview(texture, maxSize, quality = .92) {
  const image = texture.image;
  if (!image?.width || !image?.height || texture.isCompressedTexture || image.data) return null;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function imageBlob(image) {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').drawImage(image, 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('无法保存模型贴图');
  return blob;
}

// GPU compressed textures are decoded once into portable PNGs, never persisted
// in a device-specific GPU format that another browser may not support.
async function compressedImage(texture) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true });
  const map = texture.clone(), geometry = new THREE.PlaneGeometry(2, 2);
  map.offset.set(0, 0); map.repeat.set(1, 1); map.center.set(0, 0); map.rotation = 0; map.channel = 0; map.updateMatrix();
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const material = new THREE.MeshBasicMaterial({ map, toneMapped: false, transparent: true, blending: THREE.NoBlending });
  try {
    renderer.setSize(texture.image.width, texture.image.height, false);
    renderer.outputColorSpace = texture.colorSpace || THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0, 0);
    const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, material));
    renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2));
    const blob = await new Promise(resolve => renderer.domElement.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('无法保存压缩模型贴图');
    return blob;
  } finally { material.dispose(); geometry.dispose(); map.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
}

export async function prepareModelRuntime(source, { name, textureConvention = 'fbx', onProgress = () => {} } = {}) {
  const { mergeVertices } = await import('../vendor/three/addons/utils/BufferGeometryUtils.js');
  const object = cloneSourceModel(source), geometries = new Set(), materials = new Set(), textures = new Map(), overrides = [];
  const archive = {}; let binaryIndex = 0;
  const binary = value => {
    if (!value) return null;
    const path = 'buffers/' + binaryIndex++;
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const shuffle = value instanceof ArrayBuffer ? 4 : value.BYTES_PER_ELEMENT;
    archive[path] = shuffleBytes(bytes, shuffle);
    return { path, type: value instanceof ArrayBuffer ? 'ArrayBuffer' : value.constructor.name, shuffle };
  };
  try {
    object.traverse(node => {
      if (!node.isMesh) return;
      node.geometry = node.geometry.clone(); geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
    });
    onProgress('正在准备模型坐标'); await nextFrame(); preparePhysicalUV(object);
    object.traverse(node => { if (node.isMesh) geometries.add(node.geometry); });
    onProgress('正在整理模型几何'); await nextFrame();
    const compacted = new Map();
    object.traverse(node => {
      if (!node.isMesh) return;
      if (!compacted.has(node.geometry)) compacted.set(node.geometry, compactGeometry(node.geometry, mergeVertices));
      node.geometry = compacted.get(node.geometry); geometries.add(node.geometry);
    });
    onProgress('正在准备模型选取'); await nextFrame(); prepareAnnotationPicking(object);
    const trees = Object.fromEntries([...serializeAnnotationPicking(object)].map(([uuid, tree]) => [uuid, { roots: tree.roots.map(binary), index: binary(tree.index), indirectBuffer: binary(tree.indirectBuffer) }]));
    onProgress('正在准备模型贴图'); await nextFrame();
    for (const material of materials) {
      const thumbnails = {}, previews = {};
      for (const [key] of MATERIAL_MAPS) if (material[key]) {
        thumbnails[key] = texturePreview(material[key], 128, .8); previews[key] = texturePreview(material[key], 2048);
      }
      material.userData.spenicPreviews = { thumbnails, previews };
      for (const texture of Object.values(material)) if (texture?.isTexture) textures.set(texture.uuid, texture);
    }
    // ObjectLoader restores hierarchy and materials. Geometry stays binary so
    // large vertex arrays never expand into JSON numbers during save or load.
    const geometryRecords = [];
    const activeGeometries = new Set(); object.traverse(node => { if (node.isMesh) activeGeometries.add(node.geometry); });
    for (const geometry of geometries) {
      if (!activeGeometries.has(geometry)) continue;
      const attribute = value => {
        if (value.isInterleavedBufferAttribute) value = value.clone();
        return { buffer: binary(value.array), itemSize: value.itemSize, normalized: value.normalized, name: value.name, usage: value.usage, gpuType: value.gpuType };
      };
      geometryRecords.push({ uuid: geometry.uuid, name: geometry.name, index: geometry.index && attribute(geometry.index), attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, value]) => [key, attribute(value)])), morphAttributes: Object.fromEntries(Object.entries(geometry.morphAttributes).map(([key, values]) => [key, values.map(attribute)])), morphTargetsRelative: geometry.morphTargetsRelative, groups: geometry.groups, drawRange: { start: geometry.drawRange.start, count: Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : null }, userData: geometry.userData });
      overrides.push([geometry, geometry.toJSON]); geometry.toJSON = () => ({ uuid: geometry.uuid, type: 'BufferGeometry' });
    }
    const imageRecords = new Map();
    for (const texture of textures.values()) {
      const image = texture.image, source = texture.source;
      if (!image?.width || !image?.height) throw new Error('模型贴图没有有效图像');
      if (!imageRecords.has(source.uuid)) {
        let record;
        if (image.data && !texture.isCompressedTexture) record = { uuid: source.uuid, data: binary(image.data), width: image.width, height: image.height };
        else {
          const blob = texture.isCompressedTexture ? await compressedImage(texture) : await imageBlob(image);
          const path = 'images/' + imageRecords.size + '.png'; archive[path] = new Uint8Array(await blob.arrayBuffer()); record = { uuid: source.uuid, path };
        }
        imageRecords.set(source.uuid, record);
        overrides.push([source, source.toJSON]); source.toJSON = meta => (meta.images[source.uuid] ||= { uuid: source.uuid, url: '' });
      }
    }
    const scene = object.toJSON();
    for (const data of scene.textures || []) if (textures.get(data.uuid)?.isCompressedTexture) {
      data.format = THREE.RGBAFormat; data.type = THREE.UnsignedByteType; data.internalFormat = null; data.generateMipmaps = true;
    }
    const meshStates = {};
    object.traverse(node => { if (node.morphTargetInfluences) meshStates[node.uuid] = { influences: node.morphTargetInfluences, dictionary: node.morphTargetDictionary }; });
    const textureMatrices = Object.fromEntries([...textures.values()].filter(texture => !texture.matrixAutoUpdate).map(texture => [texture.uuid, texture.matrix.toArray()]));
    const data = { format: 'SPENIC-MODEL-RUNTIME', version: MODEL_RUNTIME_VERSION, name, textureConvention, scene, geometries: geometryRecords, images: [...imageRecords.values()], trees, meshStates, textureMatrices };
    archive['model.json'] = strToU8(JSON.stringify(data));
    if (Object.values(archive).reduce((total, bytes) => total + bytes.byteLength, 0) > LIMIT) throw new Error('运行模型解压后不能超过 512 MB');
    onProgress('正在打包运行模型'); await nextFrame();
    const bytes = zipSync(archive, { level: 1 });
    if (bytes.byteLength > LIMIT) throw new Error('运行模型不能超过 512 MB');
    return new File([bytes], (name || 'model') + '.spmodel', { type: 'application/zip' });
  } finally {
    for (const [target, original] of overrides) target.toJSON = original;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }
}

export async function loadModelRuntime(buffer) {
  let total = 0;
  const archive = unzipSync(new Uint8Array(buffer), { filter: item => {
    total += item.originalSize; if (total > LIMIT) throw new Error('运行模型解压后过大'); return true;
  } });
  if (!archive['model.json']) throw new Error('运行模型缺少清单');
  const data = JSON.parse(strFromU8(archive['model.json']));
  if (data.format !== 'SPENIC-MODEL-RUNTIME' || data.version !== MODEL_RUNTIME_VERSION || !data.scene?.object || !Array.isArray(data.geometries) || !Array.isArray(data.images)) throw new Error('运行模型格式无效');
  const binary = descriptor => {
    if (!descriptor) return null;
    const bytes = archive[descriptor.path]; if (!bytes) throw new Error('运行模型缺少二进制数据');
    const width = descriptor.shuffle || 1;
    if (![1, 2, 4, 8].includes(width) || bytes.length % width) throw new Error('运行模型二进制编码无效');
    const copy = width > 1 ? shuffleBytes(bytes, width, true).buffer : bytes.slice().buffer;
    if (descriptor.type === 'ArrayBuffer') return copy;
    const Type = typedArrays[descriptor.type]; if (!Type || copy.byteLength % Type.BYTES_PER_ELEMENT) throw new Error('运行模型数组类型无效');
    return new Type(copy);
  };
  const geometries = {}, urls = [];
  try {
    for (const record of data.geometries) {
      const geometry = new THREE.BufferGeometry(); geometry.uuid = record.uuid; geometry.name = record.name || ''; geometry.userData = record.userData || {};
      const attribute = record => { const value = new THREE.BufferAttribute(binary(record.buffer), record.itemSize, record.normalized); value.name = record.name || ''; if (record.usage) value.setUsage(record.usage); if (record.gpuType) value.gpuType = record.gpuType; return value; };
      if (record.index) geometry.setIndex(attribute(record.index));
      for (const [key, value] of Object.entries(record.attributes)) geometry.setAttribute(key, attribute(value));
      for (const [key, records] of Object.entries(record.morphAttributes || {})) geometry.morphAttributes[key] = records.map(attribute);
      geometry.morphTargetsRelative = !!record.morphTargetsRelative;
      for (const group of record.groups || []) geometry.addGroup(group.start, group.count, group.materialIndex);
      geometry.setDrawRange(record.drawRange.start, record.drawRange.count ?? Infinity); geometries[geometry.uuid] = geometry;
    }
    data.scene.images = data.images.map(record => {
      if (record.data) return { uuid: record.uuid, url: { data: binary(record.data), type: record.data.type, width: record.width, height: record.height } };
      const bytes = archive[record.path]; if (!bytes) throw new Error('运行模型缺少贴图');
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); urls.push(url); return { uuid: record.uuid, url };
    });
    const loader = new THREE.ObjectLoader(); loader.parseGeometries = () => geometries;
    const object = await loader.parseAsync(data.scene);
    object.traverse(node => {
      const state = data.meshStates?.[node.uuid];
      if (state && node.morphTargetInfluences) { node.morphTargetInfluences = state.influences; node.morphTargetDictionary = state.dictionary; }
      for (const material of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) {
        for (const texture of Object.values(material)) if (texture?.isTexture && data.textureMatrices?.[texture.uuid]) {
          texture.matrixAutoUpdate = false; texture.matrix.fromArray(data.textureMatrices[texture.uuid]);
        }
      }
    });
    const trees = new Map(Object.entries(data.trees || {}).map(([uuid, tree]) => [uuid, { roots: tree.roots.map(binary), index: binary(tree.index), indirectBuffer: binary(tree.indirectBuffer) }]));
    prepareAnnotationPicking(object, trees);
    return { object, missing: [], prepared: true, textureConvention: data.textureConvention };
  } catch (error) { for (const geometry of Object.values(geometries)) geometry.dispose(); throw error; }
  finally { urls.forEach(url => URL.revokeObjectURL(url)); }
}
