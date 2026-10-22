/**
 * Everything the shadows share.
 *
 * The roster is expected to grow, so auth, the daily call budget, run logging
 * and the Gemini transport live here rather than being copied into each
 * agent. A new shadow should be its prompt, its schema and its handler —
 * nothing else.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

import {
  type Attempt,
  attemptTimeout,
  BACKGROUND_BUDGET_MS,
  benchModel,
  billedUsage,
  DEEP_TIMEOUT_MS,
  DEFAULT_MODELS,
  type Failure,
  geminiUrl,
  modelsFor,
  runModel,
  worthBenching,
  worthFallingBack,
  type Tier,
} from './models.ts';

/**
 * The Flash id, kept for callers that log a model when Gemini named none.
 * `gemini()` itself always reports the model that actually answered.
 */
export const MODEL = DEFAULT_MODELS.fast;

/** Calls allowed per UTC day, across every agent and the nightly briefing. */
export const DAILY_CAP = 30;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-app-secret',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** A failure the student is meant to read, as-is. */
export function fail(message: string, status: number): Response {
  return json({ error: message }, status);
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail('Use POST.', 405);
  return null;
}

/**
 * The only gate. JWT verification is off for these functions, so this header
 * is what stands between the endpoint and the open internet — backed by the
 * hard cap below, which is what actually limits the damage if the secret
 * leaks out of the bundle it ships in.
 */
export function checkSecret(req: Request): Response | null {
  const expected = Deno.env.get('APP_SECRET');
  if (!expected) return fail('The System is not configured.', 500);
  if (req.headers.get('x-app-secret') !== expected) return fail('Not allowed.', 401);
  return null;
}

export function admin(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Reserve `amount` calls against today's budget, atomically.
 *
 * Claimed up front rather than counted afterwards: an agent that makes two
 * model calls must know both are affordable before spending the first, or a
 * run can die halfway having already burned budget and produced nothing.
 * A run that then fails still costs its reservation, which is the safe
 * direction to be wrong in.
 */
export async function claimCalls(
  db: SupabaseClient,
  amount: number,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const { data, error } = await db.rpc('bump_usage', { p_limit: DAILY_CAP, p_amount: amount });

  if (error) {
    console.error('usage counter unreachable', error.message);
    return { ok: false, response: fail('The System could not reach its usage counter. Try again shortly.', 503) };
  }
  if (data === null) {
    return {
      ok: false,
      response: fail(
        `The System has spent all ${DAILY_CAP} of today's calls. The shadows rest until tomorrow.`,
        429,
      ),
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------ run logging */

export async function startRun(db: SupabaseClient, agent: string): Promise<string | null> {
  const { data, error } = await db
    .from('agent_runs')
    .insert({ agent, status: 'running' })
    .select('id')
    .single();
  if (error) {
    // Losing the audit row must not stop the work.
    console.error('could not open agent_run', error.message);
    return null;
  }
  return data.id as string;
}

export async function finishRun(
  db: SupabaseClient,
  id: string | null,
  status: 'ok' | 'error',
  summary: string | null,
  error: string | null,
  /** What the run cost, when it made a model call. The Steward reads these. */
  spend?: { usage?: GeminiUsage; durationMs?: number; model?: string },
): Promise<void> {
  if (!id) return;
  const { error: updateError } = await db
    .from('agent_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      output_summary: summary,
      error,
      tokens_in: spend?.usage?.in ?? null,
      tokens_out: spend?.usage?.out ?? null,
      tokens_thoughts: spend?.usage?.thoughts ?? null,
      duration_ms: spend?.durationMs ?? null,
      model: spend?.model ?? null,
    })
    .eq('id', id);
  if (updateError) console.error('could not close agent_run', updateError.message);
}

/** Add two calls' usage together, for an agent that makes more than one. */
export function addUsage(a?: GeminiUsage, b?: GeminiUsage): GeminiUsage {
  return {
    in: (a?.in ?? 0) + (b?.in ?? 0),
    out: (a?.out ?? 0) + (b?.out ?? 0),
    thoughts: (a?.thoughts ?? 0) + (b?.thoughts ?? 0),
  };
}

/* ---------------------------------------------------------------- gemini */

export interface GeminiCall {
  system?: string;
  prompt: string;
  /** Google Search grounding. Cannot be combined with `schema` — see below. */
  grounded?: boolean;
  /** A responseSchema for JSON mode. */
  schema?: unknown;
  /**
   * A spoken message, sent alongside the prompt for the model to hear.
   * Base64, inline — the request must stay under Gemini's 20 MB limit.
   */
  audio?: { mimeType: string; data: string };
  /** A document or photo for the model to read (a PDF, a timetable photo). Base64, inline. */
  file?: { mimeType: string; data: string };
  temperature?: number;
  /**
   * How much reasoning to allow.
   *
   * Deliberately no 'minimal': neither gemini-4-argon nor 3.8 Flash
   * supports it, and asking errors. Omitting the field uses the model's
   * default ('medium'), so a caller that wants a fast call says 'low'.
   */
  thinkingLevel?: 'low' | 'medium' | 'high';
  /**
   * Which model tier (see models.ts). Deep unless a caller says otherwise,
   * so Beru, Igris and the Steward all get the flagship, with Flash behind.
   */
  tier?: Tier;
  /** How long a deep attempt may run before Flash is asked instead. */
  deepTimeoutMs?: number;
  /**
   * The most every attempt together may take, from this call on, so the
   * Flash fallback cannot run past the moment the app gives up. Defaults to
   * BACKGROUND_BUDGET_MS, which keeps a shadow's run inside the edge
   * function's time limit.
   */
  budgetMs?: number;
  /**
   * Reserve one more model call against the caller's daily cap before the
   * fallback is asked. A fallback is a second billed request, so it counts
   * like one; when the cap has nothing left, the call ends with the first
   * model's failure instead. Defaults to the shadows' shared budget
   * (DAILY_CAP), which is what Beru, Igris and the Steward draw on.
   */
  claimFallback?: () => Promise<boolean>;
  /**
   * Whether the text of a 200 is something the caller can use (for
   * example, JSON with a non-empty reply). When it is not, the next model
   * is asked instead of handing the caller an answer it would throw away.
   */
  accept?: (text: string) => boolean;
}

/**
 * What a call cost, for the Steward's accounting.
 *
 * `out` and `thoughts` are kept apart because Gemini reports them apart:
 * `candidatesTokenCount` excludes reasoning, yet reasoning is billed at the
 * output rate. Collapsing them here would make every cost figure too low.
 */
export interface GeminiUsage {
  in: number;
  out: number;
  thoughts: number;
}

export interface GeminiResult {
  ok: boolean;
  text?: string;
  /** Present only on a grounded call that actually searched. */
  sources?: { uri: string; title: string }[];
  /**
   * What Gemini says it served, or the model that failed. After a fallback,
   * every attempt in order ("gemini-4-argon:timeout>gemini-3.8-flash"; see
   * runModel), so the run log and the Steward's cost line see both.
   */
  modelVersion?: string;
  /** Every attempt's tokens together (see billedUsage), not only the last one's. */
  usage?: GeminiUsage;
  durationMs?: number;
  error?: string;
}

/**
 * One Gemini call.
 *
 * Grounding and JSON mode are mutually exclusive, and the failure is silent:
 * asking for a responseSchema alongside google_search turns the search off
 * and returns confidently ungrounded text. Rather than trust a caller to
 * remember that, this refuses the combination outright.
 */
export async function gemini(call: GeminiCall): Promise<GeminiResult> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return { ok: false, error: 'The System is missing its model key.' };

  if (call.grounded && call.schema) {
    return { ok: false, error: 'Grounding and JSON mode cannot share a call.' };
  }

  const body: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: call.prompt },
          ...(call.audio ? [{ inlineData: { mimeType: call.audio.mimeType, data: call.audio.data } }] : []),
          ...(call.file ? [{ inlineData: { mimeType: call.file.mimeType, data: call.file.data } }] : []),
        ],
      },
    ],
    generationConfig: {
      temperature: call.temperature ?? 0.6,
      ...(call.thinkingLevel ? { thinkingConfig: { thinkingLevel: call.thinkingLevel } } : {}),
      ...(call.schema
        ? { responseMimeType: 'application/json', responseSchema: call.schema }
        : {}),
    },
  };
  if (call.system) body.systemInstruction = { parts: [{ text: call.system }] };
  if (call.grounded) body.tools = [{ google_search: {} }];

  // Deep first, Flash behind it. Only a failure Flash might not share moves
  // on; anything the model actually answered is the answer.
  const models = modelsFor(call.tier ?? 'deep', (name) => Deno.env.get(name));
  const startedAt = Date.now();
  const budgetMs = call.budgetMs ?? BACKGROUND_BUDGET_MS;
  const attempts: Attempt[] = [];
  // Whatever the last attempt ended with, carrying every attempt's model
  // and tokens: a turn that paid for the flagship and then Flash is logged
  // and priced as both.
  const settle = (r: GeminiResult): GeminiResult => ({ ...r, modelVersion: runModel(attempts), usage: billedUsage(attempts) });
  let result: GeminiResult = { ok: false, error: 'The System could not reach the model.' };
  for (let i = 0; i < models.length; i++) {
    const last = i === models.length - 1;
    const timeoutMs = attemptTimeout(last, call.deepTimeoutMs ?? DEEP_TIMEOUT_MS.background, budgetMs - (Date.now() - startedAt));
    const attempt = await geminiOnce(models[i], body, key, call.grounded === true, startedAt, timeoutMs);
    result = attempt.result;
    let status: Failure | 'answered' = attempt.status;
    // A 200 the caller cannot use is a failure like any other.
    if (result.ok && call.accept && !call.accept(result.text ?? '')) {
      console.error('gemini: unusable reply from', models[i], (result.text ?? '').slice(0, 400));
      status = 'unusable';
      result = { ...result, ok: false, error: 'The model sent something unreadable.' };
    }
    attempts.push({ model: result.modelVersion ?? models[i], status, usage: result.usage });
    if (status === 'answered' || last || !worthFallingBack(status)) return settle(result);
    // Only a failure about the model itself (slow, down, not allowed) skips
    // it for the next messages; one odd request does not.
    const bench = worthBenching(status);
    if (bench) benchModel(models[i]);
    // The fallback is a second billed request, so it is claimed like one.
    if (!(await (call.claimFallback ?? claimShadowCall)())) {
      console.warn(`gemini: ${models[i]} failed (${status}); no fallback, today's cap is spent`);
      return settle(result);
    }
    console.warn(
      `gemini: ${models[i]} failed (${status}); falling back to ${models[i + 1]}${bench ? ', and skipping it for 10 min' : ' for this call only'}`,
    );
  }
  return settle(result);
}

/** The default fallback claim: one call from the shadows' shared daily budget. */
async function claimShadowCall(): Promise<boolean> {
  const db = admin();
  if (!db) return false;
  return (await claimCalls(db, 1)).ok;
}

/** One call to one model. `status` says how it ended, for the fallback decision. */
async function geminiOnce(
  model: string,
  body: Record<string, unknown>,
  key: string,
  grounded: boolean,
  startedAt: number,
  timeoutMs: number,
): Promise<{ result: GeminiResult; status: Failure | 'answered' }> {
  // Every result names the model it came from, failures included, so a run
  // log never blames Flash for something the flagship did.
  // The body is read inside the try too: the time limit covers it, and a
  // reply that is still arriving when time runs out is a timeout like any
  // other, which falls back instead of escaping as an unhandled error.
  let res: Response;
  let raw: string;
  try {
    res = await fetch(geminiUrl(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    raw = await res.text();
  } catch (err) {
    const timedOut = err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      result: { ok: false, error: 'The System could not reach the model.', modelVersion: model, durationMs: Date.now() - startedAt },
      status: timedOut ? 'timeout' : 'network',
    };
  }

  if (!res.ok) {
    console.error('gemini error', model, res.status, raw.slice(0, 600));
    const error = res.status === 429 ? 'The model is rate limited. Try again in a minute.' : 'The model refused that request.';
    return { result: { ok: false, error, modelVersion: model }, status: res.status };
  }
  const result = readEnvelope(raw, model, grounded, startedAt);
  // A 200 with nothing usable in it (blocked, empty, unreadable) falls back too.
  return result.ok ? { result, status: 'answered' } : { result: { ...result, modelVersion: model }, status: 'unusable' };
}

/** Turn a 200 from Gemini into a result. */
function readEnvelope(raw: string, model: string, grounded: boolean, startedAt: number): GeminiResult {

  try {
    const data = JSON.parse(raw) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
      }[];
      modelVersion?: string;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
      promptFeedback?: { blockReason?: string };
    };

    // A non-thinking model omits thoughtsTokenCount entirely, so default
    // rather than assume the key is there.
    const usage: GeminiUsage = {
      in: data.usageMetadata?.promptTokenCount ?? 0,
      out: data.usageMetadata?.candidatesTokenCount ?? 0,
      thoughts: data.usageMetadata?.thoughtsTokenCount ?? 0,
    };

    // A blocked or empty reply is still billed, so its usage is kept.
    if (data.promptFeedback?.blockReason) {
      return { ok: false, error: 'The model would not answer that. Try rewording the goal.', usage };
    }

    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text.trim()) {
      console.error('empty candidate', raw.slice(0, 600));
      return { ok: false, error: 'The model came back empty.', usage };
    }

    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const sources = chunks
      .map((c) => ({ uri: c.web?.uri ?? '', title: c.web?.title ?? '' }))
      .filter((s) => s.uri.length > 0);

    return {
      ok: true,
      text,
      sources: grounded ? sources : undefined,
      modelVersion: data.modelVersion ?? model,
      usage,
      durationMs: Date.now() - startedAt,
    };
  } catch {
    console.error('unparseable gemini envelope', raw.slice(0, 600));
    return { ok: false, error: 'The model sent something unreadable.' };
  }
}

/** Parse the JSON a schema-constrained call returns. */
export function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    console.error('unparseable model json', text.slice(0, 400));
    return null;
  }
}
