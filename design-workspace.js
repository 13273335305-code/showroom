import { listAssets, getAsset } from './shared/asset-store.js';
import { materialType } from './shared/material-placement.js';
import { createAssetLoading } from './shared/asset-loading.js';
import { fitMaterialPreview, assetImageUrl } from './shared/material-preview.js';

const $ = id => document.getElementById(id);
export function createDesignWorkspace(api) {
  let type = 'fabric', target = null, assets = [], urls = [], request = 0, pickerFolderId = null;
  const addButton = $('addDockAsset');
  const activeList = () => $(type === 'fabric' ? 'materialList' : 'patternDock');
  const activeScrollbar = () => $(type === 'fabric' ? 'fabricScrollbar' : 'patternScrollbar');
  const scrollbarThumb = scrollbar => scrollbar?.querySelector('.dock-scrollbar-thumb');
  let removing = false;
  const checked = new Map(), dockItems = new WeakMap(), dock = document.querySelector('.material-dock');
  const itemKey = item => item.entry || item.source || item.pattern;
  function syncRemoval() {
    for (const [key, item] of checked) if (!api.canRemove(item)) checked.delete(key);
    for (const button of dock.querySelectorAll('.material-item')) {
      const record = dockItems.get(button); if (!record) continue;
      const allowed = api.canRemove(record.item), key = itemKey(record.item);
      button.querySelector('.dock-select-box')?.remove();
      button.disabled = removing && !allowed;
      button.classList.toggle('removal-locked', removing && !allowed);
      button.classList.toggle('removal-selected', removing && checked.has(key));
      if (removing && allowed) {
        const box = document.createElement('span'); box.className = 'dock-select-box'; box.setAttribute('aria-hidden', 'true'); button.append(box);
        button.setAttribute('role', 'checkbox'); button.setAttribute('aria-checked', String(checked.has(key))); button.removeAttribute('aria-pressed');
        button.title = '选择删除：' + record.label;
      } else {
        button.removeAttribute('role'); button.removeAttribute('aria-checked');
        if (record.pressed !== null) button.setAttribute('aria-pressed', record.pressed);
        button.title = removing ? '正在应用，不可删除' : record.title;
      }
    }
    addButton.hidden = removing;
    $('dockTrash').hidden = removing; $('dockDeleteActions').hidden = !removing;
    $('dockDeleteSelected').disabled = checked.size === 0;
    $('dockDeleteSelected').textContent = checked.size ? `删除 (${checked.size})` : '删除';
    dock.classList.toggle('removal-mode', removing);
  }
  function exitRemoval() { removing = false; checked.clear(); syncRemoval(); }
  function bindDockItem(button, item) {
    dockItems.set(button, { item, label: button.getAttribute('aria-label'), title: button.title, pressed: button.getAttribute('aria-pressed') });
    for (const name of ['pointerdown', 'dblclick']) button.addEventListener(name, event => { if (removing) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    button.addEventListener('click', event => {
      if (!removing) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!api.canRemove(item)) return;
      const key = itemKey(item); if (checked.has(key)) checked.delete(key); else checked.set(key, item);
      syncRemoval();
    }, true);
  }
  $('dockTrash').onclick = () => { api.prepareRemoval(); removing = true; checked.clear(); syncRemoval(); };
  $('dockCancelDelete').onclick = exitRemoval;
  $('dockDeleteSelected').onclick = () => {
    const count = api.removeUnused([...checked.values()]);
    exitRemoval(); if (count) api.notify(`已从当前设计台移除 ${count} 个材质或图案`);
  };
  document.addEventListener('keydown', event => { if (removing && event.key === 'Escape') exitRemoval(); });
  function syncScrollbar() {
    const list = activeList(), scrollbar = activeScrollbar(), thumb = scrollbarThumb(scrollbar);
    if (!list || !scrollbar || !thumb) return;
    const trackWidth = scrollbar.clientWidth, maxScroll = Math.max(0, list.scrollWidth - list.clientWidth);
    const thumbWidth = maxScroll <= 1 || list.scrollWidth <= 0 ? trackWidth : Math.min(trackWidth, Math.max(48, Math.round(trackWidth * list.clientWidth / list.scrollWidth)));
    const travel = Math.max(0, trackWidth - thumbWidth);
    thumb.style.width = `${thumbWidth}px`;
    thumb.style.transform = `translateX(${maxScroll <= 1 ? 0 : Math.round(travel * list.scrollLeft / maxScroll)}px)`;
  }
  function syncDock() {
    const list = activeList();
    if (list.lastElementChild !== addButton) list.append(addButton);
    addButton.dataset.type = type;
    const label = type === 'fabric' ? '面料' : '图案';
    addButton.setAttribute('aria-label', '从资产库新增' + label); addButton.title = '新增' + label;
    syncRemoval();
    syncScrollbar();
  }
  const resizeDock = new ResizeObserver(syncScrollbar);
  for (const list of [$('materialList'), $('patternDock')]) {
    resizeDock.observe(list);
    list.addEventListener('scroll', syncScrollbar, { passive: true });
    list.addEventListener('wheel', event => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth);
      if (maxScroll <= 0) return;
      list.scrollLeft += event.deltaY;
      event.preventDefault();
    }, { passive: false });
  }
  let draggingScrollbar = null;
  function scrollFromScrollbar(clientX) {
    const list = activeList(), scrollbar = activeScrollbar(), thumb = scrollbarThumb(scrollbar);
    if (!list || !scrollbar || !thumb) return;
    const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth), track = scrollbar.getBoundingClientRect();
    const travel = Math.max(1, track.width - thumb.offsetWidth);
    const offset = Math.max(0, Math.min(travel, clientX - track.left - thumb.offsetWidth / 2));
    list.scrollLeft = maxScroll * offset / travel;
  }
  for (const scrollbar of [$('fabricScrollbar'), $('patternScrollbar')]) {
    scrollbar.addEventListener('pointerdown', event => {
      const thumb = scrollbarThumb(scrollbar);
      if (event.target === thumb) {
        draggingScrollbar = { pointerId: event.pointerId, startX: event.clientX, startScroll: activeList().scrollLeft };
        thumb.setPointerCapture?.(event.pointerId);
      } else scrollFromScrollbar(event.clientX);
    });
    scrollbar.addEventListener('pointermove', event => {
      if (!draggingScrollbar || draggingScrollbar.pointerId !== event.pointerId) return;
      const list = activeList(), track = scrollbar.getBoundingClientRect(), thumb = scrollbarThumb(scrollbar);
      const travel = Math.max(1, track.width - thumb.offsetWidth), maxScroll = Math.max(0, list.scrollWidth - list.clientWidth);
      list.scrollLeft = draggingScrollbar.startScroll + (event.clientX - draggingScrollbar.startX) * maxScroll / travel;
    });
    scrollbar.addEventListener('pointerup', () => { draggingScrollbar = null; });
    scrollbar.addEventListener('pointercancel', () => { draggingScrollbar = null; });
  }
  const panel = $('compactMaterialPanel');
  panel.innerHTML = `<div class="compact-preview"><div id="compactSwatch"></div><strong id="compactName"></strong></div>
    <label class="color-row">基础颜色<input id="compactColor" type="color" aria-label="基础颜色"></label>
    <div class="section-heading"><h2>UV 偏移</h2></div><div class="uv-row"><label>U<input id="compactOffsetU" type="number" step="0.01" min="-100" max="100" value="0"></label><label>V<input id="compactOffsetV" type="number" step="0.01" min="-100" max="100" value="0"></label></div>
    <label class="range-row">角度<output id="compactAngleValue">0°</output><input id="compactAngle" type="range" min="-180" max="180" step="1" value="0"></label>`;
  function sync() {
    if (!target) return;
    const data = api.read(target);
    $('compactName').textContent = data.name;
    $('compactColor').value = data.color;
    $('compactOffsetU').value = data.offset[0]; $('compactOffsetV').value = data.offset[1];
    $('compactAngle').value = data.angle; $('compactAngleValue').textContent = data.angle + '°';
    api.preview($('compactSwatch'), target);
  }
  function select(item) { target = item; sync(); }
  function setType(next) {
    if (next !== type) { checked.clear(); pickerCategoryValue = 'all'; closePickerCategory(); }
    type = next;
    syncPickerCategory();
    $('fabricDock').hidden = type !== 'fabric'; $('patternDock').hidden = type !== 'pattern';
    $('patternBrowser').hidden = type !== 'pattern';
    for (const [id, value] of [['fabricDockTab', 'fabric'], ['patternDockTab', 'pattern']]) { $(id).classList.toggle('active', type === value); $(id).setAttribute('aria-pressed', String(type === value)); }
    $('dockUndo').hidden = type !== 'fabric';
    $('dockPatternPlace').hidden = true;
    syncDock();
  }
  for (const [id, value] of [['fabricDockTab', 'fabric'], ['patternDockTab', 'pattern']]) $(id).onclick = () => { api.cancelPlacement(); setType(value); };
  $('backToScene').onclick = api.showScene;
  $('compactColor').oninput = () => { if (!target) return; api.color(target, $('compactColor').value); sync(); };
  for (const id of ['compactOffsetU', 'compactOffsetV', 'compactAngle']) $(id).addEventListener(id === 'compactAngle' ? 'input' : 'change', () => {
    if (!target) return;
    try { api.transform(target, { offset: [Number($('compactOffsetU').value), Number($('compactOffsetV').value)], angle: Number($('compactAngle').value) }); }
    catch (error) { api.notify(error.message); }
    sync();
  });
  $('dockUndo').onclick = api.undo;
  const dialog = $('assetPicker');
  const pickerCategory = $('pickerCategory');
  const pickerCategoryMenu = $('pickerCategoryMenu');
  const pickerCategoryOptions = [...pickerCategoryMenu.querySelectorAll('[data-picker-category]')];
  const pickerSelected = new Map(), pickerConfirm = $('confirmAssetPicker');
  const pickerCount = pickerConfirm.querySelector('.picker-confirm-count');
  let pickerAdding = false, pickerCategoryValue = 'all';
  const pickerGrid = $('pickerGrid'), pickerScrollbar = $('pickerScrollbar');
  let pickerAssetsLoading = false;
  const pickerLoading = createAssetLoading({ host: dialog, grid: pickerGrid, indicator: $('pickerLoading'), onChange: syncPickerSelection });
  const pickerThumb = pickerScrollbar.querySelector('.picker-scrollbar-thumb');
  function syncPickerScrollbar() {
    const trackHeight = pickerScrollbar.clientHeight;
    if (!trackHeight) return;
    const maxScroll = Math.max(0, pickerGrid.scrollHeight - pickerGrid.clientHeight);
    const thumbHeight = maxScroll <= 1 ? trackHeight : Math.min(trackHeight, Math.max(72, Math.round(trackHeight * pickerGrid.clientHeight / pickerGrid.scrollHeight)));
    const travel = Math.max(0, trackHeight - thumbHeight);
    pickerThumb.style.height = `${thumbHeight}px`;
    pickerThumb.style.transform = `translateY(${maxScroll <= 1 ? 0 : Math.round(travel * pickerGrid.scrollTop / maxScroll)}px)`;
  }
  let pickerDrag = null;
  pickerScrollbar.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (event.target === pickerThumb) {
      pickerDrag = { pointerId: event.pointerId, startY: event.clientY, startScroll: pickerGrid.scrollTop };
      pickerThumb.setPointerCapture(event.pointerId);
    } else {
      const track = pickerScrollbar.getBoundingClientRect(), travel = Math.max(1, track.height - pickerThumb.offsetHeight);
      const offset = Math.max(0, Math.min(travel, event.clientY - track.top - pickerThumb.offsetHeight / 2));
      pickerGrid.scrollTop = Math.max(0, pickerGrid.scrollHeight - pickerGrid.clientHeight) * offset / travel;
    }
    syncPickerScrollbar();
  });
  pickerScrollbar.addEventListener('pointermove', event => {
    if (!pickerDrag || pickerDrag.pointerId !== event.pointerId) return;
    const travel = Math.max(1, pickerScrollbar.clientHeight - pickerThumb.offsetHeight);
    const maxScroll = Math.max(0, pickerGrid.scrollHeight - pickerGrid.clientHeight);
    pickerGrid.scrollTop = pickerDrag.startScroll + (event.clientY - pickerDrag.startY) * maxScroll / travel;
    syncPickerScrollbar();
  });
  const finishPickerDrag = () => { pickerDrag = null; };
  pickerScrollbar.addEventListener('pointerup', finishPickerDrag);
  pickerScrollbar.addEventListener('pointercancel', finishPickerDrag);
  pickerScrollbar.addEventListener('lostpointercapture', finishPickerDrag);
  pickerScrollbar.addEventListener('wheel', event => {
    event.preventDefault(); pickerGrid.scrollTop += event.deltaY; syncPickerScrollbar();
  }, { passive: false });
  pickerGrid.addEventListener('scroll', syncPickerScrollbar, { passive: true });
  new ResizeObserver(syncPickerScrollbar).observe(pickerGrid);
  new MutationObserver(syncPickerScrollbar).observe(pickerGrid, { childList: true });
  const pickerLibrary = asset => asset.kind === 'folder' ? asset.library || 'fabric' : materialType(asset);
  const pickerFolder = id => assets.find(asset => asset.id === id && asset.kind === 'folder');
  function closePickerCategory(restoreFocus = false) {
    pickerCategoryMenu.hidden = true;
    pickerCategory.setAttribute('aria-expanded', 'false');
    if (restoreFocus && !pickerCategory.disabled) pickerCategory.focus();
  }
  function openPickerCategory(focusEdge = null) {
    if (pickerAdding) return;
    pickerCategoryMenu.hidden = false;
    pickerCategory.setAttribute('aria-expanded', 'true');
    const option = focusEdge === 'first' ? pickerCategoryOptions[0] : focusEdge === 'last' ? pickerCategoryOptions.at(-1) : pickerCategoryOptions.find(option => option.dataset.pickerCategory === pickerCategoryValue);
    option?.focus();
  }
  function syncPickerCategory() {
    const library = type === 'fabric' ? '面料库' : '图案库';
    const label = pickerCategoryValue === 'all' ? '全部' : pickerCategoryValue;
    $('pickerCategoryLabel').textContent = label;
    const path = [], seen = new Set();
    let folder = pickerFolder(pickerFolderId);
    while (folder && !seen.has(folder.id)) { seen.add(folder.id); path.unshift(folder.name); folder = pickerFolder(folder.parentId); }
    pickerCategory.title = [library, ...path].join(' / ') + '；当前分类：' + label;
    pickerCategory.setAttribute('aria-label', '筛选材质分类，当前：' + label);
    for (const option of pickerCategoryOptions) option.setAttribute('aria-checked', String(option.dataset.pickerCategory === pickerCategoryValue));
  }
  function syncPickerSelection() {
    for (const card of pickerGrid.querySelectorAll('.picker-card')) {
      card.disabled = pickerAdding;
      if (card.classList.contains('picker-folder')) continue;
      const selected = pickerSelected.has(card.dataset.assetId);
      card.classList.toggle('picker-selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    }
    const count = pickerSelected.size;
    pickerCount.textContent = count ? String(count) : '';
    pickerConfirm.classList.toggle('picker-has-selection', count > 0);
    pickerConfirm.style.setProperty('--picker-confirm-width', `${34 + (count ? Math.max(24, String(count).length * 9 + 12) : 0)}px`);
    pickerConfirm.disabled = pickerAdding || pickerLoading.loading || count === 0;
    const label = pickerAdding ? '正在添加材质' : count ? `添加已选的 ${count} 个材质` : '请先选择材质';
    pickerConfirm.title = label; pickerConfirm.setAttribute('aria-label', label);
    dialog.setAttribute('aria-busy', String(pickerAdding || pickerLoading.loading));
    $('pickerBack').disabled = pickerAdding || pickerFolderId === null;
    $('closeAssetPicker').disabled = pickerAdding;
    pickerCategory.disabled = pickerAdding;
    for (const option of pickerCategoryOptions) option.disabled = pickerAdding;
    $('pickerSearch').disabled = pickerAdding;
    dialog.querySelector('.picker-search button').disabled = pickerAdding;
  }
  function navigatePicker(folderId) {
    closePickerCategory();
    pickerFolderId = folderId;
    $('pickerSearch').value = '';
    renderPicker();
    $('pickerGrid').scrollTop = 0;
  }
  function release() { urls.forEach(url => URL.revokeObjectURL(url)); urls = []; }
  function renderPicker() {
    const loadingToken = pickerLoading.begin();
    release(); const grid = $('pickerGrid'); grid.replaceChildren();
    const query = $('pickerSearch').value.trim().toLocaleLowerCase();
    if (pickerFolderId && !pickerFolder(pickerFolderId)) pickerFolderId = null;
    syncPickerCategory();
    $('pickerBack').disabled = pickerFolderId === null;
    $('pickerBack').title = pickerFolderId === null ? '已在根目录' : '返回上一层文件夹';
    const shown = assets.filter(asset => pickerLibrary(asset) === type && (asset.parentId || null) === pickerFolderId && asset.name.toLocaleLowerCase().includes(query)
      && (asset.kind === 'folder' || pickerCategoryValue === 'all' || (asset.category || '其他') === pickerCategoryValue));
    for (const asset of shown) {
      const isFolder = asset.kind === 'folder';
      const card = document.createElement('button'); card.type = 'button'; card.className = 'picker-card' + (isFolder ? ' picker-folder' : ''); card.dataset.assetId = asset.id;
      if (isFolder) card.setAttribute('aria-label', '打开文件夹：' + asset.name);
      else if (pickerSelected.has(asset.id)) pickerSelected.set(asset.id, asset);
      const art = document.createElement('div'); art.className = 'picker-preview';
      if (isFolder) {
        const icon = document.createElement('span'); icon.className = 'picker-folder-icon'; icon.setAttribute('aria-hidden', 'true'); art.append(icon);
      }
      else if (asset.preview) { const img = document.createElement('img'); img.alt = ''; img.src = assetImageUrl(asset.preview); fitMaterialPreview(img, asset.previewInfo); art.style.position = 'relative'; urls.push(img.src); art.append(img); }
      else { const empty = document.createElement('span'); empty.className = 'picker-preview-empty'; empty.textContent = '无预览图'; art.append(empty); }
      const info = document.createElement('div'); info.className = 'picker-card-info';
      const name = document.createElement('span'); name.className = 'picker-card-name'; name.textContent = asset.name; name.title = asset.name;
      info.append(name); card.append(art, info); grid.append(card);
      card.addEventListener('pointerleave', () => card.classList.remove('picker-clicked'));
      card.onclick = () => {
        if (pickerAdding) return;
        if (isFolder) { navigatePicker(asset.id); return; }
        card.classList.remove('picker-clicked');
        void card.offsetWidth;
        card.classList.add('picker-clicked');
        if (pickerSelected.has(asset.id)) pickerSelected.delete(asset.id); else pickerSelected.set(asset.id, asset);
        syncPickerSelection();
      };
    }
    syncPickerSelection();
    if (!pickerAssetsLoading) void pickerLoading.finish(loadingToken);
  }
  async function refresh() {
    const token = ++request; assets = []; release(); $('pickerGrid').replaceChildren();
    pickerAssetsLoading = true; pickerLoading.begin();
    const show = items => { if (token !== request || !dialog.open) return; assets = items.filter(a => a.kind === 'material' || a.kind === 'folder').sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || b.updatedAt - a.updatedAt); renderPicker(); };
    try {
      const result = await listAssets();
      if (token !== request || !dialog.open) return;
      pickerAssetsLoading = false; show(result);
    }
    catch (error) {
      if (token !== request || !dialog.open) return;
      pickerAssetsLoading = false; renderPicker(); api.notify('无法读取材质库：' + error.message);
    }
  }
  $('addDockAsset').onclick = () => { api.cancelPlacement(); pickerSelected.clear(); pickerFolderId = null; pickerCategoryValue = 'all'; closePickerCategory(); $('pickerBack').title = '已在根目录'; $('pickerSearch').value = ''; syncPickerCategory(); syncPickerSelection(); dialog.showModal(); refresh(); };
  $('pickerBack').onclick = () => { if (!pickerAdding && pickerFolderId !== null) navigatePicker(pickerFolder(pickerFolderId)?.parentId || null); };
  pickerCategory.onclick = () => {
    if (pickerAdding) return;
    pickerCategory.classList.remove('picker-category-clicked');
    void pickerCategory.offsetWidth;
    pickerCategory.classList.add('picker-category-clicked');
    if (pickerCategoryMenu.hidden) openPickerCategory(); else closePickerCategory(true);
  };
  pickerCategory.addEventListener('animationend', event => { if (event.animationName === 'picker-category-click') pickerCategory.classList.remove('picker-category-clicked'); });
  pickerCategory.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    openPickerCategory(event.key === 'ArrowUp' || event.key === 'End' ? 'last' : 'first');
  });
  for (const option of pickerCategoryOptions) option.onclick = () => {
    if (pickerAdding) return;
    pickerCategoryValue = option.dataset.pickerCategory;
    closePickerCategory(true);
    renderPicker(); pickerGrid.scrollTop = 0;
  };
  pickerCategoryMenu.addEventListener('keydown', event => {
    if (event.key === 'Tab') { closePickerCategory(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = pickerCategoryOptions.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? pickerCategoryOptions.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + pickerCategoryOptions.length) % pickerCategoryOptions.length;
    pickerCategoryOptions[next].focus();
  });
  dialog.addEventListener('pointerdown', event => { if (!pickerCategoryMenu.hidden && !pickerCategory.closest('.picker-category-shell').contains(event.target)) closePickerCategory(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !pickerCategoryMenu.hidden) { event.preventDefault(); event.stopPropagation(); closePickerCategory(true); }
  });
  pickerConfirm.onclick = async () => {
    if (pickerAdding || pickerLoading.loading || !pickerSelected.size) return;
    closePickerCategory(); pickerAdding = true; syncPickerSelection();
    try {
      for (const [id, asset] of [...pickerSelected]) {
        const full = await getAsset(id, { runtime: true }); if (!full) throw new Error('资产已被删除');
        await api.add(full);
        pickerSelected.delete(id);
      }
      dialog.close();
    } catch (error) { api.notify('添加失败：' + error.message); }
    finally { pickerAdding = false; syncPickerSelection(); }
  };
  $('closeAssetPicker').onclick = () => { if (!pickerAdding) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (pickerAdding) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    // A queued close event can arrive after the user has reopened the picker.
    if (dialog.open) return;
    request++; pickerAssetsLoading = false; pickerLoading.cancel(); closePickerCategory(); pickerSelected.clear(); syncPickerSelection(); release(); finishPickerDrag();
  });
  dialog.addEventListener('click', event => { if (!pickerAdding && event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  $('pickerSearch').oninput = renderPicker;
  new MutationObserver(() => { const disabled = $('undoMaterial').disabled; $('dockUndo').disabled = disabled; $('headerUndo').disabled = disabled; }).observe($('undoMaterial'), { attributes: true, attributeFilter: ['disabled'] });
  setType('fabric');
  return { select, sync, setType, syncDock, bindDockItem, exitRemoval, get removing() { return removing; } };
}
