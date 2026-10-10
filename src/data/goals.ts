/**
 * Long-term goals — the second half of the app.
 *
 * A daily habit is something you repeat; a goal is something you finish. The
 * two are kept apart deliberately: the quest board stays exactly what it was,
 * and the goal gets its own section with its own shadows working on it.
 *
 * Exactly one goal is active at a time. That is a design choice, not a
 * limitation — three simultaneous long-term goals is the reliable way to
 * abandon all three.
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
  createdAt: string;
}

/** A goal in the shape the client sends when creating one. */
export interface GoalDraft {
  title: string;
}

export const MAX_GOAL_TITLE = 160;

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
