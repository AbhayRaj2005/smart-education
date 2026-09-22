-- ============================================================
--  Student & teacher photos.
--  Run this once in the Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table teachers add column if not exists photo_url text;
alter table students add column if not exists photo_url text;

-- teachers had no write policy at all before this (only read) —
-- needed so the admin panel can save a photo_url onto a teacher row.
drop policy if exists write_teachers on teachers;
create policy write_teachers on teachers for all to authenticated
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- storage bucket for the photos themselves ----------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- anyone signed in can view photos (they're small, non-sensitive
-- ID-card style pictures); only an admin can upload/replace/remove one.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists avatars_admin_write on storage.objects;
create policy avatars_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and auth_role() = 'admin');

drop policy if exists avatars_admin_update on storage.objects;
create policy avatars_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and auth_role() = 'admin');

drop policy if exists avatars_admin_delete on storage.objects;
create policy avatars_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and auth_role() = 'admin');
