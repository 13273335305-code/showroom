import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
import { AnnotationOcclusion, prepareAnnotationPicking } from '../shared/annotation-visibility.js';

test('pointer release restores markers immediately, including during damping, with cached resting occlusion', () => {
  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const updateSource = source.slice(source.indexOf('const annotationCameraPosition='), source.indexOf('function syncAutoRotate()'));
  const model = new THREE.Mesh(new THREE.SphereGeometry(2, 32, 24), new THREE.MeshBasicMaterial());
  model.updateMatrixWorld(true); prepareAnnotationPicking(model);
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100); camera.position.z = 6; camera.updateMatrixWorld();
  const layer = { hidden: false }, viewport = { getBoundingClientRect: () => ({ width: 800, height: 800 }) };
  const annotations = [2, -2].map(z => ({ host: model, point: new THREE.Vector3(0, 0, z), el: { hidden: false, style: {} }, window: { inert: false, style: { setProperty() {} } } }));
  let now = 1000, checks = 0;
  class CountingOcclusion extends AnnotationOcclusion { isOccluded(...args) { checks++; return super.isOccluded(...args); } }
  const controls = { autoRotate: false, enabled: true };
  const controller = new Function('THREE', 'AnnotationOcclusion', 'camera', 'model', 'annotations', '$', 'performance', 'controls', `const cancelDraftAnnotation=()=>{};let annotationMoving=false,cameraTween=null;${updateSource};return {update:updateAnnotations,moving:setAnnotationMoving,invalidate:invalidateAnnotations};`)(THREE, CountingOcclusion, camera, model, annotations, id => id === 'annotationLayer' ? layer : viewport, { now: () => now }, controls);
  controller.update(); assert.equal(layer.hidden, false);
  assert.equal(annotations[0].el.hidden, false); assert.equal(annotations[1].el.hidden, true);
  const settledChecks = checks;
  for (let i = 0; i < 120; i++) { now += 17; controller.update(); }
  assert.equal(checks, settledChecks, 'No repeated raycasts while resting');
  controller.moving(true);
  for (let i = 0; i < 60; i++) { now += 17; camera.position.x += .01; controller.update(); assert.equal(layer.hidden, true); }
  assert.equal(checks, settledChecks, 'No raycasts throughout movement');
  controller.moving(false); assert.equal(layer.hidden, false, 'Release restores without advancing the clock'); assert.ok(checks > settledChecks);
  for (let i = 0; i < 30; i++) {
    now += 17; camera.position.x += .01 * (1 - i / 30); controller.update();
    assert.equal(layer.hidden, false, 'Remaining inertia must not hide markers again');
  }
  const afterOrbit = checks;
  model.rotation.y = Math.PI; now += 17; controller.update(); assert.equal(layer.hidden, false); assert.ok(checks > afterOrbit);
  assert.equal(annotations[0].el.hidden, true); assert.equal(annotations[1].el.hidden, false);
  camera.aspect = 2; camera.updateProjectionMatrix(); now += 17; controller.update(); assert.equal(layer.hidden, false);
  controls.autoRotate = true; controller.update(); assert.equal(layer.hidden, true);
  controls.autoRotate = false; controller.update(); assert.equal(layer.hidden, false);
});
