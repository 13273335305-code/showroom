import { fabricColors, refreshFabricColors, saveFabricColors } from './fabric-color-store.js';
import { createFabricColorEditor } from './fabric-color-editor.js';
import { CAPTURE_AI_PROMPT_DEFAULTS, createCaptureAiPromptStore, readCaptureAiPrompts } from './capture-ai-prompts.js';
import { createCaptureAiStore } from './capture-ai-store.js';
import { createSceneConfigStore, SCENE_IDS, SCENE_LABELS, makeSceneConfig } from './scene-config.js';
import { unpackScene } from './scene-file.js';
import { authState, workspaceClient } from './auth.js';

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
<section id="systemConfigPrompts" hidden>
  <div class="system-config-body system-ai-prompt-body">
    <label class="system-ai-base-field">API 地址 · 全站共用<input id="systemAiBase" type="url" autocomplete="url" aria-describedby="systemAiBaseHint"></label>
    <p id="systemAiBaseHint" class="system-ai-base-hint">全站统一使用此地址，修改后所有账号和设备都会生效。</p>
    <p class="system-ai-prompt-intro">配置拍摄属性中的快捷提示词，最多 5 条。每条快捷提示词对应一段发送给 AI 的具体提示词。</p>
    <div class="system-ai-prompt-head" aria-hidden="true"><span>快捷提示词</span><span>具体提示词</span><span></span></div>
    <div id="systemAiPromptRows" aria-label="AI 绘画快捷提示词列表"></div>
    <button id="systemAiPromptAdd" class="system-config-add" type="button"><span aria-hidden="true">＋</span>新增快捷提示词</button>
    <button id="systemAiPromptSave" class="system-ai-prompt-save" type="button">保存 AI 绘画配置</button>
  </div>
  <div id="systemAiPromptFeedback" class="system-config-feedback" hidden><p id="systemAiPromptStatus" class="system-config-status" role="status" aria-live="polite"></p><button id="systemAiPromptRetry" class="system-config-retry" type="button" hidden>重新加载</button></div>
</section>
<section id="systemConfigScenes" hidden>
  <div class="system-config-body system-scene-config-body">
    <p class="system-scene-intro">上传三个全站共用的光影场景文件，并选择打开设计台时使用的默认场景。</p>
    <div id="systemSceneRows" aria-label="光影流转场景文件"></div>
    <fieldset class="system-scene-defaults"><legend>默认场景</legend><div id="systemSceneDefaults"></div></fieldset>
  </div>
  <div id="systemSceneFeedback" class="system-config-feedback" hidden><p id="systemSceneStatus" class="system-config-status" role="status" aria-live="polite"></p><button id="systemSceneRetry" class="system-config-retry" type="button" hidden>重新加载</button></div>
</section>
<div id="systemConfigDiscard" class="system-config-discard" hidden><p>有尚未保存的修改，是否放弃？</p><button id="systemConfigKeep" type="button">继续编辑</button><button id="systemConfigLeave" type="button">放弃修改</button></div>
</div></div><div id="systemConfigScrollbar" class="system-config-scrollbar" aria-hidden="true" hidden><span class="system-config-scrollbar-thumb"></span></div>`;
document.body.append(dialog);
const $ = id => dialog.querySelector('#' + id);
function syncSystemConfigAccess() {
  const allowed = authState()?.canManageSystemConfig === true;
  if (entry) entry.hidden = !allowed;
  if (!allowed && dialog.open) dialog.close();
  return allowed;
}
window.addEventListener('spenic-auth-change', syncSystemConfigAccess);
syncSystemConfigAccess();
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
const captureAiStore = createCaptureAiStore({ access: workspaceClient });
const promptStore = createCaptureAiPromptStore({ access: workspaceClient });
const sceneStore = createSceneConfigStore({ access: workspaceClient });
let busy = false, loaded = false, colorsPage = false, promptsPage = false, scenesPage = false, leaveAction;
let promptBusy = false, promptLoaded = false, promptCanEdit = false, promptOwnerId = '', promptDirty = false;
let promptBase = '', promptBaseLoaded = false, promptBaseCanEdit = false, promptBaseDirty = false;
let promptItems = CAPTURE_AI_PROMPT_DEFAULTS.map(item => ({ ...item }));
let sceneBusy = false, sceneLoaded = false, sceneCanEdit = false, sceneOwnerId = '', sceneConfig = null;
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
const promptOption = document.createElement('button'); promptOption.type = 'button'; promptOption.className = 'system-config-slot';
promptOption.setAttribute('aria-label', 'AI 绘画配置');
promptOption.innerHTML = '<span class="system-ai-prompt-icon" aria-hidden="true">✦</span>AI 绘画配置'; promptOption.onclick = openPrompts;
$('systemConfigMenu').append(promptOption);
const sceneOption = document.createElement('button'); sceneOption.type = 'button'; sceneOption.className = 'system-scene-config-option';
sceneOption.setAttribute('aria-label', '光影流转配置');
sceneOption.innerHTML = '<span class="system-scene-icon" aria-hidden="true">☼</span>光影流转配置'; sceneOption.onclick = openScenes;
$('systemConfigMenu').append(sceneOption);
for (let i = 1; i < 8; i++) {
  const slot = document.createElement('button'); slot.type = 'button'; slot.className = 'system-config-slot'; slot.disabled = true;
  slot.setAttribute('aria-label', `预留配置 ${i + 1}`); slot.innerHTML = '<span aria-hidden="true">＋</span>'; $('systemConfigMenu').append(slot);
}
function preview(element, value) {
  if (!value) {
    element.style.setProperty('--fabric-swatch-base', '#f0f3f7');
    element.style.setProperty('--fabric-swatch-line', 'transparent');
    element.setAttribute('aria-label', '暂无色号球');
    return;
  }
  element.style.setProperty('--fabric-swatch-base', value.base);
  element.style.setProperty('--fabric-swatch-line', value.line);
  element.setAttribute('aria-label', `${value.code || '新色号'}，底色 ${value.base}，线色 ${value.line}`);
}
function status(message, error = false) { $('systemConfigStatus').textContent = message; $('systemConfigStatus').dataset.error = String(error); $('systemConfigFeedback').hidden = !message; }
function promptStatus(message = '', error = false) { $('systemAiPromptStatus').textContent = message; $('systemAiPromptStatus').dataset.error = String(error); $('systemAiPromptFeedback').hidden = !message; }
function sceneStatus(message = '', error = false) { $('systemSceneStatus').textContent = message; $('systemSceneStatus').dataset.error = String(error); $('systemSceneFeedback').hidden = !message; }
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
      actions.append(actionButton('system-color-delete', '删除色号 ' + (item.code || '新色号'), 'M6 12h12', deleteRow), actionButton('system-color-cancel', '取消编辑色号 ' + (item.code || '新色号'), 'm6 6 12 12M18 6 6 18', () => {
        editor.cancel(); renderRows(); status('已取消修改'); if (editing.isNew) $('systemColorAdd').focus({ preventScroll: true }); else focusRow(index);
      }), actionButton('system-color-confirm', '保存色号 ' + (item.code || '新色号'), 'm5 12 4 4L19 6', saveRow));
    } else actions.append(actionButton('system-color-edit', '编辑色号 ' + item.code, null, () => {
      if (!editor.begin(index)) return;
      renderRows(); status('编辑后点击 √ 保存、× 取消，或点击 − 删除。'); focusRow(index, 'input');
    }));
    row.append(actions);
    rows.append(row);
  }
  scroll.scrollTop = top;
  syncBusy();
}
function promptChanged() {
  promptDirty = true;
  syncPromptSave();
  promptStatus('有未保存的修改');
}
function promptBaseChanged() {
  promptBase = $('systemAiBase').value.trim(); promptBaseDirty = true;
  syncPromptSave(); promptStatus('有未保存的修改');
}
function syncPromptSave() {
  const promptSaveable = promptDirty && promptLoaded && promptCanEdit;
  const baseSaveable = promptBaseDirty && promptBaseLoaded && promptBaseCanEdit;
  $('systemAiPromptSave').disabled = promptBusy || !(promptSaveable || baseSaveable);
}
function renderPromptBase() {
  const input = $('systemAiBase'); if (!input) return;
  input.value = promptBase;
  input.disabled = promptBusy || !promptBaseLoaded || !promptBaseCanEdit;
  syncPromptSave();
}
function renderPromptRows() {
  const promptRows = $('systemAiPromptRows'); if (!promptRows) return;
  promptRows.replaceChildren();
  promptItems.forEach((item, index) => {
    const row = document.createElement('div'); row.className = 'system-ai-prompt-row'; row.dataset.index = String(index);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'system-ai-prompt-remove'; remove.textContent = '删除'; remove.setAttribute('aria-label', `删除快捷提示词 ${index + 1}`);
    remove.disabled = promptBusy || !promptLoaded || !promptCanEdit;
    remove.onclick = () => { promptItems.splice(index, 1); promptDirty = true; renderPromptRows(); promptStatus('有未保存的修改'); };
    const label = document.createElement('label'); label.className = 'system-ai-prompt-field';
    const labelInput = document.createElement('input'); labelInput.type = 'text'; labelInput.maxLength = 80; labelInput.value = item.label; labelInput.disabled = promptBusy || !promptLoaded || !promptCanEdit; labelInput.setAttribute('aria-label', `第 ${index + 1} 条快捷提示词名称`);
    labelInput.oninput = () => { promptItems[index].label = labelInput.value; promptChanged(); };
    label.append(labelInput);
    const detail = document.createElement('label'); detail.className = 'system-ai-prompt-field';
    const detailInput = document.createElement('textarea'); detailInput.rows = 1; detailInput.maxLength = 2000; detailInput.value = item.prompt; detailInput.disabled = promptBusy || !promptLoaded || !promptCanEdit; detailInput.setAttribute('aria-label', `第 ${index + 1} 条具体提示词`);
    detailInput.oninput = () => { promptItems[index].prompt = detailInput.value; promptChanged(); };
    detail.append(detailInput); row.append(label, detail, remove); promptRows.append(row);
  });
  $('systemAiPromptAdd').disabled = promptBusy || !promptLoaded || !promptCanEdit || promptItems.length >= 5;
  renderPromptBase();
}
async function openPrompts() {
  promptsPage = true; colorsPage = false; $('systemConfigMenu').hidden = true; $('systemConfigColors').hidden = true; $('systemConfigPrompts').hidden = false; $('systemConfigBack').hidden = false;
  $('systemConfigTitle').textContent = 'AI 绘画配置'; await loadPrompts();
}
async function loadPrompts() {
  promptBusy = true; promptLoaded = false; promptBaseLoaded = false; promptDirty = false; promptBaseDirty = false; promptCanEdit = false; promptBaseCanEdit = false; promptStatus('正在读取 AI 绘画配置…'); $('systemAiPromptRetry').hidden = true; renderPromptRows();
  try {
    const session = await workspaceClient(); promptOwnerId = session.userId; promptCanEdit = Boolean(session.canManageSystemConfig); promptBaseCanEdit = Boolean(session.canManageSite || session.canManageSystemConfig);
    const [prompts, base] = await Promise.all([promptStore.load(), captureAiStore.loadSite(promptOwnerId)]);
    promptItems = readCaptureAiPrompts(prompts); promptBase = base; promptLoaded = true; promptBaseLoaded = true; renderPromptRows();
    const readOnly = [!promptCanEdit && '快捷提示词当前账号只能查看', !promptBaseCanEdit && 'API 地址当前账号只能查看'].filter(Boolean);
    promptStatus(readOnly.length ? readOnly.join('，需管理员授权后才能修改') : '');
  } catch (error) { promptStatus(error.message, true); $('systemAiPromptRetry').hidden = false; }
  finally { promptBusy = false; renderPromptRows(); }
}
async function savePrompts() {
  const savePrompt = promptDirty && promptLoaded && promptCanEdit, saveBase = promptBaseDirty && promptBaseLoaded && promptBaseCanEdit;
  if (promptBusy || (!savePrompt && !saveBase)) return;
  promptBusy = true; renderPromptRows(); promptStatus('正在保存 AI 绘画配置…'); $('systemConfigDiscard').hidden = true;
  try {
    if (saveBase) { promptBase = await captureAiStore.saveSite(promptOwnerId, promptBase); promptBaseDirty = false; }
    if (savePrompt) { promptItems = readCaptureAiPrompts(promptItems); promptItems = await promptStore.save(promptOwnerId, promptItems); promptDirty = false; }
    renderPromptRows(); promptStatus('AI 绘画配置已保存');
  }
  catch (error) { promptStatus(error.message, true); }
  finally { promptBusy = false; renderPromptRows(); }
}
function renderSceneConfig() {
  const rows = $('systemSceneRows'), defaults = $('systemSceneDefaults');
  if (!rows || !defaults || !sceneConfig) return;
  rows.replaceChildren(); defaults.replaceChildren();
  for (const id of SCENE_IDS) {
    const item = sceneConfig.scenes[id], row = document.createElement('div'); row.className = 'system-scene-row';
    const copy = document.createElement('div'); copy.className = 'system-scene-copy';
    const title = document.createElement('strong'); title.textContent = SCENE_LABELS[id] + '场景';
    const name = document.createElement('span'); name.className = 'system-scene-name'; name.textContent = item.filename || item.name; name.title = name.textContent;
    copy.append(title, name);
    const label = document.createElement('label'); label.className = 'system-scene-upload'; label.textContent = '上传场景文件';
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.formscene,.json,application/json'; input.disabled = sceneBusy || !sceneLoaded || !sceneCanEdit;
    input.setAttribute('aria-label', `上传${SCENE_LABELS[id]}场景文件`);
    input.onchange = async () => {
      const file = input.files?.[0]; input.value = ''; if (!file || sceneBusy || !sceneLoaded || !sceneCanEdit) return;
      try {
        const saved = await unpackScene(file);
        const filename = String(file.name || '').split(/[\\/]/).pop() || '';
        const next = makeSceneConfig({ ...sceneConfig.scenes, [id]: { ...saved, filename } }, sceneConfig.defaultScene);
        await saveSceneConfig(next, `已更新${SCENE_LABELS[id]}场景，全站已生效`);
      } catch (error) { sceneStatus(error.message, true); }
    };
    label.append(input); row.append(copy, label); rows.append(row);
    const defaultLabel = document.createElement('label'); defaultLabel.className = 'system-scene-default-option';
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'systemSceneDefault'; radio.value = id; radio.checked = sceneConfig.defaultScene === id; radio.disabled = sceneBusy || !sceneLoaded || !sceneCanEdit;
    radio.setAttribute('aria-label', `设置${SCENE_LABELS[id]}为默认场景`);
    radio.onchange = async () => {
      if (!radio.checked || sceneBusy || !sceneLoaded || !sceneCanEdit || sceneConfig.defaultScene === id) return;
      try {
        const next = makeSceneConfig(sceneConfig.scenes, id);
        await saveSceneConfig(next, `默认场景已设置为${SCENE_LABELS[id]}`);
      } catch (error) { radio.checked = sceneConfig.defaultScene === id; sceneStatus(error.message, true); }
    };
    defaultLabel.append(radio, document.createTextNode(SCENE_LABELS[id])); defaults.append(defaultLabel);
  }
}
async function openScenes() {
  scenesPage = true; colorsPage = false; promptsPage = false; $('systemConfigMenu').hidden = true; $('systemConfigColors').hidden = true; $('systemConfigPrompts').hidden = true; $('systemConfigScenes').hidden = false; $('systemConfigBack').hidden = false;
  $('systemConfigTitle').textContent = '光影流转配置'; await loadScenes();
}
async function loadScenes() {
  sceneBusy = true; sceneLoaded = false; sceneCanEdit = false; sceneStatus('正在读取光影流转配置…'); $('systemSceneRetry').hidden = true; renderSceneConfig();
  try {
    const session = await workspaceClient(); sceneOwnerId = session.userId; sceneCanEdit = Boolean(session.canManageSystemConfig);
    sceneConfig = await sceneStore.load(); sceneLoaded = true; renderSceneConfig();
    sceneStatus(sceneCanEdit ? '' : '当前账号只能查看，需管理员授权后才能修改');
  } catch (error) { sceneStatus(error.message, true); $('systemSceneRetry').hidden = false; }
  finally { sceneBusy = false; renderSceneConfig(); }
}
async function saveSceneConfig(value, message) {
  if (sceneBusy || !sceneLoaded || !sceneCanEdit) return;
  sceneBusy = true; renderSceneConfig(); sceneStatus('正在保存全站光影流转配置…');
  try { sceneConfig = await sceneStore.save(sceneOwnerId, value); sceneStatus(message); }
  catch (error) { sceneStatus(error.message, true); throw error; }
  finally { sceneBusy = false; renderSceneConfig(); }
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
async function deleteRow() {
  const editing = editor.editing;
  if (!editing || busy || !loaded) return;
  const code = editor.colors[editing.index]?.code;
  busy = true; syncBusy(); status('正在删除色号球…'); $('systemConfigDiscard').hidden = true;
  try {
    const result = await editor.remove(); renderRows(); preview(menuBall, result[0]);
    status(editing.isNew ? '已移除新增草稿' : `已删除 ${code}，全站色号球已更新`);
  } catch (error) { status(error.message, true); }
  finally {
    busy = false; syncBusy();
    if (!editor.editing) {
      if (editing.isNew || !editor.colors.length) $('systemColorAdd').focus({ preventScroll: true });
      else focusRow(Math.min(editing.index, editor.colors.length - 1));
    }
  }
}
async function openColors() {
  colorsPage = true; promptsPage = false; $('systemConfigMenu').hidden = true; $('systemConfigColors').hidden = false; $('systemConfigPrompts').hidden = true; $('systemConfigBack').hidden = false;
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
  colorsPage = false; promptsPage = false; scenesPage = false; $('systemConfigMenu').hidden = false; $('systemConfigColors').hidden = true; $('systemConfigPrompts').hidden = true; $('systemConfigScenes').hidden = true; $('systemConfigBack').hidden = true;
  $('systemConfigTitle').textContent = '系统配置'; $('systemConfigDiscard').hidden = true; promptDirty = false; promptBaseDirty = false;
  preview(menuBall, fabricColors()[0]); colorOption.focus({ preventScroll: true });
  scroll.scrollTop = 0;
}
function leave(action) {
  if (busy && loaded) return;
  if (colorsPage && loaded && dirty()) { leaveAction = action; $('systemConfigDiscard').hidden = false; $('systemConfigKeep').focus(); return; }
  if (promptsPage && (promptDirty || promptBaseDirty)) { leaveAction = action; $('systemConfigDiscard').hidden = false; $('systemConfigKeep').focus(); return; }
  action();
}
let opening = false;
entry?.addEventListener('click', async () => {
  if (opening || !syncSystemConfigAccess()) return;
  opening = true;
  try {
    const session = await workspaceClient();
    if (!session.canManageSystemConfig || !syncSystemConfigAccess()) return;
    menu(); dialog.showModal(); syncScrollbar();
  } catch { if (entry) entry.hidden = true; }
  finally { opening = false; }
});
$('systemConfigBack').onclick = () => leave(menu);
dialog.querySelector('.system-config-close').onclick = () => leave(() => dialog.close());
dialog.addEventListener('cancel', event => { event.preventDefault(); leave(() => dialog.close()); });
dialog.addEventListener('close', () => { $('systemConfigDiscard').hidden = true; entry?.focus({ preventScroll: true }); });
dialog.addEventListener('click', event => {
  const b = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom)) leave(() => dialog.close());
});
 $('systemConfigKeep').onclick = () => { $('systemConfigDiscard').hidden = true; (colorsPage ? rows.querySelector('input') : $('systemAiBase')?.disabled ? $('systemAiPromptRows')?.querySelector('input') : $('systemAiBase'))?.focus(); };
$('systemConfigLeave').onclick = () => { $('systemConfigDiscard').hidden = true; leaveAction?.(); };
$('systemConfigRetry').onclick = load;
$('systemAiPromptRetry').onclick = loadPrompts;
 $('systemSceneRetry').onclick = loadScenes;
 $('systemAiBase').oninput = promptBaseChanged;
 $('systemAiPromptAdd').onclick = () => { if (promptBusy || !promptLoaded || !promptCanEdit || promptItems.length >= 5) return; promptItems.push({ label: '', prompt: '' }); promptDirty = true; renderPromptRows(); promptStatus('请填写新增提示词后保存'); $('systemAiPromptRows').lastElementChild?.querySelector('input')?.focus(); };
$('systemAiPromptSave').onclick = savePrompts;
$('systemColorAdd').onclick = () => {
  try {
    if (!editor.add()) return;
    renderRows(); changed();
    const input = rows.children[editor.editing.index].querySelector('input'); input.focus(); input.scrollIntoView({ block: 'nearest' });
  } catch (error) { status(error.message, true); }
};
preview(menuBall, fabricColors()[0]);
window.addEventListener('beforeunload', event => {
  if (dialog.open && ((colorsPage && loaded && dirty()) || (promptsPage && promptLoaded && promptDirty))) { event.preventDefault(); event.returnValue = ''; }
});
