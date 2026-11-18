/**
 * The app's text sizes, as numbers — pure, so it can be tested under Node.
 *
 * Five steps from Apple's scale, with big jumps between them so a screen's
 * hierarchy reads at a glance: Large Title 34, Title 2 22, Body 17,
 * Subheadline 15, Footnote 13, plus Caption 2 at 11 for badges and tab
 * labels only. The full iOS scale has ten steps, and using all of them on
 * one screen (28 next to 22 next to 20) is what made the app read as
 * medium-loud everywhere. SystemText runs every style through `resolveType`,
 * so any size a screen asks for lands on the nearest step, with that step's
 * line height.
 *
 * Figures are the exception: a number in a ring or a score is display type,
 * the way Apple Fitness sets its rings' numbers, so the numeral variant keeps
 * the size it was given (see `resolveType`).
 */

export interface TypeStep {
  /** Apple's name for the style. */
  name: string;
  size: number;
  /** Line height. */
  leading: number;
}

/** The steps, at iOS "Large" (default) Dynamic Type sizes, in points. */
export const TYPE_SCALE: readonly TypeStep[] = [
  { name: 'caption2', size: 11, leading: 13 },
  { name: 'footnote', size: 13, leading: 18 },
  { name: 'subheadline', size: 15, leading: 20 },
  { name: 'body', size: 17, leading: 22 },
  { name: 'title2', size: 22, leading: 28 },
  { name: 'largeTitle', size: 34, leading: 41 },
];

const MIN = TYPE_SCALE[0].size;
const MAX = TYPE_SCALE[TYPE_SCALE.length - 1].size;

/** Wide tracking is for display type; at text sizes it only hurts reading. */
const MAX_TRACKING = 0.6;
const MIN_TRACKING = -0.5;

/**
 * The nearest step of the scale; a tie goes to the larger size. Display
 * numerals above Large Title (the level badge, the breathing count) are
 * left as they are — Apple uses those sizes too, just not for text.
 */
export function snapSize(size: number): number {
  if (!Number.isFinite(size)) return 17;
  if (size > MAX) return Math.round(size);
  if (size <= MIN) return MIN;
  let best = TYPE_SCALE[0].size;
  for (const step of TYPE_SCALE) {
    const d = Math.abs(step.size - size);
    const bestD = Math.abs(best - size);
    if (d < bestD || (d === bestD && step.size > best)) best = step.size;
  }
  return best;
}

/** The line height that goes with a size. */
export function leadingFor(size: number): number {
  const step = TYPE_SCALE.find((s) => s.size === size);
  return step ? step.leading : Math.round(size * 1.2);
}

export interface TypeFields {
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
}

/**
 * Bring one resolved text style onto the scale.
 *
 * - fontSize snaps to the scale (never below 11).
 * - lineHeight is kept when it fits the final size, otherwise replaced by
 *   the scale's leading — a 22px line under 28px text clips it.
 * - letterSpacing is clamped to a range that reads well at text sizes.
 *
 * Only the fields that were given come back, so nothing is invented for a
 * style that never set them.
 */
export function normalizeType(style: TypeFields): TypeFields {
  const out: TypeFields = {};
  if (typeof style.fontSize !== 'number') return out;

  const size = snapSize(style.fontSize);
  out.fontSize = size;
  out.lineHeight =
    typeof style.lineHeight === 'number' && style.lineHeight >= size * 1.1 ? style.lineHeight : leadingFor(size);
  const tracking = typeof style.letterSpacing === 'number' ? style.letterSpacing : 0;
  out.letterSpacing = Math.max(MIN_TRACKING, Math.min(MAX_TRACKING, tracking));
  return out;
}

/**
 * The type of one piece of text: its variant's fields with the screen's own
 * on top, brought onto the scale.
 *
 * A screen that changes the size but gives no line height gets the
 * scale's leading for the new size, not the variant's: a 28 pt figure on a
 * Large Title's 41 pt line, or 11 pt text on a Footnote's 18 pt line, sits
 * in too much air. A line height the screen sets itself is its choice and
 * is kept, as long as it fits the text (see normalizeType).
 */
export function resolveType(variant: TypeFields, own: TypeFields = {}, figure = false): TypeFields {
  const sized = typeof own.fontSize === 'number';
  if (figure) {
    // A figure keeps its size (never below the floor); only an impossible line height is fixed.
    const size = Math.max(MIN, Math.round((sized ? own.fontSize : variant.fontSize) ?? 34));
    const asked = typeof own.lineHeight === 'number' ? own.lineHeight : sized ? undefined : variant.lineHeight;
    const tracking = typeof own.letterSpacing === 'number' ? own.letterSpacing : (variant.letterSpacing ?? 0);
    return {
      fontSize: size,
      lineHeight: asked !== undefined && asked >= size ? asked : leadingFor(size),
      // Big figures may tighten further than text does; they never spread out.
      letterSpacing: Math.min(MAX_TRACKING, Math.max(MIN_TRACKING * 2, tracking)),
    };
  }
  return normalizeType({
    fontSize: sized ? own.fontSize : variant.fontSize,
    lineHeight: typeof own.lineHeight === 'number' ? own.lineHeight : sized ? undefined : variant.lineHeight,
    letterSpacing: typeof own.letterSpacing === 'number' ? own.letterSpacing : variant.letterSpacing,
  });
}
