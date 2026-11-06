import type { Rank } from '@/constants/theme';

/**
 * What the world behind the tabs should look like right now, worked out from
 * the clock, the rank and recent days. No React Native here, so it runs under
 * plain Node (see scratch/world-check.ts).
 */

export type Rgb = readonly [number, number, number];

export interface Sky {
  /** Colour at the top of the sky. */
  top: Rgb;
  /** Colour low down, behind the ridges. */
  low: Rgb;
  /** The colour of the sun or moon and everything it lights. */
  light: Rgb;
  /** Where it sits: 0–1 across the screen and 0–1 up it. */
  x: number;
  y: number;
  power: number;
}

interface Stop {
  hour: number;
  top: string;
  low: string;
  light: string;
  power: number;
}

const MOON = '#8A93AA';

/** Always dark: this sits behind text, so noon is smoky, never bright. */
const DAY: readonly Stop[] = [
  { hour: 0, top: '#0D0908', low: '#170E0B', light: MOON, power: 0.3 },
  { hour: 5, top: '#100B0B', low: '#21110E', light: MOON, power: 0.22 },
  { hour: 6.5, top: '#1A1013', low: '#4A2318', light: '#FF9A5A', power: 0.8 },
  { hour: 9, top: '#20150F', low: '#3C2417', light: '#FFB878', power: 0.8 },
  { hour: 13, top: '#261B14', low: '#422C1C', light: '#FFD0A0', power: 0.75 },
  { hour: 17.5, top: '#21120E', low: '#552413', light: '#FF7A38', power: 0.95 },
  { hour: 19.5, top: '#150C0F', low: '#3A1813', light: '#D84A20', power: 0.7 },
  { hour: 21.5, top: '#0E0A0A', low: '#1C0F0C', light: MOON, power: 0.3 },
  { hour: 24, top: '#0D0908', low: '#170E0B', light: MOON, power: 0.3 },
];

function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function blend(a: string, b: string, t: number): Rgb {
  const from = rgb(a);
  const to = rgb(b);
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/** The sky at an hour from 0 to 24. The sun crosses by day, the moon by night. */
export function skyAt(hour: number): Sky {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < DAY.length - 2 && h >= DAY[i + 1].hour) i += 1;
  const a = DAY[i];
  const b = DAY[i + 1];
  const t = (h - a.hour) / (b.hour - a.hour);

  const daylight = h >= 6 && h < 20;
  const along = daylight ? (h - 6) / 14 : ((h + 4) % 24) / 10;

  return {
    top: blend(a.top, b.top, t),
    low: blend(a.low, b.low, t),
    light: blend(a.light, b.light, t),
    x: 0.12 + 0.76 * along,
    y: 0.74 + 0.22 * Math.sin(Math.PI * along),
    power: a.power + (b.power - a.power) * t,
  };
}

const HEAT: Record<Rank, number> = { E: 0, D: 0.2, C: 0.4, B: 0.6, A: 0.8, S: 1 };

/** E rank is cold ash and S rank is blazing. */
export function heatForRank(rank: Rank): number {
  return HEAT[rank];
}

/**
 * Whole days missed since the last cleared quest. Today only counts once it has
 * been won, so a morning before the first quest is not a missed day. Someone
 * with nothing in the window starts fresh rather than being told off.
 */
export function missedDays(recent: readonly { cleared: number }[]): number {
  let missed = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].cleared > 0) return i === recent.length - 1 ? 0 : missed;
    if (i < recent.length - 1) missed += 1;
  }
  return 0;
}

/** How much colour drains. It stops at a tint: a bad week is not a punishment. */
export function coldFor(missed: number): number {
  return Math.min(missed, 3) * 0.12;
}
