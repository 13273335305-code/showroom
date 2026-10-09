begin;

create table if not exists public.spenic_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  kind text not null check (kind in ('project', 'folder')),
  name text not null check (length(trim(name)) between 1 and 120),
  model_name text not null default '',
  parent_id uuid references public.spenic_projects(id) on delete cascade,
  visibility text not null default 'personal' check (visibility in ('personal', 'public')),
  manifest jsonb,
  thumbnail_path text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((kind = 'folder' and manifest is null) or
    (kind = 'project' and manifest->>'format' = 'SPENIC-PROJECT' and manifest->>'version' = '1' and jsonb_typeof(manifest->'files') = 'object'))
);
create index if not exists spenic_projects_owner_parent on public.spenic_projects(owner_id, parent_id);
create index if not exists spenic_projects_visibility on public.spenic_projects(visibility);

create table if not exists public.spenic_resource_files (
  owner_id uuid not null references auth.users(id),
  hash text not null check (hash ~ '^[a-f0-9]{64}$'),
  storage_path text not null unique,
  bytes bigint not null check (bytes > 0 and bytes <= 536870912),
  mime text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, hash),
  check (storage_path = owner_id::text || '/' || hash)
);
create table if not exists public.spenic_project_files (
  project_id uuid not null references public.spenic_projects(id) on delete cascade,
  storage_path text not null references public.spenic_resource_files(storage_path),
  primary key (project_id, storage_path)
);
create index if not exists spenic_project_files_path on public.spenic_project_files(storage_path);

alter table public.spenic_projects enable row level security;
alter table public.spenic_resource_files enable row level security;
alter table public.spenic_project_files enable row level security;

-- Avoid recursive RLS evaluation when checking resource access.
create or replace function public.spenic_can_read_resource(resource_path text)
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and (
    exists(select 1 from public.spenic_resource_files f where f.storage_path = resource_path and f.owner_id = auth.uid())
    or exists(select 1 from public.spenic_project_files f join public.spenic_projects p on p.id = f.project_id
      where f.storage_path = resource_path and (p.owner_id = auth.uid() or p.visibility = 'public'))
  );
$$;
revoke all on function public.spenic_can_read_resource(text) from public, anon;
grant execute on function public.spenic_can_read_resource(text) to authenticated;

drop policy if exists spenic_projects_read on public.spenic_projects;
create policy spenic_projects_read on public.spenic_projects for select to authenticated using (owner_id = auth.uid() or visibility = 'public');
drop policy if exists spenic_projects_delete on public.spenic_projects;
create policy spenic_projects_delete on public.spenic_projects for delete to authenticated using (owner_id = auth.uid());
drop policy if exists spenic_resources_read on public.spenic_resource_files;
create policy spenic_resources_read on public.spenic_resource_files for select to authenticated using (
  owner_id = auth.uid() or public.spenic_can_read_resource(storage_path)
);
drop policy if exists spenic_resources_insert on public.spenic_resource_files;
create policy spenic_resources_insert on public.spenic_resource_files for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists spenic_project_files_read on public.spenic_project_files;
create policy spenic_project_files_read on public.spenic_project_files for select to authenticated using (
  exists(select 1 from public.spenic_projects p where p.id = project_id and (p.owner_id = auth.uid() or p.visibility = 'public'))
);
grant select, delete on public.spenic_projects to authenticated;
grant select, insert on public.spenic_resource_files to authenticated;
grant select on public.spenic_project_files to authenticated;
revoke insert, update on public.spenic_projects from authenticated;
revoke insert, update, delete on public.spenic_project_files from authenticated;
revoke update, delete on public.spenic_resource_files from authenticated;

insert into storage.buckets(id, name, public, file_size_limit)
values ('spenic-project-resources', 'spenic-project-resources', false, 536870912)
on conflict (id) do nothing;
drop policy if exists spenic_storage_read on storage.objects;
create policy spenic_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'spenic-project-resources' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.spenic_can_read_resource(name)
  )
);
drop policy if exists spenic_storage_insert on storage.objects;
create policy spenic_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'spenic-project-resources' and name ~ '^[a-f0-9-]{36}/[a-f0-9]{64}$'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.spenic_save_project(project_data jsonb, expected_revision timestamptz default null)
returns setof public.spenic_projects language plpgsql security definer set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_id uuid := (project_data->>'id')::uuid;
  target_parent uuid := (project_data->>'parent_id')::uuid;
  old_row public.spenic_projects;
  resource_path text;
  resource_ref jsonb;
  resource_paths text[] := '{}';
  next_manifest jsonb := project_data->'manifest';
begin
  if current_user_id is null then raise exception 'Login required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(target_id::text, 1));
  select * into old_row from public.spenic_projects where id = target_id for update;
  if found then
    if old_row.owner_id <> current_user_id then raise exception 'Project owner required' using errcode = '42501'; end if;
    if old_row.kind <> project_data->>'kind' then raise exception 'Project kind cannot change'; end if;
    if expected_revision is null or old_row.updated_at <> expected_revision then raise exception 'Project changed' using errcode = '40001'; end if;
  elsif expected_revision is not null then
    raise exception 'Project removed' using errcode = '40001';
  end if;
  if target_parent is not null then
    if not exists(select 1 from public.spenic_projects where id = target_parent and owner_id = current_user_id and kind = 'folder' and visibility = project_data->>'visibility') then
      raise exception 'Invalid project folder' using errcode = '42501';
    end if;
    if target_id = target_parent or exists(
      with recursive parents as (
        select id, parent_id from public.spenic_projects where id = target_parent
        union all select p.id, p.parent_id from public.spenic_projects p join parents a on p.id = a.parent_id
      ) select 1 from parents where id = target_id
    ) then raise exception 'Folder cycle'; end if;
  end if;
  if project_data->>'kind' = 'project' then
    if next_manifest is null or next_manifest->>'format' is distinct from 'SPENIC-PROJECT' or next_manifest->>'version' is distinct from '1'
      or jsonb_typeof(next_manifest->'files') is distinct from 'object' or octet_length(next_manifest::text) > 4194304
      then raise exception 'Invalid project manifest'; end if;
    for resource_ref in select value from jsonb_each(next_manifest->'files') loop
      if resource_ref->>'kind' = 'cloud' then
        resource_path := resource_ref->>'path';
        if not public.spenic_can_read_resource(resource_path) or not exists (
          select 1 from public.spenic_resource_files f join storage.objects o on o.name = f.storage_path and o.bucket_id = 'spenic-project-resources'
          where f.storage_path = resource_path and f.hash = resource_ref->>'hash' and f.bytes = (resource_ref->>'size')::bigint
        ) then raise exception 'Invalid project resource' using errcode = '42501'; end if;
        resource_paths := array_append(resource_paths, resource_path);
      elsif resource_ref->>'kind' is distinct from 'runtime' then raise exception 'Invalid resource kind'; end if;
    end loop;
    resource_path := project_data->>'thumbnail_path';
    if resource_path is not null then
      if not public.spenic_can_read_resource(resource_path) or not exists (
        select 1 from storage.objects where bucket_id = 'spenic-project-resources' and name = resource_path
      ) then raise exception 'Invalid thumbnail' using errcode = '42501'; end if;
      resource_paths := array_append(resource_paths, resource_path);
    end if;
  end if;
  insert into public.spenic_projects(id, owner_id, kind, name, model_name, parent_id, visibility, manifest, thumbnail_path)
  values (target_id, current_user_id, project_data->>'kind', trim(project_data->>'name'), coalesce(project_data->>'model_name', ''), target_parent,
    project_data->>'visibility', case when project_data->>'kind' = 'folder' then null else next_manifest end, project_data->>'thumbnail_path')
  on conflict (id) do update set name = excluded.name, model_name = excluded.model_name, parent_id = excluded.parent_id,
    visibility = excluded.visibility, manifest = excluded.manifest, thumbnail_path = excluded.thumbnail_path, updated_at = clock_timestamp();
  delete from public.spenic_project_files where project_id = target_id;
  insert into public.spenic_project_files(project_id, storage_path) select target_id, path from unnest(resource_paths) path on conflict do nothing;
  return query select * from public.spenic_projects where id = target_id;
end;
$$;
revoke all on function public.spenic_save_project(jsonb, timestamptz) from public, anon;
grant execute on function public.spenic_save_project(jsonb, timestamptz) to authenticated;

create or replace function public.spenic_set_project_visibility(project_id uuid, make_public boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null or not exists(select 1 from public.spenic_projects where id = project_id and owner_id = current_user_id) then
    raise exception 'Project owner required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));
  with recursive children as (
    select id from public.spenic_projects where id = project_id and owner_id = current_user_id
    union all select p.id from public.spenic_projects p join children c on p.parent_id = c.id where p.owner_id = current_user_id
  ) update public.spenic_projects set visibility = case when make_public then 'public' else 'personal' end,
    parent_id = case when id = project_id then null else parent_id end, updated_at = clock_timestamp()
    where id in (select id from children);
end;
$$;
revoke all on function public.spenic_set_project_visibility(uuid, boolean) from public, anon;
grant execute on function public.spenic_set_project_visibility(uuid, boolean) to authenticated;

commit;
