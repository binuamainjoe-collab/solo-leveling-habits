/**
 * Beerus's contract — what he is told, the shape he must answer in, and the
 * rules every reply is checked against.
 *
 * One module for all three, so the live assistant (assistant/index.ts) and
 * the eval suite (scratch/beerus-eval.ts) ask and judge exactly the same
 * way. A prompt change that breaks a rule fails the eval before it ships,
 * and in production every reply is checked by the same `checkReply`: every
 * break is written to the trace (beerus_traces.violations), and the few
 * changes that must never reach the app are held back (see Checked).
 *
 * Pure: imports only system.ts (itself pure apart from type imports).
 * Checked by scratch/beerus-framework-check.ts and scratch/beerus-eval.ts.
 */

import { CHANGE_FIELDS, CHANGE_OPS, CORE, OPS } from '../system.ts';

export const ACTIONS = ['none', 'plan_today', 'plan_tomorrow', 'open_planner', 'open_goals', 'open_quests', 'suggest_quests', 'open_profile'] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * What the Player opened the System for.
 *   chat      — a normal message
 *   interview — "get to know me": it asks about the empty profile fields
 *   board     — "suggest quests from my profile": a proposal, not a change
 */
export const MODES = ['chat', 'interview', 'board'] as const;
export type Mode = (typeof MODES)[number];
/** What a quest proposal may change. */
export const BOARD_OPS = ['add_quest', 'remove_quest', 'set_target'];

export const MEMORY_KINDS = ['fact', 'preference', 'commitment', 'pattern'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/**
 * Never stored, whatever the model proposes: credentials, long numbers that
 * could be account or card numbers, and health details. The last is a
 * deliberate line — this is a coach, not a medical record.
 */
export const NEVER_REMEMBER =
  /password|passcode|api[ _-]?key|secret|token|\b\d{9,}\b|\b(adhd|diagnos\w*|medicat\w*|prescri\w*|therap\w*|disorder|dosage|symptom\w*)\b/i;

export function modeRules(mode: Mode, empty: string[]): string {
  if (mode === 'interview') {
    return `INTERVIEW — the Player asked you to get to know them, to fill their PROFILE.
- Ask about ONE thing at a time, short and natural, like a person getting to know them, not a form. You may ask about two closely related fields together.
- The empty fields, most useful first: ${empty.slice(0, 14).join(', ') || 'none — the profile is full; ask what has changed lately'}.
- Start with what helps you plan their days most: studies, routine, work, training.
- Every answer they give: save it at once with set_profile, and in the same reply ask the next question. Acknowledge in a few words; no praise.
- If they skip a question, move on. After about ten answers, or when they want to stop, stop asking, say what you now understand about their days in one sentence, and offer suggest_quests as the action.`;
  }
  if (mode === 'board') {
    return `QUEST PROPOSAL — the Player asked you to suggest a quest board that fits their PROFILE.
- Look at the PROFILE, the goals, their routine and how recent days went, then propose the changes that make the board fit their life: add_quest, remove_quest and set_target only, at most 6, using ids from CONTEXT. Fewer is fine; the most important first.
- Respect their load: a full schedule gets fewer, smaller quests. A bulk wants protein and lifting; a cut wants protein and steps; studies want study and review quests sized to their exams.
- In reply, say in two to four sentences what you propose and why, tied to specific things in their profile.
- These changes are a PROPOSAL: the app shows them with Accept. Never say they are done.`;
  }
  return '';
}

export const SYSTEM = `${CORE}

VOICE
- Short. One to four sentences for most replies. No headings, no bullet lists unless they ask for a list.
- Calm, direct, warm. A light System flavour is fine ("Quest logged.", "Noted, Player."), at most once per reply, never forced.
- No exclamation marks. No hype. No guilt. No urgency language.
- Never mention diagnoses, conditions or medical topics, and never give medical, legal or financial advice. If asked, say briefly that it is outside what you do.
- Never claim to have done something you did not put in changes.

CHANGING THE SYSTEM — you can change the app itself. Put each change in changes; the app checks it, applies it at once, and gives the Player an Undo button.
${OPS}
- For a plan, offer plan_today or plan_tomorrow instead.
- Most replies change nothing. Return an empty list.

ACTIONS — set action to offer ONE button under your reply. It does nothing until they tap it:
- plan_tomorrow: they want to plan tomorrow, or it is evening and tomorrow has no plan and planning fits the conversation.
- plan_today: they want to plan or re-plan today.
- open_planner: they want to see today's or tomorrow's timeline.
- open_goals: goals, findings or the shadows came up.
- open_quests: they want to tick things off or see the board.
- suggest_quests: the profile has changed in a way that should change their quests, or they ask what quests would suit them.
- open_profile: they want to see or edit what you know about them.
- none: most replies.

MEMORY — remember: up to 3 short, durable things worth knowing next week, in the Player's favour:
- fact (an exam date, a deadline, where they study), preference (likes mornings, hates long lists), commitment (gym Tue/Thu), pattern (keeps skipping reading after 22:00 — only when CONTEXT shows it more than once).
- Only what they said or what CONTEXT plainly shows. One idea per memory, written in third person, under 140 characters, dates absolute (YYYY-MM-DD).
- Never: anything already in MEMORY or the PROFILE, passing moods, passwords or numbers, health or medical details, anything about other people beyond a name and a role.
- Whenever the Player tells you something lasting about themselves, remember it. Small talk remembers nothing: return an empty list.
- Use what you know. Tie advice to specific things in the PROFILE, MEMORY and their files, the way someone who knows them would, without reciting it back.

suggestions: up to 3 short replies the Player might tap next, in their voice, at most 6 words each. Empty when nothing obvious.

SPOKEN MESSAGES
- When the new message is an audio clip, write what the Player said in heard — their words, cleaned of filler (um, uh) — and answer it exactly as if they had typed it. If you cannot make out any words, leave heard empty and reply that you did not catch it.
- Your reply to a spoken message is read aloud. Keep it to one or two short sentences, and use no symbols, arrows, emoji or lists.
- For a typed message, heard is empty.`;

export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    heard: { type: 'string' },
    reply: { type: 'string' },
    suggestions: { type: 'array', items: { type: 'string' } },
    action: { type: 'string', enum: [...ACTIONS] },
    remember: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...MEMORY_KINDS] },
          content: { type: 'string' },
        },
        required: ['kind', 'content'],
        propertyOrdering: ['kind', 'content'],
      },
    },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: CHANGE_FIELDS,
        required: ['op'],
        propertyOrdering: ['op', 'quest_id', 'target', 'title', 'amount', 'wake', 'sleep', 'planning_hour', 'goal_title', 'deadline', 'goal_id', 'section', 'field', 'value'],
      },
    },
  },
  required: ['reply', 'suggestions', 'action', 'remember', 'changes'],
  propertyOrdering: ['heard', 'reply', 'suggestions', 'action', 'remember', 'changes'],
};

export interface Proposed {
  heard?: unknown;
  reply?: unknown;
  suggestions?: unknown;
  action?: unknown;
  remember?: unknown;
  changes?: unknown;
}

/* ------------------------------------------------------------- the prompt */

/** The user turn of a chat call. The same assembly for the live call and the eval. */
export function buildPrompt(parts: {
  now: string;
  knowledge: string;
  history: { role: string; text: string }[];
  mode: Mode;
  profileEmpty: string[];
  message: string;
  spoken: boolean;
}): string {
  const transcript = parts.history.length
    ? parts.history.map((m) => `${m.role === 'user' ? 'Player' : 'System'}: ${m.text}`).join('\n')
    : '(this is the first message)';
  return [
    'CONTEXT',
    parts.now,
    '',
    parts.knowledge,
    '',
    'CONVERSATION SO FAR',
    transcript,
    '',
    modeRules(parts.mode, parts.profileEmpty),
    '',
    'NEW MESSAGE FROM THE PLAYER',
    parts.spoken ? '(spoken — the audio clip attached below)' : parts.message,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/* --------------------------------------------------------- the reply rules */

/** A rule a reply broke. See HARD for the ones that point at a real fault. */
export type Violation =
  | 'no_reply'
  | 'too_long'
  | 'exclamation'
  | 'medical'
  | 'spoken_symbols'
  | 'bad_action'
  | 'too_many_suggestions'
  | 'too_many_memories'
  | 'unsafe_memory'
  | 'too_many_changes'
  | 'bad_op'
  | 'unknown_quest'
  | 'unknown_goal'
  | 'not_a_board_op';

/** Most sentences a reply may have: typed "one to four, for most replies" (one over allowed), spoken "one or two". */
export const MAX_SENTENCES = { typed: 5, spoken: 2 } as const;
export const MAX_CHANGES = 8;

/**
 * Medical advice, not medical words: "you probably have ADHD", a dose, a
 * medication. A refusal that says it is outside what Beerus does is the
 * behaviour the prompt asks for, so it never counts.
 */
const MEDICAL = /\b(you (may|might|probably|likely|could) have|sounds like you have|dosage|dose of|medicat\w*|prescri\w*)\b/i;
const DECLINES = /outside what i do|not something i (can|do)|can'?t (help|advise) with that/i;

export function sentences(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  // A sentence ends at . ? ! or … followed by a space or the end. Times
  // ("17:30"), decimals ("2.5") and initials stay inside one sentence.
  return t.split(/(?<=[.?!…])\s+(?=[A-Z0-9"'(])/).filter((s) => s.trim().length > 1).length;
}

export interface ReplyContext {
  spoken: boolean;
  mode: Mode;
  /** Every quest id the app sent: the board and the whole catalogue. */
  questIds: Set<string>;
  goalIds: Set<string>;
}

export interface Checked {
  violations: Violation[];
  /**
   * The changes passed on to the app, in order. Only a non-quest change
   * inside a quest proposal (never meant to wait behind Accept), anything
   * that isn't an object and anything past MAX_CHANGES is held back. A bad
   * op or an id that doesn't exist is recorded and still passed on: the app
   * refuses it and shows the Player why (vetChanges in
   * src/data/questEdits.ts), which beats a "Done" with nothing behind it.
   */
  changes: Record<string, unknown>[];
  /** How many changes were held back. */
  dropped: number;
}

/**
 * Check one parsed reply against the contract. Never throws; anything that
 * isn't the expected shape counts as missing.
 */
export function checkReply(out: Proposed | null, ctx: ReplyContext): Checked {
  const v = new Set<Violation>();
  const reply = typeof out?.reply === 'string' ? out.reply.trim() : '';
  if (!reply) v.add('no_reply');
  if (sentences(reply) > (ctx.spoken ? MAX_SENTENCES.spoken : MAX_SENTENCES.typed)) v.add('too_long');
  if (reply.includes('!')) v.add('exclamation');
  if (MEDICAL.test(reply) && !DECLINES.test(reply)) v.add('medical');
  if (ctx.spoken && (/[•*#→←↑↓]|^\s*[-\d]+[.)]\s/m.test(reply) || /\p{Extended_Pictographic}/u.test(reply))) v.add('spoken_symbols');

  if (out?.action !== undefined && !ACTIONS.includes(out.action as Action)) v.add('bad_action');
  if (Array.isArray(out?.suggestions) && out.suggestions.length > 3) v.add('too_many_suggestions');

  const memories = Array.isArray(out?.remember) ? out.remember : [];
  if (memories.length > 3) v.add('too_many_memories');
  for (const m of memories) {
    const content = m && typeof m === 'object' ? String((m as Record<string, unknown>).content ?? '') : '';
    if (NEVER_REMEMBER.test(content)) v.add('unsafe_memory');
  }

  const raw = Array.isArray(out?.changes) ? out.changes : [];
  if (raw.length > MAX_CHANGES) v.add('too_many_changes');
  const changes: Record<string, unknown>[] = [];
  for (const item of raw.slice(0, MAX_CHANGES)) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const op = String(c.op ?? '');
    if (ctx.mode === 'board' && !BOARD_OPS.includes(op)) {
      v.add('not_a_board_op');
      continue;
    }
    if (!CHANGE_OPS.includes(op)) v.add('bad_op');
    // The same reading of the id as the app's (questEdits.ts): trimmed, with
    // the camel-case spelling accepted.
    const questId = String(c.quest_id ?? c.questId ?? '').trim();
    const goalId = String(c.goal_id ?? c.goalId ?? '').trim();
    const questOp = ['set_target', 'reset_target', 'add_quest', 'remove_quest', 'log_progress'].includes(op);
    if (questOp && !ctx.questIds.has(questId)) v.add('unknown_quest');
    if (op === 'focus_goal' && !ctx.goalIds.has(goalId)) v.add('unknown_goal');
    changes.push(c);
  }
  return { violations: [...v], changes, dropped: raw.length - changes.length };
}

/**
 * Violations that point at a broken prompt or a model making things up, not
 * a matter of voice. The live eval fails on any of them, and they are the
 * ones worth an alert when they recur in beerus_traces.
 */
export const HARD: Violation[] = ['no_reply', 'bad_op', 'unknown_quest', 'unknown_goal', 'not_a_board_op', 'unsafe_memory'];
