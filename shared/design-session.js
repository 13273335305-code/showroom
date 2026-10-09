import { authState } from './auth.js';
function sessionKey() { const id = authState()?.id; return id ? 'spenic-last-project:' + id : null; }
export async function saveDesignSession(projectId) {
  const key = sessionKey(); if (!key || !projectId) return;
  try { localStorage.setItem(key, projectId); } catch {}
}
export async function loadDesignSession() {
  const key = sessionKey(); if (!key) return null;
  try { return localStorage.getItem(key); } catch { return null; }
}
export async function clearDesignSession() {
  const key = sessionKey(); if (key) try { localStorage.removeItem(key); } catch {}
}
