// Project feedback is independent of the editable design annotation snapshot.
export function mountProjectFeedback({ host, guest, current, list, remove, select, changed, notify }) {
  const section = document.createElement('section'); section.className = 'project-feedback';
  section.innerHTML = '<p data-status role="status"></p><ol class="feedback-list" aria-label="客户留言"></ol>';
  host.append(section);
  const status = section.querySelector('[data-status]'), items = section.querySelector('ol');
  let version = 0;
  function clear() { version++; items.replaceChildren(); status.textContent = ''; changed([]); }
  async function refresh() {
    const project = current(), request = ++version; items.replaceChildren(); changed([]);
    if (!project.id) { status.textContent = '保存项目后即可接收客户留言。'; return; }
    status.textContent = '正在读取留言…';
    try {
      const comments = await list(project.id);
      if (request !== version || current().id !== project.id) return;
      changed(comments); status.textContent = comments.length ? `${comments.length} 条留言` : '暂无留言';
      for (const comment of comments) {
        const row = document.createElement('li'); row.className = 'feedback-row';
        const heading = document.createElement('div'), name = document.createElement('strong'), time = document.createElement('time');
        name.textContent = comment.authorName; time.dateTime = comment.createdAt; time.textContent = new Date(comment.createdAt).toLocaleString('zh-CN'); heading.append(name, time);
        const text = document.createElement('button'); text.type = 'button'; text.className = 'feedback-body'; text.textContent = comment.body;
        text.onclick = () => select(comment.id); row.append(heading, text);
        const anchored = comment.modelHash === project.modelHash;
        if (!anchored) { const note = document.createElement('small'); note.textContent = '模型已更换，此留言仅在列表中保留'; row.append(note); }
        if (!guest || comment.canDelete) {
          const del = document.createElement('button'); del.type = 'button'; del.className = 'feedback-delete';
          const label = guest ? '删除我的留言' : '删除留言'; del.title = label; del.setAttribute('aria-label', label);
          del.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>';
          del.onclick = async () => { if(del.disabled)return; del.disabled = true; try { await remove(comment.id, project.id); await refresh(); } catch (error) { notify(error.message); } finally { del.disabled = false; } };
          row.append(del);
        }
        items.append(row);
      }
    } catch (error) { if (request === version) status.textContent = error.message || '留言读取失败，请重新打开项目重试。'; }
  }
  return { refresh, clear };
}

export async function feedbackAuthorName() {
  let saved = ''; try { saved = localStorage.getItem('spenic-feedback-name') || ''; } catch {}
  if (saved.trim()) return saved;
  const dialog = document.createElement('dialog'); dialog.className = 'feedback-name-dialog';
  dialog.innerHTML = `<form method="dialog"><h2>如何称呼你？</h2><p>称呼将与留言一起显示，无需注册账号。</p><label>姓名或公司称呼<input name="author" autocomplete="organization" maxlength="40" required></label><div><button value="cancel" type="button">取消</button><button value="save" type="submit" class="primary">确定</button></div></form>`;
  document.body.append(dialog); dialog.querySelector('[value="cancel"]').onclick = () => dialog.close('cancel');
  dialog.querySelector('form').onsubmit = event => { if (!dialog.querySelector('input').value.trim()) { event.preventDefault(); dialog.querySelector('input').focus(); } };
  return new Promise((resolve, reject) => {
    dialog.addEventListener('close', () => {
      const name = dialog.querySelector('input').value.trim(); dialog.remove();
      if (dialog.returnValue !== 'save' || !name) { reject(new Error('已取消留言，输入内容仍保留')); return; }
      try { localStorage.setItem('spenic-feedback-name', name); } catch {}
      resolve(name);
    }, { once: true });
    dialog.showModal(); dialog.querySelector('input').focus();
  });
}
