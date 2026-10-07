// Keep each collection hidden until its current previews have finished loading.
export function createAssetLoading({ host, grid, indicator, onChange = () => {} }) {
  let generation = 0, loading = false;
  const setLoading = value => {
    loading = value;
    host.classList.toggle('is-asset-loading', value);
    host.setAttribute('aria-busy', String(value));
    grid.inert = value;
    indicator.hidden = !value;
    onChange(value);
  };
  return {
    get loading() { return loading; },
    begin() { const token = ++generation; setLoading(true); return token; },
    async finish(token, previews = []) {
      await Promise.allSettled(previews);
      if (token !== generation) return;
      await Promise.allSettled([...grid.querySelectorAll('img')].map(img => img.decode()));
      if (token !== generation) return;
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (token === generation) setLoading(false);
    },
    cancel() { ++generation; setLoading(false); },
  };
}
