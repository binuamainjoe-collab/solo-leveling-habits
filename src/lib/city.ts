/**
 * The month as a small city: one block per day on the calendar's own grid,
 * standing as tall as that day went. A perfect day is a tower with every
 * window lit and an ember roof; a missed day is bare ground; days still to
 * come are faint plots. Laid out so that, seen from straight above, it is the
 * calendar exactly, which is how the switch between the two can be one
 * camera move. No React or React Native here, for `scratch/status-check.ts`.
 */
import { apply, multiply, orbitView, perspective, toScreen, type Mat4 } from '@/lib/mat4';
import { pushTriangle, type Facet, type Rgb } from '@/lib/status';

export interface CityDay {
  key: string;
  col: number;
  row: number;
  /** Cleared share of the day's quests, 0–1. */
  ratio: number;
  perfect: boolean;
  /** A record exists for it. */
  logged: boolean;
  future: boolean;
  today: boolean;
}

/** The calendar's cells, Monday first, with null for the blanks before the 1st. */
export function cityDays(
  cells: (string | null)[],
  log: Record<string, { cleared: number; total: number; perfect: boolean } | undefined>,
  today: string,
): CityDay[] {
  const out: CityDay[] = [];
  cells.forEach((key, i) => {
    if (!key) return;
    const rec = log[key];
    const ratio = rec && rec.total > 0 ? Math.min(1, rec.cleared / rec.total) : 0;
    out.push({
      key,
      col: i % 7,
      row: Math.floor(i / 7),
      ratio,
      perfect: Boolean(rec?.perfect),
      logged: Boolean(rec && rec.total > 0),
      future: key > today,
      today: key === today,
    });
  });
  return out;
}

/** How tall a day stands, in cells. */
export function dayHeight(d: CityDay): number {
  if (d.future) return 0.03;
  if (!d.logged) return 0.05;
  if (d.perfect) return 1.9;
  return 0.22 + 1.45 * d.ratio;
}

/** The grid in world units: a column is 1 wide, a row `zp` deep, a plot `foot` across. */
export interface CityGrid {
  /** Row pitch over column pitch, from the calendar's own cell sizes. */
  zp: number;
  /** A block's footprint, as a share of a column. */
  foot: number;
}

export const COAL: Rgb = [0.15, 0.11, 0.085];
const EMBER: Rgb = [1.0, 0.44, 0.13];
const PLOT: Rgb = [0.105, 0.082, 0.066];
const FAINT: Rgb = [0.085, 0.066, 0.054];

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The roof's colour: as the calendar paints the day, so the view from above matches. */
export function roofColour(d: CityDay): { colour: Rgb; glow: number } {
  if (d.future) return { colour: FAINT, glow: 0 };
  if (d.perfect) return { colour: EMBER, glow: 0.55 };
  if (!d.logged || d.ratio <= 0) return { colour: PLOT, glow: 0 };
  return { colour: mix(PLOT, EMBER, 0.2 + d.ratio * 0.45), glow: 0.12 * d.ratio };
}

/**
 * Every block as triangles. `rise` gives how far up each day has grown, 0–1,
 * for the moment the city stands up out of the calendar.
 */
export function cityMesh(days: CityDay[], grid: CityGrid, rise: (i: number) => number, selected: string | null): Float32Array {
  const out: number[] = [];
  const half = grid.foot / 2;
  days.forEach((d, i) => {
    const cx = d.col + 0.5;
    const cz = (d.row + 0.5) * grid.zp;
    const h = Math.max(0.012, dayHeight(d) * rise(i)) + (d.key === selected ? 0.08 * rise(i) : 0);
    const x0 = cx - half;
    const x1 = cx + half;
    const z0 = cz - half;
    const z1 = cz + half;
    const inside: [number, number, number] = [cx, h / 2, cz];
    const roof = roofColour(d);
    const line = d.key === selected ? 1 : d.today ? -1 : d.future ? 0.12 : 0.32;
    const top: Facet = { colour: roof.colour, glow: roof.glow, edge: line };
    pushTriangle(out, [x0, h, z0], [x1, h, z0], [x1, h, z1], inside, { ...top, edges: [true, true, false] });
    pushTriangle(out, [x0, h, z0], [x1, h, z1], [x0, h, z1], inside, { ...top, edges: [false, true, true] });
    if (h < 0.02) return;
    // Walls, with windows lit as far as the day was cleared.
    const lit = d.logged ? (d.perfect ? 1 : d.ratio) : 0;
    const wall = (ax: number, az: number, bx: number, bz: number, seed: number) => {
      const f: Facet = {
        colour: COAL,
        glow: 0,
        edge: d.key === selected ? 0.8 : 0.18,
        windows: [lit > 0 ? lit : 0, seed],
      };
      // u runs along the wall, 0–1; v is height in world units.
      pushTriangle(out, [ax, 0, az], [bx, 0, bz], [bx, h, bz], inside, {
        ...f,
        edges: [true, true, false],
        uv: [[0, 0], [1, 0], [1, h]],
      });
      pushTriangle(out, [ax, 0, az], [bx, h, bz], [ax, h, az], inside, {
        ...f,
        edges: [false, true, true],
        uv: [[0, 0], [1, h], [0, h]],
      });
    };
    const seed = (i * 7.31) % 13;
    wall(x0, z1, x1, z1, seed);
    wall(x1, z1, x1, z0, seed + 1.7);
    wall(x1, z0, x0, z0, seed + 3.1);
    wall(x0, z0, x0, z1, seed + 4.9);
  });
  return new Float32Array(out);
}

/** The two ends of the camera move: the calendar seen from above, and the city. */
export interface CityCamera {
  mvp: Mat4;
  eye: [number, number, number];
}

const FOV = (26 * Math.PI) / 180;
const CITY_YAW = -0.5;
const CITY_PITCH = 0.9;
/** How much of the canvas the city may fill, leaving a margin all round. */
const FILL = 0.88;

/**
 * Where the standing city's camera looks from and how far back it stands, so
 * the whole month, its tallest block included, fills the canvas with a
 * margin and sits in its middle. A few rounds of: project the city's box,
 * see how far it overflows or falls short, step back or in, recentre.
 */
function fitCity(
  aspect: number,
  rows: number,
  grid: CityGrid,
  tallest: number,
  start: number,
): { target: [number, number, number]; dist: number } {
  const depth = rows * grid.zp;
  let target: [number, number, number] = [3.5, tallest * 0.4, depth / 2];
  let dist = start;
  const right: [number, number, number] = [Math.cos(CITY_YAW), 0, -Math.sin(CITY_YAW)];
  const up: [number, number, number] = [
    -Math.sin(CITY_PITCH) * Math.sin(CITY_YAW),
    Math.cos(CITY_PITCH),
    -Math.sin(CITY_PITCH) * Math.cos(CITY_YAW),
  ];
  for (let round = 0; round < 4; round++) {
    const { view } = orbitView(target, CITY_YAW, CITY_PITCH, dist);
    const mvp = multiply(perspective(FOV, aspect, 0.1, dist * 4), view);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const x of [0, 7]) {
      for (const y of [0, tallest]) {
        for (const z of [0, depth]) {
          const [cx, cy, , cw] = apply(mvp, x, y, z);
          minX = Math.min(minX, cx / cw);
          maxX = Math.max(maxX, cx / cw);
          minY = Math.min(minY, cy / cw);
          maxY = Math.max(maxY, cy / cw);
        }
      }
    }
    const reach = Math.max((maxX - minX) / 2, (maxY - minY) / 2);
    // Recentre: move the target along the screen's own right and up.
    const halfH = dist * Math.tan(FOV / 2);
    const sx = ((minX + maxX) / 2) * halfH * aspect;
    const sy = ((minY + maxY) / 2) * halfH;
    target = [
      target[0] + right[0] * sx + up[0] * sy,
      target[1] + right[1] * sx + up[1] * sy,
      target[2] + right[2] * sx + up[2] * sy,
    ];
    dist *= reach / FILL;
  }
  return { target, dist };
}

/**
 * The camera at `p` between the calendar (0) and the city (1), with a turn
 * `spin` added by a finger or by scrolling past. At 0 the ground plane fills
 * the canvas exactly as the calendar's grid does, `top` px below its top edge.
 * At 1 the city, up to its `tallest` block, fills the canvas.
 */
export function cityCamera(
  p: number,
  spin: number,
  canvas: { width: number; height: number; top: number },
  rows: number,
  grid: CityGrid,
  tallest: number,
): CityCamera {
  const { width: w, height: h, top } = canvas;
  const aspect = w / h;
  const f = 1 / Math.tan(FOV / 2);
  const colPx = w / 7;
  // Above: one column is colPx wide, so the plane stands this far away.
  const flatDist = (f * h) / 2 / colPx;
  const flatTarget: [number, number, number] = [3.5, 0, (h / 2 - top) / colPx];
  const city = fitCity(aspect, rows, grid, Math.max(0.3, tallest), flatDist);
  const e = p * p * (3 - 2 * p);
  const target: [number, number, number] = [
    flatTarget[0] + (city.target[0] - flatTarget[0]) * e,
    flatTarget[1] + (city.target[1] - flatTarget[1]) * e,
    flatTarget[2] + (city.target[2] - flatTarget[2]) * e,
  ];
  const pitch = Math.PI / 2 + (CITY_PITCH - Math.PI / 2) * e;
  const yaw = CITY_YAW * e + spin;
  const dist = flatDist + (city.dist - flatDist) * e;
  const { view, eye } = orbitView(target, yaw, pitch, dist);
  const proj = perspective(FOV, aspect, 0.1, Math.max(flatDist, city.dist) * 4);
  return { mvp: multiply(proj, view), eye };
}

/**
 * Which day a tap at (x, y) px is on: the nearest block whose outline on
 * screen holds the point, or failing that the closest roof within reach.
 */
export function pickDay(
  days: CityDay[],
  grid: CityGrid,
  heightOf: (i: number) => number,
  mvp: Mat4,
  w: number,
  h: number,
  x: number,
  y: number,
): string | null {
  const half = grid.foot / 2;
  let best: { key: string; depth: number } | null = null;
  let near: { key: string; d: number } | null = null;
  days.forEach((d, i) => {
    const cx = d.col + 0.5;
    const cz = (d.row + 0.5) * grid.zp;
    const top = Math.max(0.012, heightOf(i));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let depth = Infinity;
    for (const yy of [0, top]) {
      for (const [dx, dz] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
        const s = toScreen(mvp, cx + dx, yy, cz + dz, w, h);
        if (!s) return;
        minX = Math.min(minX, s.x);
        maxX = Math.max(maxX, s.x);
        minY = Math.min(minY, s.y);
        maxY = Math.max(maxY, s.y);
        depth = Math.min(depth, s.depth);
      }
    }
    if (x >= minX && x <= maxX && y >= minY && y <= maxY && (!best || depth < best.depth)) best = { key: d.key, depth };
    const c = toScreen(mvp, cx, top, cz, w, h);
    if (c) {
      const dd = Math.hypot(c.x - x, c.y - y);
      if (!near || dd < near.d) near = { key: d.key, d: dd };
    }
  });
  const found = best as { key: string; depth: number } | null;
  if (found) return found.key;
  const close = near as { key: string; d: number } | null;
  return close && close.d < 28 ? close.key : null;
}
