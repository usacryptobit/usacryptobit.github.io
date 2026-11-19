-- Persistent unread support-message notifications for customers.
alter table public.support_conversations add column if not exists customer_last_read_at timestamptz;

create or replace function public.get_customer_unread_messages()
returns table(unread_count bigint,latest_conversation_id uuid,latest_subject text,latest_message_id bigint,latest_message text,latest_created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with unread as (
    select m.id,m.conversation_id,c.subject,m.body,m.created_at
    from public.support_messages m
    join public.support_conversations c on c.id=m.conversation_id
    where c.customer_id=(select auth.uid())
      and m.sender_id<>(select auth.uid())
      and m.created_at>coalesce(c.customer_last_read_at,'epoch'::timestamptz)
  )
  select
    (select count(*) from unread),
    (select conversation_id from unread order by created_at desc,id desc limit 1),
    (select subject from unread order by created_at desc,id desc limit 1),
    (select id from unread order by created_at desc,id desc limit 1),
    (select left(body,240) from unread order by created_at desc,id desc limit 1),
    (select created_at from unread order by created_at desc,id desc limit 1);
$$;
revoke all on function public.get_customer_unread_messages() from public,anon;
grant execute on function public.get_customer_unread_messages() to authenticated;

drop function if exists public.mark_customer_support_read(uuid);
create function public.mark_customer_support_read(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_read_at timestamptz;
begin
  if v_user is null then raise exception 'Sign in is required.'; end if;
  update public.support_conversations set customer_last_read_at=now()
    where id=p_conversation_id and customer_id=v_user
    returning customer_last_read_at into v_read_at;
  if not found then raise exception 'Customer conversation not found.'; end if;
  return v_read_at;
end;
$$;
revoke all on function public.mark_customer_support_read(uuid) from public,anon;
grant execute on function public.mark_customer_support_read(uuid) to authenticated;
