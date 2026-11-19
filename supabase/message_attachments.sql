-- Optional private picture attachments for customer/admin support messages.
alter table public.support_messages add column if not exists attachment_path text;
alter table public.support_messages add column if not exists attachment_name text;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('support-attachments','support-attachments',false,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Support participants can view message pictures" on storage.objects;
create policy "Support participants can view message pictures" on storage.objects
  for select to authenticated using (
    bucket_id='support-attachments' and exists (
      select 1 from public.support_conversations c
      where c.id::text=(storage.foldername(name))[1] and public.can_access_support_conversation(c.id)
    )
  );

drop policy if exists "Participants can upload their support message pictures" on storage.objects;
create policy "Participants can upload their support message pictures" on storage.objects
  for insert to authenticated with check (
    bucket_id='support-attachments'
    and (storage.foldername(name))[2]=(select auth.uid())::text
    and exists (
      select 1 from public.support_conversations c
      where c.id::text=(storage.foldername(name))[1] and public.can_access_support_conversation(c.id)
    )
  );
alter table public.support_messages add column if not exists body_html text;
