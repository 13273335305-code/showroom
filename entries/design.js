import { startDesign } from '../app.js';
import { mountNavigation } from '../shared/navigation.js';
import { requireAuth } from '../shared/auth.js';

window.name = 'spenic-design';
await requireAuth({ feature: 'design' });
mountNavigation('design');
startDesign().catch(error => console.error('设计台初始化失败', error));
const showcase = document.createElement('button');
showcase.type = 'button'; showcase.className = 'design-showcase-action'; showcase.textContent = '加入展示台';
showcase.title = '保存并加入展示清单'; showcase.setAttribute('aria-label', '保存并加入展示清单');
showcase.onclick = async () => {
  showcase.disabled = true;
  try {
    const saved = await window.__spenicDesignSession?.save?.();
    if (!saved?.id) return;
    const href = './showcase.html?addProject=' + encodeURIComponent(saved.id);
    if (!window.open(href, 'spenic-showcase')) location.href = href;
  } catch (error) { console.warn('加入展示清单失败', error); }
  finally { showcase.disabled = false; }
};
document.querySelector('.header-actions').append(showcase);
