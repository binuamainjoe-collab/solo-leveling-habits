import { makeMutable } from 'react-native-reanimated';

/**
 * Calling Beerus by pulling down at the top of Today. 0 when nobody is
 * pulling; it reaches 1 at the point where letting go opens his window, and
 * can stretch a little past it. The floating Beerus rises toward the top as
 * it grows, so you watch him come to your finger.
 */
export const summon = makeMutable(0);

/**
 * Where the floating Beerus rests (top-left of his 60 px button, in screen
 * pixels), and, while he is on screen, where he is right now, so his window
 * can fly him up from wherever he was.
 */
export const home: {
  x: number;
  y: number;
  size: number;
  read: (() => { x: number; y: number }) | null;
} = { x: -1, y: -1, size: 60, read: null };
