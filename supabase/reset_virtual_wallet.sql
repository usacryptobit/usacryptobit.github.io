-- Admin-only customer virtual wallet reset.
-- Run in Supabase SQL Editor after the base wallet schema is installed.
alter table public.admin_action_log drop constraint if exists admin_action_log_action_check;
alter table public.admin_action_log add constraint admin_action_log_action_check
  check (action in ('restricted','suspended','activated','demo_funding','virtual_funding','withdrawal_paused','withdrawal_unpaused','withdrawal_hold','withdrawal_release','withdrawal_approved','withdrawal_rejected','virtual_deposit_approved','virtual_deposit_rejected','virtual_wallet_reset'));
update public.admin_action_log set action='virtual_funding' where action='demo_funding';

-- Remove the old customer-callable reset RPC, if it was installed earlier.
drop function if exists public.reset_own_virtual_wallet();

create or replace function public.admin_reset_virtual_wallet(p_admin_id uuid,p_user_id uuid,p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role text;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Service role required.'; end if;
  if not exists(select 1 from public.user_roles where user_id=p_admin_id and role='admin') then raise exception 'Administrator access is required.'; end if;
  if p_user_id is null or p_user_id=p_admin_id then raise exception 'Choose a customer account.'; end if;
  select role into v_target_role from public.user_roles where user_id=p_user_id;
  if v_target_role='admin' then raise exception 'Administrator wallets cannot be reset here.'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 3 and 500 then raise exception 'A reason between 3 and 500 characters is required.'; end if;

  delete from public.demo_wallet_ledger where user_id=p_user_id;
  delete from public.demo_withdrawals where user_id=p_user_id;
  delete from public.virtual_deposit_requests where user_id=p_user_id;
  delete from public.customer_external_wallets where user_id=p_user_id;
  update public.demo_wallets set available=0,held=0,updated_at=now() where user_id=p_user_id;
  insert into public.admin_action_log(admin_id,target_user_id,action,reason)
    values(p_admin_id,p_user_id,'virtual_wallet_reset',left('Virtual wallet balances, history, requests, and saved address references cleared. '||trim(p_reason),500));
end;
$$;
revoke all on function public.admin_reset_virtual_wallet(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_reset_virtual_wallet(uuid,uuid,text) to service_role;
