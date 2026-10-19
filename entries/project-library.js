import { deleteProject, listProjects, moveProject, renameProject, saveProjectFolder, setProjectVisibility } from '../shared/project-store.js';
import { requireAuth, authState } from '../shared/auth.js';
import { createAssetLoading } from '../shared/asset-loading.js';
import { assetPage } from '../shared/asset-metadata.js';
import { mountToolSwitcher } from '../shared/navigation.js';

const $ = id => document.getElementById(id);
await requireAuth({ feature: 'projects' });
mountToolSwitcher('projects');
let projects = [], query = '', sort = 'recent';
let view = new URLSearchParams(location.search).get('view') === 'public' ? 'public' : 'personal';
let activeFolderId = null, openRenameId = null, movingProjectIds = [], openProjectMenu = null;
const selectedProjectIds = new Set();
let currentPage = 1, pageContext = '', currentPageItems = [], projectsLoading = true, refreshVersion = 0;
const projectLoading = createAssetLoading({ host: $('projectPanel'), grid: $('projectGrid'), indicator: $('projectLoading'), onChange: loading => { $('projectPagination').inert = loading; } });
const status = message => { $('status').textContent = message; };
const isFolder = item => item?.kind === 'folder';
const ownsProject = item => item.ownerId === authState()?.id;

function previewImage(item, folder = false) {
  const image = document.createElement('img');
  image.alt = folder ? '' : item.name; image.decoding = 'async'; image.loading = 'eager';
  image.onerror = () => {
    if (folder) image.style.visibility = 'hidden';
    else image.replaceWith(projectIcon());
  };
  image.src = item.thumbnailUrl;
  return image;
}
function projectIcon() {
  const wrapper = document.createElement('span'); wrapper.className = 'project-preview-fallback'; wrapper.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML = '<svg viewBox="0 0 48 48"><path d="M8 14a4 4 0 0 1 4-4h10l4 5h10a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V14Z"/><path d="M8 20h32M17 28h14M17 34h9"/></svg>';
  return wrapper;
}

function folderById(id) { return projects.find(item => isFolder(item) && item.id === id); }
function folderChildren(id) { return projects.filter(item => (item.parentId || null) === id && (item.visibility || 'personal') === view); }
function folderPreviewChildren(folder) { return folderChildren(folder.id).filter(item => !isFolder(item)).slice(0, 3); }
function folderContains(folderId, ancestorId) {
  let current = folderById(folderId), seen = new Set();
  while (current && !seen.has(current.id)) { if (current.id === ancestorId) return true; seen.add(current.id); current = folderById(current.parentId); }
  return false;
}
function folderLabel(folder) {
  const names = [], seen = new Set(); let current = folder;
  while (current && !seen.has(current.id)) { names.unshift(current.name); seen.add(current.id); current = folderById(current.parentId); }
  return names.join('>');
}
function closeProjectAddMenu() { const menu = $('projectAddMenu'), button = $('importProject'); if (!menu || !button) return; menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }
function closeProjectMoreMenu() { const menu = $('projectMoreMenu'), button = $('projectMoreOptions'); if (!menu || !button) return; menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }
function navigate(folderId) {
  if (folderId !== null && !folderById(folderId)) return;
  closeMenus(); closeProjectAddMenu(); closeProjectMoreMenu(); activeFolderId = folderId; query = ''; $('projectSearch').value = ''; selectedProjectIds.clear(); render();
}
function updateBreadcrumb() {
  const host = $('projectBreadcrumb'), back = $('projectLibraryBack'), atRoot = activeFolderId === null;
  host.replaceChildren(); back.classList.toggle('is-disabled', atRoot); back.setAttribute('aria-disabled', String(atRoot)); back.tabIndex = atRoot ? -1 : 0; back.title = atRoot ? '已在项目库根目录' : '返回上一级'; back.setAttribute('aria-label', back.title);
  back.onclick = event => { if (atRoot) { event.preventDefault(); return; } event.preventDefault(); navigate(folderById(activeFolderId)?.parentId || null); };
  const appendLink = (label, folderId, current = false) => { const link = document.createElement('button'); link.type = 'button'; link.className = 'breadcrumb-link'; link.textContent = label; if (current) link.setAttribute('aria-current', 'page'); link.onclick = () => navigate(folderId); host.append(link); };
  appendLink('项目库', null, atRoot);
  const path = [], seen = new Set(); let folder = folderById(activeFolderId);
  while (folder && !seen.has(folder.id)) { path.unshift(folder); seen.add(folder.id); folder = folderById(folder.parentId); }
  path.forEach((item, index) => { const separator = document.createElement('span'); separator.className = 'breadcrumb-separator'; separator.setAttribute('aria-hidden', 'true'); const icon = document.createElement('img'); icon.src = './assets/breadcrumb-separator.svg'; icon.alt = ''; icon.setAttribute('aria-hidden', 'true'); separator.append(icon); host.append(separator); appendLink(item.name, item.id, index === path.length - 1); });
}

function visibleProjects() {
  const needle = query.trim().toLocaleLowerCase();
  const result = projects.filter(item => (item.visibility || 'personal') === view && (item.parentId || null) === activeFolderId && (!needle || [item.name, item.modelName].some(value => String(value || '').toLocaleLowerCase().includes(needle))));
  return result.sort((a, b) => { const folderOrder = Number(isFolder(b)) - Number(isFolder(a)); if (folderOrder) return folderOrder; if (sort === 'oldest') return (a.updatedAt || 0) - (b.updatedAt || 0); if (sort === 'nameAsc') return a.name.localeCompare(b.name, 'zh-CN'); if (sort === 'nameDesc') return b.name.localeCompare(a.name, 'zh-CN'); return (b.updatedAt || 0) - (a.updatedAt || 0); });
}
function syncCardSelection(card, control, selected) { if (!control) return; card.classList.toggle('selected', selected); control.setAttribute('aria-pressed', String(selected)); control.setAttribute('aria-label', selected ? '取消选择' : '选择项目'); }
function createSelectionControl(item, card) {
  const control = document.createElement('button'); control.type = 'button'; control.className = 'asset-select-control'; control.setAttribute('aria-pressed', 'false'); control.setAttribute('aria-label', '选择项目');
  for (const type of ['pointerdown', 'pointerup', 'pointercancel']) control.addEventListener(type, event => event.stopPropagation());
  control.onclick = event => { event.preventDefault(); event.stopPropagation(); card.classList.remove('is-pressing', 'is-clicking'); const selected = !selectedProjectIds.has(item.id); if (selected) selectedProjectIds.add(item.id); else selectedProjectIds.delete(item.id); syncCardSelection(card, control, selected); };
  return control;
}

async function removeProjectTree(item) { for (const child of projects.filter(candidate => (candidate.parentId || null) === item.id)) await removeProjectTree(child); await deleteProject(item.id); }
function moveTargets(item) { return projects.filter(candidate => ownsProject(candidate) && isFolder(candidate) && (candidate.visibility || 'personal') === (item.visibility || 'personal') && candidate.id !== item.id && !folderContains(candidate.id, item.id)).sort((a, b) => folderLabel(a).localeCompare(folderLabel(b), 'zh-CN')); }
function openMoveDialog(itemOrItems) {
  const selection = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
  if (!selection.length) return;
  const select = $('projectMoveTarget'); select.replaceChildren(); const root = document.createElement('option'); root.value = ''; root.textContent = '项目库根目录'; select.append(root);
  const targets = moveTargets(selection[0]).filter(folder => selection.every(item => moveTargets(item).some(candidate => candidate.id === folder.id)));
  for (const folder of targets) { const option = document.createElement('option'); option.value = folder.id; option.textContent = folderLabel(folder); select.append(option); }
  movingProjectIds = selection.map(item => item.id); $('projectMoveTitle').textContent = selection.length === 1 ? '移动项目' : `移动 ${selection.length} 个项目`; $('projectMoveError').textContent = ''; select.value = selection.length === 1 ? selection[0].parentId || '' : ''; $('projectMoveDialog').showModal(); select.focus();
}

function selectedProjects() {
  return [...selectedProjectIds].map(id => projects.find(item => item.id === id)).filter(item => item && !isFolder(item));
}

async function moveSelectedProjects() {
  const selection = selectedProjects();
  if (!selection.length) { status('请先选择要移动的项目'); return; }
  if (selection.some(item => !ownsProject(item))) { status('只有项目所有者可以移动项目'); return; }
  openMoveDialog(selection);
}

async function deleteSelectedProjects() {
  const selection = selectedProjects();
  if (!selection.length) { status('请先选择要删除的项目'); return; }
  if (selection.some(item => !ownsProject(item))) { status('只有项目所有者可以删除项目'); return; }
  if (!window.confirm(`确定删除选中的 ${selection.length} 个项目？`)) return;
  closeProjectMoreMenu();
  let removed = 0;
  try {
    for (const item of selection) { await deleteProject(item.id); removed++; }
    selectedProjectIds.clear(); await refresh(); status(`已删除 ${removed} 个项目`);
  } catch (error) {
    selectedProjectIds.clear(); await refresh(); status(`已删除 ${removed}/${selection.length} 个项目。${error.message}`);
  }
}

function setupCardInteraction(card, item) {
  const openFolder = () => { if (!isFolder(item) || card.classList.contains('folder-opening')) return; card.classList.add('folder-opening'); navigate(item.id); };
  const openProject = () => { if (!isFolder(item)) location.href = './design.html?project=' + encodeURIComponent(item.id); };
  let pressPointerId = null;
  const isCardSurface = event => !event.target.closest('button,a') && (event.pointerType !== 'mouse' || event.button === 0);
  const releaseCard = event => { if (event.target && !isCardSurface(event)) return; if (pressPointerId !== null && event.pointerId !== pressPointerId) return; pressPointerId = null; card.classList.remove('is-pressing', 'is-clicking'); if (isFolder(item) && event.type === 'pointerup') { openFolder(); return; } void card.offsetWidth; card.classList.add('is-clicking'); setTimeout(() => card.classList.remove('is-clicking'), 320); };
  card.addEventListener('pointerdown', event => { if (!isCardSurface(event)) return; pressPointerId = event.pointerId; card.classList.remove('is-clicking'); card.classList.add('is-pressing'); card.setPointerCapture?.(event.pointerId); });
  card.addEventListener('pointerup', releaseCard); card.addEventListener('pointercancel', releaseCard); card.addEventListener('lostpointercapture', event => { if (pressPointerId !== null) releaseCard(event); });
  card.addEventListener('click', event => { const surface = isCardSurface(event); if (event.detail === 0 && surface) releaseCard({ pointerId: null }); if (surface) isFolder(item) ? openFolder() : openProject(); });
  card.onkeydown = event => { if (!['Enter', ' '].includes(event.key) || event.target.closest('button,a')) return; event.preventDefault(); isFolder(item) ? openFolder() : openProject(); };
}

function createProjectMenu(item, card) {
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = isFolder(item) ? 'asset-menu-trigger' : 'project-more'; trigger.setAttribute('aria-label', item.name + '：更多操作'); trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false'); trigger.title = '更多操作'; trigger.textContent = '⋯';
  const panel = document.createElement('div'); panel.className = 'project-menu'; panel.hidden = true; panel.setAttribute('role', 'menu'); panel.id = 'project-menu-' + item.id; trigger.setAttribute('aria-controls', panel.id);
  const action = (label, handler, className = '') => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; if (className) button.className = className; button.onclick = async () => { closeMenus(); button.disabled = true; try { await handler(); } catch (error) { status(error.message); } finally { button.disabled = false; } }; return button; };
  if (!ownsProject(item)) return [];
  const actions = [action('重命名', () => beginRename(item)), action('移动', () => openMoveDialog(item))];
  actions.push(action(item.visibility === 'public' ? '取消公开' : '公开', async () => { await setProjectVisibility(item.id, item.visibility !== 'public'); await refresh(); status(item.visibility === 'public' ? '已取消公开' : '已公开'); }));
  actions.push(action(isFolder(item) ? '删除文件夹' : '删除', async () => { if (!window.confirm(isFolder(item) ? `删除文件夹“${item.name}”及其中项目？` : `删除项目“${item.name}”？`)) return; await removeProjectTree(item); await refresh(); status(isFolder(item) ? '文件夹已删除' : '项目已删除'); }, 'project-delete'));
  panel.append(...actions); const items = [...panel.children]; items.forEach(element => { element.setAttribute('role', 'menuitem'); element.tabIndex = -1; });
  trigger.onclick = event => { event.stopPropagation(); const wasOpen = openProjectMenu?.trigger === trigger; closeMenus(); if (wasOpen) return; openProjectMenu = { trigger, panel, card }; panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); card.classList.add('menu-open'); items[0]?.focus(); };
  panel.onkeydown = event => { const index = items.indexOf(document.activeElement); if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); } if (event.key === 'Tab') closeMenus(true); };
  return [trigger, panel];
}
function closeMenus(restoreFocus = false) { if (!openProjectMenu) return; const { panel, trigger, card } = openProjectMenu; panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); card.classList.remove('menu-open'); if (restoreFocus) trigger.focus(); openProjectMenu = null; }

function appendFolderArt(folder, art) {
  art.classList.add('folder-art'); const previews = folderPreviewChildren(folder); art.classList.add(`folder-preview-count-${previews.length}`);
  for (const [index, child] of previews.entries()) { const hasPreview = child.thumbnailUrl, element = hasPreview ? previewImage(child, true) : document.createElement('div'); element.className = 'folder-preview-card'; element.setAttribute('aria-hidden', 'true'); element.style.setProperty('--folder-preview-x', `${index * -10}px`); element.style.setProperty('--folder-preview-y', `${index * 10}px`); element.style.setProperty('--folder-preview-z', String(3 - index)); if (!hasPreview) element.classList.add('folder-preview-swatch'); art.append(element); }
  const cover = document.createElement('div'); cover.className = 'folder-cover'; cover.setAttribute('aria-hidden', 'true'); art.append(cover);
}

function renderPagination(page) {
  const host = $('projectPagination'); host.replaceChildren(); host.hidden = !page.total;
  const change = next => {
    if (next === currentPage || next < 1 || next > page.totalPages) return;
    const direction = next > currentPage ? 'next' : 'previous';
    currentPage = next; render(); libraryScroll.scrollTop = 0; animateCardPage($('projectGrid'), direction);
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
  const loadingToken = projectLoading.begin();
  closeMenus(); updateBreadcrumb(); const grid = $('projectGrid'); grid.replaceChildren(); const collection = visibleProjects(); $('projectEmpty').hidden = collection.length > 0; grid.hidden = collection.length === 0;
  const context = JSON.stringify([view, activeFolderId, query, sort]);
  if (context !== pageContext) { currentPage = 1; pageContext = context; }
  const page = assetPage(collection, currentPage); currentPage = page.page; currentPageItems = page.items; renderPagination(page);
  const selectAllButton = $('selectAllProjects');
  if (selectAllButton) {
    const selectable = currentPageItems.filter(item => !isFolder(item));
    selectAllButton.textContent = selectable.length && selectable.every(item => selectedProjectIds.has(item.id)) ? '取消全选' : '全选';
  }
  if (!collection.length) { $('projectEmpty').querySelector('strong').textContent = query ? '没有匹配的项目' : (activeFolderId ? '文件夹暂无项目' : (projects.length ? '暂无当前范围的项目' : '暂无保存的项目')); $('projectEmpty').querySelector('span').textContent = activeFolderId ? '可以从项目卡片的更多菜单移动项目到这里。' : '在设计台点击保存，即可在这里继续工作。'; }
  for (const item of currentPageItems) {
    const folder = isFolder(item), card = document.createElement('article'); card.className = 'asset-card ' + (folder ? 'asset-folder project-folder' : 'project-card'); card.dataset.projectId = item.id; card.tabIndex = 0; card.setAttribute('role', 'link'); card.setAttribute('aria-label', folder ? '打开文件夹 ' + item.name : '打开项目 ' + item.name); if (!folder) card.style.setProperty('--card-accent', '#3978ed'); setupCardInteraction(card, item);
    const art = document.createElement('div'); art.className = 'asset-art'; if (folder) appendFolderArt(item, art); else if (item.thumbnailUrl) art.append(previewImage(item)); else art.append(projectIcon());
    const info = document.createElement('div'); info.className = 'asset-info'; const title = document.createElement('h2'); title.textContent = item.name; title.title = item.name; info.append(title);
    const selectControl = folder ? null : createSelectionControl(item, card); if (selectControl) syncCardSelection(card, selectControl, selectedProjectIds.has(item.id)); card.append(art, info, ...(selectControl ? [selectControl] : []), ...createProjectMenu(item, card)); grid.append(card);
  }
  if (!projectsLoading) void projectLoading.finish(loadingToken);
  syncScrollbar();
}

async function refresh() {
  const version = ++refreshVersion;
  projectsLoading = true; projectLoading.begin(); status('');
  try {
    const result = await listProjects(); if (version !== refreshVersion) return;
    projects = result; projectsLoading = false;
    const ids = new Set(projects.filter(item => !isFolder(item)).map(item => item.id)); for (const id of selectedProjectIds) if (!ids.has(id)) selectedProjectIds.delete(id);
    render();
  } catch (error) {
    if (version !== refreshVersion) return;
    projectsLoading = false; status('读取项目库失败：' + error.message); render();
  }
}
function beginRename(item) { openRenameId = item.id; $('renameProjectTitle').textContent = isFolder(item) ? '重命名文件夹' : '重命名项目'; $('renameProjectName').value = item.name; $('renameProjectError').textContent = ''; $('renameProjectDialog').showModal(); $('renameProjectName').focus(); $('renameProjectName').select(); }

$('projectSearch').oninput = event => { query = event.target.value; render(); syncScrollbar(); };
$('projectSearchForm').onsubmit = event => { event.preventDefault(); };
$('projectSort').onchange = event => { sort = event.target.value; render(); };
document.querySelectorAll('[data-project-view]').forEach(tab => tab.onclick = event => { event.preventDefault(); const previous = view; view = tab.dataset.projectView; activeFolderId = null; selectedProjectIds.clear(); history.replaceState(null, '', '?view=' + encodeURIComponent(view)); document.querySelectorAll('[data-project-view]').forEach(item => item.setAttribute('aria-selected', String(item === tab))); closeMenus(); render(); if (previous !== view) animateCardPage($('projectGrid'), view === 'public' ? 'next' : 'previous'); });
$('importProject').onclick = () => { const menu = $('projectAddMenu'); menu.hidden = !menu.hidden; $('importProject').setAttribute('aria-expanded', String(!menu.hidden)); };
$('newProjectMenu').onclick = () => { location.href = './design.html?new=1'; };
$('createProjectFolder').onclick = () => { closeProjectAddMenu(); $('newProjectFolderName').value = ''; $('newProjectFolderError').textContent = ''; $('newProjectFolderDialog').showModal(); $('newProjectFolderName').focus(); };
$('cancelRenameProject').onclick = () => $('renameProjectDialog').close();
$('renameProjectForm').onsubmit = async event => { event.preventDefault(); const name = $('renameProjectName').value.trim(); if (!name) { $('renameProjectError').textContent = '请输入名称'; return; } try { await renameProject(openRenameId, name); $('renameProjectDialog').close(); await refresh(); status('名称已更新'); } catch (error) { $('renameProjectError').textContent = error.message; } };
$('cancelProjectMove').onclick = () => $('projectMoveDialog').close();
$('projectMoveForm').onsubmit = async event => { event.preventDefault(); if (!movingProjectIds.length) return; try { for (const id of movingProjectIds) await moveProject(id, $('projectMoveTarget').value || null); movingProjectIds = []; $('projectMoveDialog').close(); selectedProjectIds.clear(); await refresh(); status('已移动'); } catch (error) { $('projectMoveError').textContent = error.message; } };
$('cancelNewProjectFolder').onclick = () => $('newProjectFolderDialog').close();
$('newProjectFolderForm').onsubmit = async event => { event.preventDefault(); const name = $('newProjectFolderName').value.trim(); if (!name) { $('newProjectFolderError').textContent = '请输入文件夹名称'; return; } try { await saveProjectFolder({ name, parentId: activeFolderId, visibility: view }); $('newProjectFolderDialog').close(); await refresh(); status('已创建文件夹'); } catch (error) { $('newProjectFolderError').textContent = error.message; } };
$('projectMoreOptions').onclick = () => { const menu = $('projectMoreMenu'); const selectable = currentPageItems.filter(item => !isFolder(item)); $('selectAllProjects').textContent = selectable.length && selectable.every(item => selectedProjectIds.has(item.id)) ? '取消全选' : '全选'; menu.hidden = !menu.hidden; $('projectMoreOptions').setAttribute('aria-expanded', String(!menu.hidden)); };
$('selectAllProjects').onclick = () => { const shown = currentPageItems.filter(item => !isFolder(item)); const allSelected = shown.length > 0 && shown.every(item => selectedProjectIds.has(item.id)); shown.forEach(item => allSelected ? selectedProjectIds.delete(item.id) : selectedProjectIds.add(item.id)); closeProjectMoreMenu(); render(); status(shown.length ? (allSelected ? `已取消全选 ${shown.length} 个项目` : `已选择 ${shown.length} 个项目`) : '当前没有可选择的项目'); };
$('moveSelectedProjects').onclick = () => { closeProjectMoreMenu(); void moveSelectedProjects(); };
$('deleteSelectedProjects').onclick = () => { void deleteSelectedProjects(); };

const libraryScroll = document.querySelector('.library-main'), assetScrollbar = document.getElementById('assetScrollbar'), assetScrollbarThumb = assetScrollbar.querySelector('.asset-scrollbar-thumb');
function syncScrollbar() { const maxScroll = libraryScroll.scrollHeight - libraryScroll.clientHeight; const trackHeight = assetScrollbar.clientHeight; const thumbHeight = maxScroll <= 1 ? trackHeight : Math.max(72, Math.round(trackHeight * libraryScroll.clientHeight / libraryScroll.scrollHeight)); const travel = Math.max(0, trackHeight - thumbHeight); assetScrollbarThumb.style.height = `${thumbHeight}px`; assetScrollbarThumb.style.transform = `translateY(${maxScroll <= 1 ? 0 : Math.round(travel * libraryScroll.scrollTop / maxScroll)}px)`; }
let dragging = null;
assetScrollbar.addEventListener('pointerdown', event => { if (event.target === assetScrollbarThumb) { dragging = { pointerId: event.pointerId, startY: event.clientY, startScroll: libraryScroll.scrollTop }; assetScrollbarThumb.setPointerCapture?.(event.pointerId); } else { const rect = assetScrollbar.getBoundingClientRect(), travel = Math.max(1, rect.height - assetScrollbarThumb.offsetHeight), offset = Math.max(0, Math.min(travel, event.clientY - rect.top - assetScrollbarThumb.offsetHeight / 2)); libraryScroll.scrollTop = (libraryScroll.scrollHeight - libraryScroll.clientHeight) * offset / travel; } });
assetScrollbar.addEventListener('pointermove', event => { if (!dragging || dragging.pointerId !== event.pointerId) return; const travel = Math.max(1, assetScrollbar.clientHeight - assetScrollbarThumb.offsetHeight), maxScroll = libraryScroll.scrollHeight - libraryScroll.clientHeight; libraryScroll.scrollTop = dragging.startScroll + (event.clientY - dragging.startY) * maxScroll / travel; });
assetScrollbar.addEventListener('pointerup', () => { dragging = null; }); assetScrollbar.addEventListener('pointercancel', () => { dragging = null; }); assetScrollbar.addEventListener('wheel', event => { event.preventDefault(); libraryScroll.scrollTop += event.deltaY; }, { passive: false });
libraryScroll.addEventListener('scroll', syncScrollbar, { passive: true }); window.addEventListener('resize', syncScrollbar); new ResizeObserver(syncScrollbar).observe(libraryScroll);
document.addEventListener('pointerdown', event => { if (openProjectMenu && !openProjectMenu.panel.contains(event.target) && !openProjectMenu.trigger.contains(event.target)) closeMenus(); const addMenu = $('projectAddMenu'); if (!addMenu.hidden && !addMenu.contains(event.target) && event.target !== $('importProject')) closeProjectAddMenu(); const moreMenu = $('projectMoreMenu'); if (!moreMenu.hidden && !moreMenu.contains(event.target) && event.target !== $('projectMoreOptions')) closeProjectMoreMenu(); });
document.addEventListener('click', () => closeMenus());
function animateCardPage(host, direction) { if (!host) return; host.classList.remove('page-turn-next', 'page-turn-previous'); void host.offsetWidth; host.classList.add(direction === 'previous' ? 'page-turn-previous' : 'page-turn-next'); window.setTimeout(() => host.classList.remove('page-turn-next', 'page-turn-previous'), 440); }
refresh();
