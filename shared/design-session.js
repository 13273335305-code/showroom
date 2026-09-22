const DB_NAME = 'spenic-design-session';
const STORE = 'session';
let database;

function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开设计台状态存储'));
  }).catch(error => { database = null; throw error; });
  return database;
}

export async function saveDesignSession(blob) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id: 'current', blob, updatedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('设计台状态保存失败'));
  });
}

export async function loadDesignSession() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get('current');
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => reject(request.error || new Error('设计台状态读取失败'));
  });
}

export async function clearDesignSession() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete('current');
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('设计台状态清理失败'));
  });
}
