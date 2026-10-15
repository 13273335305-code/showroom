import * as THREE from '../vendor/three/build/three.module.js';
import { easeOutCamera } from './camera-motion.js';

// Particle shaders adapted from the supplied Particleify Nebula scene.
var NEBULA_VERTEX_HEADER = [
  'uniform float time;',
  'uniform vec3 innerColor;',
  'uniform vec3 outerColor;',
  'uniform float autoColorChange;',
  'uniform float colorChangeSpeed;',
  'uniform float preset;',
  'uniform float introScale;',
  'attribute float sizes;',
  'attribute vec4 shift;',
  'varying vec3 vColor;',
].join('\n');

var NEBULA_COLOR_VERTEX = [
  '#include <color_vertex>',
  'float distanceRatio = length(abs(position) / vec3(40.0, 10.0, 40.0));',
  'distanceRatio = clamp(distanceRatio, 0.0, 1.0);',
  'vec3 activeInner = innerColor;',
  'vec3 activeOuter = outerColor;',
  'if (autoColorChange > 0.5) {',
  '  float colorTime = time * colorChangeSpeed * 0.5;',
  '  activeInner = vec3(0.5 + 0.5 * sin(colorTime), 0.5 + 0.5 * sin(colorTime + 2.094), 0.5 + 0.5 * sin(colorTime + 4.188));',
  '  activeOuter = vec3(0.5 + 0.5 * sin(colorTime + 1.047), 0.5 + 0.5 * sin(colorTime + 3.141), 0.5 + 0.5 * sin(colorTime + 5.235));',
  '}',
  'vColor = mix(activeInner, activeOuter, distanceRatio);',
].join('\n');

var NEBULA_BEGIN_VERTEX = [
  '#include <begin_vertex>',
  'if (preset < 0.5) {',
  '  float moveT = mod(shift.x + shift.z * time, 6.28318530718);',
  '  float moveS = mod(shift.y + shift.z * time, 6.28318530718);',
  '  transformed += vec3(cos(moveS) * sin(moveT), cos(moveT), sin(moveS) * sin(moveT)) * shift.w;',
  '} else if (preset < 1.5) {',
  '  float moveT = mod(shift.x + shift.z * time * 0.3, 6.28318530718);',
  '  float moveS = mod(shift.y + shift.z * time * 0.3, 6.28318530718);',
  '  transformed += vec3(sin(moveS) * 0.5, cos(moveT) * 0.3, cos(moveS) * 0.5) * shift.w;',
  '} else if (preset < 2.5) {',
  '  transformed += vec3(0.0, 0.0, sin(time + shift.x) * 0.1) * shift.w;',
  '} else if (preset < 3.5) {',
  '  float moveT = mod(shift.x + shift.z * time * 2.0, 6.28318530718);',
  '  float moveS = mod(shift.y + shift.z * time * 1.5, 6.28318530718);',
  '  transformed += vec3(sin(moveT) * cos(moveS), cos(moveT), sin(moveS) * sin(moveT)) * shift.w;',
  '} else {',
  '  float angle = shift.x + time * 0.5;',
  '  float radius = length(position.xz);',
  '  transformed.x += cos(angle) * radius * 0.1;',
  '  transformed.z += sin(angle) * radius * 0.1;',
  '  transformed.y += sin(time + shift.y) * 0.2;',
  '}',
].join('\n');

var NEBULA_DIFFUSE_FRAGMENT = [
  'float particleDistance = length(gl_PointCoord.xy - 0.5);',
  'vec4 diffuseColor = vec4(vColor, smoothstep(0.5, 0.1, particleDistance));',
].join('\n');

export function mountLoginNebula(canvas, toggle, { onIntroProgress = () => {} } = {}) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = matchMedia('(max-width: 850px)');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
  } catch {
    toggle.hidden = true;
    onIntroProgress(1, 3500);
    return { dispose() {} };
  }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 1000);
  // Opening pull-in: Initial Zoom 77 → 24 over 3.5 seconds.
  const INTRO_DURATION = 3500, INITIAL_ZOOM = 77, FINAL_ZOOM = 24;
  camera.position.set(0, 4, INITIAL_ZOOM);
  const uniforms = {
    time: { value: 0 }, innerColor: { value: new THREE.Color('#e6b400') },
    outerColor: { value: new THREE.Color('#334bff') }, autoColorChange: { value: 0 },
    colorChangeSpeed: { value: 1 }, preset: { value: 1 }, introScale: { value: 0.24 },
  };
  const material = new THREE.PointsMaterial({ size: 0.075, transparent: true, depthTest: false, blending: THREE.AdditiveBlending });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = (NEBULA_VERTEX_HEADER + '\n' + shader.vertexShader)
      .replace('gl_PointSize = size;', 'gl_PointSize = size * sizes * introScale;')
      .replace('#include <color_vertex>', NEBULA_COLOR_VERTEX)
      .replace('#include <begin_vertex>', NEBULA_BEGIN_VERTEX);
    shader.fragmentShader = ('varying vec3 vColor;\n' + shader.fragmentShader)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', NEBULA_DIFFUSE_FRAGMENT);
  };
  // Preserve the source's spherical nebula distribution and blue/gold gradient.
  const count = 34000;
  const positions = new Float32Array(count * 3), sizes = new Float32Array(count), shifts = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const azimuth = Math.random() * Math.PI * 2, polar = Math.acos(2 * Math.random() - 1);
    const radius = Math.sqrt(Math.random()) * 30;
    positions.set([Math.sin(polar) * Math.cos(azimuth) * radius, Math.sin(polar) * Math.sin(azimuth) * radius, Math.cos(polar) * radius], i * 3);
    sizes[i] = Math.random() * 2 + 1;
    shifts.set([Math.random() * Math.PI, Math.random() * Math.PI * 2, (Math.random() * .9 + .1) * Math.PI * .1, Math.random() * .9 + .1], i * 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('sizes', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('shift', new THREE.BufferAttribute(shifts, 4));
  const points = new THREE.Points(geometry, material);
  points.rotation.order = 'ZYX'; points.rotation.z = .2; points.frustumCulled = false;
  scene.add(points);
  let raf = 0, last = null, elapsed = 0, introElapsed = motion.matches ? INTRO_DURATION : 0;
  let paused = motion.matches, disposed = false, lost = false;
  let reportedProgress = -1;
  let ratio = Math.min(devicePixelRatio || 1, compact.matches ? 1.25 : 1.75), samples = 0, sampleTime = 0;
  const draw = () => { if (!disposed && !lost) renderer.render(scene, camera); };
  function applyIntroState() {
    const progress = Math.min(1, introElapsed / INTRO_DURATION);
    const eased = easeOutCamera(progress);
    camera.position.z = INITIAL_ZOOM + (FINAL_ZOOM - INITIAL_ZOOM) * eased;
    uniforms.introScale.value = .24 + .76 * eased;
    if (progress !== reportedProgress) { reportedProgress = progress; onIntroProgress(progress, introElapsed); }
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    renderer.setPixelRatio(ratio); renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    camera.aspect = rect.width / Math.max(1, rect.height); camera.updateProjectionMatrix(); draw();
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; last = null; }
  function frame(now) {
    raf = 0;
    if (disposed || lost || paused || document.hidden) return;
    if (last === null) last = now;
    const dt = (now - last) / 1000;
    if (dt >= 1 / 60) {
      elapsed += Math.min(dt, .1) * 1.1; last = now;
      const previousRemaining = 1 - introElapsed / INTRO_DURATION;
      introElapsed = Math.min(INTRO_DURATION, introElapsed + dt * 1000);
      const remaining = 1 - introElapsed / INTRO_DURATION;
      // Integrate the decelerating spin so frame rate never changes its path.
      // 2.8 rad/s at entry eases down to the original 0.055 rad/s ambient speed.
      points.rotation.y += .055 * dt + 2.745 * (INTRO_DURATION / 1000) / 4 * (previousRemaining ** 4 - remaining ** 4);
      applyIntroState();
      uniforms.time.value = elapsed * Math.PI;
      draw(); samples++; sampleTime += dt;
      // Avoid reallocating the canvas during the foreground's 2.2–3.5s reveal.
      if (introElapsed >= INTRO_DURATION && sampleTime >= 3) {
        if (samples / sampleTime < 23 && ratio > .75) { ratio = Math.max(.75, ratio - .25); resize(); }
        samples = 0; sampleTime = 0;
      }
    }
    raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (!raf && !disposed && !lost && !paused && !document.hidden) {
      if (last === null) last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  function updateToggle() {
    toggle.disabled = false;
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? '播放背景动画' : '暂停背景动画');
    toggle.querySelector('span').textContent = paused ? '播放动态' : '暂停动态';
    toggle.querySelector('path').setAttribute('d', paused ? 'm7 4 8 6-8 6Z' : 'M7 5v10M13 5v10');
    canvas.dataset.paused = String(paused);
  }
  const onToggle = () => { paused = !paused; stop(); updateToggle(); wake(); };
  const onMotion = () => {
    paused = motion.matches;
    if (paused) { introElapsed = INTRO_DURATION; applyIntroState(); draw(); }
    stop(); updateToggle(); wake();
  };
  const onVisibility = () => { stop(); wake(); };
  const onPageHide = () => stop();
  const onPageShow = () => wake();
  const onContextLost = event => {
    event.preventDefault(); lost = true; stop(); toggle.hidden = true; canvas.style.opacity = '0';
    introElapsed = INTRO_DURATION; applyIntroState();
  };
  const onContextRestored = () => { lost = false; toggle.hidden = false; canvas.style.opacity = ''; resize(); wake(); };
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  toggle.addEventListener('click', onToggle); motion.addEventListener('change', onMotion);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide); window.addEventListener('pageshow', onPageShow);
  canvas.addEventListener('webglcontextlost', onContextLost); canvas.addEventListener('webglcontextrestored', onContextRestored);
  applyIntroState(); resize(); updateToggle(); wake();
  return { dispose() {
    disposed = true; stop(); observer.disconnect();
    toggle.removeEventListener('click', onToggle); motion.removeEventListener('change', onMotion);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide); window.removeEventListener('pageshow', onPageShow);
    canvas.removeEventListener('webglcontextlost', onContextLost); canvas.removeEventListener('webglcontextrestored', onContextRestored);
    geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss();
  } };
}

