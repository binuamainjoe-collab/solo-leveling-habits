/**
 * The planner's day clock, as numbers: the waking day wrapped once around a
 * ring and cut into its three parts, where each plan block sits on it, and
 * where each of today's quests goes — at its time when it has one, inside
 * the ring when it is an all-day thing.
 *
 * Pure (no react-native), so the placement can be checked under Node
 * (scratch/dayclock-check.ts). The component only draws what this returns.
 */

import type { CategoryId } from '@/constants/theme';
import {
  DAY_ROLLOVER_HOUR,
  DEFAULT_SLEEP,
  DEFAULT_WAKE,
  dayMinutes,
  EVENING_STARTS,
  NOON_STARTS,
  toMinutes,
  type PlanBlock,
} from '@/data/timeline';

export type Part = 'morning' | 'noon' | 'evening';

/** The waking day in day-minutes (see dayMinutes): from wake to sleep. */
export interface Span {
  start: number;
  end: number;
}

export function spanOf(wake: string = DEFAULT_WAKE, sleep: string = DEFAULT_SLEEP): Span {
  const start = toMinutes(wake);
  let end = dayMinutes(sleep, wake);
  if (end <= start) end = start + 16 * 60;
  return { start, end };
}

/** How far through the waking day a time is, 0 at waking and 1 at bedtime. */
export function fractionOf(minutes: number, span: Span): number {
  return Math.max(0, Math.min(1, (minutes - span.start) / (span.end - span.start)));
}

/** Which part of the day a day-minute falls in. Past midnight is still evening. */
export function partAt(minutes: number): Part {
  if (minutes >= 1440 || minutes >= EVENING_STARTS) return 'evening';
  if (minutes >= NOON_STARTS) return 'noon';
  return 'morning';
}

/** The three parts as they fall in this waking day; a part the day misses is left out. */
export function partsOf(span: Span): { part: Part; from: number; to: number }[] {
  const cuts: { part: Part; from: number; to: number }[] = [
    { part: 'morning', from: span.start, to: Math.min(span.end, NOON_STARTS) },
    { part: 'noon', from: Math.max(span.start, NOON_STARTS), to: Math.min(span.end, EVENING_STARTS) },
    { part: 'evening', from: Math.max(span.start, EVENING_STARTS), to: span.end },
  ];
  return cuts.filter((c) => c.to > c.from);
}

/** Minutes of a block that fall inside a part. */
export function overlap(block: PlanBlock, wake: string, from: number, to: number): number {
  const s = dayMinutes(block.start, wake);
  let e = dayMinutes(block.end, wake);
  if (e <= s) e += 1440;
  return Math.max(0, Math.min(e, to) - Math.max(s, from));
}

/* ----------------------------------------------------------------- quests */

/** As much of a quest as placing it needs. */
export interface ClockQuest {
  id: string;
  kind: string;
  category: CategoryId;
  tags?: string[];
  window?: { before?: string; after?: string };
}

/** Quests that belong to a time of day even without a plan: a morning or an evening thing. */
const USUALLY: Record<string, 'morning' | 'evening'> = {
  wake: 'morning',
  nosnooze: 'morning',
  makebed: 'morning',
  'skincare-am': 'morning',
  sunscreen: 'morning',
  sunlight: 'morning',
  coldshower: 'morning',
  supplements: 'morning',
  creatine: 'morning',
  omega3: 'morning',
  hardthing: 'morning',
  weighin: 'morning',
  'skincare-pm': 'evening',
  bedtime: 'evening',
  digitalsunset: 'evening',
  gratitude: 'evening',
  journal: 'evening',
  plantomorrow: 'evening',
  review: 'evening',
  floss: 'evening',
  foamroll: 'evening',
};

export interface Placed<Q> {
  quest: Q;
  /** Day-minutes. */
  minutes: number;
  /** Why it is there: the plan put it there, its own time window, or it is a morning/evening thing. */
  source: 'plan' | 'window' | 'usual';
}

/**
 * Put each quest on the clock. In order of trust: the plan placed it at a
 * time; its own window says when ("in bed by 23:00", "no food after 20:00");
 * it is something people do in the morning or the evening. Anything else
 * has no time and floats inside the ring.
 */
export function placeQuests<Q extends ClockQuest>(
  quests: Q[],
  blocks: PlanBlock[],
  wake: string,
  sleep: string,
): { placed: Placed<Q>[]; floating: Q[] } {
  const span = spanOf(wake, sleep);
  const clamp = (m: number) => Math.max(span.start, Math.min(span.end, m));
  // A window time before waking is a morning deadline ("up by 06:00"), not
  // the small hours of the next night — unless it really is before 04:00
  // ("in bed by 01:00").
  const windowMinutes = (hhmm: string) => {
    const raw = toMinutes(hhmm);
    return raw < toMinutes(wake) && raw >= DAY_ROLLOVER_HOUR * 60 ? raw : dayMinutes(hhmm, wake);
  };
  const placed: Placed<Q>[] = [];
  const floating: Q[] = [];
  for (const q of quests) {
    const block = blocks.find((b) => b.questId === q.id);
    if (block) {
      placed.push({ quest: q, minutes: clamp(dayMinutes(block.start, wake)), source: 'plan' });
      continue;
    }
    if (q.window?.before || q.window?.after) {
      const at = q.window.before ? windowMinutes(q.window.before) - 30 : windowMinutes(q.window.after!);
      placed.push({ quest: q, minutes: clamp(at), source: 'window' });
      continue;
    }
    const usual = USUALLY[q.id];
    if (usual === 'morning') placed.push({ quest: q, minutes: clamp(span.start + 30), source: 'usual' });
    else if (usual === 'evening') placed.push({ quest: q, minutes: clamp(Math.max(span.end - 60, EVENING_STARTS)), source: 'usual' });
    else floating.push(q);
  }
  return { placed, floating };
}

/**
 * Nudge positions (0–1 along the ring) apart so no two icons sit on top of
 * each other, keeping their order. A crowd that would run past the end is
 * pushed back from it instead.
 */
export function spread(fractions: number[], minGap: number): number[] {
  const order = fractions.map((f, i) => ({ f, i })).sort((a, b) => a.f - b.f);
  const out = order.map((o) => o.f);
  for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + minGap);
  // If the last ran past the end, walk back from it.
  if (out.length && out[out.length - 1] > 1) {
    out[out.length - 1] = 1;
    for (let k = out.length - 2; k >= 0; k--) out[k] = Math.min(out[k], out[k + 1] - minGap);
  }
  const result = new Array<number>(fractions.length);
  order.forEach((o, k) => (result[o.i] = out[k]));
  return result;
}
