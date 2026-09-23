import type { CategoryId, Rank } from '@/constants/theme';

/** Tier drives the card's frame colour, shimmer and unlock fanfare. */
export type Tier = 'bronze' | 'silver' | 'gold' | 'mythic';

export const tierMeta: Record<
  Tier,
  { label: string; color: string; glowA: string; glowB: string; particles: number }
> = {
  bronze: { label: 'BRONZE', color: '#C8763C', glowA: '#E0995C', glowB: '#8A4B22', particles: 14 },
  silver: { label: 'SILVER', color: '#B8C6DC', glowA: '#E4EDF8', glowB: '#7A8CA8', particles: 20 },
  gold: { label: 'GOLD', color: '#D9A441', glowA: '#F5CE7A', glowB: '#A87716', particles: 28 },
  // Mythic takes the app's hero orange — nothing outranks it.
  mythic: { label: 'MYTHIC', color: '#FF6A00', glowA: '#FFA766', glowB: '#C24E00', particles: 40 },
};

/**
 * How an achievement measures itself. Each variant is evaluated in
 * `evaluateAchievement`, so a new variant needs a branch there too.
 */
export type Track =
  | { type: 'streak'; questId?: string; days: number }
  | { type: 'total'; questId: string; amount: number }
  | { type: 'perfectDays'; count: number }
  | { type: 'level'; level: number }
  | { type: 'rank'; rank: Rank }
  | { type: 'categoryDays'; category: CategoryId; days: number }
  | { type: 'questsCompleted'; count: number };

export interface AchievementDef {
  id: string;
  title: string;
  /** The System's line, shown on the unlock overlay. */
  flavor: string;
  /** Plain requirement text, shown on the card. */
  requirement: string;
  tier: Tier;
  glyph: string;
  xp: number;
  track: Track;
  /** Hidden until unlocked — card renders as "???". */
  secret?: boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  /* ---------------------------------------------------------- awakening */
  { id: 'awakening', title: 'THE AWAKENING', flavor: 'You have acquired the qualifications to be a Player. Will you accept?', requirement: 'Complete your first quest', tier: 'bronze', glyph: '⚡', xp: 100, track: { type: 'questsCompleted', count: 1 } },
  { id: 'first-day', title: 'DAY ONE', flavor: 'The weakest hunter takes his first step. The System is watching.', requirement: 'Clear every active quest in a single day', tier: 'bronze', glyph: '🌑', xp: 150, track: { type: 'perfectDays', count: 1 } },
  { id: 'ten-quests', title: 'GRINDSTONE', flavor: 'Repetition is the dullest magic, and the only one that never fails.', requirement: 'Complete 10 quests', tier: 'bronze', glyph: '⛏️', xp: 120, track: { type: 'questsCompleted', count: 10 } },
  { id: 'fifty-quests', title: 'HUNDRED CUTS', flavor: 'No single strike mattered. All of them together did.', requirement: 'Complete 50 quests', tier: 'silver', glyph: '🗡️', xp: 300, track: { type: 'questsCompleted', count: 50 } },
  { id: 'fivehundred-quests', title: 'THE LONG CLIMB', flavor: 'Five hundred completions. You are no longer the person who started.', requirement: 'Complete 500 quests', tier: 'gold', glyph: '🏔️', xp: 1200, track: { type: 'questsCompleted', count: 500 } },

  /* ------------------------------------------------------------ streaks */
  { id: 'streak-3', title: 'IGNITION', flavor: 'Three days. The habit has not formed — but it has been born.', requirement: '3 day streak', tier: 'bronze', glyph: '🔥', xp: 120, track: { type: 'streak', days: 3 } },
  { id: 'streak-7', title: 'SEVEN GATES', flavor: 'A week without breaking. The System recalculates your ceiling.', requirement: '7 day streak', tier: 'bronze', glyph: '🚪', xp: 250, track: { type: 'streak', days: 7 } },
  { id: 'streak-30', title: 'MONARCH OF HABIT', flavor: 'Thirty days. What was discipline is now simply who you are.', requirement: '30 day streak', tier: 'gold', glyph: '👑', xp: 900, track: { type: 'streak', days: 30 } },
  { id: 'streak-100', title: 'SHADOW SOVEREIGN', flavor: 'One hundred days. Arise.', requirement: '100 day streak', tier: 'mythic', glyph: '🌘', xp: 3000, track: { type: 'streak', days: 100 } },
  { id: 'streak-365', title: 'THE ARCHITECT', flavor: 'A full year. You did not find the time — you built it, day by day.', requirement: '365 day streak', tier: 'mythic', glyph: '🜂', xp: 10000, track: { type: 'streak', days: 365 } },

  /* ------------------------------------------------------- perfect days */
  { id: 'perfect-7', title: 'FLAWLESS WEEK', flavor: 'Seven perfect clears. Not one quest left on the board.', requirement: '7 perfect days', tier: 'silver', glyph: '💠', xp: 500, track: { type: 'perfectDays', count: 7 } },
  { id: 'perfect-30', title: 'IMMACULATE', flavor: 'Thirty perfect days. The System has stopped offering you easy quests.', requirement: '30 perfect days', tier: 'gold', glyph: '✴️', xp: 1500, track: { type: 'perfectDays', count: 30 } },
  { id: 'perfect-100', title: 'BEYOND THE SYSTEM', flavor: 'You no longer need the notifications. You never really did.', requirement: '100 perfect days', tier: 'mythic', glyph: '🕳️', xp: 5000, track: { type: 'perfectDays', count: 100 } },

  /* -------------------------------------------------------- levels/rank */
  { id: 'level-10', title: 'D-RANK ASCENSION', flavor: 'Reassessment complete. Your rank has been adjusted upward.', requirement: 'Reach level 10', tier: 'bronze', glyph: '🔹', xp: 300, track: { type: 'level', level: 10 } },
  { id: 'level-25', title: 'C-RANK ASCENSION', flavor: 'You are now stronger than most who entered with you.', requirement: 'Reach level 25', tier: 'silver', glyph: '🔷', xp: 700, track: { type: 'level', level: 25 } },
  { id: 'level-50', title: 'B-RANK ASCENSION', flavor: 'The gap between you and your old self is no longer measurable.', requirement: 'Reach level 50', tier: 'gold', glyph: '🟣', xp: 1600, track: { type: 'level', level: 50 } },
  { id: 'level-80', title: 'A-RANK ASCENSION', flavor: 'Few reach this. Fewer stay.', requirement: 'Reach level 80', tier: 'gold', glyph: '🟠', xp: 3000, track: { type: 'level', level: 80 } },
  { id: 'level-100', title: 'NATIONAL LEVEL', flavor: 'There is no rank above this one. The System defers to you now.', requirement: 'Reach level 100', tier: 'mythic', glyph: '🔴', xp: 8000, track: { type: 'level', level: 100 } },

  /* ------------------------------------------------------ body & health */
  { id: 'water-1000', title: 'OCEAN DRAINED', flavor: 'One thousand glasses. Your cells have filed a formal thank-you.', requirement: 'Drink 1,000 glasses of water', tier: 'silver', glyph: '🌊', xp: 600, track: { type: 'total', questId: 'water', amount: 1000 } },
  { id: 'pushups-10000', title: 'TEN THOUSAND FISTS', flavor: 'The trial that broke you on day one is now your warm-up.', requirement: 'Complete 10,000 push-ups', tier: 'gold', glyph: '👊', xp: 1800, track: { type: 'total', questId: 'pushups', amount: 10000 } },
  { id: 'run-500', title: 'MARATHON OF MARATHONS', flavor: 'Five hundred kilometres under your own power.', requirement: 'Run 500 km', tier: 'gold', glyph: '🥇', xp: 2000, track: { type: 'total', questId: 'run', amount: 500 } },
  { id: 'sleep-guardian', title: 'GUARDIAN OF REST', flavor: 'You stopped treating sleep as the thing you sacrifice first.', requirement: 'Hit your sleep target 60 times', tier: 'silver', glyph: '😴', xp: 700, track: { type: 'total', questId: 'sleep', amount: 60 } },
  { id: 'body-30', title: 'VESSEL REFORGED', flavor: 'Thirty days of physical conditioning. The body has been rebuilt.', requirement: '30 days of body quests', tier: 'gold', glyph: '⚔️', xp: 1400, track: { type: 'categoryDays', category: 'body', days: 30 } },

  /* -------------------------------------------------------------- mind */
  { id: 'read-3000', title: 'THE LIBRARY', flavor: 'Three thousand pages. Roughly ten books you would not otherwise have read.', requirement: 'Read 3,000 pages', tier: 'gold', glyph: '📚', xp: 1500, track: { type: 'total', questId: 'read', amount: 3000 } },
  { id: 'study-100h', title: 'SCHOLAR OF THE GATE', flavor: 'One hundred hours of deliberate study. Mastery is downstream of this.', requirement: 'Study for 6,000 minutes', tier: 'gold', glyph: '🎓', xp: 1700, track: { type: 'total', questId: 'study', amount: 6000 } },
  { id: 'meditate-50', title: 'STILL WATER', flavor: 'Fifty sessions. The noise is still there — it just no longer moves you.', requirement: 'Meditate 50 times', tier: 'silver', glyph: '🪷', xp: 650, track: { type: 'total', questId: 'meditate', amount: 50 } },
  { id: 'mind-30', title: 'MIND UNSHACKLED', flavor: 'Thirty days of mental conditioning. Focus is now a resource you own.', requirement: '30 days of mind quests', tier: 'gold', glyph: '◈', xp: 1400, track: { type: 'categoryDays', category: 'mind', days: 30 } },

  /* -------------------------------------------------------- discipline */
  { id: 'discipline-7', title: 'FIRST RESTRAINT', flavor: 'A week of saying no. The hardest spell in the book.', requirement: '7 days of discipline quests', tier: 'bronze', glyph: '⛨', xp: 300, track: { type: 'categoryDays', category: 'discipline', days: 7 } },
  { id: 'discipline-90', title: 'UNBREAKABLE WILL', flavor: 'Ninety days. The craving still speaks; you simply stopped negotiating.', requirement: '90 days of discipline quests', tier: 'mythic', glyph: '🛡️', xp: 4000, track: { type: 'categoryDays', category: 'discipline', days: 90 } },
  { id: 'hardthing-50', title: 'GATE BREAKER', flavor: 'Fifty times you did the hardest thing first. That is the whole secret.', requirement: 'Face the Gate 50 times', tier: 'gold', glyph: '🗡️', xp: 1600, track: { type: 'total', questId: 'hardthing', amount: 50 } },

  /* -------------------------------------------------------- craft/work */
  { id: 'ship-25', title: 'THE FORGE', flavor: 'Twenty-five things shipped. Output beats intention, every time.', requirement: 'Ship something 25 times', tier: 'gold', glyph: '🚀', xp: 1600, track: { type: 'total', questId: 'ship', amount: 25 } },
  { id: 'write-50k', title: 'FIFTY THOUSAND WORDS', flavor: 'A novel’s worth of words, written five hundred at a time.', requirement: 'Write 50,000 words', tier: 'gold', glyph: '✍️', xp: 1800, track: { type: 'total', questId: 'write', amount: 50000 } },
  { id: 'deepwork-100', title: 'ARCHITECT OF FOCUS', flavor: 'One hundred deep blocks. This is where the real levelling happened.', requirement: 'Complete 100 deep work blocks', tier: 'mythic', glyph: '🎯', xp: 3500, track: { type: 'total', questId: 'deepwork', amount: 100 } },
  { id: 'craft-30', title: 'MASTER ARTISAN', flavor: 'Thirty days of craft. The skill compounds whether you notice or not.', requirement: '30 days of craft quests', tier: 'gold', glyph: '✦', xp: 1400, track: { type: 'categoryDays', category: 'craft', days: 30 } },

  /* ------------------------------------------------------- care/social */
  { id: 'care-30', title: 'WELL-KEPT VESSEL', flavor: 'Thirty days of care. Showing up for yourself in the small ways.', requirement: '30 days of care quests', tier: 'silver', glyph: '❖', xp: 800, track: { type: 'categoryDays', category: 'care', days: 30 } },
  { id: 'skincare-100', title: 'ETERNAL YOUTH', flavor: 'One hundred rituals, morning and night. Your future face says thank you.', requirement: 'Complete skincare 100 times', tier: 'silver', glyph: '🧴', xp: 700, track: { type: 'total', questId: 'skincare-pm', amount: 100 } },
  { id: 'social-30', title: 'GUILD MASTER', flavor: 'Thirty days of tending your bonds. No one levels alone.', requirement: '30 days of social quests', tier: 'gold', glyph: '◇', xp: 1300, track: { type: 'categoryDays', category: 'social', days: 30 } },
  { id: 'wealth-30', title: 'TREASURY SEALED', flavor: 'Thirty days of managing what you have. Freedom is bought quietly.', requirement: '30 days of wealth quests', tier: 'gold', glyph: '◆', xp: 1300, track: { type: 'categoryDays', category: 'wealth', days: 30 } },

  /* ------------------------------------------------------------ secret */
  { id: 'secret-nightowl', title: 'HUNTER OF THE NIGHT', flavor: 'The System noticed you clearing quests at 3am. It is concerned, and impressed.', requirement: 'Complete a quest between 02:00 and 04:00', tier: 'mythic', glyph: '🦉', xp: 666, track: { type: 'questsCompleted', count: 1 }, secret: true },
  { id: 'secret-comeback', title: 'RE-AWAKENING', flavor: 'You broke a long streak and came back anyway. That is the rarest stat of all.', requirement: 'Return after breaking a 30+ day streak', tier: 'mythic', glyph: '🔄', xp: 1000, track: { type: 'streak', days: 1 }, secret: true },
  { id: 'secret-allcategories', title: 'THE COMPLETE HUNTER', flavor: 'All eight disciplines cleared in one day. The System has no further tests.', requirement: 'Clear a quest in all 8 categories in one day', tier: 'mythic', glyph: '🜁', xp: 2500, track: { type: 'perfectDays', count: 1 }, secret: true },
];

export const ACHIEVEMENTS_BY_ID: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);
