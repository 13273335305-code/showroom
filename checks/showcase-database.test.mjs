import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('showcase ownership, revisions, share revocation, project feedback and photo links are enforced in PostgreSQL', async () => {
  const db = new PGlite();
  const alice = '11111111-1111-1111-1111-111111111111', bob = '22222222-2222-2222-2222-222222222222';
  const project = '33333333-3333-3333-3333-333333333333', showroom = '44444444-4444-4444-4444-444444444444';
  const otherShow = '55555555-5555-5555-5555-555555555555', hash = 'a'.repeat(64), token = 'b'.repeat(64);
  const path = alice + '/' + hash;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage;
      create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
      alter table storage.objects enable row level security; grant usage on schema auth,storage to authenticated;
      grant select,insert,update,delete on storage.objects to authenticated;`);
    await db.query('insert into auth.users values($1),($2)', [alice, bob]);
    for (const name of ['project-library.sql', 'album.sql', 'showcase.sql', 'showcase.sql', 'album.sql']) await db.exec(await readFile(new URL('../supabase/' + name, import.meta.url), 'utf8'));
    async function login(user) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']); await db.exec('set role ' + (user ? 'authenticated' : 'anon')); }
    await login(alice);
    await db.query('insert into spenic_resource_files values($1,$2,$3,3,$4,clock_timestamp())', [alice, hash, path, 'model/gltf-binary']);
    await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['spenic-project-resources', path]);
    const data = { id: project, name: '方案甲', kind: 'project', visibility: 'personal', manifest: { format: 'SPENIC-PROJECT', version: 1, modelPath: 'model', files: { model: { kind: 'cloud', path, hash, size: 3, name: 'model.glb' } } } };
    await db.query('select spenic_save_project($1::jsonb,null)', [JSON.stringify(data)]);
    const save = async (id, items, revision = null) => (await db.query('select * from spenic_save_showcase($1::jsonb,$2)', [JSON.stringify({ id, name: '客户展示', items }), revision])).rows[0];
    const first = await save(showroom, [{ projectId: project, config: { scene: { exposure: 1.2 } } }]);
    await assert.rejects(save(showroom, []), /Showcase changed/);
    const next = await save(showroom, [{ projectId: project }], first.updated_at);
    await db.query('select spenic_set_showcase_share($1,$2,true)', [showroom, token]);
    await login(bob);
    assert.equal((await db.query('select * from spenic_showcases')).rows.length, 0);
    await assert.rejects(save(showroom, [], next.updated_at), /Owner required/);
    await assert.rejects(save(otherShow, [{ projectId: project }]), /owned projects/);
    await login(); await assert.rejects(db.query('select * from spenic_showcases'), /permission denied/);
    await assert.rejects(db.query('select * from spenic_project_comments'), /permission denied/);
    await login(alice);
    const comment = { projectId: project, requestId: crypto.randomUUID(), authorName: '客户甲', body: '请看这里', modelHash: hash, host: 0, point: [1, 2, 3] };
    const submit = async (value = comment, share = token) => (await db.query('select * from spenic_submit_project_comment($1::jsonb,$2)', [JSON.stringify(value), share])).rows[0];
    const posted = await submit(); assert.equal(posted.author_name, '客户甲'); assert.equal((await submit()).id, posted.id);
    const authorHash = 'e'.repeat(64), owned = await submit({ ...comment, requestId: crypto.randomUUID(), authorHash });
    await assert.rejects(submit({ ...comment, requestId: owned.request_id, authorHash: 'f'.repeat(64) }), /already used/);
    async function guestDelete(id, share = token, author = authorHash, targetProject = project) {
      await db.exec('reset role; set role service_role');
      try { await db.query('select spenic_delete_guest_comment($1,$2,$3,$4)', [targetProject, id, share, author]); }
      finally { await login(alice); }
    }
    await assert.rejects(guestDelete(owned.id, token, 'f'.repeat(64)), /not owned/);
    await assert.rejects(guestDelete(owned.id, token, null), /author required/);
    await assert.rejects(guestDelete(owned.id, token, authorHash, otherShow), /Share unavailable/);
    await assert.rejects(guestDelete(posted.id), /not owned/, 'legacy comments cannot be claimed by a matching name');
    await login();
    await assert.rejects(db.query('select spenic_delete_guest_comment($1,$2,$3,$4)', [project, owned.id, token, authorHash]), /permission denied/);
    await login(bob);
    await assert.rejects(db.query('select spenic_delete_guest_comment($1,$2,$3,$4)', [project, owned.id, token, authorHash]), /permission denied/);
    await login(alice);
    await assert.rejects(submit({ ...comment, body: 'different' }), /already used/);
    await assert.rejects(submit({ ...comment, requestId: crypto.randomUUID(), point: [null, 0, 0] }), /Invalid point/);
    await db.query('select spenic_set_showcase_share($1,null,false)', [showroom]);
    await assert.rejects(guestDelete(owned.id), /Share unavailable/);
    await assert.rejects(submit({ ...comment, requestId: crypto.randomUUID() }), /Share unavailable/);
    await db.query('select spenic_set_showcase_share($1,$2,true)', [showroom, 'c'.repeat(64)]);
    await assert.rejects(guestDelete(owned.id), /Share unavailable/);
    await assert.rejects(submit(), /Share unavailable/);
    const second = await save(otherShow, [{ projectId: project }]);
    await db.query('select spenic_set_showcase_share($1,$2,true)', [otherShow, 'd'.repeat(64)]);
    await submit({ ...comment, requestId: crypto.randomUUID(), authorName: '客户乙' }, 'd'.repeat(64));
    await guestDelete(owned.id, 'd'.repeat(64));
    await assert.rejects(guestDelete(owned.id, 'd'.repeat(64)), /not owned/);
    assert.equal((await db.query('select * from spenic_project_comments where project_id=$1', [project])).rows.length, 2);
    await save(otherShow, [], second.updated_at);
    await assert.rejects(guestDelete(posted.id, 'd'.repeat(64)), /Share unavailable/);
    await assert.rejects(submit({ ...comment, requestId: crypto.randomUUID() }, 'd'.repeat(64)), /Share unavailable/);
    const photo = crypto.randomUUID();
    await db.query('insert into spenic_album_photos(id,name,width,height,bytes,image_path,thumbnail_path,project_id) values($1,$2,1,1,3,$3,$4,$5)', [photo, 'photo.png', alice + '/' + photo + '/image.png', alice + '/' + photo + '/thumbnail.png', project]);
    await login(bob); const foreignPhoto = crypto.randomUUID();
    await assert.rejects(db.query('insert into spenic_album_photos(id,name,width,height,bytes,image_path,thumbnail_path,project_id) values($1,$2,1,1,3,$3,$4,$5)', [foreignPhoto, 'bad.png', bob + '/' + foreignPhoto + '/image.png', bob + '/' + foreignPhoto + '/thumbnail.png', project]), /row-level security/);
    assert.equal((await db.query("select to_regprocedure('public.spenic_reposition_project_comment(uuid,text,integer,jsonb)') as removed")).rows[0].removed, null);
    await login(alice); await db.query('delete from spenic_projects where id=$1', [project]);
    assert.equal((await db.query('select project_id from spenic_album_photos where id=$1', [photo])).rows[0].project_id, null);
    assert.equal((await db.query('select * from spenic_project_comments')).rows.length, 0);
  } finally { await db.close(); }
});
