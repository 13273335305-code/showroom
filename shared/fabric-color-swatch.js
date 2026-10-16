import { fabricVariantGroupKey } from './fabric-info.js';
import { syncFabricColorProgress } from './fabric-color-progress.js';
import { fabricColor, subscribeFabricColors } from './fabric-color-store.js';

subscribeFabricColors(() => {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-fabric-color-code]').forEach(element => {
    const hadTitle = element.hasAttribute('title');
    updateFabricColorSwatch(element, element.dataset.fabricColorCode);
    if (!hadTitle) element.removeAttribute('title');
  });
});

export function updateFabricColorSwatch(element, colorCode = '') {
  const code = colorCode.trim().toUpperCase();
  const colors = fabricColor(code);
  element.dataset.fabricColorCode = code;
  element.style.setProperty('--fabric-swatch-base', colors?.base || '#f0f3f7');
  element.style.setProperty('--fabric-swatch-line', colors?.line || 'transparent');
  element.dataset.configured = String(!!colors);
  const description = colors ? `${code}，底色 ${colors.base}，线色 ${colors.line}`
    : code ? `${code}，暂无色号预览` : '色号预览';
  element.setAttribute('aria-label', description);
  element.title = description;
}

export function renderFabricColorList(container, codes, { active, pending, progress = null, onSelect = null } = {}) {
  const document = container.ownerDocument;
  const unique = [...new Set(codes.map(code => String(code).trim().toUpperCase()).filter(Boolean))];
  container.replaceChildren(...unique.map(code => {
    const ball = document.createElement('span'); ball.className = 'fabric-color-swatch';
    ball.setAttribute('role', 'img');
    const lines = document.createElement('span'); lines.className = 'fabric-color-swatch-lines'; lines.setAttribute('aria-hidden', 'true');
    ball.append(lines); updateFabricColorSwatch(ball, code); ball.removeAttribute('title');
    if (!onSelect) return ball;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'compact-fabric-color';
    button.setAttribute('aria-label', '切换色号 ' + code);
    button.setAttribute('aria-pressed', String(code === active?.trim().toUpperCase()));
    button.onclick = () => onSelect(code); button.append(ball);
    syncFabricColorProgress(button, { pending: code === pending?.trim().toUpperCase(), progress });
    return button;
  }));
  container.hidden = unique.length === 0;
}

export function renderBatchFabricSwatches(container, variants) {
  const document = container.ownerDocument;
  const selected = new Map(), buttons = [];
  for (const variant of variants) {
    const key = fabricVariantGroupKey(variant);
    if (!selected.has(key) || variant.isDefaultColor) selected.set(key, variant);
  }
  const sync = () => buttons.forEach(({ variant, button }) => {
    variant.isDefaultColor = selected.get(fabricVariantGroupKey(variant)) === variant;
    button.setAttribute('aria-pressed', String(variant.isDefaultColor));
  });
  container.replaceChildren(...variants.map(variant => {
    const item = document.createElement('li');
    item.className = 'batch-fabric-swatch-item';
    item.title = variant.file.webkitRelativePath || variant.file.name;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'batch-fabric-swatch-button';
    button.setAttribute('aria-label', '设为默认色号 ' + variant.fabricColorCode.trim().toUpperCase());
    button.title = variant.fabricColorCode.trim().toUpperCase();
    button.onclick = () => { selected.set(fabricVariantGroupKey(variant), variant); sync(); };
    buttons.push({ variant, button });
    const swatch = document.createElement('span');
    swatch.className = 'fabric-color-swatch';
    swatch.setAttribute('role', 'img');
    const lines = document.createElement('span');
    lines.className = 'fabric-color-swatch-lines';
    lines.setAttribute('aria-hidden', 'true');
    swatch.append(lines);
    updateFabricColorSwatch(swatch, variant.fabricColorCode);
    button.append(swatch); item.append(button);
    return item;
  }));
  sync();
}

