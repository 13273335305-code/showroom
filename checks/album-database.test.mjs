import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('private album isolates metadata and files alongside public asset policies', async () => {
  const db = new PGlite();
  const alice = '11111111-1111-1111-1111-111111111111', bob = '22222222-2222-2222-2222-222222222222';
  const id = '33333333-3333-3333-3333-333333333333', bucket = 'spenic-album-photos';
  const image = alice + '/' + id + '/image.png', thumbnail = alice + '/' + id + '/thumbnail.png';
  try {
    await db.exec([
      'create role anon; create role authenticated; create schema auth; create schema storage;',
      'create table auth.users(id uuid primary key);',
      "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;",
      'create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);',
      'create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);',
      "create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;",
      'alter table storage.objects enable row level security;',
      'grant usage on schema auth,storage to authenticated;',
      'grant select,insert,update,delete on storage.objects to authenticated;'
    ].join('\n'));
    await db.query('insert into auth.users values($1),($2)', [alice, bob]);
    for (const script of ['project-library.sql', 'asset-library.sql', 'album.sql', 'album.sql']) {
      await db.exec(await readFile(new URL('../supabase/' + script, import.meta.url), 'utf8'));
    }
    // Model an album initialized before source metadata existed.
    await db.exec('alter table spenic_album_photos drop column source');
    await db.query('insert into spenic_album_photos(id,owner_id,name,width,height,bytes,image_path,thumbnail_path) values($1,$2,$3,1920,1080,3,$4,$5)',
      [id,alice,'AI-2026-10-17-204248-176-4K.png',image,thumbnail]);
    const albumSql=await readFile(new URL('../supabase/album.sql',import.meta.url),'utf8');
    await db.exec(albumSql); await db.exec(albumSql);
    assert.equal((await db.query('select source from spenic_album_photos where id=$1',[id])).rows[0].source,'ai');
    await assert.rejects(db.query('update spenic_album_photos set source=$1 where id=$2',['invalid',id]),/check constraint/);
    await db.query('delete from spenic_album_photos where id=$1',[id]);
    assert.equal((await db.query('select public from storage.buckets where id=$1', [bucket])).rows[0].public, false);
    const login = async user => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
    };
    const insert = (owner = alice, photoId = id, path = image) => db.query(
      'insert into spenic_album_photos(id,owner_id,name,width,height,bytes,image_path,thumbnail_path) values($1,$2,$3,1920,1080,3,$4,$5) returning *',
      [photoId, owner, 'private.png', path, owner + '/' + photoId + '/thumbnail.png']);
    await login(alice);
    for (const path of [image, thumbnail]) await db.query('insert into storage.objects(bucket_id,name) values($1,$2) returning *', [bucket, path]);
    assert.equal((await insert()).rows[0].source,'capture');
    assert.equal((await db.query('select * from spenic_album_photos')).rows.length, 1);
    assert.equal((await db.query('select * from storage.objects where bucket_id=$1', [bucket])).rows.length, 2);
    await assert.rejects(insert(alice, crypto.randomUUID(), bob + '/forged.png'), /check constraint/);
    await assert.rejects(db.query('update spenic_album_photos set owner_id=$1 where id=$2', [bob, id]), /permission denied/);
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [bucket, alice + '/invalid.png']), /row-level security/);
    await login(bob);
    assert.equal((await db.query('select * from spenic_album_photos')).rows.length, 0);
    assert.equal((await db.query('select * from storage.objects where bucket_id=$1', [bucket])).rows.length, 0);
    assert.equal((await db.query('delete from spenic_album_photos where id=$1 returning *', [id])).rows.length, 0);
    assert.equal((await db.query('delete from storage.objects where bucket_id=$1 returning *', [bucket])).rows.length, 0);
    await assert.rejects(insert(), /row-level security/);
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [bucket, image]), /row-level security/);
    assert.equal((await db.query('select public.spenic_can_read_resource($1) as allowed', [image])).rows[0].allowed, false);
    await db.exec('reset role; grant usage on schema auth,storage to anon; grant select on storage.objects to anon; set role anon');
    await assert.rejects(db.query('select * from spenic_album_photos'), /permission denied/);
    assert.equal((await db.query('select * from storage.objects where bucket_id=$1', [bucket])).rows.length, 0);
    await login(alice);
    assert.equal((await db.query('delete from spenic_album_photos where id=$1 returning *', [id])).rows.length, 1);
    assert.equal((await db.query('delete from storage.objects where bucket_id=$1 returning *', [bucket])).rows.length, 2);
  } finally { await db.close(); }
});

