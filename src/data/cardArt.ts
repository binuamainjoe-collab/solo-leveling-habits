import type { ImageSourcePropType } from 'react-native';

import type { CategoryId } from '@/constants/theme';

/**
 * Card artwork. Life Reset backs every quest card with an illustration under a
 * dark scrim, so every card here gets one too.
 *
 * `require` calls must be static for Metro to bundle them — no dynamic paths.
 */
const ART = {
  water: require('@/assets/cards/water.jpg'),
  pushup: require('@/assets/cards/pushup.jpg'),
  power: require('@/assets/cards/power.jpg'),
  statue: require('@/assets/cards/statue.jpg'),
  study: require('@/assets/cards/study.jpg'),
  read: require('@/assets/cards/read.jpg'),
  focus: require('@/assets/cards/focus.jpg'),
  resolve: require('@/assets/cards/resolve.jpg'),
  storm: require('@/assets/cards/storm.jpg'),
  burden: require('@/assets/cards/burden.jpg'),
  fire: require('@/assets/cards/fire.jpg'),
  mastery: require('@/assets/cards/mastery.jpg'),
  bonds: require('@/assets/cards/bonds.jpg'),
  dusk: require('@/assets/cards/dusk.jpg'),
  sleep: require('@/assets/cards/sleep.jpg'),
} as const;

export type ArtKey = keyof typeof ART;

/**
 * Quests whose subject has a genuine match in the art set. These beat the
 * category pool — Luffy drinking from a barrel belongs on the water quest and
 * nowhere else.
 */
const QUEST_ART: Record<string, ArtKey> = {
  water: 'water',
  pushups: 'pushup',
  situps: 'pushup',
  squats: 'power',
  pullups: 'power',
  lift: 'statue',
  study: 'study',
  read: 'read',
  deepwork: 'focus',
  code: 'focus',
  meditate: 'bonds',
  sleep: 'sleep',
  bedtime: 'sleep',
  wake: 'dusk',
  hardthing: 'burden',
  ship: 'fire',
  write: 'fire',
  nosmoking: 'resolve',
  noalcohol: 'resolve',
  noporn: 'storm',
  nocomplain: 'storm',
  keepword: 'resolve',
  sport: 'mastery',
  callfamily: 'bonds',
  outing: 'bonds',
};

/**
 * Fallback pools. A quest with no specific match draws from its category,
 * indexed by a hash of its id so neighbouring cards in a list differ.
 */
const CATEGORY_ART: Record<CategoryId, ArtKey[]> = {
  body: ['power', 'statue', 'pushup', 'mastery'],
  nutrition: ['water', 'mastery', 'dusk'],
  mind: ['study', 'read', 'focus'],
  craft: ['fire', 'focus', 'mastery'],
  discipline: ['resolve', 'storm', 'burden', 'statue'],
  care: ['dusk', 'sleep', 'bonds'],
  social: ['bonds', 'dusk', 'mastery'],
  wealth: ['fire', 'statue', 'burden'],
};

/** Tiny deterministic hash, so a quest always draws the same image. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

export function artFor(questId: string, category: CategoryId): ImageSourcePropType {
  const key = QUEST_ART[questId];
  if (key) return ART[key];
  const pool = CATEGORY_ART[category];
  return ART[pool[hash(questId) % pool.length]];
}

export function artByKey(key: ArtKey): ImageSourcePropType {
  return ART[key];
}
