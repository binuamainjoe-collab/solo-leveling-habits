-- The Player picks Beerus's models, and Beerus keeps their files.
--
--   * user_settings: one row per account. `models` holds the model picked
--     for each part of the System (see MODEL_CHOICES in
--     supabase/functions/_shared/models.ts; the functions ignore any id not
--     on that list). `learned_until` is the learning pass's bookmark: the
--     last message it has read.
--   * profile_documents gains Beerus's notes on each file (what it says
--     about the Player, fed into every prompt) and where the original is
--     kept, so recall can read it whole later.
--   * the `knowledge` storage bucket: private, 20 MB a file. Each account
--     can read, add and delete files in its own folder (named after its
--     user id) and nothing else. The developer keeps access through the
--     dashboard and the service role.

-- --------------------------------------------------------- 1. settings

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  models jsonb not null default '{}'::jsonb,
  learned_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_settings to authenticated;

-- ------------------------------------------------- 2. the file library

alter table public.profile_documents add column if not exists notes text;
alter table public.profile_documents add column if not exists storage_path text;
alter table public.profile_documents add column if not exists mime_type text;
alter table public.profile_documents add column if not exists size_bytes integer;

insert into storage.buckets (id, name, public, file_size_limit)
values ('knowledge', 'knowledge', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "knowledge: read own files" on storage.objects;
create policy "knowledge: read own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'knowledge' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "knowledge: add own files" on storage.objects;
create policy "knowledge: add own files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'knowledge' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "knowledge: delete own files" on storage.objects;
create policy "knowledge: delete own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'knowledge' and (storage.foldername(name))[1] = (select auth.uid())::text);
