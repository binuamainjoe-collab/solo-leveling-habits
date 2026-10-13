-- The planner's own daily budget.
--
-- The planner is a conversation: one model call per message. Sharing the
-- agents' 30-a-day pool meant a single long planning chat could spend a third
-- of the day's budget, and a busy agent day could leave nothing to plan with.
--
-- A separate table rather than a scope column on `usage`: the deployed agents
-- read `usage` with `.maybeSingle()` on the date, and a second row per day
-- would break them. This way the agents are not touched at all.

create table if not exists public.planner_usage (
  day   date    primary key default current_date,
  calls integer not null    default 0
);

alter table public.planner_usage enable row level security;

comment on table public.planner_usage is
  'Service-role only. One row per UTC day: planner chat calls spent.';

-- Same single-statement test-and-increment as bump_usage: two messages
-- racing for the last call of the day cannot both get it.
create or replace function public.bump_planner_usage(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  insert into public.planner_usage as u (day, calls)
  values (current_date, 1)
  on conflict (day) do update
    set calls = u.calls + 1
    where u.calls < p_limit
  returning u.calls into n;

  return n;  -- null means the day is spent
end;
$$;

revoke all on function public.bump_planner_usage(integer) from public, anon, authenticated;
grant execute on function public.bump_planner_usage(integer) to service_role;
