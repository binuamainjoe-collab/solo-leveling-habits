/**
 * The last change to a quest, kept so a two-finger swipe can take it back.
 * Only one step, and only for a few minutes: an undo is for "that was a
 * mistake", not for rewinding a day. Every quest card writes here through
 * the same handlers its buttons, swipes and ring menu use.
 */

export interface QuestChange {
  questId: string;
  title: string;
  before: number;
  after: number;
  at: number;
}

/** After this long a change is part of the day, not a slip. */
const FRESH_MS = 5 * 60 * 1000;

let last: QuestChange | null = null;

export function rememberChange(change: Omit<QuestChange, 'at'>): void {
  if (change.before === change.after) return;
  last = { ...change, at: Date.now() };
}

/** The change to take back, if it is still fresh. Taking it forgets it. */
export function takeLastChange(now = Date.now()): QuestChange | null {
  const c = last;
  last = null;
  return c && now - c.at <= FRESH_MS ? c : null;
}
