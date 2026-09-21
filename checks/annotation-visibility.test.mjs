import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three/build/three.module.js';
import { prepareAnnotationPicking, AnnotationOcclusion } from '../shared/annotation-visibility.js';

test('accelerated visibility agrees with full geometry for surface and hidden markers', () => {
  const model = new T.Group(), mesh = new T.Mesh(new T.SphereGeometry(2, 160, 120), new T.MeshBasicMaterial());
  model.add(mesh); mesh.scale.set(1.2, .8, 1.3); mesh.rotation.y = .4; model.updateMatrixWorld(true);
  const camera = new T.PerspectiveCamera(); camera.position.set(0, 0, 8); camera.updateMatrixWorld();
  const occlusion = new AnnotationOcclusion();
  const points = Array.from({ length: 32 }, (_, i) => new T.Vector3(Math.sin(i / 32 * Math.PI * 2) * 2, 0, Math.cos(i / 32 * Math.PI * 2) * 2).applyMatrix4(mesh.matrixWorld));
  const expected = points.map(point => occlusion.isOccluded(point, camera, [mesh]));
  assert.ok(expected.includes(true) && expected.includes(false));
  const index = mesh.geometry.index.array.slice();
  prepareAnnotationPicking(model);
  assert.deepEqual(mesh.geometry.index.array, index, 'Triangle IDs must stay stable for decals');
  assert.deepEqual(points.map(point => occlusion.isOccluded(point, camera, [mesh])), expected);
  assert.equal(mesh.geometry.boundsTree, undefined, 'Rendering geometry is not modified');
  mesh.geometry.dispose();
});

test('invisible front material does not suppress a visible occluder behind it', () => {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([-2,-2,2,2,-2,2,0,2,2, -2,-2,1,2,-2,1,0,2,1], 3));
  geometry.addGroup(0, 3, 0); geometry.addGroup(3, 3, 1);
  const materials = [new T.MeshBasicMaterial(), new T.MeshBasicMaterial()]; materials[0].visible = false;
  const mesh = new T.Mesh(geometry, materials); mesh.updateMatrixWorld(); prepareAnnotationPicking(mesh);
  const camera = new T.PerspectiveCamera(); camera.position.set(0, 0, 5);
  const occlusion = new AnnotationOcclusion();
  assert.equal(occlusion.isOccluded(new T.Vector3(0, 0, 0), camera, [mesh]), true);
  materials[1].visible = false;
  assert.equal(occlusion.isOccluded(new T.Vector3(0, 0, 0), camera, [mesh]), false);
});

test('deformed geometry retains native raycasting', () => {
  const mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial()), native = mesh.raycast;
  mesh.geometry.morphAttributes.position = [mesh.geometry.attributes.position.clone()];
  prepareAnnotationPicking(mesh);
  assert.equal(mesh.raycast, native); assert.equal(mesh.geometry.boundsTree, undefined);
});
