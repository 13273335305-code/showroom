import { authConfig } from '../auth-config.js';
import { authErrorMessage, createAuthService, createAuthStorage, readAuthConfig, safeAuthTarget } from './auth-service.js';

const appRoot = new URL('../', import.meta.url);
const loginUrl = new URL('login.html', appRoot);
const isLoginPage = location.pathname === loginUrl.pathname;
const parameters = new URLSearchParams(location.search);
const callbackHash = new URLSearchParams(location.hash.slice(1));
const passwordCallback = parameters.get('flow') === 'recovery' || ['recovery', 'invite'].includes(callbackHash.get('type'));
const callbackError = parameters.has('error') || callbackHash.has('error');
let currentIdentity = null, servicePromise = null, authPromise = null, activeOverlay = null, accountCleanup = null;

function browserStorage(name) { try { return window[name]; } catch { return undefined; } }
const storage = createAuthStorage(browserStorage('localStorage'), browserStorage('sessionStorage'));
for (const key of ['spenic-auth-role-v1', 'spenic-auth-session-v2', 'spenic-auth-session-tab-v2']) {
  try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch {}
}

export function authState() { return currentIdentity ? { id: currentIdentity.user.id, email: currentIdentity.user.email || '' } : null; }
export function isAuthenticated() { return Boolean(currentIdentity); }
export async function workspaceClient() {
  const service = await getService();
  const identity = await service.verifiedSession();
  if (!identity) throw new Error('请先登录工作空间');
  currentIdentity = identity;
  return { client: service.client, userId: identity.user.id };
}

function returnToLogin() {
  const url = new URL(loginUrl);
  if (!isLoginPage) url.searchParams.set('next', location.pathname + location.search + location.hash);
  location.replace(url.href);
}

function onSessionEvent(event, session) {
  // SDK auth callbacks must finish synchronously; validate outside its lock.
  window.setTimeout(() => {
    if (event === 'PASSWORD_RECOVERY' && !isLoginPage) {
      location.replace(new URL('login.html?flow=recovery', appRoot).href);
      return;
    }
    if (event === 'SIGNED_OUT') {
      const wasAuthenticated = Boolean(currentIdentity);
      currentIdentity = null;
      if (wasAuthenticated && !isLoginPage) returnToLogin();
    } else if (event === 'SIGNED_IN' && currentIdentity && session?.user.id !== currentIdentity.user.id) {
      currentIdentity = null;
      location.replace(new URL('index.html', appRoot).href);
    }
  }, 0);
}

async function getService() {
  if (!servicePromise) servicePromise = (async () => {
    try { readAuthConfig(authConfig); } catch (error) { error.name = 'AuthConfigurationError'; throw error; }
    let sdk;
    let timeout;
    try {
      // Pinned official SDK, loaded only after the public project configuration exists.
      sdk = await Promise.race([
        import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm'),
        new Promise((_, reject) => { timeout = window.setTimeout(() => reject(new Error('Network timeout')), 20000); }),
      ]);
    } catch { throw new Error('Network: authentication SDK could not load'); }
    finally { window.clearTimeout(timeout); }
    return createAuthService(authConfig, sdk.createClient, { storage, appRoot, detectSessionInUrl: isLoginPage, onEvent: onSessionEvent });
  })().catch(error => { servicePromise = null; throw error; });
  return servicePromise;
}

export async function clearAuth() {
  const service = await getService();
  await service.signOut();
  currentIdentity = null;
}

function mountAccountAction() {
  const host = document.querySelector('.topbar .header-actions, .asset-top-actions');
  const placeholder = host?.querySelector('[data-auth-action]');
  accountCleanup?.();
  accountCleanup = null;
  if (!document.body.classList.contains('home-page') || !host || !currentIdentity) { placeholder?.remove(); return; }
  const account = document.createElement('div');
  account.className = 'auth-account'; account.dataset.authAction = 'true';
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'auth-account-action';
  button.title = '我的账号'; button.setAttribute('aria-label', '查看用户信息');
  button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'authAccountPanel');
  const avatar = document.createElement('span'); avatar.className = 'auth-account-avatar'; avatar.setAttribute('aria-hidden', 'true');
  avatar.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2Z"/></svg>';
  button.append(avatar);
  const panel = document.createElement('section');
  panel.id = 'authAccountPanel'; panel.className = 'auth-account-panel'; panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'authAccountTitle');
  panel.innerHTML = '<div class="auth-account-info"><strong id="authAccountTitle">用户信息</strong><span class="auth-account-name" hidden></span><span class="auth-account-field">邮箱</span><span class="auth-account-email"></span></div><button type="button" class="auth-account-logout"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H5v16h5M9 12h12m-4-4 4 4-4 4"/></svg><span>退出登录</span></button><p class="auth-account-menu-error" role="alert" hidden></p>';
  const name = currentIdentity.user.user_metadata?.display_name || currentIdentity.user.user_metadata?.full_name;
  if (typeof name === 'string' && name.trim()) {
    panel.querySelector('.auth-account-name').textContent = name.trim();
    panel.querySelector('.auth-account-name').hidden = false;
  }
  panel.querySelector('.auth-account-email').textContent = currentIdentity.user.email || '未设置邮箱';
  const logout = panel.querySelector('.auth-account-logout');
  const errorMessage = panel.querySelector('.auth-account-menu-error');
  const setOpen = (open, focus = false) => {
    panel.hidden = !open; button.setAttribute('aria-expanded', String(open));
    if (focus) button.focus({ preventScroll: true });
  };
  button.addEventListener('click', () => setOpen(panel.hidden));
  account.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); setOpen(false, true); }
    else if (event.key === 'ArrowDown' && event.target === button) { event.preventDefault(); setOpen(true); logout.focus(); }
  });
  account.addEventListener('focusout', event => { if (!account.contains(event.relatedTarget)) setOpen(false); });
  const onOutsidePointer = event => { if (!account.contains(event.target)) setOpen(false); };
  document.addEventListener('pointerdown', onOutsidePointer);
  accountCleanup = () => { document.removeEventListener('pointerdown', onOutsidePointer); account.remove(); };
  logout.addEventListener('click', async () => {
    if (logout.disabled) return;
    logout.disabled = true; logout.setAttribute('aria-busy', 'true');
    logout.querySelector('span').textContent = '正在退出…'; errorMessage.hidden = true;
    try { await clearAuth(); accountCleanup?.(); returnToLogin(); }
    catch (error) {
      logout.disabled = false; logout.removeAttribute('aria-busy');
      logout.querySelector('span').textContent = '退出登录';
      errorMessage.textContent = authErrorMessage(error); errorMessage.hidden = false;
      setOpen(true);
    }
  });
  account.append(button, panel);
  if (placeholder) placeholder.replaceWith(account); else host.append(account);
}

const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13m-6-6 6 6-6 6"></path></svg>';
function overlayMarkup() {
  const overlay = document.createElement('div');
  overlay.id = 'authOverlay'; overlay.className = 'auth-overlay auth-overlay-checking';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'authTitle');
  overlay.innerHTML = `
    <div class="auth-shell">
      <section class="auth-showcase" aria-label="Spenic 工作空间">
        <div class="auth-brand"><img src="assets/spenic-logo.png" alt="Spenic"><span class="auth-brand-divider"></span><span>WORKSPACE</span></div>
        <div class="auth-intro">
          <span class="auth-eyebrow">A QUIET SPACE FOR MATERIALS</span>
          <h1>把每一种质感，<br><em>变成可继续的灵感。</em></h1>
          <p>从三维设计、材质编辑到资产整理，在一个轻盈的玻璃工作空间里继续你的创作。</p>
          <div class="auth-feature-stack" aria-hidden="true">
            <div class="auth-feature-card"><span class="auth-feature-icon">◇</span><span><strong>设计台</strong><small>三维预览 · 材质应用</small></span></div>
            <div class="auth-feature-card"><span class="auth-feature-icon">✦</span><span><strong>材质编辑器</strong><small>PBR 细节 · 物理尺寸</small></span></div>
            <div class="auth-feature-card"><span class="auth-feature-icon">□</span><span><strong>资产库</strong><small>面料 · 图案 · 模型</small></span></div>
          </div>
        </div>
      </section>
      <section class="auth-form-panel">
        <div class="auth-form-wrap">
          <div class="auth-form-heading"><small>WELCOME BACK</small><h2 id="authTitle">登录工作空间</h2><p id="authSubtitle">使用你的邮箱账号继续工作。</p></div>
          <div id="authTabs" class="auth-tabs" role="tablist" aria-label="账号操作" hidden>
            <button type="button" id="authLoginTab" role="tab" aria-controls="authForm" aria-selected="true">登录</button>
            <button type="button" id="authRegisterTab" role="tab" aria-controls="authForm" aria-selected="false" tabindex="-1">注册</button>
          </div>
          <form id="authForm" novalidate aria-labelledby="authTitle">
            <label id="authEmailField" class="auth-field" for="authEmail"><span class="auth-field-label">邮箱</span><span class="auth-input-wrap"><input id="authEmail" name="email" type="email" autocomplete="username" inputmode="email" placeholder="name@example.com" maxlength="254" required aria-describedby="authError"></span></label>
            <label id="authPasswordField" class="auth-field" for="authPassword"><span id="authPasswordLabel" class="auth-field-label">密码</span><span class="auth-input-wrap has-icon"><span class="auth-input-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"></path></svg></span><input id="authPassword" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required aria-describedby="authError"><button id="authToggle" class="auth-password-toggle" type="button" aria-label="显示密码" aria-pressed="false" data-visible="false"><svg class="eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.3-5 9-5 9 5 9 5-3.3 5-9 5-9-5-9-5Z"></path><circle cx="12" cy="12" r="2.2"></circle></svg><svg class="eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 16M10.6 7.2A9.8 9.8 0 0 1 12 7c5.7 0 9 5 9 5a16 16 0 0 1-3.1 3.3M6.2 6.8C4.1 8.2 3 10 3 12c0 0 3.3 5 9 5 1.4 0 2.6-.3 3.7-.8"></path></svg></button></span></label>
            <label id="authConfirmField" class="auth-field" for="authConfirm" hidden><span class="auth-field-label">确认密码</span><span class="auth-input-wrap"><input id="authConfirm" name="confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入密码" disabled aria-describedby="authError"></span></label>
            <div id="authOptions" class="auth-options"><label class="auth-remember"><input id="authRemember" type="checkbox" checked> 记住此设备</label><button id="authForgot" class="auth-link" type="button">忘记密码？</button></div>
            <button id="authSubmit" class="auth-submit" type="submit" disabled>正在连接…${arrow}</button>
            <p id="authError" class="auth-error" role="alert"></p>
            <p id="authMessage" class="auth-message" role="status"></p>
          </form>
          <button id="authRetry" class="auth-link auth-retry" type="button" hidden>重新连接</button>
          <button id="authBack" class="auth-link auth-back" type="button" hidden>返回登录</button>
          <div class="auth-card-footer"><p id="authFooter">账号由管理员邀请开通。</p></div>
        </div>
      </section>
    </div>`;
  return overlay;
}

function mountOverlay() {
  const overlay = overlayMarkup();
  const previousFocus = document.activeElement;
  const backgrounds = [...document.body.children].filter(element => !['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName));
  const states = backgrounds.map(element => [element, element.inert]);
  backgrounds.forEach(element => { element.inert = true; });
  const overflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.append(overlay); activeOverlay = overlay;
  const trap = event => {
    if (event.key !== 'Tab') return;
    const elements = [...overlay.querySelectorAll('input, button, a[href]')].filter(element => !element.disabled && !element.closest('[hidden]') && element.tabIndex >= 0);
    const first = elements[0], last = elements.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  };
  overlay.addEventListener('keydown', trap);
  return { overlay, close() {
    overlay.removeEventListener('keydown', trap);
    states.forEach(([element, inert]) => { element.inert = inert; });
    document.body.style.overflow = overflow; overlay.remove(); activeOverlay = null;
    if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus({ preventScroll: true });
  } };
}

function wireOverlay(view, resolve) {
  const $ = id => view.overlay.querySelector('#' + id);
  let service = null, mode = 'login', busy = false;
  const titles = { login: ['登录工作空间', '使用你的邮箱账号继续工作。', '登录'], register: ['创建账号', '注册后，请通过邮件确认邮箱。', '注册'], forgot: ['找回密码', '我们会向你的邮箱发送重置链接。', '发送重置邮件'], password: ['设置新密码', '为你的账号设置一个新密码。', '保存新密码'] };
  const message = (text = '', isError = false) => { $('authError').textContent = isError ? text : ''; $('authMessage').textContent = isError ? '' : text; };
  const renderBusy = () => {
    $('authForm').setAttribute('aria-busy', String(busy));
    for (const id of ['authSubmit', 'authLoginTab', 'authRegisterTab', 'authForgot', 'authBack', 'authToggle', 'authRemember', 'authRetry']) $(id).disabled = busy || !service;
    $('authSubmit').innerHTML = (busy ? '请稍候…' : titles[mode][2]) + arrow;
  };
  function setMode(next, focus = true) {
    mode = next; message();
    $('authTitle').textContent = titles[mode][0]; $('authSubtitle').textContent = titles[mode][1];
    $('authEmailField').hidden = mode === 'password'; $('authEmail').disabled = mode === 'password';
    $('authPasswordField').hidden = mode === 'forgot'; $('authPassword').disabled = mode === 'forgot';
    $('authPassword').minLength = mode === 'login' ? 1 : 8;
    $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('authPassword').placeholder = mode === 'login' ? '请输入密码' : '至少 8 位';
    $('authPasswordLabel').textContent = mode === 'password' ? '新密码' : '密码';
    $('authPassword').value = ''; $('authConfirm').value = ''; $('authPassword').type = 'password';
    $('authToggle').dataset.visible = 'false'; $('authToggle').setAttribute('aria-label', '显示密码'); $('authToggle').setAttribute('aria-pressed', 'false');
    $('authConfirmField').hidden = !['password', 'register'].includes(mode); $('authConfirm').disabled = $('authConfirmField').hidden; $('authConfirm').required = !$('authConfirmField').hidden;
    $('authOptions').hidden = ['forgot', 'password'].includes(mode); $('authForgot').hidden = mode !== 'login';
    $('authBack').hidden = !['forgot', 'password'].includes(mode);
    $('authTabs').hidden = !authConfig.allowSignUp || ['forgot', 'password'].includes(mode);
    for (const [id, tabMode] of [['authLoginTab', 'login'], ['authRegisterTab', 'register']]) { $(id).setAttribute('aria-selected', String(mode === tabMode)); $(id).tabIndex = mode === tabMode ? 0 : -1; }
    renderBusy();
    if (focus) (mode === 'password' ? $('authPassword') : $('authEmail')).focus({ preventScroll: true });
  }
  async function finish(identity) {
    currentIdentity = identity;
    if (isLoginPage) { location.replace(safeAuthTarget(parameters.get('next'), appRoot)); return; }
    mountAccountAction(); view.close(); resolve({ ...authState(), allowed: true });
  }
  async function initialize() {
    busy = true; renderBusy(); message(); $('authRetry').hidden = true;
    try {
      service = await getService();
      const identity = await service.verifiedSession();
      busy = false;
      if (callbackError) { setMode('forgot'); message('邮件链接已失效，请重新申请。', true); }
      else if (passwordCallback || service.recovery) {
        if (identity) setMode('password');
        else { setMode('forgot'); message('邮件链接已失效，请在发起请求的浏览器中重新申请。', true); }
      } else if (identity) { await finish(identity); return; }
      else setMode('login');
      view.overlay.classList.remove('auth-overlay-checking');
      $('authFooter').textContent = authConfig.allowSignUp ? '新账号需通过邮件确认邮箱。' : '账号由管理员邀请开通。';
    } catch (error) {
      busy = false;
      view.overlay.classList.remove('auth-overlay-checking');
      if (service) setMode(passwordCallback || callbackError ? 'forgot' : 'login');
      renderBusy(); message(authErrorMessage(error), true); $('authRetry').hidden = false; $('authRetry').disabled = false;
    }
  }
  $('authLoginTab').onclick = () => setMode('login'); $('authRegisterTab').onclick = () => setMode('register');
  $('authTabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || busy) return;
    event.preventDefault(); setMode(event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : mode === 'login' ? 'register' : 'login', false);
    $(mode === 'login' ? 'authLoginTab' : 'authRegisterTab').focus();
  });
  $('authForgot').onclick = () => setMode('forgot');
  $('authBack').onclick = async () => {
    if (mode === 'password') {
      busy = true; renderBusy();
      try { await service.signOut(); } catch (error) { busy = false; renderBusy(); message(authErrorMessage(error), true); return; }
      busy = false; history.replaceState(null, '', loginUrl.pathname);
    }
    setMode('login');
  };
  $('authRetry').onclick = initialize;
  $('authToggle').onclick = () => {
    const visible = $('authPassword').type === 'password'; $('authPassword').type = visible ? 'text' : 'password';
    $('authToggle').dataset.visible = String(visible); $('authToggle').setAttribute('aria-pressed', String(visible));
    $('authToggle').setAttribute('aria-label', visible ? '隐藏密码' : '显示密码'); $('authPassword').focus();
  };
  $('authForm').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !service) return;
    if (!$('authForm').reportValidity()) return;
    const email = $('authEmail').value.trim(), password = $('authPassword').value;
    if (['register', 'password'].includes(mode) && password !== $('authConfirm').value) { message('两次输入的密码不一致。', true); $('authConfirm').focus(); return; }
    busy = true; message(); renderBusy();
    try {
      if (mode === 'login') await finish(await service.signIn(email, password, $('authRemember').checked));
      else if (mode === 'register') {
        const identity = await service.signUp(email, password, $('authRemember').checked);
        if (identity) await finish(identity);
        else { setMode('login'); message('请查看邮件并确认邮箱，然后返回登录。'); }
      } else if (mode === 'forgot') {
        await service.requestReset(email); message('如果该邮箱已注册，你将收到重置邮件。请在此浏览器中打开链接。');
      } else {
        await service.updatePassword(password); history.replaceState(null, '', loginUrl.pathname);
        setMode('login'); message('密码已更新，请使用新密码登录。');
      }
    } catch (error) { message(authErrorMessage(error), true); }
    finally { busy = false; renderBusy(); }
  });
  initialize();
}

export async function requireAuth() {
  if (!authPromise) authPromise = new Promise(resolve => { wireOverlay(mountOverlay(), resolve); });
  return authPromise;
}

window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
window.addEventListener('focus', async () => {
  if (!currentIdentity || activeOverlay || isLoginPage) return;
  try {
    const identity = await (await getService()).verifiedSession();
    if (!identity || identity.user.id !== currentIdentity.user.id) { currentIdentity = null; returnToLogin(); }
  } catch { currentIdentity = null; returnToLogin(); }
});

if (isLoginPage) requireAuth();
