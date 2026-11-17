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
  updated_at timestamptz not null default now(),
  withdrawals_paused boolean not null default false,
  withdrawal_pause_reason text
);
alter table public.account_controls add column if not exists withdrawals_paused boolean not null default false;
alter table public.account_controls add column if not exists withdrawal_pause_reason text;

-- An append-only trail of customer access changes made by administrators.
create table if not exists public.admin_action_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('restricted', 'suspended', 'activated')),
  reason text not null check (char_length(reason) between 3 and 500),
  created_at timestamptz not null default now()
);

-- Virtual wallet balances are simulated credits; these IDs are not deposit addresses.
create table if not exists public.demo_wallets (
  user_id uuid not null references auth.users(id) on delete cascade,
  asset text not null check (asset in ('BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC')),
  demo_address text not null,
  available numeric(38,12) not null default 0 check (available >= 0),
  held numeric(38,12) not null default 0 check (held >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, asset),
  unique (demo_address)
);

create table if not exists public.demo_wallet_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  asset text not null check (asset in ('BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC')),
  available_delta numeric(38,12) not null default 0,
  held_delta numeric(38,12) not null default 0,
  entry_type text not null check (entry_type in ('admin_funding','conversion_out','conversion_in','withdrawal_requested','withdrawal_approved','withdrawal_rejected')),
  reference_id uuid,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.demo_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset text not null check (asset in ('BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC')),
  amount numeric(38,12) not null check (amount > 0),
  destination text not null check (char_length(destination) between 4 and 200),
  status text not null default 'pending' check (status in ('pending','held','approved','rejected')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.virtual_deposit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset text not null check (asset in ('BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC')),
  amount numeric(38,12) not null check (amount > 0),
  reference_note text check (reference_note is null or char_length(reference_note) <= 200),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.demo_wallet_ledger drop constraint if exists demo_wallet_ledger_entry_type_check;
alter table public.demo_wallet_ledger add constraint demo_wallet_ledger_entry_type_check check (entry_type in ('admin_funding','conversion_out','conversion_in','withdrawal_requested','withdrawal_approved','withdrawal_rejected','virtual_deposit'));

alter table public.admin_action_log drop constraint if exists admin_action_log_action_check;
alter table public.admin_action_log add constraint admin_action_log_action_check check (action in ('restricted','suspended','activated','demo_funding','virtual_funding','withdrawal_paused','withdrawal_unpaused','withdrawal_hold','withdrawal_release','withdrawal_approved','withdrawal_rejected','virtual_deposit_approved','virtual_deposit_rejected'));
update public.admin_action_log set action='virtual_funding' where action='demo_funding';

create index if not exists watchlist_user_id_idx on public.watchlist(user_id);
create index if not exists admin_action_log_created_at_idx on public.admin_action_log(created_at desc);
create index if not exists demo_wallet_ledger_user_created_idx on public.demo_wallet_ledger(user_id, created_at desc);
create index if not exists demo_withdrawals_status_created_idx on public.demo_withdrawals(status, created_at desc);
create index if not exists virtual_deposit_requests_status_created_idx on public.virtual_deposit_requests(status, created_at desc);

alter table public.profiles enable row level security;
alter table public.watchlist enable row level security;
alter table public.user_roles enable row level security;
alter table public.account_controls enable row level security;
alter table public.admin_action_log enable row level security;
alter table public.demo_wallets enable row level security;
alter table public.demo_wallet_ledger enable row level security;
alter table public.demo_withdrawals enable row level security;
alter table public.virtual_deposit_requests enable row level security;

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
drop policy if exists "Users can view their own demo wallets" on public.demo_wallets;
create policy "Users can view their own demo wallets" on public.demo_wallets
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can view their own demo wallet ledger" on public.demo_wallet_ledger;
create policy "Users can view their own demo wallet ledger" on public.demo_wallet_ledger
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can view their own demo withdrawals" on public.demo_withdrawals;
create policy "Users can view their own demo withdrawals" on public.demo_withdrawals
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can view their own virtual deposit requests" on public.virtual_deposit_requests;
create policy "Users can view their own virtual deposit requests" on public.virtual_deposit_requests
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
  insert into public.demo_wallets (user_id, asset, demo_address)
  select new.id, a.asset, 'VIRTUAL-' || a.asset || '-' || upper(substr(replace(new.id::text, '-', ''), 1, 12))
  from (values ('BTC'),('ETH'),('SOL'),('BNB'),('XRP'),('DOGE'),('ADA'),('AVAX'),('LINK'),('DOT'),('TRX'),('LTC')) as a(asset)
  on conflict (user_id, asset) do nothing;
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
grant select on public.demo_wallets, public.demo_wallet_ledger, public.demo_withdrawals to authenticated;
grant select on public.virtual_deposit_requests to authenticated;
revoke insert, update, delete on public.user_roles, public.account_controls from anon, authenticated;
revoke insert, update, delete on public.demo_wallets, public.demo_wallet_ledger, public.demo_withdrawals from anon, authenticated;
revoke insert, update, delete on public.virtual_deposit_requests from anon, authenticated;
revoke all on public.admin_action_log from anon, authenticated;

-- Provision display-only virtual wallet IDs for current and new users.
insert into public.demo_wallets (user_id, asset, demo_address)
select u.id, a.asset, 'VIRTUAL-' || a.asset || '-' || upper(substr(replace(u.id::text, '-', ''), 1, 12))
from auth.users u
cross join (values ('BTC'),('ETH'),('SOL'),('BNB'),('XRP'),('DOGE'),('ADA'),('AVAX'),('LINK'),('DOT'),('TRX'),('LTC')) as a(asset)
on conflict (user_id, asset) do nothing;

update public.demo_wallets
set demo_address = 'VIRTUAL-' || asset || '-' || upper(substr(replace(user_id::text, '-', ''), 1, 12))
where demo_address like 'DEMO-%';
update public.demo_wallet_ledger
set note = regexp_replace(note, 'demo', 'virtual', 'gi')
where note ilike '%demo%';

-- Customer profile additions: low-risk preferences and an optional profile image.
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists show_market_movers boolean not null default true;
grant insert on public.profiles to authenticated;
drop policy if exists "Users can create their profile" on public.profiles;
create policy "Users can create their profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Profile pictures are publicly viewable" on storage.objects;
create policy "Profile pictures are publicly viewable" on storage.objects
  for select to public using (bucket_id = 'profile-avatars');
drop policy if exists "Users can upload their own profile pictures" on storage.objects;
create policy "Users can upload their own profile pictures" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can update their own profile pictures" on storage.objects;
create policy "Users can update their own profile pictures" on storage.objects
  for update to authenticated using (
    bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  ) with check (
    bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can delete their own profile pictures" on storage.objects;
create policy "Users can delete their own profile pictures" on storage.objects
  for delete to authenticated using (
    bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Private in-account conversations between each customer and the admin team.
create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 120),
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index if not exists support_conversations_customer_updated_idx
  on public.support_conversations(customer_id, updated_at desc);
create index if not exists support_messages_conversation_created_idx
  on public.support_messages(conversation_id, created_at);

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid()) and r.role = 'admin'
  );
$$;
revoke all on function public.is_current_user_admin() from public, anon;
grant execute on function public.is_current_user_admin() to authenticated;

create or replace function public.can_access_support_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_current_user_admin() or exists (
    select 1 from public.support_conversations c
    where c.id = p_conversation_id and c.customer_id = (select auth.uid())
  );
$$;
revoke all on function public.can_access_support_conversation(uuid) from public, anon;
grant execute on function public.can_access_support_conversation(uuid) to authenticated;

drop policy if exists "Customers and admins can read support conversations" on public.support_conversations;
create policy "Customers and admins can read support conversations" on public.support_conversations
  for select to authenticated using (customer_id = (select auth.uid()) or public.is_current_user_admin());
drop policy if exists "Customers can start their own support conversations" on public.support_conversations;
drop policy if exists "Customers and admins can start support conversations" on public.support_conversations;
create policy "Customers and admins can start support conversations" on public.support_conversations
  for insert to authenticated with check (
    (customer_id = (select auth.uid()) or public.is_current_user_admin()) and status = 'open'
  );
drop policy if exists "Admins can update support conversations" on public.support_conversations;
create policy "Admins can update support conversations" on public.support_conversations
  for update to authenticated using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists "Conversation participants can read support messages" on public.support_messages;
create policy "Conversation participants can read support messages" on public.support_messages
  for select to authenticated using (public.can_access_support_conversation(conversation_id));
drop policy if exists "Conversation participants can send support messages" on public.support_messages;
create policy "Conversation participants can send support messages" on public.support_messages
  for insert to authenticated with check (
    sender_id = (select auth.uid())
    and public.can_access_support_conversation(conversation_id)
  );

create or replace function public.bump_support_conversation_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.support_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists support_message_bumps_conversation on public.support_messages;
create trigger support_message_bumps_conversation
  after insert on public.support_messages
  for each row execute procedure public.bump_support_conversation_updated_at();

grant select, insert, update on public.support_conversations to authenticated;
grant select, insert on public.support_messages to authenticated;
grant usage, select on sequence public.support_messages_id_seq to authenticated;

-- Make conversions atomic and keep all virtual balance changes in the ledger.
create or replace function public.demo_convert(
  p_from_asset text,
  p_to_asset text,
  p_from_amount numeric,
  p_exchange_rate numeric
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_to_amount numeric(38,12);
  v_reference uuid := gen_random_uuid();
begin
  if v_user is null then raise exception 'Sign in is required.'; end if;
  if public.current_account_status() <> 'active' then raise exception 'Account must be active to convert virtual balances.'; end if;
  if p_from_asset = p_to_asset then raise exception 'Choose two different assets.'; end if;
  if p_from_asset not in ('BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC')
     or p_to_asset not in ('BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC') then
    raise exception 'Unsupported virtual asset.';
  end if;
  if p_from_amount is null or p_from_amount <= 0 or p_exchange_rate is null or p_exchange_rate <= 0 then
    raise exception 'Enter a positive amount and quote.';
  end if;

  perform 1 from public.demo_wallets
    where user_id = v_user and asset in (p_from_asset, p_to_asset)
    order by asset for update;
  v_to_amount := round(p_from_amount * p_exchange_rate * 0.995, 12);
  if v_to_amount <= 0 then raise exception 'The converted amount is too small.'; end if;

  update public.demo_wallets
    set available = available - p_from_amount, updated_at = now()
    where user_id = v_user and asset = p_from_asset and available >= p_from_amount;
  if not found then raise exception 'Insufficient available virtual balance.'; end if;
  update public.demo_wallets
    set available = available + v_to_amount, updated_at = now()
    where user_id = v_user and asset = p_to_asset;
  if not found then raise exception 'Demo wallet for the target asset is not available.'; end if;

  insert into public.demo_wallet_ledger (user_id,asset,available_delta,entry_type,reference_id,note,created_by)
  values (v_user,p_from_asset,-p_from_amount,'conversion_out',v_reference,'Virtual conversion; 0.5% simulated fee',v_user),
         (v_user,p_to_asset,v_to_amount,'conversion_in',v_reference,'Virtual conversion; 0.5% simulated fee',v_user);
  return v_to_amount;
end;
$$;
revoke all on function public.demo_convert(text,text,numeric,numeric) from public;
revoke all on function public.demo_convert(text,text,numeric,numeric) from anon;
grant execute on function public.demo_convert(text,text,numeric,numeric) to authenticated;

-- A withdrawal request only moves fictional demo units into a held state.
create or replace function public.demo_request_withdrawal(p_asset text, p_amount numeric, p_destination text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_paused boolean;
begin
  if v_user is null then raise exception 'Sign in is required.'; end if;
  if public.current_account_status() <> 'active' then raise exception 'Account must be active to request a virtual withdrawal.'; end if;
  select coalesce((select ac.withdrawals_paused from public.account_controls ac where ac.user_id = v_user), false) into v_paused;
  if v_paused then raise exception 'Virtual withdrawals are paused for this account.'; end if;
  if p_asset not in ('BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC') then raise exception 'Unsupported virtual asset.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a positive amount.'; end if;
  if p_destination is null or char_length(trim(p_destination)) not between 4 and 200 then raise exception 'Enter a destination label between 4 and 200 characters.'; end if;

  update public.demo_wallets
    set available = available - p_amount, held = held + p_amount, updated_at = now()
    where user_id = v_user and asset = p_asset and available >= p_amount;
  if not found then raise exception 'Insufficient available virtual balance.'; end if;
  insert into public.demo_withdrawals (id,user_id,asset,amount,destination,status)
    values (v_id,v_user,p_asset,p_amount,trim(p_destination),'pending');
  insert into public.demo_wallet_ledger (user_id,asset,available_delta,held_delta,entry_type,reference_id,note,created_by)
    values (v_user,p_asset,-p_amount,p_amount,'withdrawal_requested',v_id,'Virtual withdrawal request; no blockchain transfer',v_user);
  return v_id;
end;
$$;
revoke all on function public.demo_request_withdrawal(text,numeric,text) from public;
revoke all on function public.demo_request_withdrawal(text,numeric,text) from anon;
grant execute on function public.demo_request_withdrawal(text,numeric,text) to authenticated;

-- Customer deposit actions create a review request only; they never accept or verify a blockchain transfer.
create or replace function public.virtual_request_deposit(p_asset text,p_amount numeric,p_reference_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid := gen_random_uuid();
begin
  if v_user is null then raise exception 'Sign in is required.'; end if;
  if public.current_account_status() <> 'active' then raise exception 'Account must be active to request a deposit.'; end if;
  if p_asset not in ('BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC') then raise exception 'Unsupported asset.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'Enter a valid amount.'; end if;
  if p_reference_note is not null and char_length(trim(p_reference_note)) > 200 then raise exception 'Reference note must be 200 characters or fewer.'; end if;
  insert into public.virtual_deposit_requests(id,user_id,asset,amount,reference_note)
    values (v_id,v_user,p_asset,p_amount,nullif(trim(p_reference_note),''));
  return v_id;
end;
$$;
revoke all on function public.virtual_request_deposit(text,numeric,text) from public,anon;
grant execute on function public.virtual_request_deposit(text,numeric,text) to authenticated;

-- Privileged virtual wallet operations are callable only by the service role from the checked Edge Function.
create or replace function public.admin_fund_demo_wallet(p_admin_id uuid,p_user_id uuid,p_asset text,p_amount numeric,p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Service role required.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'Enter a valid virtual funding amount.'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 3 and 500 then raise exception 'A reason between 3 and 500 characters is required.'; end if;
  update public.demo_wallets set available = available + p_amount, updated_at = now()
    where user_id = p_user_id and asset = p_asset;
  if not found then raise exception 'Virtual wallet for this asset was not found.'; end if;
  insert into public.demo_wallet_ledger (user_id,asset,available_delta,entry_type,note,created_by)
    values (p_user_id,p_asset,p_amount,'admin_funding',trim(p_reason),p_admin_id);
  insert into public.admin_action_log (admin_id,target_user_id,action,reason)
    values (p_admin_id,p_user_id,'virtual_funding',trim(p_reason));
end;
$$;
revoke all on function public.admin_fund_demo_wallet(uuid,uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.admin_fund_demo_wallet(uuid,uuid,text,numeric,text) to service_role;

create or replace function public.admin_review_demo_withdrawal(p_admin_id uuid,p_withdrawal_id uuid,p_action text,p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_withdrawal public.demo_withdrawals%rowtype;
  v_log_action text;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Service role required.'; end if;
  if p_action not in ('hold','release','approve','reject') then raise exception 'Unsupported withdrawal action.'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 3 and 500 then raise exception 'A reason between 3 and 500 characters is required.'; end if;
  select * into v_withdrawal from public.demo_withdrawals where id = p_withdrawal_id for update;
  if not found then raise exception 'Withdrawal request not found.'; end if;
  if v_withdrawal.status not in ('pending','held') then raise exception 'This virtual withdrawal is already finalized.'; end if;

  if p_action = 'hold' then
    update public.demo_withdrawals set status='held',reason=trim(p_reason),updated_at=now() where id=p_withdrawal_id;
    v_log_action := 'withdrawal_hold';
  elsif p_action = 'release' then
    update public.demo_withdrawals set status='pending',reason=trim(p_reason),updated_at=now() where id=p_withdrawal_id;
    v_log_action := 'withdrawal_release';
  elsif p_action = 'approve' then
    update public.demo_wallets set held=held-v_withdrawal.amount,updated_at=now()
      where user_id=v_withdrawal.user_id and asset=v_withdrawal.asset and held>=v_withdrawal.amount;
    if not found then raise exception 'Held virtual balance is inconsistent.'; end if;
    update public.demo_withdrawals set status='approved',reason=trim(p_reason),updated_at=now() where id=p_withdrawal_id;
    insert into public.demo_wallet_ledger (user_id,asset,held_delta,entry_type,reference_id,note,created_by)
      values (v_withdrawal.user_id,v_withdrawal.asset,-v_withdrawal.amount,'withdrawal_approved',p_withdrawal_id,trim(p_reason),p_admin_id);
    v_log_action := 'withdrawal_approved';
  else
    update public.demo_wallets set held=held-v_withdrawal.amount,available=available+v_withdrawal.amount,updated_at=now()
      where user_id=v_withdrawal.user_id and asset=v_withdrawal.asset and held>=v_withdrawal.amount;
    if not found then raise exception 'Held virtual balance is inconsistent.'; end if;
    update public.demo_withdrawals set status='rejected',reason=trim(p_reason),updated_at=now() where id=p_withdrawal_id;
    insert into public.demo_wallet_ledger (user_id,asset,available_delta,held_delta,entry_type,reference_id,note,created_by)
      values (v_withdrawal.user_id,v_withdrawal.asset,v_withdrawal.amount,-v_withdrawal.amount,'withdrawal_rejected',p_withdrawal_id,trim(p_reason),p_admin_id);
    v_log_action := 'withdrawal_rejected';
  end if;
  insert into public.admin_action_log (admin_id,target_user_id,action,reason)
    values (p_admin_id,v_withdrawal.user_id,v_log_action,trim(p_reason));
end;
$$;
revoke all on function public.admin_review_demo_withdrawal(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.admin_review_demo_withdrawal(uuid,uuid,text,text) to service_role;

create or replace function public.admin_review_virtual_deposit(p_admin_id uuid,p_request_id uuid,p_action text,p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.virtual_deposit_requests%rowtype;
  v_action text;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Service role required.'; end if;
  if p_action not in ('approve','reject') then raise exception 'Choose approve or reject.'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 3 and 500 then raise exception 'A reason between 3 and 500 characters is required.'; end if;
  select * into v_request from public.virtual_deposit_requests where id=p_request_id for update;
  if not found then raise exception 'Deposit request not found.'; end if;
  if v_request.status <> 'pending' then raise exception 'This deposit request has already been reviewed.'; end if;
  if p_action='approve' then
    update public.demo_wallets set available=available+v_request.amount,updated_at=now()
      where user_id=v_request.user_id and asset=v_request.asset;
    if not found then raise exception 'Wallet for this asset was not found.'; end if;
    update public.virtual_deposit_requests set status='approved',reason=trim(p_reason),updated_at=now() where id=p_request_id;
    insert into public.demo_wallet_ledger(user_id,asset,available_delta,entry_type,reference_id,note,created_by)
      values(v_request.user_id,v_request.asset,v_request.amount,'virtual_deposit',p_request_id,trim(p_reason),p_admin_id);
    v_action := 'virtual_deposit_approved';
  else
    update public.virtual_deposit_requests set status='rejected',reason=trim(p_reason),updated_at=now() where id=p_request_id;
    v_action := 'virtual_deposit_rejected';
  end if;
  insert into public.admin_action_log(admin_id,target_user_id,action,reason)
    values(p_admin_id,v_request.user_id,v_action,trim(p_reason));
end;
$$;
revoke all on function public.admin_review_virtual_deposit(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.admin_review_virtual_deposit(uuid,uuid,text,text) to service_role;
