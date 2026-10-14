/**
 * assistant — The System itself, as a conversation you can have from any
 * screen.
 *
 * This is the "knows me" layer. Every message is answered with the full
 * picture assembled here on the server — every active goal and which one is
 * the focus, the focus goal's best unread findings, what the System
 * remembers, the last week of days — plus what the app reports about right
 * now (today's board, today's plan, the clock). The model never has to ask
 * for something the System already knows.
 *
 * The model proposes; code decides. A reply can suggest one action (open the
 * planner, say) and up to three things worth remembering. The action is only
 * ever offered as a button — nothing happens until it is tapped — and every
 * memory is checked here before it is stored.
 *
 * Ops:
 *   history — the recent conversation, no model call
 *   send    — one message in, one reply out
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
} from '../_shared/agent.ts';

/** Assistant messages per UTC day — its own pool, apart from the planner and the shadows. */
const ASSISTANT_CAP = 80;

const HISTORY_FOR_MODEL = 20;
const HISTORY_FOR_APP = 40;
const MAX_MESSAGE = 1500;
const MAX_REPLY = 1200;
const MAX_MEMORIES_IN = 40;

const ACTIONS = ['none', 'plan_today', 'plan_tomorrow', 'open_planner', 'open_goals', 'open_quests'] as const;
type Action = (typeof ACTIONS)[number];

const MEMORY_KINDS = ['fact', 'preference', 'commitment', 'pattern'] as const;
type MemoryKind = (typeof MEMORY_KINDS)[number];

/**
 * Never stored, whatever the model proposes: credentials, long numbers that
 * could be account or card numbers, and health details. The last is a
 * deliberate line — this is a coach, not a medical record.
 */
const NEVER_REMEMBER =
  /password|passcode|api[ _-]?key|secret|token|\b\d{9,}\b|\b(adhd|diagnos\w*|medicat\w*|prescri\w*|therap\w*|disorder|dosage|symptom\w*)\b/i;

const SYSTEM = `You are The System — the personal assistant and coach inside a Solo Leveling themed app. You work for one person, the Player. Think JARVIS to Tony Stark: you know their goals, their schedule, their progress and their habits, and your job is to keep them moving with as few decisions from them as possible. The game layer (quests, XP, ranks, stats) is how you talk; you are the point, not an accessory.

HOW YOU COACH — follow every rule, every reply:
1. Structure: when you talk about the day, use real clock times from CONTEXT. Never vague ("later", "soon") when a time exists.
2. One next step: when they ask what to do, or seem stuck, give the ONE next action — not the whole plan. Offer the rest only if asked.
3. Credit fast: when they report finishing something, acknowledge it in a few words and move to what is next. No long praise.
4. Hold the open loops: you can see their unfinished quests and plan blocks in CONTEXT. Keep track for them; never ask them to remember or list things you already have.
5. Start easy: if they are stuck or avoiding something, shrink the first step until it is almost nothing — "open the file", "two minutes", "write one line".
6. Recover without shame: after a missed block, a missed day or a broken streak, say what the next clean start is. Never list what was missed, never guilt, never lecture.
7. Defaults over questions: make sensible choices yourself and say what you assumed in a few words. Ask at most ONE question per reply, and only if you truly cannot proceed.
8. Interest-based pull: connect a task to the goal it serves, or to what finishing it unlocks, using the goals in CONTEXT. Not urgency.
9. Protect the day: if they want to add something to a day that is already full (more than about six hours of planned work, or late in the evening), propose what to drop or move before agreeing to add.
10. Never explain the psychology behind these rules unless they ask why.

VOICE
- Short. One to four sentences for most replies. No headings, no bullet lists unless they ask for a list.
- Calm, direct, warm. A light System flavour is fine ("Quest logged.", "Noted, Player."), at most once per reply, never forced.
- No exclamation marks. No hype. No guilt. No urgency language.
- Never mention diagnoses, conditions or medical topics, and never give medical, legal or financial advice. If asked, say briefly that it is outside what you do.
- Never claim to have done something you cannot do. You cannot edit their plan or quests directly — you can offer to open the right screen.

ACTIONS — set action to offer ONE button under your reply. It does nothing until they tap it:
- plan_tomorrow: they want to plan tomorrow, or it is evening and tomorrow has no plan and planning fits the conversation.
- plan_today: they want to plan or re-plan today.
- open_planner: they want to see today's or tomorrow's timeline.
- open_goals: goals, findings or the shadows came up.
- open_quests: they want to tick things off or see the board.
- none: most replies.

MEMORY — remember: up to 3 short, durable things worth knowing next week, in the Player's favour:
- fact (an exam date, a deadline, where they study), preference (likes mornings, hates long lists), commitment (gym Tue/Thu), pattern (keeps skipping reading after 22:00 — only when CONTEXT shows it more than once).
- Only what they said or what CONTEXT plainly shows. One idea per memory, written in third person, under 140 characters, dates absolute (YYYY-MM-DD).
- Never: anything already in MEMORY, passing moods, passwords or numbers, health or medical details, anything about other people beyond a name and a role.
- Most replies remember nothing. Return an empty list.

suggestions: up to 3 short replies the Player might tap next, in their voice, at most 6 words each. Empty when nothing obvious.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    suggestions: { type: 'array', items: { type: 'string' } },
    action: { type: 'string', enum: [...ACTIONS] },
    remember: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...MEMORY_KINDS] },
          content: { type: 'string' },
        },
        required: ['kind', 'content'],
        propertyOrdering: ['kind', 'content'],
      },
    },
  },
  required: ['reply', 'suggestions', 'action', 'remember'],
  propertyOrdering: ['reply', 'suggestions', 'action', 'remember'],
};

/* ---------------------------------------------------------------- helpers */

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function num(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : null;
}

function daysUntil(date: string, today: string): number | null {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((a - b) / 86_400_000);
}

/**
 * What the app says about right now, re-read field by field and capped.
 * It goes into the prompt, so nothing oversized or malformed gets through
 * to crowd out the rules above it.
 */
function nowBlock(raw: unknown): { text: string; today: string } {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(c.date, 10)) ? str(c.date, 10) : new Date().toISOString().slice(0, 10);

  const board = (c.board && typeof c.board === 'object' ? c.board : {}) as Record<string, unknown>;
  const open = Array.isArray(board.open) ? board.open.map((t) => str(t, 80)).filter(Boolean).slice(0, 20) : [];
  const mandatoryOpen = Array.isArray(board.mandatoryOpen)
    ? board.mandatoryOpen.map((t) => str(t, 80)).filter(Boolean).slice(0, 12)
    : [];

  const plan = (c.today && typeof c.today === 'object' ? c.today : {}) as Record<string, unknown>;
  const blocks = Array.isArray(plan.blocks)
    ? plan.blocks.slice(0, 16).map((b) => {
        const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
        const state = o.done === true ? 'done' : 'open';
        return `  ${str(o.start, 5)}–${str(o.end, 5)} ${str(o.kind, 8)}: ${str(o.title, 80)}${o.focus ? ` (${str(o.focus, 80)})` : ''}${str(o.kind, 8) === 'task' || str(o.kind, 8) === 'habit' ? ` [${state}]` : ''}`;
      })
    : [];

  const tomorrow = (c.tomorrow && typeof c.tomorrow === 'object' ? c.tomorrow : {}) as Record<string, unknown>;

  const lines = [
    `Now: ${str(c.weekday, 12)} ${date}, ${str(c.time, 5)}`,
    `Player: level ${num(c.level, 1, 999) ?? '?'}, rank ${str(c.rank, 2) || '?'}, ${num(c.xp, 0, 10_000_000) ?? 0} XP, streak ${num(c.streak, 0, 10_000) ?? 0} days`,
    `Usual day: wake ${str(c.wake, 5) || 'unknown'}, sleep ${str(c.sleep, 5) || 'unknown'}; planning hour ${str(c.planningHour, 5) || 'unknown'}`,
    `Today's board: ${num(board.done, 0, 500) ?? 0} of ${num(board.total, 0, 500) ?? 0} quests done.`,
    open.length ? `  Still open: ${open.join('; ')}` : '  Nothing open.',
    mandatoryOpen.length ? `  Mandatory still open: ${mandatoryOpen.join('; ')}` : '',
    blocks.length
      ? `Today's plan:\n${blocks.join('\n')}${str(plan.note, 300) ? `\n  Note: ${str(plan.note, 300)}` : ''}`
      : "Today's plan: none.",
    `Tomorrow: ${tomorrow.planned === true ? 'already planned' : 'not planned yet'}.`,
    str(c.screen, 30) ? `They opened you from: ${str(c.screen, 30)}` : '',
  ];
  return { text: lines.filter(Boolean).join('\n'), today: date };
}

interface Proposed {
  reply?: unknown;
  suggestions?: unknown;
  action?: unknown;
  remember?: unknown;
}

/** Keep only memories that pass every rule above. Exported shape for the app. */
function vetMemories(raw: unknown, known: Set<string>): { kind: MemoryKind; content: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { kind: MemoryKind; content: string }[] = [];
  for (const item of raw.slice(0, 3)) {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const kind = MEMORY_KINDS.includes(o.kind as MemoryKind) ? (o.kind as MemoryKind) : null;
    const content = str(o.content, 280).replace(/\s+/g, ' ');
    if (!kind || content.length < 3) continue;
    if (NEVER_REMEMBER.test(content)) continue;
    const key = content.toLowerCase();
    if (known.has(key)) continue;
    known.add(key);
    out.push({ kind, content });
  }
  return out;
}

/* ------------------------------------------------------------------ serve */

Deno.serve(async (req: Request): Promise<Response> => {
  const early = preflight(req) ?? checkSecret(req);
  if (early) return early;

  const db = admin();
  if (!db) return fail('The System is not configured.', 500);

  let body: { op?: unknown; text?: unknown; now?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail('That request was not readable.', 400);
  }

  /* ---------------------------------------------------------- history */
  if (body.op === 'history') {
    const { data, error } = await db
      .from('assistant_messages')
      .select('role, text, created_at')
      .order('created_at', { ascending: false })
      .limit(HISTORY_FOR_APP);
    if (error) return fail('The System could not read the conversation.', 500);
    return json({ messages: (data ?? []).reverse() });
  }

  if (body.op !== 'send') return fail('Unknown operation.', 400);

  /* ------------------------------------------------------------- send */
  const text = str(body.text, MAX_MESSAGE);
  if (!text) return fail('Say something to The System first.', 400);

  const { data: claimed, error: claimError } = await db.rpc('bump_pool', {
    p_pool: 'assistant',
    p_limit: ASSISTANT_CAP,
  });
  if (claimError) {
    console.error('assistant budget unreachable', claimError.message);
    return fail('The System could not reach its budget counter. Try again in a minute.', 503);
  }
  if (claimed === null) {
    return fail(`The System has answered all ${ASSISTANT_CAP} of today's messages. It resets tomorrow.`, 429);
  }

  const now = nowBlock(body.now);

  // Everything the System knows, gathered in one pass.
  const [goalsRes, memRes, forgottenRes, snapRes, historyRes] = await Promise.all([
    db
      .from('goals')
      .select('id, title, focus, deadline')
      .eq('active', true)
      .order('focus', { ascending: false })
      .order('created_at', { ascending: true }),
    db
      .from('memories')
      .select('id, kind, content')
      .is('archived_at', null)
      .order('last_seen_at', { ascending: false })
      .limit(MAX_MEMORIES_IN),
    // What the Player told the System to forget. Shown to the model so it is
    // not re-learned from an old message in the conversation.
    db
      .from('memories')
      .select('content')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .limit(MAX_MEMORIES_IN),
    db
      .from('daily_snapshots')
      .select('date, quests_done, quests_total, planned_done, planned_total, streak')
      .order('date', { ascending: false })
      .limit(7),
    db
      .from('assistant_messages')
      .select('role, text')
      .order('created_at', { ascending: false })
      .limit(HISTORY_FOR_MODEL),
  ]);

  const goals = goalsRes.data ?? [];
  const focus = goals.find((g) => g.focus);

  const findingsRes = focus
    ? await db
        .from('findings')
        .select('title, verdict, minutes_to_consume')
        .eq('goal_id', focus.id)
        .is('read_at', null)
        .in('verdict', ['must-read', 'read'])
        .order('score', { ascending: false, nullsFirst: false })
        .limit(5)
    : { data: [] };

  const goalLines = goals.length
    ? goals
        .map((g) => {
          const left = g.deadline ? daysUntil(g.deadline as string, now.today) : null;
          const due = g.deadline ? ` — due ${g.deadline}${left !== null ? ` (${left} days)` : ''}` : '';
          return `  ${g.focus ? '[FOCUS] ' : ''}${str(g.title, 160)}${due}`;
        })
        .join('\n')
    : '  none set';

  const findingLines = (findingsRes.data ?? []).map(
    (f) => `  ${f.verdict === 'must-read' ? 'MUST READ' : 'read'}: ${str(f.title, 120)}${f.minutes_to_consume ? ` (~${f.minutes_to_consume} min)` : ''}`,
  );

  const memories = memRes.data ?? [];
  const memoryLines = memories.map((m) => `  (${m.kind}) ${str(m.content, 280)}`);
  const forgotten = (forgottenRes.data ?? []).map((m) => str(m.content, 280));

  const snapLines = (snapRes.data ?? []).map(
    (s) =>
      `  ${s.date}: ${s.quests_done}/${s.quests_total} quests, ${s.planned_done}/${s.planned_total} planned tasks, streak ${s.streak}`,
  );

  const history = (historyRes.data ?? []).reverse();
  const transcript = history.length
    ? history.map((m) => `${m.role === 'user' ? 'Player' : 'System'}: ${str(m.text, 1500)}`).join('\n')
    : '(this is the first message)';

  const prompt = [
    'CONTEXT',
    now.text,
    '',
    'Goals:',
    goalLines,
    findingLines.length ? `Unread findings for the focus goal:\n${findingLines.join('\n')}` : '',
    '',
    'MEMORY (what you already know):',
    memoryLines.length ? memoryLines.join('\n') : '  nothing yet',
    forgotten.length
      ? `FORGOTTEN (the Player asked you to forget these; never remember them, or anything saying the same thing, again):\n${forgotten.map((f) => `  ${f}`).join('\n')}`
      : '',
    '',
    'Recent days:',
    snapLines.length ? snapLines.join('\n') : '  no history reported yet',
    '',
    'CONVERSATION SO FAR',
    transcript,
    '',
    'NEW MESSAGE FROM THE PLAYER',
    text,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const runId = await startRun(db, 'assistant');
  const result = await gemini({
    system: SYSTEM,
    prompt,
    schema: RESPONSE_SCHEMA,
    temperature: 0.7,
    thinkingLevel: 'low',
  });

  if (!result.ok || !result.text) {
    await finishRun(db, runId, 'error', null, result.error ?? 'no reply', {
      usage: result.usage,
      durationMs: result.durationMs,
      model: MODEL,
    });
    return fail(result.error ?? 'The System went quiet. Try again.', 502);
  }

  const out = parseJson<Proposed>(result.text);
  const reply = str(out?.reply, MAX_REPLY);
  if (!reply) {
    await finishRun(db, runId, 'error', null, 'empty reply', { usage: result.usage, durationMs: result.durationMs, model: MODEL });
    return fail('The System went quiet. Try saying that again.', 502);
  }

  const suggestions = Array.isArray(out?.suggestions)
    ? [...new Set(out!.suggestions.map((s) => str(s, 60)).filter(Boolean))].slice(0, 3)
    : [];
  const action: Action = ACTIONS.includes(out?.action as Action) ? (out!.action as Action) : 'none';

  const known = new Set([...memories.map((m) => str(m.content, 280)), ...forgotten].map((c) => c.toLowerCase()));
  const toRemember = vetMemories(out?.remember, known);

  // The exchange is stored only once it succeeded, so a failed turn leaves
  // no unanswered message behind.
  const stamp = Date.now();
  const { error: saveError } = await db.from('assistant_messages').insert([
    { role: 'user', text, created_at: new Date(stamp).toISOString() },
    { role: 'model', text: reply, created_at: new Date(stamp + 1).toISOString() },
  ]);
  if (saveError) console.error('could not store the exchange', saveError.message);

  const remembered: { kind: MemoryKind; content: string }[] = [];
  for (const m of toRemember) {
    const { error } = await db.from('memories').insert({ kind: m.kind, content: m.content, goal_id: focus?.id ?? null });
    // 23505: the same memory already exists, which is fine.
    if (!error) remembered.push(m);
    else if (error.code !== '23505') console.error('memory insert failed', error.message);
  }

  await finishRun(db, runId, 'ok', reply.slice(0, 200), null, {
    usage: result.usage,
    durationMs: result.durationMs,
    model: MODEL,
  });

  return json({ reply, suggestions, action, remembered });
});
