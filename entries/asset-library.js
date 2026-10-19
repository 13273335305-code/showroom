import { downloadFile, mountToolSwitcher } from '../shared/navigation.js';
import { listAssets, getAsset, saveAsset, updateAsset, deleteAsset } from '../shared/asset-store.js';
import { materialType, assetPage } from '../shared/asset-metadata.js';
import { unpackMaterialAsync } from '../shared/material-package-loader.js';
import { createAssetLoading } from '../shared/asset-loading.js';
import { requireAuth, authState } from '../shared/auth.js';
import { fitMaterialPreview, assetImageUrl } from '../shared/material-preview.js';
import { compressImageFile } from '../shared/asset-thumbnail.js';
import { mountUploadTasks } from '../shared/upload-tasks-ui.js';
import { groupFabricCards } from '../shared/fabric-card-groups.js';
import { updateFabricColorSwatch } from '../shared/fabric-color-swatch.js';
import { fetchFabricColorPreview } from '../shared/fabric-color-preview.js';
import { syncFabricColorProgress } from '../shared/fabric-color-progress.js';
const $ = id => document.getElementById(id);
await requireAuth({ feature: 'assets' });
mountToolSwitcher('assets');
const libraryNames = { fabric: '\u9762\u6599\u5e93', pattern: '\u56fe\u6848\u5e93', model: '\u6a21\u578b\u5e93' };
const libraryType = asset => asset.kind === 'folder' ? asset.library || 'fabric' : asset.kind === 'model' ? 'model' : asset.kind === 'texture' ? 'pattern' : materialType(asset);
let assets = [], renderVersion = 0, activeLibrary = 'fabric', activeFolderId = null, openMenu, searchQuery = '';
const selectedAssetIds = new Set();
const renderedCards = new Map();
const cardUrls = new Map();
const hiddenDeletedAssetIds = new Set();
const selectedFabricColors = new Map(), fabricColorPages = new Map();
let editing, editPreview, editPreviewUrl, editVersion = 0, movingAssetIds = [], deletingAsset = null, deleteDialogResolver = null;
let currentPage = 1, pageContext = '', currentPageItems = [];
let assetsLoading = true;
const assetLoading = createAssetLoading({ host: $('assetPanel'), grid: $('assetGrid'), indicator: $('assetLoading') });
let fabricPreviewClosingTimer = null;
let fabricTextureRenderToken = 0;
let fabricTextureState = null;
let fabricPreviewAsset = null;
let fabricPreviewLoadingUrl = null;
const status = message => { $('status').textContent = message; };
const previewOf = asset => asset?.kind === 'material' ? asset.preview || null : asset.preview || asset.thumbnail || (asset.kind === 'texture' ? asset.file : asset.maps?.map);
const canEdit = asset => asset?.cloud && asset.ownerId === authState()?.id;
function imageUrl(blob) { return assetImageUrl(blob); }
function folderChildren(folderId) { return assets.filter(asset => (asset.parentId || null) === folderId && libraryType(asset) === activeLibrary); }
function folderById(id) { return assets.find(asset => asset.id === id && asset.kind === 'folder'); }
function folderPreviewChildren(folder) {
  return folderChildren(folder.id).filter(child => child.kind !== 'folder').slice(0, 3);
}
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
  await deleteAsset(folder.id);
}
function askDelete(asset, message) {
  const dialog = $('deleteDialog');
  $('deleteDialogMessage').textContent = message || (asset.kind === 'folder' ? `删除「${asset.name}」及其中内容？` : `确定删除「${asset.name}」？`);
  deletingAsset = asset;
  dialog.showModal(); $('confirmDelete').focus();
  return new Promise(resolve => { deleteDialogResolver = resolve; });
}
function settleDelete(value) {
  const resolver = deleteDialogResolver; deleteDialogResolver = null; deletingAsset = null;
  if ($('deleteDialog').open) $('deleteDialog').close();
  resolver?.(value);
}
function removeAssetsFromView(asset, removedIds = [asset.id], background = false) {
  const removed = new Set(removedIds);
  if (asset.kind === 'folder') {
    let changed = true;
    while (changed) { changed = false; for (const candidate of assets) if (candidate.parentId && removed.has(candidate.parentId) && !removed.has(candidate.id)) { removed.add(candidate.id); changed = true; } }
  }
  assets = assets.filter(candidate => !removed.has(candidate.id));
  for (const id of removed) {
    selectedAssetIds.delete(id); cardUrls.get(id)?.forEach(url => URL.revokeObjectURL(url)); cardUrls.delete(id); renderedCards.delete(id);
  }
  if (removed.has(activeFolderId)) activeFolderId = asset.parentId || null;
  render({ background });
}
async function deleteFabric(asset, wholeFabric) {
  const targets = wholeFabric ? asset.fabricVariants || [asset] : [asset];
  if (targets.some(target => !canEdit(target))) throw new Error('只有上传者可以删除面料');
  const message = wholeFabric
    ? `确定删除面料「${asset.name}」及其全部 ${targets.length} 个色号？`
    : `确定删除面料「${asset.name}」的色号「${asset.fabricColorCode || '未填写'}」？`;
  if (!await askDelete(asset, message)) return;
  const ids = new Set(targets.map(target => target.id));
  const snapshots = assets.filter(candidate => ids.has(candidate.id));
  const selected = snapshots.filter(candidate => selectedAssetIds.has(candidate.id));
  ids.forEach(id => hiddenDeletedAssetIds.add(id));
  removeAssetsFromView(asset, [...ids], true);
  const removed = [];
  try {
    for (const target of targets) { await deleteAsset(target.id); removed.push(target.id); }
  } catch (error) {
    const completed = new Set(removed);
    const restored = snapshots.filter(candidate => !completed.has(candidate.id));
    ids.forEach(id => { if (!completed.has(id)) hiddenDeletedAssetIds.delete(id); });
    const current = new Set(assets.map(candidate => candidate.id));
    assets.push(...restored.filter(candidate => !current.has(candidate.id)));
    selected.forEach(candidate => { if (!completed.has(candidate.id)) selectedAssetIds.add(candidate.id); });
    render({ background: true });
    throw new Error(`已删除 ${removed.length}/${targets.length} 个色号，未删除的内容已恢复。${error.message}`);
  }
  status(wholeFabric ? '已删除面料及全部色号' : '已删除当前色号');
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
    && canEdit(candidate) && candidate.id !== asset.id && !folderContains(candidate.id, asset.id)).sort((a, b) => folderLabel(a).localeCompare(folderLabel(b), 'zh-CN'));
}
function openMoveDialog(assetOrAssets) {
  const selection = Array.isArray(assetOrAssets) ? assetOrAssets : [assetOrAssets];
  if (!selection.length) return;
  const select = $('moveAssetTarget'); select.replaceChildren();
  const asset = selection[0];
  const root = document.createElement('option'); root.value = ''; root.textContent = libraryNames[libraryType(asset)] + '根目录'; select.append(root);
  for (const folder of moveTargets(asset).filter(folder => selection.every(item => folder.id !== item.id && !folderContains(folder.id, item.id)))) {
    const option = document.createElement('option'); option.value = folder.id; option.textContent = folderLabel(folder); select.append(option);
  }
  movingAssetIds = selection.map(item => item.id);
  $('moveDialogTitle').textContent = selection.length === 1 ? '移动「' + asset.name + '」' : `移动 ${selection.length} 项资产`;
  $('moveAssetError').textContent = ''; $('saveMove').disabled = false; select.value = asset.parentId || '';
  $('moveDialog').showModal(); select.focus();
}
function action(label, handler) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  button.onclick = async () => { closeMenu(); button.disabled = true; try { await handler(); } catch (error) { status(error.message); } finally { button.disabled = false; } };
  return button;
}
async function toggleFavorite(asset) {
  await updateAsset(asset.id, { favorite: !asset.favorite });
  await refresh(); status(asset.favorite ? '已取消收藏' : '已收藏');
}
function link(label, href) {
  const element = document.createElement('a'); element.className = 'button primary'; element.textContent = label; element.href = href; return element;
}
function menuLink(label, href, title = '') {
  const element = document.createElement('a');
  element.className = 'asset-menu-link'; element.textContent = label; element.href = href;
  if (title) { element.title = title; element.setAttribute('aria-label', title); }
  element.onclick = () => closeMenu();
  return element;
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
  const isModel = asset.kind === 'model';
  const actions = canEdit(asset) ? (isModel
    ? [menuLink('配置', './model-parts.html?asset=' + encodeURIComponent(asset.id)), action('移动', () => openMoveDialog(asset))]
    : [action('编辑', () => editAsset(asset, isMaterial ? 'material' : 'name')), action('移动', () => openMoveDialog(asset))])
    : isModel ? [menuLink('另存副本', './model-parts.html?asset=' + encodeURIComponent(asset.id))]
    : asset.kind !== 'folder' ? [menuLink('另存副本', './material-editor.html?asset=' + encodeURIComponent(asset.id))] : [];
  if (isMaterial) actions.push(action(asset.favorite ? '取消收藏' : '收藏', () => toggleFavorite(asset)));
  else if (!isModel && asset.kind !== 'folder') actions.push(action('导出', async () => {
    const full = await getAsset(asset.id);
    if (!full) throw new Error('资产已被删除');
    downloadFile(full.file, full.file.name); for (const file of full.resources || []) downloadFile(file, file.name);
  }));
  if (canEdit(asset)) {
    if (isMaterial && libraryType(asset) === 'fabric') {
      for (const [label, wholeFabric] of [['删除色号', false], ['删除面料', true]]) {
        const remove = action(label, () => deleteFabric(asset, wholeFabric));
        remove.classList.add('danger'); actions.push(remove);
      }
    } else {
    const remove = action(asset.kind === 'folder' ? '删除文件夹' : '删除', async () => {
    if (!await askDelete(asset)) return;
    if (asset.kind === 'folder') await removeFolderTree(asset); else await deleteAsset(asset.id);
    removeAssetsFromView(asset); status(asset.kind === 'folder' ? '已删除文件夹' : '已删除资产');
    });
    remove.classList.add('danger'); actions.push(remove);
    }
  }
  if (!actions.length) return document.createDocumentFragment();
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
  return asset?.maps?.map || asset?.runtimeMaps?.map || null;
}
function clearFabricPreviewLoadingImage() {
  $('fabricPreviewTextureFallback').classList.remove('is-revealing');
  const image = $('fabricPreviewLoadingImage');
  image.hidden = true; image.removeAttribute('src'); image.removeAttribute('style');
  if (fabricPreviewLoadingUrl) URL.revokeObjectURL(fabricPreviewLoadingUrl);
  fabricPreviewLoadingUrl = null;
}
function setFabricPreviewLoading(loading) {
  $('fabricPreviewSurface').setAttribute('aria-busy', String(loading));
  $('fabricPreviewLoader').hidden = !loading;
}
function finishFabricPreviewReveal() {
  $('fabricPreviewTextureFallback').hidden = true;
  setFabricPreviewLoading(false); clearFabricPreviewLoadingImage();
}
function revealFabricPreview() {
  $('fabricPreviewTexture').hidden = false;
  $('fabricPreviewSurface').setAttribute('aria-busy', 'false');
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) finishFabricPreviewReveal();
  else $('fabricPreviewTextureFallback').classList.add('is-revealing');
}
$('fabricPreviewTextureFallback').addEventListener('animationend', event => {
  if (event.target === event.currentTarget && event.animationName === 'fabric-preview-loading-out') finishFabricPreviewReveal();
});
window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
  if (event.matches && $('fabricPreviewTextureFallback').classList.contains('is-revealing')) finishFabricPreviewReveal();
});
function showFabricPreviewLoading(asset) {
  clearFabricPreviewLoadingImage();
  const image = $('fabricPreviewLoadingImage');
  const cardImage = renderedCards.get(asset.id)?.card.querySelector('.asset-art img');
  const source = previewOf(asset);
  const url = cardImage?.currentSrc || cardImage?.src || (source ? imageUrl(source) : null);
  if (url) {
    if (!cardImage && typeof source !== 'string') fabricPreviewLoadingUrl = url;
    image.src = url; image.hidden = false;
    fitMaterialPreview(image, asset.previewInfo);
  }
  $('fabricPreviewTexture').hidden = true;
  $('fabricPreviewTextureFallback').hidden = false;
  setFabricPreviewLoading(true);
}
const FABRIC_TEXTURE_SURFACE = { width: 1200, height: 900 };
const FABRIC_BOARD_CM = {
  面布: { width: 200, height: 150 },
  边布: { width: 36, height: 27 },
  包边条: { width: 8, height: 6 },
};
function fabricTextureRange(asset) {
  const category = asset.category || '其他';
  if (category === '面布') return { category, board: FABRIC_BOARD_CM.面布, defaultWidth: 120, minWidth: 40, maxWidth: 200, step: 4, zoomable: true };
  if (category === '边布') return { category, board: FABRIC_BOARD_CM.边布, defaultWidth: 22, minWidth: 8, maxWidth: 36, step: 1, zoomable: true };
  return { category, board: FABRIC_BOARD_CM.包边条, defaultWidth: 8, minWidth: 8, maxWidth: 8, step: 1, zoomable: false };
}
function clampFabricTextureWidth(state, value) {
  return Math.max(state.range.minWidth, Math.min(state.range.maxWidth, value));
}
function setFabricTextureWidth(state, value) {
  const next = clampFabricTextureWidth(state, value);
  if (next === state.widthCm) return;
  state.widthCm = next;
  renderFabricTexture(state);
}
function fabricTexturePhysicalSize(asset, bitmap) {
  const physical = asset.physical || {};
  let widthCm = Number(physical.widthCm), heightCm = Number(physical.heightCm);
  if (!Number.isFinite(widthCm) || widthCm <= 0) widthCm = 10;
  if (!Number.isFinite(heightCm) || heightCm <= 0) heightCm = widthCm * bitmap.height / Math.max(1, bitmap.width);
  return { widthCm, heightCm };
}
function renderFabricTexture(state) {
  if (!state?.canvas || !state.bitmap) return;
  const { width, height } = FABRIC_TEXTURE_SURFACE;
  const pixelsPerCm = width / state.widthCm;
  const visibleHeightCm = state.widthCm * height / width;
  if (state.canvas.width !== width) state.canvas.width = width;
  if (state.canvas.height !== height) state.canvas.height = height;
  const context = state.canvas.getContext('2d', { alpha: false });
  // Preview maps may be downsampled; their saved centimeter dimensions still
  // determine tile size, independently of the bitmap's resolution or aspect ratio.
  const tileWidth = state.physical.widthCm * pixelsPerCm;
  const tileHeight = state.physical.heightCm * pixelsPerCm;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
  let startX = width / 2 - tileWidth / 2, startY = height / 2 - tileHeight / 2;
  startX -= Math.ceil(startX / tileWidth) * tileWidth;
  startY -= Math.ceil(startY / tileHeight) * tileHeight;
  for (let y = startY; y < height; y += tileHeight) {
    for (let x = startX; x < width; x += tileWidth) context.drawImage(state.bitmap, x, y, tileWidth, tileHeight);
  }
  state.canvas.dataset.widthCm = String(state.widthCm);
  state.canvas.dataset.heightCm = String(visibleHeightCm);
  state.canvas.dataset.widthPx = String(width);
  state.canvas.dataset.heightPx = String(height);
  state.canvas.style.cursor = state.range.zoomable ? 'zoom-in' : 'default';
  state.canvas.setAttribute('aria-label', `面料纹理画板 ${previewNumber(state.widthCm)} × ${previewNumber(visibleHeightCm)} cm`);
  const zoom = $('fabricPreviewZoom');
  if (zoom) {
    zoom.hidden = false;
    zoom.textContent = `${previewNumber(state.widthCm)} × ${previewNumber(visibleHeightCm)} cm`;
  }
  const control = $('fabricPreviewZoomControl'), range = $('fabricPreviewZoomRange');
  if (control && range) {
    control.hidden = !state.range.zoomable;
    const { minWidth, maxWidth } = state.range;
    range.style.setProperty('--zoom-position', String((state.widthCm - minWidth) / (maxWidth - minWidth || 1)));
    range.setAttribute('aria-valuemin', '0'); range.setAttribute('aria-valuemax', String(maxWidth - minWidth)); range.setAttribute('aria-valuenow', String(maxWidth - state.widthCm));
    range.setAttribute('aria-valuetext', `${previewNumber(state.widthCm)} cm`);
  }
}
function fabricPreviewActive(token) {
  return token === fabricTextureRenderToken && $('fabricPreviewDialog').open && !$('fabricPreviewDialog').classList.contains('is-closing');
}
function showFabricPreviewError(message) {
  setFabricPreviewLoading(false);
  $('fabricPreviewErrorMessage').textContent = message;
  $('fabricPreviewError').hidden = false;
}
async function loadFabricTexture(asset, source, token, previewOnly = false) {
  const canvas = $('fabricPreviewTexture');
  let bitmap;
  try {
    if (typeof source === 'string') {
      const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('无法读取纹理预览');
      source = await response.blob();
    }
    bitmap = await createImageBitmap(await compressImageFile(source, 3600));
    if (!fabricPreviewActive(token)) return;
    if (previewOnly) {
      const { width, height } = FABRIC_TEXTURE_SURFACE;
      canvas.width = width; canvas.height = height;
      const info = asset.previewInfo;
      const ratio = Number(info?.widthCm) > 0 && Number(info?.heightCm) > 0 ? info.widthCm / info.heightCm : bitmap.width / bitmap.height;
      const drawWidth = width * Math.max(1, ratio / (width / height));
      const drawHeight = height * Math.max(1, (width / height) / ratio);
      canvas.getContext('2d').drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      canvas.style.cursor = 'default';
      canvas.setAttribute('aria-label', '面料预览图');
      revealFabricPreview();
      return;
    }
    const range = fabricTextureRange(asset);
    const physical = fabricTexturePhysicalSize(asset, bitmap);
    const state = { assetId: asset.id, canvas, bitmap, physical, range, widthCm: range.defaultWidth };
    fabricTextureState = state;
    renderFabricTexture(state);
    revealFabricPreview();
  } finally { if (bitmap && fabricTextureState?.bitmap !== bitmap) bitmap.close(); }
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
async function showFabricPreview(asset) {
  const dialog = $('fabricPreviewDialog');
  if (!dialog || asset?.kind !== 'material') return;
  if (fabricPreviewClosingTimer) { clearTimeout(fabricPreviewClosingTimer); fabricPreviewClosingTimer = null; }
  dialog.classList.remove('is-closing');
  const token = ++fabricTextureRenderToken;
  fabricPreviewAsset = asset;
  if (fabricTextureState?.bitmap) fabricTextureState.bitmap.close();
  fabricTextureState = null;
  $('fabricPreviewZoom').hidden = true;
  $('fabricPreviewZoomControl').hidden = true;
  $('fabricPreviewError').hidden = true;
  showFabricPreviewLoading(asset);
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
  if (!dialog.open) dialog.showModal();
  $('closeFabricPreview').focus();
  try {
    const full = await getAsset(asset.id, { texturePreview: true });
    if (!fabricPreviewActive(token)) return;
    if (!full) throw new Error('资产已被删除');
    const source = fabricPreviewSource(full);
    if (source) await loadFabricTexture(full, source, token);
    else if (previewOf(full)) await loadFabricTexture(full, previewOf(full), token, true);
    else {
      // A material without a color map can still have a plain surface color.
      const canvas = $('fabricPreviewTexture'), context = canvas.getContext('2d');
      context.fillStyle = /^#[\da-f]{6}$/i.test(full.surface?.color) ? full.surface.color : '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      canvas.style.cursor = 'default'; canvas.setAttribute('aria-label', '面料表面颜色');
      revealFabricPreview();
    }
  } catch (error) {
    if (!fabricPreviewActive(token)) return;
    fabricTextureState?.bitmap.close(); fabricTextureState = null;
    $('fabricPreviewZoom').hidden = true; $('fabricPreviewZoomControl').hidden = true;
    const preview = previewOf(asset);
    try {
      if (!preview) throw error;
      await loadFabricTexture(asset, preview, token, true);
      if (fabricPreviewActive(token)) showFabricPreviewError('纹理暂时无法加载，已显示预览图');
    } catch {
      if (!fabricPreviewActive(token)) return;
      clearFabricPreviewLoadingImage();
      showFabricPreviewError('纹理加载失败，请重试');
    }
  }
}
$('retryFabricPreview').onclick = () => { if (fabricPreviewAsset) void showFabricPreview(fabricPreviewAsset); };
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
  if (fabricTextureState?.bitmap) fabricTextureState.bitmap.close();
  fabricTextureState = null;
  fabricPreviewAsset = null;
  setFabricPreviewLoading(false); clearFabricPreviewLoadingImage();
  const canvas = $('fabricPreviewTexture');
  $('fabricPreviewZoom').hidden = true;
  canvas.hidden = true;
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
});

$('fabricPreviewTexture').addEventListener('wheel', event => {
  const state = fabricTextureState;
  if (!state?.range.zoomable || state.assetId === undefined) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? -1 : 1;
  setFabricTextureWidth(state, state.widthCm + direction * state.range.step);
}, { passive: false });
const fabricZoomSlider = $('fabricPreviewZoomRange');
let fabricZoomDrag = null;
fabricZoomSlider.addEventListener('pointerdown', event => {
  const state = fabricTextureState;
  if (!state?.range.zoomable || event.button !== 0 || fabricZoomDrag) return;
  event.preventDefault(); event.stopPropagation();
  const thumb = fabricZoomSlider.querySelector('.fabric-preview-zoom-thumb').getBoundingClientRect();
  fabricZoomDrag = { pointerId: event.pointerId, state, offsetY: event.clientY - (thumb.top + thumb.height / 2) };
  fabricZoomSlider.focus({ preventScroll: true });
  fabricZoomSlider.setPointerCapture(event.pointerId); fabricZoomSlider.classList.add('is-dragging');
});
function moveFabricZoomSlider(event) {
  const drag = fabricZoomDrag;
  if (!drag || drag.pointerId !== event.pointerId || drag.state !== fabricTextureState) return;
  const rect = fabricZoomSlider.getBoundingClientRect();
  const { minWidth, maxWidth, step } = drag.state.range;
  // The thumb's CSS top is expressed over the full slider span, so its center
  // can land exactly on the plus/minus button centers at 0 and 1.
  const position = Math.max(0, Math.min(1, (event.clientY - drag.offsetY - rect.top) / rect.height));
  const width = minWidth + Math.round(position * (maxWidth - minWidth) / step) * step;
  setFabricTextureWidth(drag.state, width);
}
fabricZoomSlider.addEventListener('pointermove', moveFabricZoomSlider);
fabricZoomSlider.addEventListener('pointerup', event => { moveFabricZoomSlider(event); endFabricZoomDrag(event); });
function endFabricZoomDrag(event) {
  if (!fabricZoomDrag || event && fabricZoomDrag.pointerId !== event.pointerId) return;
  const id = fabricZoomDrag.pointerId;
  fabricZoomDrag = null; fabricZoomSlider.classList.remove('is-dragging');
  if (fabricZoomSlider.hasPointerCapture(id)) fabricZoomSlider.releasePointerCapture(id);
}
fabricZoomSlider.addEventListener('pointercancel', endFabricZoomDrag);
fabricZoomSlider.addEventListener('lostpointercapture', endFabricZoomDrag);
$('fabricPreviewDialog').addEventListener('close', () => endFabricZoomDrag());
fabricZoomSlider.addEventListener('keydown', event => {
  const state = fabricTextureState;
  if (!state?.range.zoomable) return;
  const { minWidth, maxWidth, step } = state.range;
  const values = { ArrowUp: state.widthCm - step, ArrowRight: state.widthCm - step, ArrowDown: state.widthCm + step, ArrowLeft: state.widthCm + step,
    Home: maxWidth, End: minWidth, PageUp: state.widthCm - step * 5, PageDown: state.widthCm + step * 5 };
  if (!Object.hasOwn(values, event.key)) return;
  event.preventDefault(); setFabricTextureWidth(state, values[event.key]);
});
$('fabricPreviewZoomIn').addEventListener('click', () => {
  const state = fabricTextureState;
  if (state?.range.zoomable) setFabricTextureWidth(state, state.widthCm - state.range.step);
});
$('fabricPreviewZoomOut').addEventListener('click', () => {
  const state = fabricTextureState;
  if (state?.range.zoomable) setFabricTextureWidth(state, state.widthCm + state.range.step);
});

function showEditPreview(blob) {
  if (editPreviewUrl) URL.revokeObjectURL(editPreviewUrl);
  editPreviewUrl = blob ? imageUrl(blob) : null;
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
  showEditPreview(isPreview ? previewOf(asset) : null);
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
$('cancelMove').onclick = () => { if (!$('saveMove').disabled) $('moveDialog').close(); };
$('moveDialog').addEventListener('cancel', event => { if ($('saveMove').disabled) event.preventDefault(); });
$('moveDialog').addEventListener('close', () => { movingAssetIds = []; $('moveAssetError').textContent = ''; });
$('moveAssetForm').onsubmit = async event => {
  event.preventDefault(); if ($('saveMove').disabled || !movingAssetIds.length) return;
  const targetId = $('moveAssetTarget').value || null;
  const selected = movingAssetIds.map(id => assets.find(item => item.id === id)).filter(Boolean);
  if (!selected.length) { $('moveDialog').close(); return; }
  if (selected.some(asset => asset.kind === 'folder' && targetId && folderContains(targetId, asset.id))) {
    $('moveAssetError').textContent = '不能移动到当前文件夹或它的子文件夹'; return;
  }
  $('saveMove').disabled = true; $('moveAssetError').textContent = '';
  try {
    for (const asset of selected) await updateAsset(asset.id, { parentId: targetId });
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
    const next = field === 'material' ? {
      name: value,
      category: $('materialEditCategory').value,
      designInfo: $('materialEditDesignInfo').value.trim(),
      supplier: $('materialEditSupplier').value.trim(),
    } : { [field]: value };
    if (field === 'preview') {
      await updateAsset(id, { preview: value });
    } else await updateAsset(id, next);
    $('assetDialog').close(); await refresh(); status('已保存');
  } catch (error) { $('assetEditError').textContent = error.message; }
  finally { $('saveAssetEdit').disabled = false; }
};

function renderPagination(page) {
  const host = $('assetPagination'); host.replaceChildren(); host.hidden = !page.total;
  const change = next => {
    if (next === currentPage || next < 1 || next > page.totalPages) return;
    const direction = next > currentPage ? 'next' : 'previous';
    currentPage = next; render(); document.querySelector('.library-main').scrollTop = 0;
    animateCardPage($('assetGrid'), direction);
  };
  const button = (label, number, ariaLabel = label) => {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = label; element.setAttribute('aria-label', ariaLabel);
    element.onclick = () => change(number); return element;
  };
  const previous = button('‹', page.page - 1, '上一页'); previous.disabled = page.page === 1; host.append(previous);
  const numbers = new Set([1, page.totalPages, page.page - 1, page.page, page.page + 1]);
  if (page.totalPages <= 7) for (let i = 1; i <= page.totalPages; i++) numbers.add(i);
  let last = 0;
  for (const number of [...numbers].filter(n => n >= 1 && n <= page.totalPages).sort((a, b) => a - b)) {
    if (last && number > last + 1) { const dots = document.createElement('span'); dots.className = 'pagination-dots'; dots.textContent = '…'; host.append(dots); }
    const element = button(String(number), number, `第 ${number} 页`);
    if (number === page.page) element.setAttribute('aria-current', 'page'); host.append(element); last = number;
  }
  const next = button('›', page.page + 1, '下一页'); next.disabled = page.page === page.totalPages; host.append(next);
}
function cardSignature(asset) {
  return [asset.updatedAt, asset.kind, typeof asset.preview === 'string' ? asset.preview : asset.preview?.size, asset.name, asset.description, asset.designInfo, asset.supplier, asset.category, asset.favorite, asset.children?.join(','), asset.fabricVariants?.map(variant => [variant.id, variant.updatedAt, variant.fabricColorCode, variant.preview].join(':')).join(','), fabricColorPages.get(asset.fabricCardKey)].join('|');
}
function render({ background = false } = {}) {
  const loadingToken = background ? null : assetLoading.begin();
  if (!background) closeMenu();
  updateBreadcrumb();
  const host = $('assetGrid'), nextCards = [];
  const scroll = document.querySelector('.library-main'), scrollTop = scroll?.scrollTop;
  const appendCard = card => background ? nextCards.push(card) : host.append(card);
  if (!background) host.replaceChildren();
  const collection = assets.filter(asset => libraryType(asset) === activeLibrary && (asset.parentId || null) === activeFolderId);
  let shown = filterVisibleAssets(activeLibrary === 'fabric' ? groupFabricCards(collection, selectedFabricColors) : collection);
  const sortMode = $('assetSort')?.value || 'recent';
  shown.sort((a, b) => {
    const folderOrder = Number(b.kind === 'folder') - Number(a.kind === 'folder');
    if (folderOrder) return folderOrder;
    if (sortMode === 'nameAsc') return a.name.localeCompare(b.name, 'zh-CN');
    if (sortMode === 'nameDesc') return b.name.localeCompare(a.name, 'zh-CN');
    if (sortMode === 'oldest') return a.updatedAt - b.updatedAt;
    return b.updatedAt - a.updatedAt;
  });
  const context = JSON.stringify([activeLibrary, activeFolderId, searchQuery, $('assetCategory')?.value, sortMode]);
  if (context !== pageContext) { currentPage = 1; pageContext = context; }
  const page = assetPage(shown, currentPage); currentPage = page.page; shown = currentPageItems = page.items;
  const selectAllButton = $('selectAllAssets');
  if (selectAllButton) {
    const selectable = shown.filter(asset => asset.kind !== 'folder');
    selectAllButton.textContent = selectable.length && selectable.every(asset => selectedAssetIds.has(asset.id)) ? '取消全选' : '全选';
  }
  renderPagination(page);
  const visibleIds = new Set(shown.map(asset => asset.id));
  for (const id of renderedCards.keys()) if (!visibleIds.has(id)) {
    cardUrls.get(id)?.forEach(url => URL.revokeObjectURL(url)); cardUrls.delete(id); renderedCards.delete(id);
  }
  if (!shown.length) {
    const empty = document.createElement('div'); empty.className = 'asset-empty';
    const title = document.createElement('h2'); title.textContent = collection.length ? '没有匹配的资产' : libraryNames[activeLibrary] + '暂无资产';
    const text = document.createElement('p'); text.textContent = collection.length ? '尝试更换关键词或筛选条件。' : activeLibrary === 'model' ? '导入 FBX 或 GLB 模型，开始下一次设计。' : '导入图片或材质包，也可以在材质编辑器中新建材质。';
    empty.append(title, text); appendCard(empty);
  }
  for (const asset of shown) {
    const signature = cardSignature(asset);
    const cached = asset.kind === 'folder' ? null : renderedCards.get(asset.id);
    if (cached?.signature === signature) {
      syncCardSelection(cached.card, cached.selectControl, selectedAssetIds.has(asset.id));
      appendCard(cached.card);
      continue;
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
      if (asset.kind === 'model' && surface) location.href = './design.html?asset=' + encodeURIComponent(asset.id);
      if (asset.kind === 'material' && activeLibrary === 'fabric' && surface) showFabricPreview(asset);
    });
    const art = document.createElement('div'); art.className = 'asset-art';
    const urls = [];
    if (asset.kind === 'folder') {
      art.classList.add('folder-art');
      const folderPreviews = folderPreviewChildren(asset);
      art.classList.add(`folder-preview-count-${folderPreviews.length}`);
      for (const [index, child] of folderPreviews.entries()) {
        const preview = previewOf(child);
        const offsetX = `${index * -10}px`, offsetY = `${index * 10}px`;
        const stackStyle = element => {
          element.style.setProperty('--folder-preview-x', offsetX);
          element.style.setProperty('--folder-preview-y', offsetY);
          element.style.setProperty('--folder-preview-z', String(3 - index));
        };
        if (preview) {
          const img = document.createElement('img');
          img.className = 'folder-preview-card';
          img.src = imageUrl(preview);
          img.alt = '';
          img.setAttribute('aria-hidden', 'true');
          stackStyle(img);
          urls.push(img.src);
          art.append(img);
        } else {
          const swatch = document.createElement('div');
          swatch.className = 'folder-preview-card folder-preview-swatch';
          swatch.setAttribute('aria-hidden', 'true');
          stackStyle(swatch);
          if (/^#[\da-f]{6}$/i.test(child.surface?.color)) swatch.style.setProperty('--folder-preview-color', child.surface.color);
          art.append(swatch);
        }
      }
      const cover = document.createElement('div'); cover.className = 'folder-cover'; cover.setAttribute('aria-hidden', 'true');
      art.append(cover);
    } else {
      const preview = asset.kind === 'model' ? previewOf(asset) : previewOf(asset);
      if (preview) { const img = document.createElement('img'); const url = imageUrl(preview); urls.push(url); img.src = url; img.alt = asset.name + ' 预览图'; if (asset.kind === 'material') fitMaterialPreview(img, asset.previewInfo); art.append(img); }
      else { const shape = document.createElement('div'); shape.className = 'sphere preview-missing'; shape.textContent = '无预览图'; art.append(shape); }
    }
    if (asset.fabricVariants?.length) {
      const variants = asset.fabricVariants, key = asset.fabricCardKey;
      const totalPages = Math.ceil(variants.length / 8);
      let pageIndex = Math.min(fabricColorPages.get(key) ?? Math.floor(variants.findIndex(variant => variant.id === asset.id) / 8), totalPages - 1);
      const bar = document.createElement('div'); bar.className = 'asset-fabric-colors';
      bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', '面料色号');
      let colorRequest = 0, pendingColor = null, colorProgress = 0, colorController = null, progressTimer;
      const syncColorProgress = () => {
        bar.querySelectorAll('.asset-fabric-color').forEach(button => {
          syncFabricColorProgress(button, { pending: button.dataset.variantId === pendingColor, progress: colorProgress });
        });
      };
      const switchColor = async variant => {
        if (variant.id === pendingColor && colorProgress < 100) return;
        const request = ++colorRequest;
        colorController?.abort(); clearTimeout(progressTimer);
        pendingColor = null;
        if (variant.id === asset.id) { syncColorProgress(); return; }
        const controller = colorController = new AbortController();
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
        pendingColor = variant.id; colorProgress = 0; syncColorProgress();
        const report = value => {
          if (request !== colorRequest || !card.isConnected) return;
          colorProgress = Math.max(colorProgress, Math.round(value)); syncColorProgress();
        };
        const image = document.createElement('img');
        let url = null;
        try {
          const cover = await getAsset(variant.id, { previewOnly: true });
          if (request !== colorRequest || !card.isConnected) return;
          if (!cover?.preview) throw new Error('未找到已保存的预览图');
          const preview = cover.preview;
          Object.assign(variant, { preview, previewInfo: cover.previewInfo });
          report(5);
          try {
            const blob = await fetchFabricColorPreview(preview, {
              size: cover.previewReference?.size, signal,
              onProgress: value => report(5 + value * 90),
            });
            if (request !== colorRequest || !card.isConnected) return;
            url = imageUrl(blob);
          } catch (error) {
            if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
            // Some storage deployments allow <img> but block fetch CORS reads.
            report(60); url = preview;
          }
          if (url) { image.src = url; image.alt = variant.name + ' 预览图'; fitMaterialPreview(image, variant.previewInfo); await image.decode(); }
          if (request !== colorRequest || !card.isConnected) { if (url) URL.revokeObjectURL(url); return; }
          if (openMenu?.card === card) closeMenu();
          const oldId = asset.id;
          cardUrls.get(oldId)?.forEach(oldUrl => URL.revokeObjectURL(oldUrl));
          cardUrls.delete(oldId); renderedCards.delete(oldId);
          const { fabricCardKey, fabricVariants, updatedAt } = asset;
          Object.assign(asset, variant, { fabricCardKey, fabricVariants, updatedAt });
          selectedFabricColors.set(key, variant.id);
          card.dataset.assetId = variant.id;
          card.classList.toggle('is-favorite', !!variant.favorite);
          card.style.setProperty('--favorite-color', variant.surface?.color || '#3978ed');
          art.querySelectorAll(':scope > img,:scope > .preview-missing').forEach(element => element.remove());
          if (url) { art.prepend(image); cardUrls.set(variant.id, [url]); }
          else { const missing = document.createElement('div'); missing.className = 'sphere preview-missing'; missing.textContent = '无预览图'; art.prepend(missing); }
          card.querySelectorAll(':scope > .asset-menu-trigger,:scope > .asset-menu').forEach(element => element.remove());
          card.append(...createMenu(asset, card));
          const selection = card.querySelector('.asset-select-control');
          syncCardSelection(card, selection, selectedAssetIds.has(variant.id));
          const editLink = card.querySelector('.asset-actions a');
          if (editLink) editLink.href = './material-editor.html?asset=' + encodeURIComponent(variant.id);
          const description = card.querySelector('.asset-description');
          description.textContent = variant.description || '暂无简介'; description.title = variant.description || '';
          bar.querySelectorAll('.asset-fabric-color').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.variantId === variant.id)));
          renderedCards.set(variant.id, { signature: cardSignature(asset), card, selectControl: selection });
          report(100);
          progressTimer = setTimeout(() => {
            if (request === colorRequest) { pendingColor = null; syncColorProgress(); }
          }, 300);
        } catch (error) {
          if (url) URL.revokeObjectURL(url);
          if (request === colorRequest) {
            pendingColor = null; syncColorProgress();
            status('色号预览加载失败：' + (error.name === 'TimeoutError' ? '加载超时，请重试' : error.message));
          }
        }
      };
      const renderColorPage = () => {
      bar.replaceChildren();
      for (const variant of variants.slice(pageIndex * 8, pageIndex * 8 + 8)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'asset-fabric-color';
        button.setAttribute('aria-label', '切换色号 ' + variant.fabricColorCode);
        button.setAttribute('aria-pressed', String(variant.id === asset.id)); button.dataset.variantId = variant.id;
        const ball = document.createElement('span'); ball.className = 'fabric-color-swatch';
        const lines = document.createElement('span'); lines.className = 'fabric-color-swatch-lines'; lines.setAttribute('aria-hidden', 'true');
        ball.append(lines); updateFabricColorSwatch(ball, variant.fabricColorCode);
        ball.removeAttribute('title');
        button.append(ball);
        button.onclick = () => {
          void switchColor(variant);
        };
        bar.append(button);
      }
      if (totalPages > 1) {
        const next = document.createElement('button'); next.type = 'button'; next.className = 'asset-fabric-colors-next';
        next.textContent = '›'; next.title = '切换更多色号'; next.setAttribute('aria-label', `更多色号，第 ${pageIndex + 1} / ${totalPages} 页`);
        next.onclick = () => { pageIndex = (pageIndex + 1) % totalPages; fabricColorPages.set(key, pageIndex); renderColorPage(); const cached = renderedCards.get(asset.id); if (cached) cached.signature = cardSignature(asset); bar.querySelector('.asset-fabric-colors-next')?.focus({ preventScroll: true }); };
        bar.append(next);
      }
      syncColorProgress();
      };
      renderColorPage();
      art.append(bar);
    }
    if (urls.length) cardUrls.set(asset.id, urls);
    const info = document.createElement('div'); info.className = 'asset-info';
    const title = document.createElement('h2'); title.textContent = asset.name; title.title = asset.name;
    const description = document.createElement('p'); description.className = 'asset-description'; description.textContent = asset.description || '暂无简介'; description.title = asset.description || '';
    const actions = document.createElement('div'); actions.className = 'asset-actions';
    if (asset.kind !== 'model') actions.append(link('编辑材质', './material-editor.html?asset=' + encodeURIComponent(asset.id)));
    info.append(title, description, actions);
    const selectControl = asset.kind === 'folder' ? null : createSelectionControl(asset, card);
    if (selectControl) syncCardSelection(card, selectControl, selectedAssetIds.has(asset.id));
    card.append(art, info, ...(selectControl ? [selectControl] : []), ...createMenu(asset, card));
    renderedCards.set(asset.id, { signature, card, selectControl }); appendCard(card);
  }
  if (background) {
    let cursor = host.firstChild;
    for (const card of nextCards) {
      if (card === cursor) cursor = cursor.nextSibling;
      else host.insertBefore(card, cursor);
    }
    while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
    if (openMenu && !openMenu.card.isConnected) closeMenu();
    if (scroll) scroll.scrollTop = scrollTop;
  }
  requestAnimationFrame(() => syncAssetScrollbar());
  if (!background && !assetsLoading) void assetLoading.finish(loadingToken);
}
async function refresh({ background = false } = {}) {
  background = background && !assetsLoading;
  const version = ++renderVersion;
  if (!background) { assetsLoading = true; assetLoading.begin(); }
  const show = result => {
    if (version !== renderVersion) return;
    result = result.filter(asset => !hiddenDeletedAssetIds.has(asset.id));
    const ids = new Set(result.map(asset => asset.id));
    for (const id of selectedAssetIds) if (!ids.has(id)) selectedAssetIds.delete(id);
    for (const id of renderedCards.keys()) if (!ids.has(id)) {
      cardUrls.get(id)?.forEach(url => URL.revokeObjectURL(url));
      cardUrls.delete(id); renderedCards.delete(id);
    }
    if (background) {
      const previous = new Map(assets.map(asset => [asset.id, asset]));
      for (const asset of result) {
        const existing = previous.get(asset.id);
        if (existing?.updatedAt === asset.updatedAt && existing.preview) asset.preview = existing.preview;
      }
    }
    assets = result.sort((a, b) => b.updatedAt - a.updatedAt); render({ background });
  };
  try {
    const result = await listAssets({ onProgress: (items, progress) => {
      if (version !== renderVersion) return;
      status(progress.message);
    } });
    if (version !== renderVersion) return;
    assetsLoading = false;
    show(result);
  }
  catch (error) {
    if (version !== renderVersion) return;
    assetsLoading = false; status(error.message); if (!background) render();
  }
}
const tabs = [...document.querySelectorAll('[data-library]')];
function selectLibrary(type, { updateUrl = true } = {}) {
  const previousIndex = tabs.findIndex(tab => tab.dataset.library === activeLibrary);
  const nextIndex = tabs.findIndex(tab => tab.dataset.library === type);
  const pageDirection = nextIndex >= previousIndex ? 'next' : 'previous';
  const changed = type !== activeLibrary;
  if (type !== activeLibrary) activeFolderId = null;
  activeLibrary = type;
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('library', type);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  for (const tab of tabs) { const selected = tab.dataset.library === type; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; }
  $('assetPanel').setAttribute('aria-label', libraryNames[type]);
  if ($('assetCategory')) {
    $('assetCategory').disabled = type !== 'fabric';
    $('assetCategory').hidden = type === 'model';
  }
  render();
  if (changed) animateCardPage($('assetGrid'), pageDirection);
}
function animateCardPage(host, direction) {
  if (!host) return;
  host.classList.remove('page-turn-next', 'page-turn-previous');
  void host.offsetWidth;
  host.classList.add(direction === 'previous' ? 'page-turn-previous' : 'page-turn-next');
  window.setTimeout(() => host.classList.remove('page-turn-next', 'page-turn-previous'), 440);
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
  const selectable = currentPageItems.filter(asset => asset.kind !== 'folder');
  $('selectAllAssets').textContent = selectable.length && selectable.every(asset => selectedAssetIds.has(asset.id)) ? '取消全选' : '全选';
  menu.hidden = !menu.hidden; button.setAttribute('aria-expanded', String(!menu.hidden));
};
$('selectAllAssets').onclick = () => {
  const shown = currentPageItems.filter(asset => asset.kind !== 'folder');
  const allSelected = shown.length > 0 && shown.every(asset => selectedAssetIds.has(asset.id));
  shown.forEach(asset => allSelected ? selectedAssetIds.delete(asset.id) : selectedAssetIds.add(asset.id));
  closeMoreMenu(); render(); status(shown.length ? (allSelected ? `已取消全选 ${shown.length} 项资产` : `已选择 ${shown.length} 项资产`) : '当前没有可选择的资产');
};
function selectedAssetsForBatchAction() {
  return [...selectedAssetIds].map(id => assets.find(asset => asset.id === id)).filter(Boolean);
}
$('moveSelectedAssets').onclick = () => {
  const selected = selectedAssetsForBatchAction(); closeMoreMenu();
  if (!selected.length) return status('请先选择要移动的资产');
  if (selected.some(asset => !canEdit(asset))) return status('只有上传者可以移动资产');
  if (new Set(selected.map(asset => libraryType(asset))).size > 1) return status('请选择同一资产库中的内容再移动');
  openMoveDialog(selected);
};
$('deleteSelectedAssets').onclick = async () => {
  if ($('deleteSelectedAssets').disabled) return;
  const selected = selectedAssetsForBatchAction(); closeMoreMenu();
  if (!selected.length) return status('请先选择要删除的资产');
  if (selected.some(asset => !canEdit(asset))) return status('只有上传者可以删除资产');
  $('deleteSelectedAssets').disabled = true;
  const removedIds = [];
  try {
    if (!await askDelete(selected[0], `确定删除选中的 ${selected.length} 项资产？`)) return;
    for (const asset of selected) { await deleteAsset(asset.id); removedIds.push(asset.id); }
    removeAssetsFromView(selected[0], selected.map(asset => asset.id));
    status(`已删除 ${selected.length} 项资产`);
  } catch (error) {
    if (removedIds.length) removeAssetsFromView(selected[0], removedIds);
    status(`已删除 ${removedIds.length}/${selected.length} 项资产。${error.message}`);
  } finally { $('deleteSelectedAssets').disabled = false; }
};
$('importAssets').onclick = () => {
  const menu = $('assetAddMenu'); menu.hidden = !menu.hidden;
  $('importAssets').setAttribute('aria-expanded', String(!menu.hidden));
};
$('importAssetsMenu').onclick = () => { closeAssetAddMenu(); $('assetFiles').click(); };
$('createFolder').onclick = () => {
  closeAssetAddMenu();
  $('newFolderName').value = '';
  $('newFolderError').textContent = '';
  $('newFolderDialog').showModal();
  $('newFolderName').focus();
};
$('cancelNewFolder').onclick = () => $('newFolderDialog').close();
$('newFolderDialog').addEventListener('close', () => {
  $('newFolderError').textContent = '';
});
$('cancelDelete').onclick = () => settleDelete(false);
$('deleteAssetForm').onsubmit = event => { event.preventDefault(); settleDelete(true); };
$('deleteDialog').addEventListener('cancel', event => { event.preventDefault(); settleDelete(false); });
$('deleteDialog').addEventListener('close', () => { if (deleteDialogResolver) settleDelete(false); });
$('newFolderForm').onsubmit = async event => {
  event.preventDefault();
  const name = $('newFolderName').value.trim();
  if (!name) { $('newFolderError').textContent = '请输入文件夹名称'; $('newFolderName').focus(); return; }
  const submit = $('newFolderForm').querySelector('button[type=submit]');
  submit.disabled = true; $('newFolderError').textContent = '';
  try {
    await saveAsset({ kind: 'folder', name, parentId: canEdit(folderById(activeFolderId)) ? activeFolderId : null, library: activeLibrary, children: [] });
    $('newFolderDialog').close(); currentPage = 1; await refresh(); status('已创建文件夹');
  } catch (error) { $('newFolderError').textContent = error.message; }
  finally { submit.disabled = false; }
};
$('assetFiles').onchange = async () => {
  const files = [...$('assetFiles').files]; $('assetFiles').value = '';
  const resources = files.filter(file => /\.(png|jpe?g|webp|bmp|ktx2|bin)$/i.test(file.name));
  $('importAssets').disabled = true;
  let count = 0, firstLibrary, importedModelId = null; const errors = [];
  for (const file of files) {
    try {
      let asset;
      if (/\.formmat$/i.test(file.name)) asset = await unpackMaterialAsync(file);
      else if (/\.(fbx|glb)$/i.test(file.name)) {
        if (file.size > 512 * 1024 * 1024) throw new Error('模型不能超过 512 MB');
        if (resources.some(resource => resource.size > 64 * 1024 * 1024)) throw new Error('配套资源不能超过 64 MB');
        asset = { kind: 'model', name: file.name, file, resources: resources.filter(resource => resource !== file) };
      } else if (resources.includes(file) && /\.(png|jpe?g|webp|bmp)$/i.test(file.name)) {
        if (file.size > 64 * 1024 * 1024) throw new Error('贴图不能超过 64 MB');
        asset = { kind: 'texture', name: file.name, file };
      } else if (resources.includes(file)) continue;
      else throw new Error('不支持的文件类型');
      asset.parentId = canEdit(folderById(activeFolderId)) ? activeFolderId : null;
      const saved = await saveAsset(asset); firstLibrary ??= libraryType(saved); if (saved.kind === 'model' && !importedModelId) importedModelId = saved.id; count++;
    } catch (error) { errors.push(file.name + '：' + error.message); }
  }
  currentPage = 1;
  if (firstLibrary) selectLibrary(firstLibrary);
  await refresh(); $('importAssets').disabled = false;
  status(`已导入 ${count} 项资产` + (errors.length ? '；' + errors.join('；') : ''));
  if (importedModelId) location.href = './model-parts.html?asset=' + encodeURIComponent(importedModelId);
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
let assetsStale = false;
window.addEventListener('storage', event => { if (event.key === 'spenic-assets-revision') assetsStale = true; });
window.addEventListener('focus', () => { if (assetsStale && !$('assetDialog').open && !$('fabricPreviewDialog').open) { assetsStale = false; void refresh({ background: true }); } });
const initialLibrary = new URLSearchParams(location.search).get('library');
let uploadRefreshTimer;
mountUploadTasks({ button: $('uploadTasksButton'), badge: $('uploadTasksBadge'), panel: $('uploadTasksPanel'), list: $('uploadTasksList'), clear: $('clearCompletedUploads'), onComplete: () => {
  clearTimeout(uploadRefreshTimer);
  uploadRefreshTimer = setTimeout(() => {
    if ($('assetDialog').open || $('fabricPreviewDialog').open) assetsStale = true;
    else { assetsStale = false; void refresh({ background: true }); }
  }, 300);
} });
selectLibrary(Object.hasOwn(libraryNames, initialLibrary) ? initialLibrary : 'fabric', { updateUrl: !!initialLibrary });
refresh();
