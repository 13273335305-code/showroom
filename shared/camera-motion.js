// The opening camera pullback has enough time for the focus transition to read.
export const INTRO_DURATION = 2000;
export const INTRO_DISTANCE_RATIO = .55;
export const INTRO_BLUR_MAX = 12;
export const easeOutCamera = t => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;
export const introFocusBlur = (progress, max = INTRO_BLUR_MAX) => max * (1 - Math.max(0, Math.min(1, progress)));

// The render loop supplies time so the camera is positioned before each draw.
export function createCameraMotion({ duration = INTRO_DURATION, render, finish = () => {}, now = () => performance.now() }) {
  const started = now();
  let active = true;
  const motion = {
    update(time = now()) {
      if (!active) return;
      const progress = duration ? Math.max(0, Math.min(1, (time - started) / duration)) : 1;
      render(easeOutCamera(progress));
      if (progress === 1) { active = false; finish(); }
    },
    cancel() { if (active) { active = false; finish(); } }
  };
  return motion;
}
