importScripts("./knit-renderer.js");

let resumeMap;
self.onmessage = async (event) => {
  if (event.data.type === "map-consumed") { resumeMap?.(); return; }
  const { options } = event.data;
  try {
    self.postMessage({ type: "started" });
    const started = performance.now();
    if (options?.output === "relief") {
      await KnitRenderer.renderReliefAsync(options, {
        onProgress(progress, stage) { self.postMessage({ type: "progress", progress, stage }); },
        onMap(kind, image) {
          return new Promise(resolve => {
            resumeMap = () => { resumeMap = null; resolve(); };
            self.postMessage({ type: "map", kind, image }, [image.data.buffer]);
          });
        }
      });
      self.postMessage({ type: "complete", elapsed: performance.now() - started });
      return;
    }
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
