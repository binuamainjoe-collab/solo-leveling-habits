import { RANKS, type Rank } from '@/constants/theme';

/**
 * The big moments: a level, a rank and a perfect day, each celebrated once,
 * the first time it is reached. No React Native here, so it runs under plain
 * Node (see scratch/moments-check.ts).
 */

/** The highest of each that has already been celebrated on this device. */
export interface Marks {
  level: number;
  rank: Rank;
  perfect: number;
}

export type Moment =
  | { kind: 'rank'; from: Rank; to: Rank; level: number }
  | { kind: 'level'; from: number; to: number }
  | { kind: 'star'; count: number };

const rankAt = (r: Rank) => RANKS.indexOf(r);

/**
 * What going from `seen` to `now` earns, in the order it plays. A new rank
 * always comes with a new level, so it takes the level's place rather than
 * playing twice. A perfect day follows, because the ending is what is
 * remembered, and a day ending on the whole board done is the better ending.
 */
export function momentsBetween(seen: Marks, now: Marks): Moment[] {
  const out: Moment[] = [];
  if (rankAt(now.rank) > rankAt(seen.rank)) out.push({ kind: 'rank', from: seen.rank, to: now.rank, level: now.level });
  else if (now.level > seen.level) out.push({ kind: 'level', from: seen.level, to: now.level });
  if (now.perfect > seen.perfect) out.push({ kind: 'star', count: now.perfect });
  return out;
}

/**
 * The new high marks. They never go down, so taking a quest back and doing it
 * again never plays the same ceremony twice.
 */
export function highest(seen: Marks, now: Marks): Marks {
  return {
    level: Math.max(seen.level, now.level),
    rank: rankAt(now.rank) > rankAt(seen.rank) ? now.rank : seen.rank,
    perfect: Math.max(seen.perfect, now.perfect),
  };
}

export function sameMarks(a: Marks, b: Marks): boolean {
  return a.level === b.level && a.rank === b.rank && a.perfect === b.perfect;
}

/** How many stars the sky can hold; past this, the oldest ones make way. */
export const SKY_STARS = 40;

/**
 * Where perfect day `n` (from 0) hangs in the sky: 0–1 across, high up the
 * screen, with a size. Placed by a fixed scatter so a star never moves once it
 * is there, and spread so they don't clump.
 */
export function starAt(n: number): { x: number; y: number; size: number } {
  const golden = 0.6180339887;
  const x = 0.06 + ((n * golden + 0.17) % 1) * 0.88;
  const jitter = Math.sin(n * 91.7) * 43758.5453;
  const y = 0.88 + (jitter - Math.floor(jitter)) * 0.1;
  return { x, y, size: 0.6 + ((n * 7) % 5) * 0.12 };
}

/** The stars to draw for this many perfect days, newest last. */
export function skyFor(perfect: number): { x: number; y: number; size: number }[] {
  const from = Math.max(0, perfect - SKY_STARS);
  return Array.from({ length: perfect - from }, (_, i) => starAt(from + i));
}
