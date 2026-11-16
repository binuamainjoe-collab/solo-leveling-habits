/**
 * Beerus's router — how much each message needs, decided before the model
 * is asked.
 *
 * After OpenJarvis's QueryAnalyzer and RouterPolicy: read the message
 * cheaply in code, then pick how the call is made. Unlike OpenJarvis, the
 * model is never switched — Beerus runs on the model the Player picked and
 * only on it (modelsForRole in models.ts). What the route picks is how much
 * goes into the prompt and how hard the model thinks, because those are
 * what make a reply slow:
 *
 *   lean — small talk and acknowledgements ("ok", "thanks", "morning").
 *          A short slice of the conversation and only the most relevant
 *          memories. Nothing is cut that a change needs: today's board and
 *          the catalogue (with their ids) are always sent.
 *   full — anything that asks, plans, changes or reports, every spoken
 *          message and the interview. The whole recent conversation and
 *          every memory, exactly as before the router existed.
 *   deep — a quest proposal: everything, like full, kept apart in the
 *          traces so its thinking level can be tuned on its own.
 *
 * Every route also says whether the quest catalogue goes in (everything
 * but plain small talk) and the most characters the prompt may have;
 * fitHistory holds it to that.
 *
 * Pure: no Deno, no network. Checked by scratch/beerus-framework-check.ts.
 */

export type Depth = 'lean' | 'full' | 'deep';
export type Thinking = 'low' | 'medium';

export interface RoutingContext {
  /** Characters in the typed message (0 for a spoken one). */
  length: number;
  words: number;
  spoken: boolean;
  mode: 'chat' | 'interview' | 'board';
  /** A greeting, a thanks, an "ok" — nothing to act on. */
  smallTalk: boolean;
  /** Asks for a change to the app, or reports something done. */
  wantsChange: boolean;
  /** Asks about the day, a plan or the schedule. */
  wantsPlan: boolean;
  /** Asks what Beerus knows or remembers about the Player. */
  aboutSelf: boolean;
  /** Agrees to something proposed. */
  confirm: boolean;
  /** Talks about which quests exist or could be added. */
  questTalk: boolean;
  question: boolean;
}

export interface Route {
  depth: Depth;
  thinking: Thinking;
  /** Conversation turns sent with the message. */
  historyTurns: number;
  /** Memories sent with the message, the most relevant first. */
  memoryTopK: number;
  /** Whether the quest catalogue (ids of quests not on the board) goes in. */
  catalog: boolean;
  /** The most characters the prompt may have; see fitHistory. */
  budgetChars: number;
  /** Why, in a few words, for the trace. */
  reason: string;
}

const SMALL_TALK =
  /^(hi|hey|hello|yo|sup|morning|good (morning|night|evening|afternoon)|gn|thanks?|thank you|thx|ty|ok(ay)?|k|cool|nice|great|lol|haha|yes|yeah|yep|no|nope|sure|alright|bye|see you|cya)\b[\s!.?,]*$/i;

const CHANGE =
  /\b(add|remove|delete|drop|change|set|make it|move|log|did|done|finished|completed|ran|walked|read|studied|lifted|push-?ups?|reset|focus|goal|target|wake|bedtime|sleep at|quest)\b|\d/i;

const PLAN = /\b(plan|today|tomorrow|tonight|schedule|timeline|next|what (should|do) i|when|block|morning|evening|week)\b/i;

const ABOUT_SELF = /\b(remember|recall|know about me|what do you know|my (exam|deadline|class|job|routine|file|notes?|profile))\b/i;

/**
 * A yes to something Beerus proposed ("ok", "do it", "sure"). It may be
 * agreeing to add a catalogue quest he suggested a turn ago, so it keeps
 * the catalogue even though it is small talk.
 */
const CONFIRM = /^(ok(ay)?|k|yes|yeah|yep|yup|sure|alright|do it|go ahead|please|sounds good|let'?s do it|fine)\b/i;

/** Anything about which quests exist or could be added. */
const QUEST_TALK = /\b(add|new|quests?|habits?|catalog(ue)?|suggest|another|swap|replace|more)\b/i;

export function analyze(message: string, opts: { mode?: string; spoken?: boolean } = {}): RoutingContext {
  const text = (message ?? '').trim();
  const mode = opts.mode === 'interview' || opts.mode === 'board' ? opts.mode : 'chat';
  const spoken = Boolean(opts.spoken);
  const words = text ? text.split(/\s+/).length : 0;
  return {
    length: text.length,
    words,
    spoken,
    mode,
    smallTalk: !spoken && words > 0 && words <= 4 && SMALL_TALK.test(text),
    wantsChange: CHANGE.test(text),
    wantsPlan: PLAN.test(text),
    aboutSelf: ABOUT_SELF.test(text),
    confirm: CONFIRM.test(text),
    questTalk: QUEST_TALK.test(text),
    question: /\?\s*$/.test(text) || /^(what|when|where|why|how|who|which|can|could|should|do|does|is|are)\b/i.test(text),
  };
}

/** The most turns any route sends — what the assistant always sent before. */
export const FULL_HISTORY = 20;
export const LEAN_HISTORY = 6;
/** The same as MAX_MEMORIES_IN in system.ts: a full reply sees every memory it ever did. */
export const FULL_MEMORIES = 80;
export const LEAN_MEMORIES = 12;

/**
 * The most characters a prompt may have, per depth. The full prompt was
 * about 19k characters on 2026-11-11 (4.9k tokens on Argon) with the whole
 * catalogue in it; these leave room for a full profile and 24k of file
 * notes, and stop anything from growing without bound.
 */
export const BUDGET_CHARS: Record<Depth, number> = { lean: 30_000, full: 60_000, deep: 70_000 };
/** History is the first thing trimmed to fit, but never below this many turns. */
export const MIN_HISTORY = 4;

export function route(ctx: RoutingContext): Route {
  const make = (depth: Depth, historyTurns: number, memoryTopK: number, catalog: boolean, reason: string): Route => ({
    depth,
    thinking: 'low',
    historyTurns,
    memoryTopK,
    catalog,
    budgetChars: BUDGET_CHARS[depth],
    reason,
  });
  // A quest proposal needs the catalogue. Low thinking for now, as before:
  // it shares the 36 s chat budget. Try 'medium' once the board rows in
  // beerus_traces (duration_ms, outcome 'too_slow') show the headroom.
  if (ctx.mode === 'board') return make('deep', FULL_HISTORY, FULL_MEMORIES, true, 'quest proposal');
  // The whole recent conversation, so a question asked a while ago is not
  // asked again, and the catalogue in case an answer asks for a quest.
  if (ctx.mode === 'interview') return make('full', FULL_HISTORY, FULL_MEMORIES, true, 'interview');
  // A spoken message can't be read before the model hears it: give it the
  // full picture, catalogue included, rather than guess.
  if (ctx.spoken) return make('full', FULL_HISTORY, FULL_MEMORIES, true, 'spoken');
  if (ctx.smallTalk && !ctx.wantsChange) {
    return make('lean', LEAN_HISTORY, LEAN_MEMORIES, ctx.confirm, ctx.confirm ? 'confirmation' : 'small talk');
  }
  // Every full reply gets the catalogue. Guessing from the words when a
  // quest might be added ("sounds good", "put journaling on", "the
  // meditation one") misses too often, and the catalogue is only ~3k
  // characters; small talk is where leaving it out is safe.
  const reason = ctx.wantsChange ? 'change or report' : ctx.wantsPlan ? 'plan' : ctx.aboutSelf ? 'about the Player' : 'chat';
  return make('full', FULL_HISTORY, FULL_MEMORIES, true, reason);
}

/**
 * Fit the conversation into the route's budget: drop the oldest turns
 * until the prompt fits, keeping at least MIN_HISTORY. Nothing else is ever
 * cut — the rules, today's board, the quest ids and the message always go
 * in — so a prompt that still doesn't fit goes out whole and is flagged
 * `over` for the trace.
 */
export function fitHistory<T extends { text: string }>(
  fixedChars: number,
  history: T[],
  budgetChars: number,
): { kept: T[]; trimmed: number; over: boolean } {
  // Each turn costs its text plus "Player: " / "System: " and a newline.
  const cost = (t: T) => t.text.length + 10;
  let kept = history.slice();
  let total = fixedChars + kept.reduce((s, t) => s + cost(t), 0);
  while (total > budgetChars && kept.length > MIN_HISTORY) {
    total -= cost(kept[0]);
    kept = kept.slice(1);
  }
  return { kept, trimmed: history.length - kept.length, over: total > budgetChars };
}
