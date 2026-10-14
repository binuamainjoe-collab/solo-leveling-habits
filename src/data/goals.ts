/**
 * Long-term goals — the second half of the app.
 *
 * A daily habit is something you repeat; a goal is something you finish. The
 * two are kept apart deliberately: the quest board stays exactly what it was,
 * and goals get their own section with their own shadows working on them.
 *
 * Several goals can be held at once, but exactly one is the FOCUS. The week
 * is planned around the focus and the shadows research it; the others still
 * get a small step when a day has room. Holding three goals is fine —
 * giving three goals equal weight every day is how all three get dropped.
 *
 * Goals and findings live server-side rather than in `ProgressState`: they are
 * written by edge functions, not by the device, so the server is the only
 * place that can be authoritative about them.
 *
 * No react-native in this module's import graph, so its rules run under Node.
 */

export interface Goal {
  id: string;
  title: string;
  active: boolean;
  /** The one goal the week is planned around. */
  focus: boolean;
  /** YYYY-MM-DD, or null for an open-ended goal. */
  deadline: string | null;
  createdAt: string;
}

/** A goal in the shape the client sends when creating one. */
export interface GoalDraft {
  title: string;
  deadline?: string | null;
}

export const MAX_GOAL_TITLE = 160;
/** Matches the server. More than this and "focus" stops meaning anything. */
export const MAX_ACTIVE_GOALS = 6;

/**
 * A goal has to be something an agent can actually research.
 *
 * Rejecting the empty and the absurd here means the edge function never burns
 * one of thirty daily calls on " " or on a pasted essay.
 */
export function validateGoalTitle(raw: string): { ok: true; title: string } | { ok: false; error: string } {
  const title = raw.trim().replace(/\s+/g, ' ');
  if (title.length === 0) return { ok: false, error: 'Give the goal a name first.' };
  if (title.length < 4) return { ok: false, error: 'That is too short for the System to work with.' };
  if (title.length > MAX_GOAL_TITLE) {
    return { ok: false, error: `Keep it under ${MAX_GOAL_TITLE} characters — a goal, not a plan.` };
  }
  return { ok: true, title };
}

/**
 * A deadline as typed: empty is fine (open-ended), otherwise it must be a
 * real YYYY-MM-DD date that is not already in the past.
 */
export function validateDeadline(
  raw: string,
  today: string,
): { ok: true; deadline: string | null } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: true, deadline: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, error: 'Write the deadline as YYYY-MM-DD.' };
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    return { ok: false, error: 'That deadline is not a real date.' };
  }
  if (value < today) return { ok: false, error: 'That deadline has already passed.' };
  return { ok: true, deadline: value };
}

/** Whole days from `today` to `deadline`; negative once it has passed. */
export function daysLeft(deadline: string, today: string): number {
  const a = Date.parse(`${deadline}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

/** "12 days left", "due today", "3 days over". */
export function deadlineLabel(deadline: string, today: string): string {
  const n = daysLeft(deadline, today);
  if (n === 0) return 'due today';
  if (n === 1) return '1 day left';
  if (n > 1) return `${n} days left`;
  return n === -1 ? '1 day over' : `${-n} days over`;
}

/** The focus first, then the rest oldest-first — the order the screen shows. */
export function orderGoals(goals: Goal[]): Goal[] {
  return [...goals]
    .filter((g) => g.active)
    .sort((a, b) => Number(b.focus) - Number(a.focus) || a.createdAt.localeCompare(b.createdAt));
}

/* ------------------------------------------------------------------ memory */

export type MemoryKind = 'fact' | 'preference' | 'commitment' | 'pattern';

/** Something the System has learned and keeps between conversations. */
export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  goalId: string | null;
  createdAt: string;
}

export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  fact: 'Fact',
  preference: 'Preference',
  commitment: 'Commitment',
  pattern: 'Pattern',
};
