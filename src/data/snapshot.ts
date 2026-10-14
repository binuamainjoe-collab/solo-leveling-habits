import { isComplete } from '@/data/completion';
import { isPlannedId, plannedToQuest, type PlannedTask } from '@/data/planner';
import { QUESTS_BY_ID, type QuestDef } from '@/data/quests';

/**
 * One day, summarised for the server.
 *
 * The board and the day log live on the device, so this is how the System
 * learns how the days actually went — the assistant, the planner and the
 * Steward all read these rows. Without it the AI would only ever know what
 * was said to it, never what was done.
 *
 * Pure: no react-native, no store. The shape matches `log-snapshot`.
 */

export interface SnapshotPayload {
  date: string;
  xp_gained: number;
  level: number;
  streak: number;
  quests_done: number;
  quests_total: number;
  planned_done: number;
  planned_total: number;
  plan_accepted_at: string | null;
  mandatory_missed: string[];
}

export interface SnapshotInput {
  date: string;
  /** That day's record: today's live summary, or an archived day. */
  record: { values: Record<string, number>; cleared: number; total: number } | undefined;
  /** The current board, for which mandatory quests were left open. */
  board: QuestDef[];
  plan: { taskIds: string[]; acceptedAt: string } | undefined;
  planned: Record<string, PlannedTask>;
  level: number;
  streak: number;
  /** What a planned task pays over its base XP. */
  plannedMultiplier: number;
}

function questFor(id: string, planned: Record<string, PlannedTask>): QuestDef | undefined {
  if (isPlannedId(id)) return planned[id] ? plannedToQuest(planned[id]) : undefined;
  return QUESTS_BY_ID[id];
}

export function snapshotFor(input: SnapshotInput): SnapshotPayload {
  const values = input.record?.values ?? {};

  let xp = 0;
  for (const [id, value] of Object.entries(values)) {
    const quest = questFor(id, input.planned);
    if (quest && isComplete(quest, value)) {
      xp += Math.round(quest.xp * (isPlannedId(id) ? input.plannedMultiplier : 1));
    }
  }

  const taskIds = input.plan?.taskIds ?? [];
  const plannedDone = taskIds.filter((id) => {
    const quest = questFor(id, input.planned);
    return quest ? isComplete(quest, values[id] ?? 0) : false;
  }).length;

  return {
    date: input.date,
    xp_gained: xp,
    level: input.level,
    streak: input.streak,
    quests_done: input.record?.cleared ?? 0,
    quests_total: input.record?.total ?? 0,
    planned_done: plannedDone,
    planned_total: taskIds.length,
    plan_accepted_at: input.plan?.acceptedAt ?? null,
    mandatory_missed: input.board
      .filter((q) => q.penalty && !isComplete(q, values[q.id] ?? 0))
      .map((q) => q.title)
      .slice(0, 20),
  };
}
