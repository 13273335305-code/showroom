import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraMotion, INTRO_DURATION, INTRO_DISTANCE_RATIO } from '../shared/camera-motion.js';
import { createShowroomLoop, SHOWROOM_TRANSITION, SHOWROOM_HOLD } from '../shared/showroom-cycle.js';
import { createShowroom } from '../shared/showroom.js';

test('opening pulls away monotonically, slows down, and reaches the exact default view at 1 second', () => {
  const distances = []; let finished = 0;
  const motion = createCameraMotion({ now: () => 100, render: p => distances.push(INTRO_DISTANCE_RATIO + (1 - INTRO_DISTANCE_RATIO) * p), finish: () => finished++ });
  for (let t = 0; t <= INTRO_DURATION; t += 100) motion.update(100 + t);
  assert.equal(distances[0], .55); assert.equal(distances.at(-1), 1); assert.equal(finished, 1);
  const steps = distances.slice(1).map((value, i) => value - distances[i]);
  assert.ok(steps.every(step => step > 0));
  assert.ok(steps.slice(1).every((step, i) => step < steps[i]));
  motion.update(2100); assert.equal(distances.length, 11);
});

test('camera interruption stops future movement and reduced motion reaches the endpoint immediately', () => {
  const frames = []; let finished = 0;
  const motion = createCameraMotion({ now: () => 0, render: p => frames.push(p), finish: () => finished++ });
  motion.update(200); motion.cancel(); motion.cancel(); motion.update(1000);
  assert.equal(frames.length, 1); assert.equal(finished, 1);
  createCameraMotion({ duration: 0, render: p => frames.push(p) }).update();
  assert.equal(frames.at(-1), 1);
});

test('showroom waits 3 seconds after a 5 second transition and cancels old sessions on restart', () => {
  const transitions = [], timers = new Map(); let timerId = 0, cancels = 0;
  const loop = createShowroomLoop({ transition: options => transitions.push(options), cancelTransition: () => cancels++, schedule: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, unschedule: id => timers.delete(id) });
  loop.start(); assert.equal(transitions.length, 1); assert.equal(transitions[0].duration, 5000); assert.equal(SHOWROOM_TRANSITION, 5000);
  assert.equal(timers.size, 0, 'No hold timer before the transition has completed');
  transitions[0].onComplete(); assert.equal(timers.get(1).ms, 3000); assert.equal(SHOWROOM_HOLD, 3000);
  const next = timers.get(1).fn; timers.delete(1); next(); assert.equal(transitions.length, 2);
  loop.stop(); transitions[1].onComplete(); assert.equal(timers.size, 0);
  loop.start(); next(); transitions[0].onComplete();
  assert.equal(transitions.length, 3); assert.equal(timers.size, 0, 'Stale callbacks cannot start another loop');
  transitions[2].onComplete(); assert.equal(timers.size, 1); loop.stop(); assert.equal(timers.size, 0); assert.ok(cancels >= 4);
});

function showroomHarness({ fullscreen = false } = {}) {
  const listeners = new Map(), classes = new Set(), attributes = new Map();
  const elements = [{ inert: false }, { inert: true }];
  let finishFullscreen, requestCount = 0, exitCount = 0, entered = 0, restored = 0, cancelled = 0;
  const doc = {
    body: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } },
    querySelectorAll: () => elements,
    addEventListener: (name, fn) => listeners.set(name, fn),
    fullscreenElement: fullscreen ? {} : null,
    documentElement: { requestFullscreen() { requestCount++; return new Promise(resolve => { finishFullscreen = () => { doc.fullscreenElement = {}; resolve(); }; }); } },
    exitFullscreen() { exitCount++; doc.fullscreenElement = null; return Promise.resolve(); }
  };
  const original = globalThis.document; globalThis.document = doc;
  const button = { setAttribute: (name, value) => attributes.set(name, value), focus() {} };
  const snapshot = { autoRotate: false, scene: 'custom' };
  const mode = createShowroom({ button, ready: () => true, capture: () => snapshot, enter: () => entered++, restore: value => { assert.equal(value, snapshot); restored++; }, cycle: () => ({ next() {}, cancel() { cancelled++; } }), notify() {} });
  return { button, mode, doc, elements, attributes, classes, listeners, complete: () => finishFullscreen(), counts: () => ({ requestCount, exitCount, entered, restored, cancelled }), cleanup: () => { mode.exit(); globalThis.document = original; } };
}

test('showroom restores inert states and settings on Escape, and cleans up a late fullscreen request', async () => {
  const h = showroomHarness();
  try {
    h.button.onclick(); assert.equal(h.mode.active, true); assert.ok(h.elements.every(element => element.inert));
    assert.equal(h.attributes.get('aria-pressed'), 'true'); assert.ok(h.classes.has('showroom-mode'));
    h.listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(h.mode.active, false); assert.deepEqual(h.elements.map(element => element.inert), [false, true]);
    h.complete(); await Promise.resolve();
    assert.equal(h.doc.fullscreenElement, null); assert.equal(h.counts().restored, 1); assert.equal(h.counts().exitCount, 1);
  } finally { h.cleanup(); }
});

test('exiting browser fullscreen exits showroom; pre-existing fullscreen is preserved', async () => {
  const h = showroomHarness();
  try {
    h.button.onclick(); h.complete(); await Promise.resolve();
    h.doc.fullscreenElement = null; h.listeners.get('fullscreenchange')();
    assert.equal(h.mode.active, false); assert.equal(h.counts().restored, 1);
  } finally { h.cleanup(); }
  const existing = showroomHarness({ fullscreen: true });
  try {
    existing.button.onclick(); existing.button.onclick();
    assert.equal(existing.counts().requestCount, 0); assert.equal(existing.counts().exitCount, 0); assert.ok(existing.doc.fullscreenElement);
  } finally { existing.cleanup(); }
});
