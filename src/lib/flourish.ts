/**
 * The maths behind the everyday motion on Today: the path a cleared quest
 * flies into the ring, how big the streak flame burns, and how a number splits
 * into digits that roll. No React Native here, so it runs under plain Node
 * (see scratch/flourish-check.ts).
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One step of a Web Animations keyframe list. */
export interface Frame {
  offset: number;
  transform: string;
  opacity: number;
}

/** CSS's cubic-bezier() as a function of time, for baking a curve into keyframes. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // x(t) only ever rises when both x handles sit inside 0–1, so halving finds t.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

const smooth = (from: number, to: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return k * k * (3 - 2 * k);
};

/** How long a cleared card takes to reach the ring. */
export const FLIGHT_MS = 560;
const STEPS = 20;
/** Leaves at once, gathers speed, then settles into the ring. */
const travel = bezier(0.45, 0, 0.2, 1);

export interface Flight {
  duration: number;
  /** Where the ember starts, in screen pixels. It is drawn centred on this. */
  start: { x: number; y: number };
  /** The card: pops up, arcs over and shrinks into the ring as it fades. */
  card: Frame[];
  /** The ember the card burns down into, which is what reaches the ring. */
  ember: Frame[];
}

/**
 * The flight from a card to the ring, as keyframes for both the card and the
 * ember it becomes. The path bows to one side, like something tossed rather
 * than slid, and the curve is baked into the frames so the browser can play
 * them away from the page's own work.
 */
export function flightPath(from: Box, to: Box): Flight {
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const side = dx >= 0 ? -1 : 1;
  const bow = Math.min(120, dist * 0.28) * side;
  const c = { x: (a.x + b.x) / 2 - (dy / dist) * bow, y: (a.y + b.y) / 2 + (dx / dist) * bow };
  // Small enough to drop inside the ring, never so small it vanishes early.
  const end = Math.max(0.12, (to.width * 0.32) / Math.max(1, from.width));

  const card: Frame[] = [];
  const ember: Frame[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const e = travel(t);
    const u = 1 - e;
    const x = u * u * a.x + 2 * u * e * c.x + e * e * b.x - a.x;
    const y = u * u * a.y + 2 * u * e * c.y + e * e * b.y - a.y;
    const pop = 1 + 0.05 * Math.sin(Math.PI * Math.min(1, t / 0.3));
    const scale = (1 + (end - 1) * smooth(0.08, 1, e)) * pop;
    const turn = 8 * Math.sin(Math.PI * e) * -side;
    const move = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    card.push({
      offset: t,
      transform: `${move} rotate(${turn.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
      opacity: 1 - smooth(0.5, 0.86, e),
    });
    ember.push({
      offset: t,
      transform: `${move} scale(${(1.1 - 0.55 * e).toFixed(4)})`,
      opacity: smooth(0.32, 0.6, e) * (1 - smooth(0.9, 1, t)),
    });
  }
  return { duration: FLIGHT_MS, start: a, card, ember };
}

/**
 * How big the streak flame burns in the ring: a few embers before there is a
 * streak, then a flame that grows every day and reaches full height at a
 * month. Growth slows as it goes, so each early day is visible.
 */
export function flameFor(streak: number): { height: number; glow: number } {
  if (streak <= 0) return { height: 0.2, glow: 0.35 };
  const grown = Math.min(1, Math.log(1 + streak) / Math.log(31));
  return { height: 0.36 + 0.64 * grown, glow: 0.6 + 0.4 * grown };
}

export interface RollingPart {
  /** Counted from the right, so the ones place keeps its column as a number grows. */
  key: string;
  digit: number | null;
  char: string;
}

/** A piece of text split into digits that roll and everything else, which doesn't. */
export function rollingParts(text: string): RollingPart[] {
  const chars = [...text];
  return chars.map((char, i) => {
    const digit = char >= '0' && char <= '9' ? Number(char) : null;
    return { key: `${digit === null ? 's' : 'd'}${chars.length - i}`, digit, char };
  });
}
