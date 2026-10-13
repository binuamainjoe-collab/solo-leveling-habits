/**
 * A day as a timeline — the shape the planner chat builds and the Planner tab
 * shows.
 *
 * The model proposes; this module decides what is acceptable. Every time is
 * parsed, every block is checked against its neighbours and against the
 * student's waking hours, and anything malformed is either repaired or
 * refused here — never trusted because it came back looking confident.
 *
 * No react-native anywhere in the import graph, so every rule below runs
 * under plain Node (see scratch/timeline-check.ts).
 */

/* ---------------------------------------------------------------- config */

export const DEFAULT_WAKE = '07:00';
export const DEFAULT_SLEEP = '23:00';

/** Where the day's three sections begin. Morning runs from waking. */
export const NOON_STARTS = 12 * 60;
export const EVENING_STARTS = 17 * 60;

/** Genuine priorities per day. More than this and none of them are. */
export const MAX_HIGH_PRIORITY = 3;
/** Shorter than this is not worth a block on a timeline. */
export const MIN_BLOCK_MINUTES = 5;
/** A timeline longer than this stops being readable at a glance. */
export const MAX_BLOCKS = 16;

/**
 * Before this hour, "plan tomorrow" means today. A student planning at 01:00
 * on Tuesday has not slept yet — the day they mean is still Tuesday.
 */
export const DAY_ROLLOVER_HOUR = 4;

/* ----------------------------------------------------------------- types */

export type Period = 'morning' | 'noon' | 'evening';

/**
 * - fixed: something that happens regardless — a class, a shift, an
 *   appointment. Shown on the timeline, never turned into a quest: you do
 *   not earn XP for turning up to a lecture.
 * - task: something the student chose to do. Becomes a one-tap quest.
 * - habit: one of their existing daily quests, placed at a time. Still the
 *   same quest — placing it creates nothing new.
 * - break: deliberate slack. Shown, never scored.
 */
export type BlockKind = 'fixed' | 'task' | 'habit' | 'break';
export type Priority = 'high' | 'normal' | 'low';

export interface PlanBlock {
  id: string;
  kind: BlockKind;
  title: string;
  /** Local "HH:MM". May be after midnight if the day runs late. */
  start: string;
  end: string;
  /** Only meaningful on tasks; everything else is 'normal'. */
  priority: Priority;
  /** Set on habit blocks: which daily quest this places. */
  questId: string | null;
  /**
   * What a habit block is actually for today, when that is more specific
   * than the quest's own name — "Stats exam prep" on a "Study 2 hours"
   * block. Without it, placing a daily quest erased what the student said.
   */
  focus?: string;
}

export interface DraftPlan {
  wake: string;
  sleep: string;
  blocks: PlanBlock[];
  /** One or two plain sentences from The System. */
  note: string;
}

/** What the planner needs to know about a daily quest to place it. */
export interface DailyQuestRef {
  id: string;
  title: string;
  kind: string;
  target: number;
  unit: string;
}

/* ------------------------------------------------------------------ time */

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Accepts "9:05" or "09:05"; rejects everything else. */
export function normaliseTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(HHMM);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Minutes into the student's day, measured from midnight but treating
 * anything before waking as belonging to the night that follows.
 *
 * Without this a bedtime of 01:00 sits "before" a 07:00 wake-up and every
 * late-evening check inverts. With it, 01:00 reads as 25:00 — after the
 * evening, where it actually happens.
 */
export function dayMinutes(hhmm: string, wake: string = DEFAULT_WAKE): number {
  const m = toMinutes(hhmm);
  return m < toMinutes(wake) ? m + 1440 : m;
}

export function blockMinutes(block: PlanBlock, wake: string = DEFAULT_WAKE): number {
  return dayMinutes(block.end, wake) - dayMinutes(block.start, wake);
}

/** Which section of the day a time falls into. */
export function periodOf(hhmm: string, wake: string = DEFAULT_WAKE): Period {
  const m = dayMinutes(hhmm, wake);
  if (m >= 1440) return 'evening'; // past midnight is still last night
  if (m < NOON_STARTS) return 'morning';
  if (m < EVENING_STARTS) return 'noon';
  return 'evening';
}

export const PERIOD_LABEL: Record<Period, string> = {
  morning: 'Morning',
  noon: 'Noon',
  evening: 'Evening',
};

/* ------------------------------------------------------------------ dates */

/** Local YYYY-MM-DD — the same key the day log uses. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The day "plan tomorrow" actually refers to.
 *
 * Before DAY_ROLLOVER_HOUR it is today: the student has not slept, so the
 * day they are about to face is the current calendar date.
 */
export function defaultPlanDate(now: Date = new Date()): string {
  const d = new Date(now);
  if (d.getHours() >= DAY_ROLLOVER_HOUR) d.setDate(d.getDate() + 1);
  return dateKey(d);
}

/** Today's key, respecting the same rollover so the toggle agrees with it. */
export function effectiveToday(now: Date = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < DAY_ROLLOVER_HOUR) d.setDate(d.getDate() - 1);
  return dateKey(d);
}

/** Shift a YYYY-MM-DD key by whole days, in local time. */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return dateKey(dt);
}

/** The current local time as "HH:MM". */
export function clockNow(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function weekdayOf(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long' });
}

export function prettyDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/* ------------------------------------------------------------- ids */

export function newBlockId(): string {
  return `blk:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------------------------------------------------- normalising */

const KINDS: BlockKind[] = ['fixed', 'task', 'habit', 'break'];
const PRIORITIES: Priority[] = ['high', 'normal', 'low'];

export interface Normalised {
  draft: DraftPlan;
  /** Blocks that could not be read at all, by title, with the reason. */
  dropped: string[];
}

/**
 * Turn whatever the model sent back into a well-formed draft.
 *
 * Lenient about shape — a missing priority becomes 'normal', "9:00" becomes
 * "09:00" — but strict about meaning: a block with no readable time, or a
 * habit pointing at a quest the student does not have, is dropped and
 * reported rather than guessed at.
 */
export function normaliseDraft(raw: unknown, dailyQuests: DailyQuestRef[]): Normalised {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const wake = normaliseTime(obj.wake) ?? DEFAULT_WAKE;
  const sleep = normaliseTime(obj.sleep) ?? DEFAULT_SLEEP;
  const known = new Map(dailyQuests.map((q) => [q.id, q]));

  const dropped: string[] = [];
  const blocks: PlanBlock[] = [];
  const list = Array.isArray(obj.blocks) ? obj.blocks : [];

  for (const item of list.slice(0, MAX_BLOCKS * 2)) {
    const b = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 120) : '';
    const start = normaliseTime(b.start);
    const end = normaliseTime(b.end);
    const kind = KINDS.includes(b.kind as BlockKind) ? (b.kind as BlockKind) : 'task';

    if (!start || !end) {
      dropped.push(`${title || 'a block'}: no readable time`);
      continue;
    }

    let questId: string | null = null;
    if (kind === 'habit') {
      const id = typeof b.quest_id === 'string' ? b.quest_id : typeof b.questId === 'string' ? b.questId : '';
      if (!known.has(id)) {
        dropped.push(`${title || id || 'a habit'}: not one of your daily quests`);
        continue;
      }
      questId = id;
    }

    const quest = questId ? known.get(questId) : undefined;
    // The model's own words for a habit, kept when they say more than the
    // quest's name does. Read from `focus` when the model echoes a block
    // back, otherwise from the title it gave.
    const said = typeof b.focus === 'string' && b.focus.trim() ? b.focus.trim().slice(0, 120) : title;
    const focus =
      quest && said && said.toLowerCase() !== quest.title.toLowerCase() ? said : undefined;

    blocks.push({
      id: typeof b.id === 'string' && b.id.startsWith('blk:') ? b.id : newBlockId(),
      kind,
      // A habit keeps its quest's own name, so the timeline and the board
      // never disagree about what it is called; the specifics live in focus.
      title: quest ? quest.title : title || (kind === 'break' ? 'Break' : 'Untitled'),
      start,
      end,
      priority:
        kind === 'task' && PRIORITIES.includes(b.priority as Priority)
          ? (b.priority as Priority)
          : 'normal',
      questId,
      ...(focus ? { focus } : {}),
    });
  }

  blocks.sort((a, b) => dayMinutes(a.start, wake) - dayMinutes(b.start, wake));

  return {
    draft: {
      wake,
      sleep,
      blocks,
      note: typeof obj.note === 'string' ? obj.note.trim().slice(0, 400) : '',
    },
    dropped,
  };
}

/* ------------------------------------------------------------ validating */

export interface Validation {
  ok: boolean;
  /** Things that make the plan unusable. Each is fed back to the model. */
  violations: string[];
  /** Things worth mentioning that do not block saving. */
  warnings: string[];
}

/**
 * Whether a draft can be saved as the day's plan.
 *
 * The model is told all of this in its prompt, but a rule is only a rule if
 * something checks it. Hard violations block finalising and go back to the
 * model to fix; warnings are shown but never block.
 */
export function validateDraft(draft: DraftPlan): Validation {
  const violations: string[] = [];
  const warnings: string[] = [];
  const { wake, sleep, blocks } = draft;

  const wakeM = dayMinutes(wake, wake);
  const sleepM = dayMinutes(sleep, wake);
  if (sleepM <= wakeM) violations.push(`sleep (${sleep}) must come after wake (${wake})`);

  if (blocks.length === 0) violations.push('the plan has no blocks');
  if (blocks.length > MAX_BLOCKS) {
    violations.push(`${blocks.length} blocks is too many — keep it to ${MAX_BLOCKS}`);
  }

  const seenHabits = new Set<string>();
  let high = 0;

  for (const b of blocks) {
    const s = dayMinutes(b.start, wake);
    const e = dayMinutes(b.end, wake);
    const label = `"${b.title}" (${b.start}–${b.end})`;

    if (e <= s) {
      violations.push(`${label} ends before it starts`);
      continue;
    }
    if (e - s < MIN_BLOCK_MINUTES) violations.push(`${label} is shorter than ${MIN_BLOCK_MINUTES} minutes`);
    if (s < wakeM || e > sleepM) violations.push(`${label} is outside your waking hours (${wake}–${sleep})`);

    if (b.kind === 'task' && b.priority === 'high') high++;
    if (b.kind === 'habit' && b.questId) {
      if (seenHabits.has(b.questId)) violations.push(`${label} places the same daily quest twice`);
      seenHabits.add(b.questId);
    }
  }

  if (high > MAX_HIGH_PRIORITY) {
    violations.push(`${high} high-priority tasks — at most ${MAX_HIGH_PRIORITY} can be genuine priorities`);
  }

  // Overlaps, in day order. Sorted locally so validation never depends on
  // the caller having sorted first.
  const ordered = [...blocks]
    .filter((b) => dayMinutes(b.end, wake) > dayMinutes(b.start, wake))
    .sort((a, b) => dayMinutes(a.start, wake) - dayMinutes(b.start, wake));

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    const gap = dayMinutes(cur.start, wake) - dayMinutes(prev.end, wake);
    if (gap < 0) {
      violations.push(`"${prev.title}" (${prev.start}–${prev.end}) overlaps "${cur.title}" (${cur.start}–${cur.end})`);
    } else if (gap === 0 && prev.kind !== 'break' && cur.kind !== 'break') {
      warnings.push(`no buffer between "${prev.title}" and "${cur.title}"`);
    }
  }

  return { ok: violations.length === 0, violations, warnings };
}

/* --------------------------------------------------------------- reading */

export interface PeriodGroup {
  period: Period;
  blocks: PlanBlock[];
}

/** Blocks split into the day's three sections, each in time order. */
export function groupByPeriod(draft: DraftPlan): PeriodGroup[] {
  const order: Period[] = ['morning', 'noon', 'evening'];
  const sorted = [...draft.blocks].sort(
    (a, b) => dayMinutes(a.start, draft.wake) - dayMinutes(b.start, draft.wake),
  );
  return order.map((period) => ({
    period,
    blocks: sorted.filter((b) => periodOf(b.start, draft.wake) === period),
  }));
}

/**
 * Daily quests the timeline did not place — water, steps, anything that is
 * done across the day rather than at a time. Shown as an all-day strip.
 */
export function unplacedQuests(draft: DraftPlan, dailyQuests: DailyQuestRef[]): DailyQuestRef[] {
  const placed = new Set(draft.blocks.filter((b) => b.questId).map((b) => b.questId));
  return dailyQuests.filter((q) => !placed.has(q.id));
}

/** Total planned minutes, excluding breaks — the "how full is this" figure. */
export function busyMinutes(draft: DraftPlan): number {
  return draft.blocks
    .filter((b) => b.kind !== 'break')
    .reduce((n, b) => n + Math.max(0, blockMinutes(b, draft.wake)), 0);
}
