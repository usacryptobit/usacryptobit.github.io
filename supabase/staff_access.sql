-- Scoped staff access. Run after the existing USA CryptoBit schema.
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check (role in ('customer','staff','admin'));

alter table public.admin_action_log drop constraint if exists admin_action_log_action_check;
alter table public.admin_action_log add constraint admin_action_log_action_check check (action in ('restricted','suspended','activated','demo_funding','virtual_funding','withdrawal_paused','withdrawal_unpaused','withdrawal_hold','withdrawal_release','withdrawal_approved','withdrawal_rejected','virtual_deposit_approved','virtual_deposit_rejected','virtual_wallet_reset','staff_access_updated'));

create table if not exists public.staff_permissions (
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null check (permission in ('customer_access','support_messages','wallet_funding','wallet_requests')),
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (staff_user_id,permission)
);
create table if not exists public.staff_customer_assignments (
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (staff_user_id,customer_user_id),
  check (staff_user_id <> customer_user_id)
);
alter table public.staff_permissions enable row level security;
alter table public.staff_customer_assignments enable row level security;
revoke all on public.staff_permissions,public.staff_customer_assignments from anon,authenticated;

create or replace function public.has_staff_permission(p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles r join public.staff_permissions p on p.staff_user_id=r.user_id
    where r.user_id=(select auth.uid()) and r.role='staff' and p.permission=p_permission);
$$;
revoke all on function public.has_staff_permission(text) from public,anon;
grant execute on function public.has_staff_permission(text) to authenticated;

create or replace function public.is_staff_assigned_customer(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_customer_assignments a join public.user_roles r on r.user_id=a.staff_user_id and r.role='staff'
    where a.staff_user_id=(select auth.uid()) and a.customer_user_id=p_customer_id);
$$;
revoke all on function public.is_staff_assigned_customer(uuid) from public,anon;
grant execute on function public.is_staff_assigned_customer(uuid) to authenticated;

create or replace function public.admin_set_staff_access(p_admin_id uuid,p_staff_user_id uuid,p_permissions text[],p_customer_ids uuid[],p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target_role text; v_reason text;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Service role required.'; end if;
  if not exists(select 1 from public.user_roles where user_id=p_admin_id and role='admin') then raise exception 'Administrator access is required.'; end if;
  if p_staff_user_id is null or p_staff_user_id=p_admin_id then raise exception 'Choose a different account for staff access.'; end if;
  select role into v_target_role from public.user_roles where user_id=p_staff_user_id;
  if v_target_role='admin' then raise exception 'An administrator account cannot be changed into staff.'; end if;
  if p_enabled and (coalesce(cardinality(p_permissions),0)=0 or coalesce(cardinality(p_customer_ids),0)=0) then raise exception 'Choose at least one permission and one customer.'; end if;
  if exists(select 1 from unnest(coalesce(p_permissions,array[]::text[])) requested(permission) where requested.permission not in ('customer_access','support_messages','wallet_funding','wallet_requests')) then raise exception 'Unsupported staff permission.'; end if;
  if exists(select 1 from unnest(coalesce(p_customer_ids,array[]::uuid[])) requested(customer_id) left join public.user_roles r on r.user_id=requested.customer_id where requested.customer_id=p_staff_user_id or r.role in ('admin','staff')) then raise exception 'Assignments must point to customer accounts.'; end if;
  delete from public.staff_permissions where staff_user_id=p_staff_user_id;
  delete from public.staff_customer_assignments where staff_user_id=p_staff_user_id;
  if p_enabled then
    insert into public.user_roles(user_id,role) values(p_staff_user_id,'staff') on conflict(user_id) do update set role='staff';
    insert into public.staff_permissions(staff_user_id,permission,assigned_by) select p_staff_user_id,requested.permission,p_admin_id from unnest(p_permissions) requested(permission) on conflict do nothing;
    insert into public.staff_customer_assignments(staff_user_id,customer_user_id,assigned_by) select p_staff_user_id,requested.customer_id,p_admin_id from unnest(p_customer_ids) requested(customer_id) on conflict do nothing;
    v_reason := 'Staff permissions: '||array_to_string(p_permissions,', ')||'; assigned customers: '||cardinality(p_customer_ids)::text;
  else
    insert into public.user_roles(user_id,role) values(p_staff_user_id,'customer') on conflict(user_id) do update set role='customer';
    v_reason := 'Staff access removed; account returned to customer access.';
  end if;
  insert into public.admin_action_log(admin_id,target_user_id,action,reason) values(p_admin_id,p_staff_user_id,'staff_access_updated',left(v_reason,500));
end;
$$;
revoke all on function public.admin_set_staff_access(uuid,uuid,text[],uuid[],boolean) from public,anon,authenticated;
grant execute on function public.admin_set_staff_access(uuid,uuid,text[],uuid[],boolean) to service_role;

create or replace function public.can_access_support_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_current_user_admin() or exists (select 1 from public.support_conversations c where c.id=p_conversation_id and (
    c.customer_id=(select auth.uid()) or (public.has_staff_permission('support_messages') and public.is_staff_assigned_customer(c.customer_id))));
$$;
revoke all on function public.can_access_support_conversation(uuid) from public,anon;
grant execute on function public.can_access_support_conversation(uuid) to authenticated;

drop policy if exists "Customers and admins can read support conversations" on public.support_conversations;
create policy "Customers and admins can read support conversations" on public.support_conversations for select to authenticated
  using (customer_id=(select auth.uid()) or public.is_current_user_admin() or (public.has_staff_permission('support_messages') and public.is_staff_assigned_customer(customer_id)));
drop policy if exists "Customers and admins can start support conversations" on public.support_conversations;
create policy "Customers and admins can start support conversations" on public.support_conversations for insert to authenticated
  with check ((customer_id=(select auth.uid()) or public.is_current_user_admin() or (public.has_staff_permission('support_messages') and public.is_staff_assigned_customer(customer_id))) and status='open');
