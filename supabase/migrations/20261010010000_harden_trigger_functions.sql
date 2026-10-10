-- Close two gaps the database linter found in the sync migration.
--
-- 1. `touch_progress` ran with a mutable search_path. A trigger function
--    without a pinned path resolves unqualified names against whatever the
--    caller's search_path happens to be, which is the classic way a
--    privileged function is tricked into calling someone else's table.
--
-- 2. Both trigger functions were reachable at /rest/v1/rpc/<name> by anon and
--    authenticated. They are triggers — nothing should ever call them
--    directly — and `sync_profile` is SECURITY DEFINER, so leaving it exposed
--    hands out a function that runs with the owner's rights for no reason.
--    Triggers fire as the table owner regardless, so revoking EXECUTE costs
--    nothing.
--
-- The five remaining "RLS enabled, no policy" notices are deliberate: goals,
-- findings, agent_runs, google_tokens and usage are service-role only, and no
-- policy is the strongest possible setting. Verified by hand — a publishable
-- key reads [] from each, and an insert is rejected with 42501.

create or replace function public.touch_progress()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.server_at := now();
  new.revision  := coalesce(old.revision, 0) + 1;
  return new;
end;
$$;

revoke all on function public.touch_progress() from public, anon, authenticated;
revoke all on function public.sync_profile()   from public, anon, authenticated;

comment on function public.touch_progress() is
  'Trigger only. EXECUTE is revoked from client roles; triggers fire as the table owner.';
comment on function public.sync_profile() is
  'Trigger only. SECURITY DEFINER, so EXECUTE is revoked from client roles.';
