// Frame costs are page-local measurements, never whole-machine utilization.
export function createDeveloperPerformance(renderer) {
  const gl = renderer.getContext();
  let extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  let enabled = false, query = null, pending = [], started = 0, frames = 0, cpu = 0, since = 0;
  let gpu = null, gpuAt = 0, previousAutoReset = renderer.info.autoReset;
  function clearQueries() {
    if (!gl.isContextLost()) {
      if (query) gl.endQuery(extension.TIME_ELAPSED_EXT);
      for (const item of [...pending, ...(query ? [query] : [])]) gl.deleteQuery(item);
    }
    pending = []; query = null; gpu = null;
  }
  return {
    setEnabled(value) {
      enabled = value; clearQueries(); frames = 0; cpu = 0; since = performance.now();
      if (value) { previousAutoReset = renderer.info.autoReset; renderer.info.autoReset = false; }
      else renderer.info.autoReset = previousAutoReset;
    },
    begin() {
      if (!enabled || document.hidden) return;
      started = performance.now();
      renderer.info.reset();
      if (!extension || gl.isContextLost()) return;
      if (gl.getParameter(extension.GPU_DISJOINT_EXT)) { clearQueries(); return; }
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const completed = pending.shift();
        gpu = gl.getQueryParameter(completed, gl.QUERY_RESULT) / 1e6; gpuAt = performance.now();
        gl.deleteQuery(completed);
      }
      if (pending.length < 4) {
        query = gl.createQuery();
        if (query) gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      }
    },
    end() {
      if (!enabled || document.hidden) return;
      if (query) { gl.endQuery(extension.TIME_ELAPSED_EXT); pending.push(query); query = null; }
      cpu += performance.now() - started; frames++;
    },
    sample() {
      const now = performance.now(), elapsed = now - since;
      const result = {
        fps: frames && elapsed > 0 ? frames * 1000 / elapsed : null,
        cpu: frames ? cpu / frames : null,
        gpu: now - gpuAt < 2500 ? gpu : null,
        gpuSupported: !!extension,
        heap: performance.memory?.usedJSHeapSize,
        heapLimit: performance.memory?.jsHeapSizeLimit,
        calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
        lost: gl.isContextLost()
      };
      frames = 0; cpu = 0; since = now;
      return result;
    },
    contextLost() { clearQueries(); },
    contextRestored() { extension = gl.getExtension('EXT_disjoint_timer_query_webgl2'); }
  };
}
