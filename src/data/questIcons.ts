/**
 * Which line icon each quest wears on the planner's day clock.
 *
 * Read from the quest's id first (for the few a tag would get wrong — steps
 * are a walk, not a run), then its tags, then its discipline. Pure, so every
 * quest in the catalogue can be checked under Node (scratch/dayclock-check.ts).
 */

import type { CategoryId } from '@/constants/theme';

export type QuestIconKey =
  | 'water'
  | 'strength'
  | 'run'
  | 'walk'
  | 'stretch'
  | 'sleep'
  | 'sun'
  | 'alarm'
  | 'cold'
  | 'posture'
  | 'scale'
  | 'food'
  | 'coffee'
  | 'pill'
  | 'restrain'
  | 'phoneOff'
  | 'game'
  | 'book'
  | 'read'
  | 'listen'
  | 'mind'
  | 'write'
  | 'language'
  | 'focus'
  | 'code'
  | 'ship'
  | 'music'
  | 'art'
  | 'inbox'
  | 'target'
  | 'career'
  | 'shield'
  | 'care'
  | 'shower'
  | 'groom'
  | 'home'
  | 'shirt'
  | 'call'
  | 'message'
  | 'people'
  | 'money'
  | 'plan'
  | 'task';

const BY_ID: Record<string, QuestIconKey> = {
  steps: 'walk',
  walkmeals: 'walk',
  sport: 'run',
  weighin: 'scale',
  restday: 'sleep',
  bedtime: 'sleep',
  wake: 'alarm',
  nosnooze: 'alarm',
  sunlight: 'sun',
  coldshower: 'cold',
  caffeine: 'coffee',
  nolatefood: 'food',
  fasting: 'food',
  mealprep: 'food',
  read: 'read',
  lecture: 'listen',
  language: 'language',
  journal: 'write',
  gratitude: 'write',
  plantomorrow: 'plan',
  review: 'plan',
  nodoomscroll: 'phoneOff',
  screentime: 'phoneOff',
  digitalsunset: 'phoneOff',
  socialmedia: 'phoneOff',
  qualitytime: 'phoneOff',
  nogaming: 'game',
  hardthing: 'target',
  keepword: 'shield',
  nocomplain: 'shield',
  shower: 'shower',
  sunscreen: 'sun',
  makebed: 'home',
  tidy: 'home',
  laundry: 'home',
  dresswell: 'shirt',
  callfamily: 'call',
  messagefriend: 'message',
  trackspend: 'money',
};

const BY_TAG: Record<string, QuestIconKey> = {
  hydration: 'water',
  strength: 'strength',
  gym: 'strength',
  cardio: 'run',
  neat: 'walk',
  sport: 'run',
  mobility: 'stretch',
  recovery: 'stretch',
  sleep: 'sleep',
  circadian: 'sun',
  resilience: 'cold',
  posture: 'posture',
  tracking: 'scale',
  macros: 'food',
  micros: 'food',
  cooking: 'food',
  restraint: 'restrain',
  supplement: 'pill',
  study: 'book',
  reading: 'read',
  learning: 'book',
  mindfulness: 'mind',
  reflection: 'write',
  focus: 'focus',
  coding: 'code',
  output: 'ship',
  writing: 'write',
  music: 'music',
  art: 'art',
  work: 'inbox',
  practice: 'target',
  career: 'career',
  abstain: 'restrain',
  mindset: 'target',
  integrity: 'shield',
  morning: 'alarm',
  skincare: 'care',
  hygiene: 'care',
  grooming: 'groom',
  order: 'home',
  presence: 'shirt',
  family: 'call',
  friends: 'people',
  kindness: 'people',
  boundaries: 'shield',
  repair: 'people',
  saving: 'money',
  investing: 'money',
  income: 'money',
  audit: 'money',
};

const BY_CATEGORY: Record<CategoryId, QuestIconKey> = {
  body: 'strength',
  nutrition: 'food',
  mind: 'book',
  craft: 'target',
  discipline: 'shield',
  care: 'care',
  social: 'people',
  wealth: 'money',
  planned: 'task',
};

export function questIconKey(quest: { id: string; tags?: string[]; category: CategoryId }): QuestIconKey {
  if (BY_ID[quest.id]) return BY_ID[quest.id];
  for (const tag of quest.tags ?? []) if (BY_TAG[tag]) return BY_TAG[tag];
  return BY_CATEGORY[quest.category];
}
