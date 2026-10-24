/**
 * Design tokens: "ember".
 *
 * The same idea as before — a dark ground, cream text, one vivid orange —
 * taken warmer, so nothing in the app reads cold: the blacks are brown-black
 * like coals, the greys are warm, and the orange runs into amber on one side
 * and red on the other, so it can blend as a gradient instead of sitting on
 * the dark as a flat sticker. The data colours (green, blue, violet…) are
 * pulled toward the same warmth so a chart reads as one picture. Dark only.
 */

export const palette = {
  // Ground and surfaces — coal: near-black with a brown cast.
  bg: '#110D0A',
  surface: '#1B1511',
  surfaceRaised: '#261D17',
  surfaceHover: '#30251D',

  /** Hairlines tinted like firelight on a wall, not neutral white. */
  border: 'rgba(255,220,190,0.07)',
  borderStrong: 'rgba(255,220,190,0.15)',

  /** The ember. Still the one loud colour: the next action, the streak, progress. */
  accent: '#FF7020',
  /** Amber — the light end of the ember gradient. */
  accentSoft: '#FFA552',
  /** Coal red — the dark end. */
  accentDeep: '#C93E16',

  /** Warm cream, never #FFF. */
  text: '#F7ECDF',
  textMuted: '#A99887',
  textFaint: '#6F6157',

  positive: '#9BD17E',
  negative: '#FF5C4D',
  gold: '#F2B64A',
  violet: '#D49AE0',
  sky: '#86B4D6',
  teal: '#6FC7B0',
} as const;

/**
 * Gradients, light to dark. `ember` is the hero and Beerus's orb; `coal`
 * is the quiet fill under a card that should glow without shouting.
 */
export const gradient = {
  ember: ['#FFB061', '#FF7020', '#C93E16'],
  coal: ['#2A1E16', '#1B1511'],
} as const;

/** The display face: Outfit, a round geometric sans, for headings and figures. */
export const display = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semibold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
} as const;

/** rgba() from a hex token — used for scrims, tints and glows. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ------------------------------------------------------------------ ranks */

export const RANKS = ['E', 'D', 'C', 'B', 'A', 'S'] as const;
export type Rank = (typeof RANKS)[number];

export const rankMeta: Record<Rank, { color: string; label: string; weight: number }> = {
  E: { color: palette.textMuted, label: 'E-RANK', weight: 1 },
  D: { color: palette.positive, label: 'D-RANK', weight: 2 },
  C: { color: palette.sky, label: 'C-RANK', weight: 3 },
  B: { color: palette.violet, label: 'B-RANK', weight: 4 },
  A: { color: palette.accent, label: 'A-RANK', weight: 5 },
  S: { color: palette.negative, label: 'S-RANK', weight: 6 },
};

/** Difficulty wording, shown in the card meta row the way Life Reset does. */
export function difficultyFor(rank: Rank): string {
  if (rank === 'E') return 'Easy';
  if (rank === 'D' || rank === 'C') return 'Medium';
  if (rank === 'B') return 'Hard';
  return 'Extreme';
}

/* ------------------------------------------------------------------ stats */

export const STATS = ['STR', 'AGI', 'VIT', 'INT', 'PER', 'SEN'] as const;
export type StatKey = (typeof STATS)[number];

export const statMeta: Record<StatKey, { label: string; color: string; glyph: string }> = {
  STR: { label: 'Strength', color: palette.negative, glyph: '◆' },
  AGI: { label: 'Agility', color: palette.positive, glyph: '◇' },
  VIT: { label: 'Vitality', color: palette.accent, glyph: '⬢' },
  INT: { label: 'Intelligence', color: palette.sky, glyph: '◈' },
  PER: { label: 'Perception', color: palette.violet, glyph: '⬡' },
  SEN: { label: 'Sense', color: palette.gold, glyph: '✦' },
};

/* ------------------------------------------------------------- categories */

export const CATEGORIES = [
  'body',
  'nutrition',
  'mind',
  'craft',
  'discipline',
  'care',
  'social',
  'wealth',
  // Not a discipline you pick from the Archive — the home for tasks the nightly
  // briefing invents. Kept in the union so planned quests flow through the same
  // completion, coverage and calendar code as everything else.
  'planned',
] as const;
export type CategoryId = (typeof CATEGORIES)[number];

export const categoryMeta: Record<
  CategoryId,
  { label: string; short: string; color: string; glyph: string }
> = {
  body: { label: 'Physical Conditioning', short: 'BODY', color: palette.accent, glyph: '⚔' },
  nutrition: { label: 'Nutrition & Fuel', short: 'FUEL', color: palette.positive, glyph: '⬢' },
  mind: { label: 'Mental Fortitude', short: 'MIND', color: palette.sky, glyph: '◈' },
  craft: { label: 'Skill & Craft', short: 'CRAFT', color: palette.violet, glyph: '✦' },
  discipline: { label: 'Discipline & Restraint', short: 'WILL', color: palette.negative, glyph: '⛨' },
  care: { label: 'Grooming & Recovery', short: 'CARE', color: palette.teal, glyph: '❖' },
  social: { label: 'Social Bonds', short: 'BONDS', color: '#F7C66B', glyph: '◇' },
  wealth: { label: 'Resource Management', short: 'GOLD', color: '#CFA068', glyph: '◆' },
  // Deliberately a neutral platinum: tonight's plan should read as issued by
  // the System rather than belonging to any one discipline.
  // On the board this only ever shows the plan for the day being viewed —
  // which is today. "Tomorrow's Plan" was wrong on the one day it appeared.
  planned: { label: "Today's Plan", short: 'PLAN', color: '#E3D3C2', glyph: '✧' },
};

/** The eight disciplines you can actually browse and accept quests from. */
export const BROWSABLE_CATEGORIES = CATEGORIES.filter((c) => c !== 'planned');

/* ------------------------------------------------------------------ scale */

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Generous rounding is central to the look — nothing here is sharp. */
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

/**
 * Type follows Apple: one family — the platform's own (SF Pro on iPhone and
 * Mac, Roboto on Android) — and hierarchy from size and weight alone, on the
 * iOS text-style scale in src/data/typeScale.ts. SystemText applies it; no
 * screen sets a font family.
 */
export const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

/**
 * Icon sizes, from Apple's guidance: a tab bar glyph is about 25pt, a
 * toolbar or navigation glyph 22pt, and an icon inside a line of text
 * matches that text (17pt body, 13pt footnote).
 */
export const icon = { tab: 25, bar: 22, body: 17, small: 13 } as const;

/** Apple's minimum hit target. Anything tappable is at least this tall. */
export const HIT = 44;

/** Breakpoint above which the layout goes multi-column (tablet / desktop web). */
export const WIDE = 760;
