begin;

create table if not exists public.spenic_showcases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists public.spenic_showcase_items (
  showcase_id uuid not null references public.spenic_showcases(id) on delete cascade,
  project_id uuid not null references public.spenic_projects(id) on delete cascade,
  position integer not null check (position >= 0),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 262144),
  primary key(showcase_id, project_id)
);
create table if not exists public.spenic_showcase_shares (
  showcase_id uuid primary key references public.spenic_showcases(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists public.spenic_project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.spenic_projects(id) on delete cascade,
  showcase_id uuid references public.spenic_showcases(id) on delete set null,
  request_id uuid not null,
  author_name text not null check (length(trim(author_name)) between 1 and 40),
  body text not null check (length(trim(body)) between 1 and 300),
  model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
  host integer not null check (host >= 0 and host <= 100000),
  point jsonb not null check (jsonb_typeof(point) = 'array' and jsonb_array_length(point) = 3),
  created_at timestamptz not null default clock_timestamp(),
  unique(project_id, request_id)
);
create index if not exists spenic_project_comments_project on public.spenic_project_comments(project_id, created_at, id);
create index if not exists spenic_showcase_items_project on public.spenic_showcase_items(project_id);
create index if not exists spenic_project_comments_rate on public.spenic_project_comments(showcase_id, created_at);
-- Nullable for existing comments: names alone cannot establish guest ownership.
alter table public.spenic_project_comments add column if not exists author_token_hash text
  check (author_token_hash ~ '^[a-f0-9]{64}$');

alter table public.spenic_album_photos add column if not exists project_id uuid references public.spenic_projects(id) on delete set null;
create index if not exists spenic_album_project_created on public.spenic_album_photos(project_id, created_at desc, id desc);
drop policy if exists spenic_album_insert on public.spenic_album_photos;
create policy spenic_album_insert on public.spenic_album_photos for insert to authenticated with check (
  owner_id = auth.uid() and (project_id is null or exists (
    select 1 from public.spenic_projects p where p.id = project_id and p.owner_id = auth.uid() and p.kind = 'project'
  ))
);

alter table public.spenic_showcases enable row level security;
alter table public.spenic_showcase_items enable row level security;
alter table public.spenic_showcase_shares enable row level security;
alter table public.spenic_project_comments enable row level security;
revoke all on public.spenic_showcases, public.spenic_showcase_items, public.spenic_showcase_shares, public.spenic_project_comments from public, anon, authenticated;
grant select, delete on public.spenic_showcases to authenticated;
grant select on public.spenic_showcase_items, public.spenic_showcase_shares to authenticated;
grant select, delete on public.spenic_project_comments to authenticated;
drop policy if exists spenic_showcases_owner on public.spenic_showcases;
create policy spenic_showcases_owner on public.spenic_showcases to authenticated using (owner_id = auth.uid());
drop policy if exists spenic_showcase_items_owner on public.spenic_showcase_items;
create policy spenic_showcase_items_owner on public.spenic_showcase_items for select to authenticated using (
  exists(select 1 from public.spenic_showcases s where s.id = showcase_id and s.owner_id = auth.uid())
);
drop policy if exists spenic_showcase_shares_owner on public.spenic_showcase_shares;
create policy spenic_showcase_shares_owner on public.spenic_showcase_shares for select to authenticated using (
  exists(select 1 from public.spenic_showcases s where s.id = showcase_id and s.owner_id = auth.uid())
);
drop policy if exists spenic_project_comments_owner on public.spenic_project_comments;
create policy spenic_project_comments_owner on public.spenic_project_comments to authenticated using (
  exists(select 1 from public.spenic_projects p where p.id = project_id and p.owner_id = auth.uid())
);

create or replace function public.spenic_save_showcase(showcase_data jsonb, expected_revision timestamptz default null)
returns public.spenic_showcases language plpgsql security definer set search_path = public as $$
declare target uuid := coalesce((showcase_data->>'id')::uuid, gen_random_uuid()); old public.spenic_showcases;
  saved public.spenic_showcases; item jsonb; i integer := 0;
begin
  if auth.uid() is null then raise exception 'Owner required' using errcode = '42501'; end if;
  select * into old from spenic_showcases where id = target for update;
  if found then
    if old.owner_id <> auth.uid() then raise exception 'Owner required' using errcode = '42501'; end if;
    if expected_revision is distinct from old.updated_at then raise exception 'Showcase changed' using errcode = '40001'; end if;
  elsif expected_revision is not null then raise exception 'Showcase deleted' using errcode = '40001'; end if;
  if jsonb_typeof(showcase_data->'items') is distinct from 'array' or jsonb_array_length(showcase_data->'items') > 200 then raise exception 'Invalid showcase items'; end if;
  insert into spenic_showcases(id, owner_id, name) values(target, auth.uid(), trim(showcase_data->>'name'))
    on conflict(id) do update set name = excluded.name, updated_at = clock_timestamp() returning * into saved;
  delete from spenic_showcase_items where showcase_id = target;
  for item in select value from jsonb_array_elements(showcase_data->'items') loop
    if not exists(select 1 from spenic_projects where id = (item->>'projectId')::uuid and owner_id = auth.uid() and kind = 'project') then
      raise exception 'Only owned projects can be shared' using errcode = '42501';
    end if;
    insert into spenic_showcase_items(showcase_id, project_id, position, config)
      values(target, (item->>'projectId')::uuid, i, coalesce(item->'config', '{}'::jsonb));
    i := i + 1;
  end loop;
  return saved;
end $$;
revoke all on function public.spenic_save_showcase(jsonb, timestamptz) from public, anon;
grant execute on function public.spenic_save_showcase(jsonb, timestamptz) to authenticated;

create or replace function public.spenic_set_showcase_share(target_id uuid, new_hash text, active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from spenic_showcases where id = target_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Owner required' using errcode = '42501'; end if;
  if new_hash is null then
    update spenic_showcase_shares set enabled = active, updated_at = clock_timestamp() where showcase_id = target_id;
  else
    insert into spenic_showcase_shares(showcase_id, token_hash, enabled) values(target_id, new_hash, active)
      on conflict(showcase_id) do update set token_hash = excluded.token_hash, enabled = excluded.enabled, updated_at = clock_timestamp();
  end if;
end $$;
revoke all on function public.spenic_set_showcase_share(uuid, text, boolean) from public, anon;
grant execute on function public.spenic_set_showcase_share(uuid, text, boolean) to authenticated;

create or replace function public.spenic_submit_project_comment(comment_data jsonb, share_hash text default null)
returns public.spenic_project_comments language plpgsql security definer set search_path = public as $$
declare p public.spenic_projects; s public.spenic_showcase_shares; saved public.spenic_project_comments; coordinate jsonb;
begin
  select * into p from spenic_projects where id = (comment_data->>'projectId')::uuid and kind = 'project';
  if not found then raise exception 'Project unavailable' using errcode = '42501'; end if;
  if share_hash is not null then
    select * into s from spenic_showcase_shares where token_hash = share_hash and enabled for update;
    if not found or not exists(select 1 from spenic_showcase_items i join spenic_showcases c on c.id = i.showcase_id
      where i.showcase_id = s.showcase_id and i.project_id = p.id and c.owner_id = p.owner_id) then
      raise exception 'Share unavailable' using errcode = '42501';
    end if;
  elsif auth.uid() is null or p.owner_id <> auth.uid() then raise exception 'Owner required' using errcode = '42501'; end if;
  select * into saved from spenic_project_comments where project_id = p.id and request_id = (comment_data->>'requestId')::uuid;
  if found then
    if saved.author_name is distinct from trim(comment_data->>'authorName') or saved.body is distinct from trim(comment_data->>'body')
      or saved.model_hash is distinct from comment_data->>'modelHash' or saved.host is distinct from (comment_data->>'host')::integer
      or saved.point is distinct from comment_data->'point' or saved.showcase_id is distinct from s.showcase_id
      or saved.author_token_hash is distinct from comment_data->>'authorHash' then raise exception 'Request already used'; end if;
    return saved;
  end if;
  if p.manifest->'files'->(p.manifest->>'modelPath')->>'hash' is distinct from comment_data->>'modelHash' then raise exception 'Model changed; reopen project'; end if;
  if jsonb_typeof(comment_data->'point') is distinct from 'array' or jsonb_array_length(comment_data->'point') <> 3 then raise exception 'Invalid point'; end if;
  for coordinate in select value from jsonb_array_elements(comment_data->'point') loop
    if jsonb_typeof(coordinate) <> 'number' or abs(coordinate::text::numeric) > 1e12 then raise exception 'Invalid point'; end if;
  end loop;
  if share_hash is not null and (select count(*) from spenic_project_comments where showcase_id = s.showcase_id and created_at > clock_timestamp() - interval '1 minute') >= 60 then
    raise exception 'Too many comments; try again later';
  end if;
  insert into spenic_project_comments(project_id, showcase_id, request_id, author_name, body, model_hash, host, point, author_token_hash)
    values(p.id, s.showcase_id, (comment_data->>'requestId')::uuid, trim(comment_data->>'authorName'), trim(comment_data->>'body'),
      comment_data->>'modelHash', (comment_data->>'host')::integer, comment_data->'point', comment_data->>'authorHash')
    on conflict(project_id, request_id) do nothing returning * into saved;
  if saved.id is null then raise exception 'Request already used; retry'; end if;
  return saved;
end $$;
revoke all on function public.spenic_submit_project_comment(jsonb, text) from public, anon;
grant execute on function public.spenic_submit_project_comment(jsonb, text) to authenticated, service_role;

create or replace function public.spenic_delete_guest_comment(project_id_value uuid, comment_id_value uuid, share_hash text, author_hash text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.spenic_showcase_shares;
begin
  if author_hash is null or author_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Comment author required' using errcode = '42501';
  end if;
  select * into s from spenic_showcase_shares where token_hash = share_hash and enabled for update;
  if not found or not exists (
    select 1 from spenic_showcase_items i join spenic_showcases c on c.id = i.showcase_id
      join spenic_projects p on p.id = i.project_id and p.owner_id = c.owner_id and p.kind = 'project'
    where i.showcase_id = s.showcase_id and i.project_id = project_id_value
  ) then raise exception 'Share unavailable' using errcode = '42501'; end if;
  delete from spenic_project_comments where id = comment_id_value and project_id = project_id_value and author_token_hash = author_hash;
  if not found then raise exception 'Comment unavailable or not owned' using errcode = '42501'; end if;
end $$;
revoke all on function public.spenic_delete_guest_comment(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.spenic_delete_guest_comment(uuid, uuid, text, text) to service_role;

drop function if exists public.spenic_reposition_project_comment(uuid, text, integer, jsonb);

-- The server is the only anonymous-access gateway; no table or bucket is public.
grant select on public.spenic_showcases, public.spenic_showcase_items, public.spenic_showcase_shares,
  public.spenic_project_comments, public.spenic_projects, public.spenic_album_photos to service_role;
notify pgrst, 'reload schema';
commit;
