import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('site endpoint is shared; account keys are isolated by enforced database permissions', async () => {
 const db=new PGlite(),alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
 try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
   create table auth.users(id uuid primary key);
   create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
   create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
   grant usage on schema auth to authenticated;
  `);
  await db.query('insert into auth.users values($1),($2)',[alice,bob]);
  const schema=await readFile(new URL('../supabase/capture-ai.sql',import.meta.url),'utf8');
  await db.exec(schema);await db.exec(schema);
  const login=async (id,extra={})=>{
   await db.exec('reset role');
   await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,...extra})]);
   await db.exec('set role '+(id?'authenticated':'anon'));
  };
  const saveKey=(owner,key)=>db.query(`insert into spenic_capture_ai_accounts(owner_id,api_key,preferences) values($1,$2,'{"model":"gemini-3-pro-image"}') on conflict(owner_id) do update set owner_id=excluded.owner_id, api_key=excluded.api_key,preferences=excluded.preferences returning owner_id`,[owner,key]);
  const saveBase=base=>db.query("insert into spenic_capture_ai_site(id,base) values('site',$1) on conflict(id) do update set id=excluded.id,base=excluded.base returning base",[base]);
  await login(alice);await saveKey(alice,'alice-test-key');await saveKey(alice,'alice-updated-key');
  await assert.rejects(saveKey(bob,'wrong-account-key'),/row-level security/);
  await assert.rejects(saveBase('https://shared.example'),/row-level security/);
  await login(bob);assert.deepEqual((await db.query('select api_key from spenic_capture_ai_accounts')).rows,[]);
  await saveKey(bob,'bob-test-key');
  assert.equal((await db.query('select api_key from spenic_capture_ai_accounts')).rows[0].api_key,'bob-test-key');
  assert.deepEqual((await db.query('update spenic_capture_ai_accounts set api_key=$1 where owner_id=$2 returning owner_id',['overwrite',alice])).rows,[]);
  assert.deepEqual((await db.query('delete from spenic_capture_ai_accounts where owner_id=$1 returning owner_id',[alice])).rows,[]);
  await assert.rejects(db.query('update spenic_capture_ai_accounts set owner_id=$1 where owner_id=$2',[alice,bob]),/row-level security/);
  await login(bob,{user_metadata:{spenic_developer:true}});
  await assert.rejects(saveBase('https://shared.example'),/row-level security/);
  await login(bob,{app_metadata:{spenic_developer:true}});await saveBase('https://shared.example/v1beta');
  await assert.rejects(saveBase('https://user:secret@shared.example'),/check constraint/);
  await assert.rejects(saveBase('https://shared.example?key=secret'),/check constraint/);
  await login(alice);
  assert.equal((await db.query('select base from spenic_capture_ai_site')).rows[0].base,'https://shared.example/v1beta');
  assert.deepEqual((await db.query('select owner_id,api_key from spenic_capture_ai_accounts')).rows,[{owner_id:alice,api_key:'alice-updated-key'}]);
  await assert.rejects(db.query("update spenic_capture_ai_accounts set preferences='{" + '"apiKey":"should-not-be-in-preferences"' + "}'"),/check constraint/);
  await login(null);
  assert.deepEqual(Object.keys((await db.query('select * from spenic_capture_ai_site')).rows[0]).sort(),['base','id','updated_at']);
  await assert.rejects(db.query('select * from spenic_capture_ai_accounts'),/permission denied/);
 }finally{await db.close()}
});
