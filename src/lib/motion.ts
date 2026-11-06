/**
 * The physics every gesture in the app shares, so a sheet, a quest card and a
 * tab all feel like the same world. A finger always hands off to a spring,
 * because a spring carries the finger's speed; a timed curve would restart.
 */

/**
 * Where a flick was going: the point it would coast to if it kept slowing
 * down. Deciding from this, not from where the finger let go, is why a short
 * fast swipe commits and a long slow one doesn't.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  'worklet';
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Past an edge, the further you pull the less it follows. Nothing stops dead. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  'worklet';
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

export function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

/** Add the finger's `velocity` when one exists. Bounce only follows a flick. */
export const SPRING = {
  /** Comes to rest with no overshoot. */
  settle: { duration: 400, dampingRatio: 1 },
  /** Springs home after a drag. */
  snap: { duration: 400, dampingRatio: 0.8 },
  /** A sheet opening or catching. */
  sheet: { duration: 340, dampingRatio: 0.86 },
  /** A sheet leaving: must not pass the bottom edge and flash a gap. */
  dismiss: { duration: 280, dampingRatio: 1, overshootClamping: true },
  /** Tabs landing. */
  page: { duration: 360, dampingRatio: 0.94 },
} as const;
