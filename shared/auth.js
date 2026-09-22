const STORAGE_KEY = 'spenic-auth-role-v1';
const KEYS = Object.freeze({
  Spenic000: Object.freeze({ role: 'full', materialEditor: true }),
  Spenic001: Object.freeze({ role: 'design', materialEditor: false }),
});

function stateForRole(role) {
  return Object.values(KEYS).find(value => value.role === role) || null;
}

function storedState() {
  try {
    const role = localStorage.getItem(STORAGE_KEY);
    const state = stateForRole(role);
    return state ? { ...state } : null;
  } catch { return null; }
}

function setStoredState(state) {
  try { localStorage.setItem(STORAGE_KEY, state.role); } catch {}
  window.__spenicAuth = { ...state };
}

function overlayMarkup() {
  const overlay = document.createElement('div');
  overlay.id = 'systemAuthOverlay';
  overlay.className = 'loading system-auth-overlay';
  overlay.innerHTML = `<form id="systemAuthCard" class="login-card">
    <div class="login-brand"><span class="login-mark" role="img" aria-label="Spenic showroom"></span><h1>Spenic <em>showroom</em></h1></div>
    <label class="login-input"><span class="sr-only">密钥</span><input id="systemAuthKey" type="password" autocomplete="off" placeholder="请输入密钥"></label>
    <button id="systemAuthSubmit" class="login-submit" type="submit" aria-label="登录"><span class="sr-only">登录</span><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9.5 5.5 16 12 9.5 18.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <strong id="systemAuthStatus" class="login-status" hidden></strong>
  </form>`;
  return overlay;
}

function existingOverlay() {
  const overlay = document.querySelector('#loading');
  if (!overlay?.querySelector('#loginCard')) return null;
  const card = overlay.querySelector('#loginCard');
  const input = overlay.querySelector('#loginKey');
  const submit = overlay.querySelector('#loginSubmit');
  const status = overlay.querySelector('#loginStatus');
  return { overlay, card, input, submit, status };
}

function makeOverlay() {
  const current = existingOverlay();
  if (current) return current;
  const overlay = overlayMarkup();
  document.body.append(overlay);
  return { overlay, card: overlay.querySelector('#systemAuthCard'), input: overlay.querySelector('#systemAuthKey'), submit: overlay.querySelector('#systemAuthSubmit'), status: overlay.querySelector('#systemAuthStatus') };
}

function hideOverlay(parts) {
  parts.overlay.hidden = true;
  parts.overlay.setAttribute('aria-hidden', 'true');
}

export function authState() {
  return window.__spenicAuth || storedState();
}

export function canAccess(feature) {
  const state = authState();
  return !!state && (feature !== 'material' || state.materialEditor);
}

export async function requireAuth({ feature = 'design' } = {}) {
  const current = storedState();
  if (current) {
    window.__spenicAuth = current;
    hideOverlay(makeOverlay());
    if (feature !== 'material' || current.materialEditor) return { ...current, allowed: true };
    return { ...current, allowed: false };
  }
  const parts = makeOverlay();
  parts.overlay.hidden = false;
  parts.overlay.removeAttribute('aria-hidden');
  parts.input.value = '';
  parts.input.focus({ preventScroll: true });
  if (parts.overlay.querySelector('#loadingProgress')) parts.overlay.querySelector('#loadingProgress').hidden = true;
  parts.status.hidden = true;
  parts.submit.disabled = false;
  return new Promise(resolve => {
    const finish = state => {
      setStoredState(state);
      hideOverlay(parts);
      resolve({ ...state, allowed: feature !== 'material' || state.materialEditor });
    };
    parts.card.onsubmit = event => {
      event.preventDefault();
      const state = KEYS[parts.input.value.trim()];
      if (!state) {
        parts.status.hidden = false;
        parts.status.textContent = '密钥无效，请重新输入';
        parts.input.select();
        return;
      }
      finish(state);
    };
  });
}

export function showAccessDenied(message = '当前密钥没有访问此功能的权限') {
  const notice = document.createElement('div');
  notice.className = 'auth-denied';
  notice.innerHTML = `<div><strong>功能未开放</strong><p>${message}</p><button type="button">返回设计台</button></div>`;
  notice.querySelector('button').onclick = () => { location.href = './index.html'; };
  document.body.append(notice);
  return notice;
}
