import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationId, annotationChanges, applyShowcaseConfig, updatePresentationConfig, validateComment } from '../shared/showcase-data.js';

const manifest = { files: { model: { hash: 'a'.repeat(64) } }, modelPath: 'model', scene: { exposure: 1, keyLight: 3 }, camera: { position: [1, 2, 3], target: [0, 0, 0] },
  annotations: [{ host: 0, point: [1, 2, 3], text: '设计标记' }], materials: [{ color: 'ff0000' }] };
test('presentation overrides preserve current design materials and untouched annotations', () => {
  const id = annotationId(manifest.annotations[0], 0);
  const config = { modelHash: 'a'.repeat(64), scene: { exposure: 1.4 }, annotations: { [id]: { text: '展示文字' }, extra: { host: 0, point: [0, 1, 0], text: '新增' } } };
  const result = applyShowcaseConfig(manifest, config);
  assert.equal(result.scene.keyLight, 3); assert.equal(result.scene.exposure, 1.4); assert.equal(result.annotations[0].text, '展示文字');
  assert.equal(result.annotations.length, 2); assert.equal(manifest.annotations[0].text, '设计标记');
  const latest = structuredClone(manifest); latest.materials[0].color = '00ff00';
  assert.equal(applyShowcaseConfig(latest, config).materials[0].color, '00ff00');
  latest.files.model.hash = 'b'.repeat(64); assert.equal(applyShowcaseConfig(latest, config).annotations[0].text, '设计标记');
});
test('unchanged annotation property order creates no frozen override', () => {
  const a = manifest.annotations[0]; assert.deepEqual(annotationChanges([a], [{ id: annotationId(a), host: a.host, point: a.point, text: a.text }]), {});
  assert.deepEqual(annotationChanges([a], []), { [annotationId(a)]: null });
});
test('only edited presentation properties override future design updates', () => {
  const loaded = { scene: manifest.scene, camera: manifest.camera, annotations: applyShowcaseConfig(manifest).annotations };
  assert.deepEqual(updatePresentationConfig(manifest, loaded, loaded), {});
  const current = structuredClone(loaded); current.scene.exposure = 1.8;
  assert.deepEqual(updatePresentationConfig(manifest, loaded, current), { scene: { exposure: 1.8 } });
  const previous = { scene: { exposure: 1.8 } }; const reset = structuredClone(current); reset.scene.exposure = 1;
  assert.deepEqual(updatePresentationConfig(manifest, current, reset, previous), {});
});
test('comment input checks identity, finite model positions and plain text lengths', () => {
  const value = { projectId: '11111111-1111-1111-1111-111111111111', requestId: '22222222-2222-2222-2222-222222222222', authorName: ' 客户甲 ', body: '<img onerror=alert(1)>', modelHash: 'a'.repeat(64), host: 0, point: [1, 2, 3] };
  assert.equal(validateComment(value).authorName, '客户甲'); assert.equal(validateComment(value).body, value.body);
  for (const bad of [{ authorName: '' }, { body: 'x'.repeat(301) }, { point: [Infinity, 0, 0] }, { point: ['1', 0, 0] }, { projectId: 'forged' }, { host: -1 }]) assert.throws(() => validateComment({ ...value, ...bad }));
});
