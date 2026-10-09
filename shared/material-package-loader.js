export async function unpackMaterialAsync(file) {
  if (typeof Worker === 'undefined') return (await import('./material-package.js')).unpackMaterial(file);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./material-package-worker.js', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('材质包处理超时')); }, 120000);
    const finish = callback => { clearTimeout(timer); worker.terminate(); callback(); };
    worker.onmessage = ({ data }) => finish(() => data.error ? reject(new Error(data.error)) : resolve(data.asset));
    worker.onerror = event => finish(() => reject(new Error(event.message || '材质包处理失败')));
    worker.postMessage(file);
  });
}
