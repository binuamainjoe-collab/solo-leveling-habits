/**
 * The rules behind Beerus's body: when he is proud or angry, where his embers
 * sit, how loud a voice is, and when he dozes off. No React Native here, so
 * it runs under plain Node (see scratch/beerus-check.ts).
 */

export type Mood = 'calm' | 'proud' | 'angry';

/** How long he stays proud after a quest lands in the ring. */
export const PROUD_MS = 2600;
/** From this hour, mandatory quests still open make him angry. */
export const ANGRY_FROM = 20;
/** How long without a touch before he falls asleep. */
export const SLEEP_AFTER_MS = 45_000;

/**
 * His colour only changes for these two, and only with a reason you can see:
 * proud just after a quest lands, or with the whole board cleared; angry late
 * in the day while mandatory quests are still open. Proud wins, so clearing
 * one late is never met with a scowl.
 */
export function moodFor(input: {
  hour: number;
  mandatoryLeft: number;
  boardLeft: number;
  boardTotal: number;
  /** Milliseconds since a quest last landed in the ring, or null for never. */
  sinceLanding: number | null;
}): Mood {
  const { hour, mandatoryLeft, boardLeft, boardTotal, sinceLanding } = input;
  if (sinceLanding !== null && sinceLanding < PROUD_MS) return 'proud';
  if (boardTotal > 0 && boardLeft === 0) return 'proud';
  if (mandatoryLeft > 0 && (hour >= ANGRY_FROM || hour < 4)) return 'angry';
  return 'calm';
}

/** The colour a mood tints his embers, or null for his own ember. */
export function moodColour(mood: Mood): readonly [number, number, number] | null {
  if (mood === 'proud') return [0.95, 0.71, 0.29];
  if (mood === 'angry') return [0.95, 0.22, 0.12];
  return null;
}

/** A small seeded random source, so his embers sit in the same places every time. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where his embers sit: `count` points spread evenly over a sphere by a
 * golden-angle spiral, each nudged in or out a little so the shell reads as
 * fire and not a grid, plus a few sparks that rise off his crown. Four numbers
 * each: x, y, z on the unit sphere, then a random 0–1, or 1 + random for a spark.
 */
export function emberLayout(count: number, sparks: number, seed = 7): Float32Array {
  const rand = seeded(seed);
  const out = new Float32Array((count + sparks) * 4);
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const ring = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    const drift = 1 + (rand() - 0.5) * 0.09;
    out.set([Math.cos(a) * ring * drift, y * drift, Math.sin(a) * ring * drift, rand()], i * 4);
  }
  for (let j = 0; j < sparks; j++) {
    const k = (count + j) * 4;
    out.set([(rand() - 0.5) * 1.6, 0, rand() * 0.5 + 0.5, 1 + rand()], k);
  }
  return out;
}

/**
 * How loud a stretch of audio is, 0 to 1. Speech sits around 0.02 to 0.2 in
 * raw terms, so it is lifted on a soft curve: a murmur moves him a little, a
 * shout a lot, and silence leaves him still.
 */
export function voiceLevel(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  const gate = Math.max(0, rms - 0.008);
  return Math.min(1, 1 - Math.exp(-gate * 14));
}

/** 0 awake to 1 fully asleep: he drifts off over a few seconds once ignored. */
export function sleepiness(idleMs: number, awake: boolean): number {
  if (awake) return 0;
  const over = idleMs - SLEEP_AFTER_MS;
  if (over <= 0) return 0;
  return Math.min(1, over / 2500);
}
