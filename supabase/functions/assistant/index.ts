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
 *   learn   — read the conversation since the last pass (typed, spoken and
 *             live calls alike) and keep what it says about the Player:
 *             memories, and profile fields it fills or updates
 *   recall  — answer a question about the Player from everything Beerus
 *             knows, his notes and the original files included; a live
 *             call asks this through its recall tool
 *
 * Every model call here runs on the model the Player picked for Beerus
 * (Gemini 4 Hydrogen unless they chose another), and only on it.
 */

import {
  caller,
  fail,
  finishRun,
  gemini,
  json,
  MODEL,
  parseJson,
  preflight,
  startRun,
} from '../_shared/agent.ts';
import { APP_TIMEOUT_MS, CHAT_BUDGET_MS, DEEP_TIMEOUT_MS, modelsForRole } from '../_shared/models.ts';
import { CATALOG, cleanValue, isField, loadLibrary, sanitize } from '../_shared/profile.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { CHANGE_FIELDS, CORE, knowledge, nowBlock, OPS, settingsOf, str } from '../_shared/system.ts';

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
- Whenever the Player tells you something lasting about themselves, remember it. Small talk remembers nothing: return an empty list.
- Use what you know. Tie advice to specific things in the PROFILE, MEMORY and their files, the way someone who knows them would, without reciting it back.

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
function vetMemories(raw: unknown, known: Set<string>, max = 3): { kind: MemoryKind; content: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { kind: MemoryKind; content: string }[] = [];
  for (const item of raw.slice(0, max)) {
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

/* ------------------------------------------------------------------ learn */

/** The most messages one learning pass reads; a longer backlog takes more passes. */
const LEARN_BATCH = 80;
/** The most memories one pass may add. */
const LEARN_MAX_MEMORIES = 15;
const LEARN_MAX_FIELDS = 10;

const PROFILE_KEYS = Object.entries(CATALOG)
  .flatMap(([section, def]) => Object.entries(def.fields).map(([f, label]) => `${section}.${f} (${label})`))
  .join(', ');

const LEARN_SYSTEM = `You keep the long-term memory of Beerus, a personal assistant, about one person: the Player.
Read the CONVERSATION (typed messages, spoken messages and live voice calls) and write down every durable thing it tells you about the Player, so Beerus knows them next month the way a good friend would.
- memories: facts about their life, studies, work and plans (with dates); preferences, likes and dislikes; routines and commitments; what motivates them and what derails them; patterns that recur. kind is fact, preference, commitment or pattern.
- One idea per memory, in third person ("Studies best after dinner"), under 200 characters, dates absolute (YYYY-MM-DD; today is in CONTEXT).
- Only what the Player said or clearly confirmed. Never something Beerus assumed or suggested that the Player did not take up.
- Skip what MEMORY or the PROFILE already says. If something there has changed, write the new version.
- profile: the fields this conversation fills or updates, each with a short value in third person. Fields: ${PROFILE_KEYS}. Only what the Player stated.
- Never: passwords, codes or long numbers, health or medical details, anything about other people beyond a name and a role, passing moods.
- A conversation with nothing lasting in it gives two empty lists.`;

const LEARN_SCHEMA = {
  type: 'object',
  properties: {
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: { kind: { type: 'string', enum: [...MEMORY_KINDS] }, content: { type: 'string' } },
        required: ['kind', 'content'],
        propertyOrdering: ['kind', 'content'],
      },
    },
    profile: {
      type: 'array',
      items: {
        type: 'object',
        properties: { section: { type: 'string' }, field: { type: 'string' }, value: { type: 'string' } },
        required: ['section', 'field', 'value'],
        propertyOrdering: ['section', 'field', 'value'],
      },
    },
  },
  required: ['memories', 'profile'],
  propertyOrdering: ['memories', 'profile'],
};

/**
 * Read what was said since the last pass and keep what lasts.
 *
 * The chat's own `remember` list catches a little as it goes, and a live
 * call's voice model saves only when it remembers to call its tool. This
 * pass reads every turn afterwards, with Beerus's model, so what the Player
 * said in a call is not gone when the call ends. It moves a bookmark
 * (user_settings.learned_until), so each message is read once.
 */
async function learn(db: SupabaseClient, sys: SupabaseClient, userId: string, today: string): Promise<Response> {
  const settings = await settingsOf(db);
  // Since the bookmark, oldest first; on the first pass, the newest batch.
  const query = settings.learnedUntil
    ? db
        .from('assistant_messages')
        .select('role, text, created_at')
        .gt('created_at', settings.learnedUntil)
        .order('created_at', { ascending: true })
        .limit(LEARN_BATCH)
    : db.from('assistant_messages').select('role, text, created_at').order('created_at', { ascending: false }).limit(LEARN_BATCH);
  const { data: rows, error: readError } = await query;
  if (readError) return fail('The System could not read the conversation.', 500);
  const messages = settings.learnedUntil ? (rows ?? []) : (rows ?? []).reverse();
  // Nothing new, or nothing the Player said: no model call.
  if (!messages.some((m) => m.role === 'user')) return json({ learned: [], profile: [] });

  const { data: claimed, error: claimError } = await sys.rpc('bump_pool', { p_pool: 'assistant', p_limit: ASSISTANT_CAP });
  if (claimError) return fail('The System could not reach its budget counter. Try again in a minute.', 503);
  if (claimed === null) return fail(`Beerus has used all ${ASSISTANT_CAP} of today's turns. He will catch up tomorrow.`, 429);

  const [known, profileRow] = await Promise.all([knowledge(db, today, 1), db.from('life_profile').select('data').maybeSingle()]);
  const transcript = messages.map((m) => `${m.role === 'user' ? 'Player' : 'Beerus'}: ${str(m.text, 1500)}`).join('\n');
  const runId = await startRun(db, 'assistant-learn');
  const result = await gemini({
    system: LEARN_SYSTEM,
    prompt: ['CONTEXT', `Today is ${today}.`, '', known.text, '', 'CONVERSATION', transcript].join('\n'),
    schema: LEARN_SCHEMA,
    thinkingLevel: 'low',
    models: modelsForRole('beerus', settings.models, (name) => Deno.env.get(name)),
    budgetMs: 40_000,
  });
  const spend = { usage: result.usage, durationMs: result.durationMs, model: result.modelVersion ?? MODEL };
  if (!result.ok || !result.text) {
    await finishRun(db, runId, 'error', null, result.error ?? 'no reply', spend);
    return fail('Beerus could not go over the conversation just now.', 502);
  }
  const out = parseJson<{ memories?: unknown; profile?: unknown }>(result.text) ?? {};

  // Memories: the same rules as the chat's, with more room per pass.
  const seen = new Set([...known.memories.map((m) => m.content), ...known.forgotten].map((c) => c.toLowerCase()));
  const learned: { kind: MemoryKind; content: string }[] = [];
  for (const m of vetMemories(out.memories, seen, LEARN_MAX_MEMORIES)) {
    const { error } = await db.from('memories').insert({ kind: m.kind, content: m.content, goal_id: known.focusId });
    if (!error) learned.push(m);
    else if (error.code !== '23505') console.error('learned memory not stored', error.message);
  }

  // Profile fields: catalogue fields only, cleaned, as the profile function does.
  const profile = sanitize(profileRow.data?.data);
  const fields: { section: string; field: string; value: string }[] = [];
  for (const item of (Array.isArray(out.profile) ? out.profile : []).slice(0, LEARN_MAX_FIELDS)) {
    const f = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const section = str(f.section, 30);
    const field = str(f.field, 30);
    const value = cleanValue(f.value);
    if (!isField(section, field) || !value || profile[section]?.[field] === value) continue;
    (profile[section] ??= {})[field] = value;
    fields.push({ section, field, value });
  }
  if (fields.length) {
    const { error } = await db
      .from('life_profile')
      .upsert({ user_id: userId, data: profile, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) console.error('learned profile not stored', error.message);
  }

  // The bookmark moves past everything read, learned from or not.
  const last = messages[messages.length - 1].created_at as string;
  const { error: markError } = await db
    .from('user_settings')
    .upsert({ user_id: userId, learned_until: last, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (markError) console.error('learning bookmark not moved', markError.message);

  await finishRun(db, runId, 'ok', `learned ${learned.length} memories, ${fields.length} profile fields`, null, spend);
  return json({ learned, profile: fields });
}

/* ----------------------------------------------------------------- recall */

/** What recall may send of the original files: Gemini takes 20 MB a request, prompt included. */
const RECALL_FILE_BYTES = 14 * 1024 * 1024;

const RECALL_SYSTEM = `You are Beerus's memory. A live voice call needs an answer about the Player.
Answer the QUESTION from KNOWLEDGE and the attached files (the Player's own uploads) only.
- Two to four short sentences of plain spoken words: it will be said aloud. No lists, symbols or markdown.
- Give specifics (dates, names, times, numbers) exactly as they appear.
- If nothing here answers it, say so in one sentence, so Beerus can ask the Player instead.`;

/** Answer a question about the Player from everything Beerus knows, his files included. */
async function recall(db: SupabaseClient, sys: SupabaseClient, question: string, today: string): Promise<Response> {
  if (!question) return fail('Ask something to recall.', 400);
  const { data: claimed, error: claimError } = await sys.rpc('bump_pool', { p_pool: 'assistant', p_limit: ASSISTANT_CAP });
  if (claimError) return fail('The System could not reach its budget counter.', 503);
  if (claimed === null) return json({ answer: `Beerus has used all ${ASSISTANT_CAP} of today's turns, so he cannot look that up now.` });

  const [known, settings, library] = await Promise.all([
    knowledge(db, today, HISTORY_FOR_MODEL),
    settingsOf(db),
    loadLibrary(db, RECALL_FILE_BYTES),
  ]);
  const transcript = known.history.map((m) => `${m.role === 'user' ? 'Player' : 'Beerus'}: ${m.text}`).join('\n');
  const runId = await startRun(db, 'assistant-recall');
  const result = await gemini({
    system: RECALL_SYSTEM,
    prompt: [
      'KNOWLEDGE',
      `Today is ${today}.`,
      known.text,
      transcript ? `\nRECENT CONVERSATION\n${transcript}` : '',
      library.names.length ? `\nATTACHED FILES: ${library.names.join(', ')}` : '\nNo files attached.',
      '',
      'QUESTION',
      question,
    ].join('\n'),
    files: library.files,
    thinkingLevel: 'low',
    models: modelsForRole('beerus', settings.models, (name) => Deno.env.get(name)),
    budgetMs: 25_000,
  });
  const spend = { usage: result.usage, durationMs: result.durationMs, model: result.modelVersion ?? MODEL };
  if (!result.ok || !result.text) {
    await finishRun(db, runId, 'error', null, result.error ?? 'no answer', spend);
    return json({ answer: 'Beerus could not reach his memory just now. Ask the Player instead.' });
  }
  const answer = str(result.text, 1200);
  await finishRun(db, runId, 'ok', answer.slice(0, 200), null, spend);
  return json({ answer });
}

/* ------------------------------------------------------------------ serve */

Deno.serve(async (req: Request): Promise<Response> => {
  // The app stops listening 45 s after it sent this; everything below is
  // timed against that.
  const requestStart = Date.now();
  const early = preflight(req);
  if (early) return early;

  // The signed-in account. `db` reaches only their rows; `sys` is for the
  // shared daily budget alone.
  const who = await caller(req);
  if (who instanceof Response) return who;
  const { db, sys, userId } = who;

  let body: { op?: unknown; text?: unknown; now?: unknown; audio?: unknown; mode?: unknown; question?: unknown };
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

  if (body.op === 'learn') return await learn(db, sys, userId, nowBlock(body.now).today);
  if (body.op === 'recall') return await recall(db, sys, str(body.question, 400), nowBlock(body.now).today);

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

  const { data: claimed, error: claimError } = await sys.rpc('bump_pool', {
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
  // live voice call, so both are the same System), and the model the
  // Player picked for Beerus.
  const [known, settings] = await Promise.all([knowledge(db, now.today, HISTORY_FOR_MODEL), settingsOf(db)]);
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
    // Typed and spoken both go to Beerus's model alone (Gemini 4 Hydrogen
    // unless the Player picked another): no quiet switch to a model they
    // did not choose. If it fails, the app says so and they can try again.
    models: modelsForRole('beerus', settings.models, (name) => Deno.env.get(name)),
    deepTimeoutMs: audio ? DEEP_TIMEOUT_MS.voice : DEEP_TIMEOUT_MS.chat,
    // A reply this function would throw away (unreadable JSON, no reply)
    // counts as a failure, which the Player sees and can retry.
    accept: (text) => str(parseJson<Proposed>(text)?.reply, MAX_REPLY) !== '',
    // The whole call must finish while the app is still waiting.
    budgetMs: CHAT_BUDGET_MS - (Date.now() - requestStart),
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
