import { fabricColors, refreshFabricColors, saveFabricColors } from './fabric-color-store.js';
import { createFabricColorEditor } from './fabric-color-editor.js';

const entry = document.getElementById('systemConfigEntry');
const dialog = document.createElement('dialog');
dialog.id = 'systemConfigDialog'; dialog.className = 'system-config-dialog';
dialog.setAttribute('aria-labelledby', 'systemConfigTitle');
dialog.innerHTML = `<div id="systemConfigScroll" class="system-config-scroll"><div id="systemConfigContent">
<header class="system-config-header">
  <button type="button" id="systemConfigBack" class="system-config-icon-button" aria-label="返回系统配置" hidden><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 6-6 6 6 6"/></svg></button>
  <div><span class="system-config-eyebrow">WORKSPACE SETTINGS</span><h2 id="systemConfigTitle">系统配置</h2></div>
  <button type="button" class="system-config-icon-button system-config-close" aria-label="关闭系统配置"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
</header>
<section id="systemConfigMenu" class="system-config-grid" aria-label="系统配置选项"></section>
<section id="systemConfigColors" hidden>
  <div class="system-config-body">
    <div class="system-color-head" aria-hidden="true"><span>色号球</span><span>色号</span><span>底色</span><span>线色</span><span></span></div>
    <div id="systemColorRows" aria-label="色号球配置列表"></div>
    <button id="systemColorAdd" class="system-config-add" type="button"><span aria-hidden="true">＋</span>新增色号球</button>
  </div>
  <div id="systemConfigFeedback" class="system-config-feedback" hidden><p id="systemConfigStatus" class="system-config-status" role="status" aria-live="polite"></p><button id="systemConfigRetry" class="system-config-retry" type="button" hidden>重新加载</button></div>
</section>
<div id="systemConfigDiscard" class="system-config-discard" hidden><p>有尚未保存的修改，是否放弃？</p><button id="systemConfigKeep" type="button">继续编辑</button><button id="systemConfigLeave" type="button">放弃修改</button></div>
</div></div><div id="systemConfigScrollbar" class="system-config-scrollbar" aria-hidden="true" hidden><span class="system-config-scrollbar-thumb"></span></div>`;
document.body.append(dialog);
const $ = id => dialog.querySelector('#' + id);
const rows = $('systemColorRows');
const scroll = $('systemConfigScroll'), scrollbar = $('systemConfigScrollbar');
const scrollThumb = scrollbar.querySelector('.system-config-scrollbar-thumb');
function syncScrollbar() {
  const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  scrollbar.hidden = maxScroll <= 1;
  if (scrollbar.hidden) return;
  const trackHeight = scrollbar.clientHeight;
  const minimum = window.innerWidth <= 800 ? 56 : 72;
  const height = Math.min(trackHeight, Math.max(minimum, Math.round(trackHeight * scroll.clientHeight / scroll.scrollHeight)));
  const travel = Math.max(0, trackHeight - height);
  scrollThumb.style.height = `${height}px`;
  scrollThumb.style.transform = `translateY(${Math.round(travel * scroll.scrollTop / maxScroll)}px)`;
}
let scrollbarDrag = null;
scrollbar.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault();
  if (event.target === scrollThumb) {
    scrollbarDrag = { pointerId: event.pointerId, startY: event.clientY, startScroll: scroll.scrollTop };
    scrollThumb.setPointerCapture(event.pointerId);
  } else {
    const bounds = scrollbar.getBoundingClientRect();
    const travel = Math.max(1, bounds.height - scrollThumb.offsetHeight);
    const offset = Math.max(0, Math.min(travel, event.clientY - bounds.top - scrollThumb.offsetHeight / 2));
    scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight) * offset / travel;
  }
  syncScrollbar();
});
scrollbar.addEventListener('pointermove', event => {
  if (!scrollbarDrag || scrollbarDrag.pointerId !== event.pointerId) return;
  const travel = Math.max(1, scrollbar.clientHeight - scrollThumb.offsetHeight);
  scroll.scrollTop = scrollbarDrag.startScroll + (event.clientY - scrollbarDrag.startY) * Math.max(0, scroll.scrollHeight - scroll.clientHeight) / travel;
  syncScrollbar();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) scrollbar.addEventListener(type, () => { scrollbarDrag = null; });
scrollbar.addEventListener('wheel', event => {
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientHeight : 1;
  scroll.scrollTop += event.deltaY * unit;
  syncScrollbar();
}, { passive: false });
scroll.addEventListener('scroll', syncScrollbar, { passive: true });
window.addEventListener('resize', syncScrollbar);
const scrollObserver = new ResizeObserver(syncScrollbar);
scrollObserver.observe(scroll); scrollObserver.observe($('systemConfigContent'));
const editor = createFabricColorEditor(saveFabricColors);
let busy = false, loaded = false, colorsPage = false, leaveAction;
function ball() {
  const element = document.createElement('span'); element.className = 'fabric-color-swatch';
  element.setAttribute('role', 'img');
  element.innerHTML = '<span class="fabric-color-swatch-lines" aria-hidden="true"></span>';
  return element;
}
const menuBall = ball();
const colorOption = document.createElement('button'); colorOption.type = 'button'; colorOption.className = 'system-config-slot';
colorOption.setAttribute('aria-label', '色号球配置');
colorOption.append(menuBall, document.createTextNode('色号球配置')); colorOption.onclick = openColors;
$('systemConfigMenu').append(colorOption);
for (let i = 1; i < 9; i++) {
  const slot = document.createElement('button'); slot.type = 'button'; slot.className = 'system-config-slot'; slot.disabled = true;
  slot.setAttribute('aria-label', `预留配置 ${i + 1}`); slot.innerHTML = '<span aria-hidden="true">＋</span>'; $('systemConfigMenu').append(slot);
}
function preview(element, value) {
  element.style.setProperty('--fabric-swatch-base', value.base);
  element.style.setProperty('--fabric-swatch-line', value.line);
  element.setAttribute('aria-label', `${value.code || '新色号'}，底色 ${value.base}，线色 ${value.line}`);
}
function status(message, error = false) { $('systemConfigStatus').textContent = message; $('systemConfigStatus').dataset.error = String(error); $('systemConfigFeedback').hidden = !message; }
const dirty = () => editor.dirty;
function syncBusy() {
  dialog.querySelectorAll('#systemConfigColors input, .system-color-action').forEach(control => { control.disabled = busy || !loaded; });
  dialog.querySelectorAll('.system-color-edit').forEach(control => { control.disabled = busy || !loaded || !!editor.editing; });
  $('systemColorAdd').disabled = busy || !loaded || !!editor.editing;
  dialog.setAttribute('aria-busy', String(busy));
}
function changed() { $('systemConfigDiscard').hidden = true; status('有未保存的修改'); }
function focusRow(index, selector = '.system-color-edit') { rows.children[index]?.querySelector(selector)?.focus({ preventScroll: true }); }
function actionButton(className, label, path, action) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'system-color-action ' + className;
  button.setAttribute('aria-label', label);
  if (path) button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
  else button.textContent = '编辑';
  button.onclick = action;
  return button;
}
function renderRows() {
  const top = scroll.scrollTop, editing = editor.editing, items = editor.colors;
  if (editing) items[editing.index] = editing.value;
  rows.replaceChildren();
  for (let index = 0; index < items.length; index++) {
    const item = items[index], row = document.createElement('div'); row.className = 'system-color-row';
    const active = editing?.index === index;
    row.dataset.editing = String(active);
    const swatch = ball(); preview(swatch, item); row.append(swatch);
    const code = document.createElement(active ? 'input' : 'span'); code.className = 'system-color-code';
    if (active) {
      code.type = 'text'; code.value = item.code; code.maxLength = 3; code.autocomplete = 'off'; code.spellcheck = false; code.placeholder = 'ABC'; code.setAttribute('aria-label', `第 ${index + 1} 行色号`);
      code.oninput = () => { item.code = code.value.trim().toUpperCase(); editor.update('code', item.code); code.value = item.code; code.setAttribute('aria-invalid', String(!/^[A-Z]{3}$/.test(item.code))); preview(swatch, item); changed(); };
    } else code.textContent = item.code;
    row.append(code);
    for (const [key, label] of [['base', '底色'], ['line', '线色']]) {
      const control = document.createElement('div'); control.className = 'system-color-value';
      if (active) {
        const picker = document.createElement('input'); picker.type = 'color'; picker.value = item[key]; picker.setAttribute('aria-label', `第 ${index + 1} 行${label}选择器`);
        const hex = document.createElement('input'); hex.type = 'text'; hex.className = 'system-color-hex'; hex.value = item[key]; hex.maxLength = 7; hex.spellcheck = false; hex.autocomplete = 'off'; hex.setAttribute('aria-label', `第 ${index + 1} 行${label} HEX`);
        picker.oninput = () => { item[key] = picker.value; editor.update(key, item[key]); hex.value = picker.value; hex.setAttribute('aria-invalid', 'false'); preview(swatch, item); changed(); };
        hex.oninput = () => { item[key] = hex.value; editor.update(key, item[key]); const valid = /^#[\da-f]{6}$/i.test(hex.value); hex.setAttribute('aria-invalid', String(!valid)); if (valid) { picker.value = hex.value; preview(swatch, item); } changed(); };
        control.append(picker, hex);
      } else {
        const chip = document.createElement('span'); chip.className = 'system-color-chip'; chip.style.backgroundColor = item[key]; chip.setAttribute('aria-hidden', 'true');
        const hex = document.createElement('span'); hex.className = 'system-color-hex'; hex.textContent = item[key];
        control.append(chip, hex);
      }
      row.append(control);
    }
    const actions = document.createElement('div'); actions.className = 'system-color-actions';
    if (active) {
      actions.append(actionButton('system-color-cancel', '取消编辑色号 ' + (item.code || '新色号'), 'm6 6 12 12M18 6 6 18', () => {
        editor.cancel(); renderRows(); status('已取消修改'); if (editing.isNew) $('systemColorAdd').focus({ preventScroll: true }); else focusRow(index);
      }), actionButton('system-color-confirm', '保存色号 ' + (item.code || '新色号'), 'm5 12 4 4L19 6', saveRow));
    } else actions.append(actionButton('system-color-edit', '编辑色号 ' + item.code, null, () => {
      if (!editor.begin(index)) return;
      renderRows(); status('编辑后点击 √ 保存，或点击 × 取消。'); focusRow(index, 'input');
    }));
    row.append(actions);
    rows.append(row);
  }
  scroll.scrollTop = top;
  syncBusy();
}
async function saveRow() {
  const editing = editor.editing;
  if (!editing || busy || !loaded) return;
  busy = true; syncBusy(); status('正在保存全站配置…'); $('systemConfigDiscard').hidden = true;
  try {
    const result = await editor.commit(); renderRows(); preview(menuBall, result[0]);
    status(`已保存 ${result[editing.index].code}，全站色号球已更新`);
  } catch (error) { status(error.message, true); }
  finally { busy = false; syncBusy(); if (!editor.editing) focusRow(editing.index); }
}
async function openColors() {
  colorsPage = true; $('systemConfigMenu').hidden = true; $('systemConfigColors').hidden = false; $('systemConfigBack').hidden = false;
  $('systemConfigTitle').textContent = '色号球配置';
  await load();
}
async function load() {
  busy = true; loaded = false; status('正在读取全站色号配置…'); $('systemConfigRetry').hidden = true;
  editor.reset(fabricColors()); renderRows();
  try {
    editor.reset(await refreshFabricColors()); loaded = true; renderRows();
    status('');
  } catch (error) { status(error.message, true); $('systemConfigRetry').hidden = false; }
  finally { busy = false; syncBusy(); if (loaded && dialog.open && colorsPage) rows.querySelector('.system-color-edit')?.focus({ preventScroll: true }); }
}
function menu() {
  editor.cancel();
  colorsPage = false; $('systemConfigMenu').hidden = false; $('systemConfigColors').hidden = true; $('systemConfigBack').hidden = true;
  $('systemConfigTitle').textContent = '系统配置'; $('systemConfigDiscard').hidden = true;
  preview(menuBall, fabricColors()[0]); colorOption.focus({ preventScroll: true });
  scroll.scrollTop = 0;
}
function leave(action) {
  if (busy && loaded) return;
  if (colorsPage && loaded && dirty()) { leaveAction = action; $('systemConfigDiscard').hidden = false; $('systemConfigKeep').focus(); return; }
  action();
}
entry?.addEventListener('click', () => { menu(); dialog.showModal(); syncScrollbar(); });
$('systemConfigBack').onclick = () => leave(menu);
dialog.querySelector('.system-config-close').onclick = () => leave(() => dialog.close());
dialog.addEventListener('cancel', event => { event.preventDefault(); leave(() => dialog.close()); });
dialog.addEventListener('close', () => { $('systemConfigDiscard').hidden = true; entry?.focus({ preventScroll: true }); });
dialog.addEventListener('click', event => {
  const b = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom)) leave(() => dialog.close());
});
$('systemConfigKeep').onclick = () => { $('systemConfigDiscard').hidden = true; rows.querySelector('input')?.focus(); };
$('systemConfigLeave').onclick = () => { $('systemConfigDiscard').hidden = true; leaveAction?.(); };
$('systemConfigRetry').onclick = load;
$('systemColorAdd').onclick = () => {
  try {
    if (!editor.add()) return;
    renderRows(); changed();
    const input = rows.children[editor.editing.index].querySelector('input'); input.focus(); input.scrollIntoView({ block: 'nearest' });
  } catch (error) { status(error.message, true); }
};
preview(menuBall, fabricColors()[0]);
window.addEventListener('beforeunload', event => {
  if (dialog.open && colorsPage && loaded && dirty()) { event.preventDefault(); event.returnValue = ''; }
});
