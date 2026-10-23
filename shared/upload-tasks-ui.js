import { clearCompletedUploads, deleteFailedUpload, listUploads, retryUpload, startUploadQueue, subscribeUploads } from './upload-queue.js';

export function mountUploadTasks({ button, badge, panel, list, clear, onComplete = () => {} }) {
  let version = 0, initialized = false;
  const control = button.closest('.upload-tasks-control') || button;
  control.hidden = true;
  const completed = new Set();
  const label = task => {
    if (task.status === 'completed') return '已完成';
    if (task.status === 'failed') return '上传失败';
    if (task.status === 'queued') return task.dependsOn ? '等待前一任务' : '等待上传';
    if (task.stage === 'saving') return '正在保存';
    if (task.stage === 'uploading') return `上传资源 ${task.completed}/${task.total}`;
    return '正在准备';
  };
  function setOpen(open, focus = false) {
    panel.hidden = !open; button.setAttribute('aria-expanded', String(open));
    if (focus) button.focus({ preventScroll: true });
  }
  async function refresh() {
    const renderVersion = ++version;
    try {
      const tasks = await listUploads(); if (renderVersion !== version) return;
      const unfinished = tasks.filter(task => task.status !== 'completed'), count = unfinished.length;
      control.hidden = !count;
      if (!count) setOpen(false);
      badge.hidden = !count; badge.textContent = count > 99 ? '99+' : String(count);
      button.setAttribute('aria-label', count ? `上传任务，${count} 项未完成` : '上传任务');
      button.classList.toggle('has-failed-uploads', tasks.some(task => task.status === 'failed'));
      clear.hidden = !tasks.some(task => task.status === 'completed');
      const fresh = tasks.filter(task => task.status === 'completed' && !completed.has(task.id));
      fresh.forEach(task => completed.add(task.id));
      if (initialized && fresh.length) onComplete(fresh);
      initialized = true;
      list.replaceChildren();
      if (!tasks.length) {
        const empty = document.createElement('li'); empty.className = 'upload-task-empty'; empty.textContent = '暂无上传任务'; list.append(empty); return;
      }
      const ordered = [...unfinished, ...tasks.filter(task => task.status === 'completed').slice(0, 20)];
      for (const task of ordered) {
        const row = document.createElement('li'); row.className = 'upload-task-row'; row.dataset.taskId = task.id; row.dataset.status = task.status;
        const info = document.createElement('div'); info.className = 'upload-task-info';
        const name = document.createElement('strong'); name.textContent = task.name; name.title = task.name;
        const state = document.createElement('span'); state.className = 'upload-task-state'; state.textContent = label(task);
        info.append(name, state);
        if (task.status === 'uploading') {
          const progress = document.createElement('progress'); progress.max = Math.max(1, task.total + 1); progress.value = task.completed;
          progress.setAttribute('aria-label', task.name + '上传进度'); info.append(progress);
        }
        if (task.status === 'failed') {
          const error = document.createElement('p'); error.className = 'upload-task-error'; error.textContent = task.error; info.append(error);
          const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'upload-task-retry'; retry.textContent = '重试';
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'upload-task-delete'; remove.textContent = '删除';
          remove.setAttribute('aria-label', '删除上传任务：' + task.name);
          retry.addEventListener('click', async () => {
            retry.disabled = remove.disabled = true;
            try { await retryUpload(task.id); } catch (failure) { error.textContent = failure.message; retry.disabled = remove.disabled = false; }
          });
          remove.addEventListener('click', async () => {
            retry.disabled = remove.disabled = true;
            try { await deleteFailedUpload(task.id); await refresh(); }
            catch (failure) { error.textContent = failure.message || '删除任务失败，请重试'; retry.disabled = remove.disabled = false; }
          });
          const actions = document.createElement('div'); actions.className = 'upload-task-actions'; actions.append(retry, remove);
          row.append(info, actions);
        } else row.append(info);
        list.append(row);
      }
    } catch { badge.hidden = true; list.replaceChildren(); const error = document.createElement('li'); error.className = 'upload-task-empty'; error.textContent = '暂时无法读取上传任务'; list.append(error); }
  }
  button.addEventListener('click', () => { setOpen(panel.hidden); if (!panel.hidden) { void refresh(); panel.querySelector('[data-close-uploads]').focus(); } });
  panel.querySelector('[data-close-uploads]').addEventListener('click', () => setOpen(false, true));
  document.addEventListener('pointerdown', event => { if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) setOpen(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); setOpen(false, true); } });
  clear.addEventListener('click', async () => {
    clear.disabled = true;
    try { await clearCompletedUploads(); }
    catch (failure) { const error = document.createElement('li'); error.className = 'upload-task-empty'; error.textContent = failure.message || '清除记录失败，请重试'; list.prepend(error); }
    finally { clear.disabled = false; }
  });
  subscribeUploads(() => { void refresh(); });
  void refresh(); startUploadQueue();
}
