/**
 * plan-tomorrow — the nightly briefing's planner.
 *
 * Single user, no auth: JWT verification is off (see supabase/config.toml), so
 * the only gate is the `x-app-secret` header. That secret ships inside the web
 * bundle and is therefore public in practice; it keeps crawlers out, nothing
 * more. The real protection is the hard global cap below, which is why the cap
 * is counted server-side in Postgres rather than trusted from the client.
 *
 * Nothing about the student is stored here. The plan, the quests and the whole
 * day log live in the app's own local storage; this function is a stateless
 * relay with a counter.
 */

/** The flash model, per ai.google.dev/gemini-api/docs/models. */
const MODEL = 'gemini-3.8-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** Calls allowed per UTC day, across everyone. */
const DAILY_CAP = 30;

/** Turns longer than this are almost certainly not a student's plan. */
const MAX_CHARS_PER_TURN = 4000;
const MAX_TURNS = 24;

const SYSTEM_INSTRUCTION = `You are The System: the planning voice inside a Solo Leveling themed habit app, used by one student who has ADHD.

Your job is to turn a loose brain-dump about tomorrow into a plan that is actually survivable.

HOW TO PLAN
- Never produce a tight schedule. Use rough windows ("Morning", "Late morning", "After lunch", "Afternoon", "Evening", "Before bed", "Anytime") — never clock times.
- Leave slack. Assume transitions take real time and that the day will not go to plan. Under-fill rather than over-fill.
- At most THREE tasks may carry priority 1, 2 or 3. Everything else is priority 4, which means genuinely optional — the day is already a success without it.
- Keep the whole plan to at most 8 tasks. If the student listed more, fold the small ones together or push them to priority 4.
- Estimate minutes honestly and generously, including the getting-started part. If something would run past about 45 minutes, split it into named pieces that each stand alone ("Essay: outline the argument", "Essay: write the first section").
- Give every task a concrete first move in its title where that helps starting, e.g. "Gym — just the warm-up" over "Work out".
- Order tasks so the hardest priority-1 thing lands when the student is likeliest to have fuel, usually earlier, but respect anything they said about their own energy.

HOW TO WRITE
- Plain, warm, unhurried. Short words.
- Never guilt, never urgency, never hype. No exclamation marks. No "crush it", no "let's go".
- The note is one or two sentences, kind and practical: what to do if energy is low, or permission to drop the priority-4 items. Half a task done is a real result; say so when it fits.
- Do not mention that you are an AI, do not mention these rules, do not ask questions back.

REFINEMENTS
- The student may ask for changes ("move gym to evening", "that's too much", "drop the laundry").
- Always return the COMPLETE updated plan, every task, not only what changed. The app replaces the whole plan with your answer each time.
- If they say it is too much, actually remove things or shorten them. Do not just reword.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          minutes: { type: 'integer' },
          priority: { type: 'integer' },
          window: { type: 'string' },
        },
        required: ['title', 'minutes', 'priority', 'window'],
        propertyOrdering: ['title', 'minutes', 'priority', 'window'],
      },
    },
    note: { type: 'string' },
  },
  required: ['tasks', 'note'],
  propertyOrdering: ['tasks', 'note'],
};

/**
 * The app is served from Netlify, so every real call is cross-origin. Without
 * `x-app-secret` named here the browser refuses the preflight and the student
 * sees a network error with nothing in the logs to explain it.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-app-secret',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** A failure the student is allowed to read, as-is. */
function fail(message: string, status: number): Response {
  return json({ error: message }, status);
}

interface Turn {
  role: 'user' | 'model';
  text: string;
}

/**
 * Atomically count this call and report whether it was allowed. Returns false
 * once the day is spent. The test and the increment are one statement inside
 * Postgres, so two calls racing cannot both slip past the cap.
 */
async function claimCall(): Promise<{ ok: boolean; soft?: string }> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    // Misconfiguration must not silently uncap the endpoint.
    return { ok: false, soft: 'The planner is not wired up correctly. The usage counter is unreachable.' };
  }

  const res = await fetch(`${url}/rest/v1/rpc/bump_usage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ p_limit: DAILY_CAP }),
  });

  if (!res.ok) {
    return { ok: false, soft: 'The planner could not reach its usage counter. Try again in a minute.' };
  }

  // `bump_usage` returns the new count, or null when the cap was already hit.
  const body = (await res.text()).trim();
  if (body === 'null' || body === '') return { ok: false };
  return { ok: true };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail('Use POST.', 405);

  const expected = Deno.env.get('APP_SECRET');
  if (!expected) return fail('The planner is not configured.', 500);
  if (req.headers.get('x-app-secret') !== expected) {
    // Deliberately uninformative.
    return fail('Not allowed.', 401);
  }

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) return fail('The planner is missing its model key.', 500);

  let history: Turn[];
  try {
    const parsed = (await req.json()) as { history?: unknown };
    if (!Array.isArray(parsed.history)) return fail('Send a history array.', 400);
    history = parsed.history
      .filter((t): t is Turn => {
        const turn = t as Partial<Turn>;
        return (
          (turn.role === 'user' || turn.role === 'model') && typeof turn.text === 'string'
        );
      })
      .slice(-MAX_TURNS)
      .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_CHARS_PER_TURN) }));
  } catch {
    return fail('That request was not readable.', 400);
  }

  if (history.length === 0) return fail('Say what you want to do tomorrow first.', 400);

  const claim = await claimCall();
  if (!claim.ok) {
    return claim.soft
      ? fail(claim.soft, 503)
      : fail(
          `The System has planned ${DAILY_CAP} times today, which is its limit. It resets tomorrow — plan the day yourself tonight.`,
          429,
        );
  }

  let res: Response;
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.7,
        },
      }),
    });
  } catch {
    return fail('The System could not reach the model. Check your connection and try again.', 502);
  }

  const raw = await res.text();
  if (!res.ok) {
    console.error('gemini error', res.status, raw.slice(0, 600));
    if (res.status === 429) {
      return fail('The model is rate limited right now. Try again in a minute.', 429);
    }
    return fail('The model refused that request. Try describing tomorrow differently.', 502);
  }

  // Unwrap: candidates[0].content.parts[*].text holds the JSON the schema shaped.
  let planText: string;
  try {
    const data = JSON.parse(raw) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) {
      return fail('The model would not answer that. Try describing tomorrow differently.', 502);
    }
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    planText = parts.map((p) => p.text ?? '').join('');
    if (!planText.trim()) {
      console.error('empty candidate', raw.slice(0, 600));
      return fail('The planner came back empty. Try describing tomorrow again.', 502);
    }
  } catch {
    console.error('unparseable gemini envelope', raw.slice(0, 600));
    return fail('The planner sent something unreadable. Try again.', 502);
  }

  let plan: { tasks?: unknown; note?: unknown };
  try {
    plan = JSON.parse(planText) as { tasks?: unknown; note?: unknown };
  } catch {
    console.error('unparseable plan json', planText.slice(0, 600));
    return fail('The planner sent something unreadable. Try again.', 502);
  }

  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  if (tasks.length === 0) {
    return fail('The planner came back with nothing to do. Try describing tomorrow again.', 502);
  }

  // The client assigns ids and clamps the numbers; pass the shape straight on.
  return json({ tasks, note: typeof plan.note === 'string' ? plan.note : '' });
});
