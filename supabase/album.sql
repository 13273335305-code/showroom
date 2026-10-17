begin;

-- Separate from the public asset bucket so photos cannot become public assets.
insert into storage.buckets(id, name, public, file_size_limit)
values ('spenic-album-photos', 'spenic-album-photos', false, 268435456)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create table if not exists public.spenic_album_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 180),
  width integer not null check (width between 1 and 8192),
  height integer not null check (height between 1 and 8192),
  transparent boolean not null default false,
  bytes bigint not null check (bytes > 0 and bytes <= 268435456),
  image_path text not null unique,
  thumbnail_path text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  check (image_path = owner_id::text || '/' || id::text || '/image.png'),
  check (thumbnail_path = owner_id::text || '/' || id::text || '/thumbnail.png')
);
-- Upgrade existing albums and retain source independently of the visible name.
alter table public.spenic_album_photos add column if not exists source text not null default 'capture' check (source in ('capture', 'ai'));
update public.spenic_album_photos set source = 'ai'
where source = 'capture' and name ~* '^AI-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-[0-9]{3}(-[a-z0-9_.-]+)?(\.png)?$';
create index if not exists spenic_album_owner_created on public.spenic_album_photos(owner_id, created_at desc, id desc);
alter table public.spenic_album_photos enable row level security;
revoke all on public.spenic_album_photos from public, anon, authenticated;
grant select, insert, delete on public.spenic_album_photos to authenticated;

drop policy if exists spenic_album_read on public.spenic_album_photos;
create policy spenic_album_read on public.spenic_album_photos for select to authenticated using (owner_id = auth.uid());
drop policy if exists spenic_album_insert on public.spenic_album_photos;
create policy spenic_album_insert on public.spenic_album_photos for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists spenic_album_delete on public.spenic_album_photos;
create policy spenic_album_delete on public.spenic_album_photos for delete to authenticated using (owner_id = auth.uid());

drop policy if exists spenic_album_storage_read on storage.objects;
create policy spenic_album_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'spenic-album-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists spenic_album_storage_insert on storage.objects;
create policy spenic_album_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'spenic-album-photos' and (storage.foldername(name))[1] = auth.uid()::text
  and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/(image|thumbnail)\.png$'
);
drop policy if exists spenic_album_storage_delete on storage.objects;
create policy spenic_album_storage_delete on storage.objects for delete to authenticated using (
  bucket_id = 'spenic-album-photos' and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
