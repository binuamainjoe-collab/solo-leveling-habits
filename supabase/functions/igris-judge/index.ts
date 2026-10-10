/**
 * igris-judge — the shadow that rules on what Beru dragged back.
 *
 * Scores every unjudged finding against the active goal in a single model
 * call rather than one per finding. That is not only cheaper against the
 * thirty-a-day budget — it is better judging: seeing all the candidates at
 * once lets Igris rank them against each other instead of grading each in
 * isolation and calling four different things an 8.
 *
 * Normally raised by Beru at the end of a scout run. It can also be called
 * directly to re-rule on anything left unjudged by a failed run.
 */

import {
  admin,
  claimCalls,
  checkSecret,
  fail,
  finishRun,
  gemini,
  json,
  MODEL,
  parseJson,
  preflight,
  startRun,
} from '../_shared/agent.ts';

const AGENT = 'igris-judge';
const CALL_COST = 1;
/** More than this in one pass and the prompt stops being readable. */
const MAX_BATCH = 12;

const SYSTEM = `You are Igris, and you decide what is worth a student's attention.

The student has ADHD and a limited amount of focus each day. Spending it on something mediocre is a real cost, not a neutral one. Be hard to impress.

For each candidate, judge how much it actually serves the stated goal:
- score 1-10. Most things are a 4 or 5. Reserve 9 and 10 for something that would genuinely change how the student approaches the goal.
- minutes_to_consume: an honest estimate of how long engaging with it properly takes.
- verdict: "skip", "skim", "read" or "must-read". Only call something must-read if the student would be worse off never seeing it.
- reason: one plain sentence, said to the student, explaining the ruling. No hedging, no flattery.

Judge the candidates against each other, not in isolation. If three are similar, say so and rank them.`;

const SCHEMA = {
  type: 'object',
  properties: {
    rulings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          score: { type: 'integer' },
          minutes_to_consume: { type: 'integer' },
          verdict: { type: 'string', enum: ['skip', 'skim', 'read', 'must-read'] },
          reason: { type: 'string' },
        },
        required: ['id', 'score', 'minutes_to_consume', 'verdict', 'reason'],
        propertyOrdering: ['id', 'score', 'minutes_to_consume', 'verdict', 'reason'],
      },
    },
  },
  required: ['rulings'],
  propertyOrdering: ['rulings'],
};

const VERDICTS = ['skip', 'skim', 'read', 'must-read'];

/**
 * Score to hunter rank, per the System's grading.
 *
 * Uneven bands on purpose: D and C are wide because most things are
 * mediocre, while 7, 8 and 9+ each earn their own grade.
 */
function rankForScore(score: number): string {
  const s = Math.max(1, Math.min(10, Math.round(score)));
  if (s >= 9) return 'S';
  if (s === 8) return 'A';
  if (s === 7) return 'B';
  if (s >= 5) return 'C';
  if (s >= 3) return 'D';
  return 'E';
}

interface Ruling {
  id?: unknown;
  score?: unknown;
  minutes_to_consume?: unknown;
  verdict?: unknown;
  reason?: unknown;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const early = preflight(req) ?? checkSecret(req);
  if (early) return early;

  const db = admin();
  if (!db) return fail('The System is not configured.', 500);

  const { data: goal, error: goalError } = await db
    .from('goals')
    .select('id, title')
    .eq('active', true)
    .maybeSingle();

  if (goalError) {
    console.error('goal read failed', goalError.message);
    return fail('The System could not read your goal.', 500);
  }
  if (!goal) return fail('There is no active goal to judge against.', 409);

  const { data: pending, error: pendingError } = await db
    .from('findings')
    .select('id, title, url, summary')
    .eq('goal_id', goal.id)
    .is('score', null)
    .order('created_at', { ascending: true })
    .limit(MAX_BATCH);

  if (pendingError) {
    console.error('findings read failed', pendingError.message);
    return fail('The System could not read the findings.', 500);
  }
  if (!pending || pending.length === 0) {
    // Not an error, and not worth a model call or a budget reservation.
    return json({ judged: 0, note: 'Nothing left to judge.' });
  }

  const claim = await claimCalls(db, CALL_COST);
  if (!claim.ok) return claim.response;

  const runId = await startRun(db, AGENT);

  const candidates = pending
    .map(
      (f) =>
        `id: ${f.id}\ntitle: ${f.title}\nurl: ${f.url ?? '(none)'}\nsummary: ${f.summary ?? ''}`,
    )
    .join('\n\n---\n\n');

  const result = await gemini({
    system: SYSTEM,
    prompt:
      `Goal: ${goal.title}\n\n` +
      `Rule on each candidate below. Return one ruling per candidate, ` +
      `using the exact id given.\n\n${candidates}`,
    schema: SCHEMA,
    temperature: 0.3,
  });

  if (!result.ok || !result.text) {
    await finishRun(db, runId, 'error', null, result.error ?? 'judging failed');
    return fail(result.error ?? 'Igris could not reach a ruling.', 502);
  }

  const parsed = parseJson<{ rulings?: Ruling[] }>(result.text);
  const rulings = Array.isArray(parsed?.rulings) ? parsed.rulings : [];
  if (rulings.length === 0) {
    await finishRun(db, runId, 'error', null, 'model returned no rulings');
    return fail('Igris returned nothing. The findings are still there, unjudged.', 502);
  }

  // Only ids that were actually sent may be written back — a model that
  // invents or hallucinates an id must not touch another goal's rows.
  const allowed = new Set(pending.map((f) => f.id as string));

  let judged = 0;
  let mustRead = 0;

  for (const r of rulings) {
    const id = typeof r.id === 'string' ? r.id : '';
    if (!allowed.has(id)) continue;

    const score = Math.max(1, Math.min(10, Math.round(Number(r.score) || 5)));
    const verdict = VERDICTS.includes(String(r.verdict)) ? String(r.verdict) : 'skim';
    const minutes = Math.max(1, Math.min(600, Math.round(Number(r.minutes_to_consume) || 10)));

    const { error } = await db
      .from('findings')
      .update({
        score,
        rank: rankForScore(score),
        minutes_to_consume: minutes,
        verdict,
        reason: typeof r.reason === 'string' ? r.reason.slice(0, 500) : null,
      })
      .eq('id', id)
      // Belt and braces: the update cannot stray outside this goal even if
      // the id check above were somehow wrong.
      .eq('goal_id', goal.id);

    if (error) {
      console.error('ruling write failed', id, error.message);
      continue;
    }
    judged++;
    if (verdict === 'must-read') mustRead++;
  }

  const summary = `${judged} judged, ${mustRead} must-read`;
  await finishRun(
    db,
    runId,
    judged > 0 ? 'ok' : 'error',
    summary,
    judged > 0 ? null : 'no rulings applied',
    { usage: result.usage, durationMs: result.durationMs, model: result.modelVersion ?? MODEL },
  );

  return json({ judged, mustRead });
});
