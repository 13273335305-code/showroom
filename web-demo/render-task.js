/* Background rendering with a yielding fallback for file:// and blocked workers. */
(function (root) {
  "use strict";

  function start(options, { onProgress, onFallback } = {}) {
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
    const complete = (image, mode) => {
      if (settled) return;
      if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)
        || image.width <= 0 || image.height <= 0
        || image.data?.length !== image.width * image.height * 4) {
        fail(new Error("渲染结果不完整"));
        return;
      }
      settled = true;
      cleanup();
      resolveJob({ image, mode, elapsed: performance.now() - started });
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
      cleanup();
      try {
        onFallback?.(reason);
        // Keep dedicated wrappers when available so map jobs can be replaced
        // independently by the UI; older renderer shims still work through
        // the generic renderAsync fallback.
        const renderAsync = options?.output === "height" && root.KnitRenderer?.renderHeightAsync
          ? root.KnitRenderer.renderHeightAsync
          : options?.output === "normal" && root.KnitRenderer?.renderNormalAsync
            ? root.KnitRenderer.renderNormalAsync
            : root.KnitRenderer?.renderAsync;
        if (!renderAsync) throw new Error("渲染器未加载，请刷新页面后重试。");
        renderAsync(options, { signal: controller.signal, onProgress })
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
        worker.onmessage = ({ data }) => {
          if (settled || fallingBack) return;
          if (data.type === "started") {
            clearTimeout(timer);
            timer = setTimeout(() => fallback(new Error("后台渲染超时")), 60_000);
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
