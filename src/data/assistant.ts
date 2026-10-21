import { isComplete } from '@/data/completion';
import { plannedToQuest, taskIdForBlock, type PlannedTask } from '@/data/planner';
import type { QuestDef } from '@/data/quests';
import { addDays, clockNow, defaultPlanDate, weekdayOf, type PlanBlock } from '@/data/timeline';

/**
 * The assistant, client side: what the app tells the System about "right
 * now", and what to do with what comes back.
 *
 * Pure — no react-native, no store — so the context it sends can be tested
 * in plain Node. The server adds everything it already knows (goals,
 * memories, recent days); this is only what the phone alone can see.
 */

/** The one button a reply can offer. Nothing happens until it is tapped. */
export type AssistantAction =
  | 'none'
  | 'plan_today'
  | 'plan_tomorrow'
  | 'open_planner'
  | 'open_goals'
  | 'open_quests';

export interface AssistantMessage {
  role: 'user' | 'model';
  text: string;
  /** Only on a model reply from this session: what it chose to remember. */
  remembered?: string[];
  /** Only on a model reply from this session. */
  action?: AssistantAction;
  /** Only on a model reply from this session: what it changed, as lines. */
  applied?: string[];
  /** What it tried to change and the app refused, with the reason. */
  refused?: string[];
  /** Whether this reply's changes can still be taken back (this session only). */
  canUndo?: boolean;
  /** Whether the changes on this reply were undone. */
  undone?: boolean;
  /** A user message that was spoken rather than typed. */
  voice?: boolean;
}

export interface AssistantReply {
  reply: string;
  suggestions: string[];
  action: AssistantAction;
  remembered: { kind: string; content: string }[];
  /** Changes the System proposes; vetted by `vetChanges` before anything happens. */
  changes: unknown[];
  /** For a spoken message: what the System heard. */
  heard: string | null;
}

/** What the phone knows about right now, in the shape the server reads. */
export interface AssistantNow {
  date: string;
  weekday: string;
  time: string;
  level: number;
  rank: string;
  xp: number;
  streak: number;
  wake: string | null;
  sleep: string | null;
  planningHour: string;
  board: { done: number; total: number; open: string[]; mandatoryOpen: string[] };
  /**
   * Every quest on the board with its id and progress, so the System can
   * name exactly what to change. "id — title — 10/100 reps — counter".
   */
  quests: string[];
  /** Catalogue quests not on the board, which the System can add. "id — title". */
  catalog: string[];
  today: {
    blocks: { start: string; end: string; kind: string; title: string; focus?: string; done: boolean }[];
    note: string;
  } | null;
  tomorrow: { planned: boolean };
  /** Today's Google Calendar events, "09:00–10:30 Lecture". Empty when not connected. */
  calendar: string[];
  screen: string;
}

/** The slice of progress the builder reads. Structural, so the store is not imported. */
export interface NowInput {
  date: string;
  xp: number;
  streak: number;
  values: Record<string, number>;
  settings: { wake?: string; sleep?: string; briefingTime: string };
  plans: Record<string, { note: string; timeline?: { wake: string; sleep: string; blocks: PlanBlock[] } } | undefined>;
  planned: Record<string, PlannedTask>;
  /** Today's board, already resolved to quest definitions. */
  board: QuestDef[];
  /** The whole catalogue, for what can be added. */
  catalog?: QuestDef[];
  level: number;
  rank: string;
  screen: string;
  /** Today's calendar lines, from src/lib/calendar.ts. */
  calendar?: string[];
  now?: Date;
}

/** Whether a timeline block counts as done, from today's values. */
export function blockIsDone(
  block: PlanBlock,
  values: Record<string, number>,
  questById: (id: string) => QuestDef | undefined,
): boolean {
  if (block.kind === 'task') return (values[taskIdForBlock(block)] ?? 0) >= 1;
  if (block.kind === 'habit' && block.questId) {
    const q = questById(block.questId);
    return q ? isComplete(q, values[q.id] ?? 0) : false;
  }
  return false;
}

export function buildNow(input: NowInput): AssistantNow {
  const byId = new Map(input.board.map((q) => [q.id, q] as const));
  const questById = (id: string) =>
    byId.get(id) ?? (input.planned[id] ? plannedToQuest(input.planned[id]) : undefined);

  const open = input.board.filter((q) => !isComplete(q, input.values[q.id] ?? 0));
  const plan = input.plans[input.date];

  return {
    date: input.date,
    weekday: weekdayOf(input.date),
    time: clockNow(input.now),
    level: input.level,
    rank: input.rank,
    xp: input.xp,
    streak: input.streak,
    wake: input.settings.wake ?? null,
    sleep: input.settings.sleep ?? null,
    planningHour: input.settings.briefingTime,
    board: {
      done: input.board.length - open.length,
      total: input.board.length,
      open: open.slice(0, 20).map((q) => q.title),
      mandatoryOpen: open.filter((q) => q.penalty).slice(0, 12).map((q) => q.title),
    },
    quests: input.board
      .filter((q) => q.category !== 'planned')
      .slice(0, 30)
      .map((q) => {
        const v = input.values[q.id] ?? 0;
        const progress = q.kind === 'binary' || q.kind === 'window' ? (v >= q.target ? 'done' : 'not done') : `${v}/${q.target} ${q.unit}`;
        return `${q.id} — ${q.title} — ${progress} — ${q.kind}${q.penalty ? ' — mandatory' : ''}`;
      }),
    catalog: (input.catalog ?? [])
      .filter((q) => !byId.has(q.id))
      .map((q) => `${q.id} — ${q.title}`),
    today: plan?.timeline
      ? {
          blocks: plan.timeline.blocks.slice(0, 16).map((b) => ({
            start: b.start,
            end: b.end,
            kind: b.kind,
            title: b.title,
            ...(b.focus ? { focus: b.focus } : {}),
            done: blockIsDone(b, input.values, questById),
          })),
          note: plan.note,
        }
      : null,
    tomorrow: { planned: Boolean(input.plans[addDays(input.date, 1)]) },
    calendar: (input.calendar ?? []).slice(0, 18),
    screen: input.screen,
  };
}

/** Where an action leads. `date` is the planner-chat date when planning. */
export function actionTarget(
  action: AssistantAction,
  today: string,
  now: Date = new Date(),
): { pathname: string; params?: { date: string } } | null {
  switch (action) {
    case 'plan_today':
      return { pathname: '/planner-chat', params: { date: today } };
    case 'plan_tomorrow': {
      // Before 04:00, "tomorrow" is the day the student is about to face —
      // which the store still calls today.
      const date = defaultPlanDate(now) === today ? today : addDays(today, 1);
      return { pathname: '/planner-chat', params: { date } };
    }
    case 'open_planner':
      return { pathname: '/planner' };
    case 'open_goals':
      return { pathname: '/goal' };
    case 'open_quests':
      return { pathname: '/' };
    default:
      return null;
  }
}

export const ACTION_LABEL: Record<AssistantAction, string> = {
  none: '',
  plan_today: 'Plan today',
  plan_tomorrow: 'Plan tomorrow',
  open_planner: 'Open the planner',
  open_goals: 'Open goals',
  open_quests: 'Open quests',
};

/**
 * The first thing the System says when the conversation is empty. Written
 * locally, so opening the assistant costs nothing until something is asked.
 */
export function greeting(now: Date, tomorrowPlanned: boolean): { text: string; suggestions: string[] } {
  const h = now.getHours();
  if (h < 4 || h >= 20) {
    return {
      text: tomorrowPlanned
        ? 'Tomorrow is planned. Anything left on your mind for today?'
        : 'Evening, Player. Tomorrow has no plan yet.',
      suggestions: tomorrowPlanned ? ["What's left today?", 'How did today go?'] : ['Plan tomorrow', "What's left today?", 'How did today go?'],
    };
  }
  if (h < 12) {
    return { text: 'Morning, Player. Ask me what is next, or tell me what is on your mind.', suggestions: ["What's first?", "I'm stuck", 'How am I doing?'] };
  }
  return { text: 'The System is listening.', suggestions: ["What's next?", "I'm stuck", 'How am I doing?'] };
}
