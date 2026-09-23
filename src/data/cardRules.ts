import { RANKS, type Rank } from '@/constants/theme';
import { QUESTS_BY_ID } from '@/data/quests';

/**
 * Card definitions and the rules that award them. Deliberately free of any
 * asset `require`, so this module can be unit-tested in plain Node — the
 * artwork binding lives in `cards.ts`.
 */

/* ---------------------------------------------------------------- rarity */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export const rarityMeta: Record<
  Rarity,
  { label: string; color: string; glow: string; particles: number }
> = {
  common: { label: 'COMMON', color: '#8C8C93', glow: '#B9B9C2', particles: 12 },
  rare: { label: 'RARE', color: '#6EA8FF', glow: '#A9CBFF', particles: 18 },
  epic: { label: 'EPIC', color: '#B98CFF', glow: '#D6BEFF', particles: 26 },
  legendary: { label: 'LEGENDARY', color: '#D9A441', glow: '#F5CE7A', particles: 34 },
  mythic: { label: 'MYTHIC', color: '#FF6A00', glow: '#FFA766', particles: 44 },
};

/* -------------------------------------------------------------- triggers */

export type CardTrigger =
  | { kind: 'rank'; rank: Rank }
  | { kind: 'streak'; days: number }
  | { kind: 'perfectDays'; count: number }
  | { kind: 'questsCompleted'; count: number }
  /** The same single quest cleared N days running. */
  | { kind: 'questStreak'; days: number; questId?: string }
  /** Fell short on one day, then cleared a later day in full. */
  | { kind: 'penaltySurvived' }
  /** Broke a long run and came back anyway. */
  | { kind: 'comeback'; afterStreak: number };

export interface CardDef {
  id: string;
  name: string;
  /** The System's line, shown on the reveal. */
  flavor: string;
  /** What to do to earn it, shown while locked. */
  hint: string;
  rarity: Rarity;
  trigger: CardTrigger;
}

export const CARDS: CardDef[] = [
  /* --------------------------------------------------------- rank cards */
  { id: 'rank-e', name: 'THE AWAKENED', rarity: 'common', trigger: { kind: 'rank', rank: 'E' },
    hint: 'Awarded the moment you enter the System.',
    flavor: 'Everyone starts here, soaked and shouting into the rain. The difference is who is still standing next week.' },
  { id: 'rank-d', name: 'RISING', rarity: 'common', trigger: { kind: 'rank', rank: 'D' },
    hint: 'Reach D-rank — level 10.',
    flavor: 'You were the weakest in the room. You are not any more, and only you noticed the moment it changed.' },
  { id: 'rank-c', name: 'THE CLIMB', rarity: 'rare', trigger: { kind: 'rank', rank: 'C' },
    hint: 'Reach C-rank — level 25.',
    flavor: 'Skill sharpened past the point where effort shows. It looks effortless now. It was not.' },
  { id: 'rank-b', name: 'UNBOWED', rarity: 'epic', trigger: { kind: 'rank', rank: 'B' },
    hint: 'Reach B-rank — level 50.',
    flavor: 'Bloodied, bandaged, upright. The System stopped offering you easy quests some time ago.' },
  { id: 'rank-a', name: 'APEX', rarity: 'legendary', trigger: { kind: 'rank', rank: 'A' },
    hint: 'Reach A-rank — level 80.',
    flavor: 'Few arrive here. Fewer stay. The blade is drawn without hesitation now.' },
  { id: 'rank-s', name: 'MONARCH', rarity: 'mythic', trigger: { kind: 'rank', rank: 'S' },
    hint: 'Reach S-rank — level 100.',
    flavor: 'There is no rank above this one. The System defers to you now. Arise.' },

  /* ------------------------------------------------------ special cards */
  { id: 'defiance', name: 'RIGHT HERE, RIGHT NOW', rarity: 'epic', trigger: { kind: 'penaltySurvived' },
    hint: 'Fall short on one day, then clear a full day afterwards.',
    flavor: 'You failed the daily quest and came back for it anyway. The penalty zone teaches faster than praise ever did.' },
  { id: 'fallen', name: 'THE FALL', rarity: 'legendary', trigger: { kind: 'comeback', afterStreak: 30 },
    hint: 'Break a 30-day streak — then start again.',
    flavor: 'Anyone can keep a streak they have never broken. Starting over from zero is the rarer thing.' },
  { id: 'wanderer', name: 'THE LONG ROAD', rarity: 'mythic', trigger: { kind: 'streak', days: 100 },
    hint: 'Hold a 100-day streak.',
    flavor: 'A hundred days. You stopped needing the notifications somewhere around day forty.' },
  { id: 'impact', name: 'ONE PUNCH', rarity: 'mythic', trigger: { kind: 'questsCompleted', count: 500 },
    hint: 'Complete 500 quests.',
    flavor: 'Five hundred completions. No single one mattered. All of them together rebuilt you.' },

  /* ---- cards still borrowing quest art; swap in dedicated pieces later */
  { id: 'week-one', name: 'SEVEN GATES', rarity: 'common', trigger: { kind: 'streak', days: 7 },
    hint: 'Hold a 7-day streak.',
    flavor: 'A week unbroken. The habit is not formed yet — but it has been born.' },
  { id: 'month-forged', name: 'THIRTY DAYS FORGED', rarity: 'rare', trigger: { kind: 'streak', days: 30 },
    hint: 'Hold a 30-day streak.',
    flavor: 'Thirty days. What was discipline is now simply who you are.' },
  { id: 'perfect-week', name: 'FLAWLESS', rarity: 'rare', trigger: { kind: 'perfectDays', count: 7 },
    hint: 'Clear every active quest on 7 separate days.',
    flavor: 'Seven perfect clears. Not one quest left on the board.' },
  { id: 'iron-will', name: 'IRON WILL', rarity: 'rare', trigger: { kind: 'questStreak', days: 7 },
    hint: 'Clear the same quest 7 days running.',
    flavor: 'The same boulder, the same hill, seven mornings straight. That is the whole trick.' },
  { id: 'scholar', name: 'THE SCHOLAR', rarity: 'epic', trigger: { kind: 'questStreak', days: 14, questId: 'study' },
    hint: 'Study every day for 14 days.',
    flavor: 'Fourteen nights at the desk. Mastery is downstream of exactly this and nothing else.' },
  { id: 'unbroken', name: 'THE ARCHITECT', rarity: 'mythic', trigger: { kind: 'streak', days: 365 },
    hint: 'Hold a 365-day streak.',
    flavor: 'A full year. You did not find the time — you built it, one day at a time.' },
];

export const CARDS_BY_ID: Record<string, CardDef> = Object.fromEntries(
  CARDS.map((c) => [c.id, c]),
);

/* ------------------------------------------------------------ evaluation */

/**
 * The slice of progress a card trigger can see. Declared here rather than
 * importing ProgressState so the store can depend on cards without a cycle.
 */
export interface CardContext {
  rank: Rank;
  streak: number;
  perfectDays: number;
  questCompletions: number;
  date: string;
  days: Record<string, { values: Record<string, number>; cleared: number; total: number; perfect: boolean }>;
}

function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Was `questId` complete on `date`? */
function clearedOn(ctx: CardContext, date: string, questId: string): boolean {
  const rec = ctx.days[date];
  if (!rec) return false;
  const quest = QUESTS_BY_ID[questId];
  const value = rec.values[questId] ?? 0;
  if (!quest) return false;
  // Mirrors isComplete without importing the store.
  const ceiling = quest.kind === 'value' && ['calories', 'screentime', 'socialmedia'].includes(quest.id);
  return ceiling ? value > 0 && value <= quest.target : value >= quest.target;
}

/** Longest run of consecutive days ending today on which a quest was cleared. */
function questRun(ctx: CardContext, questId: string): number {
  let run = 0;
  let cursor = clearedOn(ctx, ctx.date, questId) ? ctx.date : shiftDay(ctx.date, -1);
  while (clearedOn(ctx, cursor, questId)) {
    run += 1;
    cursor = shiftDay(cursor, -1);
  }
  return run;
}

/** Best current run across every quest that has one. */
function bestQuestRun(ctx: CardContext): number {
  const ids = new Set<string>();
  for (const rec of Object.values(ctx.days)) {
    for (const id of Object.keys(rec.values)) ids.add(id);
  }
  let best = 0;
  for (const id of ids) best = Math.max(best, questRun(ctx, id));
  return best;
}

/**
 * Fell short on one day's board, then cleared a later day in full.
 *
 * Measured against the student's *own* board rather than every penalty quest
 * in the game: boards hold ~15 of 106 quests and a non-training student has no
 * protein quest at all, so a global check made this unearnable.
 */
function penaltySurvived(ctx: CardContext): boolean {
  let missed = false;
  for (const date of Object.keys(ctx.days).sort()) {
    const rec = ctx.days[date];
    // Skip days with no activity, so time before they started doesn't count
    // retroactively as a failure.
    if (!rec || rec.cleared === 0) continue;

    if (rec.perfect && missed) return true;
    if (!rec.perfect) missed = true;
  }
  return false;
}

/** Held a run of at least `afterStreak`, broke it, and has since restarted. */
function comeback(ctx: CardContext, afterStreak: number): boolean {
  const active = Object.keys(ctx.days).filter((d) => (ctx.days[d]?.cleared ?? 0) > 0).sort();
  let run = 0;
  let prev: string | null = null;
  let brokeLongRun = false;

  for (const day of active) {
    if (prev && shiftDay(prev, 1) === day) {
      run += 1;
    } else {
      if (run >= afterStreak) brokeLongRun = true; // the previous run ended
      run = 1;
    }
    prev = day;
  }
  // A long run that is still going has not been broken.
  return brokeLongRun && ctx.streak > 0;
}

export function isCardEarned(card: CardDef, ctx: CardContext): boolean {
  const t = card.trigger;
  switch (t.kind) {
    case 'rank':
      return RANKS.indexOf(ctx.rank) >= RANKS.indexOf(t.rank);
    case 'streak':
      return ctx.streak >= t.days;
    case 'perfectDays':
      return ctx.perfectDays >= t.count;
    case 'questsCompleted':
      return ctx.questCompletions >= t.count;
    case 'questStreak':
      return (t.questId ? questRun(ctx, t.questId) : bestQuestRun(ctx)) >= t.days;
    case 'penaltySurvived':
      return penaltySurvived(ctx);
    case 'comeback':
      return comeback(ctx, t.afterStreak);
  }
}

/** Every card the context now satisfies. */
export function earnedCards(ctx: CardContext): string[] {
  return CARDS.filter((c) => isCardEarned(c, ctx)).map((c) => c.id);
}
