// Project packages live separately from material and model assets so the
// project library can list and restore complete design sessions.
const DB_NAME = 'spenic-projects';
const STORE = 'projects';
let database;

function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开项目库'));
    request.onblocked = () => reject(new Error('请关闭其他旧版项目库页面后重试'));
  }).catch(error => { database = null; throw error; });
  return database;
}

async function transaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('项目操作失败，请检查浏览器存储空间'));
  });
}

export const listProjects = () => transaction('readonly', store => store.getAll());
export const getProject = id => transaction('readonly', store => store.get(id));
export const deleteProject = id => transaction('readwrite', store => store.delete(id));

export async function saveProject(project) {
  if (!(project?.blob instanceof Blob) || !project.name?.trim()) throw new Error('项目文件或名称无效');
  const existing = project.id ? await getProject(project.id) : null;
  const now = Date.now();
  const saved = {
    ...existing,
    ...project,
    id: project.id || crypto.randomUUID(),
    kind: 'project',
    name: project.name.trim(),
    modelName: String(project.modelName || existing?.modelName || '').trim(),
    parentId: project.parentId === undefined ? (existing?.parentId || null) : (project.parentId || null),
    visibility: project.visibility === undefined ? (existing?.visibility === 'public' ? 'public' : 'personal') : (project.visibility === 'public' ? 'public' : 'personal'),
    blob: project.blob,
    thumbnail: project.thumbnail || existing?.thumbnail || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await transaction('readwrite', store => store.put(saved));
  return saved;
}

export async function saveProjectFolder(folder) {
  if (!folder?.name?.trim()) throw new Error('文件夹名称无效');
  const existing = folder.id ? await getProject(folder.id) : null;
  if (existing && existing.kind !== 'folder') throw new Error('项目不能转换为文件夹');
  const now = Date.now();
  const saved = {
    ...existing,
    ...folder,
    id: folder.id || crypto.randomUUID(),
    kind: 'folder',
    name: folder.name.trim(),
    parentId: folder.parentId || null,
    visibility: folder.visibility === 'public' ? 'public' : (existing?.visibility === 'public' ? 'public' : 'personal'),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  delete saved.blob;
  delete saved.thumbnail;
  await transaction('readwrite', store => store.put(saved));
  return saved;
}

export async function renameProject(id, name) {
  const current = await getProject(id);
  if (!current) throw new Error('项目不存在');
  if (current.kind === 'folder') return saveProjectFolder({ ...current, id, name });
  return saveProject({ ...current, id, name });
}

export async function moveProject(id, parentId) {
  const current = await getProject(id);
  if (!current) throw new Error('项目不存在');
  const next = { ...current, id, parentId: parentId || null };
  return current.kind === 'folder' ? saveProjectFolder(next) : saveProject(next);
}

export async function setProjectVisibility(id, isPublic) {
  const current = await getProject(id);
  if (!current) throw new Error('项目不存在');
  if (current.kind === 'folder') return saveProjectFolder({ ...current, id, visibility: isPublic ? 'public' : 'personal' });
  return saveProject({ ...current, id, visibility: isPublic ? 'public' : 'personal' });
}
