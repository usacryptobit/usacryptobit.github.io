-- USA CryptoBit schema. Run in Supabase Dashboard > SQL Editor.
-- The browser publishable key is safe to use with these row-level policies.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  coin_id text not null check (char_length(coin_id) between 1 and 80),
  coin_name text not null check (char_length(coin_name) between 1 and 120),
  coin_symbol text not null check (char_length(coin_symbol) between 1 and 20),
  created_at timestamptz not null default now(),
  unique (user_id, coin_id)
);

-- Admin roles are assigned only by a trusted database administrator.
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

-- Customer states: active, restricted (read-only watchlist), suspended (blocked).
create table if not exists public.account_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'restricted', 'suspended')),
  reason text check (reason is null or char_length(reason) <= 500),
  suspended_until timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- An append-only trail of customer access changes made by administrators.
create table if not exists public.admin_action_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('restricted', 'suspended', 'activated')),
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now()
);

create index if not exists watchlist_user_id_idx on public.watchlist(user_id);
create index if not exists admin_action_log_created_at_idx on public.admin_action_log(created_at desc);

alter table public.profiles enable row level security;
alter table public.watchlist enable row level security;
alter table public.user_roles enable row level security;
alter table public.account_controls enable row level security;
alter table public.admin_action_log enable row level security;

-- The security definer reads status without exposing other customers' records.
create or replace function public.current_account_status()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case
      when ac.status = 'suspended' and ac.suspended_until is not null and ac.suspended_until <= now()
        then 'active'
      else ac.status
    end
    from public.account_controls ac where ac.user_id = (select auth.uid())),
    'active'
  );
$$;
revoke all on function public.current_account_status() from public;
grant execute on function public.current_account_status() to authenticated;

drop policy if exists "Users can view their profile" on public.profiles;
create policy "Users can view their profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users can view their watchlist" on public.watchlist;
create policy "Users can view their watchlist" on public.watchlist
  for select to authenticated using ((select auth.uid()) = user_id and public.current_account_status() <> 'suspended');
drop policy if exists "Users can add to their watchlist" on public.watchlist;
create policy "Users can add to their watchlist" on public.watchlist
  for insert to authenticated with check ((select auth.uid()) = user_id and public.current_account_status() = 'active');
drop policy if exists "Users can remove from their watchlist" on public.watchlist;
create policy "Users can remove from their watchlist" on public.watchlist
  for delete to authenticated using ((select auth.uid()) = user_id and public.current_account_status() = 'active');

drop policy if exists "Users can view their own admin role" on public.user_roles;
create policy "Users can view their own admin role" on public.user_roles
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can view their own account status" on public.account_controls;
create policy "Users can view their own account status" on public.account_controls
  for select to authenticated using ((select auth.uid()) = user_id);

-- Create a profile row automatically after a new account is registered.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Table grants required by Supabase's Data API; RLS still restricts every row.
grant select, update on public.profiles to authenticated;
grant select, insert, delete on public.watchlist to authenticated;
grant select on public.user_roles, public.account_controls to authenticated;
revoke insert, update, delete on public.user_roles, public.account_controls from anon, authenticated;
revoke all on public.admin_action_log from anon, authenticated;
