// CPU-only benchmark against the actual FBX. Texture loading is intentionally omitted.
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as T from '../vendor/three/build/three.module.js';
import { prepareAnnotationPicking, AnnotationOcclusion } from '../shared/annotation-visibility.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){if(s==='three')return {url:${JSON.stringify(new URL('../vendor/three/build/three.module.js', import.meta.url).href)},shortCircuit:true};return next(s,c);}`), import.meta.url);
const { FBXLoader } = await import('../vendor/three/addons/loaders/FBXLoader.js');
T.TextureLoader.prototype.load = () => new T.Texture();
const data = await readFile(new URL('../MM06-展厅版.fbx', import.meta.url));
const model = new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
model.updateMatrixWorld(true);
const meshes = []; let triangles = 0;
model.traverse(o => { if (o.isMesh) { meshes.push(o); triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; } });
const bounds = new T.Box3().setFromObject(model), center = bounds.getCenter(new T.Vector3()), radius = bounds.getSize(new T.Vector3()).length();
const camera = new T.PerspectiveCamera(); camera.position.copy(center).add(new T.Vector3(radius, radius, radius));
const points = Array.from({ length: 24 }, (_, i) => {
  const mesh = meshes[i % meshes.length], position = mesh.geometry.attributes.position;
  return new T.Vector3().fromBufferAttribute(position, Math.floor(position.count * (i + .5) / 24)).applyMatrix4(mesh.matrixWorld);
});
const occlusion = new AnnotationOcclusion();
const measure = () => { const start = performance.now(); const results = points.map(p => occlusion.isOccluded(p, camera, meshes)); return { ms: performance.now() - start, results }; };
const native = measure(), buildStart = performance.now(); prepareAnnotationPicking(model); const buildMs = performance.now() - buildStart;
measure(); const accelerated = measure();
assert.deepEqual(accelerated.results, native.results);
console.log(JSON.stringify({ triangles, markers: points.length, nativeMs: native.ms, acceleratedMs: accelerated.ms, speedup: native.ms / accelerated.ms, buildMs }, null, 2));
