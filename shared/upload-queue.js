import { authState } from './auth.js';
import { saveAsset } from './asset-store.js';

const DB_NAME = 'spenic-upload-tasks-v1';
const listeners = new Set();
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(DB_NAME) : null;
let database, running = false, started = false;
const ownerId = () => authState()?.id;
const runnerId = crypto.randomUUID();

function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('tasks', { keyPath: 'id' });
      request.result.createObjectStore('payloads', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法保存上传任务，请检查浏览器存储空间。'));
  }).catch(error => { database = null; throw error; });
  return database;
}
async function transaction(stores, mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode); let result;
    const setResult = value => { result = value; };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('无法保存上传任务，请检查浏览器存储空间。'));
    try { action(tx, setResult); } catch (error) { tx.abort(); reject(error); }
  });
}
function emit() { for (const listener of listeners) listener(); }
function changed() {
  emit(); channel?.postMessage('changed');
  try { localStorage.setItem(DB_NAME, crypto.randomUUID()); } catch {}
}
export function subscribeUploads(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export async function listUploads() {
  const owner = ownerId(); if (!owner) return [];
  const tasks = await transaction(['tasks'], 'readonly', (tx, result) => {
    const request = tx.objectStore('tasks').getAll(); request.onsuccess = () => result(request.result);
  });
  return tasks.filter(task => task.ownerId === owner).sort((a, b) => b.createdAt - a.createdAt);
}
export async function getUpload(id, { payload = false } = {}) {
  const owner = ownerId();
  return transaction(['tasks', 'payloads'], 'readonly', (tx, result) => {
    const request = tx.objectStore('tasks').get(id);
    request.onsuccess = () => {
      const task = request.result;
      if (!task || task.ownerId !== owner) { result(null); return; }
      if (!payload) { result(task); return; }
      const data = tx.objectStore('payloads').get(id);
      data.onsuccess = () => result({ ...task, asset: data.result?.asset });
    };
  });
}
export async function enqueueMaterialUpload(asset, { dependsOn = null } = {}) {
  const owner = ownerId();
  if (!owner) throw new Error('请先登录工作空间');
  const fork = asset.id && asset.ownerId && asset.ownerId !== owner;
  const id = crypto.randomUUID(), targetAssetId = !fork && asset.id || crypto.randomUUID();
  const snapshot = structuredClone({ ...asset, createId: !asset.id || fork ? targetAssetId : undefined, uploadTaskId: id, uploadOwnerId: owner });
  const task = { id, ownerId: owner, targetAssetId, dependsOn, name: asset.name, status: 'queued', stage: 'queued', completed: 0, total: 0, createdAt: Date.now(), updatedAt: Date.now(), attempt: 0, leaseUntil: 0 };
  await transaction(['tasks', 'payloads'], 'readwrite', tx => {
    const store = tx.objectStore('tasks');
    const add = () => { store.add(task); tx.objectStore('payloads').add({ id, asset: snapshot }); };
    if (!dependsOn) { add(); return; }
    const dependency = store.get(dependsOn);
    dependency.onsuccess = () => {
      if (dependency.result?.ownerId !== owner || dependency.result?.targetAssetId !== targetAssetId) task.dependsOn = null;
      add();
    };
  });
  changed(); startUploadQueue(); void kick();
  return task;
}
async function updateTask(id, mutate) {
  const owner = ownerId();
  return transaction(['tasks'], 'readwrite', (tx, result) => {
    const store = tx.objectStore('tasks'), request = store.get(id);
    request.onsuccess = () => {
      const task = request.result;
      if (!task || task.ownerId !== owner || !mutate(task)) { result(null); return; }
      task.updatedAt = Date.now(); store.put(task); result(task);
    };
  });
}
export async function retryUpload(id) {
  const task = await updateTask(id, task => {
    if (task.status !== 'failed') return false;
    task.status = 'queued'; task.stage = 'queued'; task.error = ''; task.leaseUntil = 0; return true;
  });
  if (task) { changed(); void kick(); }
}
export async function deleteFailedUpload(id) {
  const owner = ownerId();
  const removed = await transaction(['tasks', 'payloads'], 'readwrite', (tx, result) => {
    const store = tx.objectStore('tasks'), request = store.getAll();
    request.onsuccess = () => {
      const task = request.result.find(item => item.id === id && item.ownerId === owner);
      if (!task || task.status !== 'failed') { result(false); return; }
      store.delete(id); tx.objectStore('payloads').delete(id);
      // A later save must stay visible and removable instead of waiting forever
      // for the deleted task to finish.
      for (const next of request.result) if (next.ownerId === owner && next.dependsOn === id) {
        next.dependsOn = null;
        if (next.status === 'queued') {
          next.status = 'failed'; next.error = '前一上传任务已删除，请重新保存。';
        }
        next.updatedAt = Date.now(); store.put(next);
      }
      result(true);
    };
  });
  if (removed) changed();
  return removed;
}
export async function clearCompletedUploads() {
  const owner = ownerId();
  await transaction(['tasks', 'payloads'], 'readwrite', tx => {
    const store = tx.objectStore('tasks'), request = store.getAll();
    request.onsuccess = () => {
      const needed = new Set(request.result.filter(task => task.ownerId === owner && task.status !== 'completed').map(task => task.dependsOn));
      for (const task of request.result) if (task.ownerId === owner && task.status === 'completed' && !needed.has(task.id)) {
        store.delete(task.id); tx.objectStore('payloads').delete(task.id);
      }
    };
  });
  changed();
}
async function claimTask(owner, exclusive) {
  return transaction(['tasks'], 'readwrite', (tx, result) => {
    const store = tx.objectStore('tasks'), request = store.getAll();
    request.onsuccess = () => {
      const tasks = request.result, byId = new Map(tasks.map(task => [task.id, task]));
      const task = tasks.filter(task => task.ownerId === owner &&
        (task.status === 'queued' || (task.status === 'uploading' && (exclusive || task.leaseUntil <= Date.now()))) &&
        (!task.dependsOn || byId.get(task.dependsOn)?.status === 'completed')).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!task) { result(null); return; }
      task.status = 'uploading'; task.stage = 'preparing'; task.error = ''; task.runnerId = runnerId;
      task.leaseUntil = Date.now() + 30000; task.attempt++; task.updatedAt = Date.now();
      store.put(task); result({ ...task, dependency: byId.get(task.dependsOn) });
    };
  });
}
async function drain(owner, exclusive) {
  while (ownerId() === owner && navigator.onLine) {
    const task = await claimTask(owner, exclusive); if (!task) break;
    changed();
    const heartbeat = setInterval(() => { void updateTask(task.id, item => {
      if (item.runnerId !== runnerId || item.status !== 'uploading') return false;
      item.leaseUntil = Date.now() + 30000; return true;
    }).catch(() => {}); }, 10000);
    try {
      const stored = await getUpload(task.id, { payload: true });
      if (!stored?.asset) throw new Error('上传文件不可用，请重新保存材质。');
      const asset = stored.asset;
      if (task.dependency?.result?.revision) asset.revision = task.dependency.result.revision;
      const saved = await saveAsset(asset, { onProgress: async progress => {
        if (ownerId() !== owner) throw new Error('账号已切换，上传已暂停。');
        await updateTask(task.id, item => {
          if (item.runnerId !== runnerId || item.status !== 'uploading') return false;
          Object.assign(item, progress); return true;
        });
        changed();
      } });
      if (ownerId() !== owner) throw new Error('账号已切换，上传已暂停。');
      await transaction(['tasks', 'payloads'], 'readwrite', tx => {
        const store = tx.objectStore('tasks'), request = store.get(task.id);
        request.onsuccess = () => {
          const current = request.result;
          if (current?.runnerId !== runnerId) return;
          Object.assign(current, { status: 'completed', stage: 'completed', leaseUntil: 0, updatedAt: Date.now(), result: { id: saved.id, revision: saved.revision, previewInfo: saved.previewInfo } });
          store.put(current); tx.objectStore('payloads').delete(task.id);
        };
      });
    } catch (error) {
      await updateTask(task.id, item => {
        if (item.runnerId !== runnerId) return false;
        item.status = 'failed'; item.error = error.message || '上传失败，请重试。'; item.leaseUntil = 0; return true;
      });
    } finally { clearInterval(heartbeat); changed(); }
  }
}
async function kick() {
  if (running || !ownerId() || !navigator.onLine) return;
  running = true;
  const owner = ownerId();
  try {
    if (navigator.locks) await navigator.locks.request(DB_NAME + ':' + owner, { ifAvailable: true }, lock => lock ? drain(owner, true) : undefined);
    else await drain(owner, false);
  } catch { emit(); }
  finally { running = false; }
}
export function startUploadQueue() {
  if (!started) {
    started = true;
    setInterval(() => { void kick(); }, 4000);
    window.addEventListener('online', () => { void kick(); });
    window.addEventListener('focus', () => { emit(); void kick(); });
    window.addEventListener('storage', event => { if (event.key === DB_NAME) { emit(); void kick(); } });
  }
  void kick();
}
if (channel) channel.onmessage = () => { emit(); void kick(); };
