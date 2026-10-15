// Hello keeps its original absolute timing while the camera intro duration changes.
export const introHelloOpacity = elapsedMs => {
  const t = Math.max(0, Number(elapsedMs) || 0);
  if (t <= 1200) return 1;
  if (t >= 2000) return 0;
  return 1 - (t - 1200) / 800;
};
