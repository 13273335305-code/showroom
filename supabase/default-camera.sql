begin;

create or replace function public.spenic_valid_default_camera(camera_page text, value jsonb)
returns boolean language plpgsql immutable set search_path = public
as $$
declare v jsonb; n numeric; part jsonb;
begin
  if camera_page not in ('design', 'parts') or jsonb_typeof(value) is distinct from 'object'
    or value->>'format' is distinct from (case when camera_page = 'design' then 'SPENIC-DESIGN-VIEW' else 'SPENIC-MODEL-VIEW' end)
    or value->'version' is distinct from '1'::jsonb or octet_length(value::text) > 16384 then return false; end if;
  v := value->'view';
  if jsonb_typeof(v) is distinct from 'object'
    or jsonb_typeof(v->'azimuth') is distinct from 'number'
    or jsonb_typeof(v->'elevation') is distinct from 'number'
    or jsonb_typeof(v->'framing') is distinct from 'number'
    or jsonb_typeof(v->'offset') is distinct from 'array' then return false; end if;
  if (v->>'azimuth')::numeric not between -180 and 180
    or (v->>'elevation')::numeric < 0
    or (v->>'elevation')::numeric > (case when camera_page = 'design' then 89 else 90 end)
    or jsonb_array_length(v->'offset') <> 3 then return false; end if;
  n := (v->>'framing')::numeric;
  if (camera_page = 'design' and (n < 0.5 or n > 3))
    or (camera_page = 'parts' and (n <= 0 or n > 1000)) then return false; end if;
  for part in select jsonb_array_elements(v->'offset') loop
    if jsonb_typeof(part) is distinct from 'number' then return false; end if;
    if abs(part::text::numeric) > 1000 then return false; end if;
  end loop;
  if v ? 'distance' and v->'distance' <> 'null'::jsonb then
    if jsonb_typeof(v->'distance') is distinct from 'number' then return false; end if;
    if (v->>'distance')::numeric <= 0 or (v->>'distance')::numeric > 1000 then return false; end if;
  end if;
  return true;
exception when others then return false;
end;
$$;

create table if not exists public.spenic_default_camera_views (
  page text primary key check (page in ('design', 'parts')),
  config jsonb not null,
  updated_at timestamptz not null default clock_timestamp(),
  check (public.spenic_valid_default_camera(page, config))
);
alter table public.spenic_default_camera_views enable row level security;

drop policy if exists spenic_default_camera_read on public.spenic_default_camera_views;
create policy spenic_default_camera_read on public.spenic_default_camera_views
for select to anon, authenticated using (true);
-- Only server-controlled app_metadata can grant permission to edit site defaults.
-- User metadata and the front-end developer unlock never grant write access.
drop policy if exists spenic_default_camera_insert on public.spenic_default_camera_views;
create policy spenic_default_camera_insert on public.spenic_default_camera_views
for insert to authenticated with check ((auth.jwt()->'app_metadata'->>'spenic_developer') = 'true');
drop policy if exists spenic_default_camera_update on public.spenic_default_camera_views;
create policy spenic_default_camera_update on public.spenic_default_camera_views
for update to authenticated
using ((auth.jwt()->'app_metadata'->>'spenic_developer') = 'true')
with check ((auth.jwt()->'app_metadata'->>'spenic_developer') = 'true');

revoke all on public.spenic_default_camera_views from anon, authenticated;
grant select on public.spenic_default_camera_views to anon, authenticated;
grant insert (page, config), update (page, config) on public.spenic_default_camera_views to authenticated;

create or replace function public.spenic_default_camera_timestamp()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at := clock_timestamp(); return new; end; $$;
drop trigger if exists spenic_default_camera_timestamp on public.spenic_default_camera_views;
create trigger spenic_default_camera_timestamp before update on public.spenic_default_camera_views
for each row execute function public.spenic_default_camera_timestamp();

commit;
