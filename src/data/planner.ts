import type { QuestDef } from '@/data/quests';

/**
 * The AI "Daily Quest Briefing" planner.
 *
 * A planned task is not one of the 106 catalogued quests — it is invented each
 * night for the day ahead. To keep the rest of the app working unchanged, each
 * one is projected into a `QuestDef` so cards, completion, streaks, the
 * calendar and the day log all treat it like any other quest.
 */

/** One task as the model returns it, matching the function's responseSchema. */
export interface PlannedTask {
  /** Always prefixed "planned:" — that prefix is how the store tells them apart. */
  id: string;
  title: string;
  minutes: number;
  /** 1 is the most important. The prompt caps genuine priorities at three. */
  priority: number;
  /** Free text from the model: "Morning", "After lunch", "Evening". */
  window: string;
}

export interface Plan {
  /** The day this plan is FOR — tomorrow, when it is written. */
  date: string;
  tasks: PlannedTask[];
  /** The model's closing line; gentle by instruction. */
  note: string;
  /** ISO timestamp, or null while it is still a draft. */
  acceptedAt: string | null;
}

/** One turn of the refining conversation. Sent back on every call. */
export interface BriefingTurn {
  role: 'user' | 'model';
  text: string;
}

export const PLANNED_PREFIX = 'planned:';

export function isPlannedId(id: string): boolean {
  return id.startsWith(PLANNED_PREFIX);
}

export function newTaskId(): string {
  return `${PLANNED_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------- projection */

/**
 * Longer work earns a higher rank, which drives the difficulty label and the
 * reward. Deliberately gentle at the short end: a 10-minute task should not be
 * dressed up as a trial.
 */
function rankForMinutes(minutes: number): QuestDef['rank'] {
  if (minutes >= 90) return 'A';
  if (minutes >= 60) return 'B';
  if (minutes >= 30) return 'C';
  if (minutes >= 15) return 'D';
  return 'E';
}

/** A step that reaches the target in a handful of presses, never dozens. */
function stepForMinutes(minutes: number): number {
  if (minutes >= 90) return 15;
  if (minutes >= 40) return 10;
  if (minutes >= 20) return 5;
  return Math.max(1, Math.round(minutes / 4));
}

const PRIORITY_GLYPH = ['◈', '◆', '◇'];

/**
 * Project a planned task into the shape the rest of the app understands.
 *
 * Pure and deterministic: the same task always yields the same quest, so a
 * day replayed out of the history log reads exactly as it did on the day.
 */
export function plannedToQuest(task: PlannedTask): QuestDef {
  const minutes = Math.max(1, Math.round(task.minutes));
  return {
    id: task.id,
    title: task.title,
    objective: `${task.window} · about ${minutes} min`,
    category: 'planned',
    kind: 'duration',
    glyph: PRIORITY_GLYPH[Math.min(PRIORITY_GLYPH.length - 1, Math.max(0, task.priority - 1))],
    target: minutes,
    unit: 'min',
    step: stepForMinutes(minutes),
    rank: rankForMinutes(minutes),
    // Roughly two and a half XP a minute, bounded so one enormous task cannot
    // out-earn a whole day of catalogued quests.
    xp: Math.min(300, Math.max(30, Math.round(minutes * 2.5))),
    stats: { PER: 1 },
    cadence: 'daily',
    tags: ['planned'],
  };
}

/* ----------------------------------------------------------- the API call */

/**
 * Where the edge function lives, and the shared secret it checks.
 *
 * `EXPO_PUBLIC_*` values are inlined into the bundle at build time, so
 * APP_SECRET is readable by anyone who opens devtools on the deployed site.
 * That is accepted here: it is a speed bump that keeps casual traffic off the
 * endpoint, backed by a hard global cap on the server. The Gemini key is the
 * thing that actually matters, and it never leaves the function.
 */
const PLANNER_URL = process.env.EXPO_PUBLIC_PLANNER_URL ?? '';
const APP_SECRET = process.env.EXPO_PUBLIC_APP_SECRET ?? '';

export interface PlannerResult {
  ok: boolean;
  tasks?: PlannedTask[];
  note?: string;
  /** Plain language, shown to the user as-is. */
  error?: string;
}

export function plannerConfigured(): boolean {
  return PLANNER_URL.length > 0 && APP_SECRET.length > 0;
}

export async function requestPlan(history: BriefingTurn[]): Promise<PlannerResult> {
  if (!plannerConfigured()) {
    return { ok: false, error: 'The planner is not configured yet. Add its URL and secret, then rebuild.' };
  }

  try {
    const res = await fetch(PLANNER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-secret': APP_SECRET },
      body: JSON.stringify({ history }),
    });

    const text = await res.text();
    if (!res.ok) {
      // The function answers errors in plain language; fall back if it did not.
      let message = `The System could not reach the planner (${res.status}).`;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // A non-JSON body means something upstream failed; keep the generic line.
      }
      return { ok: false, error: message };
    }

    const data = JSON.parse(text) as { tasks?: unknown; note?: unknown };
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    if (tasks.length === 0) {
      return { ok: false, error: 'The planner came back empty. Try describing tomorrow again.' };
    }

    return {
      ok: true,
      // Ids are assigned here, not by the model: it has no reason to invent
      // stable ones, and the store keys history off them.
      tasks: tasks.map((raw) => {
        const t = raw as Partial<PlannedTask>;
        return {
          id: newTaskId(),
          title: String(t.title ?? 'Untitled task'),
          minutes: Math.max(1, Math.round(Number(t.minutes) || 15)),
          priority: Math.max(1, Math.round(Number(t.priority) || 3)),
          window: String(t.window ?? 'Anytime'),
        };
      }),
      note: typeof data.note === 'string' ? data.note : '',
    };
  } catch (err) {
    return {
      ok: false,
      error: `The System could not reach the planner. ${err instanceof Error ? err.message : ''}`.trim(),
    };
  }
}
