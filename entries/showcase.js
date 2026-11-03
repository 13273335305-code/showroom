import { createShowcaseWorkspace } from '../shared/showcase-workspace.js';

async function boot() {
  const token = new URLSearchParams(location.hash.slice(1)).get('share');
  const guest = token !== null;
  const response = await fetch('./design.html', { cache: 'no-cache' });
  if (!response.ok) throw new Error('展示台界面读取失败');
  const template = new DOMParser().parseFromString(await response.text(), 'text/html');
  const styleLoads = [];
  for (const link of template.head.querySelectorAll('link[rel="stylesheet"]')) {
    if (document.querySelector(`link[href="${link.getAttribute('href')}"]`)) continue;
    const copy = link.cloneNode(true);
    styleLoads.push(new Promise(resolve => { copy.onload = resolve; copy.onerror = resolve; })); document.head.append(copy);
  }
  const feedbackStyle = document.createElement('link'); feedbackStyle.rel = 'stylesheet'; feedbackStyle.href = './shared/project-feedback.css'; document.head.append(feedbackStyle);
  const showcaseStyle = document.querySelector('link[href="showcase.css"]'); document.head.append(showcaseStyle);
  template.body.querySelectorAll('script').forEach(script => script.remove());
  document.body.replaceChildren(...template.body.childNodes);
  document.body.className = 'showcase-page' + (guest ? ' showcase-guest' : '');
  document.getElementById('authBootLoading')?.remove();
  document.querySelector('.brand-title').textContent = '展示台';
  document.querySelector('#designLaunchLoading strong').textContent = '正在进入展示台';
  await Promise.all(styleLoads);
  if (!guest) {
    const { requireAuth } = await import('../shared/auth.js'); await requireAuth({ feature: 'showcase' });
    const { mountNavigation } = await import('../shared/navigation.js'); mountNavigation('showcase');
  }
  await createShowcaseWorkspace({ token });
}
boot().catch(error => {
  document.documentElement.classList.remove('auth-pending');
  const box = document.createElement('div'); box.className = 'showcase-boot-error'; box.setAttribute('role', 'alert');
  const title = document.createElement('h1'); title.textContent = '展示内容暂不可用';
  const message = document.createElement('p'); message.textContent = error.message || '请稍后重试';
  const retry = document.createElement('button'); retry.textContent = '重新加载'; retry.onclick = () => location.reload();
  box.append(title, message, retry); document.body.replaceChildren(box);
});
