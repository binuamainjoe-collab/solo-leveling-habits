/**
 * Apple's text styles, as numbers — pure, so it can be tested under Node.
 *
 * iOS sets every screen from one short scale (Large Title 34 down to
 * Caption 2 at 11) and never goes below 11. The app used to pick sizes per
 * screen, which is how 8 to 10px uppercase labels with 2px tracking crept in
 * everywhere. SystemText now runs every style through `resolveType`, so
 * any size a screen asks for lands on the nearest step of this scale, with
 * that step's line height.
 */

export interface TypeStep {
  /** Apple's name for the style. */
  name: string;
  size: number;
  /** Line height. */
  leading: number;
}

/** iOS "Large" (default) Dynamic Type sizes, in points. */
export const TYPE_SCALE: readonly TypeStep[] = [
  { name: 'caption2', size: 11, leading: 13 },
  { name: 'caption1', size: 12, leading: 16 },
  { name: 'footnote', size: 13, leading: 18 },
  { name: 'subheadline', size: 15, leading: 20 },
  { name: 'callout', size: 16, leading: 21 },
  { name: 'body', size: 17, leading: 22 },
  { name: 'title3', size: 20, leading: 25 },
  { name: 'title2', size: 22, leading: 28 },
  { name: 'title1', size: 28, leading: 34 },
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
export function resolveType(variant: TypeFields, own: TypeFields = {}): TypeFields {
  const sized = typeof own.fontSize === 'number';
  return normalizeType({
    fontSize: sized ? own.fontSize : variant.fontSize,
    lineHeight: typeof own.lineHeight === 'number' ? own.lineHeight : sized ? undefined : variant.lineHeight,
    letterSpacing: typeof own.letterSpacing === 'number' ? own.letterSpacing : variant.letterSpacing,
  });
}
