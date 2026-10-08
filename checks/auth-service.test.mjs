import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage, createAuthService, createAuthStorage, readAuthConfig, safeAuthTarget } from '../shared/auth-service.js';

const config = { url: 'https://workspace.supabase.co', publishableKey: 'sb_publishable_test-only', allowSignUp: true };
const appRoot = 'https://example.com/studio/';
function store() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function harness(overrides = {}, settings = config) {
  const calls = [], user = { id: 'server-user', email: 'designer@example.com' };
  let session = null, callback, options;
  const ok = data => ({ data, error: null });
  const auth = {
    onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { calls.push(['getSession']); return ok({ session }); },
    async getUser(token) { calls.push(['getUser', token]); return ok({ user }); },
    async signInWithPassword(value) { calls.push(['signIn', value]); session = { access_token: 'server-token', user: { id: 'untrusted-cache' } }; return ok({ session }); },
    async signUp(value) { calls.push(['signUp', value]); return ok({ user, session: null }); },
    async resetPasswordForEmail(email, value) { calls.push(['reset', email, value]); return ok({}); },
    async updateUser(value) { calls.push(['update', value]); return ok({ user }); },
    async signOut(value) { calls.push(['signOut', value]); session = null; return ok({}); },
    ...overrides,
  };
  const storage = createAuthStorage(store(), store());
  const service = createAuthService(settings, (url, key, supplied) => { options = supplied; return { auth }; }, { storage, appRoot });
  return { service, calls, user, get options() { return options; }, setSession(value) { session = value; }, emit(event) { callback(event, session); } };
}

test('missing configuration and secret keys fail closed', () => {
  assert.throws(() => readAuthConfig({}), /尚未连接/);
  assert.throws(() => readAuthConfig({ ...config, url: 'not a URL' }), /HTTPS/);
  assert.throws(() => readAuthConfig({ ...config, url: 'http://workspace.supabase.co' }), /HTTPS/);
  assert.throws(() => readAuthConfig({ ...config, publishableKey: 'sb_secret_test' }), /service_role/);
  const jwt = role => `e30.${btoa(JSON.stringify({ role }))}.signature`;
  assert.throws(() => readAuthConfig({ ...config, publishableKey: jwt('service_role') }), /service_role/);
  assert.equal(readAuthConfig({ ...config, publishableKey: jwt('anon') }).publishableKey, jwt('anon'));
});

test('redirects accept only workspace routes on the same origin and deployment path', () => {
  const fallback = appRoot + 'index.html';
  for (const target of ['https://evil.test/design.html', '//evil.test/design.html', '\\evil.test', 'javascript:alert(1)', '/design.html', '../studio2/index.html', 'login.html', 'login.html?next=login.html', 'design.html#access_token=forged', 'index.html?code=forged']) {
    assert.equal(safeAuthTarget(target, appRoot), fallback, target);
  }
  assert.equal(safeAuthTarget('design.html?asset=abc', appRoot), appRoot + 'design.html?asset=abc');
  assert.equal(safeAuthTarget('/studio/project-library.html?view=personal', appRoot), appRoot + 'project-library.html?view=personal');
});

test('remembering a device persists tokens while temporary sessions stay in the tab', () => {
  const local = store(), tab = store(), storage = createAuthStorage(local, tab);
  storage.setItem('token', 'one'); assert.equal(local.getItem('token'), 'one');
  storage.setRemember(false);
  assert.equal(storage.getItem('token'), 'one');
  storage.setItem('token', 'two'); assert.equal(local.getItem('token'), null); assert.equal(tab.getItem('token'), 'two');
  const restored = createAuthStorage(local, tab);
  assert.equal(restored.getItem('token'), 'two'); restored.setItem('token', 'refreshed');
  assert.equal(local.getItem('token'), null); assert.equal(tab.getItem('token'), 'refreshed');
  restored.removeItem('token'); assert.equal(restored.getItem('token'), null);
});

test('restricted storage falls back to an in-memory session', () => {
  const denied = { getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } };
  const storage = createAuthStorage(denied, denied);
  storage.setItem('token', 'temporary'); assert.equal(storage.getItem('token'), 'temporary');
  storage.removeItem('token'); assert.equal(storage.getItem('token'), null);
});

test('identity comes from remote getUser rather than the stored session user', async () => {
  const h = harness();
  assert.equal(await h.service.verifiedSession(), null);
  h.setSession({ access_token: 'token', user: { id: 'forged-local-owner' } });
  const identity = await h.service.verifiedSession();
  assert.equal(identity.user.id, 'server-user'); assert.deepEqual(h.calls.at(-1), ['getUser', 'token']);
  assert.equal(h.options.auth.flowType, 'pkce'); assert.equal(h.options.auth.autoRefreshToken, true);
});

test('a revoked token cannot authenticate', async () => {
  const h = harness({ async getUser() { return { data: {}, error: { code: 'session_not_found' } }; } });
  h.setSession({ access_token: 'revoked', user: { id: 'forged' } });
  await assert.rejects(h.service.verifiedSession(), error => error.code === 'session_not_found');
});

test('password login verifies the returned identity and preserves password characters', async () => {
  const h = harness(); const password = ' pass word with spaces ';
  const result = await h.service.signIn('designer@example.com', password, false);
  assert.equal(result.user.id, 'server-user');
  assert.deepEqual(h.calls[0], ['signIn', { email: 'designer@example.com', password }]);
  assert.deepEqual(h.calls.at(-1), ['getUser', 'server-token']);
});

test('registration waits for confirmation and respects invitation-only mode', async () => {
  const h = harness(); assert.equal(await h.service.signUp('designer@example.com', 'password123', true), null);
  assert.equal(h.calls[0][1].options.emailRedirectTo, appRoot + 'login.html');
  const invited = harness({}, { ...config, allowSignUp: false });
  await assert.rejects(invited.service.signUp('designer@example.com', 'password123', true), error => error.code === 'signup_disabled');
  assert.equal(invited.calls.length, 0);
});

test('password-reset emails return to the password form rather than the workspace', async () => {
  const h = harness(); await h.service.requestReset('designer@example.com');
  assert.deepEqual(h.calls[0], ['reset', 'designer@example.com', { redirectTo: appRoot + 'login.html?flow=recovery' }]);
  h.emit('PASSWORD_RECOVERY'); assert.equal(h.service.recovery, true);
});

test('password updates require a verified session and sign out after success', async () => {
  const h = harness();
  await assert.rejects(h.service.updatePassword('new-password'), error => error.code === 'session_not_found');
  assert.equal(h.calls.some(call => call[0] === 'update'), false);
  h.setSession({ access_token: 'recovery-token' }); await h.service.updatePassword('new-password');
  assert.deepEqual(h.calls.at(-2), ['update', { password: 'new-password' }]);
  assert.deepEqual(h.calls.at(-1), ['signOut', { scope: 'local' }]);
});

test('failed sign-out is surfaced rather than reported as complete', async () => {
  const h = harness({ async signOut() { return { data: {}, error: { status: 503 } }; } });
  await assert.rejects(h.service.signOut(), error => error.status === 503);
});

test('errors are understandable and do not echo service messages or credentials', () => {
  assert.match(authErrorMessage({ code: 'invalid_credentials' }), /邮箱或密码/);
  assert.match(authErrorMessage({ code: 'email_not_confirmed' }), /确认/);
  assert.match(authErrorMessage({ status: 429 }), /频繁/);
  assert.match(authErrorMessage({ message: 'Failed to fetch' }), /网络/);
  assert.equal(authErrorMessage({ message: 'raw secret token and stack' }), '操作未完成，请稍后重试。');
});
