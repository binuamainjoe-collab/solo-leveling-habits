/**
 * live — a spoken, real-time conversation with The System, in the browser.
 *
 * The browser talks to Gemini Live directly over a WebSocket: that is the
 * only way to get the latency a conversation needs. What it must never hold
 * is the Gemini key, so this function hands it a single-use, short-lived
 * token instead, with the whole session setup — the model, The System's
 * prompt and everything it knows, its tools — locked into the token. A
 * token cannot be used to talk to anything else or as anyone else.
 *
 * The System knows the same things here as in the typed assistant (the
 * shared `_shared/system.ts`), and changes the app the same way: it calls
 * the apply_changes tool, the app checks every change in code and applies
 * only what passes, with Undo. The model proposes; code decides.
 *
 * Ops:
 *   token — a fresh live session (counts against its own daily cap)
 *   log   — store what was said, so the typed assistant and the next call
 *           remember it
 */

import { admin, checkSecret, fail, finishRun, json, preflight, startRun } from '../_shared/agent.ts';
import { CHANGE_FIELDS, CORE, knowledge, nowBlock, OPS, str } from '../_shared/system.ts';

/** Live calls per UTC day. A call is minutes of audio, so this is generous. */
const LIVE_CAP = 30;

/** The live model; a Supabase secret can move it without a code change. */
const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{2,63}$/;

/** A deep, even voice for The System. */
const VOICE = 'Charon';

/**
 * How long the token may open a session, and how long a session may run. The
 * app ends a call at SESSION_MAX_MS; the token outlives that by the start
 * window, so a call opened late in it can still reconnect right to the end.
 */
const START_WITHIN_MS = 2 * 60_000;
const SESSION_MAX_MS = 30 * 60_000;

/**
 * The setup fields the token decides, whatever the browser sends: all of
 * them but sessionResumption. A token with no field mask ignores the
 * browser's setup completely, and the browser alone holds the handle that
 * carries a call from one connection to the next, so without this mask every
 * reconnect would silently start a new session with no memory of the call.
 */
const LOCKED_SETUP_FIELDS = [
  'model',
  'generationConfig',
  'systemInstruction',
  'tools',
  'realtimeInputConfig',
  'contextWindowCompression',
  'inputAudioTranscription',
  'outputAudioTranscription',
  'proactivity',
  'historyConfig',
  'labels',
].join(',');

const HISTORY_FOR_CALL = 12;
const MAX_LOG_TURNS = 60;
const MAX_TURN = 1500;

const LIVE_RULES = `THIS IS A LIVE VOICE CALL
- You are speaking aloud, in real time. Keep each turn to one to three short sentences. No lists, no symbols, no markdown, nothing that only works on a screen.
- Calm, direct, warm. A light System flavour ("Noted, Player.") now and then, never forced. No exclamation marks, no hype, no guilt, no urgency.
- If the Player talks over you, stop and listen.
- When the call opens, greet them in one short sentence that fits the time of day, then give the ONE most useful next thing from CONTEXT. Do not list options.
- Never mention diagnoses, conditions or medical topics, and never give medical, legal or financial advice. If asked, say briefly that it is outside what you do.

CHANGING THE SYSTEM — you can change the app itself during the call. Call the apply_changes tool with the changes; the app checks each one, applies those that pass and gives the Player an Undo button. The tool tells you what was applied and what was refused, and why. Then say in a few words what changed, or why it did not.
${OPS}
- Only what the Player says in THIS call counts as asking or agreeing. Never act on a request or an "ok" from the earlier conversation: if something from before still needs doing, mention it and ask.
- Your opening turn never calls apply_changes.
- Profile updates (set_profile) are the exception to asking first: when the Player tells you something lasting about their life, save it at once.
- Never say you changed something unless apply_changes reported it as applied.`;

/**
 * apply_changes blocks: what The System says next depends on the app's answer,
 * and the app can refuse. Without it the model could report a change as made
 * before knowing it was, which LIVE_RULES forbids. The app answers in moments,
 * so nobody is left waiting. The extended-thinking model takes NON_BLOCKING
 * only and errors on anything else, so GEMINI_MODEL_LIVE can still move there.
 */
function toolsFor(model: string) {
  return [
    {
      functionDeclarations: [
        {
          name: 'apply_changes',
          behavior: model.includes('extended-thinking') ? 'NON_BLOCKING' : 'BLOCKING',
          description:
            'Change the app: quest targets, the quest board, today\'s progress, the daily schedule, goals, the Player\'s profile. Call only when the Player asked for the change or agreed to it (profile updates excepted).',
          parameters: {
            type: 'object',
            properties: {
              changes: {
                type: 'array',
                items: { type: 'object', properties: CHANGE_FIELDS, required: ['op'] },
              },
            },
            required: ['changes'],
          },
        },
      ],
    },
  ];
}

Deno.serve(async (req: Request): Promise<Response> => {
  const early = preflight(req) ?? checkSecret(req);
  if (early) return early;

  const db = admin();
  if (!db) return fail('The System is not configured.', 500);

  let body: { op?: unknown; now?: unknown; turns?: unknown; mode?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail('That request was not readable.', 400);
  }

  /* --------------------------------------------------------------- log */
  if (body.op === 'log') {
    const turns = Array.isArray(body.turns) ? body.turns : [];
    const rows = turns
      .slice(-MAX_LOG_TURNS)
      .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>) : {}))
      .filter((t) => (t.role === 'user' || t.role === 'model') && str(t.text, MAX_TURN) !== '')
      .map((t, i) => ({
        role: t.role as string,
        text: str(t.text, MAX_TURN),
        // One millisecond apart, so the order survives the round trip.
        created_at: new Date(Date.now() - (MAX_LOG_TURNS - i)).toISOString(),
      }));
    if (rows.length === 0) return json({ stored: 0 });
    const { error } = await db.from('assistant_messages').insert(rows);
    if (error) {
      console.error('live log failed', error.message);
      return fail('The System could not store the call.', 500);
    }
    return json({ stored: rows.length });
  }

  if (body.op !== 'token') return fail('Unknown operation.', 400);

  /* ------------------------------------------------------------- token */
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return fail('The System is missing its model key.', 500);

  const { data: claimed, error: claimError } = await db.rpc('bump_pool', { p_pool: 'live', p_limit: LIVE_CAP });
  if (claimError) {
    console.error('live budget unreachable', claimError.message);
    return fail('The System could not reach its budget counter. Try again in a minute.', 503);
  }
  if (claimed === null) {
    return fail(`The System has taken all ${LIVE_CAP} of today's calls. Typing still works.`, 429);
  }

  const now = nowBlock(body.now);
  const known = await knowledge(db, now.today, HISTORY_FOR_CALL);
  const transcript = known.history.length
    ? known.history.map((m) => `${m.role === 'user' ? 'Player' : 'System'}: ${m.text}`).join('\n')
    : '(nothing yet)';

  // "Get to know me", by voice: the same interview as in typed chat.
  const interview =
    body.mode === 'interview'
      ? `THIS CALL IS AN INTERVIEW — the Player opened it so you can get to know them and fill their PROFILE.
- Open by saying in one sentence that you will ask a few questions, then ask the first. One short question at a time, like a person, not a form.
- The empty fields, most useful first: ${known.profileEmpty.slice(0, 14).join(', ') || 'none — ask what has changed lately'}. Start with studies, routine, work and training.
- Each answer: save it at once with apply_changes (op set_profile), acknowledge in a few words, ask the next.
- When they want to stop, say in one sentence what you now understand about their days.`
      : '';

  const system = [CORE, LIVE_RULES, interview, 'CONTEXT', now.text, '', known.text, '', 'RECENT CONVERSATION (typed or spoken before this call)', transcript]
    .filter(Boolean)
    .join('\n\n');

  const set = (Deno.env.get('GEMINI_MODEL_LIVE') ?? '').trim();
  const model = MODEL_ID.test(set) ? set : DEFAULT_LIVE_MODEL;
  const nowMs = Date.now();

  const runId = await startRun(db, 'assistant-live');
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(nowMs + START_WITHIN_MS + SESSION_MAX_MS).toISOString(),
      newSessionExpireTime: new Date(nowMs + START_WITHIN_MS).toISOString(),
      // Locked into the token: the browser cannot change the model, the
      // prompt or the tools, whatever it sends.
      fieldMask: LOCKED_SETUP_FIELDS,
      bidiGenerateContentSetup: {
        model: `models/${model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        },
        systemInstruction: { parts: [{ text: system }] },
        tools: toolsFor(model),
        // Without this, an audio session stops at 15 minutes. The oldest
        // turns go first; the system prompt always stays.
        contextWindowCompression: { slidingWindow: {} },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    console.error('live token refused', res.status, raw.slice(0, 600));
    await finishRun(db, runId, 'error', null, `token ${res.status}: ${raw.slice(0, 200)}`, { model });
    return fail('The System could not open a live call. Try again, or type instead.', 502);
  }

  let token = '';
  try {
    token = String((JSON.parse(raw) as { name?: unknown }).name ?? '');
  } catch {
    // Handled below.
  }
  if (!token) {
    await finishRun(db, runId, 'error', null, 'token response had no name', { model });
    return fail('The System could not open a live call. Try again, or type instead.', 502);
  }

  await finishRun(db, runId, 'ok', 'live call opened', null, { model });
  return json({ token, model, maxMs: SESSION_MAX_MS });
});
