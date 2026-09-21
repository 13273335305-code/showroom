import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blendScene, sceneAppearance, easeDaylight } from '../shared/scene-cycle.js';
const scenes = await Promise.all(['morning', 'evening', 'night'].map(async name => JSON.parse(await readFile(new URL('../assets/scenes/' + name + '.json', import.meta.url), 'utf8')).scene));

test('day cycle restores supplied scenes exactly and moves light continuously in one direction', () => {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    const from = scenes[i], to = scenes[(i + 1) % 3];
    assert.deepEqual(blendScene(from, to, 0).scene, from);
    assert.deepEqual(blendScene(from, to, 1).scene, to);
    let angle = from.lightAngle;
    for (let frame = 1; frame <= 160; frame++) {
      const next = blendScene(from, to, frame / 160).scene.lightAngle;
      const delta = ((next - angle + 540) % 360) - 180;
      assert.ok(delta <= 1e-9 && delta > -3, 'No light reversal or angular jumps');
      total += delta; angle = next;
    }
  }
  assert.ok(Math.abs(total + 360) < 1e-8);
});

test('night palette and shadows fade; interrupted transitions continue from their current appearance', () => {
  const mid = blendScene(scenes[1], scenes[2], .5);
  assert.equal(mid.appearance.shadow, .5);
  assert.equal(mid.appearance.hemi, .675);
  assert.notEqual(mid.scene.backgroundColor, scenes[1].backgroundColor);
  assert.notEqual(mid.scene.backgroundColor, scenes[2].backgroundColor);
  const redirected = blendScene(mid.scene, scenes[0], 0, mid.appearance);
  assert.deepEqual(redirected, mid);
  assert.deepEqual(blendScene(mid.scene, scenes[0], 1, mid.appearance).appearance, sceneAppearance(scenes[0]));
  assert.ok(easeDaylight(.01) < .00001, 'Gentle start');
  assert.ok(1 - easeDaylight(.99) < .00001, 'Gentle finish');
});
