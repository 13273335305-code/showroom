import { renderConvexPreview } from './convex-preview.js';

const MORPH_DURATION = 400;
const REBOUND_DURATION = 500;
const CONTRACTED_SCALE = .92;

// The motion skill's 0.5 s / 0.2 bounce spring, sampled once for WAAPI.
// A damped step response carries the small circle through a gentle overshoot.
const reboundSamples = Array.from({ length: 61 }, (_, index) => {
  const offset = index / 60, bounce = .2;
  const damping = -Math.log(bounce) / Math.hypot(Math.PI, Math.log(bounce));
  const frequency = -Math.log(.001) / (damping * REBOUND_DURATION / 1000);
  const damped = frequency * Math.sqrt(1 - damping * damping);
  const t = offset * REBOUND_DURATION / 1000;
  const progress = index === 60 ? 1 : 1 - Math.exp(-damping * frequency * t) * (Math.cos(damped * t) + damping / Math.sqrt(1 - damping * damping) * Math.sin(damped * t));
  return { offset, scale: CONTRACTED_SCALE + (1 - CONTRACTED_SCALE) * progress };
});

// Matching outer / inner contours let clip-path morph a hollow stroke. Both
// shapes use the same points, so the transparent center follows the outline
// throughout the transition without animating layout or border-radius.
function outlineClip(circle, outside = false, scale = 1) {
  const contour = (half, radius) => Array.from({ length: 96 }, (_, index) => {
    const angle = index / 96 * Math.PI * 2, x = Math.cos(angle), y = Math.sin(angle);
    const ax = Math.abs(x), ay = Math.abs(y), corner = half - radius;
    let distance = half;
    if (!circle) {
      if (ay * half <= ax * corner) distance = half / ax;
      else if (ax * half <= ay * corner) distance = half / ay;
      else distance = corner * (ax + ay) + Math.sqrt(radius * radius - corner * corner * (ax - ay) ** 2);
    }
    return `${(50 + x * distance).toFixed(3)}% ${(50 + y * distance).toFixed(3)}%`;
  });
  const outer = contour(50 * scale, 7), inner = contour(50 * scale - 1.1, 5.9);
  if (outside) {
    const hole = outer.map(point => point.split(' ').map(value => `${(10 + parseFloat(value) * .8).toFixed(3)}%`).join(' '));
    return `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${[...hole, hole[0]].join(', ')})`;
  }
  // The outline has 2% bleed on each side, leaving room for the spring's
  // overshoot without clipping the stroke at the guide's original bounds.
  const padded = [...outer, outer[0], ...inner, inner[0]].map(point => point.split(' ').map(value => `${((parseFloat(value) + 2) / 1.04).toFixed(3)}%`).join(' '));
  return `polygon(evenodd, ${padded.join(', ')})`;
}
const reboundFrames = [false, true].map(outside => reboundSamples.map(({ offset, scale }) => ({ offset, clipPath: outlineClip(true, outside, scale) })));

// Feedback owns its timers and detached images so an old scan cannot paint
// over the next one, or reappear after settings / camera shutdown.
export function createScanFeedback(guide) {
  const surface = guide.querySelector('.fabric-scan-material');
  const blurredVideo = guide.querySelector('.fabric-scan-camera-blur video');
  const outline = guide.querySelector('.fabric-scan-outline'), blur = guide.querySelector('.fabric-scan-camera-blur');
  const cameraVideo = guide.parentElement.querySelector('.fabric-scan-video');
  blurredVideo.muted = true;
  guide.style.setProperty('--scan-outline-square', outlineClip(false));
  guide.style.setProperty('--scan-outline-circle', outlineClip(true));
  guide.style.setProperty('--scan-outline-contracted', outlineClip(true, false, CONTRACTED_SCALE));
  guide.style.setProperty('--scan-outside-square', outlineClip(false, true));
  guide.style.setProperty('--scan-outside-circle', outlineClip(true, true));
  guide.style.setProperty('--scan-outside-contracted', outlineClip(true, true, CONTRACTED_SCALE));
  guide.style.setProperty('--scan-morph-duration', `${MORPH_DURATION}ms`);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let current = null;
  const isCurrent = request => current === request;
  function delay(ms, request) {
    let cancel;
    const promise = new Promise(resolve => {
      const finish = value => { clearTimeout(timer); request.delays.delete(cancel); resolve(value); };
      const timer = setTimeout(() => finish(isCurrent(request)), ms);
      cancel = () => finish(false);
      request.delays.add(cancel);
    });
    return { promise, cancel };
  }
  function reset() {
    const previous = current; current = null;
    previous?.delays.forEach(cancel => cancel());
    previous?.animations.forEach(animation => animation.cancel());
    blurredVideo.pause(); blurredVideo.srcObject = null;
    delete guide.dataset.state; delete guide.dataset.assetId; delete guide.dataset.name;
    surface.replaceChildren(); surface.style.removeProperty('background-color');
  }
  async function reveal(request) {
    if (!isCurrent(request) || !request.circleReady || !request.previewReady || !request.applied || request.revealed) return;
    request.revealed = true;
    guide.dataset.state = 'ready';
    if (!await delay(1800, request).promise) return;
    guide.dataset.state = 'leaving';
    if (await delay(MORPH_DURATION, request).promise) reset();
  }
  function start() {
    reset();
    const request = { delays: new Set(), animations: new Set(), circleReady: false, previewReady: false, applied: false, previewStarted: false, revealed: false };
    // Reuse the stream only during recognition. Filtering this video instead
    // of its backdrop keeps WebKit / Chromium from blurring the clear cutout.
    blurredVideo.srcObject = cameraVideo.srcObject;
    if (blurredVideo.srcObject) void blurredVideo.play().catch(() => {});
    current = request; guide.dataset.state = 'recognized';
    void (async () => {
      if (!reduceMotion.matches && !await delay(160, request).promise) return;
      if (!isCurrent(request)) return;
      guide.dataset.state = 'loading';
      if (!reduceMotion.matches) {
        const contraction = [outline, blur].flatMap(element => element.getAnimations().filter(animation => animation.transitionProperty === 'clip-path'));
        contraction.forEach(animation => request.animations.add(animation));
        await Promise.allSettled(contraction.map(animation => animation.finished));
        contraction.forEach(animation => request.animations.delete(animation));
      }
      if (!isCurrent(request)) return;
      guide.dataset.state = 'settling';
      if (!reduceMotion.matches) {
        const animations = [outline, blur].map((element, index) => element.animate(reboundFrames[index], { id: 'fabric-scan-rebound', duration: REBOUND_DURATION, easing: 'linear' }));
        const startTime = document.timeline.currentTime;
        animations.forEach(animation => { animation.startTime = startTime; request.animations.add(animation); });
        await Promise.allSettled(animations.map(animation => animation.finished));
        animations.forEach(animation => request.animations.delete(animation));
      }
      if (!isCurrent(request)) return;
      request.circleReady = true; void reveal(request);
    })();
    return request;
  }
  async function preview(request, { source = null, info, color = '#6c7278', name = '', id = '' } = {}) {
    if (!isCurrent(request) || request.previewStarted) return;
    request.previewStarted = true;
    const sphere = document.createElement('div'); sphere.className = 'fabric-scan-sphere';
    surface.style.backgroundColor = CSS.supports('color', color) ? color : '#6c7278';
    guide.dataset.assetId = id; guide.dataset.name = name;
    if (source) {
      const image = new Image(); image.alt = ''; image.draggable = false;
      const timeout = delay(4000, request);
      const loaded = renderConvexPreview(image, source, info, color).then(async () => {
        await image.decode(); return true;
      }).catch(() => false);
      const ready = await Promise.race([loaded, timeout.promise.then(() => false)]);
      timeout.cancel();
      if (!isCurrent(request)) return;
      if (ready) sphere.append(image);
    }
    if (!isCurrent(request)) return;
    surface.replaceChildren(sphere); request.previewReady = true; void reveal(request);
  }
  function succeed(request) {
    if (!isCurrent(request)) return;
    request.applied = true;
    if (!request.previewStarted) void preview(request);
    void reveal(request);
  }
  return { start, preview, succeed, reset };
}
