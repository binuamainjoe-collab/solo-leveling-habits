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
 *
 * Beerus's framework (../_shared/beerus/, after OpenJarvis's primitives)
 * shapes each `send`: the router decides how much conversation and memory
 * the message needs and how hard to think, memory retrieval picks the
 * memories related to it, and after the reply a trace row is stored and a
 * learning pass starts on its own when enough has been said.
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
import {
  ACTIONS,
  type Action,
  buildPrompt,
  checkReply,
  MEMORY_KINDS,
  type MemoryKind,
  type Mode,
  MODES,
  NEVER_REMEMBER,
  type Proposed,
  RESPONSE_SCHEMA,
  SYSTEM,
} from '../_shared/beerus/contract.ts';
import { buildTrace, shouldLearn, type Trace } from '../_shared/beerus/learning.ts';
import { analyze, fitHistory, route } from '../_shared/beerus/router.ts';
import { APP_TIMEOUT_MS, CHAT_BUDGET_MS, DEEP_TIMEOUT_MS, modelsForRole } from '../_shared/models.ts';
import { CATALOG, cleanValue, isField, loadLibrary, sanitize } from '../_shared/profile.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { knowledge, nowBlock, settingsOf, str } from '../_shared/system.ts';

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

/* The prompt, the reply shape and the reply rules live in ../_shared/beerus/contract.ts. */

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

  // One pass at a time per account (claim_learning in the beerus_traces
  // migration): a second request while one runs spends nothing. Released
  // below when the bookmark moves; a pass that dies lets go after 2 minutes.
  const { data: free, error: lockError } = await db.rpc('claim_learning');
  if (lockError) console.warn('learning lock unavailable, going ahead', lockError.message);
  else if (free !== true) return json({ learned: [], profile: [], busy: true });

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
    .upsert(
      { user_id: userId, learned_until: last, learning_started_at: null, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
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

/* ------------------------------------------------------------ background */

/**
 * Work that may finish after the reply has gone: the trace row and a
 * learning pass. Supabase's EdgeRuntime keeps the function alive for it;
 * anywhere without it, the promise simply runs on its own.
 */
function later(work: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  const safe = work.catch((e) => console.error('background work failed', e instanceof Error ? e.message : String(e)));
  if (runtime?.waitUntil) runtime.waitUntil(safe);
}

/** One trace row (see beerus/learning.ts). Losing it never fails a reply. */
async function storeTrace(db: SupabaseClient, trace: Trace): Promise<void> {
  const { error } = await db.from('beerus_traces').insert(trace);
  if (error) console.warn('trace not stored', error.message);
}

/**
 * Whether enough has been said since the last learning pass to start
 * another (shouldLearn in beerus/learning.ts), counting the Player's
 * messages after the bookmark.
 */
async function learningDue(db: SupabaseClient, learnedUntil: string | null): Promise<boolean> {
  let query = db.from('assistant_messages').select('id', { count: 'exact', head: true }).eq('role', 'user');
  if (learnedUntil) query = query.gt('created_at', learnedUntil);
  const { count, error } = await query;
  if (error) {
    console.warn('could not count unlearned messages', error.message);
    return false;
  }
  return shouldLearn({ unlearnedUserMessages: count ?? 0, learnedUntil });
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

  // The router reads the message first and decides how much this reply
  // needs: how much conversation, which memories, whether the quest
  // catalogue goes in, how hard to think and the prompt's budget
  // (beerus/router.ts). The model itself is always the Player's pick.
  const ctx = analyze(typed, { mode, spoken: Boolean(audio) });
  const plan = route(ctx);
  const now = nowBlock(body.now, { catalog: plan.catalog });

  // Everything the System knows, gathered in one pass (shared with the
  // live voice call, so both are the same System), with the memories most
  // related to this message, and the model the Player picked for Beerus.
  const [known, settings] = await Promise.all([
    // A spoken message has no words to rank on before the model hears it:
    // no retrieval, every memory.
    knowledge(db, now.today, Math.min(plan.historyTurns, HISTORY_FOR_MODEL), audio ? undefined : { query: typed, topK: plan.memoryTopK }),
    settingsOf(db),
  ]);
  const focus = known.focusId ? { id: known.focusId } : null;
  const memories = known.memories;
  const forgotten = known.forgotten;

  // The prompt without its conversation, then as much of the conversation
  // as the route's budget allows (oldest turns go first, never below four).
  const promptParts = { now: now.text, knowledge: known.text, mode, profileEmpty: known.profileEmpty, message: typed, spoken: Boolean(audio) };
  const fixedChars = SYSTEM.length + buildPrompt({ ...promptParts, history: [] }).length;
  const fit = fitHistory(fixedChars, known.history, plan.budgetChars);
  const prompt = buildPrompt({ ...promptParts, history: fit.kept });

  // One trace row per reply, whatever the outcome (beerus/learning.ts).
  const traceOf = (
    outcome: Trace['outcome'],
    r?: { usage?: { in: number; out: number; thoughts: number }; durationMs?: number; modelVersion?: string },
    extra: { changes?: number; remembered?: number; learnStarted?: boolean; violations?: string[]; changesDropped?: number } = {},
  ) =>
    buildTrace({
      ctx,
      route: plan,
      historyTurns: fit.kept.length,
      memoriesSent: known.memoriesSent,
      memoriesTotal: known.memories.length,
      promptChars: SYSTEM.length + prompt.length,
      durationMs: r?.durationMs,
      usage: r?.usage,
      model: r?.modelVersion ?? null,
      outcome,
      catalogSent: now.catalogSent,
      historyTrimmed: fit.trimmed,
      overBudget: fit.over,
      ...extra,
    });

  const runId = await startRun(db, 'assistant');
  const result = await gemini({
    system: SYSTEM,
    prompt,
    schema: RESPONSE_SCHEMA,
    thinkingLevel: plan.thinking,
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
    later(Promise.resolve().then(() => storeTrace(db, traceOf('error', result))));
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
    later(Promise.resolve().then(() => storeTrace(db, traceOf('too_slow', result))));
    return fail('The System took too long to answer. Try again.', 504);
  }

  const out = parseJson<Proposed>(result.text);
  const reply = str(out?.reply, MAX_REPLY);
  // What was said: the transcript for a spoken message, the text otherwise.
  const heard = audio ? str(out?.heard, MAX_MESSAGE) : '';
  const text = audio ? heard : typed;
  if (audio && !heard) {
    await finishRun(db, runId, 'ok', 'voice: nothing heard', null, { usage: result.usage, durationMs: result.durationMs, model: result.modelVersion ?? MODEL });
    later(Promise.resolve().then(() => storeTrace(db, traceOf('not_heard', result))));
    return fail('The System could not make out what you said. Try again, a little closer to the mic.', 422);
  }
  if (!reply) {
    await finishRun(db, runId, 'error', null, 'empty reply', { usage: result.usage, durationMs: result.durationMs, model: result.modelVersion ?? MODEL });
    later(Promise.resolve().then(() => storeTrace(db, traceOf('error', result))));
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

  // The contract (beerus/contract.ts): every reply is checked and every
  // broken rule recorded in the trace. A non-quest change inside a quest
  // proposal is held back here, as before; everything else goes to the app,
  // which holds the rest of the rules (src/data/questEdits.ts) and shows
  // the Player why it refused anything (an invented quest id, say).
  const checked = checkReply(out, { spoken: Boolean(audio), mode, questIds: now.questIds, goalIds: known.goalIds });
  const changes = checked.changes;
  const changesDropped = checked.dropped;
  if (checked.violations.length) console.warn('beerus contract', checked.violations.join(','));

  // After the reply: the trace, and a learning pass if enough has been said
  // since the last one, so Beerus keeps what he hears without waiting for
  // the app to ask. The exchange above is already stored, so the pass
  // reads it too.
  later(
    (async () => {
      let learnRan = false;
      if (await learningDue(db, settings.learnedUntil)) {
        const res = await learn(db, sys, userId, now.today);
        const body = (await res.json().catch(() => ({}))) as { busy?: unknown };
        learnRan = res.ok && body.busy !== true;
        if (!res.ok) console.warn('background learning pass failed', res.status);
      }
      await storeTrace(
        db,
        traceOf('ok', result, {
          changes: changes.length,
          remembered: remembered.length,
          learnStarted: learnRan,
          violations: checked.violations,
          changesDropped,
        }),
      );
    })(),
  );

  // A quest proposal is shown with Accept; it changes nothing until then.
  return json({ reply, suggestions, action, remembered, changes, heard: audio ? heard : null, proposal: mode === 'board' });
});
