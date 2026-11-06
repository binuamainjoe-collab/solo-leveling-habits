/**
 * The rules behind the app's new moves: which item of the ring menu a finger
 * is pointing at, where the ring may sit on screen, what counts as a
 * two-finger swipe to undo, and the letters of a System message as it
 * scrambles into place. No React or React Native here, so
 * `scratch/moves-check.ts` can run it in Node.
 */

/** How far the finger must leave the middle of the ring before it points at anything. */
export const RING_DEADZONE = 28;
/** Distance from the ring's middle to each item's centre. */
export const RING_RADIUS = 78;

/** Where item `i` of `count` sits round the ring, from the top, clockwise. */
export function ringSpot(i: number, count: number, radius = RING_RADIUS): { x: number; y: number } {
  'worklet';
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, count);
  return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
}

/**
 * The item a finger at (dx, dy) from the ring's middle points at, or -1
 * inside the dead zone. Each item owns the slice of the circle round it, so
 * a rough flick in its direction is enough.
 */
export function ringPick(dx: number, dy: number, count: number, deadzone = RING_DEADZONE): number {
  'worklet';
  if (count <= 0 || Math.hypot(dx, dy) < deadzone) return -1;
  const step = (2 * Math.PI) / count;
  // Measured from the top, clockwise, shifted half a slice so item 0 is centred on the top.
  let a = Math.atan2(dy, dx) + Math.PI / 2 + step / 2;
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.min(count - 1, Math.floor(a / step));
}

/**
 * Where the ring's middle may go so the whole ring, items and labels, stays
 * on a screen `w` × `h`: as close to the finger as fits.
 */
export function ringCentre(x: number, y: number, w: number, h: number, reach = RING_RADIUS + 40): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
  return { x: clamp(x, reach, w - reach), y: clamp(y, reach, h - reach) };
}

export interface Touch2 {
  /** Where the two fingers started and where they are now, in px. */
  from: [{ x: number; y: number }, { x: number; y: number }];
  to: [{ x: number; y: number }, { x: number; y: number }];
}

/**
 * Whether two fingers moved together far enough sideways, to the left, to
 * mean undo: both the same way, mostly sideways, and keeping their distance
 * apart, so a pinch (which zooms) never counts.
 */
export function isUndoSwipe({ from, to }: Touch2, minTravel = 70): boolean {
  const d0 = { x: to[0].x - from[0].x, y: to[0].y - from[0].y };
  const d1 = { x: to[1].x - from[1].x, y: to[1].y - from[1].y };
  if (d0.x > -minTravel || d1.x > -minTravel) return false;
  if (Math.abs(d0.y) > Math.abs(d0.x) * 0.6 || Math.abs(d1.y) > Math.abs(d1.x) * 0.6) return false;
  const apart0 = Math.hypot(from[0].x - from[1].x, from[0].y - from[1].y);
  const apart1 = Math.hypot(to[0].x - to[1].x, to[0].y - to[1].y);
  return apart0 > 0 && Math.abs(apart1 - apart0) / apart0 < 0.35;
}

/** Letters a System message flickers through before each one settles. */
const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=<>/';

/**
 * A System message part-way into place: letters settle left to right as
 * `progress` runs 0–1, the rest flicker through glyphs picked by `tick`.
 * Spaces and punctuation stand from the start, so the words keep their shape.
 */
export function scrambled(text: string, progress: number, tick: number): string {
  const p = Math.max(0, Math.min(1, progress));
  const settled = Math.floor(text.length * p);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (i < settled || !/[A-Za-z0-9]/.test(ch)) out += ch;
    else {
      const g = GLYPHS[(i * 7 + tick * 13 + ((i * tick) % 5)) % GLYPHS.length];
      out += ch === ch.toLowerCase() ? g.toLowerCase() : g;
    }
  }
  return out;
}
