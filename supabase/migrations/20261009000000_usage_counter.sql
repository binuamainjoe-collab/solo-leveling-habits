-- The only table this project needs.
--
-- The nightly briefing is for one student, and their plan, quests and history
-- all live in the app's own local storage. The single thing that has to be
-- server-side is the call counter, because a cap the client could edit is not
-- a cap at all.

create table if not exists public.usage (
  day   date    primary key default current_date,
  calls integer not null    default 0
);

comment on table public.usage is
  'One row per UTC day: how many times plan-tomorrow has called the model.';

-- No policies are defined, so RLS denies everything to anon and authenticated.
-- The edge function reaches this through the service role, which bypasses RLS.
alter table public.usage enable row level security;

-- Test and increment in a single statement.
--
-- `on conflict ... do update ... where` skips the update once the cap is
-- reached, and a skipped update returns no row — so `calls` stays null and the
-- caller is refused. Two requests arriving together therefore cannot both be
-- allowed through on the last remaining call of the day.
create or replace function public.bump_usage(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  insert into public.usage as u (day, calls)
  values (current_date, 1)
  on conflict (day) do update
    set calls = u.calls + 1
    where u.calls < p_limit
  returning u.calls into n;

  return n;  -- null means the day is spent
end;
$$;

comment on function public.bump_usage(integer) is
  'Atomically count one model call for today; returns the new count, or null if the daily cap is already reached.';

-- Only the service role may spend calls.
revoke all on function public.bump_usage(integer) from public, anon, authenticated;
grant execute on function public.bump_usage(integer) to service_role;
