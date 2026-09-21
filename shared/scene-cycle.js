import { Color } from '../vendor/three/build/three.module.js';
import { ENVIRONMENT_DEFAULTS, unpackScene, readEnvironment, sceneName } from './scene-file.js';
import { PHASE_IDS } from './developer-settings.js';

export const CYCLE_DURATION = 2600;
const phases = ['清晨', '黄昏', '夜晚'];
const lerp = (a, b, t) => a + (b - a) * t;
const color = (a, b, t) => '#' + new Color(a).lerp(new Color(b), t).getHexString();
export const easeDaylight = t => t * t * t * (t * (t * 6 - 15) + 10);
export function sceneAppearance(scene) {
  const night = scene.preset === 'night';
  return { floorColor: night ? '#202c3c' : '#e3e8ed', reflectorColor: night ? '#253449' : '#cdd7e1', hemi: night ? .35 : 1, shadow: Number(scene.shadows) };
}
export function blendScene(from, to, progress, appearance = sceneAppearance(from)) {
  const t = easeDaylight(Math.max(0, Math.min(1, progress))), scene = {};
  for (const key of Object.keys(ENVIRONMENT_DEFAULTS)) {
    if (key === 'lightAngle') {
      // All three supplied presets follow the same clockwise solar orbit.
      const delta = ((to[key] - from[key]) % 360 + 360) % 360;
      const angle = lerp(from[key], from[key] + (delta === 0 ? 0 : delta - 360), t);
      scene[key] = ((angle + 180) % 360 + 360) % 360 - 180;
    } else if (key.endsWith('Color')) scene[key] = color(from[key], to[key], t);
    else if (typeof to[key] === 'number') scene[key] = lerp(from[key], to[key], t);
    else scene[key] = t === 1 ? to[key] : from[key];
  }
  if (t === 1) Object.assign(scene, to);
  const end = sceneAppearance(to);
  return { scene, appearance: { floorColor: color(appearance.floorColor, end.floorColor, t), reflectorColor: color(appearance.reflectorColor, end.reflectorColor, t), hemi: lerp(appearance.hemi, end.hemi, t), shadow: lerp(appearance.shadow, end.shadow, t) } };
}

export async function createSceneCycle({ button, read, apply, name, notify, savedPresets = {} }) {
  let presets;
  try {
    presets = await Promise.all(['morning', 'evening', 'night'].map(async phase => {
      const response = await fetch(new URL('../assets/scenes/' + phase + '.json', import.meta.url));
      if (!response.ok) throw new Error('无法读取场景');
      return unpackScene(await response.blob());
    }));
  } catch (error) { button.title = '日光场景加载失败，请刷新重试'; notify(button.title); return null; }
  const originals = structuredClone(presets);
  presets = presets.map((preset, i) => savedPresets[PHASE_IDS[i]] || preset);
  let index = -1, animation = null, appearance = sceneAppearance(read()), weights = [1, 0, 0];
  const part = key => button.querySelector('[data-day-' + key + ']');
  const disc = part('disc'), cutout = part('cutout'), clip = part('clip'), rays = part('rays');
  const halo = part('halo'), horizon = part('horizon'), ripples = part('ripples'), stars = part('stars');
  const mixColor = (morning, evening, night) => color(color(morning, evening, weights[1] / Math.max(.0001, weights[0] + weights[1])), night, weights[2]);
  const paint = nextWeights => {
    weights = nextWeights;
    const [morning, evening, night] = weights;
    const cx = 30 * morning + 32 * evening + 30 * night;
    const cy = 24 * morning + 38 * evening + 25 * night;
    const radius = 11 * morning + 14 * evening + 14 * night;
    // One celestial body: it sinks below the horizon, then is carved into a crescent.
    for (const el of [disc, halo]) { el.setAttribute('cx', cx); el.setAttribute('cy', cy); }
    disc.setAttribute('r', radius); halo.setAttribute('r', radius + 10);
    halo.setAttribute('opacity', .25 - .17 * night);
    halo.setAttribute('fill', mixColor('#fff1be', '#ffc38b', '#dce9ff'));
    cutout.setAttribute('cx', cx + 40 * (1 - night) + 7 * night);
    cutout.setAttribute('cy', cy - 5); cutout.setAttribute('r', 14);
    clip.setAttribute('height', 56 - 18 * evening);
    part('warm').setAttribute('stop-color', mixColor('#fff0ad', '#ffd093', '#f0f5ff'));
    part('cool').setAttribute('stop-color', mixColor('#edb34b', '#e18154', '#c6d9fc'));
    rays.setAttribute('transform', `translate(${cx} ${cy}) rotate(${45 * evening + 75 * night})`);
    rays.setAttribute('opacity', 1 - night);
    [...rays.children].forEach((ray, i) => {
      const angle = i * Math.PI / 4, inner = radius + 4, outer = inner + 4 * (1 - night);
      ray.setAttribute('x1', Math.cos(angle) * inner); ray.setAttribute('y1', Math.sin(angle) * inner);
      ray.setAttribute('x2', Math.cos(angle) * outer); ray.setAttribute('y2', Math.sin(angle) * outer);
    });
    rays.setAttribute('stroke', mixColor('#d5a15b', '#bd8054', '#dce9ff'));
    const y = 47 * morning + 39 * evening + 48 * night;
    horizon.setAttribute('d', `M10 ${y} Q32 ${y - 7 * (1 - evening)} 54 ${y}`);
    horizon.setAttribute('stroke', mixColor('#8daabe', '#b77755', '#afc5e5'));
    horizon.setAttribute('opacity', .7 - .35 * night);
    ripples.setAttribute('opacity', evening); stars.setAttribute('opacity', night * night);
    stars.setAttribute('transform', `translate(0 ${4 * (1 - night)}) scale(${.85 + .15 * night})`);
    button.style.setProperty('--day-sky', mixColor('#dcefff', '#f5c6a0', '#263655'));
  };
  const describe = () => {
    // Accessible names remain available without adding visible labels or tooltips.
    button.removeAttribute('title');
  };
  function sync() {
    if (animation) return;
    const state = read();
    index = presets.findIndex(p => Object.keys(ENVIRONMENT_DEFAULTS).every(key => p.scene[key] === state[key]));
    appearance = sceneAppearance(state);
    if (index >= 0) paint(phases.map((_, i) => Number(i === index)));
    button.dataset.phase = index < 0 ? 'custom' : ['morning', 'evening', 'night'][index];
    button.setAttribute('aria-label', (index < 0 ? '日光流转' : '当前' + phases[index]) + '，点击切换到' + phases[(index + 1) % 3]);
    describe();
  }
  function cancel() {
    if (animation) cancelAnimationFrame(animation.frame);
    animation = null; button.dataset.transitioning = 'false';
    // Settle the derived palette to the current state when manual editing takes over.
    appearance = sceneAppearance(read());
  }
  function next({ duration = CYCLE_DURATION, onComplete = () => {} } = {}) {
    const from = { ...read() }, initialAppearance = appearance, initialWeights = [...weights];
    if (animation) cancelAnimationFrame(animation.frame);
    index = (index + 1) % 3;
    const targetIndex = index, target = presets[index];
    const session = { start: performance.now(), frame: 0 }; animation = session;
    button.dataset.phase = ['morning', 'evening', 'night'][index];
    button.dataset.transitioning = 'true';
    button.setAttribute('aria-label', '切换至' + phases[index] + '，再次点击切换到' + phases[(index + 1) % 3]);
    describe(); name(target.name);
    duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
    const tick = now => {
      if (animation !== session) return;
      const progress = duration ? Math.min(1, (now - session.start) / duration) : 1;
      const blended = blendScene(from, target.scene, progress, initialAppearance); appearance = blended.appearance;
      paint(initialWeights.map((weight, i) => lerp(weight, Number(i === targetIndex), easeDaylight(progress))));
      apply(blended.scene, appearance);
      if (progress < 1) session.frame = requestAnimationFrame(tick);
      else { animation = null; button.dataset.transitioning = 'false'; sync(); onComplete(); }
    };
    session.frame = requestAnimationFrame(tick);
  }
  button.onclick = () => next();
  apply(presets[0].scene, sceneAppearance(presets[0].scene)); name(presets[0].name);
  button.dataset.transitioning = 'false'; button.disabled = false; sync();
  return {
    cancel, sync, next,
    select(id) {
      const i = PHASE_IDS.indexOf(id); if (i < 0) throw new Error('未知日光时段');
      cancel(); apply(presets[i].scene, sceneAppearance(presets[i].scene)); name(presets[i].name); sync();
    },
    setPresets(saved) {
      // Validate all presets before replacing any live configuration.
      const nextPresets = originals.map((preset, i) => saved[PHASE_IDS[i]] ? {
        name: sceneName(saved[PHASE_IDS[i]].name), scene: readEnvironment(saved[PHASE_IDS[i]].scene)
      } : structuredClone(preset));
      presets = nextPresets; sync();
    },
    getPresets() { return Object.fromEntries(PHASE_IDS.map((id, i) => [id, structuredClone(presets[i])])); },
    get transitioning() { return !!animation; },
    get appearance() { return animation ? appearance : null; }
  };
}
