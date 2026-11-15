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

create index if not exists watchlist_user_id_idx on public.watchlist(user_id);

alter table public.profiles enable row level security;
alter table public.watchlist enable row level security;

drop policy if exists "Users can view their profile" on public.profiles;
create policy "Users can view their profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users can view their watchlist" on public.watchlist;
create policy "Users can view their watchlist" on public.watchlist
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can add to their watchlist" on public.watchlist;
create policy "Users can add to their watchlist" on public.watchlist
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can remove from their watchlist" on public.watchlist;
create policy "Users can remove from their watchlist" on public.watchlist
  for delete to authenticated using ((select auth.uid()) = user_id);

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
