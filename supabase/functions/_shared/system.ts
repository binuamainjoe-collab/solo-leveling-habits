/**
 * What every way of talking to The System shares: who it is, how it
 * coaches, what it may change, and everything it knows before the first
 * word — so the typed assistant and the live voice call are the same System
 * with the same knowledge, not two personalities that drift apart.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

import { CATALOG, loadProfile } from './profile.ts';

/** Every profile field, as the model must name them: "studies.program, …". */
const PROFILE_KEYS = Object.entries(CATALOG)
  .flatMap(([section, def]) => Object.keys(def.fields).map((f) => `${section}.${f}`))
  .join(', ');

/** Who the System is and the ten coaching rules. */
export const CORE = `You are Beerus — the personal assistant and coach inside The System, a Solo Leveling themed app. If asked your name, you are Beerus. You work for one person, the Player. Think JARVIS to Tony Stark: you know their goals, their schedule, their progress and their habits, and your job is to keep them moving with as few decisions from them as possible. The game layer (quests, XP, ranks, stats) is how you talk; you are the point, not an accessory.

HOW YOU COACH — follow every rule, every reply:
1. Structure: when you talk about the day, use real clock times from CONTEXT. Never vague ("later", "soon") when a time exists.
2. One next step: when they ask what to do, or seem stuck, give the ONE next action — not the whole plan. Offer the rest only if asked.
3. Credit fast: when they report finishing something, acknowledge it in a few words and move to what is next. No long praise.
4. Hold the open loops: you can see their unfinished quests and plan blocks in CONTEXT. Keep track for them; never ask them to remember or list things you already have.
5. Start easy: if they are stuck or avoiding something, shrink the first step until it is almost nothing — "open the file", "two minutes", "write one line".
6. Recover without shame: after a missed block, a missed day or a broken streak, say what the next clean start is. Never list what was missed, never guilt, never lecture.
7. Defaults over questions: make sensible choices yourself and say what you assumed in a few words. Ask at most ONE question per reply, and only if you truly cannot proceed.
8. Interest-based pull: connect a task to the goal it serves, or to what finishing it unlocks, using the goals in CONTEXT. Not urgency.
9. Protect the day: if they want to add something to a day that is already full (more than about six hours of planned work, or late in the evening), propose what to drop or move before agreeing to add.
10. Never explain the psychology behind these rules unless they ask why.`;

/** The changes the System may make, and when. Shared by the typed and live prompts. */
export const OPS = `- Change things when the Player asks ("make it 20 minutes", "add reading", "I did 30 push-ups", "move my wake time") or clearly agrees to something you proposed ("ok", "do it", "yes change it"). If you are only suggesting, describe it and ask — do not change it yet.
- When you do change something, say it plainly as done ("Done: lifting is now 20 minutes, push-ups 15.").
- Use only ids from CONTEXT. Ops:
  set_target {quest_id, target, title?} — a new daily target for a counter/duration/value quest on the board or in the catalogue. Give title only if the quest's name holds a number that no longer fits and is not the target itself, e.g. "Study 2 hours" set to 45 → title "Study 45 min".
  reset_target {quest_id} — back to the original target.
  add_quest {quest_id} — put a catalogue quest on the board.
  remove_quest {quest_id} — take a quest off the board.
  log_progress {quest_id, amount} — record what they did today: amount is how much to ADD in the quest's unit (negative to correct a mistake). For a done/not-done quest any amount marks it done.
  set_schedule {wake?, sleep?, planning_hour?} — "HH:MM".
  add_goal {goal_title, deadline?} — a new long-term goal; deadline "YYYY-MM-DD".
  focus_goal {goal_id} — make a goal the focus.
  set_profile {section, field, value} — update the Player's PROFILE. Fields: ${PROFILE_KEYS}. An empty value clears a field.
- Set realistic targets: when easing a quest, cut it to something they could do on a bad day.
- You cannot edit the timeline of a plan here; for that, suggest planning the day in the Planner.
- KEEPING THE PROFILE CURRENT: when the Player tells you something lasting about their life that belongs in a profile field ("I started a job at the café", "I'm cutting now", "my exams are in December"), update it with set_profile straight away, without asking — the app shows the change with Undo. Write the value as a short, complete statement in third person, merged with what the field already says rather than overwriting useful detail. Never put health or medical details in it.`;

export const CHANGE_OPS = ['set_target', 'reset_target', 'add_quest', 'remove_quest', 'log_progress', 'set_schedule', 'add_goal', 'focus_goal', 'set_profile'];

/** The fields one change may carry — the JSON schema items for a change. */
export const CHANGE_FIELDS = {
  op: { type: 'string', enum: CHANGE_OPS },
  quest_id: { type: 'string' },
  target: { type: 'number' },
  title: { type: 'string' },
  amount: { type: 'number' },
  wake: { type: 'string' },
  sleep: { type: 'string' },
  planning_hour: { type: 'string' },
  goal_title: { type: 'string' },
  deadline: { type: 'string' },
  goal_id: { type: 'string' },
  section: { type: 'string' },
  field: { type: 'string' },
  value: { type: 'string' },
};

/* ---------------------------------------------------------------- helpers */

export function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function num(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : null;
}

function daysUntil(date: string, today: string): number | null {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((a - b) / 86_400_000);
}

/**
 * What the app says about right now, re-read field by field and capped.
 * It goes into the prompt, so nothing oversized or malformed gets through
 * to crowd out the rules above it.
 */
export function nowBlock(raw: unknown): { text: string; today: string } {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(c.date, 10)) ? str(c.date, 10) : new Date().toISOString().slice(0, 10);

  const board = (c.board && typeof c.board === 'object' ? c.board : {}) as Record<string, unknown>;
  const open = Array.isArray(board.open) ? board.open.map((t) => str(t, 80)).filter(Boolean).slice(0, 20) : [];
  const mandatoryOpen = Array.isArray(board.mandatoryOpen)
    ? board.mandatoryOpen.map((t) => str(t, 80)).filter(Boolean).slice(0, 12)
    : [];

  const plan = (c.today && typeof c.today === 'object' ? c.today : {}) as Record<string, unknown>;
  const blocks = Array.isArray(plan.blocks)
    ? plan.blocks.slice(0, 16).map((b) => {
        const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
        const state = o.done === true ? 'done' : 'open';
        return `  ${str(o.start, 5)}–${str(o.end, 5)} ${str(o.kind, 8)}: ${str(o.title, 80)}${o.focus ? ` (${str(o.focus, 80)})` : ''}${str(o.kind, 8) === 'task' || str(o.kind, 8) === 'habit' ? ` [${state}]` : ''}`;
      })
    : [];

  const tomorrow = (c.tomorrow && typeof c.tomorrow === 'object' ? c.tomorrow : {}) as Record<string, unknown>;
  // Today's Google Calendar and open Google Tasks, read by the app with the
  // Player's own sign-in (at most 12 calendar lines and 6 task lines).
  const calendar = Array.isArray(c.calendar) ? c.calendar.map((e) => str(e, 100)).filter(Boolean).slice(0, 18) : [];

  const quests = Array.isArray(c.quests) ? c.quests.map((q) => str(q, 160)).filter(Boolean).slice(0, 30) : [];
  const catalog = Array.isArray(c.catalog) ? c.catalog.map((q) => str(q, 90)).filter(Boolean).slice(0, 120) : [];

  const lines = [
    `Now: ${str(c.weekday, 12)} ${date}, ${str(c.time, 5)}`,
    `Player: level ${num(c.level, 1, 999) ?? '?'}, rank ${str(c.rank, 2) || '?'}, ${num(c.xp, 0, 10_000_000) ?? 0} XP, streak ${num(c.streak, 0, 10_000) ?? 0} days`,
    `Usual day: wake ${str(c.wake, 5) || 'unknown'}, sleep ${str(c.sleep, 5) || 'unknown'}; planning hour ${str(c.planningHour, 5) || 'unknown'}`,
    `Today's board: ${num(board.done, 0, 500) ?? 0} of ${num(board.total, 0, 500) ?? 0} quests done.`,
    open.length ? `  Still open: ${open.join('; ')}` : '  Nothing open.',
    mandatoryOpen.length ? `  Mandatory still open: ${mandatoryOpen.join('; ')}` : '',
    blocks.length
      ? `Today's plan:\n${blocks.join('\n')}${str(plan.note, 300) ? `\n  Note: ${str(plan.note, 300)}` : ''}`
      : "Today's plan: none.",
    calendar.length
      ? `Today's calendar and open Google Tasks (timed lines are fixed; "to do:" lines are open tasks, not appointments):\n${calendar.map((e) => `  ${e}`).join('\n')}`
      : '',
    `Tomorrow: ${tomorrow.planned === true ? 'already planned' : 'not planned yet'}.`,
    str(c.screen, 30) ? `They opened you from: ${str(c.screen, 30)}` : '',
    quests.length ? `Quests on the board (id — title — today — kind):\n${quests.map((q) => `  ${q}`).join('\n')}` : '',
    catalog.length ? `Catalogue quests not on the board (id — title):\n${catalog.map((q) => `  ${q}`).join('\n')}` : '',
  ];
  return { text: lines.filter(Boolean).join('\n'), today: date };
}

/* -------------------------------------------------------------- knowledge */

export interface Knowledge {
  /** Goals, findings, memory, forgotten and recent days, ready for the prompt. */
  text: string;
  focusId: string | null;
  memories: { kind: string; content: string }[];
  forgotten: string[];
  /** The recent conversation, oldest first. */
  history: { role: string; text: string }[];
  /** Profile fields still empty ("studies.program"), in interview order. */
  profileEmpty: string[];
}

const MAX_MEMORIES_IN = 40;

/**
 * Everything the System knows about one account, gathered in one pass.
 *
 * `db` must be the caller's own client (see `caller()` in agent.ts), so the
 * row rules limit every read below to that account.
 */
export async function knowledge(db: SupabaseClient, today: string, historyLimit: number): Promise<Knowledge> {
  const [profile, goalsRes, memRes, forgottenRes, snapRes, historyRes] = await Promise.all([
    loadProfile(db, today),
    db
      .from('goals')
      .select('id, title, focus, deadline')
      .eq('active', true)
      .order('focus', { ascending: false })
      .order('created_at', { ascending: true }),
    db
      .from('memories')
      .select('id, kind, content')
      .is('archived_at', null)
      .order('last_seen_at', { ascending: false })
      .limit(MAX_MEMORIES_IN),
    // What the Player told the System to forget. Shown to the model so it is
    // not re-learned from an old message in the conversation.
    db
      .from('memories')
      .select('content')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .limit(MAX_MEMORIES_IN),
    db
      .from('daily_snapshots')
      .select('date, quests_done, quests_total, planned_done, planned_total, streak')
      .order('date', { ascending: false })
      .limit(7),
    db
      .from('assistant_messages')
      .select('role, text')
      .order('created_at', { ascending: false })
      .limit(historyLimit),
  ]);

  const goals = goalsRes.data ?? [];
  const focus = goals.find((g) => g.focus);

  const findingsRes = focus
    ? await db
        .from('findings')
        .select('title, verdict, minutes_to_consume')
        .eq('goal_id', focus.id)
        .is('read_at', null)
        .in('verdict', ['must-read', 'read'])
        .order('score', { ascending: false, nullsFirst: false })
        .limit(5)
    : { data: [] };

  const goalLines = goals.length
    ? goals
        .map((g) => {
          const left = g.deadline ? daysUntil(g.deadline as string, today) : null;
          const due = g.deadline ? ` — due ${g.deadline}${left !== null ? ` (${left} days)` : ''}` : '';
          return `  ${g.id} — ${g.focus ? '[FOCUS] ' : ''}${str(g.title, 160)}${due}`;
        })
        .join('\n')
    : '  none set';

  const findingLines = (findingsRes.data ?? []).map(
    (f) => `  ${f.verdict === 'must-read' ? 'MUST READ' : 'read'}: ${str(f.title, 120)}${f.minutes_to_consume ? ` (~${f.minutes_to_consume} min)` : ''}`,
  );

  const memories = (memRes.data ?? []).map((m) => ({ kind: String(m.kind), content: str(m.content, 280) }));
  const forgotten = (forgottenRes.data ?? []).map((m) => str(m.content, 280));

  const snapLines = (snapRes.data ?? []).map(
    (s) =>
      `  ${s.date}: ${s.quests_done}/${s.quests_total} quests, ${s.planned_done}/${s.planned_total} planned tasks, streak ${s.streak}`,
  );

  const text = [
    profile.text,
    '',
    'Goals (id — title):',
    goalLines,
    findingLines.length ? `Unread findings for the focus goal:\n${findingLines.join('\n')}` : '',
    '',
    'MEMORY (what you already know):',
    memories.length ? memories.map((m) => `  (${m.kind}) ${m.content}`).join('\n') : '  nothing yet',
    forgotten.length
      ? `FORGOTTEN (the Player asked you to forget these; never remember them, or anything saying the same thing, again):\n${forgotten.map((f) => `  ${f}`).join('\n')}`
      : '',
    '',
    'Recent days:',
    snapLines.length ? snapLines.join('\n') : '  no history reported yet',
  ]
    .filter((l) => l !== '')
    .join('\n');

  return {
    text,
    focusId: (focus?.id as string | undefined) ?? null,
    memories,
    forgotten,
    history: (historyRes.data ?? []).reverse().map((m) => ({ role: String(m.role), text: str(m.text, 1500) })),
    profileEmpty: profile.empty,
  };
}
