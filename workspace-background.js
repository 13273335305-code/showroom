/**
 * Predictive Arc host for the static workspace page.
 *
 * The renderer below is kept in sync with the verified ThreeUI source at
 * vendor/threeui-predictive-arc/src/shaders/predictive-arc/predictiveArcRenderer.ts.
 * The surrounding host mirrors PredictiveArcCanvas.tsx without requiring a
 * React build for this existing HTML application.
 */

const host = document.querySelector('.workspace-background-host');
const canvas = host?.querySelector('.workspace-background-canvas');
if (!host || !canvas) throw new Error('Workspace background host is missing');

const PREDICTIVE_ARC_DEFAULTS = {
  mode: 'light',
  speed: 0.87,
  spacing: 5,
  dotSize: 6,
  archHeight: 0.7,
  thickness: 1,
  brightness: 1.49,
  hue: -24,
  saturation: 1.07,
};

function resolveMode(mode) {
  if (mode === 'light' || mode === 1 || mode === '1') return 'light';
  return 'dark';
}

function createPredictiveArcRenderer(targetCanvas, getOptions) {
  const context = targetCanvas.getContext('2d', { alpha: false });
  if (!context) return null;
  let width = 1;
  let height = 1;
  let time = 0;

  const resize = (nextWidth, nextHeight) => {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    targetCanvas.width = Math.round(width * pixelRatio);
    targetCanvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  };

  const render = () => {
    const options = getOptions();
    const mode = resolveMode(options.mode);
    const isLight = mode === 'light';
    context.fillStyle = isLight ? '#eef1f6' : '#030303';
    context.fillRect(0, 0, width, height);
    time += 0.015 * options.speed;

    const centerX = width / 2;
    const archPeakY = height * 0.35;
    const archWidth = width * 1.5;
    const archHeight = height * options.archHeight;
    context.globalCompositeOperation = isLight ? 'source-over' : 'lighter';

    for (let x = 0; x < width; x += options.spacing) {
      const normX = (x - centerX) / (archWidth / 2);
      const curveY = archPeakY + normX * normX * archHeight;
      for (let y = 0; y < height; y += options.spacing) {
        const distanceToCurve = Math.abs(y - curveY);
        const thickness = (140 + (1 - Math.abs(normX)) * 80) * options.thickness;
        if (distanceToCurve >= thickness) continue;
        let intensity = 1 - distanceToCurve / thickness;
        const waveX = Math.sin(x * 0.015 + time);
        const waveY = Math.cos(y * 0.02 + time);
        intensity = intensity * 0.7 + waveX * waveY * 0.3 * intensity;
        intensity *= Math.max(0, 1 - Math.pow(Math.abs(normX), 2.5));
        if (intensity <= 0.02) continue;

        let r;
        let g;
        let b;
        if (isLight) {
          // Cool violet ink on pale paper — readable without additive washout.
          r = Math.min(255, 48 * intensity + 70 * Math.pow(intensity, 3));
          g = Math.min(255, 28 * intensity + 45 * Math.pow(intensity, 4));
          b = Math.min(255, 120 * intensity + 110 * Math.pow(intensity, 2));
          if (intensity > 0.7) {
            const coreBoost = (intensity - 0.7) * 3.3;
            r = Math.min(255, r + 90 * coreBoost);
            g = Math.min(255, g + 70 * coreBoost);
            b = Math.min(255, b + 110 * coreBoost);
          }
        } else {
          r = Math.min(255, 60 * intensity + 100 * Math.pow(intensity, 3));
          g = Math.min(255, 20 * intensity + 60 * Math.pow(intensity, 4));
          b = Math.min(255, 120 * intensity + 135 * Math.pow(intensity, 2));
          if (intensity > 0.7) {
            const coreBoost = (intensity - 0.7) * 3.3;
            r = Math.min(255, r + 150 * coreBoost);
            g = Math.min(255, g + 150 * coreBoost);
            b = Math.min(255, b + 150 * coreBoost);
          }
        }
        context.fillStyle = `rgb(${Math.floor(r * options.brightness)}, ${Math.floor(g * options.brightness)}, ${Math.floor(b * options.brightness)})`;
        context.fillRect(x, y, options.dotSize * intensity, options.dotSize * intensity);
      }
    }
    context.globalCompositeOperation = 'source-over';
  };

  return { resize, render };
}

const options = {
  ...PREDICTIVE_ARC_DEFAULTS,
  // Matches the requested PredictiveArcCanvas usage for this workspace.
  mode: 'light',
  speed: 0.87,
  hue: -24,
  saturation: 1.07,
  brightness: 1.49,
};
host.dataset.mode = options.mode;
host.classList.add(`predictive-arc--${options.mode}`);
canvas.style.filter = `hue-rotate(${options.hue}deg) saturate(${options.saturation})`;

const renderer = createPredictiveArcRenderer(canvas, () => options);
if (!renderer) {
  host.classList.add('workspace-background-fallback');
} else {
  let frame = 0;
  let visible = true;
  const resize = () => {
    const bounds = host.getBoundingClientRect();
    renderer.resize(bounds.width, bounds.height);
    renderer.render();
  };
  const tick = () => {
    renderer.render();
    frame = visible && !document.hidden ? requestAnimationFrame(tick) : 0;
  };
  const observer = new ResizeObserver(resize);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    if (visible && !frame) frame = requestAnimationFrame(tick);
    if (!visible && frame) cancelAnimationFrame(frame), frame = 0;
  });
  const visibility = () => {
    if (document.hidden && frame) cancelAnimationFrame(frame), frame = 0;
    else if (!document.hidden && visible && !frame) frame = requestAnimationFrame(tick);
  };
  observer.observe(host);
  intersection.observe(host);
  document.addEventListener('visibilitychange', visibility);
  resize();
  frame = requestAnimationFrame(tick);
  window.addEventListener('pagehide', () => {
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect();
    intersection.disconnect();
    document.removeEventListener('visibilitychange', visibility);
  }, { once: true });
}
