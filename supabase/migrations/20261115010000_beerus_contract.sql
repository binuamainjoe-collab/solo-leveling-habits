-- Beerus's contract in the traces: what each reply broke, and what the
-- router's budget did. See supabase/functions/_shared/beerus/contract.ts
-- (checkReply) and router.ts (fitHistory, the catalogue switch).

alter table public.beerus_traces add column if not exists violations text[] not null default '{}';
alter table public.beerus_traces add column if not exists changes_dropped integer not null default 0;
alter table public.beerus_traces add column if not exists catalog_sent boolean not null default false;
alter table public.beerus_traces add column if not exists history_trimmed integer not null default 0;
alter table public.beerus_traces add column if not exists over_budget boolean not null default false;

-- The insert grant from the first traces migration was table-wide, so it
-- covers these columns; update stays limited to the rating.
