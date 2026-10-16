import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_FABRIC_COLORS, readFabricColors, createFabricColorStore } from '../shared/fabric-color-config.js';

test('color codes normalize, duplicates and malformed color definitions are rejected', () => {
  assert.deepEqual(readFabricColors([{ code: ' abc ', base: '#AABBCC', line: '#001122' }]), [{ code: 'ABC', base: '#aabbcc', line: '#001122' }]);
  assert.deepEqual(readFabricColors([]), []);
  for (const colors of [null, [{ code: 'AB', base: '#123456', line: '#123456' }],
    [...DEFAULT_FABRIC_COLORS, { ...DEFAULT_FABRIC_COLORS[0], code: 'wbk' }],
    [{ code: 'ABC', base: '#fff', line: '#123456' }], [{ code: 'ABC', base: '#123456', line: 'red' }]]) assert.throws(() => readFabricColors(colors));
});

test('local save requires server confirmation and never stores failed changes', async () => {
  const calls = [];
  let confirmed = false;
  const store = createFabricColorStore({ location: { hostname: '127.0.0.1' }, fetch: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => options.method ? { saved: confirmed } : DEFAULT_FABRIC_COLORS };
  } });
  assert.deepEqual(await store.load(), DEFAULT_FABRIC_COLORS);
  await assert.rejects(store.save(DEFAULT_FABRIC_COLORS), /未保存/);
  confirmed = true;
  assert.deepEqual(await store.save(DEFAULT_FABRIC_COLORS), DEFAULT_FABRIC_COLORS);
  assert.equal(calls.at(-1).url, './__form_fabric_colors');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), DEFAULT_FABRIC_COLORS);
  assert.deepEqual(await store.save([]), []);
  assert.equal(calls.at(-1).options.body, '[]');
});

test('local failures distinguish invalid input, old servers, write errors and disconnections', async () => {
  let status = 400, disconnected = false;
  const store = createFabricColorStore({ location: { hostname: 'localhost' }, fetch: async () => {
    if (disconnected) throw new TypeError('fetch failed');
    return { ok: false, status, json: async () => ({ error: 'Failure' }) };
  } });
  await assert.rejects(store.save(DEFAULT_FABRIC_COLORS), /校验未通过/);
  status = 404; await assert.rejects(store.save(DEFAULT_FABRIC_COLORS), /不支持色号保存/);
  status = 500; await assert.rejects(store.save(DEFAULT_FABRIC_COLORS), /无法写入配置文件/);
  disconnected = true; await assert.rejects(store.save(DEFAULT_FABRIC_COLORS), /无法连接本地服务/);
});

test('cloud overrides deployed colors and read/write failures cannot report a successful save', async () => {
  let data = null, error = null, fileReads = 0;
  const cloudColors = [{ code: 'ABC', base: '#112233', line: '#aabbcc' }];
  const query = { select() { return this; }, eq() { return this; }, upsert() { return this; },
    maybeSingle: async () => ({ data, error }), single: async () => ({ data, error }) };
  const store = createFabricColorStore({ location: { hostname: 'spenic.test' }, access: async () => ({ client: { from: () => query } }),
    fetch: async () => { fileReads++; return { ok: true, json: async () => DEFAULT_FABRIC_COLORS }; } });
  assert.deepEqual(await store.load(), DEFAULT_FABRIC_COLORS);
  data = { colors: cloudColors }; assert.deepEqual(await store.load(), cloudColors); assert.equal(fileReads, 1);
  assert.deepEqual(await store.save(cloudColors), cloudColors);
  data = { colors: [] }; assert.deepEqual(await store.save([]), []);
  assert.deepEqual(await store.load(), []); assert.equal(fileReads, 1);
  data = null; await assert.rejects(store.save(cloudColors), /保存确认/);
  error = { code: '42501' }; await assert.rejects(store.save(cloudColors), /权限/); await assert.rejects(store.load(), /读取失败/);
  error = { code: 'PGRST205' }; assert.deepEqual(await store.load(), DEFAULT_FABRIC_COLORS); await assert.rejects(store.save(cloudColors), /尚未初始化/);
});

test('shared runtime ignores stale loads and publishes only confirmed saves', async () => {
  const oldFetch = globalThis.fetch, oldLocation = globalThis.location;
  const requests = [], updates = [];
  globalThis.location = { hostname: 'localhost' };
  globalThis.fetch = (url, options) => new Promise(resolve => requests.push({ url, options, resolve }));
  try {
    const runtime = await import('../shared/fabric-color-store.js?runtime-check');
    runtime.subscribeFabricColors(() => updates.push(runtime.fabricColors()));
    const old = runtime.refreshFabricColors(), fresh = runtime.refreshFabricColors({ force: true });
    const latest = [{ code: 'ABC', base: '#123456', line: '#abcdef' }];
    requests[1].resolve({ ok: true, json: async () => latest }); await fresh;
    requests[0].resolve({ ok: true, json: async () => DEFAULT_FABRIC_COLORS }); await old;
    assert.deepEqual(runtime.fabricColors(), latest); assert.equal(updates.length, 1);
    const beforeSave = runtime.refreshFabricColors();
    const next = [{ code: 'XYZ', base: '#112233', line: '#445566' }];
    const saving = runtime.saveFabricColors(next);
    requests[3].resolve({ ok: true, json: async () => ({ saved: true }) }); await saving;
    requests[2].resolve({ ok: true, json: async () => latest }); await beforeSave;
    assert.deepEqual(runtime.fabricColors(), next);
    const failing = runtime.saveFabricColors(latest);
    requests[4].resolve({ ok: false, json: async () => ({ saved: false }) });
    await assert.rejects(failing, /未保存/); assert.deepEqual(runtime.fabricColors(), next);
    assert.equal(updates.length, 2);
  } finally { globalThis.fetch = oldFetch; globalThis.location = oldLocation; }
});

test('site colors are shared across readers, validated in SQL and only writable by authorized developers', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$; grant usage on schema auth to anon, authenticated;");
    const schema = await readFile(new URL('../supabase/fabric-colors.sql', import.meta.url), 'utf8');
    await db.exec(schema); await db.exec(schema);
    const login = async (role, claims = {}) => {
      await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]); await db.exec('set role ' + role);
    };
    const save = colors => db.query("insert into spenic_fabric_colors(id,colors) values('site',$1::jsonb) on conflict(id) do update set colors=excluded.colors returning colors", [JSON.stringify(colors)]);
    await login('authenticated', { user_metadata: { spenic_developer: true } }); await assert.rejects(save(DEFAULT_FABRIC_COLORS), /row-level security/);
    await login('authenticated', { app_metadata: { spenic_developer: true } });
    assert.deepEqual((await save(DEFAULT_FABRIC_COLORS)).rows[0].colors, DEFAULT_FABRIC_COLORS);
    const next = [...DEFAULT_FABRIC_COLORS, { code: 'ABC', base: '#123456', line: '#abcdef' }];
    assert.deepEqual((await save(next)).rows[0].colors, next);
    for (const invalid of [{}, [{ code: 'ab', base: '#123456', line: '#123456' }],
      [...next, next[0]], [{ code: 'ABC', base: '#fff', line: '#123456' }], [{ code: 'ABC', base: '#123456' }]]) await assert.rejects(save(invalid), /check constraint/);
    await login('anon'); assert.deepEqual((await db.query('select colors from spenic_fabric_colors')).rows[0].colors, next);
    await assert.rejects(save(next), /permission denied/);
    await login('authenticated'); assert.deepEqual((await db.query('select colors from spenic_fabric_colors')).rows[0].colors, next);
    await assert.rejects(save(next), /row-level security/);
    await assert.rejects(save([]), /row-level security/);
    await login('authenticated', { app_metadata: { spenic_developer: true } });
    assert.deepEqual((await save([])).rows[0].colors, []);
    await login('anon'); assert.deepEqual((await db.query('select colors from spenic_fabric_colors')).rows[0].colors, []);
  } finally { await db.close(); }
});
