-- Run this SQL in Supabase SQL Editor to enable the customer wallet reset button.
-- It resets only the signed-in customer's virtual wallet and keeps admin audit records.
create or replace function public.reset_own_virtual_wallet()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in is required.'; end if;
  delete from public.demo_wallet_ledger where user_id = v_user;
  delete from public.demo_withdrawals where user_id = v_user;
  delete from public.virtual_deposit_requests where user_id = v_user;
  delete from public.customer_external_wallets where user_id = v_user;
  update public.demo_wallets set available = 0, held = 0, updated_at = now() where user_id = v_user;
end;
$$;
revoke all on function public.reset_own_virtual_wallet() from public, anon;
grant execute on function public.reset_own_virtual_wallet() to authenticated;
