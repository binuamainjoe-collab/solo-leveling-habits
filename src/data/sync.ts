import type { CategoryId } from '@/constants/theme';
import type { DayRecord, ProgressState } from '@/store/progress';

/**
 * Merging two copies of one account's progress.
 *
 * Signing in on the phone and on the web means the same account can be edited
 * in two places, and either place can be offline when it happens. Rather than
 * let the last device to close its laptop flatten the other one, every sync
 * runs both copies through `mergeProgress` and keeps the union of what was
 * actually achieved.
 *
 * This module is deliberately free of React, storage and network code: it is
 * pure data in, pure data out, so the rules below can be run under plain Node.
 * The types it imports are type-only, so nothing from the store is pulled in
 * at runtime.
 *
 * The caller must run the store's own `recompute` on the result. Everything
 * derived — streak, bestStreak, perfectDays, categoryDays — is deliberately
 * NOT merged here, because deriving it from the merged day log is always right
 * and merging it field-by-field never is.
 */

export interface Snapshot {
  /** ISO timestamp of the write that produced this state. */
  updatedAt: string;
  state: ProgressState;
}

/** Fields `recompute` owns. Merging them would only fight it. */
export const DERIVED_FIELDS = [
  'streak',
  'bestStreak',
  'perfectDays',
  'categoryDays',
] as const;

/** Fields that exist only to drive an animation and are never persisted. */
export const EPHEMERAL_FIELDS = ['cardQueue', 'unlockQueue'] as const;

function newer(a: Snapshot, b: Snapshot): Snapshot {
  // Equal timestamps resolve to `a`, so the caller decides precedence by
  // argument order rather than on a coin toss.
  return Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a;
}

/** Union of two id lists, order preserved, first appearance winning. */
function unionList(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...a, ...b]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Per-key maximum over two numeric maps. */
function maxByKey(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = Math.max(out[k] ?? 0, v);
  }
  return out;
}

/**
 * Which of two records for the same day to keep.
 *
 * Taking the richer record wholesale rather than merging the two `values` maps
 * is deliberate: a day record is a statement about how a day actually went,
 * and splicing two of them together would invent a day that never happened —
 * one where you cleared more than you did on either device.
 */
function richerDay(a: DayRecord, b: DayRecord): DayRecord {
  if (b.cleared !== a.cleared) return b.cleared > a.cleared ? b : a;
  const aCount = Object.keys(a.values).length;
  const bCount = Object.keys(b.values).length;
  if (bCount !== aCount) return bCount > aCount ? b : a;
  return b.total > a.total ? b : a;
}

function mergeDays(
  a: Record<string, DayRecord>,
  b: Record<string, DayRecord>,
): Record<string, DayRecord> {
  const out: Record<string, DayRecord> = { ...a };
  for (const [date, rec] of Object.entries(b)) {
    const mine = out[date];
    out[date] = mine ? richerDay(mine, rec) : rec;
  }
  return out;
}

/**
 * Merge two snapshots of the same account.
 *
 * Order matters only for genuine ties: where the rule is "the newer wins" and
 * both carry the same timestamp, `a` is kept.
 */
export function mergeProgress(a: Snapshot, b: Snapshot): ProgressState {
  const lead = newer(a, b).state;
  const sa = a.state;
  const sb = b.state;

  // Today's live counts. Per-quest max, which can resurrect a quest the other
  // device un-marked — accepted knowingly: for a student with ADHD, silently
  // losing work they did record is worse than an extra tick they can clear
  // again in one press.
  const sameDay = sa.date === sb.date;
  const values = sameDay ? maxByKey(sa.values, sb.values) : lead.values;

  return {
    ...lead,

    // Settings, profile and the board are statements of current intent, so the
    // most recent device wins outright. Merging a board would resurrect quests
    // the student had just taken off it.
    profile: lead.profile,
    settings: lead.settings,
    activeQuestIds: lead.activeQuestIds,
    date: lead.date,
    values,

    // The permanent record. This is the one thing that must never lose data,
    // and everything the trophies and the calendar read comes back out of it.
    days: mergeDays(sa.days, sb.days),

    // Lifetime per-quest counts only ever rise.
    totals: maxByKey(sa.totals, sb.totals),

    // Earned things are never un-earned, so a union is always correct.
    unlocked: unionList(sa.unlocked, sb.unlocked),
    cards: unionList(sa.cards, sb.cards),

    // Tasks are keyed by a unique id and never deleted, so a plain union is
    // safe and keeps an archived day's references readable.
    planned: { ...sa.planned, ...sb.planned },

    // One plan per date. The later acceptance is the one the student meant.
    plans: mergePlans(sa.plans, sb.plans),

    // Counters that only rise. Max rather than sum: summing would re-add the
    // history the two copies share and inflate on every single sync. The cost
    // is losing the delta earned on the staler device, which only happens if
    // both were edited while offline — and the trophies that matter read the
    // day log above, which does merge properly.
    plansAccepted: Math.max(sa.plansAccepted, sb.plansAccepted),
    questCompletions: Math.max(sa.questCompletions, sb.questCompletions),
    xp: Math.max(sa.xp, sb.xp),

    // Ability scores rise with completions, so the same reasoning applies.
    stats: maxByKey(sa.stats, sb.stats) as ProgressState['stats'],

    // Waving the briefing away is a statement about tonight; newest wins.
    briefingDismissed: lead.briefingDismissed,

    // Reveal queues belong to whichever device earned them and must not be
    // replayed on the other one.
    cardQueue: [],
    unlockQueue: [],

    // Left stale on purpose — the caller runs `recompute`, which derives all
    // four from the merged day log above.
    streak: lead.streak,
    bestStreak: Math.max(sa.bestStreak, sb.bestStreak),
    perfectDays: lead.perfectDays,
    categoryDays: lead.categoryDays as Record<CategoryId, number>,
  };
}

function mergePlans(
  a: ProgressState['plans'],
  b: ProgressState['plans'],
): ProgressState['plans'] {
  const out = { ...a };
  for (const [date, plan] of Object.entries(b)) {
    const mine = out[date];
    if (!mine || Date.parse(plan.acceptedAt) > Date.parse(mine.acceptedAt)) {
      out[date] = plan;
    }
  }
  return out;
}

/**
 * What actually travels to the server.
 *
 * The reveal queues are dropped: they are instructions to play an animation,
 * not facts about the account, and shipping them would make the other device
 * replay a card it never earned.
 */
export function toWire(state: ProgressState): ProgressState {
  const copy = { ...state, cardQueue: [], unlockQueue: [] };
  return copy;
}
