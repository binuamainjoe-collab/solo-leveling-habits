import { skyAt, type Rgb } from '@/lib/world';

/**
 * How the planet behind the Planner's clock is lit at a moment of the day.
 * The sun sits behind the ring at that moment's place on it; this works out
 * where its light comes from and what it looks like. It borrows the world's
 * sky, so the planet and the world behind the tabs agree on the hour. No
 * React Native here, so it runs under plain Node (scratch/planet-check.ts).
 */

/** How high the sun is: 0 all night, rising from 06:00 to 1 at 13:00, gone by 20:00. */
export function daylight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h <= 6 || h >= 20) return 0;
  return Math.sin((Math.PI * (h - 6)) / 14);
}

export interface PlanetLight {
  /** Where the light comes from, as a unit vector: x right, y up, z toward you. */
  dir: [number, number, number];
  colour: Rgb;
  power: number;
  /** How much of the sun itself shows behind the ring, 0 at night. */
  sun: number;
}

/**
 * The light at an hour, for a sun at `angle` on the clock (radians, screen
 * angle, measured clockwise from three o'clock as the ring draws it). By day
 * the light comes from in front and to the sun's side, so most of the planet
 * is lit; at night it comes from behind, leaving a rim and the glowing veins.
 */
export function planetLight(angle: number, hour: number): PlanetLight {
  const up = daylight(hour);
  const x = Math.cos(angle);
  // The screen's y runs down; the planet's runs up.
  const y = -Math.sin(angle);
  const z = -0.55 + up;
  const len = Math.hypot(x, y, z);
  const sky = skyAt(hour);
  return {
    dir: [x / len, y / len, z / len],
    colour: sky.light,
    power: sky.power,
    sun: Math.min(1, up * 4),
  };
}

/** The hour (0–24) at a point along the ring (0–1). */
export function hourAt(fraction: number, span: { start: number; end: number }): number {
  const minutes = span.start + Math.max(0, Math.min(1, fraction)) * (span.end - span.start);
  return (minutes / 60) % 24;
}
