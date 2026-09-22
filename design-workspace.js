import { listAssets } from './shared/asset-store.js';
import { materialType } from './shared/material-placement.js';

const $ = id => document.getElementById(id);
export function createDesignWorkspace(api) {
  let type = 'fabric', target = null, assets = [], urls = [], request = 0;
  const addButton = $('addDockAsset'), previous = $('scrollLeft'), nextPage = $('scrollRight');
  const activeList = () => $(type === 'fabric' ? 'materialList' : 'patternDock');
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
    schedulePaging();
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
  let pagingFrame = 0;
  function updatePaging() {
    pagingFrame = 0;
    const list = activeList(), max = list.scrollWidth - list.clientWidth;
    previous.hidden = max <= 1 || list.scrollLeft <= 1;
    nextPage.hidden = max <= 1 || list.scrollLeft >= max - 1;
  }
  function schedulePaging() { if (!pagingFrame) pagingFrame = requestAnimationFrame(updatePaging); }
  function syncDock() {
    const list = activeList();
    if (list.lastElementChild !== addButton) list.append(addButton);
    list.parentElement.append(previous, nextPage);
    addButton.dataset.type = type;
    const label = type === 'fabric' ? '面料' : '图案';
    addButton.setAttribute('aria-label', '从资产库新增' + label); addButton.title = '新增' + label;
    previous.setAttribute('aria-label', '上一页' + label); nextPage.setAttribute('aria-label', '下一页' + label);
    previous.setAttribute('aria-controls', list.id); nextPage.setAttribute('aria-controls', list.id);
    syncRemoval();
  }
  function page(direction) {
    const list = activeList(), first = list.firstElementChild, second = first?.nextElementSibling;
    const stride = second ? second.offsetLeft - first.offsetLeft : first?.offsetWidth || 100;
    const amount = Math.max(1, Math.floor(list.clientWidth / stride)) * stride;
    list.scrollBy({ left: direction * amount, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  previous.onclick = () => page(-1); nextPage.onclick = () => page(1);
  const resizeDock = new ResizeObserver(schedulePaging);
  for (const list of [$('materialList'), $('patternDock')]) { resizeDock.observe(list); list.addEventListener('scroll', schedulePaging, { passive: true }); }
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
    if (next !== type) checked.clear();
    type = next;
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
  function release() { urls.forEach(url => URL.revokeObjectURL(url)); urls = []; }
  function renderPicker() {
    release(); const grid = $('pickerGrid'); grid.replaceChildren();
    const query = $('pickerSearch').value.trim().toLocaleLowerCase();
    const shown = assets.filter(asset => materialType(asset) === type && asset.name.toLocaleLowerCase().includes(query));
    $('pickerStatus').textContent = shown.length ? `${shown.length} 个${type === 'fabric' ? '面料' : '图案'}` : '暂无匹配材质，请在材质编辑器中创建并保存到资产库。';
    for (const asset of shown) {
      const card = document.createElement('button'); card.className = 'picker-card'; card.dataset.assetId = asset.id;
      const art = document.createElement('div'); art.className = 'picker-preview';
      if (asset.maps?.map) { const img = document.createElement('img'); img.alt = ''; img.src = URL.createObjectURL(asset.maps.map); urls.push(img.src); art.append(img); }
      else if (/^#[\da-f]{6}$/i.test(asset.surface?.color)) art.style.background = asset.surface.color;
      const name = document.createElement('strong'); name.textContent = asset.name;
      const hint = document.createElement('small'); hint.textContent = type === 'fabric' ? '平铺面料 · 点击添加' : '单张图案 · 点击添加';
      card.append(art, name, hint); grid.append(card);
      card.onclick = async () => {
        grid.querySelectorAll('button').forEach(button => button.disabled = true);
        try { await api.add(asset); dialog.close(); }
        catch (error) { $('pickerStatus').textContent = error.message; grid.querySelectorAll('button').forEach(button => button.disabled = false); }
      };
    }
  }
  async function refresh() {
    const token = ++request; assets = []; release(); $('pickerGrid').replaceChildren(); $('pickerStatus').textContent = '正在读取资产库…';
    const show = items => { if (token !== request || !dialog.open) return; assets = items.filter(a => a.kind === 'material').sort((a, b) => b.updatedAt - a.updatedAt); renderPicker(); };
    try {
      await listAssets({ onProgress: (items, progress) => {
        if (token !== request || !dialog.open) return;
        show(items);
        if (progress.message) $('pickerStatus').textContent = progress.message;
      } });
    }
    catch (error) { if (token === request) $('pickerStatus').textContent = '无法读取资产库：' + error.message; }
  }
  $('addDockAsset').onclick = () => { api.cancelPlacement(); $('assetPickerTitle').textContent = '新增' + (type === 'fabric' ? '面料' : '图案'); $('assetPickerDescription').textContent = type === 'fabric' ? '选择库中面料，添加到底栏后拖放到模型。' : '选择库中图案，添加到底栏后拖到模型表面，不会重复平铺。'; $('pickerSearch').value = ''; dialog.showModal(); refresh(); };
  $('closeAssetPicker').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { request++; release(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  $('pickerSearch').oninput = renderPicker; $('pickerRefresh').onclick = refresh;
  window.addEventListener('focus', () => { if (dialog.open) refresh(); });
  new MutationObserver(() => { $('dockUndo').disabled = $('undoMaterial').disabled; }).observe($('undoMaterial'), { attributes: true, attributeFilter: ['disabled'] });
  setType('fabric');
  return { select, sync, setType, syncDock, bindDockItem, exitRemoval, get removing() { return removing; } };
}
