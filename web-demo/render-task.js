/* Background rendering with a yielding fallback for file:// and blocked workers. */
(function (root) {
  "use strict";

  function start(options, { onProgress, onFallback, onMap } = {}) {
    const relief = options?.output === "relief";
    const maps = {};
    const delivered = new Set();
    let deliveryVersion = 0;
    const controller = new AbortController();
    let worker = null, timer = null, settled = false, fallingBack = false;
    let resolveJob, rejectJob;
    const started = performance.now();
    const promise = new Promise((resolve, reject) => { resolveJob = resolve; rejectJob = reject; });
    const cleanup = () => {
      clearTimeout(timer);
      worker?.terminate();
      worker = null;
    };
    const validImage = image => image && Number.isInteger(image.width) && Number.isInteger(image.height)
      && image.width > 0 && image.height > 0 && image.data?.length === image.width * image.height * 4;
    const receiveMap = async (kind, image) => {
      if (settled) return;
      const version = deliveryVersion;
      if (!["height", "normal", "ao"].includes(kind) || delivered.has(kind) || !validImage(image)) throw new Error("贴图结果不完整");
      if (onMap) await onMap(kind, image);
      else maps[kind] = image;
      if (!settled && version === deliveryVersion) delivered.add(kind);
    };
    const complete = (image, mode) => {
      if (settled) return;
      if (relief ? delivered.size !== 3 : !validImage(image)) {
        fail(new Error("渲染结果不完整"));
        return;
      }
      settled = true;
      cleanup();
      resolveJob({ ...(relief ? { maps } : { image }), mode, elapsed: performance.now() - started });
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectJob(error);
    };
    const fallback = (reason) => {
      if (settled || fallingBack) return;
      fallingBack = true;
      deliveryVersion++;
      cleanup();
      // Discard partial results before retrying the entire shared field.
      delivered.clear();
      for (const key of Object.keys(maps)) delete maps[key];
      try {
        onFallback?.(reason);
        // Keep dedicated wrappers when available so map jobs can be replaced
        // independently by the UI; older renderer shims still work through
        // the generic renderAsync fallback.
        const renderAsync = relief ? root.KnitRenderer?.renderReliefAsync
          : options?.output === "height" && root.KnitRenderer?.renderHeightAsync
          ? root.KnitRenderer.renderHeightAsync
          : options?.output === "normal" && root.KnitRenderer?.renderNormalAsync
            ? root.KnitRenderer.renderNormalAsync
            : root.KnitRenderer?.renderAsync;
        if (!renderAsync) throw new Error("渲染器未加载，请刷新页面后重试。");
        renderAsync(options, { signal: controller.signal, onProgress, ...(relief ? { onMap: receiveMap } : {}) })
          .then((image) => complete(image, "fallback"), fail);
      } catch (error) { fail(error); }
    };

    // Attach the consumer's rejection handler before any synchronous startup
    // error or fallback can settle the promise.
    queueMicrotask(() => {
      if (settled) return;
      if (root.location?.protocol === "file:" || typeof root.Worker !== "function") {
        fallback(new Error("后台线程不可用"));
        return;
      }
      try {
        worker = new root.Worker("./render-worker.js");
        worker.onmessage = async ({ data }) => {
          if (settled || fallingBack) return;
          if (data.type === "started") {
            clearTimeout(timer);
            timer = setTimeout(() => fallback(new Error("后台渲染超时")), 60_000);
          } else if (data.type === "progress") {
            clearTimeout(timer);
            timer = setTimeout(() => fallback(new Error("后台渲染超时")), 60_000);
            onProgress?.(data.progress, data.stage);
          } else if (data.type === "map" && relief) {
            clearTimeout(timer);
            try {
              await receiveMap(data.kind, data.image);
              if (settled || fallingBack) return;
              worker.postMessage({ type: "map-consumed" });
              timer = setTimeout(() => fallback(new Error("后台渲染超时")), 60_000);
            } catch (error) { fail(error); }
          } else if (data.type === "complete") {
            complete(data.image, "worker");
          } else if (data.type === "error") {
            fallback(new Error(data.message || "后台渲染失败"));
          }
        };
        worker.onerror = (event) => {
          event.preventDefault?.();
          fallback(new Error(event.message || "后台线程启动失败"));
        };
        worker.onmessageerror = () => fallback(new Error("后台渲染结果读取失败"));
        timer = setTimeout(() => fallback(new Error("后台线程未响应")), 5000);
        worker.postMessage({ options });
      } catch (error) { fallback(error); }
    });

    return {
      promise,
      cancel() {
        if (settled) return;
        controller.abort();
        const error = new Error("渲染已取消");
        error.name = "AbortError";
        fail(error);
      }
    };
  }
  root.KnitRenderJob = { start };
})(globalThis);
