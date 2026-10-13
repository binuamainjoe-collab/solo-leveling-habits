/**
 * Design tokens, mirrored from Life Reset: 66 Day Habit.
 *
 * The character of that design is: near-black ground, warm cream text (never
 * pure white), one vivid orange used at full saturation on only one or two
 * elements per screen, generously rounded cards, and giant right-aligned
 * numerals as the hero element. Dark only — there is no light palette.
 */

export const palette = {
  // Ground and surfaces — near-black, very faintly warm.
  bg: '#0A0A0B',
  surface: '#17171A',
  surfaceRaised: '#232327',
  surfaceHover: '#2B2B30',

  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',

  /** The one loud colour. Used sparingly — a level badge, one CTA, the streak. */
  accent: '#FF6A00',
  accentSoft: '#FF8A3D',
  accentDeep: '#C24E00',

  /** Warm cream, not #FFF. This is what stops the UI reading cold and generic. */
  text: '#F3EDE3',
  textMuted: '#8C8C93',
  textFaint: '#5E5E66',

  positive: '#56D364',
  negative: '#FF4D6D',
  gold: '#D9A441',
  violet: '#B98CFF',
  sky: '#6EA8FF',
  teal: '#4DD0C4',
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
  E: { color: '#8C8C93', label: 'E-RANK', weight: 1 },
  D: { color: '#56D364', label: 'D-RANK', weight: 2 },
  C: { color: '#6EA8FF', label: 'C-RANK', weight: 3 },
  B: { color: '#B98CFF', label: 'B-RANK', weight: 4 },
  A: { color: '#FF6A00', label: 'A-RANK', weight: 5 },
  S: { color: '#FF4D6D', label: 'S-RANK', weight: 6 },
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
  STR: { label: 'Strength', color: '#FF4D6D', glyph: '◆' },
  AGI: { label: 'Agility', color: '#56D364', glyph: '◇' },
  VIT: { label: 'Vitality', color: '#FF6A00', glyph: '⬢' },
  INT: { label: 'Intelligence', color: '#6EA8FF', glyph: '◈' },
  PER: { label: 'Perception', color: '#B98CFF', glyph: '⬡' },
  SEN: { label: 'Sense', color: '#D9A441', glyph: '✦' },
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
  body: { label: 'Physical Conditioning', short: 'BODY', color: '#FF6A00', glyph: '⚔' },
  nutrition: { label: 'Nutrition & Fuel', short: 'FUEL', color: '#56D364', glyph: '⬢' },
  mind: { label: 'Mental Fortitude', short: 'MIND', color: '#6EA8FF', glyph: '◈' },
  craft: { label: 'Skill & Craft', short: 'CRAFT', color: '#B98CFF', glyph: '✦' },
  discipline: { label: 'Discipline & Restraint', short: 'WILL', color: '#FF4D6D', glyph: '⛨' },
  care: { label: 'Grooming & Recovery', short: 'CARE', color: '#4DD0C4', glyph: '❖' },
  social: { label: 'Social Bonds', short: 'BONDS', color: '#FFC24D', glyph: '◇' },
  wealth: { label: 'Resource Management', short: 'GOLD', color: '#D9A441', glyph: '◆' },
  // Deliberately a neutral platinum: tonight's plan should read as issued by
  // the System rather than belonging to any one discipline.
  // On the board this only ever shows the plan for the day being viewed —
  // which is today. "Tomorrow's Plan" was wrong on the one day it appeared.
  planned: { label: "Today's Plan", short: 'PLAN', color: '#C5CBD6', glyph: '✧' },
};

/** The eight disciplines you can actually browse and accept quests from. */
export const BROWSABLE_CATEGORIES = CATEGORIES.filter((c) => c !== 'planned');

/* ------------------------------------------------------------------ scale */

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Generous rounding is central to the look — nothing here is sharp. */
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const font = {
  /** Heavy condensed grotesque, uppercase only — hero lines and the day counter. */
  display: 'Anton_400Regular',
  /** The giant right-aligned stat numerals. */
  numeral: 'ArchivoBlack_400Regular',
  heading: 'Outfit_700Bold',
  semi: 'Outfit_600SemiBold',
  body: 'Outfit_500Medium',
  regular: 'Outfit_400Regular',
} as const;

/** Breakpoint above which the layout goes multi-column (tablet / desktop web). */
export const WIDE = 760;
