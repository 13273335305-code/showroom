begin;

create table if not exists public.spenic_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  kind text not null check (kind in ('material', 'texture', 'model', 'folder')),
  name text not null check (length(trim(name)) between 1 and 120),
  category text not null default '',
  library text not null check (library in ('fabric', 'pattern', 'model')),
  parent_id uuid references public.spenic_assets(id) on delete cascade,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 65536),
  manifest jsonb,
  thumbnail_path text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((kind = 'folder' and manifest is null) or (kind <> 'folder' and manifest is not null
    and manifest->>'format' = 'SPENIC-ASSET' and manifest->>'version' = '1' and jsonb_typeof(manifest->'files') = 'object'))
);
create index if not exists spenic_assets_parent on public.spenic_assets(parent_id);
create index if not exists spenic_assets_owner on public.spenic_assets(owner_id);
create table if not exists public.spenic_asset_files (
  asset_id uuid not null references public.spenic_assets(id) on delete cascade,
  storage_path text not null references public.spenic_resource_files(storage_path),
  primary key (asset_id, storage_path)
);
create index if not exists spenic_asset_files_path on public.spenic_asset_files(storage_path);
create table if not exists public.spenic_asset_favorites (
  owner_id uuid not null references auth.users(id),
  asset_id text not null check (length(asset_id) between 1 and 128),
  primary key (owner_id, asset_id)
);
alter table public.spenic_assets enable row level security;
alter table public.spenic_asset_files enable row level security;
alter table public.spenic_asset_favorites enable row level security;

create or replace function public.spenic_can_read_asset_resource(resource_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists(select 1 from public.spenic_asset_files where storage_path = resource_path);
$$;
revoke all on function public.spenic_can_read_asset_resource(text) from public, anon;
grant execute on function public.spenic_can_read_asset_resource(text) to authenticated;
create or replace function public.spenic_can_read_resource(resource_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists(select 1 from public.spenic_resource_files f where f.storage_path = resource_path and f.owner_id = auth.uid())
    or exists(select 1 from public.spenic_project_files f join public.spenic_projects p on p.id = f.project_id
      where f.storage_path = resource_path and (p.owner_id = auth.uid() or p.visibility = 'public'))
    or public.spenic_can_read_asset_resource(resource_path)
  );
$$;
revoke all on function public.spenic_can_read_resource(text) from public, anon;
grant execute on function public.spenic_can_read_resource(text) to authenticated;

drop policy if exists spenic_assets_read on public.spenic_assets;
create policy spenic_assets_read on public.spenic_assets for select to authenticated using (true);
drop policy if exists spenic_assets_delete on public.spenic_assets;
create policy spenic_assets_delete on public.spenic_assets for delete to authenticated using (owner_id = auth.uid());
drop policy if exists spenic_asset_files_read on public.spenic_asset_files;
create policy spenic_asset_files_read on public.spenic_asset_files for select to authenticated using (true);
drop policy if exists spenic_favorites_read on public.spenic_asset_favorites;
create policy spenic_favorites_read on public.spenic_asset_favorites for select to authenticated using (owner_id = auth.uid());
drop policy if exists spenic_favorites_insert on public.spenic_asset_favorites;
create policy spenic_favorites_insert on public.spenic_asset_favorites for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists spenic_favorites_delete on public.spenic_asset_favorites;
create policy spenic_favorites_delete on public.spenic_asset_favorites for delete to authenticated using (owner_id = auth.uid());
grant select, delete on public.spenic_assets to authenticated;
revoke insert, update on public.spenic_assets from authenticated;
grant select on public.spenic_asset_files to authenticated;
revoke insert, update, delete on public.spenic_asset_files from authenticated;
grant select, insert, delete on public.spenic_asset_favorites to authenticated;
revoke update on public.spenic_asset_favorites from authenticated;
revoke all on public.spenic_assets, public.spenic_asset_files, public.spenic_asset_favorites from anon;

-- Keep the initial upload readable before its asset or resource record exists.
drop policy if exists spenic_resources_read on public.spenic_resource_files;
create policy spenic_resources_read on public.spenic_resource_files for select to authenticated using (
  owner_id = auth.uid() or public.spenic_can_read_resource(storage_path)
);
drop policy if exists spenic_storage_read on storage.objects;
create policy spenic_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'spenic-project-resources' and (
    (storage.foldername(name))[1] = auth.uid()::text or public.spenic_can_read_resource(name)
  )
);

create or replace function public.spenic_save_asset(asset_data jsonb, expected_revision timestamptz default null)
returns setof public.spenic_assets language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  target_id uuid := (asset_data->>'id')::uuid;
  target_parent uuid := (asset_data->>'parent_id')::uuid;
  old_row public.spenic_assets;
  next_manifest jsonb := asset_data->'manifest';
  resource_ref jsonb;
  resource_path text;
  resource_paths text[] := '{}';
begin
  if current_user_id is null then raise exception 'Login required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(target_id::text, 2));
  select * into old_row from public.spenic_assets where id = target_id for update;
  if found then
    if old_row.owner_id <> current_user_id then raise exception 'Asset owner required' using errcode = '42501'; end if;
    if old_row.kind <> asset_data->>'kind' then raise exception 'Asset kind cannot change'; end if;
    if expected_revision is null or old_row.updated_at <> expected_revision then raise exception 'Asset changed' using errcode = '40001'; end if;
  elsif expected_revision is not null then raise exception 'Asset removed' using errcode = '40001'; end if;
  if target_parent is not null then
    if not exists(select 1 from public.spenic_assets where id = target_parent and owner_id = current_user_id
      and kind = 'folder' and library = asset_data->>'library') then raise exception 'Invalid asset folder' using errcode = '42501'; end if;
    if target_id = target_parent or exists(
      with recursive parents as (
        select id, parent_id from public.spenic_assets where id = target_parent
        union all select p.id, p.parent_id from public.spenic_assets p join parents a on p.id = a.parent_id
      ) select 1 from parents where id = target_id
    ) then raise exception 'Folder cycle'; end if;
  end if;
  if asset_data->>'kind' <> 'folder' then
    if next_manifest is null or next_manifest->>'format' is distinct from 'SPENIC-ASSET' or next_manifest->>'version' is distinct from '1'
      or jsonb_typeof(next_manifest->'files') is distinct from 'object' or octet_length(next_manifest::text) > 4194304
      then raise exception 'Invalid asset manifest'; end if;
    for resource_ref in select value from jsonb_each(next_manifest->'files') loop
      resource_path := resource_ref->>'path';
      if resource_ref->>'kind' is distinct from 'cloud' or not public.spenic_can_read_resource(resource_path) or not exists (
        select 1 from public.spenic_resource_files f join storage.objects o on o.name = f.storage_path and o.bucket_id = 'spenic-project-resources'
        where f.storage_path = resource_path and f.hash = resource_ref->>'hash' and f.bytes = (resource_ref->>'size')::bigint
      ) then raise exception 'Invalid asset resource' using errcode = '42501'; end if;
      resource_paths := array_append(resource_paths, resource_path);
    end loop;
    resource_path := asset_data->>'thumbnail_path';
    if resource_path is not null and not resource_path = any(resource_paths) then raise exception 'Invalid thumbnail' using errcode = '42501'; end if;
  end if;
  insert into public.spenic_assets(id, owner_id, kind, name, category, library, parent_id, metadata, manifest, thumbnail_path)
  values(target_id, current_user_id, asset_data->>'kind', trim(asset_data->>'name'), coalesce(asset_data->>'category', ''),
    asset_data->>'library', target_parent, coalesce(asset_data->'metadata', '{}'::jsonb),
    case when asset_data->>'kind' = 'folder' then null else next_manifest end, asset_data->>'thumbnail_path')
  on conflict(id) do update set name = excluded.name, category = excluded.category, library = excluded.library,
    parent_id = excluded.parent_id, metadata = excluded.metadata, manifest = excluded.manifest,
    thumbnail_path = excluded.thumbnail_path, updated_at = clock_timestamp();
  delete from public.spenic_asset_files where asset_id = target_id;
  insert into public.spenic_asset_files(asset_id, storage_path) select target_id, path from unnest(resource_paths) path on conflict do nothing;
  return query select * from public.spenic_assets where id = target_id;
end;
$$;
revoke all on function public.spenic_save_asset(jsonb, timestamptz) from public, anon;
grant execute on function public.spenic_save_asset(jsonb, timestamptz) to authenticated;

commit;
