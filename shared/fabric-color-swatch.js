import { fabricVariantGroupKey } from './fabric-info.js';

const fabricColorRules = {
  WBK: { base: '#f6f6f6', line: '#080808' },
  WLG: { base: '#f6f6f6', line: '#989898' },
  WBR: { base: '#f6f6f6', line: '#4e4124' },
  WWW: { base: '#f6f6f6', line: '#ededed' },
  ZGW: { base: '#4a4f55', line: '#f6f6f6' },
  DBW: { base: '#4e4124', line: '#f6f6f6' },
  GWW: { base: '#8c8c8c', line: '#f6f6f6' },
  KGW: { base: '#bdb285', line: '#f6f6f6' },
};

export function updateFabricColorSwatch(element, colorCode = '') {
  const code = colorCode.trim().toUpperCase();
  const colors = Object.hasOwn(fabricColorRules, code) ? fabricColorRules[code] : null;
  element.style.setProperty('--fabric-swatch-base', colors?.base || '#f0f3f7');
  element.style.setProperty('--fabric-swatch-line', colors?.line || 'transparent');
  element.dataset.configured = String(!!colors);
  const description = colors ? `${code}，底色 ${colors.base}，线色 ${colors.line}`
    : code ? `${code}，暂无色号预览` : '色号预览';
  element.setAttribute('aria-label', description);
  element.title = description;
}

export function renderFabricColorList(container, codes, { active, pending, onSelect = null } = {}) {
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
    button.setAttribute('aria-busy', String(code === pending?.trim().toUpperCase()));
    button.onclick = () => onSelect(code); button.append(ball);
    if (code === pending?.trim().toUpperCase()) {
      const progress = document.createElement('span'); progress.className = 'compact-fabric-progress';
      progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', '正在加载色号 ' + code);
      button.append(progress);
    }
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

