import { cacheFresh, calendarLines, dayRange, taskLines } from '@/data/calendar';
import { client } from '@/lib/supabase';

/**
 * A day of the Player's Google Calendar, plus their open Google Tasks, as
 * the short lines the System reads (read only: nothing is written back).
 *
 * Goes through the existing `google` edge function with the signed-in
 * session, so the refresh token never leaves the server and nothing new is
 * reachable with the app secret alone. Best effort by design: signed out,
 * Calendar not granted, offline or slow all come back as an empty list, and
 * the System simply asks what is fixed, as it always has.
 *
 * Cached per day in memory (`cacheFresh` says for how long), and a read
 * that is still running is shared: the ◆ button starts the read when it is
 * tapped, and the first message awaits that same read instead of starting
 * another. Opening the sheet again, or the next message, costs no Google
 * round trip.
 */
const TIMEOUT_MS = 6_000;

interface Entry {
  at: number;
  lines: Promise<string[]>;
  /** Set once the read has finished. */
  settled?: string[];
}

const cache = new Map<string, Entry>();

/** Forget every cached day: Google was just connected, so empty reads were wrong. */
export function clearCalendar(): void {
  cache.clear();
}

export function calendarFor(day: string): Promise<string[]> {
  const now = Date.now();
  const hit = cache.get(day);
  if (hit && cacheFresh(hit.at, now, hit.settled)) return hit.lines;

  const entry: Entry = { at: now, lines: read(day) };
  cache.set(day, entry);
  void entry.lines.then((lines) => {
    entry.at = Date.now();
    entry.settled = lines;
  });
  return entry.lines;
}

async function read(day: string): Promise<string[]> {
  if (!client) return [];
  try {
    const { data: session } = await client.auth.getSession();
    if (!session.session) return [];

    // The calendar and the open Google Tasks, read side by side. Either
    // one failing just leaves its lines out.
    const [events, tasks] = await Promise.all([
      items('calendar.list', dayRange(day)),
      items('tasks.list', {}),
    ]);
    return [...calendarLines(events, day), ...taskLines(tasks, day)];
  } catch {
    return [];
  }
}

/** One read through the `google` function: its `items`, or null. */
async function items(op: string, args: Record<string, unknown>): Promise<unknown> {
  if (!client) return null;
  try {
    const call = client.functions.invoke('google', { body: { op, args } });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
    const res = await Promise.race([call, timeout]);
    if (!res || res.error || !res.data) return null;
    return (res.data as { items?: unknown }).items ?? null;
  } catch {
    return null;
  }
}
