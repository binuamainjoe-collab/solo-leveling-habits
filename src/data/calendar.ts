/**
 * Google Calendar events and Google Tasks, turned into the few short lines
 * the System reads — pure, so the rules can be tested under Node.
 *
 * The events and tasks arrive from the `google` edge function exactly as
 * Google sends them, so nothing here trusts their shape: every field is
 * re-read, and anything odd is dropped rather than guessed at.
 */
import { fromMinutes, toMinutes } from '@/data/timeline';

/** More lines than this and the day's context starts crowding out the rules. */
const MAX_LINES = 12;
const MAX_TASKS = 6;
const MAX_TITLE = 80;
/**
 * The longest line sent. The assistant and planner functions cut every line
 * at 100 characters, so a longer one would lose its end — a closing "]" or
 * "(until … next day)". Lines are kept to this by shortening the title,
 * never the times or the notes.
 */
export const MAX_LINE = 100;
/** Shorter than this, a piece of an event left inside waking hours is not worth a block. */
const MIN_PIECE = 5;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cleanTitle(raw: unknown, fallback: string): string {
  return (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : '') || fallback;
}

/** `head + title + tail` in at most MAX_LINE characters; only the title gives way. */
function fit(head: string, title: string, tail = ''): string {
  const room = MAX_LINE - head.length - tail.length;
  const t = title.length <= room ? title : `${title.slice(0, Math.max(1, room - 1)).trimEnd()}…`;
  return `${head}${t}${tail}`;
}

/** A day that has events is re-read after this long, so edits show up. */
export const CACHE_MS = 10 * 60_000;
/** An empty answer (not connected, offline, slow) is retried sooner. */
export const CACHE_EMPTY_MS = 60_000;

/**
 * Whether a cached calendar read can still be used. A read that has not
 * finished yet is always shared, so two callers never start two reads.
 */
export function cacheFresh(at: number, now: number, settled: string[] | undefined): boolean {
  if (settled === undefined) return true;
  return now - at < (settled.length > 0 ? CACHE_MS : CACHE_EMPTY_MS);
}

/** Local midnight to the next local midnight, as Google wants the range. */
export function dayRange(day: string): { timeMin: string; timeMax: string } {
  const [y, m, d] = day.split('-').map(Number);
  return {
    timeMin: new Date(y, m - 1, d).toISOString(),
    timeMax: new Date(y, m - 1, d + 1).toISOString(),
  };
}

/**
 * "09:00–10:30 Lecture: Statistics", "all day: Exam week" — the events that
 * touch `day`, all-day ones first, then by start time. Cancelled events,
 * events on other days, events with no length and anything malformed are
 * left out.
 *
 * An event that crosses midnight is cut at the edge of the day, and says so:
 * "22:00–00:00 Night shift (until 00:30 next day)", "00:00–07:00 Night
 * shift (from 23:00 the day before)". A timed event that covers the whole
 * day (a conference, a trip) becomes an all-day line.
 *
 * Timed events that overlap are merged into one line ("09:00–11:00 Lecture
 * + Office hours"). The planner places every timed line as a fixed block,
 * and its validator rejects overlapping blocks — so code makes the lines
 * placeable here rather than trusting the model to reconcile a calendar.
 * A merged line keeps the midnight note of the events in it.
 *
 * Every line is at most MAX_LINE characters; a long title is shortened
 * with "…" so the times and the note always arrive whole.
 */
export function calendarLines(items: unknown, day: string): string[] {
  if (!Array.isArray(items)) return [];

  const [y, mo, d] = day.split('-').map(Number);
  const dayStart = new Date(y, mo - 1, d).getTime();
  const dayEnd = new Date(y, mo - 1, d + 1).getTime();

  const allDay: string[] = [];
  /** `from` / `until`: the real start and end, when the event crosses midnight. */
  const timed: { start: number; end: number; title: string; from?: Date; until?: Date }[] = [];

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as {
      status?: unknown;
      summary?: unknown;
      start?: { date?: unknown; dateTime?: unknown };
      end?: { date?: unknown; dateTime?: unknown };
    };
    if (e.status === 'cancelled') continue;
    const title = cleanTitle(e.summary, '(busy)');

    // All-day: `end.date` is exclusive, as Google defines it.
    const startDate = typeof e.start?.date === 'string' ? e.start.date : null;
    if (startDate) {
      const endDate = typeof e.end?.date === 'string' ? e.end.date : startDate;
      if (startDate <= day && (day < endDate || startDate === endDate)) allDay.push(fit('all day: ', title));
      continue;
    }

    const start = typeof e.start?.dateTime === 'string' ? new Date(e.start.dateTime) : null;
    const end = typeof e.end?.dateTime === 'string' ? new Date(e.end.dateTime) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const s = start.getTime();
    const t = end.getTime();
    // Keep every event that overlaps this day, not only those that start on it.
    if (t <= s || t <= dayStart || s >= dayEnd) continue;
    if (s <= dayStart && t >= dayEnd) {
      allDay.push(fit('all day: ', title));
      continue;
    }
    timed.push({
      start: Math.max(s, dayStart),
      end: Math.min(t, dayEnd),
      title,
      from: s < dayStart ? start : undefined,
      until: t > dayEnd ? end : undefined,
    });
  }

  timed.sort((a, b) => a.start - b.start);
  const merged: typeof timed = [];
  for (const t of timed) {
    const prev = merged[merged.length - 1];
    if (prev && t.start < prev.end) {
      if (t.end > prev.end) prev.end = t.end;
      prev.title = `${prev.title} + ${t.title}`;
      if (t.from && (!prev.from || t.from < prev.from)) prev.from = t.from;
      if (t.until && (!prev.until || t.until > prev.until)) prev.until = t.until;
    } else {
      merged.push({ ...t });
    }
  }
  const lines: string[] = [];
  for (const t of merged) {
    // Merged events that reach both midnights fill the whole day.
    if (t.start <= dayStart && t.end >= dayEnd) {
      allDay.push(fit('all day: ', t.title));
      continue;
    }
    // An event cut at the end of the day ends at "00:00"; the planner reads
    // that as midnight, after the evening (see dayMinutes in timeline.ts).
    const note = t.from ? ` (from ${hhmm(t.from)} the day before)` : t.until ? ` (until ${hhmm(t.until)} next day)` : '';
    lines.push(fit(`${hhmm(new Date(t.start))}–${hhmm(new Date(t.end))} `, t.title, note));
  }
  return [...allDay, ...lines].slice(0, MAX_LINES);
}

/**
 * Open Google Tasks as "to do" lines, overdue and dated ones first:
 * "to do (overdue, due 2026-10-18): Send the form", "to do (due 2026-10-20):
 * Read chapter 4", "to do: Call the bank". Completed, deleted and untitled
 * tasks are left out. Google stores a task's due date as midnight UTC, so
 * only its date part is read.
 */
export function taskLines(items: unknown, day: string): string[] {
  if (!Array.isArray(items)) return [];
  const open: { due: string | null; title: string }[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as { status?: unknown; deleted?: unknown; title?: unknown; due?: unknown };
    if (t.status === 'completed' || t.deleted === true) continue;
    const title = cleanTitle(t.title, '');
    if (!title) continue;
    const due = typeof t.due === 'string' && /^\d{4}-\d\d-\d\d/.test(t.due) ? t.due.slice(0, 10) : null;
    open.push({ due, title });
  }
  // Dated first, earliest first; undated after, in Google's order.
  open.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  return open.slice(0, MAX_TASKS).map(({ due, title }) =>
    fit(!due ? 'to do: ' : due < day ? `to do (overdue, due ${due}): ` : `to do (due ${due}): `, title),
  );
}

/** A timed line: the times, the title, and the midnight note calendarLines may add. */
const TIMED = /^(\d\d):(\d\d)–(\d\d):(\d\d) (.+?)( \((?:from|until) \d\d:\d\d (?:the day before|next day)\))?$/;

/**
 * The calendar lines the planner may place, cut to the waking hours.
 *
 * The planner's validator rejects any block outside wake to sleep, so code
 * — not the model — decides what of each event is placeable: the part of a
 * timed line inside wake–sleep stays a timed line (and says what was cut);
 * a line with no part inside becomes "outside waking hours: …", which the
 * prompt treats as context, never a block. Every other line is unchanged.
 * Since the lines never overlap and each now sits inside wake–sleep, placing
 * every timed line as a fixed block always passes `validateDraft`. Lines
 * stay within MAX_LINE: the title is shortened, the notes never are.
 */
export function fitCalendar(lines: string[], wake: string, sleep: string): string[] {
  const w = toMinutes(wake);
  let sl = toMinutes(sleep);
  if (sl <= w) sl += 1440; // a bedtime after midnight
  return lines.map((line) => {
    const m = TIMED.exec(line);
    if (!m) return line;
    const s = Number(m[1]) * 60 + Number(m[2]);
    let e = Number(m[3]) * 60 + Number(m[4]);
    if (e <= s) e += 1440; // cut at midnight: "22:00–00:00"
    const title = m[5];
    const note = m[6] ?? '';
    const really = `${m[1]}:${m[2]}–${m[3]}:${m[4]}`;
    const cs = Math.max(s, w);
    const ce = Math.min(e, sl);
    if (ce - cs < MIN_PIECE) return fit(`outside waking hours: ${really} `, title, note);
    if (cs === s && ce === e) return line;
    return fit(`${fromMinutes(cs)}–${fromMinutes(ce)} `, title, `${note} [cut to waking hours; really ${really}]`);
  });
}
