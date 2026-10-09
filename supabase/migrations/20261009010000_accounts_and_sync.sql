-- Google accounts and cross-device sync.
--
-- Until now the app was local-first with no user tables at all. Signing in
-- with Google means one account has to be reachable from the phone and from
-- the web build, so progress now lives here as well as on the device. The
-- device copy stays authoritative while offline; `src/data/sync.ts` merges the
-- two whenever both have moved.

-- ---------------------------------------------------------------- profiles
--
-- auth.users already holds the Google name, email and avatar, but it is not
-- readable from the client. This is the readable projection, kept in step by
-- the trigger below so the account switcher has something to show.

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------- progress
--
-- One row per account, holding the whole ProgressState as JSON.
--
-- Deliberately not normalised. The state is a single document that only ever
-- makes sense as a whole: streaks, perfect days and category coverage are all
-- derived from the day log, so splitting it into tables would buy queryability
-- the app never uses and cost a migration every time a field is added. One
-- student's lifetime of days is a few hundred kilobytes.

create table if not exists public.progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null,
  -- The client's own write timestamp, which is what sync.ts compares. Distinct
  -- from `server_at` so a device with a wrong clock cannot win forever.
  updated_at timestamptz not null,
  server_at  timestamptz not null default now(),
  -- Bumped on every write so a client can tell "nothing changed" cheaply.
  revision   bigint not null default 1
);

alter table public.progress enable row level security;

create policy "read own progress"
  on public.progress for select
  using (auth.uid() = user_id);

create policy "insert own progress"
  on public.progress for insert
  with check (auth.uid() = user_id);

create policy "update own progress"
  on public.progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_progress()
returns trigger
language plpgsql
as $$
begin
  new.server_at := now();
  new.revision  := coalesce(old.revision, 0) + 1;
  return new;
end;
$$;

drop trigger if exists progress_touch on public.progress;
create trigger progress_touch
  before update on public.progress
  for each row execute function public.touch_progress();

-- ----------------------------------------------------------- google_tokens
--
-- The Google refresh token, used to mint access tokens for Calendar and Tasks.
--
-- This table has RLS on and NO policies, on purpose: that denies every client,
-- signed in or not. Only the edge functions reach it, through the service
-- role, which bypasses RLS. A student's refresh token is never readable from
-- the app even by the student it belongs to — there is no reason for the
-- client to hold it, because the function makes the Google calls.

create table if not exists public.google_tokens (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  -- What the student actually consented to, so the app can grey out a feature
  -- rather than calling Google and getting a 403.
  scopes        text[] not null default '{}',
  updated_at    timestamptz not null default now()
);

alter table public.google_tokens enable row level security;

comment on table public.google_tokens is
  'Service-role only. RLS is enabled with no policies, which denies all client access.';

-- --------------------------------------------------------- profile upkeep
--
-- Google is the only identity provider, so name/email/avatar arrive in the
-- user metadata on first sign-in and can change later (a new display name, a
-- new photo). Mirroring them on insert *and* update keeps the switcher honest.

create or replace function public.sync_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, updated_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    now()
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = excluded.full_name,
        avatar_url = excluded.avatar_url,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_saved on auth.users;
create trigger on_auth_user_saved
  after insert or update on auth.users
  for each row execute function public.sync_profile();
