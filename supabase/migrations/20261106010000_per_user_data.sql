-- Every account gets its own System.
--
-- Until now the assistant, the Goal agents and the life profile were built
-- for one player: one profile row, one conversation, one set of goals, read
-- and written by edge functions that held the service role and trusted a
-- shared secret. This gives every one of those rows an owner and lets the
-- database itself keep accounts apart:
--
--   * each table gets user_id, defaulting to the signed-in caller
--     (auth.uid()), so a row written through a caller's session is theirs;
--   * row rules let a signed-in account read and change its own rows and
--     nothing else;
--   * the edge functions now query with the caller's own session token
--     instead of the service role (see caller() in _shared/agent.ts), so a
--     query that forgets a filter still cannot reach another account.
--
-- The developer keeps full access through the dashboard and the service
-- role. The shared daily budgets (usage, usage_pools, planner_usage) stay
-- service-role only.
--
-- Rows written before this belong to the first account on the project, which
-- is the owner's: it was the only player.

-- ------------------------------------------------------------ 1. owners

alter table public.goals             add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade;
alter table public.findings          add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade;
alter table public.agent_runs        add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade;
alter table public.memories          add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade;
alter table public.assistant_messages add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade;
alter table public.daily_snapshots   add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade;
alter table public.reports           add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade;
alter table public.life_profile      add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade;
alter table public.profile_documents add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade;

-- ------------------------------------------- 2. the existing rows' owner

do $$
declare
  owner uuid := (select id from auth.users order by created_at limit 1);
begin
  if owner is null then
    return; -- a fresh project: no users and no rows to give away
  end if;
  update public.goals              set user_id = owner where user_id is null;
  update public.findings           set user_id = owner where user_id is null;
  update public.agent_runs         set user_id = owner where user_id is null;
  update public.memories           set user_id = owner where user_id is null;
  update public.assistant_messages set user_id = owner where user_id is null;
  update public.daily_snapshots    set user_id = owner where user_id is null;
  update public.reports            set user_id = owner where user_id is null;
  update public.life_profile       set user_id = owner where user_id is null;
  update public.profile_documents  set user_id = owner where user_id is null;
end
$$;

alter table public.goals              alter column user_id set not null;
alter table public.findings           alter column user_id set not null;
alter table public.agent_runs         alter column user_id set not null;
alter table public.memories           alter column user_id set not null;
alter table public.assistant_messages alter column user_id set not null;
alter table public.daily_snapshots    alter column user_id set not null;
alter table public.reports            alter column user_id set not null;
alter table public.life_profile       alter column user_id set not null;
alter table public.profile_documents  alter column user_id set not null;

-- ------------------------------------------ 3. keys that were project-wide

-- One profile per account, not one profile: the old 'me' key goes.
alter table public.life_profile drop column if exists id;
alter table public.life_profile add primary key (user_id);

-- One snapshot per account per day.
alter table public.daily_snapshots drop constraint if exists daily_snapshots_pkey;
alter table public.daily_snapshots add primary key (user_id, date);

-- One focus goal per account.
drop index if exists public.goals_one_focus;
create unique index goals_one_focus on public.goals (user_id) where focus;

-- The same sentence twice is one memory, within an account.
drop index if exists public.memories_unique_live;
create unique index memories_unique_live
  on public.memories (user_id, lower(btrim(content)))
  where archived_at is null;

-- A link on file once per goal (goal ids are already per account).
drop index if exists public.findings_unique_url;
create unique index findings_unique_url
  on public.findings (user_id, goal_id, url)
  where url is not null;

-- What the row rules filter on.
create index if not exists goals_owner              on public.goals (user_id);
create index if not exists findings_owner           on public.findings (user_id);
create index if not exists agent_runs_owner         on public.agent_runs (user_id, started_at desc);
create index if not exists memories_owner           on public.memories (user_id);
create index if not exists assistant_messages_owner on public.assistant_messages (user_id, created_at desc);
create index if not exists reports_owner            on public.reports (user_id, date);
create index if not exists profile_documents_owner  on public.profile_documents (user_id);

-- ------------------------------------------------------ 4. the row rules

create policy "own goals" on public.goals for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own findings" on public.findings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own runs" on public.agent_runs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own memories" on public.memories for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own conversation" on public.assistant_messages for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own days" on public.daily_snapshots for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own reports" on public.reports for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own profile" on public.life_profile for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own documents" on public.profile_documents for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- The signed-out anon key reaches none of it.
revoke all on public.goals, public.findings, public.agent_runs, public.memories,
  public.assistant_messages, public.daily_snapshots, public.reports,
  public.life_profile, public.profile_documents
  from anon;

-- ------------------------------------------------- 5. focus, per account

-- Runs as the caller, under the row rules above, and names the caller's rows
-- explicitly as well: switching focus can only ever touch your own goals.
create or replace function public.set_focus_goal(p_goal uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.goals set focus = false
   where focus and id <> p_goal and user_id = (select auth.uid());
  update public.goals set focus = true, active = true
   where id = p_goal and user_id = (select auth.uid());
end;
$$;

revoke all on function public.set_focus_goal(uuid) from public, anon;
grant execute on function public.set_focus_goal(uuid) to authenticated, service_role;

-- Unused since focus replaced it, and it touched every account's goals.
drop function if exists public.activate_goal(uuid);
