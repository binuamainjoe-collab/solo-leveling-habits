/**
 * The rules behind the Collection's motion: where each card stands on the
 * carousel ring, where a flick of the ring or a spun medal comes to rest, and
 * how far a finger tips a card. No React or React Native here, so
 * `scratch/collection-check.ts` can run it in Node. The worklet marks let the
 * gestures call them every frame.
 */
import { project } from '@/lib/motion';

/** Degrees between neighbours on the ring. */
export const RING_STEP = 30;
/** Past this many places from the middle a card is out of sight. */
export const RING_REACH = 2.9;
const PERSPECTIVE = 900;

export interface RingPose {
  /** Turn about the vertical, degrees: the card faces out from the ring. */
  angle: number;
  translateX: number;
  scale: number;
  opacity: number;
  /** How much of the coal to lay over it, 0–1: the far cards sink into the dark. */
  dim: number;
  zIndex: number;
}

/**
 * A card `off` places from the middle of a ring of cards `width` wide: round
 * a cylinder, so the side cards turn away, shrink with distance and slide in
 * behind. Seen from in front, with the same perspective the cards use.
 */
export function ringPose(off: number, width: number): RingPose {
  'worklet';
  const o = Math.max(-RING_REACH, Math.min(RING_REACH, off));
  const theta = (o * RING_STEP * Math.PI) / 180;
  // Placed no further round than 75 degrees, where it is already fading, so
  // a card never slides back toward the middle on its way out of sight.
  const placed = Math.max(-1.31, Math.min(1.31, theta));
  const radius = width * 1.1;
  const x = Math.sin(placed) * radius;
  const z = (Math.cos(placed) - 1) * radius;
  const scale = PERSPECTIVE / (PERSPECTIVE - z);
  const far = Math.abs(off);
  return {
    angle: o * RING_STEP,
    translateX: x * scale,
    scale,
    opacity: far <= 2 ? 1 : Math.max(0, 1 - (far - 2) / (RING_REACH - 2)),
    dim: Math.min(0.6, far * 0.32),
    zIndex: 100 - Math.round(far * 10),
  };
}

/**
 * Which card a flick of the ring comes to rest on: where the flick was going,
 * rounded to a card, kept within the deck. `velocity` is in cards a second.
 */
export function restIndex(pos: number, velocity: number, count: number): number {
  'worklet';
  if (count <= 0) return 0;
  // project() works in px/s; a card is treated as 1000 px of travel there.
  const heading = pos + project(velocity * 1000, 0.997) / 1000;
  return Math.max(0, Math.min(count - 1, Math.round(heading)));
}

/** The cards worth mounting around `index`: what can be seen, and one more. */
export function ringWindow(index: number, count: number): [number, number] {
  const reach = Math.ceil(RING_REACH);
  return [Math.max(0, index - reach), Math.min(count - 1, index + reach)];
}

/**
 * Where a spun medal comes to rest: on whichever face the spin was heading
 * for, a half turn being a face. `velocity` is in degrees a second.
 */
export function restTurn(deg: number, velocity: number): number {
  'worklet';
  const heading = deg + project(velocity, 0.996);
  return Math.round(heading / 180) * 180;
}

/** Which face of a medal turned `deg` is toward you. */
export function faceToward(deg: number): 'front' | 'back' {
  'worklet';
  const c = Math.cos((deg * Math.PI) / 180);
  return c >= 0 ? 'front' : 'back';
}

/**
 * How far a finger at (x, y) on a card `w` × `h` tips it, -1 to 1 on each
 * axis: right of centre tips the right edge away, below tips the bottom.
 */
export function tiltAt(x: number, y: number, w: number, h: number): { x: number; y: number } {
  'worklet';
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return { x: clamp(((x / Math.max(1, w)) - 0.5) * 2), y: clamp(((y / Math.max(1, h)) - 0.5) * 2) };
}
