-- Long-term goals and the shadows that work on them.
--
-- These tables are written only by edge functions running as the service
-- role. Every one has RLS enabled with no policies, which denies all client
-- access: the app reaches them through `goal-api`, gated on the same
-- `x-app-secret` header the agents use. Nothing here is reachable with the
-- anon key alone, even though that key ships in the bundle.

-- ------------------------------------------------------------------ goals
create table if not exists public.goals (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(btrim(title)) between 4 and 160),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- One goal at a time, enforced rather than merely intended. A partial unique
-- index permits any number of inactive rows but only a single active one, so
-- "set this goal active" cannot half-succeed and leave two.
create unique index if not exists goals_one_active
  on public.goals (active)
  where active;

alter table public.goals enable row level security;

-- --------------------------------------------------------------- findings
create table if not exists public.findings (
  id                 uuid primary key default gen_random_uuid(),
  goal_id            uuid not null references public.goals (id) on delete cascade,
  title              text not null,
  -- Grounding returns a Vertex AI Search redirect, not the publisher's own
  -- address, and those expire. Nullable so a finding with a broken or missing
  -- link is still kept — the title and summary remain useful.
  url                text,
  summary            text not null default '',

  -- Everything below is null until Igris has ruled.
  score              integer check (score between 1 and 10),
  rank               text    check (rank in ('E','D','C','B','A','S')),
  minutes_to_consume integer check (minutes_to_consume between 1 and 600),
  verdict            text    check (verdict in ('skip','skim','read','must-read')),
  reason             text,

  created_at         timestamptz not null default now(),
  -- Set when the student has actually read it and marked it done.
  read_at            timestamptz
);

-- The duplicate guard. The scout also checks before inserting, but two runs
-- racing would both pass that check — this is what actually prevents it.
create unique index if not exists findings_unique_url
  on public.findings (goal_id, url)
  where url is not null;

create index if not exists findings_unjudged
  on public.findings (goal_id)
  where score is null;

alter table public.findings enable row level security;

-- ------------------------------------------------------------- agent_runs
--
-- `agent` is free text rather than an enum: the roster is expected to grow,
-- and raising a new shadow should not require a migration.
create table if not exists public.agent_runs (
  id             uuid primary key default gen_random_uuid(),
  agent          text not null,
  status         text not null default 'running' check (status in ('running','ok','error')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  output_summary text,
  error          text
);

create index if not exists agent_runs_recent
  on public.agent_runs (agent, started_at desc);

alter table public.agent_runs enable row level security;

comment on table public.goals is
  'Service-role only. RLS is on with no policies, which denies every client.';
comment on table public.findings is
  'Service-role only. Written by beru-scout, scored by igris-judge.';
comment on table public.agent_runs is
  'Service-role only. One row per agent run, for the roster status line.';

-- ------------------------------------------------------- activate_goal
--
-- Swapping the active goal has to clear the old one and set the new one
-- together: doing it as two statements would momentarily violate the
-- one-active index and fail, or leave none active if the second failed.
create or replace function public.activate_goal(p_goal uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.goals set active = false where active and id <> p_goal;
  update public.goals set active = true  where id = p_goal;
end;
$$;

revoke all on function public.activate_goal(uuid) from public, anon, authenticated;
grant execute on function public.activate_goal(uuid) to service_role;

-- ------------------------------------------------- bump_usage, by amount
--
-- A shadow costs more than one model call: Beru searches and then structures,
-- and it has to know both are affordable before spending the first. The old
-- one-at-a-time version is replaced by one that reserves a whole run, with
-- the amount defaulting to 1 so plan-tomorrow's existing call is unchanged.
--
-- Still a single statement, so two runs racing for the last of the budget
-- cannot both be allowed through.
drop function if exists public.bump_usage(integer);

create or replace function public.bump_usage(p_limit integer, p_amount integer default 1)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  if p_amount < 1 then
    raise exception 'bump_usage: amount must be at least 1';
  end if;

  insert into public.usage as u (day, calls)
  values (current_date, p_amount)
  on conflict (day) do update
    set calls = u.calls + p_amount
    where u.calls + p_amount <= p_limit
  returning u.calls into n;

  return n;  -- null means the run would not fit in what is left
end;
$$;

comment on function public.bump_usage(integer, integer) is
  'Atomically reserve p_amount model calls for today; returns the new total, or null if the reservation would exceed p_limit.';

revoke all on function public.bump_usage(integer, integer) from public, anon, authenticated;
grant execute on function public.bump_usage(integer, integer) to service_role;
