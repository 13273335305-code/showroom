import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from '../vendor/three/build/three.module.js';
import { prepareModelRuntime, loadModelRuntime } from '../shared/model-runtime.js';
import { createMaterialPicker } from '../shared/annotation-visibility.js';
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('../vendor/three/build/three.module.js', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });

test('runtime preserves units, UVs, material identity, textures and original geometry while restoring saved selection trees', async t => {
  t.mock.method(globalThis, 'requestAnimationFrame', callback => setTimeout(callback, 0));
  const source = new THREE.Group(); source.userData.unitScaleFactor = 100;
  const geometry = new THREE.BoxGeometry(2, 1, 3), material = new THREE.MeshStandardMaterial({ name: 'Fabric', color: '#ab3456' });
  material.map = new THREE.DataTexture(new Uint8Array([255,0,0,255,0,0,255,255]), 2, 1);
  material.map.colorSpace = THREE.SRGBColorSpace; material.map.flipY = false; material.map.repeat.set(2, 3);
  material.map.matrixAutoUpdate = false; material.map.matrix.set(2, .2, .3, .1, 3, .4, 0, 0, 1);
  const mesh = new THREE.Mesh(geometry, material); mesh.position.set(4, 2, 0); source.add(mesh);
  const second = new THREE.Mesh(geometry, material); second.position.x = -4; source.add(second);
  const before = Array.from(geometry.attributes.position.array), originalSize = new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3());
  const runtime = await prepareModelRuntime(source, { name: 'source.glb', textureConvention: 'gltf' });
  assert.deepEqual(Array.from(geometry.attributes.position.array), before); assert.ok(geometry.index); assert.equal(geometry.attributes.uv2, undefined);
  assert.equal(material.userData.spenicPreviews, undefined);
  const parsed = await loadModelRuntime(await runtime.arrayBuffer());
  assert.equal(parsed.prepared, true); assert.equal(parsed.textureConvention, 'gltf');
  assert.equal(parsed.object.userData.unitScaleFactor, 100);
  assert.deepEqual(new THREE.Box3().setFromObject(parsed.object).getSize(new THREE.Vector3()).toArray(), originalSize.toArray());
  const [first, other] = parsed.object.children;
  assert.equal(first.material, other.material); assert.equal(first.material.color.getHexString(), 'ab3456');
  assert.deepEqual([...first.material.map.image.data], [255,0,0,255,0,0,255,255]);
  assert.equal(first.material.map.flipY, false); assert.deepEqual(first.material.map.repeat.toArray(), [2, 3]);
  assert.equal(first.material.map.matrixAutoUpdate, false); assert.deepEqual(first.material.map.matrix.toArray(), material.map.matrix.toArray());
  assert.ok(first.geometry.attributes.uv2); assert.ok(first.userData.physicalUV.slots[0].valid);
  const camera = new THREE.PerspectiveCamera(36, 1, .01, 100); camera.position.set(4, 2, 10); camera.lookAt(4, 2, 0); camera.updateMatrixWorld();
  parsed.object.updateMatrixWorld(true);
  const hit = createMaterialPicker(parsed.object)(new THREE.Vector2(0, 0), camera);
  assert.equal(hit.object, first, 'Deserialized selection tree hits the original mesh');
  await assert.rejects(loadModelRuntime(new Uint8Array([1,2,3]).buffer));
});

test('morph weights and near-equal vertices survive compaction without precision changes', async () => {
  const source = new THREE.Group(), geometry = new THREE.BufferGeometry();
  const positions = [0,0,0, 1,0,0, 0,1,0, .0000001,0,0, 1,0,0, 0,1,0];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1,0,0,1], 2));
  const morph = new THREE.Float32BufferAttribute(positions.map((value, index) => index % 3 === 2 ? value + .25 : value), 3); morph.name = 'Raised';
  geometry.morphAttributes.position = [morph];
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); mesh.morphTargetInfluences[0] = .75; source.add(mesh);
  const runtime = await prepareModelRuntime(source, { name: 'morph.glb' }), { object } = await loadModelRuntime(await runtime.arrayBuffer()), restored = object.children[0];
  assert.deepEqual(restored.morphTargetInfluences, [.75]); assert.deepEqual(restored.morphTargetDictionary, { Raised: 0 });
  const original = geometry.attributes.position.array, next = restored.geometry.attributes.position.array;
  for (let i = 0; i < 6; i++) for (let component = 0; component < 3; component++) {
    const index = restored.geometry.index ? restored.geometry.index.getX(i) : i;
    assert.equal(next[index * 3 + component], original[i * 3 + component]);
  }
  assert.equal(restored.geometry.morphAttributes.position[0].name, 'Raised');
});

test('source cloning keeps skeletons bound to cloned bones', async t => {
  t.mock.method(globalThis, 'requestAnimationFrame', callback => setTimeout(callback, 0));
  const source = new THREE.Group(), geometry = new THREE.BoxGeometry();
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(geometry.attributes.position.count * 4), 4));
  const weights = new Float32Array(geometry.attributes.position.count * 4); for (let i = 0; i < weights.length; i += 4) weights[i] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial()), bone = new THREE.Bone(); mesh.add(bone); mesh.bind(new THREE.Skeleton([bone])); source.add(mesh);
  const runtime = await prepareModelRuntime(source, { name: 'skin.glb' });
  const { object } = await loadModelRuntime(await runtime.arrayBuffer());
  assert.equal(object.children[0].skeleton.bones[0], object.children[0].children[0]);
  assert.notEqual(object.children[0].skeleton.bones[0], bone);
});
