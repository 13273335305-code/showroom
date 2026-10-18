-- Run this complete script in Supabase SQL Editor. It can safely be rerun.
-- Creates missing system configuration tables and preserves all saved values.
begin;

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

-- The older permission-only script skipped missing tables. Initialize them first.
create or replace function public.spenic_valid_capture_ai_prompts(value jsonb)
returns boolean language plpgsql immutable set search_path = public
as $$
declare item jsonb;
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value) > 5 then return false; end if;
  for item in select jsonb_array_elements(value) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'label') is distinct from 'string'
      or jsonb_typeof(item->'prompt') is distinct from 'string'
      or length(trim(item->>'label')) not between 1 and 80
      or length(trim(item->>'prompt')) not between 1 and 2000 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table if not exists public.spenic_capture_ai_prompts (
  id text primary key check (id = 'site'),
  prompts jsonb not null check (public.spenic_valid_capture_ai_prompts(prompts)),
  updated_at timestamptz not null default clock_timestamp()
);

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

-- The API address is edited from AI Drawing Configuration. Keep authorized
-- developers supported while allowing the designated system administrator.
do $$
begin
  if to_regclass('public.spenic_capture_ai_site') is not null then
    execute 'drop policy if exists spenic_capture_ai_site_insert on public.spenic_capture_ai_site';
    execute $policy$create policy spenic_capture_ai_site_insert on public.spenic_capture_ai_site
      for insert to authenticated with check (
        (auth.jwt()->'app_metadata'->>'spenic_developer') = 'true'
        or public.spenic_is_system_config_admin()
      )$policy$;
    execute 'drop policy if exists spenic_capture_ai_site_update on public.spenic_capture_ai_site';
    execute $policy$create policy spenic_capture_ai_site_update on public.spenic_capture_ai_site
      for update to authenticated using (
        (auth.jwt()->'app_metadata'->>'spenic_developer') = 'true'
        or public.spenic_is_system_config_admin()
      ) with check (
        (auth.jwt()->'app_metadata'->>'spenic_developer') = 'true'
        or public.spenic_is_system_config_admin()
      )$policy$;
  end if;
end;
$$;

create or replace function public.spenic_system_config_timestamp()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at := clock_timestamp(); return new; end; $$;

-- Keep normal readers while restricting configuration writes to the administrator.
do $$
declare config_table text;
begin
  foreach config_table in array array['spenic_fabric_colors', 'spenic_capture_ai_prompts'] loop
    execute format('alter table public.%I enable row level security', config_table);
    execute format('drop policy if exists %I on public.%I', config_table || '_read', config_table);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', config_table || '_read', config_table);
    execute format('drop policy if exists %I on public.%I', config_table || '_insert', config_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.spenic_is_system_config_admin())', config_table || '_insert', config_table);
    execute format('drop policy if exists %I on public.%I', config_table || '_update', config_table);
    execute format('create policy %I on public.%I for update to authenticated using (public.spenic_is_system_config_admin()) with check (public.spenic_is_system_config_admin())', config_table || '_update', config_table);
    execute format('drop trigger if exists %I on public.%I', config_table || '_timestamp', config_table);
    execute format('create trigger %I before update on public.%I for each row execute function public.spenic_system_config_timestamp()', config_table || '_timestamp', config_table);
  end loop;
end;
$$;

revoke all on public.spenic_fabric_colors, public.spenic_capture_ai_prompts from anon, authenticated;
grant select on public.spenic_fabric_colors, public.spenic_capture_ai_prompts to anon, authenticated;
grant insert (id, colors), update (id, colors) on public.spenic_fabric_colors to authenticated;
grant insert (id, prompts), update (id, prompts) on public.spenic_capture_ai_prompts to authenticated;

-- Make new tables visible to the REST API after this transaction commits.
notify pgrst, 'reload schema';
commit;

-- Both table readiness columns should be true after a successful run.
select
  to_regclass('public.spenic_fabric_colors') is not null as fabric_colors_ready,
  to_regclass('public.spenic_capture_ai_prompts') is not null as ai_prompts_ready,
  exists (select 1 from auth.users where lower(email) = '486837574@qq.com' and email_confirmed_at is not null) as admin_account_ready;
