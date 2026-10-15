export function mountNavigation(active) {
  if (active !== 'design') window.name = 'spenic-secondary';
  const header = document.querySelector('.topbar');
  const brand = header.querySelector('.brand');
  brand.innerHTML = '<img class="brand-logo" src="assets/spenic-logo.png" alt="Spenic"><span class="brand-divider"></span><strong class="brand-title">' + (active === 'design' ? '\u8bbe\u8ba1\u53f0' : active === 'material' ? '\u6750\u8d28\u7f16\u8f91\u5668' : '\u5de5\u4f5c\u7a7a\u95f4') + '</strong>';
  brand.setAttribute('aria-label', active === 'material' ? 'Spenic \u6750\u8d28\u7f16\u8f91\u5668' : 'Spenic \u5de5\u4f5c\u7a7a\u95f4\u9996\u9875');
  const existingNavigation = header.querySelector('.app-navigation');
  if (active === 'design' || active === 'material') {
    existingNavigation?.remove();
    mountToolSwitcher(active);
    return;
  }
  const nav = existingNavigation || document.createElement('nav');
  nav.replaceChildren();
  nav.className = 'app-navigation';
  nav.setAttribute('aria-label', '\u5de5\u4f5c\u7a7a\u95f4\u5165\u53e3');
  const links = [['design', '\u8bbe\u8ba1\u53f0', './design.html'], ['material', '\u6750\u8d28\u7f16\u8f91\u5668', './material-editor.html'], ['projects', '\u9879\u76ee\u5e93', './project-library.html'], ['assets', '\u8d44\u4ea7\u5e93', './asset-library.html']];
  for (const [id, name, href] of links) {
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

const tools = [
  ['design', '设计台', './design.html'],
  ['material', '材质编辑器', './material-editor.html'],
  ['assets', '资产库', './asset-library.html'],
  ['projects', '项目库', './project-library.html'],
  ['parts', '部件配置', './model-parts.html'],
];

export function mountToolSwitcher(active) {
  const brand = document.querySelector('header:is(.topbar,.asset-topbar) .brand');
  if (!brand || brand.querySelector('.tool-trigger')) return;
  const title = brand.querySelector('.brand-title');
  const logo = brand.querySelector('.brand-logo');
  const divider = brand.querySelector('.brand-divider');
  if (!title || !logo || !divider) return;

  const home = document.createElement('a');
  home.className = 'brand-home';
  home.href = brand.getAttribute('href') || './index.html';
  home.setAttribute('aria-label', brand.getAttribute('aria-label') || '返回工作空间');
  home.append(logo);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'tool-trigger';
  trigger.setAttribute('aria-label', `切换工具，当前为${title.textContent.trim()}`);
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  title.remove();
  trigger.append(title);

  const menu = document.createElement('nav');
  menu.className = 'tool-switcher-menu';
  menu.id = `tool-switcher-${active}`;
  menu.setAttribute('aria-label', '切换工具');
  menu.hidden = true;
  trigger.setAttribute('aria-controls', menu.id);
  for (const [id, name, href] of tools) {
    if (id === 'parts' && active !== 'parts') continue;
    const link = document.createElement('a');
    link.href = href;
    link.textContent = name;
    if (id === active) {
      link.className = 'is-current';
      link.setAttribute('aria-current', 'page');
    }
    link.addEventListener('click', async event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (id === active) {
        event.preventDefault();
        close();
        return;
      }
      if (active === 'design') {
        event.preventDefault();
        link.setAttribute('aria-busy', 'true');
        try {
          await window.__spenicDesignSession?.save?.();
          window.open(href, 'spenic-secondary');
          close();
        } finally { link.removeAttribute('aria-busy'); }
      } else if (id === 'design') {
        event.preventDefault();
        window.open(href, 'spenic-design');
        close();
      }
    });
    menu.append(link);
  }

  const switcher = document.createElement('div');
  switcher.className = 'tool-switcher';
  switcher.append(trigger, menu);
  const container = document.createElement('div');
  container.className = brand.className;
  container.append(home, divider, switcher);
  brand.replaceWith(container);

  function close() { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
  function open() { menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); }
  trigger.addEventListener('click', () => menu.hidden ? open() : close());
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); open(); menu.querySelector('a')?.focus(); }
  });
  document.addEventListener('pointerdown', event => { if (!switcher.contains(event.target)) close(); });
  document.addEventListener('focusin', event => { if (!switcher.contains(event.target)) close(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { close(); trigger.focus(); }
  });
}

export function downloadFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
