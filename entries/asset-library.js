import { mountNavigation, downloadFile } from '../shared/navigation.js';
import { listAssets, getAsset, saveAsset, deleteAsset } from '../shared/asset-store.js';
import { materialType } from '../shared/material-placement.js';
import { packMaterial, unpackMaterial } from '../shared/material-package.js';

const $ = id => document.getElementById(id);
const libraryNames = { fabric: '面料库', pattern: '图案库', model: '模型库' };
const libraryType = asset => asset.kind === 'model' ? 'model' : asset.kind === 'texture' ? 'pattern' : materialType(asset);
let assets = [], renderVersion = 0, activeLibrary = 'fabric', openMenu;
const renderedCards = new Map();
const cardUrls = new Map();
let editing, editPreview, editPreviewUrl, editVersion = 0;
const modelPreviews = new Map();
let previewQueue = Promise.resolve();
mountNavigation('assets');
const status = message => { $('status').textContent = message; };
const previewOf = asset => asset.preview || asset.thumbnail || (asset.kind === 'texture' ? asset.file : asset.maps?.map);
function imageUrl(blob) { return URL.createObjectURL(blob); }
function action(label, handler) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  button.onclick = async () => { closeMenu(); button.disabled = true; try { await handler(); } catch (error) { status(error.message); } finally { button.disabled = false; } };
  return button;
}
function link(label, href) {
  const element = document.createElement('a'); element.className = 'button primary'; element.textContent = label; element.href = href; return element;
}
function closeMenu(restoreFocus = false) {
  if (!openMenu) return;
  openMenu.panel.hidden = true; openMenu.trigger.setAttribute('aria-expanded', 'false');
  openMenu.card.classList.remove('menu-open');
  if (restoreFocus) openMenu.trigger.focus();
  openMenu = null;
}
function createMenu(asset, card) {
  const trigger = document.createElement('button'); trigger.className = 'asset-menu-trigger'; trigger.type = 'button';
  trigger.textContent = '···'; trigger.setAttribute('aria-label', asset.name + '：更多操作');
  trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div'); panel.className = 'asset-menu'; panel.hidden = true; panel.setAttribute('role', 'menu');
  panel.id = 'menu-' + asset.id; trigger.setAttribute('aria-controls', panel.id);
  const actions = [action('重命名', () => editAsset(asset, 'name')), action('编辑简介', () => editAsset(asset, 'description')),
    action('预览图', () => editAsset(asset, 'preview')), action('导出', async () => {
      if (asset.kind === 'material') downloadFile(await packMaterial(asset), asset.name + '.formmat');
      else { downloadFile(asset.file, asset.file.name); for (const file of asset.resources || []) downloadFile(file, file.name); }
    })];
  if (!asset.builtin) actions.push(action('删除', async () => {
      if (!confirm('删除「' + asset.name + '」？已导出的文件不受影响。')) return;
      await deleteAsset(asset.id); await refresh(); status('已删除资产');
    }));
  panel.append(...actions);
  const items = [...panel.children];
  items.forEach(item => { item.setAttribute('role', 'menuitem'); item.tabIndex = -1; });
  items.at(-1).classList.add('danger');
  trigger.onclick = () => {
    const wasOpen = openMenu?.trigger === trigger; closeMenu(); if (wasOpen) return;
    openMenu = { trigger, panel, card }; panel.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    card.classList.add('menu-open'); items[0].focus();
  };
  panel.onkeydown = event => {
    const index = items.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
    if (event.key === 'Tab') closeMenu(true);
  };
  return [trigger, panel];
}
document.addEventListener('pointerdown', event => { if (openMenu && !openMenu.panel.contains(event.target) && !openMenu.trigger.contains(event.target)) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && openMenu) { event.preventDefault(); closeMenu(true); } });

function showEditPreview(blob) {
  if (editPreviewUrl) URL.revokeObjectURL(editPreviewUrl);
  editPreviewUrl = blob ? URL.createObjectURL(blob) : null;
  $('assetPreviewImage').hidden = !blob;
  if (blob) $('assetPreviewImage').src = editPreviewUrl; else $('assetPreviewImage').removeAttribute('src');
}
function editAsset(asset, field) {
  editing = { id: asset.id, field }; editPreview = null; editVersion++;
  const isPreview = field === 'preview';
  $('assetDialogTitle').textContent = { name: '重命名', description: '编辑简介', preview: '预览图' }[field];
  $('assetTextLabel').textContent = field === 'name' ? '名称' : '简介';
  $('assetTextLabel').hidden = $('assetText').hidden = isPreview;
  $('assetText').value = asset[field] || ''; $('assetText').maxLength = field === 'name' ? 120 : 1000;
  $('assetText').rows = field === 'name' ? 1 : 4;
  $('assetPreviewEditor').hidden = !isPreview; $('assetPreviewFile').value = '';
  $('assetEditError').textContent = ''; $('saveAssetEdit').disabled = false;
  showEditPreview(isPreview ? previewOf(asset) || modelPreviews.get(asset.id) : null);
  $('assetDialog').showModal();
  (isPreview ? $('assetPreviewFile') : $('assetText')).focus();
}
$('cancelAssetEdit').onclick = () => $('assetDialog').close();
$('assetDialog').addEventListener('close', () => { editVersion++; showEditPreview(null); editing = null; });
$('assetPreviewFile').onchange = async () => {
  const file = $('assetPreviewFile').files[0], version = ++editVersion;
  editPreview = null; $('assetEditError').textContent = ''; if (!file) return;
  $('saveAssetEdit').disabled = true;
  try {
    if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type) || file.size > 16 * 1024 * 1024) throw new Error('请选择 16 MB 以内的 PNG、JPG、WebP 或 BMP 图片');
    const bitmap = await createImageBitmap(file); bitmap.close();
    if (version !== editVersion) return;
    editPreview = file; showEditPreview(file);
  } catch (error) { if (version === editVersion) $('assetEditError').textContent = '预览图无效：' + error.message; }
  finally { if (version === editVersion) $('saveAssetEdit').disabled = false; }
};
$('assetEditForm').onsubmit = async event => {
  event.preventDefault(); if (!editing) return;
  const { id, field } = editing;
  $('saveAssetEdit').disabled = true;
  try {
    const value = field === 'preview' ? editPreview : $('assetText').value.trim();
    if (field === 'preview' && !value) throw new Error('请先选择有效的预览图');
    if (field === 'name' && !value) throw new Error('名称不能为空');
    const current = await getAsset(id); if (!current) throw new Error('资产已被删除');
    await saveAsset({ ...current, [field]: value });
    $('assetDialog').close(); await refresh(); status('已保存');
  } catch (error) { $('assetEditError').textContent = error.message; }
  finally { $('saveAssetEdit').disabled = false; }
};

function renderModelPreview(asset, art) {
  if (!modelPreviews.has(asset.id)) {
    modelPreviews.set(asset.id, null);
    previewQueue = previewQueue.then(async () => {
      try {
        const { createModelPreview } = await import('../shared/model-preview.js');
        modelPreviews.set(asset.id, await createModelPreview(asset));
      } catch { /* A custom preview remains available if this model cannot be rendered. */ }
    });
  }
  const display = () => {
    if (!art.isConnected) return;
    const blob = modelPreviews.get(asset.id);
    if (blob) { const img = document.createElement('img'); const url = imageUrl(blob); cardUrls.set(asset.id, [...(cardUrls.get(asset.id) || []), url]); img.src = url; img.alt = asset.name + ' 预览图'; art.replaceChildren(img); }
    else art.textContent = '可通过「···」设置预览图';
  };
  if (modelPreviews.get(asset.id)) queueMicrotask(display); else previewQueue.then(display);
}
function render() {
  closeMenu();
  const host = $('assetGrid'); host.replaceChildren();
  const query = $('assetSearch').value.trim().toLocaleLowerCase();
  const collection = assets.filter(asset => libraryType(asset) === activeLibrary);
  const shown = collection.filter(asset => asset.name.toLocaleLowerCase().includes(query) && (activeLibrary !== 'fabric' || $('assetCategory').value === 'all' || asset.category === $('assetCategory').value));
  $('assetCategory').hidden = activeLibrary !== 'fabric';
  $('assetCount').textContent = `${libraryNames[activeLibrary]} · ${shown.length} / ${collection.length} 项`;
  if (!shown.length) {
    const empty = document.createElement('div'); empty.className = 'asset-empty';
    const title = document.createElement('h2'); title.textContent = collection.length ? '没有匹配的资产' : libraryNames[activeLibrary] + '暂无资产';
    const text = document.createElement('p'); text.textContent = collection.length ? '尝试更换关键词或筛选条件。' : activeLibrary === 'model' ? '导入 FBX 模型，开始下一次设计。' : '导入图片或材质包，也可以在材质编辑器中新建材质。';
    empty.append(title, text); host.append(empty);
  }
  for (const asset of shown) {
    const signature = [asset.updatedAt, asset.thumbnail?.size, asset.name, asset.description].join('|');
    const cached = renderedCards.get(asset.id);
    if (cached?.signature === signature) { host.append(cached.card); continue; }
    cardUrls.get(asset.id)?.forEach(url => URL.revokeObjectURL(url));
    cardUrls.delete(asset.id);
    const card = document.createElement('article'); card.className = 'asset-card'; card.dataset.assetId = asset.id;
    const art = document.createElement('div'); art.className = 'asset-art';
    const preview = asset.thumbnail || previewOf(asset);
    if (preview) { const img = document.createElement('img'); const url = imageUrl(preview); cardUrls.set(asset.id, [url]); img.src = url; img.alt = asset.name + ' 预览图'; art.append(img); }
    else if (asset.kind === 'model') { art.textContent = '正在生成预览图…'; renderModelPreview(asset, art); }
    else { const shape = document.createElement('div'); shape.className = 'sphere'; if (/^#[\da-f]{6}$/i.test(asset.surface?.color)) shape.style.setProperty('--swatch', asset.surface.color); art.append(shape); }
    const info = document.createElement('div'); info.className = 'asset-info';
    const title = document.createElement('h2'); title.textContent = asset.name; title.title = asset.name;
    const description = document.createElement('p'); description.className = 'asset-description'; description.textContent = asset.description || '暂无简介'; description.title = asset.description || '';
    const actions = document.createElement('div'); actions.className = 'asset-actions';
    if (asset.kind === 'model') {
      const modelActions = document.createElement('div'); modelActions.className = 'model-design-actions';
      modelActions.append(link('设计', './index.html?asset=' + encodeURIComponent(asset.id)));
      const settings = document.createElement('a'); settings.className = 'model-settings'; settings.href = './model-parts.html?asset=' + encodeURIComponent(asset.id);
      settings.title = '配置模型部件'; settings.setAttribute('aria-label', '配置模型部件'); settings.textContent = '⚙'; modelActions.append(settings); actions.append(modelActions);
    } else actions.append(link('编辑材质', './material-editor.html?asset=' + encodeURIComponent(asset.id)));
    info.append(title, description, actions); card.append(art, info, ...createMenu(asset, card));
    renderedCards.set(asset.id, { signature, card }); host.append(card);
  }
}
async function refresh() {
  const version = ++renderVersion;
  const show = result => {
    if (version !== renderVersion) return;
    const ids = new Set(result.map(asset => asset.id));
    for (const id of renderedCards.keys()) if (!ids.has(id)) {
      cardUrls.get(id)?.forEach(url => URL.revokeObjectURL(url));
      cardUrls.delete(id); renderedCards.delete(id);
    }
    assets = result.sort((a, b) => b.updatedAt - a.updatedAt); render();
  };
  try {
    const result = await listAssets({ onProgress: (items, progress) => {
      if (version !== renderVersion) return;
      show(items); status(progress.message);
    } });
    show(result);
  }
  catch (error) { status(error.message); }
}
const tabs = [...document.querySelectorAll('[data-library]')];
function selectLibrary(type) {
  activeLibrary = type;
  for (const tab of tabs) { const selected = tab.dataset.library === type; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; if (selected) $('assetPanel').setAttribute('aria-labelledby', tab.id); }
  render();
}
for (const [index, tab] of tabs.entries()) {
  tab.onclick = () => selectLibrary(tab.dataset.library);
  tab.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus(); selectLibrary(next.dataset.library);
  };
}
for (const id of ['assetSearch', 'assetCategory']) $(id).addEventListener('input', render);
$('importAssets').onclick = () => $('assetFiles').click();
$('assetFiles').onchange = async () => {
  const files = [...$('assetFiles').files]; $('assetFiles').value = '';
  const images = files.filter(file => /\.(png|jpe?g|webp|bmp)$/i.test(file.name));
  $('importAssets').disabled = true;
  let count = 0, firstLibrary; const errors = [];
  for (const file of files) {
    try {
      let asset;
      if (/\.formmat$/i.test(file.name)) asset = await unpackMaterial(file);
      else if (/\.fbx$/i.test(file.name)) {
        if (file.size > 512 * 1024 * 1024) throw new Error('FBX 不能超过 512 MB');
        if (images.some(image => image.size > 64 * 1024 * 1024)) throw new Error('配套贴图不能超过 64 MB');
        asset = { kind: 'model', name: file.name, file, resources: images };
      } else if (images.includes(file)) {
        if (file.size > 64 * 1024 * 1024) throw new Error('贴图不能超过 64 MB');
        asset = { kind: 'texture', name: file.name, file };
      } else throw new Error('不支持的文件类型');
      await saveAsset(asset); firstLibrary ??= libraryType(asset); count++;
    } catch (error) { errors.push(file.name + '：' + error.message); }
  }
  if (firstLibrary) { $('assetSearch').value = ''; $('assetCategory').value = 'all'; selectLibrary(firstLibrary); }
  await refresh(); $('importAssets').disabled = false;
  status(`已导入 ${count} 项资产` + (errors.length ? '；' + errors.join('；') : ''));
};
window.addEventListener('focus', () => { if (!$('assetDialog').open) refresh(); });
refresh();
