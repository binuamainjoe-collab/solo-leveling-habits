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
  caller,
  claimCalls,
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

const SYSTEM = `You are Igris, Chief Judge of the System's Council. Your role is adversarial deliberation: ruling on candidates dragged back by Beru to decide what truly deserves the student's limited daily focus.

The student has ADHD: focus is scarce and easily depleted. Spending it on mediocre, bloated, or confusing material carries a severe penalty. Be hard to impress.

Council Deliberation Protocol:
- Deliberate on candidates comparatively against each other, never in isolation. Contrast strengths and weed out redundancy.
- Cognitive Friction vs. Yield Analysis: Penalize unstructured walls of text, passive video playlists, or vague motivational material. Reward bite-sized, high-leverage, interactive, or step-by-step utility.
- Score 1-10: Most things are a 4 or 5. 7 is solid (B). 8 is high-value (A). Reserve 9 and 10 (S-rank) exclusively for resources that fundamentally transform how the goal is pursued.
- Minutes to consume: Provide a realistic estimate of the active engagement time required.
- Verdict: "skip", "skim", "read", or "must-read". Be conservative: only rule "must-read" if the student would genuinely be at a disadvantage without it.
- Reason: One sharp, direct sentence explaining the council ruling. No flattery, no hedging.

Beru opened and read the pages marked "read by Beru: yes", so their summaries describe the real page. For "no", Beru only saw a search result: be warier of those, and never rule one must-read on the strength of a snippet.`;

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
  const early = preflight(req);
  if (early) return early;

  // The signed-in account (Beru passes its caller's session on). `db` reaches
  // only their goals and findings; `sys` is for the shared daily budget alone.
  const who = await caller(req);
  if (who instanceof Response) return who;
  const { db, sys } = who;

  const { data: goal, error: goalError } = await db
    .from('goals')
    .select('id, title')
    .eq('focus', true)
    .maybeSingle();

  if (goalError) {
    console.error('goal read failed', goalError.message);
    return fail('The System could not read your goal.', 500);
  }
  if (!goal) return fail('There is no focus goal to judge against.', 409);

  const { data: pending, error: pendingError } = await db
    .from('findings')
    .select('id, title, url, summary, page_read')
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

  const claim = await claimCalls(sys, CALL_COST);
  if (!claim.ok) return claim.response;

  const runId = await startRun(db, AGENT);

  const candidates = pending
    .map(
      (f) =>
        `id: ${f.id}\ntitle: ${f.title}\nurl: ${f.url ?? '(none)'}\n` +
        `read by Beru: ${f.page_read ? 'yes' : 'no'}\nsummary: ${f.summary ?? ''}`,
    )
    .join('\n\n---\n\n');

  const result = await gemini({
    system: SYSTEM,
    prompt:
      `Goal: ${goal.title}\n\n` +
      `Rule on each candidate below. Return one ruling per candidate, ` +
      `using the exact id given.\n\n${candidates}`,
    schema: SCHEMA,
  });

  // What the call cost, failed or not: a fallback bills both models.
  const spend = { usage: result.usage, durationMs: result.durationMs, model: result.modelVersion ?? MODEL };
  if (!result.ok || !result.text) {
    await finishRun(db, runId, 'error', null, result.error ?? 'judging failed', spend);
    return fail(result.error ?? 'Igris could not reach a ruling.', 502);
  }

  const parsed = parseJson<{ rulings?: Ruling[] }>(result.text);
  const rulings = Array.isArray(parsed?.rulings) ? parsed.rulings : [];
  if (rulings.length === 0) {
    await finishRun(db, runId, 'error', null, 'model returned no rulings', spend);
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
    spend,
  );

  return json({ judged, mustRead });
});
