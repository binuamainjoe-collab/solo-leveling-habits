/**
 * beru-scout — the shadow that goes looking.
 *
 * Two model calls, deliberately separate:
 *
 *   1. Grounded search. Google Search is attached as a tool so the model
 *      actually looks things up, and the sources come back in
 *      groundingMetadata.
 *   2. Structuring. No tools, a responseSchema, turning call 1's prose into
 *      at most five findings.
 *
 * They cannot be one call. Asking for JSON output alongside google_search
 * silently switches the search off — no error, no warning, just confident
 * ungrounded invention. Splitting them is the only way to get both.
 *
 * Raises Igris at the end so new findings arrive already judged.
 */

import {
  addUsage,
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

const AGENT = 'beru-scout';
/** One grounded search plus one structuring pass. */
const CALL_COST = 2;
const MAX_FINDINGS = 5;

const SEARCH_SYSTEM = `You are Beru, a scout working for a student with ADHD who is chasing one long-term goal.

Search the web for material that genuinely moves this goal forward: guides, courses, syllabuses, past papers, training programmes, tools, communities, first-hand accounts.

Prefer things that are concrete and usable over things that are merely inspiring. A specific past-paper archive beats a listicle about motivation every time. Avoid content farms, SEO filler and anything behind a hard paywall.

Report what you found in plain prose, naming each source and saying in one line what it is and why it helps. Find at most five things worth the student's time — fewer if that is the honest answer.`;

const STRUCTURE_SYSTEM = `Turn the scout's report into structured findings.

Rules:
- At most ${MAX_FINDINGS} items. Fewer is fine.
- Use only sources that appear in the report. Invent nothing, and never guess a URL.
- The summary is one or two plain sentences saying what the thing is and why it serves the goal. No marketing language.
- Keep the title close to what the source actually calls itself.`;

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['title', 'url', 'summary'],
        propertyOrdering: ['title', 'url', 'summary'],
      },
    },
  },
  required: ['findings'],
  propertyOrdering: ['findings'],
};

interface RawFinding {
  title?: unknown;
  url?: unknown;
  summary?: unknown;
}

/** Strip tracking junk so the same page twice is caught as the same page. */
function normaliseUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source)/i.test(key)) u.searchParams.delete(key);
    }
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
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
  if (!goal) return fail('Set a goal before sending Beru out.', 409);

  const claim = await claimCalls(db, CALL_COST);
  if (!claim.ok) return claim.response;

  const runId = await startRun(db, AGENT);

  // ------------------------------------------------------- 1. grounded search
  const search = await gemini({
    system: SEARCH_SYSTEM,
    prompt: `The goal is: ${goal.title}\n\nSearch now and report what you find.`,
    grounded: true,
    temperature: 0.4,
  });

  if (!search.ok || !search.text) {
    await finishRun(db, runId, 'error', null, search.error ?? 'search failed');
    return fail(search.error ?? 'Beru found nothing and came back empty.', 502);
  }

  // Grounding failing open is the dangerous case: the model will happily
  // write a confident report of pages it never visited. No sources means no
  // search happened, so the run is abandoned rather than saved.
  if (!search.sources || search.sources.length === 0) {
    await finishRun(db, runId, 'error', null, 'no grounding metadata — search did not run');
    return fail('Beru could not reach the web this time. Nothing was saved. Try again shortly.', 502);
  }

  // ---------------------------------------------------------- 2. structuring
  const sourceList = search.sources
    .map((s, i) => `${i + 1}. ${s.title || '(untitled)'} — ${s.uri}`)
    .join('\n');

  const structured = await gemini({
    system: STRUCTURE_SYSTEM,
    prompt:
      `Goal: ${goal.title}\n\n` +
      `Scout report:\n${search.text}\n\n` +
      `Sources found (use these URLs exactly):\n${sourceList}`,
    schema: FINDING_SCHEMA,
    temperature: 0.2,
  });

  if (!structured.ok || !structured.text) {
    await finishRun(db, runId, 'error', null, structured.error ?? 'structuring failed');
    return fail(structured.error ?? 'Beru could not make sense of what it found.', 502);
  }

  const parsed = parseJson<{ findings?: RawFinding[] }>(structured.text);
  const rows = Array.isArray(parsed?.findings) ? parsed.findings : [];
  if (rows.length === 0) {
    await finishRun(db, runId, 'ok', 'nothing worth keeping', null);
    return json({ added: 0, skipped: 0, note: 'Beru found nothing worth your time this run.' });
  }

  // What is already on file, so a repeat run does not try to insert it again.
  const { data: existing } = await db.from('findings').select('url').eq('goal_id', goal.id);
  const known = new Set(
    (existing ?? []).map((r) => normaliseUrl(r.url as string | null)).filter(Boolean) as string[],
  );

  const toInsert: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const raw of rows.slice(0, MAX_FINDINGS)) {
    const title = str(raw.title, 200);
    const url = str(raw.url, 2000) || null;
    if (!title) continue;

    const key = normaliseUrl(url);
    // Two rows in one batch can collide with each other, not just with the
    // table — the unique index would reject the whole insert if they did.
    if (key && known.has(key)) {
      skipped++;
      continue;
    }
    if (key) known.add(key);

    toInsert.push({
      goal_id: goal.id,
      title,
      url,
      summary: str(raw.summary, 1000),
    });
  }

  let added = 0;
  if (toInsert.length > 0) {
    const { data: inserted, error: insertError } = await db
      .from('findings')
      .insert(toInsert)
      .select('id');
    if (insertError) {
      console.error('finding insert failed', insertError.message);
      await finishRun(db, runId, 'error', null, insertError.message);
      return fail('Beru found things but the System could not store them.', 500);
    }
    added = inserted?.length ?? 0;
  }

  const summary = `${added} kept, ${skipped} already known`;
  // Both model calls are charged to this one run.
  await finishRun(db, runId, 'ok', summary, null, {
    usage: addUsage(search.usage, structured.usage),
    durationMs: (search.durationMs ?? 0) + (structured.durationMs ?? 0),
    model: structured.modelVersion ?? search.modelVersion ?? MODEL,
  });

  // ------------------------------------------------------------ raise Igris
  //
  // Fire and report, never block: the findings are already saved, so a judge
  // that fails leaves them unranked rather than lost, and the student can
  // still read them.
  let judged = false;
  if (added > 0) {
    try {
      const base = Deno.env.get('SUPABASE_URL');
      const secret = Deno.env.get('APP_SECRET');
      const res = await fetch(`${base}/functions/v1/igris-judge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-secret': secret ?? '' },
        body: JSON.stringify({ raisedBy: AGENT }),
      });
      judged = res.ok;
      if (!res.ok) console.error('igris refused', res.status, (await res.text()).slice(0, 300));
    } catch (err) {
      console.error('could not raise igris', err);
    }
  }

  return json({ added, skipped, judged });
});
