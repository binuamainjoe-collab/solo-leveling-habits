-- The life profile: everything The System knows about the Player as a
-- person, kept on the server so every part of it (the assistant, the live
-- call, the planner, the quest proposals) reads the same picture.
--
-- One Player, so one row. Service-role only, like the rest of The System's
-- tables: RLS on, no policies, so nothing holding an anon key can read it.

create table if not exists public.life_profile (
  id text primary key default 'me' check (id = 'me'),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.life_profile enable row level security;
comment on table public.life_profile is
  'Service-role only. The Player''s life profile: section -> field -> value. Written by the profile function.';

-- What the Player uploaded (a class timetable, a syllabus, a work rota),
-- as The System read it. The file itself is not kept: only what was in it.
create table if not exists public.profile_documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'other',
  summary text not null default '',
  -- Weekly fixed blocks: [{day, start, end, title, place}]
  weekly jsonb not null default '[]'::jsonb,
  -- Dated items: [{date, title}]
  dates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table public.profile_documents enable row level security;
comment on table public.profile_documents is
  'Service-role only. What The System read from documents the Player uploaded; archived, never hard-deleted by the app.';

create index if not exists profile_documents_active on public.profile_documents (created_at desc) where archived_at is null;
