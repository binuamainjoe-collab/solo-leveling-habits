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
 * The model proposes; code decides. A reply can carry changes to the app
 * (a quest's target, the board, progress, the schedule, goals), one action
 * button (open the planner, say) and up to three things worth remembering.
 * Changes are checked and applied by the app, which owns the state and
 * offers Undo; memories are checked here before they are stored.
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
import { APP_TIMEOUT_MS, CHAT_BUDGET_MS, DEEP_TIMEOUT_MS } from '../_shared/models.ts';
import { CHANGE_FIELDS, CORE, knowledge, nowBlock, OPS, str } from '../_shared/system.ts';

/**
 * Assistant model calls per UTC day — its own pool, apart from the planner
 * and the shadows. One per message, plus one for a message the flagship
 * could not answer and Flash then did.
 */
const ASSISTANT_CAP = 80;

const HISTORY_FOR_MODEL = 20;
const HISTORY_FOR_APP = 40;
const MAX_MESSAGE = 1500;
const MAX_REPLY = 1200;

/** About a minute of compressed speech, base64-encoded, with room to spare. */
const MAX_AUDIO_B64 = 6_000_000;
const AUDIO_TYPES = ['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp3'];

const ACTIONS = ['none', 'plan_today', 'plan_tomorrow', 'open_planner', 'open_goals', 'open_quests', 'suggest_quests', 'open_profile'] as const;

/**
 * What the Player opened the System for.
 *   chat      — a normal message
 *   interview — "get to know me": it asks about the empty profile fields
 *   board     — "suggest quests from my profile": a proposal, not a change
 */
const MODES = ['chat', 'interview', 'board'] as const;
type Mode = (typeof MODES)[number];
/** What a quest proposal may change. */
const BOARD_OPS = ['add_quest', 'remove_quest', 'set_target'];

function modeRules(mode: Mode, empty: string[]): string {
  if (mode === 'interview') {
    return `INTERVIEW — the Player asked you to get to know them, to fill their PROFILE.
- Ask about ONE thing at a time, short and natural, like a person getting to know them, not a form. You may ask about two closely related fields together.
- The empty fields, most useful first: ${empty.slice(0, 14).join(', ') || 'none — the profile is full; ask what has changed lately'}.
- Start with what helps you plan their days most: studies, routine, work, training.
- Every answer they give: save it at once with set_profile, and in the same reply ask the next question. Acknowledge in a few words; no praise.
- If they skip a question, move on. After about ten answers, or when they want to stop, stop asking, say what you now understand about their days in one sentence, and offer suggest_quests as the action.`;
  }
  if (mode === 'board') {
    return `QUEST PROPOSAL — the Player asked you to suggest a quest board that fits their PROFILE.
- Look at the PROFILE, the goals, their routine and how recent days went, then propose the changes that make the board fit their life: add_quest, remove_quest and set_target only, at most 6, using ids from CONTEXT. Fewer is fine; the most important first.
- Respect their load: a full schedule gets fewer, smaller quests. A bulk wants protein and lifting; a cut wants protein and steps; studies want study and review quests sized to their exams.
- In reply, say in two to four sentences what you propose and why, tied to specific things in their profile.
- These changes are a PROPOSAL: the app shows them with Accept. Never say they are done.`;
  }
  return '';
}
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

const SYSTEM = `${CORE}

VOICE
- Short. One to four sentences for most replies. No headings, no bullet lists unless they ask for a list.
- Calm, direct, warm. A light System flavour is fine ("Quest logged.", "Noted, Player."), at most once per reply, never forced.
- No exclamation marks. No hype. No guilt. No urgency language.
- Never mention diagnoses, conditions or medical topics, and never give medical, legal or financial advice. If asked, say briefly that it is outside what you do.
- Never claim to have done something you did not put in changes.

CHANGING THE SYSTEM — you can change the app itself. Put each change in changes; the app checks it, applies it at once, and gives the Player an Undo button.
${OPS}
- For a plan, offer plan_today or plan_tomorrow instead.
- Most replies change nothing. Return an empty list.

ACTIONS — set action to offer ONE button under your reply. It does nothing until they tap it:
- plan_tomorrow: they want to plan tomorrow, or it is evening and tomorrow has no plan and planning fits the conversation.
- plan_today: they want to plan or re-plan today.
- open_planner: they want to see today's or tomorrow's timeline.
- open_goals: goals, findings or the shadows came up.
- open_quests: they want to tick things off or see the board.
- suggest_quests: the profile has changed in a way that should change their quests, or they ask what quests would suit them.
- open_profile: they want to see or edit what you know about them.
- none: most replies.

MEMORY — remember: up to 3 short, durable things worth knowing next week, in the Player's favour:
- fact (an exam date, a deadline, where they study), preference (likes mornings, hates long lists), commitment (gym Tue/Thu), pattern (keeps skipping reading after 22:00 — only when CONTEXT shows it more than once).
- Only what they said or what CONTEXT plainly shows. One idea per memory, written in third person, under 140 characters, dates absolute (YYYY-MM-DD).
- Never: anything already in MEMORY or the PROFILE, passing moods, passwords or numbers, health or medical details, anything about other people beyond a name and a role.
- Most replies remember nothing. Return an empty list.

suggestions: up to 3 short replies the Player might tap next, in their voice, at most 6 words each. Empty when nothing obvious.

SPOKEN MESSAGES
- When the new message is an audio clip, write what the Player said in heard — their words, cleaned of filler (um, uh) — and answer it exactly as if they had typed it. If you cannot make out any words, leave heard empty and reply that you did not catch it.
- Your reply to a spoken message is read aloud. Keep it to one or two short sentences, and use no symbols, arrows, emoji or lists.
- For a typed message, heard is empty.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    heard: { type: 'string' },
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
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: CHANGE_FIELDS,
        required: ['op'],
        propertyOrdering: ['op', 'quest_id', 'target', 'title', 'amount', 'wake', 'sleep', 'planning_hour', 'goal_title', 'deadline', 'goal_id', 'section', 'field', 'value'],
      },
    },
  },
  required: ['reply', 'suggestions', 'action', 'remember', 'changes'],
  propertyOrdering: ['heard', 'reply', 'suggestions', 'action', 'remember', 'changes'],
};

interface Proposed {
  heard?: unknown;
  reply?: unknown;
  suggestions?: unknown;
  action?: unknown;
  remember?: unknown;
  changes?: unknown;
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
  // The app stops listening 45 s after it sent this; everything below is
  // timed against that.
  const requestStart = Date.now();
  const early = preflight(req) ?? checkSecret(req);
  if (early) return early;

  const db = admin();
  if (!db) return fail('The System is not configured.', 500);

  let body: { op?: unknown; text?: unknown; now?: unknown; audio?: unknown; mode?: unknown };
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
  const typed = str(body.text, MAX_MESSAGE);
  const mode: Mode = MODES.includes(body.mode as Mode) ? (body.mode as Mode) : 'chat';

  // A spoken message: checked here, heard by the model, transcribed in the
  // same call — one call, not a speech-to-text step and then a reply.
  let audio: { mimeType: string; data: string } | undefined;
  if (body.audio && typeof body.audio === 'object') {
    const a = body.audio as Record<string, unknown>;
    const mimeType = str(a.mimeType, 40).split(';')[0].toLowerCase();
    const data = typeof a.data === 'string' ? a.data : '';
    if (!AUDIO_TYPES.includes(mimeType)) return fail('The System cannot listen to that kind of recording.', 400);
    if (data.length < 100) return fail('That recording was empty. Try again.', 400);
    if (data.length > MAX_AUDIO_B64) return fail('That recording is too long. Keep it under a minute.', 413);
    if (!/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 2000))) return fail('That recording was not readable.', 400);
    audio = { mimeType, data };
  }
  if (!typed && !audio) return fail('Say something to The System first.', 400);

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

  // Everything the System knows, gathered in one pass (shared with the
  // live voice call, so both are the same System).
  const known = await knowledge(db, now.today, HISTORY_FOR_MODEL);
  const focus = known.focusId ? { id: known.focusId } : null;
  const memories = known.memories;
  const forgotten = known.forgotten;

  const transcript = known.history.length
    ? known.history.map((m) => `${m.role === 'user' ? 'Player' : 'System'}: ${m.text}`).join('\n')
    : '(this is the first message)';

  const prompt = [
    'CONTEXT',
    now.text,
    '',
    known.text,
    '',
    'CONVERSATION SO FAR',
    transcript,
    '',
    modeRules(mode, known.profileEmpty),
    '',
    'NEW MESSAGE FROM THE PLAYER',
    audio ? '(spoken — the audio clip attached below)' : typed,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const runId = await startRun(db, 'assistant');
  const result = await gemini({
    system: SYSTEM,
    prompt,
    schema: RESPONSE_SCHEMA,
    thinkingLevel: 'low',
    audio,
    // Typed and spoken both go to the flagship first, with Flash behind it
    // if it is slow, unavailable or sends something unusable. A spoken
    // message waits less before Flash answers (12 s rather than 18 s),
    // because a voice exchange that takes twenty seconds stops feeling like
    // talking. GEMINI_MODEL_VOICE moves voice alone to another model.
    tier: audio ? 'voice' : 'deep',
    deepTimeoutMs: audio ? DEEP_TIMEOUT_MS.voice : DEEP_TIMEOUT_MS.chat,
    // A reply this function would throw away (unreadable JSON, no reply)
    // is asked of Flash instead of ending the turn.
    accept: (text) => str(parseJson<Proposed>(text)?.reply, MAX_REPLY) !== '',
    // Both attempts together, so a slow flagship plus Flash still answers
    // while the app is waiting.
    budgetMs: CHAT_BUDGET_MS - (Date.now() - requestStart),
    // The Flash fallback is a second billed request, so it takes a second
    // place in today's pool; with none left, the turn fails as it would have.
    claimFallback: async () => {
      const { data, error } = await db.rpc('bump_pool', { p_pool: 'assistant', p_limit: ASSISTANT_CAP });
      return !error && data !== null;
    },
  });

  if (!result.ok || !result.text) {
    await finishRun(db, runId, 'error', null, result.error ?? 'no reply', {
      usage: result.usage,
      durationMs: result.durationMs,
      model: result.modelVersion ?? MODEL,
    });
    return fail(result.error ?? 'The System went quiet. Try again.', 502);
  }

  // If the app has already given up, saving this turn would put a reply in
  // the history whose changes were never applied, and the Player's retry
  // would sit next to it. Drop it instead; the retry starts clean.
  if (Date.now() - requestStart > APP_TIMEOUT_MS - 2_000) {
    await finishRun(db, runId, 'error', null, 'too slow: the app had stopped waiting', {
      usage: result.usage,
      durationMs: result.durationMs,
      model: result.modelVersion ?? MODEL,
    });
    return fail('The System took too long to answer. Try again.', 504);
  }

  const out = parseJson<Proposed>(result.text);
  const reply = str(out?.reply, MAX_REPLY);
  // What was said: the transcript for a spoken message, the text otherwise.
  const heard = audio ? str(out?.heard, MAX_MESSAGE) : '';
  const text = audio ? heard : typed;
  if (audio && !heard) {
    await finishRun(db, runId, 'ok', 'voice: nothing heard', null, { usage: result.usage, durationMs: result.durationMs, model: result.modelVersion ?? MODEL });
    return fail('The System could not make out what you said. Try again, a little closer to the mic.', 422);
  }
  if (!reply) {
    await finishRun(db, runId, 'error', null, 'empty reply', { usage: result.usage, durationMs: result.durationMs, model: result.modelVersion ?? MODEL });
    return fail('The System went quiet. Try saying that again.', 502);
  }

  const suggestions = Array.isArray(out?.suggestions)
    ? [...new Set(out!.suggestions.map((s) => str(s, 60)).filter(Boolean))].slice(0, 3)
    : [];
  const action: Action = ACTIONS.includes(out?.action as Action) ? (out!.action as Action) : 'none';

  const seen = new Set([...memories.map((m) => m.content), ...forgotten].map((c) => c.toLowerCase()));
  const toRemember = vetMemories(out?.remember, seen);

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
    model: result.modelVersion ?? MODEL,
  });

  // Passed on unjudged: the app holds the rules (src/data/questEdits.ts) and
  // the state they are checked against, so it is the one that decides.
  // A quest proposal holds quest changes only; anything else in it was
  // never meant to wait behind an Accept button.
  const changes = Array.isArray(out?.changes)
    ? out!.changes
        .filter((c) => c && typeof c === 'object')
        .filter((c) => mode !== 'board' || BOARD_OPS.includes(String((c as Record<string, unknown>).op)))
        .slice(0, 8)
    : [];

  // A quest proposal is shown with Accept; it changes nothing until then.
  return json({ reply, suggestions, action, remembered, changes, heard: audio ? heard : null, proposal: mode === 'board' });
});
