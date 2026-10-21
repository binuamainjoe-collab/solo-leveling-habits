/**
 * Which Gemini model each job runs on.
 *
 * Three tiers:
 *   deep  — Gemini's flagship reasoning model. The typed assistant, the
 *           planner, Beru, Igris and the Steward: the work where the
 *           quality of the thinking is the product.
 *   voice — spoken messages. Also the flagship by default, but with a
 *           shorter wait (DEEP_TIMEOUT_MS.voice) before Flash answers, because
 *           a spoken reply that takes twenty seconds stops feeling like
 *           talking. GEMINI_MODEL_VOICE moves voice alone to another model.
 *   fast  — Flash. The safety net behind every other tier.
 *
 * A call that fails for a reason Flash might not share (the model is
 * missing or not allowed for this key, a quota, an outage, a timeout, or a
 * 200 whose content cannot be used) is retried once on Flash, so the System
 * never goes quiet because of the model choice. Only a failure that says
 * the model itself is slow or unavailable (`worthBenching`) then skips it
 * for ten minutes, so a slow or missing flagship costs one wait, not a wait
 * on every message — while one odd request never takes it away from the
 * messages after it. Each tier can be changed with a Supabase
 * secret — GEMINI_MODEL_DEEP / GEMINI_MODEL_VOICE / GEMINI_MODEL_FAST —
 * without a code change; setting GEMINI_MODEL_DEEP to the Flash id puts
 * everything back on Flash.
 *
 * Pure apart from the in-memory bench: no Deno, no fetch.
 * `npx tsx scratch/design-check.ts` tests it.
 */

export type Tier = 'deep' | 'voice' | 'fast';

/**
 * Ids and status from ai.google.dev/gemini-api/docs/models (checked
 * 20 Oct 2026): gemini-4-argon is listed as "New Stable", the flagship
 * reasoning model; gemini-3.8-flash as "New Stable", the newest Flash.
 * Which of these the owner's key may call is checked once with the
 * models.list command in the deploy notes.
 */
export const DEFAULT_MODELS: Record<Tier, string> = {
  deep: 'gemini-4-argon',
  voice: 'gemini-4-argon',
  fast: 'gemini-3.8-flash',
};

const SECRET: Record<Tier, string> = {
  deep: 'GEMINI_MODEL_DEEP',
  voice: 'GEMINI_MODEL_VOICE',
  fast: 'GEMINI_MODEL_FAST',
};

/** A model id is lowercase letters, digits, dots and dashes — nothing that could bend the URL. */
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{2,63}$/;

/**
 * The models to try for a tier, in order. Every tier ends on fast, and a
 * model that is benched (see below) is skipped while its bench lasts. The
 * last model is never skipped: something always gets asked.
 */
export function modelsFor(
  tier: Tier,
  env: (name: string) => string | undefined,
  now: number = Date.now(),
): string[] {
  const pick = (t: Tier): string => {
    const set = (env(SECRET[t]) ?? '').trim();
    return MODEL_ID.test(set) ? set : DEFAULT_MODELS[t];
  };
  const fast = pick('fast');
  const first = tier === 'fast' ? fast : pick(tier);
  if (first === fast) return [fast];
  return isBenched(first, now) ? [fast] : [first, fast];
}

/* ------------------------------------------------------------------ bench */

/** How long a model that timed out or was refused is skipped. */
export const BENCH_MS = 10 * 60_000;

/**
 * Models that recently failed, with the time their bench ends. It lives in
 * the edge function's memory, so it lasts as long as the warm instance does
 * (usually minutes): enough to stop a slow flagship from adding its whole
 * timeout to every message in a row, without any table or secret.
 */
const benched = new Map<string, number>();

/** Skip `model` for BENCH_MS, after a failure `worthBenching` says is about the model. */
export function benchModel(model: string, now: number = Date.now()): void {
  benched.set(model, now + BENCH_MS);
}

export function isBenched(model: string, now: number = Date.now()): boolean {
  const until = benched.get(model);
  if (until === undefined) return false;
  if (until <= now) {
    benched.delete(model);
    return false;
  }
  return true;
}

export function geminiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/**
 * How one attempt ended, when it did not give a usable answer.
 * 'unusable' is an HTTP 200 whose content could not be used: a blocked
 * prompt, an empty candidate (a reasoning model that ran out of tokens, a
 * safety stop), an unreadable envelope, or JSON the caller cannot read.
 */
export type Failure = number | 'network' | 'timeout' | 'unusable';

/**
 * Whether a failed call is worth one more try on the next model.
 *
 * 401 is the one that is not: a bad key fails on every model alike.
 * 400 is retried because "this model does not support that" comes back as
 * a 400, and one quick extra call is cheaper than a silent System. An
 * unusable 200 is retried because another model may well answer it. Every
 * fallback is logged with the reason, claimed against the caller's daily
 * cap like any other model call, and recorded: a run's agent_runs.model
 * names every model it asked (runModel below).
 */
export function worthFallingBack(status: Failure): boolean {
  if (status === 'network' || status === 'timeout' || status === 'unusable') return true;
  return status === 400 || status === 403 || status === 404 || status === 429 || status >= 500;
}

/**
 * Whether a failure says the model itself is slow or unavailable, so the
 * next messages should skip it for a while. A timeout, a dropped
 * connection, an outage (5xx) or "not allowed / no such model" (403/404)
 * would repeat on the next message. A 400, a 429 or an unusable 200 is
 * about this one request or this one minute: it falls back for this
 * message only, and the next message tries the flagship again.
 */
export function worthBenching(status: Failure): boolean {
  if (status === 'network' || status === 'timeout') return true;
  if (typeof status !== 'number') return false;
  return status === 403 || status === 404 || status >= 500;
}

/**
 * How long a deep call may take before Flash is asked instead.
 */
export const DEEP_TIMEOUT_MS = {
  /** Someone is waiting on a typed reply. */
  chat: 18_000,
  /** Someone is waiting on a spoken reply, which has to feel quicker. */
  voice: 12_000,
  /**
   * The shadows and the Steward. Nobody is typing, but they can be
   * summoned from the Goal tab, so someone may still be watching a spinner.
   */
  background: 25_000,
} as const;

/** The app abandons an assistant or planner request after this long (src/lib/assistant.ts, src/data/planner.ts). */
export const APP_TIMEOUT_MS = 45_000;

/**
 * Everything a chat request may spend on the model, every attempt together,
 * counted from the moment the request arrived. What is left of the app's
 * 45 s covers the function's own reads and writes, so the reply always
 * arrives while the app is still listening.
 */
export const CHAT_BUDGET_MS = 36_000;

/**
 * Everything one unattended call (a shadow or the Steward) may spend on the
 * model, every attempt together. Beru and the Steward make up to two calls
 * per run, so a run spends at most 110 s on the model and keeps 40 s of the
 * edge function's 150 s limit for its reads, writes and email, however
 * slow the flagship is. Flash behind a timed-out flagship still gets 30 s.
 */
export const BACKGROUND_BUDGET_MS = 55_000;

/** Supabase stops an edge function after this long. */
export const EDGE_LIMIT_MS = 150_000;

/**
 * The time limit for one attempt.
 *
 * Every call has a budget (CHAT_BUDGET_MS when someone is waiting on a
 * reply, BACKGROUND_BUDGET_MS otherwise). A deep attempt gets at most
 * `deepMs`; no attempt, the Flash fallback included, may run past what is
 * left of the budget.
 */
export function attemptTimeout(last: boolean, deepMs: number, remainingMs: number): number {
  const left = Math.max(1_000, Math.floor(remainingMs));
  return last ? left : Math.min(deepMs, left);
}

/* ------------------------------------------------------- what a call cost */

export interface Usage {
  in: number;
  out: number;
  thoughts: number;
}

/** One request to one model, as the run log needs it. */
export interface Attempt {
  /** The model asked, or the version Gemini says answered. */
  model: string;
  status: Failure | 'answered';
  /** What Gemini reported. Missing when the request was cut off. */
  usage?: Usage;
}

/**
 * The `agent_runs.model` value for a call.
 *
 * One attempt: that model's id, as before. A fallback: every attempt in
 * order, each failed one with how it failed, so the log shows that the
 * flagship was asked (and billed) before Flash answered:
 * "gemini-4-argon:timeout>gemini-3.8-flash". The Steward prices such a run
 * at the dearest model in it (ratesFor in steward.ts).
 */
export function runModel(attempts: Attempt[]): string | undefined {
  if (attempts.length === 0) return undefined;
  if (attempts.length === 1) return attempts[0].model;
  return attempts.map((a) => (a.status === 'answered' ? a.model : `${a.model}:${a.status}`)).join('>');
}

/** Two calls' model values as one, for a run that makes two calls (Beru, the Steward's retry). */
export function joinModels(a?: string | null, b?: string | null): string | undefined {
  if (!a) return b ?? undefined;
  if (!b || a === b) return a;
  return `${a}>${b}`;
}

/**
 * The tokens a call is billed for: every attempt, not only the one that
 * answered. A blocked or empty 200 still reports its tokens, and they
 * count. An attempt cut off by a timeout or a dropped connection reports
 * nothing; it was sent the same prompt as the attempt after it, so that
 * attempt's input count stands in for its input. What it generated before
 * it was cut off is never reported to us, so its output counts as none.
 */
export function billedUsage(attempts: Attempt[]): Usage {
  const total: Usage = { in: 0, out: 0, thoughts: 0 };
  attempts.forEach((a, i) => {
    const u = a.usage ?? (a.status === 'timeout' || a.status === 'network' ? inputOf(attempts.slice(i + 1)) : undefined);
    if (!u) return;
    total.in += u.in;
    total.out += u.out;
    total.thoughts += u.thoughts;
  });
  return total;
}

function inputOf(later: Attempt[]): Usage | undefined {
  const seen = later.find((a) => a.usage && a.usage.in > 0);
  return seen?.usage ? { in: seen.usage.in, out: 0, thoughts: 0 } : undefined;
}
