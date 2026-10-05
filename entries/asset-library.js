import { downloadFile } from '../shared/navigation.js';
import { listAssets, getAsset, saveAsset, deleteAsset } from '../shared/asset-store.js';
import { materialType } from '../shared/material-placement.js';
import { packMaterial, unpackMaterial } from '../shared/material-package.js';
const $ = id => document.getElementById(id);
const libraryNames = { fabric: '\u9762\u6599\u5e93', pattern: '\u56fe\u6848\u5e93', model: '\u6a21\u578b\u5e93' };
const libraryType = asset => asset.kind === 'folder' ? asset.library || 'fabric' : asset.kind === 'model' ? 'model' : asset.kind === 'texture' ? 'pattern' : materialType(asset);
let assets = [], renderVersion = 0, activeLibrary = 'fabric', activeFolderId = null, openMenu, searchQuery = '';
const selectedAssetIds = new Set();
const renderedCards = new Map();
const cardUrls = new Map();
let editing, editPreview, editPreviewUrl, editVersion = 0, movingAssetId = null;
const modelPreviews = new Map();
let previewQueue = Promise.resolve();
let fabricPreviewClosingTimer = null;
let fabricTextureRenderToken = 0;
let fabricTextureState = null;
const status = message => { $('status').textContent = message; };
const previewOf = asset => asset.preview || asset.thumbnail || (asset.kind === 'texture' ? asset.file : asset.maps?.map);
function imageUrl(blob) { return URL.createObjectURL(blob); }
function folderChildren(folderId) { return assets.filter(asset => (asset.parentId || null) === folderId && libraryType(asset) === activeLibrary); }
function folderById(id) { return assets.find(asset => asset.id === id && asset.kind === 'folder'); }
function updateBreadcrumb() {
  const host = $('libraryBreadcrumb'); host.replaceChildren();
  const back = $('libraryBack'), atRoot = activeFolderId === null;
  back.classList.toggle('is-disabled', atRoot);
  back.setAttribute('aria-disabled', String(atRoot));
  back.tabIndex = atRoot ? -1 : 0;
  back.title = atRoot ? '已在根目录' : '返回上一级';
  back.setAttribute('aria-label', atRoot ? '已在根目录' : '返回上一级');
  const navigate = folderId => {
    if (folderId === activeFolderId) return;
    closeMenu(); closeMoreMenu(); activeFolderId = folderId; searchQuery = ''; $('assetSearch').value = ''; render();
  };
  const appendLink = (label, folderId, current = false) => {
    const link = document.createElement('button'); link.type = 'button'; link.className = 'breadcrumb-link'; link.textContent = label;
    if (current) link.setAttribute('aria-current', 'page');
    link.onclick = () => navigate(folderId); host.append(link);
  };
  appendLink(libraryNames[activeLibrary], null, activeFolderId === null);
  const path = [], seen = new Set(); let folder = folderById(activeFolderId);
  while (folder && !seen.has(folder.id)) { path.unshift(folder); seen.add(folder.id); folder = folderById(folder.parentId); }
  path.forEach((item, index) => {
    const separator = document.createElement('span'); separator.className = 'breadcrumb-separator'; separator.setAttribute('aria-hidden', 'true');
    const icon = document.createElement('img'); icon.src = './assets/breadcrumb-separator.svg'; icon.alt = ''; icon.setAttribute('aria-hidden', 'true'); separator.append(icon);
    host.append(separator);
    appendLink(item.name, item.id, index === path.length - 1);
  });
}
function openFolder(folderId) {
  const folder = folderById(folderId);
  if (!folder) return;
  activeFolderId = folder.id;
  searchQuery = '';
  $('assetSearch').value = '';
  render();
}
function closeMoreMenu() {
  const menu = $('moreMenu'), button = $('moreOptions');
  if (!menu || !button) return;
  menu.hidden = true; button.setAttribute('aria-expanded', 'false');
}
async function removeFolderTree(folder) {
  for (const child of folderChildren(folder.id)) {
    if (child.kind === 'folder') await removeFolderTree(child);
    await deleteAsset(child.id);
  }
  await deleteAsset(folder.id);
}
function folderContains(folderId, ancestorId) {
  let current = folderById(folderId), seen = new Set();
  while (current && !seen.has(current.id)) {
    if (current.id === ancestorId) return true;
    seen.add(current.id); current = folderById(current.parentId);
  }
  return false;
}
function folderLabel(folder) {
  const names = [], seen = new Set(); let current = folder;
  while (current && !seen.has(current.id)) {
    names.unshift(current.name); seen.add(current.id); current = folderById(current.parentId);
  }
  return names.join('>');
}
function moveTargets(asset) {
  return assets.filter(candidate => candidate.kind === 'folder' && libraryType(candidate) === libraryType(asset)
    && candidate.id !== asset.id && !folderContains(candidate.id, asset.id)).sort((a, b) => folderLabel(a).localeCompare(folderLabel(b), 'zh-CN'));
}
function openMoveDialog(asset) {
  const select = $('moveAssetTarget'); select.replaceChildren();
  const root = document.createElement('option'); root.value = ''; root.textContent = libraryNames[libraryType(asset)] + '根目录'; select.append(root);
  for (const folder of moveTargets(asset)) {
    const option = document.createElement('option'); option.value = folder.id; option.textContent = folderLabel(folder); select.append(option);
  }
  movingAssetId = asset.id; $('moveDialogTitle').textContent = '移动「' + asset.name + '」';
  $('moveAssetError').textContent = ''; $('saveMove').disabled = false; select.value = asset.parentId || '';
  $('moveDialog').showModal(); select.focus();
}
function action(label, handler) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  button.onclick = async () => { closeMenu(); button.disabled = true; try { await handler(); } catch (error) { status(error.message); } finally { button.disabled = false; } };
  return button;
}
async function toggleFavorite(asset) {
  const current = await getAsset(asset.id); if (!current) throw new Error('资产已被删除');
  await saveAsset({ ...current, favorite: !current.favorite });
  await refresh(); status(current.favorite ? '已取消收藏' : '已收藏');
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
function closeAssetAddMenu() { $('assetAddMenu').hidden = true; $('importAssets').setAttribute('aria-expanded', 'false'); }
function syncCardSelection(card, control, selected) {
  card.classList.toggle('selected', selected);
  control.setAttribute('aria-pressed', String(selected));
  control.setAttribute('aria-label', selected ? '取消选择' : '选择资产');
}
function createSelectionControl(asset, card) {
  const control = document.createElement('button');
  control.type = 'button'; control.className = 'asset-select-control'; control.setAttribute('aria-pressed', 'false');
  control.setAttribute('aria-label', '选择资产');
  for (const type of ['pointerdown', 'pointerup', 'pointercancel']) control.addEventListener(type, event => event.stopPropagation());
  control.onclick = event => {
    event.preventDefault(); event.stopPropagation();
    card.classList.remove('is-pressing', 'is-clicking');
    const selected = !selectedAssetIds.has(asset.id);
    if (selected) selectedAssetIds.add(asset.id); else selectedAssetIds.delete(asset.id);
    syncCardSelection(card, control, selected);
  };
  return control;
}
function filterVisibleAssets(collection) {
  const category = $('assetCategory')?.value || 'all';
  return collection.filter(asset => asset.name.toLocaleLowerCase().includes(searchQuery)
    && (activeLibrary !== 'fabric' || category === 'all' || asset.category === category));
}
function createMenu(asset, card) {
  const trigger = document.createElement('button'); trigger.className = 'asset-menu-trigger'; trigger.type = 'button';
  trigger.textContent = '\u22ef'; trigger.setAttribute('aria-label', asset.name + '：更多操作');
  trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div'); panel.className = 'asset-menu'; panel.hidden = true; panel.setAttribute('role', 'menu');
  panel.id = 'menu-' + asset.id; trigger.setAttribute('aria-controls', panel.id);
  const isMaterial = asset.kind === 'material';
  const actions = [action('编辑', () => editAsset(asset, isMaterial ? 'material' : 'name')), action('移动', () => openMoveDialog(asset))];
  if (isMaterial) actions.push(action(asset.favorite ? '取消收藏' : '收藏', () => toggleFavorite(asset)));
  else if (asset.kind !== 'folder') actions.push(action('导出', async () => {
    if (asset.kind === 'material') downloadFile(await packMaterial(asset), asset.name + '.formmat');
    else { downloadFile(asset.file, asset.file.name); for (const file of asset.resources || []) downloadFile(file, file.name); }
  }));
  if (!asset.builtin || isMaterial) {
    const remove = action(asset.kind === 'folder' ? '删除文件夹' : '删除', async () => {
    if (!confirm((asset.kind === 'folder' ? '删除文件夹「' : '删除「') + asset.name + '」及其中内容？')) return;
    if (asset.kind === 'folder') await removeFolderTree(asset); else await deleteAsset(asset.id);
    if (activeFolderId === asset.id) activeFolderId = asset.parentId || null;
    await refresh(); status(asset.kind === 'folder' ? '已删除文件夹' : '已删除资产');
    });
    remove.classList.add('danger'); actions.push(remove);
  }
  panel.append(...actions);
  const items = [...panel.children];
  items.forEach(item => { item.setAttribute('role', 'menuitem'); item.tabIndex = -1; });
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
document.addEventListener('pointerdown', event => {
  if (openMenu && !openMenu.panel.contains(event.target) && !openMenu.trigger.contains(event.target)) closeMenu();
  const addMenu = $('assetAddMenu'); if (!addMenu.hidden && !addMenu.contains(event.target) && event.target !== $('importAssets')) closeAssetAddMenu();
  const moreMenu = $('moreMenu'), moreButton = $('moreOptions'); if (moreMenu && !moreMenu.hidden && !moreMenu.contains(event.target) && !moreButton.contains(event.target)) closeMoreMenu();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (openMenu) { event.preventDefault(); closeMenu(true); }
  if ($('moreMenu') && !$('moreMenu').hidden) { event.preventDefault(); closeMoreMenu(); }
});

function previewNumber(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : '';
}
function fabricPreviewSource(asset) {
  return asset.maps?.map || asset.preview || asset.thumbnail || null;
}
const FABRIC_TEXTURE_SURFACE = { width: 3600, height: 2700 };
function fabricTextureRange(asset) {
  const category = asset.category || '其他';
  if (category === '面布') return { category, defaultWidth: 120, minWidth: 40, maxWidth: 200, step: 4, zoomable: true };
  if (category === '边布') return { category, defaultWidth: 22, minWidth: 8, maxWidth: 36, step: 1, zoomable: true };
  return { category, defaultWidth: 8, minWidth: 8, maxWidth: 8, step: 1, zoomable: false };
}
function clampFabricTextureWidth(state, value) {
  return Math.max(state.range.minWidth, Math.min(state.range.maxWidth, value));
}
function drawTiledTexture(baseCanvas, bitmap) {
  const width = FABRIC_TEXTURE_SURFACE.width, height = FABRIC_TEXTURE_SURFACE.height;
  const context = baseCanvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
  if (bitmap.width >= width && bitmap.height >= height) {
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const drawWidth = bitmap.width * scale, drawHeight = bitmap.height * scale;
    context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    return;
  }
  for (let y = -bitmap.height; y < height + bitmap.height; y += bitmap.height) {
    for (let x = -bitmap.width; x < width + bitmap.width; x += bitmap.width) context.drawImage(bitmap, x, y);
  }
}
function renderFabricTexture(state) {
  if (!state?.canvas || !state.baseCanvas) return;
  const width = FABRIC_TEXTURE_SURFACE.width, height = FABRIC_TEXTURE_SURFACE.height;
  const context = state.canvas.getContext('2d', { alpha: false });
  const scale = state.widthCm / state.range.defaultWidth;
  const tileWidth = width * scale, tileHeight = height * scale;
  context.clearRect(0, 0, width, height); context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
  let startX = width / 2 - tileWidth / 2, startY = height / 2 - tileHeight / 2;
  while (startX > 0) startX -= tileWidth;
  while (startY > 0) startY -= tileHeight;
  for (let y = startY; y < height; y += tileHeight) {
    for (let x = startX; x < width; x += tileWidth) context.drawImage(state.baseCanvas, x, y, tileWidth, tileHeight);
  }
}
async function loadFabricTexture(asset, source) {
  const token = ++fabricTextureRenderToken;
  const canvas = $('fabricPreviewTexture'), fallback = $('fabricPreviewTextureFallback');
  try {
    const bitmap = await createImageBitmap(source);
    if (token !== fabricTextureRenderToken) { bitmap.close(); return; }
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = FABRIC_TEXTURE_SURFACE.width; baseCanvas.height = FABRIC_TEXTURE_SURFACE.height;
    drawTiledTexture(baseCanvas, bitmap);
    bitmap.close();
    const range = fabricTextureRange(asset);
    const state = { assetId: asset.id, canvas, baseCanvas, range, widthCm: range.defaultWidth };
    fabricTextureState = state;
    renderFabricTexture(state);
    canvas.hidden = false; fallback.hidden = true;
  } catch (error) {
    if (token !== fabricTextureRenderToken) return;
    fabricTextureState = null; canvas.hidden = true; fallback.hidden = false;
  }
}
function fabricPreviewValue(asset, field) {
  const physical = asset.physical || {};
  const surface = asset.surface || {};
  if (field === 'name') return asset.name || '未命名面料';
  if (field === 'designInfo') return asset.designInfo || asset.description || '未填写';
  if (field === 'supplier') return asset.supplier || '未填写';
  if (field === 'size') {
    const width = previewNumber(physical.widthCm), height = previewNumber(physical.heightCm);
    return width && height ? `${width} × ${height} cm` : '未填写';
  }
  if (field === 'surface') {
    const color = surface.color || '#FFFFFF';
    const roughness = previewNumber(surface.roughness, 2);
    return roughness ? `${color} · 粗糙度 ${roughness}` : color;
  }
  return asset[field] || '未填写';
}
function closeFabricPreview() {
  const dialog = $('fabricPreviewDialog');
  if (!dialog?.open || dialog.classList.contains('is-closing')) return;
  dialog.classList.add('is-closing');
  const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 320;
  fabricPreviewClosingTimer = setTimeout(() => {
    fabricPreviewClosingTimer = null;
    if (dialog.open) dialog.close();
  }, duration);
}
function showFabricPreview(asset) {
  const dialog = $('fabricPreviewDialog');
  if (!dialog || asset?.kind !== 'material') return;
  if (fabricPreviewClosingTimer) { clearTimeout(fabricPreviewClosingTimer); fabricPreviewClosingTimer = null; }
  dialog.classList.remove('is-closing');
  fabricTextureRenderToken++;
  fabricTextureState = null;
  const source = fabricPreviewSource(asset);
  const canvas = $('fabricPreviewTexture'), fallback = $('fabricPreviewTextureFallback');
  canvas.hidden = !source; fallback.hidden = !!source;
  if (source) loadFabricTexture(asset, source);
  $('fabricPreviewTitle').textContent = asset.name || '面料详情';
  $('fabricPreviewCategory').textContent = asset.category || '面料';
  const fields = [
    ['名称', 'name'], ['设计信息', 'designInfo'], ['供应商', 'supplier'],
    ['物理尺寸', 'size'], ['表面参数', 'surface'], ['简介', 'description'],
  ];
  const host = $('fabricPreviewFields'); host.replaceChildren();
  fields.forEach(([label, key]) => {
    const item = document.createElement('div'); item.className = 'fabric-preview-field' + (key === 'description' ? ' is-wide' : '');
    const heading = document.createElement('span'); heading.className = 'fabric-preview-field-label'; heading.textContent = label;
    const value = document.createElement('strong'); value.className = 'fabric-preview-field-value'; value.textContent = key === 'description' ? (asset.description || '未填写') : fabricPreviewValue(asset, key);
    item.append(heading, value); host.append(item);
  });
  dialog.showModal();
  $('closeFabricPreview').focus();
}
$('closeFabricPreview').onclick = closeFabricPreview;
$('fabricPreviewDialog').addEventListener('click', event => {
  if (event.target === $('fabricPreviewDialog')) closeFabricPreview();
});
$('fabricPreviewDialog').addEventListener('cancel', event => {
  event.preventDefault();
  closeFabricPreview();
});
$('fabricPreviewDialog').addEventListener('close', () => {
  if (fabricPreviewClosingTimer) { clearTimeout(fabricPreviewClosingTimer); fabricPreviewClosingTimer = null; }
  $('fabricPreviewDialog').classList.remove('is-closing');
  fabricTextureRenderToken++;
  fabricTextureState = null;
  const canvas = $('fabricPreviewTexture');
  canvas.hidden = true;
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
});

$('fabricPreviewTexture').addEventListener('wheel', event => {
  const state = fabricTextureState;
  if (!state?.range.zoomable || state.assetId === undefined) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  const next = clampFabricTextureWidth(state, state.widthCm + direction * state.range.step);
  if (next === state.widthCm) return;
  state.widthCm = next;
  renderFabricTexture(state);
}, { passive: false });

function showEditPreview(blob) {
  if (editPreviewUrl) URL.revokeObjectURL(editPreviewUrl);
  editPreviewUrl = blob ? URL.createObjectURL(blob) : null;
  $('assetPreviewImage').hidden = !blob;
  if (blob) $('assetPreviewImage').src = editPreviewUrl; else $('assetPreviewImage').removeAttribute('src');
}
function editAsset(asset, field) {
  editing = { id: asset.id, field }; editPreview = null; editVersion++;
  const isMaterial = field === 'material';
  const isPreview = field === 'preview';
  $('assetDialogTitle').textContent = isMaterial ? '编辑材质' : { name: '重命名', description: '编辑简介', preview: '预览图' }[field];
  $('assetTextLabel').textContent = field === 'name' ? '名称' : '简介';
  $('assetTextLabel').hidden = $('assetText').hidden = isPreview || isMaterial;
  $('materialEditFields').hidden = !isMaterial;
  if (isMaterial) {
    $('materialEditName').value = asset.name || '';
    $('materialEditCategory').value = ['面布', '边布', '包边条', '其他'].includes(asset.category) ? asset.category : '其他';
    $('materialEditDesignInfo').value = asset.designInfo || asset.description || '';
    $('materialEditSupplier').value = asset.supplier || '';
  }
  $('assetText').value = asset[field] || ''; $('assetText').maxLength = field === 'name' ? 120 : 1000;
  $('assetText').rows = field === 'name' ? 1 : 4;
  $('assetPreviewEditor').hidden = !isPreview; $('assetPreviewFile').value = '';
  $('assetEditError').textContent = ''; $('saveAssetEdit').disabled = false;
  showEditPreview(isPreview ? previewOf(asset) || modelPreviews.get(asset.id) : null);
  $('assetDialog').showModal();
  (isPreview ? $('assetPreviewFile') : isMaterial ? $('materialEditName') : $('assetText')).focus();
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
$('cancelMove').onclick = () => $('moveDialog').close();
$('moveDialog').addEventListener('close', () => { movingAssetId = null; $('moveAssetError').textContent = ''; });
$('moveAssetForm').onsubmit = async event => {
  event.preventDefault(); if (!movingAssetId) return;
  const targetId = $('moveAssetTarget').value || null, asset = assets.find(item => item.id === movingAssetId);
  if (!asset) { $('moveDialog').close(); return; }
  if (asset.kind === 'folder' && targetId && folderContains(targetId, asset.id)) {
    $('moveAssetError').textContent = '不能移动到当前文件夹或它的子文件夹'; return;
  }
  $('saveMove').disabled = true; $('moveAssetError').textContent = '';
  try {
    const current = await getAsset(asset.id); if (!current) throw new Error('资产已被删除');
    await saveAsset({ ...current, parentId: targetId });
    $('moveDialog').close(); await refresh(); status('已移动资产');
  } catch (error) { $('moveAssetError').textContent = error.message; }
  finally { $('saveMove').disabled = false; }
};
$('assetEditForm').onsubmit = async event => {
  event.preventDefault(); if (!editing) return;
  const { id, field } = editing;
  $('saveAssetEdit').disabled = true;
  try {
    const value = field === 'preview' ? editPreview : field === 'material' ? $('materialEditName').value.trim() : $('assetText').value.trim();
    if (field === 'preview' && !value) throw new Error('请先选择有效的预览图');
    if ((field === 'name' || field === 'material') && !value) throw new Error('名称不能为空');
    const current = await getAsset(id); if (!current) throw new Error('资产已被删除');
    const next = field === 'material' ? {
      ...current,
      name: value,
      category: $('materialEditCategory').value,
      designInfo: $('materialEditDesignInfo').value.trim(),
      supplier: $('materialEditSupplier').value.trim(),
    } : { ...current, [field]: value };
    await saveAsset(next);
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
  updateBreadcrumb();
  const host = $('assetGrid'); host.replaceChildren();
  const collection = assets.filter(asset => libraryType(asset) === activeLibrary && (asset.parentId || null) === activeFolderId);
  let shown = filterVisibleAssets(collection);
  const sortMode = $('assetSort')?.value || 'recent';
  shown.sort((a, b) => {
    if (sortMode === 'nameAsc') return a.name.localeCompare(b.name, 'zh-CN');
    if (sortMode === 'nameDesc') return b.name.localeCompare(a.name, 'zh-CN');
    if (sortMode === 'oldest') return a.updatedAt - b.updatedAt;
    return b.updatedAt - a.updatedAt;
  });
  if (!shown.length) {
    const empty = document.createElement('div'); empty.className = 'asset-empty';
    const title = document.createElement('h2'); title.textContent = collection.length ? '没有匹配的资产' : libraryNames[activeLibrary] + '暂无资产';
    const text = document.createElement('p'); text.textContent = collection.length ? '尝试更换关键词或筛选条件。' : activeLibrary === 'model' ? '导入 FBX 模型，开始下一次设计。' : '导入图片或材质包，也可以在材质编辑器中新建材质。';
    empty.append(title, text); host.append(empty);
  }
  for (const asset of shown) {
    const signature = [asset.updatedAt, asset.kind, asset.thumbnail?.size, asset.name, asset.description, asset.designInfo, asset.supplier, asset.category, asset.favorite, asset.children?.join(',')].join('|');
    const cached = asset.kind === 'folder' ? null : renderedCards.get(asset.id);
    if (cached?.signature === signature) {
      syncCardSelection(cached.card, cached.selectControl, selectedAssetIds.has(asset.id));
      host.append(cached.card); continue;
    }
    cardUrls.get(asset.id)?.forEach(url => URL.revokeObjectURL(url));
    cardUrls.delete(asset.id);
    const card = document.createElement('article'); card.className = 'asset-card asset-' + asset.kind + (asset.favorite ? ' is-favorite' : ''); card.dataset.assetId = asset.id;
    if (asset.favorite) card.style.setProperty('--favorite-color', asset.surface?.color || '#3978ed');
    let pressPointerId = null;
    const isCardSurface = event => !event.target.closest('button,a') && (event.pointerType !== 'mouse' || event.button === 0);
    const openFolderCard = () => {
      if (asset.kind !== 'folder' || card.classList.contains('folder-opening')) return;
      card.classList.add('folder-opening');
      openFolder(asset.id);
    };
    const releaseCard = event => {
      if (event.target && !isCardSurface(event)) return;
      if (pressPointerId !== null && event.pointerId !== pressPointerId) return;
      pressPointerId = null;
      card.classList.remove('is-pressing', 'is-clicking');
      if (asset.kind === 'folder' && event.type === 'pointerup') {
        openFolderCard();
        return;
      }
      void card.offsetWidth;
      card.classList.add('is-clicking');
      setTimeout(() => card.classList.remove('is-clicking'), 320);
    };
    card.addEventListener('pointerdown', event => {
      if (!isCardSurface(event)) return;
      pressPointerId = event.pointerId;
      card.classList.remove('is-clicking');
      card.classList.add('is-pressing');
      card.setPointerCapture?.(event.pointerId);
    });
    card.addEventListener('pointerup', releaseCard);
    card.addEventListener('pointercancel', releaseCard);
    card.addEventListener('lostpointercapture', event => {
      if (pressPointerId !== null) releaseCard(event);
    });
    card.addEventListener('click', event => {
      const surface = isCardSurface(event);
      if (event.detail === 0 && surface) releaseCard({ pointerId: null });
      if (asset.kind === 'folder' && surface) openFolderCard();
      if (asset.kind === 'material' && activeLibrary === 'fabric' && surface) showFabricPreview(asset);
    });
    const art = document.createElement('div'); art.className = 'asset-art';
    const urls = [];
    if (asset.kind === 'folder') {
      art.classList.add('folder-art');
      const cover = document.createElement('div'); cover.className = 'folder-cover'; cover.setAttribute('aria-hidden', 'true');
      art.append(cover);
    } else {
      const preview = asset.thumbnail || previewOf(asset);
      if (preview) { const img = document.createElement('img'); const url = imageUrl(preview); urls.push(url); img.src = url; img.alt = asset.name + ' 预览图'; art.append(img); }
      else if (asset.kind === 'model') { art.textContent = '正在生成预览图…'; renderModelPreview(asset, art); }
      else { const shape = document.createElement('div'); shape.className = 'sphere'; if (/^#[\da-f]{6}$/i.test(asset.surface?.color)) shape.style.setProperty('--swatch', asset.surface.color); art.append(shape); }
    }
    if (urls.length) cardUrls.set(asset.id, urls);
    const info = document.createElement('div'); info.className = 'asset-info';
    const title = document.createElement('h2'); title.textContent = asset.name; title.title = asset.name;
    const description = document.createElement('p'); description.className = 'asset-description'; description.textContent = asset.description || '暂无简介'; description.title = asset.description || '';
    const actions = document.createElement('div'); actions.className = 'asset-actions';
    if (asset.kind === 'model') {
      const modelActions = document.createElement('div'); modelActions.className = 'model-design-actions';
      modelActions.append(link('设计', './design.html?asset=' + encodeURIComponent(asset.id)));
      const settings = document.createElement('a'); settings.className = 'model-settings'; settings.href = './model-parts.html?asset=' + encodeURIComponent(asset.id);
      settings.title = '配置模型部件'; settings.setAttribute('aria-label', '配置模型部件'); settings.textContent = '⚙'; modelActions.append(settings); actions.append(modelActions);
    } else actions.append(link('编辑材质', './material-editor.html?asset=' + encodeURIComponent(asset.id)));
    info.append(title, description, actions);
    const selectControl = createSelectionControl(asset, card);
    syncCardSelection(card, selectControl, selectedAssetIds.has(asset.id));
    card.append(art, info, selectControl, ...createMenu(asset, card));
    renderedCards.set(asset.id, { signature, card, selectControl }); host.append(card);
  }
  requestAnimationFrame(() => syncAssetScrollbar());
}
async function refresh() {
  const version = ++renderVersion;
  const show = result => {
    if (version !== renderVersion) return;
    const ids = new Set(result.map(asset => asset.id));
    for (const id of selectedAssetIds) if (!ids.has(id)) selectedAssetIds.delete(id);
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
  if (type !== activeLibrary) activeFolderId = null;
  activeLibrary = type;
  for (const tab of tabs) { const selected = tab.dataset.library === type; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; }
  $('assetPanel').setAttribute('aria-label', libraryNames[type]);
  if ($('assetCategory')) $('assetCategory').disabled = type !== 'fabric';
  render();
}
for (const [index, tab] of tabs.entries()) {
  tab.onclick = event => { event.preventDefault(); selectLibrary(tab.dataset.library); };
  tab.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus(); selectLibrary(next.dataset.library);
  };
}
const searchInput = $('assetSearch');
$('assetSearchForm').addEventListener('submit', event => {
  event.preventDefault();
  searchQuery = searchInput.value.trim().toLocaleLowerCase();
  render();
});
function clearSearchIfCancelled() {
  if (searchInput.value.trim() || !searchQuery) return;
  searchQuery = '';
  render();
}
searchInput.addEventListener('input', clearSearchIfCancelled);
searchInput.addEventListener('search', clearSearchIfCancelled);
searchInput.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  searchInput.value = '';
  clearSearchIfCancelled();
});
$('libraryBack').onclick = event => {
  if (!activeFolderId) { event.preventDefault(); return; }
  event.preventDefault();
  const folder = folderById(activeFolderId);
  activeFolderId = folder?.parentId || null;
  render();
};
$('assetCategory').addEventListener('change', render);
$('assetSort').addEventListener('change', render);
$('moreOptions').onclick = () => {
  const menu = $('moreMenu'), button = $('moreOptions');
  menu.hidden = !menu.hidden; button.setAttribute('aria-expanded', String(!menu.hidden));
};
$('selectAllAssets').onclick = () => {
  const collection = assets.filter(asset => libraryType(asset) === activeLibrary && (asset.parentId || null) === activeFolderId);
  const shown = filterVisibleAssets(collection);
  shown.forEach(asset => selectedAssetIds.add(asset.id));
  closeMoreMenu(); render(); status(shown.length ? `已选择 ${shown.length} 项资产` : '当前没有可选择的资产');
};
$('refreshAssets').onclick = () => { closeMoreMenu(); refresh(); };
$('clearSearch').onclick = () => {
  searchInput.value = ''; searchQuery = ''; $('assetCategory').value = 'all'; closeMoreMenu(); render();
};
$('importAssets').onclick = () => {
  const menu = $('assetAddMenu'); menu.hidden = !menu.hidden;
  $('importAssets').setAttribute('aria-expanded', String(!menu.hidden));
};
$('importAssetsMenu').onclick = () => { closeAssetAddMenu(); $('assetFiles').click(); };
$('createFolder').onclick = async () => {
  closeAssetAddMenu();
  const name = prompt('请输入文件夹名称');
  if (!name?.trim()) return;
  try {
    await saveAsset({ kind: 'folder', name, parentId: activeFolderId, library: activeLibrary, children: [] });
    await refresh(); status('已创建文件夹');
  } catch (error) { status(error.message); }
};
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
      asset.parentId = activeFolderId;
      await saveAsset(asset); firstLibrary ??= libraryType(asset); count++;
    } catch (error) { errors.push(file.name + '：' + error.message); }
  }
  if (firstLibrary) selectLibrary(firstLibrary);
  await refresh(); $('importAssets').disabled = false;
  status(`已导入 ${count} 项资产` + (errors.length ? '；' + errors.join('；') : ''));
};

const libraryScroll = document.querySelector('.library-main');
const assetScrollbar = document.getElementById('assetScrollbar');
const assetScrollbarThumb = assetScrollbar?.querySelector('.asset-scrollbar-thumb');
let previousLibraryScrollTop = libraryScroll?.scrollTop || 0;
function syncAssetSubbar() {
  if (!libraryScroll) return;
  const currentScrollTop = libraryScroll.scrollTop;
  const delta = currentScrollTop - previousLibraryScrollTop;
  if (currentScrollTop <= 1 || delta < -1) document.body.classList.remove('asset-subbar-collapsed');
  else if (delta > 1) document.body.classList.add('asset-subbar-collapsed');
  previousLibraryScrollTop = currentScrollTop;
}
function syncAssetScrollbar() {
  if (!libraryScroll || !assetScrollbar || !assetScrollbarThumb) return;
  const maxScroll = libraryScroll.scrollHeight - libraryScroll.clientHeight;
  assetScrollbar.hidden = false;
  const trackHeight = assetScrollbar.clientHeight;
  const thumbHeight = maxScroll <= 1 ? trackHeight : Math.max(72, Math.round(trackHeight * libraryScroll.clientHeight / libraryScroll.scrollHeight));
  const thumbTravel = Math.max(0, trackHeight - thumbHeight);
  assetScrollbarThumb.style.height = `${thumbHeight}px`;
  assetScrollbarThumb.style.transform = `translateY(${maxScroll <= 1 ? 0 : Math.round(thumbTravel * libraryScroll.scrollTop / maxScroll)}px)`;
}
let draggingScrollbar = null;
function scrollFromScrollbar(clientY) {
  const maxScroll = libraryScroll.scrollHeight - libraryScroll.clientHeight;
  const trackRect = assetScrollbar.getBoundingClientRect();
  const thumbHeight = assetScrollbarThumb.offsetHeight;
  const travel = Math.max(1, trackRect.height - thumbHeight);
  const offset = Math.max(0, Math.min(travel, clientY - trackRect.top - thumbHeight / 2));
  libraryScroll.scrollTop = maxScroll * offset / travel;
}
assetScrollbar?.addEventListener('pointerdown', event => {
  if (event.target === assetScrollbarThumb) {
    draggingScrollbar = { pointerId: event.pointerId, startY: event.clientY, startScroll: libraryScroll.scrollTop };
    assetScrollbarThumb.setPointerCapture?.(event.pointerId);
  } else scrollFromScrollbar(event.clientY);
});
assetScrollbar?.addEventListener('pointermove', event => {
  if (!draggingScrollbar || draggingScrollbar.pointerId !== event.pointerId) return;
  const trackRect = assetScrollbar.getBoundingClientRect();
  const travel = Math.max(1, trackRect.height - assetScrollbarThumb.offsetHeight);
  const maxScroll = libraryScroll.scrollHeight - libraryScroll.clientHeight;
  libraryScroll.scrollTop = draggingScrollbar.startScroll + (event.clientY - draggingScrollbar.startY) * maxScroll / travel;
});
assetScrollbar?.addEventListener('pointerup', () => { draggingScrollbar = null; });
assetScrollbar?.addEventListener('pointercancel', () => { draggingScrollbar = null; });
assetScrollbar?.addEventListener('wheel', event => {
  event.preventDefault();
  libraryScroll.scrollTop += event.deltaY;
}, { passive: false });
libraryScroll?.addEventListener('scroll', () => { syncAssetSubbar(); syncAssetScrollbar(); }, { passive: true });
window.addEventListener('resize', syncAssetScrollbar);
new ResizeObserver(syncAssetScrollbar).observe(libraryScroll);
syncAssetScrollbar();
window.addEventListener('focus', () => { if (!$('assetDialog').open) refresh(); });
refresh();
