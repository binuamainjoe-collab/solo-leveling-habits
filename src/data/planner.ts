import type { QuestDef } from '@/data/quests';
import {
  blockMinutes,
  periodOf,
  PERIOD_LABEL,
  type DailyQuestRef,
  type DraftPlan,
  type PlanBlock,
} from '@/data/timeline';

/**
 * The planner: a conversation that ends in a day's timeline.
 *
 * A planned task is not one of the catalogued quests — it is invented in the
 * chat for one particular day. To keep the rest of the app working
 * unchanged, each one is projected into a `QuestDef`, so cards, completion,
 * streaks, the calendar and the day log all treat it like any other quest.
 *
 * No react-native in this module's import graph; it runs under Node.
 */

/* ----------------------------------------------------------------- tasks */

export interface PlannedTask {
  /** Always prefixed "planned:" — that prefix is how the store tells them apart. */
  id: string;
  title: string;
  minutes: number;
  /** 1 is the most important. */
  priority: number;
  /** "Morning" / "Noon" / "Evening" on v2 tasks; free text on v1. */
  window: string;
  /**
   * Projection version. Absent on tasks from the first planner, which were
   * minutes-steppers; 2 on timeline tasks, which are one tap.
   *
   * Versioned rather than migrated because a day in the history log must
   * read exactly as it did on the day. Changing how an old task projects
   * would silently re-score history — a 15-of-40-minute task that was
   * incomplete would suddenly read as done.
   */
  v?: 2;
  /** Local "HH:MM", v2 only. */
  start?: string;
  end?: string;
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
 * Roughly two and a half XP a minute, bounded so one enormous task cannot
 * out-earn a whole day of catalogued quests.
 */
function xpForMinutes(minutes: number): number {
  return Math.min(300, Math.max(30, Math.round(minutes * 2.5)));
}

/**
 * Project a planned task into the shape the rest of the app understands.
 *
 * Pure and deterministic: the same task always yields the same quest, so a
 * day replayed out of the history log reads exactly as it did on the day.
 */
export function plannedToQuest(task: PlannedTask): QuestDef {
  const minutes = Math.max(1, Math.round(task.minutes));
  const glyph = PRIORITY_GLYPH[Math.min(PRIORITY_GLYPH.length - 1, Math.max(0, task.priority - 1))];

  if (task.v === 2) {
    // One tap: done or not done. Logging minutes against "Call mum" was a
    // chore that taught nothing.
    return {
      id: task.id,
      title: task.title,
      objective: task.start && task.end ? `${task.start}–${task.end} · ${task.window}` : task.window,
      category: 'planned',
      kind: 'binary',
      glyph,
      target: 1,
      unit: 'check',
      rank: rankForMinutes(minutes),
      xp: xpForMinutes(minutes),
      stats: { PER: 1 },
      cadence: 'daily',
      tags: ['planned'],
    };
  }

  // v1 — kept exactly as it was, so old days still score the same.
  return {
    id: task.id,
    title: task.title,
    objective: `${task.window} · about ${minutes} min`,
    category: 'planned',
    kind: 'duration',
    glyph,
    target: minutes,
    unit: 'min',
    step: stepForMinutes(minutes),
    rank: rankForMinutes(minutes),
    xp: xpForMinutes(minutes),
    stats: { PER: 1 },
    cadence: 'daily',
    tags: ['planned'],
  };
}

const PRIORITY_RANK: Record<PlanBlock['priority'], number> = { high: 1, normal: 2, low: 3 };

/**
 * The task blocks of a finalised timeline, as quests.
 *
 * Only `task` blocks become quests. Fixed commitments are shown but never
 * scored — nobody should earn XP for attending a lecture — and habit blocks
 * point at quests that already exist.
 */
export function blocksToTasks(draft: DraftPlan): PlannedTask[] {
  return draft.blocks
    .filter((b) => b.kind === 'task')
    .map((b) => ({
      // Reuse the block's own suffix so a task and the block it came from
      // can always be matched up again.
      id: `${PLANNED_PREFIX}${b.id.replace(/^blk:/, '')}`,
      title: b.title,
      minutes: Math.max(1, blockMinutes(b, draft.wake)),
      priority: PRIORITY_RANK[b.priority],
      window: PERIOD_LABEL[periodOf(b.start, draft.wake)],
      v: 2 as const,
      start: b.start,
      end: b.end,
    }));
}

/** The quest id a task block became, for linking the timeline to the board. */
export function taskIdForBlock(block: PlanBlock): string {
  return `${PLANNED_PREFIX}${block.id.replace(/^blk:/, '')}`;
}

/* --------------------------------------------------------- conversation */

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

/** Everything the model is told about the student and the day. */
export interface PlannerContext {
  /** The day being planned, YYYY-MM-DD. */
  date: string;
  weekday: string;
  /** The real current date and time, so "tonight" and "tomorrow" resolve. */
  today: string;
  nowTime: string;
  /** Remembered from the last plan, or null to make the model ask. */
  wake: string | null;
  sleep: string | null;
  goals: string[];
  studyMethods: string[];
  dailyQuests: DailyQuestRef[];
  /** The draft as it currently stands, so every turn edits the same plan. */
  draft: DraftPlan | null;
}

/** One reply from the planner, before the draft is normalised. */
export interface PlannerReply {
  reply: string;
  suggestions: string[];
  /** The model heard "this is it" / "finalize" / "lock it in". */
  wantsFinalize: boolean;
  /** Raw, untrusted — run it through normaliseDraft before use. */
  draft: unknown;
}

/* ------------------------------------------------------------- session */

/**
 * A planning conversation in progress, saved so that leaving the chat —
 * a phone call, a notification, switching apps — does not cost the student
 * everything they said. One at a time; local only, never synced.
 */
export interface PlannerSession {
  date: string;
  messages: ChatMessage[];
  /** The tap-to-send replies offered after the last System turn. */
  suggestions: string[];
  draft: DraftPlan | null;
  updatedAt: string;
}

/**
 * Whether a saved session is worth resuming for this date.
 *
 * Only when it is for the same day and the student actually said something:
 * a session that is just the opening greeting has nothing in it to lose.
 */
export function isResumable(session: PlannerSession | null, date: string): boolean {
  return !!session && session.date === date && session.messages.some((m) => m.role === 'user');
}

/** Sessions for a day that has already passed are clutter. */
export function isStale(session: PlannerSession | null, today: string): boolean {
  return !!session && session.date < today;
}

export interface Opening {
  text: string;
  suggestions: string[];
}

/**
 * The System's first line, written locally rather than asked of the model.
 *
 * It costs nothing, appears instantly, and is always the same question: what
 * is already fixed. Spending a model call and several seconds on a greeting
 * would be the slowest possible start to a feature meant to lower friction.
 */
export function openingLine(date: string, today: string, weekday: string, existing: boolean): Opening {
  if (existing) {
    return {
      text: `You already have a plan for ${date === today ? 'today' : weekday}. What do you want to change?`,
      suggestions: ['Move something', 'Add a task', 'It is too much', 'Start over'],
    };
  }
  return {
    text:
      date === today
        ? `Planning today. What's already fixed — classes, work, appointments?`
        : `Planning ${weekday}. What's already fixed that day — classes, work, appointments?`,
    suggestions: ['Uni / classes', 'Work shift', 'Nothing fixed'],
  };
}

/* ----------------------------------------------------------- the call */

/**
 * Where the edge function lives, and the shared secret it checks.
 *
 * `EXPO_PUBLIC_*` values are inlined into the bundle at build time, so
 * APP_SECRET is readable by anyone who opens devtools on the deployed site.
 * That is accepted: it keeps casual traffic off the endpoint, backed by a
 * hard daily cap on the server. The Gemini key never leaves the function.
 */
const PLANNER_URL = process.env.EXPO_PUBLIC_PLANNER_URL ?? '';
const APP_SECRET = process.env.EXPO_PUBLIC_APP_SECRET ?? '';

export function plannerConfigured(): boolean {
  return PLANNER_URL.length > 0 && APP_SECRET.length > 0;
}

export interface PlannerResult {
  ok: boolean;
  data?: PlannerReply;
  /** Plain language, shown as-is. */
  error?: string;
}

/**
 * Send the conversation so far and get The System's next turn.
 *
 * `repair` carries validation failures from a draft the student tried to
 * finalise, so the model fixes exactly what was wrong rather than starting
 * over.
 */
export async function sendPlannerMessage(
  messages: ChatMessage[],
  context: PlannerContext,
  repair: string[] = [],
): Promise<PlannerResult> {
  if (!plannerConfigured()) {
    return { ok: false, error: 'The planner is not configured yet.' };
  }

  // A stalled connection would otherwise leave the typing indicator running
  // forever. A planner reply takes a few seconds; forty-five is a dead line.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 45_000);

  try {
    const res = await fetch(PLANNER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-secret': APP_SECRET },
      body: JSON.stringify({ messages, context, repair }),
      signal: abort.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      let message = `The System could not reach the planner (${res.status}).`;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // A non-JSON body means something upstream failed; keep the generic line.
      }
      return { ok: false, error: message };
    }

    const data = JSON.parse(text) as {
      reply?: unknown;
      suggestions?: unknown;
      wants_finalize?: unknown;
      draft?: unknown;
    };

    const reply = typeof data.reply === 'string' ? data.reply.trim() : '';
    if (!reply) return { ok: false, error: 'The System went quiet. Try saying that again.' };

    return {
      ok: true,
      data: {
        reply,
        suggestions: Array.isArray(data.suggestions)
          ? data.suggestions
              .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
              .map((s) => s.trim().slice(0, 60))
              .slice(0, 4)
          : [],
        wantsFinalize: data.wants_finalize === true,
        draft: data.draft,
      },
    };
  } catch (err) {
    if (abort.signal.aborted) {
      return { ok: false, error: 'The System took too long to answer. Try again.' };
    }
    return {
      ok: false,
      error: `The System could not reach the planner. ${err instanceof Error ? err.message : ''}`.trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}
