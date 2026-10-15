import { updateFabricColorSwatch } from './fabric-color-swatch.js';

// The picker previews colors without changing the selected material.
export function mountPickerFabricColors(bar, asset, isBusy = () => false) {
  const document = bar.ownerDocument, variants = asset.fabricVariants;
  let expanded = false, capacity = 0;
  const render = () => {
    // 16px horizontal padding, 28px slots and 4px gaps; at most eight slots.
    const nextCapacity = Math.max(2, Math.min(8, Math.floor((bar.clientWidth - 12) / 32)));
    if (capacity === nextCapacity && bar.children.length) return;
    capacity = nextCapacity;
    bar.style.setProperty('--picker-color-columns', String(capacity));
    const visibleCount = variants.length > capacity ? capacity - 1 : variants.length;
    bar.replaceChildren();
    const ballItem = variant => {
      const item = document.createElement('span'); item.className = 'picker-fabric-color';
      item.dataset.default = String(variant.id === asset.id);
      const ball = document.createElement('span'); ball.className = 'fabric-color-swatch';
      const lines = document.createElement('span'); lines.className = 'fabric-color-swatch-lines';
      ball.append(lines); updateFabricColorSwatch(ball, variant.fabricColorCode);
      ball.removeAttribute('title'); item.append(ball); return item;
    };
    const row = document.createElement('div'); row.className = 'picker-fabric-color-row';
    for (const variant of variants.slice(0, visibleCount)) row.append(ballItem(variant));
    bar.append(row);
    if (variants.length <= capacity) { expanded = false; return; }
    const remaining = variants.length - visibleCount;
    const more = document.createElement('button'); more.type = 'button'; more.className = 'picker-fabric-more';
    more.textContent = '+' + remaining;
    more.setAttribute('aria-label', `展开其余 ${remaining} 个色号`);
    more.setAttribute('aria-expanded', String(expanded));
    const extra = document.createElement('div'); extra.className = 'picker-fabric-color-extra'; extra.hidden = !expanded;
    for (const variant of variants.slice(visibleCount)) extra.append(ballItem(variant));
    more.onclick = event => {
      event.stopPropagation();
      if (isBusy()) return;
      expanded = !expanded; extra.hidden = !expanded;
      more.setAttribute('aria-expanded', String(expanded));
      more.setAttribute('aria-label', expanded ? '收起其余色号' : `展开其余 ${remaining} 个色号`);
    };
    row.append(more); bar.append(extra);
  };
  const observer = new ResizeObserver(render); observer.observe(bar); render();
  return () => observer.disconnect();
}
