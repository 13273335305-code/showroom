import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVIRONMENT_DEFAULTS } from '../shared/scene-file.js';
import { defaultDeveloperSettings, loadDeveloperSettings, saveDeveloperSettings, readDeveloperSettings, readTiming } from '../shared/developer-settings.js';
import { createShowroomLoop } from '../shared/showroom-cycle.js';

test('developer configuration persists isolated daylight scenes and timing, rejecting corrupt input', () => {
  let raw = null;
  const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  const value = defaultDeveloperSettings();
  value.presets.morning = { name: '清晨', scene: { ...ENVIRONMENT_DEFAULTS, exposure: .8, rotation: 99 } };
  value.timing = { transition: 1200, hold: 4500 };
  saveDeveloperSettings(storage, value);
  const restored = loadDeveloperSettings(storage);
  assert.equal(restored.presets.morning.scene.exposure, .8);
  assert.equal('rotation' in restored.presets.morning.scene, false);
  assert.deepEqual(restored.timing, value.timing);
  assert.throws(() => readDeveloperSettings({ ...value, version: 2 }));
  assert.throws(() => readDeveloperSettings({ ...value, presets: { morning: { scene: {} } } }));
  for (const timing of [{ transition: NaN, hold: 0 }, { transition: 0, hold: 0 }, { transition: 5000, hold: -1 }, { transition: 121000, hold: 1 }, { transition: 100, hold: 600001 }]) assert.throws(() => readTiming(timing));
  assert.deepEqual(readTiming({ transition: 100, hold: 0 }), { transition: 100, hold: 0 });
  assert.throws(() => saveDeveloperSettings({ setItem() { throw new Error('QuotaExceeded'); } }, value), /QuotaExceeded/);
  raw = '{broken'; assert.throws(() => loadDeveloperSettings(storage));
});

test('showroom reads updated timing for subsequent transitions and holds without restarting', () => {
  let timing = { transition: 2100, hold: 700 }, queued;
  const transitions = [], waits = [];
  const loop = createShowroomLoop({ timing: () => timing, transition: value => transitions.push(value), cancelTransition() {}, schedule: (fn, ms) => { queued = fn; waits.push(ms); return 1; }, unschedule() {} });
  loop.start(); assert.equal(transitions[0].duration, 2100);
  timing = { transition: 4200, hold: 900 };
  transitions[0].onComplete(); assert.equal(waits[0], 900);
  queued(); assert.equal(transitions[1].duration, 4200);
  loop.stop(); transitions[1].onComplete(); assert.equal(waits.length, 1);
});
