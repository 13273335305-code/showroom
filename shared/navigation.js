import { authState } from './auth.js';

export function mountNavigation(active) {
  if (active !== 'design') window.name = 'spenic-secondary';
  const header = document.querySelector('.topbar');
  const brand = header.querySelector('.brand');
  brand.innerHTML = '<img class="brand-logo" src="assets/spenic-logo.png" alt="Spenic"><span class="brand-divider"></span><strong class="brand-title">虚拟设计台</strong>';
  brand.setAttribute('aria-label', 'Spenic 工作空间首页');
  const nav = header.querySelector('.app-navigation') || document.createElement('nav');
  nav.replaceChildren();
  nav.className = 'app-navigation';
  nav.setAttribute('aria-label', '工作空间入口');
  const links = [['design', '设计台', './index.html'], ['material', '材质编辑器', './material-editor.html'], ['assets', '资产库', './asset-library.html']];
  const auth = authState();
  if (auth && !auth.materialEditor) document.querySelectorAll('a[href*="material-editor"]').forEach(link => { link.hidden = true; link.setAttribute('aria-hidden', 'true'); });
  for (const [id, name, href] of links) {
    if (id === 'material' && auth && !auth.materialEditor) continue;
    const link = document.createElement('a');
    link.href = href;
    link.textContent = name;
    if (active === id) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', async event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const session = window.__spenicDesignSession;
      const leavingDesign = active === 'design' && id !== 'design';
      const returningDesign = active !== 'design' && id === 'design';
      if (!leavingDesign && !returningDesign) return;
      event.preventDefault();
      if (leavingDesign && session?.save) {
        link.setAttribute('aria-busy', 'true');
        await session.save();
      }
      window.open(href, id === 'design' ? 'spenic-design' : 'spenic-secondary');
    });
    nav.append(link);
  }
  header.append(nav);
}

export function downloadFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
