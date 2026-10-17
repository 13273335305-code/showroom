begin;

-- The public site row contains the endpoint only. Keys never belong here.
create table if not exists public.spenic_capture_ai_site (
  id text primary key check (id = 'site'),
  base text not null check (length(base) between 8 and 2048 and base ~ '^https?://[^/?#@[:space:]]+(/[^?#[:space:]]*)?$'),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.spenic_capture_ai_site(id, base)
values ('site', 'http://64.186.244.43:12001') on conflict (id) do nothing;

create table if not exists public.spenic_capture_ai_accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  api_key text not null default '' check (length(api_key) <= 16384),
  preferences jsonb not null default '{}'::jsonb check (
    jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 16384
    and preferences - array['model','aspect','size']::text[] = '{}'::jsonb
  ),
  updated_at timestamptz not null default clock_timestamp()
);
-- Remove the legacy account-level prompt field when this script is rerun on an
-- existing installation.
update public.spenic_capture_ai_accounts set preferences = preferences - 'prompt' where preferences ? 'prompt';
alter table public.spenic_capture_ai_accounts drop constraint if exists spenic_capture_ai_accounts_preferences_check;
alter table public.spenic_capture_ai_accounts add constraint spenic_capture_ai_accounts_preferences_check check (
  jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 16384
  and preferences - array['model','aspect','size']::text[] = '{}'::jsonb
);
alter table public.spenic_capture_ai_site enable row level security;
alter table public.spenic_capture_ai_accounts enable row level security;

drop policy if exists spenic_capture_ai_site_read on public.spenic_capture_ai_site;
create policy spenic_capture_ai_site_read on public.spenic_capture_ai_site
for select to anon, authenticated using (true);
drop policy if exists spenic_capture_ai_site_insert on public.spenic_capture_ai_site;
create policy spenic_capture_ai_site_insert on public.spenic_capture_ai_site
for insert to authenticated with check ((auth.jwt()->'app_metadata'->>'spenic_developer') = 'true');
drop policy if exists spenic_capture_ai_site_update on public.spenic_capture_ai_site;
create policy spenic_capture_ai_site_update on public.spenic_capture_ai_site
for update to authenticated using ((auth.jwt()->'app_metadata'->>'spenic_developer') = 'true')
with check ((auth.jwt()->'app_metadata'->>'spenic_developer') = 'true');

drop policy if exists spenic_capture_ai_account_read on public.spenic_capture_ai_accounts;
create policy spenic_capture_ai_account_read on public.spenic_capture_ai_accounts
for select to authenticated using (owner_id = auth.uid());
drop policy if exists spenic_capture_ai_account_insert on public.spenic_capture_ai_accounts;
create policy spenic_capture_ai_account_insert on public.spenic_capture_ai_accounts
for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists spenic_capture_ai_account_update on public.spenic_capture_ai_accounts;
create policy spenic_capture_ai_account_update on public.spenic_capture_ai_accounts
for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists spenic_capture_ai_account_delete on public.spenic_capture_ai_accounts;
create policy spenic_capture_ai_account_delete on public.spenic_capture_ai_accounts
for delete to authenticated using (owner_id = auth.uid());

revoke all on public.spenic_capture_ai_site, public.spenic_capture_ai_accounts from anon, authenticated;
grant select on public.spenic_capture_ai_site to anon, authenticated;
grant insert (id, base), update (id, base) on public.spenic_capture_ai_site to authenticated;
grant select, delete on public.spenic_capture_ai_accounts to authenticated;
grant insert (owner_id, api_key, preferences), update (owner_id, api_key, preferences) on public.spenic_capture_ai_accounts to authenticated;

-- The quick labels and their full prompts are shared by all accounts and are
-- editable only by an authorized developer from the System Configuration page.
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
update public.spenic_capture_ai_prompts
set prompts = coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements(prompts) with ordinality where ordinality <= 5), '[]'::jsonb)
where jsonb_typeof(prompts) = 'array' and jsonb_array_length(prompts) > 5;
alter table public.spenic_capture_ai_prompts drop constraint if exists spenic_capture_ai_prompts_prompts_check;
alter table public.spenic_capture_ai_prompts add constraint spenic_capture_ai_prompts_prompts_check check (public.spenic_valid_capture_ai_prompts(prompts));
insert into public.spenic_capture_ai_prompts(id, prompts)
values ('site', $$[
  {"label":"极简摄影棚","prompt":"将这个产品放在极简摄影棚中，柔和侧光，高级电商产品图"},
  {"label":"自然生活场景","prompt":"将这个产品融入自然、克制的生活方式场景，光线柔和，画面高级且真实"},
  {"label":"材质细节特写","prompt":"突出这个产品的材质、纹理和工艺细节，使用干净的近距离产品摄影构图"}
]$$::jsonb) on conflict (id) do nothing;
alter table public.spenic_capture_ai_prompts enable row level security;
drop policy if exists spenic_capture_ai_prompts_read on public.spenic_capture_ai_prompts;
create policy spenic_capture_ai_prompts_read on public.spenic_capture_ai_prompts
for select to anon, authenticated using (true);
drop policy if exists spenic_capture_ai_prompts_insert on public.spenic_capture_ai_prompts;
create policy spenic_capture_ai_prompts_insert on public.spenic_capture_ai_prompts
for insert to authenticated with check ((auth.jwt()->'app_metadata'->>'spenic_developer') = 'true');
drop policy if exists spenic_capture_ai_prompts_update on public.spenic_capture_ai_prompts;
create policy spenic_capture_ai_prompts_update on public.spenic_capture_ai_prompts
for update to authenticated using ((auth.jwt()->'app_metadata'->>'spenic_developer') = 'true')
with check ((auth.jwt()->'app_metadata'->>'spenic_developer') = 'true');
revoke all on public.spenic_capture_ai_prompts from anon, authenticated;
grant select on public.spenic_capture_ai_prompts to anon, authenticated;
grant insert (id, prompts), update (id, prompts) on public.spenic_capture_ai_prompts to authenticated;

create or replace function public.spenic_capture_ai_timestamp()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at := clock_timestamp(); return new; end; $$;
drop trigger if exists spenic_capture_ai_prompts_timestamp on public.spenic_capture_ai_prompts;
create trigger spenic_capture_ai_prompts_timestamp before update on public.spenic_capture_ai_prompts
for each row execute function public.spenic_capture_ai_timestamp();
drop trigger if exists spenic_capture_ai_site_timestamp on public.spenic_capture_ai_site;
create trigger spenic_capture_ai_site_timestamp before update on public.spenic_capture_ai_site
for each row execute function public.spenic_capture_ai_timestamp();
drop trigger if exists spenic_capture_ai_account_timestamp on public.spenic_capture_ai_accounts;
create trigger spenic_capture_ai_account_timestamp before update on public.spenic_capture_ai_accounts
for each row execute function public.spenic_capture_ai_timestamp();

commit;
