export function createAlbumDownloadHandler(button, { title, download, onStart, onError }) {
  let resetTimer;
  const status = button.querySelector('.album-download-status');

  function setState(state) {
    button.dataset.downloadState = state;
    button.setAttribute('aria-busy', String(state === 'loading'));
    const label = state === 'loading' ? '正在下载：' + title
      : state === 'success' ? '已提交下载：' + title : '下载原图：' + title;
    button.setAttribute('aria-label', label);
    button.title = state === 'loading' ? '正在下载…' : state === 'success' ? '已提交浏览器下载' : '下载原图';
    status.textContent = label;
  }

  setState('idle');
  return async () => {
    if (button.disabled) return;
    clearTimeout(resetTimer);
    button.disabled = true;
    setState('loading');
    try {
      onStart();
      await download();
      setState('success');
      resetTimer = setTimeout(() => setState('idle'), 1600);
    } catch (cause) {
      setState('idle');
      onError(cause);
    } finally {
      button.disabled = false;
    }
  };
}
