importScripts("./knit-renderer.js");

self.onmessage = (event) => {
  const { options } = event.data;
  try {
    self.postMessage({ type: "started" });
    const started = performance.now();
    const render = options?.output === "height" && KnitRenderer.renderHeight
      ? KnitRenderer.renderHeight
      : options?.output === "normal" && KnitRenderer.renderNormal
        ? KnitRenderer.renderNormal
        : KnitRenderer.render;
    const image = render(options);
    self.postMessage({ type: "complete", image, elapsed: performance.now() - started }, [image.data.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
