/**
 * The rules behind the Status page's new pieces: where you stand on the road
 * from E to S, and the shape of the ability crystal. No React or React Native
 * here, so `scratch/status-check.ts` can run it in Node.
 */
import { RANKS, type Rank } from '@/constants/theme';

/* ------------------------------------------------------------ rank ladder */

/** The level each rank starts at. Mirrors `rankFromLevel` in the store. */
export const RANK_FLOOR: Record<Rank, number> = { E: 1, D: 10, C: 25, B: 50, A: 80, S: 100 };

export interface Ladder {
  rank: Rank;
  /** 0 for E up to 5 for S. */
  index: number;
  next: Rank | null;
  /** Levels still to go before the next rank. 0 at S. */
  toNext: number;
  /** How far through this rank, 0–1. 1 at S. */
  within: number;
  /** How far along the whole road from E to S, 0–1, ranks spaced evenly. */
  fill: number;
}

export function rankLadder(level: number): Ladder {
  let index = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (level >= RANK_FLOOR[RANKS[i]]) {
      index = i;
      break;
    }
  }
  const rank = RANKS[index];
  const next = index < RANKS.length - 1 ? RANKS[index + 1] : null;
  if (!next) return { rank, index, next, toNext: 0, within: 1, fill: 1 };
  const from = RANK_FLOOR[rank];
  const to = RANK_FLOOR[next];
  const within = Math.min(1, Math.max(0, (level - from) / (to - from)));
  return { rank, index, next, toNext: Math.max(0, to - level), within, fill: (index + within) / (RANKS.length - 1) };
}

/* ---------------------------------------------------------------- crystal */

export type Rgb = [number, number, number];

/** '#FF7020' as 0–1 channels. */
export function hexRgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Floats per vertex in the facet meshes the crystal and the city share:
 * position 3, normal 3, colour 3, glow 1, barycentric 3, uv 2, windows 2,
 * edge 1.
 */
export const FACET_FLOATS = 18;

/** One triangle's worth of shared attributes, written by `pushTriangle`. */
export interface Facet {
  colour: Rgb;
  glow: number;
  /** Which of the three edges get a line: [a–b, b–c, c–a]. */
  edges?: [boolean, boolean, boolean];
  /** uv at a, b and c, for the city's windows. */
  uv?: [[number, number], [number, number], [number, number]];
  /** Lit share of the windows and a seed for which ones, or [0, 0] for none. */
  windows?: [number, number];
  /** Line strength: above 0 draws cream lines, below 0 ember ones. */
  edge?: number;
}

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Writes one flat-shaded triangle, turned so its face points away from
 * `inside` (a point within the solid), which is what back-face culling needs.
 */
export function pushTriangle(out: number[], a: V3, b: V3, c: V3, inside: V3, f: Facet): void {
  let n = norm(cross(sub(b, a), sub(c, a)));
  const centre: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  const out_ = sub(centre, inside);
  let pts: [V3, V3, V3] = [a, b, c];
  let edges = f.edges ?? [true, true, true];
  let uv = f.uv ?? [[0, 0], [0, 0], [0, 0]];
  if (n[0] * out_[0] + n[1] * out_[1] + n[2] * out_[2] < 0) {
    // Swap b and c: the edges a–b and c–a trade places, b–c stays.
    pts = [a, c, b];
    edges = [edges[2], edges[1], edges[0]];
    uv = [uv[0], uv[2], uv[1]];
    n = [-n[0], -n[1], -n[2]];
  }
  // A vertex's barycentric component is 1 at it and 0 on the far edge; an
  // edge left without a line has its component held at 1 so it never reads 0.
  const skip = [!edges[1], !edges[2], !edges[0]];
  const bary: V3[] = [
    [1, skip[1] ? 1 : 0, skip[2] ? 1 : 0],
    [skip[0] ? 1 : 0, 1, skip[2] ? 1 : 0],
    [skip[0] ? 1 : 0, skip[1] ? 1 : 0, 1],
  ];
  const win = f.windows ?? [0, 0];
  for (let k = 0; k < 3; k++) {
    const p = pts[k];
    out.push(p[0], p[1], p[2], n[0], n[1], n[2], f.colour[0], f.colour[1], f.colour[2], f.glow);
    out.push(bary[k][0], bary[k][1], bary[k][2], uv[k][0], uv[k][1], win[0], win[1], f.edge ?? 0.7);
  }
}

/** Where each ability's point sits round the crystal, in radians. */
export function faceAngle(i: number, count: number): number {
  return (i * 2 * Math.PI) / count;
}

/** The ability facing you when the crystal has turned by `angle`. */
export function facingAt(angle: number, count: number): number {
  'worklet';
  const step = (2 * Math.PI) / count;
  const i = Math.round(-angle / step);
  return ((i % count) + count) % count;
}

/** The turn nearest `from` that puts ability `i` in front. */
export function angleToFace(i: number, count: number, from: number): number {
  'worklet';
  const want = -(i * 2 * Math.PI) / count;
  return want + 2 * Math.PI * Math.round((from - want) / (2 * Math.PI));
}

/** Same scale as the radar: the biggest score sits a little inside the edge. */
export function crystalScale(values: number[]): number {
  return Math.max(20, ...values) * 1.1;
}

/**
 * The ability crystal: a six-sided gem whose point for each ability juts out
 * as far as its score, so a neglected side is a dent you can see from across
 * the room. Each ability owns the faces round its own point, in its colour,
 * and glows brighter the stronger it is. Between the points the faces fold
 * in a little, so every point is a real ridge.
 */
export function crystalMesh(values: number[], colours: Rgb[]): Float32Array {
  const n = values.length;
  const max = crystalScale(values);
  const reach = values.map((v) => 0.36 + 0.64 * Math.min(1, Math.max(0, v) / max));
  const yTop = 0.3;
  const yLow = -0.26;
  const apexTop: V3 = [0, 0.98, 0];
  const apexLow: V3 = [0, -1.0, 0];
  const inside: V3 = [0, 0.02, 0];
  const at = (r: number, a: number, y: number): V3 => [Math.sin(a) * r, y, Math.cos(a) * r];

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = faceAngle(i, n);
    const half = Math.PI / n;
    // The valleys either side: just inside the straight line between points.
    const prev = (i + n - 1) % n;
    const next = (i + 1) % n;
    const valley = (j: number, k: number) => ((reach[j] + reach[k]) / 2) * Math.cos(half) * 0.9;
    const rl = valley(prev, i);
    const rr = valley(i, next);
    const tT = at(reach[i], a, yTop);
    const tL = at(reach[i], a, yLow);
    const lT = at(rl, a - half, yTop);
    const lL = at(rl, a - half, yLow);
    const rT = at(rr, a + half, yTop);
    const rL = at(rr, a + half, yLow);
    const strength = Math.min(1, Math.max(0, values[i]) / max);
    const f: Facet = { colour: colours[i], glow: 0.08 + 0.42 * strength, edge: 0.6 };
    pushTriangle(out, apexTop, lT, tT, inside, f);
    pushTriangle(out, apexTop, tT, rT, inside, f);
    // The band: two quads, each split along a diagonal that draws no line.
    pushTriangle(out, lT, lL, tL, inside, { ...f, edges: [true, true, false] });
    pushTriangle(out, lT, tL, tT, inside, { ...f, edges: [false, true, true] });
    pushTriangle(out, tT, tL, rL, inside, { ...f, edges: [true, true, false] });
    pushTriangle(out, tT, rL, rT, inside, { ...f, edges: [false, true, true] });
    pushTriangle(out, apexLow, tL, lL, inside, f);
    pushTriangle(out, apexLow, rL, tL, inside, f);
  }
  return new Float32Array(out);
}
