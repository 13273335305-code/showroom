import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('global default views are readable by visitors and writable only by server-authorized developers', async () => {
  const db = new PGlite();
  const design = JSON.parse(await readFile(new URL('../design-default-view.json', import.meta.url), 'utf8'));
  const parts = JSON.parse(await readFile(new URL('../parts-default-view.json', import.meta.url), 'utf8'));
  try {
    await db.exec("create role anon; create role authenticated; create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$; grant usage on schema auth to anon, authenticated;");
    const schema = await readFile(new URL('../supabase/default-camera.sql', import.meta.url), 'utf8');
    await db.exec(schema);
    await db.exec(schema);
    const login = async (role, claims = {}) => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
      await db.exec('set role ' + role);
    };
    const save = async (page, config) => db.query('insert into public.spenic_default_camera_views(page,config) values($1,$2::jsonb) on conflict(page) do update set config=excluded.config returning config', [page, JSON.stringify(config)]);
    await login('anon');
    assert.deepEqual((await db.query('select * from spenic_default_camera_views')).rows, []);
    await assert.rejects(save('design', design), /permission denied/);
    await login('authenticated', { user_metadata: { spenic_developer: true } });
    await assert.rejects(save('design', design), /row-level security/);
    await login('authenticated', { app_metadata: { spenic_developer: true } });
    assert.deepEqual((await save('design', design)).rows[0].config, design);
    await save('parts', parts);
    const first = (await db.query("select updated_at from spenic_default_camera_views where page='design'")).rows[0].updated_at;
    const changed = { ...design, view: { ...design.view, azimuth: -35 } };
    assert.deepEqual((await save('design', changed)).rows[0].config, changed);
    const second = (await db.query("select updated_at from spenic_default_camera_views where page='design'")).rows[0].updated_at;
    assert.ok(new Date(second).getTime() >= new Date(first).getTime());
    for (const invalid of [
      { ...design, version: 2 }, { ...design, version: '1' },
      { ...design, view: { ...design.view, distance: -2 } },
      { ...design, view: { ...design.view, offset: [0, 0] } },
      { ...design, view: { ...design.view, offset: [0, 0, '3'] } },
      { ...design, view: { ...design.view, azimuth: 181 } },
      { ...design, view: { ...design.view, framing: 0.3 } },
    ]) await assert.rejects(save('design', invalid), /check constraint/);
    await assert.rejects(save('parts', design), /check constraint/);
    await assert.rejects(db.query("delete from spenic_default_camera_views where page='design'"), /permission denied/);
    await login('authenticated', {});
    await assert.rejects(save('design', design), /row-level security/);
    assert.deepEqual((await db.query("select config from spenic_default_camera_views where page='design'")).rows[0].config, changed);
    await login('anon');
    const rows = (await db.query('select page,config from spenic_default_camera_views order by page')).rows;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { page: 'design', config: changed });
    assert.deepEqual(rows[1], { page: 'parts', config: parts });
  } finally { await db.close(); }
});
