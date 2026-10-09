export function readAuthConfig(config) {
  if (!config?.url || !config?.publishableKey) {
    throw new Error('账号服务尚未连接，请联系管理员完成配置。');
  }
  let url;
  try { url = new URL(config.url); }
  catch { throw new Error('账号服务地址必须是有效的 HTTPS 项目地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('账号服务地址必须是有效的 HTTPS 项目地址。');
  }
  const key = config.publishableKey.trim();
  if (!key.startsWith('sb_publishable_')) {
    try {
      const parts = key.split('.');
      if (parts.length !== 3) throw new Error();
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role !== 'anon') throw new Error();
    } catch {
      throw new Error('请使用 Publishable key 或 anon public key，不可使用 Secret / service_role key。');
    }
  }
  return { url: url.origin, publishableKey: key, allowSignUp: config.allowSignUp === true };
}

// Supabase stores session tokens through this adapter; passwords are never stored.
export function createAuthStorage(local, tab) {
  let remember = true;
  let explicitPreference = false;
  const memory = new Map();
  const read = (store, key) => { try { return store?.getItem(key) ?? null; } catch { return null; } };
  const remove = (store, key) => { try { store?.removeItem(key); } catch {} };
  return {
    setRemember(value) { remember = Boolean(value); explicitPreference = true; },
    getItem(key) {
      const temporary = read(tab, key);
      if (temporary !== null) { if (!explicitPreference) remember = false; return temporary; }
      const persistent = read(local, key);
      if (persistent !== null) { if (!explicitPreference) remember = true; return persistent; }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      remove(remember ? tab : local, key);
      try {
        const store = remember ? local : tab;
        if (!store) throw new Error();
        store.setItem(key, value);
        memory.delete(key);
      } catch { memory.set(key, value); }
    },
    removeItem(key) { remove(local, key); remove(tab, key); memory.delete(key); },
  };
}

export function safeAuthTarget(target, appRoot) {
  const root = new URL(appRoot);
  const fallback = new URL('index.html', root).href;
  const pages = new Set(['index.html', 'design.html', 'material-editor.html', 'asset-library.html', 'project-library.html', 'model-parts.html']);
  try {
    const url = new URL(target || 'index.html', root);
    const name = url.pathname.slice(root.pathname.length);
    if (url.origin !== root.origin || url.username || url.password || !url.pathname.startsWith(root.pathname) || (name && !pages.has(name))) return fallback;
    const hash = new URLSearchParams(url.hash.slice(1));
    if (['access_token', 'refresh_token', 'code', 'token_hash'].some(key => url.searchParams.has(key) || hash.has(key))) return fallback;
    return url.href;
  } catch { return fallback; }
}

export function authErrorMessage(error) {
  const code = error?.code;
  if (code === 'invalid_credentials') return '邮箱或密码不正确，请重试。';
  if (code === 'email_not_confirmed') return '请先点击邮件中的确认链接，再登录。';
  if (code === 'signup_disabled') return '暂未开放注册，请联系管理员邀请账号。';
  if (['weak_password', 'same_password'].includes(code)) return '请设置不同于旧密码的强密码，至少 8 位。';
  if (code === 'user_already_exists') return '请尝试登录，或通过邮件找回密码。';
  if (code === 'session_not_found' || code === 'refresh_token_not_found' || code === 'refresh_token_already_used') return '登录已过期，请重新登录。';
  if (code === 'bad_code_verifier' || code === 'flow_state_expired' || code === 'otp_expired') return '邮件链接已失效，请在发起请求的浏览器中重新申请。';
  if (error?.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(code)) return '操作过于频繁，请稍后再试。';
  if (/fetch|network|load|timeout/i.test(error?.message || '')) return '暂时无法连接账号服务，请检查网络后重试。';
  if (error?.name === 'AuthConfigurationError') return error.message;
  return '操作未完成，请稍后重试。';
}

export function createAuthService(config, createClient, { storage, appRoot, detectSessionInUrl = true, onEvent = () => {} } = {}) {
  const checked = readAuthConfig(config);
  const client = createClient(checked.url, checked.publishableKey, {
    auth: {
      flowType: 'pkce', persistSession: true, autoRefreshToken: true,
      detectSessionInUrl, storage,
      storageKey: `spenic-auth-${new URL(checked.url).hostname}-v3`,
    },
  });
  let recovery = false;
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    onEvent(event, session);
  });
  const checkedResult = result => { if (result.error) throw result.error; return result.data; };
  async function verifiedSession() {
    const { session } = checkedResult(await client.auth.getSession());
    if (!session) return null;
    // Ask the service for the user rather than trusting browser-stored identity.
    const { user } = checkedResult(await client.auth.getUser(session.access_token));
    if (!user?.id) throw new Error('Missing verified user');
    return { user, session };
  }
  return {
    client,
    get recovery() { return recovery; },
    verifiedSession,
    async signIn(email, password, remember) {
      storage?.setRemember(remember);
      checkedResult(await client.auth.signInWithPassword({ email, password }));
      const identity = await verifiedSession();
      if (!identity) throw new Error('Missing login session');
      recovery = false;
      return identity;
    },
    async signUp(email, password, remember) {
      if (!checked.allowSignUp) throw Object.assign(new Error(), { code: 'signup_disabled' });
      storage?.setRemember(remember);
      const data = checkedResult(await client.auth.signUp({ email, password, options: { emailRedirectTo: new URL('login.html', appRoot).href } }));
      return data.session ? verifiedSession() : null;
    },
    async requestReset(email) {
      checkedResult(await client.auth.resetPasswordForEmail(email, { redirectTo: new URL('login.html?flow=recovery', appRoot).href }));
    },
    async updatePassword(password) {
      if (!await verifiedSession()) throw Object.assign(new Error(), { code: 'session_not_found' });
      checkedResult(await client.auth.updateUser({ password }));
      recovery = false;
      checkedResult(await client.auth.signOut({ scope: 'local' }));
    },
    async signOut() { checkedResult(await client.auth.signOut({ scope: 'local' })); recovery = false; },
    dispose() { subscription.unsubscribe(); },
  };
}
