export const inspectorEase = t => 1 - (1 - Math.max(0, Math.min(1, t))) ** 4;

export function inspectorMorph(origin, destination, progress) {
  const p = Math.max(0, Math.min(1, progress)), lerp = (a, b) => a + (b - a) * p;
  return { x: lerp(origin.x, destination.x), y: lerp(origin.y, destination.y), width: lerp(origin.width, destination.width), height: lerp(origin.height, destination.height), radius: lerp(9, 16, p) };
}

// One progress value drives both the panel and camera framing.
export function createInspectorTransition({ render, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, now = () => performance.now(), reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches }) {
  let progress = 0, target = 0, frame = 0;
  return {
    get progress() { return progress; },
    get active() { return frame !== 0; },
    set(open) {
      const next = open ? 1 : 0;
      if (next === target) return;
      target = next;
      if (frame) cancelFrame(frame);
      frame = 0;
      if (reducedMotion()) { progress = target; render(progress); return; }
      const from = progress, started = now(), duration = 560 * Math.max(.3, Math.abs(target - from));
      const tick = time => {
        const t = Math.min(1, (time - started) / duration);
        progress = from + (target - from) * inspectorEase(t);
        frame = t < 1 ? requestFrame(tick) : 0;
        render(progress);
      };
      frame = requestFrame(tick);
    },
    refresh() { render(progress); }
  };
}
