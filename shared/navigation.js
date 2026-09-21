export function mountNavigation(active) {
  const header = document.querySelector('.topbar');
  const brand = header.querySelector('.brand');
  brand.innerHTML = '<img class="brand-logo" src="assets/spenic-logo.png" alt="Spenic"><span class="brand-divider"></span><strong class="brand-title">虚拟设计台</strong>';
  brand.setAttribute('aria-label', 'Spenic 工作空间首页');
  const nav = header.querySelector('.app-navigation') || document.createElement('nav');
  nav.replaceChildren();
  nav.className = 'app-navigation';
  nav.setAttribute('aria-label', '工作空间入口');
  for (const [id, name, href] of [['design', '设计台', './index.html'], ['material', '材质编辑器', './material-editor.html'], ['assets', '资产库', './asset-library.html']]) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = name;
    if (active === id) link.setAttribute('aria-current', 'page');
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
