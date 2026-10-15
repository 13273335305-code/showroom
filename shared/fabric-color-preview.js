// Read the preview stream so color switches can report downloaded bytes.
export async function fetchFabricColorPreview(source, { size = 0, signal, onProgress = () => {} } = {}) {
  signal?.throwIfAborted();
  if (source instanceof Blob) { onProgress(1); return source; }
  const response = await fetch(source, { signal });
  if (!response.ok) throw new Error('无法下载色号预览图');
  const total = Number(response.headers.get('content-length')) || Number(size);
  if (!response.body) { const blob = await response.blob(); onProgress(1); return blob; }
  const reader = response.body.getReader(), chunks = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      signal?.throwIfAborted();
      chunks.push(value); loaded += value.byteLength;
      if (total > 0) onProgress(Math.min(1, loaded / total));
    }
  } finally { reader.releaseLock(); }
  signal?.throwIfAborted();
  onProgress(1);
  return new Blob(chunks, { type: response.headers.get('content-type') || 'image/png' });
}
