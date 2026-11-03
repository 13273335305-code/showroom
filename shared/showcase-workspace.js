import { createShowcaseStore, createGuestShowcase, hashShareToken } from './showcase-store.js';
import { applyShowcaseConfig, updatePresentationConfig } from './showcase-data.js';
import { listProjects, getProject } from './project-store.js';
import { listPhotos, downloadPhoto } from './album-store.js';
import { downloadFile } from './navigation.js';

const $ = id => document.getElementById(id);
function button(label, click, className = '') {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.className = className; node.onclick = click; return node;
}
export async function createShowcaseWorkspace({ token }) {
  const guest = token != null;
  const access = async () => (await import('./auth.js')).workspaceClient();
  const store = guest ? null : createShowcaseStore(access), publicStore = guest ? createGuestShowcase(token) : null;
  const requestedAddId = new URLSearchParams(location.search).get('addProject');
  let pendingImport = requestedAddId;
  let collection = guest ? await publicStore.read() : null, collections = [], summaries = new Map();
  let runtime, activeId = null, baseManifest = null, loaded = null, switching = false, pendingId = null, saveJob = null;
  let photoVersion = 0, photos = [], filter = 'all', previewIndex = -1, previewVersion = 0, previewUrl = null, previewFile = null;

  // Keep the design DOM as an inert compatibility shell, but mount no material editor or drop handlers.
  for (const id of ['assetPicker', 'compactMaterialPanel', 'legacyMaterialControls']) { $(id).hidden = true; $(id).inert = true; }
  $('developerToggle').hidden = true;
  if (guest) { $('developerPanel').remove(); $('developerToggle').remove(); }
  const actions = document.querySelector('.header-actions');
  $('headerUndo').hidden = $('headerRedo').hidden = true;
  $('saveProject').title = '保存展示效果'; $('saveProject').setAttribute('aria-label', '保存展示效果');
  const collectionTools = document.createElement('div'); collectionTools.className = 'showcase-collection-tools';
  collectionTools.innerHTML = '<select id="showcaseCollection" aria-label="展示清单"></select><button id="showcaseManage" type="button">管理清单</button>';
  document.querySelector('.topbar').insertBefore(collectionTools, actions);
  actions.append(button('分享', () => run(openShare), 'showcase-share-button'));
  if (guest) { actions.hidden = true; collectionTools.replaceChildren(); const title = document.createElement('strong'); title.textContent = collection.name; collectionTools.append(title); document.querySelector('.brand').removeAttribute('href'); }

  const dock = $('materialDock'), compatibility = document.createElement('div'); compatibility.hidden = true; compatibility.inert = true;
  compatibility.append(...dock.childNodes); dock.append(compatibility); dock.classList.add('showcase-project-dock');
  const dockUI = document.createElement('div'); dockUI.className = 'showcase-dock-content';
  dockUI.innerHTML = `<div class="showcase-dock-heading"><strong>项目 <span id="showcaseProjectCount">0</span></strong><div>
    <button id="showcaseRefresh" type="button">刷新项目</button><button id="showcaseAlbum" type="button">画册</button><button id="showcaseLight" type="button">灯光</button><button id="showcaseAdd" type="button">＋ 添加项目</button>
    </div></div><div id="showcaseProjects" class="showcase-projects" aria-label="展示项目"></div>`;
  dock.append(dockUI); if (guest) $('showcaseAdd').hidden = true;
  const errorBox = document.createElement('div'); errorBox.id = 'showcaseProjectError'; errorBox.className = 'showcase-project-error'; errorBox.hidden = true;
  errorBox.innerHTML = '<strong>项目读取失败</strong><p></p><button type="button">重试</button>';
  $('viewport').append(errorBox);
  const album = document.createElement('section'); album.id = 'showcaseAlbumPanel'; album.className = 'panel showcase-album';
  album.innerHTML = `<div class="showcase-album-heading"><select id="showcasePhotoFilter" aria-label="图片来源"><option value="all">全部图片</option><option value="capture">普通出图</option><option value="ai">AI 图</option></select><button id="showcasePhotoRefresh" type="button">刷新</button></div>
    <p id="showcasePhotoStatus" role="status">打开项目后查看画册</p><div id="showcasePhotos" class="showcase-photos"></div>`;
  document.querySelector('#inspector .panel-scroll').prepend(album);
  mountDialogs();

  function status(message) { runtime?.notify(message, 6000); }
  async function run(action) { try { await action(); } catch (error) { status(error.message); } }
  function setBusy(value) {
    switching = value;
    const busy = value || Boolean(saveJob);
    for (const id of ['showcaseCollection', 'showcaseManage', 'showcaseAdd', 'saveProject', 'snapshot', 'annotationMode', 'showcaseRefresh', 'showcaseLight']) { const node = $(id); if (node) node.disabled = busy || (!activeId && ['saveProject', 'snapshot', 'annotationMode'].includes(id)); }
    actions.querySelector('.showcase-share-button').disabled = busy;
    $('showcaseProjects').setAttribute('aria-busy', String(busy));
    if (value) runtime?.collapse(true);
  }
  function captureCurrent() {
    if (guest || !activeId || !baseManifest || !loaded || switching) return;
    const item = collection.items.find(i => i.projectId === activeId); if (!item) return;
    item.config = updatePresentationConfig(baseManifest, loaded, runtime.presentation(), item.config);
    loaded = runtime.presentation();
  }
  async function save() {
    if (guest || !collection || switching) return;
    if (saveJob) return saveJob;
    captureCurrent();
    status('正在保存展示效果…');
    await persistCollection(collection);
    status('展示清单与展示效果已保存');
  }
  function persistCollection(next) {
    if (saveJob) return saveJob;
    const snapshot = structuredClone(next);
    saveJob = store.save(snapshot).then(saved => {
      if (collection?.id === saved.id) collection = saved;
    }).finally(() => {
      saveJob = null; setBusy(switching); renderProjects();
    });
    setBusy(switching); renderProjects();
    return saveJob;
  }
  function clearProject() {
    closePreview(); activeId = null; baseManifest = loaded = null; pendingId = null;
    photoVersion++; photos = []; renderPhotos(); errorBox.hidden = true;
    runtime.clear();
  }
  const { startWorkspace } = await import('../app.js');
  runtime = await startWorkspace({ mode: guest ? 'showcase-guest' : 'showcase-owner', services: {
    save: () => run(save), downloadResource: guest ? ref => publicStore.resource(runtime.current().id, ref) : undefined,
    feedback: guest ? { comments: id => publicStore.comments(id), addComment: data => publicStore.addComment(data) } : store,
    sceneConfig: collection?.sceneConfig, defaultCamera: collection?.defaultCamera,
  } });
  $('inspectorToggle').onclick = () => { runtime.panel('scene'); runtime.collapse(false); };
  $('restoreInspector').setAttribute('aria-label', '展开项目画册');
  $('restoreInspector').onclick = () => { runtime.panel('album'); runtime.collapse(false); };
  $('closeInspector').onclick = () => { if(!album.hidden)runtime.collapse(true);else{runtime.panel('album');runtime.collapse(false);} };
  $('showcaseAlbum').onclick = () => { runtime.panel('album'); runtime.collapse(false); };
  $('showcaseLight').onclick = () => { runtime.panel('scene'); runtime.collapse(false); };
  $('resetScene').textContent = guest ? '恢复展示设置' : '恢复设计稿设置';
  $('resetScene').onclick = () => run(async () => {
    if (switching || !activeId) return;
    if (guest) { await selectProject(activeId); return; }
    collection.items.find(item => item.projectId === activeId).config = {};
    loaded = baseManifest = null; await selectProject(activeId); status('已恢复设计稿设置，保存后应用到分享链接');
  });
  $('showcaseRefresh').onclick = () => run(() => selectProject(activeId));
  $('showcasePhotoRefresh').onclick = () => refreshPhotos(activeId);
  $('showcasePhotoFilter').onchange = event => { filter = event.target.value; renderPhotos(); };
  $('showcaseAdd').onclick = () => run(openProjectPicker);
  $('showcaseProjectError').querySelector('button').onclick = () => run(() => selectProject(errorBox.dataset.project));
  window.addEventListener('spenic-project-photo', event => { if (event.detail.projectId === activeId) void refreshPhotos(activeId); });
  window.addEventListener('focus', () => { if (activeId && !switching) void refreshPhotos(activeId); });

  function renderProjects() {
    const host = $('showcaseProjects'); host.replaceChildren(); $('showcaseProjectCount').textContent = String(collection?.items.length || 0);
    if (!collection?.items.length) { const text = document.createElement('p'); text.className = 'showcase-empty-projects'; text.textContent = guest ? '展示者尚未添加项目' : '点击「＋ 添加项目」，从项目库选择已保存的方案。'; host.append(text); return; }
    collection.items.forEach((item, index) => {
      const summary = summaries.get(item.projectId), card = document.createElement('div'); card.className = 'showcase-project';
      const open = button('', () => run(() => selectProject(item.projectId)), 'showcase-project-open');
      open.disabled = Boolean(saveJob);
      open.setAttribute('aria-pressed', String(item.projectId === activeId)); open.setAttribute('aria-label', '打开项目 ' + (summary?.name || '项目暂不可用'));
      if (summary?.thumbnailUrl) { const image = new Image(); image.src = summary.thumbnailUrl; image.alt = ''; image.loading = 'lazy'; image.onerror = () => { image.remove(); }; open.append(image); }
      else { const icon = document.createElement('span'); icon.className = 'showcase-project-icon'; icon.textContent = '◇'; open.append(icon); }
      const name = document.createElement('strong'); name.textContent = summary?.name || '项目暂不可用'; name.title = name.textContent; open.append(name); card.append(open);
      if (!guest) {
        const tools = document.createElement('div'); tools.className = 'showcase-project-actions';
        const move = delta => run(async () => { if (switching || saveJob) return; captureCurrent(); const target = index + delta, ordered = [...collection.items]; [ordered[index], ordered[target]] = [ordered[target], ordered[index]]; await persistCollection({ ...collection, items: ordered }); });
        const left = button('←', () => move(-1)), right = button('→', () => move(1)); left.disabled = index === 0 || switching || Boolean(saveJob); right.disabled = index === collection.items.length - 1 || switching || Boolean(saveJob);
        left.setAttribute('aria-label', '向前移动项目'); right.setAttribute('aria-label', '向后移动项目');
        const remove = button('移出', () => run(async () => {
          if (switching || saveJob) return; captureCurrent();
          const next = { ...collection, items: collection.items.filter(i => i.projectId !== item.projectId) }; await persistCollection(next);
          if (activeId === item.projectId) { clearProject();
            if (collection.items.length) await selectProject(collection.items[0].projectId); else setBusy(false);
          }
          renderProjects(); status('已从清单移出，原项目仍保留');
        })); remove.disabled = switching || Boolean(saveJob); tools.append(left, right, remove); card.append(tools);
      }
      host.append(card);
    });
  }
  async function selectProject(id) {
    if (saveJob) await saveJob;
    if (!id || !collection?.items.some(i => i.projectId === id)) return;
    if (!switching) captureCurrent(); pendingId = id;
    if (switching) return;
    setBusy(true); renderProjects(); closePreview();
    try {
      while (pendingId) {
        const requested = pendingId; pendingId = null;
        errorBox.hidden = true; $('showcasePhotoStatus').textContent = '正在打开项目…';
        try {
          const saved = guest ? await publicStore.project(requested) : await getProject(requested);
          if (!saved?.manifest) throw new Error('项目不存在或已删除');
          if (pendingId) continue;
          const item = collection.items.find(i => i.projectId === requested);
          if (guest && saved.config) item.config = saved.config;
          baseManifest = saved.manifest;
          await runtime.open({ ...saved, manifest: applyShowcaseConfig(saved.manifest, item.config) });
          if (pendingId) continue;
          activeId = requested; loaded = runtime.presentation();
          summaries.set(requested, { ...summaries.get(requested), name: saved.name });
          await refreshPhotos(requested); renderProjects();
        } catch (error) {
          if (pendingId) continue;
          clearProject();
          errorBox.dataset.project = requested; errorBox.querySelector('p').textContent = error.message; errorBox.hidden = false;
          status(error.message);
        }
      }
    } finally { setBusy(false); renderProjects(); }
  }
  async function refreshPhotos(id) {
    const request = ++photoVersion; $('showcasePhotos').replaceChildren();
    if (!id) { $('showcasePhotoStatus').textContent = '打开项目后查看画册'; return; }
    $('showcasePhotoStatus').textContent = '正在读取项目图片…';
    try {
      const result = guest ? await publicStore.photos(id) : await listPhotos({ projectId: id });
      if (request !== photoVersion || id !== activeId) return;
      photos = result; renderPhotos();
    } catch (error) { if (request === photoVersion) { photos = []; $('showcasePhotoStatus').textContent = error.message; } }
  }
  const filteredPhotos = () => photos.filter(photo => filter === 'all' || photo.source === filter || filter === 'capture' && !photo.source);
  function renderPhotos() {
    const host = $('showcasePhotos'); host.replaceChildren(); const items = filteredPhotos();
    $('showcasePhotoStatus').textContent = items.length ? `${items.length} 张图片` : '暂无项目图片，新拍摄和 AI 成品会自动显示在这里。';
    items.forEach((photo, index) => {
      const card = button('', () => openPreview(index), 'showcase-photo'); const image = new Image();
      image.src = photo.thumbnailUrl || ''; image.alt = photo.name; image.loading = 'lazy'; image.decoding = 'async';
      image.onerror = () => { image.removeAttribute('src'); image.alt = '预览暂不可用，点击查看原图'; };
      const label = document.createElement('span'); label.textContent = photo.source === 'ai' ? 'AI 图' : '普通出图';
      const name = document.createElement('strong'); name.textContent = photo.name.replace(/\.png$/i, ''); name.title = photo.name;
      card.append(image, label, name); host.append(card);
    });
  }
  function closePreview() { previewVersion++; $('showcasePreview').close(); if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = previewFile = null; $('showcasePreviewImage').removeAttribute('src'); }
  async function openPreview(index) {
    const items = filteredPhotos(), photo = items[index], projectId = activeId; if (!photo || !projectId) return;
    const request = ++previewVersion; previewIndex = index; previewFile = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
    $('showcasePreviewImage').removeAttribute('src'); $('showcasePreviewName').textContent = photo.name;
    $('showcasePreviewStatus').textContent = '正在读取原图…'; $('showcaseDownload').disabled = true;
    $('showcasePrev').disabled = index === 0; $('showcaseNext').disabled = index === items.length - 1;
    if (!$('showcasePreview').open) $('showcasePreview').showModal();
    try {
      const file = guest ? await publicStore.photo(projectId, photo.id) : await downloadPhoto(photo.id);
      if (request !== previewVersion || projectId !== activeId) return;
      previewFile = file; previewUrl = URL.createObjectURL(file.blob); $('showcasePreviewImage').src = previewUrl;
      $('showcasePreviewStatus').textContent = `${photo.width} × ${photo.height} px`; $('showcaseDownload').disabled = false;
    } catch (error) { if (request === previewVersion) $('showcasePreviewStatus').textContent = error.message; }
  }
  function mountDialogs() {
    const dialogs = document.createElement('div'); dialogs.innerHTML = `
      <dialog id="showcaseManageDialog" class="showcase-dialog"><form id="showcaseManageForm"><h2>展示清单</h2><label>清单名称<input id="showcaseName" maxlength="120" required placeholder="例如：客户甲方案"></label><p id="showcaseManageStatus" role="status"></p><div class="showcase-dialog-actions"><button id="showcaseDelete" type="button">删除清单</button><button type="button" data-close>取消</button><button type="submit" class="primary">保存</button></div></form></dialog>
      <dialog id="showcaseProjectPicker" class="showcase-dialog"><form id="showcasePickerForm"><h2>添加项目</h2><input id="showcaseProjectSearch" type="search" placeholder="搜索项目" aria-label="搜索项目"><div id="showcasePickerItems" class="showcase-picker-items"></div><p id="showcasePickerStatus" role="status"></p><div class="showcase-dialog-actions"><button type="button" data-close>取消</button><button type="submit" class="primary">添加所选项目</button></div></form></dialog>
      <dialog id="showcaseImportDialog" class="showcase-dialog"><form id="showcaseImportForm"><h2>加入展示清单</h2><label>选择展示清单<select id="showcaseImportTarget"></select></label><p id="showcaseImportStatus" role="status"></p><div class="showcase-dialog-actions"><button id="showcaseImportNew" type="button">新建清单</button><button type="button" data-close>取消</button><button type="submit" class="primary">加入清单</button></div></form></dialog>
      <dialog id="showcaseShareDialog" class="showcase-dialog"><h2>分享展示清单</h2><p>客户免登录浏览，新增项目图片和项目更新会随链接同步；同一项目的客户留言互相可见。</p><input id="showcaseShareUrl" readonly aria-label="分享链接"><p id="showcaseShareStatus" role="status"></p><div class="showcase-dialog-actions"><button id="showcaseDisableShare" type="button">停用链接</button><button id="showcaseNewShare" type="button">生成／重置链接</button><button id="showcaseCopyShare" type="button" class="primary">复制链接</button><button type="button" data-close>关闭</button></div></dialog>
      <dialog id="showcasePreview" class="showcase-preview"><header><strong id="showcasePreviewName"></strong><button id="showcasePreviewClose" type="button" aria-label="关闭原图">×</button></header><div class="showcase-preview-stage"><img id="showcasePreviewImage" alt="项目原图"></div><footer><button id="showcasePrev" type="button">上一张</button><span id="showcasePreviewStatus" role="status"></span><button id="showcaseNext" type="button">下一张</button><button id="showcaseDownload" type="button" class="primary">下载原图</button></footer></dialog>`;
    document.body.append(...dialogs.childNodes);
    document.querySelectorAll('.showcase-dialog [data-close]').forEach(node => node.onclick = () => node.closest('dialog').close());
    $('showcasePreviewClose').onclick = closePreview;
    $('showcasePreview').addEventListener('cancel', event => { event.preventDefault(); closePreview(); });
    $('showcasePreview').addEventListener('close', () => { previewVersion++; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = previewFile = null; });
    $('showcasePrev').onclick = () => openPreview(previewIndex - 1); $('showcaseNext').onclick = () => openPreview(previewIndex + 1);
    $('showcaseDownload').onclick = () => { if (previewFile) downloadFile(previewFile.blob, previewFile.name); };
  }

  let editingNew = false;
  function editCollection(isNew = false) {
    if (switching) return; editingNew = isNew; $('showcaseName').value = isNew ? '' : collection?.name || '';
    $('showcaseDelete').hidden = isNew || !collection; $('showcaseManageStatus').textContent = ''; $('showcaseManageDialog').showModal(); $('showcaseName').focus();
  }
  async function loadCollections(preferred) {
    collections = await store.list(); const select = $('showcaseCollection'); select.replaceChildren();
    for (const item of collections) select.add(new Option(item.name, item.id)); select.add(new Option('＋ 新建展示清单', '__new'));
    if (preferred && collections.some(c => c.id === preferred)) select.value = preferred;
    if (collections.length) await loadCollection(select.value); else { collection = null; clearProject(); setBusy(false); select.value = '__new'; renderProjects(); editCollection(true); }
  }
  async function addImportedProject() {
    if (!pendingImport || !collection) return;
    const id = pendingImport;
    if (!summaries.has(id)) throw new Error('请先将项目另存为自己拥有的项目');
    if (!collection.items.some(item => item.projectId === id)) await persistCollection({ ...collection, items: [...collection.items, { projectId: id, config: {} }] });
    pendingImport = null; renderProjects(); await selectProject(id);
  }
  async function loadCollection(id) {
    captureCurrent(); clearProject(); setBusy(true); renderProjects();
    try {
      const next = await store.read(id);
      const { userId } = await access(), projects = (await listProjects()).filter(p => p.kind === 'project' && p.ownerId === userId);
      collection = next; summaries = new Map(projects.map(p => [p.id, p]));
      history.replaceState(null, '', './showcase.html?collection=' + encodeURIComponent(id));
    } finally { setBusy(false); renderProjects(); }
    if (collection.items.length) await selectProject(collection.items[0].projectId); else { photos = []; renderPhotos(); setBusy(false); }
  }
  async function openProjectPicker() {
    if (switching) return;
    if (!collection) { editCollection(true); return; }
    const { userId } = await access(); const all = (await listProjects()).filter(p => p.kind === 'project' && p.ownerId === userId && !collection.items.some(i => i.projectId === p.id));
    const selected = new Set(); $('showcasePickerStatus').textContent = ''; $('showcaseProjectSearch').value = '';
    function render() {
      const host = $('showcasePickerItems'); host.replaceChildren(); const query = $('showcaseProjectSearch').value.trim().toLocaleLowerCase();
      for (const project of all.filter(p => p.name.toLocaleLowerCase().includes(query))) {
        const row = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(project.id);
        input.onchange = () => { if (input.checked) selected.add(project.id); else selected.delete(project.id); };
        const name = document.createElement('span'); name.textContent = project.name; row.append(input, name); host.append(row);
      }
      if (!host.children.length) host.textContent = '暂无可添加的项目，请先在设计台保存自己的方案。';
    }
    $('showcaseProjectSearch').oninput = render; render();
    $('showcasePickerForm').onsubmit = async event => {
      event.preventDefault(); if (!selected.size) { $('showcasePickerStatus').textContent = '请先选择项目'; return; }
      const submit = event.submitter; submit.disabled = true;
      try { captureCurrent(); await persistCollection({ ...collection, items: [...collection.items, ...[...selected].map(projectId => ({ projectId, config: {} }))] });
        all.forEach(p => summaries.set(p.id, p)); $('showcaseProjectPicker').close(); renderProjects(); if (!activeId) await selectProject([...selected][0]);
      } catch (error) { $('showcasePickerStatus').textContent = error.message; } finally { submit.disabled = false; }
    };
    $('showcaseProjectPicker').showModal();
  }
  function shareKey() { return 'spenic-showcase-link:' + collection.id; }
  async function openShare() {
    if (guest || !collection || switching) return; await save();
    const fresh = await store.read(collection.id); let cached = null; try { cached = JSON.parse(localStorage.getItem(shareKey())); } catch {}
    const valid = cached?.token && fresh.share?.enabled && await hashShareToken(cached.token) === fresh.share.token_hash;
    $('showcaseShareUrl').value = valid ? new URL('./showcase.html#share=' + cached.token, location.href).href : '';
    $('showcaseCopyShare').disabled = !valid; $('showcaseDisableShare').disabled = !fresh.share?.enabled;
    $('showcaseShareStatus').textContent = valid ? '链接已启用' : fresh.share?.enabled ? '已有链接生效，可重置生成新的链接。' : '生成链接后即可发给客户。';
    $('showcaseShareDialog').showModal();
  }
  if (!guest) {
    $('showcaseManage').onclick = () => editCollection(false);
    $('showcaseCollection').onchange = event => run(async () => {
      if (event.target.value === '__new') { event.target.value = collection?.id || '__new'; editCollection(true); } else { await save(); await loadCollection(event.target.value); }
    });
    $('showcaseManageForm').onsubmit = async event => {
      event.preventDefault(); event.submitter.disabled = true;
      try { await save(); const saved = await store.save(editingNew ? { name: $('showcaseName').value.trim(), items: [] } : { ...collection, name: $('showcaseName').value.trim() });
        $('showcaseManageDialog').close(); await loadCollections(saved.id); await addImportedProject();
      } catch (error) { $('showcaseManageStatus').textContent = error.message; } finally { event.submitter.disabled = false; }
    };
    $('showcaseDelete').onclick = () => run(async () => {
      if (!collection || !confirm('删除这套展示清单？原项目和项目图片仍会保留，分享链接将停用。')) return;
      await store.remove(collection.id); $('showcaseManageDialog').close(); collection = null; activeId = null; await loadCollections();
    });
    $('showcaseNewShare').onclick = async () => {
      $('showcaseNewShare').disabled = true;
      try { const link = await store.share(collection.id); try { localStorage.setItem(shareKey(), JSON.stringify(link)); } catch {}
        $('showcaseShareUrl').value = new URL('./showcase.html#share=' + link.token, location.href).href;
        $('showcaseCopyShare').disabled = $('showcaseDisableShare').disabled = false; $('showcaseShareStatus').textContent = '链接已启用，之前的链接已失效';
      } catch (error) { $('showcaseShareStatus').textContent = error.message; } finally { $('showcaseNewShare').disabled = false; }
    };
    $('showcaseDisableShare').onclick = async () => {
      $('showcaseDisableShare').disabled = true;
      try { await store.disableShare(collection.id); $('showcaseShareUrl').value = ''; $('showcaseCopyShare').disabled = true; $('showcaseShareStatus').textContent = '链接已停用'; }
      catch (error) { $('showcaseShareStatus').textContent = error.message; $('showcaseDisableShare').disabled = false; }
    };
    $('showcaseCopyShare').onclick = async () => {
      try { await navigator.clipboard.writeText($('showcaseShareUrl').value); $('showcaseShareStatus').textContent = '链接已复制'; }
      catch { $('showcaseShareUrl').select(); $('showcaseShareStatus').textContent = '请复制上方链接'; }
    };
    await loadCollections(new URLSearchParams(location.search).get('collection'));
    if (pendingImport && collection) {
      if (!summaries.has(pendingImport)) status('请先将项目另存为自己拥有的项目');
      else {
        const select = $('showcaseImportTarget'); select.replaceChildren(); collections.forEach(c => select.add(new Option(c.name, c.id))); select.value = collection.id;
        $('showcaseImportForm').onsubmit = async event => {
          event.preventDefault(); event.submitter.disabled = true;
          try { await save(); if (select.value !== collection.id) { $('showcaseCollection').value = select.value; await loadCollection(select.value); } await addImportedProject(); $('showcaseImportDialog').close(); }
          catch (error) { $('showcaseImportStatus').textContent = error.message; } finally { event.submitter.disabled = false; }
        };
        $('showcaseImportNew').onclick = () => { $('showcaseImportDialog').close(); editCollection(true); };
        $('showcaseImportDialog').showModal();
      }
    }
  } else { summaries = new Map(collection.items.map(item => [item.projectId, item])); renderProjects(); if (collection.items.length) await selectProject(collection.items[0].projectId); else setBusy(false); }
  if(!guest)window.__spenicShowcaseSession={save};
  runtime.panel('album');
}
