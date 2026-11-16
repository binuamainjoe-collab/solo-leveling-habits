-- Beerus's traces: one row per reply, for tuning his router from real use.
--
-- See supabase/functions/_shared/beerus/learning.ts (buildTrace). A row holds
-- the route the router picked, how much went into the prompt, how long the
-- reply took, what it cost and what came out. It holds no message text and
-- no memory text, so it never becomes a second copy of the conversation.
-- `rating` is left empty until the app asks the Player for one.

create table if not exists public.beerus_traces (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  depth text not null check (depth in ('lean', 'full', 'deep')),
  thinking text not null check (thinking in ('low', 'medium')),
  reason text not null default '',
  mode text not null default 'chat',
  spoken boolean not null default false,
  message_chars integer not null default 0,
  history_turns integer not null default 0,
  memories_sent integer not null default 0,
  memories_total integer not null default 0,
  prompt_chars integer not null default 0,
  duration_ms integer,
  tokens_in integer,
  tokens_out integer,
  tokens_thoughts integer,
  model text,
  outcome text not null check (outcome in ('ok', 'error', 'too_slow', 'not_heard')),
  changes integer not null default 0,
  remembered integer not null default 0,
  learn_started boolean not null default false,
  rating smallint check (rating in (-1, 1))
);

create index if not exists beerus_traces_user_time on public.beerus_traces (user_id, created_at desc);

alter table public.beerus_traces enable row level security;

drop policy if exists "own traces: read" on public.beerus_traces;
create policy "own traces: read" on public.beerus_traces
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "own traces: add" on public.beerus_traces;
create policy "own traces: add" on public.beerus_traces
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Only the rating may change afterwards; the measured fields stay as logged.
drop policy if exists "own traces: rate" on public.beerus_traces;
create policy "own traces: rate" on public.beerus_traces
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Supabase's default privileges grant every new table to anon and
-- authenticated in full; take that back first, so the column grant below is
-- what actually limits an update to the rating.
revoke all on public.beerus_traces from anon, authenticated;
grant select, insert on public.beerus_traces to authenticated;
grant update (rating) on public.beerus_traces to authenticated;

-- ------------------------------------------------- one learning pass at a time
--
-- The assistant now starts a learning pass on its own after a reply, and
-- the app still asks for one after a live call. Without a lock, a few quick
-- messages would start overlapping passes, each spending a turn and adding
-- the same memory in different words. claim_learning() takes the lock for
-- the caller's account; the pass releases it when it moves the bookmark,
-- and a pass that died lets go after two minutes.

alter table public.user_settings add column if not exists learning_started_at timestamptz;

create or replace function public.claim_learning()
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed integer;
begin
  if auth.uid() is null then
    return false;
  end if;
  insert into public.user_settings (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update public.user_settings
     set learning_started_at = now()
   where user_id = auth.uid()
     and (learning_started_at is null or learning_started_at < now() - interval '2 minutes');
  get diagnostics claimed = row_count;
  return claimed > 0;
end;
$$;

revoke all on function public.claim_learning() from public, anon;
grant execute on function public.claim_learning() to authenticated;
