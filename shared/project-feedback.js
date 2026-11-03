// Project feedback is independent of the editable design annotation snapshot.
export function mountProjectFeedback({ host, guest, current, list, remove, start, select, reposition, changed, notify }) {
  const section = document.createElement('section'); section.className = 'project-feedback';
  section.innerHTML = `<div class="section-heading"><h2>客户留言</h2><button type="button" data-refresh>刷新</button></div>
    <p class="feedback-description">此项目的留言对所有收到项目链接的客户可见。</p>
    <button type="button" class="button full" data-add>在模型上添加留言</button>
    <p data-status role="status"></p><ol class="feedback-list" aria-label="客户留言"></ol>`;
  host.append(section);
  const status = section.querySelector('[data-status]'), items = section.querySelector('ol');
  let version = 0;
  function clear() { version++; items.replaceChildren(); status.textContent = ''; changed([]); }
  async function refresh() {
    const project = current(), request = ++version; items.replaceChildren(); changed([]);
    section.querySelector('[data-add]').disabled = !project.id;
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
        if (!anchored) { const note = document.createElement('small'); note.textContent = '模型已更换，此留言待重新定位'; row.append(note); }
        if (!guest) {
          const actions = document.createElement('div'); actions.className = 'feedback-actions';
          const move = document.createElement('button'); move.type = 'button'; move.textContent = '重新定位'; move.onclick = () => reposition(comment.id);
          const del = document.createElement('button'); del.type = 'button'; del.textContent = '删除留言';
          del.onclick = async () => { del.disabled = true; try { await remove(comment.id); await refresh(); } catch (error) { notify(error.message); } finally { del.disabled = false; } };
          actions.append(move, del); row.append(actions);
        }
        items.append(row);
      }
    } catch (error) { if (request === version) status.textContent = error.message || '留言读取失败，点击刷新重试。'; }
  }
  section.querySelector('[data-refresh]').onclick = refresh;
  section.querySelector('[data-add]').onclick = start;
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
