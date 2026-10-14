-- The assistant core: several goals with one focus, a memory the System
-- keeps between conversations, and the conversation itself.
--
-- Single-user by design, like the rest of the agent tables: every table here
-- is service-role only (RLS on, no policies), and the edge functions are the
-- only way in. No Google sign-in is needed for any of it.


-- ------------------------------------------------------- several goals, one focus
--
-- `active` keeps its meaning — "not archived" — but no longer has to be
-- unique. `focus` is the one goal the week is planned around; the shadows
-- work on it and the planner leads with it.

drop index if exists public.goals_one_active;

alter table public.goals add column if not exists focus    boolean not null default false;
alter table public.goals add column if not exists deadline date;

create unique index if not exists goals_one_focus
  on public.goals (focus)
  where focus;

-- The goal that was active becomes the focus, so nothing changes for it.
update public.goals
   set focus = true
 where id = (select id from public.goals where active order by created_at desc limit 1)
   and not exists (select 1 from public.goals where focus);

-- Swapping focus in one statement pair, inside one function, so there is
-- never a moment with two focus goals (the index would refuse it) or none.
create or replace function public.set_focus_goal(p_goal uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.goals set focus = false where focus and id <> p_goal;
  update public.goals set focus = true, active = true where id = p_goal;
end;
$$;

revoke all on function public.set_focus_goal(uuid) from public, anon, authenticated;
grant execute on function public.set_focus_goal(uuid) to service_role;

-- activate_goal enforced "exactly one active goal", which is no longer true.
drop function if exists public.activate_goal(uuid);


-- -------------------------------------------------------------------- memory
--
-- Short, durable things the System has learned: "exam on 24 Oct", "works
-- best in the morning", "hates being asked twice". Written only by the
-- assistant function after code has validated them, and forgettable from
-- the app — a memory the student can't see or delete is not one they trust.

create table if not exists public.memories (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('fact', 'preference', 'commitment', 'pattern')),
  content      text not null check (length(btrim(content)) between 3 and 280),
  goal_id      uuid references public.goals (id) on delete set null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  archived_at  timestamptz
);

-- The same sentence twice is one memory.
create unique index if not exists memories_unique_live
  on public.memories (lower(btrim(content)))
  where archived_at is null;

create index if not exists memories_recent
  on public.memories (last_seen_at desc)
  where archived_at is null;

alter table public.memories enable row level security;

comment on table public.memories is
  'Service-role only. What the System remembers about the student; archived, never hard-deleted by the app.';


-- -------------------------------------------------------------- conversation
--
-- One running conversation with the System, so it carries over between the
-- phone and the browser and between days.

create table if not exists public.assistant_messages (
  id         uuid primary key default gen_random_uuid(),
  role       text not null check (role in ('user', 'model')),
  text       text not null check (length(text) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists assistant_messages_recent
  on public.assistant_messages (created_at desc);

alter table public.assistant_messages enable row level security;

comment on table public.assistant_messages is
  'Service-role only. The running conversation with the System.';


-- ------------------------------------------------------------ budget pools
--
-- One counter per named pool per UTC day. The assistant gets its own pool so
-- that chatting never eats into the planner's or the shadows' budgets.

create table if not exists public.usage_pools (
  pool  text    not null,
  day   date    not null default current_date,
  calls integer not null default 0,
  primary key (pool, day)
);

alter table public.usage_pools enable row level security;

comment on table public.usage_pools is
  'Service-role only. Model calls spent per named pool per UTC day.';

create or replace function public.bump_pool(p_pool text, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  insert into public.usage_pools as u (pool, day, calls)
  values (p_pool, current_date, 1)
  on conflict (pool, day) do update
    set calls = u.calls + 1
    where u.calls < p_limit
  returning u.calls into n;

  return n;  -- null means the pool is spent for today
end;
$$;

revoke all on function public.bump_pool(text, integer) from public, anon, authenticated;
grant execute on function public.bump_pool(text, integer) to service_role;
