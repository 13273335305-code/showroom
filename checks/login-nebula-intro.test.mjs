import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as Three from '../vendor/three/build/three.module.js';
import { easeOutCamera } from '../shared/camera-motion.js';
import { introHelloOpacity } from '../shared/login-intro.js';

// Exercise the real scene and render loop with a controlled clock, without a GPU.
const source = fs.readFileSync(new URL('../shared/login-nebula.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export function mountLoginNebula', 'function mountLoginNebula');
function setup({ reduced = false, failRenderer = false } = {}) {
  let now = 0, serial = 0, state;
  const pending = new Map(), progress = [], ready = [];
  const target = () => ({ handlers: new Map(), addEventListener(k, f) { this.handlers.set(k, f); }, removeEventListener(k) { this.handlers.delete(k); } });
  const motion = Object.assign(target(), { matches: reduced });
  const span = {}, path = { setAttribute() {} };
  const toggle = Object.assign(target(), { setAttribute() {}, querySelector(k) { return k === 'span' ? span : path; } });
  const canvas = Object.assign(target(), { dataset: {}, style: {}, getBoundingClientRect() { return { width: 1440, height: 960 }; } });
  const document = Object.assign(target(), { hidden: false });
  class Renderer {
    constructor() { if (failRenderer) throw new Error('GPU unavailable'); }
    setPixelRatio() {} setSize() {} dispose() {} forceContextLoss() {}
    render(scene, camera) {
      const shader = { uniforms: {}, vertexShader: 'gl_PointSize = size;\n#include <color_vertex>\n#include <begin_vertex>', fragmentShader: 'vec4 diffuseColor = vec4( diffuse, opacity );' };
      scene.children[0].material.onBeforeCompile(shader);
      assert.match(shader.vertexShader, /sizes \* introScale/);
      state = { zoom: camera.position.z, size: shader.uniforms.introScale.value, angle: scene.children[0].rotation.y };
    }
  }
  const mount = new Function('THREE', 'easeOutCamera', 'matchMedia', 'devicePixelRatio', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'document', 'window', 'performance', source + '\nreturn mountLoginNebula;')(
    { ...Three, WebGLRenderer: Renderer }, easeOutCamera, query => query.includes('reduced') ? motion : { matches: false }, 1,
    class { observe() {} disconnect() {} }, f => { pending.set(++serial, f); return serial; }, id => pending.delete(id), document, target(), { now: () => now });
  const instance = mount(canvas, toggle, {
    onIntroProgress: (value, elapsedMs) => progress.push({ value, elapsedMs }),
    onReady: () => ready.push(state ? { ...state } : null),
  });
  const advance = ms => { now += ms; const jobs = [...pending.values()]; pending.clear(); jobs.forEach(f => f(now)); };
  return { get state() { return state; }, advance, progress, ready, motion, canvas, document, pending, instance, toggle: () => toggle.handlers.get('click')() };
}

test('3.5-second intro exposes the final 1.3 seconds for foreground fade and settles continuously', () => {
  const a = setup();
  assert.equal(a.state.zoom, 77); assert.equal(a.state.size, .24);
  assert.deepEqual(a.ready, [a.state], 'Dismiss loading only after the first frame has rendered');
  a.advance(1750); assert.equal(a.progress.at(-1).value, .5); assert.equal(a.progress.at(-1).elapsedMs, 1750); assert.ok(a.state.zoom > 24);
  a.advance(875); assert.equal(a.progress.at(-1).value, .75); assert.ok(a.state.size < 1);
  a.advance(875); assert.equal(a.progress.at(-1).value, 1); assert.equal(a.progress.at(-1).elapsedMs, 3500); assert.equal(a.state.zoom, 24); assert.equal(a.state.size, 1);
  const angle = a.state.angle, count = a.progress.length;
  a.advance(1000); assert.ok(Math.abs(a.state.angle - angle - .055) < 1e-10);
  assert.equal(a.progress.length, count, 'Stop foreground updates once fully revealed');
  assert.equal(a.ready.length, 1, 'Signal readiness once instead of every frame');
  a.instance.dispose(); assert.equal(a.pending.size, 0);
});

test('pause and hidden tabs preserve the shared intro timeline', () => {
  const a = setup(); a.advance(1750);
  const frozen = { ...a.state };
  a.toggle(); a.advance(10000); assert.deepEqual(a.state, frozen);
  a.toggle(); a.advance(1000); assert.equal(a.progress.at(-1).value, 2750 / 3500);
  a.document.hidden = true; a.document.handlers.get('visibilitychange')(); a.advance(10000);
  assert.equal(a.progress.at(-1).value, 2750 / 3500);
  a.document.hidden = false; a.document.handlers.get('visibilitychange')(); a.advance(1000);
  assert.equal(a.progress.at(-1).value, 1); a.instance.dispose();
});

test('reduced motion and failed graphics always reveal the foreground', () => {
  const a = setup({ reduced: true });
  assert.deepEqual(a.ready, [a.state], 'Reduced motion renders a static frame before dismissing loading');
  assert.equal(a.progress.at(-1).value, 1); assert.equal(a.progress.at(-1).elapsedMs, 3500); assert.equal(a.state.zoom, 24); assert.equal(a.pending.size, 0); a.instance.dispose();
  const b = setup(); b.advance(1000); b.motion.matches = true; b.motion.handlers.get('change')();
  assert.equal(b.progress.at(-1).value, 1); assert.equal(b.progress.at(-1).elapsedMs, 3500); assert.equal(b.state.zoom, 24); b.instance.dispose();
  const c = setup({ failRenderer: true }); assert.equal(c.progress.at(-1).value, 1); assert.equal(c.progress.at(-1).elapsedMs, 3500);
  assert.deepEqual(c.ready, [null], 'Unavailable graphics must also dismiss loading'); c.instance.dispose();
  const d = setup(); d.advance(1000); d.canvas.handlers.get('webglcontextlost')({ preventDefault() {} });
  assert.equal(d.progress.at(-1).value, 1); assert.equal(d.progress.at(-1).elapsedMs, 3500); assert.equal(d.pending.size, 0); d.instance.dispose();
});

test('foreground opacity advances from 2.2s to 3.5s without fading the glass parent', () => {
  const authSource = fs.readFileSync(new URL('../shared/auth.js', import.meta.url), 'utf8');
  const begin = authSource.indexOf('  const overlay = overlayMarkup();', authSource.indexOf('function mountOverlay()'));
  const end = authSource.indexOf('  const previousFocus', begin);
  const element = () => ({ style: {}, inert: false, classList: { contains: () => false } });
  const header = element(), shell = element(), welcome = element(), card = element(), footer = element(), hello = element();
  const background = element(); background.classList.contains = name => name === 'auth-background';
  const overlay = { dataset: {}, children: [background, hello, header, shell, footer], querySelector: selector => selector === '.auth-intro-hello' ? hello : null, querySelectorAll: () => [header, welcome, card, footer] };
  const reveal = new Function('overlayMarkup', 'introHelloOpacity', authSource.slice(begin, end) + '\nreturn revealForeground;')(() => overlay, introHelloOpacity);
  for (const [seconds, opacity] of [[0, 0], [2.19, 0], [2.2, 0], [2.85, .5], [3.49, .9923076923], [3.5, 1]]) {
    reveal(seconds / 3.5, seconds * 1000);
    for (const item of [header, welcome, card, footer]) assert.ok(Math.abs(Number(item.style.opacity) - opacity) < 1e-10);
    assert.equal(shell.style.opacity, undefined, 'Glass ancestor opacity must remain unchanged');
    assert.equal(background.style.opacity, undefined, 'Background never fades');
    assert.equal(shell.inert, seconds < 3.5, 'Hidden form becomes interactive after the reveal');
  }
  assert.equal(overlay.dataset.authIntro, 'complete');
  reveal(.7, 2450); assert.equal(card.style.opacity, '1', 'Later updates cannot hide a revealed form');
});

test('Hello stays visible through 1.2s and fades completely by 2s', () => {
  assert.equal(introHelloOpacity(0), 1);
  assert.equal(introHelloOpacity(1200), 1);
  assert.ok(Math.abs(introHelloOpacity(1600) - .5) < 1e-10);
  assert.equal(introHelloOpacity(2000), 0);
  assert.equal(introHelloOpacity(3500), 0);
  assert.equal(introHelloOpacity(-1), 1);
});
