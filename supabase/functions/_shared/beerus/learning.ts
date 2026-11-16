/**
 * Beerus's learning loop — when to go over the conversation, and what each
 * turn leaves behind for tuning.
 *
 * After OpenJarvis's Learning & Traces: every interaction is recorded as a
 * trace, and the system improves from its own trace history.
 *
 * Two parts:
 *   1. When to learn. The learning pass (assistant op `learn`) used to run
 *      only when the app asked for it — after a live call, or when the chat
 *      window closed. Until 2026-11-15 it had never run once, so Beerus
 *      remembered 4 things from 47 messages. Now the server also starts it
 *      itself, in the background after a reply, when enough has been said
 *      since the last pass.
 *   2. The trace. One row per reply in `beerus_traces`: the route, how much
 *      went into the prompt, how long it took, what it cost, and what came
 *      out. This is what the router's thresholds get tuned from, and where a
 *      rating would go if the app ever asks for one.
 *
 * Pure: no Deno, no network. Checked by scratch/beerus-framework-check.ts.
 */

import type { Route, RoutingContext } from './router.ts';

/** This many of the Player's messages since the last pass start a new one. */
export const LEARN_AFTER_MESSAGES = 6;
/** Fewer than that still start one when the last pass is this old. */
export const LEARN_AFTER_MS = 6 * 60 * 60 * 1000;
/** …once at least this many messages are waiting. */
export const LEARN_AFTER_STALE_MIN = 2;

export function shouldLearn(state: { unlearnedUserMessages: number; learnedUntil: string | null; now?: number }): boolean {
  const { unlearnedUserMessages: n } = state;
  if (n <= 0) return false;
  if (n >= LEARN_AFTER_MESSAGES) return true;
  // Never learned at all: anything the Player said is worth a first pass.
  if (!state.learnedUntil) return true;
  const last = Date.parse(state.learnedUntil);
  if (Number.isNaN(last)) return true;
  // An old bookmark waits for a second message, so the day's first "morning"
  // doesn't cost a pass of its own.
  return n >= LEARN_AFTER_STALE_MIN && (state.now ?? Date.now()) - last >= LEARN_AFTER_MS;
}

export interface Trace {
  depth: Route['depth'];
  thinking: Route['thinking'];
  reason: string;
  mode: RoutingContext['mode'];
  spoken: boolean;
  message_chars: number;
  history_turns: number;
  memories_sent: number;
  memories_total: number;
  prompt_chars: number;
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_thoughts: number | null;
  model: string | null;
  outcome: 'ok' | 'error' | 'too_slow' | 'not_heard';
  changes: number;
  remembered: number;
  /** A learning pass ran after this reply (not skipped, not refused, not failed). */
  learn_started: boolean;
  /** Contract rules the reply broke (checkReply in contract.ts). */
  violations: string[];
  /** Changes held back from the app (checkReply's `dropped`). */
  changes_dropped: number;
  /** Whether the quest catalogue went into the prompt. */
  catalog_sent: boolean;
  /** Oldest turns dropped to fit the route's budget. */
  history_trimmed: number;
  /** The prompt was still over budget after trimming (sent whole). */
  over_budget: boolean;
}

/**
 * The trace row for one reply. Holds no message text and no memory text —
 * only sizes, the route and the outcome — so the table never becomes a
 * second copy of the conversation.
 */
export function buildTrace(input: {
  ctx: RoutingContext;
  route: Route;
  historyTurns: number;
  memoriesSent: number;
  memoriesTotal: number;
  promptChars: number;
  durationMs?: number | null;
  usage?: { in?: number; out?: number; thoughts?: number } | null;
  model?: string | null;
  outcome: Trace['outcome'];
  changes?: number;
  remembered?: number;
  learnStarted?: boolean;
  violations?: string[];
  changesDropped?: number;
  catalogSent?: boolean;
  historyTrimmed?: number;
  overBudget?: boolean;
}): Trace {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  return {
    depth: input.route.depth,
    thinking: input.route.thinking,
    reason: input.route.reason.slice(0, 40),
    mode: input.ctx.mode,
    spoken: input.ctx.spoken,
    message_chars: input.ctx.length,
    history_turns: input.historyTurns,
    memories_sent: input.memoriesSent,
    memories_total: input.memoriesTotal,
    prompt_chars: input.promptChars,
    duration_ms: n(input.durationMs),
    tokens_in: n(input.usage?.in),
    tokens_out: n(input.usage?.out),
    tokens_thoughts: n(input.usage?.thoughts),
    model: input.model ? input.model.slice(0, 120) : null,
    outcome: input.outcome,
    changes: input.changes ?? 0,
    remembered: input.remembered ?? 0,
    learn_started: Boolean(input.learnStarted),
    violations: (input.violations ?? []).slice(0, 20).map((s) => String(s).slice(0, 40)),
    changes_dropped: input.changesDropped ?? 0,
    catalog_sent: Boolean(input.catalogSent),
    history_trimmed: input.historyTrimmed ?? 0,
    over_budget: Boolean(input.overBudget),
  };
}
