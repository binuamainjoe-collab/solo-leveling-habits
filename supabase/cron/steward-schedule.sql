-- ============================================================================
--  RUN THIS IN THE SUPABASE SQL EDITOR — NOT AS A MIGRATION.
--
--  It puts the app secret into Vault. A migration lives in git, and a secret
--  in git is not a secret. Everything here is idempotent, so re-running it is
--  safe.
--
--  Dashboard → SQL Editor → New query → paste → Run.
-- ============================================================================


-- ---------------------------------------------------------------- 1. Vault
--
-- Two entries: where the function lives, and the secret it demands. The cron
-- job reads both at run time, so rotating the secret means updating one row
-- here rather than editing a scheduled job.

select vault.create_secret(
  'https://zndxpdeziqvdlcmmyblq.supabase.co',
  'project_url',
  'Base URL for edge function calls from pg_cron'
);

-- Replace the first argument with the APP_SECRET you set under
-- Edge Functions → Secrets. It must match exactly.
select vault.create_secret(
  'PASTE_YOUR_APP_SECRET_HERE',
  'app_secret',
  'x-app-secret header for edge function calls from pg_cron'
);


-- ------------------------------------------------------------- 2. The job
--
-- Fires at 18:00 and 19:00 UTC. Vienna is UTC+2 in summer and UTC+1 in
-- winter, so exactly one of those two is 20:00 local on any given day — the
-- other one hits the function's gate and returns {skipped:true} without
-- doing any work. That is why the gate exists rather than a single cron line:
-- pg_cron has no notion of a timezone.
--
-- timeout_milliseconds is 120000 deliberately. pg_net's default is a couple
-- of seconds, and a Steward run takes 10–60: collecting facts, one model
-- call, maybe a retry, then the send. At the default every scheduled run
-- would be cut off mid-flight and the report would silently never arrive.
--
-- pg_net is fire-and-forget and does not retry. The cron log therefore only
-- proves the request was dispatched — the `reports` table is the record of
-- what actually happened.

select cron.schedule(
  'steward-daily-report',
  '0 18,19 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/steward-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-app-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'app_secret')
    ),
    body := jsonb_build_object('trigger', 'cron'),
    timeout_milliseconds := 120000
  );
  $$
);


-- ------------------------------------------------------------- 3. Checks
--
-- Run these after the first scheduled fire to confirm it is working.

-- The job exists and is active:
--   select jobid, schedule, jobname, active from cron.job;

-- Did it fire, and did the SQL itself succeed?
--   select jobid, status, return_message, start_time
--   from cron.job_run_details order by start_time desc limit 10;

-- What did the HTTP call actually return? (pg_net is async — the row
-- appears a moment after the request completes.)
--   select id, status_code, left(content, 300) as body, created
--   from net._http_response order by created desc limit 5;

-- And what the Steward itself recorded, which is the real answer:
--   select date, status, email_id, error, created_at
--   from public.reports order by created_at desc limit 5;


-- ------------------------------------------------------------- 4. Undo
--
--   select cron.unschedule('steward-daily-report');
