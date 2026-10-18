begin;

-- Resolve the administrator from the current server-side account, never editable metadata.
create or replace function public.spenic_is_system_config_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and lower(email) = '486837574@qq.com'
      and email_confirmed_at is not null
  );
$$;
revoke all on function public.spenic_is_system_config_admin() from public, anon;
grant execute on function public.spenic_is_system_config_admin() to authenticated;

create or replace function public.spenic_valid_fabric_colors(value jsonb)
returns boolean language plpgsql immutable set search_path = public
as $$
declare item jsonb; codes text[] := '{}'; code text;
begin
  if jsonb_typeof(value) is distinct from 'array' then return false; end if;
  if jsonb_array_length(value) > 500 then return false; end if;
  for item in select jsonb_array_elements(value) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'code') is distinct from 'string'
      or jsonb_typeof(item->'base') is distinct from 'string'
      or jsonb_typeof(item->'line') is distinct from 'string' then return false; end if;
    code := item->>'code';
    if code !~ '^[A-Z]{3}$' or code = any(codes)
      or (item->>'base') !~ '^#[0-9a-fA-F]{6}$'
      or (item->>'line') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
    codes := array_append(codes, code);
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table if not exists public.spenic_fabric_colors (
  id text primary key check (id = 'site'),
  colors jsonb not null check (public.spenic_valid_fabric_colors(colors)),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.spenic_fabric_colors enable row level security;
drop policy if exists spenic_fabric_colors_read on public.spenic_fabric_colors;
create policy spenic_fabric_colors_read on public.spenic_fabric_colors
for select to anon, authenticated using (true);
-- Only the designated, verified administrator can edit system configuration.
drop policy if exists spenic_fabric_colors_insert on public.spenic_fabric_colors;
create policy spenic_fabric_colors_insert on public.spenic_fabric_colors
for insert to authenticated with check (public.spenic_is_system_config_admin());
drop policy if exists spenic_fabric_colors_update on public.spenic_fabric_colors;
create policy spenic_fabric_colors_update on public.spenic_fabric_colors
for update to authenticated using (public.spenic_is_system_config_admin())
with check (public.spenic_is_system_config_admin());
revoke all on public.spenic_fabric_colors from anon, authenticated;
grant select on public.spenic_fabric_colors to anon, authenticated;
grant insert (id, colors), update (id, colors) on public.spenic_fabric_colors to authenticated;

create or replace function public.spenic_fabric_colors_timestamp()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at := clock_timestamp(); return new; end; $$;
drop trigger if exists spenic_fabric_colors_timestamp on public.spenic_fabric_colors;
create trigger spenic_fabric_colors_timestamp before update on public.spenic_fabric_colors
for each row execute function public.spenic_fabric_colors_timestamp();

commit;
