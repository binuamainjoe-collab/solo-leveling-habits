/**
 * steward-report — the supervisor.
 *
 * Once a day it gathers hard facts about every other shadow and about the
 * student's own progress, has Gemini turn those facts into a few honest
 * sentences, and emails the result.
 *
 * The division of labour is the whole design: CODE computes every number,
 * the MODEL only writes words. `_shared/steward.ts` holds the gate, the
 * anomaly rules, the validator, the fallback and the render — all pure, all
 * fixture-tested. This file is the part that cannot be: the SQL, the model
 * call and the send.
 */

import {
  admin,
  checkSecret,
  fail,
  finishRun,
  gemini,
  json,
  MODEL,
  parseJson,
  preflight,
  startRun,
  DAILY_CAP,
} from '../_shared/agent.ts';

import {
  costUsd,
  deriveFacts,
  detectAnomalies,
  fallbackNarration,
  gate,
  hasCritical,
  NARRATION_SCHEMA,
  parseNarration,
  renderEmail,
  STEWARD_SYSTEM,
  validateNarration,
  type AgentFact,
  type Facts,
  type FindingFact,
  type Narration,
  type SnapshotFact,
} from '../_shared/steward.ts';

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

const AGENT = 'steward-report';

/* ------------------------------------------------------- 2. collect facts */

interface RunRow {
  agent: string;
  status: string;
  error: string | null;
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_thoughts: number | null;
}

/**
 * Everything the report is allowed to know, read straight out of Postgres.
 *
 * Columns are named explicitly rather than selected with `*`: that is what
 * guarantees a secret can never find its way into `reports.facts`, no matter
 * what someone adds to a table later.
 */
async function collectFacts(db: SupabaseClient, date: string): Promise<Facts> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [runsRes, usageRes, goalRes, findingsRes, snapsRes] = await Promise.all([
    db
      .from('agent_runs')
      .select('agent, status, error, duration_ms, tokens_in, tokens_out, tokens_thoughts')
      .gte('started_at', since),
    db.from('usage').select('calls').eq('day', date).maybeSingle(),
    db.from('goals').select('title').eq('active', true).maybeSingle(),
    db
      .from('findings')
      .select('title, rank, score, verdict, minutes_to_consume, url, created_at')
      .gte('created_at', since)
      .order('score', { ascending: false, nullsFirst: false })
      .limit(50),
    db
      .from('daily_snapshots')
      .select(
        'date, xp_gained, level, streak, quests_done, quests_total, planned_done, planned_total, plan_accepted_at, mandatory_missed',
      )
      .lte('date', date)
      .order('date', { ascending: false })
      .limit(8),
  ]);

  // Per agent, folded from the raw run rows.
  const byAgent = new Map<string, AgentFact>();
  for (const r of (runsRes.data ?? []) as RunRow[]) {
    const a =
      byAgent.get(r.agent) ??
      {
        agent: r.agent,
        runs: 0,
        ok: 0,
        failed: 0,
        last_error: null,
        avg_duration_ms: 0,
        tokens_in: 0,
        tokens_out: 0,
        tokens_thoughts: 0,
        cost_usd: 0,
      };

    a.runs += 1;
    if (r.status === 'ok') a.ok += 1;
    if (r.status === 'error') {
      a.failed += 1;
      if (r.error) a.last_error = r.error.slice(0, 200);
    }
    a.tokens_in += r.tokens_in ?? 0;
    a.tokens_out += r.tokens_out ?? 0;
    a.tokens_thoughts += r.tokens_thoughts ?? 0;
    // Accumulate then divide once, below.
    a.avg_duration_ms += r.duration_ms ?? 0;
    byAgent.set(r.agent, a);
  }

  const agents = [...byAgent.values()].map((a) => ({
    ...a,
    avg_duration_ms: a.runs > 0 ? Math.round(a.avg_duration_ms / a.runs) : 0,
    cost_usd: costUsd(a.tokens_in, a.tokens_out, a.tokens_thoughts),
  }));

  const callsToday = (usageRes.data?.calls as number | undefined) ?? 0;

  const allFindings = (findingsRes.data ?? []) as (FindingFact & { created_at: string })[];
  const top: FindingFact[] = allFindings.slice(0, 3).map((f) => ({
    title: f.title,
    rank: f.rank,
    score: f.score,
    verdict: f.verdict,
    minutes_to_consume: f.minutes_to_consume,
    url: f.url,
  }));

  const snaps = (snapsRes.data ?? []) as SnapshotFact[];
  const today = snaps.find((s) => s.date === date) ?? null;
  const previous = snaps.filter((s) => s.date !== date).slice(0, 7);

  return deriveFacts({
    date,
    goal: (goalRes.data?.title as string | undefined) ?? null,
    agents,
    usage: {
      calls_today: callsToday,
      cap: DAILY_CAP,
      pct_of_cap: Math.round((callsToday / DAILY_CAP) * 100),
    },
    findings: { created_today: allFindings.length, top },
    today,
    previous,
  });
}

/* ------------------------------------------------------------ 4. narrate */

async function narrate(
  facts: Facts,
  violations: string[],
): Promise<{ narration: Narration | null; usage?: ReturnType<typeof Object>; raw?: unknown; error?: string; modelVersion?: string; durationMs?: number; tokens?: { in: number; out: number; thoughts: number } }> {
  const retryNote =
    violations.length > 0
      ? `\n\nYour previous answer was rejected. Every number you write must appear in the FACTS JSON. These did not:\n- ${violations.join('\n- ')}\nRewrite it using only numbers that are present.`
      : '';

  const result = await gemini({
    system: STEWARD_SYSTEM,
    prompt: `FACTS:\n${JSON.stringify(facts, null, 2)}${retryNote}`,
    schema: NARRATION_SCHEMA,
    temperature: 0.3,
    // 'minimal' errors on 3.8 Flash; 'low' is the cheap, fast setting, and
    // omitting it would silently default to 'high'.
    thinkingLevel: 'low',
  });

  if (!result.ok || !result.text) {
    return { narration: null, error: result.error, durationMs: result.durationMs };
  }

  return {
    narration: parseNarration(parseJson<unknown>(result.text)),
    modelVersion: result.modelVersion,
    durationMs: result.durationMs,
    tokens: result.usage ? { in: result.usage.in, out: result.usage.out, thoughts: result.usage.thoughts } : undefined,
  };
}

/* --------------------------------------------------------------- 7. send */

async function sendEmail(
  subject: string,
  html: string,
  text: string,
): Promise<{ id?: string; error?: string }> {
  const key = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('REPORT_TO_EMAIL');
  if (!key) return { error: 'RESEND_API_KEY is not set on this project.' };
  if (!to) return { error: 'REPORT_TO_EMAIL is not set on this project.' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: 'System <onboarding@resend.dev>', to, subject, html, text }),
    });

    const body = await res.text();
    if (!res.ok) {
      // Never echo the key. Resend's own message is safe and usually says
      // exactly what is wrong (a 403 here means the address is not the one
      // the Resend account is registered under).
      console.error('resend error', res.status, body.slice(0, 300));
      return { error: `Resend returned ${res.status}: ${body.slice(0, 200)}` };
    }
    return { id: (JSON.parse(body) as { id?: string }).id };
  } catch (err) {
    return { error: `Could not reach Resend. ${err instanceof Error ? err.message : ''}`.trim() };
  }
}

/* ------------------------------------------------------------- the shell */

Deno.serve(async (req: Request): Promise<Response> => {
  const early = preflight(req) ?? checkSecret(req);
  if (early) return early;

  const db = admin();
  if (!db) return fail('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.', 500);

  let force = false;
  let forceFallback = false;
  try {
    const body = (await req.json().catch(() => ({}))) as { force?: unknown; force_fallback?: unknown };
    force = body.force === true;
    // A permanent way to exercise the fallback path without having to break
    // a secret in the dashboard.
    forceFallback = body.force_fallback === true;
  } catch {
    // An empty body is how cron calls it.
  }

  const now = new Date();

  // --------------------------------------------------------------- 1. gate
  const probeDate = gate({ now, settledToday: false, force }).date;
  const { data: settled } = await db
    .from('reports')
    .select('id')
    .eq('date', probeDate)
    .in('status', ['sent', 'fallback'])
    .limit(1);

  const decision = gate({ now, settledToday: (settled?.length ?? 0) > 0, force });
  if (!decision.run) {
    return json({ skipped: true, reason: decision.reason, date: decision.date, hour: decision.hour });
  }

  const runId = await startRun(db, AGENT);

  // ------------------------------------------------------------ 2 & 3
  let facts: Facts;
  try {
    facts = await collectFacts(db, decision.date);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fact collection failed';
    await finishRun(db, runId, 'error', null, message);
    await db.from('reports').insert({ date: decision.date, status: 'failed', facts: {}, error: message });
    return fail('The Steward could not gather the facts.', 500);
  }

  const anomalies = detectAnomalies(facts);

  // ------------------------------------------------------- 4 & 5
  let narration: Narration | null = null;
  let status: 'sent' | 'fallback' | 'failed' = 'fallback';
  let narrationError: string | null = null;
  let modelVersion: string | undefined;
  let durationMs = 0;
  let tokens = { in: 0, out: 0, thoughts: 0 };

  // The cap is shared with the other shadows. A day that has spent it is
  // exactly the day a report is worth having, so run the deterministic
  // template rather than going silent.
  const capExhausted = facts.usage.calls_today >= DAILY_CAP;

  if (forceFallback) {
    narrationError = 'force_fallback was requested';
  } else if (capExhausted) {
    narrationError = `daily cap of ${DAILY_CAP} already spent; narration skipped`;
  } else {
    let violations: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await narrate(facts, violations);
      durationMs += out.durationMs ?? 0;
      if (out.modelVersion) modelVersion = out.modelVersion;
      if (out.tokens) {
        tokens = {
          in: tokens.in + out.tokens.in,
          out: tokens.out + out.tokens.out,
          thoughts: tokens.thoughts + out.tokens.thoughts,
        };
      }

      if (!out.narration) {
        narrationError = out.error ?? 'the model returned an unusable shape';
        break;
      }

      const check = validateNarration(out.narration, facts);
      if (check.ok) {
        narration = out.narration;
        status = 'sent';
        break;
      }

      violations = check.violations;
      narrationError = `invented numbers: ${check.violations.join('; ')}`;
      console.warn('narration failed validation', check.violations);
    }
  }

  if (!narration) {
    narration = fallbackNarration(facts, anomalies);
    status = 'fallback';
  }

  // --------------------------------------------------------- 6 & 7
  const mail = renderEmail(facts, narration, anomalies);
  const sent = await sendEmail(mail.subject, mail.html, mail.text);

  if (sent.error) {
    status = 'failed';
    narrationError = [narrationError, sent.error].filter(Boolean).join(' | ');
  }

  // ------------------------------------------------------------ 8. persist
  const { error: reportError } = await db.from('reports').insert({
    date: decision.date,
    status,
    facts,
    report: narration,
    email_id: sent.id ?? null,
    error: narrationError,
  });
  if (reportError) console.error('could not store report', reportError.message);

  await finishRun(
    db,
    runId,
    status === 'failed' ? 'error' : 'ok',
    `${status}: ${anomalies.length} anomalies, ${narration.problems.length} problems`,
    narrationError,
    { usage: tokens, durationMs, model: modelVersion ?? MODEL },
  );

  return json({
    status,
    date: decision.date,
    subject: mail.subject,
    anomalies: anomalies.map((a) => ({ code: a.code, severity: a.severity })),
    alert: hasCritical(anomalies),
    email_id: sent.id ?? null,
    model_version: modelVersion ?? null,
    error: narrationError,
  });
});
