export function mountNavigation(active) {
  if (active !== 'design') window.name = 'spenic-secondary';
  const header = document.querySelector('.topbar');
  const brand = header.querySelector('.brand');
  brand.innerHTML = '<img class="brand-logo" src="assets/spenic-logo.png" alt="Spenic"><span class="brand-divider"></span><strong class="brand-title">' + (active === 'design' ? '\u8bbe\u8ba1\u53f0' : '\u5de5\u4f5c\u7a7a\u95f4') + '</strong>';
  brand.setAttribute('aria-label', 'Spenic \u5de5\u4f5c\u7a7a\u95f4\u9996\u9875');
  const existingNavigation = header.querySelector('.app-navigation');
  if (active === 'design') {
    existingNavigation?.remove();
    return;
  }
  const nav = existingNavigation || document.createElement('nav');
  nav.replaceChildren();
  nav.className = 'app-navigation';
  nav.setAttribute('aria-label', '\u5de5\u4f5c\u7a7a\u95f4\u5165\u53e3');
  const links = [['design', '\u8bbe\u8ba1\u53f0', './design.html'], ['material', '\u6750\u8d28\u7f16\u8f91\u5668', './material-editor.html'], ['assets', '\u8d44\u4ea7\u5e93', './asset-library.html']];
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

export function downloadFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
