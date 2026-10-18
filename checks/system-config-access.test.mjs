import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { isSystemConfigAdmin } from '../shared/auth-service.js';

const auth = await readFile(new URL('../shared/auth.js', import.meta.url), 'utf8');
const settings = await readFile(new URL('../shared/system-config.js', import.meta.url), 'utf8');
const admin = { id: '11111111-1111-4111-8111-111111111111', email: '486837574@qq.com', email_confirmed_at: '2026-10-01T00:00:00Z' };
const member = { id: '22222222-2222-4222-8222-222222222222', email: 'member@example.com', email_confirmed_at: admin.email_confirmed_at };

test('only the designated confirmed email grants system configuration access', () => {
  assert.equal(isSystemConfigAdmin(admin), true);
  assert.equal(isSystemConfigAdmin({ ...admin, email: ' 486837574@QQ.COM ' }), true);
  for (const user of [null, {}, member, { ...admin, email_confirmed_at: null },
    { ...member, app_metadata: { spenic_developer: true } },
    { ...member, user_metadata: { email: admin.email, canManageSystemConfig: true } }]) {
    assert.equal(isSystemConfigAdmin(user), false);
  }
});

test('verified identity shows or hides the entry and closes the panel when access is lost', () => {
  const stateStart = auth.indexOf('export function authState()');
  const stateEnd = auth.indexOf('export function isAuthenticated()', stateStart);
  const accessStart = settings.indexOf('function syncSystemConfigAccess()');
  const accessEnd = settings.indexOf("window.addEventListener('spenic-auth-change'", accessStart);
  let onChange;
  const entry = { hidden: true }, dialog = { open: false, close() { this.open = false; } };
  const harness = new Function('isSystemConfigAdmin', 'window', 'CustomEvent', 'entry', 'dialog',
    'let currentIdentity = null; ' + auth.slice(stateStart, stateEnd).replace('export ', '') + settings.slice(accessStart, accessEnd) + 'return {setIdentity, authState, syncSystemConfigAccess};')(
    isSystemConfigAdmin, { dispatchEvent: () => onChange() }, class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, entry, dialog);
  onChange = harness.syncSystemConfigAccess;
  harness.syncSystemConfigAccess(); assert.equal(entry.hidden, true);
  harness.setIdentity({ user: admin }); assert.equal(entry.hidden, false);
  dialog.open = true; harness.setIdentity({ user: member });
  assert.equal(entry.hidden, true); assert.equal(dialog.open, false);
  harness.setIdentity({ user: admin }); harness.setIdentity(null);
  assert.equal(entry.hidden, true); assert.equal(harness.authState(), null);
});

test('opening configuration verifies permission again before showing the dialog', async () => {
  const start = settings.indexOf('let opening = false;');
  const end = settings.indexOf("$('systemConfigBack').onclick", start);
  let click, verified = 0, opened = 0, allowed = false, permitted = false;
  new Function('entry', 'syncSystemConfigAccess', 'workspaceClient', 'menu', 'dialog', 'syncScrollbar', settings.slice(start, end))(
    { hidden: true, addEventListener: (_, handler) => { click = handler; } }, () => allowed,
    async () => { verified++; return { canManageSystemConfig: permitted }; }, () => {},
    { showModal() { opened++; } }, () => {});
  await click(); assert.equal(verified, 0); assert.equal(opened, 0);
  allowed = true; await click(); assert.equal(verified, 1); assert.equal(opened, 0);
  permitted = true; await click(); assert.equal(verified, 2); assert.equal(opened, 1);
});

test('sign-out and account changes revoke access, and updated accounts are verified again', () => {
  const start = auth.indexOf('function onSessionEvent(');
  const end = auth.indexOf('async function getService()', start);
  let identity = { user: admin }, redirects = 0, checks = 0;
  const callback = new Function('window', 'isLoginPage', 'onIdentity', 'returnToLogin', 'location', 'URL', 'appRoot', 'recheckSession',
    'let currentIdentity = {user: arguments[8]}; function setIdentity(value){currentIdentity=value;onIdentity(value)} ' + auth.slice(start, end) + 'return onSessionEvent;')(
    { setTimeout: fn => fn() }, false, value => { identity = value; }, () => { redirects++; },
    { replace: () => { redirects++; } }, URL, new URL('https://workspace.example/'), () => { checks++; }, admin);
  callback('USER_UPDATED', { user: admin }); assert.equal(checks, 1);
  callback('SIGNED_IN', { user: member }); assert.equal(identity, null); assert.equal(redirects, 1);
  callback('SIGNED_OUT', null); assert.equal(identity, null); assert.equal(redirects, 1);
});

test('entry starts hidden and the hidden attribute overrides its grid styling', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../system-config.css', import.meta.url), 'utf8');
  assert.match(html, /<button[^>]*id="systemConfigEntry"[^>]*\bhidden[^>]*>/);
  assert.match(css, /\.system-config-entry\[hidden\]\s*\{display:none!important\}/);
});

test('database permits only the designated account and migration preserves saved configuration', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$; create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$; grant usage on schema auth to anon, authenticated;");
    await db.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [admin.id, admin.email, member.id, member.email]);
    for (const name of ['capture-ai.sql', 'fabric-colors.sql']) {
      const schema = await readFile(new URL('../supabase/' + name, import.meta.url), 'utf8');
      await db.exec(schema); await db.exec(schema);
    }
    const login = async (user, claims = {}) => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user?.id, ...claims })]);
      await db.exec('set role ' + (user ? 'authenticated' : 'anon'));
    };
    const savePrompts = () => db.query("insert into spenic_capture_ai_prompts(id,prompts) values('site',$1::jsonb) on conflict(id) do update set prompts=excluded.prompts returning prompts", [JSON.stringify([{ label: '管理员场景', prompt: '已保存的提示词' }])]);
    const saveColors = () => db.query("insert into spenic_fabric_colors(id,colors) values('site',$1::jsonb) on conflict(id) do update set colors=excluded.colors returning colors", [JSON.stringify([{ code: 'ABC', base: '#123456', line: '#abcdef' }])]);
    await login(member, { email: admin.email, app_metadata: { spenic_developer: true }, user_metadata: { email: admin.email } });
    await assert.rejects(savePrompts(), /row-level security/); await assert.rejects(saveColors(), /row-level security/);
    await login(admin); await savePrompts(); await saveColors();
    await assert.rejects(db.query('select email from auth.users'), /permission denied/);
    await db.exec('reset role');
    // Upgrade a deployed installation whose previous policy accepted developer metadata.
    await db.exec("drop policy spenic_capture_ai_prompts_update on spenic_capture_ai_prompts; create policy spenic_capture_ai_prompts_update on spenic_capture_ai_prompts for update to authenticated using ((auth.jwt()->'app_metadata'->>'spenic_developer')='true') with check ((auth.jwt()->'app_metadata'->>'spenic_developer')='true');");
    const migration = await readFile(new URL('../supabase/system-config-admin.sql', import.meta.url), 'utf8');
    await db.exec(migration); await db.exec(migration);
    await login(member, { app_metadata: { spenic_developer: true } });
    assert.equal((await db.query('select prompts from spenic_capture_ai_prompts')).rows[0].prompts[0].label, '管理员场景');
    assert.equal((await db.query('select colors from spenic_fabric_colors')).rows[0].colors[0].code, 'ABC');
    await assert.rejects(savePrompts(), /row-level security/);
    assert.deepEqual((await db.query("update spenic_capture_ai_prompts set prompts='[]'::jsonb where id='site' returning id")).rows, []);
    await db.exec('reset role'); await db.query('update auth.users set email_confirmed_at=null where id=$1', [admin.id]);
    await login(admin); await assert.rejects(saveColors(), /row-level security/);
    await db.exec('reset role'); await db.query('update auth.users set email=$1,email_confirmed_at=now() where id=$2', ['changed@example.com', admin.id]);
    await login(admin, { email: admin.email }); await assert.rejects(savePrompts(), /row-level security/);
    await login(null);
    assert.equal((await db.query('select colors from spenic_fabric_colors')).rows.length, 1);
    await assert.rejects(saveColors(), /permission denied/);
  } finally { await db.close(); }
});

test('administrator migration initializes missing tables and allows saving without the full AI schema', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$; create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$; grant usage on schema auth to anon, authenticated;");
    await db.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [admin.id, admin.email, member.id, member.email]);
    const migration = await readFile(new URL('../supabase/system-config-admin.sql', import.meta.url), 'utf8');
    const result = await db.exec(migration);
    assert.deepEqual(result.at(-1).rows, [{ fabric_colors_ready: true, ai_prompts_ready: true, admin_account_ready: true }]);
    assert.match(migration, /notify pgrst, 'reload schema'/);
    const login = async user => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user?.id })]);
      await db.exec('set role ' + (user ? 'authenticated' : 'anon'));
    };
    const prompts = [{ label: '意式轻奢', prompt: '为此床垫生成一张意式轻奢场景图，不包含任何文案。' }];
    const save = value => db.query("insert into spenic_capture_ai_prompts(id,prompts) values('site',$1::jsonb) on conflict(id) do update set prompts=excluded.prompts returning prompts", [JSON.stringify(value)]);
    await login(admin);
    assert.deepEqual((await save(prompts)).rows[0].prompts, prompts);
    await assert.rejects(save([{ label: '没有具体提示词' }]), /check constraint/);
    await db.exec('reset role'); await db.exec(migration);
    await login(member);
    assert.deepEqual((await db.query('select prompts from spenic_capture_ai_prompts')).rows[0].prompts, prompts);
    await assert.rejects(save([]), /row-level security/);
    await login(null);
    assert.deepEqual((await db.query('select prompts from spenic_capture_ai_prompts')).rows[0].prompts, prompts);
    await assert.rejects(save(prompts), /permission denied/);
  } finally { await db.close(); }
});
