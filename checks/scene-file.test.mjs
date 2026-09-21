import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVIRONMENT_DEFAULTS, packScene, unpackScene, sceneFilename } from '../shared/scene-file.js';

const file = data => new Blob([JSON.stringify(data)]);
const document = scene => ({ format: 'SPENIC-SCENE', version: 1, name: '深色暖光', scene });

test('scene roundtrip includes all environment settings and excludes model and camera data', async () => {
  const scene = { preset: 'night', backgroundColor: '#123456', exposure: 1.75, environment: 2.2, keyLight: 6.3, lightAngle: -72, lightColor: '#ffeeaa', fillLight: 2.4, shadows: false, reflection: false, floorVisible: false, grid: true };
  const blob = packScene({ ...scene, rotation: 90, scale: 2, autoRotate: true, renderMode: 'wire', model: {}, materials: [1], camera: {} }, ' 深色暖光 ');
  assert.deepEqual(JSON.parse(await blob.text()), document(scene));
  assert.deepEqual(await unpackScene(blob), { name: '深色暖光', scene });
  assert.ok(blob.size < 2048);
});

test('invalid fields, malformed files and unsupported versions are rejected', async () => {
  for (const [key, value] of [['exposure', 9], ['exposure', '1.1'], ['environment', -1], ['keyLight', null], ['lightAngle', 181], ['fillLight', 6], ['preset', 'unknown'], ['backgroundColor', 'red'], ['lightColor', '#xyzxyz'], ['shadows', 1], ['reflection', null], ['floorVisible', 'true'], ['grid', undefined]]) {
    await assert.rejects(unpackScene(file(document({ ...ENVIRONMENT_DEFAULTS, [key]: value }))), /场景参数无效/);
  }
  for (const data of [null, [], { format: 'FORM', version: 1 }, { ...document(ENVIRONMENT_DEFAULTS), version: 2 }, document(null)]) await assert.rejects(unpackScene(file(data)));
  await assert.rejects(unpackScene(new Blob(['not json'])), /JSON/);
  await assert.rejects(unpackScene(new Blob([' '.repeat(1024 * 1024 + 1)])), /1 MB/);
  assert.throws(() => packScene({ ...ENVIRONMENT_DEFAULTS, exposure: NaN }), /场景参数无效/);
});

test('only known settings are imported and names are safe for downloads', async () => {
  assert.deepEqual((await unpackScene(file(document({ ...ENVIRONMENT_DEFAULTS, scale: 99, materials: [1] })))).scene, ENVIRONMENT_DEFAULTS);
  assert.equal(sceneFilename('暖光/测试:*'), '暖光_测试__.formscene');
  assert.equal(sceneFilename('  '), '未命名场景.formscene');
  assert.equal((await unpackScene(packScene(ENVIRONMENT_DEFAULTS, ' '))).name, '未命名场景');
});
