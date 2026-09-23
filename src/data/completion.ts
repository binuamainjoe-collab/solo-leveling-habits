import type { QuestDef } from '@/data/quests';

/**
 * Pure completion and clock rules. Free of React and react-native imports so
 * it can be unit-tested in plain Node — the store re-exports everything here.
 */

/** Quests where the target is a cap you stay under, not a bar you clear. */
export function isCeilingQuest(quest: QuestDef): boolean {
  return quest.kind === 'value' && ['calories', 'screentime', 'socialmedia'].includes(quest.id);
}

export function isComplete(quest: QuestDef, value: number): boolean {
  if (isCeilingQuest(quest)) return value > 0 && value <= quest.target;
  return value >= quest.target;
}

/* --------------------------------------------------------- clock windows */

export interface WindowState {
  /** Whether the quest can be logged right now. */
  open: boolean;
  /** Short reason, shown on the card. */
  label: string;
}

/** Minutes past local midnight for an "HH:MM" string. */
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Whether a `window` quest's clock window is open.
 *
 * `before: "23:00"` — open from midnight until 23:00 ("in bed by 23:00").
 * `after:  "20:00"` — open from 20:00 until midnight ("no food after 20:00"),
 *                     because you can only vouch for it once the hour passed.
 *
 * This gates the *action*, never `isComplete`. Completion has to stay a pure
 * function of the stored value, because `recompute` replays it across every
 * archived day — if it consulted the clock, yesterday's history would change
 * meaning as today wore on.
 */
export function windowState(quest: QuestDef, now = new Date()): WindowState {
  if (quest.kind !== 'window' || !quest.window) return { open: true, label: '' };

  const mins = now.getHours() * 60 + now.getMinutes();
  const { before, after } = quest.window;

  if (before !== undefined && mins >= minutesOf(before)) {
    return { open: false, label: `Window closed at ${before}` };
  }
  if (after !== undefined && mins < minutesOf(after)) {
    return { open: false, label: `Opens at ${after}` };
  }
  return {
    open: true,
    label: before !== undefined ? `Until ${before}` : `Since ${after}`,
  };
}
