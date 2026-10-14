import { taskIdForBlock } from '@/data/planner';
import { addDays, dayMinutes, type PlanBlock } from '@/data/timeline';

/**
 * Which notifications should be waiting on the phone, worked out from the
 * plan — pure, so the rules can be tested without a device.
 *
 * Three kinds, and only these: a morning briefing at wake time, the planning
 * nudge at the planning hour when tomorrow has no plan, and a gentle check
 * when a planned task's time has passed and it is still open. Each fires at
 * a moment the student chose (wake, the planning hour, their own plan) —
 * never at random — and nothing is ever sent between sleep and wake.
 *
 * The whole set is recomputed and rescheduled whenever the plan or the
 * progress changes, so ticking a task cancels its check-in.
 */

export type ReminderKind = 'morning' | 'planning' | 'drift';

export interface ReminderSpec {
  /** Stable, prefixed with "sys-" so the System only ever cancels its own. */
  id: string;
  kind: ReminderKind;
  at: Date;
  title: string;
  body: string;
  /** Where tapping it goes. */
  url: string;
}

export const REMINDER_PREFIX = 'sys-';
const DEFAULT_WAKE = '07:30';
const DEFAULT_SLEEP = '23:00';
/** How long after a task's end before asking about it. */
const DRIFT_GRACE_MIN = 10;
/** More than this many check-ins in a day stops being help. */
const MAX_DRIFT_PER_DAY = 4;

export interface ReminderSettings {
  wake?: string;
  sleep?: string;
  briefingTime: string;
  remindMorning?: boolean;
  remindPlanning?: boolean;
  remindDrift?: boolean;
}

export interface ReminderInput {
  now: Date;
  /** The store's today. */
  today: string;
  settings: ReminderSettings;
  plans: Record<string, { timeline?: { wake: string; sleep: string; blocks: PlanBlock[] } } | undefined>;
  /** Today's progress values. Tomorrow has none yet, so every task there is open. */
  values: Record<string, number>;
}

/** A local Date for a day and a clock time, past midnight carried over. */
export function localAt(date: string, hhmm: string, wake: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 0, dayMinutes(hhmm, wake));
}

export function planReminders(input: ReminderInput): ReminderSpec[] {
  const { now, today, settings, plans, values } = input;
  const out: ReminderSpec[] = [];
  const soon = now.getTime() + 60_000;
  const days = [today, addDays(today, 1)];

  for (const day of days) {
    const plan = plans[day]?.timeline;
    const wake = plan?.wake ?? settings.wake ?? DEFAULT_WAKE;
    const sleep = plan?.sleep ?? settings.sleep ?? DEFAULT_SLEEP;
    const bedtime = localAt(day, sleep, wake).getTime();

    // ------------------------------------------------- morning briefing
    if (settings.remindMorning !== false) {
      const when = localAt(day, wake, wake);
      if (when.getTime() > soon) {
        const first = plan?.blocks.find((b) => b.kind !== 'break');
        const tasks = plan ? plan.blocks.filter((b) => b.kind === 'task').length : 0;
        out.push({
          id: `${REMINDER_PREFIX}morning-${day}`,
          kind: 'morning',
          at: when,
          title: '◆ The System',
          body: first
            ? `First up: ${first.title} at ${first.start}.${tasks ? ` ${tasks} ${tasks === 1 ? 'task' : 'tasks'} planned.` : ''}`
            : 'No plan for today yet. Open the System and it will give you one next step.',
          url: plan ? '/planner' : '/',
        });
      }
    }

    // ---------------------------------------------------- planning hour
    const next = addDays(day, 1);
    if (settings.remindPlanning !== false && !plans[next]) {
      const when = localAt(day, settings.briefingTime, wake);
      if (when.getTime() > soon) {
        out.push({
          id: `${REMINDER_PREFIX}plan-${day}`,
          kind: 'planning',
          at: when,
          title: '◆ Plan tomorrow?',
          body: 'A few questions and tomorrow is laid out. About two minutes.',
          url: `/planner-chat?date=${next}`,
        });
      }
    }

    // ------------------------------------------------ open-task check-ins
    if (settings.remindDrift !== false && plan) {
      const open = plan.blocks.filter(
        (b) => b.kind === 'task' && (day !== today || (values[taskIdForBlock(b)] ?? 0) < 1),
      );
      let added = 0;
      for (const b of open) {
        if (added >= MAX_DRIFT_PER_DAY) break;
        const when = new Date(localAt(day, b.end, wake).getTime() + DRIFT_GRACE_MIN * 60_000);
        // Quiet hours: nothing after bedtime, and nothing already due.
        if (when.getTime() <= soon || when.getTime() > bedtime) continue;
        out.push({
          id: `${REMINDER_PREFIX}drift-${day}-${b.id.replace(/[^a-zA-Z0-9]/g, '')}`,
          kind: 'drift',
          at: when,
          title: '◆ Still open',
          body: `${b.title} — move it to later, or start with two minutes?`,
          url: '/planner',
        });
        added++;
      }
    }
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}
