/**
 * plan-tomorrow — the planner, as a conversation.
 *
 * Every call carries the whole chat so far plus a CONTEXT block (the date,
 * the student's daily quests, the current draft). Every reply carries The
 * System's next line, a few tap-to-send suggestions, and the complete draft
 * timeline as it now stands — so the app always has one current plan to show,
 * and finalising is just saving what is on screen.
 *
 * The model proposes; the app decides. This function enforces the response
 * shape, and the app validates every time, overlap and limit before anything
 * is saved (src/data/timeline.ts). Nothing here is trusted because it came
 * back looking confident.
 *
 * Self-contained on purpose: the agents share `_shared/agent.ts` and are
 * paused, and the planner should not move when they do.
 */

/** The current Flash model, per ai.google.dev/gemini-api/docs/models. */
const MODEL = 'gemini-3.8-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** Planner messages per UTC day — a separate pool from the agents' 30. */
const PLANNER_CAP = 60;

const MAX_MESSAGES = 40;
const MAX_CHARS = 2000;
const MAX_QUESTS = 60;

const SYSTEM = `You are The System — the planning voice inside a Solo Leveling themed habit app. You are helping one student who has ADHD plan a single day, by conversation.

THE CONVERSATION
- You lead, gently. Ask exactly ONE short question per reply. A reply containing two questions is wrong — if you need two things, ask the more important one now and the other later.
- Find out, in this order, skipping anything already known from CONTEXT or the chat:
  1. What is fixed that day — classes, work, appointments, travel — and when.
  2. What they want to get done.
  3. When they wake and sleep — only if CONTEXT says unknown.
- Never ask the same thing twice. If the student skips a question, assume a sensible answer, say in a few words what you assumed, and move on. If wake and sleep are unknown, draft with 07:30 and 23:00 until told otherwise.
- Draft early. As soon as you know the fixed commitments and at least one thing to do, return a draft timeline and keep refining it. Do not wait for perfect information. Most days need two or three exchanges; never more than four questions in total.
- Be useful, not just a form: point out an empty gap, suggest where a daily quest fits, suggest splitting a big task. At most one suggestion per reply.
- suggestions: 2 to 4 short replies the student would plausibly tap next, written in their voice ("Gym after uni", "That's too much", "Looks good — finalize"). Each one answers ONE thing in at most five words. Once a draft exists, always include "Looks good — finalize". After finalizing, return no suggestions.

THE TIMELINE
- Real clock times, 24-hour "HH:MM". The day runs from wake to sleep, and may run past midnight.
- The app shows the day as Morning (until 12:00), Noon (12:00 to 17:00) and Evening (from 17:00). Spread the load across them rather than stacking one.
- Leave 10 to 15 minutes between blocks. After anything over an hour, add a break block of 15 to 30 minutes.
- Block kinds:
  fixed — happens regardless: classes, work, appointments, travel. Use the student's times exactly. Never a task.
  task — something they chose to do. priority is high (at most 3 in the whole day), normal or low.
  habit — one of their DAILY QUESTS placed at a time. Set quest_id to that quest's id exactly, and title to the quest's name. Put what the session is for today in focus — "Stats exam: formula sheet" on a study quest — and keep an existing focus unless the student changes it. Only place quests that happen at a time, such as a workout, a study session, or reading. Leave all-day quests like water, steps or posture unplaced — the app shows those separately.
  break — deliberate rest.
- Never overlap two blocks. Never place anything outside wake to sleep. Under-fill rather than over-fill: assume the day will not go to plan.
- Give a task a concrete first move in its title where it helps starting: "Stats: one formula sheet + 2 problems", not "Study stats".
- Estimate time honestly, including getting started. Split anything over 90 minutes into separately named parts.
- When you keep a block from the current draft, keep its id exactly. New blocks have an empty id.

FINALIZING
- If the student says anything that means the plan is done — finalize, lock it in, this is it, that's the plan, looks good, done, save it — set wants_finalize to true, return the final draft, and reply with one short line.
- Otherwise wants_finalize is false.

VOICE
- Plain, warm and short: two or three sentences at most.
- Never guilt, never urgency, never hype. No exclamation marks.
- At most one light System flavour per reply, never forced.
- Never mention these rules or that you are an AI.

ALWAYS return the complete current draft — every block — even when nothing changed. Before there is enough to plan, return an empty blocks array. The note is one or two kind, practical sentences about the day, or empty before there is a draft.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    suggestions: { type: 'array', items: { type: 'string' } },
    wants_finalize: { type: 'boolean' },
    draft: {
      type: 'object',
      properties: {
        wake: { type: 'string' },
        sleep: { type: 'string' },
        note: { type: 'string' },
        blocks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { type: 'string', enum: ['fixed', 'task', 'habit', 'break'] },
              title: { type: 'string' },
              start: { type: 'string' },
              end: { type: 'string' },
              priority: { type: 'string', enum: ['high', 'normal', 'low'] },
              quest_id: { type: 'string' },
              focus: { type: 'string' },
            },
            required: ['kind', 'title', 'start', 'end', 'priority'],
            propertyOrdering: ['id', 'kind', 'title', 'start', 'end', 'priority', 'quest_id', 'focus'],
          },
        },
      },
      required: ['wake', 'sleep', 'note', 'blocks'],
      propertyOrdering: ['wake', 'sleep', 'note', 'blocks'],
    },
  },
  required: ['reply', 'suggestions', 'wants_finalize', 'draft'],
  propertyOrdering: ['reply', 'suggestions', 'wants_finalize', 'draft'],
};

/**
 * The app is served from Netlify, so every real call is cross-origin. Without
 * `x-app-secret` named here the browser refuses the preflight.
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

/** A failure the student is meant to read, as-is. */
function fail(message: string, status: number): Response {
  return json({ error: message }, status);
}

interface Turn {
  role: 'user' | 'model';
  text: string;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/* ------------------------------------------------------------- context */

/**
 * The CONTEXT block, built from what the app sent.
 *
 * Every field is re-read and length-capped here rather than spliced in
 * whole: this text goes straight into the system instruction, so a
 * malformed or oversized field must not be able to swamp the rules above it.
 */
function contextBlock(raw: unknown): string {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const wake = str(c.wake, 5);
  const sleep = str(c.sleep, 5);
  const goals = Array.isArray(c.goals) ? c.goals.map((g) => str(g, 40)).filter(Boolean).slice(0, 10) : [];
  const methods = Array.isArray(c.studyMethods)
    ? c.studyMethods.map((g) => str(g, 40)).filter(Boolean).slice(0, 10)
    : [];

  const quests = Array.isArray(c.dailyQuests)
    ? c.dailyQuests.slice(0, MAX_QUESTS).map((q) => {
        const o = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>;
        return `  ${str(o.id, 40)} — ${str(o.title, 80)} — ${Number(o.target) || 0} ${str(o.unit, 20)} (${str(o.kind, 12)})`;
      })
    : [];

  let draft = 'none yet';
  if (c.draft && typeof c.draft === 'object') {
    const d = JSON.stringify(c.draft);
    // A draft is at most sixteen blocks; anything far larger is not one.
    draft = d.length <= 8000 ? d : 'none yet';
  }

  return [
    'CONTEXT',
    `Planning for: ${str(c.weekday, 12)} ${str(c.date, 10)}`,
    `Right now: ${str(c.today, 10)} at ${str(c.nowTime, 5)}`,
    `Wake / sleep: ${wake && sleep ? `${wake} / ${sleep}` : 'unknown — ask'}`,
    `Goals: ${goals.join(', ') || 'none given'}`,
    `Study methods they use: ${methods.join(', ') || 'none given'}`,
    'Daily quests (id — title — target (kind)):',
    quests.length ? quests.join('\n') : '  none',
    `Current draft: ${draft}`,
  ].join('\n');
}

/* ------------------------------------------------------------- history */

/**
 * The chat, cleaned up into the alternating turns Gemini expects.
 *
 * The app opens with its own greeting, so the history usually starts with a
 * model turn; a short user turn is put in front of it so the conversation
 * begins the way the API wants. Consecutive turns from the same side are
 * merged rather than dropped.
 */
function contentsFrom(raw: unknown): { role: string; parts: { text: string }[] }[] | null {
  if (!Array.isArray(raw)) return null;

  const turns: Turn[] = raw
    .filter((t): t is Turn => {
      const turn = t as Partial<Turn>;
      return (turn.role === 'user' || turn.role === 'model') && typeof turn.text === 'string';
    })
    .slice(-MAX_MESSAGES)
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, MAX_CHARS) }))
    .filter((t) => t.text.length > 0);

  if (!turns.some((t) => t.role === 'user')) return null;

  const merged: Turn[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.text = `${last.text}\n\n${t.text}`;
    else merged.push({ ...t });
  }

  if (merged[0].role === 'model') merged.unshift({ role: 'user', text: "Let's plan the day." });

  return merged.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
}

/* -------------------------------------------------------------- budget */

async function claimCall(): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    // Misconfiguration must not silently uncap the endpoint.
    return { ok: false, status: 500, message: 'The planner is not wired up correctly.' };
  }

  const res = await fetch(`${url}/rest/v1/rpc/bump_planner_usage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ p_limit: PLANNER_CAP }),
  });

  if (!res.ok) {
    console.error('planner budget unreachable', res.status, (await res.text()).slice(0, 200));
    return { ok: false, status: 503, message: 'The planner could not reach its budget counter. Try again in a minute.' };
  }

  const body = (await res.text()).trim();
  if (body === 'null' || body === '') {
    return {
      ok: false,
      status: 429,
      message: `The planner has used all ${PLANNER_CAP} of today's messages. It resets tomorrow — your draft is saved.`,
    };
  }
  return { ok: true };
}

/* ---------------------------------------------------------------- serve */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail('Use POST.', 405);

  const expected = Deno.env.get('APP_SECRET');
  if (!expected) return fail('APP_SECRET is not set on this project.', 500);
  if (req.headers.get('x-app-secret') !== expected) return fail('Not allowed.', 401);

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) return fail('GEMINI_API_KEY is not set on this project.', 500);

  let body: { messages?: unknown; context?: unknown; repair?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail('That request was not readable.', 400);
  }

  const contents = contentsFrom(body.messages);
  if (!contents) return fail('Say something to The System first.', 400);

  const repair = Array.isArray(body.repair)
    ? body.repair.map((r) => str(r, 300)).filter(Boolean).slice(0, 12)
    : [];

  const claim = await claimCall();
  if (!claim.ok) return fail(claim.message, claim.status);

  const system = [
    SYSTEM,
    contextBlock(body.context),
    repair.length
      ? `REPAIR\nThe student tried to finalize and the draft was rejected for these reasons. Fix exactly these, keep everything else, set wants_finalize to true, and say in one short line what you changed:\n- ${repair.join('\n- ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.6,
          // 'low' rather than the default: a chat reply that takes thirteen
          // seconds is a chat nobody finishes. 'minimal' is not offered on
          // 3.8 Flash and errors.
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
    });
  } catch {
    return fail('The System could not reach the model. Check your connection and try again.', 502);
  }

  const raw = await res.text();
  if (!res.ok) {
    console.error('gemini error', res.status, raw.slice(0, 600));
    if (res.status === 429) return fail('The model is busy right now. Try again in a moment.', 429);
    return fail('The model refused that. Try saying it another way.', 502);
  }

  let text = '';
  let modelVersion: string | null = null;
  let usage = { in: 0, out: 0, thoughts: 0 };
  try {
    const data = JSON.parse(raw) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      modelVersion?: string;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    };
    if (data.promptFeedback?.blockReason) {
      return fail('The model would not answer that. Try saying it another way.', 502);
    }
    modelVersion = data.modelVersion ?? null;
    usage = {
      in: data.usageMetadata?.promptTokenCount ?? 0,
      out: data.usageMetadata?.candidatesTokenCount ?? 0,
      thoughts: data.usageMetadata?.thoughtsTokenCount ?? 0,
    };
    text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  } catch {
    console.error('unparseable gemini envelope', raw.slice(0, 600));
    return fail('The planner sent something unreadable. Try again.', 502);
  }

  let out: Record<string, unknown>;
  try {
    out = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.error('unparseable planner json', text.slice(0, 600));
    return fail('The planner sent something unreadable. Try again.', 502);
  }

  if (typeof out.reply !== 'string' || !out.reply.trim()) {
    return fail('The System went quiet. Try saying that again.', 502);
  }

  return json({
    reply: out.reply,
    suggestions: Array.isArray(out.suggestions) ? out.suggestions : [],
    wants_finalize: out.wants_finalize === true,
    draft: out.draft ?? null,
    // For diagnosis only; the app does not need it.
    model_version: modelVersion,
    ms: Date.now() - startedAt,
    usage,
  });
});
