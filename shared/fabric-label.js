import qrcode from '../vendor/qrcode-generator/qrcode.js';
import { hasFabricIdentity, parseFabricIdentity } from './fabric-identity.js';
import { normalizeFabricCategory } from './fabric-category.js';
import { downloadFile } from './navigation.js';

const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
export function fabricQrSvg(id) {
  const qr = qrcode(0, 'M');
  qr.addData(parseFabricIdentity(id), 'Byte'); qr.make();
  const size = qr.getModuleCount(), paths = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (qr.isDark(y, x)) paths.push(`M${x + 4},${y + 4}h1v1h-1z`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 8} ${size + 8}" width="296" height="296" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${paths.join('')}" fill="black"/></svg>`;
}
export function fabricLabelSvg(asset) {
  if (!hasFabricIdentity(asset)) throw new Error('面料尚未成功保存，暂不能生成标签');
  const qr = fabricQrSvg(asset.id).replace('<svg ', '<svg x="52" y="20" ');
  // foreignObject is deliberately avoided so downloaded labels print in SVG tools too.
  const line = (text, y, size = 16) => `<text x="200" y="${y}" text-anchor="middle" font-size="${size}" textLength="${String(text).length > 24 ? 352 : Math.min(352, String(text).length * size)}" lengthAdjust="spacingAndGlyphs">${escapeXml(text)}</text>`;
  const category = normalizeFabricCategory(asset.category, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="430" viewBox="0 0 400 430"><rect width="400" height="430" fill="white"/>${qr}<g fill="#18212a" font-family="Arial,Microsoft YaHei,sans-serif">${line(asset.name, 340, 20)}${line(`${category} · 色号 ${asset.fabricColorCode || '未填写'}`, 370)}${line(asset.id, 402, 11)}</g></svg>`;
}
export function mountFabricLabel(host, { compact = false } = {}) {
  host.classList.add('fabric-identity'); host.hidden = true;
  host.classList.toggle('fabric-identity-compact', compact);
  const qr = '<img class="fabric-identity-qr" alt="面料身份二维码">';
  const actionsId = `${host.id || 'fabric-label'}-actions`;
  host.innerHTML = `${compact ? '' : '<h3>面料二维码</h3>'}<p class="fabric-identity-status" role="status"></p><div class="fabric-identity-ready" hidden>${compact ? `<button type="button" class="fabric-identity-trigger" aria-label="面料二维码，下载或打印标签" aria-expanded="false" aria-controls="${actionsId}" title="点击下载或打印标签">${qr}</button>` : qr}<code class="fabric-identity-code${compact ? ' sr-only' : ''}"></code><p class="fabric-identity-description${compact ? ' sr-only' : ''}"></p><div id="${actionsId}" class="fabric-identity-actions"${compact ? ' role="group" aria-label="二维码标签操作" hidden' : ''}><button type="button" data-label-download>下载标签</button><button type="button" data-label-print>打印标签</button></div></div>`;
  let current = null;
  const ready = host.querySelector('.fabric-identity-ready');
  const status = host.querySelector('.fabric-identity-status');
  const trigger = host.querySelector('.fabric-identity-trigger');
  const actions = host.querySelector('.fabric-identity-actions');
  function closeActions({ restoreFocus = false } = {}) {
    if (!compact || actions.hidden) return;
    actions.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  if (compact) {
    trigger.onclick = () => {
      if (!actions.hidden) { closeActions(); return; }
      actions.hidden = false; trigger.setAttribute('aria-expanded', 'true');
      actions.querySelector('button').focus({ preventScroll: true });
    };
    host.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || actions.hidden) return;
      event.preventDefault(); event.stopPropagation();
      closeActions({ restoreFocus: true });
    });
    host.addEventListener('focusout', event => { if (!host.contains(event.relatedTarget)) closeActions(); });
    document.addEventListener('pointerdown', event => { if (!host.contains(event.target)) closeActions(); });
  }
  host.querySelector('[data-label-download]').onclick = () => {
    if (current) downloadFile(new Blob([fabricLabelSvg(current)], { type: 'image/svg+xml' }), `${current.name}-${current.fabricColorCode || current.id}-二维码.svg`.replace(/[\/:*?"<>|]/g, '_'));
    closeActions({ restoreFocus: true });
  };
  host.querySelector('[data-label-print]').onclick = () => {
    if (!current) return;
    closeActions({ restoreFocus: true });
    const popup = window.open('', '_blank', 'width=520,height=650');
    if (!popup) { status.textContent = '请允许打开打印窗口，或下载标签后打印'; return; }
    popup.document.open();
    popup.addEventListener('load', () => popup.print(), { once: true });
    popup.document.write(`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>面料二维码标签</title><style>body{margin:0;text-align:center}svg{width:70mm;height:auto;max-width:100%}@page{margin:10mm}</style>${fabricLabelSvg(current)}</html>`);
    popup.document.close(); popup.focus();
  };
  return {
    closeActions,
    update(asset, { state = 'ready', message = '' } = {}) {
      closeActions();
      current = null; ready.hidden = true;
      host.hidden = state === 'ready' ? !hasFabricIdentity(asset) : false;
      status.textContent = message;
      if (state !== 'ready' || !hasFabricIdentity(asset)) return;
      current = { ...asset }; ready.hidden = false;
      host.querySelector('.fabric-identity-qr').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fabricQrSvg(asset.id));
      host.querySelector('.fabric-identity-code').textContent = asset.id;
      host.querySelector('.fabric-identity-description').textContent = `${asset.name} · ${normalizeFabricCategory(asset.category, '')} · 色号 ${asset.fabricColorCode || '未填写'}`;
      status.textContent = message || (compact ? '' : '已保存，可在设计台扫码换面料');
    },
  };
}
