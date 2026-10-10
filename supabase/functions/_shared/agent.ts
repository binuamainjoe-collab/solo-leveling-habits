/**
 * Everything the shadows share.
 *
 * The roster is expected to grow, so auth, the daily call budget, run logging
 * and the Gemini transport live here rather than being copied into each
 * agent. A new shadow should be its prompt, its schema and its handler —
 * nothing else.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

/** The current Flash model, per ai.google.dev/gemini-api/docs/models. */
export const MODEL = 'gemini-3.8-flash';
export const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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
  temperature?: number;
  /**
   * How much reasoning to allow.
   *
   * Deliberately no 'minimal': Google lists it as unsupported — and
   * erroring — on 3.8 and 3.7 Flash, which is what this project runs.
   * Omitting the field entirely defaults to 'high', so a caller that wants
   * a cheap, fast call has to say 'low' explicitly.
   */
  thinkingLevel?: 'low' | 'high';
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
  /** What Gemini says it actually served. */
  modelVersion?: string;
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
    contents: [{ role: 'user', parts: [{ text: call.prompt }] }],
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

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'The System could not reach the model.', durationMs: Date.now() - startedAt };
  }

  const raw = await res.text();
  if (!res.ok) {
    console.error('gemini error', res.status, raw.slice(0, 600));
    if (res.status === 429) return { ok: false, error: 'The model is rate limited. Try again in a minute.' };
    return { ok: false, error: 'The model refused that request.' };
  }

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

    if (data.promptFeedback?.blockReason) {
      return { ok: false, error: 'The model would not answer that. Try rewording the goal.' };
    }

    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text.trim()) {
      console.error('empty candidate', raw.slice(0, 600));
      return { ok: false, error: 'The model came back empty.' };
    }

    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const sources = chunks
      .map((c) => ({ uri: c.web?.uri ?? '', title: c.web?.title ?? '' }))
      .filter((s) => s.uri.length > 0);

    return {
      ok: true,
      text,
      sources: call.grounded ? sources : undefined,
      modelVersion: data.modelVersion,
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
