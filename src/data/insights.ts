/**
 * The numbers behind the charts: how today, this week and the last few weeks
 * went, read straight off the day log.
 *
 * Pure on purpose — no react-native in the import graph — so every figure a
 * chart shows can be checked under Node (scratch/insights-check.ts). The
 * screens only draw what this returns.
 */

import type { CategoryId } from '@/constants/theme';
import { addDays, dayMinutes, type PlanBlock } from '@/data/timeline';

/** One day of the log, as much of it as a chart needs. */
export interface DaySummary {
  cleared: number;
  total: number;
  perfect: boolean;
}

export type DayLog = Record<string, DaySummary | undefined>;

export interface DayPoint {
  date: string;
  cleared: number;
  total: number;
  /** cleared / total, 0 when nothing was on the board. */
  ratio: number;
  perfect: boolean;
  /** After today: nothing can have happened yet. */
  future: boolean;
}

function point(log: DayLog, date: string, today: string): DayPoint {
  const rec = log[date];
  const future = date > today;
  const cleared = future ? 0 : (rec?.cleared ?? 0);
  const total = future ? 0 : (rec?.total ?? 0);
  return { date, cleared, total, ratio: total > 0 ? Math.min(1, cleared / total) : 0, perfect: !future && Boolean(rec?.perfect), future };
}

/** The last `count` days, oldest first, ending today. */
export function series(log: DayLog, today: string, count: number): DayPoint[] {
  const out: DayPoint[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(point(log, addDays(today, -i), today));
  return out;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/** Monday to Sunday of the week `today` is in; days still to come are marked future. */
export function thisWeek(log: DayLog, today: string): DayPoint[] {
  const monday = addDays(today, -weekdayIndex(today));
  return Array.from({ length: 7 }, (_, i) => point(log, addDays(monday, i), today));
}

/**
 * The consistency map: `weeks` columns, Monday to Sunday down each one,
 * the last column being this week.
 */
export function heatmap(log: DayLog, today: string, weeks: number): DayPoint[][] {
  const monday = addDays(today, -weekdayIndex(today));
  return Array.from({ length: weeks }, (_, w) => {
    const start = addDays(monday, -7 * (weeks - 1 - w));
    return Array.from({ length: 7 }, (_, d) => point(log, addDays(start, d), today));
  });
}

/** How full a heat cell is drawn: 0 nothing, 1–3 a quarter, a half, most; 4 a perfect day. */
export function heatLevel(p: DayPoint): 0 | 1 | 2 | 3 | 4 {
  if (p.future || p.cleared === 0) return 0;
  if (p.perfect || p.ratio >= 1) return 4;
  if (p.ratio >= 0.6) return 3;
  if (p.ratio >= 0.3) return 2;
  return 1;
}

/**
 * Quests cleared in the last `span` days against the `span` days before,
 * as a whole-number percentage change. null when there is nothing to
 * compare against, rather than an infinite or made-up figure.
 */
export function compare(log: DayLog, today: string, span: number): { now: number; before: number; change: number | null } {
  const sum = (from: number) =>
    series(log, addDays(today, -from), span).reduce((n, p) => n + p.cleared, 0);
  const now = sum(0);
  const before = sum(span);
  return { now, before, change: before > 0 ? Math.round(((now - before) / before) * 100) : null };
}

/** The best day in a run: the most cleared, the latest on a tie. */
export function bestDay(points: DayPoint[]): DayPoint | null {
  let best: DayPoint | null = null;
  for (const p of points) if (!p.future && p.cleared > 0 && (!best || p.cleared >= best.cleared)) best = p;
  return best;
}

/* ---------------------------------------------------------------- balance */

/**
 * The three sides of a day the balance rings show. Eight disciplines are
 * too many to read at a glance; three are not.
 */
export type Group = 'body' | 'mind' | 'life';

export const GROUP_OF: Record<CategoryId, Group> = {
  body: 'body',
  nutrition: 'body',
  care: 'body',
  mind: 'mind',
  craft: 'mind',
  // Planned tasks are what the night before put on the board: study, work.
  planned: 'mind',
  discipline: 'life',
  social: 'life',
  wealth: 'life',
};

export const GROUPS: Group[] = ['body', 'mind', 'life'];

export interface Tally {
  done: number;
  total: number;
}

/** Today's board split into body, mind and life: how much of each is done. */
export function balance<Q extends { category: CategoryId }>(quests: Q[], isDone: (q: Q) => boolean): Record<Group, Tally> {
  const out: Record<Group, Tally> = { body: { done: 0, total: 0 }, mind: { done: 0, total: 0 }, life: { done: 0, total: 0 } };
  for (const q of quests) {
    const g = out[GROUP_OF[q.category]];
    g.total += 1;
    if (isDone(q)) g.done += 1;
  }
  return out;
}

/* ---------------------------------------------------------------- the day */

export interface NextBlock {
  block: PlanBlock;
  /** 'now' while it runs, 'next' when it is the next one to start. */
  status: 'now' | 'next';
  /** Minutes until it starts (next) or ends (now). */
  minutes: number;
}

/**
 * What the plan says to do at `now` ("HH:MM"): the block running, or else
 * the next to start. Breaks are skipped as a next step — nobody needs
 * telling to start a break — but a break that is running is still "now".
 */
export function nextBlock(blocks: PlanBlock[], now: string, wake: string): NextBlock | null {
  const t = dayMinutes(now, wake);
  const sorted = [...blocks].sort((a, b) => dayMinutes(a.start, wake) - dayMinutes(b.start, wake));
  for (const b of sorted) {
    const s = dayMinutes(b.start, wake);
    let e = dayMinutes(b.end, wake);
    if (e <= s) e += 1440;
    if (t >= s && t < e) return { block: b, status: 'now', minutes: e - t };
  }
  for (const b of sorted) {
    const s = dayMinutes(b.start, wake);
    if (s > t && b.kind !== 'break') return { block: b, status: 'next', minutes: s - t };
  }
  return null;
}

/** "in 45 min", "in 2 h 10 min" — how a short wait is said out loud. */
export function inMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "Good morning" until noon, "Good afternoon" until 17:00, then "Good evening". */
export function salutation(hour: number): string {
  if (hour >= 4 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}
