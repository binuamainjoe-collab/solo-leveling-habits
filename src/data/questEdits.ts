import { isCeilingQuest } from '@/data/completion';
import { validateDeadline, validateGoalTitle } from '@/data/goals';
import { cleanValue, findField, valueOf, withField, type LifeProfile } from '@/data/lifeProfile';
import type { QuestDef } from '@/data/quests';
import { normaliseTime } from '@/data/timeline';

/**
 * The System changing the app on request — the rules, with no I/O.
 *
 * The model proposes changes; this module decides which of them are real,
 * safe and within bounds, and describes each one in a line the Player can
 * read. Applying them (and undoing them) is the screen's job.
 *
 * Pure: no react-native, no store.
 */

/* ------------------------------------------------------- quest overrides */

/** A Player's own version of a catalogue quest: easier, harder, renamed. */
export interface QuestOverride {
  target: number;
  title?: string;
  objective?: string;
}

/** Kinds whose target is a number you work towards. */
const TUNABLE = new Set(['counter', 'duration', 'value']);

export function isTunable(q: QuestDef): boolean {
  return TUNABLE.has(q.kind);
}

/** Lowest and highest target the System will set for a quest. */
export function targetBounds(q: QuestDef): { min: number; max: number } {
  const min = q.kind === 'duration' ? 5 : 1;
  return { min, max: Math.max(min, q.target * 5) };
}

/**
 * What a quest pays at a new target. Scaled by the square root of the
 * change, so an easier start still pays enough to matter — cutting 100
 * push-ups to 15 keeps 39% of the XP, not 15% — while a target of 1 can
 * never be farmed for the full reward.
 */
export function scaledXp(q: QuestDef, target: number): number {
  const ratio = target / q.target;
  const raw = q.xp * Math.sqrt(ratio);
  return Math.max(10, Math.min(q.xp * 2, Math.round(raw / 5) * 5));
}

/**
 * A step that reaches the new target in a few taps: the largest round
 * number no bigger than the old step that divides the target exactly.
 */
export function niceStep(q: QuestDef, target: number): number {
  const original = q.step ?? 1;
  for (const s of [100, 50, 30, 25, 20, 15, 10, 5, 2, 1]) {
    if (s <= original && s <= target && target % s === 0) return s;
  }
  return 1;
}

/** "100 push-ups" → "15 push-ups"; leaves a title with no number alone. */
function renumber(text: string, from: number, to: number): string | null {
  const re = new RegExp(`(^|[^\\d])${from}(?=[^\\d]|$)`);
  return re.test(text) ? text.replace(re, `$1${to}`) : null;
}

export function applyOverride(q: QuestDef, o: QuestOverride | undefined): QuestDef {
  if (!o || !isTunable(q) || !(o.target > 0)) return q;
  const target = o.target;
  return {
    ...q,
    target,
    title: o.title ?? renumber(q.title, q.target, target) ?? q.title,
    objective: o.objective ?? renumber(q.objective, q.target, target) ?? q.objective,
    step: q.kind === 'value' ? q.step : niceStep(q, target),
    // A cap you stay under is not easier when it moves, so it keeps its XP.
    xp: isCeilingQuest(q) ? q.xp : scaledXp(q, target),
  };
}

/* --------------------------------------------------------------- changes */

export type ChangeOp =
  | { op: 'set_target'; questId: string; target: number; title?: string }
  | { op: 'reset_target'; questId: string }
  | { op: 'add_quest'; questId: string }
  | { op: 'remove_quest'; questId: string }
  | { op: 'log_progress'; questId: string; amount: number }
  | { op: 'set_schedule'; wake?: string; sleep?: string; planningHour?: string }
  | { op: 'add_goal'; title: string; deadline: string | null }
  | { op: 'focus_goal'; goalId: string }
  | { op: 'set_profile'; section: string; field: string; value: string };

export interface VettedChange {
  change: ChangeOp;
  /** What it does, in a line: "100 push-ups → 15 push-ups". */
  label: string;
}

export interface ChangeContext {
  today: string;
  /** Every quest in the catalogue, by id, untouched by overrides. */
  catalog: Record<string, QuestDef>;
  /** The Player's overrides now in force. */
  overrides: Record<string, QuestOverride>;
  activeIds: string[];
  values: Record<string, number>;
  settings: { wake?: string; sleep?: string; briefingTime: string };
  goals: { id: string; title: string; focus: boolean }[];
  /** The life profile as it is now; profile changes are checked against it. */
  profile?: LifeProfile;
}

export const MAX_CHANGES = 6;
export const MAX_BOARD = 30;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Keep the changes that are real and safe; report the rest by reason.
 *
 * Every id must exist, every number must be in bounds, and nothing that
 * would do nothing gets through — a "change" that changes nothing would
 * tell the Player something happened when it did not.
 */
export function vetChanges(raw: unknown, ctx: ChangeContext): { changes: VettedChange[]; refused: string[] } {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_CHANGES * 2) : [];
  const changes: VettedChange[] = [];
  const refused: string[] = [];
  const active = new Set(ctx.activeIds);
  const touched = new Set<string>();

  // Changes earlier in the same reply count: 'set push-ups to 15 and log 15'
  // logs against 15, not 100.
  const overrides = { ...ctx.overrides };
  const effective = (id: string) => applyOverride(ctx.catalog[id], overrides[id]);
  let profile: LifeProfile = ctx.profile ?? {};

  for (const item of list) {
    if (changes.length >= MAX_CHANGES) break;
    const c = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const op = str(c.op, 20);
    const questId = str(c.quest_id ?? c.questId, 40);
    const quest = questId ? ctx.catalog[questId] : undefined;

    const refuse = (why: string) => refused.push(why);

    switch (op) {
      case 'set_target': {
        if (!quest) { refuse(`no quest called "${questId}"`); break; }
        if (!isTunable(quest)) { refuse(`${quest.title} is done or not done — it has no target to change`); break; }
        const raw = num(c.target);
        if (raw === null) { refuse(`no new target for ${quest.title}`); break; }
        const { min, max } = targetBounds(quest);
        const target = Math.round(raw);
        if (target < min || target > max) { refuse(`${target} ${quest.unit} is outside what ${quest.title} allows (${min}–${max})`); break; }
        const now = effective(questId);
        if (target === now.target) { refuse(`${now.title} is already ${target} ${quest.unit}`); break; }
        if (touched.has(questId)) break;
        touched.add(questId);
        const title = str(c.title, 40) || undefined;
        const next = applyOverride(quest, { target, title });
        overrides[questId] = { target, ...(title ? { title } : {}) };
        changes.push({
          change: { op: 'set_target', questId, target, ...(title ? { title } : {}) },
          label: `${now.title} → ${next.title}${next.title === now.title ? ` (${target} ${quest.unit})` : ''} · ${next.xp} XP`,
        });
        break;
      }
      case 'reset_target': {
        if (!quest || !overrides[questId]) { refuse(`${quest?.title ?? questId} has no change to undo`); break; }
        changes.push({ change: { op: 'reset_target', questId }, label: `${effective(questId).title} → back to ${quest.title}` });
        delete overrides[questId];
        break;
      }
      case 'add_quest': {
        if (!quest) { refuse(`no quest called "${questId}"`); break; }
        if (active.has(questId)) { refuse(`${quest.title} is already on the board`); break; }
        if (active.size >= MAX_BOARD) { refuse(`the board already holds ${MAX_BOARD} quests`); break; }
        active.add(questId);
        changes.push({ change: { op: 'add_quest', questId }, label: `Added ${effective(questId).title} to the board` });
        break;
      }
      case 'remove_quest': {
        if (!quest || !active.has(questId)) { refuse(`${quest?.title ?? questId} is not on the board`); break; }
        active.delete(questId);
        changes.push({ change: { op: 'remove_quest', questId }, label: `Took ${effective(questId).title} off the board` });
        break;
      }
      case 'log_progress': {
        if (!quest || !active.has(questId)) { refuse(`${quest?.title ?? questId} is not on today's board`); break; }
        const q = effective(questId);
        const current = ctx.values[questId] ?? 0;
        let amount: number;
        if (isTunable(q)) {
          const raw = num(c.amount);
          if (raw === null || Math.round(raw) === 0) { refuse(`no amount for ${q.title}`); break; }
          amount = Math.round(raw);
          if (Math.abs(amount) > q.target * 3) { refuse(`${amount} ${q.unit} is more than ${q.title} takes in a day`); break; }
          amount = Math.max(-current, amount);
          if (amount === 0) { refuse(`${q.title} is already at 0`); break; }
        } else {
          if (current >= q.target) { refuse(`${q.title} is already done`); break; }
          amount = q.target - current;
        }
        changes.push({
          change: { op: 'log_progress', questId, amount },
          label: isTunable(q)
            ? `${q.title}: ${current} → ${current + amount} / ${q.target} ${q.unit}`
            : `${q.title}: done`,
        });
        break;
      }
      case 'set_schedule': {
        const wake = c.wake != null ? normaliseTime(c.wake) : null;
        const sleep = c.sleep != null ? normaliseTime(c.sleep) : null;
        const planningHour = c.planning_hour != null ? normaliseTime(c.planning_hour) : null;
        const parts: string[] = [];
        const change: ChangeOp = { op: 'set_schedule' };
        if (wake && wake !== ctx.settings.wake) { change.wake = wake; parts.push(`wake ${wake}`); }
        if (sleep && sleep !== ctx.settings.sleep) { change.sleep = sleep; parts.push(`sleep ${sleep}`); }
        if (planningHour && planningHour !== ctx.settings.briefingTime) { change.planningHour = planningHour; parts.push(`planning at ${planningHour}`); }
        if (!parts.length) { refuse('the schedule already says that'); break; }
        changes.push({ change, label: `Schedule: ${parts.join(', ')}` });
        break;
      }
      case 'add_goal': {
        const t = validateGoalTitle(str(c.goal_title ?? c.title, 200));
        if (!t.ok) { refuse(t.error); break; }
        const d = validateDeadline(str(c.deadline, 10), ctx.today);
        if (!d.ok) { refuse(d.error); break; }
        if (ctx.goals.some((g) => g.title.toLowerCase() === t.title.toLowerCase())) { refuse(`"${t.title}" is already a goal`); break; }
        changes.push({
          change: { op: 'add_goal', title: t.title, deadline: d.deadline },
          label: `New goal: ${t.title}${d.deadline ? ` (due ${d.deadline})` : ''}`,
        });
        break;
      }
      case 'focus_goal': {
        const id = str(c.goal_id, 64);
        const goal = ctx.goals.find((g) => g.id === id);
        if (!goal) { refuse('that goal does not exist'); break; }
        if (goal.focus) { refuse(`"${goal.title}" is already the focus`); break; }
        changes.push({ change: { op: 'focus_goal', goalId: id }, label: `Focus moved to ${goal.title}` });
        break;
      }
      case 'set_profile': {
        const section = str(c.section, 30);
        const field = str(c.field, 30);
        const known = findField(section, field);
        if (!known) { refuse(`the profile has no "${section}.${field}"`); break; }
        const cleaned = cleanValue(c.value);
        if (!cleaned.ok) { refuse(cleaned.error); break; }
        const key = `profile:${section}.${field}`;
        if (touched.has(key)) break;
        const before = valueOf(profile, section, field);
        if (cleaned.value === before) { refuse(`${known.field.label} already says that`); break; }
        touched.add(key);
        profile = withField(profile, section, field, cleaned.value);
        changes.push({
          change: { op: 'set_profile', section, field, value: cleaned.value },
          label: cleaned.value
            ? `Profile · ${known.field.label}: ${cleaned.value}`
            : `Profile · ${known.field.label}: cleared`,
        });
        break;
      }
      default:
        if (op) refuse(`unknown change "${op}"`);
    }
  }

  return { changes, refused };
}
