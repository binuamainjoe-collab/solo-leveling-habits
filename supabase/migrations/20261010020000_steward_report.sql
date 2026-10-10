-- The Steward: a supervisor that reports on the other shadows once a day.
--
-- Everything here exists so that CODE can compute every number in the daily
-- report and the model is only ever asked for words. Each table below is a
-- source of hard facts; none of it is written by an agent's judgement.

-- ----------------------------------------------------------- extensions
--
-- pg_cron schedules the nightly run; pg_net makes the HTTP call to the edge
-- function. Both ship with Supabase but are off by default on a new project.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ------------------------------------------------- agent_runs: accounting
--
-- `tokens_thoughts` is separate from `tokens_out` on purpose. Gemini reports
-- `candidatesTokenCount` WITHOUT the reasoning tokens, but bills reasoning at
-- the output rate — so a cost computed from `tokens_out` alone silently
-- under-reports. Keeping both means the Steward can state a true cost and
-- still show what was visible output.
alter table public.agent_runs add column if not exists tokens_in       integer;
alter table public.agent_runs add column if not exists tokens_out      integer;
alter table public.agent_runs add column if not exists tokens_thoughts integer;
alter table public.agent_runs add column if not exists duration_ms     integer;
alter table public.agent_runs add column if not exists model           text;

comment on column public.agent_runs.tokens_out is
  'Visible output tokens (candidatesTokenCount). Excludes reasoning.';
comment on column public.agent_runs.tokens_thoughts is
  'Reasoning tokens (thoughtsTokenCount). Billed as output; add to tokens_out for cost.';

-- -------------------------------------------------------- daily_snapshots
--
-- One row per day, written by the app rather than derived server-side: the
-- quest board and the day log live in local storage, so the device is the
-- only thing that knows them. Upserted repeatedly through the day; the last
-- write before midnight is the one the Steward reads.
create table if not exists public.daily_snapshots (
  date              date primary key,
  xp_gained         integer     not null default 0,
  level             integer     not null default 1,
  streak            integer     not null default 0,
  quests_done       integer     not null default 0,
  quests_total      integer     not null default 0,
  planned_done      integer     not null default 0,
  planned_total     integer     not null default 0,
  -- When tomorrow's plan was accepted, so the Steward can tell the difference
  -- between "no plan" and "planned but did not follow it".
  plan_accepted_at  timestamptz,
  -- Mandatory quests still outstanding at write time, by title.
  mandatory_missed  text[]      not null default '{}',
  updated_at        timestamptz not null default now()
);

alter table public.daily_snapshots enable row level security;

comment on table public.daily_snapshots is
  'Service-role only. Written by log-snapshot from the device, read by steward-report.';

-- ---------------------------------------------------------------- reports
--
-- Always written, even on failure. A day with no row means the run never
-- fired at all, which is itself the thing worth noticing.
create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  date       date not null,
  -- sent: the model wrote it and it went out.
  -- fallback: the model failed validation or was unavailable; the
  --   deterministic template went out instead.
  -- failed: nothing went out.
  status     text not null check (status in ('sent', 'fallback', 'failed')),
  -- The computed facts, exactly as handed to the model. Never contains a
  -- secret: the collector selects named columns only.
  facts      jsonb not null,
  -- The narration, or the template that stood in for it.
  report     jsonb,
  email_id   text,
  error      text,
  created_at timestamptz not null default now()
);

-- The gate asks "has a report already gone out today?", so index the exact
-- question rather than the whole table.
create index if not exists reports_day_settled
  on public.reports (date)
  where status in ('sent', 'fallback');

create index if not exists reports_recent
  on public.reports (created_at desc);

alter table public.reports enable row level security;

comment on table public.reports is
  'Service-role only. One row per attempt; status says what actually happened.';
