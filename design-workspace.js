import { listAssets, getAsset } from './shared/asset-store.js';
import { materialType } from './shared/material-placement.js';
import { createAssetLoading } from './shared/asset-loading.js';
import { fitMaterialPreview, assetImageUrl } from './shared/material-preview.js';
import { groupFabricCards } from './shared/fabric-card-groups.js';
import { mountPickerFabricColors } from './shared/picker-fabric-colors.js';
import { renderFabricColorList } from './shared/fabric-color-swatch.js';
import './shared/procedural-color-picker.js';

const $ = id => document.getElementById(id);
export function createDesignWorkspace(api) {
  let type = 'fabric', target = null, assets = [], urls = [], request = 0, pickerFolderId = null;
  const addButton = $('addDockAsset');
  const activeList = () => $(type === 'fabric' ? 'materialList' : 'patternDock');
  const activeScrollbar = () => $(type === 'fabric' ? 'fabricScrollbar' : 'patternScrollbar');
  const scrollbarThumb = scrollbar => scrollbar?.querySelector('.dock-scrollbar-thumb');
  let removing = false;
  const checked = new Map(), dockItems = new WeakMap(), dock = document.querySelector('.material-dock');
  const deleteZone = $('dockDeleteZone');
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
    $('scanFabric').hidden = removing;
    $('dockTrash').hidden = removing; $('dockDeleteActions').hidden = !removing;
    $('dockDeleteActions').inert = !removing;
    const deleteSelected = $('dockDeleteSelected');
    deleteSelected.disabled = checked.size === 0;
    deleteSelected.setAttribute('aria-label', checked.size ? `确定删除所选材质或图案，共 ${checked.size} 项` : '确定删除所选材质或图案');
    deleteSelected.title = checked.size ? `确定删除所选项（${checked.size}）` : '确定删除所选项';
    $('dockDeleteCount').hidden = checked.size === 0;
    $('dockDeleteCount').textContent = checked.size ? String(checked.size) : '';
    dock.classList.toggle('removal-mode', removing);
  }
  function exitRemoval() {
    const restoreFocus = removing && $('dockDeleteActions').contains(document.activeElement);
    removing = false; checked.clear(); syncRemoval();
    if (restoreFocus) $('dockTrash').focus({ preventScroll: true });
  }
  function bindDockItem(button, item) {
    const record = dockItems.get(button);
    if (record) {
      record.pressed = button.getAttribute('aria-pressed');
      record.label = button.getAttribute('aria-label');
      return;
    }
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
  const startRemoval = () => {
    if (removing) return;
    api.prepareRemoval(); removing = true; checked.clear(); syncRemoval();
    $('dockCancelDelete').focus({ preventScroll: true });
  };
  $('dockTrash').onclick = startRemoval;
  deleteZone?.addEventListener('click', event => { if (!event.target.closest('#dockDeleteActions')) startRemoval(); });
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
    for (const [listId, emptyId] of [['materialList', 'fabricDockEmpty'], ['patternDock', 'patternDockEmpty']]) {
      const empty = $(emptyId);
      if (empty) empty.hidden = !!$(listId).querySelector('.material-item');
    }
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
  panel.innerHTML = `<div class="compact-preview"><div id="compactSwatch"></div><div id="compactFabricColors" class="compact-fabric-colors" role="group" aria-label="全部面料色号" hidden></div></div>
    <label class="color-row compact-base-color">基础颜色<input id="compactColor" type="color" aria-label="基础颜色"></label>
    <div class="section-heading"><h2>平铺调整</h2></div><div class="uv-row compact-placement-row"><label>U<input id="compactOffsetU" type="number" step="0.01" min="-100" max="100" value="0"></label><label>V<input id="compactOffsetV" type="number" step="0.01" min="-100" max="100" value="0"></label><label>R<input id="compactAngle" type="number" min="-180" max="180" step="1" value="0" aria-label="R 旋转角度（度）" title="旋转角度（度）"></label></div>
    <details id="compactPbr" class="compact-pbr"><summary>PBR 强度</summary><div id="compactPbrControls" class="compact-pbr-controls"></div></details>`;
  panel.querySelector('.compact-preview').insertAdjacentHTML('afterend', '<section id="compactProcedural" class="compact-procedural" hidden><div class="section-heading"><h2>BMP 色号映射</h2></div><div id="compactProceduralPalette" class="compact-procedural-palette"></div><div id="compactProceduralColorEditor"></div></section>');
  const compactPbrFields = [
    ['roughness', '粗糙度', 0, 1, .01], ['metalness', '金属度', 0, 1, .01],
    ['normalStrength', '法线强度', 0, 3, .05], ['aoStrength', 'AO 强度', 0, 3, .05],
    ['sheen', '侧面光强度', 0, 2, .01], ['sheenRoughness', '绒毛柔和度', 0, 1, .01]
  ];
  const compactPbrControls = $('compactPbrControls');
  for (const [key, title, min, max, step] of compactPbrFields) {
    const row = document.createElement('label'); row.className = 'compact-pbr-row'; row.htmlFor = 'compactPbr-' + key;
    const heading = document.createElement('span'); heading.textContent = title;
    const input = document.createElement('input'); Object.assign(input, { type: 'number', id: 'compactPbr-' + key, min, max, step }); input.setAttribute('aria-label', title);
    input.addEventListener('input', () => {
      if (!target || target.kind !== 'fabric') return;
      const value = input.valueAsNumber;
      if (Number.isFinite(value) && value >= min && value <= max) api.pbr?.(target, { [key]: value });
    });
    input.addEventListener('change', () => {
      if (!target || target.kind !== 'fabric') return;
      const value = input.valueAsNumber;
      if (!Number.isFinite(value) || value < min || value > max) api.notify?.(title + '范围为 ' + min + '–' + max);
      sync();
    });
    row.append(heading, input); compactPbrControls.append(row);
  }
  const proceduralColorEditor = panel.querySelector('#compactProceduralColorEditor');
  const proceduralPicker = globalThis.ProceduralColorPicker.mount(proceduralColorEditor, {
    prefix: 'compactProcedural',
    onConfirm: color => confirmProceduralColor(color),
    onCancel: () => closeProceduralColorEditor()
  });
  let proceduralColorTarget = null, proceduralColorIndex = null, proceduralColorSession = 0, proceduralColorUpdating = false;
  let proceduralColorWipe = null;
  const canEditProceduralColor = currentTarget => !!currentTarget && api.read(currentTarget).proceduralColorEnabled === true;
  const proceduralPaletteColor = entry => /^#[\da-f]{6}$/i.test(entry.loopHex || '') ? entry.loopHex.toUpperCase() : (entry.sourceHex || '#ffffff').toUpperCase();
  const proceduralWipeSwatch = wipe => target && itemKey(target) === wipe.key ? $('compactProceduralPalette').querySelector(`[data-color-index="${wipe.index}"]`) : null;
  const paintProceduralColorWipe = wipe => {
    const swatch = proceduralWipeSwatch(wipe);
    if (!swatch) return;
    const angle = (wipe.progress * 360).toFixed(2);
    swatch.style.backgroundColor = wipe.oldColor;
    swatch.style.backgroundImage = wipe.reducedMotion ? '' : `conic-gradient(from 0deg, ${wipe.color} 0deg ${angle}deg, ${wipe.oldColor} ${angle}deg 360deg)`;
    swatch.setAttribute('aria-busy', 'true');
  };
  const clearProceduralColorWipe = (wipe, success) => {
    cancelAnimationFrame(wipe.frame);
    const swatch = proceduralWipeSwatch(wipe);
    if (swatch) { swatch.style.backgroundImage = ''; swatch.style.backgroundColor = success ? wipe.color : wipe.oldColor; swatch.removeAttribute('aria-busy'); }
    if (proceduralColorWipe === wipe) proceduralColorWipe = null;
    wipe.resolve();
  };
  const animateProceduralColorWipe = now => {
    const wipe = proceduralColorWipe;
    if (!wipe) return;
    // Reserve the last sector until the regenerated material has been applied.
    wipe.progress = wipe.completedAt === null ? Math.min(.9, (now - wipe.started) / 650)
      : Math.min(1, wipe.completedFrom + (1 - wipe.completedFrom) * (now - wipe.completedAt) / wipe.finishDuration);
    if (wipe.progress >= 1) { clearProceduralColorWipe(wipe, true); return; }
    paintProceduralColorWipe(wipe);
    wipe.frame = wipe.completedAt !== null || wipe.progress < .9 ? requestAnimationFrame(animateProceduralColorWipe) : 0;
  };
  const startProceduralColorWipe = (currentTarget, index, color) => {
    const entry = api.read(currentTarget).proceduralMapping?.palette?.find(entry => Number(entry.index) === index);
    if (!entry) return null;
    const oldColor = proceduralPaletteColor(entry);
    if (oldColor === color) return null;
    const wipe = { key: itemKey(currentTarget), index, oldColor, color, progress: 0, frame: 0, started: performance.now(), completedAt: null, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
    wipe.done = new Promise(resolve => { wipe.resolve = resolve; });
    proceduralColorWipe = wipe; paintProceduralColorWipe(wipe);
    if (!wipe.reducedMotion) wipe.frame = requestAnimationFrame(animateProceduralColorWipe);
    return wipe;
  };
  const finishProceduralColorWipe = (wipe, success) => {
    if (!wipe) return;
    if (!success || wipe.reducedMotion) clearProceduralColorWipe(wipe, success);
    else {
      wipe.completedAt = performance.now(); wipe.completedFrom = wipe.progress; wipe.finishDuration = Math.max(160, (1 - wipe.progress) * 650);
      cancelAnimationFrame(wipe.frame); wipe.frame = requestAnimationFrame(animateProceduralColorWipe);
    }
    return wipe.done;
  };
  const syncProceduralColorSelection = () => {
    for (const swatch of $('compactProceduralPalette').querySelectorAll('button')) swatch.setAttribute('aria-expanded', String(!!proceduralColorTarget && Number(swatch.dataset.colorIndex) === proceduralColorIndex));
  };
  const syncProceduralColorEditorState = () => {
    proceduralPicker.setDisabled(proceduralColorUpdating);
  };
  const closeProceduralColorEditor = () => {
    proceduralColorSession++; proceduralColorTarget = null; proceduralColorIndex = null;
    proceduralPicker.clear();
    syncProceduralColorEditorState(); syncProceduralColorSelection();
  };
  const confirmProceduralColor = async color => {
    if (proceduralColorUpdating || !proceduralColorTarget || proceduralColorIndex === null) return;
    if (!canEditProceduralColor(proceduralColorTarget)) { closeProceduralColorEditor(); return; }
    const currentTarget = proceduralColorTarget, index = proceduralColorIndex, session = proceduralColorSession;
    proceduralColorUpdating = true; syncProceduralColorEditorState();
    let wipe = null;
    try {
      wipe = startProceduralColorWipe(currentTarget, index, color);
      await api.proceduralColor(currentTarget, index, color);
      await finishProceduralColorWipe(wipe, true);
      if (session === proceduralColorSession) closeProceduralColorEditor();
    }
    catch (error) { finishProceduralColorWipe(wipe, false); api.notify('BMP 色号更新失败：' + error.message); }
    finally { proceduralColorUpdating = false; syncProceduralColorEditorState(); }
  };
  const openProceduralColorEditor = (currentTarget, index, color) => {
    if (proceduralColorUpdating) return;
    if (!canEditProceduralColor(currentTarget)) { closeProceduralColorEditor(); return; }
    if (proceduralColorTarget && itemKey(proceduralColorTarget) === itemKey(currentTarget) && proceduralColorIndex === index) { closeProceduralColorEditor(); return; }
    proceduralColorSession++;
    proceduralColorTarget = currentTarget; proceduralColorIndex = index;
    syncProceduralColorEditorState();
    syncProceduralColorSelection();
    proceduralPicker.open(color);
  };
  function sync() {
    if (!target) return;
    const data = api.read(target);
    const currentTarget = target;
    const pbr = $('compactPbr');
    const pbrVisible = target.kind === 'fabric' && data.pbr && typeof data.pbr === 'object';
    pbr.hidden = !pbrVisible;
    if (!pbrVisible) pbr.open = false;
    if (pbrVisible) for (const [key] of compactPbrFields) {
      const value = Number(data.pbr[key]);
      if (!Number.isFinite(value)) continue;
      $('compactPbr-' + key).value = value.toFixed(2);
    }
    renderFabricColorList($('compactFabricColors'), data.fabricColorCodes || [], {
      active: data.fabricColorCode, pending: data.fabricColorPending || data.fabricColorCompleted, progress: data.fabricColorProgress,
      onSelect: data.fabricVariants?.length ? code => api.switchFabricColor(currentTarget, code) : null,
    });
    const mapping = data.proceduralMapping;
    const procedural = $('compactProcedural'), paletteHost = $('compactProceduralPalette');
    procedural.hidden = !(mapping?.palette?.length);
    $('compactColor').closest('.compact-base-color').hidden = !!mapping;
    if (procedural.hidden || !data.proceduralColorEnabled || (proceduralColorTarget && (itemKey(proceduralColorTarget) !== itemKey(currentTarget) || !mapping.palette.some(entry => Number(entry.index) === proceduralColorIndex)))) closeProceduralColorEditor();
    if (procedural.hidden) paletteHost.replaceChildren();
    else {
      paletteHost.replaceChildren();
      for (const entry of mapping.palette) {
        const row = document.createElement('div'); row.className = 'compact-procedural-row';
        const color = proceduralPaletteColor(entry);
        const swatch = document.createElement('button'); swatch.type = 'button'; swatch.className = 'compact-procedural-swatch'; swatch.style.backgroundColor = color; swatch.setAttribute('aria-label', 'BMP 色号 ' + entry.index + ' 颜色'); swatch.title = '编辑色号 ' + entry.index + ' 颜色';
        swatch.dataset.colorIndex = String(entry.index); swatch.setAttribute('aria-controls', 'compactProceduralColorEditor');
        swatch.disabled = !data.proceduralColorEnabled;
        if (swatch.disabled) swatch.title = '应用到模型后可编辑色号 ' + entry.index + ' 颜色';
        swatch.onclick = () => openProceduralColorEditor(currentTarget, Number(entry.index), color);
        row.append(swatch); paletteHost.append(row);
      }
      syncProceduralColorSelection();
      if (proceduralColorWipe) paintProceduralColorWipe(proceduralColorWipe);
    }
    $('compactColor').value = data.color;
    $('compactOffsetU').value = data.offset[0]; $('compactOffsetV').value = data.offset[1];
    $('compactAngle').value = data.angle;
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
  $('compactColor').oninput = () => { if (!target) return; api.color(target, $('compactColor').value); sync(); };
  for (const id of ['compactOffsetU', 'compactOffsetV', 'compactAngle']) $(id).addEventListener('change', () => {
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
  let pickerColorCleanups = [];
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
      card.inert = pickerAdding;
      card.setAttribute('aria-disabled', String(pickerAdding));
      const select = card.querySelector('.picker-card-select');
      select.disabled = pickerAdding;
      if (card.classList.contains('picker-folder')) continue;
      const selected = pickerSelected.has(card.dataset.assetId);
      card.classList.toggle('picker-selected', selected);
      select.setAttribute('aria-pressed', String(selected));
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
  function release() { pickerColorCleanups.forEach(cleanup => cleanup()); pickerColorCleanups = []; urls.forEach(url => URL.revokeObjectURL(url)); urls = []; }
  function renderPicker() {
    const loadingToken = pickerLoading.begin();
    release(); const grid = $('pickerGrid'); grid.replaceChildren();
    const query = $('pickerSearch').value.trim().toLocaleLowerCase();
    if (pickerFolderId && !pickerFolder(pickerFolderId)) pickerFolderId = null;
    syncPickerCategory();
    $('pickerBack').disabled = pickerFolderId === null;
    $('pickerBack').title = pickerFolderId === null ? '已在根目录' : '返回上一层文件夹';
    const collection = assets.filter(asset => pickerLibrary(asset) === type && (asset.parentId || null) === pickerFolderId);
    const shown = (type === 'fabric' ? groupFabricCards(collection) : collection).filter(asset => asset.name.toLocaleLowerCase().includes(query)
      && (asset.kind === 'folder' || pickerCategoryValue === 'all' || (asset.category || '其他') === pickerCategoryValue));
    for (const asset of shown) {
      const isFolder = asset.kind === 'folder';
      const card = document.createElement('div'); card.className = 'picker-card' + (isFolder ? ' picker-folder' : ''); card.dataset.assetId = asset.id;
      const select = document.createElement('button'); select.type = 'button'; select.className = 'picker-card-select';
      select.setAttribute('aria-label', (isFolder ? '打开文件夹：' : '选择材质：') + asset.name);
      if (!isFolder && pickerSelected.has(asset.id)) pickerSelected.set(asset.id, asset);
      const art = document.createElement('div'); art.className = 'picker-preview';
      if (isFolder) {
        const icon = document.createElement('span'); icon.className = 'picker-folder-icon'; icon.setAttribute('aria-hidden', 'true'); art.append(icon);
      }
      else if (asset.preview) { const img = document.createElement('img'); img.alt = ''; img.src = assetImageUrl(asset.preview); fitMaterialPreview(img, asset.previewInfo); art.style.position = 'relative'; urls.push(img.src); art.append(img); }
      else { const empty = document.createElement('span'); empty.className = 'picker-preview-empty'; empty.textContent = '无预览图'; art.append(empty); }
      if (asset.fabricVariants?.length) {
        const bar = document.createElement('div'); bar.className = 'picker-fabric-colors';
        art.append(bar);
      }
      const info = document.createElement('div'); info.className = 'picker-card-info';
      const nameRow = document.createElement('span'); nameRow.className = 'picker-card-name-row';
      const name = document.createElement('span'); name.className = 'picker-card-name'; name.textContent = asset.name; name.title = asset.name; nameRow.append(name);
      if (asset.proceduralMapping) {
        const badge = document.createElement('img'); badge.className = 'procedural-material-badge'; badge.src = './assets/procedural-material.svg'; badge.alt = '程序化材质'; badge.title = '程序化材质'; nameRow.append(badge);
        select.setAttribute('aria-label', '选择材质：' + asset.name + '，程序化材质');
      }
      info.append(nameRow); card.append(art, info, select); grid.append(card);
      const colors = art.querySelector('.picker-fabric-colors');
      if (colors) pickerColorCleanups.push(mountPickerFabricColors(colors, asset, () => pickerAdding));
      card.onclick = () => {
        if (pickerAdding) return;
        if (isFolder) { navigatePicker(asset.id); return; }
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
        const summary = await getAsset(id, { runtime: true, previewOnly: true }); if (!summary) throw new Error('资产已被删除');
        // Keep fabric additions lightweight. Their PBR files are fetched by the
        // design surface only after the material ball is dropped on a mesh.
        const full = summary.materialType === 'pattern' || summary.proceduralMapping ? await getAsset(id, { runtime: true }) : summary;
        await api.add({ ...full, fabricVariants: asset.fabricVariants?.map(({ id, fabricColorCode }) => ({ id, fabricColorCode })), fabricColorCodes: asset.fabricVariants?.map(variant => variant.fabricColorCode) || (full.fabricColorCode ? [full.fabricColorCode] : []) });
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
  const syncUndo = () => { const disabled = $('undoMaterial').disabled; $('dockUndo').disabled = disabled; if (api.syncHeaderUndo) api.syncHeaderUndo(); else $('headerUndo').disabled = disabled; };
  new MutationObserver(syncUndo).observe($('undoMaterial'), { attributes: true, attributeFilter: ['disabled'] });
  syncUndo();
  setType('fabric');
  return { select, sync, setType, syncDock, bindDockItem, exitRemoval, get removing() { return removing; } };
}
