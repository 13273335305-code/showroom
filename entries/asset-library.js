import { downloadFile } from '../shared/navigation.js';
import { listAssets, getAsset, saveAsset, updateAsset, deleteAsset } from '../shared/asset-store.js';
import { materialType, assetPage } from '../shared/asset-metadata.js';
import { unpackMaterialAsync } from '../shared/material-package-loader.js';
import { createAssetLoading } from '../shared/asset-loading.js';
import { requireAuth, authState } from '../shared/auth.js';
import { fitMaterialPreview, assetImageUrl } from '../shared/material-preview.js';
const $ = id => document.getElementById(id);
await requireAuth({ feature: 'assets' });
const libraryNames = { fabric: '\u9762\u6599\u5e93', pattern: '\u56fe\u6848\u5e93', model: '\u6a21\u578b\u5e93' };
const libraryType = asset => asset.kind === 'folder' ? asset.library || 'fabric' : asset.kind === 'model' ? 'model' : asset.kind === 'texture' ? 'pattern' : materialType(asset);
let assets = [], renderVersion = 0, activeLibrary = 'fabric', activeFolderId = null, openMenu, searchQuery = '';
const selectedAssetIds = new Set();
const renderedCards = new Map();
const cardUrls = new Map();
let editing, editPreview, editPreviewUrl, editVersion = 0, movingAssetId = null;
let currentPage = 1, pageContext = '', currentPageItems = [];
let assetsLoading = true;
const assetLoading = createAssetLoading({ host: $('assetPanel'), grid: $('assetGrid'), indicator: $('assetLoading') });
let fabricPreviewClosingTimer = null;
let fabricTextureRenderToken = 0;
let fabricTextureState = null;
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
    const remove = action(asset.kind === 'folder' ? '删除文件夹' : '删除', async () => {
    if (!confirm((asset.kind === 'folder' ? '删除文件夹「' : '删除「') + asset.name + '」及其中内容？')) return;
    if (asset.kind === 'folder') await removeFolderTree(asset); else await deleteAsset(asset.id);
    if (activeFolderId === asset.id) activeFolderId = asset.parentId || null;
    await refresh(); status(asset.kind === 'folder' ? '已删除文件夹' : '已删除资产');
    });
    remove.classList.add('danger'); actions.push(remove);
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
  return asset?.runtimeMaps?.map || asset?.maps?.map || null;
}
const FABRIC_TEXTURE_SURFACE = { width: 3600, height: 2700 };
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
function fabricTexturePhysicalSize(asset, bitmap) {
  const physical = asset.physical || {};
  let widthCm = Number(physical.widthCm), heightCm = Number(physical.heightCm);
  if (!Number.isFinite(widthCm) || widthCm <= 0) widthCm = 10;
  if (!Number.isFinite(heightCm) || heightCm <= 0) heightCm = widthCm * bitmap.height / Math.max(1, bitmap.width);
  return { widthCm, heightCm };
}
function renderFabricTexture(state) {
  if (!state?.canvas || !state.bitmap) return;
  const visibleHeightCm = state.widthCm * state.range.board.height / state.range.board.width;
  const visibleWidthPx = Math.min(FABRIC_TEXTURE_SURFACE.width, Math.max(1, Math.round(FABRIC_TEXTURE_SURFACE.width * state.widthCm / state.range.board.width)));
  const visibleHeightPx = Math.min(FABRIC_TEXTURE_SURFACE.height, Math.max(1, Math.round(FABRIC_TEXTURE_SURFACE.height * visibleHeightCm / state.range.board.height)));
  // The backing canvas is the exported image. Resize it to the current
  // physical window instead of keeping the maximum board size for every zoom.
  state.canvas.width = visibleWidthPx;
  state.canvas.height = visibleHeightPx;
  const width = visibleWidthPx, height = visibleHeightPx;
  const context = state.canvas.getContext('2d', { alpha: false });
  // Keep the board's physical pixel density stable as the viewport changes.
  // A low-resolution source may be reduced, but is never enlarged merely to
  // fill the 3600 × 2700 board limit.
  const pixelsPerCm = FABRIC_TEXTURE_SURFACE.width / state.range.board.width;
  const desiredTileWidth = state.physical.widthCm * pixelsPerCm;
  const desiredTileHeight = state.physical.heightCm * pixelsPerCm;
  const tileScale = Math.min(1, desiredTileWidth / Math.max(1, state.bitmap.width), desiredTileHeight / Math.max(1, state.bitmap.height));
  const tileWidth = Math.max(1, state.bitmap.width * tileScale);
  const tileHeight = Math.max(1, state.bitmap.height * tileScale);
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
  state.canvas.dataset.widthPx = String(visibleWidthPx);
  state.canvas.dataset.heightPx = String(visibleHeightPx);
  state.canvas.style.cursor = state.range.zoomable ? 'zoom-in' : 'default';
  state.canvas.setAttribute('aria-label', `面料纹理画板 ${previewNumber(state.widthCm)} × ${previewNumber(visibleHeightCm)} cm`);
  const zoom = $('fabricPreviewZoom');
  if (zoom) {
    zoom.hidden = false;
    zoom.textContent = `${previewNumber(state.widthCm)} × ${previewNumber(visibleHeightCm)} cm`;
  }
}
async function loadFabricTexture(asset, source) {
  const token = ++fabricTextureRenderToken;
  const canvas = $('fabricPreviewTexture'), fallback = $('fabricPreviewTextureFallback');
  try {
    const bitmap = await createImageBitmap(source);
    if (token !== fabricTextureRenderToken) { bitmap.close(); return; }
    const range = fabricTextureRange(asset);
    const physical = fabricTexturePhysicalSize(asset, bitmap);
    const state = { assetId: asset.id, canvas, bitmap, physical, range, widthCm: range.defaultWidth };
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
async function showFabricPreview(asset) {
  const dialog = $('fabricPreviewDialog');
  if (!dialog || asset?.kind !== 'material') return;
  if (fabricPreviewClosingTimer) { clearTimeout(fabricPreviewClosingTimer); fabricPreviewClosingTimer = null; }
  dialog.classList.remove('is-closing');
  const token = ++fabricTextureRenderToken;
  if (fabricTextureState?.bitmap) fabricTextureState.bitmap.close();
  fabricTextureState = null;
  const canvas = $('fabricPreviewTexture'), fallback = $('fabricPreviewTextureFallback');
  $('fabricPreviewZoom').hidden = true;
  canvas.hidden = true; fallback.hidden = false; fallback.textContent = '正在加载纹理…';
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
  try {
    const full = await getAsset(asset.id, { runtime: true });
    if (token !== fabricTextureRenderToken || !dialog.open || dialog.classList.contains('is-closing')) return;
    const source = fabricPreviewSource(full);
    fallback.textContent = '无纹理图';
    if (source) await loadFabricTexture(full, source);
  } catch (error) {
    if (token === fabricTextureRenderToken && dialog.open) fallback.textContent = '纹理加载失败，请关闭后重试';
    status(error.message);
  }
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
  if (fabricTextureState?.bitmap) fabricTextureState.bitmap.close();
  fabricTextureState = null;
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
  const next = clampFabricTextureWidth(state, state.widthCm + direction * state.range.step);
  if (next === state.widthCm) return;
  state.widthCm = next;
  renderFabricTexture(state);
}, { passive: false });

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
    await updateAsset(asset.id, { parentId: targetId });
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
function render() {
  const loadingToken = assetLoading.begin();
  closeMenu();
  updateBreadcrumb();
  const host = $('assetGrid'); host.replaceChildren();
  const collection = assets.filter(asset => libraryType(asset) === activeLibrary && (asset.parentId || null) === activeFolderId);
  let shown = filterVisibleAssets(collection);
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
  renderPagination(page);
  const visibleIds = new Set(shown.map(asset => asset.id));
  for (const id of renderedCards.keys()) if (!visibleIds.has(id)) {
    cardUrls.get(id)?.forEach(url => URL.revokeObjectURL(url)); cardUrls.delete(id); renderedCards.delete(id);
  }
  if (!shown.length) {
    const empty = document.createElement('div'); empty.className = 'asset-empty';
    const title = document.createElement('h2'); title.textContent = collection.length ? '没有匹配的资产' : libraryNames[activeLibrary] + '暂无资产';
    const text = document.createElement('p'); text.textContent = collection.length ? '尝试更换关键词或筛选条件。' : activeLibrary === 'model' ? '导入 FBX 或 GLB 模型，开始下一次设计。' : '导入图片或材质包，也可以在材质编辑器中新建材质。';
    empty.append(title, text); host.append(empty);
  }
  for (const asset of shown) {
    const signature = [asset.updatedAt, asset.builtinVersion, asset.kind, typeof asset.preview === 'string' ? asset.preview : asset.preview?.size, asset.name, asset.description, asset.designInfo, asset.supplier, asset.category, asset.favorite, asset.children?.join(',')].join('|');
    const cached = asset.kind === 'folder' ? null : renderedCards.get(asset.id);
    if (cached?.signature === signature) {
      syncCardSelection(cached.card, cached.selectControl, selectedAssetIds.has(asset.id));
      host.append(cached.card);
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
    renderedCards.set(asset.id, { signature, card, selectControl }); host.append(card);
  }
  requestAnimationFrame(() => syncAssetScrollbar());
  if (!assetsLoading) void assetLoading.finish(loadingToken);
}
async function refresh({ refreshCatalog = false } = {}) {
  const version = ++renderVersion;
  assetsLoading = true; assetLoading.begin();
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
    const result = await listAssets({ refreshCatalog, onProgress: (items, progress) => {
      if (version !== renderVersion) return;
      status(progress.message);
    } });
    if (version !== renderVersion) return;
    assetsLoading = false;
    show(result);
  }
  catch (error) {
    if (version !== renderVersion) return;
    assetsLoading = false; status(error.message); render();
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
  menu.hidden = !menu.hidden; button.setAttribute('aria-expanded', String(!menu.hidden));
};
$('selectAllAssets').onclick = () => {
  const shown = currentPageItems.filter(asset => asset.kind !== 'folder');
  shown.forEach(asset => selectedAssetIds.add(asset.id));
  closeMoreMenu(); render(); status(shown.length ? `已选择 ${shown.length} 项资产` : '当前没有可选择的资产');
};
$('refreshAssets').onclick = () => { closeMoreMenu(); refresh({ refreshCatalog: true }); };
$('clearSearch').onclick = () => {
  searchInput.value = ''; searchQuery = ''; $('assetCategory').value = 'all'; closeMoreMenu(); render();
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
window.addEventListener('focus', () => { if (assetsStale && !$('assetDialog').open && !$('fabricPreviewDialog').open) { assetsStale = false; refresh(); } });
const initialLibrary = new URLSearchParams(location.search).get('library');
selectLibrary(Object.hasOwn(libraryNames, initialLibrary) ? initialLibrary : 'fabric', { updateUrl: !!initialLibrary });
refresh();
